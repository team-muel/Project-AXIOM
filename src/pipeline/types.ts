import { PipelineState } from "./states.js";

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

export interface ReviewFeedback {
    reviewRubricVersion?: string;
    note?: string;
    appealScore?: number;
    strongestDimension?: string;
    weakestDimension?: string;
    comparisonReference?: string;
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

export type ModelRole =
    | "planner"
    | "structure"
    | "orchestrator"
    | "audio_renderer"
    | "structure_evaluator"
    | "audio_evaluator"
    | "summary_evaluator";

export type SectionRole =
    | "intro"
    | "theme_a"
    | "theme_b"
    | "bridge"
    | "development"
    | "variation"
    | "recap"
    | "cadence"
    | "outro";

export type CadenceStyle = "open" | "half" | "authentic" | "plagal" | "deceptive";

export type TextureRole =
    | "lead"
    | "counterline"
    | "inner_voice"
    | "chordal_support"
    | "pad"
    | "pulse"
    | "bass"
    | "accent";

export type PhraseFunction = "presentation" | "continuation" | "cadential" | "transition" | "developmental";

export type PhraseSpanShape = "period" | "sentence" | "hybrid" | "continuation_chain" | "cadential_unit";

export type ContinuationPressure = "low" | "medium" | "high";

export type CadentialBuildup = "gentle" | "prepared" | "surging";

export type ProlongationMode = "tonic" | "dominant" | "sequential" | "pedal";

export type TonicizationEmphasis = "passing" | "prepared" | "arriving";

export type HarmonicDensity = "sparse" | "medium" | "rich";

export type VoicingProfile = "block" | "broken" | "arpeggiated";

export type HarmonicColorTag = "mixture" | "applied_dominant" | "predominant_color" | "suspension";

export type ExpositionPhase = "primary" | "secondary";

export type DevelopmentType = "motivic" | "textural" | "free";

export type RecapMode = "full" | "abbreviated" | "varied";

export type LongSpanPressure = "low" | "medium" | "high";

export type ReturnPayoffStrength = "subtle" | "clear" | "inevitable";

export type ThematicTransformKind =
    | "repeat"
    | "sequence"
    | "fragment"
    | "revoice"
    | "destabilize"
    | "delay_return";

export type PlanRiskProfile = "conservative" | "exploratory" | "experimental";

export type StructureVisibility = "transparent" | "hidden" | "complex";

export type HumanizationStyle = "mechanical" | "restrained" | "expressive";

export type DynamicLevel = "pp" | "p" | "mp" | "mf" | "f" | "ff";

export type HairpinShape = "crescendo" | "diminuendo";

export type ArticulationTag =
    | "legato"
    | "staccato"
    | "staccatissimo"
    | "tenuto"
    | "sostenuto"
    | "accent"
    | "marcato";

export type CharacterTag =
    | "dolce"
    | "dolcissimo"
    | "espressivo"
    | "cantabile"
    | "agitato"
    | "tranquillo"
    | "energico"
    | "grazioso"
    | "brillante"
    | "giocoso"
    | "leggiero"
    | "maestoso"
    | "scherzando"
    | "pastorale"
    | "tempestoso"
    | "appassionato"
    | "delicato";

export type TempoMotionTag =
    | "ritardando"
    | "rallentando"
    | "allargando"
    | "accelerando"
    | "stringendo"
    | "a_tempo"
    | "ritenuto"
    | "tempo_l_istesso";

export type OrnamentTag = "grace_note" | "trill" | "mordent" | "turn" | "arpeggio" | "fermata";

export interface HairpinPlan {
    shape: HairpinShape;
    startMeasure?: number;
    endMeasure?: number;
    target?: DynamicLevel;
}

export interface DynamicsProfile {
    start?: DynamicLevel;
    peak?: DynamicLevel;
    end?: DynamicLevel;
    hairpins?: HairpinPlan[];
}

export interface ExpressionGuidance {
    dynamics?: DynamicsProfile;
    articulation?: ArticulationTag[];
    character?: CharacterTag[];
    phrasePeaks?: number[];
    sustainBias?: number;
    accentBias?: number;
    notes?: string[];
}

export interface PhraseBreathPlan {
    pickupStartMeasure?: number;
    pickupEndMeasure?: number;
    arrivalMeasure?: number;
    releaseStartMeasure?: number;
    releaseEndMeasure?: number;
    cadenceRecoveryStartMeasure?: number;
    cadenceRecoveryEndMeasure?: number;
    rubatoAnchors?: number[];
    notes?: string[];
}

export interface TempoMotionPlan {
    tag: TempoMotionTag;
    startMeasure?: number;
    endMeasure?: number;
    intensity?: number;
    notes?: string[];
}

export interface OrnamentPlan {
    tag: OrnamentTag;
    sectionId?: string;
    startMeasure?: number;
    endMeasure?: number;
    targetBeat?: number;
    intensity?: number;
    notes?: string[];
}

export interface HarmonicColorCue {
    tag: HarmonicColorTag;
    startMeasure?: number;
    endMeasure?: number;
    keyTarget?: string;
    resolutionMeasure?: number;
    intensity?: number;
    notes?: string[];
}

export type TempoMotionDirection = "broaden" | "press_forward" | "neutral";

export type PhraseBreathCueKind =
    | "pickup"
    | "arrival"
    | "release"
    | "cadence_recovery"
    | "rubato_anchor";

export interface SectionPhraseBreathSummary {
    sectionId: string;
    requestedCues: PhraseBreathCueKind[];
    targetedMeasureCount: number;
    realizedMeasureCount: number;
    realizedNoteCount: number;
    averageDurationScale?: number;
    averageTimingJitterScale?: number;
    averageEndingStretchScale?: number;
    peakDurationScaleDelta?: number;
    pickupMeasureCount?: number;
    pickupAverageDurationScale?: number;
    pickupAverageTimingJitterScale?: number;
    pickupAverageEndingStretchScale?: number;
    arrivalMeasureCount?: number;
    arrivalAverageDurationScale?: number;
    arrivalAverageTimingJitterScale?: number;
    arrivalAverageEndingStretchScale?: number;
    releaseMeasureCount?: number;
    releaseAverageDurationScale?: number;
    releaseAverageTimingJitterScale?: number;
    releaseAverageEndingStretchScale?: number;
    cadenceRecoveryMeasureCount?: number;
    cadenceRecoveryAverageDurationScale?: number;
    cadenceRecoveryAverageTimingJitterScale?: number;
    cadenceRecoveryAverageEndingStretchScale?: number;
    rubatoAnchorCount?: number;
    rubatoAnchorAverageDurationScale?: number;
    rubatoAnchorAverageTimingJitterScale?: number;
    rubatoAnchorAverageEndingStretchScale?: number;
}

export interface SectionHarmonicRealizationSummary {
    sectionId: string;
    prolongationMode?: ProlongationMode;
    requestedTonicizationTargets?: string[];
    requestedColorTags?: HarmonicColorTag[];
    targetedMeasureCount: number;
    realizedMeasureCount: number;
    realizedNoteCount: number;
    averageDurationScale?: number;
    averageTimingJitterScale?: number;
    averageEndingStretchScale?: number;
    peakDurationScaleDelta?: number;
    prolongationMeasureCount?: number;
    prolongationAverageDurationScale?: number;
    prolongationAverageTimingJitterScale?: number;
    prolongationAverageEndingStretchScale?: number;
    tonicizationMeasureCount?: number;
    tonicizationAverageDurationScale?: number;
    tonicizationAverageTimingJitterScale?: number;
    tonicizationAverageEndingStretchScale?: number;
    harmonicColorMeasureCount?: number;
    harmonicColorAverageDurationScale?: number;
    harmonicColorAverageTimingJitterScale?: number;
    harmonicColorAverageEndingStretchScale?: number;
}

export interface SectionTempoMotionSummary {
    sectionId: string;
    requestedTags: TempoMotionTag[];
    targetedMeasureCount: number;
    realizedMeasureCount: number;
    realizedNoteCount: number;
    averageDurationScale?: number;
    averageTimingJitterScale?: number;
    averageEndingStretchScale?: number;
    peakDurationScaleDelta?: number;
    motionDirection?: TempoMotionDirection;
}

export interface SectionOrnamentSummary {
    sectionId: string;
    requestedTags: OrnamentTag[];
    explicitlyRealizedTags: OrnamentTag[];
    unsupportedTags?: OrnamentTag[];
    targetedEventCount: number;
    realizedEventCount: number;
    realizedNoteCount: number;
    averageDurationScale?: number;
    averageTimingJitterScale?: number;
    averageEndingStretchScale?: number;
    averageOnsetSpreadBeats?: number;
    peakOnsetSpreadBeats?: number;
    averageGraceLeadInBeats?: number;
    peakGraceLeadInBeats?: number;
    averageTrillOscillationCount?: number;
    peakTrillOscillationCount?: number;
    averageTrillSpanBeats?: number;
    peakTrillSpanBeats?: number;
    peakDurationScaleDelta?: number;
}

export interface TextureGuidance {
    voiceCount?: number;
    primaryRoles?: TextureRole[];
    counterpointMode?: "none" | "imitative" | "contrary_motion" | "free";
    notes?: string[];
}

export interface ExpressionSectionPlan {
    sectionId: string;
    startMeasure?: number;
    endMeasure?: number;
    phraseFunction?: PhraseFunction;
    phraseBreath?: PhraseBreathPlan;
    texture?: TextureGuidance;
    expression?: ExpressionGuidance;
    tempoMotion?: TempoMotionPlan[];
    ornaments?: OrnamentPlan[];
}

export interface ExpressionPlanSidecar {
    version?: string;
    humanizationStyle?: HumanizationStyle;
    textureDefaults?: TextureGuidance;
    expressionDefaults?: ExpressionGuidance;
    tempoMotionDefaults?: TempoMotionPlan[];
    ornamentDefaults?: OrnamentPlan[];
    sections: ExpressionSectionPlan[];
}

export interface ModelBinding {
    role: ModelRole;
    provider: string;
    model: string;
    version?: string;
}

export interface InstrumentAssignment {
    name: string;
    family: "keyboard" | "strings" | "woodwinds" | "brass" | "percussion" | "voice" | "hybrid";
    roles: TextureRole[];
    register?: "low" | "mid" | "high" | "wide";
}

export type OrchestrationFamily = "string_trio";

export type OrchestrationConversationMode = "support" | "conversational";

export type OrchestrationBalanceProfile = "lead_forward" | "balanced";

export type OrchestrationRegisterLayout = "layered" | "wide";

export interface OrchestrationSectionPlan {
    sectionId: string;
    leadInstrument: string;
    secondaryInstrument: string;
    bassInstrument: string;
    conversationMode?: OrchestrationConversationMode;
    balanceProfile?: OrchestrationBalanceProfile;
    registerLayout?: OrchestrationRegisterLayout;
    notes?: string[];
}

export interface OrchestrationPlan {
    family: OrchestrationFamily;
    instrumentNames: string[];
    sections: OrchestrationSectionPlan[];
    notes?: string[];
}

export interface HarmonicPlan {
    tonalCenter?: string;
    keyTarget?: string;
    modulationPath?: string[];
    harmonicRhythm?: "slow" | "medium" | "fast";
    harmonyDensity?: HarmonicDensity;
    voicingProfile?: VoicingProfile;
    prolongationMode?: ProlongationMode;
    tonicizationWindows?: TonicizationWindow[];
    colorCues?: HarmonicColorCue[];
    tensionTarget?: number;
    cadence?: CadenceStyle;
    allowModulation?: boolean;
}

export interface TonicizationWindow {
    keyTarget: string;
    startMeasure?: number;
    endMeasure?: number;
    emphasis?: TonicizationEmphasis;
    cadence?: CadenceStyle;
}

export interface MotifTransformPolicy {
    reuseRequired: boolean;
    inversionAllowed?: boolean;
    augmentationAllowed?: boolean;
    diminutionAllowed?: boolean;
    sequenceAllowed?: boolean;
}

export interface MotifDraft {
    id: string;
    sectionId?: string;
    source?: "planner" | "pipeline";
    intervals: number[];
    description?: string;
    preserveDuringRevision?: boolean;
}

export interface CadenceOption {
    sectionId: string;
    primary: CadenceStyle;
    alternatives: CadenceStyle[];
    rationale?: string;
}

export interface CompositionSketch {
    generatedBy: "planner" | "pipeline";
    note?: string;
    motifDrafts: MotifDraft[];
    cadenceOptions: CadenceOption[];
}

export interface ThematicTransformationCheckpoint {
    id?: string;
    sourceSectionId: string;
    targetSectionId: string;
    transform: ThematicTransformKind;
    expectedProminence?: number;
    preserveIdentity?: boolean;
    notes?: string[];
}

export interface LongSpanFormPlan {
    expositionStartSectionId?: string;
    expositionEndSectionId?: string;
    developmentStartSectionId?: string;
    developmentEndSectionId?: string;
    retransitionSectionId?: string;
    recapStartSectionId?: string;
    returnSectionId?: string;
    delayedPayoffSectionId?: string;
    expectedDevelopmentPressure?: LongSpanPressure;
    expectedReturnPayoff?: ReturnPayoffStrength;
    thematicCheckpoints?: ThematicTransformationCheckpoint[];
    notes?: string[];
}

export interface SectionPlan {
    id: string;
    role: SectionRole;
    label: string;
    measures: number;
    energy: number;
    density: number;
    phraseFunction?: PhraseFunction;
    phraseBreath?: PhraseBreathPlan;
    phraseSpanShape?: PhraseSpanShape;
    continuationPressure?: ContinuationPressure;
    cadentialBuildup?: CadentialBuildup;
    expositionPhase?: ExpositionPhase;
    developmentType?: DevelopmentType;
    recapMode?: RecapMode;
    cadenceStrength?: number;
    registerCenter?: number;
    cadence?: CadenceStyle;
    motifRef?: string;
    contrastFrom?: string;
    instrumentation?: InstrumentAssignment[];
    harmonicPlan?: HarmonicPlan;
    texture?: TextureGuidance;
    expression?: ExpressionGuidance;
    tempoMotion?: TempoMotionPlan[];
    ornaments?: OrnamentPlan[];
    notes?: string[];
}

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
    sections: SectionPlan[];
    rationale: string;
}

