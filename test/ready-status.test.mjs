import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeEval, parseLastJsonLine } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("ready endpoint returns not_ready when Python runtime is unavailable", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-ready-status-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    const { stdout } = await runNodeEval(`
        import express from "express";
        import healthRouter from "./dist/routes/health.js";

        const app = express();
        app.use(healthRouter);
        const server = app.listen(0, async () => {
            try {
                const address = server.address();
                const response = await fetch("http://127.0.0.1:" + address.port + "/ready");
                const payload = await response.json();
                console.log(JSON.stringify({ statusCode: response.status, payload }));
            } finally {
                server.close();
            }
        });
    `, {
        cwd: repoRoot,
        env: {
            OUTPUT_DIR: outputDir,
            LOG_DIR: logDir,
            PYTHON_BIN: path.join(tempRoot, "missing-python.exe"),
            SOUNDFONT_PATH: path.join(tempRoot, "missing.sf2"),
            FFMPEG_BIN: "missing-ffmpeg-binary",
            LOG_LEVEL: "error",
        },
    });

    const result = parseLastJsonLine(stdout);
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.status, "not_ready");
    assert.equal(result.payload.capabilities.symbolicCompose, false);
    assert.equal(result.payload.capabilities.audioRender, false);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("ready endpoint reports not_ready when a required worker script is missing", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-ready-script-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    const { stdout } = await runNodeEval(`
        import express from "express";
        import fs from "node:fs";

        const originalExistsSync = fs.existsSync.bind(fs);
        const originalStatSync = fs.statSync.bind(fs);
        fs.existsSync = (targetPath) => String(targetPath).includes("compose.py")
            ? false
            : originalExistsSync(targetPath);
        fs.statSync = (targetPath, ...args) => {
            if (String(targetPath).includes("compose.py")) {
                throw new Error("mock missing compose worker");
            }
            return originalStatSync(targetPath, ...args);
        };

        const { default: healthRouter } = await import("./dist/routes/health.js");

        const app = express();
        app.use(healthRouter);
        const server = app.listen(0, async () => {
            try {
                const address = server.address();
                const response = await fetch("http://127.0.0.1:" + address.port + "/ready");
                const payload = await response.json();
                console.log(JSON.stringify({ statusCode: response.status, payload }));
            } finally {
                server.close();
            }
        });
    `, {
        cwd: repoRoot,
        env: {
            OUTPUT_DIR: outputDir,
            LOG_DIR: logDir,
            LOG_LEVEL: "error",
        },
    });

    const result = parseLastJsonLine(stdout);
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.status, "not_ready");
    assert.equal(result.payload.checks.workerScripts.symbolicCompose, false);
    assert.equal(result.payload.capabilities.symbolicCompose, false);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});