import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeEval, parseLastJsonLine } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function runOverseerScenario({ existingReport, existingHistory = {}, existingAcknowledgements = {}, existingManifests = [], evalCode }) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-overseer-last-report-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    const systemDir = path.join(outputDir, "_system");
    const historyDir = path.join(systemDir, "overseer-history");
    const acknowledgementPath = path.join(systemDir, "overseer-warning-acks.json");

    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
        path.join(logDir, "runtime.jsonl"),
        `${JSON.stringify({ timestamp: "2026-04-10T00:00:00.000Z", level: "info", message: "boot" })}\n`,
        "utf-8",
    );

    if (existingReport) {
        fs.mkdirSync(systemDir, { recursive: true });
        fs.writeFileSync(
            path.join(systemDir, "overseer-last-report.json"),
            JSON.stringify(existingReport, null, 2),
            "utf-8",
        );
    }

    for (const [dayKey, entries] of Object.entries(existingHistory)) {
        fs.mkdirSync(historyDir, { recursive: true });
        fs.writeFileSync(
            path.join(historyDir, `${dayKey}.jsonl`),
            entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
            "utf-8",
        );
    }

    for (const manifest of existingManifests) {
        const songDir = path.join(outputDir, manifest.songId);
        fs.mkdirSync(songDir, { recursive: true });
        fs.writeFileSync(
            path.join(songDir, "manifest.json"),
            JSON.stringify(manifest, null, 2),
            "utf-8",
        );
    }

    if (Object.keys(existingAcknowledgements).length > 0) {
        fs.mkdirSync(systemDir, { recursive: true });
        fs.writeFileSync(acknowledgementPath, JSON.stringify(existingAcknowledgements, null, 2), "utf-8");
    }

    const { stdout } = await runNodeEval(
        `
        const nativeFetch = globalThis.fetch;
        globalThis.fetch = async (url, options) => {
            if (String(url).includes("/api/generate")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        model: "gemma4:latest",
                        response: "auto overseer summary",
                        done: true,
                    }),
                };
            }
            if (String(url).includes("/api/tags")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ models: [] }),
                };
            }
            return nativeFetch(url, options);
        };
        const { setLogStream } = await import("./dist/logging/logger.js");
        setLogStream("stderr");
        ${evalCode}
    `,
        {
            cwd: repoRoot,
            env: {
                OUTPUT_DIR: outputDir,
                LOG_DIR: logDir,
                OLLAMA_URL: "http://127.0.0.1:11434",
                OLLAMA_MODEL: "gemma4:latest",
                OVERSEER_AUTO_ENABLED: "true",
                OVERSEER_INTERVAL_MS: "3600000",
                LOG_LEVEL: "error",
            },
        },
    );

    const result = parseLastJsonLine(stdout);
    const storedPath = path.join(systemDir, "overseer-last-report.json");
    const storedReport = fs.existsSync(storedPath)
        ? JSON.parse(fs.readFileSync(storedPath, "utf-8"))
        : null;
    const storedHistory = fs.existsSync(historyDir)
        ? Object.fromEntries(
            fs.readdirSync(historyDir)
                .sort()
                .map((fileName) => [
                    fileName,
                    fs.readFileSync(path.join(historyDir, fileName), "utf-8")
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line) => JSON.parse(line)),
                ]),
        )
        : {};
    const storedAcknowledgements = fs.existsSync(acknowledgementPath)
        ? JSON.parse(fs.readFileSync(acknowledgementPath, "utf-8"))
        : {};

    fs.rmSync(tempRoot, { recursive: true, force: true });

    return { result, storedReport, storedHistory, storedAcknowledgements };
}

test("automatic overseer runs persist latest report, append history, and are exposed via route and MCP", async () => {
    const { result, storedReport, storedHistory } = await runOverseerScenario({
        evalCode: `
            const { startOverseerScheduler, stopOverseerScheduler } = await import("./dist/overseer/scheduler.js");
            const { loadLastOverseerReport, loadOverseerHistory } = await import("./dist/overseer/storage.js");
            const { callMcpTool } = await import("./dist/mcp/toolAdapter.js");
            const express = (await import("express")).default;
            const overseerRouter = (await import("./dist/routes/overseer.js")).default;

            startOverseerScheduler();

            let report = null;
            for (let attempt = 0; attempt < 100; attempt += 1) {
                report = loadLastOverseerReport();
                if (report) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 10));
            }

            if (!report) {
                stopOverseerScheduler();
                throw new Error("Stored Overseer report was not created");
            }

            const app = express();
            app.use(overseerRouter);
            const server = app.listen(0);

            try {
                const address = server.address();
                if (!address || typeof address === "string") {
                    throw new Error("Unexpected server address");
                }

                const history = loadOverseerHistory({ limit: 5 });
                const lastResponse = await fetch("http://127.0.0.1:" + address.port + "/overseer/last-report");
                const lastBody = await lastResponse.json();
                const historyResponse = await fetch("http://127.0.0.1:" + address.port + "/overseer/history?limit=5");
                const historyBody = await historyResponse.json();
                const mcpLast = await callMcpTool({ name: "axiom.overseer.last_report", arguments: {} });
                const mcpHistory = await callMcpTool({ name: "axiom.overseer.history", arguments: { limit: 5 } });

                console.log(JSON.stringify({
                    lastStatus: lastResponse.status,
                    lastBody,
                    historyStatus: historyResponse.status,
                    historyBody,
                    loadedHistoryCount: history.entries.length,
                    mcpLastIsError: mcpLast.isError ?? false,
                    mcpLast: JSON.parse(mcpLast.content[0].text),
                    mcpHistoryIsError: mcpHistory.isError ?? false,
                    mcpHistory: JSON.parse(mcpHistory.content[0].text),
                }));
            } finally {
                stopOverseerScheduler();
                await new Promise((resolve) => server.close(resolve));
            }
        `,
    });

    const historyFiles = Object.keys(storedHistory);

    assert.equal(result.lastStatus, 200);
    assert.equal(result.lastBody.report.report, "auto overseer summary");
    assert.equal(result.lastBody.report.model, "gemma4:latest");
    assert.equal(result.historyStatus, 200);
    assert.equal(result.historyBody.entries[0].kind, "success");
    assert.equal(result.historyBody.entries[0].report, "auto overseer summary");
    assert.equal(result.loadedHistoryCount >= 1, true);
    assert.equal(result.mcpLastIsError, false);
    assert.equal(result.mcpLast.report.report, "auto overseer summary");
    assert.equal(result.mcpHistoryIsError, false);
    assert.equal(result.mcpHistory.entries[0].report, "auto overseer summary");
    assert.equal(storedReport?.report, "auto overseer summary");
    assert.match(result.lastBody.filePath, /overseer-last-report\.json$/);
    assert.equal(historyFiles.length, 1);
    assert.equal(storedHistory[historyFiles[0]][0].kind, "success");
    assert.equal(storedHistory[historyFiles[0]][0].report, "auto overseer summary");
});

