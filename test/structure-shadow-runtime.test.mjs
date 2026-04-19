import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine, runNodeEval } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const readyPromotionGateSeedScript = String.raw`
function writePromotionGateJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function seedReadyPromotionGate(outputDir) {
    const benchmarkPackVersion = "string_trio_symbolic_benchmark_pack_v1";
    const promptPackVersion = "learned_symbolic_prompt_pack_v1";

    for (let index = 0; index < 30; index += 1) {
        const songNumber = String(index + 1).padStart(2, "0");
        const songId = "gate-ready-" + songNumber;
        const songDir = path.join(outputDir, songId);
        const updatedAt = new Date(Date.UTC(2026, 3, 10, 0, index, 0)).toISOString();
        const learnedCandidateId = songId + "-learned";
        const baselineCandidateId = songId + "-baseline";
        const learnedSelected = index < 20;
        const disagreement = index < 10;
        const benchmarkId = index % 2 === 0 ? "cadence_clarity_reference" : "localized_rewrite_probe";
        const generationMode = index % 2 === 0 ? "plan_conditioned_trio_template" : "targeted_section_rewrite";
        const proposalEvidence = {
            worker: "learned_symbolic",
            lane: "string_trio_symbolic",
            provider: "learned",
            model: "learned-symbolic-trio-v1",
            benchmarkPackVersion,
            benchmarkId,
            promptPackVersion,
            planSignature: "lane=string_trio_symbolic|sig=gate-ready-" + songNumber,
            generationMode,
            confidence: 0.78,
        };

        writePromotionGateJson(path.join(songDir, "manifest.json"), {
            songId,
            approvalStatus: learnedSelected ? "approved" : "rejected",
            reviewFeedback: {
                reviewRubricVersion: "approval_review_rubric_v1",
                appealScore: learnedSelected ? 0.93 : 0.31,
            },
            meta: {
                workflow: "symbolic_only",
            },
            updatedAt,
        });

        const learnedManifestPath = path.join(songDir, "candidates", learnedCandidateId, "candidate-manifest.json");
        const baselineManifestPath = path.join(songDir, "candidates", baselineCandidateId, "candidate-manifest.json");
        writePromotionGateJson(learnedManifestPath, {
            version: 1,
            stage: "structure",
            songId,
            candidateId: learnedCandidateId,
            attempt: 1,
            selected: learnedSelected,
            evaluatedAt: updatedAt,
            workflow: "symbolic_only",
            worker: "learned_symbolic",
            provider: "learned",
            model: "learned-symbolic-trio-v1",
            revisionDirectives: [],
            proposalEvidence,
            ...(disagreement ? { shadowReranker: { disagreesWithHeuristic: true } } : {}),
            artifacts: {},
        });
        writePromotionGateJson(baselineManifestPath, {
            version: 1,
            stage: "structure",
            songId,
            candidateId: baselineCandidateId,
            attempt: 1,
            selected: !learnedSelected,
            evaluatedAt: updatedAt,
            workflow: "symbolic_only",
            worker: "music21",
            provider: "python",
            model: "music21-symbolic-v1",
            revisionDirectives: [],
            ...(disagreement ? { shadowReranker: { disagreesWithHeuristic: true } } : {}),
            artifacts: {},
        });
        writePromotionGateJson(path.join(songDir, "candidates", "index.json"), {
            version: 1,
            songId,
            updatedAt,
            selectedCandidateId: learnedSelected ? learnedCandidateId : baselineCandidateId,
            selectedAttempt: 1,
            selectionStopReason: learnedSelected ? "selected learned benchmark fixture" : "baseline benchmark fixture",
            entries: [
                {
                    candidateId: baselineCandidateId,
                    attempt: 1,
                    stage: "structure",
                    selected: !learnedSelected,
                    workflow: "symbolic_only",
                    worker: "music21",
                    passed: true,
                    score: learnedSelected ? 79 : 88,
                    evaluatedAt: updatedAt,
                    manifestPath: baselineManifestPath,
                    ...(disagreement ? { shadowReranker: { disagreesWithHeuristic: true } } : {}),
                },
                {
                    candidateId: learnedCandidateId,
                    attempt: 1,
                    stage: "structure",
                    selected: learnedSelected,
                    workflow: "symbolic_only",
                    worker: "learned_symbolic",
                    passed: true,
                    score: learnedSelected ? 84 : 74,
                    evaluatedAt: updatedAt,
                    manifestPath: learnedManifestPath,
                    proposalEvidence,
                    ...(disagreement ? { shadowReranker: { disagreesWithHeuristic: true } } : {}),
                },
            ],
        });
    }
}
`;

