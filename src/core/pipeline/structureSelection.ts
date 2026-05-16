import type { CraftScoreSummary, PianoCraftScoreSummary, StructureEvaluationReport } from "./types.js";

// ---------------------------------------------------------------------------
// Three-gate candidate selection
// ---------------------------------------------------------------------------
//
// Candidates are classified into four tiers before ranking:
//
//   Tier 0 — no gate passes:
//     No validity, contract, or craft requirement met.
//
//   Tier 1 — validity gate (Gate 1):
//     syntaxValidity >= 0.90 AND evaluation.passed === true.
//     Weeds out candidates whose ABC/MIDI structure is broken.
//     MIDI existence is checked separately in the orchestrator because
//     structureSelection functions only see StructureEvaluationReport.
//
//   Tier 2 — validity + contract gate (Gate 1 + Gate 2):
//     All of Tier 1, plus sectionContractFit >= 0.75.
//     Weeds out candidates that ignore the composition plan
//     (wrong section count, missing final section, mismatched measures).
//
//   Tier 3 — validity + contract + craft gate (all three):
//     Generic lane:  cadenceStrength >= 0.55, registerIdiomaticFit >= 0.75,
//                    voiceIndependence >= 0.35   (passesCraftGate).
//     Piano lane:    handPlayability >= 0.55 AND finalPianoScore >= 0.50
//                    (passesPianoCraftGate).
//     When pianoCraftScoreSummary is present in the report, the piano gate
//     replaces the generic craft gate for Tier-3 classification and ranking.
//     Weeds out candidates that are structurally correct but
//     musically weak, or—for piano—physically unplayable.
//
// Ranking within the shortlist:
//   Gate-tier bonus:    Tier 3 = +900 pts, Tier 2 = +500, Tier 1 = +200.
//   Craft-dimension bonus: finalCraftScore * (150 | 75 | 30) by tier.
//   Piano-lane adds: finalPianoScore * (200 | 100 | 40) instead, so that
//   piano-idiomatic quality separates candidates more decisively.
//   The remaining structure score terms are unchanged.
//
// The final winner from the shortlist is selected by the listenerFeedback
// preference model (see src/pipeline/preferenceModel.ts), not craft alone.
// ---------------------------------------------------------------------------

// ── Gate 1: validity ────────────────────────────────────────────────────────
export const CANDIDATE_GATE_VALIDITY: Readonly<{
    syntaxValidity: number;
}> = {
    syntaxValidity: 0.90,
} as const;

// ── Gate 2: section-contract ─────────────────────────────────────────────────
export const CANDIDATE_GATE_CONTRACT: Readonly<{
    sectionContractFit: number;
}> = {
    sectionContractFit: 0.75,
} as const;

// ── Gate 3: musical craft (generic) ──────────────────────────────────────────
export const CANDIDATE_GATE_CRAFT: Readonly<{
    cadenceStrength: number;
    registerIdiomaticFit: number;
    voiceIndependence: number;
}> = {
    cadenceStrength:    0.55,
    registerIdiomaticFit: 0.75,
    voiceIndependence: 0.35,
} as const;

// ── Gate 3: piano craft ───────────────────────────────────────────────────────
// Piano candidates are unplayable before they are musically weak.
// handPlayability is the primary gate dimension; finalPianoScore provides a
// floor on overall quality.
export const CANDIDATE_GATE_PIANO_CRAFT: Readonly<{
    handPlayability: number;
    finalPianoScore: number;
}> = {
    handPlayability: 0.55,
    finalPianoScore: 0.50,
} as const;

/**
 * Gate 1: returns true when the candidate has valid ABC/MIDI structure.
 *
 * Note: "MIDI exists" (midiData.length > 0) is an orchestrator-level check
 * that must be done separately before calling this function.
 */
export function passesValidityGate(
    evaluation: StructureEvaluationReport,
    craft: CraftScoreSummary,
): boolean {
    return evaluation.passed === true
        && craft.syntaxValidity >= CANDIDATE_GATE_VALIDITY.syntaxValidity;
}

/**
 * Gate 2: returns true when the candidate satisfies the section-contract
 * requirements (section count, measure counts, final section presence).
 * Requires Gate 1 to pass first.
 */
export function passesContractGate(craft: CraftScoreSummary): boolean {
    return craft.sectionContractFit >= CANDIDATE_GATE_CONTRACT.sectionContractFit;
}

/**
 * Gate 3 (generic): returns true when the candidate meets the musical-craft
 * thresholds (cadence resolution, idiomatic register, voice independence).
 * Requires Gates 1 + 2 to pass first.
 * Not used for piano lane — use passesPianoCraftGate() instead.
 */
export function passesCraftGate(craft: CraftScoreSummary): boolean {
    return (
        craft.cadenceStrength    >= CANDIDATE_GATE_CRAFT.cadenceStrength
        && craft.registerIdiomaticFit >= CANDIDATE_GATE_CRAFT.registerIdiomaticFit
        && craft.voiceIndependence    >= CANDIDATE_GATE_CRAFT.voiceIndependence
    );
}

/**
 * Gate 3 (piano): replaces the generic craft gate for solo_piano lane.
 *
 * A piano candidate must be physically playable before any other quality
 * consideration.  handPlayability failing here means the piece cannot be
 * performed regardless of how good the harmony or melody sounds.
 *
 * Requires Gates 1 + 2 to pass first.
 */
