import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import {
    appendAutonomyRunLedger,
    listStoredManifests,
    loadAutonomyControlState,
    loadAutonomyPreferences,
    loadAutonomyRunLedger,
    loadManifest,
    saveAutonomyControlState,
    saveAutonomyRunLedger,
    saveAutonomyPreferences,
    saveManifest,
} from "../memory/manifest.js";
import { collectRecentAxiomContext, generateOllamaText } from "../overseer/index.js";
import type {
    ArticulationTag,
    ApprovalStatus,
    CadenceOption,
    CadenceStyle,
    CharacterTag,
    CompositionPlan,
    CompositionSketch,
    ComposeQualityPolicy,
    ComposeRequest,
    ComposeWorkflow,
    DevelopmentType,
    DynamicLevel,
    DynamicsProfile,
    ExpositionPhase,
    ExpressionGuidance,
    HarmonicColorCue,
    HarmonicColorTag,
    HarmonicPlan,
    HarmonicDensity,
    HairpinShape,
    HumanizationStyle,
    InstrumentAssignment,
    JobManifest,
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
    PlannerTelemetry,
    PlanRiskProfile,
    PhraseBreathPlan,
    RecapMode,
    ReturnPayoffStrength,
    SectionPlan,
    SectionRole,
    SelfAssessment,
    StructureVisibility,
    TempoMotionPlan,
    TempoMotionTag,
    ThematicTransformKind,
    TonicizationEmphasis,
    TextureGuidance,
    TextureRole,
    VoicingProfile,
} from "../pipeline/types.js";
import { buildFallbackSectionsForForm, buildFormGuidance, coerceComposeWorkflowForForm, validateFormSectionFit } from "../pipeline/formTemplates.js";
import { summarizeLongSpanDivergence } from "../pipeline/longSpan.js";
import { defaultModelBindings } from "../pipeline/modelBindings.js";
import { ensureCompositionPlanOrchestration, summarizeOrchestrationPlan } from "../pipeline/orchestrationPlan.js";
import { buildRecommendedQualityPolicy, classifyQualityProfile } from "../pipeline/quality.js";
import { checkOllamaReachable } from "../overseer/index.js";
import { computePromptHash, ensureComposeRequestMetadata } from "./request.js";
import {
    outputArtifactLink,
    recordAutonomyOperatorAction,
    type AutonomyOperatorMutationContext,
} from "./actionAudit.js";
import { getAutonomyDayKey } from "./calendar.js";
import type {
    AutonomyBassMotionPattern,
    AutonomyControlState,
    AutonomyCadenceApproachPattern,
    AutonomyHumanFeedbackHighlights,
    AutonomyRecoverySummary,
    AutonomyLedgerEntry,
    AutonomyMotifReturnPattern,
    AutonomyPlan,
    AutonomyPreferences,
    AutonomyRegisterCenterPattern,
    AutonomySectionStylePattern,
    AutonomySkillGap,
    AutonomyStyleTendency,
    PlannerCandidateEvaluationSummary,
    PlannerCandidateSelectionSummary,
    AutonomySuccessPattern,
    AutonomyTensionArcPattern,
    PlannerNoveltySummary,
    PlannerPlanSummary,
    RecoverableAutonomyJob,
    AutonomyReviewFeedbackInput,
    AutonomyStatus,
    PendingApprovalSummary,
} from "./types.js";

const ATTEMPTED_RUN_STATUSES = new Set([
    "queued",
    "running",
    "retry_scheduled",
    "pending_approval",
    "approved",
    "rejected",
    "failed",
]);

const DEFAULT_PLANNER_VERSION = "planner-schema-v2";
const DEFAULT_PLANNER_CANDIDATE_COUNT = 3;
const PLANNER_CANDIDATE_SELECTION_STRATEGY = "novelty_plus_plan_completeness_v1";
const DEFAULT_REQUEST_WORKFLOW: ComposeWorkflow = "symbolic_only";
const MODEL_ROLES = new Set<ModelBinding["role"]>([
    "planner",
    "structure",
    "orchestrator",
    "audio_renderer",
    "structure_evaluator",
    "audio_evaluator",
    "summary_evaluator",
]);
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
const TEXTURE_ROLES = new Set<TextureRole>(["lead", "counterline", "inner_voice", "chordal_support", "pad", "pulse", "bass", "accent"]);
const TEXTURE_COUNTERPOINT_MODES = new Set<NonNullable<TextureGuidance["counterpointMode"]>>(["none", "imitative", "contrary_motion", "free"]);
const PLAN_RISK_PROFILES = new Set<PlanRiskProfile>(["conservative", "exploratory", "experimental"]);
const STRUCTURE_VISIBILITIES = new Set<StructureVisibility>(["transparent", "hidden", "complex"]);
const HUMANIZATION_STYLES = new Set<HumanizationStyle>(["mechanical", "restrained", "expressive"]);
const HARMONY_DENSITIES = new Set<HarmonicDensity>(["sparse", "medium", "rich"]);
const VOICING_PROFILES = new Set<VoicingProfile>(["block", "broken", "arpeggiated"]);
const PROLONGATION_MODES = new Set(["tonic", "dominant", "sequential", "pedal"]);
const TONICIZATION_EMPHASES = new Set<TonicizationEmphasis>(["passing", "prepared", "arriving"]);
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
const ORCHESTRATION_FAMILIES = new Set<OrchestrationFamily>(["string_trio"]);
const ORCHESTRATION_CONVERSATION_MODES = new Set<OrchestrationConversationMode>(["support", "conversational"]);
const ORCHESTRATION_BALANCE_PROFILES = new Set<OrchestrationBalanceProfile>(["lead_forward", "balanced"]);
const ORCHESTRATION_REGISTER_LAYOUTS = new Set<OrchestrationRegisterLayout>(["layered", "wide"]);
const DUPLICATE_PLAN_STATUSES = new Set([
    "queued",
    "running",
    "retry_scheduled",
    "pending_approval",
    "approved",
]);
const PLAN_NOVELTY_AXES = ["form", "key", "meter", "instrumentation", "sectionRoles", "humanizationStyle"] as const;

type PlanNoveltyAxis = typeof PLAN_NOVELTY_AXES[number];

interface PlanSignatureParts {
    form: string;
    key: string;
    meter: string;
    instrumentation: string;
    sectionRoles: string;
    humanizationStyle: string;
}

interface PlanNoveltyComparison {
    planSignature: string;
    source: "preferences" | "ledger";
    promptHash?: string;
    status?: AutonomyLedgerEntry["status"];
}

interface PlannerCandidateSpec {
    id: string;
    label: string;
    guidance: string;
    temperature: number;
}

interface ParsedPlannerCandidate extends Omit<AutonomyPlan, "generatedAt" | "runId" | "planSummary" | "noveltySummary" | "candidateSelection"> {
    parserMode: "structured_json" | "fallback";
}

interface EvaluatedPlannerCandidate {
    candidateId: string;
    candidateLabel: string;
    candidateIndex: number;
    parsed: ParsedPlannerCandidate;
    planSummary?: PlannerPlanSummary;
    noveltySummary: PlannerNoveltySummary;
    qualityScore: number;
    selectionScore: number;
}

interface FallbackPlannerSignal {
    normalizedText: string;
    lines: string[];
    prompt: string;
    brief?: string;
    form?: string;
    key?: string;
    tempo?: number;
    durationSec?: number;
    meter?: string;
    workflow: ComposeWorkflow;
    humanizationStyle?: HumanizationStyle;
    structureVisibility?: StructureVisibility;
    riskProfile?: PlanRiskProfile;
    instrumentation: InstrumentAssignment[];
    mood: string[];
    inspirationThread?: string;
    contrastTarget?: string;
}

const PLANNER_CANDIDATE_SPECS: PlannerCandidateSpec[] = [
    {
        id: "underused_form_key",
        label: "Underused form/key",
        guidance: "Push hardest on an underused form or key combination that still fits recent quality constraints.",
        temperature: 0.55,
    },
    {
        id: "texture_meter_contrast",
        label: "Texture or meter contrast",
        guidance: "If form or key remain familiar, make the candidate meaningfully different through meter, instrumentation, or humanization style.",
        temperature: 0.65,
    },
    {
        id: "weakness_repair_with_contrast",
        label: "Weakness repair with contrast",
        guidance: "Answer one recent weakness with a concrete structural or phrasing fix while still changing at least one major plan axis from recent work.",
        temperature: 0.72,
    },
];

const FALLBACK_FORM_PATTERNS: Array<{ form: string; patterns: RegExp[] }> = [
    { form: "theme_and_variations", patterns: [/\btheme and variations\b/i, /\bvariations?\b/i] },
    { form: "fugue_lite", patterns: [/\bfugue\b/i, /\bfughetta\b/i] },
    { form: "sonata", patterns: [/\bsonata(?: allegro)?\b/i] },
    { form: "rondo", patterns: [/\brondo\b/i] },
    { form: "nocturne", patterns: [/\bnocturne\b/i] },
    { form: "prelude", patterns: [/\bprelude\b/i] },
    { form: "waltz", patterns: [/\bwaltz\b/i] },
    { form: "miniature", patterns: [/\bminiature\b/i, /\bshort piece\b/i] },
];

const FALLBACK_MOOD_KEYWORDS = [
    "intimate",
    "fragile",
    "lyrical",
    "bright",
    "dark",
    "reflective",
    "warm",
    "poised",
    "driven",
    "agitated",
    "gentle",
    "chamber",
];

const FALLBACK_INSTRUMENT_SPECS: Array<{
    name: string;
    family: InstrumentAssignment["family"];
    register: InstrumentAssignment["register"];
    patterns: RegExp[];
}> = [
        { name: "piano", family: "keyboard", register: "wide", patterns: [/\bpiano\b/i, /\bkeyboard\b/i] },
        { name: "violin", family: "strings", register: "high", patterns: [/\bviolin\b/i] },
        { name: "viola", family: "strings", register: "mid", patterns: [/\bviola\b/i] },
        { name: "cello", family: "strings", register: "low", patterns: [/\bcello\b/i] },
        { name: "flute", family: "woodwinds", register: "high", patterns: [/\bflute\b/i] },
        { name: "clarinet", family: "woodwinds", register: "mid", patterns: [/\bclarinet\b/i] },
        { name: "oboe", family: "woodwinds", register: "high", patterns: [/\boboe\b/i] },
        { name: "bassoon", family: "woodwinds", register: "low", patterns: [/\bbassoon\b/i] },
        { name: "horn", family: "brass", register: "mid", patterns: [/\bhorn\b/i] },
        { name: "trumpet", family: "brass", register: "high", patterns: [/\btrumpet\b/i] },
        { name: "harp", family: "strings", register: "wide", patterns: [/\bharp\b/i] },
        { name: "guitar", family: "strings", register: "mid", patterns: [/\bguitar\b/i] },
    ];

export class AutonomyConflictError extends Error {
    readonly statusCode = 409;
    readonly details?: Record<string, unknown>;

    constructor(message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = "AutonomyConflictError";
        this.details = details;
    }
}

export function isAutonomyConflictError(error: unknown): error is AutonomyConflictError {
    return error instanceof AutonomyConflictError;
}

function todayKey(): string {
    return getAutonomyDayKey();
}

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function normalizePlanSignatureValue(value: unknown): string {
    const normalized = compact(value).toLowerCase();
    return normalized || "none";
}

function dayKeyFromIso(iso: string | undefined): string {
    return iso ? getAutonomyDayKey(iso) : todayKey();
}

function summarizeControlState(state: AutonomyControlState): Record<string, unknown> {
    return {
        paused: state.paused,
        pauseReason: state.pauseReason,
        updatedAt: state.updatedAt,
        activeRun: state.activeRun,
    };
}

function summarizeApprovalState(manifest: JobManifest): Record<string, unknown> {
    return {
        songId: manifest.songId,
        approvalStatus: manifest.approvalStatus,
        evaluationSummary: manifest.evaluationSummary,
        reviewFeedback: manifest.reviewFeedback,
        updatedAt: manifest.updatedAt,
    };
}

function dedupe(values: string[], limit: number): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values.map((item) => compact(item)).filter(Boolean)) {
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
        if (result.length >= limit) break;
    }

    return result;
}

function emptyHumanFeedbackHighlights(): AutonomyHumanFeedbackHighlights {
    return {
        approvedCount: 0,
        rejectedCount: 0,
        scoredFeedbackCount: 0,
        positiveFactors: [],
        negativeFactors: [],
        rejectionReasons: [],
        comparisonReferences: [],
    };
}

function buildHumanFeedbackHighlights(preferences: AutonomyPreferences): AutonomyHumanFeedbackHighlights {
    const summary = preferences.humanFeedbackSummary;
    if (!summary) {
        return emptyHumanFeedbackHighlights();
    }

    return {
        approvedCount: Math.max(0, Number(summary.approvedCount ?? 0) || 0),
        rejectedCount: Math.max(0, Number(summary.rejectedCount ?? 0) || 0),
        scoredFeedbackCount: Math.max(0, Number(summary.scoredFeedbackCount ?? 0) || 0),
        positiveFactors: [...(summary.positiveDimensions ?? [])],
        negativeFactors: [...(summary.negativeDimensions ?? [])],
        rejectionReasons: [...(summary.rejectionReasons ?? [])],
        comparisonReferences: [...(summary.comparisonReferences ?? [])],
    };
}

