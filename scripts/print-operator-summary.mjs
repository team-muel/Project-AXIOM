import fs from "node:fs";
import path from "node:path";

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

function clampInteger(value, fallback, min, max) {
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

function resolveBaseUrl() {
    const explicit = readOption("url") || process.env.AXIOM_BASE_URL;
    if (explicit) {
        return explicit.replace(/\/+$/, "");
    }

    const port = Number.parseInt(process.env.PORT || "3100", 10);
    const safePort = Number.isFinite(port) ? port : 3100;
    return `http://127.0.0.1:${safePort}`;
}

function resolveOutputDir() {
    return process.env.OUTPUT_DIR || "outputs";
}

function resolveEvidenceStaleMs() {
    return clampInteger(readOption("staleMs") || process.env.AXIOM_OPERATOR_EVIDENCE_STALE_MS, 15000, 0, 24 * 60 * 60 * 1000);
}

function buildHeaders(token) {
    const headers = {
        "content-type": "application/json",
    };

    if (token) {
        headers.authorization = `Bearer ${token}`;
    }

    return headers;
}

function toRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}

function toRecordArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((item) => Boolean(toRecord(item)));
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

function toTrimmed(value, fallback = "-") {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function summarizeLongSpanSnapshot(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
    }

    const weakDimensions = Array.isArray(item.weakDimensions)
        ? item.weakDimensions.map((value) => toTrimmed(value)).filter((value) => value !== "-")
        : [];

    return {
        status: toTrimmed(item.status),
        weakestDimension: toTrimmed(item.weakestDimension, "") || null,
        weakDimensions,
        averageFit: toNumber(item.averageFit) ?? null,
        thematicCheckpointCount: toNumber(item.thematicCheckpointCount) ?? 0,
        developmentPressureFit: toNumber(item.developmentPressureFit) ?? null,
        thematicTransformationFit: toNumber(item.thematicTransformationFit) ?? null,
        harmonicTimingFit: toNumber(item.harmonicTimingFit) ?? null,
        returnPayoffFit: toNumber(item.returnPayoffFit) ?? null,
    };
}

function formatLongSpanLabel(longSpan) {
    if (!longSpan?.status) {
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

function summarizeLongSpanDivergenceSnapshot(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
    }

    const secondaryRepairFocuses = Array.isArray(item.secondaryRepairFocuses)
        ? item.secondaryRepairFocuses.map((value) => toTrimmed(value)).filter((value) => value !== "-")
        : [];

    const sections = Array.isArray(item.sections)
        ? item.sections
            .filter((section) => section && typeof section === "object" && !Array.isArray(section))
            .map((section) => ({
                sectionId: toTrimmed(section.sectionId),
                label: toTrimmed(section.label),
                role: toTrimmed(section.role),
                focus: toTrimmed(section.focus),
                explanation: toTrimmed(section.explanation),
                comparisonStatus: toTrimmed(section.comparisonStatus, "") || null,
                sourceSectionId: toTrimmed(section.sourceSectionId, "") || null,
                plannedTonality: toTrimmed(section.plannedTonality, "") || null,
                topIssue: toTrimmed(section.topIssue, "") || null,
                score: toNumber(section.score) ?? null,
                focusFit: toNumber(section.focusFit) ?? null,
                consistencyFit: toNumber(section.consistencyFit) ?? null,
                structureSectionId: toTrimmed(section.structureSectionId, "") || null,
                structureLabel: toTrimmed(section.structureLabel, "") || null,
                structureRole: toTrimmed(section.structureRole, "") || null,
                structureTopIssue: toTrimmed(section.structureTopIssue, "") || null,
                structureScore: toNumber(section.structureScore) ?? null,
                structureStartMeasure: toNumber(section.structureStartMeasure) ?? null,
                structureEndMeasure: toNumber(section.structureEndMeasure) ?? null,
                structureExplanation: toTrimmed(section.structureExplanation, "") || null,
            }))
        : [];
    const recommendedDirectives = Array.isArray(item.recommendedDirectives)
        ? item.recommendedDirectives
            .filter((directive) => directive && typeof directive === "object" && !Array.isArray(directive))
            .map((directive) => ({
                focus: toTrimmed(directive.focus),
                kind: toTrimmed(directive.kind),
                priorityClass: toTrimmed(directive.priorityClass, "") || null,
            }))
        : [];
    const operatorReason = buildLongSpanOperatorReason({
        repairMode: toTrimmed(item.repairMode, "") || null,
        primarySectionId: toTrimmed(item.primarySectionId, "") || null,
        sections,
    });

    return {
        status: toTrimmed(item.status),
        repairMode: toTrimmed(item.repairMode, "") || null,
        repairFocus: toTrimmed(item.repairFocus, "") || null,
        secondaryRepairFocuses,
        recommendedDirectiveKind: toTrimmed(item.recommendedDirectiveKind, "") || null,
        recommendedDirectives,
        explanation: toTrimmed(item.explanation, "") || null,
        structureStatus: toTrimmed(item.structureStatus, "") || null,
        audioStatus: toTrimmed(item.audioStatus, "") || null,
        operatorReason,
        primarySectionId: toTrimmed(item.primarySectionId, "") || null,
        primarySectionRole: toTrimmed(item.primarySectionRole, "") || null,
        sections,
    };
}

function readJsonRecordIfExists(filePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return toRecord(parsed) || null;
    } catch {
        return null;
    }
}

