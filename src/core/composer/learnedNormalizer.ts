import fs from "node:fs";
import { logger } from "../../logging/logger.js";
import type {
    ComposeExecutionPlan,
    ComposeProposalEvidence,
    ComposeRequest,
    ComposeResult,
    LearnedSamplingParams,
    ModelBinding,
    PianoVoiceLayoutSummary,
    SectionArtifactSummary,
    SectionTonalitySummary,
    SectionTransformSummary,
} from "../pipeline/types.js";
import type {
    LearnedSymbolicProposalEvent,
    LearnedSymbolicProposalResponse,
    LearnedSymbolicProposalSection,
} from "./learnedSymbolicContract.js";
import {
    resolveLearnedBenchmarkId,
    resolveLearnedBenchmarkPackVersion,
    type LearnedSymbolicPromptPack,
} from "./learnedAdapter.js";
import type { LearnedNotagenProviderRequest } from "./learnedNotagenAdapter.js";

function resolveStructureBinding(selectedModels: ModelBinding[] | undefined): ModelBinding | undefined {
    return selectedModels?.find((binding) => binding.role === "structure");
}

function normalizeLearnedProposalEvents(
    events: LearnedSymbolicProposalEvent[] | undefined,
): SectionArtifactSummary["melodyEvents"] {
    return (events ?? []).map((event) => {
        if (event.kind === "rest") {
            return {
                type: "rest",
                quarterLength: event.quarterLength,
            };
        }

        if (event.kind === "chord") {
            return {
                type: "chord",
                quarterLength: event.quarterLength,
                ...(typeof event.velocity === "number" ? { velocity: event.velocity } : {}),
                ...(Array.isArray(event.midiPitches) ? { pitches: [...event.midiPitches] } : {}),
                ...(event.role ? { voiceRole: event.role as SectionArtifactSummary["melodyEvents"][number]["voiceRole"] } : {}),
            };
        }

        return {
            type: "note",
            quarterLength: event.quarterLength,
            ...(typeof event.velocity === "number" ? { velocity: event.velocity } : {}),
            ...(typeof event.midi === "number" ? { pitch: event.midi } : {}),
            ...(event.role ? { voiceRole: event.role as SectionArtifactSummary["melodyEvents"][number]["voiceRole"] } : {}),
        };
    });
}

function normalizeNoteHistory(section: LearnedSymbolicProposalSection): number[] {
    if (Array.isArray(section.noteHistory)) {
        return [...section.noteHistory];
    }
    return [...(section.leadEvents ?? []), ...(section.supportEvents ?? [])]
        .flatMap((event) => {
            if (event.kind === "note" && typeof event.midi === "number") return [event.midi];
            if (event.kind === "chord" && Array.isArray(event.midiPitches)) return event.midiPitches;
            return [];
        });
}

