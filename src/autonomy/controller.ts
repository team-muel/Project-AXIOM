import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import { listStoredManifests } from "../memory/manifest.js";
import { checkOllamaReachable } from "../overseer/index.js";
import {
    outputArtifactLink,
    recordAutonomyOperatorAction,
    type AutonomyOperatorMutationContext,
} from "./actionAudit.js";
import { getAutonomyDayKey } from "./calendar.js";
import {
    acquireAutonomyRunLock,
    AutonomyConflictError,
    countAutonomyAttemptsForDay,
    findDuplicateAutonomyPlanSignature,
    findDuplicateAutonomyPrompt,
    getAutonomyControlState,
    isAutonomyConflictError,
    listPendingApprovalSummaries,
    markAutonomyPlanBlocked,
    markAutonomyPlanQueued,
    previewAutonomyPlan,
    recoverAutonomyRuntimeState,
    releaseAutonomyRunLock,
} from "./service.js";
import type {
    AutonomyDailyCapStatus,
    AutonomyLockHealth,
    AutonomyOperationalSummary,
    PlannerCandidateSelectionSummary,
    PlannerNoveltySummary,
    PlannerPlanSummary,
    AutonomyRecoverySummary,
    RecoverableAutonomyJob,
} from "./types.js";
import { enqueue, findActiveJobByPromptHash, listJobs, restoreQueueState, type QueueRecoverySummary } from "../queue/jobQueue.js";

export class AutonomyUnavailableError extends Error {
    readonly statusCode = 503;

    constructor(message: string) {
        super(message);
        this.name = "AutonomyUnavailableError";
    }
}

export function isAutonomyUnavailableError(error: unknown): error is AutonomyUnavailableError {
    return error instanceof AutonomyUnavailableError;
}

export interface AutonomyTriggerResult {
    jobId: string;
    status: string;
    runId: string;
    promptHash: string;
    request: ReturnType<typeof enqueue>["request"];
    rationale: string;
    inspirationSnapshot: string[];
    planSummary?: PlannerPlanSummary;
    noveltySummary?: PlannerNoveltySummary;
    candidateSelection?: PlannerCandidateSelectionSummary;
    initiatedBy: "api" | "scheduler" | "mcp";
}

export interface AutonomyRuntimeRecoveryResult {
    queue: QueueRecoverySummary;
    autonomy: AutonomyRecoverySummary;
}

export interface AutonomyLockReconcileResult {
    cleared: boolean;
    reason: string;
    before: AutonomyLockHealth;
    after: AutonomyLockHealth;
    recovery?: AutonomyRecoverySummary;
}

function autonomyJobs() {
    return listJobs().filter((job) => (
        job.request.source === "autonomy"
        && Boolean(job.request.autonomyRunId)
    ));
}

function activeAutonomyQueueJobs() {
    return autonomyJobs().filter((job) => ["queued", "running", "retry_scheduled"].includes(job.status));
}

function activeAutonomyJobs(): RecoverableAutonomyJob[] {
    return activeAutonomyQueueJobs()
        .map((job) => ({
            jobId: job.jobId,
            createdAt: job.createdAt,
            status: job.status as RecoverableAutonomyJob["status"],
            nextAttemptAt: job.nextAttemptAt,
            error: job.error,
            request: {
                source: job.request.source,
                autonomyRunId: job.request.autonomyRunId,
                promptHash: job.request.promptHash,
            },
        }));
}

export function getAutonomyDailyCapStatus(now = new Date()): AutonomyDailyCapStatus {
    const dayKey = getAutonomyDayKey(now);
    const attemptCap = Math.max(config.autonomyMaxAttemptsPerDay, 0);
    const attemptsUsed = countAutonomyAttemptsForDay(dayKey);

    return {
        dayKey,
        attemptsUsed,
        attemptCap,
        remainingAttempts: Math.max(attemptCap - attemptsUsed, 0),
        capped: attemptsUsed >= attemptCap,
    };
}

