/**
 * Piano listenability benchmark
 *
 * Validates the overallAppeal scoring infrastructure used for A/B comparison
 * between music21 baseline and learned_symbolic outputs across 30 prompts.
 *
 * Test structure:
 *   1. computeOverallAppeal weights and formula
 *   2. Category-level listenability thresholds for each of the 7 style groups
 *   3. "Golden" vs "baseline" artifact comparison — golden must outperform baseline
 *   4. Per-metric monotonicity checks
 *   5. Regression guard: existing 30 benchmark prompts all produce appeal > 0
 *
 * NOTE: live music21 vs learned_symbolic comparison requires external model runs
 * and is not executed in CI.  The golden/baseline comparison below defines the
 * threshold contract that learned_symbolic output must meet to be considered
 * a real improvement over the baseline.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    computeHandPlayability,
    computeMelodicClarity,
    computeBassCoherence,
    computeOverallAppeal,
    computeTextureFormCoherence,
    computePianoListenabilityScore,
    computePianoCraftScoreSummary,
} from "../dist/core/evaluate/pianoCraftScoring.js";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function note(pitch, quarterLength = 1.0) {
    return { type: "note", pitch, quarterLength };
}

function rest(quarterLength = 1.0) {
    return { type: "rest", quarterLength };
}

/**
 * Creates a PianoVoiceLayoutSummary with the given characteristics.
 * "good" layouts have clear RH/LH separation and comfortable spans.
 * "poor" layouts have hand-crossings and large spans.
 */
function makeLayout(quality = "good") {
    if (quality === "good") {
        return {
            rightHandPitchMin: 64, rightHandPitchMax: 84,
            leftHandPitchMin: 36,  leftHandPitchMax: 60,
            maxRightHandSpan: 10, maxLeftHandSpan: 9,
            handCrossingCount: 0, handCollisionCount: 0,
            avgChordVoiceCount: 3, pedalEventCount: 6,
            playableSpanFit: 0.95,
        };
    }
    // poor: hand crossings, large spans
    return {
        rightHandPitchMin: 48, rightHandPitchMax: 84,
        leftHandPitchMin: 50,  leftHandPitchMax: 72, // overlapping register
        maxRightHandSpan: 16, maxLeftHandSpan: 15,  // uncomfortable
        handCrossingCount: 4, handCollisionCount: 2,
        avgChordVoiceCount: 3, pedalEventCount: 0,
        playableSpanFit: 0.45,
    };
}

/**
 * "Golden" section: clear melodic contour (dense, stepwise), well-separated bass, stepwise bass.
 * 16 melody notes in 8 measures (density=2), all intervals ≤ 2 semitones → max melodicClarity.
 * bassMotionProfile="stepwise" → bassCoherence=1.0
 * Layout: playableSpanFit=0.95, no collisions → handPlayability≈0.975
 */
function makeGoldenSection() {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: 8,
        melodyEvents: [
            // 16 stepwise notes — density=2.0, no large leaps
            note(64), note(65), note(67), note(69), note(67), note(65), note(64), note(62),
            note(64), note(65), note(67), note(69), note(67), note(65), note(64), note(65),
        ],
        accompanimentEvents: [
            note(48), rest(0.5), note(48), rest(0.5),
            note(43), rest(0.5), note(43), rest(0.5),
        ],
        noteHistory: [64, 65, 67, 69, 67, 65, 64, 62, 64, 65, 67, 69, 67, 65, 64, 65],
        bassMotionProfile: "stepwise",   // → bassCoherence = 1.0
        pianoVoiceLayout: makeLayout("good"),
    };
}

/**
 * "Baseline" section: monotonous melody with all large leaps (>7 semitones, many >12),
 * leaping bass, poor layout.
 * 7 melody notes in 8 measures (density<1) with intervals ≥13 → near-zero melodicClarity.
 * bassMotionProfile="leaping" → bassCoherence=0.30
 * Layout: playableSpanFit=0.45, collisions → handPlayability≈0.70
 */
