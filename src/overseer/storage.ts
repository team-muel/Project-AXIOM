import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config.js";
import type { OverseerReport } from "./index.js";

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 200;
const DEFAULT_SUMMARY_WINDOW_HOURS = 24;
const MAX_SUMMARY_WINDOW_HOURS = 24 * 30;
const WARNING_STOP_WORDS = new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "currently",
    "now",
    "still",
]);
const WARNING_TOKEN_ALIASES: Record<string, string> = {
    rising: "rise",
    risen: "rise",
    rose: "rise",
    increasing: "increase",
    increased: "increase",
    degraded: "degrade",
    degrading: "degrade",
    degradation: "degrade",
    failed: "fail",
    failing: "fail",
    failure: "fail",
    warnings: "warning",
    issues: "issue",
};
const DOMAIN_WARNING_CANONICALS: Array<{ pattern: RegExp; canonical: string }> = [
    {
        pattern: /(preview video|preview mp4|video preview).*(ffmpeg).*(missing|not found|unavailable|skip)|ffmpeg.*(missing|not found|unavailable)/,
        canonical: "render preview video ffmpeg missing",
    },
    {
        pattern: /(audio render|wav render|render audio|fluidsynth|midi2audio|soundfont).*(missing|not found|unavailable|skip)|soundfont.*(missing|not found)/,
        canonical: "render audio dependency missing",
    },
    {
        pattern: /(render worker).*(degraded|degrading|warning|failed|fail)|score preview.*(failed|missing|unavailable)/,
        canonical: "render worker degraded",
    },
    {
        pattern: /(queue backlog).*(rising|rise|growing|grow|increasing|increase)|backlog.*queue.*(rising|rise|growing|grow|increasing|increase)/,
        canonical: "queue backlog rising",
    },
    {
        pattern: /(retry scheduled|retry_scheduled|backoff expiry|backoff pending|waiting for backoff expiry)/,
        canonical: "queue retry backoff pending",
    },
    {
        pattern: /(duplicate queued or running job|duplicate queued job|duplicate active job|duplicate queue run)/,
        canonical: "queue duplicate active job",
    },
    {
        pattern: /(stale autonomy lock|lock timeout without active job|manual reconcile required|can be reconciled now|queue run mismatch)/,
        canonical: "autonomy stale lock",
    },
    {
        pattern: /(daily autonomy attempt cap|attempt cap has been reached|max attempts per day|remaining attempts <n>)/,
        canonical: "autonomy daily cap reached",
    },
    {
        pattern: /(pending approval exists|pending approval is blocking|awaiting approval|approval is blocking)/,
        canonical: "autonomy pending approval blocking",
    },
    {
        pattern: /(autonomy is paused|paused autonomy|operator halt)/,
        canonical: "autonomy paused",
    },
];

export interface OverseerHistorySnapshot {
    directory: string;
    files: string[];
    dayKey?: string;
    limit: number;
    entries: OverseerHistoryEntry[];
}

export interface OverseerSuccessHistoryEntry extends OverseerReport {
    kind: "success";
    healthy: boolean;
    issueSignatures: string[];
}

export interface OverseerFailureHistoryEntry {
    kind: "failure";
    generatedAt: string;
    error: string;
    report: string;
}

export type OverseerHistoryEntry = OverseerSuccessHistoryEntry | OverseerFailureHistoryEntry;

export interface OverseerRepeatedWarning {
    warningKey: string;
    warning: string;
    count: number;
    firstSeenAt: string;
    lastSeenAt: string;
    acknowledgedAt?: string;
    note?: string;
}

export interface OverseerWarningAcknowledgement {
    warningKey: string;
    warning: string;
    acknowledgedAt: string;
    lastSeenAt: string;
    note?: string;
}

