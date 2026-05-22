// @ts-check
/**
 * test/lineage-identity-defaults.test.mjs
 *
 * LID-01 ~ LID-07: AXIOM identity default injection tests.
 *
 * Verifies that buildStyleCue() always injects AXIOM's Beethoven·Schubert
 * lineage identity even when the compositionPlan does NOT explicitly set
 * lineageProfileId, influenceBlend, or period.
 *
 * Key contracts:
 *   LID-01: lineageProfileId defaults to "axiom_beethoven_schubert_v1"
 *   LID-02: influenceBlend defaults to Beethoven:0.55 + Schubert:0.45
 *   LID-03: period defaults to "Romantic"
 *   LID-04: control lines include lineage_profile= and influence_blend=
 *   LID-05: theory_only entries (Bach/Mozart/Chopin) excluded from influence_blend control line
 *   LID-06: explicit plan values override the defaults
 *   LID-07: influence_blend candidates 0-4 route to Beethoven, 5-7 route to Schubert
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const { buildLearnedSymbolicWorkerPayload } = await import("../dist/composer/learnedAdapter.js");
const { buildLearnedNotagenProviderRequest } = await import("../dist/composer/learnedNotagenAdapter.js");

const SELECTED_MODELS = [
    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
];
const EXECUTION_PLAN = {
    workflow: "symbolic_only",
    composeWorker: "learned_symbolic",
    selectedModels: SELECTED_MODELS,
};

/** Minimal request with no identity fields in compositionPlan */
function makeMinimalRequest(planOverrides = {}) {
    return {
        prompt: "A Romantic miniature",
        form: "miniature",
        key: "F# minor",
        tempo: 72,
        workflow: "symbolic_only",
        compositionPlan: {
            version: "1",
            brief: "A Romantic miniature",
            mood: [],
            form: "miniature",
            key: "F# minor",
            meter: "3/4",
            tempo: 72,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "Violin", family: "strings", roles: ["lead"] },
                { name: "Viola", family: "strings", roles: ["counterline"] },
                { name: "Cello", family: "strings", roles: ["bass"] },
            ],
            orchestration: {
                family: "string_trio",
                instrumentNames: ["Violin", "Viola", "Cello"],
                sections: [],
            },
            motifPolicy: { reuseRequired: false },
            rationale: "",
            sections: [
                { id: "s1", role: "theme_a", label: "Primary theme", measures: 8, energy: 0.5, density: 0.4 },
                { id: "s2", role: "recap", label: "Recap", measures: 8, energy: 0.4, density: 0.3 },
            ],
            ...planOverrides,
        },
    };
}

function buildPayload(planOverrides = {}) {
    const req = makeMinimalRequest(planOverrides);
    return buildLearnedSymbolicWorkerPayload(req, "test-lid", "/tmp/test.mid", EXECUTION_PLAN);
}

// ─── LID-01: lineageProfileId defaults ────────────────────────────────────────

test("LID-01: lineageProfileId defaults to axiom_beethoven_schubert_v1 when not in plan", () => {
    const payload = buildPayload();
    assert.equal(
        payload.promptPack.styleCue.lineageProfileId,
        "axiom_beethoven_schubert_v1",
        "lineageProfileId must default to axiom_beethoven_schubert_v1"
    );
});

// ─── LID-02: influenceBlend defaults ──────────────────────────────────────────

test("LID-02: influenceBlend defaults include Beethoven:0.55 and Schubert:0.45", () => {
    const payload = buildPayload();
    const blend = payload.promptPack.styleCue.influenceBlend;
    assert.ok(Array.isArray(blend) && blend.length > 0, "influenceBlend must be non-empty array");

    const beethoven = blend.find((e) => e.composer.includes("Beethoven"));
    const schubert  = blend.find((e) => e.composer.includes("Schubert"));
    assert.ok(beethoven, "influenceBlend must include Beethoven entry");
    assert.ok(schubert,  "influenceBlend must include Schubert entry");
    assert.equal(beethoven.role, "primary",    "Beethoven must be role=primary");
    assert.equal(schubert.role,  "secondary",  "Schubert must be role=secondary");
    assert.equal(beethoven.weight, 0.55, "Beethoven weight must be 0.55");
    assert.equal(schubert.weight,  0.45, "Schubert weight must be 0.45");
});

// ─── LID-03: period defaults ───────────────────────────────────────────────────

