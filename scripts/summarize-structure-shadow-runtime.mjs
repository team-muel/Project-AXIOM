import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readOption(name) {
    const prefix = `--${name}=`;
    const exactIndex = process.argv.indexOf(`--${name}`);
    if (exactIndex >= 0) {
        return process.argv[exactIndex + 1];
    }

    const prefixed = process.argv.find((entry) => entry.startsWith(prefix));
    if (prefixed) {
        return prefixed.slice(prefix.length);
    }

    return undefined;
}

function clampInteger(value, fallback, min, max) {
    const parsed = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
            ? Number(value)
            : Number.NaN;

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function fail(message, details) {
    console.error(JSON.stringify({
        ok: false,
        message,
        details,
    }, null, 2));
    process.exit(1);
}

const outputDir = readOption("outputDir") || process.env.OUTPUT_DIR;
if (outputDir) {
    process.env.OUTPUT_DIR = outputDir;
}

const windowHours = clampInteger(
    readOption("windowHours") || process.env.AXIOM_SHADOW_RUNTIME_WINDOW_HOURS,
    24,
    1,
    24 * 30,
);
const limit = clampInteger(
    readOption("limit") || process.env.AXIOM_SHADOW_RUNTIME_LIMIT,
    200,
    1,
    500,
);
const nowText = readOption("now") || process.env.AXIOM_SHADOW_RUNTIME_NOW;
const now = nowText ? new Date(nowText) : new Date();

if (Number.isNaN(now.getTime())) {
    fail("now must be a valid ISO timestamp", { now: nowText });
}

const distModulePath = path.resolve(__dirname, "../dist/pipeline/structureShadowHistory.js");

let shadowHistoryModule;
try {
    shadowHistoryModule = await import(pathToFileURL(distModulePath).href);
} catch (error) {
    fail("Built shadow history module not found. Run npm run build first.", {
        distModulePath,
        error: error instanceof Error ? error.message : String(error),
    });
}

const summary = shadowHistoryModule.summarizeStructureShadowHistory({ windowHours, limit, now });

console.log(JSON.stringify({
    ok: true,
    observedAt: now.toISOString(),
    windowHours,
    limit,
    historyDir: shadowHistoryModule.getStructureShadowHistoryDir(),
    summary,
}, null, 2));