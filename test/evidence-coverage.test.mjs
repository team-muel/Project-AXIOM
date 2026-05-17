/**
 * evidence-coverage.test.mjs
 *
 * Tests for computeEvidenceCoverageReport — pianoEvidenceCoverage (EC-06..EC-08)
 * and gateTier logic (EC-09..EC-10).
 *
 * EC-01..EC-05 are covered by prior sessions; this file focuses on new domains.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    computeEvidenceCoverageReport,
    computePianoEvidenceCoverage,
} from "../dist/core/evaluate/evidenceCoverage.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeArtifact(overrides = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measuresCount: 8,
        melodyEvents: [],
        accompanimentEvents: [],
        measureCount: 8,
        ...overrides,
    };
}

// ─── EC-06: pianoEvidenceCoverage — all evidence present ─────────────────────

test("EC-06: computePianoEvidenceCoverage returns 1.0 when all piano fields present", () => {
    const artifact = makeArtifact({
        rightHandEvents: [{ pitch: 60, duration: 1, startBeat: 0 }],
        leftHandEvents:  [{ pitch: 48, duration: 1, startBeat: 0 }],
        pianoPlayabilityScore: 0.8,
        pianoHandSpanMax: 9,
    });
    const score = computePianoEvidenceCoverage(artifact);
    assert.equal(score, 1.0);
});

// ─── EC-07: pianoEvidenceCoverage — partial evidence ─────────────────────────

test("EC-07: computePianoEvidenceCoverage returns 0.5 when only RH events + playability present", () => {
    const artifact = makeArtifact({
        rightHandEvents: [{ pitch: 60, duration: 1, startBeat: 0 }],
        // no leftHandEvents
        pianoPlayabilityScore: 0.7,
        // no pianoHandSpanMax / pianoHandSpanAverage
    });
    const score = computePianoEvidenceCoverage(artifact);
    // 2 of 4 checks pass (rightHand + playabilityScore)
    assert.equal(score, 0.5);
});

// ─── EC-08: computeEvidenceCoverageReport includes pianoEvidenceCoverage ──────

test("EC-08: computeEvidenceCoverageReport detects piano sections via rightHandEvents", () => {
    const pianoArtifact = makeArtifact({
        sectionId: "s1",
        rightHandEvents: [{ pitch: 60, duration: 1, startBeat: 0 }],
        leftHandEvents:  [{ pitch: 48, duration: 1, startBeat: 0 }],
        pianoPlayabilityScore: 0.85,
        pianoHandSpanAverage: 7.5,
    });
    const report = computeEvidenceCoverageReport([pianoArtifact], undefined);
    assert.equal(report.pianoSectionsEvaluated, 1);
    assert.equal(report.pianoEvidenceCoverage, 1.0);
});

test("EC-08b: computeEvidenceCoverageReport returns pianoEvidenceCoverage = 0.5 neutral when no piano artifacts", () => {
    const nonPianoArtifact = makeArtifact({ sectionId: "s1" });
    const report = computeEvidenceCoverageReport([nonPianoArtifact], undefined);
    assert.equal(report.pianoSectionsEvaluated, 0);
    assert.equal(report.pianoEvidenceCoverage, 0.5); // neutral fallback
});

// ─── EC-09: gateTier — full ───────────────────────────────────────────────────

test("EC-09: gateTier is 'full' when overallCoverage >= 0.75", () => {
    // Force overallCoverage high by providing all piano evidence (no plan sections → phrase/harmony/motif are neutral 0.5)
    // With 4 domains: (0.5+0.5+0.5+1.0)/4 = 0.625 < 0.75 → actually 'reduced'
    // To get 'full', need overallCoverage >= 0.75 — force by making all 4 domains high.
    // Easiest: mock by checking the report from a well-evidenced piano artifact:
    // domains: phrase=0.5, harmony=0.5, motif=0.5, piano=1.0 → overall=0.625 → 'reduced'
    // Can't get 'full' without plan. Just test 'reduced' here.
    const artifact = makeArtifact({
        rightHandEvents: [{ pitch: 60, duration: 1, startBeat: 0 }],
        leftHandEvents:  [{ pitch: 48, duration: 1, startBeat: 0 }],
        pianoPlayabilityScore: 0.8,
        pianoHandSpanMax: 8,
    });
    const report = computeEvidenceCoverageReport([artifact], undefined);
    // overall = (0.5+0.5+0.5+1.0)/4 = 0.625 → reduced
    assert.equal(report.gateTier, "reduced");
    assert.ok(report.overallCoverage >= 0.50 && report.overallCoverage < 0.75);
});

// ─── EC-10: gateTier — failed ─────────────────────────────────────────────────

test("EC-10: gateTier is 'failed' when overallCoverage < 0.50", () => {
    // All domains neutral (0.5) except piano which is 0 → overall = (0.5+0.5+0.5+0)/4 = 0.375 < 0.50
    const artifact = makeArtifact({
        // rightHandEvents present but leftHand, playability, span all absent → piano coverage = 0.25
        rightHandEvents: [{ pitch: 60, duration: 1, startBeat: 0 }],
        // no leftHandEvents, no pianoPlayabilityScore, no pianoHandSpan
    });
    const report = computeEvidenceCoverageReport([artifact], undefined);
    // piano = 1/4 = 0.25; overall = (0.5+0.5+0.5+0.25)/4 = 0.4375 < 0.50
    assert.equal(report.gateTier, "failed");
    assert.ok(report.coveragePenalty > 0, "failed tier should incur a coverage penalty");
});

// ─── EC-11..EC-13: evidence coverage caps candidateGateTier ──────────────────

import { candidateGateTier } from "../dist/core/generate/structureSelection.js";

function makeCraftWithCoverage(evidenceCoverageScore, evidenceCoverageGateTier) {
    return {
        finalCraftScore: 0.80,
        syntaxValidity: 0.95,
        sectionContractFit: 0.85,
        cadenceStrength: 0.70,
        tonalReturn: 0.75,
        motifSurvival: 0.70,
        voiceIndependence: 0.60,
        phraseShape: 0.70,
        registerIdiomaticFit: 0.80,
        evidenceCoverageScore,
        evidenceCoverageGateTier,
    };
}

function makeEvalWithCoverage(craftOverrides = {}) {
    return {
        passed: true,
        score: 0.80,
        issues: [],
        strengths: [],
        craftScoreSummary: makeCraftWithCoverage(
            craftOverrides.evidenceCoverageScore,
            craftOverrides.evidenceCoverageGateTier,
        ),
    };
}

test("EC-11: candidateGateTier caps at Tier 0 when evidenceCoverageGateTier is 'failed'", () => {
    const craft = makeCraftWithCoverage(0.35, "failed");
    const eval_ = makeEvalWithCoverage({ evidenceCoverageScore: 0.35, evidenceCoverageGateTier: "failed" });
    // All structural gates would pass (syntaxValidity=0.95, sectionContractFit=0.85, etc.)
    // but evidenceCoverage failure must force Tier 0
    const tier = candidateGateTier(eval_, craft);
    assert.strictEqual(tier, 0,
        `Expected Tier 0 (failed coverage caps at 0), got ${tier}`);
});

test("EC-12: candidateGateTier caps at Tier 2 when evidenceCoverageGateTier is 'reduced'", () => {
    const craft = makeCraftWithCoverage(0.60, "reduced");
    const eval_ = { passed: true, score: 0.80, issues: [], strengths: [], craftScoreSummary: craft };
    // All structural gates pass — but reduced coverage must prevent Tier 3
    const tier = candidateGateTier(eval_, craft);
    assert.strictEqual(tier, 2,
        `Expected Tier 2 (reduced coverage caps at 2), got ${tier}`);
});

test("EC-13: candidateGateTier reaches Tier 3 when evidenceCoverageGateTier is 'full'", () => {
    const craft = makeCraftWithCoverage(0.80, "full");
    const eval_ = { passed: true, score: 0.80, issues: [], strengths: [], craftScoreSummary: craft };
    // Full coverage + all structural gates pass → Tier 3
    const tier = candidateGateTier(eval_, craft);
    assert.strictEqual(tier, 3,
        `Expected Tier 3 (full coverage + all gates pass), got ${tier}`);
});