test("last-report route and MCP surface return missing state when no automatic report exists", async () => {
    const { result, storedReport } = await runOverseerScenario({
        evalCode: `
            const express = (await import("express")).default;
            const overseerRouter = (await import("./dist/routes/overseer.js")).default;
            const { callMcpTool } = await import("./dist/mcp/toolAdapter.js");
            const app = express();
            app.use(overseerRouter);
            const server = app.listen(0);

            try {
                const address = server.address();
                if (!address || typeof address === "string") {
                    throw new Error("Unexpected server address");
                }

                const response = await fetch("http://127.0.0.1:" + address.port + "/overseer/last-report");
                const body = await response.json();
                const mcp = await callMcpTool({ name: "axiom.overseer.last_report", arguments: {} });
                console.log(JSON.stringify({
                    status: response.status,
                    body,
                    mcpIsError: mcp.isError ?? false,
                    mcp: JSON.parse(mcp.content[0].text),
                }));
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
        `,
    });

    assert.equal(result.status, 404);
    assert.equal(result.body.error, "No stored automatic Overseer report found yet.");
    assert.equal(result.mcpIsError, true);
    assert.equal(result.mcp.error, "No stored automatic Overseer report found yet.");
    assert.equal(storedReport, null);
    assert.match(result.body.filePath, /overseer-last-report\.json$/);
});

test("history route and MCP surface expose newest-first daily JSONL history", async () => {
    const { result } = await runOverseerScenario({
        existingHistory: {
            "2026-04-09": [
                {
                    generatedAt: "2026-04-09T01:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 12,
                    manifestsRead: 2,
                    report: "older report A",
                },
                {
                    generatedAt: "2026-04-09T03:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 14,
                    manifestsRead: 2,
                    report: "older report B",
                },
            ],
            "2026-04-10": [
                {
                    generatedAt: "2026-04-10T02:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 20,
                    manifestsRead: 3,
                    report: "newest report",
                },
            ],
        },
        evalCode: `
            const express = (await import("express")).default;
            const overseerRouter = (await import("./dist/routes/overseer.js")).default;
            const { callMcpTool } = await import("./dist/mcp/toolAdapter.js");
            const app = express();
            app.use(overseerRouter);
            const server = app.listen(0);

            try {
                const address = server.address();
                if (!address || typeof address === "string") {
                    throw new Error("Unexpected server address");
                }

                const historyResponse = await fetch("http://127.0.0.1:" + address.port + "/overseer/history?limit=2");
                const historyBody = await historyResponse.json();
                const dayResponse = await fetch("http://127.0.0.1:" + address.port + "/overseer/history?dayKey=2026-04-09&limit=10");
                const dayBody = await dayResponse.json();
                const mcpHistory = await callMcpTool({ name: "axiom.overseer.history", arguments: { limit: 2 } });
                const mcpDayHistory = await callMcpTool({ name: "axiom.overseer.history", arguments: { dayKey: "2026-04-09", limit: 10 } });

                console.log(JSON.stringify({
                    historyStatus: historyResponse.status,
                    historyBody,
                    dayStatus: dayResponse.status,
                    dayBody,
                    mcpHistoryIsError: mcpHistory.isError ?? false,
                    mcpHistory: JSON.parse(mcpHistory.content[0].text),
                    mcpDayHistoryIsError: mcpDayHistory.isError ?? false,
                    mcpDayHistory: JSON.parse(mcpDayHistory.content[0].text),
                }));
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
        `,
    });

    assert.equal(result.historyStatus, 200);
    assert.deepEqual(
        result.historyBody.entries.map((entry) => entry.report),
        ["newest report", "older report B"],
    );
    assert.deepEqual(
        result.historyBody.entries.map((entry) => entry.kind),
        ["success", "success"],
    );
    assert.equal(result.historyBody.files.length, 2);
    assert.equal(result.dayStatus, 200);
    assert.deepEqual(
        result.dayBody.entries.map((entry) => entry.report),
        ["older report B", "older report A"],
    );
    assert.equal(result.dayBody.dayKey, "2026-04-09");
    assert.equal(result.mcpHistoryIsError, false);
    assert.deepEqual(
        result.mcpHistory.entries.map((entry) => entry.report),
        ["newest report", "older report B"],
    );
    assert.equal(result.mcpDayHistoryIsError, false);
    assert.deepEqual(
        result.mcpDayHistory.entries.map((entry) => entry.report),
        ["older report B", "older report A"],
    );
});