function updateHumanFeedbackSummary(
    current: AutonomyPreferences,
    nextStatus: Extract<ApprovalStatus, "approved" | "rejected">,
    reviewFeedback: AutonomyReviewFeedbackInput | undefined,
): AutonomyPreferences["humanFeedbackSummary"] {
    const existing = current.humanFeedbackSummary;
    const note = compact(reviewFeedback?.note);
    const strongestDimension = compact(reviewFeedback?.strongestDimension);
    const weakestDimension = compact(reviewFeedback?.weakestDimension);
    const comparisonReference = compact(reviewFeedback?.comparisonReference);
    const scored = typeof reviewFeedback?.appealScore === "number" && Number.isFinite(reviewFeedback.appealScore);

    return {
        approvedCount: Math.max(0, Number(existing?.approvedCount ?? 0) || 0) + (nextStatus === "approved" ? 1 : 0),
        rejectedCount: Math.max(0, Number(existing?.rejectedCount ?? 0) || 0) + (nextStatus === "rejected" ? 1 : 0),
        scoredFeedbackCount: Math.max(0, Number(existing?.scoredFeedbackCount ?? 0) || 0) + (scored ? 1 : 0),
        positiveDimensions: takeTop([
            strongestDimension,
            ...(existing?.positiveDimensions ?? []),
        ], 6),
        negativeDimensions: takeTop([
            weakestDimension,
            ...(existing?.negativeDimensions ?? []),
        ], 6),
        rejectionReasons: takeTop([
            ...(nextStatus === "rejected" && note ? [note] : []),
            ...(existing?.rejectionReasons ?? []),
        ], 6),
        comparisonReferences: dedupe([
            comparisonReference,
            ...(existing?.comparisonReferences ?? []),
        ], 6),
    };
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end < start) return null;

    try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function summarizeRecentManifests(manifests: JobManifest[]): string {
    if (manifests.length === 0) {
        return "- no prior songs";
    }

    return manifests
        .map((manifest) => {
            const score = manifest.selfAssessment?.qualityScore;
            const approval = manifest.approvalStatus ?? "unknown";
            const weaknesses = manifest.selfAssessment?.weaknesses.join(", ") || "none";
            return `- ${manifest.songId.slice(0, 8)} state=${manifest.state} form=${manifest.meta.form ?? "?"} key=${manifest.meta.key ?? "?"} approval=${approval} score=${score ?? "?"} weaknesses=${weaknesses}`;
        })
        .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveMeasureNumber(value: unknown): number | undefined {
    const parsed = finiteNumber(value);
    if (parsed === undefined || parsed <= 0) {
        return undefined;
    }

    return Math.trunc(parsed);
}

function booleanValue(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown, limit: number): string[] {
    return Array.isArray(value)
        ? dedupe(value.map((item) => String(item ?? "")), limit)
        : [];
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
    const notes = stringArray(value.notes, 8);

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

function parseWorkflow(value: unknown): ComposeWorkflow | undefined {
    const normalized = compact(value).toLowerCase();
    if (normalized === "symbolic_only" || normalized === "symbolic_plus_audio" || normalized === "audio_only") {
        return normalized;
    }
    return undefined;
}

function normalizeFormLabel(value: unknown): string {
    return compact(value).toLowerCase();
}

function isSonataLikeForm(value: unknown): boolean {
    return normalizeFormLabel(value).includes("sonata");
}

function coerceStructureFirstWorkflow(
    form: string | undefined,
    workflow: ComposeWorkflow,
): ComposeWorkflow {
    return coerceComposeWorkflowForForm(form, workflow) ?? workflow;
}

function ensurePlannerBindingsForWorkflow(bindings: ModelBinding[], workflow: ComposeWorkflow): ModelBinding[] {
    const roles = new Set(bindings.map((binding) => binding.role));
    const nextBindings = bindings.map((binding) => ({ ...binding }));

    for (const binding of plannerModelBindings(workflow)) {
        if (!roles.has(binding.role)) {
            nextBindings.push({ ...binding });
            roles.add(binding.role);
        }
    }

    return nextBindings;
}

function parseKeyLabel(value: string | undefined): { tonic: string; mode: "major" | "minor" } | null {
    const normalized = compact(value).replace(/\s+/g, " ");
    const match = /^([A-G](?:#|b)?)(?:\s+(major|minor))$/i.exec(normalized);
    if (!match) {
        return null;
    }

    return {
        tonic: match[1],
        mode: match[2].toLowerCase() as "major" | "minor",
    };
}

function dominantKeyLabel(homeKey: string | undefined): string | undefined {
    const parsed = parseKeyLabel(homeKey);
    if (!parsed) {
        return undefined;
    }

    const dominantByTonic: Record<string, string> = {
        C: "G",
        G: "D",
        D: "A",
        A: "E",
        E: "B",
        B: "F#",
        "F#": "C#",
        F: "C",
        Bb: "F",
        Eb: "Bb",
        Ab: "Eb",
        Db: "Ab",
        Cb: "Gb",
    };

    const tonic = dominantByTonic[parsed.tonic] ?? parsed.tonic;
    return `${tonic} ${parsed.mode}`;
}

function buildSonataFallbackSections(request: ComposeRequest): SectionPlan[] {
    const homeKey = request.key;
    const secondaryKey = dominantKeyLabel(homeKey);

    return [
        {
            id: "s1",
            role: "theme_a",
            label: "Primary theme",
            measures: 8,
            energy: 0.42,
            density: 0.36,
            cadence: "half",
            harmonicPlan: {
                tonalCenter: homeKey,
                harmonicRhythm: "medium",
                tensionTarget: 0.4,
                cadence: "half",
                allowModulation: false,
            },
            notes: ["State the opening idea clearly in the home key."],
        } satisfies SectionPlan,
        {
            id: "s2",
            role: "theme_b",
            label: "Contrasting theme",
            measures: 8,
            energy: 0.5,
            density: 0.42,
            cadence: "half",
            contrastFrom: "s1",
            harmonicPlan: {
                tonalCenter: secondaryKey,
                harmonicRhythm: "medium",
                tensionTarget: 0.58,
                cadence: "half",
                allowModulation: true,
            },
            notes: ["Contrast the opening material and begin a clear tonal departure."],
        } satisfies SectionPlan,
        {
            id: "s3",
            role: "development",
            label: "Development",
            measures: 8,
            energy: 0.72,
            density: 0.58,
            motifRef: "s1",
            cadence: "half",
            harmonicPlan: {
                tonalCenter: secondaryKey,
                harmonicRhythm: "fast",
                tensionTarget: 0.78,
                cadence: "half",
                allowModulation: true,
            },
            notes: ["Transform the opening motif and intensify the harmonic motion."],
        } satisfies SectionPlan,
        {
            id: "s4",
            role: "recap",
            label: "Recapitulation",
            measures: 8,
            energy: 0.38,
            density: 0.32,
            motifRef: "s1",
            cadence: "authentic",
            harmonicPlan: {
                tonalCenter: homeKey,
                harmonicRhythm: "medium",
                tensionTarget: 0.24,
                cadence: "authentic",
                allowModulation: false,
            },
            notes: ["Return the opening idea decisively in the home key."],
        } satisfies SectionPlan,
    ];
}

function isValidSonataSectionPlan(sections: SectionPlan[], homeKey: string | undefined): boolean {
    const roles = sections.map((section) => section.role);
    const themeIndex = roles.indexOf("theme_a");
    const developmentIndex = roles.indexOf("development");
    const recapIndex = roles.indexOf("recap");

    if (sections.length < 3 || themeIndex < 0 || developmentIndex < 0 || recapIndex < 0) {
        return false;
    }

    if (!(themeIndex < developmentIndex && developmentIndex < recapIndex)) {
        return false;
    }

    if (sections[developmentIndex]?.harmonicPlan?.allowModulation === false) {
        return false;
    }

    const normalizedHomeKey = normalizeFormLabel(homeKey)
        || normalizeFormLabel(sections[themeIndex]?.harmonicPlan?.tonalCenter);
    const normalizedRecapKey = normalizeFormLabel(sections[recapIndex]?.harmonicPlan?.tonalCenter);
    if (normalizedHomeKey && normalizedRecapKey && normalizedHomeKey !== normalizedRecapKey) {
        return false;
    }

    return true;
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

    return dedupe(
        value
            .map((item) => compact(item).toLowerCase())
            .filter((item): item is ArticulationTag => ARTICULATION_TAGS.has(item as ArticulationTag)),
        6,
    ) as ArticulationTag[];
}

function parseCharacterTags(value: unknown): CharacterTag[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return dedupe(
        value
            .map((item) => compact(item).toLowerCase())
            .filter((item): item is CharacterTag => CHARACTER_TAGS.has(item as CharacterTag)),
        6,
    ) as CharacterTag[];
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
        const startMeasure = finiteNumber(entry.startMeasure);
        if (startMeasure !== undefined && startMeasure > 0) {
            motion.startMeasure = Math.trunc(startMeasure);
        }

        const endMeasure = finiteNumber(entry.endMeasure);
        if (endMeasure !== undefined && endMeasure > 0) {
            motion.endMeasure = Math.trunc(endMeasure);
        }

        const intensity = finiteNumber(entry.intensity);
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

        const startMeasure = finiteNumber(entry.startMeasure);
        if (startMeasure !== undefined && startMeasure > 0) {
            ornament.startMeasure = Math.trunc(startMeasure);
        }

        const endMeasure = finiteNumber(entry.endMeasure);
        if (endMeasure !== undefined && endMeasure > 0) {
            ornament.endMeasure = Math.trunc(endMeasure);
        }

        const targetBeat = finiteNumber(entry.targetBeat);
        if (targetBeat !== undefined && targetBeat > 0) {
            ornament.targetBeat = targetBeat;
        }

        const intensity = finiteNumber(entry.intensity);
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
                startMeasure: finiteNumber(entry.startMeasure),
                endMeasure: finiteNumber(entry.endMeasure),
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
            .map((entry) => finiteNumber(entry))
            .filter((entry): entry is number => entry !== undefined);
        if (phrasePeaks.length > 0) {
            expression.phrasePeaks = phrasePeaks;
        }
    }

    const sustainBias = finiteNumber(value.sustainBias);
    if (sustainBias !== undefined) {
        expression.sustainBias = sustainBias;
    }

    const accentBias = finiteNumber(value.accentBias);
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

function parseTextureRoles(value: unknown): TextureRole[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return dedupe(
        value
            .map((item) => compact(item).toLowerCase())
            .filter((item): item is TextureRole => TEXTURE_ROLES.has(item as TextureRole)),
        6,
    ) as TextureRole[];
}

function parseTextureGuidance(value: unknown): TextureGuidance | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const voiceCount = finiteNumber(value.voiceCount);
    const primaryRoles = parseTextureRoles(value.primaryRoles ?? value.roles);
    const counterpointMode = compact(value.counterpointMode).toLowerCase();
    const notes = stringArray(value.notes, 6);
    const texture: TextureGuidance = {
        ...(voiceCount !== undefined && voiceCount > 0 ? { voiceCount: Math.trunc(voiceCount) } : {}),
        ...(primaryRoles.length > 0 ? { primaryRoles } : {}),
        ...(TEXTURE_COUNTERPOINT_MODES.has(counterpointMode as NonNullable<TextureGuidance["counterpointMode"]>)
            ? { counterpointMode: counterpointMode as NonNullable<TextureGuidance["counterpointMode"]> }
            : {}),
        ...(notes.length > 0 ? { notes } : {}),
    };

    return Object.keys(texture).length > 0 ? texture : undefined;
}

function plannerModelBindings(workflow: ComposeWorkflow): ModelBinding[] {
    return defaultModelBindings(workflow, {
        includePlanner: true,
        plannerProvider: "ollama",
        plannerModel: config.ollamaModel,
    });
}

function parseModelBindings(value: unknown, workflow: ComposeWorkflow): ModelBinding[] {
    if (!Array.isArray(value)) {
        return plannerModelBindings(workflow);
    }

    const parsed: ModelBinding[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }

        const role = compact(entry.role).toLowerCase();
        const provider = compact(entry.provider);
        const model = compact(entry.model);
        if (!MODEL_ROLES.has(role as ModelBinding["role"]) || !provider || !model) {
            continue;
        }

        const binding: ModelBinding = {
            role: role as ModelBinding["role"],
            provider,
            model,
        };
        const version = compact(entry.version);
        if (version) {
            binding.version = version;
        }
        parsed.push(binding);
    }

    return ensurePlannerBindingsForWorkflow(
        parsed.length > 0 ? parsed : plannerModelBindings(workflow),
        workflow,
    );
}

function parseInstrumentAssignments(value: unknown, fallback?: InstrumentAssignment[]): InstrumentAssignment[] {
    if (!Array.isArray(value)) {
        return fallback ?? [];
    }

    const parsed: InstrumentAssignment[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }

        const name = compact(entry.name);
        const family = compact(entry.family).toLowerCase();
        const roles = parseTextureRoles(entry.roles);
        const register = compact(entry.register).toLowerCase();
        if (!name || !family || roles.length === 0) {
            continue;
        }

        if (!["keyboard", "strings", "woodwinds", "brass", "percussion", "voice", "hybrid"].includes(family)) {
            continue;
        }

        const instrument: InstrumentAssignment = {
            name,
            family: family as InstrumentAssignment["family"],
            roles,
        };
        if (["low", "mid", "high", "wide"].includes(register)) {
            instrument.register = register as InstrumentAssignment["register"];
        }
        parsed.push(instrument);
    }

    return parsed;
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
            const intensity = finiteNumber(entry.intensity);
            const keyTarget = compact(entry.keyTarget) || undefined;
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
    const tonicizationWindows = Array.isArray(value.tonicizationWindows)
        ? value.tonicizationWindows
            .map((entry) => {
                if (!isRecord(entry)) {
                    return undefined;
                }

                const keyTarget = compact(entry.keyTarget);
                if (!keyTarget) {
                    return undefined;
                }

                const emphasis = compact(entry.emphasis).toLowerCase();
                const startMeasure = positiveMeasureNumber(entry.startMeasure);
                const endMeasure = positiveMeasureNumber(entry.endMeasure);

                return {
                    keyTarget,
                    ...(startMeasure !== undefined ? { startMeasure } : {}),
                    ...(endMeasure !== undefined ? { endMeasure } : {}),
                    ...(TONICIZATION_EMPHASES.has(emphasis as TonicizationEmphasis)
                        ? { emphasis: emphasis as TonicizationEmphasis }
                        : {}),
                    ...(parseCadenceStyle(entry.cadence) ? { cadence: parseCadenceStyle(entry.cadence) } : {}),
                };
            })
            .filter((entry): entry is NonNullable<HarmonicPlan["tonicizationWindows"]>[number] => entry !== undefined)
        : undefined;
    const colorCues = parseHarmonicColorCues(value.colorCues ?? value.harmonicColorCues);
    return {
        tonalCenter: compact(value.tonalCenter) || undefined,
        keyTarget: compact(value.keyTarget) || undefined,
        modulationPath: modulationPath?.length ? modulationPath : undefined,
        harmonicRhythm: ["slow", "medium", "fast"].includes(harmonicRhythm)
            ? harmonicRhythm as HarmonicPlan["harmonicRhythm"]
            : undefined,
        harmonyDensity: HARMONY_DENSITIES.has(harmonyDensity as HarmonicDensity)
            ? harmonyDensity as HarmonicDensity
            : undefined,
        voicingProfile: VOICING_PROFILES.has(voicingProfile as VoicingProfile)
            ? voicingProfile as VoicingProfile
            : undefined,
        prolongationMode: PROLONGATION_MODES.has(prolongationMode)
            ? prolongationMode as HarmonicPlan["prolongationMode"]
            : undefined,
        tonicizationWindows: tonicizationWindows?.length ? tonicizationWindows : undefined,
        colorCues,
        tensionTarget: finiteNumber(value.tensionTarget),
        cadence: parseCadenceStyle(value.cadence),
        allowModulation: booleanValue(value.allowModulation),
    };
}

function parseMotifPolicy(value: unknown): MotifTransformPolicy {
    if (!isRecord(value)) {
        return {
            reuseRequired: true,
            inversionAllowed: true,
            augmentationAllowed: true,
            diminutionAllowed: false,
            sequenceAllowed: true,
        };
    }

    return {
        reuseRequired: booleanValue(value.reuseRequired) ?? true,
        inversionAllowed: booleanValue(value.inversionAllowed),
        augmentationAllowed: booleanValue(value.augmentationAllowed),
        diminutionAllowed: booleanValue(value.diminutionAllowed),
        sequenceAllowed: booleanValue(value.sequenceAllowed),
    };
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
            .map((item) => finiteNumber(item))
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
            preserveDuringRevision: booleanValue(entry.preserveDuringRevision),
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

        options.push({
            sectionId: compact(entry.sectionId) || `section-${options.length + 1}`,
            primary,
            alternatives: Array.isArray(entry.alternatives)
                ? entry.alternatives
                    .map((item) => parseCadenceStyle(item))
                    .filter((item): item is CadenceStyle => item !== undefined)
                : [],
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

    const checkpoints: NonNullable<LongSpanFormPlan["thematicCheckpoints"]> = [];
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

        checkpoints.push({
            id: compact(entry.id) || undefined,
            sourceSectionId,
            targetSectionId,
            transform: transform as ThematicTransformKind,
            expectedProminence: finiteNumber(entry.expectedProminence) !== undefined
                ? Math.max(0, Math.min(1, Number(entry.expectedProminence)))
                : undefined,
            preserveIdentity: booleanValue(entry.preserveIdentity),
            notes: stringArray(entry.notes, 6),
        });
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

    const plan: LongSpanFormPlan = {
        expositionStartSectionId: compact(value.expositionStartSectionId) || undefined,
        expositionEndSectionId: compact(value.expositionEndSectionId) || undefined,
        developmentStartSectionId: compact(value.developmentStartSectionId) || undefined,
        developmentEndSectionId: compact(value.developmentEndSectionId) || undefined,
        retransitionSectionId: compact(value.retransitionSectionId) || undefined,
        recapStartSectionId: compact(value.recapStartSectionId) || undefined,
        returnSectionId: compact(value.returnSectionId) || undefined,
        delayedPayoffSectionId: compact(value.delayedPayoffSectionId) || undefined,
        expectedDevelopmentPressure: LONG_SPAN_PRESSURES.has(expectedDevelopmentPressure as LongSpanPressure)
            ? expectedDevelopmentPressure as LongSpanPressure
            : undefined,
        expectedReturnPayoff: RETURN_PAYOFF_STRENGTHS.has(expectedReturnPayoff as ReturnPayoffStrength)
            ? expectedReturnPayoff as ReturnPayoffStrength
            : undefined,
        thematicCheckpoints,
        notes: stringArray(value.notes, 6),
    };

    return Object.values(plan).some((entry) => Array.isArray(entry) ? entry.length > 0 : entry !== undefined)
        ? plan
        : undefined;
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
            const notes = stringArray(entry.notes, 4);

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
    const notes = stringArray(value.notes, 6);

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

function parseQualityPolicy(
    value: unknown,
    form: string | undefined,
    workflow: ComposeWorkflow,
): ComposeQualityPolicy {
    const defaults = buildRecommendedQualityPolicy(form, workflow);
    if (!isRecord(value)) {
        return defaults;
    }

    return {
        enableAutoRevision: booleanValue(value.enableAutoRevision) ?? defaults.enableAutoRevision,
        maxStructureAttempts: finiteNumber(value.maxStructureAttempts) ?? defaults.maxStructureAttempts,
        targetStructureScore: finiteNumber(value.targetStructureScore) ?? defaults.targetStructureScore,
        targetAudioScore: finiteNumber(value.targetAudioScore) ?? defaults.targetAudioScore,
    };
}

function buildFallbackExpressionDefaults(
    humanizationStyle: HumanizationStyle | undefined,
    form: string | undefined,
): ExpressionGuidance {
    const normalizedForm = compact(form).toLowerCase();
    const lyricForm = ["miniature", "short", "nocturne", "lullaby", "prelude"].includes(normalizedForm);

    if (humanizationStyle === "mechanical") {
        return {
            dynamics: {
                start: lyricForm ? "mp" : "mf",
                peak: "mf",
                end: lyricForm ? "mp" : "mf",
            },
            articulation: ["accent"],
            sustainBias: -0.1,
            accentBias: 0.15,
        };
    }

    if (humanizationStyle === "expressive") {
        return {
            dynamics: {
                start: lyricForm ? "mp" : "mf",
                peak: lyricForm ? "f" : "ff",
                end: lyricForm ? "mf" : "f",
                hairpins: [{
                    shape: "crescendo",
                    startMeasure: 1,
                    endMeasure: 4,
                    target: lyricForm ? "f" : "ff",
                }],
            },
            articulation: ["legato"],
            character: [lyricForm ? "espressivo" : "agitato"],
            sustainBias: 0.18,
            accentBias: 0.18,
        };
    }

    return {
        dynamics: {
            start: lyricForm ? "p" : "mp",
            peak: lyricForm ? "mp" : "mf",
            end: lyricForm ? "p" : "mp",
            hairpins: [{
                shape: "crescendo",
                startMeasure: 1,
                endMeasure: 4,
                target: lyricForm ? "mp" : "mf",
            }],
        },
        articulation: ["legato"],
        character: [lyricForm ? "dolce" : "cantabile"],
        sustainBias: 0.22,
        accentBias: 0,
    };
}

function buildFallbackSectionExpression(
    section: SectionPlan,
    humanizationStyle: HumanizationStyle | undefined,
): ExpressionGuidance | undefined {
    const midpoint = Math.max(1, Math.ceil(section.measures / 2));
    const latePeak = section.measures >= 6 ? Math.max(1, section.measures - 1) : undefined;

    if (section.role === "development" || section.role === "variation" || section.role === "bridge") {
        return {
            articulation: [section.energy >= 0.55 || humanizationStyle === "mechanical" ? "accent" : "legato"],
            character: [section.energy >= 0.55 || humanizationStyle === "expressive" ? "agitato" : "espressivo"],
            phrasePeaks: latePeak ? [midpoint, latePeak] : [midpoint],
            sustainBias: section.energy >= 0.55 ? -0.08 : 0.05,
            accentBias: section.energy >= 0.55 ? 0.2 : 0.08,
        };
    }

    if (section.role === "cadence" || section.role === "outro") {
        return {
            articulation: ["legato"],
            character: [humanizationStyle === "expressive" ? "espressivo" : "dolce"],
            phrasePeaks: [Math.max(1, section.measures)],
            sustainBias: 0.22,
            accentBias: 0.04,
        };
    }

    if (section.role === "recap") {
        return {
            articulation: ["legato"],
            character: [humanizationStyle === "mechanical" ? "cantabile" : "dolce"],
            phrasePeaks: latePeak ? [midpoint, latePeak] : [midpoint],
            sustainBias: 0.18,
        };
    }

    return {
        articulation: [humanizationStyle === "mechanical" ? "accent" : "legato"],
        character: [humanizationStyle === "expressive" ? "cantabile" : "dolce"],
        phrasePeaks: latePeak ? [midpoint, latePeak] : [midpoint],
        sustainBias: humanizationStyle === "mechanical" ? -0.05 : 0.14,
        accentBias: humanizationStyle === "mechanical" ? 0.12 : 0,
    };
}

function applyFallbackExpressionPlan(
    sections: SectionPlan[],
    humanizationStyle: HumanizationStyle | undefined,
): SectionPlan[] {
    return sections.map((section) => section.expression
        ? section
        : {
            ...section,
            expression: buildFallbackSectionExpression(section, humanizationStyle),
        });
}

function fallbackSectionPlan(request: ComposeRequest): SectionPlan[] {
    const templateSections = buildFallbackSectionsForForm(request.form, request.key);
    if (templateSections) {
        return templateSections;
    }

    return [
        {
            id: "s1",
            role: "theme_a",
            label: "Primary idea",
            measures: 8,
            energy: 0.35,
            density: 0.35,
            cadence: "half",
            harmonicPlan: {
                tonalCenter: request.key,
                harmonicRhythm: "medium",
                tensionTarget: 0.45,
                cadence: "half",
                allowModulation: false,
            },
            notes: ["Introduce the main material clearly."],
        } satisfies SectionPlan,
        {
            id: "s2",
            role: "cadence",
            label: "Closing phrase",
            measures: 8,
            energy: 0.28,
            density: 0.28,
            cadence: "authentic",
            motifRef: "s1",
            harmonicPlan: {
                tonalCenter: request.key,
                harmonicRhythm: "medium",
                tensionTarget: 0.2,
                cadence: "authentic",
                allowModulation: false,
            },
            notes: ["Return to the opening idea and close clearly."],
        } satisfies SectionPlan,
    ];
}

function parseSectionPlans(value: unknown, request: ComposeRequest, fallbackInstrumentation: InstrumentAssignment[]): SectionPlan[] {
    if (!Array.isArray(value)) {
        return fallbackSectionPlan(request).map((section) => ({
            ...section,
            instrumentation: fallbackInstrumentation,
        }));
    }

    const sections: SectionPlan[] = [];
    value.forEach((entry, index) => {
        if (!isRecord(entry)) {
            return;
        }

        const role = compact(entry.role).toLowerCase();
        if (!SECTION_ROLES.has(role as SectionRole)) {
            return;
        }

        const measures = finiteNumber(entry.measures) ?? 0;
        const energy = finiteNumber(entry.energy) ?? 0.35;
        const density = finiteNumber(entry.density) ?? 0.35;
        if (measures <= 0) {
            return;
        }

        const section: SectionPlan = {
            id: compact(entry.id) || `s${index + 1}`,
            role: role as SectionRole,
            label: compact(entry.label) || `Section ${index + 1}`,
            measures,
            energy,
            density,
            instrumentation: parseInstrumentAssignments(entry.instrumentation, fallbackInstrumentation),
            notes: stringArray(entry.notes, 6),
        };

        const phraseBreath = parsePhraseBreathPlan(entry.phraseBreath ?? entry.phraseBreathPlan);
        if (phraseBreath) {
            section.phraseBreath = phraseBreath;
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

        const cadenceStrength = finiteNumber(entry.cadenceStrength);
        if (cadenceStrength !== undefined) {
            section.cadenceStrength = cadenceStrength;
        }

        const registerCenter = finiteNumber(entry.registerCenter);
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

        sections.push(section);
    });

    if (sections.length === 0 || validateFormSectionFit(request.form, sections, request.key).length > 0) {
        return fallbackSectionPlan(request).map((section) => ({
            ...section,
            instrumentation: fallbackInstrumentation,
        }));
    }

    return sections;
}

function buildFallbackCompositionPlan(
    request: ComposeRequest,
    preferences: AutonomyPreferences,
    rationale: string,
    signal?: FallbackPlannerSignal,
): CompositionPlan {
    const instrumentation = request.targetInstrumentation?.length
        ? request.targetInstrumentation
        : signal?.instrumentation.length
            ? signal.instrumentation
            : [{
                name: "piano",
                family: "keyboard",
                roles: ["lead", "pad"],
                register: "wide",
            } satisfies InstrumentAssignment];

    const brief = signal?.brief
        || compact(request.prompt)
        || `A concise ${request.form ?? preferences.preferredForms[0] ?? "miniature"} with a clear cadence.`;

    const baseRequest = {
        ...request,
        targetInstrumentation: instrumentation,
    };
    const workflow = coerceStructureFirstWorkflow(
        request.form,
        request.workflow ?? DEFAULT_REQUEST_WORKFLOW,
    );
    const resolvedHumanizationStyle = preferences.styleTendency?.humanizationStyle ?? "restrained";
    const finalHumanizationStyle = signal?.humanizationStyle ?? resolvedHumanizationStyle;
    const resolvedForm = request.form ?? preferences.preferredForms[0] ?? "miniature";
    const expressionDefaults = buildFallbackExpressionDefaults(finalHumanizationStyle, resolvedForm);
    const sections = applyFallbackExpressionPlan(
        applyPreferenceBiasToSections(
            parseSectionPlans(undefined, baseRequest, instrumentation),
            preferences,
            resolvedForm,
        ),
        finalHumanizationStyle,
    );

    return ensureCompositionPlanOrchestration({
        version: request.plannerVersion ?? DEFAULT_PLANNER_VERSION,
        titleHint: undefined,
        brief,
        mood: signal?.mood.length ? signal.mood : ["classical", "focused"],
        form: resolvedForm,
        inspirationThread: signal?.inspirationThread || preferences.lastReflection || "Develop a concise idea with a clear closing gesture.",
        intentRationale: rationale,
        contrastTarget: signal?.contrastTarget || (preferences.successPatterns?.[0]?.form
            ? `Contrast with the recently successful ${preferences.successPatterns[0].form}.`
            : undefined),
        riskProfile: signal?.riskProfile ?? (preferences.skillGaps?.length ? "conservative" : "exploratory"),
        structureVisibility: signal?.structureVisibility ?? "transparent",
        humanizationStyle: finalHumanizationStyle,
        targetDurationSec: request.durationSec,
        targetMeasures: undefined,
        meter: signal?.meter,
        key: request.key,
        tempo: request.tempo,
        workflow,
        instrumentation,
        expressionDefaults,
        motifPolicy: parseMotifPolicy(undefined),
        sections,
        rationale,
    });
}

function parseCompositionPlan(
    value: unknown,
    request: ComposeRequest,
    preferences: AutonomyPreferences,
    rationale: string,
): CompositionPlan {
    if (!isRecord(value)) {
        return buildFallbackCompositionPlan(request, preferences, rationale);
    }

    const instrumentation = parseInstrumentAssignments(value.instrumentation, request.targetInstrumentation);
    const form = compact(value.form) || request.form || preferences.preferredForms[0] || "miniature";
    const hydratedRequest = {
        ...request,
        form,
        targetInstrumentation: instrumentation.length > 0 ? instrumentation : request.targetInstrumentation,
    };
    const humanizationStyle = parseHumanizationStyle(value.humanizationStyle)
        ?? preferences.styleTendency?.humanizationStyle;
    const textureDefaults = parseTextureGuidance(value.textureDefaults ?? value.texture ?? value.textureGuidance);
    const expressionDefaults = parseExpressionGuidance(value.expressionDefaults ?? value.expressionGuidance ?? value.expression)
        ?? buildFallbackExpressionDefaults(humanizationStyle, form);
    const tempoMotionDefaults = parseTempoMotionPlans(value.tempoMotionDefaults ?? value.tempoMotion ?? value.tempoMotionPlan);
    const ornamentDefaults = parseOrnamentPlans(value.ornamentDefaults ?? value.ornaments ?? value.ornament ?? value.ornamentPlan);
    const workflow = coerceStructureFirstWorkflow(
        form,
        parseWorkflow(value.workflow) ?? request.workflow ?? DEFAULT_REQUEST_WORKFLOW,
    );
    const sections = applyFallbackExpressionPlan(
        applyPreferenceBiasToSections(
            parseSectionPlans(value.sections, hydratedRequest, instrumentation),
            preferences,
            form,
        ),
        humanizationStyle,
    );
    const orchestration = parseOrchestrationPlan(value.orchestration);

    return ensureCompositionPlanOrchestration({
        version: compact(value.version) || request.plannerVersion || DEFAULT_PLANNER_VERSION,
        titleHint: compact(value.titleHint) || undefined,
        brief: compact(value.brief) || compact(request.prompt) || "Planned AXIOM composition",
        mood: stringArray(value.mood, 8),
        form,
        inspirationThread: compact(value.inspirationThread) || preferences.lastReflection || undefined,
        intentRationale: compact(value.intentRationale) || undefined,
        contrastTarget: compact(value.contrastTarget) || undefined,
        riskProfile: parsePlanRiskProfile(value.riskProfile),
        structureVisibility: parseStructureVisibility(value.structureVisibility),
        humanizationStyle,
        targetDurationSec: finiteNumber(value.targetDurationSec) ?? request.durationSec,
        targetMeasures: finiteNumber(value.targetMeasures),
        meter: compact(value.meter) || undefined,
        key: compact(value.key) || request.key,
        tempo: finiteNumber(value.tempo) ?? request.tempo,
        workflow,
        instrumentation,
        ...(textureDefaults ? { textureDefaults } : {}),
        expressionDefaults,
        tempoMotionDefaults,
        ornamentDefaults,
        motifPolicy: parseMotifPolicy(value.motifPolicy),
        sketch: parseCompositionSketch(value.sketch),
        longSpanForm: parseLongSpanFormPlan(value.longSpanForm ?? value.longRangeForm),
        ...(orchestration ? { orchestration } : {}),
        sections,
        rationale: compact(value.rationale) || rationale,
    });
}

function summarizePlannerPlan(
    request: ComposeRequest,
    selectedModels?: ModelBinding[],
): PlannerPlanSummary | undefined {
    const plan = request.compositionPlan;
    if (!plan) {
        return undefined;
    }

    const workflow = request.workflow ?? plan.workflow;
    const qualityPolicy = request.qualityPolicy ?? buildRecommendedQualityPolicy(
        request.form ?? plan.form,
        workflow,
    );
    const longSpan = plan.longSpanForm
        ? {
            expositionStartSectionId: plan.longSpanForm.expositionStartSectionId,
            expositionEndSectionId: plan.longSpanForm.expositionEndSectionId,
            developmentStartSectionId: plan.longSpanForm.developmentStartSectionId,
            developmentEndSectionId: plan.longSpanForm.developmentEndSectionId,
            retransitionSectionId: plan.longSpanForm.retransitionSectionId,
            recapStartSectionId: plan.longSpanForm.recapStartSectionId,
            returnSectionId: plan.longSpanForm.returnSectionId,
            delayedPayoffSectionId: plan.longSpanForm.delayedPayoffSectionId,
            expectedDevelopmentPressure: plan.longSpanForm.expectedDevelopmentPressure,
            expectedReturnPayoff: plan.longSpanForm.expectedReturnPayoff,
            thematicCheckpointCount: plan.longSpanForm.thematicCheckpoints?.length ?? 0,
            thematicTransforms: dedupe(
                (plan.longSpanForm.thematicCheckpoints ?? []).map((checkpoint) => checkpoint.transform),
                12,
            ) as PlannerPlanSummary["longSpan"] extends { thematicTransforms: infer T } ? T : never,
        }
        : undefined;
    const orchestration = summarizeOrchestrationPlan(plan.orchestration);

    return {
        workflow,
        titleHint: plan.titleHint,
        brief: plan.brief,
        form: plan.form,
        qualityProfile: classifyQualityProfile(request.form ?? plan.form),
        inspirationThread: plan.inspirationThread,
        intentRationale: plan.intentRationale,
        contrastTarget: plan.contrastTarget,
        riskProfile: plan.riskProfile,
        structureVisibility: plan.structureVisibility,
        humanizationStyle: plan.humanizationStyle,
        key: plan.key,
        tempo: plan.tempo,
        targetDurationSec: plan.targetDurationSec,
        targetMeasures: plan.targetMeasures,
        sectionCount: plan.sections.length,
        totalMeasures: plan.sections.reduce((sum, section) => sum + section.measures, 0),
        mood: plan.mood,
        instruments: dedupe(plan.instrumentation.map((instrument) => instrument.name), 12),
        selectedModels: dedupe(
            (selectedModels ?? []).map((binding) => `${binding.role}:${binding.provider}:${binding.model}`),
            12,
        ),
        qualityPolicy,
        longSpan,
        orchestration,
        sections: plan.sections.map((section) => ({
            id: section.id,
            role: section.role,
            label: section.label,
            measures: section.measures,
            cadence: section.cadence,
        })),
    };
}

function summarizeSuccessPatterns(preferences: AutonomyPreferences): string {
    if (!preferences.successPatterns?.length) {
        return "none";
    }

    return preferences.successPatterns
        .slice(0, 3)
        .map((pattern) => [pattern.form, pattern.key, pattern.humanizationStyle, `count=${pattern.count}`]
            .filter(Boolean)
            .join("/"))
        .join(", ");
}

function summarizeSkillGaps(preferences: AutonomyPreferences): string {
    if (!preferences.skillGaps?.length) {
        return "none";
    }

    return preferences.skillGaps
        .slice(0, 4)
        .map((gap) => `${gap.issue} (${gap.count}x)`)
        .join(", ");
}

function summarizeStyleTendency(preferences: AutonomyPreferences): string {
    const tendency = preferences.styleTendency;
    if (!tendency) {
        return "none";
    }

    const parts = [tendency.humanizationStyle, tendency.structureVisibility, tendency.riskProfile]
        .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "none";
}

function summarizeMotifReturns(preferences: AutonomyPreferences): string {
    if (!preferences.successfulMotifReturns?.length) {
        return "none";
    }

    return preferences.successfulMotifReturns
        .slice(0, 4)
        .map((pattern) => [
            pattern.form,
            `${pattern.sourceRole}->${pattern.targetRole}`,
            pattern.cadence,
            `count=${pattern.count}`,
        ].filter(Boolean).join("/"))
        .join(", ");
}

function summarizeTensionArcs(preferences: AutonomyPreferences): string {
    if (!preferences.successfulTensionArcs?.length) {
        return "none";
    }

    return preferences.successfulTensionArcs
        .slice(0, 3)
        .map((pattern) => [
            pattern.form,
            pattern.sectionRoles.join("->"),
            `[${pattern.values.map((value) => value.toFixed(2)).join(",")}]`,
            `count=${pattern.count}`,
        ].filter(Boolean).join("/"))
        .join(", ");
}

function summarizeRegisterCenters(preferences: AutonomyPreferences): string {
    if (!preferences.successfulRegisterCenters?.length) {
        return "none";
    }

    return preferences.successfulRegisterCenters
        .slice(0, 4)
        .map((pattern) => [
            pattern.form,
            pattern.role,
            `register=${pattern.registerCenter}`,
            `count=${pattern.count}`,
        ].filter(Boolean).join("/"))
        .join(", ");
}

function summarizeCadenceApproaches(preferences: AutonomyPreferences): string {
    if (!preferences.successfulCadenceApproaches?.length) {
        return "none";
    }

    return preferences.successfulCadenceApproaches
        .slice(0, 4)
        .map((pattern) => [
            pattern.form,
            pattern.role,
            pattern.cadence,
            pattern.cadenceApproach,
            `count=${pattern.count}`,
        ].filter(Boolean).join("/"))
        .join(", ");
}

function summarizeBassMotionProfiles(preferences: AutonomyPreferences): string {
    if (!preferences.successfulBassMotionProfiles?.length) {
        return "none";
    }

    return preferences.successfulBassMotionProfiles
        .slice(0, 4)
        .map((pattern) => [
            pattern.form,
            pattern.role,
            pattern.bassMotionProfile,
            `count=${pattern.count}`,
        ].filter(Boolean).join("/"))
        .join(", ");
}

function summarizeSectionStyles(preferences: AutonomyPreferences): string {
    if (!preferences.successfulSectionStyles?.length) {
        return "none";
    }

    return preferences.successfulSectionStyles
        .slice(0, 4)
        .map((pattern) => [
            pattern.form,
            pattern.role,
            pattern.sectionStyle,
            `count=${pattern.count}`,
        ].filter(Boolean).join("/"))
        .join(", ");
}

function decodeFallbackRawText(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) {
        return raw;
    }

    if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === "string") {
                return parsed;
            }
        } catch {
            // Fall through to a lighter unescape path.
        }
    }

    return trimmed
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\\"/g, "\"");
}

