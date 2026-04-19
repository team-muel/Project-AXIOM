import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAutonomyOperationalSummary } from "../autonomy/controller.js";
import { getAutonomySchedulerStatus } from "../autonomy/scheduler.js";
import { getAutonomyStatus } from "../autonomy/service.js";
import { WORKER_SCRIPT as COMPOSER_WORKER_SCRIPT, MUSICGEN_WORKER_SCRIPT } from "../composer/index.js";
import { config } from "../config.js";
import { WORKER_SCRIPT as HUMANIZER_WORKER_SCRIPT } from "../humanizer/index.js";
import { listStoredManifests } from "../memory/manifest.js";
import { buildManifestOperationalSummary } from "../memory/manifestAnalytics.js";
import { summarizeOverseerHistory } from "../overseer/storage.ts";
import { checkOllamaReachable } from "../overseer/index.js";
import { listJobs } from "../queue/jobQueue.js";
import { serializeQueuedJob, type SerializedQueuedJob } from "../queue/presentation.js";
import { WORKER_SCRIPT as RENDER_WORKER_SCRIPT, STYLE_WORKER_SCRIPT } from "../render/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOCAL_FLUIDSYNTH_CANDIDATES = [
    path.join(__dirname, "../../tools/fluidsynth/bin/fluidsynth.exe"),
    path.join(__dirname, "../../tools/fluidsynth/bin/fluidsynth"),
];

const LOCAL_FFMPEG_CANDIDATES = [
    path.join(__dirname, "../../tools/ffmpeg/bin/ffmpeg.exe"),
    path.join(__dirname, "../../tools/ffmpeg/bin/ffmpeg"),
];

type JsonRecord = Record<string, unknown>;
type BacklogOrchestrationSummary = NonNullable<NonNullable<SerializedQueuedJob["tracking"]>["orchestration"]>;
type OperatorOrchestrationTrendSummary = {
    family: string;
    instrumentNames: string[];
    manifestCount: number;
    averageIdiomaticRangeFit: number | null;
    averageRegisterBalanceFit: number | null;
    averageEnsembleConversationFit: number | null;
    averageDoublingPressureFit: number | null;
    averageTextureRotationFit: number | null;
    averageSectionHandoffFit: number | null;
    averageWeakSectionCount: number | null;
    weakManifestCount: number;
    lastSeenAt: string | null;
};
type OperatorArtifactOrchestrationTrendDiagnostic = {
    available: boolean;
    family: string | null;
    manifestCount: number;
    weakManifestCount: number;
    pressured: boolean;
    lastSeenAt: string | null;
    advisory: string | null;
};
type OperatorPhraseBreathTrendSummary = {
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
};
type OperatorArtifactPhraseBreathTrendDiagnostic = {
    available: boolean;
    manifestCount: number;
    weakManifestCount: number;
    pressured: boolean;
    lastSeenAt: string | null;
    advisory: string | null;
};
type OperatorHarmonicColorTrendSummary = {
    manifestCount: number;
    weakManifestCount: number;
    averagePlanFit: number | null;
    averageCoverageFit: number | null;
    averageTargetFit: number | null;
    averageTimingFit: number | null;
    averageTonicizationPressureFit: number | null;
    averageProlongationMotionFit: number | null;
    lastSeenAt: string | null;
};
type OperatorArtifactHarmonicColorTrendDiagnostic = {
    available: boolean;
    manifestCount: number;
    weakManifestCount: number;
    pressured: boolean;
    lastSeenAt: string | null;
    advisory: string | null;
};
type OperatorLearnedProposalWarningRow = {
    warning: string;
    count: number;
    proposalCount: number;
    lastSeenAt: string | null;
    lastSongId: string | null;
};
type OperatorLearnedProposalWarningSummary = {
    sampledManifestCount: number;
    proposalCount: number;
    proposalWithWarningsCount: number;
    totalWarningCount: number;
    roleCollapseWarningCount: number;
    lastSeenAt: string | null;
    lastSongId: string | null;
    topWarnings: OperatorLearnedProposalWarningRow[];
};
type OperatorLearnedBackboneBenchmarkFailureModeRow = {
    failureMode: string;
    count: number;
};
type OperatorLearnedBackboneBenchmarkStopReasonRow = {
    reason: string;
    count: number;
};
type OperatorLearnedBackboneBenchmarkCoverageRow = {
    benchmarkKey: string;
    benchmarkId: string | null;
    planSignature: string | null;
    lane: string | null;
    benchmarkPackVersion: string | null;
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
};
type OperatorLearnedBackboneBenchmarkSearchBudgetRow = {
    searchBudgetLevel: string | null;
    searchBudgetDescriptor: string | null;
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
};
type OperatorLearnedBackboneBenchmarkRecentRunRow = {
    songId: string;
    benchmarkId: string | null;
    planSignature: string | null;
    selectedWorker: string | null;
    approvalStatus: string | null;
    reviewed: boolean;
    appealScore: number | null;
    disagreementObserved: boolean;
    promotionApplied: boolean;
    selectionMode: string | null;
    counterfactualWorker: string | null;
    retryLocalization: string | null;
    benchmarkGenerationMode: string | null;
    selectedGenerationMode: string | null;
    selectionStopReason: string | null;
    reviewWeakestDimension: string | null;
    observedAt: string | null;
    wholePieceCandidateCount: number;
    localizedRewriteBranchCount: number;
    searchBudgetLevel: string | null;
    searchBudgetDescriptor: string | null;
};
type OperatorLearnedBackboneBenchmarkReviewQueueRow = {
    songId: string;
    benchmarkId: string | null;
    planSignature: string | null;
    reviewTarget: string | null;
    selectedWorker: string | null;
    counterfactualWorker: string | null;
    selectionMode: string | null;
    observedAt: string | null;
    wholePieceCandidateCount: number;
    localizedRewriteBranchCount: number;
    searchBudgetLevel: string | null;
    searchBudgetDescriptor: string | null;
    shortlistTopK: number | null;
    selectedRank: number | null;
    selectedInShortlist: boolean;
};
type OperatorLearnedBackboneBenchmarkReviewQueue = {
    pendingBlindReviewCount: number;
    pendingShortlistReviewCount: number;
    latestPendingAt: string | null;
    recentPendingRows: OperatorLearnedBackboneBenchmarkReviewQueueRow[];
};
type OperatorLearnedBackboneBenchmarkReviewPackRow = {
    packId: string;
    generatedAt: string | null;
    reviewTarget: string | null;
    searchBudget: string | null;
    entryCount: number;
    completedDecisionCount: number;
    pendingDecisionCount: number;
    pendingShortlistDecisionCount: number;
    latestReviewedAt: string | null;
    reviewSheetPath: string | null;
};
type OperatorLearnedBackboneBenchmarkReviewPacks = {
    matchedPackCount: number;
    activePackCount: number;
    pendingDecisionCount: number;
    completedDecisionCount: number;
    latestGeneratedAt: string | null;
    latestReviewedAt: string | null;
    recentActivePacks: OperatorLearnedBackboneBenchmarkReviewPackRow[];
};
type OperatorLearnedBackboneBenchmarkReviewPackAction = {
    reviewTarget: string | null;
    searchBudget: string | null;
    pendingOnly: boolean;
    pendingPairCount: number;
    priority: string | null;
    command: string | null;
};
type OperatorLearnedBackboneBenchmarkReviewPackRecordAction = {
    packId: string;
    reviewTarget: string | null;
    searchBudget: string | null;
    pendingDecisionCount: number;
    pendingShortlistDecisionCount: number;
    reviewSheetPath: string | null;
    priority: string | null;
    command: string | null;
};
type OperatorLearnedBackboneBenchmarkConfigSnapshot = {
    lane: string | null;
    benchmarkPackVersion: string | null;
    benchmarkIds: string[];
    pairedWorkers: string[];
    workflowCounts: Record<string, number>;
    promptPackVersionCounts: Record<string, number>;
    reviewRubricVersionCounts: Record<string, number>;
    generationModeCounts: Record<string, number>;
};
type OperatorLearnedBackboneBenchmarkReviewSampleStatus = {
    status: string | null;
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
};
type OperatorLearnedBackboneBenchmarkDisagreementSummary = {
    pairedRunCount: number;
    disagreementRunCount: number;
    reviewedDisagreementCount: number;
    promotionAppliedCount: number;
    learnedSelectedWithoutPromotionCount: number;
    baselineSelectedCount: number;
};
type OperatorLearnedBackboneBenchmarkRetryLocalizationStability = {
    retryingRunCount: number;
    sectionTargetedOnlyCount: number;
    mixedCount: number;
    globalOnlyCount: number;
    sectionTargetedRate: number | null;
    driftRate: number | null;
    status: string | null;
};
type OperatorLearnedBackboneBenchmarkBlindPreference = {
    available: boolean;
    winRate: number | null;
    reviewedPairCount: number;
    decisivePairCount: number;
    learnedWinCount: number;
    baselineWinCount: number;
    tieCount: number;
    latestReviewedAt: string | null;
    reason: string | null;
};
type OperatorLearnedBackboneBenchmarkReviewedTop1Accuracy = {
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
    reason: string | null;
};
type OperatorLearnedBackboneBenchmarkWorkerOutcomeSummary = {
    runCount: number;
    reviewedRunCount: number;
    pendingReviewCount: number;
    approvedCount: number;
    rejectedCount: number;
    approvalRate: number | null;
    averageAppealScore: number | null;
};
type OperatorLearnedBackboneBenchmarkPairedSelectionOutcomes = {
    lane: string | null;
    benchmarkPackVersion: string | null;
    reviewedManifestCount: number;
    promotedReviewedCount: number;
    promotedApprovalRate: number | null;
    promotedAverageAppealScore: number | null;
    heuristicReviewedCount: number;
    heuristicApprovalRate: number | null;
    heuristicAverageAppealScore: number | null;
};
type OperatorLearnedBackboneBenchmarkPromotionGate = {
    status: string | null;
    signal: string | null;
    minimumReviewedRunCount: number;
    minimumReviewedDisagreementCount: number;
    minimumReviewedSelectedInShortlistRate: number | null;
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
    rationale: string | null;
};
type OperatorLearnedBackboneBenchmarkSummary = {
    lane: string | null;
    benchmarkPackVersion: string | null;
    runCount: number;
    pairedRunCount: number;
    reviewedRunCount: number;
    pendingReviewCount: number;
    approvalRate: number | null;
    averageAppealScore: number | null;
    configSnapshot: OperatorLearnedBackboneBenchmarkConfigSnapshot | null;
    blindPreference: OperatorLearnedBackboneBenchmarkBlindPreference | null;
    shortlistBlindPreference: OperatorLearnedBackboneBenchmarkBlindPreference | null;
    reviewedTop1Accuracy: OperatorLearnedBackboneBenchmarkReviewedTop1Accuracy | null;
    promotionGate: OperatorLearnedBackboneBenchmarkPromotionGate | null;
    reviewSampleStatus: OperatorLearnedBackboneBenchmarkReviewSampleStatus | null;
    reviewQueue: OperatorLearnedBackboneBenchmarkReviewQueue | null;
    reviewPacks: OperatorLearnedBackboneBenchmarkReviewPacks | null;
    reviewPackActions: OperatorLearnedBackboneBenchmarkReviewPackAction[];
    reviewPackRecordActions: OperatorLearnedBackboneBenchmarkReviewPackRecordAction[];
    disagreementSummary: OperatorLearnedBackboneBenchmarkDisagreementSummary | null;
    retryLocalizationStability: OperatorLearnedBackboneBenchmarkRetryLocalizationStability | null;
    selectionModeCounts: Record<string, number>;
    searchBudgetCounts: Record<string, number>;
    selectedWorkerOutcomes: Record<string, OperatorLearnedBackboneBenchmarkWorkerOutcomeSummary>;
    pairedSelectionOutcomes: OperatorLearnedBackboneBenchmarkPairedSelectionOutcomes | null;
    promotionAdvantage: OperatorShadowRerankerPromotionAdvantageSummary | null;
    coverageRows: OperatorLearnedBackboneBenchmarkCoverageRow[];
    searchBudgetRows: OperatorLearnedBackboneBenchmarkSearchBudgetRow[];
    topFailureModes: OperatorLearnedBackboneBenchmarkFailureModeRow[];
    topStopReasons: OperatorLearnedBackboneBenchmarkStopReasonRow[];
    recentRunRows: OperatorLearnedBackboneBenchmarkRecentRunRow[];
};
type OperatorShadowRerankerRecentDisagreement = {
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
};
type OperatorShadowRerankerRecentPromotion = {
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
};
type OperatorShadowRerankerRecentShortlist = {
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
};
type OperatorShadowRerankerShortlistSummary = {
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
};
type OperatorShadowRerankerPromotionOutcomeSummary = {
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
};
type OperatorShadowRerankerPromotionAdvantageSummary = {
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
};
type OperatorShadowRerankerRetryLocalizationSummary = {
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
};
type OperatorShadowRerankerRuntimeWindowSummary = {
    windowHours: number;
    sampledEntries: number;
    disagreementCount: number;
    highConfidenceDisagreementCount: number;
    agreementRate: number | null;
    averageConfidence: number | null;
    lastSeenAt: string | null;
};
type OperatorShadowRerankerSummary = {
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
    recentDisagreements: OperatorShadowRerankerRecentDisagreement[];
    recentPromotions: OperatorShadowRerankerRecentPromotion[];
    shortlist: OperatorShadowRerankerShortlistSummary | null;
    recentShortlists: OperatorShadowRerankerRecentShortlist[];
    promotionOutcomes: OperatorShadowRerankerPromotionOutcomeSummary | null;
    promotionAdvantage: OperatorShadowRerankerPromotionAdvantageSummary | null;
    retryLocalizationOutcomes: OperatorShadowRerankerRetryLocalizationSummary | null;
    runtimeWindow: OperatorShadowRerankerRuntimeWindowSummary | null;
};
type OperatorArtifactShadowRerankerDiagnostic = {
    available: boolean;
    scoredManifestCount: number;
    disagreementCount: number;
    highConfidenceDisagreementCount: number;
    promotedSelectionCount: number;
    sufficientReviewSample: boolean;
    pressured: boolean;
    lastSeenAt: string | null;
    advisory: string | null;
};

const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED = 4;
const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT = 2;

export type RuntimeReadinessSummary = {
    status: "ready" | "ready_degraded" | "not_ready";
    checks: Record<string, unknown>;
    capabilities: Record<string, unknown>;
    degradedReasons: string[];
};

export type OperatorSummaryOptions = {
    namespace?: string;
    source?: string;
    jobLimit?: number;
    windowHours?: number;
    staleThresholdMs?: number;
    observedAt?: string;
};

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
            ? Number(value)
            : Number.NaN;

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function toRecord(value: unknown): JsonRecord | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as JsonRecord)
        : undefined;
}

function toRecordArray(value: unknown): JsonRecord[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => toRecord(item))
        .filter((item): item is JsonRecord => Boolean(item));
}

function toNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function toTrimmed(value: unknown, fallback = "-"): string {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function readJsonRecordIfExists(filePath: string): JsonRecord | null {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return toRecord(parsed) || null;
    } catch {
        return null;
    }
}

function loadOperatorHandoff() {
    const systemDir = path.join(config.outputDir, "_system");
    return {
        incidentDraft: readJsonRecordIfExists(path.join(systemDir, "operator-sweep", "incident-drafts", "latest.json")),
        operatorPickup: readJsonRecordIfExists(path.join(systemDir, "operator-pickup", "latest.json")),
    };
}

function toTimestampMs(value: unknown): number | undefined {
    const parsed = Date.parse(String(value || "").trim());
    return Number.isFinite(parsed) ? parsed : undefined;
}

function boolLabel(value: unknown): string {
    if (value === true) {
        return "yes";
    }

    if (value === false) {
        return "no";
    }

    return "unknown";
}

function summarizeOperatorAction(record: JsonRecord | null) {
    return {
        present: Boolean(record),
        action: toTrimmed(record?.action, "") || null,
        surface: toTrimmed(record?.surface, "") || null,
        actor: toTrimmed(record?.actor, "") || null,
        approvedBy: toTrimmed(record?.approvedBy, "") || null,
        reason: toTrimmed(record?.reason, "") || null,
        rollbackNote: toTrimmed(record?.rollbackNote, "") || null,
        manualRecoveryNote: toTrimmed(record?.manualRecoveryNote, "") || null,
        observedAt: toTrimmed(record?.observedAt, "") || null,
        artifactLinks: Array.isArray(record?.artifactLinks)
            ? record.artifactLinks.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
    };
}

function formatLongSpanLabel(longSpan: JsonRecord | null | undefined): string {
    if (!longSpan || !longSpan.status) {
        return "-";
    }

    const focus = toTrimmed(longSpan.weakestDimension, "") || toTrimmed(longSpan.repairFocus, "");
    const secondaryRepairFocuses = Array.isArray(longSpan.secondaryRepairFocuses)
        ? longSpan.secondaryRepairFocuses.map((value) => toTrimmed(value)).filter((value) => value !== "-")
        : [];
    const focusSuffix = focus
        ? `${focus}${secondaryRepairFocuses[0] ? `+${secondaryRepairFocuses[0]}` : ""}${secondaryRepairFocuses.length > 1 ? `+${secondaryRepairFocuses.length - 1}more` : ""}`
        : "";
    const label = focusSuffix
        ? `${toTrimmed(longSpan.status)}:${focusSuffix}`
        : toTrimmed(longSpan.status);
    const repairMode = toTrimmed(longSpan.repairMode, "");
    const sectionTokens = (Array.isArray(longSpan.sections) ? longSpan.sections : [])
        .map((section) => {
            const sectionId = toTrimmed((section as JsonRecord | undefined)?.sectionId, "");
            if (!sectionId) {
                return "";
            }
            if (repairMode === "paired_cross_section") {
                const pairedSectionId = toTrimmed((section as JsonRecord | undefined)?.structureSectionId, "");
                return pairedSectionId && pairedSectionId !== sectionId
                    ? `${sectionId}>${pairedSectionId}`
                    : `${sectionId}~cross`;
            }
            if (repairMode === "paired_same_section") {
                return `${sectionId}~same`;
            }
            return sectionId;
        })
        .filter((token) => token.length > 0);

    if (sectionTokens.length > 0) {
        return `${label}@${sectionTokens[0]}${sectionTokens.slice(1).map((token) => `,+${token}`).join("")}`;
    }

    const primarySectionId = toTrimmed(longSpan.primarySectionId, "");
    if (!primarySectionId) {
        return label;
    }
    if (repairMode === "paired_cross_section") {
        return `${label}@${primarySectionId}~cross`;
    }
    if (repairMode === "paired_same_section") {
        return `${label}@${primarySectionId}~same`;
    }
    return `${label}@${primarySectionId}`;
}

