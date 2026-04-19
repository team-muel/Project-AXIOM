import fs from "node:fs";
import path from "node:path";

const PROMOTION_MIN_REVIEWED = 4;
const PROMOTION_MIN_REVIEWED_PER_COHORT = 2;
const EARLY_SCREENING_MIN_REVIEWED_RUNS = 20;
const PROMOTION_RECOMMENDED_MIN_REVIEWED_RUNS = 30;
const PROMOTION_RECOMMENDED_MIN_DISAGREEMENT_RUNS = 10;
const PROMOTION_MIN_REVIEWED_SELECTED_IN_SHORTLIST_RATE = 0.6;
const DEFAULT_OUTPUT_DIR = process.env.OUTPUT_DIR || "outputs";
const DEFAULT_BENCHMARK_PACK_VERSION = "string_trio_symbolic_benchmark_pack_v1";
const DEFAULT_LANE = "string_trio_symbolic";
const REVIEWED_APPROVAL_STATUSES = new Set(["approved", "rejected"]);

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
    console.error(JSON.stringify({ ok: false, message, details }, null, 2));
    process.exit(1);
}

function toTrimmed(value, fallback = "") {
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

function toOutputRelativePath(outputDir, filePath) {
    const normalizedOutputDir = path.resolve(outputDir);
    const normalizedFilePath = path.resolve(filePath);
    const relative = path.relative(normalizedOutputDir, normalizedFilePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        return normalizedFilePath.split(path.sep).join("/");
    }

    return path.posix.join(path.basename(normalizedOutputDir), relative.split(path.sep).join("/"));
}

function roundMetric(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? Number(value.toFixed(4))
        : null;
}

function readJsonIfExists(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return null;
    }
}

function resolveJsonPath(filePath) {
    if (!filePath) {
        return undefined;
    }

    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
}

function incrementCount(record, key, increment = 1) {
    const token = toTrimmed(key, "unknown") || "unknown";
    record[token] = (record[token] ?? 0) + increment;
}

function uniqueSorted(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => toTrimmed(value))
        .filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}

function sortCountRows(record, labelKey, countKey = "count", limit = 5) {
    return Object.entries(record ?? {})
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([label, count]) => ({
            [labelKey]: label,
            [countKey]: count,
        }));
}

function average(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return null;
    }

    const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    if (numeric.length === 0) {
        return null;
    }

    return roundMetric(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
}

function ratio(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
        return null;
    }
    return roundMetric(numerator / denominator);
}

function learnedBackboneBlindReviewRoot(outputDir) {
    return path.join(outputDir, "_system", "ml", "review-packs", "learned-backbone");
}

