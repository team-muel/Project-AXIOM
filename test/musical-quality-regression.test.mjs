/**
 * Musical Quality Regression Tests
 *
 * "파이프라인이 돌아가는가"가 아니라 "구조적으로 좋은 곡이 나오는가"를 검증한다.
 *
 * 테스트 범위:
 *  SONATA FORM
 *  [1]  theme_a가 recap에 알아볼 수 있게 복귀하면 motifSurvival이 높아야 한다
 *  [2]  recap이 theme_a와 반대 contour를 가지면 motifSurvival이 낮아야 한다
 *  [3]  development가 theme_a를 사용하면 섹션 계약(sectionContractFit)이 통과해야 한다
 *  [4]  final cadence가 home key로 닫히면 tonalReturn이 높아야 한다
 *  [5]  final cadence가 home key와 다른 key로 닫히면 tonalReturn이 낮아야 한다
 *  [6]  development에서 에너지(energy)가 상승하고 recap에서 해소되면 phraseShape이 올바르게 평가돼야 한다
 *  [7]  final section에 dominant cadence approach가 없으면 cadenceStrength가 낮아야 한다
 *  [8]  final section에 dominant cadence approach가 있으면 cadenceStrength가 높아야 한다
 *
 *  FORM CONTRACT
 *  [9]  theme_a + development + recap 3-section 소나타는 계약을 통과해야 한다
 *  [10] 섹션 수가 맞지 않으면 계약을 통과하지 못해야 한다
 *  [11] theme_b가 있는 4-section 소나타도 계약을 통과해야 한다
 *
 *  FULL CRAFT SCORE INTEGRATION
 *  [12] 구조적으로 좋은 소나타는 finalCraftScore >= 0.65를 달성해야 한다
 *  [13] motif가 recap에 없고 종지가 약한 소나타는 finalCraftScore < 0.65여야 한다
 *  [14] craftScorePassesQualityGate은 좋은 소나타에서 통과해야 한다
 *  [15] craftScorePassesQualityGate는 syntaxValidity 실패 시 거부해야 한다
 *
 *  PIANO MELODY CLARITY
 *  [16] 선율 velocity가 반주 velocity보다 높으면 melodicClarity가 높아야 한다
 *  [17] 선율 velocity가 반주 velocity와 같으면 melodicClarity가 낮아야 한다
 *  [18] 반주 melody보다 낮은 register에 있으면 registerSpacing이 좋아야 한다
 *  [19] 반주가 melody보다 높은 register를 침범하면 registerSpacing이 나빠야 한다
 *
 *  TENSION CURVE (sonata cycle)
 *  [20] development에서 craft score가 높고 recap이 상대적으로 낮으면 tensionArcMatch 보정이 작동해야 한다
 */

import test from "node:test";
import assert from "node:assert/strict";

const {
    computeSectionContractFit,
    computeCadenceStrength,
    computeTonalReturn,
    computeMotifSurvival,
    computeVoiceIndependence,
    computePhraseShape,
    computeRegisterIdiomaticFit,
    computeSyntaxValidity,
    computeCraftScoreSummary,
} = await import("../dist/core/evaluate/craftScoring.js");

const {
    computeMelodicClarity,
    computeRegisterSpacing,
} = await import("../dist/core/evaluate/pianoCraftScoring.js");

const {
    craftScorePassesQualityGate,
    CRAFT_QUALITY_GATE,
} = await import("../dist/core/generate/structureSelection.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function note(pitch, quarterLength = 1.0) {
    return { type: "note", pitch, quarterLength };
}

/**
 * Build a SectionArtifactSummary fixture.
 * @param {string} sectionId
 * @param {string} role
 * @param {object} [overrides]
 */
function makeSection(sectionId, role, overrides = {}) {
    return {
        sectionId,
        role,
        measureCount: 4,
        melodyEvents: [],
        accompanimentEvents: [],
        noteHistory: [],
        ...overrides,
    };
}

/**
 * Standard 3-section sonata plan: theme_a / development / recap.
 * @param {object} [overrides]
 */
function sonataPlan(overrides = {}) {
    return {
        version: "1",
        brief: "Regression test sonata",
        mood: [],
        form: "sonata",
        key: "C major",
        meter: "4/4",
        tempo: 120,
        workflow: "symbolic_only",
        motifPolicy: {},
        rationale: "",
        instrumentation: [
            { name: "Piano", family: "keyboard", roles: ["lead", "bass"] },
        ],
        sections: [
            { id: "s1", role: "theme_a",    label: "Primary theme", measures: 8,  energy: 0.5, density: 0.5 },
            { id: "s2", role: "development", label: "Development",  measures: 8,  energy: 0.8, density: 0.7 },
            { id: "s3", role: "recap",       label: "Recap",        measures: 8,  energy: 0.4, density: 0.4 },
        ],
        ...overrides,
    };
}

/** A baseline passed evaluation (no hard failures). */
function passedEval(overrides = {}) {
    return { passed: true, score: 80, issues: [], strengths: [], ...overrides };
}

// ─── Ascending and descending note histories ──────────────────────────────────
// Ascending: C4-D4-E4-F4-G4 = [60,62,64,65,67]
const ASCENDING = [60, 62, 64, 65, 67];
// Descending: G4-F4-E4-D4-C4 = [67,65,64,62,60]
const DESCENDING = [67, 65, 64, 62, 60];

