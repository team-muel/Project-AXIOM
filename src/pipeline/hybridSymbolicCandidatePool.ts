import { STRUCTURE_RERANKER_PROMOTION_LANE, detectStructureRerankerPromotionLane } from "./structureRerankerPromotionLane.js";
import type {
    ComposeExecutionPlan,
    ComposeRequest,
    ComposeWorkerName,
    CompositionPlan,
    ModelBinding,
} from "./types.js";

export interface HybridSymbolicCandidateRequestVariant {
    variant: "requested" | "baseline" | "learned";
    lane: string | null;
    candidateVariantKey?: string;
    request: ComposeRequest;
}

export interface HybridSymbolicSelectionCandidateSummary {
    candidateId: string;
    attempt: number;
    composeWorker: ComposeWorkerName;
    structureScore?: number;
    lane?: string | null;
}

const BASELINE_STRUCTURE_BINDING: ModelBinding = {
    role: "structure",
    provider: "python",
    model: "music21-symbolic-v1",
};

function cloneModels(selectedModels: ModelBinding[] | undefined): ModelBinding[] {
    return (selectedModels ?? []).map((binding) => ({ ...binding }));
}

function resolveStructureBinding(selectedModels: ModelBinding[] | undefined): ModelBinding | undefined {
    return selectedModels?.find((binding) => binding.role === "structure");
}

function isLearnedStructureBinding(binding: ModelBinding | undefined): boolean {
    if (!binding) {
        return false;
    }

    const provider = String(binding.provider ?? "").trim().toLowerCase();
    const model = String(binding.model ?? "").trim().toLowerCase();
    return provider === "learned"
        || provider === "learned_symbolic"
        || model.startsWith("learned-symbolic")
        || model.startsWith("learned_symbolic");
}

function replaceStructureBinding(
    selectedModels: ModelBinding[] | undefined,
    replacement: ModelBinding,
): ModelBinding[] {
    const nextBindings = cloneModels(selectedModels).filter((binding) => binding.role !== "structure");
    nextBindings.unshift({ ...replacement });
    return nextBindings;
}

function normalizeVariantRequest(
    request: ComposeRequest,
    selectedModels: ModelBinding[],
    compositionPlan?: CompositionPlan,
    candidateVariantKey?: string,
): ComposeRequest {
    return {
        ...request,
        ...(request.workflow ? { workflow: request.workflow } : {}),
        selectedModels: cloneModels(selectedModels),
        ...(compositionPlan ? { compositionPlan } : {}),
        ...(request.plannerVersion ?? compositionPlan?.version
            ? { plannerVersion: request.plannerVersion ?? compositionPlan?.version }
            : {}),
        ...(candidateVariantKey !== undefined ? { candidateVariantKey } : {}),
    };
}

function normalizeHybridCandidateCount(candidateCount: number | undefined): number {
    if (!Number.isFinite(candidateCount)) {
        return 2;
    }

    return Math.max(Math.floor(candidateCount ?? 2), 2);
}

function buildHybridCandidateVariantKey(
    variant: HybridSymbolicCandidateRequestVariant["variant"],
    ordinal: number,
): string | undefined {
    if (variant === "requested" || ordinal <= 1) {
        return undefined;
    }

    return `${variant}-${ordinal}`;
}

function sortCandidateSummaries(
    candidates: HybridSymbolicSelectionCandidateSummary[],
): HybridSymbolicSelectionCandidateSummary[] {
    return [...candidates].sort((left, right) => {
        const scoreDelta = (right.structureScore ?? 0) - (left.structureScore ?? 0);
        if (Math.abs(scoreDelta) > 0.0001) {
            return scoreDelta > 0 ? 1 : -1;
        }
        return left.candidateId.localeCompare(right.candidateId);
    });
}

export function resolveHybridSymbolicCandidateLane(
    request: ComposeRequest,
    executionPlan: ComposeExecutionPlan,
    compositionPlan?: CompositionPlan,
): string | null {
    const learnedBinding = resolveStructureBinding(request.selectedModels ?? executionPlan.selectedModels);
    if (!isLearnedStructureBinding(learnedBinding)) {
        return null;
    }

    return detectStructureRerankerPromotionLane(
        executionPlan,
        compositionPlan ?? request.compositionPlan,
        request.targetInstrumentation,
    );
}

