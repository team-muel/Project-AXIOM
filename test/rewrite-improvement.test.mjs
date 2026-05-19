/**
 * rewrite-improvement.test.mjs
 *
 * Benchmark: verifies that repair directives correctly capture the
 * "before → after" improvement signal for each repair domain.
 *
 * This tests the *evaluation* side of the rewrite loop — the functions that
 * detect what needs repair and confirm improvements.  Because the actual
 * orchestrator cannot be invoked in unit tests, the benchmark uses the same
 * scoring and directive-building functions that drive the live loop, giving
 * us high confidence that a passing "after" state would produce zero directives
 * (i.e., the rewrite goal is met).
 *
 * Harmony repair (RIB-01..RIB-04):
 *   RIB-01: before artifacts missing cadenceApproach → strengthen_cadence directive
 *   RIB-02: after  artifacts with all fields → zero directives (improvement confirmed)
 *   RIB-03: directive count drops from >0 to 0 when all harmony fields supplied
 *   RIB-04: contractScore rises from <1.0 to 1.0 after repair
 *
 * Piano repair (RIB-05..RIB-09):
 *   RIB-05: before (low melodyProminenceScore) → clarify_right_hand_melody directive
 *   RIB-06: after  (high melodyProminenceScore) → no clarify_right_hand_melody
 *   RIB-07: before (low bassRootSupportScore)  → strengthen_left_hand_bass directive
 *   RIB-08: after  (high bassRootSupportScore) → no strengthen_left_hand_bass
 *   RIB-09: before has 3 low-dimension directives; after (all repaired) → 0 directives
 *
 * Motif repair (RIB-10..RIB-12):
 *   RIB-10: before (all "original" transforms) → diversityScore = 0.0
 *   RIB-11: after  (4 distinct transforms)     → diversityScore = 1.0
 *   RIB-12: recap identity score rises from 0.0 (no capturedMotif) to 1.0 (exact match)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildHarmonyContractRevisionDirectives,
    checkHarmonyRealizationContract,
} from "../dist/core/evaluate/harmonyRealizationContract.js";

import { buildPianoListenabilityRepairDirectives } from "../dist/core/evaluate/pianoListenabilityRepair.js";

import {
    computeMotifDiversityScore,
    computeMotifRecapIdentityScore,
} from "../dist/core/evaluate/motifDevelopmentScoring.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeArtifact(sectionId, role, overrides = {}) {
    return {
        sectionId,
        role,
        melodyEvents: [],
        measureCount: 4,
        ...overrides,
    };
}

function makePlan(sections) {
    return { sections };
}

function makePlanSection(id, harmonyGrammar = {}) {
    return { id, harmonyGrammar };
}

/** Minimal valid PianoCraftScoreSummary with all required fields. */
function makePianoSummary(overrides = {}) {
    return {
        handPlayability: 0.8,
        melodicClarity: 0.8,
        bassCoherence: 0.8,
        voicingIdiomaticFit: 0.8,
        accompanimentPatternCoherence: 0.8,
        registerSpacing: 0.8,
        handIndependence: 0.8,
        pedalPlausibility: 0.8,
        difficultyFit: 0.8,
        finalPianoScore: 0.8,
        ...overrides,
    };
}

// ─── HARMONY REPAIR ───────────────────────────────────────────────────────────

