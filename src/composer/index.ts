import { v4 as uuidv4 } from "uuid";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
    ComposeExecutionPlan,
    ComposeProposalEvidence,
    ComposeRequest,
    ComposeResult,
    ComposeWorkflow,
    ComposeWorkerProgress,
    ModelBinding,
    SectionArtifactSummary,
    SectionTonalitySummary,
    SectionTransformSummary,
    SongMeta,
} from "../pipeline/types.js";
import { coerceComposeWorkflowForForm, isAudioFirstForm, requiresSymbolicFirstWorkflow } from "../pipeline/formTemplates.js";
import { defaultModelBindings } from "../pipeline/modelBindings.js";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import {
    buildLearnedSymbolicWorkerPayload,
    type LearnedSymbolicPromptPack,
} from "./learnedAdapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_SCRIPT = path.join(__dirname, "../../workers/composer/compose.py");
export const MUSICGEN_WORKER_SCRIPT = path.join(__dirname, "../../workers/composer/compose_musicgen.py");
export const LEARNED_SYMBOLIC_WORKER_SCRIPT = path.join(__dirname, "../../workers/composer/compose_learned_symbolic.py");

function ensureSongDir(songId: string): string {
    const songDir = path.join(config.outputDir, songId);
    fs.mkdirSync(songDir, { recursive: true });
    return songDir;
}

function composeProgressPath(songId: string): string {
    return path.join(config.outputDir, songId, "compose-progress.json");
}

function writeComposeProgress(songId: string, progress: ComposeWorkerProgress): void {
    const filePath = composeProgressPath(songId);
    ensureSongDir(songId);
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(progress, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
}

export function readComposeProgress(songId: string): ComposeWorkerProgress | null {
    const filePath = composeProgressPath(songId);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ComposeWorkerProgress;
    } catch {
        return null;
    }
}

export function isMusicGenForm(form?: string): boolean {
    return isAudioFirstForm(form);
}

function requestedAudioForStructureFirstForm(request: ComposeRequest): boolean {
    return request.workflow === "audio_only"
        || request.workflow === "symbolic_plus_audio"
        || request.compositionPlan?.workflow === "audio_only"
        || request.compositionPlan?.workflow === "symbolic_plus_audio"
        || (request.selectedModels?.some((binding) => binding.role === "audio_renderer") ?? false);
}

function coerceStructureFirstWorkflow(request: ComposeRequest, workflow: ComposeWorkflow | undefined): ComposeWorkflow | undefined {
    return coerceComposeWorkflowForForm(
        request.form ?? request.compositionPlan?.form,
        workflow,
        requestedAudioForStructureFirstForm(request)
            ? [...(request.selectedModels ?? []), { role: "audio_renderer", provider: "derived", model: "derived" }]
            : request.selectedModels,
    );
}

function ensureSelectedModelsForWorkflow(
    workflow: ComposeWorkflow,
    selectedModels: ModelBinding[] | undefined,
): ModelBinding[] {
    const baseBindings = selectedModels?.length
        ? selectedModels.map((binding) => ({ ...binding }))
        : [];
    if (baseBindings.length === 0) {
        return defaultModelBindings(workflow);
    }

    const roles = new Set(baseBindings.map((binding) => binding.role));
    const defaults = defaultModelBindings(workflow);

    for (const binding of defaults) {
        if (!roles.has(binding.role)) {
            baseBindings.push({ ...binding });
            roles.add(binding.role);
        }
    }

    return baseBindings;
}

function inferWorkflowFromBindings(bindings: ModelBinding[] | undefined): ComposeWorkflow | undefined {
    if (!bindings || bindings.length === 0) {
        return undefined;
    }

    const hasStructure = bindings.some((binding) => binding.role === "structure");
    const hasAudio = bindings.some((binding) => binding.role === "audio_renderer");

    if (hasStructure && hasAudio) {
        return "symbolic_plus_audio";
    }
    if (hasAudio) {
        return "audio_only";
    }
    if (hasStructure) {
        return "symbolic_only";
    }
    return undefined;
}

function resolveStructureBinding(selectedModels: ModelBinding[] | undefined): ModelBinding | undefined {
    return selectedModels?.find((binding) => binding.role === "structure");
}

