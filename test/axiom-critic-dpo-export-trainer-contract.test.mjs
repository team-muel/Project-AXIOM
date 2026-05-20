/**
 * axiom-critic-dpo-export-trainer-contract.test.mjs  (ADTC-01 … ADTC-08)
 *
 * Contract tests that the DPO schema produced by
 * scripts/export-notagen-preference-dataset.mjs is correctly consumed by
 * scripts/train-notagen-axiom-adapter-dpo.py.
 *
 * Pure-JS unit tests (ADTC-01–06) mirror the Python _response_text() helper
 * and the loader's skip condition.  Integration tests (ADTC-07–08) run the
 * export script end-to-end and confirm the resulting JSONL is fully loadable.
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

// ─── Mirrors scripts/train-notagen-axiom-adapter-dpo.py _response_text() ──────

/** Replicates `_response_text(side)` from the Python trainer. */
function responseText(side) {
    return String(side.response ?? side.output ?? "").trim();
}

/** Replicates the loader's per-row validity check. */
function loaderAccepts(pair) {
    const c = pair.chosen ?? {};
    const r = pair.rejected ?? {};
    return Boolean(
        String(c.instruction ?? "").trim() &&
        responseText(c) &&
        String(r.instruction ?? "").trim() &&
        responseText(r),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

const SHARED_EVIDENCE = {
    worker: "learned_symbolic",
    planSignature: "sig-contract",
    promptPack: {
        version: "v1",
        planSignature: "sig-contract",
        styleCue: { key: "D minor", tempo: 80, brief: "Baroque solo violin" },
        sections: [],
    },
    providerRequest: {
        adapter: "notagen_class",
        version: "learned_notagen_adapter_v1",
        provider: "notagen_native",
        model: "notagen-v1",
        planSignature: "sig-contract",
        conditioningText: "%Baroque\n%Bach, J.S.\n%Solo_Violin",
        controlLines: ["period=Baroque", "composer=Bach, J.S."],
    },
    abcText: "X:1\nT:Contract Test\nM:4/4\nL:1/8\nK:D\n| DEFG ABCD |",
    generationMode: "notagen_abc_inference_hf_causal_lm",
};

function seedSong(outputRoot, { songId, decision, craftScoreSummary }) {
    const songDir = path.join(outputRoot, songId);
    writeJson(path.join(songDir, "manifest.json"), { approvalStatus: decision, meta: {}, reviewFeedback: {} });
    writeJson(path.join(songDir, "candidates", "index.json"), {
        selectedCandidateId: "cand-001",
        entries: [{ candidateId: "cand-001", selected: true }],
    });
    writeJson(path.join(songDir, "candidates", "cand-001", "candidate-manifest.json"), {
        version: 1, stage: "structure", songId, candidateId: "cand-001",
        attempt: 0, selected: true, evaluatedAt: "2024-01-01T00:00:00.000Z",
        workflow: "learned_symbolic", worker: "learned_symbolic",
        provider: "notagen_native", model: "notagen-v1", meta: {},
        executionPlan: { workflow: "learned_symbolic", composeWorker: "learned_symbolic", selectedModels: [] },
        revisionDirectives: [],
        structureEvaluation: { passed: decision === "approved", score: decision === "approved" ? 0.9 : 0.35, craftScoreSummary },
        proposalEvidence: SHARED_EVIDENCE,
        artifacts: {},
    });
}

function buildContractFixture(outputRoot) {
    seedSong(outputRoot, {
        songId: "song-pass",
        decision: "approved",
        craftScoreSummary: {
            finalCraftScore: 0.85, advancedCraftScore: 0.75,
            harmonyContractScore: 0.82, evidenceCoverageScore: 0.76,
        },
    });
    seedSong(outputRoot, {
        songId: "song-fail",
        decision: "rejected",
        craftScoreSummary: {
            finalCraftScore: 0.40, advancedCraftScore: 0.35,
            harmonyContractScore: 0.40, evidenceCoverageScore: 0.30,
            evidenceCoverageGateTier: "partial",
            harmonyContractViolations: 1,
        },
    });
}

function runExport(outputRoot, snapshotId = "2024-01-01") {
    execFileSync(
        process.execPath,
        [exportScript, `--root=${outputRoot}`, `--snapshot=${snapshotId}`],
        { encoding: "utf-8", cwd: repoRoot },
    );
    return readJsonl(
        path.join(outputRoot, "_system", "ml", "notagen-preferences", snapshotId, "dpo-critic-pairs.jsonl"),
    );
}

// ─── Pure unit: _response_text() contract ─────────────────────────────────────

test("ADTC-01: responseText reads `response` field (current export format)", () => {
    assert.equal(responseText({ response: "ABC...", output: "other" }), "ABC...");
});

test("ADTC-02: responseText falls back to `output` when `response` is absent (legacy format)", () => {
    assert.equal(responseText({ output: "legacy_abc" }), "legacy_abc");
});

test("ADTC-03: responseText returns empty string when both fields are absent", () => {
    assert.equal(responseText({}), "");
    assert.equal(responseText({ instruction: "test" }), "");
});

test("ADTC-04: loaderAccepts accepts pair with `response` fields", () => {
    assert.equal(loaderAccepts({
        chosen:   { instruction: "ins", response: "abc" },
        rejected: { instruction: "ins", response: "xyz" },
    }), true);
});

test("ADTC-05: loaderAccepts accepts pair with legacy `output` fields only", () => {
    assert.equal(loaderAccepts({
        chosen:   { instruction: "ins", output: "abc" },
        rejected: { instruction: "ins", output: "xyz" },
    }), true);
});

test("ADTC-06: loaderAccepts rejects pair missing both response and output", () => {
    assert.equal(loaderAccepts({
        chosen:   { instruction: "ins" },
        rejected: { instruction: "ins", response: "xyz" },
    }), false, "missing chosen response → pair must be skipped");
    assert.equal(loaderAccepts({
        chosen:   { instruction: "ins", response: "abc" },
        rejected: { instruction: "ins" },
    }), false, "missing rejected response → pair must be skipped");
});

// ─── Integration: export schema ────────────────────────────────────────────────

test("ADTC-07: exported DPO pairs carry both `response` and `output` on each side", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-dpo-contract-"));
    try {
        buildContractFixture(tmp);
        const pairs = runExport(tmp);

        assert.ok(pairs.length >= 1, "at least one DPO pair must be exported");

        for (const pair of pairs) {
            assert.ok(
                typeof pair.chosen.response === "string" && pair.chosen.response.trim(),
                "chosen.response must be a non-empty string",
            );
            assert.ok(
                typeof pair.chosen.output === "string" && pair.chosen.output.trim(),
                "chosen.output must be a non-empty string (backward compat)",
            );
            assert.ok(
                typeof pair.rejected.response === "string" && pair.rejected.response.trim(),
                "rejected.response must be a non-empty string",
            );
            assert.ok(
                typeof pair.rejected.output === "string" && pair.rejected.output.trim(),
                "rejected.output must be a non-empty string (backward compat)",
            );
            assert.equal(pair.chosen.response, pair.chosen.output,
                "response and output must match on chosen side");
            assert.equal(pair.rejected.response, pair.rejected.output,
                "response and output must match on rejected side");
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── Integration: trainer loader simulation ────────────────────────────────────

test("ADTC-08: trainer loader simulation accepts all exported pairs (≥1 pair loaded)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-dpo-contract-"));
    try {
        buildContractFixture(tmp);
        const pairs = runExport(tmp);

        assert.ok(pairs.length >= 1, "export must produce at least one pair");

        const loaded = pairs.filter(loaderAccepts);
        assert.equal(
            loaded.length, pairs.length,
            `trainer loader simulation must accept all ${pairs.length} exported pair(s); accepted ${loaded.length}`,
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
