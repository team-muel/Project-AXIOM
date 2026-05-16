import type { SectionRole } from "./section.js";
import type { ThematicTransformationCheckpoint } from "./motif.js";
import type { RevisionDirectiveKind } from "./evaluation.js";

export type LongSpanPressure = "low" | "medium" | "high";

export type ReturnPayoffStrength = "subtle" | "clear" | "inevitable";

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
