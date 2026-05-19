// @ts-check
/**
 * bench: Masterpiece Direction Benchmark
 *
 * 목적:
 *   각 작곡가의 구조적 사고방식에서 배울 수 있는 기준을 AXIOM critic에 넣는 것.
 *   "작곡가 이름 흉내"가 아니라 명곡 수준에 가까워지는지를 측정하는 장기 baseline.
 *
 * 6 compositional styles:
 *   1. Chopin-like nocturne miniature     — lyrical ABA, slow harmonic rhythm
 *   2. Beethoven-like short sonata allegro — dramatic form, strong development
 *   3. Bach-like fugue-lite               — contrapuntal string trio
 *   4. Brahms-like intermezzo             — introspective ABA, rich harmony
 *   5. Mozart-like sonatina               — elegant 4-section form
 *   6. Schubert-like lyric miniature      — AABA, characteristic harmonic arc
 *
 * 7 evaluation dimensions:
 *   motifInevitability       — does the motif feel structurally inevitable?
 *   harmonicNarrative        — does harmony tell a directed story?
 *   phraseLevelBreath        — do phrases breathe naturally?
 *   climaxPlacement          — is the cadence at the right architectural moment?
 *   returnRecapMeaningfulness — does the recap feel earned?
 *   idiomFit                 — is it natural for the instrument/ensemble?
 *   replayValue              — overall craft quality (composite proxy)
 *
 * Composition Stage: Stage 3 (1~3분 character piece) — 현재 AXIOM 집중 구간.
 *   Stage 1/2 벤치마크: test/benchmark-composition-stages.test.mjs
 *   Stage 4/5: 미래 fine-tuning 이후 목표 (docs/composition-stages.md 참고)
 *
 * Note: All scores use common mock artifacts (template backend).
 * Score differences arise from plan-aware scoring (grammar plans drive evaluation).
 * When a fine-tuned model IS used, replace mock artifacts with real pipeline output.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ─── Dist imports ─────────────────────────────────────────────────────────────

const { computeCraftScoreSummary, computePlanAwareMotifDevelopmentScore, computeCadenceArchitecturalWeight } =
    await import("../dist/core/evaluate/craftScoring.js");
const { materializeCompositionSketch } = await import("../dist/core/plan/sketch.js");

// ─── Mock artifacts (shared across all styles, template backend output) ───────

const noteEv = (pitch, ql = 1) => ({ type: "note", pitch, quarterLength: ql });
const restEv = (ql = 1) => ({ type: "rest", quarterLength: ql });

/** Standard 3-section mock artifacts: theme_a → development → recap. */
function makeMockArtifacts() {
    return [
        {
            sectionId: "s1",
            role: "theme_a",
            measureCount: 4,
            melodyPitchMin: 60, melodyPitchMax: 72,
            bassPitchMin: 36, bassPitchMax: 52,
            melodyEvents: [noteEv(60), noteEv(62, 0.5), noteEv(64, 0.5), noteEv(65), noteEv(64)],
            accompanimentEvents: [noteEv(48, 2), noteEv(55, 2)],
            noteHistory: [60, 62, 64, 65, 64],
            capturedMotif: [2, 2, 1, -1],
            cadenceApproach: "half",
            phraseFunction: "presentation",
            harmonyDensity: "medium",
            textureContraryMotionRate: 0.45,
            textureIndependentMotionRate: 0.55,
        },
        {
            sectionId: "s2",
            role: "development",
            measureCount: 4,
            melodyPitchMin: 62, melodyPitchMax: 74,
            bassPitchMin: 38, bassPitchMax: 54,
            melodyEvents: [noteEv(65, 0.5), noteEv(67, 0.5), noteEv(69, 0.5), noteEv(70, 0.5), restEv(2)],
            accompanimentEvents: [noteEv(50, 1), noteEv(57, 1), noteEv(53, 2)],
            noteHistory: [65, 67, 69, 70],
            capturedMotif: [2, 2, 1, -1],
            transform: { transformMode: "sequence", sequenceStride: 2 },
            cadenceApproach: "half",
            phraseFunction: "continuation",
            harmonyDensity: "rich",
            textureContraryMotionRate: 0.50,
            textureIndependentMotionRate: 0.60,
        },
        {
            sectionId: "s3",
            role: "recap",
            measureCount: 4,
            melodyPitchMin: 60, melodyPitchMax: 71,
            bassPitchMin: 36, bassPitchMax: 51,
            melodyEvents: [noteEv(60), noteEv(62, 0.5), noteEv(64, 0.5), noteEv(65), noteEv(60)],
            accompanimentEvents: [noteEv(48, 2), noteEv(55, 2)],
            noteHistory: [60, 62, 64, 65, 60],
            capturedMotif: [2, 2, 1, -5],
            transform: { transformMode: "exact_return" },
            cadenceApproach: "dominant",
            lastInterval: -5,
            phraseFunction: "cadential",
            harmonyDensity: "sparse",
            textureContraryMotionRate: 0.40,
            textureIndependentMotionRate: 0.50,
        },
    ];
}

