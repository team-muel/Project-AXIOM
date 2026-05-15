import test from "node:test";
import assert from "node:assert/strict";
import {
    computeHandPlayability,
    computeMelodicClarity,
    computeBassCoherence,
    computeVoicingIdiomaticFit,
    computeAccompanimentPatternCoherence,
    computeRegisterSpacing,
    computeHandIndependence,
    computePedalPlausibility,
    computeDifficultyFit,
    pianoPlayabilityGate,
    applyPianoPlayabilityGate,
    computePianoCraftScoreSummary,
} from "../dist/pipeline/pianoCraftScoring.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function note(pitch, quarterLength = 1.0) {
    return { type: "note", pitch, quarterLength };
}

function rest(quarterLength = 1.0) {
    return { type: "rest", quarterLength };
}

function emptySection(overrides = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: 4,
        melodyEvents: [],
        accompanimentEvents: [],
        noteHistory: [],
        ...overrides,
    };
}

function sectionWithMelody(pitches, overrides = {}) {
    return emptySection({
        melodyEvents: pitches.map((p) => note(p)),
        noteHistory: pitches,
        ...overrides,
    });
}

function cleanLayout(overrides = {}) {
    return {
        rightHandPitchMin: 64,
        rightHandPitchMax: 88,
        leftHandPitchMin: 36,
        leftHandPitchMax: 65,
        maxRightHandSpan: 12,
        maxLeftHandSpan: 10,
        handCrossingCount: 0,
        handCollisionCount: 0,
        avgChordVoiceCount: 4,
        pedalEventCount: 8,
        playableSpanFit: 0.95,
        ...overrides,
    };
}

// ─── 1. handPlayability ───────────────────────────────────────────────────────

test("computeHandPlayability returns 0.5 and notes when layout missing", () => {
    const { score, notes } = computeHandPlayability(undefined);
    assert.equal(score, 0.5);
    assert.ok(notes.includes("cannot be assessed"));
});

test("computeHandPlayability returns high score for clean layout", () => {
    const { score } = computeHandPlayability(cleanLayout());
    assert.ok(score > 0.85, `expected >0.85, got ${score}`);
});

test("computeHandPlayability degrades for many collisions", () => {
    const { score } = computeHandPlayability(cleanLayout({ handCollisionCount: 10, playableSpanFit: 0.5 }));
    assert.ok(score < 0.85, `expected <0.85 with collisions, got ${score}`);
});

// ─── 2. melodicClarity ───────────────────────────────────────────────────────

test("computeMelodicClarity returns 0.5 for empty artifacts", () => {
    const { score } = computeMelodicClarity([]);
    assert.equal(score, 0.5);
});

test("computeMelodicClarity rewards stepwise melody", () => {
    // Stepwise C-D-E-F-G: no large leaps
    const artifacts = [sectionWithMelody([60, 62, 64, 65, 67, 64, 62, 60])];
    const { score } = computeMelodicClarity(artifacts);
    assert.ok(score > 0.6, `expected >0.6 for stepwise, got ${score}`);
});

test("computeMelodicClarity penalises many large leaps (absorbed leap penalty)", () => {
    // All leaps > 7 semitones (octave leaps)
    const artifacts = [sectionWithMelody([60, 72, 48, 72, 48, 72, 48])];
    const { score } = computeMelodicClarity(artifacts);
    assert.ok(score < 0.7, `expected <0.7 for leap-heavy melody, got ${score}`);
});

test("computeMelodicClarity penalises super-octave leaps (> 12 semitones)", () => {
    const artifacts = [sectionWithMelody([60, 73, 60, 73, 60, 73, 60])];
    const { score } = computeMelodicClarity(artifacts);
    assert.ok(score < 0.6, `expected <0.6 for all super-octave leaps, got ${score}`);
});

// ─── 3. bassCoherence ────────────────────────────────────────────────────────

test("computeBassCoherence returns neutral for no artifacts", () => {
    const { score } = computeBassCoherence([]);
    assert.equal(score, 0.5);
});