test("summary route, dashboard, and MCP surface expose derived overseer metrics", async () => {
    const { result } = await runOverseerScenario({
        existingHistory: {
            "2026-04-10": [
                {
                    kind: "failure",
                    generatedAt: "2026-04-10T10:30:00.000Z",
                    error: "ollama timeout",
                    report: "Overseer auto-run failed: ollama timeout",
                },
                {
                    generatedAt: "2026-04-10T09:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 20,
                    manifestsRead: 3,
                    report: "1. Current Status: healthy\n2. Issues Found:\n- Queue backlog is rising.\n3. Top 3 Recommended Actions:\n- Clear backlog",
                },
                {
                    generatedAt: "2026-04-10T08:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 18,
                    manifestsRead: 3,
                    report: "1. Current Status: warning\n2. Issues Found:\n- queue backlog rising\n- Render worker degraded\n3. Top 3 Recommended Actions:\n- Inspect render worker",
                },
                {
                    generatedAt: "2026-04-10T07:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 16,
                    manifestsRead: 2,
                    report: "1. Current Status: healthy\n2. Issues Found: None\n3. Top 3 Recommended Actions:\n- Continue monitoring",
                },
            ],
        },
        existingManifests: [
            {
                songId: "retry-success-7d",
                state: "DONE",
                meta: {
                    songId: "retry-success-7d",
                    prompt: "Bring the recap back with clarity.",
                    workflow: "symbolic_plus_audio",
                    form: "sonata",
                    plannerVersion: "planner-v1",
                    createdAt: "2026-04-09T08:00:00.000Z",
                    updatedAt: "2026-04-09T10:00:00.000Z",
                },
                artifacts: {},
                sectionArtifacts: [
                    {
                        sectionId: "s1",
                        role: "theme_a",
                        measureCount: 8,
                        melodyEvents: [],
                        accompanimentEvents: [],
                        noteHistory: [60, 62, 64],
                        bassMotionProfile: "stepwise",
                        sectionStyle: "arpeggio",
                    },
                    {
                        sectionId: "s2",
                        role: "development",
                        measureCount: 8,
                        melodyEvents: [],
                        accompanimentEvents: [],
                        noteHistory: [67, 69, 71],
                        bassMotionProfile: "mixed",
                        sectionStyle: "broken",
                    },
                    {
                        sectionId: "s3",
                        role: "recap",
                        measureCount: 8,
                        melodyEvents: [],
                        accompanimentEvents: [],
                        noteHistory: [60, 59, 60],
                        bassMotionProfile: "pedal",
                        sectionStyle: "block",
                    },
                ],
                structureEvaluation: {
                    passed: true,
                    score: 87,
                    issues: [],
                    strengths: ["Register planning stays close to the intended arch."],
                    metrics: {
                        registerPlanFit: 0.91,
                        cadenceApproachPlanFit: 0.88,
                    },
                    sectionFindings: [
                        {
                            sectionId: "s1",
                            label: "Theme A",
                            role: "theme_a",
                            startMeasure: 1,
                            endMeasure: 8,
                            score: 0.91,
                            issues: [],
                            strengths: ["Opening material stays centered."],
                            metrics: {},
                        },
                        {
                            sectionId: "s2",
                            label: "Development",
                            role: "development",
                            startMeasure: 9,
                            endMeasure: 16,
                            score: 0.84,
                            issues: ["Register planning drifts from the intended section targets."],
                            strengths: [],
                            metrics: {
                                registerCenterFit: 0.84,
                                registerCenterDrift: 6,
                                cadenceApproachFit: 0.88,
                            },
                        },
                        {
                            sectionId: "s3",
                            label: "Recap",
                            role: "recap",
                            startMeasure: 17,
                            endMeasure: 24,
                            score: 0.89,
                            issues: ["The recap arrival still needs slightly more release."],
                            strengths: [],
                            metrics: {
                                cadenceApproachFit: 0.9,
                            },
                        },
                    ],
                    orchestration: {
                        family: "string_trio",
                        instrumentNames: ["violin", "viola", "cello"],
                        sectionCount: 3,
                        conversationalSectionCount: 1,
                        idiomaticRangeFit: 0.89,
                        registerBalanceFit: 0.86,
                        ensembleConversationFit: 0.82,
                        weakSectionIds: ["s2"],
                    },
                    weakestSections: [
                        {
                            sectionId: "s2",
                            label: "Development",
                            role: "development",
                            startMeasure: 9,
                            endMeasure: 16,
                            score: 0.84,
                            issues: ["Register planning drifts from the intended section targets."],
                            strengths: [],
                            metrics: {
                                registerCenterFit: 0.84,
                                registerCenterDrift: 6,
                                cadenceApproachFit: 0.88,
                            },
                        },
                    ],
                },
                audioEvaluation: {
                    passed: true,
                    score: 90,
                    issues: [],
                    strengths: [],
                    metrics: {
                        audioTonalReturnRenderFit: 0.82,
                        audioHarmonicRouteRenderFit: 0.79,
                        audioChromaTonalReturnFit: 0.78,
                        audioChromaHarmonicRouteFit: 0.75,
                    },
                    weakestSections: [
                        {
                            sectionId: "s2",
                            label: "Development",
                            role: "development",
                            sourceSectionId: "s1",
                            plannedTonality: "G major",
                            score: 0.79,
                            issues: ["The development contour still needs more forward drive."],
                            strengths: [],
                            metrics: {
                                audioSectionCompositeFit: 0.79,
                            },
                        },
                        {
                            sectionId: "s3",
                            label: "Recap",
                            role: "recap",
                            sourceSectionId: "s1",
                            plannedTonality: "C major",
                            score: 0.82,
                            issues: ["The recap arrival still needs slightly more release."],
                            strengths: [],
                            metrics: {
                                audioSectionCompositeFit: 0.82,
                            },
                        },
                    ],
                },
                qualityControl: {
                    attempts: [
                        {
                            attempt: 1,
                            stage: "audio",
                            passed: false,
                            score: 64,
                            issues: ["Narrative contour needs more lift."],
                            strengths: [],
                            evaluatedAt: "2026-04-09T09:00:00.000Z",
                            directives: [
                                { kind: "clarify_narrative_arc", reason: "Push the development contour further forward." },
                                { kind: "rebalance_recap_release", reason: "Make the recap arrival and release clearer." },
                            ],
                        },
                        {
                            attempt: 2,
                            stage: "audio",
                            passed: true,
                            score: 90,
                            issues: [],
                            strengths: ["Recap release now lands clearly."],
                            evaluatedAt: "2026-04-09T10:00:00.000Z",
                            directives: [],
                        },
                    ],
                    selectedAttempt: 2,
                    stopReason: "accepted",
                },
                sectionTonalities: [
                    { sectionId: "s1", role: "theme_a", tonalCenter: "C major" },
                    { sectionId: "s2", role: "development", tonalCenter: "G major" },
                    { sectionId: "s3", role: "recap", tonalCenter: "C major" },
                ],
                updatedAt: "2026-04-09T10:00:00.000Z",
            },
            {
                songId: "retry-failure-7d",
                state: "FAILED",
                meta: {
                    songId: "retry-failure-7d",
                    prompt: "Keep the arc stronger through the recap.",
                    workflow: "audio_only",
                    form: "sonata",
                    plannerVersion: "planner-v2",
                    createdAt: "2026-04-07T08:00:00.000Z",
                    updatedAt: "2026-04-07T10:00:00.000Z",
                },
                artifacts: {},
                audioEvaluation: {
                    passed: false,
                    score: 61,
                    issues: ["The recap still does not release clearly enough."],
                    strengths: [],
                    metrics: {
                        audioTonalReturnRenderFit: 0.44,
                        audioHarmonicRouteRenderFit: 0.41,
                        audioChromaTonalReturnFit: 0.39,
                        audioChromaHarmonicRouteFit: 0.36,
                    },
                    weakestSections: [
                        {
                            sectionId: "s3",
                            label: "Recap",
                            role: "recap",
                            sourceSectionId: "s1",
                            plannedTonality: "C major",
                            score: 0.41,
                            issues: ["The recap still does not release clearly enough."],
                            strengths: [],
                            metrics: {
                                audioSectionCompositeFit: 0.41,
                            },
                        },
                    ],
                },
                qualityControl: {
                    attempts: [
                        {
                            attempt: 1,
                            stage: "audio",
                            passed: false,
                            score: 61,
                            issues: ["Recap return is still too soft."],
                            strengths: [],
                            evaluatedAt: "2026-04-07T09:00:00.000Z",
                            directives: [
                                { kind: "clarify_narrative_arc", reason: "Push the development contour further forward." },
                                { kind: "rebalance_recap_release", reason: "Make the recap arrival and release clearer." },
                            ],
                        },
                        {
                            attempt: 2,
                            stage: "audio",
                            passed: false,
                            score: 61,
                            issues: ["The recap still does not release clearly enough."],
                            strengths: [],
                            evaluatedAt: "2026-04-07T10:00:00.000Z",
                            directives: [],
                        },
                    ],
                    selectedAttempt: 2,
                    stopReason: "exhausted_audio_retries",
                },
                sectionTonalities: [
                    { sectionId: "s1", role: "theme_a", tonalCenter: "C major" },
                    { sectionId: "s2", role: "development", tonalCenter: "C major" },
                    { sectionId: "s3", role: "recap", tonalCenter: "G major" },
                ],
                updatedAt: "2026-04-07T10:00:00.000Z",
            },
            {
                songId: "retry-success-30d",
                state: "DONE",
                meta: {
                    songId: "retry-success-30d",
                    prompt: "Rebalance the release in the coda.",
                    workflow: "symbolic_plus_audio",
                    form: "fantasia",
                    plannerVersion: "planner-v2",
                    createdAt: "2026-03-21T08:00:00.000Z",
                    updatedAt: "2026-03-21T10:00:00.000Z",
                },
                artifacts: {},
                sectionArtifacts: [
                    {
                        sectionId: "s1",
                        role: "theme_a",
                        measureCount: 8,
                        melodyEvents: [],
                        accompanimentEvents: [],
                        noteHistory: [69, 71, 72],
                        bassMotionProfile: "stepwise",
                        sectionStyle: "arpeggio",
                    },
                    {
                        sectionId: "s2",
                        role: "development",
                        measureCount: 8,
                        melodyEvents: [],
                        accompanimentEvents: [],
                        noteHistory: [69, 67, 64],
                        bassMotionProfile: "mixed",
                        sectionStyle: "broken",
                    },
                ],
                structureEvaluation: {
                    passed: true,
                    score: 81,
                    issues: [],
                    strengths: ["Release planning stays coherent."],
                    metrics: {
                        registerPlanFit: 0.83,
                        cadenceApproachPlanFit: 0.8,
                    },
                    sectionFindings: [
                        {
                            sectionId: "s1",
                            label: "Theme A",
                            role: "theme_a",
                            startMeasure: 1,
                            endMeasure: 8,
                            score: 0.86,
                            issues: [],
                            strengths: [],
                            metrics: {},
                        },
                        {
                            sectionId: "s2",
                            label: "Development",
                            role: "development",
                            startMeasure: 9,
                            endMeasure: 16,
                            score: 0.8,
                            issues: ["Release needs more separation."],
                            strengths: [],
                            metrics: {},
                        },
                    ],
                    orchestration: {
                        family: "string_trio",
                        instrumentNames: ["violin", "viola", "cello"],
                        sectionCount: 2,
                        conversationalSectionCount: 1,
                        idiomaticRangeFit: 0.92,
                        registerBalanceFit: 0.9,
                        ensembleConversationFit: 0.85,
                        weakSectionIds: [],
                    },
                    weakestSections: [
                        {
                            sectionId: "s2",
                            label: "Development",
                            role: "development",
                            startMeasure: 9,
                            endMeasure: 16,
                            score: 0.8,
                            issues: ["Release needs more separation."],
                            strengths: [],
                            metrics: {},
                        },
                    ],
                },
                audioEvaluation: {
                    passed: true,
                    score: 88,
                    issues: [],
                    strengths: [],
                    metrics: {},
                    weakestSections: [
                        {
                            sectionId: "s2",
                            label: "Development",
                            role: "development",
                            sourceSectionId: "s1",
                            plannedTonality: "A minor",
                            score: 0.66,
                            issues: ["Middle-section contrast still needs more separation before release."],
                            strengths: [],
                            metrics: {
                                audioSectionCompositeFit: 0.66,
                            },
                        },
                    ],
                },
                qualityControl: {
                    attempts: [
                        {
                            attempt: 1,
                            stage: "audio",
                            passed: false,
                            score: 66,
                            issues: ["Release needs more separation."],
                            strengths: [],
                            evaluatedAt: "2026-03-21T09:00:00.000Z",
                            directives: [
                                { kind: "rebalance_recap_release", reason: "Make the release resolution less abrupt." },
                            ],
                        },
                        {
                            attempt: 2,
                            stage: "audio",
                            passed: true,
                            score: 88,
                            issues: [],
                            strengths: ["Release now breathes naturally."],
                            evaluatedAt: "2026-03-21T10:00:00.000Z",
                            directives: [],
                        },
                    ],
                    selectedAttempt: 2,
                    stopReason: "accepted",
                },
                updatedAt: "2026-03-21T10:00:00.000Z",
            },
            {
                songId: "retry-old-outside-window",
                state: "DONE",
                meta: {
                    songId: "retry-old-outside-window",
                    prompt: "Old retry entry outside current windows.",
                    workflow: "symbolic_only",
                    form: "suite",
                    plannerVersion: "planner-v0",
                    createdAt: "2026-02-01T08:00:00.000Z",
                    updatedAt: "2026-02-01T10:00:00.000Z",
                },
                artifacts: {},
                sectionArtifacts: [
                    {
                        sectionId: "s1",
                        role: "theme_a",
                        measureCount: 8,
                        melodyEvents: [],
                        accompanimentEvents: [],
                        noteHistory: [62, 65, 69],
                        bassMotionProfile: "leaping",
                        sectionStyle: "waltz",
                    },
                    {
                        sectionId: "s2",
                        role: "development",
                        measureCount: 8,
                        melodyEvents: [],
                        accompanimentEvents: [],
                        noteHistory: [62, 60, 57],
                        bassMotionProfile: "mixed",
                        sectionStyle: "march",
                    },
                ],
                structureEvaluation: {
                    passed: true,
                    score: 79,
                    issues: [],
                    strengths: ["Historic baseline still preserves sectional contrast."],
                    metrics: {
                        registerPlanFit: 0.78,
                        cadenceApproachPlanFit: 0.76,
                    },
                    sectionFindings: [
                        {
                            sectionId: "s1",
                            label: "Theme A",
                            role: "theme_a",
                            startMeasure: 1,
                            endMeasure: 8,
                            score: 0.81,
                            issues: [],
                            strengths: [],
                            metrics: {},
                        },
                        {
                            sectionId: "s2",
                            label: "Variation",
                            role: "development",
                            startMeasure: 9,
                            endMeasure: 16,
                            score: 0.77,
                            issues: ["Historic retry baseline still shows middle-section drag."],
                            strengths: [],
                            metrics: {},
                        },
                    ],
                    orchestration: {
                        family: "string_trio",
                        instrumentNames: ["violin", "viola", "cello"],
                        sectionCount: 2,
                        conversationalSectionCount: 0,
                        idiomaticRangeFit: 0.78,
                        registerBalanceFit: 0.74,
                        ensembleConversationFit: 0.69,
                        weakSectionIds: ["s2"],
                    },
                    weakestSections: [
                        {
                            sectionId: "s2",
                            label: "Variation",
                            role: "development",
                            startMeasure: 9,
                            endMeasure: 16,
                            score: 0.77,
                            issues: ["Historic retry baseline still shows middle-section drag."],
                            strengths: [],
                            metrics: {},
                        },
                    ],
                },
                audioEvaluation: {
                    passed: true,
                    score: 84,
                    issues: [],
                    strengths: [],
                    metrics: {},
                    weakestSections: [
                        {
                            sectionId: "s2",
                            label: "Variation",
                            role: "development",
                            sourceSectionId: "s1",
                            plannedTonality: "D minor",
                            score: 0.58,
                            issues: ["Historic retry baseline still shows middle-section drag."],
                            strengths: [],
                            metrics: {
                                audioSectionCompositeFit: 0.58,
                            },
                        },
                    ],
                },
                qualityControl: {
                    attempts: [
                        {
                            attempt: 1,
                            stage: "audio",
                            passed: false,
                            score: 58,
                            issues: ["Old baseline retry."],
                            strengths: [],
                            evaluatedAt: "2026-02-01T09:00:00.000Z",
                            directives: [
                                { kind: "clarify_narrative_arc", reason: "Historic baseline retry." },
                            ],
                        },
                        {
                            attempt: 2,
                            stage: "audio",
                            passed: true,
                            score: 84,
                            issues: [],
                            strengths: [],
                            evaluatedAt: "2026-02-01T10:00:00.000Z",
                            directives: [],
                        },
                    ],
                    selectedAttempt: 2,
                    stopReason: "accepted",
                },
                updatedAt: "2026-02-01T10:00:00.000Z",
            },
        ],
        evalCode: `
            const express = (await import("express")).default;
            const overseerRouter = (await import("./dist/routes/overseer.js")).default;
            const { callMcpTool } = await import("./dist/mcp/toolAdapter.js");
            const app = express();
            app.use(overseerRouter);
            const server = app.listen(0);

            try {
                const address = server.address();
                if (!address || typeof address === "string") {
                    throw new Error("Unexpected server address");
                }

                const summaryResponse = await fetch("http://127.0.0.1:" + address.port + "/overseer/summary?windowHours=24&limit=20&now=2026-04-10T12:00:00.000Z");
                const summaryBody = await summaryResponse.json();
                const dashboardResponse = await fetch("http://127.0.0.1:" + address.port + "/overseer/dashboard?windowHours=24&limit=20&now=2026-04-10T12:00:00.000Z");
                const dashboardHtml = await dashboardResponse.text();
                const mcpSummary = await callMcpTool({ name: "axiom.overseer.summary", arguments: { windowHours: 24, limit: 20, now: "2026-04-10T12:00:00.000Z" } });

                console.log(JSON.stringify({
                    summaryStatus: summaryResponse.status,
                    summaryBody,
                    dashboardStatus: dashboardResponse.status,
                    dashboardHasLastReport: dashboardHtml.includes("자동 리포트가 아직 없습니다.") || dashboardHtml.includes("Queue backlog"),
                    dashboardHasRepeatedWarning: dashboardHtml.includes("Queue backlog"),
                    dashboardHasFailureMetric: dashboardHtml.includes("Recent 24h Failures"),
                    dashboardHasHealthyTimestamp: dashboardHtml.includes("Last Healthy Report"),
                    dashboardHasAudioRetrySection: dashboardHtml.includes("Audio Retry Combos"),
                    dashboardHasSevenDayWindow: dashboardHtml.includes("Last 7 Days"),
                    dashboardHasThirtyDayWindow: dashboardHtml.includes("Last 30 Days"),
                    dashboardHasRetryCombo: dashboardHtml.includes("clarify_narrative_arc + rebalance_recap_release"),
                    dashboardHasSparkline: dashboardHtml.includes("Immediate Success Sparkline"),
                    dashboardHasHeatmap: dashboardHtml.includes("Retry Volume Heatmap"),
                    dashboardHasFormBreakdown: dashboardHtml.includes("Form Breakdown"),
                    dashboardHasWorkflowBreakdown: dashboardHtml.includes("Workflow Breakdown"),
                    dashboardHasPlannerBreakdown: dashboardHtml.includes("Planner Version Breakdown"),
                    dashboardHasWeakestAudioRoleBreakdown: dashboardHtml.includes("Weakest Audio Role Breakdown"),
                    dashboardHasSettingProfiles: dashboardHtml.includes("Setting Profiles"),
                    dashboardHasBassMotionTrends: dashboardHtml.includes("Bass Motion Trends"),
                    dashboardHasSectionStyleTrends: dashboardHtml.includes("Section Style Trends"),
                    dashboardHasOrchestrationTrends: dashboardHtml.includes("Orchestration Trends"),
                    dashboardHasOrchestrationFamily: dashboardHtml.includes("violin / viola / cello"),
                    dashboardHasSectionPatternValues: dashboardHtml.includes("stepwise") && dashboardHtml.includes("arpeggio"),
                    dashboardHasKeyRouteTable: dashboardHtml.includes("Recent Key Route Tracking"),
                    dashboardHasKeyRouteString: dashboardHtml.includes("theme_a:C major") && dashboardHtml.includes("development:G major") && dashboardHtml.includes("recap:C major"),
                    dashboardHasChromaRouteColumn: dashboardHtml.includes("Chroma Route"),
                    dashboardHasStructureFitColumn: dashboardHtml.includes("Structure / Orch"),
                    dashboardHasRegisterDriftMetric: dashboardHtml.includes("drift +6.0"),
                    dashboardHasSvg: dashboardHtml.includes("<svg"),
                    mcpSummaryIsError: mcpSummary.isError ?? false,
                    mcpSummary: JSON.parse(mcpSummary.content[0].text),
                }));
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
        `,
    });

    assert.equal(result.summaryStatus, 200);
    assert.equal(result.summaryBody.recentFailureCount, 1);
    assert.equal(result.summaryBody.repeatedWarnings.length, 1);
    assert.equal(result.summaryBody.repeatedWarnings[0].count, 2);
    assert.match(result.summaryBody.repeatedWarnings[0].warning, /Queue backlog|queue backlog/i);
    assert.equal(result.summaryBody.lastHealthyReportAt, "2026-04-10T07:00:00.000Z");
    assert.equal(result.dashboardStatus, 200);
    assert.equal(result.dashboardHasLastReport, true);
    assert.equal(result.dashboardHasRepeatedWarning, true);
    assert.equal(result.dashboardHasFailureMetric, true);
    assert.equal(result.dashboardHasHealthyTimestamp, true);
    assert.equal(result.dashboardHasAudioRetrySection, true);
    assert.equal(result.dashboardHasSevenDayWindow, true);
    assert.equal(result.dashboardHasThirtyDayWindow, true);
    assert.equal(result.dashboardHasRetryCombo, true);
    assert.equal(result.dashboardHasSparkline, true);
    assert.equal(result.dashboardHasHeatmap, true);
    assert.equal(result.dashboardHasFormBreakdown, true);
    assert.equal(result.dashboardHasWorkflowBreakdown, true);
    assert.equal(result.dashboardHasPlannerBreakdown, true);
    assert.equal(result.dashboardHasWeakestAudioRoleBreakdown, true);
    assert.equal(result.dashboardHasSettingProfiles, true);
    assert.equal(result.dashboardHasBassMotionTrends, true);
    assert.equal(result.dashboardHasSectionStyleTrends, true);
    assert.equal(result.dashboardHasOrchestrationTrends, true);
    assert.equal(result.dashboardHasOrchestrationFamily, true);
    assert.equal(result.dashboardHasSectionPatternValues, true);
    assert.equal(result.dashboardHasKeyRouteTable, true);
    assert.equal(result.dashboardHasKeyRouteString, true);
    assert.equal(result.dashboardHasChromaRouteColumn, true);
    assert.equal(result.dashboardHasStructureFitColumn, true);
    assert.equal(result.dashboardHasRegisterDriftMetric, true);
    assert.equal(result.dashboardHasSvg, true);
    assert.equal(result.mcpSummaryIsError, false);
    assert.equal(result.mcpSummary.recentFailureCount, 1);
    assert.equal(result.mcpSummary.repeatedWarnings[0].count, 2);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryStats.totalRetryEvents, 4);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryWindows.last7Days.stats.totalRetryEvents, 2);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryWindows.last30Days.stats.totalRetryEvents, 3);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryWindows.last7Days.dailySeries.length, 7);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryWindows.last30Days.dailySeries.length, 30);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryBreakdowns.byForm.length, 3);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryBreakdowns.byWorkflow.length, 3);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryBreakdowns.byPlannerVersion.length, 3);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryBreakdowns.bySettingProfile.length, 4);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryBreakdowns.byAudioWeakestRole.length, 2);
    assert.equal(result.summaryBody.manifestAudioRetry.successfulSectionPatterns.sampledManifestCount, 3);
    assert.equal(result.summaryBody.manifestAudioRetry.successfulSectionPatterns.sampledSectionCount, 7);
    assert.equal(result.summaryBody.manifestAudioRetry.orchestrationTrends.sampledManifestCount, 3);
    assert.equal(result.summaryBody.manifestAudioRetry.orchestrationTrends.familyRows[0].family, "string_trio");
    assert.equal(result.summaryBody.manifestAudioRetry.orchestrationTrends.familyRows[0].averageIdiomaticRangeFit, 0.8633);
    assert.equal(result.summaryBody.manifestAudioRetry.orchestrationTrends.familyRows[0].averageRegisterBalanceFit, 0.8333);
    assert.equal(result.summaryBody.manifestAudioRetry.orchestrationTrends.familyRows[0].averageEnsembleConversationFit, 0.7867);
    assert.equal(result.summaryBody.manifestAudioRetry.orchestrationTrends.familyRows[0].weakManifestCount, 2);
    assert.equal(result.summaryBody.manifestAudioRetry.recentManifestTracking[0].sectionTonalities[1].tonalCenter, "G major");
    assert.equal(result.summaryBody.manifestAudioRetry.recentManifestTracking[0].structureNarrative.registerPlanFit, 0.91);
    assert.equal(result.summaryBody.manifestAudioRetry.recentManifestTracking[0].structureNarrative.cadenceApproachPlanFit, 0.88);
    assert.equal(result.summaryBody.manifestAudioRetry.recentManifestTracking[0].orchestration.family, "string_trio");
    assert.equal(result.summaryBody.manifestAudioRetry.recentManifestTracking[0].orchestration.idiomaticRangeFit, 0.89);
    assert.equal(result.summaryBody.manifestAudioRetry.recentManifestTracking[0].weakestSections[0].registerCenterFit, 0.84);
    assert.equal(result.summaryBody.manifestAudioRetry.recentManifestTracking[0].weakestSections[0].registerCenterDrift, 6);
    assert.equal(result.summaryBody.manifestAudioRetry.recentManifestTracking[0].weakestSections[0].cadenceApproachFit, 0.88);
    assert.equal(result.summaryBody.manifestAudioRetry.recentManifestTracking[0].audioNarrative.harmonicRouteFit, 0.79);
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryBreakdowns.byForm[0].value, "sonata");
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryBreakdowns.byWorkflow[0].value, "symbolic_plus_audio");
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryBreakdowns.byPlannerVersion[0].value, "planner-v2");
    assert.equal(result.summaryBody.manifestAudioRetry.audioRetryBreakdowns.byAudioWeakestRole[0].value, "development");
    assert.equal(result.summaryBody.manifestAudioRetry.successfulSectionPatterns.bassMotionProfiles.find((row) => row.form === "sonata" && row.role === "theme_a")?.value, "stepwise");
    assert.equal(result.summaryBody.manifestAudioRetry.successfulSectionPatterns.bassMotionProfiles.find((row) => row.form === "sonata" && row.role === "theme_a")?.averageScore, 0.91);
    assert.equal(result.summaryBody.manifestAudioRetry.successfulSectionPatterns.sectionStyles.find((row) => row.form === "sonata" && row.role === "theme_a")?.value, "arpeggio");
    assert.equal(result.mcpSummary.manifestAudioRetry.audioRetryWindows.last7Days.stats.totalRetryEvents, 2);
    assert.equal(result.mcpSummary.manifestAudioRetry.audioRetryWindows.last30Days.stats.totalRetryEvents, 3);
    assert.equal(result.mcpSummary.manifestAudioRetry.audioRetryBreakdowns.bySettingProfile.length, 4);
    assert.equal(result.mcpSummary.manifestAudioRetry.audioRetryBreakdowns.byAudioWeakestRole.length, 2);
    assert.equal(result.mcpSummary.manifestAudioRetry.audioRetryBreakdowns.byAudioWeakestRole[0].value, "development");
    assert.equal(result.mcpSummary.manifestAudioRetry.orchestrationTrends.familyRows[0].averageIdiomaticRangeFit, 0.8633);
    assert.equal(result.mcpSummary.manifestAudioRetry.orchestrationTrends.familyRows[0].weakManifestCount, 2);
    assert.equal(result.mcpSummary.manifestAudioRetry.recentManifestTracking[0].audioNarrative.chromaHarmonicRouteFit, 0.75);
    assert.equal(result.mcpSummary.manifestAudioRetry.recentManifestTracking[0].structureNarrative.cadenceApproachPlanFit, 0.88);
    assert.equal(result.mcpSummary.manifestAudioRetry.recentManifestTracking[0].orchestration.registerBalanceFit, 0.86);
    assert.equal(result.mcpSummary.manifestAudioRetry.successfulSectionPatterns.sampledManifestCount, 3);
    assert.equal(result.mcpSummary.manifestAudioRetry.successfulSectionPatterns.sectionStyles.find((row) => row.form === "suite" && row.role === "development")?.value, "march");
});

