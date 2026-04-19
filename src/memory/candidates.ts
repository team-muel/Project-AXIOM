import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type {
    ComposeProposalEvidence,
    ComposeExecutionPlan,
    ComposeQualityPolicy,
    CompositionPlan,
    RevisionDirective,
    SectionArtifactSummary,
    SectionTonalitySummary,
    SectionTransformSummary,
    SongMeta,
    StructureEvaluationReport,
} from "../pipeline/types.js";

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
    artifacts: {
        midi?: string;
        sectionArtifacts?: string;
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
    evaluatedAt?: string;
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
        artifacts: {
            midi: input.midiData?.length ? candidateMidiFilePath : undefined,
            sectionArtifacts: input.sectionArtifacts?.length ? candidateSectionArtifactsPath : undefined,
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