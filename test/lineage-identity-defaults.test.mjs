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

// ─── LID-07: candidate routing with default blend (pool=8) ───────────────────

test("LID-07: default influenceBlend routes candidates 0-4 to Beethoven, 5-7 to Schubert (pool=8)", () => {
    const payload = buildPayload();
    const promptPack = payload.promptPack;

    // Build per-candidate requests to check composer routing
    const composers = Array.from({ length: 8 }, (_, i) => {
        const req = buildLearnedNotagenProviderRequest(
            promptPack,
            SELECTED_MODELS,
            { candidateIndex: i, candidatePoolSize: 8 }
        );
        return req.controlLines.find((l) => l.startsWith("composer=")) ?? "";
    });

    const beethovenCount = composers.filter((c) => c.toLowerCase().includes("beethoven")).length;
    const schubertCount  = composers.filter((c) => c.toLowerCase().includes("schubert")).length;

    assert.ok(beethovenCount >= 4, `Expected ≥4 Beethoven candidates, got ${beethovenCount}. Composers: ${composers.join(", ")}`);
    assert.ok(schubertCount  >= 2, `Expected ≥2 Schubert candidates, got ${schubertCount}. Composers: ${composers.join(", ")}`);
    assert.equal(beethovenCount + schubertCount, 8, "All 8 candidates must be routed to Beethoven or Schubert");
});

// ─── LID-08: pool=16 routing ──────────────────────────────────────────────────

test("LID-08: pool=16 routes 9 candidates to Beethoven and 7 to Schubert", () => {
    const payload = buildPayload();
    const promptPack = payload.promptPack;

    const composers = Array.from({ length: 16 }, (_, i) => {
        const req = buildLearnedNotagenProviderRequest(
            promptPack,
            SELECTED_MODELS,
            { candidateIndex: i, candidatePoolSize: 16 }
        );
        return req.controlLines.find((l) => l.startsWith("composer=")) ?? "";
    });

    const beethovenCount = composers.filter((c) => c.toLowerCase().includes("beethoven")).length;
    const schubertCount  = composers.filter((c) => c.toLowerCase().includes("schubert")).length;

    // floor(0.55*16)=8, remainder=16-8-7=1 → beethoven gets +1 → 9
    assert.equal(beethovenCount, 9, `Expected 9 Beethoven for pool=16, got ${beethovenCount}. ${composers.join(", ")}`);
    assert.equal(schubertCount,  7, `Expected 7 Schubert for pool=16, got ${schubertCount}`);
    assert.equal(beethovenCount + schubertCount, 16, "All 16 candidates must be routed");
});

// ─── LID-09: pool=32 routing ──────────────────────────────────────────────────

test("LID-09: pool=32 routes 18 candidates to Beethoven and 14 to Schubert", () => {
    const payload = buildPayload();
    const promptPack = payload.promptPack;

    const composers = Array.from({ length: 32 }, (_, i) => {
        const req = buildLearnedNotagenProviderRequest(
            promptPack,
            SELECTED_MODELS,
            { candidateIndex: i, candidatePoolSize: 32 }
        );
        return req.controlLines.find((l) => l.startsWith("composer=")) ?? "";
    });

    const beethovenCount = composers.filter((c) => c.toLowerCase().includes("beethoven")).length;
    const schubertCount  = composers.filter((c) => c.toLowerCase().includes("schubert")).length;

    // floor(0.55*32)=17, floor(0.45*32)=14, remainder=32-17-14=1 → beethoven +1 → 18
    assert.equal(beethovenCount, 18, `Expected 18 Beethoven for pool=32, got ${beethovenCount}`);
    assert.equal(schubertCount,  14, `Expected 14 Schubert for pool=32, got ${schubertCount}`);
    assert.equal(beethovenCount + schubertCount, 32, "All 32 candidates must be routed");
});

// ─── CRM-01: lineage_only + Mozart override → warning + lineage fallback ────────

test("CRM-01: lineage_only mode rejects Mozart override, emits warning, falls back to lineage", () => {
    const payload = buildPayload({ composerRoutingMode: "lineage_only", composer: "Mozart, Wolfgang Amadeus" });
    const promptPack = payload.promptPack;
    // styleCue should carry the composer field (plan value)
    assert.equal(promptPack.styleCue.composerRoutingMode, "lineage_only");

    const req = buildLearnedNotagenProviderRequest(promptPack, SELECTED_MODELS, { candidateIndex: 0 });

    // Warning must be emitted
    assert.ok(
        Array.isArray(req.warnings) && req.warnings.some((w) => w.includes("Mozart") && w.includes("lineage")),
        `Expected lineage warning for Mozart in lineage_only mode. Got warnings: ${JSON.stringify(req.warnings)}`
    );

    // Composer must be Beethoven or Schubert (lineage fallback)
    const composerLine = req.controlLines.find((l) => l.startsWith("composer=")) ?? "";
    const isLineage = composerLine.toLowerCase().includes("beethoven") || composerLine.toLowerCase().includes("schubert");
    assert.ok(isLineage, `Expected Beethoven or Schubert lineage fallback, got: "${composerLine}"`);

    // composerRoutingMode should NOT be marked in output for non-default identity_default
    // (lineage_only is the default, so it's suppressed)
    assert.equal(req.composerRoutingMode, undefined, "lineage_only mode must not add composerRoutingMode to output");
});

