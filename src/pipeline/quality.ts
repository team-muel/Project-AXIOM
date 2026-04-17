import type {
    ArticulationTag,
    AudioLongSpanEvaluationDimension,
    AudioEvaluationReport,
    CharacterTag,
    ComposeExecutionPlan,
    ComposeQualityPolicy,
    ComposeRequest,
    ComposeWorkflow,
    ExpressionGuidance,
    HarmonicColorCue,
    OrnamentPlan,
    PhraseFunction,
    PlanRiskProfile,
    RevisionDirective,
    SectionArtifactSummary,
    SectionPlan,
    LongSpanDivergenceSummary,
    StructureEvaluationReport,
    StructureVisibility,
    TempoMotionPlan,
    TextureGuidance,
} from "./types.js";
import { buildFallbackSectionsForForm, resolveFormTemplateQualityProfile } from "./formTemplates.js";
import { recommendedDirectiveForAudioLongSpanDimension, summarizeLongSpanDivergence } from "./longSpan.js";

const DEFAULT_MAX_STRUCTURE_ATTEMPTS = 3;
const MAX_STRUCTURE_ATTEMPTS = 5;
const DEFAULT_TARGET_STRUCTURE_SCORE = 78;
const DEFAULT_TARGET_AUDIO_SCORE = 84;

const GRAND_FORM_PATTERNS = ["symphony", "concerto", "orchestral", "cantata", "mass", "requiem", "tone poem", "long", "largo"];
const FORMAL_CLASSICAL_PATTERNS = ["sonata", "rondo", "suite", "fantasia", "variation"];
const CHAMBER_PATTERNS = ["trio", "quartet", "quartett", "quintet", "sextet", "octet", "chamber"];
const SHORT_FORM_PATTERNS = ["prelude", "nocturne", "waltz", "lullaby", "miniature", "intermezzo", "bagatelle", "short"];
const SOFT_ISSUE_PREFIXES = [
    "Excessive repetition",
    "Limited pitch-class variety",
    "Rhythm is too uniform",
    "Too many wide leaps",
    "Large leaps are not balanced",
    "Parallel perfect intervals weaken",
    "Cadential bass motion does not",
    "Modulation path does not land",
    "Dominant preparation is weak",
    "Recap does not re-establish the opening tonic",
    "Piece-level harmonic route is not yet coherent enough",
    "Final melodic note does not resolve",
    "Section tension arc diverges",
    "Register planning drifts from the intended section targets",
    "Bass cadence approach does not match the planned sectional closes",
    "Section phrase rhetoric drifts from the planned formal roles",
    "Section phrase function does not match the planned formal rhetoric",
    "Section phrase pressure compresses the planned formal contrast",
    "Section phrase pressure compresses instead of projecting the planned formal role",
    "Section texture drift weakens the planned voice-count and role profile",
    "Section texture plan does not preserve the planned voice-count or role layout",
    "Section counterpoint cue does not match the planned texture profile",
    "Section expression drift weakens the planned dynamic and articulation profile",
    "Section dynamics drift from the planned expression contour",
    "Section articulation or character does not match the planned expression profile",
    "Tempo-motion cues do not survive strongly enough after humanized realization",
    "Tempo-motion windows do not contain enough realized activity to read clearly",
    "Section tempo motion does not survive humanized realization strongly enough",
    "Tempo-motion coverage is too sparse across the targeted measures",
    "Tempo-motion window lacks enough realized note activity to read clearly",
    "Section tempo motion does not accumulate enough local timing contrast",
    "Section tonicization pressure is too weak for the planned harmonic roles",
    "Section tonicization pressure is too weak to project the planned harmonic role",
    "Planned harmonic color does not survive clearly enough across the weak sections",
    "Section harmonic color cues do not survive clearly enough to project the planned local color event",
    "Section harmonic color coverage drops planned local color cues before realization",
    "Section harmonic color target or resolution drifts away from the planned local event",
    "Section prolongation stays too static for the planned harmonic roles",
    "Section prolongation stays too static for its planned harmonic role",
];
const HARD_ISSUE_PREFIXES = ["Too few notes", "Piece too short"];
const DYNAMIC_LEVELS = ["pp", "p", "mp", "mf", "f", "ff"] as const;

type QualityProfileName = "sonata_large_form" | "grand_form" | "formal_classical" | "chamber_ensemble" | "lyric_short_form" | "default";
type PlannedLongSpanForm = NonNullable<NonNullable<ComposeRequest["compositionPlan"]>["longSpanForm"]>;

interface QualityProfileDefaults {
    structureTarget: number;
    audioTarget: number;
    maxStructureAttempts: number;
}

const QUALITY_PROFILE_DEFAULTS: Record<QualityProfileName, QualityProfileDefaults> = {
    sonata_large_form: {
        structureTarget: 86,
        audioTarget: 88,
        maxStructureAttempts: 5,
    },
    grand_form: {
        structureTarget: 86,
        audioTarget: 90,
        maxStructureAttempts: 4,
    },
    formal_classical: {
        structureTarget: 83,
        audioTarget: 87,
        maxStructureAttempts: 4,
    },
    chamber_ensemble: {
        structureTarget: 82,
        audioTarget: 85,
        maxStructureAttempts: 4,
    },
    lyric_short_form: {
        structureTarget: 76,
        audioTarget: 80,
        maxStructureAttempts: 3,
    },
    default: {
        structureTarget: DEFAULT_TARGET_STRUCTURE_SCORE,
        audioTarget: DEFAULT_TARGET_AUDIO_SCORE,
        maxStructureAttempts: DEFAULT_MAX_STRUCTURE_ATTEMPTS,
    },
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function normalizeForm(form?: string): string {
    return String(form ?? "").trim().toLowerCase();
}

function getPlanIntent(request: ComposeRequest | undefined): {
    riskProfile?: PlanRiskProfile;
    structureVisibility?: StructureVisibility;
} {
    return {
        riskProfile: request?.compositionPlan?.riskProfile,
        structureVisibility: request?.compositionPlan?.structureVisibility,
    };
}

function isSoftIssue(issue: string): boolean {
    return SOFT_ISSUE_PREFIXES.some((prefix) => issue.startsWith(prefix));
}

function hasHardIssue(issues: string[]): boolean {
    return issues.some((issue) => HARD_ISSUE_PREFIXES.some((prefix) => issue.startsWith(prefix)));
}

function scoreRetryMargin(riskProfile: PlanRiskProfile | undefined): number {
    if (riskProfile === "experimental") {
        return 12;
    }
    if (riskProfile === "exploratory") {
        return 6;
    }
    return 0;
}

function tuneDirectivePriority(
    directive: RevisionDirective,
    riskProfile: PlanRiskProfile | undefined,
    structureVisibility: StructureVisibility | undefined,
): RevisionDirective {
    let priority = directive.priority;

    if (riskProfile === "experimental") {
        if (directive.kind === "strengthen_cadence") {
            priority -= structureVisibility === "transparent" ? 16 : 30;
        }
        if (directive.kind === "stabilize_harmony") {
            priority -= structureVisibility === "transparent" ? 6 : 14;
        }
        if (directive.kind === "reduce_large_leaps") {
            priority -= 16;
        }
        if (directive.kind === "reduce_repetition") {
            priority -= 10;
        }
        if (directive.kind === "increase_pitch_variety" || directive.kind === "increase_rhythm_variety") {
            priority += 8;
        }
        if (directive.kind === "clarify_phrase_rhetoric") {
            priority -= structureVisibility === "transparent" ? 0 : 6;
        }
        if (directive.kind === "clarify_harmonic_color") {
            priority -= structureVisibility === "transparent" ? 0 : 4;
        }
        if (directive.kind === "clarify_texture_plan") {
            priority -= structureVisibility === "transparent" ? 0 : 4;
        }
        if (directive.kind === "clarify_narrative_arc") {
            priority += 10;
        }
        if (directive.kind === "rebalance_recap_release") {
            priority -= structureVisibility === "transparent" ? 2 : 8;
        }
    } else if (riskProfile === "exploratory") {
        if (directive.kind === "strengthen_cadence") {
            priority -= structureVisibility === "transparent" ? 8 : 18;
        }
        if (directive.kind === "stabilize_harmony") {
            priority -= structureVisibility === "transparent" ? 2 : 8;
        }
        if (directive.kind === "reduce_large_leaps") {
            priority -= 8;
        }
        if (directive.kind === "increase_pitch_variety" || directive.kind === "increase_rhythm_variety") {
            priority += 4;
        }
        if (directive.kind === "clarify_phrase_rhetoric") {
            priority -= structureVisibility === "transparent" ? 0 : 3;
        }
        if (directive.kind === "clarify_harmonic_color") {
            priority -= structureVisibility === "transparent" ? 0 : 2;
        }
        if (directive.kind === "clarify_narrative_arc") {
            priority += 6;
        }
        if (directive.kind === "rebalance_recap_release") {
            priority -= structureVisibility === "transparent" ? 0 : 4;
        }
    }

    if (structureVisibility === "hidden" || structureVisibility === "complex") {
        if (directive.kind === "strengthen_cadence") {
            priority -= 10;
        }
        if (directive.kind === "stabilize_harmony") {
            priority -= 6;
        }
        if (directive.kind === "increase_pitch_variety") {
            priority += 4;
        }
        if (directive.kind === "clarify_phrase_rhetoric") {
            priority -= 6;
        }
        if (directive.kind === "clarify_harmonic_color") {
            priority -= 4;
        }
        if (directive.kind === "clarify_texture_plan") {
            priority -= 3;
        }
        if (directive.kind === "clarify_narrative_arc") {
            priority += 4;
        }
        if (directive.kind === "rebalance_recap_release") {
            priority -= 4;
        }
    }

    return {
        ...directive,
        priority: clamp(Math.trunc(priority), 1, 120),
    };
}

function matchesAnyPattern(form: string, patterns: string[]): boolean {
    return patterns.some((pattern) => form.includes(pattern));
}

function clampAttemptCount(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.trunc(clamp(value, 1, MAX_STRUCTURE_ATTEMPTS));
}

function appendDirective(
    bucket: Map<RevisionDirective["kind"], RevisionDirective>,
    directive: RevisionDirective,
): void {
    const existing = bucket.get(directive.kind);
    if (!existing) {
        bucket.set(directive.kind, directive);
        return;
    }

    const winner = directive.priority > existing.priority ? directive : existing;
    const sectionIds = Array.from(new Set([...(existing.sectionIds ?? []), ...(directive.sectionIds ?? [])]));
    bucket.set(directive.kind, sectionIds.length > 0 ? { ...winner, sectionIds } : winner);
}

function uniqueNotes(notes: string[] | undefined, additions: string[]): string[] {
    return Array.from(new Set([...(notes ?? []), ...additions.map((value) => value.trim()).filter(Boolean)]));
}

function hasIssuePrefix(issue: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => issue.startsWith(prefix));
}

function sectionFindingMatchesIssuePrefixes(
    finding: NonNullable<StructureEvaluationReport["sectionFindings"]>[number],
    prefixes: string[],
): boolean {
    return prefixes.length > 0 && finding.issues.some((issue) => hasIssuePrefix(issue, prefixes));
}

function audioSectionFindingMatchesIssuePrefixes(
    finding: NonNullable<AudioEvaluationReport["sectionFindings"]>[number],
    prefixes: string[],
): boolean {
    return prefixes.length > 0 && finding.issues.some((issue) => hasIssuePrefix(issue, prefixes));
}

