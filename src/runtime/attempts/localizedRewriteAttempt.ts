import type { ComposeRequest, RevisionDirective } from "../../core/pipeline/types.js";
import { buildStructureRevisionDirectives } from "../../core/evaluate/quality.js";
import { buildHarmonyContractRevisionDirectives } from "../../core/evaluate/harmonyRealizationContract.js";
import { compareStructureEvaluationsForCandidateSelection } from "../../core/generate/structureSelection.js";
import { buildHybridSymbolicSelectionReason } from "../../core/generate/hybridSymbolicCandidatePool.js";
import type { SymbolicAttemptCandidate } from "./candidateSelection.js";

export interface LocalizedRewriteBranchParent {
    candidate: SymbolicAttemptCandidate;
    revisionDirectives: RevisionDirective[];
}

export function buildLearnedRerankerPromotionStopReason(
    currentReason: string | undefined,
    heuristicCandidate: SymbolicAttemptCandidate,
    promotedCandidate: SymbolicAttemptCandidate,
    lane: string,
    snapshotId: string,
    confidence: number,
): string {
    const fragments = currentReason ? [currentReason] : [];
    fragments.push(
        `learned reranker promoted attempt ${promotedCandidate.attempt} over heuristic attempt ${heuristicCandidate.attempt} in ${lane} lane (snapshot=${snapshotId}; confidence=${confidence.toFixed(3)})`,
    );
    return fragments.join("; ");
}

export function buildLocalizedRewriteBranchVariantKey(
    candidate: SymbolicAttemptCandidate,
    branchIndex: number,
): string {
    if (candidate.request.candidateVariantKey) {
        return `${candidate.request.candidateVariantKey}-rewrite`;
    }

    return `${candidate.executionPlan.composeWorker}-rewrite-${branchIndex}`;
}

export function collectSameAttemptLocalizedRewriteParents(
    request: ComposeRequest,
    attemptCandidates: SymbolicAttemptCandidate[],
    targetStructureScore?: number,
): LocalizedRewriteBranchParent[] {
    const branchBudget = request.localizedRewriteBranches ?? 0;
    if (branchBudget <= 0 || (request.revisionDirectives?.length ?? 0) > 0) {
        return [];
    }

    // Allow when using Phase D explicit candidate counts OR when legacy candidateCount >= 3
    const hasExplicitLearnedCount = (request.learnedCandidateCount ?? 0) >= 1;
    const hasLegacyCandidateCount = (request.candidateCount ?? 0) >= 3;
    if (!hasExplicitLearnedCount && !hasLegacyCandidateCount) {
        return [];
    }

    return [...attemptCandidates]
        .map((candidate) => {
            const sectionedDirectives = buildStructureRevisionDirectives(
                candidate.structureEvaluation,
                targetStructureScore,
                candidate.request,
            ).filter((directive) => (directive.sectionIds?.length ?? 0) > 0);

            const harmonyDirectives =
                (candidate.structureEvaluation.craftScoreSummary?.harmonyContractViolations ?? 0) > 0
                    ? buildHarmonyContractRevisionDirectives(
                        candidate.composeResult.sectionArtifacts ?? [],
                        candidate.compositionPlan,
                    )
                    : [];

            return { candidate, revisionDirectives: [...sectionedDirectives, ...harmonyDirectives] };
        })
        .filter((entry) => entry.revisionDirectives.length > 0)
        .sort((left, right) => compareStructureEvaluationsForCandidateSelection(
            right.candidate.structureEvaluation,
            left.candidate.structureEvaluation,
        ))
        .slice(0, branchBudget);
}

export function buildLocalizedRewriteBranchStopReason(
    currentReason: string | undefined,
    selectedCandidate: SymbolicAttemptCandidate,
    attemptCandidates: SymbolicAttemptCandidate[],
): string | undefined {
    if ((selectedCandidate.request.revisionDirectives?.length ?? 0) === 0) {
        return currentReason;
    }

    const wholePieceCandidateCount = attemptCandidates.filter((candidate) => (candidate.request.revisionDirectives?.length ?? 0) === 0).length;
    if (wholePieceCandidateCount === 0 || wholePieceCandidateCount === attemptCandidates.length) {
        return currentReason;
    }

    const fragments = currentReason ? [currentReason] : [];
    fragments.push(`selected same-attempt localized rewrite branch after reviewing ${wholePieceCandidateCount} whole-piece candidates`);
    return fragments.join("; ");
}

export function buildHybridAttemptStopReason(
    currentReason: string | undefined,
    selectedCandidate: SymbolicAttemptCandidate,
    attemptCandidates: SymbolicAttemptCandidate[],
): string {
    return buildHybridSymbolicSelectionReason(
        currentReason,
        {
            candidateId: selectedCandidate.candidateId,
            attempt: selectedCandidate.attempt,
            composeWorker: selectedCandidate.executionPlan.composeWorker,
            structureScore: selectedCandidate.structureEvaluation.score,
            lane: selectedCandidate.composeResult.proposalEvidence?.lane,
        },
        attemptCandidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            attempt: candidate.attempt,
            composeWorker: candidate.executionPlan.composeWorker,
            structureScore: candidate.structureEvaluation.score,
            lane: candidate.composeResult.proposalEvidence?.lane,
        })),
    );
}