function normalizeFallbackLine(line: string): string {
    return compact(line.replace(/^[-*\d.\s]+/, "").replace(/^\"+|\"+$/g, ""));
}

function extractFallbackLines(raw: string): string[] {
    const decoded = decodeFallbackRawText(raw);
    const segments = decoded
        .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/)
        .map((line) => normalizeFallbackLine(line))
        .filter(Boolean);

    return dedupe(segments, 12);
}

function extractFallbackForm(text: string, preferences: AutonomyPreferences): string | undefined {
    for (const candidate of FALLBACK_FORM_PATTERNS) {
        if (candidate.patterns.some((pattern) => pattern.test(text))) {
            return candidate.form;
        }
    }

    return preferences.preferredForms[0] || undefined;
}

function extractFallbackKey(text: string, preferences: AutonomyPreferences): string | undefined {
    const explicitMatch = /(?:\bkey(?:\s+of)?\b|\bin\b)\s+([A-G](?:#|b)?\s+(?:major|minor))\b/i.exec(text);
    if (explicitMatch) {
        return compact(explicitMatch[1]);
    }

    const genericMatch = /\b([A-G](?:#|b)?\s+(?:major|minor))\b/i.exec(text);
    if (genericMatch) {
        return compact(genericMatch[1]);
    }

    return preferences.preferredKeys[0] || undefined;
}

function extractFallbackTempo(text: string): number | undefined {
    const bpmMatch = /(\d{2,3})\s*bpm\b/i.exec(text);
    if (bpmMatch) {
        return Number(bpmMatch[1]);
    }

    const tempoMatch = /\btempo(?:\s+of|\s*=|\s*:)?\s*(\d{2,3})\b/i.exec(text);
    if (tempoMatch) {
        return Number(tempoMatch[1]);
    }

    return undefined;
}

function extractFallbackDurationSec(text: string): number | undefined {
    const minuteMatch = /(\d{1,2})\s*(?:minutes?|mins?)\b/i.exec(text);
    if (minuteMatch) {
        return Number(minuteMatch[1]) * 60;
    }

    const secondMatch = /(\d{1,3})\s*(?:seconds?|secs?|sec|s)\b/i.exec(text);
    if (secondMatch) {
        return Number(secondMatch[1]);
    }

    return undefined;
}

function extractFallbackMeter(text: string): string | undefined {
    const meterMatch = /(?:\bmeter\b|\btime signature\b|\bin\b)\s*(?:of|=|:)?\s*([2-7]\/[248])\b/i.exec(text)
        ?? /\b([2-7]\/[248])\b/.exec(text);
    return meterMatch ? meterMatch[1] : undefined;
}

function extractFallbackHumanizationStyle(
    text: string,
    preferences: AutonomyPreferences,
): HumanizationStyle | undefined {
    if (/\b(expressive|espressivo|lyrical|singing)\b/i.test(text)) {
        return "expressive";
    }

    if (/\b(mechanical|precise|rigid|strict)\b/i.test(text)) {
        return "mechanical";
    }

    if (/\b(restrained|soft|gentle|veiled|intimate|chamber)\b/i.test(text)) {
        return "restrained";
    }

    return preferences.styleTendency?.humanizationStyle;
}

function extractFallbackStructureVisibility(text: string): StructureVisibility | undefined {
    if (/\b(hidden|veiled|oblique)\b/i.test(text)) {
        return "hidden";
    }

    if (/\b(complex|layered|intricate)\b/i.test(text)) {
        return "complex";
    }

    if (/\b(transparent|clear|explicit)\b/i.test(text)) {
        return "transparent";
    }

    return undefined;
}

function extractFallbackRiskProfile(text: string): PlanRiskProfile | undefined {
    if (/\b(experimental|risky|bold)\b/i.test(text)) {
        return "experimental";
    }

    if (/\b(exploratory|explore|contrast|test)\b/i.test(text)) {
        return "exploratory";
    }

    if (/\b(conservative|safe|repair|stabilize|clearer)\b/i.test(text)) {
        return "conservative";
    }

    return undefined;
}

function assignFallbackInstrumentRoles(name: string, index: number, total: number): TextureRole[] {
    if (total === 1) {
        if (name === "piano") {
            return ["lead", "pad", "bass"];
        }
        if (name === "cello") {
            return ["lead", "bass"];
        }
        return ["lead"];
    }

    if (name === "piano" || name === "harp" || name === "guitar") {
        return ["pad", "pulse", "bass"];
    }

    if (name === "cello") {
        return index === 0 ? ["lead", "counterline"] : ["bass", "counterline"];
    }

    if (index === 0) {
        return ["lead"];
    }

    return ["counterline"];
}

function extractFallbackInstrumentation(text: string): InstrumentAssignment[] {
    const detected = FALLBACK_INSTRUMENT_SPECS
        .map((spec) => {
            const index = spec.patterns
                .map((pattern) => pattern.exec(text)?.index)
                .filter((value): value is number => typeof value === "number")
                .sort((left, right) => left - right)[0];
            return index === undefined ? null : { index, spec };
        })
        .filter((entry): entry is { index: number; spec: typeof FALLBACK_INSTRUMENT_SPECS[number] } => entry !== null)
        .sort((left, right) => left.index - right.index);

    const unique = dedupe(detected.map((entry) => entry.spec.name), 8);
    return unique.map((name, index, values) => {
        const spec = FALLBACK_INSTRUMENT_SPECS.find((entry) => entry.name === name);
        return {
            name,
            family: spec?.family ?? "keyboard",
            roles: assignFallbackInstrumentRoles(name, index, values.length),
            register: spec?.register ?? "wide",
        } satisfies InstrumentAssignment;
    });
}

function extractFallbackMood(text: string): string[] {
    return dedupe(
        FALLBACK_MOOD_KEYWORDS.filter((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(text)),
        6,
    );
}

function extractFallbackGuidanceLine(lines: string[], matcher: RegExp): string | undefined {
    return lines.find((line) => matcher.test(line));
}

function extractFallbackWorkflow(text: string, form: string | undefined): ComposeWorkflow {
    if (/\baudio[_ -]?only\b|\brender(?:ed)? audio only\b/i.test(text)) {
        return coerceStructureFirstWorkflow(form, "audio_only");
    }

    if (/\bsymbolic[_ -]?plus[_ -]?audio\b/i.test(text) || /\b(audio|timbre|render(?:ed|ing)?|styled audio)\b/i.test(text)) {
        return coerceStructureFirstWorkflow(form, "symbolic_plus_audio");
    }

    return coerceStructureFirstWorkflow(form, DEFAULT_REQUEST_WORKFLOW);
}

function extractFallbackPlannerSignal(raw: string, preferences: AutonomyPreferences): FallbackPlannerSignal {
    const normalizedText = decodeFallbackRawText(raw);
    const lines = extractFallbackLines(raw);
    const searchableText = [normalizedText, ...lines].join(" ");
    const form = extractFallbackForm(searchableText, preferences);
    const key = extractFallbackKey(searchableText, preferences);
    const brief = lines[0] || compact(normalizedText).slice(0, 220);
    const prompt = brief
        ? brief.slice(0, 220)
        : `Write a concise ${form ?? preferences.preferredForms[0] ?? "miniature"} in ${key ?? preferences.preferredKeys[0] ?? "D minor"} with restrained motion and a clear closing cadence.`;

    return {
        normalizedText,
        lines,
        prompt,
        brief,
        form,
        key,
        tempo: extractFallbackTempo(searchableText),
        durationSec: extractFallbackDurationSec(searchableText),
        meter: extractFallbackMeter(searchableText),
        workflow: extractFallbackWorkflow(searchableText, form),
        humanizationStyle: extractFallbackHumanizationStyle(searchableText, preferences),
        structureVisibility: extractFallbackStructureVisibility(searchableText),
        riskProfile: extractFallbackRiskProfile(searchableText),
        instrumentation: extractFallbackInstrumentation(searchableText),
        mood: extractFallbackMood(searchableText),
        inspirationThread: extractFallbackGuidanceLine(lines, /\b(explore|refine|repair|focus|learn|test|push|develop|return|cadence|contrast)\b/i),
        contrastTarget: extractFallbackGuidanceLine(lines, /\b(avoid|contrast|different|instead|rather than|move away|not the recent)\b/i),
    };
}

function buildFallbackRationale(signal: FallbackPlannerSignal): string {
    const extracted = [
        signal.form ? "form" : "",
        signal.key ? "key" : "",
        signal.meter ? "meter" : "",
        signal.tempo ? "tempo" : "",
        signal.instrumentation.length > 0 ? "instrumentation" : "",
        signal.humanizationStyle ? "phrasing" : "",
    ].filter(Boolean);

    if (extracted.length === 0) {
        return "LLM 응답이 엄격한 JSON은 아니어서 fallback planner가 자유 텍스트와 preference memory를 조합했습니다.";
    }

    return `LLM 응답이 엄격한 JSON은 아니어서 fallback planner가 자유 텍스트에서 ${extracted.join(", ")} cue와 preference memory를 조합했습니다.`;
}

function buildPlannerPrompt(
    logs: string,
    manifests: JobManifest[],
    preferences: AutonomyPreferences,
    candidateSpec?: PlannerCandidateSpec,
): string {
    const longFormGuidance = buildFormGuidance("sonata");
    return `You are planning the next AXIOM composition request.
Return JSON only.

Required JSON schema:
{
  "request": {
    "prompt": "string",
    "key": "string or empty",
    "tempo": 72,
    "form": "string",
    "durationSec": 45,
    "workflow": "symbolic_only | symbolic_plus_audio | audio_only",
        "plannerVersion": "${DEFAULT_PLANNER_VERSION}",
        "qualityPolicy": {
            "enableAutoRevision": true,
            "maxStructureAttempts": 4,
            "targetStructureScore": 84,
            "targetAudioScore": 88
        }
  },
  "plan": {
    "version": "${DEFAULT_PLANNER_VERSION}",
    "brief": "string",
    "mood": ["item"],
    "form": "string",
        "inspirationThread": "what this piece is trying to explore",
        "intentRationale": "why this form/key/workflow was chosen now",
        "contrastTarget": "what should differ from recent work",
        "riskProfile": "conservative | exploratory | experimental",
        "structureVisibility": "transparent | hidden | complex",
        "humanizationStyle": "mechanical | restrained | expressive",
    "targetDurationSec": 45,
    "targetMeasures": 16,
    "meter": "4/4",
    "key": "string or empty",
    "tempo": 72,
    "workflow": "symbolic_only | symbolic_plus_audio | audio_only",
    "instrumentation": [{ "name": "piano", "family": "keyboard", "roles": ["lead", "pad"], "register": "wide" }],
    "expressionDefaults": {
        "dynamics": { "start": "p", "peak": "mf", "end": "p", "hairpins": [{ "shape": "crescendo", "startMeasure": 1, "endMeasure": 4, "target": "mf" }] },
        "articulation": ["legato"],
        "character": ["dolce"],
        "sustainBias": 0.2,
        "accentBias": 0.0
    },
    "tempoMotionDefaults": [{ "tag": "ritardando", "startMeasure": 13, "endMeasure": 16, "intensity": 0.55, "notes": ["Broaden into the cadence."] }],
    "ornamentDefaults": [{ "tag": "fermata", "startMeasure": 16, "targetBeat": 4, "intensity": 0.8, "notes": ["Hold the final cadence."] }],
    "motifPolicy": { "reuseRequired": true, "inversionAllowed": true, "augmentationAllowed": true, "diminutionAllowed": false, "sequenceAllowed": true },
    "longSpanForm": {
        "expositionStartSectionId": "s1",
        "expositionEndSectionId": "s2",
        "developmentStartSectionId": "s3",
        "developmentEndSectionId": "s3",
        "recapStartSectionId": "s4",
        "returnSectionId": "s4",
        "expectedDevelopmentPressure": "high",
        "expectedReturnPayoff": "clear",
        "thematicCheckpoints": [{ "sourceSectionId": "s1", "targetSectionId": "s3", "transform": "fragment", "expectedProminence": 0.7 }]
    },
    "sections": [{ "id": "s1", "role": "theme_a", "label": "Primary idea", "measures": 8, "energy": 0.4, "density": 0.35, "cadence": "half", "harmonicPlan": { "tonalCenter": "C minor", "prolongationMode": "tonic", "colorCues": [{ "tag": "suspension", "startMeasure": 6, "resolutionMeasure": 7, "notes": ["Delay the cadence release slightly."] }] }, "expression": { "articulation": ["legato"], "character": ["cantabile"], "phrasePeaks": [4] }, "tempoMotion": [{ "tag": "stringendo", "startMeasure": 5, "endMeasure": 8, "intensity": 0.4 }], "ornaments": [{ "tag": "fermata", "startMeasure": 8, "targetBeat": 4, "intensity": 0.7 }], "notes": ["item"] }],
    "rationale": "one short paragraph"
  },
  "selectedModels": [{ "role": "planner", "provider": "ollama", "model": "model-name" }],
  "rationale": "one short paragraph",
  "inspirationSnapshot": ["bullet", "bullet"]
}

Constraints:
- The music should feel classical or chamber-oriented.
- Avoid repeating the recent weak points and recent prompt hashes.
- Prefer underused combinations across form, key, meter, instrumentation, section role sequence, and humanizationStyle.
- Keep request.prompt concise but specific.
- plan.sections must contain at least 2 sections for non-miniature forms.
- Use selectedModels to explain which model handles planning, structure, and optional audio rendering.
- request.workflow and plan.workflow must agree.
- request.qualityPolicy must be adapted to the form family.
- plan.intentRationale must explain one concrete musical reason for the choice.
- plan.inspirationThread should state what this piece is trying to learn, refine, or contrast from recent work.
- plan.humanizationStyle should match the intended phrasing character.
- plan.expressionDefaults should describe the global dynamics, articulation, and character intent instead of relying on humanizationStyle alone.
- Use harmonicPlan.colorCues only for the first narrow harmonic-color tags mixture|applied_dominant|predominant_color|suspension; use keyTarget for applied-dominant targets, resolutionMeasure for suspension release, and keep pedal or deceptive behavior in existing prolongationMode or cadence fields.
- plan.tempoMotionDefaults and section tempoMotion should only be used for musically intentional local motion; section-level measure windows are relative to the section and may be omitted when the cue spans the whole section.
- plan.ornamentDefaults and section ornaments may use only supported ornament tags grace_note|trill|mordent|turn|arpeggio|fermata; use fermata for audible local-hold cues, arpeggio for explicit rolled chord arrivals, grace_note for short lead-ins on note-bearing arrivals, and trill for short upper-neighbor oscillation on note-bearing arrivals because the current runtime explicitly realizes those four tags first.
- For sonata and other longer multi-section forms, include plan.longSpanForm when there is a clear exposition/development/return design; the section ids in longSpanForm must match ids from plan.sections.
- Use only supported long-span transform tags inside plan.longSpanForm.thematicCheckpoints: repeat|sequence|fragment|revoice|destabilize|delay_return.
- Use only supported long-span expectation values: expectedDevelopmentPressure low|medium|high and expectedReturnPayoff subtle|clear|inevitable.
- At least one section must include an expression object, and for longer forms the opening, contrast or development, and closing or recap sections should each carry section-level expression cues.
- Use only supported expression tags: dynamics levels pp|p|mp|mf|f|ff; articulations legato|staccato|staccatissimo|tenuto|sostenuto|accent|marcato; and character tags dolce|dolcissimo|espressivo|cantabile|agitato|tranquillo|energico|grazioso|brillante|giocoso|leggiero|maestoso|scherzando|pastorale|tempestoso|appassionato|delicato.
- Use only supported tempo-motion tags: ritardando|rallentando|allargando|accelerando|stringendo|a_tempo|ritenuto|tempo_l_istesso.
- Use stricter targets for symphony, concerto, sonata, rondo, trio, quartet, and other chamber forms than for prelude, nocturne, and miniature forms.
- For sonata forms, plan.sections must include at least theme_a, development, and recap in that order, and the recap should return to the home key when tonalCenter is specified.
- For sonata forms, include section-level expression guidance for theme_a, development, and recap so the return is not only structural but also phrased intentionally.
- When form is sonata, prefer the following local planning cues: ${longFormGuidance.join(" ")}
- For audio_only, set targetAudioScore and keep maxStructureAttempts at 1; targetStructureScore may be omitted.
- For symbolic_only, audio target may be omitted.
- durationSec may be omitted for symbolic-only requests.
- Return JSON only with no markdown fences.

Candidate objective:
- candidateId=${candidateSpec?.id ?? "baseline"}
- candidateLabel=${candidateSpec?.label ?? "Baseline novelty pass"}
- candidateGuidance=${candidateSpec?.guidance ?? "Balance novelty and musical coherence using the preference memory below."}
- Make this candidate distinct from the most obvious safe default if musical coherence allows.

Preferences:
- preferredForms=${preferences.preferredForms.join(", ") || "none"}
- preferredKeys=${preferences.preferredKeys.join(", ") || "none"}
- recentWeaknesses=${preferences.recentWeaknesses.join(", ") || "none"}
- recentPromptHashes=${preferences.recentPromptHashes.join(", ") || "none"}
- recentPlanSignatures=${preferences.recentPlanSignatures.join(", ") || "none"}
- successPatterns=${summarizeSuccessPatterns(preferences)}
- skillGaps=${summarizeSkillGaps(preferences)}
- styleTendency=${summarizeStyleTendency(preferences)}
- successfulMotifReturns=${summarizeMotifReturns(preferences)}
- successfulTensionArcs=${summarizeTensionArcs(preferences)}
- successfulRegisterCenters=${summarizeRegisterCenters(preferences)}
- successfulCadenceApproaches=${summarizeCadenceApproaches(preferences)}
- successfulBassMotionProfiles=${summarizeBassMotionProfiles(preferences)}
- successfulSectionStyles=${summarizeSectionStyles(preferences)}
- lastReflection=${preferences.lastReflection || "none"}

Recent manifests:
${summarizeRecentManifests(manifests)}

Recent logs:
${logs}
`;
}

function fallbackPlanFromRaw(raw: string, preferences: AutonomyPreferences): ParsedPlannerCandidate {
    const signal = extractFallbackPlannerSignal(raw, preferences);
    const lines = signal.lines;
    const fallbackPrompt = signal.prompt;
    const rationale = buildFallbackRationale(signal);

    const baseRequest: ComposeRequest = {
        prompt: fallbackPrompt,
        key: signal.key ?? preferences.preferredKeys[0],
        tempo: signal.tempo ?? 72,
        form: signal.form ?? preferences.preferredForms[0] ?? "miniature",
        durationSec: signal.durationSec,
        workflow: signal.workflow,
        source: "autonomy",
        plannerVersion: DEFAULT_PLANNER_VERSION,
        targetInstrumentation: signal.instrumentation,
    };
    const compositionPlan = buildFallbackCompositionPlan(baseRequest, preferences, rationale, signal);
    const workflow = compositionPlan.workflow;
    const qualityPolicy = buildRecommendedQualityPolicy(compositionPlan.form, workflow);
    const request: ComposeRequest = ensureComposeRequestMetadata({
        ...baseRequest,
        workflow,
        durationSec: baseRequest.durationSec ?? compositionPlan.targetDurationSec,
        compositionPlan,
        targetInstrumentation: compositionPlan.instrumentation,
        selectedModels: plannerModelBindings(workflow),
        qualityPolicy,
    }, "autonomy");

    return {
        promptHash: request.promptHash ?? computePromptHash(request),
        request,
        rationale,
        inspirationSnapshot: dedupe(lines.slice(0, 4), 4),
        parserMode: "fallback",
        rawResponse: raw,
    };
}

function buildAssessmentPrompt(manifest: JobManifest): string {
    const artifacts = Object.entries(manifest.artifacts)
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key)
        .join(", ");

    return `You are evaluating a completed AXIOM composition run.
Return JSON only.

Required JSON schema:
{
  "summary": "one short paragraph",
  "qualityScore": 7.4,
  "strengths": ["item"],
  "weaknesses": ["item"],
    "tags": ["item"],
    "reflection": "one short sentence about what the system should remember next time",
    "nextFocus": ["item"]
}

Manifest summary:
- songId=${manifest.songId}
- state=${manifest.state}
- prompt=${manifest.meta.prompt}
- key=${manifest.meta.key ?? "?"}
- tempo=${manifest.meta.tempo ?? "?"}
- form=${manifest.meta.form ?? "?"}
- inspirationThread=${manifest.meta.inspirationThread ?? "none"}
- intentRationale=${manifest.meta.intentRationale ?? "none"}
- contrastTarget=${manifest.meta.contrastTarget ?? "none"}
- riskProfile=${manifest.meta.riskProfile ?? "none"}
- structureVisibility=${manifest.meta.structureVisibility ?? "none"}
- humanizationStyle=${manifest.meta.humanizationStyle ?? "none"}
- source=${manifest.meta.source ?? "api"}
- artifacts=${artifacts || "none"}
- error=${manifest.errorMessage ?? "none"}
- structureEvaluation=${manifest.structureEvaluation
            ? `passed=${manifest.structureEvaluation.passed}; score=${manifest.structureEvaluation.score ?? "?"}; issues=${manifest.structureEvaluation.issues.join(", ") || "none"}`
            : "none"}
- audioEvaluation=${manifest.audioEvaluation
            ? `passed=${manifest.audioEvaluation.passed}; score=${manifest.audioEvaluation.score ?? "?"}; issues=${manifest.audioEvaluation.issues.join(", ") || "none"}`
            : "none"}

Evaluate musical plausibility, diversity from recent work, and production completeness.
Keep the response concise and grounded in the metadata above.`;
}

function parsePlannerResponse(raw: string, preferences: AutonomyPreferences): ParsedPlannerCandidate {
    const parsed = extractJsonObject(raw);
    if (!parsed) {
        return fallbackPlanFromRaw(raw, preferences);
    }

    const requestSource = isRecord(parsed.request) ? parsed.request : parsed;
    const rawWorkflow = parseWorkflow(requestSource.workflow);
    const rationale = compact(parsed.rationale)
        || compact(isRecord(parsed.plan) ? parsed.plan.rationale : undefined)
        || "Recent output patterns and preference memory were used to diversify the next piece.";

    const baseRequest: ComposeRequest = {
        prompt: compact(requestSource.prompt) || "Write a short reflective piano miniature with restrained dynamics.",
        key: compact(requestSource.key) || undefined,
        tempo: finiteNumber(requestSource.tempo),
        form: compact(requestSource.form) || preferences.preferredForms[0] || undefined,
        durationSec: finiteNumber(requestSource.durationSec),
        workflow: rawWorkflow,
        source: "autonomy",
        plannerVersion: compact(requestSource.plannerVersion) || DEFAULT_PLANNER_VERSION,
    };
    const compositionPlan = parseCompositionPlan(parsed.plan, baseRequest, preferences, rationale);
    const workflow = coerceStructureFirstWorkflow(
        baseRequest.form ?? compositionPlan.form,
        rawWorkflow ?? compositionPlan.workflow ?? DEFAULT_REQUEST_WORKFLOW,
    );
    const selectedModels = parseModelBindings(parsed.selectedModels, workflow);
    const qualityPolicy = parseQualityPolicy(
        requestSource.qualityPolicy ?? parsed.qualityPolicy,
        baseRequest.form ?? compositionPlan.form,
        workflow,
    );
    const request: ComposeRequest = ensureComposeRequestMetadata({
        ...baseRequest,
        key: baseRequest.key ?? compositionPlan.key,
        tempo: baseRequest.tempo ?? compositionPlan.tempo,
        form: baseRequest.form ?? compositionPlan.form,
        durationSec: baseRequest.durationSec ?? compositionPlan.targetDurationSec,
        workflow,
        compositionPlan: {
            ...compositionPlan,
            workflow,
        },
        targetInstrumentation: compositionPlan.instrumentation,
        selectedModels,
        plannerVersion: baseRequest.plannerVersion ?? compositionPlan.version,
        qualityPolicy,
    }, "autonomy");

    return {
        promptHash: request.promptHash ?? computePromptHash(request),
        request,
        rationale,
        inspirationSnapshot: stringArray(parsed.inspirationSnapshot, 6),
        parserMode: "structured_json",
        rawResponse: raw,
    };
}

function parseAssessmentResponse(raw: string): SelfAssessment {
    const parsed = extractJsonObject(raw);
    if (!parsed) {
        return {
            generatedAt: new Date().toISOString(),
            summary: raw.trim().slice(0, 400) || "Self-assessment unavailable",
            strengths: [],
            weaknesses: [],
            tags: [],
            raw,
        };
    }

    return {
        generatedAt: new Date().toISOString(),
        summary: compact(parsed.summary) || "Self-assessment generated without a summary.",
        qualityScore: typeof parsed.qualityScore === "number" && Number.isFinite(parsed.qualityScore)
            ? parsed.qualityScore
            : undefined,
        strengths: Array.isArray(parsed.strengths)
            ? dedupe(parsed.strengths.map((item) => String(item ?? "")), 6)
            : [],
        weaknesses: Array.isArray(parsed.weaknesses)
            ? dedupe(parsed.weaknesses.map((item) => String(item ?? "")), 6)
            : [],
        tags: Array.isArray(parsed.tags)
            ? dedupe(parsed.tags.map((item) => String(item ?? "")), 6)
            : [],
        reflection: compact(parsed.reflection) || undefined,
        nextFocus: Array.isArray(parsed.nextFocus)
            ? dedupe(parsed.nextFocus.map((item) => String(item ?? "")), 6)
            : [],
        raw,
    };
}

function takeTop(values: string[], limit: number): string[] {
    const counts = new Map<string, number>();
    for (const value of values.map((item) => compact(item)).filter(Boolean)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([value]) => value);
}

function updateSuccessPatterns(
    existing: AutonomySuccessPattern[] | undefined,
    manifest: JobManifest,
    request?: ComposeRequest,
): AutonomySuccessPattern[] {
    const form = request?.compositionPlan?.form ?? manifest.meta.form;
    const key = request?.compositionPlan?.key ?? manifest.meta.key;
    const humanizationStyle = request?.compositionPlan?.humanizationStyle ?? manifest.meta.humanizationStyle;

    if (!form && !key && !humanizationStyle) {
        return existing ?? [];
    }

    const bucket = new Map<string, AutonomySuccessPattern>();
    for (const pattern of existing ?? []) {
        const patternKey = [pattern.form ?? "", pattern.key ?? "", pattern.humanizationStyle ?? ""].join("|");
        bucket.set(patternKey, { ...pattern });
    }

    const nextKey = [form ?? "", key ?? "", humanizationStyle ?? ""].join("|");
    const current = bucket.get(nextKey);
    bucket.set(nextKey, {
        form,
        key,
        humanizationStyle,
        count: (current?.count ?? 0) + 1,
    });

    return Array.from(bucket.values())
        .sort((left, right) => right.count - left.count || compact(left.form).localeCompare(compact(right.form)))
        .slice(0, 6);
}

function updateSkillGaps(existing: AutonomySkillGap[] | undefined, manifest: JobManifest): AutonomySkillGap[] {
    const bucket = new Map<string, AutonomySkillGap>();
    for (const gap of existing ?? []) {
        bucket.set(gap.issue, { ...gap });
    }

    for (const issue of manifest.selfAssessment?.weaknesses ?? []) {
        const normalized = compact(issue);
        if (!normalized) {
            continue;
        }

        const current = bucket.get(normalized);
        bucket.set(normalized, {
            issue: normalized,
            count: (current?.count ?? 0) + 1,
            lastSeen: manifest.updatedAt,
        });
    }

    return Array.from(bucket.values())
        .sort((left, right) => right.count - left.count || right.lastSeen.localeCompare(left.lastSeen))
        .slice(0, 8);
}

function deriveStyleTendency(manifest: JobManifest, request?: ComposeRequest): AutonomyStyleTendency | undefined {
    const plan = request?.compositionPlan;
    const humanizationStyle = plan?.humanizationStyle ?? manifest.meta.humanizationStyle;
    const structureVisibility = plan?.structureVisibility ?? manifest.meta.structureVisibility;
    const riskProfile = plan?.riskProfile ?? manifest.meta.riskProfile;

    if (!humanizationStyle && !structureVisibility && !riskProfile) {
        return undefined;
    }

    return {
        humanizationStyle,
        structureVisibility,
        riskProfile,
    };
}

function isSuccessfulMemorySource(manifest: JobManifest): boolean {
    if (manifest.state !== "DONE") {
        return false;
    }

    if (manifest.approvalStatus === "approved") {
        return true;
    }

    if (manifest.structureEvaluation?.passed) {
        return true;
    }

    if ((manifest.structureEvaluation?.score ?? 0) >= 76) {
        return true;
    }

    return (manifest.selfAssessment?.qualityScore ?? 0) >= 7;
}

function deriveSectionTensionValue(section: SectionPlan): number {
    if (typeof section.harmonicPlan?.tensionTarget === "number") {
        return Math.min(Math.max(section.harmonicPlan.tensionTarget, 0), 1);
    }

    return Number(Math.min(Math.max((section.energy * 0.65) + (section.density * 0.35), 0), 1).toFixed(4));
}

function mergeSectionNotes(section: SectionPlan, additions: string[]): string[] | undefined {
    const merged = Array.from(new Set([...(section.notes ?? []), ...additions.map((value) => compact(value)).filter(Boolean)]));
    return merged.length > 0 ? merged : undefined;
}

function preferredRegisterCenter(
    preferences: AutonomyPreferences,
    form: string | undefined,
    role: SectionRole,
): number | undefined {
    const patterns = preferences.successfulRegisterCenters ?? [];
    if (patterns.length === 0) {
        return undefined;
    }

    return patterns
        .filter((pattern) => pattern.role === role && (!pattern.form || pattern.form === form))
        .sort((left, right) => right.count - left.count || compact(left.form).localeCompare(compact(right.form)))[0]
        ?.registerCenter;
}

function preferredCadenceApproach(
    preferences: AutonomyPreferences,
    form: string | undefined,
    role: SectionRole,
): AutonomyCadenceApproachPattern | undefined {
    const patterns = preferences.successfulCadenceApproaches ?? [];
    return patterns
        .filter((pattern) => pattern.role === role && (!pattern.form || pattern.form === form))
        .sort((left, right) => right.count - left.count || compact(left.cadence).localeCompare(compact(right.cadence)))[0];
}

function preferredBassMotionProfile(
    preferences: AutonomyPreferences,
    form: string | undefined,
    role: SectionRole,
): AutonomyBassMotionPattern | undefined {
    const patterns = preferences.successfulBassMotionProfiles ?? [];
    return patterns
        .filter((pattern) => pattern.role === role && (!pattern.form || pattern.form === form))
        .sort((left, right) => right.count - left.count || left.bassMotionProfile.localeCompare(right.bassMotionProfile))[0];
}

function preferredSectionStyle(
    preferences: AutonomyPreferences,
    form: string | undefined,
    role: SectionRole,
): AutonomySectionStylePattern | undefined {
    const patterns = preferences.successfulSectionStyles ?? [];
    return patterns
        .filter((pattern) => pattern.role === role && (!pattern.form || pattern.form === form))
        .sort((left, right) => right.count - left.count || compact(left.sectionStyle).localeCompare(compact(right.sectionStyle)))[0];
}

function bassMotionPreferenceNote(profile: AutonomyBassMotionPattern["bassMotionProfile"]): string {
    if (profile === "pedal") {
        return "Keep the bass anchored with pedal-like support under the section instead of moving every bar.";
    }
    if (profile === "stepwise") {
        return "Favor mostly stepwise bass motion so the section feels connected and directional.";
    }
    if (profile === "leaping") {
        return "Allow wider bass skips at phrase pivots so the section has stronger propulsion.";
    }
    return "Blend short stepwise bass motion with occasional skips so the support stays flexible.";
}

function sectionStylePreferenceNote(style: string): string {
    const normalized = compact(style).toLowerCase();
    if (normalized === "block") {
        return "Shape the accompaniment in a more block-chord profile so the section lands firmly.";
    }
    if (normalized === "broken") {
        return "Favor a broken-chord accompaniment profile so the section breathes without turning static.";
    }
    if (normalized === "arpeggio") {
        return "Lean on an arpeggiated accompaniment profile so the section keeps a flowing inner motion.";
    }
    if (normalized === "march") {
        return "Use a firmer march-like accompaniment profile so the section projects clear forward pulse.";
    }
    if (normalized === "waltz") {
        return "Shape the accompaniment with a waltz-like lilt so the section keeps a circular sway.";
    }
    return `Favor a ${normalized} accompaniment profile in this section.`;
}

function applyPreferenceBiasToSections(
    sections: SectionPlan[],
    preferences: AutonomyPreferences,
    form: string | undefined,
): SectionPlan[] {
    return sections.map((section) => {
        const next: SectionPlan = {
            ...section,
            notes: section.notes ? [...section.notes] : undefined,
            harmonicPlan: section.harmonicPlan ? { ...section.harmonicPlan } : undefined,
        };

        const rememberedRegister = preferredRegisterCenter(preferences, form, section.role);
        if (next.registerCenter === undefined && rememberedRegister !== undefined) {
            next.registerCenter = rememberedRegister;
            next.notes = mergeSectionNotes(next, [
                `Recent successful ${section.role} sections centered around register ${rememberedRegister}.`,
            ]);
        }

        const rememberedCadence = preferredCadenceApproach(preferences, form, section.role);
        if (rememberedCadence) {
            if (!next.cadence && rememberedCadence.cadence) {
                next.cadence = rememberedCadence.cadence;
            }
            if (!next.harmonicPlan?.cadence && rememberedCadence.cadence) {
                next.harmonicPlan = {
                    ...(next.harmonicPlan ?? {}),
                    cadence: rememberedCadence.cadence,
                };
            }

            const approachNote = rememberedCadence.cadenceApproach === "plagal"
                ? "Favor a plagal bass approach in the close."
                : rememberedCadence.cadenceApproach === "dominant"
                    ? "Favor a dominant-preparation bass approach in the close."
                    : rememberedCadence.cadenceApproach === "tonic"
                        ? "Keep the bass arrival centered tightly on tonic support."
                        : "Keep the bass approach intentional before the landing.";
            next.notes = mergeSectionNotes(next, [approachNote]);
        }

        const rememberedBassMotion = preferredBassMotionProfile(preferences, form, section.role);
        if (rememberedBassMotion) {
            next.notes = mergeSectionNotes(next, [bassMotionPreferenceNote(rememberedBassMotion.bassMotionProfile)]);
        }

        const rememberedSectionStyle = preferredSectionStyle(preferences, form, section.role);
        if (rememberedSectionStyle) {
            next.notes = mergeSectionNotes(next, [sectionStylePreferenceNote(rememberedSectionStyle.sectionStyle)]);
        }

        return next;
    });
}

function normalizedSectionFindingScore(score: unknown): number | undefined {
    if (typeof score !== "number" || !Number.isFinite(score)) {
        return undefined;
    }

    return score > 1 ? score / 100 : score;
}

function shouldStoreSectionArtifactPattern(finding: { score?: number; issues?: string[] } | undefined): boolean {
    const normalizedScore = normalizedSectionFindingScore(finding?.score);
    if (typeof normalizedScore === "number" && normalizedScore < 0.74) {
        return false;
    }

    return (finding?.issues?.length ?? 0) < 3;
}

function updateSuccessfulRegisterCenters(
    existing: AutonomyRegisterCenterPattern[] | undefined,
    manifest: JobManifest,
    request?: ComposeRequest,
): AutonomyRegisterCenterPattern[] {
    const plan = request?.compositionPlan;
    if (!plan || !isSuccessfulMemorySource(manifest) || !manifest.sectionArtifacts?.length) {
        return existing ?? [];
    }

    const artifactById = new Map((manifest.sectionArtifacts ?? []).map((artifact) => [artifact.sectionId, artifact]));
    const sectionFindingById = new Map((manifest.structureEvaluation?.sectionFindings ?? []).map((finding) => [finding.sectionId, finding]));
    const bucket = new Map<string, AutonomyRegisterCenterPattern>();
    for (const pattern of existing ?? []) {
        bucket.set([pattern.form ?? "", pattern.role].join("|"), { ...pattern });
    }

    for (const section of plan.sections) {
        const artifact = artifactById.get(section.id);
        const realizedRegister = typeof artifact?.realizedRegisterCenter === "number"
            ? artifact.realizedRegisterCenter
            : undefined;
        if (realizedRegister === undefined) {
            continue;
        }

        const registerFit = sectionFindingById.get(section.id)?.metrics?.registerCenterFit;
        if (typeof registerFit === "number" && registerFit < 0.78) {
            continue;
        }

        const patternKey = [plan.form ?? "", section.role].join("|");
        const current = bucket.get(patternKey);
        if (!current) {
            bucket.set(patternKey, {
                form: plan.form,
                role: section.role,
                registerCenter: realizedRegister,
                count: 1,
            });
            continue;
        }

        const nextCount = current.count + 1;
        bucket.set(patternKey, {
            form: current.form,
            role: current.role,
            registerCenter: Math.round((((current.registerCenter * current.count) + realizedRegister) / nextCount)),
            count: nextCount,
        });
    }

    return Array.from(bucket.values())
        .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role))
        .slice(0, 10);
}

function updateSuccessfulCadenceApproaches(
    existing: AutonomyCadenceApproachPattern[] | undefined,
    manifest: JobManifest,
    request?: ComposeRequest,
): AutonomyCadenceApproachPattern[] {
    const plan = request?.compositionPlan;
    if (!plan || !isSuccessfulMemorySource(manifest) || !manifest.sectionArtifacts?.length) {
        return existing ?? [];
    }

    const artifactById = new Map((manifest.sectionArtifacts ?? []).map((artifact) => [artifact.sectionId, artifact]));
    const sectionFindingById = new Map((manifest.structureEvaluation?.sectionFindings ?? []).map((finding) => [finding.sectionId, finding]));
    const bucket = new Map<string, AutonomyCadenceApproachPattern>();
    for (const pattern of existing ?? []) {
        bucket.set([pattern.form ?? "", pattern.role, pattern.cadence ?? "", pattern.cadenceApproach].join("|"), { ...pattern });
    }

    for (const section of plan.sections) {
        const cadence = section.harmonicPlan?.cadence ?? section.cadence;
        const artifact = artifactById.get(section.id);
        const cadenceApproach = artifact?.cadenceApproach;
        if (!cadence || !cadenceApproach || cadenceApproach === "other") {
            continue;
        }

        const approachFit = sectionFindingById.get(section.id)?.metrics?.cadenceApproachFit;
        if (typeof approachFit === "number" && approachFit < 0.78) {
            continue;
        }

        const patternKey = [plan.form ?? "", section.role, cadence, cadenceApproach].join("|");
        const current = bucket.get(patternKey);
        bucket.set(patternKey, {
            form: plan.form,
            role: section.role,
            cadence,
            cadenceApproach,
            count: (current?.count ?? 0) + 1,
        });
    }

    return Array.from(bucket.values())
        .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role))
        .slice(0, 10);
}

function updateSuccessfulBassMotionProfiles(
    existing: AutonomyBassMotionPattern[] | undefined,
    manifest: JobManifest,
    request?: ComposeRequest,
): AutonomyBassMotionPattern[] {
    const plan = request?.compositionPlan;
    if (!plan || !isSuccessfulMemorySource(manifest) || !manifest.sectionArtifacts?.length) {
        return existing ?? [];
    }

    const artifactById = new Map((manifest.sectionArtifacts ?? []).map((artifact) => [artifact.sectionId, artifact]));
    const sectionFindingById = new Map((manifest.structureEvaluation?.sectionFindings ?? []).map((finding) => [finding.sectionId, finding]));
    const bucket = new Map<string, AutonomyBassMotionPattern>();
    for (const pattern of existing ?? []) {
        bucket.set([pattern.form ?? "", pattern.role, pattern.bassMotionProfile].join("|"), { ...pattern });
    }

    for (const section of plan.sections) {
        const bassMotionProfile = artifactById.get(section.id)?.bassMotionProfile;
        if (!bassMotionProfile || !shouldStoreSectionArtifactPattern(sectionFindingById.get(section.id))) {
            continue;
        }

        const patternKey = [plan.form ?? "", section.role, bassMotionProfile].join("|");
        const current = bucket.get(patternKey);
        bucket.set(patternKey, {
            form: plan.form,
            role: section.role,
            bassMotionProfile,
            count: (current?.count ?? 0) + 1,
        });
    }

    return Array.from(bucket.values())
        .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role))
        .slice(0, 12);
}

