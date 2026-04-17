import { v4 as uuidv4 } from "uuid";
import fs from "node:fs";
import path from "node:path";
import { PipelineState, canTransition, isTerminal } from "./states.js";
import type {
    AudioEvaluationReport,
    ComposeExecutionPlan,
    ComposeRequest,
    ComposeResult,
    CompositionPlan,
    JobManifest,
    RevisionDirective,
    SectionArtifactSummary,
    SectionHarmonicRealizationSummary,
    SectionPhraseBreathSummary,
    SectionOrnamentSummary,
    SectionTempoMotionSummary,
    StructureEvaluationReport,
} from "./types.js";
import { buildAudioEvaluation, buildStructureEvaluation } from "./evaluation.js";
import {
    applyRevisionDirectives,
    buildAudioRevisionDirectives,
    buildStructureRevisionDirectives,
    hasExplicitStructureTarget,
    meetsAudioTarget,
    resolveQualityPolicy,
    shouldEnforceAudioTarget,
    shouldRetryAudioAttempt,
    shouldRetryStructureAttempt,
} from "./quality.js";
import { materializeCompositionSketch } from "./sketch.js";
import {
    compareStructureEvaluationsForCandidateSelection,
    scoreStructureEvaluationForCandidateSelection,
} from "./structureSelection.js";
import {
    buildHybridSymbolicCandidateRequests,
    buildHybridSymbolicSelectionReason,
    resolveHybridSymbolicPreferredSelectedModels,
} from "./hybridSymbolicCandidatePool.js";
import { resolveStructureRerankerPromotion } from "./structureRerankerPromotion.js";
import { runStructureRerankerShadowScoring } from "./structureShadowReranker.js";
import { buildExpressionPlanSidecar, mergeExpressionPlanIntoRequest } from "./expressionPlan.js";
import { evaluateCompletedManifest, updateAutonomyPreferencesFromManifest } from "../autonomy/service.js";
import { computePromptHash } from "../autonomy/request.js";
import { buildExecutionPlan, compose, readComposeProgress } from "../composer/index.js";
import { critique } from "../critic/index.js";
import { humanize } from "../humanizer/index.js";
import { mergeRenderedAndStyledArtifacts, render, renderStyledAudio, resolveRequestedAudioDurationSec } from "../render/index.js";
import {
    buildStructureCandidateId,
    markSelectedStructureCandidate,
    saveStructureCandidateSnapshot,
    type StructureCandidatePromotionSummary,
} from "../memory/candidates.js";
import { loadManifest, saveManifest } from "../memory/manifest.js";
import { logger } from "../logging/logger.js";
import { config } from "../config.js";

export interface RunPipelineOptions {
    onManifestUpdate?: (manifest: JobManifest) => void;
}

interface SymbolicAttemptCandidate {
    candidateId: string;
    attempt: number;
    request: ComposeRequest;
    composeResult: ComposeResult;
    executionPlan: ComposeExecutionPlan;
    compositionPlan?: CompositionPlan;
    midiData: Buffer;
    structureEvaluation: StructureEvaluationReport;
}

interface SymbolicRecoveryCheckpoint {
    stage: PipelineState;
    detail: string;
    midiPath?: string;
}

function persistManifest(manifest: JobManifest, onManifestUpdate?: (manifest: JobManifest) => void): void {
    saveManifest(manifest);
    onManifestUpdate?.(manifest);
}

function mergeSectionPhraseBreathSummaries(
    sectionArtifacts: SectionArtifactSummary[] | undefined,
    summaries: SectionPhraseBreathSummary[] | undefined,
): SectionArtifactSummary[] | undefined {
    if (!sectionArtifacts?.length || !summaries?.length) {
        return sectionArtifacts;
    }

    const summaryBySectionId = new Map(summaries.map((summary) => [summary.sectionId, summary]));
    return sectionArtifacts.map((artifact) => {
        const summary = summaryBySectionId.get(artifact.sectionId);
        if (!summary) {
            return artifact;
        }

        return {
            ...artifact,
            phraseBreathSummary: {
                requestedCues: [...summary.requestedCues],
                targetedMeasureCount: summary.targetedMeasureCount,
                realizedMeasureCount: summary.realizedMeasureCount,
                realizedNoteCount: summary.realizedNoteCount,
                ...(summary.averageDurationScale !== undefined ? { averageDurationScale: summary.averageDurationScale } : {}),
                ...(summary.averageTimingJitterScale !== undefined ? { averageTimingJitterScale: summary.averageTimingJitterScale } : {}),
                ...(summary.averageEndingStretchScale !== undefined ? { averageEndingStretchScale: summary.averageEndingStretchScale } : {}),
                ...(summary.peakDurationScaleDelta !== undefined ? { peakDurationScaleDelta: summary.peakDurationScaleDelta } : {}),
                ...(summary.pickupMeasureCount !== undefined ? { pickupMeasureCount: summary.pickupMeasureCount } : {}),
                ...(summary.pickupAverageDurationScale !== undefined ? { pickupAverageDurationScale: summary.pickupAverageDurationScale } : {}),
                ...(summary.pickupAverageTimingJitterScale !== undefined ? { pickupAverageTimingJitterScale: summary.pickupAverageTimingJitterScale } : {}),
                ...(summary.pickupAverageEndingStretchScale !== undefined ? { pickupAverageEndingStretchScale: summary.pickupAverageEndingStretchScale } : {}),
                ...(summary.arrivalMeasureCount !== undefined ? { arrivalMeasureCount: summary.arrivalMeasureCount } : {}),
                ...(summary.arrivalAverageDurationScale !== undefined ? { arrivalAverageDurationScale: summary.arrivalAverageDurationScale } : {}),
                ...(summary.arrivalAverageTimingJitterScale !== undefined ? { arrivalAverageTimingJitterScale: summary.arrivalAverageTimingJitterScale } : {}),
                ...(summary.arrivalAverageEndingStretchScale !== undefined ? { arrivalAverageEndingStretchScale: summary.arrivalAverageEndingStretchScale } : {}),
                ...(summary.releaseMeasureCount !== undefined ? { releaseMeasureCount: summary.releaseMeasureCount } : {}),
                ...(summary.releaseAverageDurationScale !== undefined ? { releaseAverageDurationScale: summary.releaseAverageDurationScale } : {}),
                ...(summary.releaseAverageTimingJitterScale !== undefined ? { releaseAverageTimingJitterScale: summary.releaseAverageTimingJitterScale } : {}),
                ...(summary.releaseAverageEndingStretchScale !== undefined ? { releaseAverageEndingStretchScale: summary.releaseAverageEndingStretchScale } : {}),
                ...(summary.cadenceRecoveryMeasureCount !== undefined ? { cadenceRecoveryMeasureCount: summary.cadenceRecoveryMeasureCount } : {}),
                ...(summary.cadenceRecoveryAverageDurationScale !== undefined ? { cadenceRecoveryAverageDurationScale: summary.cadenceRecoveryAverageDurationScale } : {}),
                ...(summary.cadenceRecoveryAverageTimingJitterScale !== undefined ? { cadenceRecoveryAverageTimingJitterScale: summary.cadenceRecoveryAverageTimingJitterScale } : {}),
                ...(summary.cadenceRecoveryAverageEndingStretchScale !== undefined ? { cadenceRecoveryAverageEndingStretchScale: summary.cadenceRecoveryAverageEndingStretchScale } : {}),
                ...(summary.rubatoAnchorCount !== undefined ? { rubatoAnchorCount: summary.rubatoAnchorCount } : {}),
                ...(summary.rubatoAnchorAverageDurationScale !== undefined ? { rubatoAnchorAverageDurationScale: summary.rubatoAnchorAverageDurationScale } : {}),
                ...(summary.rubatoAnchorAverageTimingJitterScale !== undefined ? { rubatoAnchorAverageTimingJitterScale: summary.rubatoAnchorAverageTimingJitterScale } : {}),
                ...(summary.rubatoAnchorAverageEndingStretchScale !== undefined ? { rubatoAnchorAverageEndingStretchScale: summary.rubatoAnchorAverageEndingStretchScale } : {}),
            },
        };
    });
}