export interface OverseerHistorySummary {
    windowHours: number;
    since: string;
    sampledEntries: number;
    totalEntries: number;
    successfulRuns: number;
    failedRuns: number;
    recentFailureCount: number;
    lastRunAt?: string;
    lastHealthyReportAt?: string;
    lastFailureAt?: string;
    repeatedWarnings: OverseerRepeatedWarning[];
    acknowledgedWarnings: OverseerRepeatedWarning[];
    activeRepeatedWarningCount: number;
    acknowledgedWarningCount: number;
    recentFailures: Array<Pick<OverseerFailureHistoryEntry, "generatedAt" | "error">>;
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadJsonFile<T>(filePath: string, fallback: T): T {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch {
        return fallback;
    }
}

function saveJsonFile(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function systemDir(): string {
    return path.join(config.outputDir, "_system");
}

function normalizeHistoryLimit(limit?: number): number {
    const value = limit ?? DEFAULT_HISTORY_LIMIT;
    return Math.min(Math.max(Math.trunc(value), 1), MAX_HISTORY_LIMIT);
}

function normalizeSummaryWindowHours(windowHours?: number): number {
    const value = windowHours ?? DEFAULT_SUMMARY_WINDOW_HOURS;
    return Math.min(Math.max(value, 1), MAX_SUMMARY_WINDOW_HOURS);
}

function historyDayKeyFromReport(report: OverseerReport): string {
    const parsed = Date.parse(report.generatedAt);
    if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString().slice(0, 10);
    }

    return new Date().toISOString().slice(0, 10);
}

function stripListMarker(line: string): string {
    return line
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim();
}

function dedupe(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeWarningToken(token: string): string | null {
    const cleaned = token
        .trim()
        .replace(/^[^\p{L}\p{N}<]+|[^\p{L}\p{N}>]+$/gu, "");

    if (!cleaned) {
        return null;
    }

    const aliased = WARNING_TOKEN_ALIASES[cleaned] ?? cleaned;
    if (!aliased || WARNING_STOP_WORDS.has(aliased)) {
        return null;
    }

    return aliased;
}

function canonicalizeDomainWarning(normalized: string): string | null {
    for (const rule of DOMAIN_WARNING_CANONICALS) {
        if (rule.pattern.test(normalized)) {
            return rule.canonical;
        }
    }

    return null;
}

export function normalizeOverseerWarningKey(value: string): string {
    const normalized = value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\b(song|job|run|manifest|prompt)\s*id\s*[:=]\s*[a-z0-9_-]+\b/gi, "$1id <id>")
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, " <uuid> ")
        .replace(/\b[0-9a-f]{10,}\b/gi, " <hex> ")
        .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/gi, " <time> ")
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " <date> ")
        .replace(/[a-z]:\\[^\s]+/gi, " <path> ")
        .replace(/(?:\/[^\s)]+){2,}/g, " <path> ")
        .replace(/\b\d+\b/g, " <n> ")
        .replace(/["'`]/g, "")
        .replace(/[_-]+/g, " ")
        .replace(/[()[\]{}:,;|]+/g, " ")
        .replace(/[.!?]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const canonical = canonicalizeDomainWarning(normalized);
    const source = canonical ?? normalized;

    return dedupe(
        source
            .split(" ")
            .map(normalizeWarningToken)
            .filter((token): token is string => Boolean(token)),
    )
        .sort((left, right) => left.localeCompare(right))
        .join(" ")
        .trim();
}

function analyzeOverseerReport(reportText: string): { healthy: boolean; issueSignatures: string[] } {
    const lines = reportText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const issues: string[] = [];
    let inIssuesSection = false;
    let explicitNoIssues = false;

    for (const rawLine of lines) {
        const line = rawLine.replace(/[：:]\s*$/, "");
        const issuesHeading = /^(\d+\.\s*)?(issues found|문제|발견된 문제|이슈)/i.test(line);
        const sectionEnd = /^(\d+\.\s*)?(top 3 recommended actions|recommended actions|current status|권장 조치|추천 작업|현재 상태)/i.test(line);

        if (!inIssuesSection && issuesHeading) {
            inIssuesSection = true;
            const inline = stripListMarker(rawLine.split(/[：:]/).slice(1).join(":").trim());
            if (/^(none|no issues|없음|이상 없음)$/i.test(inline)) {
                explicitNoIssues = true;
            } else if (inline) {
                issues.push(inline);
            }
            continue;
        }

        if (!inIssuesSection) {
            continue;
        }

        if (sectionEnd) {
            break;
        }

        const cleaned = stripListMarker(rawLine);
        if (!cleaned) {
            continue;
        }

        if (/^(none|no issues|없음|이상 없음)$/i.test(cleaned)) {
            explicitNoIssues = true;
            issues.length = 0;
            break;
        }

        issues.push(cleaned);
    }

    const issueSignatures = dedupe(issues);
    const healthy = explicitNoIssues || (inIssuesSection && issueSignatures.length === 0);

    return {
        healthy,
        issueSignatures,
    };
}

function toSuccessHistoryEntry(report: OverseerReport): OverseerSuccessHistoryEntry {
    const analysis = analyzeOverseerReport(report.report);
    return {
        kind: "success",
        ...report,
        healthy: analysis.healthy,
        issueSignatures: analysis.issueSignatures,
    };
}

function parseHistoryEntry(line: string): OverseerHistoryEntry | null {
    try {
        const parsed = JSON.parse(line) as Record<string, unknown>;

        if (
            parsed.kind === "failure"
            && typeof parsed.generatedAt === "string"
            && typeof parsed.error === "string"
        ) {
            return {
                kind: "failure",
                generatedAt: parsed.generatedAt,
                error: parsed.error,
                report: typeof parsed.report === "string" ? parsed.report : `Overseer auto-run failed: ${parsed.error}`,
            };
        }

        if (
            typeof parsed.generatedAt !== "string"
            || typeof parsed.model !== "string"
            || typeof parsed.logLines !== "number"
            || typeof parsed.manifestsRead !== "number"
            || typeof parsed.report !== "string"
        ) {
            return null;
        }

        return parsed.kind === "success"
            ? {
                kind: "success",
                generatedAt: parsed.generatedAt,
                model: parsed.model,
                logLines: parsed.logLines,
                manifestsRead: parsed.manifestsRead,
                report: parsed.report,
                healthy: Boolean(parsed.healthy),
                issueSignatures: Array.isArray(parsed.issueSignatures)
                    ? dedupe(parsed.issueSignatures.filter((value): value is string => typeof value === "string"))
                    : analyzeOverseerReport(parsed.report).issueSignatures,
            }
            : toSuccessHistoryEntry({
                generatedAt: parsed.generatedAt,
                model: parsed.model,
                logLines: parsed.logLines,
                manifestsRead: parsed.manifestsRead,
                report: parsed.report,
            });
    } catch {
        return null;
    }
}

export function isValidOverseerHistoryDayKey(dayKey: string): boolean {
    return DAY_KEY_PATTERN.test(dayKey);
}

export function getOverseerHistoryDir(): string {
    return path.join(systemDir(), "overseer-history");
}

export function getOverseerHistoryFilePath(dayKey: string): string {
    return path.join(getOverseerHistoryDir(), `${dayKey}.jsonl`);
}

export function getLastOverseerReportPath(): string {
    return path.join(systemDir(), "overseer-last-report.json");
}

function warningAckPath(): string {
    return path.join(systemDir(), "overseer-warning-acks.json");
}

export function saveLastOverseerReport(report: OverseerReport): void {
    const filePath = getLastOverseerReportPath();
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");
}

export function appendOverseerReportHistory(report: OverseerReport): void {
    const filePath = getOverseerHistoryFilePath(historyDayKeyFromReport(report));
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(toSuccessHistoryEntry(report))}\n`, "utf-8");
}

export function appendOverseerFailureHistory(error: string, generatedAt = new Date().toISOString()): void {
    const filePath = getOverseerHistoryFilePath(generatedAt.slice(0, 10));
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify({
        kind: "failure",
        generatedAt,
        error,
        report: `Overseer auto-run failed: ${error}`,
    } satisfies OverseerFailureHistoryEntry)}\n`, "utf-8");
}

