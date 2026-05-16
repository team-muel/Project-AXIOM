import type {
    ArticulationTag,
    CharacterTag,
    ClassicalCadencePolicy,
    ClassicalCounterpointKnowledge,
    ClassicalDevelopmentPriority,
    ClassicalDissonanceTreatment,
    ClassicalFormKnowledge,
    ClassicalHarmonyKnowledge,
    ClassicalHarmonyLanguage,
    ClassicalImitationPriority,
    ClassicalKnowledgeDomain,
    ClassicalKnowledgePlan,
    ClassicalKnowledgeSummary,
    ClassicalModulationStrategy,
    ClassicalNotationKnowledge,
    ClassicalNotationMark,
    ClassicalNotationMarkCategory,
    ClassicalOrchestrationKnowledge,
    ClassicalPerformanceKnowledge,
    ClassicalPhraseMarkingDensity,
    ClassicalReturnStrategy,
    ClassicalRubatoProfile,
    ClassicalVoiceLeadingStrictness,
    CompositionPlan,
    DynamicLevel,
    HarmonicColorTag,
    HumanizationStyle,
    OrnamentPlan,
    PhraseSpanShape,
    TempoMotionPlan,
    TextureGuidance,
} from "../pipeline/types.js";

export const CLASSICAL_KNOWLEDGE_VERSION = "classical-knowledge-v1";

const DOMAINS = new Set<ClassicalKnowledgeDomain>([
    "harmony",
    "counterpoint",
    "form",
    "orchestration",
    "notation",
    "performance",
]);
const HARMONY_LANGUAGES = new Set<ClassicalHarmonyLanguage>(["common_practice", "modal", "chromatic", "extended_tonal"]);
const CADENCE_POLICIES = new Set<ClassicalCadencePolicy>(["light", "structural", "architectural"]);
const MODULATION_STRATEGIES = new Set<ClassicalModulationStrategy>(["none", "local_tonicization", "sectional", "long_range"]);
const VOICE_LEADING_LEVELS = new Set<ClassicalVoiceLeadingStrictness>(["free", "guided", "strict"]);
const IMITATION_PRIORITIES = new Set<ClassicalImitationPriority>(["none", "occasional", "active"]);
const DISSONANCE_TREATMENTS = new Set<ClassicalDissonanceTreatment>(["uncontrolled", "prepared", "suspension_aware"]);
const DEVELOPMENT_PRIORITIES = new Set<ClassicalDevelopmentPriority>(["low", "medium", "high"]);
const RETURN_STRATEGIES = new Set<ClassicalReturnStrategy>(["none", "recognizable", "transformed", "inevitable"]);
const PHRASE_MARKING_DENSITIES = new Set<ClassicalPhraseMarkingDensity>(["sparse", "balanced", "detailed"]);
const RUBATO_PROFILES = new Set<ClassicalRubatoProfile>(["none", "restrained", "expressive"]);
const HUMANIZATION_STYLES = new Set<HumanizationStyle>(["mechanical", "restrained", "expressive"]);
const PHRASE_SPAN_SHAPES = new Set<PhraseSpanShape>(["period", "sentence", "hybrid", "continuation_chain", "cadential_unit"]);
const HARMONIC_COLOR_TAGS = new Set<HarmonicColorTag>(["mixture", "applied_dominant", "predominant_color", "suspension"]);
const DYNAMIC_LEVELS = new Set<DynamicLevel>(["pp", "p", "mp", "mf", "f", "ff"]);
const ARTICULATION_TAGS = new Set<ArticulationTag>(["legato", "staccato", "staccatissimo", "tenuto", "sostenuto", "accent", "marcato"]);
const CHARACTER_TAGS = new Set<CharacterTag>([
    "dolce",
    "dolcissimo",
    "espressivo",
    "cantabile",
    "agitato",
    "tranquillo",
    "energico",
    "grazioso",
    "brillante",
    "giocoso",
    "leggiero",
    "maestoso",
    "scherzando",
    "pastorale",
    "tempestoso",
    "appassionato",
    "delicato",
]);
const NOTATION_CATEGORIES = new Set<ClassicalNotationMarkCategory>([
    "dynamic",
    "articulation",
    "tempo",
    "character",
    "ornament",
    "pedal",
    "technique",
    "text",
]);

function compact(value: unknown): string {
    return String(value ?? "").trim().replace(/\s+/g, " ");
}