function mergeSectionHarmonicRealizationSummaries(
    sectionArtifacts: SectionArtifactSummary[] | undefined,
    summaries: SectionHarmonicRealizationSummary[] | undefined,
): SectionArtifactSummary[] | undefined {
    if (!sectionArtifacts?.length || !summaries?.length) {
        return sectionArtifacts;
    }

    const summaryBySectionId = new Map(summaries.map((summary) => [summary.sectionId, summary]));
    return sectionArtifacts.map((artifact) => {
        const summary = summaryBySectionId.get(artifact.sectionId);
        if (!summary) {
            return artifact;
        }

        return {
            ...artifact,
            harmonicRealizationSummary: {
                ...(summary.prolongationMode ? { prolongationMode: summary.prolongationMode } : {}),
                ...(summary.requestedTonicizationTargets?.length ? { requestedTonicizationTargets: [...summary.requestedTonicizationTargets] } : {}),
                ...(summary.requestedColorTags?.length ? { requestedColorTags: [...summary.requestedColorTags] } : {}),
                targetedMeasureCount: summary.targetedMeasureCount,
                realizedMeasureCount: summary.realizedMeasureCount,
                realizedNoteCount: summary.realizedNoteCount,
                ...(summary.averageDurationScale !== undefined ? { averageDurationScale: summary.averageDurationScale } : {}),
                ...(summary.averageTimingJitterScale !== undefined ? { averageTimingJitterScale: summary.averageTimingJitterScale } : {}),
                ...(summary.averageEndingStretchScale !== undefined ? { averageEndingStretchScale: summary.averageEndingStretchScale } : {}),
                ...(summary.peakDurationScaleDelta !== undefined ? { peakDurationScaleDelta: summary.peakDurationScaleDelta } : {}),
                ...(summary.prolongationMeasureCount !== undefined ? { prolongationMeasureCount: summary.prolongationMeasureCount } : {}),
                ...(summary.prolongationAverageDurationScale !== undefined ? { prolongationAverageDurationScale: summary.prolongationAverageDurationScale } : {}),
                ...(summary.prolongationAverageTimingJitterScale !== undefined ? { prolongationAverageTimingJitterScale: summary.prolongationAverageTimingJitterScale } : {}),
                ...(summary.prolongationAverageEndingStretchScale !== undefined ? { prolongationAverageEndingStretchScale: summary.prolongationAverageEndingStretchScale } : {}),
                ...(summary.tonicizationMeasureCount !== undefined ? { tonicizationMeasureCount: summary.tonicizationMeasureCount } : {}),
                ...(summary.tonicizationAverageDurationScale !== undefined ? { tonicizationAverageDurationScale: summary.tonicizationAverageDurationScale } : {}),
                ...(summary.tonicizationAverageTimingJitterScale !== undefined ? { tonicizationAverageTimingJitterScale: summary.tonicizationAverageTimingJitterScale } : {}),
                ...(summary.tonicizationAverageEndingStretchScale !== undefined ? { tonicizationAverageEndingStretchScale: summary.tonicizationAverageEndingStretchScale } : {}),
                ...(summary.harmonicColorMeasureCount !== undefined ? { harmonicColorMeasureCount: summary.harmonicColorMeasureCount } : {}),
                ...(summary.harmonicColorAverageDurationScale !== undefined ? { harmonicColorAverageDurationScale: summary.harmonicColorAverageDurationScale } : {}),
                ...(summary.harmonicColorAverageTimingJitterScale !== undefined ? { harmonicColorAverageTimingJitterScale: summary.harmonicColorAverageTimingJitterScale } : {}),
                ...(summary.harmonicColorAverageEndingStretchScale !== undefined ? { harmonicColorAverageEndingStretchScale: summary.harmonicColorAverageEndingStretchScale } : {}),
            },
        };
    });
}

function mergeSectionTempoMotionSummaries(
    sectionArtifacts: SectionArtifactSummary[] | undefined,
    summaries: SectionTempoMotionSummary[] | undefined,
): SectionArtifactSummary[] | undefined {
    if (!sectionArtifacts?.length || !summaries?.length) {
        return sectionArtifacts;
    }

    const summaryBySectionId = new Map(summaries.map((summary) => [summary.sectionId, summary]));
    return sectionArtifacts.map((artifact) => {
        const summary = summaryBySectionId.get(artifact.sectionId);
        if (!summary) {
            return artifact;
        }

        return {
            ...artifact,
            tempoMotionSummary: {
                requestedTags: [...summary.requestedTags],
                targetedMeasureCount: summary.targetedMeasureCount,
                realizedMeasureCount: summary.realizedMeasureCount,
                realizedNoteCount: summary.realizedNoteCount,
                ...(summary.averageDurationScale !== undefined ? { averageDurationScale: summary.averageDurationScale } : {}),
                ...(summary.averageTimingJitterScale !== undefined ? { averageTimingJitterScale: summary.averageTimingJitterScale } : {}),
                ...(summary.averageEndingStretchScale !== undefined ? { averageEndingStretchScale: summary.averageEndingStretchScale } : {}),
                ...(summary.peakDurationScaleDelta !== undefined ? { peakDurationScaleDelta: summary.peakDurationScaleDelta } : {}),
                ...(summary.motionDirection ? { motionDirection: summary.motionDirection } : {}),
            },
        };
    });
}

function mergeSectionOrnamentSummaries(
    sectionArtifacts: SectionArtifactSummary[] | undefined,
    summaries: SectionOrnamentSummary[] | undefined,
): SectionArtifactSummary[] | undefined {
    if (!sectionArtifacts?.length || !summaries?.length) {
        return sectionArtifacts;
    }

    const summaryBySectionId = new Map(summaries.map((summary) => [summary.sectionId, summary]));
    return sectionArtifacts.map((artifact) => {
        const summary = summaryBySectionId.get(artifact.sectionId);
        if (!summary) {
            return artifact;
        }

        return {
            ...artifact,
            ornamentSummary: {
                requestedTags: [...summary.requestedTags],
                explicitlyRealizedTags: [...summary.explicitlyRealizedTags],
                ...(summary.unsupportedTags?.length ? { unsupportedTags: [...summary.unsupportedTags] } : {}),
                targetedEventCount: summary.targetedEventCount,
                realizedEventCount: summary.realizedEventCount,
                realizedNoteCount: summary.realizedNoteCount,
                ...(summary.averageDurationScale !== undefined ? { averageDurationScale: summary.averageDurationScale } : {}),
                ...(summary.averageTimingJitterScale !== undefined ? { averageTimingJitterScale: summary.averageTimingJitterScale } : {}),
                ...(summary.averageEndingStretchScale !== undefined ? { averageEndingStretchScale: summary.averageEndingStretchScale } : {}),
                ...(summary.averageOnsetSpreadBeats !== undefined ? { averageOnsetSpreadBeats: summary.averageOnsetSpreadBeats } : {}),
                ...(summary.peakOnsetSpreadBeats !== undefined ? { peakOnsetSpreadBeats: summary.peakOnsetSpreadBeats } : {}),
                ...(summary.averageGraceLeadInBeats !== undefined ? { averageGraceLeadInBeats: summary.averageGraceLeadInBeats } : {}),
                ...(summary.peakGraceLeadInBeats !== undefined ? { peakGraceLeadInBeats: summary.peakGraceLeadInBeats } : {}),
                ...(summary.averageTrillOscillationCount !== undefined ? { averageTrillOscillationCount: summary.averageTrillOscillationCount } : {}),
                ...(summary.peakTrillOscillationCount !== undefined ? { peakTrillOscillationCount: summary.peakTrillOscillationCount } : {}),
                ...(summary.averageTrillSpanBeats !== undefined ? { averageTrillSpanBeats: summary.averageTrillSpanBeats } : {}),
                ...(summary.peakTrillSpanBeats !== undefined ? { peakTrillSpanBeats: summary.peakTrillSpanBeats } : {}),
                ...(summary.peakDurationScaleDelta !== undefined ? { peakDurationScaleDelta: summary.peakDurationScaleDelta } : {}),
            },
        };
    });
}

function setRuntimeStage(manifest: JobManifest, stage: PipelineState, detail?: string): void {
    const updatedAt = new Date().toISOString();
    const previous = manifest.runtime;

    manifest.runtime = {
        ...previous,
        stage,
        stageStartedAt: previous?.stage === stage ? previous.stageStartedAt : updatedAt,
        updatedAt,
        detail,
    };
    manifest.updatedAt = updatedAt;
    manifest.meta.updatedAt = updatedAt;
}

function applyComposeProgress(manifest: JobManifest, songId: string): boolean {
    const progress = readComposeProgress(songId);
    if (!progress) {
        return false;
    }

    const previous = manifest.runtime?.compose;
    if (previous && JSON.stringify(previous) === JSON.stringify(progress)) {
        return false;
    }

    const updatedAt = progress.updatedAt || new Date().toISOString();
    manifest.runtime = {
        ...manifest.runtime,
        stage: manifest.state,
        stageStartedAt: manifest.runtime?.stage === manifest.state
            ? manifest.runtime.stageStartedAt
            : updatedAt,
        updatedAt,
        detail: progress.detail,
        compose: progress,
    };
    manifest.updatedAt = updatedAt;
    manifest.meta.updatedAt = updatedAt;
    return true;
}

function startComposeProgressWatcher(
    songId: string,
    manifest: JobManifest,
    onManifestUpdate?: (manifest: JobManifest) => void,
): () => void {
    let stopped = false;

    const sync = (force = false) => {
        if (stopped && !force) {
            return;
        }

        if (applyComposeProgress(manifest, songId)) {
            persistManifest(manifest, onManifestUpdate);
        }
    };

    sync();
    const timer = setInterval(sync, 2_000);

    return () => {
        if (stopped) {
            return;
        }
        clearInterval(timer);
        sync(true);
        stopped = true;
    };
}

function transition(manifest: JobManifest, next: PipelineState): void {
    if (!canTransition(manifest.state, next)) {
        throw new Error(`Invalid transition: ${manifest.state} → ${next}`);
    }
    manifest.state = next;
    manifest.updatedAt = new Date().toISOString();
    manifest.meta.updatedAt = manifest.updatedAt;
    manifest.stateHistory.push({ state: next, timestamp: manifest.updatedAt });
    manifest.runtime = {
        ...manifest.runtime,
        stage: next,
        stageStartedAt: manifest.updatedAt,
        updatedAt: manifest.updatedAt,
        detail: undefined,
    };
    logger.info("State transition", { songId: manifest.songId, state: next });
}

