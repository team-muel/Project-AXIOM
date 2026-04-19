import type {
    ArticulationTag,
    CadentialBuildup,
    CadenceOption,
    CadenceStyle,
    CharacterTag,
    CompositionSketch,
    ComposeEvaluationPolicy,
    ComposeQualityPolicy,
    ComposeRequest,
    ComposeSource,
    ComposeWorkflow,
    CompositionPlan,
    ContinuationPressure,
    DevelopmentType,
    DynamicLevel,
    DynamicsProfile,
    ExpressionGuidance,
    ExpositionPhase,
    HarmonicColorCue,
    HarmonicColorTag,
    HarmonicPlan,
    HarmonicDensity,
    HairpinShape,
    HumanizationStyle,
    InstrumentAssignment,
    LongSpanFormPlan,
    LongSpanPressure,
    ModelBinding,
    MotifDraft,
    MotifTransformPolicy,
    OrnamentPlan,
    OrnamentTag,
    OrchestrationBalanceProfile,
    OrchestrationConversationMode,
    OrchestrationFamily,
    OrchestrationPlan,
    OrchestrationRegisterLayout,
    PlanRiskProfile,
    PhraseBreathPlan,
    PhraseFunction,
    PhraseSpanShape,
    ProlongationMode,
    RecapMode,
    ReturnPayoffStrength,
    SectionPlan,
    SectionRole,
    StructureVisibility,
    SymbolicCompositionProfile,
    TempoMotionPlan,
    TempoMotionTag,
    ThematicTransformKind,
    TonicizationEmphasis,
    TonicizationWindow,
    TextureGuidance,
    TextureRole,
    VoicingProfile,
} from "./types.js";
import { coerceComposeWorkflowForForm, validateFormSectionFit } from "./formTemplates.js";
import { defaultModelBindings } from "./modelBindings.js";
import { ensureCompositionPlanOrchestration } from "./orchestrationPlan.js";

interface ComposeRequestNormalizationResult {
    request?: ComposeRequest;
    errors: string[];
}

const WORKFLOWS = new Set<ComposeWorkflow>(["symbolic_only", "symbolic_plus_audio", "audio_only"]);
const MODEL_ROLES = new Set<ModelBinding["role"]>([
    "planner",
    "structure",
    "orchestrator",
    "audio_renderer",
    "structure_evaluator",
    "audio_evaluator",
    "summary_evaluator",
]);
const TEXTURE_ROLES = new Set<TextureRole>(["lead", "counterline", "inner_voice", "chordal_support", "pad", "pulse", "bass", "accent"]);
const SECTION_ROLES = new Set<SectionRole>([
    "intro",
    "theme_a",
    "theme_b",
    "bridge",
    "development",
    "variation",
    "recap",
    "cadence",
    "outro",
]);
const CADENCE_STYLES = new Set<CadenceStyle>(["open", "half", "authentic", "plagal", "deceptive"]);
const INSTRUMENT_FAMILIES = new Set<InstrumentAssignment["family"]>([
    "keyboard",
    "strings",
    "woodwinds",
    "brass",
    "percussion",
    "voice",
    "hybrid",
]);
const REGISTERS = new Set<NonNullable<InstrumentAssignment["register"]>>(["low", "mid", "high", "wide"]);
const PLAN_RISK_PROFILES = new Set<PlanRiskProfile>(["conservative", "exploratory", "experimental"]);
const STRUCTURE_VISIBILITIES = new Set<StructureVisibility>(["transparent", "hidden", "complex"]);
const HUMANIZATION_STYLES = new Set<HumanizationStyle>(["mechanical", "restrained", "expressive"]);
const DYNAMIC_LEVELS = new Set<DynamicLevel>(["pp", "p", "mp", "mf", "f", "ff"]);
const HAIRPIN_SHAPES = new Set<HairpinShape>(["crescendo", "diminuendo"]);
const ARTICULATION_TAGS = new Set<ArticulationTag>([
    "legato",
    "staccato",
    "staccatissimo",
    "tenuto",
    "sostenuto",
    "accent",
    "marcato",
]);
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
const TEMPO_MOTION_TAGS = new Set<TempoMotionTag>([
    "ritardando",
    "rallentando",
    "allargando",
    "accelerando",
    "stringendo",
    "a_tempo",
    "ritenuto",
    "tempo_l_istesso",
]);
const ORNAMENT_TAGS = new Set<OrnamentTag>(["grace_note", "trill", "mordent", "turn", "arpeggio", "fermata"]);
const HARMONY_DENSITIES = new Set<HarmonicDensity>(["sparse", "medium", "rich"]);
const VOICING_PROFILES = new Set<VoicingProfile>(["block", "broken", "arpeggiated"]);
const HARMONIC_COLOR_TAGS = new Set<HarmonicColorTag>(["mixture", "applied_dominant", "predominant_color", "suspension"]);
const EXPOSITION_PHASES = new Set<ExpositionPhase>(["primary", "secondary"]);
const DEVELOPMENT_TYPES = new Set<DevelopmentType>(["motivic", "textural", "free"]);
const RECAP_MODES = new Set<RecapMode>(["full", "abbreviated", "varied"]);
const LONG_SPAN_PRESSURES = new Set<LongSpanPressure>(["low", "medium", "high"]);
const RETURN_PAYOFF_STRENGTHS = new Set<ReturnPayoffStrength>(["subtle", "clear", "inevitable"]);
const THEMATIC_TRANSFORM_KINDS = new Set<ThematicTransformKind>([
    "repeat",
    "sequence",
    "fragment",
    "revoice",
    "destabilize",
    "delay_return",
]);
const PHRASE_FUNCTIONS = new Set<PhraseFunction>(["presentation", "continuation", "cadential", "transition", "developmental"]);
const PHRASE_SPAN_SHAPES = new Set<PhraseSpanShape>(["period", "sentence", "hybrid", "continuation_chain", "cadential_unit"]);
const CONTINUATION_PRESSURES = new Set<ContinuationPressure>(["low", "medium", "high"]);
const CADENTIAL_BUILDUPS = new Set<CadentialBuildup>(["gentle", "prepared", "surging"]);
const COUNTERPOINT_MODES = new Set<NonNullable<TextureGuidance["counterpointMode"]>>(["none", "imitative", "contrary_motion", "free"]);
const PROLONGATION_MODES = new Set<ProlongationMode>(["tonic", "dominant", "sequential", "pedal"]);
const TONICIZATION_EMPHASES = new Set<TonicizationEmphasis>(["passing", "prepared", "arriving"]);
const ORCHESTRATION_FAMILIES = new Set<OrchestrationFamily>(["string_trio"]);
const ORCHESTRATION_CONVERSATION_MODES = new Set<OrchestrationConversationMode>(["support", "conversational"]);
const ORCHESTRATION_BALANCE_PROFILES = new Set<OrchestrationBalanceProfile>(["lead_forward", "balanced"]);
const ORCHESTRATION_REGISTER_LAYOUTS = new Set<OrchestrationRegisterLayout>(["layered", "wide"]);

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function parseCandidateCount(value: unknown): number | undefined {
    const parsed = toNumber(value);
    if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
        return undefined;
    }

    return parsed;
}