test("runtime structure shadow reranker writes candidate disagreement sidecars without changing heuristic authority", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-shadow-runtime-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import {
                buildStructureCandidateId,
                markSelectedStructureCandidate,
                saveStructureCandidateSnapshot,
                structureCandidateIndexPath,
                structureCandidateManifestPath,
                structureCandidateRerankerScorePath,
            } from "./dist/memory/candidates.js";
            import {
                getStructureShadowHistoryDir,
                loadStructureShadowHistory,
                summarizeStructureShadowHistory,
            } from "./dist/pipeline/structureShadowHistory.js";
            import { runStructureRerankerShadowScoring } from "./dist/pipeline/structureShadowReranker.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.structureRerankerShadowEnabled = true;
            config.structureRerankerShadowSnapshot = "shadow-live";

            const modelPath = path.join(config.outputDir, "_system", "ml", "evaluations", "structure-rank-v1", "shadow-live", "shadow-reranker-model.json");
            fs.mkdirSync(path.dirname(modelPath), { recursive: true });
            fs.writeFileSync(modelPath, JSON.stringify({
                snapshotId: "shadow-live",
                featureNames: [
                    "bias",
                    "structureScore",
                    "sectionArtifactCoverage",
                    "hasCompositionPlan",
                    "hasSectionArtifacts",
                    "phraseBreathCueDensity"
                ],
                weights: [
                    { feature: "bias", weight: 0 },
                    { feature: "structureScore", weight: 0.2 },
                    { feature: "sectionArtifactCoverage", weight: 1.2 },
                    { feature: "hasCompositionPlan", weight: 0.8 },
                    { feature: "hasSectionArtifacts", weight: 0.8 },
                    { feature: "phraseBreathCueDensity", weight: 0.7 }
                ],
                calibratedTemperature: 1,
            }, null, 2));

            const executionPlan = {
                workflow: "symbolic_only",
                composeWorker: "music21",
                selectedModels: [
                    { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                ],
            };

            const richerCandidate = buildStructureCandidateId(1, executionPlan);
            const higherScoreCandidate = buildStructureCandidateId(2, executionPlan);

            saveStructureCandidateSnapshot({
                songId: "song-shadow",
                candidateId: richerCandidate,
                attempt: 1,
                meta: {
                    songId: "song-shadow",
                    prompt: "runtime shadow reranker",
                    promptHash: "hash-shadow",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: {
                    form: "miniature",
                    key: "C major",
                    tempo: 92,
                    sections: [
                        {
                            sectionId: "s1",
                            role: "theme_a",
                            phraseFunction: "presentation",
                            phraseBreath: { pickupStartMeasure: 1, arrivalMeasure: 4 },
                        },
                        {
                            sectionId: "s2",
                            role: "cadence",
                            phraseFunction: "cadential",
                            phraseBreath: { arrivalMeasure: 8, releaseStartMeasure: 8 },
                        },
                    ],
                },
                structureEvaluation: {
                    passed: true,
                    score: 72,
                    issues: ["lower raw score but richer local evidence"],
                    strengths: ["phrase and section evidence survived"],
                    metrics: {},
                },
                sectionArtifacts: [
                    { sectionId: "s1", role: "theme_a", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [60, 62] },
                    { sectionId: "s2", role: "cadence", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [67, 65] },
                ],
                evaluatedAt: "2026-04-17T08:00:00.000Z",
            });

            saveStructureCandidateSnapshot({
                songId: "song-shadow",
                candidateId: higherScoreCandidate,
                attempt: 2,
                meta: {
                    songId: "song-shadow",
                    prompt: "runtime shadow reranker",
                    promptHash: "hash-shadow",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: undefined,
                structureEvaluation: {
                    passed: true,
                    score: 91,
                    issues: [],
                    strengths: ["high aggregate structure score"],
                    metrics: {},
                },
                sectionArtifacts: [],
                evaluatedAt: "2026-04-17T08:01:00.000Z",
            });

            markSelectedStructureCandidate("song-shadow", richerCandidate, 1, "selected from offline-approved candidate set");
            const result = runStructureRerankerShadowScoring("song-shadow");

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("song-shadow"), "utf8"));
            const richerManifest = JSON.parse(fs.readFileSync(structureCandidateManifestPath("song-shadow", richerCandidate), "utf8"));
            const higherManifest = JSON.parse(fs.readFileSync(structureCandidateManifestPath("song-shadow", higherScoreCandidate), "utf8"));
            const richerScore = JSON.parse(fs.readFileSync(structureCandidateRerankerScorePath("song-shadow", richerCandidate), "utf8"));
            const higherScore = JSON.parse(fs.readFileSync(structureCandidateRerankerScorePath("song-shadow", higherScoreCandidate), "utf8"));
            const history = loadStructureShadowHistory({ limit: 5 });
            const runtimeWindow = summarizeStructureShadowHistory({ limit: 5 });

            console.log(JSON.stringify({
                result,
                index,
                richerManifest,
                higherManifest,
                richerScore,
                higherScore,
                historyDir: getStructureShadowHistoryDir(),
                history,
                runtimeWindow,
            }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.result.snapshotId, "shadow-live");
        assert.equal(payload.result.disagreement, true);
        assert.equal(payload.result.learnedTopCandidateId, payload.richerManifest.candidateId);
        assert.equal(payload.result.heuristicTopCandidateId, payload.higherManifest.candidateId);
        assert.equal(payload.result.confidence > 0.5, true);

        assert.equal(payload.richerScore.learned.rank, 1);
        assert.equal(payload.richerScore.heuristic.rank, 2);
        assert.equal(payload.higherScore.learned.rank, 2);
        assert.equal(payload.higherScore.heuristic.rank, 1);
        assert.equal(payload.richerScore.disagreement.disagrees, true);
        assert.equal(typeof payload.richerScore.disagreement.reason, "string");
        assert.equal(Array.isArray(payload.richerScore.disagreement.topFeatures), true);

        assert.equal(payload.richerManifest.shadowReranker.learnedRank, 1);
        assert.equal(payload.richerManifest.shadowReranker.heuristicRank, 2);
        assert.equal(payload.higherManifest.shadowReranker.learnedRank, 2);
        assert.equal(payload.index.entries.every((entry) => Boolean(entry.rerankerScorePath)), true);
        assert.equal(payload.index.entries.some((entry) => entry.shadowReranker?.disagreesWithHeuristic === true), true);

        assert.match(payload.historyDir, /structure-rank-v1-shadow-history$/);
        assert.equal(payload.history.entries.length, 1);
        assert.equal(payload.history.entries[0].songId, "song-shadow");
        assert.equal(payload.history.entries[0].snapshotId, "shadow-live");
        assert.equal(payload.history.entries[0].disagreement, true);
        assert.equal(payload.runtimeWindow.sampledEntries, 1);
        assert.equal(payload.runtimeWindow.disagreementCount, 1);
        assert.equal(payload.runtimeWindow.highConfidenceDisagreementCount, 1);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("runtime structure shadow reranker consumes proposal warning features from candidate sidecars", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-shadow-runtime-proposal-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import {
                buildStructureCandidateId,
                markSelectedStructureCandidate,
                saveStructureCandidateSnapshot,
                structureCandidateManifestPath,
                structureCandidateRerankerScorePath,
            } from "./dist/memory/candidates.js";
            import { runStructureRerankerShadowScoring } from "./dist/pipeline/structureShadowReranker.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.structureRerankerShadowEnabled = true;
            config.structureRerankerShadowSnapshot = "shadow-live";

            const modelPath = path.join(config.outputDir, "_system", "ml", "evaluations", "structure-rank-v1", "shadow-live", "shadow-reranker-model.json");
            fs.mkdirSync(path.dirname(modelPath), { recursive: true });
            fs.writeFileSync(modelPath, JSON.stringify({
                snapshotId: "shadow-live",
                featureNames: [
                    "bias",
                    "structureScore",
                    "proposalWorker:learned_symbolic",
                    "proposalNormalizationWarningCount",
                    "proposalRoleCollapseWarningCount",
                    "hasProposalRoleCollapseWarnings"
                ],
                weights: [
                    { feature: "bias", weight: 0 },
                    { feature: "structureScore", weight: 0.2 },
                    { feature: "proposalWorker:learned_symbolic", weight: 0.35 },
                    { feature: "proposalNormalizationWarningCount", weight: 0.7 },
                    { feature: "proposalRoleCollapseWarningCount", weight: 1.4 },
                    { feature: "hasProposalRoleCollapseWarnings", weight: 0.9 }
                ],
                calibratedTemperature: 1,
            }, null, 2));

            const executionPlan = {
                workflow: "symbolic_only",
                composeWorker: "music21",
                selectedModels: [
                    { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                ],
            };
            const trioPlan = {
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
                    {
                        sectionId: "s1",
                        role: "theme_a",
                        phraseFunction: "presentation",
                    },
                ],
            };

            const learnedCandidate = buildStructureCandidateId(1, executionPlan);
            const heuristicCandidate = buildStructureCandidateId(2, executionPlan);

            saveStructureCandidateSnapshot({
                songId: "song-proposal-shadow",
                candidateId: learnedCandidate,
                attempt: 1,
                meta: {
                    songId: "song-proposal-shadow",
                    prompt: "proposal-evidence runtime shadow",
                    promptHash: "hash-proposal-shadow",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: trioPlan,
                structureEvaluation: {
                    passed: true,
                    score: 72,
                    issues: ["lower raw score but learned lane evidence is richer"],
                    strengths: ["proposal evidence survived into the sidecar"],
                    metrics: {},
                },
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    generationMode: "plan_conditioned_trio_template",
                    confidence: 0.63,
                    normalizationWarnings: [
                        "section s1 role collapse: expected lead,counterline,bass got lead,bass",
                        "projection reused prior cadence gesture to stabilize the retry",
                    ],
                    summary: {
                        partCount: 3,
                        measureCount: 12,
                        noteCount: 36,
                    },
                },
                sectionArtifacts: [],
                evaluatedAt: "2026-04-17T08:02:00.000Z",
            });

            saveStructureCandidateSnapshot({
                songId: "song-proposal-shadow",
                candidateId: heuristicCandidate,
                attempt: 2,
                meta: {
                    songId: "song-proposal-shadow",
                    prompt: "proposal-evidence runtime shadow",
                    promptHash: "hash-proposal-shadow",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: trioPlan,
                structureEvaluation: {
                    passed: true,
                    score: 91,
                    issues: [],
                    strengths: ["high aggregate structure score"],
                    metrics: {},
                },
                sectionArtifacts: [],
                evaluatedAt: "2026-04-17T08:03:00.000Z",
            });

            markSelectedStructureCandidate("song-proposal-shadow", heuristicCandidate, 2, "heuristic remains authoritative during runtime shadow scoring");
            const result = runStructureRerankerShadowScoring("song-proposal-shadow");
            const learnedManifest = JSON.parse(fs.readFileSync(structureCandidateManifestPath("song-proposal-shadow", learnedCandidate), "utf8"));
            const learnedScore = JSON.parse(fs.readFileSync(structureCandidateRerankerScorePath("song-proposal-shadow", learnedCandidate), "utf8"));
            const heuristicScore = JSON.parse(fs.readFileSync(structureCandidateRerankerScorePath("song-proposal-shadow", heuristicCandidate), "utf8"));

            console.log(JSON.stringify({
                result,
                learnedCandidate,
                heuristicCandidate,
                learnedManifest,
                learnedScore,
                heuristicScore,
            }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.result.disagreement, true);
        assert.equal(payload.result.learnedTopCandidateId, payload.learnedCandidate);
        assert.equal(payload.result.heuristicTopCandidateId, payload.heuristicCandidate);
        assert.equal(payload.learnedScore.learned.rank, 1);
        assert.equal(payload.heuristicScore.learned.rank, 2);
        assert.equal(payload.learnedManifest.proposalEvidence.worker, "learned_symbolic");
        assert.equal(payload.learnedManifest.proposalEvidence.normalizationWarnings.length, 2);
        assert.equal(
            payload.learnedScore.disagreement.topFeatures.some((entry) => entry.feature === "proposalRoleCollapseWarningCount" || entry.feature === "hasProposalRoleCollapseWarnings"),
            true,
        );
        assert.match(payload.learnedScore.disagreement.reason ?? "", /proposalRoleCollapseWarningCount|hasProposalRoleCollapseWarnings/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("structure reranker promotion holds until the narrow-lane gate is ready and then promotes the learned top candidate", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-shadow-promotion-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import {
                buildStructureCandidateId,
                saveStructureCandidateSnapshot,
            } from "./dist/memory/candidates.js";
            import { resolveStructureRerankerPromotion } from "./dist/pipeline/structureRerankerPromotion.js";
            import { config } from "./dist/config.js";

            ${readyPromotionGateSeedScript}

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.structureRerankerShadowEnabled = true;
            config.structureRerankerShadowSnapshot = "shadow-live";
            config.structureRerankerPromotionEnabled = true;

            const modelPath = path.join(config.outputDir, "_system", "ml", "evaluations", "structure-rank-v1", "shadow-live", "shadow-reranker-model.json");
            fs.mkdirSync(path.dirname(modelPath), { recursive: true });
            fs.writeFileSync(modelPath, JSON.stringify({
                snapshotId: "shadow-live",
                featureNames: [
                    "bias",
                    "structureScore",
                    "sectionArtifactCoverage",
                    "hasCompositionPlan",
                    "hasSectionArtifacts",
                    "phraseBreathCueDensity"
                ],
                weights: [
                    { feature: "bias", weight: 0 },
                    { feature: "structureScore", weight: 0.2 },
                    { feature: "sectionArtifactCoverage", weight: 1.2 },
                    { feature: "hasCompositionPlan", weight: 0.8 },
                    { feature: "hasSectionArtifacts", weight: 0.8 },
                    { feature: "phraseBreathCueDensity", weight: 0.7 }
                ],
                calibratedTemperature: 1,
            }, null, 2));

            const executionPlan = {
                workflow: "symbolic_only",
                composeWorker: "music21",
                selectedModels: [
                    { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                ],
            };
            const trioPlan = {
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
                    {
                        sectionId: "s1",
                        role: "theme_a",
                        phraseFunction: "presentation",
                        phraseBreath: { pickupStartMeasure: 1, arrivalMeasure: 4 },
                    },
                    {
                        sectionId: "s2",
                        role: "cadence",
                        phraseFunction: "cadential",
                        phraseBreath: { arrivalMeasure: 8, releaseStartMeasure: 8 },
                    },
                ],
            };

            const learnedCandidate = buildStructureCandidateId(1, executionPlan);
            const heuristicCandidate = buildStructureCandidateId(2, executionPlan);

            saveStructureCandidateSnapshot({
                songId: "song-promotion",
                candidateId: learnedCandidate,
                attempt: 1,
                meta: {
                    songId: "song-promotion",
                    prompt: "promote learned trio candidate",
                    promptHash: "hash-promotion",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: trioPlan,
                structureEvaluation: {
                    passed: true,
                    score: 72,
                    issues: ["lower raw score but richer local evidence"],
                    strengths: ["phrase and section evidence survived"],
                    metrics: {},
                },
                sectionArtifacts: [
                    { sectionId: "s1", role: "theme_a", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [60, 62] },
                    { sectionId: "s2", role: "cadence", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [67, 65] },
                ],
                evaluatedAt: "2026-04-17T08:10:00.000Z",
            });

            saveStructureCandidateSnapshot({
                songId: "song-promotion",
                candidateId: heuristicCandidate,
                attempt: 2,
                meta: {
                    songId: "song-promotion",
                    prompt: "promote learned trio candidate",
                    promptHash: "hash-promotion",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: trioPlan,
                structureEvaluation: {
                    passed: true,
                    score: 91,
                    issues: [],
                    strengths: ["high aggregate structure score"],
                    metrics: {},
                },
                sectionArtifacts: [],
                evaluatedAt: "2026-04-17T08:11:00.000Z",
            });

            const blockedDecision = resolveStructureRerankerPromotion({
                songId: "song-promotion",
                currentCandidateId: heuristicCandidate,
                candidates: [
                    {
                        candidateId: learnedCandidate,
                        attempt: 1,
                        structureEvaluation: {
                            passed: true,
                            score: 72,
                            issues: ["lower raw score but richer local evidence"],
                            strengths: ["phrase and section evidence survived"],
                            metrics: {},
                        },
                    },
                    {
                        candidateId: heuristicCandidate,
                        attempt: 2,
                        structureEvaluation: {
                            passed: true,
                            score: 91,
                            issues: [],
                            strengths: ["high aggregate structure score"],
                            metrics: {},
                        },
                    },
                ],
                request: {
                    prompt: "promote learned trio candidate",
                    workflow: "symbolic_only",
                    compositionPlan: trioPlan,
                    targetInstrumentation: trioPlan.instrumentation,
                    qualityPolicy: {
                        targetStructureScore: 70,
                    },
                },
                executionPlan,
                compositionPlan: trioPlan,
                qualityPolicy: {
                    targetStructureScore: 70,
                },
                requireStructurePass: true,
                explicitStructureTarget: true,
            });

            seedReadyPromotionGate(config.outputDir);

            const readyDecision = resolveStructureRerankerPromotion({
                songId: "song-promotion",
                currentCandidateId: heuristicCandidate,
                candidates: [
                    {
                        candidateId: learnedCandidate,
                        attempt: 1,
                        structureEvaluation: {
                            passed: true,
                            score: 72,
                            issues: ["lower raw score but richer local evidence"],
                            strengths: ["phrase and section evidence survived"],
                            metrics: {},
                        },
                    },
                    {
                        candidateId: heuristicCandidate,
                        attempt: 2,
                        structureEvaluation: {
                            passed: true,
                            score: 91,
                            issues: [],
                            strengths: ["high aggregate structure score"],
                            metrics: {},
                        },
                    },
                ],
                request: {
                    prompt: "promote learned trio candidate",
                    workflow: "symbolic_only",
                    compositionPlan: trioPlan,
                    targetInstrumentation: trioPlan.instrumentation,
                    qualityPolicy: {
                        targetStructureScore: 70,
                    },
                },
                executionPlan,
                compositionPlan: trioPlan,
                qualityPolicy: {
                    targetStructureScore: 70,
                },
                requireStructurePass: true,
                explicitStructureTarget: true,
            });

            console.log(JSON.stringify({ blockedDecision, readyDecision, learnedCandidate, heuristicCandidate }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.blockedDecision, null);
        assert.equal(payload.readyDecision.candidateId, payload.learnedCandidate);
        assert.equal(payload.readyDecision.learnedTopCandidateId, payload.learnedCandidate);
        assert.equal(payload.readyDecision.heuristicTopCandidateId, payload.heuristicCandidate);
        assert.equal(payload.readyDecision.lane, "string_trio_symbolic");
        assert.equal(payload.readyDecision.confidence >= 0.7, true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("structure reranker promotion can promote the learned trio candidate from proposal-evidence features alone", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-shadow-promotion-proposal-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import {
                buildStructureCandidateId,
                saveStructureCandidateSnapshot,
            } from "./dist/memory/candidates.js";
            import { resolveStructureRerankerPromotion } from "./dist/pipeline/structureRerankerPromotion.js";
            import { config } from "./dist/config.js";

            ${readyPromotionGateSeedScript}

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.structureRerankerShadowEnabled = true;
            config.structureRerankerShadowSnapshot = "shadow-live";
            config.structureRerankerPromotionEnabled = true;
            seedReadyPromotionGate(config.outputDir);

            const modelPath = path.join(config.outputDir, "_system", "ml", "evaluations", "structure-rank-v1", "shadow-live", "shadow-reranker-model.json");
            fs.mkdirSync(path.dirname(modelPath), { recursive: true });
            fs.writeFileSync(modelPath, JSON.stringify({
                snapshotId: "shadow-live",
                featureNames: [
                    "bias",
                    "structureScore",
                    "proposalWorker:learned_symbolic",
                    "proposalLane:string_trio_symbolic",
                    "proposalGenerationMode:plan_conditioned_trio_template",
                    "proposalConfidence"
                ],
                weights: [
                    { feature: "bias", weight: 0 },
                    { feature: "structureScore", weight: 0.2 },
                    { feature: "proposalWorker:learned_symbolic", weight: 1.5 },
                    { feature: "proposalLane:string_trio_symbolic", weight: 0.8 },
                    { feature: "proposalGenerationMode:plan_conditioned_trio_template", weight: 0.5 },
                    { feature: "proposalConfidence", weight: 0.9 }
                ],
                calibratedTemperature: 1,
            }, null, 2));

            const executionPlan = {
                workflow: "symbolic_only",
                composeWorker: "music21",
                selectedModels: [
                    { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                ],
            };
            const trioPlan = {
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
                    {
                        sectionId: "s1",
                        role: "theme_a",
                        phraseFunction: "presentation",
                    },
                ],
            };

            const learnedCandidate = buildStructureCandidateId(1, executionPlan);
            const heuristicCandidate = buildStructureCandidateId(2, executionPlan);

            saveStructureCandidateSnapshot({
                songId: "song-promotion-proposal",
                candidateId: learnedCandidate,
                attempt: 1,
                meta: {
                    songId: "song-promotion-proposal",
                    prompt: "promote learned trio candidate from proposal evidence",
                    promptHash: "hash-promotion-proposal",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: trioPlan,
                structureEvaluation: {
                    passed: true,
                    score: 72,
                    issues: ["lower raw score but proposal evidence is richer"],
                    strengths: ["learned trio proposal retained lane metadata"],
                    metrics: {},
                },
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    generationMode: "plan_conditioned_trio_template",
                    confidence: 0.63,
                    summary: {
                        partCount: 3,
                        measureCount: 12,
                        noteCount: 36,
                    },
                },
                sectionArtifacts: [],
                evaluatedAt: "2026-04-17T08:14:00.000Z",
            });

            saveStructureCandidateSnapshot({
                songId: "song-promotion-proposal",
                candidateId: heuristicCandidate,
                attempt: 2,
                meta: {
                    songId: "song-promotion-proposal",
                    prompt: "promote learned trio candidate from proposal evidence",
                    promptHash: "hash-promotion-proposal",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: trioPlan,
                structureEvaluation: {
                    passed: true,
                    score: 91,
                    issues: [],
                    strengths: ["high aggregate structure score"],
                    metrics: {},
                },
                sectionArtifacts: [],
                evaluatedAt: "2026-04-17T08:15:00.000Z",
            });

            const decision = resolveStructureRerankerPromotion({
                songId: "song-promotion-proposal",
                currentCandidateId: heuristicCandidate,
                candidates: [
                    {
                        candidateId: learnedCandidate,
                        attempt: 1,
                        structureEvaluation: {
                            passed: true,
                            score: 72,
                            issues: ["lower raw score but proposal evidence is richer"],
                            strengths: ["learned trio proposal retained lane metadata"],
                            metrics: {},
                        },
                    },
                    {
                        candidateId: heuristicCandidate,
                        attempt: 2,
                        structureEvaluation: {
                            passed: true,
                            score: 91,
                            issues: [],
                            strengths: ["high aggregate structure score"],
                            metrics: {},
                        },
                    },
                ],
                request: {
                    prompt: "promote learned trio candidate from proposal evidence",
                    workflow: "symbolic_only",
                    compositionPlan: trioPlan,
                    targetInstrumentation: trioPlan.instrumentation,
                    qualityPolicy: {
                        targetStructureScore: 70,
                    },
                },
                executionPlan,
                compositionPlan: trioPlan,
                qualityPolicy: {
                    targetStructureScore: 70,
                },
                requireStructurePass: true,
                explicitStructureTarget: true,
            });

            console.log(JSON.stringify({ decision, learnedCandidate, heuristicCandidate }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.decision.candidateId, payload.learnedCandidate);
        assert.equal(payload.decision.learnedTopCandidateId, payload.learnedCandidate);
        assert.equal(payload.decision.heuristicTopCandidateId, payload.heuristicCandidate);
        assert.equal(payload.decision.lane, "string_trio_symbolic");
        assert.equal(payload.decision.confidence >= 0.9, true);
        assert.match(payload.decision.reason ?? "", /proposalWorker:learned_symbolic|proposalLane:string_trio_symbolic|proposalGenerationMode:plan_conditioned_trio_template/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("structure reranker promotion falls back to heuristic selection when the learned top misses the explicit target", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-shadow-promotion-guard-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import {
                buildStructureCandidateId,
                saveStructureCandidateSnapshot,
            } from "./dist/memory/candidates.js";
            import { resolveStructureRerankerPromotion } from "./dist/pipeline/structureRerankerPromotion.js";
            import { config } from "./dist/config.js";

            ${readyPromotionGateSeedScript}

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.structureRerankerShadowEnabled = true;
            config.structureRerankerShadowSnapshot = "shadow-live";
            config.structureRerankerPromotionEnabled = true;
            seedReadyPromotionGate(config.outputDir);

            const modelPath = path.join(config.outputDir, "_system", "ml", "evaluations", "structure-rank-v1", "shadow-live", "shadow-reranker-model.json");
            fs.mkdirSync(path.dirname(modelPath), { recursive: true });
            fs.writeFileSync(modelPath, JSON.stringify({
                snapshotId: "shadow-live",
                featureNames: [
                    "bias",
                    "structureScore",
                    "sectionArtifactCoverage",
                    "hasCompositionPlan",
                    "hasSectionArtifacts",
                    "phraseBreathCueDensity"
                ],
                weights: [
                    { feature: "bias", weight: 0 },
                    { feature: "structureScore", weight: 0.2 },
                    { feature: "sectionArtifactCoverage", weight: 1.2 },
                    { feature: "hasCompositionPlan", weight: 0.8 },
                    { feature: "hasSectionArtifacts", weight: 0.8 },
                    { feature: "phraseBreathCueDensity", weight: 0.7 }
                ],
                calibratedTemperature: 1,
            }, null, 2));

            const executionPlan = {
                workflow: "symbolic_only",
                composeWorker: "music21",
                selectedModels: [
                    { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                ],
            };
            const trioPlan = {
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
                    {
                        sectionId: "s1",
                        role: "theme_a",
                        phraseFunction: "presentation",
                        phraseBreath: { pickupStartMeasure: 1, arrivalMeasure: 4 },
                    },
                ],
            };

            const learnedCandidate = buildStructureCandidateId(1, executionPlan);
            const heuristicCandidate = buildStructureCandidateId(2, executionPlan);

            saveStructureCandidateSnapshot({
                songId: "song-promotion-guard",
                candidateId: learnedCandidate,
                attempt: 1,
                meta: {
                    songId: "song-promotion-guard",
                    prompt: "guard learned trio candidate",
                    promptHash: "hash-promotion-guard",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: trioPlan,
                structureEvaluation: {
                    passed: true,
                    score: 72,
                    issues: ["lower raw score but richer local evidence"],
                    strengths: ["phrase and section evidence survived"],
                    metrics: {},
                },
                sectionArtifacts: [
                    { sectionId: "s1", role: "theme_a", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [60, 62] },
                ],
                evaluatedAt: "2026-04-17T08:12:00.000Z",
            });

            saveStructureCandidateSnapshot({
                songId: "song-promotion-guard",
                candidateId: heuristicCandidate,
                attempt: 2,
                meta: {
                    songId: "song-promotion-guard",
                    prompt: "guard learned trio candidate",
                    promptHash: "hash-promotion-guard",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    source: "autonomy",
                },
                executionPlan,
                compositionPlan: trioPlan,
                structureEvaluation: {
                    passed: true,
                    score: 91,
                    issues: [],
                    strengths: ["high aggregate structure score"],
                    metrics: {},
                },
                sectionArtifacts: [],
                evaluatedAt: "2026-04-17T08:13:00.000Z",
            });

            const decision = resolveStructureRerankerPromotion({
                songId: "song-promotion-guard",
                currentCandidateId: heuristicCandidate,
                candidates: [
                    {
                        candidateId: learnedCandidate,
                        attempt: 1,
                        structureEvaluation: {
                            passed: true,
                            score: 72,
                            issues: ["lower raw score but richer local evidence"],
                            strengths: ["phrase and section evidence survived"],
                            metrics: {},
                        },
                    },
                    {
                        candidateId: heuristicCandidate,
                        attempt: 2,
                        structureEvaluation: {
                            passed: true,
                            score: 91,
                            issues: [],
                            strengths: ["high aggregate structure score"],
                            metrics: {},
                        },
                    },
                ],
                request: {
                    prompt: "guard learned trio candidate",
                    workflow: "symbolic_only",
                    compositionPlan: trioPlan,
                    targetInstrumentation: trioPlan.instrumentation,
                    qualityPolicy: {
                        targetStructureScore: 80,
                    },
                },
                executionPlan,
                compositionPlan: trioPlan,
                qualityPolicy: {
                    targetStructureScore: 80,
                },
                requireStructurePass: true,
                explicitStructureTarget: true,
            });

            console.log(JSON.stringify({ decision }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.decision, null);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});