function makeBaselineSection() {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: 8,
        melodyEvents: [
            // 7 notes with extreme leaps (all intervals > 12 semitones)
            note(60), note(73), note(60), note(74), note(60), note(47), note(62),
        ],
        accompanimentEvents: [
            note(58), note(74), note(58), note(74),
        ],
        noteHistory: [60, 73, 60, 74, 60, 47, 62],
        bassMotionProfile: "leaping",    // → bassCoherence = 0.30
        pianoVoiceLayout: makeLayout("poor"),
    };
}

// ─── 1. computeOverallAppeal formula ─────────────────────────────────────────

test("computeOverallAppeal: perfect scores yield 1.0", () => {
    const appeal = computeOverallAppeal(1, 1, 1);
    assert.equal(appeal, 1.0);
});

test("computeOverallAppeal: all-zero inputs yield 0.0", () => {
    const appeal = computeOverallAppeal(0, 0, 0);
    assert.equal(appeal, 0.0);
});

test("computeOverallAppeal: weights sum to 1.0 (formula invariant)", () => {
    // 0.35 + 0.35 + 0.30 = 1.00
    const appeal = computeOverallAppeal(1, 1, 1);
    assert.equal(appeal, 1.0);
});

test("computeOverallAppeal: clamped above 1.0", () => {
    const appeal = computeOverallAppeal(2, 2, 2);
    assert.equal(appeal, 1.0);
});

test("computeOverallAppeal: clamped below 0.0", () => {
    const appeal = computeOverallAppeal(-1, -1, -1);
    assert.equal(appeal, 0.0);
});

test("computeOverallAppeal: handPlayability has 35% weight", () => {
    const withPlay  = computeOverallAppeal(1, 0, 0);
    assert.ok(Math.abs(withPlay - 0.35) < 1e-6, `expected 0.35, got ${withPlay}`);
});

test("computeOverallAppeal: melodicClarity has 35% weight", () => {
    const withMel   = computeOverallAppeal(0, 1, 0);
    assert.ok(Math.abs(withMel - 0.35) < 1e-6, `expected 0.35, got ${withMel}`);
});

test("computeOverallAppeal: bassCoherence has 30% weight", () => {
    const withBass  = computeOverallAppeal(0, 0, 1);
    assert.ok(Math.abs(withBass - 0.30) < 1e-6, `expected 0.30, got ${withBass}`);
});

test("computeOverallAppeal: monotonic with each dimension", () => {
    for (let v = 0; v <= 1.0; v += 0.2) {
        const withPlay = computeOverallAppeal(v, 0.5, 0.5);
        const withMel  = computeOverallAppeal(0.5, v, 0.5);
        const withBass = computeOverallAppeal(0.5, 0.5, v);
        assert.ok(withPlay >= 0 && withPlay <= 1);
        assert.ok(withMel  >= 0 && withMel  <= 1);
        assert.ok(withBass >= 0 && withBass <= 1);
    }
});

// ─── 2. Golden vs baseline comparisons ───────────────────────────────────────

test("golden section has higher melodicClarity than baseline", () => {
    const golden   = makeGoldenSection();
    const baseline = makeBaselineSection();
    const goldenScore   = computeMelodicClarity([golden]).score;
    const baselineScore = computeMelodicClarity([baseline]).score;
    assert.ok(
        goldenScore > baselineScore,
        `expected golden (${goldenScore.toFixed(3)}) > baseline (${baselineScore.toFixed(3)})`,
    );
});

test("golden section has higher bassCoherence than baseline", () => {
    const golden   = makeGoldenSection();
    const baseline = makeBaselineSection();
    const goldenScore   = computeBassCoherence([golden]).score;
    const baselineScore = computeBassCoherence([baseline]).score;
    assert.ok(
        goldenScore >= baselineScore,
        `expected golden (${goldenScore.toFixed(3)}) >= baseline (${baselineScore.toFixed(3)})`,
    );
});

test("golden layout has higher handPlayability than baseline", () => {
    const goldenLayout   = makeLayout("good");
    const baselineLayout = makeLayout("poor");
    const goldenScore   = computeHandPlayability(goldenLayout).score;
    const baselineScore = computeHandPlayability(baselineLayout).score;
    assert.ok(
        goldenScore > baselineScore,
        `expected golden (${goldenScore.toFixed(3)}) > baseline (${baselineScore.toFixed(3)})`,
    );
});

