// test/beethoven-schubert-evaluators.test.mjs
// Tests for BeethovenianMotivicPressureScore, SchubertianLyricExpansionScore,
// and MediantColorScore (src/core/evaluate/axiomAestheticEvaluators.ts)

import assert from "node:assert/strict";
import { test } from "node:test";

// Dynamic import to use compiled JS output
const {
    computeBeethovenianMotivicPressureScore,
    computeSchubertianLyricExpansionScore,
    computeMediantColorScore,
    computeAxiomAestheticScores,
    computeLineageIdentityScore,
} = await import("../dist/core/evaluate/axiomAestheticEvaluators.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid SectionArtifactSummary with only required fields. */
function makeSection(overrides = {}) {
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

function makeNoteEvent(pitch, quarterLength = 1) {
    return { type: "note", pitch, quarterLength };
}

function makeRestEvent(quarterLength = 1) {
    return { type: "rest", quarterLength };
}

function range01(v) {
    return v >= 0 && v <= 1;
}

// ---------------------------------------------------------------------------
// BSE-01 — BeethovenianMotivicPressureScore: empty artifacts → 0–1 result
// ---------------------------------------------------------------------------

test("BSE-01: empty artifacts returns valid composite score in [0,1]", () => {
    const result = computeBeethovenianMotivicPressureScore([], undefined);
    assert.ok(range01(result.score), `score out of range: ${result.score}`);
    assert.ok(typeof result.notes === "string");
    // All sub-scores should also be in [0,1]
    for (const key of [
        "motiveCellRecurrence",
        "rhythmicCellRecurrence",
        "transformationDensity",
        "developmentPressure",
        "recapInevitability",
    ]) {
        assert.ok(range01(result[key]), `${key} out of range: ${result[key]}`);
    }
});

// ---------------------------------------------------------------------------
// BSE-02 — BeethovenianMotivicPressureScore: motif recurrence detected
// ---------------------------------------------------------------------------

test("BSE-02: capturedMotif recurrence across theme_a and recap raises score", () => {
    // theme_a has motif contour [2, -1, 2]
    const themeA = makeSection({
        sectionId: "theme_a",
        role: "theme_a",
        capturedMotif: [2, -1, 2],
        noteHistory: [60, 62, 61, 63],
    });
    // recap has same motif contour (perfect recurrence)
    const recap = makeSection({
        sectionId: "recap",
        role: "recap",
        capturedMotif: [2, -1, 2],
        noteHistory: [60, 62, 61, 63],
    });
    const result = computeBeethovenianMotivicPressureScore([themeA, recap], undefined);
    assert.ok(range01(result.score));
    assert.ok(result.motiveCellRecurrence > 0.5, `motiveCellRecurrence too low: ${result.motiveCellRecurrence}`);
    assert.ok(result.recapInevitability > 0.5, `recapInevitability too low: ${result.recapInevitability}`);
});

// ---------------------------------------------------------------------------
// BSE-03 — BeethovenianMotivicPressureScore: development pressure signal
// ---------------------------------------------------------------------------

test("BSE-03: development section with rich harmony raises developmentPressure", () => {
    const dev = makeSection({
        sectionId: "dev",
        role: "development",
        harmonyDensity: "rich",
        tonicizationWindows: [
            { keyTarget: "G major", start: 0, end: 4 },
            { keyTarget: "E minor", start: 4, end: 8 },
        ],
        melodyEvents: Array.from({ length: 10 }, (_, i) => makeNoteEvent(60 + i)),
    });
    const result = computeBeethovenianMotivicPressureScore([dev], undefined);
    assert.ok(range01(result.score));
    assert.ok(result.developmentPressure > 0.5, `developmentPressure too low: ${result.developmentPressure}`);
});

// ---------------------------------------------------------------------------
// BSE-04 — BeethovenianMotivicPressureScore: transform variety raises score
// ---------------------------------------------------------------------------

test("BSE-04: sections with distinct transform modes raise transformationDensity", () => {
    const sections = [
        makeSection({ sectionId: "t1", role: "theme_a", transform: { sectionId: "t1", role: "theme_a", transformMode: "sequence", sequenceStride: 2 } }),
        makeSection({ sectionId: "t2", role: "development", transform: { sectionId: "t2", role: "development", transformMode: "fragmentation" } }),
        makeSection({ sectionId: "t3", role: "variation", transform: { sectionId: "t3", role: "variation", transformMode: "inversion" } }),
    ];
    const result = computeBeethovenianMotivicPressureScore(sections, undefined);
    assert.ok(range01(result.score));
    assert.ok(result.transformationDensity > 0.5, `transformationDensity too low: ${result.transformationDensity}`);
});

// ---------------------------------------------------------------------------
// BSE-05 — SchubertianLyricExpansionScore: empty artifacts → valid [0,1]
// ---------------------------------------------------------------------------

test("BSE-05: empty artifacts SchubertianLyricExpansion in [0,1]", () => {
    const result = computeSchubertianLyricExpansionScore([], undefined);
    assert.ok(range01(result.score), `score out of range: ${result.score}`);
    for (const key of [
        "phraseLengthExpansion",
        "stepwiseMelodicContinuity",
        "delayedCadence",
        "lyricalContourArch",
        "repetitionWithColorShift",
    ]) {
        assert.ok(range01(result[key]), `${key} out of range: ${result[key]}`);
    }
});

// ---------------------------------------------------------------------------
// BSE-06 — SchubertianLyricExpansionScore: stepwise melody raises score
// ---------------------------------------------------------------------------

test("BSE-06: stepwise melody raises stepwiseMelodicContinuity", () => {
    // Melody mostly moves by 1–2 semitones (stepwise)
    const pitches = [60, 62, 61, 63, 62, 64, 63, 65, 64, 66];
    const section = makeSection({
        sectionId: "theme_a",
        role: "theme_a",
        melodyEvents: pitches.map((p) => makeNoteEvent(p)),
        measureCount: 4,
    });
    const result = computeSchubertianLyricExpansionScore([section], undefined);
    assert.ok(range01(result.score));
    assert.ok(result.stepwiseMelodicContinuity > 0.6, `stepwise too low: ${result.stepwiseMelodicContinuity}`);
});

// ---------------------------------------------------------------------------
// BSE-07 — SchubertianLyricExpansionScore: arch contour detected
// ---------------------------------------------------------------------------

test("BSE-07: arch-shaped melody raises lyricalContourArch", () => {
    // Rise then fall: 60, 62, 64, 67, 66, 64, 62, 60
    const archPitches = [60, 62, 64, 67, 69, 67, 65, 62, 60];
    const section = makeSection({
        sectionId: "theme_a",
        role: "theme_a",
        melodyEvents: archPitches.map((p) => makeNoteEvent(p)),
        measureCount: 4,
    });
    const result = computeSchubertianLyricExpansionScore([section], undefined);
    assert.ok(range01(result.score));
    assert.ok(result.lyricalContourArch > 0.3, `lyricalContourArch too low: ${result.lyricalContourArch}`);
});

// ---------------------------------------------------------------------------
// BSE-08 — SchubertianLyricExpansionScore: phrase expansion via varied measure counts
// ---------------------------------------------------------------------------

test("BSE-08: varied measure counts raise phraseLengthExpansion", () => {
    const sections = [
        makeSection({ sectionId: "s1", role: "theme_a",   measureCount: 4 }),
        makeSection({ sectionId: "s2", role: "theme_b",   measureCount: 8 }),
        makeSection({ sectionId: "s3", role: "variation", measureCount: 12 }),
        makeSection({ sectionId: "s4", role: "recap",     measureCount: 6 }),
    ];
    const result = computeSchubertianLyricExpansionScore(sections, undefined);
    assert.ok(range01(result.score));
    assert.ok(result.phraseLengthExpansion > 0.4, `phraseLengthExpansion too low: ${result.phraseLengthExpansion}`);
});

// ---------------------------------------------------------------------------
// BSE-09 — MediantColorScore: empty artifacts → valid [0,1]
// ---------------------------------------------------------------------------

test("BSE-09: empty artifacts MediantColorScore in [0,1]", () => {
    const result = computeMediantColorScore([], undefined);
    assert.ok(range01(result.score), `score out of range: ${result.score}`);
    for (const key of [
        "chromaticMediantRelation",
        "majorMinorAmbiguity",
        "remoteButSmoothKeyArea",
        "suddenColorShiftWithContinuity",
    ]) {
        assert.ok(range01(result[key]), `${key} out of range: ${result[key]}`);
    }
});

// ---------------------------------------------------------------------------
// BSE-10 — MediantColorScore: mediant key pairs detected
// ---------------------------------------------------------------------------

test("BSE-10: third-related tonicization windows raise chromaticMediantRelation", () => {
    // C major (0) and E major (4) — 4 semitones = chromatic mediant
    // C major (0) and Eb major (3) — 3 semitones = chromatic mediant
    const section = makeSection({
        sectionId: "s1",
        role: "development",
        tonicKey: "C major",
        tonicizationWindows: [
            { keyTarget: "C major", start: 0, end: 2 },
            { keyTarget: "E major", start: 2, end: 4 },
            { keyTarget: "Eb major", start: 4, end: 6 },
        ],
    });
    const plan = { key: "C major", sections: [] };
    const result = computeMediantColorScore([section], plan);
    assert.ok(range01(result.score));
    assert.ok(result.chromaticMediantRelation > 0.4, `chromaticMediantRelation too low: ${result.chromaticMediantRelation}`);
});

// ---------------------------------------------------------------------------
// BSE-11 — MediantColorScore: major/minor alternation detected
// ---------------------------------------------------------------------------

test("BSE-11: major and minor tonic key sections raise majorMinorAmbiguity", () => {
    const sections = [
        makeSection({ sectionId: "s1", role: "theme_a", tonicKey: "A major" }),
        makeSection({ sectionId: "s2", role: "development", tonicKey: "A minor" }),
        makeSection({ sectionId: "s3", role: "theme_b", tonicKey: "C major" }),
        makeSection({ sectionId: "s4", role: "recap", tonicKey: "A major" }),
    ];
    const plan = { key: "A major", sections: [] };
    const result = computeMediantColorScore(sections, plan);
    assert.ok(range01(result.score));
    assert.ok(result.majorMinorAmbiguity > 0.3, `majorMinorAmbiguity too low: ${result.majorMinorAmbiguity}`);
});

// ---------------------------------------------------------------------------
// BSE-12 — MediantColorScore: chromatic color cue raises suddenColorShift
// ---------------------------------------------------------------------------

test("BSE-12: chromatic harmonicColorCue with continuation phraseFunction raises suddenColorShift", () => {
    const section = makeSection({
        sectionId: "s1",
        role: "development",
        phraseFunction: "continuation",
        harmonicColorCues: [
            { tag: "mixture", startMeasure: 2, endMeasure: 4 },
        ],
        phraseBreathSummary: { requestedCues: [], targetedMeasureCount: 8, realizedMeasureCount: 8, realizedNoteCount: 12 },
    });
    const result = computeMediantColorScore([section], undefined);
    assert.ok(range01(result.score));
    assert.ok(result.suddenColorShiftWithContinuity > 0.3, `suddenColorShift too low: ${result.suddenColorShiftWithContinuity}`);
});

// ---------------------------------------------------------------------------
// BSE-13 — computeAxiomAestheticScores: composite entry point returns all three
// ---------------------------------------------------------------------------

test("BSE-13: computeAxiomAestheticScores returns all three detail objects", () => {
    const themeA = makeSection({
        sectionId: "theme_a",
        role: "theme_a",
        capturedMotif: [1, -1, 2],
        measureCount: 8,
        melodyEvents: [60, 62, 61, 63, 62, 64].map((p) => makeNoteEvent(p)),
    });
    const dev = makeSection({
        sectionId: "dev",
        role: "development",
        harmonyDensity: "rich",
        measureCount: 12,
        tonicizationWindows: [{ keyTarget: "G major", start: 0, end: 4 }],
    });
    const result = computeAxiomAestheticScores([themeA, dev], undefined);
    assert.ok("beethovenianMotivicPressure" in result);
    assert.ok("schubertianLyricExpansion" in result);
    assert.ok("mediantColor" in result);
    assert.ok(range01(result.beethovenianMotivicPressure.score));
    assert.ok(range01(result.schubertianLyricExpansion.score));
    assert.ok(range01(result.mediantColor.score));
});

// ---------------------------------------------------------------------------
// BSE-14 — craftScoring integration: CraftScoreSummary contains all three scores
// ---------------------------------------------------------------------------

test("BSE-14: computeCraftScoreSummary populates aesthetic score fields", async () => {
    const { computeCraftScoreSummary } = await import("../dist/core/evaluate/craftScoring.js");

    const themeA = makeSection({
        sectionId: "theme_a",
        role: "theme_a",
        capturedMotif: [1, -1, 2],
        measureCount: 8,
        melodyEvents: [60, 62, 61, 63, 62, 64].map((p) => makeNoteEvent(p)),
    });
    const evaluation = { passed: true, issues: [], strengths: [] };
    const result = computeCraftScoreSummary([themeA], undefined, evaluation);
    assert.ok("beethovenianMotivicPressureScore" in result, "beethovenianMotivicPressureScore missing");
    assert.ok("schubertianLyricExpansionScore"   in result, "schubertianLyricExpansionScore missing");
    assert.ok("mediantColorScore"                in result, "mediantColorScore missing");
    assert.ok(range01(result.beethovenianMotivicPressureScore));
    assert.ok(range01(result.schubertianLyricExpansionScore));
    assert.ok(range01(result.mediantColorScore));
    assert.ok("lineageIdentityScore" in result, "lineageIdentityScore missing from craftScoreSummary");
    assert.ok(range01(result.lineageIdentityScore), `lineageIdentityScore out of range: ${result.lineageIdentityScore}`);
});

// ---------------------------------------------------------------------------
// BSE-15 — LineageIdentityScore: composite formula + bothAxesPresent
// ---------------------------------------------------------------------------

test("BSE-15: computeLineageIdentityScore returns composite weighted sum and bothAxesPresent", () => {
    // Build sections with known signals for all three sub-evaluators
    const themeA = makeSection({
        sectionId: "theme_a",
        role: "theme_a",
        capturedMotif: [2, -1, 2],
        measureCount: 8,
        melodyEvents: [60, 62, 61, 63, 62, 64, 61, 63].map((p) => makeNoteEvent(p)),
        noteHistory: [60, 62, 61, 63],
    });
    const dev = makeSection({
        sectionId: "dev",
        role: "development",
        harmonyDensity: "rich",
        measureCount: 12,
        tonicizationWindows: [
            { keyTarget: "E major", start: 0, end: 4 }, // mediant from C
            { keyTarget: "Eb major", start: 4, end: 8 },
        ],
        tonicKey: "E major",
        phraseFunction: "continuation",
        harmonicColorCues: [{ tag: "mixture", startMeasure: 2, endMeasure: 4 }],
        melodyEvents: Array.from({ length: 10 }, (_, i) => makeNoteEvent(60 + i)),
    });
    const recap = makeSection({
        sectionId: "recap",
        role: "recap",
        capturedMotif: [2, -1, 2],
        measureCount: 8,
        melodyEvents: [60, 62, 61, 63].map((p) => makeNoteEvent(p)),
        noteHistory: [60, 62, 61, 63],
    });

    const plan = { key: "C major", sections: [] };
    const result = computeLineageIdentityScore([themeA, dev, recap], plan);

    // Score must be in [0, 1]
    assert.ok(range01(result.score), `lineageIdentityScore out of range: ${result.score}`);

    // Sub-scores must match their sources
    assert.ok(range01(result.beethovenianMotivicPressure));
    assert.ok(range01(result.schubertianLyricExpansion));
    assert.ok(range01(result.mediantColor));

    // Formula check: score ≈ 0.55×beethoven + 0.25×lyric + 0.20×harmonic
    const expected = 0.55 * result.beethovenianMotivicPressure
        + 0.25 * result.schubertianLyricExpansion
        + 0.20 * result.mediantColor;
    assert.ok(
        Math.abs(result.score - expected) < 0.001,
        `score ${result.score} does not match formula ${expected.toFixed(4)}`
    );

    // bothAxesPresent field must be boolean
    assert.ok(typeof result.bothAxesPresent === "boolean", "bothAxesPresent must be boolean");

    // notes must be non-empty
    assert.ok(typeof result.notes === "string" && result.notes.length > 0, "notes must be non-empty");
});

// ---------------------------------------------------------------------------
// BSE-16 — LineageIdentityScore: low Beethoven → bothAxesPresent = false
// ---------------------------------------------------------------------------

test("BSE-16: low-motif sections yield bothAxesPresent=false even if Schubert signals are good", () => {
    // Only Schubert signals, no Beethoven structure
    const lyricSection = makeSection({
        sectionId: "lyric",
        role: "theme_a",
        measureCount: 12,
        melodyEvents: [60, 62, 61, 63, 62, 64, 63, 65, 64, 66].map((p) => makeNoteEvent(p)),
        noteHistory: [60, 62, 61, 63, 62, 64],
        tonicKey: "A major",
        phraseFunction: "continuation",
        harmonicColorCues: [{ tag: "mixture", startMeasure: 4, endMeasure: 8 }],
    });
    const colorSection = makeSection({
        sectionId: "color",
        role: "development",
        measureCount: 8,
        tonicKey: "A minor", // major/minor ambiguity
        tonicizationWindows: [
            { keyTarget: "C# major", start: 0, end: 4 },
            { keyTarget: "F major", start: 4, end: 8 },
        ],
    });
    // No recap, no capturedMotif, no transform modes → Beethoven score collapses
    const result = computeLineageIdentityScore([lyricSection, colorSection], undefined);

    assert.ok(range01(result.score));
    // Beethoven score should be weak without motif/development signals
    assert.ok(result.beethovenianMotivicPressure < 0.45, `Expected low Beethoven score, got ${result.beethovenianMotivicPressure}`);
    // Both-axes should be false (Beethoven below floor)
    assert.equal(result.bothAxesPresent, false, "bothAxesPresent must be false when Beethoven signals are weak");
});

// ---------------------------------------------------------------------------
// BSE-17 — computeAxiomAestheticScores: includes lineageIdentity
// ---------------------------------------------------------------------------

test("BSE-17: computeAxiomAestheticScores returns lineageIdentity with valid score", () => {
    const result = computeAxiomAestheticScores([], undefined);
    assert.ok("lineageIdentity" in result, "lineageIdentity missing from AxiomAestheticScores");
    assert.ok(range01(result.lineageIdentity.score), `lineageIdentity.score out of range: ${result.lineageIdentity.score}`);
    assert.ok(typeof result.lineageIdentity.bothAxesPresent === "boolean");

    // Verify formula: score ≈ 0.55×beethoven + 0.25×lyric + 0.20×harmonic
    const expected = 0.55 * result.beethovenianMotivicPressure.score
        + 0.25 * result.schubertianLyricExpansion.score
        + 0.20 * result.mediantColor.score;
    assert.ok(
        Math.abs(result.lineageIdentity.score - expected) < 0.001,
        `lineageIdentity.score ${result.lineageIdentity.score} does not match formula ${expected.toFixed(4)}`
    );
});

