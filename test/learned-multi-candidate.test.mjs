// @ts-check
/**
 * Phase D: learned multi-candidate proposal tests
 *
 *  1. learnedCandidateCount=3 → 3 learned variants + 1 baseline (explicit counts path)
 *  2. music21BaselineCount=2 → 2 baseline variants
 *  3. learnedCandidateCount + music21BaselineCount → correct total variant count
 *  4. Legacy candidateCount=4 → 2 baseline + 2 learned (alternating, backward compat)
 *  5. learnedSampling is threaded into each learned variant's providerRequest controlLines
 *  6. candidateIndex is derived from candidateVariantKey (learned-2 → index 1)
 *  7. Sampling params without learnedCandidateCount defaults to 8 learned candidates
 *  8. learnedCandidateCount capped at 32
 *  9. music21BaselineCount minimum is 1
 * 10. candidateIndex NOT set for baseline variants
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const { buildHybridSymbolicCandidateRequests } = await import(
    "../dist/pipeline/hybridSymbolicCandidatePool.js"
);
const { buildLearnedSymbolicWorkerPayload } = await import(
    "../dist/composer/learnedAdapter.js"
);

const STRUCTURE_RERANKER_LANE = "string_trio_symbolic_structure_reranker_v1";

/** @type {import("../dist/pipeline/types.js").ModelBinding[]} */
const LEARNED_MODELS = [
    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
];

/** @type {import("../dist/pipeline/types.js").ModelBinding[]} */
const BASELINE_MODELS = [
    { role: "structure", provider: "python", model: "music21-symbolic-v1" },
];

/** @returns {import("../dist/pipeline/types.js").ComposeExecutionPlan} */
function makeExecutionPlan(overrides = {}) {
    return {
        workflow: "symbolic_only",
        composeWorker: "learned_symbolic",
        selectedModels: LEARNED_MODELS,
        ...overrides,
    };
}

function makeCompositionPlan(overrides = {}) {
    return {
        version: "1",
        brief: "Phase D test miniature",
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
        motifPolicy: { reuseRequired: false },
        rationale: "",
        sections: [
            { id: "s1", role: "theme_a", label: "Primary theme", measures: 4, energy: 0.5, density: 0.4 },
            { id: "s2", role: "recap", label: "Recap", measures: 4, energy: 0.4, density: 0.3 },
        ],
        ...overrides,
    };
}

