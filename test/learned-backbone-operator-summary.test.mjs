import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const benchmarkPackVersion = "string_trio_symbolic_benchmark_pack_v1";
const promptPackVersion = "learned_symbolic_prompt_pack_v1";

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createTempRuntimeRoot(prefix) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    const projectionDir = path.join(tempRoot, "projection");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(projectionDir, { recursive: true });
    return { tempRoot, outputDir, logDir, projectionDir };
}

function buildCandidateEntry({
    outputDir,
    songId,
    candidateId,
    selected,
    worker,
    provider,
    model,
    attempt,
    evaluatedAt,
    workflow = "symbolic_only",
    proposalEvidence,
    revisionDirectives = [],
    shadowReranker,
}) {
    const manifestPath = path.join(outputDir, songId, "candidates", candidateId, "candidate-manifest.json");
    const midiPath = path.join(outputDir, songId, "candidates", candidateId, "composition.mid");
    fs.mkdirSync(path.dirname(midiPath), { recursive: true });
    fs.writeFileSync(midiPath, Buffer.from("MThd", "utf8"));
    writeJson(manifestPath, {
        version: 1,
        stage: "structure",
        songId,
        candidateId,
        attempt,
        selected,
        evaluatedAt,
        workflow,
        worker,
        provider,
        model,
        revisionDirectives,
        ...(proposalEvidence ? { proposalEvidence } : {}),
        ...(shadowReranker ? { shadowReranker } : {}),
        artifacts: {
            midi: midiPath,
        },
    });

    return {
        candidateId,
        attempt,
        stage: "structure",
        selected,
        workflow,
        worker,
        provider,
        model,
        passed: true,
        evaluatedAt,
        manifestPath,
        midiPath,
        ...(proposalEvidence ? { proposalEvidence } : {}),
        ...(shadowReranker ? { shadowReranker } : {}),
    };
}

async function seedLearnedBackboneBlindReviewResults(outputDir) {
    const { stdout } = await execFileAsync(process.execPath, [
        path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
        `--outputDir=${outputDir}`,
        "--snapshot=blind-pack-v1",
        "--labelSeed=fixed-seed",
    ], {
        cwd: repoRoot,
    });
    const packResult = JSON.parse(stdout.trim());
    const answerKey = JSON.parse(fs.readFileSync(packResult.paths.answerKeyPath, "utf8"));
    const resultsPayload = JSON.parse(fs.readFileSync(packResult.paths.resultsPath, "utf8"));
    resultsPayload.results = answerKey.entries.map((entry, index) => ({
        entryId: entry.entryId,
        winnerLabel: entry.songId === "song-a"
            ? entry.learned.label
            : entry.songId === "song-b"
                ? entry.baseline.label
                : "tie",
        reviewedAt: `2026-04-19T0${index + 1}:00:00.000Z`,
        reviewerId: "operator-a",
    }));
    writeJson(packResult.paths.resultsPath, resultsPayload);
}

async function seedActiveLearnedBackboneBlindReviewPack(outputDir, snapshot = "active-pack-v1") {
    const { stdout } = await execFileAsync(process.execPath, [
        path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
        `--outputDir=${outputDir}`,
        `--snapshot=${snapshot}`,
        "--labelSeed=fixed-seed",
    ], {
        cwd: repoRoot,
    });
    return JSON.parse(stdout.trim());
}

function writeManifest({ outputDir, songId, approvalStatus, appealScore, updatedAt, reviewFeedback = {} }) {
    writeJson(path.join(outputDir, songId, "manifest.json"), {
        songId,
        state: "DONE",
        approvalStatus,
        ...(typeof appealScore === "number"
            ? {
                reviewFeedback: {
                    appealScore,
                    ...reviewFeedback,
                },
            }
            : (Object.keys(reviewFeedback).length > 0 ? { reviewFeedback } : {})),
        meta: {
            songId,
            prompt: songId,
            form: "string trio miniature",
            workflow: "symbolic_only",
            source: "autonomy",
            autonomyRunId: `run-${songId}`,
            promptHash: `hash-${songId}`,
            createdAt: updatedAt,
            updatedAt,
        },
        artifacts: {
            midi: `outputs/${songId}/composition.mid`,
        },
        selfAssessment: {
            qualityScore: 0.84,
        },
        structureEvaluation: {
            passed: true,
            score: 84,
            issues: [],
            strengths: [],
            metrics: {},
        },
        qualityControl: {
            selectedAttempt: 1,
            attempts: [],
        },
        stateHistory: [
            { state: "IDLE", timestamp: updatedAt },
            { state: "DONE", timestamp: updatedAt },
        ],
        updatedAt,
    });
}

function seedLearnedBackboneBenchmarkFixtures(outputDir) {
    writeManifest({
        outputDir,
        songId: "song-a",
        approvalStatus: "approved",
        appealScore: 0.93,
        updatedAt: "2026-04-18T09:00:00.000Z",
        reviewFeedback: {
            reviewRubricVersion: "approval_review_rubric_v1",
            strongestDimension: "phrase_breath",
        },
    });
    writeJson(path.join(outputDir, "song-a", "candidates", "index.json"), {
        version: 1,
        songId: "song-a",
        updatedAt: "2026-04-18T09:00:00.000Z",
        selectedCandidateId: "learned-a",
        selectedAttempt: 1,
        selectionStopReason: "learned reranker promoted attempt 1 over heuristic attempt 1 in string_trio_symbolic lane",
        rerankerPromotion: {
            appliedAt: "2026-04-18T09:00:00.000Z",
            lane: "string_trio_symbolic",
            snapshotId: "shadow-live",
            confidence: 0.81,
            heuristicTopCandidateId: "baseline-a",
            learnedTopCandidateId: "learned-a",
        },
        entries: [
            buildCandidateEntry({
                outputDir,
                songId: "song-a",
                candidateId: "baseline-a",
                selected: false,
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T08:55:00.000Z",
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-a",
                candidateId: "learned-a",
                selected: true,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T09:00:00.000Z",
                shadowReranker: {
                    snapshotId: "shadow-live",
                    evaluatedAt: "2026-04-18T09:00:00.000Z",
                    heuristicRank: 2,
                    heuristicScore: 0.74,
                    learnedRank: 1,
                    learnedScore: 0.89,
                    learnedConfidence: 0.81,
                    disagreesWithHeuristic: true,
                },
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "cadence_clarity_reference",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=cadence-a",
                    generationMode: "plan_conditioned_trio_template",
                },
            }),
        ],
    });

    writeManifest({
        outputDir,
        songId: "song-b",
        approvalStatus: "rejected",
        appealScore: 0.31,
        updatedAt: "2026-04-18T08:00:00.000Z",
        reviewFeedback: {
            reviewRubricVersion: "approval_review_rubric_v1",
            weakestDimension: "cadence_release",
            note: "Baseline cadence still felt too static.",
        },
    });
    writeJson(path.join(outputDir, "song-b", "candidates", "index.json"), {
        version: 1,
        songId: "song-b",
        updatedAt: "2026-04-18T08:00:00.000Z",
        selectedCandidateId: "baseline-b",
        selectedAttempt: 1,
        selectionStopReason: "hybrid candidate pool kept music21 over learned_symbolic on cadence_clarity_reference",
        entries: [
            buildCandidateEntry({
                outputDir,
                songId: "song-b",
                candidateId: "baseline-b",
                selected: true,
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T08:00:00.000Z",
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-b",
                candidateId: "learned-b",
                selected: false,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T07:59:00.000Z",
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "cadence_clarity_reference",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=cadence-a",
                    generationMode: "plan_conditioned_trio_template",
                },
            }),
        ],
    });

    writeManifest({
        outputDir,
        songId: "song-c",
        approvalStatus: "pending",
        updatedAt: "2026-04-18T10:00:00.000Z",
    });
    writeJson(path.join(outputDir, "song-c", "candidates", "index.json"), {
        version: 1,
        songId: "song-c",
        updatedAt: "2026-04-18T10:00:00.000Z",
        selectedCandidateId: "learned-c-rewrite",
        selectedAttempt: 1,
        selectionStopReason: "selected same-attempt localized rewrite branch after reviewing 4 whole-piece candidates",
        entries: [
            buildCandidateEntry({
                outputDir,
                songId: "song-c",
                candidateId: "baseline-c",
                selected: false,
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T09:59:00.000Z",
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-c",
                candidateId: "baseline-c-2",
                selected: false,
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T09:59:30.000Z",
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-c",
                candidateId: "learned-c",
                selected: false,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T09:59:45.000Z",
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "localized_rewrite_probe",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=localized-c",
                    generationMode: "plan_conditioned_trio_template",
                },
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-c",
                candidateId: "learned-c-2",
                selected: false,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T09:59:50.000Z",
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "localized_rewrite_probe",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=localized-c",
                    generationMode: "plan_conditioned_trio_template",
                },
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-c",
                candidateId: "baseline-c-rewrite",
                selected: false,
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T09:59:55.000Z",
                revisionDirectives: [
                    {
                        kind: "clarify_phrase_rhetoric",
                        sectionIds: ["s2"],
                    },
                ],
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-c",
                candidateId: "learned-c-rewrite",
                selected: true,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T10:00:00.000Z",
                revisionDirectives: [
                    {
                        kind: "clarify_phrase_rhetoric",
                        sectionIds: ["s2"],
                    },
                ],
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "localized_rewrite_probe",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=localized-c",
                    generationMode: "targeted_section_rewrite",
                },
            }),
        ],
    });
}

