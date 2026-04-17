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

async function runAutonomyOpsScenario({ controlState, manifests = [], runLedger = [], preferences, evalCode }) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-autonomy-ops-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    const systemDir = path.join(outputDir, "_system");
    const dayKey = currentSeoulDayKey();

    fs.mkdirSync(path.join(systemDir, "runs"), { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(systemDir, "state.json"), JSON.stringify(controlState, null, 2));
    fs.writeFileSync(path.join(systemDir, "runs", `${dayKey}.json`), JSON.stringify(runLedger, null, 2));
    if (preferences) {
        fs.writeFileSync(path.join(systemDir, "preferences.json"), JSON.stringify(preferences, null, 2));
    }

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
        ${evalCode}
    `, {
        cwd: repoRoot,
        env: {
            OUTPUT_DIR: outputDir,
            LOG_DIR: logDir,
            OLLAMA_URL: "http://127.0.0.1:11434",
            AUTONOMY_ENABLED: "true",
            AUTONOMY_SCHEDULER_TIMEZONE: "Asia/Seoul",
            AUTONOMY_STALE_LOCK_MS: "60000",
            AUTONOMY_AUTO_CLEAR_STALE_LOCKS: "true",
            AUTONOMY_MAX_ATTEMPTS_PER_DAY: "2",
            LOG_LEVEL: "error",
        },
    });

    const result = parseLastJsonLine(stdout);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return result;
}

test("reports stale autonomy lock in operational summary", async () => {
    const result = await runAutonomyOpsScenario({
        controlState: {
            paused: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
            activeRun: {
                runId: "stale-run",
                promptHash: "hash-stale",
                acquiredAt: "2026-04-10T00:00:00.000Z",
                state: "running",
                jobId: "job-stale",
            },
        },
        evalCode: `
            const { getAutonomyOperationalSummary } = await import("./dist/autonomy/controller.js");
            const summary = getAutonomyOperationalSummary(new Date("2026-04-10T02:30:00.000Z"));
            console.log(JSON.stringify(summary));
        `,
    });

    assert.equal(result.lockHealth.stale, true);
    assert.equal(result.lockHealth.reason, "lock_timeout_without_active_job");
    assert.match(result.recommendations.join(" | "), /stale autonomy lock/);
});

test("manual reconcile clears stale lock and updates control state", async () => {
    const result = await runAutonomyOpsScenario({
        controlState: {
            paused: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
            activeRun: {
                runId: "stale-run",
                promptHash: "hash-stale",
                acquiredAt: "2026-04-08T00:00:00.000Z",
                state: "running",
                jobId: "job-stale",
            },
        },
        evalCode: `
            const fs = await import("node:fs");
            const path = await import("node:path");
            const { reconcileAutonomyLock } = await import("./dist/autonomy/controller.js");
            const { getAutonomyControlState } = await import("./dist/autonomy/service.js");
            const reconcile = await reconcileAutonomyLock("test", true, {
                surface: "api",
                actor: "operator-api",
                approvedBy: "reviewer-api",
                manualRecoveryNote: "Rebuild control state from queue snapshot if stale lock reappears.",
            });

            const auditDir = path.join(process.env.OUTPUT_DIR, "_system", "operator-actions");
            const latest = JSON.parse(fs.readFileSync(path.join(auditDir, "latest.json"), "utf8"));
            const historyFile = fs.readdirSync(path.join(auditDir, "history"))[0];
            const history = fs.readFileSync(path.join(auditDir, "history", historyFile), "utf8")
                .trim()
                .split("\\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line));

            console.log(JSON.stringify({
                reconcile,
                control: getAutonomyControlState(),
                latest,
                historyLength: history.length,
            }));
        `,
    });

    assert.equal(result.reconcile.cleared, true);
    assert.equal(result.reconcile.after.active, false);
    assert.equal(result.control.activeRun, undefined);
    assert.equal(result.latest.action, "reconcile_lock");
    assert.equal(result.latest.surface, "api");
    assert.equal(result.latest.actor, "operator-api");
    assert.equal(result.latest.approvedBy, "reviewer-api");
    assert.equal(result.latest.manualRecoveryNote, "Rebuild control state from queue snapshot if stale lock reappears.");
    assert.equal(result.latest.after.cleared, true);
    assert.equal(result.historyLength, 1);
});

test("mcp pause and resume write operator audit metadata", async () => {
    const result = await runAutonomyOpsScenario({
        controlState: {
            paused: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
        },
        evalCode: `
            const fs = await import("node:fs");
            const path = await import("node:path");
            const { callMcpTool } = await import("./dist/mcp/toolAdapter.js");

            await callMcpTool({
                name: "axiom.autonomy.pause",
                arguments: {
                    reason: "operator_hold",
                    actor: "mcp-operator",
                    approvedBy: "mcp-reviewer",
                    rollbackNote: "Resume only after readiness and pending approval evidence are rechecked.",
                },
            });
            await callMcpTool({
                name: "axiom.autonomy.resume",
                arguments: {
                    actor: "mcp-operator-2",
                    approvedBy: "mcp-reviewer-2",
                    manualRecoveryNote: "If resume fails, pause again and inspect outputs/_system/state.json.",
                },
            });

            const auditDir = path.join(process.env.OUTPUT_DIR, "_system", "operator-actions");
            const latest = JSON.parse(fs.readFileSync(path.join(auditDir, "latest.json"), "utf8"));
            const historyFile = fs.readdirSync(path.join(auditDir, "history"))[0];
            const history = fs.readFileSync(path.join(auditDir, "history", historyFile), "utf8")
                .trim()
                .split("\\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line));

            console.log(JSON.stringify({ latest, history }));
        `,
    });

    assert.equal(result.history.length, 2);
    assert.equal(result.history[0].action, "pause");
    assert.equal(result.history[0].surface, "mcp");
    assert.equal(result.history[0].actor, "mcp-operator");
    assert.equal(result.history[0].approvedBy, "mcp-reviewer");
    assert.equal(result.history[0].reason, "operator_hold");
    assert.equal(result.history[0].rollbackNote, "Resume only after readiness and pending approval evidence are rechecked.");
    assert.equal(result.latest.action, "resume");
    assert.equal(result.latest.surface, "mcp");
    assert.equal(result.latest.actor, "mcp-operator-2");
    assert.equal(result.latest.approvedBy, "mcp-reviewer-2");
    assert.equal(result.latest.manualRecoveryNote, "If resume fails, pause again and inspect outputs/_system/state.json.");
    assert.equal(result.latest.before.paused, true);
    assert.equal(result.latest.after.paused, false);
});

test("mcp autonomy ops tool exposes operations summary", async () => {
    const result = await runAutonomyOpsScenario({
        controlState: {
            paused: true,
            pauseReason: "operator_halt",
            updatedAt: "2026-04-10T00:00:00.000Z",
        },
        runLedger: [
            {
                runId: "run-pending",
                createdAt: "2026-04-10T03:00:00.000Z",
                promptHash: "hash-pending",
                planSignature: "form=miniature|key=none|meter=4/4|inst=piano|roles=theme_a>cadence|human=restrained",
                noveltyScore: 0.82,
                plannerTelemetry: {
                    selectionStrategy: "novelty_plus_plan_completeness_v1",
                    selectedCandidateId: "weakness_repair_with_contrast",
                    selectedCandidateLabel: "Weakness repair with contrast",
                    selectedCandidateIndex: 2,
                    candidateCount: 3,
                    parserMode: "fallback",
                    planSignature: "form=miniature|key=none|meter=4/4|inst=piano|roles=theme_a>cadence|human=restrained",
                    noveltyScore: 0.82,
                    repeatedAxes: ["instrumentation"],
                    exactMatch: false,
                    selectionScore: 0.79,
                    qualityScore: 0.73,
                },
                status: "pending_approval",
                songId: "pending-song",
                approvalStatus: "pending",
                summary: "approval queue item",
            },
        ],
        manifests: [
            {
                songId: "pending-song",
                state: "DONE",
                meta: {
                    songId: "pending-song",
                    prompt: "approval queue item",
                    form: "miniature",
                    source: "autonomy",
                    autonomyRunId: "run-pending",
                    promptHash: "hash-pending",
                    plannerTelemetry: {
                        selectionStrategy: "novelty_plus_plan_completeness_v1",
                        selectedCandidateId: "weakness_repair_with_contrast",
                        selectedCandidateLabel: "Weakness repair with contrast",
                        selectedCandidateIndex: 2,
                        candidateCount: 3,
                        parserMode: "fallback",
                        planSignature: "form=miniature|key=none|meter=4/4|inst=piano|roles=theme_a>cadence|human=restrained",
                        noveltyScore: 0.82,
                        repeatedAxes: ["instrumentation"],
                        exactMatch: false,
                        selectionScore: 0.79,
                        qualityScore: 0.73,
                    },
                    createdAt: "2026-04-10T03:00:00.000Z",
                    updatedAt: "2026-04-10T03:05:00.000Z",
                },
                artifacts: { midi: "outputs/pending-song/composition.mid" },
                structureEvaluation: {
                    passed: false,
                    score: 74,
                    issues: ["Long-span return remains weak."],
                    strengths: ["Opening identity holds."],
                    metrics: {
                        longSpanDevelopmentPressureFit: 0.62,
                        longSpanThematicTransformationFit: 0.59,
                        longSpanHarmonicTimingFit: 0.48,
                        longSpanReturnPayoffFit: 0.45,
                    },
                    longSpan: {
                        status: "collapsed",
                        weakestDimension: "return_payoff",
                        weakDimensions: ["return_payoff", "harmonic_timing"],
                        averageFit: 0.535,
                        thematicCheckpointCount: 2,
                        expectedDevelopmentPressure: "high",
                        expectedReturnPayoff: "inevitable",
                        developmentPressureFit: 0.62,
                        thematicTransformationFit: 0.59,
                        harmonicTimingFit: 0.48,
                        returnPayoffFit: 0.45,
                    },
                },
                approvalStatus: "pending",
                stateHistory: [
                    { state: "IDLE", timestamp: "2026-04-10T03:00:00.000Z" },
                    { state: "COMPOSE", timestamp: "2026-04-10T03:00:01.000Z" },
                    { state: "DONE", timestamp: "2026-04-10T03:05:00.000Z" },
                ],
                updatedAt: "2026-04-10T03:05:00.000Z",
            },
        ],
        evalCode: `
            const { callMcpTool } = await import("./dist/mcp/toolAdapter.js");
            const result = await callMcpTool({ name: "axiom.autonomy.ops", arguments: {} });
            const payload = JSON.parse(result.content[0].text);
            console.log(JSON.stringify({ isError: result.isError ?? false, payload }));
        `,
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.paused, true);
    assert.equal(result.payload.pauseReason, "operator_halt");
    assert.equal(result.payload.pendingApprovalCount, 1);
    assert.equal(result.payload.lastRun.plannerTelemetry.selectedCandidateId, "weakness_repair_with_contrast");
    assert.equal(result.payload.lastRun.plannerTelemetry.parserMode, "fallback");
    assert.equal(result.payload.pendingApprovals[0].longSpan.status, "collapsed");
    assert.equal(result.payload.pendingApprovals[0].longSpan.weakestDimension, "return_payoff");
    assert.equal(result.payload.pendingApprovals[0].plannerTelemetry.selectedCandidateId, "weakness_repair_with_contrast");
    assert.equal(result.payload.pendingApprovals[0].plannerTelemetry.parserMode, "fallback");
    assert.equal(typeof result.payload.operations.dailyCap.attemptsUsed, "number");
    assert.equal(Array.isArray(result.payload.operations.recommendations), true);
});

test("autonomy ops surfaces long-span divergence when render collapses after symbolic hold", async () => {
    const result = await runAutonomyOpsScenario({
        controlState: {
            paused: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
        },
        manifests: [
            {
                songId: "divergence-song",
                state: "DONE",
                meta: {
                    songId: "divergence-song",
                    prompt: "approval queue divergence item",
                    form: "sonata",
                    source: "autonomy",
                    autonomyRunId: "run-divergence",
                    promptHash: "hash-divergence",
                    createdAt: "2026-04-10T04:00:00.000Z",
                    updatedAt: "2026-04-10T04:05:00.000Z",
                },
                artifacts: { audio: "outputs/divergence-song/audio.wav" },
                structureEvaluation: {
                    passed: true,
                    score: 88,
                    issues: [],
                    strengths: ["Symbolic long-span form holds."],
                    longSpan: {
                        status: "held",
                        weakDimensions: [],
                        averageFit: 0.79,
                        thematicCheckpointCount: 2,
                        expectedDevelopmentPressure: "high",
                        expectedReturnPayoff: "inevitable",
                        developmentPressureFit: 0.8,
                        thematicTransformationFit: 0.78,
                        harmonicTimingFit: 0.76,
                        returnPayoffFit: 0.82,
                    },
                },
                audioEvaluation: {
                    passed: false,
                    score: 72,
                    issues: ["Rendered audio still blurs the recap landing."],
                    strengths: ["Rendered development still lifts away from the opening."],
                    longSpan: {
                        status: "collapsed",
                        weakestDimension: "tonal_return",
                        weakDimensions: ["tonal_return", "recap_recall"],
                        averageFit: 0.51,
                        developmentNarrativeFit: 0.63,
                        recapRecallFit: 0.49,
                        harmonicRouteFit: 0.56,
                        tonalReturnFit: 0.45,
                    },
                    sectionFindings: [
                        {
                            sectionId: "s4",
                            label: "Recap",
                            role: "recap",
                            sourceSectionId: "s1",
                            plannedTonality: "C major",
                            score: 0.45,
                            issues: ["Rendered pitch-class return does not settle back into the planned recap tonality."],
                            strengths: [],
                            metrics: {
                                audioSectionCompositeFit: 0.45,
                                audioRecapRecallFit: 0.49,
                                audioRecapPitchClassReturnFit: 0.43,
                                audioRecapTonalConsistencyFit: 0.39,
                            },
                        },
                    ],
                },
                approvalStatus: "pending",
                stateHistory: [
                    { state: "IDLE", timestamp: "2026-04-10T04:00:00.000Z" },
                    { state: "DONE", timestamp: "2026-04-10T04:05:00.000Z" },
                ],
                updatedAt: "2026-04-10T04:05:00.000Z",
            },
        ],
        evalCode: `
            const { callMcpTool } = await import("./dist/mcp/toolAdapter.js");
            const result = await callMcpTool({ name: "axiom.autonomy.ops", arguments: {} });
            const payload = JSON.parse(result.content[0].text);
            console.log(JSON.stringify({ isError: result.isError ?? false, payload }));
        `,
    });

    assert.equal(result.isError, false);
    assert.equal(result.payload.pendingApprovalCount, 1);
    assert.equal(result.payload.pendingApprovals[0].longSpan.status, "held");
    assert.equal(result.payload.pendingApprovals[0].longSpanDivergence.status, "render_collapsed");
    assert.equal(result.payload.pendingApprovals[0].longSpanDivergence.repairMode, "render_only");
    assert.equal(result.payload.pendingApprovals[0].longSpanDivergence.repairFocus, "tonal_return");
    assert.deepEqual(result.payload.pendingApprovals[0].longSpanDivergence.recommendedDirectives, [
        { focus: "tonal_return", kind: "rebalance_recap_release", priorityClass: "primary" },
        { focus: "recap_recall", kind: "rebalance_recap_release", priorityClass: "secondary" },
    ]);
    assert.equal(result.payload.pendingApprovals[0].longSpanDivergence.primarySectionId, "s4");
    assert.equal(result.payload.pendingApprovals[0].longSpanDivergence.sections[0].sectionId, "s4");
    assert.equal(result.payload.pendingApprovals[0].longSpanDivergence.sections[0].comparisonStatus, "audio_only");
});

test("approval feedback updates preferences summary and autonomy ops exposes recent feedback highlights", async () => {
    const result = await runAutonomyOpsScenario({
        controlState: {
            paused: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
        },
        manifests: [
            {
                songId: "approved-song",
                state: "DONE",
                meta: {
                    songId: "approved-song",
                    prompt: "veiled approval candidate",
                    form: "miniature",
                    source: "autonomy",
                    autonomyRunId: "run-approved",
                    promptHash: "hash-approved",
                    createdAt: "2026-04-10T04:00:00.000Z",
                    updatedAt: "2026-04-10T04:05:00.000Z",
                },
                artifacts: { midi: "outputs/approved-song/composition.mid" },
                approvalStatus: "pending",
                stateHistory: [
                    { state: "IDLE", timestamp: "2026-04-10T04:00:00.000Z" },
                    { state: "DONE", timestamp: "2026-04-10T04:05:00.000Z" },
                ],
                updatedAt: "2026-04-10T04:05:00.000Z",
            },
            {
                songId: "rejected-song",
                state: "DONE",
                meta: {
                    songId: "rejected-song",
                    prompt: "static rejection candidate",
                    form: "nocturne",
                    source: "autonomy",
                    autonomyRunId: "run-rejected",
                    promptHash: "hash-rejected",
                    createdAt: "2026-04-10T05:00:00.000Z",
                    updatedAt: "2026-04-10T05:05:00.000Z",
                },
                artifacts: { midi: "outputs/rejected-song/composition.mid" },
                approvalStatus: "pending",
                stateHistory: [
                    { state: "IDLE", timestamp: "2026-04-10T05:00:00.000Z" },
                    { state: "DONE", timestamp: "2026-04-10T05:05:00.000Z" },
                ],
                updatedAt: "2026-04-10T05:05:00.000Z",
            },
        ],
        runLedger: [
            {
                runId: "run-approved",
                createdAt: "2026-04-10T04:00:00.000Z",
                promptHash: "hash-approved",
                status: "pending_approval",
                songId: "approved-song",
                approvalStatus: "pending",
                summary: "approval candidate",
            },
            {
                runId: "run-rejected",
                createdAt: "2026-04-10T05:00:00.000Z",
                promptHash: "hash-rejected",
                status: "pending_approval",
                songId: "rejected-song",
                approvalStatus: "pending",
                summary: "rejection candidate",
            },
        ],
        evalCode: `
            const fs = await import("node:fs");
            const path = await import("node:path");
            const { approveAutonomySong, rejectAutonomySong, getAutonomyStatus } = await import("./dist/autonomy/service.js");
            const { loadAutonomyPreferences } = await import("./dist/memory/manifest.js");
            const { callMcpTool } = await import("./dist/mcp/toolAdapter.js");

            approveAutonomySong("approved-song", {
                note: "Strong cadence close with a convincing return.",
                appealScore: 8,
                strongestDimension: "cadence clarity",
                weakestDimension: "middle-voice independence",
                comparisonReference: "run-42",
            }, {
                surface: "api",
                actor: "reviewer-approve",
                approvedBy: "lead-approve",
                rollbackNote: "If later evidence contradicts approval, reject the same songId and capture new review notes.",
            });
            rejectAutonomySong("rejected-song", {
                note: "Too static against the previous nocturne.",
                appealScore: 3,
                strongestDimension: "opening color",
                weakestDimension: "development contrast",
                comparisonReference: "nocturne-2026-04-10",
            }, {
                surface: "api",
                actor: "reviewer-reject",
                approvedBy: "lead-reject",
                manualRecoveryNote: "Revise contrast and reopen approval after a new render pass.",
            });

            const status = await getAutonomyStatus();
            const preferences = loadAutonomyPreferences();
            const opsResult = await callMcpTool({ name: "axiom.autonomy.ops", arguments: {} });
            const opsPayload = JSON.parse(opsResult.content[0].text);
            const auditDir = path.join(process.env.OUTPUT_DIR, "_system", "operator-actions");
            const latest = JSON.parse(fs.readFileSync(path.join(auditDir, "latest.json"), "utf8"));
            const historyFile = fs.readdirSync(path.join(auditDir, "history"))[0];
            const auditHistory = fs.readFileSync(path.join(auditDir, "history", historyFile), "utf8")
                .trim()
                .split("\\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line));

            console.log(JSON.stringify({
                humanFeedbackSummary: preferences.humanFeedbackSummary,
                feedbackHighlights: status.feedbackHighlights,
                opsFeedbackHighlights: opsPayload.feedbackHighlights,
                latestAudit: latest,
                auditHistory,
            }));
        `,
    });

    assert.equal(result.humanFeedbackSummary.approvedCount, 1);
    assert.equal(result.humanFeedbackSummary.rejectedCount, 1);
    assert.equal(result.humanFeedbackSummary.scoredFeedbackCount, 2);
    assert.ok(result.humanFeedbackSummary.positiveDimensions.includes("cadence clarity"));
    assert.ok(result.humanFeedbackSummary.positiveDimensions.includes("opening color"));
    assert.ok(result.humanFeedbackSummary.negativeDimensions.includes("middle-voice independence"));
    assert.ok(result.humanFeedbackSummary.negativeDimensions.includes("development contrast"));
    assert.ok(result.humanFeedbackSummary.rejectionReasons.includes("Too static against the previous nocturne."));
    assert.ok(result.humanFeedbackSummary.comparisonReferences.includes("run-42"));
    assert.ok(result.humanFeedbackSummary.comparisonReferences.includes("nocturne-2026-04-10"));

    assert.deepEqual(result.feedbackHighlights.positiveFactors, result.humanFeedbackSummary.positiveDimensions);
    assert.deepEqual(result.feedbackHighlights.negativeFactors, result.humanFeedbackSummary.negativeDimensions);
    assert.deepEqual(result.opsFeedbackHighlights, result.feedbackHighlights);
    assert.deepEqual(result.auditHistory.map((entry) => entry.action), ["approve", "reject"]);
    assert.equal(result.auditHistory[0].actor, "reviewer-approve");
    assert.equal(result.auditHistory[0].approvedBy, "lead-approve");
    assert.equal(result.auditHistory[0].rollbackNote, "If later evidence contradicts approval, reject the same songId and capture new review notes.");
    assert.equal(result.auditHistory[1].actor, "reviewer-reject");
    assert.equal(result.auditHistory[1].manualRecoveryNote, "Revise contrast and reopen approval after a new render pass.");
    assert.equal(result.latestAudit.action, "reject");
    assert.ok(result.latestAudit.artifactLinks.includes("outputs/_system/preferences.json"));
});