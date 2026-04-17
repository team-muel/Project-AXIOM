import fs from "node:fs";
import path from "node:path";
import type {
    AudioLongSpanEvaluationSummary,
    JobManifest,
    LongSpanDivergenceSummary,
    QualityAttemptRecord,
    RevisionDirective,
    SectionEvaluationFinding,
} from "../pipeline/types.js";
import { config } from "../config.js";
import { summarizeLongSpanDivergence } from "../pipeline/longSpan.js";
import {
    STRUCTURE_SHADOW_HIGH_CONFIDENCE,
    summarizeStructureShadowHistory,
    type StructureShadowHistorySummary,
} from "../pipeline/structureShadowHistory.js";
import { detectStructureRerankerPromotionLane } from "../pipeline/structureRerankerPromotion.js";
import {
    structureCandidateIndexPath,
    structureCandidateManifestPath,
    structureCandidateRerankerScorePath,
    type StructureCandidateIndex,
    type StructureCandidateManifest,
    type StructureCandidateRerankerScore,
} from "./candidates.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ManifestWeakestSectionSummary {
    sectionId: string;
    label: string;
    role: string;
    score: number;
    topIssue: string | null;
    registerCenterFit: number | null;
    registerCenterDrift: number | null;
    cadenceApproachFit: number | null;
}

export interface ManifestStructureNarrativeSummary {
    registerPlanFit: number | null;
    cadenceApproachPlanFit: number | null;
}

export interface ManifestOrchestrationSummary {
    family: string;
    instrumentNames: string[];
    sectionCount: number;
    conversationalSectionCount: number;
    idiomaticRangeFit: number | null;
    registerBalanceFit: number | null;
    ensembleConversationFit: number | null;
    doublingPressureFit: number | null;
    textureRotationFit: number | null;
    sectionHandoffFit: number | null;
    weakSectionIds: string[];
}

export interface ManifestAudioWeakestSectionSummary {
    sectionId: string;
    label: string;
    role: string;
    score: number;
    sourceSectionId: string | null;
    plannedTonality: string | null;
    topIssue: string | null;
}

export interface LatestAudioRetrySummary {
    attempt: number;
    evaluatedAt: string;
    directiveKinds: string[];
    combinationKey: string;
    reason: string | null;
    immediateSuccess: boolean;
    eventualSuccess: boolean;
}

export interface ManifestRenderedSectionKeySummary {
    sectionId: string;
    role: string;
    plannedTonality: string | null;
    renderedKeyLabel: string | null;
    renderedKeyConfidence: number | null;
    driftPathLabels: string[];
}

export interface ManifestTrackingSummary {
    songId: string;
    state: string;
    updatedAt: string;
    workflow: string | null;
    structureScore: number | null;
    audioScore: number | null;
    longSpanDivergence: LongSpanDivergenceSummary | null;
    weakestSections: ManifestWeakestSectionSummary[];
    audioWeakestSections: ManifestAudioWeakestSectionSummary[];
    structureNarrative: ManifestStructureNarrativeSummary;
    orchestration: ManifestOrchestrationSummary | null;
    audioNarrative: {
        developmentFit: number | null;
        recapFit: number | null;
        renderConsistency: number | null;
        tonalReturnFit: number | null;
        harmonicRouteFit: number | null;
        chromaTonalReturnFit: number | null;
        chromaHarmonicRouteFit: number | null;
        developmentKeyDriftFit: number | null;
        longSpan: AudioLongSpanEvaluationSummary | null;
    };
    latestAudioRetryReason: string | null;
    latestAudioRetry: LatestAudioRetrySummary | null;
    sectionTransforms: JobManifest["sectionTransforms"];
    sectionTonalities: JobManifest["sectionTonalities"];
    renderedKeyTracking: {
        source: string | null;
        sections: ManifestRenderedSectionKeySummary[];
    };
}

export interface AudioRetryCombinationStats {
    directiveKinds: string[];
    combinationKey: string;
    totalCount: number;
    immediateSuccessCount: number;
    eventualSuccessCount: number;
    failureCount: number;
    immediateSuccessRate: number;
    eventualSuccessRate: number;
    lastSeenAt: string | null;
    lastSongId: string | null;
    lastSuccessfulSongId: string | null;
    lastReason: string | null;
}

export interface AudioRetryStatsSummary {
    totalRetryEvents: number;
    immediateSuccesses: number;
    eventualSuccesses: number;
    immediateSuccessRate: number;
    eventualSuccessRate: number;
    combinationCount: number;
    topCombinations: AudioRetryCombinationStats[];
}

export interface AudioRetryDailySeriesPoint {
    day: string;
    totalRetryEvents: number;
    immediateSuccessRate: number;
    eventualSuccessRate: number;
    combinationCount: number;
    topCombinationKey: string | null;
    topCombinationImmediateSuccessRate: number | null;
    topCombinationEventualSuccessRate: number | null;
}

export interface AudioRetryWindowSummary {
    windowDays: number;
    from: string;
    to: string;
    manifestCount: number;
    stats: AudioRetryStatsSummary;
    dailySeries: AudioRetryDailySeriesPoint[];
}

export interface AudioRetryBreakdownRow {
    value: string;
    totalRetryEvents: number;
    manifestCount: number;
    immediateSuccessRate: number;
    eventualSuccessRate: number;
    combinationCount: number;
    topCombinationKey: string | null;
    topCombinationImmediateSuccessRate: number | null;
    topCombinationEventualSuccessRate: number | null;
    topCombinationSupport: number | null;
}

export interface AudioRetryBreakdownSummary {
    byForm: AudioRetryBreakdownRow[];
    byWorkflow: AudioRetryBreakdownRow[];
    byPlannerVersion: AudioRetryBreakdownRow[];
    bySettingProfile: AudioRetryBreakdownRow[];
    byAudioWeakestRole: AudioRetryBreakdownRow[];
}

export interface ManifestSectionPatternSummaryRow {
    form: string;
    role: string;
    value: string;
    count: number;
    manifestCount: number;
    averageScore: number | null;
    lastSeenAt: string | null;
    lastSongId: string | null;
}

export interface ManifestSectionPatternSummary {
    sampledManifestCount: number;
    sampledSectionCount: number;
    bassMotionProfiles: ManifestSectionPatternSummaryRow[];
    sectionStyles: ManifestSectionPatternSummaryRow[];
}

export interface ManifestOrchestrationTrendRow {
    family: string;
    instrumentNames: string[];
    manifestCount: number;
    averageSectionCount: number | null;
    averageConversationalSectionCount: number | null;
    averageIdiomaticRangeFit: number | null;
    averageRegisterBalanceFit: number | null;
    averageEnsembleConversationFit: number | null;
    averageDoublingPressureFit: number | null;
    averageTextureRotationFit: number | null;
    averageSectionHandoffFit: number | null;
    averageWeakSectionCount: number | null;
    weakManifestCount: number;
    lastSeenAt: string | null;
    lastSongId: string | null;
}

export interface ManifestOrchestrationTrendSummary {
    sampledManifestCount: number;
    familyRows: ManifestOrchestrationTrendRow[];
}

export interface ManifestPhraseBreathTrendSummary {
    manifestCount: number;
    weakManifestCount: number;
    averagePlanFit: number | null;
    averageCoverageFit: number | null;
    averagePickupFit: number | null;
    averageArrivalFit: number | null;
    averageReleaseFit: number | null;
    averageRecoveryFit: number | null;
    averageRubatoFit: number | null;
    lastSeenAt: string | null;
    lastSongId: string | null;
}

export interface ManifestHarmonicColorTrendSummary {
    manifestCount: number;
    weakManifestCount: number;
    averagePlanFit: number | null;
    averageCoverageFit: number | null;
    averageTargetFit: number | null;
    averageTimingFit: number | null;
    averageTonicizationPressureFit: number | null;
    averageProlongationMotionFit: number | null;
    lastSeenAt: string | null;
    lastSongId: string | null;
}

export interface ManifestShadowRerankerDisagreementRow {
    songId: string;
    updatedAt: string;
    snapshotId: string | null;
    lane: string | null;
    selectedCandidateId: string | null;
    selectedWorker: string | null;
    learnedTopCandidateId: string | null;
    learnedTopWorker: string | null;
    learnedConfidence: number | null;
    reason: string | null;
}

export interface ManifestShadowRerankerPromotionRow {
    songId: string;
    updatedAt: string;
    snapshotId: string | null;
    lane: string | null;
    selectedCandidateId: string | null;
    selectedWorker: string | null;
    heuristicCounterfactualCandidateId: string | null;
    heuristicCounterfactualWorker: string | null;
    learnedConfidence: number | null;
    reason: string | null;
}

export interface ManifestShadowRerankerPromotionOutcomeSummary {
    lane: string | null;
    scoredManifestCount: number;
    reviewedManifestCount: number;
    pendingReviewCount: number;
    promotedSelectionCount: number;
    promotedReviewedCount: number;
    promotedApprovedCount: number;
    promotedRejectedCount: number;
    promotedApprovalRate: number | null;
    promotedAverageAppealScore: number | null;
    heuristicReviewedCount: number;
    heuristicApprovedCount: number;
    heuristicRejectedCount: number;
    heuristicApprovalRate: number | null;
    heuristicAverageAppealScore: number | null;
}