function parseLocalizedRewriteBranches(value: unknown): number | undefined {
    const parsed = toNumber(value);
    if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
        return undefined;
    }

    return parsed;
}

function toBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function parseWorkflow(value: unknown): ComposeWorkflow | undefined {
    const normalized = compact(value).toLowerCase();
    return WORKFLOWS.has(normalized as ComposeWorkflow) ? normalized as ComposeWorkflow : undefined;
}

function parseJsonArrayText(value: string): unknown[] | undefined {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function toArrayInput(value: unknown): unknown[] | undefined {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === "string") {
        return parseJsonArrayText(value);
    }

    return undefined;
}

function parseTextureRoles(value: unknown): TextureRole[] {
    const entries = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? (parseJsonArrayText(value) ?? value.split(/[;,\n]/))
            : [];

    return entries
        .map((entry) => compact(entry).toLowerCase())
        .filter((entry): entry is TextureRole => TEXTURE_ROLES.has(entry as TextureRole));
}

function parsePhraseFunction(value: unknown): PhraseFunction | undefined {
    const normalized = compact(value).toLowerCase();
    return PHRASE_FUNCTIONS.has(normalized as PhraseFunction) ? normalized as PhraseFunction : undefined;
}

function parsePhraseSpanShape(value: unknown): PhraseSpanShape | undefined {
    const normalized = compact(value).toLowerCase();
    return PHRASE_SPAN_SHAPES.has(normalized as PhraseSpanShape) ? normalized as PhraseSpanShape : undefined;
}

function parseContinuationPressure(value: unknown): ContinuationPressure | undefined {
    const normalized = compact(value).toLowerCase();
    return CONTINUATION_PRESSURES.has(normalized as ContinuationPressure)
        ? normalized as ContinuationPressure
        : undefined;
}

function parseCadentialBuildup(value: unknown): CadentialBuildup | undefined {
    const normalized = compact(value).toLowerCase();
    return CADENTIAL_BUILDUPS.has(normalized as CadentialBuildup)
        ? normalized as CadentialBuildup
        : undefined;
}

function positiveMeasureNumber(value: unknown): number | undefined {
    const parsed = toNumber(value);
    if (parsed === undefined || parsed <= 0) {
        return undefined;
    }

    return Math.trunc(parsed);
}

function parseHarmonicColorCues(value: unknown): HarmonicColorCue[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const cues = value
        .map((entry): HarmonicColorCue | undefined => {
            if (!isRecord(entry)) {
                return undefined;
            }

            const tag = compact(entry.tag).toLowerCase().replace(/[\s-]+/g, "_");
            if (!HARMONIC_COLOR_TAGS.has(tag as HarmonicColorTag)) {
                return undefined;
            }

            const startMeasure = positiveMeasureNumber(entry.startMeasure);
            const endMeasure = positiveMeasureNumber(entry.endMeasure);
            const resolutionMeasure = positiveMeasureNumber(entry.resolutionMeasure);
            const intensity = toNumber(entry.intensity);
            const keyTarget = compact(entry.keyTarget);
            const notes = Array.isArray(entry.notes)
                ? entry.notes.map((item) => compact(item)).filter(Boolean)
                : [];

            return {
                tag: tag as HarmonicColorTag,
                ...(startMeasure !== undefined ? { startMeasure } : {}),
                ...(endMeasure !== undefined ? { endMeasure } : {}),
                ...(keyTarget ? { keyTarget } : {}),
                ...(resolutionMeasure !== undefined ? { resolutionMeasure } : {}),
                ...(intensity !== undefined ? { intensity } : {}),
                ...(notes.length ? { notes } : {}),
            };
        })
        .filter((entry): entry is HarmonicColorCue => entry !== undefined);

    return cues.length ? cues : undefined;
}

function parsePhraseBreathPlan(value: unknown): PhraseBreathPlan | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const pickupStartMeasure = positiveMeasureNumber(value.pickupStartMeasure ?? value.preparationStartMeasure);
    const pickupEndMeasure = positiveMeasureNumber(value.pickupEndMeasure ?? value.preparationEndMeasure);
    const arrivalMeasure = positiveMeasureNumber(value.arrivalMeasure);
    const releaseStartMeasure = positiveMeasureNumber(value.releaseStartMeasure);
    const releaseEndMeasure = positiveMeasureNumber(value.releaseEndMeasure);
    const cadenceRecoveryStartMeasure = positiveMeasureNumber(value.cadenceRecoveryStartMeasure);
    const cadenceRecoveryEndMeasure = positiveMeasureNumber(value.cadenceRecoveryEndMeasure);
    const rubatoAnchors = Array.isArray(value.rubatoAnchors)
        ? Array.from(new Set(value.rubatoAnchors
            .map((entry) => positiveMeasureNumber(entry))
            .filter((entry): entry is number => entry !== undefined)))
            .sort((left, right) => left - right)
        : [];
    const notes = Array.isArray(value.notes)
        ? value.notes.map((entry) => compact(entry)).filter(Boolean)
        : [];

    if (!pickupStartMeasure
        && !pickupEndMeasure
        && !arrivalMeasure
        && !releaseStartMeasure
        && !releaseEndMeasure
        && !cadenceRecoveryStartMeasure
        && !cadenceRecoveryEndMeasure
        && rubatoAnchors.length === 0
        && notes.length === 0) {
        return undefined;
    }

    return {
        ...(pickupStartMeasure !== undefined ? { pickupStartMeasure } : {}),
        ...(pickupEndMeasure !== undefined ? { pickupEndMeasure } : {}),
        ...(arrivalMeasure !== undefined ? { arrivalMeasure } : {}),
        ...(releaseStartMeasure !== undefined ? { releaseStartMeasure } : {}),
        ...(releaseEndMeasure !== undefined ? { releaseEndMeasure } : {}),
        ...(cadenceRecoveryStartMeasure !== undefined ? { cadenceRecoveryStartMeasure } : {}),
        ...(cadenceRecoveryEndMeasure !== undefined ? { cadenceRecoveryEndMeasure } : {}),
        ...(rubatoAnchors.length > 0 ? { rubatoAnchors } : {}),
        ...(notes.length > 0 ? { notes } : {}),
    };
}

