import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import type {
    ComposeProposalEvidence,
    ComposeExecutionPlan,
    ComposeQualityPolicy,
    CompositionPlan,
    CraftScoreSummary,
    ListenerFeedback,
    PianoCraftScoreSummary,
    PianoDataLoopEvidence,
    RevisionDirective,
    SectionArtifactSummary,
    SectionTonalitySummary,
    SectionTransformSummary,
    SongMeta,
    StructureEvaluationReport,
} from "../../core/pipeline/types.js";
import type { CandidateScoringProfiles } from "../../core/evaluate/scoringProfile.js";

export interface StructureCandidateIndexEntry {
    candidateId: string;
    attempt: number;
    stage: "structure";
    selected: boolean;
    workflow: ComposeExecutionPlan["workflow"];
    worker: string;
    provider: string;
    model: string;
    passed: boolean;
    score?: number;
    evaluatedAt: string;
    manifestPath: string;
    proposalEvidence?: ComposeProposalEvidence;
    sectionArtifactsPath?: string;
    midiPath?: string;
    rerankerScorePath?: string;
    shadowReranker?: StructureCandidateShadowSummary;
}

export interface StructureCandidateIndex {
    version: 1;
    songId: string;
    updatedAt: string;
    selectedCandidateId?: string;
    selectedAttempt?: number;
    selectionStopReason?: string;
    rerankerPromotion?: StructureCandidatePromotionSummary;
    entries: StructureCandidateIndexEntry[];
}

export interface StructureCandidatePromotionSummary {
    appliedAt: string;
    lane: string;
    snapshotId: string;
    confidence: number;
    heuristicTopCandidateId: string;
    learnedTopCandidateId: string;
    heuristicAttempt?: number;
    learnedAttempt?: number;
    reason?: string;
}

export interface StructureCandidateManifest {
    version: 1;
    stage: "structure";
    songId: string;
    candidateId: string;
    attempt: number;
    selected: boolean;
    selectedAt?: string;
    evaluatedAt: string;
    workflow: ComposeExecutionPlan["workflow"];
    worker: string;
    provider: string;
    model: string;
    meta: Partial<SongMeta>;
    executionPlan: ComposeExecutionPlan;
    compositionPlan?: CompositionPlan;
    qualityPolicy?: ComposeQualityPolicy;
    revisionDirectives: RevisionDirective[];
    structureEvaluation: StructureEvaluationReport;
    proposalEvidence?: ComposeProposalEvidence;
    sectionTonalities?: SectionTonalitySummary[];
    sectionTransforms?: SectionTransformSummary[];
    shadowReranker?: StructureCandidateShadowSummary;
    rerankerPromotion?: StructureCandidatePromotionSummary;
    /** Internal proxy metric scores (craftScoreSummary dimensions and overall score) */
    internalScores?: Record<string, number>;
    /** Structured per-dimension listener scores written at approval/rejection time */
    listenerScores?: Record<string, number>;
    /** Full structured listener feedback attached when a human approves or rejects this candidate */
    listenerFeedback?: ListenerFeedback;
    /**
     * Piano-specific craft scores.  Present only for solo-piano candidates that
     * passed the piano playability gate.  Mirrors pianoCraftScoreSummary in
     * structureEvaluation but surfaced here for quick access by dataset exporters.
     */
    pianoCraftScore?: PianoCraftScoreSummary;
    /**
     * Flat piano evidence fields aggregated across all sections for this candidate.
     * Populated by pianoDataset.buildPianoDataLoopEvidence() when the candidate is
     * a piano-solo generation.  Used by exportPianoPlayabilityDataset() and
     * exportPianoPreferenceDataset().
     */
    pianoEvidence?: PianoDataLoopEvidence;
    /**
     * Scoring and quality gate profiles used when this candidate was evaluated.
     * Stored so any selection decision can be reproduced exactly — e.g.
     * "this candidate was chosen under classical_default_v1 + quality_gate_v1".
     */
    scoringProfiles?: CandidateScoringProfiles;
    artifacts: {
        midi?: string;
        sectionArtifacts?: string;
        /** Path to the candidate.abc sidecar file (full ABC score text). */
        abc?: string;
    };
}