export interface ManifestShadowRerankerPromotionAdvantageSummary {
    lane: string | null;
    reviewedManifestCount: number;
    promotedReviewedCount: number;
    heuristicReviewedCount: number;
    sufficientReviewSample: boolean;
    minimumReviewedManifestCount: number;
    minimumReviewedPerCohortCount: number;
    approvalRateDelta: number | null;
    appealScoreDelta: number | null;
    signal: "promoted_advantage" | "heuristic_advantage" | "parity" | "mixed" | "insufficient_data";
}

export interface ManifestShadowRerankerRetryLocalizationSummary {
    lane: string | null;
    scoredManifestCount: number;
    retryingManifestCount: number;
    promotedRetryingCount: number;
    promotedTargetedOnlyCount: number;
    promotedMixedCount: number;
    promotedGlobalOnlyCount: number;
    promotedSectionTargetedRate: number | null;
    heuristicRetryingCount: number;
    heuristicTargetedOnlyCount: number;
    heuristicMixedCount: number;
    heuristicGlobalOnlyCount: number;
    heuristicSectionTargetedRate: number | null;
}

export interface ManifestShadowRerankerSummary {
    manifestCount: number;
    scoredManifestCount: number;
    disagreementCount: number;
    highConfidenceDisagreementCount: number;
    promotedSelectionCount: number;
    agreementRate: number | null;
    averageLearnedConfidence: number | null;
    latestSnapshotId: string | null;
    lastSeenAt: string | null;
    lastSongId: string | null;
    recentDisagreements: ManifestShadowRerankerDisagreementRow[];
    recentPromotions: ManifestShadowRerankerPromotionRow[];
    promotionOutcomes: ManifestShadowRerankerPromotionOutcomeSummary | null;
    promotionAdvantage: ManifestShadowRerankerPromotionAdvantageSummary | null;
    retryLocalizationOutcomes: ManifestShadowRerankerRetryLocalizationSummary | null;
    runtimeWindow: StructureShadowHistorySummary;
}

export interface ManifestOperationalSummaryOptions {
    shadowHistoryWindowHours?: number;
    shadowHistoryLimit?: number;
}

export interface ManifestOperationalSummary {
    audioRetryStats: AudioRetryStatsSummary;
    audioRetryWindows: {
        last7Days: AudioRetryWindowSummary;
        last30Days: AudioRetryWindowSummary;
    };
    audioRetryBreakdowns: AudioRetryBreakdownSummary;
    successfulSectionPatterns: ManifestSectionPatternSummary;
    phraseBreathTrends: ManifestPhraseBreathTrendSummary;
    harmonicColorTrends: ManifestHarmonicColorTrendSummary;
    shadowReranker: ManifestShadowRerankerSummary;
    orchestrationTrends: ManifestOrchestrationTrendSummary;
    recentManifestTracking: ManifestTrackingSummary[];
}

interface AudioRetryEvent {
    songId: string;
    evaluatedAt: string;
    timestampMs: number;
    directiveKinds: string[];
    combinationKey: string;
    reason: string | null;
    immediateSuccess: boolean;
    eventualSuccess: boolean;
    form: string;
    workflow: string;
    plannerVersion: string;
    weakestAudioRoles: string[];
}

interface SectionPatternBucket {
    form: string;
    role: string;
    value: string;
    count: number;
    manifestIds: Set<string>;
    totalScore: number;
    scoreCount: number;
    lastSeenAt: string | null;
    lastSongId: string | null;
}

interface OrchestrationTrendBucket {
    family: string;
    instrumentNames: Set<string>;
    manifestIds: Set<string>;
    totalSectionCount: number;
    totalConversationalSectionCount: number;
    totalIdiomaticRangeFit: number;
    idiomaticRangeCount: number;
    totalRegisterBalanceFit: number;
    registerBalanceCount: number;
    totalEnsembleConversationFit: number;
    ensembleConversationCount: number;
    totalDoublingPressureFit: number;
    doublingPressureCount: number;
    totalTextureRotationFit: number;
    textureRotationCount: number;
    totalSectionHandoffFit: number;
    sectionHandoffCount: number;
    totalWeakSectionCount: number;
    weakManifestCount: number;
    lastSeenAt: string | null;
    lastSongId: string | null;
}

interface SelectedShadowRerankerEvidence {
    songId: string;
    updatedAt: string;
    evaluatedAt: string | null;
    snapshotId: string | null;
    lane: string | null;
    selectedCandidateId: string | null;
    selectedWorker: string | null;
    learnedTopCandidateId: string | null;
    learnedTopWorker: string | null;
    learnedConfidence: number | null;
    disagreesWithHeuristic: boolean;
    reason: string | null;
    promotionLane: string | null;
    promotionAppliedAt: string | null;
    promotionHeuristicCounterfactualCandidateId: string | null;
    promotionHeuristicCounterfactualWorker: string | null;
    eligiblePromotionLane: string | null;
    promotionApplied: boolean;
    approvalStatus: string | null;
    appealScore: number | null;
    latestStructureRetryAttempt: number | null;
    latestStructureRetryTargetedDirectiveCount: number;
    latestStructureRetryUntargetedDirectiveCount: number;
}

const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED = 4;
const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT = 2;

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function toFixedRate(numerator: number, denominator: number): number {
    return Number((denominator > 0 ? numerator / denominator : 0).toFixed(4));
}

function toTimestampMs(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function startOfUtcDay(timestampMs: number): number {
    const date = new Date(timestampMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function toDayKey(timestampMs: number): string {
    return new Date(timestampMs).toISOString().slice(0, 10);
}

function readJsonIfExists<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    } catch {
        return null;
    }
}

function resolveSelectedStructureCandidateEntry(index: StructureCandidateIndex) {
    return index.entries.find((entry) => entry.candidateId === index.selectedCandidateId)
        ?? index.entries.find((entry) => entry.selected)
        ?? index.entries.find((entry) => Boolean(entry.shadowReranker || entry.rerankerScorePath))
        ?? null;
}

function resolveStructureCandidateEntryById(index: StructureCandidateIndex, candidateId: string | null | undefined) {
    const normalized = compact(candidateId);
    return normalized
        ? index.entries.find((entry) => entry.candidateId === normalized) ?? null
        : null;
}

function roundMetric(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value)
        ? Number(value.toFixed(4))
        : null;
}

function loadSelectedShadowRerankerEvidence(manifest: JobManifest): SelectedShadowRerankerEvidence | null {
    const index = readJsonIfExists<StructureCandidateIndex>(structureCandidateIndexPath(manifest.songId));
    if (!index) {
        return null;
    }

    const selectedEntry = resolveSelectedStructureCandidateEntry(index);
    if (!selectedEntry) {
        return null;
    }

    const selectedCandidateId = selectedEntry.candidateId;
    const candidateManifest = readJsonIfExists<StructureCandidateManifest>(
        selectedEntry.manifestPath || structureCandidateManifestPath(manifest.songId, selectedCandidateId),
    );
    const score = readJsonIfExists<StructureCandidateRerankerScore>(
        selectedEntry.rerankerScorePath || structureCandidateRerankerScorePath(manifest.songId, selectedCandidateId),
    );
    const shadowSummary = candidateManifest?.shadowReranker ?? selectedEntry.shadowReranker ?? null;
    const promotion = candidateManifest?.rerankerPromotion ?? index.rerankerPromotion ?? null;
    const detectedPromotionLane = candidateManifest
        ? detectStructureRerankerPromotionLane(
            candidateManifest.executionPlan,
            candidateManifest.compositionPlan,
            candidateManifest.compositionPlan?.instrumentation,
        )
        : null;
    const learnedTopCandidateId = compact(score?.disagreement.learnedTopCandidateId)
        || (shadowSummary?.disagreesWithHeuristic ? null : selectedCandidateId)
        || null;
    const learnedTopEntry = resolveStructureCandidateEntryById(index, learnedTopCandidateId);
    const promotionHeuristicCounterfactualCandidateId = compact(promotion?.heuristicTopCandidateId) || null;
    const promotionHeuristicCounterfactualEntry = resolveStructureCandidateEntryById(index, promotionHeuristicCounterfactualCandidateId);
    const selectedWorker = compact(selectedEntry.worker)
        || compact(candidateManifest?.worker)
        || compact(candidateManifest?.executionPlan?.composeWorker)
        || null;
    const learnedTopWorker = learnedTopEntry
        ? compact(learnedTopEntry.worker)
        || (learnedTopEntry.candidateId === selectedCandidateId ? selectedWorker : null)
        : (learnedTopCandidateId === selectedCandidateId ? selectedWorker : null);
    const lane = compact(candidateManifest?.proposalEvidence?.lane)
        || compact(selectedEntry.proposalEvidence?.lane)
        || compact(learnedTopEntry?.proposalEvidence?.lane)
        || compact(promotion?.lane)
        || detectedPromotionLane;
    const reason = compact(index.selectionStopReason)
        || compact(promotion?.reason)
        || compact(score?.disagreement.reason)
        || compact(shadowSummary?.disagreementReason)
        || null;
    const selectedAttempt = typeof manifest.qualityControl?.selectedAttempt === "number"
        && Number.isFinite(manifest.qualityControl.selectedAttempt)
        ? manifest.qualityControl.selectedAttempt
        : null;
    const latestStructureRetry = [...listStructureAttempts(manifest)]
        .reverse()
        .find((attempt) => (attempt.directives?.length ?? 0) > 0 && (selectedAttempt === null || attempt.attempt < selectedAttempt));
    const latestStructureRetryDirectiveCounts = countTargetedRetryDirectives(latestStructureRetry?.directives);

    if (!score && !shadowSummary && !promotion) {
        return null;
    }

    return {
        songId: manifest.songId,
        updatedAt: manifest.updatedAt,
        evaluatedAt: score?.evaluatedAt ?? shadowSummary?.evaluatedAt ?? null,
        snapshotId: score?.scorer.snapshotId ?? shadowSummary?.snapshotId ?? null,
        lane,
        selectedCandidateId,
        selectedWorker,
        learnedTopCandidateId,
        learnedTopWorker,
        learnedConfidence: score?.learned.confidence ?? shadowSummary?.learnedConfidence ?? null,
        disagreesWithHeuristic: score?.disagreement.disagrees ?? shadowSummary?.disagreesWithHeuristic ?? false,
        reason,
        promotionLane: compact(promotion?.lane) || null,
        promotionAppliedAt: compact(promotion?.appliedAt) || null,
        promotionHeuristicCounterfactualCandidateId,
        promotionHeuristicCounterfactualWorker: compact(promotionHeuristicCounterfactualEntry?.worker) || null,
        eligiblePromotionLane: compact(promotion?.lane) || detectedPromotionLane,
        promotionApplied: Boolean(promotion),
        approvalStatus: compact(manifest.approvalStatus) || null,
        appealScore: typeof manifest.reviewFeedback?.appealScore === "number" && Number.isFinite(manifest.reviewFeedback.appealScore)
            ? manifest.reviewFeedback.appealScore
            : null,
        latestStructureRetryAttempt: latestStructureRetry?.attempt ?? null,
        latestStructureRetryTargetedDirectiveCount: latestStructureRetryDirectiveCounts.targeted,
        latestStructureRetryUntargetedDirectiveCount: latestStructureRetryDirectiveCounts.untargeted,
    };
}