test("automatic overseer failures are appended to history and counted in summary", async () => {
    const { result, storedHistory } = await runOverseerScenario({
        evalCode: `
            globalThis.fetch = async (url) => {
                if (String(url).includes("/api/generate")) {
                    throw new Error("ollama timeout");
                }
                if (String(url).includes("/api/tags")) {
                    return { ok: true, status: 200, json: async () => ({ models: [] }) };
                }
                throw new Error("Unexpected fetch: " + url);
            };
            const { startOverseerScheduler, stopOverseerScheduler } = await import("./dist/overseer/scheduler.js");
            const { loadOverseerHistory, summarizeOverseerHistory } = await import("./dist/overseer/storage.js");

            startOverseerScheduler();

            let history = null;
            for (let attempt = 0; attempt < 100; attempt += 1) {
                history = loadOverseerHistory({ limit: 10 });
                if (history.entries.length > 0) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 10));
            }

            stopOverseerScheduler();

            if (!history || history.entries.length === 0) {
                throw new Error("Failure history entry was not created");
            }

            const summary = summarizeOverseerHistory({ windowHours: 24, limit: 10, now: new Date("2026-04-10T12:00:00.000Z") });
            console.log(JSON.stringify({ history, summary }));
        `,
    });

    const historyFiles = Object.keys(storedHistory);

    assert.equal(result.history.entries[0].kind, "failure");
    assert.equal(result.history.entries[0].error, "ollama timeout");
    assert.equal(result.summary.recentFailureCount, 1);
    assert.equal(result.summary.lastFailureAt, result.history.entries[0].generatedAt);
    assert.equal(historyFiles.length, 1);
    assert.equal(storedHistory[historyFiles[0]][0].kind, "failure");
});

