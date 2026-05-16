import type { PipelineState } from "../states.js";
import type { ExpressionGuidance, HumanizationStyle, OrnamentPlan, SectionOrnamentSummary, SectionPhraseBreathSummary, SectionTempoMotionSummary, TempoMotionPlan, TextureGuidance } from "./expression.js";
import type { SectionHarmonicRealizationSummary } from "./harmony.js";
import type { InstrumentAssignment, OrchestrationPlan } from "./orchestration.js";
import type { ClassicalKnowledgePlan } from "./classical.js";
import type { SectionArtifactSummary, SectionEvaluationFinding, SectionPlan, SectionTonalitySummary, SectionTransformSummary } from "./section.js";
import type { CompositionSketch, MotifTransformPolicy } from "./motif.js";
import type { LongSpanFormPlan } from "./longspan.js";
import type { LocalizedPianoRewriteSpec, PianoPlan } from "./piano.js";
import type { AudioEvaluationReport, ComposeEvaluationPolicy, ComposeQualityPolicy, RevisionDirective, StructureEvaluationReport } from "./evaluation.js";
import type { LearnedSamplingParams, LocalizedRewriteSpec, ModelBinding } from "./learned.js";
import type { SongMeta } from "./manifest.js";

export interface ArtifactPaths {
    midi?: string;
    scoreImage?: string;
    audio?: string;
    renderedAudio?: string;
    styledAudio?: string;
    video?: string;
}

export type ComposeWorkerName = "music21" | "musicgen" | "learned_symbolic";

export type ComposeWorkerPhase =
    | "starting"
    | "loading_model"
    | "preparing_inputs"
    | "generating"
    | "saving_output"
    | "completed"
    | "failed";

export interface ComposeWorkerProgress {
    worker: ComposeWorkerName;
    phase: ComposeWorkerPhase;
    updatedAt: string;
    detail?: string;
    outputPath?: string;
    durationSec?: number;
}

export interface RecoveryMetadata {
    recoveredFromRestart: boolean;
    recoveredAt: string;
    note?: string;
}

export interface RuntimeStatus {
    stage: PipelineState;
    stageStartedAt: string;
    updatedAt: string;
    detail?: string;
    compose?: ComposeWorkerProgress;
    recovery?: RecoveryMetadata;
}

export type ComposeSource = "api" | "autonomy";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "not_required";

export interface ListenerFeedback {
    /** Overall appeal rating: 1 (poor) – 5 (excellent) */
    appeal: 1 | 2 | 3 | 4 | 5;
    memorability?: 1 | 2 | 3 | 4 | 5;
    coherence?: 1 | 2 | 3 | 4 | 5;
    emotionalImpact?: 1 | 2 | 3 | 4 | 5;
    strongestDimension?: "melody" | "harmony" | "form" | "texture" | "expression" | "orchestration";
    weakestDimension?: "melody" | "harmony" | "form" | "texture" | "expression" | "orchestration";
    /** Free-form listener observation */
    notes?: string;
    /** Id of another candidate this piece was compared against */
    comparisonCandidateId?: string;
}

export interface ReviewFeedback {
    reviewRubricVersion?: string;
    note?: string;
    appealScore?: number;
    strongestDimension?: string;
    weakestDimension?: string;
    comparisonReference?: string;
    /** Structured per-dimension listener rating attached at approval/rejection time */
    listenerFeedback?: ListenerFeedback;
}

export interface SelfAssessment {
    generatedAt: string;
    summary: string;
    qualityScore?: number;
    strengths: string[];
    weaknesses: string[];
    tags: string[];
    reflection?: string;
    nextFocus?: string[];
    raw: string;
}

export type ComposeWorkflow = "symbolic_only" | "symbolic_plus_audio" | "audio_only";

export type PlanRiskProfile = "conservative" | "exploratory" | "experimental";

export type StructureVisibility = "transparent" | "hidden" | "complex";

export interface CompositionPlan {
    version: string;
    titleHint?: string;
    brief: string;
    mood: string[];
    form: string;
    inspirationThread?: string;
    intentRationale?: string;
    contrastTarget?: string;
    riskProfile?: PlanRiskProfile;
    structureVisibility?: StructureVisibility;
    humanizationStyle?: HumanizationStyle;
    targetDurationSec?: number;
    targetMeasures?: number;
    meter?: string;
    key?: string;
    tempo?: number;
    workflow: ComposeWorkflow;
    instrumentation: InstrumentAssignment[];
    textureDefaults?: TextureGuidance;
    expressionDefaults?: ExpressionGuidance;
    tempoMotionDefaults?: TempoMotionPlan[];
    ornamentDefaults?: OrnamentPlan[];
    motifPolicy: MotifTransformPolicy;
    sketch?: CompositionSketch;
    longSpanForm?: LongSpanFormPlan;
    orchestration?: OrchestrationPlan;
    classicalKnowledge?: ClassicalKnowledgePlan;
    sections: SectionPlan[];
    rationale: string;
    /**
     * Hand-aware piano IR.  Present only when the instrumentation is solo piano.
     * Drives RH/LH register planning, texture selection, pedal strategy, and
     * per-section chord voicing in the solo_piano_symbolic lane.
     */
    pianoPlan?: PianoPlan;
}

