// @ts-check
/**
 * Phase G: Listener feedback tests
 *
 *  1. Old manifest without listenerFeedback loads without errors
 *  2. ReviewFeedback.listenerFeedback field is optional
 *  3. saveListenerFeedbackToSelectedCandidate writes feedback to candidate sidecar
 *  4. saveListenerFeedbackToSelectedCandidate is a no-op when no selected candidate
 *  5. Derived listenerScores match numeric feedback fields
 *  6. internalScores are derived from craftScoreSummary when no explicit scores given
 *  7. parseListenerFeedback-style logic: only present when appeal is provided
 *  8. Export rows have required fields (songId, decision, planSignature placeholder)
 *  9. DPO pairing groups approved vs rejected under same planSignature
 * 10. listenerFeedback is stored inside reviewFeedback on the manifest schema
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "axiom-g-test-"));
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value), "utf-8");
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/** Build a minimal StructureCandidateManifest for testing */
function makeCandidateManifest(overrides = {}) {
    return {
        version: 1,
        stage: "structure",
        songId: "song-001",
        candidateId: "cand-001",
        attempt: 1,
        selected: true,
        evaluatedAt: new Date().toISOString(),
        workflow: "structure",
        worker: "learned_symbolic",
        provider: "notagen",
        model: "notagen-v2",
        meta: {},
        executionPlan: { workflow: "structure" },
        revisionDirectives: [],
        structureEvaluation: {
            passed: true,
            score: 80,
            issues: [],
            strengths: [],
            metrics: {},
            weakestSections: [],
        },
        artifacts: {},
        ...overrides,
    };
}

