/**
 * harmony-repair-prompt.test.mjs
 *
 * Validates the harmony-contract repair directive → [AXIOM_REPAIR] prompt block pipeline.
 *
 * HRP-01: buildHarmonyRepairBlock() returns [AXIOM_REPAIR] block for strengthen_cadence directive
 * HRP-02: buildHarmonyRepairBlock() returns [AXIOM_REPAIR] block for enforce_tonicization_window directive
 * HRP-03: buildHarmonyRepairBlock() returns undefined when no harmony-repair directives present
 * HRP-04: buildLearnedNotagenProviderRequest() sets repairBlock when rewriteSpec has harmony directives
 * HRP-05: Python abc_prompt.py appends repairBlock string to prompt output
 * HRP-06: Python localized_rewrite.build_repair_prompt_block() generates [AXIOM_REPAIR] block
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

// ─── HRP-01~04: TypeScript buildHarmonyRepairBlock() tests ───────────────────

test("HRP-01: buildHarmonyRepairBlock returns [AXIOM_REPAIR] block for strengthen_cadence", async () => {
    const { stdout } = await runNodeEval(`
        const { buildHarmonyRepairBlock } = await import("./core/composer/learnedNotagenAdapter.js");
        const block = buildHarmonyRepairBlock([
            { sectionId: "s3", kind: "strengthen_cadence", reason: "weak cadence" }
        ]);
        console.log(JSON.stringify({ block }));
    `, { cwd: distDir });
    const { block } = JSON.parse(stdout);
    assert.ok(block, "should return a non-empty string");
    assert.ok(block.startsWith("[AXIOM_REPAIR]"), "should start with [AXIOM_REPAIR]");
    assert.ok(block.includes("section=s3"), "should include section=s3");
    assert.ok(block.includes("action=strengthen_cadence"), "should include action=strengthen_cadence");
    assert.ok(block.includes("field=cadenceApproach"), "should include field=cadenceApproach");
    assert.ok(block.includes("instruction="), "should include instruction=");
    assert.ok(block.endsWith("[/AXIOM_REPAIR]"), "should end with [/AXIOM_REPAIR]");
});

test("HRP-02: buildHarmonyRepairBlock returns [AXIOM_REPAIR] block for enforce_tonicization_window", async () => {
    const { stdout } = await runNodeEval(`
        const { buildHarmonyRepairBlock } = await import("./core/composer/learnedNotagenAdapter.js");
        const block = buildHarmonyRepairBlock([
            { sectionId: "s4", kind: "enforce_tonicization_window", reason: "missing tonicization" }
        ]);
        console.log(JSON.stringify({ block }));
    `, { cwd: distDir });
    const { block } = JSON.parse(stdout);
    assert.ok(block, "should return a non-empty string");
    assert.ok(block.includes("section=s4"), "should include section=s4");
    assert.ok(block.includes("action=enforce_tonicization_window"), "should include action=enforce_tonicization_window");
    assert.ok(block.includes("field=tonicizationWindows"), "should include field=tonicizationWindows");
});

test("HRP-03: buildHarmonyRepairBlock returns undefined when no harmony-repair directives", async () => {
    const { stdout } = await runNodeEval(`
        const { buildHarmonyRepairBlock } = await import("./core/composer/learnedNotagenAdapter.js");
        const block = buildHarmonyRepairBlock([
            { sectionId: "s1", kind: "reduce_large_leaps", reason: "melodic leaps" },
            { sectionId: "s2", kind: "increase_rhythm_variety", reason: "rhythm monotony" }
        ]);
        console.log(JSON.stringify({ block: block ?? null }));
    `, { cwd: distDir });
    const { block } = JSON.parse(stdout);
    assert.strictEqual(block, null, "should return null (undefined) for non-harmony directive kinds");
});

test("HRP-04: buildLearnedNotagenProviderRequest sets repairBlock when rewriteSpec has harmony directives", async () => {
    const { stdout } = await runNodeEval(`
        const { buildLearnedNotagenProviderRequest } = await import("./core/composer/learnedNotagenAdapter.js");
        const { buildLearnedSymbolicPromptPack } = await import("./core/composer/learnedAdapter.js");

        // string_trio_symbolic lane: form=miniature + violin/viola/cello
        const request = {
            prompt: "A miniature string trio in C major",
            key: "C major",
            form: "miniature",
            workflow: "learned_symbolic",
            targetInstrumentation: [
                { name: "Violin", roles: ["melody"] },
                { name: "Viola", roles: ["inner"] },
                { name: "Cello", roles: ["bass"] },
            ],
        };

        const rewriteSpec = {
            rewriteSectionIds: ["s3"],
            keepSectionIds: ["s1", "s2"],
            reason: "harmony contract violation",
            directives: [
                { sectionId: "s3", kind: "strengthen_cadence", reason: "missing dominant preparation" },
                { sectionId: "s3", kind: "enforce_tonicization_window", reason: "no tonicization window" },
            ],
        };

        const promptPack = buildLearnedSymbolicPromptPack(request);
        const providerRequest = buildLearnedNotagenProviderRequest(promptPack, undefined, { localizedRewriteSpec: rewriteSpec });
        console.log(JSON.stringify({ hasRepairBlock: typeof providerRequest.repairBlock === "string", repairBlock: providerRequest.repairBlock ?? null }));
    `, { cwd: distDir });
    const { hasRepairBlock, repairBlock } = JSON.parse(stdout);
    assert.ok(hasRepairBlock, "providerRequest.repairBlock should be a string");
    assert.ok(repairBlock.startsWith("[AXIOM_REPAIR]"), "repairBlock should start with [AXIOM_REPAIR]");
    assert.ok(repairBlock.includes("action=strengthen_cadence"), "repairBlock should contain strengthen_cadence");
    assert.ok(repairBlock.includes("action=enforce_tonicization_window"), "repairBlock should contain enforce_tonicization_window");
});

// ─── HRP-05~06: Python-side tests ────────────────────────────────────────────

test("HRP-05: abc_prompt.py appends repairBlock to prompt output", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping Python-dependent test");
        return;
    }
    const scriptDir = path.join(repoRoot, "workers", "composer", "learned_symbolic").replace(/\\/g, "/");
    const { stdout } = await execFileAsync(
        py,
        ["-c", `
import sys, os, json
sys.path.insert(0, r'${scriptDir}')
from abc_prompt import build_notagen_input_string

provider_request = {
    "conditioningText": "A harmonic test piece",
    "controlLines": [
        "lane=learned_symbolic",
        "plan_signature=test|test|test|test|test|sig=abc123",
        "prompt_pack_version=v1",
        "abc_format=interleaved",
        "form=ABA",
        "key=C",
        "meter=4/4",
        "tempo=90",
        "instrumentation=Piano",
        "section id=s1 role=A measures=8 energy=0.6 density=0.5",
    ],
    "repairBlock": "[AXIOM_REPAIR]\\nsection=s3\\naction=strengthen_cadence\\nfield=cadenceApproach\\ninstruction=Make dominant preparation explicit.\\n[/AXIOM_REPAIR]",
}

result = build_notagen_input_string(provider_request)
print(json.dumps({ "has_repair": "[AXIOM_REPAIR]" in result, "result": result }))
`],
        { timeout: 10_000 },
    );
    const { has_repair } = JSON.parse(stdout.trim());
    assert.ok(has_repair, "prompt output should contain [AXIOM_REPAIR] block");
});

test("HRP-06: localized_rewrite.build_repair_prompt_block generates [AXIOM_REPAIR] block", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping Python-dependent test");
        return;
    }
    const scriptDir = path.join(repoRoot, "workers", "composer", "learned_symbolic").replace(/\\/g, "/");
    const { stdout } = await execFileAsync(
        py,
        ["-c", `
import sys, os, json
sys.path.insert(0, r'${scriptDir}')
from localized_rewrite import build_repair_prompt_block

directives = [
    {"sectionId": "s3", "kind": "strengthen_cadence", "reason": "weak cadence"},
    {"sectionId": "s4", "kind": "enforce_tonicization_window", "reason": "no tonicization"},
]
block = build_repair_prompt_block(directives)
print(json.dumps({
    "block": block,
    "has_repair_header": block is not None and "[AXIOM_REPAIR]" in block,
    "has_s3": block is not None and "section=s3" in block,
    "has_s4": block is not None and "section=s4" in block,
}))
`],
        { timeout: 10_000 },
    );
    const result = JSON.parse(stdout.trim());
    assert.ok(result.has_repair_header, "block should contain [AXIOM_REPAIR]");
    assert.ok(result.has_s3, "block should contain section=s3");
    assert.ok(result.has_s4, "block should contain section=s4");
});
