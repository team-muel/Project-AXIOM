import fs from "node:fs";
import path from "node:path";

function createScriptError(message, details) {
    const error = new Error(message);
    error.details = details;
    return error;
}

function readOption(name) {
    const prefix = `--${name}=`;
    const exactIndex = process.argv.indexOf(`--${name}`);
    if (exactIndex >= 0) {
        return process.argv[exactIndex + 1];
    }

    const prefixed = process.argv.find((entry) => entry.startsWith(prefix));
    if (prefixed) {
        return prefixed.slice(prefix.length);
    }

    return undefined;
}

function fail(message, details) {
    const payload = {
        ok: false,
        message,
        details,
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function deleteFileIfExists(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function writeAtomic(filePath, text) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, text, "utf-8");
    fs.renameSync(tempPath, filePath);
}

function toTrimmed(value, fallback = "-") {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function formatOrchestrationMetric(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? value.toFixed(2)
        : "-";
}

function normalizePhraseBreathTrend(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        manifestCount: toNumber(value.manifestCount) ?? 0,
        weakManifestCount: toNumber(value.weakManifestCount) ?? 0,
        averagePlanFit: toNumber(value.averagePlanFit) ?? null,
        averageCoverageFit: toNumber(value.averageCoverageFit) ?? null,
        averagePickupFit: toNumber(value.averagePickupFit) ?? null,
        averageArrivalFit: toNumber(value.averageArrivalFit) ?? null,
        averageReleaseFit: toNumber(value.averageReleaseFit) ?? null,
        averageRecoveryFit: toNumber(value.averageRecoveryFit) ?? null,
        averageRubatoFit: toNumber(value.averageRubatoFit) ?? null,
        lastSeenAt: toTrimmed(value.lastSeenAt, "") || null,
    };
}

function normalizeHarmonicColorTrend(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        manifestCount: toNumber(value.manifestCount) ?? 0,
        weakManifestCount: toNumber(value.weakManifestCount) ?? 0,
        averagePlanFit: toNumber(value.averagePlanFit) ?? null,
        averageCoverageFit: toNumber(value.averageCoverageFit) ?? null,
        averageTargetFit: toNumber(value.averageTargetFit) ?? null,
        averageTimingFit: toNumber(value.averageTimingFit) ?? null,
        averageTonicizationPressureFit: toNumber(value.averageTonicizationPressureFit) ?? null,
        averageProlongationMotionFit: toNumber(value.averageProlongationMotionFit) ?? null,
        lastSeenAt: toTrimmed(value.lastSeenAt, "") || null,
    };
}

function normalizeCountMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .map(([key, entry]) => [key, toNumber(entry) ?? 0])
            .filter(([, entry]) => entry > 0),
    );
}

function normalizeLearnedBackboneBenchmarkFailureModeRow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
            failureMode: "-",
            count: 0,
        };
    }

    return {
        failureMode: toTrimmed(value.failureMode),
        count: toNumber(value.count) ?? 0,
    };
}

function normalizeLearnedBackboneBenchmarkStopReasonRow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
            reason: "-",
            count: 0,
        };
    }

    return {
        reason: toTrimmed(value.reason),
        count: toNumber(value.count) ?? 0,
    };
}

function normalizeLearnedBackboneBenchmarkCoverageRow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        benchmarkKey: toTrimmed(value.benchmarkKey),
        benchmarkId: toTrimmed(value.benchmarkId, "") || null,
        planSignature: toTrimmed(value.planSignature, "") || null,
        lane: toTrimmed(value.lane, "") || null,
        benchmarkPackVersion: toTrimmed(value.benchmarkPackVersion, "") || null,
        runCount: toNumber(value.runCount) ?? 0,
        pairedRunCount: toNumber(value.pairedRunCount) ?? 0,
        reviewedRunCount: toNumber(value.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(value.pendingReviewCount) ?? 0,
        approvalRate: toNumber(value.approvalRate) ?? null,
        averageAppealScore: toNumber(value.averageAppealScore) ?? null,
        selectedWorkerCounts: normalizeCountMap(value.selectedWorkerCounts),
        generationModeCounts: normalizeCountMap(value.generationModeCounts),
        latestObservedAt: toTrimmed(value.latestObservedAt, "") || null,
        songIds: Array.isArray(value.songIds)
            ? value.songIds.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
    };
}

function normalizeLearnedBackboneBenchmarkSearchBudgetRow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        searchBudgetLevel: toTrimmed(value.searchBudgetLevel, "") || null,
        searchBudgetDescriptor: toTrimmed(value.searchBudgetDescriptor, "") || null,
        wholePieceCandidateCount: toNumber(value.wholePieceCandidateCount) ?? 0,
        localizedRewriteBranchCount: toNumber(value.localizedRewriteBranchCount) ?? 0,
        runCount: toNumber(value.runCount) ?? 0,
        pairedRunCount: toNumber(value.pairedRunCount) ?? 0,
        reviewedRunCount: toNumber(value.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(value.pendingReviewCount) ?? 0,
        approvalRate: toNumber(value.approvalRate) ?? null,
        averageAppealScore: toNumber(value.averageAppealScore) ?? null,
        blindPreferenceWinRate: toNumber(value.blindPreferenceWinRate) ?? null,
        reviewedPairCount: toNumber(value.reviewedPairCount) ?? 0,
        decisivePairCount: toNumber(value.decisivePairCount) ?? 0,
        selectedTop1Accuracy: toNumber(value.selectedTop1Accuracy) ?? null,
        decisiveReviewedPairCount: toNumber(value.decisiveReviewedPairCount) ?? 0,
        correctSelectionCount: toNumber(value.correctSelectionCount) ?? 0,
        latestObservedAt: toTrimmed(value.latestObservedAt, "") || null,
    };
}

function normalizeLearnedBackboneBenchmarkRecentRunRow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        songId: toTrimmed(value.songId),
        benchmarkId: toTrimmed(value.benchmarkId, "") || null,
        planSignature: toTrimmed(value.planSignature, "") || null,
        selectedWorker: toTrimmed(value.selectedWorker, "") || null,
        approvalStatus: toTrimmed(value.approvalStatus, "") || null,
        reviewed: value.reviewed === true,
        appealScore: toNumber(value.appealScore) ?? null,
        disagreementObserved: value.disagreementObserved === true,
        promotionApplied: value.promotionApplied === true,
        selectionMode: toTrimmed(value.selectionMode, "") || null,
        counterfactualWorker: toTrimmed(value.counterfactualWorker, "") || null,
        retryLocalization: toTrimmed(value.retryLocalization, "") || null,
        benchmarkGenerationMode: toTrimmed(value.benchmarkGenerationMode, "") || null,
        selectedGenerationMode: toTrimmed(value.selectedGenerationMode, "") || null,
        selectionStopReason: toTrimmed(value.selectionStopReason, "") || null,
        reviewWeakestDimension: toTrimmed(value.reviewWeakestDimension, "") || null,
        observedAt: toTrimmed(value.observedAt, "") || null,
        wholePieceCandidateCount: toNumber(value.wholePieceCandidateCount) ?? 0,
        localizedRewriteBranchCount: toNumber(value.localizedRewriteBranchCount) ?? 0,
        searchBudgetLevel: toTrimmed(value.searchBudgetLevel, "") || null,
        searchBudgetDescriptor: toTrimmed(value.searchBudgetDescriptor, "") || null,
    };
}

function normalizeLearnedBackboneBenchmarkConfigSnapshot(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        lane: toTrimmed(value.lane, "") || null,
        benchmarkPackVersion: toTrimmed(value.benchmarkPackVersion, "") || null,
        benchmarkIds: Array.isArray(value.benchmarkIds)
            ? value.benchmarkIds.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
        pairedWorkers: Array.isArray(value.pairedWorkers)
            ? value.pairedWorkers.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
        workflowCounts: normalizeCountMap(value.workflowCounts),
        promptPackVersionCounts: normalizeCountMap(value.promptPackVersionCounts),
        reviewRubricVersionCounts: normalizeCountMap(value.reviewRubricVersionCounts),
        generationModeCounts: normalizeCountMap(value.generationModeCounts),
    };
}

function normalizeLearnedBackboneBenchmarkReviewSampleStatus(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    const reviewedRunCount = toNumber(value.reviewedRunCount) ?? 0;
    const reviewedDisagreementCount = toNumber(value.reviewedDisagreementCount) ?? 0;
    const minimumReviewedRunCountForScreening = toNumber(value.minimumReviewedRunCountForScreening) ?? 0;
    const minimumReviewedRunCountForPromotion = toNumber(value.minimumReviewedRunCountForPromotion) ?? 0;
    const minimumReviewedDisagreementCountForPromotion = toNumber(value.minimumReviewedDisagreementCountForPromotion) ?? 0;

    return {
        status: toTrimmed(value.status, "") || null,
        directionalOnly: value.directionalOnly === true,
        reviewedRunCount,
        reviewedDisagreementCount,
        minimumReviewedRunCountForScreening,
        minimumReviewedRunCountForPromotion,
        minimumReviewedDisagreementCountForPromotion,
        remainingReviewedRunCountForScreening: toNumber(value.remainingReviewedRunCountForScreening) ?? Math.max(0, minimumReviewedRunCountForScreening - reviewedRunCount),
        remainingReviewedRunCountForPromotion: toNumber(value.remainingReviewedRunCountForPromotion) ?? Math.max(0, minimumReviewedRunCountForPromotion - reviewedRunCount),
        remainingReviewedDisagreementCountForPromotion: toNumber(value.remainingReviewedDisagreementCountForPromotion) ?? Math.max(0, minimumReviewedDisagreementCountForPromotion - reviewedDisagreementCount),
        meetsEarlyScreeningMinimum: value.meetsEarlyScreeningMinimum === true,
        meetsPromotionReviewedMinimum: value.meetsPromotionReviewedMinimum === true,
        meetsPromotionDisagreementMinimum: value.meetsPromotionDisagreementMinimum === true,
    };
}

function normalizeLearnedBackboneBenchmarkDisagreementSummary(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        pairedRunCount: toNumber(value.pairedRunCount) ?? 0,
        disagreementRunCount: toNumber(value.disagreementRunCount) ?? 0,
        reviewedDisagreementCount: toNumber(value.reviewedDisagreementCount) ?? 0,
        promotionAppliedCount: toNumber(value.promotionAppliedCount) ?? 0,
        learnedSelectedWithoutPromotionCount: toNumber(value.learnedSelectedWithoutPromotionCount) ?? 0,
        baselineSelectedCount: toNumber(value.baselineSelectedCount) ?? 0,
    };
}

function normalizeLearnedBackboneBenchmarkRetryLocalizationStability(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        retryingRunCount: toNumber(value.retryingRunCount) ?? 0,
        sectionTargetedOnlyCount: toNumber(value.sectionTargetedOnlyCount) ?? 0,
        mixedCount: toNumber(value.mixedCount) ?? 0,
        globalOnlyCount: toNumber(value.globalOnlyCount) ?? 0,
        sectionTargetedRate: toNumber(value.sectionTargetedRate) ?? null,
        driftRate: toNumber(value.driftRate) ?? null,
        status: toTrimmed(value.status, "") || null,
    };
}

function normalizeLearnedBackboneBenchmarkBlindPreference(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        available: value.available === true,
        winRate: toNumber(value.winRate) ?? null,
        reviewedPairCount: toNumber(value.reviewedPairCount) ?? 0,
        decisivePairCount: toNumber(value.decisivePairCount) ?? 0,
        learnedWinCount: toNumber(value.learnedWinCount) ?? 0,
        baselineWinCount: toNumber(value.baselineWinCount) ?? 0,
        tieCount: toNumber(value.tieCount) ?? 0,
        latestReviewedAt: toTrimmed(value.latestReviewedAt, "") || null,
        reason: toTrimmed(value.reason, "") || null,
    };
}

function normalizeLearnedBackboneBenchmarkReviewedTop1Accuracy(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        available: value.available === true,
        decisiveReviewedPairCount: toNumber(value.decisiveReviewedPairCount) ?? 0,
        correctSelectionCount: toNumber(value.correctSelectionCount) ?? 0,
        selectedTop1Accuracy: toNumber(value.selectedTop1Accuracy) ?? null,
        learnedSelectedReviewedPairCount: toNumber(value.learnedSelectedReviewedPairCount) ?? 0,
        learnedCorrectSelectionCount: toNumber(value.learnedCorrectSelectionCount) ?? 0,
        learnedSelectedTop1Accuracy: toNumber(value.learnedSelectedTop1Accuracy) ?? null,
        baselineSelectedReviewedPairCount: toNumber(value.baselineSelectedReviewedPairCount) ?? 0,
        baselineCorrectSelectionCount: toNumber(value.baselineCorrectSelectionCount) ?? 0,
        baselineSelectedTop1Accuracy: toNumber(value.baselineSelectedTop1Accuracy) ?? null,
        promotedReviewedPairCount: toNumber(value.promotedReviewedPairCount) ?? 0,
        promotedCorrectSelectionCount: toNumber(value.promotedCorrectSelectionCount) ?? 0,
        promotedTop1Accuracy: toNumber(value.promotedTop1Accuracy) ?? null,
        latestReviewedAt: toTrimmed(value.latestReviewedAt, "") || null,
        reason: toTrimmed(value.reason, "") || null,
    };
}