function formatLongSpanSectionReference(sectionId: string, label: string, role: string): string {
    if (label && sectionId) {
        return `${label} (${sectionId})`;
    }

    if (label) {
        return label;
    }

    if (sectionId) {
        return sectionId;
    }

    return role;
}

function buildLongSpanOperatorReason(longSpan: JsonRecord | null | undefined): string | null {
    if (!longSpan) {
        return null;
    }

    const sections = (Array.isArray(longSpan.sections) ? longSpan.sections : [])
        .filter((section) => Boolean(toTrimmed((section as JsonRecord | undefined)?.sectionId, "")));
    const primarySection = (sections[0] as JsonRecord | undefined) ?? null;
    const renderedSectionId = toTrimmed(primarySection?.sectionId, "") || toTrimmed(longSpan.primarySectionId, "");
    const renderedLabel = toTrimmed(primarySection?.label, "");
    const renderedRole = toTrimmed(primarySection?.role, "");
    if (!renderedSectionId && !renderedLabel && !renderedRole) {
        return null;
    }

    const renderedSection = formatLongSpanSectionReference(renderedSectionId, renderedLabel, renderedRole);
    const symbolicSectionId = toTrimmed(primarySection?.structureSectionId, "");
    const symbolicLabel = toTrimmed(primarySection?.structureLabel, "");
    const symbolicRole = toTrimmed(primarySection?.structureRole, "");
    const symbolicSection = formatLongSpanSectionReference(symbolicSectionId, symbolicLabel, symbolicRole);
    const hasSymbolicContext = Boolean(symbolicSectionId || symbolicLabel || symbolicRole);
    const additionalZoneCount = Math.max(0, sections.length - 1);
    const extraNote = additionalZoneCount > 0
        ? ` ${additionalZoneCount} additional divergence ${additionalZoneCount === 1 ? "zone remains" : "zones remain"} in the same long-span set.`
        : "";

    switch (toTrimmed(longSpan.repairMode, "")) {
        case "paired_cross_section":
            return hasSymbolicContext
                ? `Rendered weak section ${renderedSection} must reconverge with paired symbolic weak section ${symbolicSection}.${extraNote}`
                : `Rendered weak section ${renderedSection} must reconverge with its paired symbolic weak section.${extraNote}`;
        case "paired_same_section":
            return `Rendered weak section ${renderedSection} is also the paired symbolic weak section.${extraNote}`;
        default:
            return `Rendered weak section ${renderedSection} is the primary repair target while the symbolic long-span route still holds.${extraNote}`;
    }
}

function formatLongSpanReason(longSpan: JsonRecord | null | undefined): string {
    return buildLongSpanOperatorReason(longSpan) || "-";
}

function summarizePendingApproval(item: JsonRecord) {
    const plannerTelemetry = toRecord(item.plannerTelemetry);

    return {
        songId: toTrimmed(item.songId),
        runId: toTrimmed(item.runId),
        prompt: toTrimmed(item.prompt),
        form: toTrimmed(item.form),
        updatedAt: toTrimmed(item.updatedAt),
        qualityScore: toNumber(item.qualityScore) ?? null,
        longSpan: toRecord(item.longSpan) || null,
        longSpanDivergence: toRecord(item.longSpanDivergence) || null,
        approvalStatus: toTrimmed(item.approvalStatus, "pending"),
        plannerTelemetry: plannerTelemetry
            ? {
                selectedCandidateId: toTrimmed(plannerTelemetry.selectedCandidateId),
                parserMode: toTrimmed(plannerTelemetry.parserMode),
                noveltyScore: toNumber(plannerTelemetry.noveltyScore) ?? null,
            }
            : null,
    };
}

function summarizePlannerTelemetry(item: JsonRecord | undefined) {
    if (!item) {
        return null;
    }

    return {
        selectedCandidateId: toTrimmed(item.selectedCandidateId),
        selectedCandidateLabel: toTrimmed(item.selectedCandidateLabel),
        parserMode: toTrimmed(item.parserMode),
        planSignature: toTrimmed(item.planSignature),
        noveltyScore: toNumber(item.noveltyScore) ?? null,
        selectionScore: toNumber(item.selectionScore) ?? null,
        qualityScore: toNumber(item.qualityScore) ?? null,
    };
}

function summarizeLastRun(item: JsonRecord) {
    return {
        runId: toTrimmed(item.runId),
        createdAt: toTrimmed(item.createdAt),
        status: toTrimmed(item.status),
        promptHash: toTrimmed(item.promptHash),
        summary: toTrimmed(item.summary),
        plannerTelemetry: summarizePlannerTelemetry(toRecord(item.plannerTelemetry) || undefined),
    };
}

function checkPythonImport(moduleName: string): boolean {
    try {
        execFileSync(
            config.pythonBin,
            ["-c", `import ${moduleName}`],
            { timeout: 5_000, stdio: "pipe" },
        );
        return true;
    } catch {
        return false;
    }
}

function commandLookupBinary(): string {
    return process.platform === "win32" ? "where" : "which";
}

function checkExecutable(command: string | undefined, localCandidates: string[] = []): boolean {
    const candidate = String(command ?? "").trim();
    const explicitPath = candidate && (candidate.includes("/") || candidate.includes("\\"))
        ? candidate
        : undefined;

    if (explicitPath && fs.existsSync(explicitPath)) {
        return true;
    }

    for (const localCandidate of localCandidates) {
        if (fs.existsSync(localCandidate)) {
            return true;
        }
    }

    const executableNames = new Set<string>();
    if (candidate && !explicitPath) {
        executableNames.add(candidate);
    }
    for (const localCandidate of localCandidates) {
        executableNames.add(path.basename(localCandidate));
    }

    for (const executableName of executableNames) {
        try {
            execFileSync(commandLookupBinary(), [executableName], {
                timeout: 3_000,
                stdio: "ignore",
            });
            return true;
        } catch {
            // continue
        }
    }

    return false;
}

function checkWorkerScript(filePath: string): boolean {
    try {
        const stat = fs.statSync(filePath);
        return stat.isFile() && stat.size > 0;
    } catch {
        return false;
    }
}

export function getRuntimeReadinessSummary(): RuntimeReadinessSummary {
    const checks: Record<string, unknown> = {};

    try {
        execFileSync(config.pythonBin, ["--version"], { timeout: 3000, stdio: "pipe" });
        checks.python = true;
    } catch {
        checks.python = false;
    }

    const pythonModules = {
        music21: checks.python === true && checkPythonImport("music21"),
        midi2audio: checks.python === true && checkPythonImport("midi2audio"),
        numpy: checks.python === true && checkPythonImport("numpy"),
        scipy: checks.python === true && checkPythonImport("scipy"),
        torch: checks.python === true && checkPythonImport("torch"),
        transformers: checks.python === true && checkPythonImport("transformers"),
        accelerate: checks.python === true && checkPythonImport("accelerate"),
    };

    const workerScripts = {
        symbolicCompose: checkWorkerScript(COMPOSER_WORKER_SCRIPT),
        musicgenCompose: checkWorkerScript(MUSICGEN_WORKER_SCRIPT),
        symbolicHumanize: checkWorkerScript(HUMANIZER_WORKER_SCRIPT),
        symbolicRender: checkWorkerScript(RENDER_WORKER_SCRIPT),
        styledAudioRender: checkWorkerScript(STYLE_WORKER_SCRIPT),
    };

    checks.pythonModules = pythonModules;
    checks.workerScripts = workerScripts;
    checks.soundfont = fs.existsSync(config.soundfontPath);
    checks.fluidsynth = checkExecutable("fluidsynth", LOCAL_FLUIDSYNTH_CANDIDATES);
    checks.ffmpeg = checkExecutable(config.ffmpegBin, LOCAL_FFMPEG_CANDIDATES);

    const capabilities = {
        symbolicCompose: checks.python === true && pythonModules.music21 && workerScripts.symbolicCompose === true,
        symbolicHumanize: checks.python === true && pythonModules.music21 && workerScripts.symbolicHumanize === true,
        symbolicRenderPreview: checks.python === true && pythonModules.music21 && workerScripts.symbolicRender === true,
        audioRender: checks.soundfont === true && (checks.fluidsynth === true || pythonModules.midi2audio),
        previewVideo: checks.soundfont === true && (checks.fluidsynth === true || pythonModules.midi2audio) && checks.ffmpeg === true,
        musicgenCompose: checks.python === true
            && pythonModules.numpy
            && pythonModules.scipy
            && pythonModules.torch
            && pythonModules.transformers
            && pythonModules.accelerate
            && workerScripts.musicgenCompose === true,
        styledAudioRender: checks.python === true
            && pythonModules.numpy
            && pythonModules.scipy
            && pythonModules.torch
            && pythonModules.transformers
            && pythonModules.accelerate
            && workerScripts.styledAudioRender === true,
    };

    const degradedReasons = [
        workerScripts.symbolicCompose !== true ? "symbolic compose worker script missing" : null,
        workerScripts.symbolicHumanize !== true ? "humanize worker script missing" : null,
        workerScripts.symbolicRender !== true ? "render worker script missing" : null,
        workerScripts.musicgenCompose !== true ? "MusicGen worker script missing" : null,
        workerScripts.styledAudioRender !== true ? "styled audio worker script missing" : null,
        !capabilities.audioRender ? "audio render unavailable (soundfont or FluidSynth/midi2audio missing)" : null,
        !capabilities.previewVideo ? "preview video unavailable (ffmpeg missing or audio render unavailable)" : null,
        !capabilities.musicgenCompose ? "MusicGen unavailable (torch/transformers/scipy/accelerate stack missing)" : null,
    ].filter((value): value is string => Boolean(value));

    const symbolicReady = capabilities.symbolicCompose && capabilities.symbolicHumanize && capabilities.symbolicRenderPreview;

    return {
        status: !symbolicReady
            ? "not_ready"
            : degradedReasons.length > 0
                ? "ready_degraded"
                : "ready",
        checks,
        capabilities,
        degradedReasons,
    };
}

function buildEvidence(
    observedAt: string,
    staleThresholdMs: number,
    missing: string[],
    endpoints: {
        ready: { statusCode: number; ok: boolean; path: string };
        jobs: { statusCode: number; ok: boolean; path: string };
        autonomyOps: { statusCode: number; ok: boolean; path: string };
        overseerSummary: { statusCode: number; ok: boolean; path: string };
    },
) {
    return {
        contractOk: missing.length === 0,
        missing,
        stale: false,
        staleReason: "none",
        staleThresholdMs,
        oldestAgeMs: 0,
        maxSkewMs: 0,
        endpoints: {
            ready: {
                ...endpoints.ready,
                fetchedAt: observedAt,
                latencyMs: 0,
            },
            jobs: {
                ...endpoints.jobs,
                fetchedAt: observedAt,
                latencyMs: 0,
            },
            autonomyOps: {
                ...endpoints.autonomyOps,
                fetchedAt: observedAt,
                latencyMs: 0,
            },
            overseerSummary: {
                ...endpoints.overseerSummary,
                fetchedAt: observedAt,
                latencyMs: 0,
            },
        },
    };
}

function severityWeightForReasonCode(code: string): number {
    switch (String(code || "").trim()) {
        case "readiness_not_ready":
        case "queue_failed_pressure":
        case "stale_lock_detected":
            return 4;
        case "readiness_degraded":
        case "evidence_stale":
        case "queue_oldest_age_high":
            return 2;
        case "queue_retry_pressure":
        case "pending_approval_backlog":
        case "repeated_warning_active":
        case "overseer_recent_failures":
            return 1;
        default:
            return 0;
    }
}

function addSeverityDriver(drivers: Array<{ code: string; weight: number; detail: string }>, code: string, weight: number, detail: string) {
    drivers.push({
        code,
        weight,
        detail: toTrimmed(detail, code),
    });
}

function deriveSeverity(state: string, severityScore: number, severityDrivers: Array<{ weight: number }>) {
    const criticalCount = severityDrivers.filter((item) => (toNumber(item.weight) ?? 0) >= 4).length;

    if (state === "incident_candidate") {
        return criticalCount >= 2 || severityScore >= 10 ? "SEV-1" : "SEV-2";
    }

    if (state === "runtime_degraded" || state === "bridge_degraded") {
        return severityScore >= 5 ? "SEV-2" : "SEV-3";
    }

    return "none";
}

function buildTriage(
    state: string,
    recommendedLane: string,
    reasonCodes: string[],
    severityDrivers: Array<{ code: string; weight: number; detail: string }>,
) {
    const severityScore = severityDrivers.reduce((total, item) => total + (toNumber(item.weight) ?? 0), 0);
    const severity = deriveSeverity(state, severityScore, severityDrivers);

    return {
        state,
        severity,
        severityScore,
        severityDrivers,
        recommendedLane,
        reasonCodes,
        summary: state === "healthy"
            ? "healthy"
            : `${state} ${severity} score=${severityScore} (${reasonCodes.join(", ")})`,
    };
}

function summarizeQueue(jobs: SerializedQueuedJob[]) {
    const statuses = jobs.map((job) => toTrimmed(job.status, "unknown"));
    return {
        total: jobs.length,
        running: statuses.filter((status) => status === "running").length,
        queued: statuses.filter((status) => status === "queued").length,
        retryScheduled: statuses.filter((status) => status === "retry_scheduled").length,
        failedLike: jobs.filter((job) => {
            const status = toTrimmed(job.status, "unknown");
            return status === "failed" || (status !== "done" && Boolean(String(job.error || "").trim()));
        }).length,
    };
}

function formatOrchestrationMetric(value: number | null | undefined): string {
    return typeof value === "number" && Number.isFinite(value)
        ? value.toFixed(2)
        : "?";
}

function formatOrchestrationLabel(summary: BacklogOrchestrationSummary | null | undefined): string {
    if (!summary) {
        return "-";
    }

    const family = summary.family === "string_trio"
        ? "trio"
        : toTrimmed(summary.family, "unknown");
    const weakSections = summary.weakSectionIds.length > 0
        ? summary.weakSectionIds.join(",")
        : "none";
    const doublingToken = typeof summary.doublingPressureFit === "number"
        ? `,dbl=${formatOrchestrationMetric(summary.doublingPressureFit)}`
        : "";
    const rotationToken = typeof summary.textureRotationFit === "number"
        ? `,rot=${formatOrchestrationMetric(summary.textureRotationFit)}`
        : "";
    const handoffToken = typeof summary.sectionHandoffFit === "number"
        ? `,hnd=${formatOrchestrationMetric(summary.sectionHandoffFit)}`
        : "";

    return `${family}:rng=${formatOrchestrationMetric(summary.idiomaticRangeFit)},bal=${formatOrchestrationMetric(summary.registerBalanceFit)},conv=${formatOrchestrationMetric(summary.ensembleConversationFit)}${doublingToken}${rotationToken}${handoffToken},weak=${weakSections}`;
}

function summarizeOrchestrationTrendRow(row: JsonRecord): OperatorOrchestrationTrendSummary {
    return {
        family: toTrimmed(row.family, "unknown"),
        instrumentNames: Array.isArray(row.instrumentNames)
            ? row.instrumentNames.map((entry) => toTrimmed(entry)).filter((entry) => entry !== "-")
            : [],
        manifestCount: toNumber(row.manifestCount) ?? 0,
        averageIdiomaticRangeFit: toNumber(row.averageIdiomaticRangeFit) ?? null,
        averageRegisterBalanceFit: toNumber(row.averageRegisterBalanceFit) ?? null,
        averageEnsembleConversationFit: toNumber(row.averageEnsembleConversationFit) ?? null,
        averageDoublingPressureFit: toNumber(row.averageDoublingPressureFit) ?? null,
        averageTextureRotationFit: toNumber(row.averageTextureRotationFit) ?? null,
        averageSectionHandoffFit: toNumber(row.averageSectionHandoffFit) ?? null,
        averageWeakSectionCount: toNumber(row.averageWeakSectionCount) ?? null,
        weakManifestCount: toNumber(row.weakManifestCount) ?? 0,
        lastSeenAt: toTrimmed(row.lastSeenAt, "") || null,
    };
}

function formatOrchestrationTrendFamily(value: unknown): string | null {
    const family = compact(value);
    if (!family) {
        return null;
    }

    return family === "string_trio" ? "trio" : family;
}

function summarizeOrchestrationTrends(value: unknown): OperatorOrchestrationTrendSummary[] {
    const record = toRecord(value);
    const rows = Array.isArray(record?.familyRows)
        ? toRecordArray(record.familyRows)
        : [];

    return rows.slice(0, 3).map(summarizeOrchestrationTrendRow);
}

function summarizePhraseBreathTrend(value: unknown): OperatorPhraseBreathTrendSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        manifestCount: toNumber(record.manifestCount) ?? 0,
        weakManifestCount: toNumber(record.weakManifestCount) ?? 0,
        averagePlanFit: toNumber(record.averagePlanFit) ?? null,
        averageCoverageFit: toNumber(record.averageCoverageFit) ?? null,
        averagePickupFit: toNumber(record.averagePickupFit) ?? null,
        averageArrivalFit: toNumber(record.averageArrivalFit) ?? null,
        averageReleaseFit: toNumber(record.averageReleaseFit) ?? null,
        averageRecoveryFit: toNumber(record.averageRecoveryFit) ?? null,
        averageRubatoFit: toNumber(record.averageRubatoFit) ?? null,
        lastSeenAt: toTrimmed(record.lastSeenAt, "") || null,
    };
}

