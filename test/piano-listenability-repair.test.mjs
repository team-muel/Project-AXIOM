/**
 * piano-listenability-repair.test.mjs
 *
 * Validates the PianoCraftScoreSummary → PianoRevisionDirective[] conversion via
 * buildPianoListenabilityRepairDirectives().
 *
 * PLR-01: low melodyProminenceScore → clarify_right_hand_melody directive
 * PLR-02: low bassRootSupportScore → strengthen_left_hand_bass directive
 * PLR-03: low accompanimentPatternCoherence → increase_accompaniment_consistency directive
 * PLR-04: low pedalBlurRisk (high blur) → improve_pedal_changes directive
 * PLR-05: all dimensions pass → empty directive list
 * PLR-06: multiple failures → all corresponding directives, sorted by priority
 * PLR-07: low pianoListenabilityScore (overall) → make_texture_more_pianistic directive
 * PLR-08: custom thresholds are respected
 */

import test from "node:test";
import assert from "node:assert/strict";
import { runNodeEval } from "./helpers/subprocess.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(repoRoot, "dist");

// ─── Shared helper ────────────────────────────────────────────────────────────

function makeScore(overrides = {}) {
    return {
        handPlayability: 0.9,
        melodicClarity: 0.8,
        bassCoherence: 0.8,
        voicingIdiomaticFit: 0.8,
        accompanimentPatternCoherence: 0.8,
        registerSpacing: 0.8,
        handIndependence: 0.8,
        pedalPlausibility: 0.8,
        difficultyFit: 0.8,
        finalPianoScore: 0.82,
        // supplementary listenability fields
        melodyProminenceScore: 0.8,
        pedalBlurRisk: 0.8,
        bassRootSupportScore: 0.8,
        pianoListenabilityScore: 0.8,
        ...overrides,
    };
}

// ─── PLR-01 ───────────────────────────────────────────────────────────────────

test("PLR-01: low melodyProminenceScore → clarify_right_hand_melody", async () => {
    const score = makeScore({ melodyProminenceScore: 0.3 });
    const { stdout } = await runNodeEval(`
        const { buildPianoListenabilityRepairDirectives } = await import("./core/evaluate/pianoListenabilityRepair.js");
        const directives = buildPianoListenabilityRepairDirectives(${JSON.stringify(score)});
        console.log(JSON.stringify({ directives }));
    `, { cwd: distDir });
    const { directives } = JSON.parse(stdout);
    const kinds = directives.map((d) => d.kind);
    assert.ok(kinds.includes("clarify_right_hand_melody"), "should include clarify_right_hand_melody");
});

// ─── PLR-02 ───────────────────────────────────────────────────────────────────

test("PLR-02: low bassRootSupportScore → strengthen_left_hand_bass", async () => {
    const score = makeScore({ bassRootSupportScore: 0.2 });
    const { stdout } = await runNodeEval(`
        const { buildPianoListenabilityRepairDirectives } = await import("./core/evaluate/pianoListenabilityRepair.js");
        const directives = buildPianoListenabilityRepairDirectives(${JSON.stringify(score)});
        console.log(JSON.stringify({ directives }));
    `, { cwd: distDir });
    const { directives } = JSON.parse(stdout);
    const kinds = directives.map((d) => d.kind);
    assert.ok(kinds.includes("strengthen_left_hand_bass"), "should include strengthen_left_hand_bass");
});

// ─── PLR-03 ───────────────────────────────────────────────────────────────────

test("PLR-03: low accompanimentPatternCoherence → increase_accompaniment_consistency", async () => {
    const score = makeScore({ accompanimentPatternCoherence: 0.2 });
    const { stdout } = await runNodeEval(`
        const { buildPianoListenabilityRepairDirectives } = await import("./core/evaluate/pianoListenabilityRepair.js");
        const directives = buildPianoListenabilityRepairDirectives(${JSON.stringify(score)});
        console.log(JSON.stringify({ directives }));
    `, { cwd: distDir });
    const { directives } = JSON.parse(stdout);
    const kinds = directives.map((d) => d.kind);
    assert.ok(kinds.includes("increase_accompaniment_consistency"), "should include increase_accompaniment_consistency");
});

// ─── PLR-04 ───────────────────────────────────────────────────────────────────