function averageOptionalNumbers(values: Array<number | null>): number | null {
    const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return numeric.length > 0
        ? averageNumbers(numeric.reduce((sum, value) => sum + value, 0), numeric.length)
        : null;
}

function listStructureAttempts(manifest: JobManifest): QualityAttemptRecord[] {
    return (manifest.qualityControl?.attempts ?? [])
        .filter((attempt) => attempt.stage !== "audio")
        .sort((left, right) => left.attempt - right.attempt || left.evaluatedAt.localeCompare(right.evaluatedAt));
}

function countTargetedRetryDirectives(directives: RevisionDirective[] | undefined): {
    targeted: number;
    untargeted: number;
} {
    const all = directives ?? [];
    return {
        targeted: all.filter((directive) => (directive.sectionIds?.length ?? 0) > 0).length,
        untargeted: all.filter((directive) => (directive.sectionIds?.length ?? 0) === 0).length,
    };
}

function summarizeShadowRerankerPromotionOutcomes(
    evidences: SelectedShadowRerankerEvidence[],
): ManifestShadowRerankerPromotionOutcomeSummary | null {
    const eligible = evidences.filter((entry) => Boolean(entry.eligiblePromotionLane));
    if (eligible.length === 0) {
        return null;
    }

    const laneCounts = new Map<string, number>();
    for (const entry of eligible) {
        const lane = compact(entry.eligiblePromotionLane);
        laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);
    }

    const lane = [...laneCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
    const laneEntries = eligible.filter((entry) => compact(entry.eligiblePromotionLane) === lane);
    const reviewed = laneEntries.filter((entry) => ["approved", "rejected"].includes(compact(entry.approvalStatus)));
    const promoted = laneEntries.filter((entry) => entry.promotionApplied);
    const promotedReviewed = reviewed.filter((entry) => entry.promotionApplied);
    const heuristicReviewed = reviewed.filter((entry) => !entry.promotionApplied);
    const promotedApprovedCount = promotedReviewed.filter((entry) => compact(entry.approvalStatus) === "approved").length;
    const promotedRejectedCount = promotedReviewed.filter((entry) => compact(entry.approvalStatus) === "rejected").length;
    const heuristicApprovedCount = heuristicReviewed.filter((entry) => compact(entry.approvalStatus) === "approved").length;
    const heuristicRejectedCount = heuristicReviewed.filter((entry) => compact(entry.approvalStatus) === "rejected").length;

    return {
        lane,
        scoredManifestCount: laneEntries.length,
        reviewedManifestCount: reviewed.length,
        pendingReviewCount: laneEntries.length - reviewed.length,
        promotedSelectionCount: promoted.length,
        promotedReviewedCount: promotedReviewed.length,
        promotedApprovedCount,
        promotedRejectedCount,
        promotedApprovalRate: promotedReviewed.length > 0
            ? Number((promotedApprovedCount / promotedReviewed.length).toFixed(4))
            : null,
        promotedAverageAppealScore: averageOptionalNumbers(promotedReviewed.map((entry) => entry.appealScore)),
        heuristicReviewedCount: heuristicReviewed.length,
        heuristicApprovedCount,
        heuristicRejectedCount,
        heuristicApprovalRate: heuristicReviewed.length > 0
            ? Number((heuristicApprovedCount / heuristicReviewed.length).toFixed(4))
            : null,
        heuristicAverageAppealScore: averageOptionalNumbers(heuristicReviewed.map((entry) => entry.appealScore)),
    };
}

function summarizeShadowRerankerPromotionAdvantage(
    outcomes: ManifestShadowRerankerPromotionOutcomeSummary | null,
): ManifestShadowRerankerPromotionAdvantageSummary | null {
    if (!outcomes) {
        return null;
    }

    const approvalRateDelta = outcomes.promotedApprovalRate !== null && outcomes.heuristicApprovalRate !== null
        ? Number((outcomes.promotedApprovalRate - outcomes.heuristicApprovalRate).toFixed(4))
        : null;
    const appealScoreDelta = outcomes.promotedAverageAppealScore !== null && outcomes.heuristicAverageAppealScore !== null
        ? Number((outcomes.promotedAverageAppealScore - outcomes.heuristicAverageAppealScore).toFixed(4))
        : null;
    const availableDeltas = [approvalRateDelta, appealScoreDelta]
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const positive = availableDeltas.some((value) => value > 0.0001);
    const negative = availableDeltas.some((value) => value < -0.0001);
    const sufficientReviewSample = outcomes.reviewedManifestCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED
        && outcomes.promotedReviewedCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT
        && outcomes.heuristicReviewedCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT;
    const signal = !sufficientReviewSample || availableDeltas.length === 0
        ? "insufficient_data"
        : positive && negative
            ? "mixed"
            : positive
                ? "promoted_advantage"
                : negative
                    ? "heuristic_advantage"
                    : "parity";

    return {
        lane: outcomes.lane,
        reviewedManifestCount: outcomes.reviewedManifestCount,
        promotedReviewedCount: outcomes.promotedReviewedCount,
        heuristicReviewedCount: outcomes.heuristicReviewedCount,
        sufficientReviewSample,
        minimumReviewedManifestCount: SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED,
        minimumReviewedPerCohortCount: SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT,
        approvalRateDelta,
        appealScoreDelta,
        signal,
    };
}

function summarizeShadowRerankerRetryLocalizationOutcomes(
    evidences: SelectedShadowRerankerEvidence[],
): ManifestShadowRerankerRetryLocalizationSummary | null {
    const eligible = evidences.filter((entry) => Boolean(entry.eligiblePromotionLane));
    if (eligible.length === 0) {
        return null;
    }

    const laneCounts = new Map<string, number>();
    for (const entry of eligible) {
        const lane = compact(entry.eligiblePromotionLane);
        laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);
    }

    const lane = [...laneCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
    const laneEntries = eligible.filter((entry) => compact(entry.eligiblePromotionLane) === lane);
    const retrying = laneEntries.filter(
        (entry) => entry.latestStructureRetryAttempt !== null
            && (entry.latestStructureRetryTargetedDirectiveCount + entry.latestStructureRetryUntargetedDirectiveCount) > 0,
    );

    const classifyEntries = (entries: SelectedShadowRerankerEvidence[]) => {
        let targetedOnlyCount = 0;
        let mixedCount = 0;
        let globalOnlyCount = 0;

        for (const entry of entries) {
            const targeted = entry.latestStructureRetryTargetedDirectiveCount;
            const untargeted = entry.latestStructureRetryUntargetedDirectiveCount;
            if (targeted > 0 && untargeted === 0) {
                targetedOnlyCount += 1;
            } else if (targeted > 0) {
                mixedCount += 1;
            } else if (untargeted > 0) {
                globalOnlyCount += 1;
            }
        }

        return {
            retryingCount: entries.length,
            targetedOnlyCount,
            mixedCount,
            globalOnlyCount,
            sectionTargetedRate: entries.length > 0
                ? Number(((targetedOnlyCount + mixedCount) / entries.length).toFixed(4))
                : null,
        };
    };

    const promoted = classifyEntries(retrying.filter((entry) => entry.promotionApplied));
    const heuristic = classifyEntries(retrying.filter((entry) => !entry.promotionApplied));

    return {
        lane,
        scoredManifestCount: laneEntries.length,
        retryingManifestCount: retrying.length,
        promotedRetryingCount: promoted.retryingCount,
        promotedTargetedOnlyCount: promoted.targetedOnlyCount,
        promotedMixedCount: promoted.mixedCount,
        promotedGlobalOnlyCount: promoted.globalOnlyCount,
        promotedSectionTargetedRate: promoted.sectionTargetedRate,
        heuristicRetryingCount: heuristic.retryingCount,
        heuristicTargetedOnlyCount: heuristic.targetedOnlyCount,
        heuristicMixedCount: heuristic.mixedCount,
        heuristicGlobalOnlyCount: heuristic.globalOnlyCount,
        heuristicSectionTargetedRate: heuristic.sectionTargetedRate,
    };
}

