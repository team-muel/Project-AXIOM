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

export type ClassicalKnowledgeDomain =
    | "harmony"
    | "counterpoint"
    | "form"
    | "orchestration"
    | "notation"
    | "performance";

export type ClassicalHarmonyLanguage =
    | "common_practice"
    | "modal"
    | "chromatic"
    | "extended_tonal";

export type ClassicalCadencePolicy = "light" | "structural" | "architectural";

export type ClassicalModulationStrategy =
    | "none"
    | "local_tonicization"
    | "sectional"
    | "long_range";

export type ClassicalVoiceLeadingStrictness = "free" | "guided" | "strict";

export type ClassicalImitationPriority = "none" | "occasional" | "active";

export type ClassicalDissonanceTreatment = "uncontrolled" | "prepared" | "suspension_aware";

export type ClassicalDevelopmentPriority = "low" | "medium" | "high";

export type ClassicalReturnStrategy = "none" | "recognizable" | "transformed" | "inevitable";

export type ClassicalPhraseMarkingDensity = "sparse" | "balanced" | "detailed";

export type ClassicalRubatoProfile = "none" | "restrained" | "expressive";

export type ClassicalNotationMarkCategory =
    | "dynamic"
    | "articulation"
    | "tempo"
    | "character"
    | "ornament"
    | "pedal"
    | "technique"
    | "text";

export interface ClassicalNotationMark {
    category: ClassicalNotationMarkCategory;
    mark: string;
    scope?: "global" | "section" | "measure";
    sectionId?: string;
    startMeasure?: number;
    endMeasure?: number;
    intensity?: number;
    notes?: string[];
}

export interface ClassicalHarmonyKnowledge {
    language?: ClassicalHarmonyLanguage;
    cadencePolicy?: ClassicalCadencePolicy;
    modulationStrategy?: ClassicalModulationStrategy;
    harmonicRhythm?: "slow" | "medium" | "fast";
    colorPalette?: HarmonicColorTag[];
    notes?: string[];
}

export interface ClassicalCounterpointKnowledge {
    voiceLeading?: ClassicalVoiceLeadingStrictness;
    imitation?: ClassicalImitationPriority;
    dissonanceTreatment?: ClassicalDissonanceTreatment;
    preferredVoiceCount?: number;
    notes?: string[];
}

export interface ClassicalFormKnowledge {
    architecture?: string;
    phraseModel?: PhraseSpanShape;
    developmentPriority?: ClassicalDevelopmentPriority;
    returnStrategy?: ClassicalReturnStrategy;
    notes?: string[];
}

export interface ClassicalOrchestrationKnowledge {
    idiom?: string;
    registerStrategy?: "compact" | "layered" | "wide";
    balancePriority?: "lead_forward" | "conversational" | "ensemble";
    notes?: string[];
}

export interface ClassicalNotationKnowledge {
    phraseMarkingDensity?: ClassicalPhraseMarkingDensity;
    marks: ClassicalNotationMark[];
    notes?: string[];
}

export interface ClassicalPerformanceKnowledge {
    humanizationStyle?: HumanizationStyle;
    rubato?: ClassicalRubatoProfile;
    dynamicArc?: "flat" | "terraced" | "phrased" | "long_range";
    notes?: string[];
}

export interface ClassicalKnowledgePlan {
    version: string;
    domains: ClassicalKnowledgeDomain[];
    summary?: string;
    harmony?: ClassicalHarmonyKnowledge;
    counterpoint?: ClassicalCounterpointKnowledge;
    form?: ClassicalFormKnowledge;
    orchestration?: ClassicalOrchestrationKnowledge;
    notation?: ClassicalNotationKnowledge;
    performance?: ClassicalPerformanceKnowledge;
    constraints?: string[];
}

export interface ClassicalKnowledgeSummary {
    version: string;
    domains: ClassicalKnowledgeDomain[];
    notationMarkCount: number;
    voiceLeading?: ClassicalVoiceLeadingStrictness;
    cadencePolicy?: ClassicalCadencePolicy;
    developmentPriority?: ClassicalDevelopmentPriority;
}

export type ClassicalKnowledgeEvaluationStatus = "held" | "at_risk" | "missing";