function makeMockEvaluation() {
    return { passed: true, score: 80, issues: [], strengths: [] };
}

// ─── Style plan factories ─────────────────────────────────────────────────────

const PIANO_SOLO = [
    { name: "Piano", family: "keyboard", roles: ["lead", "accompaniment"] },
];

const STRING_TRIO = [
    { name: "Violin", family: "strings", roles: ["lead"] },
    { name: "Viola", family: "strings", roles: ["counterline"] },
    { name: "Cello", family: "strings", roles: ["bass"] },
];

/** Helper: build a minimal compose request for materializeCompositionSketch. */
function makeStyleRequest(label, instrumentation, sections, globalMotifGraph) {
    return {
        id: `benchmark-masterpiece-${label}`,
        workflow: "classical_symbolic",
        compositionPlan: {
            style: "classical",
            instrumentation,
            sections,
            ...(globalMotifGraph ? { globalMotifGraph } : {}),
        },
    };
}

// 1. Chopin-like nocturne: lyrical ABA, slow harmonic rhythm, piano solo
function makeChopin() {
    const sections = [
        {
            id: "s1", role: "theme_a", label: "Nocturne Theme", measures: 8,
            energy: 0.45, density: 0.35,
            phraseFunction: "presentation", cadence: "half",
            harmonicPlan: { tonalCenter: "Db major", harmonicRhythm: "slow", cadence: "half", allowModulation: false },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "presentation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "opening", onset: 0 },
                prolongationMode: "tonic",
                cadenceTarget: "half", allowedChromatic: true, allowedModulation: false,
            },
        },
        {
            id: "s2", role: "development", label: "Middle Section", measures: 4,
            energy: 0.60, density: 0.50,
            phraseFunction: "continuation", cadence: "half",
            harmonicPlan: { tonalCenter: "Db major", harmonicRhythm: "medium", cadence: "half", allowModulation: true },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "continuation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "predominant", position: "middle", onset: 0.5 },
                prolongationMode: "predominant",
                cadenceTarget: "half", allowedChromatic: true, allowedModulation: true,
            },
        },
        {
            id: "s3", role: "recap", label: "Return", measures: 8,
            energy: 0.40, density: 0.30,
            phraseFunction: "cadential", cadence: "dominant",
            harmonicPlan: { tonalCenter: "Db major", harmonicRhythm: "slow", cadence: "dominant", allowModulation: false },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "cadential", cadenceTarget: "dominant", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "closing", onset: 0.75 },
                prolongationMode: "tonic",
                cadenceTarget: "dominant", allowedChromatic: true, allowedModulation: false,
            },
        },
    ];
    return makeStyleRequest("chopin", PIANO_SOLO, sections);
}

// 2. Beethoven-like sonata allegro: dramatic form, sonata structure
function makeBeethovenSection(id, role, label, measures, energy, density, phraseFunc, cadence, tonalCenter, allowMod) {
    return {
        id, role, label, measures, energy, density,
        phraseFunction: phraseFunc, cadence,
        harmonicPlan: { tonalCenter, harmonicRhythm: "medium", cadence, allowModulation: allowMod },
        motifRef: "s1",
        phraseGrammar: { targetFunction: phraseFunc, cadenceTarget: cadence, minPhrasePeaks: 1, hypermetricBeat: 1 },
        harmonyGrammar: {
            pdt: { targetHarmony: "tonic", position: "opening", onset: 0 },
            prolongationMode: "tonic",
            cadenceTarget: cadence, allowedChromaticHarmony: false, allowedModulation: allowMod,
        },
    };
}

