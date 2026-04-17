import { Router } from "express";
import { getRuntimeReadinessSummary } from "../operator/summary.js";

const router = Router();

router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

router.get("/ready", (_req, res) => {
    const readiness = getRuntimeReadinessSummary();
    res.status(readiness.status === "not_ready" ? 503 : 200).json(readiness);
});

export default router;