function normalizeLearnedBackboneBenchmarkPairedSelectionOutcomes(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        lane: toTrimmed(value.lane, "") || null,
        benchmarkPackVersion: toTrimmed(value.benchmarkPackVersion, "") || null,
        reviewedManifestCount: toNumber(value.reviewedManifestCount) ?? 0,
        promotedReviewedCount: toNumber(value.promotedReviewedCount) ?? 0,
        promotedApprovalRate: toNumber(value.promotedApprovalRate) ?? null,
        promotedAverageAppealScore: toNumber(value.promotedAverageAppealScore) ?? null,
        heuristicReviewedCount: toNumber(value.heuristicReviewedCount) ?? 0,
        heuristicApprovalRate: toNumber(value.heuristicApprovalRate) ?? null,
        heuristicAverageAppealScore: toNumber(value.heuristicAverageAppealScore) ?? null,
    };
}

function normalizeLearnedBackboneBenchmarkWorkerOutcomeSummary(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
            runCount: 0,
            reviewedRunCount: 0,
            pendingReviewCount: 0,
            approvedCount: 0,
            rejectedCount: 0,
            approvalRate: null,
            averageAppealScore: null,
        };
    }

    return {
        runCount: toNumber(value.runCount) ?? 0,
        reviewedRunCount: toNumber(value.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(value.pendingReviewCount) ?? 0,
        approvedCount: toNumber(value.approvedCount) ?? 0,
        rejectedCount: toNumber(value.rejectedCount) ?? 0,
        approvalRate: toNumber(value.approvalRate) ?? null,
        averageAppealScore: toNumber(value.averageAppealScore) ?? null,
    };
}

function normalizeLearnedBackboneBenchmarkWorkerOutcomes(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .map(([worker, summary]) => [toTrimmed(worker, "unknown") || "unknown", normalizeLearnedBackboneBenchmarkWorkerOutcomeSummary(summary)]),
    );
}

function normalizeLearnedBackboneBenchmarkReviewQueueRow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        songId: toTrimmed(value.songId),
        benchmarkId: toTrimmed(value.benchmarkId, "") || null,
        planSignature: toTrimmed(value.planSignature, "") || null,
        reviewTarget: toTrimmed(value.reviewTarget, "") || null,
        selectedWorker: toTrimmed(value.selectedWorker, "") || null,
        counterfactualWorker: toTrimmed(value.counterfactualWorker, "") || null,
        selectionMode: toTrimmed(value.selectionMode, "") || null,
        observedAt: toTrimmed(value.observedAt, "") || null,
        wholePieceCandidateCount: toNumber(value.wholePieceCandidateCount) ?? 0,
        localizedRewriteBranchCount: toNumber(value.localizedRewriteBranchCount) ?? 0,
        searchBudgetLevel: toTrimmed(value.searchBudgetLevel, "") || null,
        searchBudgetDescriptor: toTrimmed(value.searchBudgetDescriptor, "") || null,
        shortlistTopK: toNumber(value.shortlistTopK) ?? null,
        selectedRank: toNumber(value.selectedRank) ?? null,
        selectedInShortlist: value.selectedInShortlist === true,
    };
}

function normalizeLearnedBackboneBenchmarkReviewQueue(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        pendingBlindReviewCount: toNumber(value.pendingBlindReviewCount) ?? 0,
        pendingShortlistReviewCount: toNumber(value.pendingShortlistReviewCount) ?? 0,
        latestPendingAt: toTrimmed(value.latestPendingAt, "") || null,
        recentPendingRows: Array.isArray(value.recentPendingRows)
            ? value.recentPendingRows.map(normalizeLearnedBackboneBenchmarkReviewQueueRow).filter(Boolean).slice(0, 5)
            : [],
    };
}

function normalizeLearnedBackboneBenchmarkReviewPackRow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        packId: toTrimmed(value.packId),
        generatedAt: toTrimmed(value.generatedAt, "") || null,
        reviewTarget: toTrimmed(value.reviewTarget, "") || null,
        searchBudget: toTrimmed(value.searchBudget, "") || null,
        entryCount: toNumber(value.entryCount) ?? 0,
        completedDecisionCount: toNumber(value.completedDecisionCount) ?? 0,
        pendingDecisionCount: toNumber(value.pendingDecisionCount) ?? 0,
        pendingShortlistDecisionCount: toNumber(value.pendingShortlistDecisionCount) ?? 0,
        latestReviewedAt: toTrimmed(value.latestReviewedAt, "") || null,
        reviewSheetPath: toTrimmed(value.reviewSheetPath, "") || null,
    };
}

function normalizeLearnedBackboneBenchmarkReviewPacks(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        matchedPackCount: toNumber(value.matchedPackCount) ?? 0,
        activePackCount: toNumber(value.activePackCount) ?? 0,
        pendingDecisionCount: toNumber(value.pendingDecisionCount) ?? 0,
        completedDecisionCount: toNumber(value.completedDecisionCount) ?? 0,
        latestGeneratedAt: toTrimmed(value.latestGeneratedAt, "") || null,
        latestReviewedAt: toTrimmed(value.latestReviewedAt, "") || null,
        recentActivePacks: Array.isArray(value.recentActivePacks)
            ? value.recentActivePacks.map(normalizeLearnedBackboneBenchmarkReviewPackRow).filter(Boolean).slice(0, 5)
            : [],
    };
}

function buildLearnedBackboneReviewPackCommand(reviewTarget, pendingOnly, searchBudget = null) {
    const args = [];
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

function buildLearnedBackboneCustomReviewPackActions(reviewQueue, searchBudgetRows, existingActionCount) {
    const customBudgetRows = searchBudgetRows
        .filter((row) => toTrimmed(row?.searchBudgetLevel, "") === "custom" && (toNumber(row?.pendingReviewCount) ?? 0) > 0)
        .sort(
            (left, right) => (toNumber(left?.wholePieceCandidateCount) ?? 0) - (toNumber(right?.wholePieceCandidateCount) ?? 0)
                || (toNumber(left?.localizedRewriteBranchCount) ?? 0) - (toNumber(right?.localizedRewriteBranchCount) ?? 0)
                || toTrimmed(left?.searchBudgetDescriptor).localeCompare(toTrimmed(right?.searchBudgetDescriptor)),
        );
    if (customBudgetRows.length > 0) {
        return customBudgetRows.map((row, index) => ({
            reviewTarget: "all",
            searchBudget: toTrimmed(row?.searchBudgetDescriptor, "") || toTrimmed(row?.searchBudgetLevel, "") || null,
            pendingOnly: true,
            pendingPairCount: toNumber(row?.pendingReviewCount) ?? 0,
            priority: index === 0
                ? (existingActionCount > 0 ? "after_general_queue" : "first")
                : "after_previous_budget_focus",
            command: buildLearnedBackboneReviewPackCommand(
                "all",
                true,
                toTrimmed(row?.searchBudgetDescriptor, "") || toTrimmed(row?.searchBudgetLevel, "") || null,
            ),
        }));
    }

    const pendingBudgetCounts = new Map();
    for (const row of reviewQueue?.recentPendingRows ?? []) {
        const searchBudgetLevel = toTrimmed(row?.searchBudgetLevel, "");
        const searchBudget = toTrimmed(row?.searchBudgetDescriptor, "") || searchBudgetLevel;
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

function summarizeActiveLearnedBackboneReviewPackCoverage(reviewPacks) {
    return (Array.isArray(reviewPacks?.recentActivePacks) ? reviewPacks.recentActivePacks : []).reduce(
        (summary, item) => {
            summary.pendingDecisionCount += toNumber(item?.pendingDecisionCount) ?? 0;
            summary.pendingShortlistDecisionCount += toNumber(item?.pendingShortlistDecisionCount) ?? 0;
            return summary;
        },
        {
            pendingDecisionCount: 0,
            pendingShortlistDecisionCount: 0,
        },
    );
}

function buildLearnedBackboneBenchmarkReviewPackActions(reviewQueue, reviewPacks, searchBudgetRows) {
    if (!reviewQueue || typeof reviewQueue !== "object") {
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

    const actions = [];

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

function buildLearnedBackboneBenchmarkReviewPackRecordActions(reviewPacks) {
    if (!reviewPacks || typeof reviewPacks !== "object") {
        return [];
    }

    return (Array.isArray(reviewPacks.recentActivePacks) ? reviewPacks.recentActivePacks : [])
        .filter((item) => item && typeof item === "object" && toTrimmed(item.reviewSheetPath, ""))
        .map((item, index) => ({
            packId: toTrimmed(item.packId),
            reviewTarget: toTrimmed(item.reviewTarget),
            searchBudget: toTrimmed(item.searchBudget, "") || null,
            pendingDecisionCount: toNumber(item.pendingDecisionCount) ?? 0,
            pendingShortlistDecisionCount: toNumber(item.pendingShortlistDecisionCount) ?? 0,
            reviewSheetPath: toTrimmed(item.reviewSheetPath),
            priority: index === 0 ? "first" : "after_previous",
            command: `npm run ml:review-pack:record:learned-backbone -- --resultsFile ${toTrimmed(item.reviewSheetPath)}`,
        }));
}

function normalizeLearnedBackboneBenchmarkPromotionGate(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        status: toTrimmed(value.status, "") || null,
        signal: toTrimmed(value.signal, "") || null,
        minimumReviewedRunCount: toNumber(value.minimumReviewedRunCount) ?? 0,
        minimumReviewedDisagreementCount: toNumber(value.minimumReviewedDisagreementCount) ?? 0,
        minimumReviewedSelectedInShortlistRate: toNumber(value.minimumReviewedSelectedInShortlistRate) ?? null,
        meetsReviewedRunMinimum: value.meetsReviewedRunMinimum === true,
        meetsReviewedDisagreementMinimum: value.meetsReviewedDisagreementMinimum === true,
        meetsReviewedSelectedInShortlistMinimum: value.meetsReviewedSelectedInShortlistMinimum === true,
        retryLocalizationStable: value.retryLocalizationStable === true,
        blindPreferenceAvailable: value.blindPreferenceAvailable === true,
        blindPreferenceWinRate: toNumber(value.blindPreferenceWinRate) ?? null,
        reviewedSelectedInShortlistRate: toNumber(value.reviewedSelectedInShortlistRate) ?? null,
        reviewedSelectedTop1Rate: toNumber(value.reviewedSelectedTop1Rate) ?? null,
        approvalRateDelta: toNumber(value.approvalRateDelta) ?? null,
        appealScoreDelta: toNumber(value.appealScoreDelta) ?? null,
        positiveSignals: Array.isArray(value.positiveSignals) ? value.positiveSignals.map((item) => toTrimmed(item)).filter((item) => item !== "-") : [],
        negativeSignals: Array.isArray(value.negativeSignals) ? value.negativeSignals.map((item) => toTrimmed(item)).filter((item) => item !== "-") : [],
        blockers: Array.isArray(value.blockers) ? value.blockers.map((item) => toTrimmed(item)).filter((item) => item !== "-") : [],
        rationale: toTrimmed(value.rationale, "") || null,
    };
}

function normalizeLearnedBackboneBenchmark(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    const reviewQueue = normalizeLearnedBackboneBenchmarkReviewQueue(value.reviewQueue);
    const reviewPacks = normalizeLearnedBackboneBenchmarkReviewPacks(value.reviewPacks);
    const searchBudgetRows = Array.isArray(value.searchBudgetRows)
        ? value.searchBudgetRows.map(normalizeLearnedBackboneBenchmarkSearchBudgetRow).filter(Boolean).slice(0, 5)
        : [];

    return {
        lane: toTrimmed(value.lane, "") || null,
        benchmarkPackVersion: toTrimmed(value.benchmarkPackVersion, "") || null,
        runCount: toNumber(value.runCount) ?? 0,
        pairedRunCount: toNumber(value.pairedRunCount) ?? 0,
        reviewedRunCount: toNumber(value.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(value.pendingReviewCount) ?? 0,
        approvalRate: toNumber(value.approvalRate) ?? null,
        averageAppealScore: toNumber(value.averageAppealScore) ?? null,
        configSnapshot: normalizeLearnedBackboneBenchmarkConfigSnapshot(value.configSnapshot),
        blindPreference: normalizeLearnedBackboneBenchmarkBlindPreference(value.blindPreference),
        shortlistBlindPreference: normalizeLearnedBackboneBenchmarkBlindPreference(value.shortlistBlindPreference),
        reviewedTop1Accuracy: normalizeLearnedBackboneBenchmarkReviewedTop1Accuracy(value.reviewedTop1Accuracy),
        reviewQueue,
        reviewPacks,
        reviewPackActions: buildLearnedBackboneBenchmarkReviewPackActions(reviewQueue, reviewPacks, searchBudgetRows),
        reviewPackRecordActions: buildLearnedBackboneBenchmarkReviewPackRecordActions(reviewPacks),
        promotionGate: normalizeLearnedBackboneBenchmarkPromotionGate(value.promotionGate),
        reviewSampleStatus: normalizeLearnedBackboneBenchmarkReviewSampleStatus(value.reviewSampleStatus),
        disagreementSummary: normalizeLearnedBackboneBenchmarkDisagreementSummary(value.disagreementSummary),
        retryLocalizationStability: normalizeLearnedBackboneBenchmarkRetryLocalizationStability(value.retryLocalizationStability),
        selectionModeCounts: normalizeCountMap(value.selectionModeCounts),
        searchBudgetCounts: normalizeCountMap(value.searchBudgetCounts),
        selectedWorkerOutcomes: normalizeLearnedBackboneBenchmarkWorkerOutcomes(value.selectedWorkerOutcomes),
        pairedSelectionOutcomes: normalizeLearnedBackboneBenchmarkPairedSelectionOutcomes(value.pairedSelectionOutcomes),
        promotionAdvantage: normalizeShadowRerankerPromotionAdvantage(value.promotionAdvantage),
        coverageRows: Array.isArray(value.coverageRows)
            ? value.coverageRows.map(normalizeLearnedBackboneBenchmarkCoverageRow).filter(Boolean).slice(0, 5)
            : [],
        searchBudgetRows,
        topFailureModes: Array.isArray(value.topFailureModes)
            ? value.topFailureModes.map(normalizeLearnedBackboneBenchmarkFailureModeRow).slice(0, 5)
            : [],
        topStopReasons: Array.isArray(value.topStopReasons)
            ? value.topStopReasons.map(normalizeLearnedBackboneBenchmarkStopReasonRow).slice(0, 5)
            : [],
        recentRunRows: Array.isArray(value.recentRunRows)
            ? value.recentRunRows.map(normalizeLearnedBackboneBenchmarkRecentRunRow).filter(Boolean).slice(0, 5)
            : [],
    };
}

const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED = 4;
const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT = 2;

function normalizeShadowRerankerRuntimeWindow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        windowHours: toNumber(value.windowHours) ?? 0,
        sampledEntries: toNumber(value.sampledEntries) ?? 0,
        disagreementCount: toNumber(value.disagreementCount) ?? 0,
        highConfidenceDisagreementCount: toNumber(value.highConfidenceDisagreementCount) ?? 0,
        agreementRate: toNumber(value.agreementRate) ?? null,
        averageConfidence: toNumber(value.averageConfidence) ?? null,
        lastSeenAt: toTrimmed(value.lastSeenAt, "") || null,
    };
}

function normalizeShadowRerankerPromotionOutcomes(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        lane: toTrimmed(value.lane, "") || null,
        scoredManifestCount: toNumber(value.scoredManifestCount) ?? 0,
        reviewedManifestCount: toNumber(value.reviewedManifestCount) ?? 0,
        pendingReviewCount: toNumber(value.pendingReviewCount) ?? 0,
        promotedSelectionCount: toNumber(value.promotedSelectionCount) ?? 0,
        promotedReviewedCount: toNumber(value.promotedReviewedCount) ?? 0,
        promotedApprovalRate: toNumber(value.promotedApprovalRate) ?? null,
        promotedAverageAppealScore: toNumber(value.promotedAverageAppealScore) ?? null,
        heuristicReviewedCount: toNumber(value.heuristicReviewedCount) ?? 0,
        heuristicApprovalRate: toNumber(value.heuristicApprovalRate) ?? null,
        heuristicAverageAppealScore: toNumber(value.heuristicAverageAppealScore) ?? null,
    };
}

function normalizeShadowRerankerPromotionAdvantage(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        lane: toTrimmed(value.lane, "") || null,
        reviewedManifestCount: toNumber(value.reviewedManifestCount) ?? 0,
        promotedReviewedCount: toNumber(value.promotedReviewedCount) ?? 0,
        heuristicReviewedCount: toNumber(value.heuristicReviewedCount) ?? 0,
        sufficientReviewSample: value.sufficientReviewSample === true,
        minimumReviewedManifestCount: toNumber(value.minimumReviewedManifestCount) ?? SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED,
        minimumReviewedPerCohortCount: toNumber(value.minimumReviewedPerCohortCount) ?? SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT,
        approvalRateDelta: toNumber(value.approvalRateDelta) ?? null,
        appealScoreDelta: toNumber(value.appealScoreDelta) ?? null,
        signal: toTrimmed(value.signal, "insufficient_data"),
    };
}

function deriveShadowRerankerPromotionAdvantage(outcomes) {
    if (!outcomes || typeof outcomes !== "object") {
        return null;
    }

    const approvalRateDelta = typeof outcomes.promotedApprovalRate === "number" && typeof outcomes.heuristicApprovalRate === "number"
        ? Number((outcomes.promotedApprovalRate - outcomes.heuristicApprovalRate).toFixed(4))
        : null;
    const appealScoreDelta = typeof outcomes.promotedAverageAppealScore === "number" && typeof outcomes.heuristicAverageAppealScore === "number"
        ? Number((outcomes.promotedAverageAppealScore - outcomes.heuristicAverageAppealScore).toFixed(4))
        : null;
    const reviewedManifestCount = toNumber(outcomes.reviewedManifestCount) ?? 0;
    const promotedReviewedCount = toNumber(outcomes.promotedReviewedCount) ?? 0;
    const heuristicReviewedCount = toNumber(outcomes.heuristicReviewedCount) ?? 0;
    const sufficientReviewSample = reviewedManifestCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED
        && promotedReviewedCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT
        && heuristicReviewedCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT;
    const availableDeltas = [approvalRateDelta, appealScoreDelta]
        .filter((entry) => typeof entry === "number" && Number.isFinite(entry));
    const positive = availableDeltas.some((entry) => entry > 0.0001);
    const negative = availableDeltas.some((entry) => entry < -0.0001);
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
        lane: toTrimmed(outcomes.lane, "") || null,
        reviewedManifestCount,
        promotedReviewedCount,
        heuristicReviewedCount,
        sufficientReviewSample,
        minimumReviewedManifestCount: SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED,
        minimumReviewedPerCohortCount: SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT,
        approvalRateDelta,
        appealScoreDelta,
        signal,
    };
}