export interface StructureCandidateShadowSummary {
    snapshotId: string;
    evaluatedAt: string;
    heuristicRank: number;
    heuristicScore: number;
    learnedRank: number;
    learnedScore: number;
    learnedConfidence: number;
    disagreesWithHeuristic: boolean;
    disagreementReason?: string;
}

export interface StructureCandidateRerankerScore {
    version: 1;
    type: "structure_shadow_reranker";
    songId: string;
    candidateId: string;
    evaluatedAt: string;
    scorer: {
        snapshotId: string;
        modelPath: string;
        calibratedTemperature: number;
        featureCount: number;
    };
    heuristic: {
        score: number;
        rank: number;
        topCandidateId: string;
        topMargin: number;
    };
    learned: {
        score: number;
        rank: number;
        topCandidateId: string;
        topMargin: number;
        confidence: number;
    };
    disagreement: {
        disagrees: boolean;
        heuristicTopCandidateId: string;
        learnedTopCandidateId: string;
        reason?: string;
        topFeatures?: Array<{
            feature: string;
            contribution: number;
            learnedValue: number;
            heuristicValue: number;
        }>;
    };
}

export interface SaveStructureCandidateSnapshotInput {
    songId: string;
    candidateId: string;
    attempt: number;
    meta: Partial<SongMeta>;
    executionPlan: ComposeExecutionPlan;
    compositionPlan?: CompositionPlan;
    qualityPolicy?: ComposeQualityPolicy;
    revisionDirectives?: RevisionDirective[];
    structureEvaluation: StructureEvaluationReport;
    proposalEvidence?: ComposeProposalEvidence;
    sectionArtifacts?: SectionArtifactSummary[];
    sectionTonalities?: SectionTonalitySummary[];
    sectionTransforms?: SectionTransformSummary[];
    midiData?: Buffer;
    /** Full ABC score text to persist as a sidecar file (candidate.abc).
     *  Populated when the symbolic backend produces ABC text output. */
    abcText?: string;
    evaluatedAt?: string;
    /**
     * Piano-specific craft scores.  Supply when the candidate went through the
     * piano lane so the manifest can serve as a self-contained data loop entry.
     */
    pianoCraftScore?: PianoCraftScoreSummary;
    /**
     * Flat piano evidence aggregate.  Supply alongside pianoCraftScore so
     * dataset exporters can build playability and preference examples without
     * re-reading section artifacts.
     */
    pianoEvidence?: PianoDataLoopEvidence;
    /**
     * Scoring and quality gate profiles used during evaluation.
     * When supplied, stored verbatim in the candidate manifest for reproducibility.
     */
    scoringProfiles?: CandidateScoringProfiles;
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonFile(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonFile<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function sanitizeToken(value: string | undefined): string {
    const normalized = String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || "unknown";
}

function resolveStructureBinding(executionPlan: ComposeExecutionPlan) {
    return executionPlan.selectedModels.find((binding) => binding.role === "structure");
}

function structureCandidatesRoot(songId: string): string {
    return path.join(config.outputDir, songId, "candidates");
}

function structureCandidateDir(songId: string, candidateId: string): string {
    return path.join(structureCandidatesRoot(songId), candidateId);
}

export function structureCandidateIndexPath(songId: string): string {
    return path.join(structureCandidatesRoot(songId), "index.json");
}

export function structureCandidateManifestPath(songId: string, candidateId: string): string {
    return path.join(structureCandidateDir(songId, candidateId), "candidate-manifest.json");
}

export function structureCandidateSectionArtifactsPath(songId: string, candidateId: string): string {
    return path.join(structureCandidateDir(songId, candidateId), "section-artifacts.json");
}

export function structureCandidateMidiPath(songId: string, candidateId: string): string {
    return path.join(structureCandidateDir(songId, candidateId), "composition.mid");
}

export function structureCandidateAbcPath(songId: string, candidateId: string): string {
    return path.join(structureCandidateDir(songId, candidateId), "score.abc");
}

export function structureCandidateRerankerScorePath(songId: string, candidateId: string): string {
    return path.join(structureCandidateDir(songId, candidateId), "reranker-score.json");
}

function loadStructureCandidateIndex(songId: string): StructureCandidateIndex {
    return readJsonFile<StructureCandidateIndex>(structureCandidateIndexPath(songId)) ?? {
        version: 1,
        songId,
        updatedAt: new Date(0).toISOString(),
        entries: [],
    };
}

function saveStructureCandidateIndex(index: StructureCandidateIndex): void {
    writeJsonFile(structureCandidateIndexPath(index.songId), index);
}

export function buildStructureCandidateId(
    attempt: number,
    executionPlan: ComposeExecutionPlan,
    candidateVariantKey?: string,
): string {
    const structureBinding = resolveStructureBinding(executionPlan);
    const normalizedVariantKey = String(candidateVariantKey ?? "").trim();
    const digest = createHash("sha1")
        .update(JSON.stringify([
            attempt,
            executionPlan.workflow,
            executionPlan.composeWorker,
            structureBinding?.provider ?? "unknown",
            structureBinding?.model ?? "unknown",
            normalizedVariantKey || null,
        ]))
        .digest("hex")
        .slice(0, 12);

    return [
        "structure",
        `a${attempt}`,
        sanitizeToken(structureBinding?.provider ?? executionPlan.composeWorker),
        sanitizeToken(structureBinding?.model ?? executionPlan.composeWorker),
        ...(normalizedVariantKey ? [sanitizeToken(normalizedVariantKey)] : []),
        digest,
    ].join("-");
}

export function readStructureCandidateIndex(songId: string): StructureCandidateIndex | null {
    return readJsonFile<StructureCandidateIndex>(structureCandidateIndexPath(songId)) ?? null;
}

export function saveStructureCandidateSnapshot(input: SaveStructureCandidateSnapshotInput): void {
    const structureBinding = resolveStructureBinding(input.executionPlan);
    const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
    const candidateManifestPath = structureCandidateManifestPath(input.songId, input.candidateId);
    const candidateSectionArtifactsPath = structureCandidateSectionArtifactsPath(input.songId, input.candidateId);
    const candidateMidiFilePath = structureCandidateMidiPath(input.songId, input.candidateId);
    const candidateAbcFilePath = structureCandidateAbcPath(input.songId, input.candidateId);
    const hasAbcText = typeof input.abcText === "string" && input.abcText.trim().length > 0;
    const index = loadStructureCandidateIndex(input.songId);
    const selected = index.selectedCandidateId === input.candidateId;
    const candidateManifest: StructureCandidateManifest = {
        version: 1,
        stage: "structure",
        songId: input.songId,
        candidateId: input.candidateId,
        attempt: input.attempt,
        selected,
        ...(selected ? { selectedAt: index.updatedAt } : {}),
        evaluatedAt,
        workflow: input.executionPlan.workflow,
        worker: input.executionPlan.composeWorker,
        provider: structureBinding?.provider ?? "unknown",
        model: structureBinding?.model ?? input.executionPlan.composeWorker,
        meta: cloneJson(input.meta),
        executionPlan: cloneJson(input.executionPlan),
        compositionPlan: input.compositionPlan ? cloneJson(input.compositionPlan) : undefined,
        qualityPolicy: input.qualityPolicy ? cloneJson(input.qualityPolicy) : undefined,
        revisionDirectives: cloneJson(input.revisionDirectives ?? []),
        structureEvaluation: cloneJson(input.structureEvaluation),
        proposalEvidence: input.proposalEvidence ? cloneJson(input.proposalEvidence) : undefined,
        sectionTonalities: input.sectionTonalities ? cloneJson(input.sectionTonalities) : undefined,
        sectionTransforms: input.sectionTransforms ? cloneJson(input.sectionTransforms) : undefined,
        ...(selected && index.rerankerPromotion
            ? { rerankerPromotion: cloneJson(index.rerankerPromotion) }
            : {}),
        ...(input.pianoCraftScore ? { pianoCraftScore: cloneJson(input.pianoCraftScore) } : {}),
        ...(input.pianoEvidence ? { pianoEvidence: cloneJson(input.pianoEvidence) } : {}),
        ...(input.scoringProfiles ? { scoringProfiles: cloneJson(input.scoringProfiles) } : {}),
        artifacts: {
            midi: input.midiData?.length ? candidateMidiFilePath : undefined,
            sectionArtifacts: input.sectionArtifacts?.length ? candidateSectionArtifactsPath : undefined,
            abc: hasAbcText ? candidateAbcFilePath : undefined,
        },
    };

    writeJsonFile(candidateManifestPath, candidateManifest);

    if (input.sectionArtifacts?.length) {
        writeJsonFile(candidateSectionArtifactsPath, cloneJson(input.sectionArtifacts));
    }

    if (input.midiData?.length) {
        ensureDir(path.dirname(candidateMidiFilePath));
        fs.writeFileSync(candidateMidiFilePath, input.midiData);
    }

    if (hasAbcText) {
        ensureDir(path.dirname(candidateAbcFilePath));
        fs.writeFileSync(candidateAbcFilePath, input.abcText as string, "utf-8");
    }

    const nextEntry: StructureCandidateIndexEntry = {
        candidateId: input.candidateId,
        attempt: input.attempt,
        stage: "structure",
        selected,
        workflow: input.executionPlan.workflow,
        worker: input.executionPlan.composeWorker,
        provider: structureBinding?.provider ?? "unknown",
        model: structureBinding?.model ?? input.executionPlan.composeWorker,
        passed: Boolean(input.structureEvaluation.passed),
        score: input.structureEvaluation.score,
        evaluatedAt,
        manifestPath: candidateManifestPath,
        proposalEvidence: input.proposalEvidence ? cloneJson(input.proposalEvidence) : undefined,
        sectionArtifactsPath: input.sectionArtifacts?.length ? candidateSectionArtifactsPath : undefined,
        midiPath: input.midiData?.length ? candidateMidiFilePath : undefined,
    };

    index.entries = [
        ...index.entries.filter((entry) => entry.candidateId !== input.candidateId),
        nextEntry,
    ].sort((left, right) => left.attempt - right.attempt || left.candidateId.localeCompare(right.candidateId));
    index.updatedAt = new Date().toISOString();
    saveStructureCandidateIndex(index);
}

export function markSelectedStructureCandidate(
    songId: string,
    candidateId: string,
    selectedAttempt: number,
    stopReason?: string,
    promotion?: StructureCandidatePromotionSummary,
): void {
    const index = loadStructureCandidateIndex(songId);
    index.selectedCandidateId = candidateId;
    index.selectedAttempt = selectedAttempt;
    index.selectionStopReason = stopReason;
    index.rerankerPromotion = promotion ? cloneJson(promotion) : undefined;
    index.updatedAt = new Date().toISOString();
    index.entries = index.entries.map((entry) => ({
        ...entry,
        selected: entry.candidateId === candidateId,
    }));
    saveStructureCandidateIndex(index);

    for (const entry of index.entries) {
        const candidateManifestPath = structureCandidateManifestPath(songId, entry.candidateId);
        const candidateManifest = readJsonFile<StructureCandidateManifest>(candidateManifestPath);
        if (!candidateManifest) {
            continue;
        }

        candidateManifest.selected = entry.candidateId === candidateId;
        candidateManifest.selectedAt = candidateManifest.selected ? index.updatedAt : undefined;
        candidateManifest.rerankerPromotion = candidateManifest.selected && promotion
            ? cloneJson(promotion)
            : undefined;
        writeJsonFile(candidateManifestPath, candidateManifest);
    }
}

export function saveStructureCandidateRerankerScore(score: StructureCandidateRerankerScore): void {
    const scorePath = structureCandidateRerankerScorePath(score.songId, score.candidateId);
    writeJsonFile(scorePath, score);

    const shadowSummary: StructureCandidateShadowSummary = {
        snapshotId: score.scorer.snapshotId,
        evaluatedAt: score.evaluatedAt,
        heuristicRank: score.heuristic.rank,
        heuristicScore: score.heuristic.score,
        learnedRank: score.learned.rank,
        learnedScore: score.learned.score,
        learnedConfidence: score.learned.confidence,
        disagreesWithHeuristic: score.disagreement.disagrees,
        disagreementReason: score.disagreement.reason,
    };

    const candidateManifestPath = structureCandidateManifestPath(score.songId, score.candidateId);
    const candidateManifest = readJsonFile<StructureCandidateManifest>(candidateManifestPath);
    if (candidateManifest) {
        candidateManifest.shadowReranker = shadowSummary;
        writeJsonFile(candidateManifestPath, candidateManifest);
    }

    const index = loadStructureCandidateIndex(score.songId);
    index.entries = index.entries.map((entry) => entry.candidateId === score.candidateId
        ? {
            ...entry,
            rerankerScorePath: scorePath,
            shadowReranker: shadowSummary,
        }
        : entry);
    index.updatedAt = new Date().toISOString();
    saveStructureCandidateIndex(index);
}

/**
 * Saves listener feedback (and internalScores/listenerScores derived from it)
 * to the selected candidate's sidecar manifest for a given song.
 * No-ops gracefully when the candidate index or manifest is missing.
 */
export function saveListenerFeedbackToSelectedCandidate(
    songId: string,
    feedback: ListenerFeedback,
    internalScores?: Record<string, number>,
): void {
    const index = loadStructureCandidateIndex(songId);
    const selectedId = index.selectedCandidateId;
    if (!selectedId) {
        return;
    }
    saveListenerFeedbackToCandidate(songId, selectedId, feedback, internalScores);
}

/**
 * Saves listener feedback to any structure candidate manifest by candidateId,
 * regardless of whether the candidate is selected.  This is the canonical
 * low-level writer; {@link saveListenerFeedbackToSelectedCandidate} delegates here.
 *
 * Supports pairwise preference signals via `feedback.preferredOver` and
 * rejection rationale via `feedback.rejectionReason`.
 *
 * @returns the updated manifest, or null when the manifest file is missing.
 */
export function saveListenerFeedbackToCandidate(
    songId: string,
    candidateId: string,
    feedback: ListenerFeedback,
    internalScores?: Record<string, number>,
): StructureCandidateManifest | null {
    const candidateManifestPath = structureCandidateManifestPath(songId, candidateId);
    const candidateManifest = readJsonFile<StructureCandidateManifest>(candidateManifestPath);
    if (!candidateManifest) {
        return null;
    }

    candidateManifest.listenerFeedback = cloneJson(feedback);

    // Build a flat listenerScores record from numeric feedback dimensions
    const listenerScores: Record<string, number> = {};
    if (typeof feedback.appeal === "number") listenerScores["appeal"] = feedback.appeal;
    if (typeof feedback.memorability === "number") listenerScores["memorability"] = feedback.memorability;
    if (typeof feedback.coherence === "number") listenerScores["coherence"] = feedback.coherence;
    if (typeof feedback.emotionalImpact === "number") listenerScores["emotionalImpact"] = feedback.emotionalImpact;
    candidateManifest.listenerScores = listenerScores;

    if (internalScores) {
        candidateManifest.internalScores = { ...internalScores };
    } else {
        // Derive from craftScoreSummary + pianoCraftScore if available
        const craft = candidateManifest.structureEvaluation?.craftScoreSummary;
        const piano = candidateManifest.structureEvaluation?.pianoCraftScoreSummary
            ?? candidateManifest.pianoCraftScore;
        if (craft || piano) {
            candidateManifest.internalScores = {
                ...(craft ? {
                    syntaxValidity: craft.syntaxValidity,
                    sectionContractFit: craft.sectionContractFit,
                    cadenceStrength: craft.cadenceStrength,
                    tonalReturn: craft.tonalReturn,
                    motifSurvival: craft.motifSurvival,
                    voiceIndependence: craft.voiceIndependence,
                    phraseShape: craft.phraseShape,
                    registerIdiomaticFit: craft.registerIdiomaticFit,
                    finalCraftScore: craft.finalCraftScore,
                } : {}),
                ...(piano ? {
                    piano_handPlayability: piano.handPlayability,
                    piano_melodicClarity: piano.melodicClarity,
                    piano_bassCoherence: piano.bassCoherence,
                    piano_voicingIdiomaticFit: piano.voicingIdiomaticFit,
                    piano_accompanimentPatternCoherence: piano.accompanimentPatternCoherence,
                    piano_registerSpacing: piano.registerSpacing,
                    piano_handIndependence: piano.handIndependence,
                    piano_pedalPlausibility: piano.pedalPlausibility,
                    piano_difficultyFit: piano.difficultyFit,
                    piano_finalPianoScore: piano.finalPianoScore,
                } : {}),
            };
        }
    }

    writeJsonFile(candidateManifestPath, candidateManifest);
    return candidateManifest;
}