function parseTextureGuidance(value: unknown): TextureGuidance | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const texture: TextureGuidance = {};
    const voiceCount = toNumber(value.voiceCount);
    if (voiceCount !== undefined && voiceCount > 0) {
        texture.voiceCount = Math.trunc(voiceCount);
    }

    const primaryRoles = parseTextureRoles(value.primaryRoles ?? value.roles);
    if (primaryRoles.length > 0) {
        texture.primaryRoles = primaryRoles;
    }

    const counterpointMode = compact(value.counterpointMode).toLowerCase().replace(/\s+/g, "_");
    if (COUNTERPOINT_MODES.has(counterpointMode as NonNullable<TextureGuidance["counterpointMode"]>)) {
        texture.counterpointMode = counterpointMode as NonNullable<TextureGuidance["counterpointMode"]>;
    }

    if (Array.isArray(value.notes)) {
        const notes = value.notes.map((entry) => compact(entry)).filter(Boolean);
        if (notes.length > 0) {
            texture.notes = notes;
        }
    }

    return Object.keys(texture).length > 0 ? texture : undefined;
}

function parseInstrumentAssignments(value: unknown): InstrumentAssignment[] | undefined {
    const entries = toArrayInput(value);
    if (!entries) {
        return undefined;
    }

    const instruments: InstrumentAssignment[] = [];
    for (const entry of entries) {
        if (!isRecord(entry)) {
            continue;
        }

        const name = compact(entry.name);
        const family = compact(entry.family).toLowerCase();
        const roles = parseTextureRoles(entry.roles);
        if (!name || !INSTRUMENT_FAMILIES.has(family as InstrumentAssignment["family"]) || roles.length === 0) {
            continue;
        }

        const instrument: InstrumentAssignment = {
            name,
            family: family as InstrumentAssignment["family"],
            roles,
        };

        const register = compact(entry.register).toLowerCase();
        if (REGISTERS.has(register as NonNullable<InstrumentAssignment["register"]>)) {
            instrument.register = register as NonNullable<InstrumentAssignment["register"]>;
        }

        instruments.push(instrument);
    }

    return instruments;
}

function parseModelBindings(value: unknown): ModelBinding[] | undefined {
    const entries = toArrayInput(value);
    if (!entries) {
        return undefined;
    }

    const bindings: ModelBinding[] = [];
    for (const entry of entries) {
        if (!isRecord(entry)) {
            continue;
        }

        const role = compact(entry.role).toLowerCase();
        const provider = compact(entry.provider);
        const model = compact(entry.model);
        if (!MODEL_ROLES.has(role as ModelBinding["role"]) || !provider || !model) {
            continue;
        }

        bindings.push({
            role: role as ModelBinding["role"],
            provider,
            model,
            ...(compact(entry.version) ? { version: compact(entry.version) } : {}),
        });
    }

    return bindings;
}

function parseCadenceStyle(value: unknown): CadenceStyle | undefined {
    const normalized = compact(value).toLowerCase();
    return CADENCE_STYLES.has(normalized as CadenceStyle) ? normalized as CadenceStyle : undefined;
}

function parsePlanRiskProfile(value: unknown): PlanRiskProfile | undefined {
    const normalized = compact(value).toLowerCase();
    return PLAN_RISK_PROFILES.has(normalized as PlanRiskProfile) ? normalized as PlanRiskProfile : undefined;
}

function parseStructureVisibility(value: unknown): StructureVisibility | undefined {
    const normalized = compact(value).toLowerCase();
    return STRUCTURE_VISIBILITIES.has(normalized as StructureVisibility) ? normalized as StructureVisibility : undefined;
}

function parseHumanizationStyle(value: unknown): HumanizationStyle | undefined {
    const normalized = compact(value).toLowerCase();
    return HUMANIZATION_STYLES.has(normalized as HumanizationStyle) ? normalized as HumanizationStyle : undefined;
}

function parseDynamicLevel(value: unknown): DynamicLevel | undefined {
    const normalized = compact(value).toLowerCase();
    return DYNAMIC_LEVELS.has(normalized as DynamicLevel) ? normalized as DynamicLevel : undefined;
}

function parseHairpinShape(value: unknown): HairpinShape | undefined {
    const normalized = compact(value).toLowerCase();
    return HAIRPIN_SHAPES.has(normalized as HairpinShape) ? normalized as HairpinShape : undefined;
}

function parseArticulationTags(value: unknown): ArticulationTag[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => compact(entry).toLowerCase())
        .filter((entry): entry is ArticulationTag => ARTICULATION_TAGS.has(entry as ArticulationTag));
}

function parseCharacterTags(value: unknown): CharacterTag[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => compact(entry).toLowerCase())
        .filter((entry): entry is CharacterTag => CHARACTER_TAGS.has(entry as CharacterTag));
}

