/**
 * benchmark-notagen-control-ablation.mjs
 *
 * Measures the incremental contribution of each AXIOM control block added on top
 * of a plain NotaGen prompt.
 *
 * ── TWO MODES ──────────────────────────────────────────────────────────────────
 *
 * 1. Prompt-structure mode (default, no model required):
 *    Evaluates prompt *structure* — controlLines count, presence of each AXIOM
 *    block, estimated token budget, and expected score thresholds per level.
 *    Run: node scripts/benchmark-notagen-control-ablation.mjs
 *
 * 2. Score-aggregation mode (requires real candidate manifests):
 *    Scans all candidate manifests in --scores-from=<dir> and groups them by
 *    ablation level (inferred from which control blocks are present on the
 *    learnedNotagenProviderRequest).  Computes mean±SD for each metric per level
 *    and compares against expectations.
 *    Run: node scripts/benchmark-notagen-control-ablation.mjs --scores-from=outputs
 *
 * ── ABLATION LEVELS ────────────────────────────────────────────────────────────
 *
 *   A  Plain NotaGen: period / composer / instrumentation only
 *   B  + Section control lines  (section id, role, key, phraseCount ...)
 *   C  + Phrase / harmony / motif control lines  (phraseFunction, cadence, harmonicPlan, motifRef)
 *   D  + Motif graph block  ([AXIOM_MOTIF_GRAPH])
 *   E  + Harmony repair block  ([AXIOM_REPAIR])
 *   F  + Piano rewrite block  (<AXIOM_PIANO_REWRITE>)
 *
 * ── EXPECTED SCORE THRESHOLDS ──────────────────────────────────────────────────
 *   Level | evidenceCoverage | finalCraft | advancedCraft | harmonyContract | motifRecapIdentity
 *   ------+------------------+------------+---------------+-----------------+-------------------
 *   A     | >=0.30           | >=0.50     | >=0.40        |                 |
 *   B     | >=0.40           | >=0.55     | >=0.45        |                 |
 *   C     | >=0.50           | >=0.60     | >=0.50        | >=0.55          |
 *   D     | >=0.55           | >=0.63     | >=0.53        | >=0.60          | >=0.50
 *   E     | >=0.55           | >=0.65     | >=0.55        | >=0.70          | >=0.50
 *   F     | >=0.55           | >=0.65     | >=0.55        | >=0.70          | >=0.50  piano>=0.60
 *
 * Usage:
 *   node scripts/benchmark-notagen-control-ablation.mjs [--json] [--out=<file>]
 *   node scripts/benchmark-notagen-control-ablation.mjs --scores-from=outputs [--json] [--out=<file>]
 *
 * Exit code 0 on success; 1 if any validation assertion fails.
 */

