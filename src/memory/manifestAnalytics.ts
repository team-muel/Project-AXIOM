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
import { detectStructureRerankerPromotionLane } from "../pipeline/structureRerankerPromotionLane.js";
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

export interface ManifestLearnedProposalWarningRow {
    warning: string;
    count: number;
    proposalCount: number;
    lastSeenAt: string | null;
    lastSongId: string | null;
}

export interface ManifestLearnedProposalWarningSummary {
    sampledManifestCount: number;
    proposalCount: number;
    proposalWithWarningsCount: number;
    totalWarningCount: number;
    roleCollapseWarningCount: number;
    lastSeenAt: string | null;
    lastSongId: string | null;
    topWarnings: ManifestLearnedProposalWarningRow[];
}

export interface ManifestLearnedBackboneBenchmarkWorkerOutcomeSummary {
    runCount: number;
    reviewedRunCount: number;
    pendingReviewCount: number;
    approvedCount: number;
    rejectedCount: number;
    approvalRate: number | null;
    averageAppealScore: number | null;
}

export interface ManifestLearnedBackboneBenchmarkConfigSnapshot {
    lane: string;
    benchmarkPackVersion: string;
    benchmarkIds: string[];
    pairedWorkers: string[];
    workflowCounts: Record<string, number>;
    promptPackVersionCounts: Record<string, number>;
    reviewRubricVersionCounts: Record<string, number>;
    generationModeCounts: Record<string, number>;
}

export interface ManifestLearnedBackboneBenchmarkReviewSampleStatus {
    status: "directional_only" | "screening_ready" | "promotion_sample_ready";
    directionalOnly: boolean;
    reviewedRunCount: number;
    reviewedDisagreementCount: number;
    minimumReviewedRunCountForScreening: number;
    minimumReviewedRunCountForPromotion: number;
    minimumReviewedDisagreementCountForPromotion: number;
    remainingReviewedRunCountForScreening: number;
    remainingReviewedRunCountForPromotion: number;
    remainingReviewedDisagreementCountForPromotion: number;
    meetsEarlyScreeningMinimum: boolean;
    meetsPromotionReviewedMinimum: boolean;
    meetsPromotionDisagreementMinimum: boolean;
}

export interface ManifestLearnedBackboneBenchmarkDisagreementSummary {
    pairedRunCount: number;
    disagreementRunCount: number;
    reviewedDisagreementCount: number;
    promotionAppliedCount: number;
    learnedSelectedWithoutPromotionCount: number;
    baselineSelectedCount: number;
}

export interface ManifestLearnedBackboneBenchmarkRetryLocalizationStability {
    retryingRunCount: number;
    sectionTargetedOnlyCount: number;
    mixedCount: number;
    globalOnlyCount: number;
    sectionTargetedRate: number | null;
    driftRate: number | null;
    status: "not_enough_retry_data" | "stable" | "drifting";
}

export interface ManifestLearnedBackboneBenchmarkBlindPreferenceSummary {
    available: boolean;
    winRate: number | null;
    reviewedPairCount: number;
    decisivePairCount: number;
    learnedWinCount: number;
    baselineWinCount: number;
    tieCount: number;
    latestReviewedAt: string | null;
    reason: string;
}

export interface ManifestLearnedBackboneBenchmarkReviewedTop1AccuracySummary {
    available: boolean;
    decisiveReviewedPairCount: number;
    correctSelectionCount: number;
    selectedTop1Accuracy: number | null;
    learnedSelectedReviewedPairCount: number;
    learnedCorrectSelectionCount: number;
    learnedSelectedTop1Accuracy: number | null;
    baselineSelectedReviewedPairCount: number;
    baselineCorrectSelectionCount: number;
    baselineSelectedTop1Accuracy: number | null;
    promotedReviewedPairCount: number;
    promotedCorrectSelectionCount: number;
    promotedTop1Accuracy: number | null;
    latestReviewedAt: string | null;
    reason: string;
}

export interface ManifestLearnedBackbonePromotionGateSummary {
    status: "experimental" | "review_hold" | "blocked" | "ready_for_guarded_promotion";
    signal: "insufficient_evidence" | "positive" | "mixed" | "negative";
    minimumReviewedRunCount: number;
    minimumReviewedDisagreementCount: number;
    minimumReviewedSelectedInShortlistRate: number;
    meetsReviewedRunMinimum: boolean;
    meetsReviewedDisagreementMinimum: boolean;
    meetsReviewedSelectedInShortlistMinimum: boolean;
    retryLocalizationStable: boolean;
    blindPreferenceAvailable: boolean;
    blindPreferenceWinRate: number | null;
    reviewedSelectedInShortlistRate: number | null;
    reviewedSelectedTop1Rate: number | null;
    approvalRateDelta: number | null;
    appealScoreDelta: number | null;
    positiveSignals: string[];
    negativeSignals: string[];
    blockers: string[];
    rationale: string;
}

export interface ManifestLearnedBackboneBenchmarkFailureModeRow {
    failureMode: string;
    count: number;
}

export interface ManifestLearnedBackboneBenchmarkStopReasonRow {
    reason: string;
    count: number;
}

export interface ManifestLearnedBackboneBenchmarkCoverageRow {
    benchmarkKey: string;
    benchmarkId: string | null;
    planSignature: string | null;
    lane: string;
    benchmarkPackVersion: string;
    runCount: number;
    pairedRunCount: number;
    reviewedRunCount: number;
    pendingReviewCount: number;
    approvalRate: number | null;
    averageAppealScore: number | null;
    selectedWorkerCounts: Record<string, number>;
    generationModeCounts: Record<string, number>;
    latestObservedAt: string | null;
    songIds: string[];
}

export interface ManifestLearnedBackboneBenchmarkSearchBudgetRow {
    searchBudgetLevel: "S0" | "S1" | "S2" | "S3" | "S4" | "custom";
    searchBudgetDescriptor: string;
    wholePieceCandidateCount: number;
    localizedRewriteBranchCount: number;
    runCount: number;
    pairedRunCount: number;
    reviewedRunCount: number;
    pendingReviewCount: number;
    approvalRate: number | null;
    averageAppealScore: number | null;
    blindPreferenceWinRate: number | null;
    reviewedPairCount: number;
    decisivePairCount: number;
    selectedTop1Accuracy: number | null;
    decisiveReviewedPairCount: number;
    correctSelectionCount: number;
    latestObservedAt: string | null;
}

export interface ManifestLearnedBackboneBenchmarkRecentRunRow {
    songId: string;
    benchmarkId: string | null;
    planSignature: string | null;
    selectedWorker: string;
    approvalStatus: string;
    reviewed: boolean;
    appealScore: number | null;
    disagreementObserved: boolean;
    promotionApplied: boolean;
    selectionMode: string;
    counterfactualWorker: string | null;
    retryLocalization: string;
    benchmarkGenerationMode: string | null;
    selectedGenerationMode: string | null;
    selectionStopReason: string | null;
    reviewWeakestDimension: string | null;
    observedAt: string;
    wholePieceCandidateCount: number;
    localizedRewriteBranchCount: number;
    searchBudgetLevel: "S0" | "S1" | "S2" | "S3" | "S4" | "custom";
    searchBudgetDescriptor: string;
}

export interface ManifestLearnedBackboneBenchmarkReviewQueueRow {
    songId: string;
    benchmarkId: string | null;
    planSignature: string | null;
    reviewTarget: "shortlist" | "pairwise";
    selectedWorker: string;
    counterfactualWorker: string | null;
    selectionMode: string;
    observedAt: string;
    wholePieceCandidateCount: number;
    localizedRewriteBranchCount: number;
    searchBudgetLevel: "S0" | "S1" | "S2" | "S3" | "S4" | "custom";
    searchBudgetDescriptor: string;
    shortlistTopK: number | null;
    selectedRank: number | null;
    selectedInShortlist: boolean;
}

export interface ManifestLearnedBackboneBenchmarkReviewQueueSummary {
    pendingBlindReviewCount: number;
    pendingShortlistReviewCount: number;
    latestPendingAt: string | null;
    recentPendingRows: ManifestLearnedBackboneBenchmarkReviewQueueRow[];
}

export interface ManifestLearnedBackboneBenchmarkReviewPackRow {
    packId: string;
    generatedAt: string | null;
    reviewTarget: "all" | "shortlist" | "pairwise" | null;
    searchBudget: string | null;
    entryCount: number;
    completedDecisionCount: number;
    pendingDecisionCount: number;
    pendingShortlistDecisionCount: number;
    latestReviewedAt: string | null;
    reviewSheetPath: string | null;
}

export interface ManifestLearnedBackboneBenchmarkReviewPackSummary {
    matchedPackCount: number;
    activePackCount: number;
    pendingDecisionCount: number;
    completedDecisionCount: number;
    latestGeneratedAt: string | null;
    latestReviewedAt: string | null;
    recentActivePacks: ManifestLearnedBackboneBenchmarkReviewPackRow[];
}

export interface ManifestLearnedBackboneBenchmarkPairedSelectionOutcomeSummary {
    lane: string;
    benchmarkPackVersion: string;
    reviewedManifestCount: number;
    promotedReviewedCount: number;
    promotedApprovalRate: number | null;
    promotedAverageAppealScore: number | null;
    heuristicReviewedCount: number;
    heuristicApprovalRate: number | null;
    heuristicAverageAppealScore: number | null;
}