function normalizeTempoMotionToken(value: unknown): string {
    return compact(value)
        .toLowerCase()
        .replace(/[\u2019']/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_");
}

function parseTempoMotionTag(value: unknown): TempoMotionTag | undefined {
    const normalized = normalizeTempoMotionToken(value);
    return TEMPO_MOTION_TAGS.has(normalized as TempoMotionTag) ? normalized as TempoMotionTag : undefined;
}

function parseTempoMotionPlans(value: unknown): TempoMotionPlan[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const tempoMotion: TempoMotionPlan[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }

        const tag = parseTempoMotionTag(entry.tag ?? entry.motion ?? entry.name);
        if (!tag) {
            continue;
        }

        const motion: TempoMotionPlan = { tag };
        const startMeasure = toNumber(entry.startMeasure);
        if (startMeasure !== undefined && startMeasure > 0) {
            motion.startMeasure = Math.trunc(startMeasure);
        }

        const endMeasure = toNumber(entry.endMeasure);
        if (endMeasure !== undefined && endMeasure > 0) {
            motion.endMeasure = Math.trunc(endMeasure);
        }

        const intensity = toNumber(entry.intensity);
        if (intensity !== undefined) {
            motion.intensity = intensity;
        }

        if (Array.isArray(entry.notes)) {
            const notes = entry.notes.map((item) => compact(item)).filter(Boolean);
            if (notes.length > 0) {
                motion.notes = notes;
            }
        }

        tempoMotion.push(motion);
    }

    return tempoMotion.length > 0 ? tempoMotion : undefined;
}

function normalizeOrnamentToken(value: unknown): string {
    return compact(value)
        .toLowerCase()
        .replace(/[\u2019']/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_");
}

function parseOrnamentTag(value: unknown): OrnamentTag | undefined {
    const normalized = normalizeOrnamentToken(value);
    return ORNAMENT_TAGS.has(normalized as OrnamentTag) ? normalized as OrnamentTag : undefined;
}

function parseOrnamentPlans(value: unknown): OrnamentPlan[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const ornaments: OrnamentPlan[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }

        const tag = parseOrnamentTag(entry.tag ?? entry.ornament ?? entry.name);
        if (!tag) {
            continue;
        }

        const ornament: OrnamentPlan = { tag };
        const sectionId = compact(entry.sectionId);
        if (sectionId) {
            ornament.sectionId = sectionId;
        }

        const startMeasure = toNumber(entry.startMeasure);
        if (startMeasure !== undefined && startMeasure > 0) {
            ornament.startMeasure = Math.trunc(startMeasure);
        }

        const endMeasure = toNumber(entry.endMeasure);
        if (endMeasure !== undefined && endMeasure > 0) {
            ornament.endMeasure = Math.trunc(endMeasure);
        }

        const targetBeat = toNumber(entry.targetBeat);
        if (targetBeat !== undefined && targetBeat > 0) {
            ornament.targetBeat = targetBeat;
        }

        const intensity = toNumber(entry.intensity);
        if (intensity !== undefined) {
            ornament.intensity = intensity;
        }

        if (Array.isArray(entry.notes)) {
            const notes = entry.notes.map((item) => compact(item)).filter(Boolean);
            if (notes.length > 0) {
                ornament.notes = notes;
            }
        }

        ornaments.push(ornament);
    }

    return ornaments.length > 0 ? ornaments : undefined;
}

function parseDynamicsProfile(value: unknown): DynamicsProfile | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const dynamics: DynamicsProfile = {};
    const start = parseDynamicLevel(value.start);
    if (start) {
        dynamics.start = start;
    }

    const peak = parseDynamicLevel(value.peak);
    if (peak) {
        dynamics.peak = peak;
    }

    const end = parseDynamicLevel(value.end);
    if (end) {
        dynamics.end = end;
    }

    if (Array.isArray(value.hairpins)) {
        const hairpins: NonNullable<DynamicsProfile["hairpins"]> = [];
        for (const entry of value.hairpins) {
            if (!isRecord(entry)) {
                continue;
            }

            const shape = parseHairpinShape(entry.shape);
            if (!shape) {
                continue;
            }

            hairpins.push({
                shape,
                startMeasure: toNumber(entry.startMeasure),
                endMeasure: toNumber(entry.endMeasure),
                target: parseDynamicLevel(entry.target),
            });
        }

        if (hairpins.length > 0) {
            dynamics.hairpins = hairpins;
        }
    }

    return Object.keys(dynamics).length > 0 ? dynamics : undefined;
}

function parseExpressionGuidance(value: unknown): ExpressionGuidance | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const expression: ExpressionGuidance = {};
    const dynamics = parseDynamicsProfile(value.dynamics);
    if (dynamics) {
        expression.dynamics = dynamics;
    }

    const articulation = parseArticulationTags(value.articulation);
    if (articulation.length > 0) {
        expression.articulation = articulation;
    }

    const character = parseCharacterTags(value.character);
    if (character.length > 0) {
        expression.character = character;
    }

    if (Array.isArray(value.phrasePeaks)) {
        const phrasePeaks = value.phrasePeaks
            .map((entry) => toNumber(entry))
            .filter((entry): entry is number => entry !== undefined);
        if (phrasePeaks.length > 0) {
            expression.phrasePeaks = phrasePeaks;
        }
    }

    const sustainBias = toNumber(value.sustainBias);
    if (sustainBias !== undefined) {
        expression.sustainBias = sustainBias;
    }

    const accentBias = toNumber(value.accentBias);
    if (accentBias !== undefined) {
        expression.accentBias = accentBias;
    }

    if (Array.isArray(value.notes)) {
        const notes = value.notes.map((entry) => compact(entry)).filter(Boolean);
        if (notes.length > 0) {
            expression.notes = notes;
        }
    }

    return Object.keys(expression).length > 0 ? expression : undefined;
}

function parseHarmonicPlan(value: unknown): HarmonicPlan | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const harmonicRhythm = compact(value.harmonicRhythm).toLowerCase();
    const harmonyDensity = compact(value.harmonyDensity).toLowerCase();
    const voicingProfile = compact(value.voicingProfile).toLowerCase();
    const prolongationMode = compact(value.prolongationMode).toLowerCase();
    const modulationPath = Array.isArray(value.modulationPath)
        ? value.modulationPath.map((entry) => compact(entry)).filter(Boolean)
        : undefined;
    const colorCues = parseHarmonicColorCues(value.colorCues ?? value.harmonicColorCues);
    const tonicizationWindows = Array.isArray(value.tonicizationWindows)
        ? value.tonicizationWindows
            .map((entry): TonicizationWindow | undefined => {
                if (!isRecord(entry)) {
                    return undefined;
                }

                const keyTarget = compact(entry.keyTarget);
                if (!keyTarget) {
                    return undefined;
                }

                const emphasis = compact(entry.emphasis).toLowerCase();
                const startMeasure = toNumber(entry.startMeasure);
                const endMeasure = toNumber(entry.endMeasure);

                return {
                    keyTarget,
                    ...(startMeasure !== undefined && startMeasure > 0 ? { startMeasure: Math.trunc(startMeasure) } : {}),
                    ...(endMeasure !== undefined && endMeasure > 0 ? { endMeasure: Math.trunc(endMeasure) } : {}),
                    ...(TONICIZATION_EMPHASES.has(emphasis as TonicizationEmphasis)
                        ? { emphasis: emphasis as TonicizationEmphasis }
                        : {}),
                    ...(parseCadenceStyle(entry.cadence) ? { cadence: parseCadenceStyle(entry.cadence) } : {}),
                };
            })
            .filter((entry): entry is TonicizationWindow => entry !== undefined)
        : undefined;

    return {
        tonalCenter: compact(value.tonalCenter) || undefined,
        keyTarget: compact(value.keyTarget) || undefined,
        modulationPath: modulationPath?.length ? modulationPath : undefined,
        harmonicRhythm: harmonicRhythm === "slow" || harmonicRhythm === "medium" || harmonicRhythm === "fast"
            ? harmonicRhythm as HarmonicPlan["harmonicRhythm"]
            : undefined,
        harmonyDensity: HARMONY_DENSITIES.has(harmonyDensity as HarmonicDensity)
            ? harmonyDensity as HarmonicDensity
            : undefined,
        voicingProfile: VOICING_PROFILES.has(voicingProfile as VoicingProfile)
            ? voicingProfile as VoicingProfile
            : undefined,
        prolongationMode: PROLONGATION_MODES.has(prolongationMode as ProlongationMode)
            ? prolongationMode as ProlongationMode
            : undefined,
        tonicizationWindows: tonicizationWindows?.length ? tonicizationWindows : undefined,
        colorCues,
        tensionTarget: toNumber(value.tensionTarget),
        cadence: parseCadenceStyle(value.cadence),
        allowModulation: toBoolean(value.allowModulation),
    };
}