test("dashboard acknowledge actions move repeated warnings between active and acknowledged lists", async () => {
    const { result, storedAcknowledgements } = await runOverseerScenario({
        existingHistory: {
            "2026-04-10": [
                {
                    generatedAt: "2026-04-10T09:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 20,
                    manifestsRead: 3,
                    report: "1. Current Status: healthy\n2. Issues Found:\n- Queue backlog is rising.\n3. Top 3 Recommended Actions:\n- Clear backlog",
                },
                {
                    generatedAt: "2026-04-10T08:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 18,
                    manifestsRead: 3,
                    report: "1. Current Status: warning\n2. Issues Found:\n- queue backlog rising\n3. Top 3 Recommended Actions:\n- Inspect queue worker",
                },
            ],
        },
        evalCode: `
            const express = (await import("express")).default;
            const overseerRouter = (await import("./dist/routes/overseer.js")).default;
            const app = express();
            app.use(overseerRouter);
            const server = app.listen(0);

            try {
                const address = server.address();
                if (!address || typeof address === "string") {
                    throw new Error("Unexpected server address");
                }

                const summaryUrl = "http://127.0.0.1:" + address.port + "/overseer/summary?windowHours=24&limit=20&now=2026-04-10T12:00:00.000Z";
                const dashboardUrl = "http://127.0.0.1:" + address.port + "/overseer/dashboard?windowHours=24&limit=20&now=2026-04-10T12:00:00.000Z";

                const initialSummary = await fetch(summaryUrl).then((response) => response.json());
                const warning = initialSummary.repeatedWarnings[0];
                const acknowledgeForm = new URLSearchParams({
                    warningKey: warning.warningKey,
                    warning: warning.warning,
                    lastSeenAt: warning.lastSeenAt,
                    note: "known capacity work",
                    redirectTo: "/overseer/dashboard?windowHours=24&limit=20&now=2026-04-10T12:00:00.000Z",
                });

                const acknowledgeResponse = await fetch("http://127.0.0.1:" + address.port + "/overseer/warnings/acknowledge", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: acknowledgeForm.toString(),
                    redirect: "manual",
                });

                const acknowledgedSummary = await fetch(summaryUrl).then((response) => response.json());
                const dashboardHtml = await fetch(dashboardUrl).then((response) => response.text());

                const unacknowledgeForm = new URLSearchParams({
                    warningKey: warning.warningKey,
                    redirectTo: "/overseer/dashboard?windowHours=24&limit=20&now=2026-04-10T12:00:00.000Z",
                });

                const unacknowledgeResponse = await fetch("http://127.0.0.1:" + address.port + "/overseer/warnings/unacknowledge", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: unacknowledgeForm.toString(),
                    redirect: "manual",
                });

                const reopenedSummary = await fetch(summaryUrl).then((response) => response.json());

                console.log(JSON.stringify({
                    initialSummary,
                    acknowledgeStatus: acknowledgeResponse.status,
                    acknowledgedSummary,
                    dashboardHasAcknowledgedSection: dashboardHtml.includes("Acknowledged Warnings"),
                    dashboardHasReleaseButton: dashboardHtml.includes("Acknowledge 해제"),
                    dashboardShowsNote: dashboardHtml.includes("known capacity work"),
                    unacknowledgeStatus: unacknowledgeResponse.status,
                    reopenedSummary,
                }));
            } finally {
                await new Promise((resolve) => server.close(resolve));
            }
        `,
    });

    assert.equal(result.initialSummary.repeatedWarnings.length, 1);
    assert.equal(result.acknowledgeStatus, 303);
    assert.equal(result.acknowledgedSummary.repeatedWarnings.length, 0);
    assert.equal(result.acknowledgedSummary.acknowledgedWarnings.length, 1);
    assert.equal(result.acknowledgedSummary.acknowledgedWarnings[0].note, "known capacity work");
    assert.equal(result.dashboardHasAcknowledgedSection, true);
    assert.equal(result.dashboardHasReleaseButton, true);
    assert.equal(result.dashboardShowsNote, true);
    assert.equal(result.unacknowledgeStatus, 303);
    assert.equal(result.reopenedSummary.repeatedWarnings.length, 1);
    assert.equal(result.reopenedSummary.acknowledgedWarnings.length, 0);
    assert.deepEqual(storedAcknowledgements, {});
});

