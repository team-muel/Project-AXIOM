import { config } from "../config.js";
import { STRUCTURE_SHADOW_HIGH_CONFIDENCE } from "./structureShadowHistory.js";
import { inspectStructureRerankerShadow } from "./structureShadowReranker.js";
import type {
    ComposeExecutionPlan,
    ComposeQualityPolicy,
    ComposeRequest,
    CompositionPlan,
    InstrumentAssignment,
    StructureEvaluationReport,
} from "./types.js";

export const STRUCTURE_RERANKER_PROMOTION_LANE = "string_trio_symbolic";

export interface StructureRerankerPromotionCandidate {
    candidateId: string;
    attempt: number;
    structureEvaluation: StructureEvaluationReport;
}

export interface StructureRerankerPromotionInput {
    songId: string;
    currentCandidateId: string;
    candidates: StructureRerankerPromotionCandidate[];
    request: ComposeRequest;
    executionPlan: ComposeExecutionPlan;
    compositionPlan?: CompositionPlan;
    qualityPolicy?: ComposeQualityPolicy;
    requireStructurePass: boolean;
    explicitStructureTarget: boolean;
}

export interface StructureRerankerPromotionDecision {
    candidateId: string;
    attempt: number;
    lane: string;
    snapshotId: string;
    confidence: number;
    heuristicTopCandidateId: string;
    learnedTopCandidateId: string;
    reason?: string;
}

function normalizeInstrumentName(name: unknown): string {
    const normalized = String(name ?? "").trim().toLowerCase();
    if (!normalized) {
        return "";
    }

    if (normalized.includes("violoncello") || normalized.includes("cello")) {
        return "cello";
    }

    if (normalized.includes("viola")) {
        return "viola";
    }

    if (normalized.includes("violin")) {
        return "violin";
    }

    return normalized;
}

function isCanonicalStringTrio(instrumentation: InstrumentAssignment[] | undefined): boolean {
    const instruments = instrumentation ?? [];
    if (instruments.length !== 3) {
        return false;
    }

    const normalized = instruments
        .map((instrument) => normalizeInstrumentName(instrument?.name))
        .filter(Boolean);

    return normalized.length === 3
        && new Set(normalized).size === 3
        && ["violin", "viola", "cello"].every((name) => normalized.includes(name));
}

export function detectStructureRerankerPromotionLane(
    executionPlan: ComposeExecutionPlan,
    compositionPlan?: CompositionPlan,
    targetInstrumentation?: InstrumentAssignment[],
): string | null {
    if (executionPlan.workflow !== "symbolic_only") {
        return null;
    }

    if (compositionPlan?.orchestration?.family === "string_trio") {
        return STRUCTURE_RERANKER_PROMOTION_LANE;
    }

    const instrumentation = compositionPlan?.instrumentation ?? targetInstrumentation;
    return isCanonicalStringTrio(instrumentation)
        ? STRUCTURE_RERANKER_PROMOTION_LANE
        : null;
}

export function isStructureRerankerPromotionLane(
    request: ComposeRequest,
    executionPlan: ComposeExecutionPlan,
    compositionPlan?: CompositionPlan,
): boolean {
    if (!config.structureRerankerPromotionEnabled) {
        return false;
    }

    return detectStructureRerankerPromotionLane(
        executionPlan,
        compositionPlan ?? request.compositionPlan,
        request.targetInstrumentation,
    ) !== null;
}

function meetsStructurePromotionGuards(
    candidate: StructureRerankerPromotionCandidate,
    input: StructureRerankerPromotionInput,
): boolean {
    if (input.requireStructurePass && !candidate.structureEvaluation.passed) {
        return false;
    }

    if (
        input.explicitStructureTarget
        && input.qualityPolicy?.targetStructureScore !== undefined
        && (candidate.structureEvaluation.score ?? 0) < input.qualityPolicy.targetStructureScore
    ) {
        return false;
    }

    return true;
}

export function resolveStructureRerankerPromotion(
    input: StructureRerankerPromotionInput,
): StructureRerankerPromotionDecision | null {
    if (!isStructureRerankerPromotionLane(input.request, input.executionPlan, input.compositionPlan)) {
        return null;
    }

    const shadowRanking = inspectStructureRerankerShadow(input.songId);
    if (!shadowRanking || !shadowRanking.disagreement) {
        return null;
    }

    if (shadowRanking.confidence < STRUCTURE_SHADOW_HIGH_CONFIDENCE) {
        return null;
    }

    if (shadowRanking.heuristicTopCandidateId !== input.currentCandidateId) {
        return null;
    }

    const promotedCandidate = input.candidates.find(
        (candidate) => candidate.candidateId === shadowRanking.learnedTopCandidateId,
    );
    if (!promotedCandidate || !meetsStructurePromotionGuards(promotedCandidate, input)) {
        return null;
    }

    return {
        candidateId: promotedCandidate.candidateId,
        attempt: promotedCandidate.attempt,
        lane: STRUCTURE_RERANKER_PROMOTION_LANE,
        snapshotId: shadowRanking.snapshotId,
        confidence: shadowRanking.confidence,
        heuristicTopCandidateId: shadowRanking.heuristicTopCandidateId,
        learnedTopCandidateId: shadowRanking.learnedTopCandidateId,
        ...(shadowRanking.reason ? { reason: shadowRanking.reason } : {}),
    };
}