import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

function resolveOutputDir() {
    const explicit = readOption("dir") || process.env.AXIOM_OPERATOR_PROJECTION_DIR;
    if (explicit) {
        return explicit;
    }

    const outputDir = process.env.OUTPUT_DIR || "outputs";
    return path.join(outputDir, "_system", "operator-summary");
}

function writeFailureArtifacts(projectionDir, payload) {
    const observedAt = toTrimmed(payload.observedAt, new Date().toISOString());
    const dayKey = dayKeyFromObservedAt(observedAt);
    const latestErrorPath = path.join(projectionDir, "latest-error.json");
    const errorHistoryPath = path.join(projectionDir, "errors", `${dayKey}.jsonl`);

    writeAtomic(latestErrorPath, JSON.stringify(payload, null, 2) + "\n");
    ensureDir(path.dirname(errorHistoryPath));
    fs.appendFileSync(errorHistoryPath, JSON.stringify(payload) + "\n", "utf-8");

    return {
        latestErrorPath,
        errorHistoryPath,
    };
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

function formatLongSpanLabel(longSpan) {
    if (!longSpan || typeof longSpan !== "object") {
        return "-";
    }

    const status = toTrimmed(longSpan.status, "");
    if (!status) {
        return "-";
    }

    const focus = toTrimmed(longSpan.weakestDimension, "") || toTrimmed(longSpan.repairFocus, "");
    const secondaryRepairFocuses = Array.isArray(longSpan.secondaryRepairFocuses)
        ? longSpan.secondaryRepairFocuses.map((value) => toTrimmed(value)).filter((value) => value !== "-")
        : [];
    const focusSuffix = focus
        ? `${focus}${secondaryRepairFocuses[0] ? `+${secondaryRepairFocuses[0]}` : ""}${secondaryRepairFocuses.length > 1 ? `+${secondaryRepairFocuses.length - 1}more` : ""}`
        : "";
    const label = focusSuffix ? `${status}:${focusSuffix}` : status;
    const repairMode = toTrimmed(longSpan.repairMode, "");
    const sectionTokens = (longSpan.sections ?? [])
        .map((section) => {
            const sectionId = toTrimmed(section?.sectionId, "");
            if (!sectionId) {
                return "";
            }
            if (repairMode === "paired_cross_section") {
                const pairedSectionId = toTrimmed(section?.structureSectionId, "");
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

function formatLongSpanSectionReference(sectionId, label, role) {
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

function buildLongSpanOperatorReason(longSpan) {
    if (!longSpan || typeof longSpan !== "object") {
        return null;
    }

    const sections = Array.isArray(longSpan.sections)
        ? longSpan.sections.filter((section) => Boolean(toTrimmed(section?.sectionId, "")))
        : [];
    const primarySection = sections[0] ?? null;
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

function formatLongSpanReason(longSpan) {
    const operatorReason = toTrimmed(longSpan?.operatorReason, "");
    if (operatorReason) {
        return operatorReason;
    }

    return buildLongSpanOperatorReason(longSpan) || "-";
}

function formatOrchestrationMetric(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? value.toFixed(2)
        : "?";
}

function formatOrchestrationLabel(orchestration) {
    if (!orchestration || typeof orchestration !== "object") {
        return "-";
    }

    const family = toTrimmed(orchestration.family, "unknown") === "string_trio"
        ? "trio"
        : toTrimmed(orchestration.family, "unknown");
    const weakSections = Array.isArray(orchestration.weakSectionIds) && orchestration.weakSectionIds.length > 0
        ? orchestration.weakSectionIds.map((item) => toTrimmed(item)).filter((item) => item !== "-").join(",")
        : "none";
    const doublingToken = typeof toNumber(orchestration.doublingPressureFit) === "number"
        ? `,dbl=${formatOrchestrationMetric(toNumber(orchestration.doublingPressureFit))}`
        : "";
    const rotationToken = typeof toNumber(orchestration.textureRotationFit) === "number"
        ? `,rot=${formatOrchestrationMetric(toNumber(orchestration.textureRotationFit))}`
        : "";
    const handoffToken = typeof toNumber(orchestration.sectionHandoffFit) === "number"
        ? `,hnd=${formatOrchestrationMetric(toNumber(orchestration.sectionHandoffFit))}`
        : "";

    return `${family}:rng=${formatOrchestrationMetric(orchestration.idiomaticRangeFit)},bal=${formatOrchestrationMetric(orchestration.registerBalanceFit)},conv=${formatOrchestrationMetric(orchestration.ensembleConversationFit)}${doublingToken}${rotationToken}${handoffToken},weak=${weakSections}`;
}

function formatOrchestrationTrendLine(item) {
    const family = toTrimmed(item?.family, "unknown") === "string_trio"
        ? "trio"
        : toTrimmed(item?.family, "unknown");
    const instruments = Array.isArray(item?.instrumentNames) && item.instrumentNames.length > 0
        ? item.instrumentNames.map((entry) => toTrimmed(entry)).filter((entry) => entry !== "-").join(" / ")
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

function formatShadowRerankerDisagreementLine(item) {
    return `- disagreement song=${toTrimmed(item?.songId)} | selected=${toTrimmed(item?.selectedCandidateId)} | learnedTop=${toTrimmed(item?.learnedTopCandidateId)} | confidence=${formatOrchestrationMetric(toNumber(item?.learnedConfidence))} | snapshot=${toTrimmed(item?.snapshotId)} | updated=${toTrimmed(item?.updatedAt)} | reason=${toTrimmed(item?.reason)}`;
}

function formatShadowRerankerPromotionLine(item) {
    return `- promotion song=${toTrimmed(item?.songId)} | lane=${toTrimmed(item?.lane)} | selected=${toTrimmed(item?.selectedCandidateId)} | heuristicCounterfactual=${toTrimmed(item?.heuristicCounterfactualCandidateId)} | confidence=${formatOrchestrationMetric(toNumber(item?.learnedConfidence))} | snapshot=${toTrimmed(item?.snapshotId)} | updated=${toTrimmed(item?.updatedAt)} | reason=${toTrimmed(item?.reason)}`;
}

function dayKeyFromObservedAt(value) {
    const parsed = Date.parse(String(value || "").trim());
    if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
}

function buildMarkdown(summary) {
    const warnings = Array.isArray(summary.overseer?.repeatedWarnings)
        ? summary.overseer.repeatedWarnings
        : [];
    const phraseBreathTrend = summary.overseer?.phraseBreathTrend && typeof summary.overseer.phraseBreathTrend === "object"
        ? summary.overseer.phraseBreathTrend
        : null;
    const harmonicColorTrend = summary.overseer?.harmonicColorTrend && typeof summary.overseer.harmonicColorTrend === "object"
        ? summary.overseer.harmonicColorTrend
        : null;
    const shadowReranker = summary.overseer?.shadowReranker && typeof summary.overseer.shadowReranker === "object"
        ? summary.overseer.shadowReranker
        : null;
    const orchestrationTrends = Array.isArray(summary.overseer?.orchestrationTrends)
        ? summary.overseer.orchestrationTrends
        : [];
    const pendingApprovals = Array.isArray(summary.autonomy?.pendingApprovals)
        ? summary.autonomy.pendingApprovals
        : [];
    const latestOperatorAction = summary.latestOperatorAction && typeof summary.latestOperatorAction === "object"
        ? summary.latestOperatorAction
        : null;
    const missing = Array.isArray(summary.evidence?.missing)
        ? summary.evidence.missing
        : [];

    const lines = [
        "# AXIOM Operator Summary",
        "",
        `- observedAt: ${toTrimmed(summary.observedAt)}`,
        `- source: ${toTrimmed(summary.source)}`,
        `- baseUrl: ${toTrimmed(summary.baseUrl)}`,
        `- readiness: ${toTrimmed(summary.readiness?.status)}`,
        "",
        "## Summary",
        "",
        summary.summary || "-",
        "",
        "## Triage",
        "",
        `- state: ${toTrimmed(summary.triage?.state)}`,
        `- severity: ${toTrimmed(summary.triage?.severity)}`,
        `- severityScore: ${toNumber(summary.triage?.severityScore) ?? 0}`,
        `- recommendedLane: ${toTrimmed(summary.triage?.recommendedLane)}`,
        `- reasonCodes: ${Array.isArray(summary.triage?.reasonCodes) && summary.triage.reasonCodes.length > 0 ? summary.triage.reasonCodes.join(", ") : "none"}`,
        `- severityDrivers: ${Array.isArray(summary.triage?.severityDrivers) && summary.triage.severityDrivers.length > 0 ? summary.triage.severityDrivers.map((item) => `${toTrimmed(item.code)}(${toNumber(item.weight) ?? 0})`).join(", ") : "none"}`,
        "",
        "## Queue",
        "",
        `- total: ${toNumber(summary.queue?.total) ?? 0}`,
        `- queued: ${toNumber(summary.queue?.queued) ?? 0}`,
        `- running: ${toNumber(summary.queue?.running) ?? 0}`,
        `- retryScheduled: ${toNumber(summary.queue?.retryScheduled) ?? 0}`,
        `- failedLike: ${toNumber(summary.queue?.failedLike) ?? 0}`,
        "",
        "## Backlog",
        "",
        `- count: ${toNumber(summary.queue?.backlog?.count) ?? 0}`,
        `- retryScheduled: ${toNumber(summary.queue?.backlog?.retryScheduled) ?? 0}`,
        `- failedLike: ${toNumber(summary.queue?.backlog?.failedLike) ?? 0}`,
        `- oldestAgeMs: ${toNumber(summary.queue?.backlog?.oldestAgeMs) ?? 0}`,
        "",
        "## Autonomy",
        "",
        `- paused: ${summary.autonomy?.paused === true ? "yes" : "no"}`,
        `- pendingApprovalCount: ${toNumber(summary.autonomy?.pendingApprovalCount) ?? 0}`,
        `- activeRun: ${toTrimmed(summary.autonomy?.activeRun?.runId)}`,
        `- dailyCapRemaining: ${toNumber(summary.autonomy?.dailyCap?.remainingAttempts) ?? 0}`,
        `- lockHealth: ${toTrimmed(summary.autonomy?.lockHealth?.reason)}`,
        `- latestAction: ${toTrimmed(summary.latestOperatorAction?.action, "none")}`,
        "",
        "## Pending Approvals",
        "",
    ];

    if (pendingApprovals.length === 0) {
        lines.push("- none");
    } else {
        for (const item of pendingApprovals.slice(0, 5)) {
            const qualityScore = toNumber(item.qualityScore);
            const longSpanReason = formatLongSpanReason(item.longSpanDivergence);
            lines.push(`- ${toTrimmed(item.songId)} | approval=${toTrimmed(item.approvalStatus)} | updated=${toTrimmed(item.updatedAt)} | form=${toTrimmed(item.form)} | quality=${qualityScore ?? "-"} | longSpan=${formatLongSpanLabel(item.longSpan)} | longSpanDivergence=${formatLongSpanLabel(item.longSpanDivergence)}${longSpanReason !== "-" ? ` | longSpanReason=${longSpanReason}` : ""} | prompt=${toTrimmed(item.prompt)}`);
        }
    }

    const backlogJobs = Array.isArray(summary.queue?.backlog?.topJobs)
        ? summary.queue.backlog.topJobs
        : [];

    lines.push("", "## Top Backlog", "");
    if (backlogJobs.length === 0) {
        lines.push("- none");
    } else {
        for (const item of backlogJobs) {
            const longSpanReason = formatLongSpanReason(item.longSpanDivergence);
            const orchestrationLabel = formatOrchestrationLabel(item.orchestration);
            lines.push(`- ${toTrimmed(item.jobId)} | status=${toTrimmed(item.status)} | song=${toTrimmed(item.songId)}${orchestrationLabel !== "-" ? ` | orchestration=${orchestrationLabel}` : ""} | structureLongSpan=${formatLongSpanLabel(item.structureLongSpan)} | audioLongSpan=${formatLongSpanLabel(item.audioLongSpan)} | longSpanDivergence=${formatLongSpanLabel(item.longSpanDivergence)}${longSpanReason !== "-" ? ` | longSpanReason=${longSpanReason}` : ""} | ageMs=${toNumber(item.ageMs) ?? 0} | updated=${toTrimmed(item.updatedAt)} | nextAttemptAt=${toTrimmed(item.nextAttemptAt)}`);
        }
    }

    lines.push(
        "",
        "## Overseer",
        "",
        `- lastSuccessAt: ${toTrimmed(summary.overseer?.lastSuccessAt)}`,
        `- failureCount24h: ${toNumber(summary.overseer?.failureCount24h) ?? 0}`,
        `- repeatedWarnings: ${toNumber(summary.overseer?.activeRepeatedWarningCount) ?? 0}`,
        "",
        "## Top Warnings",
        "",
    );

    if (warnings.length === 0) {
        lines.push("- none");
    } else {
        for (const warning of warnings) {
            lines.push(`- x${toNumber(warning.count) ?? 0} | lastSeen=${toTrimmed(warning.lastSeenAt)} | ${toTrimmed(warning.warning)}`);
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
    if (!shadowReranker || (toNumber(shadowReranker.scoredManifestCount) ?? 0) === 0) {
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
        const recentDisagreements = Array.isArray(shadowReranker.recentDisagreements)
            ? shadowReranker.recentDisagreements
            : [];
        const recentPromotions = Array.isArray(shadowReranker.recentPromotions)
            ? shadowReranker.recentPromotions
            : [];
        for (const item of recentDisagreements) {
            lines.push(formatShadowRerankerDisagreementLine(item));
        }
        for (const item of recentPromotions) {
            lines.push(formatShadowRerankerPromotionLine(item));
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

    lines.push("", "## Latest Operator Action", "");
    if (!latestOperatorAction?.present) {
        lines.push("- none");
    } else {
        lines.push(`- action: ${toTrimmed(latestOperatorAction.action)}`);
        lines.push(`- surface: ${toTrimmed(latestOperatorAction.surface)}`);
        lines.push(`- actor: ${toTrimmed(latestOperatorAction.actor)}`);
        lines.push(`- approvedBy: ${toTrimmed(latestOperatorAction.approvedBy)}`);
        lines.push(`- observedAt: ${toTrimmed(latestOperatorAction.observedAt)}`);
        lines.push(`- reason: ${toTrimmed(latestOperatorAction.reason)}`);
        lines.push(`- rollbackNote: ${toTrimmed(latestOperatorAction.rollbackNote)}`);
        lines.push(`- manualRecoveryNote: ${toTrimmed(latestOperatorAction.manualRecoveryNote)}`);
        if (Array.isArray(latestOperatorAction.artifactLinks) && latestOperatorAction.artifactLinks.length > 0) {
            for (const item of latestOperatorAction.artifactLinks) {
                lines.push(`- artifact: ${toTrimmed(item)}`);
            }
        } else {
            lines.push("- artifact: none");
        }
    }

    lines.push("", "## Evidence", "", `- contractOk: ${summary.evidence?.contractOk === true ? "yes" : "no"}`);
    lines.push(`- stale: ${summary.evidence?.stale === true ? "yes" : "no"}`);
    lines.push(`- staleReason: ${toTrimmed(summary.evidence?.staleReason)}`);
    lines.push(`- staleThresholdMs: ${toNumber(summary.evidence?.staleThresholdMs) ?? 0}`);
    lines.push(`- oldestAgeMs: ${toNumber(summary.evidence?.oldestAgeMs) ?? 0}`);
    lines.push(`- maxSkewMs: ${toNumber(summary.evidence?.maxSkewMs) ?? 0}`);
    if (missing.length === 0) {
        lines.push("- missing: none");
    } else {
        for (const item of missing) {
            lines.push(`- missing: ${toTrimmed(item)}`);
        }
    }

    return lines.join("\n") + "\n";
}

function buildUpstreamCompatibleSummary(summary) {
    return {
        ok: true,
        namespace: toTrimmed(summary.namespace, "axiom"),
        upstream: {
            id: toTrimmed(summary.source, "local-runtime"),
            url: toTrimmed(summary.baseUrl),
            namespace: toTrimmed(summary.namespace, "axiom"),
            enabled: true,
        },
        summary: toTrimmed(summary.summary),
        artifacts: Array.isArray(summary.artifacts)
            ? summary.artifacts.map((item) => String(item))
            : [],
        latestOperatorAction: summary.latestOperatorAction ?? {
            present: false,
            action: null,
            surface: null,
            actor: null,
            approvedBy: null,
            reason: null,
            rollbackNote: null,
            manualRecoveryNote: null,
            observedAt: null,
            artifactLinks: [],
        },
        catalogToolCount: 0,
        data: {
            autonomyStatus: summary.data?.autonomyStatus ?? summary.data?.autonomyOps ?? null,
            overseerSummary: summary.data?.overseerSummary ?? null,
            latestOperatorAction: summary.data?.latestOperatorAction ?? summary.latestOperatorAction ?? null,
            jobs: Array.isArray(summary.data?.jobs)
                ? summary.data.jobs
                : Array.isArray(summary.data?.recentJobs)
                    ? summary.data.recentJobs
                    : [],
        },
    };
}

async function collectSummary() {
    const args = ["scripts/print-operator-summary.mjs"];
    const passThroughOptions = ["url", "namespace", "source", "jobLimit", "windowHours", "token", "staleMs"];
    for (const option of passThroughOptions) {
        const value = readOption(option);
        if (value) {
            args.push(`--${option}`, value);
        }
    }

    let result;
    try {
        result = await execFileAsync(process.execPath, args, {
            cwd: process.cwd(),
            env: process.env,
            maxBuffer: 1024 * 1024,
        });
    } catch (error) {
        throw createScriptError("Operator summary script failed", {
            stdout: String(error.stdout || "").trim(),
            stderr: String(error.stderr || "").trim(),
            code: error.code,
        });
    }

    const stdout = String(result.stdout || "").trim();
    if (!stdout) {
        throw createScriptError("Operator summary script produced no output", {});
    }

    try {
        return JSON.parse(stdout);
    } catch (error) {
        throw createScriptError("Operator summary script returned non-JSON output", {
            stdout,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function main() {
    const projectionDir = resolveOutputDir();
    try {
        const summary = await collectSummary();
        if (!summary || summary.ok !== true) {
            throw createScriptError("Operator summary collection failed", { summary });
        }

        const observedAt = toTrimmed(summary.observedAt, new Date().toISOString());
        const dayKey = dayKeyFromObservedAt(observedAt);
        const latestJsonPath = path.join(projectionDir, "latest.json");
        const latestMarkdownPath = path.join(projectionDir, "latest.md");
        const upstreamCompatiblePath = path.join(projectionDir, "upstream-compatible.json");
        const latestErrorPath = path.join(projectionDir, "latest-error.json");
        const historyPath = path.join(projectionDir, "history", `${dayKey}.jsonl`);
        const markdown = buildMarkdown(summary);
        const upstreamCompatible = buildUpstreamCompatibleSummary(summary);

        writeAtomic(latestJsonPath, JSON.stringify(summary, null, 2) + "\n");
        writeAtomic(latestMarkdownPath, markdown);
        writeAtomic(upstreamCompatiblePath, JSON.stringify(upstreamCompatible, null, 2) + "\n");
        deleteFileIfExists(latestErrorPath);
        ensureDir(path.dirname(historyPath));
        fs.appendFileSync(historyPath, JSON.stringify(summary) + "\n", "utf-8");

        console.log(JSON.stringify({
            ok: true,
            summary: summary.summary,
            observedAt,
            projectionDir,
            artifacts: [latestJsonPath, latestMarkdownPath, upstreamCompatiblePath, historyPath],
        }, null, 2));
    } catch (error) {
        const payload = {
            ok: false,
            observedAt: new Date().toISOString(),
            projectionDir,
            message: error instanceof Error ? error.message : String(error),
            details: error && typeof error === "object" && "details" in error
                ? error.details
                : undefined,
        };
        const failureArtifacts = writeFailureArtifacts(projectionDir, payload);
        console.error(JSON.stringify({
            ...payload,
            artifacts: [failureArtifacts.latestErrorPath, failureArtifacts.errorHistoryPath],
        }, null, 2));
        process.exit(1);
    }
}

main().catch((error) => {
    fail("AXIOM operator summary projection crashed", {
        error: error instanceof Error ? error.message : String(error),
    });
});