export function normalizeLearnedSymbolicResponse(
    response: LearnedSymbolicProposalResponse,
    request: ComposeRequest,
    songId: string,
    executionPlan: ComposeExecutionPlan,
    promptPack: LearnedSymbolicPromptPack,
    providerRequest?: LearnedNotagenProviderRequest,
): ComposeResult {
    const midiPath = response.proposalMidiPath;
    const structureBinding = resolveStructureBinding(executionPlan.selectedModels);
    if (!midiPath || !fs.existsSync(midiPath) || fs.statSync(midiPath).size <= 0) {
        throw new Error("learned symbolic worker did not produce a valid MIDI proposal");
    }

    for (const warning of response.proposalMetadata?.normalizationWarnings ?? []) {
        logger.warn("Learned symbolic proposal normalization warning", {
            songId,
            warning,
        });
    }

    const sectionArtifacts = (response.proposalSections ?? []).map((section) => ({
        sectionId: section.sectionId,
        role: section.role as SectionArtifactSummary["role"],
        measureCount: section.measureCount,
        melodyEvents: normalizeLearnedProposalEvents(section.leadEvents),
        accompanimentEvents: normalizeLearnedProposalEvents(section.supportEvents),
        noteHistory: normalizeNoteHistory(section),
        ...(section.phraseFunction ? { phraseFunction: section.phraseFunction as SectionArtifactSummary["phraseFunction"] } : {}),
        textureVoiceCount: 3,
        primaryTextureRoles: ["lead", "counterline", "bass"] as NonNullable<SectionArtifactSummary["primaryTextureRoles"]>,
        counterpointMode: "contrary_motion" as SectionArtifactSummary["counterpointMode"],
        sectionStyle: section.transform
            ? (response.proposalMetadata?.generationMode ?? "learned_symbolic_proposal")
            : "plan_conditioned_trio_template",
        ...(section.transform ? { transform: { ...section.transform } } : {}),
        // evidence fields pass-through for craftScoring.ts
        ...(section.cadenceApproach !== undefined ? { cadenceApproach: section.cadenceApproach } : {}),
        ...(section.lastInterval !== undefined ? { lastInterval: section.lastInterval } : {}),
        ...(section.bassMotionProfile !== undefined ? { bassMotionProfile: section.bassMotionProfile } : {}),
        ...(section.textureContraryMotionRate !== undefined ? { textureContraryMotionRate: section.textureContraryMotionRate } : {}),
        ...(section.textureIndependentMotionRate !== undefined ? { textureIndependentMotionRate: section.textureIndependentMotionRate } : {}),
        ...(section.melodyPitchMin !== undefined ? { melodyPitchMin: section.melodyPitchMin } : {}),
        ...(section.melodyPitchMax !== undefined ? { melodyPitchMax: section.melodyPitchMax } : {}),
        ...(section.bassPitchMin !== undefined ? { bassPitchMin: section.bassPitchMin } : {}),
        ...(section.bassPitchMax !== undefined ? { bassPitchMax: section.bassPitchMax } : {}),
        ...(Array.isArray(section.phrasePeaks) && section.phrasePeaks.length > 0 ? { phrasePeaks: [...section.phrasePeaks] } : {}),
        ...(Array.isArray(section.secondaryLineMotif) && section.secondaryLineMotif.length > 0 ? { secondaryLineMotif: [...section.secondaryLineMotif] } : {}),
        ...(section.rhythmicDensity !== undefined ? { rhythmicDensity: section.rhythmicDensity } : {}),
        ...(Array.isArray(section.tonicizationWindows)
            ? { tonicizationWindows: section.tonicizationWindows.map((w) => ({ ...w })) }
            : {}),
        // Piano-specific evidence (solo_piano_symbolic lane only)
        ...(section.pianoVoiceLayout ? { pianoVoiceLayout: section.pianoVoiceLayout as PianoVoiceLayoutSummary } : {}),
        ...(Array.isArray(section.rightHandEvents) && section.rightHandEvents.length > 0
            ? { rightHandEvents: normalizeLearnedProposalEvents(section.rightHandEvents) } : {}),
        ...(Array.isArray(section.leftHandEvents) && section.leftHandEvents.length > 0
            ? { leftHandEvents: normalizeLearnedProposalEvents(section.leftHandEvents) } : {}),
        // Evidence contract fields derived by section_evidence.py (always populated by worker)
        ...(Array.isArray(section.harmonicColorCues) && section.harmonicColorCues.length > 0
            ? { harmonicColorCues: section.harmonicColorCues.map((c) => ({ ...c })) }
            : {}),
        ...(section.harmonicRealizationSummary !== undefined
            ? { harmonicRealizationSummary: { ...section.harmonicRealizationSummary } }
            : {}),
        ...(Array.isArray(section.capturedMotif) && section.capturedMotif.length > 0
            ? { capturedMotif: [...section.capturedMotif] }
            : {}),
    }));
    const sectionTransforms = (response.proposalSections ?? [])
        .filter((section): section is LearnedSymbolicProposalSection & { transform: SectionTransformSummary } => Boolean(section.transform))
        .map((section) => ({ ...section.transform }));

    const sectionTonalities = (response.proposalSections ?? [])
        .filter((section) => typeof section.tonalCenter === "string" && section.tonalCenter.trim())
        .map((section) => ({
            sectionId: section.sectionId,
            role: section.role as SectionTonalitySummary["role"],
            tonalCenter: String(section.tonalCenter).trim(),
        }));

    const proposalSummary = response.proposalSummary
        ? {
            ...(typeof response.proposalSummary.measureCount === "number" ? { measureCount: response.proposalSummary.measureCount } : {}),
            ...(typeof response.proposalSummary.noteCount === "number" ? { noteCount: response.proposalSummary.noteCount } : {}),
            ...(typeof response.proposalSummary.partCount === "number" ? { partCount: response.proposalSummary.partCount } : {}),
            ...(Array.isArray(response.proposalSummary.partInstrumentNames)
                ? { partInstrumentNames: [...response.proposalSummary.partInstrumentNames] }
                : {}),
            ...(typeof response.proposalSummary.key === "string" ? { key: response.proposalSummary.key } : {}),
            ...(typeof response.proposalSummary.tempo === "number" ? { tempo: response.proposalSummary.tempo } : {}),
            ...(typeof response.proposalSummary.form === "string" ? { form: response.proposalSummary.form } : {}),
        }
        : undefined;
    const normalizedWarnings = response.proposalMetadata?.normalizationWarnings?.length
        ? [...response.proposalMetadata.normalizationWarnings]
        : undefined;
    const benchmarkPackVersion = resolveLearnedBenchmarkPackVersion(promptPack);
    const benchmarkId = resolveLearnedBenchmarkId(promptPack);

    // Derive candidateIndex from variant key (learned-N → N-1 zero-based)
    const learnedVariantMatch = /^learned-(\d+)/.exec(request.candidateVariantKey ?? "");
    const resolvedCandidateIndex = learnedVariantMatch
        ? Math.max(0, Number.parseInt(learnedVariantMatch[1], 10) - 1)
        : undefined;
    const resolvedSamplingParams: LearnedSamplingParams | undefined = request.learnedSampling ?? undefined;

    const proposalEvidence: ComposeProposalEvidence = {
        worker: executionPlan.composeWorker,
        ...(typeof response.proposalMetadata?.lane === "string" && response.proposalMetadata.lane.trim()
            ? { lane: response.proposalMetadata.lane.trim() }
            : {}),
        ...(typeof response.proposalMetadata?.provider === "string" && response.proposalMetadata.provider.trim()
            ? { provider: response.proposalMetadata.provider.trim() }
            : (structureBinding?.provider ? { provider: structureBinding.provider } : {})),
        ...(typeof response.proposalMetadata?.model === "string" && response.proposalMetadata.model.trim()
            ? { model: response.proposalMetadata.model.trim() }
            : (structureBinding?.model ? { model: structureBinding.model } : {})),
        ...(benchmarkPackVersion ? { benchmarkPackVersion } : {}),
        ...(benchmarkId ? { benchmarkId } : {}),
        promptPackVersion: promptPack.version,
        planSignature: promptPack.planSignature,
        ...(typeof response.proposalMetadata?.generationMode === "string" && response.proposalMetadata.generationMode.trim()
            ? { generationMode: response.proposalMetadata.generationMode.trim() }
            : {}),
        ...(typeof response.proposalMetadata?.confidence === "number"
            ? { confidence: response.proposalMetadata.confidence }
            : {}),
        ...(normalizedWarnings ? { normalizationWarnings: normalizedWarnings } : {}),
        ...(proposalSummary && Object.keys(proposalSummary).length > 0 ? { summary: proposalSummary } : {}),
        ...(resolvedCandidateIndex !== undefined ? { candidateIndex: resolvedCandidateIndex } : {}),
        ...(resolvedSamplingParams ? { samplingParams: resolvedSamplingParams } : {}),
        // Store full input payloads so DPO export can reconstruct prompt/control pairs.
        promptPack: JSON.parse(JSON.stringify(promptPack)) as Record<string, unknown>,
        ...(providerRequest
            ? { providerRequest: JSON.parse(JSON.stringify(providerRequest)) as Record<string, unknown> }
            : {}),
        // Store ABC score text for SFT dataset export (training target).
        ...(typeof response.proposalAbcScore === "string" && response.proposalAbcScore.trim()
            ? { abcText: response.proposalAbcScore }
            : {}),
    };

    return {
        midiData: fs.readFileSync(midiPath),
        meta: {
            songId,
            prompt: request.prompt,
            key: response.proposalSummary?.key ?? request.key ?? request.compositionPlan?.key ?? promptPack.styleCue.key,
            tempo: response.proposalSummary?.tempo ?? request.tempo ?? request.compositionPlan?.tempo ?? promptPack.styleCue.tempo ?? 96,
            form: response.proposalSummary?.form ?? request.form ?? request.compositionPlan?.form ?? promptPack.styleCue.form,
            workflow: executionPlan.workflow,
            plannerVersion: request.plannerVersion ?? request.compositionPlan?.version,
            plannedSectionCount: request.compositionPlan?.sections.length,
            selectedModels: executionPlan.selectedModels,
        },
        compositionPlan: request.compositionPlan,
        executionPlan,
        proposalEvidence,
        ...(sectionArtifacts.length > 0 ? { sectionArtifacts } : {}),
        ...(sectionTransforms.length > 0 ? { sectionTransforms } : {}),
        ...(sectionTonalities.length > 0 ? { sectionTonalities } : {}),
    };
}