export function loadOverseerWarningAcknowledgements(): Record<string, OverseerWarningAcknowledgement> {
    const raw = loadJsonFile<Record<string, OverseerWarningAcknowledgement>>(warningAckPath(), {});
    const acknowledgements: Record<string, OverseerWarningAcknowledgement> = {};

    for (const [warningKey, value] of Object.entries(raw)) {
        if (
            value
            && typeof value.warning === "string"
            && typeof value.acknowledgedAt === "string"
            && typeof value.lastSeenAt === "string"
        ) {
            acknowledgements[warningKey] = {
                warningKey,
                warning: value.warning,
                acknowledgedAt: value.acknowledgedAt,
                lastSeenAt: value.lastSeenAt,
                ...(typeof value.note === "string" && value.note.trim() ? { note: value.note.trim() } : {}),
            };
        }
    }

    return acknowledgements;
}

function saveOverseerWarningAcknowledgements(acknowledgements: Record<string, OverseerWarningAcknowledgement>): void {
    saveJsonFile(warningAckPath(), acknowledgements);
}

export function acknowledgeOverseerWarning(input: {
    warning?: string;
    warningKey?: string;
    lastSeenAt?: string;
    note?: string;
    acknowledgedAt?: string;
}): OverseerWarningAcknowledgement {
    const warning = String(input.warning ?? "").trim();
    const warningKey = String(input.warningKey ?? "").trim() || normalizeOverseerWarningKey(warning);

    if (!warningKey) {
        throw new Error("warning or warningKey is required");
    }

    const acknowledgements = loadOverseerWarningAcknowledgements();
    const acknowledgedAt = input.acknowledgedAt ?? new Date().toISOString();
    const acknowledgement: OverseerWarningAcknowledgement = {
        warningKey,
        warning: warning || acknowledgements[warningKey]?.warning || warningKey,
        acknowledgedAt,
        lastSeenAt: input.lastSeenAt?.trim() || acknowledgedAt,
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    };

    acknowledgements[warningKey] = acknowledgement;
    saveOverseerWarningAcknowledgements(acknowledgements);
    return acknowledgement;
}