function toTimestampMs(value) {
    const parsed = Date.parse(String(value || "").trim());
    return Number.isFinite(parsed) ? parsed : undefined;
}

function summarizePendingApproval(item) {
    return {
        songId: toTrimmed(item.songId),
        runId: toTrimmed(item.runId),
        prompt: toTrimmed(item.prompt),
        form: toTrimmed(item.form),
        updatedAt: toTrimmed(item.updatedAt),
        qualityScore: toNumber(item.qualityScore) ?? null,
        longSpan: summarizeLongSpanSnapshot(item.longSpan),
        longSpanDivergence: summarizeLongSpanDivergenceSnapshot(item.longSpanDivergence),
        approvalStatus: toTrimmed(item.approvalStatus, "pending"),
    };
}

function boolLabel(value) {
    if (value === true) {
        return "yes";
    }

    if (value === false) {
        return "no";
    }

    return "unknown";
}

function summarizeOperatorAction(record) {
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

async function readJson(response, label) {
    const text = await response.text();
    if (!text.trim()) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        fail(`Non-JSON response from ${label}`, {
            status: response.status,
            text,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function fetchJson(baseUrl, path, headers, label) {
    const startedAtMs = Date.now();
    let response;
    try {
        response = await fetch(`${baseUrl}${path}`, { headers });
    } catch (error) {
        fail(`Failed to reach ${label}`, {
            baseUrl,
            path,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    const fetchedAtMs = Date.now();

    return {
        path,
        statusCode: response.status,
        ok: response.ok,
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        fetchedAtMs,
        latencyMs: fetchedAtMs - startedAtMs,
        payload: await readJson(response, label),
    };
}

function buildEvidence(observedAt, staleThresholdMs, missing, responses) {
    const observedAtMs = Date.parse(observedAt);
    const fetchedTimes = responses
        .map((response) => response.fetchedAtMs)
        .filter((value) => Number.isFinite(value));
    const earliestFetchedAtMs = fetchedTimes.length > 0 ? Math.min(...fetchedTimes) : observedAtMs;
    const latestFetchedAtMs = fetchedTimes.length > 0 ? Math.max(...fetchedTimes) : observedAtMs;
    const oldestAgeMs = Number.isFinite(observedAtMs) ? Math.max(0, observedAtMs - earliestFetchedAtMs) : 0;
    const maxSkewMs = fetchedTimes.length > 1 ? Math.max(0, latestFetchedAtMs - earliestFetchedAtMs) : 0;
    const stale = oldestAgeMs > staleThresholdMs || maxSkewMs > staleThresholdMs;

    let staleReason = "none";
    if (stale) {
        staleReason = oldestAgeMs > staleThresholdMs
            ? "endpoint_age_exceeds_threshold"
            : "endpoint_skew_exceeds_threshold";
    }

    return {
        contractOk: missing.length === 0,
        missing,
        stale,
        staleReason,
        staleThresholdMs,
        oldestAgeMs,
        maxSkewMs,
        endpoints: {
            ready: {
                path: responses[0].path,
                statusCode: responses[0].statusCode,
                ok: responses[0].ok,
                fetchedAt: responses[0].fetchedAt,
                latencyMs: responses[0].latencyMs,
            },
            jobs: {
                path: responses[1].path,
                statusCode: responses[1].statusCode,
                ok: responses[1].ok,
                fetchedAt: responses[1].fetchedAt,
                latencyMs: responses[1].latencyMs,
            },
            autonomyOps: {
                path: responses[2].path,
                statusCode: responses[2].statusCode,
                ok: responses[2].ok,
                fetchedAt: responses[2].fetchedAt,
                latencyMs: responses[2].latencyMs,
            },
            overseerSummary: {
                path: responses[3].path,
                statusCode: responses[3].statusCode,
                ok: responses[3].ok,
                fetchedAt: responses[3].fetchedAt,
                latencyMs: responses[3].latencyMs,
            },
        },
    };
}

function severityWeightForReasonCode(code) {
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

function addSeverityDriver(drivers, code, weight, detail) {
    drivers.push({
        code,
        weight,
        detail: toTrimmed(detail, code),
    });
}

function deriveSeverity(state, severityScore, severityDrivers) {
    const criticalCount = severityDrivers.filter((item) => (toNumber(item.weight) ?? 0) >= 4).length;

    if (state === "incident_candidate") {
        return criticalCount >= 2 || severityScore >= 10 ? "SEV-1" : "SEV-2";
    }

    if (state === "runtime_degraded" || state === "bridge_degraded") {
        return severityScore >= 5 ? "SEV-2" : "SEV-3";
    }

    return "none";
}

function buildTriage(state, recommendedLane, reasonCodes, severityDrivers) {
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

function buildRuntimeTriage(readiness, queue, autonomy, overseer, evidence) {
    const reasonCodes = [];
    const severityDrivers = [];
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
        addSeverityDriver(severityDrivers, "repeated_warning_active", severityWeightForReasonCode("repeated_warning_active") + (overseer.activeRepeatedWarningCount >= 3 ? 1 : 0), `count=${overseer.activeRepeatedWarningCount}`);
        degraded = true;
    }
    if (overseer.failureCount24h > 0) {
        reasonCodes.push("overseer_recent_failures");
        addSeverityDriver(severityDrivers, "overseer_recent_failures", severityWeightForReasonCode("overseer_recent_failures") + (overseer.failureCount24h >= 3 ? 1 : 0), `count=${overseer.failureCount24h}`);
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

function summarizeQueue(jobs) {
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

function summarizeOrchestrationSnapshot(item) {
    const record = toRecord(item);
    if (!record) {
        return null;
    }

    return {
        family: toTrimmed(record.family, "unknown"),
        instrumentNames: Array.isArray(record.instrumentNames)
            ? record.instrumentNames.map((entry) => toTrimmed(entry)).filter((entry) => entry !== "-")
            : [],
        sectionCount: toNumber(record.sectionCount) ?? 0,
        conversationalSectionCount: toNumber(record.conversationalSectionCount) ?? 0,
        idiomaticRangeFit: toNumber(record.idiomaticRangeFit) ?? null,
        registerBalanceFit: toNumber(record.registerBalanceFit) ?? null,
        ensembleConversationFit: toNumber(record.ensembleConversationFit) ?? null,
        doublingPressureFit: toNumber(record.doublingPressureFit) ?? null,
        textureRotationFit: toNumber(record.textureRotationFit) ?? null,
        sectionHandoffFit: toNumber(record.sectionHandoffFit) ?? null,
        weakSectionIds: Array.isArray(record.weakSectionIds)
            ? record.weakSectionIds.map((entry) => toTrimmed(entry)).filter((entry) => entry !== "-")
            : [],
    };
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
        ? orchestration.weakSectionIds.map((entry) => toTrimmed(entry)).filter((entry) => entry !== "-").join(",")
        : "none";
    const doublingToken = typeof orchestration.doublingPressureFit === "number"
        ? `,dbl=${formatOrchestrationMetric(orchestration.doublingPressureFit)}`
        : "";
    const rotationToken = typeof orchestration.textureRotationFit === "number"
        ? `,rot=${formatOrchestrationMetric(orchestration.textureRotationFit)}`
        : "";
    const handoffToken = typeof orchestration.sectionHandoffFit === "number"
        ? `,hnd=${formatOrchestrationMetric(orchestration.sectionHandoffFit)}`
        : "";

    return `${family}:rng=${formatOrchestrationMetric(orchestration.idiomaticRangeFit)},bal=${formatOrchestrationMetric(orchestration.registerBalanceFit)},conv=${formatOrchestrationMetric(orchestration.ensembleConversationFit)}${doublingToken}${rotationToken}${handoffToken},weak=${weakSections}`;
}

function summarizeOrchestrationTrends(value) {
    const record = toRecord(value);
    const rows = Array.isArray(record?.familyRows)
        ? toRecordArray(record.familyRows)
        : [];

    return rows.slice(0, 3).map((row) => ({
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
    }));
}

function summarizePhraseBreathTrend(value) {
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

function summarizeHarmonicColorTrend(value) {
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

function summarizeShadowRerankerRecentDisagreement(row) {
    const record = toRecord(row) || {};
    return {
        songId: toTrimmed(record.songId),
        updatedAt: toTrimmed(record.updatedAt),
        snapshotId: toTrimmed(record.snapshotId, "") || null,
        lane: toTrimmed(record.lane, "") || null,
        selectedCandidateId: toTrimmed(record.selectedCandidateId, "") || null,
        selectedWorker: toTrimmed(record.selectedWorker, "") || null,
        learnedTopCandidateId: toTrimmed(record.learnedTopCandidateId, "") || null,
        learnedTopWorker: toTrimmed(record.learnedTopWorker, "") || null,
        learnedConfidence: toNumber(record.learnedConfidence) ?? null,
        reason: toTrimmed(record.reason, "") || null,
    };
}

function summarizeShadowRerankerRecentPromotion(row) {
    const record = toRecord(row) || {};
    return {
        songId: toTrimmed(record.songId),
        updatedAt: toTrimmed(record.updatedAt),
        snapshotId: toTrimmed(record.snapshotId, "") || null,
        lane: toTrimmed(record.lane, "") || null,
        selectedCandidateId: toTrimmed(record.selectedCandidateId, "") || null,
        selectedWorker: toTrimmed(record.selectedWorker, "") || null,
        heuristicCounterfactualCandidateId: toTrimmed(record.heuristicCounterfactualCandidateId, "") || null,
        heuristicCounterfactualWorker: toTrimmed(record.heuristicCounterfactualWorker, "") || null,
        learnedConfidence: toNumber(record.learnedConfidence) ?? null,
        reason: toTrimmed(record.reason, "") || null,
    };
}

function summarizeShadowRerankerRuntimeWindow(value) {
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

function summarizeShadowRerankerPromotionOutcomes(value) {
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

function summarizeShadowRerankerPromotionAdvantage(value) {
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
        minimumReviewedManifestCount: toNumber(record.minimumReviewedManifestCount) ?? 4,
        minimumReviewedPerCohortCount: toNumber(record.minimumReviewedPerCohortCount) ?? 2,
        approvalRateDelta: toNumber(record.approvalRateDelta) ?? null,
        appealScoreDelta: toNumber(record.appealScoreDelta) ?? null,
        signal: toTrimmed(record.signal),
    };
}

const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED = 4;
const SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT = 2;

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
    const availableDeltas = [approvalRateDelta, appealScoreDelta]
        .filter((value) => typeof value === "number" && Number.isFinite(value));
    const positive = availableDeltas.some((value) => value > 0.0001);
    const negative = availableDeltas.some((value) => value < -0.0001);
    const reviewedManifestCount = toNumber(outcomes.reviewedManifestCount) ?? 0;
    const promotedReviewedCount = toNumber(outcomes.promotedReviewedCount) ?? 0;
    const heuristicReviewedCount = toNumber(outcomes.heuristicReviewedCount) ?? 0;
    const sufficientReviewSample = reviewedManifestCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED
        && promotedReviewedCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT
        && heuristicReviewedCount >= SHADOW_RERANKER_PROMOTION_ADVANTAGE_MIN_REVIEWED_PER_COHORT;
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

function summarizeShadowRerankerRetryLocalizationOutcomes(value) {
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

function summarizeShadowReranker(value) {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    const promotionOutcomes = summarizeShadowRerankerPromotionOutcomes(record.promotionOutcomes);
    const promotionAdvantage = summarizeShadowRerankerPromotionAdvantage(record.promotionAdvantage)
        || deriveShadowRerankerPromotionAdvantage(promotionOutcomes);

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
        promotionOutcomes,
        promotionAdvantage,
        retryLocalizationOutcomes: summarizeShadowRerankerRetryLocalizationOutcomes(record.retryLocalizationOutcomes),
        runtimeWindow: summarizeShadowRerankerRuntimeWindow(record.runtimeWindow),
    };
}

function formatOrchestrationTrendArtifact(item) {
    const family = toTrimmed(item.family, "unknown") === "string_trio"
        ? "trio"
        : toTrimmed(item.family, "unknown");
    const instruments = Array.isArray(item.instrumentNames) && item.instrumentNames.length > 0
        ? item.instrumentNames.join("/")
        : "-";

    return [
        `orchestrationTrend family=${family}`,
        `manifests=${toNumber(item.manifestCount) ?? 0}`,
        `rng=${formatOrchestrationMetric(item.averageIdiomaticRangeFit)}`,
        `bal=${formatOrchestrationMetric(item.averageRegisterBalanceFit)}`,
        `conv=${formatOrchestrationMetric(item.averageEnsembleConversationFit)}`,
        ...(typeof item.averageDoublingPressureFit === "number"
            ? [`dbl=${formatOrchestrationMetric(item.averageDoublingPressureFit)}`]
            : []),
        ...(typeof item.averageTextureRotationFit === "number"
            ? [`rot=${formatOrchestrationMetric(item.averageTextureRotationFit)}`]
            : []),
        ...(typeof item.averageSectionHandoffFit === "number"
            ? [`hnd=${formatOrchestrationMetric(item.averageSectionHandoffFit)}`]
            : []),
        `weakManifests=${toNumber(item.weakManifestCount) ?? 0}`,
        `avgWeakSections=${formatOrchestrationMetric(item.averageWeakSectionCount)}`,
        `instruments=${instruments}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatPhraseBreathTrendArtifact(item) {
    return [
        `phraseBreathTrend manifests=${toNumber(item.manifestCount) ?? 0}`,
        `plan=${formatOrchestrationMetric(toNumber(item.averagePlanFit))}`,
        `cov=${formatOrchestrationMetric(toNumber(item.averageCoverageFit))}`,
        `pickup=${formatOrchestrationMetric(toNumber(item.averagePickupFit))}`,
        `arr=${formatOrchestrationMetric(toNumber(item.averageArrivalFit))}`,
        `rel=${formatOrchestrationMetric(toNumber(item.averageReleaseFit))}`,
        `weakManifests=${toNumber(item.weakManifestCount) ?? 0}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatHarmonicColorTrendArtifact(item) {
    return [
        `harmonicColorTrend manifests=${toNumber(item.manifestCount) ?? 0}`,
        `plan=${formatOrchestrationMetric(toNumber(item.averagePlanFit))}`,
        `cov=${formatOrchestrationMetric(toNumber(item.averageCoverageFit))}`,
        `target=${formatOrchestrationMetric(toNumber(item.averageTargetFit))}`,
        `time=${formatOrchestrationMetric(toNumber(item.averageTimingFit))}`,
        `tonic=${formatOrchestrationMetric(toNumber(item.averageTonicizationPressureFit))}`,
        `prolong=${formatOrchestrationMetric(toNumber(item.averageProlongationMotionFit))}`,
        `weakManifests=${toNumber(item.weakManifestCount) ?? 0}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatShadowRerankerArtifact(item) {
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

function formatShadowRerankerRuntimeWindowArtifact(item) {
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

function formatShadowRerankerDisagreementArtifact(item) {
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

function formatShadowRerankerPromotionArtifact(item) {
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

function formatShadowRerankerPromotionOutcomesArtifact(item) {
    return [
        `shadowReranker outcomes lane=${toTrimmed(item.lane)}`,
        `scored=${toNumber(item.scoredManifestCount) ?? 0}`,
        `reviewed=${toNumber(item.reviewedManifestCount) ?? 0}`,
        `pendingReview=${toNumber(item.pendingReviewCount) ?? 0}`,
        `promoted=${toNumber(item.promotedSelectionCount) ?? 0}`,
        `promotedReviewed=${toNumber(item.promotedReviewedCount) ?? 0}`,
        `promotedApprovalRate=${formatOrchestrationMetric(item.promotedApprovalRate)}`,
        `heuristicReviewed=${toNumber(item.heuristicReviewedCount) ?? 0}`,
        `heuristicApprovalRate=${formatOrchestrationMetric(item.heuristicApprovalRate)}`,
        `promotedAvgAppeal=${formatOrchestrationMetric(item.promotedAverageAppealScore)}`,
        `heuristicAvgAppeal=${formatOrchestrationMetric(item.heuristicAverageAppealScore)}`,
    ].join(" ");
}

function formatShadowRerankerPromotionAdvantageArtifact(item) {
    return [
        `shadowReranker promotionAdvantage lane=${toTrimmed(item.lane)}`,
        `reviewed=${toNumber(item.reviewedManifestCount) ?? 0}`,
        `promotedReviewed=${toNumber(item.promotedReviewedCount) ?? 0}`,
        `heuristicReviewed=${toNumber(item.heuristicReviewedCount) ?? 0}`,
        `sufficientSample=${item.sufficientReviewSample === true ? "yes" : "no"}`,
        `approvalDelta=${formatOrchestrationMetric(item.approvalRateDelta)}`,
        `appealDelta=${formatOrchestrationMetric(item.appealScoreDelta)}`,
        `signal=${toTrimmed(item.signal)}`,
    ].join(" ");
}

function formatShadowRerankerRetryLocalizationArtifact(item) {
    return [
        `shadowReranker retryLocalization lane=${toTrimmed(item.lane)}`,
        `scored=${toNumber(item.scoredManifestCount) ?? 0}`,
        `retrying=${toNumber(item.retryingManifestCount) ?? 0}`,
        `promotedRetrying=${toNumber(item.promotedRetryingCount) ?? 0}`,
        `promotedTargetedOnly=${toNumber(item.promotedTargetedOnlyCount) ?? 0}`,
        `promotedMixed=${toNumber(item.promotedMixedCount) ?? 0}`,
        `promotedGlobalOnly=${toNumber(item.promotedGlobalOnlyCount) ?? 0}`,
        `promotedTargetedRate=${formatOrchestrationMetric(item.promotedSectionTargetedRate)}`,
        `heuristicRetrying=${toNumber(item.heuristicRetryingCount) ?? 0}`,
        `heuristicTargetedOnly=${toNumber(item.heuristicTargetedOnlyCount) ?? 0}`,
        `heuristicMixed=${toNumber(item.heuristicMixedCount) ?? 0}`,
        `heuristicGlobalOnly=${toNumber(item.heuristicGlobalOnlyCount) ?? 0}`,
        `heuristicTargetedRate=${formatOrchestrationMetric(item.heuristicSectionTargetedRate)}`,
    ].join(" ");
}

function summarizeBacklog(jobs, observedAtMs) {
    const candidates = jobs
        .filter((job) => {
            const status = toTrimmed(job.status, "unknown");
            return status !== "done";
        })
        .map((job) => {
            const createdAtMs = toTimestampMs(job.createdAt) ?? observedAtMs;
            const quality = toRecord(job.quality) || {};
            const tracking = toRecord(job.tracking) || {};
            return {
                jobId: toTrimmed(job.jobId),
                songId: toTrimmed(job.songId),
                status: toTrimmed(job.status, "unknown"),
                createdAt: toTrimmed(job.createdAt),
                updatedAt: toTrimmed(job.updatedAt),
                nextAttemptAt: toTrimmed(job.nextAttemptAt),
                error: toTrimmed(job.error),
                structureLongSpan: summarizeLongSpanSnapshot(quality.longSpan),
                audioLongSpan: summarizeLongSpanSnapshot(quality.audioLongSpan),
                longSpanDivergence: summarizeLongSpanDivergenceSnapshot(quality.longSpanDivergence),
                orchestration: summarizeOrchestrationSnapshot(tracking.orchestration),
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

function summarizeReadiness(payload, statusCode, missing) {
    const record = toRecord(payload) || {};
    const status = typeof record.status === "string"
        ? record.status
        : statusCode >= 500
            ? "not_ready"
            : "ready";

    if (typeof record.status !== "string") {
        missing.push("ready.status");
    }

    return {
        status,
        degradedReasons: Array.isArray(record.degradedReasons)
            ? record.degradedReasons.map((item) => String(item))
            : [],
        capabilities: toRecord(record.capabilities) || {},
        checks: toRecord(record.checks) || {},
    };
}

function summarizeAutonomy(payload, missing) {
    const record = toRecord(payload) || {};
    const operations = toRecord(record.operations) || {};
    const dailyCap = toRecord(operations.dailyCap);
    const lockHealth = toRecord(operations.lockHealth);
    const pendingApprovals = Array.isArray(record.pendingApprovals)
        ? toRecordArray(record.pendingApprovals).map(summarizePendingApproval)
        : [];

    if (!dailyCap) {
        missing.push("autonomy.operations.dailyCap");
    }
    if (!lockHealth) {
        missing.push("autonomy.operations.lockHealth");
    }
    if (!Array.isArray(record.pendingApprovals)) {
        missing.push("autonomy.pendingApprovals");
    }

    return {
        reachable: record.reachable === true,
        paused: record.paused === true,
        activeRun: toRecord(record.activeRun) || null,
        pendingApprovalCount: toNumber(record.pendingApprovalCount) ?? 0,
        pendingApprovals,
        dailyCap: dailyCap || {},
        lockHealth: lockHealth || {},
        recommendations: Array.isArray(operations.recommendations)
            ? operations.recommendations.map((item) => String(item))
            : [],
    };
}

function summarizeOverseer(payload, missing) {
    const record = toRecord(payload) || {};
    const warnings = toRecordArray(record.repeatedWarnings);
    const manifestAudioRetry = toRecord(record.manifestAudioRetry);
    if (!Array.isArray(record.repeatedWarnings)) {
        missing.push("overseer.repeatedWarnings");
    }

    return {
        windowHours: toNumber(record.windowHours) ?? null,
        sampledEntries: toNumber(record.sampledEntries) ?? 0,
        lastSuccessAt: toTrimmed(record.lastHealthyReportAt, "-"),
        lastFailureAt: toTrimmed(record.lastFailureAt, "-"),
        failureCount24h: toNumber(record.recentFailureCount) ?? toNumber(record.failedRuns) ?? 0,
        activeRepeatedWarningCount: toNumber(record.activeRepeatedWarningCount) ?? warnings.length,
        repeatedWarnings: warnings.slice(0, 3),
        phraseBreathTrend: summarizePhraseBreathTrend(manifestAudioRetry?.phraseBreathTrends),
        harmonicColorTrend: summarizeHarmonicColorTrend(manifestAudioRetry?.harmonicColorTrends),
        shadowReranker: summarizeShadowReranker(manifestAudioRetry?.shadowReranker),
        orchestrationTrends: summarizeOrchestrationTrends(manifestAudioRetry?.orchestrationTrends),
    };
}

function formatQueueArtifact(queue) {
    return `queue total=${queue.total} queued=${queue.queued} running=${queue.running} retryScheduled=${queue.retryScheduled} failedLike=${queue.failedLike}`;
}

function formatWarningArtifact(warning) {
    return `warning x${toNumber(warning.count) ?? 0} lastSeen=${toTrimmed(warning.lastSeenAt)} ${toTrimmed(warning.warning)}`;
}

function formatBacklogArtifact(job) {
    const longSpanReason = formatLongSpanReason(job.longSpanDivergence);
    const orchestrationLabel = formatOrchestrationLabel(job.orchestration);
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

function formatPendingArtifact(pending) {
    const longSpanReason = formatLongSpanReason(pending.longSpanDivergence);
    return [
        `pending=${toTrimmed(pending.songId)}`,
        `approval=${toTrimmed(pending.approvalStatus)}`,
        `updated=${toTrimmed(pending.updatedAt)}`,
        `longSpan=${formatLongSpanLabel(pending.longSpan)}`,
        `longSpanDivergence=${formatLongSpanLabel(pending.longSpanDivergence)}`,
        ...(longSpanReason !== "-" ? [`longSpanReason=${longSpanReason}`] : []),
        `prompt=${toTrimmed(pending.prompt)}`,
    ].join(" ");
}

async function main() {
    const baseUrl = resolveBaseUrl();
    const staleThresholdMs = resolveEvidenceStaleMs();
    const namespace = toTrimmed(readOption("namespace") || process.env.AXIOM_NAMESPACE, "axiom");
    const source = toTrimmed(readOption("source") || process.env.AXIOM_OPERATOR_SOURCE, "local-runtime");
    const token = readOption("token") || process.env.AXIOM_OPERATOR_TOKEN || process.env.MCP_WORKER_AUTH_TOKEN || "";
    const jobLimit = clampInteger(readOption("jobLimit") || process.env.AXIOM_OPERATOR_JOB_LIMIT, 5, 1, 20);
    const windowHours = clampInteger(readOption("windowHours") || process.env.AXIOM_OPERATOR_WINDOW_HOURS, 24, 1, 24 * 7);
    const headers = buildHeaders(token);

    const observedAt = new Date().toISOString();
    const [readyResponse, jobsResponse, autonomyResponse, overseerResponse] = await Promise.all([
        fetchJson(baseUrl, "/ready", headers, "AXIOM /ready"),
        fetchJson(baseUrl, "/jobs", headers, "AXIOM /jobs"),
        fetchJson(baseUrl, "/autonomy/ops", headers, "AXIOM /autonomy/ops"),
        fetchJson(baseUrl, `/overseer/summary?windowHours=${windowHours}&limit=200`, headers, "AXIOM /overseer/summary"),
    ]);

    const missing = [];
    const readiness = summarizeReadiness(readyResponse.payload, readyResponse.statusCode, missing);
    const jobs = Array.isArray(jobsResponse.payload) ? jobsResponse.payload.filter((item) => Boolean(toRecord(item))) : [];
    if (!Array.isArray(jobsResponse.payload)) {
        missing.push("jobs.array");
    }

    const sortedJobs = jobs
        .slice()
        .sort((left, right) => toTrimmed(right.updatedAt).localeCompare(toTrimmed(left.updatedAt)));

    const queue = summarizeQueue(sortedJobs);
    const observedAtMs = Date.parse(observedAt);
    const backlog = summarizeBacklog(sortedJobs, Number.isFinite(observedAtMs) ? observedAtMs : Date.now());
    const autonomy = summarizeAutonomy(autonomyResponse.payload, missing);
    const overseer = summarizeOverseer(overseerResponse.payload, missing);
    const latestOperatorAction = summarizeOperatorAction(
        readJsonRecordIfExists(path.join(resolveOutputDir(), "_system", "operator-actions", "latest.json")),
    );
    const evidence = buildEvidence(observedAt, staleThresholdMs, missing, [readyResponse, jobsResponse, autonomyResponse, overseerResponse]);
    const queueWithBacklog = {
        ...queue,
        backlog,
    };
    const triage = buildRuntimeTriage(readiness, queueWithBacklog, autonomy, overseer, evidence);

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

    console.log(JSON.stringify({
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
            ...autonomy.pendingApprovals.slice(0, 3).map(formatPendingArtifact),
            `overseer lastSuccessAt=${overseer.lastSuccessAt} lastFailureAt=${overseer.lastFailureAt} failureCount24h=${overseer.failureCount24h} warnings=${overseer.activeRepeatedWarningCount}`,
            ...overseer.repeatedWarnings.map(formatWarningArtifact),
            ...(overseer.phraseBreathTrend ? [formatPhraseBreathTrendArtifact(overseer.phraseBreathTrend)] : []),
            ...(overseer.harmonicColorTrend ? [formatHarmonicColorTrendArtifact(overseer.harmonicColorTrend)] : []),
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
                    ...(overseer.shadowReranker.retryLocalizationOutcomes
                        && toNumber(overseer.shadowReranker.retryLocalizationOutcomes.retryingManifestCount) > 0
                        ? [formatShadowRerankerRetryLocalizationArtifact(overseer.shadowReranker.retryLocalizationOutcomes)]
                        : []),
                    ...overseer.shadowReranker.recentDisagreements.map(formatShadowRerankerDisagreementArtifact),
                    ...overseer.shadowReranker.recentPromotions.map(formatShadowRerankerPromotionArtifact),
                ]
                : []),
            ...overseer.orchestrationTrends.map(formatOrchestrationTrendArtifact),
        ],
        data: {
            ready: readyResponse.payload,
            jobs: sortedJobs.slice(0, jobLimit),
            recentJobs: sortedJobs.slice(0, jobLimit),
            autonomyStatus: autonomyResponse.payload,
            autonomyOps: autonomyResponse.payload,
            overseerSummary: overseerResponse.payload,
            latestOperatorAction,
        },
    }, null, 2));
}

main().catch((error) => {
    fail("AXIOM operator summary crashed", {
        error: error instanceof Error ? error.message : String(error),
    });
});