function makeBeethoven() {
    const sections = [
        makeBeethovenSection("s1", "theme_a",    "Theme A",          4, 0.65, 0.55, "presentation", "half",     "C minor", false),
        makeBeethovenSection("s2", "development", "Development",      6, 0.80, 0.70, "continuation", "half",     "Eb major", true),
        makeBeethovenSection("s3", "recap",        "Recapitulation",   6, 0.55, 0.45, "cadential",    "dominant", "C minor", false),
    ];
    // GlobalMotifGraph — correct TypeScript interface format (transformPath, not motifs)
    const globalMotifGraph = {
        motifId: "theme_a",
        sourceSectionId: "s1",
        requiredReturns: ["s3"],
        dramaticArc: ["exposition", "destabilization", "resolution"],
        transformPath: [
            { sectionId: "s1", transform: "original",     dramaticFunction: "exposition",     required: false },
            { sectionId: "s2", transform: "sequence",     dramaticFunction: "destabilization", required: false },
            { sectionId: "s3", transform: "exact_return", dramaticFunction: "resolution",     required: true },
        ],
    };
    return makeStyleRequest("beethoven", PIANO_SOLO, sections, globalMotifGraph);
}

// 3. Bach-like fugue-lite: contrapuntal string trio
function makeBach() {
    const sections = [
        {
            id: "s1", role: "theme_a", label: "Subject", measures: 4,
            energy: 0.55, density: 0.65,
            phraseFunction: "presentation", cadence: "half",
            harmonicPlan: { tonalCenter: "D minor", harmonicRhythm: "medium", cadence: "half", allowModulation: false },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "presentation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "opening", onset: 0 },
                prolongationMode: "tonic",
                cadenceTarget: "half", allowedChromatic: false, allowedModulation: false,
            },
        },
        {
            id: "s2", role: "development", label: "Episodes + Stretto", measures: 6,
            energy: 0.70, density: 0.75,
            phraseFunction: "continuation", cadence: "half",
            harmonicPlan: { tonalCenter: "D minor", harmonicRhythm: "medium", cadence: "half", allowModulation: true },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "continuation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "predominant", position: "middle", onset: 0.4 },
                prolongationMode: "predominant",
                cadenceTarget: "half", allowedChromatic: false, allowedModulation: true,
            },
        },
        {
            id: "s3", role: "recap", label: "Final Entry", measures: 4,
            energy: 0.60, density: 0.65,
            phraseFunction: "cadential", cadence: "dominant",
            harmonicPlan: { tonalCenter: "D minor", harmonicRhythm: "slow", cadence: "dominant", allowModulation: false },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "cadential", cadenceTarget: "dominant", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "closing", onset: 0.75 },
                prolongationMode: "tonic",
                cadenceTarget: "dominant", allowedChromatic: false, allowedModulation: false,
            },
        },
    ];
    return makeStyleRequest("bach", STRING_TRIO, sections);
}

// 4. Brahms-like intermezzo: introspective ABA with required thematic return
function makeBrahms() {
    const sections = [
        {
            id: "s1", role: "theme_a", label: "Hauptthema", measures: 8,
            energy: 0.50, density: 0.55,
            phraseFunction: "presentation", cadence: "half",
            harmonicPlan: { tonalCenter: "A major", harmonicRhythm: "slow", cadence: "half", allowModulation: true },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "presentation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "opening", onset: 0 },
                prolongationMode: "tonic",
                cadenceTarget: "half", allowedChromatic: true, allowedModulation: true,
            },
        },
        {
            id: "s2", role: "development", label: "Trio", measures: 8,
            energy: 0.60, density: 0.60,
            phraseFunction: "continuation", cadence: "half",
            harmonicPlan: { tonalCenter: "F# minor", harmonicRhythm: "medium", cadence: "half", allowModulation: true },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "continuation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "predominant", position: "middle", onset: 0.5 },
                prolongationMode: "predominant",
                cadenceTarget: "half", allowedChromatic: true, allowedModulation: true,
            },
        },
        {
            id: "s3", role: "recap", label: "Da Capo", measures: 8,
            energy: 0.45, density: 0.50,
            phraseFunction: "cadential", cadence: "dominant",
            harmonicPlan: { tonalCenter: "A major", harmonicRhythm: "slow", cadence: "dominant", allowModulation: false },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "cadential", cadenceTarget: "dominant", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "closing", onset: 0.75 },
                prolongationMode: "tonic",
                cadenceTarget: "dominant", allowedChromatic: true, allowedModulation: false,
            },
        },
    ];
    // Brahms emphasizes meaningful thematic return — GlobalMotifGraph correct format
    const globalMotifGraph = {
        motifId: "theme_a",
        sourceSectionId: "s1",
        requiredReturns: ["s3"],
        dramaticArc: ["exposition", "destabilization", "resolution"],
        transformPath: [
            { sectionId: "s1", transform: "original",            dramaticFunction: "exposition",     required: false },
            { sectionId: "s2", transform: "reharmonised_return", dramaticFunction: "destabilization", required: false },
            { sectionId: "s3", transform: "reharmonised_return", dramaticFunction: "resolution",     required: true },
        ],
    };
    return makeStyleRequest("brahms", PIANO_SOLO, sections, globalMotifGraph);
}

