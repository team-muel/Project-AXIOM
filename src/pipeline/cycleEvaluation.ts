/**
 * Cycle-level evaluator for multi-movement sonata generation.
 *
 * Consumes the completed SonataCycleResult (all movement records + motif
 * memory) and produces a SonataCycleEvaluationReport with four composite
 * dimensions:
 *
 *   tensionArcMatch            – how well the movement scores follow the
 *                                planned global tension curve
 *   crossMovementMotifSurvival – fraction of global motifs confirmed in
 *                                >= 2 movements
 *   finalPayoffScore           – finale quality weighted by cycle completeness
 *   movementCohesionScore      – average per-movement quality score
 *
 * None of these dimensions modify any artifact; they are read-only measurements
 * used by the cycle orchestrator and exposed to the operator.
 */

import type {
    CrossMovementMotifMemory,
    MovementCompletionRecord,
    SonataCycleEvaluationReport,
    SonataCycleResult,
    SonataCyclePlan,
} from "./types.js";

// ─── Tension arc correlation ──────────────────────────────────────────────────

/**
 * Pearson correlation between two equal-length numeric arrays, clamped to
 * [0, 1].  A negative correlation is treated as 0 (no useful arc match).
 *
 * Returns 0 when either array is constant (std-dev = 0) to avoid NaN.
 */
export function pearsonCorrelationClamped(xs: number[], ys: number[]): number {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return 0;

    const meanX = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanY = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;

    let covXY = 0;
    let varX = 0;
    let varY = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        covXY += dx * dy;
        varX += dx * dx;
        varY += dy * dy;
    }

    if (varX === 0 || varY === 0) return 0;
    const r = covXY / Math.sqrt(varX * varY);
    return Math.max(0, Math.min(1, r));
}

/**
 * Maps the planned globalTensionCurve (arbitrary length) to the number of
 * completed movements by sampling at evenly-spaced indices.
 */
function resampleTensionCurve(curve: number[], targetLength: number): number[] {
    if (curve.length === 0 || targetLength === 0) return [];
    if (curve.length === targetLength) return [...curve];
    return Array.from({ length: targetLength }, (_, i) => {
        const t = i / (targetLength - 1 || 1);
        const rawIdx = t * (curve.length - 1);
        const lo = Math.floor(rawIdx);
        const hi = Math.min(lo + 1, curve.length - 1);
        const frac = rawIdx - lo;
        return curve[lo] * (1 - frac) + curve[hi] * frac;
    });
}

// ─── Per-movement quality score ───────────────────────────────────────────────

/**
 * Extract the primary quality scalar for a completed movement.
 *
 * Prefers `finalPianoScore` from the piano craft summary (when present)
 * because it captures playability-weighted quality; otherwise falls back to
 * `finalCraftScore` from the generic craft summary.
 */
export function movementQualityScore(record: MovementCompletionRecord): number {
    if (record.pianoCraftScore) {
        return record.pianoCraftScore.finalPianoScore ?? 0;
    }
    return record.structureEvaluation.craftScore?.finalCraftScore ?? 0;
}

// ─── Motif survival ───────────────────────────────────────────────────────────

/**
 * Fraction of `globalMotifIds` from the plan that appear in the confirmed
 * global motifs of the motif memory (i.e. confirmed in >= 2 movements).
 *
 * Returns 1.0 when globalMotifIds is empty (vacuously true).
 */
export function computeMotifSurvivalRate(
    globalMotifIds: string[],
    memory: CrossMovementMotifMemory,
): number {
    if (globalMotifIds.length === 0) return 1;
    const confirmedSet = new Set(memory.confirmedGlobalMotifIds);
    const survived = globalMotifIds.filter((id) => confirmedSet.has(id)).length;
    return survived / globalMotifIds.length;
}

// ─── Finale payoff ────────────────────────────────────────────────────────────

/**
 * Quality of the finale (last movement) weighted by the fraction of the
 * planned movements that completed.
 *
 *   finalPayoffScore = lastQuality × (completedCount / plannedCount)
 *
 * This rewards a strong finale only when the whole cycle ran through.
 */
export function computeFinalPayoffScore(
    movements: MovementCompletionRecord[],
    plannedCount: number,
): number {
    if (movements.length === 0 || plannedCount === 0) return 0;
    const sorted = [...movements].sort((a, b) => a.ordinal - b.ordinal);
    const lastQuality = movementQualityScore(sorted[sorted.length - 1]);
    const completionFraction = movements.length / plannedCount;
    return lastQuality * completionFraction;
}

// ─── Movement gate tier lookup ────────────────────────────────────────────────

/**
 * Returns the gate tier of a movement record.  Currently encoded in the
 * structureEvaluation.gateTier field when present; defaults to:
 *   - tier 3 if not usedFallback and qualityScore >= 0.65
 *   - tier 2 if not usedFallback
 *   - tier 1 otherwise
 */
