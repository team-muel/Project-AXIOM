import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogStream = "stdout" | "stderr";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    songId?: string;
    state?: string;
    [key: string]: unknown;
}

let logStream: LogStream = "stdout";

function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[config.logLevel];
}

function ensureLogDir(): void {
    if (!fs.existsSync(config.logDir)) {
        fs.mkdirSync(config.logDir, { recursive: true });
    }
}

export function setLogStream(stream: LogStream): void {
    logStream = stream;
}

function write(entry: LogEntry): void {
    const line = JSON.stringify(entry) + "\n";

    // stdout is the default for the HTTP server, but stdio MCP must keep stdout clean.
    const output = logStream === "stderr" ? process.stderr : process.stdout;
    output.write(line);

    // append to file
    ensureLogDir();
    const logPath = path.join(config.logDir, "runtime.jsonl");
    fs.appendFileSync(logPath, line, "utf-8");
}

export function log(
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>,
): void {
    if (!shouldLog(level)) return;
    write({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...extra,
    });
}

export const logger = {
    debug: (msg: string, extra?: Record<string, unknown>) => log("debug", msg, extra),
    info: (msg: string, extra?: Record<string, unknown>) => log("info", msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => log("warn", msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => log("error", msg, extra),
};
