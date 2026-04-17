import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import { triggerAutonomyRun, parseAutonomyConflictPayload, isAutonomyUnavailableError } from "./controller.js";
import { getAutonomyDayKey, getAutonomyZonedClock } from "./calendar.js";
import { countAutonomyAttemptsForDay } from "./service.js";
import type { AutonomySchedulerStatus } from "./types.js";

interface SchedulerState {
    timer: NodeJS.Timeout | null;
    running: boolean;
    lastTickAt?: string;
    lastTriggerAt?: string;
    lastDecision?: string;
    lastError?: string;
}

const state: SchedulerState = {
    timer: null,
    running: false,
};

function schedulerMode(): AutonomySchedulerStatus["mode"] {
    return config.autonomySchedulerIntervalMs > 0 ? "interval" : "daily";
}

function pollMs(): number {
    return Math.max(config.autonomySchedulerPollMs, 1_000);
}

function dailyScheduleParts(): { hour: number; minute: number } {
    const match = /^(\d{2}):(\d{2})$/.exec(config.autonomySchedulerTime.trim());
    if (!match) {
        return { hour: 9, minute: 0 };
    }

    return {
        hour: Math.min(Math.max(Number.parseInt(match[1], 10), 0), 23),
        minute: Math.min(Math.max(Number.parseInt(match[2], 10), 0), 59),
    };
}

function isDue(now = new Date()): { due: boolean; dayKey: string; reason: string } {
    if (schedulerMode() === "interval") {
        if (!state.lastTriggerAt) {
            return { due: true, dayKey: getAutonomyDayKey(now), reason: "interval:first_run" };
        }

        const elapsed = now.getTime() - Date.parse(state.lastTriggerAt);
        return {
            due: elapsed >= config.autonomySchedulerIntervalMs,
            dayKey: getAutonomyDayKey(now),
            reason: elapsed >= config.autonomySchedulerIntervalMs ? "interval:elapsed" : "interval:not_due",
        };
    }

    const current = getAutonomyZonedClock(now);
    const schedule = dailyScheduleParts();
    const scheduledMinutes = schedule.hour * 60 + schedule.minute;
    const attemptsToday = countAutonomyAttemptsForDay(current.dayKey);

    if (attemptsToday >= config.autonomyMaxAttemptsPerDay) {
        return { due: false, dayKey: current.dayKey, reason: "daily:max_attempts_reached" };
    }

    return {
        due: current.minutes >= scheduledMinutes,
        dayKey: current.dayKey,
        reason: current.minutes >= scheduledMinutes ? "daily:scheduled_time_reached" : "daily:not_due",
    };
}

async function tick(): Promise<void> {
    if (state.running) {
        return;
    }

    state.running = true;
    state.lastTickAt = new Date().toISOString();

    try {
        if (!config.autonomySchedulerEnabled || !config.autonomyEnabled) {
            state.lastDecision = "disabled";
            return;
        }

        const due = isDue();
        state.lastDecision = due.reason;
        if (!due.due) {
            return;
        }

        const result = await triggerAutonomyRun("scheduler");
        state.lastTriggerAt = new Date().toISOString();
        state.lastDecision = `triggered:${result.runId}`;
        state.lastError = undefined;
        logger.info("Autonomy scheduler triggered run", {
            runId: result.runId,
            jobId: result.jobId,
            promptHash: result.promptHash,
        });
    } catch (error) {
        const conflict = parseAutonomyConflictPayload(error);
        if (conflict) {
            state.lastDecision = String(conflict.error ?? "conflict");
            return;
        }

        if (isAutonomyUnavailableError(error)) {
            state.lastDecision = error.message;
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        state.lastError = message;
        state.lastDecision = "error";
        logger.error("Autonomy scheduler failed", { error: message });
    } finally {
        state.running = false;
    }
}

export function startAutonomyScheduler(): void {
    if (!config.autonomySchedulerEnabled) {
        logger.info("Autonomy scheduler disabled");
        return;
    }

    if (state.timer) {
        return;
    }

    logger.info("Autonomy scheduler enabled", {
        mode: schedulerMode(),
        pollMs: pollMs(),
        intervalMs: config.autonomySchedulerIntervalMs,
        dailyTime: config.autonomySchedulerTime,
        timezone: config.autonomySchedulerTimezone,
        maxAttemptsPerDay: config.autonomyMaxAttemptsPerDay,
    });
    void tick();
    state.timer = setInterval(() => {
        void tick();
    }, pollMs());
}

export function stopAutonomyScheduler(): void {
    if (!state.timer) {
        return;
    }

    clearInterval(state.timer);
    state.timer = null;
    logger.info("Autonomy scheduler stopped");
}

export function getAutonomySchedulerStatus(): AutonomySchedulerStatus {
    return {
        enabled: config.autonomySchedulerEnabled,
        mode: schedulerMode(),
        pollMs: pollMs(),
        ...(schedulerMode() === "interval" ? { intervalMs: config.autonomySchedulerIntervalMs } : {
            dailyTime: config.autonomySchedulerTime,
            timezone: config.autonomySchedulerTimezone,
        }),
        maxAttemptsPerDay: config.autonomyMaxAttemptsPerDay,
        running: state.running,
        lastTickAt: state.lastTickAt,
        lastTriggerAt: state.lastTriggerAt,
        lastDecision: state.lastDecision,
        lastError: state.lastError,
    };
}