function updateSuccessfulSectionStyles(
    existing: AutonomySectionStylePattern[] | undefined,
    manifest: JobManifest,
    request?: ComposeRequest,
): AutonomySectionStylePattern[] {
    const plan = request?.compositionPlan;
    if (!plan || !isSuccessfulMemorySource(manifest) || !manifest.sectionArtifacts?.length) {
        return existing ?? [];
    }

    const artifactById = new Map((manifest.sectionArtifacts ?? []).map((artifact) => [artifact.sectionId, artifact]));
    const sectionFindingById = new Map((manifest.structureEvaluation?.sectionFindings ?? []).map((finding) => [finding.sectionId, finding]));
    const bucket = new Map<string, AutonomySectionStylePattern>();
    for (const pattern of existing ?? []) {
        bucket.set([pattern.form ?? "", pattern.role, pattern.sectionStyle].join("|"), { ...pattern });
    }

    for (const section of plan.sections) {
        const sectionStyle = compact(artifactById.get(section.id)?.sectionStyle);
        if (!sectionStyle || !shouldStoreSectionArtifactPattern(sectionFindingById.get(section.id))) {
            continue;
        }

        const patternKey = [plan.form ?? "", section.role, sectionStyle].join("|");
        const current = bucket.get(patternKey);
        bucket.set(patternKey, {
            form: plan.form,
            role: section.role,
            sectionStyle,
            count: (current?.count ?? 0) + 1,
        });
    }

    return Array.from(bucket.values())
        .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role))
        .slice(0, 12);
}