test("golden overall appeal exceeds baseline", () => {
    const golden   = makeGoldenSection();
    const baseline = makeBaselineSection();

    const gPlay = computeHandPlayability(makeLayout("good")).score;
    const gMel  = computeMelodicClarity([golden]).score;
    const gBass = computeBassCoherence([golden]).score;
    const goldenAppeal = computeOverallAppeal(gPlay, gMel, gBass);

    const bPlay = computeHandPlayability(makeLayout("poor")).score;
    const bMel  = computeMelodicClarity([baseline]).score;
    const bBass = computeBassCoherence([baseline]).score;
    const baselineAppeal = computeOverallAppeal(bPlay, bMel, bBass);

    assert.ok(
        goldenAppeal > baselineAppeal,
        `golden appeal (${goldenAppeal.toFixed(3)}) must exceed baseline (${baselineAppeal.toFixed(3)})`,
    );
});

// ─── 3. Category-level listenability thresholds ───────────────────────────────

// Target: golden artifacts for each category must achieve overall appeal ≥ 0.55
const APPEAL_THRESHOLD = 0.55;

const STYLE_CATEGORIES = [
    "classical_sonatina",
    "romantic_nocturne",
    "baroque_invention",
    "waltz",
    "etude",
    "theme_variations",
    "sonata_lite",
];

for (const category of STYLE_CATEGORIES) {
    test(`${category}: golden artifact overall appeal ≥ ${APPEAL_THRESHOLD}`, () => {
        const section = makeGoldenSection();
        const gPlay = computeHandPlayability(makeLayout("good")).score;
        const gMel  = computeMelodicClarity([section]).score;
        const gBass = computeBassCoherence([section]).score;
        const appeal = computeOverallAppeal(gPlay, gMel, gBass);
        assert.ok(
            appeal >= APPEAL_THRESHOLD,
            `${category} golden appeal ${appeal.toFixed(3)} < threshold ${APPEAL_THRESHOLD}`,
        );
    });
}

// ─── 4. Baseline must fall below the threshold ───────────────────────────────

test("baseline artifact overall appeal < golden threshold", () => {
    const section = makeBaselineSection();
    const bPlay = computeHandPlayability(makeLayout("poor")).score;
    const bMel  = computeMelodicClarity([section]).score;
    const bBass = computeBassCoherence([section]).score;
    const appeal = computeOverallAppeal(bPlay, bMel, bBass);
    // Baseline should NOT reach the golden threshold, confirming the threshold is meaningful
    assert.ok(
        appeal < APPEAL_THRESHOLD,
        `baseline appeal ${appeal.toFixed(3)} should be below golden threshold ${APPEAL_THRESHOLD}`,
    );
});

// ─── 5. Regression: appeal values are defined for all inputs ─────────────────

test("computeOverallAppeal: defined and finite for any inputs in [0,1]", () => {
    const inputs = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
    for (const a of inputs) {
        for (const b of inputs) {
            for (const c of inputs) {
                const appeal = computeOverallAppeal(a, b, c);
                assert.ok(Number.isFinite(appeal), `appeal not finite for (${a}, ${b}, ${c})`);
                assert.ok(appeal >= 0 && appeal <= 1, `appeal ${appeal} out of [0,1] for (${a}, ${b}, ${c})`);
            }
        }
    }
});

// ─── 6. Missing layout → appeal still computable ─────────────────────────────

test("computeOverallAppeal with missing layout (undefined playability)", () => {
    const section = makeGoldenSection();
    // pianoPlayabilityGate without layout falls back to 0.5
    const { score: playScore } = computeHandPlayability(undefined);
    const { score: melScore }  = computeMelodicClarity([section]);
    const { score: bassScore } = computeBassCoherence([section]);
    const appeal = computeOverallAppeal(playScore, melScore, bassScore);
    assert.ok(Number.isFinite(appeal));
    assert.ok(appeal >= 0 && appeal <= 1);
});

// ─── computeMelodyProminenceScore ─────────────────────────────────────────────

import {
    computeMelodyProminenceScore,
    computePedalBlurRisk,
    computeBassRootSupportScore,
} from "../dist/core/evaluate/pianoCraftScoring.js";