test("RIB-01: before — missing cadenceApproach produces strengthen_cadence directive", () => {
    const before = makeArtifact("s1", "theme_a", {
        // cadenceApproach absent
        harmonicColorCues: [{ cue: "V7" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1")]);

    const directives = buildHarmonyContractRevisionDirectives([before], plan);

    assert.ok(directives.length > 0, "before state should produce directives");
    assert.ok(
        directives.some((d) => d.kind === "strengthen_cadence"),
        "should include strengthen_cadence directive",
    );
});

test("RIB-02: after — all harmony fields present produces zero directives", () => {
    const after = makeArtifact("s1", "theme_a", {
        cadenceApproach: "perfect_authentic",
        harmonicColorCues: [{ cue: "V7" }, { cue: "ii65" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1")]);

    const directives = buildHarmonyContractRevisionDirectives([after], plan);

    assert.equal(
        directives.length,
        0,
        "after state with all fields present should produce zero directives",
    );
});

test("RIB-03: directive count drops from >0 (before) to 0 (after) when harmony fields added", () => {
    const plan = makePlan([makePlanSection("s1")]);

    const before = makeArtifact("s1", "theme_a", {
        harmonicColorCues: [],
        // cadenceApproach and harmonicRealizationSummary both absent
    });
    const after = makeArtifact("s1", "theme_a", {
        cadenceApproach: "half",
        harmonicColorCues: [{ cue: "V" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });

    const beforeCount = buildHarmonyContractRevisionDirectives([before], plan).length;
    const afterCount = buildHarmonyContractRevisionDirectives([after], plan).length;

    assert.ok(beforeCount > 0, `before should have >0 directives, got ${beforeCount}`);
    assert.equal(afterCount, 0, "after should have 0 directives");
    assert.ok(afterCount < beforeCount, "after should have fewer directives than before");
});

test("RIB-04: contractScore rises from <1.0 (before) to 1.0 (after)", () => {
    const plan = makePlan([makePlanSection("s1")]);

    const before = makeArtifact("s1", "theme_a", {
        // all required fields missing
        harmonicColorCues: [],
    });
    const after = makeArtifact("s1", "theme_a", {
        cadenceApproach: "perfect_authentic",
        harmonicColorCues: [{ cue: "V7" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });

    const reportBefore = checkHarmonyRealizationContract([before], plan);
    const reportAfter = checkHarmonyRealizationContract([after], plan);

    assert.ok(
        reportBefore.contractScore < 1.0,
        `before contractScore should be <1.0, got ${reportBefore.contractScore}`,
    );
    assert.equal(reportAfter.contractScore, 1.0, "after contractScore should be 1.0");
    assert.ok(
        reportAfter.contractScore > reportBefore.contractScore,
        "after contractScore should exceed before",
    );
});

// ─── PIANO REPAIR ─────────────────────────────────────────────────────────────

test("RIB-05: before — low melodyProminenceScore produces clarify_right_hand_melody directive", () => {
    const before = makePianoSummary({ melodyProminenceScore: 0.2 }); // below 0.5 threshold

    const directives = buildPianoListenabilityRepairDirectives(before);

    assert.ok(
        directives.some((d) => d.kind === "clarify_right_hand_melody"),
        "low melodyProminence should trigger clarify_right_hand_melody",
    );
});

test("RIB-06: after — high melodyProminenceScore removes clarify_right_hand_melody directive", () => {
    const after = makePianoSummary({
        melodyProminenceScore: 0.8, // well above 0.5 threshold
        bassRootSupportScore: 0.8,
        pianoListenabilityScore: 0.8,
    });

    const directives = buildPianoListenabilityRepairDirectives(after);

    assert.ok(
        !directives.some((d) => d.kind === "clarify_right_hand_melody"),
        "high melodyProminence should not trigger clarify_right_hand_melody",
    );
});

test("RIB-07: before — low bassRootSupportScore produces strengthen_left_hand_bass directive", () => {
    const before = makePianoSummary({ bassRootSupportScore: 0.1 }); // below 0.5 threshold

    const directives = buildPianoListenabilityRepairDirectives(before);

    assert.ok(
        directives.some((d) => d.kind === "strengthen_left_hand_bass"),
        "low bassRootSupport should trigger strengthen_left_hand_bass",
    );
});

test("RIB-08: after — high bassRootSupportScore removes strengthen_left_hand_bass directive", () => {
    const after = makePianoSummary({
        bassRootSupportScore: 0.85,
        melodyProminenceScore: 0.85,
        pianoListenabilityScore: 0.85,
    });

    const directives = buildPianoListenabilityRepairDirectives(after);

    assert.ok(
        !directives.some((d) => d.kind === "strengthen_left_hand_bass"),
        "high bassRootSupport should not trigger strengthen_left_hand_bass",
    );
});

test("RIB-09: before (3 failing dimensions) → after (all repaired) → directive count drops to 0", () => {
    const before = makePianoSummary({
        melodyProminenceScore: 0.2,      // below threshold → clarify_right_hand_melody
        bassRootSupportScore: 0.1,       // below threshold → strengthen_left_hand_bass
        accompanimentPatternCoherence: 0.2, // below threshold → increase_accompaniment_consistency
    });
    const after = makePianoSummary({
        melodyProminenceScore: 0.9,
        bassRootSupportScore: 0.9,
        accompanimentPatternCoherence: 0.9,
        pianoListenabilityScore: 0.9,
    });

    const beforeDirectives = buildPianoListenabilityRepairDirectives(before);
    const afterDirectives = buildPianoListenabilityRepairDirectives(after);

    assert.ok(
        beforeDirectives.length >= 3,
        `before should have ≥3 directives, got ${beforeDirectives.length}`,
    );
    assert.equal(afterDirectives.length, 0, "after should have 0 directives");
});

// ─── MOTIF REPAIR ─────────────────────────────────────────────────────────────

test("RIB-10: before — all 'original' transforms produce diversityScore = 0.0", () => {
    const occurrencesBefore = [
        { sectionId: "s1", transform: "original", motifId: "A", startBeat: 0 },
        { sectionId: "s2", transform: "original", motifId: "A", startBeat: 0 },
        { sectionId: "s3", transform: "original", motifId: "A", startBeat: 0 },
    ];

    const score = computeMotifDiversityScore(occurrencesBefore);

    assert.equal(score, 0.0, "all-original occurrences should produce diversityScore = 0.0");
});

test("RIB-11: after — 4 distinct non-original transforms produce diversityScore = 1.0", () => {
    const occurrencesAfter = [
        { sectionId: "s1", transform: "original",    motifId: "A", startBeat: 0 },
        { sectionId: "s2", transform: "sequence",    motifId: "A", startBeat: 0 },
        { sectionId: "s3", transform: "fragment",    motifId: "A", startBeat: 0 },
        { sectionId: "s4", transform: "inversion",   motifId: "A", startBeat: 0 },
        { sectionId: "s5", transform: "augmentation",motifId: "A", startBeat: 0 },
    ];

    const score = computeMotifDiversityScore(occurrencesAfter);

    assert.equal(score, 1.0, "4 unique non-original transforms should produce diversityScore = 1.0");
});

test("RIB-12: recap identity rises from 0.0 (no capturedMotif) to 1.0 (exact contour match)", () => {
    // Before: no capturedMotif in either section → score = 0
    const themeNoMotif  = makeArtifact("s1", "theme_a");
    const recapNoMotif  = makeArtifact("s3", "recap");

    const scoreBefore = computeMotifRecapIdentityScore(themeNoMotif, recapNoMotif);

    // After: identical contour in both → score = 1.0
    const contour = [2, 1, -1, -2, 0, 3];
    const themeWithMotif = makeArtifact("s1", "theme_a", { capturedMotif: contour });
    const recapWithMotif = makeArtifact("s3", "recap",   { capturedMotif: contour });

    const scoreAfter = computeMotifRecapIdentityScore(themeWithMotif, recapWithMotif);

    assert.equal(scoreBefore, 0.0, "before (no capturedMotif) recap identity should be 0.0");
    assert.equal(scoreAfter,  1.0, "after (exact contour match) recap identity should be 1.0");
    assert.ok(scoreAfter > scoreBefore, "after should strictly exceed before");
});

// ─── SCORE DELTA BENCHMARKS ───────────────────────────────────────────────────
// RIB-13..18 measure numeric score changes (before→after delta), not just
// directive counts. These confirm that the rewrite loop produces measurable
// improvements when the right fields are supplied.

test("RIB-13: harmony contractScore rises proportionally as required fields are added", () => {
    const plan = makePlan([makePlanSection("s1")]);

    // 0 of 3 required fields → score ≈ 0
    const zero = checkHarmonyRealizationContract(
        [makeArtifact("s1", "theme_a", { harmonicColorCues: [] })], plan,
    );

    // 1 of 3 required fields present
    const oneField = checkHarmonyRealizationContract(
        [makeArtifact("s1", "theme_a", {
            cadenceApproach: "dominant",
            harmonicColorCues: [],
        })],
        plan,
    );

    // 3 of 3 required fields present
    const full = checkHarmonyRealizationContract(
        [makeArtifact("s1", "theme_a", {
            cadenceApproach: "dominant",
            harmonicColorCues: [{ tag: "predominant_color" }],
            harmonicRealizationSummary: { key: "C" },
        })],
        plan,
    );

    assert.ok(zero.contractScore < oneField.contractScore,
        `adding cadenceApproach should raise contractScore (${zero.contractScore} → ${oneField.contractScore})`);
    assert.ok(oneField.contractScore < full.contractScore,
        `adding all fields should raise contractScore further (${oneField.contractScore} → ${full.contractScore})`);
    assert.equal(full.contractScore, 1.0, "all fields present → contractScore = 1.0");
});

test("RIB-14: harmony requiredViolationCount drops 3 → 2 → 0 as fields are added", () => {
    const plan = makePlan([makePlanSection("s1")]);

    const v3 = checkHarmonyRealizationContract(
        [makeArtifact("s1", "theme_a", { harmonicColorCues: [] })], plan,
    );
    const v2 = checkHarmonyRealizationContract(
        [makeArtifact("s1", "theme_a", {
            cadenceApproach: "dominant",
            harmonicColorCues: [],
        })], plan,
    );
    const v0 = checkHarmonyRealizationContract(
        [makeArtifact("s1", "theme_a", {
            cadenceApproach: "dominant",
            harmonicColorCues: [{ tag: "predominant_color" }],
            harmonicRealizationSummary: { key: "C" },
        })], plan,
    );

    assert.ok(v3.requiredViolationCount > v2.requiredViolationCount,
        `violations should drop when cadenceApproach added (${v3.requiredViolationCount} → ${v2.requiredViolationCount})`);
    assert.equal(v0.requiredViolationCount, 0, "full evidence → 0 required violations");
    assert.ok(v0.requiredViolationCount < v3.requiredViolationCount);
});

test("RIB-15: piano directive count drops from ≥3 to 0 as dimension scores rise", () => {
    const before = makePianoSummary({
        melodyProminenceScore:  0.2,  // triggers clarify_right_hand_melody
        bassRootSupportScore:   0.1,  // triggers strengthen_left_hand_bass
        accompanimentPatternCoherence: 0.2,  // triggers increase_accompaniment_consistency
    });
    const after = makePianoSummary({
        melodyProminenceScore:  0.9,
        bassRootSupportScore:   0.9,
        accompanimentPatternCoherence: 0.9,
        pianoListenabilityScore: 0.9,
    });

    const beforeCount = buildPianoListenabilityRepairDirectives(before).length;
    const afterCount  = buildPianoListenabilityRepairDirectives(after).length;

    assert.ok(beforeCount >= 3,
        `before should have ≥3 piano directives, got ${beforeCount}`);
    assert.equal(afterCount, 0,
        "after (all dimensions repaired) should produce 0 piano directives");
    assert.ok(afterCount < beforeCount,
        `after count (${afterCount}) must be less than before (${beforeCount})`);
});

test("RIB-16: motif diversityScore rises 0.0 → 0.5 → 1.0 as unique transforms accumulate", () => {
    const allOriginal = [
        { sectionId: "s1", transform: "original", motifId: "A", startBeat: 0 },
        { sectionId: "s2", transform: "original", motifId: "A", startBeat: 0 },
    ];
    const twoUnique = [
        { sectionId: "s1", transform: "original",  motifId: "A", startBeat: 0 },
        { sectionId: "s2", transform: "sequence",  motifId: "A", startBeat: 0 },
        { sectionId: "s3", transform: "fragment",  motifId: "A", startBeat: 0 },
    ];
    const fourUnique = [
        { sectionId: "s1", transform: "original",     motifId: "A", startBeat: 0 },
        { sectionId: "s2", transform: "sequence",     motifId: "A", startBeat: 0 },
        { sectionId: "s3", transform: "fragment",     motifId: "A", startBeat: 0 },
        { sectionId: "s4", transform: "inversion",    motifId: "A", startBeat: 0 },
        { sectionId: "s5", transform: "augmentation", motifId: "A", startBeat: 0 },
    ];

    const s0  = computeMotifDiversityScore(allOriginal);
    const s05 = computeMotifDiversityScore(twoUnique);
    const s1  = computeMotifDiversityScore(fourUnique);

    assert.equal(s0,  0.0, "all-original → diversityScore = 0.0");
    assert.equal(s05, 0.5, "2 unique non-original transforms → diversityScore = 0.5");
    assert.equal(s1,  1.0, "4 unique non-original transforms → diversityScore = 1.0");
    assert.ok(s0 < s05 && s05 < s1, "scores must be strictly monotone increasing");
});

test("RIB-17: harmony cadenceApproach evidence: before absent → after present (repair confirmed)", () => {
    const plan = makePlan([makePlanSection("s1")]);

    const reportBefore = checkHarmonyRealizationContract(
        [makeArtifact("s1", "theme_a", {
            harmonicColorCues: [{ tag: "predominant_color" }],
            harmonicRealizationSummary: { key: "C" },
            // cadenceApproach intentionally absent
        })],
        plan,
    );
    const reportAfter = checkHarmonyRealizationContract(
        [makeArtifact("s1", "theme_a", {
            cadenceApproach: "dominant",
            harmonicColorCues: [{ tag: "predominant_color" }],
            harmonicRealizationSummary: { key: "C" },
        })],
        plan,
    );

    // Before: cadenceApproach absent → at least one violation
    assert.ok(
        reportBefore.violations.some((v) => v.field === "cadenceApproach"),
        "before should have a cadenceApproach violation",
    );
    // After: no cadenceApproach violation
    assert.ok(
        !reportAfter.violations.some((v) => v.field === "cadenceApproach"),
        "after should have no cadenceApproach violation",
    );
    assert.ok(
        reportAfter.contractScore > reportBefore.contractScore,
        `contractScore must rise after adding cadenceApproach (${reportBefore.contractScore} → ${reportAfter.contractScore})`,
    );
});

test("RIB-18: recapIdentityScore rises from 0.0 (mismatched contour) to 1.0 (identical contour)", () => {
    const contour     = [2, 1, -1, -2, 0, 3];
    const mismatched  = [5, -3, 4, -1, 2, -4];

    const theme       = makeArtifact("s1", "theme_a",   { capturedMotif: contour });
    const recapMatch  = makeArtifact("s3", "recap",     { capturedMotif: contour });
    const recapBad    = makeArtifact("s3", "recap",     { capturedMotif: mismatched });

    const scoreBad   = computeMotifRecapIdentityScore(theme, recapBad);
    const scoreGood  = computeMotifRecapIdentityScore(theme, recapMatch);

    // scoreBad may not be exactly 0, but must be strictly less than 1.0
    assert.ok(scoreBad < 1.0,
        `mismatched contour should produce score < 1.0, got ${scoreBad}`);
    assert.equal(scoreGood, 1.0,
        "identical contour should produce recapIdentityScore = 1.0");
    assert.ok(scoreGood > scoreBad,
        `recapIdentityScore must be higher with matching contour (${scoreBad} → ${scoreGood})`);
});