function normalizeShadowRerankerRetryLocalizationOutcomes(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        lane: toTrimmed(value.lane, "") || null,
        scoredManifestCount: toNumber(value.scoredManifestCount) ?? 0,
        retryingManifestCount: toNumber(value.retryingManifestCount) ?? 0,
        promotedRetryingCount: toNumber(value.promotedRetryingCount) ?? 0,
        promotedTargetedOnlyCount: toNumber(value.promotedTargetedOnlyCount) ?? 0,
        promotedMixedCount: toNumber(value.promotedMixedCount) ?? 0,
        promotedGlobalOnlyCount: toNumber(value.promotedGlobalOnlyCount) ?? 0,
        promotedSectionTargetedRate: toNumber(value.promotedSectionTargetedRate) ?? null,
        heuristicRetryingCount: toNumber(value.heuristicRetryingCount) ?? 0,
        heuristicTargetedOnlyCount: toNumber(value.heuristicTargetedOnlyCount) ?? 0,
        heuristicMixedCount: toNumber(value.heuristicMixedCount) ?? 0,
        heuristicGlobalOnlyCount: toNumber(value.heuristicGlobalOnlyCount) ?? 0,
        heuristicSectionTargetedRate: toNumber(value.heuristicSectionTargetedRate) ?? null,
    };
}

function normalizeShadowReranker(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    const promotionOutcomes = normalizeShadowRerankerPromotionOutcomes(value.promotionOutcomes);
    const promotionAdvantage = normalizeShadowRerankerPromotionAdvantage(value.promotionAdvantage)
        || deriveShadowRerankerPromotionAdvantage(promotionOutcomes);

    return {
        manifestCount: toNumber(value.manifestCount) ?? 0,
        scoredManifestCount: toNumber(value.scoredManifestCount) ?? 0,
        disagreementCount: toNumber(value.disagreementCount) ?? 0,
        highConfidenceDisagreementCount: toNumber(value.highConfidenceDisagreementCount) ?? 0,
        promotedSelectionCount: toNumber(value.promotedSelectionCount) ?? 0,
        agreementRate: toNumber(value.agreementRate) ?? null,
        averageLearnedConfidence: toNumber(value.averageLearnedConfidence) ?? null,
        latestSnapshotId: toTrimmed(value.latestSnapshotId, "") || null,
        lastSeenAt: toTrimmed(value.lastSeenAt, "") || null,
        promotionOutcomes,
        promotionAdvantage,
        retryLocalizationOutcomes: normalizeShadowRerankerRetryLocalizationOutcomes(value.retryLocalizationOutcomes),
        runtimeWindow: normalizeShadowRerankerRuntimeWindow(value.runtimeWindow),
    };
}

function formatShadowRerankerLine(item) {
    if (!item || typeof item !== "object") {
        return "- none";
    }

    return `- manifests=${toNumber(item.manifestCount) ?? 0} | scored=${toNumber(item.scoredManifestCount) ?? 0} | disagreements=${toNumber(item.disagreementCount) ?? 0} | highConfidence=${toNumber(item.highConfidenceDisagreementCount) ?? 0} | promotions=${toNumber(item.promotedSelectionCount) ?? 0} | agreementRate=${formatOrchestrationMetric(toNumber(item.agreementRate))} | avgConfidence=${formatOrchestrationMetric(toNumber(item.averageLearnedConfidence))} | snapshot=${toTrimmed(item.latestSnapshotId)} | lastSeen=${toTrimmed(item.lastSeenAt)}`;
}

function formatShadowRerankerRuntimeWindowLine(item) {
    if (!item || typeof item !== "object") {
        return "- runtimeWindow=none";
    }

    return `- runtimeWindow=${toNumber(item.windowHours) ?? 0}h | sampledRuns=${toNumber(item.sampledEntries) ?? 0} | disagreements=${toNumber(item.disagreementCount) ?? 0} | highConfidence=${toNumber(item.highConfidenceDisagreementCount) ?? 0} | agreementRate=${formatOrchestrationMetric(toNumber(item.agreementRate))} | avgConfidence=${formatOrchestrationMetric(toNumber(item.averageConfidence))} | lastSeen=${toTrimmed(item.lastSeenAt)}`;
}

function formatShadowRerankerOutcomesLine(item) {
    if (!item || typeof item !== "object") {
        return "- outcomes=none";
    }

    return `- outcomes lane=${toTrimmed(item.lane)} | scored=${toNumber(item.scoredManifestCount) ?? 0} | reviewed=${toNumber(item.reviewedManifestCount) ?? 0} | pendingReview=${toNumber(item.pendingReviewCount) ?? 0} | promoted=${toNumber(item.promotedSelectionCount) ?? 0} | promotedReviewed=${toNumber(item.promotedReviewedCount) ?? 0} | promotedApprovalRate=${formatOrchestrationMetric(toNumber(item.promotedApprovalRate))} | heuristicReviewed=${toNumber(item.heuristicReviewedCount) ?? 0} | heuristicApprovalRate=${formatOrchestrationMetric(toNumber(item.heuristicApprovalRate))} | promotedAvgAppeal=${formatOrchestrationMetric(toNumber(item.promotedAverageAppealScore))} | heuristicAvgAppeal=${formatOrchestrationMetric(toNumber(item.heuristicAverageAppealScore))}`;
}

function formatShadowRerankerPromotionAdvantageLine(item) {
    if (!item || typeof item !== "object") {
        return "- promotionAdvantage=none";
    }

    return `- promotionAdvantage lane=${toTrimmed(item.lane)} | reviewed=${toNumber(item.reviewedManifestCount) ?? 0} | promotedReviewed=${toNumber(item.promotedReviewedCount) ?? 0} | heuristicReviewed=${toNumber(item.heuristicReviewedCount) ?? 0} | sufficientSample=${item.sufficientReviewSample === true ? "yes" : "no"} | approvalDelta=${formatOrchestrationMetric(toNumber(item.approvalRateDelta))} | appealDelta=${formatOrchestrationMetric(toNumber(item.appealScoreDelta))} | signal=${toTrimmed(item.signal)}`;
}

