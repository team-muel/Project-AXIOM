import { Router } from "express";
import { normalizeComposeRequestInput } from "../pipeline/requestNormalization.js";
import { enqueue, getJob, listJobs } from "../queue/jobQueue.js";
import { serializeQueuedJob } from "../queue/presentation.js";
import { logger } from "../logging/logger.js";

const router = Router();

router.post("/compose", (req, res) => {
    const normalized = normalizeComposeRequestInput(req.body, "api");
    if (!normalized.request) {
        res.status(400).json({ error: normalized.errors.join("; ") || "invalid compose request" });
        return;
    }

    const request = normalized.request;

    logger.info("Compose request received", {
        prompt: request.prompt,
        workflow: request.workflow,
        hasCompositionProfile: !!request.compositionProfile,
        hasCompositionPlan: !!request.compositionPlan,
        hasQualityPolicy: !!request.qualityPolicy,
    });

    const job = enqueue(request);
    res.status(202).json(serializeQueuedJob(job));
});

router.get("/compose/:jobId", (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
        res.status(404).json({ error: "job not found" });
        return;
    }
    res.json(serializeQueuedJob(job));
});

router.get("/jobs", (_req, res) => {
    res.json(listJobs().map((job) => serializeQueuedJob(job)));
});

export default router;
