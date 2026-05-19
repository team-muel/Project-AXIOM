import type { PipelineState } from "../states.js";
import type { ExpressionGuidance, HumanizationStyle, OrnamentPlan, SectionOrnamentSummary, SectionPhraseBreathSummary, SectionTempoMotionSummary, TempoMotionPlan, TextureGuidance } from "./expression.js";
import type { SectionHarmonicRealizationSummary } from "./harmony.js";
import type { InstrumentAssignment, OrchestrationPlan } from "./orchestration.js";
import type { ClassicalKnowledgePlan } from "./classical.js";
import type { SectionArtifactSummary, SectionEvaluationFinding, SectionPlan, SectionTonalitySummary, SectionTransformSummary } from "./section.js";
import type { CompositionSketch, GlobalMotifGraph, MotifTransformPolicy } from "./motif.js";
import type { LongSpanFormPlan } from "./longspan.js";
import type { LocalizedPianoRewriteSpec, PianoPlan } from "./piano.js";
import type { AudioEvaluationReport, ComposeEvaluationPolicy, ComposeQualityPolicy, RevisionDirective, StructureEvaluationReport } from "./evaluation.js";
import type { LearnedSamplingParams, LocalizedRewriteSpec, ModelBinding } from "./learned.js";
import type { SongMeta } from "./manifest.js";
import type { CandidateScoringProfiles } from "../../evaluate/scoringProfile.js";

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
    /**
     * CandidateId that the listener prefers over the piece receiving this feedback.
     * When present, records a pairwise preference: preferredOver > this candidate.
     */
    preferredOver?: string;
    /** Human-readable reason this candidate was rejected or ranked lower */
    rejectionReason?: string;
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

// ─── Internal Critic Approval ──────────────────────────────────────────────────
//
// AXIOM 작곡 철학: internal critic이 primary approval gate
// listenerFeedback / curatorCalibration은 보정(calibration) 용도로만 사용
//
// Approval hierarchy:
//   1. InternalCriticApproval (primary)  — criteria: finalCraftScore + evidenceCoverage + harmonyContract
//   2. CuratorCalibrationReview (secondary) — optional human sanity check / score calibration
//
// Dataset curation (SFT export) uses InternalCriticApproval.approved as the sole gate.
// CuratorCalibrationReview enriches metadata only — it does not override critic approval.

export interface InternalCriticApprovalThresholds {
    /** minimum finalCraftScore for approval */
    finalCraftScore: number;
    /** minimum advancedCraftScore for approval */
    advancedCraftScore: number;
    /** minimum harmonyContractScore for approval (0–1) */
    harmonyContractScore: number;
    /** minimum evidenceCoverageScore for approval (0–1) */
    evidenceCoverageScore: number;
}

export const INTERNAL_CRITIC_APPROVAL_THRESHOLDS_V1: InternalCriticApprovalThresholds = {
    finalCraftScore:       0.70,
    advancedCraftScore:    0.60,
    harmonyContractScore:  0.70,
    evidenceCoverageScore: 0.55,
} as const;

/**
 * Result of the AXIOM internal critic evaluation.
 * This is the PRIMARY signal for dataset curation and SFT export.
 * Human feedback is secondary calibration data only.
 */
export interface InternalCriticApproval {
    /** True when all threshold dimensions pass. Primary gate for SFT dataset inclusion. */
    approved: boolean;
    /** Snapshot of key craft score dimensions at evaluation time. */
    finalCraftScore: number;
    advancedCraftScore: number;
    harmonyContractScore: number;
    evidenceCoverageScore: number;
    /** Piano listenability score when present (piano candidates only). */
    pianoListenabilityScore?: number;
    /** Scoring profile ID used for the threshold decision. */
    scoringProfileId: string;
    /** Which dimensions fell below their threshold (empty when approved). */
    failedDimensions: string[];
    /** ISO timestamp when the approval was computed. */
    evaluatedAt: string;
}

/**
 * Optional curator calibration review.
 * Purpose: sanity-check whether internal critic scores match trained human perception.
 * NOT a reward signal — does not drive SFT dataset inclusion.
 * Use analyze:score-feedback to verify calibration alignment.
 */
export interface CuratorCalibrationReview {
    /** Source of the review ("human", "automated", "expert-review") */
    source: "human" | "automated" | "expert-review";
    /** 1–5 scale assessment of musical quality by the reviewer */
    qualityRating: 1 | 2 | 3 | 4 | 5;
    /** Optional per-dimension assessments */
    harmonyRating?: 1 | 2 | 3 | 4 | 5;
    structureRating?: 1 | 2 | 3 | 4 | 5;
    motifRating?: 1 | 2 | 3 | 4 | 5;
    pianoRating?: 1 | 2 | 3 | 4 | 5;
    /** Free-form note about what the internal critic got right or wrong */
    calibrationNote?: string;
    /** CandidateId this was preferred over in a pairwise comparison */
    preferredOver?: string;
    /** Why this candidate was ranked lower (calibration insight, not reward) */
    calibrationInsight?: string;
    /** ISO timestamp */
    reviewedAt: string;
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
    /**
     * Plan-time global motif graph: built during sketch materialization.
     * Defines the full dramatic arc of motif development across sections.
     * Generators should follow this graph rather than independent role heuristics.
     */
    globalMotifGraph?: GlobalMotifGraph;
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
    /**
     * Scoring profiles used for evaluating and selecting candidates in this
     * execution.  Stored on the plan so every evaluation step (craftScore,
     * pianoScore, gate check) and the candidate manifest use the same profiles.
     * Defaults to DEFAULT_CANDIDATE_SCORING_PROFILES when not specified.
     */
    scoringProfiles?: CandidateScoringProfiles;
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