function token(value: unknown): string {
    return compact(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function positiveMeasure(value: unknown): number | undefined {
    const parsed = finiteNumber(value);
    return parsed !== undefined && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function stringList(value: unknown, limit = 12): string[] {
    const raw = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(/[;,\n]/)
            : [];
    return raw.map((entry) => compact(entry)).filter(Boolean).slice(0, limit);
}

function dedupe<T>(values: T[]): T[] {
    return Array.from(new Set(values));
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeEnum<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
    const normalized = token(value);
    return allowed.has(normalized as T) ? normalized as T : undefined;
}

function normalizeDomainList(value: unknown): ClassicalKnowledgeDomain[] {
    return dedupe(stringList(value, 12)
        .map((entry) => normalizeEnum(entry, DOMAINS))
        .filter((entry): entry is ClassicalKnowledgeDomain => Boolean(entry)));
}

function notationMarkKey(mark: ClassicalNotationMark): string {
    return [
        mark.category,
        token(mark.mark),
        mark.scope ?? "",
        mark.sectionId ?? "",
        mark.startMeasure ?? "",
        mark.endMeasure ?? "",
    ].join(":");
}

function mergeNotationMarks(left: ClassicalNotationMark[], right: ClassicalNotationMark[]): ClassicalNotationMark[] {
    const byKey = new Map<string, ClassicalNotationMark>();
    for (const mark of [...left, ...right]) {
        byKey.set(notationMarkKey(mark), mark);
    }
    return Array.from(byKey.values()).slice(0, 128);
}

function normalizeNotationMark(value: unknown): ClassicalNotationMark | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const category = normalizeEnum(value.category, NOTATION_CATEGORIES);
    const mark = compact(value.mark ?? value.name ?? value.text);
    if (!category || !mark) {
        return undefined;
    }

    const scopeToken = token(value.scope);
    const scope = scopeToken === "global" || scopeToken === "section" || scopeToken === "measure"
        ? scopeToken
        : undefined;
    const intensity = finiteNumber(value.intensity);
    const notes = stringList(value.notes, 8);

    return {
        category,
        mark,
        ...(scope ? { scope } : {}),
        ...(compact(value.sectionId) ? { sectionId: compact(value.sectionId) } : {}),
        ...(positiveMeasure(value.startMeasure) !== undefined ? { startMeasure: positiveMeasure(value.startMeasure) } : {}),
        ...(positiveMeasure(value.endMeasure) !== undefined ? { endMeasure: positiveMeasure(value.endMeasure) } : {}),
        ...(intensity !== undefined ? { intensity } : {}),
        ...(notes.length ? { notes } : {}),
    };
}

function notationMark(category: ClassicalNotationMarkCategory, mark: string, extra: Partial<ClassicalNotationMark> = {}): ClassicalNotationMark {
    return {
        category,
        mark,
        ...extra,
    };
}

function collectExpressionMarks(
    expression: CompositionPlan["expressionDefaults"] | CompositionPlan["sections"][number]["expression"],
    scope: Partial<ClassicalNotationMark> = {},
): ClassicalNotationMark[] {
    if (!expression) {
        return [];
    }

    const marks: ClassicalNotationMark[] = [];
    const dynamics = expression.dynamics;
    if (dynamics) {
        for (const field of ["start", "peak", "end"] as const) {
            const level = dynamics[field];
            if (level) {
                marks.push(notationMark("dynamic", level, scope));
            }
        }
        for (const hairpin of dynamics.hairpins ?? []) {
            marks.push(notationMark("dynamic", hairpin.shape, {
                ...scope,
                startMeasure: hairpin.startMeasure,
                endMeasure: hairpin.endMeasure,
                ...(hairpin.target ? { notes: [`target ${hairpin.target}`] } : {}),
            }));
        }
    }

    for (const mark of expression.articulation ?? []) {
        marks.push(notationMark("articulation", mark, scope));
    }
    for (const mark of expression.character ?? []) {
        marks.push(notationMark("character", mark, scope));
    }
    for (const peak of expression.phrasePeaks ?? []) {
        marks.push(notationMark("text", "phrase_peak", { ...scope, startMeasure: peak, endMeasure: peak }));
    }
    return marks;
}

function collectTempoMarks(plans: TempoMotionPlan[] | undefined, scope: Partial<ClassicalNotationMark> = {}): ClassicalNotationMark[] {
    return (plans ?? []).map((plan) => notationMark("tempo", plan.tag, {
        ...scope,
        startMeasure: plan.startMeasure,
        endMeasure: plan.endMeasure,
        intensity: plan.intensity,
        notes: plan.notes,
    }));
}

function collectOrnamentMarks(plans: OrnamentPlan[] | undefined, scope: Partial<ClassicalNotationMark> = {}): ClassicalNotationMark[] {
    return (plans ?? []).map((plan) => notationMark("ornament", plan.tag, {
        ...scope,
        sectionId: plan.sectionId ?? scope.sectionId,
        startMeasure: plan.startMeasure,
        endMeasure: plan.endMeasure,
        intensity: plan.intensity,
        notes: plan.notes,
    }));
}

function collectPlanNotationMarks(plan: CompositionPlan): ClassicalNotationMark[] {
    let marks: ClassicalNotationMark[] = [
        ...collectExpressionMarks(plan.expressionDefaults, { scope: "global" }),
        ...collectTempoMarks(plan.tempoMotionDefaults, { scope: "global" }),
        ...collectOrnamentMarks(plan.ornamentDefaults, { scope: "global" }),
    ];

    for (const section of plan.sections) {
        const scope = { scope: "section" as const, sectionId: section.id };
        marks = mergeNotationMarks(marks, [
            ...collectExpressionMarks(section.expression, scope),
            ...collectTempoMarks(section.tempoMotion, scope),
            ...collectOrnamentMarks(section.ornaments, scope),
        ]);
    }

    return marks;
}

function textureVoiceCount(texture: TextureGuidance | undefined): number | undefined {
    return texture?.voiceCount && Number.isFinite(texture.voiceCount) ? texture.voiceCount : undefined;
}

function deriveCounterpoint(plan: CompositionPlan): ClassicalCounterpointKnowledge {
    const textures = [plan.textureDefaults, ...plan.sections.map((section) => section.texture)];
    const hasStrictTexture = textures.some((texture) => texture?.counterpointMode && texture.counterpointMode !== "none");
    const hasInnerMotion = textures.some((texture) => (texture?.primaryRoles ?? []).some((role) => role === "counterline" || role === "inner_voice"));
    const maxVoiceCount = Math.max(0, ...textures.map((texture) => textureVoiceCount(texture) ?? 0));
    const voiceLeading: ClassicalVoiceLeadingStrictness = hasStrictTexture || maxVoiceCount >= 3
        ? "strict"
        : hasInnerMotion
            ? "guided"
            : "free";

    return {
        voiceLeading,
        imitation: plan.sections.some((section) => section.texture?.counterpointMode === "imitative") ? "active" : "occasional",
        dissonanceTreatment: voiceLeading === "strict" ? "suspension_aware" : "prepared",
        ...(maxVoiceCount > 0 ? { preferredVoiceCount: maxVoiceCount } : {}),
    };
}

function deriveHarmony(plan: CompositionPlan): ClassicalHarmonyKnowledge {
    const harmonicPlans = plan.sections.map((section) => section.harmonicPlan).filter(Boolean);
    const hasChromaticColor = harmonicPlans.some((entry) => entry?.colorCues?.some((cue) => cue.tag === "mixture" || cue.tag === "applied_dominant"));
    const hasTonicization = harmonicPlans.some((entry) => (entry?.tonicizationWindows?.length ?? 0) > 0);
    const hasSectionalModulation = new Set(harmonicPlans.map((entry) => compact(entry?.tonalCenter).toLowerCase()).filter(Boolean)).size > 1;
    const hasReturnCadence = plan.sections.some((section) => section.role === "recap" || section.role === "cadence" || section.cadence === "authentic");
    const colorPalette = dedupe(harmonicPlans.flatMap((entry) => entry?.colorCues?.map((cue) => cue.tag) ?? []));

    return {
        language: hasChromaticColor ? "chromatic" : "common_practice",
        cadencePolicy: hasReturnCadence || plan.longSpanForm ? "architectural" : "structural",
        modulationStrategy: plan.longSpanForm
            ? "long_range"
            : hasSectionalModulation
                ? "sectional"
                : hasTonicization
                    ? "local_tonicization"
                    : "none",
        harmonicRhythm: harmonicPlans.find((entry) => entry?.harmonicRhythm)?.harmonicRhythm,
        ...(colorPalette.length ? { colorPalette } : {}),
    };
}

function deriveForm(plan: CompositionPlan): ClassicalFormKnowledge {
    const hasDevelopment = plan.sections.some((section) => section.role === "development" || section.developmentType);
    const hasReturn = plan.sections.some((section) => section.role === "recap" || section.role === "outro" || section.role === "cadence");

    return {
        architecture: plan.form,
        phraseModel: plan.sections.find((section) => section.phraseSpanShape)?.phraseSpanShape,
        developmentPriority: plan.longSpanForm || hasDevelopment ? "high" : "medium",
        returnStrategy: plan.longSpanForm?.expectedReturnPayoff === "inevitable"
            ? "inevitable"
            : hasReturn
                ? "recognizable"
                : "none",
    };
}

function deriveOrchestration(plan: CompositionPlan): ClassicalOrchestrationKnowledge | undefined {
    if (plan.instrumentation.length === 0) {
        return undefined;
    }

    const families = dedupe(plan.instrumentation.map((entry) => entry.family));
    return {
        idiom: families.length === 1 ? `${families[0]} writing` : "mixed ensemble writing",
        registerStrategy: plan.orchestration?.sections.some((section) => section.registerLayout === "wide") ? "wide" : "layered",
        balancePriority: plan.orchestration?.sections.some((section) => section.conversationMode === "conversational")
            ? "conversational"
            : "lead_forward",
    };
}

function deriveNotation(plan: CompositionPlan): ClassicalNotationKnowledge {
    const marks = collectPlanNotationMarks(plan);
    const phraseMarkingDensity: ClassicalPhraseMarkingDensity = marks.length >= plan.sections.length * 3
        ? "detailed"
        : marks.length > 0
            ? "balanced"
            : "sparse";
    return {
        phraseMarkingDensity,
        marks,
    };
}

function derivePerformance(plan: CompositionPlan): ClassicalPerformanceKnowledge {
    return {
        humanizationStyle: plan.humanizationStyle,
        rubato: plan.humanizationStyle === "expressive" ? "expressive" : (plan.humanizationStyle === "mechanical" ? "none" : "restrained"),
        dynamicArc: plan.longSpanForm ? "long_range" : "phrased",
    };
}

function derivedDomains(plan: CompositionPlan): ClassicalKnowledgeDomain[] {
    const domains: ClassicalKnowledgeDomain[] = ["harmony", "counterpoint", "form", "notation", "performance"];
    if (plan.instrumentation.length > 1 || plan.orchestration) {
        domains.push("orchestration");
    }
    return domains;
}

export function deriveClassicalKnowledgePlan(plan: CompositionPlan): ClassicalKnowledgePlan {
    const orchestration = deriveOrchestration(plan);
    return {
        version: CLASSICAL_KNOWLEDGE_VERSION,
        domains: derivedDomains(plan),
        summary: "Classical composition knowledge contract derived from the composition plan.",
        harmony: deriveHarmony(plan),
        counterpoint: deriveCounterpoint(plan),
        form: deriveForm(plan),
        ...(orchestration ? { orchestration } : {}),
        notation: deriveNotation(plan),
        performance: derivePerformance(plan),
        constraints: [
            "Keep symbolic score intent separate from rendered performance realization.",
            "Treat notation marks as compositional intent even when the current worker can only realize a subset.",
        ],
    };
}

function normalizeHarmony(value: unknown): ClassicalHarmonyKnowledge | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const colorPalette = stringList(value.colorPalette, 12)
        .map((entry) => normalizeEnum(entry, HARMONIC_COLOR_TAGS))
        .filter((entry): entry is HarmonicColorTag => Boolean(entry));

    return {
        ...(normalizeEnum(value.language, HARMONY_LANGUAGES) ? { language: normalizeEnum(value.language, HARMONY_LANGUAGES) } : {}),
        ...(normalizeEnum(value.cadencePolicy, CADENCE_POLICIES) ? { cadencePolicy: normalizeEnum(value.cadencePolicy, CADENCE_POLICIES) } : {}),
        ...(normalizeEnum(value.modulationStrategy, MODULATION_STRATEGIES) ? { modulationStrategy: normalizeEnum(value.modulationStrategy, MODULATION_STRATEGIES) } : {}),
        ...(normalizeEnum(value.harmonicRhythm, new Set(["slow", "medium", "fast"] as const)) ? { harmonicRhythm: normalizeEnum(value.harmonicRhythm, new Set(["slow", "medium", "fast"] as const)) } : {}),
        ...(colorPalette.length ? { colorPalette: dedupe(colorPalette) } : {}),
        ...(stringList(value.notes, 8).length ? { notes: stringList(value.notes, 8) } : {}),
    };
}

function normalizeCounterpoint(value: unknown): ClassicalCounterpointKnowledge | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const preferredVoiceCount = finiteNumber(value.preferredVoiceCount);
    return {
        ...(normalizeEnum(value.voiceLeading, VOICE_LEADING_LEVELS) ? { voiceLeading: normalizeEnum(value.voiceLeading, VOICE_LEADING_LEVELS) } : {}),
        ...(normalizeEnum(value.imitation, IMITATION_PRIORITIES) ? { imitation: normalizeEnum(value.imitation, IMITATION_PRIORITIES) } : {}),
        ...(normalizeEnum(value.dissonanceTreatment, DISSONANCE_TREATMENTS) ? { dissonanceTreatment: normalizeEnum(value.dissonanceTreatment, DISSONANCE_TREATMENTS) } : {}),
        ...(preferredVoiceCount !== undefined && preferredVoiceCount > 0 ? { preferredVoiceCount: Math.trunc(preferredVoiceCount) } : {}),
        ...(stringList(value.notes, 8).length ? { notes: stringList(value.notes, 8) } : {}),
    };
}