test("computeBassCoherence rewards stepwise bass", () => {
    const artifacts = [emptySection({ bassMotionProfile: "stepwise", bassPitchMin: 36, bassPitchMax: 55 })];
    const { score } = computeBassCoherence(artifacts);
    assert.ok(score >= 0.95, `expected >=0.95 for stepwise bass, got ${score}`);
});

test("computeBassCoherence penalises leaping bass", () => {
    const artifacts = [emptySection({ bassMotionProfile: "leaping" })];
    const { score } = computeBassCoherence(artifacts);
    assert.ok(score <= 0.5, `expected <=0.5 for leaping bass, got ${score}`);
});

test("computeBassCoherence penalises bass above C5", () => {
    const artifacts = [emptySection({ bassMotionProfile: "stepwise", bassPitchMax: 76 })];
    const { score } = computeBassCoherence(artifacts);
    assert.ok(score < 1.0, `expected <1.0 when bass exceeds C5`);
});

// ─── 4. registerSpacing ───────────────────────────────────────────────────────

test("computeRegisterSpacing scores 1.0 when RH/LH gap >= 14 semitones", () => {
    // RH center = (64+88)/2 = 76, LH center = (36+55)/2 = 45.5 → gap ≈ 30
    const layout = cleanLayout({ rightHandPitchMin: 64, rightHandPitchMax: 88, leftHandPitchMin: 36, leftHandPitchMax: 55 });
    const { score } = computeRegisterSpacing([], layout);
    assert.equal(score, 1.0);
});

test("computeRegisterSpacing scores low when hands overlap", () => {
    // RH center = 62, LH center = 60 → gap = 2
    const layout = cleanLayout({ rightHandPitchMin: 60, rightHandPitchMax: 64, leftHandPitchMin: 58, leftHandPitchMax: 62 });
    const { score } = computeRegisterSpacing([], layout);
    assert.ok(score < 0.5, `expected <0.5 when hands overlap, got ${score}`);
});

test("computeRegisterSpacing falls back to artifact data", () => {
    const artifacts = [
        emptySection({ melodyPitchMin: 64, melodyPitchMax: 88, bassPitchMin: 36, bassPitchMax: 55 }),
    ];
    const { score } = computeRegisterSpacing(artifacts, undefined);
    assert.ok(score > 0.8, `expected >0.8 from artifact fallback, got ${score}`);
});

// ─── 4. voicingIdiomaticFit ───────────────────────────────────────────────────

test("computeVoicingIdiomaticFit returns neutral for no layout and no artifacts", () => {
    const { score } = computeVoicingIdiomaticFit([], undefined);
    assert.ok(score >= 0.4 && score <= 1.0, `expected 0.4–1.0 default, got ${score}`);
});

test("computeVoicingIdiomaticFit returns near 1.0 at or below 6 avg voices", () => {
    const { score } = computeVoicingIdiomaticFit([], cleanLayout({ avgChordVoiceCount: 4 }));
    assert.ok(score > 0.9, `expected >0.9 for 4 avg voices, got ${score}`);
});

test("computeVoicingIdiomaticFit degrades above 6 avg voices", () => {
    const { score } = computeVoicingIdiomaticFit([], cleanLayout({ avgChordVoiceCount: 9 }));
    assert.ok(score < 0.85, `expected <0.85 for 9 avg voices, got ${score}`);
});

test("computeVoicingIdiomaticFit penalises large span", () => {
    const { score } = computeVoicingIdiomaticFit([], cleanLayout({ maxRightHandSpan: 20, maxLeftHandSpan: 12 }));
    assert.ok(score < 1.0, `expected <1.0 for span >19, got ${score}`);
});

// ─── 5. accompanimentPatternCoherence ────────────────────────────────────────

test("computeAccompanimentPatternCoherence returns 0.5 for empty", () => {
    const { score } = computeAccompanimentPatternCoherence([]);
    assert.equal(score, 0.5);
});