export function clearOverseerWarningAcknowledgement(input: {
    warning?: string;
    warningKey?: string;
}): { removed: boolean; warningKey: string } {
    const warningKey = String(input.warningKey ?? "").trim() || normalizeOverseerWarningKey(String(input.warning ?? ""));
    if (!warningKey) {
        throw new Error("warning or warningKey is required");
    }

    const acknowledgements = loadOverseerWarningAcknowledgements();
    const removed = warningKey in acknowledgements;
    if (removed) {
        delete acknowledgements[warningKey];
        saveOverseerWarningAcknowledgements(acknowledgements);
    }

    return { removed, warningKey };
}

export function loadLastOverseerReport(): OverseerReport | null {
    const filePath = getLastOverseerReportPath();
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as OverseerReport;
    } catch {
        return null;
    }
}

export function loadOverseerHistory(options: { dayKey?: string; limit?: number } = {}): OverseerHistorySnapshot {
    const directory = getOverseerHistoryDir();
    const limit = normalizeHistoryLimit(options.limit);

    const files = options.dayKey
        ? [getOverseerHistoryFilePath(options.dayKey)].filter((filePath) => fs.existsSync(filePath))
        : (fs.existsSync(directory)
            ? fs.readdirSync(directory)
                .filter((fileName) => fileName.endsWith(".jsonl"))
                .sort((left, right) => right.localeCompare(left))
                .map((fileName) => path.join(directory, fileName))
            : []);

    const entries: OverseerHistoryEntry[] = [];

    for (const filePath of files) {
        const lines = fs.readFileSync(filePath, "utf-8")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .reverse();

        for (const line of lines) {
            const entry = parseHistoryEntry(line);
            if (!entry) {
                continue;
            }

            entries.push(entry);
            if (entries.length >= limit) {
                return {
                    directory,
                    files,
                    ...(options.dayKey ? { dayKey: options.dayKey } : {}),
                    limit,
                    entries,
                };
            }
        }
    }

    return {
        directory,
        files,
        ...(options.dayKey ? { dayKey: options.dayKey } : {}),
        limit,
        entries,
    };
}

