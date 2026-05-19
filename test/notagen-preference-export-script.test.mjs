/**
 * Regression tests for scripts/export-notagen-preference-dataset.mjs
 *
 * Verifies that promptPack and providerRequest are non-null in export rows
 * when the candidate-manifest.json contains proposalEvidence with those fields.
 *
 * Tests:
 *   1. Approved song exports a row with non-null promptPack + providerRequest
 *   2. Rejected song exports a row with non-null promptPack + providerRequest
 *   3. Rows without proposalEvidence.promptPack/providerRequest get null (graceful)
 *   4. DPO pairs are built from approved+rejected rows sharing a planSignature
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const exportScript = path.join(repoRoot, "scripts", "export-notagen-preference-dataset.mjs");

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

function seedSong(outputRoot, { songId, decision, proposalEvidence, structureEvaluation }) {
    const songDir = path.join(outputRoot, songId);
    writeJson(path.join(songDir, "manifest.json"), {
        approvalStatus: decision,
        meta: {},
        reviewFeedback: {},
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
        provider: "notagen_native",
        model: "notagen-v1",
        meta: {},
        executionPlan: { workflow: "learned_symbolic", composeWorker: "learned_symbolic", selectedModels: [] },
        revisionDirectives: [],
        structureEvaluation: structureEvaluation ?? { passed: true, score: 0.9 },
        proposalEvidence,
        artifacts: {},
    });
}

const SAMPLE_PROMPT_PACK = {
    version: "v1",
    planSignature: "sig-abc123",
    styleCue: { key: "C major", tempo: 96, brief: "Romantic string trio" },
    sections: [],
};

const SAMPLE_PROVIDER_REQUEST = {
    adapter: "notagen_class",
    version: "learned_notagen_adapter_v1",
    provider: "notagen_native",
    model: "notagen-v1",
    promptPackVersion: "v1",
    planSignature: "sig-abc123",
    conditioningText: "%Romantic\n%Brahms, Johannes\n%String_Trio",
    controlLines: ["period=Romantic", "composer=Brahms, Johannes"],
};
const SAMPLE_ABC = "X:1\nT:DPO Test\nM:4/4\nL:1/8\nK:C\n| CDEF GABC |";

function runExport(outputRoot, snapshotId = "2024-01-01") {
    const result = execFileSync(
        process.execPath,
        [exportScript, `--root=${outputRoot}`, `--snapshot=${snapshotId}`],
        { encoding: "utf-8", cwd: repoRoot },
    );
    return JSON.parse(result.trim().split("\n").at(-1));
}

test("export row has non-null promptPack and providerRequest when stored in proposalEvidence", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-pref-export-"));
    try {
        seedSong(tmp, {
            songId: "song-approved",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                planSignature: "sig-abc123",
                promptPack: SAMPLE_PROMPT_PACK,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
        });

        const summary = runExport(tmp);
        assert.equal(summary.ok, true);
        assert.equal(summary.totalRows, 1);

        const rows = readJsonl(path.join(tmp, "_system", "ml", "notagen-preferences", "2024-01-01", "preferences.jsonl"));
        assert.equal(rows.length, 1);
        const row = rows[0];

        assert.notEqual(row.promptPack, null, "promptPack should be non-null");
        assert.notEqual(row.providerRequest, null, "providerRequest should be non-null");
        assert.equal(row.promptPack.planSignature, "sig-abc123");
        assert.equal(row.providerRequest.planSignature, "sig-abc123");
        assert.equal(row.decision, "rejected", "AXIOM critic, not manifest.approvalStatus, labels preference rows");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("export row has null promptPack and providerRequest when absent from proposalEvidence", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-pref-export-"));
    try {
        seedSong(tmp, {
            songId: "song-missing",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                planSignature: "sig-xyz",
                // No promptPack / providerRequest
            },
        });

        runExport(tmp);
        const rows = readJsonl(path.join(tmp, "_system", "ml", "notagen-preferences", "2024-01-01", "preferences.jsonl"));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].promptPack, null, "promptPack should be null when absent");
        assert.equal(rows[0].providerRequest, null, "providerRequest should be null when absent");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("DPO pairs link approved and rejected rows sharing a planSignature", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-pref-dpo-"));
    try {
        const sharedEvidence = {
            worker: "learned_symbolic",
            planSignature: "sig-shared",
            promptPack: SAMPLE_PROMPT_PACK,
            providerRequest: SAMPLE_PROVIDER_REQUEST,
            abcText: SAMPLE_ABC,
            generationMode: "notagen_abc_inference_hf_causal_lm",
        };
        seedSong(tmp, {
            songId: "song-A",
            decision: "approved",
            proposalEvidence: sharedEvidence,
            structureEvaluation: {
                passed: true,
                score: 0.9,
                craftScoreSummary: {
                    finalCraftScore: 0.85,
                    advancedCraftScore: 0.75,
                    harmonyContractScore: 0.8,
                    evidenceCoverageScore: 0.75,
                },
            },
        });
        seedSong(tmp, {
            songId: "song-B",
            decision: "rejected",
            proposalEvidence: sharedEvidence,
            structureEvaluation: {
                passed: false,
                score: 0.35,
                craftScoreSummary: {
                    finalCraftScore: 0.4,
                    advancedCraftScore: 0.35,
                    harmonyContractScore: 0.4,
                    evidenceCoverageScore: 0.3,
                    evidenceCoverageGateTier: "partial",
                    harmonyContractViolations: 1,
                },
            },
        });

        const summary = runExport(tmp);
        assert.equal(summary.dpoPairCount, 1, "one DPO pair expected");

        const dpoPairs = readJsonl(path.join(tmp, "_system", "ml", "notagen-preferences", "2024-01-01", "dpo-critic-pairs.jsonl"));
        assert.equal(dpoPairs.length, 1);
        const pair = dpoPairs[0];
        assert.equal(pair.chosen.decision, "approved");
        assert.equal(pair.rejected.decision, "rejected");
        assert.equal(pair.chosen.response, SAMPLE_ABC);
        assert.equal(pair.rejected.response, SAMPLE_ABC);
        assert.ok(pair.meta.scoreGap >= 0.05, "DPO trainer requires a non-zero scoreGap");
        assert.equal(typeof pair.meta.rejectionReason, "string");
        // both sides must carry the input payloads
        assert.notEqual(pair.chosen.promptPack, null);
        assert.notEqual(pair.rejected.promptPack, null);
        const legacyPairs = readJsonl(path.join(tmp, "_system", "ml", "notagen-preferences", "2024-01-01", "dpo-pairs.jsonl"));
        assert.equal(legacyPairs.length, 1, "legacy dpo-pairs.jsonl should remain available");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
