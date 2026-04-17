import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeEval, parseLastJsonLine } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function collectArraySchemaIssues(schema, pathLabel) {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return [];
    }

    const issues = [];
    if (schema.type === "array") {
        if (!schema.items || typeof schema.items !== "object" || Array.isArray(schema.items)) {
            issues.push(`${pathLabel} is array without items`);
            return issues;
        }
        issues.push(...collectArraySchemaIssues(schema.items, `${pathLabel}.items`));
    }

    if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
        for (const [key, value] of Object.entries(schema.properties)) {
            issues.push(...collectArraySchemaIssues(value, `${pathLabel}.properties.${key}`));
        }
    }

    return issues;
}

function collectRawArrayPaths(schema, pathLabel) {
    if (Array.isArray(schema)) {
        return [pathLabel];
    }

    if (!schema || typeof schema !== "object") {
        return [];
    }

    const issues = [];
    for (const [key, value] of Object.entries(schema)) {
        issues.push(...collectRawArrayPaths(value, `${pathLabel}.${key}`));
    }
    return issues;
}

function createTempRuntimeRoot(prefix) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    return { tempRoot, outputDir, logDir };
}

function seedShadowRerankerEvidence(outputDir, overrides = {}) {
    const songId = overrides.songId || "pending-song";
    const updatedAt = overrides.updatedAt || "2026-04-10T03:05:30.000Z";
    const snapshotId = overrides.snapshotId || "shadow-live";
    const selectedCandidateId = overrides.selectedCandidateId || "structure-a2-selected";
    const learnedTopCandidateId = overrides.learnedTopCandidateId || "structure-a1-learned";
    const learnedConfidence = overrides.learnedConfidence ?? 0.81;
    const promotionApplied = overrides.promotionApplied ?? false;
    const promotionLane = overrides.promotionLane || "string_trio_symbolic";
    const reason = overrides.reason || "learned favored sectionArtifactCoverage, phraseBreathCueDensity";
    const selectionStopReason = overrides.selectionStopReason
        || `structure evaluation accepted the symbolic draft; hybrid candidate pool kept music21 over learned_symbolic in ${promotionLane} lane on heuristic structure score (88.0 vs 84.0)${promotionApplied ? `; learned reranker promoted attempt 1 over heuristic attempt 2 in ${promotionLane} lane (snapshot=${snapshotId}; confidence=${learnedConfidence.toFixed(3)})` : ""}`;
    const selectedCandidateDir = path.join(outputDir, songId, "candidates", selectedCandidateId);
    const learnedCandidateDir = path.join(outputDir, songId, "candidates", learnedTopCandidateId);
    const selectedManifestPath = path.join(selectedCandidateDir, "candidate-manifest.json");
    const selectedScorePath = path.join(selectedCandidateDir, "reranker-score.json");
    const learnedManifestPath = path.join(learnedCandidateDir, "candidate-manifest.json");

    fs.mkdirSync(selectedCandidateDir, { recursive: true });
    fs.mkdirSync(learnedCandidateDir, { recursive: true });

    const selectedShadowSummary = {
        snapshotId,
        evaluatedAt: updatedAt,
        heuristicRank: 1,
        heuristicScore: 0.91,
        learnedRank: 2,
        learnedScore: 0.82,
        learnedConfidence,
        disagreesWithHeuristic: true,
        disagreementReason: reason,
    };
    const learnedShadowSummary = {
        snapshotId,
        evaluatedAt: updatedAt,
        heuristicRank: 2,
        heuristicScore: 0.84,
        learnedRank: 1,
        learnedScore: 0.9,
        learnedConfidence,
        disagreesWithHeuristic: true,
        disagreementReason: reason,
    };

    fs.writeFileSync(selectedManifestPath, JSON.stringify({
        version: 1,
        stage: "structure",
        songId,
        candidateId: selectedCandidateId,
        attempt: 2,
        selected: true,
        selectedAt: updatedAt,
        evaluatedAt: updatedAt,
        workflow: "symbolic_only",
        worker: "music21",
        provider: "python",
        model: "music21-symbolic-v1",
        meta: { songId },
        executionPlan: {
            workflow: "symbolic_only",
            composeWorker: "music21",
            selectedModels: [
                { role: "structure", provider: "python", model: "music21-symbolic-v1" },
            ],
        },
        revisionDirectives: [],
        structureEvaluation: {
            passed: true,
            score: 88,
            issues: [],
            strengths: [],
            metrics: {},
        },
        proposalEvidence: {
            worker: "music21",
            lane: promotionLane,
            provider: "python",
            model: "music21-symbolic-v1",
        },
        shadowReranker: selectedShadowSummary,
        ...(promotionApplied
            ? {
                rerankerPromotion: {
                    appliedAt: updatedAt,
                    lane: promotionLane,
                    snapshotId,
                    confidence: learnedConfidence,
                    heuristicTopCandidateId: selectedCandidateId,
                    learnedTopCandidateId,
                    heuristicAttempt: 2,
                    learnedAttempt: 1,
                    reason,
                },
            }
            : {}),
        artifacts: {},
    }, null, 2));
    fs.writeFileSync(learnedManifestPath, JSON.stringify({
        version: 1,
        stage: "structure",
        songId,
        candidateId: learnedTopCandidateId,
        attempt: 1,
        selected: false,
        evaluatedAt: updatedAt,
        workflow: "symbolic_only",
        worker: "learned_symbolic",
        provider: "learned",
        model: "learned-symbolic-trio-v1",
        meta: { songId },
        executionPlan: {
            workflow: "symbolic_only",
            composeWorker: "learned_symbolic",
            selectedModels: [
                { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
            ],
        },
        revisionDirectives: [],
        structureEvaluation: {
            passed: true,
            score: 84,
            issues: [],
            strengths: [],
            metrics: {},
        },
        proposalEvidence: {
            worker: "learned_symbolic",
            lane: promotionLane,
            provider: "learned",
            model: "learned-symbolic-trio-v1",
            confidence: learnedConfidence,
        },
        shadowReranker: learnedShadowSummary,
        artifacts: {},
    }, null, 2));
    fs.writeFileSync(selectedScorePath, JSON.stringify({
        version: 1,
        type: "structure_shadow_reranker",
        songId,
        candidateId: selectedCandidateId,
        evaluatedAt: updatedAt,
        scorer: {
            snapshotId,
            modelPath: `outputs/_system/ml/evaluations/structure-rank-v1/${snapshotId}/shadow-reranker-model.json`,
            calibratedTemperature: 1,
            featureCount: 6,
        },
        heuristic: {
            score: 0.91,
            rank: 1,
            topCandidateId: selectedCandidateId,
            topMargin: 0.03,
        },
        learned: {
            score: 0.82,
            rank: 2,
            topCandidateId: learnedTopCandidateId,
            topMargin: 0.08,
            confidence: learnedConfidence,
        },
        disagreement: {
            disagrees: true,
            heuristicTopCandidateId: selectedCandidateId,
            learnedTopCandidateId,
            reason,
        },
    }, null, 2));
    fs.writeFileSync(path.join(outputDir, songId, "candidates", "index.json"), JSON.stringify({
        version: 1,
        songId,
        updatedAt,
        selectedCandidateId,
        selectedAttempt: 2,
        selectionStopReason,
        ...(promotionApplied
            ? {
                rerankerPromotion: {
                    appliedAt: updatedAt,
                    lane: promotionLane,
                    snapshotId,
                    confidence: learnedConfidence,
                    heuristicTopCandidateId: selectedCandidateId,
                    learnedTopCandidateId,
                    heuristicAttempt: 2,
                    learnedAttempt: 1,
                    reason,
                },
            }
            : {}),
        entries: [
            {
                candidateId: learnedTopCandidateId,
                attempt: 1,
                stage: "structure",
                selected: false,
                workflow: "symbolic_only",
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                passed: true,
                score: 84,
                evaluatedAt: updatedAt,
                manifestPath: learnedManifestPath,
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: promotionLane,
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    confidence: learnedConfidence,
                },
                shadowReranker: learnedShadowSummary,
            },
            {
                candidateId: selectedCandidateId,
                attempt: 2,
                stage: "structure",
                selected: true,
                workflow: "symbolic_only",
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                passed: true,
                score: 88,
                evaluatedAt: updatedAt,
                manifestPath: selectedManifestPath,
                rerankerScorePath: selectedScorePath,
                proposalEvidence: {
                    worker: "music21",
                    lane: promotionLane,
                    provider: "python",
                    model: "music21-symbolic-v1",
                },
                shadowReranker: selectedShadowSummary,
            },
        ],
    }, null, 2));
}

