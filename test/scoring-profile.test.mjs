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

test("SP-14: pianoPlayabilityGate uses qualityGate.pianoPlayabilityMin when supplied", () => {
    // Artifact with pianoPlayabilityScore = 0.60 — passes built-in 0.50, but
    // fails a custom gate that raises the bar to 0.70.
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

    // Without gate: passes (default 0.50)
    assert.ok(pianoPlayabilityGate(artifacts).passed);

    // With strict gate: fails (0.60 < 0.70)
    const result = pianoPlayabilityGate(artifacts, undefined, highGate);
    assert.ok(!result.passed);
    assert.ok(result.reason?.includes("0.600 < threshold 0.700"));
});
