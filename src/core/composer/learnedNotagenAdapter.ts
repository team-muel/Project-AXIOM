import type { LocalizedRewriteSpec, LocalizedRewriteDirectiveHint, LearnedSamplingParams, ModelBinding, PianoPlan, PianoSectionPlan, LocalizedPianoRewriteSpec, PianoRevisionDirective, GlobalMotifGraph } from "../pipeline/types.js";
import { SOLO_PIANO_SYMBOLIC_LANE, STRING_TRIO_SYMBOLIC_LANE } from "../generate/learnedSymbolicContract.js";
import type {
    LearnedSymbolicPromptPack,
    LearnedSymbolicPromptPackSection,
    LearnedSymbolicPromptPackStyleCue,
} from "./learnedAdapter.js";
import {
    AXIOM_IDENTITY_COMPOSER_PRIMARY,
    AXIOM_IDENTITY_COMPOSER_LYRICAL,
    SCHUBERT_FORM_KEYWORDS,
} from "../identity/axiomStyleIdentity.js";

export const LEARNED_NOTAGEN_ADAPTER_VERSION = "learned_notagen_adapter_v1" as const;

export interface LearnedNotagenProviderRequest {
    adapter: "notagen_class";
    version: typeof LEARNED_NOTAGEN_ADAPTER_VERSION;
    provider: string;
    model: string;
    promptPackVersion: string;
    planSignature: string;
    conditioningText: string;
    /** Hard constraints + structural control lines in deterministic order. */
    controlLines: string[];
    /** Advisory soft-constraint lines (energy, density, mood). Not hard constraints. */
    softConstraintLines?: string[];
    /** Metadata-only lines (riskProfile, intentRationale, narrativeNotes). Not passed to NotaGen. */
    metadataLines?: string[];
    abcHeader?: string;
    warnings?: string[];
    /** Zero-based index of this candidate in the learned candidate pool. */
    candidateIndex?: number;
    /** Sampling parameters forwarded to the NotaGen backend. */
    samplingParams?: LearnedSamplingParams;
    /** When present, the backend performs a localized section rewrite instead of whole-piece generation. */
    rewriteSpec?: LocalizedRewriteSpec;
    /**
     * When present, describes piano-specific localized repairs/rewrites.
     * Native NotaGen that cannot act on this block should strip it and fall
     * back to PianoRepairSolver; downstream fine-tuned models consume it directly.
     * Preserved verbatim in controlLines metadata for projection and dataset export.
     */
    pianoRewriteSpec?: LocalizedPianoRewriteSpec;
    /** Rendered `<AXIOM_PIANO_REWRITE>` block derived from pianoRewriteSpec. Passed after the main control block. */
    pianoRewriteBlock?: string;
    /**
     * Rendered `[AXIOM_REPAIR]` block for harmony-contract repair directives.
     * Generated when `rewriteSpec.directives` contains harmony-specific repair kinds
     * (`strengthen_cadence`, `clarify_harmonic_color`, `regenerate_harmony_realization`,
     * `enforce_tonicization_window`, `enforce_prolongation_mode`).
     * Appended to the prompt after `<AXIOM_REWRITE>` so the model receives per-section
     * structured repair instructions.
     */
    repairBlock?: string;
    /**
     * Rendered `[AXIOM_MOTIF_GRAPH]` block derived from the plan-time GlobalMotifGraph.
     * Carries the full dramatic arc of motif development — source section, required returns,
     * and per-section transform + dramatic function — so the generator can intentionally
     * place motif occurrences rather than discovering them only at evaluation time.
     * Appended to the prompt after `[AXIOM_REPAIR]` when a GlobalMotifGraph is present.
     */
    motifGraphBlock?: string;
}

function normalizeText(value: string | undefined): string {
    return String(value ?? "").trim().replace(/\s+/g, " ");
}