function seedShadowRerankerRuntimeHistory(outputDir, overrides = {}) {
    const songId = overrides.songId || "pending-song";
    const generatedAt = overrides.generatedAt || new Date().toISOString();
    const snapshotId = overrides.snapshotId || "shadow-live";
    const selectedCandidateId = overrides.selectedCandidateId || "structure-a2-selected";
    const learnedTopCandidateId = overrides.learnedTopCandidateId || "structure-a1-learned";
    const learnedConfidence = overrides.learnedConfidence ?? 0.81;
    const disagreement = overrides.disagreement ?? true;
    const reason = overrides.reason || "learned favored sectionArtifactCoverage, phraseBreathCueDensity";
    const historyDir = path.join(outputDir, "_system", "ml", "runtime", "structure-rank-v1-shadow-history");
    const historyPath = path.join(historyDir, `${generatedAt.slice(0, 10)}.jsonl`);

    fs.mkdirSync(historyDir, { recursive: true });
    fs.appendFileSync(historyPath, JSON.stringify({
        kind: "structure_shadow",
        generatedAt,
        songId,
        snapshotId,
        candidateCount: 2,
        selectedCandidateId,
        heuristicTopCandidateId: selectedCandidateId,
        learnedTopCandidateId,
        confidence: learnedConfidence,
        disagreement,
        reason,
        scorePaths: [path.join(outputDir, songId, "candidates", selectedCandidateId, "reranker-score.json")],
    }) + "\n", "utf-8");
}

