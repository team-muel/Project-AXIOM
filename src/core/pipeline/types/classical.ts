import type { HumanizationStyle, PhraseSpanShape } from "./expression.js";
import type { HarmonicColorTag } from "./harmony.js";

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
