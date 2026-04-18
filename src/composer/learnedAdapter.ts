import { createHash } from "node:crypto";
import type {
    ComposeExecutionPlan,
    ComposeRequest,
    ExpressionGuidance,
    HarmonicPlan,
    InstrumentAssignment,
    ModelBinding,
    MotifTransformPolicy,
    OrnamentPlan,
    TempoMotionPlan,
    TextureGuidance,
} from "../pipeline/types.js";

export const LEARNED_SYMBOLIC_PROMPT_PACK_VERSION = "learned_symbolic_prompt_pack_v1";

export interface LearnedSymbolicPromptPackStyleCue {
    brief: string;
    mood: string[];
    form: string;
    key: string;
    meter?: string;
    tempo?: number;
    instrumentationLabel: string;
    instrumentationFamilies?: string[];
    titleHint?: string;
    inspirationThread?: string;
    intentRationale?: string;
    riskProfile?: string;
    structureVisibility?: string;
    humanizationStyle?: string;
}

export interface LearnedSymbolicPromptPackSection {
    sectionId: string;
    role: string;
    label: string;
    measures: number;
    energy: number;
    density: number;
    phraseFunction?: string;
    cadence?: string;
    harmonicPlan?: Pick<
        HarmonicPlan,
        "tonalCenter" | "keyTarget" | "harmonicRhythm" | "prolongationMode" | "cadence" | "allowModulation"
    >;
    textureRoleHints?: string[];
    counterpointMode?: NonNullable<TextureGuidance["counterpointMode"]>;
    notes?: string[];
}

export interface LearnedSymbolicPromptPackExpressionSection {
    sectionId: string;
    texture?: TextureGuidance;
    expression?: ExpressionGuidance;
    tempoMotion?: TempoMotionPlan[];
    ornaments?: OrnamentPlan[];
}

export interface LearnedSymbolicPromptPackRevisionSummary {
    attemptIndex?: number;
    directiveKinds?: string[];
    targetedSectionIds?: string[];
}

export interface LearnedSymbolicPromptPack {
    version: typeof LEARNED_SYMBOLIC_PROMPT_PACK_VERSION;
    lane: string;
    planSignature: string;
    promptText: string;
    styleCue: LearnedSymbolicPromptPackStyleCue;
    instrumentation: InstrumentAssignment[];
    sections: LearnedSymbolicPromptPackSection[];
    motifPolicy?: MotifTransformPolicy;
    sketchSummary?: {
        motifDraftCount: number;
        cadenceOptionCount: number;
    };
    narrativeNotes?: string[];
    expressionDefaults?: ExpressionGuidance;
    sectionExpressionCues?: LearnedSymbolicPromptPackExpressionSection[];
    revisionSummary?: LearnedSymbolicPromptPackRevisionSummary;
}

export interface LearnedSymbolicWorkerPayload {
    prompt: string;
    songId: string;
    outputPath: string;
    selectedModels: ModelBinding[];
    stableSeed: number;
    promptPack: LearnedSymbolicPromptPack;
    key?: string;
    tempo?: number;
    form?: string;
    attemptIndex?: number;
    revisionDirectives?: ComposeRequest["revisionDirectives"];
    sectionArtifacts?: ComposeRequest["sectionArtifacts"];
    compositionPlan?: ComposeRequest["compositionPlan"];
    targetInstrumentation?: ComposeRequest["targetInstrumentation"];
}

function stableStringify(value: unknown): string {
    if (value === null || value === undefined) {
        return JSON.stringify(value);
    }
    if (typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function normalizeSignatureToken(value: string | undefined): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function cloneJsonValue<T>(value: T | undefined): T | undefined {
    if (value === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => String(entry ?? "").trim())
            .filter((entry) => entry.length > 0);
    }
    const singleValue = String(value ?? "").trim();
    return singleValue ? [singleValue] : [];
}

function dedupeSorted(values: string[]): string[] {
    return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right));
}

function resolveInstrumentation(request: ComposeRequest): InstrumentAssignment[] {
    if (request.compositionPlan?.instrumentation?.length) {
        return request.compositionPlan.instrumentation.map((entry) => ({
            ...entry,
            roles: [...entry.roles],
        }));
    }
    if (request.targetInstrumentation?.length) {
        return request.targetInstrumentation.map((entry) => ({
            ...entry,
            roles: [...entry.roles],
        }));
    }
    return [];
}

function resolveLane(request: ComposeRequest, instrumentation: InstrumentAssignment[]): string {
    const form = normalizeSignatureToken(request.form ?? request.compositionPlan?.form);
    const orchestrationFamily = normalizeSignatureToken(request.compositionPlan?.orchestration?.family);
    const instrumentNames = instrumentation.map((entry) => normalizeSignatureToken(entry.name)).sort();
    const canonicalTrio = ["cello", "viola", "violin"];

    if (form.includes("miniature") && (orchestrationFamily === "string_trio" || stableStringify(instrumentNames) === stableStringify(canonicalTrio))) {
        return "string_trio_symbolic";
    }
    return "generic_symbolic";
}

