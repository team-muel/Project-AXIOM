import type { ComposeRequest, JobManifest } from "../core/pipeline/types.js";

/**
 * Lifecycle hooks that ops can register to observe and react to runtime events.
 * Core pipeline (orchestrator, queue) calls these; the ops layer implements them.
 * In core-only mode no hooks are registered, so all calls are no-ops.
 */
export interface RuntimeHooks {
    /**
     * Called when an autonomy job starts running.
     * @param runId - The autonomy run ID (request.autonomyRunId)
     * @param jobCreatedAt - ISO timestamp of job creation; used by ops to compute the day key
     * @param jobId - The queue job ID
     */
    onJobRunning?: (runId: string, jobCreatedAt: string, jobId: string) => void;

    /**
     * Called when a job completes successfully (pipeline reached DONE state).
     */
    onJobCompleted?: (manifest: JobManifest, jobId: string) => void;

    /**
     * Called when a job fails permanently (all retry attempts exhausted).
     */
    onJobFailed?: (runId: string, jobCreatedAt: string, jobId: string, error: string) => void;

    /**
     * Called when a job is scheduled for a retry.
     */
    onJobRetryScheduled?: (
        runId: string,
        jobCreatedAt: string,
        jobId: string,
        nextAttemptAt: string,
        error: string,
    ) => void;

    /**
     * Called after the pipeline reaches DONE. The hook may mutate manifest in-place
     * (e.g. set selfAssessment, evaluationSummary) and update learned preferences.
     * Returns true if manifest was mutated and the caller should re-persist it.
     */
    onPipelineComplete?: (manifest: JobManifest, request: ComposeRequest) => Promise<boolean>;
}

const registry: RuntimeHooks = {};

export function registerRuntimeHooks(hooks: Partial<RuntimeHooks>): void {
    Object.assign(registry, hooks);
}

export function getRuntimeHooks(): Readonly<RuntimeHooks> {
    return registry;
}