function metricValue(metrics: Record<string, number> | undefined, key: string): number | undefined {
    const value = metrics?.[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function inverseMetricSeverity(metrics: Record<string, number> | undefined, key: string, maxValue = 1): number {
    const value = metricValue(metrics, key);
    if (value === undefined || maxValue <= 0) {
        return 0;
    }

    return clamp(1 - (clamp(value, 0, maxValue) / maxValue), 0, 1);
}

function directMetricSeverity(metrics: Record<string, number> | undefined, key: string, maxValue = 1): number {
    const value = metricValue(metrics, key);
    if (value === undefined || maxValue <= 0) {
        return 0;
    }

    return clamp(value / maxValue, 0, 1);
}

function scoreSectionFindingSeverity(
    directiveKind: RevisionDirective["kind"],
    finding: NonNullable<StructureEvaluationReport["sectionFindings"]>[number],
): number {
    const metrics = finding.metrics;
    const structuralSeverity = clamp(1 - (clamp(finding.score, 0, 100) / 100), 0, 1);
    const issueSeverity = clamp(finding.issues.length / 4, 0, 1);

    let severity = structuralSeverity * 0.35;
    severity += issueSeverity * 0.15;

    if (directiveKind === "strengthen_cadence") {
        severity += inverseMetricSeverity(metrics, "cadenceStrengthFit") * 0.4;
        severity += inverseMetricSeverity(metrics, "harmonicCadenceSupport") * 0.3;
        severity += inverseMetricSeverity(metrics, "actualCadenceStrength") * 0.25;
        severity += inverseMetricSeverity(metrics, "cadenceApproachFit") * 0.22;
    } else if (directiveKind === "stabilize_harmony") {
        severity += inverseMetricSeverity(metrics, "sectionHarmonicPlanFit") * 0.35;
        severity += inverseMetricSeverity(metrics, "tonalCenterFit") * 0.28;
        severity += inverseMetricSeverity(metrics, "modulationPlanFit") * 0.22;
        severity += inverseMetricSeverity(metrics, "harmonicCadenceSupport") * 0.15;
        severity += inverseMetricSeverity(metrics, "tonicizationPressureFit") * 0.22;
        severity += inverseMetricSeverity(metrics, "prolongationMotionFit") * 0.18;
    } else if (directiveKind === "clarify_harmonic_color") {
        severity += inverseMetricSeverity(metrics, "harmonicColorPlanFit") * 0.42;
        severity += inverseMetricSeverity(metrics, "harmonicColorCoverageFit") * 0.28;
        severity += inverseMetricSeverity(metrics, "harmonicColorTargetFit") * 0.2;
        severity += inverseMetricSeverity(metrics, "harmonicColorTimingFit") * 0.14;
    } else if (directiveKind === "expand_register") {
        severity += inverseMetricSeverity(metrics, "registerCenterFit") * 0.48;
        severity += inverseMetricSeverity(metrics, "orchestrationRangeFit") * 0.34;
        severity += inverseMetricSeverity(metrics, "orchestrationBalanceFit") * 0.24;
        severity += inverseMetricSeverity(metrics, "orchestrationDoublingFit") * 0.14;
        severity += inverseMetricSeverity(metrics, "orchestrationTextureRotationFit") * 0.16;
        severity += inverseMetricSeverity(metrics, "orchestrationHandoffFit") * 0.18;
    } else if (directiveKind === "clarify_phrase_rhetoric") {
        severity += inverseMetricSeverity(metrics, "phraseFunctionFit") * 0.52;
        severity += inverseMetricSeverity(metrics, "phrasePressureFit") * 0.28;
    } else if (directiveKind === "clarify_texture_plan") {
        severity += inverseMetricSeverity(metrics, "texturePlanFit") * 0.36;
        severity += inverseMetricSeverity(metrics, "textureRoleFit") * 0.2;
        severity += inverseMetricSeverity(metrics, "textureVoiceCountFit") * 0.14;
        severity += inverseMetricSeverity(metrics, "counterpointModeFit") * 0.12;
        severity += inverseMetricSeverity(metrics, "textureIndependenceFit") * 0.22;
        severity += inverseMetricSeverity(metrics, "counterpointBehaviorFit") * 0.18;
        severity += inverseMetricSeverity(metrics, "imitationFit") * 0.18;
        severity += inverseMetricSeverity(metrics, "orchestrationBalanceFit") * 0.24;
        severity += inverseMetricSeverity(metrics, "orchestrationConversationFit") * 0.28;
        severity += inverseMetricSeverity(metrics, "orchestrationDoublingFit") * 0.24;
        severity += inverseMetricSeverity(metrics, "orchestrationTextureRotationFit") * 0.22;
        severity += inverseMetricSeverity(metrics, "orchestrationHandoffFit") * 0.26;
    } else if (directiveKind === "shape_dynamics") {
        severity += inverseMetricSeverity(metrics, "dynamicsPlanFit") * 0.5;
        severity += inverseMetricSeverity(metrics, "expressionPlanFit") * 0.18;
    } else if (directiveKind === "clarify_expression") {
        severity += inverseMetricSeverity(metrics, "articulationPlanFit") * 0.28;
        severity += inverseMetricSeverity(metrics, "characterPlanFit") * 0.2;
        severity += inverseMetricSeverity(metrics, "phrasePeakPlanFit") * 0.12;
        severity += inverseMetricSeverity(metrics, "expressionPlanFit") * 0.18;
    } else if (directiveKind === "clarify_narrative_arc") {
        severity += inverseMetricSeverity(metrics, "modulationPlanFit") * 0.4;
        severity += directMetricSeverity(metrics, "tensionMismatch") * 0.25;
    } else if (directiveKind === "rebalance_recap_release") {
        severity += inverseMetricSeverity(metrics, "cadenceStrengthFit") * 0.25;
        severity += inverseMetricSeverity(metrics, "actualCadenceStrength") * 0.2;
    }

    return clamp(severity, 0, 1);
}

function scoreAudioSectionFindingSeverity(
    finding: NonNullable<AudioEvaluationReport["sectionFindings"]>[number],
    metricKeys: string[] = [],
): number {
    const compositeSeverity = clamp(1 - clamp(finding.score, 0, 1), 0, 1);
    const issueSeverity = clamp(finding.issues.length / 3, 0, 1);
    const metricValues = metricKeys
        .map((key) => inverseMetricSeverity(finding.metrics, key))
        .filter((value) => value > 0);
    const metricSeverity = metricValues.length > 0
        ? metricValues.reduce((sum, value) => sum + value, 0) / metricValues.length
        : 0;

    return clamp(
        (compositeSeverity * 0.42)
        + (issueSeverity * 0.18)
        + (metricSeverity * 0.4),
        0,
        1,
    );
}

function boostDirectivePriorityFromTargets(
    directive: RevisionDirective,
    evaluation: StructureEvaluationReport,
): RevisionDirective {
    if (!directive.sectionIds?.length) {
        return directive;
    }

    const sectionFindings = evaluation.sectionFindings ?? evaluation.weakestSections ?? [];
    if (sectionFindings.length === 0) {
        return directive;
    }

    const targetSeverity = directive.sectionIds
        .map((sectionId) => sectionFindings.find((finding) => finding.sectionId === sectionId))
        .filter((finding): finding is NonNullable<StructureEvaluationReport["sectionFindings"]>[number] => Boolean(finding))
        .reduce((maxSeverity, finding) => Math.max(maxSeverity, scoreSectionFindingSeverity(directive.kind, finding)), 0);

    if (targetSeverity <= 0) {
        return directive;
    }

    return {
        ...directive,
        priority: directive.priority + Math.round(targetSeverity * 12),
    };
}

function directiveTargetsSection(directive: RevisionDirective, sectionId: string): boolean {
    return directive.sectionIds?.includes(sectionId) ?? false;
}

function hasGlobalDirective(directives: RevisionDirective[], kind: RevisionDirective["kind"]): boolean {
    return directives.some((directive) => directive.kind === kind && (!directive.sectionIds || directive.sectionIds.length === 0));
}

function hasTargetedDirective(directives: RevisionDirective[], kind: RevisionDirective["kind"], sectionId: string): boolean {
    return directives.some((directive) => directive.kind === kind && directiveTargetsSection(directive, sectionId));
}

function attachDirectiveSectionTargets(
    directive: RevisionDirective,
    evaluation: StructureEvaluationReport,
): RevisionDirective {
    if (directive.sectionIds?.length || directive.kind === "extend_length") {
        return directive;
    }

    const weakestSections = evaluation.weakestSections ?? [];
    const sectionFindings = evaluation.sectionFindings ?? weakestSections;
    if (sectionFindings.length === 0) {
        return directive;
    }

    const weakestIds = new Set(weakestSections.map((finding) => finding.sectionId));
    const issuePrefixesByKind: Partial<Record<RevisionDirective["kind"], string[]>> = {
        reduce_repetition: ["Limited local pitch variety"],
        expand_register: [
            "Narrow register span",
            "Tension arc mismatch",
            "Realized register center drifts from planned register target",
            "String-trio role writing drifts outside idiomatic ranges for the planned instruments",
            "String-trio register balance collapses and blurs the planned lead, middle, and bass layers",
            "String-trio doubling pressure thickens the lead too often and weakens independent instrument roles",
            "String-trio texture rotation does not reset conversation, balance, or spacing clearly enough from the previous section",
            "String-trio register handoff does not transfer lead, middle, and bass duties clearly enough",
        ],
        increase_pitch_variety: ["Limited local pitch variety"],
        increase_rhythm_variety: ["Limited local rhythm variety", "Tension arc mismatch", "Section note density does not support"],
        reduce_large_leaps: ["Unstable leap profile", "Local leaps do not recover stepwise"],
        clarify_phrase_rhetoric: [
            "Section phrase function does not match the planned formal rhetoric",
            "Section phrase pressure compresses instead of projecting the planned formal role",
        ],
        clarify_harmonic_color: [
            "Section harmonic color cues do not survive clearly enough to project the planned local color event",
            "Section harmonic color coverage drops planned local color cues before realization",
            "Section harmonic color target or resolution drifts away from the planned local event",
        ],
        clarify_texture_plan: [
            "Section texture plan does not preserve the planned voice-count or role layout",
            "Section counterpoint cue does not match the planned texture profile",
            "Section secondary line stays too static to support the planned independent texture",
            "Section contrary-motion cue is not strong enough between melody and secondary line",
            "Section counterpoint behavior is too weak to support the planned texture profile",
            "Section imitative cue does not preserve enough source-motif relation and answer-like motion",
            "Section imitative counterpoint does not sustain enough answer-like motion after realization",
            "String-trio register balance collapses and blurs the planned lead, middle, and bass layers",
            "String-trio doubling pressure thickens the lead too often and weakens independent instrument roles",
            "String-trio texture rotation does not reset conversation, balance, or spacing clearly enough from the previous section",
            "String-trio register handoff does not transfer lead, middle, and bass duties clearly enough",
            "String-trio conversational writing does not give the secondary string enough independent answer-like activity",
        ],
        shape_dynamics: ["Section dynamics drift from the planned expression contour"],
        clarify_expression: ["Section articulation or character does not match the planned expression profile"],
        stabilize_harmony: [
            "Parallel perfect intervals weaken",
            "Cadential bass motion does not support",
            "Section tonal center drifts from planned",
            "Section harmonic plan blocks the modulation expected",
            "Section harmonic plan allows modulation where the form expects a stable return",
            "Section harmonic plan does not read clearly for its formal role",
            "Section tonicization pressure is too weak to project the planned harmonic role",
            "Section prolongation stays too static for its planned harmonic role",
        ],
        strengthen_cadence: ["Section close does not settle convincingly", "Cadential bass motion does not support", "Cadence arrival is weaker than planned", "Cadence approach in the bass does not align with the planned close"],
        clarify_narrative_arc: ["Tension arc mismatch", "Section harmonic plan blocks the modulation expected"],
        rebalance_recap_release: ["Section close does not settle convincingly", "Cadence arrival is weaker than planned"],
    };
    const roleFallbacksByKind: Partial<Record<RevisionDirective["kind"], Array<SectionPlan["role"]>>> = {
        clarify_harmonic_color: ["theme_b", "development", "variation", "recap", "cadence", "outro"],
        stabilize_harmony: ["theme_b", "development", "recap", "cadence", "outro"],
        strengthen_cadence: ["recap", "cadence", "outro"],
        clarify_narrative_arc: ["development", "variation", "bridge"],
        rebalance_recap_release: ["recap", "cadence", "outro"],
    };

    const sourceIssuePrefixes = directive.sourceIssue?.trim() ? [directive.sourceIssue.trim()] : [];
    const issuePrefixes = issuePrefixesByKind[directive.kind] ?? [];
    const sourceIssueMatches = sourceIssuePrefixes.length > 0
        ? sectionFindings.filter((finding) => sectionFindingMatchesIssuePrefixes(finding, sourceIssuePrefixes))
        : [];
    let targetedFindings = sourceIssueMatches.length > 0
        ? sourceIssueMatches
        : issuePrefixes.length > 0
            ? sectionFindings.filter((finding) => sectionFindingMatchesIssuePrefixes(finding, issuePrefixes))
            : [];

    if (targetedFindings.length === 0) {
        const fallbackRoles = roleFallbacksByKind[directive.kind] ?? [];
        if (fallbackRoles.length > 0) {
            targetedFindings = sectionFindings.filter((finding) => fallbackRoles.includes(finding.role));
        }
    }

    if (weakestIds.size > 0) {
        const weakestTargets = targetedFindings.filter((finding) => weakestIds.has(finding.sectionId));
        if (weakestTargets.length > 0) {
            targetedFindings = weakestTargets;
        }
    }

    if (targetedFindings.length === 0 && weakestSections.length > 0) {
        targetedFindings = weakestSections;
    }

    targetedFindings = targetedFindings
        .slice()
        .sort((left, right) => (
            Number(weakestIds.has(right.sectionId)) - Number(weakestIds.has(left.sectionId))
            ||
            scoreSectionFindingSeverity(directive.kind, right) - scoreSectionFindingSeverity(directive.kind, left)
            || left.score - right.score
            || right.issues.length - left.issues.length
            || left.sectionId.localeCompare(right.sectionId)
        ));

    const maxTargets = directive.kind === "strengthen_cadence" || directive.kind === "rebalance_recap_release"
        ? 1
        : 2;
    const sectionIds = Array.from(new Set(targetedFindings.map((finding) => finding.sectionId).filter(Boolean))).slice(0, maxTargets);

    return sectionIds.length > 0
        ? { ...directive, sectionIds }
        : directive;
}

function planSections(request?: ComposeRequest): SectionPlan[] {
    return request?.compositionPlan?.sections ?? [];
}

function pickPlanSectionIdsByRoles(
    request: ComposeRequest | undefined,
    roles: Array<SectionPlan["role"]>,
    maxTargets = 2,
): string[] {
    return planSections(request)
        .filter((section) => roles.includes(section.role))
        .map((section) => section.id)
        .filter(Boolean)
        .slice(0, maxTargets);
}

function getPlannedLongSpanForm(request?: ComposeRequest): PlannedLongSpanForm | undefined {
    return request?.compositionPlan?.longSpanForm;
}

function uniqueSectionIds(sectionIds: Array<string | undefined>, maxTargets = sectionIds.length): string[] {
    return Array.from(new Set(sectionIds.filter((sectionId): sectionId is string => Boolean(sectionId)))).slice(0, maxTargets);
}

function pickPlanSectionIdsInRange(
    request: ComposeRequest | undefined,
    startSectionId: string | undefined,
    endSectionId: string | undefined,
    maxTargets = 2,
): string[] {
    const sections = planSections(request);
    if (sections.length === 0) {
        return [];
    }

    const orderedIds = sections.map((section) => section.id).filter(Boolean);
    const startIndex = startSectionId ? orderedIds.indexOf(startSectionId) : -1;
    const endIndex = endSectionId ? orderedIds.indexOf(endSectionId) : -1;

    if (startIndex >= 0 && endIndex >= 0) {
        const from = Math.min(startIndex, endIndex);
        const to = Math.max(startIndex, endIndex);
        return orderedIds.slice(from, to + 1).slice(0, maxTargets);
    }

    return uniqueSectionIds([startSectionId, endSectionId], maxTargets)
        .filter((sectionId) => orderedIds.includes(sectionId));
}

function prioritizePlanSectionIds(
    evaluation: StructureEvaluationReport,
    candidateIds: Array<string | undefined>,
    maxTargets = 2,
): string[] {
    const orderedIds = uniqueSectionIds(candidateIds);
    if (orderedIds.length === 0) {
        return [];
    }

    const weakestIds = new Set((evaluation.weakestSections ?? []).map((finding) => finding.sectionId));
    const findingById = new Map<string, NonNullable<StructureEvaluationReport["sectionFindings"]>[number]>();
    for (const finding of [...(evaluation.sectionFindings ?? []), ...(evaluation.weakestSections ?? [])]) {
        const existing = findingById.get(finding.sectionId);
        if (!existing || finding.score < existing.score || finding.issues.length > existing.issues.length) {
            findingById.set(finding.sectionId, finding);
        }
    }

    return orderedIds
        .slice()
        .sort((left, right) => {
            const weakestDelta = Number(weakestIds.has(right)) - Number(weakestIds.has(left));
            if (weakestDelta !== 0) {
                return weakestDelta;
            }

            const leftFinding = findingById.get(left);
            const rightFinding = findingById.get(right);
            if (leftFinding && rightFinding) {
                return leftFinding.score - rightFinding.score
                    || rightFinding.issues.length - leftFinding.issues.length
                    || orderedIds.indexOf(left) - orderedIds.indexOf(right);
            }
            if (leftFinding || rightFinding) {
                return leftFinding ? -1 : 1;
            }

            return orderedIds.indexOf(left) - orderedIds.indexOf(right);
        })
        .slice(0, maxTargets);
}

function pickLongSpanDevelopmentSectionIds(
    evaluation: StructureEvaluationReport,
    request?: ComposeRequest,
    maxTargets = 2,
): string[] {
    const longSpanForm = getPlannedLongSpanForm(request);
    const developmentRange = pickPlanSectionIdsInRange(
        request,
        longSpanForm?.developmentStartSectionId,
        longSpanForm?.developmentEndSectionId,
        maxTargets,
    );
    if (developmentRange.length > 0) {
        return prioritizePlanSectionIds(evaluation, developmentRange, maxTargets);
    }

    const sectionsById = new Map(planSections(request).map((section) => [section.id, section]));
    const checkpointTargets = uniqueSectionIds((longSpanForm?.thematicCheckpoints ?? [])
        .map((checkpoint) => checkpoint.targetSectionId)
        .filter((sectionId) => {
            const role = sectionsById.get(sectionId)?.role;
            return role === "development" || role === "variation" || role === "bridge";
        }));
    const prioritizedTargets = prioritizePlanSectionIds(evaluation, checkpointTargets, maxTargets);
    return prioritizedTargets.length > 0
        ? prioritizedTargets
        : pickPlanSectionIdsByRoles(request, ["development", "variation", "bridge"], maxTargets);
}

function pickLongSpanReturnSectionIds(
    evaluation: StructureEvaluationReport,
    request?: ComposeRequest,
    maxTargets = 1,
): string[] {
    const longSpanForm = getPlannedLongSpanForm(request);
    const prioritized = prioritizePlanSectionIds(evaluation, [
        longSpanForm?.delayedPayoffSectionId,
        longSpanForm?.returnSectionId,
        longSpanForm?.recapStartSectionId,
    ], maxTargets);
    return prioritized.length > 0
        ? prioritized
        : pickPlanSectionIdsByRoles(request, ["recap", "cadence", "outro"], maxTargets);
}

function pickLongSpanReturnBoundarySectionIds(
    evaluation: StructureEvaluationReport,
    request?: ComposeRequest,
    maxTargets = 2,
): string[] {
    const longSpanForm = getPlannedLongSpanForm(request);
    const prioritized = prioritizePlanSectionIds(evaluation, [
        longSpanForm?.retransitionSectionId,
        longSpanForm?.returnSectionId,
        longSpanForm?.recapStartSectionId,
        longSpanForm?.delayedPayoffSectionId,
    ], maxTargets);
    return prioritized.length > 0
        ? prioritized
        : pickPlanSectionIdsByRoles(request, ["bridge", "development", "recap", "cadence", "outro"], maxTargets);
}

function longSpanMetricSeverity(metrics: Record<string, number> | undefined, key: string, threshold: number): number {
    const value = metricValue(metrics, key);
    return value !== undefined && value < threshold
        ? Number((threshold - value).toFixed(4))
        : 0;
}

function hasWeakLongSpanStructure(metrics: Record<string, number> | undefined, request?: ComposeRequest): boolean {
    if (!getPlannedLongSpanForm(request)) {
        return false;
    }

    return longSpanMetricSeverity(metrics, "longSpanDevelopmentPressureFit", 0.58) > 0
        || longSpanMetricSeverity(metrics, "longSpanThematicTransformationFit", 0.56) > 0
        || longSpanMetricSeverity(metrics, "longSpanHarmonicTimingFit", 0.58) > 0
        || longSpanMetricSeverity(metrics, "longSpanReturnPayoffFit", 0.62) > 0;
}

function directiveText(directive: RevisionDirective): string {
    return `${directive.reason ?? ""} ${directive.sourceIssue ?? ""}`.trim().toLowerCase();
}

function directiveMentionsAny(directive: RevisionDirective, snippets: string[]): boolean {
    const text = directiveText(directive);
    return text.length > 0 && snippets.some((snippet) => text.includes(snippet));
}

function isAudioRouteRepairDirective(directive: RevisionDirective): boolean {
    if (directive.kind !== "clarify_narrative_arc" && directive.kind !== "stabilize_harmony") {
        return false;
    }

    return directiveMentionsAny(directive, [
        "harmonic route",
        "tonal route",
        "modulation",
        "development key drift",
    ]);
}

function isAudioReturnRepairDirective(directive: RevisionDirective): boolean {
    if (directive.kind !== "rebalance_recap_release" && directive.kind !== "stabilize_harmony") {
        return false;
    }

    return directiveMentionsAny(directive, [
        "tonal return",
        "pitch-class return",
        "return and release",
        "home key",
        "homecoming",
        "recap",
        "planned tonal center",
    ]);
}

function findFallbackFormSection(
    fallbackSections: SectionPlan[],
    section: SectionPlan,
): SectionPlan | undefined {
    const idMatch = fallbackSections.find((entry) => entry.id === section.id);
    if (idMatch?.role === section.role) {
        return idMatch;
    }

    return fallbackSections.find((entry) => entry.role === section.role)
        ?? idMatch;
}

function pickAudioSectionIdsByRoles(
    evaluation: AudioEvaluationReport,
    request: ComposeRequest | undefined,
    roles: Array<SectionPlan["role"]>,
    maxTargets = 2,
    options?: {
        issuePrefixes?: string[];
        metricKeys?: string[];
    },
): string[] {
    const weakestIds = new Set((evaluation.weakestSections ?? []).map((finding) => finding.sectionId));
    const findingsById = new Map<string, NonNullable<AudioEvaluationReport["sectionFindings"]>[number]>();
    for (const finding of evaluation.sectionFindings ?? []) {
        findingsById.set(finding.sectionId, finding);
    }
    for (const finding of evaluation.weakestSections ?? []) {
        if (!findingsById.has(finding.sectionId)) {
            findingsById.set(finding.sectionId, finding);
        }
    }

    let audioFindings = Array.from(findingsById.values())
        .filter((finding) => roles.includes(finding.role));

    const issuePrefixes = options?.issuePrefixes ?? [];
    const metricKeys = options?.metricKeys ?? [];
    const issueMatches = issuePrefixes.length > 0
        ? audioFindings.filter((finding) => audioSectionFindingMatchesIssuePrefixes(finding, issuePrefixes))
        : [];
    if (issueMatches.length > 0) {
        audioFindings = issueMatches;
    } else if (metricKeys.length > 0) {
        const metricMatches = audioFindings.filter((finding) => metricKeys.some((key) => inverseMetricSeverity(finding.metrics, key) > 0.28));
        if (metricMatches.length > 0) {
            audioFindings = metricMatches;
        }
    }

    audioFindings = audioFindings
        .slice()
        .sort((left, right) => (
            Number(weakestIds.has(right.sectionId)) - Number(weakestIds.has(left.sectionId))
            || scoreAudioSectionFindingSeverity(right, metricKeys) - scoreAudioSectionFindingSeverity(left, metricKeys)
            || left.score - right.score
            || right.issues.length - left.issues.length
            || left.sectionId.localeCompare(right.sectionId)
        ));

    const audioSectionIds = Array.from(new Set(audioFindings
        .map((finding) => finding.sectionId)
        .filter(Boolean))).slice(0, maxTargets);

    return audioSectionIds.length > 0
        ? audioSectionIds
        : pickPlanSectionIdsByRoles(request, roles, maxTargets);
}

function pickAudioLongSpanDivergenceSectionIds(
    evaluation: AudioEvaluationReport,
    request: ComposeRequest | undefined,
    divergence: LongSpanDivergenceSummary,
    focus: AudioLongSpanEvaluationDimension | undefined = divergence.repairFocus,
): string[] {
    if (!focus) {
        return [];
    }

    const maxTargets = divergence.repairMode === "paired_cross_section"
        ? (focus === "development_narrative" || focus === "harmonic_route" ? 3 : 2)
        : (focus === "development_narrative" || focus === "harmonic_route" ? 2 : 1);
    const pairedAudioSectionIds = Array.from(new Set((divergence.sections ?? [])
        .map((section) => section.sectionId)
        .filter((sectionId) => typeof sectionId === "string" && sectionId.length > 0)));
    const pairedStructureSectionIds = divergence.repairMode === "paired_cross_section"
        ? Array.from(new Set((divergence.sections ?? [])
            .map((section) => section.structureSectionId)
            .filter((sectionId): sectionId is string => typeof sectionId === "string" && sectionId.length > 0 && sectionId !== "")))
        : [];

    const mergeTargets = (baseSectionIds: string[]): string[] => Array.from(new Set([
        ...pairedAudioSectionIds,
        ...pairedStructureSectionIds,
        ...baseSectionIds,
    ])).slice(0, maxTargets);

    switch (focus) {
        case "development_narrative":
            return mergeTargets(pickAudioSectionIdsByRoles(evaluation, request, ["development", "variation", "bridge"], 2, {
                issuePrefixes: [
                    "Audio escalation against the source section is weak.",
                    "Rendered and styled audio disagree on the section's narrative contour.",
                    "Rendered and styled audio disagree on the development's modulation profile.",
                ],
                metricKeys: [
                    "audioDevelopmentNarrativeFit",
                    "audioSectionNarrativeConsistencyFit",
                    "audioDevelopmentRouteConsistencyFit",
                ],
            }));
        case "recap_recall":
            return mergeTargets(pickAudioSectionIdsByRoles(evaluation, request, ["recap", "cadence", "outro"], 1, {
                issuePrefixes: [
                    "Audio return and release against the source section are weak.",
                    "Rendered and styled audio disagree on the section's narrative contour.",
                    "Rendered and styled audio disagree on the recap's tonal return.",
                ],
                metricKeys: [
                    "audioRecapRecallFit",
                    "audioSectionNarrativeConsistencyFit",
                    "audioRecapTonalConsistencyFit",
                ],
            }));
        case "harmonic_route":
            return mergeTargets(pickAudioSectionIdsByRoles(evaluation, request, ["theme_b", "development", "variation", "recap", "cadence", "outro"], 2, {
                issuePrefixes: [
                    "Rendered development key drift does not settle into a clear modulation path.",
                    "Rendered and styled audio disagree on the development's modulation profile.",
                    "Rendered pitch-class return does not settle back into the planned recap tonality.",
                    "Rendered and styled audio disagree on the recap's tonal return.",
                ],
                metricKeys: [
                    "audioDevelopmentRouteConsistencyFit",
                    "audioRecapTonalConsistencyFit",
                    "audioSectionNarrativeConsistencyFit",
                ],
            }));
        case "tonal_return":
            return mergeTargets(pickAudioSectionIdsByRoles(evaluation, request, ["recap", "cadence", "outro"], 1, {
                issuePrefixes: [
                    "Rendered pitch-class return does not settle back into the planned recap tonality.",
                    "Rendered and styled audio disagree on the recap's tonal return.",
                    "Audio return and release against the source section are weak.",
                ],
                metricKeys: [
                    "audioRecapTonalConsistencyFit",
                    "audioRecapPitchClassReturnFit",
                    "audioSectionNarrativeConsistencyFit",
                ],
            }));
        default:
            return mergeTargets([]);
    }
}

function formatAudioLongSpanFocusLabel(focus: AudioLongSpanEvaluationDimension): string {
    switch (focus) {
        case "development_narrative":
            return "development escalation";
        case "recap_recall":
            return "recap recall";
        case "harmonic_route":
            return "harmonic route";
        case "tonal_return":
            return "tonal return";
    }
}

function formatAudioLongSpanFocusList(focuses: AudioLongSpanEvaluationDimension[]): string {
    const labels = Array.from(new Set(focuses.map((focus) => formatAudioLongSpanFocusLabel(focus))));
    if (labels.length === 0) {
        return "";
    }

    if (labels.length === 1) {
        return labels[0];
    }

    if (labels.length === 2) {
        return `${labels[0]} and ${labels[1]}`;
    }

    return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function longSpanDivergenceDirectivePriority(divergence: LongSpanDivergenceSummary): number {
    const base = divergence.status === "render_collapsed" ? 98 : 88;
    switch (divergence.repairMode) {
        case "paired_same_section":
            return base + 2;
        case "paired_cross_section":
            return base + 6;
        default:
            return base;
    }
}

function buildLongSpanDivergenceDirectiveReason(divergence: LongSpanDivergenceSummary): string {
    const secondaryFocusNote = Array.isArray(divergence.secondaryRepairFocuses) && divergence.secondaryRepairFocuses.length > 0
        ? `Secondary long-span weakness also persists in ${formatAudioLongSpanFocusList(divergence.secondaryRepairFocuses)}.`
        : "";
    const repairInstruction = (() => {
        switch (divergence.repairMode) {
            case "paired_same_section":
                return divergence.status === "render_collapsed"
                    ? "Repair the rendered long-span cue while restabilizing the same symbolic section."
                    : "Strengthen the rendered long-span cue while restabilizing the same symbolic section."
                    ;
            case "paired_cross_section":
                return divergence.status === "render_collapsed"
                    ? "Repair the rendered weak section and the paired symbolic weak section together so the long-span route reconverges."
                    : "Strengthen the rendered weak section and the paired symbolic weak section together before widening the rewrite."
                    ;
            default:
                return divergence.status === "render_collapsed"
                    ? "Repair the rendered long-span cue without loosening the symbolic form that already holds."
                    : "Strengthen the rendered long-span cue before changing the symbolic plan."
                    ;
        }
    })();
    const sectionExplanation = divergence.sections?.[0]?.explanation;
    return [
        divergence.explanation,
        sectionExplanation,
        secondaryFocusNote,
        repairInstruction,
    ].filter(Boolean).join(" ");
}

function buildSecondaryLongSpanDivergenceDirectiveReason(
    divergence: LongSpanDivergenceSummary,
    focus: AudioLongSpanEvaluationDimension,
): string {
    const focusLabel = formatAudioLongSpanFocusLabel(focus);
    const sectionExplanation = divergence.sections?.[0]?.explanation;
    const repairInstruction = divergence.repairMode === "paired_cross_section"
        ? "Support the primary long-span repair across the same rendered and symbolic weak sections before widening the rewrite."
        : divergence.repairMode === "paired_same_section"
            ? "Support the same section-local repair so the secondary weakness does not survive the retry."
            : "Support the primary long-span repair without changing the symbolic route that already holds.";
    return [
        divergence.explanation,
        sectionExplanation,
        `Secondary long-span weakness also persists in ${focusLabel}.`,
        repairInstruction,
    ].filter(Boolean).join(" ");
}

function appendSecondaryLongSpanDivergenceDirectives(
    directives: Map<RevisionDirective["kind"], RevisionDirective>,
    evaluation: AudioEvaluationReport,
    request: ComposeRequest | undefined,
    divergence: LongSpanDivergenceSummary,
): void {
    const secondaryFocuses = Array.isArray(divergence.secondaryRepairFocuses)
        ? divergence.secondaryRepairFocuses
        : [];

    secondaryFocuses.forEach((focus, index) => {
        const kind = recommendedDirectiveForAudioLongSpanDimension(focus);
        if (!kind) {
            return;
        }

        const sectionIds = pickAudioLongSpanDivergenceSectionIds(evaluation, request, divergence, focus);
        appendDirective(directives, {
            kind,
            priority: Math.max(70, longSpanDivergenceDirectivePriority(divergence) - ((index + 1) * 4)),
            reason: buildSecondaryLongSpanDivergenceDirectiveReason(divergence, focus),
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    });
}

function smoothCurve(values: number[]): number[] {
    if (values.length <= 2) {
        return values.slice();
    }

    return values.map((value, index) => {
        const previous = values[Math.max(0, index - 1)] ?? value;
        const next = values[Math.min(values.length - 1, index + 1)] ?? value;
        return Number(((previous + value + next) / 3).toFixed(4));
    });
}

function stretchCurve(values: number[]): number[] {
    if (values.length === 0) {
        return [];
    }

    return values.map((value, index) => {
        const shifted = 0.5 + ((value - 0.5) * 1.25) + (index % 2 === 0 ? -0.03 : 0.03);
        return Number(clamp(shifted, 0.05, 0.95).toFixed(4));
    });
}

function emphasizeNarrativePeak(values: number[]): number[] {
    const base = values.length ? values.slice() : [0.38, 0.66, 0.28];

    return base.map((value, index) => {
        const ratio = base.length === 1 ? 0.5 : index / (base.length - 1);
        const centeredBoost = 1 - Math.min(Math.abs(ratio - 0.5) / 0.5, 1);
        const tailRelease = ratio > 0.72 ? ((ratio - 0.72) / 0.28) * 0.08 : 0;
        return Number(clamp(value + (centeredBoost * 0.16) - tailRelease, 0.05, 0.95).toFixed(4));
    });
}

function softenClosingRelease(values: number[]): number[] {
    const base = values.length ? values.slice() : [0.42, 0.56, 0.24];

    return base.map((value, index) => {
        const ratio = base.length === 1 ? 1 : index / (base.length - 1);
        if (ratio < 0.6) {
            return Number(clamp(value, 0.05, 0.95).toFixed(4));
        }

        const release = (ratio - 0.6) / 0.4;
        const target = index === base.length - 1 ? 0.2 : 0.3;
        const blended = (value * (1 - (release * 0.55))) + (target * (release * 0.55));
        return Number(clamp(blended, 0.05, 0.95).toFixed(4));
    });
}

function rebalanceClosingContour(values: number[]): number[] {
    const base = values.length ? values.slice() : [0.36, 0.62, 0.4];
    const opening = base[0] ?? 0.4;

    return base.map((value, index) => {
        const ratio = base.length === 1 ? 1 : index / (base.length - 1);
        if (ratio < 0.65) {
            return Number(clamp(value, 0.05, 0.95).toFixed(4));
        }

        const recall = (ratio - 0.65) / 0.35;
        const blended = (value * (1 - (recall * 0.5))) + (opening * (recall * 0.5));
        return Number(clamp(blended, 0.05, 0.95).toFixed(4));
    });
}

function ensureProfileContour(profile: NonNullable<ComposeRequest["compositionProfile"]>): number[] {
    return profile.pitchContour?.length ? profile.pitchContour.slice() : [0.34, 0.66, 0.42];
}

function ensureProfileTension(profile: NonNullable<ComposeRequest["compositionProfile"]>): number[] {
    return profile.tension?.length ? profile.tension.slice() : [0.44, 0.62, 0.24];
}

function buildSectionArtifactMap(sectionArtifacts: ComposeRequest["sectionArtifacts"] | undefined): Map<string, SectionArtifactSummary> {
    return new Map((sectionArtifacts ?? []).map((artifact) => [artifact.sectionId, artifact]));
}

function computeRecenteredRegisterTarget(
    section: SectionPlan,
    artifact: SectionArtifactSummary | undefined,
    index: number,
): { registerCenter: number; note?: string } {
    const baseRegister = section.registerCenter ?? artifact?.plannedRegisterCenter ?? 60;
    const plannedRegister = typeof artifact?.plannedRegisterCenter === "number"
        ? artifact.plannedRegisterCenter
        : section.registerCenter;
    const realizedRegister = typeof artifact?.realizedRegisterCenter === "number"
        ? artifact.realizedRegisterCenter
        : undefined;

    if (plannedRegister !== undefined && realizedRegister !== undefined) {
        const drift = realizedRegister - plannedRegister;
        if (Math.abs(drift) >= 4) {
            const correction = clamp(Math.round(drift * -0.65), -10, 10);
            const correctedRegister = clamp(baseRegister + correction, 46, 84);
            if (drift > 0) {
                return {
                    registerCenter: correctedRegister,
                    note: "Keep this section lower in register than the previous pass so the planned contour lands more accurately.",
                };
            }

            return {
                registerCenter: correctedRegister,
                note: "Keep this section higher in register than the previous pass so the planned contour lands more accurately.",
            };
        }
    }

    return {
        registerCenter: clamp(baseRegister + (index % 2 === 0 ? -4 : 6), 46, 84),
    };
}

function resolveCadenceRevisionTarget(section: SectionPlan): SectionPlan["cadence"] {
    const plannedCadence = section.harmonicPlan?.cadence ?? section.cadence;
    if (plannedCadence && plannedCadence !== "open") {
        return plannedCadence;
    }

    return "authentic";
}

function cadenceSupportNotes(
    cadence: SectionPlan["cadence"],
    artifact: SectionArtifactSummary | undefined,
): string[] {
    const notes: string[] = [];

    if (cadence === "plagal") {
        notes.push("Support the close with a clear plagal-to-tonic bass approach.");
    } else if (cadence === "half") {
        notes.push("Land the section clearly on the dominant instead of letting the cadence blur.");
        notes.push("Prepare the dominant with clear approach motion in the bass.");
    } else if (cadence === "deceptive") {
        notes.push("Prepare the close with dominant support before the deceptive release.");
        notes.push("Keep the bass motion intentional so the unexpected arrival still reads clearly.");
    } else {
        notes.push("End with a clear tonic-triad resolution in the lead voice.");
        notes.push("Support the close with dominant-to-tonic or plagal-to-tonic bass motion.");
    }

    if (artifact?.cadenceApproach === "other") {
        if (cadence === "plagal") {
            notes.push("Recover the planned plagal bass approach instead of approaching the final arrival indirectly.");
        } else if (cadence === "half") {
            notes.push("Make the pre-dominant-to-dominant bass move explicit before the landing.");
        } else {
            notes.push("Make the dominant preparation explicit in the bass before the arrival.");
        }
    }

    return notes;
}

function cloneExpressionGuidance(expression: ExpressionGuidance | undefined): ExpressionGuidance | undefined {
    return expression
        ? JSON.parse(JSON.stringify(expression)) as ExpressionGuidance
        : undefined;
}

function mergeExpressionGuidance(
    defaults: ExpressionGuidance | undefined,
    override: ExpressionGuidance | undefined,
): ExpressionGuidance | undefined {
    const defaultDynamics = defaults?.dynamics;
    const overrideDynamics = override?.dynamics;
    const dynamics = defaultDynamics || overrideDynamics
        ? {
            ...(defaultDynamics ? { ...defaultDynamics } : {}),
            ...(overrideDynamics ? { ...overrideDynamics } : {}),
            ...((overrideDynamics?.hairpins?.length
                ? { hairpins: overrideDynamics.hairpins.map((hairpin) => ({ ...hairpin })) }
                : defaultDynamics?.hairpins?.length
                    ? { hairpins: defaultDynamics.hairpins.map((hairpin) => ({ ...hairpin })) }
                    : {})),
        }
        : undefined;
    const articulation = override?.articulation?.length
        ? [...override.articulation]
        : defaults?.articulation?.length
            ? [...defaults.articulation]
            : undefined;
    const character = override?.character?.length
        ? [...override.character]
        : defaults?.character?.length
            ? [...defaults.character]
            : undefined;
    const phrasePeaks = override?.phrasePeaks?.length
        ? [...override.phrasePeaks]
        : defaults?.phrasePeaks?.length
            ? [...defaults.phrasePeaks]
            : undefined;
    const sustainBias = override?.sustainBias ?? defaults?.sustainBias;
    const accentBias = override?.accentBias ?? defaults?.accentBias;
    const notes = override?.notes?.length
        ? [...override.notes]
        : defaults?.notes?.length
            ? [...defaults.notes]
            : undefined;

    if (!dynamics && !articulation && !character && !phrasePeaks && sustainBias === undefined && accentBias === undefined && !notes) {
        return undefined;
    }

    return {
        ...(dynamics ? { dynamics } : {}),
        ...(articulation ? { articulation } : {}),
        ...(character ? { character } : {}),
        ...(phrasePeaks ? { phrasePeaks } : {}),
        ...(sustainBias !== undefined ? { sustainBias } : {}),
        ...(accentBias !== undefined ? { accentBias } : {}),
        ...(notes ? { notes } : {}),
    };
}

function mergeTextureGuidance(
    defaults: TextureGuidance | undefined,
    override: TextureGuidance | undefined,
): TextureGuidance | undefined {
    const voiceCount = override?.voiceCount ?? defaults?.voiceCount;
    const primaryRoles = override?.primaryRoles?.length
        ? [...override.primaryRoles]
        : defaults?.primaryRoles?.length
            ? [...defaults.primaryRoles]
            : undefined;
    const counterpointMode = override?.counterpointMode ?? defaults?.counterpointMode;
    const notes = override?.notes?.length
        ? [...override.notes]
        : defaults?.notes?.length
            ? [...defaults.notes]
            : undefined;

    if (voiceCount === undefined && !primaryRoles && !counterpointMode && !notes) {
        return undefined;
    }

    return {
        ...(voiceCount !== undefined ? { voiceCount } : {}),
        ...(primaryRoles ? { primaryRoles } : {}),
        ...(counterpointMode ? { counterpointMode } : {}),
        ...(notes ? { notes } : {}),
    };
}

function cloneTempoMotionPlans(tempoMotion: TempoMotionPlan[] | undefined): TempoMotionPlan[] | undefined {
    return tempoMotion
        ? JSON.parse(JSON.stringify(tempoMotion)) as TempoMotionPlan[]
        : undefined;
}

function isTempoMotionResetTag(tag: TempoMotionPlan["tag"] | string | undefined): boolean {
    return tag === "a_tempo" || tag === "tempo_l_istesso";
}

function defaultTempoMotionWindow(
    section: SectionPlan,
    tag: TempoMotionPlan["tag"],
    reserveFinalMeasureForReset: boolean,
): { startMeasure: number; endMeasure: number } {
    const measures = Math.max(1, section.measures);
    if (isTempoMotionResetTag(tag)) {
        return { startMeasure: measures, endMeasure: measures };
    }

    const terminalMeasure = reserveFinalMeasureForReset && measures > 1 ? measures - 1 : measures;
    const span = tag === "ritenuto"
        ? 2
        : measures >= 7
            ? 3
            : 2;
    const endMeasure = Math.max(1, terminalMeasure);
    const startMeasure = Math.max(1, endMeasure - span + 1);
    return { startMeasure, endMeasure };
}

function fallbackTempoMotionTag(section: SectionPlan): TempoMotionPlan["tag"] {
    if (["development", "variation", "bridge"].includes(section.role)) {
        return "stringendo";
    }
    if (["recap", "cadence", "outro"].includes(section.role)) {
        return "ritardando";
    }

    return "ritenuto";
}

function resolveTempoMotionRevisionPlans(
    section: SectionPlan,
    artifact: SectionArtifactSummary | undefined,
): TempoMotionPlan[] {
    const coverageShortfall = (artifact?.tempoMotionSummary?.realizedMeasureCount ?? 0) < (artifact?.tempoMotionSummary?.targetedMeasureCount ?? 0);
    const targetIntensity = Number(clamp(coverageShortfall ? 0.84 : 0.74, 0.55, 1).toFixed(3));
    const currentPlans = cloneTempoMotionPlans(section.tempoMotion);
    if (currentPlans?.length) {
        return currentPlans.map((plan) => {
            const measures = Math.max(1, section.measures);
            const reserveFinalMeasureForReset = currentPlans.some((entry) => isTempoMotionResetTag(entry.tag));
            const fallbackWindow = defaultTempoMotionWindow(section, plan.tag, reserveFinalMeasureForReset);
            const startMeasure = Math.max(1, Math.min(plan.startMeasure ?? fallbackWindow.startMeasure, measures));
            const endMeasure = Math.max(startMeasure, Math.min(plan.endMeasure ?? fallbackWindow.endMeasure, measures));

            return {
                ...plan,
                startMeasure: isTempoMotionResetTag(plan.tag)
                    ? measures
                    : Math.max(1, Math.min(startMeasure, Math.max(1, endMeasure - 1))),
                endMeasure: isTempoMotionResetTag(plan.tag)
                    ? measures
                    : endMeasure,
                intensity: Number(clamp(Math.max(plan.intensity ?? 0.62, targetIntensity), 0, 1).toFixed(3)),
            };
        });
    }

    const requestedTags = (artifact?.tempoMotionSummary?.requestedTags?.length
        ? [...artifact.tempoMotionSummary.requestedTags]
        : [fallbackTempoMotionTag(section)]) as TempoMotionPlan["tag"][];
    const motionTags = requestedTags.filter((tag) => !isTempoMotionResetTag(tag));
    const resetTags = requestedTags.filter((tag) => isTempoMotionResetTag(tag));
    const selectedTags = [
        ...(motionTags.length > 0 ? [motionTags[0]] : []),
        ...(resetTags.length > 0 ? [resetTags[resetTags.length - 1]] : []),
    ] as TempoMotionPlan["tag"][];
    if (selectedTags.length === 0) {
        selectedTags.push(fallbackTempoMotionTag(section));
    }

    const reserveFinalMeasureForReset = selectedTags.some((tag) => isTempoMotionResetTag(tag));
    return selectedTags.map((tag) => {
        const window = defaultTempoMotionWindow(section, tag, reserveFinalMeasureForReset);
        return {
            tag,
            startMeasure: window.startMeasure,
            endMeasure: window.endMeasure,
            intensity: Number(clamp(isTempoMotionResetTag(tag) ? 0.68 : targetIntensity, 0, 1).toFixed(3)),
        };
    });
}

function tempoMotionRevisionNotes(plans: TempoMotionPlan[]): string[] {
    const tags = plans
        .map((plan) => plan.tag.replace(/_/g, " "))
        .filter(Boolean)
        .join(", ");

    return [
        `Make ${tags || "the local tempo motion"} land on note-bearing measures instead of empty space.`,
        "Keep the local timing arc explicit enough that the tempo motion survives humanization.",
    ];
}

function cloneOrnamentPlans(ornaments: OrnamentPlan[] | undefined): OrnamentPlan[] | undefined {
    return ornaments
        ? JSON.parse(JSON.stringify(ornaments)) as OrnamentPlan[]
        : undefined;
}

function isExplicitOrnamentHoldTag(tag: OrnamentPlan["tag"] | string | undefined): boolean {
    return tag === "fermata";
}

function resolveOrnamentRevisionPlans(
    section: SectionPlan,
    artifact: SectionArtifactSummary | undefined,
): OrnamentPlan[] {
    const targetIntensity = Number(clamp(
        (artifact?.ornamentSummary?.realizedEventCount ?? 0) < (artifact?.ornamentSummary?.targetedEventCount ?? 0)
            ? 0.92
            : 0.82,
        0.62,
        1,
    ).toFixed(3));
    const currentPlans = cloneOrnamentPlans(section.ornaments);
    const fallbackPlan = {
        tag: "fermata" as const,
        startMeasure: Math.max(1, section.measures),
        endMeasure: Math.max(1, section.measures),
        intensity: targetIntensity,
    };

    if (currentPlans?.length) {
        const revisedPlans = currentPlans.map((plan) => {
            if (!isExplicitOrnamentHoldTag(plan.tag)) {
                return plan;
            }

            const endMeasure = Math.max(1, Math.min(plan.endMeasure ?? plan.startMeasure ?? section.measures, section.measures));
            const startMeasure = Math.max(1, Math.min(plan.startMeasure ?? endMeasure, endMeasure));
            return {
                ...plan,
                startMeasure,
                endMeasure,
                intensity: Number(clamp(Math.max(plan.intensity ?? 0.72, targetIntensity), 0, 1).toFixed(3)),
            };
        });

        if (!revisedPlans.some((plan) => isExplicitOrnamentHoldTag(plan.tag)) && artifact?.ornamentSummary?.explicitlyRealizedTags?.some((tag) => isExplicitOrnamentHoldTag(tag))) {
            revisedPlans.push(fallbackPlan);
        }

        return revisedPlans;
    }

    return artifact?.ornamentSummary?.explicitlyRealizedTags?.some((tag) => isExplicitOrnamentHoldTag(tag))
        ? [fallbackPlan]
        : [];
}

function ornamentRevisionNotes(plans: OrnamentPlan[]): string[] {
    if (!plans.some((plan) => isExplicitOrnamentHoldTag(plan.tag))) {
        return [];
    }

    return [
        "Place the fermata on a note-bearing arrival instead of empty space.",
        "Widen the local sustain and release so the fermata reads as an intentional hold after humanization.",
    ];
}

function fallbackPhraseFunctionForRole(role: SectionPlan["role"]): PhraseFunction | undefined {
    if (role === "theme_a") {
        return "presentation";
    }
    if (role === "theme_b") {
        return "continuation";
    }
    if (role === "bridge") {
        return "transition";
    }
    if (role === "development" || role === "variation") {
        return "developmental";
    }
    if (role === "cadence" || role === "outro") {
        return "cadential";
    }
    if (role === "recap") {
        return "presentation";
    }

    return undefined;
}

function phraseRhetoricNotes(phraseFunction: PhraseFunction | undefined): string[] {
    if (phraseFunction === "presentation") {
        return ["State the motive plainly before varying it so the opening rhetoric reads immediately."];
    }
    if (phraseFunction === "continuation") {
        return ["Increase motion and shorten repetitions so this section pushes forward like a continuation."];
    }
    if (phraseFunction === "transition") {
        return ["Use the phrase to move away from the opening material and prepare the next tonal area."];
    }
    if (phraseFunction === "cadential") {
        return ["Aim the line toward a clear cadential goal instead of prolonging the middle of the phrase."];
    }
    if (phraseFunction === "developmental") {
        return ["Fragment or sequence the idea so the section reads as developmental rather than restated."];
    }

    return ["Clarify the local phrase goal so the section's rhetoric reads more explicitly."];
}

function liftHarmonicRhythm(
    current: NonNullable<SectionPlan["harmonicPlan"]>["harmonicRhythm"] | undefined,
    preferFast = false,
): NonNullable<SectionPlan["harmonicPlan"]>["harmonicRhythm"] {
    if (current === "fast") {
        return "fast";
    }
    if (preferFast) {
        return current === "medium" ? "fast" : "medium";
    }

    return current === "slow" ? "medium" : (current ?? "medium");
}

function cloneHarmonicColorCues(colorCues: HarmonicColorCue[] | undefined): HarmonicColorCue[] | undefined {
    return colorCues?.length
        ? colorCues.map((cue) => ({
            ...cue,
            ...(cue.notes?.length ? { notes: [...cue.notes] } : {}),
        }))
        : undefined;
}

function fallbackHarmonicColorCues(
    section: SectionPlan,
    keyTarget: string | undefined,
): HarmonicColorCue[] {
    const measures = Math.max(section.measures, 1);
    if (["cadence", "recap", "outro"].includes(section.role)) {
        return [{
            tag: "suspension",
            startMeasure: Math.max(1, measures - 1),
            endMeasure: measures,
            resolutionMeasure: measures,
        }];
    }

    if (keyTarget && ["theme_b", "development", "variation", "bridge"].includes(section.role)) {
        return [{
            tag: "applied_dominant",
            startMeasure: Math.max(1, measures - 1),
            endMeasure: measures,
            keyTarget,
        }];
    }

    return [{
        tag: "mixture",
        startMeasure: Math.max(1, measures - 2),
        endMeasure: Math.max(1, measures - 1),
    }];
}

function reinforceHarmonicColorCues(
    colorCues: HarmonicColorCue[] | undefined,
    section: SectionPlan,
    keyTarget: string | undefined,
): HarmonicColorCue[] {
    const baseColorCues = cloneHarmonicColorCues(colorCues) ?? fallbackHarmonicColorCues(section, keyTarget);
    const measures = Math.max(section.measures, 1);

    return baseColorCues.map((cue, index) => {
        const startMeasure = cue.startMeasure ?? Math.max(1, measures - (cue.tag === "suspension" ? 1 : 2));
        const endMeasure = cue.endMeasure ?? (cue.tag === "suspension" ? measures : Math.max(startMeasure, measures - (index > 0 ? 0 : 1)));
        const resolutionMeasure = cue.tag === "suspension"
            ? (cue.resolutionMeasure ?? measures)
            : cue.resolutionMeasure;
        const resolvedKeyTarget = cue.tag === "applied_dominant"
            ? (cue.keyTarget ?? keyTarget)
            : cue.keyTarget;

        return {
            ...cue,
            startMeasure,
            endMeasure,
            ...(resolvedKeyTarget ? { keyTarget: resolvedKeyTarget } : {}),
            ...(resolutionMeasure !== undefined ? { resolutionMeasure } : {}),
        };
    });
}

function harmonicColorRevisionNotes(colorCues: HarmonicColorCue[]): string[] {
    const tags = new Set(colorCues.map((cue) => cue.tag));
    const notes = ["Plan one explicit local harmonic-color event so the section does more than prolong a generic harmony."];

    if (tags.has("mixture")) {
        notes.push("Borrow one contrasting scale-degree color briefly so the harmony audibly darkens or brightens before returning.");
    }
    if (tags.has("applied_dominant")) {
        notes.push("Aim one dominant-color event clearly toward its temporary target before the section releases.");
    }
    if (tags.has("predominant_color")) {
        notes.push("Prepare the cadence with a clear predominant-color expansion instead of jumping straight to arrival.");
    }
    if (tags.has("suspension")) {
        notes.push("Let one local dissonance arrive before it resolves so the release reads as intentional rather than immediate.");
    }

    return notes;
}

function texturePlanNotes(texture: TextureGuidance | undefined): string[] {
    if (!texture) {
        return ["Keep the planned texture roles distinct so the section does not collapse into a single undifferentiated layer."];
    }

    const notes: string[] = [];
    if (texture.voiceCount !== undefined) {
        notes.push(`Keep ${texture.voiceCount} clearly differentiated active voices in this section.`);
    }
    if (texture.primaryRoles?.length) {
        notes.push(`Let ${texture.primaryRoles.join(", ")} remain distinct roles instead of collapsing into block accompaniment.`);
    }
    if (texture.counterpointMode && texture.counterpointMode !== "none") {
        notes.push(`Make the ${texture.counterpointMode.replace(/_/g, " ")} cue explicit between the active lines.`);
    }

    return notes.length > 0
        ? notes
        : ["Clarify the planned texture layout so the section roles stay distinct."];
}

function dedupeOrdered<T extends string>(values: T[] | undefined): T[] | undefined {
    const deduped = Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))) as T[];
    return deduped.length > 0 ? deduped : undefined;
}

function dynamicLevelIndex(level: unknown): number | undefined {
    const normalized = String(level ?? "").trim().toLowerCase();
    const index = DYNAMIC_LEVELS.indexOf(normalized as typeof DYNAMIC_LEVELS[number]);
    return index >= 0 ? index : undefined;
}

function dynamicLevelAt(index: number): typeof DYNAMIC_LEVELS[number] {
    return DYNAMIC_LEVELS[clamp(Math.trunc(index), 0, DYNAMIC_LEVELS.length - 1)];
}

function fallbackSectionExpression(section: SectionPlan): ExpressionGuidance {
    const midpoint = Math.max(1, Math.ceil(Math.max(section.measures, 1) / 2));
    const latePeak = section.measures >= 6
        ? Math.min(section.measures, midpoint + Math.max(1, Math.floor(section.measures / 4)))
        : undefined;
    const energetic = section.energy >= 0.6 || ["development", "variation", "bridge"].includes(section.role);
    const closing = ["recap", "cadence", "outro"].includes(section.role);

    return {
        dynamics: energetic
            ? { start: "mp", peak: "f", end: "mf" }
            : closing
                ? { start: "mp", peak: "mf", end: "p" }
                : { start: "pp", peak: "mp", end: "p" },
        articulation: [energetic ? "accent" : "legato"],
        character: [energetic ? "agitato" : (closing ? "cantabile" : "dolce")],
        phrasePeaks: latePeak ? [midpoint, latePeak] : [midpoint],
        sustainBias: energetic ? -0.04 : 0.18,
        accentBias: energetic ? 0.18 : 0.04,
    };
}

function buildDefaultHairpins(section: SectionPlan, expression: ExpressionGuidance): NonNullable<NonNullable<ExpressionGuidance["dynamics"]>["hairpins"]> {
    const dynamics = expression.dynamics;
    if (!dynamics || section.measures < 3) {
        return [];
    }

    const midpoint = Math.max(2, Math.ceil(section.measures / 2));
    const hairpins: NonNullable<NonNullable<ExpressionGuidance["dynamics"]>["hairpins"]> = [];

    if (dynamics.peak) {
        hairpins.push({
            shape: "crescendo",
            startMeasure: 1,
            endMeasure: midpoint,
            target: dynamics.peak,
        });
    }

    if (dynamics.end && dynamics.peak && dynamicLevelIndex(dynamics.end)! < dynamicLevelIndex(dynamics.peak)!) {
        hairpins.push({
            shape: "diminuendo",
            startMeasure: midpoint,
            endMeasure: Math.max(midpoint + 1, section.measures),
            target: dynamics.end,
        });
    }

    return hairpins;
}

function reinforceDynamicsExpression(expression: ExpressionGuidance | undefined, section: SectionPlan): ExpressionGuidance {
    const fallback = fallbackSectionExpression(section);
    const base = mergeExpressionGuidance(fallback, expression) ?? fallback;
    const current = base.dynamics ?? fallback.dynamics ?? { start: "mp", peak: "mf", end: "mp" };
    const startIndex = dynamicLevelIndex(current.start ?? fallback.dynamics?.start ?? "mp") ?? 2;
    const peakIndex = dynamicLevelIndex(current.peak ?? fallback.dynamics?.peak ?? "mf") ?? 3;
    const endIndex = dynamicLevelIndex(current.end ?? fallback.dynamics?.end ?? "mp") ?? 2;
    const energetic = section.energy >= 0.6 || ["development", "variation", "bridge"].includes(section.role);
    const reinforcedStart = Math.max(0, startIndex - (energetic ? 0 : 1));
    const reinforcedPeak = Math.min(DYNAMIC_LEVELS.length - 1, Math.max(peakIndex + 1, reinforcedStart + 1, energetic ? 4 : 2));
    const reinforcedEnd = section.role === "development"
        ? Math.max(reinforcedStart, reinforcedPeak - 1)
        : Math.max(0, Math.min(endIndex, reinforcedPeak - 1));
    const dynamics = {
        ...current,
        start: dynamicLevelAt(reinforcedStart),
        peak: dynamicLevelAt(reinforcedPeak),
        end: dynamicLevelAt(reinforcedEnd),
        hairpins: current.hairpins?.length ? current.hairpins.map((hairpin) => ({ ...hairpin })) : buildDefaultHairpins(section, {
            ...base,
            dynamics: {
                ...current,
                start: dynamicLevelAt(reinforcedStart),
                peak: dynamicLevelAt(reinforcedPeak),
                end: dynamicLevelAt(reinforcedEnd),
            },
        }),
    };

    return {
        ...base,
        dynamics,
    };
}

function clarifyExpressionProfile(expression: ExpressionGuidance | undefined, section: SectionPlan): ExpressionGuidance {
    const fallback = fallbackSectionExpression(section);
    const base = mergeExpressionGuidance(fallback, expression) ?? fallback;
    const energetic = section.energy >= 0.6 || ["development", "variation", "bridge"].includes(section.role);
    let articulation: ArticulationTag[] = dedupeOrdered(base.articulation ?? fallback.articulation) ?? [];
    if (energetic) {
        articulation = articulation.filter((item) => item !== "staccato");
        if (!articulation.includes("accent")) {
            articulation.push("accent");
        }
    } else {
        articulation = articulation.filter((item) => item !== "staccato");
        if (!articulation.includes("legato")) {
            articulation.unshift("legato");
        }
    }

    let character: CharacterTag[] = dedupeOrdered(base.character ?? fallback.character) ?? [];
    if (character.length === 0) {
        character = fallback.character ?? [];
    }

    if (energetic) {
        character = ["agitato", ...character.filter((item) => item !== "agitato")];
    } else {
        const preferred = (fallback.character?.[0] ?? "dolce") as CharacterTag;
        character = [preferred, ...character.filter((item) => item !== preferred)];
    }

    return {
        ...base,
        articulation,
        character,
        phrasePeaks: base.phrasePeaks?.length ? [...base.phrasePeaks] : fallback.phrasePeaks,
        sustainBias: base.sustainBias ?? fallback.sustainBias,
        accentBias: base.accentBias ?? fallback.accentBias,
    };
}

function shouldPreserveCadentialModulation(section: SectionPlan, cadence: SectionPlan["cadence"]): boolean {
    if (cadence !== "half") {
        return false;
    }

    return ["theme_b", "bridge", "development", "variation"].includes(section.role)
        ? (section.harmonicPlan?.allowModulation ?? true)
        : false;
}

function reviseSections(
    sections: SectionPlan[],
    directives: RevisionDirective[],
    sectionArtifacts?: ComposeRequest["sectionArtifacts"],
    textureDefaults?: TextureGuidance,
    expressionDefaults?: ExpressionGuidance,
    form?: string,
    homeKey?: string,
): SectionPlan[] {
    if (sections.length === 0) {
        return sections;
    }

    const artifactById = buildSectionArtifactMap(sectionArtifacts);
    const fallbackSections = buildFallbackSectionsForForm(form, homeKey) ?? [];
    const globalKinds = new Set(
        directives
            .filter((directive) => !directive.sectionIds || directive.sectionIds.length === 0)
            .map((directive) => directive.kind),
    );
    const primaryThemeId = sections.find((section) => section.role === "theme_a")?.id
        ?? sections.find((section) => section.role === "theme_b")?.id
        ?? sections[0]?.id;
    const primaryThemeTonalCenter = sections.find((section) => section.id === primaryThemeId)?.harmonicPlan?.tonalCenter
        ?? sections[0]?.harmonicPlan?.tonalCenter;
    const revised = sections.map((section, index) => {
        const notes = section.notes ? [...section.notes] : [];
        const updated: SectionPlan = {
            ...section,
            notes,
        };
        const artifact = artifactById.get(updated.id);
        const matchingDirectives = directives.filter((directive) => !directive.sectionIds?.length || directiveTargetsSection(directive, updated.id));
        const expectedSection = findFallbackFormSection(fallbackSections, updated);
        const kinds = new Set(matchingDirectives.map((directive) => directive.kind));
        const hasPhrasePressureRepair = matchingDirectives.some((directive) => directiveMentionsAny(directive, [
            "phrase pressure compresses",
        ]));
        const hasTonicizationRepair = matchingDirectives.some((directive) => directiveMentionsAny(directive, [
            "tonicization pressure is too weak",
        ]));
        const hasHarmonicColorRepair = kinds.has("clarify_harmonic_color")
            || matchingDirectives.some((directive) => directiveMentionsAny(directive, [
                "harmonic color",
            ]));
        const hasProlongationRepair = matchingDirectives.some((directive) => directiveMentionsAny(directive, [
            "prolongation stays too static",
        ]));
        const hasAudioRouteRepair = ["theme_b", "development", "variation", "bridge"].includes(updated.role)
            && matchingDirectives.some((directive) => isAudioRouteRepairDirective(directive));
        const hasAudioReturnRepair = ["recap", "cadence", "outro"].includes(updated.role)
            && matchingDirectives.some((directive) => isAudioReturnRepairDirective(directive));

        if (kinds.has("expand_register")) {
            const registerRevision = computeRecenteredRegisterTarget(updated, artifact, index);
            updated.registerCenter = registerRevision.registerCenter;
            if (registerRevision.note) {
                updated.notes = uniqueNotes(updated.notes, [registerRevision.note]);
            }
        }

        if (kinds.has("increase_rhythm_variety")) {
            updated.density = Number(clamp(updated.density + (index % 2 === 0 ? 0.08 : -0.04), 0.22, 0.9).toFixed(3));
            updated.notes = uniqueNotes(notes, ["Use at least two contrasting note-value patterns in this section."]);
        }

        if (kinds.has("reduce_large_leaps")) {
            updated.energy = Number(clamp(updated.energy - 0.08, 0.12, 0.9).toFixed(3));
            updated.density = Number(clamp(updated.density - 0.04, 0.2, 0.88).toFixed(3));
            updated.notes = uniqueNotes(updated.notes, ["Favor stepwise recovery after any accented leap."]);
        }

        if (kinds.has("stabilize_harmony")) {
            updated.energy = Number(clamp(updated.energy - 0.04, 0.12, 0.92).toFixed(3));
            updated.density = Number(clamp(updated.density - 0.02, 0.2, 0.9).toFixed(3));
            updated.harmonicPlan = {
                ...(updated.harmonicPlan ?? {}),
                harmonicRhythm: updated.harmonicPlan?.harmonicRhythm === "fast"
                    ? "medium"
                    : (updated.harmonicPlan?.harmonicRhythm ?? "medium"),
                allowModulation: updated.role === "cadence" || updated.role === "recap"
                    ? false
                    : updated.harmonicPlan?.allowModulation,
            };
            if (updated.role === "recap" && primaryThemeTonalCenter) {
                updated.harmonicPlan = {
                    ...(updated.harmonicPlan ?? {}),
                    tonalCenter: primaryThemeTonalCenter,
                    allowModulation: false,
                };
            }
            updated.notes = uniqueNotes(updated.notes, ["Favor contrary motion between melody and bass at harmonic changes, and avoid consecutive perfect fifths or octaves."]);

            if (hasTonicizationRepair) {
                const expectedPlan = expectedSection?.harmonicPlan;
                updated.energy = Number(clamp(updated.energy + 0.1, 0.16, 0.96).toFixed(3));
                updated.density = Number(clamp(updated.density + 0.06, 0.24, 0.94).toFixed(3));
                updated.harmonicPlan = {
                    ...(updated.harmonicPlan ?? {}),
                    ...(expectedPlan?.tonalCenter ? { tonalCenter: expectedPlan.tonalCenter } : {}),
                    ...(expectedPlan?.keyTarget ? { keyTarget: expectedPlan.keyTarget } : {}),
                    ...(expectedPlan?.modulationPath?.length ? { modulationPath: [...expectedPlan.modulationPath] } : {}),
                    harmonicRhythm: liftHarmonicRhythm(updated.harmonicPlan?.harmonicRhythm, true),
                    tensionTarget: Number(clamp(
                        Math.max(updated.harmonicPlan?.tensionTarget ?? updated.energy, updated.energy + 0.1),
                        0.18,
                        0.96,
                    ).toFixed(3)),
                    allowModulation: ["theme_b", "development", "variation", "bridge"].includes(updated.role)
                        ? true
                        : (updated.harmonicPlan?.allowModulation ?? (updated.phraseFunction === "transition" || updated.phraseFunction === "developmental")),
                };
                updated.notes = uniqueNotes(updated.notes, ["Introduce a brief local tonicization or applied dominant so the section departs audibly before it resolves."]);
            }

            if (hasProlongationRepair) {
                const expectedPlan = expectedSection?.harmonicPlan;
                updated.harmonicPlan = {
                    ...(updated.harmonicPlan ?? {}),
                    ...(expectedPlan?.tonalCenter ? { tonalCenter: expectedPlan.tonalCenter } : {}),
                    harmonicRhythm: liftHarmonicRhythm(updated.harmonicPlan?.harmonicRhythm),
                    tensionTarget: Number(clamp(
                        Math.max(updated.harmonicPlan?.tensionTarget ?? updated.energy, 0.36),
                        0.12,
                        0.82,
                    ).toFixed(3)),
                    allowModulation: ["recap", "cadence", "outro", "theme_a", "intro"].includes(updated.role)
                        ? false
                        : updated.harmonicPlan?.allowModulation,
                };
                updated.notes = uniqueNotes(updated.notes, ["Keep the tonal center anchored, but vary supporting harmony so the prolongation does not stall on one sonority."]);
            }
        }

        if (hasHarmonicColorRepair) {
            const expectedPlan = expectedSection?.harmonicPlan;
            const fallbackKeyTarget = expectedPlan?.keyTarget ?? updated.harmonicPlan?.keyTarget;
            const colorCues = reinforceHarmonicColorCues(updated.harmonicPlan?.colorCues, updated, fallbackKeyTarget);
            updated.energy = Number(clamp(updated.energy + 0.04, 0.12, 0.94).toFixed(3));
            updated.density = Number(clamp(updated.density + 0.03, 0.2, 0.92).toFixed(3));
            updated.harmonicPlan = {
                ...(updated.harmonicPlan ?? {}),
                ...(expectedPlan?.tonalCenter ? { tonalCenter: expectedPlan.tonalCenter } : {}),
                ...(fallbackKeyTarget ? { keyTarget: fallbackKeyTarget } : {}),
                harmonicRhythm: liftHarmonicRhythm(updated.harmonicPlan?.harmonicRhythm),
                colorCues,
            };
            updated.notes = uniqueNotes(updated.notes, harmonicColorRevisionNotes(colorCues));
        }

        if (kinds.has("increase_pitch_variety") || kinds.has("reduce_repetition")) {
            updated.notes = uniqueNotes(updated.notes, ["Vary pitch classes and avoid literal restatement of the same tone."]);
        }

        if (kinds.has("clarify_narrative_arc") && ["development", "variation", "bridge"].includes(updated.role)) {
            updated.energy = Number(clamp(updated.energy + 0.12, 0.16, 0.96).toFixed(3));
            updated.density = Number(clamp(updated.density + 0.1, 0.24, 0.94).toFixed(3));
            updated.motifRef = updated.motifRef ?? primaryThemeId;
            updated.harmonicPlan = {
                ...(updated.harmonicPlan ?? {}),
                harmonicRhythm: "fast",
                tensionTarget: Number(clamp((updated.harmonicPlan?.tensionTarget ?? updated.energy) + 0.1, 0.16, 0.96).toFixed(3)),
            };
            updated.notes = uniqueNotes(updated.notes, ["Transform the borrowed motif more aggressively so the development reads as a clear escalation in audio."]);
        }

        if (kinds.has("rebalance_recap_release") && (
            updated.role === "recap"
            || updated.role === "outro"
            || (updated.role === "cadence" && index === sections.length - 1)
        )) {
            updated.energy = Number(clamp(updated.energy - 0.08, 0.12, 0.88).toFixed(3));
            updated.density = Number(clamp(updated.density - 0.06, 0.2, 0.84).toFixed(3));
            updated.motifRef = updated.motifRef ?? primaryThemeId;
            updated.cadence = updated.cadence ?? "authentic";
            updated.harmonicPlan = {
                ...(updated.harmonicPlan ?? {}),
                harmonicRhythm: updated.harmonicPlan?.harmonicRhythm === "fast" ? "medium" : (updated.harmonicPlan?.harmonicRhythm ?? "slow"),
                cadence: updated.harmonicPlan?.cadence ?? updated.cadence ?? "authentic",
                tensionTarget: Number(clamp((updated.harmonicPlan?.tensionTarget ?? updated.energy) - 0.08, 0.08, 0.82).toFixed(3)),
            };
            updated.notes = uniqueNotes(updated.notes, ["Recall the opening idea more literally here and let the release settle below the development peak."]);
        }

        if (hasAudioRouteRepair) {
            const expectedPlan = expectedSection?.harmonicPlan;
            const routeCadence = updated.cadence ?? expectedSection?.cadence;
            updated.motifRef = updated.motifRef ?? primaryThemeId;
            if (routeCadence) {
                updated.cadence = routeCadence;
            }
            updated.cadenceStrength = Number(clamp(
                Math.max(updated.cadenceStrength ?? 0, expectedSection?.cadenceStrength ?? 0.52),
                0,
                1,
            ).toFixed(3));
            updated.harmonicPlan = {
                ...(updated.harmonicPlan ?? {}),
                ...(expectedPlan?.tonalCenter ? { tonalCenter: expectedPlan.tonalCenter } : {}),
                ...(expectedPlan?.keyTarget ? { keyTarget: expectedPlan.keyTarget } : {}),
                ...(expectedPlan?.modulationPath?.length ? { modulationPath: [...expectedPlan.modulationPath] } : {}),
                harmonicRhythm: expectedPlan?.harmonicRhythm
                    ?? (updated.harmonicPlan?.harmonicRhythm === "slow" ? "medium" : (updated.harmonicPlan?.harmonicRhythm ?? "medium")),
                tensionTarget: Number(clamp(
                    Math.max(updated.harmonicPlan?.tensionTarget ?? updated.energy, expectedPlan?.tensionTarget ?? 0.68),
                    0.16,
                    0.96,
                ).toFixed(3)),
                allowModulation: true,
                ...(routeCadence ? { cadence: updated.harmonicPlan?.cadence ?? routeCadence } : {}),
            };
            updated.notes = uniqueNotes(updated.notes, ["Let this section depart clearly from the home key before preparing the return."]);
        }

        if (hasAudioReturnRepair) {
            const expectedPlan = expectedSection?.harmonicPlan;
            const returnTonalCenter = primaryThemeTonalCenter ?? homeKey ?? expectedPlan?.tonalCenter;
            const returnCadence = resolveCadenceRevisionTarget({
                ...updated,
                cadence: updated.cadence ?? expectedSection?.cadence,
                harmonicPlan: {
                    ...(updated.harmonicPlan ?? {}),
                    cadence: updated.harmonicPlan?.cadence ?? expectedPlan?.cadence,
                },
            });
            updated.motifRef = updated.motifRef ?? primaryThemeId;
            updated.cadence = returnCadence;
            updated.cadenceStrength = Number(clamp(
                Math.max(updated.cadenceStrength ?? 0, expectedSection?.cadenceStrength ?? 0.78),
                0,
                1,
            ).toFixed(3));
            updated.harmonicPlan = {
                ...(updated.harmonicPlan ?? {}),
                ...(returnTonalCenter ? { tonalCenter: returnTonalCenter, keyTarget: returnTonalCenter } : {}),
                ...(expectedPlan?.modulationPath?.length ? { modulationPath: [...expectedPlan.modulationPath] } : {}),
                harmonicRhythm: expectedPlan?.harmonicRhythm
                    ?? (updated.harmonicPlan?.harmonicRhythm === "fast" ? "medium" : (updated.harmonicPlan?.harmonicRhythm ?? "medium")),
                tensionTarget: Number(clamp(
                    Math.min(updated.harmonicPlan?.tensionTarget ?? updated.energy, expectedPlan?.tensionTarget ?? 0.26),
                    0.08,
                    0.82,
                ).toFixed(3)),
                allowModulation: false,
                cadence: returnCadence,
            };
            updated.notes = uniqueNotes(updated.notes, ["Re-state the home key before the close so the return is unmistakable in audio."]);
        }

        if (kinds.has("clarify_phrase_rhetoric")) {
            const phraseFunction = updated.phraseFunction
                ?? expectedSection?.phraseFunction
                ?? fallbackPhraseFunctionForRole(updated.role);
            if (phraseFunction) {
                updated.phraseFunction = phraseFunction;
            }
            updated.notes = uniqueNotes(updated.notes, phraseRhetoricNotes(phraseFunction));

            if (hasPhrasePressureRepair) {
                if (phraseFunction === "continuation" || phraseFunction === "transition" || phraseFunction === "developmental") {
                    updated.energy = Number(clamp(updated.energy + 0.08, 0.14, 0.96).toFixed(3));
                    updated.density = Number(clamp(updated.density + 0.1, 0.22, 0.94).toFixed(3));
                    updated.harmonicPlan = {
                        ...(updated.harmonicPlan ?? {}),
                        harmonicRhythm: liftHarmonicRhythm(updated.harmonicPlan?.harmonicRhythm, phraseFunction !== "continuation"),
                        tensionTarget: Number(clamp(
                            Math.max(updated.harmonicPlan?.tensionTarget ?? updated.energy, updated.energy + 0.06),
                            0.18,
                            0.96,
                        ).toFixed(3)),
                    };
                    updated.notes = uniqueNotes(updated.notes, ["Raise continuation pressure with denser activity and less internal release so the section does not flatten out."]);
                } else if (phraseFunction === "cadential") {
                    const cadence = resolveCadenceRevisionTarget(updated);
                    updated.cadence = cadence;
                    updated.cadenceStrength = Number(clamp(Math.max(updated.cadenceStrength ?? 0, 0.72), 0, 1).toFixed(3));
                    updated.harmonicPlan = {
                        ...(updated.harmonicPlan ?? {}),
                        cadence,
                        harmonicRhythm: updated.harmonicPlan?.harmonicRhythm === "fast" ? "medium" : (updated.harmonicPlan?.harmonicRhythm ?? "medium"),
                    };
                    updated.notes = uniqueNotes(updated.notes, ["Reserve the longest arrival for the cadence so the phrase releases instead of stalling mid-span."]);
                } else {
                    updated.energy = Number(clamp(updated.energy + 0.04, 0.12, 0.92).toFixed(3));
                    updated.density = Number(clamp(updated.density + 0.05, 0.2, 0.88).toFixed(3));
                    updated.notes = uniqueNotes(updated.notes, ["Keep the opening statement moving enough that its phrase goal is immediately audible."]);
                }
            }
        }

        if (kinds.has("clarify_texture_plan")) {
            const targetTexture = mergeTextureGuidance(
                mergeTextureGuidance(textureDefaults, expectedSection?.texture),
                updated.texture,
            );
            if (targetTexture) {
                updated.texture = {
                    ...targetTexture,
                    ...(targetTexture.notes?.length ? {
                        notes: uniqueNotes(targetTexture.notes, texturePlanNotes(targetTexture)),
                    } : {
                        notes: texturePlanNotes(targetTexture),
                    }),
                };
                if ((targetTexture.voiceCount ?? 0) >= 3) {
                    updated.density = Number(clamp(updated.density + 0.04, 0.22, 0.94).toFixed(3));
                }
            }
            updated.notes = uniqueNotes(updated.notes, texturePlanNotes(targetTexture));
        }

        let revisedExpression = kinds.has("shape_dynamics") || kinds.has("clarify_expression")
            ? mergeExpressionGuidance(expressionDefaults, updated.expression)
            : undefined;

        if (kinds.has("shape_dynamics")) {
            revisedExpression = reinforceDynamicsExpression(revisedExpression, updated);
            updated.notes = uniqueNotes(updated.notes, ["Make the dynamic swell and release explicit enough that the planned phrase arc survives realization."]);
        }

        if (kinds.has("clarify_expression")) {
            revisedExpression = clarifyExpressionProfile(revisedExpression, updated);
            updated.notes = uniqueNotes(updated.notes, ["Keep articulation, character, and phrase-peak cues explicit so the section's expression profile stays audible."]);
        }

        if (revisedExpression) {
            updated.expression = cloneExpressionGuidance(revisedExpression);
        }

        if (kinds.has("shape_tempo_motion") && (updated.tempoMotion?.length || artifact?.tempoMotionSummary?.requestedTags?.length)) {
            const revisedTempoMotion = resolveTempoMotionRevisionPlans(updated, artifact);
            if (revisedTempoMotion.length > 0) {
                updated.tempoMotion = revisedTempoMotion;
                updated.notes = uniqueNotes(updated.notes, tempoMotionRevisionNotes(revisedTempoMotion));
                updated.density = Number(clamp(updated.density + 0.04, 0.2, 0.92).toFixed(3));
            }
        }

        if (kinds.has("shape_ornament_hold") && (updated.ornaments?.length || artifact?.ornamentSummary?.explicitlyRealizedTags?.length)) {
            const revisedOrnaments = resolveOrnamentRevisionPlans(updated, artifact);
            if (revisedOrnaments.length > 0) {
                updated.ornaments = revisedOrnaments;
                updated.notes = uniqueNotes(updated.notes, ornamentRevisionNotes(revisedOrnaments));
                updated.density = Number(clamp(updated.density + 0.02, 0.18, 0.92).toFixed(3));
            }
        }

        return updated;
    });

    if (hasGlobalDirective(directives, "extend_length")) {
        const lastSection = revised[revised.length - 1];
        lastSection.measures += revised.length > 1 ? 2 : 4;
        lastSection.notes = uniqueNotes(lastSection.notes, ["Allow a slightly longer closing sentence so the cadence can settle."]);
    }

    for (const section of revised) {
        if (hasTargetedDirective(directives, "extend_length", section.id)) {
            section.measures += revised.length > 1 ? 2 : 4;
            section.notes = uniqueNotes(section.notes, ["Allow this section slightly more room to land its local phrase goal."]);
        }
    }

    if (hasGlobalDirective(directives, "strengthen_cadence")) {
        const lastSection = revised[revised.length - 1];
        const artifact = artifactById.get(lastSection.id);
        const cadence = resolveCadenceRevisionTarget(lastSection);
        lastSection.cadence = cadence;
        lastSection.harmonicPlan = {
            ...(lastSection.harmonicPlan ?? {}),
            cadence,
            allowModulation: shouldPreserveCadentialModulation(lastSection, cadence),
        };
        lastSection.notes = uniqueNotes(lastSection.notes, cadenceSupportNotes(cadence, artifact));
    }

    for (const section of revised) {
        if (!hasTargetedDirective(directives, "strengthen_cadence", section.id)) {
            continue;
        }

        const artifact = artifactById.get(section.id);
        const cadence = resolveCadenceRevisionTarget(section);
        section.cadence = cadence;
        section.harmonicPlan = {
            ...(section.harmonicPlan ?? {}),
            cadence,
            allowModulation: shouldPreserveCadentialModulation(section, cadence),
        };
        section.notes = uniqueNotes(section.notes, cadenceSupportNotes(cadence, artifact));
    }

    return revised;
}

export function classifyQualityProfile(form?: string): QualityProfileName {
    const normalizedForm = normalizeForm(form);
    if (!normalizedForm) {
        return "default";
    }

    const templateProfile = resolveFormTemplateQualityProfile(normalizedForm);
    if (templateProfile) {
        return templateProfile as QualityProfileName;
    }

    if (matchesAnyPattern(normalizedForm, GRAND_FORM_PATTERNS)) {
        return "grand_form";
    }

    if (matchesAnyPattern(normalizedForm, FORMAL_CLASSICAL_PATTERNS)) {
        return "formal_classical";
    }

    if (matchesAnyPattern(normalizedForm, CHAMBER_PATTERNS)) {
        return "chamber_ensemble";
    }

    if (matchesAnyPattern(normalizedForm, SHORT_FORM_PATTERNS)) {
        return "lyric_short_form";
    }

    return "default";
}

export function buildRecommendedQualityPolicy(form: string | undefined, workflow: ComposeWorkflow): ComposeQualityPolicy {
    const defaults = QUALITY_PROFILE_DEFAULTS[classifyQualityProfile(form)];

    return {
        enableAutoRevision: workflow !== "audio_only",
        maxStructureAttempts: workflow === "audio_only" ? 1 : defaults.maxStructureAttempts,
        ...(workflow !== "audio_only" ? { targetStructureScore: defaults.structureTarget } : {}),
        ...(workflow !== "symbolic_only" ? { targetAudioScore: defaults.audioTarget } : {}),
    };
}

export function resolveQualityPolicy(
    request: ComposeRequest,
    executionPlan: ComposeExecutionPlan,
): ComposeQualityPolicy {
    const defaults = buildRecommendedQualityPolicy(request.form ?? request.compositionPlan?.form, executionPlan.workflow);

    return {
        enableAutoRevision: request.qualityPolicy?.enableAutoRevision ?? defaults.enableAutoRevision,
        maxStructureAttempts: clampAttemptCount(request.qualityPolicy?.maxStructureAttempts, defaults.maxStructureAttempts ?? DEFAULT_MAX_STRUCTURE_ATTEMPTS),
        targetStructureScore: request.qualityPolicy?.targetStructureScore !== undefined
            ? clamp(request.qualityPolicy.targetStructureScore, 0, 100)
            : defaults.targetStructureScore,
        targetAudioScore: request.qualityPolicy?.targetAudioScore !== undefined
            ? clamp(request.qualityPolicy.targetAudioScore, 0, 100)
            : defaults.targetAudioScore,
    };
}

export function hasExplicitStructureTarget(request: ComposeRequest): boolean {
    return typeof request.qualityPolicy?.targetStructureScore === "number"
        && Number.isFinite(request.qualityPolicy.targetStructureScore);
}

export function shouldEnforceAudioTarget(
    request: ComposeRequest,
    executionPlan: ComposeExecutionPlan,
    policy: ComposeQualityPolicy,
): boolean {
    if (policy.targetAudioScore === undefined) {
        return false;
    }

    return executionPlan.workflow === "audio_only"
        || (typeof request.qualityPolicy?.targetAudioScore === "number" && Number.isFinite(request.qualityPolicy.targetAudioScore));
}

export function meetsAudioTarget(
    evaluation: AudioEvaluationReport,
    policy: ComposeQualityPolicy,
): boolean {
    if (policy.targetAudioScore === undefined || evaluation.score === undefined) {
        return true;
    }

    return evaluation.score >= policy.targetAudioScore;
}

export function shouldRetryAudioAttempt(
    evaluation: AudioEvaluationReport,
    attempt: number,
    policy: ComposeQualityPolicy,
    request?: ComposeRequest,
    structureEvaluation?: StructureEvaluationReport,
): boolean {
    if (!policy.enableAutoRevision) {
        return false;
    }

    const workflow = request?.workflow ?? request?.compositionPlan?.workflow;
    if (workflow === "audio_only") {
        return false;
    }

    const maxAttempts = clampAttemptCount(policy.maxStructureAttempts, DEFAULT_MAX_STRUCTURE_ATTEMPTS);
    if (attempt >= maxAttempts) {
        return false;
    }

    const metrics = evaluation.metrics ?? {};
    const developmentFit = typeof metrics.audioDevelopmentNarrativeFit === "number" ? metrics.audioDevelopmentNarrativeFit : undefined;
    const recapFit = typeof metrics.audioRecapRecallFit === "number" ? metrics.audioRecapRecallFit : undefined;
    const consistency = typeof metrics.audioNarrativeRenderConsistency === "number" ? metrics.audioNarrativeRenderConsistency : undefined;
    const tonalReturnFit = typeof metrics.audioTonalReturnRenderFit === "number" ? metrics.audioTonalReturnRenderFit : undefined;
    const harmonicRouteFit = typeof metrics.audioHarmonicRouteRenderFit === "number" ? metrics.audioHarmonicRouteRenderFit : undefined;
    const harmonicRealizationFit = typeof metrics.audioHarmonicRealizationPlanFit === "number" ? metrics.audioHarmonicRealizationPlanFit : undefined;
    const harmonicRealizationCoverageFit = typeof metrics.audioHarmonicRealizationCoverageFit === "number" ? metrics.audioHarmonicRealizationCoverageFit : undefined;
    const harmonicRealizationDensityFit = typeof metrics.audioHarmonicRealizationDensityFit === "number" ? metrics.audioHarmonicRealizationDensityFit : undefined;
    const tonicizationRealizationFit = typeof metrics.audioTonicizationRealizationFit === "number" ? metrics.audioTonicizationRealizationFit : undefined;
    const prolongationRealizationFit = typeof metrics.audioProlongationRealizationFit === "number" ? metrics.audioProlongationRealizationFit : undefined;
    const harmonicColorRealizationFit = typeof metrics.audioHarmonicColorRealizationFit === "number" ? metrics.audioHarmonicColorRealizationFit : undefined;
    const phraseBreathFit = typeof metrics.audioPhraseBreathPlanFit === "number" ? metrics.audioPhraseBreathPlanFit : undefined;
    const tempoMotionFit = typeof metrics.audioTempoMotionPlanFit === "number" ? metrics.audioTempoMotionPlanFit : undefined;
    const ornamentFit = typeof metrics.audioOrnamentPlanFit === "number" ? metrics.audioOrnamentPlanFit : undefined;
    const longSpanDivergence = summarizeLongSpanDivergence(
        structureEvaluation?.longSpan,
        evaluation.longSpan,
        evaluation,
        structureEvaluation,
    );
    const actionableLongSpanCollapse = longSpanDivergence?.status === "render_collapsed";
    const targetMiss = policy.targetAudioScore !== undefined
        && evaluation.score !== undefined
        && evaluation.score < policy.targetAudioScore;

    const narrativeWeak = evaluation.issues.some((issue) => (
        issue.startsWith("Rendered audio does not clearly escalate")
        || issue.startsWith("Rendered audio does not clearly support the recap")
        || issue.startsWith("Rendered audio collapses the planned tonal return")
        || issue.startsWith("Rendered audio blurs the planned harmonic route")
        || issue.startsWith("Harmonic realization cues do not survive strongly enough")
        || issue.startsWith("Phrase-breath cues do not survive strongly enough")
        || issue.startsWith("Tempo-motion cues do not survive strongly enough")
        || issue.startsWith("Ornament hold cues do not survive strongly enough")
        || issue.startsWith("Rendered and styled audio disagree")
    )) || (developmentFit !== undefined && developmentFit < 0.62)
        || (recapFit !== undefined && recapFit < 0.62)
        || (tonalReturnFit !== undefined && tonalReturnFit < 0.58)
        || (harmonicRouteFit !== undefined && harmonicRouteFit < 0.56)
        || (harmonicRealizationFit !== undefined && harmonicRealizationFit < 0.62)
        || (harmonicRealizationCoverageFit !== undefined && harmonicRealizationCoverageFit < 0.6)
        || (harmonicRealizationDensityFit !== undefined && harmonicRealizationDensityFit < 0.58)
        || (tonicizationRealizationFit !== undefined && tonicizationRealizationFit < 0.58)
        || (prolongationRealizationFit !== undefined && prolongationRealizationFit < 0.58)
        || (harmonicColorRealizationFit !== undefined && harmonicColorRealizationFit < 0.58)
        || (phraseBreathFit !== undefined && phraseBreathFit < 0.62)
        || (tempoMotionFit !== undefined && tempoMotionFit < 0.62)
        || (ornamentFit !== undefined && ornamentFit < 0.64)
        || (consistency !== undefined && consistency < 0.58)
        || actionableLongSpanCollapse;

    return narrativeWeak && (!evaluation.passed || targetMiss || actionableLongSpanCollapse);
}

export function shouldRetryStructureAttempt(
    evaluation: StructureEvaluationReport,
    attempt: number,
    policy: ComposeQualityPolicy,
    request?: ComposeRequest,
): boolean {
    if (!policy.enableAutoRevision) {
        return false;
    }

    const maxAttempts = clampAttemptCount(policy.maxStructureAttempts, DEFAULT_MAX_STRUCTURE_ATTEMPTS);
    if (attempt >= maxAttempts) {
        return false;
    }

    const { riskProfile, structureVisibility } = getPlanIntent(request);
    const metrics = evaluation.metrics ?? {};
    const target = policy.targetStructureScore;
    const margin = scoreRetryMargin(riskProfile);
    const score = evaluation.score ?? 0;
    const softOnly = evaluation.issues.length > 0 && evaluation.issues.every((issue) => isSoftIssue(issue));
    const veiledStructure = structureVisibility === "hidden" || structureVisibility === "complex";
    const scoreNearTarget = target !== undefined && score >= target - margin;
    const longSpanWeak = hasWeakLongSpanStructure(metrics, request);

    if (!evaluation.passed) {
        if (riskProfile && softOnly && !hasHardIssue(evaluation.issues)) {
            if (riskProfile === "experimental" && veiledStructure && scoreNearTarget) {
                return false;
            }
            if (scoreNearTarget && attempt >= 2) {
                return false;
            }
            if (riskProfile === "experimental" && attempt >= maxAttempts - 1) {
                return false;
            }
        }
        return true;
    }

    if (longSpanWeak) {
        if (riskProfile === "experimental" && veiledStructure && attempt >= maxAttempts - 1) {
            return false;
        }
        return true;
    }

    return evaluation.score !== undefined
        && policy.targetStructureScore !== undefined
        && evaluation.score < policy.targetStructureScore - margin;
}

export function buildStructureRevisionDirectives(
    evaluation: StructureEvaluationReport,
    targetStructureScore?: number,
    request?: ComposeRequest,
): RevisionDirective[] {
    const directives = new Map<RevisionDirective["kind"], RevisionDirective>();
    const metrics = evaluation.metrics ?? {};
    const issues = evaluation.issues.map((issue) => issue.trim()).filter(Boolean);
    const { riskProfile, structureVisibility } = getPlanIntent(request);

    for (const issue of issues) {
        if (issue.startsWith("Too few notes") || issue.startsWith("Piece too short")) {
            appendDirective(directives, {
                kind: "extend_length",
                priority: 100,
                reason: "Lengthen the phrase plan so the melody has enough material to develop.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Excessive repetition")) {
            appendDirective(directives, {
                kind: "reduce_repetition",
                priority: 96,
                reason: "Break literal pitch repetition with a more varied local contour.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Melody span too narrow")) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 84,
                reason: "Widen the lead-register arc so the theme breathes more naturally.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Limited pitch-class variety")) {
            appendDirective(directives, {
                kind: "increase_pitch_variety",
                priority: 82,
                reason: "Introduce more scale-degree contrast in the lead line.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Rhythm is too uniform")) {
            appendDirective(directives, {
                kind: "increase_rhythm_variety",
                priority: 78,
                reason: "Use more than one note-length cell inside each phrase.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Too many wide leaps") || issue.startsWith("Large leaps are not balanced")) {
            appendDirective(directives, {
                kind: "reduce_large_leaps",
                priority: 94,
                reason: "Favor stepwise recovery so the melody stays singable.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Parallel perfect intervals weaken")) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 92,
                reason: "Rework outer-voice motion so bass and melody avoid consecutive perfect fifths or octaves.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Final melodic note does not resolve") || issue.startsWith("Cadential bass motion does not")) {
            appendDirective(directives, {
                kind: "strengthen_cadence",
                priority: 98,
                reason: "Tighten the closing cadence so the lead voice and bass both reinforce the tonic arrival.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Modulation path does not land") || issue.startsWith("Piece-level harmonic route is not yet coherent enough")) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 88,
                reason: "Keep modulations in related tonal areas and re-anchor the form more clearly around its primary tonic.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Dominant preparation is weak")) {
            appendDirective(directives, {
                kind: "strengthen_cadence",
                priority: 90,
                reason: "Prepare major arrivals with clearer dominant support in the bass before the tonal landing.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Recap does not re-establish the opening tonic")) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 86,
                reason: "Bring the recap back to the opening tonal center so the return reads harmonically, not just motivically.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section tonal center drifts from planned") || issue.startsWith("Section harmonic plan does not read clearly")) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 90,
                reason: "Re-anchor the weak section to its planned tonal role so the local harmonic function reads clearly.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Cadence arrival is weaker than planned")) {
            appendDirective(directives, {
                kind: "strengthen_cadence",
                priority: 92,
                reason: "Strengthen the targeted arrival so the section lands with the planned cadential weight.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Register planning drifts from the intended section targets")) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 86,
                reason: "Bring realized section registers closer to the planned targets so the large-scale contour reads as intended.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("String-trio idiomatic range writing drifts outside the planned instrument comfort zones")) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 84,
                reason: "Recenter the weak trio section so each string stays inside a more idiomatic range band.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("String-trio register balance blurs the planned lead, middle, and bass stack")) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 80,
                reason: "Separate lead, middle, and bass layers more clearly so the trio stack stops collapsing in register.",
                sourceIssue: issue,
            });
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 82,
                reason: "Clarify which string carries lead, middle, and bass duties so ensemble balance stays legible.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("String-trio doubling pressure blurs independent instrument roles across the form")) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 84,
                reason: "Thin the weak trio section so the secondary string and bass stop shadowing the lead too often.",
                sourceIssue: issue,
            });
            appendDirective(directives, {
                kind: "expand_register",
                priority: 78,
                reason: "Separate the trio layers further in register so repeated doubling pressure stops masking instrument roles.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("String-trio texture rotation does not refresh conversation, balance, or spacing states clearly enough across the form")) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 84,
                reason: "Reset the arriving trio section into a clearly new conversation, balance, or spacing stance so the texture actually turns.",
                sourceIssue: issue,
            });
            appendDirective(directives, {
                kind: "expand_register",
                priority: 76,
                reason: "Move the trio into a clearer new spacing band so the planned texture rotation reads immediately.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("String-trio conversational sections do not sustain enough independent exchange")) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 84,
                reason: "Give the secondary string a clearer answer-like line so conversational trio sections do not collapse into accompaniment.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("String-trio section-to-section handoffs do not reassign lead, middle, and bass duties clearly enough")) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 80,
                reason: "Shift the arriving trio section into a clearer new register stack so the handoff reads immediately.",
                sourceIssue: issue,
            });
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 84,
                reason: "State which string inherits lead, middle, and bass duties after the handoff so the rotation stays legible.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Bass cadence approach does not match the planned sectional closes")) {
            appendDirective(directives, {
                kind: "strengthen_cadence",
                priority: 90,
                reason: "Align bass approach motion with the planned sectional cadences so close-types sound intentional.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section phrase rhetoric drifts from the planned formal roles")) {
            appendDirective(directives, {
                kind: "clarify_phrase_rhetoric",
                priority: 78,
                reason: "Reassert each weak section's phrase goal so presentation, continuation, transition, and cadence rhetoric survive realization.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section phrase pressure compresses the planned formal contrast")) {
            appendDirective(directives, {
                kind: "clarify_phrase_rhetoric",
                priority: 82,
                reason: "Increase local continuation pressure or cadential release so the weak section projects a clear phrase job instead of flattening out.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section texture drift weakens the planned voice-count and role profile")) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 80,
                reason: "Make the planned voice layout and counterline roles more explicit so texture survives symbolic realization.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Planned inner-voice or counterline sections stay too static after realization")) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 82,
                reason: "Strengthen the planned independent line so inner-voice or counterline sections do not collapse into static accompaniment.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Counterpoint behavior is too weak in the sections that requested it")) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 82,
                reason: "Reinforce the requested counterpoint motion so contrary or free line behavior survives symbolic realization.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Imitative sections do not retain enough source-motif relation after realization")) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 84,
                reason: "Restate the source motif and answer-like response more explicitly so imitative sections survive symbolic realization as related strands, not generic activity.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section expression drift weakens the planned dynamic and articulation profile")) {
            appendDirective(directives, {
                kind: "shape_dynamics",
                priority: 80,
                reason: "Restate the planned dynamic arc more explicitly so the section profile survives symbolic realization.",
                sourceIssue: issue,
            });
            appendDirective(directives, {
                kind: "clarify_expression",
                priority: 78,
                reason: "Make articulation and character cues more explicit so the planned phrasing reads clearly.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section dynamics drift from the planned expression contour")) {
            appendDirective(directives, {
                kind: "shape_dynamics",
                priority: 84,
                reason: "Make the planned start, peak, and release dynamics more explicit so the phrase contour reads clearly.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section articulation or character does not match the planned expression profile")) {
            appendDirective(directives, {
                kind: "clarify_expression",
                priority: 82,
                reason: "Reassert articulation, character, and phrase-shaping cues so the section's expression profile is audible instead of implied.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section harmonic plan blocks the modulation expected")) {
            appendDirective(directives, {
                kind: "clarify_narrative_arc",
                priority: 84,
                reason: "Let the development-class section move further away from the opening so its modulatory role becomes audible.",
                sourceIssue: issue,
            });
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 82,
                reason: "Adjust the targeted section's tonal plan so it supports the modulation expected for its formal role.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section tonicization pressure is too weak")) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 88,
                reason: "Introduce clearer local departure and return so the weak section implies its tonicization instead of sitting on one harmony.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Planned harmonic color does not survive clearly enough")
            || issue.startsWith("Section harmonic color cues do not survive clearly enough")
            || issue.startsWith("Section harmonic color coverage drops")
            || issue.startsWith("Section harmonic color target or resolution drifts")) {
            appendDirective(directives, {
                kind: "clarify_harmonic_color",
                priority: 88,
                reason: "Restore one explicit local harmonic-color event so the weak section projects mixture, suspension, predominant color, or applied-dominant intent instead of generic harmony only.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section prolongation stays too static")) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 86,
                reason: "Keep the tonal anchor, but vary supporting harmony so the weak section does not stall inside one prolonged sonority.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Form-specific harmonic and thematic roles are not yet coherent enough")) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 86,
                reason: "Clarify section-to-section harmonic roles so the form reads more coherently across the whole piece.",
                sourceIssue: issue,
            });
        }

        if (issue.startsWith("Section tension arc diverges")) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 66,
                reason: "Differentiate the section register arc so the large-scale tension contour reads more clearly.",
                sourceIssue: issue,
            });
            appendDirective(directives, {
                kind: "increase_rhythm_variety",
                priority: 62,
                reason: "Shape local density changes more clearly so the tension curve is audible across sections.",
                sourceIssue: issue,
            });
        }
    }

    const developmentLongSpanSeverity = Math.max(
        longSpanMetricSeverity(metrics, "longSpanDevelopmentPressureFit", 0.58),
        longSpanMetricSeverity(metrics, "longSpanThematicTransformationFit", 0.56),
    );
    if (developmentLongSpanSeverity > 0) {
        const sectionIds = pickLongSpanDevelopmentSectionIds(evaluation, request, 2);
        appendDirective(directives, {
            kind: "clarify_narrative_arc",
            priority: developmentLongSpanSeverity >= 0.16 ? 94 : 86,
            reason: "Re-focus the planned development zone so long-span pressure and thematic transformation accumulate clearly before the return.",
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const harmonicTimingSeverity = longSpanMetricSeverity(metrics, "longSpanHarmonicTimingFit", 0.58);
    if (harmonicTimingSeverity > 0) {
        const sectionIds = pickLongSpanReturnBoundarySectionIds(evaluation, request, 2);
        appendDirective(directives, {
            kind: "stabilize_harmony",
            priority: harmonicTimingSeverity >= 0.16 ? 92 : 84,
            reason: "Clarify the return boundary so retransition, harmonic preparation, and home-key arrival line up with the planned long-span return.",
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const returnPayoffSeverity = longSpanMetricSeverity(metrics, "longSpanReturnPayoffFit", 0.62);
    if (returnPayoffSeverity > 0) {
        const sectionIds = pickLongSpanReturnSectionIds(evaluation, request, 1);
        appendDirective(directives, {
            kind: "rebalance_recap_release",
            priority: returnPayoffSeverity >= 0.16 ? 96 : 88,
            reason: "Make the planned return pay off more clearly by restating the opening identity and settling below the development peak.",
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const target = targetStructureScore ?? DEFAULT_TARGET_STRUCTURE_SCORE;
    if ((evaluation.score ?? 0) < target) {
        if ((metrics.melodicSpan ?? 0) < 8) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 72,
                reason: "The melody can use a wider register even if it already clears the hard rule threshold.",
            });
        }

        if ((metrics.uniquePitchClasses ?? 0) < 5) {
            appendDirective(directives, {
                kind: "increase_pitch_variety",
                priority: 70,
                reason: "Raise scale-degree variety to improve memorability.",
            });
        }

        if ((metrics.uniqueDurations ?? 0) < 3) {
            appendDirective(directives, {
                kind: "increase_rhythm_variety",
                priority: 68,
                reason: "A slightly richer rhythmic palette should lift the structure score.",
            });
        }

        if ((metrics.wideLeapRatio ?? 0) > 0.18) {
            appendDirective(directives, {
                kind: "reduce_large_leaps",
                priority: 74,
                reason: "Lower the leap ratio to keep the phrase more singable.",
            });
        }

        if ((metrics.parallelPerfectCount ?? 0) >= 2) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 76,
                reason: "Reduce exposed parallel perfect motion so the bass and melody articulate harmony more independently.",
            });
        }

        if ((metrics.globalHarmonicProgressionStrength ?? 1) < 0.58) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 78,
                reason: "Clarify the piece-level tonal route so modulation, preparation, and tonal return read across the whole form.",
            });
        }

        if ((metrics.sectionHarmonicPlanFit ?? 1) < 0.58) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 82,
                reason: "Tighten the weakest section's harmonic plan so its local formal role is clearer.",
            });
        }

        if ((metrics.formCoherenceScore ?? 1) < 0.6) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 84,
                reason: "Raise form coherence by sharpening section-specific harmonic roles and returns.",
            });
        }

        if ((metrics.tonicizationPressureFit ?? 1) < 0.68) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 86,
                reason: "Increase local harmonic departure and return so tonicization pressure becomes audible in the weak section.",
            });
        }

        if ((metrics.harmonicColorPlanFit ?? 1) < 0.68) {
            appendDirective(directives, {
                kind: "clarify_harmonic_color",
                priority: 87,
                reason: "Make one local harmonic-color event explicit so the weak section projects mixture, applied-dominant, suspension, or predominant intent clearly.",
            });
        }

        if ((metrics.prolongationMotionFit ?? 1) < 0.68) {
            appendDirective(directives, {
                kind: "stabilize_harmony",
                priority: 84,
                reason: "Keep the tonal center anchored while adding enough harmonic motion that the weak section does not stall.",
            });
        }

        if ((metrics.harmonicCadenceSupport ?? 1) >= 0 && (metrics.harmonicCadenceSupport ?? 1) < 0.6) {
            appendDirective(directives, {
                kind: "strengthen_cadence",
                priority: 80,
                reason: "Improve cadential bass preparation so formal closes sound structurally grounded.",
            });
        }

        if ((metrics.registerPlanFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 78,
                reason: "Move realized section registers closer to their planned targets so the formal contour reads more clearly.",
            });
        }

        if ((metrics.orchestrationIdiomaticRangeFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 80,
                reason: "Recenter the weak trio section so each string stays inside a more idiomatic range band.",
            });
        }

        if ((metrics.orchestrationRegisterBalanceFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 80,
                reason: "Rebuild the trio stack so lead, middle, and bass layers separate more clearly in register.",
            });
        }

        if ((metrics.orchestrationConversationFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 82,
                reason: "Give the secondary string a clearer independent reply so conversational trio sections remain audible.",
            });
        }

        if ((metrics.orchestrationDoublingPressureFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 84,
                reason: "Thin the trio writing so secondary and bass roles stop shadowing the lead too often.",
            });
            appendDirective(directives, {
                kind: "expand_register",
                priority: 78,
                reason: "Separate the trio layers more clearly in register so persistent doubling pressure eases.",
            });
        }

        if ((metrics.orchestrationTextureRotationFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 84,
                reason: "Reset the arriving trio section into a clearly new conversation, balance, or spacing stance so the texture actually turns.",
            });
            appendDirective(directives, {
                kind: "expand_register",
                priority: 76,
                reason: "Move the trio into a clearer new spacing band so the planned texture rotation reads immediately.",
            });
        }

        if ((metrics.orchestrationSectionHandoffFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 80,
                reason: "Make the arriving trio section land in a clearer new register band so the handoff reads immediately.",
            });
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 84,
                reason: "Clarify which string takes over lead, middle, and bass duties after the handoff.",
            });
        }

        if ((metrics.cadenceApproachPlanFit ?? 1) >= 0 && (metrics.cadenceApproachPlanFit ?? 1) < 0.68) {
            appendDirective(directives, {
                kind: "strengthen_cadence",
                priority: 82,
                reason: "Improve bass approach motion in the weakest close so sectional cadence types sound more intentional.",
            });
        }

        if ((metrics.phraseFunctionFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "clarify_phrase_rhetoric",
                priority: 74,
                reason: "Restate the weak section's local phrase function so the form reads as presentation, continuation, transition, development, or cadence instead of a generic span.",
            });
        }

        if ((metrics.phrasePressureFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "clarify_phrase_rhetoric",
                priority: 80,
                reason: "Restore local phrase pressure so the weak section no longer compresses continuation, transition, or cadential release into a flat span.",
            });
        }

        if (
            (metrics.texturePlanFit ?? 1) < 0.72
            || (metrics.textureIndependenceFit ?? 1) < 0.68
            || (metrics.counterpointBehaviorFit ?? 1) < 0.68
            || (metrics.imitationFit ?? 1) < 0.68
        ) {
            appendDirective(directives, {
                kind: "clarify_texture_plan",
                priority: 76,
                reason: "Reinforce the planned number of active voices and texture roles so the section does not flatten into a single accompaniment texture.",
            });
        }

        if ((metrics.tensionArcMismatch ?? 0) > 0.22) {
            appendDirective(directives, {
                kind: "expand_register",
                priority: 64,
                reason: "Clarify the contrast between higher- and lower-tension sections across the full form.",
            });
            appendDirective(directives, {
                kind: "increase_rhythm_variety",
                priority: 60,
                reason: "Use more audible density shifts so the planned tension contour can be heard.",
            });
        }

        if ((metrics.dynamicsPlanFit ?? 1) < 0.66) {
            appendDirective(directives, {
                kind: "shape_dynamics",
                priority: 76,
                reason: "Widen and clarify the dynamic arc so the planned phrase swell and release are audible in the next pass.",
            });
        }

        if ((metrics.articulationCharacterPlanFit ?? 1) < 0.7 || (metrics.expressionPlanFit ?? 1) < 0.72) {
            appendDirective(directives, {
                kind: "clarify_expression",
                priority: 74,
                reason: "Make articulation, character, and phrase-shaping cues more explicit so the section expression survives realization.",
            });
        }
    }

    return Array.from(directives.values())
        .map((directive) => attachDirectiveSectionTargets(directive, evaluation))
        .map((directive) => boostDirectivePriorityFromTargets(directive, evaluation))
        .map((directive) => tuneDirectivePriority(directive, riskProfile, structureVisibility))
        .sort((left, right) => right.priority - left.priority);
}

