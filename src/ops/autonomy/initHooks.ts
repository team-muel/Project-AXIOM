import { logger } from "../../logging/logger.js";
import { registerRuntimeHooks } from "../../runtime/hooks.js";
import { getAutonomyDayKey } from "./calendar.js";
import {
    evaluateCompletedManifest,
    markAutonomyRunFailed,
    markAutonomyRunPendingApproval,
    markAutonomyRunRetryScheduled,
    markAutonomyRunRunning,
    updateAutonomyPreferencesFromManifest,
} from "./service.js";

/**
 * Register ops-layer handlers for runtime lifecycle hooks.
 * Must be called before the queue starts processing (i.e., before recoverAutonomyRuntimeOnStartup).
 * In core-only mode (index.core.ts) this is never called, so all hooks remain no-ops.
 */
export function initAutonomyHooks(): void {
    registerRuntimeHooks({
        onJobRunning(runId, jobCreatedAt, jobId) {
            markAutonomyRunRunning(runId, getAutonomyDayKey(jobCreatedAt), jobId);
        },

        onJobCompleted(manifest, jobId) {
            markAutonomyRunPendingApproval(manifest, jobId);
        },

        onJobFailed(runId, jobCreatedAt, jobId, error) {
            markAutonomyRunFailed(runId, getAutonomyDayKey(jobCreatedAt), jobId, error);
        },

        onJobRetryScheduled(runId, jobCreatedAt, jobId, nextAttemptAt, error) {
            markAutonomyRunRetryScheduled(runId, getAutonomyDayKey(jobCreatedAt), jobId, nextAttemptAt, error);
        },

        async onPipelineComplete(manifest, request) {
            try {
                const assessment = await evaluateCompletedManifest(manifest);
                if (assessment) {
                    manifest.selfAssessment = assessment;
                    manifest.evaluationSummary = assessment.summary;
                    updateAutonomyPreferencesFromManifest(manifest, request);
                    return true;
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger.warn("Self-assessment failed", { songId: manifest.songId, error: message });
            }
            if (request.source === "autonomy") {
                updateAutonomyPreferencesFromManifest(manifest, request);
            }
            return false;
        },
    });
}