export interface ManifestLearnedBackboneBenchmarkSummary {
    lane: string;
    benchmarkPackVersion: string;
    configSnapshot: ManifestLearnedBackboneBenchmarkConfigSnapshot;
    runCount: number;
    pairedRunCount: number;
    reviewedRunCount: number;
    pendingReviewCount: number;
    approvalRate: number | null;
    averageAppealScore: number | null;
    blindPreference: ManifestLearnedBackboneBenchmarkBlindPreferenceSummary;
    shortlistBlindPreference: ManifestLearnedBackboneBenchmarkBlindPreferenceSummary;
    reviewedTop1Accuracy: ManifestLearnedBackboneBenchmarkReviewedTop1AccuracySummary;
    promotionGate: ManifestLearnedBackbonePromotionGateSummary;
    reviewSampleStatus: ManifestLearnedBackboneBenchmarkReviewSampleStatus;
    reviewQueue: ManifestLearnedBackboneBenchmarkReviewQueueSummary;
    reviewPacks: ManifestLearnedBackboneBenchmarkReviewPackSummary;
    disagreementSummary: ManifestLearnedBackboneBenchmarkDisagreementSummary;
    retryLocalizationStability: ManifestLearnedBackboneBenchmarkRetryLocalizationStability;
    topFailureModes: ManifestLearnedBackboneBenchmarkFailureModeRow[];
    topStopReasons: ManifestLearnedBackboneBenchmarkStopReasonRow[];
    selectedWorkerCounts: Record<string, number>;
    selectedWorkerOutcomes: Record<string, ManifestLearnedBackboneBenchmarkWorkerOutcomeSummary>;
    workflowCounts: Record<string, number>;
    promptPackVersionCounts: Record<string, number>;
    reviewRubricVersionCounts: Record<string, number>;
    generationModeCounts: Record<string, number>;
    selectionModeCounts: Record<string, number>;
    searchBudgetCounts: Record<string, number>;
    pairedSelectionOutcomes: ManifestLearnedBackboneBenchmarkPairedSelectionOutcomeSummary;
    promotionAdvantage: ManifestShadowRerankerPromotionAdvantageSummary;
    retryLocalizationOutcomes: ManifestShadowRerankerRetryLocalizationSummary;
    coverageRows: ManifestLearnedBackboneBenchmarkCoverageRow[];
    searchBudgetRows: ManifestLearnedBackboneBenchmarkSearchBudgetRow[];
    recentRunRows: ManifestLearnedBackboneBenchmarkRecentRunRow[];
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

export interface ManifestShadowRerankerRecentShortlistRow {
    songId: string;
    updatedAt: string;
    snapshotId: string | null;
    lane: string | null;
    selectedCandidateId: string | null;
    selectedWorker: string | null;
    heuristicTopCandidateId: string | null;
    learnedTopCandidateId: string | null;
    topK: number;
    selectedRank: number | null;
    selectedInShortlist: boolean;
    shortlistedCandidateIds: string[];
}

export interface ManifestShadowRerankerShortlistSummary {
    lane: string | null;
    scoredManifestCount: number;
    reviewedManifestCount: number;
    topKCounts: Record<string, number>;
    selectedInShortlistCount: number;
    selectedInShortlistRate: number | null;
    selectedOutsideShortlistCount: number;
    selectedTop1Count: number;
    selectedTop1Rate: number | null;
    reviewedSelectedInShortlistCount: number;
    reviewedSelectedInShortlistRate: number | null;
    reviewedSelectedTop1Count: number;
    reviewedSelectedTop1Rate: number | null;
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
    shortlist: ManifestShadowRerankerShortlistSummary | null;
    recentShortlists: ManifestShadowRerankerRecentShortlistRow[];
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
    learnedProposalWarnings: ManifestLearnedProposalWarningSummary;
    learnedBackboneBenchmark: ManifestLearnedBackboneBenchmarkSummary;
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
    heuristicTopCandidateId: string | null;
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
    shortlistTopK: number | null;
    shortlistedCandidateIds: string[];
    selectedRank: number | null;
    selectedInShortlist: boolean;
    latestStructureRetryAttempt: number | null;
    latestStructureRetryTargetedDirectiveCount: number;
    latestStructureRetryUntargetedDirectiveCount: number;
}

interface ResolvedShadowRerankerShortlist {
    topK: number;
    orderedCandidateIds: string[];
    shortlistedCandidateIds: string[];
    heuristicTopCandidateId: string | null;
    learnedTopCandidateId: string | null;
    selectedRank: number | null;
    selectedInShortlist: boolean;
}

interface LearnedProposalWarningSample {
    songId: string;
    proposalId: string;
    updatedAt: string;
    warnings: string[];
}

interface LearnedProposalWarningBucket {
    warning: string;
    count: number;
    proposalIds: Set<string>;
    lastSeenAt: string | null;
    lastSongId: string | null;
}

interface LearnedBackboneBenchmarkRunRow {
    songId: string;
    benchmarkPackVersion: string;
    benchmarkId: string | null;
    planSignature: string | null;
    lane: string;
    promptPackVersion: string | null;
    reviewRubricVersion: string | null;
    workflow: string | null;
    selectedWorker: string;
    approvalStatus: string;
    reviewed: boolean;
    appealScore: number | null;
    pairedRun: boolean;
    candidateWorkers: string[];
    counterfactualWorker: string | null;
    retryLocalization: "none" | "section_targeted" | "mixed" | "global";
    benchmarkGenerationMode: string | null;
    selectedGenerationMode: string | null;
    disagreementObserved: boolean;
    promotionApplied: boolean;
    selectionMode: "single_worker" | "promoted_learned" | "learned_selected" | "baseline_selected";
    selectionStopReason: string | null;
    reviewWeakestDimension: string | null;
    observedAt: string;
    wholePieceCandidateCount: number;
    localizedRewriteBranchCount: number;
    searchBudgetLevel: "S0" | "S1" | "S2" | "S3" | "S4" | "custom";
    searchBudgetDescriptor: string;
    shortlistTopK: number | null;
    selectedRank: number | null;
    selectedInShortlist: boolean;
}

interface LearnedBackboneBlindReviewAnswerEntry {
    entryId: string;
    songId: string | null;
    benchmarkId: string | null;
    planSignature: string | null;
    selectedWorker: string | null;
    selectionMode: LearnedBackboneBenchmarkRunRow["selectionMode"] | null;
    reviewTarget: ManifestLearnedBackboneBenchmarkReviewQueueRow["reviewTarget"] | null;
    selectedInShortlist: boolean;
    learnedLabel: string;
    baselineLabel: string;
}

interface LearnedBackboneBlindReviewResultEntry {
    entryId: string;
    winnerLabel: string;
    reviewedAt: string | null;
}

interface LearnedBackboneBlindReviewResolvedEvaluation {
    entryId: string;
    songId: string | null;
    benchmarkId: string | null;
    planSignature: string | null;
    selectedWorker: string | null;
    selectionMode: LearnedBackboneBenchmarkRunRow["selectionMode"] | null;
    learnedLabel: string;
    baselineLabel: string;
    winnerLabel: string;
    reviewedAt: string | null;
}

const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED = 4;
const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT = 2;
const LEARNED_BACKBONE_BENCHMARK_PACK_VERSION = "string_trio_symbolic_benchmark_pack_v1";
const LEARNED_BACKBONE_BENCHMARK_LANE = "string_trio_symbolic";
const LEARNED_BACKBONE_EARLY_SCREENING_MIN_REVIEWED_RUNS = 20;
const LEARNED_BACKBONE_PROMOTION_RECOMMENDED_MIN_REVIEWED_RUNS = 30;
const LEARNED_BACKBONE_PROMOTION_RECOMMENDED_MIN_DISAGREEMENT_RUNS = 10;
const LEARNED_BACKBONE_PROMOTION_MIN_REVIEWED_SELECTED_IN_SHORTLIST_RATE = 0.6;
const LEARNED_BACKBONE_REVIEWED_APPROVAL_STATUSES = new Set(["approved", "rejected"]);

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

function toOutputRelativePath(filePath: string, outputDir: string = config.outputDir): string {
    const normalizedOutputDir = path.resolve(outputDir);
    const normalizedFilePath = path.resolve(filePath);
    const relative = path.relative(normalizedOutputDir, normalizedFilePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        return normalizedFilePath.split(path.sep).join("/");
    }

    return path.posix.join(path.basename(normalizedOutputDir), relative.split(path.sep).join("/"));
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

function resolveShadowRerankerShortlist(index: StructureCandidateIndex): ResolvedShadowRerankerShortlist | null {
    const rankedEntries = index.entries
        .map((entry) => {
            const learnedRank = typeof entry.shadowReranker?.learnedRank === "number"
                && Number.isFinite(entry.shadowReranker.learnedRank)
                ? entry.shadowReranker.learnedRank
                : null;
            const heuristicRank = typeof entry.shadowReranker?.heuristicRank === "number"
                && Number.isFinite(entry.shadowReranker.heuristicRank)
                ? entry.shadowReranker.heuristicRank
                : null;
            if (learnedRank === null) {
                return null;
            }

            return {
                candidateId: entry.candidateId,
                learnedRank,
                heuristicRank,
            };
        })
        .filter((entry): entry is {
            candidateId: string;
            learnedRank: number;
            heuristicRank: number | null;
        } => Boolean(entry))
        .sort((left, right) => {
            const learnedDelta = left.learnedRank - right.learnedRank;
            if (Math.abs(learnedDelta) > 0.0001) {
                return learnedDelta;
            }

            const heuristicDelta = (left.heuristicRank ?? Number.MAX_SAFE_INTEGER)
                - (right.heuristicRank ?? Number.MAX_SAFE_INTEGER);
            if (Math.abs(heuristicDelta) > 0.0001) {
                return heuristicDelta;
            }

            return left.candidateId.localeCompare(right.candidateId);
        });

    if (rankedEntries.length === 0) {
        return null;
    }

    const topK = Math.min(3, rankedEntries.length);
    const orderedCandidateIds = rankedEntries.map((entry) => entry.candidateId);
    const shortlistedCandidateIds = orderedCandidateIds.slice(0, topK);
    const selectedRankIndex = index.selectedCandidateId
        ? orderedCandidateIds.findIndex((candidateId) => candidateId === index.selectedCandidateId)
        : -1;

    return {
        topK,
        orderedCandidateIds,
        shortlistedCandidateIds,
        heuristicTopCandidateId: rankedEntries.find((entry) => entry.heuristicRank === 1)?.candidateId ?? null,
        learnedTopCandidateId: orderedCandidateIds[0] ?? null,
        selectedRank: selectedRankIndex >= 0 ? selectedRankIndex + 1 : null,
        selectedInShortlist: selectedRankIndex >= 0 && selectedRankIndex < topK,
    };
}

function roundMetric(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value)
        ? Number(value.toFixed(4))
        : null;
}

function incrementNamedCount(record: Record<string, number>, key: string | null | undefined, increment = 1): void {
    const token = compact(key) || "unknown";
    record[token] = (record[token] ?? 0) + increment;
}

function uniqueSortedStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.map((value) => compact(value)).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}

function optionalRatio(numerator: number, denominator: number): number | null {
    return denominator > 0 ? toFixedRate(numerator, denominator) : null;
}

function learnedBackboneBlindReviewRoot(outputDir = config.outputDir): string {
    return path.join(outputDir, "_system", "ml", "review-packs", "learned-backbone");
}

function loadLearnedBackboneBlindReviewAnswerEntries(dirPath: string): Map<string, LearnedBackboneBlindReviewAnswerEntry> {
    const answerKey = readJsonIfExists<{
        lane?: string;
        benchmarkPackVersion?: string;
        entries?: Array<{
            entryId?: unknown;
            songId?: unknown;
            benchmarkId?: unknown;
            planSignature?: unknown;
            selectedWorker?: unknown;
            selectionMode?: unknown;
            reviewTarget?: unknown;
            selectedInShortlist?: unknown;
            learned?: { label?: unknown };
            baseline?: { label?: unknown };
        }>;
    }>(path.join(dirPath, "answer-key.json"));
    const entries = new Map<string, LearnedBackboneBlindReviewAnswerEntry>();
    for (const item of answerKey?.entries ?? []) {
        const entryId = compact(item?.entryId);
        const learnedLabel = compact(item?.learned?.label);
        const baselineLabel = compact(item?.baseline?.label);
        if (!entryId || !learnedLabel || !baselineLabel) {
            continue;
        }
        entries.set(entryId, {
            entryId,
            songId: compact(item?.songId) || null,
            benchmarkId: compact(item?.benchmarkId) || null,
            planSignature: compact(item?.planSignature) || null,
            selectedWorker: compact(item?.selectedWorker) || null,
            selectionMode: compact(item?.selectionMode) as LearnedBackboneBenchmarkRunRow["selectionMode"] | "" || null,
            reviewTarget: (() => {
                const reviewTarget = compact(item?.reviewTarget).toLowerCase();
                return reviewTarget === "shortlist" || reviewTarget === "pairwise"
                    ? reviewTarget
                    : null;
            })(),
            selectedInShortlist: item?.selectedInShortlist === true,
            learnedLabel,
            baselineLabel,
        });
    }
    return entries;
}

