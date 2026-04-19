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

function seedManifest(outputDir, songId, manifest, sectionArtifacts, expressionPlan) {
    const songDir = path.join(outputDir, songId);
    writeJson(path.join(songDir, "manifest.json"), manifest);
    if (sectionArtifacts) {
        writeJson(path.join(songDir, "section-artifacts.json"), sectionArtifacts);
    }
    if (expressionPlan) {
        writeJson(path.join(songDir, "expression-plan.json"), expressionPlan);
    }
}

function seedCandidateEvidence(outputDir, songId, index, candidates) {
    const candidatesDir = path.join(outputDir, songId, "candidates");
    writeJson(path.join(candidatesDir, "index.json"), index);
    for (const candidate of candidates) {
        writeJson(path.join(candidatesDir, candidate.candidateId, "candidate-manifest.json"), candidate.manifest);
        if (candidate.sectionArtifacts) {
            writeJson(path.join(candidatesDir, candidate.candidateId, "section-artifacts.json"), candidate.sectionArtifacts);
        }
    }
}

function seedDatasetFixtures(outputDir) {
    seedManifest(
        outputDir,
        "song-a",
        {
            songId: "song-a",
            state: "DONE",
            meta: {
                songId: "song-a",
                prompt: "string trio localized rewrite winner",
                key: "C major",
                tempo: 92,
                form: "miniature",
                source: "autonomy",
                promptHash: "hash-a",
                workflow: "symbolic_only",
                plannerVersion: "planner-v1",
                createdAt: "2026-04-18T09:00:00.000Z",
                updatedAt: "2026-04-18T09:05:00.000Z",
            },
            artifacts: {
                midi: "outputs/song-a/composition.mid",
            },
            approvalStatus: "approved",
            reviewFeedback: {
                reviewRubricVersion: "approval_review_rubric_v1",
                note: "Localized cadence rewrite improved the close.",
                appealScore: 8.8,
                strongestDimension: "phrase_breath",
                weakestDimension: "harmonic_color",
                comparisonReference: "run-2026-04-17-baseline",
            },
            structureEvaluation: {
                passed: true,
                score: 88,
                metrics: {
                    phrasePressureFit: 0.83,
                },
                longSpan: {
                    status: "held",
                    weakestDimension: "return_payoff",
                    averageFit: 0.81,
                },
            },
            qualityControl: {
                attempts: [
                    {
                        attempt: 1,
                        stage: "structure",
                        passed: false,
                        score: 73,
                        directives: [
                            {
                                kind: "clarify_phrase_rhetoric",
                                reason: "weak cadence release",
                                sectionIds: ["s2"],
                            },
                        ],
                        evaluatedAt: "2026-04-18T09:02:00.000Z",
                    },
                    {
                        attempt: 2,
                        stage: "structure",
                        passed: true,
                        score: 88,
                        directives: [],
                        evaluatedAt: "2026-04-18T09:04:00.000Z",
                    },
                ],
                selectedAttempt: 2,
                stopReason: "selected after localized rewrite improvement",
            },
            updatedAt: "2026-04-18T09:05:00.000Z",
        },
        [
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
        {
            sections: [
                {
                    sectionId: "s1",
                    phraseFunction: "presentation",
                    phraseBreath: { pickupStartMeasure: 1, arrivalMeasure: 4 },
                },
                {
                    sectionId: "s2",
                    phraseFunction: "cadential",
                    phraseBreath: { arrivalMeasure: 11, releaseStartMeasure: 12 },
                },
            ],
        },
    );

    seedCandidateEvidence(outputDir, "song-a", {
        version: 1,
        songId: "song-a",
        updatedAt: "2026-04-18T09:04:30.000Z",
        selectedCandidateId: "learned-a",
        selectedAttempt: 2,
        entries: [
            {
                candidateId: "baseline-a",
                attempt: 1,
                stage: "structure",
                selected: false,
                workflow: "symbolic_only",
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                passed: false,
                score: 73,
                evaluatedAt: "2026-04-18T09:02:00.000Z",
            },
            {
                candidateId: "learned-a",
                attempt: 2,
                stage: "structure",
                selected: true,
                workflow: "symbolic_only",
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                passed: true,
                score: 88,
                evaluatedAt: "2026-04-18T09:04:00.000Z",
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion: "string_trio_symbolic_benchmark_pack_v1",
                    benchmarkId: "localized_rewrite_probe",
                    promptPackVersion: "learned_symbolic_prompt_pack_v1",
                    planSignature: "lane=string_trio_symbolic|sig=flat-dataset-test",
                    generationMode: "targeted_section_rewrite",
                    confidence: 0.61,
                    normalizationWarnings: [
                        "section s2 role collapse: expected lead,counterline,bass got lead,bass",
                    ],
                },
            },
        ],
    }, [
        {
            candidateId: "baseline-a",
            manifest: {
                version: 1,
                stage: "structure",
                songId: "song-a",
                candidateId: "baseline-a",
                attempt: 1,
                selected: false,
                evaluatedAt: "2026-04-18T09:02:00.000Z",
                workflow: "symbolic_only",
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                compositionPlan: {
                    form: "miniature",
                    key: "C major",
                    tempo: 92,
                    sections: [
                        { sectionId: "s1", role: "theme_a", phraseFunction: "presentation" },
                        { sectionId: "s2", role: "cadence", phraseFunction: "cadential" },
                    ],
                },
                artifacts: {},
            },
        },
        {
            candidateId: "learned-a",
            manifest: {
                version: 1,
                stage: "structure",
                songId: "song-a",
                candidateId: "learned-a",
                attempt: 2,
                selected: true,
                evaluatedAt: "2026-04-18T09:04:00.000Z",
                workflow: "symbolic_only",
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                compositionPlan: {
                    form: "miniature",
                    key: "C major",
                    tempo: 92,
                    sections: [
                        { sectionId: "s1", role: "theme_a", phraseFunction: "presentation" },
                        { sectionId: "s2", role: "cadence", phraseFunction: "cadential" },
                    ],
                },
                revisionDirectives: [
                    {
                        kind: "clarify_phrase_rhetoric",
                        reason: "weak cadence release",
                        sectionIds: ["s2"],
                    },
                ],
                proposalEvidence: {
                    worker: "learned_symbolic",
                    lane: "string_trio_symbolic",
                    provider: "learned",
                    model: "learned-symbolic-trio-v1",
                    benchmarkPackVersion: "string_trio_symbolic_benchmark_pack_v1",
                    benchmarkId: "localized_rewrite_probe",
                    promptPackVersion: "learned_symbolic_prompt_pack_v1",
                    planSignature: "lane=string_trio_symbolic|sig=flat-dataset-test",
                    generationMode: "targeted_section_rewrite",
                    confidence: 0.61,
                    normalizationWarnings: [
                        "section s2 role collapse: expected lead,counterline,bass got lead,bass",
                    ],
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
                },
                {
                    sectionId: "s2",
                    role: "cadence",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [67, 65, 64],
                    phraseFunction: "cadential",
                    harmonicColorCues: [{ tag: "applied_dominant", startMeasure: 10, endMeasure: 11 }],
                },
            ],
        },
    ]);

    seedManifest(outputDir, "song-b", {
        songId: "song-b",
        state: "DONE",
        meta: {
            songId: "song-b",
            prompt: "manifest only fallback piece",
            form: "miniature",
            source: "api",
            promptHash: "hash-b",
            workflow: "symbolic_only",
            plannerVersion: "planner-v1",
            createdAt: "2026-04-18T10:00:00.000Z",
            updatedAt: "2026-04-18T10:02:00.000Z",
        },
        structureEvaluation: {
            passed: true,
            score: 79,
        },
        qualityControl: {
            selectedAttempt: 1,
            attempts: [],
        },
        updatedAt: "2026-04-18T10:02:00.000Z",
    });
}

