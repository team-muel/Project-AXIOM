// @ts-check
/**
 * bench: Composition Quality Stages — Stage 1 & Stage 2
 *
 * Stage 1: 8~16마디 피아노 phrase
 *   목표: 선율 자연스러움 / 악절 호흡 / 종지 설득력 / 왼손 지지
 *   AXIOM 지표: phraseShape, planAwarePhraseGrammarScore, cadenceStrength,
 *               voiceIndependence, registerIdiomaticFit
 *
 * Stage 2: 30초~1분 A-B-A 소품
 *   목표: A 기억성 / B 대비 / A 귀환 의미 / 마지막 종지
 *   AXIOM 지표: motifSurvival, sectionContractFit, motifRecapIdentity,
 *               tonalReturn, cadenceArchitecturalWeight, finalCraftScore
 *
 * Stage 3 (현재 집중 구간)는 test/benchmark-masterpiece-direction.test.mjs 참고.
 *
 * 모든 테스트는 mock artifacts (template backend 출력 형식) 기반.
 * Real pipeline 출력이 준비되면 mock을 교체해 진짜 R&D 측정 가능.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ─── Dist imports ──────────────────────────────────────────────────────────────

const {
    computeCraftScoreSummary,
    computePlanAwareMotifDevelopmentScore,
    computeCadenceArchitecturalWeight,
    computePhraseShape,
    computeCadenceStrength,
    computeVoiceIndependence,
    computeRegisterIdiomaticFit,
    computeMotifSurvival,
    computeTonalReturn,
    computeSectionContractFit,
} = await import("../dist/core/evaluate/craftScoring.js");
const { materializeCompositionSketch } = await import("../dist/core/plan/sketch.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const noteEv = (pitch, ql = 1) => ({ type: "note", pitch, quarterLength: ql });
const restEv = (ql = 1) => ({ type: "rest", quarterLength: ql });

const PIANO_SOLO = [
    { name: "Piano", family: "keyboard", roles: ["lead", "accompaniment"] },
];

function makeMockEvaluation() {
    return { passed: true, score: 80, issues: [], strengths: [] };
}

/** Normalize a compose request through materializeCompositionSketch. */
function getNormalizedPlan(request) {
    const normalized = materializeCompositionSketch(request);
    return normalized?.compositionPlan ?? request.compositionPlan;
}

// ─── Stage 1 fixtures ─────────────────────────────────────────────────────────

/**
 * Stage 1: 단일 섹션, 8마디 피아노 phrase (presentation → cadential)
 * 오른손: 자연스러운 선율 + 반 종지 approach
 * 왼손: 반주 역할, 독립적 성부 움직임
 */
function makeStage1Phrase() {
    return {
        id: "benchmark-stages-stage1",
        workflow: "classical_symbolic",
        compositionPlan: {
            style: "classical",
            instrumentation: PIANO_SOLO,
            sections: [
                {
                    id: "s1", role: "theme_a", label: "Piano Phrase", measures: 8,
                    energy: 0.45, density: 0.40,
                    phraseFunction: "presentation", cadence: "half",
                    harmonicPlan: {
                        tonalCenter: "C major", harmonicRhythm: "slow",
                        cadence: "half", allowModulation: false,
                    },
                    motifRef: "s1",
                    phraseGrammar: {
                        targetFunction: "presentation",
                        cadenceTarget: "half",
                        minPhrasePeaks: 1,
                        hypermetricBeat: 1,
                    },
                    harmonyGrammar: {
                        pdt: { targetHarmony: "tonic", position: "opening", onset: 0 },
                        prolongationMode: "tonic",
                        cadenceTarget: "half",
                    },
                },
            ],
        },
    };
}

/**
 * Stage 1 mock artifacts: single 8-measure phrase.
 * RH: melodic line with stepwise motion, LH: independent accompaniment bass line.
 */
