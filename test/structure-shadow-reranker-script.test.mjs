import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)))

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function writeJsonl(filePath, rows) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const content = rows.map((row) => JSON.stringify(row)).join("\n")
    fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf8")
}

function countRoleCollapseWarnings(values) {
    return (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .filter((value) => value.toLowerCase().includes("role collapse"))
        .length
}

function makeExample({
    exampleId,
    groupId,
    candidateId,
    songId,
    attempt,
    selectedWithinGroup,
    score,
    sectionArtifactCount,
    sectionTonalityCount,
    phraseBreathCueCount,
    tempoMotionCueCount,
    ornamentCueCount,
    harmonicColorCueCount,
    hasCompositionPlan,
    hasSectionArtifacts,
    structureIssues,
    structureStrengths,
    worker = "music21",
    provider = "python",
    model = "music21-symbolic-v1",
    proposalEvidence,
    lineage,
    reviewSignals,
    labels,
    featureAvailability,
}) {
    const normalizedProposalEvidence = proposalEvidence && typeof proposalEvidence === "object"
        ? proposalEvidence
        : undefined
    const normalizedProposalWarnings = Array.isArray(normalizedProposalEvidence?.normalizationWarnings)
        ? normalizedProposalEvidence.normalizationWarnings.map((value) => String(value ?? "").trim()).filter(Boolean)
        : []
    const normalizationWarningCount = normalizedProposalWarnings.length > 0
        ? normalizedProposalWarnings.length
        : (typeof normalizedProposalEvidence?.normalizationWarningCount === "number" ? normalizedProposalEvidence.normalizationWarningCount : 0)
    const roleCollapseWarningCount = countRoleCollapseWarnings(normalizedProposalWarnings)
    const normalizedLineage = lineage && typeof lineage === "object"
        ? lineage
        : {}
    const normalizedReviewSignals = reviewSignals && typeof reviewSignals === "object"
        ? reviewSignals
        : undefined
    const normalizedLabels = labels && typeof labels === "object"
        ? labels
        : {}
    const normalizedFeatureAvailability = featureAvailability && typeof featureAvailability === "object"
        ? featureAvailability
        : {}
    const hasInputDirectiveContext = normalizedFeatureAvailability.hasInputDirectiveContext ?? Boolean(
        normalizedLineage.retriedFromAttempt !== undefined
        || (Array.isArray(normalizedLineage.inputDirectiveKinds) && normalizedLineage.inputDirectiveKinds.length > 0)
        || (Array.isArray(normalizedLineage.inputDirectiveSectionIds) && normalizedLineage.inputDirectiveSectionIds.length > 0)
        || (typeof normalizedLineage.retryLocalization === "string" && normalizedLineage.retryLocalization !== "none"),
    )

    return {
        datasetVersion: "structure_rank_v1",
        exampleId,
        groupId,
        candidateId,
        songId,
        attempt,
        createdAt: "2026-04-17T06:00:00.000Z",
        source: "autonomy",
        worker,
        provider,
        model,
        workflow: "symbolic_only",
        planSummary: {
            form: "miniature",
            meter: "4/4",
            key: "C major",
            tempo: 92,
            sectionCount: 3,
            sectionRoles: ["theme_a", "cadence"],
            phraseFunctions: ["presentation", "cadential"],
            counterpointModes: [],
            harmonicColorTags: harmonicColorCueCount > 0 ? ["mixture"] : [],
            longSpanRequested: false,
        },
        lineage: {
            promptHash: `${groupId}-prompt`,
            plannerVersion: "planner-v1",
            selectedAttempt: selectedWithinGroup ? attempt : 1,
            priorDirectiveKinds: [],
            inputDirectiveKinds: [],
            inputDirectiveSectionIds: [],
            retryLocalization: "none",
            recoveredFromRestart: false,
            ...normalizedLineage,
        },
        featureAvailability: {
            hasSelectedStructureReport: true,
            hasAttemptMetrics: true,
            hasAttemptWeakestSections: false,
            hasSectionArtifacts,
            hasExpressionPlan: false,
            hasCompositionPlan,
            hasProposalEvidence: Boolean(normalizedProposalEvidence),
            hasLearnedProposalEvidence: normalizedProposalEvidence?.worker === "learned_symbolic",
            hasProposalLane: Boolean(normalizedProposalEvidence?.lane),
            hasProposalSummary: Boolean(normalizedProposalEvidence?.summary),
            hasProposalNormalizationWarnings: normalizationWarningCount > 0,
            hasProposalRoleCollapseWarnings: roleCollapseWarningCount > 0,
            hasInputDirectiveContext,
            selectedAttemptFeatureRich: hasCompositionPlan || hasSectionArtifacts,
            derivedFromSyntheticAttempt: false,
            ...normalizedFeatureAvailability,
        },
        structure: {
            passed: true,
            score,
            issues: Array.isArray(structureIssues)
                ? structureIssues
                : (selectedWithinGroup ? ["lower raw score but richer realized cues"] : []),
            strengths: Array.isArray(structureStrengths)
                ? structureStrengths
                : (selectedWithinGroup ? ["rich symbolic cue coverage"] : []),
            metrics: {},
            weakestSections: [],
        },
        symbolicArtifacts: {
            sectionArtifactCount,
            sectionTonalityCount,
            phraseBreathCueCount,
            tempoMotionCueCount,
            ornamentCueCount,
            harmonicColorCueCount,
        },
        labels: {
            selectedWithinGroup,
            finalSelectedAttempt: selectedWithinGroup,
            approvedOutcome: selectedWithinGroup ? true : undefined,
            appealScore: selectedWithinGroup ? 8.8 : 6.4,
            pairwiseWins: selectedWithinGroup ? 1 : 0,
            pairwiseLosses: selectedWithinGroup ? 0 : 1,
            ...normalizedLabels,
        },
        ...(normalizedReviewSignals ? { reviewSignals: normalizedReviewSignals } : {}),
        ...(normalizedProposalEvidence ? { proposalEvidence: normalizedProposalEvidence } : {}),
        ...(normalizedProposalEvidence
            ? {
                proposalWarningSignals: {
                    normalizationWarningCount,
                    roleCollapseWarningCount,
                },
            }
            : {}),
        artifacts: {
            manifestPath: path.join("outputs", songId, "manifest.json"),
        },
    }
}

test("evaluate-structure-reranker-shadow trains an explainable reranker and reports disagreements", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-shadow-reranker-"))
    const outputRoot = path.join(tempRoot, "outputs")
    const snapshotId = "shadow-test"
    const datasetRoot = path.join(outputRoot, "_system", "ml", "datasets", "structure-rank-v1", snapshotId)

    try {
        writeJson(path.join(datasetRoot, "manifest.json"), {
            ok: true,
            datasetVersion: "structure_rank_v1",
            snapshotId,
        })

        const trainRows = [
            makeExample({
                exampleId: "train-g1-a",
                groupId: "g1",
                candidateId: "g1-a",
                songId: "song-g1",
                attempt: 1,
                selectedWithinGroup: true,
                score: 72,
                sectionArtifactCount: 3,
                sectionTonalityCount: 3,
                phraseBreathCueCount: 5,
                tempoMotionCueCount: 2,
                ornamentCueCount: 1,
                harmonicColorCueCount: 2,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
            }),
            makeExample({
                exampleId: "train-g1-b",
                groupId: "g1",
                candidateId: "g1-b",
                songId: "song-g1",
                attempt: 2,
                selectedWithinGroup: false,
                score: 91,
                sectionArtifactCount: 0,
                sectionTonalityCount: 0,
                phraseBreathCueCount: 0,
                tempoMotionCueCount: 0,
                ornamentCueCount: 0,
                harmonicColorCueCount: 0,
                hasCompositionPlan: false,
                hasSectionArtifacts: false,
            }),
            makeExample({
                exampleId: "train-g2-a",
                groupId: "g2",
                candidateId: "g2-a",
                songId: "song-g2",
                attempt: 1,
                selectedWithinGroup: true,
                score: 74,
                sectionArtifactCount: 4,
                sectionTonalityCount: 3,
                phraseBreathCueCount: 6,
                tempoMotionCueCount: 2,
                ornamentCueCount: 1,
                harmonicColorCueCount: 3,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
            }),
            makeExample({
                exampleId: "train-g2-b",
                groupId: "g2",
                candidateId: "g2-b",
                songId: "song-g2",
                attempt: 2,
                selectedWithinGroup: false,
                score: 89,
                sectionArtifactCount: 0,
                sectionTonalityCount: 0,
                phraseBreathCueCount: 0,
                tempoMotionCueCount: 0,
                ornamentCueCount: 0,
                harmonicColorCueCount: 0,
                hasCompositionPlan: false,
                hasSectionArtifacts: false,
            }),
        ]

        const valRows = [
            makeExample({
                exampleId: "val-g3-a",
                groupId: "g3",
                candidateId: "g3-a",
                songId: "song-g3",
                attempt: 1,
                selectedWithinGroup: true,
                score: 73,
                sectionArtifactCount: 3,
                sectionTonalityCount: 3,
                phraseBreathCueCount: 4,
                tempoMotionCueCount: 2,
                ornamentCueCount: 1,
                harmonicColorCueCount: 2,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
            }),
            makeExample({
                exampleId: "val-g3-b",
                groupId: "g3",
                candidateId: "g3-b",
                songId: "song-g3",
                attempt: 2,
                selectedWithinGroup: false,
                score: 90,
                sectionArtifactCount: 0,
                sectionTonalityCount: 0,
                phraseBreathCueCount: 0,
                tempoMotionCueCount: 0,
                ornamentCueCount: 0,
                harmonicColorCueCount: 0,
                hasCompositionPlan: false,
                hasSectionArtifacts: false,
            }),
        ]

        const testRows = [
            makeExample({
                exampleId: "test-g4-a",
                groupId: "g4",
                candidateId: "g4-a",
                songId: "song-g4",
                attempt: 1,
                selectedWithinGroup: true,
                score: 71,
                sectionArtifactCount: 3,
                sectionTonalityCount: 3,
                phraseBreathCueCount: 5,
                tempoMotionCueCount: 3,
                ornamentCueCount: 1,
                harmonicColorCueCount: 2,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
            }),
            makeExample({
                exampleId: "test-g4-b",
                groupId: "g4",
                candidateId: "g4-b",
                songId: "song-g4",
                attempt: 2,
                selectedWithinGroup: false,
                score: 92,
                sectionArtifactCount: 0,
                sectionTonalityCount: 0,
                phraseBreathCueCount: 0,
                tempoMotionCueCount: 0,
                ornamentCueCount: 0,
                harmonicColorCueCount: 0,
                hasCompositionPlan: false,
                hasSectionArtifacts: false,
            }),
        ]

        writeJsonl(path.join(datasetRoot, "train.jsonl"), trainRows)
        writeJsonl(path.join(datasetRoot, "val.jsonl"), valRows)
        writeJsonl(path.join(datasetRoot, "test.jsonl"), testRows)

        const stdout = execFileSync(
            process.execPath,
            [
                "scripts/evaluate-structure-reranker-shadow.mjs",
                "--root",
                outputRoot,
                "--snapshot",
                snapshotId,
            ],
            {
                cwd: repoRoot,
                encoding: "utf8",
            },
        )

        const payload = JSON.parse(stdout.trim())
        assert.equal(payload.ok, true)
        assert.equal(payload.datasetVersion, "structure_rank_v1")
        assert.equal(payload.training.trainPairCount, 2)
        assert.equal(payload.splitMetrics.test.heuristicTop1Accuracy, 0)
        assert.equal(payload.splitMetrics.test.learnedTop1Accuracy, 1)
        assert.equal(payload.disagreementSummary.count >= 1, true)
        assert.equal(payload.calibration.testBins.some((entry) => entry.count > 0), true)
        assert.equal(payload.modelSummary.topPositive.length > 0, true)

        const evaluationRoot = path.join(outputRoot, "_system", "ml", "evaluations", "structure-rank-v1", snapshotId)
        const disagreementsPath = path.join(evaluationRoot, "shadow-reranker-disagreements.jsonl")
        const disagreementRows = fs.readFileSync(disagreementsPath, "utf8")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line))

        assert.equal(disagreementRows.length >= 1, true)
        assert.equal(typeof disagreementRows[0].explanation?.summary, "string")
        assert.equal(Array.isArray(disagreementRows[0].explanation?.topFeatures), true)
        assert.equal(disagreementRows[0].candidates.length, 2)
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true })
    }
})