function syncRequestWithCompositionPlan(request: ComposeRequest): ComposeRequest {
    const plan = request.compositionPlan;
    if (!plan) {
        return request;
    }

    return {
        ...request,
        key: request.key ?? plan.key,
        tempo: request.tempo ?? plan.tempo,
        form: request.form ?? plan.form,
        durationSec: request.durationSec ?? plan.targetDurationSec,
        workflow: request.workflow ?? plan.workflow,
        plannerVersion: request.plannerVersion ?? plan.version,
        targetInstrumentation: request.targetInstrumentation ?? plan.instrumentation,
    };
}

function applyPlanningMetadata(
    manifest: JobManifest,
    request: ComposeRequest,
    executionPlan?: ComposeExecutionPlan,
    compositionPlan?: CompositionPlan,
): void {
    const plan = compositionPlan ?? request.compositionPlan;
    const selectedModels = executionPlan?.selectedModels ?? request.selectedModels;

    manifest.meta.workflow = executionPlan?.workflow ?? request.workflow ?? plan?.workflow ?? manifest.meta.workflow;
    manifest.meta.plannerVersion = request.plannerVersion ?? plan?.version ?? manifest.meta.plannerVersion;
    manifest.meta.plannedSectionCount = plan?.sections.length ?? manifest.meta.plannedSectionCount;
    manifest.meta.selectedModels = selectedModels ?? manifest.meta.selectedModels;
    manifest.meta.plannerTelemetry = request.plannerTelemetry ?? manifest.meta.plannerTelemetry;
    manifest.meta.key = manifest.meta.key ?? plan?.key;
    manifest.meta.tempo = manifest.meta.tempo ?? plan?.tempo;
    manifest.meta.form = manifest.meta.form ?? plan?.form;
    manifest.meta.inspirationThread = plan?.inspirationThread ?? manifest.meta.inspirationThread;
    manifest.meta.intentRationale = plan?.intentRationale ?? manifest.meta.intentRationale;
    manifest.meta.contrastTarget = plan?.contrastTarget ?? manifest.meta.contrastTarget;
    manifest.meta.riskProfile = plan?.riskProfile ?? manifest.meta.riskProfile;
    manifest.meta.structureVisibility = plan?.structureVisibility ?? manifest.meta.structureVisibility;
    manifest.meta.humanizationStyle = plan?.humanizationStyle ?? manifest.meta.humanizationStyle;
    manifest.expressionPlan = buildExpressionPlanSidecar(plan);
    manifest.compositionSketch = plan?.sketch ?? manifest.compositionSketch;
}

function describeExecutionPlan(executionPlan: ComposeExecutionPlan, compositionPlan?: CompositionPlan): string {
    const sectionCount = compositionPlan?.sections.length ?? 0;
    const measureCount = compositionPlan?.sections.reduce((sum, section) => sum + section.measures, 0) ?? 0;
    const motifCount = compositionPlan?.sketch?.motifDrafts.length ?? 0;
    const cadenceOptions = compositionPlan?.sketch?.cadenceOptions.length ?? 0;
    return `workflow=${executionPlan.workflow}; worker=${executionPlan.composeWorker}; sections=${sectionCount}; measures=${measureCount}; sketchMotifs=${motifCount}; sketchCadences=${cadenceOptions}`;
}

function describeSymbolicStage(
    stage: "critique" | "humanize" | "render",
    executionPlan: ComposeExecutionPlan,
    compositionPlan?: CompositionPlan,
): string {
    const sectionCount = compositionPlan?.sections.length ?? 0;
    if (executionPlan.workflow === "symbolic_plus_audio") {
        return `${stage} stage for structure-first workflow; planned sections=${sectionCount}`;
    }
    return `${stage} stage for symbolic workflow; planned sections=${sectionCount}`;
}

function describeStyledAudioStage(
    executionPlan: ComposeExecutionPlan,
    compositionPlan?: CompositionPlan,
): string {
    const instruments = compositionPlan?.instrumentation.map((instrument) => instrument.name).join(", ") || "default";
    return `styled audio render for workflow=${executionPlan.workflow}; instruments=${instruments}`;
}

function shouldRequireStructurePass(request: ComposeRequest, executionPlan: ComposeExecutionPlan): boolean {
    if (request.evaluationPolicy?.requireStructurePass !== undefined) {
        return request.evaluationPolicy.requireStructurePass;
    }

    return executionPlan.workflow !== "audio_only";
}

function shouldRequireAudioPass(request: ComposeRequest, executionPlan: ComposeExecutionPlan): boolean {
    if (request.evaluationPolicy?.requireAudioPass !== undefined) {
        return request.evaluationPolicy.requireAudioPass;
    }

    return executionPlan.workflow !== "symbolic_only";
}

function initializeQualityControl(manifest: JobManifest, request: ComposeRequest, executionPlan: ComposeExecutionPlan): void {
    manifest.qualityControl = {
        policy: resolveQualityPolicy(request, executionPlan),
        attempts: manifest.qualityControl?.attempts ?? [],
        selectedAttempt: manifest.qualityControl?.selectedAttempt,
        stopReason: manifest.qualityControl?.stopReason,
    };
}

function recordQualityAttempt(
    manifest: JobManifest,
    attempt: number,
    stage: "structure" | "audio",
    evaluation: StructureEvaluationReport | AudioEvaluationReport,
    directives: RevisionDirective[],
): void {
    if (!manifest.qualityControl) {
        return;
    }

    const nextAttempt = {
        attempt,
        stage,
        passed: evaluation.passed,
        score: evaluation.score,
        issues: [...evaluation.issues],
        strengths: [...evaluation.strengths],
        ...(evaluation.metrics ? { metrics: { ...evaluation.metrics } } : {}),
        directives: directives.map((directive) => ({ ...directive })),
        evaluatedAt: new Date().toISOString(),
    };

    const stageOrder: Record<string, number> = {
        structure: 0,
        audio: 1,
    };

    manifest.qualityControl = {
        ...manifest.qualityControl,
        attempts: [
            ...manifest.qualityControl.attempts.filter((entry) => !(entry.attempt === attempt && entry.stage === stage)),
            nextAttempt,
        ].sort((left, right) => (
            left.attempt - right.attempt
            || ((stageOrder[left.stage ?? "audio"] ?? 99) - (stageOrder[right.stage ?? "audio"] ?? 99))
        )),
    };
}

function finalizeQualityControl(manifest: JobManifest, attempt: number | undefined, stopReason: string): void {
    if (!manifest.qualityControl) {
        return;
    }

    manifest.qualityControl = {
        ...manifest.qualityControl,
        selectedAttempt: attempt,
        stopReason,
    };
}

function buildLearnedRerankerPromotionStopReason(
    currentReason: string | undefined,
    heuristicCandidate: SymbolicAttemptCandidate,
    promotedCandidate: SymbolicAttemptCandidate,
    lane: string,
    snapshotId: string,
    confidence: number,
): string {
    const fragments = currentReason ? [currentReason] : [];
    fragments.push(
        `learned reranker promoted attempt ${promotedCandidate.attempt} over heuristic attempt ${heuristicCandidate.attempt} in ${lane} lane (snapshot=${snapshotId}; confidence=${confidence.toFixed(3)})`,
    );
    return fragments.join("; ");
}

function chooseBetterSymbolicCandidate(
    current: SymbolicAttemptCandidate | undefined,
    next: SymbolicAttemptCandidate,
): SymbolicAttemptCandidate {
    if (!current) {
        return next;
    }

    return compareStructureEvaluationsForCandidateSelection(next.structureEvaluation, current.structureEvaluation) > 0
        ? next
        : current;
}

function buildHybridAttemptStopReason(
    currentReason: string | undefined,
    selectedCandidate: SymbolicAttemptCandidate,
    attemptCandidates: SymbolicAttemptCandidate[],
): string {
    return buildHybridSymbolicSelectionReason(
        currentReason,
        {
            candidateId: selectedCandidate.candidateId,
            attempt: selectedCandidate.attempt,
            composeWorker: selectedCandidate.executionPlan.composeWorker,
            structureScore: selectedCandidate.structureEvaluation.score,
            lane: selectedCandidate.composeResult.proposalEvidence?.lane,
        },
        attemptCandidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            attempt: candidate.attempt,
            composeWorker: candidate.executionPlan.composeWorker,
            structureScore: candidate.structureEvaluation.score,
            lane: candidate.composeResult.proposalEvidence?.lane,
        })),
    );
}

function expectedAudioDurationSec(request: ComposeRequest, compositionPlan?: CompositionPlan): number | undefined {
    return resolveRequestedAudioDurationSec({
        ...request,
        ...(compositionPlan ? { compositionPlan } : {}),
    });
}

function songOutputDir(songId: string): string {
    return path.join(config.outputDir, songId);
}