function collectLearnedBackboneBlindReviewEvaluations(
    benchmarkPackVersion = LEARNED_BACKBONE_BENCHMARK_PACK_VERSION,
    lane = LEARNED_BACKBONE_BENCHMARK_LANE,
): {
    matchedPackCount: number;
    evaluations: LearnedBackboneBlindReviewResolvedEvaluation[];
    reviewPacks: ManifestLearnedBackboneBenchmarkReviewPackSummary;
} {
    const rootDir = learnedBackboneBlindReviewRoot();
    if (!fs.existsSync(rootDir)) {
        return {
            matchedPackCount: 0,
            evaluations: [],
            reviewPacks: {
                matchedPackCount: 0,
                activePackCount: 0,
                pendingDecisionCount: 0,
                completedDecisionCount: 0,
                latestGeneratedAt: null,
                latestReviewedAt: null,
                recentActivePacks: [],
            },
        };
    }

    let matchedPackCount = 0;
    const evaluations: LearnedBackboneBlindReviewResolvedEvaluation[] = [];
    const reviewPackRows: ManifestLearnedBackboneBenchmarkReviewPackRow[] = [];

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const dirPath = path.join(rootDir, entry.name);
        const packFile = readJsonIfExists<{
            packId?: unknown;
            generatedAt?: unknown;
            entryCount?: unknown;
            sourceReviewQueue?: {
                reviewTarget?: unknown;
                searchBudget?: unknown;
            };
        }>(path.join(dirPath, "pack.json"));
        const answerKey = readJsonIfExists<{
            lane?: string;
            benchmarkPackVersion?: string;
        }>(path.join(dirPath, "answer-key.json"));
        const resultsFile = readJsonIfExists<{
            lane?: string;
            benchmarkPackVersion?: string;
        }>(path.join(dirPath, "results.json"));
        const answerLane = compact(answerKey?.lane) || compact(resultsFile?.lane);
        const answerBenchmarkPackVersion = compact(answerKey?.benchmarkPackVersion) || compact(resultsFile?.benchmarkPackVersion);
        if (answerBenchmarkPackVersion && answerBenchmarkPackVersion !== benchmarkPackVersion) {
            continue;
        }
        if (lane && answerLane && answerLane !== lane) {
            continue;
        }

        const answerEntries = loadLearnedBackboneBlindReviewAnswerEntries(dirPath);
        const results = loadLearnedBackboneBlindReviewResults(dirPath);
        const answerEntryRows = [...answerEntries.values()];
        const entryCount = answerEntries.size > 0
            ? answerEntries.size
            : Math.max(0, Math.floor(Number(packFile?.entryCount ?? 0)));
        if (entryCount > 0) {
            const completedEntryIds = new Set(
                results
                    .map((result) => compact(result.entryId))
                    .filter((entryId): entryId is string => Boolean(entryId)),
            );
            const latestReviewedAt = results
                .map((result) => compact(result.reviewedAt) || null)
                .filter((value): value is string => Boolean(value))
                .sort((left, right) => right.localeCompare(left))[0] ?? null;
            const reviewTarget = (() => {
                const normalized = compact(packFile?.sourceReviewQueue?.reviewTarget).toLowerCase();
                return normalized === "all" || normalized === "shortlist" || normalized === "pairwise"
                    ? normalized
                    : null;
            })();
            const searchBudget = compact(packFile?.sourceReviewQueue?.searchBudget) || null;
            const completedDecisionCount = Math.min(entryCount, completedEntryIds.size);
            const reviewSheetPath = path.join(dirPath, "review-sheet.csv");
            reviewPackRows.push({
                packId: compact(packFile?.packId) || entry.name,
                generatedAt: compact(packFile?.generatedAt) || null,
                reviewTarget,
                searchBudget,
                entryCount,
                completedDecisionCount,
                pendingDecisionCount: Math.max(0, entryCount - completedDecisionCount),
                pendingShortlistDecisionCount: answerEntryRows.filter((answer) => answer.selectedInShortlist && !completedEntryIds.has(answer.entryId)).length,
                latestReviewedAt,
                reviewSheetPath: fs.existsSync(reviewSheetPath) ? toOutputRelativePath(reviewSheetPath) : null,
            });
        }
        if (answerEntries.size === 0 || results.length === 0) {
            continue;
        }

        matchedPackCount += 1;
        for (const result of results) {
            const answer = answerEntries.get(result.entryId);
            if (!answer) {
                continue;
            }
            if (result.winnerLabel === "SKIP") {
                continue;
            }

            evaluations.push({
                entryId: answer.entryId,
                songId: answer.songId,
                benchmarkId: answer.benchmarkId,
                planSignature: answer.planSignature,
                selectedWorker: answer.selectedWorker,
                selectionMode: answer.selectionMode,
                learnedLabel: answer.learnedLabel,
                baselineLabel: answer.baselineLabel,
                winnerLabel: result.winnerLabel,
                reviewedAt: result.reviewedAt,
            });
        }
    }

    return {
        matchedPackCount,
        evaluations,
        reviewPacks: summarizeLearnedBackboneReviewPacks(reviewPackRows),
    };
}

function resolveLearnedBackboneBlindReviewSelectedSide(
    evaluation: LearnedBackboneBlindReviewResolvedEvaluation,
): "learned" | "baseline" | null {
    if (evaluation.selectionMode === "promoted_learned" || evaluation.selectionMode === "learned_selected") {
        return "learned";
    }
    if (evaluation.selectionMode === "baseline_selected") {
        return "baseline";
    }
    if (evaluation.selectedWorker === "learned_symbolic") {
        return "learned";
    }
    if (evaluation.selectedWorker === "music21") {
        return "baseline";
    }
    return null;
}

function resolveLearnedBackboneBlindReviewWinnerSide(
    evaluation: LearnedBackboneBlindReviewResolvedEvaluation,
): "learned" | "baseline" | null {
    if (evaluation.winnerLabel === evaluation.learnedLabel) {
        return "learned";
    }
    if (evaluation.winnerLabel === evaluation.baselineLabel) {
        return "baseline";
    }
    return null;
}

function loadLearnedBackboneBlindReviewResults(dirPath: string): LearnedBackboneBlindReviewResultEntry[] {
    const resultsFile = readJsonIfExists<{
        results?: Array<{
            entryId?: unknown;
            winnerLabel?: unknown;
            reviewedAt?: unknown;
        }>;
    }>(path.join(dirPath, "results.json"));
    const byEntryId = new Map<string, LearnedBackboneBlindReviewResultEntry>();
    for (const item of resultsFile?.results ?? []) {
        const entryId = compact(item?.entryId);
        const winnerLabel = compact(item?.winnerLabel).toUpperCase();
        const reviewedAt = compact(item?.reviewedAt) || null;
        if (!entryId || !winnerLabel) {
            continue;
        }
        byEntryId.set(entryId, {
            entryId,
            winnerLabel,
            reviewedAt,
        });
    }
    return [...byEntryId.values()];
}

function hasLearnedBackboneBenchmarkEvidence(
    proposalEvidence: unknown,
    benchmarkPackVersion = LEARNED_BACKBONE_BENCHMARK_PACK_VERSION,
    lane = LEARNED_BACKBONE_BENCHMARK_LANE,
): boolean {
    if (!proposalEvidence || typeof proposalEvidence !== "object" || Array.isArray(proposalEvidence)) {
        return false;
    }

    const record = proposalEvidence as Record<string, unknown>;
    if (benchmarkPackVersion && compact(record.benchmarkPackVersion) !== benchmarkPackVersion) {
        return false;
    }

    if (lane) {
        const evidenceLane = compact(record.lane);
        if (evidenceLane && evidenceLane !== lane) {
            return false;
        }
    }

    return Boolean(compact(record.planSignature) || compact(record.benchmarkId));
}

function classifyLearnedBackboneRetryLocalization(
    directives: RevisionDirective[] | undefined,
): LearnedBackboneBenchmarkRunRow["retryLocalization"] {
    const normalized = Array.isArray(directives)
        ? directives.filter((directive) => directive && typeof directive === "object")
        : [];
    if (normalized.length === 0) {
        return "none";
    }

    let targetedCount = 0;
    let globalCount = 0;
    for (const directive of normalized) {
        const sectionIds = Array.isArray(directive.sectionIds)
            ? directive.sectionIds.map((value) => compact(value)).filter(Boolean)
            : [];
        if (sectionIds.length > 0) {
            targetedCount += 1;
        } else {
            globalCount += 1;
        }
    }

    if (targetedCount > 0 && globalCount === 0) {
        return "section_targeted";
    }

    if (targetedCount > 0 && globalCount > 0) {
        return "mixed";
    }

    return "global";
}

function classifyLearnedBackboneSearchBudget(
    wholePieceCandidateCount: number,
    localizedRewriteBranchCount = 0,
): LearnedBackboneBenchmarkRunRow["searchBudgetLevel"] {
    if (Math.max(0, Math.floor(localizedRewriteBranchCount)) > 0
        && Math.max(0, Math.floor(wholePieceCandidateCount)) >= 4) {
        return "S4";
    }

    switch (Math.max(0, Math.floor(wholePieceCandidateCount))) {
        case 1:
            return "S0";
        case 2:
            return "S1";
        case 4:
            return "S2";
        case 8:
            return "S3";
        default:
            return "custom";
    }
}

function describeLearnedBackboneSearchBudget(
    searchBudgetLevel: LearnedBackboneBenchmarkRunRow["searchBudgetLevel"],
    wholePieceCandidateCount: number,
    localizedRewriteBranchCount = 0,
): string {
    const normalizedWholePieceCount = Math.max(0, Math.floor(wholePieceCandidateCount));
    const normalizedBranchCount = Math.max(0, Math.floor(localizedRewriteBranchCount));

    if (searchBudgetLevel !== "custom") {
        return searchBudgetLevel;
    }

    if (normalizedBranchCount > 0) {
        return `custom(${normalizedWholePieceCount}+${normalizedBranchCount})`;
    }

    return `custom(${normalizedWholePieceCount})`;
}

function classifySameAttemptSearchBudgetCounts(
    records: Array<{ candidateManifest?: Pick<StructureCandidateManifest, "revisionDirectives"> | null }>,
): {
    wholePieceCandidateCount: number;
    localizedRewriteBranchCount: number;
} {
    const wholePieceRecords = records.filter((record) => (record.candidateManifest?.revisionDirectives?.length ?? 0) === 0);
    const localizedRewriteBranchCount = wholePieceRecords.length > 0
        ? records.length - wholePieceRecords.length
        : 0;

    return {
        wholePieceCandidateCount: wholePieceRecords.length > 0 ? wholePieceRecords.length : records.length,
        localizedRewriteBranchCount,
    };
}

function isReviewedLearnedBackboneStatus(status: string | null | undefined): boolean {
    return LEARNED_BACKBONE_REVIEWED_APPROVAL_STATUSES.has(compact(status).toLowerCase());
}

function normalizeWarningList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map((entry) => compact(entry)).filter(Boolean)
        : [];
}

function isLearnedWorkerName(value: unknown): boolean {
    return compact(value) === "learned_symbolic";
}

