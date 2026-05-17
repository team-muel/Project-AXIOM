/**
 * scoring-profile.test.mjs
 *
 * Validates:
 *   1. Built-in profile weights sum to 1.00.
 *   2. loadScoringProfile reads + validates a JSON file on disk.
 *   3. Passing a custom profile to computeCraftScoreSummary changes the formula output.
 *   4. Passing a custom profile to computePianoListenabilityScore stamps the profile name.
 *   5. QUALITY_GATE_V1 built-in + loadQualityGateConfig + wiring into gates.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

import {
    CLASSICAL_DEFAULT_V1,
    PIANO_LISTENABILITY_V1,
    QUALITY_GATE_V1,
    validateProfileWeights,
    validateQualityGateConfig,
    loadScoringProfile,
    loadQualityGateConfig,
} from "../dist/core/evaluate/scoringProfile.js";
import { computeCraftScoreSummary } from "../dist/core/evaluate/craftScoring.js";
import { computePianoListenabilityScore } from "../dist/core/evaluate/pianoCraftScoring.js";
import { craftScorePassesHardFilter } from "../dist/core/generate/preferenceModel.js";
import { pianoPlayabilityGate } from "../dist/core/evaluate/pianoCraftScoring.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sumWeights(weights) {
    return Object.values(weights).reduce((a, b) => a + b, 0);
}

const EMPTY_EVAL = { passed: true, score: 1, issues: [], strengths: [] };

function makeSectionArtifact(overrides = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measuresCount: 8,
        melodyEvents: [],
        accompanimentEvents: [],
        ...overrides,
    };
}

// ─── Built-in profile validation ─────────────────────────────────────────────

test("SP-01: CLASSICAL_DEFAULT_V1 weights sum to 1.00", () => {
    const sum = sumWeights(CLASSICAL_DEFAULT_V1.weights);
    assert.ok(
        Math.abs(sum - 1.0) <= 0.005,
        `Expected sum ≈ 1.00, got ${sum.toFixed(4)}`,
    );
});

test("SP-02: PIANO_LISTENABILITY_V1 weights sum to 1.00", () => {
    const sum = sumWeights(PIANO_LISTENABILITY_V1.weights);
    assert.ok(
        Math.abs(sum - 1.0) <= 0.005,
        `Expected sum ≈ 1.00, got ${sum.toFixed(4)}`,
    );
});

test("SP-03: validateProfileWeights throws on weights that do not sum to 1", () => {
    const bad = {
        profile: "bad_v0",
        status: "experimental",
        weights: { a: 0.5, b: 0.3 }, // sum = 0.8
    };
    assert.throws(() => validateProfileWeights(bad), /weights sum to/);
});

// ─── JSON file loading ────────────────────────────────────────────────────────

test("SP-04: loadScoringProfile reads classical_default_v1.json correctly", () => {
    const p = loadScoringProfile(
        path.join(ROOT, "config/scoring-profiles/classical_default_v1.json"),
    );
    assert.equal(p.profile, "classical_default_v1");
    assert.deepEqual(p.weights, CLASSICAL_DEFAULT_V1.weights);
});

test("SP-05: loadScoringProfile reads piano_listenability_v1.json correctly", () => {
    const p = loadScoringProfile(
        path.join(ROOT, "config/scoring-profiles/piano_listenability_v1.json"),
    );
    assert.equal(p.profile, "piano_listenability_v1");
    assert.deepEqual(p.weights, PIANO_LISTENABILITY_V1.weights);
});

// ─── Profile wired into evaluators ───────────────────────────────────────────

test("SP-06: computeCraftScoreSummary stamps scoringProfile in result", () => {
    const arts = [makeSectionArtifact()];
    const result = computeCraftScoreSummary(arts, undefined, EMPTY_EVAL);
    assert.equal(result.scoringProfile, "classical_default_v1");
});

test("SP-07: computeCraftScoreSummary with custom profile stamps custom profile name", () => {
    const customProfile = {
        profile: "test_equal_v0",
        status: "experimental",
        weights: {
            sectionContractFit:   0.125,
            cadenceStrength:      0.125,
            tonalReturn:          0.125,
            motifSurvival:        0.125,
            voiceIndependence:    0.125,
            phraseShape:          0.125,
            registerIdiomaticFit: 0.125,
            syntaxValidity:       0.125,
        },
    };
    const arts = [makeSectionArtifact()];
    const result = computeCraftScoreSummary(arts, undefined, EMPTY_EVAL, customProfile);
    assert.equal(result.scoringProfile, "test_equal_v0");
});

test("SP-08: computePianoListenabilityScore stamps scoringProfile = piano_listenability_v1 by default", () => {
    const arts = [makeSectionArtifact()];
    const result = computePianoListenabilityScore(arts);
    assert.equal(result.scoringProfile, "piano_listenability_v1");
});

test("SP-09: computePianoListenabilityScore with custom profile stamps custom name", () => {
    const customProfile = {
        profile: "piano_melody_heavy_v2",
        status: "experimental",
        weights: {
            melodyProminence:         0.30,
            bassRootSupport:          0.15,
            accompanimentConsistency: 0.15,
            registerSpacing:          0.15,
            phraseLevelVoicing:       0.10,
            pedalBlurRisk:            0.10,
            textureFormCoherence:     0.05,
        },
    };
    const arts = [makeSectionArtifact()];
    const result = computePianoListenabilityScore(arts, undefined, customProfile);
    assert.equal(result.scoringProfile, "piano_melody_heavy_v2");
});

// ─── Quality gate config ──────────────────────────────────────────────────────

test("SP-10: QUALITY_GATE_V1 has all required threshold fields in [0,1]", () => {
    const t = QUALITY_GATE_V1.thresholds;
    assert.ok(typeof t.syntaxValidityMin === "number");
    assert.ok(typeof t.sectionContractFitMin === "number");
    assert.ok(typeof t.pianoPlayabilityMin === "number");
    assert.ok(typeof t.finalCraftScoreMin === "number");
    for (const [k, v] of Object.entries(t)) {
        assert.ok(v >= 0 && v <= 1, `threshold "${k}" = ${v} not in [0,1]`);
    }
});

test("SP-11: loadQualityGateConfig reads quality_gate_v1.json correctly", () => {
    const cfg = loadQualityGateConfig(
        path.join(ROOT, "config/scoring-profiles/quality_gate_v1.json"),
    );
    assert.equal(cfg.profile, "quality_gate_v1");
    assert.deepEqual(cfg.thresholds, QUALITY_GATE_V1.thresholds);
});

test("SP-12: validateQualityGateConfig throws when a threshold is out of [0,1]", () => {
    const bad = {
        profile: "bad_gate_v0",
        status: "experimental",
        thresholds: { syntaxValidityMin: 1.5 },
    };
    assert.throws(() => validateQualityGateConfig(bad), /out of \[0, 1\]/);
});

test("SP-13: craftScorePassesHardFilter uses qualityGate thresholds when supplied", () => {
    // Craft score with syntaxValidity = 0.80 passes the built-in floor (0.25)
    // but fails if the gate raises it to 0.90.
    const craft = {
        finalCraftScore: 0.70,
        syntaxValidity: 0.80,
        sectionContractFit: 0.80,
        cadenceStrength: 0.7, tonalReturn: 0.7, motifSurvival: 0.7,
        voiceIndependence: 0.7, phraseShape: 0.7, registerIdiomaticFit: 0.7,
        advancedCraftScore: 0.7, dimensionNotes: [],
    };

    // Without gate: passes (built-in syntaxValidity floor = 0.25)
    assert.ok(craftScorePassesHardFilter(craft));

    // With QUALITY_GATE_V1 (syntaxValidityMin = 0.90): fails
    const reasons = [];
    assert.ok(!craftScorePassesHardFilter(craft, reasons, QUALITY_GATE_V1));
    assert.ok(reasons.some((r) => r.includes("syntaxValidity")));
});

import {
    candidateGateTier,
    compareStructureEvaluationsForCandidateSelection,
} from "../dist/core/generate/structureSelection.js";
import {
    selectAttemptWinner,
    chooseBetterSymbolicCandidate,
} from "../dist/runtime/attempts/candidateSelection.js";

// SP-14 restored
test("SP-14: pianoPlayabilityGate uses qualityGate.pianoPlayabilityMin when supplied", () => {
    const artifacts = [
        { sectionId: "s1", role: "theme_a", pianoPlayabilityScore: 0.60 },
    ];
    const highGate = {
        profile: "strict_piano_v0",
        status: "experimental",
        thresholds: {
            syntaxValidityMin: 0.90,
            sectionContractFitMin: 0.75,
            pianoPlayabilityMin: 0.70,
            finalCraftScoreMin: 0.65,
        },
    };
    assert.ok(pianoPlayabilityGate(artifacts).passed);
    const result = pianoPlayabilityGate(artifacts, undefined, highGate);
    assert.ok(!result.passed);
    assert.ok(result.reason?.includes("0.600 < threshold 0.700"));
});

// ─── Gate-in-runtime-selection tests ─────────────────────────────────────────

function makeCraft(overrides = {}) {
    return {
        finalCraftScore: 0.80,
        advancedCraftScore: 0.70,
        sectionContractFit: 0.85,
        cadenceStrength: 0.70,
        tonalReturn: 0.75,
        motifSurvival: 0.70,
        voiceIndependence: 0.60,
        phraseShape: 0.70,
        registerIdiomaticFit: 0.80,
        syntaxValidity: 0.95,
        ...overrides,
    };
}

function makeEval(craftOverrides = {}, evalOverrides = {}) {
    return {
        passed: true,
        score: 0.80,
        issues: [],
        strengths: [],
        craftScoreSummary: makeCraft(craftOverrides),
        ...evalOverrides,
    };
}

function makeCandidate(id, craftOverrides = {}) {
    const eval_ = makeEval(craftOverrides);
    return {
        candidateId: id,
        structureEvaluation: eval_,
        midiData: [1, 2, 3],
        composeResult: { proposalEvidence: null },
        compositionPlan: { sections: [] },
        executionPlan: { selectedModels: [] },
    };
}

test("SP-15: candidateGateTier returns 0 when custom gate raises syntaxValidityMin above candidate score", () => {
    const craft = makeCraft({ syntaxValidity: 0.80 }); // below 0.90 strict gate
    const eval_ = makeEval({ syntaxValidity: 0.80 });

    const strictGate = {
        profile: "strict_test_gate",
        status: "experimental",
        thresholds: {
            syntaxValidityMin: 0.90,
            sectionContractFitMin: 0.75,
            pianoPlayabilityMin: 0.50,
            finalCraftScoreMin: 0.65,
        },
    };

    const tier = candidateGateTier(eval_, craft, strictGate);
    assert.strictEqual(tier, 0, `Expected tier 0 (fails validity gate), got ${tier}`);
});

test("SP-16: candidateGateTier returns 3 when custom gate lowers all thresholds below candidate scores", () => {
    const craft = makeCraft({
        syntaxValidity: 0.50,
        sectionContractFit: 0.50,
        cadenceStrength: 0.30,
        registerIdiomaticFit: 0.30,
        voiceIndependence: 0.20,
    });
    const eval_ = makeEval({
        syntaxValidity: 0.50,
        sectionContractFit: 0.50,
        cadenceStrength: 0.30,
        registerIdiomaticFit: 0.30,
        voiceIndependence: 0.20,
    }, { passed: true });

    const lenientGate = {
        profile: "lenient_test_gate",
        status: "experimental",
        thresholds: {
            syntaxValidityMin: 0.40,
            sectionContractFitMin: 0.40,
            pianoPlayabilityMin: 0.10,
            finalCraftScoreMin: 0.10,
            cadenceStrengthMin: 0.20,
            registerIdiomaticFitMin: 0.20,
            voiceIndependenceMin: 0.10,
        },
    };

    const tier = candidateGateTier(eval_, craft, lenientGate);
    assert.strictEqual(tier, 3, `Expected tier 3 (passes all gates with lenient config), got ${tier}`);
});

test("SP-17: selectAttemptWinner uses QUALITY_GATE_V1 as default and selects highest-scoring candidate", () => {
    const candidates = [
        makeCandidate("c-low", {
            syntaxValidity: 0.95,
            sectionContractFit: 0.80,
            cadenceStrength: 0.70,
            registerIdiomaticFit: 0.80,
            voiceIndependence: 0.50,
            finalCraftScore: 0.72,
        }),
        makeCandidate("c-high", {
            syntaxValidity: 0.98,
            sectionContractFit: 0.90,
            cadenceStrength: 0.85,
            registerIdiomaticFit: 0.88,
            voiceIndependence: 0.65,
            finalCraftScore: 0.88,
        }),
    ];

    // Both candidates pass all gates under QUALITY_GATE_V1 defaults.
    // The preference model may filter based on craftScorePassesHardFilter,
    // but the heuristic fallback must select c-high over c-low.
    const winner = selectAttemptWinner(candidates, "test-song-sp17");
    assert.strictEqual(winner.candidateId, "c-high",
        `Expected 'c-high' to win (higher craft scores), got '${winner.candidateId}'`);
});

// ─── Profile propagation tests ────────────────────────────────────────────────

import {
    resolveCraftScoringProfile,
    resolvePianoListenabilityScoringProfile,
    resolveQualityGateConfig as resolveGateConfig,
    DEFAULT_CANDIDATE_SCORING_PROFILES,
} from "../dist/core/evaluate/scoringProfile.js";
import { buildStructureEvaluation } from "../dist/core/evaluate/evaluation.js";

test("SP-18: resolveCraftScoringProfile returns CLASSICAL_DEFAULT_V1 for known name and unknown name", () => {
    const known = resolveCraftScoringProfile("classical_default_v1");
    assert.strictEqual(known.profile, "classical_default_v1");
    assert.deepStrictEqual(known.weights, CLASSICAL_DEFAULT_V1.weights);

    const unknown = resolveCraftScoringProfile("nonexistent_profile");
    assert.strictEqual(unknown.profile, "classical_default_v1",
        "Unknown profile should fall back to CLASSICAL_DEFAULT_V1");

    const undef = resolveCraftScoringProfile(undefined);
    assert.strictEqual(undef.profile, "classical_default_v1",
        "undefined should fall back to CLASSICAL_DEFAULT_V1");
});

test("SP-19: buildStructureEvaluation uses scoringProfiles.scoringProfile to stamp craftScoreSummary", () => {
    // Minimal critique result — passes validity so craft scoring runs
    const critiqueResult = { pass: true, issues: [], strengths: [] };

    const artifacts = [{
        sectionId: "s1",
        role: "theme_a",
        measuresCount: 8,
        melodyEvents: [
            { pitch: 60, durationTicks: 480, velocity: 80, startTick: 0 },
            { pitch: 62, durationTicks: 480, velocity: 80, startTick: 480 },
        ],
        accompanimentEvents: [],
    }];

    const result = buildStructureEvaluation(critiqueResult, {
        sectionArtifacts: artifacts,
        scoringProfiles: {
            scoringProfile: "classical_default_v1",
            qualityGateProfile: "quality_gate_v1",
        },
    });

    // craftScoreSummary must be populated and profile name stamped
    assert.ok(result.craftScoreSummary, "craftScoreSummary should be computed");
    assert.strictEqual(
        result.craftScoreSummary.scoringProfile,
        "classical_default_v1",
        "craftScoreSummary.scoringProfile should match the supplied profile",
    );
});