export interface ComposeExecutionPlan {
    workflow: ComposeWorkflow;
    composeWorker: ComposeWorkerName;
    selectedModels: ModelBinding[];
}

export interface SymbolicCompositionProfile {
    pitchContour?: number[];
    density?: number;
    tension?: number[];
}

export type PlannerParserMode = "structured_json" | "fallback";

export interface PlannerTelemetry {
    selectionStrategy?: string;
    selectedCandidateId?: string;
    selectedCandidateLabel?: string;
    selectedCandidateIndex?: number;
    candidateCount?: number;
    parserMode?: PlannerParserMode;
    planSignature?: string;
    noveltyScore?: number;
    repeatedAxes?: string[];
    exactMatch?: boolean;
    selectionScore?: number;
    qualityScore?: number;
}

export interface ComposeRequest {
    prompt: string;
    key?: string;
    tempo?: number;
    form?: string;
    source?: ComposeSource;
    autonomyRunId?: string;
    promptHash?: string;
    songId?: string;
    recoveredFromRestart?: boolean;
    recoveryNote?: string;
    compositionProfile?: SymbolicCompositionProfile;
    durationSec?: number;
    workflow?: ComposeWorkflow;
    selectedModels?: ModelBinding[];
    compositionPlan?: CompositionPlan;
    classicalKnowledge?: ClassicalKnowledgePlan;
    plannerTelemetry?: PlannerTelemetry;
    targetInstrumentation?: InstrumentAssignment[];
    plannerVersion?: string;
    evaluationPolicy?: ComposeEvaluationPolicy;
    qualityPolicy?: ComposeQualityPolicy;
    revisionDirectives?: RevisionDirective[];
    sectionArtifacts?: SectionArtifactSummary[];
    candidateCount?: number;
    localizedRewriteBranches?: number;
    candidateVariantKey?: string;
    attemptIndex?: number;
    /** Number of NotaGen learned candidates to generate per attempt (default 8, max 32). */
    learnedCandidateCount?: number;
    /** Number of music21 baseline candidates to include per attempt (default 1). */
    music21BaselineCount?: number;
    /** Per-candidate sampling parameters forwarded to the NotaGen backend. */
    learnedSampling?: LearnedSamplingParams;
    /** When present, instructs the NotaGen backend to rewrite only the specified sections. */
    localizedRewriteSpec?: LocalizedRewriteSpec;
    /** When present, describes piano-specific localized repairs/rewrites for the solo_piano_symbolic lane. */
    localizedPianoRewriteSpec?: LocalizedPianoRewriteSpec;
}

export interface ComposeProposalEvidenceSummary {
    measureCount?: number;
    noteCount?: number;
    partCount?: number;
    partInstrumentNames?: string[];
    key?: string;
    tempo?: number;
    form?: string;
}

export interface ComposeProposalEvidence {
    worker: ComposeWorkerName;
    lane?: string;
    provider?: string;
    model?: string;
    benchmarkPackVersion?: string;
    benchmarkId?: string;
    promptPackVersion?: string;
    planSignature?: string;
    generationMode?: string;
    confidence?: number;
    normalizationWarnings?: string[];
    summary?: ComposeProposalEvidenceSummary;
    /** Zero-based index of this candidate within the learned candidate pool (assigned by TS orchestrator). */
    candidateIndex?: number;
    /** Sampling parameters used to generate this candidate. */
    samplingParams?: LearnedSamplingParams;
    /**
     * Full prompt pack payload used for this candidate.
     * Stored as opaque JSON so DPO export and fine-tuning tools can reconstruct the exact
     * conditioning input without traversing the generation trace.
     */
    promptPack?: Record<string, unknown>;
    /**
     * Full provider request payload (control lines, conditioning text, ABC header, etc.)
     * used for this candidate.  Mirrors promptPack — the "input" side of each DPO pair.
     */
    providerRequest?: Record<string, unknown>;
    /**
     * Full ABC score text produced by the backend.
     * Present for notagen_mock and notagen_local backends.
     * Used by the SFT dataset export pipeline as the training target.
     */
    abcText?: string;
}

export interface ComposeResult {
    midiData?: Buffer;
    meta: Partial<SongMeta>;
    isRendered?: boolean;
    artifacts?: ArtifactPaths;
    compositionPlan?: CompositionPlan;
    executionPlan?: ComposeExecutionPlan;
    structureEvaluation?: StructureEvaluationReport;
    audioEvaluation?: AudioEvaluationReport;
    sectionArtifacts?: SectionArtifactSummary[];
    sectionTransforms?: SectionTransformSummary[];
    sectionTonalities?: SectionTonalitySummary[];
    proposalEvidence?: ComposeProposalEvidence;
    skeletonPath?: string;
}

export interface CritiqueResult {
    pass: boolean;
    issues: string[];
    score?: number;
    strengths?: string[];
    metrics?: Record<string, number>;
    sectionFindings?: SectionEvaluationFinding[];
    weakestSections?: SectionEvaluationFinding[];
}

export interface HumanizeResult {
    midiData: Buffer;
    sectionPhraseBreath?: SectionPhraseBreathSummary[];
    sectionHarmonicRealization?: SectionHarmonicRealizationSummary[];
    sectionTempoMotion?: SectionTempoMotionSummary[];
    sectionOrnaments?: SectionOrnamentSummary[];
}

export interface RenderResult {
    artifacts: ArtifactPaths;
}