export interface ClassicalKnowledgeEvaluationSummary {
    status: ClassicalKnowledgeEvaluationStatus;
    score: number;
    domains: ClassicalKnowledgeDomain[];
    issues: string[];
    strengths: string[];
    metrics: Record<string, number>;
    notationMarkCount: number;
    preservedNotationMarkCount: number;
    supportedNotationMarkCount: number;
    strictVoiceLeadingRequired?: boolean;
    architecturalCadenceRequired?: boolean;
}

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

export interface LearnedSamplingParams {
    temperature?: number;
    topP?: number;
    topK?: number;
    seedOffset?: number;
}

export interface LocalizedRewriteDirectiveHint {
    sectionId: string;
    kind: RevisionDirectiveKind;
    reason: string;
}

/** Specification for a NotaGen localized section rewrite request. */
export interface LocalizedRewriteSpec {
    /** Section IDs that should be regenerated by NotaGen. */
    rewriteSectionIds: string[];
    /** Section IDs that should be preserved byte/event-stable from the prior candidate. */
    keepSectionIds: string[];
    /** Human-readable overall reason for the rewrite (included in the prompt). */
    reason: string;
    /** Per-section directive hints forwarded to the rewrite prompt. */
    directives: LocalizedRewriteDirectiveHint[];
    /** Previous ABC text from the parent candidate (for byte-stable section assembly). Optional. */
    previousAbcText?: string;
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

export type OrchestrationFamily = "string_trio" | "piano_solo";

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
    classicalKnowledge?: ClassicalKnowledgePlan;
    sections: SectionPlan[];
    rationale: string;
    /**
     * Hand-aware piano IR.  Present only when the instrumentation is solo piano.
     * Drives RH/LH register planning, texture selection, pedal strategy, and
     * per-section chord voicing in the piano_solo_symbolic lane.
     */
    pianoPlan?: PianoPlan;
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
    classicalNotationMarks?: ClassicalNotationMark[];
    lastPitch?: number;
    lastBassPitch?: number;
    lastInterval?: number;
    transform?: SectionTransformSummary;
    pianoVoiceLayout?: PianoVoiceLayoutSummary;

    // ── Piano projection evidence (flat fields) ──────────────────────────────
    // Populated by computePianoProjectionEvidence() / applyPianoProjection().
    // Allows evaluators to distinguish "sounds good in MIDI" from
    // "actually playable on piano" without unwrapping a nested object.

    /** Pitch range of right-hand (melody) events, MIDI numbers. */
    pianoRightHandPitchMin?: number;
    pianoRightHandPitchMax?: number;
    /** Pitch range of left-hand (accompaniment) events, MIDI numbers. */
    pianoLeftHandPitchMin?: number;
    pianoLeftHandPitchMax?: number;

    /** Note events per measure for each hand. */
    pianoRightHandDensity?: number;
    pianoLeftHandDensity?: number;
    /** Maximum simultaneous interval span observed across either hand (semitones). */
    pianoHandSpanMax?: number;
    /** Average of the two hands' maximum spans (semitones). */
    pianoHandSpanAverage?: number;

    /** Largest melodic leap in right-hand / left-hand voice (semitones). */
    pianoLeapMaxRight?: number;
    pianoLeapMaxLeft?: number;
    /** Mean absolute melodic interval in right-hand / left-hand voice. */
    pianoLeapAverageRight?: number;
    pianoLeapAverageLeft?: number;

    /** Ratio of chord events to all non-rest events (0–1). */
    pianoChordDensity?: number;
    /** Largest simultaneous note count seen in any single chord event. */
    pianoMaxSimultaneousNotes?: number;
    /** Number of chords spanning more than a major 9th (14 semitones) — awkward. */
    pianoAwkwardChordCount?: number;

    /** Number of events where the left-hand top note exceeds the right-hand bottom note. */
    pianoHandCrossingCount?: number;
    /** Number of events where left and right hands collide on the same pitch/beat. */
    pianoRegisterCollisionCount?: number;
    /** Fraction of consecutive events that are exactly one octave apart (0–1). */
    pianoRepeatedOctaveRate?: number;