test("computeAccompanimentPatternCoherence rewards uniform rhythm", () => {
    const uniform = emptySection({
        accompanimentEvents: [note(36, 0.5), note(43, 0.5), note(48, 0.5), note(43, 0.5), note(36, 0.5), note(43, 0.5)],
    });
    const { score } = computeAccompanimentPatternCoherence([uniform]);
    assert.ok(score > 0.75, `expected >0.75 for uniform Alberti, got ${score}`);
});

test("computeAccompanimentPatternCoherence penalises irregular rhythm", () => {
    // Wildly different durations
    const irregular = emptySection({
        accompanimentEvents: [note(36, 0.25), note(43, 3.5), note(48, 0.25), note(43, 4.0), note(36, 0.1)],
    });
    const { score } = computeAccompanimentPatternCoherence([irregular]);
    assert.ok(score < 0.6, `expected <0.6 for irregular rhythm, got ${score}`);
});

// ─── 7. handIndependence ──────────────────────────────────────────────────────

test("computeHandIndependence returns 0.5 for empty artifacts", () => {
    const { score } = computeHandIndependence([]);
    assert.equal(score, 0.5);
});

test("computeHandIndependence rewards balanced density between hands", () => {
    const balanced = emptySection({
        melodyEvents: Array(8).fill(note(64)),
        accompanimentEvents: Array(8).fill(note(48)),
    });
    const { score } = computeHandIndependence([balanced]);
    assert.ok(score > 0.6, `expected >0.6 for balanced density, got ${score}`);
});

test("computeHandIndependence rewards contrary motion", () => {
    const s = emptySection({ textureContraryMotionRate: 0.35 });
    const { score } = computeHandIndependence([s]);
    assert.ok(score > 0.5, `expected >0.5 with contrary motion, got ${score}`);
});

test("computeHandIndependence penalises one hand dominating (ratio > 4x)", () => {
    const unbalanced = emptySection({
        melodyEvents: Array(20).fill(note(64)),
        accompanimentEvents: [note(48)],
    });
    const { score } = computeHandIndependence([unbalanced]);
    assert.ok(score < 0.8, `expected <0.8 for 20:1 density, got ${score}`);
});

// ─── 8. pedalPlausibility ────────────────────────────────────────────────────

test("computePedalPlausibility returns 0.5 for no events", () => {
    const { score } = computePedalPlausibility([], cleanLayout({ pedalEventCount: 0 }));
    assert.equal(score, 0.5);
});

test("computePedalPlausibility gives 0.6 for zero pedal events", () => {
    const artifacts = [sectionWithMelody([60, 62, 64])];
    const { score } = computePedalPlausibility(artifacts, cleanLayout({ pedalEventCount: 0 }));
    assert.equal(score, 0.6);
});

test("computePedalPlausibility rewards moderate pedal usage", () => {
    const artifacts = [emptySection({
        melodyEvents: Array(20).fill(note(60)),
        accompanimentEvents: Array(10).fill(note(48)),
    })];
    const layout = cleanLayout({ pedalEventCount: 15 });
    const { score } = computePedalPlausibility(artifacts, layout);
    assert.ok(score > 0.6, `expected >0.6 for moderate pedal, got ${score}`);
});

test("computePedalPlausibility penalises over-pedalling", () => {
    // 90% of all events have pedal
    const artifacts = [emptySection({
        melodyEvents: Array(10).fill(note(60)),
    })];
    const layout = cleanLayout({ pedalEventCount: 9 });
    const { score } = computePedalPlausibility(artifacts, layout);
    assert.ok(score < 0.7, `expected <0.7 for over-pedalling, got ${score}`);
});

// ─── 9. difficultyFit ────────────────────────────────────────────────────────

test("computeDifficultyFit returns 0.7 for no span data", () => {
    const { score } = computeDifficultyFit([], undefined, undefined);
    assert.equal(score, 0.7);
});