function normalizeForm(value: unknown): ClassicalFormKnowledge | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    return {
        ...(compact(value.architecture) ? { architecture: compact(value.architecture) } : {}),
        ...(normalizeEnum(value.phraseModel, PHRASE_SPAN_SHAPES) ? { phraseModel: normalizeEnum(value.phraseModel, PHRASE_SPAN_SHAPES) } : {}),
        ...(normalizeEnum(value.developmentPriority, DEVELOPMENT_PRIORITIES) ? { developmentPriority: normalizeEnum(value.developmentPriority, DEVELOPMENT_PRIORITIES) } : {}),
        ...(normalizeEnum(value.returnStrategy, RETURN_STRATEGIES) ? { returnStrategy: normalizeEnum(value.returnStrategy, RETURN_STRATEGIES) } : {}),
        ...(stringList(value.notes, 8).length ? { notes: stringList(value.notes, 8) } : {}),
    };
}

function normalizeOrchestration(value: unknown): ClassicalOrchestrationKnowledge | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const registerStrategy = normalizeEnum(value.registerStrategy, new Set(["compact", "layered", "wide"] as const));
    const balancePriority = normalizeEnum(value.balancePriority, new Set(["lead_forward", "conversational", "ensemble"] as const));
    return {
        ...(compact(value.idiom) ? { idiom: compact(value.idiom) } : {}),
        ...(registerStrategy ? { registerStrategy } : {}),
        ...(balancePriority ? { balancePriority } : {}),
        ...(stringList(value.notes, 8).length ? { notes: stringList(value.notes, 8) } : {}),
    };
}

