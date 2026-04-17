import { config } from "../config.js";

export interface AutonomyZonedClock {
    dayKey: string;
    minutes: number;
}

export function getAutonomyZonedClock(date = new Date()): AutonomyZonedClock {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: config.autonomySchedulerTimezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);

    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const hour = Number.parseInt(String(values.hour ?? "0"), 10);
    const minute = Number.parseInt(String(values.minute ?? "0"), 10);

    return {
        dayKey: `${values.year}-${values.month}-${values.day}`,
        minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
    };
}

export function getAutonomyDayKey(value: Date | string = new Date()): string {
    const date = typeof value === "string" ? new Date(value) : value;
    return getAutonomyZonedClock(date).dayKey;
}