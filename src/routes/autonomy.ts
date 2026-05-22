import { Router, type Request } from "express";
import {
    approveAutonomySong,
    getAutonomyStatus,
    listPendingApprovalSummaries,
    pauseAutonomy,
    previewAutonomyPlan,
    rejectAutonomySong,
    resumeAutonomy,
} from "../ops/autonomy/service.js";
import { getAutonomySchedulerStatus } from "../ops/autonomy/scheduler.js";
import { isAutonomyConflictError } from "../ops/autonomy/service.js";
import {
    getAutonomyOperationalSummary,
    reconcileAutonomyLock,
    isAutonomyUnavailableError,
    parseAutonomyConflictPayload,
    triggerAutonomyRun,
} from "../ops/autonomy/controller.js";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import { checkOllamaReachable } from "../ops/overseer/index.js";
import type { AutonomyReviewFeedbackInput } from "../ops/autonomy/types.js";
import type { ListenerFeedback } from "../core/pipeline/types.js";

const router = Router();

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function isSafeId(id: string): boolean {
    return id.length > 0 && id.length <= 256 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function finiteNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }

    const normalized = compact(value);
    if (!normalized) {
        return undefined;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function ratingField(value: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
    const n = finiteNumber(value);
    if (n === undefined) return undefined;
    const rounded = Math.round(n);
    if (rounded >= 1 && rounded <= 5) return rounded as 1 | 2 | 3 | 4 | 5;
    return undefined;
}

type AutonomyReviewRequestBody = {
    note?: string;
    reason?: string;
    actor?: string;
    approvedBy?: string;
    rollbackNote?: string;
    manualRecoveryNote?: string;
    appealScore?: number | string;
    strongestDimension?: string;
    weakestDimension?: string;
    comparisonReference?: string;
    /** Per-dimension listener rating (1–5) */
    appeal?: number | string;
    memorability?: number | string;
    coherence?: number | string;
    emotionalImpact?: number | string;
    listenerNotes?: string;
    comparisonCandidateId?: string;
};

type AutonomyMutationRequestBody = {
    actor?: string;
    approvedBy?: string;
    rollbackNote?: string;
    manualRecoveryNote?: string;
};

function parseListenerFeedback(body: AutonomyReviewRequestBody | undefined): ListenerFeedback | undefined {
    const appeal = ratingField(body?.appeal);
    if (appeal === undefined) {
        return undefined;
    }

    const feedback: ListenerFeedback = { appeal };
    const memorability = ratingField(body?.memorability);
    if (memorability !== undefined) feedback.memorability = memorability;
    const coherence = ratingField(body?.coherence);
    if (coherence !== undefined) feedback.coherence = coherence;
    const emotionalImpact = ratingField(body?.emotionalImpact);
    if (emotionalImpact !== undefined) feedback.emotionalImpact = emotionalImpact;

    const strongestDimension = compact(body?.strongestDimension) as ListenerFeedback["strongestDimension"] || undefined;
    if (strongestDimension) feedback.strongestDimension = strongestDimension;
    const weakestDimension = compact(body?.weakestDimension) as ListenerFeedback["weakestDimension"] || undefined;
    if (weakestDimension) feedback.weakestDimension = weakestDimension;

    const notes = compact(body?.listenerNotes) || undefined;
    if (notes) feedback.notes = notes;
    const comparisonCandidateId = compact(body?.comparisonCandidateId) || undefined;
    if (comparisonCandidateId) feedback.comparisonCandidateId = comparisonCandidateId;

    return feedback;
}

function parseReviewFeedback(body: AutonomyReviewRequestBody | undefined, noteValue: unknown): AutonomyReviewFeedbackInput {
    const listenerFeedback = parseListenerFeedback(body);
    return {
        note: compact(noteValue) || undefined,
        appealScore: finiteNumber(body?.appealScore),
        strongestDimension: compact(body?.strongestDimension) || undefined,
        weakestDimension: compact(body?.weakestDimension) || undefined,
        comparisonReference: compact(body?.comparisonReference) || undefined,
        ...(listenerFeedback ? { listenerFeedback } : {}),
    };
}

function getOperatorAuditContext(req: Request, body?: AutonomyMutationRequestBody) {
    const actor = compact(body?.actor) || compact(req.get("x-operator-actor")) || undefined;
    const approvedBy = compact(body?.approvedBy) || compact(req.get("x-approved-by")) || undefined;
    const rollbackNote = compact(body?.rollbackNote) || compact(req.get("x-rollback-note")) || undefined;
    const manualRecoveryNote = compact(body?.manualRecoveryNote) || compact(req.get("x-manual-recovery-note")) || undefined;
    return {
        surface: "api" as const,
        actor,
        approvedBy,
        rollbackNote,
        manualRecoveryNote,
    };
}

router.get("/autonomy/status", async (_req, res) => {
    const [reachable, status] = await Promise.all([
        checkOllamaReachable(),
        getAutonomyStatus(),
    ]);
    const operations = getAutonomyOperationalSummary();

    res.status(reachable ? 200 : 503).json({
        reachable,
        ...status,
        scheduler: getAutonomySchedulerStatus(),
        operations,
    });
});

router.get("/autonomy/ops", async (_req, res) => {
    const [reachable, status] = await Promise.all([
        checkOllamaReachable(),
        getAutonomyStatus(),
    ]);

    res.status(reachable ? 200 : 503).json({
        reachable,
        paused: status.paused,
        pauseReason: status.pauseReason,
        activeRun: status.activeRun,
        feedbackHighlights: status.feedbackHighlights,
        pendingApprovalCount: status.pendingApprovalCount,
        pendingApprovals: status.pendingApprovals,
        lastRun: status.lastRun,
        scheduler: getAutonomySchedulerStatus(),
        operations: getAutonomyOperationalSummary(),
    });
});

router.get("/autonomy/pending", (_req, res) => {
    res.json(listPendingApprovalSummaries());
});

router.post("/autonomy/reconcile-lock", async (req, res) => {
    const body = req.body as ({ reason?: string } & AutonomyMutationRequestBody) | undefined;
    res.json(await reconcileAutonomyLock(body?.reason || "api", true, getOperatorAuditContext(req, body)));
});

router.post("/autonomy/pause", (req, res) => {
    const body = req.body as ({ reason?: string } & AutonomyMutationRequestBody) | undefined;
    const state = pauseAutonomy(body?.reason, getOperatorAuditContext(req, body));
    res.json(state);
});

router.post("/autonomy/resume", (req, res) => {
    const body = req.body as AutonomyMutationRequestBody | undefined;
    const state = resumeAutonomy(getOperatorAuditContext(req, body));
    res.json(state);
});

router.post("/autonomy/preview", async (_req, res) => {
    if (!config.autonomyEnabled) {
        res.status(503).json({ error: "autonomy planner is disabled" });
        return;
    }

    const reachable = await checkOllamaReachable();
    if (!reachable) {
        res.status(503).json({ error: "LLM backend is not reachable. Is it running?" });
        return;
    }

    try {
        const plan = await previewAutonomyPlan();
        res.json(plan);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Autonomy preview failed", { error: message });
        res.status(500).json({ error: message });
    }
});

router.post("/autonomy/trigger", async (_req, res) => {
    try {
        const result = await triggerAutonomyRun("api");
        res.status(202).json({
            jobId: result.jobId,
            status: result.status,
            runId: result.runId,
            promptHash: result.promptHash,
            request: result.request,
            rationale: result.rationale,
            inspirationSnapshot: result.inspirationSnapshot,
            planSummary: result.planSummary,
            noveltySummary: result.noveltySummary,
            candidateSelection: result.candidateSelection,
        });
    } catch (err) {
        if (isAutonomyUnavailableError(err)) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }

        const conflict = parseAutonomyConflictPayload(err);
        if (conflict) {
            res.status(409).json(conflict);
            return;
        }

        if (isAutonomyConflictError(err)) {
            res.status(err.statusCode).json({ error: err.message, ...(err.details ?? {}) });
            return;
        }

        const message = err instanceof Error ? err.message : String(err);
        logger.error("Autonomy trigger failed", { error: message });
        res.status(500).json({ error: message });
    }
});