function normalizeNotation(value: unknown): ClassicalNotationKnowledge | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const marks = Array.isArray(value.marks)
        ? value.marks.map((entry) => normalizeNotationMark(entry)).filter((entry): entry is ClassicalNotationMark => Boolean(entry))
        : [];
    return {
        ...(normalizeEnum(value.phraseMarkingDensity, PHRASE_MARKING_DENSITIES) ? { phraseMarkingDensity: normalizeEnum(value.phraseMarkingDensity, PHRASE_MARKING_DENSITIES) } : {}),
        marks: mergeNotationMarks([], marks),
        ...(stringList(value.notes, 8).length ? { notes: stringList(value.notes, 8) } : {}),
    };
}

function normalizePerformance(value: unknown): ClassicalPerformanceKnowledge | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    return {
        ...(normalizeEnum(value.humanizationStyle, HUMANIZATION_STYLES) ? { humanizationStyle: normalizeEnum(value.humanizationStyle, HUMANIZATION_STYLES) } : {}),
        ...(normalizeEnum(value.rubato, RUBATO_PROFILES) ? { rubato: normalizeEnum(value.rubato, RUBATO_PROFILES) } : {}),
        ...(normalizeEnum(value.dynamicArc, new Set(["flat", "terraced", "phrased", "long_range"] as const)) ? { dynamicArc: normalizeEnum(value.dynamicArc, new Set(["flat", "terraced", "phrased", "long_range"] as const)) } : {}),
        ...(stringList(value.notes, 8).length ? { notes: stringList(value.notes, 8) } : {}),
    };
}

