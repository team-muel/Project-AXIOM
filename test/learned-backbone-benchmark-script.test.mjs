import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const benchmarkPackVersion = "string_trio_symbolic_benchmark_pack_v1";
const promptPackVersion = "learned_symbolic_prompt_pack_v1";

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function writeBenchmarkManifest({ outputDir, songId, approvalStatus, updatedAt, reviewFeedback = {}, proposalEvidence }) {
    writeJson(path.join(outputDir, songId, "manifest.json"), {
        songId,
        approvalStatus,
        ...(Object.keys(reviewFeedback).length > 0 ? { reviewFeedback } : {}),
        meta: {
            workflow: "symbolic_only",
        },
        updatedAt,
        ...(proposalEvidence ? { proposalEvidence } : {}),
    });
}

function seedLearnedBackboneBenchmarkFixtures(outputDir) {
    writeBenchmarkManifest({
        outputDir,
        songId: "song-a",
        approvalStatus: "approved",
        updatedAt: "2026-04-18T09:00:00.000Z",
        reviewFeedback: {
            reviewRubricVersion: "approval_review_rubric_v1",
            appealScore: 8.5,
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

    writeBenchmarkManifest({
        outputDir,
        songId: "song-b",
        approvalStatus: "rejected",
        updatedAt: "2026-04-18T08:00:00.000Z",
        reviewFeedback: {
            reviewRubricVersion: "approval_review_rubric_v1",
            appealScore: 5,
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

    writeBenchmarkManifest({
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

    writeBenchmarkManifest({
        outputDir,
        songId: "song-d",
        approvalStatus: "approved",
        updatedAt: "2026-04-18T11:00:00.000Z",
        reviewFeedback: {
            reviewRubricVersion: "approval_review_rubric_v1",
            appealScore: 6,
        },
        proposalEvidence: {
            worker: "learned_symbolic",
            lane: "string_trio_symbolic",
            benchmarkPackVersion: "other_pack",
            benchmarkId: "not-included",
            promptPackVersion,
            planSignature: "lane=string_trio_symbolic|sig=other-pack",
        },
    });
}

function seedCustomSearchBudgetFixtures(outputDir) {
    writeBenchmarkManifest({
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

    writeBenchmarkManifest({
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
    writeBenchmarkManifest({
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

function seedLearnedBackboneBlindReviewResults(outputDir) {
    const snapshot = "blind-pack-v1";
    const packResult = JSON.parse(execFileSync(process.execPath, [
        path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
        `--outputDir=${outputDir}`,
        `--snapshot=${snapshot}`,
        "--labelSeed=fixed-seed",
    ], {
        cwd: repoRoot,
        encoding: "utf8",
    }).trim());

    const packPayload = JSON.parse(fs.readFileSync(packResult.paths.packPath, "utf8"));
    assert.doesNotMatch(JSON.stringify(packPayload), /learned_symbolic|music21|baseline-a|learned-a/);

    const answerKey = JSON.parse(fs.readFileSync(packResult.paths.answerKeyPath, "utf8"));
    for (const [index, entry] of answerKey.entries.entries()) {
        recordLearnedBackboneBlindReviewResult({
            outputDir,
            snapshot,
            entryId: entry.entryId,
            winnerLabel: entry.songId === "song-a"
                ? entry.learned.label
                : entry.songId === "song-b"
                    ? entry.baseline.label
                    : "tie",
            reviewedAt: `2026-04-19T0${index + 1}:00:00.000Z`,
            reviewerId: "operator-a",
        });
    }

    return packResult;
}

function recordLearnedBackboneBlindReviewResult({
    outputDir,
    snapshot,
    resultsFile,
    packDir,
    entryId,
    winnerLabel,
    reviewedAt,
    reviewerId,
    notes,
}) {
    const args = [
        path.join(repoRoot, "scripts", "record-learned-backbone-review-result.mjs"),
        `--outputDir=${outputDir}`,
    ];

    if (snapshot) {
        args.push(`--snapshot=${snapshot}`);
    }
    if (packDir) {
        args.push(`--packDir=${packDir}`);
    }
    if (resultsFile) {
        args.push(`--resultsFile=${resultsFile}`);
    }
    if (entryId) {
        args.push(`--entryId=${entryId}`);
    }
    if (winnerLabel) {
        args.push(`--winnerLabel=${winnerLabel}`);
    }

    if (reviewedAt) {
        args.push(`--reviewedAt=${reviewedAt}`);
    }
    if (reviewerId) {
        args.push(`--reviewerId=${reviewerId}`);
    }
    if (notes) {
        args.push(`--notes=${notes}`);
    }

    return JSON.parse(execFileSync(process.execPath, args, {
        cwd: repoRoot,
        encoding: "utf8",
    }).trim());
}

test("learned backbone review result recorder writes and replaces blind review entries", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-review-record-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");
        const snapshot = "record-pack-v1";
        seedLearnedBackboneBenchmarkFixtures(outputsRoot);

        const packResult = JSON.parse(execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
            `--outputDir=${outputsRoot}`,
            `--snapshot=${snapshot}`,
            "--labelSeed=fixed-seed",
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim());

        const answerKey = JSON.parse(fs.readFileSync(packResult.paths.answerKeyPath, "utf8"));
        const entry = answerKey.entries[0];

        const firstResult = recordLearnedBackboneBlindReviewResult({
            outputDir: outputsRoot,
            snapshot,
            entryId: entry.entryId,
            winnerLabel: entry.learned.label.toLowerCase(),
            reviewedAt: "2026-04-19T10:00:00.000Z",
            reviewerId: "operator-a",
            notes: "first listen",
        });

        assert.equal(firstResult.replacedExisting, false);
        assert.equal(firstResult.resultCount, 1);
        assert.equal(firstResult.recordedResult.winnerLabel, entry.learned.label);
        assert.equal(firstResult.recordedResult.reviewerId, "operator-a");
        assert.equal(firstResult.recordedResult.notes, "first listen");

        let resultsPayload = JSON.parse(fs.readFileSync(packResult.paths.resultsPath, "utf8"));
        assert.equal(resultsPayload.results.length, 1);
        assert.equal(resultsPayload.results[0].entryId, entry.entryId);
        assert.equal(resultsPayload.results[0].winnerLabel, entry.learned.label);

        const replacedResult = recordLearnedBackboneBlindReviewResult({
            outputDir: outputsRoot,
            snapshot,
            entryId: entry.entryId,
            winnerLabel: "skip",
            reviewedAt: "2026-04-19T11:00:00.000Z",
            reviewerId: "operator-b",
            notes: "needs another listener",
        });

        assert.equal(replacedResult.replacedExisting, true);
        assert.equal(replacedResult.resultCount, 1);
        assert.equal(replacedResult.recordedResult.winnerLabel, "SKIP");
        assert.equal(replacedResult.recordedResult.reviewerId, "operator-b");
        assert.equal(replacedResult.recordedResult.notes, "needs another listener");

        resultsPayload = JSON.parse(fs.readFileSync(packResult.paths.resultsPath, "utf8"));
        assert.equal(resultsPayload.results.length, 1);
        assert.equal(resultsPayload.results[0].winnerLabel, "SKIP");
        assert.equal(resultsPayload.results[0].reviewerId, "operator-b");
        assert.equal(resultsPayload.results[0].notes, "needs another listener");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned backbone review pack can target pending shortlist queue", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-review-queue-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");
        seedLearnedBackboneBenchmarkFixtures(outputsRoot);

        const packResult = JSON.parse(execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
            `--outputDir=${outputsRoot}`,
            "--snapshot=pending-shortlist-pack-v1",
            "--labelSeed=fixed-seed",
            "--pendingOnly",
            "--reviewTarget=shortlist",
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim());

        assert.equal(packResult.pairCount, 1);
        assert.equal(packResult.filteredPairCount, 2);
        assert.equal(packResult.sourceReviewQueue.pendingOnly, true);
        assert.equal(packResult.sourceReviewQueue.reviewTarget, "shortlist");
        assert.equal(packResult.sourceReviewQueue.pendingBlindReviewCount, 3);
        assert.equal(packResult.sourceReviewQueue.pendingShortlistReviewCount, 1);

        const packPayload = JSON.parse(fs.readFileSync(packResult.paths.packPath, "utf8"));
        const answerKey = JSON.parse(fs.readFileSync(packResult.paths.answerKeyPath, "utf8"));
        const reviewSheetText = fs.readFileSync(packResult.paths.reviewSheetPath, "utf8");

        assert.equal(packPayload.entryCount, 1);
        assert.equal(packPayload.sourceReviewQueue.pendingOnly, true);
        assert.equal(answerKey.entryCount, 1);
        assert.equal(answerKey.entries[0].songId, "song-a");
        assert.equal(answerKey.entries[0].reviewTarget, "shortlist");
        assert.equal(answerKey.entries[0].shortlistTopK, 1);
        assert.equal(answerKey.entries[0].selectedRank, 1);
        assert.equal(answerKey.entries[0].selectedInShortlist, true);
        assert.match(reviewSheetText, /entryId,songId,benchmarkId,reviewTarget,winnerLabel,reviewedAt,reviewerId,notes,allowedWinnerLabels,midiAPath,midiBPath/);
        assert.match(reviewSheetText, /A\|B\|TIE\|SKIP/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned backbone review result recorder ingests review sheet csv in bulk", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-review-bulk-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");
        const snapshot = "review-sheet-pack-v1";
        seedLearnedBackboneBenchmarkFixtures(outputsRoot);

        const packResult = JSON.parse(execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
            `--outputDir=${outputsRoot}`,
            `--snapshot=${snapshot}`,
            "--labelSeed=fixed-seed",
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim());

        const packPayload = JSON.parse(fs.readFileSync(packResult.paths.packPath, "utf8"));
        const answerKey = JSON.parse(fs.readFileSync(packResult.paths.answerKeyPath, "utf8"));
        const packEntriesById = new Map(packPayload.entries.map((entry) => [entry.entryId, entry]));

        const csvRows = [
            "entryId,songId,benchmarkId,reviewTarget,winnerLabel,reviewedAt,reviewerId,notes,allowedWinnerLabels,midiAPath,midiBPath",
            ...answerKey.entries.map((entry, index) => {
                const packEntry = packEntriesById.get(entry.entryId);
                const variantA = (packEntry?.variants ?? []).find((item) => item.label === "A");
                const variantB = (packEntry?.variants ?? []).find((item) => item.label === "B");
                const winner = entry.songId === "song-a"
                    ? entry.learned.label
                    : entry.songId === "song-b"
                        ? entry.baseline.label.toLowerCase()
                        : "";
                const reviewedAt = winner ? `2026-04-19T1${index}:00:00.000Z` : "";
                const reviewerId = winner && entry.songId === "song-a" ? "operator-sheet" : "";
                const notes = winner && entry.songId === "song-a" ? '"preferred, clearer cadence"' : "";
                return [
                    entry.entryId,
                    entry.songId,
                    entry.benchmarkId,
                    entry.reviewTarget,
                    winner,
                    reviewedAt,
                    reviewerId,
                    notes,
                    "A|B|TIE|SKIP",
                    variantA?.midiPath ?? "",
                    variantB?.midiPath ?? "",
                ].join(",");
            }),
        ].join("\n") + "\n";
        fs.writeFileSync(packResult.paths.reviewSheetPath, csvRows, "utf8");

        const batchResult = recordLearnedBackboneBlindReviewResult({
            outputDir: outputsRoot,
            snapshot,
            resultsFile: packResult.paths.reviewSheetPath,
            reviewerId: "operator-default",
        });

        assert.equal(batchResult.processedCount, 2);
        assert.equal(batchResult.replacedExistingCount, 0);
        assert.equal(batchResult.skippedBlankDecisionCount, 1);
        assert.equal(batchResult.resultCount, 2);

        const resultsPayload = JSON.parse(fs.readFileSync(packResult.paths.resultsPath, "utf8"));
        assert.equal(resultsPayload.results.length, 2);
        const answerEntryBySongId = new Map(answerKey.entries.map((entry) => [entry.songId, entry]));
        const resultByEntryId = new Map(resultsPayload.results.map((entry) => [entry.entryId, entry]));
        assert.equal(resultByEntryId.get(answerEntryBySongId.get("song-a").entryId).winnerLabel, answerEntryBySongId.get("song-a").learned.label);
        assert.equal(resultByEntryId.get(answerEntryBySongId.get("song-a").entryId).reviewerId, "operator-sheet");
        assert.equal(resultByEntryId.get(answerEntryBySongId.get("song-a").entryId).notes, "preferred, clearer cadence");
        assert.equal(resultByEntryId.get(answerEntryBySongId.get("song-b").entryId).winnerLabel, answerEntryBySongId.get("song-b").baseline.label);
        assert.equal(resultByEntryId.get(answerEntryBySongId.get("song-b").entryId).reviewerId, "operator-default");
        assert.equal(resultByEntryId.has(answerEntryBySongId.get("song-c").entryId), false);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned backbone review pack pendingOnly excludes already reviewed blind pairs", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-reviewed-queue-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");
        seedLearnedBackboneBenchmarkFixtures(outputsRoot);
        seedLearnedBackboneBlindReviewResults(outputsRoot);

        const packResult = JSON.parse(execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
            `--outputDir=${outputsRoot}`,
            "--snapshot=pending-only-pack-v1",
            "--labelSeed=fixed-seed",
            "--pendingOnly",
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim());

        assert.equal(packResult.pairCount, 0);
        assert.equal(packResult.filteredPairCount, 3);
        assert.equal(packResult.sourceReviewQueue.pendingBlindReviewCount, 0);
        assert.equal(packResult.sourceReviewQueue.pendingShortlistReviewCount, 0);

        const packPayload = JSON.parse(fs.readFileSync(packResult.paths.packPath, "utf8"));
        const answerKey = JSON.parse(fs.readFileSync(packResult.paths.answerKeyPath, "utf8"));

        assert.equal(packPayload.entryCount, 0);
        assert.equal(answerKey.entryCount, 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned backbone review pack can filter pending queue by custom search budget", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-custom-review-queue-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");
        seedCustomSearchBudgetFixtures(outputsRoot);

        const packResult = JSON.parse(execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
            `--outputDir=${outputsRoot}`,
            "--snapshot=custom-budget-pack-v1",
            "--labelSeed=fixed-seed",
            "--pendingOnly",
            "--searchBudget=custom(3+1)",
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim());

        assert.equal(packResult.pairCount, 1);
        assert.equal(packResult.filteredPairCount, 1);
        assert.equal(packResult.sourceReviewQueue.pendingOnly, true);
        assert.equal(packResult.sourceReviewQueue.reviewTarget, "all");
        assert.equal(packResult.sourceReviewQueue.searchBudget, "custom(3+1)");
        assert.equal(packResult.sourceReviewQueue.candidatePairCount, 1);
        assert.equal(packResult.sourceReviewQueue.pendingBlindReviewCount, 1);
        assert.equal(packResult.sourceReviewQueue.pendingShortlistReviewCount, 0);

        const packPayload = JSON.parse(fs.readFileSync(packResult.paths.packPath, "utf8"));
        const answerKey = JSON.parse(fs.readFileSync(packResult.paths.answerKeyPath, "utf8"));

        assert.equal(packPayload.entryCount, 1);
        assert.equal(packPayload.sourceReviewQueue.searchBudget, "custom(3+1)");
        assert.equal(answerKey.entryCount, 1);
        assert.equal(answerKey.entries[0].songId, "song-custom-mixed");
        assert.equal(answerKey.entries[0].searchBudgetLevel, "custom");
        assert.equal(answerKey.entries[0].searchBudgetDescriptor, "custom(3+1)");
        assert.equal(answerKey.entries[0].localizedRewriteBranchCount, 1);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned backbone review pack pendingOnly excludes songs already assigned to an active blind pack", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-active-pack-exclude-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");
        seedLearnedBackboneBenchmarkFixtures(outputsRoot);

        JSON.parse(execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
            `--outputDir=${outputsRoot}`,
            "--snapshot=active-pack-v1",
            "--labelSeed=fixed-seed",
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim());

        seedSupplementalPendingBenchmarkFixture(outputsRoot);

        const packResult = JSON.parse(execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
            `--outputDir=${outputsRoot}`,
            "--snapshot=supplemental-pack-v1",
            "--labelSeed=fixed-seed",
            "--pendingOnly",
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim());

        const answerKey = JSON.parse(fs.readFileSync(packResult.paths.answerKeyPath, "utf8"));

        assert.equal(packResult.pairCount, 1);
        assert.equal(packResult.sourceReviewQueue.pendingBlindReviewCount, 1);
        assert.equal(packResult.sourceReviewQueue.pendingShortlistReviewCount, 0);
        assert.equal(answerKey.entryCount, 1);
        assert.equal(answerKey.entries[0].songId, "song-late");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned backbone benchmark summary groups paired benchmark runs and promotion evidence", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-summary-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");

        writeJson(path.join(outputsRoot, "song-a", "manifest.json"), {
            songId: "song-a",
            approvalStatus: "approved",
            reviewFeedback: {
                reviewRubricVersion: "approval_review_rubric_v1",
                appealScore: 8.5,
                strongestDimension: "phrase_breath",
            },
            meta: {
                workflow: "symbolic_only",
            },
            updatedAt: "2026-04-18T09:00:00.000Z",
        });
        writeJson(path.join(outputsRoot, "song-a", "candidates", "index.json"), {
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
                    outputDir: outputsRoot,
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
                    outputDir: outputsRoot,
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

        writeJson(path.join(outputsRoot, "song-b", "manifest.json"), {
            songId: "song-b",
            approvalStatus: "rejected",
            reviewFeedback: {
                reviewRubricVersion: "approval_review_rubric_v1",
                appealScore: 5,
                weakestDimension: "cadence_release",
                note: "Baseline cadence still felt too static.",
            },
            meta: {
                workflow: "symbolic_only",
            },
            updatedAt: "2026-04-18T08:00:00.000Z",
        });
        writeJson(path.join(outputsRoot, "song-b", "candidates", "index.json"), {
            version: 1,
            songId: "song-b",
            updatedAt: "2026-04-18T08:00:00.000Z",
            selectedCandidateId: "baseline-b",
            selectedAttempt: 1,
            selectionStopReason: "hybrid candidate pool kept music21 over learned_symbolic on cadence_clarity_reference",
            entries: [
                buildCandidateEntry({
                    outputDir: outputsRoot,
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
                    outputDir: outputsRoot,
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

        writeJson(path.join(outputsRoot, "song-c", "manifest.json"), {
            songId: "song-c",
            approvalStatus: "pending",
            meta: {
                workflow: "symbolic_only",
            },
            updatedAt: "2026-04-18T10:00:00.000Z",
        });
        writeJson(path.join(outputsRoot, "song-c", "candidates", "index.json"), {
            version: 1,
            songId: "song-c",
            updatedAt: "2026-04-18T10:00:00.000Z",
            selectedCandidateId: "learned-c-rewrite",
            selectedAttempt: 1,
            selectionStopReason: "selected same-attempt localized rewrite branch after reviewing 4 whole-piece candidates",
            entries: [
                buildCandidateEntry({
                    outputDir: outputsRoot,
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
                    outputDir: outputsRoot,
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
                    outputDir: outputsRoot,
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
                    outputDir: outputsRoot,
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
                    outputDir: outputsRoot,
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
                    outputDir: outputsRoot,
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

        writeJson(path.join(outputsRoot, "song-d", "manifest.json"), {
            songId: "song-d",
            approvalStatus: "approved",
            reviewFeedback: {
                reviewRubricVersion: "approval_review_rubric_v1",
                appealScore: 6,
            },
            meta: {
                workflow: "symbolic_only",
            },
            updatedAt: "2026-04-18T11:00:00.000Z",
            proposalEvidence: {
                worker: "learned_symbolic",
                lane: "string_trio_symbolic",
                benchmarkPackVersion: "other_pack",
                benchmarkId: "not-included",
                promptPackVersion,
                planSignature: "lane=string_trio_symbolic|sig=other-pack",
            },
        });

        JSON.parse(execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
            `--outputDir=${outputsRoot}`,
            "--snapshot=active-pack-v1",
            "--labelSeed=fixed-seed",
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim());

        const stdout = execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "summarize-learned-backbone-benchmark.mjs"),
            `--outputDir=${outputsRoot}`,
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim();
        const payload = JSON.parse(stdout);

        assert.equal(payload.ok, true);
        assert.equal(payload.runCount, 3);
        assert.equal(payload.pairedRunCount, 3);
        assert.equal(payload.reviewedRunCount, 2);
        assert.equal(payload.pendingReviewCount, 1);
        assert.equal(payload.selectedWorkerCounts.learned_symbolic, 2);
        assert.equal(payload.selectedWorkerCounts.music21, 1);
        assert.equal(payload.promptPackVersionCounts.learned_symbolic_prompt_pack_v1, 3);
        assert.equal(payload.reviewRubricVersionCounts.approval_review_rubric_v1, 2);
        assert.equal(payload.generationModeCounts.plan_conditioned_trio_template, 2);
        assert.equal(payload.generationModeCounts.targeted_section_rewrite, 1);
        assert.equal(payload.workflowCounts.symbolic_only, 3);
        assert.equal(payload.selectionModeCounts.promoted_learned, 1);
        assert.equal(payload.selectionModeCounts.baseline_selected, 1);
        assert.equal(payload.selectionModeCounts.learned_selected, 1);
        assert.equal(payload.searchBudgetCounts.S1, 2);
        assert.equal(payload.searchBudgetCounts.S4, 1);
        assert.deepEqual(payload.configSnapshot.benchmarkIds, ["cadence_clarity_reference", "localized_rewrite_probe"]);

        assert.equal(payload.pairedSelectionOutcomes.reviewedManifestCount, 2);
        assert.equal(payload.pairedSelectionOutcomes.promotedReviewedCount, 1);
        assert.equal(payload.pairedSelectionOutcomes.heuristicReviewedCount, 1);
        assert.equal(payload.pairedSelectionOutcomes.promotedApprovalRate, 1);
        assert.equal(payload.pairedSelectionOutcomes.heuristicApprovalRate, 0);
        assert.equal(payload.selectedWorkerOutcomes.learned_symbolic.runCount, 2);
        assert.equal(payload.selectedWorkerOutcomes.learned_symbolic.reviewedRunCount, 1);
        assert.equal(payload.selectedWorkerOutcomes.learned_symbolic.pendingReviewCount, 1);
        assert.equal(payload.selectedWorkerOutcomes.learned_symbolic.approvedCount, 1);
        assert.equal(payload.selectedWorkerOutcomes.learned_symbolic.approvalRate, 1);
        assert.equal(payload.selectedWorkerOutcomes.learned_symbolic.averageAppealScore, 8.5);
        assert.equal(payload.selectedWorkerOutcomes.music21.runCount, 1);
        assert.equal(payload.selectedWorkerOutcomes.music21.reviewedRunCount, 1);
        assert.equal(payload.selectedWorkerOutcomes.music21.rejectedCount, 1);
        assert.equal(payload.selectedWorkerOutcomes.music21.approvalRate, 0);
        assert.equal(payload.selectedWorkerOutcomes.music21.averageAppealScore, 5);
        assert.equal(payload.promotionAdvantage.signal, "insufficient_data");
        assert.equal(payload.promotionAdvantage.approvalRateDelta, 1);
        assert.equal(payload.promotionAdvantage.appealScoreDelta, 3.5);

        assert.equal(payload.blindPreference.available, false);
        assert.equal(payload.shortlistBlindPreference.available, false);
        assert.equal(payload.reviewedTop1Accuracy.available, false);
        assert.equal(payload.reviewedTop1Accuracy.selectedTop1Accuracy, null);
        assert.equal(payload.reviewedTop1Accuracy.decisiveReviewedPairCount, 0);
        assert.equal(payload.reviewQueue.pendingBlindReviewCount, 3);
        assert.equal(payload.reviewQueue.pendingShortlistReviewCount, 1);
        assert.equal(payload.reviewQueue.latestPendingAt, "2026-04-18T10:00:00.000Z");
        assert.equal(payload.reviewQueue.recentPendingRows.length, 3);
        assert.equal(payload.reviewQueue.recentPendingRows[0].songId, "song-a");
        assert.equal(payload.reviewQueue.recentPendingRows[0].reviewTarget, "shortlist");
        assert.equal(payload.reviewQueue.recentPendingRows[0].selectedInShortlist, true);
        assert.equal(payload.reviewQueue.recentPendingRows[0].selectedRank, 1);
        assert.equal(payload.reviewPacks.matchedPackCount, 1);
        assert.equal(payload.reviewPacks.activePackCount, 1);
        assert.equal(payload.reviewPacks.pendingDecisionCount, 3);
        assert.equal(payload.reviewPacks.completedDecisionCount, 0);
        assert.equal(payload.reviewPacks.latestReviewedAt, null);
        assert.equal(payload.reviewPacks.recentActivePacks.length, 1);
        assert.equal(payload.reviewPacks.recentActivePacks[0].packId, "active-pack-v1");
        assert.equal(payload.reviewPacks.recentActivePacks[0].pendingDecisionCount, 3);
        assert.equal(payload.reviewPacks.recentActivePacks[0].pendingShortlistDecisionCount, 1);
        assert.equal(payload.reviewPacks.recentActivePacks[0].reviewSheetPath, "outputs/_system/ml/review-packs/learned-backbone/active-pack-v1/review-sheet.csv");
        assert.equal(payload.promotionGate.status, "experimental");
        assert.equal(payload.promotionGate.signal, "positive");
        assert.equal(payload.promotionGate.meetsReviewedRunMinimum, false);
        assert.equal(payload.promotionGate.meetsReviewedDisagreementMinimum, false);
        assert.equal(payload.promotionGate.minimumReviewedSelectedInShortlistRate, 0.6);
        assert.equal(payload.promotionGate.reviewedSelectedInShortlistRate, 0.5);
        assert.equal(payload.promotionGate.reviewedSelectedTop1Rate, 0.5);
        assert.equal(payload.promotionGate.meetsReviewedSelectedInShortlistMinimum, false);
        assert.equal(payload.promotionGate.retryLocalizationStable, true);
        assert.ok(payload.promotionGate.blockers.includes("reviewed_runs_below_floor"));
        assert.ok(payload.promotionGate.blockers.includes("reviewed_disagreements_below_floor"));
        assert.ok(payload.promotionGate.blockers.includes("shortlist_quality_below_floor"));
        assert.equal(payload.reviewSampleStatus.status, "directional_only");
        assert.equal(payload.reviewSampleStatus.reviewedRunCount, 2);
        assert.equal(payload.reviewSampleStatus.reviewedDisagreementCount, 1);
        assert.equal(payload.reviewSampleStatus.meetsEarlyScreeningMinimum, false);
        assert.equal(payload.disagreementSummary.disagreementRunCount, 1);
        assert.equal(payload.disagreementSummary.reviewedDisagreementCount, 1);
        assert.equal(payload.disagreementSummary.promotionAppliedCount, 1);
        assert.equal(payload.retryLocalizationStability.status, "stable");
        assert.equal(payload.retryLocalizationStability.retryingRunCount, 1);
        assert.equal(payload.topFailureModes[0].failureMode, "cadence_release");
        assert.equal(payload.topFailureModes[0].count, 1);
        assert.ok(payload.topStopReasons.some((row) => row.reason.includes("learned reranker promoted attempt 1")));
        assert.ok(payload.topStopReasons.some((row) => row.reason.includes("hybrid candidate pool kept music21")));

        assert.equal(payload.retryLocalizationOutcomes.retryingManifestCount, 1);
        assert.equal(payload.retryLocalizationOutcomes.promotedRetryingCount, 1);
        assert.equal(payload.retryLocalizationOutcomes.promotedTargetedOnlyCount, 1);
        assert.equal(payload.retryLocalizationOutcomes.promotedSectionTargetedRate, 1);
        assert.equal(payload.retryLocalizationOutcomes.heuristicRetryingCount, 0);

        assert.equal(payload.coverageRows.length, 2);
        const cadenceRow = payload.coverageRows.find((row) => row.benchmarkId === "cadence_clarity_reference");
        const localizedRow = payload.coverageRows.find((row) => row.benchmarkId === "localized_rewrite_probe");
        assert.ok(cadenceRow);
        assert.ok(localizedRow);
        assert.equal(cadenceRow.runCount, 2);
        assert.equal(cadenceRow.reviewedRunCount, 2);
        assert.equal(cadenceRow.approvalRate, 0.5);
        assert.equal(cadenceRow.selectedWorkerCounts.learned_symbolic, 1);
        assert.equal(cadenceRow.selectedWorkerCounts.music21, 1);
        assert.equal(localizedRow.runCount, 1);
        assert.equal(localizedRow.pendingReviewCount, 1);
        assert.equal(localizedRow.generationModeCounts.targeted_section_rewrite, 1);
        assert.equal(payload.searchBudgetRows.length, 2);
        const s1BudgetRow = payload.searchBudgetRows.find((row) => row.searchBudgetLevel === "S1");
        const s4BudgetRow = payload.searchBudgetRows.find((row) => row.searchBudgetLevel === "S4");
        assert.ok(s1BudgetRow);
        assert.ok(s4BudgetRow);
        assert.equal(s1BudgetRow.wholePieceCandidateCount, 2);
        assert.equal(s1BudgetRow.runCount, 2);
        assert.equal(s1BudgetRow.reviewedRunCount, 2);
        assert.equal(s4BudgetRow.wholePieceCandidateCount, 4);
        assert.equal(s4BudgetRow.runCount, 1);
        assert.equal(s4BudgetRow.pendingReviewCount, 1);

        assert.equal(payload.recentRunRows[0].songId, "song-c");
        assert.equal(payload.recentRunRows[0].selectionMode, "learned_selected");
        assert.equal(payload.recentRunRows[0].retryLocalization, "section_targeted");
        assert.equal(payload.recentRunRows[0].selectedGenerationMode, "targeted_section_rewrite");
        assert.equal(payload.recentRunRows[0].searchBudgetLevel, "S4");
        assert.equal(payload.recentRunRows[0].wholePieceCandidateCount, 4);
        const promotedRow = payload.recentRunRows.find((row) => row.songId === "song-a");
        assert.equal(promotedRow?.promotionApplied, true);
        assert.equal(promotedRow?.disagreementObserved, true);
        assert.equal(promotedRow?.selectionMode, "promoted_learned");
        assert.equal(promotedRow?.counterfactualWorker, "music21");
        assert.equal(promotedRow?.searchBudgetLevel, "S1");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned backbone benchmark summary distinguishes custom whole-piece and mixed search budgets", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-custom-budget-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");
        seedCustomSearchBudgetFixtures(outputsRoot);

        const stdout = execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "summarize-learned-backbone-benchmark.mjs"),
            `--outputDir=${outputsRoot}`,
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim();
        const payload = JSON.parse(stdout);

        assert.equal(payload.ok, true);
        assert.equal(payload.runCount, 2);
        assert.equal(payload.searchBudgetCounts.custom, 2);
        assert.equal(payload.searchBudgetRows.length, 2);

        const customPureRow = payload.searchBudgetRows.find((row) => row.searchBudgetDescriptor === "custom(3)");
        const customMixedRow = payload.searchBudgetRows.find((row) => row.searchBudgetDescriptor === "custom(3+1)");
        assert.ok(customPureRow);
        assert.ok(customMixedRow);
        assert.equal(customPureRow.searchBudgetLevel, "custom");
        assert.equal(customPureRow.wholePieceCandidateCount, 3);
        assert.equal(customPureRow.localizedRewriteBranchCount, 0);
        assert.equal(customPureRow.runCount, 1);
        assert.equal(customMixedRow.searchBudgetLevel, "custom");
        assert.equal(customMixedRow.wholePieceCandidateCount, 3);
        assert.equal(customMixedRow.localizedRewriteBranchCount, 1);
        assert.equal(customMixedRow.runCount, 1);

        assert.equal(payload.reviewQueue.pendingBlindReviewCount, 2);
        assert.equal(payload.reviewQueue.recentPendingRows[0].songId, "song-custom-mixed");
        assert.equal(payload.reviewQueue.recentPendingRows[0].searchBudgetDescriptor, "custom(3+1)");
        assert.equal(payload.reviewQueue.recentPendingRows[1].songId, "song-custom-pure");
        assert.equal(payload.reviewQueue.recentPendingRows[1].searchBudgetDescriptor, "custom(3)");

        assert.equal(payload.recentRunRows[0].songId, "song-custom-mixed");
        assert.equal(payload.recentRunRows[0].searchBudgetDescriptor, "custom(3+1)");
        assert.equal(payload.recentRunRows[0].localizedRewriteBranchCount, 1);
        assert.equal(payload.recentRunRows[1].songId, "song-custom-pure");
        assert.equal(payload.recentRunRows[1].searchBudgetDescriptor, "custom(3)");
        assert.equal(payload.recentRunRows[1].localizedRewriteBranchCount, 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned backbone benchmark summary reads persisted blind review pack results", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-blind-review-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");
        seedLearnedBackboneBenchmarkFixtures(outputsRoot);
        const packResult = seedLearnedBackboneBlindReviewResults(outputsRoot);

        assert.equal(packResult.pairCount, 3);
        assert.equal(packResult.skippedPairCount, 0);

        const stdout = execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "summarize-learned-backbone-benchmark.mjs"),
            `--outputDir=${outputsRoot}`,
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim();
        const payload = JSON.parse(stdout);

        assert.equal(payload.blindPreference.available, true);
        assert.equal(payload.blindPreference.winRate, 0.5);
        assert.equal(payload.blindPreference.reviewedPairCount, 3);
        assert.equal(payload.blindPreference.decisivePairCount, 2);
        assert.equal(payload.blindPreference.learnedWinCount, 1);
        assert.equal(payload.blindPreference.baselineWinCount, 1);
        assert.equal(payload.blindPreference.tieCount, 1);
        assert.equal(payload.blindPreference.latestReviewedAt, "2026-04-19T03:00:00.000Z");
        assert.equal(payload.shortlistBlindPreference.available, true);
        assert.equal(payload.shortlistBlindPreference.winRate, 1);
        assert.equal(payload.shortlistBlindPreference.reviewedPairCount, 1);
        assert.equal(payload.shortlistBlindPreference.decisivePairCount, 1);
        assert.equal(payload.shortlistBlindPreference.learnedWinCount, 1);
        assert.equal(payload.shortlistBlindPreference.baselineWinCount, 0);
        assert.equal(payload.shortlistBlindPreference.tieCount, 0);
        assert.equal(payload.shortlistBlindPreference.latestReviewedAt, "2026-04-19T02:00:00.000Z");
        assert.equal(payload.reviewedTop1Accuracy.available, true);
        assert.equal(payload.reviewedTop1Accuracy.selectedTop1Accuracy, 1);
        assert.equal(payload.reviewedTop1Accuracy.decisiveReviewedPairCount, 2);
        assert.equal(payload.reviewedTop1Accuracy.correctSelectionCount, 2);
        assert.equal(payload.reviewedTop1Accuracy.learnedSelectedTop1Accuracy, 1);
        assert.equal(payload.reviewedTop1Accuracy.baselineSelectedTop1Accuracy, 1);
        assert.equal(payload.reviewedTop1Accuracy.promotedTop1Accuracy, 1);
        assert.equal(payload.reviewedTop1Accuracy.latestReviewedAt, "2026-04-19T03:00:00.000Z");
        assert.equal(payload.reviewQueue.pendingBlindReviewCount, 0);
        assert.equal(payload.reviewQueue.pendingShortlistReviewCount, 0);
        assert.equal(payload.reviewQueue.latestPendingAt, null);
        assert.deepEqual(payload.reviewQueue.recentPendingRows, []);
        assert.equal(payload.reviewPacks.matchedPackCount, 1);
        assert.equal(payload.reviewPacks.activePackCount, 0);
        assert.equal(payload.reviewPacks.pendingDecisionCount, 0);
        assert.equal(payload.reviewPacks.completedDecisionCount, 3);
        assert.equal(payload.reviewPacks.latestReviewedAt, "2026-04-19T03:00:00.000Z");
        assert.deepEqual(payload.reviewPacks.recentActivePacks, []);
        const s1BudgetRow = payload.searchBudgetRows.find((row) => row.searchBudgetLevel === "S1");
        const s4BudgetRow = payload.searchBudgetRows.find((row) => row.searchBudgetLevel === "S4");
        assert.ok(s1BudgetRow);
        assert.ok(s4BudgetRow);
        assert.equal(s1BudgetRow.blindPreferenceWinRate, 0.5);
        assert.equal(s1BudgetRow.selectedTop1Accuracy, 1);
        assert.equal(s1BudgetRow.decisivePairCount, 2);
        assert.equal(s1BudgetRow.correctSelectionCount, 2);
        assert.equal(s4BudgetRow.blindPreferenceWinRate, null);
        assert.equal(s4BudgetRow.selectedTop1Accuracy, null);
        assert.equal(payload.promotionGate.status, "experimental");
        assert.equal(payload.promotionGate.signal, "positive");
        assert.equal(payload.promotionGate.minimumReviewedSelectedInShortlistRate, 0.6);
        assert.equal(payload.promotionGate.reviewedSelectedInShortlistRate, 0.5);
        assert.equal(payload.promotionGate.reviewedSelectedTop1Rate, 0.5);
        assert.equal(payload.promotionGate.meetsReviewedSelectedInShortlistMinimum, false);
        assert.equal(payload.promotionGate.retryLocalizationStable, true);
        assert.equal(payload.promotionGate.blindPreferenceAvailable, true);
        assert.ok(payload.promotionGate.blockers.includes("shortlist_quality_below_floor"));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned backbone benchmark summary carries review pack search-budget scope", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-pack-scope-"));

    try {
        const outputsRoot = path.join(tempRoot, "outputs");
        seedCustomSearchBudgetFixtures(outputsRoot);

        execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "create-learned-backbone-review-pack.mjs"),
            `--outputDir=${outputsRoot}`,
            "--snapshot=custom-budget-scope-v1",
            "--labelSeed=fixed-seed",
            "--pendingOnly",
            "--searchBudget=custom(3)",
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim();

        const stdout = execFileSync(process.execPath, [
            path.join(repoRoot, "scripts", "summarize-learned-backbone-benchmark.mjs"),
            `--outputDir=${outputsRoot}`,
        ], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim();
        const payload = JSON.parse(stdout);

        assert.equal(payload.reviewPacks.matchedPackCount, 1);
        assert.equal(payload.reviewPacks.activePackCount, 1);
        assert.equal(payload.reviewPacks.recentActivePacks[0].packId, "custom-budget-scope-v1");
        assert.equal(payload.reviewPacks.recentActivePacks[0].searchBudget, "custom(3)");
        assert.equal(payload.reviewPacks.recentActivePacks[0].entryCount, 1);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});