function updateSuccessfulMotifReturns(
    existing: AutonomyMotifReturnPattern[] | undefined,
    manifest: JobManifest,
    request?: ComposeRequest,
): AutonomyMotifReturnPattern[] {
    const plan = request?.compositionPlan;
    if (!plan || !isSuccessfulMemorySource(manifest)) {
        return existing ?? [];
    }

    const sectionById = new Map(plan.sections.map((section) => [section.id, section]));
    const bucket = new Map<string, AutonomyMotifReturnPattern>();
    for (const pattern of existing ?? []) {
        const patternKey = [pattern.form ?? "", pattern.sourceRole, pattern.targetRole, pattern.cadence ?? ""].join("|");
        bucket.set(patternKey, { ...pattern });
    }

    for (const section of plan.sections) {
        const motifRef = compact(section.motifRef);
        if (!motifRef) {
            continue;
        }

        const sourceSection = sectionById.get(motifRef);
        if (!sourceSection) {
            continue;
        }

        const patternKey = [plan.form ?? "", sourceSection.role, section.role, section.cadence ?? ""].join("|");
        const current = bucket.get(patternKey);
        bucket.set(patternKey, {
            form: plan.form,
            sourceRole: sourceSection.role,
            targetRole: section.role,
            cadence: section.cadence,
            count: (current?.count ?? 0) + 1,
        });
    }

    return Array.from(bucket.values())
        .sort((left, right) => right.count - left.count || left.sourceRole.localeCompare(right.sourceRole))
        .slice(0, 8);
}