function buildStyleCue(request: ComposeRequest, instrumentation: InstrumentAssignment[]): LearnedSymbolicPromptPackStyleCue {
    const plan = request.compositionPlan;
    return {
        brief: String(plan?.brief ?? request.prompt).trim() || request.prompt,
        mood: normalizeStringList(plan?.mood),
        form: String(request.form ?? plan?.form ?? "miniature").trim() || "miniature",
        key: String(request.key ?? plan?.key ?? "C major").trim() || "C major",
        ...(plan?.meter ? { meter: plan.meter } : {}),
        ...(typeof (request.tempo ?? plan?.tempo) === "number" ? { tempo: request.tempo ?? plan?.tempo } : {}),
        instrumentationLabel: instrumentation.length
            ? instrumentation.map((entry) => entry.name).join(", ")
            : "default",
        ...(instrumentation.length
            ? { instrumentationFamilies: dedupeSorted(instrumentation.map((entry) => normalizeSignatureToken(entry.family))) }
            : {}),
        ...(plan?.titleHint ? { titleHint: plan.titleHint } : {}),
        ...(plan?.inspirationThread ? { inspirationThread: plan.inspirationThread } : {}),
        ...(plan?.intentRationale ? { intentRationale: plan.intentRationale } : {}),
        ...(plan?.riskProfile ? { riskProfile: plan.riskProfile } : {}),
        ...(plan?.structureVisibility ? { structureVisibility: plan.structureVisibility } : {}),
        ...(plan?.humanizationStyle ? { humanizationStyle: plan.humanizationStyle } : {}),
    };
}

function buildPromptPackSections(request: ComposeRequest): LearnedSymbolicPromptPackSection[] {
    const fallbackTexture = request.compositionPlan?.textureDefaults;
    return (request.compositionPlan?.sections ?? []).map((section) => ({
        sectionId: section.id,
        role: section.role,
        label: section.label,
        measures: section.measures,
        energy: section.energy,
        density: section.density,
        ...(section.phraseFunction ? { phraseFunction: section.phraseFunction } : {}),
        ...(section.cadence ? { cadence: section.cadence } : {}),
        ...(section.harmonicPlan
            ? {
                harmonicPlan: {
                    ...(section.harmonicPlan.tonalCenter ? { tonalCenter: section.harmonicPlan.tonalCenter } : {}),
                    ...(section.harmonicPlan.keyTarget ? { keyTarget: section.harmonicPlan.keyTarget } : {}),
                    ...(section.harmonicPlan.harmonicRhythm ? { harmonicRhythm: section.harmonicPlan.harmonicRhythm } : {}),
                    ...(section.harmonicPlan.prolongationMode ? { prolongationMode: section.harmonicPlan.prolongationMode } : {}),
                    ...(section.harmonicPlan.cadence ? { cadence: section.harmonicPlan.cadence } : {}),
                    ...(typeof section.harmonicPlan.allowModulation === "boolean"
                        ? { allowModulation: section.harmonicPlan.allowModulation }
                        : {}),
                },
            }
            : {}),
        ...((section.texture?.primaryRoles?.length || fallbackTexture?.primaryRoles?.length)
            ? { textureRoleHints: [...(section.texture?.primaryRoles ?? fallbackTexture?.primaryRoles ?? [])] }
            : {}),
        ...(section.texture?.counterpointMode || fallbackTexture?.counterpointMode
            ? { counterpointMode: section.texture?.counterpointMode ?? fallbackTexture?.counterpointMode }
            : {}),
        ...(section.notes?.length ? { notes: [...section.notes] } : {}),
    }));
}

function buildSectionExpressionCues(request: ComposeRequest): LearnedSymbolicPromptPackExpressionSection[] | undefined {
    const cues = (request.compositionPlan?.sections ?? [])
        .map((section) => ({
            sectionId: section.id,
            ...(section.texture ? { texture: cloneJsonValue(section.texture) } : {}),
            ...(section.expression ? { expression: cloneJsonValue(section.expression) } : {}),
            ...(section.tempoMotion?.length ? { tempoMotion: cloneJsonValue(section.tempoMotion) } : {}),
            ...(section.ornaments?.length ? { ornaments: cloneJsonValue(section.ornaments) } : {}),
        }))
        .filter((entry) => Object.keys(entry).length > 1);

    return cues.length ? cues : undefined;
}

function buildRevisionSummary(request: ComposeRequest): LearnedSymbolicPromptPackRevisionSummary | undefined {
    const directiveKinds = dedupeSorted((request.revisionDirectives ?? []).map((directive) => directive.kind));
    const targetedSectionIds = dedupeSorted(
        (request.revisionDirectives ?? []).flatMap((directive) => directive.sectionIds ?? []).map((sectionId) => String(sectionId).trim()),
    );

    if (request.attemptIndex === undefined && directiveKinds.length === 0 && targetedSectionIds.length === 0) {
        return undefined;
    }

    return {
        ...(request.attemptIndex !== undefined ? { attemptIndex: request.attemptIndex } : {}),
        ...(directiveKinds.length ? { directiveKinds } : {}),
        ...(targetedSectionIds.length ? { targetedSectionIds } : {}),
    };
}