function parseMotifPolicy(value: unknown): MotifTransformPolicy | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const reuseRequired = toBoolean(value.reuseRequired);
    if (reuseRequired === undefined) {
        return undefined;
    }

    return {
        reuseRequired,
        inversionAllowed: toBoolean(value.inversionAllowed),
        augmentationAllowed: toBoolean(value.augmentationAllowed),
        diminutionAllowed: toBoolean(value.diminutionAllowed),
        sequenceAllowed: toBoolean(value.sequenceAllowed),
    };
}

function parseSectionPlans(value: unknown): SectionPlan[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const sections: SectionPlan[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }

        const role = compact(entry.role).toLowerCase();
        const measures = toNumber(entry.measures);
        const energy = toNumber(entry.energy);
        const density = toNumber(entry.density);
        if (!SECTION_ROLES.has(role as SectionRole) || !measures || energy === undefined || density === undefined) {
            continue;
        }

        const section: SectionPlan = {
            id: compact(entry.id) || `section-${sections.length + 1}`,
            role: role as SectionRole,
            label: compact(entry.label) || `Section ${sections.length + 1}`,
            measures,
            energy,
            density,
        };

        const phraseFunction = parsePhraseFunction(entry.phraseFunction);
        if (phraseFunction) {
            section.phraseFunction = phraseFunction;
        }

        const phraseBreath = parsePhraseBreathPlan(entry.phraseBreath ?? entry.phraseBreathPlan);
        if (phraseBreath) {
            section.phraseBreath = phraseBreath;
        }

        const phraseSpanShape = parsePhraseSpanShape(entry.phraseSpanShape);
        if (phraseSpanShape) {
            section.phraseSpanShape = phraseSpanShape;
        }

        const continuationPressure = parseContinuationPressure(entry.continuationPressure);
        if (continuationPressure) {
            section.continuationPressure = continuationPressure;
        }

        const cadentialBuildup = parseCadentialBuildup(entry.cadentialBuildup);
        if (cadentialBuildup) {
            section.cadentialBuildup = cadentialBuildup;
        }

        const expositionPhase = compact(entry.expositionPhase).toLowerCase();
        if (EXPOSITION_PHASES.has(expositionPhase as ExpositionPhase)) {
            section.expositionPhase = expositionPhase as ExpositionPhase;
        }

        const developmentType = compact(entry.developmentType).toLowerCase();
        if (DEVELOPMENT_TYPES.has(developmentType as DevelopmentType)) {
            section.developmentType = developmentType as DevelopmentType;
        }

        const recapMode = compact(entry.recapMode).toLowerCase();
        if (RECAP_MODES.has(recapMode as RecapMode)) {
            section.recapMode = recapMode as RecapMode;
        }

        const cadenceStrength = toNumber(entry.cadenceStrength);
        if (cadenceStrength !== undefined) {
            section.cadenceStrength = cadenceStrength;
        }

        const registerCenter = toNumber(entry.registerCenter);
        if (registerCenter !== undefined) {
            section.registerCenter = registerCenter;
        }

        const cadence = parseCadenceStyle(entry.cadence);
        if (cadence) {
            section.cadence = cadence;
        }

        const motifRef = compact(entry.motifRef);
        if (motifRef) {
            section.motifRef = motifRef;
        }

        const contrastFrom = compact(entry.contrastFrom);
        if (contrastFrom) {
            section.contrastFrom = contrastFrom;
        }

        const instrumentation = parseInstrumentAssignments(entry.instrumentation);
        if (instrumentation?.length) {
            section.instrumentation = instrumentation;
        }

        const harmonicPlan = parseHarmonicPlan(entry.harmonicPlan);
        if (harmonicPlan) {
            section.harmonicPlan = harmonicPlan;
        }

        const texture = parseTextureGuidance(entry.texture ?? entry.textureGuidance);
        if (texture) {
            section.texture = texture;
        }

        const expression = parseExpressionGuidance(entry.expression ?? entry.expressionGuidance);
        if (expression) {
            section.expression = expression;
        }

        const tempoMotion = parseTempoMotionPlans(entry.tempoMotion ?? entry.tempoMotionPlan ?? entry.tempoMotionPlans);
        if (tempoMotion?.length) {
            section.tempoMotion = tempoMotion;
        }

        const ornaments = parseOrnamentPlans(entry.ornaments ?? entry.ornament ?? entry.ornamentPlan ?? entry.ornamentPlans);
        if (ornaments?.length) {
            section.ornaments = ornaments;
        }

        if (Array.isArray(entry.notes)) {
            section.notes = entry.notes.map((note) => compact(note)).filter(Boolean);
        }

        sections.push(section);
    }

    return sections;
}

function parseMotifDrafts(value: unknown): MotifDraft[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const drafts: MotifDraft[] = [];
    for (const entry of value) {
        if (!isRecord(entry) || !Array.isArray(entry.intervals)) {
            continue;
        }

        const intervals = entry.intervals
            .map((item) => toNumber(item))
            .filter((item): item is number => item !== undefined)
            .map((item) => Math.trunc(item));
        if (intervals.length === 0) {
            continue;
        }

        drafts.push({
            id: compact(entry.id) || `motif-${drafts.length + 1}`,
            sectionId: compact(entry.sectionId) || undefined,
            source: compact(entry.source) === "planner" ? "planner" : (compact(entry.source) === "pipeline" ? "pipeline" : undefined),
            intervals,
            description: compact(entry.description) || undefined,
            preserveDuringRevision: toBoolean(entry.preserveDuringRevision),
        });
    }

    return drafts;
}