function gateTierOf(record: MovementCompletionRecord): 0 | 1 | 2 | 3 {
    const eval_ = record.structureEvaluation as Record<string, unknown>;
    if (typeof eval_["gateTier"] === "number") {
        const t = eval_["gateTier"] as number;
        if (t === 0 || t === 1 || t === 2 || t === 3) return t;
    }
    if (record.usedFallback) return 1;
    const q = movementQualityScore(record);
    return q >= 0.65 ? 3 : 2;
}

// ─── Motif recall per movement ────────────────────────────────────────────────

/**
 * Score [0, 1] measuring how many of the inherited motifs were confirmed in
 * this movement's completed record.
 */
function motifRecallScore(
    record: MovementCompletionRecord,
    memory: CrossMovementMotifMemory,
): number {
    if (record.ordinal === 1) return 1; // first movement has nothing to recall
    const confirmed = new Set(record.confirmedMotifIds);
    // inherited motifs = any motif introduced in an earlier movement
    const inherited = memory.entries
        .filter(
            (e) =>
                e.introducedInOrdinal < record.ordinal &&
                e.recalledInOrdinals.includes(record.ordinal),
        )
        .map((e) => e.motifId);
    if (inherited.length === 0) return 0.5; // nothing expected, partial credit
    const recalledCount = inherited.filter((id) => confirmed.has(id)).length;
    return recalledCount / inherited.length;
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate a completed (or partially completed) sonata cycle.
 *
 * All inputs are read-only; no artifacts are modified.
 */
export function evaluateSonataCycle(
    result: SonataCycleResult,
    plan: SonataCyclePlan,
): SonataCycleEvaluationReport {
    const { movements, motifMemory } = result;
    const plannedCount = plan.movements.length;
    const completedCount = movements.length;

    if (completedCount === 0) {
        return {
            tensionArcMatch: 0,
            crossMovementMotifSurvivalRate: 0,
            finalPayoffScore: 0,
            movementCohesionScore: 0,
            compositeCycleScore: 0,
            completedMovementCount: 0,
            plannedMovementCount: plannedCount,
            allMovementsPassedGate3: false,
            movementNotes: [],
        };
    }

    // ── Tension arc match ────────────────────────────────────────────────────
    const sorted = [...movements].sort((a, b) => a.ordinal - b.ordinal);
    const actualScores = sorted.map(movementQualityScore);
    const resampledCurve = resampleTensionCurve(plan.globalTensionCurve, completedCount);
    const tensionArcMatch = pearsonCorrelationClamped(resampledCurve, actualScores);

    // ── Motif survival ───────────────────────────────────────────────────────
    const crossMovementMotifSurvivalRate = computeMotifSurvivalRate(
        plan.globalMotifIds,
        motifMemory,
    );

    // ── Finale payoff ────────────────────────────────────────────────────────
    const finalPayoffScore = computeFinalPayoffScore(sorted, plannedCount);

    // ── Movement cohesion ────────────────────────────────────────────────────
    const movementCohesionScore =
        actualScores.reduce((a, b) => a + b, 0) / actualScores.length;

    // ── Composite ────────────────────────────────────────────────────────────
    const compositeCycleScore =
        0.25 * tensionArcMatch +
        0.30 * crossMovementMotifSurvivalRate +
        0.25 * finalPayoffScore +
        0.20 * movementCohesionScore;

    // ── Per-movement notes ───────────────────────────────────────────────────
    const allMovementsPassedGate3 =
        completedCount === plannedCount &&
        sorted.every((m) => gateTierOf(m) === 3);

    const movementNotes = sorted.map((m) => {
        const tier = gateTierOf(m);
        const recall = motifRecallScore(m, motifMemory);
        const quality = movementQualityScore(m);
        const fragments: string[] = [];
        if (m.usedFallback) fragments.push("used fallback selection");
        if (recall < 0.5 && m.ordinal > 1)
            fragments.push(`low motif recall (${(recall * 100).toFixed(0)}%)`);
        if (quality < 0.5) fragments.push(`below-average quality (${quality.toFixed(2)})`);
        if (fragments.length === 0) fragments.push("ok");
        return {
            ordinal: m.ordinal,
            movementId: m.movementId,
            gateTier: tier,
            motifRecallScore: recall,
            note: fragments.join("; "),
        };
    });

    return {
        tensionArcMatch,
        crossMovementMotifSurvivalRate,
        finalPayoffScore,
        movementCohesionScore,
        compositeCycleScore,
        completedMovementCount: completedCount,
        plannedMovementCount: plannedCount,
        allMovementsPassedGate3,
        movementNotes,
    };
}
