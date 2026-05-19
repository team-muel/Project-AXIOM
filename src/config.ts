import "dotenv/config";
import type { LogLevel } from "./logging/logger.js";
import type { GenerationStrategy } from "./core/pipeline/types.js";

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

/**
 * Resolves the active GenerationStrategy from env vars.
 *
 * Resolution order:
 *   1. AXIOM_GENERATION_STRATEGY — explicit override (highest priority)
 *   2. Derived from LEARNED_SYMBOLIC_BACKEND (backward compat):
 *      - template      → template_first
 *      - notagen_mock  → template_first  (mock = CI/test, keep template_first semantics)
 *      - notagen_local → notagen_first
 *   3. Fallback: template_first
 *
 * Note: "hybrid_notagen_with_template_baseline" is NOT automatically inferred —
 *   it must be set explicitly via AXIOM_GENERATION_STRATEGY because it implies
 *   running multiple concurrent generation passes (NotaGen N + music21 baseline 1).
 */
function resolveGenerationStrategy(
    explicit: string,
    backend: string,
): GenerationStrategy {
    const valid: GenerationStrategy[] = [
        "template_first",
        "notagen_first",
        "hybrid_notagen_with_template_baseline",
    ];
    if (valid.includes(explicit as GenerationStrategy)) {
        return explicit as GenerationStrategy;
    }
    // Derive from backend
    if (backend === "notagen_local") {
        return "notagen_first";
    }
    return "template_first";
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
    // Learned symbolic backend selection.
    //   template      – music21 path (default; NotaGen never loaded)
    //   notagen_mock  – deterministic mock ABC returned without loading a model
    //   notagen_local – real model inference using the configured checkpoint
    learnedSymbolicBackend: env("LEARNED_SYMBOLIC_BACKEND", "template") as "template" | "notagen_mock" | "notagen_local",
    notagenModelPath: env("NOTAGEN_MODEL_PATH", ""),
    notagenTokenizerPath: env("NOTAGEN_TOKENIZER_PATH", ""),
    notagenDevice: env("NOTAGEN_DEVICE", "cpu") as "cpu" | "cuda" | "mps",
    notagenMaxTokens: envInt("NOTAGEN_MAX_TOKENS", 2048),
    notagenTimeoutMs: envInt("NOTAGEN_TIMEOUT_MS", 120_000),
    // Maximum number of additional inference attempts when ABC validation fails
    notagenResampleBudget: envInt("NOTAGEN_RESAMPLE_BUDGET", 2),
    // Generation strategy — controls how structure candidates are generated.
    //   template_first                      – music21 is primary (default, CI safe)
    //   notagen_first                       – NotaGen single candidate (auto-inferred when notagen_local)
    //   hybrid_notagen_with_template_baseline – N NotaGen + 1 music21 baseline (R&D quality mode)
    // Resolution order: AXIOM_GENERATION_STRATEGY → derived from LEARNED_SYMBOLIC_BACKEND → template_first
    generationStrategy: resolveGenerationStrategy(
        env("AXIOM_GENERATION_STRATEGY", ""),
        env("LEARNED_SYMBOLIC_BACKEND", "template"),
    ),
} as const;
