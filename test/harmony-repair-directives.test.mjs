/**
 * harmony-repair-directives.test.mjs
 *
 * Tests for buildHarmonyRepairDirectives() — HRC-01..HRC-08.
 *
 * HRC-01: empty report → no directives
 * HRC-02: single required violation (cadenceApproach) → strengthen_cadence
 * HRC-03: single required violation (harmonicColorCues) → clarify_harmonic_color
 * HRC-04: single required violation (harmonicRealizationSummary) → regenerate_harmony_realization
 * HRC-05: conditional violation (tonicizationWindows) → enforce_tonicization_window
 * HRC-06: conditional violation (prolongationMode) → enforce_prolongation_mode
 * HRC-07: required violations appear before conditional in output order
 * HRC-08: full multi-section report → all fields map to correct actions
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildHarmonyRepairDirectives,
    checkHarmonyRealizationContract,
} from "../dist/core/evaluate/harmonyRealizationContract.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeArtifact(sectionId, role, overrides = {}) {
    return { sectionId, role, ...overrides };
}

function makePlan(sections) {
    return { sections };
}

function makePlanSection(id, harmonyGrammar = {}) {
    return { id, harmonyGrammar };
}

// ─── HRC-01: no violations → empty directives ─────────────────────────────────

test("HRC-01: buildHarmonyRepairDirectives returns [] when no violations", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        cadenceApproach: "dominant",
        harmonicColorCues: [{ cue: "ii65" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1")]);
    const report = checkHarmonyRealizationContract([artifact], plan);
    const directives = buildHarmonyRepairDirectives(report);
    assert.deepEqual(directives, []);
});

// ─── HRC-02: missing cadenceApproach → strengthen_cadence ────────────────────

test("HRC-02: missing cadenceApproach → action strengthen_cadence", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        // cadenceApproach absent
        harmonicColorCues: [{ cue: "V7" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1")]);
    const report = checkHarmonyRealizationContract([artifact], plan);
    const directives = buildHarmonyRepairDirectives(report);

    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "strengthen_cadence");
    assert.equal(directives[0].field, "cadenceApproach");
    assert.equal(directives[0].severity, "required");
    assert.equal(directives[0].sectionId, "s1");
});

// ─── HRC-03: missing harmonicColorCues → clarify_harmonic_color ──────────────

test("HRC-03: missing harmonicColorCues → action clarify_harmonic_color", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        cadenceApproach: "dominant",
        // harmonicColorCues absent / empty
        harmonicColorCues: [],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1")]);
    const report = checkHarmonyRealizationContract([artifact], plan);
    const directives = buildHarmonyRepairDirectives(report);

    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "clarify_harmonic_color");
    assert.equal(directives[0].field, "harmonicColorCues");
    assert.equal(directives[0].severity, "required");
});

// ─── HRC-04: missing harmonicRealizationSummary → regenerate_harmony_realization

test("HRC-04: missing harmonicRealizationSummary → action regenerate_harmony_realization", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        cadenceApproach: "dominant",
        harmonicColorCues: [{ cue: "V7" }],
        // harmonicRealizationSummary absent
    });
    const plan = makePlan([makePlanSection("s1")]);
    const report = checkHarmonyRealizationContract([artifact], plan);
    const directives = buildHarmonyRepairDirectives(report);

    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "regenerate_harmony_realization");
    assert.equal(directives[0].field, "harmonicRealizationSummary");
    assert.equal(directives[0].severity, "required");
});

// ─── HRC-05: missing tonicizationWindows → enforce_tonicization_window ────────

test("HRC-05: missing tonicizationWindows (conditional) → enforce_tonicization_window", () => {
    const artifact = makeArtifact("s1", "development", {
        cadenceApproach: "dominant",
        harmonicColorCues: [{ cue: "V/vi" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
        // tonicizationWindows absent but plan requests tonicization
    });
    const section = makePlanSection("s1", {
        tonicization: { keyTarget: "a", degree: "vi" },
    });
    const plan = makePlan([section]);
    const report = checkHarmonyRealizationContract([artifact], plan);
    const directives = buildHarmonyRepairDirectives(report);

    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "enforce_tonicization_window");
    assert.equal(directives[0].field, "tonicizationWindows");
    assert.equal(directives[0].severity, "conditional");
});

// ─── HRC-06: missing prolongationMode → enforce_prolongation_mode ─────────────

test("HRC-06: missing prolongationMode (conditional) → enforce_prolongation_mode", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        cadenceApproach: "dominant",
        harmonicColorCues: [{ cue: "I" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
        // prolongationMode absent but plan specifies it
    });
    const section = makePlanSection("s1", { prolongationMode: "tonic" });
    const plan = makePlan([section]);
    const report = checkHarmonyRealizationContract([artifact], plan);
    const directives = buildHarmonyRepairDirectives(report);

    assert.equal(directives.length, 1);
    assert.equal(directives[0].action, "enforce_prolongation_mode");
    assert.equal(directives[0].field, "prolongationMode");
    assert.equal(directives[0].severity, "conditional");
});

// ─── HRC-07: required before conditional in output order ─────────────────────

test("HRC-07: required directives appear before conditional ones in output", () => {
    // Section has a conditional plan field (tonicization) AND is missing all
    // three required fields.  Output must list required actions first.
    const artifact = makeArtifact("s1", "development", {
        // all required fields absent
        harmonicColorCues: [],
        // tonicizationWindows also absent (conditional violation)
    });
    const section = makePlanSection("s1", {
        tonicization: { keyTarget: "a", degree: "vi" },
    });
    const plan = makePlan([section]);
    const report = checkHarmonyRealizationContract([artifact], plan);
    const directives = buildHarmonyRepairDirectives(report);

    // 3 required + 1 conditional = 4 directives
    assert.equal(directives.length, 4, `Expected 4 directives, got ${directives.length}`);

    const requiredDirectives  = directives.filter(d => d.severity === "required");
    const conditionalDirectives = directives.filter(d => d.severity === "conditional");
    assert.equal(requiredDirectives.length, 3);
    assert.equal(conditionalDirectives.length, 1);

    // All required come before any conditional in the array
    const lastRequiredIdx   = directives.findLastIndex(d => d.severity === "required");
    const firstConditionalIdx = directives.findIndex(d => d.severity === "conditional");
    assert.ok(
        lastRequiredIdx < firstConditionalIdx,
        `Required directives must precede conditional: lastRequired=${lastRequiredIdx}, firstConditional=${firstConditionalIdx}`,
    );
});

// ─── HRC-08: multi-section → all actions mapped correctly ────────────────────

test("HRC-08: multi-section report produces directives for every violation", () => {
    const s1 = makeArtifact("s1", "theme_a", {
        // missing cadenceApproach
        harmonicColorCues: [{ cue: "V7" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const s2 = makeArtifact("s2", "bridge", {
        cadenceApproach: "half",
        // missing harmonicColorCues
        harmonicColorCues: [],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1"), makePlanSection("s2")]);
    const report = checkHarmonyRealizationContract([s1, s2], plan);
    const directives = buildHarmonyRepairDirectives(report);

    // One violation per section
    assert.equal(directives.length, 2);

    const s1Dir = directives.find(d => d.sectionId === "s1");
    const s2Dir = directives.find(d => d.sectionId === "s2");

    assert.ok(s1Dir, "Expected directive for s1");
    assert.equal(s1Dir.action, "strengthen_cadence");

    assert.ok(s2Dir, "Expected directive for s2");
    assert.equal(s2Dir.action, "clarify_harmonic_color");
});