export function getAutonomyLockHealth(now = new Date()): AutonomyLockHealth {
    const control = getAutonomyControlState();
    const thresholdMs = Math.max(config.autonomyStaleLockMs, 60_000);

    if (!control.activeRun) {
        return {
            active: false,
            thresholdMs,
            autoClearEnabled: config.autonomyAutoClearStaleLocks,
            stale: false,
            autoClearEligible: false,
            reason: "no_active_lock",
        };
    }

    const activeRun = control.activeRun;
    const acquiredAtMs = Date.parse(activeRun.acquiredAt);
    const ageMs = Number.isFinite(acquiredAtMs) ? Math.max(0, now.getTime() - acquiredAtMs) : undefined;
    const activeJobs = activeAutonomyQueueJobs();
    const matchedJob = activeJobs.find((job) => job.request.autonomyRunId === activeRun.runId);
    const terminalManifest = listStoredManifests().find((manifest) => (
        manifest.meta.autonomyRunId === activeRun.runId
        && ["DONE", "FAILED"].includes(manifest.state)
    ));

    let stale = false;
    let autoClearEligible = false;
    let reason = "active_job_present";

    if (terminalManifest) {
        stale = true;
        autoClearEligible = true;
        reason = "terminal_manifest_exists";
    } else if (matchedJob) {
        reason = "active_job_present";
    } else if (activeJobs.length > 0) {
        stale = true;
        autoClearEligible = true;
        reason = "queue_run_mismatch";
    } else if ((ageMs ?? thresholdMs) >= thresholdMs) {
        stale = true;
        autoClearEligible = config.autonomyAutoClearStaleLocks;
        reason = "lock_timeout_without_active_job";
    } else {
        reason = "waiting_for_queue_registration";
    }

    return {
        active: true,
        thresholdMs,
        autoClearEnabled: config.autonomyAutoClearStaleLocks,
        stale,
        autoClearEligible,
        reason,
        runId: activeRun.runId,
        promptHash: activeRun.promptHash,
        state: activeRun.state,
        acquiredAt: activeRun.acquiredAt,
        ageMs,
        matchedJobId: matchedJob?.jobId,
        matchedJobStatus: matchedJob?.status,
        manifestSongId: terminalManifest?.songId,
        manifestState: terminalManifest?.state,
    };
}

export function getAutonomyOperationalSummary(now = new Date()): AutonomyOperationalSummary {
    const jobs = listJobs();
    const activeJobs = activeAutonomyQueueJobs();
    const queue = {
        totalJobs: jobs.length,
        queued: jobs.filter((job) => job.status === "queued").length,
        running: jobs.filter((job) => job.status === "running").length,
        retryScheduled: jobs.filter((job) => job.status === "retry_scheduled").length,
        done: jobs.filter((job) => job.status === "done").length,
        failed: jobs.filter((job) => job.status === "failed").length,
        activeAutonomyJobs: activeJobs.length,
    };
    const dailyCap = getAutonomyDailyCapStatus(now);
    const lockHealth = getAutonomyLockHealth(now);
    const recommendations: string[] = [];

    if (lockHealth.stale) {
        recommendations.push(lockHealth.autoClearEligible
            ? "stale autonomy lock can be reconciled now"
            : "stale autonomy lock detected; manual reconcile required");
    }

    if (dailyCap.capped) {
        recommendations.push("daily autonomy attempt cap has been reached");
    }

    if (queue.retryScheduled > 0) {
        recommendations.push("retry-scheduled jobs are waiting for backoff expiry");
    }

    if (listPendingApprovalSummaries(1).length > 0) {
        recommendations.push("pending approval is blocking the next autonomy trigger");
    }

    return {
        dailyCap,
        lockHealth,
        queue,
        recommendations,
    };
}

export function reconcileAutonomyLock(
    reason = "manual",
    allowManualOverride = false,
    auditContext?: AutonomyOperatorMutationContext,
): AutonomyLockReconcileResult {
    const before = getAutonomyLockHealth();

    const persistAudit = (after: typeof before, cleared: boolean) => {
        if (!auditContext) {
            return;
        }

        recordAutonomyOperatorAction({
            context: auditContext,
            action: "reconcile_lock",
            reason,
            input: {
                reason,
                allowManualOverride,
            },
            before: {
                active: before.active,
                stale: before.stale,
                reason: before.reason,
                runId: before.runId,
                acquiredAt: before.acquiredAt,
                ageMs: before.ageMs,
                autoClearEligible: before.autoClearEligible,
            },
            after: {
                active: after.active,
                stale: after.stale,
                reason: after.reason,
                runId: after.runId,
                acquiredAt: after.acquiredAt,
                ageMs: after.ageMs,
                autoClearEligible: after.autoClearEligible,
                cleared,
            },
            artifactLinks: [outputArtifactLink("_system", "state.json")],
            observedAt: new Date().toISOString(),
        });
    };

    if (!before.active) {
        persistAudit(before, false);
        return {
            cleared: false,
            reason: before.reason,
            before,
            after: before,
        };
    }

    if (!before.stale) {
        persistAudit(before, false);
        return {
            cleared: false,
            reason: before.reason,
            before,
            after: before,
        };
    }

    if (!before.autoClearEligible && !allowManualOverride) {
        persistAudit(before, false);
        return {
            cleared: false,
            reason: before.reason,
            before,
            after: before,
        };
    }

    const recovery = recoverAutonomyRuntimeState(activeAutonomyJobs());
    const after = getAutonomyLockHealth();
    const cleared = !after.active || after.runId !== before.runId || after.reason !== before.reason;

    persistAudit(after, cleared);

    logger.warn("Autonomy lock reconciled", {
        requestedReason: reason,
        staleReason: before.reason,
        cleared,
        restoredActiveRunId: recovery.restoredActiveRunId,
        resolvedStaleRunId: recovery.resolvedStaleRunId,
    });

    return {
        cleared,
        reason: before.reason,
        before,
        after,
        recovery,
    };
}