function listAudioAttempts(manifest: JobManifest): QualityAttemptRecord[] {
    return (manifest.qualityControl?.attempts ?? [])
        .filter((attempt) => attempt.stage === "audio")
        .sort((left, right) => left.attempt - right.attempt || left.evaluatedAt.localeCompare(right.evaluatedAt));
}

function buildDirectiveCombo(directives: RevisionDirective[]): { combinationKey: string; directiveKinds: string[] } {
    const directiveKinds = Array.from(new Set(directives.map((directive) => directive.kind))).sort();
    return {
        combinationKey: directiveKinds.join(" + "),
        directiveKinds,
    };
}

function buildRetryReason(directives: RevisionDirective[]): string | null {
    const reasons = directives
        .map((directive) => compact(directive.reason) || compact(directive.sourceIssue))
        .filter(Boolean);

    if (reasons.length === 0) {
        return null;
    }

    return Array.from(new Set(reasons)).join(" | ");
}

function metaSliceValue(value: string | undefined): string {
    const normalized = compact(value);
    return normalized || "unspecified";
}

function averageNumbers(total: number, count: number): number | null {
    return count > 0 ? Number((total / count).toFixed(4)) : null;
}

function normalizedSectionFindingScore(score: unknown): number | null {
    if (typeof score !== "number" || !Number.isFinite(score)) {
        return null;
    }

    return Number((score > 1 ? score / 100 : score).toFixed(4));
}

function shouldIncludeSectionPattern(finding: Pick<SectionEvaluationFinding, "score" | "issues"> | undefined): boolean {
    const normalizedScore = normalizedSectionFindingScore(finding?.score);
    if (typeof normalizedScore === "number" && normalizedScore < 0.74) {
        return false;
    }

    return (finding?.issues?.length ?? 0) < 3;
}

function isSuccessfulSectionPatternSource(manifest: JobManifest): boolean {
    if (manifest.state !== "DONE") {
        return false;
    }

    if (manifest.approvalStatus === "approved") {
        return true;
    }

    if (manifest.structureEvaluation?.passed) {
        return true;
    }

    if ((manifest.structureEvaluation?.score ?? 0) >= 76) {
        return true;
    }

    return (manifest.selfAssessment?.qualityScore ?? 0) >= 7;
}

function listStructureSectionFindings(manifest: JobManifest): SectionEvaluationFinding[] {
    const sectionFindings = manifest.structureEvaluation?.sectionFindings ?? [];
    if (sectionFindings.length > 0) {
        return sectionFindings;
    }

    return manifest.structureEvaluation?.weakestSections ?? [];
}

