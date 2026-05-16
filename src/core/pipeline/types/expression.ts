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