function makeStage1Artifacts() {
    return [
        {
            sectionId: "s1",
            role: "theme_a",
            measureCount: 8,
            melodyPitchMin: 60, melodyPitchMax: 72,
            bassPitchMin: 36, bassPitchMax: 52,
            // Right hand: stepwise melody, exactly 2 notes/measure (density = 2 meets phraseShape threshold)
            melodyEvents: [
                noteEv(60), noteEv(62), // m1
                noteEv(64), noteEv(65), // m2
                noteEv(67), noteEv(65), // m3
                noteEv(64), noteEv(62), // m4
                noteEv(64), noteEv(65), // m5
                noteEv(67), noteEv(65), // m6
                noteEv(65), noteEv(64), // m7
                noteEv(62), noteEv(60), // m8
            ],
            // Left hand: Alberti-like accompaniment, lower register
            accompanimentEvents: [
                noteEv(48, 2), noteEv(55, 2),
                noteEv(47, 2), noteEv(55, 2),
                noteEv(48, 2), noteEv(55, 2),
            ],
            noteHistory: [60, 62, 64, 65, 67, 65, 64, 62, 64, 65, 67, 65, 65, 64, 62, 60],
            capturedMotif: [2, 2, 1, 2, -2, -1],
            // Half cadence approach at end
            cadenceApproach: "half",
            phraseFunction: "presentation",
            harmonyDensity: "medium",
            // LH independent from RH: high contrary motion ratio
            textureContraryMotionRate: 0.55,
            textureIndependentMotionRate: 0.65,
        },
    ];
}

// ─── Stage 2 fixtures ─────────────────────────────────────────────────────────

/**
 * Stage 2: 3섹션 ABA 소품 (16–32마디)
 * A (theme_a): 기억 가능한 주제, 반 종지
 * B (development): 대비 (높은 에너지, 다른 조성 색채)
 * A' (recap): 귀환, 완전 종지
 */
function makeStage2ABA() {
    return {
        id: "benchmark-stages-stage2",
        workflow: "classical_symbolic",
        compositionPlan: {
            style: "classical",
            instrumentation: PIANO_SOLO,
            sections: [
                {
                    id: "s1", role: "theme_a", label: "A Theme", measures: 8,
                    energy: 0.45, density: 0.40,
                    phraseFunction: "presentation", cadence: "half",
                    harmonicPlan: {
                        tonalCenter: "G major", harmonicRhythm: "slow",
                        cadence: "half", allowModulation: false,
                    },
                    motifRef: "s1",
                    phraseGrammar: {
                        targetFunction: "presentation",
                        cadenceTarget: "half",
                        minPhrasePeaks: 1,
                        hypermetricBeat: 1,
                    },
                    harmonyGrammar: {
                        pdt: { targetHarmony: "tonic", position: "opening", onset: 0 },
                        prolongationMode: "tonic",
                        cadenceTarget: "half",
                    },
                },
                {
                    id: "s2", role: "development", label: "B Section", measures: 8,
                    energy: 0.70, density: 0.60,
                    phraseFunction: "continuation", cadence: "half",
                    harmonicPlan: {
                        tonalCenter: "E minor", harmonicRhythm: "medium",
                        cadence: "half", allowModulation: true,
                    },
                    motifRef: "s1",
                    phraseGrammar: {
                        targetFunction: "continuation",
                        cadenceTarget: "half",
                        minPhrasePeaks: 2,
                        hypermetricBeat: 1,
                    },
                    harmonyGrammar: {
                        pdt: { targetHarmony: "predominant", position: "middle", onset: 0.5 },
                        prolongationMode: "predominant",
                        cadenceTarget: "half",
                    },
                },
                {
                    id: "s3", role: "recap", label: "A Return", measures: 8,
                    energy: 0.40, density: 0.35,
                    phraseFunction: "cadential", cadence: "dominant",
                    harmonicPlan: {
                        tonalCenter: "G major", harmonicRhythm: "slow",
                        cadence: "dominant", allowModulation: false,
                    },
                    motifRef: "s1",
                    phraseGrammar: {
                        targetFunction: "cadential",
                        cadenceTarget: "dominant",
                        minPhrasePeaks: 1,
                        hypermetricBeat: 1,
                    },
                    harmonyGrammar: {
                        pdt: { targetHarmony: "tonic", position: "closing", onset: 0.75 },
                        prolongationMode: "tonic",
                        cadenceTarget: "dominant",
                    },
                },
            ],
        },
    };
}

