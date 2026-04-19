import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

function formatOrchestrationFamilyLabel(value) {
    const family = toTrimmed(value, "unknown");
    return family === "string_trio" ? "trio" : family;
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

function normalizeLearnedBackboneBenchmarkReviewQueueRow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    return {
        songId: toTrimmed(value.songId),
        benchmarkId: toTrimmed(value.benchmarkId, "") || null,
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

function buildLearnedBackboneBenchmarkReviewPackActions(reviewQueue, reviewPacks, searchBudgetRows) {
    if ((toNumber(reviewPacks?.activePackCount) ?? 0) > 0) {
        return [];
    }

    if (!reviewQueue || typeof reviewQueue !== "object") {
        return [];
    }

    const pendingBlind = toNumber(reviewQueue.pendingBlindReviewCount) ?? 0;
    const pendingShortlist = toNumber(reviewQueue.pendingShortlistReviewCount) ?? 0;
    const pendingPairwise = Math.max(0, pendingBlind - pendingShortlist);
    const actions = [];

    if (pendingShortlist > 0) {
        actions.push({
            reviewTarget: "shortlist",
            searchBudget: null,
            pendingOnly: true,
            pendingPairCount: pendingShortlist,
            priority: "first",
            command: buildLearnedBackboneReviewPackCommand("shortlist", true),
        });
    }

    if (pendingPairwise > 0) {
        actions.push({
            reviewTarget: "pairwise",
            searchBudget: null,
            pendingOnly: true,
            pendingPairCount: pendingPairwise,
            priority: pendingShortlist > 0 ? "after_shortlist" : "first",
            command: buildLearnedBackboneReviewPackCommand("pairwise", true),
        });
    }

    actions.push(...buildLearnedBackboneCustomReviewPackActions(reviewQueue, searchBudgetRows, actions.length));

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
        blockers: Array.isArray(value.blockers)
            ? value.blockers.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
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
        reviewQueue,
        reviewPacks,
        reviewPackActions: buildLearnedBackboneBenchmarkReviewPackActions(reviewQueue, reviewPacks, searchBudgetRows),
        reviewPackRecordActions: buildLearnedBackboneBenchmarkReviewPackRecordActions(reviewPacks),
        promotionGate: normalizeLearnedBackboneBenchmarkPromotionGate(value.promotionGate),
        reviewSampleStatus: normalizeLearnedBackboneBenchmarkReviewSampleStatus(value.reviewSampleStatus),
        disagreementSummary: normalizeLearnedBackboneBenchmarkDisagreementSummary(value.disagreementSummary),
        retryLocalizationStability: normalizeLearnedBackboneBenchmarkRetryLocalizationStability(value.retryLocalizationStability),
        selectionModeCounts: normalizeCountMap(value.selectionModeCounts),
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
        signal: toTrimmed(value.signal, "insufficient_data") || "insufficient_data",
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
        .filter((item) => typeof item === "number" && Number.isFinite(item));
    const positive = availableDeltas.some((item) => item > 0.0001);
    const negative = availableDeltas.some((item) => item < -0.0001);
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

function normalizeShadowRerankerRetryLocalization(value) {
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
        retryLocalizationOutcomes: normalizeShadowRerankerRetryLocalization(value.retryLocalizationOutcomes),
        runtimeWindow: normalizeShadowRerankerRuntimeWindow(value.runtimeWindow),
    };
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
    const family = formatOrchestrationFamilyLabel(item?.family);
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

    return `- lane=${toTrimmed(item?.lane)} | pack=${toTrimmed(item?.benchmarkPackVersion)} | runs=${toNumber(item?.runCount) ?? 0} | paired=${toNumber(item?.pairedRunCount) ?? 0} | reviewed=${toNumber(item?.reviewedRunCount) ?? 0} | pendingReview=${toNumber(item?.pendingReviewCount) ?? 0} | approvalRate=${formatOrchestrationMetric(toNumber(item?.approvalRate))} | avgAppeal=${formatOrchestrationMetric(toNumber(item?.averageAppealScore))}`;
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

function formatLearnedBackboneBenchmarkFailureModeLine(item) {
    return `- failureMode=${toTrimmed(item?.failureMode)} | count=${toNumber(item?.count) ?? 0}`;
}

function formatLearnedBackboneBenchmarkStopReasonLine(item) {
    return `- stopReason count=${toNumber(item?.count) ?? 0} | reason=${toTrimmed(item?.reason)}`;
}

function formatLearnedBackboneBenchmarkRecentRunLine(item) {
    const searchBudget = toTrimmed(item?.searchBudgetDescriptor) || toTrimmed(item?.searchBudgetLevel);
    return `- run song=${toTrimmed(item?.songId)} | benchmark=${toTrimmed(item?.benchmarkId)} | searchBudget=${searchBudget} | selectedWorker=${toTrimmed(item?.selectedWorker)} | approval=${toTrimmed(item?.approvalStatus)} | selectionMode=${toTrimmed(item?.selectionMode)} | disagreement=${item?.disagreementObserved === true ? "yes" : "no"} | promotion=${item?.promotionApplied === true ? "yes" : "no"} | retry=${toTrimmed(item?.retryLocalization)} | weakest=${toTrimmed(item?.reviewWeakestDimension)} | observedAt=${toTrimmed(item?.observedAt)}`;
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

function buildOrchestrationPressureRecommendation(value) {
    const trends = normalizeOrchestrationTrends(value);
    const pressured = trends.find((item) => (item.weakManifestCount ?? 0) > 0);
    if (!pressured) {
        return null;
    }

    return [
        `orchestration trend shows ${formatOrchestrationFamilyLabel(pressured.family)} ensemble pressure`,
        `(weakManifests=${toNumber(pressured.weakManifestCount) ?? 0}`,
        `avgWeakSections=${formatOrchestrationMetric(toNumber(pressured.averageWeakSectionCount))}`,
        `bal=${formatOrchestrationMetric(toNumber(pressured.averageRegisterBalanceFit))}`,
        `conv=${formatOrchestrationMetric(toNumber(pressured.averageEnsembleConversationFit))}`,
        ...(typeof toNumber(pressured.averageDoublingPressureFit) === "number"
            ? [`dbl=${formatOrchestrationMetric(toNumber(pressured.averageDoublingPressureFit))}`]
            : []),
        ...(typeof toNumber(pressured.averageTextureRotationFit) === "number"
            ? [`rot=${formatOrchestrationMetric(toNumber(pressured.averageTextureRotationFit))}`]
            : []),
        ...(typeof toNumber(pressured.averageSectionHandoffFit) === "number"
            ? [`hnd=${formatOrchestrationMetric(toNumber(pressured.averageSectionHandoffFit))})`]
            : [")"]),
        `inspect register balance, doubling, rotation, handoff, and ensemble conversation before treating timbre as the root issue`,
    ].join(" ");
}

function buildHarmonicColorPressureRecommendation(value) {
    const trend = normalizeHarmonicColorTrend(value);
    if (!trend || (trend.weakManifestCount ?? 0) <= 0) {
        return null;
    }

    return [
        "harmonic-color trend shows local color pressure",
        `(weakManifests=${toNumber(trend.weakManifestCount) ?? 0}`,
        `plan=${formatOrchestrationMetric(toNumber(trend.averagePlanFit))}`,
        `target=${formatOrchestrationMetric(toNumber(trend.averageTargetFit))}`,
        `tonic=${formatOrchestrationMetric(toNumber(trend.averageTonicizationPressureFit))}`,
        `prolong=${formatOrchestrationMetric(toNumber(trend.averageProlongationMotionFit))})`,
        "inspect tonicization pressure and local color survival before treating cadence or timbre as the root issue",
    ].join(" ");
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
        return "shadow reranker still shows high-confidence disagreement pressure; inspect learned-vs-heuristic mismatches before widening authority";
    }

    if ((shadowReranker.promotedSelectionCount ?? 0) > 0) {
        return "shadow reranker promotion is active on the narrow lane; inspect promoted-vs-heuristic evidence before broadening authority";
    }

    return null;
}

function formatShadowRerankerLine(item) {
    if (!item || typeof item !== "object") {
        return "- none";
    }

    return `- manifests=${toNumber(item?.manifestCount) ?? 0} | scored=${toNumber(item?.scoredManifestCount) ?? 0} | disagreements=${toNumber(item?.disagreementCount) ?? 0} | highConfidence=${toNumber(item?.highConfidenceDisagreementCount) ?? 0} | promotions=${toNumber(item?.promotedSelectionCount) ?? 0} | agreementRate=${formatOrchestrationMetric(toNumber(item?.agreementRate))} | avgConfidence=${formatOrchestrationMetric(toNumber(item?.averageLearnedConfidence))} | snapshot=${toTrimmed(item?.latestSnapshotId)} | lastSeen=${toTrimmed(item?.lastSeenAt)}`;
}

function formatShadowRerankerRuntimeWindowLine(item) {
    if (!item || typeof item !== "object") {
        return "- runtimeWindow=none";
    }

    return `- runtimeWindow=${toNumber(item?.windowHours) ?? 0}h | sampledRuns=${toNumber(item?.sampledEntries) ?? 0} | disagreements=${toNumber(item?.disagreementCount) ?? 0} | highConfidence=${toNumber(item?.highConfidenceDisagreementCount) ?? 0} | agreementRate=${formatOrchestrationMetric(toNumber(item?.agreementRate))} | avgConfidence=${formatOrchestrationMetric(toNumber(item?.averageConfidence))} | lastSeen=${toTrimmed(item?.lastSeenAt)}`;
}

function formatShadowRerankerOutcomesLine(item) {
    if (!item || typeof item !== "object") {
        return "- outcomes=none";
    }

    return `- outcomes lane=${toTrimmed(item?.lane)} | scored=${toNumber(item?.scoredManifestCount) ?? 0} | reviewed=${toNumber(item?.reviewedManifestCount) ?? 0} | pendingReview=${toNumber(item?.pendingReviewCount) ?? 0} | promoted=${toNumber(item?.promotedSelectionCount) ?? 0} | promotedReviewed=${toNumber(item?.promotedReviewedCount) ?? 0} | promotedApprovalRate=${formatOrchestrationMetric(toNumber(item?.promotedApprovalRate))} | heuristicReviewed=${toNumber(item?.heuristicReviewedCount) ?? 0} | heuristicApprovalRate=${formatOrchestrationMetric(toNumber(item?.heuristicApprovalRate))} | promotedAvgAppeal=${formatOrchestrationMetric(toNumber(item?.promotedAverageAppealScore))} | heuristicAvgAppeal=${formatOrchestrationMetric(toNumber(item?.heuristicAverageAppealScore))}`;
}

function formatShadowRerankerPromotionAdvantageLine(item) {
    if (!item || typeof item !== "object") {
        return "- promotionAdvantage=none";
    }

    return `- promotionAdvantage lane=${toTrimmed(item?.lane)} | reviewed=${toNumber(item?.reviewedManifestCount) ?? 0} | promotedReviewed=${toNumber(item?.promotedReviewedCount) ?? 0} | heuristicReviewed=${toNumber(item?.heuristicReviewedCount) ?? 0} | sufficientSample=${item?.sufficientReviewSample === true ? "yes" : "no"} | approvalDelta=${formatOrchestrationMetric(toNumber(item?.approvalRateDelta))} | appealDelta=${formatOrchestrationMetric(toNumber(item?.appealScoreDelta))} | signal=${toTrimmed(item?.signal)}`;
}

function formatShadowRerankerRetryLocalizationLine(item) {
    if (!item || typeof item !== "object") {
        return "- retryLocalization=none";
    }

    return `- retryLocalization lane=${toTrimmed(item?.lane)} | scored=${toNumber(item?.scoredManifestCount) ?? 0} | retrying=${toNumber(item?.retryingManifestCount) ?? 0} | promotedRetrying=${toNumber(item?.promotedRetryingCount) ?? 0} | promotedTargetedOnly=${toNumber(item?.promotedTargetedOnlyCount) ?? 0} | promotedMixed=${toNumber(item?.promotedMixedCount) ?? 0} | promotedGlobalOnly=${toNumber(item?.promotedGlobalOnlyCount) ?? 0} | promotedTargetedRate=${formatOrchestrationMetric(toNumber(item?.promotedSectionTargetedRate))} | heuristicRetrying=${toNumber(item?.heuristicRetryingCount) ?? 0} | heuristicTargetedOnly=${toNumber(item?.heuristicTargetedOnlyCount) ?? 0} | heuristicMixed=${toNumber(item?.heuristicMixedCount) ?? 0} | heuristicGlobalOnly=${toNumber(item?.heuristicGlobalOnlyCount) ?? 0} | heuristicTargetedRate=${formatOrchestrationMetric(toNumber(item?.heuristicSectionTargetedRate))}`;
}

function normalizeLatestOperatorAction(record) {
    return {
        present: record?.present === true,
        action: toTrimmed(record?.action, ""),
        surface: toTrimmed(record?.surface, ""),
        actor: toTrimmed(record?.actor, ""),
        approvedBy: toTrimmed(record?.approvedBy, ""),
        reason: toTrimmed(record?.reason, ""),
        rollbackNote: toTrimmed(record?.rollbackNote, ""),
        manualRecoveryNote: toTrimmed(record?.manualRecoveryNote, ""),
        observedAt: toTrimmed(record?.observedAt, ""),
        artifactLinks: Array.isArray(record?.artifactLinks)
            ? record.artifactLinks.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
    };
}

function latestOperatorActionLabel(action) {
    if (!action?.present) {
        return "none";
    }

    return [
        `action=${toTrimmed(action.action)}`,
        `surface=${toTrimmed(action.surface)}`,
        `actor=${toTrimmed(action.actor)}`,
    ].join(" ");
}

function resolveAppBaseUrl() {
    const explicit = readOption("url") || process.env.AXIOM_BASE_URL;
    if (explicit) {
        return explicit.replace(/\/+$/, "");
    }

    return "http://127.0.0.1:3100";
}

function resolveMcpBaseUrl(appBaseUrl) {
    const explicit = readOption("mcpUrl") || process.env.AXIOM_MCP_BASE_URL;
    if (explicit) {
        return explicit.replace(/\/+$/, "");
    }

    return appBaseUrl;
}

function resolveSweepDir() {
    const explicit = readOption("dir") || process.env.AXIOM_OPERATOR_SWEEP_DIR;
    if (explicit) {
        return explicit;
    }

    const outputDir = process.env.OUTPUT_DIR || "outputs";
    return path.join(outputDir, "_system", "operator-sweep");
}

function resolveProjectionDir() {
    const explicit = readOption("projectionDir") || process.env.AXIOM_OPERATOR_PROJECTION_DIR;
    if (explicit) {
        return explicit;
    }

    const outputDir = process.env.OUTPUT_DIR || "outputs";
    return path.join(outputDir, "_system", "operator-summary");
}

function resolveIncidentDir(sweepDir) {
    const explicit = readOption("incidentDir") || process.env.AXIOM_OPERATOR_INCIDENT_DIR;
    if (explicit) {
        return explicit;
    }

    return path.join(sweepDir, "incident-drafts");
}

function dayKeyFromObservedAt(value) {
    const parsed = Date.parse(String(value || "").trim());
    if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
}

function parseCliPayload(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return {
            ok: false,
            raw: trimmed,
        };
    }
}

async function runScript(scriptPath, args, env) {
    try {
        const result = await execFileAsync(process.execPath, [scriptPath, ...args], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                ...env,
            },
            maxBuffer: 1024 * 1024,
        });

        return {
            ok: true,
            payload: parseCliPayload(result.stdout),
            stdout: String(result.stdout || "").trim(),
            stderr: String(result.stderr || "").trim(),
        };
    } catch (error) {
        return {
            ok: false,
            payload: parseCliPayload(error.stderr || error.stdout),
            stdout: String(error.stdout || "").trim(),
            stderr: String(error.stderr || "").trim(),
            code: error.code,
        };
    }
}