function resolveAbcKey(keyLabel: string): string {
    const m = /^([A-G][#b]?)\s+(major|minor)$/i.exec(keyLabel.trim());
    if (!m) return "C";
    return m[2].toLowerCase() === "major" ? m[1] : `${m[1]}min`;
}

function buildAbcHeader(promptPack: LearnedSymbolicPromptPack): string {
    const { styleCue } = promptPack;
    const key = resolveAbcKey(styleCue.key ?? "C major");
    const tempo = styleCue.tempo ?? 92;
    const meter = normalizeText(styleCue.meter) || "4/4";
    const title = normalizeText(styleCue.brief).slice(0, 80) || "Untitled";
    return [
        "X:1",
        `T:${title}`,
        `M:${meter}`,
        "L:1/8",
        `Q:1/4=${tempo}`,
        `K:${key}`,
    ].join("\n") + "\n";
}

function resolveStructureBinding(selectedModels: ModelBinding[] | undefined): ModelBinding | undefined {
    return selectedModels?.find((binding) => binding.role === "structure");
}

function formatSectionControlLine(section: LearnedSymbolicPromptPackSection): string {
    // Hard constraints first: id, role, label, measures
    const attributes: string[] = [
        `id=${normalizeText(section.sectionId)}`,
        `role=${normalizeText(section.role)}`,
        `label=${normalizeText(section.label)}`,
        `measures=${section.measures}`,
    ];
    // Soft structural hints follow in deterministic order
    if (section.phraseFunction) attributes.push(`phrase=${normalizeText(section.phraseFunction)}`);
    if (section.cadence) attributes.push(`cadence=${normalizeText(section.cadence)}`);
    if (section.harmonicPlan?.tonalCenter) attributes.push(`tonal_center=${normalizeText(section.harmonicPlan.tonalCenter)}`);
    if (section.harmonicPlan?.harmonicRhythm) attributes.push(`harmonic_rhythm=${normalizeText(section.harmonicPlan.harmonicRhythm)}`);
    if (section.textureRoleHints?.length) attributes.push(`texture_roles=${section.textureRoleHints.map(normalizeText).join("|")}`);
    if (section.counterpointMode) attributes.push(`counterpoint=${normalizeText(section.counterpointMode)}`);
    // motif_ref is always present (defaults to "none")
    attributes.push(`motif_ref=${normalizeText(section.motifRef) || "none"}`);
    // Energy/density (soft, advisory) at end
    attributes.push(`energy=${section.energy}`);
    attributes.push(`density=${section.density}`);
    if (section.harmonicPlan?.keyTarget) attributes.push(`key_target=${normalizeText(section.harmonicPlan.keyTarget)}`);
    if (section.harmonicPlan?.prolongationMode) attributes.push(`prolongation=${normalizeText(section.harmonicPlan.prolongationMode)}`);
    if (section.notes?.length) attributes.push(`notes=${section.notes.map(normalizeText).join("|")}`);
    return `section ${attributes.join(" ")}`;
}

function resolveConditioningInstrumentationDescription(promptPack: LearnedSymbolicPromptPack): string {
    if (promptPack.lane === STRING_TRIO_SYMBOLIC_LANE) {
        return "classical string trio";
    }
    if (promptPack.lane === SOLO_PIANO_SYMBOLIC_LANE) {
        return "solo piano";
    }
    if (promptPack.instrumentation.length > 0) {
        return promptPack.instrumentation.map((e) => normalizeText(e.name)).join(", ");
    }
    return normalizeText(promptPack.styleCue.instrumentationLabel) || "ensemble";
}

function buildConditioningText(promptPack: LearnedSymbolicPromptPack): string {
    const description = resolveConditioningInstrumentationDescription(promptPack);
    const form = normalizeText(promptPack.styleCue.form);
    const key = normalizeText(promptPack.styleCue.key);
    const meter = normalizeText(promptPack.styleCue.meter) || "4/4";
    const tempo = promptPack.styleCue.tempo ?? 92;
    return normalizeText(
        `Generate interleaved ABC notation for a ${description} ${form} in ${key}, ${meter}, ${tempo} BPM. Preserve the section plan and synchronized voices.`,
    );
}

function resolveInstrumentationControlLine(
    promptPack: LearnedSymbolicPromptPack,
    warnings: string[],
): string {
    if (promptPack.instrumentation.length > 0) {
        const parts = promptPack.instrumentation
            .map((e) => `${normalizeText(e.name)}:${e.roles.map(normalizeText).join("|")}`)
            .join(",");
        return `instrumentation=${parts}`;
    }
    if (promptPack.lane === STRING_TRIO_SYMBOLIC_LANE) {
        warnings.push(
            "instrumentation missing for narrow lane string_trio_symbolic; defaulting to Violin:lead,Viola:counterline,Cello:bass",
        );
        return "instrumentation=Violin:lead,Viola:counterline,Cello:bass";
    }
    if (promptPack.lane === SOLO_PIANO_SYMBOLIC_LANE) {
        warnings.push(
            "instrumentation missing for solo_piano_symbolic lane; defaulting to Piano:lead|chordal_support|bass",
        );
        return "instrumentation=Piano:lead|chordal_support|bass";
    }
    return "instrumentation=default";
}

function hasSamplingParams(p: LearnedSamplingParams): boolean {
    return (
        p.temperature !== undefined ||
        p.topP !== undefined ||
        p.topK !== undefined ||
        p.seedOffset !== undefined
    );
}

function buildSamplingControlLine(p: LearnedSamplingParams): string {
    const parts: string[] = [];
    if (p.temperature !== undefined) parts.push(`temperature=${p.temperature}`);
    if (p.topP !== undefined) parts.push(`top_p=${p.topP}`);
    if (p.topK !== undefined) parts.push(`top_k=${p.topK}`);
    if (p.seedOffset !== undefined) parts.push(`seed_offset=${p.seedOffset}`);
    return `sampling ${parts.join(" ")}`;
}

/** Maps a numeric densityTarget (1–6) to a human-readable density label. */
function resolveDensityLabel(densityTarget: number | undefined): string {
    const n = densityTarget ?? 2;
    if (n <= 1) return "sparse";
    if (n <= 2) return "medium";
    if (n <= 3) return "rich";
    return "dense";
}

/**
 * Emits a `piano_global` control line summarising the plan-wide texture idiom,
 * dominant pedal strategy, hand-crossing intent, and maximum comfortable span.
 *
 * Preserved verbatim in controlLines even when native NotaGen cannot act on all
 * fields — downstream projection, repair, and fine-tuning export pipelines rely on it.
 */
function formatPianoGlobalControlLine(pianoPlan: PianoPlan): string {
    const sections = pianoPlan.sections;
    // Dominant texture: first section's texture is taken as the governing idiom.
    const globalTexture = sections[0]?.textureKind ?? "melody_accompaniment";
    // Dominant pedal: mode of pedal strategies across sections.
    const pedalCounts = new Map<string, number>();
    for (const s of sections) {
        const strat = s.pedal.strategy;
        pedalCounts.set(strat, (pedalCounts.get(strat) ?? 0) + 1);
    }
    let dominantPedal = "none";
    let maxCount = 0;
    for (const [strat, count] of pedalCounts) {
        if (count > maxCount) { maxCount = count; dominantPedal = strat; }
    }
    // hand_crossing: true if any section hand plan permits crossing.
    const handCrossing = sections.some(
        (s) => s.rightHand.allowCrossing === true || s.leftHand.allowCrossing === true,
    );
    // max_span: largest maxComfortableSpan across all hand plans.
    const maxSpan = sections.reduce((acc, s) => {
        return Math.max(acc, s.rightHand.maxComfortableSpan, s.leftHand.maxComfortableSpan);
    }, 0);
    return `piano_global texture=${globalTexture} pedal=${dominantPedal} hand_crossing=${handCrossing} max_span=${maxSpan}`;
}

/**
 * Emits a `piano_section` control line for one PianoSectionPlan.
 *
 * Format: `piano_section id=<id> texture=<kind> rh=<roles> lh=<pattern|roles> pedal=<strategy> density=<label>`
 *
 * The lh field prefers the explicit accompanimentPattern when set (e.g. "broken_chord"),
 * otherwise falls back to the left-hand primary roles joined with "|".
 */
function formatPianoSectionControlLine(section: PianoSectionPlan): string {
    const rhRoles = section.rightHand.primaryRoles.join("|") || "lead";
    const lhValue = section.accompanimentPattern
        ?? (section.leftHand.primaryRoles.join("|") || "bass");
    const pedal = section.pedal.strategy;
    const density = resolveDensityLabel(section.rightHand.densityTarget);
    return `piano_section id=${section.sectionId} texture=${section.textureKind} rh=${rhRoles} lh=${lhValue} pedal=${pedal} density=${density}`;
}

export interface LearnedNotagenProviderRequestOpts {
    candidateIndex?: number;
    /**
     * Total number of candidates in the pool.
     * Used by resolveComposerIdentity() to correctly split composers across
     * arbitrary pool sizes (e.g. 8, 16, 32).
     * Defaults to 8 when absent.
     */
    candidatePoolSize?: number;
    samplingParams?: LearnedSamplingParams;
    localizedRewriteSpec?: LocalizedRewriteSpec;
    /** Piano-specific localized rewrite spec; produces an AXIOM_PIANO_REWRITE block. */
    localizedPianoRewriteSpec?: LocalizedPianoRewriteSpec;
}

/** Maps RevisionDirectiveKind values to human-readable rewrite target descriptions. */
const DIRECTIVE_KIND_TO_REWRITE_TARGETS: Record<string, string[]> = {
    strengthen_cadence: ["strengthen contrary motion", "prepare dominant before recap", "clarify cadential arrival"],
    stabilize_harmony: ["increase harmonic stability", "reinforce tonal center", "smooth harmonic route"],
    clarify_texture_plan: ["clarify voice independence", "improve counterline contrast", "balance texture layers"],
    clarify_phrase_rhetoric: ["clarify phrase contour", "add breath points", "sharpen rhetoric at phrase boundaries"],
    clarify_harmonic_color: ["enrich local harmonic color", "introduce chromatic inflection", "vary chord qualities"],
    reduce_large_leaps: ["reduce melodic leaps", "smooth melodic contour", "improve voice leading"],
    increase_rhythm_variety: ["diversify rhythm cells", "introduce contrasting note values", "vary rhythmic texture"],
    regenerate_harmony_realization: ["regenerate harmonic realization", "revise chord voicings", "adjust harmonic rhythm"],
    enforce_tonicization_window: ["realize local tonicization window", "establish secondary dominant before arrival", "clarify tonal goal"],
    enforce_prolongation_mode: ["sustain tonic prolongation throughout section", "avoid premature harmonic motion", "hold tonal center"],
};

/** Harmony-contract repair kinds that generate a structured `[AXIOM_REPAIR]` block. */
const HARMONY_REPAIR_KINDS: ReadonlySet<string> = new Set([
    "strengthen_cadence",
    "clarify_harmonic_color",
    "regenerate_harmony_realization",
    "enforce_tonicization_window",
    "enforce_prolongation_mode",
]);

/** Per-action field name and instruction text for `[AXIOM_REPAIR]` entries. */
const HARMONY_REPAIR_ACTION_SPEC: Record<string, { field: string; instruction: string }> = {
    strengthen_cadence: {
        field: "cadenceApproach",
        instruction: "Make dominant preparation explicit before the final arrival.",
    },
    clarify_harmonic_color: {
        field: "harmonicColorCues",
        instruction: "Introduce explicit chromatic inflection to enrich local harmonic color.",
    },
    regenerate_harmony_realization: {
        field: "harmonicRealizationSummary",
        instruction: "Regenerate harmonic realization: revise chord voicings and harmonic rhythm.",
    },
    enforce_tonicization_window: {
        field: "tonicizationWindows",
        instruction: "Realize a clear local tonicization window before recap.",
    },
    enforce_prolongation_mode: {
        field: "prolongationMode",
        instruction: "Sustain tonic prolongation through the entire section.",
    },
};

/**
 * Build a `[AXIOM_REPAIR]` block from harmony-contract repair directive hints.
 *
 * Only hints whose `kind` is in `HARMONY_REPAIR_KINDS` are emitted.
 * Each hint produces a `section=`, `action=`, `field=`, `instruction=` entry.
 *
 * Returns `undefined` if no harmony repair hints are present.
 */
export function buildHarmonyRepairBlock(directives: LocalizedRewriteDirectiveHint[]): string | undefined {
    const entries = directives.filter((d) => HARMONY_REPAIR_KINDS.has(d.kind));
    if (entries.length === 0) return undefined;

    const lines: string[] = ["[AXIOM_REPAIR]"];
    for (const entry of entries) {
        const spec = HARMONY_REPAIR_ACTION_SPEC[entry.kind];
        const instruction = spec?.instruction ?? entry.reason;
        const field = spec?.field ?? entry.kind;
        lines.push(`section=${entry.sectionId}`);
        lines.push(`action=${entry.kind}`);
        lines.push(`field=${field}`);
        lines.push(`instruction=${instruction}`);
    }
    lines.push("[/AXIOM_REPAIR]");
    return lines.join("\n");
}

/**
 * Build a `[AXIOM_MOTIF_GRAPH]` block from the plan-time `GlobalMotifGraph`.
 *
 * Emits the source motif id, source section, required return sections, and per-section
 * transform + dramatic function so the generator can intentionally place motif occurrences.
 *
 * Format:
 * ```
 * [AXIOM_MOTIF_GRAPH]
 * source=theme_a
 * motif_id=theme_a
 * required_returns=recap:s3,outro:s4
 * s1: transform=original dramatic_function=exposition
 * s2: transform=fragmentation dramatic_function=destabilization
 * s3: transform=sequence dramatic_function=intensification required=true
 * [/AXIOM_MOTIF_GRAPH]
 * ```
 *
 * Returns `undefined` when the graph has no transform path.
 */
export function buildMotifGraphBlock(graph: GlobalMotifGraph): string | undefined {
    if (!graph.transformPath.length) return undefined;

    const lines: string[] = ["[AXIOM_MOTIF_GRAPH]"];
    lines.push(`source=${graph.sourceSectionId}`);
    lines.push(`motif_id=${graph.motifId}`);

    if (graph.requiredReturns.length > 0) {
        // Emit required_returns as id list
        lines.push(`required_returns=${graph.requiredReturns.join(",")}`);
    }

    for (const node of graph.transformPath) {
        let entry = `${node.sectionId}: transform=${node.transform} dramatic_function=${node.dramaticFunction}`;
        if (node.required) entry += " required=true";
        if (node.harmonicContext) entry += ` harmonic_context=${node.harmonicContext.replace(/\s+/g, "_")}`;
        if (node.fragmentSpec) entry += ` fragment_start=${node.fragmentSpec.start} fragment_length=${node.fragmentSpec.length}`;
        lines.push(entry);
    }

    lines.push("[/AXIOM_MOTIF_GRAPH]");
    return lines.join("\n");
}

/**
 * Build an `<AXIOM_REWRITE>` block from a `LocalizedRewriteSpec`.
 *
 * Emits a structured rewrite control block that instructs the learned symbolic
 * generator to rewrite only the specified sections while preserving the rest.
 */
export function buildRewriteBlock(spec: LocalizedRewriteSpec): string {
    const targets = new Set<string>();
    for (const hint of spec.directives) {
        const mappedTargets = DIRECTIVE_KIND_TO_REWRITE_TARGETS[hint.kind];
        if (mappedTargets) {
            for (const target of mappedTargets) {
                targets.add(target);
            }
        } else {
            targets.add(hint.reason);
        }
    }
    targets.add("preserve meter and measure count");

    const targetLines = [...targets].map((target) => `- ${target}`).join("\n");
    const keepLine = spec.keepSectionIds.length > 0
        ? `keep_sections=${spec.keepSectionIds.join(",")}`
        : "";
    const rewriteLine = `rewrite_sections=${spec.rewriteSectionIds.join(",")}`;

    const innerLines = [
        "mode=localized_section_rewrite",
        keepLine,
        rewriteLine,
        `reason="${spec.reason.replace(/"/g, "'")}"`,
        "target:",
        targetLines,
    ].filter(Boolean);

    return `<AXIOM_REWRITE>\n${innerLines.join("\n")}\n</AXIOM_REWRITE>`;
}

/** Maps PianoRevisionDirectiveKind to human-readable repair/rewrite target strings. */
const PIANO_DIRECTIVE_KIND_TO_TARGETS: Record<string, string[]> = {
    reduce_hand_span:                 ["keep maximum hand span <= 12 semitones", "arpeggiate chords that exceed the span limit"],
    smooth_left_hand_leaps:           ["reduce left-hand leap distance", "use stepwise or broken-chord motion in left hand"],
    clarify_right_hand_melody:        ["keep right-hand melody above accompaniment", "reduce inner-voice density that obscures the melody"],
    strengthen_left_hand_bass:        ["reinforce bass note on downbeats", "ensure left-hand lowest voice is rhythmically stable"],
    thin_overdense_chords:            ["use broken-chord accompaniment instead of dense block chords", "reduce simultaneous note count per hand"],
    improve_pedal_changes:            ["change sustain pedal on each new harmony", "avoid cross-harmony pedal blur"],
    separate_registers:               ["keep left-hand register below right-hand register", "resolve register collision between hands"],
    increase_accompaniment_consistency: ["apply uniform accompaniment pattern throughout the section", "avoid sudden texture changes within the section"],
    reduce_hand_crossing:             ["avoid hand-crossing unless idiomatic", "reposition voices to natural hand territories"],
    make_texture_more_pianistic:      ["replace non-pianistic writing with idiomatic piano figuration", "match texture to declared textureKind"],
};

/**
 * Build an `<AXIOM_PIANO_REWRITE>` block from a `LocalizedPianoRewriteSpec`.
 *
 * Native NotaGen that cannot act on this block should strip it and route the
 * request to PianoRepairSolver.  Fine-tuned piano rewrite models consume it
 * directly.  The block is always preserved in `pianoRewriteBlock` on the
 * provider request for downstream projection and dataset export.
 */
export function buildPianoRewriteBlock(spec: LocalizedPianoRewriteSpec): string {
    const targets = new Set<string>();
    for (const directive of spec.directives) {
        const mappedTargets = PIANO_DIRECTIVE_KIND_TO_TARGETS[directive.kind];
        if (mappedTargets) {
            for (const t of mappedTargets) targets.add(t);
        } else {
            targets.add(directive.reason);
        }
    }
    targets.add("preserve harmonic rhythm and measure count");

    const targetLines = [...targets].map((t) => `- ${t}`).join("\n");
    const keepLine = spec.keepSectionIds.length > 0
        ? `keep_sections=${spec.keepSectionIds.join(",")}`
        : "";
    const rewriteLine = `rewrite_sections=${spec.rewriteSectionIds.join(",")}`;

    // Fallback strategy summary: group directives by preferred strategy.
    const repairOnly = spec.directives.filter((d) => d.fallbackStrategy === "repairSolver").map((d) => d.kind);
    const rewriteOnly = spec.directives.filter((d) => d.fallbackStrategy === "rewrite").map((d) => d.kind);

    const innerLines = [
        "mode=localized_piano_rewrite",
        keepLine,
        rewriteLine,
        `reason="${spec.reason.replace(/"/g, "'")}"`,
        ...(spec.repairAlreadyApplied ? ["repair_already_applied=true"] : []),
        ...(repairOnly.length ? [`repair_solver_directives=${repairOnly.join(",")}`] : []),
        ...(rewriteOnly.length ? [`rewrite_directives=${rewriteOnly.join(",")}`] : []),
        "target:",
        targetLines,
    ].filter(Boolean);

    return `<AXIOM_PIANO_REWRITE>\n${innerLines.join("\n")}\n</AXIOM_PIANO_REWRITE>`;
}

/**
 * AXIOM identity composers — imported from src/core/identity/axiomStyleIdentity.ts.
 * JSON profile: config/style-profiles/axiom_beethoven_schubert_v1.json
 *
 * Beethoven = primary identity (dramatic, structural forms).
 * Schubert  = secondary identity (lyrical, characteristic forms).
 * SCHUBERT_FORM_KEYWORDS = form-keyword routing set for Schubert.
 */

/** Resolve the NotaGen composer identity string for this prompt pack. */
function resolveComposerIdentity(
    styleCue: LearnedSymbolicPromptPackStyleCue,
    candidateIndex?: number,
    candidatePoolSize?: number,
): string {
    // Explicit override always wins
    if (styleCue.composer) return normalizeText(styleCue.composer);

    // If an influenceBlend is present and we have a candidateIndex,
    // pre-assign slots to each active composer proportional to their weight,
    // then pick composer for candidateIndex by cumulative slot boundary.
    //
    // Example — Beethoven 0.55 + Schubert 0.45:
    //   poolSize=8  → Beethoven slots=4 (0-3), Schubert slots=4 (4-7)
    //   poolSize=16 → Beethoven slots=9 (0-8), Schubert slots=7 (9-15)
    //   poolSize=32 → Beethoven slots=18 (0-17), Schubert slots=14 (18-31)
    //
    // Rounding: each composer gets floor(weight * poolSize) slots.
    // Any remainder is given to the first composer to avoid under-assignment.
    if (styleCue.influenceBlend?.length && candidateIndex !== undefined) {
        const active = styleCue.influenceBlend.filter((e) => e.role !== "theory_only");
        if (active.length >= 2) {
            const pool = Math.max(1, candidatePoolSize ?? 8);
            const totalWeight = active.reduce((s, e) => s + e.weight, 0);

            // Assign floor slots first, then distribute remainder left-to-right
            const slots = active.map((e) =>
                Math.floor((e.weight / totalWeight) * pool)
            );
            let remainder = pool - slots.reduce((s, n) => s + n, 0);
            for (let i = 0; remainder > 0 && i < slots.length; i++) {
                slots[i]++;
                remainder--;
            }

            let boundary = 0;
            for (let i = 0; i < active.length; i++) {
                boundary += slots[i];
                if (candidateIndex < boundary) return normalizeText(active[i].composer);
            }
            // Fallback: last active entry
            return normalizeText(active[active.length - 1].composer);
        }
    }

    // Form-based fallback
    const formLower = (styleCue.form ?? "").toLowerCase();
    for (const kw of SCHUBERT_FORM_KEYWORDS) {
        if (formLower.includes(kw)) return AXIOM_IDENTITY_COMPOSER_LYRICAL;
    }
    return AXIOM_IDENTITY_COMPOSER_PRIMARY;
}

/** Render an influence_blend control line from an influenceBlend array. */
function buildInfluenceBlendLine(
    blend: Array<{ composer: string; weight: number; role: string }>,
): string {
    const parts = blend
        .filter((e) => e.role !== "theory_only")
        .map((e) => `${normalizeText(e.composer)}:${e.weight}`);
    return `influence_blend=${parts.join(",")}`;
}

export function buildLearnedNotagenProviderRequest(
    promptPack: LearnedSymbolicPromptPack,
    selectedModels: ModelBinding[] | undefined,
    opts?: LearnedNotagenProviderRequestOpts,
): LearnedNotagenProviderRequest {
    const structureBinding = resolveStructureBinding(selectedModels);
    const warnings: string[] = [];

    const conditioningText = buildConditioningText(promptPack);
    const meter = normalizeText(promptPack.styleCue.meter) || "4/4";
    const tempo = promptPack.styleCue.tempo ?? 92;
    const abcKey = resolveAbcKey(promptPack.styleCue.key ?? "C major");
    const instrumentationLine = resolveInstrumentationControlLine(promptPack, warnings);
    const composerIdentity = resolveComposerIdentity(promptPack.styleCue, opts?.candidateIndex, opts?.candidatePoolSize);

    // Hard constraints + structural control lines in deterministic order
    const controlLines: string[] = [
        `lane=${normalizeText(promptPack.lane)}`,
        `plan_signature=${normalizeText(promptPack.planSignature)}`,
        `prompt_pack_version=${normalizeText(promptPack.version)}`,
        `abc_format=interleaved`,
        `form=${normalizeText(promptPack.styleCue.form)}`,
        `key=${abcKey}`,
        `meter=${meter}`,
        `tempo=${tempo}`,
        instrumentationLine,
        `composer=${composerIdentity}`,
        ...(promptPack.styleCue.period ? [`period=${normalizeText(promptPack.styleCue.period)}`] : []),
        ...(promptPack.styleCue.lineageProfileId
            ? [`lineage_profile=${normalizeText(promptPack.styleCue.lineageProfileId)}`]
            : []),
        ...(promptPack.styleCue.influenceBlend?.length
            ? [buildInfluenceBlendLine(promptPack.styleCue.influenceBlend)]
            : []),
        // Piano-specific global header lines(present only when a PianoPlan is attached).
        // Preserved verbatim even when native NotaGen cannot follow all fields —
        // projection, evaluator, repair solver, and fine-tuning export pipelines rely on them.
        ...(promptPack.pianoPlan
            ? [`difficulty=${promptPack.pianoPlan.difficultyTarget}`]
            : []),
        ...(promptPack.pianoPlan
            ? [formatPianoGlobalControlLine(promptPack.pianoPlan)]
            : []),
        // Section lines: for piano plans, each `section` line is immediately followed by
        // its matching `piano_section` line so downstream consumers see them as pairs.
        ...promptPack.sections.flatMap((section) => {
            const sectionLine = formatSectionControlLine(section);
            if (!promptPack.pianoPlan) return [sectionLine];
            const pianoSection = promptPack.pianoPlan.sections.find(
                (ps) => ps.sectionId === section.sectionId,
            );
            return pianoSection
                ? [sectionLine, formatPianoSectionControlLine(pianoSection)]
                : [sectionLine];
        }),
        ...(promptPack.motifPolicy
            ? [
                `motif_policy reuse_required=${String(Boolean(promptPack.motifPolicy.reuseRequired))}`
                + ` inversion=${String(Boolean(promptPack.motifPolicy.inversionAllowed))}`
                + ` augmentation=${String(Boolean(promptPack.motifPolicy.augmentationAllowed))}`
                + ` diminution=${String(Boolean(promptPack.motifPolicy.diminutionAllowed))}`
                + ` sequence=${String(Boolean(promptPack.motifPolicy.sequenceAllowed))}`,
            ]
            : []),
        ...(promptPack.sketchSummary
            ? [`sketch motif_drafts=${promptPack.sketchSummary.motifDraftCount} cadence_options=${promptPack.sketchSummary.cadenceOptionCount}`]
            : []),
        ...(promptPack.revisionSummary?.attemptIndex !== undefined
            ? [`revision attempt=${promptPack.revisionSummary.attemptIndex}`]
            : []),
        ...(promptPack.revisionSummary?.directiveKinds?.length
            ? [`revision directive_kinds=${promptPack.revisionSummary.directiveKinds.map(normalizeText).join("|")}`]
            : []),
        ...(promptPack.revisionSummary?.targetedSectionIds?.length
            ? [`revision targeted_sections=${promptPack.revisionSummary.targetedSectionIds.map(normalizeText).join("|")}`]
            : []),
        // Sampling control line — only emitted when at least one sampling param is set
        ...(opts?.samplingParams && hasSamplingParams(opts.samplingParams)
            ? [buildSamplingControlLine(opts.samplingParams)]
            : []),
    ];

    // Soft-constraint lines (advisory; energy/density per section, global mood)
    const softConstraintLines: string[] = [
        ...promptPack.sections.map(
            (s) => `section_soft id=${normalizeText(s.sectionId)} energy=${s.energy} density=${s.density}`,
        ),
        ...(promptPack.styleCue.mood.length
            ? [`mood=${promptPack.styleCue.mood.map(normalizeText).join("|")}`]
            : []),
    ];

    // Metadata-only lines (not passed to NotaGen)
    const metadataLines: string[] = [
        ...(promptPack.styleCue.riskProfile ? [`risk_profile=${normalizeText(promptPack.styleCue.riskProfile)}`] : []),
        ...(promptPack.styleCue.intentRationale ? [`intent_rationale=${normalizeText(promptPack.styleCue.intentRationale)}`] : []),
        ...(promptPack.narrativeNotes?.length
            ? [`narrative_notes=${promptPack.narrativeNotes.map(normalizeText).join("|")}`]
            : []),
    ];

    return {
        adapter: "notagen_class",
        version: LEARNED_NOTAGEN_ADAPTER_VERSION,
        provider: normalizeText(structureBinding?.provider) || "learned",
        model: normalizeText(structureBinding?.model) || "learned-symbolic-trio-v1",
        promptPackVersion: promptPack.version,
        planSignature: promptPack.planSignature,
        conditioningText,
        controlLines,
        ...(softConstraintLines.length ? { softConstraintLines } : {}),
        ...(metadataLines.length ? { metadataLines } : {}),
        ...(warnings.length ? { warnings } : {}),
        abcHeader: buildAbcHeader(promptPack),
        ...(opts?.candidateIndex !== undefined ? { candidateIndex: opts.candidateIndex } : {}),
        ...(opts?.samplingParams && hasSamplingParams(opts.samplingParams) ? { samplingParams: opts.samplingParams } : {}),
        ...(opts?.localizedRewriteSpec ? { rewriteSpec: opts.localizedRewriteSpec } : {}),
        ...(opts?.localizedPianoRewriteSpec
            ? {
                pianoRewriteSpec: opts.localizedPianoRewriteSpec,
                pianoRewriteBlock: buildPianoRewriteBlock(opts.localizedPianoRewriteSpec),
            }
            : {}),
        ...((() => {
            const repairBlock = opts?.localizedRewriteSpec
                ? buildHarmonyRepairBlock(opts.localizedRewriteSpec.directives)
                : undefined;
            return repairBlock ? { repairBlock } : {};
        })()),
        ...((() => {
            const motifGraphBlock = promptPack.globalMotifGraph
                ? buildMotifGraphBlock(promptPack.globalMotifGraph)
                : undefined;
            return motifGraphBlock ? { motifGraphBlock } : {};
        })()),
    };
}