function parseCadenceOptions(value: unknown): CadenceOption[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const options: CadenceOption[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }

        const primary = parseCadenceStyle(entry.primary);
        if (!primary) {
            continue;
        }

        const alternatives = Array.isArray(entry.alternatives)
            ? entry.alternatives
                .map((item) => parseCadenceStyle(item))
                .filter((item): item is CadenceStyle => item !== undefined)
            : [];

        options.push({
            sectionId: compact(entry.sectionId) || `section-${options.length + 1}`,
            primary,
            alternatives,
            rationale: compact(entry.rationale) || undefined,
        });
    }

    return options;
}

function parseCompositionSketch(value: unknown): CompositionSketch | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const motifDrafts = parseMotifDrafts(value.motifDrafts) ?? [];
    const cadenceOptions = parseCadenceOptions(value.cadenceOptions) ?? [];
    if (motifDrafts.length === 0 && cadenceOptions.length === 0) {
        return undefined;
    }

    return {
        generatedBy: compact(value.generatedBy) === "planner" ? "planner" : "pipeline",
        note: compact(value.note) || undefined,
        motifDrafts,
        cadenceOptions,
    };
}

function parseThematicTransformationCheckpoints(value: unknown): NonNullable<LongSpanFormPlan["thematicCheckpoints"]> | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const checkpoints = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }

        const sourceSectionId = compact(entry.sourceSectionId || entry.source);
        const targetSectionId = compact(entry.targetSectionId || entry.target);
        const transform = compact(entry.transform).toLowerCase().replace(/\s+/g, "_");
        if (!sourceSectionId || !targetSectionId || !THEMATIC_TRANSFORM_KINDS.has(transform as ThematicTransformKind)) {
            continue;
        }

        const checkpoint = {
            ...(compact(entry.id) ? { id: compact(entry.id) } : {}),
            sourceSectionId,
            targetSectionId,
            transform: transform as ThematicTransformKind,
            ...(typeof entry.preserveIdentity === "boolean" ? { preserveIdentity: entry.preserveIdentity } : {}),
            ...(toNumber(entry.expectedProminence) !== undefined
                ? { expectedProminence: Math.max(0, Math.min(1, Number(entry.expectedProminence))) }
                : {}),
            ...(Array.isArray(entry.notes)
                ? {
                    notes: entry.notes.map((item) => compact(item)).filter(Boolean),
                }
                : {}),
        };

        checkpoints.push(checkpoint);
    }

    return checkpoints.length > 0 ? checkpoints : undefined;
}

function parseLongSpanFormPlan(value: unknown): LongSpanFormPlan | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const expectedDevelopmentPressure = compact(value.expectedDevelopmentPressure).toLowerCase();
    const expectedReturnPayoff = compact(value.expectedReturnPayoff).toLowerCase();
    const thematicCheckpoints = parseThematicTransformationCheckpoints(value.thematicCheckpoints ?? value.checkpoints);
    const notes = Array.isArray(value.notes)
        ? value.notes.map((entry) => compact(entry)).filter(Boolean)
        : [];

    const plan: LongSpanFormPlan = {
        ...(compact(value.expositionStartSectionId) ? { expositionStartSectionId: compact(value.expositionStartSectionId) } : {}),
        ...(compact(value.expositionEndSectionId) ? { expositionEndSectionId: compact(value.expositionEndSectionId) } : {}),
        ...(compact(value.developmentStartSectionId) ? { developmentStartSectionId: compact(value.developmentStartSectionId) } : {}),
        ...(compact(value.developmentEndSectionId) ? { developmentEndSectionId: compact(value.developmentEndSectionId) } : {}),
        ...(compact(value.retransitionSectionId) ? { retransitionSectionId: compact(value.retransitionSectionId) } : {}),
        ...(compact(value.recapStartSectionId) ? { recapStartSectionId: compact(value.recapStartSectionId) } : {}),
        ...(compact(value.returnSectionId) ? { returnSectionId: compact(value.returnSectionId) } : {}),
        ...(compact(value.delayedPayoffSectionId) ? { delayedPayoffSectionId: compact(value.delayedPayoffSectionId) } : {}),
        ...(LONG_SPAN_PRESSURES.has(expectedDevelopmentPressure as LongSpanPressure)
            ? { expectedDevelopmentPressure: expectedDevelopmentPressure as LongSpanPressure }
            : {}),
        ...(RETURN_PAYOFF_STRENGTHS.has(expectedReturnPayoff as ReturnPayoffStrength)
            ? { expectedReturnPayoff: expectedReturnPayoff as ReturnPayoffStrength }
            : {}),
        ...(thematicCheckpoints ? { thematicCheckpoints } : {}),
        ...(notes.length > 0 ? { notes } : {}),
    };

    return Object.keys(plan).length > 0 ? plan : undefined;
}

function parseOrchestrationPlan(value: unknown): OrchestrationPlan | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const family = compact(value.family).toLowerCase();
    const instrumentNames = Array.isArray(value.instrumentNames)
        ? value.instrumentNames.map((entry) => compact(entry)).filter(Boolean)
        : [];
    const sections = Array.isArray(value.sections)
        ? value.sections.flatMap((entry) => {
            if (!isRecord(entry)) {
                return [];
            }

            const sectionId = compact(entry.sectionId);
            const leadInstrument = compact(entry.leadInstrument);
            const secondaryInstrument = compact(entry.secondaryInstrument);
            const bassInstrument = compact(entry.bassInstrument);
            if (!sectionId || !leadInstrument || !secondaryInstrument || !bassInstrument) {
                return [];
            }

            const conversationMode = compact(entry.conversationMode).toLowerCase();
            const balanceProfile = compact(entry.balanceProfile).toLowerCase();
            const registerLayout = compact(entry.registerLayout).toLowerCase();
            const notes = Array.isArray(entry.notes)
                ? entry.notes.map((item) => compact(item)).filter(Boolean)
                : [];

            return [{
                sectionId,
                leadInstrument,
                secondaryInstrument,
                bassInstrument,
                ...(ORCHESTRATION_CONVERSATION_MODES.has(conversationMode as OrchestrationConversationMode)
                    ? { conversationMode: conversationMode as OrchestrationConversationMode }
                    : {}),
                ...(ORCHESTRATION_BALANCE_PROFILES.has(balanceProfile as OrchestrationBalanceProfile)
                    ? { balanceProfile: balanceProfile as OrchestrationBalanceProfile }
                    : {}),
                ...(ORCHESTRATION_REGISTER_LAYOUTS.has(registerLayout as OrchestrationRegisterLayout)
                    ? { registerLayout: registerLayout as OrchestrationRegisterLayout }
                    : {}),
                ...(notes.length > 0 ? { notes } : {}),
            }];
        })
        : [];
    const notes = Array.isArray(value.notes)
        ? value.notes.map((entry) => compact(entry)).filter(Boolean)
        : [];

    if (!ORCHESTRATION_FAMILIES.has(family as OrchestrationFamily) || instrumentNames.length < 3 || sections.length === 0) {
        return undefined;
    }

    return {
        family: family as OrchestrationFamily,
        instrumentNames,
        sections,
        ...(notes.length > 0 ? { notes } : {}),
    };
}

