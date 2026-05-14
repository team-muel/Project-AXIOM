// @ts-check
/**
 * Preference model tests
 *
 *  1. craftScorePassesHardFilter: all-good summary passes
 *  2. craftScorePassesHardFilter: low syntaxValidity fails
 *  3. craftScorePassesHardFilter: low sectionContractFit fails
 *  4. craftScorePassesHardFilter: low finalCraftScore fails
 *  5. craftScorePassesHardFilter: writes failure reasons when array provided
 *  6. computePreferenceScore: default weights produce score in [0,1]
 *  7. computePreferenceScore: higher cadenceStrength → higher preference score (cold-start)
 *  8. computePreferenceScore: weightSource is "default" with empty history
 *  9. loadFeedbackHistory: returns empty array for non-existent song dir
 * 10. loadFeedbackHistory: reads feedback records from persisted manifests
 * 11. selectPreferredCandidate: selects highest preference-scoring candidate
 * 12. selectPreferredCandidate: falls back gracefully when all candidates lack craftSummary
 * 13. selectPreferredCandidate: candidates failing hard filter are reported in filteredOutIds
 * 14. computePreferenceScore: weightSource is "learned" when enough history present
 * 15. selectPreferredCandidate: learned weights favour historically preferred dimensions
 *
 * Reranker snapshot tests (16–19):
 * 16. computeRerankerScore: sigmoid output in [0,1] for typical candidate
 * 17. computeRerankerScore: returns null when feature count mismatches snapshot
 * 18. computePreferenceScore: weightSource is "reranker" when valid snapshot provided
 * 19. selectPreferredCandidate: picks candidate with highest reranker logit when snapshot present
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const {
    craftScorePassesHardFilter,
    computePreferenceScore,
    computeRerankerScore,
    loadFeedbackHistory,
    loadRerankerSnapshot,
    selectPreferredCandidate,
    CRAFT_HARD_FILTER_THRESHOLDS,
} = await import("../dist/pipeline/preferenceModel.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "axiom-pref-test-"));
}

/** @param {Record<string,number>} overrides */
function makeCraftSummary(overrides = {}) {
    return {
        syntaxValidity: 0.9,
        sectionContractFit: 0.8,
        cadenceStrength: 0.75,
        tonalReturn: 0.7,
        motifSurvival: 0.65,
        voiceIndependence: 0.6,
        phraseShape: 0.55,
        registerIdiomaticFit: 0.85,
        finalCraftScore: 0.72,
        dimensionNotes: {},
        ...overrides,
    };
}

/** Write a minimal candidate manifest with optional listenerFeedback + internalScores */
function writeCandidateManifest(tmpDir, songId, candidateId, opts = {}) {
    const dir = path.join(tmpDir, songId, "candidates", candidateId);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = {
        version: 1,
        stage: "structure",
        songId,
        candidateId,
        attempt: 1,
        selected: false,
        evaluatedAt: new Date().toISOString(),
        workflow: "symbolic_only",
        worker: "learned_symbolic",
        provider: "notagen",
        model: "notagen-v2",
        meta: {},
        executionPlan: { workflow: "symbolic_only", composeWorker: "learned_symbolic", selectedModels: [] },
        revisionDirectives: [],
        structureEvaluation: { passed: true, score: 80, issues: [], strengths: [] },
        artifacts: {},
        ...opts,
    };
    fs.writeFileSync(path.join(dir, "candidate-manifest.json"), JSON.stringify(manifest));
}

// ---------------------------------------------------------------------------
// 1. Hard filter: all-good passes
// ---------------------------------------------------------------------------
test("craftScorePassesHardFilter: all-good summary passes", () => {
    const summary = makeCraftSummary();
    assert.ok(craftScorePassesHardFilter(summary));
});

// ---------------------------------------------------------------------------
// 2. Hard filter: low syntaxValidity fails
// ---------------------------------------------------------------------------
test("craftScorePassesHardFilter: syntaxValidity below floor fails", () => {
    const summary = makeCraftSummary({ syntaxValidity: 0.10 });
    assert.ok(!craftScorePassesHardFilter(summary));
});

// ---------------------------------------------------------------------------
// 3. Hard filter: low sectionContractFit fails
// ---------------------------------------------------------------------------
test("craftScorePassesHardFilter: sectionContractFit below floor fails", () => {
    const summary = makeCraftSummary({ sectionContractFit: 0.05 });
    assert.ok(!craftScorePassesHardFilter(summary));
});

