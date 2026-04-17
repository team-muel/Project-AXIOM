import test from "node:test";
import assert from "node:assert/strict";
import { buildExecutionPlan } from "../dist/composer/index.js";
import {
    buildHybridSymbolicCandidateRequests,
    buildHybridSymbolicSelectionReason,
    resolveHybridSymbolicCandidateLane,
    resolveHybridSymbolicPreferredSelectedModels,
} from "../dist/pipeline/hybridSymbolicCandidatePool.js";

function buildStringTrioMiniatureRequest() {
    return {
        prompt: "Compose a compact string trio miniature with clear phrase contrast.",
        form: "miniature",
        workflow: "symbolic_only",
        selectedModels: [
            { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
        ],
        compositionPlan: {
            version: "plan-v1",
            brief: "string trio miniature",
            form: "miniature",
            workflow: "symbolic_only",
            instrumentation: [
                { name: "Violin", family: "strings", roles: ["lead"] },
                { name: "Viola", family: "strings", roles: ["support"] },
                { name: "Cello", family: "strings", roles: ["bass"] },
            ],
            orchestration: {
                family: "string_trio",
                instrumentNames: ["Violin", "Viola", "Cello"],
                sections: [],
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 4,
                    energy: 0.34,
                    density: 0.3,
                    phraseFunction: "presentation",
                    harmonicPlan: {
                        tonalCenter: "D minor",
                        harmonicRhythm: "medium",
                        cadence: "half",
                        allowModulation: false,
                    },
                },
                {
                    id: "s2",
                    role: "closing",
                    label: "Cadence",
                    measures: 4,
                    energy: 0.42,
                    density: 0.32,
                    phraseFunction: "cadential",
                    harmonicPlan: {
                        tonalCenter: "D minor",
                        harmonicRhythm: "medium",
                        cadence: "authentic",
                        allowModulation: false,
                    },
                },
            ],
        },
    };
}

test("hybrid symbolic candidate pool emits baseline and learned variants on the narrow string trio lane", () => {
    const request = buildStringTrioMiniatureRequest();
    const executionPlan = buildExecutionPlan(request);

    const lane = resolveHybridSymbolicCandidateLane(request, executionPlan, request.compositionPlan);
    const variants = buildHybridSymbolicCandidateRequests(request, executionPlan, request.compositionPlan);
    const preferredSelectedModels = resolveHybridSymbolicPreferredSelectedModels(request, executionPlan, request.compositionPlan);

    assert.equal(lane, "string_trio_symbolic");
    assert.deepEqual(variants.map((variant) => variant.variant), ["baseline", "learned"]);
    assert.equal(variants[0].lane, "string_trio_symbolic");
    assert.equal(variants[0].request.selectedModels[0].provider, "python");
    assert.equal(variants[0].request.selectedModels[0].model, "music21-symbolic-v1");
    assert.equal(variants[1].request.selectedModels[0].provider, "learned");
    assert.equal(variants[1].request.selectedModels[0].model, "learned-symbolic-trio-v1");
    assert.deepEqual(preferredSelectedModels, variants[1].request.selectedModels);
});

test("hybrid symbolic candidate pool falls back to the requested candidate outside the narrow lane", () => {
    const request = {
        prompt: "Compose a compact keyboard miniature.",
        form: "miniature",
        workflow: "symbolic_only",
        selectedModels: [
            { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
        ],
        compositionPlan: {
            version: "plan-v1",
            brief: "keyboard miniature",
            form: "miniature",
            workflow: "symbolic_only",
            instrumentation: [
                { name: "Piano", family: "keyboard", roles: ["lead", "support"] },
            ],
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 4,
                    energy: 0.38,
                    density: 0.34,
                    harmonicPlan: {
                        tonalCenter: "C major",
                        harmonicRhythm: "medium",
                        cadence: "half",
                        allowModulation: false,
                    },
                },
            ],
        },
    };
    const executionPlan = buildExecutionPlan(request);
    const variants = buildHybridSymbolicCandidateRequests(request, executionPlan, request.compositionPlan);

    assert.deepEqual(variants.map((variant) => variant.variant), ["requested"]);
    assert.equal(variants[0].lane, null);
    assert.equal(variants[0].request.selectedModels[0].provider, "learned");
});

test("hybrid symbolic selection reason records the heuristic worker decision", () => {
    const reason = buildHybridSymbolicSelectionReason(
        "structure evaluation accepted the symbolic draft",
        {
            candidateId: "attempt-2-music21",
            attempt: 2,
            composeWorker: "music21",
            structureScore: 84.4,
            lane: "string_trio_symbolic",
        },
        [
            {
                candidateId: "attempt-2-music21",
                attempt: 2,
                composeWorker: "music21",
                structureScore: 84.4,
                lane: "string_trio_symbolic",
            },
            {
                candidateId: "attempt-2-learned",
                attempt: 2,
                composeWorker: "learned_symbolic",
                structureScore: 81.1,
                lane: "string_trio_symbolic",
            },
        ],
    );

    assert.match(reason, /structure evaluation accepted the symbolic draft/);
    assert.match(reason, /hybrid candidate pool kept music21 over learned_symbolic/);
    assert.match(reason, /84\.4 vs 81\.1/);
});