export async function triggerAutonomyRun(
    initiatedBy: "api" | "scheduler" | "mcp" = "api",
): Promise<AutonomyTriggerResult> {
    if (!config.autonomyEnabled) {
        throw new AutonomyUnavailableError("autonomy planner is disabled");
    }

    const reachable = await checkOllamaReachable();
    if (!reachable) {
        throw new AutonomyUnavailableError("Ollama is not reachable. Is it running?");
    }

    await reconcileAutonomyLock(`pre_trigger:${initiatedBy}`);

    const control = getAutonomyControlState();
    if (control.paused) {
        throw new AutonomyConflictError(`autonomy is paused${control.pauseReason ? `: ${control.pauseReason}` : ""}`, {
            paused: true,
            pauseReason: control.pauseReason,
        });
    }

    if (control.activeRun) {
        throw new AutonomyConflictError("another autonomy run is already active", {
            activeRun: control.activeRun,
        });
    }

    const dailyCap = getAutonomyDailyCapStatus();
    if (dailyCap.capped) {
        throw new AutonomyConflictError("daily autonomy attempt cap reached", {
            dailyCap,
        });
    }

    const pendingApproval = listPendingApprovalSummaries(1)[0];
    if (pendingApproval) {
        throw new AutonomyConflictError("pending approval exists", {
            pendingApproval,
        });
    }

    const plan = await previewAutonomyPlan();

    const duplicateLedger = findDuplicateAutonomyPrompt(plan.promptHash);
    if (duplicateLedger) {
        markAutonomyPlanBlocked(plan, `duplicate prompt hash ${plan.promptHash}`);
        throw new AutonomyConflictError("duplicate autonomy prompt is already in progress or completed today", {
            duplicate: duplicateLedger,
        });
    }

    const duplicatePlanSignature = plan.noveltySummary?.planSignature
        ? findDuplicateAutonomyPlanSignature(plan.noveltySummary.planSignature)
        : null;
    if (duplicatePlanSignature) {
        markAutonomyPlanBlocked(plan, `duplicate plan signature ${duplicatePlanSignature.planSignature}`);
        throw new AutonomyConflictError("duplicate autonomy plan signature is already in progress or completed today", {
            duplicatePlan: duplicatePlanSignature,
            noveltySummary: plan.noveltySummary,
        });
    }

    const duplicateJob = findActiveJobByPromptHash(plan.promptHash);
    if (duplicateJob) {
        markAutonomyPlanBlocked(plan, `duplicate queued job ${duplicateJob.jobId}`);
        throw new AutonomyConflictError("duplicate queued or running job exists for this prompt hash", {
            duplicateJob: {
                jobId: duplicateJob.jobId,
                status: duplicateJob.status,
                promptHash: duplicateJob.request.promptHash,
            },
        });
    }

    acquireAutonomyRunLock(plan);
    try {
        const job = enqueue({
            ...plan.request,
            source: "autonomy",
            autonomyRunId: plan.runId,
            promptHash: plan.promptHash,
        });
        markAutonomyPlanQueued(plan, job.jobId);

        logger.info("Autonomy run triggered", {
            initiatedBy,
            runId: plan.runId,
            jobId: job.jobId,
            promptHash: plan.promptHash,
        });

        return {
            jobId: job.jobId,
            status: job.status,
            runId: plan.runId,
            promptHash: plan.promptHash,
            request: job.request,
            rationale: plan.rationale,
            inspirationSnapshot: plan.inspirationSnapshot,
            planSummary: plan.planSummary,
            noveltySummary: plan.noveltySummary,
            candidateSelection: plan.candidateSelection,
            initiatedBy,
        };
    } catch (error) {
        markAutonomyPlanBlocked(plan, "enqueue failed after lock acquisition");
        releaseAutonomyRunLock(plan.runId);
        throw error;
    }
}

export function recoverAutonomyRuntimeOnStartup(): AutonomyRuntimeRecoveryResult {
    const queue = restoreQueueState();
    const autonomy = recoverAutonomyRuntimeState(activeAutonomyJobs());

    logger.info("Autonomy runtime recovery complete", {
        restoredJobs: queue.restoredJobs,
        requeuedJobs: queue.requeuedJobs,
        recoveredRunningJobs: queue.recoveredRunningJobs,
        restoredRetryScheduledJobs: queue.restoredRetryScheduledJobs,
        restoredActiveRunId: autonomy.restoredActiveRunId,
        resolvedStaleRunId: autonomy.resolvedStaleRunId,
    });

    return { queue, autonomy };
}

export function parseAutonomyConflictPayload(error: unknown): Record<string, unknown> | null {
    if (!isAutonomyConflictError(error)) {
        return null;
    }

    return {
        error: error.message,
        ...(error.details ?? {}),
    };
}