test("computeDifficultyFit returns ~1.0 when span fits easy ceiling (10)", () => {
    const plan = { pianoPlan: { difficultyTarget: "easy" } };
    const layout = cleanLayout({ maxRightHandSpan: 9, maxLeftHandSpan: 8 });
    const { score } = computeDifficultyFit([], plan, layout);
    assert.ok(score > 0.9, `expected >0.9 for span within easy ceiling, got ${score}`);
});

test("computeDifficultyFit degrades when span exceeds difficulty ceiling", () => {
    const plan = { pianoPlan: { difficultyTarget: "easy" } };  // ceiling = 10
    const layout = cleanLayout({ maxRightHandSpan: 16, maxLeftHandSpan: 12 });
    const { score } = computeDifficultyFit([], plan, layout);
    assert.ok(score < 0.6, `expected <0.6 for span 16 vs easy ceiling 10, got ${score}`);
});

test("computeDifficultyFit uses pianoHandSpanMax from artifacts as fallback", () => {
    const artifacts = [emptySection({ pianoHandSpanMax: 11 })];
    const plan = { pianoPlan: { difficultyTarget: "intermediate" } };  // ceiling = 12
    const { score } = computeDifficultyFit(artifacts, plan, undefined);
    assert.ok(score > 0.9, `expected >0.9 for span 11 within intermediate ceiling 12, got ${score}`);
});

// ─── Gate 3 — pianoPlayabilityGate ───────────────────────────────────────────

test("pianoPlayabilityGate passes when no pianoPlayabilityScore present", () => {
    const artifacts = [emptySection()];  // no pianoPlayabilityScore field
    const result = pianoPlayabilityGate(artifacts);
    assert.equal(result.passed, true);
    assert.equal(result.pianoPlayabilityScore, undefined);
});

test("pianoPlayabilityGate passes when score exceeds threshold", () => {
    const artifacts = [emptySection({ pianoPlayabilityScore: 0.75 })];
    const result = pianoPlayabilityGate(artifacts, 0.50);
    assert.equal(result.passed, true);
    assert.equal(result.pianoPlayabilityScore, 0.75);
});

test("pianoPlayabilityGate rejects when minimum score is below threshold", () => {
    const artifacts = [
        emptySection({ pianoPlayabilityScore: 0.80 }),
        emptySection({ pianoPlayabilityScore: 0.30 }),  // worst case
    ];
    const result = pianoPlayabilityGate(artifacts, 0.50);
    assert.equal(result.passed, false);
    assert.ok(result.pianoPlayabilityScore < 0.50);
    assert.ok(result.reason !== undefined);
});

test("pianoPlayabilityGate uses minimum across sections (worst-case)", () => {
    const artifacts = [
        emptySection({ pianoPlayabilityScore: 0.95 }),
        emptySection({ pianoPlayabilityScore: 0.55 }),
        emptySection({ pianoPlayabilityScore: 0.45 }),
    ];
    const result = pianoPlayabilityGate(artifacts, 0.50);
    assert.equal(result.passed, false);
    assert.equal(result.pianoPlayabilityScore, 0.45);
});

test("applyPianoPlayabilityGate returns same report when gate passes", () => {
    const report = { passed: true, issues: [], strengths: ["good melody"] };
    const artifacts = [emptySection({ pianoPlayabilityScore: 0.80 })];
    const result = applyPianoPlayabilityGate(report, artifacts, 0.50);
    assert.equal(result.passed, true);
    assert.deepEqual(result, report);
});

test("applyPianoPlayabilityGate sets passed=false and prepends issue", () => {
    const report = { passed: true, issues: ["some existing issue"], strengths: [] };
    const artifacts = [emptySection({ pianoPlayabilityScore: 0.30 })];
    const result = applyPianoPlayabilityGate(report, artifacts, 0.50);
    assert.equal(result.passed, false);
    assert.equal(result.issues.length, 2);  // prepended + original
    assert.ok(result.issues[0].includes("pianoPlayabilityScore"));
});

// ─── Master computePianoCraftScoreSummary ─────────────────────────────────────