function summarizeHarmonicColorTrend(value: unknown): OperatorHarmonicColorTrendSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        manifestCount: toNumber(record.manifestCount) ?? 0,
        weakManifestCount: toNumber(record.weakManifestCount) ?? 0,
        averagePlanFit: toNumber(record.averagePlanFit) ?? null,
        averageCoverageFit: toNumber(record.averageCoverageFit) ?? null,
        averageTargetFit: toNumber(record.averageTargetFit) ?? null,
        averageTimingFit: toNumber(record.averageTimingFit) ?? null,
        averageTonicizationPressureFit: toNumber(record.averageTonicizationPressureFit) ?? null,
        averageProlongationMotionFit: toNumber(record.averageProlongationMotionFit) ?? null,
        lastSeenAt: toTrimmed(record.lastSeenAt, "") || null,
    };
}

function summarizeLearnedProposalWarningRow(row: JsonRecord): OperatorLearnedProposalWarningRow {
    return {
        warning: toTrimmed(row.warning),
        count: toNumber(row.count) ?? 0,
        proposalCount: toNumber(row.proposalCount) ?? 0,
        lastSeenAt: toTrimmed(row.lastSeenAt, "") || null,
        lastSongId: toTrimmed(row.lastSongId, "") || null,
    };
}

function summarizeLearnedProposalWarnings(value: unknown): OperatorLearnedProposalWarningSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        sampledManifestCount: toNumber(record.sampledManifestCount) ?? 0,
        proposalCount: toNumber(record.proposalCount) ?? 0,
        proposalWithWarningsCount: toNumber(record.proposalWithWarningsCount) ?? 0,
        totalWarningCount: toNumber(record.totalWarningCount) ?? 0,
        roleCollapseWarningCount: toNumber(record.roleCollapseWarningCount) ?? 0,
        lastSeenAt: toTrimmed(record.lastSeenAt, "") || null,
        lastSongId: toTrimmed(record.lastSongId, "") || null,
        topWarnings: Array.isArray(record.topWarnings)
            ? toRecordArray(record.topWarnings).slice(0, 3).map(summarizeLearnedProposalWarningRow)
            : [],
    };
}

function summarizeCountMap(value: unknown): Record<string, number> {
    const record = toRecord(value);
    if (!record) {
        return {};
    }

    const entries = Object.entries(record)
        .map(([key, entry]) => [key, toNumber(entry) ?? 0] as const)
        .filter(([, entry]) => entry > 0);

    return Object.fromEntries(entries);
}

function summarizeLearnedBackboneBenchmarkFailureModeRow(row: JsonRecord): OperatorLearnedBackboneBenchmarkFailureModeRow {
    return {
        failureMode: toTrimmed(row.failureMode),
        count: toNumber(row.count) ?? 0,
    };
}

function summarizeLearnedBackboneBenchmarkStopReasonRow(row: JsonRecord): OperatorLearnedBackboneBenchmarkStopReasonRow {
    return {
        reason: toTrimmed(row.reason),
        count: toNumber(row.count) ?? 0,
    };
}

function summarizeLearnedBackboneBenchmarkCoverageRow(row: JsonRecord): OperatorLearnedBackboneBenchmarkCoverageRow {
    return {
        benchmarkKey: toTrimmed(row.benchmarkKey),
        benchmarkId: toTrimmed(row.benchmarkId, "") || null,
        planSignature: toTrimmed(row.planSignature, "") || null,
        lane: toTrimmed(row.lane, "") || null,
        benchmarkPackVersion: toTrimmed(row.benchmarkPackVersion, "") || null,
        runCount: toNumber(row.runCount) ?? 0,
        pairedRunCount: toNumber(row.pairedRunCount) ?? 0,
        reviewedRunCount: toNumber(row.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(row.pendingReviewCount) ?? 0,
        approvalRate: toNumber(row.approvalRate) ?? null,
        averageAppealScore: toNumber(row.averageAppealScore) ?? null,
        selectedWorkerCounts: summarizeCountMap(row.selectedWorkerCounts),
        generationModeCounts: summarizeCountMap(row.generationModeCounts),
        latestObservedAt: toTrimmed(row.latestObservedAt, "") || null,
        songIds: Array.isArray(row.songIds)
            ? row.songIds.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
    };
}

function summarizeLearnedBackboneBenchmarkSearchBudgetRow(row: JsonRecord): OperatorLearnedBackboneBenchmarkSearchBudgetRow {
    return {
        searchBudgetLevel: toTrimmed(row.searchBudgetLevel, "") || null,
        searchBudgetDescriptor: toTrimmed(row.searchBudgetDescriptor, "") || null,
        wholePieceCandidateCount: toNumber(row.wholePieceCandidateCount) ?? 0,
        localizedRewriteBranchCount: toNumber(row.localizedRewriteBranchCount) ?? 0,
        runCount: toNumber(row.runCount) ?? 0,
        pairedRunCount: toNumber(row.pairedRunCount) ?? 0,
        reviewedRunCount: toNumber(row.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(row.pendingReviewCount) ?? 0,
        approvalRate: toNumber(row.approvalRate) ?? null,
        averageAppealScore: toNumber(row.averageAppealScore) ?? null,
        blindPreferenceWinRate: toNumber(row.blindPreferenceWinRate) ?? null,
        reviewedPairCount: toNumber(row.reviewedPairCount) ?? 0,
        decisivePairCount: toNumber(row.decisivePairCount) ?? 0,
        selectedTop1Accuracy: toNumber(row.selectedTop1Accuracy) ?? null,
        decisiveReviewedPairCount: toNumber(row.decisiveReviewedPairCount) ?? 0,
        correctSelectionCount: toNumber(row.correctSelectionCount) ?? 0,
        latestObservedAt: toTrimmed(row.latestObservedAt, "") || null,
    };
}

function summarizeLearnedBackboneBenchmarkRecentRunRow(row: JsonRecord): OperatorLearnedBackboneBenchmarkRecentRunRow {
    return {
        songId: toTrimmed(row.songId),
        benchmarkId: toTrimmed(row.benchmarkId, "") || null,
        planSignature: toTrimmed(row.planSignature, "") || null,
        selectedWorker: toTrimmed(row.selectedWorker, "") || null,
        approvalStatus: toTrimmed(row.approvalStatus, "") || null,
        reviewed: row.reviewed === true,
        appealScore: toNumber(row.appealScore) ?? null,
        disagreementObserved: row.disagreementObserved === true,
        promotionApplied: row.promotionApplied === true,
        selectionMode: toTrimmed(row.selectionMode, "") || null,
        counterfactualWorker: toTrimmed(row.counterfactualWorker, "") || null,
        retryLocalization: toTrimmed(row.retryLocalization, "") || null,
        benchmarkGenerationMode: toTrimmed(row.benchmarkGenerationMode, "") || null,
        selectedGenerationMode: toTrimmed(row.selectedGenerationMode, "") || null,
        selectionStopReason: toTrimmed(row.selectionStopReason, "") || null,
        reviewWeakestDimension: toTrimmed(row.reviewWeakestDimension, "") || null,
        observedAt: toTrimmed(row.observedAt, "") || null,
        wholePieceCandidateCount: toNumber(row.wholePieceCandidateCount) ?? 0,
        localizedRewriteBranchCount: toNumber(row.localizedRewriteBranchCount) ?? 0,
        searchBudgetLevel: toTrimmed(row.searchBudgetLevel, "") || null,
        searchBudgetDescriptor: toTrimmed(row.searchBudgetDescriptor, "") || null,
    };
}

function summarizeLearnedBackboneBenchmarkReviewQueueRow(row: JsonRecord): OperatorLearnedBackboneBenchmarkReviewQueueRow {
    return {
        songId: toTrimmed(row.songId),
        benchmarkId: toTrimmed(row.benchmarkId, "") || null,
        planSignature: toTrimmed(row.planSignature, "") || null,
        reviewTarget: toTrimmed(row.reviewTarget, "") || null,
        selectedWorker: toTrimmed(row.selectedWorker, "") || null,
        counterfactualWorker: toTrimmed(row.counterfactualWorker, "") || null,
        selectionMode: toTrimmed(row.selectionMode, "") || null,
        observedAt: toTrimmed(row.observedAt, "") || null,
        wholePieceCandidateCount: toNumber(row.wholePieceCandidateCount) ?? 0,
        localizedRewriteBranchCount: toNumber(row.localizedRewriteBranchCount) ?? 0,
        searchBudgetLevel: toTrimmed(row.searchBudgetLevel, "") || null,
        searchBudgetDescriptor: toTrimmed(row.searchBudgetDescriptor, "") || null,
        shortlistTopK: toNumber(row.shortlistTopK) ?? null,
        selectedRank: toNumber(row.selectedRank) ?? null,
        selectedInShortlist: row.selectedInShortlist === true,
    };
}

function summarizeLearnedBackboneBenchmarkConfigSnapshot(
    value: unknown,
): OperatorLearnedBackboneBenchmarkConfigSnapshot | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        lane: toTrimmed(record.lane, "") || null,
        benchmarkPackVersion: toTrimmed(record.benchmarkPackVersion, "") || null,
        benchmarkIds: Array.isArray(record.benchmarkIds)
            ? record.benchmarkIds.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
        pairedWorkers: Array.isArray(record.pairedWorkers)
            ? record.pairedWorkers.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
        workflowCounts: summarizeCountMap(record.workflowCounts),
        promptPackVersionCounts: summarizeCountMap(record.promptPackVersionCounts),
        reviewRubricVersionCounts: summarizeCountMap(record.reviewRubricVersionCounts),
        generationModeCounts: summarizeCountMap(record.generationModeCounts),
    };
}

function summarizeLearnedBackboneBenchmarkReviewSampleStatus(
    value: unknown,
): OperatorLearnedBackboneBenchmarkReviewSampleStatus | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    const reviewedRunCount = toNumber(record.reviewedRunCount) ?? 0;
    const reviewedDisagreementCount = toNumber(record.reviewedDisagreementCount) ?? 0;
    const minimumReviewedRunCountForScreening = toNumber(record.minimumReviewedRunCountForScreening) ?? 0;
    const minimumReviewedRunCountForPromotion = toNumber(record.minimumReviewedRunCountForPromotion) ?? 0;
    const minimumReviewedDisagreementCountForPromotion = toNumber(record.minimumReviewedDisagreementCountForPromotion) ?? 0;

    return {
        status: toTrimmed(record.status, "") || null,
        directionalOnly: record.directionalOnly === true,
        reviewedRunCount,
        reviewedDisagreementCount,
        minimumReviewedRunCountForScreening,
        minimumReviewedRunCountForPromotion,
        minimumReviewedDisagreementCountForPromotion,
        remainingReviewedRunCountForScreening: toNumber(record.remainingReviewedRunCountForScreening) ?? Math.max(0, minimumReviewedRunCountForScreening - reviewedRunCount),
        remainingReviewedRunCountForPromotion: toNumber(record.remainingReviewedRunCountForPromotion) ?? Math.max(0, minimumReviewedRunCountForPromotion - reviewedRunCount),
        remainingReviewedDisagreementCountForPromotion: toNumber(record.remainingReviewedDisagreementCountForPromotion) ?? Math.max(0, minimumReviewedDisagreementCountForPromotion - reviewedDisagreementCount),
        meetsEarlyScreeningMinimum: record.meetsEarlyScreeningMinimum === true,
        meetsPromotionReviewedMinimum: record.meetsPromotionReviewedMinimum === true,
        meetsPromotionDisagreementMinimum: record.meetsPromotionDisagreementMinimum === true,
    };
}

function summarizeLearnedBackboneBenchmarkReviewQueue(
    value: unknown,
): OperatorLearnedBackboneBenchmarkReviewQueue | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        pendingBlindReviewCount: toNumber(record.pendingBlindReviewCount) ?? 0,
        pendingShortlistReviewCount: toNumber(record.pendingShortlistReviewCount) ?? 0,
        latestPendingAt: toTrimmed(record.latestPendingAt, "") || null,
        recentPendingRows: Array.isArray(record.recentPendingRows)
            ? toRecordArray(record.recentPendingRows).slice(0, 5).map(summarizeLearnedBackboneBenchmarkReviewQueueRow)
            : [],
    };
}

function summarizeLearnedBackboneBenchmarkReviewPackRow(
    row: JsonRecord,
): OperatorLearnedBackboneBenchmarkReviewPackRow {
    return {
        packId: toTrimmed(row.packId),
        generatedAt: toTrimmed(row.generatedAt, "") || null,
        reviewTarget: toTrimmed(row.reviewTarget, "") || null,
        searchBudget: toTrimmed(row.searchBudget, "") || null,
        entryCount: toNumber(row.entryCount) ?? 0,
        completedDecisionCount: toNumber(row.completedDecisionCount) ?? 0,
        pendingDecisionCount: toNumber(row.pendingDecisionCount) ?? 0,
        pendingShortlistDecisionCount: toNumber(row.pendingShortlistDecisionCount) ?? 0,
        latestReviewedAt: toTrimmed(row.latestReviewedAt, "") || null,
        reviewSheetPath: toTrimmed(row.reviewSheetPath, "") || null,
    };
}

function summarizeLearnedBackboneBenchmarkReviewPacks(
    value: unknown,
): OperatorLearnedBackboneBenchmarkReviewPacks | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        matchedPackCount: toNumber(record.matchedPackCount) ?? 0,
        activePackCount: toNumber(record.activePackCount) ?? 0,
        pendingDecisionCount: toNumber(record.pendingDecisionCount) ?? 0,
        completedDecisionCount: toNumber(record.completedDecisionCount) ?? 0,
        latestGeneratedAt: toTrimmed(record.latestGeneratedAt, "") || null,
        latestReviewedAt: toTrimmed(record.latestReviewedAt, "") || null,
        recentActivePacks: Array.isArray(record.recentActivePacks)
            ? toRecordArray(record.recentActivePacks).slice(0, 5).map(summarizeLearnedBackboneBenchmarkReviewPackRow)
            : [],
    };
}

function buildLearnedBackboneReviewPackCommand(
    reviewTarget: string | null,
    pendingOnly: boolean,
    searchBudget: string | null = null,
): string {
    const args: string[] = [];
    if (pendingOnly) {
        args.push("--pendingOnly");
    }
    if (toTrimmed(reviewTarget, "") && reviewTarget !== "all") {
        args.push(`--reviewTarget=${toTrimmed(reviewTarget)}`);
    }
    if (toTrimmed(searchBudget, "")) {
        args.push(`--searchBudget=\"${toTrimmed(searchBudget)}\"`);
    }
    return `npm run ml:review-pack:learned-backbone -- ${args.join(" ")}`.trimEnd();
}

function buildLearnedBackboneCustomReviewPackActions(
    reviewQueue: OperatorLearnedBackboneBenchmarkReviewQueue | null,
    searchBudgetRows: OperatorLearnedBackboneBenchmarkSearchBudgetRow[],
    existingActionCount: number,
): OperatorLearnedBackboneBenchmarkReviewPackAction[] {
    const customBudgetRows = searchBudgetRows
        .filter((row) => toTrimmed(row.searchBudgetLevel, "") === "custom" && (toNumber(row.pendingReviewCount) ?? 0) > 0)
        .sort(
            (left, right) => left.wholePieceCandidateCount - right.wholePieceCandidateCount
                || left.localizedRewriteBranchCount - right.localizedRewriteBranchCount
                || toTrimmed(left.searchBudgetDescriptor).localeCompare(toTrimmed(right.searchBudgetDescriptor)),
        );
    if (customBudgetRows.length > 0) {
        return customBudgetRows.map((row, index) => ({
            reviewTarget: "all",
            searchBudget: toTrimmed(row.searchBudgetDescriptor, "") || toTrimmed(row.searchBudgetLevel, "") || null,
            pendingOnly: true,
            pendingPairCount: toNumber(row.pendingReviewCount) ?? 0,
            priority: index === 0
                ? (existingActionCount > 0 ? "after_general_queue" : "first")
                : "after_previous_budget_focus",
            command: buildLearnedBackboneReviewPackCommand(
                "all",
                true,
                toTrimmed(row.searchBudgetDescriptor, "") || toTrimmed(row.searchBudgetLevel, "") || null,
            ),
        }));
    }

    const pendingBudgetCounts = new Map<string, number>();
    for (const row of reviewQueue?.recentPendingRows ?? []) {
        const searchBudgetLevel = toTrimmed(row.searchBudgetLevel, "");
        const searchBudget = toTrimmed(row.searchBudgetDescriptor, "") || searchBudgetLevel;
        if (searchBudgetLevel !== "custom" || !searchBudget) {
            continue;
        }
        pendingBudgetCounts.set(searchBudget, (pendingBudgetCounts.get(searchBudget) ?? 0) + 1);
    }

    return [...pendingBudgetCounts.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([searchBudget, pendingPairCount], index) => ({
            reviewTarget: "all",
            searchBudget,
            pendingOnly: true,
            pendingPairCount,
            priority: index === 0
                ? (existingActionCount > 0 ? "after_general_queue" : "first")
                : "after_previous_budget_focus",
            command: buildLearnedBackboneReviewPackCommand("all", true, searchBudget),
        }));
}

function summarizeActiveLearnedBackboneReviewPackCoverage(
    reviewPacks: OperatorLearnedBackboneBenchmarkReviewPacks | null,
): {
    pendingDecisionCount: number;
    pendingShortlistDecisionCount: number;
} {
    return (reviewPacks?.recentActivePacks ?? []).reduce(
        (summary, item) => {
            summary.pendingDecisionCount += toNumber(item.pendingDecisionCount) ?? 0;
            summary.pendingShortlistDecisionCount += toNumber(item.pendingShortlistDecisionCount) ?? 0;
            return summary;
        },
        {
            pendingDecisionCount: 0,
            pendingShortlistDecisionCount: 0,
        },
    );
}