export function buildHybridSymbolicCandidateRequests(
    request: ComposeRequest,
    executionPlan: ComposeExecutionPlan,
    compositionPlan?: CompositionPlan,
): HybridSymbolicCandidateRequestVariant[] {
    const lane = resolveHybridSymbolicCandidateLane(request, executionPlan, compositionPlan);
    if (!lane || lane !== STRUCTURE_RERANKER_PROMOTION_LANE) {
        return [{
            variant: "requested",
            lane: null,
            candidateVariantKey: request.candidateVariantKey,
            request: normalizeVariantRequest(request, executionPlan.selectedModels, compositionPlan),
        }];
    }

    const learnedBinding = resolveStructureBinding(request.selectedModels ?? executionPlan.selectedModels);
    if (!isLearnedStructureBinding(learnedBinding)) {
        return [{
            variant: "requested",
            lane: null,
            candidateVariantKey: request.candidateVariantKey,
            request: normalizeVariantRequest(request, executionPlan.selectedModels, compositionPlan),
        }];
    }
    if (!learnedBinding) {
        return [{
            variant: "requested",
            lane: null,
            candidateVariantKey: request.candidateVariantKey,
            request: normalizeVariantRequest(request, executionPlan.selectedModels, compositionPlan),
        }];
    }

    const baseBindings = request.selectedModels?.length ? request.selectedModels : executionPlan.selectedModels;
    const baselineSelectedModels = replaceStructureBinding(baseBindings, BASELINE_STRUCTURE_BINDING);
    const learnedSelectedModels = replaceStructureBinding(baseBindings, learnedBinding);
    const candidateCount = normalizeHybridCandidateCount(request.candidateCount);
    const variants: HybridSymbolicCandidateRequestVariant[] = [];
    let baselineOrdinal = 0;
    let learnedOrdinal = 0;

    for (let index = 0; index < candidateCount; index += 1) {
        const isBaselineSlot = index % 2 === 0;
        if (isBaselineSlot) {
            baselineOrdinal += 1;
            const candidateVariantKey = buildHybridCandidateVariantKey("baseline", baselineOrdinal);
            variants.push({
                variant: "baseline",
                lane,
                candidateVariantKey,
                request: normalizeVariantRequest(request, baselineSelectedModels, compositionPlan, candidateVariantKey),
            });
            continue;
        }

        learnedOrdinal += 1;
        const candidateVariantKey = buildHybridCandidateVariantKey("learned", learnedOrdinal);
        variants.push({
            variant: "learned",
            lane,
            candidateVariantKey,
            request: normalizeVariantRequest(request, learnedSelectedModels, compositionPlan, candidateVariantKey),
        });
    }

    return variants;
}

export function resolveHybridSymbolicPreferredSelectedModels(
    request: ComposeRequest,
    executionPlan: ComposeExecutionPlan,
    compositionPlan?: CompositionPlan,
): ModelBinding[] | undefined {
    const variants = buildHybridSymbolicCandidateRequests(request, executionPlan, compositionPlan);
    const learnedVariant = variants.find((variant) => variant.variant === "learned");
    return learnedVariant?.request.selectedModels?.map((binding) => ({ ...binding }));
}

function bestAlternativeCandidate(
    winner: HybridSymbolicSelectionCandidateSummary,
    candidates: HybridSymbolicSelectionCandidateSummary[],
): HybridSymbolicSelectionCandidateSummary | null {
    const alternatives = candidates.filter((candidate) => candidate.candidateId !== winner.candidateId);
    if (alternatives.length === 0) {
        return null;
    }

    const crossWorkerAlternatives = alternatives.filter((candidate) => candidate.composeWorker !== winner.composeWorker);
    const rankedAlternatives = sortCandidateSummaries(crossWorkerAlternatives.length ? crossWorkerAlternatives : alternatives);
    return rankedAlternatives[0] ?? null;
}

export function buildHybridSymbolicSelectionReason(
    currentReason: string | undefined,
    winner: HybridSymbolicSelectionCandidateSummary,
    candidates: HybridSymbolicSelectionCandidateSummary[],
): string {
    const alternative = bestAlternativeCandidate(winner, candidates);
    if (!alternative || alternative.composeWorker === winner.composeWorker) {
        return currentReason ?? "";
    }

    const fragments = currentReason ? [currentReason] : [];
    const action = winner.composeWorker === "learned_symbolic" ? "selected" : "kept";
    const lane = winner.lane ?? alternative.lane ?? STRUCTURE_RERANKER_PROMOTION_LANE;
    fragments.push(
        `hybrid candidate pool ${action} ${winner.composeWorker} over ${alternative.composeWorker} in ${lane} lane on heuristic structure score (${(winner.structureScore ?? 0).toFixed(1)} vs ${(alternative.structureScore ?? 0).toFixed(1)})`,
    );
    return fragments.join("; ");
}