// ═══════════════════════════════════════════════════════════════════════════════
// SONATA FORM — Motif Survival
// ═══════════════════════════════════════════════════════════════════════════════

// [1]
test("motifSurvival: theme_a ascending contour returns in recap → high score", () => {
    const artifacts = [
        makeSection("s1", "theme_a",    { noteHistory: ASCENDING }),
        makeSection("s2", "development",{ noteHistory: [64, 67, 69, 71, 72] }),  // different but ok
        makeSection("s3", "recap",      { noteHistory: [60, 62, 64, 65, 67] }), // same ascending contour
    ];
    const { score } = computeMotifSurvival(artifacts);
    assert.ok(score >= 0.75, `Expected motifSurvival >= 0.75 when theme_a returns in recap, got ${score}`);
});

// [2]
test("motifSurvival: recap has opposite contour to theme_a → low score", () => {
    const artifacts = [
        makeSection("s1", "theme_a", { noteHistory: ASCENDING }),
        makeSection("s3", "recap",   { noteHistory: DESCENDING }), // reversed
    ];
    const { score } = computeMotifSurvival(artifacts);
    assert.ok(score <= 0.5, `Expected motifSurvival <= 0.5 when contour is reversed, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SONATA FORM — Section Contract Fit
// ═══════════════════════════════════════════════════════════════════════════════

// [3]
test("sectionContractFit: 3-section sonata with matching artifacts passes", () => {
    const plan = sonataPlan();
    const artifacts = [
        makeSection("s1", "theme_a",     { measureCount: 8 }),
        makeSection("s2", "development", { measureCount: 8 }),
        makeSection("s3", "recap",       { measureCount: 8 }),
    ];
    const { score } = computeSectionContractFit(artifacts, plan);
    assert.ok(score >= 0.8, `Expected sectionContractFit >= 0.8 for matching 3-section sonata, got ${score}`);
});

// [10]
test("sectionContractFit: only 1 artifact for a 3-section plan → low score", () => {
    const plan = sonataPlan();
    const artifacts = [
        makeSection("s1", "theme_a", { measureCount: 8 }),
    ];
    const { score } = computeSectionContractFit(artifacts, plan);
    assert.ok(score < 0.7, `Expected sectionContractFit < 0.7 for incomplete artifacts, got ${score}`);
});

// [11]
test("sectionContractFit: 4-section sonata (theme_a/theme_b/development/recap) passes", () => {
    const plan = sonataPlan({
        sections: [
            { id: "s1", role: "theme_a",     label: "Primary theme",   measures: 8, energy: 0.5, density: 0.5 },
            { id: "s2", role: "theme_b",     label: "Secondary theme", measures: 8, energy: 0.6, density: 0.5 },
            { id: "s3", role: "development", label: "Development",     measures: 8, energy: 0.8, density: 0.7 },
            { id: "s4", role: "recap",       label: "Recap",           measures: 8, energy: 0.4, density: 0.4 },
        ],
    });
    const artifacts = [
        makeSection("s1", "theme_a",     { measureCount: 8 }),
        makeSection("s2", "theme_b",     { measureCount: 8 }),
        makeSection("s3", "development", { measureCount: 8 }),
        makeSection("s4", "recap",       { measureCount: 8 }),
    ];
    const { score } = computeSectionContractFit(artifacts, plan);
    assert.ok(score >= 0.8, `Expected sectionContractFit >= 0.8 for 4-section sonata, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SONATA FORM — Tonal Return
// ═══════════════════════════════════════════════════════════════════════════════

// [4]
test("tonalReturn: recap with tonicization window on home key C → high score", () => {
    const plan = sonataPlan(); // key: "C major"
    const artifacts = [
        makeSection("s1", "theme_a", {}),
        makeSection("s3", "recap", {
            tonicizationWindows: [
                { keyTarget: "C", startMeasure: 1, endMeasure: 8, emphasis: "strong", cadence: "PAC" },
            ],
        }),
    ];
    const { score } = computeTonalReturn(artifacts, plan);
    assert.ok(score >= 0.8, `Expected tonalReturn >= 0.8 for C→C return, got ${score}`);
});

// [5]
test("tonalReturn: recap tonicization window on foreign key → lower score", () => {
    const plan = sonataPlan(); // key: "C major"
    const artifacts = [
        makeSection("s1", "theme_a", {}),
        makeSection("s3", "recap", {
            // G major — not home key C
            tonicizationWindows: [
                { keyTarget: "G", startMeasure: 1, endMeasure: 8, emphasis: "strong", cadence: "PAC" },
            ],
        }),
    ];
    const { score: foreignScore } = computeTonalReturn(artifacts, plan);
    // And compare to home key
    const artifactsHome = [
        makeSection("s1", "theme_a", {}),
        makeSection("s3", "recap", {
            tonicizationWindows: [
                { keyTarget: "C", startMeasure: 1, endMeasure: 8, emphasis: "strong", cadence: "PAC" },
            ],
        }),
    ];
    const { score: homeScore } = computeTonalReturn(artifactsHome, plan);
    assert.ok(
        homeScore > foreignScore,
        `Home key return (${homeScore}) should score higher than foreign key (${foreignScore})`,
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
// SONATA FORM — Cadence Strength
// ═══════════════════════════════════════════════════════════════════════════════

// [7]
test("cadenceStrength: final section without dominant approach → low score", () => {
    const artifacts = [
        makeSection("s3", "recap", {
            cadenceApproach: "tonic",   // tonic direct — not a strong dominant approach
            lastInterval: 0,
        }),
    ];
    const { score: weakScore } = computeCadenceStrength(artifacts);

    const artifactsStrong = [
        makeSection("s3", "recap", {
            cadenceApproach: "dominant",
            lastInterval: 2,
        }),
    ];
    const { score: strongScore } = computeCadenceStrength(artifactsStrong);

    assert.ok(
        strongScore > weakScore,
        `Dominant cadence approach (${strongScore}) should beat tonic direct (${weakScore})`,
    );
});

// [8]
test("cadenceStrength: final section with dominant approach + stepwise resolution → high score", () => {
    const artifacts = [
        makeSection("s1", "theme_a", {}),
        makeSection("s3", "recap", {
            cadenceApproach: "dominant",
            lastInterval: 1,  // semitone stepwise resolution (leading tone → tonic)
        }),
    ];
    const { score } = computeCadenceStrength(artifacts);
    assert.ok(score >= 0.6, `Expected cadenceStrength >= 0.6 with dominant approach, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SONATA FORM — Phrase Shape (tension proxy)
// ═══════════════════════════════════════════════════════════════════════════════

// [6]
test("phraseShape: presentation section with high density and cadential section with dominant approach both match", () => {
    const plan = sonataPlan();
    const artifacts = [
        makeSection("s1", "theme_a", {
            phraseFunction: "presentation",
            melodyEvents: Array.from({ length: 12 }, (_, i) => note(60 + i)), // 12 notes / 4 measures = density 3
        }),
        makeSection("s2", "development", {
            phraseFunction: "continuation",
            melodyEvents: Array.from({ length: 8 }, (_, i) => note(64 + i)),
        }),
        makeSection("s3", "recap", {
            phraseFunction: "cadential",
            cadenceApproach: "dominant",
            melodyEvents: Array.from({ length: 4 }, (_, i) => note(60 + i)),
        }),
    ];
    const { score } = computePhraseShape(artifacts, plan);
    assert.ok(score >= 0.6, `Expected phraseShape >= 0.6 for well-structured phrase functions, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FULL CRAFT SCORE INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

// [12]
test("integration: structurally good sonata achieves finalCraftScore >= 0.65", () => {
    const plan = sonataPlan();
    const evaluation = passedEval();
    const artifacts = [
        makeSection("s1", "theme_a", {
            noteHistory:  ASCENDING,
            measureCount: 8,
            melodyPitchMin: 60, melodyPitchMax: 84,
            bassPitchMin:  36, bassPitchMax:  60,
            phraseFunction: "presentation",
            melodyEvents: Array.from({ length: 12 }, (_, i) => note(60 + i % 7)),
            accompanimentEvents: Array.from({ length: 6 }, (_, i) => note(48 + i % 5)),
            textureContraryMotionRate: 0.6,
            textureIndependentMotionRate: 0.5,
            cadenceApproach: "dominant",
        }),
        makeSection("s2", "development", {
            noteHistory: [62, 64, 67, 69, 71],
            measureCount: 8,
            melodyPitchMin: 60, melodyPitchMax: 84,
            bassPitchMin:  36, bassPitchMax:  60,
            phraseFunction: "continuation",
            melodyEvents: Array.from({ length: 10 }, (_, i) => note(62 + i % 9)),
            accompanimentEvents: Array.from({ length: 5 }, (_, i) => note(50 + i % 4)),
            textureContraryMotionRate: 0.7,
        }),
        makeSection("s3", "recap", {
            noteHistory: ASCENDING,   // same contour as theme_a → high motifSurvival
            measureCount: 8,
            melodyPitchMin: 60, melodyPitchMax: 84,
            bassPitchMin:  36, bassPitchMax:  60,
            phraseFunction: "cadential",
            cadenceApproach: "dominant",
            lastInterval: 2,
            melodyEvents: Array.from({ length: 8 }, (_, i) => note(60 + i % 7)),
            accompanimentEvents: Array.from({ length: 4 }, (_, i) => note(48 + i % 5)),
            tonicizationWindows: [
                { keyTarget: "C", startMeasure: 1, endMeasure: 8, emphasis: "strong", cadence: "PAC" },
            ],
        }),
    ];
    const summary = computeCraftScoreSummary(artifacts, plan, evaluation);
    assert.ok(
        summary.finalCraftScore >= 0.65,
        `Expected finalCraftScore >= 0.65 for good sonata, got ${summary.finalCraftScore}. Dimensions: ${JSON.stringify(summary)}`,
    );
});

// [13]
test("integration: sonata with no motif return and weak cadence scores < 0.65", () => {
    const plan = sonataPlan();
    const evaluation = passedEval();
    const artifacts = [
        makeSection("s1", "theme_a", {
            noteHistory: ASCENDING,
            measureCount: 8,
            melodyEvents: Array.from({ length: 4 }, (_, i) => note(60 + i)),
            accompanimentEvents: Array.from({ length: 4 }, (_, i) => note(60 + i)), // same rhythm = low voiceIndependence
            textureContraryMotionRate: 0.0,
            textureIndependentMotionRate: 0.0,
        }),
        makeSection("s2", "development", {
            noteHistory: [62, 64, 67, 69, 71],
            measureCount: 8,
            melodyEvents: [],
            accompanimentEvents: [],
        }),
        makeSection("s3", "recap", {
            // Opposite contour — motif is NOT recognized
            noteHistory: DESCENDING,
            measureCount: 8,
            // No cadenceApproach — weak ending
            melodyEvents: [],
            accompanimentEvents: [],
        }),
    ];
    const summary = computeCraftScoreSummary(artifacts, plan, evaluation);
    assert.ok(
        summary.finalCraftScore < 0.65,
        `Expected finalCraftScore < 0.65 for weak sonata, got ${summary.finalCraftScore}`,
    );
});

// [14]
test("integration: quality gate passes for strong sonata craft score", () => {
    const craft = {
        syntaxValidity:      CRAFT_QUALITY_GATE.syntaxValidity,
        sectionContractFit:  CRAFT_QUALITY_GATE.sectionContractFit,
        registerIdiomaticFit: CRAFT_QUALITY_GATE.registerIdiomaticFit,
        cadenceStrength:     0.82,
        tonalReturn:         0.85,
        motifSurvival:       0.80,
        voiceIndependence:   0.75,
        phraseShape:         0.78,
        finalCraftScore:     0.80,
    };
    assert.strictEqual(craftScorePassesQualityGate(craft), true);
});

// [15]
test("integration: quality gate rejects when syntax validity fails", () => {
    const craft = {
        syntaxValidity:      0.0,  // hard failure
        sectionContractFit:  CRAFT_QUALITY_GATE.sectionContractFit,
        registerIdiomaticFit: CRAFT_QUALITY_GATE.registerIdiomaticFit,
        cadenceStrength:     0.85,
        tonalReturn:         0.85,
        motifSurvival:       0.85,
        voiceIndependence:   0.85,
        phraseShape:         0.85,
        finalCraftScore:     0.80,
    };
    assert.strictEqual(craftScorePassesQualityGate(craft), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PIANO MELODY CLARITY
// ═══════════════════════════════════════════════════════════════════════════════

function cleanLayout(overrides = {}) {
    return {
        rightHandPitchMin: 64,
        rightHandPitchMax: 88,
        leftHandPitchMin:  36,
        leftHandPitchMax:  60,
        maxRightHandSpan:  12,
        maxLeftHandSpan:   10,
        handCrossingCount: 0,
        handCollisionCount: 0,
        avgChordVoiceCount: 4,
        pedalEventCount:   8,
        playableSpanFit:   0.95,
        ...overrides,
    };
}

// [16]
// computeMelodicClarity measures density and leap ratios — dense stepwise melody is most clear.
test("piano: dense stepwise melody → high melodicClarity", () => {
    // 16 stepwise notes over 4 measures (density=4/m), all intervals ≤ 2 semitones
    const stepwiseNotes = [60,62,64,65,67,69,71,72,71,69,67,65,64,62,60,59].map(p => note(p, 0.5));
    const section = makeSection("s1", "theme_a", {
        measureCount: 4,
        melodyEvents: stepwiseNotes,
    });
    const { score } = computeMelodicClarity([section]);
    assert.ok(score >= 0.7, `Expected melodicClarity >= 0.7 for dense stepwise melody, got ${score}`);
});

// [17]
test("piano: jumpy melody with large leaps scores lower than stepwise melody", () => {
    // Jumpy: lots of intervals > 7 semitones (major 5th+)
    const jumpyNotes = [60,72,48,84,60,72,48,84].map(p => note(p, 1.0));
    const sectionJumpy = makeSection("s1", "theme_a", {
        measureCount: 4,
        melodyEvents: jumpyNotes,
    });

    // Stepwise: small steps only
    const stepwiseNotes = [60,62,64,65,67,69,67,65,64,62,60,62].map(p => note(p, 0.5));
    const sectionSmooth = makeSection("s1", "theme_a", {
        measureCount: 4,
        melodyEvents: stepwiseNotes,
    });

    const { score: jumpyScore }  = computeMelodicClarity([sectionJumpy]);
    const { score: smoothScore } = computeMelodicClarity([sectionSmooth]);
    assert.ok(
        smoothScore > jumpyScore,
        `Smooth melody (${smoothScore}) should score higher than jumpy melody (${jumpyScore})`,
    );
});

// [18]
test("piano: accompaniment strictly below melody register → good registerSpacing", () => {
    const layout = cleanLayout({
        rightHandPitchMin: 64,  // melody: E4–C6 (center ~74)
        rightHandPitchMax: 84,
        leftHandPitchMin:  36,  // accompaniment: C2–C4 (center ~48)
        leftHandPitchMax:  60,
        handCrossingCount: 0,
        handCollisionCount: 0,
    });
    // gap = 74 - 48 = 26 semitones → score = 1.0
    const { score } = computeRegisterSpacing([], layout);
    assert.ok(score >= 0.8, `Expected registerSpacing >= 0.8 with well-separated hands, got ${score}`);
});

// [19]
test("piano: left hand pitches invade right hand register → poor registerSpacing", () => {
    const layoutGood = cleanLayout({
        rightHandPitchMin: 64, rightHandPitchMax: 88,  // center = 76
        leftHandPitchMin:  36, leftHandPitchMax:  60,  // center = 48, gap = 28
        handCrossingCount: 0, handCollisionCount: 0,
    });
    const layoutBad = cleanLayout({
        rightHandPitchMin: 64, rightHandPitchMax: 88,  // center = 76
        leftHandPitchMin:  64, leftHandPitchMax:  88,  // center = 76, gap = 0
        handCrossingCount: 8, handCollisionCount: 5,
    });
    const { score: goodScore } = computeRegisterSpacing([], layoutGood);
    const { score: badScore }  = computeRegisterSpacing([], layoutBad);
    assert.ok(
        goodScore > badScore,
        `Clean register separation (${goodScore}) should beat hand invasion (${badScore})`,
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
// TENSION CURVE — development peak vs recap resolution
// ═══════════════════════════════════════════════════════════════════════════════

// [20] Indirect test via voiceIndependence — development texture is more complex.
//      If development has high contrary motion and theme/recap is more homophonic,
//      voiceIndependence for the full piece should still reflect the richer texture.
test("voiceIndependence: development with high contrary motion elevates overall voice independence", () => {
    const homophonic = makeSection("s1", "theme_a", {
        textureContraryMotionRate: 0.1,
        textureIndependentMotionRate: 0.1,
    });
    const developmental = makeSection("s2", "development", {
        textureContraryMotionRate: 0.85,   // polyphonic development
        textureIndependentMotionRate: 0.80,
    });
    const recap = makeSection("s3", "recap", {
        textureContraryMotionRate: 0.2,
        textureIndependentMotionRate: 0.2,
    });

    const { score: withDev } = computeVoiceIndependence([homophonic, developmental, recap]);
    const { score: withoutDev } = computeVoiceIndependence([homophonic, recap]);

    assert.ok(
        withDev > withoutDev,
        `With developmental polyphony (${withDev}) should beat without (${withoutDev})`,
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: MOTIF TRANSFORM VARIETY
// ═══════════════════════════════════════════════════════════════════════════════

const {
    computeMotifTransformVariety,
    computeHarmonicRhythmVariance,
    computeVoiceLeadingScore,
    computeTonicizationDepthScore,
    computePlanAwarePhraseGrammarScore,
} = await import("../dist/core/evaluate/craftScoring.js");

// [21] Sections with diverse transform modes score higher than single-mode
test("motifTransformVariety: multiple distinct transform modes → higher score than one mode", () => {
    const multiTransform = [
        makeSection("s1", "theme_a",     { transform: { transformMode: "sequence",      rhythmTransform: "augmentation" } }),
        makeSection("s2", "development", { transform: { transformMode: "fragmentation", rhythmTransform: "diminution"  } }),
        makeSection("s3", "recap",       { transform: { transformMode: "inversion",      rhythmTransform: "augmentation" } }),
    ];
    const singleTransform = [
        makeSection("s1", "theme_a",     { transform: { transformMode: "literal" } }),
        makeSection("s2", "development", { transform: { transformMode: "literal" } }),
        makeSection("s3", "recap",       { transform: { transformMode: "literal" } }),
    ];
    const { score: multiScore }  = computeMotifTransformVariety(multiTransform);
    const { score: singleScore } = computeMotifTransformVariety(singleTransform);
    assert.ok(
        multiScore > singleScore,
        `Multi-mode transforms (${multiScore}) should beat single mode (${singleScore})`,
    );
});

// [22] Diverse phrase functions alone give partial transform variety score
test("motifTransformVariety: diverse phrase functions give partial score when no transform field", () => {
    const artifacts = [
        makeSection("s1", "theme_a",     { phraseFunction: "presentation" }),
        makeSection("s2", "development", { phraseFunction: "continuation" }),
        makeSection("s3", "recap",       { phraseFunction: "cadential" }),
        makeSection("s4", "outro",       { phraseFunction: "developmental" }),
    ];
    const { score } = computeMotifTransformVariety(artifacts);
    assert.ok(score >= 0.4, `Expected phrase-function variety to yield score >= 0.4, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: HARMONIC RHYTHM VARIANCE
// ═══════════════════════════════════════════════════════════════════════════════

// [23] Plan with slow + fast harmonic rhythm sections has higher variance than uniform
test("harmonicRhythmVariance: slow→fast contrast scores higher than all-medium", () => {
    const contrastPlan = {
        ...sonataPlan(),
        sections: [
            { id: "s1", role: "theme_a",     label: "A",    measures: 8,  energy: 0.5, density: 0.5, harmonicPlan: { harmonicRhythm: "slow" } },
            { id: "s2", role: "development", label: "Dev",  measures: 8,  energy: 0.8, density: 0.7, harmonicPlan: { harmonicRhythm: "fast" } },
            { id: "s3", role: "recap",       label: "Rec",  measures: 8,  energy: 0.4, density: 0.4, harmonicPlan: { harmonicRhythm: "slow" } },
        ],
    };
    const uniformPlan = {
        ...sonataPlan(),
        sections: [
            { id: "s1", role: "theme_a",     label: "A",   measures: 8, energy: 0.5, density: 0.5, harmonicPlan: { harmonicRhythm: "medium" } },
            { id: "s2", role: "development", label: "Dev", measures: 8, energy: 0.8, density: 0.7, harmonicPlan: { harmonicRhythm: "medium" } },
            { id: "s3", role: "recap",       label: "Rec", measures: 8, energy: 0.4, density: 0.4, harmonicPlan: { harmonicRhythm: "medium" } },
        ],
    };
    const artifacts = [
        makeSection("s1", "theme_a"),
        makeSection("s2", "development"),
        makeSection("s3", "recap"),
    ];
    const { score: contrastScore } = computeHarmonicRhythmVariance(artifacts, contrastPlan);
    const { score: uniformScore }  = computeHarmonicRhythmVariance(artifacts, uniformPlan);
    assert.ok(
        contrastScore > uniformScore,
        `Slow/fast contrast (${contrastScore}) should beat all-medium (${uniformScore})`,
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: VOICE LEADING SCORE
// ═══════════════════════════════════════════════════════════════════════════════

// [24] High contrary motion + stepwise final resolution → high voiceLeadingScore
test("voiceLeadingScore: high contrary motion + stepwise final resolution → high score", () => {
    const artifacts = [
        makeSection("s1", "theme_a", {
            textureContraryMotionRate:    0.75,
            textureIndependentMotionRate: 0.65,
            melodyEvents: [60,62,64,65,67,69,71,72].map(p => note(p, 0.5)),
        }),
        makeSection("s2", "development", {
            textureContraryMotionRate:    0.80,
            textureIndependentMotionRate: 0.70,
            melodyEvents: [67,69,71,72,71,69,67,65].map(p => note(p, 0.5)),
        }),
        makeSection("s3", "recap", {
            textureContraryMotionRate:    0.70,
            textureIndependentMotionRate: 0.60,
            melodyEvents: [64,65,67,65,64,62,61,60].map(p => note(p, 0.5)),
            lastInterval: 1,  // stepwise
        }),
    ];
    const { score } = computeVoiceLeadingScore(artifacts);
    assert.ok(score >= 0.6, `Expected voiceLeadingScore >= 0.6, got ${score}`);
});

// [25] Low contrary motion + large leaps → low voiceLeadingScore
test("voiceLeadingScore: parallel motion + large leaps → low score", () => {
    const smoothArtifacts = [
        makeSection("s1", "theme_a", {
            textureContraryMotionRate:    0.75,
            textureIndependentMotionRate: 0.65,
            melodyEvents: [60,62,64,65,67,69,71,72].map(p => note(p, 0.5)),
            lastInterval: 1,
        }),
    ];
    const roughArtifacts = [
        makeSection("s1", "theme_a", {
            textureContraryMotionRate:    0.05,  // parallel motion
            textureIndependentMotionRate: 0.10,
            melodyEvents: [60,72,48,84,60,72,48,84].map(p => note(p, 1.0)), // octave leaps
            lastInterval: 12, // octave leap at end
        }),
    ];
    const { score: smoothScore } = computeVoiceLeadingScore(smoothArtifacts);
    const { score: roughScore }  = computeVoiceLeadingScore(roughArtifacts);
    assert.ok(
        smoothScore > roughScore,
        `Smooth voice leading (${smoothScore}) should beat rough/parallel (${roughScore})`,
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: TONICIZATION DEPTH SCORE
// ═══════════════════════════════════════════════════════════════════════════════

// [26] Development with multiple foreign tonicizations → high tonicizationDepthScore
test("tonicizationDepthScore: development with multiple foreign keys → high score", () => {
    const plan = sonataPlan(); // key: "C major"
    const artifacts = [
        makeSection("s1", "theme_a", {
            tonicizationWindows: [{ keyTarget: "C", startMeasure: 1, endMeasure: 8, emphasis: "strong", cadence: "PAC" }],
        }),
        makeSection("s2", "development", {
            tonicizationWindows: [
                { keyTarget: "G", startMeasure: 1, endMeasure: 4, emphasis: "strong", cadence: "PAC" },
                { keyTarget: "E", startMeasure: 5, endMeasure: 8, emphasis: "mild",   cadence: "HC" },
                { keyTarget: "A", startMeasure: 9, endMeasure: 12, emphasis: "strong", cadence: "PAC" },
            ],
        }),
        makeSection("s3", "recap", {
            tonicizationWindows: [{ keyTarget: "C", startMeasure: 1, endMeasure: 8, emphasis: "strong", cadence: "PAC" }],
        }),
    ];
    const { score } = computeTonicizationDepthScore(artifacts, plan);
    assert.ok(score >= 0.5, `Expected tonicizationDepthScore >= 0.5 with rich development tonicizations, got ${score}`);
});

// [27] No tonicization at all → low score
test("tonicizationDepthScore: no tonicization windows → low score", () => {
    const plan = sonataPlan();
    const artifacts = [
        makeSection("s1", "theme_a"),
        makeSection("s2", "development"),
        makeSection("s3", "recap"),
    ];
    const richArtifacts = [
        makeSection("s1", "theme_a"),
        makeSection("s2", "development", {
            tonicizationWindows: [
                { keyTarget: "G", startMeasure: 1, endMeasure: 4, emphasis: "strong", cadence: "PAC" },
                { keyTarget: "E", startMeasure: 5, endMeasure: 8, emphasis: "mild",   cadence: "HC" },
            ],
        }),
        makeSection("s3", "recap"),
    ];
    const { score: noneScore } = computeTonicizationDepthScore(artifacts, plan);
    const { score: richScore } = computeTonicizationDepthScore(richArtifacts, plan);
    assert.ok(
        richScore > noneScore,
        `Rich tonicization (${richScore}) should beat none (${noneScore})`,
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: PLAN-AWARE PHRASE GRAMMAR SCORE
// ═══════════════════════════════════════════════════════════════════════════════

// [28] Section with sentence PhraseGrammarPlan + well-placed peak → high planAwarePhraseGrammarScore
test("planAwarePhraseGrammarScore: sentence plan + peak in cadential window → near 1.0", () => {
    const plan = {
        ...sonataPlan(),
        sections: [
            {
                id: "s1", role: "theme_a", label: "A", measures: 8, energy: 0.5, density: 0.5,
                phraseGrammar: {
                    structure: {
                        type: "sentence",
                        basicIdea:    { startMeasure: 1, endMeasure: 2 },
                        repetition:   { startMeasure: 3, endMeasure: 4 },
                        continuation: { startMeasure: 5, endMeasure: 6 },
                        cadential:    { startMeasure: 7, endMeasure: 8, cadenceType: "authentic" },
                    },
                    hypermetricGroups: [
                        { startMeasure: 1, endMeasure: 4, label: "antecedent" },
                        { startMeasure: 5, endMeasure: 8, label: "consequent" },
                    ],
                    totalMeasures: 8,
                    notes: "4+4 sentence",
                },
            },
        ],
    };
    const artifacts = [
        makeSection("s1", "theme_a", {
            measureCount: 8,
            phrasePeaks: [7],        // peak at measure 7 (cadential window start → good)
            phraseFunction: "cadential",
            cadenceApproach: "dominant",
        }),
    ];
    const { score } = computePlanAwarePhraseGrammarScore(artifacts, plan);
    assert.ok(score >= 0.6, `Expected planAwarePhraseGrammarScore >= 0.6 for sentence with well-placed peak, got ${score}`);
});

// [29] Plan with no phraseGrammar → fallback score 0.4
test("planAwarePhraseGrammarScore: plan with no phraseGrammar → returns 0.4 fallback", () => {
    const plan = sonataPlan(); // no phraseGrammar in sections
    const artifacts = [
        makeSection("s1", "theme_a"),
        makeSection("s2", "development"),
        makeSection("s3", "recap"),
    ];
    const { score, notes } = computePlanAwarePhraseGrammarScore(artifacts, plan);
    assert.strictEqual(score, 0.4, `Expected fallback score of 0.4, got ${score}`);
    assert.ok(notes.includes("no sections with phraseGrammar"), `Expected fallback note, got: ${notes}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: SUPPLEMENTARY METRICS IN INTEGRATION TEST
// ═══════════════════════════════════════════════════════════════════════════════

// [30] Full craft score integration includes all new supplementary fields
test("integration: computeCraftScoreSummary includes voiceLeadingScore and tonicizationDepthScore", () => {
    const plan = sonataPlan();
    const evaluation = passedEval();
    const artifacts = [
        makeSection("s1", "theme_a", {
            noteHistory: ASCENDING,
            measureCount: 8,
            melodyPitchMin: 60, melodyPitchMax: 84,
            bassPitchMin: 36,  bassPitchMax:  60,
            textureContraryMotionRate: 0.6,
            textureIndependentMotionRate: 0.5,
            melodyEvents: [60,62,64,65,67,69,71,72].map(p => note(p, 0.5)),
            cadenceApproach: "dominant",
        }),
        makeSection("s2", "development", {
            noteHistory: [62,64,67,69,71],
            measureCount: 8,
            melodyPitchMin: 60, melodyPitchMax: 84,
            bassPitchMin: 36,  bassPitchMax:  60,
            textureContraryMotionRate: 0.75,
            tonicizationWindows: [
                { keyTarget: "G", startMeasure: 1, endMeasure: 4, emphasis: "strong", cadence: "PAC" },
                { keyTarget: "E", startMeasure: 5, endMeasure: 8, emphasis: "mild",   cadence: "HC" },
            ],
            melodyEvents: [64,65,67,69,71,72,71,69].map(p => note(p, 0.5)),
        }),
        makeSection("s3", "recap", {
            noteHistory: ASCENDING,
            measureCount: 8,
            melodyPitchMin: 60, melodyPitchMax: 84,
            bassPitchMin: 36,  bassPitchMax:  60,
            textureContraryMotionRate: 0.65,
            cadenceApproach: "dominant",
            lastInterval: 1,
            melodyEvents: [64,65,67,65,64,62,61,60].map(p => note(p, 0.5)),
            tonicizationWindows: [
                { keyTarget: "C", startMeasure: 1, endMeasure: 8, emphasis: "strong", cadence: "PAC" },
            ],
        }),
    ];
    const summary = computeCraftScoreSummary(artifacts, plan, evaluation);

    assert.ok(typeof summary.voiceLeadingScore === "number",
        "voiceLeadingScore should be present in CraftScoreSummary");
    assert.ok(typeof summary.tonicizationDepthScore === "number",
        "tonicizationDepthScore should be present in CraftScoreSummary");
    assert.ok(typeof summary.planAwarePhraseGrammarScore === "number",
        "planAwarePhraseGrammarScore should be present in CraftScoreSummary");

    assert.ok(summary.voiceLeadingScore >= 0 && summary.voiceLeadingScore <= 1,
        `voiceLeadingScore out of range: ${summary.voiceLeadingScore}`);
    assert.ok(summary.tonicizationDepthScore >= 0 && summary.tonicizationDepthScore <= 1,
        `tonicizationDepthScore out of range: ${summary.tonicizationDepthScore}`);
    assert.ok(summary.planAwarePhraseGrammarScore >= 0 && summary.planAwarePhraseGrammarScore <= 1,
        `planAwarePhraseGrammarScore out of range: ${summary.planAwarePhraseGrammarScore}`);

    // finalCraftScore must NOT include new supplementary fields
    const expectedFinal = Number((
        0.15 * summary.sectionContractFit
        + 0.15 * summary.cadenceStrength
        + 0.15 * summary.tonalReturn
        + 0.15 * summary.motifSurvival
        + 0.15 * summary.voiceIndependence
        + 0.10 * summary.phraseShape
        + 0.10 * summary.registerIdiomaticFit
        + 0.05 * summary.syntaxValidity
    ).toFixed(4));
    assert.strictEqual(
        summary.finalCraftScore,
        expectedFinal,
        `finalCraftScore should not include new supplementary fields, expected ${expectedFinal} got ${summary.finalCraftScore}`,
    );
});

// [31] planAwareHarmonyGrammarScore and planAwareMotifDevelopmentScore are present
test("integration: computeCraftScoreSummary includes planAwareHarmonyGrammarScore and planAwareMotifDevelopmentScore", () => {
    const artifacts = [
        makeSection("intro",   "intro",   { measures: 8 }),
        makeSection("theme_a", "theme_a", { measures: 8, capturedMotif: [2, 2, 1, -1] }),
        makeSection("dev",     "development", { measures: 16 }),
        makeSection("recap",   "recap",   { measures: 8 }),
    ];

    const harmonyGrammarPlan = {
        functionalSequence: ["tonic", "predominant", "dominant", "tonic"],
        cadenceApproach: "basic",
    };
    const motifDevPlan = { entries: [{ transform: "sequence", transformedIntervals: [4, 4, 3] }] };

    const plan = {
        sections: [
            { id: "intro",   role: "intro",   label: "intro",   measures: 8 },
            { id: "theme_a", role: "theme_a", label: "theme_a", measures: 8, harmonyGrammar: harmonyGrammarPlan },
            { id: "dev",     role: "development", label: "dev", measures: 16, harmonyGrammar: harmonyGrammarPlan, motifDevelopment: motifDevPlan },
            { id: "recap",   role: "recap",   label: "recap",   measures: 8, motifDevelopment: { entries: [{ transform: "repeat", transformedIntervals: [2, 2, 1, -1] }] } },
        ],
        homeKey: "C",
        homeMode: "major",
        form: "sonata",
    };

    const evaluation = { passed: true, issues: [], strengths: [] };
    const summary = computeCraftScoreSummary(artifacts, plan, evaluation);

    assert.ok(typeof summary.planAwareHarmonyGrammarScore === "number",
        "planAwareHarmonyGrammarScore should be present");
    assert.ok(summary.planAwareHarmonyGrammarScore >= 0 && summary.planAwareHarmonyGrammarScore <= 1,
        `planAwareHarmonyGrammarScore out of range: ${summary.planAwareHarmonyGrammarScore}`);

    assert.ok(typeof summary.planAwareMotifDevelopmentScore === "number",
        "planAwareMotifDevelopmentScore should be present");
    assert.ok(summary.planAwareMotifDevelopmentScore >= 0 && summary.planAwareMotifDevelopmentScore <= 1,
        `planAwareMotifDevelopmentScore out of range: ${summary.planAwareMotifDevelopmentScore}`);

    // finalCraftScore still uses only the 8 weighted dimensions
    const expectedFinal = Number((
        0.15 * summary.sectionContractFit
        + 0.15 * summary.cadenceStrength
        + 0.15 * summary.tonalReturn
        + 0.15 * summary.motifSurvival
        + 0.15 * summary.voiceIndependence
        + 0.10 * summary.phraseShape
        + 0.10 * summary.registerIdiomaticFit
        + 0.05 * summary.syntaxValidity
    ).toFixed(4));
    assert.strictEqual(
        summary.finalCraftScore,
        expectedFinal,
        `finalCraftScore must stay at 8-dim formula: expected ${expectedFinal}, got ${summary.finalCraftScore}`,
    );
});