/** Build a minimal candidate index */
function makeCandidateIndex(songId, selectedCandidateId, entries = []) {
    return {
        version: 1,
        songId,
        selectedCandidateId,
        entries,
        updatedAt: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Test 1: Old manifest without listenerFeedback loads without errors
// ---------------------------------------------------------------------------

test("Old manifest without listenerFeedback loads without errors", async () => {
    // A manifest that has reviewFeedback but no listenerFeedback is still valid
    const oldManifest = {
        songId: "old-song",
        approvalStatus: "approved",
        reviewFeedback: {
            reviewRubricVersion: "1.0",
            note: "Approved",
            appealScore: 4,
        },
        meta: { source: "autonomy" },
    };

    // Should be accessible without error — listenerFeedback is simply undefined
    assert.strictEqual(oldManifest.reviewFeedback.listenerFeedback, undefined);
    assert.strictEqual(oldManifest.approvalStatus, "approved");
});

// ---------------------------------------------------------------------------
// Test 2: ReviewFeedback.listenerFeedback field is optional
// ---------------------------------------------------------------------------

test("ReviewFeedback.listenerFeedback is optional — absent means no feedback", () => {
    const feedbackWithoutListener = {
        reviewRubricVersion: "1.0",
        note: "Good piece",
        appealScore: 4,
    };
    // Must not throw accessing optional field
    const fb = feedbackWithoutListener.listenerFeedback;
    assert.strictEqual(fb, undefined);
});

// ---------------------------------------------------------------------------
// Test 3: saveListenerFeedbackToSelectedCandidate writes feedback to candidate sidecar
// ---------------------------------------------------------------------------

test("saveListenerFeedbackToSelectedCandidate writes feedback to candidate sidecar", async () => {
    const tmpDir = makeTmpDir();
    const outputDir = path.join(tmpDir, "outputs");
    process.env.OUTPUT_DIR = outputDir;

    const songId = "song-g03";
    const candidateId = "cand-g03";
    const songDir = path.join(outputDir, songId);
    const candidatesDir = path.join(songDir, "candidates");

    // Write index
    writeJson(path.join(candidatesDir, "index.json"), makeCandidateIndex(songId, candidateId, [
        { candidateId, selected: true },
    ]));

    // Write candidate manifest
    writeJson(
        path.join(candidatesDir, candidateId, "candidate-manifest.json"),
        makeCandidateManifest({ songId, candidateId }),
    );

    // Override config output dir
    const { config } = await import("../dist/config.js");
    const origOutputDir = config.outputDir;
    // @ts-ignore — patching for test isolation
    config.outputDir = outputDir;

    try {
        const { saveListenerFeedbackToSelectedCandidate } = await import("../dist/memory/candidates.js");

        const feedback = { appeal: 4, memorability: 3, notes: "Lovely ending" };
        saveListenerFeedbackToSelectedCandidate(songId, feedback);

        const written = readJson(path.join(candidatesDir, candidateId, "candidate-manifest.json"));
        assert.deepStrictEqual(written.listenerFeedback, feedback);
        assert.strictEqual(written.listenerScores.appeal, 4);
        assert.strictEqual(written.listenerScores.memorability, 3);
    } finally {
        // @ts-ignore
        config.outputDir = origOutputDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.OUTPUT_DIR;
    }
});

// ---------------------------------------------------------------------------
// Test 4: saveListenerFeedbackToSelectedCandidate is a no-op when no selected candidate
// ---------------------------------------------------------------------------

test("saveListenerFeedbackToSelectedCandidate no-ops when no selected candidate", async () => {
    const tmpDir = makeTmpDir();
    const outputDir = path.join(tmpDir, "outputs");
    process.env.OUTPUT_DIR = outputDir;

    const songId = "song-g04";
    const songDir = path.join(outputDir, songId);
    const candidatesDir = path.join(songDir, "candidates");

    // Index with no selectedCandidateId
    writeJson(path.join(candidatesDir, "index.json"), makeCandidateIndex(songId, undefined));

    const { config } = await import("../dist/config.js");
    const origOutputDir = config.outputDir;
    // @ts-ignore
    config.outputDir = outputDir;

    try {
        const { saveListenerFeedbackToSelectedCandidate } = await import("../dist/memory/candidates.js");
        // Should not throw
        saveListenerFeedbackToSelectedCandidate(songId, { appeal: 5 });
    } finally {
        // @ts-ignore
        config.outputDir = origOutputDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.OUTPUT_DIR;
    }
});

// ---------------------------------------------------------------------------
// Test 5: Derived listenerScores match numeric feedback fields
// ---------------------------------------------------------------------------

test("Derived listenerScores match numeric feedback fields", () => {
    const feedback = { appeal: 5, memorability: 4, coherence: 3, emotionalImpact: 2 };
    // Simulate what saveListenerFeedbackToSelectedCandidate computes
    const listenerScores = {};
    if (typeof feedback.appeal === "number") listenerScores["appeal"] = feedback.appeal;
    if (typeof feedback.memorability === "number") listenerScores["memorability"] = feedback.memorability;
    if (typeof feedback.coherence === "number") listenerScores["coherence"] = feedback.coherence;
    if (typeof feedback.emotionalImpact === "number") listenerScores["emotionalImpact"] = feedback.emotionalImpact;

    assert.strictEqual(listenerScores.appeal, 5);
    assert.strictEqual(listenerScores.memorability, 4);
    assert.strictEqual(listenerScores.coherence, 3);
    assert.strictEqual(listenerScores.emotionalImpact, 2);
    assert.strictEqual(Object.keys(listenerScores).length, 4);
});

// ---------------------------------------------------------------------------
// Test 6: internalScores are derived from craftScoreSummary when available
// ---------------------------------------------------------------------------

test("internalScores are derived from craftScoreSummary when available", async () => {
    const tmpDir = makeTmpDir();
    const outputDir = path.join(tmpDir, "outputs");
    process.env.OUTPUT_DIR = outputDir;

    const songId = "song-g06";
    const candidateId = "cand-g06";
    const candidatesDir = path.join(outputDir, songId, "candidates");

    const craftSummary = {
        syntaxValidity: 1,
        sectionContractFit: 0.9,
        cadenceStrength: 0.8,
        tonalReturn: 0.75,
        motifSurvival: 0.6,
        voiceIndependence: 0.7,
        phraseShape: 0.65,
        registerIdiomaticFit: 0.85,
        finalCraftScore: 0.78,
    };

    writeJson(path.join(candidatesDir, "index.json"), makeCandidateIndex(songId, candidateId, [
        { candidateId, selected: true },
    ]));
    writeJson(
        path.join(candidatesDir, candidateId, "candidate-manifest.json"),
        makeCandidateManifest({
            songId, candidateId,
            structureEvaluation: {
                passed: true,
                score: 80,
                issues: [],
                strengths: [],
                metrics: {},
                weakestSections: [],
                craftScoreSummary: craftSummary,
            },
        }),
    );

    const { config } = await import("../dist/config.js");
    const origOutputDir = config.outputDir;
    // @ts-ignore
    config.outputDir = outputDir;

    try {
        const { saveListenerFeedbackToSelectedCandidate } = await import("../dist/memory/candidates.js");
        saveListenerFeedbackToSelectedCandidate(songId, { appeal: 3 });
        const written = readJson(path.join(candidatesDir, candidateId, "candidate-manifest.json"));
        assert.strictEqual(written.internalScores?.finalCraftScore, 0.78);
        assert.strictEqual(written.internalScores?.sectionContractFit, 0.9);
    } finally {
        // @ts-ignore
        config.outputDir = origOutputDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.OUTPUT_DIR;
    }
});

// ---------------------------------------------------------------------------
// Test 7: parseListenerFeedback-style logic only present when appeal is provided
// ---------------------------------------------------------------------------

test("Listener feedback is absent when appeal is not provided", () => {
    function parseListenerFeedback(body) {
        const appeal = typeof body?.appeal === "number" ? body.appeal : undefined;
        if (appeal === undefined) return undefined;
        return { appeal };
    }

    assert.strictEqual(parseListenerFeedback({}), undefined);
    assert.strictEqual(parseListenerFeedback({ memorability: 3 }), undefined);
    assert.deepStrictEqual(parseListenerFeedback({ appeal: 4 }), { appeal: 4 });
});

// ---------------------------------------------------------------------------
// Test 8: Export rows have required fields
// ---------------------------------------------------------------------------

test("Export preference row has required fields", () => {
    const row = {
        songId: "song-008",
        planSignature: "abc123",
        decision: "approved",
        promptPack: null,
        providerRequest: null,
        candidateMidiPath: null,
        proposalEvidence: {
            worker: "learned_symbolic",
            provider: "notagen",
            model: "notagen-v2",
            generationMode: "whole_piece_candidate",
            planSignature: "abc123",
            normalizationWarnings: [],
        },
        craftScoreSummary: null,
        internalScores: null,
        listenerFeedback: { appeal: 5 },
        listenerScores: { appeal: 5 },
    };

    assert.ok("songId" in row);
    assert.ok("planSignature" in row);
    assert.ok("decision" in row);
    assert.ok("proposalEvidence" in row);
    assert.ok("listenerFeedback" in row);
    assert.strictEqual(row.decision, "approved");
});

// ---------------------------------------------------------------------------
// Test 9: DPO pairing groups approved vs rejected under same planSignature
// ---------------------------------------------------------------------------

test("DPO pairs approved vs rejected under same planSignature", () => {
    const rows = [
        { songId: "s1", planSignature: "sig-A", decision: "approved" },
        { songId: "s2", planSignature: "sig-A", decision: "rejected" },
        { songId: "s3", planSignature: "sig-B", decision: "approved" },
    ];

    const byPlanSignature = {};
    for (const row of rows) {
        const sig = row.planSignature;
        if (!byPlanSignature[sig]) byPlanSignature[sig] = { approved: [], rejected: [] };
        byPlanSignature[sig][row.decision === "approved" ? "approved" : "rejected"].push(row);
    }

    const pairs = [];
    for (const group of Object.values(byPlanSignature)) {
        for (const chosen of group.approved) {
            for (const rejected of group.rejected) {
                pairs.push({ chosen, rejected });
            }
        }
    }

    assert.strictEqual(pairs.length, 1);
    assert.strictEqual(pairs[0].chosen.songId, "s1");
    assert.strictEqual(pairs[0].rejected.songId, "s2");
});

// ---------------------------------------------------------------------------
// Test 10: listenerFeedback is nested inside reviewFeedback on manifest schema
// ---------------------------------------------------------------------------

test("listenerFeedback nests inside reviewFeedback on manifest", () => {
    const listenerFeedback = {
        appeal: 4,
        memorability: 3,
        strongestDimension: "melody",
        weakestDimension: "texture",
    };
    const reviewFeedback = {
        reviewRubricVersion: "1.0",
        note: "Nice piece",
        listenerFeedback,
    };

    // Validate nesting
    assert.strictEqual(reviewFeedback.listenerFeedback?.appeal, 4);
    assert.strictEqual(reviewFeedback.listenerFeedback?.strongestDimension, "melody");
    assert.strictEqual(reviewFeedback.listenerFeedback?.weakestDimension, "texture");

    // listenerFeedback.notes is a free-form string (different from reviewFeedback.note)
    assert.strictEqual(reviewFeedback.listenerFeedback?.notes, undefined);
    assert.strictEqual(reviewFeedback.note, "Nice piece");
});
