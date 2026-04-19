import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runNodeEval, parseLastJsonLine } from "./helpers/subprocess.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const learnedBackboneBenchmarkPackVersion = "string_trio_symbolic_benchmark_pack_v1";
const learnedBackbonePromptPackVersion = "learned_symbolic_prompt_pack_v1";

function createTempRuntimeRoot(prefix) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    return { tempRoot, outputDir, logDir };
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function seedPendingApprovalManifest(outputDir, overrides = {}) {
    const songId = overrides.songId || "pending-song";
    const updatedAt = overrides.updatedAt || "2026-04-10T03:05:00.000Z";
    const manifestDir = path.join(outputDir, songId);
    const manifest = {
        songId,
        state: "DONE",
        meta: {
            songId,
            prompt: overrides.prompt || "approval queue item",
            form: overrides.form || "miniature",
            source: "autonomy",
            autonomyRunId: overrides.runId || "run-pending",
            promptHash: overrides.promptHash || "hash-pending",
            createdAt: overrides.createdAt || "2026-04-10T03:00:00.000Z",
            updatedAt,
        },
        artifacts: { midi: `outputs/${songId}/composition.mid` },
        approvalStatus: overrides.approvalStatus || "pending",
        ...(overrides.reviewFeedback ? { reviewFeedback: overrides.reviewFeedback } : {}),
        selfAssessment: {
            qualityScore: overrides.qualityScore ?? 0.84,
        },
        ...(overrides.qualityControl ? { qualityControl: overrides.qualityControl } : {}),
        structureEvaluation: overrides.structureEvaluation || {
            passed: false,
            score: 76,
            issues: ["Long-span return remains weak."],
            strengths: ["Opening identity holds."],
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
        audioEvaluation: overrides.audioEvaluation || {
            passed: false,
            score: 69,
            issues: ["Rendered audio still blurs the delayed tonal return."],
            strengths: ["Rendered audio still preserves some development lift."],
            metrics: {
                audioDevelopmentNarrativeFit: 0.52,
                audioRecapRecallFit: 0.49,
                audioHarmonicRouteRenderFit: 0.54,
                audioTonalReturnRenderFit: 0.47,
                audioChromaHarmonicRouteFit: 0.5,
                audioDevelopmentKeyDriftFit: 0.46,
                audioPhraseBreathPlanFit: 0.48,
                audioPhraseBreathCoverageFit: 0.5,
                audioPhraseBreathPickupFit: 0.44,
                audioPhraseBreathArrivalFit: 0.34,
                audioPhraseBreathReleaseFit: 0.38,
                harmonicColorPlanFit: 0.42,
                harmonicColorCoverageFit: 0.46,
                harmonicColorTargetFit: 0.35,
                harmonicColorTimingFit: 0.4,
                tonicizationPressureFit: 0.38,
                prolongationMotionFit: 0.44,
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
        stateHistory: [
            { state: "IDLE", timestamp: "2026-04-10T03:00:00.000Z" },
            { state: "COMPOSE", timestamp: "2026-04-10T03:00:01.000Z" },
            { state: "DONE", timestamp: updatedAt },
        ],
        updatedAt,
    };

    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(path.join(manifestDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

function createApprovedOrchestrationStructureEvaluation() {
    return {
        passed: true,
        score: 84,
        issues: [],
        strengths: ["String-trio writing stays idiomatic across the form."],
        metrics: {
            longSpanDevelopmentPressureFit: 0.79,
            longSpanThematicTransformationFit: 0.82,
            longSpanHarmonicTimingFit: 0.77,
            longSpanReturnPayoffFit: 0.81,
        },
        longSpan: {
            status: "stable",
            weakestDimension: "development_pressure",
            weakDimensions: [],
            averageFit: 0.7975,
            thematicCheckpointCount: 2,
            expectedDevelopmentPressure: "high",
            expectedReturnPayoff: "inevitable",
            developmentPressureFit: 0.79,
            thematicTransformationFit: 0.82,
            harmonicTimingFit: 0.77,
            returnPayoffFit: 0.81,
        },
        orchestration: {
            family: "string_trio",
            idiomaticRangeFit: 0.89,
            registerBalanceFit: 0.86,
            ensembleConversationFit: 0.82,
            doublingPressureFit: 0.8,
            textureRotationFit: 0.77,
            weakSectionIds: ["s2"],
            instrumentNames: ["violin", "viola", "cello"],
        },
    };
}

function createStrongPhraseBreathAudioEvaluation() {
    return {
        passed: true,
        score: 83,
        issues: [],
        strengths: ["Phrase-breath timing survives clearly through humanization."],
        metrics: {
            audioDevelopmentNarrativeFit: 0.72,
            audioRecapRecallFit: 0.7,
            audioHarmonicRouteRenderFit: 0.74,
            audioTonalReturnRenderFit: 0.71,
            audioChromaHarmonicRouteFit: 0.7,
            audioDevelopmentKeyDriftFit: 0.68,
            audioPhraseBreathPlanFit: 0.84,
            audioPhraseBreathCoverageFit: 0.81,
            audioPhraseBreathPickupFit: 0.78,
            audioPhraseBreathArrivalFit: 0.86,
            audioPhraseBreathReleaseFit: 0.79,
            harmonicColorPlanFit: 0.82,
            harmonicColorCoverageFit: 0.78,
            harmonicColorTargetFit: 0.8,
            harmonicColorTimingFit: 0.76,
            tonicizationPressureFit: 0.74,
            prolongationMotionFit: 0.79,
        },
        longSpan: {
            status: "held",
            weakestDimension: "recap_recall",
            weakDimensions: [],
            averageFit: 0.705,
            developmentNarrativeFit: 0.72,
            recapRecallFit: 0.7,
            harmonicRouteFit: 0.74,
            tonalReturnFit: 0.71,
        },
    };
}

function createReviewOnlyStructureEvaluation() {
    return {
        passed: false,
        score: 70,
        issues: ["Review-only shadow-reranker fixture."],
        strengths: [],
        metrics: {},
    };
}

function createReviewOnlyAudioEvaluation() {
    return {
        passed: false,
        score: 68,
        issues: ["Review-only shadow-reranker fixture."],
        strengths: [],
        metrics: {},
    };
}

function buildLearnedBackboneCandidateEntry({
    outputDir,
    songId,
    candidateId,
    selected,
    worker,
    provider,
    model,
    attempt,
    evaluatedAt,
    proposalEvidence,
    revisionDirectives = [],
}) {
    const manifestPath = path.join(outputDir, songId, "candidates", candidateId, "candidate-manifest.json");
    writeJson(manifestPath, {
        version: 1,
        stage: "structure",
        songId,
        candidateId,
        attempt,
        selected,
        evaluatedAt,
        workflow: "symbolic_only",
        worker,
        provider,
        model,
        revisionDirectives,
        ...(proposalEvidence ? { proposalEvidence } : {}),
        artifacts: {},
    });

    return {
        candidateId,
        attempt,
        stage: "structure",
        selected,
        workflow: "symbolic_only",
        worker,
        provider,
        model,
        passed: true,
        score: selected ? 88 : 84,
        evaluatedAt,
        manifestPath,
        ...(proposalEvidence ? { proposalEvidence } : {}),
    };
}

function seedLearnedBackboneBenchmarkReviewedFixtures(outputDir) {
    const benchmarkId = "stage-b-string-trio";
    const benchmarkSongs = [
        {
            songId: "benchmark-approved-song",
            approvalStatus: "approved",
            appealScore: 0.93,
            updatedAt: "2026-04-17T04:07:00.000Z",
            selectedRevisionDirectives: [{ kind: "clarify_phrase_rhetoric", sectionIds: ["s2"] }],
        },
        {
            songId: "benchmark-rejected-song",
            approvalStatus: "rejected",
            appealScore: 0.31,
            updatedAt: "2026-04-17T04:08:00.000Z",
            weakestDimension: "cadence_release",
            selectedRevisionDirectives: [{ kind: "increase_rhythm_variety" }],
        },
    ];

    for (const item of benchmarkSongs) {
        writeJson(path.join(outputDir, item.songId, "manifest.json"), {
            songId: item.songId,
            state: "DONE",
            approvalStatus: item.approvalStatus,
            reviewFeedback: {
                appealScore: item.appealScore,
                reviewRubricVersion: "approval_review_rubric_v1",
                ...(item.weakestDimension ? { weakestDimension: item.weakestDimension } : {}),
            },
            meta: {
                songId: item.songId,
                prompt: item.songId,
                form: "string trio miniature",
                workflow: "symbolic_only",
                source: "autonomy",
                autonomyRunId: `run-${item.songId}`,
                promptHash: `hash-${item.songId}`,
                createdAt: item.updatedAt,
                updatedAt: item.updatedAt,
            },
            artifacts: {
                midi: `outputs/${item.songId}/composition.mid`,
            },
            selfAssessment: {
                qualityScore: 0.5,
            },
            structureEvaluation: createReviewOnlyStructureEvaluation(),
            audioEvaluation: createReviewOnlyAudioEvaluation(),
            qualityControl: {
                selectedAttempt: 1,
                attempts: [],
            },
            stateHistory: [
                { state: "IDLE", timestamp: item.updatedAt },
                { state: "DONE", timestamp: item.updatedAt },
            ],
            updatedAt: item.updatedAt,
        });

        const baselineCandidateId = `${item.songId}-baseline`;
        const learnedCandidateId = `${item.songId}-learned`;
        const learnedEntry = buildLearnedBackboneCandidateEntry({
            outputDir,
            songId: item.songId,
            candidateId: learnedCandidateId,
            selected: false,
            worker: "learned_symbolic",
            provider: "learned",
            model: "learned-symbolic-trio-v1",
            attempt: 1,
            evaluatedAt: item.updatedAt,
            proposalEvidence: {
                worker: "learned_symbolic",
                lane: "string_trio_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                benchmarkPackVersion: learnedBackboneBenchmarkPackVersion,
                benchmarkId,
                promptPackVersion: learnedBackbonePromptPackVersion,
                planSignature: "lane=string_trio_symbolic|sig=stage-b-reviewed",
                generationMode: "plan_conditioned_trio_template",
            },
        });
        const baselineEntry = buildLearnedBackboneCandidateEntry({
            outputDir,
            songId: item.songId,
            candidateId: baselineCandidateId,
            selected: true,
            worker: "music21",
            provider: "python",
            model: "music21-symbolic-v1",
            attempt: 1,
            evaluatedAt: item.updatedAt,
            revisionDirectives: item.selectedRevisionDirectives,
        });

        writeJson(path.join(outputDir, item.songId, "candidates", "index.json"), {
            version: 1,
            songId: item.songId,
            updatedAt: item.updatedAt,
            selectedCandidateId: baselineCandidateId,
            selectedAttempt: 1,
            selectionStopReason: `hybrid candidate pool kept music21 over learned_symbolic on ${benchmarkId}`,
            entries: [learnedEntry, baselineEntry],
        });
    }
}

async function seedActiveLearnedBackboneBlindReviewPack(outputDir, snapshot = "active-pack-v1") {
    const packDir = path.join(outputDir, "_system", "ml", "review-packs", "learned-backbone", snapshot);
    const generatedAt = "2026-04-18T12:00:00.000Z";
    const sourceReviewQueue = {
        pendingOnly: true,
        reviewTarget: "pairwise",
        candidatePairCount: 2,
        pendingBlindReviewCount: 2,
        pendingShortlistReviewCount: 0,
    };
    const answerEntries = [
        {
            entryId: "bridge-pack-1",
            songId: "benchmark-approved-song",
            benchmarkId: "stage-b-string-trio",
            planSignature: "lane=string_trio_symbolic|sig=stage-b-reviewed",
            selectedWorker: "music21",
            selectionMode: "baseline_selected",
            reviewTarget: "pairwise",
            selectedInShortlist: false,
            learned: { label: "A" },
            baseline: { label: "B" },
        },
        {
            entryId: "bridge-pack-2",
            songId: "benchmark-rejected-song",
            benchmarkId: "stage-b-string-trio",
            planSignature: "lane=string_trio_symbolic|sig=stage-b-reviewed",
            selectedWorker: "music21",
            selectionMode: "baseline_selected",
            reviewTarget: "pairwise",
            selectedInShortlist: false,
            learned: { label: "A" },
            baseline: { label: "B" },
        },
    ];
    const reviewSheetPath = path.join(packDir, "review-sheet.csv");

    writeJson(path.join(packDir, "pack.json"), {
        version: 1,
        type: "learned_backbone_blind_review_pack",
        packId: snapshot,
        generatedAt,
        lane: "string_trio_symbolic",
        benchmarkPackVersion: learnedBackboneBenchmarkPackVersion,
        sourceReviewQueue,
        entryCount: answerEntries.length,
        entries: [],
    });
    writeJson(path.join(packDir, "answer-key.json"), {
        version: 1,
        type: "learned_backbone_blind_review_answer_key",
        packId: snapshot,
        generatedAt,
        lane: "string_trio_symbolic",
        benchmarkPackVersion: learnedBackboneBenchmarkPackVersion,
        sourceReviewQueue,
        entryCount: answerEntries.length,
        entries: answerEntries,
    });
    writeJson(path.join(packDir, "results.json"), {
        version: 1,
        type: "learned_backbone_blind_review_results",
        packId: snapshot,
        generatedAt,
        lane: "string_trio_symbolic",
        benchmarkPackVersion: learnedBackboneBenchmarkPackVersion,
        results: [],
    });
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(
        reviewSheetPath,
        [
            "entryId,songId,benchmarkId,reviewTarget,winnerLabel,reviewedAt,reviewerId,notes,allowedWinnerLabels,midiAPath,midiBPath",
            "bridge-pack-1,benchmark-approved-song,stage-b-string-trio,pairwise,,,,,A|B|TIE|SKIP,,",
            "bridge-pack-2,benchmark-rejected-song,stage-b-string-trio,pairwise,,,,,A|B|TIE|SKIP,,",
            "",
        ].join("\n"),
        "utf8",
    );

    return {
        packId: snapshot,
        paths: {
            reviewSheetPath,
        },
    };
}

function seedOperatorAction(outputDir, overrides = {}) {
    const operatorActionDir = path.join(outputDir, "_system", "operator-actions");
    const payload = {
        actor: overrides.actor || "operator-api",
        surface: overrides.surface || "api",
        action: overrides.action || "approve",
        reason: overrides.reason || "manual_review",
        rollbackNote: overrides.rollbackNote || "Revert by replaying the previous approved operator decision.",
        manualRecoveryNote: overrides.manualRecoveryNote || "Recheck the linked artifacts before any follow-up mutation.",
        input: overrides.input || { songId: "pending-song" },
        before: overrides.before || { approvalStatus: "pending" },
        after: overrides.after || { approvalStatus: "approved" },
        artifactLinks: overrides.artifactLinks || [
            "outputs/pending-song/manifest.json",
            "outputs/_system/preferences.json",
        ],
        approvedBy: overrides.approvedBy || "lead-reviewer",
        observedAt: overrides.observedAt || "2026-04-10T03:07:00.000Z",
    };

    fs.mkdirSync(operatorActionDir, { recursive: true });
    fs.writeFileSync(path.join(operatorActionDir, "latest.json"), JSON.stringify(payload, null, 2));
}

function seedShadowRerankerEvidence(outputDir, overrides = {}) {
    const songId = overrides.songId || "pending-song";
    const updatedAt = overrides.updatedAt || "2026-04-10T03:05:30.000Z";
    const snapshotId = overrides.snapshotId || "shadow-live";
    const selectedCandidateId = overrides.selectedCandidateId || "structure-a2-selected";
    const learnedTopCandidateId = overrides.learnedTopCandidateId || "structure-a1-learned";
    const learnedConfidence = overrides.learnedConfidence ?? 0.81;
    const learnedNormalizationWarnings = Array.isArray(overrides.learnedNormalizationWarnings)
        ? overrides.learnedNormalizationWarnings
        : ["section s1 role collapse: expected lead,counterline,bass got lead,bass"];
    const disagreement = overrides.disagreement ?? true;
    const promotionApplied = overrides.promotionApplied ?? false;
    const promotionLane = overrides.promotionLane || "string_trio_symbolic";
    const benchmarkId = overrides.benchmarkId || null;
    const benchmarkPackVersion = overrides.benchmarkPackVersion || (benchmarkId ? "string_trio_symbolic_benchmark_pack_v1" : null);
    const promptPackVersion = overrides.promptPackVersion || (benchmarkId ? "learned_symbolic_prompt_pack_v1" : null);
    const planSignature = overrides.planSignature || (benchmarkId ? `${promotionLane}:${benchmarkId}` : null);
    const benchmarkGenerationMode = overrides.benchmarkGenerationMode || (benchmarkId ? "plan_conditioned_trio_template" : null);
    const reason = overrides.reason || "learned favored sectionArtifactCoverage, phraseBreathCueDensity";
    const selectionStopReason = overrides.selectionStopReason
        || `structure evaluation accepted the symbolic draft; hybrid candidate pool kept music21 over learned_symbolic in ${promotionLane} lane on heuristic structure score (88.0 vs 84.0)${promotionApplied ? `; learned reranker promoted attempt 1 over heuristic attempt 2 in ${promotionLane} lane (snapshot=${snapshotId}; confidence=${learnedConfidence.toFixed(3)})` : ""}`;
    const selectedCandidateDir = path.join(outputDir, songId, "candidates", selectedCandidateId);
    const learnedCandidateDir = path.join(outputDir, songId, "candidates", learnedTopCandidateId);
    const selectedManifestPath = path.join(selectedCandidateDir, "candidate-manifest.json");
    const selectedScorePath = path.join(selectedCandidateDir, "reranker-score.json");
    const learnedManifestPath = path.join(learnedCandidateDir, "candidate-manifest.json");
    const learnedBenchmarkEvidence = benchmarkId
        ? {
            benchmarkId,
            benchmarkPackVersion,
            promptPackVersion,
            planSignature,
            generationMode: benchmarkGenerationMode,
        }
        : null;

    fs.mkdirSync(selectedCandidateDir, { recursive: true });
    fs.mkdirSync(learnedCandidateDir, { recursive: true });

    const selectedShadowSummary = {
        snapshotId,
        evaluatedAt: updatedAt,
        heuristicRank: 1,
        heuristicScore: 0.91,
        learnedRank: disagreement ? 2 : 1,
        learnedScore: 0.82,
        learnedConfidence,
        disagreesWithHeuristic: disagreement,
        disagreementReason: disagreement ? reason : undefined,
    };
    const learnedShadowSummary = {
        snapshotId,
        evaluatedAt: updatedAt,
        heuristicRank: 2,
        heuristicScore: 0.84,
        learnedRank: 1,
        learnedScore: 0.9,
        learnedConfidence,
        disagreesWithHeuristic: disagreement,
        disagreementReason: disagreement ? reason : undefined,
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
        proposalEvidence: {
            worker: "learned_symbolic",
            lane: promotionLane,
            provider: "learned",
            model: "learned-symbolic-trio-v1",
            confidence: learnedConfidence,
            ...(learnedBenchmarkEvidence ?? {}),
            ...(learnedNormalizationWarnings.length > 0
                ? { normalizationWarnings: learnedNormalizationWarnings }
                : {}),
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
            score: disagreement ? 0.82 : 0.9,
            rank: disagreement ? 2 : 1,
            topCandidateId: disagreement ? learnedTopCandidateId : selectedCandidateId,
            topMargin: 0.08,
            confidence: learnedConfidence,
        },
        disagreement: {
            disagrees: disagreement,
            heuristicTopCandidateId: selectedCandidateId,
            learnedTopCandidateId: disagreement ? learnedTopCandidateId : selectedCandidateId,
            reason: disagreement ? reason : undefined,
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
                    ...(learnedBenchmarkEvidence ?? {}),
                    ...(learnedNormalizationWarnings.length > 0
                        ? { normalizationWarnings: learnedNormalizationWarnings }
                        : {}),
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

test("print-discord-upstream-config emits AXIOM upstream JSON", async () => {
    const { stdout } = await execFileAsync(
        process.execPath,
        ["scripts/print-discord-upstream-config.mjs", "--url", "http://127.0.0.1:4321", "--token", "bridge-token"],
        {
            cwd: repoRoot,
            env: {
                ...process.env,
                MCP_HTTP_PORT: "3210",
            },
        },
    );

    const payload = JSON.parse(String(stdout));
    assert.equal(Array.isArray(payload), true);
    assert.deepEqual(payload[0], {
        id: "axiom",
        url: "http://127.0.0.1:4321",
        namespace: "axiom",
        token: "bridge-token",
        protocol: "simple",
    });
});

test("verify-mcp-http-bridge validates AXIOM HTTP MCP compatibility", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-mcp-bridge-script-");

    try {
        const { stdout } = await runNodeEval(`
            import express from "express";
            import { execFile } from "node:child_process";
            import { promisify } from "node:util";
            import mcpRouter from "./dist/routes/mcp.js";

            const execFileAsync = promisify(execFile);
            const app = express();
            app.use(express.json());
            app.use(mcpRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;
                    const result = await execFileAsync(process.execPath, [
                        "scripts/verify-mcp-http-bridge.mjs",
                        "--url", baseUrl,
                        "--token", "axiom-http-token",
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            MCP_WORKER_AUTH_TOKEN: "axiom-http-token",
                            PYTHON_BIN: "missing-python-for-ready-check",
                        },
                    });

                    console.log(JSON.stringify({
                        stdout: result.stdout,
                        stderr: result.stderr,
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
                PYTHON_BIN: "missing-python-for-ready-check",
            },
        });

        const result = parseLastJsonLine(stdout);
        const payload = JSON.parse(String(result.stdout).trim());
        assert.equal(payload.ok, true);
        assert.equal(payload.tokenConfigured, true);
        assert.equal(payload.healthStatus, "ok");
        assert.equal(payload.healthAuthRequired, true);
        assert.equal(payload.healthReadinessStatus, "not_ready");
        assert.equal(payload.requiredTools.includes("axiom_compose"), true);
        assert.equal(payload.requiredTools.includes("axiom_autonomy_status"), true);
        assert.equal(payload.probeCallStatus, 200);
        assert.equal(payload.fallbackStatus, 200);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("print-operator-summary emits canonical operator summary from AXIOM runtime routes", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-operator-summary-script-");

    try {
        seedPendingApprovalManifest(outputDir);
        seedPendingApprovalManifest(outputDir, {
            songId: "trend-song",
            approvalStatus: "approved",
            updatedAt: "2026-04-10T03:06:00.000Z",
            structureEvaluation: createApprovedOrchestrationStructureEvaluation(),
            audioEvaluation: createStrongPhraseBreathAudioEvaluation(),
        });
        seedShadowRerankerEvidence(outputDir, { songId: "pending-song", promotionApplied: true });
        seedShadowRerankerRuntimeHistory(outputDir, { songId: "pending-song" });
        seedOperatorAction(outputDir, {
            action: "pause",
            reason: "operator_hold",
            rollbackNote: "Resume only after the stale signal clears.",
            manualRecoveryNote: "If pause sticks unexpectedly, inspect state.json and queue-state.json.",
        });

        const { stdout } = await runNodeEval(`
            import express from "express";
            import { execFile } from "node:child_process";
            import { promisify } from "node:util";
            import healthRouter from "./dist/routes/health.js";
            import composeRouter from "./dist/routes/compose.js";
            import autonomyRouter from "./dist/routes/autonomy.js";
            import overseerRouter from "./dist/routes/overseer.js";

            const execFileAsync = promisify(execFile);
            const app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: false }));
            app.use(healthRouter);
            app.get("/jobs", (_req, res) => {
                res.json([{
                    jobId: "job-operator-summary",
                    status: "queued",
                    songId: "pending-song",
                    createdAt: "2026-04-10T03:00:00.000Z",
                    updatedAt: "2026-04-10T03:05:00.000Z",
                    nextAttemptAt: null,
                    error: "compose worker unavailable",
                    quality: {
                        longSpan: {
                            status: "held",
                        },
                        audioLongSpan: {
                            status: "collapsed",
                            weakestDimension: "tonal_return",
                        },
                        longSpanDivergence: {
                            status: "render_collapsed",
                            repairMode: "paired_cross_section",
                            repairFocus: "tonal_return",
                            secondaryRepairFocuses: ["recap_recall"],
                            recommendedDirectiveKind: "rebalance_recap_release",
                            recommendedDirectives: [{
                                focus: "tonal_return",
                                kind: "rebalance_recap_release",
                                priorityClass: "primary",
                            }, {
                                focus: "recap_recall",
                                kind: "rebalance_recap_release",
                                priorityClass: "secondary",
                            }],
                            explanation: "Symbolic long-span form held, but rendered tonal return collapses the planned recap payoff.",
                            primarySectionId: "s3",
                            primarySectionRole: "recap",
                            sections: [{
                                sectionId: "s3",
                                label: "Recap",
                                role: "recap",
                                focus: "tonal_return",
                                explanation: "Recap (s3) is the main rendered tonal return mismatch against s1. Coda Cadence (s4) is already the paired symbolic weak point for Recap (s3) across measures 21-24: Bass cadence approach does not match the planned sectional closes. Rendered issue: Rendered pitch-class return does not settle back into the planned recap tonality.",
                                comparisonStatus: "both_weak",
                                structureSectionId: "s4",
                                structureLabel: "Coda Cadence",
                                structureRole: "cadence",
                                structureTopIssue: "Bass cadence approach does not match the planned sectional closes.",
                                structureScore: 74,
                                structureStartMeasure: 21,
                                structureEndMeasure: 24,
                                structureExplanation: "Coda Cadence (s4) is already the paired symbolic weak point for Recap (s3) across measures 21-24: Bass cadence approach does not match the planned sectional closes.",
                            }, {
                                sectionId: "s5",
                                label: "Second Return",
                                role: "recap",
                                focus: "tonal_return",
                                explanation: "Second Return (s5) is the secondary rendered tonal return mismatch against s2. Closing Cadence (s6) is already the paired symbolic weak point for Second Return (s5) across measures 25-28: Bass cadence approach does not match the planned sectional closes. Rendered issue: Rendered pitch-class return does not settle back into the planned recap tonality.",
                                comparisonStatus: "both_weak",
                                structureSectionId: "s6",
                                structureLabel: "Closing Cadence",
                                structureRole: "cadence",
                                structureTopIssue: "Bass cadence approach does not match the planned sectional closes.",
                                structureScore: 72,
                                structureStartMeasure: 25,
                                structureEndMeasure: 28,
                                structureExplanation: "Closing Cadence (s6) is already the paired symbolic weak point for Second Return (s5) across measures 25-28: Bass cadence approach does not match the planned sectional closes.",
                            }],
                        },
                    },
                    tracking: {
                        orchestration: {
                            family: "string_trio",
                            instrumentNames: ["violin", "viola", "cello"],
                            sectionCount: 3,
                            conversationalSectionCount: 1,
                            idiomaticRangeFit: 0.89,
                            registerBalanceFit: 0.86,
                            ensembleConversationFit: 0.82,
                            doublingPressureFit: 0.8,
                            textureRotationFit: 0.77,
                            weakSectionIds: ["s2"],
                        },
                    },
                }]);
            });
            app.use(composeRouter);
            app.use(autonomyRouter);
            app.use("/overseer/summary", (_req, _res, next) => {
                setTimeout(() => next(), 40);
            });
            app.use(overseerRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;

                    const result = await execFileAsync(process.execPath, [
                        "scripts/print-operator-summary.mjs",
                        "--url", baseUrl,
                        "--source", "local-runtime",
                        "--jobLimit", "3",
                        "--windowHours", "12",
                        "--staleMs", "1",
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                        },
                    });

                    console.log(JSON.stringify({
                        stdout: result.stdout,
                        stderr: result.stderr,
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
                PYTHON_BIN: "missing-python-for-ready-check",
                AUTONOMY_ENABLED: "true",
            },
        });

        const result = parseLastJsonLine(stdout);
        const payload = JSON.parse(String(result.stdout).trim());

        assert.equal(payload.ok, true);
        assert.equal(payload.namespace, "axiom");
        assert.equal(payload.source, "local-runtime");
        assert.equal(payload.readiness.status, "not_ready");
        assert.equal(payload.queue.total, 1);
        assert.equal(
            payload.queue.queued + payload.queue.running + payload.queue.retryScheduled + payload.queue.failedLike >= 1,
            true,
        );
        assert.equal(payload.evidence.contractOk, true);
        assert.equal(payload.evidence.stale, true);
        assert.equal(payload.evidence.staleThresholdMs, 1);
        assert.equal(payload.evidence.maxSkewMs >= 1, true);
        assert.equal(typeof payload.evidence.endpoints.ready.fetchedAt, "string");
        assert.equal(payload.evidence.endpoints.overseerSummary.path.includes("/overseer/summary"), true);
        assert.equal(typeof payload.queue.backlog.count, "number");
        assert.equal(payload.queue.backlog.count >= 1, true);
        assert.equal(Array.isArray(payload.queue.backlog.topJobs), true);
        assert.equal(payload.triage.state, "incident_candidate");
        assert.equal(payload.triage.severity, "SEV-1");
        assert.equal(payload.triage.severityScore >= 1, true);
        assert.equal(payload.triage.recommendedLane, "incident");
        assert.equal(payload.triage.reasonCodes.includes("readiness_not_ready"), true);
        assert.equal(Array.isArray(payload.triage.severityDrivers), true);
        assert.equal(payload.triage.severityDrivers.some((item) => item.code === "readiness_not_ready"), true);
        assert.equal(payload.autonomy.pendingApprovalCount, 1);
        assert.equal(Array.isArray(payload.autonomy.pendingApprovals), true);
        assert.equal(payload.autonomy.pendingApprovals.length, 1);
        assert.equal(payload.autonomy.pendingApprovals[0].longSpan.status, "collapsed");
        assert.equal(payload.autonomy.pendingApprovals[0].longSpan.weakestDimension, "return_payoff");
        assert.equal(payload.queue.backlog.topJobs[0].audioLongSpan.status, "collapsed");
        assert.equal(payload.queue.backlog.topJobs[0].audioLongSpan.weakestDimension, "tonal_return");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.status, "render_collapsed");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.repairMode, "paired_cross_section");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.repairFocus, "tonal_return");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.secondaryRepairFocuses[0], "recap_recall");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.recommendedDirectives[1].focus, "recap_recall");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.recommendedDirectives[1].priorityClass, "secondary");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.primarySectionId, "s3");
        assert.match(payload.queue.backlog.topJobs[0].longSpanDivergence.operatorReason ?? "", /Rendered weak section Recap \(s3\) must reconverge with paired symbolic weak section Coda Cadence \(s4\)\./);
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.sections[0].sectionId, "s3");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.sections[0].comparisonStatus, "both_weak");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.sections[0].structureSectionId, "s4");
        assert.equal(payload.queue.backlog.topJobs[0].longSpanDivergence.sections[0].structureScore, 74);
        assert.equal(payload.queue.backlog.topJobs[0].orchestration.family, "string_trio");
        assert.equal(payload.queue.backlog.topJobs[0].orchestration.registerBalanceFit, 0.86);
        assert.equal(payload.queue.backlog.topJobs[0].orchestration.doublingPressureFit, 0.8);
        assert.deepEqual(payload.queue.backlog.topJobs[0].orchestration.weakSectionIds, ["s2"]);
        assert.equal(payload.overseer.learnedProposalWarnings.sampledManifestCount, 2);
        assert.equal(payload.overseer.learnedProposalWarnings.proposalCount, 1);
        assert.equal(payload.overseer.learnedProposalWarnings.proposalWithWarningsCount, 1);
        assert.equal(payload.overseer.learnedProposalWarnings.totalWarningCount, 1);
        assert.equal(payload.overseer.learnedProposalWarnings.roleCollapseWarningCount, 1);
        assert.match(payload.overseer.learnedProposalWarnings.topWarnings[0].warning ?? "", /role collapse/);
        assert.equal(payload.overseer.shadowReranker.manifestCount, 2);
        assert.equal(payload.overseer.shadowReranker.scoredManifestCount, 1);
        assert.equal(payload.overseer.shadowReranker.disagreementCount, 1);
        assert.equal(payload.overseer.shadowReranker.highConfidenceDisagreementCount, 1);
        assert.equal(payload.overseer.shadowReranker.promotedSelectionCount, 1);
        assert.equal(payload.overseer.shadowReranker.latestSnapshotId, "shadow-live");
        assert.equal(payload.overseer.shadowReranker.runtimeWindow.sampledEntries, 1);
        assert.equal(payload.overseer.shadowReranker.runtimeWindow.disagreementCount, 1);
        assert.equal(payload.overseer.shadowReranker.recentDisagreements[0].songId, "pending-song");
        assert.equal(payload.overseer.shadowReranker.recentDisagreements[0].lane, "string_trio_symbolic");
        assert.equal(payload.overseer.shadowReranker.recentDisagreements[0].selectedWorker, "music21");
        assert.equal(payload.overseer.shadowReranker.recentDisagreements[0].learnedTopWorker, "learned_symbolic");
        assert.match(payload.overseer.shadowReranker.recentDisagreements[0].reason ?? "", /hybrid candidate pool kept music21 over learned_symbolic/);
        assert.equal(payload.overseer.shadowReranker.recentPromotions[0].lane, "string_trio_symbolic");
        assert.equal(payload.overseer.shadowReranker.recentPromotions[0].heuristicCounterfactualCandidateId, "structure-a2-selected");
        assert.equal(Array.isArray(payload.overseer.orchestrationTrends), true);
        assert.equal(payload.overseer.orchestrationTrends[0].family, "string_trio");
        assert.equal(payload.overseer.orchestrationTrends[0].averageIdiomaticRangeFit, 0.89);
        assert.equal(payload.latestOperatorAction.present, true);
        assert.equal(payload.latestOperatorAction.action, "pause");
        assert.equal(payload.latestOperatorAction.reason, "operator_hold");
        assert.equal(payload.latestOperatorAction.rollbackNote, "Resume only after the stale signal clears.");
        assert.equal(payload.latestOperatorAction.manualRecoveryNote, "If pause sticks unexpectedly, inspect state.json and queue-state.json.");
        assert.equal(payload.data.latestOperatorAction.action, "pause");
        assert.equal(Array.isArray(payload.data.jobs), true);
        assert.equal(Array.isArray(payload.data.recentJobs), true);
        assert.equal(payload.data.recentJobs.length, 1);
        assert.equal(payload.data.jobs.length, 1);
        assert.equal(typeof payload.data.autonomyStatus, "object");
        assert.match(payload.summary, /readiness=not_ready/);
        assert.match(payload.summary, /evidenceStale=yes/);
        assert.match(payload.summary, /latestAction=pause/);
        assert.match(payload.summary, /backlog=/);
        assert.match(payload.summary, /triage=incident_candidate/);
        assert.match(JSON.stringify(payload.artifacts), /pending=pending-song/);
        assert.match(JSON.stringify(payload.artifacts), /longSpan=collapsed:return_payoff/);
        assert.match(JSON.stringify(payload.artifacts), /audioLongSpan=collapsed:tonal_return/);
        assert.match(JSON.stringify(payload.artifacts), /longSpanDivergence=render_collapsed:tonal_return\+recap_recall@s3>s4,\+s5>s6/);
        assert.match(JSON.stringify(payload.artifacts), /longSpanReason=Rendered weak section Recap \(s3\) must reconverge with paired symbolic weak section Coda Cadence \(s4\)\./);
        assert.match(JSON.stringify(payload.artifacts), /learnedProposalWarnings manifests=2 proposals=1 warningProposals=1 warnings=1 roleCollapse=1/);
        assert.match(JSON.stringify(payload.artifacts), /learnedProposalWarning count=1 proposals=1 lastSeen=2026-04-10T03:05:30.000Z song=pending-song warning=section s1 role collapse: expected lead,counterline,bass got lead,bass/);
        assert.match(JSON.stringify(payload.artifacts), /shadowReranker manifests=2 scored=1 disagreements=1 highConfidence=1 promotions=1 agreementRate=0\.00 avgConfidence=0\.81 snapshot=shadow-live/);
        assert.match(JSON.stringify(payload.artifacts), /shadowReranker runtimeWindow=12h sampled=1 disagreements=1 highConfidence=1/);
        assert.match(JSON.stringify(payload.artifacts), /shadowReranker disagreement song=pending-song lane=string_trio_symbolic selected=structure-a2-selected selectedWorker=music21 learnedTop=structure-a1-learned learnedTopWorker=learned_symbolic confidence=0\.81 snapshot=shadow-live/);
        assert.match(JSON.stringify(payload.artifacts), /reason=structure evaluation accepted the symbolic draft; hybrid candidate pool kept music21 over learned_symbolic/);
        assert.match(JSON.stringify(payload.artifacts), /shadowReranker promotion song=pending-song lane=string_trio_symbolic selected=structure-a2-selected selectedWorker=music21 heuristicCounterfactual=structure-a2-selected heuristicCounterfactualWorker=music21 confidence=0\.81 snapshot=shadow-live/);
        assert.match(JSON.stringify(payload.artifacts), /orchestration=trio:rng=0\.89,bal=0\.86,conv=0\.82,dbl=0\.80,rot=0\.77,weak=s2/);
        assert.match(JSON.stringify(payload.artifacts), /orchestrationTrend family=trio manifests=1 rng=0\.89 bal=0\.86 conv=0\.82 dbl=0\.80 rot=0\.77 weakManifests=1 avgWeakSections=1\.00 instruments=violin\/viola\/cello/);
        assert.match(JSON.stringify(payload.artifacts), /operatorAction action=pause/);
        assert.match(JSON.stringify(payload.artifacts), /operatorAction rollbackNote=Resume only after the stale signal clears\./);
        assert.match(JSON.stringify(payload.artifacts), /triage state=incident_candidate severity=SEV-1 lane=incident/);
        assert.match(JSON.stringify(payload.artifacts), /backlog count=/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("project-operator-summary writes latest artifacts and daily history", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-operator-projection-script-");
    const projectionDir = path.join(tempRoot, "projection");

    try {
        seedPendingApprovalManifest(outputDir);
        seedPendingApprovalManifest(outputDir, {
            songId: "trend-song",
            approvalStatus: "approved",
            updatedAt: "2026-04-10T03:06:00.000Z",
            structureEvaluation: createApprovedOrchestrationStructureEvaluation(),
            audioEvaluation: createStrongPhraseBreathAudioEvaluation(),
        });
        seedShadowRerankerEvidence(outputDir, { songId: "pending-song", promotionApplied: true });
        seedShadowRerankerRuntimeHistory(outputDir, { songId: "pending-song" });
        seedOperatorAction(outputDir, {
            action: "reject",
            reason: "contrast_missing",
            actor: "projection-reviewer",
            rollbackNote: "Approve only after new contrast evidence is captured.",
            manualRecoveryNote: "Run a revision pass and reopen approval.",
        });

        const { stdout } = await runNodeEval(`
            import express from "express";
            import path from "node:path";
            import fs from "node:fs";
            import { execFile } from "node:child_process";
            import { promisify } from "node:util";
            import healthRouter from "./dist/routes/health.js";
            import composeRouter from "./dist/routes/compose.js";
            import autonomyRouter from "./dist/routes/autonomy.js";
            import overseerRouter from "./dist/routes/overseer.js";

            const execFileAsync = promisify(execFile);
            const app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: false }));
            app.use(healthRouter);
            app.get("/jobs", (_req, res) => {
                res.json([{
                    jobId: "job-operator-projection",
                    status: "queued",
                    songId: "pending-song",
                    createdAt: "2026-04-10T03:00:00.000Z",
                    updatedAt: "2026-04-10T03:05:00.000Z",
                    nextAttemptAt: null,
                    error: "compose worker unavailable",
                    quality: {
                        longSpan: {
                            status: "held",
                        },
                        audioLongSpan: {
                            status: "collapsed",
                            weakestDimension: "tonal_return",
                        },
                        longSpanDivergence: {
                            status: "render_collapsed",
                            repairMode: "paired_cross_section",
                            repairFocus: "tonal_return",
                            secondaryRepairFocuses: ["recap_recall"],
                            recommendedDirectiveKind: "rebalance_recap_release",
                            recommendedDirectives: [{
                                focus: "tonal_return",
                                kind: "rebalance_recap_release",
                                priorityClass: "primary",
                            }, {
                                focus: "recap_recall",
                                kind: "rebalance_recap_release",
                                priorityClass: "secondary",
                            }],
                            explanation: "Symbolic long-span form held, but rendered tonal return collapses the planned recap payoff.",
                            primarySectionId: "s3",
                            primarySectionRole: "recap",
                            sections: [{
                                sectionId: "s3",
                                label: "Recap",
                                role: "recap",
                                focus: "tonal_return",
                                explanation: "Recap (s3) is the main rendered tonal return mismatch against s1. Coda Cadence (s4) is already the paired symbolic weak point for Recap (s3) across measures 21-24: Bass cadence approach does not match the planned sectional closes. Rendered issue: Rendered pitch-class return does not settle back into the planned recap tonality.",
                                comparisonStatus: "both_weak",
                                structureSectionId: "s4",
                                structureLabel: "Coda Cadence",
                                structureRole: "cadence",
                                structureTopIssue: "Bass cadence approach does not match the planned sectional closes.",
                                structureScore: 74,
                                structureStartMeasure: 21,
                                structureEndMeasure: 24,
                                structureExplanation: "Coda Cadence (s4) is already the paired symbolic weak point for Recap (s3) across measures 21-24: Bass cadence approach does not match the planned sectional closes.",
                            }, {
                                sectionId: "s5",
                                label: "Second Return",
                                role: "recap",
                                focus: "tonal_return",
                                explanation: "Second Return (s5) is the secondary rendered tonal return mismatch against s2. Closing Cadence (s6) is already the paired symbolic weak point for Second Return (s5) across measures 25-28: Bass cadence approach does not match the planned sectional closes. Rendered issue: Rendered pitch-class return does not settle back into the planned recap tonality.",
                                comparisonStatus: "both_weak",
                                structureSectionId: "s6",
                                structureLabel: "Closing Cadence",
                                structureRole: "cadence",
                                structureTopIssue: "Bass cadence approach does not match the planned sectional closes.",
                                structureScore: 72,
                                structureStartMeasure: 25,
                                structureEndMeasure: 28,
                                structureExplanation: "Closing Cadence (s6) is already the paired symbolic weak point for Second Return (s5) across measures 25-28: Bass cadence approach does not match the planned sectional closes.",
                            }],
                        },
                    },
                    tracking: {
                        orchestration: {
                            family: "string_trio",
                            instrumentNames: ["violin", "viola", "cello"],
                            sectionCount: 3,
                            conversationalSectionCount: 1,
                            idiomaticRangeFit: 0.89,
                            registerBalanceFit: 0.86,
                            ensembleConversationFit: 0.82,
                            doublingPressureFit: 0.8,
                            textureRotationFit: 0.77,
                            weakSectionIds: ["s2"],
                        },
                    },
                }]);
            });
            app.use(composeRouter);
            app.use(autonomyRouter);
            app.use("/overseer/summary", (_req, _res, next) => {
                setTimeout(() => next(), 40);
            });
            app.use(overseerRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;

                    const result = await execFileAsync(process.execPath, [
                        "scripts/project-operator-summary.mjs",
                        "--url", baseUrl,
                        "--namespace", "axiom-gcp",
                        "--source", "local-runtime",
                        "--staleMs", "1",
                        "--dir", ${JSON.stringify(projectionDir)},
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                        },
                    });

                    const latestJsonPath = path.join(${JSON.stringify(projectionDir)}, "latest.json");
                    const latestMarkdownPath = path.join(${JSON.stringify(projectionDir)}, "latest.md");
                    const upstreamCompatiblePath = path.join(${JSON.stringify(projectionDir)}, "upstream-compatible.json");
                    const latestPayload = JSON.parse(fs.readFileSync(latestJsonPath, "utf-8"));
                    const latestMarkdown = fs.readFileSync(latestMarkdownPath, "utf-8");
                    const upstreamCompatible = JSON.parse(fs.readFileSync(upstreamCompatiblePath, "utf-8"));
                    const historyDir = path.join(${JSON.stringify(projectionDir)}, "history");
                    const historyFiles = fs.readdirSync(historyDir);
                    const historyText = fs.readFileSync(path.join(historyDir, historyFiles[0]), "utf-8").trim();

                    console.log(JSON.stringify({
                        stdout: result.stdout,
                        latestPayload,
                        latestMarkdown,
                        upstreamCompatible,
                        historyFiles,
                        historyText,
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
                PYTHON_BIN: "missing-python-for-ready-check",
                AUTONOMY_ENABLED: "true",
            },
        });

        const result = parseLastJsonLine(stdout);
        const commandPayload = JSON.parse(String(result.stdout).trim());

        assert.equal(commandPayload.ok, true);
        assert.equal(result.latestPayload.ok, true);
        assert.equal(result.latestPayload.namespace, "axiom-gcp");
        assert.equal(result.latestPayload.source, "local-runtime");
        assert.equal(result.latestPayload.evidence.stale, true);
        assert.equal(result.latestPayload.queue.backlog.count >= 1, true);
        assert.equal(result.latestPayload.triage.state, "incident_candidate");
        assert.equal(result.latestPayload.triage.severity, "SEV-1");
        assert.equal(result.latestPayload.triage.severityScore >= 1, true);
        assert.equal(result.latestPayload.autonomy.pendingApprovalCount, 1);
        assert.equal(result.latestPayload.autonomy.pendingApprovals.length, 1);
        assert.equal(result.latestPayload.autonomy.pendingApprovals[0].longSpan.status, "collapsed");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].audioLongSpan.status, "collapsed");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.status, "render_collapsed");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.repairMode, "paired_cross_section");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.repairFocus, "tonal_return");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.secondaryRepairFocuses[0], "recap_recall");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.recommendedDirectives[0].kind, "rebalance_recap_release");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.recommendedDirectives[1].priorityClass, "secondary");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.primarySectionId, "s3");
        assert.match(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.operatorReason ?? "", /Rendered weak section Recap \(s3\) must reconverge with paired symbolic weak section Coda Cadence \(s4\)\./);
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.sections[0].sectionId, "s3");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.sections[0].comparisonStatus, "both_weak");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.sections[0].structureSectionId, "s4");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].longSpanDivergence.sections[0].structureTopIssue, "Bass cadence approach does not match the planned sectional closes.");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].orchestration.family, "string_trio");
        assert.equal(result.latestPayload.queue.backlog.topJobs[0].orchestration.ensembleConversationFit, 0.82);
        assert.deepEqual(result.latestPayload.queue.backlog.topJobs[0].orchestration.weakSectionIds, ["s2"]);
        assert.equal(result.latestPayload.overseer.phraseBreathTrend.manifestCount, 2);
        assert.equal(result.latestPayload.overseer.phraseBreathTrend.weakManifestCount, 1);
        assert.equal(result.latestPayload.overseer.phraseBreathTrend.averageArrivalFit, 0.6);
        assert.equal(result.latestPayload.overseer.harmonicColorTrend.manifestCount, 2);
        assert.equal(result.latestPayload.overseer.harmonicColorTrend.weakManifestCount, 1);
        assert.equal(result.latestPayload.overseer.harmonicColorTrend.averagePlanFit, 0.62);
        assert.equal(result.latestPayload.overseer.harmonicColorTrend.averageProlongationMotionFit, 0.615);
        assert.equal(result.latestPayload.overseer.learnedProposalWarnings.sampledManifestCount, 2);
        assert.equal(result.latestPayload.overseer.learnedProposalWarnings.proposalCount, 1);
        assert.equal(result.latestPayload.overseer.learnedProposalWarnings.proposalWithWarningsCount, 1);
        assert.equal(result.latestPayload.overseer.learnedProposalWarnings.totalWarningCount, 1);
        assert.equal(result.latestPayload.overseer.learnedProposalWarnings.roleCollapseWarningCount, 1);
        assert.match(result.latestPayload.overseer.learnedProposalWarnings.topWarnings[0].warning ?? "", /role collapse/);
        assert.equal(result.latestPayload.overseer.shadowReranker.manifestCount, 2);
        assert.equal(result.latestPayload.overseer.shadowReranker.scoredManifestCount, 1);
        assert.equal(result.latestPayload.overseer.shadowReranker.disagreementCount, 1);
        assert.equal(result.latestPayload.overseer.shadowReranker.highConfidenceDisagreementCount, 1);
        assert.equal(result.latestPayload.overseer.shadowReranker.promotedSelectionCount, 1);
        assert.equal(result.latestPayload.overseer.shadowReranker.runtimeWindow.sampledEntries, 1);
        assert.equal(result.latestPayload.overseer.shadowReranker.recentDisagreements[0].learnedTopCandidateId, "structure-a1-learned");
        assert.equal(result.latestPayload.overseer.shadowReranker.recentDisagreements[0].selectedWorker, "music21");
        assert.equal(result.latestPayload.overseer.shadowReranker.recentDisagreements[0].learnedTopWorker, "learned_symbolic");
        assert.match(result.latestPayload.overseer.shadowReranker.recentDisagreements[0].reason ?? "", /hybrid candidate pool kept music21 over learned_symbolic/);
        assert.equal(result.latestPayload.overseer.shadowReranker.recentPromotions[0].lane, "string_trio_symbolic");
        assert.equal(Array.isArray(result.latestPayload.overseer.orchestrationTrends), true);
        assert.equal(result.latestPayload.overseer.orchestrationTrends[0].averageRegisterBalanceFit, 0.86);
        assert.equal(result.latestPayload.latestOperatorAction.present, true);
        assert.equal(result.latestPayload.latestOperatorAction.action, "reject");
        assert.equal(result.latestPayload.latestOperatorAction.actor, "projection-reviewer");
        assert.equal(result.latestPayload.latestOperatorAction.rollbackNote, "Approve only after new contrast evidence is captured.");
        assert.equal(result.upstreamCompatible.ok, true);
        assert.equal(result.upstreamCompatible.namespace, "axiom-gcp");
        assert.equal(result.upstreamCompatible.upstream.namespace, "axiom-gcp");
        assert.equal(result.upstreamCompatible.latestOperatorAction.action, "reject");
        assert.equal(result.upstreamCompatible.latestOperatorAction.manualRecoveryNote, "Run a revision pass and reopen approval.");
        assert.equal(result.upstreamCompatible.data.latestOperatorAction.action, "reject");
        assert.equal(Array.isArray(result.upstreamCompatible.data.jobs), true);
        assert.equal(typeof result.upstreamCompatible.data.autonomyStatus, "object");
        assert.match(result.latestMarkdown, /# AXIOM Operator Summary/);
        assert.match(result.latestMarkdown, /## Triage/);
        assert.match(result.latestMarkdown, /- state: incident_candidate/);
        assert.match(result.latestMarkdown, /- severityScore: /);
        assert.match(result.latestMarkdown, /## Backlog/);
        assert.match(result.latestMarkdown, /## Top Backlog/);
        assert.match(result.latestMarkdown, /## Pending Approvals/);
        assert.match(result.latestMarkdown, /longSpan=collapsed:return_payoff/);
        assert.match(result.latestMarkdown, /audioLongSpan=collapsed:tonal_return/);
        assert.match(result.latestMarkdown, /orchestration=trio:rng=0\.89,bal=0\.86,conv=0\.82,dbl=0\.80,rot=0\.77,weak=s2/);
        assert.match(result.latestMarkdown, /## Phrase-Breath Trend/);
        assert.match(result.latestMarkdown, /- manifests=2 \| plan=0\.66 \| cov=0\.66 \| pickup=0\.61 \| arr=0\.60 \| rel=0\.58 \| weakManifests=1/);
        assert.match(result.latestMarkdown, /## Harmonic-Color Trend/);
        assert.match(result.latestMarkdown, /- manifests=2 \| plan=0\.62 \| cov=0\.62 \| target=0\.57 \| time=0\.58 \| tonic=0\.56 \| prolong=0\.61 \| weakManifests=1/);
        assert.match(result.latestMarkdown, /## Learned Proposal Warnings/);
        assert.match(result.latestMarkdown, /- manifests=2 \| proposals=1 \| warningProposals=1 \| warnings=1 \| roleCollapse=1/);
        assert.match(result.latestMarkdown, /- x1 \| proposals=1 \| lastSeen=2026-04-10T03:05:30.000Z \| song=pending-song \| section s1 role collapse: expected lead,counterline,bass got lead,bass/);
        assert.match(result.latestMarkdown, /## Shadow Reranker/);
        assert.match(result.latestMarkdown, /- manifests=2 \| scored=1 \| disagreements=1 \| highConfidence=1 \| promotions=1 \| agreementRate=0\.00 \| avgConfidence=0\.81 \| snapshot=shadow-live/);
        assert.match(result.latestMarkdown, /- runtimeWindow=24h \| sampledRuns=1 \| disagreements=1 \| highConfidence=1/);
        assert.match(result.latestMarkdown, /- disagreement song=pending-song \| selected=structure-a2-selected \| learnedTop=structure-a1-learned \| confidence=0\.81 \| snapshot=shadow-live/);
        assert.match(result.latestMarkdown, /- promotion song=pending-song \| lane=string_trio_symbolic \| selected=structure-a2-selected \| heuristicCounterfactual=structure-a2-selected \| confidence=0\.81 \| snapshot=shadow-live/);
        assert.match(result.latestMarkdown, /## Orchestration Trends/);
        assert.match(result.latestMarkdown, /- trio \| instruments=violin \/ viola \/ cello \| manifests=1 \| rng=0\.89 \| bal=0\.86 \| conv=0\.82 \| dbl=0\.80 \| rot=0\.77 \| weakManifests=1 \| avgWeakSections=1\.00/);
        assert.match(JSON.stringify(result.latestPayload.artifacts), /learnedProposalWarnings manifests=2 proposals=1 warningProposals=1 warnings=1 roleCollapse=1/);
        assert.match(JSON.stringify(result.upstreamCompatible.artifacts), /learnedProposalWarning count=1 proposals=1 lastSeen=2026-04-10T03:05:30.000Z song=pending-song warning=section s1 role collapse: expected lead,counterline,bass got lead,bass/);
        assert.match(result.latestMarkdown, /longSpanDivergence=render_collapsed:tonal_return\+recap_recall@s3>s4,\+s5>s6/);
        assert.match(result.latestMarkdown, /longSpanReason=Rendered weak section Recap \(s3\) must reconverge with paired symbolic weak section Coda Cadence \(s4\)\./);
        assert.match(JSON.stringify(result.latestPayload.artifacts), /shadowReranker manifests=2 scored=1 disagreements=1 highConfidence=1 promotions=1 agreementRate=0\.00 avgConfidence=0\.81 snapshot=shadow-live/);
        assert.match(JSON.stringify(result.latestPayload.artifacts), /shadowReranker runtimeWindow=24h sampled=1 disagreements=1 highConfidence=1/);
        assert.match(JSON.stringify(result.upstreamCompatible.artifacts), /shadowReranker disagreement song=pending-song lane=string_trio_symbolic selected=structure-a2-selected selectedWorker=music21 learnedTop=structure-a1-learned learnedTopWorker=learned_symbolic confidence=0\.81 snapshot=shadow-live/);
        assert.match(JSON.stringify(result.upstreamCompatible.artifacts), /shadowReranker promotion song=pending-song lane=string_trio_symbolic selected=structure-a2-selected selectedWorker=music21 heuristicCounterfactual=structure-a2-selected heuristicCounterfactualWorker=music21 confidence=0\.81 snapshot=shadow-live/);
        assert.match(result.latestMarkdown, /## Latest Operator Action/);
        assert.match(result.latestMarkdown, /- action: reject/);
        assert.match(result.latestMarkdown, /- rollbackNote: Approve only after new contrast evidence is captured\./);
        assert.match(result.latestMarkdown, /- manualRecoveryNote: Run a revision pass and reopen approval\./);
        assert.match(result.latestMarkdown, /- stale: yes/);
        assert.match(result.latestMarkdown, /pending-song/);
        assert.match(result.latestMarkdown, /## Queue/);
        assert.equal(Array.isArray(result.historyFiles), true);
        assert.equal(result.historyFiles.length, 1);
        assert.match(result.historyText, /"source":"local-runtime"/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("project-operator-summary records failure evidence when summary collection fails", async () => {
    const { tempRoot } = createTempRuntimeRoot("axiom-operator-projection-error-");
    const projectionDir = path.join(tempRoot, "projection-error");

    try {
        let caught = null;
        try {
            await execFileAsync(process.execPath, [
                "scripts/project-operator-summary.mjs",
                "--url", "http://127.0.0.1:9",
                "--dir", projectionDir,
            ], {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    LOG_LEVEL: "error",
                },
            });
        } catch (error) {
            caught = error;
        }

        assert.ok(caught);

        const latestErrorPath = path.join(projectionDir, "latest-error.json");
        const errorsDir = path.join(projectionDir, "errors");
        const latestError = JSON.parse(fs.readFileSync(latestErrorPath, "utf-8"));
        const errorFiles = fs.readdirSync(errorsDir);
        const errorHistoryText = fs.readFileSync(path.join(errorsDir, errorFiles[0]), "utf-8").trim();

        assert.equal(latestError.ok, false);
        assert.match(latestError.message, /Operator summary script failed|Operator summary collection failed/);
        assert.equal(Array.isArray(errorFiles), true);
        assert.equal(errorFiles.length, 1);
        assert.match(errorHistoryText, /"ok":false/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("project-operator-summary projects shadow reranker advantage and retry localization lines for reviewed hybrid evidence", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-operator-projection-shadow-reranker-");
    const projectionDir = path.join(tempRoot, "projection");

    try {
        seedPendingApprovalManifest(outputDir, {
            songId: "promoted-reviewed-song",
            approvalStatus: "approved",
            updatedAt: "2026-04-17T04:05:00.000Z",
            reviewFeedback: { appealScore: 0.93 },
            selfAssessment: { qualityScore: 0.5 },
            structureEvaluation: createReviewOnlyStructureEvaluation(),
            audioEvaluation: createReviewOnlyAudioEvaluation(),
            qualityControl: {
                selectedAttempt: 2,
                attempts: [{
                    stage: "structure",
                    attempt: 1,
                    passed: false,
                    score: 71,
                    issues: ["localized retry needed"],
                    strengths: [],
                    directives: [{
                        kind: "clarify_phrase_rhetoric",
                        priority: 80,
                        reason: "weak cadence release",
                        sectionIds: ["s2"],
                    }],
                    evaluatedAt: "2026-04-17T04:04:30.000Z",
                }],
            },
            structureEvaluation: createApprovedOrchestrationStructureEvaluation(),
            audioEvaluation: createStrongPhraseBreathAudioEvaluation(),
        });
        seedPendingApprovalManifest(outputDir, {
            songId: "heuristic-reviewed-song",
            approvalStatus: "rejected",
            updatedAt: "2026-04-17T04:06:00.000Z",
            reviewFeedback: { appealScore: 0.31 },
            selfAssessment: { qualityScore: 0.5 },
            structureEvaluation: createReviewOnlyStructureEvaluation(),
            audioEvaluation: createReviewOnlyAudioEvaluation(),
            qualityControl: {
                selectedAttempt: 2,
                attempts: [{
                    stage: "structure",
                    attempt: 1,
                    passed: false,
                    score: 70,
                    issues: ["global retry needed"],
                    strengths: [],
                    directives: [{
                        kind: "increase_rhythm_variety",
                        priority: 70,
                        reason: "uniform rhythm",
                    }],
                    evaluatedAt: "2026-04-17T04:05:30.000Z",
                }],
            },
            structureEvaluation: createApprovedOrchestrationStructureEvaluation(),
            audioEvaluation: createStrongPhraseBreathAudioEvaluation(),
        });
        seedPendingApprovalManifest(outputDir, {
            songId: "promoted-pending-song",
            approvalStatus: "pending",
            updatedAt: "2026-04-17T04:07:00.000Z",
            qualityControl: {
                selectedAttempt: 2,
                attempts: [{
                    stage: "structure",
                    attempt: 1,
                    passed: false,
                    score: 69,
                    issues: ["mixed retry needed"],
                    strengths: [],
                    directives: [{
                        kind: "clarify_texture_plan",
                        priority: 76,
                        reason: "weak middle texture",
                        sectionIds: ["s2"],
                    }, {
                        kind: "increase_pitch_variety",
                        priority: 65,
                        reason: "limited pitch variety",
                    }],
                    evaluatedAt: "2026-04-17T04:06:30.000Z",
                }],
            },
            structureEvaluation: createApprovedOrchestrationStructureEvaluation(),
            audioEvaluation: createStrongPhraseBreathAudioEvaluation(),
        });
        seedShadowRerankerEvidence(outputDir, { songId: "promoted-reviewed-song", promotionApplied: true, learnedConfidence: 0.91, updatedAt: "2026-04-17T04:05:00.000Z" });
        seedShadowRerankerEvidence(outputDir, { songId: "heuristic-reviewed-song", promotionApplied: false, learnedConfidence: 0.74, updatedAt: "2026-04-17T04:06:00.000Z" });
        seedLearnedBackboneBenchmarkReviewedFixtures(outputDir);
        seedShadowRerankerEvidence(outputDir, { songId: "promoted-pending-song", promotionApplied: true, learnedConfidence: 0.88, updatedAt: "2026-04-17T04:07:00.000Z" });

        const { stdout } = await runNodeEval(`
            import express from "express";
            import fs from "node:fs";
            import path from "node:path";
            import { execFile } from "node:child_process";
            import { promisify } from "node:util";
            import healthRouter from "./dist/routes/health.js";
            import autonomyRouter from "./dist/routes/autonomy.js";
            import overseerRouter from "./dist/routes/overseer.js";

            const execFileAsync = promisify(execFile);
            const app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: false }));
            app.use(healthRouter);
            app.get("/jobs", (_req, res) => {
                res.json([]);
            });
            app.use(autonomyRouter);
            app.use(overseerRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;

                    const result = await execFileAsync(process.execPath, [
                        "scripts/project-operator-summary.mjs",
                        "--url", baseUrl,
                        "--source", "local-runtime",
                        "--jobLimit", "3",
                        "--windowHours", "24",
                        "--staleMs", "1",
                        "--dir", ${JSON.stringify(projectionDir)},
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                        },
                    });

                    const latestJsonPath = path.join(${JSON.stringify(projectionDir)}, "latest.json");
                    const latestMarkdownPath = path.join(${JSON.stringify(projectionDir)}, "latest.md");
                    const upstreamCompatiblePath = path.join(${JSON.stringify(projectionDir)}, "upstream-compatible.json");

                    console.log(JSON.stringify({
                        stdout: result.stdout,
                        latestPayload: JSON.parse(fs.readFileSync(latestJsonPath, "utf-8")),
                        latestMarkdown: fs.readFileSync(latestMarkdownPath, "utf-8"),
                        upstreamCompatible: JSON.parse(fs.readFileSync(upstreamCompatiblePath, "utf-8")),
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
                PYTHON_BIN: "missing-python-for-ready-check",
                AUTONOMY_ENABLED: "true",
            },
        });

        const result = parseLastJsonLine(stdout);

        assert.equal(result.latestPayload.overseer.shadowReranker.promotionOutcomes.reviewedManifestCount, 2);
        assert.equal(result.latestPayload.overseer.shadowReranker.promotionAdvantage.sufficientReviewSample, false);
        assert.equal(result.latestPayload.overseer.shadowReranker.promotionAdvantage.minimumReviewedManifestCount, 4);
        assert.equal(result.latestPayload.overseer.shadowReranker.promotionAdvantage.minimumReviewedPerCohortCount, 2);
        assert.equal(result.latestPayload.overseer.shadowReranker.promotionAdvantage.signal, "insufficient_data");
        assert.equal(result.latestPayload.overseer.shadowReranker.promotionAdvantage.approvalRateDelta, 1);
        assert.equal(result.latestPayload.overseer.shadowReranker.promotionAdvantage.appealScoreDelta, 0.62);
        assert.equal(result.latestPayload.overseer.shadowReranker.retryLocalizationOutcomes.retryingManifestCount, 3);
        assert.equal(result.latestPayload.overseer.shadowReranker.retryLocalizationOutcomes.promotedMixedCount, 1);
        assert.equal(result.latestPayload.overseer.shadowReranker.retryLocalizationOutcomes.heuristicGlobalOnlyCount, 1);
        assert.match(result.latestMarkdown, /- outcomes lane=string_trio_symbolic \| scored=3 \| reviewed=2 \| pendingReview=1 \| promoted=2 \| promotedReviewed=1 \| promotedApprovalRate=1\.00 \| heuristicReviewed=1 \| heuristicApprovalRate=0\.00 \| promotedAvgAppeal=0\.93 \| heuristicAvgAppeal=0\.31/);
        assert.match(result.latestMarkdown, /- promotionAdvantage lane=string_trio_symbolic \| reviewed=2 \| promotedReviewed=1 \| heuristicReviewed=1 \| sufficientSample=no \| approvalDelta=1\.00 \| appealDelta=0\.62 \| signal=insufficient_data/);
        assert.match(result.latestMarkdown, /- retryLocalization lane=string_trio_symbolic \| scored=3 \| retrying=3 \| promotedRetrying=2 \| promotedTargetedOnly=1 \| promotedMixed=1 \| promotedGlobalOnly=0 \| promotedTargetedRate=1\.00 \| heuristicRetrying=1 \| heuristicTargetedOnly=0 \| heuristicMixed=0 \| heuristicGlobalOnly=1 \| heuristicTargetedRate=0\.00/);
        assert.match(JSON.stringify(result.upstreamCompatible.artifacts), /shadowReranker promotionAdvantage lane=string_trio_symbolic reviewed=2 promotedReviewed=1 heuristicReviewed=1 sufficientSample=no approvalDelta=1\.00 appealDelta=0\.62 signal=insufficient_data/);
        assert.match(JSON.stringify(result.upstreamCompatible.artifacts), /shadowReranker retryLocalization lane=string_trio_symbolic scored=3 retrying=3 promotedRetrying=2 promotedTargetedOnly=1 promotedMixed=1 promotedGlobalOnly=0 promotedTargetedRate=1\.00 heuristicRetrying=1 heuristicTargetedOnly=0 heuristicMixed=0 heuristicGlobalOnly=1 heuristicTargetedRate=0\.00/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("print-operator-summary escalates to SEV-1 for compounded runtime failures", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-operator-summary-sev1-");

    try {
        const { stdout } = await runNodeEval(`
            import express from "express";
            import { execFile } from "node:child_process";
            import { promisify } from "node:util";

            const execFileAsync = promisify(execFile);
            const app = express();
            app.use(express.json());
            app.get("/ready", (_req, res) => {
                res.status(503).json({ status: "not_ready", detail: "runtime_not_ready" });
            });
            app.get("/jobs", (_req, res) => {
                res.json([
                    {
                        jobId: "job-critical",
                        songId: "song-critical",
                        status: "failed",
                        createdAt: "2026-04-10T00:00:00.000Z",
                        updatedAt: "2026-04-10T00:05:00.000Z",
                        error: "compose crashed",
                    },
                ]);
            });
            app.get("/autonomy/ops", (_req, res) => {
                res.json({
                    reachable: true,
                    paused: false,
                    activeRun: null,
                    pendingApprovalCount: 0,
                    pendingApprovals: [],
                    operations: {
                        dailyCap: { remainingAttempts: 4 },
                        lockHealth: {
                            reason: "queue_run_mismatch",
                            stale: true,
                            canAutoClear: false,
                            queueJobId: "job-critical",
                        },
                    },
                });
            });
            app.get("/overseer/summary", (_req, res) => {
                res.json({
                    windowHours: 12,
                    sampledEntries: 4,
                    recentFailureCount: 2,
                    activeRepeatedWarningCount: 2,
                    repeatedWarnings: [
                        { warning: "critical runtime drift", count: 2, lastSeenAt: "2026-04-10T00:04:00.000Z" },
                    ],
                    lastHealthyReportAt: "2026-04-09T23:30:00.000Z",
                });
            });

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;

                    const result = await execFileAsync(process.execPath, [
                        "scripts/print-operator-summary.mjs",
                        "--url", baseUrl,
                        "--source", "local-runtime",
                        "--windowHours", "12",
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                        },
                    });

                    console.log(JSON.stringify({ stdout: result.stdout }));
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
            },
        });

        const result = parseLastJsonLine(stdout);
        const payload = JSON.parse(String(result.stdout).trim());

        assert.equal(payload.triage.state, "incident_candidate");
        assert.equal(payload.triage.severity, "SEV-1");
        assert.equal(payload.triage.severityScore >= 8, true);
        assert.equal(payload.triage.severityDrivers.some((item) => item.code === "readiness_not_ready"), true);
        assert.equal(payload.triage.severityDrivers.some((item) => item.code === "queue_failed_pressure"), true);
        assert.equal(payload.triage.severityDrivers.some((item) => item.code === "stale_lock_detected"), true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("scaffold-shadow-review writes policy review markdown and json with baseline snapshot", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-shadow-review-script-");
    const shadowDir = path.join(tempRoot, "shadow-reviews");

    try {
        const { stdout } = await runNodeEval(`
            import express from "express";
            import path from "node:path";
            import fs from "node:fs";
            import { execFile } from "node:child_process";
            import { promisify } from "node:util";
            import healthRouter from "./dist/routes/health.js";
            import composeRouter from "./dist/routes/compose.js";
            import autonomyRouter from "./dist/routes/autonomy.js";
            import overseerRouter from "./dist/routes/overseer.js";

            const execFileAsync = promisify(execFile);
            const app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: false }));
            app.use(healthRouter);
            app.use(composeRouter);
            app.use(autonomyRouter);
            app.use(overseerRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;

                    const result = await execFileAsync(process.execPath, [
                        "scripts/scaffold-shadow-review.mjs",
                        "--policy", "retry_backoff",
                        "--url", baseUrl,
                        "--source", "gcpCompute",
                        "--dir", ${JSON.stringify(shadowDir)},
                        "--owner", "ops-team",
                        "--candidate", "Increase RETRY_BACKOFF_MS from 2000 to 5000",
                        "--envOverrides", "RETRY_BACKOFF_MS=5000,MAX_RETRIES=2",
                        "--window", "48h comparison window",
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                            RETRY_BACKOFF_MS: "2000",
                            MAX_RETRIES: "2",
                        },
                    });

                    const payload = JSON.parse(String(result.stdout).trim());
                    const jsonPath = payload.artifacts.find((item) => item.endsWith('.json'));
                    const markdownPath = payload.artifacts.find((item) => item.endsWith('.md'));
                    const reviewJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
                    const reviewMarkdown = fs.readFileSync(markdownPath, "utf-8");

                    console.log(JSON.stringify({
                        payload,
                        reviewJson,
                        reviewMarkdown,
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
                PYTHON_BIN: "missing-python-for-ready-check",
                AUTONOMY_ENABLED: "true",
                RETRY_BACKOFF_MS: "2000",
                MAX_RETRIES: "2",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.payload.ok, true);
        assert.equal(result.reviewJson.policy, "retry_backoff");
        assert.equal(result.reviewJson.owner, "ops-team");
        assert.equal(result.reviewJson.baseline.config.env.RETRY_BACKOFF_MS, "2000");
        assert.equal(result.reviewJson.baseline.config.env.MAX_RETRIES, "2");
        assert.equal(result.reviewJson.candidate.envOverrides.length, 2);
        assert.equal(result.reviewJson.baseline.operatorSummary.ok, true);
        assert.match(result.reviewMarkdown, /Retry Backoff Shadow Review/);
        assert.match(result.reviewMarkdown, /48h comparison window/);
        assert.match(result.reviewMarkdown, /RETRY_BACKOFF_MS: 2000/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("capture-shadow-review-evidence records baseline and candidate evidence with comparison deltas", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-shadow-review-capture-");
    const shadowDir = path.join(tempRoot, "shadow-reviews");
    const projectionDir = path.join(tempRoot, "projection");

    try {
        const { stdout } = await runNodeEval(`
            import express from "express";
            import fs from "node:fs";
            import path from "node:path";
            import { execFile } from "node:child_process";
            import { promisify } from "node:util";
            import healthRouter from "./dist/routes/health.js";
            import composeRouter from "./dist/routes/compose.js";
            import autonomyRouter from "./dist/routes/autonomy.js";
            import overseerRouter from "./dist/routes/overseer.js";

            const execFileAsync = promisify(execFile);
            const app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: false }));
            app.use(healthRouter);
            app.use(composeRouter);
            app.use(autonomyRouter);
            app.use(overseerRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;

                    const initResult = await execFileAsync(process.execPath, [
                        "scripts/scaffold-shadow-review.mjs",
                        "--policy", "retry_backoff",
                        "--url", baseUrl,
                        "--source", "gcpCompute",
                        "--dir", ${JSON.stringify(shadowDir)},
                        "--owner", "ops-team",
                        "--candidate", "Increase RETRY_BACKOFF_MS from 2000 to 5000",
                        "--envOverrides", "RETRY_BACKOFF_MS=5000,MAX_RETRIES=2",
                        "--window", "48h comparison window",
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                            RETRY_BACKOFF_MS: "2000",
                            MAX_RETRIES: "2",
                        },
                    });

                    const initPayload = JSON.parse(String(initResult.stdout).trim());
                    const reviewPath = initPayload.artifacts.find((item) => item.endsWith('.json'));

                    await execFileAsync(process.execPath, [
                        "scripts/project-operator-summary.mjs",
                        "--url", baseUrl,
                        "--source", "gcpCompute",
                        "--dir", ${JSON.stringify(projectionDir)},
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                        },
                    });

                    await execFileAsync(process.execPath, [
                        "scripts/capture-shadow-review-evidence.mjs",
                        "--review", reviewPath,
                        "--lane", "baseline",
                        "--url", baseUrl,
                        "--source", "gcpCompute",
                        "--projectionDir", ${JSON.stringify(projectionDir)},
                        "--notes", "baseline evidence capture",
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                        },
                    });

                    await fetch(baseUrl + "/compose", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ prompt: "shadow review candidate evidence" }),
                    });

                    await execFileAsync(process.execPath, [
                        "scripts/project-operator-summary.mjs",
                        "--url", baseUrl,
                        "--source", "gcpCompute",
                        "--dir", ${JSON.stringify(projectionDir)},
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                        },
                    });

                    const captureResult = await execFileAsync(process.execPath, [
                        "scripts/capture-shadow-review-evidence.mjs",
                        "--review", reviewPath,
                        "--lane", "candidate",
                        "--url", baseUrl,
                        "--source", "gcpCompute",
                        "--projectionDir", ${JSON.stringify(projectionDir)},
                        "--notes", "candidate evidence capture",
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                        },
                    });

                    const reviewJson = JSON.parse(fs.readFileSync(reviewPath, "utf-8"));
                    const reviewMarkdown = fs.readFileSync(reviewPath.replace(/\.json$/i, ".md"), "utf-8");
                    const historyText = fs.readFileSync(reviewPath.replace(/\.json$/i, ".evidence.jsonl"), "utf-8").trim();

                    console.log(JSON.stringify({
                        capturePayload: JSON.parse(String(captureResult.stdout).trim()),
                        reviewJson,
                        reviewMarkdown,
                        historyLines: historyText.split(${JSON.stringify("\n")}).filter(Boolean),
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
                PYTHON_BIN: "missing-python-for-ready-check",
                AUTONOMY_ENABLED: "true",
                RETRY_BACKOFF_MS: "2000",
                MAX_RETRIES: "2",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.capturePayload.ok, true);
        assert.equal(result.capturePayload.comparisonReady, true);
        assert.equal(result.reviewJson.evidence.lanes.baseline.lane, "baseline");
        assert.equal(result.reviewJson.evidence.lanes.candidate.lane, "candidate");
        assert.equal(result.reviewJson.comparison.ready, true);
        assert.equal(result.reviewJson.comparison.deltas.queueTotal.delta >= 1, true);
        assert.equal(result.reviewJson.evidence.history.length, 2);
        assert.equal(result.historyLines.length, 2);
        assert.match(result.reviewMarkdown, /## Baseline Evidence Snapshot/);
        assert.match(result.reviewMarkdown, /## Candidate Evidence Snapshot/);
        assert.match(result.reviewMarkdown, /## Comparison Snapshot/);
        assert.match(result.reviewMarkdown, /queue_total_delta: \+/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("run-safe-unattended-sweep writes bridge, projection, warning, and stale-lock evidence", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-safe-sweep-");
    const projectionDir = path.join(tempRoot, "projection");
    const sweepDir = path.join(tempRoot, "sweep");

    try {
        seedPendingApprovalManifest(outputDir);
        seedPendingApprovalManifest(outputDir, {
            songId: "trend-song",
            approvalStatus: "approved",
            updatedAt: "2026-04-10T03:06:00.000Z",
            structureEvaluation: createApprovedOrchestrationStructureEvaluation(),
            audioEvaluation: createStrongPhraseBreathAudioEvaluation(),
        });
        seedPendingApprovalManifest(outputDir, {
            songId: "promoted-reviewed-song",
            approvalStatus: "approved",
            updatedAt: "2026-04-17T04:05:00.000Z",
            reviewFeedback: { appealScore: 0.93 },
            selfAssessment: { qualityScore: 0.5 },
            structureEvaluation: createReviewOnlyStructureEvaluation(),
            audioEvaluation: createReviewOnlyAudioEvaluation(),
            qualityControl: {
                selectedAttempt: 2,
                attempts: [{
                    stage: "structure",
                    attempt: 1,
                    passed: false,
                    score: 71,
                    issues: ["localized retry needed"],
                    strengths: [],
                    directives: [{
                        kind: "clarify_phrase_rhetoric",
                        priority: 80,
                        reason: "weak cadence release",
                        sectionIds: ["s2"],
                    }],
                    evaluatedAt: "2026-04-17T04:04:30.000Z",
                }],
            },
        });
        seedPendingApprovalManifest(outputDir, {
            songId: "heuristic-reviewed-song",
            approvalStatus: "rejected",
            updatedAt: "2026-04-17T04:06:00.000Z",
            reviewFeedback: { appealScore: 0.31 },
            selfAssessment: { qualityScore: 0.5 },
            structureEvaluation: createReviewOnlyStructureEvaluation(),
            audioEvaluation: createReviewOnlyAudioEvaluation(),
            qualityControl: {
                selectedAttempt: 2,
                attempts: [{
                    stage: "structure",
                    attempt: 1,
                    passed: false,
                    score: 70,
                    issues: ["global retry needed"],
                    strengths: [],
                    directives: [{
                        kind: "increase_rhythm_variety",
                        priority: 70,
                        reason: "uniform rhythm",
                    }],
                    evaluatedAt: "2026-04-17T04:05:30.000Z",
                }],
            },
        });
        seedShadowRerankerEvidence(outputDir, { songId: "promoted-reviewed-song", promotionApplied: true, learnedConfidence: 0.91, updatedAt: "2026-04-17T04:05:00.000Z" });
        seedShadowRerankerEvidence(outputDir, { songId: "heuristic-reviewed-song", promotionApplied: false, learnedConfidence: 0.74, updatedAt: "2026-04-17T04:06:00.000Z" });
        seedLearnedBackboneBenchmarkReviewedFixtures(outputDir);
        await seedActiveLearnedBackboneBlindReviewPack(outputDir);
        seedOperatorAction(outputDir, {
            action: "resume",
            reason: "evidence_cleared",
            actor: "pickup-operator",
            rollbackNote: "Pause again if readiness drops during observation.",
            manualRecoveryNote: "Inspect operator-summary latest.json before retrying.",
        });

        const { stdout } = await runNodeEval(`
            import express from "express";
            import fs from "node:fs";
            import path from "node:path";
            import { execFile } from "node:child_process";
            import { promisify } from "node:util";
            import healthRouter from "./dist/routes/health.js";
            import composeRouter from "./dist/routes/compose.js";
            import autonomyRouter from "./dist/routes/autonomy.js";
            import overseerRouter from "./dist/routes/overseer.js";
            import mcpRouter from "./dist/routes/mcp.js";

            const execFileAsync = promisify(execFile);
            const app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: false }));
            app.use(healthRouter);
            app.use(composeRouter);
            app.use(autonomyRouter);
            app.use("/overseer/summary", (_req, _res, next) => {
                setTimeout(() => next(), 40);
            });
            app.use(overseerRouter);
            app.use(mcpRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;

                    await fetch(baseUrl + "/compose", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ prompt: "operator sweep backlog smoke test" }),
                    });

                    const result = await execFileAsync(process.execPath, [
                        "scripts/run-safe-unattended-sweep.mjs",
                        "--url", baseUrl,
                        "--mcpUrl", baseUrl,
                        "--source", "gcpCompute",
                        "--staleMs", "1",
                        "--projectionDir", ${JSON.stringify(projectionDir)},
                        "--dir", ${JSON.stringify(sweepDir)},
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                            MCP_WORKER_AUTH_TOKEN: "sweep-token",
                        },
                    });

                    const payload = JSON.parse(String(result.stdout).trim());
                    const latest = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(sweepDir)}, "latest.json"), "utf-8"));
                    const latestMarkdown = fs.readFileSync(path.join(${JSON.stringify(sweepDir)}, "latest.md"), "utf-8");
                    const incidentLatest = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(sweepDir)}, "incident-drafts", "latest.json"), "utf-8"));
                    const incidentLatestMarkdown = fs.readFileSync(path.join(${JSON.stringify(sweepDir)}, "incident-drafts", "latest.md"), "utf-8");
                    const historyDir = path.join(${JSON.stringify(sweepDir)}, "history");
                    const historyFiles = fs.readdirSync(historyDir);
                    const incidentHistoryDir = path.join(${JSON.stringify(sweepDir)}, "incident-drafts", "history");
                    const incidentHistoryFiles = fs.readdirSync(incidentHistoryDir);

                    console.log(JSON.stringify({
                        payload,
                        latest,
                        latestMarkdown,
                        historyFiles,
                        incidentLatest,
                        incidentLatestMarkdown,
                        incidentHistoryFiles,
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
                PYTHON_BIN: "missing-python-for-ready-check",
                AUTONOMY_ENABLED: "true",
                MCP_WORKER_AUTH_TOKEN: "sweep-token",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.payload.ok, true);
        assert.equal(result.latest.ok, true);
        assert.equal(result.latest.bridge.ok, true);
        assert.equal(result.latest.projection.ok, true);
        assert.equal(result.latest.projection.latest.evidence.stale, true);
        assert.equal(result.latest.digest.backlog.count >= 1, true);
        assert.equal(Array.isArray(result.latest.digest.backlog.topBacklog), true);
        assert.equal(result.latest.triage.state, "incident_candidate");
        assert.equal(result.latest.triage.severity, "SEV-1");
        assert.equal(result.latest.triage.severityScore >= 1, true);
        assert.equal(result.latest.digest.pendingApprovals.count, 1);
        assert.equal(result.latest.digest.pendingApprovals.topPending.length, 1);
        assert.equal(typeof result.latest.digest.repeatedWarnings.count, "number");
        assert.equal(typeof result.latest.digest.staleLock.detected, "boolean");
        assert.equal(result.latest.latestOperatorAction.present, true);
        assert.equal(result.latest.latestOperatorAction.action, "resume");
        assert.equal(result.latest.latestOperatorAction.rollbackNote, "Pause again if readiness drops during observation.");
        assert.equal(result.latest.latestOperatorAction.manualRecoveryNote, "Inspect operator-summary latest.json before retrying.");
        assert.equal(Array.isArray(result.latest.recommendations), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("incident candidate detected")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("projection evidence is stale")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("orchestration trend shows trio ensemble pressure")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("before treating timbre as the root issue")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("learned backbone benchmark retry localization is drifting")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("shadow reranker narrow-lane review data is still sparse")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("latest operator action rollback note: Pause again if readiness drops during observation.")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("latest operator action manual recovery note: Inspect operator-summary latest.json before retrying.")), true);
        assert.equal(result.latest.incidentDraft.generated, true);
        assert.equal(result.incidentLatest.state, "incident_candidate");
        assert.equal(result.incidentLatest.severity, "SEV-1");
        assert.equal(result.incidentLatest.severityScore >= 1, true);
        assert.equal(result.incidentLatest.scope, "runtime");
        assert.equal(result.incidentLatest.escalation.required, true);
        assert.equal(result.incidentLatest.escalation.ownerRole, "Incident Commander");
        assert.equal(result.incidentLatest.latestOperatorAction.present, true);
        assert.equal(result.incidentLatest.latestOperatorAction.rollbackNote, "Pause again if readiness drops during observation.");
        assert.equal(result.incidentLatest.latestOperatorAction.manualRecoveryNote, "Inspect operator-summary latest.json before retrying.");
        assert.equal(result.incidentLatest.comms.nextAction, "Inspect operator-summary latest.json before retrying.");
        assert.match(result.incidentLatest.comms.changeSummary, /Recent operator action: resume via api by pickup-operator\./);
        assert.match(result.incidentLatest.comms.mitigationInProgress, /Rollback checkpoint: Pause again if readiness drops during observation\./);
        assert.match(result.incidentLatest.comms.initialAcknowledgement, /Next update in 15 minutes/);
        assert.equal(Array.isArray(result.incidentLatest.orchestrationTrends), true);
        assert.equal(result.incidentLatest.orchestrationTrends[0].family, "string_trio");
        assert.equal(result.incidentLatest.orchestrationTrends[0].averageIdiomaticRangeFit, 0.89);
        assert.equal(result.incidentLatest.phraseBreathTrend.manifestCount, 2);
        assert.equal(result.incidentLatest.phraseBreathTrend.weakManifestCount, 1);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.runCount, 2);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.reviewSampleStatus.status, "directional_only");
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.reviewSampleStatus.remainingReviewedRunCountForPromotion, 28);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.reviewSampleStatus.remainingReviewedDisagreementCountForPromotion, 10);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.pairedSelectionOutcomes.reviewedManifestCount, 2);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.pairedSelectionOutcomes.promotedReviewedCount, 0);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.pairedSelectionOutcomes.heuristicReviewedCount, 2);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.selectedWorkerOutcomes.music21.runCount, 2);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.selectedWorkerOutcomes.music21.reviewedRunCount, 2);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.coverageRows.length, 1);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.coverageRows[0].benchmarkId, "stage-b-string-trio");
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.coverageRows[0].selectedWorkerCounts.music21, 2);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.retryLocalizationStability.status, "drifting");
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.reviewPacks.matchedPackCount, 1);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.reviewPacks.activePackCount, 1);
        assert.equal(result.latest.projection.latest.overseer.learnedBackboneBenchmark.reviewPacks.recentActivePacks[0].reviewSheetPath, "outputs/_system/ml/review-packs/learned-backbone/active-pack-v1/review-sheet.csv");
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.runCount, 2);
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.reviewSampleStatus.status, "directional_only");
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.pairedSelectionOutcomes.reviewedManifestCount, 2);
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.pairedSelectionOutcomes.promotedReviewedCount, 0);
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.selectedWorkerOutcomes.music21.runCount, 2);
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.coverageRows.length, 1);
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.retryLocalizationStability.status, "drifting");
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.reviewPacks.matchedPackCount, 1);
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.reviewPacks.activePackCount, 1);
        assert.equal(Array.isArray(result.incidentLatest.learnedBackboneBenchmark.reviewPackActions), true);
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.reviewPackActions.length, 0);
        assert.equal(Array.isArray(result.incidentLatest.learnedBackboneBenchmark.reviewPackRecordActions), true);
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.reviewPackRecordActions[0].packId, "active-pack-v1");
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.reviewPackRecordActions[0].pendingDecisionCount, 2);
        assert.equal(result.incidentLatest.learnedBackboneBenchmark.reviewPackRecordActions[0].command, "npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs/_system/ml/review-packs/learned-backbone/active-pack-v1/review-sheet.csv");
        assert.equal(result.incidentLatest.shadowReranker.promotionOutcomes.reviewedManifestCount, 2);
        assert.equal(result.incidentLatest.shadowReranker.promotionAdvantage.sufficientReviewSample, false);
        assert.equal(result.incidentLatest.shadowReranker.promotionAdvantage.signal, "insufficient_data");
        assert.equal(Array.isArray(result.incidentLatest.recommendations), true);
        assert.equal(result.historyFiles.length, 1);
        assert.equal(result.incidentHistoryFiles.length, 1);
        assert.match(result.latest.summary, /latestAction=action=resume surface=api actor=pickup-operator/);
        assert.match(result.latestMarkdown, /## Triage/);
        assert.match(result.latestMarkdown, /- state: incident_candidate/);
        assert.match(result.latestMarkdown, /- severityScore: /);
        assert.match(result.latestMarkdown, /## Bridge Verify/);
        assert.match(result.latestMarkdown, /## Latest Operator Action/);
        assert.match(result.latestMarkdown, /- rollbackNote: Pause again if readiness drops during observation\./);
        assert.match(result.latestMarkdown, /- manualRecoveryNote: Inspect operator-summary latest.json before retrying\./);
        assert.match(result.latestMarkdown, /## Backlog Digest/);
        assert.match(result.latestMarkdown, /## Pending Approval Digest/);
        assert.match(result.latestMarkdown, /evidenceStale: yes/);
        assert.match(result.latestMarkdown, /pending-song/);
        assert.match(result.latestMarkdown, /## Repeated Warning Digest/);
        assert.match(result.latestMarkdown, /## Learned Backbone Benchmark/);
        assert.match(result.latestMarkdown, /- lane=string_trio_symbolic \| pack=string_trio_symbolic_benchmark_pack_v1 \| runs=2 \| paired=2 \| reviewed=2 \| pendingReview=0/);
        assert.match(result.latestMarkdown, /- sampleStatus=directional_only \| reviewed=2 \| reviewedDisagreements=0/);
        assert.match(result.latestMarkdown, /- pairedSelection reviewed=2 \| promotedReviewed=0 \| heuristicReviewed=2 \| promotedApproval=- \| heuristicApproval=0\.50 \| promotedAppeal=- \| heuristicAppeal=0\.62/);
        assert.match(result.latestMarkdown, /- selectedWorkerOutcome worker=music21 \| runs=2 \| reviewed=2 \| pendingReview=0 \| approved=1 \| rejected=1 \| approvalRate=0\.50 \| avgAppeal=0\.62/);
        assert.match(result.latestMarkdown, /- coverage benchmark=stage-b-string-trio \| runs=2 \| paired=2 \| reviewed=2 \| pendingReview=0 \| approvalRate=0\.50 \| avgAppeal=0\.62 \| selectedWorkers=music21:2 \| generationModes=plan_conditioned_trio_template:2 \| lastObserved=2026-04-17T04:08:00.000Z/);
        assert.match(result.latestMarkdown, /- reviewQueue pendingBlind=2 \| pendingShortlist=0 \| latestPendingAt=/);
        assert.match(result.latestMarkdown, /- reviewPacks matched=1 \| active=1 \| pendingDecisions=2 \| completedDecisions=0 \| latestGeneratedAt=.* \| latestReviewedAt=-/);
        assert.match(result.latestMarkdown, /- reviewPack pack=active-pack-v1 \| target=pairwise \| entries=2 \| completed=0 \| pending=2 \| pendingShortlist=0 \| generatedAt=.* \| latestReviewedAt=- \| reviewSheet=outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv \| recordCommand=npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv/);
        assert.match(result.latestMarkdown, /- retryStability status=drifting \| retrying=2 \| sectionTargetedOnly=1 \| mixed=0 \| globalOnly=1 \| targetedRate=0\.50 \| driftRate=0\.50/);
        assert.match(result.latestMarkdown, /- advisory: finish 2 pending worksheet decision\(s\) in 1 active learned backbone review pack before generating more blind-review packs; learned backbone benchmark retry localization is drifting/);
        assert.match(result.latestMarkdown, /## Stale Lock Digest/);
        assert.match(result.latestMarkdown, /orchestration trend shows trio ensemble pressure/);
        assert.match(result.latestMarkdown, /## Incident Draft/);
        assert.match(result.latestMarkdown, /- generated: yes/);
        assert.match(result.incidentLatestMarkdown, /# AXIOM Incident Draft/);
        assert.match(result.incidentLatestMarkdown, /- severity: SEV-1/);
        assert.match(result.incidentLatestMarkdown, /## Latest Operator Action/);
        assert.match(result.incidentLatestMarkdown, /- rollbackNote: Pause again if readiness drops during observation\./);
        assert.match(result.incidentLatestMarkdown, /- manualRecoveryNote: Inspect operator-summary latest.json before retrying\./);
        assert.match(result.incidentLatestMarkdown, /## Orchestration Trends/);
        assert.match(result.incidentLatestMarkdown, /- trio \| instruments=violin \/ viola \/ cello \| manifests=1 \| rng=0\.89 \| bal=0\.86 \| conv=0\.82 \| dbl=0\.80 \| rot=0\.77 \| weakManifests=1 \| avgWeakSections=1\.00/);
        assert.match(result.incidentLatestMarkdown, /## Phrase-Breath Trend/);
        assert.match(result.incidentLatestMarkdown, /- manifests=2 \| plan=0\.66 \| cov=0\.66 \| pickup=0\.61 \| arr=0\.60 \| rel=0\.58 \| weakManifests=1/);
        assert.match(result.incidentLatestMarkdown, /## Learned Backbone Benchmark/);
        assert.match(result.incidentLatestMarkdown, /- sampleStatus=directional_only \| reviewed=2 \| reviewedDisagreements=0/);
        assert.match(result.incidentLatestMarkdown, /- pairedSelection reviewed=2 \| promotedReviewed=0 \| heuristicReviewed=2 \| promotedApproval=- \| heuristicApproval=0\.50 \| promotedAppeal=- \| heuristicAppeal=0\.62/);
        assert.match(result.incidentLatestMarkdown, /- selectedWorkerOutcome worker=music21 \| runs=2 \| reviewed=2 \| pendingReview=0 \| approved=1 \| rejected=1 \| approvalRate=0\.50 \| avgAppeal=0\.62/);
        assert.match(result.incidentLatestMarkdown, /- coverage benchmark=stage-b-string-trio \| runs=2 \| paired=2 \| reviewed=2 \| pendingReview=0 \| approvalRate=0\.50 \| avgAppeal=0\.62 \| selectedWorkers=music21:2 \| generationModes=plan_conditioned_trio_template:2 \| lastObserved=2026-04-17T04:08:00.000Z/);
        assert.match(result.incidentLatestMarkdown, /- reviewQueue pendingBlind=2 \| pendingShortlist=0 \| latestPendingAt=/);
        assert.match(result.incidentLatestMarkdown, /- reviewPacks matched=1 \| active=1 \| pendingDecisions=2 \| completedDecisions=0 \| latestGeneratedAt=.* \| latestReviewedAt=-/);
        assert.match(result.incidentLatestMarkdown, /- reviewPack pack=active-pack-v1 \| target=pairwise \| entries=2 \| completed=0 \| pending=2 \| pendingShortlist=0 \| generatedAt=.* \| latestReviewedAt=- \| reviewSheet=outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv \| recordCommand=npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv/);
        assert.match(result.incidentLatestMarkdown, /- retryStability status=drifting \| retrying=2 \| sectionTargetedOnly=1 \| mixed=0 \| globalOnly=1 \| targetedRate=0\.50 \| driftRate=0\.50/);
        assert.match(result.incidentLatestMarkdown, /- advisory: finish 2 pending worksheet decision\(s\) in 1 active learned backbone review pack before generating more blind-review packs; learned backbone benchmark retry localization is drifting/);
        assert.match(result.incidentLatestMarkdown, /## Shadow Reranker/);
        assert.match(result.incidentLatestMarkdown, /- promotionAdvantage lane=string_trio_symbolic \| reviewed=2 \| promotedReviewed=1 \| heuristicReviewed=1 \| sufficientSample=no \| approvalDelta=1\.00 \| appealDelta=0\.62 \| signal=insufficient_data/);
        assert.match(result.incidentLatestMarkdown, /- advisory: shadow reranker narrow-lane review data is still sparse/);
        assert.match(result.incidentLatestMarkdown, /## Escalation/);
        assert.match(result.incidentLatestMarkdown, /## Comms Draft/);
        assert.match(result.incidentLatestMarkdown, /- nextAction: Inspect operator-summary latest\.json before retrying\./);
        assert.match(result.incidentLatestMarkdown, /Rollback checkpoint: Pause again if readiness drops during observation\./);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("run-safe-unattended-sweep records failure evidence when bridge verify fails", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-safe-sweep-failure-");
    const projectionDir = path.join(tempRoot, "projection");
    const sweepDir = path.join(tempRoot, "sweep");

    try {
        let caught = null;
        try {
            await execFileAsync(process.execPath, [
                "scripts/run-safe-unattended-sweep.mjs",
                "--url", "http://127.0.0.1:9",
                "--mcpUrl", "http://127.0.0.1:9",
                "--source", "gcpCompute",
                "--projectionDir", projectionDir,
                "--dir", sweepDir,
            ], {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    OUTPUT_DIR: outputDir,
                    LOG_DIR: logDir,
                    LOG_LEVEL: "error",
                },
            });
        } catch (error) {
            caught = error;
        }

        assert.ok(caught);

        const latest = JSON.parse(fs.readFileSync(path.join(sweepDir, "latest.json"), "utf-8"));
        const latestError = JSON.parse(fs.readFileSync(path.join(sweepDir, "latest-error.json"), "utf-8"));
        const incidentLatest = JSON.parse(fs.readFileSync(path.join(sweepDir, "incident-drafts", "latest.json"), "utf-8"));
        const errorFiles = fs.readdirSync(path.join(sweepDir, "errors"));
        const incidentHistoryFiles = fs.readdirSync(path.join(sweepDir, "incident-drafts", "history"));

        assert.equal(latest.ok, false);
        assert.equal(latest.bridge.ok, false);
        assert.equal(latest.projection.ok, false);
        assert.equal(latest.triage.state, "incident_candidate");
        assert.equal(latest.triage.severity, "SEV-1");
        assert.equal(latest.triage.severityScore >= 1, true);
        assert.equal(latest.incidentDraft.generated, true);
        assert.equal(latestError.ok, false);
        assert.equal(incidentLatest.state, "incident_candidate");
        assert.equal(incidentLatest.severity, "SEV-1");
        assert.equal(incidentLatest.scope, "bridge_and_runtime");
        assert.equal(errorFiles.length, 1);
        assert.equal(incidentHistoryFiles.length, 1);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("project-operator-pickup writes consolidated shared pickup artifacts", async () => {
    const { tempRoot, outputDir, logDir } = createTempRuntimeRoot("axiom-operator-pickup-");
    const projectionDir = path.join(tempRoot, "projection");
    const sweepDir = path.join(tempRoot, "sweep");
    const pickupDir = path.join(tempRoot, "pickup");

    try {
        seedPendingApprovalManifest(outputDir);
        seedPendingApprovalManifest(outputDir, {
            songId: "trend-song",
            approvalStatus: "approved",
            updatedAt: "2026-04-10T03:06:00.000Z",
            structureEvaluation: createApprovedOrchestrationStructureEvaluation(),
            audioEvaluation: createStrongPhraseBreathAudioEvaluation(),
        });
        seedPendingApprovalManifest(outputDir, {
            songId: "promoted-reviewed-song",
            approvalStatus: "approved",
            updatedAt: "2026-04-17T04:05:00.000Z",
            reviewFeedback: { appealScore: 0.93 },
            selfAssessment: { qualityScore: 0.5 },
            structureEvaluation: createReviewOnlyStructureEvaluation(),
            audioEvaluation: createReviewOnlyAudioEvaluation(),
            qualityControl: {
                selectedAttempt: 2,
                attempts: [{
                    stage: "structure",
                    attempt: 1,
                    passed: false,
                    score: 71,
                    issues: ["localized retry needed"],
                    strengths: [],
                    directives: [{
                        kind: "clarify_phrase_rhetoric",
                        priority: 80,
                        reason: "weak cadence release",
                        sectionIds: ["s2"],
                    }],
                    evaluatedAt: "2026-04-17T04:04:30.000Z",
                }],
            },
        });
        seedPendingApprovalManifest(outputDir, {
            songId: "heuristic-reviewed-song",
            approvalStatus: "rejected",
            updatedAt: "2026-04-17T04:06:00.000Z",
            reviewFeedback: { appealScore: 0.31 },
            selfAssessment: { qualityScore: 0.5 },
            structureEvaluation: createReviewOnlyStructureEvaluation(),
            audioEvaluation: createReviewOnlyAudioEvaluation(),
            qualityControl: {
                selectedAttempt: 2,
                attempts: [{
                    stage: "structure",
                    attempt: 1,
                    passed: false,
                    score: 70,
                    issues: ["global retry needed"],
                    strengths: [],
                    directives: [{
                        kind: "increase_rhythm_variety",
                        priority: 70,
                        reason: "uniform rhythm",
                    }],
                    evaluatedAt: "2026-04-17T04:05:30.000Z",
                }],
            },
        });
        seedShadowRerankerEvidence(outputDir, { songId: "promoted-reviewed-song", promotionApplied: true, learnedConfidence: 0.91, updatedAt: "2026-04-17T04:05:00.000Z" });
        seedShadowRerankerEvidence(outputDir, { songId: "heuristic-reviewed-song", promotionApplied: false, learnedConfidence: 0.74, updatedAt: "2026-04-17T04:06:00.000Z" });
        seedLearnedBackboneBenchmarkReviewedFixtures(outputDir);
        await seedActiveLearnedBackboneBlindReviewPack(outputDir);
        seedOperatorAction(outputDir, {
            action: "resume",
            reason: "evidence_cleared",
            actor: "pickup-operator",
            rollbackNote: "Pause again if readiness drops during observation.",
            manualRecoveryNote: "Inspect operator-summary latest.json before retrying.",
        });

        const { stdout } = await runNodeEval(`
            import express from "express";
            import fs from "node:fs";
            import path from "node:path";
            import { execFile } from "node:child_process";
            import { promisify } from "node:util";
            import healthRouter from "./dist/routes/health.js";
            import composeRouter from "./dist/routes/compose.js";
            import autonomyRouter from "./dist/routes/autonomy.js";
            import overseerRouter from "./dist/routes/overseer.js";
            import mcpRouter from "./dist/routes/mcp.js";

            const execFileAsync = promisify(execFile);
            const app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: false }));
            app.use(healthRouter);
            app.use(composeRouter);
            app.use(autonomyRouter);
            app.use("/overseer/summary", (_req, _res, next) => {
                setTimeout(() => next(), 40);
            });
            app.use(overseerRouter);
            app.use(mcpRouter);

            const server = app.listen(0, async () => {
                try {
                    const address = server.address();
                    const baseUrl = "http://127.0.0.1:" + address.port;

                    await fetch(baseUrl + "/compose", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ prompt: "operator pickup smoke test" }),
                    });

                    await execFileAsync(process.execPath, [
                        "scripts/run-safe-unattended-sweep.mjs",
                        "--url", baseUrl,
                        "--mcpUrl", baseUrl,
                        "--source", "gcpCompute",
                        "--staleMs", "1",
                        "--projectionDir", ${JSON.stringify(projectionDir)},
                        "--dir", ${JSON.stringify(sweepDir)},
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                            PYTHON_BIN: "missing-python-for-ready-check",
                            AUTONOMY_ENABLED: "true",
                            MCP_WORKER_AUTH_TOKEN: "pickup-token",
                        },
                    });

                    const result = await execFileAsync(process.execPath, [
                        "scripts/project-operator-pickup.mjs",
                        "--projectionDir", ${JSON.stringify(projectionDir)},
                        "--sweepDir", ${JSON.stringify(sweepDir)},
                        "--dir", ${JSON.stringify(pickupDir)},
                    ], {
                        cwd: process.cwd(),
                        env: {
                            ...process.env,
                            OUTPUT_DIR: ${JSON.stringify(outputDir)},
                            LOG_DIR: ${JSON.stringify(logDir)},
                            LOG_LEVEL: "error",
                        },
                    });

                    const payload = JSON.parse(String(result.stdout).trim());
                    const latest = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(pickupDir)}, "latest.json"), "utf-8"));
                    const latestMarkdown = fs.readFileSync(path.join(${JSON.stringify(pickupDir)}, "latest.md"), "utf-8");
                    const historyDir = path.join(${JSON.stringify(pickupDir)}, "history");
                    const historyFiles = fs.readdirSync(historyDir);

                    console.log(JSON.stringify({
                        payload,
                        latest,
                        latestMarkdown,
                        historyFiles,
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
                PYTHON_BIN: "missing-python-for-ready-check",
                AUTONOMY_ENABLED: "true",
                MCP_WORKER_AUTH_TOKEN: "pickup-token",
            },
        });

        const result = parseLastJsonLine(stdout);
        assert.equal(result.payload.ok, true);
        assert.equal(result.latest.ok, true);
        assert.equal(result.latest.source, "gcpCompute");
        assert.equal(result.latest.triage.state, "incident_candidate");
        assert.equal(result.latest.triage.severity, "SEV-1");
        assert.equal(result.latest.triage.severityScore >= 1, true);
        assert.equal(result.latest.bridge.ok, true);
        assert.equal(result.latest.readiness.status, "not_ready");
        assert.equal(result.latest.queue.backlog.count >= 1, true);
        assert.equal(result.latest.autonomy.pendingApprovalCount, 1);
        assert.equal(result.latest.latestOperatorAction.present, true);
        assert.equal(result.latest.latestOperatorAction.action, "resume");
        assert.equal(result.latest.latestOperatorAction.actor, "pickup-operator");
        assert.equal(result.latest.latestOperatorAction.rollbackNote, "Pause again if readiness drops during observation.");
        assert.equal(result.latest.latestOperatorAction.manualRecoveryNote, "Inspect operator-summary latest.json before retrying.");
        assert.equal(Array.isArray(result.latest.overseer.orchestrationTrends), true);
        assert.equal(result.latest.overseer.orchestrationTrends[0].family, "string_trio");
        assert.equal(result.latest.overseer.orchestrationTrends[0].averageRegisterBalanceFit, 0.86);
        assert.equal(result.latest.overseer.phraseBreathTrend.manifestCount, 2);
        assert.equal(result.latest.overseer.phraseBreathTrend.weakManifestCount, 1);
        assert.equal(result.latest.overseer.harmonicColorTrend.manifestCount, 2);
        assert.equal(result.latest.overseer.harmonicColorTrend.weakManifestCount, 1);
        assert.equal(result.latest.overseer.harmonicColorTrend.averagePlanFit, 0.62);
        assert.equal(result.latest.overseer.learnedBackboneBenchmark.runCount, 2);
        assert.equal(result.latest.overseer.learnedBackboneBenchmark.reviewSampleStatus.status, "directional_only");
        assert.equal(result.latest.overseer.learnedBackboneBenchmark.retryLocalizationStability.status, "drifting");
        assert.equal(result.latest.overseer.learnedBackboneBenchmark.reviewPacks.matchedPackCount, 1);
        assert.equal(result.latest.overseer.learnedBackboneBenchmark.reviewPacks.activePackCount, 1);
        assert.equal(Array.isArray(result.latest.overseer.learnedBackboneBenchmark.reviewPackActions), true);
        assert.equal(result.latest.overseer.learnedBackboneBenchmark.reviewPackActions.length, 0);
        assert.equal(Array.isArray(result.latest.overseer.learnedBackboneBenchmark.reviewPackRecordActions), true);
        assert.equal(result.latest.overseer.learnedBackboneBenchmark.reviewPackRecordActions[0].packId, "active-pack-v1");
        assert.equal(result.latest.overseer.learnedBackboneBenchmark.reviewPackRecordActions[0].pendingDecisionCount, 2);
        assert.equal(result.latest.overseer.learnedBackboneBenchmark.reviewPackRecordActions[0].command, "npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs/_system/ml/review-packs/learned-backbone/active-pack-v1/review-sheet.csv");
        assert.equal(result.latest.overseer.shadowReranker.promotionOutcomes.reviewedManifestCount, 2);
        assert.equal(result.latest.overseer.shadowReranker.promotionAdvantage.sufficientReviewSample, false);
        assert.equal(result.latest.incidentDraft.present, true);
        assert.equal(result.latest.incidentDraft.severity, "SEV-1");
        assert.equal(result.latest.incidentDraft.severityScore >= 1, true);
        assert.equal(result.latest.incidentDraft.scope, "runtime");
        assert.equal(result.latest.incidentDraft.escalation.required, true);
        assert.equal(result.latest.incidentDraft.comms.nextAction, "Inspect operator-summary latest.json before retrying.");
        assert.match(result.latest.incidentDraft.comms.changeSummary, /Recent operator action: resume via api by pickup-operator\./);
        assert.match(result.latest.incidentDraft.comms.mitigationInProgress, /Rollback checkpoint: Pause again if readiness drops during observation\./);
        assert.match(result.latest.incidentDraft.comms.initialAcknowledgement, /Next update in 15 minutes/);
        assert.equal(Array.isArray(result.latest.incidentDraft.orchestrationTrends), true);
        assert.equal(result.latest.incidentDraft.orchestrationTrends[0].averageIdiomaticRangeFit, 0.89);
        assert.equal(result.latest.incidentDraft.phraseBreathTrend.manifestCount, 2);
        assert.equal(result.latest.incidentDraft.harmonicColorTrend.manifestCount, 2);
        assert.equal(result.latest.incidentDraft.harmonicColorTrend.averageTargetFit, 0.575);
        assert.equal(result.latest.incidentDraft.learnedBackboneBenchmark.runCount, 2);
        assert.equal(result.latest.incidentDraft.learnedBackboneBenchmark.reviewSampleStatus.status, "directional_only");
        assert.equal(result.latest.incidentDraft.learnedBackboneBenchmark.pairedSelectionOutcomes.reviewedManifestCount, 2);
        assert.equal(result.latest.incidentDraft.learnedBackboneBenchmark.pairedSelectionOutcomes.promotedReviewedCount, 0);
        assert.equal(result.latest.incidentDraft.learnedBackboneBenchmark.selectedWorkerOutcomes.music21.runCount, 2);
        assert.equal(result.latest.incidentDraft.learnedBackboneBenchmark.coverageRows.length, 1);
        assert.equal(result.latest.incidentDraft.learnedBackboneBenchmark.retryLocalizationStability.status, "drifting");
        assert.equal(result.latest.incidentDraft.shadowReranker.promotionAdvantage.signal, "insufficient_data");
        assert.equal(result.latest.evidence.projectionStale, true);
        assert.equal(Array.isArray(result.latest.recommendations), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("orchestration trend shows trio ensemble pressure")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("harmonic-color trend shows local color pressure")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("learned backbone benchmark retry localization is drifting")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("shadow reranker narrow-lane review data is still sparse")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("latest operator action rollback note: Pause again if readiness drops during observation.")), true);
        assert.equal(result.latest.recommendations.some((item) => item.includes("latest operator action manual recovery note: Inspect operator-summary latest.json before retrying.")), true);
        assert.equal(result.historyFiles.length, 1);
        assert.match(result.latestMarkdown, /# AXIOM Shared Operator Pickup/);
        assert.match(result.latestMarkdown, /## Latest Operator Action/);
        assert.match(result.latestMarkdown, /- action: resume/);
        assert.match(result.latestMarkdown, /- rollbackNote: Pause again if readiness drops during observation\./);
        assert.match(result.latestMarkdown, /- manualRecoveryNote: Inspect operator-summary latest.json before retrying\./);
        assert.match(result.latestMarkdown, /## Phrase-Breath Trend/);
        assert.match(result.latestMarkdown, /- manifests=2 \| plan=0\.66 \| cov=0\.66 \| pickup=0\.61 \| arr=0\.60 \| rel=0\.58 \| weakManifests=1/);
        assert.match(result.latestMarkdown, /## Harmonic-Color Trend/);
        assert.match(result.latestMarkdown, /- manifests=2 \| plan=0\.62 \| cov=0\.62 \| target=0\.57 \| time=0\.58 \| tonic=0\.56 \| prolong=0\.61 \| weakManifests=1/);
        assert.match(result.latestMarkdown, /## Learned Backbone Benchmark/);
        assert.match(result.latestMarkdown, /- lane=string_trio_symbolic \| pack=string_trio_symbolic_benchmark_pack_v1 \| runs=2 \| paired=2 \| reviewed=2 \| pendingReview=0/);
        assert.match(result.latestMarkdown, /- sampleStatus=directional_only \| reviewed=2 \| reviewedDisagreements=0/);
        assert.match(result.latestMarkdown, /- pairedSelection reviewed=2 \| promotedReviewed=0 \| heuristicReviewed=2 \| promotedApproval=- \| heuristicApproval=0\.50 \| promotedAppeal=- \| heuristicAppeal=0\.62/);
        assert.match(result.latestMarkdown, /- selectedWorkerOutcome worker=music21 \| runs=2 \| reviewed=2 \| pendingReview=0 \| approved=1 \| rejected=1 \| approvalRate=0\.50 \| avgAppeal=0\.62/);
        assert.match(result.latestMarkdown, /- coverage benchmark=stage-b-string-trio \| runs=2 \| paired=2 \| reviewed=2 \| pendingReview=0 \| approvalRate=0\.50 \| avgAppeal=0\.62 \| selectedWorkers=music21:2 \| generationModes=plan_conditioned_trio_template:2 \| lastObserved=2026-04-17T04:08:00.000Z/);
        assert.match(result.latestMarkdown, /- reviewQueue pendingBlind=2 \| pendingShortlist=0 \| latestPendingAt=/);
        assert.match(result.latestMarkdown, /- reviewPacks matched=1 \| active=1 \| pendingDecisions=2 \| completedDecisions=0 \| latestGeneratedAt=.* \| latestReviewedAt=-/);
        assert.match(result.latestMarkdown, /- reviewPack pack=active-pack-v1 \| target=pairwise \| entries=2 \| completed=0 \| pending=2 \| pendingShortlist=0 \| generatedAt=.* \| latestReviewedAt=- \| reviewSheet=outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv \| recordCommand=npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs\/_system\/ml\/review-packs\/learned-backbone\/active-pack-v1\/review-sheet\.csv/);
        assert.match(result.latestMarkdown, /- retryStability status=drifting \| retrying=2 \| sectionTargetedOnly=1 \| mixed=0 \| globalOnly=1 \| targetedRate=0\.50 \| driftRate=0\.50/);
        assert.match(result.latestMarkdown, /- advisory: finish 2 pending worksheet decision\(s\) in 1 active learned backbone review pack before generating more blind-review packs; learned backbone benchmark retry localization is drifting/);
        assert.match(result.latestMarkdown, /## Shadow Reranker/);
        assert.match(result.latestMarkdown, /- promotionAdvantage lane=string_trio_symbolic \| reviewed=2 \| promotedReviewed=1 \| heuristicReviewed=1 \| sufficientSample=no \| approvalDelta=1\.00 \| appealDelta=0\.62 \| signal=insufficient_data/);
        assert.match(result.latestMarkdown, /- advisory: shadow reranker narrow-lane review data is still sparse/);
        assert.match(result.latestMarkdown, /## Orchestration Trends/);
        assert.match(result.latestMarkdown, /- trio \| instruments=violin \/ viola \/ cello \| manifests=1 \| rng=0\.89 \| bal=0\.86 \| conv=0\.82 \| dbl=0\.80 \| rot=0\.77 \| weakManifests=1 \| avgWeakSections=1\.00/);
        assert.match(result.latestMarkdown, /orchestration trend shows trio ensemble pressure/);
        assert.match(result.latestMarkdown, /harmonic-color trend shows local color pressure/);
        assert.match(result.latestMarkdown, /## Incident Draft/);
        assert.match(result.latestMarkdown, /## Escalation/);
        assert.match(result.latestMarkdown, /## Comms Draft/);
        assert.match(result.latestMarkdown, /- severityScore: /);
        assert.match(result.latestMarkdown, /- nextAction: Inspect operator-summary latest\.json before retrying\./);
        assert.match(result.latestMarkdown, /Rollback checkpoint: Pause again if readiness drops during observation\./);
        assert.match(result.latestMarkdown, /- present: yes/);
        assert.match(result.latestMarkdown, /pending-song/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("project-operator-pickup records failure evidence when source artifacts are missing", async () => {
    const { tempRoot } = createTempRuntimeRoot("axiom-operator-pickup-failure-");
    const projectionDir = path.join(tempRoot, "projection");
    const sweepDir = path.join(tempRoot, "sweep");
    const pickupDir = path.join(tempRoot, "pickup");

    try {
        let caught = null;
        try {
            await execFileAsync(process.execPath, [
                "scripts/project-operator-pickup.mjs",
                "--projectionDir", projectionDir,
                "--sweepDir", sweepDir,
                "--dir", pickupDir,
            ], {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    LOG_LEVEL: "error",
                },
            });
        } catch (error) {
            caught = error;
        }

        assert.ok(caught);

        const latestError = JSON.parse(fs.readFileSync(path.join(pickupDir, "latest-error.json"), "utf-8"));
        const errorFiles = fs.readdirSync(path.join(pickupDir, "errors"));

        assert.equal(latestError.ok, false);
        assert.match(latestError.message, /artifact is missing/);
        assert.equal(errorFiles.length, 1);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});