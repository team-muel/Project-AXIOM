import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 500;
const DEFAULT_SUMMARY_WINDOW_HOURS = 24;
const MAX_SUMMARY_WINDOW_HOURS = 24 * 30;
export const STRUCTURE_SHADOW_HIGH_CONFIDENCE = 0.7;

export interface StructureShadowHistoryEntry {
    kind: "structure_shadow";
    generatedAt: string;
    songId: string;
    snapshotId: string;
    candidateCount: number;
    selectedCandidateId: string | null;
    heuristicTopCandidateId: string;
    learnedTopCandidateId: string;
    confidence: number;
    disagreement: boolean;
    reason?: string;
    scorePaths: string[];
}

export interface StructureShadowHistorySnapshot {
    directory: string;
    files: string[];
    dayKey?: string;
    limit: number;
    entries: StructureShadowHistoryEntry[];
}

export interface StructureShadowHistoryRecentDisagreement {
    generatedAt: string;
    songId: string;
    snapshotId: string;
    selectedCandidateId: string | null;
    heuristicTopCandidateId: string;
    learnedTopCandidateId: string;
    confidence: number;
    reason?: string;
}

export interface StructureShadowHistorySnapshotRow {
    snapshotId: string;
    sampledEntries: number;
    disagreementCount: number;
    highConfidenceDisagreementCount: number;
    agreementRate: number | null;
    averageConfidence: number | null;
    lastSeenAt: string | null;
}

export interface StructureShadowHistorySummary {
    windowHours: number;
    since: string;
    sampledEntries: number;
    totalEntries: number;
    disagreementCount: number;
    highConfidenceDisagreementCount: number;
    agreementRate: number | null;
    averageConfidence: number | null;
    lastSeenAt: string | null;
    snapshotRows: StructureShadowHistorySnapshotRow[];
    recentDisagreements: StructureShadowHistoryRecentDisagreement[];
}

function systemDir(): string {
    return path.join(config.outputDir, "_system");
}

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function normalizeHistoryLimit(limit?: number): number {
    const value = limit ?? DEFAULT_HISTORY_LIMIT;
    return Math.min(Math.max(Math.trunc(value), 1), MAX_HISTORY_LIMIT);
}

function normalizeSummaryWindowHours(windowHours?: number): number {
    const value = windowHours ?? DEFAULT_SUMMARY_WINDOW_HOURS;
    return Math.min(Math.max(windowHours ?? value, 1), MAX_SUMMARY_WINDOW_HOURS);
}

function toTimestampMs(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function roundMetric(value: number | null | undefined, digits = 4): number | null {
    return typeof value === "number" && Number.isFinite(value)
        ? Number(value.toFixed(digits))
        : null;
}

function averageNumbers(total: number, count: number): number | null {
    return count > 0 ? Number((total / count).toFixed(4)) : null;
}

function historyDayKeyFromGeneratedAt(generatedAt: string): string {
    const parsed = Date.parse(generatedAt);
    if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString().slice(0, 10);
    }

    return new Date().toISOString().slice(0, 10);
}

function parseHistoryEntry(line: string): StructureShadowHistoryEntry | null {
    try {
        const parsed = JSON.parse(line) as Partial<StructureShadowHistoryEntry>;
        if (
            parsed.kind !== "structure_shadow"
            || typeof parsed.generatedAt !== "string"
            || typeof parsed.songId !== "string"
            || typeof parsed.snapshotId !== "string"
            || typeof parsed.heuristicTopCandidateId !== "string"
            || typeof parsed.learnedTopCandidateId !== "string"
            || typeof parsed.disagreement !== "boolean"
        ) {
            return null;
        }

        return {
            kind: "structure_shadow",
            generatedAt: parsed.generatedAt,
            songId: parsed.songId,
            snapshotId: parsed.snapshotId,
            candidateCount: typeof parsed.candidateCount === "number" ? parsed.candidateCount : 0,
            selectedCandidateId: typeof parsed.selectedCandidateId === "string" ? parsed.selectedCandidateId : null,
            heuristicTopCandidateId: parsed.heuristicTopCandidateId,
            learnedTopCandidateId: parsed.learnedTopCandidateId,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
            disagreement: parsed.disagreement,
            ...(typeof parsed.reason === "string" && parsed.reason.trim() ? { reason: parsed.reason.trim() } : {}),
            scorePaths: Array.isArray(parsed.scorePaths)
                ? parsed.scorePaths.map((value) => String(value))
                : [],
        };
    } catch {
        return null;
    }
}

export function isValidStructureShadowHistoryDayKey(dayKey: string): boolean {
    return DAY_KEY_PATTERN.test(dayKey);
}

export function getStructureShadowHistoryDir(): string {
    return path.join(systemDir(), "ml", "runtime", "structure-rank-v1-shadow-history");
}

export function getStructureShadowHistoryFilePath(dayKey: string): string {
    return path.join(getStructureShadowHistoryDir(), `${dayKey}.jsonl`);
}

export function appendStructureShadowHistory(entry: StructureShadowHistoryEntry): void {
    const filePath = getStructureShadowHistoryFilePath(historyDayKeyFromGeneratedAt(entry.generatedAt));
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf-8");
}

