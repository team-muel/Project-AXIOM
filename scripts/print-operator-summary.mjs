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

function summarizeLearnedProposalWarningRow(row) {
    const record = toRecord(row) || {};
    return {
        warning: toTrimmed(record.warning),
        count: toNumber(record.count) ?? 0,
        proposalCount: toNumber(record.proposalCount) ?? 0,
        lastSeenAt: toTrimmed(record.lastSeenAt, "") || null,
        lastSongId: toTrimmed(record.lastSongId, "") || null,
    };
}

function summarizeLearnedProposalWarnings(value) {
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

function summarizeCountMap(value) {
    const record = toRecord(value);
    if (!record) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(record)
            .map(([key, entry]) => [key, toNumber(entry) ?? 0])
            .filter(([, entry]) => entry > 0),
    );
}

function summarizeLearnedBackboneBenchmarkFailureModeRow(row) {
    const record = toRecord(row) || {};
    return {
        failureMode: toTrimmed(record.failureMode),
        count: toNumber(record.count) ?? 0,
    };
}

function summarizeLearnedBackboneBenchmarkStopReasonRow(row) {
    const record = toRecord(row) || {};
    return {
        reason: toTrimmed(record.reason),
        count: toNumber(record.count) ?? 0,
    };
}

function summarizeLearnedBackboneBenchmarkCoverageRow(row) {
    const record = toRecord(row) || {};
    return {
        benchmarkKey: toTrimmed(record.benchmarkKey),
        benchmarkId: toTrimmed(record.benchmarkId, "") || null,
        planSignature: toTrimmed(record.planSignature, "") || null,
        lane: toTrimmed(record.lane, "") || null,
        benchmarkPackVersion: toTrimmed(record.benchmarkPackVersion, "") || null,
        runCount: toNumber(record.runCount) ?? 0,
        pairedRunCount: toNumber(record.pairedRunCount) ?? 0,
        reviewedRunCount: toNumber(record.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(record.pendingReviewCount) ?? 0,
        approvalRate: toNumber(record.approvalRate) ?? null,
        averageAppealScore: toNumber(record.averageAppealScore) ?? null,
        selectedWorkerCounts: summarizeCountMap(record.selectedWorkerCounts),
        generationModeCounts: summarizeCountMap(record.generationModeCounts),
        latestObservedAt: toTrimmed(record.latestObservedAt, "") || null,
        songIds: Array.isArray(record.songIds)
            ? record.songIds.map((item) => toTrimmed(item)).filter((item) => item !== "-")
            : [],
    };
}

function summarizeLearnedBackboneBenchmarkSearchBudgetRow(row) {
    const record = toRecord(row) || {};
    return {
        searchBudgetLevel: toTrimmed(record.searchBudgetLevel, "") || null,
        searchBudgetDescriptor: toTrimmed(record.searchBudgetDescriptor, "") || null,
        wholePieceCandidateCount: toNumber(record.wholePieceCandidateCount) ?? 0,
        localizedRewriteBranchCount: toNumber(record.localizedRewriteBranchCount) ?? 0,
        runCount: toNumber(record.runCount) ?? 0,
        pairedRunCount: toNumber(record.pairedRunCount) ?? 0,
        reviewedRunCount: toNumber(record.reviewedRunCount) ?? 0,
        pendingReviewCount: toNumber(record.pendingReviewCount) ?? 0,
        approvalRate: toNumber(record.approvalRate) ?? null,
        averageAppealScore: toNumber(record.averageAppealScore) ?? null,
        blindPreferenceWinRate: toNumber(record.blindPreferenceWinRate) ?? null,
        reviewedPairCount: toNumber(record.reviewedPairCount) ?? 0,
        decisivePairCount: toNumber(record.decisivePairCount) ?? 0,
        selectedTop1Accuracy: toNumber(record.selectedTop1Accuracy) ?? null,
        decisiveReviewedPairCount: toNumber(record.decisiveReviewedPairCount) ?? 0,
        correctSelectionCount: toNumber(record.correctSelectionCount) ?? 0,
        latestObservedAt: toTrimmed(record.latestObservedAt, "") || null,
    };
}

function summarizeLearnedBackboneBenchmarkRecentRunRow(row) {
    const record = toRecord(row) || {};
    return {
        songId: toTrimmed(record.songId),
        benchmarkId: toTrimmed(record.benchmarkId, "") || null,
        planSignature: toTrimmed(record.planSignature, "") || null,
        selectedWorker: toTrimmed(record.selectedWorker, "") || null,
        approvalStatus: toTrimmed(record.approvalStatus, "") || null,
        reviewed: record.reviewed === true,
        appealScore: toNumber(record.appealScore) ?? null,
        disagreementObserved: record.disagreementObserved === true,
        promotionApplied: record.promotionApplied === true,
        selectionMode: toTrimmed(record.selectionMode, "") || null,
        counterfactualWorker: toTrimmed(record.counterfactualWorker, "") || null,
        retryLocalization: toTrimmed(record.retryLocalization, "") || null,
        benchmarkGenerationMode: toTrimmed(record.benchmarkGenerationMode, "") || null,
        selectedGenerationMode: toTrimmed(record.selectedGenerationMode, "") || null,
        selectionStopReason: toTrimmed(record.selectionStopReason, "") || null,
        reviewWeakestDimension: toTrimmed(record.reviewWeakestDimension, "") || null,
        observedAt: toTrimmed(record.observedAt, "") || null,
        wholePieceCandidateCount: toNumber(record.wholePieceCandidateCount) ?? 0,
        localizedRewriteBranchCount: toNumber(record.localizedRewriteBranchCount) ?? 0,
        searchBudgetLevel: toTrimmed(record.searchBudgetLevel, "") || null,
        searchBudgetDescriptor: toTrimmed(record.searchBudgetDescriptor, "") || null,
    };
}

function summarizeLearnedBackboneBenchmarkConfigSnapshot(value) {
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

function summarizeLearnedBackboneBenchmarkReviewSampleStatus(value) {
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

function summarizeLearnedBackboneBenchmarkDisagreementSummary(value) {
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

function summarizeLearnedBackboneBenchmarkRetryLocalizationStability(value) {
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

function summarizeLearnedBackboneBenchmarkBlindPreference(value) {
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

function summarizeLearnedBackboneBenchmarkReviewedTop1Accuracy(value) {
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

function summarizeLearnedBackboneBenchmarkWorkerOutcomeSummary(value) {
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

function summarizeLearnedBackboneBenchmarkWorkerOutcomes(value) {
    const record = toRecord(value);
    if (!record) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(record)
            .map(([worker, summary]) => [toTrimmed(worker, "unknown") || "unknown", summarizeLearnedBackboneBenchmarkWorkerOutcomeSummary(summary)]),
    );
}

function summarizeLearnedBackboneBenchmarkPairedSelectionOutcomes(value) {
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

function summarizeLearnedBackboneBenchmarkReviewQueueRow(value) {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        songId: toTrimmed(record.songId),
        benchmarkId: toTrimmed(record.benchmarkId, "") || null,
        planSignature: toTrimmed(record.planSignature, "") || null,
        reviewTarget: toTrimmed(record.reviewTarget, "") || null,
        selectedWorker: toTrimmed(record.selectedWorker, "") || null,
        counterfactualWorker: toTrimmed(record.counterfactualWorker, "") || null,
        selectionMode: toTrimmed(record.selectionMode, "") || null,
        observedAt: toTrimmed(record.observedAt, "") || null,
        wholePieceCandidateCount: toNumber(record.wholePieceCandidateCount) ?? 0,
        localizedRewriteBranchCount: toNumber(record.localizedRewriteBranchCount) ?? 0,
        searchBudgetLevel: toTrimmed(record.searchBudgetLevel, "") || null,
        searchBudgetDescriptor: toTrimmed(record.searchBudgetDescriptor, "") || null,
        shortlistTopK: toNumber(record.shortlistTopK) ?? null,
        selectedRank: toNumber(record.selectedRank) ?? null,
        selectedInShortlist: record.selectedInShortlist === true,
    };
}

function summarizeLearnedBackboneBenchmarkReviewQueue(value) {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        pendingBlindReviewCount: toNumber(record.pendingBlindReviewCount) ?? 0,
        pendingShortlistReviewCount: toNumber(record.pendingShortlistReviewCount) ?? 0,
        latestPendingAt: toTrimmed(record.latestPendingAt, "") || null,
        recentPendingRows: Array.isArray(record.recentPendingRows)
            ? toRecordArray(record.recentPendingRows).slice(0, 5).map(summarizeLearnedBackboneBenchmarkReviewQueueRow).filter(Boolean)
            : [],
    };
}

function summarizeLearnedBackboneBenchmarkReviewPackRow(value) {
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    return {
        packId: toTrimmed(record.packId),
        generatedAt: toTrimmed(record.generatedAt, "") || null,
        reviewTarget: toTrimmed(record.reviewTarget, "") || null,
        searchBudget: toTrimmed(record.searchBudget, "") || null,
        entryCount: toNumber(record.entryCount) ?? 0,
        completedDecisionCount: toNumber(record.completedDecisionCount) ?? 0,
        pendingDecisionCount: toNumber(record.pendingDecisionCount) ?? 0,
        pendingShortlistDecisionCount: toNumber(record.pendingShortlistDecisionCount) ?? 0,
        latestReviewedAt: toTrimmed(record.latestReviewedAt, "") || null,
        reviewSheetPath: toTrimmed(record.reviewSheetPath, "") || null,
    };
}

function summarizeLearnedBackboneBenchmarkReviewPacks(value) {
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
            ? toRecordArray(record.recentActivePacks).slice(0, 5).map(summarizeLearnedBackboneBenchmarkReviewPackRow).filter(Boolean)
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

function summarizeLearnedBackboneBenchmarkPromotionGate(value) {
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
        positiveSignals: Array.isArray(record.positiveSignals) ? record.positiveSignals.map((item) => toTrimmed(item)).filter((item) => item !== "-") : [],
        negativeSignals: Array.isArray(record.negativeSignals) ? record.negativeSignals.map((item) => toTrimmed(item)).filter((item) => item !== "-") : [],
        blockers: Array.isArray(record.blockers) ? record.blockers.map((item) => toTrimmed(item)).filter((item) => item !== "-") : [],
        rationale: toTrimmed(record.rationale, "") || null,
    };
}

function summarizeLearnedBackboneBenchmark(value) {
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
        reviewQueue,
        reviewPacks,
        reviewPackActions: buildLearnedBackboneBenchmarkReviewPackActions(reviewQueue, reviewPacks, searchBudgetRows),
        reviewPackRecordActions: buildLearnedBackboneBenchmarkReviewPackRecordActions(reviewPacks),
        promotionGate: summarizeLearnedBackboneBenchmarkPromotionGate(record.promotionGate),
        reviewSampleStatus: summarizeLearnedBackboneBenchmarkReviewSampleStatus(record.reviewSampleStatus),
        disagreementSummary: summarizeLearnedBackboneBenchmarkDisagreementSummary(record.disagreementSummary),
        retryLocalizationStability: summarizeLearnedBackboneBenchmarkRetryLocalizationStability(record.retryLocalizationStability),
        selectionModeCounts: summarizeCountMap(record.selectionModeCounts),
        searchBudgetCounts: summarizeCountMap(record.searchBudgetCounts),
        selectedWorkerOutcomes: summarizeLearnedBackboneBenchmarkWorkerOutcomes(record.selectedWorkerOutcomes),
        pairedSelectionOutcomes: summarizeLearnedBackboneBenchmarkPairedSelectionOutcomes(record.pairedSelectionOutcomes),
        promotionAdvantage: summarizeShadowRerankerPromotionAdvantage(record.promotionAdvantage),
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

function formatLearnedProposalWarningArtifact(item) {
    return [
        `learnedProposalWarnings manifests=${toNumber(item.sampledManifestCount) ?? 0}`,
        `proposals=${toNumber(item.proposalCount) ?? 0}`,
        `warningProposals=${toNumber(item.proposalWithWarningsCount) ?? 0}`,
        `warnings=${toNumber(item.totalWarningCount) ?? 0}`,
        `roleCollapse=${toNumber(item.roleCollapseWarningCount) ?? 0}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
    ].join(" ");
}

function formatLearnedProposalWarningRowArtifact(item) {
    return [
        `learnedProposalWarning count=${toNumber(item.count) ?? 0}`,
        `proposals=${toNumber(item.proposalCount) ?? 0}`,
        `lastSeen=${toTrimmed(item.lastSeenAt)}`,
        `song=${toTrimmed(item.lastSongId)}`,
        `warning=${toTrimmed(item.warning)}`,
    ].join(" ");
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

function formatLearnedBackboneBenchmarkArtifact(item) {
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
        `budgets=${formatNamedCountSummary(item.searchBudgetCounts ?? {})}`,
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

function formatLearnedBackboneBenchmarkConfigArtifact(item) {
    return [
        `learnedBackboneBenchmark config lane=${toTrimmed(item.configSnapshot?.lane ?? item.lane)}`,
        `benchmarkIds=${item.configSnapshot?.benchmarkIds?.length ? item.configSnapshot.benchmarkIds.join(",") : "none"}`,
        `promptPacks=${formatNamedCountSummary(item.configSnapshot?.promptPackVersionCounts)}`,
        `reviewRubrics=${formatNamedCountSummary(item.configSnapshot?.reviewRubricVersionCounts)}`,
        `generationModes=${formatNamedCountSummary(item.configSnapshot?.generationModeCounts)}`,
        `workflows=${formatNamedCountSummary(item.configSnapshot?.workflowCounts)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkBlindPreferenceArtifact(item) {
    return [
        "learnedBackboneBenchmark blindPreference",
        `available=${item.blindPreference?.available === true ? "yes" : "no"}`,
        `winRate=${formatOrchestrationMetric(item.blindPreference?.winRate)}`,
        `reviewedPairs=${toNumber(item.blindPreference?.reviewedPairCount) ?? 0}`,
        `decisivePairs=${toNumber(item.blindPreference?.decisivePairCount) ?? 0}`,
        `learnedWins=${toNumber(item.blindPreference?.learnedWinCount) ?? 0}`,
        `baselineWins=${toNumber(item.blindPreference?.baselineWinCount) ?? 0}`,
        `ties=${toNumber(item.blindPreference?.tieCount) ?? 0}`,
        `latestReviewedAt=${toTrimmed(item.blindPreference?.latestReviewedAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkShortlistBlindPreferenceArtifact(item) {
    return [
        "learnedBackboneBenchmark shortlistBlindPreference",
        `available=${item.shortlistBlindPreference?.available === true ? "yes" : "no"}`,
        `winRate=${formatOrchestrationMetric(item.shortlistBlindPreference?.winRate)}`,
        `reviewedPairs=${toNumber(item.shortlistBlindPreference?.reviewedPairCount) ?? 0}`,
        `decisivePairs=${toNumber(item.shortlistBlindPreference?.decisivePairCount) ?? 0}`,
        `learnedWins=${toNumber(item.shortlistBlindPreference?.learnedWinCount) ?? 0}`,
        `baselineWins=${toNumber(item.shortlistBlindPreference?.baselineWinCount) ?? 0}`,
        `ties=${toNumber(item.shortlistBlindPreference?.tieCount) ?? 0}`,
        `latestReviewedAt=${toTrimmed(item.shortlistBlindPreference?.latestReviewedAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkTop1AccuracyArtifact(item) {
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

function formatLearnedBackboneBenchmarkPairedSelectionArtifact(item) {
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

function formatLearnedBackboneBenchmarkSelectedWorkerOutcomeArtifact(worker, item) {
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

function formatLearnedBackboneBenchmarkCoverageArtifact(item) {
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

function formatLearnedBackboneBenchmarkReviewQueueArtifact(item) {
    return [
        "learnedBackboneBenchmark reviewQueue",
        `pendingBlind=${toNumber(item.reviewQueue?.pendingBlindReviewCount) ?? 0}`,
        `pendingShortlist=${toNumber(item.reviewQueue?.pendingShortlistReviewCount) ?? 0}`,
        `latestPendingAt=${toTrimmed(item.reviewQueue?.latestPendingAt)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkReviewPacksArtifact(item) {
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

function formatLearnedBackboneBenchmarkReviewQueueRowArtifact(item) {
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

function formatLearnedBackboneBenchmarkReviewPackArtifact(item) {
    const reviewSheetPath = toTrimmed(item.reviewSheetPath) || "-";
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

function formatLearnedBackboneBenchmarkReviewPackActionArtifact(item) {
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

function formatLearnedBackboneBenchmarkReviewPackRecordActionArtifact(item) {
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

function formatLearnedBackboneBenchmarkSearchBudgetArtifact(item) {
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

function formatLearnedBackboneBenchmarkPromotionGateArtifact(item) {
    return [
        "learnedBackboneBenchmark promotionGate",
        `status=${toTrimmed(item.promotionGate?.status)}`,
        `signal=${toTrimmed(item.promotionGate?.signal)}`,
        `reviewedFloor=${item.promotionGate?.meetsReviewedRunMinimum === true ? "yes" : "no"}`,
        `disagreementFloor=${item.promotionGate?.meetsReviewedDisagreementMinimum === true ? "yes" : "no"}`,
        `shortlistFloor=${item.promotionGate?.meetsReviewedSelectedInShortlistMinimum === true ? "yes" : "no"}`,
        `retryStable=${item.promotionGate?.retryLocalizationStable === true ? "yes" : "no"}`,
        `blindPreference=${item.promotionGate?.blindPreferenceAvailable === true ? "yes" : "no"}`,
        `reviewedInTopK=${formatOrchestrationMetric(item.promotionGate?.reviewedSelectedInShortlistRate)}`,
        `reviewedTop1=${formatOrchestrationMetric(item.promotionGate?.reviewedSelectedTop1Rate)}`,
        `shortlistMin=${formatOrchestrationMetric(item.promotionGate?.minimumReviewedSelectedInShortlistRate)}`,
        `approvalDelta=${formatOrchestrationMetric(item.promotionGate?.approvalRateDelta)}`,
        `appealDelta=${formatOrchestrationMetric(item.promotionGate?.appealScoreDelta)}`,
        `blockers=${item.promotionGate?.blockers?.length ? item.promotionGate.blockers.join(",") : "none"}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkFailureModeArtifact(item) {
    return [
        `learnedBackboneBenchmark failureMode=${toTrimmed(item.failureMode)}`,
        `count=${toNumber(item.count) ?? 0}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkStopReasonArtifact(item) {
    return [
        `learnedBackboneBenchmark stopReason count=${toNumber(item.count) ?? 0}`,
        `reason=${toTrimmed(item.reason)}`,
    ].join(" ");
}

function formatLearnedBackboneBenchmarkRecentRunArtifact(item) {
    const searchBudget = toTrimmed(item.searchBudgetDescriptor, "") || toTrimmed(item.searchBudgetLevel);
    return [
        `learnedBackboneBenchmark recent song=${toTrimmed(item.songId)}`,
        `benchmark=${toTrimmed(item.benchmarkId)}`,
        `searchBudget=${searchBudget}`,
        `candidates=${toNumber(item.wholePieceCandidateCount) ?? 0}`,
        `selectedWorker=${toTrimmed(item.selectedWorker)}`,
        `approval=${toTrimmed(item.approvalStatus)}`,
        `selectionMode=${toTrimmed(item.selectionMode)}`,
        `disagreement=${item.disagreementObserved === true ? "yes" : "no"}`,
        `promotion=${item.promotionApplied === true ? "yes" : "no"}`,
        `retry=${toTrimmed(item.retryLocalization)}`,
        `weakest=${toTrimmed(item.reviewWeakestDimension)}`,
        `observedAt=${toTrimmed(item.observedAt)}`,
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
        learnedProposalWarnings: summarizeLearnedProposalWarnings(manifestAudioRetry?.learnedProposalWarnings),
        learnedBackboneBenchmark: summarizeLearnedBackboneBenchmark(manifestAudioRetry?.learnedBackboneBenchmark),
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
            ...(overseer.learnedProposalWarnings && toNumber(overseer.learnedProposalWarnings.proposalCount) > 0
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
                    ...(overseer.shadowReranker.retryLocalizationOutcomes
                        && toNumber(overseer.shadowReranker.retryLocalizationOutcomes.retryingManifestCount) > 0
                        ? [formatShadowRerankerRetryLocalizationArtifact(overseer.shadowReranker.retryLocalizationOutcomes)]
                        : []),
                    ...overseer.shadowReranker.recentDisagreements.map(formatShadowRerankerDisagreementArtifact),
                    ...overseer.shadowReranker.recentPromotions.map(formatShadowRerankerPromotionArtifact),
                ]
                : []),
            ...(overseer.learnedBackboneBenchmark && toNumber(overseer.learnedBackboneBenchmark.runCount) > 0
                ? [
                    formatLearnedBackboneBenchmarkArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkConfigArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkBlindPreferenceArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkShortlistBlindPreferenceArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkTop1AccuracyArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkPairedSelectionArtifact(overseer.learnedBackboneBenchmark),
                    ...Object.entries(overseer.learnedBackboneBenchmark.selectedWorkerOutcomes ?? {})
                        .sort((left, right) => (
                            (toNumber(right[1].runCount) ?? 0) - (toNumber(left[1].runCount) ?? 0)
                            || left[0].localeCompare(right[0])
                        ))
                        .map(([worker, summary]) => formatLearnedBackboneBenchmarkSelectedWorkerOutcomeArtifact(worker, summary)),
                    ...(overseer.learnedBackboneBenchmark.coverageRows ?? []).map(formatLearnedBackboneBenchmarkCoverageArtifact),
                    formatLearnedBackboneBenchmarkReviewQueueArtifact(overseer.learnedBackboneBenchmark),
                    formatLearnedBackboneBenchmarkReviewPacksArtifact(overseer.learnedBackboneBenchmark),
                    ...(overseer.learnedBackboneBenchmark.reviewQueue?.recentPendingRows ?? []).map(formatLearnedBackboneBenchmarkReviewQueueRowArtifact),
                    ...(overseer.learnedBackboneBenchmark.reviewPacks?.recentActivePacks ?? []).map(formatLearnedBackboneBenchmarkReviewPackArtifact),
                    ...(overseer.learnedBackboneBenchmark.reviewPackRecordActions ?? []).map(formatLearnedBackboneBenchmarkReviewPackRecordActionArtifact),
                    ...(overseer.learnedBackboneBenchmark.reviewPackActions ?? []).map(formatLearnedBackboneBenchmarkReviewPackActionArtifact),
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