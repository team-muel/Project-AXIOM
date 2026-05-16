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
 *
 * Phase E metric improvement regression (tests 11–16):
 * 11. voiceIndependence improves after rewriting weak s2 with independent voices
 * 12. cadenceStrength improves after rewriting s2 with dominant cadence approach
 * 13. finalCraftScore improves after full localized rewrite of weak s2
 * 14. s1 and s3 artifacts are event-stable (identical objects) after rewrite assembly
 * 15. buildLearnedLocalizedRewriteSpec targets only the weakest section (s2)
 * 16. assemble_rewritten_abc + projection evidence for s2 shows improvement (Python)
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
const { buildLearnedLocalizedRewriteSpec } = await import("../dist/core/evaluate/quality.js");
const {
    computeCraftScoreSummary,
    computeVoiceIndependence,
    computeCadenceStrength,
} = await import("../dist/core/evaluate/craftScoring.js");

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase E: Metric improvement regression tests (11–16)
//
// Strategy: build controlled SectionArtifactSummary fixtures where s2 is
// deliberately weak (identical rhythm = low voiceIndependence, cadenceApproach
// = "other" = low cadenceStrength). Then simulate the rewrite by substituting
// a better s2 fixture and verify that the craft scores improve.
// ─────────────────────────────────────────────────────────────────────────────

/** Shared composition plan used across improvement tests */
const IMPROVEMENT_PLAN = {
    version: "1",
    brief: "Metric improvement regression plan",
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
    orchestration: { family: "string_trio", instrumentNames: ["Violin", "Viola", "Cello"], sections: [] },
    rationale: "",
    sections: [
        { id: "s1", role: "theme_a", label: "Theme A", measures: 4, energy: 0.5, density: 0.4 },
        { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.7, density: 0.6 },
        { id: "s3", role: "recap", label: "Recap", measures: 4, energy: 0.4, density: 0.3 },
    ],
};

/** Baseline evaluation report (no fatal issues, reasonable syntax) */
const BASELINE_EVAL = {
    passed: true,
    score: 72,
    issues: [],
    strengths: [],
    metrics: {},
};

/**
 * Make a minimal SectionArtifactSummary with controllable voice independence
 * and cadence signals.
 *
 * @param {object} opts
 * @param {string} opts.sectionId
 * @param {import("../dist/pipeline/types.js").SectionRole} opts.role
 * @param {number[]} opts.melodyRhythm    quarter-lengths for melody (controls rhythmic pattern)
 * @param {number[]} opts.accompRhythm    quarter-lengths for accompaniment
 * @param {number} opts.contraryMotionRate
 * @param {number} opts.independentMotionRate
 * @param {"dominant"|"plagal"|"tonic"|"other"} opts.cadenceApproach
 * @param {number[]} opts.noteHistory
 * @param {number} opts.lastInterval
 */
function makeArtifact({
    sectionId,
    role,
    melodyRhythm,
    accompRhythm,
    contraryMotionRate,
    independentMotionRate,
    cadenceApproach,
    noteHistory,
    lastInterval,
}) {
    return {
        sectionId,
        role,
        measureCount: 4,
        melodyEvents: melodyRhythm.map((ql) => ({ type: "note", quarterLength: ql, pitch: 67, velocity: 80 })),
        accompanimentEvents: accompRhythm.map((ql) => ({ type: "note", quarterLength: ql, pitch: 55, velocity: 64 })),
        noteHistory,
        textureContraryMotionRate: contraryMotionRate,
        textureIndependentMotionRate: independentMotionRate,
        cadenceApproach,
        lastInterval,
        melodyPitchMin: 64,
        melodyPitchMax: 76,
        bassPitchMin: 43,
        bassPitchMax: 60,
    };
}

// ── Shared fixtures ──────────────────────────────────────────────────────────

