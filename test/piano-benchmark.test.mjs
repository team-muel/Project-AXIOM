/**
 * Piano benchmark tests
 *
 * Validates that:
 *   1. 30 benchmark prompts spanning 7 style categories all resolve to
 *      the solo_piano_symbolic lane.
 *   2. buildPianoSectionPlanForStyle assigns the documented texture per style.
 *   3. Ideal "golden" artifacts for each of the 7 benchmark styles meet the
 *      documented success-criteria score thresholds (median targets).
 *   4. PLAYABILITY_LABEL_THRESHOLD >= benchmark target (0.60 >= 0.50 gate).
 *
 * Style coverage (30 prompts):
 *   classical_sonatina   ×5   (classical_sonata IR style)
 *   romantic_nocturne    ×5   (nocturne IR style)
 *   baroque_invention    ×4   (classical_sonata IR style, counterpoint texture)
 *   waltz                ×4   (romantic_character IR style, waltz_bass texture)
 *   etude                ×4   (etude IR style)
 *   theme_variations     ×4   (romantic_character IR style)
 *   sonata_lite          ×4   (classical_sonata IR style)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildLearnedSymbolicPromptPack,
} from "../dist/composer/learnedAdapter.js";
import {
    buildPianoSectionPlanForStyle,
    validatePianoSectionPlan,
} from "../dist/pipeline/pianoIR.js";
import {
    computePianoCraftScoreSummary,
    computeMelodicClarity,
    computeBassCoherence,
    computeHandPlayability,
    pianoPlayabilityGate,
} from "../dist/pipeline/pianoCraftScoring.js";
import { PLAYABILITY_LABEL_THRESHOLD } from "../dist/memory/pianoDataset.js";

// ─── Benchmark prompt definitions ────────────────────────────────────────────

/**
 * Builds a minimal ComposeRequest for a solo piano piece.
 * All 30 prompts share the same structural shape; only key, form,
 * difficulty, and style vary.
 */
function makePianoRequest({ key, form, difficulty, style, tempo = 96 }) {
    const pianoPlan = {
        instrument: "Piano",
        difficultyTarget: difficulty,
        sections: [
            {
                sectionId: "s1",
                textureKind: "melody_accompaniment",
                rightHand: {
                    hand: "right",
                    primaryRoles: ["lead"],
                    registerMin: 60,
                    registerMax: 84,
                    maxComfortableSpan: 12,
                },
                leftHand: {
                    hand: "left",
                    primaryRoles: ["bass"],
                    registerMin: 36,
                    registerMax: 60,
                    maxComfortableSpan: 12,
                },
                pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                difficultyTarget: difficulty,
            },
            {
                sectionId: "s2",
                textureKind: "broken_chord",
                rightHand: {
                    hand: "right",
                    primaryRoles: ["lead"],
                    registerMin: 60,
                    registerMax: 84,
                    maxComfortableSpan: 12,
                },
                leftHand: {
                    hand: "left",
                    primaryRoles: ["bass", "chordal_support"],
                    registerMin: 36,
                    registerMax: 60,
                    maxComfortableSpan: 12,
                },
                pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                difficultyTarget: difficulty,
            },
        ],
    };

    return {
        prompt: `A ${style} for piano in ${key}`,
        form,
        key,
        tempo,
        targetInstrumentation: [
            { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] },
        ],
        compositionPlan: {
            brief: `${style} in ${key}`,
            key,
            form,
            tempo,
            mood: [],
            instrumentation: [
                { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] },
            ],
            orchestration: { family: "piano_solo", instrumentNames: ["Piano"], sections: [] },
            sections: [
                { id: "s1", role: "theme_a",  label: "Theme A", measures: 8, energy: 0.4, density: 0.35 },
                { id: "s2", role: "theme_b",  label: "Theme B", measures: 8, energy: 0.5, density: 0.40 },
            ],
            pianoPlan,
        },
    };
}