export function summarizeOverseerHistory(options: { windowHours?: number; limit?: number; now?: Date } = {}): OverseerHistorySummary {
    const windowHours = normalizeSummaryWindowHours(options.windowHours);
    const now = options.now ?? new Date();
    const sinceMs = now.getTime() - windowHours * 60 * 60 * 1000;
    const history = loadOverseerHistory({ limit: options.limit ?? MAX_HISTORY_LIMIT });
    const recentEntries = history.entries.filter((entry) => {
        const timestamp = Date.parse(entry.generatedAt);
        return Number.isFinite(timestamp) && timestamp >= sinceMs;
    });

    const repeatedWarnings = new Map<string, OverseerRepeatedWarning>();
    const acknowledgements = loadOverseerWarningAcknowledgements();

    for (const entry of recentEntries) {
        if (entry.kind !== "success") {
            continue;
        }

        for (const issue of dedupe(entry.issueSignatures)) {
            const warningKey = normalizeOverseerWarningKey(issue);
            if (!warningKey) {
                continue;
            }

            const existing = repeatedWarnings.get(warningKey);
            if (existing) {
                existing.count += 1;
                if (entry.generatedAt < existing.firstSeenAt) {
                    existing.firstSeenAt = entry.generatedAt;
                }
                if (entry.generatedAt > existing.lastSeenAt) {
                    existing.lastSeenAt = entry.generatedAt;
                    existing.warning = issue;
                }
            } else {
                repeatedWarnings.set(warningKey, {
                    warningKey,
                    warning: issue,
                    count: 1,
                    firstSeenAt: entry.generatedAt,
                    lastSeenAt: entry.generatedAt,
                });
            }
        }
    }

    const successfulRuns = recentEntries.filter((entry) => entry.kind === "success").length;
    const failedRuns = recentEntries.filter((entry) => entry.kind === "failure").length;
    const recentFailures = recentEntries
        .filter((entry): entry is OverseerFailureHistoryEntry => entry.kind === "failure")
        .slice(0, 10)
        .map((entry) => ({ generatedAt: entry.generatedAt, error: entry.error }));
    const warningCandidates = [...repeatedWarnings.values()]
        .filter((warning) => warning.count > 1)
        .sort((left, right) => right.count - left.count || right.lastSeenAt.localeCompare(left.lastSeenAt));
    const activeRepeatedWarnings: OverseerRepeatedWarning[] = [];
    const acknowledgedWarnings: OverseerRepeatedWarning[] = [];

    for (const warning of warningCandidates) {
        const acknowledgement = acknowledgements[warning.warningKey];
        const payload = {
            ...warning,
            ...(acknowledgement?.acknowledgedAt ? { acknowledgedAt: acknowledgement.acknowledgedAt } : {}),
            ...(acknowledgement?.note ? { note: acknowledgement.note } : {}),
        };

        if (acknowledgement && acknowledgement.lastSeenAt >= warning.lastSeenAt) {
            acknowledgedWarnings.push(payload);
        } else {
            activeRepeatedWarnings.push(payload);
        }
    }

    return {
        windowHours,
        since: new Date(sinceMs).toISOString(),
        sampledEntries: recentEntries.length,
        totalEntries: history.entries.length,
        successfulRuns,
        failedRuns,
        recentFailureCount: failedRuns,
        lastRunAt: history.entries[0]?.generatedAt,
        lastHealthyReportAt: history.entries.find((entry) => entry.kind === "success" && entry.healthy)?.generatedAt,
        lastFailureAt: history.entries.find((entry) => entry.kind === "failure")?.generatedAt,
        repeatedWarnings: activeRepeatedWarnings,
        acknowledgedWarnings,
        activeRepeatedWarningCount: activeRepeatedWarnings.length,
        acknowledgedWarningCount: acknowledgedWarnings.length,
        recentFailures,
    };
}
