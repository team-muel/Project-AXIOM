/**
 * benchmark-notagen-control-ablation.mjs
 *
 * Measures the incremental contribution of each AXIOM control block added on top
 * of a plain NotaGen prompt.  Because a real NotaGen endpoint is not required, the
 * benchmark evaluates prompt *structure* — controlLines count, presence of each
 * AXIOM block, estimated token budget, and static validation.  This is the
 * correct level of verification before an actual model is wired in.
 *
 * Ablation levels (A → E):
 *   A  Plain NotaGen: period / composer / instrumentation only
 *   B  + Section control lines (section id, role, key, phraseCount …)
 *   C  + Motif graph block  ([AXIOM_MOTIF_GRAPH])
 *   D  + Harmony repair block ([AXIOM_REPAIR])
 *   E  + Piano rewrite block  (<AXIOM_PIANO_REWRITE>)
 *
 * Usage:
 *   node scripts/benchmark-notagen-control-ablation.mjs [--json] [--out=<file>]
 *
 * Output (text, default):
 *   Level | controlLines | hasMotifGraph | hasRepair | hasPianoRewrite | estTokens
 *   ------+..............+...............+...........+-----------------+----------
 *   A     |   7          | false         | false     | false           | 312
 *   …
 *
 * Exit code 0 on success; 1 if any validation assertion fails.
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const require = createRequire(import.meta.url);

// ─── Load dist/ exports ───────────────────────────────────────────────────────
let buildHarmonyRepairBlock, buildMotifGraphBlock, buildPianoRewriteBlock, buildLearnedNotagenProviderRequest;

try {
    const mod = require("../dist/core/composer/learnedNotagenAdapter.js");
    buildHarmonyRepairBlock = mod.buildHarmonyRepairBlock;
    buildMotifGraphBlock    = mod.buildMotifGraphBlock;
    buildPianoRewriteBlock  = mod.buildPianoRewriteBlock;
    buildLearnedNotagenProviderRequest = mod.buildLearnedNotagenProviderRequest;
} catch (err) {
    console.error("ERROR: Could not load dist/core/composer/learnedNotagenAdapter.js");
    console.error("       Run `npm run build` first.");
    console.error(err.message);
    exit(1);
}

// ─── Parse CLI args ───────────────────────────────────────────────────────────
const asJson = argv.includes("--json");
const outArg = argv.find((a) => a.startsWith("--out="));
const outFile = outArg ? outArg.slice("--out=".length) : null;

// ─── Fixture factories ────────────────────────────────────────────────────────
function makeSection(id, role = "theme_a") {
    return {
        sectionId: id,
        role,
        label: role.replace(/_/g, " "),
        phraseCount: 4,
        energy: 0.6,
        density: 0.5,
        measures: 8,
        motifRef: "none",
        key: "C",
        mode: "major",
    };
}

function makeBasePromptPack(withSections = false) {
    return {
        lane: "string_trio_symbolic",
        planSignature: "ablation-test-plan",
        version: "v1",
        instrumentation: [], // empty → resolves to default via lane fallback
        styleCue: {
            form: "sonata",
            key: "C",
            meter: "4/4",
            tempo: 96,
            mood: ["serene", "expressive"],
            riskProfile: "moderate",
        },
        sections: withSections
            ? [makeSection("s1", "theme_a"), makeSection("s2", "development"), makeSection("s3", "recap")]
            : [],
    };
}

function makeLocalizedRewriteSpec(directives) {
    return {
        rewriteSectionIds: ["s2"],
        keepSectionIds: ["s1", "s3"],
        reason: "harmony contract violations in development",
        directives,
    };
}

function makeHarmonyRepairDirectives() {
    return [
        {
            kind: "strengthen_cadence",
            sectionId: "s2",
            reason: "Make dominant preparation explicit before the final arrival.",
            priority: 1,
        },
        {
            kind: "enforce_tonicization_window",
            sectionId: "s2",
            reason: "Realize a clear local tonicization window before recap.",
            priority: 2,
        },
    ];
}

function makeMotifGraph() {
    return {
        sourceSectionId: "s1",
        motifId: "theme_a",
        requiredReturns: ["s3"],
        transformPath: [
            { sectionId: "s1", transform: "original",     dramaticFunction: "exposition" },
            { sectionId: "s2", transform: "fragmentation", dramaticFunction: "destabilization", required: false },
            { sectionId: "s3", transform: "exact_return", dramaticFunction: "resolution", required: true },
        ],
    };
}

function makePianoRewriteSpec() {
    return {
        rewriteSectionIds: ["s2"],
        keepSectionIds: ["s1", "s3"],
        reason: "melody prominence below threshold",
        repairAlreadyApplied: false,
        directives: [
            {
                kind: "clarify_right_hand_melody",
                sectionId: "s2",
                reason: "Melody prominence score is below threshold.",
                priority: 1,
                fallbackStrategy: "repairSolver",
            },
            {
                kind: "strengthen_left_hand_bass",
                sectionId: "s2",
                reason: "Bass root support below threshold.",
                priority: 2,
                fallbackStrategy: "repairSolver",
            },
        ],
    };
}

// ─── Ablation Levels ──────────────────────────────────────────────────────────

function buildLevelA() {
    // Plain: minimal pack, no sections, no special blocks
    const req = buildLearnedNotagenProviderRequest(makeBasePromptPack(false), undefined);
    return req;
}

function buildLevelB() {
    // + Section control lines
    const req = buildLearnedNotagenProviderRequest(makeBasePromptPack(true), undefined);
    return req;
}

function buildLevelC() {
    // + Motif graph block
    const pack = { ...makeBasePromptPack(true), globalMotifGraph: makeMotifGraph() };
    const req = buildLearnedNotagenProviderRequest(pack, undefined);
    return req;
}

function buildLevelD() {
    // + Harmony repair block (via localizedRewriteSpec with harmony directives)
    const pack = { ...makeBasePromptPack(true), globalMotifGraph: makeMotifGraph() };
    const rewriteSpec = makeLocalizedRewriteSpec(makeHarmonyRepairDirectives());
    const req = buildLearnedNotagenProviderRequest(pack, undefined, { localizedRewriteSpec: rewriteSpec });
    return req;
}

function buildLevelE() {
    // + Piano rewrite block
    const pack = { ...makeBasePromptPack(true), globalMotifGraph: makeMotifGraph() };
    const rewriteSpec = makeLocalizedRewriteSpec(makeHarmonyRepairDirectives());
    const pianoSpec = makePianoRewriteSpec();
    const req = buildLearnedNotagenProviderRequest(pack, undefined, {
        localizedRewriteSpec: rewriteSpec,
        localizedPianoRewriteSpec: pianoSpec,
    });
    return req;
}

// ─── Metrics extraction ───────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4; // rough estimate; close enough for ablation comparison

function estTokens(req) {
    const allText = [
        req.conditioningText ?? "",
        (req.controlLines ?? []).join("\n"),
        (req.softConstraintLines ?? []).join("\n"),
        req.repairBlock ?? "",
        req.motifGraphBlock ?? "",
        req.pianoRewriteBlock ?? "",
        req.abcHeader ?? "",
    ].join("\n");
    return Math.round(allText.length / CHARS_PER_TOKEN);
}

function analyzeRequest(label, req) {
    return {
        level: label,
        controlLinesCount: (req.controlLines ?? []).length,
        hasMotifGraphBlock: Boolean(req.motifGraphBlock),
        hasRepairBlock: Boolean(req.repairBlock),
        hasPianoRewriteBlock: Boolean(req.pianoRewriteBlock),
        hasRewriteSpec: Boolean(req.rewriteSpec),
        hasPianoRewriteSpec: Boolean(req.pianoRewriteSpec),
        motifGraphLines: req.motifGraphBlock ? req.motifGraphBlock.split("\n").length : 0,
        repairBlockLines: req.repairBlock ? req.repairBlock.split("\n").length : 0,
        pianoRewriteLines: req.pianoRewriteBlock ? req.pianoRewriteBlock.split("\n").length : 0,
        estTokens: estTokens(req),
    };
}

// ─── Static validation assertions ────────────────────────────────────────────

function assertStrictlyIncreasing(key, results) {
    for (let i = 1; i < results.length; i++) {
        if (results[i][key] < results[i - 1][key]) {
            throw new Error(
                `[ABLATION] ${key} should not decrease from level ${results[i - 1].level} (${results[i - 1][key]}) ` +
                `to level ${results[i].level} (${results[i][key]})`,
            );
        }
    }
}

function validateResults(results) {
    const errors = [];

    // Level A: no AXIOM blocks
    const a = results.find((r) => r.level === "A");
    if (a.hasMotifGraphBlock) errors.push("Level A should NOT have motifGraphBlock");
    if (a.hasRepairBlock)     errors.push("Level A should NOT have repairBlock");
    if (a.hasPianoRewriteBlock) errors.push("Level A should NOT have pianoRewriteBlock");

    // Level B: more controlLines than A (sections added)
    const b = results.find((r) => r.level === "B");
    if (b.controlLinesCount <= a.controlLinesCount) {
        errors.push(`Level B controlLines (${b.controlLinesCount}) should exceed level A (${a.controlLinesCount})`);
    }

    // Level C: must have motif graph
    const c = results.find((r) => r.level === "C");
    if (!c.hasMotifGraphBlock) errors.push("Level C should have motifGraphBlock");
    if (c.hasRepairBlock)      errors.push("Level C should NOT have repairBlock");

    // Level D: must have motif graph + repair block
    const d = results.find((r) => r.level === "D");
    if (!d.hasMotifGraphBlock) errors.push("Level D should have motifGraphBlock");
    if (!d.hasRepairBlock)     errors.push("Level D should have repairBlock");
    if (d.hasPianoRewriteBlock) errors.push("Level D should NOT have pianoRewriteBlock");

    // Level E: must have all blocks
    const e = results.find((r) => r.level === "E");
    if (!e.hasMotifGraphBlock)  errors.push("Level E should have motifGraphBlock");
    if (!e.hasRepairBlock)      errors.push("Level E should have repairBlock");
    if (!e.hasPianoRewriteBlock) errors.push("Level E should have pianoRewriteBlock");

    // Token count must not decrease as we add more control
    assertStrictlyIncreasing("estTokens", results);

    return errors;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

function run() {
    const levels = [
        analyzeRequest("A", buildLevelA()),
        analyzeRequest("B", buildLevelB()),
        analyzeRequest("C", buildLevelC()),
        analyzeRequest("D", buildLevelD()),
        analyzeRequest("E", buildLevelE()),
    ];

    const errors = validateResults(levels);

    if (asJson || outFile) {
        const output = {
            benchmarkId: "notagen-control-ablation",
            timestamp: new Date().toISOString(),
            description: "Measures incremental prompt growth per AXIOM control block: A(plain) → B(+sections) → C(+motifGraph) → D(+harmonyRepair) → E(+pianoRewrite)",
            levels,
            validationErrors: errors,
            passed: errors.length === 0,
        };
        const json = JSON.stringify(output, null, 2);
        if (outFile) {
            writeFileSync(outFile, json, "utf8");
            console.log(`Benchmark results written to ${outFile}`);
        }
        if (asJson) {
            console.log(json);
        }
    } else {
        // Human-readable table
        const header = ["Level", "ctrlLines", "motifGraph", "repairBlk", "pianoRewrite", "estTokens"].join(" | ");
        const divider = header.replace(/[^|]/g, "-").replace(/\|/g, "+");
        console.log("\n=== NotaGen Control Ablation Benchmark ===");
        console.log(`${"Level".padEnd(5)} | ${"ctrlLines".padEnd(9)} | ${"motifGraph".padEnd(10)} | ${"repairBlk".padEnd(9)} | ${"pianoRewrite".padEnd(12)} | estTokens`);
        console.log("------+-----------+------------+-----------+--------------+----------");
        for (const r of levels) {
            console.log(
                `${r.level.padEnd(5)} | ${String(r.controlLinesCount).padEnd(9)} | ${String(r.hasMotifGraphBlock).padEnd(10)} | ${String(r.hasRepairBlock).padEnd(9)} | ${String(r.hasPianoRewriteBlock).padEnd(12)} | ${r.estTokens}`,
            );
        }
        console.log("");

        // Block line counts (incremental contribution)
        console.log("=== Incremental block line counts ===");
        for (const r of levels) {
            if (r.motifGraphLines > 0 || r.repairBlockLines > 0 || r.pianoRewriteLines > 0) {
                console.log(`  Level ${r.level}: motifGraph=${r.motifGraphLines}L  repair=${r.repairBlockLines}L  pianoRewrite=${r.pianoRewriteLines}L`);
            }
        }
        console.log("");
    }

    if (errors.length > 0) {
        console.error("=== VALIDATION FAILURES ===");
        for (const e of errors) console.error(`  FAIL: ${e}`);
        exit(1);
    }

    if (!asJson && !outFile) {
        console.log("All ablation assertions passed ✓");
    }
}

run();