export function loadStructureShadowHistory(options: { dayKey?: string; limit?: number } = {}): StructureShadowHistorySnapshot {
    const directory = getStructureShadowHistoryDir();
    const limit = normalizeHistoryLimit(options.limit);

    const files = options.dayKey
        ? [getStructureShadowHistoryFilePath(options.dayKey)].filter((filePath) => fs.existsSync(filePath))
        : (fs.existsSync(directory)
            ? fs.readdirSync(directory)
                .filter((fileName) => fileName.endsWith(".jsonl"))
                .sort((left, right) => right.localeCompare(left))
                .map((fileName) => path.join(directory, fileName))
            : []);

    const entries: StructureShadowHistoryEntry[] = [];

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

export function summarizeStructureShadowHistory(options: { windowHours?: number; limit?: number; now?: Date } = {}): StructureShadowHistorySummary {
    const windowHours = normalizeSummaryWindowHours(options.windowHours);
    const now = options.now ?? new Date();
    const sinceMs = now.getTime() - windowHours * 60 * 60 * 1000;
    const history = loadStructureShadowHistory({ limit: options.limit ?? MAX_HISTORY_LIMIT });
    const recentEntries = history.entries.filter((entry) => {
        const timestamp = toTimestampMs(entry.generatedAt);
        return timestamp !== null && timestamp >= sinceMs;
    });
    const disagreementEntries = recentEntries.filter((entry) => entry.disagreement);
    const confidenceValues = recentEntries
        .map((entry) => entry.confidence)
        .filter((value) => Number.isFinite(value));
    const snapshotBuckets = new Map<string, {
        sampledEntries: number;
        disagreementCount: number;
        highConfidenceDisagreementCount: number;
        totalConfidence: number;
        confidenceCount: number;
        lastSeenAt: string | null;
    }>();

    for (const entry of recentEntries) {
        const bucket = snapshotBuckets.get(entry.snapshotId) ?? {
            sampledEntries: 0,
            disagreementCount: 0,
            highConfidenceDisagreementCount: 0,
            totalConfidence: 0,
            confidenceCount: 0,
            lastSeenAt: null,
        };
        bucket.sampledEntries += 1;
        if (entry.disagreement) {
            bucket.disagreementCount += 1;
            if (entry.confidence >= STRUCTURE_SHADOW_HIGH_CONFIDENCE) {
                bucket.highConfidenceDisagreementCount += 1;
            }
        }
        if (Number.isFinite(entry.confidence)) {
            bucket.totalConfidence += entry.confidence;
            bucket.confidenceCount += 1;
        }
        if (!bucket.lastSeenAt || entry.generatedAt > bucket.lastSeenAt) {
            bucket.lastSeenAt = entry.generatedAt;
        }
        snapshotBuckets.set(entry.snapshotId, bucket);
    }

    return {
        windowHours,
        since: new Date(sinceMs).toISOString(),
        sampledEntries: recentEntries.length,
        totalEntries: history.entries.length,
        disagreementCount: disagreementEntries.length,
        highConfidenceDisagreementCount: disagreementEntries.filter(
            (entry) => entry.confidence >= STRUCTURE_SHADOW_HIGH_CONFIDENCE,
        ).length,
        agreementRate: recentEntries.length > 0
            ? Number(((recentEntries.length - disagreementEntries.length) / recentEntries.length).toFixed(4))
            : null,
        averageConfidence: confidenceValues.length > 0
            ? averageNumbers(confidenceValues.reduce((sum, value) => sum + value, 0), confidenceValues.length)
            : null,
        lastSeenAt: recentEntries[0]?.generatedAt ?? null,
        snapshotRows: Array.from(snapshotBuckets.entries())
            .map(([snapshotId, bucket]) => ({
                snapshotId,
                sampledEntries: bucket.sampledEntries,
                disagreementCount: bucket.disagreementCount,
                highConfidenceDisagreementCount: bucket.highConfidenceDisagreementCount,
                agreementRate: bucket.sampledEntries > 0
                    ? Number(((bucket.sampledEntries - bucket.disagreementCount) / bucket.sampledEntries).toFixed(4))
                    : null,
                averageConfidence: averageNumbers(bucket.totalConfidence, bucket.confidenceCount),
                lastSeenAt: bucket.lastSeenAt,
            }))
            .sort((left, right) => (
                right.sampledEntries - left.sampledEntries
                || (toTimestampMs(right.lastSeenAt ?? undefined) ?? 0) - (toTimestampMs(left.lastSeenAt ?? undefined) ?? 0)
                || left.snapshotId.localeCompare(right.snapshotId)
            ))
            .slice(0, 5),
        recentDisagreements: disagreementEntries
            .slice(0, 5)
            .map((entry) => ({
                generatedAt: entry.generatedAt,
                songId: entry.songId,
                snapshotId: entry.snapshotId,
                selectedCandidateId: entry.selectedCandidateId,
                heuristicTopCandidateId: entry.heuristicTopCandidateId,
                learnedTopCandidateId: entry.learnedTopCandidateId,
                confidence: roundMetric(entry.confidence) ?? 0,
                ...(entry.reason ? { reason: entry.reason } : {}),
            })),
    };
}