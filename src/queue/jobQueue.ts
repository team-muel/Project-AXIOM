import { v4 as uuidv4 } from "uuid";
import {
    markAutonomyRunFailed,
    markAutonomyRunPendingApproval,
    markAutonomyRunRetryScheduled,
    markAutonomyRunRunning,
} from "../autonomy/service.js";
import { getAutonomyDayKey } from "../autonomy/calendar.js";
import { ensureComposeRequestMetadata } from "../autonomy/request.js";
import { loadManifest } from "../memory/manifest.js";
import { mergeExpressionPlanIntoRequest } from "../pipeline/expressionPlan.js";
import type { ComposeRequest, JobManifest } from "../pipeline/types.js";
import { PipelineState } from "../pipeline/states.js";
import { runPipeline } from "../pipeline/orchestrator.js";
import { logger } from "../logging/logger.js";
import { config } from "../config.js";
import fs from "node:fs";
import path from "node:path";

export interface QueuedJob {
    jobId: string;
    request: ComposeRequest;
    attempts: number;
    maxAttempts: number;
    status: "queued" | "running" | "retry_scheduled" | "done" | "failed";
    manifest: JobManifest | null;
    createdAt: string;
    updatedAt: string;
    nextAttemptAt?: string;
    error?: string;
}

interface QueueSnapshot {
    savedAt: string;
    queue: string[];
    jobs: QueuedJob[];
}

export interface QueueRecoverySummary {
    restoredJobs: number;
    requeuedJobs: number;
    recoveredRunningJobs: number;
    restoredRetryScheduledJobs: number;
}

const jobs = new Map<string, QueuedJob>();
const queue: string[] = [];
const retryTimers = new Map<string, NodeJS.Timeout>();
let processing = false;
let queuedPersistTimer: NodeJS.Timeout | null = null;
let lastPersistedSnapshot = "";

function dayKeyFromIso(iso: string): string {
    return getAutonomyDayKey(iso);
}

function isActiveStatus(status: QueuedJob["status"]): boolean {
    return status === "queued" || status === "running" || status === "retry_scheduled";
}

function deadletterDir(): string {
    return path.join(config.logDir, "deadletter");
}

function systemDir(): string {
    return path.join(config.outputDir, "_system");
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function queueStatePath(): string {
    return path.join(systemDir(), "queue-state.json");
}

function writeAtomicJson(filePath: string, payload: string): void {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, payload, "utf-8");
    fs.renameSync(tempPath, filePath);
}

function flushQueueState(): void {
    const snapshot: QueueSnapshot = {
        savedAt: new Date().toISOString(),
        queue: [...queue],
        jobs: Array.from(jobs.values()),
    };
    const payload = JSON.stringify(snapshot, null, 2);
    if (payload === lastPersistedSnapshot) {
        return;
    }

    ensureDir(systemDir());
    writeAtomicJson(queueStatePath(), payload);
    lastPersistedSnapshot = payload;
}

function persistQueueState(mode: "immediate" | "deferred" = "immediate"): void {
    if (mode === "immediate") {
        if (queuedPersistTimer) {
            clearTimeout(queuedPersistTimer);
            queuedPersistTimer = null;
        }
        flushQueueState();
        return;
    }

    if (queuedPersistTimer) {
        return;
    }

    queuedPersistTimer = setTimeout(() => {
        queuedPersistTimer = null;
        flushQueueState();
    }, 150);
    queuedPersistTimer.unref?.();
}

function loadQueueSnapshot(): QueueSnapshot | null {
    const filePath = queueStatePath();
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as QueueSnapshot;
    } catch {
        return null;
    }
}

function clearRetryTimer(jobId: string): void {
    const timer = retryTimers.get(jobId);
    if (!timer) {
        return;
    }

    clearTimeout(timer);
    retryTimers.delete(jobId);
}

function shouldRecoverManifest(job: QueuedJob): boolean {
    return Boolean(job.manifest?.songId) && job.manifest !== null && job.manifest.state !== PipelineState.DONE && job.manifest.state !== PipelineState.FAILED;
}

function markRequestForRecovery(job: QueuedJob, note: string): void {
    if (!shouldRecoverManifest(job) || !job.manifest?.songId) {
        return;
    }

    job.request.songId = job.manifest.songId;
    job.request.recoveredFromRestart = true;
    job.request.recoveryNote = note;
}

function scheduleRestoredRetry(job: QueuedJob): void {
    const dueAt = Date.parse(job.nextAttemptAt ?? "");
    if (!Number.isFinite(dueAt)) {
        job.status = "queued";
        job.nextAttemptAt = undefined;
        job.updatedAt = new Date().toISOString();
        queue.push(job.jobId);
        persistQueueState("immediate");
        return;
    }

    const delayMs = Math.max(0, dueAt - Date.now());
    const timer = setTimeout(() => {
        retryTimers.delete(job.jobId);
        const current = jobs.get(job.jobId);
        if (!current || current.status !== "retry_scheduled") {
            return;
        }

        current.status = "queued";
        current.updatedAt = new Date().toISOString();
        current.nextAttemptAt = undefined;
        queue.push(current.jobId);
        persistQueueState("immediate");
        logger.info("Recovered retry job requeued", { jobId: current.jobId, attempt: current.attempts + 1 });
        void processNext();
    }, delayMs);
    timer.unref?.();

    retryTimers.set(job.jobId, timer);
}

