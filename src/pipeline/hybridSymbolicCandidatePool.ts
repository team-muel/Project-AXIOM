import { STRUCTURE_RERANKER_PROMOTION_LANE, detectStructureRerankerPromotionLane } from "./structureRerankerPromotion.js";
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
): ComposeRequest {
    return {
        ...request,
        ...(request.workflow ? { workflow: request.workflow } : {}),
        selectedModels: cloneModels(selectedModels),
        ...(compositionPlan ? { compositionPlan } : {}),
        ...(request.plannerVersion ?? compositionPlan?.version
            ? { plannerVersion: request.plannerVersion ?? compositionPlan?.version }
            : {}),
    };
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
            request: normalizeVariantRequest(request, executionPlan.selectedModels, compositionPlan),
        }];
    }

    const learnedBinding = resolveStructureBinding(request.selectedModels ?? executionPlan.selectedModels);
    if (!isLearnedStructureBinding(learnedBinding)) {
        return [{
            variant: "requested",
            lane: null,
            request: normalizeVariantRequest(request, executionPlan.selectedModels, compositionPlan),
        }];
    }
    if (!learnedBinding) {
        return [{
            variant: "requested",
            lane: null,
            request: normalizeVariantRequest(request, executionPlan.selectedModels, compositionPlan),
        }];
    }

    const baseBindings = request.selectedModels?.length ? request.selectedModels : executionPlan.selectedModels;
    const baselineSelectedModels = replaceStructureBinding(baseBindings, BASELINE_STRUCTURE_BINDING);
    const learnedSelectedModels = replaceStructureBinding(baseBindings, learnedBinding);

    return [
        {
            variant: "baseline",
            lane,
            request: normalizeVariantRequest(request, baselineSelectedModels, compositionPlan),
        },
        {
            variant: "learned",
            lane,
            request: normalizeVariantRequest(request, learnedSelectedModels, compositionPlan),
        },
    ];
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

    return alternatives.sort((left, right) => {
        const scoreDelta = (right.structureScore ?? 0) - (left.structureScore ?? 0);
        if (Math.abs(scoreDelta) > 0.0001) {
            return scoreDelta > 0 ? 1 : -1;
        }
        return left.candidateId.localeCompare(right.candidateId);
    })[0] ?? null;
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