test("dedicated backbone and localized-rewrite exporters write flat truth-plane datasets", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-flat-datasets-"));
    const outputDir = path.join(tempRoot, "outputs");
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        seedDatasetFixtures(outputDir);

        const backboneStdout = execFileSync(
            process.execPath,
            [
                "scripts/export-backbone-piece-dataset.mjs",
                "--root",
                outputDir,
                "--snapshot",
                "flat-test-snapshot",
            ],
            {
                cwd: repoRoot,
                encoding: "utf8",
            },
        );
        const rewriteStdout = execFileSync(
            process.execPath,
            [
                "scripts/export-localized-rewrite-dataset.mjs",
                "--root",
                outputDir,
                "--snapshot",
                "flat-test-snapshot",
            ],
            {
                cwd: repoRoot,
                encoding: "utf8",
            },
        );

        const backbonePayload = JSON.parse(backboneStdout.trim());
        const rewritePayload = JSON.parse(rewriteStdout.trim());

        assert.equal(backbonePayload.ok, true);
        assert.equal(backbonePayload.datasetVersion, "axiom_backbone_piece_v1");
        assert.equal(backbonePayload.rowCount, 2);
        assert.equal(backbonePayload.reviewTierCounts.reviewed_approved, 1);
        assert.equal(backbonePayload.reviewTierCounts.runtime_selected_unreviewed, 1);

        assert.equal(rewritePayload.ok, true);
        assert.equal(rewritePayload.datasetVersion, "axiom_localized_rewrite_v1");
        assert.equal(rewritePayload.rowCount, 1);
        assert.equal(rewritePayload.reviewTierCounts.reviewed_approved, 1);

        const backboneDatasetRoot = path.join(outputDir, "_system", "ml", "datasets", "axiom_backbone_piece_v1", "flat-test-snapshot");
        const rewriteDatasetRoot = path.join(outputDir, "_system", "ml", "datasets", "axiom_localized_rewrite_v1", "flat-test-snapshot");
        assert.equal(fs.existsSync(path.join(backboneDatasetRoot, "manifest.json")), true);
        assert.equal(fs.existsSync(path.join(backboneDatasetRoot, "rows.jsonl")), true);
        assert.equal(fs.existsSync(path.join(backboneDatasetRoot, "splits.json")), true);
        assert.equal(fs.existsSync(path.join(rewriteDatasetRoot, "manifest.json")), true);
        assert.equal(fs.existsSync(path.join(rewriteDatasetRoot, "rows.jsonl")), true);
        assert.equal(fs.existsSync(path.join(rewriteDatasetRoot, "splits.json")), true);

        const backboneRows = readJsonl(path.join(backboneDatasetRoot, "rows.jsonl"));
        const rewriteRows = readJsonl(path.join(rewriteDatasetRoot, "rows.jsonl"));
        const backboneSplits = JSON.parse(fs.readFileSync(path.join(backboneDatasetRoot, "splits.json"), "utf8"));
        const rewriteSplits = JSON.parse(fs.readFileSync(path.join(rewriteDatasetRoot, "splits.json"), "utf8"));
        assert.equal(backboneRows.length, 2);
        assert.equal(rewriteRows.length, 1);

        const selectedPiece = backboneRows.find((entry) => entry.songId === "song-a");
        const fallbackPiece = backboneRows.find((entry) => entry.songId === "song-b");
        const rewriteRow = rewriteRows[0];

        assert.equal(selectedPiece.reviewTier, "reviewed_approved");
        assert.equal(selectedPiece.selectedCandidateId, "learned-a");
        assert.equal(selectedPiece.selectedWorker, "learned_symbolic");
        assert.equal(selectedPiece.directiveContext.retryLocalization, "section_targeted");
        assert.deepEqual(selectedPiece.directiveContext.inputDirectiveKinds, ["clarify_phrase_rhetoric"]);
        assert.equal(selectedPiece.qualityLabels.retryCount, 1);
        assert.equal(selectedPiece.proposalEvidence.generationMode, "targeted_section_rewrite");
        assert.equal(selectedPiece.proposalEvidence.promptPackVersion, "learned_symbolic_prompt_pack_v1");
        assert.equal(selectedPiece.proposalWarningSignals.roleCollapseWarningCount, 1);
        assert.equal(selectedPiece.splitFamilyKey, "promptHash:hash-a");

        assert.equal(fallbackPiece.reviewTier, "runtime_selected_unreviewed");
        assert.equal(fallbackPiece.selectedCandidateId, undefined);
        assert.equal(fallbackPiece.qualityLabels.retryCount, 0);
        assert.equal(fallbackPiece.splitFamilyKey, "promptHash:hash-b");

        assert.equal(rewriteRow.reviewTier, "reviewed_approved");
        assert.equal(rewriteRow.songId, "song-a");
        assert.equal(rewriteRow.candidateId, "learned-a");
        assert.equal(rewriteRow.rewriteContext.targetSectionId, "s2");
        assert.equal(rewriteRow.rewriteContext.directiveKind, "clarify_phrase_rhetoric");
        assert.equal(rewriteRow.rewriteContext.retryLocalization, "section_targeted");
        assert.deepEqual(rewriteRow.rewriteContext.inputDirectiveSectionIds, ["s2"]);
        assert.equal(rewriteRow.targetSection.role, "cadence");
        assert.equal(rewriteRow.labels.selectedAfterRetry, true);
        assert.equal(rewriteRow.proposalEvidence.planSignature, "lane=string_trio_symbolic|sig=flat-dataset-test");
        assert.equal(rewriteRow.splitFamilyKey, "promptHash:hash-a");
        assert.equal(backboneSplits.splitKey, "splitFamilyKey");
        assert.equal(rewriteSplits.splitKey, "splitFamilyKey");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});