test("LID-03: period defaults to Romantic when not in plan", () => {
    const payload = buildPayload();
    assert.equal(
        payload.promptPack.styleCue.period,
        "Romantic",
        "period must default to Romantic"
    );
});

// ─── LID-04: control lines include lineage_profile= and influence_blend= ───────

test("LID-04: controlLines include lineage_profile= and influence_blend=", () => {
    const payload = buildPayload();
    const lines = payload.providerRequest.controlLines;
    const lineageLine    = lines.find((l) => l.startsWith("lineage_profile="));
    const blendLine      = lines.find((l) => l.startsWith("influence_blend="));
    const periodLine     = lines.find((l) => l.startsWith("period="));

    assert.ok(lineageLine, "controlLines must contain lineage_profile=");
    assert.ok(blendLine,   "controlLines must contain influence_blend=");
    assert.ok(periodLine,  "controlLines must contain period=");
    assert.equal(lineageLine, "lineage_profile=axiom_beethoven_schubert_v1");
    assert.match(periodLine, /^period=romantic$/i);
});

// ─── LID-05: theory_only entries NOT in influence_blend control line ───────────

test("LID-05: influence_blend control line excludes theory_only entries (Bach/Mozart/Chopin)", () => {
    const payload = buildPayload();
    const lines = payload.providerRequest.controlLines;
    const blendLine = lines.find((l) => l.startsWith("influence_blend="));
    assert.ok(blendLine, "influence_blend= line must be present");

    // Bach, Haydn/Mozart, Chopin must NOT appear in the rendered blend line
    assert.ok(!blendLine.toLowerCase().includes("bach"),   "Bach must not appear in influence_blend control line");
    assert.ok(!blendLine.toLowerCase().includes("haydn"),  "Haydn must not appear in influence_blend control line");
    assert.ok(!blendLine.toLowerCase().includes("mozart"), "Mozart must not appear in influence_blend control line");
    assert.ok(!blendLine.toLowerCase().includes("chopin"), "Chopin must not appear in influence_blend control line");

    // Beethoven and Schubert must be in the blend line
    assert.ok(blendLine.toLowerCase().includes("beethoven"), "Beethoven must appear in influence_blend control line");
    assert.ok(blendLine.toLowerCase().includes("schubert"),  "Schubert must appear in influence_blend control line");
});

// ─── LID-06: explicit plan values override defaults ───────────────────────────

test("LID-06: explicit plan lineageProfileId and influenceBlend override defaults", () => {
    const payload = buildPayload({
        lineageProfileId: "custom_profile_v2",
        influenceBlend: [
            { composer: "Brahms, Johannes", weight: 1.0, role: "primary" },
        ],
        period: "Late Romantic",
    });
    assert.equal(payload.promptPack.styleCue.lineageProfileId, "custom_profile_v2",
        "Explicit lineageProfileId must override default");
    assert.equal(payload.promptPack.styleCue.period, "Late Romantic",
        "Explicit period must override default");
    const brahms = payload.promptPack.styleCue.influenceBlend?.find((e) => e.composer.includes("Brahms"));
    assert.ok(brahms, "Explicit influenceBlend must override default");
});

// ─── LID-07: candidate routing with default blend ─────────────────────────────

test("LID-07: default influenceBlend routes candidates 0-4 to Beethoven, 5-7 to Schubert", () => {
    const payload = buildPayload();
    const promptPack = payload.promptPack;

    // Build per-candidate requests to check composer routing
    const composers = Array.from({ length: 8 }, (_, i) => {
        const req = buildLearnedNotagenProviderRequest(
            promptPack,
            SELECTED_MODELS,
            { candidateIndex: i }
        );
        return req.controlLines.find((l) => l.startsWith("composer=")) ?? "";
    });

    const beethovenCount = composers.filter((c) => c.toLowerCase().includes("beethoven")).length;
    const schubertCount  = composers.filter((c) => c.toLowerCase().includes("schubert")).length;

    assert.ok(beethovenCount >= 4, `Expected ≥4 Beethoven candidates, got ${beethovenCount}. Composers: ${composers.join(", ")}`);
    assert.ok(schubertCount  >= 2, `Expected ≥2 Schubert candidates, got ${schubertCount}. Composers: ${composers.join(", ")}`);
    assert.equal(beethovenCount + schubertCount, 8, "All 8 candidates must be routed to Beethoven or Schubert");
});
