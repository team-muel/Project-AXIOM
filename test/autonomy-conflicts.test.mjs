import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeEval, parseLastJsonLine } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function currentSeoulDayKey() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

async function runConflictScenario({ controlState, manifests = [], runLedger = [] }) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-conflict-test-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    const systemDir = path.join(outputDir, "_system");
    const dayKey = currentSeoulDayKey();

    fs.mkdirSync(path.join(systemDir, "runs"), { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(systemDir, "state.json"), JSON.stringify(controlState, null, 2));
    fs.writeFileSync(path.join(systemDir, "runs", `${dayKey}.json`), JSON.stringify(runLedger, null, 2));

    for (const manifest of manifests) {
        const songDir = path.join(outputDir, manifest.songId);
        fs.mkdirSync(songDir, { recursive: true });
        fs.writeFileSync(path.join(songDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    }

    const { stdout } = await runNodeEval(`
        globalThis.fetch = async (url) => {
            if (String(url).includes("/api/tags")) {
                return { ok: true, status: 200, json: async () => ({ models: [] }) };
            }
            throw new Error("Unexpected fetch: " + url);
        };
        const { setLogStream } = await import("./dist/logging/logger.js");
        setLogStream("stderr");
        const { triggerAutonomyRun } = await import("./dist/autonomy/controller.js");
        try {
            await triggerAutonomyRun("api");
            console.log(JSON.stringify({ ok: true }));
        } catch (error) {
            console.log(JSON.stringify({
                ok: false,
                name: error?.name,
                message: error?.message,
                details: error?.details,
            }));
        }
    `, {
        cwd: repoRoot,
        env: {
            OUTPUT_DIR: outputDir,
            LOG_DIR: logDir,
            OLLAMA_URL: "http://127.0.0.1:11434",
            AUTONOMY_ENABLED: "true",
            AUTONOMY_SCHEDULER_TIMEZONE: "Asia/Seoul",
            AUTONOMY_STALE_LOCK_MS: "86400000",
            AUTONOMY_AUTO_CLEAR_STALE_LOCKS: "false",
            AUTONOMY_MAX_ATTEMPTS_PER_DAY: "2",
            LOG_LEVEL: "error",
        },
    });

    const result = parseLastJsonLine(stdout);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return result;
}

test("blocks trigger when active run lock exists", async () => {
    const result = await runConflictScenario({
        controlState: {
            paused: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
            activeRun: {
                runId: "active-run",
                promptHash: "hash-1",
                acquiredAt: "2026-04-10T00:00:00.000Z",
                state: "running",
                jobId: "job-1",
            },
        },
    });

    assert.equal(result.ok, false);
    assert.equal(result.name, "AutonomyConflictError");
    assert.match(result.message, /already active/);
    assert.equal(result.details.activeRun.runId, "active-run");
});

test("blocks trigger when daily cap is reached", async () => {
    const result = await runConflictScenario({
        controlState: {
            paused: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
        },
        runLedger: [
            {
                runId: "run-1",
                createdAt: "2026-04-10T01:00:00.000Z",
                promptHash: "hash-a",
                status: "approved",
            },
            {
                runId: "run-2",
                createdAt: "2026-04-10T02:00:00.000Z",
                promptHash: "hash-b",
                status: "failed",
            },
        ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.name, "AutonomyConflictError");
    assert.match(result.message, /daily autonomy attempt cap reached/);
    assert.equal(result.details.dailyCap.attemptsUsed, 2);
    assert.equal(result.details.dailyCap.capped, true);
});

test("blocks trigger when pending approval manifest exists", async () => {
    const result = await runConflictScenario({
        controlState: {
            paused: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
        },
        manifests: [
            {
                songId: "pending-song",
                state: "DONE",
                meta: {
                    songId: "pending-song",
                    prompt: "awaiting approval",
                    form: "miniature",
                    source: "autonomy",
                    autonomyRunId: "run-pending",
                    promptHash: "hash-pending",
                    createdAt: "2026-04-10T03:00:00.000Z",
                    updatedAt: "2026-04-10T03:05:00.000Z",
                },
                artifacts: { midi: "outputs/pending-song/composition.mid" },
                approvalStatus: "pending",
                stateHistory: [
                    { state: "IDLE", timestamp: "2026-04-10T03:00:00.000Z" },
                    { state: "COMPOSE", timestamp: "2026-04-10T03:00:01.000Z" },
                    { state: "DONE", timestamp: "2026-04-10T03:05:00.000Z" },
                ],
                updatedAt: "2026-04-10T03:05:00.000Z",
            },
        ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.name, "AutonomyConflictError");
    assert.match(result.message, /pending approval exists/);
    assert.equal(result.details.pendingApproval.songId, "pending-song");
});