import fs from "node:fs";
import path from "node:path";
import { logger } from "../logging/logger.js";
import {
    saveStructureCandidateRerankerScore,
    structureCandidateIndexPath,
    structureCandidateManifestPath,
    structureCandidateRerankerScorePath,
    structureCandidateSectionArtifactsPath,
    type StructureCandidateIndex,
    type StructureCandidateManifest,
    type StructureCandidateRerankerScore,
} from "../memory/candidates.js";
import { config } from "../config.js";
import { appendStructureShadowHistory } from "./structureShadowHistory.js";
import {
    compareStructureEvaluationsForCandidateSelection,
    scoreStructureEvaluationForCandidateSelection,
} from "./structureSelection.js";
import type { SectionArtifactSummary, SectionPlan, StructureEvaluationReport } from "./types.js";

interface LoadedStructureShadowModel {
    snapshotId: string;
    modelPath: string;
    calibratedTemperature: number;
    featureNames: string[];
    weights: number[];
}

interface RuntimeStructureCandidate {
    songId: string;
    candidateId: string;
    attempt: number;
    manifest: StructureCandidateManifest;
    sectionArtifacts: SectionArtifactSummary[];
    structureEvaluation: StructureEvaluationReport;
    featureVector: number[];
    heuristicScore: number;
    learnedScore: number;
}

export interface StructureShadowRerankerResult {
    songId: string;
    snapshotId: string;
    candidateCount: number;
    heuristicTopCandidateId: string;
    learnedTopCandidateId: string;
    confidence: number;
    disagreement: boolean;
    scorePaths: string[];
    reason?: string;
    topFeatures?: StructureCandidateRerankerScore["disagreement"]["topFeatures"];
}

interface ComputedStructureShadowRanking {
    model: LoadedStructureShadowModel;
    candidates: RuntimeStructureCandidate[];
    heuristicRanked: RuntimeStructureCandidate[];
    learnedRanked: RuntimeStructureCandidate[];
    heuristicTopMargin: number;
    learnedTopMargin: number;
    learnedConfidence: number;
    disagreement: boolean;
    explanation: {
        reason?: string;
        topFeatures?: StructureCandidateRerankerScore["disagreement"]["topFeatures"];
    };
    evaluatedAt: string;
}

let cachedModelKey = "";
let cachedModel: LoadedStructureShadowModel | null = null;
let warnedMissingModelKey = "";

function readJsonIfExists<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    } catch {
        return null;
    }
}

function toTrimmed(value: unknown): string {
    return String(value ?? "").trim();
}

function toNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function round(value: number, digits = 6): number {
    return Number(value.toFixed(digits));
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function sigmoid(value: number): number {
    const bounded = clamp(value, -20, 20);
    return 1 / (1 + Math.exp(-bounded));
}

function normalizeScore(value: unknown): number {
    const numeric = toNumber(value) ?? 0;
    if (Math.abs(numeric) <= 1) {
        return numeric;
    }

    return clamp(numeric / 100, -3, 3);
}

function normalizeMetricValue(value: unknown): number {
    const numeric = toNumber(value);
    if (numeric === undefined) {
        return 0;
    }

    if (Math.abs(numeric) <= 1.5) {
        return clamp(numeric, -3, 3);
    }

    if (Math.abs(numeric) <= 100) {
        return clamp(numeric / 100, -3, 3);
    }

    return clamp(numeric / 1000, -3, 3);
}

function normalizeCount(value: unknown, scale = 6): number {
    return clamp((toNumber(value) ?? 0) / scale, -3, 3);
}

function addCategoricalFeature(featureMap: Record<string, number>, prefix: string, value: unknown): void {
    const normalized = toTrimmed(value);
    if (!normalized) {
        return;
    }

    featureMap[`${prefix}:${normalized}`] = 1;
}

function uniqueStrings(values: unknown[]): string[] {
    return [...new Set(values.map((value) => toTrimmed(value)).filter(Boolean))];
}

function normalizeWarningList(values: unknown): string[] {
    return (Array.isArray(values) ? values : [])
        .map((value) => toTrimmed(value))
        .filter(Boolean);
}

function countRoleCollapseWarnings(values: unknown): number {
    return normalizeWarningList(values)
        .filter((value) => value.toLowerCase().includes("role collapse"))
        .length;
}

function collectDirectiveSectionIds(directives: unknown[]): string[] {
    const sectionIds: string[] = [];

    for (const directive of directives) {
        if (directive && typeof directive === "object") {
            const sectionId = toTrimmed((directive as { sectionId?: unknown }).sectionId);
            if (sectionId) {
                sectionIds.push(sectionId);
            }

            const scopedSectionIds = Array.isArray((directive as { sectionIds?: unknown[] }).sectionIds)
                ? (directive as { sectionIds?: unknown[] }).sectionIds ?? []
                : [];
            for (const scopedSectionId of scopedSectionIds) {
                const normalized = toTrimmed(scopedSectionId);
                if (normalized) {
                    sectionIds.push(normalized);
                }
            }
        }
    }

    return uniqueStrings(sectionIds);
}

function classifyRetryLocalization(directives: unknown[]): string {
    const normalized = Array.isArray(directives) ? directives : [];
    if (normalized.length === 0) {
        return "none";
    }

    const targetedDirectiveCount = normalized.filter((directive) => collectDirectiveSectionIds([directive]).length > 0).length;
    if (targetedDirectiveCount === 0) {
        return "global_only";
    }

    if (targetedDirectiveCount === normalized.length) {
        return "section_targeted_only";
    }

    return "mixed";
}

function stableCompareCandidates(left: RuntimeStructureCandidate, right: RuntimeStructureCandidate): number {
    return left.attempt - right.attempt || left.candidateId.localeCompare(right.candidateId);
}

function resolveModelPath(): string {
    return path.join(
        config.outputDir,
        "_system",
        "ml",
        "evaluations",
        "structure-rank-v1",
        config.structureRerankerShadowSnapshot,
        "shadow-reranker-model.json",
    );
}

function loadShadowModel(): LoadedStructureShadowModel | null {
    if (!config.structureRerankerShadowEnabled || !config.structureRerankerShadowSnapshot.trim()) {
        return null;
    }

    const modelPath = resolveModelPath();
    if (cachedModel && cachedModelKey === modelPath) {
        return cachedModel;
    }

    const payload = readJsonIfExists<{
        snapshotId?: string;
        featureNames?: string[];
        calibratedTemperature?: number;
        weights?: Array<{ feature?: string; weight?: number }>;
    }>(modelPath);
    if (!payload?.featureNames?.length || !payload?.weights?.length) {
        if (warnedMissingModelKey !== modelPath) {
            warnedMissingModelKey = modelPath;
            logger.warn("Structure shadow reranker model unavailable; shadow scoring skipped", {
                modelPath,
                snapshotId: config.structureRerankerShadowSnapshot,
            });
        }
        return null;
    }

    const featureNames = payload.featureNames.map((entry) => toTrimmed(entry)).filter(Boolean);
    const weightMap = new Map(
        payload.weights
            .map((entry) => [toTrimmed(entry?.feature), toNumber(entry?.weight) ?? 0] as const)
            .filter(([feature]) => Boolean(feature)),
    );

    cachedModelKey = modelPath;
    cachedModel = {
        snapshotId: toTrimmed(payload.snapshotId) || config.structureRerankerShadowSnapshot,
        modelPath,
        calibratedTemperature: toNumber(payload.calibratedTemperature) ?? 1,
        featureNames,
        weights: featureNames.map((feature) => weightMap.get(feature) ?? 0),
    };
    return cachedModel;
}

function countPhraseBreathCues(sections: SectionPlan[]): number {
    return sections.reduce((count, section) => {
        const phraseBreath = section.phraseBreath ?? {};
        const rubatoAnchors = Array.isArray(phraseBreath.rubatoAnchors) ? phraseBreath.rubatoAnchors.length : 0;
        return count
            + (phraseBreath.pickupStartMeasure !== undefined ? 1 : 0)
            + (phraseBreath.arrivalMeasure !== undefined ? 1 : 0)
            + (phraseBreath.releaseStartMeasure !== undefined ? 1 : 0)
            + (phraseBreath.cadenceRecoveryStartMeasure !== undefined ? 1 : 0)
            + rubatoAnchors;
    }, 0);
}

function countArrayCues(sections: SectionPlan[], field: "tempoMotion" | "ornaments"): number {
    return sections.reduce((count, section) => count + (Array.isArray(section[field]) ? section[field].length : 0), 0);
}

function buildFeatureMap(candidate: StructureCandidateManifest, sectionArtifacts: SectionArtifactSummary[]): Record<string, number> {
    const featureMap: Record<string, number> = {};
    const compositionSections = Array.isArray(candidate.compositionPlan?.sections)
        ? candidate.compositionPlan.sections
        : [];
    const proposalEvidence = candidate.proposalEvidence;
    const proposalSummary = proposalEvidence?.summary;
    const proposalWarnings = normalizeWarningList(proposalEvidence?.normalizationWarnings);
    const revisionDirectives = Array.isArray(candidate.revisionDirectives) ? candidate.revisionDirectives : [];
    const inputDirectiveKinds = uniqueStrings(revisionDirectives.map((directive) => directive?.kind));
    const inputDirectiveSectionIds = collectDirectiveSectionIds(revisionDirectives);
    const retriedFromAttempt = revisionDirectives.length > 0 && candidate.attempt > 1
        ? candidate.attempt - 1
        : undefined;
    const sectionCount = Math.max(1, compositionSections.length || sectionArtifacts.length || 1);
    const weakestSections = Array.isArray(candidate.structureEvaluation.weakestSections)
        ? candidate.structureEvaluation.weakestSections
        : [];
    const proposalWarningCount = proposalWarnings.length;
    const roleCollapseWarningCount = countRoleCollapseWarnings(proposalWarnings);
    const weakestScores = weakestSections
        .map((entry) => normalizeScore(entry?.score))
        .filter((value) => Number.isFinite(value));
    const weakestIssues = weakestSections.reduce((sum, entry) => sum + (entry?.issues?.length ?? 0), 0);
    const sectionTonalityCount = Array.isArray(candidate.sectionTonalities)
        ? candidate.sectionTonalities.length
        : sectionArtifacts.filter((entry) => Boolean(toTrimmed(entry?.sectionId))).length;
    const tempoMotionDefaults = Array.isArray(candidate.compositionPlan?.tempoMotionDefaults)
        ? candidate.compositionPlan.tempoMotionDefaults.length
        : 0;
    const ornamentDefaults = Array.isArray(candidate.compositionPlan?.ornamentDefaults)
        ? candidate.compositionPlan.ornamentDefaults.length
        : 0;
    const harmonicColorCueCount = sectionArtifacts.reduce((count, section) => count + (Array.isArray(section?.harmonicColorCues) ? section.harmonicColorCues.length : 0), 0);

    featureMap.bias = 1;
    featureMap.structurePassed = candidate.structureEvaluation.passed ? 1 : 0;
    featureMap.structureScore = normalizeScore(candidate.structureEvaluation.score);
    featureMap.issueCount = normalizeCount(candidate.structureEvaluation.issues.length);
    featureMap.strengthCount = normalizeCount(candidate.structureEvaluation.strengths.length);
    featureMap.sectionCount = clamp(sectionCount / 16, 0, 3);
    featureMap.sectionRoleCount = normalizeCount(compositionSections.map((section) => section.role).filter(Boolean).length);
    featureMap.counterpointModeCount = normalizeCount(compositionSections.map((section) => section.texture?.counterpointMode).filter(Boolean).length);
    featureMap.harmonicColorTagCount = normalizeCount(harmonicColorCueCount);
    featureMap.longSpanRequested = candidate.compositionPlan?.longSpanForm ? 1 : 0;
    featureMap.workflowSymbolicPlusAudio = candidate.workflow === "symbolic_plus_audio" ? 1 : 0;
    featureMap.sourceAutonomy = candidate.meta.source === "autonomy" ? 1 : 0;
    featureMap.weakestSectionCount = normalizeCount(weakestSections.length);
    featureMap.weakestIssueCount = normalizeCount(weakestIssues);
    featureMap.weakestMinScore = weakestScores.length ? Math.min(...weakestScores) : normalizeScore(candidate.structureEvaluation.score);
    featureMap.weakestAvgScore = weakestScores.length
        ? weakestScores.reduce((sum, value) => sum + value, 0) / weakestScores.length
        : normalizeScore(candidate.structureEvaluation.score);
    featureMap.sectionArtifactCoverage = clamp(sectionArtifacts.length / sectionCount, 0, 3);
    featureMap.sectionTonalityCoverage = clamp(sectionTonalityCount / sectionCount, 0, 3);
    featureMap.phraseBreathCueDensity = clamp(countPhraseBreathCues(compositionSections) / sectionCount, 0, 3);
    featureMap.tempoMotionCueDensity = clamp((countArrayCues(compositionSections, "tempoMotion") + tempoMotionDefaults) / sectionCount, 0, 3);
    featureMap.ornamentCueDensity = clamp((countArrayCues(compositionSections, "ornaments") + ornamentDefaults) / sectionCount, 0, 3);
    featureMap.harmonicColorCueDensity = clamp(harmonicColorCueCount / sectionCount, 0, 3);
    featureMap.hasSectionArtifacts = sectionArtifacts.length > 0 ? 1 : 0;
    featureMap.hasExpressionPlan = 0;
    featureMap.hasCompositionPlan = candidate.compositionPlan ? 1 : 0;
    featureMap.hasAttemptWeakestSections = weakestSections.length > 0 ? 1 : 0;
    featureMap.hasInputDirectiveContext = revisionDirectives.length > 0 ? 1 : 0;
    featureMap.hasProposalEvidence = candidate.proposalEvidence ? 1 : 0;
    featureMap.hasLearnedProposalEvidence = proposalEvidence?.worker === "learned_symbolic" ? 1 : 0;
    featureMap.hasProposalLane = toTrimmed(proposalEvidence?.lane) ? 1 : 0;
    featureMap.hasProposalSummary = proposalSummary && Object.keys(proposalSummary).length > 0 ? 1 : 0;
    featureMap.hasProposalNormalizationWarnings = proposalWarningCount > 0 ? 1 : 0;
    featureMap.hasProposalRoleCollapseWarnings = roleCollapseWarningCount > 0 ? 1 : 0;
    featureMap.selectedAttemptFeatureRich = sectionArtifacts.length > 0 || Boolean(candidate.compositionPlan) || weakestSections.length > 0 ? 1 : 0;
    featureMap.retryingCandidate = retriedFromAttempt !== undefined ? 1 : 0;
    featureMap.retryDirectiveCount = normalizeCount(inputDirectiveKinds.length, 4);
    featureMap.inputDirectiveSectionDensity = clamp(inputDirectiveSectionIds.length / sectionCount, 0, 3);
    featureMap.retriedFromAttempt = clamp((retriedFromAttempt ?? 0) / 4, 0, 3);
    featureMap.longSpanAverageFit = normalizeMetricValue(candidate.structureEvaluation.longSpan?.averageFit);
    featureMap.longSpanHeld = toTrimmed(candidate.structureEvaluation.longSpan?.status) === "held" ? 1 : 0;
    featureMap.longSpanAtRisk = toTrimmed(candidate.structureEvaluation.longSpan?.status) === "at_risk" ? 1 : 0;
    featureMap.longSpanCollapsed = toTrimmed(candidate.structureEvaluation.longSpan?.status) === "collapsed" ? 1 : 0;
    featureMap.orchestrationIdiomaticRangeFit = normalizeMetricValue(candidate.structureEvaluation.orchestration?.idiomaticRangeFit);
    featureMap.orchestrationRegisterBalanceFit = normalizeMetricValue(candidate.structureEvaluation.orchestration?.registerBalanceFit);
    featureMap.orchestrationConversationFit = normalizeMetricValue(candidate.structureEvaluation.orchestration?.ensembleConversationFit);
    featureMap.orchestrationDoublingFit = normalizeMetricValue(candidate.structureEvaluation.orchestration?.doublingPressureFit);
    featureMap.orchestrationHandoffFit = normalizeMetricValue(candidate.structureEvaluation.orchestration?.sectionHandoffFit);
    featureMap.proposalConfidence = normalizeMetricValue(proposalEvidence?.confidence);
    featureMap.proposalNormalizationWarningCount = normalizeCount(proposalWarningCount, 4);
    featureMap.proposalRoleCollapseWarningCount = normalizeCount(roleCollapseWarningCount, 4);
    featureMap.proposalSummaryPartCount = normalizeCount(proposalSummary?.partCount, 4);
    featureMap.proposalSummaryMeasureCount = clamp((toNumber(proposalSummary?.measureCount) ?? 0) / 32, 0, 3);
    featureMap.proposalSummaryNoteCount = clamp((toNumber(proposalSummary?.noteCount) ?? 0) / 96, 0, 3);

    addCategoricalFeature(featureMap, "proposalWorker", proposalEvidence?.worker);
    addCategoricalFeature(featureMap, "proposalLane", proposalEvidence?.lane);
    addCategoricalFeature(featureMap, "proposalGenerationMode", proposalEvidence?.generationMode);
    addCategoricalFeature(featureMap, "retryLocalization", classifyRetryLocalization(revisionDirectives));
    for (const kind of inputDirectiveKinds) {
        addCategoricalFeature(featureMap, "inputDirectiveKind", kind);
    }

    for (const [key, value] of Object.entries(candidate.structureEvaluation.metrics ?? {})) {
        featureMap[`metric:${key}`] = normalizeMetricValue(value);
    }

    return featureMap;
}

function buildDenseVector(featureNames: string[], featureMap: Record<string, number>): number[] {
    return featureNames.map((feature) => featureMap[feature] ?? 0);
}

function dot(left: number[], right: number[]): number {
    let total = 0;
    for (let index = 0; index < left.length; index += 1) {
        total += (left[index] ?? 0) * (right[index] ?? 0);
    }
    return total;
}

function compareHeuristicCandidates(left: RuntimeStructureCandidate, right: RuntimeStructureCandidate): number {
    const comparison = compareStructureEvaluationsForCandidateSelection(left.structureEvaluation, right.structureEvaluation);
    if (Math.abs(comparison) > 0.0001) {
        return comparison > 0 ? -1 : 1;
    }

    return stableCompareCandidates(left, right);
}

function compareLearnedCandidates(left: RuntimeStructureCandidate, right: RuntimeStructureCandidate): number {
    const delta = right.learnedScore - left.learnedScore;
    if (Math.abs(delta) > 0.000001) {
        return delta > 0 ? 1 : -1;
    }

    return stableCompareCandidates(left, right);
}

function buildContributionSummary(contributions: Array<{ feature: string; contribution: number }>): string {
    if (contributions.length === 0) {
        return "no strong shadow-reranker feature contribution surfaced";
    }

    const positive = contributions.filter((entry) => entry.contribution > 0).slice(0, 2).map((entry) => entry.feature);
    const negative = contributions.filter((entry) => entry.contribution < 0).slice(0, 1).map((entry) => entry.feature);
    if (positive.length > 0 && negative.length > 0) {
        return `learned favored ${positive.join(", ")} despite heuristic strength on ${negative.join(", ")}`;
    }

    if (positive.length > 0) {
        return `learned favored ${positive.join(", ")}`;
    }

    return `heuristic retained an edge on ${negative.join(", ")}`;
}

function buildDisagreementFeatures(
    model: LoadedStructureShadowModel,
    learnedTop: RuntimeStructureCandidate,
    heuristicTop: RuntimeStructureCandidate,
): { reason: string; topFeatures: StructureCandidateRerankerScore["disagreement"]["topFeatures"] } {
    const contributions = model.featureNames
        .map((feature, index) => ({
            feature,
            contribution: model.weights[index] * ((learnedTop.featureVector[index] ?? 0) - (heuristicTop.featureVector[index] ?? 0)),
            learnedValue: learnedTop.featureVector[index] ?? 0,
            heuristicValue: heuristicTop.featureVector[index] ?? 0,
        }))
        .filter((entry) => entry.feature !== "bias" && Math.abs(entry.contribution) > 0.0001)
        .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
        .slice(0, 5)
        .map((entry) => ({
            feature: entry.feature,
            contribution: round(entry.contribution, 6),
            learnedValue: round(entry.learnedValue, 6),
            heuristicValue: round(entry.heuristicValue, 6),
        }));

    return {
        reason: buildContributionSummary(contributions),
        topFeatures: contributions,
    };
}

function loadRuntimeCandidates(songId: string, model: LoadedStructureShadowModel): RuntimeStructureCandidate[] {
    const index = readJsonIfExists<StructureCandidateIndex>(structureCandidateIndexPath(songId));
    const entries = index?.entries ?? [];
    const candidates: RuntimeStructureCandidate[] = [];

    for (const entry of entries) {
        const manifest = readJsonIfExists<StructureCandidateManifest>(structureCandidateManifestPath(songId, entry.candidateId));
        if (!manifest?.structureEvaluation) {
            continue;
        }

        const sectionArtifacts = readJsonIfExists<SectionArtifactSummary[]>(
            toTrimmed(manifest.artifacts.sectionArtifacts) || structureCandidateSectionArtifactsPath(songId, entry.candidateId),
        ) ?? [];
        const featureVector = buildDenseVector(model.featureNames, buildFeatureMap(manifest, sectionArtifacts));
        candidates.push({
            songId,
            candidateId: entry.candidateId,
            attempt: entry.attempt,
            manifest,
            sectionArtifacts,
            structureEvaluation: manifest.structureEvaluation,
            featureVector,
            heuristicScore: scoreStructureEvaluationForCandidateSelection(manifest.structureEvaluation),
            learnedScore: dot(model.weights, featureVector),
        });
    }

    return candidates;
}

function computeStructureShadowRanking(songId: string): ComputedStructureShadowRanking | null {
    const model = loadShadowModel();
    if (!model) {
        return null;
    }

    const candidates = loadRuntimeCandidates(songId, model);
    if (candidates.length === 0) {
        return null;
    }

    const heuristicRanked = [...candidates].sort(compareHeuristicCandidates);
    const learnedRanked = [...candidates].sort(compareLearnedCandidates);
    const heuristicTop = heuristicRanked[0];
    const learnedTop = learnedRanked[0];
    const heuristicTopMargin = heuristicRanked.length > 1
        ? round(heuristicTop.heuristicScore - heuristicRanked[1].heuristicScore, 6)
        : 0;
    const learnedTopMargin = learnedRanked.length > 1
        ? round(learnedTop.learnedScore - learnedRanked[1].learnedScore, 6)
        : 0;
    const learnedConfidence = round(sigmoid(learnedTopMargin / (model.calibratedTemperature || 1)), 6);
    const disagreement = learnedTop.candidateId !== heuristicTop.candidateId;
    const explanation = disagreement
        ? buildDisagreementFeatures(model, learnedTop, heuristicTop)
        : { reason: undefined, topFeatures: undefined };

    return {
        model,
        candidates,
        heuristicRanked,
        learnedRanked,
        heuristicTopMargin,
        learnedTopMargin,
        learnedConfidence,
        disagreement,
        explanation,
        evaluatedAt: new Date().toISOString(),
    };
}

function buildStructureShadowRerankerResult(
    songId: string,
    ranking: ComputedStructureShadowRanking,
    scorePaths: string[],
): StructureShadowRerankerResult {
    const heuristicTop = ranking.heuristicRanked[0];
    const learnedTop = ranking.learnedRanked[0];

    return {
        songId,
        snapshotId: ranking.model.snapshotId,
        candidateCount: ranking.candidates.length,
        heuristicTopCandidateId: heuristicTop.candidateId,
        learnedTopCandidateId: learnedTop.candidateId,
        confidence: ranking.learnedConfidence,
        disagreement: ranking.disagreement,
        scorePaths,
        ...(ranking.explanation.reason ? { reason: ranking.explanation.reason } : {}),
        ...(ranking.explanation.topFeatures ? { topFeatures: ranking.explanation.topFeatures } : {}),
    };
}

export function inspectStructureRerankerShadow(songId: string): StructureShadowRerankerResult | null {
    try {
        const ranking = computeStructureShadowRanking(songId);
        if (!ranking) {
            return null;
        }

        return buildStructureShadowRerankerResult(songId, ranking, []);
    } catch (error) {
        logger.warn("Structure shadow reranker inspection failed; continuing with heuristic selection only", {
            songId,
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export function runStructureRerankerShadowScoring(songId: string): StructureShadowRerankerResult | null {
    try {
        const ranking = computeStructureShadowRanking(songId);
        if (!ranking) {
            return null;
        }

        const {
            model,
            candidates,
            heuristicRanked,
            learnedRanked,
            heuristicTopMargin,
            learnedTopMargin,
            learnedConfidence,
            disagreement,
            explanation,
            evaluatedAt,
        } = ranking;
        const heuristicTop = heuristicRanked[0];
        const learnedTop = learnedRanked[0];

        const heuristicRanks = new Map(heuristicRanked.map((candidate, index) => [candidate.candidateId, index + 1]));
        const learnedRanks = new Map(learnedRanked.map((candidate, index) => [candidate.candidateId, index + 1]));
        const scorePaths: string[] = [];

        for (const candidate of candidates) {
            const score: StructureCandidateRerankerScore = {
                version: 1,
                type: "structure_shadow_reranker",
                songId,
                candidateId: candidate.candidateId,
                evaluatedAt,
                scorer: {
                    snapshotId: model.snapshotId,
                    modelPath: model.modelPath,
                    calibratedTemperature: round(model.calibratedTemperature, 6),
                    featureCount: model.featureNames.length,
                },
                heuristic: {
                    score: round(candidate.heuristicScore, 6),
                    rank: heuristicRanks.get(candidate.candidateId) ?? candidates.length,
                    topCandidateId: heuristicTop.candidateId,
                    topMargin: heuristicTopMargin,
                },
                learned: {
                    score: round(candidate.learnedScore, 6),
                    rank: learnedRanks.get(candidate.candidateId) ?? candidates.length,
                    topCandidateId: learnedTop.candidateId,
                    topMargin: learnedTopMargin,
                    confidence: learnedConfidence,
                },
                disagreement: {
                    disagrees: disagreement,
                    heuristicTopCandidateId: heuristicTop.candidateId,
                    learnedTopCandidateId: learnedTop.candidateId,
                    reason: explanation.reason,
                    topFeatures: explanation.topFeatures,
                },
            };
            saveStructureCandidateRerankerScore(score);
            scorePaths.push(structureCandidateRerankerScorePath(songId, candidate.candidateId));
        }

        appendStructureShadowHistory({
            kind: "structure_shadow",
            generatedAt: evaluatedAt,
            songId,
            snapshotId: model.snapshotId,
            candidateCount: candidates.length,
            selectedCandidateId: candidates.find((candidate) => candidate.manifest.selected)?.candidateId ?? null,
            heuristicTopCandidateId: heuristicTop.candidateId,
            learnedTopCandidateId: learnedTop.candidateId,
            confidence: learnedConfidence,
            disagreement,
            ...(explanation.reason ? { reason: explanation.reason } : {}),
            scorePaths,
        });

        logger.info("Persisted structure shadow reranker scores", {
            songId,
            snapshotId: model.snapshotId,
            candidateCount: candidates.length,
            heuristicTopCandidateId: heuristicTop.candidateId,
            learnedTopCandidateId: learnedTop.candidateId,
            disagreement,
            learnedConfidence,
        });

        return buildStructureShadowRerankerResult(songId, ranking, scorePaths);
    } catch (error) {
        logger.warn("Structure shadow reranker scoring failed; continuing with heuristic selection only", {
            songId,
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}