function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function buildStaleLockDigest(summary) {
    const lockHealth = summary?.autonomy?.lockHealth || {};
    const reason = toTrimmed(lockHealth.reason, "unknown");
    const stale = lockHealth.stale === true || reason === "lock_timeout_without_active_job" || reason === "terminal_manifest_exists" || reason === "queue_run_mismatch";

    return {
        detected: stale,
        reason,
        activeRun: toTrimmed(summary?.autonomy?.activeRun?.runId),
        canAutoClear: lockHealth.canAutoClear === true,
        queueJobId: toTrimmed(lockHealth.queueJobId),
        lockAgeMs: toNumber(lockHealth.lockAgeMs) ?? null,
    };
}

function buildRepeatedWarningDigest(summary) {
    const warnings = Array.isArray(summary?.overseer?.repeatedWarnings)
        ? summary.overseer.repeatedWarnings.map((item) => ({
            warning: toTrimmed(item.warning),
            count: toNumber(item.count) ?? 0,
            lastSeenAt: toTrimmed(item.lastSeenAt),
        }))
        : [];

    return {
        count: toNumber(summary?.overseer?.activeRepeatedWarningCount) ?? warnings.length,
        topWarnings: warnings.slice(0, 3),
    };
}

function buildPendingApprovalDigest(summary) {
    const pendingApprovals = Array.isArray(summary?.autonomy?.pendingApprovals)
        ? summary.autonomy.pendingApprovals.map((item) => ({
            songId: toTrimmed(item.songId),
            runId: toTrimmed(item.runId),
            prompt: toTrimmed(item.prompt),
            form: toTrimmed(item.form),
            updatedAt: toTrimmed(item.updatedAt),
            qualityScore: toNumber(item.qualityScore) ?? null,
            approvalStatus: toTrimmed(item.approvalStatus, "pending"),
        }))
        : [];

    return {
        count: toNumber(summary?.autonomy?.pendingApprovalCount) ?? pendingApprovals.length,
        topPending: pendingApprovals.slice(0, 3),
    };
}

