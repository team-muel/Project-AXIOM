import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePianoVoiceLayout } from "../dist/pipeline/pianoEvaluation.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validLayout(overrides = {}) {
    return {
        rightHandPitchMin: 64,   // E4
        rightHandPitchMax: 88,   // E6
        leftHandPitchMin: 36,    // C2
        leftHandPitchMax: 65,    // F4
        maxRightHandSpan: 12,    // octave — fine
        maxLeftHandSpan: 10,     // minor 7th — fine
        handCrossingCount: 0,
        handCollisionCount: 0,
        avgChordVoiceCount: 4,
        pedalEventCount: 8,
        playableSpanFit: 0.95,
        ...overrides,
    };
}

// ─── passes ───────────────────────────────────────────────────────────────────

test("evaluatePianoVoiceLayout passes a clean layout", () => {
    const result = evaluatePianoVoiceLayout(validLayout());

    assert.equal(result.passed, true);
    assert.equal(result.issues.length, 0);
    assert.ok(result.playableSpanFit >= 0.80);
    assert.ok(result.chordDensityFit === 1.0);
    assert.ok(result.handCollisionFit === 1.0);
});

test("evaluatePianoVoiceLayout reports strengths on clean layout", () => {
    const result = evaluatePianoVoiceLayout(validLayout());

    assert.ok(result.strengths.length > 0);
    assert.ok(result.strengths.some((s) => s.includes("playable span")));
});

// ─── right-hand pitch range ───────────────────────────────────────────────────

test("evaluatePianoVoiceLayout flags right-hand pitch too low", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ rightHandPitchMin: 55 })); // B3

    assert.ok(result.issues.some((i) => i.includes("Right-hand pitch dips")));
    assert.equal(result.passed, false);
});

test("evaluatePianoVoiceLayout flags right-hand pitch too high", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ rightHandPitchMax: 112 }));

    assert.ok(result.issues.some((i) => i.includes("Right-hand pitch reaches")));
    assert.equal(result.passed, false);
});

// ─── left-hand pitch range ────────────────────────────────────────────────────

test("evaluatePianoVoiceLayout flags left-hand pitch too low", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ leftHandPitchMin: 20 }));

    assert.ok(result.issues.some((i) => i.includes("Left-hand pitch dips")));
    assert.equal(result.passed, false);
});

test("evaluatePianoVoiceLayout flags left-hand pitch too high", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ leftHandPitchMax: 76 }));

    assert.ok(result.issues.some((i) => i.includes("Left-hand pitch reaches")));
    assert.equal(result.passed, false);
});

// ─── hand span ────────────────────────────────────────────────────────────────

test("evaluatePianoVoiceLayout flags right-hand span exceeded", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ maxRightHandSpan: 22, playableSpanFit: 0.5 }));

    assert.ok(result.issues.some((i) => i.includes("Right-hand chord span reaches 22")));
    assert.equal(result.passed, false);
});

test("evaluatePianoVoiceLayout flags left-hand span exceeded", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ maxLeftHandSpan: 20, playableSpanFit: 0.5 }));

    assert.ok(result.issues.some((i) => i.includes("Left-hand chord span reaches 20")));
    assert.equal(result.passed, false);
});

test("evaluatePianoVoiceLayout does not flag span at exactly the limit (19)", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ maxRightHandSpan: 19 }));

    assert.ok(!result.issues.some((i) => i.includes("Right-hand chord span")));
});

// ─── playable span fit ────────────────────────────────────────────────────────

test("evaluatePianoVoiceLayout flags low playable span fit", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ playableSpanFit: 0.60 }));

    assert.ok(result.issues.some((i) => i.includes("Only 60% of chord events")));
    assert.equal(result.passed, false);
});

test("evaluatePianoVoiceLayout passes at 80% playable span", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ playableSpanFit: 0.80 }));

    assert.ok(!result.issues.some((i) => i.includes("chord events are within playable")));
});

// ─── hand collisions ──────────────────────────────────────────────────────────

test("evaluatePianoVoiceLayout flags many hand collisions", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ handCollisionCount: 5 }));

    assert.ok(result.issues.some((i) => i.includes("5 hand collision(s)")));
    assert.ok(result.handCollisionFit < 1.0);
    assert.equal(result.passed, false);
});

test("evaluatePianoVoiceLayout flags moderate hand collision with softer message", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ handCollisionCount: 1 }));

    assert.ok(result.issues.some((i) => i.includes("likely manageable")));
});

test("evaluatePianoVoiceLayout reports no crossings when zero", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ handCrossingCount: 0, handCollisionCount: 0 }));

    assert.ok(result.strengths.some((s) => s.includes("No hand crossings")));
});

// ─── chord density ────────────────────────────────────────────────────────────

test("evaluatePianoVoiceLayout flags excessive chord density", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ avgChordVoiceCount: 8 }));

    assert.ok(result.issues.some((i) => i.includes("8.0 voices/hand")));
    assert.ok(result.chordDensityFit < 1.0);
    assert.equal(result.passed, false);
});

test("evaluatePianoVoiceLayout accepts density at the limit (6)", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ avgChordVoiceCount: 6 }));

    assert.equal(result.chordDensityFit, 1.0);
    assert.ok(!result.issues.some((i) => i.includes("voices/hand")));
});

// ─── empty / minimal layout ───────────────────────────────────────────────────

test("evaluatePianoVoiceLayout handles empty layout without throwing", () => {
    const result = evaluatePianoVoiceLayout({});

    assert.equal(typeof result.passed, "boolean");
    assert.ok(Array.isArray(result.issues));
    assert.ok(Array.isArray(result.strengths));
    assert.ok(result.playableSpanFit >= 0 && result.playableSpanFit <= 1);
});

test("evaluatePianoVoiceLayout returns numeric fit values rounded to 4 decimal places", () => {
    const result = evaluatePianoVoiceLayout(validLayout({ handCollisionCount: 3 }));

    assert.equal(result.playableSpanFit, Number(result.playableSpanFit.toFixed(4)));
    assert.equal(result.handCollisionFit, Number(result.handCollisionFit.toFixed(4)));
    assert.equal(result.chordDensityFit, Number(result.chordDensityFit.toFixed(4)));
});