function parseCompositionPlan(value: unknown): CompositionPlan | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const version = compact(value.version);
    const brief = compact(value.brief);
    const form = compact(value.form);
    const workflow = parseWorkflow(value.workflow);
    const instrumentation = parseInstrumentAssignments(value.instrumentation);
    const motifPolicy = parseMotifPolicy(value.motifPolicy);
    const sections = parseSectionPlans(value.sections);
    const textureDefaults = parseTextureGuidance(value.textureDefaults ?? value.textureGuidance ?? value.texture);
    const expressionDefaults = parseExpressionGuidance(value.expressionDefaults ?? value.expressionGuidance ?? value.expression);
    const tempoMotionDefaults = parseTempoMotionPlans(value.tempoMotionDefaults ?? value.tempoMotion ?? value.tempoMotionPlan);
    const ornamentDefaults = parseOrnamentPlans(value.ornamentDefaults ?? value.ornaments ?? value.ornament ?? value.ornamentPlan);
    const longSpanForm = parseLongSpanFormPlan(value.longSpanForm ?? value.longRangeForm);
    const orchestration = parseOrchestrationPlan(value.orchestration);
    const rationale = compact(value.rationale);

    if (!version || !brief || !form || !workflow || !instrumentation?.length || !motifPolicy || !sections?.length || !rationale) {
        return undefined;
    }

    return ensureCompositionPlanOrchestration({
        version,
        titleHint: compact(value.titleHint) || undefined,
        brief,
        mood: Array.isArray(value.mood) ? value.mood.map((entry) => compact(entry)).filter(Boolean) : [],
        form,
        inspirationThread: compact(value.inspirationThread) || undefined,
        intentRationale: compact(value.intentRationale) || undefined,
        contrastTarget: compact(value.contrastTarget) || undefined,
        riskProfile: parsePlanRiskProfile(value.riskProfile),
        structureVisibility: parseStructureVisibility(value.structureVisibility),
        humanizationStyle: parseHumanizationStyle(value.humanizationStyle),
        targetDurationSec: toNumber(value.targetDurationSec),
        targetMeasures: toNumber(value.targetMeasures),
        meter: compact(value.meter) || undefined,
        key: compact(value.key) || undefined,
        tempo: toNumber(value.tempo),
        workflow,
        instrumentation,
        textureDefaults,
        expressionDefaults,
        tempoMotionDefaults,
        ornamentDefaults,
        motifPolicy,
        sketch: parseCompositionSketch(value.sketch),
        longSpanForm,
        ...(orchestration ? { orchestration } : {}),
        sections,
        rationale,
    });
}

function ensureBindingsForWorkflow(
    workflow: ComposeWorkflow,
    selectedModels: ModelBinding[] | undefined,
): ModelBinding[] | undefined {
    if (!selectedModels?.length) {
        return undefined;
    }

    const nextBindings = selectedModels.map((binding) => ({ ...binding }));
    const roles = new Set(nextBindings.map((binding) => binding.role));

    for (const binding of defaultModelBindings(workflow)) {
        if (!roles.has(binding.role)) {
            nextBindings.push({ ...binding });
            roles.add(binding.role);
        }
    }

    return nextBindings;
}

function validateSonataCompositionPlan(
    compositionPlan: CompositionPlan,
    homeKey: string | undefined,
): string[] {
    return validateFormSectionFit(compositionPlan.form, compositionPlan.sections, homeKey);
}

function coerceStructureFirstWorkflow(
    form: string | undefined,
    workflow: ComposeWorkflow | undefined,
    selectedModels: ModelBinding[] | undefined,
): ComposeWorkflow | undefined {
    return coerceComposeWorkflowForForm(form, workflow, selectedModels);
}

function parseEvaluationPolicy(value: unknown): ComposeEvaluationPolicy | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    return {
        requireStructurePass: toBoolean(value.requireStructurePass),
        requireAudioPass: toBoolean(value.requireAudioPass),
        summarizeWithLLM: toBoolean(value.summarizeWithLLM),
    };
}

function parseQualityPolicy(value: unknown): ComposeQualityPolicy | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const enableAutoRevision = toBoolean(value.enableAutoRevision);
    const maxStructureAttempts = toNumber(value.maxStructureAttempts);
    const targetStructureScore = toNumber(value.targetStructureScore);
    const targetAudioScore = toNumber(value.targetAudioScore);

    if (enableAutoRevision === undefined && maxStructureAttempts === undefined && targetStructureScore === undefined && targetAudioScore === undefined) {
        return undefined;
    }

    return {
        enableAutoRevision,
        ...(maxStructureAttempts !== undefined ? { maxStructureAttempts: Math.trunc(maxStructureAttempts) } : {}),
        ...(targetStructureScore !== undefined ? { targetStructureScore } : {}),
        ...(targetAudioScore !== undefined ? { targetAudioScore } : {}),
    };
}

function parseCompositionProfile(value: unknown): SymbolicCompositionProfile | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const profile: SymbolicCompositionProfile = {};
    if (Array.isArray(value.pitchContour)) {
        profile.pitchContour = value.pitchContour.map((entry) => toNumber(entry)).filter((entry): entry is number => entry !== undefined);
    }
    const density = toNumber(value.density);
    if (density !== undefined) {
        profile.density = density;
    }
    if (Array.isArray(value.tension)) {
        profile.tension = value.tension.map((entry) => toNumber(entry)).filter((entry): entry is number => entry !== undefined);
    }
    return Object.keys(profile).length > 0 ? profile : undefined;
}

