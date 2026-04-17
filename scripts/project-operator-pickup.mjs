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