function existingFilePath(filePath: string | undefined): string | undefined {
    const normalized = String(filePath ?? "").trim();
    if (!normalized) {
        return undefined;
    }

    try {
        const stat = fs.statSync(normalized);
        return stat.isFile() && stat.size > 0 ? normalized : undefined;
    } catch {
        return undefined;
    }
}

function applyRecoveryResumeStage(manifest: JobManifest, checkpoint: SymbolicRecoveryCheckpoint): void {
    const updatedAt = new Date().toISOString();

    if (manifest.state !== checkpoint.stage) {
        manifest.state = checkpoint.stage;
        manifest.stateHistory.push({ state: checkpoint.stage, timestamp: updatedAt });
    }

    manifest.updatedAt = updatedAt;
    manifest.meta.updatedAt = updatedAt;
    manifest.runtime = {
        ...manifest.runtime,
        stage: checkpoint.stage,
        stageStartedAt: updatedAt,
        updatedAt,
        detail: checkpoint.detail,
        recovery: {
            recoveredFromRestart: true,
            recoveredAt: updatedAt,
            note: checkpoint.detail,
        },
    };
}

function resolveSymbolicRecoveryCheckpoint(
    manifest: JobManifest,
    executionPlan: ComposeExecutionPlan,
): SymbolicRecoveryCheckpoint | null {
    if (!manifest.runtime?.recovery?.recoveredFromRestart || executionPlan.workflow === "audio_only" || isTerminal(manifest.state)) {
        return null;
    }

    const songDir = songOutputDir(manifest.songId);
    const compositionMidi = existingFilePath(manifest.artifacts.midi) ?? existingFilePath(path.join(songDir, "composition.mid"));
    const humanizedMidi = existingFilePath(path.join(songDir, "humanized.mid"));
    const renderedAudio = existingFilePath(manifest.artifacts.renderedAudio) ?? existingFilePath(path.join(songDir, "output.wav"));

    switch (manifest.state) {
        case PipelineState.HUMANIZE:
            if (compositionMidi && manifest.structureEvaluation) {
                return {
                    stage: PipelineState.HUMANIZE,
                    midiPath: compositionMidi,
                    detail: "Recovered after restart; resuming humanize stage from persisted composition MIDI.",
                };
            }
            return {
                stage: PipelineState.COMPOSE,
                detail: "Recovered after restart; restarting symbolic pipeline from the COMPOSE checkpoint.",
            };
        case PipelineState.RENDER:
            if (humanizedMidi && manifest.structureEvaluation) {
                return {
                    stage: PipelineState.RENDER,
                    midiPath: humanizedMidi,
                    detail: "Recovered after restart; resuming render stage from persisted humanized MIDI.",
                };
            }
            if (compositionMidi && manifest.structureEvaluation) {
                return {
                    stage: PipelineState.HUMANIZE,
                    midiPath: compositionMidi,
                    detail: "Recovered after restart; rebuilding humanized MIDI before rendering.",
                };
            }
            return {
                stage: PipelineState.COMPOSE,
                detail: "Recovered after restart; restarting symbolic pipeline from the COMPOSE checkpoint.",
            };
        case PipelineState.RENDER_AUDIO:
            if (executionPlan.workflow === "symbolic_plus_audio" && renderedAudio && manifest.structureEvaluation) {
                return {
                    stage: PipelineState.RENDER_AUDIO,
                    detail: "Recovered after restart; resuming styled audio render from the existing score-aligned render.",
                };
            }
            if (humanizedMidi && manifest.structureEvaluation) {
                return {
                    stage: PipelineState.RENDER,
                    midiPath: humanizedMidi,
                    detail: "Recovered after restart; rebuilding score-aligned render before styled audio.",
                };
            }
            if (compositionMidi && manifest.structureEvaluation) {
                return {
                    stage: PipelineState.HUMANIZE,
                    midiPath: compositionMidi,
                    detail: "Recovered after restart; rebuilding humanized MIDI before downstream rendering.",
                };
            }
            return {
                stage: PipelineState.COMPOSE,
                detail: "Recovered after restart; restarting symbolic pipeline from the COMPOSE checkpoint.",
            };
        case PipelineState.STORE:
            if (manifest.audioEvaluation) {
                return {
                    stage: PipelineState.STORE,
                    detail: "Recovered after restart; finalizing previously evaluated artifacts.",
                };
            }
            if (executionPlan.workflow === "symbolic_plus_audio" && renderedAudio && manifest.structureEvaluation) {
                return {
                    stage: PipelineState.RENDER_AUDIO,
                    detail: "Recovered after restart; re-running styled audio render before finalize.",
                };
            }
            if (humanizedMidi && manifest.structureEvaluation) {
                return {
                    stage: PipelineState.RENDER,
                    midiPath: humanizedMidi,
                    detail: "Recovered after restart; re-running score-aligned render before finalize.",
                };
            }
            if (compositionMidi && manifest.structureEvaluation) {
                return {
                    stage: PipelineState.HUMANIZE,
                    midiPath: compositionMidi,
                    detail: "Recovered after restart; rebuilding symbolic assets before finalize.",
                };
            }
            return {
                stage: PipelineState.COMPOSE,
                detail: "Recovered after restart; restarting symbolic pipeline from the COMPOSE checkpoint.",
            };
        default:
            return null;
    }
}

