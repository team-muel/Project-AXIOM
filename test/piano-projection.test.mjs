import test from "node:test";
import assert from "node:assert/strict";
import {
    computePianoProjectionEvidence,
    applyPianoProjection,
} from "../dist/pipeline/pianoProjection.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noteEvt(pitch, ql = 1) {
    return { type: "note", pitch, quarterLength: ql };
}

function chordEvt(pitches, ql = 1) {
    return { type: "chord", pitches, quarterLength: ql };
}

function restEvt(ql = 1) {
    return { type: "rest", quarterLength: ql };
}

/** Minimal SectionArtifactSummary for testing. */
function mkSummary({ rh = [], lh = [], measures = 4, layout = undefined } = {}) {
    return {
        sectionId: "test",
        role: "theme_a",
        measureCount: measures,
        melodyEvents: rh,
        accompanimentEvents: lh,
        noteHistory: [],
    };
}

function withLayout(summary, layout) {
    return { ...summary, pianoVoiceLayout: layout };
}

// ─── Right-hand pitch range ───────────────────────────────────────────────────

test("RH pitch min/max from melody events", () => {
    const s = mkSummary({ rh: [noteEvt(64), noteEvt(72), noteEvt(60)] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoRightHandPitchMin, 60);
    assert.equal(ev.pianoRightHandPitchMax, 72);
});

test("RH pitch range includes chord pitches", () => {
    const s = mkSummary({ rh: [chordEvt([60, 64, 67])] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoRightHandPitchMin, 60);
    assert.equal(ev.pianoRightHandPitchMax, 67);
});

test("RH pitch undefined when only rests", () => {
    const s = mkSummary({ rh: [restEvt(), restEvt()] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoRightHandPitchMin, undefined);
    assert.equal(ev.pianoRightHandPitchMax, undefined);
});

// ─── Left-hand pitch range ───────────────────────────────────────────────────

test("LH pitch min/max from accompaniment events", () => {
    const s = mkSummary({ lh: [noteEvt(36), noteEvt(48), noteEvt(52)] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoLeftHandPitchMin, 36);
    assert.equal(ev.pianoLeftHandPitchMax, 52);
});

// ─── Hand density ─────────────────────────────────────────────────────────────

test("RH density = note events / measures", () => {
    // 8 note events, 4 measures → 2.0
    const rh = Array.from({ length: 8 }, () => noteEvt(64));
    const s = mkSummary({ rh, measures: 4 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoRightHandDensity, 2.0);
});

test("density does not count rest events", () => {
    const s = mkSummary({ rh: [noteEvt(64), restEvt(), noteEvt(65)], measures: 2 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoRightHandDensity, 1.0); // 2 notes / 2 measures
});

test("density is 0 when measureCount is 0", () => {
    const s = mkSummary({ rh: [noteEvt(64)], measures: 0 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoRightHandDensity, 0);
});

// ─── Leap analysis ────────────────────────────────────────────────────────────

test("RH leap max and average are correct", () => {
    // C4→G4 = 7, G4→C5 = 5, C5→E5 = 4
    const s = mkSummary({ rh: [noteEvt(60), noteEvt(67), noteEvt(72), noteEvt(76)] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoLeapMaxRight, 7);
    const expectedAvg = (7 + 5 + 4) / 3;
    assert.ok(Math.abs(ev.pianoLeapAverageRight - expectedAvg) < 0.01);
});

test("LH leap analysis works independently", () => {
    const s = mkSummary({ lh: [noteEvt(36), noteEvt(48)] }); // 12 semitones
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoLeapMaxLeft, 12);
    assert.equal(ev.pianoLeapAverageLeft, 12);
});

test("leap stats undefined when only one pitch", () => {
    const s = mkSummary({ rh: [noteEvt(60)] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoLeapMaxRight, undefined);
    assert.equal(ev.pianoLeapAverageRight, undefined);
});

// ─── Chord analysis ──────────────────────────────────────────────────────────

test("chord density is ratio of chord events to all non-rest events", () => {
    const rh = [chordEvt([60, 64, 67]), noteEvt(72), noteEvt(71)];
    const s = mkSummary({ rh });
    const ev = computePianoProjectionEvidence(s);
    // 1 chord out of 3 non-rest events = 0.33
    assert.ok(Math.abs(ev.pianoChordDensity - 1 / 3) < 0.01);
});

test("maxSimultaneousNotes reflects largest chord", () => {
    const rh = [chordEvt([60, 64, 67, 71])]; // 4-voice chord
    const s = mkSummary({ rh });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoMaxSimultaneousNotes, 4);
});

test("maxSimultaneousNotes is undefined when no chords", () => {
    const s = mkSummary({ rh: [noteEvt(60), noteEvt(64)] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoMaxSimultaneousNotes, undefined);
});

test("awkwardChordCount flags chords spanning > 14 semitones", () => {
    const wide = chordEvt([36, 60]); // 24 semitones — two octaves, definitely awkward
    const normal = chordEvt([60, 64, 67]);
    const s = mkSummary({ rh: [wide, normal] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoAwkwardChordCount, 1);
});

test("awkwardChordCount is 0 when all chords are comfortable", () => {
    const s = mkSummary({ rh: [chordEvt([60, 64, 67]), chordEvt([62, 65, 69])] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoAwkwardChordCount, 0);
});

// ─── Repeated octave rate ─────────────────────────────────────────────────────

test("repeatedOctaveRate detects exact octave jumps", () => {
    // RH: C4→C5 (12), C5→D5 (2) — 1 octave out of 2 intervals = 0.5
    // LH: empty
    const s = mkSummary({ rh: [noteEvt(60), noteEvt(72), noteEvt(74)] });
    const ev = computePianoProjectionEvidence(s);
    // Average of RH(0.5) + LH(0) = 0.25
    assert.equal(ev.pianoRepeatedOctaveRate, 0.25);
});

test("repeatedOctaveRate is 0 with no octave jumps", () => {
    const s = mkSummary({ rh: [noteEvt(60), noteEvt(62), noteEvt(64)] });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoRepeatedOctaveRate, 0);
});

// ─── Fields forwarded from pianoVoiceLayout ───────────────────────────────────

test("handCrossingCount forwarded from pianoVoiceLayout", () => {
    const s = withLayout(mkSummary(), { handCrossingCount: 3 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoHandCrossingCount, 3);
});

test("registerCollisionCount forwarded from pianoVoiceLayout.handCollisionCount", () => {
    const s = withLayout(mkSummary(), { handCollisionCount: 2 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoRegisterCollisionCount, 2);
});

test("pedalChangeCount forwarded from pianoVoiceLayout.pedalEventCount", () => {
    const s = withLayout(mkSummary(), { pedalEventCount: 8 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoPedalChangeCount, 8);
});

test("handSpanMax is max of LH and RH spans", () => {
    const s = withLayout(mkSummary(), { maxRightHandSpan: 12, maxLeftHandSpan: 15 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoHandSpanMax, 15);
});

test("handSpanAverage is mean of LH and RH spans", () => {
    const s = withLayout(mkSummary(), { maxRightHandSpan: 10, maxLeftHandSpan: 14 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoHandSpanAverage, 12.0);
});

// ─── Playability score ────────────────────────────────────────────────────────

test("playabilityScore uses layout.playableSpanFit when present", () => {
    const s = withLayout(mkSummary(), { playableSpanFit: 0.85 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoPlayabilityScore, 0.85);
});

test("playabilityScore estimated from span when layout absent — comfortable span = 1.0", () => {
    const s = withLayout(mkSummary(), { maxRightHandSpan: 10, maxLeftHandSpan: 10 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoPlayabilityScore, 1.0);
});

test("playabilityScore decreases above octave span", () => {
    const comfortable = withLayout(mkSummary(), { maxRightHandSpan: 12, maxLeftHandSpan: 12 });
    const stretched = withLayout(mkSummary(), { maxRightHandSpan: 15, maxLeftHandSpan: 15 });
    const evC = computePianoProjectionEvidence(comfortable);
    const evS = computePianoProjectionEvidence(stretched);
    assert.ok(evC.pianoPlayabilityScore >= evS.pianoPlayabilityScore);
});

// ─── Idiomatic texture score ─────────────────────────────────────────────────

test("idiomaticTextureScore is 1.0 for a clean easy section", () => {
    const rh = [noteEvt(64), noteEvt(67), noteEvt(69)];
    const lh = [noteEvt(48), noteEvt(43), noteEvt(40)];
    const layout = { maxRightHandSpan: 10, maxLeftHandSpan: 10, handCollisionCount: 0 };
    const s = withLayout(mkSummary({ rh, lh }), layout);
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoIdiomaticTextureScore, 1.0);
});

test("idiomaticTextureScore penalises hand collisions", () => {
    const layout = { maxRightHandSpan: 10, maxLeftHandSpan: 10, handCollisionCount: 4 };
    const s = withLayout(mkSummary(), layout);
    const ev = computePianoProjectionEvidence(s);
    assert.ok(ev.pianoIdiomaticTextureScore < 1.0);
});

test("idiomaticTextureScore penalises unplayable span", () => {
    const layout = { maxRightHandSpan: 22, maxLeftHandSpan: 22, handCollisionCount: 0 };
    const s = withLayout(mkSummary(), layout);
    const ev = computePianoProjectionEvidence(s);
    assert.ok(ev.pianoIdiomaticTextureScore <= 0.7);
});

// ─── Pedal blur risk ─────────────────────────────────────────────────────────

test("pedalBlurRisk is 0 when no pedal events", () => {
    const s = withLayout(mkSummary({ rh: [noteEvt(60), noteEvt(62)] }), { pedalEventCount: 0 });
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoPedalBlurRisk, 0);
});

test("pedalBlurRisk increases with pedal events + wide span", () => {
    const lowRisk = withLayout(mkSummary({ rh: [noteEvt(60), noteEvt(62)] }),
        { pedalEventCount: 1, maxRightHandSpan: 10, maxLeftHandSpan: 10 });
    const highRisk = withLayout(mkSummary({
        rh: [chordEvt([40, 60]), chordEvt([42, 62]), chordEvt([44, 64])] }),
        { pedalEventCount: 10, maxRightHandSpan: 18, maxLeftHandSpan: 18 });
    const evL = computePianoProjectionEvidence(lowRisk);
    const evH = computePianoProjectionEvidence(highRisk);
    assert.ok(evH.pianoPedalBlurRisk > evL.pianoPedalBlurRisk);
});

// ─── applyPianoProjection round-trip ─────────────────────────────────────────

test("applyPianoProjection enriches summary without mutating original", () => {
    const rh = [noteEvt(64), noteEvt(67)];
    const lh = [noteEvt(48), noteEvt(43)];
    const original = mkSummary({ rh, lh });
    const enriched = applyPianoProjection(original);

    // Original is unchanged
    assert.equal(original.pianoRightHandPitchMin, undefined);
    // Enriched has piano fields
    assert.equal(enriched.pianoRightHandPitchMin, 64);
    assert.equal(enriched.pianoLeftHandPitchMax, 48);
    // Core fields are preserved
    assert.equal(enriched.sectionId, "test");
    assert.equal(enriched.measureCount, 4);
});

test("applyPianoProjection is idempotent", () => {
    const rh = [noteEvt(60), noteEvt(64)];
    const s = mkSummary({ rh });
    const once = applyPianoProjection(s);
    const twice = applyPianoProjection(once);
    assert.equal(once.pianoRightHandPitchMin, twice.pianoRightHandPitchMin);
    assert.equal(once.pianoLeapMaxRight, twice.pianoLeapMaxRight);
    assert.equal(once.pianoIdiomaticTextureScore, twice.pianoIdiomaticTextureScore);
});

test("empty events produce zero densities and no crash", () => {
    const s = mkSummary();
    const ev = computePianoProjectionEvidence(s);
    assert.equal(ev.pianoRightHandDensity, 0);
    assert.equal(ev.pianoLeftHandDensity, 0);
    assert.equal(ev.pianoAwkwardChordCount, 0);
    assert.equal(ev.pianoRepeatedOctaveRate, 0);
    assert.equal(ev.pianoPedalBlurRisk, 0);
    assert.equal(ev.pianoIdiomaticTextureScore, 1.0);
});
