import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine, runNodeEval } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("operator summary reports narrow-lane reranker promotion outcomes against heuristic-reviewed runs", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-reranker-outcomes-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import { buildOperatorSummary } from "./dist/operator/summary.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(outputDir)};
            config.logDir = ${JSON.stringify(logDir)};

            function writeManifest(songId, approvalStatus, appealScore, updatedAt, directives) {
                const manifestDir = path.join(config.outputDir, songId);
                fs.mkdirSync(manifestDir, { recursive: true });
                fs.writeFileSync(path.join(manifestDir, "manifest.json"), JSON.stringify({
                    songId,
                    state: "DONE",
                    meta: {
                        songId,
                        prompt: songId,
                        form: "string trio miniature",
                        source: "autonomy",
                        autonomyRunId: "run-" + songId,
                        promptHash: "hash-" + songId,
                        createdAt: "2026-04-17T04:00:00.000Z",
                        updatedAt,
                    },
                    artifacts: { midi: "outputs/" + songId + "/composition.mid" },
                    approvalStatus,
                    ...(typeof appealScore === "number" ? { reviewFeedback: { appealScore } } : {}),
                    selfAssessment: { qualityScore: 0.84 },
                    structureEvaluation: {
                        passed: true,
                        score: 84,
                        issues: [],
                        strengths: ["string trio lane"],
                        metrics: {},
                    },
                    qualityControl: {
                        selectedAttempt: 2,
                        attempts: [
                            {
                                stage: "structure",
                                attempt: 1,
                                passed: false,
                                score: 71,
                                issues: ["localized retry needed"],
                                strengths: [],
                                directives,
                                evaluatedAt: "2026-04-17T04:04:30.000Z",
                            },
                        ],
                    },
                    stateHistory: [
                        { state: "IDLE", timestamp: "2026-04-17T04:00:00.000Z" },
                        { state: "DONE", timestamp: updatedAt },
                    ],
                    updatedAt,
                }, null, 2));
            }

            function writeShadowEvidence(songId, { promotionApplied, confidence, updatedAt }) {
                const selectedCandidateId = songId + "-selected";
                const learnedTopCandidateId = songId + "-learned";
                const selectedDir = path.join(config.outputDir, songId, "candidates", selectedCandidateId);
                fs.mkdirSync(selectedDir, { recursive: true });

                const selectedShadow = {
                    snapshotId: "shadow-live",
                    evaluatedAt: updatedAt,
                    heuristicRank: 1,
                    heuristicScore: 0.91,
                    learnedRank: promotionApplied ? 2 : 1,
                    learnedScore: 0.82,
                    learnedConfidence: confidence,
                    disagreesWithHeuristic: true,
                    disagreementReason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                };

                fs.writeFileSync(path.join(selectedDir, "candidate-manifest.json"), JSON.stringify({
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
                    compositionPlan: {
                        form: "string trio miniature",
                        workflow: "symbolic_only",
                        instrumentation: [
                            { name: "Violin", family: "strings", roles: ["lead"] },
                            { name: "Viola", family: "strings", roles: ["support"] },
                            { name: "Cello", family: "strings", roles: ["bass"] },
                        ],
                        orchestration: {
                            family: "string_trio",
                            instrumentNames: ["Violin", "Viola", "Cello"],
                            sections: [],
                        },
                        sections: [
                            { sectionId: "s1", role: "theme_a", phraseFunction: "presentation" },
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
                    shadowReranker: selectedShadow,
                    ...(promotionApplied
                        ? {
                            rerankerPromotion: {
                                appliedAt: updatedAt,
                                lane: "string_trio_symbolic",
                                snapshotId: "shadow-live",
                                confidence,
                                heuristicTopCandidateId: selectedCandidateId,
                                learnedTopCandidateId,
                                heuristicAttempt: 2,
                                learnedAttempt: 1,
                                reason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                            },
                        }
                        : {}),
                    artifacts: {},
                }, null, 2));

                fs.writeFileSync(path.join(selectedDir, "reranker-score.json"), JSON.stringify({
                    version: 1,
                    type: "structure_shadow_reranker",
                    songId,
                    candidateId: selectedCandidateId,
                    evaluatedAt: updatedAt,
                    scorer: {
                        snapshotId: "shadow-live",
                        modelPath: "outputs/_system/ml/evaluations/structure-rank-v1/shadow-live/shadow-reranker-model.json",
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
                        confidence,
                    },
                    disagreement: {
                        disagrees: true,
                        heuristicTopCandidateId: selectedCandidateId,
                        learnedTopCandidateId,
                        reason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                    },
                }, null, 2));

                fs.writeFileSync(path.join(config.outputDir, songId, "candidates", "index.json"), JSON.stringify({
                    version: 1,
                    songId,
                    updatedAt,
                    selectedCandidateId,
                    selectedAttempt: 2,
                    selectionStopReason: promotionApplied
                        ? "selected after narrow-lane reranker promotion"
                        : "structure evaluation accepted the symbolic draft",
                    ...(promotionApplied
                        ? {
                            rerankerPromotion: {
                                appliedAt: updatedAt,
                                lane: "string_trio_symbolic",
                                snapshotId: "shadow-live",
                                confidence,
                                heuristicTopCandidateId: selectedCandidateId,
                                learnedTopCandidateId,
                                heuristicAttempt: 2,
                                learnedAttempt: 1,
                                reason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                            },
                        }
                        : {}),
                    entries: [
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
                            score: 84,
                            evaluatedAt: updatedAt,
                            manifestPath: path.join(selectedDir, "candidate-manifest.json"),
                            rerankerScorePath: path.join(selectedDir, "reranker-score.json"),
                            shadowReranker: selectedShadow,
                        },
                    ],
                }, null, 2));
            }

            writeManifest("promoted-reviewed-song", "approved", 0.93, "2026-04-17T04:05:00.000Z", [
                {
                    kind: "clarify_phrase_rhetoric",
                    priority: 80,
                    reason: "weak cadence release",
                    sectionIds: ["s2"],
                },
            ]);
            writeManifest("promoted-reviewed-song-2", "approved", 0.91, "2026-04-17T04:05:30.000Z", [
                {
                    kind: "clarify_texture_plan",
                    priority: 78,
                    reason: "thin inner motion",
                    sectionIds: ["s2"],
                },
            ]);
            writeManifest("heuristic-reviewed-song", "rejected", 0.31, "2026-04-17T04:06:00.000Z", [
                {
                    kind: "increase_rhythm_variety",
                    priority: 70,
                    reason: "uniform rhythm",
                },
            ]);
            writeManifest("heuristic-reviewed-song-2", "rejected", 0.37, "2026-04-17T04:06:30.000Z", [
                {
                    kind: "increase_pitch_variety",
                    priority: 69,
                    reason: "narrow contour band",
                },
            ]);
            writeManifest("promoted-pending-song", "pending", undefined, "2026-04-17T04:07:00.000Z", [
                {
                    kind: "clarify_texture_plan",
                    priority: 76,
                    reason: "weak middle texture",
                    sectionIds: ["s2"],
                },
                {
                    kind: "increase_pitch_variety",
                    priority: 65,
                    reason: "limited pitch variety",
                },
            ]);

            writeShadowEvidence("promoted-reviewed-song", { promotionApplied: true, confidence: 0.91, updatedAt: "2026-04-17T04:05:00.000Z" });
            writeShadowEvidence("promoted-reviewed-song-2", { promotionApplied: true, confidence: 0.89, updatedAt: "2026-04-17T04:05:30.000Z" });
            writeShadowEvidence("heuristic-reviewed-song", { promotionApplied: false, confidence: 0.74, updatedAt: "2026-04-17T04:06:00.000Z" });
            writeShadowEvidence("heuristic-reviewed-song-2", { promotionApplied: false, confidence: 0.72, updatedAt: "2026-04-17T04:06:30.000Z" });
            writeShadowEvidence("promoted-pending-song", { promotionApplied: true, confidence: 0.88, updatedAt: "2026-04-17T04:07:00.000Z" });

            const payload = await buildOperatorSummary({ source: "local-runtime", windowHours: 24 });
            console.log(JSON.stringify({ payload }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout).payload;
        assert.equal(payload.overseer.shadowReranker.promotedSelectionCount, 3);
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.lane, "string_trio_symbolic");
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.scoredManifestCount, 5);
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.reviewedManifestCount, 4);
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.pendingReviewCount, 1);
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.promotedReviewedCount, 2);
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.promotedApprovalRate, 1);
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.promotedAverageAppealScore, 0.92);
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.heuristicReviewedCount, 2);
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.heuristicApprovalRate, 0);
        assert.equal(payload.overseer.shadowReranker.promotionOutcomes.heuristicAverageAppealScore, 0.34);
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.lane, "string_trio_symbolic");
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.reviewedManifestCount, 4);
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.promotedReviewedCount, 2);
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.heuristicReviewedCount, 2);
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.sufficientReviewSample, true);
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.minimumReviewedManifestCount, 4);
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.minimumReviewedPerCohortCount, 2);
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.approvalRateDelta, 1);
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.appealScoreDelta, 0.58);
        assert.equal(payload.overseer.shadowReranker.promotionAdvantage.signal, "promoted_advantage");
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.lane, "string_trio_symbolic");
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.scoredManifestCount, 5);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.retryingManifestCount, 5);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.promotedRetryingCount, 3);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.promotedTargetedOnlyCount, 2);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.promotedMixedCount, 1);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.promotedGlobalOnlyCount, 0);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.promotedSectionTargetedRate, 1);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.heuristicRetryingCount, 2);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.heuristicTargetedOnlyCount, 0);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.heuristicMixedCount, 0);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.heuristicGlobalOnlyCount, 2);
        assert.equal(payload.overseer.shadowReranker.retryLocalizationOutcomes.heuristicSectionTargetedRate, 0);
        assert.match(JSON.stringify(payload.artifacts), /shadowReranker outcomes lane=string_trio_symbolic scored=5 reviewed=4 pendingReview=1 promoted=3 promotedReviewed=2 promotedApprovalRate=1\.00 heuristicReviewed=2 heuristicApprovalRate=0\.00 promotedAvgAppeal=0\.92 heuristicAvgAppeal=0\.34/);
        assert.match(JSON.stringify(payload.artifacts), /shadowReranker promotionAdvantage lane=string_trio_symbolic reviewed=4 promotedReviewed=2 heuristicReviewed=2 sufficientSample=yes approvalDelta=1\.00 appealDelta=0\.58 signal=promoted_advantage/);
        assert.match(JSON.stringify(payload.artifacts), /shadowReranker retryLocalization lane=string_trio_symbolic scored=5 retrying=5 promotedRetrying=3 promotedTargetedOnly=2 promotedMixed=1 promotedGlobalOnly=0 promotedTargetedRate=1\.00 heuristicRetrying=2 heuristicTargetedOnly=0 heuristicMixed=0 heuristicGlobalOnly=2 heuristicTargetedRate=0\.00/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});