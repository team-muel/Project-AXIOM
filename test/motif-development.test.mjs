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