function seedCustomSearchBudgetFixtures(outputDir) {
    writeManifest({
        outputDir,
        songId: "song-custom-pure",
        approvalStatus: "pending",
        updatedAt: "2026-04-18T11:00:00.000Z",
    });
    writeJson(path.join(outputDir, "song-custom-pure", "candidates", "index.json"), {
        version: 1,
        songId: "song-custom-pure",
        updatedAt: "2026-04-18T11:00:00.000Z",
        selectedCandidateId: "learned-custom-pure",
        selectedAttempt: 1,
        selectionStopReason: "selected learned custom whole-piece candidate after reviewing 3 whole-piece candidates",
        entries: [
            buildCandidateEntry({
                outputDir,
                songId: "song-custom-pure",
                candidateId: "baseline-custom-pure",
                selected: false,
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T10:59:00.000Z",
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-custom-pure",
                candidateId: "learned-custom-pure-alt",
                selected: false,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T10:59:20.000Z",
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "custom_budget_probe",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=custom-pure",
                    generationMode: "plan_conditioned_trio_template",
                },
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-custom-pure",
                candidateId: "learned-custom-pure",
                selected: true,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T11:00:00.000Z",
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "custom_budget_probe",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=custom-pure",
                    generationMode: "plan_conditioned_trio_template",
                },
            }),
        ],
    });

    writeManifest({
        outputDir,
        songId: "song-custom-mixed",
        approvalStatus: "pending",
        updatedAt: "2026-04-18T11:30:00.000Z",
    });
    writeJson(path.join(outputDir, "song-custom-mixed", "candidates", "index.json"), {
        version: 1,
        songId: "song-custom-mixed",
        updatedAt: "2026-04-18T11:30:00.000Z",
        selectedCandidateId: "learned-custom-mixed-rewrite",
        selectedAttempt: 1,
        selectionStopReason: "selected same-attempt localized rewrite branch after reviewing 3 whole-piece candidates",
        entries: [
            buildCandidateEntry({
                outputDir,
                songId: "song-custom-mixed",
                candidateId: "baseline-custom-mixed",
                selected: false,
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T11:29:00.000Z",
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-custom-mixed",
                candidateId: "learned-custom-mixed",
                selected: false,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T11:29:20.000Z",
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "custom_budget_probe",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=custom-mixed",
                    generationMode: "plan_conditioned_trio_template",
                },
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-custom-mixed",
                candidateId: "learned-custom-mixed-2",
                selected: false,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T11:29:30.000Z",
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "custom_budget_probe",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=custom-mixed",
                    generationMode: "plan_conditioned_trio_template",
                },
            }),
            buildCandidateEntry({
                outputDir,
                songId: "song-custom-mixed",
                candidateId: "learned-custom-mixed-rewrite",
                selected: true,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T11:30:00.000Z",
                revisionDirectives: [
                    {
                        kind: "clarify_phrase_rhetoric",
                        sectionIds: ["bridge-a"],
                    },
                ],
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "custom_budget_probe",
                    promptPackVersion,
                    planSignature: "lane=string_trio_symbolic|sig=custom-mixed",
                    generationMode: "targeted_section_rewrite",
                },
            }),
        ],
    });
}

function seedSupplementalPendingBenchmarkFixture(outputDir, songId = "song-late") {
    writeManifest({
        outputDir,
        songId,
        approvalStatus: "pending",
        updatedAt: "2026-04-18T12:00:00.000Z",
    });
    writeJson(path.join(outputDir, songId, "candidates", "index.json"), {
        version: 1,
        songId,
        updatedAt: "2026-04-18T12:00:00.000Z",
        selectedCandidateId: `${songId}-baseline`,
        selectedAttempt: 1,
        selectionStopReason: "hybrid candidate pool kept music21 over learned_symbolic on counterline_dialogue_probe",
        entries: [
            buildCandidateEntry({
                outputDir,
                songId,
                candidateId: `${songId}-baseline`,
                selected: true,
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T12:00:00.000Z",
            }),
            buildCandidateEntry({
                outputDir,
                songId,
                candidateId: `${songId}-learned`,
                selected: false,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: "2026-04-18T11:59:00.000Z",
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion,
                    benchmarkId: "counterline_dialogue_probe",
                    promptPackVersion,
                    planSignature: `lane=string_trio_symbolic|sig=${songId}-counterline`,
                    generationMode: "plan_conditioned_trio_template",
                },
            }),
        ],
    });
}

async function importRuntimeModules() {
    const [{ buildOperatorSummary }, { config }] = await Promise.all([
        import("../dist/operator/summary.js"),
        import("../dist/config.js"),
    ]);
    return { buildOperatorSummary, config };
}