export function normalizeComposeRequestInput(
    value: unknown,
    defaultSource: ComposeSource = "api",
): ComposeRequestNormalizationResult {
    if (!isRecord(value)) {
        return {
            errors: ["request body must be an object"],
        };
    }

    const errors: string[] = [];
    const prompt = compact(value.prompt);
    if (!prompt) {
        errors.push("prompt is required");
    }

    const tempo = toNumber(value.tempo);
    if (value.tempo !== undefined && tempo === undefined) {
        errors.push("tempo must be numeric");
    }

    const durationSec = toNumber(value.durationSec);
    if (value.durationSec !== undefined && (durationSec === undefined || durationSec <= 0)) {
        errors.push("durationSec must be a positive number");
    }

    const candidateCount = value.candidateCount !== undefined ? parseCandidateCount(value.candidateCount) : undefined;
    if (value.candidateCount !== undefined && candidateCount === undefined) {
        errors.push("candidateCount must be an integer between 1 and 8");
    }

    const localizedRewriteBranches = value.localizedRewriteBranches !== undefined
        ? parseLocalizedRewriteBranches(value.localizedRewriteBranches)
        : undefined;
    if (value.localizedRewriteBranches !== undefined && localizedRewriteBranches === undefined) {
        errors.push("localizedRewriteBranches must be an integer between 1 and 4");
    }

    const resolvedCandidateCount = candidateCount ?? (localizedRewriteBranches !== undefined ? 4 : undefined);
    if (localizedRewriteBranches !== undefined && (resolvedCandidateCount ?? 0) < 3) {
        errors.push("localizedRewriteBranches requires candidateCount of at least 3");
    }

    const workflow = value.workflow !== undefined ? parseWorkflow(value.workflow) : undefined;
    if (value.workflow !== undefined && !workflow) {
        errors.push("workflow must be symbolic_only, symbolic_plus_audio, or audio_only");
    }

    if (value.sonification !== undefined) {
        errors.push("sonification is no longer supported; provide compositionProfile pitchContour/density/tension hints instead");
    }

    const compositionProfile = value.compositionProfile !== undefined ? parseCompositionProfile(value.compositionProfile) : undefined;

    const selectedModels = value.selectedModels !== undefined ? parseModelBindings(value.selectedModels) : undefined;
    if (value.selectedModels !== undefined && !selectedModels?.length) {
        errors.push("selectedModels must contain valid role/provider/model entries");
    }

    const targetInstrumentation = value.targetInstrumentation !== undefined
        ? parseInstrumentAssignments(value.targetInstrumentation)
        : undefined;
    if (value.targetInstrumentation !== undefined && !targetInstrumentation?.length) {
        errors.push("targetInstrumentation must contain valid instrument entries");
    }

    const compositionPlan = value.compositionPlan !== undefined ? parseCompositionPlan(value.compositionPlan) : undefined;
    if (value.compositionPlan !== undefined && !compositionPlan) {
        errors.push("compositionPlan must include version, brief, form, workflow, instrumentation, motifPolicy, sections, and rationale");
    }

    const qualityPolicy = value.qualityPolicy !== undefined ? parseQualityPolicy(value.qualityPolicy) : undefined;
    if (value.qualityPolicy !== undefined && !qualityPolicy) {
        errors.push("qualityPolicy must contain enableAutoRevision, maxStructureAttempts, targetStructureScore, or targetAudioScore");
    }
    if (qualityPolicy?.maxStructureAttempts !== undefined && (qualityPolicy.maxStructureAttempts < 1 || qualityPolicy.maxStructureAttempts > 5)) {
        errors.push("qualityPolicy.maxStructureAttempts must be between 1 and 5");
    }
    if (qualityPolicy?.targetStructureScore !== undefined && (qualityPolicy.targetStructureScore < 0 || qualityPolicy.targetStructureScore > 100)) {
        errors.push("qualityPolicy.targetStructureScore must be between 0 and 100");
    }
    if (qualityPolicy?.targetAudioScore !== undefined && (qualityPolicy.targetAudioScore < 0 || qualityPolicy.targetAudioScore > 100)) {
        errors.push("qualityPolicy.targetAudioScore must be between 0 and 100");
    }

    if (errors.length > 0) {
        return { errors };
    }

    const request: ComposeRequest = {
        prompt,
        source: defaultSource,
        ...(compact(value.key) ? { key: compact(value.key) } : {}),
        ...(tempo !== undefined ? { tempo } : {}),
        ...(compact(value.form) ? { form: compact(value.form) } : {}),
        ...(durationSec !== undefined ? { durationSec } : {}),
        ...(resolvedCandidateCount !== undefined ? { candidateCount: resolvedCandidateCount } : {}),
        ...(localizedRewriteBranches !== undefined ? { localizedRewriteBranches } : {}),
        ...(compositionProfile ? { compositionProfile } : {}),
        ...(workflow ? { workflow } : {}),
        ...(selectedModels?.length ? { selectedModels } : {}),
        ...(targetInstrumentation?.length ? { targetInstrumentation } : {}),
        ...(compact(value.plannerVersion) ? { plannerVersion: compact(value.plannerVersion) } : {}),
        ...(parseEvaluationPolicy(value.evaluationPolicy) ? { evaluationPolicy: parseEvaluationPolicy(value.evaluationPolicy) } : {}),
        ...(qualityPolicy ? { qualityPolicy } : {}),
        ...(compositionPlan ? { compositionPlan } : {}),
    };

    if (!request.workflow && compositionPlan?.workflow) {
        request.workflow = compositionPlan.workflow;
    }

    if (!request.key && compositionPlan?.key) {
        request.key = compositionPlan.key;
    }

    if (request.tempo === undefined && compositionPlan?.tempo !== undefined) {
        request.tempo = compositionPlan.tempo;
    }

    if (!request.form && compositionPlan?.form) {
        request.form = compositionPlan.form;
    }

    if (request.durationSec === undefined && compositionPlan?.targetDurationSec !== undefined) {
        request.durationSec = compositionPlan.targetDurationSec;
    }

    if (!request.targetInstrumentation && compositionPlan?.instrumentation.length) {
        request.targetInstrumentation = compositionPlan.instrumentation;
    }

    const normalizedWorkflow = coerceStructureFirstWorkflow(
        request.form ?? compositionPlan?.form,
        request.workflow,
        request.selectedModels,
    );

    if (normalizedWorkflow) {
        request.workflow = normalizedWorkflow;
        if (request.selectedModels?.length) {
            request.selectedModels = ensureBindingsForWorkflow(normalizedWorkflow, request.selectedModels);
        }
        if (compositionPlan) {
            compositionPlan.workflow = normalizedWorkflow;
        }
    }

    if (compositionPlan) {
        errors.push(...validateSonataCompositionPlan(
            compositionPlan,
            request.key ?? compositionPlan.key,
        ));
    }

    if (errors.length > 0) {
        return { errors };
    }

    return {
        request,
        errors: [],
    };
}