function buildBacklogDigest(summary) {
    const backlog = summary?.queue?.backlog || {};
    const topBacklog = Array.isArray(backlog.topJobs)
        ? backlog.topJobs.map((item) => ({
            jobId: toTrimmed(item.jobId),
            songId: toTrimmed(item.songId),
            status: toTrimmed(item.status),
            updatedAt: toTrimmed(item.updatedAt),
            nextAttemptAt: toTrimmed(item.nextAttemptAt),
            ageMs: toNumber(item.ageMs) ?? 0,
        }))
        : [];

    return {
        count: toNumber(backlog.count) ?? 0,
        retryScheduled: toNumber(backlog.retryScheduled) ?? 0,
        failedLike: toNumber(backlog.failedLike) ?? 0,
        oldestAgeMs: toNumber(backlog.oldestAgeMs) ?? 0,
        topBacklog: topBacklog.slice(0, 3),
    };
}

function severityRank(value) {
    switch (String(value || "none").trim()) {
        case "SEV-1":
            return 3;
        case "SEV-2":
            return 2;
        case "SEV-3":
            return 1;
        default:
            return 0;
    }
}

function severityWeightForReasonCode(code) {
    switch (String(code || "").trim()) {
        case "readiness_not_ready":
        case "queue_failed_pressure":
        case "stale_lock_detected":
        case "projection_failed":
            return 4;
        case "readiness_degraded":
        case "evidence_stale":
        case "queue_oldest_age_high":
        case "bridge_verify_failed":
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

function cloneSeverityDrivers(value, fallbackReasonCodes = []) {
    if (Array.isArray(value)) {
        return value
            .filter((item) => item && typeof item === "object" && !Array.isArray(item))
            .map((item) => ({
                code: toTrimmed(item.code),
                weight: toNumber(item.weight) ?? severityWeightForReasonCode(item.code),
                detail: toTrimmed(item.detail, item.code),
                source: toTrimmed(item.source, "projection"),
            }));
    }

    return fallbackReasonCodes
        .filter((item) => item !== "none")
        .map((item) => ({
            code: item,
            weight: severityWeightForReasonCode(item),
            detail: item,
            source: "projection",
        }));
}

function deriveSeverityScore(drivers) {
    return drivers.reduce((total, item) => total + (toNumber(item.weight) ?? 0), 0);
}

function addTriageSignal(triage, code, weight, detail, source = "sweep") {
    if (!triage.reasonCodes.includes(code)) {
        triage.reasonCodes.push(code);
    }
    triage.severityDrivers.push({
        code,
        weight,
        detail: toTrimmed(detail, code),
        source,
    });
    triage.severityScore = deriveSeverityScore(triage.severityDrivers);
}

function deriveSweepSeverity(triage) {
    const criticalCount = triage.severityDrivers.filter((item) => (toNumber(item.weight) ?? 0) >= 4).length;

    if (triage.state === "incident_candidate") {
        return criticalCount >= 2 || triage.severityScore >= 10
            ? "SEV-1"
            : higherSeverity(triage.severity, "SEV-2");
    }

    if (triage.state === "bridge_degraded" || triage.state === "runtime_degraded") {
        return higherSeverity(triage.severity, triage.severityScore >= 5 ? "SEV-2" : "SEV-3");
    }

    return triage.reasonCodes.length === 0 ? "none" : triage.severity;
}

function higherSeverity(left, right) {
    return severityRank(right) > severityRank(left) ? right : left;
}

function buildProjectionFallbackTriage(latest) {
    const triage = {
        state: "healthy",
        severity: "none",
        recommendedLane: "routine",
        reasonCodes: [],
        severityScore: 0,
        severityDrivers: [],
    };
    const readinessStatus = toTrimmed(latest?.readiness?.status, "unknown");
    const backlog = latest?.queue?.backlog && typeof latest.queue.backlog === "object"
        ? latest.queue.backlog
        : {};
    const pendingApprovalCount = toNumber(latest?.autonomy?.pendingApprovalCount) ?? 0;
    const lockReason = toTrimmed(latest?.autonomy?.lockHealth?.reason, "none");
    const repeatedWarningCount = toNumber(latest?.overseer?.activeRepeatedWarningCount) ?? 0;
    const overseerFailureCount = toNumber(latest?.overseer?.failureCount24h) ?? 0;
    let incidentCandidate = false;
    let degraded = false;

    if (readinessStatus === "not_ready") {
        addTriageSignal(triage, "readiness_not_ready", severityWeightForReasonCode("readiness_not_ready"), `status=${readinessStatus}`, "projection");
        incidentCandidate = true;
    } else if (readinessStatus === "ready_degraded") {
        addTriageSignal(triage, "readiness_degraded", severityWeightForReasonCode("readiness_degraded"), `status=${readinessStatus}`, "projection");
        degraded = true;
    }

    if (latest?.evidence?.stale === true) {
        addTriageSignal(triage, "evidence_stale", severityWeightForReasonCode("evidence_stale"), `reason=${toTrimmed(latest?.evidence?.staleReason)}`, "projection");
        degraded = true;
    }

    if ((toNumber(backlog.failedLike) ?? 0) > 0) {
        addTriageSignal(triage, "queue_failed_pressure", severityWeightForReasonCode("queue_failed_pressure"), `count=${toNumber(backlog.failedLike) ?? 0}`, "projection");
        incidentCandidate = true;
    }
    if ((toNumber(backlog.retryScheduled) ?? 0) > 0) {
        addTriageSignal(triage, "queue_retry_pressure", severityWeightForReasonCode("queue_retry_pressure"), `count=${toNumber(backlog.retryScheduled) ?? 0}`, "projection");
        degraded = true;
    }
    if ((toNumber(backlog.oldestAgeMs) ?? 0) >= 15 * 60 * 1000) {
        addTriageSignal(triage, "queue_oldest_age_high", severityWeightForReasonCode("queue_oldest_age_high"), `oldestAgeMs=${toNumber(backlog.oldestAgeMs) ?? 0}`, "projection");
        degraded = true;
    }

    if (pendingApprovalCount > 0) {
        addTriageSignal(triage, "pending_approval_backlog", severityWeightForReasonCode("pending_approval_backlog"), `count=${pendingApprovalCount}`, "projection");
        degraded = true;
    }

    if (latest?.autonomy?.lockHealth?.stale === true || ["lock_timeout_without_active_job", "terminal_manifest_exists", "queue_run_mismatch"].includes(lockReason)) {
        addTriageSignal(triage, "stale_lock_detected", severityWeightForReasonCode("stale_lock_detected"), `reason=${lockReason}`, "projection");
        incidentCandidate = true;
    }

    if (repeatedWarningCount > 0) {
        addTriageSignal(
            triage,
            "repeated_warning_active",
            severityWeightForReasonCode("repeated_warning_active") + (repeatedWarningCount >= 3 ? 1 : 0),
            `count=${repeatedWarningCount}`,
            "projection",
        );
        degraded = true;
    }
    if (overseerFailureCount > 0) {
        addTriageSignal(
            triage,
            "overseer_recent_failures",
            severityWeightForReasonCode("overseer_recent_failures") + (overseerFailureCount >= 3 ? 1 : 0),
            `count=${overseerFailureCount}`,
            "projection",
        );
        degraded = true;
    }

    if (incidentCandidate) {
        triage.state = "incident_candidate";
        triage.recommendedLane = "incident";
    } else if (degraded || triage.reasonCodes.length > 0) {
        triage.state = "runtime_degraded";
    }

    if (triage.reasonCodes.length === 0) {
        triage.reasonCodes = ["none"];
    }

    triage.severityScore = deriveSeverityScore(triage.severityDrivers);
    triage.severity = deriveSweepSeverity(triage);
    triage.summary = triage.state === "healthy"
        ? "healthy"
        : `${triage.state} ${triage.severity} score=${triage.severityScore}`.trim();
    return triage;
}

function buildSweepTriage(result) {
    const base = result.projection.latest?.triage && typeof result.projection.latest.triage === "object"
        ? {
            state: toTrimmed(result.projection.latest.triage.state, "healthy"),
            severity: toTrimmed(result.projection.latest.triage.severity, "none"),
            recommendedLane: toTrimmed(result.projection.latest.triage.recommendedLane, "routine"),
            reasonCodes: Array.isArray(result.projection.latest.triage.reasonCodes)
                ? result.projection.latest.triage.reasonCodes.map((item) => toTrimmed(item)).filter((item) => item !== "-")
                : [],
            severityScore: toNumber(result.projection.latest.triage.severityScore) ?? 0,
            severityDrivers: cloneSeverityDrivers(
                result.projection.latest.triage.severityDrivers,
                Array.isArray(result.projection.latest.triage.reasonCodes)
                    ? result.projection.latest.triage.reasonCodes.map((item) => toTrimmed(item)).filter((item) => item !== "-")
                    : [],
            ),
        }
        : buildProjectionFallbackTriage(result.projection.latest);

    const triage = {
        ...base,
        reasonCodes: [...base.reasonCodes],
        severityDrivers: [...base.severityDrivers],
        severityScore: base.severityScore || deriveSeverityScore(base.severityDrivers),
    };

    if (!result.projection.ok) {
        addTriageSignal(triage, "projection_failed", severityWeightForReasonCode("projection_failed"), `projectionDir=${result.projectionDir}`);
        triage.state = "runtime_degraded";
        triage.recommendedLane = "incident";
    }

    if (!result.bridge.ok) {
        addTriageSignal(triage, "bridge_verify_failed", severityWeightForReasonCode("bridge_verify_failed") + (result.projection.ok ? 0 : 2), `status=${toTrimmed(result.bridge.payload?.probeCallStatus)}`);
        triage.state = triage.state === "incident_candidate"
            ? triage.state
            : result.projection.ok
                ? "bridge_degraded"
                : "incident_candidate";
        triage.recommendedLane = "incident";
    }

    if (!result.bridge.ok && !result.projection.ok) {
        triage.state = "incident_candidate";
        triage.recommendedLane = "incident";
    }

    if (triage.reasonCodes.length === 0) {
        triage.reasonCodes = ["none"];
    }

    triage.severityScore = deriveSeverityScore(triage.severityDrivers);
    triage.severity = deriveSweepSeverity(triage);

    triage.summary = triage.state === "healthy"
        ? "healthy"
        : `${triage.state} ${triage.severity} score=${triage.severityScore}`.trim();
    return triage;
}

function shouldGenerateIncidentDraft(triage) {
    return triage?.recommendedLane === "incident";
}

function addMinutesToIso(value, minutes) {
    const parsed = Date.parse(String(value || "").trim());
    if (!Number.isFinite(parsed) || !Number.isFinite(minutes)) {
        return null;
    }

    return new Date(parsed + (minutes * 60 * 1000)).toISOString();
}

function buildIncidentEscalation(result, scope) {
    const severity = toTrimmed(result.triage.severity, "none");
    const cadenceMinutes = severity === "SEV-1"
        ? 15
        : severity === "SEV-2"
            ? 30
            : null;
    const channels = severity === "SEV-1"
        ? ["internal_ops", "executive_stakeholder", "public_user"]
        : severity === "SEV-2"
            ? ["internal_ops", "executive_stakeholder"]
            : ["internal_ops"];
    const triggers = [];

    if (severity === "SEV-1") {
        triggers.push("sev1_requires_immediate_escalation");
    }
    if (scope === "bridge_and_runtime") {
        triggers.push("multiple_platform_components_failed");
    }
    if (Array.isArray(result.triage.reasonCodes) && result.triage.reasonCodes.includes("readiness_not_ready")) {
        triggers.push("runtime_not_ready");
    }
    if (Array.isArray(result.triage.reasonCodes) && result.triage.reasonCodes.includes("queue_failed_pressure")) {
        triggers.push("queue_failure_pressure");
    }

    return {
        required: true,
        ownerRole: severity === "SEV-1" || severity === "SEV-2"
            ? "Incident Commander"
            : "Service Owner",
        cadenceMinutes,
        nextUpdateBy: cadenceMinutes === null
            ? null
            : addMinutesToIso(result.observedAt, cadenceMinutes),
        channels,
        requiredArtifacts: ["incident_record", "comms_broadcast"],
        triggers,
    };
}

function buildIncidentComms(result, scope, escalation) {
    const scopeSummary = scope === "bridge_and_runtime"
        ? "AXIOM runtime and bridge surfaces"
        : scope === "bridge"
            ? "AXIOM bridge surface"
            : "AXIOM runtime composition surfaces";
    const userImpact = scope === "bridge_and_runtime"
        ? "Operator visibility and runtime health are both degraded; shared automation should stay read-only until triage completes."
        : scope === "bridge"
            ? "Shared bridge visibility is degraded while local runtime evidence may still exist."
            : "Runtime readiness or queue health is degraded for composition operations.";
    const changeSummary = Array.isArray(result.triage.severityDrivers) && result.triage.severityDrivers.length > 0
        ? result.triage.severityDrivers
            .slice(0, 2)
            .map((item) => toTrimmed(item.detail, toTrimmed(item.code)))
            .join("; ")
        : toTrimmed(result.summary);
    const latestOperatorAction = result.latestOperatorAction;
    const operatorActionSummary = latestOperatorAction?.present
        ? `Recent operator action: ${toTrimmed(latestOperatorAction.action)} via ${toTrimmed(latestOperatorAction.surface)} by ${toTrimmed(latestOperatorAction.actor)}.`
        : null;
    const nextAction = latestOperatorAction?.present && latestOperatorAction.manualRecoveryNote !== "-"
        ? toTrimmed(latestOperatorAction.manualRecoveryNote)
        : Array.isArray(result.recommendations) && result.recommendations.length > 0
            ? toTrimmed(result.recommendations[0])
            : "Review AXIOM runtime evidence and follow the incident checklist before any mutation.";
    const cadenceLabel = escalation.cadenceMinutes === null
        ? "major changes"
        : `${escalation.cadenceMinutes} minutes`;

    return {
        currentStatus: "Investigating",
        userImpact,
        scopeSummary,
        changeSummary: operatorActionSummary
            ? `${changeSummary}; ${operatorActionSummary}`
            : changeSummary,
        nextAction,
        eta: cadenceLabel,
        initialAcknowledgement: [
            `We are investigating an issue affecting ${scopeSummary}.`,
            `Current impact: ${userImpact}`,
            `Scope: ${scopeSummary}.`,
            `Next update in ${cadenceLabel}.`,
        ].join(" "),
        mitigationInProgress: [
            "Mitigation is in progress.",
            `Current impact: ${userImpact}`,
            `Latest action: ${nextAction}`,
            ...(latestOperatorAction?.present && latestOperatorAction.rollbackNote !== "-"
                ? [`Rollback checkpoint: ${toTrimmed(latestOperatorAction.rollbackNote)}`]
                : []),
            "Validation status: in-progress.",
            `Next update in ${cadenceLabel}.`,
        ].join(" "),
    };
}

function buildIncidentDraft(result) {
    const dayKey = dayKeyFromObservedAt(result.observedAt);
    const scope = !result.bridge.ok && !result.projection.ok
        ? "bridge_and_runtime"
        : !result.bridge.ok
            ? "bridge"
            : "runtime";
    const escalation = buildIncidentEscalation(result, scope);

    return {
        incidentId: `axiom-${dayKey}-${result.triage.state.replace(/_/g, "-")}`,
        observedAt: result.observedAt,
        severity: result.triage.severity,
        severityScore: result.triage.severityScore,
        severityDrivers: result.triage.severityDrivers,
        state: result.triage.state,
        status: "Investigating",
        recommendedLane: result.triage.recommendedLane,
        scope,
        source: result.source,
        appBaseUrl: result.appBaseUrl,
        mcpBaseUrl: result.mcpBaseUrl,
        summary: result.summary,
        latestOperatorAction: result.latestOperatorAction,
        reasonCodes: result.triage.reasonCodes,
        phraseBreathTrend: normalizePhraseBreathTrend(result.projection.latest?.overseer?.phraseBreathTrend),
        harmonicColorTrend: normalizeHarmonicColorTrend(result.projection.latest?.overseer?.harmonicColorTrend),
        learnedBackboneBenchmark: normalizeLearnedBackboneBenchmark(result.projection.latest?.overseer?.learnedBackboneBenchmark),
        shadowReranker: normalizeShadowReranker(result.projection.latest?.overseer?.shadowReranker),
        orchestrationTrends: normalizeOrchestrationTrends(result.projection.latest?.overseer?.orchestrationTrends),
        recommendations: result.recommendations,
        escalation,
        comms: buildIncidentComms(result, scope, escalation),
        evidence: {
            sweepOk: result.ok,
            bridgeOk: result.bridge.ok,
            projectionOk: result.projection.ok,
            projectionEvidenceStale: result.projection.latest?.evidence?.stale === true,
            backlog: result.digest.backlog,
            pendingApprovals: result.digest.pendingApprovals,
            repeatedWarnings: result.digest.repeatedWarnings,
            staleLock: result.digest.staleLock,
        },
        artifacts: {
            projectionDir: result.projectionDir,
        },
    };
}

function buildIncidentMarkdown(draft) {
    const lines = [
        "# AXIOM Incident Draft",
        "",
        `- incidentId: ${draft.incidentId}`,
        `- observedAt: ${draft.observedAt}`,
        `- severity: ${draft.severity}`,
        `- severityScore: ${toNumber(draft.severityScore) ?? 0}`,
        `- state: ${draft.state}`,
        `- status: ${draft.status}`,
        `- recommendedLane: ${draft.recommendedLane}`,
        `- scope: ${draft.scope}`,
        `- source: ${draft.source}`,
        "",
        "## Summary",
        "",
        draft.summary,
        "",
        "## Reason Codes",
        "",
    ];

    if (draft.reasonCodes.length === 0) {
        lines.push("- none");
    } else {
        for (const item of draft.reasonCodes) {
            lines.push(`- ${item}`);
        }
    }

    lines.push("", "## Severity Drivers", "");
    if (!Array.isArray(draft.severityDrivers) || draft.severityDrivers.length === 0) {
        lines.push("- none");
    } else {
        for (const item of draft.severityDrivers) {
            lines.push(`- ${toTrimmed(item.code)} | weight=${toNumber(item.weight) ?? 0} | detail=${toTrimmed(item.detail)} | source=${toTrimmed(item.source)}`);
        }
    }

    lines.push("", "## Latest Operator Action", "");
    if (!draft.latestOperatorAction?.present) {
        lines.push("- none");
    } else {
        lines.push(`- action: ${toTrimmed(draft.latestOperatorAction.action)}`);
        lines.push(`- surface: ${toTrimmed(draft.latestOperatorAction.surface)}`);
        lines.push(`- actor: ${toTrimmed(draft.latestOperatorAction.actor)}`);
        lines.push(`- approvedBy: ${toTrimmed(draft.latestOperatorAction.approvedBy)}`);
        lines.push(`- observedAt: ${toTrimmed(draft.latestOperatorAction.observedAt)}`);
        lines.push(`- reason: ${toTrimmed(draft.latestOperatorAction.reason)}`);
        lines.push(`- rollbackNote: ${toTrimmed(draft.latestOperatorAction.rollbackNote)}`);
        lines.push(`- manualRecoveryNote: ${toTrimmed(draft.latestOperatorAction.manualRecoveryNote)}`);
    }

    lines.push("", "## Orchestration Trends", "");
    if (!Array.isArray(draft.orchestrationTrends) || draft.orchestrationTrends.length === 0) {
        lines.push("- none");
    } else {
        for (const item of draft.orchestrationTrends) {
            lines.push(formatOrchestrationTrendLine(item));
        }
    }

    lines.push("", "## Phrase-Breath Trend", "");
    if (!draft.phraseBreathTrend || typeof draft.phraseBreathTrend !== "object") {
        lines.push("- none");
    } else {
        lines.push(formatPhraseBreathTrendLine(draft.phraseBreathTrend));
    }

    lines.push("", "## Harmonic-Color Trend", "");
    if (!draft.harmonicColorTrend || typeof draft.harmonicColorTrend !== "object") {
        lines.push("- none");
    } else {
        lines.push(formatHarmonicColorTrendLine(draft.harmonicColorTrend));
    }

    lines.push("", "## Learned Backbone Benchmark", "");
    if (!draft.learnedBackboneBenchmark || typeof draft.learnedBackboneBenchmark !== "object"
        || (toNumber(draft.learnedBackboneBenchmark.runCount) ?? 0) <= 0) {
        lines.push("- none");
    } else {
        lines.push(formatLearnedBackboneBenchmarkLine(draft.learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkConfigLine(draft.learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkSampleStatusLine(draft.learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkPairedSelectionLine(draft.learnedBackboneBenchmark));
        for (const [worker, summary] of Object.entries(draft.learnedBackboneBenchmark.selectedWorkerOutcomes ?? {})
            .sort((left, right) => (toNumber(right[1]?.runCount) ?? 0) - (toNumber(left[1]?.runCount) ?? 0) || left[0].localeCompare(right[0]))) {
            lines.push(formatLearnedBackboneBenchmarkSelectedWorkerOutcomeLine(worker, summary));
        }
        for (const item of draft.learnedBackboneBenchmark.coverageRows ?? []) {
            lines.push(formatLearnedBackboneBenchmarkCoverageLine(item));
        }
        if (draft.learnedBackboneBenchmark.reviewQueue) {
            lines.push(formatLearnedBackboneBenchmarkReviewQueueLine(draft.learnedBackboneBenchmark));
            for (const item of draft.learnedBackboneBenchmark.reviewQueue.recentPendingRows ?? []) {
                lines.push(formatLearnedBackboneBenchmarkReviewQueueRowLine(item));
            }
        }
        lines.push(formatLearnedBackboneBenchmarkReviewPacksLine(draft.learnedBackboneBenchmark));
        for (const item of draft.learnedBackboneBenchmark.reviewPacks?.recentActivePacks ?? []) {
            lines.push(formatLearnedBackboneBenchmarkReviewPackRowLine(item));
        }
        for (const item of draft.learnedBackboneBenchmark.reviewPackActions ?? []) {
            lines.push(formatLearnedBackboneBenchmarkReviewPackActionLine(item));
        }
        lines.push(formatLearnedBackboneBenchmarkDisagreementLine(draft.learnedBackboneBenchmark));
        lines.push(formatLearnedBackboneBenchmarkRetryStabilityLine(draft.learnedBackboneBenchmark));
        for (const item of draft.learnedBackboneBenchmark.topFailureModes.slice(0, 3)) {
            lines.push(formatLearnedBackboneBenchmarkFailureModeLine(item));
        }
        for (const item of draft.learnedBackboneBenchmark.topStopReasons.slice(0, 3)) {
            lines.push(formatLearnedBackboneBenchmarkStopReasonLine(item));
        }
        for (const item of draft.learnedBackboneBenchmark.recentRunRows.slice(0, 3)) {
            lines.push(formatLearnedBackboneBenchmarkRecentRunLine(item));
        }
        const learnedBackboneBenchmarkRecommendation = buildLearnedBackboneBenchmarkRecommendation(draft.learnedBackboneBenchmark);
        if (learnedBackboneBenchmarkRecommendation) {
            lines.push(`- advisory: ${learnedBackboneBenchmarkRecommendation}`);
        }
    }

    lines.push("", "## Shadow Reranker", "");
    if (!draft.shadowReranker || typeof draft.shadowReranker !== "object") {
        lines.push("- none");
    } else {
        lines.push(formatShadowRerankerLine(draft.shadowReranker));
        if (draft.shadowReranker.runtimeWindow && typeof draft.shadowReranker.runtimeWindow === "object"
            && (toNumber(draft.shadowReranker.runtimeWindow.sampledEntries) ?? 0) > 0) {
            lines.push(formatShadowRerankerRuntimeWindowLine(draft.shadowReranker.runtimeWindow));
        }
        if (draft.shadowReranker.promotionOutcomes && typeof draft.shadowReranker.promotionOutcomes === "object"
            && (toNumber(draft.shadowReranker.promotionOutcomes.scoredManifestCount) ?? 0) > 0) {
            lines.push(formatShadowRerankerOutcomesLine(draft.shadowReranker.promotionOutcomes));
        }
        if (draft.shadowReranker.promotionAdvantage && typeof draft.shadowReranker.promotionAdvantage === "object") {
            lines.push(formatShadowRerankerPromotionAdvantageLine(draft.shadowReranker.promotionAdvantage));
        }
        if (draft.shadowReranker.retryLocalizationOutcomes && typeof draft.shadowReranker.retryLocalizationOutcomes === "object"
            && (toNumber(draft.shadowReranker.retryLocalizationOutcomes.retryingManifestCount) ?? 0) > 0) {
            lines.push(formatShadowRerankerRetryLocalizationLine(draft.shadowReranker.retryLocalizationOutcomes));
        }
        const shadowRerankerRecommendation = buildShadowRerankerRecommendation(draft.shadowReranker);
        if (shadowRerankerRecommendation) {
            lines.push(`- advisory: ${shadowRerankerRecommendation}`);
        }
    }

    lines.push("", "## Escalation", "");
    if (!draft.escalation || typeof draft.escalation !== "object") {
        lines.push("- none");
    } else {
        lines.push(`- required: ${draft.escalation.required === true ? "yes" : "no"}`);
        lines.push(`- ownerRole: ${toTrimmed(draft.escalation.ownerRole)}`);
        lines.push(`- cadenceMinutes: ${toNumber(draft.escalation.cadenceMinutes) ?? 0}`);
        lines.push(`- nextUpdateBy: ${toTrimmed(draft.escalation.nextUpdateBy)}`);
        lines.push(`- channels: ${Array.isArray(draft.escalation.channels) && draft.escalation.channels.length > 0 ? draft.escalation.channels.join(", ") : "none"}`);
        lines.push(`- requiredArtifacts: ${Array.isArray(draft.escalation.requiredArtifacts) && draft.escalation.requiredArtifacts.length > 0 ? draft.escalation.requiredArtifacts.join(", ") : "none"}`);
        lines.push(`- triggers: ${Array.isArray(draft.escalation.triggers) && draft.escalation.triggers.length > 0 ? draft.escalation.triggers.join(", ") : "none"}`);
    }

    lines.push(
        "",
        "## Evidence Snapshot",
        "",
        `- sweepOk: ${draft.evidence.sweepOk ? "yes" : "no"}`,
        `- bridgeOk: ${draft.evidence.bridgeOk ? "yes" : "no"}`,
        `- projectionOk: ${draft.evidence.projectionOk ? "yes" : "no"}`,
        `- projectionEvidenceStale: ${draft.evidence.projectionEvidenceStale ? "yes" : "no"}`,
        `- backlogCount: ${draft.evidence.backlog.count}`,
        `- pendingApprovalCount: ${draft.evidence.pendingApprovals.count}`,
        `- repeatedWarningCount: ${draft.evidence.repeatedWarnings.count}`,
        `- staleLockDetected: ${draft.evidence.staleLock.detected ? "yes" : "no"}`,
        "",
        "## Comms Draft",
        "",
    );

    if (!draft.comms || typeof draft.comms !== "object") {
        lines.push("- none");
    } else {
        lines.push(`- currentStatus: ${toTrimmed(draft.comms.currentStatus)}`);
        lines.push(`- userImpact: ${toTrimmed(draft.comms.userImpact)}`);
        lines.push(`- scopeSummary: ${toTrimmed(draft.comms.scopeSummary)}`);
        lines.push(`- changeSummary: ${toTrimmed(draft.comms.changeSummary)}`);
        lines.push(`- nextAction: ${toTrimmed(draft.comms.nextAction)}`);
        lines.push(`- eta: ${toTrimmed(draft.comms.eta)}`);
        lines.push(`- initialAcknowledgement: ${toTrimmed(draft.comms.initialAcknowledgement)}`);
        lines.push(`- mitigationInProgress: ${toTrimmed(draft.comms.mitigationInProgress)}`);
    }

    lines.push(
        "",
        "## Recommended Actions",
        "",
    );

    if (draft.recommendations.length === 0) {
        lines.push("- none");
    } else {
        for (const item of draft.recommendations) {
            lines.push(`- ${item}`);
        }
    }

    return lines.join("\n") + "\n";
}

function writeIncidentArtifacts(incidentDir, draft) {
    const dayKey = dayKeyFromObservedAt(draft.observedAt);
    const latestJsonPath = path.join(incidentDir, "latest.json");
    const latestMarkdownPath = path.join(incidentDir, "latest.md");
    const historyPath = path.join(incidentDir, "history", `${dayKey}.jsonl`);

    writeAtomic(latestJsonPath, JSON.stringify(draft, null, 2) + "\n");
    writeAtomic(latestMarkdownPath, buildIncidentMarkdown(draft));
    ensureDir(path.dirname(historyPath));
    fs.appendFileSync(historyPath, JSON.stringify(draft) + "\n", "utf-8");

    return {
        generated: true,
        latestJsonPath,
        latestMarkdownPath,
        historyPath,
    };
}

function clearLatestIncidentArtifacts(incidentDir) {
    const latestJsonPath = path.join(incidentDir, "latest.json");
    const latestMarkdownPath = path.join(incidentDir, "latest.md");
    deleteFileIfExists(latestJsonPath);
    deleteFileIfExists(latestMarkdownPath);
    return {
        generated: false,
        latestJsonPath,
        latestMarkdownPath,
    };
}

function buildRecommendations(result) {
    const recommendations = [];
    const orchestrationPressureRecommendation = buildOrchestrationPressureRecommendation(
        result.projection.latest?.overseer?.orchestrationTrends,
    );
    const harmonicColorPressureRecommendation = buildHarmonicColorPressureRecommendation(
        result.projection.latest?.overseer?.harmonicColorTrend,
    );
    const learnedBackboneBenchmarkRecommendation = buildLearnedBackboneBenchmarkRecommendation(
        result.projection.latest?.overseer?.learnedBackboneBenchmark,
    );
    const shadowRerankerRecommendation = buildShadowRerankerRecommendation(
        result.projection.latest?.overseer?.shadowReranker,
    );
    if (result.triage.state === "incident_candidate") {
        recommendations.push("incident candidate detected; follow the incident lane before making any runtime mutation outside approved operator flow");
    } else if (result.triage.state === "bridge_degraded") {
        recommendations.push("bridge is degraded while runtime evidence is still available; triage the bridge separately before treating this as runtime loss");
    }
    if (!result.bridge.ok) {
        recommendations.push("bridge verify failed; inspect AXIOM MCP HTTP reachability, token alignment, and /mcp catalog compatibility");
    }
    if (!result.projection.ok) {
        recommendations.push("operator projection failed; inspect outputs/_system/operator-summary/latest-error.json before any automation retry");
    }
    if (result.projection.latest?.evidence?.stale === true) {
        recommendations.push("projection evidence is stale; inspect endpoint skew and refresh the operator summary before treating the sweep as current truth");
    }
    if (result.digest.backlog.retryScheduled > 0 || result.digest.backlog.failedLike > 0) {
        recommendations.push("queue backlog shows retry or failure pressure; inspect top backlog jobs before treating repeated warnings as isolated noise");
    }
    if (result.digest.pendingApprovals.count > 0) {
        recommendations.push("pending approvals are active; review the approval queue before widening unattended scope or acting on downstream alerts");
    }
    if (result.digest.staleLock.detected) {
        recommendations.push("stale lock signal detected; review /autonomy/ops and only use reconcile-lock through approved operator flow");
    }
    if (result.digest.repeatedWarnings.count > 0) {
        recommendations.push("repeated warnings are active; review top warning keys before widening unattended scope");
    }
    if (orchestrationPressureRecommendation) {
        recommendations.push(orchestrationPressureRecommendation);
    }
    if (harmonicColorPressureRecommendation) {
        recommendations.push(harmonicColorPressureRecommendation);
    }
    if (learnedBackboneBenchmarkRecommendation) {
        recommendations.push(learnedBackboneBenchmarkRecommendation);
    }
    if (shadowRerankerRecommendation) {
        recommendations.push(shadowRerankerRecommendation);
    }
    if (result.latestOperatorAction?.present && result.latestOperatorAction.rollbackNote !== "-") {
        recommendations.push(`latest operator action rollback note: ${toTrimmed(result.latestOperatorAction.rollbackNote)}`);
    }
    if (result.latestOperatorAction?.present && result.latestOperatorAction.manualRecoveryNote !== "-") {
        recommendations.push(`latest operator action manual recovery note: ${toTrimmed(result.latestOperatorAction.manualRecoveryNote)}`);
    }
    if (recommendations.length === 0) {
        recommendations.push("no unattended blockers detected from bridge, projection, warning, or stale lock evidence");
    }
    return recommendations;
}

function buildMarkdown(result) {
    const phraseBreathTrend = normalizePhraseBreathTrend(result.projection.latest?.overseer?.phraseBreathTrend);
    const harmonicColorTrend = normalizeHarmonicColorTrend(result.projection.latest?.overseer?.harmonicColorTrend);
    const learnedBackboneBenchmark = normalizeLearnedBackboneBenchmark(result.projection.latest?.overseer?.learnedBackboneBenchmark);
    const orchestrationTrends = normalizeOrchestrationTrends(result.projection.latest?.overseer?.orchestrationTrends);
    const lines = [
        "# AXIOM Safe Unattended Sweep",
        "",
        `- observedAt: ${result.observedAt}`,
        `- source: ${result.source}`,
        `- appBaseUrl: ${result.appBaseUrl}`,
        `- mcpBaseUrl: ${result.mcpBaseUrl}`,
        `- ok: ${result.ok ? "yes" : "no"}`,
        "",
        "## Summary",
        "",
        result.summary,
        "",
        "## Triage",
        "",
        `- state: ${result.triage.state}`,
        `- severity: ${result.triage.severity}`,
        `- severityScore: ${toNumber(result.triage.severityScore) ?? 0}`,
        `- recommendedLane: ${result.triage.recommendedLane}`,
        `- reasonCodes: ${result.triage.reasonCodes.join(", ")}`,
        `- severityDrivers: ${Array.isArray(result.triage.severityDrivers) && result.triage.severityDrivers.length > 0 ? result.triage.severityDrivers.map((item) => `${toTrimmed(item.code)}(${toNumber(item.weight) ?? 0})`).join(", ") : "none"}`,
        "",
        "## Bridge Verify",
        "",
        `- ok: ${result.bridge.ok ? "yes" : "no"}`,
        `- toolCount: ${toNumber(result.bridge.payload?.toolCount) ?? 0}`,
        `- probeCallStatus: ${toTrimmed(result.bridge.payload?.probeCallStatus)}`,
        `- fallbackStatus: ${toTrimmed(result.bridge.payload?.fallbackStatus)}`,
        "",
        "## Projection",
        "",
        `- ok: ${result.projection.ok ? "yes" : "no"}`,
        `- projectionDir: ${result.projectionDir}`,
        `- summary: ${toTrimmed(result.projection.latest?.summary)}`,
        `- readiness: ${toTrimmed(result.projection.latest?.readiness?.status)}`,
        `- evidenceStale: ${result.projection.latest?.evidence?.stale === true ? "yes" : "no"}`,
        `- evidenceMaxSkewMs: ${toNumber(result.projection.latest?.evidence?.maxSkewMs) ?? 0}`,
        "",
        "## Latest Operator Action",
        "",
        `- present: ${result.latestOperatorAction?.present ? "yes" : "no"}`,
        `- action: ${toTrimmed(result.latestOperatorAction?.action)}`,
        `- surface: ${toTrimmed(result.latestOperatorAction?.surface)}`,
        `- actor: ${toTrimmed(result.latestOperatorAction?.actor)}`,
        `- rollbackNote: ${toTrimmed(result.latestOperatorAction?.rollbackNote)}`,
        `- manualRecoveryNote: ${toTrimmed(result.latestOperatorAction?.manualRecoveryNote)}`,
        "",
        "## Backlog Digest",
        "",
        `- count: ${result.digest.backlog.count}`,
        `- retryScheduled: ${result.digest.backlog.retryScheduled}`,
        `- failedLike: ${result.digest.backlog.failedLike}`,
        `- oldestAgeMs: ${result.digest.backlog.oldestAgeMs}`,
    ];

    if (result.digest.backlog.topBacklog.length === 0) {
        lines.push("- topBacklog: none");
    } else {
        for (const item of result.digest.backlog.topBacklog) {
            lines.push(`- ${item.jobId} | status=${item.status} | song=${item.songId} | ageMs=${item.ageMs} | updated=${item.updatedAt} | nextAttemptAt=${item.nextAttemptAt}`);
        }
    }

    lines.push(
        "",
        "## Pending Approval Digest",
        "",
        `- count: ${result.digest.pendingApprovals.count}`,
    );

    if (result.digest.pendingApprovals.topPending.length === 0) {
        lines.push("- topPending: none");
    } else {
        for (const item of result.digest.pendingApprovals.topPending) {
            lines.push(`- ${item.songId} | approval=${item.approvalStatus} | updated=${item.updatedAt} | form=${item.form} | prompt=${item.prompt}`);
        }
    }

    lines.push(
        "",
        "## Repeated Warning Digest",
        "",
        `- count: ${result.digest.repeatedWarnings.count}`,
    );

    if (result.digest.repeatedWarnings.topWarnings.length === 0) {
        lines.push("- topWarnings: none");
    } else {
        for (const warning of result.digest.repeatedWarnings.topWarnings) {
            lines.push(`- x${warning.count} | lastSeen=${warning.lastSeenAt} | ${warning.warning}`);
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
        lines.push(formatLearnedBackboneBenchmarkPairedSelectionLine(learnedBackboneBenchmark));
        for (const [worker, summary] of Object.entries(learnedBackboneBenchmark.selectedWorkerOutcomes ?? {})
            .sort((left, right) => (toNumber(right[1]?.runCount) ?? 0) - (toNumber(left[1]?.runCount) ?? 0) || left[0].localeCompare(right[0]))) {
            lines.push(formatLearnedBackboneBenchmarkSelectedWorkerOutcomeLine(worker, summary));
        }
        for (const item of learnedBackboneBenchmark.coverageRows ?? []) {
            lines.push(formatLearnedBackboneBenchmarkCoverageLine(item));
        }
        if (learnedBackboneBenchmark.reviewQueue) {
            lines.push(formatLearnedBackboneBenchmarkReviewQueueLine(learnedBackboneBenchmark));
            for (const item of learnedBackboneBenchmark.reviewQueue.recentPendingRows ?? []) {
                lines.push(formatLearnedBackboneBenchmarkReviewQueueRowLine(item));
            }
        }
        lines.push(formatLearnedBackboneBenchmarkReviewPacksLine(learnedBackboneBenchmark));
        for (const item of learnedBackboneBenchmark.reviewPacks?.recentActivePacks ?? []) {
            lines.push(formatLearnedBackboneBenchmarkReviewPackRowLine(item));
        }
        for (const item of learnedBackboneBenchmark.reviewPackActions ?? []) {
            lines.push(formatLearnedBackboneBenchmarkReviewPackActionLine(item));
        }
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
        "## Stale Lock Digest",
        "",
        `- detected: ${result.digest.staleLock.detected ? "yes" : "no"}`,
        `- reason: ${result.digest.staleLock.reason}`,
        `- activeRun: ${result.digest.staleLock.activeRun}`,
        `- canAutoClear: ${result.digest.staleLock.canAutoClear ? "yes" : "no"}`,
        `- queueJobId: ${result.digest.staleLock.queueJobId}`,
        "",
        "## Incident Draft",
        "",
        `- generated: ${result.incidentDraft.generated ? "yes" : "no"}`,
        `- latestJsonPath: ${toTrimmed(result.incidentDraft.latestJsonPath)}`,
        `- latestMarkdownPath: ${toTrimmed(result.incidentDraft.latestMarkdownPath)}`,
        "",
        "## Recommendations",
        "",
    );

    for (const item of result.recommendations) {
        lines.push(`- ${item}`);
    }

    return lines.join("\n") + "\n";
}

function writeFailureArtifacts(sweepDir, payload) {
    const dayKey = dayKeyFromObservedAt(payload.observedAt);
    const latestErrorPath = path.join(sweepDir, "latest-error.json");
    const errorHistoryPath = path.join(sweepDir, "errors", `${dayKey}.jsonl`);

    writeAtomic(latestErrorPath, JSON.stringify(payload, null, 2) + "\n");
    ensureDir(path.dirname(errorHistoryPath));
    fs.appendFileSync(errorHistoryPath, JSON.stringify(payload) + "\n", "utf-8");

    return {
        latestErrorPath,
        errorHistoryPath,
    };
}

async function main() {
    const appBaseUrl = resolveAppBaseUrl();
    const mcpBaseUrl = resolveMcpBaseUrl(appBaseUrl);
    const source = toTrimmed(readOption("source") || process.env.AXIOM_OPERATOR_SOURCE, "gcpCompute");
    const token = readOption("token") || process.env.AXIOM_OPERATOR_TOKEN || process.env.MCP_WORKER_AUTH_TOKEN || "";
    const jobLimit = toTrimmed(readOption("jobLimit") || process.env.AXIOM_OPERATOR_JOB_LIMIT, "5");
    const windowHours = toTrimmed(readOption("windowHours") || process.env.AXIOM_OPERATOR_WINDOW_HOURS, "24");
    const staleMs = toTrimmed(readOption("staleMs") || process.env.AXIOM_OPERATOR_EVIDENCE_STALE_MS, "15000");
    const namespace = toTrimmed(readOption("namespace") || process.env.AXIOM_NAMESPACE, "axiom");
    const sweepDir = resolveSweepDir();
    const projectionDir = resolveProjectionDir();
    const incidentDir = resolveIncidentDir(sweepDir);
    const observedAt = new Date().toISOString();

    const bridge = await runScript("scripts/verify-mcp-http-bridge.mjs", [
        "--url", mcpBaseUrl,
        "--token", token,
    ], {});

    const projection = await runScript("scripts/project-operator-summary.mjs", [
        "--url", appBaseUrl,
        "--source", source,
        "--jobLimit", jobLimit,
        "--windowHours", windowHours,
        "--staleMs", staleMs,
        "--namespace", namespace,
        "--dir", projectionDir,
        "--token", token,
    ], {});

    const projectionLatest = readJsonIfExists(path.join(projectionDir, "latest.json"));
    const projectionError = readJsonIfExists(path.join(projectionDir, "latest-error.json"));
    const digest = {
        backlog: buildBacklogDigest(projectionLatest),
        pendingApprovals: buildPendingApprovalDigest(projectionLatest),
        repeatedWarnings: buildRepeatedWarningDigest(projectionLatest),
        staleLock: buildStaleLockDigest(projectionLatest),
    };
    const latestOperatorAction = normalizeLatestOperatorAction(projectionLatest?.latestOperatorAction);

    const result = {
        ok: bridge.ok && projection.ok,
        observedAt,
        source,
        appBaseUrl,
        mcpBaseUrl,
        projectionDir,
        bridge: {
            ok: bridge.ok,
            payload: bridge.payload,
            stderr: bridge.stderr,
            stdout: bridge.stdout,
            code: bridge.code,
        },
        projection: {
            ok: projection.ok,
            payload: projection.payload,
            stderr: projection.stderr,
            stdout: projection.stdout,
            code: projection.code,
            latest: projectionLatest,
            latestError: projectionError,
        },
        digest,
        latestOperatorAction,
    };

    result.triage = buildSweepTriage(result);
    result.summary = [
        `bridge=${bridge.ok ? "ok" : "failed"}`,
        `projection=${projection.ok ? "ok" : "failed"}`,
        `evidenceStale=${projectionLatest?.evidence?.stale === true ? "yes" : "no"}`,
        `backlog=${digest.backlog.count}`,
        `pending=${digest.pendingApprovals.count}`,
        `warnings=${digest.repeatedWarnings.count}`,
        `latestAction=${latestOperatorActionLabel(latestOperatorAction)}`,
        `staleLock=${digest.staleLock.detected ? digest.staleLock.reason : "none"}`,
        `triage=${result.triage.state}`,
    ].join(" | ");
    result.recommendations = buildRecommendations(result);
    result.incidentDraft = shouldGenerateIncidentDraft(result.triage)
        ? writeIncidentArtifacts(incidentDir, buildIncidentDraft(result))
        : clearLatestIncidentArtifacts(incidentDir);

    const latestJsonPath = path.join(sweepDir, "latest.json");
    const latestMarkdownPath = path.join(sweepDir, "latest.md");
    const latestErrorPath = path.join(sweepDir, "latest-error.json");
    const historyPath = path.join(sweepDir, "history", `${dayKeyFromObservedAt(observedAt)}.jsonl`);

    writeAtomic(latestJsonPath, JSON.stringify(result, null, 2) + "\n");
    writeAtomic(latestMarkdownPath, buildMarkdown(result));
    ensureDir(path.dirname(historyPath));
    fs.appendFileSync(historyPath, JSON.stringify(result) + "\n", "utf-8");

    if (result.ok) {
        deleteFileIfExists(latestErrorPath);
        console.log(JSON.stringify({
            ok: true,
            observedAt,
            sweepDir,
            summary: result.summary,
            artifacts: [
                latestJsonPath,
                latestMarkdownPath,
                historyPath,
                ...(result.incidentDraft.generated
                    ? [result.incidentDraft.latestJsonPath, result.incidentDraft.latestMarkdownPath, result.incidentDraft.historyPath]
                    : []),
            ],
        }, null, 2));
        return;
    }

    const failureArtifacts = writeFailureArtifacts(sweepDir, result);
    console.error(JSON.stringify({
        ok: false,
        observedAt,
        sweepDir,
        summary: result.summary,
        artifacts: [
            latestJsonPath,
            latestMarkdownPath,
            historyPath,
            failureArtifacts.latestErrorPath,
            failureArtifacts.errorHistoryPath,
            ...(result.incidentDraft.generated
                ? [result.incidentDraft.latestJsonPath, result.incidentDraft.latestMarkdownPath, result.incidentDraft.historyPath]
                : []),
        ],
    }, null, 2));
    process.exit(1);
}

main().catch((error) => {
    fail("AXIOM safe unattended sweep crashed", {
        error: error instanceof Error ? error.message : String(error),
    });
});