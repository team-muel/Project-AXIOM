/**
 * test/adapter-promotion-policy.test.mjs
 *
 * APG-01..APG-15: Adapter Promotion Gate 단위 테스트
 *
 * 검증 항목:
 *   APG-01: 모든 게이트 통과 → promoted=true
 *   APG-02: syntaxValidity 하락 (G-01) → 실패
 *   APG-03: finalCraftScore 5% 하락 (G-03, tolerance 3%) → 실패
 *   APG-04: finalCraftScore 2% 하락 (G-03, tolerance 3%) → 통과
 *   APG-05: harmonyContractScore 하락 (G-05) → 실패
 *   APG-06: motifRecapIdentity 하락 (G-06) → 실패
 *   APG-07: pianoListenabilityScore 하락 + 피아노 행 있음 (G-07) → 실패
 *   APG-08: pianoListenabilityScore 없음 + baseline 피아노 행 없음 (G-07) → skip, 통과
 *   APG-09: finalCraftScore stddev 60% 붕괴 → D-gate 실패
 *   APG-10: finalCraftScore stddev 30% 감소 (40% 이상 유지) → D-gate 통과
 *   APG-11: baseline stddev < 0.05 → diversity gate skip
 *   APG-12: harmonyContractScore +12% + motifRecapIdentity -6% → X-gate 실패
 *   APG-13: harmonyContractScore +5% + motifRecapIdentity -3% → X-gate 실패하지 않음
 *   APG-14: baseline 행 부족 (< 5) → promoted=false 즉시
 *   APG-15: 모든 지표 개선 → promoted=true, reason에 통과 gate 수 포함
 *   APG-16: diversity collapse → diversityCollapseWarnings에 포함
 *   APG-17: cross-metric collapse → crossMetricCollapseWarnings에 포함
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";

// ─── Inline gate logic (mirrors scripts/evaluate-notagen-adapter-promotion.mjs) ─

const MIN_ROWS = 5;
const NO_REGRESSION_TOLERANCE = 0.01;
const MUST_IMPROVE_TOLERANCE   = 0.03;
const DIVERSITY_STDDEV_FLOOR_RATIO    = 0.50;
const DIVERSITY_MIN_BASELINE_STDDEV   = 0.05;
const CROSS_METRIC_GAIN_THRESHOLD     = 0.10;
const CROSS_METRIC_DROP_THRESHOLD     = 0.05;

const GATE_DEFS = [
    { id: "G-01", metric: "syntaxValidity",          mode: "no_regression",  pianoOnly: false },
    { id: "G-02", metric: "evidenceCoverageScore",   mode: "no_regression",  pianoOnly: false },
    { id: "G-03", metric: "finalCraftScore",         mode: "must_improve",   pianoOnly: false },
    { id: "G-04", metric: "advancedCraftScore",      mode: "must_improve",   pianoOnly: false },
    { id: "G-05", metric: "harmonyContractScore",    mode: "no_regression",  pianoOnly: false },
    { id: "G-06", metric: "motifRecapIdentity",      mode: "no_regression",  pianoOnly: false },
    { id: "G-07", metric: "pianoListenabilityScore", mode: "no_regression",  pianoOnly: true  },
];

const DIVERSITY_GATE_METRICS = ["finalCraftScore", "harmonyContractScore", "motifRecapIdentity"];

const CROSS_METRIC_PAIRS = [
    ["finalCraftScore",         "motifRecapIdentity"],
    ["finalCraftScore",         "harmonyContractScore"],
    ["pianoListenabilityScore", "motifRecapIdentity"],
    ["advancedCraftScore",      "evidenceCoverageScore"],
    ["harmonyContractScore",    "motifRecapIdentity"],
];

const ALL_TRACKED_METRICS = [
    "syntaxValidity", "finalCraftScore", "advancedCraftScore",
    "harmonyContractScore", "evidenceCoverageScore", "motifRecapIdentity",
    "pianoListenabilityScore",
];

function round3(v) { return Math.round(v * 1000) / 1000; }

function computeStats(values) {
    if (!values || values.length === 0) return null;
    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    const pct = (p) => sorted[Math.max(0, Math.ceil(n * p) - 1)];
    return { mean: round3(mean), stddev: round3(stddev), p10: round3(pct(0.10)), p50: round3(pct(0.50)), p90: round3(pct(0.90)), n };
}

function extractValues(rows, metric) {
    return rows.map((r) => r[metric]).filter((v) => typeof v === "number" && Number.isFinite(v));
}

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

function evaluatePerMetricGate(gateDef, candidateStats, baselineStats) {
    const bs = baselineStats[gateDef.metric];
    const cs = candidateStats[gateDef.metric];
    if (gateDef.pianoOnly && (!bs || bs.n === 0)) {
        return { id: gateDef.id, metric: gateDef.metric, type: "per_metric", passed: true, skipped: true, reason: "no piano rows in baseline — gate skipped" };
    }
    if (!bs || bs.n === 0) return { id: gateDef.id, metric: gateDef.metric, type: "per_metric", passed: false, skipped: false, reason: `no baseline data for ${gateDef.metric}` };
    if (!cs || cs.n === 0) return { id: gateDef.id, metric: gateDef.metric, type: "per_metric", passed: false, skipped: false, reason: `no candidate data for ${gateDef.metric}` };
    const delta = cs.mean - bs.mean;
    const deltaRatio = bs.mean > 0 ? delta / bs.mean : (delta > 0 ? 1 : delta < 0 ? -1 : 0);
    const toleranceFraction = gateDef.mode === "must_improve" ? -MUST_IMPROVE_TOLERANCE : -NO_REGRESSION_TOLERANCE;
    const passed = deltaRatio >= toleranceFraction;
    return {
        id: gateDef.id, metric: gateDef.metric, type: "per_metric", mode: gateDef.mode,
        passed, skipped: false,
        candidateMean: cs.mean, baselineMean: bs.mean, delta: round3(delta), deltaPercent: round3(deltaRatio * 100),
        reason: passed
            ? `${gateDef.metric}: ${cs.mean} (${deltaRatio >= 0 ? "+" : ""}${(deltaRatio * 100).toFixed(1)}% vs baseline ${bs.mean})`
            : `REGRESSION — ${gateDef.metric}: ${cs.mean} vs baseline ${bs.mean} (${(deltaRatio * 100).toFixed(1)}%, tolerance ${(toleranceFraction * 100).toFixed(0)}%)`,
    };
}

function evaluateDiversityGate(metric, candidateStats, baselineStats) {
    const gateId = `D-${metric}`;
    const bs = baselineStats[metric];
    const cs = candidateStats[metric];
    if (!bs || !cs) return { id: gateId, metric, type: "diversity", passed: true, skipped: true, reason: "no data" };
    if (bs.stddev < DIVERSITY_MIN_BASELINE_STDDEV) {
        return { id: gateId, metric, type: "diversity", passed: true, skipped: true, reason: `baseline stddev ${bs.stddev} too low — diversity gate not applicable` };
    }
    const ratio = bs.stddev > 0 ? cs.stddev / bs.stddev : 1;
    const passed = ratio >= DIVERSITY_STDDEV_FLOOR_RATIO;
    return {
        id: gateId, metric, type: "diversity", passed, skipped: false,
        candidateStddev: cs.stddev, baselineStddev: bs.stddev, stddevRatio: round3(ratio),
        reason: passed
            ? `diversity OK: ${metric} stddev ${cs.stddev} (${(ratio * 100).toFixed(0)}% of baseline ${bs.stddev})`
            : `DIVERSITY COLLAPSE in ${metric}: stddev ${cs.stddev} is only ${(ratio * 100).toFixed(0)}% of baseline ${bs.stddev}`,
    };
}

function evaluateCrossMetricGates(candidateStats, baselineStats) {
    const results = [];
    for (const [improver, victim] of CROSS_METRIC_PAIRS) {
        const bsImp = baselineStats[improver];  const csImp = candidateStats[improver];
        const bsVic = baselineStats[victim];    const csVic = candidateStats[victim];
        if (!bsImp || !csImp || !bsVic || !csVic) continue;
        const gainRatio = bsImp.mean > 0 ? (csImp.mean - bsImp.mean) / bsImp.mean : 0;
        const dropRatio = bsVic.mean > 0 ? (csVic.mean - bsVic.mean) / bsVic.mean : 0;
        if (gainRatio <= CROSS_METRIC_GAIN_THRESHOLD) continue;
        const passed = dropRatio >= -CROSS_METRIC_DROP_THRESHOLD;
        results.push({
            id: `X-${improver}/${victim}`, type: "cross_metric", improver, victim, passed, skipped: false,
            improverGainPercent: round3(gainRatio * 100), victimDropPercent: round3(dropRatio * 100),
            reason: passed
                ? `${improver} +${(gainRatio * 100).toFixed(1)}% — ${victim} held (OK)`
                : `CROSS-METRIC COLLAPSE: ${improver} gained ${(gainRatio * 100).toFixed(1)}% but ${victim} dropped ${Math.abs(dropRatio * 100).toFixed(1)}%`,
        });
    }
    return results;
}

/** Run the full gate suite and return { promoted, gates, failedGates, diversityCollapseWarnings, crossMetricCollapseWarnings }. */
function runGates(baselineRows, candidateRows) {
    if (baselineRows.length < MIN_ROWS || candidateRows.length < MIN_ROWS) {
        return {
            promoted: false,
            reason: `insufficient rows (baseline=${baselineRows.length}, candidate=${candidateRows.length})`,
            gates: [],
            failedGates: [],
            diversityCollapseWarnings: [],
            crossMetricCollapseWarnings: [],
        };
    }
    const bs = computeAllStats(baselineRows);
    const cs = computeAllStats(candidateRows);
    const gates = [];
    for (const gateDef of GATE_DEFS) gates.push(evaluatePerMetricGate(gateDef, cs, bs));
    for (const metric of DIVERSITY_GATE_METRICS) gates.push(evaluateDiversityGate(metric, cs, bs));
    gates.push(...evaluateCrossMetricGates(cs, bs));
    const failedGates = gates.filter((g) => !g.passed && !g.skipped);
    const diversityCollapseWarnings = failedGates.filter((g) => g.type === "diversity").map((g) => g.reason);
    const crossMetricCollapseWarnings = failedGates.filter((g) => g.type === "cross_metric").map((g) => g.reason);
    return { promoted: failedGates.length === 0, gates, failedGates, diversityCollapseWarnings, crossMetricCollapseWarnings };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Make N baseline rows with fixed scores. */
function makeRows(n, scores, overrides = {}) {
    return Array.from({ length: n }, (_, i) => ({
        id: `bench-${String(i).padStart(3, "0")}`,
        isPianoCandidate: false,
        syntaxValidity: 1.0,
        finalCraftScore: 0.76,
        advancedCraftScore: 0.66,
        harmonyContractScore: 0.82,
        evidenceCoverageScore: 0.64,
        motifRecapIdentity: 0.70,
        pianoListenabilityScore: null,
        ...scores,
        ...overrides,
    }));
}

/** Make rows with realistic spread (adds tiny variation so stddev > 0). */
function makeRowsSpread(n, baseScores) {
    return Array.from({ length: n }, (_, i) => {
        const jitter = (((i * 7919) % 20) - 10) / 200; // ±0.05 deterministic variation
        const row = { id: `bench-${String(i).padStart(3, "0")}`, isPianoCandidate: false };
        for (const [k, v] of Object.entries(baseScores)) {
            row[k] = typeof v === "number" ? Math.min(1, Math.max(0, v + jitter)) : v;
        }
        return row;
    });
}

const BASE_SCORES = {
    syntaxValidity: 1.0,
    finalCraftScore: 0.76,
    advancedCraftScore: 0.66,
    harmonyContractScore: 0.82,
    evidenceCoverageScore: 0.64,
    motifRecapIdentity: 0.70,
    pianoListenabilityScore: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Adapter Promotion Gate (APG)", () => {

    it("APG-01: all metrics match baseline → promoted=true", () => {
        const baseline  = makeRowsSpread(10, BASE_SCORES);
        const candidate = makeRowsSpread(10, BASE_SCORES);
        const { promoted, failedGates } = runGates(baseline, candidate);
        assert.equal(promoted, true, `Expected promoted=true, failed: ${failedGates.map(g => g.id).join(", ")}`);
    });

    it("APG-02: syntaxValidity drops from 1.0 to 0.80 → G-01 fails", () => {
        const baseline  = makeRows(10, BASE_SCORES);
        const candidate = makeRows(10, { ...BASE_SCORES, syntaxValidity: 0.80 });
        const { promoted, failedGates } = runGates(baseline, candidate);
        assert.equal(promoted, false);
        assert.ok(failedGates.some((g) => g.id === "G-01"), "G-01 must be in failedGates");
    });

    it("APG-03: finalCraftScore drops 5% (below must_improve tolerance of 3%) → G-03 fails", () => {
        const baseline  = makeRows(10, { ...BASE_SCORES, finalCraftScore: 0.76 });
        const candidate = makeRows(10, { ...BASE_SCORES, finalCraftScore: 0.76 * 0.95 }); // -5%
        const { failedGates } = runGates(baseline, candidate);
        assert.ok(failedGates.some((g) => g.id === "G-03"), "G-03 must fail on -5% finalCraftScore");
    });

    it("APG-04: finalCraftScore drops 2% (within must_improve tolerance of 3%) → G-03 passes", () => {
        const baseline  = makeRows(10, { ...BASE_SCORES, finalCraftScore: 0.76 });
        const candidate = makeRows(10, { ...BASE_SCORES, finalCraftScore: 0.76 * 0.98 }); // -2%
        const { failedGates } = runGates(baseline, candidate);
        assert.ok(!failedGates.some((g) => g.id === "G-03"), `G-03 must pass on -2% drop, failed: ${failedGates.map(g=>g.id)}`);
    });

    it("APG-05: harmonyContractScore drops 5% → G-05 fails", () => {
        const baseline  = makeRows(10, { ...BASE_SCORES, harmonyContractScore: 0.82 });
        const candidate = makeRows(10, { ...BASE_SCORES, harmonyContractScore: 0.76 });
        const { failedGates } = runGates(baseline, candidate);
        assert.ok(failedGates.some((g) => g.id === "G-05"), "G-05 must fail");
    });

    it("APG-06: motifRecapIdentity drops from 0.70 to 0.50 → G-06 fails", () => {
        const baseline  = makeRows(10, { ...BASE_SCORES, motifRecapIdentity: 0.70 });
        const candidate = makeRows(10, { ...BASE_SCORES, motifRecapIdentity: 0.50 });
        const { failedGates } = runGates(baseline, candidate);
        assert.ok(failedGates.some((g) => g.id === "G-06"), "G-06 must fail");
    });

    it("APG-07: pianoListenabilityScore drops + piano rows in baseline → G-07 fails", () => {
        const makeWithPiano = (score) => Array.from({ length: 10 }, (_, i) => ({
            id: `bench-${i}`,
            isPianoCandidate: true,
            syntaxValidity: 1.0,
            finalCraftScore: 0.76,
            advancedCraftScore: 0.66,
            harmonyContractScore: 0.82,
            evidenceCoverageScore: 0.64,
            motifRecapIdentity: 0.70,
            pianoListenabilityScore: score,
        }));
        const baseline  = makeWithPiano(0.72);
        const candidate = makeWithPiano(0.55);
        const { failedGates } = runGates(baseline, candidate);
        assert.ok(failedGates.some((g) => g.id === "G-07"), "G-07 must fail when piano score drops");
    });

    it("APG-08: no piano rows in baseline → G-07 is skipped (passes)", () => {
        // baseline has no piano rows (isPianoCandidate: false)
        const baseline  = makeRows(10, BASE_SCORES);
        const candidate = makeRows(10, { ...BASE_SCORES, pianoListenabilityScore: 0.40 });
        const { gates, failedGates } = runGates(baseline, candidate);
        const g07 = gates.find((g) => g.id === "G-07");
        assert.ok(g07, "G-07 should be present in gate list");
        assert.equal(g07.skipped, true, "G-07 must be skipped when no piano rows in baseline");
        assert.ok(!failedGates.some((g) => g.id === "G-07"), "G-07 must not be in failedGates");
    });

    it("APG-09: finalCraftScore stddev collapses by 60% → D-gate fails", () => {
        // Baseline: mean=0.76, spread ±0.12 → stddev ≈ 0.12
        const bRows = Array.from({ length: 10 }, (_, i) => ({
            ...BASE_SCORES, id: `b-${i}`,
            finalCraftScore: 0.76 + (i % 2 === 0 ? 0.12 : -0.12),
        }));
        // Candidate: mean=0.77, almost no spread → stddev ≈ 0.01
        const cRows = Array.from({ length: 10 }, (_, i) => ({
            ...BASE_SCORES, id: `c-${i}`,
            finalCraftScore: 0.77 + (i % 2 === 0 ? 0.01 : -0.01),
        }));
        const { failedGates } = runGates(bRows, cRows);
        assert.ok(failedGates.some((g) => g.id === "D-finalCraftScore"),
            `Expected D-finalCraftScore to fail, failedGates: ${failedGates.map(g => g.id).join(", ")}`);
    });

    it("APG-10: finalCraftScore stddev decreases 30% (still ≥ 50%) → D-gate passes", () => {
        const makeSpread = (stddev) => Array.from({ length: 10 }, (_, i) => ({
            ...BASE_SCORES, id: `r-${i}`,
            finalCraftScore: 0.76 + (i % 2 === 0 ? stddev : -stddev),
        }));
        const baseline  = makeSpread(0.10); // stddev ≈ 0.10
        const candidate = makeSpread(0.07); // stddev ≈ 0.07 — 70% of baseline
        const { failedGates } = runGates(baseline, candidate);
        assert.ok(!failedGates.some((g) => g.id === "D-finalCraftScore"),
            "D-finalCraftScore must pass when stddev stays above 50% floor");
    });

    it("APG-11: baseline stddev below 0.05 → diversity gate is skipped", () => {
        // All rows have the same score → stddev = 0
        const baseline  = makeRows(10, { ...BASE_SCORES, finalCraftScore: 0.76 });
        const candidate = makeRows(10, { ...BASE_SCORES, finalCraftScore: 0.77 });
        const { gates } = runGates(baseline, candidate);
        const dGate = gates.find((g) => g.id === "D-finalCraftScore");
        assert.ok(dGate, "D-finalCraftScore should be in gates list");
        assert.equal(dGate.skipped, true, "Diversity gate must be skipped when baseline stddev < 0.05");
    });

    it("APG-12: harmonyContractScore +12%, motifRecapIdentity -6% → X cross-gate fails", () => {
        const baseline = makeRows(10, {
            ...BASE_SCORES,
            harmonyContractScore: 0.70,
            motifRecapIdentity:   0.70,
        });
        const candidate = makeRows(10, {
            ...BASE_SCORES,
            harmonyContractScore: 0.70 * 1.12,  // +12%
            motifRecapIdentity:   0.70 * 0.94,  // -6%
        });
        const { failedGates } = runGates(baseline, candidate);
        assert.ok(
            failedGates.some((g) => g.id === "X-harmonyContractScore/motifRecapIdentity"),
            `Expected X-harmonyContractScore/motifRecapIdentity to fail. Failed: ${failedGates.map(g => g.id).join(", ")}`,
        );
    });

    it("APG-13: harmonyContractScore +5% (below gain threshold), motifRecapIdentity -3% → X-gate not triggered", () => {
        const baseline = makeRows(10, {
            ...BASE_SCORES,
            harmonyContractScore: 0.70,
            motifRecapIdentity:   0.70,
        });
        const candidate = makeRows(10, {
            ...BASE_SCORES,
            harmonyContractScore: 0.70 * 1.05,  // +5% — below CROSS_METRIC_GAIN_THRESHOLD
            motifRecapIdentity:   0.70 * 0.97,  // -3%
        });
        const { failedGates, gates } = runGates(baseline, candidate);
        // Cross gate should not even be added (improver < 10% gain)
        const xGate = gates.find((g) => g.id === "X-harmonyContractScore/motifRecapIdentity");
        assert.ok(!xGate || xGate.passed, "Cross gate must not fail when gain < threshold");
        assert.ok(!failedGates.some((g) => g.id === "X-harmonyContractScore/motifRecapIdentity"),
            "No X-gate failure expected");
    });

    it("APG-14: baseline has 3 rows (below MIN_ROWS=5) → promoted=false immediately", () => {
        const baseline  = makeRows(3, BASE_SCORES);
        const candidate = makeRows(10, BASE_SCORES);
        const { promoted, reason } = runGates(baseline, candidate);
        assert.equal(promoted, false, "Must not promote with insufficient baseline rows");
        assert.ok(reason.includes("insufficient"), `reason should mention insufficient rows, got: ${reason}`);
    });

    it("APG-15: all metrics improved → promoted=true, active gates all passed", () => {
        const baseline = makeRowsSpread(10, BASE_SCORES);
        const candidate = makeRowsSpread(10, {
            ...BASE_SCORES,
            finalCraftScore:      0.83,  // improved
            advancedCraftScore:   0.73,  // improved
            harmonyContractScore: 0.88,  // improved
            evidenceCoverageScore: 0.70, // improved
            motifRecapIdentity:   0.77,  // improved
        });
        const { promoted, gates, failedGates } = runGates(baseline, candidate);
        assert.equal(promoted, true, `Expected promoted=true, failed: ${failedGates.map(g => g.id).join(", ")}`);
        const activeGates = gates.filter((g) => !g.skipped);
        assert.ok(activeGates.length >= 7, "Should have at least 7 active gates");
        assert.ok(activeGates.every((g) => g.passed), "All active gates should pass");
    });

    it("APG-16: diversity collapse → diversityCollapseWarnings populated, crossMetricCollapseWarnings empty", () => {
        // finalCraftScore stddev collapses → D-gate fails → diversityCollapseWarnings filled
        const bRows = Array.from({ length: 10 }, (_, i) => ({
            ...BASE_SCORES, id: `b-${i}`,
            finalCraftScore: 0.76 + (i % 2 === 0 ? 0.12 : -0.12),
        }));
        const cRows = Array.from({ length: 10 }, (_, i) => ({
            ...BASE_SCORES, id: `c-${i}`,
            finalCraftScore: 0.77 + (i % 2 === 0 ? 0.005 : -0.005),
        }));
        const { diversityCollapseWarnings, crossMetricCollapseWarnings } = runGates(bRows, cRows);
        assert.ok(diversityCollapseWarnings.length > 0, "diversityCollapseWarnings must be non-empty on stddev collapse");
        assert.strictEqual(crossMetricCollapseWarnings.length, 0, "crossMetricCollapseWarnings must be empty when no cross-metric collapse");
    });

    it("APG-17: cross-metric collapse → crossMetricCollapseWarnings populated, diversityCollapseWarnings empty", () => {
        // harmonyContractScore +12%, motifRecapIdentity -6% → X-gate fails → crossMetricCollapseWarnings filled
        const baseline = makeRows(10, {
            ...BASE_SCORES, harmonyContractScore: 0.70, motifRecapIdentity: 0.70,
        });
        const candidate = makeRows(10, {
            ...BASE_SCORES,
            harmonyContractScore: 0.70 * 1.12,  // +12%
            motifRecapIdentity:   0.70 * 0.94,  // -6%
        });
        const { diversityCollapseWarnings, crossMetricCollapseWarnings } = runGates(baseline, candidate);
        assert.ok(crossMetricCollapseWarnings.length > 0, "crossMetricCollapseWarnings must be non-empty on cross-metric collapse");
        assert.strictEqual(diversityCollapseWarnings.length, 0, "diversityCollapseWarnings must be empty when no diversity collapse");
    });

});