router.post("/autonomy/approve/:songId", (req, res) => {
    try {
        const { songId } = req.params;
        if (!isSafeId(songId)) {
            res.status(400).json({ error: "invalid songId" });
            return;
        }
        const body = req.body as AutonomyReviewRequestBody | undefined;
        const manifest = approveAutonomySong(
            songId,
            parseReviewFeedback(body, body?.note),
            getOperatorAuditContext(req, body),
        );
        if (!manifest) {
            res.status(404).json({ error: "manifest not found" });
            return;
        }

        res.json({
            songId: manifest.songId,
            approvalStatus: manifest.approvalStatus,
            evaluationSummary: manifest.evaluationSummary,
            reviewFeedback: manifest.reviewFeedback,
        });
    } catch (err) {
        if (isAutonomyConflictError(err)) {
            res.status(err.statusCode).json({ error: err.message, ...(err.details ?? {}) });
            return;
        }

        const message = err instanceof Error ? err.message : String(err);
        logger.error("Autonomy approval failed", { error: message, songId: req.params.songId });
        res.status(500).json({ error: message });
    }
});

router.post("/autonomy/reject/:songId", (req, res) => {
    try {
        const { songId } = req.params;
        if (!isSafeId(songId)) {
            res.status(400).json({ error: "invalid songId" });
            return;
        }
        const body = req.body as AutonomyReviewRequestBody | undefined;
        const manifest = rejectAutonomySong(
            songId,
            parseReviewFeedback(body, body?.reason ?? body?.note),
            getOperatorAuditContext(req, body),
        );
        if (!manifest) {
            res.status(404).json({ error: "manifest not found" });
            return;
        }

        res.json({
            songId: manifest.songId,
            approvalStatus: manifest.approvalStatus,
            evaluationSummary: manifest.evaluationSummary,
            reviewFeedback: manifest.reviewFeedback,
        });
    } catch (err) {
        if (isAutonomyConflictError(err)) {
            res.status(err.statusCode).json({ error: err.message, ...(err.details ?? {}) });
            return;
        }

        const message = err instanceof Error ? err.message : String(err);
        logger.error("Autonomy rejection failed", { error: message, songId: req.params.songId });
        res.status(500).json({ error: message });
    }
});

export default router;