/** @returns {import("../dist/pipeline/types.js").ComposeRequest} */
function makeRequest(overrides = {}) {
    return {
        prompt: "Phase D multi-candidate test",
        form: "miniature",
        key: "G minor",
        tempo: 84,
        workflow: "symbolic_only",
        compositionPlan: makeCompositionPlan(),
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hybrid candidate pool tests
// ─────────────────────────────────────────────────────────────────────────────

test("multi-candidate: learnedCandidateCount=3 produces 3 learned + 1 baseline", () => {
    const request = makeRequest({ learnedCandidateCount: 3 });
    const executionPlan = makeExecutionPlan();
    const plan = makeCompositionPlan();
    const variants = buildHybridSymbolicCandidateRequests(request, executionPlan, plan);

    const learned = variants.filter((v) => v.variant === "learned");
    const baseline = variants.filter((v) => v.variant === "baseline");

    assert.equal(learned.length, 3, "should produce 3 learned candidates");
    assert.equal(baseline.length, 1, "should produce 1 baseline candidate (default music21BaselineCount)");
    assert.equal(variants.length, 4, "total should be 4");
});

test("multi-candidate: music21BaselineCount=2 produces 2 baseline candidates", () => {
    const request = makeRequest({ learnedCandidateCount: 2, music21BaselineCount: 2 });
    const executionPlan = makeExecutionPlan();
    const plan = makeCompositionPlan();
    const variants = buildHybridSymbolicCandidateRequests(request, executionPlan, plan);

    const baseline = variants.filter((v) => v.variant === "baseline");
    const learned = variants.filter((v) => v.variant === "learned");

    assert.equal(baseline.length, 2, "should produce 2 baseline candidates");
    assert.equal(learned.length, 2, "should produce 2 learned candidates");
});

test("multi-candidate: explicit counts produce correct total count", () => {
    const request = makeRequest({ learnedCandidateCount: 5, music21BaselineCount: 3 });
    const executionPlan = makeExecutionPlan();
    const plan = makeCompositionPlan();
    const variants = buildHybridSymbolicCandidateRequests(request, executionPlan, plan);

    assert.equal(variants.length, 8, "5 learned + 3 baseline = 8 total");
});

test("multi-candidate: legacy candidateCount=4 → 2 baseline + 2 learned (alternating)", () => {
    const request = makeRequest({ candidateCount: 4 });
    const executionPlan = makeExecutionPlan();
    const plan = makeCompositionPlan();
    const variants = buildHybridSymbolicCandidateRequests(request, executionPlan, plan);

    const learned = variants.filter((v) => v.variant === "learned");
    const baseline = variants.filter((v) => v.variant === "baseline");

    assert.equal(learned.length, 2, "legacy: should produce 2 learned");
    assert.equal(baseline.length, 2, "legacy: should produce 2 baseline");
    // Alternating order: baseline-1, learned-1, baseline-2, learned-2
    assert.equal(variants[0].variant, "baseline");
    assert.equal(variants[1].variant, "learned");
    assert.equal(variants[2].variant, "baseline");
    assert.equal(variants[3].variant, "learned");
});

test("multi-candidate: learnedCandidateCount capped at 32", () => {
    const request = makeRequest({ learnedCandidateCount: 999 });
    const executionPlan = makeExecutionPlan();
    const plan = makeCompositionPlan();
    const variants = buildHybridSymbolicCandidateRequests(request, executionPlan, plan);

    const learned = variants.filter((v) => v.variant === "learned");
    assert.equal(learned.length, 32, "should be capped at 32");
});

test("multi-candidate: music21BaselineCount minimum is 1 when explicitly set", () => {
    const request = makeRequest({ learnedCandidateCount: 2, music21BaselineCount: 0 });
    const executionPlan = makeExecutionPlan();
    const plan = makeCompositionPlan();
    const variants = buildHybridSymbolicCandidateRequests(request, executionPlan, plan);

    const baseline = variants.filter((v) => v.variant === "baseline");
    assert.equal(baseline.length, 1, "music21BaselineCount=0 should clamp to 1");
});

// ─────────────────────────────────────────────────────────────────────────────
// Adapter / worker payload tests
// ─────────────────────────────────────────────────────────────────────────────

test("multi-candidate: learnedSampling threads into providerRequest controlLines", () => {
    const request = makeRequest({
        candidateVariantKey: "learned-1",
        learnedSampling: { temperature: 0.8, topP: 0.9, topK: 50, seedOffset: 2 },
    });
    const executionPlan = makeExecutionPlan();
    const payload = buildLearnedSymbolicWorkerPayload(
        request,
        "song-001",
        "/tmp/out.mid",
        executionPlan,
    );

    const samplingLine = payload.providerRequest.controlLines.find((l) =>
        l.startsWith("sampling "),
    );
    assert.ok(samplingLine, "sampling control line should be present");
    assert.match(samplingLine, /temperature=0\.8/);
    assert.match(samplingLine, /top_p=0\.9/);
    assert.match(samplingLine, /top_k=50/);
    assert.match(samplingLine, /seed_offset=2/);

    // samplingParams should also appear on the providerRequest object
    assert.deepEqual(payload.providerRequest.samplingParams, {
        temperature: 0.8,
        topP: 0.9,
        topK: 50,
        seedOffset: 2,
    });
});

test("multi-candidate: candidateIndex derived from candidateVariantKey (learned-2 → 1)", () => {
    const request = makeRequest({
        candidateVariantKey: "learned-2",
        learnedSampling: { temperature: 0.9 },
    });
    const executionPlan = makeExecutionPlan();
    const payload = buildLearnedSymbolicWorkerPayload(
        request,
        "song-002",
        "/tmp/out2.mid",
        executionPlan,
    );

    assert.equal(payload.candidateIndex, 1, "learned-2 → zero-based index 1");
    assert.equal(payload.providerRequest.candidateIndex, 1, "providerRequest.candidateIndex should match");
});

test("multi-candidate: no candidateIndex for non-learned variant key (baseline)", () => {
    const request = makeRequest({ candidateVariantKey: "baseline-1" });
    const executionPlan = makeExecutionPlan();
    const payload = buildLearnedSymbolicWorkerPayload(
        request,
        "song-003",
        "/tmp/out3.mid",
        executionPlan,
    );

    assert.equal(payload.candidateIndex, undefined, "baseline key should yield no candidateIndex");
    assert.equal(payload.providerRequest.candidateIndex, undefined, "providerRequest.candidateIndex should be absent");
});

test("multi-candidate: no sampling control line when learnedSampling absent", () => {
    const request = makeRequest({ candidateVariantKey: "learned-1" });
    const executionPlan = makeExecutionPlan();
    const payload = buildLearnedSymbolicWorkerPayload(
        request,
        "song-004",
        "/tmp/out4.mid",
        executionPlan,
    );

    const samplingLine = payload.providerRequest.controlLines.find((l) =>
        l.startsWith("sampling "),
    );
    assert.equal(samplingLine, undefined, "no sampling line when learnedSampling absent");
});
