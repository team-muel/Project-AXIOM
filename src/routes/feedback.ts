import { Router } from "express";
import { logger } from "../logging/logger.js";
import type { HumanCalibrationFeedback } from "../core/pipeline/types.js";
import {
    readStructureCandidateIndex,
    saveListenerFeedbackToCandidate,
} from "../runtime/manifest/candidates.js";

const router = Router();

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function finiteNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    const normalized = compact(value);
    if (!normalized) return undefined;
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

/**
 * POST /feedback/:songId/:candidateId
 *
 * Records **human calibration feedback** for any structure candidate.
 *
 * AXIOM curation philosophy:
 *   - This feedback is **optional calibration metadata**, not a training gate.
 *   - It does NOT determine SFT/DPO eligibility by default.
 *   - AXIOM internal critic (InternalCriticApproval) is the primary curation source.
 *   - Use this endpoint to calibrate internal scores against human perception
 *     via `npm run analyze:score-feedback`.
 *
 * Supports pairwise preference signals (preferredOver) and rejection rationale
 * (rejectionReason) so that calibration tools can learn from all candidates,
 * not just the winner.
 *
 * Body fields:
 *   appeal           (required) 1–5 — overall calibration appeal rating
 *   coherence        (optional) 1–5
 *   memorability     (optional) 1–5
 *   emotionalImpact  (optional) 1–5
 *   preferredOver    (optional) candidateId preferred over this one (pairwise signal)
 *   rejectionReason  (optional) free-text calibration note for lower rank
 *   strongestDimension / weakestDimension / notes / comparisonCandidateId
 *     — same optional fields as the existing /autonomy/approve endpoint
 */
router.post("/feedback/:songId/:candidateId", (req, res) => {
    const { songId, candidateId } = req.params;

    const body = req.body as Record<string, unknown> | undefined;

    const appeal = ratingField(body?.appeal);
    if (appeal === undefined) {
        res.status(400).json({ ok: false, error: "appeal is required and must be an integer 1–5" });
        return;
    }

    // Validate candidateId exists in the index
    const index = readStructureCandidateIndex(songId);
    if (!index || !index.entries.some((e) => e.candidateId === candidateId)) {
        res.status(404).json({ ok: false, error: `Candidate ${candidateId} not found for song ${songId}` });
        return;
    }

    const feedback: HumanCalibrationFeedback = {};
    if (appeal !== undefined) feedback.appeal = appeal;

    const memorability = ratingField(body?.memorability);
    if (memorability !== undefined) feedback.memorability = memorability;

    const coherence = ratingField(body?.coherence);
    if (coherence !== undefined) feedback.coherence = coherence;

    const emotionalImpact = ratingField(body?.emotionalImpact);
    if (emotionalImpact !== undefined) feedback.emotionalImpact = emotionalImpact;

    const strongestDimension = compact(body?.strongestDimension) as HumanCalibrationFeedback["strongestDimension"];
    if (strongestDimension) feedback.strongestDimension = strongestDimension;

    const weakestDimension = compact(body?.weakestDimension) as HumanCalibrationFeedback["weakestDimension"];
    if (weakestDimension) feedback.weakestDimension = weakestDimension;

    const notes = compact(body?.notes);
    if (notes) feedback.notes = notes;

    const comparisonCandidateId = compact(body?.comparisonCandidateId);
    if (comparisonCandidateId) feedback.comparisonCandidateId = comparisonCandidateId;

    const preferredOver = compact(body?.preferredOver);
    if (preferredOver) feedback.preferredOver = preferredOver;

    const rejectionReason = compact(body?.rejectionReason);
    if (rejectionReason) feedback.rejectionReason = rejectionReason;

    try {
        const updated = saveListenerFeedbackToCandidate(songId, candidateId, feedback);
        if (!updated) {
            res.status(404).json({ ok: false, error: `Candidate manifest missing for ${candidateId}` });
            return;
        }

        res.json({
            ok: true,
            songId,
            candidateId,
            selected: updated.selected,
            listenerScores: updated.listenerScores,
            internalScores: updated.internalScores,
            curationDecision: updated.curationDecision,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Failed to save candidate feedback", { error: message, songId, candidateId });
        res.status(500).json({ ok: false, error: message });
    }
});

export default router;
