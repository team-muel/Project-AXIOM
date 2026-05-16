import type { ArticulationTag, CadentialBuildup, CharacterTag, ContinuationPressure, DynamicsProfile, ExpressionGuidance, OrnamentPlan, PhraseBreathPlan, PhraseFunction, PhraseSpanShape, SectionOrnamentSummary, SectionPhraseBreathSummary, SectionTempoMotionSummary, TempoMotionPlan, TextureGuidance, TextureRole } from "./expression.js";
import type { CadenceStyle, HarmonicColorCue, HarmonicDensity, HarmonicPlan, HarmonyGrammarPlan, ProlongationMode, SectionHarmonicRealizationSummary, TonicizationWindow, VoicingProfile } from "./harmony.js";
import type { InstrumentAssignment } from "./orchestration.js";
import type { ClassicalNotationMark } from "./classical.js";
import type { MotifDevelopmentPlan } from "./motif.js";
import type { PianoVoiceLayoutSummary } from "./piano.js";

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

export type ExpositionPhase = "primary" | "secondary";

export type DevelopmentType = "motivic" | "textural" | "free";

export type RecapMode = "full" | "abbreviated" | "varied";

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
    /** Phrase grammar plan annotated by phraseGrammar.ts during sketch materialization */
    phraseGrammar?: PhraseGrammarPlan;
    /** Harmony grammar plan annotated by harmonyGrammar.ts during sketch materialization */
    harmonyGrammar?: HarmonyGrammarPlan;
    /** Motif development plan annotated by motifDevelopment.ts during sketch materialization */
    motifDevelopment?: MotifDevelopmentPlan;
    notes?: string[];
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
    /** Overall tonic key string for the section (e.g. "C major", "G minor"). */
    tonicKey?: string;
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
    /** Per-section RH/LH event arrays from piano projection (solo_piano_symbolic lane). */
    rightHandEvents?: SectionRenderEventArtifact[];
    leftHandEvents?: SectionRenderEventArtifact[];

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

// ─── Phrase Grammar Types ─────────────────────────────────────────────────────

export type PhraseUnitRole =
    | "basic_idea"
    | "repetition"
    | "continuation"
    | "cadential"
    | "antecedent"
    | "consequent"
    /** Independent phrase in a phrase_group (neither antecedent nor consequent). */
    | "phrase";

export interface PhraseUnit {
    role: PhraseUnitRole;
    measures: number;
    startMeasure: number;
    endMeasure?: number;
    cadenceType?: CadenceStyle;
    peakMeasure?: number;
}

export interface SentenceStructure {
    type: "sentence";
    totalMeasures: number;
    basicIdea: PhraseUnit;
    repetition: PhraseUnit;
    continuation: PhraseUnit;
    cadential: PhraseUnit;
}

export interface PeriodStructure {
    type: "period";
    totalMeasures: number;
    antecedent: PhraseUnit;
    consequent: PhraseUnit;
}

/** Two independent phrases each ending with an authentic cadence (no HC/PAC pairing). */
export interface PhraseGroupStructure {
    type: "phrase_group";
    totalMeasures: number;
    phrases: PhraseUnit[];
}

export interface HypermetricGroup {
    type: "2bar" | "4bar" | "8bar";
    startMeasure: number;
    endMeasure: number;
    phraseUnit: PhraseUnitRole;
    cadenceAtEnd?: CadenceStyle;
}

// ─── Phrase Expansion / Elision ───────────────────────────────────────────────

export type PhraseExpansionType = "internal" | "cadential_extension" | "prefix" | "suffix";

/** Describes how a canonical phrase length is stretched or prefixed/suffixed. */
export interface PhraseExpansion {
    type: PhraseExpansionType;
    /** Number of extra measures added beyond the canonical phrase length. */
    extraMeasures: number;
    /** For internal / cadential_extension: the measure after which the expansion inserts. */
    insertAfterMeasure?: number;
}

/** Measure where the previous phrase's cadence doubles as this phrase's downbeat (overlap). */
export interface PhraseElision {
    /** The shared measure number (cadence of phrase N = downbeat of phrase N+1). */
    elisionMeasure: number;
}

// ─── PhrasePlan — per-phrase operator metadata ────────────────────────────────

/** The function a phrase unit serves in the larger musical discourse. */
export type PhraseFunctionRole =
    | "presentation"
    | "continuation"
    | "cadential"
    | "antecedent"
    | "consequent";

/**
 * Operator-visible metadata that annotates one phrase (or phrase-group).
 * Attached to PhraseGrammarPlan.phrasePlan and consumed by the phrase grammar
 * scoring and composition guidance layers.
 */
export interface PhrasePlan {
    phraseType: "sentence" | "period" | "phrase_group";
    phraseFunction: PhraseFunctionRole;
    /** The hypermetric beat unit: how many measures one "hyperbeat" spans. */
    hypermeterUnit: 2 | 4 | 8;
    /** Structural cadence placement within this phrase. */
    cadencePlacement?: {
        /** 1-based measure number where the cadence resolves. */
        measure: number;
        cadenceType: CadenceStyle;
    };
    /** Optional phrase expansion applied to the canonical length. */
    phraseExpansion?: PhraseExpansion;
    /** Present when this phrase is elided with the preceding one. */
    elision?: PhraseElision;
}

export interface PhraseGrammarPlan {
    structure: SentenceStructure | PeriodStructure | PhraseGroupStructure;
    hypermetricGroups: HypermetricGroup[];
    totalMeasures: number;
    /** Per-phrase operator metadata computed alongside the structural plan. */
    phrasePlan?: PhrasePlan;
    notes: string[];
}
