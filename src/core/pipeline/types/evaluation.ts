import type { AudioKeyTrackingReport } from "./harmony.js";
import type { OrchestrationEvaluationSummary } from "./orchestration.js";
import type { ClassicalKnowledgeEvaluationSummary } from "./classical.js";
import type { SectionEvaluationFinding, SectionRole } from "./section.js";
import type { AudioLongSpanEvaluationSummary, LongSpanEvaluationSummary } from "./longspan.js";
import type { PianoCraftScoreSummary } from "./piano.js";

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

    // ── Supplementary quality metrics (not included in finalCraftScore formula) ─

    /** Variety of motif transform techniques across sections (sequence, fragmentation, inversion, etc.) 0–1 */
    motifTransformVariety?: number;
    /** Variance in harmonic rhythm rate across sections (0 = uniform, 1 = high contrast) */
    harmonicRhythmVariance?: number;
    /** Texture profile diversity across sections (distinct lead/counterpoint/texture roles) 0–1 */
    textureProfileScore?: number;
    /** PAC/HC weight at structurally critical positions (recap, cadence, final section) 0–1 */
    cadenceArchitecturalWeight?: number;
    /** Sentence/period/hypermeter alignment and phrase peak coverage score 0–1 */
    phraseGrammarScore?: number;
    /** Proxy for parallel 5th/8th avoidance via contrary motion + stepwise resolution (0–1) */
    voiceLeadingScore?: number;
    /** Richness of tonicization windows across sections; rewards foreign key variety (0–1) */
    tonicizationDepthScore?: number;
    /** Per-section PhraseGrammarPlan-aware phrase grammar quality, averaged across sections (0–1) */
    planAwarePhraseGrammarScore?: number;
}

// ─── Piano-specific craft scoring ────────────────────────────────────────────

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
