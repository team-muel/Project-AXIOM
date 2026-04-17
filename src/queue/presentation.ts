import type {
    AudioLongSpanEvaluationSummary,
    AudioEvaluationReport,
    ComposeQualityPolicy,
    ComposeWorkflow,
    JobManifest,
    LongSpanDivergenceSummary,
    LongSpanEvaluationSummary,
    QualityAttemptRecord,
    QualityControlReport,
    StructureEvaluationReport,
} from "../pipeline/types.js";
import { summarizeLongSpanDivergence } from "../pipeline/longSpan.js";
import { summarizeManifestTracking } from "../memory/manifestAnalytics.js";
import type { ManifestTrackingSummary } from "../memory/manifestAnalytics.js";
import type { QueuedJob } from "./jobQueue.js";

export interface SerializedQualityTargetContract {
    configuredScore: number | null;
    requestedScore: number | null;
    enforced: boolean;
    enforcementMode: "explicit_only" | "audio_only_or_explicit" | "never";
}

export interface SerializedQualityPolicyView {
    requested: ComposeQualityPolicy | null;
    effective: ComposeQualityPolicy | null;
    targets: {
        structure: SerializedQualityTargetContract;
        audio: SerializedQualityTargetContract;
    };
}

export interface SerializedJobQualitySummary {
    policy: SerializedQualityPolicyView | null;
    attemptCount: number;
    attempts: QualityAttemptRecord[];
    selectedAttempt: number | null;
    stopReason: string | null;
    structurePassed: boolean | null;
    structureScore: number | null;
    longSpan: LongSpanEvaluationSummary | null;
    longSpanDivergence: LongSpanDivergenceSummary | null;
    audioPassed: boolean | null;
    audioScore: number | null;
    audioLongSpan: AudioLongSpanEvaluationSummary | null;
}

export interface SerializedJobEvaluations {
    structure: StructureEvaluationReport | null;
    audio: AudioEvaluationReport | null;
}

export interface SerializedQueuedJob {
    jobId: string;
    status: QueuedJob["status"];
    attempts: number;
    maxAttempts: number;
    createdAt: string;
    updatedAt: string;
    nextAttemptAt?: string;
    error?: string;
    promptHash?: string;
    songId?: string;
    workflow?: ComposeWorkflow;
    request: QueuedJob["request"];
    manifest: JobManifest | null;
    tracking: ManifestTrackingSummary | null;
    qualityPolicy: SerializedQualityPolicyView | null;
    qualityControl: QualityControlReport | null;
    quality: SerializedJobQualitySummary;
    evaluations: SerializedJobEvaluations;
}

function toJsonClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function buildQualityPolicyView(
    job: QueuedJob,
    workflow: ComposeWorkflow | undefined,
    effectivePolicy: ComposeQualityPolicy | null,
): SerializedQualityPolicyView | null {
    const requestedPolicy = job.request.qualityPolicy ?? null;
    if (!requestedPolicy && !effectivePolicy) {
        return null;
    }

    const structureRequested = typeof requestedPolicy?.targetStructureScore === "number"
        ? requestedPolicy.targetStructureScore
        : null;
    const audioRequested = typeof requestedPolicy?.targetAudioScore === "number"
        ? requestedPolicy.targetAudioScore
        : null;

    return {
        requested: requestedPolicy,
        effective: effectivePolicy,
        targets: {
            structure: {
                configuredScore: typeof effectivePolicy?.targetStructureScore === "number" ? effectivePolicy.targetStructureScore : null,
                requestedScore: structureRequested,
                enforced: structureRequested !== null,
                enforcementMode: effectivePolicy?.targetStructureScore === undefined ? "never" : "explicit_only",
            },
            audio: {
                configuredScore: typeof effectivePolicy?.targetAudioScore === "number" ? effectivePolicy.targetAudioScore : null,
                requestedScore: audioRequested,
                enforced: workflow === "audio_only" || audioRequested !== null,
                enforcementMode: effectivePolicy?.targetAudioScore === undefined
                    ? "never"
                    : "audio_only_or_explicit",
            },
        },
    };
}

export function serializeQueuedJob(job: QueuedJob): SerializedQueuedJob {
    const workflow = job.manifest?.meta.workflow ?? job.request.workflow ?? job.request.compositionPlan?.workflow;
    const qualityControl = job.manifest?.qualityControl ?? null;
    const effectiveQualityPolicy = qualityControl?.policy ?? null;
    const qualityPolicy = buildQualityPolicyView(job, workflow, effectiveQualityPolicy);
    const structureEvaluation = job.manifest?.structureEvaluation ?? null;
    const audioEvaluation = job.manifest?.audioEvaluation ?? null;
    const longSpanDivergence = summarizeLongSpanDivergence(
        structureEvaluation?.longSpan,
        audioEvaluation?.longSpan,
        audioEvaluation ?? undefined,
        structureEvaluation ?? undefined,
    );
    const tracking = job.manifest ? summarizeManifestTracking(job.manifest) : null;
    const attemptCount = new Set((qualityControl?.attempts ?? []).map((entry) => entry.attempt)).size;

    return toJsonClone({
        jobId: job.jobId,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        nextAttemptAt: job.nextAttemptAt,
        error: job.error,
        promptHash: job.request.promptHash,
        songId: job.manifest?.songId ?? job.request.songId,
        workflow,
        request: job.request,
        manifest: job.manifest,
        tracking,
        qualityPolicy,
        qualityControl,
        quality: {
            policy: qualityPolicy,
            attemptCount,
            attempts: qualityControl?.attempts ?? [],
            selectedAttempt: qualityControl?.selectedAttempt ?? null,
            stopReason: qualityControl?.stopReason ?? null,
            structurePassed: structureEvaluation?.passed ?? null,
            structureScore: structureEvaluation?.score ?? null,
            longSpan: structureEvaluation?.longSpan ?? null,
            longSpanDivergence: longSpanDivergence ?? null,
            audioPassed: audioEvaluation?.passed ?? null,
            audioScore: audioEvaluation?.score ?? null,
            audioLongSpan: audioEvaluation?.longSpan ?? null,
        },
        evaluations: {
            structure: structureEvaluation,
            audio: audioEvaluation,
        },
    });
}