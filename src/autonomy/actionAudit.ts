import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { getAutonomyDayKey } from "./calendar.js";

export type AutonomyOperatorAction = "pause" | "resume" | "reconcile_lock" | "approve" | "reject";

export interface AutonomyOperatorMutationContext {
    actor?: string;
    approvedBy?: string;
    surface?: string;
    rollbackNote?: string;
    manualRecoveryNote?: string;
}

export interface AutonomyOperatorActionRecord {
    actor: string;
    surface: string;
    action: AutonomyOperatorAction;
    reason?: string;
    rollbackNote?: string;
    manualRecoveryNote?: string;
    input: Record<string, unknown>;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    artifactLinks: string[];
    approvedBy: string;
    observedAt: string;
}

interface RecordAutonomyOperatorActionOptions {
    context: AutonomyOperatorMutationContext;
    action: AutonomyOperatorAction;
    reason?: string;
    input?: Record<string, unknown>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    artifactLinks?: string[];
    observedAt?: string;
}

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function writeAtomicJson(filePath: string, payload: string): void {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, payload, "utf-8");
    fs.renameSync(tempPath, filePath);
}

function operatorActionsDir(): string {
    return path.join(config.outputDir, "_system", "operator-actions");
}

function latestOperatorActionPath(): string {
    return path.join(operatorActionsDir(), "latest.json");
}

function operatorActionHistoryPath(dayKey: string): string {
    return path.join(operatorActionsDir(), "history", `${dayKey}.jsonl`);
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

function outputRootLabel(): string {
    const normalized = compact(path.basename(path.resolve(config.outputDir)));
    return normalized || "outputs";
}

function normalizeArtifactSegment(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function outputArtifactLink(...segments: string[]): string {
    return path.posix.join(outputRootLabel(), ...segments.map(normalizeArtifactSegment));
}

export function recordAutonomyOperatorAction(
    options: RecordAutonomyOperatorActionOptions,
): AutonomyOperatorActionRecord {
    const observedAt = compact(options.observedAt) || new Date().toISOString();
    const surface = compact(options.context.surface) || "internal";
    const actor = compact(options.context.actor) || surface;
    const approvedBy = compact(options.context.approvedBy) || actor;
    const artifactLinks = Array.from(new Set((options.artifactLinks ?? [])
        .map((item) => compact(item))
        .filter(Boolean)));
    const record: AutonomyOperatorActionRecord = {
        actor,
        surface,
        action: options.action,
        ...(compact(options.reason) ? { reason: compact(options.reason) } : {}),
        ...(compact(options.context.rollbackNote) ? { rollbackNote: compact(options.context.rollbackNote) } : {}),
        ...(compact(options.context.manualRecoveryNote) ? { manualRecoveryNote: compact(options.context.manualRecoveryNote) } : {}),
        input: cloneRecord(options.input),
        before: cloneRecord(options.before),
        after: cloneRecord(options.after),
        artifactLinks,
        approvedBy,
        observedAt,
    };

    const dayKey = getAutonomyDayKey(observedAt);
    const latestPath = latestOperatorActionPath();
    const historyPath = operatorActionHistoryPath(dayKey);
    ensureDir(operatorActionsDir());
    ensureDir(path.dirname(historyPath));
    writeAtomicJson(latestPath, `${JSON.stringify(record, null, 2)}\n`);
    fs.appendFileSync(historyPath, `${JSON.stringify(record)}\n`, "utf-8");

    return record;
}