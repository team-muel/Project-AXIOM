/**
 * Regression tests for scripts/export-notagen-sft-dataset.mjs
 *
 * Tests:
 *   1. Approved song with abcText + providerRequest exports an (instruction, output) row
 *   2. Non-approved song is excluded from the export
 *   3. Approved song without abcText is counted as noAbcText and excluded
 *   4. Mock generationMode rows are excluded by default; included with --include-mock
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const exportScript = path.join(repoRoot, "scripts", "export-notagen-sft-dataset.mjs");

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

function seedSong(outputRoot, { songId, decision, proposalEvidence }) {
    const songDir = path.join(outputRoot, songId);
    writeJson(path.join(songDir, "manifest.json"), {
        approvalStatus: decision,
        meta: {},
    });
    writeJson(path.join(songDir, "candidates", "index.json"), {
        selectedCandidateId: "cand-001",
        entries: [{ candidateId: "cand-001", selected: true }],
    });
    writeJson(path.join(songDir, "candidates", "cand-001", "candidate-manifest.json"), {
        version: 1,
        stage: "structure",
        songId,
        candidateId: "cand-001",
        attempt: 0,
        selected: true,
        evaluatedAt: "2024-01-01T00:00:00.000Z",
        workflow: "learned_symbolic",
        worker: "learned_symbolic",
        provider: "notagen_local",
        model: "notagen-v1",
        meta: {},
        executionPlan: { workflow: "learned_symbolic", composeWorker: "learned_symbolic", selectedModels: [] },
        revisionDirectives: [],
        structureEvaluation: { passed: true, score: 0.9 },
        proposalEvidence,
        artifacts: {},
    });
}

function runExport(outputRoot, extraArgs = []) {
    const result = execFileSync(
        process.execPath,
        [exportScript, `--root=${outputRoot}`, "--snapshot=2024-01-01", ...extraArgs],
        { encoding: "utf-8", cwd: repoRoot },
    );
    return JSON.parse(result.trim().split("\n").at(-1));
}

const SAMPLE_ABC = "X:1\nT:Test Score\nM:4/4\nL:1/8\nK:C\n|:CDEF GABC:|";
const SAMPLE_PROVIDER_REQUEST = {
    adapter: "notagen_class",
    conditioningText: "%Romantic\n%Brahms, Johannes\n%String_Trio",
    controlLines: ["period=Romantic", "composer=Brahms, Johannes", "instrumentation=String_Trio"],
};

test("approved song with abcText and providerRequest exports a valid SFT row", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-export-"));
    try {
        seedSong(tmp, {
            songId: "song-approved",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                planSignature: "sig-abc123",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
        });

        const summary = runExport(tmp);
        assert.equal(summary.ok, true, "export should report ok:true");
        assert.equal(summary.totalPairs, 1, "should have 1 SFT pair");
        assert.equal(summary.noAbcText, 0, "noAbcText count should be 0");

        const rows = readJsonl(
            path.join(tmp, "_system", "ml", "notagen-sft", "2024-01-01", "sft-pairs.jsonl"),
        );
        assert.equal(rows.length, 1, "JSONL should have 1 row");
        const row = rows[0];

        assert.ok(typeof row.instruction === "string" && row.instruction.length > 0,
            "instruction should be a non-empty string");
        assert.ok(typeof row.output === "string" && row.output.startsWith("X:1"),
            "output should be the full ABC score starting with X:1");
        assert.equal(row.songId, "song-approved");
        assert.ok(row.instruction.includes("%%axiom_control_begin"),
            "instruction should include axiom_control_begin block");
        assert.ok(row.instruction.includes("period=Romantic"),
            "instruction should include period control line");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("non-approved song is excluded from SFT export", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-nonapproved-"));
    try {
        seedSong(tmp, {
            songId: "song-rejected",
            decision: "rejected",
            proposalEvidence: {
                worker: "learned_symbolic",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
        });
        seedSong(tmp, {
            songId: "song-approved",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
        });

        const summary = runExport(tmp);
        assert.equal(summary.ok, true);
        assert.equal(summary.totalPairs, 1, "only approved song should be exported");

        const rows = readJsonl(
            path.join(tmp, "_system", "ml", "notagen-sft", "2024-01-01", "sft-pairs.jsonl"),
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].songId, "song-approved");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("approved song without abcText is excluded and counted as noAbcText", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-noabc-"));
    try {
        seedSong(tmp, {
            songId: "song-no-abc",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                planSignature: "sig-noabc",
                // abcText intentionally absent
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
        });

        const summary = runExport(tmp);
        assert.equal(summary.ok, true);
        assert.equal(summary.totalPairs, 0, "no pairs when abcText is absent");
        assert.equal(summary.noAbcText, 1, "noAbcText count should be 1");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("mock generationMode rows are excluded by default and included with --include-mock", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-mock-"));
    try {
        seedSong(tmp, {
            songId: "song-mock",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "mock_notagen_abc",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
        });

        // Default: mock excluded
        const summaryDefault = runExport(tmp);
        assert.equal(summaryDefault.ok, true);
        assert.equal(summaryDefault.totalPairs, 0, "mock row should be excluded by default");
        assert.equal(summaryDefault.mockExcluded, 1, "mockExcluded count should be 1");

        // With --include-mock flag
        const summaryInclude = runExport(tmp, ["--include-mock"]);
        assert.equal(summaryInclude.ok, true);
        assert.equal(summaryInclude.totalPairs, 1, "mock row should be included with --include-mock");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
