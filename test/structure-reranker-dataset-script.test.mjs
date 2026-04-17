import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    return fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function seedStructureRankManifest(outputDir, options) {
    const songDir = path.join(outputDir, options.songId);
    writeJson(path.join(songDir, "manifest.json"), options.manifest);
    if (options.sectionArtifacts) {
        writeJson(path.join(songDir, "section-artifacts.json"), options.sectionArtifacts);
    }
    if (options.expressionPlan) {
        writeJson(path.join(songDir, "expression-plan.json"), options.expressionPlan);
    }
}

function seedStructureCandidateEvidence(outputDir, options) {
    const songDir = path.join(outputDir, options.songId, "candidates");
    writeJson(path.join(songDir, "index.json"), options.index);
    for (const candidate of options.candidates) {
        writeJson(path.join(songDir, candidate.candidateId, "candidate-manifest.json"), candidate.manifest);
        if (candidate.sectionArtifacts) {
            writeJson(path.join(songDir, candidate.candidateId, "section-artifacts.json"), candidate.sectionArtifacts);
        }
    }
}

test("export-structure-reranker-dataset writes grouped structure_rank_v1 snapshots", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-structure-rank-"));
    const outputDir = path.join(tempRoot, "outputs");
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        seedStructureRankManifest(outputDir, {
            songId: "song-a",
            manifest: {
                songId: "song-a",
                state: "DONE",
                meta: {
                    songId: "song-a",
                    prompt: "learned reranker baseline piano miniature",
                    key: "C major",
                    tempo: 92,
                    form: "miniature",
                    source: "autonomy",
                    promptHash: "hash-a",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    plannedSectionCount: 2,
                    plannerTelemetry: {
                        planSignature: "plan-a",
                    },
                    selectedModels: [
                        { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                    ],
                    createdAt: "2026-04-17T01:00:00.000Z",
                    updatedAt: "2026-04-17T01:10:00.000Z",
                },
                artifacts: {
                    midi: "outputs/song-a/composition.mid",
                },
                approvalStatus: "approved",
                reviewFeedback: {
                    note: "Middle cadence improved, but compare against the previous chamber pass.",
                    appealScore: 8.7,
                    strongestDimension: "phrase_breath",
                    weakestDimension: "harmonic_color",
                    comparisonReference: "run-2026-04-16-chamber-baseline",
                },
                structureEvaluation: {
                    passed: true,
                    score: 88,
                    issues: [],
                    strengths: ["Cadential rhetoric reads clearly."],
                    metrics: {
                        phrasePressureFit: 0.83,
                        harmonicColorPlanFit: 0.74,
                    },
                    weakestSections: [
                        {
                            sectionId: "s2",
                            label: "Cadence",
                            role: "cadence",
                            startMeasure: 9,
                            endMeasure: 12,
                            score: 72,
                            issues: ["Applied dominant color under-landed."],
                            strengths: [],
                            metrics: {
                                harmonicColorPlanFit: 0.58,
                            },
                        },
                    ],
                    longSpan: {
                        status: "held",
                        weakestDimension: "return_payoff",
                        weakDimensions: [],
                        averageFit: 0.81,
                        thematicCheckpointCount: 0,
                    },
                },
                qualityControl: {
                    policy: {
                        enableAutoRevision: true,
                    },
                    attempts: [
                        {
                            attempt: 1,
                            stage: "structure",
                            passed: false,
                            score: 73,
                            issues: ["Closing cadence still too flat."],
                            strengths: ["Opening profile is stable."],
                            metrics: {
                                phrasePressureFit: 0.61,
                            },
                            directives: [
                                { kind: "clarify_phrase_rhetoric", priority: 0.7, reason: "weak cadence release", sectionIds: ["s2"] },
                            ],
                            evaluatedAt: "2026-04-17T01:03:00.000Z",
                        },
                        {
                            attempt: 2,
                            stage: "structure",
                            passed: true,
                            score: 88,
                            issues: [],
                            strengths: ["Cadential rhetoric reads clearly."],
                            metrics: {
                                phrasePressureFit: 0.83,
                                harmonicColorPlanFit: 0.74,
                            },
                            directives: [],
                            evaluatedAt: "2026-04-17T01:05:00.000Z",
                        },
                    ],
                    selectedAttempt: 2,
                    stopReason: "structure evaluation accepted the symbolic draft",
                },
                updatedAt: "2026-04-17T01:10:00.000Z",
            },
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "theme_a",
                    measureCount: 8,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [60, 62, 64],
                    phraseFunction: "presentation",
                    counterpointMode: "none",
                    harmonicColorCues: [{ tag: "mixture", startMeasure: 4, endMeasure: 4 }],
                },
                {
                    sectionId: "s2",
                    role: "cadence",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [67, 65, 64],
                    phraseFunction: "cadential",
                    counterpointMode: "contrary_motion",
                    harmonicColorCues: [{ tag: "applied_dominant", startMeasure: 10, endMeasure: 11 }],
                },
            ],
            expressionPlan: {
                sections: [
                    {
                        sectionId: "s1",
                        phraseFunction: "presentation",
                        phraseBreath: { pickupStartMeasure: 1, pickupEndMeasure: 1, arrivalMeasure: 4 },
                        tempoMotion: [{ tag: "ritardando", startMeasure: 3, endMeasure: 4 }],
                        ornaments: [{ tag: "fermata", sectionId: "s1", targetBeat: 4 }],
                        texture: { counterpointMode: "none" },
                    },
                    {
                        sectionId: "s2",
                        phraseFunction: "cadential",
                        phraseBreath: { arrivalMeasure: 11, releaseStartMeasure: 12, releaseEndMeasure: 12 },
                        tempoMotion: [{ tag: "a_tempo", startMeasure: 11, endMeasure: 12 }],
                        ornaments: [{ tag: "trill", sectionId: "s2", targetBeat: 3 }],
                        texture: { counterpointMode: "contrary_motion" },
                    },
                ],
                tempoMotionDefaults: [{ tag: "ritenuto", startMeasure: 12, endMeasure: 12 }],
                ornamentDefaults: [{ tag: "arpeggio", sectionId: "s2", targetBeat: 1 }],
            },
        });

        seedStructureCandidateEvidence(outputDir, {
            songId: "song-a",
            index: {
                version: 1,
                songId: "song-a",
                updatedAt: "2026-04-17T01:06:00.000Z",
                selectedCandidateId: "structure-a2-python-music21-symbolic-v1-2",
                selectedAttempt: 2,
                entries: [
                    {
                        candidateId: "structure-a1-python-music21-symbolic-v1-1",
                        attempt: 1,
                        stage: "structure",
                        selected: false,
                        workflow: "symbolic_only",
                        worker: "music21",
                        provider: "python",
                        model: "music21-symbolic-v1",
                        passed: false,
                        score: 73,
                        evaluatedAt: "2026-04-17T01:03:00.000Z",
                    },
                    {
                        candidateId: "structure-a2-python-music21-symbolic-v1-2",
                        attempt: 2,
                        stage: "structure",
                        selected: true,
                        workflow: "symbolic_only",
                        worker: "learned_symbolic",
                        provider: "learned",
                        model: "learned-symbolic-trio-v1",
                        passed: true,
                        score: 88,
                        evaluatedAt: "2026-04-17T01:05:00.000Z",
                        proposalEvidence: {
                            worker: "learned_symbolic",
                            lane: "string_trio_symbolic",
                            provider: "learned",
                            model: "learned-symbolic-trio-v1",
                            generationMode: "targeted_section_rewrite",
                            confidence: 0.61,
                            summary: {
                                measureCount: 12,
                                noteCount: 36,
                                partCount: 3,
                                partInstrumentNames: ["Violin", "Viola", "Cello"],
                                key: "C major",
                                tempo: 92,
                                form: "miniature",
                            },
                        },
                    },
                ],
            },
            candidates: [
                {
                    candidateId: "structure-a1-python-music21-symbolic-v1-1",
                    manifest: {
                        version: 1,
                        stage: "structure",
                        songId: "song-a",
                        candidateId: "structure-a1-python-music21-symbolic-v1-1",
                        attempt: 1,
                        selected: false,
                        evaluatedAt: "2026-04-17T01:03:00.000Z",
                        workflow: "symbolic_only",
                        worker: "music21",
                        provider: "python",
                        model: "music21-symbolic-v1",
                        meta: {
                            promptHash: "hash-a",
                            plannerVersion: "planner-v1",
                            source: "autonomy",
                            workflow: "symbolic_only",
                            form: "miniature",
                            key: "C major",
                            tempo: 92,
                        },
                        executionPlan: {
                            workflow: "symbolic_only",
                            composeWorker: "music21",
                            selectedModels: [
                                { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                            ],
                        },
                        compositionPlan: {
                            form: "miniature",
                            key: "C major",
                            tempo: 92,
                            sections: [
                                {
                                    sectionId: "s1",
                                    role: "theme_a",
                                    phraseFunction: "presentation",
                                    texture: { counterpointMode: "none" },
                                },
                                {
                                    sectionId: "s2",
                                    role: "transition",
                                    phraseFunction: "continuation",
                                    texture: { counterpointMode: "none" },
                                },
                            ],
                        },
                        revisionDirectives: [],
                        structureEvaluation: {
                            passed: false,
                            score: 73,
                            issues: ["Closing cadence still too flat."],
                            strengths: ["Opening profile is stable."],
                            metrics: {
                                phrasePressureFit: 0.61,
                            },
                        },
                        artifacts: {},
                    },
                    sectionArtifacts: [
                        {
                            sectionId: "s1",
                            role: "theme_a",
                            measureCount: 8,
                            melodyEvents: [],
                            accompanimentEvents: [],
                            noteHistory: [60, 62, 64],
                            phraseFunction: "presentation",
                            counterpointMode: "none",
                        },
                        {
                            sectionId: "s2",
                            role: "transition",
                            measureCount: 4,
                            melodyEvents: [],
                            accompanimentEvents: [],
                            noteHistory: [67, 68, 69],
                            phraseFunction: "continuation",
                            counterpointMode: "none",
                        },
                    ],
                },
                {
                    candidateId: "structure-a2-python-music21-symbolic-v1-2",
                    manifest: {
                        version: 1,
                        stage: "structure",
                        songId: "song-a",
                        candidateId: "structure-a2-python-music21-symbolic-v1-2",
                        attempt: 2,
                        selected: true,
                        evaluatedAt: "2026-04-17T01:05:00.000Z",
                        workflow: "symbolic_only",
                        worker: "learned_symbolic",
                        provider: "learned",
                        model: "learned-symbolic-trio-v1",
                        meta: {
                            promptHash: "hash-a",
                            plannerVersion: "planner-v1",
                            source: "autonomy",
                            workflow: "symbolic_only",
                            form: "miniature",
                            key: "C major",
                            tempo: 92,
                        },
                        executionPlan: {
                            workflow: "symbolic_only",
                            composeWorker: "learned_symbolic",
                            selectedModels: [
                                { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
                            ],
                        },
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
                                    tempoMotion: [{ tag: "ritardando", startMeasure: 3, endMeasure: 4 }],
                                    ornaments: [{ tag: "fermata", sectionId: "s1", targetBeat: 4 }],
                                    texture: { counterpointMode: "none" },
                                    harmonicPlan: {
                                        colorCues: [{ tag: "mixture", startMeasure: 4, endMeasure: 4 }],
                                    },
                                },
                                {
                                    sectionId: "s2",
                                    role: "cadence",
                                    phraseFunction: "cadential",
                                    phraseBreath: { arrivalMeasure: 11, releaseStartMeasure: 12, cadenceRecoveryStartMeasure: 12 },
                                    tempoMotion: [{ tag: "a_tempo", startMeasure: 11, endMeasure: 12 }],
                                    ornaments: [{ tag: "trill", sectionId: "s2", targetBeat: 3 }],
                                    texture: { counterpointMode: "contrary_motion" },
                                    harmonicPlan: {
                                        colorCues: [{ tag: "applied_dominant", startMeasure: 10, endMeasure: 11 }],
                                    },
                                },
                            ],
                            tempoMotionDefaults: [{ tag: "ritenuto", startMeasure: 12, endMeasure: 12 }],
                            ornamentDefaults: [{ tag: "arpeggio", sectionId: "s2", targetBeat: 1 }],
                        },
                        revisionDirectives: [
                            { kind: "clarify_phrase_rhetoric", priority: 0.7, reason: "weak cadence release", sectionIds: ["s2"] },
                        ],
                        proposalEvidence: {
                            worker: "learned_symbolic",
                            lane: "string_trio_symbolic",
                            provider: "learned",
                            model: "learned-symbolic-trio-v1",
                            generationMode: "targeted_section_rewrite",
                            confidence: 0.61,
                            summary: {
                                measureCount: 12,
                                noteCount: 36,
                                partCount: 3,
                                partInstrumentNames: ["Violin", "Viola", "Cello"],
                                key: "C major",
                                tempo: 92,
                                form: "miniature",
                            },
                        },
                        sectionTransforms: [
                            {
                                sectionId: "s2",
                                transformMode: "targeted_rewrite:clarify_phrase_rhetoric",
                                sourceSectionId: "s2",
                            },
                        ],
                        structureEvaluation: {
                            passed: true,
                            score: 88,
                            issues: [],
                            strengths: ["Cadential rhetoric reads clearly."],
                            metrics: {
                                phrasePressureFit: 0.83,
                                harmonicColorPlanFit: 0.74,
                            },
                            weakestSections: [
                                {
                                    sectionId: "s2",
                                    role: "cadence",
                                    score: 72,
                                    issues: ["Applied dominant color under-landed."],
                                    metrics: {
                                        harmonicColorPlanFit: 0.58,
                                    },
                                },
                            ],
                            longSpan: {
                                status: "held",
                                weakestDimension: "return_payoff",
                                averageFit: 0.81,
                            },
                        },
                        artifacts: {},
                    },
                    sectionArtifacts: [
                        {
                            sectionId: "s1",
                            role: "theme_a",
                            measureCount: 8,
                            melodyEvents: [],
                            accompanimentEvents: [],
                            noteHistory: [60, 62, 64],
                            phraseFunction: "presentation",
                            counterpointMode: "none",
                            harmonicColorCues: [{ tag: "mixture", startMeasure: 4, endMeasure: 4 }],
                        },
                        {
                            sectionId: "s2",
                            role: "cadence",
                            measureCount: 4,
                            melodyEvents: [],
                            accompanimentEvents: [],
                            noteHistory: [67, 65, 64],
                            phraseFunction: "cadential",
                            counterpointMode: "contrary_motion",
                            harmonicColorCues: [{ tag: "applied_dominant", startMeasure: 10, endMeasure: 11 }],
                        },
                    ],
                },
            ],
        });

        seedStructureRankManifest(outputDir, {
            songId: "song-b",
            manifest: {
                songId: "song-b",
                state: "DONE",
                meta: {
                    songId: "song-b",
                    prompt: "fallback synthetic attempt export",
                    form: "miniature",
                    source: "api",
                    promptHash: "hash-b",
                    workflow: "symbolic_plus_audio",
                    plannerVersion: "planner-v1",
                    plannerTelemetry: {
                        planSignature: "plan-b",
                    },
                    selectedModels: [
                        { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                    ],
                    createdAt: "2026-04-17T02:00:00.000Z",
                    updatedAt: "2026-04-17T02:05:00.000Z",
                },
                artifacts: {},
                structureEvaluation: {
                    passed: true,
                    score: 79,
                    issues: [],
                    strengths: ["Synthetic fallback path still exports one selected candidate."],
                    metrics: {
                        phrasePressureFit: 0.69,
                    },
                },
                updatedAt: "2026-04-17T02:05:00.000Z",
            },
        });

        const stdout = execFileSync(
            process.execPath,
            [
                "scripts/export-structure-reranker-dataset.mjs",
                "--root",
                outputDir,
                "--snapshot",
                "test-snapshot",
            ],
            {
                cwd: repoRoot,
                encoding: "utf8",
            },
        );

        const payload = JSON.parse(stdout.trim());
        assert.equal(payload.ok, true);
        assert.equal(payload.datasetVersion, "structure_rank_v1");
        assert.equal(payload.groupCount, 2);
        assert.equal(payload.exampleCount, 3);
        assert.equal(payload.labelDistribution.selectedExamples, 2);
        assert.equal(payload.featureAvailability.derivedFromSyntheticAttempt, 1);
        assert.equal(payload.featureAvailability.hasProposalEvidence, 1);
        assert.equal(payload.featureAvailability.hasLearnedProposalEvidence, 1);
        assert.equal(payload.featureAvailability.hasProposalLane, 1);
        assert.equal(payload.featureAvailability.hasProposalSummary, 1);
        assert.equal(payload.featureAvailability.hasReviewFeedback, 1);
        assert.equal(payload.featureAvailability.hasReviewFeedbackNote, 1);
        assert.equal(payload.featureAvailability.hasComparisonReference, 1);
        assert.equal(payload.featureAvailability.hasInputDirectiveContext, 1);
        assert.equal(payload.featureAvailability.hasTargetedRewriteContext, 1);

        const datasetRoot = path.join(outputDir, "_system", "ml", "datasets", "structure-rank-v1", "test-snapshot");
        assert.equal(fs.existsSync(path.join(datasetRoot, "manifest.json")), true);
        assert.equal(fs.existsSync(path.join(datasetRoot, "train.jsonl")), true);
        assert.equal(fs.existsSync(path.join(datasetRoot, "val.jsonl")), true);
        assert.equal(fs.existsSync(path.join(datasetRoot, "test.jsonl")), true);

        const allExamples = [
            ...readJsonl(path.join(datasetRoot, "train.jsonl")),
            ...readJsonl(path.join(datasetRoot, "val.jsonl")),
            ...readJsonl(path.join(datasetRoot, "test.jsonl")),
        ];
        assert.equal(allExamples.length, 3);

        const rejectedCandidate = allExamples.find((entry) => entry.songId === "song-a" && entry.attempt === 1);
        const selectedCandidate = allExamples.find((entry) => entry.songId === "song-a" && entry.attempt === 2);
        const syntheticCandidate = allExamples.find((entry) => entry.songId === "song-b");

        assert.equal(rejectedCandidate.labels.selectedWithinGroup, false);
        assert.equal(rejectedCandidate.labels.pairwiseLosses, 1);
        assert.equal(rejectedCandidate.featureAvailability.hasSectionArtifacts, true);
        assert.equal(rejectedCandidate.featureAvailability.hasCompositionPlan, true);
        assert.deepEqual(rejectedCandidate.lineage.priorDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.deepEqual(rejectedCandidate.lineage.inputDirectiveKinds, []);
        assert.equal(rejectedCandidate.lineage.retryLocalization, "none");
        assert.deepEqual(rejectedCandidate.planSummary.sectionRoles, ["theme_a", "transition"]);
        assert.equal(rejectedCandidate.symbolicArtifacts.sectionArtifactCount, 2);
        assert.equal(rejectedCandidate.reviewSignals.selectedAttempt, 2);
        assert.equal(rejectedCandidate.reviewSignals.note, "Middle cadence improved, but compare against the previous chamber pass.");
        assert.equal(rejectedCandidate.reviewSignals.selectedAttemptWasRetry, true);
        assert.deepEqual(rejectedCandidate.reviewSignals.inputDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.deepEqual(rejectedCandidate.reviewSignals.inputDirectiveSectionIds, ["s2"]);
        assert.equal(rejectedCandidate.reviewSignals.retryLocalization, "section_targeted");
        assert.equal(rejectedCandidate.reviewSignals.selectedGenerationMode, "targeted_section_rewrite");
        assert.deepEqual(rejectedCandidate.reviewSignals.selectedRewriteDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.deepEqual(rejectedCandidate.reviewSignals.selectedRewriteSectionIds, ["s2"]);
        assert.deepEqual(rejectedCandidate.reviewSignals.selectedTransformModes, ["targeted_rewrite:clarify_phrase_rhetoric"]);

        assert.equal(selectedCandidate.labels.selectedWithinGroup, true);
        assert.equal(selectedCandidate.labels.approvedOutcome, true);
        assert.equal(selectedCandidate.worker, "learned_symbolic");
        assert.deepEqual(selectedCandidate.planSummary.sectionRoles, ["cadence", "theme_a"]);
        assert.deepEqual(selectedCandidate.planSummary.counterpointModes, ["contrary_motion", "none"]);
        assert.equal(selectedCandidate.symbolicArtifacts.phraseBreathCueCount, 5);
        assert.equal(selectedCandidate.symbolicArtifacts.harmonicColorCueCount, 2);
        assert.equal(selectedCandidate.featureAvailability.hasSectionArtifacts, true);
        assert.equal(selectedCandidate.featureAvailability.hasProposalEvidence, true);
        assert.equal(selectedCandidate.featureAvailability.hasLearnedProposalEvidence, true);
        assert.equal(selectedCandidate.featureAvailability.hasReviewFeedback, true);
        assert.equal(selectedCandidate.featureAvailability.hasInputDirectiveContext, true);
        assert.equal(selectedCandidate.featureAvailability.hasTargetedRewriteContext, true);
        assert.equal(selectedCandidate.proposalEvidence.lane, "string_trio_symbolic");
        assert.equal(selectedCandidate.proposalEvidence.generationMode, "targeted_section_rewrite");
        assert.equal(selectedCandidate.proposalEvidence.summary.partCount, 3);
        assert.deepEqual(selectedCandidate.proposalEvidence.summary.partInstrumentNames, ["Cello", "Viola", "Violin"]);
        assert.deepEqual(selectedCandidate.lineage.priorDirectiveKinds, []);
        assert.deepEqual(selectedCandidate.lineage.inputDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.deepEqual(selectedCandidate.lineage.inputDirectiveSectionIds, ["s2"]);
        assert.equal(selectedCandidate.lineage.retryLocalization, "section_targeted");
        assert.equal(selectedCandidate.lineage.retriedFromAttempt, 1);
        assert.equal(selectedCandidate.reviewSignals.approvalStatus, "approved");
        assert.equal(selectedCandidate.reviewSignals.comparisonReference, "run-2026-04-16-chamber-baseline");
        assert.equal(selectedCandidate.reviewSignals.selectedAttemptWasRetry, true);
        assert.equal(selectedCandidate.reviewSignals.selectedGenerationMode, "targeted_section_rewrite");
        assert.deepEqual(selectedCandidate.reviewSignals.inputDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.deepEqual(selectedCandidate.reviewSignals.inputDirectiveSectionIds, ["s2"]);
        assert.equal(selectedCandidate.reviewSignals.retryLocalization, "section_targeted");
        assert.deepEqual(selectedCandidate.reviewSignals.selectedRewriteDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.deepEqual(selectedCandidate.reviewSignals.selectedRewriteSectionIds, ["s2"]);
        assert.deepEqual(selectedCandidate.reviewSignals.selectedTransformModes, ["targeted_rewrite:clarify_phrase_rhetoric"]);

        assert.equal(syntheticCandidate.featureAvailability.derivedFromSyntheticAttempt, true);
        assert.equal(syntheticCandidate.labels.selectedWithinGroup, true);
        assert.equal(syntheticCandidate.structure.score, 79);
        assert.equal(syntheticCandidate.reviewSignals.selectedAttempt, 1);
        assert.equal(syntheticCandidate.reviewSignals.selectedAttemptWasRetry, false);
        assert.deepEqual(syntheticCandidate.reviewSignals.inputDirectiveKinds, []);
        assert.deepEqual(syntheticCandidate.reviewSignals.inputDirectiveSectionIds, []);
        assert.equal(syntheticCandidate.reviewSignals.retryLocalization, "none");
        assert.deepEqual(syntheticCandidate.reviewSignals.selectedRewriteDirectiveKinds, []);
        assert.deepEqual(syntheticCandidate.reviewSignals.selectedRewriteSectionIds, []);
        assert.deepEqual(syntheticCandidate.reviewSignals.selectedTransformModes, []);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("export-structure-reranker-dataset falls back to winning manifest reviewSignals context without candidate sidecars", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-structure-rank-fallback-"));
    const outputDir = path.join(tempRoot, "outputs");
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        seedStructureRankManifest(outputDir, {
            songId: "song-fallback",
            manifest: {
                songId: "song-fallback",
                state: "DONE",
                meta: {
                    songId: "song-fallback",
                    prompt: "manifest fallback targeted rewrite export",
                    key: "D minor",
                    tempo: 108,
                    form: "miniature",
                    source: "api",
                    promptHash: "hash-fallback",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    selectedModels: [
                        { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
                    ],
                    createdAt: "2026-04-17T03:00:00.000Z",
                    updatedAt: "2026-04-17T03:10:00.000Z",
                },
                approvalStatus: "approved",
                reviewFeedback: {
                    note: "Localized rewrite fixed the closing rhetoric.",
                    appealScore: 8.9,
                    strongestDimension: "phrase_breath",
                    weakestDimension: "harmonic_color",
                    comparisonReference: "run-2026-04-17-baseline",
                },
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    generationMode: "targeted_section_rewrite",
                    confidence: 0.67,
                },
                sectionTransforms: [
                    {
                        sectionId: "s2",
                        transformMode: "targeted_rewrite:clarify_phrase_rhetoric",
                        sourceSectionId: "s2",
                    },
                ],
                structureEvaluation: {
                    passed: true,
                    score: 86,
                    issues: [],
                    strengths: ["Selected retry stabilized the cadence."],
                    metrics: {
                        phrasePressureFit: 0.79,
                    },
                },
                qualityControl: {
                    attempts: [
                        {
                            attempt: 1,
                            stage: "structure",
                            passed: false,
                            score: 71,
                            issues: ["Cadence stayed too static."],
                            strengths: [],
                            metrics: {
                                phrasePressureFit: 0.58,
                            },
                            directives: [
                                { kind: "clarify_phrase_rhetoric", priority: 0.8, reason: "under-landed cadence", sectionIds: ["s2"] },
                            ],
                            evaluatedAt: "2026-04-17T03:04:00.000Z",
                        },
                        {
                            attempt: 2,
                            stage: "structure",
                            passed: true,
                            score: 86,
                            issues: [],
                            strengths: ["Selected retry stabilized the cadence."],
                            metrics: {
                                phrasePressureFit: 0.79,
                            },
                            directives: [],
                            evaluatedAt: "2026-04-17T03:06:00.000Z",
                        },
                    ],
                    selectedAttempt: 2,
                    stopReason: "selected retry accepted",
                },
                updatedAt: "2026-04-17T03:10:00.000Z",
            },
        });

        execFileSync(
            process.execPath,
            [
                "scripts/export-structure-reranker-dataset.mjs",
                "--root",
                outputDir,
                "--snapshot",
                "fallback-snapshot",
            ],
            {
                cwd: repoRoot,
                encoding: "utf8",
            },
        );

        const datasetRoot = path.join(outputDir, "_system", "ml", "datasets", "structure-rank-v1", "fallback-snapshot");
        const allExamples = [
            ...readJsonl(path.join(datasetRoot, "train.jsonl")),
            ...readJsonl(path.join(datasetRoot, "val.jsonl")),
            ...readJsonl(path.join(datasetRoot, "test.jsonl")),
        ];

        assert.equal(allExamples.length, 2);
        for (const example of allExamples) {
            assert.equal(example.reviewSignals.selectedAttempt, 2);
            assert.equal(example.reviewSignals.selectedAttemptWasRetry, true);
            assert.deepEqual(example.reviewSignals.inputDirectiveKinds, ["clarify_phrase_rhetoric"]);
            assert.deepEqual(example.reviewSignals.inputDirectiveSectionIds, ["s2"]);
            assert.equal(example.reviewSignals.retryLocalization, "section_targeted");
            assert.equal(example.reviewSignals.retriedFromAttempt, 1);
            assert.equal(example.reviewSignals.note, "Localized rewrite fixed the closing rhetoric.");
            assert.equal(example.reviewSignals.selectedGenerationMode, "targeted_section_rewrite");
            assert.deepEqual(example.reviewSignals.selectedRewriteDirectiveKinds, ["clarify_phrase_rhetoric"]);
            assert.deepEqual(example.reviewSignals.selectedRewriteSectionIds, ["s2"]);
            assert.deepEqual(example.reviewSignals.selectedTransformModes, ["targeted_rewrite:clarify_phrase_rhetoric"]);
            assert.equal(example.featureAvailability.hasTargetedRewriteContext, true);
            assert.equal(example.featureAvailability.hasInputDirectiveContext, example.attempt === 2);
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("export-structure-reranker-dataset preserves retry lineage for legacy candidate sidecars without selected revisionDirectives", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-structure-rank-legacy-sidecar-"));
    const outputDir = path.join(tempRoot, "outputs");
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        seedStructureRankManifest(outputDir, {
            songId: "song-legacy",
            manifest: {
                songId: "song-legacy",
                state: "DONE",
                meta: {
                    songId: "song-legacy",
                    prompt: "legacy sidecar retry fallback",
                    key: "G minor",
                    tempo: 96,
                    form: "miniature",
                    source: "autonomy",
                    promptHash: "hash-legacy",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                    createdAt: "2026-04-17T04:00:00.000Z",
                    updatedAt: "2026-04-17T04:10:00.000Z",
                },
                approvalStatus: "approved",
                reviewFeedback: {
                    note: "Retry landed the cadence more clearly.",
                    appealScore: 8.2,
                },
                qualityControl: {
                    attempts: [
                        {
                            attempt: 1,
                            stage: "structure",
                            passed: false,
                            score: 69,
                            issues: ["Cadence blurred."],
                            strengths: [],
                            metrics: {
                                phrasePressureFit: 0.55,
                            },
                            directives: [
                                { kind: "clarify_phrase_rhetoric", priority: 0.8, reason: "cadence blurred", sectionIds: ["s2"] },
                            ],
                            evaluatedAt: "2026-04-17T04:03:00.000Z",
                        },
                        {
                            attempt: 2,
                            stage: "structure",
                            passed: true,
                            score: 84,
                            issues: [],
                            strengths: ["Cadence is clearer."],
                            metrics: {
                                phrasePressureFit: 0.78,
                            },
                            directives: [],
                            evaluatedAt: "2026-04-17T04:06:00.000Z",
                        },
                    ],
                    selectedAttempt: 2,
                    stopReason: "legacy retry selected",
                },
                updatedAt: "2026-04-17T04:10:00.000Z",
            },
        });

        seedStructureCandidateEvidence(outputDir, {
            songId: "song-legacy",
            index: {
                version: 1,
                songId: "song-legacy",
                updatedAt: "2026-04-17T04:06:30.000Z",
                selectedCandidateId: "legacy-a2",
                selectedAttempt: 2,
                entries: [
                    {
                        candidateId: "legacy-a1",
                        attempt: 1,
                        stage: "structure",
                        selected: false,
                        workflow: "symbolic_only",
                        worker: "music21",
                        provider: "python",
                        model: "music21-symbolic-v1",
                        passed: false,
                        score: 69,
                        evaluatedAt: "2026-04-17T04:03:00.000Z",
                    },
                    {
                        candidateId: "legacy-a2",
                        attempt: 2,
                        stage: "structure",
                        selected: true,
                        workflow: "symbolic_only",
                        worker: "learned_symbolic",
                        provider: "learned",
                        model: "learned-symbolic-trio-v1",
                        passed: true,
                        score: 84,
                        evaluatedAt: "2026-04-17T04:06:00.000Z",
                        proposalEvidence: {
                            worker: "learned_symbolic",
                            lane: "string_trio_symbolic",
                            provider: "learned",
                            model: "learned-symbolic-trio-v1",
                            generationMode: "targeted_section_rewrite",
                            confidence: 0.58,
                        },
                    },
                ],
            },
            candidates: [
                {
                    candidateId: "legacy-a1",
                    manifest: {
                        version: 1,
                        stage: "structure",
                        songId: "song-legacy",
                        candidateId: "legacy-a1",
                        attempt: 1,
                        selected: false,
                        evaluatedAt: "2026-04-17T04:03:00.000Z",
                        workflow: "symbolic_only",
                        worker: "music21",
                        provider: "python",
                        model: "music21-symbolic-v1",
                        meta: {
                            promptHash: "hash-legacy",
                            plannerVersion: "planner-v1",
                            source: "autonomy",
                            workflow: "symbolic_only",
                        },
                        structureEvaluation: {
                            passed: false,
                            score: 69,
                            issues: ["Cadence blurred."],
                            strengths: [],
                            metrics: {
                                phrasePressureFit: 0.55,
                            },
                        },
                    },
                },
                {
                    candidateId: "legacy-a2",
                    manifest: {
                        version: 1,
                        stage: "structure",
                        songId: "song-legacy",
                        candidateId: "legacy-a2",
                        attempt: 2,
                        selected: true,
                        evaluatedAt: "2026-04-17T04:06:00.000Z",
                        workflow: "symbolic_only",
                        worker: "learned_symbolic",
                        provider: "learned",
                        model: "learned-symbolic-trio-v1",
                        meta: {
                            promptHash: "hash-legacy",
                            plannerVersion: "planner-v1",
                            source: "autonomy",
                            workflow: "symbolic_only",
                        },
                        proposalEvidence: {
                            worker: "learned_symbolic",
                            lane: "string_trio_symbolic",
                            provider: "learned",
                            model: "learned-symbolic-trio-v1",
                            generationMode: "targeted_section_rewrite",
                            confidence: 0.58,
                        },
                        sectionTransforms: [
                            {
                                sectionId: "s2",
                                transformMode: "targeted_rewrite:clarify_phrase_rhetoric",
                                sourceSectionId: "s2",
                            },
                        ],
                        structureEvaluation: {
                            passed: true,
                            score: 84,
                            issues: [],
                            strengths: ["Cadence is clearer."],
                            metrics: {
                                phrasePressureFit: 0.78,
                            },
                        },
                    },
                },
            ],
        });

        execFileSync(
            process.execPath,
            [
                "scripts/export-structure-reranker-dataset.mjs",
                "--root",
                outputDir,
                "--snapshot",
                "legacy-sidecar-snapshot",
            ],
            {
                cwd: repoRoot,
                encoding: "utf8",
            },
        );

        const datasetRoot = path.join(outputDir, "_system", "ml", "datasets", "structure-rank-v1", "legacy-sidecar-snapshot");
        const allExamples = [
            ...readJsonl(path.join(datasetRoot, "train.jsonl")),
            ...readJsonl(path.join(datasetRoot, "val.jsonl")),
            ...readJsonl(path.join(datasetRoot, "test.jsonl")),
        ];

        const selectedCandidate = allExamples.find((entry) => entry.songId === "song-legacy" && entry.attempt === 2);
        assert.deepEqual(selectedCandidate.lineage.priorDirectiveKinds, []);
        assert.deepEqual(selectedCandidate.lineage.inputDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.deepEqual(selectedCandidate.lineage.inputDirectiveSectionIds, ["s2"]);
        assert.equal(selectedCandidate.lineage.retryLocalization, "section_targeted");
        assert.equal(selectedCandidate.lineage.retriedFromAttempt, 1);
        assert.equal(selectedCandidate.reviewSignals.selectedAttempt, 2);
        assert.deepEqual(selectedCandidate.reviewSignals.inputDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.deepEqual(selectedCandidate.reviewSignals.inputDirectiveSectionIds, ["s2"]);
        assert.equal(selectedCandidate.reviewSignals.retryLocalization, "section_targeted");
        assert.equal(selectedCandidate.reviewSignals.selectedGenerationMode, "targeted_section_rewrite");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});