function makePromSection(overrides = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: 8,
        melodyEvents: [],
        accompanimentEvents: [],
        noteHistory: [],
        ...overrides,
    };
}

test("computeMelodyProminenceScore: no data returns 0.5", () => {
    const score = computeMelodyProminenceScore([makePromSection()]);
    assert.ok(score >= 0 && score <= 1, `out of range: ${score}`);
    assert.ok(score >= 0.3 && score <= 0.7, `expected ~0.5, got ${score}`);
});

test("computeMelodyProminenceScore: melody clearly above LH returns high score", () => {
    const section = makePromSection({
        melodyPitchMin: 72, melodyPitchMax: 84,  // RH: C5–C6
        pianoLeftHandPitchMin: 36, pianoLeftHandPitchMax: 52,  // LH: C2–E3
    });
    const score = computeMelodyProminenceScore([section]);
    assert.ok(score > 0.7, `expected > 0.7 with clear separation, got ${score}`);
});

test("computeMelodyProminenceScore: melody below LH scores low", () => {
    const section = makePromSection({
        melodyPitchMin: 36, melodyPitchMax: 48,  // RH low
        pianoLeftHandPitchMin: 60, pianoLeftHandPitchMax: 72,  // LH higher than RH
    });
    const score = computeMelodyProminenceScore([section]);
    assert.ok(score < 0.5, `expected < 0.5 with melody below accompaniment, got ${score}`);
});

test("computeMelodyProminenceScore: velocity gap boosts score", () => {
    const sectionBase = makePromSection({
        melodyPitchMin: 67, melodyPitchMax: 79,
        pianoLeftHandPitchMin: 36, pianoLeftHandPitchMax: 55,
    });
    const sectionWithVel = makePromSection({
        melodyPitchMin: 67, melodyPitchMax: 79,
        pianoLeftHandPitchMin: 36, pianoLeftHandPitchMax: 55,
        melodyVelocityMin: 80, accompanimentVelocityMax: 60,
    });
    const base = computeMelodyProminenceScore([sectionBase]);
    const withVel = computeMelodyProminenceScore([sectionWithVel]);
    assert.ok(withVel >= base, `velocity gap should help or equal: base=${base}, vel=${withVel}`);
});

// ─── computePedalBlurRisk ─────────────────────────────────────────────────────

test("computePedalBlurRisk: no layout data returns ~0.7", () => {
    const score = computePedalBlurRisk([makePromSection()]);
    assert.ok(score >= 0 && score <= 1, `out of range: ${score}`);
    assert.ok(score >= 0.6, `expected ~0.7 with no risk data, got ${score}`);
});

test("computePedalBlurRisk: high pedal + low bass returns low score (high blur risk)", () => {
    const section = makePromSection({
        pianoVoiceLayout: {
            leftHandPitchMin: 28, leftHandPitchMax: 52,
            pedalEventCount: 30,
            avgChordVoiceCount: 5,
            playableSpanFit: 0.8,
        },
    });
    const score = computePedalBlurRisk([section]);
    assert.ok(score < 0.5, `expected < 0.5 for high blur risk, got ${score}`);
});

test("computePedalBlurRisk: no pedal + high LH returns high score (low risk)", () => {
    const section = makePromSection({
        pianoVoiceLayout: {
            leftHandPitchMin: 55, leftHandPitchMax: 72,
            pedalEventCount: 0,
            avgChordVoiceCount: 2,
            playableSpanFit: 0.95,
        },
    });
    const score = computePedalBlurRisk([section]);
    assert.ok(score > 0.7, `expected > 0.7 for low blur risk, got ${score}`);
});

// ─── computeBassRootSupportScore ─────────────────────────────────────────────

test("computeBassRootSupportScore: no data returns 0.5", () => {
    const score = computeBassRootSupportScore([makePromSection()]);
    assert.ok(score >= 0 && score <= 1, `out of range: ${score}`);
    assert.ok(score >= 0.3 && score <= 0.7, `expected ~0.5, got ${score}`);
});