export async function runPipeline(request: ComposeRequest, options?: RunPipelineOptions): Promise<JobManifest> {
    const now = new Date().toISOString();
    const songId = request.songId ?? uuidv4();
    const recoveredManifest = request.recoveredFromRestart && request.songId
        ? loadManifest(request.songId)
        : null;
    if (recoveredManifest?.expressionPlan) {
        request = mergeExpressionPlanIntoRequest(request, recoveredManifest.expressionPlan);
    }
    const promptHash = request.promptHash ?? computePromptHash(request);

    const manifest: JobManifest = recoveredManifest
        ? {
            ...recoveredManifest,
            songId,
            meta: {
                ...recoveredManifest.meta,
                songId,
                prompt: request.prompt,
                key: request.key ?? recoveredManifest.meta.key,
                tempo: request.tempo ?? recoveredManifest.meta.tempo,
                form: request.form ?? recoveredManifest.meta.form,
                source: request.source ?? recoveredManifest.meta.source ?? "api",
                autonomyRunId: request.autonomyRunId ?? recoveredManifest.meta.autonomyRunId,
                promptHash,
                updatedAt: now,
            },
            updatedAt: now,
            runtime: {
                ...recoveredManifest.runtime,
                stage: recoveredManifest.state,
                stageStartedAt: recoveredManifest.runtime?.stage === recoveredManifest.state
                    ? recoveredManifest.runtime.stageStartedAt
                    : now,
                updatedAt: now,
                detail: request.recoveryNote ?? recoveredManifest.runtime?.detail,
                recovery: {
                    recoveredFromRestart: true,
                    recoveredAt: now,
                    note: request.recoveryNote ?? "Recovered pipeline state after restart",
                },
            },
        }
        : {
            songId,
            state: PipelineState.IDLE,
            meta: {
                songId,
                prompt: request.prompt,
                key: request.key,
                tempo: request.tempo,
                form: request.form,
                source: request.source ?? "api",
                autonomyRunId: request.autonomyRunId,
                promptHash,
                createdAt: now,
                updatedAt: now,
            },
            artifacts: {},
            approvalStatus: request.source === "autonomy" ? "pending" : "not_required",
            runtime: {
                stage: PipelineState.IDLE,
                stageStartedAt: now,
                updatedAt: now,
                ...(request.recoveredFromRestart ? {
                    recovery: {
                        recoveredFromRestart: true,
                        recoveredAt: now,
                        note: request.recoveryNote ?? "Recovered pipeline state after restart",
                    },
                } : {}),
            },
            stateHistory: [{ state: PipelineState.IDLE, timestamp: now }],
            updatedAt: now,
        };

    applyPlanningMetadata(manifest, request);

    persistManifest(manifest, options?.onManifestUpdate);

    let midiData: Buffer = Buffer.alloc(0);

    try {
        request = { ...request, songId };

        request = materializeCompositionSketch(syncRequestWithCompositionPlan(request));
        applyPlanningMetadata(manifest, request);

        const requestedExecutionPlan = buildExecutionPlan(request);
        initializeQualityControl(manifest, request, requestedExecutionPlan);
        let symbolicRecoveryCheckpoint = resolveSymbolicRecoveryCheckpoint(manifest, requestedExecutionPlan);
        if (symbolicRecoveryCheckpoint) {
            applyRecoveryResumeStage(manifest, symbolicRecoveryCheckpoint);
        }
        persistManifest(manifest, options?.onManifestUpdate);

        // COMPOSE
        if (manifest.state === PipelineState.IDLE) {
            transition(manifest, PipelineState.COMPOSE);
            setRuntimeStage(manifest, PipelineState.COMPOSE, describeExecutionPlan(requestedExecutionPlan, request.compositionPlan));
        } else if (manifest.state === PipelineState.COMPOSE) {
            setRuntimeStage(manifest, PipelineState.COMPOSE, request.recoveryNote ?? describeExecutionPlan(requestedExecutionPlan, request.compositionPlan));
        }
        persistManifest(manifest, options?.onManifestUpdate);

        let effectiveExecutionPlan = requestedExecutionPlan;
        let effectiveCompositionPlan = request.compositionPlan;
        let activeRequest: ComposeRequest = {
            ...request,
            attemptIndex: request.attemptIndex ?? 1,
        };
        let composeResult: ComposeResult | undefined;
        let symbolicAttempt = Math.max(activeRequest.attemptIndex ?? 1, 1);
        let selectedSymbolicCandidate: SymbolicAttemptCandidate | undefined;
        let bestSymbolicCandidate: SymbolicAttemptCandidate | undefined;
        let symbolicCandidates: SymbolicAttemptCandidate[] = [];

        qualityRevisionLoop: while (true) {
            const activeRecoveryCheckpoint = symbolicRecoveryCheckpoint;
            const shouldResumeRecoveredSymbolicStage = Boolean(
                activeRecoveryCheckpoint
                && activeRecoveryCheckpoint.stage !== PipelineState.COMPOSE
                && effectiveExecutionPlan.workflow !== "audio_only",
            );
            symbolicRecoveryCheckpoint = null;

            selectedSymbolicCandidate = undefined;
            bestSymbolicCandidate = undefined;
            symbolicCandidates = [];

            if (shouldResumeRecoveredSymbolicStage) {
                if (!manifest.structureEvaluation) {
                    throw new Error("Recovered symbolic checkpoint is missing structure evaluation.");
                }

                const recoveryAttempt = manifest.qualityControl?.selectedAttempt ?? activeRequest.attemptIndex ?? 1;
                activeRequest = {
                    ...activeRequest,
                    workflow: effectiveExecutionPlan.workflow,
                    selectedModels: effectiveExecutionPlan.selectedModels,
                    compositionPlan: effectiveCompositionPlan,
                    plannerVersion: activeRequest.plannerVersion ?? effectiveCompositionPlan?.version,
                    attemptIndex: recoveryAttempt,
                };
                request = activeRequest;
                composeResult = {
                    meta: { ...manifest.meta },
                    compositionPlan: effectiveCompositionPlan,
                    executionPlan: effectiveExecutionPlan,
                    sectionArtifacts: manifest.sectionArtifacts?.map((entry) => ({ ...entry })),
                    sectionTransforms: manifest.sectionTransforms?.map((entry) => ({ ...entry })),
                    sectionTonalities: manifest.sectionTonalities?.map((entry) => ({ ...entry })),
                };
                selectedSymbolicCandidate = {
                    candidateId: buildStructureCandidateId(recoveryAttempt, effectiveExecutionPlan),
                    attempt: recoveryAttempt,
                    request: activeRequest,
                    composeResult,
                    executionPlan: effectiveExecutionPlan,
                    compositionPlan: effectiveCompositionPlan,
                    midiData: activeRecoveryCheckpoint?.midiPath ? fs.readFileSync(activeRecoveryCheckpoint.midiPath) : Buffer.alloc(0),
                    structureEvaluation: manifest.structureEvaluation,
                };
                bestSymbolicCandidate = selectedSymbolicCandidate;
                symbolicCandidates = [selectedSymbolicCandidate];
                logger.info("Resuming symbolic pipeline from recovered checkpoint", {
                    songId: manifest.songId,
                    stage: activeRecoveryCheckpoint?.stage,
                    attempt: recoveryAttempt,
                });
            } else {
                while (true) {
                    composeResult = undefined;
                    const hybridPreferredSelectedModels = resolveHybridSymbolicPreferredSelectedModels(
                        activeRequest,
                        effectiveExecutionPlan,
                        effectiveCompositionPlan,
                    );
                    const attemptCandidateRequests = buildHybridSymbolicCandidateRequests(
                        activeRequest,
                        effectiveExecutionPlan,
                        effectiveCompositionPlan,
                    );
                    const attemptCandidates: SymbolicAttemptCandidate[] = [];
                    const composeFailureMessages: string[] = [];

                    for (const candidateVariant of attemptCandidateRequests) {
                        let candidateComposeResult: ComposeResult | undefined;
                        let composeError: unknown;
                        const stopComposeWatcher = startComposeProgressWatcher(songId, manifest, options?.onManifestUpdate);
                        try {
                            candidateComposeResult = await compose(candidateVariant.request);
                        } catch (error) {
                            composeError = error;
                        } finally {
                            stopComposeWatcher();
                        }

                        if (composeError) {
                            const message = composeError instanceof Error ? composeError.message : String(composeError);
                            composeFailureMessages.push(message);
                            logger.warn("Symbolic candidate compose failed; continuing with remaining candidates if available", {
                                songId: manifest.songId,
                                attempt: symbolicAttempt,
                                variant: candidateVariant.variant,
                                error: message,
                            });
                            continue;
                        }

                        if (!candidateComposeResult) {
                            composeFailureMessages.push("Compose step returned no result");
                            continue;
                        }

                        const candidateExecutionPlan = candidateComposeResult.executionPlan ?? buildExecutionPlan(candidateVariant.request);
                        const candidateCompositionPlan = candidateComposeResult.compositionPlan ?? candidateVariant.request.compositionPlan;

                        manifest.songId = candidateComposeResult.meta.songId ?? manifest.songId;

                        if (candidateComposeResult.isRendered || candidateExecutionPlan.workflow === "audio_only") {
                            composeResult = candidateComposeResult;
                            effectiveExecutionPlan = candidateExecutionPlan;
                            effectiveCompositionPlan = candidateCompositionPlan;
                            activeRequest = {
                                ...activeRequest,
                                workflow: effectiveExecutionPlan.workflow,
                                selectedModels: hybridPreferredSelectedModels ?? effectiveExecutionPlan.selectedModels,
                                compositionPlan: effectiveCompositionPlan,
                                plannerVersion: activeRequest.plannerVersion ?? effectiveCompositionPlan?.version,
                            };
                            manifest.meta = { ...manifest.meta, ...composeResult.meta } as JobManifest["meta"];
                            manifest.meta.songId = manifest.songId;
                            manifest.sectionArtifacts = composeResult.sectionArtifacts?.map((entry) => ({ ...entry }));
                            manifest.sectionTransforms = composeResult.sectionTransforms?.map((entry) => ({ ...entry }));
                            manifest.sectionTonalities = composeResult.sectionTonalities?.map((entry) => ({ ...entry }));
                            initializeQualityControl(manifest, activeRequest, effectiveExecutionPlan);
                            applyPlanningMetadata(manifest, activeRequest, effectiveExecutionPlan, effectiveCompositionPlan);
                            applyComposeProgress(manifest, songId);
                            persistManifest(manifest, options?.onManifestUpdate);
                            finalizeQualityControl(manifest, undefined, "Audio-first workflow skips symbolic revision attempts.");
                            persistManifest(manifest, options?.onManifestUpdate);
                            break;
                        }

                        const candidateMidiData = candidateComposeResult.midiData ?? Buffer.alloc(0);

                        logger.info("Running symbolic structure evaluation", {
                            songId: manifest.songId,
                            workflow: candidateExecutionPlan.workflow,
                            sectionCount: candidateCompositionPlan?.sections.length,
                            attempt: symbolicAttempt,
                            worker: candidateExecutionPlan.composeWorker,
                            variant: candidateVariant.variant,
                        });

                        if (manifest.state === PipelineState.COMPOSE) {
                            transition(manifest, PipelineState.CRITIQUE);
                        }
                        setRuntimeStage(
                            manifest,
                            PipelineState.CRITIQUE,
                            `${describeSymbolicStage("critique", candidateExecutionPlan, candidateCompositionPlan)}; attempt=${symbolicAttempt}; worker=${candidateExecutionPlan.composeWorker}`,
                        );
                        persistManifest(manifest, options?.onManifestUpdate);

                        const critiqueResult = await critique(candidateMidiData, manifest.songId, {
                            key: candidateComposeResult.meta.key ?? manifest.meta.key,
                            form: candidateCompositionPlan?.form ?? candidateComposeResult.meta.form ?? manifest.meta.form,
                            meter: candidateCompositionPlan?.meter,
                            sections: candidateCompositionPlan?.sections,
                            longSpanForm: candidateCompositionPlan?.longSpanForm,
                        });
                        const structureEvaluation = buildStructureEvaluation(critiqueResult, {
                            sections: candidateCompositionPlan?.sections,
                            sectionArtifacts: candidateComposeResult.sectionArtifacts,
                            expressionDefaults: candidateCompositionPlan?.expressionDefaults,
                            longSpanForm: candidateCompositionPlan?.longSpanForm,
                            orchestration: candidateCompositionPlan?.orchestration,
                        });
                        const candidateQualityPolicy = manifest.qualityControl?.policy ?? resolveQualityPolicy(candidateVariant.request, candidateExecutionPlan);
                        const candidateRetryNeeded = shouldRetryStructureAttempt(
                            structureEvaluation,
                            symbolicAttempt,
                            candidateQualityPolicy,
                            candidateVariant.request,
                        );
                        const candidateRevisionDirectives = candidateRetryNeeded
                            ? buildStructureRevisionDirectives(
                                structureEvaluation,
                                candidateQualityPolicy.targetStructureScore,
                                candidateVariant.request,
                            )
                            : [];

                        const candidate: SymbolicAttemptCandidate = {
                            candidateId: buildStructureCandidateId(symbolicAttempt, candidateExecutionPlan),
                            attempt: symbolicAttempt,
                            request: candidateVariant.request,
                            composeResult: candidateComposeResult,
                            executionPlan: candidateExecutionPlan,
                            compositionPlan: candidateCompositionPlan,
                            midiData: candidateMidiData,
                            structureEvaluation,
                        };
                        attemptCandidates.push(candidate);
                        symbolicCandidates = [
                            ...symbolicCandidates.filter((entry) => entry.candidateId !== candidate.candidateId),
                            candidate,
                        ];
                        saveStructureCandidateSnapshot({
                            songId: manifest.songId,
                            candidateId: candidate.candidateId,
                            attempt: candidate.attempt,
                            meta: {
                                ...manifest.meta,
                                ...candidateComposeResult.meta,
                                songId: manifest.songId,
                            },
                            executionPlan: candidate.executionPlan,
                            compositionPlan: candidate.compositionPlan,
                            qualityPolicy: candidateQualityPolicy,
                            revisionDirectives: candidate.request.revisionDirectives,
                            structureEvaluation: candidate.structureEvaluation,
                            proposalEvidence: candidateComposeResult.proposalEvidence,
                            sectionArtifacts: candidateComposeResult.sectionArtifacts,
                            sectionTonalities: candidateComposeResult.sectionTonalities,
                            sectionTransforms: candidateComposeResult.sectionTransforms,
                            midiData: candidate.midiData,
                            evaluatedAt: manifest.updatedAt,
                        });
                        bestSymbolicCandidate = chooseBetterSymbolicCandidate(bestSymbolicCandidate, candidate);
                    }

                    if (composeResult?.isRendered || effectiveExecutionPlan.workflow === "audio_only") {
                        break;
                    }

                    if (attemptCandidates.length === 0) {
                        if (bestSymbolicCandidate && symbolicAttempt > 1) {
                            const message = composeFailureMessages.join("; ") || "all symbolic candidates failed";
                            logger.warn("Revision compose attempt failed — using best earlier symbolic draft", {
                                songId: manifest.songId,
                                attempt: symbolicAttempt,
                                fallbackAttempt: bestSymbolicCandidate.attempt,
                                error: message,
                            });
                            selectedSymbolicCandidate = bestSymbolicCandidate;
                            finalizeQualityControl(
                                manifest,
                                bestSymbolicCandidate.attempt,
                                `revision attempt ${symbolicAttempt} failed; reused attempt ${bestSymbolicCandidate.attempt}`,
                            );
                            persistManifest(manifest, options?.onManifestUpdate);
                            break;
                        }

                        throw new Error(composeFailureMessages[0] ?? "No symbolic candidate survived compose step");
                    }

                    const attemptWinner = attemptCandidates.reduce<SymbolicAttemptCandidate | undefined>(
                        (current, candidate) => chooseBetterSymbolicCandidate(current, candidate),
                        undefined,
                    ) ?? attemptCandidates[0];

                    composeResult = attemptWinner.composeResult;
                    effectiveExecutionPlan = attemptWinner.executionPlan;
                    effectiveCompositionPlan = attemptWinner.compositionPlan;
                    activeRequest = {
                        ...activeRequest,
                        workflow: effectiveExecutionPlan.workflow,
                        selectedModels: hybridPreferredSelectedModels ?? effectiveExecutionPlan.selectedModels,
                        compositionPlan: effectiveCompositionPlan,
                        plannerVersion: activeRequest.plannerVersion ?? effectiveCompositionPlan?.version,
                    };
                    request = activeRequest;

                    manifest.songId = composeResult.meta.songId ?? manifest.songId;
                    manifest.meta = { ...manifest.meta, ...composeResult.meta } as JobManifest["meta"];
                    manifest.meta.songId = manifest.songId;
                    manifest.sectionArtifacts = composeResult.sectionArtifacts?.map((entry) => ({ ...entry }));
                    manifest.sectionTransforms = composeResult.sectionTransforms?.map((entry) => ({ ...entry }));
                    manifest.sectionTonalities = composeResult.sectionTonalities?.map((entry) => ({ ...entry }));
                    initializeQualityControl(manifest, activeRequest, effectiveExecutionPlan);
                    applyPlanningMetadata(manifest, attemptWinner.request, effectiveExecutionPlan, effectiveCompositionPlan);
                    applyComposeProgress(manifest, songId);
                    persistManifest(manifest, options?.onManifestUpdate);

                    const qualityPolicy = manifest.qualityControl?.policy ?? resolveQualityPolicy(activeRequest, effectiveExecutionPlan);
                    const retryNeeded = shouldRetryStructureAttempt(
                        attemptWinner.structureEvaluation,
                        symbolicAttempt,
                        qualityPolicy,
                        activeRequest,
                    );
                    const revisionDirectives = retryNeeded
                        ? buildStructureRevisionDirectives(attemptWinner.structureEvaluation, qualityPolicy.targetStructureScore, activeRequest)
                        : [];

                    manifest.structureEvaluation = attemptWinner.structureEvaluation;
                    recordQualityAttempt(manifest, symbolicAttempt, "structure", attemptWinner.structureEvaluation, revisionDirectives);
                    persistManifest(manifest, options?.onManifestUpdate);

                    if (!retryNeeded || revisionDirectives.length === 0) {
                        selectedSymbolicCandidate = bestSymbolicCandidate ?? attemptWinner;
                        const stopReason = retryNeeded && revisionDirectives.length === 0
                            ? "structure evaluation requested another pass but yielded no revision directives"
                            : (attemptWinner.structureEvaluation.passed
                                ? "structure evaluation accepted the symbolic draft"
                                : "reached the final structure attempt");
                        finalizeQualityControl(
                            manifest,
                            selectedSymbolicCandidate.attempt,
                            selectedSymbolicCandidate.attempt === symbolicAttempt
                                ? buildHybridAttemptStopReason(stopReason, selectedSymbolicCandidate, attemptCandidates)
                                : stopReason,
                        );
                        persistManifest(manifest, options?.onManifestUpdate);
                        break;
                    }

                    logger.info("Retrying symbolic compose from structure feedback", {
                        songId: manifest.songId,
                        attempt: symbolicAttempt,
                        nextAttempt: symbolicAttempt + 1,
                        directives: revisionDirectives.map((directive) => directive.kind),
                    });

                    const revisedRequestBase = applyRevisionDirectives({
                        ...activeRequest,
                        workflow: effectiveExecutionPlan.workflow,
                        selectedModels: hybridPreferredSelectedModels ?? effectiveExecutionPlan.selectedModels,
                        compositionPlan: effectiveCompositionPlan,
                        sectionArtifacts: attemptWinner.composeResult.sectionArtifacts?.map((entry) => ({ ...entry })),
                        plannerVersion: activeRequest.plannerVersion ?? effectiveCompositionPlan?.version,
                    }, revisionDirectives, symbolicAttempt + 1);

                    activeRequest = {
                        ...materializeCompositionSketch(revisedRequestBase),
                        promptHash: computePromptHash(revisedRequestBase),
                    };
                    request = activeRequest;
                    const nextExecutionPlan = buildExecutionPlan(activeRequest);
                    applyPlanningMetadata(manifest, activeRequest, nextExecutionPlan, activeRequest.compositionPlan);
                    transition(manifest, PipelineState.COMPOSE);
                    setRuntimeStage(
                        manifest,
                        PipelineState.COMPOSE,
                        `${describeExecutionPlan(nextExecutionPlan, activeRequest.compositionPlan)}; attempt=${symbolicAttempt + 1}; revisions=${revisionDirectives.map((directive) => directive.kind).join(",")}`,
                    );
                    persistManifest(manifest, options?.onManifestUpdate);
                    symbolicAttempt += 1;
                }
            }

            request = activeRequest;

            if (composeResult?.isRendered || effectiveExecutionPlan.workflow === "audio_only") {
                logger.info("MusicGen pre-rendered audio detected — skipping CRITIQUE/HUMANIZE/RENDER", {
                    songId: manifest.songId,
                    workflow: effectiveExecutionPlan.workflow,
                });
                manifest.artifacts = composeResult?.artifacts ?? {};
                manifest.audioEvaluation = buildAudioEvaluation(manifest.artifacts, effectiveExecutionPlan.workflow, {
                    expectedDurationSec: expectedAudioDurationSec(request, effectiveCompositionPlan),
                    structureEvaluation: manifest.structureEvaluation,
                    sections: effectiveCompositionPlan?.sections,
                    sectionTonalities: manifest.sectionTonalities,
                    sectionArtifacts: manifest.sectionArtifacts,
                });

                const audioAttempt = request.attemptIndex ?? 1;
                const audioPolicy = manifest.qualityControl?.policy ?? resolveQualityPolicy(request, effectiveExecutionPlan);
                const audioRevisionDirectives = buildAudioRevisionDirectives(
                    manifest.audioEvaluation,
                    audioPolicy.targetAudioScore,
                    request,
                    manifest.structureEvaluation,
                );
                recordQualityAttempt(manifest, audioAttempt, "audio", manifest.audioEvaluation, audioRevisionDirectives);
                finalizeQualityControl(
                    manifest,
                    audioAttempt,
                    manifest.audioEvaluation.passed
                        ? "audio render completed and was evaluated"
                        : "audio render completed but failed evaluation",
                );
                persistManifest(manifest, options?.onManifestUpdate);

                if (shouldRequireAudioPass(request, effectiveExecutionPlan) && !manifest.audioEvaluation.passed) {
                    transition(manifest, PipelineState.FAILED);
                    manifest.errorCode = "AUDIO_EVALUATION_FAILED";
                    manifest.errorMessage = manifest.audioEvaluation.issues.join("; ");
                    persistManifest(manifest, options?.onManifestUpdate);
                    return manifest;
                }

                if (shouldEnforceAudioTarget(request, effectiveExecutionPlan, audioPolicy) && !meetsAudioTarget(manifest.audioEvaluation, audioPolicy)) {
                    transition(manifest, PipelineState.FAILED);
                    manifest.errorCode = "AUDIO_TARGET_NOT_MET";
                    manifest.errorMessage = `audio score ${manifest.audioEvaluation.score ?? 0} below target ${audioPolicy.targetAudioScore}`;
                    persistManifest(manifest, options?.onManifestUpdate);
                    return manifest;
                }
            } else {
                const heuristicResolvedCandidate = selectedSymbolicCandidate ?? bestSymbolicCandidate;
                if (!heuristicResolvedCandidate) {
                    throw new Error("No symbolic draft survived structure evaluation");
                }

                let resolvedCandidate = heuristicResolvedCandidate;
                const promotion = resolveStructureRerankerPromotion({
                    songId: manifest.songId,
                    currentCandidateId: heuristicResolvedCandidate.candidateId,
                    candidates: symbolicCandidates,
                    request: heuristicResolvedCandidate.request,
                    executionPlan: heuristicResolvedCandidate.executionPlan,
                    compositionPlan: heuristicResolvedCandidate.compositionPlan,
                    qualityPolicy: manifest.qualityControl?.policy,
                    requireStructurePass: shouldRequireStructurePass(
                        heuristicResolvedCandidate.request,
                        heuristicResolvedCandidate.executionPlan,
                    ),
                    explicitStructureTarget: hasExplicitStructureTarget(heuristicResolvedCandidate.request),
                });
                let appliedPromotion: StructureCandidatePromotionSummary | undefined;
                if (promotion) {
                    const promotedCandidate = symbolicCandidates.find(
                        (candidate) => candidate.candidateId === promotion.candidateId,
                    );
                    if (promotedCandidate) {
                        logger.info("Promoted symbolic candidate via learned reranker", {
                            songId: manifest.songId,
                            lane: promotion.lane,
                            snapshotId: promotion.snapshotId,
                            heuristicCandidateId: heuristicResolvedCandidate.candidateId,
                            heuristicAttempt: heuristicResolvedCandidate.attempt,
                            learnedCandidateId: promotedCandidate.candidateId,
                            learnedAttempt: promotedCandidate.attempt,
                            confidence: promotion.confidence,
                        });
                        finalizeQualityControl(
                            manifest,
                            promotedCandidate.attempt,
                            buildLearnedRerankerPromotionStopReason(
                                manifest.qualityControl?.stopReason,
                                heuristicResolvedCandidate,
                                promotedCandidate,
                                promotion.lane,
                                promotion.snapshotId,
                                promotion.confidence,
                            ),
                        );
                        appliedPromotion = {
                            appliedAt: new Date().toISOString(),
                            lane: promotion.lane,
                            snapshotId: promotion.snapshotId,
                            confidence: promotion.confidence,
                            heuristicTopCandidateId: promotion.heuristicTopCandidateId,
                            learnedTopCandidateId: promotion.learnedTopCandidateId,
                            heuristicAttempt: heuristicResolvedCandidate.attempt,
                            learnedAttempt: promotedCandidate.attempt,
                            ...(promotion.reason ? { reason: promotion.reason } : {}),
                        };
                        resolvedCandidate = promotedCandidate;
                    }
                }

                const resumeStage = activeRecoveryCheckpoint?.stage;

                composeResult = resolvedCandidate.composeResult;
                effectiveExecutionPlan = resolvedCandidate.executionPlan;
                effectiveCompositionPlan = resolvedCandidate.compositionPlan;
                request = resolvedCandidate.request;
                midiData = resolvedCandidate.midiData;
                manifest.meta = { ...manifest.meta, ...composeResult.meta } as JobManifest["meta"];
                manifest.meta.songId = manifest.songId;
                manifest.sectionArtifacts = composeResult.sectionArtifacts?.map((entry) => ({ ...entry }));
                manifest.sectionTransforms = composeResult.sectionTransforms?.map((entry) => ({ ...entry }));
                manifest.sectionTonalities = composeResult.sectionTonalities?.map((entry) => ({ ...entry }));
                applyPlanningMetadata(manifest, request, effectiveExecutionPlan, effectiveCompositionPlan);
                manifest.structureEvaluation = resolvedCandidate.structureEvaluation;
                saveStructureCandidateSnapshot({
                    songId: manifest.songId,
                    candidateId: resolvedCandidate.candidateId,
                    attempt: resolvedCandidate.attempt,
                    meta: manifest.meta,
                    executionPlan: resolvedCandidate.executionPlan,
                    compositionPlan: resolvedCandidate.compositionPlan,
                    qualityPolicy: manifest.qualityControl?.policy,
                    revisionDirectives: resolvedCandidate.request.revisionDirectives,
                    structureEvaluation: resolvedCandidate.structureEvaluation,
                    proposalEvidence: composeResult.proposalEvidence,
                    sectionArtifacts: composeResult.sectionArtifacts,
                    sectionTonalities: composeResult.sectionTonalities,
                    sectionTransforms: composeResult.sectionTransforms,
                    midiData: resolvedCandidate.midiData,
                    evaluatedAt: manifest.updatedAt,
                });
                markSelectedStructureCandidate(
                    manifest.songId,
                    resolvedCandidate.candidateId,
                    resolvedCandidate.attempt,
                    manifest.qualityControl?.stopReason,
                    appliedPromotion,
                );
                runStructureRerankerShadowScoring(manifest.songId);

                if (!resumeStage) {
                    if (manifest.state === PipelineState.COMPOSE) {
                        transition(manifest, PipelineState.CRITIQUE);
                    }
                    setRuntimeStage(
                        manifest,
                        PipelineState.CRITIQUE,
                        `Selected symbolic draft from attempt ${resolvedCandidate.attempt}`,
                    );
                    persistManifest(manifest, options?.onManifestUpdate);
                } else if (resumeStage) {
                    setRuntimeStage(
                        manifest,
                        resumeStage,
                        activeRecoveryCheckpoint?.detail ?? `Recovered symbolic checkpoint at ${resumeStage}`,
                    );
                    persistManifest(manifest, options?.onManifestUpdate);
                }

                if (!resolvedCandidate.structureEvaluation.passed && shouldRequireStructurePass(request, effectiveExecutionPlan)) {
                    transition(manifest, PipelineState.FAILED);
                    manifest.errorCode = "CRITIQUE_REJECTED";
                    manifest.errorMessage = resolvedCandidate.structureEvaluation.issues.join("; ");
                    persistManifest(manifest, options?.onManifestUpdate);
                    return manifest;
                }

                if (
                    hasExplicitStructureTarget(request)
                    && manifest.qualityControl?.policy.targetStructureScore !== undefined
                    && (resolvedCandidate.structureEvaluation.score ?? 0) < manifest.qualityControl.policy.targetStructureScore
                ) {
                    transition(manifest, PipelineState.FAILED);
                    manifest.errorCode = "STRUCTURE_TARGET_NOT_MET";
                    manifest.errorMessage = `structure score ${resolvedCandidate.structureEvaluation.score ?? 0} below target ${manifest.qualityControl.policy.targetStructureScore}`;
                    persistManifest(manifest, options?.onManifestUpdate);
                    return manifest;
                }

                logger.info("Running symbolic post-compose stages", {
                    songId: manifest.songId,
                    workflow: effectiveExecutionPlan.workflow,
                    sectionCount: effectiveCompositionPlan?.sections.length,
                    selectedAttempt: resolvedCandidate.attempt,
                    structureScore: resolvedCandidate.structureEvaluation.score,
                    resumeStage: resumeStage ?? null,
                });

                if (!resumeStage || resumeStage === PipelineState.HUMANIZE) {
                    if (manifest.state === PipelineState.CRITIQUE) {
                        transition(manifest, PipelineState.HUMANIZE);
                    }
                    setRuntimeStage(manifest, PipelineState.HUMANIZE, describeSymbolicStage("humanize", effectiveExecutionPlan, effectiveCompositionPlan));
                    persistManifest(manifest, options?.onManifestUpdate);
                    const humanizeResult = await humanize(midiData, manifest.songId, {
                        style: effectiveCompositionPlan?.humanizationStyle,
                        reflection: effectiveCompositionPlan?.intentRationale,
                        expressionPlan: manifest.expressionPlan,
                        sections: effectiveCompositionPlan?.sections,
                    });
                    midiData = humanizeResult.midiData;
                    manifest.sectionArtifacts = mergeSectionPhraseBreathSummaries(
                        manifest.sectionArtifacts,
                        humanizeResult.sectionPhraseBreath,
                    );
                    manifest.sectionArtifacts = mergeSectionHarmonicRealizationSummaries(
                        manifest.sectionArtifacts,
                        humanizeResult.sectionHarmonicRealization,
                    );
                    manifest.sectionArtifacts = mergeSectionTempoMotionSummaries(
                        manifest.sectionArtifacts,
                        humanizeResult.sectionTempoMotion,
                    );
                    manifest.sectionArtifacts = mergeSectionOrnamentSummaries(
                        manifest.sectionArtifacts,
                        humanizeResult.sectionOrnaments,
                    );
                    persistManifest(manifest, options?.onManifestUpdate);
                }

                if (!resumeStage || resumeStage === PipelineState.HUMANIZE || resumeStage === PipelineState.RENDER) {
                    if (manifest.state === PipelineState.HUMANIZE) {
                        transition(manifest, PipelineState.RENDER);
                    }
                    setRuntimeStage(manifest, PipelineState.RENDER, describeSymbolicStage("render", effectiveExecutionPlan, effectiveCompositionPlan));
                    persistManifest(manifest, options?.onManifestUpdate);
                    const renderResult = await render(midiData, manifest.songId, {
                        expressionPlan: manifest.expressionPlan,
                        sectionArtifacts: manifest.sectionArtifacts,
                        sections: effectiveCompositionPlan?.sections,
                    });
                    manifest.artifacts = renderResult.artifacts;
                }

                if (effectiveExecutionPlan.workflow === "symbolic_plus_audio" && (
                    !resumeStage
                    || resumeStage === PipelineState.HUMANIZE
                    || resumeStage === PipelineState.RENDER
                    || resumeStage === PipelineState.RENDER_AUDIO
                )) {
                    if (manifest.state === PipelineState.RENDER) {
                        transition(manifest, PipelineState.RENDER_AUDIO);
                    }
                    setRuntimeStage(manifest, PipelineState.RENDER_AUDIO, describeStyledAudioStage(effectiveExecutionPlan, effectiveCompositionPlan));
                    persistManifest(manifest, options?.onManifestUpdate);

                    const styledAudioResult = await renderStyledAudio(request, manifest.songId);
                    manifest.artifacts = mergeRenderedAndStyledArtifacts(manifest.artifacts, styledAudioResult.artifacts);
                }

                const audioPolicy = manifest.qualityControl?.policy ?? resolveQualityPolicy(request, effectiveExecutionPlan);

                if (resumeStage === PipelineState.STORE) {
                    if (!manifest.audioEvaluation) {
                        throw new Error("Recovered STORE checkpoint is missing audio evaluation.");
                    }
                    finalizeQualityControl(
                        manifest,
                        resolvedCandidate.attempt,
                        "recovered previously evaluated artifacts after restart",
                    );
                    persistManifest(manifest, options?.onManifestUpdate);
                } else {
                    manifest.audioEvaluation = buildAudioEvaluation(manifest.artifacts, effectiveExecutionPlan.workflow, {
                        expectedDurationSec: expectedAudioDurationSec(request, effectiveCompositionPlan),
                        structureEvaluation: manifest.structureEvaluation,
                        sections: effectiveCompositionPlan?.sections,
                        sectionTonalities: manifest.sectionTonalities,
                        sectionArtifacts: manifest.sectionArtifacts,
                    });
                    const audioRevisionDirectives = buildAudioRevisionDirectives(
                        manifest.audioEvaluation,
                        audioPolicy.targetAudioScore,
                        request,
                        manifest.structureEvaluation,
                    );
                    recordQualityAttempt(manifest, resolvedCandidate.attempt, "audio", manifest.audioEvaluation, audioRevisionDirectives);
                    persistManifest(manifest, options?.onManifestUpdate);

                    if (
                        shouldRetryAudioAttempt(
                            manifest.audioEvaluation,
                            resolvedCandidate.attempt,
                            audioPolicy,
                            request,
                            manifest.structureEvaluation,
                        )
                        && audioRevisionDirectives.length > 0
                    ) {
                        logger.info("Retrying symbolic compose from audio narrative feedback", {
                            songId: manifest.songId,
                            attempt: resolvedCandidate.attempt,
                            nextAttempt: resolvedCandidate.attempt + 1,
                            directives: audioRevisionDirectives.map((directive) => directive.kind),
                        });

                        const revisedRequestBase = applyRevisionDirectives({
                            ...request,
                            workflow: effectiveExecutionPlan.workflow,
                            selectedModels: effectiveExecutionPlan.selectedModels,
                            compositionPlan: effectiveCompositionPlan,
                            sectionArtifacts: manifest.sectionArtifacts?.map((entry) => ({ ...entry })),
                            plannerVersion: request.plannerVersion ?? effectiveCompositionPlan?.version,
                        }, audioRevisionDirectives, resolvedCandidate.attempt + 1);

                        activeRequest = {
                            ...materializeCompositionSketch(revisedRequestBase),
                            promptHash: computePromptHash(revisedRequestBase),
                        };
                        request = activeRequest;
                        effectiveCompositionPlan = activeRequest.compositionPlan;
                        initializeQualityControl(manifest, activeRequest, effectiveExecutionPlan);
                        applyPlanningMetadata(manifest, activeRequest, effectiveExecutionPlan, activeRequest.compositionPlan);
                        transition(manifest, PipelineState.COMPOSE);
                        setRuntimeStage(
                            manifest,
                            PipelineState.COMPOSE,
                            `${describeExecutionPlan(effectiveExecutionPlan, activeRequest.compositionPlan)}; attempt=${resolvedCandidate.attempt + 1}; revisions=${audioRevisionDirectives.map((directive) => directive.kind).join(",")}`,
                        );
                        persistManifest(manifest, options?.onManifestUpdate);
                        symbolicAttempt = resolvedCandidate.attempt + 1;
                        continue qualityRevisionLoop;
                    }

                    finalizeQualityControl(
                        manifest,
                        resolvedCandidate.attempt,
                        manifest.audioEvaluation.passed && meetsAudioTarget(manifest.audioEvaluation, audioPolicy)
                            ? "audio evaluation accepted the rendered draft"
                            : "reached the final audio-informed revision attempt",
                    );
                    persistManifest(manifest, options?.onManifestUpdate);
                }

                if (shouldRequireAudioPass(request, effectiveExecutionPlan) && !manifest.audioEvaluation.passed) {
                    transition(manifest, PipelineState.FAILED);
                    manifest.errorCode = "AUDIO_EVALUATION_FAILED";
                    manifest.errorMessage = manifest.audioEvaluation.issues.join("; ");
                    persistManifest(manifest, options?.onManifestUpdate);
                    return manifest;
                }

                if (shouldEnforceAudioTarget(request, effectiveExecutionPlan, audioPolicy) && !meetsAudioTarget(manifest.audioEvaluation, audioPolicy)) {
                    transition(manifest, PipelineState.FAILED);
                    manifest.errorCode = "AUDIO_TARGET_NOT_MET";
                    manifest.errorMessage = `audio score ${manifest.audioEvaluation.score ?? 0} below target ${audioPolicy.targetAudioScore}`;
                    persistManifest(manifest, options?.onManifestUpdate);
                    return manifest;
                }
            }

            break qualityRevisionLoop;
        }

        // STORE
        transition(manifest, PipelineState.STORE);
        persistManifest(manifest, options?.onManifestUpdate);

        // DONE
        transition(manifest, PipelineState.DONE);
        persistManifest(manifest, options?.onManifestUpdate);

        let preferencesUpdated = false;
        try {
            const assessment = await evaluateCompletedManifest(manifest);
            if (assessment) {
                manifest.selfAssessment = assessment;
                manifest.evaluationSummary = assessment.summary;
                updateAutonomyPreferencesFromManifest(manifest, request);
                preferencesUpdated = true;
                persistManifest(manifest, options?.onManifestUpdate);
            }
        } catch (assessmentError) {
            const message = assessmentError instanceof Error ? assessmentError.message : String(assessmentError);
            logger.warn("Self-assessment failed", { songId: manifest.songId, error: message });
        }

        if (request.source === "autonomy" && !preferencesUpdated) {
            updateAutonomyPreferencesFromManifest(manifest, request);
        }

        logger.info("Pipeline completed", { songId: manifest.songId });
        return manifest;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Pipeline error", { songId: manifest.songId, error: message });

        if (manifest.songId) {
            applyComposeProgress(manifest, manifest.songId);
        }

        if (!isTerminal(manifest.state)) {
            try {
                transition(manifest, PipelineState.FAILED);
            } catch {
                manifest.state = PipelineState.FAILED;
            }
        }
        manifest.errorCode = "PIPELINE_ERROR";
        manifest.errorMessage = message;
        // songId가 비어 있으면(COMPOSE 직전 실패) 저장 경로가 "outputs/manifest.json"이 돼
        // 프로젝트 루트에 파일이 생기므로 저장하지 않는다.
        if (manifest.songId) {
            persistManifest(manifest, options?.onManifestUpdate);
        }
        return manifest;
    }
}