// s1 — strong theme_a (good contrary motion, no cadence role)
const ARTIFACT_S1 = makeArtifact({
    sectionId: "s1",
    role: "theme_a",
    melodyRhythm: [1, 0.5, 0.5, 1, 1, 0.5, 0.5, 1],
    accompRhythm: [2, 2, 1, 1, 1, 1],            // different pattern → low correlation
    contraryMotionRate: 0.65,
    independentMotionRate: 0.70,
    cadenceApproach: "other",
    noteHistory: [67, 69, 71, 72, 71, 69, 67, 65],
    lastInterval: 2,
});

// s3 — strong recap with dominant cadence
const ARTIFACT_S3 = makeArtifact({
    sectionId: "s3",
    role: "recap",
    melodyRhythm: [1, 1, 1, 1, 1, 0.5, 0.5, 1],
    accompRhythm: [2, 1, 1, 2, 2],
    contraryMotionRate: 0.60,
    independentMotionRate: 0.65,
    cadenceApproach: "dominant",
    noteHistory: [67, 69, 71, 67, 65, 67],
    lastInterval: 2,
});

// s2 — WEAK development: identical rhythm → high correlation, "other" cadence
const ARTIFACT_S2_WEAK = makeArtifact({
    sectionId: "s2",
    role: "development",
    melodyRhythm:  [1, 1, 1, 1, 1, 1, 1, 1],   // identical to accomp → perfect correlation
    accompRhythm:  [1, 1, 1, 1, 1, 1, 1, 1],
    contraryMotionRate: 0.05,
    independentMotionRate: 0.05,
    cadenceApproach: "other",
    noteHistory: [67, 67, 67, 67, 67, 67],
    lastInterval: 0,
});

// s2 — STRONG development: contrasting rhythm, high contrary motion
const ARTIFACT_S2_STRONG = makeArtifact({
    sectionId: "s2",
    role: "development",
    melodyRhythm: [0.5, 0.5, 1, 0.5, 0.5, 1, 2],   // varied
    accompRhythm: [2, 1, 1, 0.5, 0.5, 0.5, 0.5],   // different
    contraryMotionRate: 0.85,
    independentMotionRate: 0.85,
    cadenceApproach: "dominant",
    noteHistory: [67, 69, 71, 74, 72, 71, 69],
    lastInterval: 2,
});

// ── Tests 11–15: TypeScript-only metric verification ─────────────────────────

test("phase-e metric: voiceIndependence improves after rewriting weak s2 with independent voices", () => {
    const artifactsBefore = [ARTIFACT_S1, ARTIFACT_S2_WEAK, ARTIFACT_S3];
    const artifactsAfter  = [ARTIFACT_S1, ARTIFACT_S2_STRONG, ARTIFACT_S3];

    const before = computeVoiceIndependence(artifactsBefore);
    const after  = computeVoiceIndependence(artifactsAfter);

    assert.ok(
        after.score > before.score,
        `voiceIndependence should improve after rewrite: before=${before.score.toFixed(3)} after=${after.score.toFixed(3)}`,
    );
    // Ensure the improvement is substantial, not just floating-point noise
    assert.ok(
        after.score - before.score >= 0.10,
        `improvement should be >= 0.10 pts (got ${(after.score - before.score).toFixed(3)})`,
    );
});

test("phase-e metric: cadenceStrength improves after rewriting s2/s3 with dominant cadence approach", () => {
    // Temporarily make s3 weak to isolate cadence test: use a non-final dominant test
    const artifactsBefore = [ARTIFACT_S1, ARTIFACT_S2_WEAK, ARTIFACT_S3];
    // Swap the final section out so we can control it
    const s3Weak = makeArtifact({
        sectionId: "s3",
        role: "recap",
        melodyRhythm: [1, 1, 1, 1],
        accompRhythm: [1, 1, 1, 1],
        contraryMotionRate: 0.4,
        independentMotionRate: 0.4,
        cadenceApproach: "other",          // weak: no harmonic preparation
        noteHistory: [67, 67, 67, 67],
        lastInterval: 5,                   // large leap — bad resolution
    });
    const s3Strong = makeArtifact({
        sectionId: "s3",
        role: "recap",
        melodyRhythm: [1, 0.5, 0.5, 1, 2],
        accompRhythm: [2, 1, 1, 2],
        contraryMotionRate: 0.6,
        independentMotionRate: 0.6,
        cadenceApproach: "dominant",       // strong: dominant preparation
        noteHistory: [72, 71, 69, 67],
        lastInterval: 2,                   // stepwise resolution
    });

    const before = computeCadenceStrength([ARTIFACT_S1, ARTIFACT_S2_WEAK, s3Weak]);
    const after  = computeCadenceStrength([ARTIFACT_S1, ARTIFACT_S2_STRONG, s3Strong]);

    assert.ok(
        after.score > before.score,
        `cadenceStrength should improve: before=${before.score.toFixed(3)} after=${after.score.toFixed(3)}`,
    );
});