export interface ComposeEvaluationPolicy {
    requireStructurePass?: boolean;
    requireAudioPass?: boolean;
    summarizeWithLLM?: boolean;
}

export interface ComposeQualityPolicy {
    enableAutoRevision?: boolean;
    maxStructureAttempts?: number;
    targetStructureScore?: number;
    targetAudioScore?: number;
}

export type RevisionDirectiveKind =
    | "extend_length"
    | "reduce_repetition"
    | "expand_register"
    | "increase_pitch_variety"
    | "increase_rhythm_variety"
    | "reduce_large_leaps"
    | "stabilize_harmony"
    | "clarify_harmonic_color"
    | "strengthen_cadence"
    | "shape_dynamics"
    | "shape_tempo_motion"
    | "shape_ornament_hold"
    | "clarify_expression"
    | "clarify_phrase_rhetoric"
    | "clarify_texture_plan"
    | "clarify_narrative_arc"
    | "rebalance_recap_release";

export interface RevisionDirective {
    kind: RevisionDirectiveKind;
    priority: number;
    reason: string;
    sourceIssue?: string;
    sectionIds?: string[];
}

export type QualityAttemptStage = "structure" | "audio";

export interface ComposeExecutionPlan {
    workflow: ComposeWorkflow;
    composeWorker: ComposeWorkerName;
    selectedModels: ModelBinding[];
}

