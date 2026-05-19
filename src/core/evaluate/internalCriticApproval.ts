import type {
    CraftScoreSummary,
    InternalCriticApproval,
    InternalCriticApprovalThresholds,
    PianoCraftScoreSummary,
} from "../pipeline/types.js";
import { INTERNAL_CRITIC_APPROVAL_THRESHOLDS_V1 } from "../pipeline/types.js";

// internalCriticApproval.ts — AXIOM primary approval gate
// ──────────────────────────────────────────────────────────────────────────────
// The AXIOM internal critic is the PRIMARY signal for:
//   - SFT dataset curation (what gets into the training set)
//   - Candidate quality gate (what is retained for export / ranking)
//
// Philosophy:
//   This is a classical composition AI aiming at masterwork-level output.
//   The goal is NOT to optimize for popular preference.
//   The internal critic measures structural, harmonic, and evidential quality.
//   Human feedback ("curatorCalibration") is a SECONDARY calibration signal only.
//
// Approval requires ALL of the following:
//   finalCraftScore       >= threshold.finalCraftScore       (default 0.70)
//   advancedCraftScore    >= threshold.advancedCraftScore    (default 0.60)
//   harmonyContractScore  >= threshold.harmonyContractScore  (default 0.70)
//   evidenceCoverageScore >= threshold.evidenceCoverageScore (default 0.55)
//
// Optional piano gate (piano candidates only):
//   pianoListenabilityScore >= threshold.pianoListenabilityScore (default 0.50)
//
// All thresholds are configurable via the scoring profile.
// ──────────────────────────────────────────────────────────────────────────────

export interface InternalCriticApprovalOpts {
    thresholds?: Partial<InternalCriticApprovalThresholds & { pianoListenabilityScore: number }>;
    scoringProfileId?: string;
    evaluatedAt?: string;
}

const DEFAULT_PIANO_THRESHOLD = 0.50;

/**
 * Computes the InternalCriticApproval result for a candidate.
 *
 * This is the primary approval gate for dataset curation and SFT export.
 * Human curator feedback is NOT involved in this decision.
 *
 * @param craftScore   CraftScoreSummary from computeCraftScoreSummary()
 * @param pianoScore   Optional PianoCraftScoreSummary (piano candidates only)
 * @param opts         Optional threshold overrides and metadata
 */
export function computeInternalCriticApproval(
    craftScore: CraftScoreSummary,
    pianoScore?: PianoCraftScoreSummary,
    opts?: InternalCriticApprovalOpts,
): InternalCriticApproval {
    const thresholds = {
        ...INTERNAL_CRITIC_APPROVAL_THRESHOLDS_V1,
        ...(opts?.thresholds ?? {}),
    };
    const pianothreshold = opts?.thresholds && "pianoListenabilityScore" in opts.thresholds
        ? (opts.thresholds as { pianoListenabilityScore?: number }).pianoListenabilityScore ?? DEFAULT_PIANO_THRESHOLD
        : DEFAULT_PIANO_THRESHOLD;

    const finalCraftScore       = craftScore.finalCraftScore       ?? 0;
    const advancedCraftScore    = craftScore.advancedCraftScore    ?? 0;
    const harmonyContractScore  = craftScore.harmonyContractScore  ?? 1; // default 1 when no harmony plan
    const evidenceCoverageScore = craftScore.evidenceCoverageScore ?? 0;
    const pianoListenabilityScore = pianoScore?.pianoListenabilityScore ?? undefined;

    const failedDimensions: string[] = [];

    if (finalCraftScore < thresholds.finalCraftScore) {
        failedDimensions.push(`finalCraftScore(${finalCraftScore.toFixed(3)}<${thresholds.finalCraftScore})`);
    }
    if (advancedCraftScore < thresholds.advancedCraftScore) {
        failedDimensions.push(`advancedCraftScore(${advancedCraftScore.toFixed(3)}<${thresholds.advancedCraftScore})`);
    }
    if (harmonyContractScore < thresholds.harmonyContractScore) {
        failedDimensions.push(`harmonyContractScore(${harmonyContractScore.toFixed(3)}<${thresholds.harmonyContractScore})`);
    }
    if (evidenceCoverageScore < thresholds.evidenceCoverageScore) {
        failedDimensions.push(`evidenceCoverageScore(${evidenceCoverageScore.toFixed(3)}<${thresholds.evidenceCoverageScore})`);
    }
    if (pianoListenabilityScore !== undefined && pianoListenabilityScore < pianothreshold) {
        failedDimensions.push(`pianoListenabilityScore(${pianoListenabilityScore.toFixed(3)}<${pianothreshold})`);
    }

    return {
        approved: failedDimensions.length === 0,
        finalCraftScore,
        advancedCraftScore,
        harmonyContractScore,
        evidenceCoverageScore,
        ...(pianoListenabilityScore !== undefined ? { pianoListenabilityScore } : {}),
        scoringProfileId: opts?.scoringProfileId ?? craftScore.scoringProfile ?? "unknown",
        failedDimensions,
        evaluatedAt: opts?.evaluatedAt ?? new Date().toISOString(),
    };
}
