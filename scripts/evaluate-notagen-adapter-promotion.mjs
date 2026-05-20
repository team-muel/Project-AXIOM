/**
 * evaluate-notagen-adapter-promotion.mjs
 *
 * Frozen-benchmark adapter promotion gate.
 *
 * A trained adapter candidate is only promoted to production/default when it
 * passes ALL of:
 *
 *   G-01  syntaxValidity       — no regression  (≤ 1% drop)
 *   G-02  evidenceCoverageScore— no regression
 *   G-03  finalCraftScore      — must improve or stay (≤ 3% drop)
 *   G-04  advancedCraftScore   — must improve or stay (≤ 3% drop)
 *   G-05  harmonyContractScore — no regression
 *   G-06  motifRecapIdentity   — no regression
 *   G-07  pianoListenabilityScore — no regression (piano rows only; skipped when baseline has none)
 *
 * Diversity collapse gates (D-*):
 *   For finalCraftScore, harmonyContractScore, motifRecapIdentity:
 *   candidate stddev must stay ≥ 50% of baseline stddev.
 *   A rising mean with a collapsing stddev is a mode-collapse signal.
 *
 * Cross-metric guards (X-*):
 *   If any metric improves > 10% while a paired critical metric drops > 5%,
 *   the gate fails. Examples: harmony up but motif dead, piano up but motif dead.
 *
 * ── Input format (JSONL, one row per benchmark evaluation) ───────────────────
 *
 *   { "id": "bench-001",
 *     "planSignature": "C_minor_aba_miniature",
 *     "syntaxValidity": 1.0,
 *     "finalCraftScore": 0.75,
 *     "advancedCraftScore": 0.65,
 *     "harmonyContractScore": 0.82,
 *     "evidenceCoverageScore": 0.62,
 *     "motifRecapIdentity": 0.71,
 *     "pianoListenabilityScore": null,
 *     "isPianoCandidate": false }
 *
 *   `pianoListenabilityScore` should be a number for piano candidates and null/absent
 *   for non-piano candidates.  The gate (G-07) is automatically skipped when no piano
 *   rows are found in the baseline.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   node scripts/evaluate-notagen-adapter-promotion.mjs \
 *     --baseline=outputs/_system/ml/benchmarks/baseline/scores.jsonl \
 *     --candidate=outputs/_system/ml/benchmarks/candidate-v2/scores.jsonl \
 *     [--out=outputs/_system/ml/benchmarks/candidate-v2/promotion-decision.json] \
 *     [--dry-run]
 *
 * Exit code 0 → promoted.  Exit code 1 → not promoted or error.
 */

import fs from "node:fs";
import path from "node:path";

// ── CLI helpers ───────────────────────────────────────────────────────────────

