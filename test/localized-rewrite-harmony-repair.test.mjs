/**
 * localized-rewrite-harmony-repair.test.mjs
 *
 * Tests for buildHarmonyContractRevisionDirectives() —
 * verifies that harmony contract violations are converted to the correct
 * pipeline RevisionDirective kind/priority/sectionIds shape consumed by
 * the localized rewrite loop.
 *
 * LRH-01: missing cadenceApproach → kind "strengthen_cadence", sectionIds set
 * LRH-02: missing tonicizationWindows → kind "enforce_tonicization_window", sectionIds set
 * LRH-03: missing harmonicColorCues → kind "clarify_harmonic_color"
 * LRH-04: missing harmonicRealizationSummary → kind "regenerate_harmony_realization"
 * LRH-05: missing prolongationMode → kind "enforce_prolongation_mode"
 * LRH-06: no violations → empty array
 * LRH-07: required violations get higher priority than conditional
 * LRH-08: multi-section → one directive per violation, each with correct sectionIds
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildHarmonyContractRevisionDirectives } from "../dist/core/evaluate/harmonyRealizationContract.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeArtifact(sectionId, role, overrides = {}) {
    return { sectionId, role, ...overrides };
}

function makePlan(sections) {
    return { sections };
}

function makePlanSection(id, harmonyGrammar = {}) {
    return { id, harmonyGrammar };
}

// ─── LRH-01: missing cadenceApproach → strengthen_cadence branch ─────────────

test("LRH-01: missing cadenceApproach produces strengthen_cadence RevisionDirective with sectionIds", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        // cadenceApproach absent
        harmonicColorCues: [{ cue: "V7" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1")]);

    const directives = buildHarmonyContractRevisionDirectives([artifact], plan);

    assert.equal(directives.length, 1);
    const d = directives[0];
    assert.equal(d.kind, "strengthen_cadence");
    assert.deepEqual(d.sectionIds, ["s1"]);
    assert.ok(typeof d.priority === "number" && d.priority > 0, "priority should be positive");
    assert.ok(d.reason.length > 0, "reason should be non-empty");
});

// ─── LRH-02: missing tonicizationWindows → enforce_tonicization_window branch ─

test("LRH-02: missing tonicizationWindows (conditional) produces enforce_tonicization_window RevisionDirective", () => {
    const artifact = makeArtifact("s2", "development", {
        cadenceApproach: "dominant",
        harmonicColorCues: [{ cue: "V/vi" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
        // tonicizationWindows absent; plan requests tonicization
    });
    const section = makePlanSection("s2", {
        tonicization: { keyTarget: "a", degree: "vi" },
    });
    const plan = makePlan([section]);

    const directives = buildHarmonyContractRevisionDirectives([artifact], plan);

    assert.equal(directives.length, 1);
    const d = directives[0];
    assert.equal(d.kind, "enforce_tonicization_window");
    assert.deepEqual(d.sectionIds, ["s2"]);
});

// ─── LRH-03: missing harmonicColorCues → clarify_harmonic_color ──────────────

test("LRH-03: missing harmonicColorCues produces clarify_harmonic_color RevisionDirective", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        cadenceApproach: "dominant",
        harmonicColorCues: [],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1")]);

    const directives = buildHarmonyContractRevisionDirectives([artifact], plan);

    assert.equal(directives.length, 1);
    assert.equal(directives[0].kind, "clarify_harmonic_color");
    assert.deepEqual(directives[0].sectionIds, ["s1"]);
});

// ─── LRH-04: missing harmonicRealizationSummary → regenerate_harmony_realization

test("LRH-04: missing harmonicRealizationSummary produces regenerate_harmony_realization RevisionDirective", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        cadenceApproach: "dominant",
        harmonicColorCues: [{ cue: "V7" }],
        // harmonicRealizationSummary absent
    });
    const plan = makePlan([makePlanSection("s1")]);

    const directives = buildHarmonyContractRevisionDirectives([artifact], plan);

    assert.equal(directives.length, 1);
    assert.equal(directives[0].kind, "regenerate_harmony_realization");
    assert.deepEqual(directives[0].sectionIds, ["s1"]);
});

// ─── LRH-05: missing prolongationMode → enforce_prolongation_mode ─────────────

test("LRH-05: missing prolongationMode (conditional) produces enforce_prolongation_mode RevisionDirective", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        cadenceApproach: "dominant",
        harmonicColorCues: [{ cue: "I" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
        // prolongationMode absent; plan specifies it
    });
    const section = makePlanSection("s1", { prolongationMode: "tonic" });
    const plan = makePlan([section]);

    const directives = buildHarmonyContractRevisionDirectives([artifact], plan);

    assert.equal(directives.length, 1);
    assert.equal(directives[0].kind, "enforce_prolongation_mode");
    assert.deepEqual(directives[0].sectionIds, ["s1"]);
});

// ─── LRH-06: no violations → empty array ─────────────────────────────────────

test("LRH-06: no contract violations returns empty array", () => {
    const artifact = makeArtifact("s1", "theme_a", {
        cadenceApproach: "dominant",
        harmonicColorCues: [{ cue: "V7" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1")]);

    const directives = buildHarmonyContractRevisionDirectives([artifact], plan);

    assert.deepEqual(directives, []);
});

// ─── LRH-07: required violations get higher priority than conditional ─────────

test("LRH-07: required violation priority > conditional violation priority", () => {
    const artifact = makeArtifact("s1", "development", {
        // missing cadenceApproach (required)
        harmonicColorCues: [{ cue: "V7" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
        // tonicizationWindows absent (conditional)
    });
    const section = makePlanSection("s1", {
        tonicization: { keyTarget: "a", degree: "vi" },
    });
    const plan = makePlan([section]);

    const directives = buildHarmonyContractRevisionDirectives([artifact], plan);

    assert.equal(directives.length, 2);
    const required = directives.find((d) => d.kind === "strengthen_cadence");
    const conditional = directives.find((d) => d.kind === "enforce_tonicization_window");
    assert.ok(required, "Expected strengthen_cadence directive");
    assert.ok(conditional, "Expected enforce_tonicization_window directive");
    assert.ok(required.priority > conditional.priority,
        `Required priority (${required.priority}) should exceed conditional (${conditional.priority})`);
});

// ─── LRH-08: multi-section → correct sectionIds per directive ────────────────

test("LRH-08: multi-section violations each carry correct sectionIds", () => {
    const s1 = makeArtifact("s1", "theme_a", {
        // missing cadenceApproach
        harmonicColorCues: [{ cue: "V7" }],
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const s2 = makeArtifact("s2", "bridge", {
        cadenceApproach: "half",
        harmonicColorCues: [],  // missing
        harmonicRealizationSummary: { key: "C", mode: "major" },
    });
    const plan = makePlan([makePlanSection("s1"), makePlanSection("s2")]);

    const directives = buildHarmonyContractRevisionDirectives([s1, s2], plan);

    assert.equal(directives.length, 2);

    const s1Dir = directives.find((d) => d.sectionIds?.includes("s1"));
    const s2Dir = directives.find((d) => d.sectionIds?.includes("s2"));

    assert.ok(s1Dir, "Expected directive scoped to s1");
    assert.equal(s1Dir.kind, "strengthen_cadence");

    assert.ok(s2Dir, "Expected directive scoped to s2");
    assert.equal(s2Dir.kind, "clarify_harmonic_color");
});