test("evaluate-structure-reranker-shadow learns proposal-evidence features for the hybrid learned lane", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-shadow-reranker-proposal-"))
    const outputRoot = path.join(tempRoot, "outputs")
    const snapshotId = "shadow-proposal"
    const datasetRoot = path.join(outputRoot, "_system", "ml", "datasets", "structure-rank-v1", snapshotId)

    try {
        writeJson(path.join(datasetRoot, "manifest.json"), {
            ok: true,
            datasetVersion: "structure_rank_v1",
            snapshotId,
        })

        const learnedProposalEvidence = {
            worker: "learned_symbolic",
            lane: "string_trio_symbolic",
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
        }

        const trainRows = [
            makeExample({
                exampleId: "train-p1-a",
                groupId: "p1",
                candidateId: "p1-a",
                songId: "song-p1",
                attempt: 1,
                selectedWithinGroup: true,
                score: 72,
                sectionArtifactCount: 2,
                sectionTonalityCount: 2,
                phraseBreathCueCount: 2,
                tempoMotionCueCount: 1,
                ornamentCueCount: 0,
                harmonicColorCueCount: 1,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                proposalEvidence: learnedProposalEvidence,
            }),
            makeExample({
                exampleId: "train-p1-b",
                groupId: "p1",
                candidateId: "p1-b",
                songId: "song-p1",
                attempt: 2,
                selectedWithinGroup: false,
                score: 91,
                sectionArtifactCount: 2,
                sectionTonalityCount: 2,
                phraseBreathCueCount: 2,
                tempoMotionCueCount: 1,
                ornamentCueCount: 0,
                harmonicColorCueCount: 1,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
            }),
            makeExample({
                exampleId: "train-p2-a",
                groupId: "p2",
                candidateId: "p2-a",
                songId: "song-p2",
                attempt: 1,
                selectedWithinGroup: true,
                score: 73,
                sectionArtifactCount: 2,
                sectionTonalityCount: 2,
                phraseBreathCueCount: 2,
                tempoMotionCueCount: 1,
                ornamentCueCount: 0,
                harmonicColorCueCount: 1,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                proposalEvidence: learnedProposalEvidence,
            }),
            makeExample({
                exampleId: "train-p2-b",
                groupId: "p2",
                candidateId: "p2-b",
                songId: "song-p2",
                attempt: 2,
                selectedWithinGroup: false,
                score: 92,
                sectionArtifactCount: 2,
                sectionTonalityCount: 2,
                phraseBreathCueCount: 2,
                tempoMotionCueCount: 1,
                ornamentCueCount: 0,
                harmonicColorCueCount: 1,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
            }),
        ]

        const valRows = [
            makeExample({
                exampleId: "val-p3-a",
                groupId: "p3",
                candidateId: "p3-a",
                songId: "song-p3",
                attempt: 1,
                selectedWithinGroup: true,
                score: 71,
                sectionArtifactCount: 2,
                sectionTonalityCount: 2,
                phraseBreathCueCount: 2,
                tempoMotionCueCount: 1,
                ornamentCueCount: 0,
                harmonicColorCueCount: 1,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                proposalEvidence: learnedProposalEvidence,
            }),
            makeExample({
                exampleId: "val-p3-b",
                groupId: "p3",
                candidateId: "p3-b",
                songId: "song-p3",
                attempt: 2,
                selectedWithinGroup: false,
                score: 90,
                sectionArtifactCount: 2,
                sectionTonalityCount: 2,
                phraseBreathCueCount: 2,
                tempoMotionCueCount: 1,
                ornamentCueCount: 0,
                harmonicColorCueCount: 1,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
            }),
        ]

        const testRows = [
            makeExample({
                exampleId: "test-p4-a",
                groupId: "p4",
                candidateId: "p4-a",
                songId: "song-p4",
                attempt: 1,
                selectedWithinGroup: true,
                score: 70,
                sectionArtifactCount: 2,
                sectionTonalityCount: 2,
                phraseBreathCueCount: 2,
                tempoMotionCueCount: 1,
                ornamentCueCount: 0,
                harmonicColorCueCount: 1,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                proposalEvidence: learnedProposalEvidence,
            }),
            makeExample({
                exampleId: "test-p4-b",
                groupId: "p4",
                candidateId: "p4-b",
                songId: "song-p4",
                attempt: 2,
                selectedWithinGroup: false,
                score: 93,
                sectionArtifactCount: 2,
                sectionTonalityCount: 2,
                phraseBreathCueCount: 2,
                tempoMotionCueCount: 1,
                ornamentCueCount: 0,
                harmonicColorCueCount: 1,
                hasCompositionPlan: true,
                hasSectionArtifacts: true,
            }),
        ]

        writeJsonl(path.join(datasetRoot, "train.jsonl"), trainRows)
        writeJsonl(path.join(datasetRoot, "val.jsonl"), valRows)
        writeJsonl(path.join(datasetRoot, "test.jsonl"), testRows)

        const stdout = execFileSync(
            process.execPath,
            [
                "scripts/evaluate-structure-reranker-shadow.mjs",
                "--root",
                outputRoot,
                "--snapshot",
                snapshotId,
            ],
            {
                cwd: repoRoot,
                encoding: "utf8",
            },
        )

        const payload = JSON.parse(stdout.trim())
        assert.equal(payload.ok, true)
        assert.equal(payload.splitMetrics.test.heuristicTop1Accuracy, 0)
        assert.equal(payload.splitMetrics.test.learnedTop1Accuracy, 1)
        assert.equal(
            payload.modelSummary.topPositive.some((entry) => entry.feature.startsWith("hasProposal") || entry.feature.startsWith("proposal")),
            true,
        )

        const evaluationRoot = path.join(outputRoot, "_system", "ml", "evaluations", "structure-rank-v1", snapshotId)
        const model = JSON.parse(fs.readFileSync(path.join(evaluationRoot, "shadow-reranker-model.json"), "utf8"))
        const disagreementRows = fs.readFileSync(path.join(evaluationRoot, "shadow-reranker-disagreements.jsonl"), "utf8")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line))

        assert.equal(disagreementRows.length >= 1, true)
        assert.equal(model.featureNames.includes("proposalRoleCollapseWarningCount"), true)
        assert.equal(model.featureNames.includes("hasProposalRoleCollapseWarnings"), true)
        assert.equal(
            model.weights.some((entry) => entry.feature === "proposalRoleCollapseWarningCount" && entry.weight > 0),
            true,
        )
        assert.equal(
            disagreementRows[0].explanation.topFeatures.some((entry) => entry.feature.startsWith("hasProposal") || entry.feature.startsWith("proposal")),
            true,
        )
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true })
    }
})