function buildLearnedBackboneBenchmarkReviewPackActions(
    reviewQueue: OperatorLearnedBackboneBenchmarkReviewQueue | null,
    reviewPacks: OperatorLearnedBackboneBenchmarkReviewPacks | null,
    searchBudgetRows: OperatorLearnedBackboneBenchmarkSearchBudgetRow[],
): OperatorLearnedBackboneBenchmarkReviewPackAction[] {
    if (!reviewQueue) {
        return [];
    }

    const activeCoverage = summarizeActiveLearnedBackboneReviewPackCoverage(reviewPacks);
    const pendingBlind = toNumber(reviewQueue.pendingBlindReviewCount) ?? 0;
    const pendingShortlist = toNumber(reviewQueue.pendingShortlistReviewCount) ?? 0;
    const uncoveredBlind = Math.max(0, pendingBlind - activeCoverage.pendingDecisionCount);
    const uncoveredShortlist = Math.max(0, pendingShortlist - activeCoverage.pendingShortlistDecisionCount);
    const uncoveredPairwise = Math.max(0, uncoveredBlind - uncoveredShortlist);
    if (uncoveredBlind <= 0) {
        return [];
    }

    const actions: OperatorLearnedBackboneBenchmarkReviewPackAction[] = [];

    if (uncoveredShortlist > 0) {
        actions.push({
            reviewTarget: "shortlist",
            searchBudget: null,
            pendingOnly: true,
            pendingPairCount: uncoveredShortlist,
            priority: "first",
            command: buildLearnedBackboneReviewPackCommand("shortlist", true),
        });
    }

    if (uncoveredPairwise > 0) {
        actions.push({
            reviewTarget: "pairwise",
            searchBudget: null,
            pendingOnly: true,
            pendingPairCount: uncoveredPairwise,
            priority: uncoveredShortlist > 0 ? "after_shortlist" : "first",
            command: buildLearnedBackboneReviewPackCommand("pairwise", true),
        });
    }

    if (activeCoverage.pendingDecisionCount === 0) {
        actions.push(...buildLearnedBackboneCustomReviewPackActions(reviewQueue, searchBudgetRows, actions.length));
    }

    return actions;
}

function buildLearnedBackboneBenchmarkReviewPackRecordActions(
    reviewPacks: OperatorLearnedBackboneBenchmarkReviewPacks | null,
): OperatorLearnedBackboneBenchmarkReviewPackRecordAction[] {
    if (!reviewPacks) {
        return [];
    }

    return (reviewPacks.recentActivePacks ?? [])
        .filter((item) => toTrimmed(item.reviewSheetPath, "") !== "")
        .map((item, index) => ({
            packId: toTrimmed(item.packId),
            reviewTarget: toTrimmed(item.reviewTarget, "") || null,
            searchBudget: toTrimmed(item.searchBudget, "") || null,
            pendingDecisionCount: toNumber(item.pendingDecisionCount) ?? 0,
            pendingShortlistDecisionCount: toNumber(item.pendingShortlistDecisionCount) ?? 0,
            reviewSheetPath: toTrimmed(item.reviewSheetPath, "") || null,
            priority: index === 0 ? "first" : "after_previous",
            command: `npm run ml:review-pack:record:learned-backbone -- --resultsFile ${toTrimmed(item.reviewSheetPath)}`,
        }));
}

function summarizeLearnedBackboneBenchmarkDisagreementSummary(
    value: unknown,
): OperatorLearnedBackboneBenchmarkDisagreementSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        pairedRunCount: toNumber(record.pairedRunCount) ?? 0,
        disagreementRunCount: toNumber(record.disagreementRunCount) ?? 0,
        reviewedDisagreementCount: toNumber(record.reviewedDisagreementCount) ?? 0,
        promotionAppliedCount: toNumber(record.promotionAppliedCount) ?? 0,
        learnedSelectedWithoutPromotionCount: toNumber(record.learnedSelectedWithoutPromotionCount) ?? 0,
        baselineSelectedCount: toNumber(record.baselineSelectedCount) ?? 0,
    };
}

function summarizeLearnedBackboneBenchmarkRetryLocalizationStability(
    value: unknown,
): OperatorLearnedBackboneBenchmarkRetryLocalizationStability | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        retryingRunCount: toNumber(record.retryingRunCount) ?? 0,
        sectionTargetedOnlyCount: toNumber(record.sectionTargetedOnlyCount) ?? 0,
        mixedCount: toNumber(record.mixedCount) ?? 0,
        globalOnlyCount: toNumber(record.globalOnlyCount) ?? 0,
        sectionTargetedRate: toNumber(record.sectionTargetedRate) ?? null,
        driftRate: toNumber(record.driftRate) ?? null,
        status: toTrimmed(record.status, "") || null,
    };
}

function summarizeLearnedBackboneBenchmarkBlindPreference(
    value: unknown,
): OperatorLearnedBackboneBenchmarkBlindPreference | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        available: record.available === true,
        winRate: toNumber(record.winRate) ?? null,
        reviewedPairCount: toNumber(record.reviewedPairCount) ?? 0,
        decisivePairCount: toNumber(record.decisivePairCount) ?? 0,
        learnedWinCount: toNumber(record.learnedWinCount) ?? 0,
        baselineWinCount: toNumber(record.baselineWinCount) ?? 0,
        tieCount: toNumber(record.tieCount) ?? 0,
        latestReviewedAt: toTrimmed(record.latestReviewedAt, "") || null,
        reason: toTrimmed(record.reason, "") || null,
    };
}

function summarizeLearnedBackboneBenchmarkReviewedTop1Accuracy(
    value: unknown,
): OperatorLearnedBackboneBenchmarkReviewedTop1Accuracy | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        available: record.available === true,
        decisiveReviewedPairCount: toNumber(record.decisiveReviewedPairCount) ?? 0,
        correctSelectionCount: toNumber(record.correctSelectionCount) ?? 0,
        selectedTop1Accuracy: toNumber(record.selectedTop1Accuracy) ?? null,
        learnedSelectedReviewedPairCount: toNumber(record.learnedSelectedReviewedPairCount) ?? 0,
        learnedCorrectSelectionCount: toNumber(record.learnedCorrectSelectionCount) ?? 0,
        learnedSelectedTop1Accuracy: toNumber(record.learnedSelectedTop1Accuracy) ?? null,
        baselineSelectedReviewedPairCount: toNumber(record.baselineSelectedReviewedPairCount) ?? 0,
        baselineCorrectSelectionCount: toNumber(record.baselineCorrectSelectionCount) ?? 0,
        baselineSelectedTop1Accuracy: toNumber(record.baselineSelectedTop1Accuracy) ?? null,
        promotedReviewedPairCount: toNumber(record.promotedReviewedPairCount) ?? 0,
        promotedCorrectSelectionCount: toNumber(record.promotedCorrectSelectionCount) ?? 0,
        promotedTop1Accuracy: toNumber(record.promotedTop1Accuracy) ?? null,
        latestReviewedAt: toTrimmed(record.latestReviewedAt, "") || null,
        reason: toTrimmed(record.reason, "") || null,
    };
}

function summarizeLearnedBackboneBenchmarkWorkerOutcomeSummary(
    value: unknown,
): OperatorLearnedBackboneBenchmarkWorkerOutcomeSummary {
    const record = toRecord(value);
    return {
        runCount: toNumber(record?.runCount) ?? 0,
        reviewedRunCount: toNumber(record?.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(record?.pendingReviewCount) ?? 0,
        approvedCount: toNumber(record?.approvedCount) ?? 0,
        rejectedCount: toNumber(record?.rejectedCount) ?? 0,
        approvalRate: toNumber(record?.approvalRate) ?? null,
        averageAppealScore: toNumber(record?.averageAppealScore) ?? null,
    };
}

function summarizeLearnedBackboneBenchmarkWorkerOutcomes(
    value: unknown,
): Record<string, OperatorLearnedBackboneBenchmarkWorkerOutcomeSummary> {
    const record = toRecord(value);
    if (!record) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(record)
            .map(([worker, summary]) => [toTrimmed(worker, "unknown") || "unknown", summarizeLearnedBackboneBenchmarkWorkerOutcomeSummary(summary)]),
    );
}

function summarizeLearnedBackboneBenchmarkPairedSelectionOutcomes(
    value: unknown,
): OperatorLearnedBackboneBenchmarkPairedSelectionOutcomes | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        lane: toTrimmed(record.lane, "") || null,
        benchmarkPackVersion: toTrimmed(record.benchmarkPackVersion, "") || null,
        reviewedManifestCount: toNumber(record.reviewedManifestCount) ?? 0,
        promotedReviewedCount: toNumber(record.promotedReviewedCount) ?? 0,
        promotedApprovalRate: toNumber(record.promotedApprovalRate) ?? null,
        promotedAverageAppealScore: toNumber(record.promotedAverageAppealScore) ?? null,
        heuristicReviewedCount: toNumber(record.heuristicReviewedCount) ?? 0,
        heuristicApprovalRate: toNumber(record.heuristicApprovalRate) ?? null,
        heuristicAverageAppealScore: toNumber(record.heuristicAverageAppealScore) ?? null,
    };
}

function summarizeLearnedBackboneBenchmarkPromotionGate(
    value: unknown,
): OperatorLearnedBackboneBenchmarkPromotionGate | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        status: toTrimmed(record.status, "") || null,
        signal: toTrimmed(record.signal, "") || null,
        minimumReviewedRunCount: toNumber(record.minimumReviewedRunCount) ?? 0,
        minimumReviewedDisagreementCount: toNumber(record.minimumReviewedDisagreementCount) ?? 0,
        minimumReviewedSelectedInShortlistRate: toNumber(record.minimumReviewedSelectedInShortlistRate) ?? null,
        meetsReviewedRunMinimum: record.meetsReviewedRunMinimum === true,
        meetsReviewedDisagreementMinimum: record.meetsReviewedDisagreementMinimum === true,
        meetsReviewedSelectedInShortlistMinimum: record.meetsReviewedSelectedInShortlistMinimum === true,
        retryLocalizationStable: record.retryLocalizationStable === true,
        blindPreferenceAvailable: record.blindPreferenceAvailable === true,
        blindPreferenceWinRate: toNumber(record.blindPreferenceWinRate) ?? null,
        reviewedSelectedInShortlistRate: toNumber(record.reviewedSelectedInShortlistRate) ?? null,
        reviewedSelectedTop1Rate: toNumber(record.reviewedSelectedTop1Rate) ?? null,
        approvalRateDelta: toNumber(record.approvalRateDelta) ?? null,
        appealScoreDelta: toNumber(record.appealScoreDelta) ?? null,
        positiveSignals: Array.isArray(record.positiveSignals)
            ? record.positiveSignals.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
        negativeSignals: Array.isArray(record.negativeSignals)
            ? record.negativeSignals.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
        blockers: Array.isArray(record.blockers)
            ? record.blockers.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
        rationale: toTrimmed(record.rationale, "") || null,
    };
}

function summarizeLearnedBackboneBenchmark(value: unknown): OperatorLearnedBackboneBenchmarkSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    const reviewQueue = summarizeLearnedBackboneBenchmarkReviewQueue(record.reviewQueue);
    const reviewPacks = summarizeLearnedBackboneBenchmarkReviewPacks(record.reviewPacks);
    const searchBudgetRows = Array.isArray(record.searchBudgetRows)
        ? toRecordArray(record.searchBudgetRows).slice(0, 5).map(summarizeLearnedBackboneBenchmarkSearchBudgetRow)
        : [];

    return {
        lane: toTrimmed(record.lane, "") || null,
        benchmarkPackVersion: toTrimmed(record.benchmarkPackVersion, "") || null,
        runCount: toNumber(record.runCount) ?? 0,
        pairedRunCount: toNumber(record.pairedRunCount) ?? 0,
        reviewedRunCount: toNumber(record.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(record.pendingReviewCount) ?? 0,
        approvalRate: toNumber(record.approvalRate) ?? null,
        averageAppealScore: toNumber(record.averageAppealScore) ?? null,
        configSnapshot: summarizeLearnedBackboneBenchmarkConfigSnapshot(record.configSnapshot),
        blindPreference: summarizeLearnedBackboneBenchmarkBlindPreference(record.blindPreference),
        shortlistBlindPreference: summarizeLearnedBackboneBenchmarkBlindPreference(record.shortlistBlindPreference),
        reviewedTop1Accuracy: summarizeLearnedBackboneBenchmarkReviewedTop1Accuracy(record.reviewedTop1Accuracy),
        promotionGate: summarizeLearnedBackboneBenchmarkPromotionGate(record.promotionGate),
        reviewSampleStatus: summarizeLearnedBackboneBenchmarkReviewSampleStatus(record.reviewSampleStatus),
        reviewQueue,
        reviewPacks,
        reviewPackActions: buildLearnedBackboneBenchmarkReviewPackActions(reviewQueue, reviewPacks, searchBudgetRows),
        reviewPackRecordActions: buildLearnedBackboneBenchmarkReviewPackRecordActions(reviewPacks),
        disagreementSummary: summarizeLearnedBackboneBenchmarkDisagreementSummary(record.disagreementSummary),
        retryLocalizationStability: summarizeLearnedBackboneBenchmarkRetryLocalizationStability(record.retryLocalizationStability),
        selectionModeCounts: summarizeCountMap(record.selectionModeCounts),
        searchBudgetCounts: summarizeCountMap(record.searchBudgetCounts),
        selectedWorkerOutcomes: summarizeLearnedBackboneBenchmarkWorkerOutcomes(record.selectedWorkerOutcomes),
        pairedSelectionOutcomes: summarizeLearnedBackboneBenchmarkPairedSelectionOutcomes(record.pairedSelectionOutcomes),
        promotionAdvantage: parseShadowRerankerPromotionAdvantage(record.promotionAdvantage),
        coverageRows: Array.isArray(record.coverageRows)
            ? toRecordArray(record.coverageRows).slice(0, 5).map(summarizeLearnedBackboneBenchmarkCoverageRow)
            : [],
        searchBudgetRows,
        topFailureModes: Array.isArray(record.topFailureModes)
            ? toRecordArray(record.topFailureModes).slice(0, 5).map(summarizeLearnedBackboneBenchmarkFailureModeRow)
            : [],
        topStopReasons: Array.isArray(record.topStopReasons)
            ? toRecordArray(record.topStopReasons).slice(0, 5).map(summarizeLearnedBackboneBenchmarkStopReasonRow)
            : [],
        recentRunRows: Array.isArray(record.recentRunRows)
            ? toRecordArray(record.recentRunRows).slice(0, 5).map(summarizeLearnedBackboneBenchmarkRecentRunRow)
            : [],
    };
}

function summarizeShadowRerankerRecentDisagreement(row: JsonRecord): OperatorShadowRerankerRecentDisagreement {
    return {
        songId: toTrimmed(row.songId),
        updatedAt: toTrimmed(row.updatedAt),
        snapshotId: toTrimmed(row.snapshotId, "") || null,
        lane: toTrimmed(row.lane, "") || null,
        selectedCandidateId: toTrimmed(row.selectedCandidateId, "") || null,
        selectedWorker: toTrimmed(row.selectedWorker, "") || null,
        learnedTopCandidateId: toTrimmed(row.learnedTopCandidateId, "") || null,
        learnedTopWorker: toTrimmed(row.learnedTopWorker, "") || null,
        learnedConfidence: toNumber(row.learnedConfidence) ?? null,
        reason: toTrimmed(row.reason, "") || null,
    };
}

function summarizeShadowRerankerRecentPromotion(row: JsonRecord): OperatorShadowRerankerRecentPromotion {
    return {
        songId: toTrimmed(row.songId),
        updatedAt: toTrimmed(row.updatedAt),
        snapshotId: toTrimmed(row.snapshotId, "") || null,
        lane: toTrimmed(row.lane, "") || null,
        selectedCandidateId: toTrimmed(row.selectedCandidateId, "") || null,
        selectedWorker: toTrimmed(row.selectedWorker, "") || null,
        heuristicCounterfactualCandidateId: toTrimmed(row.heuristicCounterfactualCandidateId, "") || null,
        heuristicCounterfactualWorker: toTrimmed(row.heuristicCounterfactualWorker, "") || null,
        learnedConfidence: toNumber(row.learnedConfidence) ?? null,
        reason: toTrimmed(row.reason, "") || null,
    };
}

function summarizeShadowRerankerRecentShortlist(row: JsonRecord): OperatorShadowRerankerRecentShortlist {
    return {
        songId: toTrimmed(row.songId),
        updatedAt: toTrimmed(row.updatedAt),
        snapshotId: toTrimmed(row.snapshotId, "") || null,
        lane: toTrimmed(row.lane, "") || null,
        selectedCandidateId: toTrimmed(row.selectedCandidateId, "") || null,
        selectedWorker: toTrimmed(row.selectedWorker, "") || null,
        heuristicTopCandidateId: toTrimmed(row.heuristicTopCandidateId, "") || null,
        learnedTopCandidateId: toTrimmed(row.learnedTopCandidateId, "") || null,
        topK: toNumber(row.topK) ?? 0,
        selectedRank: toNumber(row.selectedRank) ?? null,
        selectedInShortlist: row.selectedInShortlist === true,
        shortlistedCandidateIds: Array.isArray(row.shortlistedCandidateIds)
            ? row.shortlistedCandidateIds.map((value) => toTrimmed(value)).filter(Boolean)
            : [],
    };
}

function summarizeShadowRerankerShortlist(value: unknown): OperatorShadowRerankerShortlistSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        lane: toTrimmed(record.lane, "") || null,
        scoredManifestCount: toNumber(record.scoredManifestCount) ?? 0,
        reviewedManifestCount: toNumber(record.reviewedManifestCount) ?? 0,
        topKCounts: summarizeCountMap(record.topKCounts),
        selectedInShortlistCount: toNumber(record.selectedInShortlistCount) ?? 0,
        selectedInShortlistRate: toNumber(record.selectedInShortlistRate) ?? null,
        selectedOutsideShortlistCount: toNumber(record.selectedOutsideShortlistCount) ?? 0,
        selectedTop1Count: toNumber(record.selectedTop1Count) ?? 0,
        selectedTop1Rate: toNumber(record.selectedTop1Rate) ?? null,
        reviewedSelectedInShortlistCount: toNumber(record.reviewedSelectedInShortlistCount) ?? 0,
        reviewedSelectedInShortlistRate: toNumber(record.reviewedSelectedInShortlistRate) ?? null,
        reviewedSelectedTop1Count: toNumber(record.reviewedSelectedTop1Count) ?? 0,
        reviewedSelectedTop1Rate: toNumber(record.reviewedSelectedTop1Rate) ?? null,
    };
}