function isLearnedSymbolicStructureBinding(binding: ModelBinding | undefined): boolean {
    if (!binding) {
        return false;
    }

    const provider = String(binding.provider ?? "").trim().toLowerCase();
    const model = String(binding.model ?? "").trim().toLowerCase();
    return provider === "learned"
        || provider === "learned_symbolic"
        || model.startsWith("learned-symbolic")
        || model.startsWith("learned_symbolic");
}

function resolveComposeWorkerName(
    workflow: ComposeWorkflow,
    selectedModels: ModelBinding[] | undefined,
): ComposeExecutionPlan["composeWorker"] {
    if (workflow === "audio_only") {
        return "musicgen";
    }

    return isLearnedSymbolicStructureBinding(resolveStructureBinding(selectedModels))
        ? "learned_symbolic"
        : "music21";
}

function buildMusic21FallbackExecutionPlan(executionPlan: ComposeExecutionPlan): ComposeExecutionPlan {
    const nonStructureBindings = executionPlan.selectedModels.filter((binding) => binding.role !== "structure");
    return {
        workflow: executionPlan.workflow,
        composeWorker: "music21",
        selectedModels: ensureSelectedModelsForWorkflow(executionPlan.workflow, [
            ...nonStructureBindings,
            {
                role: "structure",
                provider: "python",
                model: "music21-symbolic-v1",
            },
        ]),
    };
}

export function resolveComposeWorkflow(request: ComposeRequest): ComposeWorkflow {
    const inferredWorkflow = request.workflow
        ?? request.compositionPlan?.workflow
        ?? inferWorkflowFromBindings(request.selectedModels)
        ?? (isMusicGenForm(request.form) ? "audio_only" : "symbolic_only");

    return coerceStructureFirstWorkflow(request, inferredWorkflow) ?? "symbolic_only";
}

export function buildExecutionPlan(request: ComposeRequest): ComposeExecutionPlan {
    const workflow = resolveComposeWorkflow(request);
    const selectedModels = ensureSelectedModelsForWorkflow(workflow, request.selectedModels);
    return {
        workflow,
        composeWorker: resolveComposeWorkerName(workflow, selectedModels),
        selectedModels,
    };
}

// ── music21 워커 응답 ──────────────────────────────────
interface Music21Response {
    ok: boolean;
    midiPath?: string;
    measures?: number;
    notes?: number;
    partCount?: number;
    partInstrumentNames?: string[];
    key?: string;
    tempo?: number;
    form?: string;
    timeSignature?: string;
    style?: string;
    sectionArtifacts?: SectionArtifactSummary[];
    sectionTransforms?: SectionTransformSummary[];
    sectionTonalities?: SectionTonalitySummary[];
    error?: string;
}

// ── MusicGen 워커 응답 ────────────────────────────────
interface MusicGenResponse {
    ok: boolean;
    wavPath?: string;
    durationSec?: number;
    prompt?: string;
    error?: string;
}

interface LearnedSymbolicProposalEvent {
    kind: "note" | "chord" | "rest";
    quarterLength: number;
    midi?: number;
    midiPitches?: number[];
    velocity?: number;
    role?: string;
}

interface LearnedSymbolicProposalSection {
    sectionId: string;
    role: string;
    measureCount: number;
    tonalCenter?: string;
    phraseFunction?: string;
    leadEvents: LearnedSymbolicProposalEvent[];
    supportEvents: LearnedSymbolicProposalEvent[];
    noteHistory: number[];
    transform?: SectionTransformSummary;
}

interface LearnedSymbolicProposalResponse {
    ok: boolean;
    proposalMidiPath?: string;
    proposalSummary?: {
        measureCount?: number;
        noteCount?: number;
        partCount?: number;
        partInstrumentNames?: string[];
        key?: string;
        tempo?: number;
        form?: string;
    };
    proposalMetadata?: {
        lane?: string;
        provider?: string;
        model?: string;
        generationMode?: string;
        confidence?: number;
        normalizationWarnings?: string[];
    };
    proposalSections?: LearnedSymbolicProposalSection[];
    error?: string;
}