export interface SectionEvaluationFinding {
    sectionId: string;
    label: string;
    role: SectionRole;
    startMeasure: number;
    endMeasure: number;
    score: number;
    issues: string[];
    strengths: string[];
    metrics: Record<string, number>;
}

export interface SectionTransformSummary {
    sectionId: string;
    role: SectionRole;
    sourceSectionId?: string;
    transformMode: string;
    rhythmTransform?: string;
    sequenceStride?: number;
    generatedNoteCount?: number;
    sourceNoteCount?: number;
}

export interface SectionRenderEventArtifact {
    type: "note" | "chord" | "rest";
    quarterLength: number;
    velocity?: number;
    pitch?: number;
    pitches?: number[];
    voiceRole?: TextureRole;
}

export interface SectionArtifactSummary {
    sectionId: string;
    role: SectionRole;
    measureCount: number;
    melodyEvents: SectionRenderEventArtifact[];
    accompanimentEvents: SectionRenderEventArtifact[];
    noteHistory: number[];
    capturedMotif?: number[];
    secondaryLineMotif?: number[];
    secondaryLinePitchCount?: number;
    secondaryLineSpan?: number;
    secondaryLineDistinctPitchClasses?: number;
    textureIndependentMotionRate?: number;
    textureContraryMotionRate?: number;
    plannedRegisterCenter?: number;
    realizedRegisterCenter?: number;
    melodyPitchMin?: number;
    melodyPitchMax?: number;
    bassPitchMin?: number;
    bassPitchMax?: number;
    melodyVelocityMin?: number;
    melodyVelocityMax?: number;
    accompanimentVelocityMin?: number;
    accompanimentVelocityMax?: number;
    phraseFunction?: PhraseFunction;
    harmonyDensity?: HarmonicDensity;
    voicingProfile?: VoicingProfile;
    prolongationMode?: ProlongationMode;
    tonicizationWindows?: TonicizationWindow[];
    harmonicColorCues?: HarmonicColorCue[];
    textureVoiceCount?: number;
    primaryTextureRoles?: TextureRole[];
    counterpointMode?: TextureGuidance["counterpointMode"];
    textureNotes?: string[];
    bassMotionProfile?: "pedal" | "stepwise" | "mixed" | "leaping";
    cadenceApproach?: "dominant" | "plagal" | "tonic" | "other";
    sectionStyle?: string;
    expressionDynamics?: DynamicsProfile;
    articulation?: ArticulationTag[];
    character?: CharacterTag[];
    phrasePeaks?: number[];
    sustainBias?: number;
    accentBias?: number;
    phraseBreathSummary?: Omit<SectionPhraseBreathSummary, "sectionId">;
    harmonicRealizationSummary?: Omit<SectionHarmonicRealizationSummary, "sectionId">;
    tempoMotionSummary?: Omit<SectionTempoMotionSummary, "sectionId">;
    ornamentSummary?: Omit<SectionOrnamentSummary, "sectionId">;
    lastPitch?: number;
    lastBassPitch?: number;
    lastInterval?: number;
    transform?: SectionTransformSummary;
}

