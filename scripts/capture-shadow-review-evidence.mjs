import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VALID_LANES = new Set(["baseline", "candidate"]);

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

function fail(message, details) {
    const payload = {
        ok: false,
        message,
        details,
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function writeAtomic(filePath, text) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, text, "utf-8");
    fs.renameSync(tempPath, filePath);
}

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function toTrimmed(value, fallback = "-") {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function formatDelta(value) {
    const numeric = toNumber(value) ?? 0;
    return numeric > 0 ? `+${numeric}` : String(numeric);
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function resolveReviewPath() {
    const reviewPath = readOption("review") || process.env.AXIOM_SHADOW_REVIEW_FILE;
    if (!reviewPath) {
        fail("--review is required", { hint: "Pass the scaffold JSON path created by ops:shadow:init" });
    }
    if (!fs.existsSync(reviewPath)) {
        fail("Shadow review file does not exist", { reviewPath });
    }
    return reviewPath;
}

function resolveLane() {
    const lane = toTrimmed(readOption("lane"), "");
    if (!VALID_LANES.has(lane)) {
        fail("--lane must be one of baseline or candidate", { lane, supported: [...VALID_LANES] });
    }
    return lane;
}

function resolveProjectionDir() {
    return readOption("projectionDir")
        || process.env.AXIOM_OPERATOR_PROJECTION_DIR
        || path.join(process.env.OUTPUT_DIR || "outputs", "_system", "operator-summary");
}

async function collectOperatorSummary() {
    const args = ["scripts/print-operator-summary.mjs"];
    const passThroughOptions = ["url", "source", "jobLimit", "windowHours", "token", "namespace"];
    for (const option of passThroughOptions) {
        const value = readOption(option);
        if (value) {
            args.push(`--${option}`, value);
        }
    }

    let result;
    try {
        result = await execFileAsync(process.execPath, args, {
            cwd: process.cwd(),
            env: process.env,
            maxBuffer: 1024 * 1024,
        });
    } catch (error) {
        fail("Operator summary collection failed", {
            stdout: String(error.stdout || "").trim(),
            stderr: String(error.stderr || "").trim(),
            code: error.code,
        });
    }

    const stdout = String(result.stdout || "").trim();
    if (!stdout) {
        fail("Operator summary script produced no output", {});
    }

    try {
        return JSON.parse(stdout);
    } catch (error) {
        fail("Operator summary script returned non-JSON output", {
            stdout,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function readProjectionArtifacts(projectionDir) {
    const latestJsonPath = path.join(projectionDir, "latest.json");
    const latestMarkdownPath = path.join(projectionDir, "latest.md");
    const upstreamCompatiblePath = path.join(projectionDir, "upstream-compatible.json");
    const latestErrorPath = path.join(projectionDir, "latest-error.json");

    return {
        projectionDir,
        latestJsonPath,
        latestMarkdownPath,
        upstreamCompatiblePath,
        latestErrorPath,
        latest: fs.existsSync(latestJsonPath) ? readJsonFile(latestJsonPath) : null,
        upstreamCompatible: fs.existsSync(upstreamCompatiblePath) ? readJsonFile(upstreamCompatiblePath) : null,
        latestError: fs.existsSync(latestErrorPath) ? readJsonFile(latestErrorPath) : null,
        latestMarkdownExists: fs.existsSync(latestMarkdownPath),
    };
}

function buildMetrics(operatorSummary, projectionArtifacts) {
    return {
        readiness: toTrimmed(operatorSummary.readiness?.status),
        queueTotal: toNumber(operatorSummary.queue?.total) ?? 0,
        queueQueued: toNumber(operatorSummary.queue?.queued) ?? 0,
        queueRunning: toNumber(operatorSummary.queue?.running) ?? 0,
        queueRetryScheduled: toNumber(operatorSummary.queue?.retryScheduled) ?? 0,
        queueFailedLike: toNumber(operatorSummary.queue?.failedLike) ?? 0,
        pendingApprovals: toNumber(operatorSummary.autonomy?.pendingApprovalCount) ?? 0,
        autonomyPaused: operatorSummary.autonomy?.paused === true,
        repeatedWarnings: toNumber(operatorSummary.overseer?.activeRepeatedWarningCount) ?? 0,
        failureCount24h: toNumber(operatorSummary.overseer?.failureCount24h) ?? 0,
        projectionError: projectionArtifacts.latestError !== null,
        projectionObservedAt: toTrimmed(projectionArtifacts.latest?.observedAt, "-"),
    };
}

function buildSnapshot({ lane, notes, operatorSummary, projectionArtifacts }) {
    const capturedAt = new Date().toISOString();
    return {
        lane,
        capturedAt,
        notes,
        metrics: buildMetrics(operatorSummary, projectionArtifacts),
        operatorSummary: cloneJson(operatorSummary),
        projection: {
            projectionDir: projectionArtifacts.projectionDir,
            latest: projectionArtifacts.latest ? cloneJson(projectionArtifacts.latest) : null,
            upstreamCompatible: projectionArtifacts.upstreamCompatible ? cloneJson(projectionArtifacts.upstreamCompatible) : null,
            latestError: projectionArtifacts.latestError ? cloneJson(projectionArtifacts.latestError) : null,
            latestMarkdownExists: projectionArtifacts.latestMarkdownExists,
        },
    };
}

function buildDelta(baselineValue, candidateValue) {
    const baseline = toNumber(baselineValue) ?? 0;
    const candidate = toNumber(candidateValue) ?? 0;
    return {
        baseline,
        candidate,
        delta: candidate - baseline,
    };
}

function buildComparison(baseline, candidate) {
    if (!baseline || !candidate) {
        return {
            ready: false,
            computedAt: new Date().toISOString(),
            summary: "baseline and candidate evidence are both required before comparison is ready",
            rollbackSignals: [],
        };
    }

    const deltas = {
        queueTotal: buildDelta(baseline.metrics.queueTotal, candidate.metrics.queueTotal),
        queueQueued: buildDelta(baseline.metrics.queueQueued, candidate.metrics.queueQueued),
        queueRunning: buildDelta(baseline.metrics.queueRunning, candidate.metrics.queueRunning),
        queueRetryScheduled: buildDelta(baseline.metrics.queueRetryScheduled, candidate.metrics.queueRetryScheduled),
        queueFailedLike: buildDelta(baseline.metrics.queueFailedLike, candidate.metrics.queueFailedLike),
        pendingApprovals: buildDelta(baseline.metrics.pendingApprovals, candidate.metrics.pendingApprovals),
        repeatedWarnings: buildDelta(baseline.metrics.repeatedWarnings, candidate.metrics.repeatedWarnings),
        failureCount24h: buildDelta(baseline.metrics.failureCount24h, candidate.metrics.failureCount24h),
    };

    const rollbackSignals = [];
    if (baseline.metrics.readiness !== candidate.metrics.readiness) {
        rollbackSignals.push(`readiness changed: ${baseline.metrics.readiness} -> ${candidate.metrics.readiness}`);
    }
    if (deltas.queueFailedLike.delta > 0) {
        rollbackSignals.push(`failedLike queue increased by ${deltas.queueFailedLike.delta}`);
    }
    if (deltas.pendingApprovals.delta > 0) {
        rollbackSignals.push(`pending approvals increased by ${deltas.pendingApprovals.delta}`);
    }
    if (deltas.repeatedWarnings.delta > 0) {
        rollbackSignals.push(`repeated warnings increased by ${deltas.repeatedWarnings.delta}`);
    }
    if (deltas.queueRetryScheduled.delta > 0) {
        rollbackSignals.push(`retry_scheduled queue increased by ${deltas.queueRetryScheduled.delta}`);
    }
    if (!baseline.metrics.projectionError && candidate.metrics.projectionError) {
        rollbackSignals.push("candidate projection now has latest-error evidence");
    }

    const summary = [
        `queue total ${formatDelta(deltas.queueTotal.delta)}`,
        `failedLike ${formatDelta(deltas.queueFailedLike.delta)}`,
        `pending approvals ${formatDelta(deltas.pendingApprovals.delta)}`,
        `repeated warnings ${formatDelta(deltas.repeatedWarnings.delta)}`,
    ].join(" | ");

    return {
        ready: true,
        computedAt: new Date().toISOString(),
        summary,
        readiness: {
            baseline: baseline.metrics.readiness,
            candidate: candidate.metrics.readiness,
        },
        deltas,
        projection: {
            baselineError: baseline.metrics.projectionError,
            candidateError: candidate.metrics.projectionError,
        },
        rollbackSignals,
    };
}

function pushUnique(list, value) {
    if (!list.includes(value)) {
        list.push(value);
    }
}

function formatEvidenceLane(label, snapshot) {
    if (!snapshot) {
        return [
            `## ${label} Evidence Snapshot`,
            "",
            "- not captured yet",
            "",
        ];
    }

    const lines = [
        `## ${label} Evidence Snapshot`,
        "",
        `- captured_at: ${snapshot.capturedAt}`,
        `- notes: ${toTrimmed(snapshot.notes)}`,
        `- summary: ${toTrimmed(snapshot.operatorSummary.summary)}`,
        `- readiness: ${toTrimmed(snapshot.metrics.readiness)}`,
        `- queue_total: ${snapshot.metrics.queueTotal}`,
        `- queue_queued: ${snapshot.metrics.queueQueued}`,
        `- queue_running: ${snapshot.metrics.queueRunning}`,
        `- queue_retry_scheduled: ${snapshot.metrics.queueRetryScheduled}`,
        `- queue_failed_like: ${snapshot.metrics.queueFailedLike}`,
        `- pending_approvals: ${snapshot.metrics.pendingApprovals}`,
        `- repeated_warnings: ${snapshot.metrics.repeatedWarnings}`,
        `- projection_error: ${snapshot.metrics.projectionError ? "yes" : "no"}`,
        `- projection_observed_at: ${toTrimmed(snapshot.metrics.projectionObservedAt)}`,
        "",
    ];

    return lines;
}

function buildMarkdown(review) {
    const envEntries = Object.entries(review.baseline?.config?.env || {});
    const manualFields = Array.isArray(review.baseline?.config?.manualFields) ? review.baseline.config.manualFields : [];
    const observationGuidance = Array.isArray(review.observation?.guidance) ? review.observation.guidance : [];
    const rollbackTriggers = Array.isArray(review.rollback?.triggers) ? review.rollback.triggers : [];
    const rollbackChecklist = Array.isArray(review.rollback?.checklist) ? review.rollback.checklist : [];
    const baselineEvidence = review.evidence?.lanes?.baseline || null;
    const candidateEvidence = review.evidence?.lanes?.candidate || null;
    const comparison = review.comparison || null;

    const lines = [
        `# ${review.title}`,
        "",
        `- generated_at: ${review.generatedAt}`,
        `- policy: ${review.policy}`,
        `- source: ${review.source}`,
        `- base_url: ${review.baseUrl}`,
        `- namespace: ${review.namespace}`,
        `- owner: ${review.owner}`,
        `- observation_window: ${review.observation?.window || "-"}`,
        `- candidate: ${review.candidate?.summary || "-"}`,
        "",
        "## Baseline Config",
        "",
    ];

    if (envEntries.length === 0) {
        lines.push("- env snapshot: none");
    } else {
        for (const [key, value] of envEntries) {
            lines.push(`- ${key}: ${toTrimmed(value, "<unset>")}`);
        }
    }

    if (manualFields.length > 0) {
        lines.push("", "## Manual Fields To Fill", "");
        for (const field of manualFields) {
            lines.push(`- ${field}: TODO`);
        }
    }

    lines.push(
        "",
        "## Initial Baseline Snapshot",
        "",
        `- summary: ${toTrimmed(review.baseline?.operatorSummary?.summary)}`,
        `- readiness: ${toTrimmed(review.baseline?.operatorSummary?.readiness?.status)}`,
        `- queue total: ${review.baseline?.operatorSummary?.queue?.total ?? 0}`,
        `- pending approvals: ${review.baseline?.operatorSummary?.autonomy?.pendingApprovalCount ?? 0}`,
        `- overseer warnings: ${review.baseline?.operatorSummary?.overseer?.activeRepeatedWarningCount ?? 0}`,
        "",
        "## Candidate Change",
        "",
        `- summary: ${review.candidate?.summary || "-"}`,
        `- env_overrides: ${Array.isArray(review.candidate?.envOverrides) && review.candidate.envOverrides.length > 0 ? review.candidate.envOverrides.join(", ") : "TODO"}`,
        "",
        "## Observation Guidance",
        "",
    );

    for (const item of observationGuidance) {
        lines.push(`- ${item}`);
    }

    lines.push("", ...formatEvidenceLane("Baseline", baselineEvidence));
    lines.push(...formatEvidenceLane("Candidate", candidateEvidence));

    lines.push("## Comparison Snapshot", "");
    if (!comparison || comparison.ready !== true) {
        lines.push("- comparison: waiting for both baseline and candidate evidence");
    } else {
        lines.push(`- computed_at: ${comparison.computedAt}`);
        lines.push(`- summary: ${comparison.summary}`);
        lines.push(`- readiness: ${comparison.readiness.baseline} -> ${comparison.readiness.candidate}`);
        lines.push(`- queue_total_delta: ${formatDelta(comparison.deltas.queueTotal.delta)}`);
        lines.push(`- queue_failed_like_delta: ${formatDelta(comparison.deltas.queueFailedLike.delta)}`);
        lines.push(`- pending_approvals_delta: ${formatDelta(comparison.deltas.pendingApprovals.delta)}`);
        lines.push(`- repeated_warnings_delta: ${formatDelta(comparison.deltas.repeatedWarnings.delta)}`);
        lines.push(`- projection_error: baseline=${comparison.projection.baselineError ? "yes" : "no"}, candidate=${comparison.projection.candidateError ? "yes" : "no"}`);
        lines.push("");
        lines.push("### Comparison Signals");
        lines.push("");
        if (comparison.rollbackSignals.length === 0) {
            lines.push("- no automatic rollback signals detected from the captured evidence");
        } else {
            for (const item of comparison.rollbackSignals) {
                lines.push(`- ${item}`);
            }
        }
    }

    lines.push("", "## Rollback Triggers", "");
    for (const item of rollbackTriggers) {
        lines.push(`- [ ] ${item}`);
    }

    lines.push("", "## Rollback Checklist", "");
    for (const item of rollbackChecklist) {
        lines.push(`- [ ] ${item}`);
    }

    lines.push("", "## Artifacts", "");
    for (const item of review.artifacts || []) {
        lines.push(`- ${item}`);
    }

    return lines.join("\n") + "\n";
}

async function main() {
    const reviewPath = resolveReviewPath();
    const review = readJsonFile(reviewPath);
    const lane = resolveLane();
    const notes = toTrimmed(readOption("notes") || process.env.AXIOM_SHADOW_REVIEW_NOTES, "-");
    const projectionDir = resolveProjectionDir();
    const operatorSummary = await collectOperatorSummary();
    const projectionArtifacts = readProjectionArtifacts(projectionDir);
    const snapshot = buildSnapshot({ lane, notes, operatorSummary, projectionArtifacts });
    const markdownPath = reviewPath.replace(/\.json$/i, ".md");
    const historyPath = reviewPath.replace(/\.json$/i, ".evidence.jsonl");

    review.evidence = review.evidence || { lanes: {}, history: [] };
    review.evidence.lanes = review.evidence.lanes || {};
    review.evidence.history = Array.isArray(review.evidence.history) ? review.evidence.history : [];
    review.evidence.lanes[lane] = snapshot;
    review.evidence.history.push({
        lane,
        capturedAt: snapshot.capturedAt,
        notes: snapshot.notes,
        summary: snapshot.operatorSummary.summary,
        metrics: snapshot.metrics,
    });

    review.comparison = buildComparison(review.evidence.lanes.baseline || null, review.evidence.lanes.candidate || null);
    review.artifacts = Array.isArray(review.artifacts) ? review.artifacts : [];
    pushUnique(review.artifacts, "outputs/_system/operator-summary/latest-error.json");
    pushUnique(review.artifacts, "outputs/_system/operator-summary/errors/YYYY-MM-DD.jsonl");
    pushUnique(review.artifacts, path.relative(process.cwd(), historyPath).replace(/\\/g, "/"));

    writeAtomic(reviewPath, JSON.stringify(review, null, 2) + "\n");
    writeAtomic(markdownPath, buildMarkdown(review));
    ensureDir(path.dirname(historyPath));
    fs.appendFileSync(historyPath, JSON.stringify({
        lane,
        capturedAt: snapshot.capturedAt,
        notes: snapshot.notes,
        metrics: snapshot.metrics,
        summary: snapshot.operatorSummary.summary,
    }) + "\n", "utf-8");

    console.log(JSON.stringify({
        ok: true,
        lane,
        reviewPath,
        markdownPath,
        historyPath,
        comparisonReady: review.comparison.ready === true,
        comparisonSummary: review.comparison.summary,
        summary: snapshot.operatorSummary.summary,
    }, null, 2));
}

main().catch((error) => {
    fail("AXIOM shadow review evidence capture failed", {
        error: error instanceof Error ? error.message : String(error),
    });
});