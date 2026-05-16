import type { SectionRole } from "./section.js";

export type CadenceStyle = "open" | "half" | "authentic" | "plagal" | "deceptive";

export type ProlongationMode = "tonic" | "dominant" | "sequential" | "pedal";

export type TonicizationEmphasis = "passing" | "prepared" | "arriving";

export type HarmonicDensity = "sparse" | "medium" | "rich";

export type VoicingProfile = "block" | "broken" | "arpeggiated";

export type HarmonicColorTag = "mixture" | "applied_dominant" | "predominant_color" | "suspension";

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
