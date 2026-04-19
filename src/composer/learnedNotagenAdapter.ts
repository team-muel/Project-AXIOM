import type { ModelBinding } from "../pipeline/types.js";
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
    controlLines: string[];
}

function normalizeText(value: string | undefined): string {
    return String(value ?? "").trim().replace(/\s+/g, " ");
}

function resolveStructureBinding(selectedModels: ModelBinding[] | undefined): ModelBinding | undefined {
    return selectedModels?.find((binding) => binding.role === "structure");
}

function formatSectionControlLine(section: LearnedSymbolicPromptPackSection): string {
    const attributes = [
        `id=${normalizeText(section.sectionId)}`,
        `role=${normalizeText(section.role)}`,
        `label=${normalizeText(section.label)}`,
        `measures=${section.measures}`,
        `energy=${section.energy}`,
        `density=${section.density}`,
        ...(section.phraseFunction ? [`phrase=${normalizeText(section.phraseFunction)}`] : []),
        ...(section.cadence ? [`cadence=${normalizeText(section.cadence)}`] : []),
        ...(section.harmonicPlan?.tonalCenter ? [`tonal_center=${normalizeText(section.harmonicPlan.tonalCenter)}`] : []),
        ...(section.harmonicPlan?.keyTarget ? [`key_target=${normalizeText(section.harmonicPlan.keyTarget)}`] : []),
        ...(section.harmonicPlan?.harmonicRhythm ? [`harmonic_rhythm=${normalizeText(section.harmonicPlan.harmonicRhythm)}`] : []),
        ...(section.harmonicPlan?.prolongationMode ? [`prolongation=${normalizeText(section.harmonicPlan.prolongationMode)}`] : []),
        ...(section.textureRoleHints?.length ? [`texture_roles=${section.textureRoleHints.map(normalizeText).join("|")}`] : []),
        ...(section.counterpointMode ? [`counterpoint=${normalizeText(section.counterpointMode)}`] : []),
        ...(section.notes?.length ? [`notes=${section.notes.map(normalizeText).join("|")}`] : []),
    ];
    return `section ${attributes.join(" ")}`;
}

export function buildLearnedNotagenProviderRequest(
    promptPack: LearnedSymbolicPromptPack,
    selectedModels: ModelBinding[] | undefined,
): LearnedNotagenProviderRequest {
    const structureBinding = resolveStructureBinding(selectedModels);
    const mood = promptPack.styleCue.mood.length ? ` Mood: ${promptPack.styleCue.mood.map(normalizeText).join(", ")}.` : "";
    const titleHint = promptPack.styleCue.titleHint ? ` Title hint: ${normalizeText(promptPack.styleCue.titleHint)}.` : "";
    const rationale = promptPack.narrativeNotes?.length
        ? ` Narrative notes: ${promptPack.narrativeNotes.map(normalizeText).join(" | ")}.`
        : "";
    const instrumentation = promptPack.instrumentation.length
        ? promptPack.instrumentation.map((entry) => normalizeText(entry.name)).join(", ")
        : normalizeText(promptPack.styleCue.instrumentationLabel);
    const tempo = promptPack.styleCue.tempo !== undefined ? ` at ${promptPack.styleCue.tempo} BPM` : "";
    const conditioningText = normalizeText(
        `Compose a ${normalizeText(promptPack.styleCue.form)} for ${instrumentation}${tempo} in ${normalizeText(promptPack.styleCue.key)}.`
        + ` Brief: ${normalizeText(promptPack.styleCue.brief)}.`
        + mood
        + titleHint
        + rationale,
    );

    const controlLines = [
        `lane=${normalizeText(promptPack.lane)}`,
        `plan_signature=${normalizeText(promptPack.planSignature)}`,
        `prompt_pack_version=${normalizeText(promptPack.version)}`,
        `instrumentation=${promptPack.instrumentation.map((entry) => `${normalizeText(entry.name)}:${entry.roles.map(normalizeText).join("|")}`).join(",") || "default"}`,
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
    };
}