test("evaluate-structure-reranker-shadow shows feedback-aware gains on reviewed retry groups over static weights", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-shadow-reranker-feedback-"))
    const outputRoot = path.join(tempRoot, "outputs")
    const snapshotId = "shadow-feedback"
    const datasetRoot = path.join(outputRoot, "_system", "ml", "datasets", "structure-rank-v1", snapshotId)

    try {
        writeJson(path.join(datasetRoot, "manifest.json"), {
            ok: true,
            datasetVersion: "structure_rank_v1",
            snapshotId,
        })

        const approvedReviewSignals = {
            approvalStatus: "approved",
            appealScore: 9.4,
            selectedAttemptWasRetry: true,
        }
        const rejectedReviewSignals = {
            approvalStatus: "rejected",
            appealScore: 2.4,
            selectedAttemptWasRetry: false,
        }
        const retryWinnerLineage = {
            selectedAttempt: 2,
            inputDirectiveKinds: ["clarify_texture_plan"],
            inputDirectiveSectionIds: ["development"],
            retryLocalization: "section_targeted_only",
            retriedFromAttempt: 1,
        }

        function makeRetryWinnerPair(prefix, review, selectedRetryWinner) {
            const sharedRowShape = {
                sectionArtifactCount: 0,
                sectionTonalityCount: 0,
                phraseBreathCueCount: 0,
                tempoMotionCueCount: 0,
                ornamentCueCount: 0,
                harmonicColorCueCount: 0,
                hasCompositionPlan: false,
                hasSectionArtifacts: false,
                structureIssues: [],
                structureStrengths: [],
            }

            const retryWinner = makeExample({
                exampleId: `${prefix}-retry`,
                groupId: prefix,
                candidateId: `${prefix}-retry`,
                songId: `song-${prefix}`,
                attempt: 2,
                selectedWithinGroup: selectedRetryWinner,
                score: 72,
                ...sharedRowShape,
                lineage: retryWinnerLineage,
                reviewSignals: review,
                labels: {
                    approvedOutcome: review.approvalStatus === "approved" ? true : undefined,
                    rejectedOutcome: review.approvalStatus === "rejected" ? true : undefined,
                    appealScore: review.appealScore,
                },
            })
            const highScoreCandidate = makeExample({
                exampleId: `${prefix}-static`,
                groupId: prefix,
                candidateId: `${prefix}-static`,
                songId: `song-${prefix}`,
                attempt: 1,
                selectedWithinGroup: !selectedRetryWinner,
                score: 93,
                ...sharedRowShape,
                reviewSignals: review,
                labels: {
                    approvedOutcome: review.approvalStatus === "approved" ? true : undefined,
                    rejectedOutcome: review.approvalStatus === "rejected" ? true : undefined,
                    appealScore: review.appealScore,
                },
            })

            return [retryWinner, highScoreCandidate]
        }

        const trainRows = [
            ...makeRetryWinnerPair("fb-a1", approvedReviewSignals, true),
            ...makeRetryWinnerPair("fb-a2", approvedReviewSignals, true),
            ...makeRetryWinnerPair("fb-r1", rejectedReviewSignals, false),
            ...makeRetryWinnerPair("fb-r2", rejectedReviewSignals, false),
            ...makeRetryWinnerPair("fb-r3", rejectedReviewSignals, false),
            ...makeRetryWinnerPair("fb-r4", rejectedReviewSignals, false),
        ]

        const valRows = makeRetryWinnerPair("fb-v1", approvedReviewSignals, true)
        const testRows = makeRetryWinnerPair("fb-t1", approvedReviewSignals, true)

        writeJsonl(path.join(datasetRoot, "train.jsonl"), trainRows)
        writeJsonl(path.join(datasetRoot, "val.jsonl"), valRows)
        writeJsonl(path.join(datasetRoot, "test.jsonl"), testRows)

        const stdout = execFileSync(
            process.execPath,
            [
                "scripts/evaluate-structure-reranker-shadow.mjs",
                "--root",
                outputRoot,
                "--snapshot",
                snapshotId,
            ],
            {
                cwd: repoRoot,
                encoding: "utf8",
            },
        )

        const payload = JSON.parse(stdout.trim())
        assert.equal(payload.ok, true)
        assert.equal(payload.modelMode, "feedback_aware")
        assert.equal(payload.training.weightingMode, "review_feedback")
        assert.equal(payload.baselineStatic.modelMode, "static")
        assert.equal(payload.baselineStatic.training.weightingMode, "uniform")
        assert.equal(payload.baselineStatic.splitMetrics.test.learnedTop1Accuracy, 0)
        assert.equal(payload.splitMetrics.test.learnedTop1Accuracy, 1)
        assert.equal(payload.baselineStatic.splitMetrics.test.reviewMetrics.retryingReviewedGroups.learnedAppealWeightedTop1Accuracy, 0)
        assert.equal(payload.splitMetrics.test.reviewMetrics.retryingReviewedGroups.learnedAppealWeightedTop1Accuracy, 1)
        assert.equal(payload.feedbackComparison.improved, true)
        assert.equal(payload.feedbackComparison.strongestImprovement.scope, "retrying_reviewed_groups")
        assert.equal(payload.feedbackComparison.strongestImprovement.metric, "appealWeightedTop1Accuracy")
        assert.equal(payload.feedbackComparison.strongestImprovement.baseline, 0)
        assert.equal(payload.feedbackComparison.strongestImprovement.feedbackAware, 1)
        assert.equal(
            payload.feedbackFeatureSummary.topPositive.some(
                (entry) => entry.feature === "retryLocalization:section_targeted_only"
                    || entry.feature === "inputDirectiveKind:clarify_texture_plan",
            ),
            true,
        )
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true })
    }
})