function formatShadowRerankerRetryLocalizationLine(item) {
    if (!item || typeof item !== "object") {
        return "- retryLocalization=none";
    }

    return `- retryLocalization lane=${toTrimmed(item.lane)} | scored=${toNumber(item.scoredManifestCount) ?? 0} | retrying=${toNumber(item.retryingManifestCount) ?? 0} | promotedRetrying=${toNumber(item.promotedRetryingCount) ?? 0} | promotedTargetedOnly=${toNumber(item.promotedTargetedOnlyCount) ?? 0} | promotedMixed=${toNumber(item.promotedMixedCount) ?? 0} | promotedGlobalOnly=${toNumber(item.promotedGlobalOnlyCount) ?? 0} | promotedTargetedRate=${formatOrchestrationMetric(toNumber(item.promotedSectionTargetedRate))} | heuristicRetrying=${toNumber(item.heuristicRetryingCount) ?? 0} | heuristicTargetedOnly=${toNumber(item.heuristicTargetedOnlyCount) ?? 0} | heuristicMixed=${toNumber(item.heuristicMixedCount) ?? 0} | heuristicGlobalOnly=${toNumber(item.heuristicGlobalOnlyCount) ?? 0} | heuristicTargetedRate=${formatOrchestrationMetric(toNumber(item.heuristicSectionTargetedRate))}`;
}

function buildShadowRerankerRecommendation(value) {
    const shadowReranker = normalizeShadowReranker(value);
    if (!shadowReranker || (shadowReranker.scoredManifestCount ?? 0) <= 0) {
        return null;
    }

    if (shadowReranker.promotionAdvantage && shadowReranker.promotionAdvantage.sufficientReviewSample !== true) {
        return `shadow reranker narrow-lane review data is still sparse; keep authority narrow until at least ${shadowReranker.promotionAdvantage.minimumReviewedManifestCount} reviewed runs with ${shadowReranker.promotionAdvantage.minimumReviewedPerCohortCount} per cohort accumulate`;
    }

    if (shadowReranker.promotionAdvantage?.signal === "promoted_advantage") {
        return "shadow reranker reviewed narrow-lane outcomes currently favor promoted selection; keep authority narrow while accumulating more reviewed samples before widening";
    }

    if (shadowReranker.promotionAdvantage?.signal === "heuristic_advantage") {
        return "shadow reranker reviewed narrow-lane outcomes currently favor heuristic selection; keep promotion narrow until approval or appeal deltas reverse";
    }

    if (shadowReranker.promotionAdvantage?.signal === "mixed") {
        return "shadow reranker reviewed narrow-lane outcomes are mixed across approval and appeal deltas; inspect promoted-vs-heuristic rows before widening authority";
    }

    if (shadowReranker.promotionAdvantage?.signal === "parity") {
        return "shadow reranker reviewed narrow-lane outcomes are currently at parity between promoted and heuristic selections; accumulate more samples before widening authority";
    }

    if ((shadowReranker.highConfidenceDisagreementCount ?? 0) > 0) {
        return "shadow reranker still shows high-confidence disagreement pressure; inspect recent learned-vs-heuristic mismatches before widening authority";
    }

    if ((shadowReranker.promotedSelectionCount ?? 0) > 0) {
        return "shadow reranker promotion is active on the narrow lane; inspect promoted-vs-heuristic evidence before broadening authority";
    }

    return null;
}

function normalizeOrchestrationTrends(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
            family: toTrimmed(item.family, "unknown"),
            instrumentNames: Array.isArray(item.instrumentNames)
                ? item.instrumentNames.map((entry) => toTrimmed(entry)).filter((entry) => entry !== "-")
                : [],
            manifestCount: toNumber(item.manifestCount) ?? 0,
            averageIdiomaticRangeFit: toNumber(item.averageIdiomaticRangeFit) ?? null,
            averageRegisterBalanceFit: toNumber(item.averageRegisterBalanceFit) ?? null,
            averageEnsembleConversationFit: toNumber(item.averageEnsembleConversationFit) ?? null,
            averageDoublingPressureFit: toNumber(item.averageDoublingPressureFit) ?? null,
            averageTextureRotationFit: toNumber(item.averageTextureRotationFit) ?? null,
            averageSectionHandoffFit: toNumber(item.averageSectionHandoffFit) ?? null,
            averageWeakSectionCount: toNumber(item.averageWeakSectionCount) ?? null,
            weakManifestCount: toNumber(item.weakManifestCount) ?? 0,
            lastSeenAt: toTrimmed(item.lastSeenAt, "") || null,
        }));
}

function formatOrchestrationTrendLine(item) {
    const family = toTrimmed(item?.family, "unknown") === "string_trio"
        ? "trio"
        : toTrimmed(item?.family, "unknown");
    const instruments = Array.isArray(item?.instrumentNames) && item.instrumentNames.length > 0
        ? item.instrumentNames.join(" / ")
        : "-";
    const doublingToken = typeof toNumber(item?.averageDoublingPressureFit) === "number"
        ? ` | dbl=${formatOrchestrationMetric(toNumber(item?.averageDoublingPressureFit))}`
        : "";
    const rotationToken = typeof toNumber(item?.averageTextureRotationFit) === "number"
        ? ` | rot=${formatOrchestrationMetric(toNumber(item?.averageTextureRotationFit))}`
        : "";
    const handoffToken = typeof toNumber(item?.averageSectionHandoffFit) === "number"
        ? ` | hnd=${formatOrchestrationMetric(toNumber(item?.averageSectionHandoffFit))}`
        : "";

    return `- ${family} | instruments=${instruments} | manifests=${toNumber(item?.manifestCount) ?? 0} | rng=${formatOrchestrationMetric(toNumber(item?.averageIdiomaticRangeFit))} | bal=${formatOrchestrationMetric(toNumber(item?.averageRegisterBalanceFit))} | conv=${formatOrchestrationMetric(toNumber(item?.averageEnsembleConversationFit))}${doublingToken}${rotationToken}${handoffToken} | weakManifests=${toNumber(item?.weakManifestCount) ?? 0} | avgWeakSections=${formatOrchestrationMetric(toNumber(item?.averageWeakSectionCount))} | lastSeen=${toTrimmed(item?.lastSeenAt)}`;
}

function formatPhraseBreathTrendLine(item) {
    if (!item || typeof item !== "object") {
        return "- none";
    }

    return `- manifests=${toNumber(item?.manifestCount) ?? 0} | plan=${formatOrchestrationMetric(toNumber(item?.averagePlanFit))} | cov=${formatOrchestrationMetric(toNumber(item?.averageCoverageFit))} | pickup=${formatOrchestrationMetric(toNumber(item?.averagePickupFit))} | arr=${formatOrchestrationMetric(toNumber(item?.averageArrivalFit))} | rel=${formatOrchestrationMetric(toNumber(item?.averageReleaseFit))} | weakManifests=${toNumber(item?.weakManifestCount) ?? 0} | lastSeen=${toTrimmed(item?.lastSeenAt)}`;
}

function formatHarmonicColorTrendLine(item) {
    if (!item || typeof item !== "object") {
        return "- none";
    }

    return `- manifests=${toNumber(item?.manifestCount) ?? 0} | plan=${formatOrchestrationMetric(toNumber(item?.averagePlanFit))} | cov=${formatOrchestrationMetric(toNumber(item?.averageCoverageFit))} | target=${formatOrchestrationMetric(toNumber(item?.averageTargetFit))} | time=${formatOrchestrationMetric(toNumber(item?.averageTimingFit))} | tonic=${formatOrchestrationMetric(toNumber(item?.averageTonicizationPressureFit))} | prolong=${formatOrchestrationMetric(toNumber(item?.averageProlongationMotionFit))} | weakManifests=${toNumber(item?.weakManifestCount) ?? 0} | lastSeen=${toTrimmed(item?.lastSeenAt)}`;
}

function formatNamedCountSummary(values) {
    const entries = Object.entries(values ?? {})
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    if (entries.length === 0) {
        return "none";
    }

    return entries
        .slice(0, 5)
        .map(([label, count]) => `${label}:${count}`)
        .join(",");
}

function formatLearnedBackboneBenchmarkLine(item) {
    if (!item || typeof item !== "object") {
        return "- none";
    }

    return `- lane=${toTrimmed(item?.lane)} | pack=${toTrimmed(item?.benchmarkPackVersion)} | runs=${toNumber(item?.runCount) ?? 0} | paired=${toNumber(item?.pairedRunCount) ?? 0} | reviewed=${toNumber(item?.reviewedRunCount) ?? 0} | pendingReview=${toNumber(item?.pendingReviewCount) ?? 0} | approvalRate=${formatOrchestrationMetric(toNumber(item?.approvalRate))} | avgAppeal=${formatOrchestrationMetric(toNumber(item?.averageAppealScore))} | top1Accuracy=${formatOrchestrationMetric(toNumber(item?.reviewedTop1Accuracy?.selectedTop1Accuracy))} | budgets=${formatNamedCountSummary(item?.searchBudgetCounts ?? {})}`;
}

function formatLearnedBackboneBenchmarkConfigLine(item) {
    if (!item || typeof item !== "object") {
        return "- config=none";
    }

    const snapshot = item.configSnapshot && typeof item.configSnapshot === "object"
        ? item.configSnapshot
        : null;
    const benchmarkIds = Array.isArray(snapshot?.benchmarkIds)
        ? snapshot.benchmarkIds.map((entry) => toTrimmed(entry)).filter((entry) => entry !== "-")
        : [];
    return `- config benchmarkIds=${benchmarkIds.length > 0 ? benchmarkIds.join(",") : "none"} | promptPacks=${formatNamedCountSummary(snapshot?.promptPackVersionCounts)} | reviewRubrics=${formatNamedCountSummary(snapshot?.reviewRubricVersionCounts)} | generationModes=${formatNamedCountSummary(snapshot?.generationModeCounts)} | workflows=${formatNamedCountSummary(snapshot?.workflowCounts)}`;
}

function formatLearnedBackboneBenchmarkSampleStatusLine(item) {
    const sample = item?.reviewSampleStatus && typeof item.reviewSampleStatus === "object"
        ? item.reviewSampleStatus
        : null;
    if (!sample) {
        return "- sampleStatus=none";
    }

    return `- sampleStatus=${toTrimmed(sample.status)} | reviewed=${toNumber(sample.reviewedRunCount) ?? 0} | reviewedDisagreements=${toNumber(sample.reviewedDisagreementCount) ?? 0} | screeningMin=${toNumber(sample.minimumReviewedRunCountForScreening) ?? 0} | promotionReviewedMin=${toNumber(sample.minimumReviewedRunCountForPromotion) ?? 0} | promotionDisagreementMin=${toNumber(sample.minimumReviewedDisagreementCountForPromotion) ?? 0} | screeningGap=${toNumber(sample.remainingReviewedRunCountForScreening) ?? 0} | promotionReviewedGap=${toNumber(sample.remainingReviewedRunCountForPromotion) ?? 0} | promotionDisagreementGap=${toNumber(sample.remainingReviewedDisagreementCountForPromotion) ?? 0} | earlyScreening=${sample.meetsEarlyScreeningMinimum === true ? "yes" : "no"} | promotionReviewed=${sample.meetsPromotionReviewedMinimum === true ? "yes" : "no"} | promotionDisagreements=${sample.meetsPromotionDisagreementMinimum === true ? "yes" : "no"}`;
}

function buildLearnedBackboneBenchmarkFloorGapMessage(sample) {
    if (!sample || typeof sample !== "object") {
        return null;
    }

    const reviewedGap = Math.max(0, toNumber(sample.remainingReviewedRunCountForPromotion) ?? ((toNumber(sample.minimumReviewedRunCountForPromotion) ?? 0) - (toNumber(sample.reviewedRunCount) ?? 0)));
    const disagreementGap = Math.max(0, toNumber(sample.remainingReviewedDisagreementCountForPromotion) ?? ((toNumber(sample.minimumReviewedDisagreementCountForPromotion) ?? 0) - (toNumber(sample.reviewedDisagreementCount) ?? 0)));
    const parts = [];
    if (reviewedGap > 0) {
        parts.push(`${reviewedGap} more reviewed run${reviewedGap === 1 ? "" : "s"}`);
    }
    if (disagreementGap > 0) {
        parts.push(`${disagreementGap} more reviewed disagreement${disagreementGap === 1 ? "" : "s"}`);
    }
    if (parts.length === 0) {
        return null;
    }
    return parts.length === 1
        ? `${parts[0]} is still needed to close the C4 floor`
        : `${parts.join(" and ")} are still needed to close the C4 floor`;
}

function formatLearnedBackboneBenchmarkDisagreementLine(item) {
    const summary = item?.disagreementSummary && typeof item.disagreementSummary === "object"
        ? item.disagreementSummary
        : null;
    if (!summary) {
        return "- disagreement=none";
    }

    return `- disagreement paired=${toNumber(summary.pairedRunCount) ?? 0} | disagreements=${toNumber(summary.disagreementRunCount) ?? 0} | reviewedDisagreements=${toNumber(summary.reviewedDisagreementCount) ?? 0} | promotions=${toNumber(summary.promotionAppliedCount) ?? 0} | learnedSelectedWithoutPromotion=${toNumber(summary.learnedSelectedWithoutPromotionCount) ?? 0} | baselineSelected=${toNumber(summary.baselineSelectedCount) ?? 0}`;
}