test("domain-specific warning normalization groups render, autonomy, and queue variants", async () => {
    const { result } = await runOverseerScenario({
        evalCode: `
            const { normalizeOverseerWarningKey } = await import("./dist/overseer/storage.js");
            console.log(JSON.stringify({
                renderA: normalizeOverseerWarningKey("Preview video skipped: ffmpeg not found on PATH or in tools/ffmpeg/bin/."),
                renderB: normalizeOverseerWarningKey("preview mp4 unavailable because ffmpeg is missing"),
                autonomyA: normalizeOverseerWarningKey("stale autonomy lock can be reconciled now"),
                autonomyB: normalizeOverseerWarningKey("stale autonomy lock detected; manual reconcile required"),
                queueA: normalizeOverseerWarningKey("Queue backlog is rising."),
                queueB: normalizeOverseerWarningKey("queue backlog rising"),
            }));
        `,
    });

    assert.equal(result.renderA, result.renderB);
    assert.equal(result.autonomyA, result.autonomyB);
    assert.equal(result.queueA, result.queueB);
    assert.notEqual(result.renderA, result.autonomyA);
    assert.notEqual(result.autonomyA, result.queueA);
});

test("acknowledged repeated warning resurfaces when a newer occurrence arrives after acknowledgement", async () => {
    const { result } = await runOverseerScenario({
        existingHistory: {
            "2026-04-10": [
                {
                    generatedAt: "2026-04-10T10:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 22,
                    manifestsRead: 4,
                    report: "1. Current Status: warning\n2. Issues Found:\n- queue backlog rising\n3. Top 3 Recommended Actions:\n- Clear queue backlog",
                },
                {
                    generatedAt: "2026-04-10T09:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 20,
                    manifestsRead: 3,
                    report: "1. Current Status: healthy\n2. Issues Found:\n- Queue backlog is rising.\n3. Top 3 Recommended Actions:\n- Clear backlog",
                },
                {
                    generatedAt: "2026-04-10T08:00:00.000Z",
                    model: "gemma4:latest",
                    logLines: 18,
                    manifestsRead: 3,
                    report: "1. Current Status: warning\n2. Issues Found:\n- queue backlog rising\n3. Top 3 Recommended Actions:\n- Inspect queue worker",
                },
            ],
        },
        evalCode: `
            const { acknowledgeOverseerWarning, summarizeOverseerHistory } = await import("./dist/overseer/storage.js");
            acknowledgeOverseerWarning({
                warning: "Queue backlog is rising.",
                lastSeenAt: "2026-04-10T09:00:00.000Z",
                acknowledgedAt: "2026-04-10T09:30:00.000Z",
            });
            console.log(JSON.stringify(summarizeOverseerHistory({ windowHours: 24, limit: 20, now: new Date("2026-04-10T12:00:00.000Z") })));
        `,
    });

    assert.equal(result.repeatedWarnings.length, 1);
    assert.equal(result.acknowledgedWarnings.length, 0);
    assert.equal(result.repeatedWarnings[0].count, 3);
});