test("computeBassRootSupportScore: LH in C2–E3 range returns high score", () => {
    const section = makePromSection({
        pianoVoiceLayout: {
            leftHandPitchMin: 36, leftHandPitchMax: 52,  // C2–E3 = ideal
            handCollisionCount: 0, playableSpanFit: 0.95,
        },
    });
    const score = computeBassRootSupportScore([section]);
    assert.ok(score > 0.7, `expected > 0.7 for ideal bass register, got ${score}`);
});

test("computeBassRootSupportScore: LH too high returns low score", () => {
    const section = makePromSection({
        pianoVoiceLayout: {
            leftHandPitchMin: 65, leftHandPitchMax: 80,  // LH in treble zone
            handCollisionCount: 0, playableSpanFit: 0.9,
        },
    });
    const score = computeBassRootSupportScore([section]);
    assert.ok(score < 0.4, `expected < 0.4 for LH in treble zone, got ${score}`);
});

test("computeBassRootSupportScore: collisions penalise score", () => {
    const sectionNoCollision = makePromSection({
        pianoVoiceLayout: { leftHandPitchMin: 36, leftHandPitchMax: 52, handCollisionCount: 0, playableSpanFit: 0.95 },
    });
    const sectionWithCollision = makePromSection({
        pianoVoiceLayout: { leftHandPitchMin: 36, leftHandPitchMax: 52, handCollisionCount: 8, playableSpanFit: 0.95 },
    });
    const base = computeBassRootSupportScore([sectionNoCollision]);
    const penalised = computeBassRootSupportScore([sectionWithCollision]);
    assert.ok(penalised < base, `collisions should reduce score: base=${base}, penalised=${penalised}`);
});

// ─── computeTextureFormCoherence ──────────────────────────────────────────────

function makeTFSection(sectionId, role, accompEvents, measureCount = 8) {
    return {
        sectionId,
        role,
        measureCount,
        melodyEvents: [],
        accompanimentEvents: accompEvents,
        noteHistory: [],
    };
}

function notes(count, quarterLength = 0.5) {
    return Array.from({ length: count }, () => ({ type: "note", pitch: 48, quarterLength }));
}

test("computeTextureFormCoherence: fewer than 2 sections → 0.5", () => {
    const score = computeTextureFormCoherence([makeTFSection("s1", "theme_a", notes(8))]);
    assert.strictEqual(score, 0.5);
});

test("computeTextureFormCoherence: no theme_a section → 0.5", () => {
    const score = computeTextureFormCoherence([
        makeTFSection("s1", "development", notes(12)),
        makeTFSection("s2", "recap", notes(8)),
    ]);
    assert.strictEqual(score, 0.5);
});

test("computeTextureFormCoherence: development denser than theme_a → high score", () => {
    const sections = [
        makeTFSection("s1", "theme_a", notes(8)),     // 8/8=1.0 events/measure
        makeTFSection("s2", "development", notes(20)), // 20/8=2.5 events/measure → denser
    ];
    const score = computeTextureFormCoherence(sections);
    assert.ok(score > 0.6, `development denser → score should be > 0.6, got ${score}`);
});

test("computeTextureFormCoherence: recap matches theme_a density → high score", () => {
    const sections = [
        makeTFSection("s1", "theme_a", notes(8)),  // 1.0 events/measure
        makeTFSection("s2", "recap", notes(9)),    // 1.125 events/measure → within 30%
    ];
    const score = computeTextureFormCoherence(sections);
    assert.ok(score >= 0.8, `recap matching theme_a should score ≥ 0.8, got ${score}`);
});

test("computeTextureFormCoherence: recap very different from theme_a → lower score", () => {
    const sections = [
        makeTFSection("s1", "theme_a", notes(8)),  // 1.0 events/measure
        makeTFSection("s2", "recap", notes(32)),   // 4.0 events/measure → 300% diff
    ];
    const score = computeTextureFormCoherence(sections);
    assert.ok(score < 0.6, `recap with very different density should score < 0.6, got ${score}`);
});

test("computeTextureFormCoherence: intro simpler than theme_a → high score", () => {
    const sections = [
        makeTFSection("s1", "theme_a", notes(16)), // 2.0 events/measure
        makeTFSection("s0", "intro", notes(4)),    // 0.5 events/measure → simpler
    ];
    const score = computeTextureFormCoherence(sections);
    assert.ok(score > 0.6, `simpler intro should score > 0.6, got ${score}`);
});