    /** Number of pedal-on/off events or pedal change points detected. */
    pianoPedalChangeCount?: number;
    /**
     * Estimated risk that sustain pedal will blur distinct harmonies (0–1).
     * High chord density + large spans + many pedal events → high risk.
     */
    pianoPedalBlurRisk?: number;

    /**
     * Overall hand playability score (0–1).
     * 1.0 = all spans are comfortable; 0.0 = spans exceed the hard ceiling.
     * Derived from pianoVoiceLayout.playableSpanFit if available.
     */
    pianoPlayabilityScore?: number;
    /**
     * Overall piano idiomatic texture score (0–1).
     * Rewards: no collision, spans in range, moderate leaps, balanced density.
     * Penalises: collisions, unplayable spans, extreme leaps, one-hand dominance.
     */
    pianoIdiomaticTextureScore?: number;
}

export interface PianoVoiceLayoutSummary {
    /**
     * Minimum MIDI pitch observed in the right-hand voice(s).
     * Idiomatic range upper boundary: C4 (60) – C8 (108).
     */
    rightHandPitchMin?: number;
    rightHandPitchMax?: number;
    /**
     * Minimum MIDI pitch observed in the left-hand voice(s).
     * Idiomatic range lower boundary: C1 (24) – C5 (72).
     */
    leftHandPitchMin?: number;
    leftHandPitchMax?: number;
    /**
     * Maximum simultaneous interval span observed within a single hand (semitones).
     * Spans > 19 (a minor 13th) are generally unplayable without arpeggiation.
     */
    maxRightHandSpan?: number;
    maxLeftHandSpan?: number;
    /**
     * Number of events where the left-hand top note is higher than the
     * right-hand bottom note (hand crossing).
     */
    handCrossingCount?: number;
    /**
     * Number of events where left and right hands collide on the same pitch
     * within the same beat.
     */
    handCollisionCount?: number;
    /** Average simultaneous voice count across all chordal events. */
    avgChordVoiceCount?: number;
    /**
     * Number of events that carry explicit pedal markings or are flagged for
     * pedal use by the humanizer.
     */
    pedalEventCount?: number;
    /**
     * Proportion of chordal events that are within playable span thresholds (0–1).
     */
    playableSpanFit?: number;
    notes?: string[];
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

export interface CraftScoreSummary {
    /** ABC / MIDI syntax successfully parsed and structure intact (0–1) */
    syntaxValidity: number;
    /** Expected section count, measure counts, role order, and final section presence (0–1) */
    sectionContractFit: number;
    /** Final bass dominant-tonic motion, melodic resolution, and harmonic support (0–1) */
    cadenceStrength: number;
    /** Final / recap tonal center matching home key (0–1) */
    tonalReturn: number;
    /** theme_a interval-contour reappearance in recap / variation sections (0–1) */
    motifSurvival: number;
    /** lead / counterline / bass rhythmic independence and contrary-motion presence (0–1) */
    voiceIndependence: number;
    /** Phrase-role alignment with note density, rest placement, and cadence position (0–1) */
    phraseShape: number;
    /** Violin / Viola / Cello pitches within idiomatic ranges (0–1) */
    registerIdiomaticFit: number;
    /** Weighted composite: 0.15*sectionContractFit + 0.15*cadenceStrength + 0.15*tonalReturn + 0.15*motifSurvival + 0.15*voiceIndependence + 0.10*phraseShape + 0.10*registerIdiomaticFit + 0.05*syntaxValidity */
    finalCraftScore: number;
    /** Optional per-dimension human-readable notes keyed by dimension name */
    dimensionNotes?: Record<string, string>;
}

// ─── Piano-specific craft scoring ────────────────────────────────────────────

/**
 * Piano craft score summary.
 *
 * Dimension weights (sum = 1.00):
 *   handPlayability              0.20  — gate dimension; unplayable ≠ piano
 *   melodicClarity               0.15
 *   bassCoherence                0.15
 *   voicingIdiomaticFit          0.12
 *   accompanimentPatternCoherence 0.12
 *   registerSpacing              0.10
 *   handIndependence             0.08
 *   pedalPlausibility            0.05
 *   difficultyFit                0.03
 *   ─────────────────────────────────
 *   total                        1.00
 */
export interface PianoCraftScoreSummary {
    /** Proportion of chordal events within playable span. Weight: 0.20. */
    handPlayability: number;
    /**
     * Right-hand melodic clarity: small average leaps, moderate density,
     * smooth contour. Incorporates leap penalty. Weight: 0.15.
     */
    melodicClarity: number;
    /**
     * Left-hand bass coherence: stepwise / pedal bass rewarded; leaping
     * LH penalised; bass pitch out of LH zone penalised. Weight: 0.15.
     */
    bassCoherence: number;
    /**
     * Idiomatic chord voicing: voice count fit + awkward-span ratio.
     * Replaces the former chordDensity + excessiveLeapPenalty split.
     * Weight: 0.12.
     */
    voicingIdiomaticFit: number;
    /**
     * Rhythmic regularity and pattern stability of accompaniment (LH).
     * Weight: 0.12.
     */
    accompanimentPatternCoherence: number;
    /**
     * Register separation between RH median and LH median (idiomatic spread).
     * Weight: 0.10.
     */
    registerSpacing: number;
    /**
     * Independence of the two hands: rewards density balance and contrary
     * motion; penalises one hand dominating or mirroring the other.
     * Weight: 0.08.
     */
    handIndependence: number;
    /**
     * Plausibility of pedal use given section texture and dynamics.
     * Weight: 0.05.
     */
    pedalPlausibility: number;
    /**
     * Fit between the plan's difficultyTarget and the realised span / density.
     * Weight: 0.03.
     */
    difficultyFit: number;
    /** Weighted composite (weights above sum to 1.00). */
    finalPianoScore: number;
    /** Optional per-dimension human-readable notes keyed by dimension name. */
    dimensionNotes?: Record<string, string>;
}

export interface StructureEvaluationReport {
    passed: boolean;
    score?: number;
    issues: string[];
    strengths: string[];
    metrics?: Record<string, number>;
    longSpan?: LongSpanEvaluationSummary;
    orchestration?: OrchestrationEvaluationSummary;
    classicalKnowledgeEvaluation?: ClassicalKnowledgeEvaluationSummary;
    sectionFindings?: SectionEvaluationFinding[];
    weakestSections?: SectionEvaluationFinding[];
    craftScoreSummary?: CraftScoreSummary;
    pianoCraftScoreSummary?: PianoCraftScoreSummary;
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
    classicalKnowledge?: ClassicalKnowledgeSummary;
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
    classicalKnowledge?: ClassicalKnowledgePlan;
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

// ─── Piano Intermediate Representation (Piano IR) ────────────────────────────
//
// PianoIR is the hand-aware planning layer between a CompositionPlan and the
// symbolic backend.  It answers questions that SectionArtifactSummary cannot:
//   • Which hand plays what register range?
//   • Is a given chord span playable without arpeggiation?
//   • What texture/pattern does each hand use per section?
//   • What is the pedal strategy?
//
// PianoPlan is attached to CompositionPlan as an optional field.  Its presence
// signals to the compose pipeline that the request must go through the piano
// lane (once activated) rather than the generic learned-symbolic lane.

export type PianoDifficulty = "easy" | "intermediate" | "advanced" | "virtuosic";

/**
 * Texture vocabulary for a single piano section.
 *
 * melody_accompaniment   — RH melody + LH Alberti/chord/broken-chord pattern
 * chorale                — four-part chorale-style (SATB-ish), both hands chords
 * alberti_bass           — classic Alberti bass in LH, singable melody in RH
 * broken_chord           — LH or RH broken arpeggiated chord (not Alberti pattern)
 * arpeggiated_texture    — both hands use rolled/arpeggio chords throughout
 * octave_melody          — RH melody doubled at octave; LH bass
 * counterpoint_two_voice — strict two-voice counterpoint (one voice per hand)
 * counterpoint_three_voice — three voices distributed across two hands
 * waltz_bass             — LH: bass note on beat 1 + chord on beats 2–3; RH melody
 * toccata                — fast repeated-note / perpetual-motion texture
 * nocturne               — LH wide arpeggios + RH ornamental cantabile melody
 * etude_figuration       — one hand plays a technical figuration pattern throughout
 */
export type PianoTextureKind =
    | "melody_accompaniment"
    | "chorale"
    | "alberti_bass"
    | "broken_chord"
    | "arpeggiated_texture"
    | "octave_melody"
    | "counterpoint_two_voice"
    | "counterpoint_three_voice"
    | "waltz_bass"
    | "toccata"
    | "nocturne"
    | "etude_figuration";

/**
 * Discrete accompaniment pattern identifiers.
 *
 * Used in PianoSectionPlan.accompanimentPattern to constrain prompts and
 * drive texture-coherence validation.
 */
export type AccompanimentPattern =
    | "alberti_bass"
    | "broken_chord"
    | "arpeggiated"
    | "wide_spread_arpeggio"
    | "block_chord"
    | "waltz_bass"
    | "octave_bass"
    | "scale_passage"
    | "repeated_figure"
    | "inner_voice_sigh"
    | "ornamental_turns"
    | "tremolo_octave";

/**
 * High-level piano style paradigms that map to texture sequences.
 *
 * classical_sonata    — Alberti bass / broken chord / counterpoint / chorale
 * romantic_character  — melody + wide arpeggiation / inner-voice / octave melody
 * nocturne            — cantabile melody / spread LH waves / sustained pedal
 * etude               — repeated figuration / toccata / progressive difficulty
 */
export type PianoStyleKind = "classical_sonata" | "romantic_character" | "nocturne" | "etude";

/**
 * Plan for one hand within a section.
 *
 * registerMin / registerMax are MIDI pitch numbers (inclusive).
 * maxComfortableSpan is the largest simultaneous chord span allowed for this
 * hand without requiring an arpeggiation marking (semitones; default 10 for
 * non-virtuosic writing, up to 19 for concert-level).
 */
export interface PianoHandPlan {
    hand: "left" | "right";
    /** Voice roles this hand is responsible for in the section. */
    primaryRoles: TextureRole[];
    /** Lowest MIDI pitch intended for this hand (inclusive). */
    registerMin: number;
    /** Highest MIDI pitch intended for this hand (inclusive). */
    registerMax: number;
    /**
     * Maximum simultaneous chord span in semitones before an arpeggio mark
     * is required.  19 = minor 13th (hard playability ceiling).
     */
    maxComfortableSpan: number;
    /** Whether intentional hand-crossing into the other hand's register is planned. */
    allowCrossing?: boolean;
    /** Whether repeated-octave tremolo figures are intended (e.g. toccata texture). */
    allowRepeatedOctaves?: boolean;
    /**
     * Target average simultaneous voice count for this hand per beat (1–6).
     * 1 = single-note line, 4 = full chord, 6 = dense concert texture.
     */
    densityTarget?: number;
}

/**
 * Pedal strategy for a section or movement.
 *
 * none       — no sustain pedal (staccato, early-keyboard style)
 * harmonic   — change pedal exactly on each harmony change
 * legato     — sustain pedal throughout most of the section (blur acceptable)
 * half_pedal — flutter / half-damper technique for colouristic effect
 * coloristic — free pedal beyond harmonic logic (impressionistic, extended technique)
 */
export interface PianoPedalPlan {
    enabled: boolean;
    strategy: "none" | "harmonic" | "legato" | "half_pedal" | "coloristic";
    /** Change pedal on every new harmony event (requires strategy = "harmonic"). */
    changeOnHarmony?: boolean;
    /**
     * Maximum number of consecutive measures where the pedal may be held
     * without change before a warning is emitted.
     */
    maxPedalMeasures?: number;
}

/**
 * Piano-specific plan for a single section.
 *
 * Sits alongside (not inside) SectionPlan so the symbolic backend can resolve
 * exact hand assignments, span checks, and pedal placement for each section
 * without modifying the generic section-planning types.
 */
export interface PianoSectionPlan {
    sectionId: string;
    textureKind: PianoTextureKind;
    rightHand: PianoHandPlan;
    leftHand: PianoHandPlan;
    pedal: PianoPedalPlan;
    /**
     * Discrete accompaniment pattern for this section.
     * Constrains the prompt builder and drives texture-coherence validation.
     */
    accompanimentPattern?: AccompanimentPattern;
    /**
     * Chord voicing strategy for chordal events:
     *   close       — all voices within one octave
     *   open        — voices spread beyond an octave (with gaps)
     *   drop_2      — standard drop-2 voicing (second voice from top dropped an octave)
     *   spread      — wide voicing across two or more octaves
     *   octave_doubled — outer voices doubled at the octave
     */
    voicingStrategy?: "close" | "open" | "drop_2" | "spread" | "octave_doubled";
    difficultyTarget: PianoDifficulty;
}

/**
 * Top-level piano plan attached to a CompositionPlan.
 *
 * Its presence signals to the compose pipeline that all sections must be
 * planned and evaluated through the piano IR layer.
 */
export interface PianoPlan {
    instrument: "Piano";
    difficultyTarget: PianoDifficulty;
    /** One PianoSectionPlan per section in CompositionPlan.sections. */
    sections: PianoSectionPlan[];
}

/**
 * Canonical grammar template for a single PianoTextureKind.
 *
 * Captures the default hand roles, register ranges, density targets,
 * accompaniment pattern, voicing strategy, and pedal strategy that define
 * each texture idiom.  Use `getTextureTemplate()` in pianoIR.ts to retrieve.
 *
 * These templates are the authoritative source for:
 *   • buildPianoSectionPlanFromTemplate()
 *   • buildPianoSectionPlanForStyle()
 *   • texture-coherence validation
 */
export interface PianoTextureTemplate {
    textureKind: PianoTextureKind;
    /** Style idioms this texture is characteristically used in. */
    styleHints: PianoStyleKind[];
    // Right-hand defaults
    rhRoles: TextureRole[];
    rhRegisterMin: number;
    rhRegisterMax: number;
    rhDensityTarget: number;
    // Left-hand defaults
    lhRoles: TextureRole[];
    lhRegisterMin: number;
    lhRegisterMax: number;
    lhDensityTarget: number;
    accompanimentPattern?: AccompanimentPattern;
    voicingStrategy: "close" | "open" | "drop_2" | "spread" | "octave_doubled";
    pedalStrategy: "none" | "harmonic" | "legato" | "half_pedal" | "coloristic";
    pedalChangeOnHarmony?: boolean;
    pedalMaxMeasures?: number;
    allowRepeatedOctaves?: boolean;
    /** Whether LH may extend into the RH register (e.g. chorale inner-voice writing). */
    allowCrossing?: boolean;
    /** One-sentence description of the texture idiom. */
    description: string;
}

// ─── Multi-movement cycle types ───────────────────────────────────────────────

export type MovementForm = "sonata_allegro" | "slow_ternary" | "scherzo_trio" | "rondo_finale";

export type MovementFunction = "opening_argument" | "lyrical_center" | "contrast" | "resolution";

export type CrossMovementRecallKind = "verbatim" | "transformed" | "fragmented";

export interface CrossMovementRecallPlan {
    /** Movement that contains the recall (the recalling movement). */
    movementId: string;
    /** Movement that originally stated the material. */
    sourceMovementId: string;
    /** Motif IDs recalled from the source movement. */
    motifIds: string[];
    kind: CrossMovementRecallKind;
    notes?: string[];
}

export interface MovementPlan {
    id: string;
    ordinal: 1 | 2 | 3 | 4;
    form: MovementForm;
    key: string;
    tempo: number;
    targetDurationSec: number;
    functionInCycle: MovementFunction;
    /** Motif IDs inherited from earlier movements. */
    inheritedMotifs: string[];
    /** Motif IDs introduced for the first time in this movement. */
    newMotifs: string[];
}

export interface SonataCyclePlan {
    title: string;
    totalDurationSec: number;
    globalKey: string;
    /** Motif IDs that appear in more than one movement. */
    globalMotifIds: string[];
    movements: MovementPlan[];
    crossMovementRecall: CrossMovementRecallPlan[];
    /** Tension values (0–1) sampled uniformly across the full cycle, in ordinal order. */
    globalTensionCurve: number[];
}
