import {
    getAutonomyOperationalSummary,
    isAutonomyUnavailableError,
    reconcileAutonomyLock,
    triggerAutonomyRun,
} from "../autonomy/controller.js";
import { getAutonomySchedulerStatus } from "../autonomy/scheduler.js";
import {
    approveAutonomySong,
    getAutonomyStatus,
    isAutonomyConflictError,
    listPendingApprovalSummaries,
    pauseAutonomy,
    previewAutonomyPlan,
    rejectAutonomySong,
    resumeAutonomy,
} from "../autonomy/service.js";
import { normalizeComposeRequestInput } from "../pipeline/requestNormalization.js";
import { enqueue, getJob, listJobs } from "../queue/jobQueue.js";
import { serializeQueuedJob } from "../queue/presentation.js";
import { checkOllamaReachable, runOverseer } from "../overseer/index.js";
import { getOverseerSchedulerStatus } from "../overseer/scheduler.js";
import {
    getLastOverseerReportPath,
    getOverseerHistoryDir,
    isValidOverseerHistoryDayKey,
    loadLastOverseerReport,
    loadOverseerHistory,
    summarizeOverseerHistory,
} from "../overseer/storage.ts";
import { loadManifest, listStoredManifests } from "../memory/manifest.js";
import { buildManifestOperationalSummary, summarizeManifestTracking } from "../memory/manifestAnalytics.js";
import { buildOperatorSummary } from "../operator/summary.js";
import type { McpToolCallRequest, McpToolCallResult, McpToolInputSchema, McpToolSpec } from "./types.js";

const compact = (value: unknown): string => String(value ?? "").trim();

const toObject = (value: unknown): Record<string, unknown> => {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
};

const toNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
};

const toTextResult = (text: string, isError = false): McpToolCallResult => ({
    content: [{ type: "text", text }],
    isError,
});

const toJsonResult = (value: unknown, isError = false): McpToolCallResult => {
    return toTextResult(JSON.stringify(value, null, 2), isError);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

function prependRequiredHint(schema: Record<string, unknown>): Record<string, unknown> {
    const description = typeof schema.description === "string" ? schema.description.trim() : "";
    if (/^필수\.?\s*/.test(description)) {
        return { ...schema };
    }

    return {
        ...schema,
        description: description ? `필수. ${description}` : "필수.",
    };
}

function toTransportToolName(name: string): string {
    return compact(name).replaceAll(".", "_");
}

function normalizeMcpToolName(name: string): string {
    return toTransportToolName(compact(name).toLowerCase());
}

function sanitizeSchemaForMcpTransport(schema: Record<string, unknown>): McpToolInputSchema {
    const sanitized: Record<string, unknown> = {};
    const requiredKeys = Array.isArray(schema.required)
        ? schema.required.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : [];

    for (const [key, value] of Object.entries(schema)) {
        if (key === "required") {
            continue;
        }

        if (key === "properties" && isPlainObject(value)) {
            const nextProperties: Record<string, unknown> = {};
            for (const [propertyName, propertyValue] of Object.entries(value)) {
                if (!isPlainObject(propertyValue)) {
                    nextProperties[propertyName] = propertyValue;
                    continue;
                }

                const propertySchema = sanitizeSchemaForMcpTransport(propertyValue);
                nextProperties[propertyName] = requiredKeys.includes(propertyName)
                    ? prependRequiredHint(propertySchema)
                    : propertySchema;
            }
            sanitized[key] = nextProperties;
            continue;
        }

        if (key === "items" && isPlainObject(value)) {
            sanitized[key] = sanitizeSchemaForMcpTransport(value);
            continue;
        }

        sanitized[key] = value;
    }

    return sanitized as McpToolInputSchema;
}

function toDate(value: unknown): Date | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    const parsed = Date.parse(compact(value));
    if (!Number.isFinite(parsed)) {
        return new Date(Number.NaN);
    }

    return new Date(parsed);
}

const MODEL_BINDING_TRANSPORT_SCHEMA = {
    type: "string",
    description: "optional JSON array of { role, provider, model, version } bindings",
};