function recordSectionPattern(
    buckets: Map<string, SectionPatternBucket>,
    form: string,
    role: string,
    value: string,
    score: number | null,
    manifest: JobManifest,
): void {
    const patternKey = [form, role, value].join("|");
    const current = buckets.get(patternKey) ?? {
        form,
        role,
        value,
        count: 0,
        manifestIds: new Set<string>(),
        totalScore: 0,
        scoreCount: 0,
        lastSeenAt: null,
        lastSongId: null,
    };

    current.count += 1;
    current.manifestIds.add(manifest.songId);

    if (typeof score === "number") {
        current.totalScore += score;
        current.scoreCount += 1;
    }

    const existingTimestampMs = toTimestampMs(current.lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY;
    const manifestTimestampMs = toTimestampMs(manifest.updatedAt) ?? Number.NEGATIVE_INFINITY;
    if (manifestTimestampMs >= existingTimestampMs) {
        current.lastSeenAt = manifest.updatedAt;
        current.lastSongId = manifest.songId;
    }

    buckets.set(patternKey, current);
}

function toSectionPatternRows(
    buckets: Map<string, SectionPatternBucket>,
    topLimit: number,
): ManifestSectionPatternSummaryRow[] {
    return Array.from(buckets.values())
        .map((bucket) => ({
            form: bucket.form,
            role: bucket.role,
            value: bucket.value,
            count: bucket.count,
            manifestCount: bucket.manifestIds.size,
            averageScore: bucket.scoreCount > 0 ? Number((bucket.totalScore / bucket.scoreCount).toFixed(4)) : null,
            lastSeenAt: bucket.lastSeenAt,
            lastSongId: bucket.lastSongId,
        }))
        .sort((left, right) => (
            right.count - left.count
            || right.manifestCount - left.manifestCount
            || ((right.averageScore ?? -1) - (left.averageScore ?? -1))
            || ((toTimestampMs(right.lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY)
                - (toTimestampMs(left.lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY))
            || left.form.localeCompare(right.form)
            || left.role.localeCompare(right.role)
            || left.value.localeCompare(right.value)
        ))
        .slice(0, topLimit);
}

function summarizeSuccessfulSectionPatterns(
    manifests: JobManifest[],
    topLimit = 8,
): ManifestSectionPatternSummary {
    const bassMotionBuckets = new Map<string, SectionPatternBucket>();
    const sectionStyleBuckets = new Map<string, SectionPatternBucket>();
    const sampledManifestIds = new Set<string>();
    const sampledSectionKeys = new Set<string>();

    for (const manifest of manifests) {
        if (!isSuccessfulSectionPatternSource(manifest) || !manifest.sectionArtifacts?.length) {
            continue;
        }

        const sectionFindingById = new Map(listStructureSectionFindings(manifest).map((finding) => [finding.sectionId, finding]));

        for (const artifact of manifest.sectionArtifacts) {
            const sectionFinding = sectionFindingById.get(artifact.sectionId);
            if (!shouldIncludeSectionPattern(sectionFinding)) {
                continue;
            }

            const form = metaSliceValue(manifest.meta.form);
            const role = metaSliceValue(artifact.role);
            const sectionScore = normalizedSectionFindingScore(sectionFinding?.score);
            let recorded = false;

            if (artifact.bassMotionProfile) {
                recordSectionPattern(bassMotionBuckets, form, role, artifact.bassMotionProfile, sectionScore, manifest);
                recorded = true;
            }

            const sectionStyle = compact(artifact.sectionStyle);
            if (sectionStyle) {
                recordSectionPattern(sectionStyleBuckets, form, role, sectionStyle, sectionScore, manifest);
                recorded = true;
            }

            if (recorded) {
                sampledManifestIds.add(manifest.songId);
                sampledSectionKeys.add(`${manifest.songId}:${artifact.sectionId}`);
            }
        }
    }

    return {
        sampledManifestCount: sampledManifestIds.size,
        sampledSectionCount: sampledSectionKeys.size,
        bassMotionProfiles: toSectionPatternRows(bassMotionBuckets, topLimit),
        sectionStyles: toSectionPatternRows(sectionStyleBuckets, topLimit),
    };
}

function summarizeOrchestrationTrends(
    manifests: JobManifest[],
    topLimit = 6,
): ManifestOrchestrationTrendSummary {
    const buckets = new Map<string, OrchestrationTrendBucket>();
    const sampledManifestIds = new Set<string>();

    for (const manifest of manifests) {
        if (!isSuccessfulSectionPatternSource(manifest)) {
            continue;
        }

        const orchestration = summarizeOrchestration(manifest);
        if (!orchestration) {
            continue;
        }

        sampledManifestIds.add(manifest.songId);
        const bucket = buckets.get(orchestration.family) ?? {
            family: orchestration.family,
            instrumentNames: new Set<string>(),
            manifestIds: new Set<string>(),
            totalSectionCount: 0,
            totalConversationalSectionCount: 0,
            totalIdiomaticRangeFit: 0,
            idiomaticRangeCount: 0,
            totalRegisterBalanceFit: 0,
            registerBalanceCount: 0,
            totalEnsembleConversationFit: 0,
            ensembleConversationCount: 0,
            totalDoublingPressureFit: 0,
            doublingPressureCount: 0,
            totalTextureRotationFit: 0,
            textureRotationCount: 0,
            totalSectionHandoffFit: 0,
            sectionHandoffCount: 0,
            totalWeakSectionCount: 0,
            weakManifestCount: 0,
            lastSeenAt: null,
            lastSongId: null,
        };

        bucket.manifestIds.add(manifest.songId);
        orchestration.instrumentNames.forEach((name) => bucket.instrumentNames.add(name));
        bucket.totalSectionCount += orchestration.sectionCount;
        bucket.totalConversationalSectionCount += orchestration.conversationalSectionCount;
        bucket.totalWeakSectionCount += orchestration.weakSectionIds.length;
        if (orchestration.weakSectionIds.length > 0) {
            bucket.weakManifestCount += 1;
        }

        if (typeof orchestration.idiomaticRangeFit === "number") {
            bucket.totalIdiomaticRangeFit += orchestration.idiomaticRangeFit;
            bucket.idiomaticRangeCount += 1;
        }
        if (typeof orchestration.registerBalanceFit === "number") {
            bucket.totalRegisterBalanceFit += orchestration.registerBalanceFit;
            bucket.registerBalanceCount += 1;
        }
        if (typeof orchestration.ensembleConversationFit === "number") {
            bucket.totalEnsembleConversationFit += orchestration.ensembleConversationFit;
            bucket.ensembleConversationCount += 1;
        }
        if (typeof orchestration.doublingPressureFit === "number") {
            bucket.totalDoublingPressureFit += orchestration.doublingPressureFit;
            bucket.doublingPressureCount += 1;
        }
        if (typeof orchestration.textureRotationFit === "number") {
            bucket.totalTextureRotationFit += orchestration.textureRotationFit;
            bucket.textureRotationCount += 1;
        }
        if (typeof orchestration.sectionHandoffFit === "number") {
            bucket.totalSectionHandoffFit += orchestration.sectionHandoffFit;
            bucket.sectionHandoffCount += 1;
        }

        const existingTimestampMs = toTimestampMs(bucket.lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY;
        const manifestTimestampMs = toTimestampMs(manifest.updatedAt) ?? Number.NEGATIVE_INFINITY;
        if (manifestTimestampMs >= existingTimestampMs) {
            bucket.lastSeenAt = manifest.updatedAt;
            bucket.lastSongId = manifest.songId;
        }

        buckets.set(orchestration.family, bucket);
    }

    return {
        sampledManifestCount: sampledManifestIds.size,
        familyRows: Array.from(buckets.values())
            .map((bucket) => ({
                family: bucket.family,
                instrumentNames: Array.from(bucket.instrumentNames),
                manifestCount: bucket.manifestIds.size,
                averageSectionCount: averageNumbers(bucket.totalSectionCount, bucket.manifestIds.size),
                averageConversationalSectionCount: averageNumbers(bucket.totalConversationalSectionCount, bucket.manifestIds.size),
                averageIdiomaticRangeFit: averageNumbers(bucket.totalIdiomaticRangeFit, bucket.idiomaticRangeCount),
                averageRegisterBalanceFit: averageNumbers(bucket.totalRegisterBalanceFit, bucket.registerBalanceCount),
                averageEnsembleConversationFit: averageNumbers(bucket.totalEnsembleConversationFit, bucket.ensembleConversationCount),
                averageDoublingPressureFit: averageNumbers(bucket.totalDoublingPressureFit, bucket.doublingPressureCount),
                averageTextureRotationFit: averageNumbers(bucket.totalTextureRotationFit, bucket.textureRotationCount),
                averageSectionHandoffFit: averageNumbers(bucket.totalSectionHandoffFit, bucket.sectionHandoffCount),
                averageWeakSectionCount: averageNumbers(bucket.totalWeakSectionCount, bucket.manifestIds.size),
                weakManifestCount: bucket.weakManifestCount,
                lastSeenAt: bucket.lastSeenAt,
                lastSongId: bucket.lastSongId,
            }))
            .sort((left, right) => (
                right.manifestCount - left.manifestCount
                || ((right.averageRegisterBalanceFit ?? -1) - (left.averageRegisterBalanceFit ?? -1))
                || ((right.averageIdiomaticRangeFit ?? -1) - (left.averageIdiomaticRangeFit ?? -1))
                || left.family.localeCompare(right.family)
            ))
            .slice(0, topLimit),
    };
}

function summarizePhraseBreathTrends(
    manifests: JobManifest[],
): ManifestPhraseBreathTrendSummary {
    let manifestCount = 0;
    let weakManifestCount = 0;
    let totalPlanFit = 0;
    let planFitCount = 0;
    let totalCoverageFit = 0;
    let coverageFitCount = 0;
    let totalPickupFit = 0;
    let pickupFitCount = 0;
    let totalArrivalFit = 0;
    let arrivalFitCount = 0;
    let totalReleaseFit = 0;
    let releaseFitCount = 0;
    let totalRecoveryFit = 0;
    let recoveryFitCount = 0;
    let totalRubatoFit = 0;
    let rubatoFitCount = 0;
    let lastSeenAt: string | null = null;
    let lastSongId: string | null = null;

    for (const manifest of manifests) {
        if (!isSuccessfulSectionPatternSource(manifest)) {
            continue;
        }

        const metrics = manifest.audioEvaluation?.metrics ?? {};
        const planFit = typeof metrics.audioPhraseBreathPlanFit === "number" ? metrics.audioPhraseBreathPlanFit : null;
        const coverageFit = typeof metrics.audioPhraseBreathCoverageFit === "number" ? metrics.audioPhraseBreathCoverageFit : null;
        const pickupFit = typeof metrics.audioPhraseBreathPickupFit === "number" ? metrics.audioPhraseBreathPickupFit : null;
        const arrivalFit = typeof metrics.audioPhraseBreathArrivalFit === "number" ? metrics.audioPhraseBreathArrivalFit : null;
        const releaseFit = typeof metrics.audioPhraseBreathReleaseFit === "number" ? metrics.audioPhraseBreathReleaseFit : null;
        const recoveryFit = typeof metrics.audioPhraseBreathRecoveryFit === "number" ? metrics.audioPhraseBreathRecoveryFit : null;
        const rubatoFit = typeof metrics.audioPhraseBreathRubatoFit === "number" ? metrics.audioPhraseBreathRubatoFit : null;
        const hasPhraseBreathMetrics = [
            planFit,
            coverageFit,
            pickupFit,
            arrivalFit,
            releaseFit,
            recoveryFit,
            rubatoFit,
        ].some((value) => typeof value === "number");

        if (!hasPhraseBreathMetrics) {
            continue;
        }

        manifestCount += 1;

        if (typeof planFit === "number") {
            totalPlanFit += planFit;
            planFitCount += 1;
        }
        if (typeof coverageFit === "number") {
            totalCoverageFit += coverageFit;
            coverageFitCount += 1;
        }
        if (typeof pickupFit === "number") {
            totalPickupFit += pickupFit;
            pickupFitCount += 1;
        }
        if (typeof arrivalFit === "number") {
            totalArrivalFit += arrivalFit;
            arrivalFitCount += 1;
        }
        if (typeof releaseFit === "number") {
            totalReleaseFit += releaseFit;
            releaseFitCount += 1;
        }
        if (typeof recoveryFit === "number") {
            totalRecoveryFit += recoveryFit;
            recoveryFitCount += 1;
        }
        if (typeof rubatoFit === "number") {
            totalRubatoFit += rubatoFit;
            rubatoFitCount += 1;
        }

        if (
            (typeof planFit === "number" && planFit < 0.62)
            || (typeof coverageFit === "number" && coverageFit < 0.55)
            || (typeof arrivalFit === "number" && arrivalFit < 0.52)
            || (typeof releaseFit === "number" && releaseFit < 0.52)
        ) {
            weakManifestCount += 1;
        }

        const existingTimestampMs = toTimestampMs(lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY;
        const manifestTimestampMs = toTimestampMs(manifest.updatedAt) ?? Number.NEGATIVE_INFINITY;
        if (manifestTimestampMs >= existingTimestampMs) {
            lastSeenAt = manifest.updatedAt;
            lastSongId = manifest.songId;
        }
    }

    return {
        manifestCount,
        weakManifestCount,
        averagePlanFit: averageNumbers(totalPlanFit, planFitCount),
        averageCoverageFit: averageNumbers(totalCoverageFit, coverageFitCount),
        averagePickupFit: averageNumbers(totalPickupFit, pickupFitCount),
        averageArrivalFit: averageNumbers(totalArrivalFit, arrivalFitCount),
        averageReleaseFit: averageNumbers(totalReleaseFit, releaseFitCount),
        averageRecoveryFit: averageNumbers(totalRecoveryFit, recoveryFitCount),
        averageRubatoFit: averageNumbers(totalRubatoFit, rubatoFitCount),
        lastSeenAt,
        lastSongId,
    };
}

function summarizeHarmonicColorTrends(
    manifests: JobManifest[],
): ManifestHarmonicColorTrendSummary {
    let manifestCount = 0;
    let weakManifestCount = 0;
    let totalPlanFit = 0;
    let planFitCount = 0;
    let totalCoverageFit = 0;
    let coverageFitCount = 0;
    let totalTargetFit = 0;
    let targetFitCount = 0;
    let totalTimingFit = 0;
    let timingFitCount = 0;
    let totalTonicizationPressureFit = 0;
    let tonicizationPressureFitCount = 0;
    let totalProlongationMotionFit = 0;
    let prolongationMotionFitCount = 0;
    let lastSeenAt: string | null = null;
    let lastSongId: string | null = null;

    for (const manifest of manifests) {
        if (!isSuccessfulSectionPatternSource(manifest)) {
            continue;
        }

        const metrics = manifest.audioEvaluation?.metrics ?? {};
        const planFit = typeof metrics.harmonicColorPlanFit === "number" ? metrics.harmonicColorPlanFit : null;
        const coverageFit = typeof metrics.harmonicColorCoverageFit === "number" ? metrics.harmonicColorCoverageFit : null;
        const targetFit = typeof metrics.harmonicColorTargetFit === "number" ? metrics.harmonicColorTargetFit : null;
        const timingFit = typeof metrics.harmonicColorTimingFit === "number" ? metrics.harmonicColorTimingFit : null;
        const tonicizationPressureFit = typeof metrics.tonicizationPressureFit === "number" ? metrics.tonicizationPressureFit : null;
        const prolongationMotionFit = typeof metrics.prolongationMotionFit === "number" ? metrics.prolongationMotionFit : null;
        const hasHarmonicColorMetrics = [
            planFit,
            coverageFit,
            targetFit,
            timingFit,
            tonicizationPressureFit,
            prolongationMotionFit,
        ].some((value) => typeof value === "number");

        if (!hasHarmonicColorMetrics) {
            continue;
        }

        manifestCount += 1;

        if (typeof planFit === "number") {
            totalPlanFit += planFit;
            planFitCount += 1;
        }
        if (typeof coverageFit === "number") {
            totalCoverageFit += coverageFit;
            coverageFitCount += 1;
        }
        if (typeof targetFit === "number") {
            totalTargetFit += targetFit;
            targetFitCount += 1;
        }
        if (typeof timingFit === "number") {
            totalTimingFit += timingFit;
            timingFitCount += 1;
        }
        if (typeof tonicizationPressureFit === "number") {
            totalTonicizationPressureFit += tonicizationPressureFit;
            tonicizationPressureFitCount += 1;
        }
        if (typeof prolongationMotionFit === "number") {
            totalProlongationMotionFit += prolongationMotionFit;
            prolongationMotionFitCount += 1;
        }

        if (
            (typeof planFit === "number" && planFit < 0.62)
            || (typeof coverageFit === "number" && coverageFit < 0.56)
            || (typeof targetFit === "number" && targetFit < 0.56)
            || (typeof timingFit === "number" && timingFit < 0.56)
            || (typeof tonicizationPressureFit === "number" && tonicizationPressureFit < 0.56)
            || (typeof prolongationMotionFit === "number" && prolongationMotionFit < 0.56)
        ) {
            weakManifestCount += 1;
        }

        const existingTimestampMs = toTimestampMs(lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY;
        const manifestTimestampMs = toTimestampMs(manifest.updatedAt) ?? Number.NEGATIVE_INFINITY;
        if (manifestTimestampMs >= existingTimestampMs) {
            lastSeenAt = manifest.updatedAt;
            lastSongId = manifest.songId;
        }
    }

    return {
        manifestCount,
        weakManifestCount,
        averagePlanFit: averageNumbers(totalPlanFit, planFitCount),
        averageCoverageFit: averageNumbers(totalCoverageFit, coverageFitCount),
        averageTargetFit: averageNumbers(totalTargetFit, targetFitCount),
        averageTimingFit: averageNumbers(totalTimingFit, timingFitCount),
        averageTonicizationPressureFit: averageNumbers(totalTonicizationPressureFit, tonicizationPressureFitCount),
        averageProlongationMotionFit: averageNumbers(totalProlongationMotionFit, prolongationMotionFitCount),
        lastSeenAt,
        lastSongId,
    };
}

function weakestAudioRoles(manifest: JobManifest): string[] {
    const roles = Array.from(new Set(
        (manifest.audioEvaluation?.weakestSections ?? [])
            .map((finding) => metaSliceValue(compact(finding.role)))
            .filter(Boolean),
    ));

    return roles.length > 0 ? roles : ["unspecified"];
}

function didImmediateAudioRetrySucceed(manifest: JobManifest, retryAttempt: QualityAttemptRecord): boolean {
    const nextAudioAttempt = listAudioAttempts(manifest).find((attempt) => attempt.attempt > retryAttempt.attempt);
    if (!nextAudioAttempt) {
        return false;
    }

    return nextAudioAttempt.attempt === retryAttempt.attempt + 1
        && nextAudioAttempt.passed === true
        && manifest.state === "DONE"
        && (manifest.qualityControl?.selectedAttempt ?? -1) === nextAudioAttempt.attempt;
}

function didEventualAudioRetrySucceed(manifest: JobManifest, retryAttempt: QualityAttemptRecord): boolean {
    return manifest.state === "DONE"
        && (manifest.audioEvaluation?.passed ?? false)
        && (manifest.qualityControl?.selectedAttempt ?? -1) > retryAttempt.attempt;
}

function summarizeWeakestSections(findings: SectionEvaluationFinding[] | undefined): ManifestWeakestSectionSummary[] {
    return (findings ?? [])
        .slice(0, 3)
        .map((finding) => ({
            sectionId: finding.sectionId,
            label: finding.label,
            role: finding.role,
            score: finding.score,
            topIssue: finding.issues[0] ?? null,
            registerCenterFit: typeof finding.metrics?.registerCenterFit === "number" ? finding.metrics.registerCenterFit : null,
            registerCenterDrift: typeof finding.metrics?.registerCenterDrift === "number" ? finding.metrics.registerCenterDrift : null,
            cadenceApproachFit: typeof finding.metrics?.cadenceApproachFit === "number" ? finding.metrics.cadenceApproachFit : null,
        }));
}

function summarizeAudioWeakestSections(manifest: JobManifest): ManifestAudioWeakestSectionSummary[] {
    return (manifest.audioEvaluation?.weakestSections ?? [])
        .slice(0, 3)
        .map((finding) => ({
            sectionId: finding.sectionId,
            label: finding.label,
            role: finding.role,
            score: finding.score,
            sourceSectionId: compact(finding.sourceSectionId) || null,
            plannedTonality: compact(finding.plannedTonality) || null,
            topIssue: finding.issues[0] ?? null,
        }));
}

function summarizeOrchestration(manifest: JobManifest): ManifestOrchestrationSummary | null {
    const orchestration = manifest.structureEvaluation?.orchestration;
    if (!orchestration) {
        return null;
    }

    return {
        family: orchestration.family,
        instrumentNames: [...orchestration.instrumentNames],
        sectionCount: orchestration.sectionCount,
        conversationalSectionCount: orchestration.conversationalSectionCount,
        idiomaticRangeFit: typeof orchestration.idiomaticRangeFit === "number" ? orchestration.idiomaticRangeFit : null,
        registerBalanceFit: typeof orchestration.registerBalanceFit === "number" ? orchestration.registerBalanceFit : null,
        ensembleConversationFit: typeof orchestration.ensembleConversationFit === "number"
            ? orchestration.ensembleConversationFit
            : null,
        doublingPressureFit: typeof orchestration.doublingPressureFit === "number"
            ? orchestration.doublingPressureFit
            : null,
        textureRotationFit: typeof orchestration.textureRotationFit === "number"
            ? orchestration.textureRotationFit
            : null,
        sectionHandoffFit: typeof orchestration.sectionHandoffFit === "number" ? orchestration.sectionHandoffFit : null,
        weakSectionIds: [...orchestration.weakSectionIds],
    };
}

function collapseConsecutiveLabels(labels: string[]): string[] {
    const collapsed: string[] = [];

    for (const label of labels) {
        if (!label) {
            continue;
        }

        if (collapsed[collapsed.length - 1] !== label) {
            collapsed.push(label);
        }
    }

    return collapsed;
}

function summarizeRenderedKeyTracking(manifest: JobManifest): ManifestTrackingSummary["renderedKeyTracking"] {
    const keyTracking = manifest.audioEvaluation?.keyTracking;
    if (!keyTracking) {
        return {
            source: null,
            sections: [],
        };
    }

    return {
        source: compact(keyTracking.source) || null,
        sections: (keyTracking.sections ?? []).map((section) => ({
            sectionId: section.sectionId,
            role: section.role,
            plannedTonality: compact(section.plannedTonality) || null,
            renderedKeyLabel: compact(section.renderedKey?.label) || null,
            renderedKeyConfidence: typeof section.renderedKey?.confidence === "number" ? section.renderedKey.confidence : null,
            driftPathLabels: collapseConsecutiveLabels(
                (section.driftPath ?? [])
                    .map((point) => compact(point.renderedKey?.label))
                    .filter(Boolean),
            ),
        })),
    };
}

function extractAudioRetryEvents(manifests: JobManifest[]): AudioRetryEvent[] {
    const events: AudioRetryEvent[] = [];

    for (const manifest of manifests) {
        for (const attempt of listAudioAttempts(manifest)) {
            if ((attempt.directives?.length ?? 0) === 0) {
                continue;
            }

            const timestampMs = toTimestampMs(attempt.evaluatedAt) ?? toTimestampMs(manifest.updatedAt);
            if (timestampMs === null) {
                continue;
            }

            const { combinationKey, directiveKinds } = buildDirectiveCombo(attempt.directives);
            events.push({
                songId: manifest.songId,
                evaluatedAt: attempt.evaluatedAt,
                timestampMs,
                directiveKinds,
                combinationKey,
                reason: buildRetryReason(attempt.directives),
                immediateSuccess: didImmediateAudioRetrySucceed(manifest, attempt),
                eventualSuccess: didEventualAudioRetrySucceed(manifest, attempt),
                form: metaSliceValue(manifest.meta.form),
                workflow: metaSliceValue(manifest.meta.workflow),
                plannerVersion: metaSliceValue(manifest.meta.plannerVersion),
                weakestAudioRoles: weakestAudioRoles(manifest),
            });
        }
    }

    return events.sort((left, right) => left.timestampMs - right.timestampMs || left.songId.localeCompare(right.songId));
}

function summarizeAudioRetryEvents(events: AudioRetryEvent[], topLimit = 10): AudioRetryStatsSummary {
    const combinations = new Map<string, {
        directiveKinds: string[];
        combinationKey: string;
        totalCount: number;
        immediateSuccessCount: number;
        eventualSuccessCount: number;
        lastSeenAt: string | null;
        lastSongId: string | null;
        lastSuccessfulSongId: string | null;
        lastReason: string | null;
    }>();

    let immediateSuccesses = 0;
    let eventualSuccesses = 0;

    for (const event of events) {
        const entry = combinations.get(event.combinationKey) ?? {
            directiveKinds: event.directiveKinds,
            combinationKey: event.combinationKey,
            totalCount: 0,
            immediateSuccessCount: 0,
            eventualSuccessCount: 0,
            lastSeenAt: null,
            lastSongId: null,
            lastSuccessfulSongId: null,
            lastReason: null,
        };

        entry.totalCount += 1;
        if (event.immediateSuccess) {
            entry.immediateSuccessCount += 1;
            immediateSuccesses += 1;
        }
        if (event.eventualSuccess) {
            entry.eventualSuccessCount += 1;
            eventualSuccesses += 1;
            entry.lastSuccessfulSongId = event.songId;
        }

        entry.lastSeenAt = new Date(event.timestampMs).toISOString();
        entry.lastSongId = event.songId;
        entry.lastReason = event.reason;
        combinations.set(event.combinationKey, entry);
    }

    const topCombinations: AudioRetryCombinationStats[] = Array.from(combinations.values())
        .map((entry) => ({
            directiveKinds: entry.directiveKinds,
            combinationKey: entry.combinationKey,
            totalCount: entry.totalCount,
            immediateSuccessCount: entry.immediateSuccessCount,
            eventualSuccessCount: entry.eventualSuccessCount,
            failureCount: entry.totalCount - entry.eventualSuccessCount,
            immediateSuccessRate: toFixedRate(entry.immediateSuccessCount, entry.totalCount),
            eventualSuccessRate: toFixedRate(entry.eventualSuccessCount, entry.totalCount),
            lastSeenAt: entry.lastSeenAt,
            lastSongId: entry.lastSongId,
            lastSuccessfulSongId: entry.lastSuccessfulSongId,
            lastReason: entry.lastReason,
        }))
        .sort((left, right) => (
            right.immediateSuccessCount - left.immediateSuccessCount
            || right.eventualSuccessCount - left.eventualSuccessCount
            || right.totalCount - left.totalCount
            || left.combinationKey.localeCompare(right.combinationKey)
        ))
        .slice(0, topLimit);

    return {
        totalRetryEvents: events.length,
        immediateSuccesses,
        eventualSuccesses,
        immediateSuccessRate: toFixedRate(immediateSuccesses, events.length),
        eventualSuccessRate: toFixedRate(eventualSuccesses, events.length),
        combinationCount: combinations.size,
        topCombinations,
    };
}

function buildAudioRetryWindowSummary(events: AudioRetryEvent[], now: Date, windowDays: number): AudioRetryWindowSummary {
    const nowMs = now.getTime();
    const endDayMs = startOfUtcDay(nowMs);
    const startDayMs = endDayMs - (windowDays - 1) * DAY_MS;
    const cutoffMs = startDayMs;
    const filteredEvents = events.filter((event) => event.timestampMs >= cutoffMs && event.timestampMs <= nowMs);
    const stats = summarizeAudioRetryEvents(filteredEvents);
    const manifestCount = new Set(filteredEvents.map((event) => event.songId)).size;
    const dailySeries: AudioRetryDailySeriesPoint[] = [];

    for (let offset = 0; offset < windowDays; offset += 1) {
        const dayStartMs = startDayMs + offset * DAY_MS;
        const dayEndMs = dayStartMs + DAY_MS;
        const dayEvents = filteredEvents.filter((event) => event.timestampMs >= dayStartMs && event.timestampMs < dayEndMs);
        const dayStats = summarizeAudioRetryEvents(dayEvents, 1);
        const topCombination = dayStats.topCombinations[0] ?? null;
        dailySeries.push({
            day: toDayKey(dayStartMs),
            totalRetryEvents: dayStats.totalRetryEvents,
            immediateSuccessRate: dayStats.immediateSuccessRate,
            eventualSuccessRate: dayStats.eventualSuccessRate,
            combinationCount: dayStats.combinationCount,
            topCombinationKey: topCombination?.combinationKey ?? null,
            topCombinationImmediateSuccessRate: topCombination?.immediateSuccessRate ?? null,
            topCombinationEventualSuccessRate: topCombination?.eventualSuccessRate ?? null,
        });
    }

    return {
        windowDays,
        from: new Date(startDayMs).toISOString(),
        to: now.toISOString(),
        manifestCount,
        stats,
        dailySeries,
    };
}

function summarizeAudioRetryBreakdown(
    events: AudioRetryEvent[],
    getValue: (event: AudioRetryEvent) => string,
    topLimit = 10,
): AudioRetryBreakdownRow[] {
    const buckets = new Map<string, AudioRetryEvent[]>();

    for (const event of events) {
        const value = metaSliceValue(getValue(event));
        const bucket = buckets.get(value) ?? [];
        bucket.push(event);
        buckets.set(value, bucket);
    }

    return Array.from(buckets.entries())
        .map(([value, bucket]) => {
            const stats = summarizeAudioRetryEvents(bucket, 1);
            const topCombination = stats.topCombinations[0] ?? null;
            return {
                value,
                totalRetryEvents: stats.totalRetryEvents,
                manifestCount: new Set(bucket.map((event) => event.songId)).size,
                immediateSuccessRate: stats.immediateSuccessRate,
                eventualSuccessRate: stats.eventualSuccessRate,
                combinationCount: stats.combinationCount,
                topCombinationKey: topCombination?.combinationKey ?? null,
                topCombinationImmediateSuccessRate: topCombination?.immediateSuccessRate ?? null,
                topCombinationEventualSuccessRate: topCombination?.eventualSuccessRate ?? null,
                topCombinationSupport: topCombination?.totalCount ?? null,
            };
        })
        .sort((left, right) => (
            right.totalRetryEvents - left.totalRetryEvents
            || right.eventualSuccessRate - left.eventualSuccessRate
            || right.immediateSuccessRate - left.immediateSuccessRate
            || left.value.localeCompare(right.value)
        ))
        .slice(0, topLimit);
}

function summarizeAudioRetryBreakdownMany(
    events: AudioRetryEvent[],
    getValues: (event: AudioRetryEvent) => string[],
    topLimit = 10,
): AudioRetryBreakdownRow[] {
    const buckets = new Map<string, AudioRetryEvent[]>();

    for (const event of events) {
        const values = Array.from(new Set(getValues(event).map((value) => metaSliceValue(value))));
        const normalizedValues = values.length > 0 ? values : ["unspecified"];
        for (const value of normalizedValues) {
            const bucket = buckets.get(value) ?? [];
            bucket.push(event);
            buckets.set(value, bucket);
        }
    }

    return Array.from(buckets.entries())
        .map(([value, bucket]) => {
            const stats = summarizeAudioRetryEvents(bucket, 1);
            const topCombination = stats.topCombinations[0] ?? null;
            return {
                value,
                totalRetryEvents: stats.totalRetryEvents,
                manifestCount: new Set(bucket.map((event) => event.songId)).size,
                immediateSuccessRate: stats.immediateSuccessRate,
                eventualSuccessRate: stats.eventualSuccessRate,
                combinationCount: stats.combinationCount,
                topCombinationKey: topCombination?.combinationKey ?? null,
                topCombinationImmediateSuccessRate: topCombination?.immediateSuccessRate ?? null,
                topCombinationEventualSuccessRate: topCombination?.eventualSuccessRate ?? null,
                topCombinationSupport: topCombination?.totalCount ?? null,
            };
        })
        .sort((left, right) => (
            right.totalRetryEvents - left.totalRetryEvents
            || right.eventualSuccessRate - left.eventualSuccessRate
            || right.immediateSuccessRate - left.immediateSuccessRate
            || left.value.localeCompare(right.value)
        ))
        .slice(0, topLimit);
}

function buildSettingProfileLabel(event: AudioRetryEvent): string {
    return `${event.form} | ${event.workflow} | ${event.plannerVersion}`;
}

function summarizeShadowReranker(
    manifests: JobManifest[],
    runtimeWindow: StructureShadowHistorySummary,
): ManifestShadowRerankerSummary {
    const evidences = manifests
        .map((manifest) => loadSelectedShadowRerankerEvidence(manifest))
        .filter((entry): entry is SelectedShadowRerankerEvidence => Boolean(entry));
    const disagreements = evidences.filter((entry) => entry.disagreesWithHeuristic);
    const promotions = evidences.filter((entry) => Boolean(entry.promotionLane));
    const confidenceValues = evidences
        .map((entry) => entry.learnedConfidence)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const promotionOutcomes = summarizeShadowRerankerPromotionOutcomes(evidences);
    const promotionAdvantage = summarizeShadowRerankerPromotionAdvantage(promotionOutcomes);
    const retryLocalizationOutcomes = summarizeShadowRerankerRetryLocalizationOutcomes(evidences);
    const sortedEvidence = [...evidences].sort((left, right) => {
        const rightTimestamp = toTimestampMs(right.evaluatedAt ?? right.updatedAt) ?? 0;
        const leftTimestamp = toTimestampMs(left.evaluatedAt ?? left.updatedAt) ?? 0;
        return rightTimestamp - leftTimestamp || right.songId.localeCompare(left.songId);
    });
    const latest = sortedEvidence[0] ?? null;

    return {
        manifestCount: manifests.length,
        scoredManifestCount: evidences.length,
        disagreementCount: disagreements.length,
        highConfidenceDisagreementCount: disagreements.filter(
            (entry) => (entry.learnedConfidence ?? 0) >= STRUCTURE_SHADOW_HIGH_CONFIDENCE,
        ).length,
        promotedSelectionCount: promotions.length,
        agreementRate: evidences.length > 0
            ? Number(((evidences.length - disagreements.length) / evidences.length).toFixed(4))
            : null,
        averageLearnedConfidence: confidenceValues.length > 0
            ? averageNumbers(
                confidenceValues.reduce((sum, value) => sum + value, 0),
                confidenceValues.length,
            )
            : null,
        latestSnapshotId: latest?.snapshotId ?? null,
        lastSeenAt: latest?.evaluatedAt ?? latest?.updatedAt ?? null,
        lastSongId: latest?.songId ?? null,
        recentDisagreements: disagreements
            .slice()
            .sort((left, right) => {
                const rightTimestamp = toTimestampMs(right.updatedAt) ?? 0;
                const leftTimestamp = toTimestampMs(left.updatedAt) ?? 0;
                return rightTimestamp - leftTimestamp || right.songId.localeCompare(left.songId);
            })
            .slice(0, 3)
            .map((entry) => ({
                songId: entry.songId,
                updatedAt: entry.updatedAt,
                snapshotId: entry.snapshotId,
                lane: entry.lane,
                selectedCandidateId: entry.selectedCandidateId,
                selectedWorker: entry.selectedWorker,
                learnedTopCandidateId: entry.learnedTopCandidateId,
                learnedTopWorker: entry.learnedTopWorker,
                learnedConfidence: roundMetric(entry.learnedConfidence),
                reason: entry.reason,
            })),
        recentPromotions: promotions
            .slice()
            .sort((left, right) => {
                const rightTimestamp = toTimestampMs(right.promotionAppliedAt ?? right.updatedAt) ?? 0;
                const leftTimestamp = toTimestampMs(left.promotionAppliedAt ?? left.updatedAt) ?? 0;
                return rightTimestamp - leftTimestamp || right.songId.localeCompare(left.songId);
            })
            .slice(0, 3)
            .map((entry) => ({
                songId: entry.songId,
                updatedAt: entry.promotionAppliedAt ?? entry.updatedAt,
                snapshotId: entry.snapshotId,
                lane: entry.promotionLane,
                selectedCandidateId: entry.selectedCandidateId,
                selectedWorker: entry.selectedWorker,
                heuristicCounterfactualCandidateId: entry.promotionHeuristicCounterfactualCandidateId,
                heuristicCounterfactualWorker: entry.promotionHeuristicCounterfactualWorker,
                learnedConfidence: roundMetric(entry.learnedConfidence),
                reason: entry.reason,
            })),
        promotionOutcomes,
        promotionAdvantage,
        retryLocalizationOutcomes,
        runtimeWindow,
    };
}

export function summarizeManifestTracking(manifest: JobManifest): ManifestTrackingSummary {
    const metrics = manifest.audioEvaluation?.metrics ?? {};
    const structureMetrics = manifest.structureEvaluation?.metrics ?? {};
    const latestRetry = [...listAudioAttempts(manifest)]
        .reverse()
        .find((attempt) => (attempt.directives?.length ?? 0) > 0);

    const latestAudioRetry: LatestAudioRetrySummary | null = latestRetry
        ? (() => {
            const { combinationKey, directiveKinds } = buildDirectiveCombo(latestRetry.directives ?? []);
            return {
                attempt: latestRetry.attempt,
                evaluatedAt: latestRetry.evaluatedAt,
                directiveKinds,
                combinationKey,
                reason: buildRetryReason(latestRetry.directives ?? []),
                immediateSuccess: didImmediateAudioRetrySucceed(manifest, latestRetry),
                eventualSuccess: didEventualAudioRetrySucceed(manifest, latestRetry),
            };
        })()
        : null;

    return {
        songId: manifest.songId,
        state: manifest.state,
        updatedAt: manifest.updatedAt,
        workflow: manifest.meta.workflow ?? manifest.meta.form ?? null,
        structureScore: manifest.structureEvaluation?.score ?? null,
        audioScore: manifest.audioEvaluation?.score ?? null,
        longSpanDivergence: summarizeLongSpanDivergence(
            manifest.structureEvaluation?.longSpan,
            manifest.audioEvaluation?.longSpan,
            manifest.audioEvaluation,
            manifest.structureEvaluation,
        ) ?? null,
        weakestSections: summarizeWeakestSections(manifest.structureEvaluation?.weakestSections),
        audioWeakestSections: summarizeAudioWeakestSections(manifest),
        structureNarrative: {
            registerPlanFit: typeof structureMetrics.registerPlanFit === "number" ? structureMetrics.registerPlanFit : null,
            cadenceApproachPlanFit: typeof structureMetrics.cadenceApproachPlanFit === "number" ? structureMetrics.cadenceApproachPlanFit : null,
        },
        orchestration: summarizeOrchestration(manifest),
        audioNarrative: {
            developmentFit: typeof metrics.audioDevelopmentNarrativeFit === "number" ? metrics.audioDevelopmentNarrativeFit : null,
            recapFit: typeof metrics.audioRecapRecallFit === "number" ? metrics.audioRecapRecallFit : null,
            renderConsistency: typeof metrics.audioNarrativeRenderConsistency === "number" ? metrics.audioNarrativeRenderConsistency : null,
            tonalReturnFit: typeof metrics.audioTonalReturnRenderFit === "number" ? metrics.audioTonalReturnRenderFit : null,
            harmonicRouteFit: typeof metrics.audioHarmonicRouteRenderFit === "number" ? metrics.audioHarmonicRouteRenderFit : null,
            chromaTonalReturnFit: typeof metrics.audioChromaTonalReturnFit === "number" ? metrics.audioChromaTonalReturnFit : null,
            chromaHarmonicRouteFit: typeof metrics.audioChromaHarmonicRouteFit === "number" ? metrics.audioChromaHarmonicRouteFit : null,
            developmentKeyDriftFit: typeof metrics.audioDevelopmentKeyDriftFit === "number" ? metrics.audioDevelopmentKeyDriftFit : null,
            longSpan: manifest.audioEvaluation?.longSpan ?? null,
        },
        latestAudioRetryReason: latestAudioRetry?.reason ?? null,
        latestAudioRetry,
        sectionTransforms: manifest.sectionTransforms ?? [],
        sectionTonalities: manifest.sectionTonalities ?? [],
        renderedKeyTracking: summarizeRenderedKeyTracking(manifest),
    };
}

export function buildManifestOperationalSummary(
    manifests: JobManifest[],
    now = new Date(),
    options: ManifestOperationalSummaryOptions = {},
): ManifestOperationalSummary {
    const retryEvents = extractAudioRetryEvents(manifests);
    const shadowReranker = summarizeShadowReranker(
        manifests,
        summarizeStructureShadowHistory({
            windowHours: options.shadowHistoryWindowHours,
            limit: options.shadowHistoryLimit,
            now,
        }),
    );

    return {
        audioRetryStats: summarizeAudioRetryEvents(retryEvents),
        audioRetryWindows: {
            last7Days: buildAudioRetryWindowSummary(retryEvents, now, 7),
            last30Days: buildAudioRetryWindowSummary(retryEvents, now, 30),
        },
        audioRetryBreakdowns: {
            byForm: summarizeAudioRetryBreakdown(retryEvents, (event) => event.form),
            byWorkflow: summarizeAudioRetryBreakdown(retryEvents, (event) => event.workflow),
            byPlannerVersion: summarizeAudioRetryBreakdown(retryEvents, (event) => event.plannerVersion),
            bySettingProfile: summarizeAudioRetryBreakdown(retryEvents, (event) => buildSettingProfileLabel(event)),
            byAudioWeakestRole: summarizeAudioRetryBreakdownMany(retryEvents, (event) => event.weakestAudioRoles),
        },
        successfulSectionPatterns: summarizeSuccessfulSectionPatterns(manifests),
        phraseBreathTrends: summarizePhraseBreathTrends(manifests),
        harmonicColorTrends: summarizeHarmonicColorTrends(manifests),
        shadowReranker,
        orchestrationTrends: summarizeOrchestrationTrends(manifests),
        recentManifestTracking: manifests
            .slice()
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .slice(0, 8)
            .map((manifest) => summarizeManifestTracking(manifest)),
    };
}