function formatLearnedBackboneBenchmarkRetryStabilityLine(item) {
    const stability = item?.retryLocalizationStability && typeof item.retryLocalizationStability === "object"
        ? item.retryLocalizationStability
        : null;
    if (!stability) {
        return "- retryStability=none";
    }

    return `- retryStability status=${toTrimmed(stability.status)} | retrying=${toNumber(stability.retryingRunCount) ?? 0} | sectionTargetedOnly=${toNumber(stability.sectionTargetedOnlyCount) ?? 0} | mixed=${toNumber(stability.mixedCount) ?? 0} | globalOnly=${toNumber(stability.globalOnlyCount) ?? 0} | targetedRate=${formatOrchestrationMetric(toNumber(stability.sectionTargetedRate))} | driftRate=${formatOrchestrationMetric(toNumber(stability.driftRate))}`;
}

function formatLearnedBackboneBenchmarkBlindPreferenceLine(item) {
    const blindPreference = item?.blindPreference && typeof item.blindPreference === "object"
        ? item.blindPreference
        : null;
    if (!blindPreference) {
        return "- blindPreference=none";
    }

    return `- blindPreference available=${blindPreference.available === true ? "yes" : "no"} | winRate=${formatOrchestrationMetric(toNumber(blindPreference.winRate))} | reviewedPairs=${toNumber(blindPreference.reviewedPairCount) ?? 0} | decisivePairs=${toNumber(blindPreference.decisivePairCount) ?? 0} | learnedWins=${toNumber(blindPreference.learnedWinCount) ?? 0} | baselineWins=${toNumber(blindPreference.baselineWinCount) ?? 0} | ties=${toNumber(blindPreference.tieCount) ?? 0} | latestReviewedAt=${toTrimmed(blindPreference.latestReviewedAt)}`;
}

function formatLearnedBackboneBenchmarkShortlistBlindPreferenceLine(item) {
    const blindPreference = item?.shortlistBlindPreference && typeof item.shortlistBlindPreference === "object"
        ? item.shortlistBlindPreference
        : null;
    if (!blindPreference) {
        return "- shortlistBlindPreference=none";
    }

    return `- shortlistBlindPreference available=${blindPreference.available === true ? "yes" : "no"} | winRate=${formatOrchestrationMetric(toNumber(blindPreference.winRate))} | reviewedPairs=${toNumber(blindPreference.reviewedPairCount) ?? 0} | decisivePairs=${toNumber(blindPreference.decisivePairCount) ?? 0} | learnedWins=${toNumber(blindPreference.learnedWinCount) ?? 0} | baselineWins=${toNumber(blindPreference.baselineWinCount) ?? 0} | ties=${toNumber(blindPreference.tieCount) ?? 0} | latestReviewedAt=${toTrimmed(blindPreference.latestReviewedAt)}`;
}

function formatLearnedBackboneBenchmarkTop1AccuracyLine(item) {
    const top1 = item?.reviewedTop1Accuracy && typeof item.reviewedTop1Accuracy === "object"
        ? item.reviewedTop1Accuracy
        : null;
    if (!top1) {
        return "- top1Accuracy=none";
    }

    return `- top1Accuracy available=${top1.available === true ? "yes" : "no"} | selected=${formatOrchestrationMetric(toNumber(top1.selectedTop1Accuracy))} | decisivePairs=${toNumber(top1.decisiveReviewedPairCount) ?? 0} | correctSelections=${toNumber(top1.correctSelectionCount) ?? 0} | learnedSelected=${formatOrchestrationMetric(toNumber(top1.learnedSelectedTop1Accuracy))} | baselineSelected=${formatOrchestrationMetric(toNumber(top1.baselineSelectedTop1Accuracy))} | promoted=${formatOrchestrationMetric(toNumber(top1.promotedTop1Accuracy))} | latestReviewedAt=${toTrimmed(top1.latestReviewedAt)}`;
}

function formatLearnedBackboneBenchmarkPairedSelectionLine(item) {
    const outcomes = item?.pairedSelectionOutcomes && typeof item.pairedSelectionOutcomes === "object"
        ? item.pairedSelectionOutcomes
        : null;
    if (!outcomes) {
        return "- pairedSelection=none";
    }

    return `- pairedSelection reviewed=${toNumber(outcomes.reviewedManifestCount) ?? 0} | promotedReviewed=${toNumber(outcomes.promotedReviewedCount) ?? 0} | heuristicReviewed=${toNumber(outcomes.heuristicReviewedCount) ?? 0} | promotedApproval=${formatOrchestrationMetric(toNumber(outcomes.promotedApprovalRate))} | heuristicApproval=${formatOrchestrationMetric(toNumber(outcomes.heuristicApprovalRate))} | promotedAppeal=${formatOrchestrationMetric(toNumber(outcomes.promotedAverageAppealScore))} | heuristicAppeal=${formatOrchestrationMetric(toNumber(outcomes.heuristicAverageAppealScore))}`;
}

function formatLearnedBackboneBenchmarkSelectedWorkerOutcomeLine(worker, item) {
    if (!item || typeof item !== "object") {
        return `- selectedWorkerOutcome worker=${toTrimmed(worker)} | runs=0 | reviewed=0 | pendingReview=0 | approved=0 | rejected=0 | approvalRate=? | avgAppeal=?`;
    }

    return `- selectedWorkerOutcome worker=${toTrimmed(worker)} | runs=${toNumber(item?.runCount) ?? 0} | reviewed=${toNumber(item?.reviewedRunCount) ?? 0} | pendingReview=${toNumber(item?.pendingReviewCount) ?? 0} | approved=${toNumber(item?.approvedCount) ?? 0} | rejected=${toNumber(item?.rejectedCount) ?? 0} | approvalRate=${formatOrchestrationMetric(toNumber(item?.approvalRate))} | avgAppeal=${formatOrchestrationMetric(toNumber(item?.averageAppealScore))}`;
}

function formatLearnedBackboneBenchmarkCoverageLine(item) {
    if (!item || typeof item !== "object") {
        return "- coverage=none";
    }

    return `- coverage benchmark=${toTrimmed(item?.benchmarkId || item?.benchmarkKey)} | runs=${toNumber(item?.runCount) ?? 0} | paired=${toNumber(item?.pairedRunCount) ?? 0} | reviewed=${toNumber(item?.reviewedRunCount) ?? 0} | pendingReview=${toNumber(item?.pendingReviewCount) ?? 0} | approvalRate=${formatOrchestrationMetric(toNumber(item?.approvalRate))} | avgAppeal=${formatOrchestrationMetric(toNumber(item?.averageAppealScore))} | selectedWorkers=${formatNamedCountSummary(item?.selectedWorkerCounts)} | generationModes=${formatNamedCountSummary(item?.generationModeCounts)} | lastObserved=${toTrimmed(item?.latestObservedAt)}`;
}

function formatLearnedBackboneBenchmarkReviewQueueLine(item) {
    const reviewQueue = item?.reviewQueue && typeof item.reviewQueue === "object"
        ? item.reviewQueue
        : null;
    if (!reviewQueue) {
        return "- reviewQueue=none";
    }

    return `- reviewQueue pendingBlind=${toNumber(reviewQueue.pendingBlindReviewCount) ?? 0} | pendingShortlist=${toNumber(reviewQueue.pendingShortlistReviewCount) ?? 0} | latestPendingAt=${toTrimmed(reviewQueue.latestPendingAt)}`;
}

function formatLearnedBackboneBenchmarkReviewQueueRowLine(item) {
    const searchBudget = toTrimmed(item?.searchBudgetDescriptor) || toTrimmed(item?.searchBudgetLevel);
    return `- reviewQueue song=${toTrimmed(item?.songId)} | target=${toTrimmed(item?.reviewTarget)} | benchmark=${toTrimmed(item?.benchmarkId)} | searchBudget=${searchBudget} | candidates=${toNumber(item?.wholePieceCandidateCount) ?? 0} | selectedWorker=${toTrimmed(item?.selectedWorker)} | counterfactual=${toTrimmed(item?.counterfactualWorker)} | selectionMode=${toTrimmed(item?.selectionMode)} | topK=${formatOrchestrationMetric(toNumber(item?.shortlistTopK))} | selectedRank=${formatOrchestrationMetric(toNumber(item?.selectedRank))} | inTopK=${item?.selectedInShortlist === true ? "yes" : "no"} | observedAt=${toTrimmed(item?.observedAt)}`;
}

function formatLearnedBackboneBenchmarkReviewPacksLine(item) {
    const reviewPacks = item?.reviewPacks && typeof item.reviewPacks === "object"
        ? item.reviewPacks
        : null;
    if (!reviewPacks) {
        return "- reviewPacks=none";
    }

    return `- reviewPacks matched=${toNumber(reviewPacks.matchedPackCount) ?? 0} | active=${toNumber(reviewPacks.activePackCount) ?? 0} | pendingDecisions=${toNumber(reviewPacks.pendingDecisionCount) ?? 0} | completedDecisions=${toNumber(reviewPacks.completedDecisionCount) ?? 0} | latestGeneratedAt=${toTrimmed(reviewPacks.latestGeneratedAt)} | latestReviewedAt=${toTrimmed(reviewPacks.latestReviewedAt)}`;
}

function formatLearnedBackboneBenchmarkReviewPackRowLine(item) {
    const reviewSheetPath = toTrimmed(item?.reviewSheetPath) || "-";
    const recordCommand = reviewSheetPath === "-"
        ? "-"
        : `npm run ml:review-pack:record:learned-backbone -- --resultsFile ${reviewSheetPath}`;
    const searchBudget = toTrimmed(item?.searchBudget, "") || null;
    return [
        `- reviewPack pack=${toTrimmed(item?.packId)}`,
        `target=${toTrimmed(item?.reviewTarget)}`,
        ...(searchBudget ? [`searchBudget=${searchBudget}`] : []),
        `entries=${toNumber(item?.entryCount) ?? 0}`,
        `completed=${toNumber(item?.completedDecisionCount) ?? 0}`,
        `pending=${toNumber(item?.pendingDecisionCount) ?? 0}`,
        `pendingShortlist=${toNumber(item?.pendingShortlistDecisionCount) ?? 0}`,
        `generatedAt=${toTrimmed(item?.generatedAt)}`,
        `latestReviewedAt=${toTrimmed(item?.latestReviewedAt)}`,
        `reviewSheet=${reviewSheetPath}`,
        `recordCommand=${recordCommand}`,
    ].join(" | ");
}

function formatLearnedBackboneBenchmarkReviewPackActionLine(item) {
    const searchBudget = toTrimmed(item?.searchBudget, "") || null;
    return [
        `- reviewPack target=${toTrimmed(item?.reviewTarget)}`,
        ...(searchBudget ? [`searchBudget=${searchBudget}`] : []),
        `pendingPairs=${toNumber(item?.pendingPairCount) ?? 0}`,
        `priority=${toTrimmed(item?.priority)}`,
        `command=${toTrimmed(item?.command)}`,
    ].join(" | ");
}

function formatLearnedBackboneBenchmarkSearchBudgetLine(item) {
    if (!item || typeof item !== "object") {
        return "- searchBudget=none";
    }

    const searchBudget = toTrimmed(item?.searchBudgetDescriptor) || toTrimmed(item?.searchBudgetLevel);
    return `- searchBudget=${searchBudget} | candidates=${toNumber(item?.wholePieceCandidateCount) ?? 0} | runs=${toNumber(item?.runCount) ?? 0} | reviewed=${toNumber(item?.reviewedRunCount) ?? 0} | pendingReview=${toNumber(item?.pendingReviewCount) ?? 0} | approvalRate=${formatOrchestrationMetric(toNumber(item?.approvalRate))} | blindPreference=${formatOrchestrationMetric(toNumber(item?.blindPreferenceWinRate))} | top1Accuracy=${formatOrchestrationMetric(toNumber(item?.selectedTop1Accuracy))} | decisivePairs=${toNumber(item?.decisivePairCount) ?? 0} | correctSelections=${toNumber(item?.correctSelectionCount) ?? 0} | lastObserved=${toTrimmed(item?.latestObservedAt)}`;
}

function formatLearnedBackboneBenchmarkPromotionGateLine(item) {
    const promotionGate = item?.promotionGate && typeof item.promotionGate === "object"
        ? item.promotionGate
        : null;
    if (!promotionGate) {
        return "- promotionGate=none";
    }

    return `- promotionGate status=${toTrimmed(promotionGate.status)} | signal=${toTrimmed(promotionGate.signal)} | reviewedFloor=${promotionGate.meetsReviewedRunMinimum === true ? "yes" : "no"} | disagreementFloor=${promotionGate.meetsReviewedDisagreementMinimum === true ? "yes" : "no"} | shortlistFloor=${promotionGate.meetsReviewedSelectedInShortlistMinimum === true ? "yes" : "no"} | retryStable=${promotionGate.retryLocalizationStable === true ? "yes" : "no"} | blindPreference=${promotionGate.blindPreferenceAvailable === true ? "yes" : "no"} | reviewedInTopK=${formatOrchestrationMetric(toNumber(promotionGate.reviewedSelectedInShortlistRate))} | reviewedTop1=${formatOrchestrationMetric(toNumber(promotionGate.reviewedSelectedTop1Rate))} | shortlistMin=${formatOrchestrationMetric(toNumber(promotionGate.minimumReviewedSelectedInShortlistRate))} | approvalDelta=${formatOrchestrationMetric(toNumber(promotionGate.approvalRateDelta))} | appealDelta=${formatOrchestrationMetric(toNumber(promotionGate.appealScoreDelta))} | blockers=${Array.isArray(promotionGate.blockers) && promotionGate.blockers.length > 0 ? promotionGate.blockers.join(",") : "none"}`;
}