// ── 공통 헬퍼: Python 워커 실행 ───────────────────────
function runWorker<T>(
    script: string,
    input: string,
    timeoutMs: number,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const child = execFile(
            config.pythonBin,
            [script],
            {
                timeout: timeoutMs,
                maxBuffer: 8 * 1024 * 1024,
                env: { ...process.env, PYTHONWARNINGS: "ignore" },
            },
            (err, stdout, stderr) => {
                if (stderr) {
                    logger.warn("Composer worker stderr", { stderr: stderr.trim() });
                }
                if (err) {
                    return reject(new Error(`Worker failed: ${err.message}`));
                }
                try {
                    resolve(JSON.parse(stdout.trim()) as T);
                } catch {
                    reject(new Error(`Worker returned invalid JSON: ${stdout}`));
                }
            },
        );
        child.stdin?.write(input);
        child.stdin?.end();
    });
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

function normalizeLearnedSymbolicResponse(
    response: LearnedSymbolicProposalResponse,
    request: ComposeRequest,
    songId: string,
    executionPlan: ComposeExecutionPlan,
    promptPack: LearnedSymbolicPromptPack,
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
        noteHistory: [...section.noteHistory],
        ...(section.phraseFunction ? { phraseFunction: section.phraseFunction as SectionArtifactSummary["phraseFunction"] } : {}),
        textureVoiceCount: 3,
        primaryTextureRoles: ["lead", "counterline", "bass"] as NonNullable<SectionArtifactSummary["primaryTextureRoles"]>,
        counterpointMode: "contrary_motion" as SectionArtifactSummary["counterpointMode"],
        sectionStyle: section.transform
            ? (response.proposalMetadata?.generationMode ?? "learned_symbolic_proposal")
            : "plan_conditioned_trio_template",
        ...(section.transform ? { transform: { ...section.transform } } : {}),
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

// ── music21 경로 ──────────────────────────────────────
async function composeWithMusic21(
    request: ComposeRequest,
    songId: string,
    executionPlan: ComposeExecutionPlan,
): Promise<ComposeResult> {
    const songDir = ensureSongDir(songId);

    const midiOutputPath = path.join(songDir, "composition.mid");
    const seed = request.promptHash
        ? Number.parseInt(request.promptHash.slice(0, 8), 16)
        : undefined;
    const stableSeed = Number.parseInt(createHash("sha256").update(songId).digest("hex").slice(0, 8), 16);

    logger.info("Composing via music21 worker", {
        songId,
        prompt: request.prompt,
        workflow: executionPlan.workflow,
    });

    writeComposeProgress(songId, {
        worker: "music21",
        phase: "starting",
        updatedAt: new Date().toISOString(),
        detail: "Starting symbolic composition worker",
        outputPath: midiOutputPath,
    });

    let result: Music21Response;
    try {
        result = await runWorker<Music21Response>(
            WORKER_SCRIPT,
            JSON.stringify({
                prompt: request.prompt,
                ...(request.key ? { key: request.key } : {}),
                ...(request.tempo !== undefined ? { tempo: request.tempo } : {}),
                ...(request.form ? { form: request.form } : {}),
                ...(seed !== undefined ? { seed } : {}),
                stableSeed,
                ...(request.attemptIndex !== undefined ? { attemptIndex: request.attemptIndex } : {}),
                ...(request.compositionProfile ? { compositionProfile: request.compositionProfile } : {}),
                ...(request.revisionDirectives?.length ? { revisionDirectives: request.revisionDirectives } : {}),
                ...(request.sectionArtifacts?.length ? { sectionArtifacts: request.sectionArtifacts } : {}),
                ...(request.compositionPlan ? { compositionPlan: request.compositionPlan } : {}),
                outputPath: midiOutputPath,
            }),
            config.composeWorkerTimeoutMs,
        );
    } catch (error) {
        writeComposeProgress(songId, {
            worker: "music21",
            phase: "failed",
            updatedAt: new Date().toISOString(),
            detail: error instanceof Error ? error.message : String(error),
            outputPath: midiOutputPath,
        });
        throw error;
    }

    if (!result.ok) {
        writeComposeProgress(songId, {
            worker: "music21",
            phase: "failed",
            updatedAt: new Date().toISOString(),
            detail: result.error,
            outputPath: midiOutputPath,
        });
        throw new Error(`music21 worker error: ${result.error}`);
    }

    const midiData = fs.readFileSync(midiOutputPath);
    logger.info("Composition complete (music21)", { songId, measures: result.measures, notes: result.notes });

    writeComposeProgress(songId, {
        worker: "music21",
        phase: "completed",
        updatedAt: new Date().toISOString(),
        detail: "Symbolic composition finished",
        outputPath: midiOutputPath,
    });

    const meta: Partial<SongMeta> = {
        songId,
        prompt: request.prompt,
        key: result.key ?? request.key ?? "C major",
        tempo: result.tempo ?? request.tempo ?? 120,
        form: result.form ?? request.form ?? "miniature",
        workflow: executionPlan.workflow,
        plannerVersion: request.plannerVersion ?? request.compositionPlan?.version,
        plannedSectionCount: request.compositionPlan?.sections.length,
        selectedModels: executionPlan.selectedModels,
    };
    return {
        midiData,
        meta,
        compositionPlan: request.compositionPlan,
        executionPlan,
        sectionArtifacts: result.sectionArtifacts?.map((entry) => ({ ...entry })),
        sectionTransforms: result.sectionTransforms?.map((entry) => ({ ...entry })),
        sectionTonalities: result.sectionTonalities?.map((entry) => ({ ...entry })),
    };
}

// ── MusicGen-large 경로 ───────────────────────────────
async function composeWithMusicGen(
    request: ComposeRequest,
    songId: string,
    executionPlan: ComposeExecutionPlan,
): Promise<ComposeResult> {
    const songDir = ensureSongDir(songId);

    const wavOutputPath = path.join(songDir, "output.wav");
    const form = request.form ?? "largo";
    const requestedDurationSec = request.durationSec ?? request.compositionPlan?.targetDurationSec;

    logger.info("Composing via MusicGen-large worker", {
        songId,
        form,
        prompt: request.prompt,
        workflow: executionPlan.workflow,
    });

    if (request.recoveredFromRestart && fs.existsSync(wavOutputPath) && fs.statSync(wavOutputPath).size > 0) {
        writeComposeProgress(songId, {
            worker: "musicgen",
            phase: "completed",
            updatedAt: new Date().toISOString(),
            detail: request.recoveryNote || "Recovered existing MusicGen audio after restart",
            outputPath: wavOutputPath,
        });
        logger.info("Recovered existing MusicGen output after restart", { songId, wavOutputPath });

        return {
            meta: {
                songId,
                prompt: request.prompt,
                key: request.key,
                tempo: request.tempo,
                form,
                workflow: executionPlan.workflow,
                plannerVersion: request.plannerVersion ?? request.compositionPlan?.version,
                plannedSectionCount: request.compositionPlan?.sections.length,
                selectedModels: executionPlan.selectedModels,
            },
            isRendered: true,
            artifacts: { audio: wavOutputPath },
            compositionPlan: request.compositionPlan,
            executionPlan,
        };
    }

    writeComposeProgress(songId, {
        worker: "musicgen",
        phase: "starting",
        updatedAt: new Date().toISOString(),
        detail: request.recoveredFromRestart
            ? request.recoveryNote || "Restart recovery triggered a fresh MusicGen attempt"
            : "Preparing MusicGen worker",
        outputPath: wavOutputPath,
    });

    let result: MusicGenResponse;
    try {
        result = await runWorker<MusicGenResponse>(
            MUSICGEN_WORKER_SCRIPT,
            JSON.stringify({
                prompt: request.prompt,
                key: request.key,
                tempo: request.tempo,
                form,
                outputPath: wavOutputPath,
                progressPath: composeProgressPath(songId),
                recoveredFromRestart: request.recoveredFromRestart ?? false,
                recoveryNote: request.recoveryNote,
                // durationSec가 지정되면 워커에 전달 (미지정 시 form별 기본값 사용)
                ...(requestedDurationSec !== undefined && { durationSec: requestedDurationSec }),
            }),
            config.musicgenTimeoutMs,
        );
    } catch (error) {
        writeComposeProgress(songId, {
            worker: "musicgen",
            phase: "failed",
            updatedAt: new Date().toISOString(),
            detail: error instanceof Error ? error.message : String(error),
            outputPath: wavOutputPath,
        });
        throw error;
    }

    if (!result.ok) {
        writeComposeProgress(songId, {
            worker: "musicgen",
            phase: "failed",
            updatedAt: new Date().toISOString(),
            detail: result.error,
            outputPath: wavOutputPath,
        });
        throw new Error(`MusicGen worker error: ${result.error}`);
    }

    logger.info("Composition complete (MusicGen-large)", {
        songId,
        durationSec: result.durationSec,
    });

    writeComposeProgress(songId, {
        worker: "musicgen",
        phase: "completed",
        updatedAt: new Date().toISOString(),
        detail: request.recoveredFromRestart
            ? "MusicGen completed after restart recovery"
            : "MusicGen audio generation finished",
        outputPath: wavOutputPath,
        durationSec: result.durationSec,
    });

    const meta: Partial<SongMeta> = {
        songId,
        prompt: request.prompt,
        key: request.key,
        tempo: request.tempo,
        form,
        workflow: executionPlan.workflow,
        plannerVersion: request.plannerVersion ?? request.compositionPlan?.version,
        plannedSectionCount: request.compositionPlan?.sections.length,
        selectedModels: executionPlan.selectedModels,
    };

    return {
        meta,
        isRendered: true,
        artifacts: { audio: wavOutputPath },
        compositionPlan: request.compositionPlan,
        executionPlan,
    };
}

async function composeWithLearnedSymbolic(
    request: ComposeRequest,
    songId: string,
    executionPlan: ComposeExecutionPlan,
): Promise<ComposeResult> {
    const songDir = ensureSongDir(songId);
    const midiOutputPath = path.join(songDir, "composition.mid");
    const workerPayload = buildLearnedSymbolicWorkerPayload(request, songId, midiOutputPath, executionPlan);

    logger.info("Composing via learned symbolic proposal worker", {
        songId,
        prompt: request.prompt,
        workflow: executionPlan.workflow,
        promptPackVersion: workerPayload.promptPack.version,
        planSignature: workerPayload.promptPack.planSignature,
    });

    writeComposeProgress(songId, {
        worker: "learned_symbolic",
        phase: "starting",
        updatedAt: new Date().toISOString(),
        detail: "Starting learned symbolic proposal worker",
        outputPath: midiOutputPath,
    });

    let result: LearnedSymbolicProposalResponse;
    try {
        result = await runWorker<LearnedSymbolicProposalResponse>(
            LEARNED_SYMBOLIC_WORKER_SCRIPT,
            JSON.stringify(workerPayload),
            config.composeWorkerTimeoutMs,
        );
    } catch (error) {
        writeComposeProgress(songId, {
            worker: "learned_symbolic",
            phase: "failed",
            updatedAt: new Date().toISOString(),
            detail: error instanceof Error ? error.message : String(error),
            outputPath: midiOutputPath,
        });
        throw error;
    }

    if (!result.ok) {
        writeComposeProgress(songId, {
            worker: "learned_symbolic",
            phase: "failed",
            updatedAt: new Date().toISOString(),
            detail: result.error,
            outputPath: midiOutputPath,
        });
        throw new Error(`learned symbolic worker error: ${result.error}`);
    }

    writeComposeProgress(songId, {
        worker: "learned_symbolic",
        phase: "completed",
        updatedAt: new Date().toISOString(),
        detail: "Learned symbolic proposal finished",
        outputPath: midiOutputPath,
    });

    return normalizeLearnedSymbolicResponse(result, request, songId, executionPlan, workerPayload.promptPack);
}

// ── 공개 API ─────────────────────────────────────────
export async function compose(request: ComposeRequest): Promise<ComposeResult> {
    const songId = request.songId ?? uuidv4();
    const executionPlan = buildExecutionPlan(request);

    logger.info("Resolved compose execution plan", {
        songId,
        workflow: executionPlan.workflow,
        composeWorker: executionPlan.composeWorker,
        selectedModels: executionPlan.selectedModels.map((binding) => `${binding.role}:${binding.provider}:${binding.model}`),
    });

    if (executionPlan.composeWorker === "musicgen") {
        return composeWithMusicGen(request, songId, executionPlan);
    }
    if (executionPlan.composeWorker === "learned_symbolic") {
        try {
            return await composeWithLearnedSymbolic(request, songId, executionPlan);
        } catch (error) {
            const fallbackExecutionPlan = buildMusic21FallbackExecutionPlan(executionPlan);
            logger.warn("Learned symbolic proposal failed; falling back to music21 baseline", {
                songId,
                message: error instanceof Error ? error.message : String(error),
            });
            return composeWithMusic21({
                ...request,
                selectedModels: fallbackExecutionPlan.selectedModels,
            }, songId, fallbackExecutionPlan);
        }
    }
    return composeWithMusic21(request, songId, executionPlan);
}