test("PLR-04: low pedalBlurRisk (high blur) → improve_pedal_changes", async () => {
    const score = makeScore({ pedalBlurRisk: 0.2 });
    const { stdout } = await runNodeEval(`
        const { buildPianoListenabilityRepairDirectives } = await import("./core/evaluate/pianoListenabilityRepair.js");
        const directives = buildPianoListenabilityRepairDirectives(${JSON.stringify(score)});
        console.log(JSON.stringify({ directives }));
    `, { cwd: distDir });
    const { directives } = JSON.parse(stdout);
    const kinds = directives.map((d) => d.kind);
    assert.ok(kinds.includes("improve_pedal_changes"), "should include improve_pedal_changes");
});

// ─── PLR-05 ───────────────────────────────────────────────────────────────────

test("PLR-05: all dimensions pass → empty directive list", async () => {
    const score = makeScore(); // all defaults above thresholds
    const { stdout } = await runNodeEval(`
        const { buildPianoListenabilityRepairDirectives } = await import("./core/evaluate/pianoListenabilityRepair.js");
        const directives = buildPianoListenabilityRepairDirectives(${JSON.stringify(score)});
        console.log(JSON.stringify({ directives }));
    `, { cwd: distDir });
    const { directives } = JSON.parse(stdout);
    assert.strictEqual(directives.length, 0, "should return empty array when all pass");
});

// ─── PLR-06 ───────────────────────────────────────────────────────────────────

test("PLR-06: multiple failures → all directives sorted by priority", async () => {
    const score = makeScore({ melodyProminenceScore: 0.2, bassRootSupportScore: 0.1, pedalBlurRisk: 0.1 });
    const { stdout } = await runNodeEval(`
        const { buildPianoListenabilityRepairDirectives } = await import("./core/evaluate/pianoListenabilityRepair.js");
        const directives = buildPianoListenabilityRepairDirectives(${JSON.stringify(score)});
        console.log(JSON.stringify({ directives }));
    `, { cwd: distDir });
    const { directives } = JSON.parse(stdout);
    assert.ok(directives.length >= 3, "should return at least 3 directives");
    for (let i = 1; i < directives.length; i++) {
        assert.ok(
            directives[i - 1].priority <= directives[i].priority,
            `directives should be sorted by ascending priority (index ${i})`,
        );
    }
});

// ─── PLR-07 ───────────────────────────────────────────────────────────────────

test("PLR-07: low pianoListenabilityScore → make_texture_more_pianistic", async () => {
    const score = makeScore({ pianoListenabilityScore: 0.4 });
    const { stdout } = await runNodeEval(`
        const { buildPianoListenabilityRepairDirectives } = await import("./core/evaluate/pianoListenabilityRepair.js");
        const directives = buildPianoListenabilityRepairDirectives(${JSON.stringify(score)});
        console.log(JSON.stringify({ directives }));
    `, { cwd: distDir });
    const { directives } = JSON.parse(stdout);
    const kinds = directives.map((d) => d.kind);
    assert.ok(kinds.includes("make_texture_more_pianistic"), "should include make_texture_more_pianistic");
});

// ─── PLR-08 ───────────────────────────────────────────────────────────────────

test("PLR-08: custom thresholds are respected", async () => {
    // Score that passes default thresholds but fails custom high thresholds
    const score = makeScore({ melodyProminenceScore: 0.6 }); // passes default 0.5 but fails custom 0.7
    const customThresholds = {
        melodyProminence: 0.7,
        bassRootSupport: 0.5,
        accompanimentCoherence: 0.5,
        pedalBlurRisk: 0.5,
        overallListenability: 0.55,
    };
    const { stdout } = await runNodeEval(`
        const { buildPianoListenabilityRepairDirectives } = await import("./core/evaluate/pianoListenabilityRepair.js");
        const directives = buildPianoListenabilityRepairDirectives(
            ${JSON.stringify(score)},
            ${JSON.stringify(customThresholds)},
        );
        console.log(JSON.stringify({ directives }));
    `, { cwd: distDir });
    const { directives } = JSON.parse(stdout);
    const kinds = directives.map((d) => d.kind);
    assert.ok(kinds.includes("clarify_right_hand_melody"), "custom threshold should trigger directive");
});
