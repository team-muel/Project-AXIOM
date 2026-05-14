import type { CraftScoreSummary, StructureEvaluationReport } from "./types.js";

// ---------------------------------------------------------------------------
// Craft quality gate
// ---------------------------------------------------------------------------
//
// Two-stage candidate selection:
//
//   Stage 1 — quality gate:
//     Candidates that meet all three thresholds are "gate-passers" and receive
//     a large bonus that reliably floats them above gate-failers within the
//     same passed=true tier.  Thresholds are strict enough to reject candidates
//     whose craft dimensions signal a structurally problematic output, but not
//     so strict that all candidates fail in cold-start.
//
//   Stage 2 — rank:
//     Within gate-passers the craft dimension bonus (finalCraftScore * 150) and
//     the existing structure bonuses determine the shortlist order.
//     Gate-failers still compete but at a large disadvantage (-400 pts gap).
//
// The final winner from the shortlist is selected by the listenerFeedback
// preference model (see src/pipeline/preferenceModel.ts), not craft alone.
// ---------------------------------------------------------------------------

export const CRAFT_QUALITY_GATE: Readonly<{
    sectionContractFit: number;
    syntaxValidity: number;
    registerIdiomaticFit: number;
}> = {
    sectionContractFit: 0.75,
    syntaxValidity:     0.90,
    registerIdiomaticFit: 0.75,
} as const;

/**
 * Returns true when all three quality-gate dimensions meet their thresholds.
 * Gate-passing candidates receive a large bonus in
 * scoreStructureEvaluationForCandidateSelection() that separates them from
 * gate-failers within the same `passed` tier.
 */
export function craftScorePassesQualityGate(craft: CraftScoreSummary): boolean {
    return (
        craft.sectionContractFit >= CRAFT_QUALITY_GATE.sectionContractFit
        && craft.syntaxValidity >= CRAFT_QUALITY_GATE.syntaxValidity
        && craft.registerIdiomaticFit >= CRAFT_QUALITY_GATE.registerIdiomaticFit
    );
}

export function scoreStructureEvaluationForCandidateSelection(evaluation: StructureEvaluationReport): number {
    const baseScore = evaluation.score ?? 0;
    const sectionFindings = evaluation.sectionFindings ?? [];
    const weakestSections = evaluation.weakestSections ?? [];
    const averageSectionScore = sectionFindings.length > 0
        ? sectionFindings.reduce((sum, finding) => sum + finding.score, 0) / sectionFindings.length
        : baseScore;
    const weakestSectionPenalty = weakestSections.reduce((sum, finding) => (
        sum
        + 14
        + ((100 - finding.score) * 0.45)
        + (finding.issues.length * 3)
    ), 0);
    const tensionMismatch = typeof evaluation.metrics?.tensionArcMismatch === "number"
        ? evaluation.metrics.tensionArcMismatch
        : 0;
    const cadenceBonus = typeof evaluation.metrics?.cadenceResolved === "number"
        ? evaluation.metrics.cadenceResolved * 6
        : 0;
    const harmonicPlanBonus = typeof evaluation.metrics?.sectionHarmonicPlanFit === "number"
        ? evaluation.metrics.sectionHarmonicPlanFit * 35
        : 0;
    const formCoherenceBonus = typeof evaluation.metrics?.formCoherenceScore === "number"
        ? evaluation.metrics.formCoherenceScore * 45
        : 0;
    const registerPlanBonus = typeof evaluation.metrics?.registerPlanFit === "number"
        ? evaluation.metrics.registerPlanFit * 22
        : 0;
    const cadenceApproachBonus = typeof evaluation.metrics?.cadenceApproachPlanFit === "number"
        ? evaluation.metrics.cadenceApproachPlanFit * 16
        : 0;
    const orchestrationRangeBonus = typeof evaluation.metrics?.orchestrationIdiomaticRangeFit === "number"
        ? evaluation.metrics.orchestrationIdiomaticRangeFit * 12
        : 0;
    const orchestrationBalanceBonus = typeof evaluation.metrics?.orchestrationRegisterBalanceFit === "number"
        ? evaluation.metrics.orchestrationRegisterBalanceFit * 14
        : 0;
    const orchestrationConversationBonus = typeof evaluation.metrics?.orchestrationConversationFit === "number"
        ? evaluation.metrics.orchestrationConversationFit * 9
        : 0;
    const orchestrationDoublingBonus = typeof evaluation.metrics?.orchestrationDoublingPressureFit === "number"
        ? evaluation.metrics.orchestrationDoublingPressureFit * 8
        : 0;
    const orchestrationRotationBonus = typeof evaluation.metrics?.orchestrationTextureRotationFit === "number"
        ? evaluation.metrics.orchestrationTextureRotationFit * 8
        : 0;
    const orchestrationHandoffBonus = typeof evaluation.metrics?.orchestrationSectionHandoffFit === "number"
        ? evaluation.metrics.orchestrationSectionHandoffFit * 10
        : 0;

    // ── Two-stage craft gate + rank ──────────────────────────────────────────
    //
    // Stage 1 — quality gate:
    //   craftQualityGateBonus = 400 when gate passes; 0 otherwise.
    //   400 pts ≈ 20 % of a typical passed=true score (~2000), reliably
    //   separating gate-passers from gate-failers within the same tier.
    //
    // Stage 2 — within-gate rank:
    //   craftDimensionBonus = finalCraftScore * 150 (gate-passers)
    //                       = finalCraftScore * 50  (gate-failers, keep signal)
    //
    // contractPenalty: retained for gate-failers with very poor contract fit.
    // ──────────────────────────────────────────────────────────────────────────
    const craft = evaluation.craftScoreSummary;
    const passesGate = craft ? craftScorePassesQualityGate(craft) : false;
    const craftQualityGateBonus = passesGate ? 400 : 0;
    const craftDimensionBonus = craft
        ? craft.finalCraftScore * (passesGate ? 150 : 50)
        : 0;
    const contractPenalty = craft && craft.sectionContractFit < 0.5
        ? (0.5 - craft.sectionContractFit) * 60
        : 0;

    return Number(((evaluation.passed ? 1_000 : 0)
        + (baseScore * 10)
        + averageSectionScore
        + cadenceBonus
        + harmonicPlanBonus
        + formCoherenceBonus
        + registerPlanBonus
        + cadenceApproachBonus
        + orchestrationRangeBonus
        + orchestrationBalanceBonus
        + orchestrationConversationBonus
        + orchestrationDoublingBonus
        + orchestrationRotationBonus
        + orchestrationHandoffBonus
        + craftQualityGateBonus
        + craftDimensionBonus
        - weakestSectionPenalty
        - contractPenalty
        - (tensionMismatch * 40)).toFixed(4));
}