export function normalizeClassicalKnowledgePlan(value: unknown): ClassicalKnowledgePlan | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const domains = normalizeDomainList(value.domains);
    const harmony = normalizeHarmony(value.harmony);
    const counterpoint = normalizeCounterpoint(value.counterpoint);
    const form = normalizeForm(value.form);
    const orchestration = normalizeOrchestration(value.orchestration);
    const notation = normalizeNotation(value.notation);
    const performance = normalizePerformance(value.performance);
    const constraints = stringList(value.constraints, 16);
    const inferredDomains: ClassicalKnowledgeDomain[] = [
        ...(harmony ? ["harmony" as const] : []),
        ...(counterpoint ? ["counterpoint" as const] : []),
        ...(form ? ["form" as const] : []),
        ...(orchestration ? ["orchestration" as const] : []),
        ...(notation ? ["notation" as const] : []),
        ...(performance ? ["performance" as const] : []),
    ];
    const mergedDomains = dedupe([...domains, ...inferredDomains]);

    if (mergedDomains.length === 0 && !compact(value.summary) && constraints.length === 0) {
        return undefined;
    }

    return {
        version: compact(value.version) || CLASSICAL_KNOWLEDGE_VERSION,
        domains: mergedDomains.length ? mergedDomains : ["harmony", "form", "notation"],
        ...(compact(value.summary) ? { summary: compact(value.summary) } : {}),
        ...(harmony ? { harmony } : {}),
        ...(counterpoint ? { counterpoint } : {}),
        ...(form ? { form } : {}),
        ...(orchestration ? { orchestration } : {}),
        ...(notation ? { notation } : {}),
        ...(performance ? { performance } : {}),
        ...(constraints.length ? { constraints } : {}),
    };
}

