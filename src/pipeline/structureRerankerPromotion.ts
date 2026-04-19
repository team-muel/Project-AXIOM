import { config } from "../config.js";
import { listStoredManifests } from "../memory/manifest.js";
import {
    summarizeLearnedBackboneBenchmark,
    type ManifestLearnedBackbonePromotionGateSummary,
} from "../memory/manifestAnalytics.js";
import { logger } from "../logging/logger.js";
import { STRUCTURE_SHADOW_HIGH_CONFIDENCE } from "./structureShadowHistory.js";
import { inspectStructureRerankerShadow } from "./structureShadowReranker.js";
import {
    STRUCTURE_RERANKER_PROMOTION_LANE,
    detectStructureRerankerPromotionLane,
} from "./structureRerankerPromotionLane.js";
import type {
    ComposeExecutionPlan,
    ComposeQualityPolicy,
    ComposeRequest,
    CompositionPlan,
    StructureEvaluationReport,
} from "./types.js";

export {
    STRUCTURE_RERANKER_PROMOTION_LANE,
    detectStructureRerankerPromotionLane,
} from "./structureRerankerPromotionLane.js";

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

interface StructureRerankerPromotionGateReadiness {
    ready: boolean;
    status: ManifestLearnedBackbonePromotionGateSummary["status"];
    signal: ManifestLearnedBackbonePromotionGateSummary["signal"];
    rationale: string | null;
}

function inspectStructureRerankerPromotionGate(): StructureRerankerPromotionGateReadiness {
    const manifests = listStoredManifests();
    const promotionGate = summarizeLearnedBackboneBenchmark(manifests).promotionGate;
    return {
        ready: promotionGate.status === "ready_for_guarded_promotion",
        status: promotionGate.status,
        signal: promotionGate.signal,
        rationale: promotionGate.rationale,
    };
}

export function resolveStructureRerankerPromotion(
    input: StructureRerankerPromotionInput,
): StructureRerankerPromotionDecision | null {
    if (!isStructureRerankerPromotionLane(input.request, input.executionPlan, input.compositionPlan)) {
        return null;
    }

    const promotionGate = inspectStructureRerankerPromotionGate();
    if (!promotionGate.ready) {
        logger.info("Skipped learned reranker promotion because the narrow-lane promotion gate is not ready", {
            songId: input.songId,
            lane: STRUCTURE_RERANKER_PROMOTION_LANE,
            promotionGateStatus: promotionGate.status,
            promotionGateSignal: promotionGate.signal,
            promotionGateRationale: promotionGate.rationale,
        });
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