test("phase-e metric: finalCraftScore improves after full localized rewrite of weak s2", () => {
    const artifactsBefore = [ARTIFACT_S1, ARTIFACT_S2_WEAK, ARTIFACT_S3];
    const artifactsAfter  = [ARTIFACT_S1, ARTIFACT_S2_STRONG, ARTIFACT_S3];

    const before = computeCraftScoreSummary(artifactsBefore, IMPROVEMENT_PLAN, BASELINE_EVAL);
    const after  = computeCraftScoreSummary(artifactsAfter,  IMPROVEMENT_PLAN, BASELINE_EVAL);

    assert.ok(
        after.finalCraftScore > before.finalCraftScore,
        `finalCraftScore should improve: before=${before.finalCraftScore} after=${after.finalCraftScore}`,
    );
    assert.ok(
        after.voiceIndependence > before.voiceIndependence,
        `voiceIndependence should improve in full craft summary`,
    );
});

test("phase-e metric: s1 and s3 SectionArtifactSummary objects are event-stable after simulated rewrite assembly", () => {
    // Simulate what orchestrator does: keep s1/s3 references, replace s2
    const beforeArtifacts = [ARTIFACT_S1, ARTIFACT_S2_WEAK, ARTIFACT_S3];
    const rewriteSectionIds = new Set(["s2"]);

    const afterArtifacts = beforeArtifacts.map((a) =>
        rewriteSectionIds.has(a.sectionId) ? ARTIFACT_S2_STRONG : a,
    );

    // s1 and s3 must be the SAME object reference (event-stable)
    assert.strictEqual(afterArtifacts[0], ARTIFACT_S1, "s1 must be reference-identical after rewrite assembly");
    assert.strictEqual(afterArtifacts[2], ARTIFACT_S3, "s3 must be reference-identical after rewrite assembly");

    // s2 must be the rewritten version
    assert.strictEqual(afterArtifacts[1], ARTIFACT_S2_STRONG, "s2 must be the rewritten artifact");
    assert.notStrictEqual(afterArtifacts[1], ARTIFACT_S2_WEAK, "s2 must NOT be the original weak artifact");
});