const INSTRUMENT_ASSIGNMENT_TRANSPORT_SCHEMA = {
    type: "string",
    description: "optional JSON array of { name, family, roles, register } entries; roles may be string[] or a comma-separated string",
};

const MCP_TOOLS: McpToolSpec[] = [
    {
        name: "axiom.compose",
        description: "클래식 음악 작곡 작업을 큐에 등록합니다. MusicGen-large 경로도 자동 선택됩니다.",
        inputSchema: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "작곡 프롬프트" },
                key: { type: "string", description: "예: D minor" },
                tempo: { type: "number", description: "템포 BPM" },
                form: { type: "string", description: "예: nocturne, largo, symphony" },
                durationSec: { type: "number", description: "MusicGen 오디오 길이(초)" },
                workflow: { type: "string", description: "symbolic_only | symbolic_plus_audio | audio_only" },
                plannerVersion: { type: "string", description: "planner schema version" },
                selectedModels: MODEL_BINDING_TRANSPORT_SCHEMA,
                targetInstrumentation: INSTRUMENT_ASSIGNMENT_TRANSPORT_SCHEMA,
                compositionProfile: { type: "object", description: "symbolic contour, density, tension hints" },
                compositionPlan: { type: "object", description: "full multi-section composition plan" },
                evaluationPolicy: { type: "object", description: "evaluation gating policy" },
                qualityPolicy: { type: "object", description: "auto-revision and structure score targets" },
            },
            required: ["prompt"],
            additionalProperties: false,
        },
    },
    {
        name: "axiom.job.get",
        description: "작곡 작업 상태와 산출물, key route tracking 요약, rendered key label/path를 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "조회할 작업 ID" },
            },
            required: ["jobId"],
            additionalProperties: false,
        },
    },
    {
        name: "axiom.job.list",
        description: "최근 작업 목록과 각 작업의 key route tracking 요약, rendered key label/path를 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "반환할 작업 수(기본 10, 최대 50)" },
            },
            additionalProperties: false,
        },
    },
    {
        name: "axiom.manifest.get",
        description: "저장된 manifest와 weakestSections, sectionTransforms, sectionTonalities, audio harmonic-route 추적값, rendered key label/path를 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {
                songId: { type: "string", description: "조회할 songId" },
            },
            required: ["songId"],
            additionalProperties: false,
        },
    },
    {
        name: "axiom.manifest.list",
        description: "저장된 manifest의 key route 추적 요약과 audio retry directive 조합 통계, 최근 7일/30일 시계열을 newest-first로 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "반환할 최대 개수(기본 10, 최대 50)" },
            },
            additionalProperties: false,
        },
    },
    {
        name: "axiom.overseer.report",
        description: "Gemma 4가 최근 로그와 manifest를 읽고 운영 리포트를 생성합니다.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: "axiom.overseer.status",
        description: "Gemma 4 연결 상태와 자동 피드백 루프 상태를 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: "axiom.overseer.last_report",
        description: "가장 최근에 자동 저장된 Overseer 리포트를 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: "axiom.overseer.history",
        description: "자동 저장된 Overseer 리포트 히스토리를 newest-first로 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {
                dayKey: { type: "string", description: "YYYY-MM-DD 형식의 특정 일자" },
                limit: { type: "number", description: "반환할 최대 개수(기본 20, 최대 200)" },
            },
            additionalProperties: false,
        },
    },
    {
        name: "axiom.overseer.summary",
        description: "최근 Overseer 히스토리와 manifest audio retry 운영 지표를 함께 요약합니다.",
        inputSchema: {
            type: "object",
            properties: {
                windowHours: { type: "number", description: "요약 윈도우 시간(기본 24)" },
                limit: { type: "number", description: "분석할 최대 히스토리 개수(기본 200)" },
                now: { type: "string", description: "선택적 기준 시각 ISO timestamp" },
            },
            additionalProperties: false,
        },
    },
    {
        name: "axiom.operator.summary",
        description: "readiness, queue backlog, autonomy ops, Overseer 요약을 하나의 canonical operator summary로 반환합니다.",
        inputSchema: {
            type: "object",
            properties: {
                namespace: { type: "string", description: "summary namespace label (기본 axiom)" },
                source: { type: "string", description: "local-runtime | bridge | gcpCompute 같은 소비 경로 label" },
                jobLimit: { type: "number", description: "recent jobs/artifacts에 포함할 최대 작업 수(기본 5, 최대 20)" },
                windowHours: { type: "number", description: "Overseer summary window hours (기본 24)" },
            },
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.status",
        description: "autonomy 상태, scheduler 상태, pending approval 목록을 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.ops",
        description: "daily cap, stale lock, queue 요약이 포함된 운영 상태를 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.pending",
        description: "승인 대기 중인 autonomy 곡 목록을 조회합니다.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "반환할 최대 개수(기본 20)" },
            },
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.preview",
        description: "autonomy planner가 다음 작곡 초안을 생성합니다.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.trigger",
        description: "autonomy planner가 실제 작곡 run을 생성하고 queue에 넣습니다.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.pause",
        description: "autonomy 자동 실행을 일시 중지합니다.",
        inputSchema: {
            type: "object",
            properties: {
                reason: { type: "string", description: "중지 사유" },
                actor: { type: "string", description: "audit trail에 남길 operator 식별자" },
                approvedBy: { type: "string", description: "승인 주체 또는 상위 승인자" },
                rollbackNote: { type: "string", description: "되돌림 기준 또는 rollback 메모" },
                manualRecoveryNote: { type: "string", description: "수동 복구 절차 메모" },
            },
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.resume",
        description: "autonomy 자동 실행을 재개합니다.",
        inputSchema: {
            type: "object",
            properties: {
                actor: { type: "string", description: "audit trail에 남길 operator 식별자" },
                approvedBy: { type: "string", description: "승인 주체 또는 상위 승인자" },
                rollbackNote: { type: "string", description: "되돌림 기준 또는 rollback 메모" },
                manualRecoveryNote: { type: "string", description: "수동 복구 절차 메모" },
            },
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.reconcile_lock",
        description: "stale autonomy lock을 즉시 정리하고 recovery 결과를 반환합니다.",
        inputSchema: {
            type: "object",
            properties: {
                reason: { type: "string", description: "정리 요청 사유" },
                actor: { type: "string", description: "audit trail에 남길 operator 식별자" },
                approvedBy: { type: "string", description: "승인 주체 또는 상위 승인자" },
                rollbackNote: { type: "string", description: "되돌림 기준 또는 rollback 메모" },
                manualRecoveryNote: { type: "string", description: "수동 복구 절차 메모" },
            },
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.approve",
        description: "승인 대기 중인 autonomy 곡을 승인합니다.",
        inputSchema: {
            type: "object",
            properties: {
                songId: { type: "string", description: "승인할 songId" },
                note: { type: "string", description: "승인 메모" },
                actor: { type: "string", description: "audit trail에 남길 operator 식별자" },
                approvedBy: { type: "string", description: "승인 주체 또는 상위 승인자" },
                rollbackNote: { type: "string", description: "되돌림 기준 또는 rollback 메모" },
                manualRecoveryNote: { type: "string", description: "수동 복구 절차 메모" },
                appealScore: { type: "number", description: "사람 기준 매력도 점수 (예: 0-10)" },
                strongestDimension: { type: "string", description: "가장 좋았던 음악적 요소" },
                weakestDimension: { type: "string", description: "가장 약했던 음악적 요소" },
                comparisonReference: { type: "string", description: "비교 기준이 된 다른 곡 또는 run" },
            },
            required: ["songId"],
            additionalProperties: false,
        },
    },
    {
        name: "axiom.autonomy.reject",
        description: "승인 대기 중인 autonomy 곡을 반려합니다.",
        inputSchema: {
            type: "object",
            properties: {
                songId: { type: "string", description: "반려할 songId" },
                reason: { type: "string", description: "반려 사유" },
                actor: { type: "string", description: "audit trail에 남길 operator 식별자" },
                approvedBy: { type: "string", description: "승인 주체 또는 상위 승인자" },
                rollbackNote: { type: "string", description: "되돌림 기준 또는 rollback 메모" },
                manualRecoveryNote: { type: "string", description: "수동 복구 절차 메모" },
                appealScore: { type: "number", description: "사람 기준 매력도 점수 (예: 0-10)" },
                strongestDimension: { type: "string", description: "상대적으로 유지된 장점" },
                weakestDimension: { type: "string", description: "가장 약했던 음악적 요소" },
                comparisonReference: { type: "string", description: "비교 기준이 된 다른 곡 또는 run" },
            },
            required: ["songId"],
            additionalProperties: false,
        },
    },
];

export const listMcpTools = (): McpToolSpec[] => {
    return MCP_TOOLS.map((tool) => ({
        ...tool,
        name: toTransportToolName(tool.name),
        inputSchema: sanitizeSchemaForMcpTransport(tool.inputSchema),
    }));
};

export async function callMcpTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
    const toolName = normalizeMcpToolName(request.name);
    const args = toObject(request.arguments);

    if (toolName === "axiom_compose") {
        const normalized = normalizeComposeRequestInput(args, "api");
        if (!normalized.request) {
            return toTextResult(normalized.errors.join("; ") || "invalid compose request", true);
        }

        const job = enqueue(normalized.request);
        return toJsonResult({
            ...serializeQueuedJob(job),
            pollPath: `/compose/${job.jobId}`,
        });
    }

    if (toolName === "axiom_job_get") {
        const jobId = compact(args.jobId);
        if (!jobId) {
            return toTextResult("jobId is required", true);
        }

        const job = getJob(jobId);
        if (!job) {
            return toTextResult(`job not found: ${jobId}`, true);
        }

        return toJsonResult(serializeQueuedJob(job));
    }

    if (toolName === "axiom_job_list") {
        const requestedLimit = toNumber(args.limit) ?? 10;
        const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 50);
        const jobs = listJobs()
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .slice(0, limit)
            .map((job) => serializeQueuedJob(job));

        return toJsonResult(jobs);
    }

    if (toolName === "axiom_manifest_get") {
        const songId = compact(args.songId);
        if (!songId) {
            return toTextResult("songId is required", true);
        }

        const manifest = loadManifest(songId);
        if (!manifest) {
            return toTextResult(`manifest not found: ${songId}`, true);
        }

        return toJsonResult({
            manifest,
            tracking: summarizeManifestTracking(manifest),
        });
    }

    if (toolName === "axiom_manifest_list") {
        const requestedLimit = toNumber(args.limit) ?? 10;
        const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 50);
        const manifests = listStoredManifests(undefined, { hydrateSectionArtifacts: true });
        const now = toDate(args.now);
        if (args.now !== undefined && (!now || Number.isNaN(now.getTime()))) {
            return toTextResult("now must be a valid ISO timestamp", true);
        }

        const operationalSummary = buildManifestOperationalSummary(manifests, now);
        return toJsonResult({
            totalCount: manifests.length,
            items: manifests.slice(0, limit).map((manifest) => summarizeManifestTracking(manifest)),
            audioRetryStats: operationalSummary.audioRetryStats,
            audioRetryWindows: operationalSummary.audioRetryWindows,
            audioRetryBreakdowns: operationalSummary.audioRetryBreakdowns,
        });
    }

    if (toolName === "axiom_overseer_report") {
        const report = await runOverseer();
        return toJsonResult(report);
    }

    if (toolName === "axiom_overseer_status") {
        const reachable = await checkOllamaReachable();
        const lastReport = loadLastOverseerReport();
        return toJsonResult({
            reachable,
            scheduler: getOverseerSchedulerStatus(),
            stored: {
                available: Boolean(lastReport),
                filePath: getLastOverseerReportPath(),
                generatedAt: lastReport?.generatedAt,
                historyDir: getOverseerHistoryDir(),
            },
        });
    }

    if (toolName === "axiom_overseer_last_report") {
        const filePath = getLastOverseerReportPath();
        const report = loadLastOverseerReport();

        if (!report) {
            return toJsonResult({
                error: "No stored automatic Overseer report found yet.",
                filePath,
                scheduler: getOverseerSchedulerStatus(),
            }, true);
        }

        return toJsonResult({
            filePath,
            report,
            scheduler: getOverseerSchedulerStatus(),
        });
    }

    if (toolName === "axiom_overseer_history") {
        const dayKey = compact(args.dayKey) || undefined;
        if (dayKey && !isValidOverseerHistoryDayKey(dayKey)) {
            return toTextResult("dayKey must be YYYY-MM-DD", true);
        }

        const limit = toNumber(args.limit);
        if (args.limit !== undefined && (limit === undefined || limit < 1)) {
            return toTextResult("limit must be a positive number", true);
        }

        return toJsonResult({
            ...loadOverseerHistory({ dayKey, limit }),
            scheduler: getOverseerSchedulerStatus(),
        });
    }

    if (toolName === "axiom_overseer_summary") {
        const windowHours = toNumber(args.windowHours);
        if (args.windowHours !== undefined && (windowHours === undefined || windowHours <= 0)) {
            return toTextResult("windowHours must be a positive number", true);
        }

        const limit = toNumber(args.limit);
        if (args.limit !== undefined && (limit === undefined || limit < 1)) {
            return toTextResult("limit must be a positive number", true);
        }

        const now = toDate(args.now);
        if (args.now !== undefined && (!now || Number.isNaN(now.getTime()))) {
            return toTextResult("now must be a valid ISO timestamp", true);
        }

        return toJsonResult({
            ...summarizeOverseerHistory({ windowHours, limit, now }),
            manifestAudioRetry: buildManifestOperationalSummary(
                listStoredManifests(undefined, { hydrateSectionArtifacts: true }),
                now,
                { shadowHistoryWindowHours: windowHours },
            ),
        });
    }

    if (toolName === "axiom_operator_summary") {
        const jobLimit = toNumber(args.jobLimit);
        if (args.jobLimit !== undefined && (jobLimit === undefined || jobLimit <= 0)) {
            return toTextResult("jobLimit must be a positive number", true);
        }

        const windowHours = toNumber(args.windowHours);
        if (args.windowHours !== undefined && (windowHours === undefined || windowHours <= 0)) {
            return toTextResult("windowHours must be a positive number", true);
        }

        return toJsonResult(await buildOperatorSummary({
            namespace: compact(args.namespace) || undefined,
            source: compact(args.source) || undefined,
            jobLimit,
            windowHours,
        }));
    }

    if (toolName === "axiom_autonomy_status") {
        const reachable = await checkOllamaReachable();
        const status = await getAutonomyStatus();
        return toJsonResult({
            reachable,
            ...status,
            scheduler: getAutonomySchedulerStatus(),
            operations: getAutonomyOperationalSummary(),
        });
    }

    if (toolName === "axiom_autonomy_ops") {
        const reachable = await checkOllamaReachable();
        const status = await getAutonomyStatus();
        return toJsonResult({
            reachable,
            paused: status.paused,
            pauseReason: status.pauseReason,
            activeRun: status.activeRun,
            feedbackHighlights: status.feedbackHighlights,
            pendingApprovalCount: status.pendingApprovalCount,
            pendingApprovals: status.pendingApprovals,
            lastRun: status.lastRun,
            scheduler: getAutonomySchedulerStatus(),
            operations: getAutonomyOperationalSummary(),
        });
    }

    if (toolName === "axiom_autonomy_pending") {
        const limit = Math.min(Math.max(Math.trunc(toNumber(args.limit) ?? 20), 1), 50);
        return toJsonResult(listPendingApprovalSummaries(limit));
    }

    if (toolName === "axiom_autonomy_preview") {
        const reachable = await checkOllamaReachable();
        if (!reachable) {
            return toTextResult("Ollama is not reachable. Is it running?", true);
        }

        return toJsonResult(await previewAutonomyPlan());
    }

    if (toolName === "axiom_autonomy_trigger") {
        try {
            return toJsonResult(await triggerAutonomyRun("mcp"));
        } catch (error) {
            if (isAutonomyConflictError(error)) {
                return toJsonResult({ error: error.message, ...(error.details ?? {}) }, true);
            }

            if (isAutonomyUnavailableError(error)) {
                return toJsonResult({ error: error.message }, true);
            }

            throw error;
        }
    }

    if (toolName === "axiom_autonomy_pause") {
        return toJsonResult(pauseAutonomy(compact(args.reason) || undefined, {
            surface: "mcp",
            actor: compact(args.actor) || undefined,
            approvedBy: compact(args.approvedBy) || undefined,
            rollbackNote: compact(args.rollbackNote) || undefined,
            manualRecoveryNote: compact(args.manualRecoveryNote) || undefined,
        }));
    }

    if (toolName === "axiom_autonomy_resume") {
        return toJsonResult(resumeAutonomy({
            surface: "mcp",
            actor: compact(args.actor) || undefined,
            approvedBy: compact(args.approvedBy) || undefined,
            rollbackNote: compact(args.rollbackNote) || undefined,
            manualRecoveryNote: compact(args.manualRecoveryNote) || undefined,
        }));
    }

    if (toolName === "axiom_autonomy_reconcile_lock") {
        return toJsonResult(await reconcileAutonomyLock(compact(args.reason) || "mcp", true, {
            surface: "mcp",
            actor: compact(args.actor) || undefined,
            approvedBy: compact(args.approvedBy) || undefined,
            rollbackNote: compact(args.rollbackNote) || undefined,
            manualRecoveryNote: compact(args.manualRecoveryNote) || undefined,
        }));
    }

    if (toolName === "axiom_autonomy_approve") {
        const songId = compact(args.songId);
        if (!songId) {
            return toTextResult("songId is required", true);
        }

        try {
            const manifest = approveAutonomySong(songId, {
                note: compact(args.note) || undefined,
                appealScore: toNumber(args.appealScore),
                strongestDimension: compact(args.strongestDimension) || undefined,
                weakestDimension: compact(args.weakestDimension) || undefined,
                comparisonReference: compact(args.comparisonReference) || undefined,
            }, {
                surface: "mcp",
                actor: compact(args.actor) || undefined,
                approvedBy: compact(args.approvedBy) || undefined,
                rollbackNote: compact(args.rollbackNote) || undefined,
                manualRecoveryNote: compact(args.manualRecoveryNote) || undefined,
            });
            if (!manifest) {
                return toTextResult(`manifest not found: ${songId}`, true);
            }

            return toJsonResult({
                songId: manifest.songId,
                approvalStatus: manifest.approvalStatus,
                evaluationSummary: manifest.evaluationSummary,
                reviewFeedback: manifest.reviewFeedback,
            });
        } catch (error) {
            if (isAutonomyConflictError(error)) {
                return toJsonResult({ error: error.message, ...(error.details ?? {}) }, true);
            }
            throw error;
        }
    }

    if (toolName === "axiom_autonomy_reject") {
        const songId = compact(args.songId);
        if (!songId) {
            return toTextResult("songId is required", true);
        }

        try {
            const manifest = rejectAutonomySong(songId, {
                note: compact(args.reason) || undefined,
                appealScore: toNumber(args.appealScore),
                strongestDimension: compact(args.strongestDimension) || undefined,
                weakestDimension: compact(args.weakestDimension) || undefined,
                comparisonReference: compact(args.comparisonReference) || undefined,
            }, {
                surface: "mcp",
                actor: compact(args.actor) || undefined,
                approvedBy: compact(args.approvedBy) || undefined,
                rollbackNote: compact(args.rollbackNote) || undefined,
                manualRecoveryNote: compact(args.manualRecoveryNote) || undefined,
            });
            if (!manifest) {
                return toTextResult(`manifest not found: ${songId}`, true);
            }

            return toJsonResult({
                songId: manifest.songId,
                approvalStatus: manifest.approvalStatus,
                evaluationSummary: manifest.evaluationSummary,
                reviewFeedback: manifest.reviewFeedback,
            });
        } catch (error) {
            if (isAutonomyConflictError(error)) {
                return toJsonResult({ error: error.message, ...(error.details ?? {}) }, true);
            }
            throw error;
        }
    }

    return toTextResult(`unknown tool: ${request.name}`, true);
}