import type { SectionRole } from "./section.js";

export type CadenceStyle = "open" | "half" | "authentic" | "plagal" | "deceptive";

export type ProlongationMode = "tonic" | "dominant" | "sequential" | "pedal";

export type TonicizationEmphasis = "passing" | "prepared" | "arriving";

export type HarmonicDensity = "sparse" | "medium" | "rich";

export type VoicingProfile = "block" | "broken" | "arpeggiated";

export type HarmonicColorTag = "mixture" | "applied_dominant" | "predominant_color" | "suspension" | "prolongation" | "cadential_64" | "harmonic_rhythm_shift" | "neapolitan" | "aug6";

/** The three functions of tonal harmony: T → PD → D → T */
export type FunctionalHarmonyRole = "tonic" | "predominant" | "dominant";

/** Templates for the cadential approach at the end of a section. */
export type CadenceApproachTemplate = "basic" | "cad64" | "applied_dominant" | "extended";

/**
 * Shape of harmonic rhythm change over a section.
 * slow→fast: stable intro accelerating through continuation
 * fast→slow: dense opening settling to a cadence
 */
export type HarmonicRhythmShape = "slow" | "slow→fast" | "fast→slow" | "uniform" | "arch";

/**
 * High-level harmony grammar annotation for a section.
 * Produced by `applyHarmonyGrammarToSections()` in `harmonyGrammar.ts`.
 */
export interface HarmonyGrammarPlan {
    /** Ordered functional roles the section is expected to traverse. */
    functionalSequence: FunctionalHarmonyRole[];
    /** Cadential approach template at the end of the section. */
    cadenceApproach: CadenceApproachTemplate;
    /** If set, which function should be prolonged (tonic pedal, dominant pedal, etc.). */
    prolongationMode?: ProlongationMode;
    /** Suggested local tonicization window. */
    tonicization?: TonicizationWindow;
    /** Suggested applied-dominant color cues within the section. */
    appliedDominantCues?: HarmonicColorCue[];
    /** Preferred harmonic rhythm shape for this section. */
    harmonicRhythmShape?: HarmonicRhythmShape;
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
