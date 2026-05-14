// @ts-check
/**
 * Phase F: Compact craft evaluator tests
 *
 *  1. sectionContractFit is low when section count is wrong
 *  2. sectionContractFit is high when plan matches artifacts exactly
 *  3. cadenceStrength is high when final section has dominant cadence approach
 *  4. cadenceStrength reflects melodic stepwise resolution
 *  5. voiceIndependence is low when melody/accompaniment share same rhythm
 *  6. voiceIndependence uses textureContraryMotionRate if present
 *  7. motifSurvival is high when theme_a and recap share interval contour direction
 *  8. motifSurvival is low when recap contour is opposite
 *  9. registerIdiomaticFit penalises out-of-range pitches
 * 10. registerIdiomaticFit scores 1 when all pitches in idiomatic range
 * 11. computeCraftScoreSummary finalCraftScore is correctly weighted
 * 12. scoreStructureEvaluationForCandidateSelection includes craftBonus
 * 13. scoreStructureEvaluationForCandidateSelection applies contractPenalty when sectionContractFit < 0.5
 * 14. syntaxValidity is 0 when evaluation has hard failure issue
 * 15. craftScorePassesQualityGate returns true when all dimensions meet threshold
 * 16. craftScorePassesQualityGate returns false when syntaxValidity < threshold
 * 17. craftScorePassesQualityGate returns false when sectionContractFit < threshold
 * 18. craftScorePassesQualityGate returns false when registerIdiomaticFit < threshold
 * 19. gate-passer scores higher than gate-failer with identical structure evaluation
 */

import test from "node:test";
import assert from "node:assert/strict";

const {
    computeSyntaxValidity,
    computeSectionContractFit,
    computeCadenceStrength,
    computeTonalReturn,
    computeMotifSurvival,
    computeVoiceIndependence,
    computePhraseShape,
    computeRegisterIdiomaticFit,
    computeCraftScoreSummary,
} = await import("../dist/pipeline/craftScoring.js");

const {
    scoreStructureEvaluationForCandidateSelection,
    craftScorePassesQualityGate,
    CRAFT_QUALITY_GATE,
    CANDIDATE_GATE_VALIDITY,
    CANDIDATE_GATE_CONTRACT,
    CANDIDATE_GATE_CRAFT,
    passesValidityGate,
    passesContractGate,
    passesCraftGate,
    candidateGateTier,
} = await import(
    "../dist/pipeline/structureSelection.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {Partial<import("../dist/pipeline/types.js").SectionArtifactSummary>} overrides */
function makeArtifact(overrides = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: 4,
        melodyEvents: [],
        accompanimentEvents: [],
        noteHistory: [60, 62, 64, 65, 67],
        ...overrides,
    };
}

/** @param {Partial<import("../dist/pipeline/types.js").CompositionPlan>} overrides */
function makePlan(overrides = {}) {
    return {
        version: "1",
        brief: "Phase F test",
        mood: [],
        form: "miniature",
        key: "G minor",
        meter: "4/4",
        tempo: 84,
        workflow: "symbolic_only",
        motifPolicy: {},
        rationale: "",
        instrumentation: [
            { name: "Violin", family: "strings", roles: ["lead"] },
            { name: "Viola", family: "strings", roles: ["counterline"] },
            { name: "Cello", family: "strings", roles: ["bass"] },
        ],
        sections: [
            { id: "s1", role: "theme_a", label: "Primary theme", measures: 4, energy: 0.5, density: 0.4 },
            { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.7, density: 0.6 },
            { id: "s3", role: "recap", label: "Recap", measures: 4, energy: 0.4, density: 0.3 },
        ],
        ...overrides,
    };
}