import { createRequire } from "node:module";
import { writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const require = createRequire(import.meta.url);

// ── Load dist/ exports ────────────────────────────────────────────────────────
let buildLearnedNotagenProviderRequest;

try {
    const mod = require("../dist/core/composer/learnedNotagenAdapter.js");
    buildLearnedNotagenProviderRequest = mod.buildLearnedNotagenProviderRequest;
} catch (err) {
    console.error("ERROR: Could not load dist/core/composer/learnedNotagenAdapter.js");
    console.error("       Run `npm run build` first.");
    console.error(err.message);
    exit(1);
}

// ── Parse CLI args ────────────────────────────────────────────────────────────
const asJson        = argv.includes("--json");
const outArg        = argv.find((a) => a.startsWith("--out="));
const outFile       = outArg ? outArg.slice("--out=".length) : null;
const scoresFromArg = argv.find((a) => a.startsWith("--scores-from="));
const scoresFromDir = scoresFromArg ? scoresFromArg.slice("--scores-from=".length) : null;

// ── Score expectations per level ──────────────────────────────────────────────
const SCORE_EXPECTATIONS = {
    A: { evidenceCoverageScore: 0.30, finalCraftScore: 0.50, advancedCraftScore: 0.40 },
    B: { evidenceCoverageScore: 0.40, finalCraftScore: 0.55, advancedCraftScore: 0.45 },
    C: { evidenceCoverageScore: 0.50, finalCraftScore: 0.60, advancedCraftScore: 0.50, harmonyContractScore: 0.55 },
    D: { evidenceCoverageScore: 0.55, finalCraftScore: 0.63, advancedCraftScore: 0.53, harmonyContractScore: 0.60, motifRecapIdentity: 0.50 },
    E: { evidenceCoverageScore: 0.55, finalCraftScore: 0.65, advancedCraftScore: 0.55, harmonyContractScore: 0.70, motifRecapIdentity: 0.50 },
    F: { evidenceCoverageScore: 0.55, finalCraftScore: 0.65, advancedCraftScore: 0.55, harmonyContractScore: 0.70, motifRecapIdentity: 0.50, pianoListenabilityScore: 0.60 },
};

// ── Fixture factories ─────────────────────────────────────────────────────────
function makeSection(id, role, withRichControl) {
    const base = {
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
    if (!withRichControl) return base;
    return {
        ...base,
        phraseFunction: role === "theme_a" ? "antecedent" : role === "development" ? "continuation" : "consequent",
        cadence: role === "recap" ? "perfect_authentic" : "half",
        motifRef: role === "theme_a" ? "theme_a" : role === "recap" ? "theme_a_return" : "none",
        harmonicPlan: {
            tonalCenter: "C",
            harmonicRhythm: "slow",
            keyTarget: role === "development" ? "A minor" : "C",
            prolongationMode: role === "theme_a" ? "tonic" : undefined,
        },
    };
}

function makeBasePromptPack(sectionMode) {
    const withSections = sectionMode !== "none";
    const withRich = sectionMode === "rich";
    return {
        lane: "string_trio_symbolic",
        planSignature: "ablation-test-plan",
        version: "v1",
        instrumentation: [],
        styleCue: {
            form: "sonata",
            key: "C major",
            meter: "4/4",
            tempo: 96,
            mood: ["serene", "expressive"],
            riskProfile: "moderate",
        },
        sections: withSections
            ? [
                makeSection("s1", "theme_a", withRich),
                makeSection("s2", "development", withRich),
                makeSection("s3", "recap", withRich),
              ]
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
        { kind: "strengthen_cadence", sectionId: "s2", reason: "Make dominant preparation explicit before the final arrival.", priority: 1 },
        { kind: "enforce_tonicization_window", sectionId: "s2", reason: "Realize a clear local tonicization window before recap.", priority: 2 },
    ];
}

function makeMotifGraph() {
    return {
        sourceSectionId: "s1",
        motifId: "theme_a",
        requiredReturns: ["s3"],
        transformPath: [
            { sectionId: "s1", transform: "original",      dramaticFunction: "exposition" },
            { sectionId: "s2", transform: "fragmentation", dramaticFunction: "destabilization", required: false },
            { sectionId: "s3", transform: "exact_return",  dramaticFunction: "resolution", required: true },
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
            { kind: "clarify_right_hand_melody",   sectionId: "s2", reason: "Melody prominence score is below threshold.", priority: 1, fallbackStrategy: "repairSolver" },
            { kind: "strengthen_left_hand_bass",   sectionId: "s2", reason: "Bass root support below threshold.",           priority: 2, fallbackStrategy: "repairSolver" },
        ],
    };
}

// ── Ablation level builders ───────────────────────────────────────────────────

function buildLevelA() {
    return buildLearnedNotagenProviderRequest(makeBasePromptPack("none"), undefined);
}
function buildLevelB() {
    return buildLearnedNotagenProviderRequest(makeBasePromptPack("plain"), undefined);
}
function buildLevelC() {
    return buildLearnedNotagenProviderRequest(makeBasePromptPack("rich"), undefined);
}
function buildLevelD() {
    const pack = { ...makeBasePromptPack("rich"), globalMotifGraph: makeMotifGraph() };
    return buildLearnedNotagenProviderRequest(pack, undefined);
}
function buildLevelE() {
    const pack = { ...makeBasePromptPack("rich"), globalMotifGraph: makeMotifGraph() };
    const rewriteSpec = makeLocalizedRewriteSpec(makeHarmonyRepairDirectives());
    return buildLearnedNotagenProviderRequest(pack, undefined, { localizedRewriteSpec: rewriteSpec });
}
function buildLevelF() {
    const pack = { ...makeBasePromptPack("rich"), globalMotifGraph: makeMotifGraph() };
    const rewriteSpec = makeLocalizedRewriteSpec(makeHarmonyRepairDirectives());
    const pianoSpec = makePianoRewriteSpec();
    return buildLearnedNotagenProviderRequest(pack, undefined, {
        localizedRewriteSpec: rewriteSpec,
        localizedPianoRewriteSpec: pianoSpec,
    });
}

// ── Prompt-structure metrics ──────────────────────────────────────────────────
const CHARS_PER_TOKEN = 4;

function estTokens(req) {
    const text = [
        req.conditioningText ?? "",
        (req.controlLines ?? []).join("\n"),
        (req.softConstraintLines ?? []).join("\n"),
        req.repairBlock ?? "",
        req.motifGraphBlock ?? "",
        req.pianoRewriteBlock ?? "",
        req.abcHeader ?? "",
    ].join("\n");
    return Math.round(text.length / CHARS_PER_TOKEN);
}

function analyzeRequest(label, req) {
    const richControlIndicators = (req.controlLines ?? []).filter((l) =>
        l.includes("tonal_center=") || l.includes("prolongation=") || l.includes("harmonic_rhythm=") || l.includes("motif_ref=theme_a"),
    ).length;

    return {
        level: label,
        controlLinesCount: (req.controlLines ?? []).length,
        richControlLines: richControlIndicators,
        hasMotifGraphBlock: Boolean(req.motifGraphBlock),
        hasRepairBlock: Boolean(req.repairBlock),
        hasPianoRewriteBlock: Boolean(req.pianoRewriteBlock),
        hasRewriteSpec: Boolean(req.rewriteSpec),
        hasPianoRewriteSpec: Boolean(req.pianoRewriteSpec),
        motifGraphLines: req.motifGraphBlock ? req.motifGraphBlock.split("\n").length : 0,
        repairBlockLines: req.repairBlock ? req.repairBlock.split("\n").length : 0,
        pianoRewriteLines: req.pianoRewriteBlock ? req.pianoRewriteBlock.split("\n").length : 0,
        estTokens: estTokens(req),
        expectedScores: SCORE_EXPECTATIONS[label] ?? {},
    };
}

// ── Static validation assertions ──────────────────────────────────────────────
function assertNonDecreasing(key, results) {
    for (let i = 1; i < results.length; i++) {
        if (results[i][key] < results[i - 1][key]) {
            throw new Error(
                `[ABLATION] ${key} decreased from level ${results[i - 1].level} (${results[i - 1][key]}) ` +
                `to level ${results[i].level} (${results[i][key]})`,
            );
        }
    }
}

function validateResults(results) {
    const errors = [];
    const byLevel = Object.fromEntries(results.map((r) => [r.level, r]));

    if (byLevel.A.hasMotifGraphBlock)  errors.push("Level A should NOT have motifGraphBlock");
    if (byLevel.A.hasRepairBlock)      errors.push("Level A should NOT have repairBlock");
    if (byLevel.A.hasPianoRewriteBlock) errors.push("Level A should NOT have pianoRewriteBlock");

    if (byLevel.B.controlLinesCount <= byLevel.A.controlLinesCount) {
        errors.push(`Level B controlLines (${byLevel.B.controlLinesCount}) should exceed A (${byLevel.A.controlLinesCount})`);
    }
    if (byLevel.C.controlLinesCount < byLevel.B.controlLinesCount) {
        errors.push(`Level C controlLines (${byLevel.C.controlLinesCount}) should be >= B (${byLevel.B.controlLinesCount})`);
    }

    if (!byLevel.D.hasMotifGraphBlock) errors.push("Level D should have motifGraphBlock");
    if (byLevel.D.hasRepairBlock)      errors.push("Level D should NOT have repairBlock");

    if (!byLevel.E.hasMotifGraphBlock)  errors.push("Level E should have motifGraphBlock");
    if (!byLevel.E.hasRepairBlock)      errors.push("Level E should have repairBlock");
    if (byLevel.E.hasPianoRewriteBlock) errors.push("Level E should NOT have pianoRewriteBlock");

    if (!byLevel.F.hasMotifGraphBlock)   errors.push("Level F should have motifGraphBlock");
    if (!byLevel.F.hasRepairBlock)       errors.push("Level F should have repairBlock");
    if (!byLevel.F.hasPianoRewriteBlock) errors.push("Level F should have pianoRewriteBlock");

    try { assertNonDecreasing("estTokens", results); } catch (e) { errors.push(e.message); }

    return errors;
}

// ── Score-aggregation mode ────────────────────────────────────────────────────
function classifyManifestLevel(manifest) {
    const req = manifest.learnedNotagenProviderRequest ?? manifest.proposalEvidence?.providerRequest;
    if (!req || req.adapter !== "notagen_class") return null;

    if (req.pianoRewriteBlock) return "F";
    if (req.repairBlock)       return "E";
    if (req.motifGraphBlock)   return "D";

    const hasRichLines = (req.controlLines ?? []).some((l) =>
        l.includes("tonal_center=") || l.includes("prolongation=") || l.includes("harmonic_rhythm="),
    );
    const hasSections = (req.controlLines ?? []).some((l) => l.startsWith("section "));
    if (hasRichLines && hasSections) return "C";
    if (hasSections)                 return "B";
    return "A";
}

function extractScores(manifest) {
    const craft = manifest.structureEvaluation?.craftScoreSummary ?? manifest.internalCriticApproval;
    const piano = manifest.structureEvaluation?.pianoCraftScoreSummary ?? manifest.pianoCraftScore;
    return {
        evidenceCoverageScore:   craft?.evidenceCoverageScore ?? null,
        finalCraftScore:         craft?.finalCraftScore ?? null,
        advancedCraftScore:      craft?.advancedCraftScore ?? null,
        harmonyContractScore:    craft?.harmonyContractScore ?? null,
        motifRecapIdentity:      craft?.motifReturnScore ?? null,
        motifTransformVariety:   craft?.motifDevelopmentScore ?? null,
        pianoListenabilityScore: piano?.pianoListenabilityScore ?? null,
        // Populated when pipeline stores it in structureEvaluation or manifest root
        referenceDistanceScore:  manifest.structureEvaluation?.referenceDistanceScore
            ?? manifest.referenceDistanceScore
            ?? null,
    };
}

function loadCandidateManifests(rootDir) {
    const manifests = [];
    if (!existsSync(rootDir)) return manifests;
    try {
        const songs = readdirSync(rootDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
            .map((d) => d.name);
        for (const songId of songs) {
            const dir = join(rootDir, songId, "candidates");
            if (!existsSync(dir)) continue;
            const files = readdirSync(dir, { withFileTypes: true })
                .filter((f) => f.isFile() && f.name.endsWith(".json") && f.name !== "index.json")
                .map((f) => f.name);
            for (const file of files) {
                try {
                    const raw = readFileSync(join(dir, file), "utf-8");
                    manifests.push({ songId, manifest: JSON.parse(raw) });
                } catch { /* skip malformed */ }
            }
        }
    } catch { /* skip inaccessible */ }
    return manifests;
}

function computeStats(values) {
    const valid = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
    if (valid.length === 0) return { n: 0, mean: null, sd: null, min: null, max: null };
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const variance = valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length;
    return {
        n: valid.length,
        mean: Math.round(mean * 1000) / 1000,
        sd:   Math.round(Math.sqrt(variance) * 1000) / 1000,
        min:  Math.round(Math.min(...valid) * 1000) / 1000,
        max:  Math.round(Math.max(...valid) * 1000) / 1000,
    };
}

function aggregateScores(rootDir) {
    const entries = loadCandidateManifests(rootDir);
    const groups = { A: [], B: [], C: [], D: [], E: [], F: [] };
    for (const { manifest } of entries) {
        const level = classifyManifestLevel(manifest);
        if (!level) continue;
        groups[level].push(extractScores(manifest));
    }
    const SCORE_KEYS = [
        "evidenceCoverageScore", "finalCraftScore", "advancedCraftScore",
        "harmonyContractScore", "motifRecapIdentity", "motifTransformVariety",
        "pianoListenabilityScore", "referenceDistanceScore",
    ];
    return Object.entries(groups).map(([level, items]) => {
        const stats = {};
        for (const key of SCORE_KEYS) {
            stats[key] = computeStats(items.map((s) => s[key]));
        }
        return { level, n: items.length, stats, expected: SCORE_EXPECTATIONS[level] ?? {} };
    });
}

// ── Runners ───────────────────────────────────────────────────────────────────
function runPromptStructure() {
    const levels = [
        analyzeRequest("A", buildLevelA()),
        analyzeRequest("B", buildLevelB()),
        analyzeRequest("C", buildLevelC()),
        analyzeRequest("D", buildLevelD()),
        analyzeRequest("E", buildLevelE()),
        analyzeRequest("F", buildLevelF()),
    ];
    const errors = validateResults(levels);

    if (asJson || outFile) {
        const output = {
            benchmarkId: "notagen-control-ablation",
            mode: "prompt-structure",
            timestamp: new Date().toISOString(),
            description: "A(plain) -> B(+sections) -> C(+richControl) -> D(+motifGraph) -> E(+harmonyRepair) -> F(+pianoRewrite)",
            levels,
            validationErrors: errors,
            passed: errors.length === 0,
        };
        const json = JSON.stringify(output, null, 2);
        if (outFile) { writeFileSync(outFile, json, "utf8"); console.log(`Results written to ${outFile}`); }
        if (asJson)  { console.log(json); }
    } else {
        console.log("\n=== NotaGen Control Ablation Benchmark (prompt-structure mode) ===");
        console.log(`${"Level".padEnd(5)} | ${"ctrlLines".padEnd(9)} | ${"richCtrl".padEnd(8)} | ${"motifGph".padEnd(8)} | ${"repairBlk".padEnd(9)} | ${"pianoRwrt".padEnd(9)} | estTokens`);
        console.log("------+-----------+----------+----------+-----------+-----------+----------");
        for (const r of levels) {
            console.log(`${r.level.padEnd(5)} | ${String(r.controlLinesCount).padEnd(9)} | ${String(r.richControlLines).padEnd(8)} | ${String(r.hasMotifGraphBlock).padEnd(8)} | ${String(r.hasRepairBlock).padEnd(9)} | ${String(r.hasPianoRewriteBlock).padEnd(9)} | ${r.estTokens}`);
        }
        console.log("");
        console.log("=== Block line counts (incremental contribution) ===");
        for (const r of levels) {
            if (r.motifGraphLines > 0 || r.repairBlockLines > 0 || r.pianoRewriteLines > 0) {
                console.log(`  Level ${r.level}: motifGraph=${r.motifGraphLines}L  repair=${r.repairBlockLines}L  pianoRewrite=${r.pianoRewriteLines}L`);
            }
        }
        console.log("");
        console.log("=== Expected score thresholds per level ===");
        console.log("  (Run with --scores-from=<outputs-dir> to compare against real candidate manifests)");
        for (const r of levels) {
            const exp = r.expectedScores;
            const keys = Object.keys(exp);
            if (keys.length === 0) continue;
            const parts = keys.map((k) => `${k.replace(/Score$/, "").replace("Coverage", "Cov")}>=` + exp[k]).join("  ");
            console.log(`  Level ${r.level}: ${parts}`);
        }
        console.log("");
    }

    if (errors.length > 0) {
        console.error("=== VALIDATION FAILURES ===");
        for (const e of errors) console.error(`  FAIL: ${e}`);
        exit(1);
    }
    if (!asJson && !outFile) console.log("All ablation assertions passed");
}

function runScoreAggregation(rootDir) {
    const aggregated = aggregateScores(rootDir);
    const total = aggregated.reduce((s, r) => s + r.n, 0);

    if (total === 0) {
        console.warn(`No notagen_class candidate manifests found under ${rootDir}`);
        console.warn("Generate some candidates with LEARNED_SYMBOLIC_BACKEND=notagen_local first.");
        exit(0);
    }

    const SCORE_KEYS = [
        "evidenceCoverageScore", "finalCraftScore", "advancedCraftScore",
        "harmonyContractScore", "motifRecapIdentity", "motifTransformVariety",
        "pianoListenabilityScore", "referenceDistanceScore",
    ];

    if (asJson || outFile) {
        const output = {
            benchmarkId: "notagen-control-ablation",
            mode: "score-aggregation",
            timestamp: new Date().toISOString(),
            scoresFrom: rootDir,
            totalCandidates: total,
            levels: aggregated,
        };
        const json = JSON.stringify(output, null, 2);
        if (outFile) { writeFileSync(outFile, json, "utf8"); console.log(`Results written to ${outFile}`); }
        if (asJson)  { console.log(json); }
        return;
    }

    console.log(`\n=== NotaGen Control Ablation Benchmark (score-aggregation mode, ${total} candidates) ===`);
    console.log(`Scores from: ${rootDir}\n`);
    for (const row of aggregated) {
        if (row.n === 0) continue;
        console.log(`Level ${row.level}  (n=${row.n})`);
        for (const key of SCORE_KEYS) {
            const s = row.stats[key];
            if (s.n === 0) continue;
            const exp = row.expected[key];
            const status = exp !== undefined ? (s.mean !== null && s.mean >= exp ? "pass" : "FAIL") : "    ";
            const expStr = exp !== undefined ? ` (expected >=${exp})` : "";
            console.log(`  [${status}] ${key.padEnd(26)} mean=${s.mean} sd=${s.sd} [${s.min}-${s.max}] n=${s.n}${expStr}`);
        }
        console.log("");
    }
}

// ── Entry ─────────────────────────────────────────────────────────────────────
if (scoresFromDir) {
    runScoreAggregation(scoresFromDir);
} else {
    runPromptStructure();
}