function loadLearnedProposalWarningSamples(manifest: JobManifest): LearnedProposalWarningSample[] {
    const samples = new Map<string, LearnedProposalWarningSample>();
    const index = readJsonIfExists<StructureCandidateIndex>(structureCandidateIndexPath(manifest.songId));
    const manifestProposalEvidence = (manifest as JobManifest & {
        proposalEvidence?: {
            worker?: string;
            normalizationWarnings?: unknown;
        };
    }).proposalEvidence;

    if (index) {
        for (const entry of index.entries) {
            if (compact(entry.stage) && compact(entry.stage) !== "structure") {
                continue;
            }

            const candidateManifest = readJsonIfExists<StructureCandidateManifest>(
                entry.manifestPath || structureCandidateManifestPath(manifest.songId, entry.candidateId),
            );
            const proposalEvidence = candidateManifest?.proposalEvidence ?? entry.proposalEvidence;
            const worker = compact(proposalEvidence?.worker)
                || compact(candidateManifest?.worker)
                || compact(entry.worker);
            if (!isLearnedWorkerName(worker)) {
                continue;
            }

            samples.set(entry.candidateId, {
                songId: manifest.songId,
                proposalId: entry.candidateId,
                updatedAt: compact(candidateManifest?.selectedAt)
                    || compact(candidateManifest?.evaluatedAt)
                    || compact(entry.evaluatedAt)
                    || manifest.updatedAt,
                warnings: normalizeWarningList(proposalEvidence?.normalizationWarnings),
            });
        }
    }

    if (samples.size === 0 && isLearnedWorkerName(manifestProposalEvidence?.worker)) {
        samples.set(manifest.songId, {
            songId: manifest.songId,
            proposalId: manifest.songId,
            updatedAt: manifest.updatedAt,
            warnings: normalizeWarningList(manifestProposalEvidence?.normalizationWarnings),
        });
    }

    return Array.from(samples.values());
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
    const shortlist = resolveShadowRerankerShortlist(index);
    const promotion = candidateManifest?.rerankerPromotion ?? index.rerankerPromotion ?? null;
    const detectedPromotionLane = candidateManifest?.executionPlan
        ? detectStructureRerankerPromotionLane(
            candidateManifest.executionPlan,
            candidateManifest.compositionPlan,
            candidateManifest.compositionPlan?.instrumentation,
        )
        : null;
    const heuristicTopCandidateId = compact(score?.disagreement.heuristicTopCandidateId)
        || shortlist?.heuristicTopCandidateId
        || null;
    const learnedTopCandidateId = compact(score?.disagreement.learnedTopCandidateId)
        || shortlist?.learnedTopCandidateId
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
        heuristicTopCandidateId,
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
        shortlistTopK: shortlist?.topK ?? null,
        shortlistedCandidateIds: shortlist?.shortlistedCandidateIds ?? [],
        selectedRank: shortlist?.selectedRank ?? null,
        selectedInShortlist: shortlist?.selectedInShortlist ?? false,
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

function buildLearnedBackboneBenchmarkRunRow(
    manifest: JobManifest,
    benchmarkPackVersion = LEARNED_BACKBONE_BENCHMARK_PACK_VERSION,
    lane = LEARNED_BACKBONE_BENCHMARK_LANE,
): LearnedBackboneBenchmarkRunRow | null {
    const index = readJsonIfExists<StructureCandidateIndex>(structureCandidateIndexPath(manifest.songId));
    if (!index) {
        return null;
    }

    const entryRecords = index.entries
        .filter((entry) => entry.stage === "structure")
        .map((entry) => {
            const candidateManifest = readJsonIfExists<StructureCandidateManifest>(
                entry.manifestPath || structureCandidateManifestPath(manifest.songId, entry.candidateId),
            );
            return {
                entry,
                candidateManifest,
                proposalEvidence: candidateManifest?.proposalEvidence ?? entry.proposalEvidence ?? null,
            };
        });
    const selectedEntry = resolveSelectedStructureCandidateEntry(index);
    const selectedRecord = selectedEntry
        ? entryRecords.find((record) => record.entry.candidateId === selectedEntry.candidateId) ?? null
        : null;
    const manifestProposalEvidence = (manifest as JobManifest & { proposalEvidence?: unknown }).proposalEvidence ?? null;
    const selectedMatches = hasLearnedBackboneBenchmarkEvidence(selectedRecord?.proposalEvidence, benchmarkPackVersion, lane);
    const benchmarkRecords = entryRecords.filter((record) => hasLearnedBackboneBenchmarkEvidence(record.proposalEvidence, benchmarkPackVersion, lane));
    const manifestMatches = hasLearnedBackboneBenchmarkEvidence(manifestProposalEvidence, benchmarkPackVersion, lane);

    if (!manifestMatches && benchmarkRecords.length === 0 && !selectedMatches) {
        return null;
    }

    const benchmarkEvidence = ((selectedMatches
        ? selectedRecord?.proposalEvidence
        : benchmarkRecords[0]?.proposalEvidence) ?? manifestProposalEvidence) as Record<string, unknown> | null;
    const benchmarkCandidateManifests = benchmarkRecords
        .map((record) => record.candidateManifest)
        .filter((candidateManifest): candidateManifest is StructureCandidateManifest => Boolean(candidateManifest));
    const selectedCandidateManifest = selectedRecord?.candidateManifest ?? null;
    const selectedAttempt = [
        index.selectedAttempt,
        selectedRecord?.entry.attempt,
        selectedCandidateManifest?.attempt,
        manifest.qualityControl?.selectedAttempt,
    ].find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? null;
    const selectedAttemptRecords = selectedAttempt === null
        ? entryRecords
        : entryRecords.filter((record) => {
            const attempt = typeof record.entry.attempt === "number" && Number.isFinite(record.entry.attempt)
                ? record.entry.attempt
                : typeof record.candidateManifest?.attempt === "number" && Number.isFinite(record.candidateManifest.attempt)
                    ? record.candidateManifest.attempt
                    : null;
            return attempt === selectedAttempt;
        });
    const activeAttemptRecords = selectedAttemptRecords.length > 0 ? selectedAttemptRecords : entryRecords;
    const pairedWorkers = new Set(
        activeAttemptRecords
            .map((record) => compact(record.entry.worker) || compact(record.candidateManifest?.worker))
            .filter(Boolean),
    );
    const candidateWorkers = [...pairedWorkers].sort((left, right) => left.localeCompare(right));
    const selectedWorker = compact(selectedRecord?.entry.worker)
        || compact(selectedCandidateManifest?.worker)
        || compact(benchmarkEvidence?.worker)
        || "unknown";
    const approvalStatus = compact(manifest.approvalStatus) || "not_reviewed";
    const reviewFeedback = manifest.reviewFeedback as (typeof manifest.reviewFeedback & { reviewRubric?: string }) | undefined;
    const appealScore = typeof reviewFeedback?.appealScore === "number" && Number.isFinite(reviewFeedback.appealScore)
        ? reviewFeedback.appealScore
        : null;
    const observedAt = compact(selectedRecord?.entry.evaluatedAt)
        || compact(selectedCandidateManifest?.evaluatedAt)
        || manifest.updatedAt
        || new Date(0).toISOString();
    const pairedRun = pairedWorkers.has("learned_symbolic") && pairedWorkers.has("music21");
    const disagreementObserved = entryRecords.some(
        (record) => record.entry.shadowReranker?.disagreesWithHeuristic === true
            || record.candidateManifest?.shadowReranker?.disagreesWithHeuristic === true,
    ) || Boolean(index.rerankerPromotion);
    const promotionApplied = Boolean(index.rerankerPromotion);
    const selectionStopReason = compact(index.selectionStopReason)
        || compact((manifest as JobManifest & { qualityControl?: { stopReason?: string } }).qualityControl?.stopReason)
        || null;
    const counterfactualWorker = pairedRun
        ? candidateWorkers.find((worker) => worker !== selectedWorker) ?? null
        : null;
    const selectionMode: LearnedBackboneBenchmarkRunRow["selectionMode"] = !pairedRun
        ? "single_worker"
        : selectedWorker === "learned_symbolic"
            ? (promotionApplied ? "promoted_learned" : "learned_selected")
            : "baseline_selected";
    const { wholePieceCandidateCount, localizedRewriteBranchCount } = classifySameAttemptSearchBudgetCounts(activeAttemptRecords);
    const searchBudgetLevel = classifyLearnedBackboneSearchBudget(wholePieceCandidateCount, localizedRewriteBranchCount);
    const searchBudgetDescriptor = describeLearnedBackboneSearchBudget(
        searchBudgetLevel,
        wholePieceCandidateCount,
        localizedRewriteBranchCount,
    );
    const shortlist = resolveShadowRerankerShortlist(index);

    return {
        songId: manifest.songId,
        benchmarkPackVersion: compact(benchmarkEvidence?.benchmarkPackVersion) || benchmarkPackVersion,
        benchmarkId: compact(benchmarkEvidence?.benchmarkId) || null,
        planSignature: compact(benchmarkEvidence?.planSignature) || null,
        lane: compact(benchmarkEvidence?.lane) || lane,
        promptPackVersion: compact(benchmarkEvidence?.promptPackVersion) || null,
        reviewRubricVersion: compact(reviewFeedback?.reviewRubricVersion) || compact(reviewFeedback?.reviewRubric) || null,
        workflow: compact(manifest.meta.workflow) || compact(selectedRecord?.entry.workflow) || null,
        selectedWorker,
        approvalStatus,
        reviewed: isReviewedLearnedBackboneStatus(approvalStatus),
        appealScore,
        pairedRun,
        candidateWorkers,
        counterfactualWorker,
        retryLocalization: classifyLearnedBackboneRetryLocalization(selectedCandidateManifest?.revisionDirectives),
        benchmarkGenerationMode: compact(benchmarkEvidence?.generationMode) || null,
        selectedGenerationMode: compact(selectedCandidateManifest?.proposalEvidence?.generationMode)
            || compact(selectedRecord?.entry.proposalEvidence?.generationMode)
            || compact(selectedRecord?.proposalEvidence?.generationMode)
            || null,
        disagreementObserved,
        promotionApplied,
        selectionMode,
        selectionStopReason,
        reviewWeakestDimension: compact(reviewFeedback?.weakestDimension) || null,
        observedAt,
        wholePieceCandidateCount,
        localizedRewriteBranchCount,
        searchBudgetLevel,
        searchBudgetDescriptor,
        shortlistTopK: shortlist?.topK ?? null,
        selectedRank: shortlist?.selectedRank ?? null,
        selectedInShortlist: shortlist?.selectedInShortlist === true,
    };
}

function summarizeLearnedBackboneApprovalRate(rows: LearnedBackboneBenchmarkRunRow[]): number | null {
    const reviewedRows = rows.filter((row) => row.reviewed);
    if (reviewedRows.length === 0) {
        return null;
    }

    return optionalRatio(reviewedRows.filter((row) => row.approvalStatus === "approved").length, reviewedRows.length);
}

function summarizeLearnedBackboneWorkerOutcomes(
    rows: LearnedBackboneBenchmarkRunRow[],
): Record<string, ManifestLearnedBackboneBenchmarkWorkerOutcomeSummary> {
    const grouped = new Map<string, LearnedBackboneBenchmarkRunRow[]>();
    for (const row of rows) {
        const worker = compact(row.selectedWorker) || "unknown";
        const bucket = grouped.get(worker) ?? [];
        bucket.push(row);
        grouped.set(worker, bucket);
    }

    const result: Record<string, ManifestLearnedBackboneBenchmarkWorkerOutcomeSummary> = {};
    for (const [worker, workerRows] of grouped.entries()) {
        const reviewedRows = workerRows.filter((row) => row.reviewed);
        result[worker] = {
            runCount: workerRows.length,
            reviewedRunCount: reviewedRows.length,
            pendingReviewCount: workerRows.filter((row) => row.approvalStatus === "pending").length,
            approvedCount: reviewedRows.filter((row) => row.approvalStatus === "approved").length,
            rejectedCount: reviewedRows.filter((row) => row.approvalStatus === "rejected").length,
            approvalRate: summarizeLearnedBackboneApprovalRate(workerRows),
            averageAppealScore: averageOptionalNumbers(reviewedRows.map((row) => row.appealScore)),
        };
    }

    return result;
}

function summarizeLearnedBackboneReviewSampleStatus(
    reviewedRunCount: number,
    reviewedDisagreementCount: number,
): ManifestLearnedBackboneBenchmarkReviewSampleStatus {
    const remainingReviewedRunCountForScreening = Math.max(0, LEARNED_BACKBONE_EARLY_SCREENING_MIN_REVIEWED_RUNS - reviewedRunCount);
    const remainingReviewedRunCountForPromotion = Math.max(0, LEARNED_BACKBONE_PROMOTION_RECOMMENDED_MIN_REVIEWED_RUNS - reviewedRunCount);
    const remainingReviewedDisagreementCountForPromotion = Math.max(0, LEARNED_BACKBONE_PROMOTION_RECOMMENDED_MIN_DISAGREEMENT_RUNS - reviewedDisagreementCount);
    const meetsEarlyScreeningMinimum = reviewedRunCount >= LEARNED_BACKBONE_EARLY_SCREENING_MIN_REVIEWED_RUNS;
    const meetsPromotionReviewedMinimum = reviewedRunCount >= LEARNED_BACKBONE_PROMOTION_RECOMMENDED_MIN_REVIEWED_RUNS;
    const meetsPromotionDisagreementMinimum = reviewedDisagreementCount >= LEARNED_BACKBONE_PROMOTION_RECOMMENDED_MIN_DISAGREEMENT_RUNS;
    const status = meetsPromotionReviewedMinimum && meetsPromotionDisagreementMinimum
        ? "promotion_sample_ready"
        : meetsEarlyScreeningMinimum
            ? "screening_ready"
            : "directional_only";

    return {
        status,
        directionalOnly: status === "directional_only",
        reviewedRunCount,
        reviewedDisagreementCount,
        minimumReviewedRunCountForScreening: LEARNED_BACKBONE_EARLY_SCREENING_MIN_REVIEWED_RUNS,
        minimumReviewedRunCountForPromotion: LEARNED_BACKBONE_PROMOTION_RECOMMENDED_MIN_REVIEWED_RUNS,
        minimumReviewedDisagreementCountForPromotion: LEARNED_BACKBONE_PROMOTION_RECOMMENDED_MIN_DISAGREEMENT_RUNS,
        remainingReviewedRunCountForScreening,
        remainingReviewedRunCountForPromotion,
        remainingReviewedDisagreementCountForPromotion,
        meetsEarlyScreeningMinimum,
        meetsPromotionReviewedMinimum,
        meetsPromotionDisagreementMinimum,
    };
}

function summarizeLearnedBackboneRetryLocalizationStability(
    rows: LearnedBackboneBenchmarkRunRow[],
): ManifestLearnedBackboneBenchmarkRetryLocalizationStability {
    const retryingRows = rows.filter((row) => row.retryLocalization !== "none");
    const sectionTargetedOnlyCount = retryingRows.filter((row) => row.retryLocalization === "section_targeted").length;
    const mixedCount = retryingRows.filter((row) => row.retryLocalization === "mixed").length;
    const globalOnlyCount = retryingRows.filter((row) => row.retryLocalization === "global").length;
    const sectionTargetedRate = optionalRatio(sectionTargetedOnlyCount, retryingRows.length);
    const driftRate = optionalRatio(mixedCount + globalOnlyCount, retryingRows.length);
    const status = retryingRows.length === 0
        ? "not_enough_retry_data"
        : (sectionTargetedRate ?? 0) >= 0.75 && (driftRate ?? 0) <= 0.25
            ? "stable"
            : "drifting";

    return {
        retryingRunCount: retryingRows.length,
        sectionTargetedOnlyCount,
        mixedCount,
        globalOnlyCount,
        sectionTargetedRate,
        driftRate,
        status,
    };
}

function summarizeLearnedBackboneBlindPreferenceFromEvaluations(
    evaluations: LearnedBackboneBlindReviewResolvedEvaluation[],
    matchedPackCount: number,
    unavailableReason: string,
): ManifestLearnedBackboneBenchmarkBlindPreferenceSummary {
    let reviewedPairCount = 0;
    let decisivePairCount = 0;
    let learnedWinCount = 0;
    let baselineWinCount = 0;
    let tieCount = 0;
    let latestReviewedAt: string | null = null;

    for (const evaluation of evaluations) {
        if (evaluation.reviewedAt && (!latestReviewedAt || evaluation.reviewedAt.localeCompare(latestReviewedAt) > 0)) {
            latestReviewedAt = evaluation.reviewedAt;
        }
        if (evaluation.winnerLabel === "TIE") {
            reviewedPairCount += 1;
            tieCount += 1;
            continue;
        }

        const winnerSide = resolveLearnedBackboneBlindReviewWinnerSide(evaluation);
        if (!winnerSide) {
            continue;
        }

        reviewedPairCount += 1;
        decisivePairCount += 1;
        if (winnerSide === "learned") {
            learnedWinCount += 1;
        } else {
            baselineWinCount += 1;
        }
    }

    if (decisivePairCount > 0) {
        return {
            available: true,
            winRate: optionalRatio(learnedWinCount, decisivePairCount),
            reviewedPairCount,
            decisivePairCount,
            learnedWinCount,
            baselineWinCount,
            tieCount,
            latestReviewedAt,
            reason: `computed from ${decisivePairCount} decisive blind pair reviews across ${matchedPackCount} pack(s)`,
        };
    }

    return {
        available: false,
        winRate: null,
        reviewedPairCount,
        decisivePairCount,
        learnedWinCount,
        baselineWinCount,
        tieCount,
        latestReviewedAt,
        reason: unavailableReason,
    };
}

function summarizeLearnedBackboneBlindPreference(
    benchmarkPackVersion = LEARNED_BACKBONE_BENCHMARK_PACK_VERSION,
    lane = LEARNED_BACKBONE_BENCHMARK_LANE,
): ManifestLearnedBackboneBenchmarkBlindPreferenceSummary {
    const { matchedPackCount, evaluations } = collectLearnedBackboneBlindReviewEvaluations(benchmarkPackVersion, lane);
    return summarizeLearnedBackboneBlindPreferenceFromEvaluations(
        evaluations,
        matchedPackCount,
        matchedPackCount === 0
            ? "no learned backbone blind review packs found under outputs/_system/ml/review-packs/learned-backbone"
            : reviewedPairCountReason(evaluations),
    );
}

function reviewedPairCountReason(evaluations: LearnedBackboneBlindReviewResolvedEvaluation[]): string {
    return evaluations.length > 0
        ? "blind review results only contain ties or skipped entries so far"
        : "no completed blind review results found for learned backbone benchmark pairs";
}

function shortlistedBlindReviewReason(evaluations: LearnedBackboneBlindReviewResolvedEvaluation[]): string {
    return evaluations.length > 0
        ? "shortlist-qualified blind review results only contain ties or skipped entries so far"
        : "no completed blind review results found for shortlist-qualified learned backbone benchmark pairs";
}

function summarizeLearnedBackboneShortlistBlindPreference(
    rows: LearnedBackboneBenchmarkRunRow[],
    evaluations: LearnedBackboneBlindReviewResolvedEvaluation[],
    matchedPackCount: number,
): ManifestLearnedBackboneBenchmarkBlindPreferenceSummary {
    const shortlistedSongIds = new Set(
        rows
            .filter((row) => row.selectedInShortlist)
            .map((row) => row.songId),
    );
    const shortlistedEvaluations = evaluations.filter(
        (evaluation) => evaluation.songId && shortlistedSongIds.has(evaluation.songId),
    );

    return summarizeLearnedBackboneBlindPreferenceFromEvaluations(
        shortlistedEvaluations,
        matchedPackCount,
        shortlistedBlindReviewReason(shortlistedEvaluations),
    );
}

function summarizeLearnedBackboneReviewedTop1AccuracyFromEvaluations(
    evaluations: LearnedBackboneBlindReviewResolvedEvaluation[],
    matchedPackCount: number,
    unavailableReason: string,
): ManifestLearnedBackboneBenchmarkReviewedTop1AccuracySummary {
    let decisiveReviewedPairCount = 0;
    let correctSelectionCount = 0;
    let learnedSelectedReviewedPairCount = 0;
    let learnedCorrectSelectionCount = 0;
    let baselineSelectedReviewedPairCount = 0;
    let baselineCorrectSelectionCount = 0;
    let promotedReviewedPairCount = 0;
    let promotedCorrectSelectionCount = 0;
    let latestReviewedAt: string | null = null;

    for (const evaluation of evaluations) {
        if (evaluation.reviewedAt && (!latestReviewedAt || evaluation.reviewedAt.localeCompare(latestReviewedAt) > 0)) {
            latestReviewedAt = evaluation.reviewedAt;
        }

        const selectedSide = resolveLearnedBackboneBlindReviewSelectedSide(evaluation);
        const winnerSide = resolveLearnedBackboneBlindReviewWinnerSide(evaluation);
        if (!selectedSide || !winnerSide) {
            continue;
        }

        decisiveReviewedPairCount += 1;
        const correct = selectedSide === winnerSide;
        if (correct) {
            correctSelectionCount += 1;
        }

        if (selectedSide === "learned") {
            learnedSelectedReviewedPairCount += 1;
            if (correct) {
                learnedCorrectSelectionCount += 1;
            }
        } else {
            baselineSelectedReviewedPairCount += 1;
            if (correct) {
                baselineCorrectSelectionCount += 1;
            }
        }

        if (evaluation.selectionMode === "promoted_learned") {
            promotedReviewedPairCount += 1;
            if (correct) {
                promotedCorrectSelectionCount += 1;
            }
        }
    }

    if (decisiveReviewedPairCount === 0) {
        return {
            available: false,
            decisiveReviewedPairCount,
            correctSelectionCount,
            selectedTop1Accuracy: null,
            learnedSelectedReviewedPairCount,
            learnedCorrectSelectionCount,
            learnedSelectedTop1Accuracy: null,
            baselineSelectedReviewedPairCount,
            baselineCorrectSelectionCount,
            baselineSelectedTop1Accuracy: null,
            promotedReviewedPairCount,
            promotedCorrectSelectionCount,
            promotedTop1Accuracy: null,
            latestReviewedAt,
            reason: unavailableReason,
        };
    }

    return {
        available: true,
        decisiveReviewedPairCount,
        correctSelectionCount,
        selectedTop1Accuracy: optionalRatio(correctSelectionCount, decisiveReviewedPairCount),
        learnedSelectedReviewedPairCount,
        learnedCorrectSelectionCount,
        learnedSelectedTop1Accuracy: optionalRatio(learnedCorrectSelectionCount, learnedSelectedReviewedPairCount),
        baselineSelectedReviewedPairCount,
        baselineCorrectSelectionCount,
        baselineSelectedTop1Accuracy: optionalRatio(baselineCorrectSelectionCount, baselineSelectedReviewedPairCount),
        promotedReviewedPairCount,
        promotedCorrectSelectionCount,
        promotedTop1Accuracy: optionalRatio(promotedCorrectSelectionCount, promotedReviewedPairCount),
        latestReviewedAt,
        reason: `computed from ${decisiveReviewedPairCount} decisive blind pair reviews across ${matchedPackCount} pack(s)`,
    };
}

function summarizeLearnedBackboneReviewedTop1Accuracy(
    benchmarkPackVersion = LEARNED_BACKBONE_BENCHMARK_PACK_VERSION,
    lane = LEARNED_BACKBONE_BENCHMARK_LANE,
): ManifestLearnedBackboneBenchmarkReviewedTop1AccuracySummary {
    const { matchedPackCount, evaluations } = collectLearnedBackboneBlindReviewEvaluations(benchmarkPackVersion, lane);
    return summarizeLearnedBackboneReviewedTop1AccuracyFromEvaluations(
        evaluations,
        matchedPackCount,
        matchedPackCount === 0
            ? "no learned backbone blind review packs found under outputs/_system/ml/review-packs/learned-backbone"
            : "blind review results only contain ties, skipped entries, or unmatched selection labels so reviewed top-1 accuracy is not yet available",
    );
}

function summarizeLearnedBackboneReviewQueue(
    rows: LearnedBackboneBenchmarkRunRow[],
    evaluations: LearnedBackboneBlindReviewResolvedEvaluation[],
): ManifestLearnedBackboneBenchmarkReviewQueueSummary {
    const reviewedSongIds = new Set(
        evaluations
            .map((evaluation) => compact(evaluation.songId))
            .filter((songId): songId is string => Boolean(songId)),
    );
    const pendingRows = rows.filter((row) => row.pairedRun && !reviewedSongIds.has(row.songId));

    return {
        pendingBlindReviewCount: pendingRows.length,
        pendingShortlistReviewCount: pendingRows.filter((row) => row.selectedInShortlist).length,
        latestPendingAt: pendingRows
            .map((row) => row.observedAt)
            .sort((left, right) => right.localeCompare(left))[0] ?? null,
        recentPendingRows: [...pendingRows]
            .sort(
                (left, right) => Number(right.selectedInShortlist) - Number(left.selectedInShortlist)
                    || right.observedAt.localeCompare(left.observedAt)
                    || left.songId.localeCompare(right.songId),
            )
            .slice(0, 10)
            .map((row) => ({
                songId: row.songId,
                benchmarkId: row.benchmarkId,
                planSignature: row.planSignature,
                reviewTarget: row.selectedInShortlist ? "shortlist" : "pairwise",
                selectedWorker: row.selectedWorker,
                counterfactualWorker: row.counterfactualWorker,
                selectionMode: row.selectionMode,
                observedAt: row.observedAt,
                wholePieceCandidateCount: row.wholePieceCandidateCount,
                localizedRewriteBranchCount: row.localizedRewriteBranchCount,
                searchBudgetLevel: row.searchBudgetLevel,
                searchBudgetDescriptor: row.searchBudgetDescriptor,
                shortlistTopK: row.shortlistTopK,
                selectedRank: row.selectedRank,
                selectedInShortlist: row.selectedInShortlist,
            })),
    };
}

function summarizeLearnedBackboneReviewPacks(
    rows: ManifestLearnedBackboneBenchmarkReviewPackRow[],
): ManifestLearnedBackboneBenchmarkReviewPackSummary {
    const activeRows = rows.filter((row) => row.pendingDecisionCount > 0);

    return {
        matchedPackCount: rows.length,
        activePackCount: activeRows.length,
        pendingDecisionCount: rows.reduce((sum, row) => sum + row.pendingDecisionCount, 0),
        completedDecisionCount: rows.reduce((sum, row) => sum + row.completedDecisionCount, 0),
        latestGeneratedAt: rows
            .map((row) => row.generatedAt)
            .filter((value): value is string => Boolean(value))
            .sort((left, right) => right.localeCompare(left))[0] ?? null,
        latestReviewedAt: rows
            .map((row) => row.latestReviewedAt)
            .filter((value): value is string => Boolean(value))
            .sort((left, right) => right.localeCompare(left))[0] ?? null,
        recentActivePacks: [...activeRows]
            .sort(
                (left, right) => right.pendingDecisionCount - left.pendingDecisionCount
                    || (right.generatedAt ?? "").localeCompare(left.generatedAt ?? "")
                    || left.packId.localeCompare(right.packId),
            )
            .slice(0, 5),
    };
}

function summarizeLearnedBackboneSearchBudgetRows(
    rows: LearnedBackboneBenchmarkRunRow[],
    evaluations: LearnedBackboneBlindReviewResolvedEvaluation[],
    matchedPackCount: number,
): ManifestLearnedBackboneBenchmarkSearchBudgetRow[] {
    const grouped = new Map<string, LearnedBackboneBenchmarkRunRow[]>();
    for (const row of rows) {
        const key = `${row.searchBudgetLevel}:${row.wholePieceCandidateCount}:${row.localizedRewriteBranchCount}`;
        const bucket = grouped.get(key) ?? [];
        bucket.push(row);
        grouped.set(key, bucket);
    }

    return [...grouped.values()]
        .map((groupRows) => {
            const songIds = new Set(groupRows.map((row) => row.songId));
            const budgetEvaluations = evaluations.filter((evaluation) => evaluation.songId && songIds.has(evaluation.songId));
            const blindPreference = summarizeLearnedBackboneBlindPreferenceFromEvaluations(
                budgetEvaluations,
                matchedPackCount,
                budgetEvaluations.length > 0
                    ? "blind review results only contain ties or skipped entries so far"
                    : "no completed blind review results found for this search budget bucket",
            );
            const reviewedTop1Accuracy = summarizeLearnedBackboneReviewedTop1AccuracyFromEvaluations(
                budgetEvaluations,
                matchedPackCount,
                budgetEvaluations.length > 0
                    ? "blind review results only contain ties, skipped entries, or unmatched selection labels so reviewed top-1 accuracy is not yet available"
                    : "no completed blind review results found for this search budget bucket",
            );
            const reviewedRows = groupRows.filter((row) => row.reviewed);

            return {
                searchBudgetLevel: groupRows[0]?.searchBudgetLevel ?? "custom",
                searchBudgetDescriptor: groupRows[0]?.searchBudgetDescriptor ?? "custom",
                wholePieceCandidateCount: groupRows[0]?.wholePieceCandidateCount ?? 0,
                localizedRewriteBranchCount: groupRows[0]?.localizedRewriteBranchCount ?? 0,
                runCount: groupRows.length,
                pairedRunCount: groupRows.filter((row) => row.pairedRun).length,
                reviewedRunCount: reviewedRows.length,
                pendingReviewCount: groupRows.filter((row) => row.approvalStatus === "pending").length,
                approvalRate: summarizeLearnedBackboneApprovalRate(groupRows),
                averageAppealScore: averageOptionalNumbers(reviewedRows.map((row) => row.appealScore)),
                blindPreferenceWinRate: blindPreference.winRate,
                reviewedPairCount: blindPreference.reviewedPairCount,
                decisivePairCount: blindPreference.decisivePairCount,
                selectedTop1Accuracy: reviewedTop1Accuracy.selectedTop1Accuracy,
                decisiveReviewedPairCount: reviewedTop1Accuracy.decisiveReviewedPairCount,
                correctSelectionCount: reviewedTop1Accuracy.correctSelectionCount,
                latestObservedAt: groupRows
                    .map((row) => row.observedAt)
                    .sort((left, right) => right.localeCompare(left))[0] ?? null,
            };
        })
        .sort(
            (left, right) => left.wholePieceCandidateCount - right.wholePieceCandidateCount
                || left.localizedRewriteBranchCount - right.localizedRewriteBranchCount
                || left.searchBudgetLevel.localeCompare(right.searchBudgetLevel),
        );
}

function summarizeLearnedBackbonePromotionGate(
    rows: LearnedBackboneBenchmarkRunRow[],
    reviewSampleStatus: ManifestLearnedBackboneBenchmarkReviewSampleStatus,
    retryLocalizationStability: ManifestLearnedBackboneBenchmarkRetryLocalizationStability,
    blindPreference: ManifestLearnedBackboneBenchmarkBlindPreferenceSummary,
    promotionAdvantage: ManifestShadowRerankerPromotionAdvantageSummary,
): ManifestLearnedBackbonePromotionGateSummary {
    const reviewedRows = rows.filter((row) => row.reviewed);
    const reviewedSelectedInShortlistRate = optionalRatio(
        reviewedRows.filter((row) => row.selectedInShortlist).length,
        reviewedRows.length,
    );
    const reviewedSelectedTop1Rate = optionalRatio(
        reviewedRows.filter((row) => row.selectedRank === 1).length,
        reviewedRows.length,
    );
    const meetsReviewedSelectedInShortlistMinimum = typeof reviewedSelectedInShortlistRate === "number"
        && reviewedSelectedInShortlistRate + 0.0001 >= LEARNED_BACKBONE_PROMOTION_MIN_REVIEWED_SELECTED_IN_SHORTLIST_RATE;
    const positiveSignals: string[] = [];
    const negativeSignals: string[] = [];
    const blockers: string[] = [];

    if (typeof blindPreference.winRate === "number") {
        if (blindPreference.winRate > 0.5001) {
            positiveSignals.push("blind_preference");
        } else if (blindPreference.winRate < 0.4999) {
            negativeSignals.push("blind_preference");
        }
    }

    if (typeof promotionAdvantage.approvalRateDelta === "number") {
        if (promotionAdvantage.approvalRateDelta > 0.0001) {
            positiveSignals.push("approval_rate_delta");
        } else if (promotionAdvantage.approvalRateDelta < -0.0001) {
            negativeSignals.push("approval_rate_delta");
        }
    }

    if (typeof promotionAdvantage.appealScoreDelta === "number") {
        if (promotionAdvantage.appealScoreDelta > 0.0001) {
            positiveSignals.push("appeal_score_delta");
        } else if (promotionAdvantage.appealScoreDelta < -0.0001) {
            negativeSignals.push("appeal_score_delta");
        }
    }

    const signal: ManifestLearnedBackbonePromotionGateSummary["signal"] = positiveSignals.length > 0 && negativeSignals.length > 0
        ? "mixed"
        : positiveSignals.length > 0
            ? "positive"
            : negativeSignals.length > 0
                ? "negative"
                : "insufficient_evidence";

    if (!reviewSampleStatus.meetsPromotionReviewedMinimum) {
        blockers.push("reviewed_runs_below_floor");
    }
    if (!reviewSampleStatus.meetsPromotionDisagreementMinimum) {
        blockers.push("reviewed_disagreements_below_floor");
    }
    if (!meetsReviewedSelectedInShortlistMinimum) {
        blockers.push(
            typeof reviewedSelectedInShortlistRate === "number"
                ? "shortlist_quality_below_floor"
                : "shortlist_quality_unavailable",
        );
    }

    const retryLocalizationStable = retryLocalizationStability.status !== "drifting";
    if (!retryLocalizationStable) {
        blockers.push("retry_localization_drifting");
    }
    if (signal === "negative") {
        blockers.push("reviewed_outcomes_favor_baseline");
    } else if (signal === "mixed") {
        blockers.push("reviewed_outcomes_mixed");
    } else if (signal === "insufficient_evidence") {
        blockers.push("no_directional_quality_signal");
    }

    const sampleReady = reviewSampleStatus.meetsPromotionReviewedMinimum
        && reviewSampleStatus.meetsPromotionDisagreementMinimum;
    const status: ManifestLearnedBackbonePromotionGateSummary["status"] = !sampleReady
        ? "experimental"
        : !retryLocalizationStable || signal === "negative" || !meetsReviewedSelectedInShortlistMinimum
            ? "blocked"
            : signal === "positive"
                ? "ready_for_guarded_promotion"
                : "review_hold";

    const rationale = status === "experimental"
        ? `keep learned backbone experimental until at least ${reviewSampleStatus.minimumReviewedRunCountForPromotion} reviewed runs and ${reviewSampleStatus.minimumReviewedDisagreementCountForPromotion} reviewed disagreements accumulate`
        : status === "blocked"
            ? !retryLocalizationStable
                ? "review floor is met, but retry localization is drifting; keep promotion blocked until localized rewrite stability recovers"
                : !meetsReviewedSelectedInShortlistMinimum
                    ? typeof reviewedSelectedInShortlistRate === "number"
                        ? `review floor is met, but reviewed shortlist retention is ${reviewedSelectedInShortlistRate.toFixed(2)} and stays below the ${LEARNED_BACKBONE_PROMOTION_MIN_REVIEWED_SELECTED_IN_SHORTLIST_RATE.toFixed(2)} floor; keep promotion blocked until selected winners stay inside the shortlist more reliably`
                        : "review floor is met, but reviewed shortlist quality is not available yet; keep promotion blocked until shortlist placement is observable on reviewed runs"
                    : "review floor is met, but current blind preference or reviewed deltas still favor baseline selection"
            : status === "ready_for_guarded_promotion"
                ? "review floor is met, reviewed shortlist quality clears the floor, retry localization is stable, and current blind preference or reviewed deltas support guarded promotion"
                : "review floor is met and reviewed shortlist quality is acceptable, but reviewed comparative signals are still mixed; hold promotion until the lane shows a cleaner winner";

    return {
        status,
        signal,
        minimumReviewedRunCount: reviewSampleStatus.minimumReviewedRunCountForPromotion,
        minimumReviewedDisagreementCount: reviewSampleStatus.minimumReviewedDisagreementCountForPromotion,
        minimumReviewedSelectedInShortlistRate: LEARNED_BACKBONE_PROMOTION_MIN_REVIEWED_SELECTED_IN_SHORTLIST_RATE,
        meetsReviewedRunMinimum: reviewSampleStatus.meetsPromotionReviewedMinimum,
        meetsReviewedDisagreementMinimum: reviewSampleStatus.meetsPromotionDisagreementMinimum,
        meetsReviewedSelectedInShortlistMinimum,
        retryLocalizationStable,
        blindPreferenceAvailable: blindPreference.available,
        blindPreferenceWinRate: blindPreference.winRate,
        reviewedSelectedInShortlistRate,
        reviewedSelectedTop1Rate,
        approvalRateDelta: promotionAdvantage.approvalRateDelta,
        appealScoreDelta: promotionAdvantage.appealScoreDelta,
        positiveSignals,
        negativeSignals,
        blockers,
        rationale,
    };
}

function summarizeLearnedBackboneFailureModes(
    rows: LearnedBackboneBenchmarkRunRow[],
): ManifestLearnedBackboneBenchmarkFailureModeRow[] {
    const counts: Record<string, number> = {};
    for (const row of rows) {
        if (!row.reviewed || row.approvalStatus !== "rejected") {
            continue;
        }
        incrementNamedCount(counts, row.reviewWeakestDimension || row.selectedGenerationMode || "review_rejected_unlabeled");
    }

    return Object.entries(counts)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 5)
        .map(([failureMode, count]) => ({ failureMode, count }));
}