function formatLearnedBackboneBenchmarkFailureModeLine(item) {
    return `- failureMode=${toTrimmed(item?.failureMode)} | count=${toNumber(item?.count) ?? 0}`;
}

function formatLearnedBackboneBenchmarkStopReasonLine(item) {
    return `- stopReason count=${toNumber(item?.count) ?? 0} | reason=${toTrimmed(item?.reason)}`;
}

function formatLearnedBackboneBenchmarkRecentRunLine(item) {
    const searchBudget = toTrimmed(item?.searchBudgetDescriptor) || toTrimmed(item?.searchBudgetLevel);
    return `- run song=${toTrimmed(item?.songId)} | benchmark=${toTrimmed(item?.benchmarkId)} | searchBudget=${searchBudget} | candidates=${toNumber(item?.wholePieceCandidateCount) ?? 0} | selectedWorker=${toTrimmed(item?.selectedWorker)} | approval=${toTrimmed(item?.approvalStatus)} | selectionMode=${toTrimmed(item?.selectionMode)} | disagreement=${item?.disagreementObserved === true ? "yes" : "no"} | promotion=${item?.promotionApplied === true ? "yes" : "no"} | retry=${toTrimmed(item?.retryLocalization)} | weakest=${toTrimmed(item?.reviewWeakestDimension)} | observedAt=${toTrimmed(item?.observedAt)}`;
}

function buildLearnedBackboneBenchmarkRecommendation(value) {
    const benchmark = normalizeLearnedBackboneBenchmark(value);
    if (!benchmark || (benchmark.runCount ?? 0) <= 0) {
        return null;
    }

    if ((benchmark.reviewPacks?.activePackCount ?? 0) > 0) {
        const activePackCount = benchmark.reviewPacks?.activePackCount ?? 0;
        const pendingDecisionCount = benchmark.reviewPacks?.pendingDecisionCount ?? 0;
        const reviewPackMessage = activePackCount === 1
            ? `finish ${pendingDecisionCount} pending worksheet decision(s) in 1 active learned backbone review pack before generating more blind-review packs`
            : `finish ${pendingDecisionCount} pending worksheet decision(s) across ${activePackCount} active learned backbone review packs before generating more blind-review packs`;
        if (benchmark.retryLocalizationStability?.status === "drifting") {
            return `${reviewPackMessage}; learned backbone benchmark retry localization is drifting, so keep localized rewrite experimental until section-targeted stability recovers`;
        }
        if (benchmark.promotionGate?.rationale) {
            return `${reviewPackMessage}; ${benchmark.promotionGate.rationale}`;
        }
        return reviewPackMessage;
    }

    if ((benchmark.reviewQueue?.pendingBlindReviewCount ?? 0) > 0) {
        const pendingBlind = benchmark.reviewQueue?.pendingBlindReviewCount ?? 0;
        const pendingShortlist = benchmark.reviewQueue?.pendingShortlistReviewCount ?? 0;
        const reviewQueueMessage = pendingShortlist > 0
            ? `route ${pendingShortlist} shortlist-qualified blind review pair(s) first (${pendingBlind} pending total) before treating learned backbone promotion signals as stable`
            : `route ${pendingBlind} pending learned backbone blind review pair(s) before treating learned backbone promotion signals as stable`;
        if (benchmark.retryLocalizationStability?.status === "drifting") {
            return `${reviewQueueMessage}; learned backbone benchmark retry localization is drifting, so keep localized rewrite experimental until section-targeted stability recovers`;
        }
        if (benchmark.promotionGate?.rationale) {
            return `${reviewQueueMessage}; ${benchmark.promotionGate.rationale}`;
        }
        return reviewQueueMessage;
    }

    if (benchmark.promotionGate?.status === "experimental" && benchmark.promotionGate.rationale) {
        return benchmark.promotionGate.rationale;
    }

    if (benchmark.promotionGate?.status === "blocked" && benchmark.promotionGate.rationale) {
        return benchmark.promotionGate.rationale;
    }

    if (benchmark.promotionGate?.status === "review_hold" && benchmark.promotionGate.rationale) {
        return benchmark.promotionGate.rationale;
    }

    if (benchmark.promotionGate?.status === "ready_for_guarded_promotion" && benchmark.promotionGate.rationale) {
        return benchmark.promotionGate.rationale;
    }

    if (benchmark.retryLocalizationStability?.status === "drifting") {
        return "learned backbone benchmark retry localization is drifting; keep localized rewrite experimental until section-targeted stability recovers";
    }

    if (benchmark.reviewSampleStatus && (
        benchmark.reviewSampleStatus.meetsPromotionReviewedMinimum !== true
        || benchmark.reviewSampleStatus.meetsPromotionDisagreementMinimum !== true
    )) {
        const floorGapMessage = buildLearnedBackboneBenchmarkFloorGapMessage(benchmark.reviewSampleStatus);
        if (floorGapMessage) {
            return `learned backbone benchmark is still directional; keep matrix decisions narrow while ${floorGapMessage}`;
        }
        return `learned backbone benchmark is still directional; keep matrix decisions narrow until at least ${benchmark.reviewSampleStatus.minimumReviewedRunCountForPromotion} reviewed runs and ${benchmark.reviewSampleStatus.minimumReviewedDisagreementCountForPromotion} reviewed disagreements accumulate`;
    }

    if (benchmark.promotionAdvantage && benchmark.promotionAdvantage.sufficientReviewSample !== true) {
        return `learned backbone benchmark still has sparse reviewed comparison data; keep narrow-lane authority bounded until at least ${benchmark.promotionAdvantage.minimumReviewedManifestCount} reviewed runs with ${benchmark.promotionAdvantage.minimumReviewedPerCohortCount} per cohort accumulate`;
    }

    if (benchmark.promotionAdvantage?.signal === "promoted_advantage") {
        return "learned backbone benchmark currently favors learned selection on reviewed evidence; confirm the gain on more narrow-lane samples before widening backbone scope";
    }

    if (benchmark.promotionAdvantage?.signal === "heuristic_advantage") {
        return "learned backbone benchmark still favors baseline selection on reviewed evidence; keep music21 authoritative while investigating failure modes";
    }

    if (benchmark.promotionAdvantage?.signal === "mixed") {
        return "learned backbone benchmark reviewed signals are mixed; inspect failure modes and recent runs before changing the matrix winner";
    }

    if (benchmark.promotionAdvantage?.signal === "parity") {
        return "learned backbone benchmark shows no material reviewed winner yet; accumulate more narrow-lane evidence before widening scope";
    }

    return null;
}

function dayKeyFromObservedAt(value) {
    const parsed = Date.parse(String(value || "").trim());
    if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
}

function resolveProjectionDir() {
    const explicit = readOption("projectionDir") || process.env.AXIOM_OPERATOR_PROJECTION_DIR;
    if (explicit) {
        return explicit;
    }

    const outputDir = process.env.OUTPUT_DIR || "outputs";
    return path.join(outputDir, "_system", "operator-summary");
}

function resolveSweepDir() {
    const explicit = readOption("sweepDir") || process.env.AXIOM_OPERATOR_SWEEP_DIR;
    if (explicit) {
        return explicit;
    }

    const outputDir = process.env.OUTPUT_DIR || "outputs";
    return path.join(outputDir, "_system", "operator-sweep");
}

function resolvePickupDir() {
    const explicit = readOption("dir") || process.env.AXIOM_OPERATOR_PICKUP_DIR;
    if (explicit) {
        return explicit;
    }

    const outputDir = process.env.OUTPUT_DIR || "outputs";
    return path.join(outputDir, "_system", "operator-pickup");
}