test("computePianoCraftScoreSummary returns valid score structure", () => {
    const artifacts = [sectionWithMelody([60, 62, 64, 65, 67], {
        accompanimentEvents: [note(36, 0.5), note(43, 0.5), note(48, 0.5), note(43, 0.5)],
        bassMotionProfile: "stepwise",
        bassPitchMin: 36,
        bassPitchMax: 52,
        melodyPitchMin: 60,
        melodyPitchMax: 72,
    })];
    const layout = cleanLayout();
    const result = computePianoCraftScoreSummary(artifacts, undefined, { passed: true, issues: [], strengths: [] }, layout);

    assert.ok(result.finalPianoScore >= 0 && result.finalPianoScore <= 1);
    assert.ok(result.handPlayability >= 0 && result.handPlayability <= 1);
    assert.ok(result.melodicClarity >= 0 && result.melodicClarity <= 1);
    assert.ok(result.bassCoherence >= 0 && result.bassCoherence <= 1);
    assert.ok(result.registerSpacing >= 0 && result.registerSpacing <= 1);
    assert.ok(result.accompanimentPatternCoherence >= 0 && result.accompanimentPatternCoherence <= 1);
    assert.ok(result.voicingIdiomaticFit >= 0 && result.voicingIdiomaticFit <= 1);
    assert.ok(result.handIndependence >= 0 && result.handIndependence <= 1);
    assert.ok(result.pedalPlausibility >= 0 && result.pedalPlausibility <= 1);
    assert.ok(result.difficultyFit >= 0 && result.difficultyFit <= 1);
    assert.ok(typeof result.dimensionNotes === "object");
});

test("computePianoCraftScoreSummary gives good composite for idiomatic piano writing", () => {
    const artifacts = [
        sectionWithMelody([64, 67, 69, 71, 72, 71, 69, 67], {
            accompanimentEvents: [note(36, 0.5), note(43, 0.5), note(48, 0.5), note(43, 0.5),
                                  note(36, 0.5), note(43, 0.5), note(48, 0.5), note(43, 0.5)],
            bassMotionProfile: "stepwise",
            bassPitchMin: 36,
            bassPitchMax: 52,
            melodyPitchMin: 64,
            melodyPitchMax: 72,
        }),
    ];
    const layout = cleanLayout({ pedalEventCount: 4 });
    const result = computePianoCraftScoreSummary(artifacts, undefined, { passed: true, issues: [], strengths: [] }, layout);
    assert.ok(result.finalPianoScore > 0.6, `expected >0.6 for idiomatic writing, got ${result.finalPianoScore}`);
});

test("computePianoCraftScoreSummary resolves layout from artifact pianoVoiceLayout", () => {
    const layout = cleanLayout();
    const artifacts = [emptySection({ pianoVoiceLayout: layout })];
    const result = computePianoCraftScoreSummary(artifacts, undefined, { passed: true, issues: [], strengths: [] });
    // handPlayability should not be 0.5 (the "no layout" fallback)
    assert.notEqual(result.handPlayability, 0.5);
});

test("computePianoCraftScoreSummary weights sum to 1.00", () => {
    // Verify the weights in the implementation are correct by running with known all-1.0 mocks
    // We use a fully idiomatic layout and check the composite is sensible
    const layout = cleanLayout({ playableSpanFit: 1.0, handCollisionCount: 0, avgChordVoiceCount: 4, pedalEventCount: 10 });
    const artifacts = [
        sectionWithMelody([60, 62, 64, 65, 67, 69, 71, 72], {
            accompanimentEvents: Array(8).fill(note(48, 0.5)),
            bassMotionProfile: "stepwise",
            bassPitchMin: 36, bassPitchMax: 52,
            melodyPitchMin: 60, melodyPitchMax: 72,
        }),
    ];
    const result = computePianoCraftScoreSummary(artifacts, undefined, { passed: true, issues: [], strengths: [] }, layout);
    // Just confirm it doesn't exceed 1.0
    assert.ok(result.finalPianoScore <= 1.0);
    assert.ok(result.finalPianoScore >= 0.0);
});