// 5. Mozart-like sonatina: elegant, clean 4-section form
function makeMozart() {
    const sections = [
        {
            id: "s1", role: "theme_a", label: "Theme I", measures: 4,
            energy: 0.55, density: 0.45,
            phraseFunction: "presentation", cadence: "half",
            harmonicPlan: { tonalCenter: "G major", harmonicRhythm: "medium", cadence: "half", allowModulation: false },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "presentation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "opening", onset: 0 },
                prolongationMode: "tonic",
                cadenceTarget: "half", allowedChromatic: false, allowedModulation: false,
            },
        },
        {
            id: "s2", role: "development", label: "Development", measures: 4,
            energy: 0.60, density: 0.50,
            phraseFunction: "continuation", cadence: "half",
            harmonicPlan: { tonalCenter: "D major", harmonicRhythm: "medium", cadence: "half", allowModulation: true },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "continuation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "dominant", position: "middle", onset: 0.5 },
                prolongationMode: "dominant",
                cadenceTarget: "half", allowedChromatic: false, allowedModulation: true,
            },
        },
        {
            id: "s3", role: "recap", label: "Recapitulation", measures: 4,
            energy: 0.50, density: 0.40,
            phraseFunction: "cadential", cadence: "dominant",
            harmonicPlan: { tonalCenter: "G major", harmonicRhythm: "medium", cadence: "dominant", allowModulation: false },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "cadential", cadenceTarget: "dominant", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "closing", onset: 0.75 },
                prolongationMode: "tonic",
                cadenceTarget: "dominant", allowedChromatic: false, allowedModulation: false,
            },
        },
    ];
    return makeStyleRequest("mozart", PIANO_SOLO, sections);
}

// 6. Schubert-like lyric miniature: AABA, characteristic harmonic arc
function makeSchubert() {
    const sections = [
        {
            id: "s1", role: "theme_a", label: "Verse", measures: 4,
            energy: 0.50, density: 0.45,
            phraseFunction: "presentation", cadence: "half",
            harmonicPlan: { tonalCenter: "F major", harmonicRhythm: "slow", cadence: "half", allowModulation: false },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "presentation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "opening", onset: 0 },
                prolongationMode: "tonic",
                cadenceTarget: "half", allowedChromatic: true, allowedModulation: false,
            },
        },
        {
            id: "s2", role: "development", label: "Bridge", measures: 4,
            energy: 0.65, density: 0.55,
            phraseFunction: "continuation", cadence: "half",
            harmonicPlan: { tonalCenter: "Db major", harmonicRhythm: "slow", cadence: "half", allowModulation: true },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "continuation", cadenceTarget: "half", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "predominant", position: "middle", onset: 0.5 },
                prolongationMode: "predominant",
                cadenceTarget: "half", allowedChromatic: true, allowedModulation: true,
            },
        },
        {
            id: "s3", role: "recap", label: "Return", measures: 4,
            energy: 0.45, density: 0.40,
            phraseFunction: "cadential", cadence: "dominant",
            harmonicPlan: { tonalCenter: "F major", harmonicRhythm: "slow", cadence: "dominant", allowModulation: false },
            motifRef: "s1",
            phraseGrammar: { targetFunction: "cadential", cadenceTarget: "dominant", minPhrasePeaks: 1, hypermetricBeat: 1 },
            harmonyGrammar: {
                pdt: { targetHarmony: "tonic", position: "closing", onset: 0.75 },
                prolongationMode: "tonic",
                cadenceTarget: "dominant", allowedChromatic: true, allowedModulation: false,
            },
        },
    ];
    return makeStyleRequest("schubert", PIANO_SOLO, sections);
}

