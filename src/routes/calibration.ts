import { Router } from "express";
import { logger } from "../logging/logger.js";
import type { CuratorCalibrationReview } from "../core/pipeline/types.js";
import {
    readStructureCandidateIndex,
    saveCuratorCalibration,
} from "../runtime/manifest/candidates.js";

// ─── /calibration routes ──────────────────────────────────────────────────────
//
// These routes accept curator calibration reviews — a secondary signal used to
// verify that internal critic scores align with trained human / domain-expert
// perception.
//
// AXIOM philosophy:
//   InternalCriticApproval (computed from craft scores) → PRIMARY gate
//   CuratorCalibrationReview (this route) → CALIBRATION ONLY, not a reward signal
//
// Calibration data is consumed by:
//   npm run analyze:score-feedback  — correlation analysis
//   scripts/export-sft-dataset.mjs  — uses --approved-only (internal critic gate)
//
// ──────────────────────────────────────────────────────────────────────────────

const router = Router();

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function ratingField(value: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return undefined;
    const r = Math.round(n);
    if (r >= 1 && r <= 5) return r as 1 | 2 | 3 | 4 | 5;
    return undefined;
}

function validateSource(value: unknown): CuratorCalibrationReview["source"] | null {
    if (value === "human" || value === "automated" || value === "expert-review") {
        return value;
    }
    return null;
}

/**
 * POST /calibration/:songId/:candidateId
 *
 * Attaches a CuratorCalibrationReview to any structure candidate (selected or
 * rejected).  Used to cross-check whether internal critic scores agree with
 * expert / trained-human perception.
 *
 * This does NOT override the internal critic approval decision.
 * SFT export uses InternalCriticApproval.approved, not this field.
 *
 * Body fields:
 *   source          (required) "human" | "automated" | "expert-review"
 *   qualityRating   (required) 1–5
 *   harmonyRating   (optional) 1–5
 *   structureRating (optional) 1–5
 *   motifRating     (optional) 1–5
 *   pianoRating     (optional) 1–5
 *   calibrationNote (optional) free-text note about what the critic got right/wrong
 *   preferredOver   (optional) candidateId this was preferred over (pairwise signal)
 *   calibrationInsight (optional) why this candidate ranked lower (insight, not reward)
 */
router.post("/calibration/:songId/:candidateId", (req, res) => {
    const { songId, candidateId } = req.params;
    const body = req.body as Record<string, unknown> | undefined;

    const source = validateSource(body?.source);
    if (!source) {
        res.status(400).json({
            ok: false,
            error: 'source is required: "human" | "automated" | "expert-review"',
        });
        return;
    }

    const qualityRating = ratingField(body?.qualityRating);
    if (qualityRating === undefined) {
        res.status(400).json({ ok: false, error: "qualityRating is required and must be 1–5" });
        return;
    }

    // Validate candidate exists in the index
    const index = readStructureCandidateIndex(songId);
    if (!index || !index.entries.some((e) => e.candidateId === candidateId)) {
        res.status(404).json({ ok: false, error: `Candidate ${candidateId} not found for song ${songId}` });
        return;
    }

    const review: CuratorCalibrationReview = {
        source,
        qualityRating,
        reviewedAt: new Date().toISOString(),
    };

    const harmonyRating = ratingField(body?.harmonyRating);
    if (harmonyRating !== undefined) review.harmonyRating = harmonyRating;

    const structureRating = ratingField(body?.structureRating);
    if (structureRating !== undefined) review.structureRating = structureRating;

    const motifRating = ratingField(body?.motifRating);
    if (motifRating !== undefined) review.motifRating = motifRating;

    const pianoRating = ratingField(body?.pianoRating);
    if (pianoRating !== undefined) review.pianoRating = pianoRating;

    const calibrationNote = compact(body?.calibrationNote);
    if (calibrationNote) review.calibrationNote = calibrationNote;

    const preferredOver = compact(body?.preferredOver);
    if (preferredOver) review.preferredOver = preferredOver;

    const calibrationInsight = compact(body?.calibrationInsight);
    if (calibrationInsight) review.calibrationInsight = calibrationInsight;

    try {
        const updated = saveCuratorCalibration(songId, candidateId, review);
        if (!updated) {
            res.status(404).json({ ok: false, error: `Candidate manifest missing for ${candidateId}` });
            return;
        }

        res.json({
            ok: true,
            role: "calibration",
            songId,
            candidateId,
            selected: updated.selected,
            curatorCalibration: updated.curatorCalibration,
            // Surface the internal critic approval so the caller can compare
            internalCriticApproval: updated.internalCriticApproval,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Failed to save curator calibration", { error: message, songId, candidateId });
        res.status(500).json({ ok: false, error: message });
    }
});

export default router;