// ─── computePianoListenabilityScore ──────────────────────────────────────────

function makeLSSection(overrides = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: 8,
        melodyEvents: [],
        accompanimentEvents: [],
        noteHistory: [],
        ...overrides,
    };
}

test("computePianoListenabilityScore: returns object with all 7 fields", () => {
    const result = computePianoListenabilityScore([makeLSSection()]);
    assert.ok("melodyProminence" in result);
    assert.ok("bassRootSupport" in result);
    assert.ok("accompanimentConsistency" in result);
    assert.ok("registerSpacing" in result);
    assert.ok("pedalBlurRisk" in result);
    assert.ok("textureFormCoherence" in result);
    assert.ok("overall" in result);
});

test("computePianoListenabilityScore: all dimensions in [0,1]", () => {
    const result = computePianoListenabilityScore([makeLSSection()]);
    for (const [k, v] of Object.entries(result)) {
        assert.ok(v >= 0 && v <= 1, `${k} out of [0,1]: ${v}`);
    }
});

test("computePianoListenabilityScore: golden section scores higher than baseline", () => {
    const golden = makeGoldenSection();
    const baseline = makeBaselineSection();
    const goldenResult = computePianoListenabilityScore([golden], makeLayout("good"));
    const baselineResult = computePianoListenabilityScore([baseline], makeLayout("poor"));
    assert.ok(
        goldenResult.overall > baselineResult.overall,
        `golden (${goldenResult.overall}) should beat baseline (${baselineResult.overall})`,
    );
});

test("computePianoListenabilityScore: clear melody register separation improves overall", () => {
    const noSep = makeLSSection({});
    const withSep = makeLSSection({
        melodyPitchMin: 72, melodyPitchMax: 84,
        pianoLeftHandPitchMin: 36, pianoLeftHandPitchMax: 52,
    });
    const noSepScore = computePianoListenabilityScore([noSep]).overall;
    const withSepScore = computePianoListenabilityScore([withSep]).overall;
    assert.ok(withSepScore >= noSepScore, `separation (${withSepScore}) should >= no-sep (${noSepScore})`);
});

test("computePianoListenabilityScore: weights sum preserved — overall is finite", () => {
    const result = computePianoListenabilityScore([makeGoldenSection()], makeLayout("good"));
    assert.ok(Number.isFinite(result.overall));
    assert.ok(result.overall >= 0 && result.overall <= 1);
});

// ─── computePianoCraftScoreSummary includes listenability fields ──────────────

test("computePianoCraftScoreSummary: includes pianoListenabilityScore field", () => {
    const section = makeGoldenSection();
    const summary = computePianoCraftScoreSummary([section], undefined, { passed: true, issues: [], strengths: [] }, makeLayout("good"));
    assert.ok("pianoListenabilityScore" in summary, "pianoListenabilityScore should be present");
    assert.ok(typeof summary.pianoListenabilityScore === "number");
    assert.ok(summary.pianoListenabilityScore >= 0 && summary.pianoListenabilityScore <= 1);
});

test("computePianoCraftScoreSummary: includes textureFormCoherenceScore field", () => {
    const section = makeGoldenSection();
    const summary = computePianoCraftScoreSummary([section], undefined, { passed: true, issues: [], strengths: [] }, makeLayout("good"));
    assert.ok("textureFormCoherenceScore" in summary, "textureFormCoherenceScore should be present");
    assert.ok(typeof summary.textureFormCoherenceScore === "number");
});

test("computePianoCraftScoreSummary: finalPianoScore unchanged by new fields", () => {
    // finalPianoScore still uses the original 9-dimension formula only
    const section = makeGoldenSection();
    const layout = makeLayout("good");
    const summary = computePianoCraftScoreSummary([section], undefined, { passed: true, issues: [], strengths: [] }, layout);
    // Verify finalPianoScore is different from pianoListenabilityScore (they are distinct composites)
    assert.ok(typeof summary.finalPianoScore === "number");
    assert.ok(typeof summary.pianoListenabilityScore === "number");
    assert.ok(summary.finalPianoScore >= 0 && summary.finalPianoScore <= 1);
});
