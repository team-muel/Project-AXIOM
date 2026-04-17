import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import { runOverseer, type OverseerReport } from "./index.js";
import { appendOverseerFailureHistory, appendOverseerReportHistory, saveLastOverseerReport } from "./storage.ts";

interface SchedulerState {
    timer: NodeJS.Timeout | null;
    running: boolean;
    lastRunAt?: string;
    lastCompletedAt?: string;
    lastDurationMs?: number;
    lastError?: string;
    lastReport?: OverseerReport;
}

const state: SchedulerState = {
    timer: null,
    running: false,
};

function intervalMs(): number {
    return Math.max(config.overseerIntervalMs, 1_000);
}

async function runScheduledOverseer(): Promise<void> {
    if (state.running) {
        logger.warn("Overseer auto-run skipped", { reason: "already_running" });
        return;
    }

    state.running = true;
    state.lastRunAt = new Date().toISOString();
    const startedAt = Date.now();

    try {
        const report = await runOverseer();
        state.lastReport = report;
        saveLastOverseerReport(report);
        appendOverseerReportHistory(report);
        state.lastCompletedAt = new Date().toISOString();
        state.lastDurationMs = Date.now() - startedAt;
        state.lastError = undefined;

        logger.info("Overseer auto-report ready", {
            durationMs: state.lastDurationMs,
            model: report.model,
            logLines: report.logLines,
            manifestsRead: report.manifestsRead,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.lastCompletedAt = new Date().toISOString();
        state.lastDurationMs = Date.now() - startedAt;
        state.lastError = message;
        appendOverseerFailureHistory(message, state.lastCompletedAt);

        logger.error("Overseer auto-report failed", {
            error: message,
            durationMs: state.lastDurationMs,
        });
    } finally {
        state.running = false;
    }
}

export function startOverseerScheduler(): void {
    if (!config.overseerAutoEnabled) {
        logger.info("Overseer auto-loop disabled");
        return;
    }

    if (state.timer) {
        return;
    }

    logger.info("Overseer auto-loop enabled", { intervalMs: intervalMs() });
    void runScheduledOverseer();
    state.timer = setInterval(() => {
        void runScheduledOverseer();
    }, intervalMs());
}

export function stopOverseerScheduler(): void {
    if (!state.timer) {
        return;
    }

    clearInterval(state.timer);
    state.timer = null;
    logger.info("Overseer auto-loop stopped");
}

export function getOverseerSchedulerStatus(): Record<string, unknown> {
    return {
        enabled: config.overseerAutoEnabled,
        intervalMs: intervalMs(),
        running: state.running,
        lastRunAt: state.lastRunAt,
        lastCompletedAt: state.lastCompletedAt,
        lastDurationMs: state.lastDurationMs,
        lastError: state.lastError,
        lastReportModel: state.lastReport?.model,
    };
}