/** Benchmark prompt bank: 30 prompts × 7 style categories. */
const BENCHMARK_PROMPTS = [
    // ── classical_sonatina (5) ──────────────────────────────────────────────────
    { id: "sonatina-1", category: "classical_sonatina", irStyle: "classical_sonata",
      key: "C major",  form: "sonatina", difficulty: "easy",         tempo: 100 },
    { id: "sonatina-2", category: "classical_sonatina", irStyle: "classical_sonata",
      key: "G major",  form: "sonatina", difficulty: "easy",         tempo: 108 },
    { id: "sonatina-3", category: "classical_sonatina", irStyle: "classical_sonata",
      key: "D major",  form: "sonatina", difficulty: "intermediate", tempo: 112 },
    { id: "sonatina-4", category: "classical_sonatina", irStyle: "classical_sonata",
      key: "F major",  form: "sonatina", difficulty: "easy",         tempo: 96 },
    { id: "sonatina-5", category: "classical_sonatina", irStyle: "classical_sonata",
      key: "A major",  form: "sonatina", difficulty: "intermediate", tempo: 104 },

    // ── romantic_nocturne (5) ──────────────────────────────────────────────────
    { id: "nocturne-1", category: "romantic_nocturne", irStyle: "nocturne",
      key: "F minor",  form: "nocturne", difficulty: "intermediate", tempo: 72 },
    { id: "nocturne-2", category: "romantic_nocturne", irStyle: "nocturne",
      key: "E minor",  form: "nocturne", difficulty: "intermediate", tempo: 69 },
    { id: "nocturne-3", category: "romantic_nocturne", irStyle: "nocturne",
      key: "Bb major", form: "nocturne", difficulty: "advanced",     tempo: 66 },
    { id: "nocturne-4", category: "romantic_nocturne", irStyle: "nocturne",
      key: "D minor",  form: "nocturne", difficulty: "intermediate", tempo: 72 },
    { id: "nocturne-5", category: "romantic_nocturne", irStyle: "nocturne",
      key: "Eb major", form: "nocturne", difficulty: "advanced",     tempo: 63 },

    // ── baroque_invention (4) — uses classical_sonata IR style ─────────────────
    { id: "invention-1", category: "baroque_invention", irStyle: "classical_sonata",
      key: "C major",  form: "invention", difficulty: "intermediate", tempo: 92 },
    { id: "invention-2", category: "baroque_invention", irStyle: "classical_sonata",
      key: "D minor",  form: "invention", difficulty: "intermediate", tempo: 88 },
    { id: "invention-3", category: "baroque_invention", irStyle: "classical_sonata",
      key: "G minor",  form: "invention", difficulty: "advanced",     tempo: 84 },
    { id: "invention-4", category: "baroque_invention", irStyle: "classical_sonata",
      key: "F major",  form: "invention", difficulty: "intermediate", tempo: 90 },

    // ── waltz (4) — uses romantic_character IR style ───────────────────────────
    { id: "waltz-1", category: "waltz", irStyle: "romantic_character",
      key: "A major",  form: "waltz", difficulty: "easy",         tempo: 138 },
    { id: "waltz-2", category: "waltz", irStyle: "romantic_character",
      key: "Db major", form: "waltz", difficulty: "intermediate", tempo: 132 },
    { id: "waltz-3", category: "waltz", irStyle: "romantic_character",
      key: "G major",  form: "waltz", difficulty: "easy",         tempo: 144 },
    { id: "waltz-4", category: "waltz", irStyle: "romantic_character",
      key: "E minor",  form: "waltz", difficulty: "intermediate", tempo: 138 },

    // ── etude (4) ──────────────────────────────────────────────────────────────
    { id: "etude-1", category: "etude", irStyle: "etude",
      key: "C major",  form: "etude", difficulty: "advanced",    tempo: 120 },
    { id: "etude-2", category: "etude", irStyle: "etude",
      key: "A minor",  form: "etude", difficulty: "advanced",    tempo: 116 },
    { id: "etude-3", category: "etude", irStyle: "etude",
      key: "G# minor", form: "etude", difficulty: "virtuosic",   tempo: 108 },
    { id: "etude-4", category: "etude", irStyle: "etude",
      key: "Bb major", form: "etude", difficulty: "intermediate", tempo: 126 },

    // ── theme_variations (4) — uses romantic_character IR style ───────────────
    { id: "vars-1", category: "theme_variations", irStyle: "romantic_character",
      key: "D major",  form: "theme_variations", difficulty: "intermediate", tempo: 88 },
    { id: "vars-2", category: "theme_variations", irStyle: "romantic_character",
      key: "G major",  form: "theme_variations", difficulty: "advanced",     tempo: 84 },
    { id: "vars-3", category: "theme_variations", irStyle: "romantic_character",
      key: "A minor",  form: "theme_variations", difficulty: "intermediate", tempo: 80 },
    { id: "vars-4", category: "theme_variations", irStyle: "romantic_character",
      key: "C major",  form: "theme_variations", difficulty: "advanced",     tempo: 88 },

    // ── sonata_lite (4) — uses classical_sonata IR style ──────────────────────
    { id: "sonata-1", category: "sonata_lite", irStyle: "classical_sonata",
      key: "G major",  form: "sonata_allegro", difficulty: "intermediate", tempo: 116 },
    { id: "sonata-2", category: "sonata_lite", irStyle: "classical_sonata",
      key: "Bb major", form: "sonata_allegro", difficulty: "intermediate", tempo: 120 },
    { id: "sonata-3", category: "sonata_lite", irStyle: "classical_sonata",
      key: "E minor",  form: "sonata_allegro", difficulty: "advanced",     tempo: 112 },
    { id: "sonata-4", category: "sonata_lite", irStyle: "classical_sonata",
      key: "D major",  form: "sonata_allegro", difficulty: "advanced",     tempo: 120 },
];

