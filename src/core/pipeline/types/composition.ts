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

/**
 * Controls how structure candidates are generated within a composition attempt.
 *
 * AXIOM 작곡 철학:
 *   template_first  — music21/template이 주 생성기. CI/개발 기본. NotaGen 없이도 동작.
 *   notagen_first   — NotaGen이 단일 후보 생성. 단일 inference run.
 *   hybrid_notagen_with_template_baseline
 *                   — NotaGen N개 + music21 baseline 1개 생성 후 AXIOM evaluator가 선별.
 *                     R&D 품질 모드의 기본. template은 중심이 아닌 안전장치/기준선.
 *
 * 환경 변수로 설정: AXIOM_GENERATION_STRATEGY
 * config.ts의 generationStrategy가 이 값을 resolve하며,
 * LEARNED_SYMBOLIC_BACKEND 기반 자동 추론도 지원합니다 (하위 호환).
 */
export type GenerationStrategy =
    | "template_first"
    | "notagen_first"
    | "hybrid_notagen_with_template_baseline";

/**
 * @deprecated Prefer {@link HumanCalibrationFeedback} for new code.
 *
 * AXIOM curation philosophy (applies to both this type and HumanCalibrationFeedback):
 *   - Human feedback is **optional calibration metadata** — it is not a training gate.
 *   - It does NOT determine SFT/DPO eligibility by default.
 *   - AXIOM internal critic (InternalCriticApproval) is the primary curation source.
 *   - Use human feedback to calibrate internal scores, not to replace them.
 *
 * This interface is kept for backward compatibility with persisted manifests
 * and existing API routes.  New code should use HumanCalibrationFeedback.
 */
export interface ListenerFeedback {
    /** Overall appeal rating: 1 (poor) – 5 (excellent). Calibration signal only. */
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

/**
 * Human calibration feedback attached to a candidate.
 *
 * AXIOM 작곡 철학:
 *   - 이것은 사람의 "보조 의견"(sanity check / calibration signal)입니다.
 *   - SFT 학습 선택의 primary gate가 아닙니다 — InternalCriticApproval이 그 역할을 합니다.
 *   - analyze:score-feedback으로 내부 critic 점수와의 alignment를 검증하는 데 사용하세요.
 *
 * 모든 필드가 optional인 이유: feedback은 부분적으로 기록될 수 있고,
 * 없는 차원은 calibration skip이지 reject이 아닙니다.
 */
export interface HumanCalibrationFeedback {
    /** Overall appeal: 1 (poor) – 5 (excellent). Calibration signal only. */
    appeal?: 1 | 2 | 3 | 4 | 5;
    coherence?: 1 | 2 | 3 | 4 | 5;
    memorability?: 1 | 2 | 3 | 4 | 5;
    emotionalImpact?: 1 | 2 | 3 | 4 | 5;
    strongestDimension?: "melody" | "harmony" | "form" | "texture" | "expression" | "orchestration";
    weakestDimension?: "melody" | "harmony" | "form" | "texture" | "expression" | "orchestration";
    /** CandidateId this piece was preferred over in a pairwise comparison. */
    preferredOver?: string;
    /** Why this candidate was less preferred (calibration insight, not reward). */
    rejectionReason?: string;
    /** Free-form human note (musical observation, perceptual impression). */
    notes?: string;
    /** Id of another candidate this piece was compared against. */
    comparisonCandidateId?: string;
}

/**
 * Official curation decision for a candidate — drives SFT export and dataset inclusion.
 *
 * AXIOM 작곡 철학:
 *   - listenerFeedback (HumanCalibrationFeedback) = 사람이 들은 보조 의견
 *   - curationDecision = 학습/선택에 쓸 공식 결정
 *
 * source 가이드:
 *   "axiom"  — InternalCriticApproval.approved만으로 결정 (기본)
 *   "human"  — 사람 curator가 명시적으로 override한 경우
 *   "hybrid" — axiom 통과 + human calibration boost 둘 다 존재
 */
export interface CurationDecision {
    /** Outcome of the curation decision. */
    status: "accepted" | "rejected" | "needs_rewrite";
    /** Who/what made this decision. */
    source: "axiom" | "human" | "hybrid";
    /** Machine-readable reasons (e.g. ["finalCraftScore_below_threshold", "no_abc_text"]). */
    reasons: string[];
    /** Scoring profile ID used when this decision was made. */
    scoringProfileId: string;
    /** ISO timestamp. */
    decidedAt: string;
}

export interface ReviewFeedback {
    reviewRubricVersion?: string;
    note?: string;
    appealScore?: number;
    strongestDimension?: string;
    weakestDimension?: string;
    comparisonReference?: string;
    /** Structured per-dimension human calibration feedback attached at review time */
    listenerFeedback?: HumanCalibrationFeedback;
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
    /**
     * Generation strategy override for this request.
     * When omitted, config.generationStrategy (from AXIOM_GENERATION_STRATEGY) is used.
     * Set to "hybrid_notagen_with_template_baseline" for R&D quality mode.
     */
    generationStrategy?: GenerationStrategy;
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