export function passesPianoCraftGate(piano: PianoCraftScoreSummary): boolean {
    return (
        piano.handPlayability >= CANDIDATE_GATE_PIANO_CRAFT.handPlayability
        && piano.finalPianoScore  >= CANDIDATE_GATE_PIANO_CRAFT.finalPianoScore
    );
}

/**
 * Returns the highest gate tier reached by the candidate (0–3).
 *
 * - 0: no gate passes
 * - 1: validity (Gate 1) passes
 * - 2: validity + contract (Gates 1–2) pass
 * - 3: all three gates pass
 *
 * When the report carries a pianoCraftScoreSummary the piano gate is used
 * for Tier-3 classification instead of the generic craft gate.  This ensures
 * that an unplayable piano piece never reaches Tier 3 even if its generic
 * craft dimensions look acceptable.
 *
 * The orchestrator uses this tier to build the preference shortlist, preferring
 * the highest non-empty tier with a staircase fallback to all candidates.
 */
export function candidateGateTier(
    evaluation: StructureEvaluationReport,
    craft: CraftScoreSummary,
): 0 | 1 | 2 | 3 {
    if (!passesValidityGate(evaluation, craft)) return 0;
    if (!passesContractGate(craft)) return 1;

    // Piano lane: use piano-specific Gate 3 when available
    const piano = evaluation.pianoCraftScoreSummary;
    if (piano) {
        return passesPianoCraftGate(piano) ? 3 : 2;
    }

    // Generic lane
    if (!passesCraftGate(craft)) return 2;
    return 3;
}

// ---------------------------------------------------------------------------
// Legacy alias — kept for backward compatibility with existing call-sites.
// New code should use candidateGateTier() instead.
// ---------------------------------------------------------------------------

/** @deprecated Use candidateGateTier(evaluation, craft) >= 2 instead. */
export const CRAFT_QUALITY_GATE: Readonly<{
    sectionContractFit: number;
    syntaxValidity: number;
    registerIdiomaticFit: number;
}> = {
    sectionContractFit: CANDIDATE_GATE_CONTRACT.sectionContractFit,
    syntaxValidity:     CANDIDATE_GATE_VALIDITY.syntaxValidity,
    registerIdiomaticFit: CANDIDATE_GATE_CRAFT.registerIdiomaticFit,
} as const;

/**
 * @deprecated Use candidateGateTier(evaluation, craft) >= 3 instead.
 *
 * Returns true when the craft summary meets the legacy two-dimensional
 * gate that combined contract + craft checks (syntaxValidity, sectionContractFit,
 * registerIdiomaticFit).  Retained so that existing test and orchestrator
 * call-sites compile without change; new code should use candidateGateTier().
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

    // ── Three-gate bonus system ──────────────────────────────────────────────
    //
    // Gate tier is 0–3 (see candidateGateTier()).  Each tier receives a
    // progressively larger bonus that cleanly separates tiers in the sorted
    // order, preventing a "syntactically valid but musically hollow" candidate
    // from beating a fully gate-3-qualified candidate on structure score alone.
    //
    //   Tier 3 (all gates): +900 pts   ← preferred shortlist
    //   Tier 2 (validity + contract):  +500 pts
    //   Tier 1 (validity only):        +200 pts
    //   Tier 0 (no gate):                 0 pts
    //
    // craftDimensionBonus scales with the tier so that within a tier the
    // candidates are further ranked by craft quality.
    //
    // Piano lane replaces craftDimensionBonus with pianoDimensionBonus using
    // finalPianoScore and a higher multiplier (200/100/40) so that playability
    // quality separates piano candidates more decisively.
    //
    // A piano candidate that fails handPlayability Gate 3 but has a high
    // genericCraftScore cannot leapfrog a playable piano candidate — the
    // gate tier difference (+400 pts) dwarfs any craft dimension advantage.
    //
    // contractPenalty is retained for tier-0 candidates with very poor fit.
    // ──────────────────────────────────────────────────────────────────────────
    const craft = evaluation.craftScoreSummary;
    const piano = evaluation.pianoCraftScoreSummary;
    const tier = craft ? candidateGateTier(evaluation, craft) : 0;
    const gateTierBonus = tier === 3 ? 900 : tier === 2 ? 500 : tier === 1 ? 200 : 0;

    // Piano lane: use finalPianoScore as the dimension bonus signal.
    // Generic lane: use finalCraftScore as before.
    const craftDimensionBonus = piano
        ? piano.finalPianoScore * (tier === 3 ? 200 : tier > 0 ? 100 : 40)
        : craft
            ? craft.finalCraftScore * (tier === 3 ? 150 : tier > 0 ? 75 : 30)
            : 0;

    // Piano playability penalty: when a piano candidate is at Tier 2 (failed
    // Gate 3) due to low handPlayability, add an extra penalty proportional
    // to the shortfall so that barely-failing piano candidates rank below
    // passing ones even within Tier 2.
    const pianoPlayabilityPenalty = piano && tier < 3
        ? Math.max(0, CANDIDATE_GATE_PIANO_CRAFT.handPlayability - piano.handPlayability) * 120
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
        + gateTierBonus
        + craftDimensionBonus
        - pianoPlayabilityPenalty
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