assert.equal(BENCHMARK_PROMPTS.length, 30, "BENCHMARK_PROMPTS must contain exactly 30 entries");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function noteEvt(pitch, ql = 1) {
    return { type: "note", pitch, quarterLength: ql };
}

function mkIdealArtifact({ playabilityScore = 0.95 } = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: 8,
        // Stepwise RH melody in comfortable register
        melodyEvents: [
            noteEvt(64), noteEvt(65), noteEvt(67), noteEvt(69),
            noteEvt(67), noteEvt(65), noteEvt(64), noteEvt(62),
        ],
        // Stepwise LH bass in bass register
        accompanimentEvents: [
            noteEvt(40), noteEvt(40), noteEvt(43), noteEvt(43),
            noteEvt(40), noteEvt(40), noteEvt(38), noteEvt(38),
        ],
        noteHistory: [],
        bassMotionProfile: "stepwise",   // required for computeBassCoherence >= 0.70
        pianoVoiceLayout: {
            maxRightHandSpan: 10,
            maxLeftHandSpan: 10,
            playableSpanFit: 0.95,
            handCollisionCount: 0,
            handCrossingCount: 0,
            pedalEventCount: 4,
        },
        pianoPlayabilityScore: playabilityScore,
    };
}

function mkEvalReport() {
    return { passed: true, issues: [], score: 0.8 };
}

/** Median of an array (sorted in place). */
function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Part 1: Coverage — all 30 benchmark prompts resolve to solo_piano_symbolic
// ═══════════════════════════════════════════════════════════════════════════════

test("BM-coverage: benchmark bank contains exactly 30 prompts", () => {
    assert.equal(BENCHMARK_PROMPTS.length, 30);
});

test("BM-coverage: benchmark bank covers all 7 required style categories", () => {
    const requiredCategories = new Set([
        "classical_sonatina",
        "romantic_nocturne",
        "baroque_invention",
        "waltz",
        "etude",
        "theme_variations",
        "sonata_lite",
    ]);
    const present = new Set(BENCHMARK_PROMPTS.map((p) => p.category));
    for (const cat of requiredCategories) {
        assert.ok(present.has(cat), `benchmark bank must include category '${cat}'`);
    }
});