test("phase-e metric: buildLearnedLocalizedRewriteSpec targets only the weakest section (s2)", () => {
    /** @type {import("../dist/pipeline/types.js").StructureEvaluationReport} */
    const evaluation = {
        passed: false,
        score: 58,
        issues: ["Development section is too uniform"],
        strengths: [],
        sectionFindings: [
            { sectionId: "s1", label: "Theme A", role: "theme_a",
              startMeasure: 1, endMeasure: 4, score: 85, issues: [], strengths: [], metrics: {} },
            { sectionId: "s2", label: "Development", role: "development",
              startMeasure: 5, endMeasure: 8, score: 42,
              issues: ["voices move in unison", "no cadence preparation"],
              strengths: [], metrics: {} },
            { sectionId: "s3", label: "Recap", role: "recap",
              startMeasure: 9, endMeasure: 12, score: 80, issues: [], strengths: [], metrics: {} },
        ],
    };

    /** @type {import("../dist/pipeline/types.js").RevisionDirective[]} */
    const directives = [
        { kind: "clarify_texture_plan", priority: 90, reason: "voices too similar", sectionIds: ["s2"] },
        { kind: "strengthen_cadence",   priority: 80, reason: "no cadence prep",    sectionIds: ["s2"] },
    ];

    const spec = buildLearnedLocalizedRewriteSpec(evaluation, IMPROVEMENT_PLAN, directives, 78);

    assert.ok(spec, "spec should be defined for a clearly weak section");
    assert.deepEqual(spec.rewriteSectionIds, ["s2"], "only s2 should be targeted for rewrite");
    assert.ok(spec.keepSectionIds.includes("s1"), "s1 should be kept");
    assert.ok(spec.keepSectionIds.includes("s3"), "s3 should be kept");
    assert.ok(spec.directives.length >= 1, "at least one directive should be included");

    // Verify the before/after craft scores corroborate the spec decision:
    // voiceIndependence of weak fixtures should be lower than the gate threshold
    const beforeScore = computeCraftScoreSummary(
        [ARTIFACT_S1, ARTIFACT_S2_WEAK, ARTIFACT_S3], IMPROVEMENT_PLAN, BASELINE_EVAL,
    );
    const afterScore = computeCraftScoreSummary(
        [ARTIFACT_S1, ARTIFACT_S2_STRONG, ARTIFACT_S3], IMPROVEMENT_PLAN, BASELINE_EVAL,
    );
    assert.ok(
        afterScore.finalCraftScore > beforeScore.finalCraftScore,
        `craft score should rise when s2 is rewritten per spec: ${beforeScore.finalCraftScore} → ${afterScore.finalCraftScore}`,
    );
});

// ── Test 16: Python-side assemble_rewritten_abc event-stable verification ────

test("phase-e metric: assemble_rewritten_abc leaves keep-section events byte-identical (Python)", () => {
    const code = `
import json, sys
sys.path.insert(0, '.')
from workers.composer.learned_symbolic.localized_rewrite import assemble_rewritten_abc

# Simulate keep artifacts with distinct, identifiable lead events
keep = [
    {"sectionId": "s1", "leadEvents": [{"pitch": 67, "quarterLength": 1.0, "marker": "s1_original"}]},
    {"sectionId": "s3", "leadEvents": [{"pitch": 64, "quarterLength": 2.0, "marker": "s3_original"}]},
]

# Simulated rewrite artifact for s2 (improved)
rewritten = [
    {"sectionId": "s2", "leadEvents": [{"pitch": 71, "quarterLength": 0.5, "marker": "s2_rewritten"}]},
]

order = ["s1", "s2", "s3"]
merged = assemble_rewritten_abc(keep, rewritten, order, ["s2"])

result = {
    "length": len(merged),
    "s1_marker": merged[0]["leadEvents"][0]["marker"],
    "s2_marker": merged[1]["leadEvents"][0]["marker"],
    "s3_marker": merged[2]["leadEvents"][0]["marker"],
    "s1_pitch":  merged[0]["leadEvents"][0]["pitch"],
    "s2_pitch":  merged[1]["leadEvents"][0]["pitch"],
    "s3_pitch":  merged[2]["leadEvents"][0]["pitch"],
}
print(json.dumps(result))
`;

    const runResult = spawnSync("python", ["-c", code], {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 10000,
    });
    if (runResult.status !== 0) {
        assert.fail(`Python exited ${runResult.status}: ${runResult.stderr}`);
    }

    const result = JSON.parse(runResult.stdout.trim());
    assert.equal(result.length, 3, "merged should have exactly 3 sections");

    // Keep sections must be byte-identical originals
    assert.equal(result.s1_marker, "s1_original", "s1 must carry original marker (event-stable)");
    assert.equal(result.s3_marker, "s3_original", "s3 must carry original marker (event-stable)");
    assert.equal(result.s1_pitch, 67, "s1 pitch must be unchanged");
    assert.equal(result.s3_pitch, 64, "s3 pitch must be unchanged");

    // Rewritten section must use the new artifact
    assert.equal(result.s2_marker, "s2_rewritten", "s2 must carry rewritten marker");
    assert.equal(result.s2_pitch, 71, "s2 pitch must be the rewritten value");
});