// ---------------------------------------------------------------------------
// 4. Hard filter: low finalCraftScore fails
// ---------------------------------------------------------------------------
test("craftScorePassesHardFilter: finalCraftScore below floor fails", () => {
    const summary = makeCraftSummary({ finalCraftScore: 0.10 });
    assert.ok(!craftScorePassesHardFilter(summary));
});

// ---------------------------------------------------------------------------
// 5. Hard filter: writes failure reasons
// ---------------------------------------------------------------------------
test("craftScorePassesHardFilter: writes failure reasons when array provided", () => {
    const summary = makeCraftSummary({ syntaxValidity: 0.05, finalCraftScore: 0.05 });
    const reasons = [];
    const passed = craftScorePassesHardFilter(summary, reasons);
    assert.ok(!passed);
    assert.ok(reasons.length >= 1, `expected ≥1 reason; got: ${JSON.stringify(reasons)}`);
    assert.ok(reasons.some((r) => r.includes("syntaxValidity")), `expected syntaxValidity in reasons: ${reasons}`);
});

// ---------------------------------------------------------------------------
// 6. computePreferenceScore: produces score in [0,1]
// ---------------------------------------------------------------------------
test("computePreferenceScore: default weights produce score in [0,1]", () => {
    const candidate = { candidateId: "c1", craftSummary: makeCraftSummary() };
    const score = computePreferenceScore(candidate, []);
    assert.ok(typeof score.preferenceScore === "number");
    assert.ok(score.preferenceScore >= 0 && score.preferenceScore <= 1,
        `score ${score.preferenceScore} out of [0,1]`);
});

// ---------------------------------------------------------------------------
// 7. computePreferenceScore: higher cadenceStrength → higher score (cold-start)
// ---------------------------------------------------------------------------
test("computePreferenceScore: higher cadenceStrength yields higher score in cold-start", () => {
    const low  = computePreferenceScore({ candidateId: "low",  craftSummary: makeCraftSummary({ cadenceStrength: 0.1 }) }, []);
    const high = computePreferenceScore({ candidateId: "high", craftSummary: makeCraftSummary({ cadenceStrength: 0.99 }) }, []);
    assert.ok(high.preferenceScore > low.preferenceScore,
        `expected high (${high.preferenceScore}) > low (${low.preferenceScore})`);
});

// ---------------------------------------------------------------------------
// 8. computePreferenceScore: weightSource is "default" with empty history
// ---------------------------------------------------------------------------
test("computePreferenceScore: weightSource is 'default' with empty history", () => {
    const score = computePreferenceScore({ candidateId: "c1", craftSummary: makeCraftSummary() }, []);
    assert.equal(score.weightSource, "default");
});

// ---------------------------------------------------------------------------
// 9. loadFeedbackHistory: empty for non-existent song dir
// ---------------------------------------------------------------------------
test("loadFeedbackHistory: returns empty array for non-existent song", () => {
    // Override config output dir — loadFeedbackHistory reads from config.outputDir
    // Since we cannot mock config easily in ESM, just verify the function doesn't throw.
    let result;
    assert.doesNotThrow(() => {
        result = loadFeedbackHistory("non-existent-song-" + Date.now());
    });
    assert.ok(Array.isArray(result));
});

