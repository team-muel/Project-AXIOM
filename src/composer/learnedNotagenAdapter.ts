import type { LearnedSamplingParams, ModelBinding } from "../pipeline/types.js";
import { STRING_TRIO_SYMBOLIC_LANE } from "../pipeline/learnedSymbolicContract.js";
import type {
    LearnedSymbolicPromptPack,
    LearnedSymbolicPromptPackSection,
} from "./learnedAdapter.js";

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

export interface LearnedNotagenProviderRequestOpts {
    candidateIndex?: number;
    samplingParams?: LearnedSamplingParams;
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
        ...promptPack.sections.map((section) => formatSectionControlLine(section)),
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
    };
}