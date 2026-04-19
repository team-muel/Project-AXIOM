import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine, runNodeEval } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pythonBin = [
    path.join(repoRoot, ".venv", "Scripts", "python.exe"),
    path.join(repoRoot, ".venv", "bin", "python"),
].find((candidate) => fs.existsSync(candidate));
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

test("structure candidate sidecars persist snapshots and selected pointer", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-candidate-sidecars-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import {
                buildStructureCandidateId,
                markSelectedStructureCandidate,
                saveStructureCandidateSnapshot,
                structureCandidateIndexPath,
                structureCandidateManifestPath,
                structureCandidateSectionArtifactsPath,
                structureCandidateMidiPath,
            } from "./dist/memory/candidates.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};

            const executionPlan = {
                workflow: "symbolic_only",
                composeWorker: "music21",
                selectedModels: [
                    { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                ],
            };

            const candidateOne = buildStructureCandidateId(1, executionPlan);
            const candidateTwo = buildStructureCandidateId(2, executionPlan);

            saveStructureCandidateSnapshot({
                songId: "song-sidecar",
                candidateId: candidateOne,
                attempt: 1,
                meta: {
                    songId: "song-sidecar",
                    prompt: "candidate evidence regression",
                    promptHash: "hash-sidecar",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                },
                executionPlan,
                compositionPlan: {
                    form: "miniature",
                    sections: [
                        { sectionId: "s1", role: "theme_a", phraseFunction: "presentation" },
                    ],
                },
                revisionDirectives: [
                    { kind: "clarify_phrase_rhetoric", priority: 0.7, reason: "weak cadence" },
                ],
                structureEvaluation: {
                    passed: false,
                    score: 71,
                    issues: ["cadence weak"],
                    strengths: [],
                    metrics: { phrasePressureFit: 0.61 },
                },
                sectionArtifacts: [
                    { sectionId: "s1", role: "theme_a", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [60, 62] },
                ],
                midiData: Buffer.from([77, 84, 104, 100]),
                evaluatedAt: "2026-04-17T03:00:00.000Z",
            });

            saveStructureCandidateSnapshot({
                songId: "song-sidecar",
                candidateId: candidateTwo,
                attempt: 2,
                meta: {
                    songId: "song-sidecar",
                    prompt: "candidate evidence regression",
                    promptHash: "hash-sidecar",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                },
                executionPlan,
                compositionPlan: {
                    form: "miniature",
                    sections: [
                        { sectionId: "s1", role: "theme_a", phraseFunction: "presentation" },
                        { sectionId: "s2", role: "cadence", phraseFunction: "cadential" },
                    ],
                },
                revisionDirectives: [],
                structureEvaluation: {
                    passed: true,
                    score: 86,
                    issues: [],
                    strengths: ["cadence clear"],
                    metrics: { phrasePressureFit: 0.82 },
                    weakestSections: [
                        { sectionId: "s2", role: "cadence", score: 74, issues: ["late arrival"], metrics: { cadenceApproachFit: 0.66 } },
                    ],
                },
                sectionArtifacts: [
                    { sectionId: "s1", role: "theme_a", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [60, 62] },
                    { sectionId: "s2", role: "cadence", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [67, 65] },
                ],
                midiData: Buffer.from([77, 84, 104, 100, 0, 0]),
                evaluatedAt: "2026-04-17T03:05:00.000Z",
            });

            markSelectedStructureCandidate("song-sidecar", candidateTwo, 2, "selected for downstream stages");

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("song-sidecar"), "utf8"));
            const selectedManifest = JSON.parse(fs.readFileSync(structureCandidateManifestPath("song-sidecar", candidateTwo), "utf8"));
            const rejectedManifest = JSON.parse(fs.readFileSync(structureCandidateManifestPath("song-sidecar", candidateOne), "utf8"));

            console.log(JSON.stringify({
                index,
                selectedManifest,
                rejectedManifest,
                selectedMidiExists: fs.existsSync(structureCandidateMidiPath("song-sidecar", candidateTwo)),
                selectedSectionArtifactsExists: fs.existsSync(structureCandidateSectionArtifactsPath("song-sidecar", candidateTwo)),
            }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.index.selectedAttempt, 2);
        assert.equal(payload.index.selectedCandidateId, payload.selectedManifest.candidateId);
        assert.equal(payload.index.entries.length, 2);
        assert.equal(payload.index.entries.find((entry) => entry.selected).attempt, 2);
        assert.equal(payload.selectedManifest.selected, true);
        assert.equal(payload.rejectedManifest.selected, false);
        assert.equal(payload.selectedMidiExists, true);
        assert.equal(payload.selectedSectionArtifactsExists, true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("structure candidate sidecars persist reranker promotion metadata on the selected candidate", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-candidate-sidecars-promotion-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import {
                buildStructureCandidateId,
                markSelectedStructureCandidate,
                saveStructureCandidateSnapshot,
                structureCandidateIndexPath,
                structureCandidateManifestPath,
            } from "./dist/memory/candidates.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};

            const executionPlan = {
                workflow: "symbolic_only",
                composeWorker: "music21",
                selectedModels: [
                    { role: "structure", provider: "python", model: "music21-symbolic-v1" },
                ],
            };

            const learnedCandidate = buildStructureCandidateId(1, executionPlan);
            const heuristicCandidate = buildStructureCandidateId(2, executionPlan);

            for (const [candidateId, attempt, score] of [
                [learnedCandidate, 1, 82],
                [heuristicCandidate, 2, 87],
            ]) {
                saveStructureCandidateSnapshot({
                    songId: "song-sidecar-promotion",
                    candidateId,
                    attempt,
                    meta: {
                        songId: "song-sidecar-promotion",
                        prompt: "candidate promotion regression",
                        promptHash: "hash-sidecar-promotion",
                        workflow: "symbolic_only",
                        plannerVersion: "planner-v1",
                    },
                    executionPlan,
                    compositionPlan: {
                        form: "string trio miniature",
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
                        score,
                        issues: [],
                        strengths: [],
                        metrics: {},
                    },
                    evaluatedAt: "2026-04-17T03:10:00.000Z",
                });
            }

            markSelectedStructureCandidate(
                "song-sidecar-promotion",
                learnedCandidate,
                1,
                "selected after narrow-lane reranker promotion",
                {
                    appliedAt: "2026-04-17T03:11:00.000Z",
                    lane: "string_trio_symbolic",
                    snapshotId: "shadow-live",
                    confidence: 0.81,
                    heuristicTopCandidateId: heuristicCandidate,
                    learnedTopCandidateId: learnedCandidate,
                    heuristicAttempt: 2,
                    learnedAttempt: 1,
                    reason: "learned favored sectionArtifactCoverage, phraseBreathCueDensity",
                },
            );

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("song-sidecar-promotion"), "utf8"));
            const selectedManifest = JSON.parse(fs.readFileSync(structureCandidateManifestPath("song-sidecar-promotion", learnedCandidate), "utf8"));
            const heuristicManifest = JSON.parse(fs.readFileSync(structureCandidateManifestPath("song-sidecar-promotion", heuristicCandidate), "utf8"));

            console.log(JSON.stringify({ index, selectedManifest, heuristicManifest }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.index.rerankerPromotion.lane, "string_trio_symbolic");
        assert.equal(payload.index.rerankerPromotion.heuristicTopCandidateId, payload.heuristicManifest.candidateId);
        assert.equal(payload.selectedManifest.rerankerPromotion.learnedTopCandidateId, payload.selectedManifest.candidateId);
        assert.equal(payload.selectedManifest.rerankerPromotion.confidence, 0.81);
        assert.equal(payload.heuristicManifest.rerankerPromotion, undefined);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("structure candidate sidecars persist learned proposal evidence for candidate export", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-candidate-sidecars-proposal-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import {
                buildStructureCandidateId,
                saveStructureCandidateSnapshot,
                structureCandidateIndexPath,
                structureCandidateManifestPath,
            } from "./dist/memory/candidates.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};

            const executionPlan = {
                workflow: "symbolic_only",
                composeWorker: "learned_symbolic",
                selectedModels: [
                    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
                ],
            };

            const candidateId = buildStructureCandidateId(1, executionPlan);
            saveStructureCandidateSnapshot({
                songId: "song-sidecar-proposal",
                candidateId,
                attempt: 1,
                meta: {
                    songId: "song-sidecar-proposal",
                    prompt: "learned proposal evidence regression",
                    promptHash: "hash-sidecar-proposal",
                    workflow: "symbolic_only",
                    plannerVersion: "planner-v1",
                },
                executionPlan,
                compositionPlan: {
                    form: "miniature",
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
                    strengths: ["proposal survived normalization"],
                    metrics: { phrasePressureFit: 0.8 },
                },
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion: "string_trio_symbolic_benchmark_pack_v1",
                    benchmarkId: "cadence_clarity_reference",
                    generationMode: "plan_conditioned_trio_template",
                    confidence: 0.61,
                    normalizationWarnings: [],
                    summary: {
                        measureCount: 8,
                        noteCount: 24,
                        partCount: 3,
                        partInstrumentNames: ["Violin", "Viola", "Cello"],
                        key: "D minor",
                        tempo: 88,
                        form: "miniature",
                    },
                },
                evaluatedAt: "2026-04-17T04:15:00.000Z",
            });

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("song-sidecar-proposal"), "utf8"));
            const manifest = JSON.parse(fs.readFileSync(structureCandidateManifestPath("song-sidecar-proposal", candidateId), "utf8"));
            console.log(JSON.stringify({ index, manifest }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.index.entries[0].proposalEvidence.worker, "learned_symbolic");
        assert.equal(payload.index.entries[0].proposalEvidence.lane, "string_trio_symbolic");
        assert.equal(payload.index.entries[0].proposalEvidence.benchmarkPackVersion, "string_trio_symbolic_benchmark_pack_v1");
        assert.equal(payload.index.entries[0].proposalEvidence.benchmarkId, "cadence_clarity_reference");
        assert.equal(payload.manifest.proposalEvidence.generationMode, "plan_conditioned_trio_template");
        assert.equal(payload.manifest.proposalEvidence.benchmarkPackVersion, "string_trio_symbolic_benchmark_pack_v1");
        assert.equal(payload.manifest.proposalEvidence.benchmarkId, "cadence_clarity_reference");
        assert.equal(payload.manifest.proposalEvidence.summary.partCount, 3);
        assert.equal(payload.manifest.proposalEvidence.summary.key, "D minor");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("structure candidate sidecars persist learned targeted rewrite evidence and transforms", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-candidate-sidecars-learned-rewrite-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import {
                buildStructureCandidateId,
                saveStructureCandidateSnapshot,
                structureCandidateIndexPath,
                structureCandidateManifestPath,
            } from "./dist/memory/candidates.js";
            import { compose } from "./dist/composer/index.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.pythonBin = ${JSON.stringify(pythonBin)};

            const baseRequest = {
                prompt: "Compose a compact string trio miniature and intensify only the middle section on retry.",
                key: "D minor",
                tempo: 88,
                form: "miniature",
                workflow: "symbolic_only",
                selectedModels: [
                    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
                ],
                compositionPlan: {
                    version: "plan-v1",
                    brief: "string trio miniature",
                    mood: ["focused", "restless"],
                    form: "miniature",
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
                    motifPolicy: {
                        reuseRequired: true,
                        inversionAllowed: false,
                        augmentationAllowed: false,
                        diminutionAllowed: false,
                        sequenceAllowed: false,
                    },
                    sections: [
                        {
                            id: "s1",
                            role: "theme_a",
                            label: "Opening",
                            measures: 4,
                            energy: 0.32,
                            density: 0.28,
                            phraseFunction: "presentation",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "half",
                                allowModulation: false,
                            },
                        },
                        {
                            id: "s2",
                            role: "development",
                            label: "Middle",
                            measures: 4,
                            energy: 0.52,
                            density: 0.42,
                            phraseFunction: "continuation",
                            harmonicPlan: {
                                tonalCenter: "A minor",
                                harmonicRhythm: "fast",
                                cadence: "half",
                                allowModulation: true,
                            },
                        },
                        {
                            id: "s3",
                            role: "closing",
                            label: "Cadence",
                            measures: 4,
                            energy: 0.38,
                            density: 0.3,
                            phraseFunction: "cadential",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "authentic",
                                allowModulation: false,
                            },
                        },
                    ],
                    rationale: ["candidate rewrite sidecar regression"],
                },
            };

            const baseline = await compose({
                songId: "learned-rewrite-sidecar-base",
                ...baseRequest,
            });
            const revised = await compose({
                songId: "learned-rewrite-sidecar-attempt-2",
                ...baseRequest,
                attemptIndex: 2,
                sectionArtifacts: baseline.sectionArtifacts,
                revisionDirectives: [
                    {
                        kind: "clarify_narrative_arc",
                        priority: 90,
                        reason: "Only intensify the middle continuation.",
                        sectionIds: ["s2"],
                    },
                ],
            });

            const executionPlan = revised.executionPlan;
            const candidateId = buildStructureCandidateId(2, executionPlan);
            saveStructureCandidateSnapshot({
                songId: "learned-rewrite-sidecar",
                candidateId,
                attempt: 2,
                meta: {
                    songId: "learned-rewrite-sidecar",
                    prompt: baseRequest.prompt,
                    promptHash: "hash-learned-rewrite-sidecar",
                    workflow: "symbolic_only",
                    plannerVersion: "plan-v1",
                },
                executionPlan,
                compositionPlan: baseRequest.compositionPlan,
                revisionDirectives: [
                    {
                        kind: "clarify_narrative_arc",
                        priority: 90,
                        reason: "Only intensify the middle continuation.",
                        sectionIds: ["s2"],
                    },
                ],
                structureEvaluation: {
                    passed: false,
                    score: 76,
                    issues: ["middle continuation still wants another pass"],
                    strengths: ["untouched sections remained stable"],
                    metrics: { phrasePressureFit: 0.71 },
                },
                proposalEvidence: revised.proposalEvidence,
                sectionArtifacts: revised.sectionArtifacts,
                sectionTonalities: revised.sectionTonalities,
                sectionTransforms: revised.sectionTransforms,
                midiData: revised.midiData,
                evaluatedAt: "2026-04-17T05:10:00.000Z",
            });

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("learned-rewrite-sidecar"), "utf8"));
            const manifest = JSON.parse(fs.readFileSync(structureCandidateManifestPath("learned-rewrite-sidecar", candidateId), "utf8"));
            const sectionArtifacts = JSON.parse(fs.readFileSync(manifest.artifacts.sectionArtifacts, "utf8"));
            console.log(JSON.stringify({ index, manifest, sectionArtifacts }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.index.entries.length, 1);
        assert.equal(payload.index.entries[0].proposalEvidence.generationMode, "targeted_section_rewrite");
        assert.equal(payload.manifest.proposalEvidence.generationMode, "targeted_section_rewrite");
        assert.equal(payload.manifest.sectionTransforms.length, 1);
        assert.equal(payload.manifest.sectionTransforms[0].sectionId, "s2");
        assert.match(payload.manifest.sectionTransforms[0].transformMode, /targeted_rewrite:clarify_narrative_arc/);
        assert.ok(payload.manifest.artifacts.sectionArtifacts);
        assert.equal(payload.sectionArtifacts.find((entry) => entry.sectionId === "s2")?.transform?.sectionId, "s2");
        assert.match(payload.sectionArtifacts.find((entry) => entry.sectionId === "s2")?.transform?.transformMode ?? "", /targeted_rewrite:clarify_narrative_arc/);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }
        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("runPipeline persists same-attempt hybrid symbolic candidates and records the hybrid stop reason", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-hybrid-sidecars-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import {
                structureCandidateIndexPath,
                structureCandidateManifestPath,
            } from "./dist/memory/candidates.js";
            import { runPipeline } from "./dist/pipeline/orchestrator.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.pythonBin = ${JSON.stringify(pythonBin)};

            const manifest = await runPipeline({
                songId: "hybrid-runtime-sidecars",
                prompt: "Compose a compact string trio miniature with a clear cadence and motivic continuity.",
                key: "D minor",
                tempo: 88,
                form: "miniature",
                workflow: "symbolic_only",
                candidateCount: 4,
                selectedModels: [
                    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
                ],
                evaluationPolicy: {
                    requireStructurePass: false,
                    requireAudioPass: false,
                },
                qualityPolicy: {
                    enableAutoRevision: false,
                    maxStructureAttempts: 1,
                    targetStructureScore: 100,
                },
                compositionPlan: {
                    version: "plan-v1",
                    brief: "string trio miniature",
                    form: "miniature",
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
                    motifPolicy: {
                        reuseRequired: true,
                        inversionAllowed: false,
                        augmentationAllowed: false,
                        diminutionAllowed: false,
                        sequenceAllowed: false,
                    },
                    sections: [
                        {
                            id: "s1",
                            role: "theme_a",
                            label: "Opening",
                            measures: 4,
                            energy: 0.34,
                            density: 0.3,
                            phraseFunction: "presentation",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "half",
                                allowModulation: false,
                            },
                        },
                        {
                            id: "s2",
                            role: "closing",
                            label: "Cadence",
                            measures: 4,
                            energy: 0.42,
                            density: 0.32,
                            phraseFunction: "cadential",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "authentic",
                                allowModulation: false,
                            },
                        },
                    ],
                    rationale: ["hybrid runtime regression"],
                },
            });

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("hybrid-runtime-sidecars"), "utf8"));
            const manifests = index.entries.map((entry) => JSON.parse(
                fs.readFileSync(structureCandidateManifestPath("hybrid-runtime-sidecars", entry.candidateId), "utf8"),
            ));

            console.log(JSON.stringify({ manifest, index, manifests }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.manifest.state, "FAILED");
        assert.equal(payload.manifest.errorCode, "STRUCTURE_TARGET_NOT_MET");
        assert.equal(payload.manifest.qualityControl.selectedAttempt, 1);
        assert.match(payload.manifest.qualityControl.stopReason ?? "", /hybrid candidate pool/);
        assert.equal(payload.index.selectedAttempt, 1);
        assert.equal(payload.index.entries.length, 4);
        assert.match(payload.index.selectionStopReason ?? "", /string_trio_symbolic lane/);
        assert.match(payload.index.selectionStopReason ?? "", /heuristic structure score/);
        assert.deepEqual(
            payload.index.entries.map((entry) => entry.attempt),
            [1, 1, 1, 1],
        );
        assert.equal(new Set(payload.index.entries.map((entry) => entry.candidateId)).size, 4);
        assert.equal(payload.index.entries.filter((entry) => entry.worker === "music21").length, 2);
        assert.equal(payload.index.entries.filter((entry) => entry.worker === "learned_symbolic").length, 2);
        assert.ok(payload.index.entries.some((entry) => /baseline-2/.test(entry.candidateId)));
        assert.ok(payload.index.entries.some((entry) => /learned-2/.test(entry.candidateId)));

        const learnedEntry = payload.index.entries.find((entry) => entry.worker === "learned_symbolic");
        const baselineEntry = payload.index.entries.find((entry) => entry.worker === "music21");
        assert.equal(learnedEntry?.proposalEvidence?.lane, "string_trio_symbolic");
        assert.equal(learnedEntry?.proposalEvidence?.worker, "learned_symbolic");
        assert.equal(baselineEntry?.proposalEvidence, undefined);

        const selectedManifest = payload.manifests.find((entry) => entry.candidateId === payload.index.selectedCandidateId);
        assert.equal(selectedManifest?.selected, true);
        assert.equal(selectedManifest?.attempt, 1);
        assert.equal(payload.manifests.length, 4);
        assert.equal(payload.manifests.filter((entry) => entry.worker === "music21").length, 2);
        assert.equal(payload.manifests.filter((entry) => entry.worker === "learned_symbolic").length, 2);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }
        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("runPipeline persists same-attempt localized rewrite branch candidates for Stage B S4 search budgets", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-localized-rewrite-sidecars-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import {
                structureCandidateIndexPath,
                structureCandidateManifestPath,
            } from "./dist/memory/candidates.js";
            import { runPipeline } from "./dist/pipeline/orchestrator.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.pythonBin = ${JSON.stringify(pythonBin)};

            const manifest = await runPipeline({
                songId: "localized-rewrite-runtime-sidecars",
                prompt: "Compose a compact string trio miniature with a weak middle section that still resolves clearly.",
                key: "D minor",
                tempo: 88,
                form: "miniature",
                workflow: "symbolic_only",
                candidateCount: 4,
                localizedRewriteBranches: 2,
                selectedModels: [
                    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
                ],
                evaluationPolicy: {
                    requireStructurePass: false,
                    requireAudioPass: false,
                },
                qualityPolicy: {
                    enableAutoRevision: false,
                    maxStructureAttempts: 1,
                    targetStructureScore: 100,
                },
                compositionPlan: {
                    version: "plan-v1",
                    brief: "string trio miniature",
                    form: "miniature",
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
                    motifPolicy: {
                        reuseRequired: true,
                        inversionAllowed: false,
                        augmentationAllowed: false,
                        diminutionAllowed: false,
                        sequenceAllowed: false,
                    },
                    sections: [
                        {
                            id: "s1",
                            role: "theme_a",
                            label: "Opening",
                            measures: 4,
                            energy: 0.34,
                            density: 0.3,
                            phraseFunction: "presentation",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "half",
                                allowModulation: false,
                            },
                        },
                        {
                            id: "s2",
                            role: "development",
                            label: "Middle",
                            measures: 4,
                            energy: 0.46,
                            density: 0.36,
                            phraseFunction: "continuation",
                            harmonicPlan: {
                                tonalCenter: "A minor",
                                harmonicRhythm: "medium",
                                cadence: "deceptive",
                                allowModulation: true,
                            },
                        },
                        {
                            id: "s3",
                            role: "closing",
                            label: "Cadence",
                            measures: 4,
                            energy: 0.42,
                            density: 0.32,
                            phraseFunction: "cadential",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "authentic",
                                allowModulation: false,
                            },
                        },
                    ],
                    rationale: ["localized rewrite runtime regression"],
                },
            });

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("localized-rewrite-runtime-sidecars"), "utf8"));
            const manifests = index.entries.map((entry) => JSON.parse(
                fs.readFileSync(structureCandidateManifestPath("localized-rewrite-runtime-sidecars", entry.candidateId), "utf8"),
            ));

            console.log(JSON.stringify({ manifest, index, manifests }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.manifest.qualityControl.selectedAttempt, 1);
        assert.equal(payload.index.selectedAttempt, 1);
        assert.ok(payload.index.entries.length >= 5);
        assert.deepEqual(
            payload.index.entries.map((entry) => entry.attempt),
            payload.index.entries.map(() => 1),
        );
        assert.ok(payload.index.entries.some((entry) => /rewrite/.test(entry.candidateId)));

        const branchManifests = payload.manifests.filter((entry) => Array.isArray(entry.revisionDirectives) && entry.revisionDirectives.length > 0);
        assert.ok(branchManifests.length >= 1);
        assert.ok(branchManifests.every((entry) => entry.attempt === 1));
        assert.ok(branchManifests.some((entry) => /rewrite/.test(entry.candidateId)));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }
        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("runPipeline persists same-attempt localized rewrite branch candidates for a custom three-candidate search budget", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-localized-rewrite-sidecars-custom-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import {
                structureCandidateIndexPath,
                structureCandidateManifestPath,
            } from "./dist/memory/candidates.js";
            import { runPipeline } from "./dist/pipeline/orchestrator.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.pythonBin = ${JSON.stringify(pythonBin)};

            const manifest = await runPipeline({
                songId: "localized-rewrite-runtime-sidecars-custom",
                prompt: "Compose a compact string trio miniature with a repairable middle section and a controlled closing cadence.",
                key: "D minor",
                tempo: 88,
                form: "miniature",
                workflow: "symbolic_only",
                candidateCount: 3,
                localizedRewriteBranches: 1,
                selectedModels: [
                    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
                ],
                evaluationPolicy: {
                    requireStructurePass: false,
                    requireAudioPass: false,
                },
                qualityPolicy: {
                    enableAutoRevision: false,
                    maxStructureAttempts: 1,
                    targetStructureScore: 100,
                },
                compositionPlan: {
                    version: "plan-v1",
                    brief: "string trio miniature",
                    form: "miniature",
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
                    motifPolicy: {
                        reuseRequired: true,
                        inversionAllowed: false,
                        augmentationAllowed: false,
                        diminutionAllowed: false,
                        sequenceAllowed: false,
                    },
                    sections: [
                        {
                            id: "s1",
                            role: "theme_a",
                            label: "Opening",
                            measures: 4,
                            energy: 0.34,
                            density: 0.3,
                            phraseFunction: "presentation",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "half",
                                allowModulation: false,
                            },
                        },
                        {
                            id: "s2",
                            role: "development",
                            label: "Middle",
                            measures: 4,
                            energy: 0.46,
                            density: 0.36,
                            phraseFunction: "continuation",
                            harmonicPlan: {
                                tonalCenter: "A minor",
                                harmonicRhythm: "medium",
                                cadence: "deceptive",
                                allowModulation: true,
                            },
                        },
                        {
                            id: "s3",
                            role: "closing",
                            label: "Cadence",
                            measures: 4,
                            energy: 0.42,
                            density: 0.32,
                            phraseFunction: "cadential",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "authentic",
                                allowModulation: false,
                            },
                        },
                    ],
                    rationale: ["localized rewrite custom search regression"],
                },
            });

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("localized-rewrite-runtime-sidecars-custom"), "utf8"));
            const manifests = index.entries.map((entry) => JSON.parse(
                fs.readFileSync(structureCandidateManifestPath("localized-rewrite-runtime-sidecars-custom", entry.candidateId), "utf8"),
            ));

            console.log(JSON.stringify({ manifest, index, manifests }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.manifest.qualityControl.selectedAttempt, 1);
        assert.equal(payload.index.selectedAttempt, 1);
        assert.ok(payload.index.entries.length >= 4);
        assert.deepEqual(
            payload.index.entries.map((entry) => entry.attempt),
            payload.index.entries.map(() => 1),
        );
        const wholePieceEntries = payload.index.entries.filter((entry) => !/rewrite/.test(entry.candidateId));
        assert.equal(wholePieceEntries.length, 3);
        assert.equal(new Set(payload.index.entries.map((entry) => entry.candidateId)).size, payload.index.entries.length);
        assert.ok(wholePieceEntries.some((entry) => /baseline-2/.test(entry.candidateId)));
        assert.equal(wholePieceEntries.filter((entry) => entry.worker === "music21").length, 2);
        assert.equal(wholePieceEntries.filter((entry) => entry.worker === "learned_symbolic").length, 1);
        assert.ok(payload.index.entries.some((entry) => /rewrite/.test(entry.candidateId)));

        const branchManifests = payload.manifests.filter((entry) => Array.isArray(entry.revisionDirectives) && entry.revisionDirectives.length > 0);
        assert.equal(branchManifests.length, 1);
        assert.ok(branchManifests.every((entry) => entry.attempt === 1));
        assert.ok(branchManifests.some((entry) => /rewrite/.test(entry.candidateId)));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("runPipeline persists proposal-driven reranker promotion on the selected learned candidate snapshot", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-hybrid-promotion-sidecars-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import {
                structureCandidateIndexPath,
                structureCandidateManifestPath,
            } from "./dist/memory/candidates.js";
            import { runPipeline } from "./dist/pipeline/orchestrator.js";
            import { config } from "./dist/config.js";

            ${readyPromotionGateSeedScript}

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.pythonBin = ${JSON.stringify(pythonBin)};
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

            let sabotagedRender = false;
            const originalPythonBin = config.pythonBin;
            const manifest = await runPipeline({
                songId: "hybrid-runtime-promotion",
                prompt: "Compose a compact string trio miniature with a clear cadence and motivic continuity.",
                key: "D minor",
                tempo: 88,
                form: "miniature",
                workflow: "symbolic_only",
                selectedModels: [
                    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
                ],
                evaluationPolicy: {
                    requireStructurePass: false,
                    requireAudioPass: false,
                },
                qualityPolicy: {
                    enableAutoRevision: false,
                    maxStructureAttempts: 1,
                    targetStructureScore: 70,
                },
                compositionPlan: {
                    version: "plan-v1",
                    brief: "string trio miniature",
                    form: "miniature",
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
                    motifPolicy: {
                        reuseRequired: true,
                        inversionAllowed: false,
                        augmentationAllowed: false,
                        diminutionAllowed: false,
                        sequenceAllowed: false,
                    },
                    sections: [
                        {
                            id: "s1",
                            role: "theme_a",
                            label: "Opening",
                            measures: 4,
                            energy: 0.34,
                            density: 0.3,
                            phraseFunction: "presentation",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "half",
                                allowModulation: false,
                            },
                        },
                        {
                            id: "s2",
                            role: "closing",
                            label: "Cadence",
                            measures: 4,
                            energy: 0.42,
                            density: 0.32,
                            phraseFunction: "cadential",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "authentic",
                                allowModulation: false,
                            },
                        },
                    ],
                    rationale: ["hybrid runtime promotion regression"],
                },
            }, {
                onManifestUpdate(current) {
                    if (!sabotagedRender && current.runtime?.stage === "RENDER") {
                        sabotagedRender = true;
                        config.pythonBin = path.join(config.outputDir, "missing-render-python.exe");
                    }
                },
            });
            config.pythonBin = originalPythonBin;

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("hybrid-runtime-promotion"), "utf8"));
            const manifests = index.entries.map((entry) => JSON.parse(
                fs.readFileSync(structureCandidateManifestPath("hybrid-runtime-promotion", entry.candidateId), "utf8"),
            ));

            console.log(JSON.stringify({ manifest, index, manifests }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.manifest.state, "FAILED");
        assert.equal(payload.manifest.errorCode, "PIPELINE_ERROR");
        assert.equal(payload.manifest.qualityControl.selectedAttempt, 1);
        assert.match(payload.manifest.qualityControl.stopReason ?? "", /hybrid candidate pool kept music21 over learned_symbolic/);
        assert.match(payload.manifest.qualityControl.stopReason ?? "", /learned reranker promoted attempt 1 over heuristic attempt 1 in string_trio_symbolic lane/);

        assert.equal(payload.index.selectedAttempt, 1);
        assert.equal(payload.index.entries.length, 2);
        assert.match(payload.index.selectionStopReason ?? "", /hybrid candidate pool kept music21 over learned_symbolic/);
        assert.match(payload.index.selectionStopReason ?? "", /learned reranker promoted attempt 1 over heuristic attempt 1 in string_trio_symbolic lane/);
        assert.equal(payload.index.rerankerPromotion?.lane, "string_trio_symbolic");

        const selectedManifest = payload.manifests.find((entry) => entry.candidateId === payload.index.selectedCandidateId);
        const heuristicManifest = payload.manifests.find((entry) => entry.candidateId === payload.index.rerankerPromotion?.heuristicTopCandidateId);
        assert.equal(selectedManifest?.worker, "learned_symbolic");
        assert.equal(selectedManifest?.selected, true);
        assert.equal(selectedManifest?.attempt, 1);
        assert.equal(selectedManifest?.proposalEvidence?.worker, "learned_symbolic");
        assert.equal(selectedManifest?.rerankerPromotion?.learnedTopCandidateId, payload.index.selectedCandidateId);
        assert.equal(heuristicManifest?.worker, "music21");
        assert.equal(heuristicManifest?.selected, false);
        assert.equal(heuristicManifest?.rerankerPromotion, undefined);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }
        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("runPipeline preserves attempt-2 targeted rewrite truth-plane through the real retry path after downstream failure", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-retry-truth-plane-"));

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import {
                structureCandidateIndexPath,
                structureCandidateManifestPath,
            } from "./dist/memory/candidates.js";
            import { runPipeline } from "./dist/pipeline/orchestrator.js";
            import { config } from "./dist/config.js";

            config.outputDir = ${JSON.stringify(tempRoot)};
            config.pythonBin = ${JSON.stringify(pythonBin)};

            const baseRequest = {
                prompt: "Compose a compact string trio miniature and intensify only the middle section on retry.",
                key: "D minor",
                tempo: 88,
                form: "miniature",
                workflow: "symbolic_only",
                selectedModels: [
                    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
                ],
                compositionPlan: {
                    version: "plan-v1",
                    brief: "string trio miniature",
                    mood: ["focused", "restless"],
                    form: "miniature",
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
                    motifPolicy: {
                        reuseRequired: true,
                        inversionAllowed: false,
                        augmentationAllowed: false,
                        diminutionAllowed: false,
                        sequenceAllowed: false,
                    },
                    sections: [
                        {
                            id: "s1",
                            role: "theme_a",
                            label: "Opening",
                            measures: 4,
                            energy: 0.32,
                            density: 0.28,
                            phraseFunction: "presentation",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "half",
                                allowModulation: false,
                            },
                        },
                        {
                            id: "s2",
                            role: "development",
                            label: "Middle",
                            measures: 4,
                            energy: 0.52,
                            density: 0.42,
                            phraseFunction: "continuation",
                            harmonicPlan: {
                                tonalCenter: "A minor",
                                harmonicRhythm: "fast",
                                cadence: "half",
                                allowModulation: true,
                            },
                        },
                        {
                            id: "s3",
                            role: "closing",
                            label: "Cadence",
                            measures: 4,
                            energy: 0.38,
                            density: 0.3,
                            phraseFunction: "cadential",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "authentic",
                                allowModulation: false,
                            },
                        },
                    ],
                    rationale: ["runPipeline retry truth-plane regression"],
                },
            };

            let sabotagedRender = false;
            const originalPythonBin = config.pythonBin;
            const manifest = await runPipeline({
                songId: "retry-truth-plane",
                ...baseRequest,
                evaluationPolicy: {
                    requireStructurePass: false,
                    requireAudioPass: false,
                },
                qualityPolicy: {
                    enableAutoRevision: true,
                    maxStructureAttempts: 2,
                    targetStructureScore: 90,
                },
            }, {
                onManifestUpdate(current) {
                    if (!sabotagedRender && current.runtime?.stage === "RENDER") {
                        sabotagedRender = true;
                        config.pythonBin = path.join(config.outputDir, "missing-render-python.exe");
                    }
                },
            });
            config.pythonBin = originalPythonBin;

            const index = JSON.parse(fs.readFileSync(structureCandidateIndexPath("retry-truth-plane"), "utf8"));
            const bundles = index.entries.map((entry) => {
                const candidateManifest = JSON.parse(
                    fs.readFileSync(structureCandidateManifestPath("retry-truth-plane", entry.candidateId), "utf8"),
                );
                const sectionArtifacts = candidateManifest.artifacts.sectionArtifacts
                    ? JSON.parse(fs.readFileSync(candidateManifest.artifacts.sectionArtifacts, "utf8"))
                    : [];
                return {
                    summary: entry,
                    candidateManifest,
                    sectionArtifacts,
                };
            });

            console.log(JSON.stringify({ manifest, index, bundles }));
        `, { cwd: repoRoot });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.manifest.state, "FAILED");
        assert.equal(payload.manifest.errorCode, "PIPELINE_ERROR");
        assert.equal(payload.manifest.qualityControl.selectedAttempt, 2);
        assert.equal(payload.index.selectedAttempt, 2);
        assert.equal(payload.index.entries.length, 4);
        assert.deepEqual(payload.index.entries.map((entry) => entry.attempt), [1, 1, 2, 2]);
        assert.match(payload.manifest.qualityControl.stopReason ?? "", /structure evaluation accepted the symbolic draft/);
        assert.match(payload.manifest.qualityControl.stopReason ?? "", /hybrid candidate pool/);
        assert.equal(payload.index.selectionStopReason, payload.manifest.qualityControl.stopReason);

        const selectedBundle = payload.bundles.find((bundle) => bundle.candidateManifest.selected);
        const rejectedBundle = payload.bundles.find((bundle) => !bundle.candidateManifest.selected);
        const attemptTwoBundles = payload.bundles.filter((bundle) => bundle.candidateManifest.attempt === 2);
        const learnedBundle = attemptTwoBundles.find((bundle) => bundle.candidateManifest.worker === "learned_symbolic");
        const baselineBundle = attemptTwoBundles.find((bundle) => bundle.candidateManifest.worker === "music21");

        assert.ok(selectedBundle);
        assert.ok(rejectedBundle);
        assert.equal(attemptTwoBundles.length, 2);
        assert.ok(learnedBundle);
        assert.ok(baselineBundle);
        assert.equal(payload.index.selectedCandidateId, selectedBundle.summary.candidateId);
        assert.equal(selectedBundle.summary.selected, true);
        assert.equal(selectedBundle.candidateManifest.selected, true);
        assert.equal(rejectedBundle.candidateManifest.selected, false);

        for (const bundle of attemptTwoBundles) {
            assert.equal(bundle.candidateManifest.attempt, 2);
            assert.ok(bundle.candidateManifest.revisionDirectives.length > 0);
        }

        assert.deepEqual(
            selectedBundle.candidateManifest.revisionDirectives,
            attemptTwoBundles.find((bundle) => !bundle.candidateManifest.selected)?.candidateManifest.revisionDirectives,
        );
        assert.ok(
            learnedBundle.candidateManifest.revisionDirectives.some((directive) => directive.sectionIds?.includes("s2")),
        );
        assert.equal(learnedBundle.candidateManifest.proposalEvidence?.generationMode, "targeted_section_rewrite");
        assert.ok(
            learnedBundle.candidateManifest.sectionTransforms?.some((entry) => /targeted_rewrite:/.test(entry.transformMode ?? "")),
        );
        assert.equal(
            learnedBundle.sectionArtifacts.find((entry) => entry.sectionId === "s2" && /targeted_rewrite:/.test(entry.transform?.transformMode ?? ""))?.transform?.sectionId,
            "s2",
        );
        assert.match(
            learnedBundle.sectionArtifacts.find((entry) => entry.sectionId === "s2")?.transform?.transformMode ?? "",
            /targeted_rewrite:/,
        );
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }
        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});