const STRUCTURE_SELECTION_RANK_TOLERANCE = 1;

interface StructureSelectionTieBreak {
    minimumSectionScore: number;
    averageSectionScore: number;
    scoreSpread: number;
    sectionIssueCount: number;
    globalIssueCount: number;
    weakestSectionCount: number;
}

function normalizeStructureSelectionScore(score: unknown): number {
    if (typeof score !== "number" || !Number.isFinite(score)) {
        return 0;
    }

    return score > 1 ? score : score * 100;
}

function structureSelectionFindings(evaluation: StructureEvaluationReport): NonNullable<StructureEvaluationReport["sectionFindings"]> {
    if (evaluation.sectionFindings?.length) {
        return evaluation.sectionFindings;
    }

    return evaluation.weakestSections ?? [];
}

function buildStructureSelectionTieBreak(evaluation: StructureEvaluationReport): StructureSelectionTieBreak {
    const findings = structureSelectionFindings(evaluation);
    if (findings.length === 0) {
        const fallbackScore = normalizeStructureSelectionScore(evaluation.score);
        return {
            minimumSectionScore: fallbackScore,
            averageSectionScore: fallbackScore,
            scoreSpread: 0,
            sectionIssueCount: 0,
            globalIssueCount: evaluation.issues.length,
            weakestSectionCount: evaluation.weakestSections?.length ?? 0,
        };
    }

    const normalizedScores = findings.map((finding) => normalizeStructureSelectionScore(finding.score));
    const minimumSectionScore = Math.min(...normalizedScores);
    const maximumSectionScore = Math.max(...normalizedScores);
    const averageSectionScore = normalizedScores.reduce((sum, score) => sum + score, 0) / normalizedScores.length;
    const sectionIssueCount = findings.reduce((sum, finding) => sum + finding.issues.length, 0);

    return {
        minimumSectionScore,
        averageSectionScore: Number(averageSectionScore.toFixed(4)),
        scoreSpread: Number((maximumSectionScore - minimumSectionScore).toFixed(4)),
        sectionIssueCount,
        globalIssueCount: evaluation.issues.length,
        weakestSectionCount: evaluation.weakestSections?.length ?? 0,
    };
}

function resolveStructureSelectionTieBreak(
    left: StructureSelectionTieBreak,
    right: StructureSelectionTieBreak,
): number {
    const comparisons = [
        left.minimumSectionScore - right.minimumSectionScore,
        right.sectionIssueCount - left.sectionIssueCount,
        right.globalIssueCount - left.globalIssueCount,
        right.weakestSectionCount - left.weakestSectionCount,
        right.scoreSpread - left.scoreSpread,
        left.averageSectionScore - right.averageSectionScore,
    ];

    for (const comparison of comparisons) {
        if (Math.abs(comparison) > 0.0001) {
            return Number(comparison.toFixed(4));
        }
    }

    return 0;
}

export function compareStructureEvaluationsForCandidateSelection(
    left: StructureEvaluationReport,
    right: StructureEvaluationReport,
): number {
    const rankDelta = Number((
        scoreStructureEvaluationForCandidateSelection(left)
        - scoreStructureEvaluationForCandidateSelection(right)
    ).toFixed(4));

    if (Math.abs(rankDelta) > STRUCTURE_SELECTION_RANK_TOLERANCE) {
        return rankDelta;
    }

    return resolveStructureSelectionTieBreak(
        buildStructureSelectionTieBreak(left),
        buildStructureSelectionTieBreak(right),
    );
}