function summarizeLearnedBackboneStopReasons(
    rows: LearnedBackboneBenchmarkRunRow[],
): ManifestLearnedBackboneBenchmarkStopReasonRow[] {
    const counts: Record<string, number> = {};
    for (const row of rows) {
        if (!row.selectionStopReason) {
            continue;
        }
        incrementNamedCount(counts, row.selectionStopReason);
    }

    return Object.entries(counts)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count }));
}

function buildLearnedBackboneCoverageRows(
    rows: LearnedBackboneBenchmarkRunRow[],
): ManifestLearnedBackboneBenchmarkCoverageRow[] {
    const groups = new Map<string, LearnedBackboneBenchmarkRunRow[]>();
    for (const row of rows) {
        const key = compact(row.benchmarkId) || compact(row.planSignature) || "unknown";
        const bucket = groups.get(key) ?? [];
        bucket.push(row);
        groups.set(key, bucket);
    }

    return [...groups.entries()]
        .map(([benchmarkKey, groupRows]) => {
            const selectedWorkerCounts: Record<string, number> = {};
            const generationModeCounts: Record<string, number> = {};
            for (const row of groupRows) {
                incrementNamedCount(selectedWorkerCounts, row.selectedWorker);
                if (row.benchmarkGenerationMode) {
                    incrementNamedCount(generationModeCounts, row.benchmarkGenerationMode);
                }
            }

            return {
                benchmarkKey,
                benchmarkId: groupRows[0]?.benchmarkId ?? null,
                planSignature: groupRows[0]?.planSignature ?? null,
                lane: groupRows[0]?.lane ?? LEARNED_BACKBONE_BENCHMARK_LANE,
                benchmarkPackVersion: groupRows[0]?.benchmarkPackVersion ?? LEARNED_BACKBONE_BENCHMARK_PACK_VERSION,
                runCount: groupRows.length,
                pairedRunCount: groupRows.filter((row) => row.pairedRun).length,
                reviewedRunCount: groupRows.filter((row) => row.reviewed).length,
                pendingReviewCount: groupRows.filter((row) => row.approvalStatus === "pending").length,
                approvalRate: summarizeLearnedBackboneApprovalRate(groupRows),
                averageAppealScore: averageOptionalNumbers(groupRows.filter((row) => row.reviewed).map((row) => row.appealScore)),
                selectedWorkerCounts,
                generationModeCounts,
                latestObservedAt: groupRows
                    .map((row) => row.observedAt)
                    .sort((left, right) => right.localeCompare(left))[0] ?? null,
                songIds: groupRows
                    .map((row) => row.songId)
                    .sort((left, right) => left.localeCompare(right)),
            };
        })
        .sort((left, right) => right.runCount - left.runCount || left.benchmarkKey.localeCompare(right.benchmarkKey));
}