function readJsonFile(filePath, label, required = true) {
    if (!fs.existsSync(filePath)) {
        if (!required) {
            return null;
        }
        throw createScriptError(`${label} artifact is missing`, { filePath });
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (error) {
        throw createScriptError(`${label} artifact is not valid JSON`, {
            filePath,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function writeFailureArtifacts(pickupDir, payload) {
    const observedAt = toTrimmed(payload.observedAt, new Date().toISOString());
    const dayKey = dayKeyFromObservedAt(observedAt);
    const latestErrorPath = path.join(pickupDir, "latest-error.json");
    const errorHistoryPath = path.join(pickupDir, "errors", `${dayKey}.jsonl`);

    writeAtomic(latestErrorPath, JSON.stringify(payload, null, 2) + "\n");
    ensureDir(path.dirname(errorHistoryPath));
    fs.appendFileSync(errorHistoryPath, JSON.stringify(payload) + "\n", "utf-8");

    return {
        latestErrorPath,
        errorHistoryPath,
    };
}

function buildPickupSummary(result) {
    return [
        `triage=${toTrimmed(result.triage?.state)}`,
        `severity=${toTrimmed(result.triage?.severity)}`,
        `bridge=${result.bridge?.ok === true ? "ok" : "failed"}`,
        `readiness=${toTrimmed(result.readiness?.status)}`,
        `pending=${toNumber(result.autonomy?.pendingApprovalCount) ?? 0}`,
        `warnings=${toNumber(result.overseer?.activeRepeatedWarningCount) ?? 0}`,
        `latestAction=${toTrimmed(result.latestOperatorAction?.action, "none")}`,
        `incidentDraft=${result.incidentDraft?.present === true ? "yes" : "no"}`,
    ].join(" | ");
}

function buildPickupPayload(summary, sweep, incidentDraft, paths) {
    const triage = summary?.triage && typeof summary.triage === "object"
        ? {
            state: toTrimmed(sweep?.triage?.state ?? summary.triage.state, "healthy"),
            severity: toTrimmed(sweep?.triage?.severity ?? summary.triage.severity, "none"),
            severityScore: toNumber(sweep?.triage?.severityScore ?? summary.triage.severityScore) ?? 0,
            recommendedLane: toTrimmed(sweep?.triage?.recommendedLane ?? summary.triage.recommendedLane, "routine"),
            reasonCodes: Array.isArray(sweep?.triage?.reasonCodes)
                ? sweep.triage.reasonCodes.map((item) => toTrimmed(item)).filter((item) => item !== "-")
                : Array.isArray(summary.triage.reasonCodes)
                    ? summary.triage.reasonCodes.map((item) => toTrimmed(item)).filter((item) => item !== "-")
                    : [],
            severityDrivers: Array.isArray(sweep?.triage?.severityDrivers)
                ? sweep.triage.severityDrivers
                : Array.isArray(summary.triage.severityDrivers)
                    ? summary.triage.severityDrivers
                    : [],
        }
        : {
            state: toTrimmed(sweep?.triage?.state, "healthy"),
            severity: toTrimmed(sweep?.triage?.severity, "none"),
            severityScore: toNumber(sweep?.triage?.severityScore) ?? 0,
            recommendedLane: toTrimmed(sweep?.triage?.recommendedLane, "routine"),
            reasonCodes: Array.isArray(sweep?.triage?.reasonCodes)
                ? sweep.triage.reasonCodes.map((item) => toTrimmed(item)).filter((item) => item !== "-")
                : [],
            severityDrivers: Array.isArray(sweep?.triage?.severityDrivers)
                ? sweep.triage.severityDrivers
                : [],
        };

    const payload = {
        ok: true,
        observedAt: new Date().toISOString(),
        source: toTrimmed(sweep?.source ?? summary?.source, "gcpCompute"),
        pickupDir: paths.pickupDir,
        summary: "-",
        triage,
        readiness: summary?.readiness ?? null,
        queue: {
            total: toNumber(summary?.queue?.total) ?? 0,
            queued: toNumber(summary?.queue?.queued) ?? 0,
            running: toNumber(summary?.queue?.running) ?? 0,
            retryScheduled: toNumber(summary?.queue?.retryScheduled) ?? 0,
            failedLike: toNumber(summary?.queue?.failedLike) ?? 0,
            backlog: summary?.queue?.backlog ?? {
                count: 0,
                retryScheduled: 0,
                failedLike: 0,
                oldestAgeMs: 0,
                topJobs: [],
            },
        },
        autonomy: {
            paused: summary?.autonomy?.paused === true,
            pendingApprovalCount: toNumber(summary?.autonomy?.pendingApprovalCount) ?? 0,
            activeRun: summary?.autonomy?.activeRun ?? null,
            pendingApprovals: Array.isArray(summary?.autonomy?.pendingApprovals)
                ? summary.autonomy.pendingApprovals
                : [],
            lockHealth: summary?.autonomy?.lockHealth ?? null,
        },
        latestOperatorAction: summary?.latestOperatorAction && typeof summary.latestOperatorAction === "object"
            ? {
                present: summary.latestOperatorAction.present === true,
                action: toTrimmed(summary.latestOperatorAction.action, ""),
                surface: toTrimmed(summary.latestOperatorAction.surface, ""),
                actor: toTrimmed(summary.latestOperatorAction.actor, ""),
                approvedBy: toTrimmed(summary.latestOperatorAction.approvedBy, ""),
                reason: toTrimmed(summary.latestOperatorAction.reason, ""),
                rollbackNote: toTrimmed(summary.latestOperatorAction.rollbackNote, ""),
                manualRecoveryNote: toTrimmed(summary.latestOperatorAction.manualRecoveryNote, ""),
                observedAt: toTrimmed(summary.latestOperatorAction.observedAt, ""),
                artifactLinks: Array.isArray(summary.latestOperatorAction.artifactLinks)
                    ? summary.latestOperatorAction.artifactLinks.map((item) => toTrimmed(item)).filter((item) => item !== "-")
                    : [],
            }
            : {
                present: false,
                action: "",
                surface: "",
                actor: "",
                approvedBy: "",
                reason: "",
                rollbackNote: "",
                manualRecoveryNote: "",
                observedAt: "",
                artifactLinks: [],
            },
        overseer: {
            lastSuccessAt: toTrimmed(summary?.overseer?.lastSuccessAt),
            failureCount24h: toNumber(summary?.overseer?.failureCount24h) ?? 0,
            activeRepeatedWarningCount: toNumber(summary?.overseer?.activeRepeatedWarningCount) ?? 0,
            repeatedWarnings: Array.isArray(summary?.overseer?.repeatedWarnings)
                ? summary.overseer.repeatedWarnings
                : [],
            phraseBreathTrend: normalizePhraseBreathTrend(summary?.overseer?.phraseBreathTrend),
            harmonicColorTrend: normalizeHarmonicColorTrend(summary?.overseer?.harmonicColorTrend),
            learnedBackboneBenchmark: normalizeLearnedBackboneBenchmark(summary?.overseer?.learnedBackboneBenchmark),
            shadowReranker: normalizeShadowReranker(summary?.overseer?.shadowReranker),
            orchestrationTrends: normalizeOrchestrationTrends(summary?.overseer?.orchestrationTrends),
        },
        bridge: {
            ok: sweep?.bridge?.ok === true,
            toolCount: toNumber(sweep?.bridge?.payload?.toolCount) ?? 0,
            probeCallStatus: toTrimmed(sweep?.bridge?.payload?.probeCallStatus),
            fallbackStatus: toTrimmed(sweep?.bridge?.payload?.fallbackStatus),
        },
        incidentDraft: incidentDraft
            ? {
                present: true,
                incidentId: toTrimmed(incidentDraft.incidentId),
                observedAt: toTrimmed(incidentDraft.observedAt),
                state: toTrimmed(incidentDraft.state),
                severity: toTrimmed(incidentDraft.severity),
                severityScore: toNumber(incidentDraft.severityScore) ?? 0,
                severityDrivers: Array.isArray(incidentDraft.severityDrivers)
                    ? incidentDraft.severityDrivers
                    : [],
                status: toTrimmed(incidentDraft.status),
                scope: toTrimmed(incidentDraft.scope),
                escalation: incidentDraft.escalation && typeof incidentDraft.escalation === "object"
                    ? {
                        required: incidentDraft.escalation.required === true,
                        ownerRole: toTrimmed(incidentDraft.escalation.ownerRole),
                        cadenceMinutes: toNumber(incidentDraft.escalation.cadenceMinutes) ?? 0,
                        nextUpdateBy: toTrimmed(incidentDraft.escalation.nextUpdateBy),
                        channels: Array.isArray(incidentDraft.escalation.channels)
                            ? incidentDraft.escalation.channels.map((item) => toTrimmed(item)).filter((item) => item !== "-")
                            : [],
                        requiredArtifacts: Array.isArray(incidentDraft.escalation.requiredArtifacts)
                            ? incidentDraft.escalation.requiredArtifacts.map((item) => toTrimmed(item)).filter((item) => item !== "-")
                            : [],
                        triggers: Array.isArray(incidentDraft.escalation.triggers)
                            ? incidentDraft.escalation.triggers.map((item) => toTrimmed(item)).filter((item) => item !== "-")
                            : [],
                    }
                    : null,
                comms: incidentDraft.comms && typeof incidentDraft.comms === "object"
                    ? {
                        currentStatus: toTrimmed(incidentDraft.comms.currentStatus),
                        userImpact: toTrimmed(incidentDraft.comms.userImpact),
                        scopeSummary: toTrimmed(incidentDraft.comms.scopeSummary),
                        changeSummary: toTrimmed(incidentDraft.comms.changeSummary),
                        nextAction: toTrimmed(incidentDraft.comms.nextAction),
                        eta: toTrimmed(incidentDraft.comms.eta),
                        initialAcknowledgement: toTrimmed(incidentDraft.comms.initialAcknowledgement),
                        mitigationInProgress: toTrimmed(incidentDraft.comms.mitigationInProgress),
                    }
                    : null,
                phraseBreathTrend: normalizePhraseBreathTrend(incidentDraft.phraseBreathTrend),
                harmonicColorTrend: normalizeHarmonicColorTrend(incidentDraft.harmonicColorTrend),
                learnedBackboneBenchmark: normalizeLearnedBackboneBenchmark(incidentDraft.learnedBackboneBenchmark),
                shadowReranker: normalizeShadowReranker(incidentDraft.shadowReranker),
                orchestrationTrends: normalizeOrchestrationTrends(incidentDraft.orchestrationTrends),
                latestJsonPath: paths.incidentJsonPath,
                latestMarkdownPath: paths.incidentMarkdownPath,
            }
            : {
                present: false,
                severityScore: 0,
                severityDrivers: [],
                escalation: null,
                comms: null,
                phraseBreathTrend: null,
                harmonicColorTrend: null,
                learnedBackboneBenchmark: null,
                shadowReranker: null,
                orchestrationTrends: [],
                latestJsonPath: paths.incidentJsonPath,
                latestMarkdownPath: paths.incidentMarkdownPath,
            },
        recommendations: Array.isArray(sweep?.recommendations)
            ? sweep.recommendations.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
        evidence: {
            projectionObservedAt: toTrimmed(summary?.observedAt),
            sweepObservedAt: toTrimmed(sweep?.observedAt),
            projectionStale: summary?.evidence?.stale === true,
            projectionOk: summary?.ok === true,
            sweepOk: sweep?.ok === true,
            sourceArtifacts: [
                paths.projectionJsonPath,
                paths.projectionMarkdownPath,
                paths.sweepJsonPath,
                paths.sweepMarkdownPath,
                ...(incidentDraft ? [paths.incidentJsonPath, paths.incidentMarkdownPath] : []),
            ],
        },
        artifacts: {
            projectionDir: paths.projectionDir,
            sweepDir: paths.sweepDir,
            pickupDir: paths.pickupDir,
        },
    };

    payload.summary = buildPickupSummary(payload);
    return payload;
}

function buildMarkdown(pickup) {
    const pendingApprovals = Array.isArray(pickup.autonomy?.pendingApprovals)
        ? pickup.autonomy.pendingApprovals
        : [];
    const warnings = Array.isArray(pickup.overseer?.repeatedWarnings)
        ? pickup.overseer.repeatedWarnings
        : [];
    const phraseBreathTrend = pickup.overseer?.phraseBreathTrend && typeof pickup.overseer.phraseBreathTrend === "object"
        ? pickup.overseer.phraseBreathTrend
        : null;
    const harmonicColorTrend = pickup.overseer?.harmonicColorTrend && typeof pickup.overseer.harmonicColorTrend === "object"
        ? pickup.overseer.harmonicColorTrend
        : null;
    const learnedBackboneBenchmark = pickup.overseer?.learnedBackboneBenchmark && typeof pickup.overseer.learnedBackboneBenchmark === "object"
        ? pickup.overseer.learnedBackboneBenchmark
        : null;
    const shadowReranker = pickup.overseer?.shadowReranker && typeof pickup.overseer.shadowReranker === "object"
        ? pickup.overseer.shadowReranker
        : null;
    const orchestrationTrends = Array.isArray(pickup.overseer?.orchestrationTrends)
        ? pickup.overseer.orchestrationTrends
        : [];
    const backlogJobs = Array.isArray(pickup.queue?.backlog?.topJobs)
        ? pickup.queue.backlog.topJobs
        : [];

    const lines = [
        "# AXIOM Shared Operator Pickup",
        "",
        `- observedAt: ${toTrimmed(pickup.observedAt)}`,
        `- source: ${toTrimmed(pickup.source)}`,
        `- pickupDir: ${toTrimmed(pickup.pickupDir)}`,
        "",
        "## Summary",
        "",
        pickup.summary,
        "",
        "## Triage",
        "",
        `- state: ${toTrimmed(pickup.triage?.state)}`,
        `- severity: ${toTrimmed(pickup.triage?.severity)}`,
        `- severityScore: ${toNumber(pickup.triage?.severityScore) ?? 0}`,
        `- recommendedLane: ${toTrimmed(pickup.triage?.recommendedLane)}`,
        `- reasonCodes: ${Array.isArray(pickup.triage?.reasonCodes) && pickup.triage.reasonCodes.length > 0 ? pickup.triage.reasonCodes.join(", ") : "none"}`,
        `- severityDrivers: ${Array.isArray(pickup.triage?.severityDrivers) && pickup.triage.severityDrivers.length > 0 ? pickup.triage.severityDrivers.map((item) => `${toTrimmed(item.code)}(${toNumber(item.weight) ?? 0})`).join(", ") : "none"}`,
        "",
        "## Readiness",
        "",
        `- status: ${toTrimmed(pickup.readiness?.status)}`,
        `- detail: ${toTrimmed(pickup.readiness?.detail)}`,
        "",
        "## Bridge",
        "",
        `- ok: ${pickup.bridge?.ok === true ? "yes" : "no"}`,
        `- toolCount: ${toNumber(pickup.bridge?.toolCount) ?? 0}`,
        `- probeCallStatus: ${toTrimmed(pickup.bridge?.probeCallStatus)}`,
        `- fallbackStatus: ${toTrimmed(pickup.bridge?.fallbackStatus)}`,
        "",
        "## Queue",
        "",
        `- total: ${toNumber(pickup.queue?.total) ?? 0}`,
        `- queued: ${toNumber(pickup.queue?.queued) ?? 0}`,
        `- running: ${toNumber(pickup.queue?.running) ?? 0}`,
        `- retryScheduled: ${toNumber(pickup.queue?.retryScheduled) ?? 0}`,
        `- failedLike: ${toNumber(pickup.queue?.failedLike) ?? 0}`,
        `- backlogCount: ${toNumber(pickup.queue?.backlog?.count) ?? 0}`,
        `- backlogOldestAgeMs: ${toNumber(pickup.queue?.backlog?.oldestAgeMs) ?? 0}`,
        "",
        "## Top Backlog",
        "",
    ];

    if (backlogJobs.length === 0) {
        lines.push("- none");
    } else {
        for (const item of backlogJobs) {
            lines.push(`- ${toTrimmed(item.jobId)} | status=${toTrimmed(item.status)} | song=${toTrimmed(item.songId)} | ageMs=${toNumber(item.ageMs) ?? 0} | updated=${toTrimmed(item.updatedAt)} | nextAttemptAt=${toTrimmed(item.nextAttemptAt)}`);
        }
    }

    lines.push(
        "",
        "## Pending Approvals",
        "",
        `- count: ${toNumber(pickup.autonomy?.pendingApprovalCount) ?? 0}`,
    );

    if (pendingApprovals.length === 0) {
        lines.push("- none");
    } else {
        for (const item of pendingApprovals.slice(0, 5)) {
            lines.push(`- ${toTrimmed(item.songId)} | approval=${toTrimmed(item.approvalStatus)} | updated=${toTrimmed(item.updatedAt)} | form=${toTrimmed(item.form)} | prompt=${toTrimmed(item.prompt)}`);
        }
    }

    lines.push(
        "",
        "## Latest Operator Action",
        "",
        `- present: ${pickup.latestOperatorAction?.present === true ? "yes" : "no"}`,
        `- action: ${toTrimmed(pickup.latestOperatorAction?.action)}`,
        `- surface: ${toTrimmed(pickup.latestOperatorAction?.surface)}`,
        `- actor: ${toTrimmed(pickup.latestOperatorAction?.actor)}`,
        `- approvedBy: ${toTrimmed(pickup.latestOperatorAction?.approvedBy)}`,
        `- observedAt: ${toTrimmed(pickup.latestOperatorAction?.observedAt)}`,
        `- reason: ${toTrimmed(pickup.latestOperatorAction?.reason)}`,
        `- rollbackNote: ${toTrimmed(pickup.latestOperatorAction?.rollbackNote)}`,
        `- manualRecoveryNote: ${toTrimmed(pickup.latestOperatorAction?.manualRecoveryNote)}`,
    );
    if (Array.isArray(pickup.latestOperatorAction?.artifactLinks) && pickup.latestOperatorAction.artifactLinks.length > 0) {
        for (const item of pickup.latestOperatorAction.artifactLinks) {
            lines.push(`- artifact: ${toTrimmed(item)}`);
        }
    } else {
        lines.push("- artifact: none");
    }

    lines.push(
        "",
        "## Repeated Warnings",
        "",
        `- count: ${toNumber(pickup.overseer?.activeRepeatedWarningCount) ?? 0}`,
    );

    if (warnings.length === 0) {
        lines.push("- none");
    } else {
        for (const item of warnings.slice(0, 5)) {
            lines.push(`- x${toNumber(item.count) ?? 0} | lastSeen=${toTrimmed(item.lastSeenAt)} | ${toTrimmed(item.warning)}`);
        }
    }

    lines.push("", "## Phrase-Breath Trend", "");
    if (!phraseBreathTrend) {
        lines.push("- none");
    } else {
        lines.push(formatPhraseBreathTrendLine(phraseBreathTrend));
    }

    lines.push("", "## Harmonic-Color Trend", "");
    if (!harmonicColorTrend) {
        lines.push("- none");
    } else {
        lines.push(formatHarmonicColorTrendLine(harmonicColorTrend));
    }

    lines.push("", "## Learned Backbone Benchmark", "");
    if (!learnedBackboneBenchmark || (toNumber(learnedBackboneBenchmark.runCount) ?? 0) <= 0) {
        lines.push("- none");
    } else {
        lines.push(formatLearnedBackboneBenchmarkLine(learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkConfigLine(learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkSampleStatusLine(learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkBlindPreferenceLine(learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkShortlistBlindPreferenceLine(learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkTop1AccuracyLine(learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkPairedSelectionLine(learnedBackboneBenchmark));
        for (const [worker, summary] of Object.entries(learnedBackboneBenchmark.selectedWorkerOutcomes ?? {})
            .sort((left, right) => (toNumber(right[1]?.runCount) ?? 0) - (toNumber(left[1]?.runCount) ?? 0) || left[0].localeCompare(right[0]))) {
            lines.push(formatLearnedBackboneBenchmarkSelectedWorkerOutcomeLine(worker, summary));
        }
        for (const item of learnedBackboneBenchmark.coverageRows ?? []) {
            lines.push(formatLearnedBackboneBenchmarkCoverageLine(item));
        }
        lines.push(formatLearnedBackboneBenchmarkReviewQueueLine(learnedBackboneBenchmark));
        for (const item of learnedBackboneBenchmark.reviewQueue?.recentPendingRows ?? []) {
            lines.push(formatLearnedBackboneBenchmarkReviewQueueRowLine(item));
        }
        lines.push(formatLearnedBackboneBenchmarkReviewPacksLine(learnedBackboneBenchmark));
        for (const item of learnedBackboneBenchmark.reviewPacks?.recentActivePacks ?? []) {
            lines.push(formatLearnedBackboneBenchmarkReviewPackRowLine(item));
        }
        for (const item of learnedBackboneBenchmark.reviewPackActions ?? []) {
            lines.push(formatLearnedBackboneBenchmarkReviewPackActionLine(item));
        }
        for (const item of learnedBackboneBenchmark.searchBudgetRows.slice(0, 5)) {
            lines.push(formatLearnedBackboneBenchmarkSearchBudgetLine(item));
        }
        lines.push(formatLearnedBackboneBenchmarkPromotionGateLine(learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkDisagreementLine(learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkRetryStabilityLine(learnedBackboneBenchmark));
        for (const item of learnedBackboneBenchmark.topFailureModes.slice(0, 3)) {
            lines.push(formatLearnedBackboneBenchmarkFailureModeLine(item));
        }
        for (const item of learnedBackboneBenchmark.topStopReasons.slice(0, 3)) {
            lines.push(formatLearnedBackboneBenchmarkStopReasonLine(item));
        }
        for (const item of learnedBackboneBenchmark.recentRunRows.slice(0, 3)) {
            lines.push(formatLearnedBackboneBenchmarkRecentRunLine(item));
        }
        const learnedBackboneBenchmarkRecommendation = buildLearnedBackboneBenchmarkRecommendation(learnedBackboneBenchmark);
        if (learnedBackboneBenchmarkRecommendation) {
            lines.push(`- advisory: ${learnedBackboneBenchmarkRecommendation}`);
        }
    }

    lines.push("", "## Shadow Reranker", "");
    if (!shadowReranker || (toNumber(shadowReranker.scoredManifestCount) ?? 0) <= 0) {
        lines.push("- none");
    } else {
        lines.push(formatShadowRerankerLine(shadowReranker));
        if (shadowReranker.runtimeWindow && typeof shadowReranker.runtimeWindow === "object"
            && (toNumber(shadowReranker.runtimeWindow.sampledEntries) ?? 0) > 0) {
            lines.push(formatShadowRerankerRuntimeWindowLine(shadowReranker.runtimeWindow));
        }
        if (shadowReranker.promotionOutcomes && typeof shadowReranker.promotionOutcomes === "object"
            && (toNumber(shadowReranker.promotionOutcomes.scoredManifestCount) ?? 0) > 0) {
            lines.push(formatShadowRerankerOutcomesLine(shadowReranker.promotionOutcomes));
        }
        if (shadowReranker.promotionAdvantage && typeof shadowReranker.promotionAdvantage === "object") {
            lines.push(formatShadowRerankerPromotionAdvantageLine(shadowReranker.promotionAdvantage));
        }
        if (shadowReranker.retryLocalizationOutcomes && typeof shadowReranker.retryLocalizationOutcomes === "object"
            && (toNumber(shadowReranker.retryLocalizationOutcomes.retryingManifestCount) ?? 0) > 0) {
            lines.push(formatShadowRerankerRetryLocalizationLine(shadowReranker.retryLocalizationOutcomes));
        }
        const shadowRerankerRecommendation = buildShadowRerankerRecommendation(shadowReranker);
        if (shadowRerankerRecommendation) {
            lines.push(`- advisory: ${shadowRerankerRecommendation}`);
        }
    }

    lines.push("", "## Orchestration Trends", "");
    if (orchestrationTrends.length === 0) {
        lines.push("- none");
    } else {
        for (const item of orchestrationTrends) {
            lines.push(formatOrchestrationTrendLine(item));
        }
    }

    lines.push(
        "",
        "## Incident Draft",
        "",
        `- present: ${pickup.incidentDraft?.present === true ? "yes" : "no"}`,
        `- incidentId: ${toTrimmed(pickup.incidentDraft?.incidentId)}`,
        `- state: ${toTrimmed(pickup.incidentDraft?.state)}`,
        `- severity: ${toTrimmed(pickup.incidentDraft?.severity)}`,
        `- severityScore: ${toNumber(pickup.incidentDraft?.severityScore) ?? 0}`,
        `- scope: ${toTrimmed(pickup.incidentDraft?.scope)}`,
        `- escalationRequired: ${pickup.incidentDraft?.escalation?.required === true ? "yes" : "no"}`,
        `- escalationOwnerRole: ${toTrimmed(pickup.incidentDraft?.escalation?.ownerRole)}`,
        `- commsEta: ${toTrimmed(pickup.incidentDraft?.comms?.eta)}`,
        "",
        "## Escalation",
        "",
        `- cadenceMinutes: ${toNumber(pickup.incidentDraft?.escalation?.cadenceMinutes) ?? 0}`,
        `- nextUpdateBy: ${toTrimmed(pickup.incidentDraft?.escalation?.nextUpdateBy)}`,
        `- channels: ${Array.isArray(pickup.incidentDraft?.escalation?.channels) && pickup.incidentDraft.escalation.channels.length > 0 ? pickup.incidentDraft.escalation.channels.join(", ") : "none"}`,
        `- triggers: ${Array.isArray(pickup.incidentDraft?.escalation?.triggers) && pickup.incidentDraft.escalation.triggers.length > 0 ? pickup.incidentDraft.escalation.triggers.join(", ") : "none"}`,
        "",
        "## Comms Draft",
        "",
        `- currentStatus: ${toTrimmed(pickup.incidentDraft?.comms?.currentStatus)}`,
        `- userImpact: ${toTrimmed(pickup.incidentDraft?.comms?.userImpact)}`,
        `- changeSummary: ${toTrimmed(pickup.incidentDraft?.comms?.changeSummary)}`,
        `- nextAction: ${toTrimmed(pickup.incidentDraft?.comms?.nextAction)}`,
        `- initialAcknowledgement: ${toTrimmed(pickup.incidentDraft?.comms?.initialAcknowledgement)}`,
        `- mitigationInProgress: ${toTrimmed(pickup.incidentDraft?.comms?.mitigationInProgress)}`,
        "",
        "## Evidence",
        "",
        `- projectionObservedAt: ${toTrimmed(pickup.evidence?.projectionObservedAt)}`,
        `- sweepObservedAt: ${toTrimmed(pickup.evidence?.sweepObservedAt)}`,
        `- projectionStale: ${pickup.evidence?.projectionStale === true ? "yes" : "no"}`,
        `- projectionOk: ${pickup.evidence?.projectionOk === true ? "yes" : "no"}`,
        `- sweepOk: ${pickup.evidence?.sweepOk === true ? "yes" : "no"}`,
        "",
        "## Recommendations",
        "",
    );

    if (!Array.isArray(pickup.recommendations) || pickup.recommendations.length === 0) {
        lines.push("- none");
    } else {
        for (const item of pickup.recommendations) {
            lines.push(`- ${toTrimmed(item)}`);
        }
    }

    lines.push("", "## Source Artifacts", "");
    for (const item of pickup.evidence?.sourceArtifacts || []) {
        lines.push(`- ${toTrimmed(item)}`);
    }

    return lines.join("\n") + "\n";
}

async function main() {
    const projectionDir = resolveProjectionDir();
    const sweepDir = resolveSweepDir();
    const pickupDir = resolvePickupDir();

    try {
        const projectionJsonPath = path.join(projectionDir, "latest.json");
        const projectionMarkdownPath = path.join(projectionDir, "latest.md");
        const sweepJsonPath = path.join(sweepDir, "latest.json");
        const sweepMarkdownPath = path.join(sweepDir, "latest.md");
        const incidentJsonPath = path.join(sweepDir, "incident-drafts", "latest.json");
        const incidentMarkdownPath = path.join(sweepDir, "incident-drafts", "latest.md");

        const summary = readJsonFile(projectionJsonPath, "Operator projection");
        const sweep = readJsonFile(sweepJsonPath, "Operator sweep");
        const incidentDraft = readJsonFile(incidentJsonPath, "Incident draft", false);

        const pickup = buildPickupPayload(summary, sweep, incidentDraft, {
            projectionDir,
            projectionJsonPath,
            projectionMarkdownPath,
            sweepDir,
            sweepJsonPath,
            sweepMarkdownPath,
            pickupDir,
            incidentJsonPath,
            incidentMarkdownPath,
        });

        const dayKey = dayKeyFromObservedAt(pickup.observedAt);
        const latestJsonPath = path.join(pickupDir, "latest.json");
        const latestMarkdownPath = path.join(pickupDir, "latest.md");
        const latestErrorPath = path.join(pickupDir, "latest-error.json");
        const historyPath = path.join(pickupDir, "history", `${dayKey}.jsonl`);

        writeAtomic(latestJsonPath, JSON.stringify(pickup, null, 2) + "\n");
        writeAtomic(latestMarkdownPath, buildMarkdown(pickup));
        deleteFileIfExists(latestErrorPath);
        ensureDir(path.dirname(historyPath));
        fs.appendFileSync(historyPath, JSON.stringify(pickup) + "\n", "utf-8");

        console.log(JSON.stringify({
            ok: true,
            observedAt: pickup.observedAt,
            pickupDir,
            summary: pickup.summary,
            artifacts: [latestJsonPath, latestMarkdownPath, historyPath],
        }, null, 2));
    } catch (error) {
        const payload = {
            ok: false,
            observedAt: new Date().toISOString(),
            pickupDir,
            message: error instanceof Error ? error.message : String(error),
            details: error && typeof error === "object" && "details" in error
                ? error.details
                : undefined,
        };
        const failureArtifacts = writeFailureArtifacts(pickupDir, payload);
        console.error(JSON.stringify({
            ...payload,
            artifacts: [failureArtifacts.latestErrorPath, failureArtifacts.errorHistoryPath],
        }, null, 2));
        process.exit(1);
    }
}

main().catch((error) => {
    fail("AXIOM operator pickup projection crashed", {
        error: error instanceof Error ? error.message : String(error),
    });
});