function summarizeShadowRerankerRuntimeWindow(value: unknown): OperatorShadowRerankerRuntimeWindowSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        windowHours: toNumber(record.windowHours) ?? 0,
        sampledEntries: toNumber(record.sampledEntries) ?? 0,
        disagreementCount: toNumber(record.disagreementCount) ?? 0,
        highConfidenceDisagreementCount: toNumber(record.highConfidenceDisagreementCount) ?? 0,
        agreementRate: toNumber(record.agreementRate) ?? null,
        averageConfidence: toNumber(record.averageConfidence) ?? null,
        lastSeenAt: toTrimmed(record.lastSeenAt, "") || null,
    };
}

function summarizeShadowRerankerPromotionOutcomes(value: unknown): OperatorShadowRerankerPromotionOutcomeSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        lane: toTrimmed(record.lane, "") || null,
        scoredManifestCount: toNumber(record.scoredManifestCount) ?? 0,
        reviewedManifestCount: toNumber(record.reviewedManifestCount) ?? 0,
        pendingReviewCount: toNumber(record.pendingReviewCount) ?? 0,
        promotedSelectionCount: toNumber(record.promotedSelectionCount) ?? 0,
        promotedReviewedCount: toNumber(record.promotedReviewedCount) ?? 0,
        promotedApprovedCount: toNumber(record.promotedApprovedCount) ?? 0,
        promotedRejectedCount: toNumber(record.promotedRejectedCount) ?? 0,
        promotedApprovalRate: toNumber(record.promotedApprovalRate) ?? null,
        promotedAverageAppealScore: toNumber(record.promotedAverageAppealScore) ?? null,
        heuristicReviewedCount: toNumber(record.heuristicReviewedCount) ?? 0,
        heuristicApprovedCount: toNumber(record.heuristicApprovedCount) ?? 0,
        heuristicRejectedCount: toNumber(record.heuristicRejectedCount) ?? 0,
        heuristicApprovalRate: toNumber(record.heuristicApprovalRate) ?? null,
        heuristicAverageAppealScore: toNumber(record.heuristicAverageAppealScore) ?? null,
    };
}

function summarizeShadowRerankerPromotionAdvantage(
    outcomes: OperatorShadowRerankerPromotionOutcomeSummary | null,
): OperatorShadowRerankerPromotionAdvantageSummary | null {
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

function parseShadowRerankerPromotionAdvantage(
    value: unknown,
): OperatorShadowRerankerPromotionAdvantageSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        lane: toTrimmed(record.lane, "") || null,
        reviewedManifestCount: toNumber(record.reviewedManifestCount) ?? 0,
        promotedReviewedCount: toNumber(record.promotedReviewedCount) ?? 0,
        heuristicReviewedCount: toNumber(record.heuristicReviewedCount) ?? 0,
        sufficientReviewSample: record.sufficientReviewSample === true,
        minimumReviewedManifestCount: toNumber(record.minimumReviewedManifestCount) ?? SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED,
        minimumReviewedPerCohortCount: toNumber(record.minimumReviewedPerCohortCount) ?? SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT,
        approvalRateDelta: toNumber(record.approvalRateDelta) ?? null,
        appealScoreDelta: toNumber(record.appealScoreDelta) ?? null,
        signal: (toTrimmed(record.signal, "insufficient_data") || "insufficient_data") as OperatorShadowRerankerPromotionAdvantageSummary["signal"],
    };
}

function summarizeShadowRerankerRetryLocalizationOutcomes(value: unknown): OperatorShadowRerankerRetryLocalizationSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        lane: toTrimmed(record.lane, "") || null,
        scoredManifestCount: toNumber(record.scoredManifestCount) ?? 0,
        retryingManifestCount: toNumber(record.retryingManifestCount) ?? 0,
        promotedRetryingCount: toNumber(record.promotedRetryingCount) ?? 0,
        promotedTargetedOnlyCount: toNumber(record.promotedTargetedOnlyCount) ?? 0,
        promotedMixedCount: toNumber(record.promotedMixedCount) ?? 0,
        promotedGlobalOnlyCount: toNumber(record.promotedGlobalOnlyCount) ?? 0,
        promotedSectionTargetedRate: toNumber(record.promotedSectionTargetedRate) ?? null,
        heuristicRetryingCount: toNumber(record.heuristicRetryingCount) ?? 0,
        heuristicTargetedOnlyCount: toNumber(record.heuristicTargetedOnlyCount) ?? 0,
        heuristicMixedCount: toNumber(record.heuristicMixedCount) ?? 0,
        heuristicGlobalOnlyCount: toNumber(record.heuristicGlobalOnlyCount) ?? 0,
        heuristicSectionTargetedRate: toNumber(record.heuristicSectionTargetedRate) ?? null,
    };
}

function summarizeShadowReranker(value: unknown): OperatorShadowRerankerSummary | null {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    const promotionOutcomes = summarizeShadowRerankerPromotionOutcomes(record.promotionOutcomes);

    return {
        manifestCount: toNumber(record.manifestCount) ?? 0,
        scoredManifestCount: toNumber(record.scoredManifestCount) ?? 0,
        disagreementCount: toNumber(record.disagreementCount) ?? 0,
        highConfidenceDisagreementCount: toNumber(record.highConfidenceDisagreementCount) ?? 0,
        promotedSelectionCount: toNumber(record.promotedSelectionCount) ?? 0,
        agreementRate: toNumber(record.agreementRate) ?? null,
        averageLearnedConfidence: toNumber(record.averageLearnedConfidence) ?? null,
        latestSnapshotId: toTrimmed(record.latestSnapshotId, "") || null,
        lastSeenAt: toTrimmed(record.lastSeenAt, "") || null,
        lastSongId: toTrimmed(record.lastSongId, "") || null,
        recentDisagreements: Array.isArray(record.recentDisagreements)
            ? toRecordArray(record.recentDisagreements).slice(0, 3).map(summarizeShadowRerankerRecentDisagreement)
            : [],
        recentPromotions: Array.isArray(record.recentPromotions)
            ? toRecordArray(record.recentPromotions).slice(0, 3).map(summarizeShadowRerankerRecentPromotion)
            : [],
        shortlist: summarizeShadowRerankerShortlist(record.shortlist),
        recentShortlists: Array.isArray(record.recentShortlists)
            ? toRecordArray(record.recentShortlists).slice(0, 3).map(summarizeShadowRerankerRecentShortlist)
            : [],
        promotionOutcomes,
        promotionAdvantage: summarizeShadowRerankerPromotionAdvantage(promotionOutcomes),
        retryLocalizationOutcomes: summarizeShadowRerankerRetryLocalizationOutcomes(record.retryLocalizationOutcomes),
        runtimeWindow: summarizeShadowRerankerRuntimeWindow(record.runtimeWindow),
    };
}

function buildArtifactPhraseBreathTrendAdvisory(item: OperatorPhraseBreathTrendSummary | null): string | null {
    if (!item) {
        return null;
    }

    if (item.weakManifestCount > 0) {
        return "phrase-breath pressure detected; inspect pickup lift, arrival broadening, and release easing before treating harmony as already solved";
    }

    return "phrase-breath trend snapshot available with no current weak-manifest pressure";
}

function summarizeArtifactPhraseBreathTrend(value: unknown): OperatorArtifactPhraseBreathTrendDiagnostic {
    const summary = summarizePhraseBreathTrend(value);

    return {
        available: Boolean(summary),
        manifestCount: summary?.manifestCount ?? 0,
        weakManifestCount: summary?.weakManifestCount ?? 0,
        pressured: (summary?.weakManifestCount ?? 0) > 0,
        lastSeenAt: summary?.lastSeenAt ?? null,
        advisory: buildArtifactPhraseBreathTrendAdvisory(summary),
    };
}

function buildArtifactHarmonicColorTrendAdvisory(item: OperatorHarmonicColorTrendSummary | null): string | null {
    if (!item) {
        return null;
    }

    if (item.weakManifestCount > 0) {
        return "harmonic-color pressure detected; inspect local color survival, tonicization pressure, and prolongation motion before treating cadence or timbre as already solved";
    }

    return "harmonic-color trend snapshot available with no current weak-manifest pressure";
}

function summarizeArtifactHarmonicColorTrend(value: unknown): OperatorArtifactHarmonicColorTrendDiagnostic {
    const summary = summarizeHarmonicColorTrend(value);

    return {
        available: Boolean(summary),
        manifestCount: summary?.manifestCount ?? 0,
        weakManifestCount: summary?.weakManifestCount ?? 0,
        pressured: (summary?.weakManifestCount ?? 0) > 0,
        lastSeenAt: summary?.lastSeenAt ?? null,
        advisory: buildArtifactHarmonicColorTrendAdvisory(summary),
    };
}

function buildArtifactShadowRerankerAdvisory(item: OperatorShadowRerankerSummary | null): string | null {
    if (!item || item.scoredManifestCount === 0) {
        return null;
    }

    if (item.promotionAdvantage && !item.promotionAdvantage.sufficientReviewSample) {
        return `narrow-lane review data is still sparse; keep authority narrow until at least ${item.promotionAdvantage.minimumReviewedManifestCount} reviewed runs with ${item.promotionAdvantage.minimumReviewedPerCohortCount} per cohort accumulate`;
    }

    if (item.promotionAdvantage?.signal === "promoted_advantage") {
        return "reviewed narrow-lane outcome data currently favors promoted selection; keep authority narrow while accumulating more reviewed samples before widening";
    }

    if (item.promotionAdvantage?.signal === "heuristic_advantage") {
        return "reviewed narrow-lane outcome data currently favors heuristic selection; keep promotion narrow until approval or appeal deltas reverse";
    }

    if (item.promotionAdvantage?.signal === "mixed") {
        return "reviewed narrow-lane outcome data is mixed across approval and appeal deltas; inspect promoted-vs-heuristic rows before widening authority";
    }

    if (item.promotionAdvantage?.signal === "parity") {
        return "reviewed narrow-lane outcome data is currently at parity between promoted and heuristic selections; accumulate more samples before widening authority";
    }

    if ((item.promotionOutcomes?.reviewedManifestCount ?? 0) > 0) {
        return "narrow-lane reranker outcome data is available; compare promoted approval and appeal rates against heuristic-reviewed runs before widening authority";
    }

    if (item.promotedSelectionCount > 0) {
        return "learned reranker promotion is active on the narrow lane; inspect recent promoted-vs-heuristic counterfactuals before broadening authority";
    }

    if (item.highConfidenceDisagreementCount > 0) {
        return "shadow reranker shows high-confidence disagreement pressure; inspect recent learned-vs-heuristic mismatches before promotion";
    }

    if (item.disagreementCount > 0) {
        return "shadow reranker disagrees with heuristic selection on recent manifests; inspect disagreement reasons before changing authority";
    }

    return "shadow reranker snapshot available with no current disagreement pressure";
}

function summarizeArtifactShadowReranker(value: unknown): OperatorArtifactShadowRerankerDiagnostic {
    const summary = summarizeShadowReranker(value);

    return {
        available: Boolean(summary) && (summary?.scoredManifestCount ?? 0) > 0,
        scoredManifestCount: summary?.scoredManifestCount ?? 0,
        disagreementCount: summary?.disagreementCount ?? 0,
        highConfidenceDisagreementCount: summary?.highConfidenceDisagreementCount ?? 0,
        promotedSelectionCount: summary?.promotedSelectionCount ?? 0,
        sufficientReviewSample: summary?.promotionAdvantage?.sufficientReviewSample ?? false,
        pressured: (summary?.disagreementCount ?? 0) > 0,
        lastSeenAt: summary?.lastSeenAt ?? null,
        advisory: buildArtifactShadowRerankerAdvisory(summary),
    };
}

function buildArtifactOrchestrationTrendAdvisory(item: OperatorOrchestrationTrendSummary | null): string | null {
    if (!item) {
        return null;
    }

    const family = formatOrchestrationTrendFamily(item.family) ?? "ensemble";
    if (item.weakManifestCount > 0) {
        return `${family} ensemble pressure detected; inspect register balance, doubling, rotation, handoff, and conversation before treating timbre as the root issue`;
    }

    return `${family} trend snapshot available with no current weak-manifest pressure`;
}

function summarizeArtifactOrchestrationTrend(value: unknown): OperatorArtifactOrchestrationTrendDiagnostic {
    const rows = Array.isArray(value)
        ? toRecordArray(value).slice(0, 3).map(summarizeOrchestrationTrendRow)
        : summarizeOrchestrationTrends(value);
    const primary = rows.find((item) => item.weakManifestCount > 0) ?? rows[0] ?? null;

    return {
        available: Boolean(primary),
        family: formatOrchestrationTrendFamily(primary?.family),
        manifestCount: primary?.manifestCount ?? 0,
        weakManifestCount: primary?.weakManifestCount ?? 0,
        pressured: (primary?.weakManifestCount ?? 0) > 0,
        lastSeenAt: primary?.lastSeenAt ?? null,
        advisory: buildArtifactOrchestrationTrendAdvisory(primary),
    };
}