function mergeClassicalKnowledgePlan(
    derived: ClassicalKnowledgePlan,
    explicit: ClassicalKnowledgePlan | undefined,
): ClassicalKnowledgePlan {
    if (!explicit) {
        return derived;
    }

    return {
        ...derived,
        ...explicit,
        version: explicit.version || derived.version,
        domains: dedupe([...derived.domains, ...explicit.domains]),
        harmony: { ...derived.harmony, ...explicit.harmony },
        counterpoint: { ...derived.counterpoint, ...explicit.counterpoint },
        form: { ...derived.form, ...explicit.form },
        orchestration: derived.orchestration || explicit.orchestration
            ? { ...(derived.orchestration ?? {}), ...(explicit.orchestration ?? {}) }
            : undefined,
        notation: {
            phraseMarkingDensity: explicit.notation?.phraseMarkingDensity ?? derived.notation?.phraseMarkingDensity,
            marks: mergeNotationMarks(derived.notation?.marks ?? [], explicit.notation?.marks ?? []),
            notes: dedupe([...(derived.notation?.notes ?? []), ...(explicit.notation?.notes ?? [])]),
        },
        performance: { ...derived.performance, ...explicit.performance },
        constraints: dedupe([...(derived.constraints ?? []), ...(explicit.constraints ?? [])]),
    };
}

export function ensureClassicalKnowledgePlan(plan: CompositionPlan): CompositionPlan {
    const explicit = normalizeClassicalKnowledgePlan(plan.classicalKnowledge);
    const derived = deriveClassicalKnowledgePlan(plan);
    const classicalKnowledge = mergeClassicalKnowledgePlan(derived, explicit);
    return {
        ...plan,
        classicalKnowledge,
    };
}

export function summarizeClassicalKnowledgePlan(plan: ClassicalKnowledgePlan | undefined): ClassicalKnowledgeSummary | undefined {
    if (!plan) {
        return undefined;
    }

    return {
        version: plan.version,
        domains: [...plan.domains],
        notationMarkCount: plan.notation?.marks.length ?? 0,
        ...(plan.counterpoint?.voiceLeading ? { voiceLeading: plan.counterpoint.voiceLeading } : {}),
        ...(plan.harmony?.cadencePolicy ? { cadencePolicy: plan.harmony.cadencePolicy } : {}),
        ...(plan.form?.developmentPriority ? { developmentPriority: plan.form.developmentPriority } : {}),
    };
}

export function cloneClassicalKnowledgePlan(plan: ClassicalKnowledgePlan | undefined): ClassicalKnowledgePlan | undefined {
    return plan ? clone(plan) : undefined;
}