// ─── Plan normalization helper ────────────────────────────────────────────────

/**
 * Materialize a compose request to get a properly annotated compositionPlan.
 * materializeCompositionSketch injects phraseGrammar.structure, harmonyGrammar,
 * and motifDevelopment per section — required for plan-aware scoring.
 * @param {any} request
 * @returns {any}
 */
function getNormalizedPlan(request) {
    const normalized = materializeCompositionSketch(request);
    return normalized?.compositionPlan ?? request.compositionPlan;
}

// ─── 7-dimension scoring ──────────────────────────────────────────────────────

/**
 * Compute all 7 Masterpiece Direction dimensions from a normalized plan + mock artifacts.
 *
 * Dimension → AXIOM score mapping:
 *   motifInevitability     = avg(planAwareMotifDevelopmentScore, motifSurvival)
 *   harmonicNarrative      = avg(harmonyContractScore, tonalReturn)
 *   phraseLevelBreath      = avg(phraseShape, planAwarePhraseGrammarScore)
 *   climaxPlacement        = cadenceArchitecturalWeight score
 *   returnRecapMeaningful  = avg(recapSectionMotifScore, tonalReturn)
 *   idiomFit               = avg(registerIdiomaticFit, voiceIndependence)
 *   replayValue            = finalCraftScore (composite proxy)
 *
 * @param {any} plan  - normalized compositionPlan
 * @param {any[]} artifacts
 * @param {any} evaluation
 */
