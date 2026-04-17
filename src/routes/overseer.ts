import { Router, urlencoded } from "express";
import { callMcpTool } from "../mcp/toolAdapter.js";
import { runOverseer, checkOllamaReachable } from "../overseer/index.js";
import { renderOverseerDashboard } from "../overseer/dashboard.js";
import { getOverseerSchedulerStatus } from "../overseer/scheduler.js";
import {
    acknowledgeOverseerWarning,
    clearOverseerWarningAcknowledgement,
    getLastOverseerReportPath,
    getOverseerHistoryDir,
    isValidOverseerHistoryDayKey,
    loadLastOverseerReport,
    loadOverseerHistory,
    summarizeOverseerHistory,
} from "../overseer/storage.ts";
import { buildManifestOperationalSummary } from "../memory/manifestAnalytics.js";
import { listStoredManifests } from "../memory/manifest.js";
import { logger } from "../logging/logger.js";

const router = Router();
router.use(urlencoded({ extended: false }));

function queryString(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value.trim() || undefined;
    }

    if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === "string");
        return typeof first === "string" ? first.trim() || undefined : undefined;
    }

    return undefined;
}

function bodyString(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value.trim() || undefined;
    }

    return undefined;
}

function queryPositiveInt(value: unknown): number | undefined {
    const raw = queryString(value);
    if (raw === undefined) {
        return undefined;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

function queryPositiveNumber(value: unknown): number | undefined {
    const raw = queryString(value);
    if (raw === undefined) {
        return undefined;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

function queryDate(value: unknown): Date | undefined {
    const raw = queryString(value);
    if (raw === undefined) {
        return undefined;
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed) : new Date(Number.NaN);
}

async function callJsonTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const result = await callMcpTool({ name, arguments: args });
    const text = result.content[0]?.text ?? "{}";

    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return {
            error: `Invalid JSON response from ${name}`,
            raw: text,
        };
    }
}

function actionRedirectTarget(req: { body?: unknown; query?: unknown }): string {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const query = (req.query && typeof req.query === "object" ? req.query : {}) as Record<string, unknown>;
    return bodyString(body.redirectTo) || queryString(query.redirectTo) || "/overseer/dashboard";
}

/**
 * GET /overseer/status
 * Ollama 연결 가능 여부만 빠르게 확인한다.
 */
router.get("/overseer/status", async (_req, res) => {
    const reachable = await checkOllamaReachable();
    const lastReport = loadLastOverseerReport();
    res.status(reachable ? 200 : 503).json({
        reachable,
        scheduler: getOverseerSchedulerStatus(),
        stored: {
            available: Boolean(lastReport),
            filePath: getLastOverseerReportPath(),
            generatedAt: lastReport?.generatedAt,
            historyDir: getOverseerHistoryDir(),
        },
    });
});

/**
 * GET /overseer/last-report
 * 가장 최근에 자동 저장된 Overseer 리포트를 반환한다.
 */
router.get("/overseer/last-report", (_req, res) => {
    const filePath = getLastOverseerReportPath();
    const report = loadLastOverseerReport();

    if (!report) {
        res.status(404).json({
            error: "No stored automatic Overseer report found yet.",
            filePath,
            scheduler: getOverseerSchedulerStatus(),
        });
        return;
    }

    res.json({
        filePath,
        report,
        scheduler: getOverseerSchedulerStatus(),
    });
});

/**
 * GET /overseer/history
 * 자동 저장된 Overseer 리포트 히스토리를 newest-first로 반환한다.
 */
router.get("/overseer/history", (req, res) => {
    const dayKey = queryString(req.query.dayKey);
    const limit = queryPositiveInt(req.query.limit);

    if (dayKey && !isValidOverseerHistoryDayKey(dayKey)) {
        res.status(400).json({ error: "dayKey must be YYYY-MM-DD" });
        return;
    }

    if (Number.isNaN(limit)) {
        res.status(400).json({ error: "limit must be a positive integer" });
        return;
    }

    res.json({
        ...loadOverseerHistory({ dayKey, limit }),
        scheduler: getOverseerSchedulerStatus(),
    });
});

/**
 * GET /overseer/summary
 * 최근 Overseer 히스토리 기반 운영 요약을 반환한다.
 */
router.get("/overseer/summary", (req, res) => {
    const windowHours = queryPositiveNumber(req.query.windowHours);
    const limit = queryPositiveInt(req.query.limit);
    const now = queryDate(req.query.now);

    if (Number.isNaN(windowHours)) {
        res.status(400).json({ error: "windowHours must be a positive number" });
        return;
    }

    if (Number.isNaN(limit)) {
        res.status(400).json({ error: "limit must be a positive integer" });
        return;
    }

    if (now && Number.isNaN(now.getTime())) {
        res.status(400).json({ error: "now must be a valid ISO timestamp" });
        return;
    }

    res.json({
        ...summarizeOverseerHistory({ windowHours, limit, now }),
        manifestAudioRetry: buildManifestOperationalSummary(
            listStoredManifests(undefined, { hydrateSectionArtifacts: true }),
            now,
            { shadowHistoryWindowHours: windowHours },
        ),
    });
});

/**
 * GET /overseer/dashboard
 * MCP-backed 운영 대시보드를 서버 렌더링으로 제공한다.
 */
router.get("/overseer/dashboard", async (req, res) => {
    const windowHours = queryPositiveNumber(req.query.windowHours);
    const limit = queryPositiveInt(req.query.limit);
    const now = queryDate(req.query.now);

    if (Number.isNaN(windowHours)) {
        res.status(400).type("text/plain").send("windowHours must be a positive number");
        return;
    }

    if (Number.isNaN(limit)) {
        res.status(400).type("text/plain").send("limit must be a positive integer");
        return;
    }

    if (now && Number.isNaN(now.getTime())) {
        res.status(400).type("text/plain").send("now must be a valid ISO timestamp");
        return;
    }

    const dashboardWindowHours = windowHours ?? 24;
    const dashboardLimit = limit ?? 30;

    try {
        const [status, lastReport, history, summary] = await Promise.all([
            callJsonTool("axiom.overseer.status"),
            callJsonTool("axiom.overseer.last_report"),
            callJsonTool("axiom.overseer.history", { limit: dashboardLimit }),
            callJsonTool("axiom.overseer.summary", {
                windowHours: dashboardWindowHours,
                limit: 200,
                ...(now ? { now: now.toISOString() } : {}),
            }),
        ]);

        res.type("html").send(renderOverseerDashboard({
            refreshedAt: new Date().toISOString(),
            limit: dashboardLimit,
            windowHours: dashboardWindowHours,
            status,
            lastReport,
            history,
            summary,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Overseer dashboard render failed", { error: message });
        res.status(500).type("text/plain").send(message);
    }
});

router.post("/overseer/warnings/acknowledge", (req, res) => {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;

    try {
        const acknowledgement = acknowledgeOverseerWarning({
            warning: bodyString(body.warning),
            warningKey: bodyString(body.warningKey),
            lastSeenAt: bodyString(body.lastSeenAt),
            note: bodyString(body.note),
        });

        if (req.is("application/json")) {
            res.json({ acknowledged: true, acknowledgement });
            return;
        }

        res.redirect(303, actionRedirectTarget(req));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (req.is("application/json")) {
            res.status(400).json({ error: message });
            return;
        }

        res.status(400).type("text/plain").send(message);
    }
});

router.post("/overseer/warnings/unacknowledge", (req, res) => {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;

    try {
        const result = clearOverseerWarningAcknowledgement({
            warning: bodyString(body.warning),
            warningKey: bodyString(body.warningKey),
        });

        if (req.is("application/json")) {
            res.json(result);
            return;
        }

        res.redirect(303, actionRedirectTarget(req));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (req.is("application/json")) {
            res.status(400).json({ error: message });
            return;
        }

        res.status(400).type("text/plain").send(message);
    }
});

/**
 * POST /overseer/report
 * 최근 로그와 manifest를 Gemma 4에 보내 운영 요약을 생성한다.
 * 모델 추론 시간이 있으므로 최대 2분까지 걸릴 수 있다.
 */
router.post("/overseer/report", async (_req, res) => {
    const reachable = await checkOllamaReachable();
    if (!reachable) {
        res.status(503).json({ error: "Ollama is not reachable. Is it running?" });
        return;
    }

    try {
        const report = await runOverseer();
        res.json(report);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Overseer report failed", { error: message });
        res.status(500).json({ error: message });
    }
});

export default router;