function deriveLearnedBackbonePromotionAdvantage(
    outcomes: ManifestLearnedBackboneBenchmarkPairedSelectionOutcomeSummary,
): ManifestShadowRerankerPromotionAdvantageSummary {
    const approvalRateDelta = typeof outcomes.promotedApprovalRate === "number" && typeof outcomes.heuristicApprovalRate === "number"
        ? roundMetric(outcomes.promotedApprovalRate - outcomes.heuristicApprovalRate)
        : null;
    const appealScoreDelta = typeof outcomes.promotedAverageAppealScore === "number" && typeof outcomes.heuristicAverageAppealScore === "number"
        ? roundMetric(outcomes.promotedAverageAppealScore - outcomes.heuristicAverageAppealScore)
        : null;
    const sufficientReviewSample = outcomes.reviewedManifestCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED
        && outcomes.promotedReviewedCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT
        && outcomes.heuristicReviewedCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT;
    const availableDeltas = [approvalRateDelta, appealScoreDelta]
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const positive = availableDeltas.some((value) => value > 0.0001);
    const negative = availableDeltas.some((value) => value < -0.0001);

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
        signal: !sufficientReviewSample || availableDeltas.length === 0
            ? "insufficient_data"
            : positive && negative
                ? "mixed"
                : positive
                    ? "promoted_advantage"
                    : negative
                        ? "heuristic_advantage"
                        : "parity",
    };
}

