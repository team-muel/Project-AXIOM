/**
 * motif-graph-prompt.test.mjs
 *
 * Validates the GlobalMotifGraph → [AXIOM_MOTIF_GRAPH] prompt block pipeline.
 *
 * MGP-01: buildMotifGraphBlock() returns [AXIOM_MOTIF_GRAPH] block with correct header fields
 * MGP-02: buildMotifGraphBlock() emits per-section transform + dramatic_function lines
 * MGP-03: buildMotifGraphBlock() marks required=true for required return sections
 * MGP-04: buildMotifGraphBlock() returns undefined when transformPath is empty
 * MGP-05: buildLearnedNotagenProviderRequest() includes motifGraphBlock when promptPack has globalMotifGraph
 * MGP-06: Python abc_prompt.py appends motifGraphBlock to prompt output
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeEval } from "./helpers/subprocess.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = path.join(repoRoot, "dist");

// ─── Python availability probe ────────────────────────────────────────────────

async function pythonAvailable() {
    for (const bin of ["python3", "python"]) {
        try {
            const { stdout } = await execFileAsync(bin, ["-c", "import sys; print(sys.version)"], {
                timeout: 5_000,
            });
            if (stdout.trim()) return bin;
        } catch {
            // continue
        }
    }
    return null;
}

// ─── Shared fixture ───────────────────────────────────────────────────────────

const SAMPLE_MOTIF_GRAPH = {
    motifId: "theme_a",
    sourceSectionId: "s1",
    requiredReturns: ["s3", "s4"],
    transformPath: [
        { sectionId: "s1", transform: "original",      dramaticFunction: "exposition",      required: false },
        { sectionId: "s2", transform: "fragmentation",  dramaticFunction: "destabilization", required: false, fragmentSpec: { start: 0, length: 2 } },
        { sectionId: "s3", transform: "sequence",       dramaticFunction: "intensification", required: true, harmonicContext: "dominant pedal" },
        { sectionId: "s4", transform: "augmentation",   dramaticFunction: "coda",            required: true },
    ],
    dramaticArc: ["exposition", "destabilization", "intensification", "coda"],
};

// ─── MGP-01~04: TypeScript buildMotifGraphBlock() tests ──────────────────────

test("MGP-01: buildMotifGraphBlock returns [AXIOM_MOTIF_GRAPH] block with correct header fields", async () => {
    const { stdout } = await runNodeEval(`
        const { buildMotifGraphBlock } = await import("./core/composer/learnedNotagenAdapter.js");
        const block = buildMotifGraphBlock(${JSON.stringify(SAMPLE_MOTIF_GRAPH)});
        console.log(JSON.stringify({ block }));
    `, { cwd: distDir });
    const { block } = JSON.parse(stdout);
    assert.ok(block, "should return a non-empty string");
    assert.ok(block.startsWith("[AXIOM_MOTIF_GRAPH]"), "should start with [AXIOM_MOTIF_GRAPH]");
    assert.ok(block.includes("source=s1"), "should include source=s1");
    assert.ok(block.includes("motif_id=theme_a"), "should include motif_id=theme_a");
    assert.ok(block.includes("required_returns=s3,s4"), "should include required_returns");
    assert.ok(block.endsWith("[/AXIOM_MOTIF_GRAPH]"), "should end with [/AXIOM_MOTIF_GRAPH]");
});

test("MGP-02: buildMotifGraphBlock emits per-section transform + dramatic_function lines", async () => {
    const { stdout } = await runNodeEval(`
        const { buildMotifGraphBlock } = await import("./core/composer/learnedNotagenAdapter.js");
        const block = buildMotifGraphBlock(${JSON.stringify(SAMPLE_MOTIF_GRAPH)});
        console.log(JSON.stringify({ block }));
    `, { cwd: distDir });
    const { block } = JSON.parse(stdout);
    assert.ok(block.includes("s1: transform=original dramatic_function=exposition"), "s1 line");
    assert.ok(block.includes("s2: transform=fragmentation dramatic_function=destabilization"), "s2 line");
    assert.ok(block.includes("s3: transform=sequence dramatic_function=intensification"), "s3 line");
    assert.ok(block.includes("s4: transform=augmentation dramatic_function=coda"), "s4 line");
});

test("MGP-03: buildMotifGraphBlock marks required=true for required return sections", async () => {
    const { stdout } = await runNodeEval(`
        const { buildMotifGraphBlock } = await import("./core/composer/learnedNotagenAdapter.js");
        const block = buildMotifGraphBlock(${JSON.stringify(SAMPLE_MOTIF_GRAPH)});
        console.log(JSON.stringify({ block }));
    `, { cwd: distDir });
    const { block } = JSON.parse(stdout);
    // s3 and s4 are required; s1 and s2 are not
    assert.ok(/s3:.*required=true/.test(block), "s3 should have required=true");
    assert.ok(/s4:.*required=true/.test(block), "s4 should have required=true");
    assert.ok(!/s1:.*required=true/.test(block), "s1 should not have required=true");
    assert.ok(!/s2:.*required=true/.test(block), "s2 should not have required=true");
});

test("MGP-04: buildMotifGraphBlock returns undefined when transformPath is empty", async () => {
    const emptyGraph = { ...SAMPLE_MOTIF_GRAPH, transformPath: [], dramaticArc: [] };
    const { stdout } = await runNodeEval(`
        const { buildMotifGraphBlock } = await import("./core/composer/learnedNotagenAdapter.js");
        const block = buildMotifGraphBlock(${JSON.stringify(emptyGraph)});
        console.log(JSON.stringify({ block: block ?? null }));
    `, { cwd: distDir });
    const { block } = JSON.parse(stdout);
    assert.strictEqual(block, null, "should return undefined (null in JSON) for empty transformPath");
});

test("MGP-05: buildLearnedNotagenProviderRequest includes motifGraphBlock when promptPack has globalMotifGraph", async () => {
    const { stdout } = await runNodeEval(`
        const { buildLearnedSymbolicPromptPack } = await import("./core/composer/learnedAdapter.js");
        const { buildLearnedNotagenProviderRequest } = await import("./core/composer/learnedNotagenAdapter.js");

        // Piano request using the solo_piano_symbolic lane (requires pianoPlan + Piano instrumentation)
        const request = {
            prompt: "Test piano piece with motif graph",
            form: "nocturne",
            key: "F minor",
            tempo: 72,
            targetInstrumentation: [
                { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] }
            ],
            compositionPlan: {
                brief: "Piano nocturne with motif arc",
                key: "F minor",
                form: "nocturne",
                tempo: 72,
                mood: ["lyrical"],
                instrumentation: [
                    { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] }
                ],
                orchestration: { family: "solo_piano", instrumentNames: ["Piano"], sections: [] },
                sections: [
                    { id: "s1", role: "theme_a", label: "Theme A", measures: 8, energy: 0.4, density: 0.35 }
                ],
                globalMotifGraph: ${JSON.stringify(SAMPLE_MOTIF_GRAPH)},
                pianoPlan: {
                    instrument: "Piano",
                    difficultyTarget: "intermediate",
                    sections: [
                        {
                            sectionId: "s1",
                            textureKind: "melody_accompaniment",
                            rightHand: {
                                hand: "right", primaryRoles: ["lead"],
                                registerMin: 60, registerMax: 84, maxComfortableSpan: 12
                            },
                            leftHand: {
                                hand: "left", primaryRoles: ["bass"],
                                registerMin: 36, registerMax: 60, maxComfortableSpan: 12
                            },
                            pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                            difficultyTarget: "intermediate"
                        }
                    ]
                }
            }
        };

        const promptPack = buildLearnedSymbolicPromptPack(request);
        const providerRequest = buildLearnedNotagenProviderRequest(promptPack, undefined);
        console.log(JSON.stringify({
            hasMotifGraphBlock: typeof providerRequest.motifGraphBlock === "string",
            motifGraphBlock: providerRequest.motifGraphBlock ?? null,
        }));
    `, { cwd: distDir });
    const result = JSON.parse(stdout);
    assert.ok(result.hasMotifGraphBlock, "providerRequest should have motifGraphBlock");
    assert.ok(result.motifGraphBlock.startsWith("[AXIOM_MOTIF_GRAPH]"), "should be a valid block");
    assert.ok(result.motifGraphBlock.includes("motif_id=theme_a"), "should include motif_id");
});

// ─── MGP-06: Python abc_prompt.py appends motifGraphBlock ───────────────────

test("MGP-06: Python abc_prompt.py appends motifGraphBlock to prompt output", async () => {
    const bin = await pythonAvailable();
    if (!bin) {
        console.log("  SKIP — python not available");
        return;
    }

    const providerRequest = {
        conditioningText: "Test conditioning",
        controlLines: [
            "lane=solo_piano_symbolic",
            "plan_signature=test_plan_v1",
            "prompt_pack_version=1",
            "abc_format=v2",
            "form=miniature",
            "key=C",
            "meter=4/4",
            "tempo=88",
            "instrumentation=piano",
            "section 1 id=s1 role=theme_a bars=8",
        ],
        motifGraphBlock: "[AXIOM_MOTIF_GRAPH]\nsource=s1\nmotif_id=theme_a\nrequired_returns=s3\ns1: transform=original dramatic_function=exposition\n[/AXIOM_MOTIF_GRAPH]",
    };

    const workerDir = path.join(repoRoot, "workers", "composer", "learned_symbolic");
    const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(workerDir)})
from abc_prompt import build_abc_prompt
req = ${JSON.stringify(providerRequest)}
result = build_abc_prompt(req)
print(json.dumps({ "prompt": result }))
`;

    const { stdout } = await execFileAsync(bin, ["-c", script], { timeout: 10_000, cwd: workerDir });
    const { prompt } = JSON.parse(stdout);
    assert.ok(typeof prompt === "string", "should return a string");
    assert.ok(prompt.includes("[AXIOM_MOTIF_GRAPH]"), "prompt should contain [AXIOM_MOTIF_GRAPH]");
    assert.ok(prompt.includes("motif_id=theme_a"), "prompt should include motif_id");
    assert.ok(prompt.includes("[/AXIOM_MOTIF_GRAPH]"), "prompt should end block correctly");
});