function updateSuccessfulTensionArcs(
    existing: AutonomyTensionArcPattern[] | undefined,
    manifest: JobManifest,
    request?: ComposeRequest,
): AutonomyTensionArcPattern[] {
    const plan = request?.compositionPlan;
    if (!plan || plan.sections.length < 2 || !isSuccessfulMemorySource(manifest)) {
        return existing ?? [];
    }

    const mismatch = manifest.structureEvaluation?.metrics?.tensionArcMismatch;
    if (typeof mismatch === "number" && mismatch > 0.2) {
        return existing ?? [];
    }

    const values = plan.sections.map((section) => deriveSectionTensionValue(section));
    const sectionRoles = plan.sections.map((section) => section.role);
    const bucket = new Map<string, AutonomyTensionArcPattern>();
    for (const pattern of existing ?? []) {
        const patternKey = [pattern.form ?? "", pattern.sectionRoles.join(",")].join("|");
        bucket.set(patternKey, {
            ...pattern,
            values: [...pattern.values],
            sectionRoles: [...pattern.sectionRoles],
        });
    }

    const nextKey = [plan.form ?? "", sectionRoles.join(",")].join("|");
    const current = bucket.get(nextKey);
    if (!current) {
        bucket.set(nextKey, {
            form: plan.form,
            sectionRoles,
            values,
            count: 1,
        });
    } else {
        const nextCount = current.count + 1;
        const averagedValues = values.map((value, index) => Number(((((current.values[index] ?? value) * current.count) + value) / nextCount).toFixed(4)));
        bucket.set(nextKey, {
            form: current.form,
            sectionRoles: current.sectionRoles,
            values: averagedValues,
            count: nextCount,
        });
    }

    return Array.from(bucket.values())
        .sort((left, right) => right.count - left.count || compact(left.form).localeCompare(compact(right.form)))
        .slice(0, 6);
}

function ledgerStatusFromManifest(manifest: JobManifest): AutonomyLedgerEntry["status"] {
    if (manifest.state === "FAILED") {
        return "failed";
    }

    if (manifest.approvalStatus === "approved") {
        return "approved";
    }

    if (manifest.approvalStatus === "rejected") {
        return "rejected";
    }

    return "pending_approval";
}

function updateLedgerEntry(
    dayKey: string,
    runId: string,
    updater: (entry: AutonomyLedgerEntry) => AutonomyLedgerEntry,
): AutonomyLedgerEntry | null {
    const ledger = loadAutonomyRunLedger(dayKey);
    let updated: AutonomyLedgerEntry | null = null;
    const next = ledger.map((entry) => {
        if (entry.runId !== runId) {
            return entry;
        }

        updated = updater(entry);
        return updated;
    });

    if (!updated) {
        return null;
    }

    saveAutonomyRunLedger(dayKey, next);
    return updated;
}

function updateLedgerStatus(
    dayKey: string,
    runId: string,
    patch: Partial<AutonomyLedgerEntry>,
): AutonomyLedgerEntry | null {
    return updateLedgerEntry(dayKey, runId, (entry) => ({
        ...entry,
        ...patch,
    }));
}

function setControlState(next: AutonomyControlState): AutonomyControlState {
    saveAutonomyControlState(next);
    return next;
}

export function getAutonomyControlState(): AutonomyControlState {
    return loadAutonomyControlState();
}

function toPendingApprovalSummary(manifest: JobManifest): PendingApprovalSummary {
    return {
        songId: manifest.songId,
        runId: manifest.meta.autonomyRunId,
        prompt: manifest.meta.prompt,
        form: manifest.meta.form,
        updatedAt: manifest.updatedAt,
        qualityScore: manifest.selfAssessment?.qualityScore,
        longSpan: manifest.structureEvaluation?.longSpan,
        longSpanDivergence: summarizeLongSpanDivergence(
            manifest.structureEvaluation?.longSpan,
            manifest.audioEvaluation?.longSpan,
            manifest.audioEvaluation,
            manifest.structureEvaluation,
        ),
        approvalStatus: manifest.approvalStatus ?? "pending",
        plannerTelemetry: manifest.meta.plannerTelemetry,
    };
}

export function listPendingApprovalManifests(limit = 20): JobManifest[] {
    return listStoredManifests()
        .filter((manifest) => (
            manifest.meta.source === "autonomy"
            && manifest.state === "DONE"
            && manifest.approvalStatus === "pending"
        ))
        .slice(0, limit);
}

export function listPendingApprovalSummaries(limit = 20): PendingApprovalSummary[] {
    return listPendingApprovalManifests(limit).map(toPendingApprovalSummary);
}

export function findDuplicateAutonomyPrompt(promptHash: string): AutonomyLedgerEntry | null {
    return loadAutonomyRunLedger(todayKey()).find((entry) => (
        entry.promptHash === promptHash
        && ["queued", "running", "retry_scheduled", "pending_approval", "approved"].includes(entry.status)
    )) ?? null;
}