export interface SectionTonalitySummary {
    sectionId: string;
    role: SectionRole;
    tonalCenter: string;
    keyTarget?: string;
    harmonicRhythm?: HarmonicPlan["harmonicRhythm"];
    harmonyDensity?: HarmonicDensity;
    voicingProfile?: VoicingProfile;
    prolongationMode?: ProlongationMode;
    tonicizationWindows?: TonicizationWindow[];
    harmonicColorCues?: HarmonicColorCue[];
    measures?: number;
}

export type TonalityMode = "major" | "minor";

export type AudioKeyAnalysisSource = "rendered" | "styled" | "primary";

export interface RenderedKeyEstimate {
    label: string;
    tonicPitchClass: number;
    mode: TonalityMode;
    score: number;
    confidence: number;
}

export interface AudioKeyDriftPoint {
    startRatio: number;
    endRatio: number;
    renderedKey: RenderedKeyEstimate;
    expectedFit?: number;
    homeFit?: number;
}

export interface AudioSectionKeyTracking {
    sectionId: string;
    role: SectionRole;
    plannedTonality?: string;
    renderedKey?: RenderedKeyEstimate;
    driftPath?: AudioKeyDriftPoint[];
}

export interface AudioKeyTrackingReport {
    source: AudioKeyAnalysisSource;
    sections: AudioSectionKeyTracking[];
}