function readOption(name) {
    const prefix = `--${name}=`;
    const exactIdx = process.argv.indexOf(`--${name}`);
    if (exactIdx >= 0) return process.argv[exactIdx + 1] ?? "";
    const prefixed = process.argv.find((e) => e.startsWith(prefix));
    return prefixed ? prefixed.slice(prefix.length) : undefined;
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum rows required in each benchmark file to run the gate. */
const MIN_ROWS = 5;

/**
 * No-regression tolerance: candidate mean may drop by at most this fraction
 * vs baseline before the gate fails.
 */
const NO_REGRESSION_TOLERANCE = 0.01;   // 1%

/**
 * Must-improve tolerance: for finalCraftScore / advancedCraftScore the candidate
 * mean must not drop more than 3% vs baseline (they should improve or hold).
 */
const MUST_IMPROVE_TOLERANCE = 0.03;    // 3%

/** Diversity: candidate stddev must remain >= this ratio of baseline stddev. */
const DIVERSITY_STDDEV_FLOOR_RATIO = 0.50;

/** Diversity gate is only applied when baseline stddev is above this floor. */
const DIVERSITY_MIN_BASELINE_STDDEV = 0.05;

/** Cross-metric: improver must gain > this to trigger the cross check. */
const CROSS_METRIC_GAIN_THRESHOLD = 0.10;  // 10%

/** Cross-metric: victim must drop > this to fail the cross check. */
const CROSS_METRIC_DROP_THRESHOLD = 0.05;  // 5%

// ── Gate definitions ──────────────────────────────────────────────────────────

const GATE_DEFS = [
    { id: "G-01", metric: "syntaxValidity",          mode: "no_regression",  pianoOnly: false },
    { id: "G-02", metric: "evidenceCoverageScore",   mode: "no_regression",  pianoOnly: false },
    { id: "G-03", metric: "finalCraftScore",         mode: "must_improve",   pianoOnly: false },
    { id: "G-04", metric: "advancedCraftScore",      mode: "must_improve",   pianoOnly: false },
    { id: "G-05", metric: "harmonyContractScore",    mode: "no_regression",  pianoOnly: false },
    { id: "G-06", metric: "motifRecapIdentity",      mode: "no_regression",  pianoOnly: false },
    { id: "G-07", metric: "pianoListenabilityScore", mode: "no_regression",  pianoOnly: true  },
];

/** Metrics checked for output diversity (stddev collapse). */
const DIVERSITY_GATE_METRICS = [
    "finalCraftScore",
    "harmonyContractScore",
    "motifRecapIdentity",
];

/**
 * Cross-metric watch pairs [improver, victim].
 *
 * If `improver` gains > CROSS_METRIC_GAIN_THRESHOLD AND `victim` drops >
 * CROSS_METRIC_DROP_THRESHOLD vs baseline, the gate fails.
 *
 * Rationale: single-dimension gain at the expense of another critical
 * dimension is a training-collapse pattern, not genuine improvement.
 */
const CROSS_METRIC_PAIRS = [
    ["finalCraftScore",         "motifRecapIdentity"],
    ["finalCraftScore",         "harmonyContractScore"],
    ["pianoListenabilityScore", "motifRecapIdentity"],
    ["advancedCraftScore",      "evidenceCoverageScore"],
    ["harmonyContractScore",    "motifRecapIdentity"],
];

const ALL_TRACKED_METRICS = [
    "syntaxValidity",
    "finalCraftScore",
    "advancedCraftScore",
    "harmonyContractScore",
    "evidenceCoverageScore",
    "motifRecapIdentity",
    "pianoListenabilityScore",
];

// ── Pure math helpers ─────────────────────────────────────────────────────────

function round3(v) { return Math.round(v * 1000) / 1000; }

/**
 * Compute descriptive stats for a numeric array.
 * Returns null when array is empty.
 *
 * @param {number[]} values
 * @returns {{ mean: number, stddev: number, p10: number, p50: number, p90: number, n: number } | null}
 */
function computeStats(values) {
    if (!values || values.length === 0) return null;
    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    const pct = (p) => sorted[Math.max(0, Math.ceil(n * p) - 1)];
    return {
        mean: round3(mean),
        stddev: round3(stddev),
        p10: round3(pct(0.10)),
        p50: round3(pct(0.50)),
        p90: round3(pct(0.90)),
        n,
    };
}

/** Extract finite values for a given metric from a score row array. */
function extractValues(rows, metric) {
    return rows
        .map((r) => r[metric])
        .filter((v) => typeof v === "number" && Number.isFinite(v));
}

/**
 * Compute per-metric stats for all tracked metrics.
 *
 * Piano-only metrics (pianoListenabilityScore) are computed from rows where
 * `isPianoCandidate === true`.
 *
 * @param {object[]} rows
 * @returns {Record<string, ReturnType<typeof computeStats>>}
 */
function computeAllStats(rows) {
    const result = {};
    for (const metric of ALL_TRACKED_METRICS) {
        const eligible = metric === "pianoListenabilityScore"
            ? rows.filter((r) => r.isPianoCandidate === true)
            : rows;
        result[metric] = computeStats(extractValues(eligible, metric));
    }
    return result;
}

// ── Gate evaluation ───────────────────────────────────────────────────────────

/**
 * Evaluate one per-metric gate.
 *
 * @param {{ id: string, metric: string, mode: string, pianoOnly: boolean }} gateDef
 * @param {Record<string, ReturnType<typeof computeStats>>} candidateStats
 * @param {Record<string, ReturnType<typeof computeStats>>} baselineStats
 * @returns {object} gate result
 */
function evaluatePerMetricGate(gateDef, candidateStats, baselineStats) {
    const bs = baselineStats[gateDef.metric];
    const cs = candidateStats[gateDef.metric];

    // Piano-only: skip gracefully when baseline has no piano rows
    if (gateDef.pianoOnly && (!bs || bs.n === 0)) {
        return {
            id: gateDef.id, metric: gateDef.metric, type: "per_metric",
            passed: true, skipped: true,
            reason: "no piano rows in baseline — gate skipped",
        };
    }

    if (!bs || bs.n === 0) {
        return {
            id: gateDef.id, metric: gateDef.metric, type: "per_metric",
            passed: false, skipped: false,
            reason: `no baseline data for ${gateDef.metric}`,
        };
    }
    if (!cs || cs.n === 0) {
        return {
            id: gateDef.id, metric: gateDef.metric, type: "per_metric",
            passed: false, skipped: false,
            reason: `no candidate data for ${gateDef.metric}`,
        };
    }

    const delta = cs.mean - bs.mean;
    const deltaRatio = bs.mean > 0 ? delta / bs.mean : (delta > 0 ? 1 : delta < 0 ? -1 : 0);
    const toleranceFraction = gateDef.mode === "must_improve"
        ? -MUST_IMPROVE_TOLERANCE
        : -NO_REGRESSION_TOLERANCE;

    const passed = deltaRatio >= toleranceFraction;

    return {
        id: gateDef.id,
        metric: gateDef.metric,
        type: "per_metric",
        mode: gateDef.mode,
        passed,
        skipped: false,
        candidateMean: cs.mean,
        baselineMean: bs.mean,
        delta: round3(delta),
        deltaPercent: round3(deltaRatio * 100),
        reason: passed
            ? `${gateDef.metric}: ${cs.mean} (${deltaRatio >= 0 ? "+" : ""}${(deltaRatio * 100).toFixed(1)}% vs baseline ${bs.mean})`
            : `REGRESSION — ${gateDef.metric}: ${cs.mean} vs baseline ${bs.mean} (${(deltaRatio * 100).toFixed(1)}%, tolerance ${(toleranceFraction * 100).toFixed(0)}%)`,
    };
}

/**
 * Evaluate a diversity (stddev collapse) gate for one metric.
 *
 * A gate failure here means the model's outputs became homogeneous — all
 * songs start sounding the same even if the mean score went up.
 *
 * @param {string} metric
 * @param {Record<string, ReturnType<typeof computeStats>>} candidateStats
 * @param {Record<string, ReturnType<typeof computeStats>>} baselineStats
 * @returns {object} gate result
 */
function evaluateDiversityGate(metric, candidateStats, baselineStats) {
    const gateId = `D-${metric}`;
    const bs = baselineStats[metric];
    const cs = candidateStats[metric];

    if (!bs || !cs) {
        return { id: gateId, metric, type: "diversity", passed: true, skipped: true, reason: "no data" };
    }

    // Only meaningful when baseline had a real spread
    if (bs.stddev < DIVERSITY_MIN_BASELINE_STDDEV) {
        return {
            id: gateId, metric, type: "diversity", passed: true, skipped: true,
            reason: `baseline stddev ${bs.stddev} too low — diversity gate not applicable`,
        };
    }

    const ratio = bs.stddev > 0 ? cs.stddev / bs.stddev : 1;
    const passed = ratio >= DIVERSITY_STDDEV_FLOOR_RATIO;

    return {
        id: gateId,
        metric,
        type: "diversity",
        passed,
        skipped: false,
        candidateStddev: cs.stddev,
        baselineStddev: bs.stddev,
        stddevRatio: round3(ratio),
        reason: passed
            ? `diversity OK: ${metric} stddev ${cs.stddev} (${(ratio * 100).toFixed(0)}% of baseline ${bs.stddev})`
            : `DIVERSITY COLLAPSE in ${metric}: stddev ${cs.stddev} is only ${(ratio * 100).toFixed(0)}% of baseline ${bs.stddev} — outputs too homogeneous`,
    };
}

/**
 * Evaluate all cross-metric guards.
 *
 * Returns an array of results for pairs where the improver gained enough to
 * warrant a check (whether or not the gate failed).
 *
 * @param {Record<string, ReturnType<typeof computeStats>>} candidateStats
 * @param {Record<string, ReturnType<typeof computeStats>>} baselineStats
 * @returns {object[]}
 */
function evaluateCrossMetricGates(candidateStats, baselineStats) {
    const results = [];

    for (const [improver, victim] of CROSS_METRIC_PAIRS) {
        const bsImp = baselineStats[improver];
        const csImp = candidateStats[improver];
        const bsVic = baselineStats[victim];
        const csVic = candidateStats[victim];

        if (!bsImp || !csImp || !bsVic || !csVic) continue;

        const gainRatio = bsImp.mean > 0 ? (csImp.mean - bsImp.mean) / bsImp.mean : 0;
        const dropRatio = bsVic.mean > 0 ? (csVic.mean - bsVic.mean) / bsVic.mean : 0;

        const isGain = gainRatio > CROSS_METRIC_GAIN_THRESHOLD;
        const isDrop = dropRatio < -CROSS_METRIC_DROP_THRESHOLD;

        // Only record the result if the improver actually gained enough to matter
        if (!isGain) continue;

        const passed = !isDrop;
        results.push({
            id: `X-${improver}/${victim}`,
            type: "cross_metric",
            improver,
            victim,
            passed,
            skipped: false,
            improverGainPercent: round3(gainRatio * 100),
            victimDropPercent: round3(dropRatio * 100),
            reason: passed
                ? `${improver} +${(gainRatio * 100).toFixed(1)}% — ${victim} held at ${(dropRatio * 100 >= 0 ? "+" : "")}${(dropRatio * 100).toFixed(1)}% (OK)`
                : `CROSS-METRIC COLLAPSE: ${improver} gained ${(gainRatio * 100).toFixed(1)}% but ${victim} dropped ${Math.abs(dropRatio * 100).toFixed(1)}%`,
        });
    }

    return results;
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

function loadScoreFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Score file not found: ${filePath}`);
    }
    const text = fs.readFileSync(filePath, "utf8");
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            rows.push(JSON.parse(trimmed));
        } catch (e) {
            console.warn(`[evaluate-notagen-adapter-promotion] Skipping malformed line: ${trimmed.slice(0, 80)}`);
        }
    }
    return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const baselinePath  = readOption("baseline");
    const candidatePath = readOption("candidate");
    const outPath       = readOption("out");
    const dryRun        = hasFlag("dry-run");

    if (!baselinePath || !candidatePath) {
        console.error("[evaluate-notagen-adapter-promotion] Usage: --baseline=<path> --candidate=<path> [--out=<path>] [--dry-run]");
        process.exit(1);
    }

    let baselineRows, candidateRows;
    try {
        baselineRows  = loadScoreFile(baselinePath);
        candidateRows = loadScoreFile(candidatePath);
    } catch (e) {
        console.error("[evaluate-notagen-adapter-promotion]", e.message);
        process.exit(1);
    }

    // ── Minimum-rows guard ────────────────────────────────────────────────────
    if (baselineRows.length < MIN_ROWS) {
        const decision = {
            promoted: false,
            evaluatedAt: new Date().toISOString(),
            baselineRows: baselineRows.length,
            candidateRows: candidateRows.length,
            reason: `insufficient baseline rows (${baselineRows.length} < ${MIN_ROWS}) — cannot evaluate`,
            gates: [],
            failedGates: [],
        };
        output(decision, outPath, dryRun);
        process.exit(1);
    }
    if (candidateRows.length < MIN_ROWS) {
        const decision = {
            promoted: false,
            evaluatedAt: new Date().toISOString(),
            baselineRows: baselineRows.length,
            candidateRows: candidateRows.length,
            reason: `insufficient candidate rows (${candidateRows.length} < ${MIN_ROWS}) — cannot evaluate`,
            gates: [],
            failedGates: [],
        };
        output(decision, outPath, dryRun);
        process.exit(1);
    }

    // ── Compute stats ─────────────────────────────────────────────────────────
    const baselineStats  = computeAllStats(baselineRows);
    const candidateStats = computeAllStats(candidateRows);

    // ── Run all gates ─────────────────────────────────────────────────────────
    const gates = [];

    for (const gateDef of GATE_DEFS) {
        gates.push(evaluatePerMetricGate(gateDef, candidateStats, baselineStats));
    }

    for (const metric of DIVERSITY_GATE_METRICS) {
        gates.push(evaluateDiversityGate(metric, candidateStats, baselineStats));
    }

    gates.push(...evaluateCrossMetricGates(candidateStats, baselineStats));

    // ── Decision ──────────────────────────────────────────────────────────────
    const failedGates = gates.filter((g) => !g.passed && !g.skipped);
    const promoted = failedGates.length === 0;
    const activeGates = gates.filter((g) => !g.skipped);

    const decision = {
        promoted,
        evaluatedAt: new Date().toISOString(),
        baselineRows: baselineRows.length,
        candidateRows: candidateRows.length,
        gatesTotal: activeGates.length,
        gatesFailed: failedGates.length,
        reason: promoted
            ? `all ${activeGates.length} active gate(s) passed — adapter is safe to promote`
            : `${failedGates.length} gate(s) failed: ${failedGates.map((g) => g.id).join(", ")}`,
        gates,
        failedGates,
        stats: { baseline: baselineStats, candidate: candidateStats },
    };

    output(decision, outPath, dryRun);
    process.exit(promoted ? 0 : 1);
}

function output(decision, outPath, dryRun) {
    const json = JSON.stringify(decision, null, 2);

    console.log("=== NotaGen Adapter Promotion Gate ===");
    console.log(`  Verdict:          ${decision.promoted ? "✅ PROMOTED" : "❌ NOT PROMOTED"}`);
    console.log(`  Reason:           ${decision.reason}`);
    if (decision.failedGates?.length > 0) {
        console.log("  Failed gates:");
        for (const g of decision.failedGates) {
            console.log(`    [${g.id}] ${g.reason}`);
        }
    }
    console.log(`  Baseline rows:    ${decision.baselineRows ?? "?"}`);
    console.log(`  Candidate rows:   ${decision.candidateRows ?? "?"}`);

    // Machine-readable summary on last line for script consumption
    console.log(JSON.stringify({
        promoted: decision.promoted,
        gatesFailed: decision.gatesFailed ?? 0,
        reason: decision.reason,
        failedGateIds: (decision.failedGates ?? []).map((g) => g.id),
    }));

    if (dryRun) {
        console.log("\n[dry-run] No files written.");
        return;
    }

    if (outPath) {
        ensureDir(path.dirname(outPath));
        fs.writeFileSync(outPath, json, "utf8");
        console.log(`\nWrote promotion decision → ${outPath}`);
    }
}

main();