export function findDuplicateAutonomyPlanSignature(planSignature: string): AutonomyLedgerEntry | null {
    return loadAutonomyRunLedger(todayKey()).find((entry) => (
        entry.planSignature === planSignature
        && DUPLICATE_PLAN_STATUSES.has(entry.status)
    )) ?? null;
}

export function pauseAutonomy(reason?: string, auditContext?: AutonomyOperatorMutationContext): AutonomyControlState {
    const current = loadAutonomyControlState();
    const next = setControlState({
        ...current,
        paused: true,
        pauseReason: compact(reason) || current.pauseReason || "manual_pause",
        updatedAt: new Date().toISOString(),
    });
    if (auditContext) {
        recordAutonomyOperatorAction({
            context: auditContext,
            action: "pause",
            reason: compact(reason) || next.pauseReason,
            input: {
                reason: compact(reason) || undefined,
            },
            before: summarizeControlState(current),
            after: summarizeControlState(next),
            artifactLinks: [outputArtifactLink("_system", "state.json")],
            observedAt: next.updatedAt,
        });
    }
    logger.info("Autonomy paused", { reason: next.pauseReason, activeRun: next.activeRun?.runId });
    return next;
}

export function resumeAutonomy(auditContext?: AutonomyOperatorMutationContext): AutonomyControlState {
    const current = loadAutonomyControlState();
    const next = setControlState({
        ...current,
        paused: false,
        pauseReason: undefined,
        updatedAt: new Date().toISOString(),
    });
    if (auditContext) {
        recordAutonomyOperatorAction({
            context: auditContext,
            action: "resume",
            reason: compact(current.pauseReason) || undefined,
            input: {},
            before: summarizeControlState(current),
            after: summarizeControlState(next),
            artifactLinks: [outputArtifactLink("_system", "state.json")],
            observedAt: next.updatedAt,
        });
    }
    logger.info("Autonomy resumed", { activeRun: next.activeRun?.runId });
    return next;
}

export function acquireAutonomyRunLock(plan: AutonomyPlan): AutonomyControlState {
    const current = loadAutonomyControlState();
    if (current.paused) {
        throw new AutonomyConflictError("autonomy is paused", {
            pauseReason: current.pauseReason,
        });
    }

    if (current.activeRun) {
        throw new AutonomyConflictError("another autonomy run is active", {
            activeRun: current.activeRun,
        });
    }

    const now = new Date().toISOString();
    const next = setControlState({
        ...current,
        updatedAt: now,
        activeRun: {
            runId: plan.runId,
            promptHash: plan.promptHash,
            acquiredAt: now,
            state: "queued",
        },
    });
    logger.info("Autonomy run lock acquired", { runId: plan.runId, promptHash: plan.promptHash });
    return next;
}

function updateAutonomyRunLock(
    runId: string,
    patch: Partial<AutonomyControlState["activeRun"]>,
): AutonomyControlState | null {
    const current = loadAutonomyControlState();
    if (!current.activeRun || current.activeRun.runId !== runId) {
        return null;
    }

    return setControlState({
        ...current,
        updatedAt: new Date().toISOString(),
        activeRun: {
            ...current.activeRun,
            ...patch,
        },
    });
}

export function releaseAutonomyRunLock(runId: string): AutonomyControlState | null {
    const current = loadAutonomyControlState();
    if (!current.activeRun || current.activeRun.runId !== runId) {
        return null;
    }

    const next = setControlState({
        ...current,
        updatedAt: new Date().toISOString(),
        activeRun: undefined,
    });
    logger.info("Autonomy run lock released", { runId });
    return next;
}

export function updateAutonomyPreferencesFromManifest(
    manifest: JobManifest,
    request?: ComposeRequest,
): AutonomyPreferences {
    const current = loadAutonomyPreferences();
    const nextStyleTendency = deriveStyleTendency(manifest, request) ?? current.styleTendency;
    const recentPlanSignature = request ? buildPlanSignature(request) : "";
    const next: AutonomyPreferences = {
        updatedAt: new Date().toISOString(),
        reviewedSongs: current.reviewedSongs + 1,
        preferredForms: takeTop([...(current.preferredForms ?? []), manifest.meta.form ?? ""], 5),
        preferredKeys: takeTop([...(current.preferredKeys ?? []), manifest.meta.key ?? ""], 5),
        recentWeaknesses: dedupe([
            ...(manifest.selfAssessment?.weaknesses ?? []),
            ...(current.recentWeaknesses ?? []),
        ], 8),
        recentPromptHashes: dedupe([
            manifest.meta.promptHash ?? "",
            ...(current.recentPromptHashes ?? []),
        ], 10),
        recentPlanSignatures: dedupe([
            recentPlanSignature,
            ...(current.recentPlanSignatures ?? []),
        ], 10),
        successPatterns: updateSuccessPatterns(current.successPatterns, manifest, request),
        skillGaps: updateSkillGaps(current.skillGaps, manifest),
        styleTendency: nextStyleTendency,
        successfulMotifReturns: updateSuccessfulMotifReturns(current.successfulMotifReturns, manifest, request),
        successfulTensionArcs: updateSuccessfulTensionArcs(current.successfulTensionArcs, manifest, request),
        successfulRegisterCenters: updateSuccessfulRegisterCenters(current.successfulRegisterCenters, manifest, request),
        successfulCadenceApproaches: updateSuccessfulCadenceApproaches(current.successfulCadenceApproaches, manifest, request),
        successfulBassMotionProfiles: updateSuccessfulBassMotionProfiles(current.successfulBassMotionProfiles, manifest, request),
        successfulSectionStyles: updateSuccessfulSectionStyles(current.successfulSectionStyles, manifest, request),
        lastReflection: manifest.selfAssessment?.reflection
            || manifest.selfAssessment?.nextFocus?.[0]
            || current.lastReflection
            || "",
    };

    saveAutonomyPreferences(next);
    return next;
}

function sectionHasExpressionGuidance(section: SectionPlan): boolean {
    const expression = section.expression;
    if (!expression) {
        return false;
    }

    return Boolean(
        expression.dynamics
        || (expression.articulation?.length ?? 0) > 0
        || (expression.character?.length ?? 0) > 0
        || (expression.phrasePeaks?.length ?? 0) > 0
        || typeof expression.sustainBias === "number"
        || typeof expression.accentBias === "number",
    );
}

function plannerModelCoverage(selectedModels: ModelBinding[] | undefined, workflow: ComposeWorkflow | undefined): number {
    const selectedRoles = new Set((selectedModels ?? []).map((binding) => binding.role));
    const requiredRoles: Array<ModelBinding["role"]> = ["planner", "structure"];
    if (workflow === "symbolic_plus_audio" || workflow === "audio_only") {
        requiredRoles.push("audio_renderer");
    }

    const coveredRoles = requiredRoles.filter((role) => selectedRoles.has(role)).length;
    return coveredRoles / requiredRoles.length;
}

function plannerQualityPolicyCoverage(
    qualityPolicy: ComposeQualityPolicy | undefined,
    workflow: ComposeWorkflow | undefined,
): number {
    if (!qualityPolicy) {
        return 0;
    }

    if (workflow === "audio_only") {
        return typeof qualityPolicy.targetAudioScore === "number" ? 1 : 0.5;
    }

    if (workflow === "symbolic_only") {
        return typeof qualityPolicy.targetStructureScore === "number" ? 1 : 0.75;
    }

    return typeof qualityPolicy.targetStructureScore === "number"
        && typeof qualityPolicy.targetAudioScore === "number"
        ? 1
        : 0.6;
}

function plannerPromptSpecificityScore(prompt: string): number {
    const length = compact(prompt).length;
    if (length < 24) {
        return 0.35;
    }
    if (length <= 220) {
        return 1;
    }
    if (length <= 320) {
        return 0.8;
    }
    return 0.6;
}

function buildPlannerCandidateQualityScore(
    parsed: ParsedPlannerCandidate,
    planSummary: PlannerPlanSummary | undefined,
): number {
    const plan = parsed.request.compositionPlan;
    const workflow = parsed.request.workflow ?? plan?.workflow;
    const sectionTarget = isSonataLikeForm(planSummary?.form ?? parsed.request.form)
        ? 3
        : 2;
    const sectionScore = planSummary
        ? Math.min(1, planSummary.sectionCount / sectionTarget)
        : 0;
    const expressionSections = plan?.sections.filter((section) => sectionHasExpressionGuidance(section)).length ?? 0;
    const expressionTarget = planSummary
        ? Math.min(3, Math.max(1, planSummary.sectionCount))
        : 1;
    const expressionScore = Math.min(1, expressionSections / expressionTarget);
    const rationaleScore = [
        plan?.inspirationThread,
        plan?.intentRationale,
        plan?.contrastTarget,
    ].filter((value) => compact(value).length > 0).length / 3;
    const modelScore = plannerModelCoverage(parsed.request.selectedModels, workflow);
    const qualityPolicyScore = plannerQualityPolicyCoverage(parsed.request.qualityPolicy, workflow);
    const parserScore = parsed.parserMode === "structured_json" ? 1 : 0.45;
    const promptScore = plannerPromptSpecificityScore(parsed.request.prompt);

    const qualityScore = (
        parserScore * 0.18
        + promptScore * 0.12
        + sectionScore * 0.2
        + expressionScore * 0.18
        + rationaleScore * 0.16
        + modelScore * 0.08
        + qualityPolicyScore * 0.08
    );

    return Number(qualityScore.toFixed(4));
}

function buildPlannerCandidateSelectionScore(
    noveltySummary: PlannerNoveltySummary,
    qualityScore: number,
): number {
    const repeatedAxisPenalty = noveltySummary.repeatedAxes.length >= 4 ? 0.04 : 0;
    const exactMatchPenalty = noveltySummary.exactMatch ? 0.18 : 0;
    const rawScore = noveltySummary.noveltyScore * 0.68 + qualityScore * 0.32 - exactMatchPenalty - repeatedAxisPenalty;
    return Number(Math.max(0, Math.min(1, rawScore)).toFixed(4));
}

function summarizePlannerCandidate(candidate: EvaluatedPlannerCandidate): PlannerCandidateEvaluationSummary {
    return {
        candidateId: candidate.candidateId,
        label: candidate.candidateLabel,
        form: candidate.planSummary?.form ?? candidate.parsed.request.form,
        key: candidate.planSummary?.key ?? candidate.parsed.request.key,
        workflow: candidate.planSummary?.workflow ?? candidate.parsed.request.workflow,
        qualityProfile: candidate.planSummary?.qualityProfile,
        parserMode: candidate.parsed.parserMode,
        planSignature: candidate.noveltySummary.planSignature,
        noveltyScore: candidate.noveltySummary.noveltyScore,
        qualityScore: candidate.qualityScore,
        selectionScore: candidate.selectionScore,
        exactMatch: candidate.noveltySummary.exactMatch,
        repeatedAxes: candidate.noveltySummary.repeatedAxes,
    };
}

function comparePlannerCandidates(left: EvaluatedPlannerCandidate, right: EvaluatedPlannerCandidate): number {
    return right.selectionScore - left.selectionScore
        || right.noveltySummary.noveltyScore - left.noveltySummary.noveltyScore
        || right.qualityScore - left.qualityScore
        || left.candidateIndex - right.candidateIndex;
}

function buildPlannerCandidateSelectionSummary(
    candidates: EvaluatedPlannerCandidate[],
    selectedCandidate: EvaluatedPlannerCandidate,
): PlannerCandidateSelectionSummary {
    return {
        strategy: PLANNER_CANDIDATE_SELECTION_STRATEGY,
        candidateCount: candidates.length,
        selectedCandidateId: selectedCandidate.candidateId,
        selectedIndex: selectedCandidate.candidateIndex,
        candidates: candidates.map((candidate) => summarizePlannerCandidate(candidate)),
    };
}

function buildPlannerTelemetry(
    selectedCandidate: EvaluatedPlannerCandidate,
    candidateSelection: PlannerCandidateSelectionSummary,
): PlannerTelemetry {
    return {
        selectionStrategy: candidateSelection.strategy,
        selectedCandidateId: candidateSelection.selectedCandidateId,
        selectedCandidateLabel: selectedCandidate.candidateLabel,
        selectedCandidateIndex: candidateSelection.selectedIndex,
        candidateCount: candidateSelection.candidateCount,
        parserMode: selectedCandidate.parsed.parserMode,
        planSignature: selectedCandidate.noveltySummary.planSignature,
        noveltyScore: selectedCandidate.noveltySummary.noveltyScore,
        repeatedAxes: [...selectedCandidate.noveltySummary.repeatedAxes],
        exactMatch: selectedCandidate.noveltySummary.exactMatch,
        selectionScore: selectedCandidate.selectionScore,
        qualityScore: selectedCandidate.qualityScore,
    };
}