/**
 * Stage 2 mock artifacts: ABA structure.
 * A: characteristic motif, half cadence.
 * B: higher energy, contrasting color.
 * A': exact motif return, authentic cadence.
 */
function makeStage2Artifacts() {
    return [
        {
            sectionId: "s1",
            role: "theme_a",
            measureCount: 8,
            melodyPitchMin: 62, melodyPitchMax: 74,
            bassPitchMin: 38, bassPitchMax: 55,
            melodyEvents: [
                noteEv(67), noteEv(69), noteEv(71), noteEv(72),
                noteEv(71), noteEv(69), noteEv(67), restEv(1),
            ],
            accompanimentEvents: [noteEv(50, 2), noteEv(55, 2), noteEv(54, 2), noteEv(55, 2)],
            noteHistory: [67, 69, 71, 72, 71, 69, 67],
            capturedMotif: [2, 2, 1, -1, -2, -2],
            cadenceApproach: "half",
            phraseFunction: "presentation",
            harmonyDensity: "medium",
            textureContraryMotionRate: 0.50,
            textureIndependentMotionRate: 0.60,
        },
        {
            sectionId: "s2",
            role: "development",
            measureCount: 8,
            melodyPitchMin: 64, melodyPitchMax: 76,
            bassPitchMin: 40, bassPitchMax: 56,
            melodyEvents: [
                noteEv(71, 0.5), noteEv(72, 0.5), noteEv(74, 0.5), noteEv(76, 0.5),
                noteEv(74, 0.5), noteEv(72, 0.5), restEv(1), noteEv(71, 0.5), noteEv(69, 0.5),
            ],
            accompanimentEvents: [
                noteEv(52, 1), noteEv(59, 1), noteEv(57, 2), noteEv(55, 2),
            ],
            noteHistory: [71, 72, 74, 76, 74, 72, 71, 69],
            capturedMotif: [2, 2, 1, -1, -2, -2],
            transform: { transformMode: "sequence", sequenceStride: 3 },
            cadenceApproach: "half",
            phraseFunction: "continuation",
            harmonyDensity: "rich",
            textureContraryMotionRate: 0.55,
            textureIndependentMotionRate: 0.65,
        },
        {
            sectionId: "s3",
            role: "recap",
            measureCount: 8,
            // Same range as theme_a → tonal return
            melodyPitchMin: 62, melodyPitchMax: 74,
            bassPitchMin: 38, bassPitchMax: 55,
            melodyEvents: [
                noteEv(67), noteEv(69), noteEv(71), noteEv(72),
                noteEv(71), noteEv(69), noteEv(67), noteEv(62),
            ],
            accompanimentEvents: [noteEv(50, 2), noteEv(55, 2), noteEv(50, 4)],
            noteHistory: [67, 69, 71, 72, 71, 69, 67, 62],
            // Exact motif return → high motifRecapIdentity
            capturedMotif: [2, 2, 1, -1, -2, -5],
            transform: { transformMode: "exact_return" },
            cadenceApproach: "dominant",
            lastInterval: -5,
            phraseFunction: "cadential",
            harmonyDensity: "sparse",
            textureContraryMotionRate: 0.45,
            textureIndependentMotionRate: 0.55,
        },
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 Tests: 8~16마디 피아노 phrase
// ─────────────────────────────────────────────────────────────────────────────

test("stages-bench Stage1: single-section phrase plan normalizes correctly", () => {
    const request = makeStage1Phrase();
    const plan = getNormalizedPlan(request);

    assert.ok(plan, "Stage 1: normalized plan must be defined");
    assert.ok(Array.isArray(plan.sections), "Stage 1: plan must have sections array");
    assert.equal(plan.sections.length, 1, "Stage 1: single-section phrase must have exactly 1 section");

    const s1 = plan.sections[0];
    assert.equal(s1.role, "theme_a", "Stage 1: section role must be theme_a");
    assert.ok(s1.phraseGrammar, "Stage 1: phraseGrammar must be present");
    assert.ok(s1.phraseGrammar.structure, "Stage 1: phraseGrammar.structure must be injected by materialize");

    // Instrument: must be keyboard (piano)
    const instr = request.compositionPlan.instrumentation;
    assert.equal(instr.length, 1, "Stage 1: solo instrument");
    assert.equal(instr[0].family, "keyboard", "Stage 1: must be keyboard family");
});

test("stages-bench Stage1: phraseShape ≥ 0.55 for well-formed piano phrase", () => {
    const plan = getNormalizedPlan(makeStage1Phrase());
    const artifacts = makeStage1Artifacts();
    const result = computePhraseShape(artifacts, plan);

    assert.ok(typeof result.score === "number", "phraseShape must return a number");
    assert.ok(result.score >= 0.55, `phraseShape = ${result.score.toFixed(3)} must be ≥ 0.55 for natural phrase`);
});

test("stages-bench Stage1: cadenceStrength ≥ 0.3 (half cadence at phrase end)", () => {
    const artifacts = makeStage1Artifacts();
    const result = computeCadenceStrength(artifacts);

    assert.ok(typeof result.score === "number", "cadenceStrength must return a number");
    assert.ok(result.score >= 0.3, `cadenceStrength = ${result.score.toFixed(3)} must be ≥ 0.3`);
});

test("stages-bench Stage1: voiceIndependence ≥ 0.4 (LH independent from RH)", () => {
    const artifacts = makeStage1Artifacts();
    const result = computeVoiceIndependence(artifacts);

    assert.ok(typeof result.score === "number", "voiceIndependence must return a number");
    assert.ok(result.score >= 0.4, `voiceIndependence = ${result.score.toFixed(3)} must be ≥ 0.4 (LH supports RH)`);
});

test("stages-bench Stage1: registerIdiomaticFit ≥ 0.4 (piano range coverage)", () => {
    const plan = getNormalizedPlan(makeStage1Phrase());
    const artifacts = makeStage1Artifacts();
    const result = computeRegisterIdiomaticFit(artifacts, plan);

    assert.ok(typeof result.score === "number", "registerIdiomaticFit must return a number");
    assert.ok(result.score >= 0.4, `registerIdiomaticFit = ${result.score.toFixed(3)} must be ≥ 0.4`);
});

test("stages-bench Stage1: craftScoreSummary computes without crash for single-section plan", () => {
    const plan = getNormalizedPlan(makeStage1Phrase());
    const artifacts = makeStage1Artifacts();
    const mockEval = makeMockEvaluation();
    const cs = computeCraftScoreSummary(artifacts, plan, mockEval);

    // Single-section plan: no recap → tonalReturn and motifSurvival may be neutral
    assert.ok(typeof cs.finalCraftScore === "number", "finalCraftScore must be a number");
    assert.ok(cs.finalCraftScore >= 0 && cs.finalCraftScore <= 1, "finalCraftScore must be in [0,1]");
    assert.ok(typeof cs.phraseShape === "number", "phraseShape must be present in summary");
    assert.ok(typeof cs.voiceIndependence === "number", "voiceIndependence must be present in summary");
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 Tests: 30초~1분 A-B-A 소품
// ─────────────────────────────────────────────────────────────────────────────

test("stages-bench Stage2: ABA plan normalizes with theme_a + development + recap", () => {
    const request = makeStage2ABA();
    const plan = getNormalizedPlan(request);

    assert.ok(plan, "Stage 2: normalized plan must be defined");
    assert.equal(plan.sections.length, 3, "Stage 2: ABA must have exactly 3 sections");

    const roles = plan.sections.map((s) => s.role);
    assert.ok(roles.includes("theme_a"),   "Stage 2: must have theme_a (A)");
    assert.ok(roles.includes("development"), "Stage 2: must have development (B)");
    assert.ok(roles.includes("recap"),     "Stage 2: must have recap (A')");

    // B section must contrast: higher energy than A
    const a = plan.sections.find((s) => s.role === "theme_a");
    const b = plan.sections.find((s) => s.role === "development");
    assert.ok(b.energy > a.energy, `Stage 2: B energy (${b.energy}) must be higher than A energy (${a.energy})`);
});

test("stages-bench Stage2: motifSurvival ≥ 0.4 (A motif persists across sections)", () => {
    const artifacts = makeStage2Artifacts();
    const result = computeMotifSurvival(artifacts);

    assert.ok(typeof result.score === "number", "motifSurvival must return a number");
    assert.ok(result.score >= 0.4, `motifSurvival = ${result.score.toFixed(3)} must be ≥ 0.4 (A motif remembered)`);
});

test("stages-bench Stage2: tonalReturn ≥ 0.4 (recap returns to home key)", () => {
    const plan = getNormalizedPlan(makeStage2ABA());
    const artifacts = makeStage2Artifacts();
    const result = computeTonalReturn(artifacts, plan);

    assert.ok(typeof result.score === "number", "tonalReturn must return a number");
    assert.ok(result.score >= 0.4, `tonalReturn = ${result.score.toFixed(3)} must be ≥ 0.4 (home key return)`);
});

test("stages-bench Stage2: sectionContractFit ≥ 0.4 (B section contrasts A)", () => {
    const plan = getNormalizedPlan(makeStage2ABA());
    const artifacts = makeStage2Artifacts();
    const result = computeSectionContractFit(artifacts, plan);

    assert.ok(typeof result.score === "number", "sectionContractFit must return a number");
    assert.ok(result.score >= 0.4, `sectionContractFit = ${result.score.toFixed(3)} must be ≥ 0.4 (B contrasts A)`);
});

test("stages-bench Stage2: cadenceArchitecturalWeight ≥ 0.3 (recap has stronger cadence)", () => {
    const plan = getNormalizedPlan(makeStage2ABA());
    const artifacts = makeStage2Artifacts();
    const result = computeCadenceArchitecturalWeight(artifacts, plan);

    assert.ok(typeof result.score === "number", "cadenceArchitecturalWeight must return a number");
    assert.ok(result.score >= 0.3, `cadenceArchitecturalWeight = ${result.score.toFixed(3)} must be ≥ 0.3`);
});

test("stages-bench Stage2: planAwareMotifDevelopmentScore: recap section has exact_return transform", () => {
    const plan = getNormalizedPlan(makeStage2ABA());
    const artifacts = makeStage2Artifacts();
    const result = computePlanAwareMotifDevelopmentScore(artifacts, plan);

    assert.ok(typeof result.score === "number", "planAwareMotifDevelopmentScore must be a number");
    assert.ok(result.score >= 0 && result.score <= 1, "score must be in [0,1]");

    // Recap section should be recognized with exact_return transform
    const recapArtifact = artifacts.find((a) => a.role === "recap");
    assert.equal(recapArtifact.transform.transformMode, "exact_return", "recap artifact must use exact_return transform");
});

test("stages-bench Stage2: craftScoreSummary finalCraftScore ≥ 0.35 for well-formed ABA", () => {
    const plan = getNormalizedPlan(makeStage2ABA());
    const artifacts = makeStage2Artifacts();
    const mockEval = makeMockEvaluation();
    const cs = computeCraftScoreSummary(artifacts, plan, mockEval);

    assert.ok(typeof cs.finalCraftScore === "number", "finalCraftScore must be a number");
    assert.ok(cs.finalCraftScore >= 0.35,
        `finalCraftScore = ${cs.finalCraftScore.toFixed(3)} must be ≥ 0.35 for well-formed ABA`);

    // Verify all key ABA dimensions are present
    assert.ok(typeof cs.tonalReturn === "number",    "tonalReturn must be in summary");
    assert.ok(typeof cs.motifSurvival === "number",  "motifSurvival must be in summary");
    assert.ok(typeof cs.phraseShape === "number",    "phraseShape must be in summary");
});
