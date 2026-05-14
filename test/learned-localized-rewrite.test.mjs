// @ts-check
/**
 * Phase E: NotaGen localized section rewrite tests
 *
 *  1. buildRewriteBlock includes <AXIOM_REWRITE> with correct section IDs
 *  2. build_notagen_input_string appends rewrite block when rewriteSpec present
 *  3. build_notagen_input_string omits rewrite block when rewriteSpec absent
 *  4. localizedRewriteSpec is threaded through learnedAdapter → providerRequest
 *  5. buildLearnedLocalizedRewriteSpec returns undefined when no sectionFindings
 *  6. buildLearnedLocalizedRewriteSpec identifies weak sections correctly
 *  7. buildLearnedLocalizedRewriteSpec returns undefined when no plan sections
 *  8. collectSameAttemptLocalizedRewriteParents allows learnedCandidateCount=1 (guard relaxed)
 *  9. assemble_rewritten_abc preserves keep-section artifacts and uses rewritten for rewrite sections
 * 10. localized_rewrite.py directive mapping produces human-readable targets
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const { buildLearnedSymbolicWorkerPayload } = await import("../dist/composer/learnedAdapter.js");
const { buildLearnedNotagenProviderRequest, buildRewriteBlock } = await import(
    "../dist/composer/learnedNotagenAdapter.js"
);
const { buildLearnedLocalizedRewriteSpec } = await import("../dist/pipeline/quality.js");

/** @type {import("../dist/pipeline/types.js").ModelBinding[]} */
const LEARNED_MODELS = [
    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
];

function makeCompositionPlan(overrides = {}) {
    return {
        version: "1",
        brief: "Phase E test miniature",
        mood: [],
        form: "miniature",
        key: "G minor",
        meter: "4/4",
        tempo: 84,
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
        rationale: "",
        sections: [
            { id: "s1", role: "theme_a", label: "Primary theme", measures: 4, energy: 0.5, density: 0.4 },
            { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.7, density: 0.6 },
            { id: "s3", role: "recap", label: "Recap", measures: 4, energy: 0.4, density: 0.3 },
        ],
        ...overrides,
    };
}

/** @returns {import("../dist/pipeline/types.js").ComposeRequest} */
function makeRequest(overrides = {}) {
    return {
        prompt: "Phase E localized rewrite test",
        form: "miniature",
        key: "G minor",
        tempo: 84,
        workflow: "symbolic_only",
        compositionPlan: makeCompositionPlan(),
        ...overrides,
    };
}