export interface AudioSectionEvaluationFinding {
    sectionId: string;
    label: string;
    role: SectionRole;
    sourceSectionId?: string;
    plannedTonality?: string;
    score: number;
    issues: string[];
    strengths: string[];
    metrics: Record<string, number>;
}

export type LongSpanEvaluationStatus = "held" | "at_risk" | "collapsed";

export type LongSpanEvaluationDimension =
    | "development_pressure"
    | "thematic_transformation"
    | "harmonic_timing"
    | "return_payoff";

export interface LongSpanEvaluationSummary {
    status: LongSpanEvaluationStatus;
    weakestDimension?: LongSpanEvaluationDimension;
    weakDimensions: LongSpanEvaluationDimension[];
    averageFit?: number;
    expectedDevelopmentPressure?: LongSpanPressure;
    expectedReturnPayoff?: ReturnPayoffStrength;
    thematicCheckpointCount: number;
    developmentPressureFit?: number;
    thematicTransformationFit?: number;
    harmonicTimingFit?: number;
    returnPayoffFit?: number;
}

export type AudioLongSpanEvaluationDimension =
    | "development_narrative"
    | "recap_recall"
    | "harmonic_route"
    | "tonal_return";

export interface AudioLongSpanEvaluationSummary {
    status: LongSpanEvaluationStatus;
    weakestDimension?: AudioLongSpanEvaluationDimension;
    weakDimensions: AudioLongSpanEvaluationDimension[];
    averageFit?: number;
    developmentNarrativeFit?: number;
    recapRecallFit?: number;
    harmonicRouteFit?: number;
    tonalReturnFit?: number;
}

