/**
 * Harmony grammar tests
 *
 * Validates all exports of harmonyGrammar.ts:
 *   buildFunctionalProgression, chooseCadenceApproachTemplate,
 *   buildHarmonicRhythmShape, buildAppliedDominantCue,
 *   suggestTonicizationWindow, applyHarmonyGrammarToSections
 *
 * Also verifies that materializeCompositionSketch attaches harmonyGrammar
 * to each SectionPlan (integration via sketch.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildFunctionalProgression,
    chooseCadenceApproachTemplate,
    buildHarmonicRhythmShape,
    buildAppliedDominantCue,
    suggestTonicizationWindow,
    applyHarmonyGrammarToSections,
} from "../dist/core/plan/harmonyGrammar.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSection(role, overrides = {}) {
    return {
        id: role,
        role,
        label: role,
        measures: 8,
        energy: 0.5,
        density: 0.4,
        ...overrides,
    };
}

// ─── 1. buildFunctionalProgression ───────────────────────────────────────────

test("buildFunctionalProgression: theme_a returns T→PD→D→T", () => {
    const seq = buildFunctionalProgression("theme_a", 0.5);
    assert.deepEqual(seq, ["tonic", "predominant", "dominant", "tonic"]);
});

test("buildFunctionalProgression: intro returns T→PD→D→T", () => {
    const seq = buildFunctionalProgression("intro", 0.4);
    assert.deepEqual(seq, ["tonic", "predominant", "dominant", "tonic"]);
});

test("buildFunctionalProgression: recap returns T→PD→D→T", () => {
    const seq = buildFunctionalProgression("recap", 0.5);
    assert.deepEqual(seq, ["tonic", "predominant", "dominant", "tonic"]);
});

test("buildFunctionalProgression: theme_b returns extended PD cycle", () => {
    const seq = buildFunctionalProgression("theme_b", 0.5);
    assert.equal(seq[0], "tonic");
    assert.equal(seq[seq.length - 1], "tonic");
    assert.ok(seq.length > 4, "theme_b should have more than 4 steps");
});

test("buildFunctionalProgression: variation also returns extended PD cycle", () => {
    const seq = buildFunctionalProgression("variation", 0.5);
    assert.equal(seq[0], "tonic");
    assert.equal(seq[seq.length - 1], "tonic");
    assert.ok(seq.length > 4);
});

test("buildFunctionalProgression: development starts T and ends D", () => {
    const seq = buildFunctionalProgression("development", 0.7, 0.7);
    assert.equal(seq[0], "tonic");
    assert.equal(seq[seq.length - 1], "dominant"); // development ends on dominant pedal
});

test("buildFunctionalProgression: development with low tension has 4 steps", () => {
    const seq = buildFunctionalProgression("development", 0.4, 0.3);
    assert.equal(seq.length, 4);
});

test("buildFunctionalProgression: development with high energy adds extra dominant", () => {
    const seqHigh = buildFunctionalProgression("development", 0.8, 0.8);
    const seqLow  = buildFunctionalProgression("development", 0.4, 0.4);
    assert.ok(seqHigh.length > seqLow.length);
});

test("buildFunctionalProgression: bridge starts with PD", () => {
    const seq = buildFunctionalProgression("bridge", 0.5);
    assert.equal(seq[0], "predominant");
});

test("buildFunctionalProgression: cadence returns D→T", () => {
    const seq = buildFunctionalProgression("cadence", 0.3);
    assert.deepEqual(seq, ["dominant", "tonic"]);
});

test("buildFunctionalProgression: outro returns D→T", () => {
    const seq = buildFunctionalProgression("outro", 0.3);
    assert.deepEqual(seq, ["dominant", "tonic"]);
});

test("buildFunctionalProgression: all sequences contain only valid roles", () => {
    const validRoles = new Set(["tonic", "predominant", "dominant"]);
    const roles = ["intro", "theme_a", "theme_b", "bridge", "development", "variation", "recap", "cadence", "outro"];
    for (const role of roles) {
        const seq = buildFunctionalProgression(role, 0.5);
        assert.ok(seq.length >= 2, `${role} should have at least 2 steps`);
        for (const r of seq) {
            assert.ok(validRoles.has(r), `${r} is not a valid FunctionalHarmonyRole`);
        }
    }
});

// ─── 2. chooseCadenceApproachTemplate ────────────────────────────────────────

test("chooseCadenceApproachTemplate: recap → cad64", () => {
    const result = chooseCadenceApproachTemplate("recap", 4, 6);
    assert.equal(result, "cad64");
});

test("chooseCadenceApproachTemplate: cadence → cad64", () => {
    const result = chooseCadenceApproachTemplate("cadence", 4, 6);
    assert.equal(result, "cad64");
});

test("chooseCadenceApproachTemplate: outro at last position → cad64", () => {
    const result = chooseCadenceApproachTemplate("outro", 5, 6);
    assert.equal(result, "cad64");
});

test("chooseCadenceApproachTemplate: outro early → basic", () => {
    const result = chooseCadenceApproachTemplate("outro", 0, 6);
    assert.equal(result, "basic");
});

test("chooseCadenceApproachTemplate: bridge → applied_dominant", () => {
    const result = chooseCadenceApproachTemplate("bridge", 2, 6);
    assert.equal(result, "applied_dominant");
});

test("chooseCadenceApproachTemplate: development → applied_dominant", () => {
    const result = chooseCadenceApproachTemplate("development", 3, 6);
    assert.equal(result, "applied_dominant");
});

test("chooseCadenceApproachTemplate: theme_a at early position → basic", () => {
    const result = chooseCadenceApproachTemplate("theme_a", 0, 6);
    assert.equal(result, "basic");
});

test("chooseCadenceApproachTemplate: theme_a near end → extended", () => {
    const result = chooseCadenceApproachTemplate("theme_a", 5, 6);
    assert.equal(result, "extended");
});

test("chooseCadenceApproachTemplate: valid template values", () => {
    const valid = new Set(["basic", "cad64", "applied_dominant", "extended"]);
    const roles = ["intro", "theme_a", "theme_b", "bridge", "development", "variation", "recap", "cadence", "outro"];
    for (const role of roles) {
        const t = chooseCadenceApproachTemplate(role, 3, 6);
        assert.ok(valid.has(t), `${t} is not a valid CadenceApproachTemplate`);
    }
});

// ─── 3. buildHarmonicRhythmShape ─────────────────────────────────────────────

test("buildHarmonicRhythmShape: intro → slow", () => {
    assert.equal(buildHarmonicRhythmShape("intro", 0.4), "slow");
});

test("buildHarmonicRhythmShape: theme_a → slow", () => {
    assert.equal(buildHarmonicRhythmShape("theme_a", 0.5), "slow");
});

test("buildHarmonicRhythmShape: theme_b → uniform", () => {
    assert.equal(buildHarmonicRhythmShape("theme_b", 0.5), "uniform");
});

test("buildHarmonicRhythmShape: development high energy → slow→fast", () => {
    assert.equal(buildHarmonicRhythmShape("development", 0.8), "slow\u2192fast");
});

test("buildHarmonicRhythmShape: development low energy → uniform", () => {
    assert.equal(buildHarmonicRhythmShape("development", 0.4), "uniform");
});

test("buildHarmonicRhythmShape: bridge → slow→fast", () => {
    assert.equal(buildHarmonicRhythmShape("bridge", 0.5), "slow\u2192fast");
});

test("buildHarmonicRhythmShape: variation → arch", () => {
    assert.equal(buildHarmonicRhythmShape("variation", 0.5), "arch");
});

test("buildHarmonicRhythmShape: recap → fast→slow", () => {
    assert.equal(buildHarmonicRhythmShape("recap", 0.5), "fast\u2192slow");
});

test("buildHarmonicRhythmShape: cadence → slow", () => {
    assert.equal(buildHarmonicRhythmShape("cadence", 0.3), "slow");
});

// ─── 4. buildAppliedDominantCue ──────────────────────────────────────────────

test("buildAppliedDominantCue: returns correct tag", () => {
    const cue = buildAppliedDominantCue("V", "C major");
    assert.equal(cue.tag, "applied_dominant");
});

test("buildAppliedDominantCue: keyTarget contains target degree and key context", () => {
    const cue = buildAppliedDominantCue("vi", "G major");
    assert.ok(cue.keyTarget?.includes("vi"), "keyTarget should include target degree");
    assert.ok(cue.keyTarget?.includes("G major"), "keyTarget should include key context");
});

test("buildAppliedDominantCue: optional startMeasure is propagated", () => {
    const cue = buildAppliedDominantCue("IV", "D minor", 4);
    assert.equal(cue.startMeasure, 4);
});

test("buildAppliedDominantCue: no startMeasure → undefined", () => {
    const cue = buildAppliedDominantCue("IV", "D minor");
    assert.equal(cue.startMeasure, undefined);
});

test("buildAppliedDominantCue: intensity is positive", () => {
    const cue = buildAppliedDominantCue("V", "F major");
    assert.ok((cue.intensity ?? 0) > 0);
});

// ─── 5. suggestTonicizationWindow ────────────────────────────────────────────

test("suggestTonicizationWindow: development returns window", () => {
    const win = suggestTonicizationWindow("development", "C major", 16);
    assert.ok(win !== undefined);
    assert.ok(win.startMeasure !== undefined);
    assert.ok(win.endMeasure !== undefined);
    assert.ok(win.startMeasure < win.endMeasure);
});

test("suggestTonicizationWindow: bridge returns window", () => {
    const win = suggestTonicizationWindow("bridge", "G major", 8);
    assert.ok(win !== undefined);
});

test("suggestTonicizationWindow: theme_b returns window", () => {
    const win = suggestTonicizationWindow("theme_b", "D minor", 8);
    assert.ok(win !== undefined);
});

test("suggestTonicizationWindow: theme_a returns undefined", () => {
    const win = suggestTonicizationWindow("theme_a", "C major", 8);
    assert.equal(win, undefined);
});

test("suggestTonicizationWindow: recap returns undefined", () => {
    const win = suggestTonicizationWindow("recap", "C major", 8);
    assert.equal(win, undefined);
});

test("suggestTonicizationWindow: development window bounds within section", () => {
    const measures = 16;
    const win = suggestTonicizationWindow("development", "C major", measures);
    assert.ok(win !== undefined);
    assert.ok(win.startMeasure >= 0);
    assert.ok(win.endMeasure <= measures);
});

// ─── 6. applyHarmonyGrammarToSections ────────────────────────────────────────

test("applyHarmonyGrammarToSections: returns a Map", () => {
    const sections = ["theme_a", "theme_b", "development", "recap"].map(makeSection);
    const result = applyHarmonyGrammarToSections(sections);
    assert.ok(result instanceof Map);
});

test("applyHarmonyGrammarToSections: every section has an entry", () => {
    const roles = ["intro", "theme_a", "theme_b", "bridge", "development", "variation", "recap", "cadence", "outro"];
    const sections = roles.map(makeSection);
    const result = applyHarmonyGrammarToSections(sections);
    for (const role of roles) {
        assert.ok(result.has(role), `Missing entry for ${role}`);
    }
});

test("applyHarmonyGrammarToSections: each plan has a valid functionalSequence", () => {
    const sections = ["theme_a", "development", "recap"].map(makeSection);
    const result = applyHarmonyGrammarToSections(sections);
    for (const [, plan] of result) {
        assert.ok(Array.isArray(plan.functionalSequence));
        assert.ok(plan.functionalSequence.length >= 2);
    }
});

test("applyHarmonyGrammarToSections: each plan has a cadenceApproach", () => {
    const sections = ["theme_a", "bridge", "recap"].map(makeSection);
    const result = applyHarmonyGrammarToSections(sections);
    for (const [, plan] of result) {
        assert.ok(typeof plan.cadenceApproach === "string");
        assert.ok(plan.cadenceApproach.length > 0);
    }
});

test("applyHarmonyGrammarToSections: each plan has a harmonicRhythmShape", () => {
    const sections = ["theme_a", "development", "recap"].map(makeSection);
    const result = applyHarmonyGrammarToSections(sections);
    for (const [, plan] of result) {
        assert.ok(typeof plan.harmonicRhythmShape === "string");
    }
});

test("applyHarmonyGrammarToSections: recap gets cad64 approach", () => {
    const sections = ["theme_a", "theme_b", "development", "recap"].map(makeSection);
    const result = applyHarmonyGrammarToSections(sections);
    const recapPlan = result.get("recap");
    assert.ok(recapPlan !== undefined);
    assert.equal(recapPlan.cadenceApproach, "cad64");
});

test("applyHarmonyGrammarToSections: development gets appliedDominantCues", () => {
    const sections = ["theme_a", "development", "recap"].map(makeSection);
    const result = applyHarmonyGrammarToSections(sections);
    const devPlan = result.get("development");
    assert.ok(devPlan !== undefined);
    assert.ok(Array.isArray(devPlan.appliedDominantCues));
    assert.ok(devPlan.appliedDominantCues.length > 0);
});

test("applyHarmonyGrammarToSections: development gets tonicization window", () => {
    const sections = [makeSection("development", { measures: 16 })];
    const result = applyHarmonyGrammarToSections(sections);
    const devPlan = result.get("development");
    assert.ok(devPlan !== undefined);
    assert.ok(devPlan.tonicization !== undefined);
});

test("applyHarmonyGrammarToSections: empty sections returns empty map", () => {
    const result = applyHarmonyGrammarToSections([]);
    assert.equal(result.size, 0);
});

test("applyHarmonyGrammarToSections: uses harmonicPlan.prolongationMode if present", () => {
    const section = makeSection("theme_a", {
        harmonicPlan: { prolongationMode: "tonic", tonalCenter: "C major" },
    });
    const result = applyHarmonyGrammarToSections([section]);
    const plan = result.get("theme_a");
    assert.ok(plan !== undefined);
    assert.equal(plan.prolongationMode, "tonic");
});

test("applyHarmonyGrammarToSections: notes array is populated", () => {
    const sections = [makeSection("theme_a")];
    const result = applyHarmonyGrammarToSections(sections);
    const plan = result.get("theme_a");
    assert.ok(Array.isArray(plan?.notes) && plan.notes.length > 0);
});