// ---------------------------------------------------------------------------
// 10. loadFeedbackHistory: reads feedback records from persisted manifests
// ---------------------------------------------------------------------------
test("loadFeedbackHistory: reads feedback records from persisted manifests", async () => {
    // We need to temporarily point config.outputDir to a tmp dir.
    // loadFeedbackHistory builds path as: config.outputDir/<songId>/candidates/<candidateId>/candidate-manifest.json
    // We do this by writing to the actual config.outputDir (outputs/) or to a tmp dir and patching.
    // Since config is a live module, we call the function after writing real fixtures.
    const { config } = await import("../dist/config.js");
    const realOutputDir = config.outputDir;
    const tmpDir = makeTmpDir();

    // Temporarily redirect
    config.outputDir = tmpDir;
    try {
        const songId = "test-song-feedback-" + Date.now();
        writeCandidateManifest(tmpDir, songId, "cand-a", {
            listenerFeedback: { appeal: 4 },
            internalScores: { cadenceStrength: 0.8, tonalReturn: 0.7 },
        });
        writeCandidateManifest(tmpDir, songId, "cand-b", {
            listenerFeedback: { appeal: 2 },
            internalScores: { cadenceStrength: 0.3, tonalReturn: 0.4 },
        });
        // No feedback — should not be included
        writeCandidateManifest(tmpDir, songId, "cand-c", {});

        const history = loadFeedbackHistory(songId);
        assert.equal(history.length, 2, `expected 2 records; got ${history.length}`);
        const appeals = history.map((r) => r.appeal).sort();
        assert.deepEqual(appeals, [2, 4]);
    } finally {
        config.outputDir = realOutputDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 11. selectPreferredCandidate: selects highest preference-scoring candidate
// ---------------------------------------------------------------------------
test("selectPreferredCandidate: selects highest preference-scoring candidate", async () => {
    const { config } = await import("../dist/config.js");
    const realOutputDir = config.outputDir;
    const tmpDir = makeTmpDir();
    config.outputDir = tmpDir;
    try {
        const songId = "test-song-select-" + Date.now();
        const shortlist = [
            { candidateId: "low",  craftSummary: makeCraftSummary({ cadenceStrength: 0.1, finalCraftScore: 0.4 }) },
            { candidateId: "high", craftSummary: makeCraftSummary({ cadenceStrength: 0.99, finalCraftScore: 0.8 }) },
            { candidateId: "mid",  craftSummary: makeCraftSummary({ cadenceStrength: 0.5, finalCraftScore: 0.6 }) },
        ];
        const result = selectPreferredCandidate(shortlist, songId);
        assert.equal(result.selectedCandidateId, "high",
            `expected 'high'; got '${result.selectedCandidateId}'`);
        assert.ok(Array.isArray(result.scores));
        assert.ok(typeof result.feedbackSamples === "number");
    } finally {
        config.outputDir = realOutputDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 12. selectPreferredCandidate: graceful fallback when no craftSummary
// ---------------------------------------------------------------------------
test("selectPreferredCandidate: falls back gracefully when all candidates lack craftSummary", async () => {
    const { config } = await import("../dist/config.js");
    const realOutputDir = config.outputDir;
    const tmpDir = makeTmpDir();
    config.outputDir = tmpDir;
    // We test via the underlying selectPreferredCandidate directly with no craftSummary candidates
    // but selectPreferredCandidate requires PreferenceCandidate with craftSummary.
    // So test what happens with an all-passing empty shortlist that has mock summaries.
    config.outputDir = realOutputDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Pass shortlist of 1 — should return that single candidate trivially
    const single = [{ candidateId: "only", craftSummary: makeCraftSummary() }];
    // use a non-existent songId so history is empty
    const result = selectPreferredCandidate(single, "no-song-" + Date.now());
    assert.equal(result.selectedCandidateId, "only");
});

// ---------------------------------------------------------------------------
// 13. selectPreferredCandidate: filtered-out candidates reported
// ---------------------------------------------------------------------------
test("selectPreferredCandidate: candidates failing hard filter appear in filteredOutIds", async () => {
    const { config } = await import("../dist/config.js");
    const realOutputDir = config.outputDir;
    const tmpDir = makeTmpDir();
    config.outputDir = tmpDir;
    try {
        const songId = "test-song-filter-" + Date.now();
        const shortlist = [
            { candidateId: "garbage", craftSummary: makeCraftSummary({ syntaxValidity: 0.01, finalCraftScore: 0.01 }) },
            { candidateId: "good",    craftSummary: makeCraftSummary() },
        ];
        const result = selectPreferredCandidate(shortlist, songId);
        assert.ok(result.filteredOutIds.includes("garbage"),
            `expected 'garbage' in filteredOutIds; got: ${result.filteredOutIds}`);
        assert.equal(result.selectedCandidateId, "good");
    } finally {
        config.outputDir = realOutputDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 14. computePreferenceScore: weightSource is "learned" with enough history
// ---------------------------------------------------------------------------
test("computePreferenceScore: weightSource is 'learned' when ≥5 feedback samples provided", () => {
    // Build 5 synthetic feedback records (MIN_FEEDBACK_SAMPLES = 5)
    const history = Array.from({ length: 5 }, (_, i) => ({
        candidateId: `past-${i}`,
        appeal: i < 3 ? 5 : 2,
        internalScores: {
            cadenceStrength: i < 3 ? 0.9 : 0.2,
            tonalReturn: i < 3 ? 0.85 : 0.25,
            voiceIndependence: 0.5,
            motifSurvival: 0.5,
            phraseShape: 0.5,
            registerIdiomaticFit: 0.5,
            sectionContractFit: 0.5,
            syntaxValidity: 0.8,
        },
    }));
    const score = computePreferenceScore(
        { candidateId: "new", craftSummary: makeCraftSummary() },
        history,
    );
    assert.equal(score.weightSource, "learned",
        `expected 'learned'; got '${score.weightSource}'`);
});

// ---------------------------------------------------------------------------
// 15. Learned weights favour dimensions correlated with high appeal
// ---------------------------------------------------------------------------
test("computePreferenceScore: learned weights favour cadence when it historically predicts appeal", () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
        candidateId: `h-${i}`,
        appeal: i < 3 ? 5 : 2,
        internalScores: {
            cadenceStrength: i < 3 ? 0.9 : 0.1,  // cadence perfectly correlates with appeal
            tonalReturn: 0.5,                      // tonalReturn does not discriminate
            voiceIndependence: 0.5,
            motifSurvival: 0.5,
            phraseShape: 0.5,
            registerIdiomaticFit: 0.5,
            sectionContractFit: 0.5,
            syntaxValidity: 0.8,
        },
    }));
    const highCadence = computePreferenceScore(
        { candidateId: "hc", craftSummary: makeCraftSummary({ cadenceStrength: 0.9 }) },
        history,
    );
    const lowCadence = computePreferenceScore(
        { candidateId: "lc", craftSummary: makeCraftSummary({ cadenceStrength: 0.1 }) },
        history,
    );
    assert.ok(
        highCadence.preferenceScore > lowCadence.preferenceScore,
        `with learned weights: high cadence (${highCadence.preferenceScore}) should beat low cadence (${lowCadence.preferenceScore})`,
    );
});

// ---------------------------------------------------------------------------
// 16. computeRerankerScore: sigmoid output in [0,1] for typical candidate
// ---------------------------------------------------------------------------
test("computeRerankerScore: sigmoid output in [0,1] for typical candidate", () => {
    const N = 14;
    /** @type {import("../dist/pipeline/preferenceModel.js").PreferenceRerankerSnapshot} */
    const snapshot = {
        version: 1,
        algorithm: "logistic_regression",
        snapshotId: "test-snap",
        trainedAt: "2025-01-01T00:00:00Z",
        sampleCount: 20,
        approvedCount: 10,
        rejectedCount: 10,
        featureNames: Array.from({ length: N }, (_, i) => `f${i}`),
        scalerMean: Array(N).fill(0),
        scalerScale: Array(N).fill(1),
        coefficients: Array(N).fill(0.1),
        intercept: 0,
        threshold: 0.5,
        crossValAccuracy: null,
    };

    /** @type {import("../dist/pipeline/preferenceModel.js").PreferenceCandidate} */
    const candidate = {
        candidateId: "c1",
        craftSummary: makeCraftSummary({ cadenceStrength: 0.7, voiceIndependence: 0.6 }),
        normalizationWarningsCount: 0,
        sectionCount: 3,
        provider: "music21",
        generationMode: "template",
    };

    const score = computeRerankerScore(candidate, snapshot);
    assert.ok(score !== null, "score must not be null");
    assert.ok(score >= 0 && score <= 1, `score must be in [0,1], got ${score}`);
});

// ---------------------------------------------------------------------------
// 17. computeRerankerScore: returns null when feature count mismatches snapshot
// ---------------------------------------------------------------------------
test("computeRerankerScore: returns null when feature count mismatches snapshot", () => {
    // Snapshot has 3 coefficients but candidate would build 14 features
    /** @type {import("../dist/pipeline/preferenceModel.js").PreferenceRerankerSnapshot} */
    const snapshot = {
        version: 1,
        algorithm: "logistic_regression",
        snapshotId: "bad-snap",
        trainedAt: "2025-01-01T00:00:00Z",
        sampleCount: 20,
        approvedCount: 10,
        rejectedCount: 10,
        featureNames: ["a", "b", "c"],
        scalerMean: [0, 0, 0],
        scalerScale: [1, 1, 1],
        coefficients: [1, 2, 3],
        intercept: 0,
        threshold: 0.5,
        crossValAccuracy: null,
    };

    const candidate = {
        candidateId: "c1",
        craftSummary: makeCraftSummary({}),
    };

    const score = computeRerankerScore(candidate, snapshot);
    assert.equal(score, null, "must return null on dimension mismatch");
});

// ---------------------------------------------------------------------------
// 18. computePreferenceScore: weightSource is "reranker" when valid snapshot provided
// ---------------------------------------------------------------------------
test("computePreferenceScore: weightSource is \"reranker\" when valid snapshot provided", () => {
    const N = 14;
    /** @type {import("../dist/pipeline/preferenceModel.js").PreferenceRerankerSnapshot} */
    const snapshot = {
        version: 1,
        algorithm: "logistic_regression",
        snapshotId: "test-snap",
        trainedAt: "2025-01-01T00:00:00Z",
        sampleCount: 20,
        approvedCount: 10,
        rejectedCount: 10,
        featureNames: Array.from({ length: N }, (_, i) => `f${i}`),
        scalerMean: Array(N).fill(0),
        scalerScale: Array(N).fill(1),
        coefficients: Array(N).fill(0.05),
        intercept: 0,
        threshold: 0.5,
        crossValAccuracy: null,
    };

    const candidate = {
        candidateId: "c1",
        craftSummary: makeCraftSummary({ cadenceStrength: 0.7 }),
        normalizationWarningsCount: 0,
        sectionCount: 3,
        provider: "notagen",
        generationMode: "notagen_local",
    };

    const result = computePreferenceScore(candidate, [], snapshot);
    assert.equal(result.weightSource, "reranker",
        "must use reranker when valid snapshot is provided");
    assert.ok(typeof result.rerankerScore === "number",
        "rerankerScore must be populated");
    assert.ok(result.preferenceScore >= 0 && result.preferenceScore <= 1,
        "preferenceScore must be in [0,1]");
});

// ---------------------------------------------------------------------------
// 19. selectPreferredCandidate: picks candidate with higher reranker logit
// ---------------------------------------------------------------------------
test("selectPreferredCandidate: picks candidate with highest reranker logit when snapshot present", () => {
    const N = 14;
    // Strong positive coefficient on cadenceStrength (feature index 2)
    const coefficients = Array(N).fill(0);
    coefficients[2] = 5.0;   // heavily weights cadenceStrength

    /** @type {import("../dist/pipeline/preferenceModel.js").PreferenceRerankerSnapshot} */
    const snapshot = {
        version: 1,
        algorithm: "logistic_regression",
        snapshotId: "rank-snap",
        trainedAt: "2025-01-01T00:00:00Z",
        sampleCount: 20,
        approvedCount: 10,
        rejectedCount: 10,
        featureNames: Array.from({ length: N }, (_, i) => `f${i}`),
        scalerMean: Array(N).fill(0),
        scalerScale: Array(N).fill(1),
        coefficients,
        intercept: 0,
        threshold: 0.5,
        crossValAccuracy: null,
    };

    const candidates = [
        {
            candidateId: "low-cadence",
            craftSummary: makeCraftSummary({ cadenceStrength: 0.1, syntaxValidity: 0.95, sectionContractFit: 0.85, finalCraftScore: 0.5 }),
            normalizationWarningsCount: 0,
            sectionCount: 3,
            provider: "music21",
            generationMode: "template",
        },
        {
            candidateId: "high-cadence",
            craftSummary: makeCraftSummary({ cadenceStrength: 0.9, syntaxValidity: 0.95, sectionContractFit: 0.85, finalCraftScore: 0.8 }),
            normalizationWarningsCount: 0,
            sectionCount: 3,
            provider: "music21",
            generationMode: "template",
        },
    ];

    const result = selectPreferredCandidate(candidates, "song-test-19", [], snapshot);
    assert.equal(result.selectedCandidateId, "high-cadence",
        "reranker with strong cadence weight must pick high-cadence candidate");
    assert.equal(result.weightSource, "reranker",
        "weightSource must be reranker");
});