async function generatePlannerCandidates(
    logs: string,
    manifests: JobManifest[],
    preferences: AutonomyPreferences,
    ledger: AutonomyLedgerEntry[],
): Promise<EvaluatedPlannerCandidate[]> {
    const candidates: EvaluatedPlannerCandidate[] = [];
    let lastError: unknown;

    for (const [index, candidateSpec] of PLANNER_CANDIDATE_SPECS.slice(0, DEFAULT_PLANNER_CANDIDATE_COUNT).entries()) {
        try {
            const prompt = buildPlannerPrompt(logs, manifests, preferences, candidateSpec);
            const raw = await generateOllamaText(prompt, {
                temperature: candidateSpec.temperature,
                maxTokens: 512,
            });
            const parsed = parsePlannerResponse(raw, preferences);
            const planSummary = summarizePlannerPlan(parsed.request, parsed.request.selectedModels);
            const noveltySummary = buildPlanNoveltySummary(parsed.request, preferences, ledger);
            const qualityScore = buildPlannerCandidateQualityScore(parsed, planSummary);
            const selectionScore = buildPlannerCandidateSelectionScore(noveltySummary, qualityScore);

            candidates.push({
                candidateId: candidateSpec.id,
                candidateLabel: candidateSpec.label,
                candidateIndex: index,
                parsed,
                planSummary,
                noveltySummary,
                qualityScore,
                selectionScore,
            });
        } catch (error) {
            lastError = error;
            logger.warn("Autonomy planner candidate generation failed", {
                candidateId: candidateSpec.id,
                candidateLabel: candidateSpec.label,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    if (candidates.length === 0) {
        throw lastError instanceof Error ? lastError : new Error("planner candidate generation failed");
    }

    return candidates;
}

export async function previewAutonomyPlan(): Promise<AutonomyPlan> {
    const { logs, manifests, logLineCount } = collectRecentAxiomContext(
        config.autonomyLogLines,
        config.autonomyManifestCount,
    );
    const preferences = loadAutonomyPreferences();
    const ledger = loadAutonomyRunLedger(todayKey());
    const candidates = await generatePlannerCandidates(logs, manifests, preferences, ledger);
    const selectedCandidate = [...candidates].sort(comparePlannerCandidates)[0];
    const candidateSelection = buildPlannerCandidateSelectionSummary(candidates, selectedCandidate);
    const plannerTelemetry = buildPlannerTelemetry(selectedCandidate, candidateSelection);
    const plan: AutonomyPlan = {
        generatedAt: new Date().toISOString(),
        runId: uuidv4(),
        ...selectedCandidate.parsed,
        request: {
            ...selectedCandidate.parsed.request,
            source: "autonomy",
            plannerTelemetry,
        },
        planSummary: selectedCandidate.planSummary,
        noveltySummary: selectedCandidate.noveltySummary,
        candidateSelection,
    };

    appendAutonomyRunLedger(todayKey(), {
        runId: plan.runId,
        createdAt: plan.generatedAt,
        promptHash: plan.promptHash,
        planSignature: plan.noveltySummary?.planSignature,
        noveltyScore: plan.noveltySummary?.noveltyScore,
        plannerTelemetry,
        status: "previewed",
        summary: `${plan.request.form ?? "unspecified"} :: ${plan.rationale}`,
    });

    logger.info("Autonomy plan preview generated", {
        runId: plan.runId,
        promptHash: plan.promptHash,
        logLines: logLineCount,
        manifests: manifests.length,
        plannerCandidates: candidateSelection.candidateCount,
        selectedCandidateId: candidateSelection.selectedCandidateId,
        plannerParserMode: plannerTelemetry.parserMode,
        plannerNoveltyScore: plannerTelemetry.noveltyScore,
    });

    return plan;
}

export async function evaluateCompletedManifest(manifest: JobManifest): Promise<SelfAssessment | null> {
    const reachable = await checkOllamaReachable();
    if (!reachable) {
        return null;
    }

    const raw = await generateOllamaText(buildAssessmentPrompt(manifest), {
        temperature: 0.2,
        maxTokens: 384,
    });
    return parseAssessmentResponse(raw);
}

export async function getAutonomyStatus(): Promise<AutonomyStatus> {
    const plannerContext = collectRecentAxiomContext(config.autonomyLogLines, config.autonomyManifestCount);
    const preferences = loadAutonomyPreferences();
    const ledger = loadAutonomyRunLedger(todayKey());
    const control = loadAutonomyControlState();
    const pendingApprovals = listPendingApprovalSummaries();

    return {
        enabled: config.autonomyEnabled,
        paused: control.paused,
        pauseReason: control.pauseReason,
        activeRun: control.activeRun,
        planner: {
            logLines: plannerContext.logLineCount,
            manifestsRead: plannerContext.manifests.length,
        },
        preferences,
        feedbackHighlights: buildHumanFeedbackHighlights(preferences),
        todayRunCount: ledger.length,
        pendingApprovalCount: pendingApprovals.length,
        pendingApprovals,
        lastRun: ledger.at(-1),
    };
}

export function countAutonomyAttemptsForDay(dayKey = todayKey()): number {
    return loadAutonomyRunLedger(dayKey)
        .filter((entry) => ATTEMPTED_RUN_STATUSES.has(entry.status))
        .length;
}

export function markAutonomyPlanBlocked(plan: AutonomyPlan, reason: string): void {
    updateLedgerStatus(todayKey(), plan.runId, {
        status: "blocked",
        blockedReason: reason,
        summary: reason,
    });
    logger.warn("Autonomy plan blocked", { runId: plan.runId, reason, promptHash: plan.promptHash });
}

export function markAutonomyPlanQueued(plan: AutonomyPlan, jobId: string): void {
    updateLedgerStatus(todayKey(), plan.runId, {
        status: "queued",
        jobId,
    });
    updateAutonomyRunLock(plan.runId, {
        jobId,
        state: "queued",
        nextAttemptAt: undefined,
    });
}

export function markAutonomyRunRunning(runId: string, dayKey: string, jobId: string): void {
    updateLedgerStatus(dayKey, runId, {
        status: "running",
        jobId,
        nextAttemptAt: undefined,
        error: undefined,
    });
    updateAutonomyRunLock(runId, {
        jobId,
        state: "running",
        nextAttemptAt: undefined,
    });
}

export function markAutonomyRunRetryScheduled(
    runId: string,
    dayKey: string,
    jobId: string,
    nextAttemptAt: string,
    error: string,
): void {
    updateLedgerStatus(dayKey, runId, {
        status: "retry_scheduled",
        jobId,
        nextAttemptAt,
        error,
    });
    updateAutonomyRunLock(runId, {
        jobId,
        state: "retry_scheduled",
        nextAttemptAt,
    });
}

export function markAutonomyRunFailed(
    runId: string,
    dayKey: string,
    jobId: string,
    error: string,
): void {
    updateLedgerStatus(dayKey, runId, {
        status: "failed",
        jobId,
        error,
        nextAttemptAt: undefined,
    });
    releaseAutonomyRunLock(runId);
}

export function markAutonomyRunPendingApproval(manifest: JobManifest, jobId?: string): void {
    const runId = manifest.meta.autonomyRunId;
    if (!runId) {
        return;
    }

    updateLedgerStatus(dayKeyFromIso(manifest.meta.createdAt), runId, {
        status: "pending_approval",
        jobId,
        songId: manifest.songId,
        approvalStatus: manifest.approvalStatus,
        summary: manifest.evaluationSummary ?? manifest.selfAssessment?.summary,
        nextAttemptAt: undefined,
    });
    releaseAutonomyRunLock(runId);
}

export function recoverAutonomyRuntimeState(jobs: RecoverableAutonomyJob[]): AutonomyRecoverySummary {
    const notes: string[] = [];
    const control = loadAutonomyControlState();
    const now = new Date().toISOString();
    const activeJobs = jobs
        .filter((job) => (
            job.request.source === "autonomy"
            && Boolean(job.request.autonomyRunId)
        ))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    const restoredJob = activeJobs[0];
    let resolvedStaleRunId: string | undefined;

    if (control.activeRun && control.activeRun.runId !== restoredJob?.request.autonomyRunId) {
        const staleRunId = control.activeRun.runId;
        resolvedStaleRunId = staleRunId;
        const manifest = listStoredManifests().find((item) => item.meta.autonomyRunId === staleRunId);

        if (manifest) {
            updateLedgerStatus(dayKeyFromIso(manifest.meta.createdAt), staleRunId, {
                status: ledgerStatusFromManifest(manifest),
                songId: manifest.songId,
                approvalStatus: manifest.approvalStatus,
                error: manifest.errorMessage,
                summary: manifest.evaluationSummary ?? manifest.selfAssessment?.summary,
            });
            notes.push(`stale run ${staleRunId} reconciled from manifest ${manifest.songId}`);
        } else {
            updateLedgerStatus(dayKeyFromIso(control.activeRun.acquiredAt), staleRunId, {
                status: "failed",
                jobId: control.activeRun.jobId,
                error: "Recovered after restart with no resumable job state",
                summary: "Recovered after restart with no resumable job state",
            });
            notes.push(`stale run ${staleRunId} marked failed during restart recovery`);
        }
    }

    if (restoredJob?.request.autonomyRunId) {
        const restoredRunId = restoredJob.request.autonomyRunId;
        updateLedgerStatus(dayKeyFromIso(restoredJob.createdAt), restoredRunId, {
            status: restoredJob.status,
            jobId: restoredJob.jobId,
            nextAttemptAt: restoredJob.nextAttemptAt,
            error: restoredJob.error,
        });
        saveAutonomyControlState({
            paused: control.paused,
            pauseReason: control.pauseReason,
            updatedAt: now,
            activeRun: {
                runId: restoredRunId,
                promptHash: restoredJob.request.promptHash ?? "",
                acquiredAt: restoredJob.createdAt,
                state: restoredJob.status,
                jobId: restoredJob.jobId,
                nextAttemptAt: restoredJob.nextAttemptAt,
            },
        });
        notes.push(`active autonomy run ${restoredRunId} restored from queue snapshot`);
        return {
            restoredActiveRunId: restoredRunId,
            resolvedStaleRunId,
            notes,
        };
    }

    saveAutonomyControlState({
        paused: control.paused,
        pauseReason: control.pauseReason,
        updatedAt: now,
        activeRun: undefined,
    });

    return {
        resolvedStaleRunId,
        notes,
    };
}

function updateApprovalState(
    songId: string,
    nextStatus: Extract<ApprovalStatus, "approved" | "rejected">,
    reviewFeedback?: AutonomyReviewFeedbackInput | string,
    auditContext?: AutonomyOperatorMutationContext,
): JobManifest | null {
    const manifest = loadManifest(songId);
    if (!manifest) {
        return null;
    }

    if (manifest.meta.source !== "autonomy") {
        throw new AutonomyConflictError("only autonomy compositions can be reviewed via this API", {
            songId,
            source: manifest.meta.source,
        });
    }

    if (manifest.approvalStatus !== "pending") {
        throw new AutonomyConflictError("manifest is not awaiting approval", {
            songId,
            approvalStatus: manifest.approvalStatus,
        });
    }

    const normalizedReviewFeedback = typeof reviewFeedback === "string"
        ? (compact(reviewFeedback) ? { note: compact(reviewFeedback) } : undefined)
        : (() => {
            if (!reviewFeedback) {
                return undefined;
            }

            const note = compact(reviewFeedback.note) || undefined;
            const strongestDimension = compact(reviewFeedback.strongestDimension) || undefined;
            const weakestDimension = compact(reviewFeedback.weakestDimension) || undefined;
            const comparisonReference = compact(reviewFeedback.comparisonReference) || undefined;
            const appealScore = typeof reviewFeedback.appealScore === "number" && Number.isFinite(reviewFeedback.appealScore)
                ? reviewFeedback.appealScore
                : undefined;

            const normalized: AutonomyReviewFeedbackInput = {
                ...(note ? { note } : {}),
                ...(appealScore !== undefined ? { appealScore } : {}),
                ...(strongestDimension ? { strongestDimension } : {}),
                ...(weakestDimension ? { weakestDimension } : {}),
                ...(comparisonReference ? { comparisonReference } : {}),
            };

            return Object.keys(normalized).length > 0 ? normalized : undefined;
        })();
    const beforeManifest = summarizeApprovalState(manifest);
    const currentPreferences = loadAutonomyPreferences();
    const beforeHumanFeedbackSummary = currentPreferences.humanFeedbackSummary
        ? JSON.parse(JSON.stringify(currentPreferences.humanFeedbackSummary)) as Record<string, unknown>
        : undefined;
    const now = new Date().toISOString();
    manifest.approvalStatus = nextStatus;
    manifest.updatedAt = now;
    manifest.meta.updatedAt = now;
    manifest.reviewFeedback = normalizedReviewFeedback;
    if (compact(normalizedReviewFeedback?.note)) {
        const prefix = nextStatus === "approved" ? "Approval note" : "Rejection note";
        manifest.evaluationSummary = [manifest.evaluationSummary, `${prefix}: ${compact(normalizedReviewFeedback?.note)}`]
            .filter(Boolean)
            .join("\n\n");
    }
    saveManifest(manifest);

    const nextPreferences = {
        ...currentPreferences,
        updatedAt: now,
        humanFeedbackSummary: updateHumanFeedbackSummary(
            currentPreferences,
            nextStatus,
            normalizedReviewFeedback,
        ),
    };
    saveAutonomyPreferences(nextPreferences);

    const runId = manifest.meta.autonomyRunId;
    if (runId) {
        updateLedgerStatus(dayKeyFromIso(manifest.meta.createdAt), runId, {
            status: nextStatus,
            songId: manifest.songId,
            approvalStatus: nextStatus,
            summary: manifest.evaluationSummary ?? manifest.selfAssessment?.summary,
        });
    }

    if (auditContext) {
        const artifactLinks = [
            outputArtifactLink(songId, "manifest.json"),
            outputArtifactLink("_system", "preferences.json"),
        ];
        if (runId) {
            artifactLinks.push(outputArtifactLink("_system", "runs", `${dayKeyFromIso(manifest.meta.createdAt)}.json`));
        }
        recordAutonomyOperatorAction({
            context: auditContext,
            action: nextStatus === "approved" ? "approve" : "reject",
            reason: compact(normalizedReviewFeedback?.note) || nextStatus,
            input: {
                songId,
                reviewFeedback: normalizedReviewFeedback ?? undefined,
            },
            before: {
                manifest: beforeManifest,
                humanFeedbackSummary: beforeHumanFeedbackSummary,
            },
            after: {
                manifest: summarizeApprovalState(manifest),
                humanFeedbackSummary: nextPreferences.humanFeedbackSummary,
            },
            artifactLinks,
            observedAt: now,
        });
    }

    logger.info("Autonomy approval updated", {
        songId,
        runId,
        approvalStatus: nextStatus,
    });
    return manifest;
}

export function approveAutonomySong(
    songId: string,
    reviewFeedback?: AutonomyReviewFeedbackInput | string,
    auditContext?: AutonomyOperatorMutationContext,
): JobManifest | null {
    return updateApprovalState(songId, "approved", reviewFeedback, auditContext);
}

export function rejectAutonomySong(
    songId: string,
    reviewFeedback?: AutonomyReviewFeedbackInput | string,
    auditContext?: AutonomyOperatorMutationContext,
): JobManifest | null {
    return updateApprovalState(songId, "rejected", reviewFeedback, auditContext);
}

function buildPlanSignatureParts(
    request: Pick<ComposeRequest, "form" | "key" | "compositionPlan" | "targetInstrumentation">,
): PlanSignatureParts {
    const plan = request.compositionPlan;
    const instrumentation = plan?.instrumentation?.length
        ? plan.instrumentation
        : (request.targetInstrumentation ?? []);

    return {
        form: normalizePlanSignatureValue(request.form ?? plan?.form),
        key: normalizePlanSignatureValue(request.key ?? plan?.key),
        meter: normalizePlanSignatureValue(plan?.meter),
        instrumentation: instrumentation.length > 0
            ? dedupe(instrumentation.map((instrument) => compact(instrument.name).toLowerCase()).sort(), 12).join("+")
            : "none",
        sectionRoles: plan?.sections?.length
            ? plan.sections.map((section) => normalizePlanSignatureValue(section.role)).join(">")
            : "none",
        humanizationStyle: normalizePlanSignatureValue(plan?.humanizationStyle),
    };
}

function serializePlanSignature(parts: PlanSignatureParts): string {
    return [
        `form=${parts.form}`,
        `key=${parts.key}`,
        `meter=${parts.meter}`,
        `inst=${parts.instrumentation}`,
        `roles=${parts.sectionRoles}`,
        `human=${parts.humanizationStyle}`,
    ].join("|");
}

function parsePlanSignature(signature: string | undefined): PlanSignatureParts {
    const result: PlanSignatureParts = {
        form: "none",
        key: "none",
        meter: "none",
        instrumentation: "none",
        sectionRoles: "none",
        humanizationStyle: "none",
    };

    for (const part of String(signature ?? "").split("|")) {
        const [rawKey, ...rawValue] = part.split("=");
        const value = normalizePlanSignatureValue(rawValue.join("="));
        switch (normalizePlanSignatureValue(rawKey)) {
            case "form":
                result.form = value;
                break;
            case "key":
                result.key = value;
                break;
            case "meter":
                result.meter = value;
                break;
            case "inst":
                result.instrumentation = value;
                break;
            case "roles":
                result.sectionRoles = value;
                break;
            case "human":
                result.humanizationStyle = value;
                break;
            default:
                break;
        }
    }

    return result;
}

function buildPlanSignature(
    request: Pick<ComposeRequest, "form" | "key" | "compositionPlan" | "targetInstrumentation">,
): string {
    return serializePlanSignature(buildPlanSignatureParts(request));
}

function axisLabel(axis: PlanNoveltyAxis): string {
    switch (axis) {
        case "sectionRoles":
            return "section_roles";
        case "humanizationStyle":
            return "humanization_style";
        default:
            return axis;
    }
}

function overlappingPlanAxes(candidate: PlanSignatureParts, comparison: PlanSignatureParts): PlanNoveltyAxis[] {
    return PLAN_NOVELTY_AXES.filter((axis) => candidate[axis] === comparison[axis]);
}

function buildPlanNoveltySummary(
    request: Pick<ComposeRequest, "form" | "key" | "compositionPlan" | "targetInstrumentation">,
    preferences: AutonomyPreferences,
    ledger: AutonomyLedgerEntry[],
): PlannerNoveltySummary {
    const planSignature = buildPlanSignature(request);
    const candidate = parsePlanSignature(planSignature);
    const comparisons: PlanNoveltyComparison[] = [];
    const seen = new Set<string>();

    for (const entry of ledger) {
        if (!entry.planSignature) {
            continue;
        }
        const dedupeKey = `ledger|${entry.planSignature}|${entry.status ?? "none"}|${entry.promptHash ?? "none"}`;
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);
        comparisons.push({
            planSignature: entry.planSignature,
            source: "ledger",
            promptHash: entry.promptHash,
            status: entry.status,
        });
    }

    for (const signature of preferences.recentPlanSignatures ?? []) {
        const dedupeKey = `preferences|${signature}`;
        if (!signature || seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);
        comparisons.push({
            planSignature: signature,
            source: "preferences",
        });
    }

    const matchCounts = Object.fromEntries(PLAN_NOVELTY_AXES.map((axis) => [axis, 0])) as Record<PlanNoveltyAxis, number>;
    const recentMatches = comparisons
        .map((comparison) => {
            const overlap = overlappingPlanAxes(candidate, parsePlanSignature(comparison.planSignature));
            for (const axis of overlap) {
                matchCounts[axis] += 1;
            }
            return {
                planSignature: comparison.planSignature,
                source: comparison.source,
                promptHash: comparison.promptHash,
                status: comparison.status,
                overlapAxes: overlap.map((axis) => axisLabel(axis)),
            };
        })
        .filter((comparison) => comparison.overlapAxes.length > 0)
        .sort((left, right) => right.overlapAxes.length - left.overlapAxes.length)
        .slice(0, 3);

    const comparisonCount = comparisons.length;
    const exactMatch = comparisons.some((comparison) => comparison.planSignature === planSignature);
    const baseRepeatedAxes = PLAN_NOVELTY_AXES
        .filter((axis) => comparisonCount > 0 && matchCounts[axis] >= Math.max(2, Math.ceil(comparisonCount * 0.6)))
        .map((axis) => axisLabel(axis));
    const exactMatchAxes = exactMatch
        ? recentMatches.find((match) => match.planSignature === planSignature)?.overlapAxes ?? []
        : [];
    const repeatedAxes = dedupe(baseRepeatedAxes.length > 0 ? baseRepeatedAxes : exactMatchAxes, PLAN_NOVELTY_AXES.length);
    const noveltyScore = comparisonCount === 0
        ? 1
        : Number((PLAN_NOVELTY_AXES
            .map((axis) => 1 - (matchCounts[axis] / comparisonCount))
            .reduce((sum, value) => sum + value, 0) / PLAN_NOVELTY_AXES.length).toFixed(4));

    return {
        planSignature,
        noveltyScore,
        exactMatch,
        comparisonCount,
        repeatedAxes,
        recentMatches,
    };
}