function saveDeadletter(job: QueuedJob): void {
    const dir = deadletterDir();
    ensureDir(dir);
    const filePath = path.join(dir, `${job.jobId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(job, null, 2), "utf-8");
    logger.warn("Job moved to deadletter", { jobId: job.jobId, attempts: job.attempts });
}

export function enqueue(request: ComposeRequest): QueuedJob {
    const now = new Date().toISOString();
    const normalizedRequest = ensureComposeRequestMetadata(request, request.source ?? "api");
    const job: QueuedJob = {
        jobId: uuidv4(),
        request: normalizedRequest,
        attempts: 0,
        maxAttempts: config.maxRetries + 1,
        status: "queued",
        manifest: null,
        createdAt: now,
        updatedAt: now,
    };
    jobs.set(job.jobId, job);
    queue.push(job.jobId);
    logger.info("Job enqueued", {
        jobId: job.jobId,
        prompt: normalizedRequest.prompt,
        source: normalizedRequest.source,
        promptHash: normalizedRequest.promptHash,
    });
    persistQueueState("immediate");
    processNext();
    return job;
}

export function getJob(jobId: string): QueuedJob | undefined {
    return jobs.get(jobId);
}

export function listJobs(): QueuedJob[] {
    return Array.from(jobs.values());
}

export function findActiveJobByPromptHash(promptHash: string): QueuedJob | undefined {
    return Array.from(jobs.values()).find((job) => (
        job.request.promptHash === promptHash
        && isActiveStatus(job.status)
    ));
}

export function restoreQueueState(): QueueRecoverySummary {
    const snapshot = loadQueueSnapshot();
    if (!snapshot) {
        return {
            restoredJobs: 0,
            requeuedJobs: 0,
            recoveredRunningJobs: 0,
            restoredRetryScheduledJobs: 0,
        };
    }

    for (const timer of retryTimers.values()) {
        clearTimeout(timer);
    }
    retryTimers.clear();
    jobs.clear();
    queue.length = 0;

    const now = new Date().toISOString();
    let requeuedJobs = 0;
    let recoveredRunningJobs = 0;
    let restoredRetryScheduledJobs = 0;

    for (const rawJob of snapshot.jobs) {
        const hydratedManifest = rawJob.manifest?.songId
            ? loadManifest(rawJob.manifest.songId) ?? rawJob.manifest
            : rawJob.manifest;
        const job: QueuedJob = {
            ...rawJob,
            request: { ...rawJob.request },
            manifest: hydratedManifest
                ? JSON.parse(JSON.stringify(hydratedManifest)) as JobManifest
                : null,
        };

        if (job.manifest?.expressionPlan) {
            job.request = mergeExpressionPlanIntoRequest(job.request, job.manifest.expressionPlan);
        }

        if (shouldRecoverManifest(job) && job.manifest?.songId) {
            job.request.songId = job.manifest.songId;
        }

        if (job.status === "running") {
            if (job.attempts >= job.maxAttempts) {
                job.status = "failed";
                job.updatedAt = now;
                job.nextAttemptAt = undefined;
                job.error = [job.error, "Recovered after restart while running with no attempts left"]
                    .filter(Boolean)
                    .join("; ");
                saveDeadletter(job);
            } else {
                job.status = "queued";
                job.updatedAt = now;
                job.nextAttemptAt = undefined;
                job.error = [job.error, "Recovered after restart while previously running"]
                    .filter(Boolean)
                    .join("; ");
                const recoveredStage = job.manifest?.state ?? PipelineState.COMPOSE;
                markRequestForRecovery(job, `Recovered after restart while previously running in ${recoveredStage}`);
                recoveredRunningJobs += 1;
            }
        }

        if (job.status === "queued" && shouldRecoverManifest(job)) {
            const recoveredStage = job.manifest?.state ?? PipelineState.COMPOSE;
            markRequestForRecovery(job, `Recovered after restart while queued to resume ${recoveredStage}`);
        }

        if (job.status === "retry_scheduled" && shouldRecoverManifest(job)) {
            const recoveredStage = job.manifest?.state ?? PipelineState.COMPOSE;
            markRequestForRecovery(job, `Recovered after restart while waiting to resume ${recoveredStage}`);
        }

        if (job.status === "retry_scheduled" && job.nextAttemptAt) {
            const retryAt = Date.parse(job.nextAttemptAt);
            if (!Number.isFinite(retryAt) || retryAt <= Date.now()) {
                job.status = "queued";
                job.nextAttemptAt = undefined;
                job.updatedAt = now;
            }
        }

        jobs.set(job.jobId, job);
    }

    const queuedInSnapshot = new Set<string>();
    for (const jobId of snapshot.queue) {
        const job = jobs.get(jobId);
        if (!job || job.status !== "queued") {
            continue;
        }

        queue.push(jobId);
        queuedInSnapshot.add(jobId);
        requeuedJobs += 1;
    }

    for (const job of jobs.values()) {
        if (job.status === "queued" && !queuedInSnapshot.has(job.jobId)) {
            queue.push(job.jobId);
            requeuedJobs += 1;
        }

        if (job.status === "retry_scheduled") {
            scheduleRestoredRetry(job);
            restoredRetryScheduledJobs += 1;
        }
    }

    persistQueueState("immediate");

    if (queue.length > 0) {
        void processNext();
    }

    logger.info("Queue state restored", {
        restoredJobs: jobs.size,
        requeuedJobs,
        recoveredRunningJobs,
        restoredRetryScheduledJobs,
    });

    return {
        restoredJobs: jobs.size,
        requeuedJobs,
        recoveredRunningJobs,
        restoredRetryScheduledJobs,
    };
}

function scheduleRetry(job: QueuedJob, error: string): void {
    const backoffMs = Math.max(config.retryBackoffMs, 0) * (2 ** Math.max(job.attempts - 1, 0));
    const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();

    job.status = "retry_scheduled";
    job.updatedAt = new Date().toISOString();
    job.nextAttemptAt = nextAttemptAt;
    clearRetryTimer(job.jobId);

    if (job.request.source === "autonomy" && job.request.autonomyRunId) {
        markAutonomyRunRetryScheduled(
            job.request.autonomyRunId,
            dayKeyFromIso(job.createdAt),
            job.jobId,
            nextAttemptAt,
            error,
        );
    }

    logger.warn("Job will retry with backoff", {
        jobId: job.jobId,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        error,
        backoffMs,
        nextAttemptAt,
    });
    persistQueueState("immediate");

    const timer = setTimeout(() => {
        retryTimers.delete(job.jobId);
        const current = jobs.get(job.jobId);
        if (!current || current.status !== "retry_scheduled") {
            return;
        }

        current.status = "queued";
        current.updatedAt = new Date().toISOString();
        current.nextAttemptAt = undefined;
        queue.push(current.jobId);
        persistQueueState("immediate");
        logger.info("Job requeued after backoff", { jobId: current.jobId, attempt: current.attempts + 1 });
        void processNext();
    }, backoffMs);
    timer.unref?.();

    retryTimers.set(job.jobId, timer);
}

async function processNext(): Promise<void> {
    if (processing) return;

    const jobId = queue.shift();
    if (!jobId) return;

    const job = jobs.get(jobId);
    if (!job) {
        processNext();
        return;
    }

    processing = true;
    job.status = "running";
    job.attempts += 1;
    job.updatedAt = new Date().toISOString();
    job.nextAttemptAt = undefined;
    persistQueueState("immediate");
    logger.info("Job started", { jobId: job.jobId, attempt: job.attempts });

    if (job.request.source === "autonomy" && job.request.autonomyRunId) {
        markAutonomyRunRunning(job.request.autonomyRunId, dayKeyFromIso(job.createdAt), job.jobId);
    }

    let manifest: JobManifest | null = null;

    try {
        manifest = await runPipeline(job.request, {
            onManifestUpdate: (nextManifest) => {
                const previousSongId = job.request.songId;
                job.manifest = nextManifest;
                if (nextManifest.expressionPlan) {
                    job.request = mergeExpressionPlanIntoRequest(job.request, nextManifest.expressionPlan);
                }
                if (nextManifest.songId) {
                    job.request.songId = nextManifest.songId;
                }
                job.updatedAt = nextManifest.updatedAt;
                persistQueueState(!previousSongId && !!nextManifest.songId ? "immediate" : "deferred");
            },
        });
        job.manifest = manifest;
        job.request.songId = manifest.songId;

        if (manifest.state === PipelineState.FAILED) {
            throw new Error(manifest.errorMessage ?? "Pipeline returned FAILED");
        }

        job.status = "done";
        job.updatedAt = new Date().toISOString();
        if (job.request.source === "autonomy") {
            markAutonomyRunPendingApproval(manifest, job.jobId);
        }
        persistQueueState("immediate");
        logger.info("Job completed", { jobId: job.jobId });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        job.error = message;
        job.updatedAt = new Date().toISOString();

        if (job.attempts < job.maxAttempts) {
            scheduleRetry(job, message);
        } else {
            job.status = "failed";
            job.nextAttemptAt = undefined;
            if (job.request.source === "autonomy" && job.request.autonomyRunId) {
                markAutonomyRunFailed(job.request.autonomyRunId, dayKeyFromIso(job.createdAt), job.jobId, message);
            }
            saveDeadletter(job);
            persistQueueState("immediate");
        }
    } finally {
        processing = false;
        void processNext();
    }
}