test("mcp health is public and exposes readiness, queue, and operator artifacts", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-mcp-health-");

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import express from "express";
            import mcpRouter from "./dist/routes/mcp.js";

            const outputDir = process.env.OUTPUT_DIR;
            const summaryDir = path.join(outputDir, "_system", "operator-summary");
            const sweepDir = path.join(outputDir, "_system", "operator-sweep");
            const incidentDir = path.join(sweepDir, "incident-drafts");
            const pickupDir = path.join(outputDir, "_system", "operator-pickup");
            fs.mkdirSync(summaryDir, { recursive: true });
            fs.mkdirSync(incidentDir, { recursive: true });
            fs.mkdirSync(pickupDir, { recursive: true });
            fs.writeFileSync(path.join(summaryDir, "latest.json"), JSON.stringify({
                observedAt: "2026-04-13T12:00:00.000Z",
                summary: "summary ready",
                triage: { state: "runtime_degraded", severity: "SEV-3" },
                overseer: {
                    phraseBreathTrend: {
                        manifestCount: 2,
                        averagePlanFit: 0.48,
                        averageCoverageFit: 0.5,
                        averageArrivalFit: 0.34,
                        averageReleaseFit: 0.38,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                    },
                    harmonicColorTrend: {
                        manifestCount: 2,
                        averagePlanFit: 0.46,
                        averageCoverageFit: 0.49,
                        averageTargetFit: 0.41,
                        averageTimingFit: 0.43,
                        averageTonicizationPressureFit: 0.4,
                        averageProlongationMotionFit: 0.45,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                    },
                    shadowReranker: {
                        manifestCount: 2,
                        scoredManifestCount: 2,
                        disagreementCount: 1,
                        highConfidenceDisagreementCount: 1,
                        agreementRate: 0.5,
                        averageLearnedConfidence: 0.76,
                        latestSnapshotId: "shadow-live",
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                        recentDisagreements: [{
                            songId: "pending-song",
                            updatedAt: "2026-04-13T11:58:00.000Z",
                            selectedCandidateId: "structure-a2-selected",
                            learnedTopCandidateId: "structure-a1-learned",
                            learnedConfidence: 0.81,
                            snapshotId: "shadow-live",
                            reason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                        }],
                    },
                    orchestrationTrends: [
                        {
                            family: "string_trio",
                            manifestCount: 2,
                            averageRegisterBalanceFit: 0.81,
                            weakManifestCount: 1,
                            lastSeenAt: "2026-04-13T11:58:00.000Z",
                        },
                    ],
                },
            }));
            fs.writeFileSync(path.join(sweepDir, "latest.json"), JSON.stringify({
                observedAt: "2026-04-13T12:05:00.000Z",
                summary: "sweep ready",
                triage: { state: "incident_candidate", severity: "SEV-2" },
                projection: {
                    latest: {
                        overseer: {
                            phraseBreathTrend: {
                                manifestCount: 2,
                                averagePlanFit: 0.48,
                                averageCoverageFit: 0.5,
                                averageArrivalFit: 0.34,
                                averageReleaseFit: 0.38,
                                weakManifestCount: 1,
                                lastSeenAt: "2026-04-13T11:58:00.000Z",
                            },
                            harmonicColorTrend: {
                                manifestCount: 2,
                                averagePlanFit: 0.46,
                                averageCoverageFit: 0.49,
                                averageTargetFit: 0.41,
                                averageTimingFit: 0.43,
                                averageTonicizationPressureFit: 0.4,
                                averageProlongationMotionFit: 0.45,
                                weakManifestCount: 1,
                                lastSeenAt: "2026-04-13T11:58:00.000Z",
                            },
                            shadowReranker: {
                                manifestCount: 2,
                                scoredManifestCount: 2,
                                disagreementCount: 1,
                                highConfidenceDisagreementCount: 1,
                                agreementRate: 0.5,
                                averageLearnedConfidence: 0.76,
                                latestSnapshotId: "shadow-live",
                                lastSeenAt: "2026-04-13T11:58:00.000Z",
                                recentDisagreements: [{
                                    songId: "pending-song",
                                    updatedAt: "2026-04-13T11:58:00.000Z",
                                    selectedCandidateId: "structure-a2-selected",
                                    learnedTopCandidateId: "structure-a1-learned",
                                    learnedConfidence: 0.81,
                                    snapshotId: "shadow-live",
                                    reason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                                }],
                            },
                            orchestrationTrends: [
                                {
                                    family: "string_trio",
                                    manifestCount: 2,
                                    averageRegisterBalanceFit: 0.81,
                                    weakManifestCount: 1,
                                    lastSeenAt: "2026-04-13T11:58:00.000Z",
                                },
                            ],
                        },
                    },
                },
            }));
            fs.writeFileSync(path.join(incidentDir, "latest.json"), JSON.stringify({
                observedAt: "2026-04-13T12:06:00.000Z",
                incidentId: "axiom-health-incident",
                state: "candidate",
                severity: "SEV-2",
                phraseBreathTrend: {
                    manifestCount: 2,
                    averagePlanFit: 0.48,
                    averageCoverageFit: 0.5,
                    averageArrivalFit: 0.34,
                    averageReleaseFit: 0.38,
                    weakManifestCount: 1,
                    lastSeenAt: "2026-04-13T11:58:00.000Z",
                },
                harmonicColorTrend: {
                    manifestCount: 2,
                    averagePlanFit: 0.46,
                    averageCoverageFit: 0.49,
                    averageTargetFit: 0.41,
                    averageTimingFit: 0.43,
                    averageTonicizationPressureFit: 0.4,
                    averageProlongationMotionFit: 0.45,
                    weakManifestCount: 1,
                    lastSeenAt: "2026-04-13T11:58:00.000Z",
                },
                shadowReranker: {
                    manifestCount: 2,
                    scoredManifestCount: 2,
                    disagreementCount: 1,
                    highConfidenceDisagreementCount: 1,
                    agreementRate: 0.5,
                    averageLearnedConfidence: 0.76,
                    latestSnapshotId: "shadow-live",
                    lastSeenAt: "2026-04-13T11:58:00.000Z",
                    recentDisagreements: [{
                        songId: "pending-song",
                        updatedAt: "2026-04-13T11:58:00.000Z",
                        selectedCandidateId: "structure-a2-selected",
                        learnedTopCandidateId: "structure-a1-learned",
                        learnedConfidence: 0.81,
                        snapshotId: "shadow-live",
                        reason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                    }],
                },
                orchestrationTrends: [
                    {
                        family: "string_trio",
                        manifestCount: 2,
                        averageRegisterBalanceFit: 0.81,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                    },
                ],
            }));
            fs.writeFileSync(path.join(pickupDir, "latest.json"), JSON.stringify({
                observedAt: "2026-04-13T12:07:00.000Z",
                status: "ok",
                summary: "pickup ready",
                overseer: {
                    phraseBreathTrend: {
                        manifestCount: 2,
                        averagePlanFit: 0.48,
                        averageCoverageFit: 0.5,
                        averageArrivalFit: 0.34,
                        averageReleaseFit: 0.38,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                    },
                    harmonicColorTrend: {
                        manifestCount: 2,
                        averagePlanFit: 0.46,
                        averageCoverageFit: 0.49,
                        averageTargetFit: 0.41,
                        averageTimingFit: 0.43,
                        averageTonicizationPressureFit: 0.4,
                        averageProlongationMotionFit: 0.45,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                    },
                    shadowReranker: {
                        manifestCount: 2,
                        scoredManifestCount: 2,
                        disagreementCount: 1,
                        highConfidenceDisagreementCount: 1,
                        agreementRate: 0.5,
                        averageLearnedConfidence: 0.76,
                        latestSnapshotId: "shadow-live",
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                        recentDisagreements: [{
                            songId: "pending-song",
                            updatedAt: "2026-04-13T11:58:00.000Z",
                            selectedCandidateId: "structure-a2-selected",
                            learnedTopCandidateId: "structure-a1-learned",
                            learnedConfidence: 0.81,
                            snapshotId: "shadow-live",
                            reason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                        }],
                    },
                    orchestrationTrends: [
                        {
                            family: "string_trio",
                            manifestCount: 2,
                            averageRegisterBalanceFit: 0.81,
                            weakManifestCount: 1,
                            lastSeenAt: "2026-04-13T11:58:00.000Z",
                        },
                    ],
                },
                incidentDraft: {
                    present: true,
                    phraseBreathTrend: {
                        manifestCount: 2,
                        averagePlanFit: 0.48,
                        averageCoverageFit: 0.5,
                        averageArrivalFit: 0.34,
                        averageReleaseFit: 0.38,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                    },
                    harmonicColorTrend: {
                        manifestCount: 2,
                        averagePlanFit: 0.46,
                        averageCoverageFit: 0.49,
                        averageTargetFit: 0.41,
                        averageTimingFit: 0.43,
                        averageTonicizationPressureFit: 0.4,
                        averageProlongationMotionFit: 0.45,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                    },
                    shadowReranker: {
                        manifestCount: 2,
                        scoredManifestCount: 2,
                        disagreementCount: 1,
                        highConfidenceDisagreementCount: 1,
                        agreementRate: 0.5,
                        averageLearnedConfidence: 0.76,
                        latestSnapshotId: "shadow-live",
                        lastSeenAt: "2026-04-13T11:58:00.000Z",
                        recentDisagreements: [{
                            songId: "pending-song",
                            updatedAt: "2026-04-13T11:58:00.000Z",
                            selectedCandidateId: "structure-a2-selected",
                            learnedTopCandidateId: "structure-a1-learned",
                            learnedConfidence: 0.81,
                            snapshotId: "shadow-live",
                            reason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                        }],
                    },
                    orchestrationTrends: [
                        {
                            family: "string_trio",
                            manifestCount: 2,
                            averageRegisterBalanceFit: 0.81,
                            weakManifestCount: 1,
                            lastSeenAt: "2026-04-13T11:58:00.000Z",
                        },
                    ],
                },
            }));

            const app = express();
            app.use(express.json());
            app.use(mcpRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const response = await fetch("http://127.0.0.1:" + address.port + "/mcp/health");
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
                MCP_WORKER_AUTH_TOKEN: "axiom-http-token",
                PYTHON_BIN: "missing-python-for-ready-check",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.statusCode, 200);
        assert.equal(result.payload.status, "ok");
        assert.equal(result.payload.protocolVersion, "2026-03-01");
        assert.equal(result.payload.auth.required, true);
        assert.equal(result.payload.auth.tokenConfigured, true);
        assert.equal(result.payload.readiness.status, "not_ready");
        assert.equal(result.payload.queue.total, 0);
        assert.equal(result.payload.toolNames.includes("axiom_compose"), true);
        assert.equal(result.payload.toolNames.includes("axiom_operator_summary"), true);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.present, true);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.phraseBreathTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.phraseBreathTrend.pressured, true);
        assert.match(result.payload.operatorArtifacts.operatorSummary.phraseBreathTrend.advisory ?? "", /phrase-breath pressure detected/);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.harmonicColorTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.harmonicColorTrend.pressured, true);
        assert.match(result.payload.operatorArtifacts.operatorSummary.harmonicColorTrend.advisory ?? "", /harmonic-color pressure detected/);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.shadowReranker.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.shadowReranker.pressured, true);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.shadowReranker.highConfidenceDisagreementCount, 1);
        assert.match(result.payload.operatorArtifacts.operatorSummary.shadowReranker.advisory ?? "", /high-confidence disagreement pressure/);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.orchestrationTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorSummary.orchestrationTrend.family, "trio");
        assert.equal(result.payload.operatorArtifacts.operatorSummary.orchestrationTrend.pressured, true);
        assert.match(result.payload.operatorArtifacts.operatorSummary.orchestrationTrend.advisory ?? "", /before treating timbre as the root issue/);
        assert.equal(result.payload.operatorArtifacts.operatorSweep.present, true);
        assert.equal(result.payload.operatorArtifacts.operatorSweep.status, "incident_candidate");
        assert.equal(result.payload.operatorArtifacts.operatorSweep.phraseBreathTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorSweep.phraseBreathTrend.weakManifestCount, 1);
        assert.equal(result.payload.operatorArtifacts.operatorSweep.harmonicColorTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorSweep.harmonicColorTrend.weakManifestCount, 1);
        assert.equal(result.payload.operatorArtifacts.operatorSweep.shadowReranker.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorSweep.shadowReranker.disagreementCount, 1);
        assert.equal(result.payload.operatorArtifacts.operatorSweep.orchestrationTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorSweep.orchestrationTrend.weakManifestCount, 1);
        assert.match(result.payload.operatorArtifacts.operatorSweep.orchestrationTrend.advisory ?? "", /trio ensemble pressure detected/);
        assert.equal(result.payload.operatorArtifacts.incidentDraft.present, true);
        assert.equal(result.payload.operatorArtifacts.incidentDraft.phraseBreathTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.incidentDraft.harmonicColorTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.incidentDraft.harmonicColorTrend.pressured, true);
        assert.equal(result.payload.operatorArtifacts.incidentDraft.shadowReranker.available, true);
        assert.equal(result.payload.operatorArtifacts.incidentDraft.orchestrationTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.incidentDraft.orchestrationTrend.lastSeenAt, "2026-04-13T11:58:00.000Z");
        assert.equal(result.payload.operatorArtifacts.operatorPickup.present, true);
        assert.equal(result.payload.operatorArtifacts.operatorPickup.status, "ok");
        assert.equal(result.payload.operatorArtifacts.operatorPickup.phraseBreathTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorPickup.harmonicColorTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorPickup.harmonicColorTrend.pressured, true);
        assert.equal(result.payload.operatorArtifacts.operatorPickup.shadowReranker.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorPickup.shadowReranker.scoredManifestCount, 2);
        assert.equal(result.payload.operatorArtifacts.operatorPickup.orchestrationTrend.available, true);
        assert.equal(result.payload.operatorArtifacts.operatorPickup.orchestrationTrend.family, "trio");
        assert.match(result.payload.operatorArtifacts.operatorPickup.orchestrationTrend.advisory ?? "", /trio ensemble pressure detected/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("mcp HTTP rpc rejects unauthenticated requests when token is configured", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-mcp-http-auth-");

    try {
        const { stdout } = await runNodeEval(`
            import express from "express";
            import mcpRouter from "./dist/routes/mcp.js";

            const app = express();
            app.use(express.json());
            app.use(mcpRouter);
            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const response = await fetch("http://127.0.0.1:" + address.port + "/mcp/rpc", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
                    });
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
                MCP_WORKER_AUTH_TOKEN: "axiom-http-token",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.statusCode, 401);
        assert.equal(result.payload.error, "UNAUTHORIZED");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("mcp tool schemas define items for every array node", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-mcp-schema-");

    try {
        const { stdout } = await runNodeEval(`
            import { listMcpTools } from "./dist/mcp/toolAdapter.js";
            console.log(JSON.stringify(listMcpTools()));
        `, {
            cwd: repoRoot,
            env: {
                OUTPUT_DIR: outputDir,
                LOG_DIR: logDir,
                LOG_LEVEL: "error",
                MAX_RETRIES: "0",
                RETRY_BACKOFF_MS: "0",
                PYTHON_BIN: "missing-python-for-compose-test",
            },
        });

        const tools = parseLastJsonLine(stdout);
        assert.equal(Array.isArray(tools), true);

        const issues = tools.flatMap((tool) => collectArraySchemaIssues(tool.inputSchema, `${tool.name}.inputSchema`));
        assert.deepEqual(issues, []);

        const rawArrayPaths = tools.flatMap((tool) => collectRawArrayPaths(tool.inputSchema, `${tool.name}.inputSchema`));
        assert.deepEqual(rawArrayPaths, []);

        const composeTool = tools.find((tool) => tool.name === "axiom_compose");
        assert.equal(composeTool?.inputSchema?.properties?.prompt?.description?.startsWith("필수."), true);
        assert.equal(composeTool?.inputSchema?.properties?.selectedModels?.type, "string");
        assert.match(composeTool?.inputSchema?.properties?.selectedModels?.description ?? "", /JSON array/i);
        assert.equal(composeTool?.inputSchema?.properties?.targetInstrumentation?.type, "string");
        assert.match(composeTool?.inputSchema?.properties?.targetInstrumentation?.description ?? "", /comma-separated string/i);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("mcp compose accepts JSON-string structured inputs for model bindings and instrumentation", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-mcp-compose-json-");

    try {
        const { stdout } = await runNodeEval(`
            import { callMcpTool } from "./dist/mcp/toolAdapter.js";

            const result = await callMcpTool({
                name: "axiom.compose",
                arguments: {
                    prompt: "string-driven chamber prelude",
                    selectedModels: JSON.stringify([
                        { role: "planner", provider: "ollama", model: "gemma3" },
                    ]),
                    targetInstrumentation: JSON.stringify([
                        { name: "piano", family: "keyboard", roles: "lead, pad", register: "wide" },
                    ]),
                },
            });

            console.log(JSON.stringify({
                isError: result.isError ?? false,
                payload: JSON.parse(result.content[0].text),
            }));
        `, {
            cwd: repoRoot,
            env: {
                OUTPUT_DIR: outputDir,
                LOG_DIR: logDir,
                LOG_LEVEL: "error",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.isError, false);
        assert.equal(result.payload.request.selectedModels.length, 1);
        assert.equal(result.payload.request.selectedModels[0].role, "planner");
        assert.equal(result.payload.request.targetInstrumentation.length, 1);
        assert.deepEqual(result.payload.request.targetInstrumentation[0].roles, ["lead", "pad"]);
        assert.equal(result.payload.request.targetInstrumentation[0].register, "wide");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("mcp operator summary tool is exposed and returns canonical operator summary", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-mcp-operator-summary-");

    try {
        seedShadowRerankerEvidence(outputDir, { songId: "pending-song", promotionApplied: true });
        seedShadowRerankerRuntimeHistory(outputDir, { songId: "pending-song" });
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import { enqueue } from "./dist/queue/jobQueue.js";
            import { callMcpTool, listMcpTools } from "./dist/mcp/toolAdapter.js";

            const outputDir = process.env.OUTPUT_DIR;
            const songId = "pending-song";
            const manifestDir = path.join(outputDir, songId);
            const incidentDir = path.join(outputDir, "_system", "operator-sweep", "incident-drafts");
            const operatorActionsDir = path.join(outputDir, "_system", "operator-actions");
            const pickupDir = path.join(outputDir, "_system", "operator-pickup");
            fs.mkdirSync(manifestDir, { recursive: true });
            fs.mkdirSync(incidentDir, { recursive: true });
            fs.mkdirSync(operatorActionsDir, { recursive: true });
            fs.mkdirSync(pickupDir, { recursive: true });
            const manifest = {
                songId,
                state: "DONE",
                meta: {
                    songId,
                    prompt: "approval queue item",
                    form: "miniature",
                    source: "autonomy",
                    autonomyRunId: "run-pending",
                    promptHash: "hash-pending",
                    createdAt: "2026-04-10T03:00:00.000Z",
                    updatedAt: "2026-04-10T03:05:00.000Z",
                },
                artifacts: { midi: "outputs/" + songId + "/composition.mid" },
                approvalStatus: "pending",
                selfAssessment: { qualityScore: 0.84 },
                structureEvaluation: {
                    passed: false,
                    score: 76,
                    issues: ["Long-span return remains weak."],
                    strengths: ["Opening identity holds."],
                    orchestration: {
                        family: "string_trio",
                        instrumentNames: ["violin", "viola", "cello"],
                        sectionCount: 3,
                        conversationalSectionCount: 1,
                        idiomaticRangeFit: 0.91,
                        registerBalanceFit: 0.88,
                        ensembleConversationFit: 0.84,
                        doublingPressureFit: 0.79,
                        textureRotationFit: 0.74,
                        weakSectionIds: ["s1"],
                    },
                    metrics: {
                        longSpanDevelopmentPressureFit: 0.61,
                        longSpanThematicTransformationFit: 0.58,
                        longSpanHarmonicTimingFit: 0.46,
                        longSpanReturnPayoffFit: 0.44,
                    },
                    longSpan: {
                        status: "collapsed",
                        weakestDimension: "return_payoff",
                        weakDimensions: ["return_payoff", "harmonic_timing"],
                        averageFit: 0.5225,
                        thematicCheckpointCount: 2,
                        expectedDevelopmentPressure: "high",
                        expectedReturnPayoff: "inevitable",
                        developmentPressureFit: 0.61,
                        thematicTransformationFit: 0.58,
                        harmonicTimingFit: 0.46,
                        returnPayoffFit: 0.44,
                    },
                },
                audioEvaluation: {
                    passed: false,
                    score: 68,
                    issues: ["Rendered audio still blurs the recap landing."],
                    strengths: ["Rendered audio still keeps some development lift."],
                    metrics: {
                        audioDevelopmentNarrativeFit: 0.52,
                        audioRecapRecallFit: 0.49,
                        audioHarmonicRouteRenderFit: 0.54,
                        audioTonalReturnRenderFit: 0.47,
                        audioPhraseBreathPlanFit: 0.48,
                        audioPhraseBreathCoverageFit: 0.5,
                        audioPhraseBreathPickupFit: 0.44,
                        audioPhraseBreathArrivalFit: 0.34,
                        audioPhraseBreathReleaseFit: 0.38,
                        harmonicColorPlanFit: 0.48,
                        harmonicColorCoverageFit: 0.5,
                        harmonicColorTargetFit: 0.42,
                        harmonicColorTimingFit: 0.44,
                        tonicizationPressureFit: 0.41,
                        prolongationMotionFit: 0.45,
                    },
                    longSpan: {
                        status: "collapsed",
                        weakestDimension: "tonal_return",
                        weakDimensions: ["tonal_return", "recap_recall", "development_narrative", "harmonic_route"],
                        averageFit: 0.505,
                        developmentNarrativeFit: 0.52,
                        recapRecallFit: 0.49,
                        harmonicRouteFit: 0.54,
                        tonalReturnFit: 0.47,
                    },
                },
                updatedAt: "2026-04-10T03:05:00.000Z",
            };
            fs.writeFileSync(path.join(manifestDir, "manifest.json"), JSON.stringify(manifest, null, 2));
            fs.writeFileSync(path.join(incidentDir, "latest.json"), JSON.stringify({
                incidentId: "axiom-2026-04-10-incident-candidate",
                observedAt: "2026-04-10T03:06:00.000Z",
                severity: "SEV-1",
                severityScore: 10,
                severityDrivers: [
                    { code: "readiness_not_ready", weight: 4, detail: "status=not_ready", source: "runtime" },
                ],
                state: "incident_candidate",
                status: "Investigating",
                recommendedLane: "incident",
                scope: "runtime",
                summary: "AXIOM incident draft for operator handoff",
                reasonCodes: ["readiness_not_ready"],
                recommendations: ["Inspect runtime readiness"],
                phraseBreathTrend: {
                    manifestCount: 1,
                    averagePlanFit: 0.48,
                    averageCoverageFit: 0.5,
                    averageArrivalFit: 0.34,
                    averageReleaseFit: 0.38,
                    weakManifestCount: 1,
                    lastSeenAt: "2026-04-10T03:05:00.000Z",
                },
                harmonicColorTrend: {
                    manifestCount: 1,
                    averagePlanFit: 0.48,
                    averageCoverageFit: 0.5,
                    averageTargetFit: 0.42,
                    averageTimingFit: 0.44,
                    averageTonicizationPressureFit: 0.41,
                    averageProlongationMotionFit: 0.45,
                    weakManifestCount: 1,
                    lastSeenAt: "2026-04-10T03:05:00.000Z",
                },
                orchestrationTrends: [
                    {
                        family: "string_trio",
                        instrumentNames: ["violin", "viola", "cello"],
                        manifestCount: 1,
                        averageIdiomaticRangeFit: 0.91,
                        averageRegisterBalanceFit: 0.88,
                        averageEnsembleConversationFit: 0.84,
                        averageDoublingPressureFit: 0.79,
                        averageTextureRotationFit: 0.74,
                        averageWeakSectionCount: 1,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-10T03:05:00.000Z",
                    },
                ],
                escalation: {
                    required: true,
                    ownerRole: "Incident Commander",
                    cadenceMinutes: 15,
                    nextUpdateBy: "2026-04-10T03:21:00.000Z",
                    channels: ["internal_ops", "executive_stakeholder", "public_user"],
                    requiredArtifacts: ["incident_record", "comms_broadcast"],
                    triggers: ["sev1_requires_immediate_escalation"],
                },
                comms: {
                    currentStatus: "Investigating",
                    userImpact: "Runtime readiness or queue health is degraded for composition operations.",
                    scopeSummary: "AXIOM runtime composition surfaces",
                    changeSummary: "status=not_ready",
                    nextAction: "Inspect runtime readiness",
                    eta: "15 minutes",
                    initialAcknowledgement: "We are investigating an issue affecting AXIOM runtime composition surfaces. Current impact: Runtime readiness or queue health is degraded for composition operations. Scope: AXIOM runtime composition surfaces. Next update in 15 minutes.",
                    mitigationInProgress: "Mitigation is in progress. Current impact: Runtime readiness or queue health is degraded for composition operations. Latest action: Inspect runtime readiness. Validation status: in-progress. Next update in 15 minutes.",
                },
                evidence: {
                    backlog: { count: 1 },
                    pendingApprovals: { count: 1 },
                    repeatedWarnings: { count: 0 },
                    staleLock: { detected: false },
                },
            }, null, 2));
            fs.writeFileSync(path.join(operatorActionsDir, "latest.json"), JSON.stringify({
                actor: "mcp-reviewer",
                surface: "mcp",
                action: "approve",
                reason: "manual_accept",
                rollbackNote: "Reject again if downstream evidence fails after approval.",
                manualRecoveryNote: "Re-open the manifest review after the next operator summary refresh.",
                input: { songId },
                before: { approvalStatus: "pending" },
                after: { approvalStatus: "approved" },
                artifactLinks: [
                    "outputs/pending-song/manifest.json",
                    "outputs/_system/preferences.json",
                ],
                approvedBy: "lead-reviewer",
                observedAt: "2026-04-10T03:07:00.000Z",
            }, null, 2));
            fs.writeFileSync(path.join(pickupDir, "latest.json"), JSON.stringify({
                observedAt: "2026-04-10T03:08:00.000Z",
                status: "ok",
                summary: "pickup available",
                overseer: {
                    phraseBreathTrend: {
                        manifestCount: 1,
                        averagePlanFit: 0.48,
                        averageCoverageFit: 0.5,
                        averageArrivalFit: 0.34,
                        averageReleaseFit: 0.38,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-10T03:05:00.000Z",
                    },
                    harmonicColorTrend: {
                        manifestCount: 1,
                        averagePlanFit: 0.48,
                        averageCoverageFit: 0.5,
                        averageTargetFit: 0.42,
                        averageTimingFit: 0.44,
                        averageTonicizationPressureFit: 0.41,
                        averageProlongationMotionFit: 0.45,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-10T03:05:00.000Z",
                    },
                    orchestrationTrends: [
                        {
                            family: "string_trio",
                            instrumentNames: ["violin", "viola", "cello"],
                            manifestCount: 1,
                            averageIdiomaticRangeFit: 0.91,
                            averageRegisterBalanceFit: 0.88,
                            averageEnsembleConversationFit: 0.84,
                            averageDoublingPressureFit: 0.79,
                            averageTextureRotationFit: 0.74,
                            averageWeakSectionCount: 1,
                            weakManifestCount: 1,
                            lastSeenAt: "2026-04-10T03:05:00.000Z",
                        },
                    ],
                },
                incidentDraft: {
                    present: true,
                    incidentId: "axiom-2026-04-10-incident-candidate",
                    observedAt: "2026-04-10T03:06:00.000Z",
                    state: "incident_candidate",
                    severity: "SEV-1",
                    phraseBreathTrend: {
                        manifestCount: 1,
                        averagePlanFit: 0.48,
                        averageCoverageFit: 0.5,
                        averageArrivalFit: 0.34,
                        averageReleaseFit: 0.38,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-10T03:05:00.000Z",
                    },
                    harmonicColorTrend: {
                        manifestCount: 1,
                        averagePlanFit: 0.48,
                        averageCoverageFit: 0.5,
                        averageTargetFit: 0.42,
                        averageTimingFit: 0.44,
                        averageTonicizationPressureFit: 0.41,
                        averageProlongationMotionFit: 0.45,
                        weakManifestCount: 1,
                        lastSeenAt: "2026-04-10T03:05:00.000Z",
                    },
                    orchestrationTrends: [
                        {
                            family: "string_trio",
                            instrumentNames: ["violin", "viola", "cello"],
                            manifestCount: 1,
                            averageIdiomaticRangeFit: 0.91,
                            averageRegisterBalanceFit: 0.88,
                            averageEnsembleConversationFit: 0.84,
                            averageDoublingPressureFit: 0.79,
                            averageTextureRotationFit: 0.74,
                            averageWeakSectionCount: 1,
                            weakManifestCount: 1,
                            lastSeenAt: "2026-04-10T03:05:00.000Z",
                        },
                    ],
                },
            }, null, 2));

            const queuedJob = enqueue({ prompt: "operator summary tool smoke test" });
            queuedJob.manifest = manifest;

            const tools = listMcpTools();
            const result = await callMcpTool({
                name: "axiom.operator.summary",
                arguments: { source: "bridge", jobLimit: 3, windowHours: 12 },
            });

            console.log(JSON.stringify({
                tools,
                payload: JSON.parse(result.content[0].text),
            }));
        `, {
            cwd: repoRoot,
            env: {
                OUTPUT_DIR: outputDir,
                LOG_DIR: logDir,
                LOG_LEVEL: "error",
                PYTHON_BIN: "missing-python-for-ready-check",
                AUTONOMY_ENABLED: "true",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.tools.some((tool) => tool.name === "axiom_operator_summary"), true);
        assert.equal(result.payload.ok, true);
        assert.equal(result.payload.source, "bridge");
        assert.equal(result.payload.namespace, "axiom");
        assert.equal(result.payload.readiness.status, "not_ready");
        assert.equal(result.payload.queue.total >= 1, true);
        assert.equal(result.payload.queue.backlog.count >= 1, true);
        assert.equal(result.payload.autonomy.pendingApprovalCount, 1);
        assert.equal(Array.isArray(result.payload.autonomy.pendingApprovals), true);
        assert.equal(result.payload.autonomy.pendingApprovals.length, 1);
        assert.equal(result.payload.autonomy.pendingApprovals[0].longSpan.status, "collapsed");
        assert.equal(result.payload.autonomy.pendingApprovals[0].longSpan.weakestDimension, "return_payoff");
        assert.equal(Array.isArray(result.payload.data.jobs), true);
        assert.equal(result.payload.data.jobs.length >= 1, true);
        assert.equal(result.payload.data.jobs[0].quality.longSpan.status, "collapsed");
        assert.equal(result.payload.data.jobs[0].quality.audioLongSpan.status, "collapsed");
        assert.equal(result.payload.data.jobs[0].quality.audioLongSpan.weakestDimension, "tonal_return");
        assert.equal(result.payload.queue.backlog.topJobs[0].orchestration.family, "string_trio");
        assert.equal(result.payload.queue.backlog.topJobs[0].orchestration.idiomaticRangeFit, 0.91);
        assert.equal(result.payload.queue.backlog.topJobs[0].orchestration.doublingPressureFit, 0.79);
        assert.deepEqual(result.payload.queue.backlog.topJobs[0].orchestration.weakSectionIds, ["s1"]);
        assert.equal(result.payload.overseer.phraseBreathTrend.manifestCount, 1);
        assert.equal(result.payload.overseer.phraseBreathTrend.weakManifestCount, 1);
        assert.equal(result.payload.overseer.phraseBreathTrend.averageArrivalFit, 0.34);
        assert.equal(result.payload.overseer.harmonicColorTrend.manifestCount, 1);
        assert.equal(result.payload.overseer.harmonicColorTrend.weakManifestCount, 1);
        assert.equal(result.payload.overseer.harmonicColorTrend.averagePlanFit, 0.48);
        assert.equal(result.payload.overseer.shadowReranker.manifestCount >= 1, true);
        assert.equal(result.payload.overseer.shadowReranker.scoredManifestCount, 1);
        assert.equal(result.payload.overseer.shadowReranker.disagreementCount, 1);
        assert.equal(result.payload.overseer.shadowReranker.highConfidenceDisagreementCount, 1);
        assert.equal(result.payload.overseer.shadowReranker.promotedSelectionCount, 1);
        assert.equal(result.payload.overseer.shadowReranker.runtimeWindow.sampledEntries, 1);
        assert.equal(result.payload.overseer.shadowReranker.runtimeWindow.disagreementCount, 1);
        assert.equal(result.payload.overseer.shadowReranker.recentDisagreements[0].learnedTopCandidateId, "structure-a1-learned");
        assert.equal(result.payload.overseer.shadowReranker.recentDisagreements[0].selectedWorker, "music21");
        assert.equal(result.payload.overseer.shadowReranker.recentDisagreements[0].learnedTopWorker, "learned_symbolic");
        assert.match(result.payload.overseer.shadowReranker.recentDisagreements[0].reason ?? "", /hybrid candidate pool kept music21 over learned_symbolic/);
        assert.equal(result.payload.overseer.shadowReranker.recentPromotions[0].lane, "string_trio_symbolic");
        assert.equal(Array.isArray(result.payload.overseer.orchestrationTrends), true);
        assert.equal(result.payload.overseer.orchestrationTrends[0].family, "string_trio");
        assert.equal(result.payload.overseer.orchestrationTrends[0].manifestCount, 1);
        assert.equal(result.payload.overseer.orchestrationTrends[0].averageRegisterBalanceFit, 0.88);
        assert.equal(result.payload.overseer.orchestrationTrends[0].averageDoublingPressureFit, 0.79);
        assert.equal(result.payload.overseer.orchestrationTrends[0].averageTextureRotationFit, 0.74);
        assert.equal(result.payload.latestOperatorAction.present, true);
        assert.equal(result.payload.latestOperatorAction.action, "approve");
        assert.equal(result.payload.latestOperatorAction.rollbackNote, "Reject again if downstream evidence fails after approval.");
        assert.equal(result.payload.latestOperatorAction.manualRecoveryNote, "Re-open the manifest review after the next operator summary refresh.");
        assert.equal(result.payload.data.latestOperatorAction.action, "approve");
        assert.equal(result.payload.data.incidentDraft.incidentId, "axiom-2026-04-10-incident-candidate");
        assert.equal(result.payload.data.incidentDraft.escalation.required, true);
        assert.equal(result.payload.data.incidentDraft.phraseBreathTrend.manifestCount, 1);
        assert.equal(result.payload.data.incidentDraft.harmonicColorTrend.manifestCount, 1);
        assert.equal(result.payload.data.incidentDraft.harmonicColorTrend.averageTargetFit, 0.42);
        assert.equal(Array.isArray(result.payload.data.incidentDraft.orchestrationTrends), true);
        assert.equal(result.payload.data.incidentDraft.orchestrationTrends[0].family, "string_trio");
        assert.equal(result.payload.data.incidentDraft.orchestrationTrends[0].averageIdiomaticRangeFit, 0.91);
        assert.match(result.payload.data.incidentDraft.comms.initialAcknowledgement, /Next update in 15 minutes/);
        assert.equal(result.payload.data.operatorPickup.incidentDraft.present, true);
        assert.equal(result.payload.data.operatorPickup.overseer.phraseBreathTrend.manifestCount, 1);
        assert.equal(result.payload.data.operatorPickup.overseer.harmonicColorTrend.manifestCount, 1);
        assert.equal(Array.isArray(result.payload.data.operatorPickup.overseer.orchestrationTrends), true);
        assert.equal(result.payload.data.operatorPickup.overseer.orchestrationTrends[0].averageRegisterBalanceFit, 0.88);
        assert.equal(result.payload.data.operatorPickup.incidentDraft.phraseBreathTrend.weakManifestCount, 1);
        assert.equal(result.payload.data.operatorPickup.incidentDraft.harmonicColorTrend.weakManifestCount, 1);
        assert.equal(Array.isArray(result.payload.data.operatorPickup.incidentDraft.orchestrationTrends), true);
        assert.equal(result.payload.data.operatorPickup.incidentDraft.orchestrationTrends[0].weakManifestCount, 1);
        assert.equal(result.payload.triage.state, "incident_candidate");
        assert.equal(Array.isArray(result.payload.triage.severityDrivers), true);
        assert.equal(result.payload.evidence.endpoints.ready.path, "/ready");
        assert.equal(result.payload.evidence.stale, false);
        assert.match(JSON.stringify(result.payload.artifacts), /audioLongSpan=collapsed:tonal_return/);
        assert.match(JSON.stringify(result.payload.artifacts), /phraseBreathTrend manifests=1 plan=0\.48 cov=0\.50 pickup=0\.44 arr=0\.34 rel=0\.38 weakManifests=1/);
        assert.match(JSON.stringify(result.payload.artifacts), /harmonicColorTrend manifests=1 plan=0\.48 cov=0\.50 target=0\.42 time=0\.44 tonic=0\.41 prolong=0\.45 weakManifests=1/);
        assert.match(JSON.stringify(result.payload.artifacts), /shadowReranker manifests=\d+ scored=1 disagreements=1 highConfidence=1 promotions=1 agreementRate=0\.00 avgConfidence=0\.81 snapshot=shadow-live/);
        assert.match(JSON.stringify(result.payload.artifacts), /shadowReranker disagreement song=pending-song lane=string_trio_symbolic selected=structure-a2-selected selectedWorker=music21 learnedTop=structure-a1-learned learnedTopWorker=learned_symbolic confidence=0\.81 snapshot=shadow-live/);
        assert.match(JSON.stringify(result.payload.artifacts), /reason=structure evaluation accepted the symbolic draft; hybrid candidate pool kept music21 over learned_symbolic/);
        assert.match(JSON.stringify(result.payload.artifacts), /shadowReranker promotion song=pending-song lane=string_trio_symbolic selected=structure-a2-selected selectedWorker=music21 heuristicCounterfactual=structure-a2-selected heuristicCounterfactualWorker=music21 confidence=0\.81 snapshot=shadow-live/);
        assert.match(JSON.stringify(result.payload.artifacts), /orchestration=trio:rng=0\.91,bal=0\.88,conv=0\.84,dbl=0\.79,rot=0\.74,weak=s1/);
        assert.match(JSON.stringify(result.payload.artifacts), /orchestrationTrend family=trio manifests=1 rng=0\.91 bal=0\.88 conv=0\.84 dbl=0\.79 rot=0\.74 weakManifests=1 avgWeakSections=1\.00 instruments=violin\/viola\/cello/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("mcp HTTP rpc accepts bearer auth, keeps legacy /mcp, and exposes /tools/list fallback", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-mcp-http-ok-");

    try {
        const { stdout } = await runNodeEval(`
            import express from "express";
            import mcpRouter from "./dist/routes/mcp.js";

            const headers = {
                "content-type": "application/json",
                authorization: "Bearer axiom-http-token",
            };

            const app = express();
            app.use(express.json());
            app.use(mcpRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;
                    const initialize = await fetch(baseUrl + "/mcp/rpc", {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
                    });
                    const health = await fetch(baseUrl + "/mcp/health");
                    const toolsList = await fetch(baseUrl + "/mcp/rpc", {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
                    });
                    const legacyCall = await fetch(baseUrl + "/mcp", {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            jsonrpc: "2.0",
                            id: 3,
                            method: "tools/call",
                            params: { name: "axiom.job.list", arguments: { limit: 5 } },
                        }),
                    });
                    const fallbackList = await fetch(baseUrl + "/tools/list", {
                        method: "POST",
                        headers,
                        body: JSON.stringify({}),
                    });

                    console.log(JSON.stringify({
                        initializeStatus: initialize.status,
                        initializePayload: await initialize.json(),
                        healthStatus: health.status,
                        healthPayload: await health.json(),
                        toolsListStatus: toolsList.status,
                        toolsListPayload: await toolsList.json(),
                        legacyCallStatus: legacyCall.status,
                        legacyCallPayload: await legacyCall.json(),
                        fallbackListStatus: fallbackList.status,
                        fallbackListPayload: await fallbackList.json(),
                    }));
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
                MCP_WORKER_AUTH_TOKEN: "axiom-http-token",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.initializeStatus, 200);
        assert.equal(result.initializePayload.result.serverInfo.name, "axiom-mcp-server");
        assert.equal(result.healthStatus, 200);
        assert.equal(result.healthPayload.status, "ok");
        assert.equal(result.healthPayload.auth.required, true);
        assert.equal(result.toolsListStatus, 200);
        assert.equal(Array.isArray(result.toolsListPayload.result.tools), true);
        assert.equal(result.toolsListPayload.result.tools.some((tool) => tool.name === "axiom_compose"), true);
        assert.equal(result.toolsListPayload.result.tools.some((tool) => tool.name === "axiom_operator_summary"), true);
        assert.equal(result.legacyCallStatus, 200);
        assert.equal(result.legacyCallPayload.result.isError ?? false, false);
        assert.deepEqual(JSON.parse(result.legacyCallPayload.result.content[0].text), []);
        assert.equal(result.fallbackListStatus, 200);
        assert.equal(Array.isArray(result.fallbackListPayload.tools), true);
        assert.equal(result.fallbackListPayload.tools.some((tool) => tool.name === "axiom_autonomy_status"), true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("mcp stdio notifications are silent and regular requests still return JSON", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-mcp-stdio-");

    try {
        const { stdout } = await runNodeEval(`
            import { spawn } from "node:child_process";
            import { once } from "node:events";
            import { setTimeout as delay } from "node:timers/promises";

            const child = spawn(process.execPath, ["./dist/mcp/server.js"], {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    OUTPUT_DIR: ${JSON.stringify(outputDir)},
                    LOG_DIR: ${JSON.stringify(logDir)},
                    LOG_LEVEL: "error",
                },
                stdio: ["pipe", "pipe", "pipe"],
            });

            let childStdout = "";
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk) => {
                childStdout += chunk;
            });

            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\\n");
            await delay(150);
            const afterNotification = childStdout;

            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) + "\\n");
            for (let attempt = 0; attempt < 50 && !childStdout.includes('"id":1'); attempt += 1) {
                await delay(20);
            }

            child.kill();
            await once(child, "exit");

            const lines = childStdout
                .split(/\\r?\\n/)
                .map((line) => line.trim())
                .filter(Boolean);

            console.log(JSON.stringify({
                afterNotification,
                lineCount: lines.length,
                lastResponse: lines.length > 0 ? JSON.parse(lines.at(-1)) : null,
            }));
        `, {
            cwd: repoRoot,
            env: {
                OUTPUT_DIR: outputDir,
                LOG_DIR: logDir,
                LOG_LEVEL: "error",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.afterNotification, "");
        assert.equal(result.lineCount, 1);
        assert.equal(Array.isArray(result.lastResponse.result.tools), true);
        assert.equal(result.lastResponse.result.tools.some((tool) => tool.name === "axiom_overseer_status"), true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("mcp manifest tools expose stored section transforms and audio narrative metrics", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-mcp-manifest-");

    try {
        const songDir = path.join(outputDir, "manifest-song");
        const failedSongDir = path.join(outputDir, "manifest-song-failed");
        fs.mkdirSync(songDir, { recursive: true });
        fs.mkdirSync(failedSongDir, { recursive: true });
        fs.writeFileSync(path.join(songDir, "manifest.json"), JSON.stringify({
            songId: "manifest-song",
            state: "DONE",
            meta: {
                songId: "manifest-song",
                prompt: "Trace the development and recap clearly.",
                workflow: "symbolic_plus_audio",
                form: "sonata",
                plannerVersion: "planner-v1",
                createdAt: "2025-01-01T00:00:00.000Z",
                updatedAt: "2025-01-01T00:00:03.000Z",
            },
            artifacts: {
                audio: "outputs/manifest-song/output.wav",
                renderedAudio: "outputs/manifest-song/output.wav",
                styledAudio: "outputs/manifest-song/styled-output.wav",
            },
            audioEvaluation: {
                passed: true,
                score: 92,
                issues: [],
                strengths: ["Rendered audio supports the recap's return and release."],
                metrics: {
                    audioDevelopmentNarrativeFit: 0.74,
                    audioRecapRecallFit: 0.81,
                    audioNarrativeRenderConsistency: 0.79,
                    audioTonalReturnRenderFit: 0.83,
                    audioHarmonicRouteRenderFit: 0.8,
                    audioChromaTonalReturnFit: 0.79,
                    audioChromaHarmonicRouteFit: 0.77,
                    audioDevelopmentKeyDriftFit: 0.73,
                },
                longSpan: {
                    status: "held",
                    weakDimensions: [],
                    averageFit: 0.795,
                    developmentNarrativeFit: 0.74,
                    recapRecallFit: 0.81,
                    harmonicRouteFit: 0.8,
                    tonalReturnFit: 0.83,
                },
                sectionFindings: [
                    {
                        sectionId: "s2",
                        label: "Development",
                        role: "development",
                        sourceSectionId: "s1",
                        plannedTonality: "G major",
                        score: 0.74,
                        issues: [],
                        strengths: ["Rendered key drift settles into a readable development route."],
                        metrics: {
                            audioSectionCompositeFit: 0.74,
                            audioDevelopmentNarrativeFit: 0.74,
                            audioDevelopmentPitchClassRouteFit: 0.75,
                            audioDevelopmentKeyDriftFit: 0.73,
                        },
                    },
                    {
                        sectionId: "s3",
                        label: "Recap",
                        role: "recap",
                        sourceSectionId: "s1",
                        plannedTonality: "C major",
                        score: 0.81,
                        issues: [],
                        strengths: ["Audio return and release recall the source theme clearly."],
                        metrics: {
                            audioSectionCompositeFit: 0.81,
                            audioRecapRecallFit: 0.81,
                            audioRecapPitchClassReturnFit: 0.79,
                        },
                    },
                ],
                weakestSections: [
                    {
                        sectionId: "s2",
                        label: "Development",
                        role: "development",
                        sourceSectionId: "s1",
                        plannedTonality: "G major",
                        score: 0.74,
                        issues: [],
                        strengths: ["Rendered key drift settles into a readable development route."],
                        metrics: {
                            audioSectionCompositeFit: 0.74,
                            audioDevelopmentNarrativeFit: 0.74,
                            audioDevelopmentPitchClassRouteFit: 0.75,
                            audioDevelopmentKeyDriftFit: 0.73,
                        },
                    },
                ],
                keyTracking: {
                    source: "rendered",
                    sections: [
                        {
                            sectionId: "s1",
                            role: "theme_a",
                            plannedTonality: "C major",
                            renderedKey: {
                                label: "C major",
                                tonicPitchClass: 0,
                                mode: "major",
                                score: 0.84,
                                confidence: 0.75,
                            },
                            driftPath: [
                                {
                                    startRatio: 0,
                                    endRatio: 1,
                                    renderedKey: {
                                        label: "C major",
                                        tonicPitchClass: 0,
                                        mode: "major",
                                        score: 0.84,
                                        confidence: 0.75,
                                    },
                                },
                            ],
                        },
                        {
                            sectionId: "s2",
                            role: "development",
                            plannedTonality: "G major",
                            renderedKey: {
                                label: "G major",
                                tonicPitchClass: 7,
                                mode: "major",
                                score: 0.82,
                                confidence: 0.71,
                            },
                            driftPath: [
                                {
                                    startRatio: 0,
                                    endRatio: 0.34,
                                    renderedKey: {
                                        label: "C major",
                                        tonicPitchClass: 0,
                                        mode: "major",
                                        score: 0.72,
                                        confidence: 0.61,
                                    },
                                },
                                {
                                    startRatio: 0.34,
                                    endRatio: 0.67,
                                    renderedKey: {
                                        label: "D major",
                                        tonicPitchClass: 2,
                                        mode: "major",
                                        score: 0.69,
                                        confidence: 0.58,
                                    },
                                },
                                {
                                    startRatio: 0.67,
                                    endRatio: 1,
                                    renderedKey: {
                                        label: "G major",
                                        tonicPitchClass: 7,
                                        mode: "major",
                                        score: 0.82,
                                        confidence: 0.71,
                                    },
                                },
                            ],
                        },
                        {
                            sectionId: "s3",
                            role: "recap",
                            plannedTonality: "C major",
                            renderedKey: {
                                label: "C major",
                                tonicPitchClass: 0,
                                mode: "major",
                                score: 0.83,
                                confidence: 0.74,
                            },
                            driftPath: [
                                {
                                    startRatio: 0,
                                    endRatio: 1,
                                    renderedKey: {
                                        label: "C major",
                                        tonicPitchClass: 0,
                                        mode: "major",
                                        score: 0.83,
                                        confidence: 0.74,
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
            structureEvaluation: {
                passed: true,
                score: 88,
                issues: [],
                strengths: ["Development and recap remain clearly differentiated."],
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
                        score: 0.54,
                        issues: ["Contrast drops too early before the recap return."],
                    },
                ],
            },
            qualityControl: {
                attempts: [
                    {
                        attempt: 1,
                        stage: "audio",
                        passed: false,
                        score: 68,
                        issues: ["Narrative arc flattens in the rendered middle section."],
                        strengths: [],
                        evaluatedAt: "2025-01-01T00:00:01.000Z",
                        directives: [
                            {
                                kind: "clarify_narrative_arc",
                                reason: "Push the development contour further forward.",
                            },
                            {
                                kind: "rebalance_recap_release",
                                reason: "Make the recap arrival and release clearer.",
                            },
                        ],
                    },
                    {
                        attempt: 2,
                        stage: "audio",
                        passed: true,
                        score: 92,
                        issues: [],
                        strengths: ["Narrative arc now lands with a clear recap release."],
                        evaluatedAt: "2025-01-01T00:00:02.000Z",
                        directives: [],
                    },
                ],
                selectedAttempt: 2,
                stopReason: "accepted",
            },
            sectionTransforms: [
                {
                    sectionId: "s2",
                    role: "development",
                    sourceSectionId: "s1",
                    transformMode: "inversion+sequence+diminution",
                    rhythmTransform: "diminution",
                    sequenceStride: 2,
                },
            ],
            sectionTonalities: [
                { sectionId: "s1", role: "theme_a", tonalCenter: "C major" },
                { sectionId: "s2", role: "development", tonalCenter: "G major" },
                { sectionId: "s3", role: "recap", tonalCenter: "C major" },
            ],
            stateHistory: [
                { state: "IDLE", timestamp: "2025-01-01T00:00:00.000Z" },
                { state: "DONE", timestamp: "2025-01-01T00:00:03.000Z" },
            ],
            updatedAt: "2025-01-01T00:00:03.000Z",
        }, null, 2));

        fs.writeFileSync(path.join(failedSongDir, "manifest.json"), JSON.stringify({
            songId: "manifest-song-failed",
            state: "FAILED",
            meta: {
                songId: "manifest-song-failed",
                prompt: "Retry the recap transition more aggressively.",
                workflow: "audio_only",
                form: "fantasia",
                plannerVersion: "planner-v2",
                createdAt: "2025-01-01T00:00:00.000Z",
                updatedAt: "2025-01-01T00:00:02.000Z",
            },
            artifacts: {
                audio: "outputs/manifest-song-failed/styled-output.wav",
                renderedAudio: "outputs/manifest-song-failed/output.wav",
                styledAudio: "outputs/manifest-song-failed/styled-output.wav",
            },
            audioEvaluation: {
                passed: false,
                score: 61,
                issues: ["The recap still does not release clearly enough."],
                strengths: [],
                metrics: {
                    audioDevelopmentNarrativeFit: 0.51,
                    audioRecapRecallFit: 0.46,
                    audioNarrativeRenderConsistency: 0.49,
                    audioHarmonicRouteRenderFit: 0.5,
                    audioTonalReturnRenderFit: 0.44,
                },
                longSpan: {
                    status: "collapsed",
                    weakestDimension: "tonal_return",
                    weakDimensions: ["tonal_return", "recap_recall", "harmonic_route", "development_narrative"],
                    averageFit: 0.4775,
                    developmentNarrativeFit: 0.51,
                    recapRecallFit: 0.46,
                    harmonicRouteFit: 0.5,
                    tonalReturnFit: 0.44,
                },
                weakestSections: [
                    {
                        sectionId: "s3",
                        label: "Recap",
                        role: "recap",
                        sourceSectionId: "s1",
                        plannedTonality: "C major",
                        score: 0.46,
                        issues: ["Audio return and release against the source section are weak."],
                        strengths: [],
                        metrics: {
                            audioSectionCompositeFit: 0.46,
                            audioRecapRecallFit: 0.46,
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
                        score: 60,
                        issues: ["Recap return is still too soft."],
                        strengths: [],
                        evaluatedAt: "2025-01-01T00:00:01.000Z",
                        directives: [
                            {
                                kind: "clarify_narrative_arc",
                                reason: "Push the development contour further forward.",
                            },
                            {
                                kind: "rebalance_recap_release",
                                reason: "Make the recap arrival and release clearer.",
                            },
                        ],
                    },
                    {
                        attempt: 2,
                        stage: "audio",
                        passed: false,
                        score: 61,
                        issues: ["The recap still does not release clearly enough."],
                        strengths: [],
                        evaluatedAt: "2025-01-01T00:00:02.000Z",
                        directives: [],
                    },
                ],
                selectedAttempt: 2,
                stopReason: "exhausted_audio_retries",
            },
            updatedAt: "2025-01-01T00:00:02.000Z",
        }, null, 2));

        const { stdout } = await runNodeEval(`
            import { callMcpTool } from "./dist/mcp/toolAdapter.js";

            const listPayload = await callMcpTool({
                name: "axiom.manifest.list",
                arguments: { limit: 5 },
            });
            const getPayload = await callMcpTool({
                name: "axiom.manifest.get",
                arguments: { songId: "manifest-song" },
            });

            console.log(JSON.stringify({ listPayload, getPayload }));
        `, {
            cwd: repoRoot,
            env: {
                OUTPUT_DIR: outputDir,
                LOG_DIR: logDir,
                LOG_LEVEL: "error",
            },
        });

        const result = parseLastJsonLine(stdout);
        const manifestList = JSON.parse(result.listPayload.content[0].text);
        const manifestGet = JSON.parse(result.getPayload.content[0].text);

        assert.equal(manifestList.totalCount, 2);
        assert.equal(manifestList.items[0].songId, "manifest-song");
        assert.equal(manifestList.items[0].audioNarrative.developmentFit, 0.74);
        assert.equal(manifestList.items[0].audioNarrative.harmonicRouteFit, 0.8);
        assert.equal(manifestList.items[0].audioNarrative.chromaHarmonicRouteFit, 0.77);
        assert.equal(manifestList.items[0].audioNarrative.developmentKeyDriftFit, 0.73);
        assert.equal(manifestList.items[0].audioNarrative.longSpan.status, "held");
        assert.equal(manifestList.items[0].audioWeakestSections[0].sectionId, "s2");
        assert.equal(manifestList.items[0].audioWeakestSections[0].sourceSectionId, "s1");
        assert.equal(manifestList.items[0].orchestration.family, "string_trio");
        assert.equal(manifestList.items[0].orchestration.idiomaticRangeFit, 0.89);
        assert.deepEqual(manifestList.items[0].orchestration.weakSectionIds, ["s2"]);
        assert.equal(manifestList.items[0].sectionTonalities[1].tonalCenter, "G major");
        assert.equal(manifestList.items[0].renderedKeyTracking.source, "rendered");
        assert.equal(manifestList.items[0].renderedKeyTracking.sections[1].renderedKeyLabel, "G major");
        assert.deepEqual(manifestList.items[0].renderedKeyTracking.sections[1].driftPathLabels, ["C major", "D major", "G major"]);
        assert.equal(manifestList.items[0].weakestSections[0].label, "Development");
        assert.match(manifestList.items[0].latestAudioRetryReason, /recap arrival and release/i);
        assert.equal(manifestList.audioRetryStats.totalRetryEvents, 2);
        assert.equal(manifestList.audioRetryStats.topCombinations[0].combinationKey, "clarify_narrative_arc + rebalance_recap_release");
        assert.equal(manifestList.audioRetryStats.topCombinations[0].immediateSuccessCount, 1);
        assert.equal(manifestList.audioRetryStats.topCombinations[0].eventualSuccessCount, 1);
        assert.equal(manifestList.audioRetryWindows.last7Days.windowDays, 7);
        assert.equal(manifestList.audioRetryWindows.last7Days.dailySeries.length, 7);
        assert.equal(manifestList.audioRetryWindows.last30Days.windowDays, 30);
        assert.equal(manifestList.audioRetryWindows.last30Days.dailySeries.length, 30);
        assert.equal(manifestList.audioRetryBreakdowns.byForm.length, 2);
        assert.equal(manifestList.audioRetryBreakdowns.byWorkflow.length, 2);
        assert.equal(manifestList.audioRetryBreakdowns.byPlannerVersion.length, 2);
        assert.equal(manifestList.audioRetryBreakdowns.bySettingProfile.length, 2);
        assert.equal(manifestList.audioRetryBreakdowns.byAudioWeakestRole.length, 2);
        assert.equal(manifestList.audioRetryBreakdowns.byForm[0].topCombinationKey, "clarify_narrative_arc + rebalance_recap_release");
        assert.equal(manifestList.audioRetryBreakdowns.byAudioWeakestRole[0].value, "development");
        assert.equal(manifestGet.tracking.sectionTransforms[0].transformMode, "inversion+sequence+diminution");
        assert.equal(manifestGet.tracking.audioNarrative.recapFit, 0.81);
        assert.equal(manifestGet.tracking.audioNarrative.tonalReturnFit, 0.83);
        assert.equal(manifestGet.tracking.audioNarrative.developmentKeyDriftFit, 0.73);
        assert.equal(manifestGet.tracking.audioNarrative.longSpan.status, "held");
        assert.equal(manifestGet.tracking.audioNarrative.longSpan.tonalReturnFit, 0.83);
        assert.equal(manifestGet.tracking.audioWeakestSections[0].sectionId, "s2");
        assert.equal(manifestGet.tracking.audioWeakestSections[0].plannedTonality, "G major");
        assert.equal(manifestGet.tracking.orchestration.family, "string_trio");
        assert.equal(manifestGet.tracking.orchestration.registerBalanceFit, 0.86);
        assert.equal(manifestGet.tracking.orchestration.conversationalSectionCount, 1);
        assert.equal(manifestGet.tracking.sectionTonalities[2].tonalCenter, "C major");
        assert.equal(manifestGet.tracking.renderedKeyTracking.sections[1].renderedKeyLabel, "G major");
        assert.deepEqual(manifestGet.tracking.renderedKeyTracking.sections[1].driftPathLabels, ["C major", "D major", "G major"]);
        assert.equal(manifestGet.tracking.weakestSections[0].topIssue, "Contrast drops too early before the recap return.");
        assert.match(manifestGet.tracking.latestAudioRetryReason, /development contour/i);
        assert.equal(manifestGet.manifest.sectionTransforms[0].rhythmTransform, "diminution");
        assert.equal(manifestGet.manifest.sectionTonalities[1].tonalCenter, "G major");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});