import type {
    ComposeExecutionPlan,
    ComposeRequest,
    ComposeResult,
    CompositionPlan,
    StructureEvaluationReport,
} from "../../core/pipeline/types.js";
import {
    candidateGateTier,
    compareStructureEvaluationsForCandidateSelection,
} from "../../core/generate/structureSelection.js";
import {
    PREFERENCE_SHORTLIST_SIZE,
    selectPreferredCandidate,
} from "../../core/generate/preferenceModel.js";
import { logger } from "../../logging/logger.js";

export interface SymbolicAttemptCandidate {
    candidateId: string;
    attempt: number;
    request: ComposeRequest;
    composeResult: ComposeResult;
    executionPlan: ComposeExecutionPlan;
    compositionPlan?: CompositionPlan;
    midiData: Buffer;
    structureEvaluation: StructureEvaluationReport;
}

export function chooseBetterSymbolicCandidate(
    current: SymbolicAttemptCandidate | undefined,
    next: SymbolicAttemptCandidate,
): SymbolicAttemptCandidate {
    if (!current) {
        return next;
    }

    return compareStructureEvaluationsForCandidateSelection(next.structureEvaluation, current.structureEvaluation) > 0
        ? next
        : current;
}

/**
 * Selects the final winner from an attempt's candidate pool using the
 * preference model.
 *
 * Selection stages:
 *   1. Sort all candidates by heuristic structure score (gate-tier bonus
 *      already baked in via scoreStructureEvaluationForCandidateSelection).
 *   2. Build the preference shortlist using a gate-tier staircase:
 *        Tier 3 (validity + contract + craft) → Tier 2 → Tier 1 → full list.
 *      Tier 3 candidates have valid MIDI, respect the section contract, AND
 *      meet the musical-craft thresholds (cadence, register, independence).
 *   3. Pass the shortlist to selectPreferredCandidate(), which applies the
 *      craft hard filter and uses the listenerFeedback preference model.
 *   4. Fall back to the heuristic top candidate if preference selection fails.
 */
export function selectAttemptWinner(
    attemptCandidates: SymbolicAttemptCandidate[],
    songId: string,
): SymbolicAttemptCandidate {
    if (attemptCandidates.length === 0) {
        throw new Error("selectAttemptWinner: empty candidate list");
    }
    if (attemptCandidates.length === 1) {
        return attemptCandidates[0]!;
    }

    // Sort all candidates — gate-tier bonus is already embedded in the score,
    // so higher-tier candidates naturally float above lower-tier ones within
    // the same passed=true group.
    const sorted = [...attemptCandidates]
        .sort((a, b) => compareStructureEvaluationsForCandidateSelection(
            b.structureEvaluation, a.structureEvaluation,
        ));

    // ── Gate-tier staircase shortlist ────────────────────────────────────────
    // Gate 1 (validity): MIDI data must exist AND syntaxValidity >= 0.90
    //   AND evaluation.passed === true.
    // Gate 2 (contract): Gate 1 + sectionContractFit >= 0.75.
    // Gate 3 (craft):    Gate 2 + cadenceStrength >= 0.55
    //                             + registerIdiomaticFit >= 0.75
    //                             + voiceIndependence >= 0.35.
    //
    // Prefer the highest non-empty tier as the shortlist base, cascading
    // down to the full sorted list as an ultimate cold-start fallback so
    // we always have a candidate to return.
    // ──────────────────────────────────────────────────────────────────────────
    const byTier = (minTier: 1 | 2 | 3) => sorted.filter((c) => {
        if (c.midiData.length === 0) return false;  // Gate 1 prerequisite
        const craft = c.structureEvaluation.craftScoreSummary;
        return craft != null && candidateGateTier(c.structureEvaluation, craft) >= minTier;
    });

    const tier3 = byTier(3);
    const tier2 = byTier(2);
    const tier1 = byTier(1);

    const shortlistBase = tier3.length > 0 ? tier3
        : tier2.length > 0 ? tier2
        : tier1.length > 0 ? tier1
        : sorted;  // cold-start fallback: no gate passes yet

    const reachedTier = tier3.length > 0 ? 3 : tier2.length > 0 ? 2 : tier1.length > 0 ? 1 : 0;

    if (reachedTier === 0) {
        logger.warn("selectAttemptWinner: no candidate passed any gate — using full sorted list", {
            songId,
            totalCandidates: attemptCandidates.length,
        });
    } else {
        logger.debug("selectAttemptWinner: gate-tier shortlist", {
            songId,
            reachedTier,
            tier3Count: tier3.length,
            tier2Count: tier2.length,
            tier1Count: tier1.length,
            totalCandidates: attemptCandidates.length,
        });
    }

    const shortlist = shortlistBase.slice(0, PREFERENCE_SHORTLIST_SIZE);

    // Build PreferenceCandidate list — craft hard filter and preference scoring require craftScoreSummary
    const preferenceCandidates = shortlist
        .filter((c) => c.structureEvaluation.craftScoreSummary != null)
        .map((c) => {
            const evidence = c.composeResult.proposalEvidence;
            const plan = c.compositionPlan;
            return {
                candidateId: c.candidateId,
                craftSummary: c.structureEvaluation.craftScoreSummary!,
                normalizationWarningsCount: Array.isArray(evidence?.normalizationWarnings)
                    ? evidence.normalizationWarnings.length
                    : 0,
                sectionCount: Array.isArray(plan?.sections)
                    ? plan.sections.length
                    : undefined,
                provider: evidence?.provider ?? c.executionPlan.selectedModels.find(
                    (m) => m.role === "structure",
                )?.provider,
                generationMode: evidence?.generationMode,
            };
        });

    if (preferenceCandidates.length === 0) {
        // No craftScoreSummary available — fall back to heuristic top
        return shortlist[0]!;
    }

    try {
        const result = selectPreferredCandidate(preferenceCandidates, songId);
        logger.debug("Preference model selected final attempt winner", {
            songId,
            selectedCandidateId: result.selectedCandidateId,
            feedbackSamples: result.feedbackSamples,
            globalFeedbackSamples: result.globalFeedbackSamples,
            weightSource: result.weightSource,
            filteredOutCount: result.filteredOutIds.length,
        });
        if (result.filteredOutIds.length > 0) {
            logger.warn("Preference model: candidates rejected by craft hard filter", {
                songId,
                filteredOutIds: result.filteredOutIds,
            });
        }
        const winner = shortlist.find((c) => c.candidateId === result.selectedCandidateId);
        return winner ?? shortlist[0]!;
    } catch (err) {
        logger.warn("Preference model selection failed — falling back to heuristic top", {
            songId,
            error: String(err),
        });
        return shortlist[0]!;
    }
}