// ─── CRM-02: explicit_experimental + Mozart override → allowed + flagged ────────

test("CRM-02: explicit_experimental mode allows Mozart override and flags the request", () => {
    const payload = buildPayload({ composerRoutingMode: "explicit_experimental", composer: "Mozart, Wolfgang Amadeus" });
    const promptPack = payload.promptPack;

    const req = buildLearnedNotagenProviderRequest(promptPack, SELECTED_MODELS, { candidateIndex: 0 });

    // Composer must be Mozart (explicit override honored)
    const composerLine = req.controlLines.find((l) => l.startsWith("composer=")) ?? "";
    assert.ok(composerLine.toLowerCase().includes("mozart"), `Expected Mozart in composer line, got: "${composerLine}"`);

    // No lineage warning expected
    const lineageWarning = req.warnings?.some((w) => w.includes("lineage")) ?? false;
    assert.equal(lineageWarning, false, "No lineage warning expected for explicit_experimental mode");

    // composerRoutingMode must be marked in output so SFT/DPO gate can filter it
    assert.equal(req.composerRoutingMode, "explicit_experimental",
        "explicit_experimental must be surfaced in output for SFT/DPO gate");
});

// ─── CRM-03: identity_default + Mozart override → warning + lineage fallback ────

test("CRM-03: identity_default mode rejects Mozart override with warning and falls back to lineage", () => {
    const payload = buildPayload({ composerRoutingMode: "identity_default", composer: "Mozart, Wolfgang Amadeus" });
    const promptPack = payload.promptPack;

    const req = buildLearnedNotagenProviderRequest(promptPack, SELECTED_MODELS, { candidateIndex: 0 });

    // Warning must be emitted
    assert.ok(
        Array.isArray(req.warnings) && req.warnings.some((w) => w.includes("Mozart")),
        `Expected lineage warning for Mozart in identity_default mode. Got: ${JSON.stringify(req.warnings)}`
    );

    // Composer must be within lineage
    const composerLine = req.controlLines.find((l) => l.startsWith("composer=")) ?? "";
    const isLineage = composerLine.toLowerCase().includes("beethoven") || composerLine.toLowerCase().includes("schubert");
    assert.ok(isLineage, `Expected lineage fallback, got: "${composerLine}"`);

    // composerRoutingMode should be present (identity_default is non-default)
    assert.equal(req.composerRoutingMode, "identity_default",
        "identity_default must be surfaced in output (non-lineage_only mode)");
});

// ─── CRM-04: lineage_only + Beethoven override → accepted (within lineage) ──────

test("CRM-04: lineage_only mode accepts Beethoven override without warning", () => {
    const payload = buildPayload({ composerRoutingMode: "lineage_only", composer: "Beethoven, Ludwig van" });
    const promptPack = payload.promptPack;

    const req = buildLearnedNotagenProviderRequest(promptPack, SELECTED_MODELS, { candidateIndex: 0 });

    // No lineage warning
    const lineageWarning = req.warnings?.some((w) => w.includes("lineage")) ?? false;
    assert.equal(lineageWarning, false, "No lineage warning expected for Beethoven override in lineage_only");

    // Composer must be Beethoven
    const composerLine = req.controlLines.find((l) => l.startsWith("composer=")) ?? "";
    assert.ok(composerLine.toLowerCase().includes("beethoven"), `Expected Beethoven, got: "${composerLine}"`);
});

// ─── CRM-05: default routing mode is "lineage_only" ──────────────────────────────

test("CRM-05: composerRoutingMode defaults to lineage_only when not in plan", () => {
    const payload = buildPayload(); // no composerRoutingMode in plan
    const promptPack = payload.promptPack;
    assert.equal(
        promptPack.styleCue.composerRoutingMode,
        "lineage_only",
        "composerRoutingMode must default to lineage_only"
    );

    const req = buildLearnedNotagenProviderRequest(promptPack, SELECTED_MODELS);
    // lineage_only is default so composerRoutingMode must NOT appear in output
    assert.equal(req.composerRoutingMode, undefined,
        "lineage_only (default) must not be marked in output");
});