function formatOrchestrationTrendArtifact(item: OperatorOrchestrationTrendSummary): string {
    const family = item.family === "string_trio"
        ? "trio"
        : toTrimmed(item.family, "unknown");
    const instruments = item.instrumentNames.length > 0
        ? item.instrumentNames.join("/")
        : "-";
    const doublingToken = typeof item.averageDoublingPressureFit === "number"
        ? [`dbl=${formatOrchestrationMetric(item.averageDoublingPressureFit)}`]
        : [];
    const rotationToken = typeof item.averageTextureRotationFit === "number"
        ? [`rot=${formatOrchestrationMetric(item.averageTextureRotationFit)}`]
        : [];
    const handoffToken = typeof item.averageSectionHandoffFit === "number"
        ? [`hnd=${formatOrchestrationMetric(item.averageSectionHandoffFit)}`]
        : [];

    return [
        `orchestrationTrend family=${family}`,
        `manifests=${item.manifestCount}`,
        `rng=${formatOrchestrationMetric(item.averageIdiomaticRangeFit)}`,
        `bal=${formatOrchestrationMetric(item.averageRegisterBalanceFit)}`,
        `conv=${formatOrchestrationMetric(item.averageEnsembleConversationFit)}`,
        ...doublingToken,
        ...rotationToken,
        ...handoffToken,
        `weakManifests=${item.weakManifestCount}`,
        `avgWeakSections=${formatOrchestrationMetric(item.averageWeakSectionCount)}`,
        `instruments=${instruments}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatPhraseBreathTrendArtifact(item: OperatorPhraseBreathTrendSummary): string {
    return [
        `phraseBreathTrend manifests=${item.manifestCount}`,
        `plan=${formatOrchestrationMetric(item.averagePlanFit)}`,
        `cov=${formatOrchestrationMetric(item.averageCoverageFit)}`,
        `pickup=${formatOrchestrationMetric(item.averagePickupFit)}`,
        `arr=${formatOrchestrationMetric(item.averageArrivalFit)}`,
        `rel=${formatOrchestrationMetric(item.averageReleaseFit)}`,
        `weakManifests=${item.weakManifestCount}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatHarmonicColorTrendArtifact(item: OperatorHarmonicColorTrendSummary): string {
    return [
        `harmonicColorTrend manifests=${item.manifestCount}`,
        `plan=${formatOrchestrationMetric(item.averagePlanFit)}`,
        `cov=${formatOrchestrationMetric(item.averageCoverageFit)}`,
        `target=${formatOrchestrationMetric(item.averageTargetFit)}`,
        `time=${formatOrchestrationMetric(item.averageTimingFit)}`,
        `tonic=${formatOrchestrationMetric(item.averageTonicizationPressureFit)}`,
        `prolong=${formatOrchestrationMetric(item.averageProlongationMotionFit)}`,
        `weakManifests=${item.weakManifestCount}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatLearnedProposalWarningArtifact(item: OperatorLearnedProposalWarningSummary): string {
    return [
        `learnedProposalWarnings manifests=${item.sampledManifestCount}`,
        `proposals=${item.proposalCount}`,
        `warningProposals=${item.proposalWithWarningsCount}`,
        `warnings=${item.totalWarningCount}`,
        `roleCollapse=${item.roleCollapseWarningCount}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatLearnedProposalWarningRowArtifact(item: OperatorLearnedProposalWarningRow): string {
    return [
        `learnedProposalWarning count=${item.count}`,
        `proposals=${item.proposalCount}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
        `song=${toTrimmed(item.lastSongId)}`,
        `warning=${toTrimmed(item.warning)}`,
    ].join(" ");
}

function formatNamedCountSummary(values: Record<string, number>): string {
    const entries = Object.entries(values)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    if (entries.length === 0) {
        return "none";
    }

    return entries
        .slice(0, 5)
        .map(([label, count]) => `${label}:${count}`)
        .join(",");
}

function formatLearnedBackboneBenchmarkArtifact(item: OperatorLearnedBackboneBenchmarkSummary): string {
    return [
        `learnedBackboneBenchmark lane=${toTrimmed(item.lane)}`,
        `pack=${toTrimmed(item.benchmarkPackVersion)}`,
        `runs=${toNumber(item.runCount) ?? 0}`,
        `paired=${toNumber(item.pairedRunCount) ?? 0}`,
        `reviewed=${toNumber(item.reviewedRunCount) ?? 0}`,
        `pendingReview=${toNumber(item.pendingReviewCount) ?? 0}`,
        `approvalRate=${formatOrchestrationMetric(item.approvalRate)}`,
        `avgAppeal=${formatOrchestrationMetric(item.averageAppealScore)}`,
        `top1Accuracy=${formatOrchestrationMetric(item.reviewedTop1Accuracy?.selectedTop1Accuracy)}`,
        `budgets=${formatNamedCountSummary(item.searchBudgetCounts)}`,
        `sampleStatus=${toTrimmed(item.reviewSampleStatus?.status)}`,
        `screeningGap=${toNumber(item.reviewSampleStatus?.remainingReviewedRunCountForScreening) ?? 0}`,
        `promotionReviewedGap=${toNumber(item.reviewSampleStatus?.remainingReviewedRunCountForPromotion) ?? 0}`,
        `promotionDisagreementGap=${toNumber(item.reviewSampleStatus?.remainingReviewedDisagreementCountForPromotion) ?? 0}`,
        `disagreements=${toNumber(item.disagreementSummary?.disagreementRunCount) ?? 0}`,
        `reviewedDisagreements=${toNumber(item.disagreementSummary?.reviewedDisagreementCount) ?? 0}`,
        `promotionSignal=${toTrimmed(item.promotionAdvantage?.signal)}`,
        `retryStatus=${toTrimmed(item.retryLocalizationStability?.status)}`,
        `targetedRate=${formatOrchestrationMetric(item.retryLocalizationStability?.sectionTargetedRate)}`,
        `driftRate=${formatOrchestrationMetric(item.retryLocalizationStability?.driftRate)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkConfigArtifact(item: OperatorLearnedBackboneBenchmarkSummary): string {
    return [
        `learnedBackboneBenchmark config lane=${toTrimmed(item.configSnapshot?.lane ?? item.lane)}`,
        `benchmarkIds=${item.configSnapshot?.benchmarkIds?.length ? item.configSnapshot.benchmarkIds.join(",") : "none"}`,
        `promptPacks=${formatNamedCountSummary(item.configSnapshot?.promptPackVersionCounts ?? {})}`,
        `reviewRubrics=${formatNamedCountSummary(item.configSnapshot?.reviewRubricVersionCounts ?? {})}`,
        `generationModes=${formatNamedCountSummary(item.configSnapshot?.generationModeCounts ?? {})}`,
        `workflows=${formatNamedCountSummary(item.configSnapshot?.workflowCounts ?? {})}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkBlindPreferenceArtifact(item: OperatorLearnedBackboneBenchmarkSummary): string {
    return [
        "learnedBackboneBenchmark blindPreference",
        `available=${boolLabel(item.blindPreference?.available === true)}`,
        `winRate=${formatOrchestrationMetric(item.blindPreference?.winRate)}`,
        `reviewedPairs=${toNumber(item.blindPreference?.reviewedPairCount) ?? 0}`,
        `decisivePairs=${toNumber(item.blindPreference?.decisivePairCount) ?? 0}`,
        `learnedWins=${toNumber(item.blindPreference?.learnedWinCount) ?? 0}`,
        `baselineWins=${toNumber(item.blindPreference?.baselineWinCount) ?? 0}`,
        `ties=${toNumber(item.blindPreference?.tieCount) ?? 0}`,
        `latestReviewedAt=${toTrimmed(item.blindPreference?.latestReviewedAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkShortlistBlindPreferenceArtifact(item: OperatorLearnedBackboneBenchmarkSummary): string {
    return [
        "learnedBackboneBenchmark shortlistBlindPreference",
        `available=${boolLabel(item.shortlistBlindPreference?.available === true)}`,
        `winRate=${formatOrchestrationMetric(item.shortlistBlindPreference?.winRate)}`,
        `reviewedPairs=${toNumber(item.shortlistBlindPreference?.reviewedPairCount) ?? 0}`,
        `decisivePairs=${toNumber(item.shortlistBlindPreference?.decisivePairCount) ?? 0}`,
        `learnedWins=${toNumber(item.shortlistBlindPreference?.learnedWinCount) ?? 0}`,
        `baselineWins=${toNumber(item.shortlistBlindPreference?.baselineWinCount) ?? 0}`,
        `ties=${toNumber(item.shortlistBlindPreference?.tieCount) ?? 0}`,
        `latestReviewedAt=${toTrimmed(item.shortlistBlindPreference?.latestReviewedAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkTop1AccuracyArtifact(item: OperatorLearnedBackboneBenchmarkSummary): string {
    return [
        "learnedBackboneBenchmark top1Accuracy",
        `available=${boolLabel(item.reviewedTop1Accuracy?.available === true)}`,
        `selected=${formatOrchestrationMetric(item.reviewedTop1Accuracy?.selectedTop1Accuracy)}`,
        `decisivePairs=${toNumber(item.reviewedTop1Accuracy?.decisiveReviewedPairCount) ?? 0}`,
        `correctSelections=${toNumber(item.reviewedTop1Accuracy?.correctSelectionCount) ?? 0}`,
        `learnedSelected=${formatOrchestrationMetric(item.reviewedTop1Accuracy?.learnedSelectedTop1Accuracy)}`,
        `baselineSelected=${formatOrchestrationMetric(item.reviewedTop1Accuracy?.baselineSelectedTop1Accuracy)}`,
        `promoted=${formatOrchestrationMetric(item.reviewedTop1Accuracy?.promotedTop1Accuracy)}`,
        `latestReviewedAt=${toTrimmed(item.reviewedTop1Accuracy?.latestReviewedAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkPairedSelectionArtifact(item: OperatorLearnedBackboneBenchmarkSummary): string {
    return [
        "learnedBackboneBenchmark pairedSelection",
        `reviewed=${toNumber(item.pairedSelectionOutcomes?.reviewedManifestCount) ?? 0}`,
        `promotedReviewed=${toNumber(item.pairedSelectionOutcomes?.promotedReviewedCount) ?? 0}`,
        `heuristicReviewed=${toNumber(item.pairedSelectionOutcomes?.heuristicReviewedCount) ?? 0}`,
        `promotedApproval=${formatOrchestrationMetric(item.pairedSelectionOutcomes?.promotedApprovalRate)}`,
        `heuristicApproval=${formatOrchestrationMetric(item.pairedSelectionOutcomes?.heuristicApprovalRate)}`,
        `promotedAppeal=${formatOrchestrationMetric(item.pairedSelectionOutcomes?.promotedAverageAppealScore)}`,
        `heuristicAppeal=${formatOrchestrationMetric(item.pairedSelectionOutcomes?.heuristicAverageAppealScore)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkSelectedWorkerOutcomeArtifact(
    worker: string,
    item: OperatorLearnedBackboneBenchmarkWorkerOutcomeSummary,
): string {
    return [
        "learnedBackboneBenchmark selectedWorkerOutcome",
        `worker=${toTrimmed(worker)}`,
        `runs=${toNumber(item.runCount) ?? 0}`,
        `reviewed=${toNumber(item.reviewedRunCount) ?? 0}`,
        `pendingReview=${toNumber(item.pendingReviewCount) ?? 0}`,
        `approved=${toNumber(item.approvedCount) ?? 0}`,
        `rejected=${toNumber(item.rejectedCount) ?? 0}`,
        `approvalRate=${formatOrchestrationMetric(item.approvalRate)}`,
        `avgAppeal=${formatOrchestrationMetric(item.averageAppealScore)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkCoverageArtifact(item: OperatorLearnedBackboneBenchmarkCoverageRow): string {
    return [
        "learnedBackboneBenchmark coverage",
        `benchmark=${toTrimmed(item.benchmarkId || item.benchmarkKey)}`,
        `runs=${toNumber(item.runCount) ?? 0}`,
        `paired=${toNumber(item.pairedRunCount) ?? 0}`,
        `reviewed=${toNumber(item.reviewedRunCount) ?? 0}`,
        `pendingReview=${toNumber(item.pendingReviewCount) ?? 0}`,
        `approvalRate=${formatOrchestrationMetric(item.approvalRate)}`,
        `avgAppeal=${formatOrchestrationMetric(item.averageAppealScore)}`,
        `selectedWorkers=${formatNamedCountSummary(item.selectedWorkerCounts)}`,
        `generationModes=${formatNamedCountSummary(item.generationModeCounts)}`,
        `lastObserved=${toTrimmed(item.latestObservedAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkReviewQueueArtifact(item: OperatorLearnedBackboneBenchmarkSummary): string {
    return [
        "learnedBackboneBenchmark reviewQueue",
        `pendingBlind=${toNumber(item.reviewQueue?.pendingBlindReviewCount) ?? 0}`,
        `pendingShortlist=${toNumber(item.reviewQueue?.pendingShortlistReviewCount) ?? 0}`,
        `latestPendingAt=${toTrimmed(item.reviewQueue?.latestPendingAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkReviewPacksArtifact(item: OperatorLearnedBackboneBenchmarkSummary): string {
    return [
        "learnedBackboneBenchmark reviewPacks",
        `matched=${toNumber(item.reviewPacks?.matchedPackCount) ?? 0}`,
        `active=${toNumber(item.reviewPacks?.activePackCount) ?? 0}`,
        `pendingDecisions=${toNumber(item.reviewPacks?.pendingDecisionCount) ?? 0}`,
        `completedDecisions=${toNumber(item.reviewPacks?.completedDecisionCount) ?? 0}`,
        `latestGeneratedAt=${toTrimmed(item.reviewPacks?.latestGeneratedAt)}`,
        `latestReviewedAt=${toTrimmed(item.reviewPacks?.latestReviewedAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkReviewQueueRowArtifact(item: OperatorLearnedBackboneBenchmarkReviewQueueRow): string {
    const searchBudget = toTrimmed(item.searchBudgetDescriptor, "") || toTrimmed(item.searchBudgetLevel);
    return [
        `learnedBackboneBenchmark reviewQueue song=${toTrimmed(item.songId)}`,
        `target=${toTrimmed(item.reviewTarget)}`,
        `benchmark=${toTrimmed(item.benchmarkId)}`,
        `selectedWorker=${toTrimmed(item.selectedWorker)}`,
        `counterfactual=${toTrimmed(item.counterfactualWorker)}`,
        `selectionMode=${toTrimmed(item.selectionMode)}`,
        `searchBudget=${searchBudget}`,
        `candidates=${toNumber(item.wholePieceCandidateCount) ?? 0}`,
        `topK=${formatOrchestrationMetric(item.shortlistTopK)}`,
        `selectedRank=${formatOrchestrationMetric(item.selectedRank)}`,
        `inTopK=${boolLabel(item.selectedInShortlist)}`,
        `observedAt=${toTrimmed(item.observedAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkReviewPackArtifact(item: OperatorLearnedBackboneBenchmarkReviewPackRow): string {
    const reviewSheetPath = toTrimmed(item.reviewSheetPath, "") || "-";
    const recordCommand = reviewSheetPath === "-"
        ? "-"
        : `npm run ml:review-pack:record:learned-backbone -- --resultsFile ${reviewSheetPath}`;
    const searchBudget = toTrimmed(item.searchBudget, "") || null;
    return [
        `learnedBackboneBenchmark reviewPack pack=${toTrimmed(item.packId)}`,
        `target=${toTrimmed(item.reviewTarget)}`,
        ...(searchBudget ? [`searchBudget=${searchBudget}`] : []),
        `entries=${toNumber(item.entryCount) ?? 0}`,
        `completed=${toNumber(item.completedDecisionCount) ?? 0}`,
        `pending=${toNumber(item.pendingDecisionCount) ?? 0}`,
        `pendingShortlist=${toNumber(item.pendingShortlistDecisionCount) ?? 0}`,
        `generatedAt=${toTrimmed(item.generatedAt)}`,
        `latestReviewedAt=${toTrimmed(item.latestReviewedAt)}`,
        `reviewSheet=${reviewSheetPath}`,
        `recordCommand=${recordCommand}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkReviewPackActionArtifact(item: OperatorLearnedBackboneBenchmarkReviewPackAction): string {
    const searchBudget = toTrimmed(item.searchBudget, "") || null;
    return [
        "learnedBackboneBenchmark reviewPackAction",
        `target=${toTrimmed(item.reviewTarget)}`,
        ...(searchBudget ? [`searchBudget=${searchBudget}`] : []),
        `pendingOnly=${boolLabel(item.pendingOnly)}`,
        `pendingPairs=${toNumber(item.pendingPairCount) ?? 0}`,
        `priority=${toTrimmed(item.priority)}`,
        `command=${toTrimmed(item.command)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkReviewPackRecordActionArtifact(item: OperatorLearnedBackboneBenchmarkReviewPackRecordAction): string {
    const searchBudget = toTrimmed(item.searchBudget, "") || null;
    return [
        "learnedBackboneBenchmark reviewPackRecordAction",
        `pack=${toTrimmed(item.packId)}`,
        `target=${toTrimmed(item.reviewTarget)}`,
        ...(searchBudget ? [`searchBudget=${searchBudget}`] : []),
        `pendingDecisions=${toNumber(item.pendingDecisionCount) ?? 0}`,
        `pendingShortlist=${toNumber(item.pendingShortlistDecisionCount) ?? 0}`,
        `reviewSheet=${toTrimmed(item.reviewSheetPath)}`,
        `priority=${toTrimmed(item.priority)}`,
        `command=${toTrimmed(item.command)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkSearchBudgetArtifact(item: OperatorLearnedBackboneBenchmarkSearchBudgetRow): string {
    const searchBudget = toTrimmed(item.searchBudgetDescriptor, "") || toTrimmed(item.searchBudgetLevel);
    return [
        `learnedBackboneBenchmark searchBudget=${searchBudget}`,
        `candidates=${toNumber(item.wholePieceCandidateCount) ?? 0}`,
        `runs=${toNumber(item.runCount) ?? 0}`,
        `reviewed=${toNumber(item.reviewedRunCount) ?? 0}`,
        `pendingReview=${toNumber(item.pendingReviewCount) ?? 0}`,
        `approvalRate=${formatOrchestrationMetric(item.approvalRate)}`,
        `blindPreference=${formatOrchestrationMetric(item.blindPreferenceWinRate)}`,
        `top1Accuracy=${formatOrchestrationMetric(item.selectedTop1Accuracy)}`,
        `decisivePairs=${toNumber(item.decisivePairCount) ?? 0}`,
        `correctSelections=${toNumber(item.correctSelectionCount) ?? 0}`,
        `lastObserved=${toTrimmed(item.latestObservedAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkPromotionGateArtifact(item: OperatorLearnedBackboneBenchmarkSummary): string {
    return [
        "learnedBackboneBenchmark promotionGate",
        `status=${toTrimmed(item.promotionGate?.status)}`,
        `signal=${toTrimmed(item.promotionGate?.signal)}`,
        `reviewedFloor=${boolLabel(item.promotionGate?.meetsReviewedRunMinimum === true)}`,
        `disagreementFloor=${boolLabel(item.promotionGate?.meetsReviewedDisagreementMinimum === true)}`,
        `shortlistFloor=${boolLabel(item.promotionGate?.meetsReviewedSelectedInShortlistMinimum === true)}`,
        `retryStable=${boolLabel(item.promotionGate?.retryLocalizationStable === true)}`,
        `blindPreference=${boolLabel(item.promotionGate?.blindPreferenceAvailable === true)}`,
        `reviewedInTopK=${formatOrchestrationMetric(item.promotionGate?.reviewedSelectedInShortlistRate)}`,
        `reviewedTop1=${formatOrchestrationMetric(item.promotionGate?.reviewedSelectedTop1Rate)}`,
        `shortlistMin=${formatOrchestrationMetric(item.promotionGate?.minimumReviewedSelectedInShortlistRate)}`,
        `approvalDelta=${formatOrchestrationMetric(item.promotionGate?.approvalRateDelta)}`,
        `appealDelta=${formatOrchestrationMetric(item.promotionGate?.appealScoreDelta)}`,
        `blockers=${item.promotionGate?.blockers?.length ? item.promotionGate.blockers.join(",") : "none"}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkFailureModeArtifact(item: OperatorLearnedBackboneBenchmarkFailureModeRow): string {
    return [
        `learnedBackboneBenchmark failureMode=${toTrimmed(item.failureMode)}`,
        `count=${toNumber(item.count) ?? 0}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkStopReasonArtifact(item: OperatorLearnedBackboneBenchmarkStopReasonRow): string {
    return [
        `learnedBackboneBenchmark stopReason count=${toNumber(item.count) ?? 0}`,
        `reason=${toTrimmed(item.reason)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkRecentRunArtifact(item: OperatorLearnedBackboneBenchmarkRecentRunRow): string {
    const searchBudget = toTrimmed(item.searchBudgetDescriptor, "") || toTrimmed(item.searchBudgetLevel);
    return [
        `learnedBackboneBenchmark recent song=${toTrimmed(item.songId)}`,
        `benchmark=${toTrimmed(item.benchmarkId)}`,
        `searchBudget=${searchBudget}`,
        `candidates=${toNumber(item.wholePieceCandidateCount) ?? 0}`,
        `selectedWorker=${toTrimmed(item.selectedWorker)}`,
        `approval=${toTrimmed(item.approvalStatus)}`,
        `selectionMode=${toTrimmed(item.selectionMode)}`,
        `disagreement=${boolLabel(item.disagreementObserved)}`,
        `promotion=${boolLabel(item.promotionApplied)}`,
        `retry=${toTrimmed(item.retryLocalization)}`,
        `weakest=${toTrimmed(item.reviewWeakestDimension)}`,
        `observedAt=${toTrimmed(item.observedAt)}`,
    ].join(" ");
}

function formatShadowRerankerArtifact(item: OperatorShadowRerankerSummary): string {
    return [
        `shadowReranker manifests=${item.manifestCount}`,
        `scored=${item.scoredManifestCount}`,
        `disagreements=${item.disagreementCount}`,
        `highConfidence=${item.highConfidenceDisagreementCount}`,
        `promotions=${item.promotedSelectionCount}`,
        `agreementRate=${formatOrchestrationMetric(item.agreementRate)}`,
        `avgConfidence=${formatOrchestrationMetric(item.averageLearnedConfidence)}`,
        `snapshot=${toTrimmed(item.latestSnapshotId)}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatShadowRerankerRuntimeWindowArtifact(item: OperatorShadowRerankerRuntimeWindowSummary): string {
    return [
        `shadowReranker runtimeWindow=${item.windowHours}h`,
        `sampled=${item.sampledEntries}`,
        `disagreements=${item.disagreementCount}`,
        `highConfidence=${item.highConfidenceDisagreementCount}`,
        `agreementRate=${formatOrchestrationMetric(item.agreementRate)}`,
        `avgConfidence=${formatOrchestrationMetric(item.averageConfidence)}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatShadowRerankerDisagreementArtifact(item: OperatorShadowRerankerRecentDisagreement): string {
    return [
        `shadowReranker disagreement song=${toTrimmed(item.songId)}`,
        `lane=${toTrimmed(item.lane)}`,
        `selected=${toTrimmed(item.selectedCandidateId)}`,
        `selectedWorker=${toTrimmed(item.selectedWorker)}`,
        `learnedTop=${toTrimmed(item.learnedTopCandidateId)}`,
        `learnedTopWorker=${toTrimmed(item.learnedTopWorker)}`,
        `confidence=${formatOrchestrationMetric(item.learnedConfidence)}`,
        `snapshot=${toTrimmed(item.snapshotId)}`,
        `updated=${toTrimmed(item.updatedAt)}`,
        `reason=${toTrimmed(item.reason)}`,
    ].join(" ");
}

function formatShadowRerankerPromotionArtifact(item: OperatorShadowRerankerRecentPromotion): string {
    return [
        `shadowReranker promotion song=${toTrimmed(item.songId)}`,
        `lane=${toTrimmed(item.lane)}`,
        `selected=${toTrimmed(item.selectedCandidateId)}`,
        `selectedWorker=${toTrimmed(item.selectedWorker)}`,
        `heuristicCounterfactual=${toTrimmed(item.heuristicCounterfactualCandidateId)}`,
        `heuristicCounterfactualWorker=${toTrimmed(item.heuristicCounterfactualWorker)}`,
        `confidence=${formatOrchestrationMetric(item.learnedConfidence)}`,
        `snapshot=${toTrimmed(item.snapshotId)}`,
        `updated=${toTrimmed(item.updatedAt)}`,
        `reason=${toTrimmed(item.reason)}`,
    ].join(" ");
}

function formatShadowRerankerPromotionOutcomesArtifact(item: OperatorShadowRerankerPromotionOutcomeSummary): string {
    return [
        `shadowReranker outcomes lane=${toTrimmed(item.lane)}`,
        `scored=${item.scoredManifestCount}`,
        `reviewed=${item.reviewedManifestCount}`,
        `pendingReview=${item.pendingReviewCount}`,
        `promoted=${item.promotedSelectionCount}`,
        `promotedReviewed=${item.promotedReviewedCount}`,
        `promotedApprovalRate=${formatOrchestrationMetric(item.promotedApprovalRate)}`,
        `heuristicReviewed=${item.heuristicReviewedCount}`,
        `heuristicApprovalRate=${formatOrchestrationMetric(item.heuristicApprovalRate)}`,
        `promotedAvgAppeal=${formatOrchestrationMetric(item.promotedAverageAppealScore)}`,
        `heuristicAvgAppeal=${formatOrchestrationMetric(item.heuristicAverageAppealScore)}`,
    ].join(" ");
}

function formatShadowRerankerPromotionAdvantageArtifact(item: OperatorShadowRerankerPromotionAdvantageSummary): string {
    return [
        `shadowReranker promotionAdvantage lane=${toTrimmed(item.lane)}`,
        `reviewed=${item.reviewedManifestCount}`,
        `promotedReviewed=${item.promotedReviewedCount}`,
        `heuristicReviewed=${item.heuristicReviewedCount}`,
        `sufficientSample=${boolLabel(item.sufficientReviewSample)}`,
        `approvalDelta=${formatOrchestrationMetric(item.approvalRateDelta)}`,
        `appealDelta=${formatOrchestrationMetric(item.appealScoreDelta)}`,
        `signal=${item.signal}`,
    ].join(" ");
}

function formatShadowRerankerShortlistArtifact(item: OperatorShadowRerankerShortlistSummary): string {
    return [
        `shadowReranker shortlist lane=${toTrimmed(item.lane)}`,
        `scored=${item.scoredManifestCount}`,
        `reviewed=${item.reviewedManifestCount}`,
        `topK=${formatNamedCountSummary(item.topKCounts)}`,
        `selectedInTopK=${formatOrchestrationMetric(item.selectedInShortlistRate)}`,
        `outsideTopK=${item.selectedOutsideShortlistCount}`,
        `top1=${formatOrchestrationMetric(item.selectedTop1Rate)}`,
        `reviewedInTopK=${formatOrchestrationMetric(item.reviewedSelectedInShortlistRate)}`,
        `reviewedTop1=${formatOrchestrationMetric(item.reviewedSelectedTop1Rate)}`,
    ].join(" ");
}

function formatShadowRerankerRecentShortlistArtifact(item: OperatorShadowRerankerRecentShortlist): string {
    return [
        `shadowReranker shortlist song=${toTrimmed(item.songId)}`,
        `lane=${toTrimmed(item.lane)}`,
        `topK=${item.topK}`,
        `selected=${toTrimmed(item.selectedCandidateId)}`,
        `selectedWorker=${toTrimmed(item.selectedWorker)}`,
        `selectedRank=${toTrimmed(item.selectedRank)}`,
        `inTopK=${boolLabel(item.selectedInShortlist)}`,
        `learnedTop=${toTrimmed(item.learnedTopCandidateId)}`,
        `heuristicTop=${toTrimmed(item.heuristicTopCandidateId)}`,
        `shortlisted=${item.shortlistedCandidateIds.length > 0 ? item.shortlistedCandidateIds.join(",") : "none"}`,
        `updated=${toTrimmed(item.updatedAt)}`,
    ].join(" ");
}

function formatShadowRerankerRetryLocalizationArtifact(item: OperatorShadowRerankerRetryLocalizationSummary): string {
    return [
        `shadowReranker retryLocalization lane=${toTrimmed(item.lane)}`,
        `scored=${item.scoredManifestCount}`,
        `retrying=${item.retryingManifestCount}`,
        `promotedRetrying=${item.promotedRetryingCount}`,
        `promotedTargetedOnly=${item.promotedTargetedOnlyCount}`,
        `promotedMixed=${item.promotedMixedCount}`,
        `promotedGlobalOnly=${item.promotedGlobalOnlyCount}`,
        `promotedTargetedRate=${formatOrchestrationMetric(item.promotedSectionTargetedRate)}`,
        `heuristicRetrying=${item.heuristicRetryingCount}`,
        `heuristicTargetedOnly=${item.heuristicTargetedOnlyCount}`,
        `heuristicMixed=${item.heuristicMixedCount}`,
        `heuristicGlobalOnly=${item.heuristicGlobalOnlyCount}`,
        `heuristicTargetedRate=${formatOrchestrationMetric(item.heuristicSectionTargetedRate)}`,
    ].join(" ");
}

function summarizeBacklog(jobs: SerializedQueuedJob[], observedAtMs: number) {
    const candidates = jobs
        .filter((job) => toTrimmed(job.status, "unknown") !== "done")
        .map((job) => {
            const createdAtMs = toTimestampMs(job.createdAt) ?? observedAtMs;
            return {
                jobId: toTrimmed(job.jobId),
                songId: toTrimmed(job.songId),
                status: toTrimmed(job.status, "unknown"),
                createdAt: toTrimmed(job.createdAt),
                updatedAt: toTrimmed(job.updatedAt),
                nextAttemptAt: toTrimmed(job.nextAttemptAt),
                error: toTrimmed(job.error),
                structureLongSpan: (job.quality.longSpan as JsonRecord | null | undefined) ?? null,
                audioLongSpan: (job.quality.audioLongSpan as JsonRecord | null | undefined) ?? null,
                longSpanDivergence: (job.quality.longSpanDivergence as JsonRecord | null | undefined) ?? null,
                orchestration: job.tracking?.orchestration ?? null,
                ageMs: Math.max(0, observedAtMs - createdAtMs),
            };
        })
        .sort((left, right) => right.ageMs - left.ageMs || left.createdAt.localeCompare(right.createdAt));

    const retryScheduled = candidates.filter((job) => job.status === "retry_scheduled").length;
    const failedLike = candidates.filter((job) => job.status === "failed" || job.error !== "-").length;

    return {
        count: candidates.length,
        retryScheduled,
        failedLike,
        oldestAgeMs: candidates[0]?.ageMs ?? 0,
        topJobs: candidates.slice(0, 3),
    };
}

export function getMcpDiagnosticsSnapshot() {
    const readiness = getRuntimeReadinessSummary();
    const queue = summarizeQueue(listJobs().map((job) => serializeQueuedJob(job)));
    const systemDir = path.join(config.outputDir, "_system");
    const operatorSummary = readJsonRecordIfExists(path.join(systemDir, "operator-summary", "latest.json"));
    const operatorSweep = readJsonRecordIfExists(path.join(systemDir, "operator-sweep", "latest.json"));
    const incidentDraft = readJsonRecordIfExists(path.join(systemDir, "operator-sweep", "incident-drafts", "latest.json"));
    const operatorPickup = readJsonRecordIfExists(path.join(systemDir, "operator-pickup", "latest.json"));
    const operatorSummaryTriage = toRecord(operatorSummary?.triage);
    const operatorSweepTriage = toRecord(operatorSweep?.triage);
    const operatorSummaryOverseer = toRecord(operatorSummary?.overseer);
    const operatorSweepProjection = toRecord(operatorSweep?.projection);
    const operatorSweepLatest = toRecord(operatorSweepProjection?.latest);
    const operatorSweepLatestOverseer = toRecord(operatorSweepLatest?.overseer);
    const operatorPickupOverseer = toRecord(operatorPickup?.overseer);
    const operatorPickupIncident = toRecord(operatorPickup?.incidentDraft);

    return {
        readiness,
        queue,
        operatorArtifacts: {
            operatorSummary: {
                present: Boolean(operatorSummary),
                status: compact(operatorSummaryTriage?.state) || compact(operatorSummary?.status) || null,
                observedAt: compact(operatorSummary?.observedAt) || null,
                summary: compact(operatorSummary?.summary) || null,
                phraseBreathTrend: summarizeArtifactPhraseBreathTrend(operatorSummaryOverseer?.phraseBreathTrend),
                harmonicColorTrend: summarizeArtifactHarmonicColorTrend(operatorSummaryOverseer?.harmonicColorTrend),
                shadowReranker: summarizeArtifactShadowReranker(operatorSummaryOverseer?.shadowReranker),
                orchestrationTrend: summarizeArtifactOrchestrationTrend(operatorSummaryOverseer?.orchestrationTrends),
            },
            operatorSweep: {
                present: Boolean(operatorSweep),
                status: compact(operatorSweepTriage?.state) || compact(operatorSweep?.status) || null,
                observedAt: compact(operatorSweep?.observedAt) || null,
                summary: compact(operatorSweep?.summary) || null,
                phraseBreathTrend: summarizeArtifactPhraseBreathTrend(operatorSweepLatestOverseer?.phraseBreathTrend),
                harmonicColorTrend: summarizeArtifactHarmonicColorTrend(operatorSweepLatestOverseer?.harmonicColorTrend),
                shadowReranker: summarizeArtifactShadowReranker(operatorSweepLatestOverseer?.shadowReranker),
                orchestrationTrend: summarizeArtifactOrchestrationTrend(operatorSweepLatestOverseer?.orchestrationTrends),
            },
            incidentDraft: {
                present: Boolean(incidentDraft),
                status: compact(incidentDraft?.state) || compact(incidentDraft?.status) || null,
                observedAt: compact(incidentDraft?.observedAt) || null,
                severity: compact(incidentDraft?.severity) || null,
                phraseBreathTrend: summarizeArtifactPhraseBreathTrend(incidentDraft?.phraseBreathTrend),
                harmonicColorTrend: summarizeArtifactHarmonicColorTrend(incidentDraft?.harmonicColorTrend),
                shadowReranker: summarizeArtifactShadowReranker(incidentDraft?.shadowReranker),
                orchestrationTrend: summarizeArtifactOrchestrationTrend(incidentDraft?.orchestrationTrends),
            },
            operatorPickup: {
                present: Boolean(operatorPickup),
                status: compact(operatorPickup?.status) || null,
                observedAt: compact(operatorPickup?.observedAt) || null,
                summary: compact(operatorPickup?.summary) || null,
                phraseBreathTrend: summarizeArtifactPhraseBreathTrend(
                    operatorPickupOverseer?.phraseBreathTrend ?? operatorPickupIncident?.phraseBreathTrend,
                ),
                harmonicColorTrend: summarizeArtifactHarmonicColorTrend(
                    operatorPickupOverseer?.harmonicColorTrend ?? operatorPickupIncident?.harmonicColorTrend,
                ),
                shadowReranker: summarizeArtifactShadowReranker(
                    operatorPickupOverseer?.shadowReranker ?? operatorPickupIncident?.shadowReranker,
                ),
                orchestrationTrend: summarizeArtifactOrchestrationTrend(
                    operatorPickupOverseer?.orchestrationTrends ?? operatorPickupIncident?.orchestrationTrends,
                ),
            },
        },
    };
}

function summarizeAutonomy(payload: JsonRecord, missing: string[]) {
    const operations = toRecord(payload.operations) || {};
    const dailyCap = toRecord(operations.dailyCap);
    const lockHealth = toRecord(operations.lockHealth);
    const lastRun = toRecord(payload.lastRun);
    const pendingApprovals = Array.isArray(payload.pendingApprovals)
        ? toRecordArray(payload.pendingApprovals).map(summarizePendingApproval)
        : [];

    if (!dailyCap) {
        missing.push("autonomy.operations.dailyCap");
    }
    if (!lockHealth) {
        missing.push("autonomy.operations.lockHealth");
    }
    if (!Array.isArray(payload.pendingApprovals)) {
        missing.push("autonomy.pendingApprovals");
    }

    return {
        reachable: payload.reachable === true,
        paused: payload.paused === true,
        activeRun: toRecord(payload.activeRun) || null,
        pendingApprovalCount: toNumber(payload.pendingApprovalCount) ?? 0,
        pendingApprovals,
        lastRun: lastRun ? summarizeLastRun(lastRun) : null,
        dailyCap: dailyCap || {},
        lockHealth: lockHealth || {},
        recommendations: Array.isArray(operations.recommendations)
            ? operations.recommendations.map((item) => String(item))
            : [],
    };
}

function summarizeOverseer(payload: JsonRecord, missing: string[]) {
    const warnings = toRecordArray(payload.repeatedWarnings);
    const manifestAudioRetry = toRecord(payload.manifestAudioRetry);
    if (!Array.isArray(payload.repeatedWarnings)) {
        missing.push("overseer.repeatedWarnings");
    }

    return {
        windowHours: toNumber(payload.windowHours) ?? null,
        sampledEntries: toNumber(payload.sampledEntries) ?? 0,
        lastSuccessAt: toTrimmed(payload.lastHealthyReportAt, "-"),
        lastFailureAt: toTrimmed(payload.lastFailureAt, "-"),
        failureCount24h: toNumber(payload.recentFailureCount) ?? toNumber(payload.failedRuns) ?? 0,
        activeRepeatedWarningCount: toNumber(payload.activeRepeatedWarningCount) ?? warnings.length,
        repeatedWarnings: warnings.slice(0, 3),
        phraseBreathTrend: summarizePhraseBreathTrend(manifestAudioRetry?.phraseBreathTrends),
        harmonicColorTrend: summarizeHarmonicColorTrend(manifestAudioRetry?.harmonicColorTrends),
        learnedProposalWarnings: summarizeLearnedProposalWarnings(manifestAudioRetry?.learnedProposalWarnings),
        learnedBackboneBenchmark: summarizeLearnedBackboneBenchmark(manifestAudioRetry?.learnedBackboneBenchmark),
        shadowReranker: summarizeShadowReranker(manifestAudioRetry?.shadowReranker),
        orchestrationTrends: summarizeOrchestrationTrends(manifestAudioRetry?.orchestrationTrends),
    };
}

function buildRuntimeTriage(
    readiness: RuntimeReadinessSummary,
    queue: { backlog: { failedLike: number; retryScheduled: number; oldestAgeMs: number } },
    autonomy: { pendingApprovalCount: number; lockHealth: JsonRecord },
    overseer: { activeRepeatedWarningCount: number; failureCount24h: number },
    evidence: { stale: boolean; staleReason: string },
) {
    const reasonCodes: string[] = [];
    const severityDrivers: Array<{ code: string; weight: number; detail: string }> = [];
    let incidentCandidate = false;
    let degraded = false;

    if (readiness.status === "not_ready") {
        reasonCodes.push("readiness_not_ready");
        addSeverityDriver(severityDrivers, "readiness_not_ready", severityWeightForReasonCode("readiness_not_ready"), `status=${readiness.status}`);
        incidentCandidate = true;
    } else if (readiness.status === "ready_degraded") {
        reasonCodes.push("readiness_degraded");
        addSeverityDriver(severityDrivers, "readiness_degraded", severityWeightForReasonCode("readiness_degraded"), `status=${readiness.status}`);
        degraded = true;
    }

    if (evidence.stale === true) {
        reasonCodes.push("evidence_stale");
        addSeverityDriver(severityDrivers, "evidence_stale", severityWeightForReasonCode("evidence_stale"), `reason=${toTrimmed(evidence.staleReason)}`);
        degraded = true;
    }

    if ((queue.backlog?.failedLike ?? 0) > 0) {
        reasonCodes.push("queue_failed_pressure");
        addSeverityDriver(severityDrivers, "queue_failed_pressure", severityWeightForReasonCode("queue_failed_pressure"), `count=${queue.backlog.failedLike}`);
        incidentCandidate = true;
    }
    if ((queue.backlog?.retryScheduled ?? 0) > 0) {
        reasonCodes.push("queue_retry_pressure");
        addSeverityDriver(severityDrivers, "queue_retry_pressure", severityWeightForReasonCode("queue_retry_pressure"), `count=${queue.backlog.retryScheduled}`);
        degraded = true;
    }
    if ((queue.backlog?.oldestAgeMs ?? 0) >= 15 * 60 * 1000) {
        reasonCodes.push("queue_oldest_age_high");
        addSeverityDriver(severityDrivers, "queue_oldest_age_high", severityWeightForReasonCode("queue_oldest_age_high"), `oldestAgeMs=${queue.backlog.oldestAgeMs}`);
        degraded = true;
    }

    if (autonomy.pendingApprovalCount > 0) {
        reasonCodes.push("pending_approval_backlog");
        addSeverityDriver(severityDrivers, "pending_approval_backlog", severityWeightForReasonCode("pending_approval_backlog"), `count=${autonomy.pendingApprovalCount}`);
        degraded = true;
    }

    const lockReason = toTrimmed(autonomy.lockHealth?.reason, "none");
    if (autonomy.lockHealth?.stale === true || ["lock_timeout_without_active_job", "terminal_manifest_exists", "queue_run_mismatch"].includes(lockReason)) {
        reasonCodes.push("stale_lock_detected");
        addSeverityDriver(severityDrivers, "stale_lock_detected", severityWeightForReasonCode("stale_lock_detected"), `reason=${lockReason}`);
        incidentCandidate = true;
    }

    if (overseer.activeRepeatedWarningCount > 0) {
        reasonCodes.push("repeated_warning_active");
        addSeverityDriver(
            severityDrivers,
            "repeated_warning_active",
            severityWeightForReasonCode("repeated_warning_active") + (overseer.activeRepeatedWarningCount >= 3 ? 1 : 0),
            `count=${overseer.activeRepeatedWarningCount}`,
        );
        degraded = true;
    }
    if (overseer.failureCount24h > 0) {
        reasonCodes.push("overseer_recent_failures");
        addSeverityDriver(
            severityDrivers,
            "overseer_recent_failures",
            severityWeightForReasonCode("overseer_recent_failures") + (overseer.failureCount24h >= 3 ? 1 : 0),
            `count=${overseer.failureCount24h}`,
        );
        degraded = true;
    }

    if (incidentCandidate) {
        return buildTriage("incident_candidate", "incident", reasonCodes, severityDrivers);
    }

    if (degraded || reasonCodes.length > 0) {
        return buildTriage("runtime_degraded", "routine", reasonCodes, severityDrivers);
    }

    return buildTriage("healthy", "routine", [], []);
}

function formatQueueArtifact(queue: { total: number; queued: number; running: number; retryScheduled: number; failedLike: number }) {
    return `queue total=${queue.total} queued=${queue.queued} running=${queue.running} retryScheduled=${queue.retryScheduled} failedLike=${queue.failedLike}`;
}

function formatWarningArtifact(warning: JsonRecord) {
    return `warning x${toNumber(warning.count) ?? 0} lastSeen=${toTrimmed(warning.lastSeenAt)} ${toTrimmed(warning.warning)}`;
}

function formatBacklogArtifact(job: { jobId: string; status: string; songId: string; ageMs: number; updatedAt: string; nextAttemptAt: string; structureLongSpan?: JsonRecord | null; audioLongSpan?: JsonRecord | null; longSpanDivergence?: JsonRecord | null; orchestration?: BacklogOrchestrationSummary | null }) {
    const orchestrationLabel = formatOrchestrationLabel(job.orchestration);
    const longSpanReason = formatLongSpanReason(job.longSpanDivergence);
    return [
        `backlog=${toTrimmed(job.jobId)}`,
        `status=${toTrimmed(job.status)}`,
        `song=${toTrimmed(job.songId)}`,
        ...(orchestrationLabel !== "-" ? [`orchestration=${orchestrationLabel}`] : []),
        `structureLongSpan=${formatLongSpanLabel(job.structureLongSpan)}`,
        `audioLongSpan=${formatLongSpanLabel(job.audioLongSpan)}`,
        `longSpanDivergence=${formatLongSpanLabel(job.longSpanDivergence)}`,
        ...(longSpanReason !== "-" ? [`longSpanReason=${longSpanReason}`] : []),
        `ageMs=${toNumber(job.ageMs) ?? 0}`,
        `updated=${toTrimmed(job.updatedAt)}`,
        `nextAttemptAt=${toTrimmed(job.nextAttemptAt)}`,
    ].join(" ");
}

function formatPendingArtifact(pending: {
    songId: string;
    approvalStatus: string;
    updatedAt: string;
    prompt: string;
    longSpan?: JsonRecord | null;
    longSpanDivergence?: JsonRecord | null;
    plannerTelemetry?: { selectedCandidateId?: string | null; parserMode?: string | null; noveltyScore?: number | null } | null;
}) {
    const longSpanReason = formatLongSpanReason(pending.longSpanDivergence);
    return [
        `pending=${toTrimmed(pending.songId)}`,
        `approval=${toTrimmed(pending.approvalStatus)}`,
        `updated=${toTrimmed(pending.updatedAt)}`,
        `longSpan=${formatLongSpanLabel(pending.longSpan)}`,
        `longSpanDivergence=${formatLongSpanLabel(pending.longSpanDivergence)}`,
        ...(longSpanReason !== "-" ? [`longSpanReason=${longSpanReason}`] : []),
        `candidate=${toTrimmed(pending.plannerTelemetry?.selectedCandidateId)}`,
        `parser=${toTrimmed(pending.plannerTelemetry?.parserMode)}`,
        `prompt=${toTrimmed(pending.prompt)}`,
    ].join(" ");
}

export async function buildOperatorSummary(options: OperatorSummaryOptions = {}) {
    const namespace = toTrimmed(options.namespace, "axiom");
    const source = toTrimmed(options.source, "local-runtime");
    const jobLimit = clampInteger(options.jobLimit, 5, 1, 20);
    const windowHours = clampInteger(options.windowHours, 24, 1, 24 * 7);
    const staleThresholdMs = clampInteger(options.staleThresholdMs, 15000, 0, 24 * 60 * 60 * 1000);
    const observedAt = toTrimmed(options.observedAt, new Date().toISOString());
    const observedAtMs = Date.parse(observedAt);
    const now = Number.isFinite(observedAtMs) ? new Date(observedAtMs) : new Date();
    const missing: string[] = [];

    const readiness = getRuntimeReadinessSummary();
    const sortedJobs = listJobs()
        .map((job) => serializeQueuedJob(job))
        .sort((left, right) => toTrimmed(right.updatedAt).localeCompare(toTrimmed(left.updatedAt)));
    const queue = summarizeQueue(sortedJobs);
    const backlog = summarizeBacklog(sortedJobs, Number.isFinite(observedAtMs) ? observedAtMs : Date.now());

    const [reachable, autonomyStatus] = await Promise.all([
        checkOllamaReachable(),
        getAutonomyStatus(),
    ]);

    const autonomyPayload = {
        reachable,
        paused: autonomyStatus.paused,
        pauseReason: autonomyStatus.pauseReason,
        activeRun: autonomyStatus.activeRun,
        pendingApprovalCount: autonomyStatus.pendingApprovalCount,
        pendingApprovals: autonomyStatus.pendingApprovals,
        lastRun: autonomyStatus.lastRun,
        scheduler: getAutonomySchedulerStatus(),
        operations: getAutonomyOperationalSummary(now),
    } satisfies JsonRecord;

    const overseerPayload = {
        ...summarizeOverseerHistory({ windowHours, limit: 200, now }),
        manifestAudioRetry: buildManifestOperationalSummary(
            listStoredManifests(undefined, { hydrateSectionArtifacts: true }),
            now,
            { shadowHistoryWindowHours: windowHours },
        ),
    } satisfies JsonRecord;

    const autonomy = summarizeAutonomy(autonomyPayload, missing);
    const overseer = summarizeOverseer(overseerPayload, missing);
    const queueWithBacklog = {
        ...queue,
        backlog,
    };
    const handoff = loadOperatorHandoff();
    const pickupIncident = toRecord(handoff.operatorPickup?.incidentDraft);
    const latestOperatorAction = summarizeOperatorAction(
        readJsonRecordIfExists(path.join(config.outputDir, "_system", "operator-actions", "latest.json")),
    );

    const readinessStatusCode = readiness.status === "not_ready" ? 503 : 200;
    const autonomyStatusCode = reachable ? 200 : 503;
    const evidence = buildEvidence(observedAt, staleThresholdMs, missing, {
        ready: { path: "/ready", statusCode: readinessStatusCode, ok: readinessStatusCode < 400 },
        jobs: { path: "/jobs", statusCode: 200, ok: true },
        autonomyOps: { path: "/autonomy/ops", statusCode: autonomyStatusCode, ok: autonomyStatusCode < 400 },
        overseerSummary: { path: `/overseer/summary?windowHours=${windowHours}&limit=200`, statusCode: 200, ok: true },
    });
    const triage = buildRuntimeTriage(readiness, queueWithBacklog, autonomy, overseer, evidence);
    const baseUrl = `http://127.0.0.1:${config.port}`;

    const summary = [
        `AXIOM ${source}`,
        `readiness=${readiness.status}`,
        `queue total=${queue.total} (queued=${queue.queued}, running=${queue.running}, retryScheduled=${queue.retryScheduled}, failedLike=${queue.failedLike})`,
        `backlog=${backlog.count}`,
        `autonomy paused=${boolLabel(autonomy.paused)} pending=${autonomy.pendingApprovalCount} activeRun=${toTrimmed(autonomy.activeRun?.runId)}`,
        `overseer warnings=${overseer.activeRepeatedWarningCount} failures24h=${overseer.failureCount24h}`,
        `evidenceStale=${boolLabel(evidence.stale)}`,
        `latestAction=${toTrimmed(latestOperatorAction.action, "none")}`,
        `triage=${triage.state}`,
    ].join(" | ");

    return {
        ok: true,
        namespace,
        source,
        observedAt,
        baseUrl,
        summary,
        readiness,
        queue: queueWithBacklog,
        autonomy,
        overseer,
        latestOperatorAction,
        triage,
        evidence,
        artifacts: [
            `source=${source}`,
            `baseUrl=${baseUrl}`,
            `observedAt=${observedAt}`,
            `readiness=${readiness.status}`,
            `evidence stale=${boolLabel(evidence.stale)} reason=${toTrimmed(evidence.staleReason)} oldestAgeMs=${evidence.oldestAgeMs} maxSkewMs=${evidence.maxSkewMs}`,
            `triage state=${triage.state} severity=${triage.severity} lane=${triage.recommendedLane} score=${triage.severityScore}`,
            ...triage.severityDrivers.map((item) => `triage driver=${item.code} weight=${toNumber(item.weight) ?? 0} detail=${toTrimmed(item.detail)}`),
            ...(handoff.incidentDraft
                ? [
                    `incidentDraft incidentId=${toTrimmed(handoff.incidentDraft.incidentId)} severity=${toTrimmed(handoff.incidentDraft.severity)} state=${toTrimmed(handoff.incidentDraft.state)} observedAt=${toTrimmed(handoff.incidentDraft.observedAt)}`,
                ]
                : []),
            ...(handoff.operatorPickup
                ? [
                    `operatorPickup status=${toTrimmed(handoff.operatorPickup.status)} incidentPresent=${boolLabel(pickupIncident?.present === true)} summary=${toTrimmed(handoff.operatorPickup.summary)}`,
                ]
                : []),
            formatQueueArtifact(queue),
            `backlog count=${backlog.count} retryScheduled=${backlog.retryScheduled} failedLike=${backlog.failedLike} oldestAgeMs=${backlog.oldestAgeMs}`,
            ...backlog.topJobs.map(formatBacklogArtifact),
            `autonomy reachable=${boolLabel(autonomy.reachable)} paused=${boolLabel(autonomy.paused)} pendingApprovalCount=${autonomy.pendingApprovalCount} activeRun=${toTrimmed(autonomy.activeRun?.runId)}`,
            ...(latestOperatorAction.present
                ? [
                    `operatorAction action=${toTrimmed(latestOperatorAction.action)} surface=${toTrimmed(latestOperatorAction.surface)} actor=${toTrimmed(latestOperatorAction.actor)} approvedBy=${toTrimmed(latestOperatorAction.approvedBy)} observedAt=${toTrimmed(latestOperatorAction.observedAt)} reason=${toTrimmed(latestOperatorAction.reason)}`,
                    `operatorAction rollbackNote=${toTrimmed(latestOperatorAction.rollbackNote)} manualRecoveryNote=${toTrimmed(latestOperatorAction.manualRecoveryNote)}`,
                    ...latestOperatorAction.artifactLinks.map((item) => `operatorAction artifact=${toTrimmed(item)}`),
                ]
                : []),
            ...(autonomy.lastRun
                ? [
                    `autonomy lastRun=${toTrimmed(autonomy.lastRun.runId)} status=${toTrimmed(autonomy.lastRun.status)} candidate=${toTrimmed(autonomy.lastRun.plannerTelemetry?.selectedCandidateId)} parser=${toTrimmed(autonomy.lastRun.plannerTelemetry?.parserMode)} noveltyScore=${toNumber(autonomy.lastRun.plannerTelemetry?.noveltyScore) ?? 0}`,
                ]
                : []),
            ...autonomy.pendingApprovals.slice(0, 3).map(formatPendingArtifact),
            `overseer lastSuccessAt=${overseer.lastSuccessAt} lastFailureAt=${overseer.lastFailureAt} failureCount24h=${overseer.failureCount24h} warnings=${overseer.activeRepeatedWarningCount}`,
            ...overseer.repeatedWarnings.map(formatWarningArtifact),
            ...(overseer.phraseBreathTrend ? [formatPhraseBreathTrendArtifact(overseer.phraseBreathTrend)] : []),
            ...(overseer.harmonicColorTrend ? [formatHarmonicColorTrendArtifact(overseer.harmonicColorTrend)] : []),
            ...(overseer.learnedProposalWarnings && overseer.learnedProposalWarnings.proposalCount > 0
                ? [
                    formatLearnedProposalWarningArtifact(overseer.learnedProposalWarnings),
                    ...overseer.learnedProposalWarnings.topWarnings.map(formatLearnedProposalWarningRowArtifact),
                ]
                : []),
            ...(overseer.shadowReranker
                ? [
                    formatShadowRerankerArtifact(overseer.shadowReranker),
                    ...(overseer.shadowReranker.runtimeWindow
                        && overseer.shadowReranker.runtimeWindow.sampledEntries > 0
                        ? [formatShadowRerankerRuntimeWindowArtifact(overseer.shadowReranker.runtimeWindow)]
                        : []),
                    ...(overseer.shadowReranker.promotionOutcomes
                        ? [formatShadowRerankerPromotionOutcomesArtifact(overseer.shadowReranker.promotionOutcomes)]
                        : []),
                    ...(overseer.shadowReranker.promotionAdvantage
                        ? [formatShadowRerankerPromotionAdvantageArtifact(overseer.shadowReranker.promotionAdvantage)]
                        : []),
                    ...(overseer.shadowReranker.shortlist
                        ? [formatShadowRerankerShortlistArtifact(overseer.shadowReranker.shortlist)]
                        : []),
                    ...(overseer.shadowReranker.retryLocalizationOutcomes
                        && overseer.shadowReranker.retryLocalizationOutcomes.retryingManifestCount > 0
                        ? [formatShadowRerankerRetryLocalizationArtifact(overseer.shadowReranker.retryLocalizationOutcomes)]
                        : []),
                    ...overseer.shadowReranker.recentShortlists.map(formatShadowRerankerRecentShortlistArtifact),
                    ...overseer.shadowReranker.recentDisagreements.map(formatShadowRerankerDisagreementArtifact),
                    ...overseer.shadowReranker.recentPromotions.map(formatShadowRerankerPromotionArtifact),
                ]
                : []),
            ...(overseer.learnedBackboneBenchmark && overseer.learnedBackboneBenchmark.runCount > 0
                ? [
                    formatLearnedBackboneBenchmarkArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkConfigArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkBlindPreferenceArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkShortlistBlindPreferenceArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkTop1AccuracyArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkPairedSelectionArtifact(overseer.learnedBackboneBenchmark),
                    ...Object.entries(overseer.learnedBackboneBenchmark.selectedWorkerOutcomes)
                        .sort((left, right) => (
                            (toNumber(right[1].runCount) ?? 0) - (toNumber(left[1].runCount) ?? 0)
                            || left[0].localeCompare(right[0])
                        ))
                        .map(([worker, summary]) => formatLearnedBackboneBenchmarkSelectedWorkerOutcomeArtifact(worker, summary)),
                    ...overseer.learnedBackboneBenchmark.coverageRows.map(formatLearnedBackboneBenchmarkCoverageArtifact),
                    formatLearnedBackboneBenchmarkReviewQueueArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkReviewPacksArtifact(overseer.learnedBackboneBenchmark),
                    ...((overseer.learnedBackboneBenchmark.reviewQueue?.recentPendingRows ?? []).map(formatLearnedBackboneBenchmarkReviewQueueRowArtifact)),
                    ...((overseer.learnedBackboneBenchmark.reviewPacks?.recentActivePacks ?? []).map(formatLearnedBackboneBenchmarkReviewPackArtifact)),
                    ...overseer.learnedBackboneBenchmark.reviewPackRecordActions.map(formatLearnedBackboneBenchmarkReviewPackRecordActionArtifact),
                    ...overseer.learnedBackboneBenchmark.reviewPackActions.map(formatLearnedBackboneBenchmarkReviewPackActionArtifact),
                    ...overseer.learnedBackboneBenchmark.searchBudgetRows.map(formatLearnedBackboneBenchmarkSearchBudgetArtifact),
                    formatLearnedBackboneBenchmarkPromotionGateArtifact(overseer.learnedBackboneBenchmark),
                    ...overseer.learnedBackboneBenchmark.topFailureModes.map(formatLearnedBackboneBenchmarkFailureModeArtifact),
                    ...overseer.learnedBackboneBenchmark.topStopReasons.map(formatLearnedBackboneBenchmarkStopReasonArtifact),
                    ...overseer.learnedBackboneBenchmark.recentRunRows.map(formatLearnedBackboneBenchmarkRecentRunArtifact),
                ]
                : []),
            ...overseer.orchestrationTrends.map(formatOrchestrationTrendArtifact),
        ],
        data: {
            ready: {
                status: readiness.status,
                checks: readiness.checks,
                capabilities: readiness.capabilities,
                degradedReasons: readiness.degradedReasons,
            },
            jobs: sortedJobs.slice(0, jobLimit),
            recentJobs: sortedJobs.slice(0, jobLimit),
            autonomyStatus: autonomyPayload,
            autonomyOps: autonomyPayload,
            overseerSummary: overseerPayload,
            latestOperatorAction,
            incidentDraft: handoff.incidentDraft,
            operatorPickup: handoff.operatorPickup,
        },
    };
}