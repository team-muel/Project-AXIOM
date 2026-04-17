import "dotenv/config";
import type { LogLevel } from "./logging/logger.js";

function env(key: string, fallback: string): string {
    return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
    const value = Number.parseInt(process.env[key] ?? "", 10);
    return Number.isFinite(value) ? value : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) return fallback;
    return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export const config = {
    port: envInt("PORT", 3100),
    mcpHttpPort: envInt("MCP_HTTP_PORT", 3210),
    mcpWorkerAuthToken: env("MCP_WORKER_AUTH_TOKEN", ""),
    logLevel: env("LOG_LEVEL", "info") as LogLevel,
    outputDir: env("OUTPUT_DIR", "outputs"),
    logDir: env("LOG_DIR", "logs"),
    maxRetries: envInt("MAX_RETRIES", 2),
    pythonBin: env("PYTHON_BIN", "python"),
    soundfontPath: env("SOUNDFONT_PATH", "assets/soundfonts/MuseScore_General.sf3"),
    ffmpegBin: env("FFMPEG_BIN", "ffmpeg"),
    ollamaUrl: env("OLLAMA_URL", "http://localhost:11434"),
    ollamaModel: env("OLLAMA_MODEL", "gemma4:latest"),
    overseerLogLines: envInt("OVERSEER_LOG_LINES", 80),
    overseerManifestCount: envInt("OVERSEER_MANIFEST_COUNT", 5),
    overseerAutoEnabled: envBool("OVERSEER_AUTO_ENABLED", true),
    overseerIntervalMs: envInt("OVERSEER_INTERVAL_MS", 600_000),
    autonomyEnabled: envBool("AUTONOMY_ENABLED", true),
    autonomyLogLines: envInt("AUTONOMY_LOG_LINES", 60),
    autonomyManifestCount: envInt("AUTONOMY_MANIFEST_COUNT", 8),
    autonomySchedulerEnabled: envBool("AUTONOMY_SCHEDULER_ENABLED", false),
    autonomySchedulerPollMs: envInt("AUTONOMY_SCHEDULER_POLL_MS", 30_000),
    autonomySchedulerIntervalMs: envInt("AUTONOMY_SCHEDULER_INTERVAL_MS", 0),
    autonomySchedulerTime: env("AUTONOMY_SCHEDULER_TIME", "09:00"),
    autonomySchedulerTimezone: env("AUTONOMY_SCHEDULER_TIMEZONE", "UTC"),
    autonomyMaxAttemptsPerDay: envInt("AUTONOMY_MAX_ATTEMPTS_PER_DAY", 1),
    autonomyStaleLockMs: envInt("AUTONOMY_STALE_LOCK_MS", 3_600_000),
    autonomyAutoClearStaleLocks: envBool("AUTONOMY_AUTO_CLEAR_STALE_LOCKS", true),
    retryBackoffMs: envInt("RETRY_BACKOFF_MS", 2_000),
    composeWorkerTimeoutMs: envInt("COMPOSE_WORKER_TIMEOUT_MS", 60_000),
    humanizeWorkerTimeoutMs: envInt("HUMANIZE_WORKER_TIMEOUT_MS", 60_000),
    renderWorkerTimeoutMs: envInt("RENDER_WORKER_TIMEOUT_MS", 120_000),
    // MusicGen-large 생성은 오래 걸리므로 30분 타임아웃까지 허용한다.
    musicgenTimeoutMs: envInt("MUSICGEN_TIMEOUT_MS", 1_800_000),
    structureRerankerShadowEnabled: envBool("STRUCTURE_RERANKER_SHADOW_ENABLED", false),
    structureRerankerShadowSnapshot: env("STRUCTURE_RERANKER_SHADOW_SNAPSHOT", ""),
    structureRerankerPromotionEnabled: envBool("STRUCTURE_RERANKER_PROMOTION_ENABLED", false),
} as const;