/** @param {Partial<import("../dist/pipeline/types.js").StructureEvaluationReport>} overrides */
function makeEvaluation(overrides = {}) {
    return {
        passed: true,
        score: 80,
        issues: [],
        strengths: [],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// 1. sectionContractFit is low when section count is wrong
// ---------------------------------------------------------------------------
test("sectionContractFit is low when section count is wrong", () => {
    const plan = makePlan(); // 3 sections
    const artifacts = [
        makeArtifact({ sectionId: "s1", role: "theme_a" }),
        // Missing s2 and s3 — only 1 artifact
    ];
    const { score } = computeSectionContractFit(artifacts, plan);
    assert.ok(score < 0.7, `Expected low score, got ${score}`);
});

// ---------------------------------------------------------------------------
// 2. sectionContractFit is high when plan matches artifacts exactly
// ---------------------------------------------------------------------------
test("sectionContractFit is high when plan matches artifacts exactly", () => {
    const plan = makePlan();
    const artifacts = [
        makeArtifact({ sectionId: "s1", role: "theme_a", measureCount: 4 }),
        makeArtifact({ sectionId: "s2", role: "development", measureCount: 4 }),
        makeArtifact({ sectionId: "s3", role: "recap", measureCount: 4 }),
    ];
    const { score } = computeSectionContractFit(artifacts, plan);
    assert.ok(score >= 0.85, `Expected high score, got ${score}`);
});

// ---------------------------------------------------------------------------
// 3. cadenceStrength is high when final section has dominant cadence approach
// ---------------------------------------------------------------------------
test("cadenceStrength is high when final section has dominant cadence approach", () => {
    const artifacts = [
        makeArtifact({ sectionId: "s1", role: "theme_a" }),
        makeArtifact({
            sectionId: "s3",
            role: "recap",
            cadenceApproach: "dominant",
            lastInterval: 1,
        }),
    ];
    const { score } = computeCadenceStrength(artifacts);
    assert.ok(score >= 0.7, `Expected high cadence strength, got ${score}`);
});

// ---------------------------------------------------------------------------
// 4. cadenceStrength reflects melodic stepwise resolution
// ---------------------------------------------------------------------------
test("cadenceStrength is boosted by stepwise melodic resolution", () => {
    const artifactsWithStep = [
        makeArtifact({ sectionId: "s1", role: "recap", lastInterval: 2 }),
    ];
    const artifactsNoStep = [
        makeArtifact({ sectionId: "s1", role: "recap", lastInterval: 7 }),
    ];
    const withStep = computeCadenceStrength(artifactsWithStep).score;
    const noStep = computeCadenceStrength(artifactsNoStep).score;
    assert.ok(withStep > noStep, `Expected stepwise ${withStep} > leap ${noStep}`);
});

// ---------------------------------------------------------------------------
// 5. voiceIndependence is low when melody/accompaniment share same rhythm
// ---------------------------------------------------------------------------
test("voiceIndependence is low when voices share the same rhythm", () => {
    const sharedRhythm = [
        { type: "note", quarterLength: 1, pitch: 60 },
        { type: "note", quarterLength: 1, pitch: 62 },
        { type: "note", quarterLength: 1, pitch: 64 },
        { type: "note", quarterLength: 1, pitch: 65 },
        { type: "note", quarterLength: 1, pitch: 67 },
    ];
    const artifact = makeArtifact({
        melodyEvents: sharedRhythm,
        accompanimentEvents: sharedRhythm, // identical rhythm
        textureContraryMotionRate: 0.0,
        textureIndependentMotionRate: 0.0,
    });
    const { score } = computeVoiceIndependence([artifact]);
    assert.ok(score <= 0.5, `Expected low independence, got ${score}`);
});

// ---------------------------------------------------------------------------
// 6. voiceIndependence uses textureContraryMotionRate if present
// ---------------------------------------------------------------------------
test("voiceIndependence is high when textureContraryMotionRate is high", () => {
    const artifact = makeArtifact({
        textureContraryMotionRate: 0.9,
        textureIndependentMotionRate: 0.8,
    });
    const { score } = computeVoiceIndependence([artifact]);
    assert.ok(score >= 0.6, `Expected high independence, got ${score}`);
});

// ---------------------------------------------------------------------------
// 7. motifSurvival is high when theme_a and recap share interval contour direction
// ---------------------------------------------------------------------------
test("motifSurvival is high when theme_a and recap share interval contour direction", () => {
    const themeA = makeArtifact({
        sectionId: "s1",
        role: "theme_a",
        noteHistory: [60, 62, 64, 65, 67], // all ascending
    });
    const recap = makeArtifact({
        sectionId: "s3",
        role: "recap",
        noteHistory: [67, 69, 71, 72, 74], // also all ascending
    });
    const { score } = computeMotifSurvival([themeA, recap]);
    assert.ok(score >= 0.8, `Expected high motif survival, got ${score}`);
});

// ---------------------------------------------------------------------------
// 8. motifSurvival is low when recap contour is opposite
// ---------------------------------------------------------------------------
test("motifSurvival is low when recap contour is completely opposite", () => {
    const themeA = makeArtifact({
        sectionId: "s1",
        role: "theme_a",
        noteHistory: [60, 62, 64, 65, 67], // ascending
    });
    const recap = makeArtifact({
        sectionId: "s3",
        role: "recap",
        noteHistory: [67, 65, 63, 62, 60], // descending = opposite
    });
    const { score } = computeMotifSurvival([themeA, recap]);
    assert.ok(score <= 0.5, `Expected low motif survival, got ${score}`);
});

// ---------------------------------------------------------------------------
// 9. registerIdiomaticFit penalises out-of-range pitches
// ---------------------------------------------------------------------------
test("registerIdiomaticFit penalises out-of-range pitches", () => {
    const plan = makePlan();
    const artifact = makeArtifact({
        sectionId: "s1",
        role: "theme_a",
        melodyPitchMin: 30, // far below Violin idiomatic range (55–100)
        melodyPitchMax: 45,
        bassPitchMin: 80,   // far above Cello idiomatic range (36–72)
        bassPitchMax: 100,
    });
    const { score } = computeRegisterIdiomaticFit([artifact], plan);
    assert.ok(score < 0.6, `Expected low register fit, got ${score}`);
});

// ---------------------------------------------------------------------------
// 10. registerIdiomaticFit scores high when all pitches in idiomatic range
// ---------------------------------------------------------------------------
test("registerIdiomaticFit scores high when all pitches in idiomatic range", () => {
    const plan = makePlan();
    const artifact = makeArtifact({
        sectionId: "s1",
        role: "theme_a",
        melodyPitchMin: 64,  // Violin: E4
        melodyPitchMax: 84,  // Violin: well within range
        bassPitchMin: 40,    // Cello: within range
        bassPitchMax: 60,    // Cello: within range
    });
    const { score } = computeRegisterIdiomaticFit([artifact], plan);
    assert.ok(score >= 0.8, `Expected high register fit, got ${score}`);
});

// ---------------------------------------------------------------------------
// 11. computeCraftScoreSummary finalCraftScore is correctly weighted
// ---------------------------------------------------------------------------
test("computeCraftScoreSummary finalCraftScore matches weighted formula", () => {
    const plan = makePlan();
    const evaluation = makeEvaluation();
    const artifacts = [
        makeArtifact({ sectionId: "s1", role: "theme_a", measureCount: 4 }),
        makeArtifact({ sectionId: "s2", role: "development", measureCount: 4 }),
        makeArtifact({ sectionId: "s3", role: "recap", measureCount: 4 }),
    ];
    const summary = computeCraftScoreSummary(artifacts, plan, evaluation);

    // Verify all 8 dimensions present and 0–1
    for (const key of [
        "syntaxValidity", "sectionContractFit", "cadenceStrength",
        "tonalReturn", "motifSurvival", "voiceIndependence",
        "phraseShape", "registerIdiomaticFit",
    ]) {
        assert.ok(
            typeof summary[key] === "number" && summary[key] >= 0 && summary[key] <= 1,
            `${key} should be 0-1, got ${summary[key]}`,
        );
    }

    // Verify formula
    const expected = Number((
        0.15 * summary.sectionContractFit
        + 0.15 * summary.cadenceStrength
        + 0.15 * summary.tonalReturn
        + 0.15 * summary.motifSurvival
        + 0.15 * summary.voiceIndependence
        + 0.10 * summary.phraseShape
        + 0.10 * summary.registerIdiomaticFit
        + 0.05 * summary.syntaxValidity
    ).toFixed(4));

    assert.strictEqual(summary.finalCraftScore, expected);
});

// ---------------------------------------------------------------------------
// 12. scoreStructureEvaluationForCandidateSelection includes craftBonus
// ---------------------------------------------------------------------------
test("scoreStructureEvaluationForCandidateSelection includes craftBonus when craftScoreSummary present", () => {
    const baseEval = makeEvaluation({ passed: false });
    const evalWithCraft = makeEvaluation({
        passed: false,
        craftScoreSummary: {
            syntaxValidity: 1,
            sectionContractFit: 0.9,
            cadenceStrength: 0.9,
            tonalReturn: 0.9,
            motifSurvival: 0.9,
            voiceIndependence: 0.9,
            phraseShape: 0.9,
            registerIdiomaticFit: 0.9,
            finalCraftScore: 0.9,
        },
    });
    const baseScore = scoreStructureEvaluationForCandidateSelection(baseEval);
    const craftScore = scoreStructureEvaluationForCandidateSelection(evalWithCraft);
    assert.ok(craftScore > baseScore, `craftBonus should increase score: ${craftScore} vs ${baseScore}`);
});

// ---------------------------------------------------------------------------
// 13. contractPenalty applied when sectionContractFit < 0.5
// ---------------------------------------------------------------------------
test("scoreStructureEvaluationForCandidateSelection applies contractPenalty when sectionContractFit < 0.5", () => {
    const goodContract = makeEvaluation({
        passed: true,
        craftScoreSummary: {
            syntaxValidity: 1,
            sectionContractFit: 0.9,
            cadenceStrength: 0.8,
            tonalReturn: 0.8,
            motifSurvival: 0.8,
            voiceIndependence: 0.8,
            phraseShape: 0.8,
            registerIdiomaticFit: 0.8,
            finalCraftScore: 0.83,
        },
    });
    const brokenContract = makeEvaluation({
        passed: true,
        craftScoreSummary: {
            syntaxValidity: 1,
            sectionContractFit: 0.1, // very low — should trigger penalty
            cadenceStrength: 0.8,
            tonalReturn: 0.8,
            motifSurvival: 0.8,
            voiceIndependence: 0.8,
            phraseShape: 0.8,
            registerIdiomaticFit: 0.8,
            finalCraftScore: 0.62,
        },
    });
    const goodScore = scoreStructureEvaluationForCandidateSelection(goodContract);
    const brokenScore = scoreStructureEvaluationForCandidateSelection(brokenContract);
    assert.ok(goodScore > brokenScore, `Good contract ${goodScore} should beat broken contract ${brokenScore}`);
});

// ---------------------------------------------------------------------------
// 14. syntaxValidity is 0 when evaluation has hard failure issue
// ---------------------------------------------------------------------------
test("syntaxValidity is 0 when evaluation has hard failure issue", () => {
    const evaluation = makeEvaluation({
        issues: ["ABC parse failed: unexpected token at bar 3"],
    });
    const score = computeSyntaxValidity(
        [makeArtifact()],
        evaluation,
    );
    assert.strictEqual(score, 0);
});

// ---------------------------------------------------------------------------
// 15. craftScorePassesQualityGate returns true when all dimensions meet threshold
// ---------------------------------------------------------------------------
test("craftScorePassesQualityGate returns true when all dimensions meet threshold", () => {
    const craft = {
        syntaxValidity:     CRAFT_QUALITY_GATE.syntaxValidity,
        sectionContractFit: CRAFT_QUALITY_GATE.sectionContractFit,
        registerIdiomaticFit: CRAFT_QUALITY_GATE.registerIdiomaticFit,
        cadenceStrength:    0.8,
        tonalReturn:        0.8,
        motifSurvival:      0.8,
        voiceIndependence:  0.8,
        phraseShape:        0.8,
        finalCraftScore:    0.8,
    };
    assert.strictEqual(craftScorePassesQualityGate(craft), true);
});

// ---------------------------------------------------------------------------
// 16. craftScorePassesQualityGate returns false when syntaxValidity < threshold
// ---------------------------------------------------------------------------
test("craftScorePassesQualityGate returns false when syntaxValidity < threshold", () => {
    const craft = {
        syntaxValidity:     CRAFT_QUALITY_GATE.syntaxValidity - 0.01,
        sectionContractFit: CRAFT_QUALITY_GATE.sectionContractFit,
        registerIdiomaticFit: CRAFT_QUALITY_GATE.registerIdiomaticFit,
        cadenceStrength:    0.8,
        tonalReturn:        0.8,
        motifSurvival:      0.8,
        voiceIndependence:  0.8,
        phraseShape:        0.8,
        finalCraftScore:    0.75,
    };
    assert.strictEqual(craftScorePassesQualityGate(craft), false);
});

// ---------------------------------------------------------------------------
// 17. craftScorePassesQualityGate returns false when sectionContractFit < threshold
// ---------------------------------------------------------------------------
test("craftScorePassesQualityGate returns false when sectionContractFit < threshold", () => {
    const craft = {
        syntaxValidity:     CRAFT_QUALITY_GATE.syntaxValidity,
        sectionContractFit: CRAFT_QUALITY_GATE.sectionContractFit - 0.01,
        registerIdiomaticFit: CRAFT_QUALITY_GATE.registerIdiomaticFit,
        cadenceStrength:    0.8,
        tonalReturn:        0.8,
        motifSurvival:      0.8,
        voiceIndependence:  0.8,
        phraseShape:        0.8,
        finalCraftScore:    0.75,
    };
    assert.strictEqual(craftScorePassesQualityGate(craft), false);
});

// ---------------------------------------------------------------------------
// 18. craftScorePassesQualityGate returns false when registerIdiomaticFit < threshold
// ---------------------------------------------------------------------------
test("craftScorePassesQualityGate returns false when registerIdiomaticFit < threshold", () => {
    const craft = {
        syntaxValidity:     CRAFT_QUALITY_GATE.syntaxValidity,
        sectionContractFit: CRAFT_QUALITY_GATE.sectionContractFit,
        registerIdiomaticFit: CRAFT_QUALITY_GATE.registerIdiomaticFit - 0.01,
        cadenceStrength:    0.8,
        tonalReturn:        0.8,
        motifSurvival:      0.8,
        voiceIndependence:  0.8,
        phraseShape:        0.8,
        finalCraftScore:    0.75,
    };
    assert.strictEqual(craftScorePassesQualityGate(craft), false);
});

// ---------------------------------------------------------------------------
// 19. Gate-passer scores significantly higher than gate-failer with identical
//     structure evaluation (same passed + baseScore)
// ---------------------------------------------------------------------------
test("gate-passer scores higher than gate-failer with identical structure evaluation", () => {
    const baseEval = { passed: true, score: 80, issues: [], strengths: [] };
    const gatePasser = {
        ...baseEval,
        craftScoreSummary: {
            syntaxValidity:     CRAFT_QUALITY_GATE.syntaxValidity,
            sectionContractFit: CRAFT_QUALITY_GATE.sectionContractFit,
            registerIdiomaticFit: CRAFT_QUALITY_GATE.registerIdiomaticFit,
            cadenceStrength:    0.8,
            tonalReturn:        0.8,
            motifSurvival:      0.8,
            voiceIndependence:  0.8,
            phraseShape:        0.8,
            finalCraftScore:    0.8,
        },
    };
    const gateFailer = {
        ...baseEval,
        craftScoreSummary: {
            syntaxValidity:     0.5,                                 // below threshold
            sectionContractFit: CRAFT_QUALITY_GATE.sectionContractFit,
            registerIdiomaticFit: CRAFT_QUALITY_GATE.registerIdiomaticFit,
            cadenceStrength:    0.8,
            tonalReturn:        0.8,
            motifSurvival:      0.8,
            voiceIndependence:  0.8,
            phraseShape:        0.8,
            finalCraftScore:    0.72,
        },
    };
    const passerScore = scoreStructureEvaluationForCandidateSelection(gatePasser);
    const failerScore = scoreStructureEvaluationForCandidateSelection(gateFailer);
    // 400pt gate bonus should dominate: passer must be clearly ahead
    assert.ok(
        passerScore - failerScore >= 350,
        `Gate-passer (${passerScore}) should be >=350 pts ahead of gate-failer (${failerScore})`,
    );
});

// ---------------------------------------------------------------------------
// 20. passesValidityGate: true when evaluation.passed && syntaxValidity ok
// ---------------------------------------------------------------------------
test("passesValidityGate returns true when evaluation passed and syntaxValidity >= threshold", () => {
    const evaluation = makeEvaluation({ passed: true });
    const craft = {
        syntaxValidity: CANDIDATE_GATE_VALIDITY.syntaxValidity,
        sectionContractFit: 0.5,
        cadenceStrength: 0.4,
        tonalReturn: 0.5,
        motifSurvival: 0.5,
        voiceIndependence: 0.2,
        phraseShape: 0.5,
        registerIdiomaticFit: 0.5,
        finalCraftScore: 0.5,
    };
    assert.strictEqual(passesValidityGate(evaluation, craft), true);
});

test("passesValidityGate returns false when evaluation.passed is false", () => {
    const evaluation = makeEvaluation({ passed: false });
    const craft = {
        syntaxValidity: 1.0,
        sectionContractFit: 0.9,
        cadenceStrength: 0.9,
        tonalReturn: 0.9,
        motifSurvival: 0.9,
        voiceIndependence: 0.9,
        phraseShape: 0.9,
        registerIdiomaticFit: 0.9,
        finalCraftScore: 0.9,
    };
    assert.strictEqual(passesValidityGate(evaluation, craft), false);
});

test("passesValidityGate returns false when syntaxValidity below threshold", () => {
    const evaluation = makeEvaluation({ passed: true });
    const craft = {
        syntaxValidity: CANDIDATE_GATE_VALIDITY.syntaxValidity - 0.01,
        sectionContractFit: 0.9,
        cadenceStrength: 0.9,
        tonalReturn: 0.9,
        motifSurvival: 0.9,
        voiceIndependence: 0.9,
        phraseShape: 0.9,
        registerIdiomaticFit: 0.9,
        finalCraftScore: 0.9,
    };
    assert.strictEqual(passesValidityGate(evaluation, craft), false);
});

// ---------------------------------------------------------------------------
// 21. passesContractGate
// ---------------------------------------------------------------------------
test("passesContractGate returns true when sectionContractFit meets threshold", () => {
    const craft = {
        syntaxValidity: 1,
        sectionContractFit: CANDIDATE_GATE_CONTRACT.sectionContractFit,
        cadenceStrength: 0.4,
        tonalReturn: 0.5,
        motifSurvival: 0.5,
        voiceIndependence: 0.2,
        phraseShape: 0.5,
        registerIdiomaticFit: 0.5,
        finalCraftScore: 0.5,
    };
    assert.strictEqual(passesContractGate(craft), true);
});

test("passesContractGate returns false when sectionContractFit below threshold", () => {
    const craft = {
        syntaxValidity: 1,
        sectionContractFit: CANDIDATE_GATE_CONTRACT.sectionContractFit - 0.01,
        cadenceStrength: 0.9,
        tonalReturn: 0.9,
        motifSurvival: 0.9,
        voiceIndependence: 0.9,
        phraseShape: 0.9,
        registerIdiomaticFit: 0.9,
        finalCraftScore: 0.9,
    };
    assert.strictEqual(passesContractGate(craft), false);
});

// ---------------------------------------------------------------------------
// 22. passesCraftGate
// ---------------------------------------------------------------------------
test("passesCraftGate returns true when all three craft thresholds met", () => {
    const craft = {
        syntaxValidity: 1,
        sectionContractFit: 0.9,
        cadenceStrength: CANDIDATE_GATE_CRAFT.cadenceStrength,
        tonalReturn: 0.8,
        motifSurvival: 0.8,
        voiceIndependence: CANDIDATE_GATE_CRAFT.voiceIndependence,
        phraseShape: 0.8,
        registerIdiomaticFit: CANDIDATE_GATE_CRAFT.registerIdiomaticFit,
        finalCraftScore: 0.8,
    };
    assert.strictEqual(passesCraftGate(craft), true);
});

test("passesCraftGate returns false when cadenceStrength below threshold", () => {
    const craft = {
        syntaxValidity: 1,
        sectionContractFit: 0.9,
        cadenceStrength: CANDIDATE_GATE_CRAFT.cadenceStrength - 0.01,
        tonalReturn: 0.8,
        motifSurvival: 0.8,
        voiceIndependence: 0.9,
        phraseShape: 0.8,
        registerIdiomaticFit: CANDIDATE_GATE_CRAFT.registerIdiomaticFit,
        finalCraftScore: 0.8,
    };
    assert.strictEqual(passesCraftGate(craft), false);
});

test("passesCraftGate returns false when voiceIndependence below threshold", () => {
    const craft = {
        syntaxValidity: 1,
        sectionContractFit: 0.9,
        cadenceStrength: 0.9,
        tonalReturn: 0.8,
        motifSurvival: 0.8,
        voiceIndependence: CANDIDATE_GATE_CRAFT.voiceIndependence - 0.01,
        phraseShape: 0.8,
        registerIdiomaticFit: CANDIDATE_GATE_CRAFT.registerIdiomaticFit,
        finalCraftScore: 0.8,
    };
    assert.strictEqual(passesCraftGate(craft), false);
});

// ---------------------------------------------------------------------------
// 23. candidateGateTier progression
// ---------------------------------------------------------------------------
test("candidateGateTier returns 0 when validity fails (passed=false)", () => {
    const evaluation = makeEvaluation({ passed: false });
    const craft = {
        syntaxValidity: 1, sectionContractFit: 1, cadenceStrength: 1,
        tonalReturn: 1, motifSurvival: 1, voiceIndependence: 1,
        phraseShape: 1, registerIdiomaticFit: 1, finalCraftScore: 1,
    };
    assert.strictEqual(candidateGateTier(evaluation, craft), 0);
});

test("candidateGateTier returns 1 when only validity passes", () => {
    const evaluation = makeEvaluation({ passed: true });
    const craft = {
        syntaxValidity: CANDIDATE_GATE_VALIDITY.syntaxValidity,
        sectionContractFit: CANDIDATE_GATE_CONTRACT.sectionContractFit - 0.01, // fails Gate 2
        cadenceStrength: 0.9, tonalReturn: 0.9, motifSurvival: 0.9,
        voiceIndependence: 0.9, phraseShape: 0.9,
        registerIdiomaticFit: 0.9, finalCraftScore: 0.9,
    };
    assert.strictEqual(candidateGateTier(evaluation, craft), 1);
});

test("candidateGateTier returns 2 when validity + contract pass but craft fails", () => {
    const evaluation = makeEvaluation({ passed: true });
    const craft = {
        syntaxValidity: CANDIDATE_GATE_VALIDITY.syntaxValidity,
        sectionContractFit: CANDIDATE_GATE_CONTRACT.sectionContractFit,
        cadenceStrength: CANDIDATE_GATE_CRAFT.cadenceStrength - 0.01, // fails Gate 3
        tonalReturn: 0.8, motifSurvival: 0.8,
        voiceIndependence: CANDIDATE_GATE_CRAFT.voiceIndependence,
        phraseShape: 0.8,
        registerIdiomaticFit: CANDIDATE_GATE_CRAFT.registerIdiomaticFit,
        finalCraftScore: 0.8,
    };
    assert.strictEqual(candidateGateTier(evaluation, craft), 2);
});

test("candidateGateTier returns 3 when all gates pass", () => {
    const evaluation = makeEvaluation({ passed: true });
    const craft = {
        syntaxValidity: CANDIDATE_GATE_VALIDITY.syntaxValidity,
        sectionContractFit: CANDIDATE_GATE_CONTRACT.sectionContractFit,
        cadenceStrength: CANDIDATE_GATE_CRAFT.cadenceStrength,
        tonalReturn: 0.8, motifSurvival: 0.8,
        voiceIndependence: CANDIDATE_GATE_CRAFT.voiceIndependence,
        phraseShape: 0.8,
        registerIdiomaticFit: CANDIDATE_GATE_CRAFT.registerIdiomaticFit,
        finalCraftScore: 0.8,
    };
    assert.strictEqual(candidateGateTier(evaluation, craft), 3);
});

// ---------------------------------------------------------------------------
// 24. Tier-3 scores higher than Tier-2, which scores higher than Tier-0
// ---------------------------------------------------------------------------
test("tier-3 candidate scores significantly higher than tier-2 (no craft gate)", () => {
    const baseEval = makeEvaluation({ passed: true });
    const baseCraft = {
        tonalReturn: 0.8, motifSurvival: 0.8, phraseShape: 0.8,
        finalCraftScore: 0.8,
    };
    const tier3 = {
        ...baseEval,
        craftScoreSummary: {
            ...baseCraft,
            syntaxValidity: CANDIDATE_GATE_VALIDITY.syntaxValidity,
            sectionContractFit: CANDIDATE_GATE_CONTRACT.sectionContractFit,
            cadenceStrength: CANDIDATE_GATE_CRAFT.cadenceStrength,
            voiceIndependence: CANDIDATE_GATE_CRAFT.voiceIndependence,
            registerIdiomaticFit: CANDIDATE_GATE_CRAFT.registerIdiomaticFit,
        },
    };
    const tier2 = {
        ...baseEval,
        craftScoreSummary: {
            ...baseCraft,
            syntaxValidity: CANDIDATE_GATE_VALIDITY.syntaxValidity,
            sectionContractFit: CANDIDATE_GATE_CONTRACT.sectionContractFit,
            cadenceStrength: CANDIDATE_GATE_CRAFT.cadenceStrength - 0.01,  // fails craft gate
            voiceIndependence: CANDIDATE_GATE_CRAFT.voiceIndependence,
            registerIdiomaticFit: CANDIDATE_GATE_CRAFT.registerIdiomaticFit,
        },
    };
    const s3 = scoreStructureEvaluationForCandidateSelection(tier3);
    const s2 = scoreStructureEvaluationForCandidateSelection(tier2);
    // +900 vs +500 → at least 350 pts difference from tier bonus alone
    assert.ok(s3 - s2 >= 350, `Tier-3 (${s3}) should be >= 350 pts above Tier-2 (${s2})`);
});

test("tier-2 candidate scores significantly higher than tier-0 (no gate passes)", () => {
    const baseEval = makeEvaluation({ passed: false });  // tier 0 — fails validity
    const baseCraft = {
        tonalReturn: 0.8, motifSurvival: 0.8, phraseShape: 0.8,
        finalCraftScore: 0.8,
    };
    const tier2 = {
        ...makeEvaluation({ passed: true }),
        craftScoreSummary: {
            ...baseCraft,
            syntaxValidity: CANDIDATE_GATE_VALIDITY.syntaxValidity,
            sectionContractFit: CANDIDATE_GATE_CONTRACT.sectionContractFit,
            cadenceStrength: 0.3, // fails craft gate → tier 2
            voiceIndependence: 0.2,
            registerIdiomaticFit: 0.6,
        },
    };
    const tier0 = {
        ...baseEval,
        craftScoreSummary: {
            ...baseCraft,
            syntaxValidity: 0.5,
            sectionContractFit: 0.5,
            cadenceStrength: 0.3,
            voiceIndependence: 0.2,
            registerIdiomaticFit: 0.6,
        },
    };
    const s2 = scoreStructureEvaluationForCandidateSelection(tier2);
    const s0 = scoreStructureEvaluationForCandidateSelection(tier0);
    // Tier 2 (+500+bonus) vs tier 0 (0+bonus). Also passed=true adds +1000.
    assert.ok(s2 > s0, `Tier-2 (${s2}) should beat Tier-0 (${s0})`);
});