test("operator summary surfaces learned backbone benchmark aggregate on overseer payload", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-learned-backbone-operator-");

    try {
        seedLearnedBackboneBenchmarkFixtures(outputDir);
        await seedLearnedBackboneBlindReviewResults(outputDir);

        const { buildOperatorSummary, config } = await importRuntimeModules();
        const originalOutputDir = config.outputDir;
        const originalLogDir = config.logDir;
        config.outputDir = outputDir;
        config.logDir = logDir;

        try {
            const payload = await buildOperatorSummary({ source: "local-runtime", windowHours: 24 });
            const benchmark = payload.overseer.learnedBackboneBenchmark;

            assert.equal(benchmark.runCount, 3);
            assert.equal(benchmark.pairedRunCount, 3);
            assert.equal(benchmark.reviewedRunCount, 2);
            assert.equal(benchmark.pendingReviewCount, 1);
            assert.equal(benchmark.reviewSampleStatus.status, "directional_only");
            assert.equal(benchmark.reviewSampleStatus.remainingReviewedRunCountForScreening, 18);
            assert.equal(benchmark.reviewSampleStatus.remainingReviewedRunCountForPromotion, 28);
            assert.equal(benchmark.reviewSampleStatus.remainingReviewedDisagreementCountForPromotion, 9);
            assert.equal(benchmark.disagreementSummary.disagreementRunCount, 1);
            assert.equal(benchmark.disagreementSummary.reviewedDisagreementCount, 1);
            assert.equal(benchmark.disagreementSummary.promotionAppliedCount, 1);
            assert.equal(benchmark.disagreementSummary.learnedSelectedWithoutPromotionCount, 1);
            assert.equal(benchmark.retryLocalizationStability.status, "stable");
            assert.equal(benchmark.retryLocalizationStability.retryingRunCount, 1);
            assert.equal(benchmark.blindPreference.available, true);
            assert.equal(benchmark.blindPreference.winRate, 0.5);
            assert.equal(benchmark.blindPreference.reviewedPairCount, 3);
            assert.equal(benchmark.blindPreference.decisivePairCount, 2);
            assert.equal(benchmark.blindPreference.tieCount, 1);
            assert.equal(benchmark.shortlistBlindPreference.available, true);
            assert.equal(benchmark.shortlistBlindPreference.winRate, 1);
            assert.equal(benchmark.shortlistBlindPreference.reviewedPairCount, 1);
            assert.equal(benchmark.shortlistBlindPreference.decisivePairCount, 1);
            assert.equal(benchmark.shortlistBlindPreference.latestReviewedAt, "2026-04-19T02:00:00.000Z");
            assert.equal(benchmark.reviewedTop1Accuracy.available, true);
            assert.equal(benchmark.reviewedTop1Accuracy.selectedTop1Accuracy, 1);
            assert.equal(benchmark.reviewedTop1Accuracy.decisiveReviewedPairCount, 2);
            assert.equal(benchmark.reviewedTop1Accuracy.correctSelectionCount, 2);
            assert.equal(benchmark.reviewedTop1Accuracy.promotedTop1Accuracy, 1);
            assert.equal(benchmark.pairedSelectionOutcomes.reviewedManifestCount, 2);
            assert.equal(benchmark.pairedSelectionOutcomes.promotedReviewedCount, 1);
            assert.equal(benchmark.pairedSelectionOutcomes.heuristicReviewedCount, 1);
            assert.equal(benchmark.pairedSelectionOutcomes.promotedApprovalRate, 1);
            assert.equal(benchmark.pairedSelectionOutcomes.heuristicApprovalRate, 0);
            assert.equal(benchmark.pairedSelectionOutcomes.promotedAverageAppealScore, 0.93);
            assert.equal(benchmark.pairedSelectionOutcomes.heuristicAverageAppealScore, 0.31);
            assert.equal(benchmark.selectedWorkerOutcomes.learned_symbolic.runCount, 2);
            assert.equal(benchmark.selectedWorkerOutcomes.learned_symbolic.reviewedRunCount, 1);
            assert.equal(benchmark.selectedWorkerOutcomes.learned_symbolic.pendingReviewCount, 1);
            assert.equal(benchmark.selectedWorkerOutcomes.learned_symbolic.approvedCount, 1);
            assert.equal(benchmark.selectedWorkerOutcomes.learned_symbolic.approvalRate, 1);
            assert.equal(benchmark.selectedWorkerOutcomes.learned_symbolic.averageAppealScore, 0.93);
            assert.equal(benchmark.selectedWorkerOutcomes.music21.runCount, 1);
            assert.equal(benchmark.selectedWorkerOutcomes.music21.reviewedRunCount, 1);
            assert.equal(benchmark.selectedWorkerOutcomes.music21.rejectedCount, 1);
            assert.equal(benchmark.selectedWorkerOutcomes.music21.approvalRate, 0);
            assert.equal(benchmark.reviewQueue.pendingBlindReviewCount, 0);
            assert.equal(benchmark.reviewQueue.pendingShortlistReviewCount, 0);
            assert.equal(benchmark.reviewQueue.latestPendingAt, null);
            assert.deepEqual(benchmark.reviewQueue.recentPendingRows, []);
            assert.equal(benchmark.reviewPacks.matchedPackCount, 1);
            assert.equal(benchmark.reviewPacks.activePackCount, 0);
            assert.equal(benchmark.reviewPacks.pendingDecisionCount, 0);
            assert.equal(benchmark.reviewPacks.completedDecisionCount, 3);
            assert.equal(benchmark.reviewPacks.latestReviewedAt, "2026-04-19T03:00:00.000Z");
            assert.deepEqual(benchmark.reviewPacks.recentActivePacks, []);
            assert.equal(benchmark.searchBudgetCounts.S1, 2);
            assert.equal(benchmark.searchBudgetCounts.S4, 1);
            const s1BudgetRow = benchmark.searchBudgetRows.find((row) => row.searchBudgetLevel === "S1");
            const s4BudgetRow = benchmark.searchBudgetRows.find((row) => row.searchBudgetLevel === "S4");
            assert.ok(s1BudgetRow);
            assert.ok(s4BudgetRow);
            assert.equal(s1BudgetRow.wholePieceCandidateCount, 2);
            assert.equal(s1BudgetRow.selectedTop1Accuracy, 1);
            assert.equal(s1BudgetRow.blindPreferenceWinRate, 0.5);
            assert.equal(s4BudgetRow.wholePieceCandidateCount, 4);
            assert.equal(s4BudgetRow.pendingReviewCount, 1);
            assert.equal(s4BudgetRow.selectedTop1Accuracy, null);
            assert.equal(benchmark.promotionGate.status, "experimental");
            assert.equal(benchmark.promotionGate.signal, "positive");
            assert.equal(benchmark.promotionGate.minimumReviewedSelectedInShortlistRate, 0.6);
            assert.equal(benchmark.promotionGate.reviewedSelectedInShortlistRate, 0.5);
            assert.equal(benchmark.promotionGate.reviewedSelectedTop1Rate, 0.5);
            assert.equal(benchmark.promotionGate.meetsReviewedSelectedInShortlistMinimum, false);
            assert.equal(benchmark.promotionGate.retryLocalizationStable, true);
            assert.ok(benchmark.promotionGate.blockers.includes("reviewed_runs_below_floor"));
            assert.ok(benchmark.promotionGate.blockers.includes("shortlist_quality_below_floor"));
            assert.equal(benchmark.promotionAdvantage.reviewedManifestCount, 2);
            assert.equal(benchmark.promotionAdvantage.promotedReviewedCount, 1);
            assert.equal(benchmark.promotionAdvantage.heuristicReviewedCount, 1);
            assert.equal(benchmark.promotionAdvantage.signal, "insufficient_data");
            assert.equal(benchmark.promotionAdvantage.approvalRateDelta, 1);
            assert.equal(benchmark.promotionAdvantage.appealScoreDelta, 0.62);
            assert.deepEqual(benchmark.configSnapshot.benchmarkIds, ["cadence_clarity_reference", "localized_rewrite_probe"]);
            assert.equal(benchmark.coverageRows.length, 2);
            const cadenceCoverageRow = benchmark.coverageRows.find((row) => row.benchmarkId === "cadence_clarity_reference");
            const localizedCoverageRow = benchmark.coverageRows.find((row) => row.benchmarkId === "localized_rewrite_probe");
            assert.ok(cadenceCoverageRow);
            assert.ok(localizedCoverageRow);
            assert.equal(cadenceCoverageRow.runCount, 2);
            assert.equal(cadenceCoverageRow.reviewedRunCount, 2);
            assert.equal(cadenceCoverageRow.approvalRate, 0.5);
            assert.equal(cadenceCoverageRow.averageAppealScore, 0.62);
            assert.equal(cadenceCoverageRow.selectedWorkerCounts.learned_symbolic, 1);
            assert.equal(cadenceCoverageRow.selectedWorkerCounts.music21, 1);
            assert.equal(localizedCoverageRow.runCount, 1);
            assert.equal(localizedCoverageRow.pendingReviewCount, 1);
            assert.equal(localizedCoverageRow.generationModeCounts.targeted_section_rewrite, 1);
            assert.equal(benchmark.topFailureModes[0].failureMode, "cadence_release");
            assert.equal(benchmark.recentRunRows[0].songId, "song-c");
            assert.equal(benchmark.recentRunRows[0].selectionMode, "learned_selected");
            assert.equal(benchmark.recentRunRows[0].searchBudgetLevel, "S4");
            assert.equal(benchmark.recentRunRows[0].wholePieceCandidateCount, 4);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark lane=string_trio_symbolic pack=string_trio_symbolic_benchmark_pack_v1 runs=3 paired=3 reviewed=2 pendingReview=1 approvalRate=0\.50 avgAppeal=0\.62 top1Accuracy=1\.00 budgets=S1:2,S4:1 sampleStatus=directional_only screeningGap=18 promotionReviewedGap=28 promotionDisagreementGap=9 disagreements=1 reviewedDisagreements=1 promotionSignal=insufficient_data retryStatus=stable targetedRate=1\.00 driftRate=0\.00/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark config lane=string_trio_symbolic benchmarkIds=cadence_clarity_reference,localized_rewrite_probe/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark blindPreference available=yes winRate=0\.50 reviewedPairs=3 decisivePairs=2 learnedWins=1 baselineWins=1 ties=1 latestReviewedAt=2026-04-19T03:00:00.000Z/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark shortlistBlindPreference available=yes winRate=1\.00 reviewedPairs=1 decisivePairs=1 learnedWins=1 baselineWins=0 ties=0 latestReviewedAt=2026-04-19T02:00:00.000Z/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark top1Accuracy available=yes selected=1\.00 decisivePairs=2 correctSelections=2 learnedSelected=1\.00 baselineSelected=1\.00 promoted=1\.00 latestReviewedAt=2026-04-19T03:00:00.000Z/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark pairedSelection reviewed=2 promotedReviewed=1 heuristicReviewed=1 promotedApproval=1\.00 heuristicApproval=0\.00 promotedAppeal=0\.93 heuristicAppeal=0\.31/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark selectedWorkerOutcome worker=learned_symbolic runs=2 reviewed=1 pendingReview=1 approved=1 rejected=0 approvalRate=1\.00 avgAppeal=0\.93/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark selectedWorkerOutcome worker=music21 runs=1 reviewed=1 pendingReview=0 approved=0 rejected=1 approvalRate=0\.00 avgAppeal=0\.31/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark coverage benchmark=cadence_clarity_reference runs=2 paired=2 reviewed=2 pendingReview=0 approvalRate=0\.50 avgAppeal=0\.62 selectedWorkers=learned_symbolic:1,music21:1 generationModes=plan_conditioned_trio_template:2 lastObserved=2026-04-18T09:00:00.000Z/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark reviewQueue pendingBlind=0 pendingShortlist=0 latestPendingAt=-/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark reviewPacks matched=1 active=0 pendingDecisions=0 completedDecisions=3 latestGeneratedAt=.* latestReviewedAt=2026-04-19T03:00:00.000Z/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark searchBudget=S1 candidates=2 runs=2 reviewed=2 pendingReview=0 approvalRate=0\.50 blindPreference=0\.50 top1Accuracy=1\.00 decisivePairs=2 correctSelections=2 lastObserved=2026-04-18T09:00:00.000Z/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark searchBudget=S4 candidates=4 runs=1 reviewed=0 pendingReview=1 approvalRate=\? blindPreference=\? top1Accuracy=\? decisivePairs=0 correctSelections=0 lastObserved=2026-04-18T10:00:00.000Z/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark promotionGate status=experimental signal=positive reviewedFloor=no disagreementFloor=no shortlistFloor=no retryStable=yes blindPreference=yes reviewedInTopK=0\.50 reviewedTop1=0\.50 shortlistMin=0\.60 approvalDelta=1\.00 appealDelta=0\.62 blockers=reviewed_runs_below_floor,reviewed_disagreements_below_floor,shortlist_quality_below_floor/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark failureMode=cadence_release count=1/);
        } finally {
            config.outputDir = originalOutputDir;
            config.logDir = originalLogDir;
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("operator summary distinguishes custom whole-piece and mixed search budgets on payload and artifacts", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-learned-backbone-custom-operator-");

    try {
        seedCustomSearchBudgetFixtures(outputDir);

        const { buildOperatorSummary, config } = await importRuntimeModules();
        const originalOutputDir = config.outputDir;
        const originalLogDir = config.logDir;
        config.outputDir = outputDir;
        config.logDir = logDir;

        try {
            const payload = await buildOperatorSummary({ source: "local-runtime", windowHours: 24 });
            const benchmark = payload.overseer.learnedBackboneBenchmark;

            assert.equal(benchmark.runCount, 2);
            assert.equal(benchmark.searchBudgetCounts.custom, 2);
            assert.equal(benchmark.searchBudgetRows.length, 2);

            const customPureRow = benchmark.searchBudgetRows.find((row) => row.searchBudgetDescriptor === "custom(3)");
            const customMixedRow = benchmark.searchBudgetRows.find((row) => row.searchBudgetDescriptor === "custom(3+1)");
            assert.ok(customPureRow);
            assert.ok(customMixedRow);
            assert.equal(customPureRow.searchBudgetLevel, "custom");
            assert.equal(customPureRow.wholePieceCandidateCount, 3);
            assert.equal(customPureRow.localizedRewriteBranchCount, 0);
            assert.equal(customMixedRow.searchBudgetLevel, "custom");
            assert.equal(customMixedRow.wholePieceCandidateCount, 3);
            assert.equal(customMixedRow.localizedRewriteBranchCount, 1);

            assert.equal(benchmark.reviewQueue.pendingBlindReviewCount, 2);
            assert.equal(benchmark.reviewQueue.recentPendingRows[0].songId, "song-custom-mixed");
            assert.equal(benchmark.reviewQueue.recentPendingRows[0].searchBudgetDescriptor, "custom(3+1)");
            assert.equal(benchmark.reviewQueue.recentPendingRows[1].songId, "song-custom-pure");
            assert.equal(benchmark.reviewQueue.recentPendingRows[1].searchBudgetDescriptor, "custom(3)");

            assert.equal(Array.isArray(benchmark.reviewPackActions), true);
            assert.equal(benchmark.reviewPackActions.length, 3);
            assert.equal(benchmark.reviewPackActions[0].reviewTarget, "pairwise");
            assert.equal(benchmark.reviewPackActions[0].searchBudget, null);
            assert.equal(benchmark.reviewPackActions[0].pendingPairCount, 2);
            assert.equal(benchmark.reviewPackActions[0].command, "npm run ml:review-pack:learned-backbone -- --pendingOnly --reviewTarget=pairwise");
            assert.equal(benchmark.reviewPackActions[1].reviewTarget, "all");
            assert.equal(benchmark.reviewPackActions[1].searchBudget, "custom(3)");
            assert.equal(benchmark.reviewPackActions[1].pendingPairCount, 1);
            assert.equal(benchmark.reviewPackActions[1].command, "npm run ml:review-pack:learned-backbone -- --pendingOnly --searchBudget=\"custom(3)\"");
            assert.equal(benchmark.reviewPackActions[2].reviewTarget, "all");
            assert.equal(benchmark.reviewPackActions[2].searchBudget, "custom(3+1)");
            assert.equal(benchmark.reviewPackActions[2].pendingPairCount, 1);
            assert.equal(benchmark.reviewPackActions[2].command, "npm run ml:review-pack:learned-backbone -- --pendingOnly --searchBudget=\"custom(3+1)\"");

            assert.equal(benchmark.recentRunRows[0].songId, "song-custom-mixed");
            assert.equal(benchmark.recentRunRows[0].searchBudgetDescriptor, "custom(3+1)");
            assert.equal(benchmark.recentRunRows[1].songId, "song-custom-pure");
            assert.equal(benchmark.recentRunRows[1].searchBudgetDescriptor, "custom(3)");

            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark searchBudget=custom\(3\) candidates=3 runs=1/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark searchBudget=custom\(3\+1\) candidates=3 runs=1/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark reviewQueue song=song-custom-mixed .* searchBudget=custom\(3\+1\) /);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark reviewPackAction target=all searchBudget=custom\(3\) pendingOnly=yes pendingPairs=1 priority=after_general_queue command=npm run ml:review-pack:learned-backbone -- --pendingOnly --searchBudget=\\"custom\(3\)\\"/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark reviewPackAction target=all searchBudget=custom\(3\+1\) pendingOnly=yes pendingPairs=1 priority=after_previous_budget_focus command=npm run ml:review-pack:learned-backbone -- --pendingOnly --searchBudget=\\"custom\(3\+1\)\\"/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark recent song=song-custom-pure benchmark=custom_budget_probe searchBudget=custom\(3\)/);
        } finally {
            config.outputDir = originalOutputDir;
            config.logDir = originalLogDir;
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("operator summary surfaces active learned backbone review pack worksheet commands", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-learned-backbone-active-pack-");

    try {
        seedLearnedBackboneBenchmarkFixtures(outputDir);
        await seedActiveLearnedBackboneBlindReviewPack(outputDir);

        const { buildOperatorSummary, config } = await importRuntimeModules();
        const originalOutputDir = config.outputDir;
        const originalLogDir = config.logDir;
        config.outputDir = outputDir;
        config.logDir = logDir;

        try {
            const payload = await buildOperatorSummary({ source: "local-runtime", windowHours: 24 });
            const benchmark = payload.overseer.learnedBackboneBenchmark;

            assert.equal(benchmark.reviewQueue.pendingBlindReviewCount, 3);
            assert.equal(benchmark.reviewPacks.matchedPackCount, 1);
            assert.equal(benchmark.reviewPacks.activePackCount, 1);
            assert.equal(benchmark.reviewPacks.pendingDecisionCount, 3);
            assert.equal(benchmark.reviewPacks.completedDecisionCount, 0);
            assert.equal(benchmark.reviewPacks.recentActivePacks.length, 1);
            assert.equal(benchmark.reviewPacks.recentActivePacks[0].packId, "active-pack-v1");
            assert.equal(benchmark.reviewPacks.recentActivePacks[0].reviewSheetPath, "outputs/_system/ml/review-packs/learned-backbone/active-pack-v1/review-sheet.csv");
            assert.equal(Array.isArray(benchmark.reviewPackActions), true);
            assert.equal(benchmark.reviewPackActions.length, 0);
            assert.equal(Array.isArray(benchmark.reviewPackRecordActions), true);
            assert.equal(benchmark.reviewPackRecordActions[0].packId, "active-pack-v1");
            assert.equal(benchmark.reviewPackRecordActions[0].pendingDecisionCount, 3);
            assert.equal(benchmark.reviewPackRecordActions[0].command, "npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs/_system/ml/review-packs/learned-backbone/active-pack-v1/review-sheet.csv");
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark reviewPack pack=active-pack-v1 .* reviewSheet=outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv recordCommand=npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv/);
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark reviewPackRecordAction pack=active-pack-v1 target=all pendingDecisions=3 pendingShortlist=1 reviewSheet=outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv priority=first command=npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv/);
        } finally {
            config.outputDir = originalOutputDir;
            config.logDir = originalLogDir;
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("operator summary surfaces supplemental learned backbone review pack actions when uncovered pending runs remain", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-learned-backbone-active-gap-");

    try {
        seedLearnedBackboneBenchmarkFixtures(outputDir);
        await seedActiveLearnedBackboneBlindReviewPack(outputDir);
        seedSupplementalPendingBenchmarkFixture(outputDir);

        const { buildOperatorSummary, config } = await importRuntimeModules();
        const originalOutputDir = config.outputDir;
        const originalLogDir = config.logDir;
        config.outputDir = outputDir;
        config.logDir = logDir;

        try {
            const payload = await buildOperatorSummary({ source: "local-runtime", windowHours: 24 });
            const benchmark = payload.overseer.learnedBackboneBenchmark;

            assert.equal(benchmark.reviewQueue.pendingBlindReviewCount, 4);
            assert.equal(benchmark.reviewPacks.activePackCount, 1);
            assert.equal(benchmark.reviewPacks.pendingDecisionCount, 3);
            assert.equal(Array.isArray(benchmark.reviewPackActions), true);
            assert.equal(benchmark.reviewPackActions.length, 1);
            assert.equal(benchmark.reviewPackActions[0].reviewTarget, "pairwise");
            assert.equal(benchmark.reviewPackActions[0].pendingPairCount, 1);
            assert.equal(benchmark.reviewPackActions[0].command, "npm run ml:review-pack:learned-backbone -- --pendingOnly --reviewTarget=pairwise");
            assert.equal(Array.isArray(benchmark.reviewPackRecordActions), true);
            assert.equal(benchmark.reviewPackRecordActions[0].packId, "active-pack-v1");
            assert.match(JSON.stringify(payload.artifacts), /learnedBackboneBenchmark reviewPackAction target=pairwise pendingOnly=yes pendingPairs=1 priority=first command=npm run ml:review-pack:learned-backbone -- --pendingOnly --reviewTarget=pairwise/);
        } finally {
            config.outputDir = originalOutputDir;
            config.logDir = originalLogDir;
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("project operator summary renders learned backbone benchmark section and artifact lines", async () => {
    const { tempRoot, outputDir, logDir, projectionDir } = createTempRuntimeRoot("axiom-learned-backbone-project-");

    try {
        seedLearnedBackboneBenchmarkFixtures(outputDir);
        await seedLearnedBackboneBlindReviewResults(outputDir);

        const express = (await import("express")).default;
        const healthRouter = (await import("../dist/routes/health.js")).default;
        const autonomyRouter = (await import("../dist/routes/autonomy.js")).default;
        const overseerRouter = (await import("../dist/routes/overseer.js")).default;
        const { config } = await import("../dist/config.js");
        const originalOutputDir = config.outputDir;
        const originalLogDir = config.logDir;
        config.outputDir = outputDir;
        config.logDir = logDir;

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: false }));
        app.use(healthRouter);
        app.get("/jobs", (_req, res) => {
            res.json([]);
        });
        app.use(autonomyRouter);
        app.use(overseerRouter);

        const server = await new Promise((resolve) => {
            const activeServer = app.listen(0, () => resolve(activeServer));
        });

        try {
            const address = server.address();
            const baseUrl = `http://127.0.0.1:${address.port}`;
            await execFileAsync(process.execPath, [
                "scripts/project-operator-summary.mjs",
                "--url", baseUrl,
                "--source", "local-runtime",
                "--jobLimit", "3",
                "--windowHours", "24",
                "--staleMs", "1",
                "--dir", projectionDir,
            ], {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    OUTPUT_DIR: outputDir,
                    LOG_DIR: logDir,
                    LOG_LEVEL: "error",
                    PYTHON_BIN: "missing-python-for-ready-check",
                    AUTONOMY_ENABLED: "true",
                },
            });

            const latestPayload = JSON.parse(fs.readFileSync(path.join(projectionDir, "latest.json"), "utf-8"));
            const latestMarkdown = fs.readFileSync(path.join(projectionDir, "latest.md"), "utf-8");
            const upstreamCompatible = JSON.parse(fs.readFileSync(path.join(projectionDir, "upstream-compatible.json"), "utf-8"));

            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.runCount, 3);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewSampleStatus.status, "directional_only");
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewSampleStatus.remainingReviewedRunCountForScreening, 18);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewSampleStatus.remainingReviewedRunCountForPromotion, 28);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewSampleStatus.remainingReviewedDisagreementCountForPromotion, 9);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.promotionAdvantage.signal, "insufficient_data");
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.blindPreference.winRate, 0.5);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.shortlistBlindPreference.winRate, 1);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewedTop1Accuracy.selectedTop1Accuracy, 1);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.pairedSelectionOutcomes.reviewedManifestCount, 2);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.pairedSelectionOutcomes.promotedReviewedCount, 1);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.pairedSelectionOutcomes.heuristicReviewedCount, 1);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.selectedWorkerOutcomes.learned_symbolic.runCount, 2);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.selectedWorkerOutcomes.music21.runCount, 1);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewQueue.pendingBlindReviewCount, 0);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPacks.matchedPackCount, 1);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPacks.activePackCount, 0);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPacks.completedDecisionCount, 3);
            assert.deepEqual(latestPayload.overseer.learnedBackboneBenchmark.reviewPackActions, []);
            assert.deepEqual(latestPayload.overseer.learnedBackboneBenchmark.reviewPackRecordActions, []);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.coverageRows.length, 2);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.coverageRows[0].benchmarkId, "cadence_clarity_reference");
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.searchBudgetCounts.S4, 1);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.promotionGate.status, "experimental");
            assert.match(latestMarkdown, /## Learned Backbone Benchmark/);
            assert.match(latestMarkdown, /- lane=string_trio_symbolic \| pack=string_trio_symbolic_benchmark_pack_v1 \| runs=3 \| paired=3 \| reviewed=2 \| pendingReview=1 \| approvalRate=0\.50 \| avgAppeal=0\.62 \| top1Accuracy=1\.00 \| budgets=S1:2,S4:1/);
            assert.match(latestMarkdown, /- config benchmarkIds=cadence_clarity_reference,localized_rewrite_probe \| promptPacks=learned_symbolic_prompt_pack_v1:3 \| reviewRubrics=approval_review_rubric_v1:2 \| generationModes=plan_conditioned_trio_template:2,targeted_section_rewrite:1 \| workflows=symbolic_only:3/);
            assert.match(latestMarkdown, /- sampleStatus=directional_only \| reviewed=2 \| reviewedDisagreements=1 \| screeningMin=20 \| promotionReviewedMin=30 \| promotionDisagreementMin=10 \| screeningGap=18 \| promotionReviewedGap=28 \| promotionDisagreementGap=9 \| earlyScreening=no \| promotionReviewed=no \| promotionDisagreements=no/);
            assert.match(latestMarkdown, /- blindPreference available=yes \| winRate=0\.50 \| reviewedPairs=3 \| decisivePairs=2 \| learnedWins=1 \| baselineWins=1 \| ties=1 \| latestReviewedAt=2026-04-19T03:00:00.000Z/);
            assert.match(latestMarkdown, /- shortlistBlindPreference available=yes \| winRate=1\.00 \| reviewedPairs=1 \| decisivePairs=1 \| learnedWins=1 \| baselineWins=0 \| ties=0 \| latestReviewedAt=2026-04-19T02:00:00.000Z/);
            assert.match(latestMarkdown, /- top1Accuracy available=yes \| selected=1\.00 \| decisivePairs=2 \| correctSelections=2 \| learnedSelected=1\.00 \| baselineSelected=1\.00 \| promoted=1\.00 \| latestReviewedAt=2026-04-19T03:00:00.000Z/);
            assert.match(latestMarkdown, /- pairedSelection reviewed=2 \| promotedReviewed=1 \| heuristicReviewed=1 \| promotedApproval=1\.00 \| heuristicApproval=0\.00 \| promotedAppeal=0\.93 \| heuristicAppeal=0\.31/);
            assert.match(latestMarkdown, /- selectedWorkerOutcome worker=learned_symbolic \| runs=2 \| reviewed=1 \| pendingReview=1 \| approved=1 \| rejected=0 \| approvalRate=1\.00 \| avgAppeal=0\.93/);
            assert.match(latestMarkdown, /- selectedWorkerOutcome worker=music21 \| runs=1 \| reviewed=1 \| pendingReview=0 \| approved=0 \| rejected=1 \| approvalRate=0\.00 \| avgAppeal=0\.31/);
            assert.match(latestMarkdown, /- coverage benchmark=cadence_clarity_reference \| runs=2 \| paired=2 \| reviewed=2 \| pendingReview=0 \| approvalRate=0\.50 \| avgAppeal=0\.62 \| selectedWorkers=learned_symbolic:1,music21:1 \| generationModes=plan_conditioned_trio_template:2 \| lastObserved=2026-04-18T09:00:00.000Z/);
            assert.match(latestMarkdown, /- reviewQueue pendingBlind=0 \| pendingShortlist=0 \| latestPendingAt=-/);
            assert.match(latestMarkdown, /- reviewPacks matched=1 \| active=0 \| pendingDecisions=0 \| completedDecisions=3 \| latestGeneratedAt=.* \| latestReviewedAt=2026-04-19T03:00:00.000Z/);
            assert.match(latestMarkdown, /- searchBudget=S1 \| candidates=2 \| runs=2 \| reviewed=2 \| pendingReview=0 \| approvalRate=0\.50 \| blindPreference=0\.50 \| top1Accuracy=1\.00 \| decisivePairs=2 \| correctSelections=2 \| lastObserved=2026-04-18T09:00:00.000Z/);
            assert.match(latestMarkdown, /- searchBudget=S4 \| candidates=4 \| runs=1 \| reviewed=0 \| pendingReview=1 \| approvalRate=\? \| blindPreference=\? \| top1Accuracy=\? \| decisivePairs=0 \| correctSelections=0 \| lastObserved=2026-04-18T10:00:00.000Z/);
            assert.match(latestMarkdown, /- promotionGate status=experimental \| signal=positive \| reviewedFloor=no \| disagreementFloor=no \| shortlistFloor=no \| retryStable=yes \| blindPreference=yes \| reviewedInTopK=0\.50 \| reviewedTop1=0\.50 \| shortlistMin=0\.60 \| approvalDelta=1\.00 \| appealDelta=0\.62 \| blockers=reviewed_runs_below_floor,reviewed_disagreements_below_floor,shortlist_quality_below_floor/);
            assert.match(latestMarkdown, /- disagreement paired=3 \| disagreements=1 \| reviewedDisagreements=1 \| promotions=1 \| learnedSelectedWithoutPromotion=1 \| baselineSelected=1/);
            assert.match(latestMarkdown, /- retryStability status=stable \| retrying=1 \| sectionTargetedOnly=1 \| mixed=0 \| globalOnly=0 \| targetedRate=1\.00 \| driftRate=0\.00/);
            assert.match(latestMarkdown, /- promotionAdvantage lane=string_trio_symbolic \| reviewed=2 \| promotedReviewed=1 \| heuristicReviewed=1 \| sufficientSample=no \| approvalDelta=1\.00 \| appealDelta=0\.62 \| signal=insufficient_data/);
            assert.match(latestMarkdown, /- failureMode=cadence_release \| count=1/);
            assert.match(latestMarkdown, /- run song=song-c \| benchmark=localized_rewrite_probe \| searchBudget=S4 \| candidates=4 \| selectedWorker=learned_symbolic \| approval=pending \| selectionMode=learned_selected \| disagreement=no \| promotion=no \| retry=section_targeted \| weakest=- \| observedAt=2026-04-18T10:00:00.000Z/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark lane=string_trio_symbolic pack=string_trio_symbolic_benchmark_pack_v1 runs=3 paired=3 reviewed=2 pendingReview=1 approvalRate=0\.50 avgAppeal=0\.62 top1Accuracy=1\.00 budgets=S1:2,S4:1 sampleStatus=directional_only screeningGap=18 promotionReviewedGap=28 promotionDisagreementGap=9 disagreements=1 reviewedDisagreements=1 promotionSignal=insufficient_data retryStatus=stable targetedRate=1\.00 driftRate=0\.00/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark blindPreference available=yes winRate=0\.50 reviewedPairs=3 decisivePairs=2 learnedWins=1 baselineWins=1 ties=1 latestReviewedAt=2026-04-19T03:00:00.000Z/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark shortlistBlindPreference available=yes winRate=1\.00 reviewedPairs=1 decisivePairs=1 learnedWins=1 baselineWins=0 ties=0 latestReviewedAt=2026-04-19T02:00:00.000Z/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark top1Accuracy available=yes selected=1\.00 decisivePairs=2 correctSelections=2 learnedSelected=1\.00 baselineSelected=1\.00 promoted=1\.00 latestReviewedAt=2026-04-19T03:00:00.000Z/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark pairedSelection reviewed=2 promotedReviewed=1 heuristicReviewed=1 promotedApproval=1\.00 heuristicApproval=0\.00 promotedAppeal=0\.93 heuristicAppeal=0\.31/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark selectedWorkerOutcome worker=learned_symbolic runs=2 reviewed=1 pendingReview=1 approved=1 rejected=0 approvalRate=1\.00 avgAppeal=0\.93/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark coverage benchmark=cadence_clarity_reference runs=2 paired=2 reviewed=2 pendingReview=0 approvalRate=0\.50 avgAppeal=0\.62 selectedWorkers=learned_symbolic:1,music21:1 generationModes=plan_conditioned_trio_template:2 lastObserved=2026-04-18T09:00:00.000Z/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark reviewQueue pendingBlind=0 pendingShortlist=0 latestPendingAt=-/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark reviewPacks matched=1 active=0 pendingDecisions=0 completedDecisions=3 latestGeneratedAt=.* latestReviewedAt=2026-04-19T03:00:00.000Z/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark searchBudget=S1 candidates=2 runs=2 reviewed=2 pendingReview=0 approvalRate=0\.50 blindPreference=0\.50 top1Accuracy=1\.00 decisivePairs=2 correctSelections=2 lastObserved=2026-04-18T09:00:00.000Z/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark promotionGate status=experimental signal=positive reviewedFloor=no disagreementFloor=no shortlistFloor=no retryStable=yes blindPreference=yes reviewedInTopK=0\.50 reviewedTop1=0\.50 shortlistMin=0\.60 approvalDelta=1\.00 appealDelta=0\.62 blockers=reviewed_runs_below_floor,reviewed_disagreements_below_floor,shortlist_quality_below_floor/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark failureMode=cadence_release count=1/);
        } finally {
            await new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
            config.outputDir = originalOutputDir;
            config.logDir = originalLogDir;
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("project operator summary renders custom search-budget descriptors without collapsing mixed budgets", async () => {
    const { tempRoot, outputDir, logDir, projectionDir } = createTempRuntimeRoot("axiom-learned-backbone-project-custom-budget-");

    try {
        seedCustomSearchBudgetFixtures(outputDir);

        const express = (await import("express")).default;
        const healthRouter = (await import("../dist/routes/health.js")).default;
        const autonomyRouter = (await import("../dist/routes/autonomy.js")).default;
        const overseerRouter = (await import("../dist/routes/overseer.js")).default;
        const { config } = await import("../dist/config.js");
        const originalOutputDir = config.outputDir;
        const originalLogDir = config.logDir;
        config.outputDir = outputDir;
        config.logDir = logDir;

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: false }));
        app.use(healthRouter);
        app.get("/jobs", (_req, res) => {
            res.json([]);
        });
        app.use(autonomyRouter);
        app.use(overseerRouter);

        const server = await new Promise((resolve) => {
            const activeServer = app.listen(0, () => resolve(activeServer));
        });

        try {
            const address = server.address();
            const baseUrl = `http://127.0.0.1:${address.port}`;
            await execFileAsync(process.execPath, [
                "scripts/project-operator-summary.mjs",
                "--url", baseUrl,
                "--source", "local-runtime",
                "--jobLimit", "3",
                "--windowHours", "24",
                "--staleMs", "1",
                "--dir", projectionDir,
            ], {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    OUTPUT_DIR: outputDir,
                    LOG_DIR: logDir,
                    LOG_LEVEL: "error",
                    PYTHON_BIN: "missing-python-for-ready-check",
                    AUTONOMY_ENABLED: "true",
                },
            });

            const latestPayload = JSON.parse(fs.readFileSync(path.join(projectionDir, "latest.json"), "utf-8"));
            const latestMarkdown = fs.readFileSync(path.join(projectionDir, "latest.md"), "utf-8");
            const upstreamCompatible = JSON.parse(fs.readFileSync(path.join(projectionDir, "upstream-compatible.json"), "utf-8"));
            const descriptors = latestPayload.overseer.learnedBackboneBenchmark.searchBudgetRows.map((row) => row.searchBudgetDescriptor);

            assert.deepEqual(descriptors, ["custom(3)", "custom(3+1)"]);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.recentRunRows[0].searchBudgetDescriptor, "custom(3+1)");
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewQueue.recentPendingRows[0].searchBudgetDescriptor, "custom(3+1)");
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPackActions.length, 3);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPackActions[1].searchBudget, "custom(3)");
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPackActions[1].command, "npm run ml:review-pack:learned-backbone -- --pendingOnly --searchBudget=\"custom(3)\"");
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPackActions[2].searchBudget, "custom(3+1)");
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPackActions[2].command, "npm run ml:review-pack:learned-backbone -- --pendingOnly --searchBudget=\"custom(3+1)\"");
            assert.match(latestMarkdown, /- searchBudget=custom\(3\) \| candidates=3 \| runs=1/);
            assert.match(latestMarkdown, /- searchBudget=custom\(3\+1\) \| candidates=3 \| runs=1/);
            assert.match(latestMarkdown, /- reviewQueue song=song-custom-mixed .* searchBudget=custom\(3\+1\)/);
            assert.match(latestMarkdown, /- reviewPackAction target=all \| searchBudget=custom\(3\) \| pendingOnly=yes \| pendingPairs=1 \| priority=after_general_queue \| command=npm run ml:review-pack:learned-backbone -- --pendingOnly --searchBudget="custom\(3\)"/);
            assert.match(latestMarkdown, /- reviewPackAction target=all \| searchBudget=custom\(3\+1\) \| pendingOnly=yes \| pendingPairs=1 \| priority=after_previous_budget_focus \| command=npm run ml:review-pack:learned-backbone -- --pendingOnly --searchBudget="custom\(3\+1\)"/);
            assert.match(latestMarkdown, /- run song=song-custom-pure \| benchmark=custom_budget_probe \| searchBudget=custom\(3\)/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark searchBudget=custom\(3\) candidates=3 runs=1/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark searchBudget=custom\(3\+1\) candidates=3 runs=1/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark reviewPackAction target=all searchBudget=custom\(3\) pendingOnly=yes pendingPairs=1 priority=after_general_queue command=npm run ml:review-pack:learned-backbone -- --pendingOnly --searchBudget=\\"custom\(3\)\\"/);
        } finally {
            await new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
            config.outputDir = originalOutputDir;
            config.logDir = originalLogDir;
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("project operator summary carries active learned backbone review pack actions in latest json", async () => {
    const { tempRoot, outputDir, logDir, projectionDir } = createTempRuntimeRoot("axiom-learned-backbone-project-active-pack-");

    try {
        seedLearnedBackboneBenchmarkFixtures(outputDir);
        await seedActiveLearnedBackboneBlindReviewPack(outputDir);

        const express = (await import("express")).default;
        const healthRouter = (await import("../dist/routes/health.js")).default;
        const autonomyRouter = (await import("../dist/routes/autonomy.js")).default;
        const overseerRouter = (await import("../dist/routes/overseer.js")).default;
        const { config } = await import("../dist/config.js");
        const originalOutputDir = config.outputDir;
        const originalLogDir = config.logDir;
        config.outputDir = outputDir;
        config.logDir = logDir;

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: false }));
        app.use(healthRouter);
        app.get("/jobs", (_req, res) => {
            res.json([]);
        });
        app.use(autonomyRouter);
        app.use(overseerRouter);

        const server = await new Promise((resolve) => {
            const activeServer = app.listen(0, () => resolve(activeServer));
        });

        try {
            const address = server.address();
            const baseUrl = `http://127.0.0.1:${address.port}`;
            await execFileAsync(process.execPath, [
                "scripts/project-operator-summary.mjs",
                "--url", baseUrl,
                "--source", "local-runtime",
                "--jobLimit", "3",
                "--windowHours", "24",
                "--staleMs", "1",
                "--dir", projectionDir,
            ], {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    OUTPUT_DIR: outputDir,
                    LOG_DIR: logDir,
                    LOG_LEVEL: "error",
                    PYTHON_BIN: "missing-python-for-ready-check",
                    AUTONOMY_ENABLED: "true",
                },
            });

            const latestPayload = JSON.parse(fs.readFileSync(path.join(projectionDir, "latest.json"), "utf-8"));
            const latestMarkdown = fs.readFileSync(path.join(projectionDir, "latest.md"), "utf-8");
            const upstreamCompatible = JSON.parse(fs.readFileSync(path.join(projectionDir, "upstream-compatible.json"), "utf-8"));

            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPacks.matchedPackCount, 1);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPacks.activePackCount, 1);
            assert.equal(Array.isArray(latestPayload.overseer.learnedBackboneBenchmark.reviewPackActions), true);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPackActions.length, 0);
            assert.equal(Array.isArray(latestPayload.overseer.learnedBackboneBenchmark.reviewPackRecordActions), true);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPackRecordActions[0].packId, "active-pack-v1");
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPackRecordActions[0].pendingDecisionCount, 3);
            assert.equal(latestPayload.overseer.learnedBackboneBenchmark.reviewPackRecordActions[0].command, "npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs/_system/ml/review-packs/learned-backbone/active-pack-v1/review-sheet.csv");
            assert.match(latestMarkdown, /- reviewPackRecordAction pack=active-pack-v1 \| target=all \| pendingDecisions=3 \| pendingShortlist=1 \| reviewSheet=outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv \| priority=first \| command=npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv/);
            assert.match(JSON.stringify(upstreamCompatible.artifacts), /learnedBackboneBenchmark reviewPackRecordAction pack=active-pack-v1 target=all pendingDecisions=3 pendingShortlist=1 reviewSheet=outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv priority=first command=npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv/);
        } finally {
            await new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
            config.outputDir = originalOutputDir;
            config.logDir = originalLogDir;
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});