/**
 * Motif development tests
 *
 * Validates all exports of motifDevelopment.ts:
 *   applySequence, applyFragmentation, applyInversion, applyRetrograde,
 *   applyAugmentation, applyDiminution, computeRecapIdentityScore,
 *   buildMotifDevelopmentPlan
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    applySequence,
    applyFragmentation,
    applyInversion,
    applyRetrograde,
    applyAugmentation,
    applyDiminution,
    computeRecapIdentityScore,
    buildMotifDevelopmentPlan,
} from "../dist/core/plan/motifDevelopment.js";
import {
    computeExactReturnScore,
    computeSequenceScore,
    computeFragmentationScore,
    computeInversionDetectionScore,
    computeRhythmicProportionScore,
    computeReharmonizedReturnScore,
    computeMotifRecapIdentityScore,
    computeMotifDevelopmentScoreSummary,
} from "../dist/core/evaluate/motifDevelopmentScoring.js";

// ─── 1. applySequence ────────────────────────────────────────────────────────

test("applySequence: count=1 returns single copy at stride 0", () => {
    const result = applySequence([2, 2, 1], 2, 1);
    assert.deepEqual(result, [[2, 2, 1]]);
});

test("applySequence: count=3 produces 3 transpositions", () => {
    const result = applySequence([2, 2, 1], 2, 3);
    assert.equal(result.length, 3);
    assert.deepEqual(result[0], [2, 2, 1]);
    assert.deepEqual(result[1], [4, 4, 3]);
    assert.deepEqual(result[2], [6, 6, 5]);
});

test("applySequence: negative stride descends", () => {
    const result = applySequence([2, 3], -2, 2);
    assert.deepEqual(result[1], [0, 1]);
});

test("applySequence: empty intervals produces empty arrays per copy", () => {
    const result = applySequence([], 2, 3);
    assert.deepEqual(result, [[], [], []]);
});

test("applySequence: count=0 returns empty array", () => {
    const result = applySequence([1, 2, 3], 2, 0);
    assert.deepEqual(result, []);
});

// ─── 2. applyFragmentation ───────────────────────────────────────────────────

test("applyFragmentation: basic slice from start", () => {
    const result = applyFragmentation([2, 2, 1, 3], 0, 2);
    assert.deepEqual(result, [2, 2]);
});

test("applyFragmentation: slice from offset", () => {
    const result = applyFragmentation([2, 2, 1, 3], 1, 3);
    assert.deepEqual(result, [2, 1, 3]);
});

test("applyFragmentation: length exceeding array is clamped", () => {
    const result = applyFragmentation([2, 2, 1], 1, 100);
    assert.deepEqual(result, [2, 1]);
});

test("applyFragmentation: empty input returns empty", () => {
    const result = applyFragmentation([], 0, 2);
    assert.deepEqual(result, []);
});

test("applyFragmentation: length=0 returns empty", () => {
    const result = applyFragmentation([1, 2, 3], 0, 0);
    assert.deepEqual(result, []);
});

test("applyFragmentation: start beyond length returns empty", () => {
    const result = applyFragmentation([1, 2, 3], 10, 2);
    assert.deepEqual(result, []);
});

// ─── 3. applyInversion ───────────────────────────────────────────────────────

test("applyInversion: negates all intervals", () => {
    const result = applyInversion([4, 3, -2]);
    assert.deepEqual(result, [-4, -3, 2]);
});

test("applyInversion: zero interval stays zero", () => {
    const result = applyInversion([0, 5, 0]);
    assert.deepEqual(result, [0, -5, 0]);
});

test("applyInversion: double inversion returns original", () => {
    const orig = [2, -3, 5, -1];
    assert.deepEqual(applyInversion(applyInversion(orig)), orig);
});

test("applyInversion: empty input returns empty", () => {
    assert.deepEqual(applyInversion([]), []);
});

// ─── 4. applyRetrograde ──────────────────────────────────────────────────────

test("applyRetrograde: reverses interval array", () => {
    const result = applyRetrograde([2, 2, 1]);
    assert.deepEqual(result, [1, 2, 2]);
});

test("applyRetrograde: double retrograde returns original", () => {
    const orig = [2, -3, 5, -1];
    assert.deepEqual(applyRetrograde(applyRetrograde(orig)), orig);
});

test("applyRetrograde: empty input returns empty", () => {
    assert.deepEqual(applyRetrograde([]), []);
});

test("applyRetrograde: single element returns same", () => {
    assert.deepEqual(applyRetrograde([7]), [7]);
});

// ─── 5. applyAugmentation ────────────────────────────────────────────────────

test("applyAugmentation: default factor 2 doubles all durations", () => {
    const result = applyAugmentation([1, 0.5, 0.5]);
    assert.deepEqual(result, [2, 1, 1]);
});

test("applyAugmentation: custom factor 3", () => {
    const result = applyAugmentation([1, 2], 3);
    assert.deepEqual(result, [3, 6]);
});

test("applyAugmentation: empty input returns empty", () => {
    assert.deepEqual(applyAugmentation([]), []);
});

// ─── 6. applyDiminution ──────────────────────────────────────────────────────

test("applyDiminution: default factor 2 halves all durations", () => {
    const result = applyDiminution([2, 1, 1]);
    assert.deepEqual(result, [1, 0.5, 0.5]);
});

test("applyDiminution: custom factor 4", () => {
    const result = applyDiminution([4, 2], 4);
    assert.deepEqual(result, [1, 0.5]);
});

test("applyDiminution: augment then diminish returns original", () => {
    const orig = [1, 0.5, 0.25];
    const augmented = applyAugmentation(orig, 4);
    const back = applyDiminution(augmented, 4);
    back.forEach((v, i) => {
        assert.ok(Math.abs(v - orig[i]) < 1e-6, `mismatch at index ${i}: ${v} vs ${orig[i]}`);
    });
});

test("applyDiminution: empty input returns empty", () => {
    assert.deepEqual(applyDiminution([]), []);
});

// ─── 7. computeRecapIdentityScore ────────────────────────────────────────────

test("computeRecapIdentityScore: identical intervals → 1.0", () => {
    const score = computeRecapIdentityScore([2, 3, -1], [2, 3, -1]);
    assert.equal(score, 1.0);
});

test("computeRecapIdentityScore: completely opposite contour → 0.0", () => {
    const score = computeRecapIdentityScore([2, 3, 1], [-2, -3, -1]);
    assert.equal(score, 0.0);
});

test("computeRecapIdentityScore: half match → 0.5", () => {
    const score = computeRecapIdentityScore([2, -2], [2, 2]);
    assert.equal(score, 0.5);
});

test("computeRecapIdentityScore: zeros match zeros", () => {
    const score = computeRecapIdentityScore([0, 0, 0], [0, 0, 0]);
    assert.equal(score, 1.0);
});

test("computeRecapIdentityScore: empty arrays → 0", () => {
    const score = computeRecapIdentityScore([], []);
    assert.equal(score, 0);
});

test("computeRecapIdentityScore: different lengths uses shorter", () => {
    const score = computeRecapIdentityScore([2, 3, -1, -2], [2, 3]);
    assert.equal(score, 1.0); // first 2 both match
});

test("computeRecapIdentityScore: augmented recap has high identity (same contour, different duration)", () => {
    const theme = [2, 3, -2];
    const recap = [2, 3, -2]; // exact — would be 1.0
    assert.equal(computeRecapIdentityScore(theme, recap), 1.0);
});

test("computeRecapIdentityScore: inverted recap has low identity", () => {
    const theme = [2, 3, -2];
    const inverted = [-2, -3, 2];
    assert.equal(computeRecapIdentityScore(theme, inverted), 0.0);
});

// ─── 8. buildMotifDevelopmentPlan ────────────────────────────────────────────

function makeSection(role, motifRef) {
    return {
        id: role,
        role,
        label: role,
        measures: 8,
        energy: 0.5,
        density: 0.4,
        ...(motifRef ? { motifRef } : {}),
    };
}

function makeMotifDraft(id, sectionId, intervals) {
    return { id, sectionId, intervals, source: "planner" };
}

test("buildMotifDevelopmentPlan: returns a Map", () => {
    const sections = ["theme_a", "bridge", "development", "recap"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", [2, 2, 1])];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    assert.ok(result instanceof Map);
});

test("buildMotifDevelopmentPlan: non-development roles (theme_a) are not in map", () => {
    const sections = ["theme_a", "recap"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", [2, 2, 1])];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    assert.ok(!result.has("theme_a"), "theme_a should not be in development map");
    assert.ok(result.has("recap"), "recap should be in development map");
});

test("buildMotifDevelopmentPlan: recap entry has recapIdentityScore", () => {
    const sections = ["theme_a", "recap"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", [2, 3, -2])];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    const recapPlan = result.get("recap");
    assert.ok(recapPlan !== undefined);
    assert.ok(recapPlan.entries.length > 0);
    assert.ok(recapPlan.entries[0].recapIdentityScore !== undefined);
    const score = recapPlan.entries[0].recapIdentityScore;
    assert.ok(score >= 0 && score <= 1, `score ${score} should be in [0,1]`);
});

test("buildMotifDevelopmentPlan: development entry uses sequence transform", () => {
    const sections = ["theme_a", "development"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", [2, 2, 1])];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    const devPlan = result.get("development");
    assert.ok(devPlan !== undefined);
    assert.equal(devPlan.entries[0].transform, "sequence");
});

test("buildMotifDevelopmentPlan: bridge entry uses fragment transform", () => {
    const sections = ["theme_a", "bridge"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", [2, 2, 1, 3])];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    const bridgePlan = result.get("bridge");
    assert.ok(bridgePlan !== undefined);
    assert.equal(bridgePlan.entries[0].transform, "fragment");
});

test("buildMotifDevelopmentPlan: variation entry uses inversion transform", () => {
    const sections = ["theme_a", "variation"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", [2, 2, 1])];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    const varPlan = result.get("variation");
    assert.ok(varPlan !== undefined);
    assert.equal(varPlan.entries[0].transform, "inversion");
});

test("buildMotifDevelopmentPlan: outro entry uses augmentation transform", () => {
    const sections = ["theme_a", "outro"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", [2, 2, 1])];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    const outroPlan = result.get("outro");
    assert.ok(outroPlan !== undefined);
    assert.equal(outroPlan.entries[0].transform, "augmentation");
});

test("buildMotifDevelopmentPlan: no motif drafts → empty map", () => {
    const sections = ["theme_a", "bridge", "development"].map((r) => makeSection(r));
    const result = buildMotifDevelopmentPlan(sections, []);
    assert.equal(result.size, 0);
});

test("buildMotifDevelopmentPlan: development transformedIntervals is array", () => {
    const sections = ["theme_a", "development"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", [2, 2, 1])];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    const entry = result.get("development")?.entries[0];
    assert.ok(entry !== undefined);
    assert.ok(Array.isArray(entry.transformedIntervals));
});

test("buildMotifDevelopmentPlan: fragment transformedIntervals is shorter than original", () => {
    const orig = [2, 2, 1, 3, 4];
    const sections = ["theme_a", "bridge"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", orig)];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    const entry = result.get("bridge")?.entries[0];
    assert.ok(entry !== undefined);
    assert.ok(entry.transformedIntervals.length < orig.length);
});

test("buildMotifDevelopmentPlan: inversion entry has negated intervals", () => {
    const orig = [2, -3, 1];
    const sections = ["theme_a", "variation"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", orig)];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    const entry = result.get("variation")?.entries[0];
    assert.ok(entry !== undefined);
    assert.deepEqual(entry.transformedIntervals, [-2, 3, -1]);
});

test("buildMotifDevelopmentPlan: recap identity score of exact return is 1.0", () => {
    const orig = [2, 3, -2];
    const sections = ["theme_a", "recap"].map((r) => makeSection(r));
    const drafts = [makeMotifDraft("theme_a", "theme_a", orig)];
    const result = buildMotifDevelopmentPlan(sections, drafts);
    const recapPlan = result.get("recap");
    assert.ok(recapPlan !== undefined);
    assert.equal(recapPlan.recapIdentityScore, 1.0);
    assert.equal(recapPlan.entries[0].recapIdentityScore, 1.0);
});

// ─── MotifDevelopmentScoring Tests ───────────────────────────────────────────

function makeArt(capturedMotif, overrides = {}) {
    return {
        sectionId: "test",
        role: "theme_a",
        measureCount: 8,
        melodyEvents: overrides.melodyEvents ?? [],
        accompanimentEvents: [],
        noteHistory: [],
        capturedMotif,
        ...overrides,
    };
}

test("computeExactReturnScore: identical motifs return 1.0", () => {
    const src = makeArt([2, 2, 1, -1]);
    const tgt = makeArt([2, 2, 1, -1]);
    assert.strictEqual(computeExactReturnScore(src, tgt), 1.0);
});

test("computeExactReturnScore: no capturedMotif returns 0", () => {
    const src = makeArt(undefined);
    const tgt = makeArt([2, 2]);
    assert.strictEqual(computeExactReturnScore(src, tgt), 0);
});

test("computeExactReturnScore: opposite contour returns 0", () => {
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([-2, -2, -1]);
    assert.strictEqual(computeExactReturnScore(src, tgt), 0);
});

test("computeSequenceScore: perfect transposition returns 1.0", () => {
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([4, 4, 3]); // stride=2
    const score = computeSequenceScore(src, tgt);
    assert.strictEqual(score, 1.0);
});

test("computeSequenceScore: no motifs returns 0", () => {
    const src = makeArt(undefined);
    const tgt = makeArt(undefined);
    assert.strictEqual(computeSequenceScore(src, tgt), 0);
});

test("computeSequenceScore: random intervals score low", () => {
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([5, -3, 7]);
    const score = computeSequenceScore(src, tgt);
    assert.ok(score < 0.8, `expected < 0.8, got ${score}`);
});

test("computeFragmentationScore: exact prefix of source = 1.0", () => {
    const src = makeArt([2, 2, 1, 3]);
    const tgt = makeArt([2, 2]); // first 2 of 4
    const score = computeFragmentationScore(src, tgt);
    assert.strictEqual(score, 1.0);
});

test("computeFragmentationScore: target same length as source = 0.5 neutral", () => {
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([2, 2, 1]);
    assert.strictEqual(computeFragmentationScore(src, tgt), 0.5);
});

test("computeInversionDetectionScore: perfect inversion returns 1.0", () => {
    const src = makeArt([2, -3, 4]);
    const tgt = makeArt([-2, 3, -4]);
    assert.strictEqual(computeInversionDetectionScore(src, tgt), 1.0);
});

test("computeInversionDetectionScore: identical (not inverted) returns 0", () => {
    const src = makeArt([2, 3, 4]);
    const tgt = makeArt([2, 3, 4]);
    assert.strictEqual(computeInversionDetectionScore(src, tgt), 0);
});

test("computeRhythmicProportionScore: augmentation with halved density = high", () => {
    // source: 8 events in 4 measures = 2/measure; target: 4 events in 4 measures = 1/measure
    const src = makeArt(undefined, { measureCount: 4, melodyEvents: [{},{},{},{},{},{},{},{}] });
    const tgt = makeArt(undefined, { measureCount: 4, melodyEvents: [{},{},{},{}] });
    const score = computeRhythmicProportionScore(src, tgt, "augmentation");
    assert.ok(score > 0.6, `expected > 0.6, got ${score}`);
});

test("computeRhythmicProportionScore: diminution with doubled density = high", () => {
    const src = makeArt(undefined, { measureCount: 4, melodyEvents: [{},{},{},{}] });
    const tgt = makeArt(undefined, { measureCount: 4, melodyEvents: [{},{},{},{},{},{},{},{}] });
    const score = computeRhythmicProportionScore(src, tgt, "diminution");
    assert.ok(score > 0.6, `expected > 0.6, got ${score}`);
});

test("computeReharmonizedReturnScore: same melody + different harmony = high score", () => {
    const src = makeArt([2, 2, 1], { harmonicColorCues: [{ tag: "prolongation" }] });
    const tgt = makeArt([2, 2, 1], { harmonicColorCues: [{ tag: "applied_dominant" }] });
    const score = computeReharmonizedReturnScore(src, tgt);
    assert.ok(score > 0.8, `expected > 0.8, got ${score}`);
});

test("computeMotifRecapIdentityScore: delegates to computeExactReturnScore", () => {
    const src = makeArt([2, 2, 1]);
    const recap = makeArt([2, 2, 1]);
    assert.strictEqual(computeMotifRecapIdentityScore(src, recap), 1.0);
});

test("computeMotifDevelopmentScoreSummary: repeat transform returns summary with primaryScore", () => {
    const plan = {
        entries: [{ sourceSectionId: "theme_a", targetSectionId: "recap", transform: "repeat" }],
    };
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([2, 2, 1]);
    const result = computeMotifDevelopmentScoreSummary(plan, src, tgt);
    assert.strictEqual(result.transformKind, "repeat");
    assert.strictEqual(result.primaryScore, 1.0);
    assert.ok("overall" in result);
});

test("computeMotifDevelopmentScoreSummary: recap with recapIdentityScore blends into overall", () => {
    const plan = {
        entries: [{ sourceSectionId: "theme_a", targetSectionId: "recap", transform: "repeat" }],
        recapIdentityScore: 0.8,
    };
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([2, 2, 1]);
    const result = computeMotifDevelopmentScoreSummary(plan, src, tgt);
    assert.strictEqual(result.recapIdentityScore, 0.8);
    // overall = 0.7 * 1.0 + 0.3 * 0.8 = 0.94
    assert.ok(Math.abs(result.overall - 0.94) < 0.001, `expected 0.94, got ${result.overall}`);
});

test("computeMotifDevelopmentScoreSummary: unknown transform returns 0.5 primaryScore", () => {
    const plan = { entries: [] };
    const src = makeArt([2, 2]);
    const tgt = makeArt([2, 2]);
    const result = computeMotifDevelopmentScoreSummary(plan, src, tgt);
    assert.strictEqual(result.transformKind, "unknown");
    assert.strictEqual(result.primaryScore, 0.5);
});

// ─── computePlanAwareMotifDevelopmentScore ────────────────────────────────────

import { computePlanAwareMotifDevelopmentScore } from "../dist/core/evaluate/craftScoring.js";

function makePlanSection(id, role, overrides = {}) {
    return { id, role, label: role, measures: 8, energy: 0.5, density: 0.4, ...overrides };
}

function makeArtifactCDE(sectionId, role, capturedMotif, overrides = {}) {
    return {
        sectionId,
        role,
        measureCount: 8,
        melodyEvents: [],
        accompanimentEvents: [],
        noteHistory: [],
        capturedMotif,
        ...overrides,
    };
}

test("computePlanAwareMotifDevelopmentScore: no plan returns fallback 0.4", () => {
    const result = computePlanAwareMotifDevelopmentScore([], undefined);
    assert.ok(result.score >= 0.3 && result.score <= 0.5, `expected ~0.4, got ${result.score}`);
});

test("computePlanAwareMotifDevelopmentScore: no theme_a source returns fallback 0.4", () => {
    const plan = { sections: [makePlanSection("s1", "bridge"), makePlanSection("s2", "development")] };
    const artifacts = [makeArtifactCDE("s1", "bridge", undefined), makeArtifactCDE("s2", "development", undefined)];
    const result = computePlanAwareMotifDevelopmentScore(artifacts, plan);
    assert.ok(result.score >= 0.3 && result.score <= 0.5, `expected ~0.4, got ${result.score}`);
});

test("computePlanAwareMotifDevelopmentScore: no motifDevelopment plans returns fallback", () => {
    const plan = {
        sections: [
            makePlanSection("s1", "theme_a"),
            makePlanSection("s2", "bridge"),
        ],
    };
    const artifacts = [
        makeArtifactCDE("s1", "theme_a", [2, 2, 1]),
        makeArtifactCDE("s2", "bridge", undefined),
    ];
    const result = computePlanAwareMotifDevelopmentScore(artifacts, plan);
    // No motifDevelopment plans → no development sections evaluated
    assert.ok(result.score >= 0 && result.score <= 1, `out of range: ${result.score}`);
});

test("computePlanAwareMotifDevelopmentScore: with motifDevelopment plan returns numeric score in [0,1]", () => {
    const devPlan = { entries: [{ transform: "sequence", transformedIntervals: [4, 4, 3], targetMotif: [4, 4, 3] }] };
    const plan = {
        sections: [
            makePlanSection("s1", "theme_a"),
            makePlanSection("s2", "development", { motifDevelopment: devPlan }),
        ],
    };
    const artifacts = [
        makeArtifactCDE("s1", "theme_a", [2, 2, 1]),
        makeArtifactCDE("s2", "development", [4, 4, 3]),
    ];
    const result = computePlanAwareMotifDevelopmentScore(artifacts, plan);
    assert.ok(result.score >= 0 && result.score <= 1, `out of range: ${result.score}`);
    assert.ok(typeof result.diversityScore === "number", "diversityScore should be numeric");
});

test("computePlanAwareMotifDevelopmentScore: returns sectionScores record", () => {
    const devPlan = { entries: [{ transform: "repeat", transformedIntervals: [2, 2, 1] }] };
    const plan = {
        sections: [
            makePlanSection("s1", "theme_a"),
            makePlanSection("s2", "recap", { motifDevelopment: devPlan }),
        ],
    };
    const artifacts = [
        makeArtifactCDE("s1", "theme_a", [2, 2, 1]),
        makeArtifactCDE("s2", "recap", [2, 2, 1]),
    ];
    const result = computePlanAwareMotifDevelopmentScore(artifacts, plan);
    assert.ok(typeof result.sectionScores === "object", "sectionScores should be an object");
});

// ─── buildMotifGraph ──────────────────────────────────────────────────────────

import { buildMotifGraph } from "../dist/core/plan/motifDevelopment.js";

function makeGraphSection(role, id) {
    return { id: id ?? role, role, label: role, measures: 8, energy: 0.5, density: 0.4 };
}

function makeGraphDraft(id, sectionId, intervals) {
    return { id, sectionId, intervals, source: "planner" };
}

test("buildMotifGraph: returns MotifGraph with original occurrence", () => {
    const sections = [makeGraphSection("theme_a"), makeGraphSection("development"), makeGraphSection("recap")];
    const drafts = [makeGraphDraft("theme_a", "theme_a", [2, 2, 1])];
    const graph = buildMotifGraph(sections, drafts);
    assert.ok(graph !== undefined, "should return a graph");
    assert.strictEqual(graph.motifId, "theme_a");
    assert.deepEqual(graph.originalIntervals, [2, 2, 1]);
    const original = graph.occurrences.find((o) => o.transform === "original");
    assert.ok(original, "should have an original occurrence");
    assert.strictEqual(original.sectionId, "theme_a");
    assert.strictEqual(original.similarity, 1.0);
});

test("buildMotifGraph: includes all non-theme_a sections in occurrences", () => {
    const sections = [makeGraphSection("theme_a"), makeGraphSection("development"), makeGraphSection("recap")];
    const drafts = [makeGraphDraft("theme_a", "theme_a", [2, 2, 1])];
    const graph = buildMotifGraph(sections, drafts);
    assert.strictEqual(graph.occurrences.length, 3); // theme_a + development + recap
});

test("buildMotifGraph: false_recap when development section has high contour similarity", () => {
    const sections = [makeGraphSection("theme_a"), makeGraphSection("development")];
    const drafts = [makeGraphDraft("theme_a", "theme_a", [2, 2, 1])];
    // Provide captured motif in artifact that closely matches original
    const artifacts = [
        { sectionId: "theme_a", capturedMotif: [2, 2, 1] },
        { sectionId: "development", capturedMotif: [2, 2, 1] }, // identical → similarity 1.0
    ];
    const graph = buildMotifGraph(sections, drafts, artifacts);
    const devOcc = graph.occurrences.find((o) => o.role === "development");
    assert.ok(devOcc, "development occurrence should exist");
    assert.strictEqual(devOcc.transform, "false_recap");
});

test("buildMotifGraph: recap section is NOT classified as false_recap", () => {
    const sections = [makeGraphSection("theme_a"), makeGraphSection("recap")];
    const drafts = [makeGraphDraft("theme_a", "theme_a", [2, 2, 1])];
    const artifacts = [
        { sectionId: "theme_a", capturedMotif: [2, 2, 1] },
        { sectionId: "recap", capturedMotif: [2, 2, 1] }, // high similarity but recap role
    ];
    const graph = buildMotifGraph(sections, drafts, artifacts);
    const recapOcc = graph.occurrences.find((o) => o.role === "recap");
    assert.ok(recapOcc, "recap occurrence should exist");
    assert.notStrictEqual(recapOcc.transform, "false_recap", "recap should never be false_recap");
});

test("buildMotifGraph: diversityScore = 0 when no non-original transforms", () => {
    const sections = [makeGraphSection("theme_a")];
    const drafts = [makeGraphDraft("theme_a", "theme_a", [2, 2, 1])];
    const graph = buildMotifGraph(sections, drafts);
    assert.strictEqual(graph.diversityScore, 0, "no non-original → diversity 0");
});

test("buildMotifGraph: returns undefined when no motif drafts", () => {
    const sections = [makeGraphSection("theme_a"), makeGraphSection("development")];
    const graph = buildMotifGraph(sections, []);
    assert.strictEqual(graph, undefined);
});

// ─── computeTonalRepetitionScore ─────────────────────────────────────────────

import {
    computeTonalRepetitionScore,
    computeFalseRecapDetectionScore,
    computeMotifDiversityScore,
} from "../dist/core/evaluate/motifDevelopmentScoring.js";

test("computeTonalRepetitionScore: perfect tonal match (same intervals) returns 1.0", () => {
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([2, 2, 1]);
    assert.strictEqual(computeTonalRepetitionScore(src, tgt), 1.0);
});

test("computeTonalRepetitionScore: diatonic ±1 deviation still scores high", () => {
    // [2,2,1] vs [3,1,2] — each shifted by ≤1 AND same sign
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([3, 1, 2]);
    const score = computeTonalRepetitionScore(src, tgt);
    assert.ok(score > 0.5, `expected >0.5, got ${score}`);
});

test("computeTonalRepetitionScore: opposite contour returns 0", () => {
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([-2, -2, -1]);
    assert.strictEqual(computeTonalRepetitionScore(src, tgt), 0);
});

test("computeTonalRepetitionScore: missing capturedMotif returns 0", () => {
    const src = makeArt(undefined);
    const tgt = makeArt([2, 2, 1]);
    assert.strictEqual(computeTonalRepetitionScore(src, tgt), 0);
});

// ─── computeFalseRecapDetectionScore ─────────────────────────────────────────

test("computeFalseRecapDetectionScore: high similarity + changed key → score ≥ 0.70", () => {
    const src = makeArt([2, 2, 1], { tonicKey: "C" });
    const cand = makeArt([2, 2, 1], { tonicKey: "G" }); // same contour, different key
    const score = computeFalseRecapDetectionScore(src, cand);
    assert.ok(score >= 0.70, `expected ≥0.70, got ${score}`);
});

test("computeFalseRecapDetectionScore: high similarity + same harmony → score 0.50", () => {
    const src = makeArt([2, 2, 1], { tonicKey: "C" });
    const cand = makeArt([2, 2, 1], { tonicKey: "C" }); // same contour, same key
    const score = computeFalseRecapDetectionScore(src, cand);
    assert.strictEqual(score, 0.50);
});

test("computeFalseRecapDetectionScore: low similarity → score 0", () => {
    const src = makeArt([2, 2, 1]);
    const cand = makeArt([-2, -2, -1]); // inverted → similarity 0
    const score = computeFalseRecapDetectionScore(src, cand);
    assert.strictEqual(score, 0);
});

test("computeFalseRecapDetectionScore: no source motif → score 0", () => {
    const src = makeArt(undefined);
    const cand = makeArt([2, 2, 1]);
    assert.strictEqual(computeFalseRecapDetectionScore(src, cand), 0);
});

test("computeFalseRecapDetectionScore: changed color tags signal false recap", () => {
    const src = makeArt([2, 2, 1], {
        tonicKey: "C",
        harmonicColorCues: [{ tag: "tonic", onset: 0 }],
    });
    const cand = makeArt([2, 2, 1], {
        tonicKey: "C",
        harmonicColorCues: [{ tag: "chromatic", onset: 0 }],
    });
    const score = computeFalseRecapDetectionScore(src, cand);
    assert.ok(score >= 0.70, `changed color tags should yield ≥0.70, got ${score}`);
});

// ─── computeMotifDiversityScore ───────────────────────────────────────────────

test("computeMotifDiversityScore: no occurrences → neutral 0.5", () => {
    assert.strictEqual(computeMotifDiversityScore([]), 0.5);
});

test("computeMotifDiversityScore: only original occurrence → 0", () => {
    const occ = [{ sectionId: "s1", role: "theme_a", transform: "original", similarity: 1.0 }];
    assert.strictEqual(computeMotifDiversityScore(occ), 0);
});

test("computeMotifDiversityScore: 2 distinct non-original transforms → 0.5", () => {
    const occ = [
        { sectionId: "s1", role: "theme_a", transform: "original", similarity: 1.0 },
        { sectionId: "s2", role: "development", transform: "sequence", similarity: 0.9 },
        { sectionId: "s3", role: "bridge", transform: "fragment", similarity: 0.8 },
    ];
    assert.strictEqual(computeMotifDiversityScore(occ), 0.5);
});

test("computeMotifDiversityScore: 4+ distinct transforms → 1.0", () => {
    const transforms = ["sequence", "fragment", "inversion", "augmentation"];
    const occ = transforms.map((t, i) => ({
        sectionId: `s${i + 2}`, role: "development", transform: t, similarity: 0.8,
    }));
    occ.unshift({ sectionId: "s1", role: "theme_a", transform: "original", similarity: 1.0 });
    assert.strictEqual(computeMotifDiversityScore(occ), 1.0);
});

// ─── computeMotifDevelopmentScoreSummary — new fields ────────────────────────

test("computeMotifDevelopmentScoreSummary: graph adds optional fields without changing overall", () => {
    const plan = {
        entries: [{ sourceSectionId: "theme_a", targetSectionId: "recap", transform: "repeat" }],
        recapIdentityScore: 0.8,
    };
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([2, 2, 1]);
    const graph = {
        motifId: "theme_a",
        originalIntervals: [2, 2, 1],
        sourceSectionId: "theme_a",
        occurrences: [
            { sectionId: "theme_a", role: "theme_a", transform: "original", similarity: 1.0 },
            { sectionId: "recap", role: "recap", transform: "repeat", similarity: 1.0 },
        ],
        usedTransforms: ["repeat"],
        diversityScore: 0.25,
    };
    const result = computeMotifDevelopmentScoreSummary(plan, src, tgt, graph);
    // overall must remain 0.94
    assert.ok(Math.abs(result.overall - 0.94) < 0.001, `expected 0.94, got ${result.overall}`);
    // new fields are present
    assert.ok("tonalRepetitionScore" in result, "tonalRepetitionScore should be present");
    assert.ok("falseRecapScore" in result, "falseRecapScore should be present");
    assert.ok("diversityScore" in result, "diversityScore should be present");
    assert.ok(typeof result.diversityScore === "number", "diversityScore should be a number");
});

test("computeMotifDevelopmentScoreSummary: without graph, new optional fields are absent", () => {
    const plan = {
        entries: [{ sourceSectionId: "theme_a", targetSectionId: "recap", transform: "repeat" }],
    };
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([2, 2, 1]);
    const result = computeMotifDevelopmentScoreSummary(plan, src, tgt);
    assert.ok(!("tonalRepetitionScore" in result), "tonalRepetitionScore should be absent without graph");
    assert.ok(!("falseRecapScore" in result), "falseRecapScore should be absent without graph");
    assert.ok(!("diversityScore" in result), "diversityScore should be absent without graph");
});

test("computeMotifDevelopmentScoreSummary: diversityScore from graph occurrences is correct", () => {
    const plan = { entries: [{ transform: "sequence" }] };
    const src = makeArt([2, 2, 1]);
    const tgt = makeArt([4, 4, 3]);
    const graph = {
        motifId: "theme_a",
        originalIntervals: [2, 2, 1],
        sourceSectionId: "theme_a",
        occurrences: [
            { sectionId: "s1", role: "theme_a", transform: "original", similarity: 1.0 },
            { sectionId: "s2", role: "development", transform: "sequence", similarity: 0.9 },
            { sectionId: "s3", role: "bridge", transform: "fragment", similarity: 0.8 },
        ],
        usedTransforms: ["sequence", "fragment"],
        diversityScore: 0.5,
    };
    const result = computeMotifDevelopmentScoreSummary(plan, src, tgt, graph);
    // 2 unique non-original transforms → diversityScore = 0.5
    assert.ok(Math.abs(result.diversityScore - 0.5) < 0.01, `expected 0.5, got ${result.diversityScore}`);
});