test("BM-coverage: all 30 benchmark prompts resolve to solo_piano_symbolic lane", () => {
    const failed = [];
    for (const spec of BENCHMARK_PROMPTS) {
        const request = makePianoRequest(spec);
        try {
            const pack = buildLearnedSymbolicPromptPack(request);
            if (pack.lane !== "solo_piano_symbolic") {
                failed.push(`${spec.id}: lane=${pack.lane}`);
            }
        } catch (err) {
            failed.push(`${spec.id}: threw — ${err.message}`);
        }
    }
    assert.equal(
        failed.length, 0,
        `failed prompts: ${failed.join(", ")}`,
    );
});

test("BM-coverage: every prompt produces a valid planSignature containing the lane token", () => {
    for (const spec of BENCHMARK_PROMPTS) {
        const pack = buildLearnedSymbolicPromptPack(makePianoRequest(spec));
        assert.ok(
            pack.planSignature.includes("solo_piano_symbolic"),
            `${spec.id}: planSignature must include solo_piano_symbolic`,
        );
        assert.ok(pack.planSignature.length > 20, `${spec.id}: planSignature is too short`);
    }
});

test("BM-coverage: same prompt produces identical planSignature on repeat calls (determinism)", () => {
    const spec = BENCHMARK_PROMPTS[0];
    const req = makePianoRequest(spec);
    const pack1 = buildLearnedSymbolicPromptPack(req);
    const pack2 = buildLearnedSymbolicPromptPack(req);
    assert.equal(pack1.planSignature, pack2.planSignature);
    assert.equal(pack1.lane, pack2.lane);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 2: Texture templates — correct texture per IR style + role
// ═══════════════════════════════════════════════════════════════════════════════

test("BM-texture: classical_sonata / theme_a → alberti_bass", () => {
    const plan = buildPianoSectionPlanForStyle("s1", "classical_sonata", "theme_a");
    assert.equal(plan.textureKind, "alberti_bass");
    assert.equal(validatePianoSectionPlan(plan).length, 0, "section plan must be valid");
});

test("BM-texture: nocturne / theme_a → nocturne", () => {
    const plan = buildPianoSectionPlanForStyle("s1", "nocturne", "theme_a");
    assert.equal(plan.textureKind, "nocturne");
    assert.equal(validatePianoSectionPlan(plan).length, 0);
});

test("BM-texture: etude / theme_a → etude_figuration", () => {
    const plan = buildPianoSectionPlanForStyle("s1", "etude", "theme_a");
    assert.equal(plan.textureKind, "etude_figuration");
    assert.equal(validatePianoSectionPlan(plan).length, 0);
});

test("BM-texture: romantic_character / theme_a → arpeggiated_texture", () => {
    const plan = buildPianoSectionPlanForStyle("s1", "romantic_character", "theme_a");
    assert.equal(plan.textureKind, "arpeggiated_texture");
    assert.equal(validatePianoSectionPlan(plan).length, 0);
});

test("BM-texture: all 4 IR styles produce valid section plans for theme_a role", () => {
    const styles = ["classical_sonata", "nocturne", "etude", "romantic_character"];
    for (const style of styles) {
        const plan = buildPianoSectionPlanForStyle("s1", style, "theme_a");
        const issues = validatePianoSectionPlan(plan);
        assert.equal(
            issues.length, 0,
            `${style}/theme_a validation issues: ${issues.join(", ")}`,
        );
    }
});

test("BM-texture: buildPianoSectionPlanForStyle respects difficulty span constraints", () => {
    const easy        = buildPianoSectionPlanForStyle("s1", "classical_sonata", "theme_a", "easy");
    const advanced    = buildPianoSectionPlanForStyle("s1", "classical_sonata", "theme_a", "advanced");
    const virtuosic   = buildPianoSectionPlanForStyle("s1", "classical_sonata", "theme_a", "virtuosic");

    // Span ceiling increases with difficulty
    assert.ok(
        easy.rightHand.maxComfortableSpan <= advanced.rightHand.maxComfortableSpan,
        "easy span must be <= advanced span",
    );
    assert.ok(
        advanced.rightHand.maxComfortableSpan <= virtuosic.rightHand.maxComfortableSpan,
        "advanced span must be <= virtuosic span",
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 3: Score thresholds — ideal artifacts meet documented success criteria
// ═══════════════════════════════════════════════════════════════════════════════

test("BM-score: pianoPlayabilityGate passes ideal artifacts at > 0.80 (target median >= 0.80)", () => {
    const idealArtifacts = BENCHMARK_PROMPTS.map(() => mkIdealArtifact());
    const scores = idealArtifacts.map((a) => {
        const gate = pianoPlayabilityGate([a], 0.50);
        return gate.pianoPlayabilityScore ?? 0;
    });
    const med = median(scores);
    assert.ok(med >= 0.80, `playabilityScore median ${med.toFixed(3)} must be >= 0.80`);
});

test("BM-score: melodicClarity median across ideal artifacts >= 0.75", () => {
    const scores = BENCHMARK_PROMPTS.map(() => computeMelodicClarity([mkIdealArtifact()]).score);
    const med = median(scores);
    assert.ok(med >= 0.75, `melodicClarity median ${med.toFixed(3)} must be >= 0.75`);
});

test("BM-score: bassCoherence median across ideal artifacts >= 0.70", () => {
    const scores = BENCHMARK_PROMPTS.map(() => computeBassCoherence([mkIdealArtifact()]).score);
    const med = median(scores);
    assert.ok(med >= 0.70, `bassCoherence median ${med.toFixed(3)} must be >= 0.70`);
});

test("BM-score: handPlayability of ideal layout >= 0.80", () => {
    const layout = {
        maxRightHandSpan: 10, maxLeftHandSpan: 10,
        playableSpanFit: 0.95, handCollisionCount: 0,
    };
    const result = computeHandPlayability(layout);
    assert.ok(result.score >= 0.80, `handPlayability should be >= 0.80, got ${result.score.toFixed(3)}`);
});

test("BM-score: finalPianoScore median across ideal artifacts >= 0.70", () => {
    const IDEAL_LAYOUT = {
        maxRightHandSpan: 10, maxLeftHandSpan: 10,
        playableSpanFit: 0.95, handCollisionCount: 0,
        handCrossingCount: 0, pedalEventCount: 4,
    };
    const evalReport = mkEvalReport();
    const scores = BENCHMARK_PROMPTS.map(() => {
        const craft = computePianoCraftScoreSummary([mkIdealArtifact()], {}, evalReport, IDEAL_LAYOUT);
        return craft.finalPianoScore;
    });
    const med = median(scores);
    assert.ok(med >= 0.70, `finalPianoScore median ${med.toFixed(3)} must be >= 0.70`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Part 4: Gate constant consistency
// ═══════════════════════════════════════════════════════════════════════════════

test("BM-constants: PLAYABILITY_LABEL_THRESHOLD (0.60) is above default gate threshold (0.50)", () => {
    // The dataset labelling threshold (0.60) must be strictly above the
    // evaluation gate (0.50): candidates pass the gate but are still tracked
    // as "questionable" for the playability training dataset.
    assert.ok(
        PLAYABILITY_LABEL_THRESHOLD > 0.50,
        `PLAYABILITY_LABEL_THRESHOLD ${PLAYABILITY_LABEL_THRESHOLD} must be > gate default 0.50`,
    );
});

test("BM-constants: benchmark success criteria are internally consistent", () => {
    // playabilityScore target (0.80) > PLAYABILITY_LABEL_THRESHOLD (0.60) > gate (0.50)
    const playabilityTarget = 0.80;
    const labelThreshold = PLAYABILITY_LABEL_THRESHOLD;
    const gateDefault = 0.50;

    assert.ok(
        playabilityTarget > labelThreshold,
        "benchmark playability target must be > PLAYABILITY_LABEL_THRESHOLD",
    );
    assert.ok(
        labelThreshold > gateDefault,
        "PLAYABILITY_LABEL_THRESHOLD must be > gate default threshold",
    );
});