export function summarizeLearnedBackboneBenchmark(
    manifests: JobManifest[],
    benchmarkPackVersion = LEARNED_BACKBONE_BENCHMARK_PACK_VERSION,
    lane = LEARNED_BACKBONE_BENCHMARK_LANE,
): ManifestLearnedBackboneBenchmarkSummary {
    const rows = manifests
        .map((manifest) => buildLearnedBackboneBenchmarkRunRow(manifest, benchmarkPackVersion, lane))
        .filter((row): row is LearnedBackboneBenchmarkRunRow => Boolean(row));
    const selectedWorkerCounts: Record<string, number> = {};
    const workflowCounts: Record<string, number> = {};
    const promptPackVersionCounts: Record<string, number> = {};
    const reviewRubricVersionCounts: Record<string, number> = {};
    const generationModeCounts: Record<string, number> = {};
    const selectionModeCounts: Record<string, number> = {};
    const searchBudgetCounts: Record<string, number> = {};
    const benchmarkIds = new Set<string>();

    for (const row of rows) {
        incrementNamedCount(selectedWorkerCounts, row.selectedWorker);
        if (row.workflow) {
            incrementNamedCount(workflowCounts, row.workflow);
        }
        if (row.promptPackVersion) {
            incrementNamedCount(promptPackVersionCounts, row.promptPackVersion);
        }
        if (row.reviewRubricVersion) {
            incrementNamedCount(reviewRubricVersionCounts, row.reviewRubricVersion);
        }
        if (row.benchmarkGenerationMode) {
            incrementNamedCount(generationModeCounts, row.benchmarkGenerationMode);
        }
        incrementNamedCount(selectionModeCounts, row.selectionMode);
        incrementNamedCount(searchBudgetCounts, row.searchBudgetLevel);
        if (row.benchmarkId) {
            benchmarkIds.add(row.benchmarkId);
        }
    }

    const reviewedRows = rows.filter((row) => row.reviewed);
    const pairedRows = rows.filter((row) => row.pairedRun);
    const disagreementRows = pairedRows.filter((row) => row.disagreementObserved);
    const reviewedDisagreementRows = disagreementRows.filter((row) => row.reviewed);
    const promotedRows = pairedRows.filter((row) => row.selectedWorker === "learned_symbolic");
    const heuristicRows = pairedRows.filter((row) => row.selectedWorker === "music21");
    const promotedReviewedRows = promotedRows.filter((row) => row.reviewed);
    const heuristicReviewedRows = heuristicRows.filter((row) => row.reviewed);
    const pairedSelectionOutcomes: ManifestLearnedBackboneBenchmarkPairedSelectionOutcomeSummary = {
        lane,
        benchmarkPackVersion,
        reviewedManifestCount: promotedReviewedRows.length + heuristicReviewedRows.length,
        promotedReviewedCount: promotedReviewedRows.length,
        promotedApprovalRate: summarizeLearnedBackboneApprovalRate(promotedReviewedRows),
        promotedAverageAppealScore: averageOptionalNumbers(promotedReviewedRows.map((row) => row.appealScore)),
        heuristicReviewedCount: heuristicReviewedRows.length,
        heuristicApprovalRate: summarizeLearnedBackboneApprovalRate(heuristicReviewedRows),
        heuristicAverageAppealScore: averageOptionalNumbers(heuristicReviewedRows.map((row) => row.appealScore)),
    };
    const retryingPromotedRows = promotedRows.filter((row) => row.retryLocalization !== "none");
    const retryingHeuristicRows = heuristicRows.filter((row) => row.retryLocalization !== "none");
    const retryLocalizationOutcomes: ManifestShadowRerankerRetryLocalizationSummary = {
        lane,
        scoredManifestCount: pairedRows.length,
        retryingManifestCount: retryingPromotedRows.length + retryingHeuristicRows.length,
        promotedRetryingCount: retryingPromotedRows.length,
        promotedTargetedOnlyCount: retryingPromotedRows.filter((row) => row.retryLocalization === "section_targeted").length,
        promotedMixedCount: retryingPromotedRows.filter((row) => row.retryLocalization === "mixed").length,
        promotedGlobalOnlyCount: retryingPromotedRows.filter((row) => row.retryLocalization === "global").length,
        promotedSectionTargetedRate: optionalRatio(
            retryingPromotedRows.filter((row) => row.retryLocalization === "section_targeted").length,
            retryingPromotedRows.length,
        ),
        heuristicRetryingCount: retryingHeuristicRows.length,
        heuristicTargetedOnlyCount: retryingHeuristicRows.filter((row) => row.retryLocalization === "section_targeted").length,
        heuristicMixedCount: retryingHeuristicRows.filter((row) => row.retryLocalization === "mixed").length,
        heuristicGlobalOnlyCount: retryingHeuristicRows.filter((row) => row.retryLocalization === "global").length,
        heuristicSectionTargetedRate: optionalRatio(
            retryingHeuristicRows.filter((row) => row.retryLocalization === "section_targeted").length,
            retryingHeuristicRows.length,
        ),
    };
    const promotionAdvantage = deriveLearnedBackbonePromotionAdvantage(pairedSelectionOutcomes);
    const blindReview = collectLearnedBackboneBlindReviewEvaluations(benchmarkPackVersion, lane);
    const blindPreference = summarizeLearnedBackboneBlindPreferenceFromEvaluations(
        blindReview.evaluations,
        blindReview.matchedPackCount,
        blindReview.matchedPackCount === 0
            ? "no learned backbone blind review packs found under outputs/_system/ml/review-packs/learned-backbone"
            : reviewedPairCountReason(blindReview.evaluations),
    );
    const shortlistBlindPreference = summarizeLearnedBackboneShortlistBlindPreference(
        rows,
        blindReview.evaluations,
        blindReview.matchedPackCount,
    );
    const reviewedTop1Accuracy = summarizeLearnedBackboneReviewedTop1AccuracyFromEvaluations(
        blindReview.evaluations,
        blindReview.matchedPackCount,
        blindReview.matchedPackCount === 0
            ? "no learned backbone blind review packs found under outputs/_system/ml/review-packs/learned-backbone"
            : "blind review results only contain ties, skipped entries, or unmatched selection labels so reviewed top-1 accuracy is not yet available",
    );
    const reviewSampleStatus = summarizeLearnedBackboneReviewSampleStatus(reviewedRows.length, reviewedDisagreementRows.length);
    const reviewQueue = summarizeLearnedBackboneReviewQueue(rows, blindReview.evaluations);
    const reviewPacks = blindReview.reviewPacks;
    const retryLocalizationStability = summarizeLearnedBackboneRetryLocalizationStability(pairedRows);
    const promotionGate = summarizeLearnedBackbonePromotionGate(
        rows,
        reviewSampleStatus,
        retryLocalizationStability,
        blindPreference,
        promotionAdvantage,
    );
    const searchBudgetRows = summarizeLearnedBackboneSearchBudgetRows(
        rows,
        blindReview.evaluations,
        blindReview.matchedPackCount,
    );

    return {
        lane,
        benchmarkPackVersion,
        configSnapshot: {
            lane,
            benchmarkPackVersion,
            benchmarkIds: [...benchmarkIds].sort((left, right) => left.localeCompare(right)),
            pairedWorkers: ["learned_symbolic", "music21"],
            workflowCounts,
            promptPackVersionCounts,
            reviewRubricVersionCounts,
            generationModeCounts,
        },
        runCount: rows.length,
        pairedRunCount: pairedRows.length,
        reviewedRunCount: reviewedRows.length,
        pendingReviewCount: rows.filter((row) => row.approvalStatus === "pending").length,
        approvalRate: summarizeLearnedBackboneApprovalRate(rows),
        averageAppealScore: averageOptionalNumbers(reviewedRows.map((row) => row.appealScore)),
        blindPreference,
        shortlistBlindPreference,
        reviewedTop1Accuracy,
        promotionGate,
        reviewSampleStatus,
        reviewQueue,
        reviewPacks,
        disagreementSummary: {
            pairedRunCount: pairedRows.length,
            disagreementRunCount: disagreementRows.length,
            reviewedDisagreementCount: reviewedDisagreementRows.length,
            promotionAppliedCount: pairedRows.filter((row) => row.promotionApplied).length,
            learnedSelectedWithoutPromotionCount: pairedRows.filter((row) => row.selectionMode === "learned_selected").length,
            baselineSelectedCount: pairedRows.filter((row) => row.selectionMode === "baseline_selected").length,
        },
        retryLocalizationStability,
        topFailureModes: summarizeLearnedBackboneFailureModes(rows),
        topStopReasons: summarizeLearnedBackboneStopReasons(rows),
        selectedWorkerCounts,
        selectedWorkerOutcomes: summarizeLearnedBackboneWorkerOutcomes(rows),
        workflowCounts,
        promptPackVersionCounts,
        reviewRubricVersionCounts,
        generationModeCounts,
        selectionModeCounts,
        searchBudgetCounts,
        pairedSelectionOutcomes,
        promotionAdvantage,
        retryLocalizationOutcomes,
        coverageRows: buildLearnedBackboneCoverageRows(rows),
        searchBudgetRows,
        recentRunRows: [...rows]
            .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.songId.localeCompare(right.songId))
            .slice(0, 20)
            .map((row) => ({
                songId: row.songId,
                benchmarkId: row.benchmarkId,
                planSignature: row.planSignature,
                selectedWorker: row.selectedWorker,
                approvalStatus: row.approvalStatus,
                reviewed: row.reviewed,
                appealScore: row.appealScore,
                disagreementObserved: row.disagreementObserved,
                promotionApplied: row.promotionApplied,
                selectionMode: row.selectionMode,
                counterfactualWorker: row.counterfactualWorker,
                retryLocalization: row.retryLocalization,
                benchmarkGenerationMode: row.benchmarkGenerationMode,
                selectedGenerationMode: row.selectedGenerationMode,
                selectionStopReason: row.selectionStopReason,
                reviewWeakestDimension: row.reviewWeakestDimension,
                observedAt: row.observedAt,
                wholePieceCandidateCount: row.wholePieceCandidateCount,
                localizedRewriteBranchCount: row.localizedRewriteBranchCount,
                searchBudgetLevel: row.searchBudgetLevel,
                searchBudgetDescriptor: row.searchBudgetDescriptor,
            })),
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

function summarizeShadowRerankerShortlist(
    evidences: SelectedShadowRerankerEvidence[],
): ManifestShadowRerankerShortlistSummary | null {
    const shortlistEvidences = evidences.filter(
        (entry) => typeof entry.shortlistTopK === "number" && entry.shortlistTopK > 0 && entry.selectedRank !== null,
    );
    if (shortlistEvidences.length === 0) {
        return null;
    }

    const reviewedEvidences = shortlistEvidences.filter((entry) =>
        LEARNED_BACKBONE_REVIEWED_APPROVAL_STATUSES.has(compact(entry.approvalStatus).toLowerCase()),
    );
    const topKCounts: Record<string, number> = {};
    for (const entry of shortlistEvidences) {
        incrementNamedCount(topKCounts, String(entry.shortlistTopK));
    }

    const selectedInShortlistCount = shortlistEvidences.filter((entry) => entry.selectedInShortlist).length;
    const selectedTop1Count = shortlistEvidences.filter((entry) => entry.selectedRank === 1).length;
    const reviewedSelectedInShortlistCount = reviewedEvidences.filter((entry) => entry.selectedInShortlist).length;
    const reviewedSelectedTop1Count = reviewedEvidences.filter((entry) => entry.selectedRank === 1).length;
    const laneHolder = shortlistEvidences.find((entry) => entry.lane || entry.eligiblePromotionLane || entry.promotionLane);

    return {
        lane: laneHolder?.lane ?? laneHolder?.eligiblePromotionLane ?? laneHolder?.promotionLane ?? null,
        scoredManifestCount: shortlistEvidences.length,
        reviewedManifestCount: reviewedEvidences.length,
        topKCounts,
        selectedInShortlistCount,
        selectedInShortlistRate: optionalRatio(selectedInShortlistCount, shortlistEvidences.length),
        selectedOutsideShortlistCount: shortlistEvidences.length - selectedInShortlistCount,
        selectedTop1Count,
        selectedTop1Rate: optionalRatio(selectedTop1Count, shortlistEvidences.length),
        reviewedSelectedInShortlistCount,
        reviewedSelectedInShortlistRate: optionalRatio(reviewedSelectedInShortlistCount, reviewedEvidences.length),
        reviewedSelectedTop1Count,
        reviewedSelectedTop1Rate: optionalRatio(reviewedSelectedTop1Count, reviewedEvidences.length),
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

function summarizeLearnedProposalWarnings(
    manifests: JobManifest[],
    topLimit = 5,
): ManifestLearnedProposalWarningSummary {
    const buckets = new Map<string, LearnedProposalWarningBucket>();
    let proposalCount = 0;
    let proposalWithWarningsCount = 0;
    let totalWarningCount = 0;
    let roleCollapseWarningCount = 0;
    let lastSeenAt: string | null = null;
    let lastSongId: string | null = null;

    for (const manifest of manifests) {
        for (const sample of loadLearnedProposalWarningSamples(manifest)) {
            proposalCount += 1;
            if (sample.warnings.length === 0) {
                continue;
            }

            proposalWithWarningsCount += 1;
            totalWarningCount += sample.warnings.length;
            const sampleTimestampMs = toTimestampMs(sample.updatedAt) ?? Number.NEGATIVE_INFINITY;
            const latestTimestampMs = toTimestampMs(lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY;
            if (sampleTimestampMs >= latestTimestampMs) {
                lastSeenAt = sample.updatedAt;
                lastSongId = sample.songId;
            }

            for (const warning of sample.warnings) {
                if (warning.toLowerCase().includes("role collapse")) {
                    roleCollapseWarningCount += 1;
                }

                const bucket = buckets.get(warning) ?? {
                    warning,
                    count: 0,
                    proposalIds: new Set<string>(),
                    lastSeenAt: null,
                    lastSongId: null,
                };
                bucket.count += 1;
                bucket.proposalIds.add(`${sample.songId}:${sample.proposalId}`);
                const bucketTimestampMs = toTimestampMs(bucket.lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY;
                if (sampleTimestampMs >= bucketTimestampMs) {
                    bucket.lastSeenAt = sample.updatedAt;
                    bucket.lastSongId = sample.songId;
                }
                buckets.set(warning, bucket);
            }
        }
    }

    return {
        sampledManifestCount: manifests.length,
        proposalCount,
        proposalWithWarningsCount,
        totalWarningCount,
        roleCollapseWarningCount,
        lastSeenAt,
        lastSongId,
        topWarnings: Array.from(buckets.values())
            .map((bucket) => ({
                warning: bucket.warning,
                count: bucket.count,
                proposalCount: bucket.proposalIds.size,
                lastSeenAt: bucket.lastSeenAt,
                lastSongId: bucket.lastSongId,
            }))
            .sort((left, right) => (
                right.count - left.count
                || right.proposalCount - left.proposalCount
                || ((toTimestampMs(right.lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY)
                    - (toTimestampMs(left.lastSeenAt ?? undefined) ?? Number.NEGATIVE_INFINITY))
                || left.warning.localeCompare(right.warning)
            ))
            .slice(0, topLimit),
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
    const shortlist = summarizeShadowRerankerShortlist(evidences);
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
        shortlist,
        recentShortlists: evidences
            .filter((entry) => typeof entry.shortlistTopK === "number" && entry.shortlistTopK > 0 && entry.selectedRank !== null)
            .slice()
            .sort((left, right) => {
                const rightTimestamp = toTimestampMs(right.evaluatedAt ?? right.updatedAt) ?? 0;
                const leftTimestamp = toTimestampMs(left.evaluatedAt ?? left.updatedAt) ?? 0;
                return rightTimestamp - leftTimestamp || right.songId.localeCompare(left.songId);
            })
            .slice(0, 3)
            .map((entry) => ({
                songId: entry.songId,
                updatedAt: entry.evaluatedAt ?? entry.updatedAt,
                snapshotId: entry.snapshotId,
                lane: entry.lane,
                selectedCandidateId: entry.selectedCandidateId,
                selectedWorker: entry.selectedWorker,
                heuristicTopCandidateId: entry.heuristicTopCandidateId,
                learnedTopCandidateId: entry.learnedTopCandidateId,
                topK: entry.shortlistTopK ?? 0,
                selectedRank: entry.selectedRank,
                selectedInShortlist: entry.selectedInShortlist,
                shortlistedCandidateIds: entry.shortlistedCandidateIds,
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
    const learnedBackboneBenchmark = summarizeLearnedBackboneBenchmark(manifests);
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
        learnedProposalWarnings: summarizeLearnedProposalWarnings(manifests),
        learnedBackboneBenchmark,
        shadowReranker,
        orchestrationTrends: summarizeOrchestrationTrends(manifests),
        recentManifestTracking: manifests
            .slice()
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .slice(0, 8)
            .map((manifest) => summarizeManifestTracking(manifest)),
    };
}