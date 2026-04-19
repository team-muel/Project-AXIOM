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

function writeJsonl(filePath, rows) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content = rows.map((row) => JSON.stringify(row)).join("\n");
    fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf8");
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
        if (candidate.rerankerScore) {
            writeJson(path.join(songDir, candidate.candidateId, "reranker-score.json"), candidate.rerankerScore);
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
                    reviewRubricVersion: "approval_review_rubric_v1",
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
                selectionStopReason: "selected after narrow-lane reranker promotion",
                rerankerPromotion: {
                    appliedAt: "2026-04-17T01:06:00.000Z",
                    lane: "string_trio_symbolic",
                    snapshotId: "shadow-live",
                    confidence: 0.81,
                    heuristicTopCandidateId: "structure-a1-python-music21-symbolic-v1-1",
                    learnedTopCandidateId: "structure-a2-python-music21-symbolic-v1-2",
                    heuristicAttempt: 1,
                    learnedAttempt: 2,
                    reason: "learned favored phraseBreathCueDensity and harmonicColorCueDensity",
                },
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
                        rerankerScorePath: path.join(outputDir, "song-a", "candidates", "structure-a2-python-music21-symbolic-v1-2", "reranker-score.json"),
                        proposalEvidence: {
                            worker: "learned_symbolic",
                            lane: "string_trio_symbolic",
                            provider: "learned",
                            model: "learned-symbolic-trio-v1",
                            benchmarkPackVersion: "string_trio_symbolic_benchmark_pack_v1",
                            benchmarkId: "cadence_clarity_reference",
                            promptPackVersion: "learned_symbolic_prompt_pack_v1",
                            planSignature: "lane=string_trio_symbolic|form=miniature|key=c major|inst=violin,viola,cello|roles=theme_a>cadence|sig=testpack001",
                            generationMode: "targeted_section_rewrite",
                            confidence: 0.61,
                            normalizationWarnings: [
                                "section s2 role collapse: expected lead,counterline,bass got lead,bass",
                                "selected rewrite reused prior cadence material to preserve continuity",
                            ],
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
                        shadowReranker: {
                            snapshotId: "shadow-live",
                            evaluatedAt: "2026-04-17T01:06:00.000Z",
                            heuristicRank: 1,
                            heuristicScore: 0.91,
                            learnedRank: 2,
                            learnedScore: 0.18,
                            learnedConfidence: 0.81,
                            disagreesWithHeuristic: true,
                            disagreementReason: "heuristic preferred higher raw structure score",
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
                            benchmarkPackVersion: "string_trio_symbolic_benchmark_pack_v1",
                            benchmarkId: "cadence_clarity_reference",
                            promptPackVersion: "learned_symbolic_prompt_pack_v1",
                            planSignature: "lane=string_trio_symbolic|form=miniature|key=c major|inst=violin,viola,cello|roles=theme_a>cadence|sig=testpack001",
                            generationMode: "targeted_section_rewrite",
                            confidence: 0.61,
                            normalizationWarnings: [
                                "section s2 role collapse: expected lead,counterline,bass got lead,bass",
                                "selected rewrite reused prior cadence material to preserve continuity",
                            ],
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
                        shadowReranker: {
                            snapshotId: "shadow-live",
                            evaluatedAt: "2026-04-17T01:06:00.000Z",
                            heuristicRank: 2,
                            heuristicScore: 0.74,
                            learnedRank: 1,
                            learnedScore: 0.89,
                            learnedConfidence: 0.81,
                            disagreesWithHeuristic: true,
                            disagreementReason: "learned favored phraseBreathCueDensity and harmonicColorCueDensity",
                        },
                        rerankerPromotion: {
                            appliedAt: "2026-04-17T01:06:00.000Z",
                            lane: "string_trio_symbolic",
                            snapshotId: "shadow-live",
                            confidence: 0.81,
                            heuristicTopCandidateId: "structure-a1-python-music21-symbolic-v1-1",
                            learnedTopCandidateId: "structure-a2-python-music21-symbolic-v1-2",
                            heuristicAttempt: 1,
                            learnedAttempt: 2,
                            reason: "learned favored phraseBreathCueDensity and harmonicColorCueDensity",
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
                    rerankerScore: {
                        version: 1,
                        type: "structure_shadow_reranker",
                        songId: "song-a",
                        candidateId: "structure-a2-python-music21-symbolic-v1-2",
                        evaluatedAt: "2026-04-17T01:06:00.000Z",
                        scorer: {
                            snapshotId: "shadow-live",
                            modelPath: path.join(outputDir, "_system", "ml", "evaluations", "structure-rank-v1", "shadow-live", "shadow-reranker-model.json"),
                            calibratedTemperature: 1,
                            featureCount: 24,
                        },
                        heuristic: {
                            score: 0.74,
                            rank: 2,
                            topCandidateId: "structure-a1-python-music21-symbolic-v1-1",
                            topMargin: 0.17,
                        },
                        learned: {
                            score: 0.89,
                            rank: 1,
                            topCandidateId: "structure-a2-python-music21-symbolic-v1-2",
                            topMargin: 0.11,
                            confidence: 0.81,
                        },
                        disagreement: {
                            disagrees: true,
                            heuristicTopCandidateId: "structure-a1-python-music21-symbolic-v1-1",
                            learnedTopCandidateId: "structure-a2-python-music21-symbolic-v1-2",
                            reason: "learned favored phraseBreathCueDensity and harmonicColorCueDensity",
                            topFeatures: [
                                {
                                    feature: "phraseBreathCueDensity",
                                    contribution: 0.44,
                                    learnedValue: 1.2,
                                    heuristicValue: 0,
                                },
                                {
                                    feature: "harmonicColorCueDensity",
                                    contribution: 0.27,
                                    learnedValue: 1,
                                    heuristicValue: 0,
                                },
                            ],
                        },
                    },
                },
            ],
        });

        writeJson(path.join(outputDir, "_system", "operator-actions", "latest.json"), {
            actor: "operator:test",
            surface: "dashboard",
            action: "approve",
            reason: "reviewed narrow-lane reranker promotion output",
            input: {
                songId: "song-a",
            },
            before: {
                songId: "song-a",
                approvalStatus: "pending",
            },
            after: {
                songId: "song-a",
                approvalStatus: "approved",
            },
            artifactLinks: ["outputs/song-a/manifest.json"],
            approvedBy: "operator:test",
            observedAt: "2026-04-17T01:07:00.000Z",
        });
        writeJsonl(path.join(outputDir, "_system", "operator-actions", "history", "2026-04-17.jsonl"), [
            {
                actor: "operator:test",
                surface: "dashboard",
                action: "approve",
                reason: "reviewed narrow-lane reranker promotion output",
                input: {
                    songId: "song-a",
                },
                before: {
                    songId: "song-a",
                    approvalStatus: "pending",
                },
                after: {
                    songId: "song-a",
                    approvalStatus: "approved",
                },
                artifactLinks: ["outputs/song-a/manifest.json"],
                approvedBy: "operator:test",
                observedAt: "2026-04-17T01:07:00.000Z",
            },
        ]);
        writeJsonl(path.join(outputDir, "_system", "ml", "runtime", "structure-rank-v1-shadow-history", "2026-04-17.jsonl"), [
            {
                kind: "structure_shadow",
                generatedAt: "2026-04-17T01:06:00.000Z",
                songId: "song-a",
                snapshotId: "shadow-live",
                candidateCount: 2,
                selectedCandidateId: "structure-a2-python-music21-symbolic-v1-2",
                heuristicTopCandidateId: "structure-a1-python-music21-symbolic-v1-1",
                learnedTopCandidateId: "structure-a2-python-music21-symbolic-v1-2",
                confidence: 0.81,
                disagreement: true,
                reason: "learned favored phraseBreathCueDensity and harmonicColorCueDensity",
                scorePaths: [path.join(outputDir, "song-a", "candidates", "structure-a2-python-music21-symbolic-v1-2", "reranker-score.json")],
            },
        ]);

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
                    promptHash: "hash-a",
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
        assert.equal(payload.reviewTierCounts.reviewed_approved, 1);
        assert.equal(payload.reviewTierCounts.runtime_selected_unreviewed, 1);
        assert.equal(payload.sourceDateRange.earliestCreatedAt, "2026-04-17T01:03:00.000Z");
        assert.equal(payload.sourceDateRange.latestCreatedAt, "2026-04-17T02:05:00.000Z");
        assert.equal(payload.featureAvailability.derivedFromSyntheticAttempt, 1);
        assert.equal(payload.featureAvailability.hasProposalEvidence, 1);
        assert.equal(payload.featureAvailability.hasLearnedProposalEvidence, 1);
        assert.equal(payload.featureAvailability.hasProposalLane, 1);
        assert.equal(payload.featureAvailability.hasProposalSummary, 1);
        assert.equal(payload.featureAvailability.hasProposalNormalizationWarnings, 1);
        assert.equal(payload.featureAvailability.hasProposalRoleCollapseWarnings, 1);
        assert.equal(payload.featureAvailability.hasReviewFeedback, 1);
        assert.equal(payload.featureAvailability.hasReviewFeedbackNote, 1);
        assert.equal(payload.featureAvailability.hasComparisonReference, 1);
        assert.equal(payload.featureAvailability.hasInputDirectiveContext, 1);
        assert.equal(payload.featureAvailability.hasTargetedRewriteContext, 1);
        assert.equal(payload.additionalDatasets.axiom_backbone_piece_v1.rowCount, 2);
        assert.equal(payload.additionalDatasets.axiom_localized_rewrite_v1.rowCount, 1);
        assert.equal(payload.additionalDatasets.axiom_search_reranker_v1.groupCount, 1);
        assert.equal(payload.additionalDatasets.axiom_search_reranker_v1.pairwiseCount, 1);
        assert.equal(payload.additionalDatasets.axiom_search_reranker_v1.shortlistCount, 1);

        const snapshotSummaryStdout = execFileSync(
            process.execPath,
            [
                "scripts/summarize-truth-plane-dataset-snapshot.mjs",
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
        const snapshotSummary = JSON.parse(snapshotSummaryStdout.trim());
        assert.equal(snapshotSummary.ok, true);
        assert.equal(snapshotSummary.datasets.structure_rank_v1.reviewTierCounts.reviewed_approved, 1);
        assert.equal(snapshotSummary.datasets.axiom_backbone_piece_v1.reviewTierCounts.runtime_selected_unreviewed, 1);
        assert.equal(snapshotSummary.datasets.axiom_search_reranker_v1.reviewTierCounts.groups.reviewed_approved, 1);
        assert.equal(snapshotSummary.datasets.structure_rank_v1.sourceDateRange.earliestCreatedAt, "2026-04-17T01:03:00.000Z");
        assert.equal(snapshotSummary.datasets.axiom_backbone_piece_v1.sourceDateRange.latestCreatedAt, "2026-04-17T02:05:00.000Z");
        assert.equal(snapshotSummary.promotionCounts.appliedGroupCount, 1);
        assert.equal(snapshotSummary.promotionCounts.laneCounts.string_trio_symbolic, 1);
        assert.equal(snapshotSummary.splitLeakageChecks.structure_rank_v1.promptHash.collisionCount, 1);
        assert.equal(snapshotSummary.splitLeakageChecks.structure_rank_v1.promptHash.leakedValues[0].value, "hash-a");
        assert.equal(snapshotSummary.splitLeakageChecks.axiom_backbone_piece_v1.ok, true);
        assert.equal(snapshotSummary.splitLeakageChecks.axiom_backbone_piece_v1.promptHash.collisionCount, 0);
        assert.equal(snapshotSummary.splitLeakageChecks.axiom_search_reranker_v1.ok, true);

        const datasetRoot = path.join(outputDir, "_system", "ml", "datasets", "structure-rank-v1", "test-snapshot");
        assert.equal(fs.existsSync(path.join(datasetRoot, "manifest.json")), true);
        assert.equal(fs.existsSync(path.join(datasetRoot, "train.jsonl")), true);
        assert.equal(fs.existsSync(path.join(datasetRoot, "val.jsonl")), true);
        assert.equal(fs.existsSync(path.join(datasetRoot, "test.jsonl")), true);

        const backboneDatasetRoot = path.join(outputDir, "_system", "ml", "datasets", "axiom_backbone_piece_v1", "test-snapshot");
        assert.equal(fs.existsSync(path.join(backboneDatasetRoot, "manifest.json")), true);
        assert.equal(fs.existsSync(path.join(backboneDatasetRoot, "rows.jsonl")), true);
        assert.equal(fs.existsSync(path.join(backboneDatasetRoot, "splits.json")), true);

        const rewriteDatasetRoot = path.join(outputDir, "_system", "ml", "datasets", "axiom_localized_rewrite_v1", "test-snapshot");
        assert.equal(fs.existsSync(path.join(rewriteDatasetRoot, "manifest.json")), true);
        assert.equal(fs.existsSync(path.join(rewriteDatasetRoot, "rows.jsonl")), true);
        assert.equal(fs.existsSync(path.join(rewriteDatasetRoot, "splits.json")), true);

        const searchDatasetRoot = path.join(outputDir, "_system", "ml", "datasets", "axiom_search_reranker_v1", "test-snapshot");
        assert.equal(fs.existsSync(path.join(searchDatasetRoot, "manifest.json")), true);
        assert.equal(fs.existsSync(path.join(searchDatasetRoot, "groups.jsonl")), true);
        assert.equal(fs.existsSync(path.join(searchDatasetRoot, "pairwise.jsonl")), true);
        assert.equal(fs.existsSync(path.join(searchDatasetRoot, "shortlists.jsonl")), true);
        assert.equal(fs.existsSync(path.join(searchDatasetRoot, "splits.json")), true);

        const allExamples = [
            ...readJsonl(path.join(datasetRoot, "train.jsonl")),
            ...readJsonl(path.join(datasetRoot, "val.jsonl")),
            ...readJsonl(path.join(datasetRoot, "test.jsonl")),
        ];
        const backboneRows = readJsonl(path.join(backboneDatasetRoot, "rows.jsonl"));
        const rewriteRows = readJsonl(path.join(rewriteDatasetRoot, "rows.jsonl"));
        const searchGroupRows = readJsonl(path.join(searchDatasetRoot, "groups.jsonl"));
        const searchPairwiseRows = readJsonl(path.join(searchDatasetRoot, "pairwise.jsonl"));
        const searchShortlistRows = readJsonl(path.join(searchDatasetRoot, "shortlists.jsonl"));
        const searchManifest = JSON.parse(fs.readFileSync(path.join(searchDatasetRoot, "manifest.json"), "utf8"));
        const backboneSplits = JSON.parse(fs.readFileSync(path.join(backboneDatasetRoot, "splits.json"), "utf8"));
        assert.equal(allExamples.length, 3);
        assert.equal(backboneRows.length, 2);
        assert.equal(rewriteRows.length, 1);
        assert.equal(searchGroupRows.length, 1);
        assert.equal(searchPairwiseRows.length, 1);
        assert.equal(searchShortlistRows.length, 1);
        assert.equal(searchManifest.exclusions.no_candidate_groups, 1);

        const rejectedCandidate = allExamples.find((entry) => entry.songId === "song-a" && entry.attempt === 1);
        const selectedCandidate = allExamples.find((entry) => entry.songId === "song-a" && entry.attempt === 2);
        const syntheticCandidate = allExamples.find((entry) => entry.songId === "song-b");
        const selectedPiece = backboneRows.find((entry) => entry.songId === "song-a");
        const syntheticPiece = backboneRows.find((entry) => entry.songId === "song-b");
        const rewriteRow = rewriteRows.find((entry) => entry.songId === "song-a");
        const searchGroupRow = searchGroupRows[0];
        const searchPairwiseRow = searchPairwiseRows[0];
        const searchShortlistRow = searchShortlistRows[0];

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
        assert.equal(selectedCandidate.featureAvailability.hasProposalNormalizationWarnings, true);
        assert.equal(selectedCandidate.featureAvailability.hasProposalRoleCollapseWarnings, true);
        assert.equal(selectedCandidate.featureAvailability.hasReviewFeedback, true);
        assert.equal(selectedCandidate.featureAvailability.hasInputDirectiveContext, true);
        assert.equal(selectedCandidate.featureAvailability.hasTargetedRewriteContext, true);
        assert.equal(selectedCandidate.proposalEvidence.lane, "string_trio_symbolic");
        assert.equal(selectedCandidate.proposalEvidence.benchmarkPackVersion, "string_trio_symbolic_benchmark_pack_v1");
        assert.equal(selectedCandidate.proposalEvidence.benchmarkId, "cadence_clarity_reference");
        assert.equal(selectedCandidate.proposalEvidence.promptPackVersion, "learned_symbolic_prompt_pack_v1");
        assert.equal(selectedCandidate.proposalEvidence.planSignature, "lane=string_trio_symbolic|form=miniature|key=c major|inst=violin,viola,cello|roles=theme_a>cadence|sig=testpack001");
        assert.equal(selectedCandidate.proposalEvidence.generationMode, "targeted_section_rewrite");
        assert.equal(selectedCandidate.proposalEvidence.normalizationWarningCount, 2);
        assert.deepEqual(selectedCandidate.proposalEvidence.normalizationWarnings, [
            "section s2 role collapse: expected lead,counterline,bass got lead,bass",
            "selected rewrite reused prior cadence material to preserve continuity",
        ]);
        assert.equal(selectedCandidate.proposalWarningSignals.normalizationWarningCount, 2);
        assert.equal(selectedCandidate.proposalWarningSignals.roleCollapseWarningCount, 1);
        assert.equal(selectedCandidate.proposalEvidence.summary.partCount, 3);
        assert.deepEqual(selectedCandidate.proposalEvidence.summary.partInstrumentNames, ["Cello", "Viola", "Violin"]);
        assert.deepEqual(selectedCandidate.lineage.priorDirectiveKinds, []);
        assert.deepEqual(selectedCandidate.lineage.inputDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.deepEqual(selectedCandidate.lineage.inputDirectiveSectionIds, ["s2"]);
        assert.equal(selectedCandidate.lineage.retryLocalization, "section_targeted");
        assert.equal(selectedCandidate.lineage.retriedFromAttempt, 1);
        assert.equal(selectedCandidate.reviewSignals.approvalStatus, "approved");
        assert.equal(selectedCandidate.reviewSignals.reviewRubricVersion, "approval_review_rubric_v1");
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

        assert.equal(selectedPiece.reviewTier, "reviewed_approved");
        assert.equal(selectedPiece.selectedCandidateId, "structure-a2-python-music21-symbolic-v1-2");
        assert.equal(selectedPiece.qualityLabels.retryCount, 1);
        assert.equal(selectedPiece.directiveContext.retryLocalization, "section_targeted");
        assert.equal(selectedPiece.proposalEvidence.benchmarkPackVersion, "string_trio_symbolic_benchmark_pack_v1");
        assert.equal(selectedPiece.proposalEvidence.benchmarkId, "cadence_clarity_reference");
        assert.deepEqual(selectedPiece.directiveContext.inputDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.equal(selectedPiece.proposalEvidence.promptPackVersion, "learned_symbolic_prompt_pack_v1");
        assert.equal(selectedPiece.proposalEvidence.planSignature, "lane=string_trio_symbolic|form=miniature|key=c major|inst=violin,viola,cello|roles=theme_a>cadence|sig=testpack001");
        assert.equal(selectedPiece.proposalWarningSignals.normalizationWarningCount, 2);
        assert.equal(selectedPiece.proposalWarningSignals.roleCollapseWarningCount, 1);
        assert.equal(selectedPiece.splitFamilyKey, "promptHash:hash-a");
        assert.equal(selectedPiece.conditioning.compositionPlan.sections.length, 2);
        assert.equal(syntheticPiece.reviewTier, "runtime_selected_unreviewed");
        assert.equal(syntheticPiece.splitFamilyKey, "promptHash:hash-a");
        assert.equal(backboneSplits.splitKey, "splitFamilyKey");
        assert.deepEqual(backboneSplits.train, ["promptHash:hash-a"]);
        assert.deepEqual(backboneSplits.val, []);
        assert.deepEqual(backboneSplits.test, []);

        assert.equal(rewriteRow.reviewTier, "reviewed_approved");
        assert.equal(rewriteRow.candidateId, "structure-a2-python-music21-symbolic-v1-2");
        assert.equal(rewriteRow.rewriteContext.targetSectionId, "s2");
        assert.equal(rewriteRow.rewriteContext.directiveKind, "clarify_phrase_rhetoric");
        assert.equal(rewriteRow.rewriteContext.retryLocalization, "section_targeted");
        assert.deepEqual(rewriteRow.rewriteContext.inputDirectiveSectionIds, ["s2"]);
        assert.equal(rewriteRow.targetSection.role, "cadence");
        assert.equal(rewriteRow.labels.selectedAfterRetry, true);
        assert.equal(rewriteRow.proposalEvidence.planSignature, "lane=string_trio_symbolic|form=miniature|key=c major|inst=violin,viola,cello|roles=theme_a>cadence|sig=testpack001");
        assert.equal(rewriteRow.proposalWarningSignals.normalizationWarningCount, 2);
        assert.equal(rewriteRow.proposalWarningSignals.roleCollapseWarningCount, 1);

        assert.equal(searchGroupRow.reviewTier, "reviewed_approved");
        assert.equal(searchGroupRow.selectedCandidateId, "structure-a2-python-music21-symbolic-v1-2");
        assert.equal(searchGroupRow.heuristicTopCandidateId, "structure-a1-python-music21-symbolic-v1-1");
        assert.equal(searchGroupRow.learnedTopCandidateId, "structure-a2-python-music21-symbolic-v1-2");
        assert.equal(searchGroupRow.reviewedWinnerCandidateId, "structure-a2-python-music21-symbolic-v1-2");
        assert.equal(searchGroupRow.promotion.applied, true);
        assert.equal(searchGroupRow.promotion.snapshotId, "shadow-live");
        assert.equal(searchGroupRow.reviewAudit.latestAction, "approve");
        assert.equal(searchGroupRow.reviewAudit.historyCount, 1);
        assert.equal(searchGroupRow.runtimeShadow.entryCount, 1);
        assert.equal(searchGroupRow.runtimeShadow.disagreementCount, 1);
        assert.equal(searchGroupRow.candidates.length, 2);
        const learnedSearchCandidate = searchGroupRow.candidates.find((entry) => entry.candidateId === "structure-a2-python-music21-symbolic-v1-2");
        assert.equal(learnedSearchCandidate.proposalWarningSignals.normalizationWarningCount, 2);
        assert.equal(learnedSearchCandidate.proposalWarningSignals.roleCollapseWarningCount, 1);

        assert.equal(searchPairwiseRow.winnerCandidateId, "structure-a2-python-music21-symbolic-v1-2");
        assert.equal(searchPairwiseRow.loserCandidateId, "structure-a1-python-music21-symbolic-v1-1");
        assert.equal(searchPairwiseRow.labelSource, "reviewed_approved_selection");
        assert.equal(searchPairwiseRow.trainingWeight > 1, true);
        assert.equal(searchPairwiseRow.deltas.structureScoreDelta, 15);
        assert.equal(searchPairwiseRow.deltas.proposalConfidenceDelta, 0.61);
        assert.equal(searchPairwiseRow.deltas.proposalWarningCountDelta, 2);
        assert.equal(searchPairwiseRow.deltas.roleCollapseWarningCountDelta, 1);

        assert.equal(searchShortlistRow.topK, 2);
        assert.deepEqual(searchShortlistRow.orderedCandidateIds, [
            "structure-a2-python-music21-symbolic-v1-2",
            "structure-a1-python-music21-symbolic-v1-1",
        ]);
        assert.equal(searchShortlistRow.reviewedWinnerCandidateId, "structure-a2-python-music21-symbolic-v1-2");
        assert.equal(searchShortlistRow.promotionApplied, true);
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
                    reviewRubricVersion: "approval_review_rubric_v1",
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
                    benchmarkPackVersion: "string_trio_symbolic_benchmark_pack_v1",
                    benchmarkId: "cadence_clarity_reference",
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
                    reviewRubricVersion: "approval_review_rubric_v1",
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