function computeMasterpieceDimensions(plan, artifacts, evaluation) {
    const cs = computeCraftScoreSummary(artifacts, plan, evaluation);
    const cadArch = computeCadenceArchitecturalWeight(artifacts, plan);
    const motifResult = computePlanAwareMotifDevelopmentScore(artifacts, plan);

    const recapSection = plan?.sections?.find((s) => s.role === "recap");
    const recapScore = recapSection
        ? (motifResult.sectionScores?.[recapSection.id] ?? motifResult.score)
        : motifResult.score;

    return {
        motifInevitability:        (cs.planAwareMotifDevelopmentScore + cs.motifSurvival) / 2,
        harmonicNarrative:         (cs.harmonyContractScore + cs.tonalReturn) / 2,
        phraseLevelBreath:         (cs.phraseShape + cs.planAwarePhraseGrammarScore) / 2,
        climaxPlacement:           cadArch.score,
        returnRecapMeaningfulness: (recapScore + cs.tonalReturn) / 2,
        idiomFit:                  (cs.registerIdiomaticFit + cs.voiceIndependence) / 2,
        replayValue:               cs.finalCraftScore,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: All 6 styles produce valid normalized plans
// ─────────────────────────────────────────────────────────────────────────────

test("masterpiece-bench: all 6 style sketches produce valid normalized plans", () => {
    const styles = [
        ["chopin",    makeChopin()],
        ["beethoven", makeBeethoven()],
        ["bach",      makeBach()],
        ["brahms",    makeBrahms()],
        ["mozart",    makeMozart()],
        ["schubert",  makeSchubert()],
    ];

    for (const [label, request] of styles) {
        const plan = getNormalizedPlan(request);
        assert.ok(plan, `${label}: normalized plan must be defined`);
        assert.ok(Array.isArray(plan.sections), `${label}: plan must have sections array`);
        assert.equal(plan.sections.length, 3, `${label}: plan must have 3 sections`);

        // Each section must have phraseGrammar.structure injected by materialize
        for (const section of plan.sections) {
            assert.ok(section.phraseGrammar, `${label} section ${section.id}: phraseGrammar must be present`);
            assert.ok(section.phraseGrammar.structure, `${label} section ${section.id}: phraseGrammar.structure must be injected`);
        }

        // Must have theme_a and recap roles
        const roles = plan.sections.map((s) => s.role);
        assert.ok(roles.includes("theme_a"), `${label}: must have theme_a section`);
        assert.ok(roles.includes("recap"),   `${label}: must have recap section`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: All 7 dimensions scored in [0,1] for all 6 styles
// ─────────────────────────────────────────────────────────────────────────────

test("masterpiece-bench: all 7 dimensions scored [0,1] for all 6 styles", () => {
    const mockArtifacts = makeMockArtifacts();
    const mockEval = makeMockEvaluation();

    const styles = [
        ["chopin",    getNormalizedPlan(makeChopin())],
        ["beethoven", getNormalizedPlan(makeBeethoven())],
        ["bach",      getNormalizedPlan(makeBach())],
        ["brahms",    getNormalizedPlan(makeBrahms())],
        ["mozart",    getNormalizedPlan(makeMozart())],
        ["schubert",  getNormalizedPlan(makeSchubert())],
    ];

    for (const [label, plan] of styles) {
        const d = computeMasterpieceDimensions(plan, mockArtifacts, mockEval);

        const dimensions = [
            ["motifInevitability",        d.motifInevitability],
            ["harmonicNarrative",         d.harmonicNarrative],
            ["phraseLevelBreath",         d.phraseLevelBreath],
            ["climaxPlacement",           d.climaxPlacement],
            ["returnRecapMeaningfulness", d.returnRecapMeaningfulness],
            ["idiomFit",                  d.idiomFit],
            ["replayValue",               d.replayValue],
        ];

        for (const [dim, value] of dimensions) {
            assert.ok(
                typeof value === "number" && value >= 0 && value <= 1,
                `${label}.${dim} = ${value} must be a number in [0,1]`,
            );
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Style-specific structural assertions
// ─────────────────────────────────────────────────────────────────────────────

test("masterpiece-bench: Chopin style — ABA with slow harmonic rhythm, piano solo", () => {
    const plan = getNormalizedPlan(makeChopin());

    const instrumentation = makeChopin().compositionPlan.instrumentation;
    assert.equal(instrumentation.length, 1, "Chopin nocturne: solo instrument only");
    assert.equal(instrumentation[0].family, "keyboard", "Chopin: must be keyboard family");

    const s1 = plan.sections.find((s) => s.role === "theme_a");
    assert.ok(s1, "Chopin: must have theme_a section");
    assert.equal(s1.harmonicPlan.harmonicRhythm, "slow", "Chopin: harmonic rhythm must be slow");
    assert.equal(s1.harmonicPlan.tonalCenter, "Db major", "Chopin: tonal center must be Db major");
});

test("masterpiece-bench: Beethoven style — explicit motif graph with required recap return", () => {
    const request = makeBeethoven();
    const plan = getNormalizedPlan(request);

    // Beethoven has an explicit globalMotifGraph requiring recap return
    assert.ok(plan.globalMotifGraph, "Beethoven: must have globalMotifGraph");
    // GlobalMotifGraph uses requiredReturns (not motifs[].required_returns)
    assert.ok(
        Array.isArray(plan.globalMotifGraph.requiredReturns) &&
        plan.globalMotifGraph.requiredReturns.includes("s3"),
        "Beethoven: globalMotifGraph.requiredReturns must include s3 (recap)",
    );
    // transformPath must exist with a required recap node
    const transformPath = plan.globalMotifGraph.transformPath ?? [];
    assert.ok(
        transformPath.some((n) => n.sectionId === "s3" && n.required === true),
        "Beethoven: transformPath must have required=true for recap section s3",
    );
});

test("masterpiece-bench: Bach style — string trio instrumentation (voiceIndependence meaningful)", () => {
    const plan = getNormalizedPlan(makeBach());
    const instrumentation = makeBach().compositionPlan.instrumentation;

    assert.equal(instrumentation.length, 3, "Bach: string trio must have 3 instruments");
    const families = instrumentation.map((i) => i.family);
    assert.ok(families.every((f) => f === "strings"), "Bach: all instruments must be strings");

    // Bach fugue: development section is "episodes + stretto" — higher density
    const dev = plan.sections.find((s) => s.role === "development");
    assert.ok(dev, "Bach: must have development section");
    assert.ok(dev.density > 0.6, `Bach: development density must be > 0.6 (fugue is dense), got ${dev.density}`);
});

test("masterpiece-bench: Brahms style — required thematic return in recap", () => {
    const request = makeBrahms();
    const plan = getNormalizedPlan(request);

    assert.ok(plan.globalMotifGraph, "Brahms: must have globalMotifGraph");
    // GlobalMotifGraph uses requiredReturns (correct interface field)
    assert.ok(
        Array.isArray(plan.globalMotifGraph.requiredReturns) &&
        plan.globalMotifGraph.requiredReturns.includes("s3"),
        "Brahms: globalMotifGraph.requiredReturns must include s3 (recap)",
    );
    // Brahms allows reharmonised_return (not just exact copy) in transformPath
    const transformPath = plan.globalMotifGraph.transformPath ?? [];
    assert.ok(
        transformPath.some((n) => n.sectionId === "s3" && n.transform === "reharmonised_return"),
        "Brahms: recap node must use reharmonised_return transform",
    );
});

test("masterpiece-bench: Mozart style — clean form without explicit motif graph (plan-driven only)", () => {
    const request = makeMozart();
    const plan = getNormalizedPlan(request);

    // Mozart sonatina: no explicit globalMotifGraph — plan sections drive form.
    // materializeCompositionSketch may auto-generate one; if so it must use motif_id=motif-*
    // (auto-generated pattern) not motif_id=theme_a (that's explicit Level D+ behavior).
    if (plan.globalMotifGraph) {
        // Auto-generated graph uses motifId like "motif-s1", not "theme_a"
        assert.ok(
            plan.globalMotifGraph.motifId !== "theme_a",
            `Mozart: auto-generated globalMotifGraph must not use explicit motifId=theme_a (got: ${plan.globalMotifGraph.motifId})`,
        );
    }

    const dev = plan.sections.find((s) => s.role === "development");
    assert.ok(dev, "Mozart: must have development section");
    assert.equal(dev.harmonicPlan?.allowModulation, true, "Mozart: development must allow modulation (to dominant)");
});

test("masterpiece-bench: Schubert style — characteristic Db modulation in development", () => {
    const plan = getNormalizedPlan(makeSchubert());

    const dev = plan.sections.find((s) => s.role === "development");
    assert.ok(dev, "Schubert: must have development section");
    assert.equal(dev.harmonicPlan?.tonalCenter, "Db major",
        "Schubert: bridge must modulate to Db major (characteristic Neapolitan/mediant shift)");
    assert.equal(dev.harmonicPlan?.allowModulation, true, "Schubert: bridge must allow modulation");

    // Opening stays in F major; the Db shift in the bridge is the characteristic moment.
    // harmonicPlan is preserved through materializeCompositionSketch (unlike harmonyGrammar).
    const s1 = plan.sections.find((s) => s.role === "theme_a");
    assert.ok(s1, "Schubert: must have theme_a section");
    assert.equal(s1.harmonicPlan?.tonalCenter, "F major",
        "Schubert: opening must be in F major (Db shift in bridge makes it characteristic)");
    assert.equal(s1.harmonicPlan?.allowModulation, false,
        "Schubert: opening must not modulate (establishing home key before the Db shift)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Plan-aware scoring activates (no fallback for any style)
// ─────────────────────────────────────────────────────────────────────────────

test("masterpiece-bench: plan-aware scoring activates for all 6 styles (no 0.4 fallback)", () => {
    const mockArtifacts = makeMockArtifacts();
    const mockEval = makeMockEvaluation();

    const styles = [
        ["chopin",    getNormalizedPlan(makeChopin())],
        ["beethoven", getNormalizedPlan(makeBeethoven())],
        ["bach",      getNormalizedPlan(makeBach())],
        ["brahms",    getNormalizedPlan(makeBrahms())],
        ["mozart",    getNormalizedPlan(makeMozart())],
        ["schubert",  getNormalizedPlan(makeSchubert())],
    ];

    for (const [label, plan] of styles) {
        const cs = computeCraftScoreSummary(mockArtifacts, plan, mockEval);

        // After materializeCompositionSketch, all plan-aware scores must be computed (not 0.4 fallback)
        assert.notEqual(cs.planAwarePhraseGrammarScore, 0.4,
            `${label}: planAwarePhraseGrammarScore must not be 0.4 fallback (grammar plans present)`);
        assert.notEqual(cs.planAwareHarmonyGrammarScore, 0.4,
            `${label}: planAwareHarmonyGrammarScore must not be 0.4 fallback`);
        assert.notEqual(cs.planAwareMotifDevelopmentScore, 0.4,
            `${label}: planAwareMotifDevelopmentScore must not be 0.4 fallback`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: Full 7-dimension comparison table + masterpiece gap analysis
// ─────────────────────────────────────────────────────────────────────────────

test("masterpiece-bench: full 7-dimension comparison table with masterpiece gap", () => {
    const mockArtifacts = makeMockArtifacts();
    const mockEval = makeMockEvaluation();

    const styles = [
        ["Chopin (nocturne)",   getNormalizedPlan(makeChopin())],
        ["Beethoven (sonata)",  getNormalizedPlan(makeBeethoven())],
        ["Bach (fugue-lite)",   getNormalizedPlan(makeBach())],
        ["Brahms (intermezzo)", getNormalizedPlan(makeBrahms())],
        ["Mozart (sonatina)",   getNormalizedPlan(makeMozart())],
        ["Schubert (lyric)",    getNormalizedPlan(makeSchubert())],
    ];

    const rows = [];
    for (const [label, plan] of styles) {
        const d = computeMasterpieceDimensions(plan, mockArtifacts, mockEval);
        rows.push({ label, ...d });
    }

    // ── Print comparison table ──────────────────────────────────────────────
    const COLS = ["mInevit", "hmNarr ", "phBreat", "climax ", "recpMng", "idiom  ", "replay "];
    const header = ["Style                  ", ...COLS].join(" | ");
    const sep = "─".repeat(header.length);

    console.log(`\n${sep}`);
    console.log("bench: Masterpiece Direction — 7-dimension comparison (mock backend)");
    console.log("Note: These are baseline scores with generic mock artifacts.");
    console.log("      Differences across styles arise from plan-aware scoring.");
    console.log("      Replace mock artifacts with real pipeline output for R&D.");
    console.log(sep);
    console.log(header);
    console.log("─".repeat(header.length));

    for (const r of rows) {
        const fmt = (n) => (n === undefined ? "  n/a " : n.toFixed(3).padStart(6));
        const row = [
            r.label.padEnd(23),
            fmt(r.motifInevitability),
            fmt(r.harmonicNarrative),
            fmt(r.phraseLevelBreath),
            fmt(r.climaxPlacement),
            fmt(r.returnRecapMeaningfulness),
            fmt(r.idiomFit),
            fmt(r.replayValue),
        ].join(" | ");
        console.log(row);
    }

    // ── Masterpiece gap analysis ────────────────────────────────────────────
    // "masterpiece gap" = 1.0 - avg(all 7 dimensions) per style
    // Lower gap = closer to the ideal structure for that compositional archetype.
    console.log(sep);
    console.log("\n  Masterpiece gaps (lower = structurally closer to ideal):");
    for (const r of rows) {
        const avg = (
            r.motifInevitability + r.harmonicNarrative + r.phraseLevelBreath +
            r.climaxPlacement + r.returnRecapMeaningfulness + r.idiomFit + r.replayValue
        ) / 7;
        const gap = 1.0 - avg;
        console.log(`  ${r.label.padEnd(24)} gap=${gap.toFixed(3)} (avg=${avg.toFixed(3)})`);
    }

    // ── Dimension guide ─────────────────────────────────────────────────────
    console.log(`\n  Dimensions:`);
    console.log("  mInevit  = motif inevitability   (planAwareMotifDev + motifSurvival) / 2");
    console.log("  hmNarr   = harmonic narrative     (harmonyContractScore + tonalReturn) / 2");
    console.log("  phBreat  = phrase-level breath    (phraseShape + planAwarePhraseGrammar) / 2");
    console.log("  climax   = climax placement       cadenceArchitecturalWeight");
    console.log("  recpMng  = recap meaningfulness   (recapMotifScore + tonalReturn) / 2");
    console.log("  idiom    = idiomatic fit           (registerIdiomaticFit + voiceIndependence) / 2");
    console.log("  replay   = replay value            finalCraftScore (composite)");
    console.log(`${sep}\n`);

    // Structural assertion: all rows computed without errors
    assert.equal(rows.length, 6, "must have 6 style rows");
    for (const r of rows) {
        const avg = (
            r.motifInevitability + r.harmonicNarrative + r.phraseLevelBreath +
            r.climaxPlacement + r.returnRecapMeaningfulness + r.idiomFit + r.replayValue
        ) / 7;
        assert.ok(avg >= 0 && avg <= 1, `${r.label}: avg dimension score must be in [0,1], got ${avg.toFixed(3)}`);
    }
});