function buildPlanSignature(
    baseSignatureInput: Record<string, unknown>,
    lane: string,
    styleCue: LearnedSymbolicPromptPackStyleCue,
    sections: LearnedSymbolicPromptPackSection[],
    instrumentation: InstrumentAssignment[],
): string {
    const digest = createHash("sha256").update(stableStringify(baseSignatureInput)).digest("hex").slice(0, 12);
    const roles = sections.map((section) => normalizeSignatureToken(section.role)).join(">") || "none";
    const instruments = instrumentation.map((entry) => normalizeSignatureToken(entry.name)).join(",") || "default";

    return [
        `lane=${lane}`,
        `form=${normalizeSignatureToken(styleCue.form)}`,
        `key=${normalizeSignatureToken(styleCue.key)}`,
        `inst=${instruments}`,
        `roles=${roles}`,
        `sig=${digest}`,
    ].join("|");
}

export function buildLearnedSymbolicPromptPack(request: ComposeRequest): LearnedSymbolicPromptPack {
    const instrumentation = resolveInstrumentation(request);
    const lane = resolveLane(request, instrumentation);
    const styleCue = buildStyleCue(request, instrumentation);
    const sections = buildPromptPackSections(request);
    const expressionDefaults = cloneJsonValue(request.compositionPlan?.expressionDefaults);
    const sectionExpressionCues = buildSectionExpressionCues(request);
    const sketchSummary = request.compositionPlan?.sketch
        ? {
            motifDraftCount: request.compositionPlan.sketch.motifDrafts.length,
            cadenceOptionCount: request.compositionPlan.sketch.cadenceOptions.length,
        }
        : undefined;
    const narrativeNotes = dedupeSorted([
        ...normalizeStringList(request.compositionPlan?.rationale),
        ...(request.compositionPlan?.longSpanForm?.notes ?? []),
    ]);

    const baseSignatureInput = {
        version: LEARNED_SYMBOLIC_PROMPT_PACK_VERSION,
        lane,
        styleCue,
        instrumentation,
        sections,
        ...(request.compositionPlan?.motifPolicy ? { motifPolicy: cloneJsonValue(request.compositionPlan.motifPolicy) } : {}),
        ...(sketchSummary ? { sketchSummary } : {}),
        ...(expressionDefaults ? { expressionDefaults } : {}),
        ...(sectionExpressionCues ? { sectionExpressionCues } : {}),
        ...(narrativeNotes.length ? { narrativeNotes } : {}),
    };

    const planSignature = buildPlanSignature(baseSignatureInput, lane, styleCue, sections, instrumentation);
    const revisionSummary = buildRevisionSummary(request);

    return {
        version: LEARNED_SYMBOLIC_PROMPT_PACK_VERSION,
        lane,
        planSignature,
        promptText: request.prompt,
        styleCue,
        instrumentation,
        sections,
        ...(request.compositionPlan?.motifPolicy ? { motifPolicy: cloneJsonValue(request.compositionPlan.motifPolicy) } : {}),
        ...(sketchSummary ? { sketchSummary } : {}),
        ...(narrativeNotes.length ? { narrativeNotes } : {}),
        ...(expressionDefaults ? { expressionDefaults } : {}),
        ...(sectionExpressionCues ? { sectionExpressionCues } : {}),
        ...(revisionSummary ? { revisionSummary } : {}),
    };
}

export function buildLearnedSymbolicWorkerPayload(
    request: ComposeRequest,
    songId: string,
    outputPath: string,
    executionPlan: ComposeExecutionPlan,
): LearnedSymbolicWorkerPayload {
    const promptPack = buildLearnedSymbolicPromptPack(request);
    const stableSeed = Number.parseInt(
        createHash("sha256")
            .update(stableStringify({
                prompt: request.prompt,
                planSignature: promptPack.planSignature,
                revisionSummary: promptPack.revisionSummary,
            }))
            .digest("hex")
            .slice(0, 8),
        16,
    );

    return {
        prompt: request.prompt,
        songId,
        outputPath,
        selectedModels: executionPlan.selectedModels.map((binding) => ({ ...binding })),
        stableSeed,
        promptPack,
        ...(request.key ? { key: request.key } : {}),
        ...(request.tempo !== undefined ? { tempo: request.tempo } : {}),
        ...(request.form ? { form: request.form } : {}),
        ...(request.attemptIndex !== undefined ? { attemptIndex: request.attemptIndex } : {}),
        ...(request.revisionDirectives?.length ? { revisionDirectives: request.revisionDirectives } : {}),
        ...(request.sectionArtifacts?.length ? { sectionArtifacts: request.sectionArtifacts } : {}),
        ...(request.compositionPlan ? { compositionPlan: request.compositionPlan } : {}),
        ...(request.targetInstrumentation?.length ? { targetInstrumentation: request.targetInstrumentation } : {}),
    };
}