export type LongSpanDivergenceStatus = "render_weaker" | "render_collapsed";

export type LongSpanDivergenceRepairMode = "render_only" | "paired_same_section" | "paired_cross_section";

export type LongSpanDivergenceSectionComparisonStatus = "audio_only" | "both_weak";

export type LongSpanDivergenceDirectivePriorityClass = "primary" | "secondary";

export interface LongSpanDivergenceDirectiveRecommendation {
    focus: AudioLongSpanEvaluationDimension;
    kind: RevisionDirectiveKind;
    priorityClass: LongSpanDivergenceDirectivePriorityClass;
}

export interface LongSpanDivergenceSectionSummary {
    sectionId: string;
    label: string;
    role: SectionRole;
    focus: AudioLongSpanEvaluationDimension;
    explanation: string;
    comparisonStatus: LongSpanDivergenceSectionComparisonStatus;
    sourceSectionId?: string;
    plannedTonality?: string;
    topIssue?: string;
    score?: number;
    focusFit?: number;
    consistencyFit?: number;
    structureSectionId?: string;
    structureLabel?: string;
    structureRole?: SectionRole;
    structureTopIssue?: string;
    structureScore?: number;
    structureStartMeasure?: number;
    structureEndMeasure?: number;
    structureExplanation?: string;
}

