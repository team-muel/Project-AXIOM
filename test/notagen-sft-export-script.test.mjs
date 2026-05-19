/**
 * Regression tests for scripts/export-notagen-sft-dataset.mjs
 *
 * Tests:
 *   1. Approved song with abcText + providerRequest exports an (instruction, output) row
 *   2. Non-approved song is excluded from the export
 *   3. Approved song without abcText is counted as noAbcText and excluded
 *   4. Mock generationMode rows are excluded by default; included with --include-mock
 *   P0. Critic-passing song with qualityRating=1 is hard-blocked (humanRejected count=1)
 *   P1. Critic-failing song with qualityRating=5 → human-anchor-sft-pairs.jsonl (label=human_anchor)
 *   P2. summary.confidenceDistribution present with p25/p50/p75/mean when pairs exist
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

function seedSong(outputRoot, { songId, decision, proposalEvidence, structureEvaluation, curatorCalibration, listenerFeedback }) {
    const songDir = path.join(outputRoot, songId);
    writeJson(path.join(songDir, "manifest.json"), {
        approvalStatus: decision,
        meta: {},
    });
    writeJson(path.join(songDir, "candidates", "index.json"), {
        selectedCandidateId: "cand-001",
        entries: [{ candidateId: "cand-001", selected: true }],
    });
    const candidateManifest = {
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
        structureEvaluation: structureEvaluation ?? { passed: true, score: 0.9 },
        proposalEvidence,
        artifacts: {},
    };
    if (curatorCalibration) candidateManifest.curatorCalibration = curatorCalibration;
    if (listenerFeedback)   candidateManifest.listenerFeedback   = listenerFeedback;
    writeJson(path.join(songDir, "candidates", "cand-001", "candidate-manifest.json"), candidateManifest);
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
const PASSING_STRUCTURE_EVALUATION = {
    passed: true,
    score: 0.9,
    craftScoreSummary: {
        finalCraftScore: 0.86,
        advancedCraftScore: 0.74,
        harmonyContractScore: 0.82,
        evidenceCoverageScore: 0.76,
    },
};
const FAILING_STRUCTURE_EVALUATION = {
    passed: false,
    score: 0.35,
    craftScoreSummary: {
        finalCraftScore: 0.42,
        advancedCraftScore: 0.34,
        harmonyContractScore: 0.45,
        evidenceCoverageScore: 0.32,
    },
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
            structureEvaluation: PASSING_STRUCTURE_EVALUATION,
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

test("candidate failing AXIOM critic gate is excluded from SFT export", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-nonapproved-"));
    try {
        seedSong(tmp, {
            songId: "song-rejected",
            decision: "rejected",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
            structureEvaluation: FAILING_STRUCTURE_EVALUATION,
        });
        seedSong(tmp, {
            songId: "song-approved",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
            structureEvaluation: PASSING_STRUCTURE_EVALUATION,
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
            structureEvaluation: PASSING_STRUCTURE_EVALUATION,
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
            structureEvaluation: PASSING_STRUCTURE_EVALUATION,
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

// ── P0: human rejection hard block ─────────────────────────────────────────────

test("P0: critic-passing song with qualityRating=1 is hard-blocked from SFT", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-p0-"));
    try {
        seedSong(tmp, {
            songId: "song-human-rejected",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
            structureEvaluation: PASSING_STRUCTURE_EVALUATION,
            curatorCalibration: { qualityRating: 1, source: "expert-review", reviewedAt: "2024-01-01T00:00:00Z" },
        });

        const summary = runExport(tmp);
        assert.equal(summary.ok, true);
        assert.equal(summary.totalPairs, 0, "human-rejected song must not enter SFT regardless of critic");
        assert.equal(summary.humanRejected, 1, "humanRejected count should be 1");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ── P1: human anchor split ──────────────────────────────────────────────────────

test("P1: critic-failing song with qualityRating=5 goes to human-anchor-sft-pairs.jsonl", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-p1-"));
    try {
        seedSong(tmp, {
            songId: "song-human-anchor",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
            structureEvaluation: FAILING_STRUCTURE_EVALUATION,
            curatorCalibration: { qualityRating: 5, source: "expert-review", reviewedAt: "2024-01-01T00:00:00Z" },
        });

        const summary = runExport(tmp);
        assert.equal(summary.ok, true);
        assert.equal(summary.totalPairs, 0, "critic-failing song must not enter main SFT");
        assert.equal(summary.humanAnchorPairs, 1, "should produce 1 human anchor pair");

        const anchorRows = readJsonl(
            path.join(tmp, "_system", "ml", "notagen-sft", "2024-01-01", "human-anchor-sft-pairs.jsonl"),
        );
        assert.equal(anchorRows.length, 1, "anchor JSONL should have 1 row");
        const row = anchorRows[0];
        assert.equal(row.label, "human_anchor", "anchor row label must be human_anchor");
        assert.equal(row.songId, "song-human-anchor");
        assert.ok(typeof row.instruction === "string" && row.instruction.length > 0, "instruction required");
        assert.ok(typeof row.output === "string" && row.output.startsWith("X:1"), "output must be ABC text");
        assert.equal(row.meta.eligibilitySource, "human_curated");
        assert.ok(Array.isArray(row.meta.criticRejectionReasons), "criticRejectionReasons must be present");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ── P2: confidence distribution in summary ──────────────────────────────────────

test("P2: summary.confidenceDistribution is present and has p50 when pairs exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-p2-"));
    try {
        seedSong(tmp, {
            songId: "song-dist",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
            structureEvaluation: PASSING_STRUCTURE_EVALUATION,
        });

        const summary = runExport(tmp);
        assert.equal(summary.ok, true);
        assert.equal(summary.totalPairs, 1);
        assert.ok(summary.confidenceDistribution !== null, "confidenceDistribution should be present");
        assert.ok(typeof summary.confidenceDistribution.p50 === "number", "p50 must be a number");
        assert.ok(typeof summary.confidenceDistribution.mean === "number", "mean must be a number");
        assert.ok(typeof summary.confidenceDistribution.p25 === "number", "p25 must be a number");
        assert.ok(typeof summary.confidenceDistribution.p75 === "number", "p75 must be a number");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ── SFT Tier classification in export rows ──────────────────────────────────────

test("SFT-TIER-01: exported row has sftTier and sampleWeight in meta", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-tier-"));
    try {
        seedSong(tmp, {
            songId: "song-tier",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
            structureEvaluation: PASSING_STRUCTURE_EVALUATION,
        });

        const summary = runExport(tmp);
        assert.equal(summary.ok, true);
        assert.equal(summary.totalPairs, 1);

        const rows = readJsonl(
            path.join(tmp, "_system", "ml", "notagen-sft", "2024-01-01", "sft-pairs.jsonl"),
        );
        const row = rows[0];
        assert.ok(row.meta.sftTier !== undefined, "meta.sftTier must be present");
        assert.ok(["gold", "silver", "bronze"].includes(row.meta.sftTier),
            `sftTier must be gold/silver/bronze, got ${row.meta.sftTier}`);
        assert.ok(typeof row.meta.sampleWeight === "number", "meta.sampleWeight must be a number");
        assert.ok(row.meta.sampleWeight > 0, "sampleWeight must be > 0 for eligible rows");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("SFT-TIER-02: gold scores produce sftTier=gold and sampleWeight=1.0", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-tier-gold-"));
    try {
        seedSong(tmp, {
            songId: "song-gold",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
            structureEvaluation: {
                passed: true,
                score: 0.95,
                craftScoreSummary: {
                    finalCraftScore:       0.84,
                    advancedCraftScore:    0.78,
                    harmonyContractScore:  0.83,
                    evidenceCoverageScore: 0.75,
                },
            },
        });

        const summary = runExport(tmp);
        assert.equal(summary.totalPairs, 1);
        assert.equal(summary.byTier?.gold, 1, "byTier.gold should be 1");
        assert.equal(summary.byTier?.silver, 0, "byTier.silver should be 0");

        const rows = readJsonl(
            path.join(tmp, "_system", "ml", "notagen-sft", "2024-01-01", "sft-pairs.jsonl"),
        );
        assert.equal(rows[0].meta.sftTier, "gold");
        assert.equal(rows[0].meta.sampleWeight, 1.0);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("SFT-TIER-03: bronze scores produce sftTier=bronze, sampleWeight=0.3, byTier.bronze=1", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-tier-bronze-"));
    try {
        seedSong(tmp, {
            songId: "song-bronze",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
            structureEvaluation: {
                passed: true,
                score: 0.72,
                craftScoreSummary: {
                    finalCraftScore:       0.72,   // passes base (0.70), fails silver (0.75)
                    advancedCraftScore:    0.63,   // passes base (0.60), fails silver (0.68)
                    harmonyContractScore:  0.74,
                    evidenceCoverageScore: 0.62,   // passes base (0.55), fails silver (0.70)
                },
            },
        });

        const summary = runExport(tmp);
        assert.equal(summary.totalPairs, 1);
        assert.equal(summary.byTier?.bronze, 1, "byTier.bronze should be 1");
        assert.equal(summary.byTier?.gold, 0);
        assert.equal(summary.byTier?.silver, 0);

        const rows = readJsonl(
            path.join(tmp, "_system", "ml", "notagen-sft", "2024-01-01", "sft-pairs.jsonl"),
        );
        assert.equal(rows[0].meta.sftTier, "bronze");
        assert.equal(rows[0].meta.sampleWeight, 0.3);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("SFT-TIER-04: summary.sftTierThresholds is present in summary.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sft-tier-summary-"));
    try {
        seedSong(tmp, {
            songId: "song-tier-s",
            decision: "approved",
            proposalEvidence: {
                worker: "learned_symbolic",
                generationMode: "notagen_abc_inference_hf_causal_lm",
                abcText: SAMPLE_ABC,
                providerRequest: SAMPLE_PROVIDER_REQUEST,
            },
            structureEvaluation: PASSING_STRUCTURE_EVALUATION,
        });

        const summary = runExport(tmp);
        assert.ok(summary.sftTierThresholds, "sftTierThresholds should be in summary");
        assert.ok(summary.sftTierThresholds.gold, "gold threshold block required");
        assert.ok(summary.sftTierThresholds.silver, "silver threshold block required");
        assert.equal(summary.sftTierThresholds.gold.finalCraftScore, 0.82);
        assert.equal(summary.sftTierThresholds.silver.finalCraftScore, 0.75);
        assert.ok(typeof summary.byTier === "object", "byTier counts must be present");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