function classifyRetryLocalization(directives) {
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
            ? directive.sectionIds.map((value) => toTrimmed(value)).filter(Boolean)
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

function classifySearchBudget(wholePieceCandidateCount, localizedRewriteBranchCount = 0) {
    if (Math.max(0, Math.floor(toNumber(localizedRewriteBranchCount) ?? 0)) > 0
        && Math.max(0, Math.floor(toNumber(wholePieceCandidateCount) ?? 0)) >= 4) {
        return "S4";
    }

    switch (Math.max(0, Math.floor(toNumber(wholePieceCandidateCount) ?? 0))) {
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

function describeSearchBudget(searchBudgetLevel, wholePieceCandidateCount, localizedRewriteBranchCount = 0) {
    const normalizedWholePieceCount = Math.max(0, Math.floor(toNumber(wholePieceCandidateCount) ?? 0));
    const normalizedBranchCount = Math.max(0, Math.floor(toNumber(localizedRewriteBranchCount) ?? 0));
    if (searchBudgetLevel !== "custom") {
        return searchBudgetLevel;
    }
    if (normalizedBranchCount > 0) {
        return `custom(${normalizedWholePieceCount}+${normalizedBranchCount})`;
    }
    return `custom(${normalizedWholePieceCount})`;
}

function classifySameAttemptSearchBudgetCounts(entries, manifests) {
    const wholePieceEntries = entries.filter((entry) => {
        const manifest = manifests.get(entry.candidateId);
        return (Array.isArray(manifest?.revisionDirectives) ? manifest.revisionDirectives.length : 0) === 0;
    });
    const localizedRewriteBranchCount = wholePieceEntries.length > 0
        ? entries.length - wholePieceEntries.length
        : 0;

    return {
        wholePieceCandidateCount: wholePieceEntries.length > 0 ? wholePieceEntries.length : entries.length,
        localizedRewriteBranchCount,
    };
}

function isReviewedStatus(approvalStatus) {
    return REVIEWED_APPROVAL_STATUSES.has(toTrimmed(approvalStatus).toLowerCase());
}

function approvalRate(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }

    const reviewed = rows.filter((row) => row.reviewed);
    if (reviewed.length === 0) {
        return null;
    }

    const approvedCount = reviewed.filter((row) => row.approvalStatus === "approved").length;
    return ratio(approvedCount, reviewed.length);
}

function buildWorkerOutcomeSummary(rows) {
    const result = {};
    const grouped = new Map();

    for (const row of rows) {
        const worker = toTrimmed(row.selectedWorker, "unknown") || "unknown";
        const bucket = grouped.get(worker) ?? [];
        bucket.push(row);
        grouped.set(worker, bucket);
    }

    for (const [worker, workerRows] of grouped.entries()) {
        const reviewedRows = workerRows.filter((row) => row.reviewed);
        const appealScores = reviewedRows
            .map((row) => row.appealScore)
            .filter((value) => typeof value === "number" && Number.isFinite(value));
        result[worker] = {
            runCount: workerRows.length,
            reviewedRunCount: reviewedRows.length,
            pendingReviewCount: workerRows.filter((row) => row.approvalStatus === "pending").length,
            approvedCount: reviewedRows.filter((row) => row.approvalStatus === "approved").length,
            rejectedCount: reviewedRows.filter((row) => row.approvalStatus === "rejected").length,
            approvalRate: approvalRate(workerRows),
            averageAppealScore: average(appealScores),
        };
    }

    return result;
}

function derivePromotionAdvantage(outcomes) {
    const approvalRateDelta = typeof outcomes.promotedApprovalRate === "number" && typeof outcomes.heuristicApprovalRate === "number"
        ? roundMetric(outcomes.promotedApprovalRate - outcomes.heuristicApprovalRate)
        : null;
    const appealScoreDelta = typeof outcomes.promotedAverageAppealScore === "number" && typeof outcomes.heuristicAverageAppealScore === "number"
        ? roundMetric(outcomes.promotedAverageAppealScore - outcomes.heuristicAverageAppealScore)
        : null;
    const sufficientReviewSample = outcomes.reviewedManifestCount >= PROMOTION_MIN_REVIEWED
        && outcomes.promotedReviewedCount >= PROMOTION_MIN_REVIEWED_PER_COHORT
        && outcomes.heuristicReviewedCount >= PROMOTION_MIN_REVIEWED_PER_COHORT;
    const availableDeltas = [approvalRateDelta, appealScoreDelta]
        .filter((value) => typeof value === "number" && Number.isFinite(value));
    const positive = availableDeltas.some((value) => value > 0.0001);
    const negative = availableDeltas.some((value) => value < -0.0001);

    return {
        lane: outcomes.lane,
        benchmarkPackVersion: outcomes.benchmarkPackVersion,
        reviewedManifestCount: outcomes.reviewedManifestCount,
        promotedReviewedCount: outcomes.promotedReviewedCount,
        heuristicReviewedCount: outcomes.heuristicReviewedCount,
        sufficientReviewSample,
        minimumReviewedManifestCount: PROMOTION_MIN_REVIEWED,
        minimumReviewedPerCohortCount: PROMOTION_MIN_REVIEWED_PER_COHORT,
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

function summarizeRetryLocalizationStability(rows) {
    const retryingRows = (Array.isArray(rows) ? rows : []).filter((row) => row.retryLocalization && row.retryLocalization !== "none");
    const sectionTargetedOnlyCount = retryingRows.filter((row) => row.retryLocalization === "section_targeted").length;
    const mixedCount = retryingRows.filter((row) => row.retryLocalization === "mixed").length;
    const globalOnlyCount = retryingRows.filter((row) => row.retryLocalization === "global").length;
    const sectionTargetedRate = ratio(sectionTargetedOnlyCount, retryingRows.length);
    const driftRate = ratio(mixedCount + globalOnlyCount, retryingRows.length);
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

function summarizeReviewSampleStatus(reviewedRunCount, reviewedDisagreementCount) {
    const meetsEarlyScreeningMinimum = reviewedRunCount >= EARLY_SCREENING_MIN_REVIEWED_RUNS;
    const meetsPromotionReviewedMinimum = reviewedRunCount >= PROMOTION_RECOMMENDED_MIN_REVIEWED_RUNS;
    const meetsPromotionDisagreementMinimum = reviewedDisagreementCount >= PROMOTION_RECOMMENDED_MIN_DISAGREEMENT_RUNS;
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
        minimumReviewedRunCountForScreening: EARLY_SCREENING_MIN_REVIEWED_RUNS,
        minimumReviewedRunCountForPromotion: PROMOTION_RECOMMENDED_MIN_REVIEWED_RUNS,
        minimumReviewedDisagreementCountForPromotion: PROMOTION_RECOMMENDED_MIN_DISAGREEMENT_RUNS,
        meetsEarlyScreeningMinimum,
        meetsPromotionReviewedMinimum,
        meetsPromotionDisagreementMinimum,
    };
}

function collectBlindReviewEvaluations(outputDir, benchmarkPackVersion, lane) {
    const rootDir = learnedBackboneBlindReviewRoot(outputDir);
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
    const evaluations = [];
    const reviewPackRows = [];

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const dirPath = path.join(rootDir, entry.name);
        const packFile = readJsonIfExists(path.join(dirPath, "pack.json"));
        const answerKey = readJsonIfExists(path.join(dirPath, "answer-key.json"));
        const resultsFile = readJsonIfExists(path.join(dirPath, "results.json"));
        const answerLane = toTrimmed(answerKey?.lane) || toTrimmed(resultsFile?.lane);
        const answerBenchmarkPackVersion = toTrimmed(answerKey?.benchmarkPackVersion) || toTrimmed(resultsFile?.benchmarkPackVersion);
        if (answerBenchmarkPackVersion && answerBenchmarkPackVersion !== benchmarkPackVersion) {
            continue;
        }
        if (lane && answerLane && answerLane !== lane) {
            continue;
        }

        const answerEntries = new Map();
        for (const item of Array.isArray(answerKey?.entries) ? answerKey.entries : []) {
            const entryId = toTrimmed(item?.entryId);
            const learnedLabel = toTrimmed(item?.learned?.label).toUpperCase();
            const baselineLabel = toTrimmed(item?.baseline?.label).toUpperCase();
            if (!entryId || !learnedLabel || !baselineLabel) {
                continue;
            }
            answerEntries.set(entryId, {
                entryId,
                songId: toTrimmed(item?.songId) || null,
                benchmarkId: toTrimmed(item?.benchmarkId) || null,
                planSignature: toTrimmed(item?.planSignature) || null,
                selectedWorker: toTrimmed(item?.selectedWorker) || null,
                selectionMode: toTrimmed(item?.selectionMode) || null,
                reviewTarget: (() => {
                    const reviewTarget = toTrimmed(item?.reviewTarget).toLowerCase();
                    return reviewTarget === "shortlist" || reviewTarget === "pairwise"
                        ? reviewTarget
                        : null;
                })(),
                selectedInShortlist: item?.selectedInShortlist === true,
                learnedLabel,
                baselineLabel,
            });
        }

        const resultByEntry = new Map();
        for (const item of Array.isArray(resultsFile?.results) ? resultsFile.results : []) {
            const entryId = toTrimmed(item?.entryId);
            const winnerLabel = toTrimmed(item?.winnerLabel).toUpperCase();
            const reviewedAt = toTrimmed(item?.reviewedAt) || null;
            if (!entryId || !winnerLabel) {
                continue;
            }
            resultByEntry.set(entryId, { winnerLabel, reviewedAt });
        }

        const entryCount = answerEntries.size > 0
            ? answerEntries.size
            : Math.max(0, Math.floor(toNumber(packFile?.entryCount) ?? 0));
        if (entryCount > 0) {
            const completedEntryIds = new Set([...resultByEntry.keys()]);
            const latestReviewedAt = [...resultByEntry.values()]
                .map((item) => item.reviewedAt)
                .filter(Boolean)
                .sort((left, right) => right.localeCompare(left))[0] ?? null;
            const reviewTarget = (() => {
                const normalized = toTrimmed(packFile?.sourceReviewQueue?.reviewTarget).toLowerCase();
                return normalized === "all" || normalized === "shortlist" || normalized === "pairwise"
                    ? normalized
                    : null;
            })();
            const searchBudget = toTrimmed(packFile?.sourceReviewQueue?.searchBudget) || null;
            const completedDecisionCount = Math.min(entryCount, completedEntryIds.size);
            const reviewSheetPath = path.join(dirPath, "review-sheet.csv");
            reviewPackRows.push({
                packId: toTrimmed(packFile?.packId) || entry.name,
                generatedAt: toTrimmed(packFile?.generatedAt) || null,
                reviewTarget,
                searchBudget,
                entryCount,
                completedDecisionCount,
                pendingDecisionCount: Math.max(0, entryCount - completedDecisionCount),
                pendingShortlistDecisionCount: [...answerEntries.values()]
                    .filter((item) => item.selectedInShortlist === true && !completedEntryIds.has(item.entryId))
                    .length,
                latestReviewedAt,
                reviewSheetPath: fs.existsSync(reviewSheetPath) ? toOutputRelativePath(outputDir, reviewSheetPath) : null,
            });
        }

        if (answerEntries.size === 0) {
            continue;
        }
        if (resultByEntry.size === 0) {
            continue;
        }

        matchedPackCount += 1;
        for (const [entryId, result] of resultByEntry.entries()) {
            const answer = answerEntries.get(entryId);
            if (!answer || result.winnerLabel === "SKIP") {
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
        reviewPacks: summarizeReviewPacks(reviewPackRows),
    };
}

function resolveBlindReviewSelectedSide(evaluation) {
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

function resolveBlindReviewWinnerSide(evaluation) {
    if (evaluation.winnerLabel === evaluation.learnedLabel) {
        return "learned";
    }
    if (evaluation.winnerLabel === evaluation.baselineLabel) {
        return "baseline";
    }
    return null;
}

function summarizeBlindPreferenceFromEvaluations(evaluations, matchedPackCount, unavailableReason) {
    let reviewedPairCount = 0;
    let decisivePairCount = 0;
    let learnedWinCount = 0;
    let baselineWinCount = 0;
    let tieCount = 0;
    let latestReviewedAt = null;

    for (const evaluation of evaluations) {
        if (evaluation.reviewedAt && (!latestReviewedAt || evaluation.reviewedAt.localeCompare(latestReviewedAt) > 0)) {
            latestReviewedAt = evaluation.reviewedAt;
        }
        if (evaluation.winnerLabel === "TIE") {
            reviewedPairCount += 1;
            tieCount += 1;
            continue;
        }

        const winnerSide = resolveBlindReviewWinnerSide(evaluation);
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
            winRate: ratio(learnedWinCount, decisivePairCount),
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

function buildBlindPreferenceUnavailableReason(evaluations) {
    return evaluations.length > 0
        ? "blind review results only contain ties or skipped entries so far"
        : "no completed blind review results found for learned backbone benchmark pairs";
}

function buildShortlistBlindPreferenceUnavailableReason(evaluations) {
    return evaluations.length > 0
        ? "shortlist-qualified blind review results only contain ties or skipped entries so far"
        : "no completed blind review results found for shortlist-qualified learned backbone benchmark pairs";
}

function summarizeBlindPreference(outputDir, benchmarkPackVersion, lane) {
    const { matchedPackCount, evaluations } = collectBlindReviewEvaluations(outputDir, benchmarkPackVersion, lane);
    return summarizeBlindPreferenceFromEvaluations(
        evaluations,
        matchedPackCount,
        matchedPackCount === 0
            ? "no learned backbone blind review packs found under outputs/_system/ml/review-packs/learned-backbone"
            : buildBlindPreferenceUnavailableReason(evaluations),
    );
}

function summarizeReviewedTop1AccuracyFromEvaluations(evaluations, matchedPackCount, unavailableReason) {
    let decisiveReviewedPairCount = 0;
    let correctSelectionCount = 0;
    let learnedSelectedReviewedPairCount = 0;
    let learnedCorrectSelectionCount = 0;
    let baselineSelectedReviewedPairCount = 0;
    let baselineCorrectSelectionCount = 0;
    let promotedReviewedPairCount = 0;
    let promotedCorrectSelectionCount = 0;
    let latestReviewedAt = null;

    for (const evaluation of evaluations) {
        if (evaluation.reviewedAt && (!latestReviewedAt || evaluation.reviewedAt.localeCompare(latestReviewedAt) > 0)) {
            latestReviewedAt = evaluation.reviewedAt;
        }

        const selectedSide = resolveBlindReviewSelectedSide(evaluation);
        const winnerSide = resolveBlindReviewWinnerSide(evaluation);
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
        selectedTop1Accuracy: ratio(correctSelectionCount, decisiveReviewedPairCount),
        learnedSelectedReviewedPairCount,
        learnedCorrectSelectionCount,
        learnedSelectedTop1Accuracy: ratio(learnedCorrectSelectionCount, learnedSelectedReviewedPairCount),
        baselineSelectedReviewedPairCount,
        baselineCorrectSelectionCount,
        baselineSelectedTop1Accuracy: ratio(baselineCorrectSelectionCount, baselineSelectedReviewedPairCount),
        promotedReviewedPairCount,
        promotedCorrectSelectionCount,
        promotedTop1Accuracy: ratio(promotedCorrectSelectionCount, promotedReviewedPairCount),
        latestReviewedAt,
        reason: `computed from ${decisiveReviewedPairCount} decisive blind pair reviews across ${matchedPackCount} pack(s)`,
    };
}

function summarizeReviewedTop1Accuracy(outputDir, benchmarkPackVersion, lane) {
    const { matchedPackCount, evaluations } = collectBlindReviewEvaluations(outputDir, benchmarkPackVersion, lane);
    return summarizeReviewedTop1AccuracyFromEvaluations(
        evaluations,
        matchedPackCount,
        matchedPackCount === 0
            ? "no learned backbone blind review packs found under outputs/_system/ml/review-packs/learned-backbone"
            : "blind review results only contain ties, skipped entries, or unmatched selection labels so reviewed top-1 accuracy is not yet available",
    );
}

function buildSearchBudgetRows(rows, evaluations, matchedPackCount) {
    const groups = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        const key = `${row.searchBudgetLevel}:${row.wholePieceCandidateCount}:${row.localizedRewriteBranchCount ?? 0}`;
        const bucket = groups.get(key) ?? [];
        bucket.push(row);
        groups.set(key, bucket);
    }

    return [...groups.values()]
        .map((groupRows) => {
            const songIds = new Set(groupRows.map((row) => row.songId));
            const budgetEvaluations = evaluations.filter((evaluation) => evaluation.songId && songIds.has(evaluation.songId));
            const blindPreference = summarizeBlindPreferenceFromEvaluations(
                budgetEvaluations,
                matchedPackCount,
                budgetEvaluations.length > 0
                    ? "blind review results only contain ties or skipped entries so far"
                    : "no completed blind review results found for this search budget bucket",
            );
            const reviewedTop1Accuracy = summarizeReviewedTop1AccuracyFromEvaluations(
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
                wholePieceCandidateCount: toNumber(groupRows[0]?.wholePieceCandidateCount) ?? 0,
                localizedRewriteBranchCount: toNumber(groupRows[0]?.localizedRewriteBranchCount) ?? 0,
                runCount: groupRows.length,
                pairedRunCount: groupRows.filter((row) => row.pairedRun).length,
                reviewedRunCount: reviewedRows.length,
                pendingReviewCount: groupRows.filter((row) => row.approvalStatus === "pending").length,
                approvalRate: approvalRate(groupRows),
                averageAppealScore: average(reviewedRows.map((row) => row.appealScore)),
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
        .sort((left, right) => left.wholePieceCandidateCount - right.wholePieceCandidateCount || left.localizedRewriteBranchCount - right.localizedRewriteBranchCount || left.searchBudgetLevel.localeCompare(right.searchBudgetLevel));
}

function summarizeReviewQueue(rows, evaluations) {
    const reviewedSongIds = new Set(
        evaluations
            .map((evaluation) => toTrimmed(evaluation.songId, ""))
            .filter((songId) => Boolean(songId)),
    );
    const pendingRows = (Array.isArray(rows) ? rows : []).filter((row) => row.pairedRun && !reviewedSongIds.has(row.songId));

    return {
        pendingBlindReviewCount: pendingRows.length,
        pendingShortlistReviewCount: pendingRows.filter((row) => row.selectedInShortlist).length,
        latestPendingAt: pendingRows.map((row) => row.observedAt).sort((left, right) => right.localeCompare(left))[0] ?? null,
        recentPendingRows: [...pendingRows]
            .sort(
                (left, right) => Number(right.selectedInShortlist) - Number(left.selectedInShortlist)
                    || right.observedAt.localeCompare(left.observedAt)
                    || left.songId.localeCompare(right.songId),
            )
            .slice(0, 10)
            .map((row) => ({
                songId: row.songId,
                benchmarkId: row.benchmarkId ?? null,
                planSignature: row.planSignature ?? null,
                reviewTarget: row.selectedInShortlist ? "shortlist" : "pairwise",
                selectedWorker: row.selectedWorker,
                counterfactualWorker: row.counterfactualWorker ?? null,
                selectionMode: row.selectionMode,
                observedAt: row.observedAt,
                wholePieceCandidateCount: row.wholePieceCandidateCount,
                localizedRewriteBranchCount: row.localizedRewriteBranchCount ?? 0,
                searchBudgetLevel: row.searchBudgetLevel,
                searchBudgetDescriptor: row.searchBudgetDescriptor ?? row.searchBudgetLevel,
                shortlistTopK: typeof row.shortlistTopK === "number" ? row.shortlistTopK : null,
                selectedRank: typeof row.selectedRank === "number" ? row.selectedRank : null,
                selectedInShortlist: row.selectedInShortlist === true,
            })),
    };
}

function summarizeReviewPacks(rows) {
    const activeRows = (Array.isArray(rows) ? rows : []).filter((row) => (toNumber(row?.pendingDecisionCount) ?? 0) > 0);

    return {
        matchedPackCount: Array.isArray(rows) ? rows.length : 0,
        activePackCount: activeRows.length,
        pendingDecisionCount: (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (toNumber(row?.pendingDecisionCount) ?? 0), 0),
        completedDecisionCount: (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (toNumber(row?.completedDecisionCount) ?? 0), 0),
        latestGeneratedAt: (Array.isArray(rows) ? rows : [])
            .map((row) => toTrimmed(row?.generatedAt) || null)
            .filter(Boolean)
            .sort((left, right) => right.localeCompare(left))[0] ?? null,
        latestReviewedAt: (Array.isArray(rows) ? rows : [])
            .map((row) => toTrimmed(row?.latestReviewedAt) || null)
            .filter(Boolean)
            .sort((left, right) => right.localeCompare(left))[0] ?? null,
        recentActivePacks: [...activeRows]
            .sort(
                (left, right) => (toNumber(right?.pendingDecisionCount) ?? 0) - (toNumber(left?.pendingDecisionCount) ?? 0)
                    || (toTrimmed(right?.generatedAt) || "").localeCompare(toTrimmed(left?.generatedAt) || "")
                    || toTrimmed(left?.packId).localeCompare(toTrimmed(right?.packId)),
            )
            .slice(0, 5),
    };
}

function summarizePromotionGate(rows, reviewSampleStatus, retryLocalizationStability, blindPreference, promotionAdvantage) {
    const reviewedRows = (Array.isArray(rows) ? rows : []).filter((row) => row.reviewed);
    const reviewedSelectedInShortlistRate = ratio(
        reviewedRows.filter((row) => row.selectedInShortlist).length,
        reviewedRows.length,
    );
    const reviewedSelectedTop1Rate = ratio(
        reviewedRows.filter((row) => row.selectedRank === 1).length,
        reviewedRows.length,
    );
    const meetsReviewedSelectedInShortlistMinimum = typeof reviewedSelectedInShortlistRate === "number"
        && reviewedSelectedInShortlistRate + 0.0001 >= PROMOTION_MIN_REVIEWED_SELECTED_IN_SHORTLIST_RATE;
    const positiveSignals = [];
    const negativeSignals = [];
    const blockers = [];

    if (typeof blindPreference?.winRate === "number") {
        if (blindPreference.winRate > 0.5001) {
            positiveSignals.push("blind_preference");
        } else if (blindPreference.winRate < 0.4999) {
            negativeSignals.push("blind_preference");
        }
    }

    if (typeof promotionAdvantage?.approvalRateDelta === "number") {
        if (promotionAdvantage.approvalRateDelta > 0.0001) {
            positiveSignals.push("approval_rate_delta");
        } else if (promotionAdvantage.approvalRateDelta < -0.0001) {
            negativeSignals.push("approval_rate_delta");
        }
    }

    if (typeof promotionAdvantage?.appealScoreDelta === "number") {
        if (promotionAdvantage.appealScoreDelta > 0.0001) {
            positiveSignals.push("appeal_score_delta");
        } else if (promotionAdvantage.appealScoreDelta < -0.0001) {
            negativeSignals.push("appeal_score_delta");
        }
    }

    const signal = positiveSignals.length > 0 && negativeSignals.length > 0
        ? "mixed"
        : positiveSignals.length > 0
            ? "positive"
            : negativeSignals.length > 0
                ? "negative"
                : "insufficient_evidence";

    if (reviewSampleStatus?.meetsPromotionReviewedMinimum !== true) {
        blockers.push("reviewed_runs_below_floor");
    }
    if (reviewSampleStatus?.meetsPromotionDisagreementMinimum !== true) {
        blockers.push("reviewed_disagreements_below_floor");
    }
    if (!meetsReviewedSelectedInShortlistMinimum) {
        blockers.push(
            typeof reviewedSelectedInShortlistRate === "number"
                ? "shortlist_quality_below_floor"
                : "shortlist_quality_unavailable",
        );
    }

    const retryLocalizationStable = retryLocalizationStability?.status !== "drifting";
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

    const sampleReady = reviewSampleStatus?.meetsPromotionReviewedMinimum === true
        && reviewSampleStatus?.meetsPromotionDisagreementMinimum === true;
    const status = !sampleReady
        ? "experimental"
        : !retryLocalizationStable || signal === "negative" || !meetsReviewedSelectedInShortlistMinimum
            ? "blocked"
            : signal === "positive"
                ? "ready_for_guarded_promotion"
                : "review_hold";

    const rationale = status === "experimental"
        ? `keep learned backbone experimental until at least ${reviewSampleStatus?.minimumReviewedRunCountForPromotion ?? 0} reviewed runs and ${reviewSampleStatus?.minimumReviewedDisagreementCountForPromotion ?? 0} reviewed disagreements accumulate`
        : status === "blocked"
            ? !retryLocalizationStable
                ? "review floor is met, but retry localization is drifting; keep promotion blocked until localized rewrite stability recovers"
                : !meetsReviewedSelectedInShortlistMinimum
                    ? typeof reviewedSelectedInShortlistRate === "number"
                        ? `review floor is met, but reviewed shortlist retention is ${reviewedSelectedInShortlistRate.toFixed(2)} and stays below the ${PROMOTION_MIN_REVIEWED_SELECTED_IN_SHORTLIST_RATE.toFixed(2)} floor; keep promotion blocked until selected winners stay inside the shortlist more reliably`
                        : "review floor is met, but reviewed shortlist quality is not available yet; keep promotion blocked until shortlist placement is observable on reviewed runs"
                    : "review floor is met, but current blind preference or reviewed deltas still favor baseline selection"
            : status === "ready_for_guarded_promotion"
                ? "review floor is met, reviewed shortlist quality clears the floor, retry localization is stable, and current blind preference or reviewed deltas support guarded promotion"
                : "review floor is met and reviewed shortlist quality is acceptable, but reviewed comparative signals are still mixed; hold promotion until the lane shows a cleaner winner";

    return {
        status,
        signal,
        minimumReviewedRunCount: reviewSampleStatus?.minimumReviewedRunCountForPromotion ?? 0,
        minimumReviewedDisagreementCount: reviewSampleStatus?.minimumReviewedDisagreementCountForPromotion ?? 0,
        minimumReviewedSelectedInShortlistRate: PROMOTION_MIN_REVIEWED_SELECTED_IN_SHORTLIST_RATE,
        meetsReviewedRunMinimum: reviewSampleStatus?.meetsPromotionReviewedMinimum === true,
        meetsReviewedDisagreementMinimum: reviewSampleStatus?.meetsPromotionDisagreementMinimum === true,
        meetsReviewedSelectedInShortlistMinimum,
        retryLocalizationStable,
        blindPreferenceAvailable: blindPreference?.available === true,
        blindPreferenceWinRate: typeof blindPreference?.winRate === "number" ? blindPreference.winRate : null,
        reviewedSelectedInShortlistRate,
        reviewedSelectedTop1Rate,
        approvalRateDelta: typeof promotionAdvantage?.approvalRateDelta === "number" ? promotionAdvantage.approvalRateDelta : null,
        appealScoreDelta: typeof promotionAdvantage?.appealScoreDelta === "number" ? promotionAdvantage.appealScoreDelta : null,
        positiveSignals,
        negativeSignals,
        blockers,
        rationale,
    };
}

function summarizeFailureModes(rows) {
    const counts = {};
    for (const row of (Array.isArray(rows) ? rows : []).filter((item) => item.reviewed && item.approvalStatus === "rejected")) {
        incrementCount(counts, row.reviewWeakestDimension || row.selectedGenerationMode || "review_rejected_unlabeled");
    }
    return sortCountRows(counts, "failureMode");
}

function summarizeStopReasons(rows) {
    const counts = {};
    for (const row of Array.isArray(rows) ? rows : []) {
        if (row.selectionStopReason) {
            incrementCount(counts, row.selectionStopReason);
        }
    }
    return sortCountRows(counts, "reason");
}

function matchesBenchmarkEvidence(proposalEvidence, benchmarkPackVersion, lane) {
    if (!proposalEvidence || typeof proposalEvidence !== "object") {
        return false;
    }

    if (benchmarkPackVersion && toTrimmed(proposalEvidence.benchmarkPackVersion) !== benchmarkPackVersion) {
        return false;
    }

    if (lane) {
        const evidenceLane = toTrimmed(proposalEvidence.lane);
        if (evidenceLane && evidenceLane !== lane) {
            return false;
        }
    }

    return Boolean(toTrimmed(proposalEvidence.planSignature) || toTrimmed(proposalEvidence.benchmarkId));
}

function resolveShortlistContext(entries, selectedCandidateId) {
    const rankedEntries = (Array.isArray(entries) ? entries : [])
        .map((entry) => {
            const learnedRank = toNumber(entry?.shadowReranker?.learnedRank);
            const heuristicRank = toNumber(entry?.shadowReranker?.heuristicRank);
            if (!Number.isFinite(learnedRank)) {
                return null;
            }

            return {
                candidateId: toTrimmed(entry?.candidateId),
                learnedRank,
                heuristicRank: Number.isFinite(heuristicRank) ? heuristicRank : null,
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.learnedRank - right.learnedRank || ((left.heuristicRank ?? Number.MAX_SAFE_INTEGER) - (right.heuristicRank ?? Number.MAX_SAFE_INTEGER)) || left.candidateId.localeCompare(right.candidateId));
    if (rankedEntries.length === 0) {
        return null;
    }

    const topK = Math.min(3, rankedEntries.length);
    const orderedCandidateIds = rankedEntries.map((entry) => entry.candidateId);
    const selectedRankIndex = toTrimmed(selectedCandidateId)
        ? orderedCandidateIds.findIndex((candidateId) => candidateId === toTrimmed(selectedCandidateId))
        : -1;

    return {
        topK,
        selectedRank: selectedRankIndex >= 0 ? selectedRankIndex + 1 : null,
        selectedInShortlist: selectedRankIndex >= 0 && selectedRankIndex < topK,
    };
}

function buildRunRow(songDir, manifest, candidateIndex, options) {
    const entries = Array.isArray(candidateIndex?.entries)
        ? candidateIndex.entries.filter((entry) => entry && typeof entry === "object")
        : [];
    const selectedEntry = entries.find((entry) => entry.selected) || entries.find((entry) => entry.candidateId === candidateIndex?.selectedCandidateId) || null;
    const benchmarkEntries = entries.filter((entry) => matchesBenchmarkEvidence(entry.proposalEvidence, options.benchmarkPackVersion, options.lane));
    const manifestProposalEvidence = manifest?.proposalEvidence;
    const manifestMatches = matchesBenchmarkEvidence(manifestProposalEvidence, options.benchmarkPackVersion, options.lane);
    const selectedMatches = matchesBenchmarkEvidence(selectedEntry?.proposalEvidence, options.benchmarkPackVersion, options.lane);

    if (!manifestMatches && benchmarkEntries.length === 0 && !selectedMatches) {
        return null;
    }

    const benchmarkEvidence = selectedMatches
        ? selectedEntry.proposalEvidence
        : benchmarkEntries[0]?.proposalEvidence || manifestProposalEvidence;
    const candidateManifestById = new Map(
        entries.map((entry) => [
            entry?.candidateId,
            entry?.manifestPath ? readJsonIfExists(resolveJsonPath(entry.manifestPath)) : null,
        ]),
    );
    const benchmarkCandidateManifests = benchmarkEntries
        .map((entry) => candidateManifestById.get(entry?.candidateId))
        .filter((entry) => entry && typeof entry === "object");
    const selectedCandidateManifest = selectedEntry?.candidateId
        ? candidateManifestById.get(selectedEntry.candidateId) || null
        : null;
    const selectedAttempt = [
        candidateIndex?.selectedAttempt,
        selectedEntry?.attempt,
        selectedCandidateManifest?.attempt,
        manifest?.qualityControl?.selectedAttempt,
    ].find((value) => typeof value === "number" && Number.isFinite(value)) ?? null;
    const selectedAttemptEntries = selectedAttempt === null
        ? entries
        : entries.filter((entry) => {
            const attempt = typeof entry?.attempt === "number" && Number.isFinite(entry.attempt)
                ? entry.attempt
                : typeof selectedCandidateManifest?.attempt === "number" && Number.isFinite(selectedCandidateManifest.attempt) && entry?.candidateId === selectedEntry?.candidateId
                    ? selectedCandidateManifest.attempt
                    : null;
            return attempt === selectedAttempt;
        });
    const activeAttemptEntries = selectedAttemptEntries.length > 0 ? selectedAttemptEntries : entries;
    const selectedCandidateRevisionDirectives = selectedCandidateManifest?.revisionDirectives;
    const retryLocalization = classifyRetryLocalization(selectedCandidateRevisionDirectives);
    const selectedWorker = toTrimmed(selectedEntry?.worker)
        || toTrimmed(selectedCandidateManifest?.worker)
        || toTrimmed(manifestProposalEvidence?.worker)
        || "unknown";
    const approvalStatus = toTrimmed(manifest?.approvalStatus, "not_reviewed");
    const reviewRubricVersion = toTrimmed(manifest?.reviewFeedback?.reviewRubricVersion)
        || toTrimmed(manifest?.reviewFeedback?.reviewRubric)
        || undefined;
    const appealScore = toNumber(manifest?.reviewFeedback?.appealScore);
    const observedAt = toTrimmed(selectedEntry?.evaluatedAt)
        || toTrimmed(selectedCandidateManifest?.evaluatedAt)
        || toTrimmed(manifest?.updatedAt)
        || toTrimmed(manifest?.meta?.updatedAt)
        || new Date(0).toISOString();
    const promptPackVersion = toTrimmed(benchmarkEvidence?.promptPackVersion) || undefined;
    const benchmarkId = toTrimmed(benchmarkEvidence?.benchmarkId) || undefined;
    const planSignature = toTrimmed(benchmarkEvidence?.planSignature) || undefined;
    const pairedWorkers = new Set(activeAttemptEntries.map((entry) => toTrimmed(entry.worker)).filter(Boolean));
    const pairedRun = pairedWorkers.has("learned_symbolic") && pairedWorkers.has("music21");
    const candidateWorkers = [...pairedWorkers].sort((left, right) => left.localeCompare(right));
    const benchmarkGenerationMode = toTrimmed(benchmarkEvidence?.generationMode) || undefined;
    const selectedGenerationMode = toTrimmed(selectedCandidateManifest?.proposalEvidence?.generationMode)
        || toTrimmed(selectedEntry?.proposalEvidence?.generationMode)
        || undefined;
    const disagreementObserved = entries.some((entry) => entry?.shadowReranker?.disagreesWithHeuristic === true)
        || benchmarkCandidateManifests.some((entry) => entry?.shadowReranker?.disagreesWithHeuristic === true)
        || selectedCandidateManifest?.shadowReranker?.disagreesWithHeuristic === true
        || Boolean(candidateIndex?.rerankerPromotion);
    const promotionApplied = Boolean(candidateIndex?.rerankerPromotion);
    const selectionStopReason = toTrimmed(candidateIndex?.selectionStopReason)
        || toTrimmed(manifest?.qualityControl?.stopReason)
        || undefined;
    const reviewWeakestDimension = toTrimmed(manifest?.reviewFeedback?.weakestDimension) || undefined;
    const counterfactualWorker = pairedRun
        ? candidateWorkers.find((worker) => worker !== selectedWorker) || undefined
        : undefined;
    const selectionMode = !pairedRun
        ? "single_worker"
        : selectedWorker === "learned_symbolic"
            ? (promotionApplied ? "promoted_learned" : "learned_selected")
            : "baseline_selected";
    const { wholePieceCandidateCount, localizedRewriteBranchCount } = classifySameAttemptSearchBudgetCounts(
        activeAttemptEntries,
        candidateManifestById,
    );
    const searchBudgetLevel = classifySearchBudget(wholePieceCandidateCount, localizedRewriteBranchCount);
    const searchBudgetDescriptor = describeSearchBudget(
        searchBudgetLevel,
        wholePieceCandidateCount,
        localizedRewriteBranchCount,
    );
    const shortlist = resolveShortlistContext(entries, candidateIndex?.selectedCandidateId || selectedEntry?.candidateId);

    return {
        songId: toTrimmed(manifest?.songId) || path.basename(songDir),
        benchmarkPackVersion: toTrimmed(benchmarkEvidence?.benchmarkPackVersion) || options.benchmarkPackVersion,
        benchmarkId,
        planSignature,
        lane: toTrimmed(benchmarkEvidence?.lane) || options.lane,
        promptPackVersion,
        reviewRubricVersion,
        workflow: toTrimmed(manifest?.meta?.workflow) || toTrimmed(selectedEntry?.workflow) || undefined,
        selectedWorker,
        approvalStatus,
        reviewed: isReviewedStatus(approvalStatus),
        appealScore,
        pairedRun,
        candidateWorkers,
        counterfactualWorker,
        retryLocalization,
        benchmarkGenerationMode,
        selectedGenerationMode,
        disagreementObserved,
        promotionApplied,
        selectionMode,
        selectionStopReason,
        reviewWeakestDimension,
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

function buildCoverageRows(rows) {
    const groups = new Map();

    for (const row of rows) {
        const key = toTrimmed(row.benchmarkId) || toTrimmed(row.planSignature) || "unknown";
        const bucket = groups.get(key) ?? [];
        bucket.push(row);
        groups.set(key, bucket);
    }

    return [...groups.entries()]
        .map(([key, groupRows]) => {
            const reviewedRows = groupRows.filter((row) => row.reviewed);
            const appealScores = reviewedRows
                .map((row) => row.appealScore)
                .filter((value) => typeof value === "number" && Number.isFinite(value));
            const selectedWorkerCounts = {};
            const generationModeCounts = {};

            for (const row of groupRows) {
                incrementCount(selectedWorkerCounts, row.selectedWorker);
                if (row.benchmarkGenerationMode) {
                    incrementCount(generationModeCounts, row.benchmarkGenerationMode);
                }
            }

            return {
                benchmarkKey: key,
                benchmarkId: groupRows[0].benchmarkId ?? null,
                planSignature: groupRows[0].planSignature ?? null,
                lane: groupRows[0].lane,
                benchmarkPackVersion: groupRows[0].benchmarkPackVersion,
                runCount: groupRows.length,
                pairedRunCount: groupRows.filter((row) => row.pairedRun).length,
                reviewedRunCount: reviewedRows.length,
                pendingReviewCount: groupRows.filter((row) => row.approvalStatus === "pending").length,
                approvalRate: approvalRate(groupRows),
                averageAppealScore: average(appealScores),
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

function summarizeRuns(rows, options) {
    const selectedWorkerCounts = {};
    const workflowCounts = {};
    const promptPackVersionCounts = {};
    const reviewRubricVersionCounts = {};
    const generationModeCounts = {};
    const selectionModeCounts = {};
    const searchBudgetCounts = {};
    const benchmarkIds = new Set();

    for (const row of rows) {
        incrementCount(selectedWorkerCounts, row.selectedWorker);
        if (row.workflow) {
            incrementCount(workflowCounts, row.workflow);
        }
        if (row.promptPackVersion) {
            incrementCount(promptPackVersionCounts, row.promptPackVersion);
        }
        if (row.reviewRubricVersion) {
            incrementCount(reviewRubricVersionCounts, row.reviewRubricVersion);
        }
        if (row.benchmarkGenerationMode) {
            incrementCount(generationModeCounts, row.benchmarkGenerationMode);
        }
        if (row.selectionMode) {
            incrementCount(selectionModeCounts, row.selectionMode);
        }
        if (row.searchBudgetLevel) {
            incrementCount(searchBudgetCounts, row.searchBudgetLevel);
        }
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
    const pairedSelectionOutcomes = {
        lane: options.lane,
        benchmarkPackVersion: options.benchmarkPackVersion,
        reviewedManifestCount: promotedReviewedRows.length + heuristicReviewedRows.length,
        promotedReviewedCount: promotedReviewedRows.length,
        promotedApprovalRate: approvalRate(promotedReviewedRows),
        promotedAverageAppealScore: average(promotedReviewedRows.map((row) => row.appealScore)),
        heuristicReviewedCount: heuristicReviewedRows.length,
        heuristicApprovalRate: approvalRate(heuristicReviewedRows),
        heuristicAverageAppealScore: average(heuristicReviewedRows.map((row) => row.appealScore)),
    };

    const retryingPromotedRows = promotedRows.filter((row) => row.retryLocalization !== "none");
    const retryingHeuristicRows = heuristicRows.filter((row) => row.retryLocalization !== "none");
    const retryLocalizationOutcomes = {
        lane: options.lane,
        benchmarkPackVersion: options.benchmarkPackVersion,
        scoredManifestCount: pairedRows.length,
        retryingManifestCount: retryingPromotedRows.length + retryingHeuristicRows.length,
        promotedRetryingCount: retryingPromotedRows.length,
        promotedTargetedOnlyCount: retryingPromotedRows.filter((row) => row.retryLocalization === "section_targeted").length,
        promotedMixedCount: retryingPromotedRows.filter((row) => row.retryLocalization === "mixed").length,
        promotedGlobalOnlyCount: retryingPromotedRows.filter((row) => row.retryLocalization === "global").length,
        promotedSectionTargetedRate: ratio(
            retryingPromotedRows.filter((row) => row.retryLocalization === "section_targeted").length,
            retryingPromotedRows.length,
        ),
        heuristicRetryingCount: retryingHeuristicRows.length,
        heuristicTargetedOnlyCount: retryingHeuristicRows.filter((row) => row.retryLocalization === "section_targeted").length,
        heuristicMixedCount: retryingHeuristicRows.filter((row) => row.retryLocalization === "mixed").length,
        heuristicGlobalOnlyCount: retryingHeuristicRows.filter((row) => row.retryLocalization === "global").length,
        heuristicSectionTargetedRate: ratio(
            retryingHeuristicRows.filter((row) => row.retryLocalization === "section_targeted").length,
            retryingHeuristicRows.length,
        ),
    };
    const retryLocalizationStability = summarizeRetryLocalizationStability(pairedRows);
    const reviewSampleStatus = summarizeReviewSampleStatus(reviewedRows.length, reviewedDisagreementRows.length);
    const blindReview = collectBlindReviewEvaluations(options.outputDir, options.benchmarkPackVersion, options.lane);
    const blindPreference = summarizeBlindPreferenceFromEvaluations(
        blindReview.evaluations,
        blindReview.matchedPackCount,
        blindReview.matchedPackCount === 0
            ? "no learned backbone blind review packs found under outputs/_system/ml/review-packs/learned-backbone"
            : buildBlindPreferenceUnavailableReason(blindReview.evaluations),
    );
    const shortlistedSongIds = new Set(rows.filter((row) => row.selectedInShortlist).map((row) => row.songId));
    const shortlistBlindPreferenceEvaluations = blindReview.evaluations.filter((evaluation) => evaluation.songId && shortlistedSongIds.has(evaluation.songId));
    const shortlistBlindPreference = summarizeBlindPreferenceFromEvaluations(
        shortlistBlindPreferenceEvaluations,
        blindReview.matchedPackCount,
        buildShortlistBlindPreferenceUnavailableReason(shortlistBlindPreferenceEvaluations),
    );
    const reviewedTop1Accuracy = summarizeReviewedTop1AccuracyFromEvaluations(
        blindReview.evaluations,
        blindReview.matchedPackCount,
        blindReview.matchedPackCount === 0
            ? "no learned backbone blind review packs found under outputs/_system/ml/review-packs/learned-backbone"
            : "blind review results only contain ties, skipped entries, or unmatched selection labels so reviewed top-1 accuracy is not yet available",
    );
    const disagreementSummary = {
        pairedRunCount: pairedRows.length,
        disagreementRunCount: disagreementRows.length,
        reviewedDisagreementCount: reviewedDisagreementRows.length,
        promotionAppliedCount: pairedRows.filter((row) => row.promotionApplied).length,
        learnedSelectedWithoutPromotionCount: pairedRows.filter((row) => row.selectionMode === "learned_selected").length,
        baselineSelectedCount: pairedRows.filter((row) => row.selectionMode === "baseline_selected").length,
    };
    const promotionGate = summarizePromotionGate(
        rows,
        reviewSampleStatus,
        retryLocalizationStability,
        blindPreference,
        derivePromotionAdvantage(pairedSelectionOutcomes),
    );
    const reviewQueue = summarizeReviewQueue(rows, blindReview.evaluations);
    const reviewPacks = blindReview.reviewPacks;
    const searchBudgetRows = buildSearchBudgetRows(rows, blindReview.evaluations, blindReview.matchedPackCount);

    return {
        ok: true,
        outputDir: options.outputDir,
        observedAt: new Date().toISOString(),
        lane: options.lane,
        benchmarkPackVersion: options.benchmarkPackVersion,
        configSnapshot: {
            lane: options.lane,
            benchmarkPackVersion: options.benchmarkPackVersion,
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
        approvalRate: approvalRate(rows),
        averageAppealScore: average(reviewedRows.map((row) => row.appealScore)),
        blindPreference,
        shortlistBlindPreference,
        reviewedTop1Accuracy,
        promotionGate,
        reviewSampleStatus,
        reviewQueue,
        reviewPacks,
        disagreementSummary,
        retryLocalizationStability,
        topFailureModes: summarizeFailureModes(rows),
        topStopReasons: summarizeStopReasons(rows),
        selectedWorkerCounts,
        selectedWorkerOutcomes: buildWorkerOutcomeSummary(rows),
        workflowCounts,
        promptPackVersionCounts,
        reviewRubricVersionCounts,
        generationModeCounts,
        selectionModeCounts,
        searchBudgetCounts,
        pairedSelectionOutcomes,
        promotionAdvantage: derivePromotionAdvantage(pairedSelectionOutcomes),
        retryLocalizationOutcomes,
        coverageRows: buildCoverageRows(rows),
        searchBudgetRows,
        recentRunRows: [...rows]
            .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.songId.localeCompare(right.songId))
            .slice(0, 20)
            .map((row) => ({
                songId: row.songId,
                benchmarkId: row.benchmarkId ?? null,
                planSignature: row.planSignature ?? null,
                selectedWorker: row.selectedWorker,
                approvalStatus: row.approvalStatus,
                reviewed: row.reviewed,
                appealScore: row.appealScore ?? null,
                disagreementObserved: row.disagreementObserved === true,
                promotionApplied: row.promotionApplied === true,
                selectionMode: row.selectionMode,
                counterfactualWorker: row.counterfactualWorker ?? null,
                retryLocalization: row.retryLocalization,
                benchmarkGenerationMode: row.benchmarkGenerationMode ?? null,
                selectedGenerationMode: row.selectedGenerationMode ?? null,
                selectionStopReason: row.selectionStopReason ?? null,
                reviewWeakestDimension: row.reviewWeakestDimension ?? null,
                observedAt: row.observedAt,
                wholePieceCandidateCount: row.wholePieceCandidateCount,
                localizedRewriteBranchCount: row.localizedRewriteBranchCount ?? 0,
                searchBudgetLevel: row.searchBudgetLevel,
                searchBudgetDescriptor: row.searchBudgetDescriptor ?? row.searchBudgetLevel,
            })),
    };
}

function main() {
    const outputDir = path.resolve(process.cwd(), readOption("outputDir") || DEFAULT_OUTPUT_DIR);
    const benchmarkPackVersion = toTrimmed(readOption("benchmarkPackVersion"), DEFAULT_BENCHMARK_PACK_VERSION) || DEFAULT_BENCHMARK_PACK_VERSION;
    const lane = toTrimmed(readOption("lane"), DEFAULT_LANE) || DEFAULT_LANE;

    if (!fs.existsSync(outputDir)) {
        fail("Output directory does not exist", { outputDir });
    }

    const songDirs = fs.readdirSync(outputDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "_system")
        .map((entry) => path.join(outputDir, entry.name));

    const rows = [];
    for (const songDir of songDirs) {
        const manifest = readJsonIfExists(path.join(songDir, "manifest.json"));
        if (!manifest || typeof manifest !== "object") {
            continue;
        }

        const candidateIndex = readJsonIfExists(path.join(songDir, "candidates", "index.json"));
        const row = buildRunRow(songDir, manifest, candidateIndex, {
            outputDir,
            benchmarkPackVersion,
            lane,
        });
        if (row) {
            rows.push(row);
        }
    }

    console.log(JSON.stringify(summarizeRuns(rows, {
        outputDir,
        benchmarkPackVersion,
        lane,
    }), null, 2));
}

main();