function makeExecutionPlan(overrides = {}) {
    return {
        workflow: "symbolic_only",
        composeWorker: "learned_symbolic",
        selectedModels: LEARNED_MODELS,
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript tests
// ─────────────────────────────────────────────────────────────────────────────

test("phase-e: buildRewriteBlock produces <AXIOM_REWRITE> block", () => {
    /** @type {import("../dist/pipeline/types.js").LocalizedRewriteSpec} */
    const spec = {
        rewriteSectionIds: ["s2"],
        keepSectionIds: ["s1", "s3"],
        reason: "counterline too static; cadence into recap unclear",
        directives: [
            { sectionId: "s2", kind: "strengthen_cadence", reason: "cadence unclear" },
        ],
    };

    const block = buildRewriteBlock(spec);
    assert.ok(block.startsWith("<AXIOM_REWRITE>"), "should start with <AXIOM_REWRITE>");
    assert.ok(block.includes("mode=localized_section_rewrite"), "should include mode");
    assert.ok(block.includes("keep_sections=s1,s3"), "should list keep sections");
    assert.ok(block.includes("rewrite_sections=s2"), "should list rewrite sections");
    assert.ok(block.includes("preserve meter and measure count"), "should always include measure count preservation");
    assert.ok(block.endsWith("</AXIOM_REWRITE>"), "should end with </AXIOM_REWRITE>");
});

test("phase-e: buildRewriteBlock includes directive-derived targets", () => {
    /** @type {import("../dist/pipeline/types.js").LocalizedRewriteSpec} */
    const spec = {
        rewriteSectionIds: ["s2"],
        keepSectionIds: ["s1", "s3"],
        reason: "weak development",
        directives: [
            { sectionId: "s2", kind: "clarify_texture_plan", reason: "voices too similar" },
            { sectionId: "s2", kind: "increase_rhythm_variety", reason: "monotonous rhythm" },
        ],
    };
    const block = buildRewriteBlock(spec);
    assert.ok(block.includes("clarify voice independence"), "should map clarify_texture_plan");
    assert.ok(block.includes("diversify rhythm cells"), "should map increase_rhythm_variety");
});

test("phase-e: providerRequest includes rewriteSpec when localizedRewriteSpec set", () => {
    /** @type {import("../dist/pipeline/types.js").LocalizedRewriteSpec} */
    const localizedRewriteSpec = {
        rewriteSectionIds: ["s2"],
        keepSectionIds: ["s1", "s3"],
        reason: "s2 is weak",
        directives: [],
    };
    const request = makeRequest({ localizedRewriteSpec });
    const executionPlan = makeExecutionPlan();
    const payload = buildLearnedSymbolicWorkerPayload(request, "song-e1", "out/e1.mid", executionPlan);

    assert.ok(payload.localizedRewriteSpec, "payload should have localizedRewriteSpec");
    assert.deepEqual(payload.localizedRewriteSpec.rewriteSectionIds, ["s2"]);
    assert.deepEqual(payload.localizedRewriteSpec.keepSectionIds, ["s1", "s3"]);
    assert.ok(payload.providerRequest.rewriteSpec, "providerRequest should have rewriteSpec");
    assert.deepEqual(payload.providerRequest.rewriteSpec.rewriteSectionIds, ["s2"]);
});

test("phase-e: providerRequest has no rewriteSpec when localizedRewriteSpec absent", () => {
    const request = makeRequest();
    const executionPlan = makeExecutionPlan();
    const payload = buildLearnedSymbolicWorkerPayload(request, "song-e2", "out/e2.mid", executionPlan);

    assert.equal(payload.localizedRewriteSpec, undefined);
    assert.equal(payload.providerRequest.rewriteSpec, undefined);
});

test("phase-e: buildLearnedLocalizedRewriteSpec returns undefined for empty sectionFindings", () => {
    /** @type {import("../dist/pipeline/types.js").StructureEvaluationReport} */
    const evaluation = {
        passed: false,
        score: 50,
        issues: ["Too few notes"],
        strengths: [],
    };
    const plan = makeCompositionPlan();
    const result = buildLearnedLocalizedRewriteSpec(evaluation, plan, [], 78);
    assert.equal(result, undefined, "should return undefined when no sectionFindings");
});

test("phase-e: buildLearnedLocalizedRewriteSpec identifies weak sections", () => {
    /** @type {import("../dist/pipeline/types.js").StructureEvaluationReport} */
    const evaluation = {
        passed: false,
        score: 60,
        issues: [],
        strengths: [],
        sectionFindings: [
            { sectionId: "s1", label: "Primary theme", role: "theme_a", startMeasure: 1, endMeasure: 4, score: 82, issues: [], strengths: [], metrics: {} },
            { sectionId: "s2", label: "Development", role: "development", startMeasure: 5, endMeasure: 8, score: 45, issues: ["counterline too static", "cadence weak"], strengths: [], metrics: {} },
            { sectionId: "s3", label: "Recap", role: "recap", startMeasure: 9, endMeasure: 12, score: 78, issues: [], strengths: [], metrics: {} },
        ],
    };
    const plan = makeCompositionPlan();
    /** @type {import("../dist/pipeline/types.js").RevisionDirective[]} */
    const directives = [
        { kind: "strengthen_cadence", priority: 90, reason: "cadence weak", sectionIds: ["s2"] },
    ];
    const result = buildLearnedLocalizedRewriteSpec(evaluation, plan, directives, 78);

    assert.ok(result, "should return a spec");
    assert.deepEqual(result.rewriteSectionIds, ["s2"], "should rewrite the weak section");
    assert.ok(result.keepSectionIds.includes("s1"), "should keep s1");
    assert.ok(result.keepSectionIds.includes("s3"), "should keep s3");
    assert.ok(result.reason.length > 0, "should have a reason");
    assert.equal(result.directives.length, 1, "should include the strengthen_cadence directive hint");
    assert.equal(result.directives[0].kind, "strengthen_cadence");
});

test("phase-e: buildLearnedLocalizedRewriteSpec returns undefined when no plan sections", () => {
    /** @type {import("../dist/pipeline/types.js").StructureEvaluationReport} */
    const evaluation = {
        passed: false,
        score: 40,
        issues: [],
        strengths: [],
        sectionFindings: [
            { sectionId: "s1", label: "x", role: "theme_a", startMeasure: 1, endMeasure: 4, score: 30, issues: ["weak"], strengths: [], metrics: {} },
        ],
    };
    const result = buildLearnedLocalizedRewriteSpec(evaluation, undefined, [], 78);
    assert.equal(result, undefined, "should return undefined when no plan sections");
});

// ─────────────────────────────────────────────────────────────────────────────
// Python tests via subprocess
// ─────────────────────────────────────────────────────────────────────────────

function runPythonScript(code) {
    const result = spawnSync("python", ["-c", code], {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 10000,
    });
    return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        status: result.status ?? -1,
        error: result.error,
    };
}

test("phase-e: build_rewrite_prompt_block produces expected structure", () => {
    const code = `
import json, sys
sys.path.insert(0, '.')
from workers.composer.learned_symbolic.localized_rewrite import build_rewrite_prompt_block
block = build_rewrite_prompt_block(
    rewrite_section_ids=["s2"],
    keep_section_ids=["s1", "s3"],
    reason="counterline too static; cadence weak",
    directives=[{"kind": "strengthen_cadence", "reason": "cadence"}]
)
print(json.dumps(block))
`;
    const { stdout, stderr, status } = runPythonScript(code);
    if (status !== 0) {
        assert.fail(`Python exited ${status}: ${stderr}`);
    }
    const block = JSON.parse(stdout.trim());
    assert.ok(block.includes("<AXIOM_REWRITE>"), "block should contain <AXIOM_REWRITE>");
    assert.ok(block.includes("keep_sections=s1,s3"), "block should list keep sections");
    assert.ok(block.includes("rewrite_sections=s2"), "block should list rewrite sections");
    assert.ok(block.includes("preserve meter and measure count"), "block should always include measure count preservation");
    assert.ok(block.includes("</AXIOM_REWRITE>"), "block should contain </AXIOM_REWRITE>");
});

test("phase-e: assemble_rewritten_abc preserves keep artifacts and uses rewritten for rewrite sections", () => {
    const code = `
import json, sys
sys.path.insert(0, '.')
from workers.composer.learned_symbolic.localized_rewrite import assemble_rewritten_abc
keep = [
    {"sectionId": "s1", "leadEvents": [{"pitch": 60}]},
    {"sectionId": "s3", "leadEvents": [{"pitch": 62}]},
]
rewritten = [
    {"sectionId": "s2", "leadEvents": [{"pitch": 64, "rewritten": True}]},
]
order = ["s1", "s2", "s3"]
merged = assemble_rewritten_abc(keep, rewritten, order, ["s2"])
print(json.dumps(merged))
`;
    const { stdout, stderr, status } = runPythonScript(code);
    if (status !== 0) {
        assert.fail(`Python exited ${status}: ${stderr}`);
    }
    const merged = JSON.parse(stdout.trim());
    assert.equal(merged.length, 3, "merged should have 3 sections");
    assert.equal(merged[0].sectionId, "s1", "s1 first");
    assert.equal(merged[1].sectionId, "s2", "s2 second");
    assert.equal(merged[2].sectionId, "s3", "s3 third");
    // s1 and s3 should be kept artifacts (original leadEvents)
    assert.equal(merged[0].leadEvents[0].pitch, 60, "s1 should be kept artifact (pitch=60)");
    assert.equal(merged[2].leadEvents[0].pitch, 62, "s3 should be kept artifact (pitch=62)");
    // s2 should be the rewritten artifact
    assert.equal(merged[1].leadEvents[0].pitch, 64, "s2 should be rewritten artifact (pitch=64)");
    assert.ok(merged[1].leadEvents[0].rewritten, "s2 should carry rewritten flag");
});

test("phase-e: abc_prompt includes AXIOM_REWRITE block when rewriteSpec present", () => {
    const providerRequest = {
        conditioningText: "Generate interleaved ABC notation for a classical string trio miniature in G minor, 4/4, 84 BPM. Preserve the section plan and synchronized voices.",
        controlLines: [
            "lane=string_trio_symbolic",
            "plan_signature=test|sig",
            "prompt_pack_version=learned_symbolic_v1",
            "abc_format=interleaved",
            "form=miniature",
            "key=Gmin",
            "meter=4/4",
            "tempo=84",
            "instrumentation=Violin:lead,Viola:counterline,Cello:bass",
            "section id=s1 role=theme_a label=Primary measures=4 energy=0.5 density=0.4 motif_ref=none",
            "section id=s2 role=development label=Development measures=4 energy=0.7 density=0.6 motif_ref=none",
            "section id=s3 role=recap label=Recap measures=4 energy=0.4 density=0.3 motif_ref=none",
        ],
        rewriteSpec: {
            rewriteSectionIds: ["s2"],
            keepSectionIds: ["s1", "s3"],
            reason: "counterline too static",
            directives: [{ sectionId: "s2", kind: "clarify_texture_plan", reason: "voices similar" }],
        },
    };

    const code = `
import json, sys
sys.path.insert(0, '.')
from workers.composer.learned_symbolic.abc_prompt import build_notagen_input_string
req = json.loads(sys.argv[1])
result = build_notagen_input_string(req)
print(json.dumps(result))
`;
    const encoded = JSON.stringify(JSON.stringify(providerRequest));
    const runResult = spawnSync(
        "python",
        ["-c", `import json, sys\nsys.path.insert(0, '.')\nfrom workers.composer.learned_symbolic.abc_prompt import build_notagen_input_string\nreq = ${JSON.stringify(JSON.stringify(providerRequest))}\nresult = build_notagen_input_string(json.loads(req))\nprint(json.dumps(result))`],
        { cwd: repoRoot, encoding: "utf-8", timeout: 10000 },
    );
    if (runResult.status !== 0) {
        assert.fail(`Python exited ${runResult.status}: ${runResult.stderr}`);
    }
    const output = JSON.parse(runResult.stdout.trim());
    assert.ok(output.includes("<AXIOM_REWRITE>"), "output should contain <AXIOM_REWRITE>");
    assert.ok(output.includes("keep_sections=s1,s3"), "output should include keep sections");
    assert.ok(output.includes("rewrite_sections=s2"), "output should include rewrite sections");
    assert.ok(output.includes("%%axiom_control_begin"), "output should have control begin marker");
    assert.ok(output.includes("%%axiom_control_end"), "output should have control end marker");
});

test("phase-e: abc_prompt omits AXIOM_REWRITE block when rewriteSpec absent", () => {
    const providerRequest = {
        conditioningText: "Generate interleaved ABC notation for a classical string trio miniature in G minor, 4/4, 84 BPM. Preserve the section plan and synchronized voices.",
        controlLines: [
            "lane=string_trio_symbolic",
            "plan_signature=test|sig",
            "prompt_pack_version=learned_symbolic_v1",
            "abc_format=interleaved",
            "form=miniature",
            "key=Gmin",
            "meter=4/4",
            "tempo=84",
            "instrumentation=Violin:lead,Viola:counterline,Cello:bass",
            "section id=s1 role=theme_a label=Primary measures=4 energy=0.5 density=0.4 motif_ref=none",
        ],
    };

    const runResult = spawnSync(
        "python",
        ["-c", `import json, sys\nsys.path.insert(0, '.')\nfrom workers.composer.learned_symbolic.abc_prompt import build_notagen_input_string\nreq = ${JSON.stringify(JSON.stringify(providerRequest))}\nresult = build_notagen_input_string(json.loads(req))\nprint(json.dumps(result))`],
        { cwd: repoRoot, encoding: "utf-8", timeout: 10000 },
    );
    if (runResult.status !== 0) {
        assert.fail(`Python exited ${runResult.status}: ${runResult.stderr}`);
    }
    const output = JSON.parse(runResult.stdout.trim());
    assert.ok(!output.includes("<AXIOM_REWRITE>"), "output should NOT contain <AXIOM_REWRITE> when no rewriteSpec");
});