export interface LongSpanDivergenceSummary {
    status: LongSpanDivergenceStatus;
    explanation: string;
    repairMode: LongSpanDivergenceRepairMode;
    structureStatus: LongSpanEvaluationStatus;
    audioStatus: LongSpanEvaluationStatus;
    structureWeakestDimension?: LongSpanEvaluationDimension;
    audioWeakestDimension?: AudioLongSpanEvaluationDimension;
    repairFocus?: AudioLongSpanEvaluationDimension;
    secondaryRepairFocuses?: AudioLongSpanEvaluationDimension[];
    recommendedDirectiveKind?: RevisionDirectiveKind;
    recommendedDirectives?: LongSpanDivergenceDirectiveRecommendation[];
    primarySectionId?: string;
    primarySectionRole?: SectionRole;
    structureAverageFit?: number;
    audioAverageFit?: number;
    averageFitGap?: number;
    sections?: LongSpanDivergenceSectionSummary[];
}

export interface OrchestrationEvaluationSummary {
    family: OrchestrationFamily;
    instrumentNames: string[];
    sectionCount: number;
    conversationalSectionCount: number;
    idiomaticRangeFit?: number;
    registerBalanceFit?: number;
    ensembleConversationFit?: number;
    doublingPressureFit?: number;
    textureRotationFit?: number;
    sectionHandoffFit?: number;
    weakSectionIds: string[];
}

export interface StructureEvaluationReport {
    passed: boolean;
    score?: number;
    issues: string[];
    strengths: string[];
    metrics?: Record<string, number>;
    longSpan?: LongSpanEvaluationSummary;
    orchestration?: OrchestrationEvaluationSummary;
    sectionFindings?: SectionEvaluationFinding[];
    weakestSections?: SectionEvaluationFinding[];
}

export interface AudioEvaluationReport {
    passed: boolean;
    score?: number;
    issues: string[];
    strengths: string[];
    metrics?: Record<string, number>;
    longSpan?: AudioLongSpanEvaluationSummary;
    sectionFindings?: AudioSectionEvaluationFinding[];
    weakestSections?: AudioSectionEvaluationFinding[];
    keyTracking?: AudioKeyTrackingReport;
}

export interface EvaluationBundle {
    structure?: StructureEvaluationReport;
    audio?: AudioEvaluationReport;
}

export interface QualityAttemptRecord {
    attempt: number;
    stage?: QualityAttemptStage;
    passed: boolean;
    score?: number;
    issues: string[];
    strengths: string[];
    metrics?: Record<string, number>;
    directives: RevisionDirective[];
    evaluatedAt: string;
}

export interface QualityControlReport {
    policy: ComposeQualityPolicy;
    attempts: QualityAttemptRecord[];
    selectedAttempt?: number;
    stopReason?: string;
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

export interface SongMeta {
    songId: string;
    prompt: string;
    key?: string;
    tempo?: number;
    form?: string;
    inspirationThread?: string;
    intentRationale?: string;
    contrastTarget?: string;
    riskProfile?: PlanRiskProfile;
    structureVisibility?: StructureVisibility;
    humanizationStyle?: HumanizationStyle;
    source?: ComposeSource;
    autonomyRunId?: string;
    promptHash?: string;
    workflow?: ComposeWorkflow;
    plannerVersion?: string;
    plannedSectionCount?: number;
    selectedModels?: ModelBinding[];
    plannerTelemetry?: PlannerTelemetry;
    createdAt: string;
    updatedAt: string;
}

export interface JobManifest {
    songId: string;
    state: PipelineState;
    meta: SongMeta;
    artifacts: ArtifactPaths;
    errorCode?: string;
    errorMessage?: string;
    selfAssessment?: SelfAssessment;
    structureEvaluation?: StructureEvaluationReport;
    audioEvaluation?: AudioEvaluationReport;
    sectionArtifacts?: SectionArtifactSummary[];
    sectionTransforms?: SectionTransformSummary[];
    sectionTonalities?: SectionTonalitySummary[];
    expressionPlan?: ExpressionPlanSidecar;
    qualityControl?: QualityControlReport;
    compositionSketch?: CompositionSketch;
    approvalStatus?: ApprovalStatus;
    evaluationSummary?: string;
    reviewFeedback?: ReviewFeedback;
    runtime?: RuntimeStatus;
    stateHistory: { state: PipelineState; timestamp: string }[];
    updatedAt: string;
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