export function buildAudioRevisionDirectives(
    evaluation: AudioEvaluationReport,
    targetAudioScore?: number,
    request?: ComposeRequest,
    structureEvaluation?: StructureEvaluationReport,
): RevisionDirective[] {
    const directives = new Map<RevisionDirective["kind"], RevisionDirective>();
    const metrics = evaluation.metrics ?? {};
    const issues = evaluation.issues.map((issue) => issue.trim()).filter(Boolean);
    const { riskProfile, structureVisibility } = getPlanIntent(request);
    const longSpanDivergence = summarizeLongSpanDivergence(
        structureEvaluation?.longSpan,
        evaluation.longSpan,
        evaluation,
        structureEvaluation,
    );
    const developmentFit = typeof metrics.audioDevelopmentNarrativeFit === "number" ? metrics.audioDevelopmentNarrativeFit : undefined;
    const recapFit = typeof metrics.audioRecapRecallFit === "number" ? metrics.audioRecapRecallFit : undefined;
    const consistency = typeof metrics.audioNarrativeRenderConsistency === "number" ? metrics.audioNarrativeRenderConsistency : undefined;
    const tonalReturnFit = typeof metrics.audioTonalReturnRenderFit === "number" ? metrics.audioTonalReturnRenderFit : undefined;
    const harmonicRouteFit = typeof metrics.audioHarmonicRouteRenderFit === "number" ? metrics.audioHarmonicRouteRenderFit : undefined;
    const harmonicRealizationFit = typeof metrics.audioHarmonicRealizationPlanFit === "number" ? metrics.audioHarmonicRealizationPlanFit : undefined;
    const harmonicRealizationCoverageFit = typeof metrics.audioHarmonicRealizationCoverageFit === "number" ? metrics.audioHarmonicRealizationCoverageFit : undefined;
    const harmonicRealizationDensityFit = typeof metrics.audioHarmonicRealizationDensityFit === "number" ? metrics.audioHarmonicRealizationDensityFit : undefined;
    const tonicizationRealizationFit = typeof metrics.audioTonicizationRealizationFit === "number" ? metrics.audioTonicizationRealizationFit : undefined;
    const prolongationRealizationFit = typeof metrics.audioProlongationRealizationFit === "number" ? metrics.audioProlongationRealizationFit : undefined;
    const harmonicColorRealizationFit = typeof metrics.audioHarmonicColorRealizationFit === "number" ? metrics.audioHarmonicColorRealizationFit : undefined;
    const phraseBreathFit = typeof metrics.audioPhraseBreathPlanFit === "number" ? metrics.audioPhraseBreathPlanFit : undefined;
    const tempoMotionFit = typeof metrics.audioTempoMotionPlanFit === "number" ? metrics.audioTempoMotionPlanFit : undefined;
    const ornamentFit = typeof metrics.audioOrnamentPlanFit === "number" ? metrics.audioOrnamentPlanFit : undefined;
    const targetMiss = targetAudioScore !== undefined
        && evaluation.score !== undefined
        && evaluation.score < targetAudioScore;

    if (longSpanDivergence?.recommendedDirectiveKind) {
        const sectionIds = pickAudioLongSpanDivergenceSectionIds(evaluation, request, longSpanDivergence);
        appendDirective(directives, {
            kind: longSpanDivergence.recommendedDirectiveKind,
            priority: longSpanDivergenceDirectivePriority(longSpanDivergence),
            reason: buildLongSpanDivergenceDirectiveReason(longSpanDivergence),
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
        appendSecondaryLongSpanDivergenceDirectives(directives, evaluation, request, longSpanDivergence);
    }

    const developmentIssue = issues.find((issue) => issue.startsWith("Rendered audio does not clearly escalate"));
    if (developmentIssue || (developmentFit !== undefined && developmentFit < 0.62)) {
        const sectionIds = pickAudioSectionIdsByRoles(evaluation, request, ["development", "variation", "bridge"], 2, {
            issuePrefixes: [
                "Audio escalation against the source section is weak.",
                "Rendered and styled audio disagree on the section's narrative contour.",
                "Rendered and styled audio disagree on the development's modulation profile.",
            ],
            metricKeys: [
                "audioDevelopmentNarrativeFit",
                "audioSectionNarrativeConsistencyFit",
                "audioDevelopmentRouteConsistencyFit",
            ],
        });
        appendDirective(directives, {
            kind: "clarify_narrative_arc",
            priority: developmentFit !== undefined && developmentFit < 0.44 ? 94 : 84,
            reason: "Push the development further away from the opening in register, density, and motif treatment so the escalation reads in audio.",
            sourceIssue: developmentIssue,
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const recapIssue = issues.find((issue) => issue.startsWith("Rendered audio does not clearly support the recap"));
    if (recapIssue || (recapFit !== undefined && recapFit < 0.62)) {
        const sectionIds = pickAudioSectionIdsByRoles(evaluation, request, ["recap", "cadence", "outro"], 1, {
            issuePrefixes: [
                "Audio return and release against the source section are weak.",
                "Rendered and styled audio disagree on the section's narrative contour.",
                "Rendered and styled audio disagree on the recap's tonal return.",
            ],
            metricKeys: [
                "audioRecapRecallFit",
                "audioSectionNarrativeConsistencyFit",
                "audioRecapTonalConsistencyFit",
            ],
        });
        appendDirective(directives, {
            kind: "rebalance_recap_release",
            priority: recapFit !== undefined && recapFit < 0.42 ? 96 : 86,
            reason: "Re-anchor the recap to the opening motif and let the release settle below the development peak.",
            sourceIssue: recapIssue,
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const tonalReturnIssue = issues.find((issue) => issue.startsWith("Rendered audio collapses the planned tonal return"));
    if (tonalReturnIssue || (tonalReturnFit !== undefined && tonalReturnFit < 0.58)) {
        const recapSectionIds = pickAudioSectionIdsByRoles(evaluation, request, ["recap", "cadence", "outro"], 1, {
            issuePrefixes: [
                "Rendered pitch-class return does not settle back into the planned recap tonality.",
                "Rendered and styled audio disagree on the recap's tonal return.",
                "Audio return and release against the source section are weak.",
            ],
            metricKeys: [
                "audioRecapTonalConsistencyFit",
                "audioRecapPitchClassReturnFit",
                "audioSectionNarrativeConsistencyFit",
            ],
        });
        appendDirective(directives, {
            kind: "rebalance_recap_release",
            priority: tonalReturnFit !== undefined && tonalReturnFit < 0.42 ? 98 : 88,
            reason: "Re-establish the recap's tonal arrival so the rendered return does not collapse after the development.",
            sourceIssue: tonalReturnIssue,
            ...(recapSectionIds.length > 0 ? { sectionIds: recapSectionIds } : {}),
        });
        appendDirective(directives, {
            kind: "stabilize_harmony",
            priority: tonalReturnFit !== undefined && tonalReturnFit < 0.42 ? 92 : 80,
            reason: "Tighten recap harmony and bass support so the rendered close keeps its planned tonal center.",
            sourceIssue: tonalReturnIssue,
            ...(recapSectionIds.length > 0 ? { sectionIds: recapSectionIds } : {}),
        });
    }

    const consistencyIssue = issues.find((issue) => issue.startsWith("Rendered and styled audio disagree"));
    if (consistencyIssue || (consistency !== undefined && consistency < 0.58)) {
        const sectionIds = pickAudioSectionIdsByRoles(evaluation, request, ["development", "variation", "bridge", "recap", "cadence", "outro"], 2, {
            issuePrefixes: [
                "Rendered and styled audio disagree on the section's narrative contour.",
                "Rendered and styled audio disagree on the development's modulation profile.",
                "Rendered and styled audio disagree on the recap's tonal return.",
            ],
            metricKeys: [
                "audioSectionNarrativeConsistencyFit",
                "audioDevelopmentRouteConsistencyFit",
                "audioRecapTonalConsistencyFit",
            ],
        });
        appendDirective(directives, {
            kind: "increase_rhythm_variety",
            priority: consistency !== undefined && consistency < 0.4 ? 82 : 70,
            reason: "Make section-level density shifts more explicit so rendered and styled audio preserve the same long-form contour.",
            sourceIssue: consistencyIssue,
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const harmonicRouteIssue = issues.find((issue) => issue.startsWith("Rendered audio blurs the planned harmonic route"));
    if (harmonicRouteIssue || (harmonicRouteFit !== undefined && harmonicRouteFit < 0.56)) {
        const sectionIds = pickAudioSectionIdsByRoles(evaluation, request, ["theme_b", "development", "variation", "recap", "cadence", "outro"], 2, {
            issuePrefixes: [
                "Rendered development key drift does not settle into a clear modulation path.",
                "Rendered and styled audio disagree on the development's modulation profile.",
                "Rendered pitch-class return does not settle back into the planned recap tonality.",
                "Rendered and styled audio disagree on the recap's tonal return.",
            ],
            metricKeys: [
                "audioDevelopmentRouteConsistencyFit",
                "audioRecapTonalConsistencyFit",
                "audioSectionNarrativeConsistencyFit",
            ],
        });
        appendDirective(directives, {
            kind: "stabilize_harmony",
            priority: harmonicRouteFit !== undefined && harmonicRouteFit < 0.4 ? 90 : 78,
            reason: "Simplify and clarify the tonal route so modulation and return stay audible after rendering.",
            sourceIssue: harmonicRouteIssue,
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const harmonicRealizationIssue = issues.find((issue) => (
        issue.startsWith("Harmonic realization cues do not survive strongly enough")
        || issue.startsWith("Harmonic realization windows do not contain enough realized activity")
        || issue.startsWith("Tonicization windows do not create enough local departure")
        || issue.startsWith("Prolongation windows do not maintain enough sustain contrast")
    ));
    if (
        harmonicRealizationIssue
        || (harmonicRealizationFit !== undefined && harmonicRealizationFit < 0.62)
        || (harmonicRealizationCoverageFit !== undefined && harmonicRealizationCoverageFit < 0.6)
        || (harmonicRealizationDensityFit !== undefined && harmonicRealizationDensityFit < 0.58)
        || (tonicizationRealizationFit !== undefined && tonicizationRealizationFit < 0.58)
        || (prolongationRealizationFit !== undefined && prolongationRealizationFit < 0.58)
    ) {
        const sectionIds = pickAudioSectionIdsByRoles(
            evaluation,
            request,
            ["intro", "theme_a", "theme_b", "bridge", "development", "variation", "recap", "cadence", "outro"],
            2,
            {
                issuePrefixes: [
                    "Section harmonic realization does not survive humanized realization strongly enough.",
                    "Section harmonic realization coverage is too sparse across the targeted measures.",
                    "Section harmonic realization window lacks enough realized note activity to read clearly.",
                    "Section tonicization window does not create enough local departure and arrival contrast after humanization.",
                    "Section prolongation window does not maintain enough sustain contrast after humanization.",
                ],
                metricKeys: [
                    "audioHarmonicRealizationPlanFit",
                    "audioHarmonicRealizationCoverageFit",
                    "audioHarmonicRealizationDensityFit",
                    "audioTonicizationRealizationFit",
                    "audioProlongationRealizationFit",
                ],
            },
        );
        appendDirective(directives, {
            kind: "stabilize_harmony",
            priority: harmonicRealizationFit !== undefined && harmonicRealizationFit < 0.42 ? 90 : 82,
            reason: "Strengthen local sustain and arrival shaping so prolongation and tonicization remain audible after humanization.",
            sourceIssue: harmonicRealizationIssue,
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const harmonicColorIssue = issues.find((issue) => issue.startsWith("Harmonic-color windows do not create enough local color contrast"));
    if (harmonicColorIssue || (harmonicColorRealizationFit !== undefined && harmonicColorRealizationFit < 0.58)) {
        const sectionIds = pickAudioSectionIdsByRoles(
            evaluation,
            request,
            ["intro", "theme_a", "theme_b", "bridge", "development", "variation", "recap", "cadence", "outro"],
            2,
            {
                issuePrefixes: [
                    "Section harmonic-color window does not create enough local color contrast after humanization.",
                    "Section harmonic realization does not survive humanized realization strongly enough.",
                    "Section harmonic realization coverage is too sparse across the targeted measures.",
                ],
                metricKeys: [
                    "audioHarmonicColorRealizationFit",
                    "audioHarmonicRealizationPlanFit",
                    "audioHarmonicRealizationCoverageFit",
                ],
            },
        );
        appendDirective(directives, {
            kind: "clarify_harmonic_color",
            priority: harmonicColorRealizationFit !== undefined && harmonicColorRealizationFit < 0.42 ? 92 : 84,
            reason: "Move local color onto note-bearing measures and strengthen sustain or arrival shaping so mixture, suspension, or applied-dominant cues remain audible after humanization.",
            sourceIssue: harmonicColorIssue,
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const phraseBreathIssue = issues.find((issue) => issue.startsWith("Phrase-breath cues do not survive strongly enough"));
    if (phraseBreathIssue || (phraseBreathFit !== undefined && phraseBreathFit < 0.62)) {
        const sectionIds = pickAudioSectionIdsByRoles(
            evaluation,
            request,
            ["intro", "theme_a", "theme_b", "bridge", "development", "variation", "recap", "cadence", "outro"],
            2,
            {
                issuePrefixes: [
                    "Section phrase-breath cues do not survive humanized realization strongly enough.",
                    "Phrase-breath coverage is too sparse across the targeted measures.",
                    "Section phrase-breath pickup does not create enough anticipatory lift before the arrival.",
                    "Section phrase-breath arrival does not broaden clearly enough after humanization.",
                    "Section phrase-breath release does not ease clearly enough after humanization.",
                    "Section phrase-breath cadence recovery does not reset cleanly after the release.",
                    "Section phrase-breath rubato anchors do not create enough local timing contrast.",
                ],
                metricKeys: [
                    "audioPhraseBreathPlanFit",
                    "audioPhraseBreathCoverageFit",
                    "audioPhraseBreathPickupFit",
                    "audioPhraseBreathArrivalFit",
                    "audioPhraseBreathReleaseFit",
                ],
            },
        );
        appendDirective(directives, {
            kind: "clarify_phrase_rhetoric",
            priority: phraseBreathFit !== undefined && phraseBreathFit < 0.42 ? 88 : 80,
            reason: "Make pickup, arrival, release, and local recovery timing more explicit so the planned phrase-breath arc survives humanization.",
            sourceIssue: phraseBreathIssue,
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const tempoMotionIssue = issues.find((issue) => issue.startsWith("Tempo-motion cues do not survive strongly enough"));
    if (tempoMotionIssue || (tempoMotionFit !== undefined && tempoMotionFit < 0.62)) {
        const sectionIds = pickAudioSectionIdsByRoles(
            evaluation,
            request,
            ["intro", "theme_a", "theme_b", "bridge", "development", "variation", "recap", "cadence", "outro"],
            2,
            {
                issuePrefixes: [
                    "Section tempo motion does not survive humanized realization strongly enough.",
                    "Tempo-motion coverage is too sparse across the targeted measures.",
                    "Tempo-motion window lacks enough realized note activity to read clearly.",
                    "Section tempo motion does not accumulate enough local timing contrast.",
                ],
                metricKeys: [
                    "audioTempoMotionPlanFit",
                    "audioTempoMotionCoverageFit",
                    "audioTempoMotionDensityFit",
                    "audioTempoMotionMagnitudeFit",
                ],
            },
        );
        appendDirective(directives, {
            kind: "shape_tempo_motion",
            priority: tempoMotionFit !== undefined && tempoMotionFit < 0.42 ? 90 : 82,
            reason: "Move the local tempo motion onto note-bearing measures and strengthen the timing arc so ritardando, accelerando, or release resets remain audible after humanization.",
            sourceIssue: tempoMotionIssue,
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    const ornamentIssue = issues.find((issue) => issue.startsWith("Ornament hold cues do not survive strongly enough"));
    if (ornamentIssue || (ornamentFit !== undefined && ornamentFit < 0.64)) {
        const sectionIds = pickAudioSectionIdsByRoles(
            evaluation,
            request,
            ["intro", "theme_a", "theme_b", "bridge", "development", "variation", "recap", "cadence", "outro"],
            2,
            {
                issuePrefixes: [
                    "Section ornament hold does not survive humanized realization strongly enough.",
                    "Section ornament hold misses the targeted cadence event too often.",
                    "Section ornament hold does not create enough local sustain contrast.",
                ],
                metricKeys: [
                    "audioOrnamentPlanFit",
                    "audioOrnamentCoverageFit",
                    "audioOrnamentHoldFit",
                ],
            },
        );
        appendDirective(directives, {
            kind: "shape_ornament_hold",
            priority: ornamentFit !== undefined && ornamentFit < 0.42 ? 88 : 80,
            reason: "Move the fermata onto a note-bearing arrival and strengthen the local sustain so the hold remains audible after humanization.",
            sourceIssue: ornamentIssue,
            ...(sectionIds.length > 0 ? { sectionIds } : {}),
        });
    }

    if (targetMiss && directives.size === 0) {
        if ((developmentFit ?? 1) <= (recapFit ?? 1)) {
            const sectionIds = pickAudioSectionIdsByRoles(evaluation, request, ["development", "variation", "bridge"]);
            appendDirective(directives, {
                kind: "clarify_narrative_arc",
                priority: 76,
                reason: "The audio score missed its target; strengthening the development contour is the most direct structural lever.",
                ...(sectionIds.length > 0 ? { sectionIds } : {}),
            });
        } else {
            const sectionIds = pickAudioSectionIdsByRoles(evaluation, request, ["recap", "cadence", "outro"], 1);
            appendDirective(directives, {
                kind: "rebalance_recap_release",
                priority: 76,
                reason: "The audio score missed its target; making the return and release clearer should improve long-form readability.",
                ...(sectionIds.length > 0 ? { sectionIds } : {}),
            });
        }
    }

    return Array.from(directives.values())
        .map((directive) => tuneDirectivePriority(directive, riskProfile, structureVisibility))
        .sort((left, right) => right.priority - left.priority);
}

export function applyRevisionDirectives(
    request: ComposeRequest,
    directives: RevisionDirective[],
    nextAttemptIndex: number,
): ComposeRequest {
    const globalKinds = new Set(
        directives
            .filter((directive) => !directive.sectionIds || directive.sectionIds.length === 0)
            .map((directive) => directive.kind),
    );
    const { riskProfile, structureVisibility } = getPlanIntent(request);
    const nextProfile: NonNullable<ComposeRequest["compositionProfile"]> = {
        ...(request.compositionProfile ?? {}),
    };

    if (globalKinds.has("increase_rhythm_variety") || globalKinds.has("extend_length")) {
        nextProfile.density = Number(clamp((nextProfile.density ?? 0.46) + 0.08, 0.24, 0.9).toFixed(3));
    }

    if (globalKinds.has("expand_register")) {
        nextProfile.pitchContour = stretchCurve(ensureProfileContour(nextProfile));
    }

    if (globalKinds.has("clarify_narrative_arc")) {
        nextProfile.pitchContour = stretchCurve(emphasizeNarrativePeak(ensureProfileContour(nextProfile)));
        nextProfile.tension = emphasizeNarrativePeak(ensureProfileTension(nextProfile));
        nextProfile.density = Number(clamp((nextProfile.density ?? 0.46) + 0.06, 0.24, 0.92).toFixed(3));
        if (request.tempo !== undefined) {
            request = {
                ...request,
                tempo: Math.min(160, request.tempo + 4),
            };
        }
    }

    if (globalKinds.has("rebalance_recap_release")) {
        nextProfile.pitchContour = rebalanceClosingContour(ensureProfileContour(nextProfile));
        nextProfile.tension = softenClosingRelease(ensureProfileTension(nextProfile));
        nextProfile.density = Number(clamp((nextProfile.density ?? 0.46) - 0.04, 0.22, 0.9).toFixed(3));
        if (request.tempo !== undefined) {
            request = {
                ...request,
                tempo: Math.max(52, request.tempo - 2),
            };
        }
    }

    if (globalKinds.has("reduce_large_leaps")) {
        nextProfile.pitchContour = smoothCurve(ensureProfileContour(nextProfile));
        nextProfile.tension = smoothCurve(ensureProfileTension(nextProfile));
        if (request.tempo !== undefined) {
            request = {
                ...request,
                tempo: Math.max(52, request.tempo - (riskProfile === "experimental" ? 1 : 4)),
            };
        }
    }

    if (globalKinds.has("stabilize_harmony")) {
        nextProfile.pitchContour = smoothCurve(ensureProfileContour(nextProfile));
        nextProfile.tension = smoothCurve(ensureProfileTension(nextProfile));
        nextProfile.density = Number(clamp((nextProfile.density ?? 0.46) - 0.02, 0.22, 0.88).toFixed(3));
        if (request.tempo !== undefined) {
            request = {
                ...request,
                tempo: Math.max(52, request.tempo - (riskProfile === "experimental" ? 0 : 2)),
            };
        }
    }

    const revisedPlan = request.compositionPlan
        ? {
            ...request.compositionPlan,
            targetDurationSec: request.compositionPlan.targetDurationSec,
            targetMeasures: request.compositionPlan.targetMeasures,
            motifPolicy: {
                ...request.compositionPlan.motifPolicy,
                ...(globalKinds.has("clarify_narrative_arc") ? {
                    reuseRequired: true,
                    inversionAllowed: true,
                    sequenceAllowed: true,
                    diminutionAllowed: true,
                } : {}),
                ...(globalKinds.has("rebalance_recap_release") ? {
                    reuseRequired: true,
                    augmentationAllowed: true,
                } : {}),
            },
            sections: reviseSections(
                request.compositionPlan.sections.map((section) => ({ ...section })),
                directives,
                request.sectionArtifacts,
                request.compositionPlan.textureDefaults,
                request.compositionPlan.expressionDefaults,
                request.compositionPlan.form ?? request.form,
                request.key ?? request.compositionPlan.key,
            ),
        }
        : undefined;

    if (revisedPlan && directives.some((directive) => directive.kind === "extend_length")) {
        const totalMeasures = revisedPlan.sections.reduce((sum, section) => sum + section.measures, 0);
        revisedPlan.targetMeasures = totalMeasures;
        revisedPlan.targetDurationSec = (revisedPlan.targetDurationSec ?? request.durationSec ?? 45) + 12;
    }

    if (
        revisedPlan
        && (hasGlobalDirective(directives, "strengthen_cadence")
            || hasTargetedDirective(directives, "strengthen_cadence", revisedPlan.sections[revisedPlan.sections.length - 1]?.id ?? ""))
        && riskProfile === "experimental"
        && structureVisibility !== "transparent"
    ) {
        const lastSection = revisedPlan.sections[revisedPlan.sections.length - 1];
        if (lastSection) {
            const revisedCadence = structureVisibility === "hidden" ? "deceptive" : "plagal";
            lastSection.cadence = revisedCadence;
            lastSection.harmonicPlan = {
                ...(lastSection.harmonicPlan ?? {}),
                cadence: revisedCadence,
            };
            lastSection.notes = uniqueNotes(lastSection.notes, ["Keep the close suggestive instead of squaring it off too early."]);
        }
    }

    const revisedDuration = directives.some((directive) => directive.kind === "extend_length")
        ? (revisedPlan?.targetDurationSec ?? request.durationSec ?? 45) + (revisedPlan ? 0 : 12)
        : request.durationSec;

    return {
        ...request,
        durationSec: revisedDuration,
        compositionProfile: Object.keys(nextProfile).length > 0 ? nextProfile : undefined,
        compositionPlan: revisedPlan,
        revisionDirectives: directives,
        attemptIndex: nextAttemptIndex,
        promptHash: undefined,
    };
}
