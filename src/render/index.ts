import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import type {
    ArtifactPaths,
    ComposeRequest,
    TextureGuidance,
    DynamicsProfile,
    ExpressionGuidance,
    ExpressionPlanSidecar,
    HarmonicColorCue,
    HarmonicPlan,
    OrnamentPlan,
    PhraseBreathPlan,
    RenderResult,
    SectionArtifactSummary,
    SectionPlan,
    TempoMotionPlan,
    TonicizationWindow,
} from "../pipeline/types.js";
import { logger } from "../logging/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_SCRIPT = path.join(__dirname, "../../workers/render/render.py");
export const STYLE_WORKER_SCRIPT = path.join(__dirname, "../../workers/composer/compose_musicgen.py");

interface WorkerResponse {
    ok: boolean;
    wavPath?: string;
    scoreImage?: string | null;
    videoPath?: string | null;
    durationSec?: number;
    warnings?: string[];
    error?: string;
}

interface StyledAudioWorkerResponse {
    ok: boolean;
    wavPath?: string;
    durationSec?: number;
    prompt?: string;
    error?: string;
}

interface RenderOptions {
    expressionPlan?: ExpressionPlanSidecar;
    sectionArtifacts?: SectionArtifactSummary[];
    sections?: SectionPlan[];
}

interface RenderWorkerInput {
    midiPath: string;
    outputDir: string;
    soundfontPath?: string;
    ffmpegBin?: string;
    expressionSummaryLines?: string[];
}

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function compactList(values: Array<string | undefined | null>): string[] {
    return values
        .map((value) => compact(value))
        .filter(Boolean);
}

function formatBias(label: string, value: number | undefined): string | null {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return null;
    }

    const normalized = value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
    return `${label} ${normalized}`;
}

function summarizeDynamicsProfile(dynamics: DynamicsProfile | undefined): string | null {
    if (!dynamics) {
        return null;
    }

    const arc = [dynamics.start, dynamics.peak, dynamics.end]
        .map((value) => compact(value))
        .filter(Boolean);
    const hairpins = (dynamics.hairpins ?? [])
        .map((hairpin) => {
            const shape = compact(hairpin.shape);
            const span = [hairpin.startMeasure, hairpin.endMeasure]
                .filter((value) => typeof value === "number")
                .join("-");
            const target = compact(hairpin.target);
            return [shape, span ? `m${span}` : "", target ? `to ${target}` : ""]
                .filter(Boolean)
                .join(" ");
        })
        .filter(Boolean);

    const fragments = [];
    if (arc.length > 0) {
        fragments.push(`dyn ${arc.join("->")}`);
    }
    if (hairpins.length > 0) {
        fragments.push(`hairpins ${hairpins.join(", ")}`);
    }

    return fragments.length > 0 ? fragments.join(" | ") : null;
}

function summarizeExpressionGuidance(expression: ExpressionGuidance | undefined): string[] {
    if (!expression) {
        return [];
    }

    return compactList([
        summarizeDynamicsProfile(expression.dynamics),
        expression.articulation?.length ? `art ${expression.articulation.join("/")}` : null,
        expression.character?.length ? `char ${expression.character.join("/")}` : null,
        expression.phrasePeaks?.length ? `peaks ${expression.phrasePeaks.join(",")}` : null,
        formatBias("sustain", expression.sustainBias),
        formatBias("accent", expression.accentBias),
        expression.notes?.length ? `notes ${expression.notes.slice(0, 2).join("; ")}` : null,
    ]);
}

function formatTempoMotionTag(tag: string | undefined): string | null {
    const normalized = compact(tag)
        .toLowerCase()
        .replace(/[\u2019']/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_");

    if (!normalized) {
        return null;
    }

    if (normalized === "a_tempo") {
        return "a tempo";
    }

    if (normalized === "tempo_l_istesso") {
        return "tempo l'istesso";
    }

    return normalized;
}

function formatMeasureSpan(startMeasure: number | undefined, endMeasure: number | undefined): string | null {
    if (typeof startMeasure === "number" && typeof endMeasure === "number") {
        return startMeasure === endMeasure ? `m${startMeasure}` : `m${startMeasure}-${endMeasure}`;
    }

    if (typeof startMeasure === "number") {
        return `m${startMeasure}`;
    }

    if (typeof endMeasure === "number") {
        return `m${endMeasure}`;
    }

    return null;
}

function formatMeasureList(values: number[] | undefined): string | null {
    if (!values?.length) {
        return null;
    }

    const normalized = values
        .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value));
    if (!normalized.length) {
        return null;
    }

    return `m${normalized.join(",")}`;
}

function summarizePhraseBreathPlan(phraseBreath: PhraseBreathPlan | undefined): string[] {
    if (!phraseBreath) {
        return [];
    }

    const fragments = compactList([
        formatMeasureSpan(phraseBreath.pickupStartMeasure, phraseBreath.pickupEndMeasure)
            ? `pickup ${formatMeasureSpan(phraseBreath.pickupStartMeasure, phraseBreath.pickupEndMeasure)}`
            : null,
        typeof phraseBreath.arrivalMeasure === "number" ? `arrival m${phraseBreath.arrivalMeasure}` : null,
        formatMeasureSpan(phraseBreath.releaseStartMeasure, phraseBreath.releaseEndMeasure)
            ? `release ${formatMeasureSpan(phraseBreath.releaseStartMeasure, phraseBreath.releaseEndMeasure)}`
            : null,
        formatMeasureSpan(phraseBreath.cadenceRecoveryStartMeasure, phraseBreath.cadenceRecoveryEndMeasure)
            ? `recover ${formatMeasureSpan(phraseBreath.cadenceRecoveryStartMeasure, phraseBreath.cadenceRecoveryEndMeasure)}`
            : null,
        formatMeasureList(phraseBreath.rubatoAnchors) ? `rubato ${formatMeasureList(phraseBreath.rubatoAnchors)}` : null,
    ]);

    return fragments.length > 0 ? [`breath ${fragments.join(", ")}`] : [];
}

function formatProfileMetric(value: number | undefined): string | null {
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : null;
}

function summarizePhraseBreathRealization(
    summary: SectionArtifactSummary["phraseBreathSummary"] | undefined,
): string[] {
    if (!summary || summary.targetedMeasureCount <= 0) {
        return [];
    }

    const cueDetails = compactList([
        summary.pickupMeasureCount
            ? `pickup d${formatProfileMetric(summary.pickupAverageDurationScale) ?? "-"}/j${formatProfileMetric(summary.pickupAverageTimingJitterScale) ?? "-"}`
            : null,
        summary.arrivalMeasureCount
            ? `arrival d${formatProfileMetric(summary.arrivalAverageDurationScale) ?? "-"}/e${formatProfileMetric(summary.arrivalAverageEndingStretchScale) ?? "-"}`
            : null,
        summary.releaseMeasureCount
            ? `release d${formatProfileMetric(summary.releaseAverageDurationScale) ?? "-"}/e${formatProfileMetric(summary.releaseAverageEndingStretchScale) ?? "-"}`
            : null,
        summary.cadenceRecoveryMeasureCount
            ? `recover d${formatProfileMetric(summary.cadenceRecoveryAverageDurationScale) ?? "-"}/j${formatProfileMetric(summary.cadenceRecoveryAverageTimingJitterScale) ?? "-"}`
            : null,
        summary.rubatoAnchorCount
            ? `rubato d${formatProfileMetric(summary.rubatoAnchorAverageDurationScale) ?? "-"}/j${formatProfileMetric(summary.rubatoAnchorAverageTimingJitterScale) ?? "-"}`
            : null,
    ]);

    const fragments = [
        `breath fit ${summary.realizedMeasureCount}/${summary.targetedMeasureCount}`,
        ...cueDetails,
    ];

    return [fragments.join(" ")];
}

function summarizeHarmonicRealization(
    summary: SectionArtifactSummary["harmonicRealizationSummary"] | undefined,
): string[] {
    if (!summary || summary.targetedMeasureCount <= 0) {
        return [];
    }

    const cueDetails = compactList([
        summary.prolongationMeasureCount
            ? `prolong d${formatProfileMetric(summary.prolongationAverageDurationScale) ?? "-"}/e${formatProfileMetric(summary.prolongationAverageEndingStretchScale) ?? "-"}`
            : null,
        summary.tonicizationMeasureCount
            ? `tonicize d${formatProfileMetric(summary.tonicizationAverageDurationScale) ?? "-"}/e${formatProfileMetric(summary.tonicizationAverageEndingStretchScale) ?? "-"}`
            : null,
        summary.harmonicColorMeasureCount
            ? `color d${formatProfileMetric(summary.harmonicColorAverageDurationScale) ?? "-"}/e${formatProfileMetric(summary.harmonicColorAverageEndingStretchScale) ?? "-"}`
            : null,
    ]);

    const fragments = [
        `harm fit ${summary.realizedMeasureCount}/${summary.targetedMeasureCount}`,
        ...cueDetails.slice(0, 3),
    ];

    return [fragments.join(" ")];
}

function formatHarmonicColorTag(tag: string | undefined): string | null {
    const normalized = compact(tag)
        .toLowerCase()
        .replace(/[\u2019']/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_");

    return normalized ? normalized.replace(/_/g, "-") : null;
}

function summarizeTonicizationWindows(windows: TonicizationWindow[] | undefined): string[] {
    if (!windows?.length) {
        return [];
    }

    return windows.slice(0, 2).flatMap((window) => {
        const keyTarget = compact(window.keyTarget);
        if (!keyTarget) {
            return [];
        }

        const fragments = compactList([
            `tonicize ${keyTarget}`,
            formatMeasureSpan(window.startMeasure, window.endMeasure),
            compact(window.emphasis).replace(/_/g, "-"),
        ]);

        return fragments.length > 0 ? [fragments.join(" ")] : [];
    });
}

function summarizeHarmonicColorCues(colorCues: HarmonicColorCue[] | undefined): string[] {
    if (!colorCues?.length) {
        return [];
    }

    return colorCues.slice(0, 2).flatMap((cue) => {
        const tag = formatHarmonicColorTag(cue.tag);
        if (!tag) {
            return [];
        }

        const fragments = compactList([
            `color ${tag}`,
            formatMeasureSpan(cue.startMeasure, cue.endMeasure),
            typeof cue.resolutionMeasure === "number" ? `res m${cue.resolutionMeasure}` : null,
            compact(cue.keyTarget) ? `to ${compact(cue.keyTarget)}` : null,
        ]);

        return fragments.length > 0 ? [fragments.join(" ")] : [];
    });
}

function summarizeHarmonicPlan(
    harmonicPlan: HarmonicPlan | undefined,
    sectionArtifact: SectionArtifactSummary | undefined,
): string[] {
    const prolongationMode = sectionArtifact?.prolongationMode ?? harmonicPlan?.prolongationMode;
    const tonicizationWindows = sectionArtifact?.tonicizationWindows ?? harmonicPlan?.tonicizationWindows;
    const harmonicColorCues = sectionArtifact?.harmonicColorCues ?? harmonicPlan?.colorCues;

    return compactList([
        prolongationMode ? `prolong ${prolongationMode}` : null,
        ...summarizeTonicizationWindows(tonicizationWindows),
        ...summarizeHarmonicColorCues(harmonicColorCues),
    ]);
}

function summarizeTempoMotionPlans(tempoMotion: TempoMotionPlan[] | undefined): string[] {
    if (!tempoMotion?.length) {
        return [];
    }

    return tempoMotion.slice(0, 3).flatMap((entry) => {
        const tag = formatTempoMotionTag(entry.tag);
        if (!tag) {
            return [];
        }

        const fragments = compactList([
            `tempo ${tag}`,
            formatMeasureSpan(entry.startMeasure, entry.endMeasure),
            typeof entry.intensity === "number" && !Number.isNaN(entry.intensity) ? `@${entry.intensity.toFixed(2)}` : null,
            entry.notes?.length ? `notes ${entry.notes[0]}` : null,
        ]);

        return fragments.length > 0 ? [fragments.join(" ")] : [];
    });
}

function formatOrnamentTag(tag: string | undefined): string | null {
    const normalized = compact(tag)
        .toLowerCase()
        .replace(/[\u2019']/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_");

    return normalized || null;
}

function summarizeOrnamentPlans(ornaments: OrnamentPlan[] | undefined): string[] {
    if (!ornaments?.length) {
        return [];
    }

    return ornaments.slice(0, 3).flatMap((entry) => {
        const tag = formatOrnamentTag(entry.tag);
        if (!tag) {
            return [];
        }

        const fragments = compactList([
            `orn ${tag}`,
            formatMeasureSpan(entry.startMeasure, entry.endMeasure),
            typeof entry.targetBeat === "number" && !Number.isNaN(entry.targetBeat) ? `b${entry.targetBeat}` : null,
            typeof entry.intensity === "number" && !Number.isNaN(entry.intensity) ? `@${entry.intensity.toFixed(2)}` : null,
            entry.notes?.length ? `notes ${entry.notes[0]}` : null,
        ]);

        return fragments.length > 0 ? [fragments.join(" ")] : [];
    });
}

function summarizeTextureGuidance(texture: TextureGuidance | undefined): string[] {
    if (!texture) {
        return [];
    }

    return compactList([
        typeof texture.voiceCount === "number" ? `tex ${texture.voiceCount}v` : null,
        texture.primaryRoles?.length ? `roles ${texture.primaryRoles.join("/")}` : null,
        texture.counterpointMode ? `cp ${texture.counterpointMode}` : null,
        texture.notes?.length ? `texture ${texture.notes.slice(0, 2).join("; ")}` : null,
    ]);
}

function summarizePhraseFunction(phraseFunction: string | undefined): string | null {
    return compact(phraseFunction) ? `phrase ${compact(phraseFunction)}` : null;
}

function textureGuidanceFromArtifact(sectionArtifact: SectionArtifactSummary | undefined): TextureGuidance | undefined {
    if (!sectionArtifact) {
        return undefined;
    }

    const texture: TextureGuidance = {};
    if (typeof sectionArtifact.textureVoiceCount === "number") {
        texture.voiceCount = sectionArtifact.textureVoiceCount;
    }
    if (sectionArtifact.primaryTextureRoles?.length) {
        texture.primaryRoles = [...sectionArtifact.primaryTextureRoles];
    }
    if (sectionArtifact.counterpointMode) {
        texture.counterpointMode = sectionArtifact.counterpointMode;
    }
    if (sectionArtifact.textureNotes?.length) {
        texture.notes = [...sectionArtifact.textureNotes];
    }

    return Object.keys(texture).length > 0 ? texture : undefined;
}

function formatVelocityRange(sectionArtifact: SectionArtifactSummary | undefined): string | null {
    if (!sectionArtifact) {
        return null;
    }

    const ranges = compactList([
        (typeof sectionArtifact.melodyVelocityMin === "number" && typeof sectionArtifact.melodyVelocityMax === "number")
            ? `mel ${sectionArtifact.melodyVelocityMin}-${sectionArtifact.melodyVelocityMax}`
            : null,
        (typeof sectionArtifact.accompanimentVelocityMin === "number" && typeof sectionArtifact.accompanimentVelocityMax === "number")
            ? `acc ${sectionArtifact.accompanimentVelocityMin}-${sectionArtifact.accompanimentVelocityMax}`
            : null,
    ]);

    return ranges.length > 0 ? `vel ${ranges.join(" / ")}` : null;
}

function resolveSectionLabel(sectionId: string, sections: SectionPlan[] | undefined): string {
    const match = sections?.find((section) => section.id === sectionId);
    return match ? `${match.label} (${match.role})` : sectionId;
}

export function buildRenderExpressionSummaryLines(options: RenderOptions = {}): string[] {
    const lines: string[] = [];
    const expressionPlan = options.expressionPlan;
    const sectionArtifacts = options.sectionArtifacts ?? [];
    const sections = options.sections ?? [];
    const sidecarSectionsById = new Map(
        (expressionPlan?.sections ?? []).map((section) => [section.sectionId, section]),
    );
    const sectionPlanById = new Map(sections.map((section) => [section.id, section]));
    const sectionArtifactById = new Map(sectionArtifacts.map((artifact) => [artifact.sectionId, artifact]));

    if (expressionPlan?.humanizationStyle) {
        lines.push(`Humanize: ${expressionPlan.humanizationStyle}`);
    }

    const defaultFragments = compactList([
        ...summarizeTextureGuidance(expressionPlan?.textureDefaults),
        ...summarizeExpressionGuidance(expressionPlan?.expressionDefaults),
        ...summarizeTempoMotionPlans(expressionPlan?.tempoMotionDefaults),
        ...summarizeOrnamentPlans(expressionPlan?.ornamentDefaults),
    ]);
    if (defaultFragments.length > 0) {
        lines.push(`Defaults: ${defaultFragments.join(" | ")}`);
    }

    const sectionIds = new Set<string>([
        ...Array.from(sidecarSectionsById.keys()),
        ...Array.from(sectionPlanById.keys()),
        ...sectionArtifacts.map((artifact) => artifact.sectionId),
    ]);
    for (const sectionId of Array.from(sectionIds).slice(0, 6)) {
        const sectionEntry = sidecarSectionsById.get(sectionId);
        const sectionPlan = sectionPlanById.get(sectionId);
        const sectionArtifact = sectionArtifactById.get(sectionId);
        const fragments = compactList([
            summarizePhraseFunction(sectionEntry?.phraseFunction ?? sectionPlan?.phraseFunction ?? sectionArtifact?.phraseFunction),
            ...summarizePhraseBreathPlan(sectionEntry?.phraseBreath ?? sectionPlan?.phraseBreath),
            ...summarizePhraseBreathRealization(sectionArtifact?.phraseBreathSummary),
            ...summarizeTextureGuidance(sectionEntry?.texture ?? sectionPlan?.texture ?? textureGuidanceFromArtifact(sectionArtifact)),
            ...summarizeExpressionGuidance(sectionEntry?.expression ?? sectionPlan?.expression),
            ...summarizeTempoMotionPlans(sectionEntry?.tempoMotion ?? sectionPlan?.tempoMotion),
            ...summarizeOrnamentPlans(sectionEntry?.ornaments ?? sectionPlan?.ornaments),
            ...summarizeHarmonicPlan(sectionPlan?.harmonicPlan, sectionArtifact),
            ...summarizeHarmonicRealization(sectionArtifact?.harmonicRealizationSummary),
        ]);
        const velocity = formatVelocityRange(sectionArtifact);
        const sectionLabel = resolveSectionLabel(sectionId, sections);
        const summary = compactList([...fragments, velocity]);
        if (summary.length === 0) {
            continue;
        }
        lines.push(`${sectionLabel}: ${summary.join(" | ")}`);
    }

    return lines;
}

export function buildRenderWorkerInput(params: RenderWorkerInput): RenderWorkerInput {
    return {
        midiPath: params.midiPath,
        outputDir: params.outputDir,
        ...(params.soundfontPath ? { soundfontPath: params.soundfontPath } : {}),
        ...(params.ffmpegBin ? { ffmpegBin: params.ffmpegBin } : {}),
        ...(params.expressionSummaryLines?.length ? { expressionSummaryLines: params.expressionSummaryLines } : {}),
    };
}

function buildExpressionPromptFragments(request: ComposeRequest): string[] {
    const plan = request.compositionPlan;
    if (!plan) {
        return [];
    }

    const fragments: string[] = [];
    const textureSummary = summarizeTextureGuidance(plan.textureDefaults);
    if (textureSummary.length > 0) {
        fragments.push(`texture defaults: ${textureSummary.join(", ")}`);
    }

    const defaultSummary = summarizeExpressionGuidance(plan.expressionDefaults);
    if (defaultSummary.length > 0) {
        fragments.push(`expression defaults: ${defaultSummary.join(", ")}`);
    }

    const tempoMotionSummary = summarizeTempoMotionPlans(plan.tempoMotionDefaults);
    if (tempoMotionSummary.length > 0) {
        fragments.push(`tempo motion defaults: ${tempoMotionSummary.join(", ")}`);
    }

    const ornamentSummary = summarizeOrnamentPlans(plan.ornamentDefaults);
    if (ornamentSummary.length > 0) {
        fragments.push(`ornament defaults: ${ornamentSummary.join(", ")}`);
    }

    const sectionSummary = plan.sections
        .map((section) => {
            const summary = compactList([
                summarizePhraseFunction(section.phraseFunction),
                ...summarizeTextureGuidance(section.texture),
                ...summarizeExpressionGuidance(section.expression),
                ...summarizeTempoMotionPlans(section.tempoMotion),
                ...summarizeOrnamentPlans(section.ornaments),
            ]);
            if (summary.length === 0) {
                return null;
            }

            return `${section.label} ${summary.join(", ")}`;
        })
        .filter((value): value is string => Boolean(value));
    if (sectionSummary.length > 0) {
        fragments.push(`section expression: ${sectionSummary.join("; ")}`);
    }

    return fragments;
}

export function buildStyledAudioPrompt(request: ComposeRequest): string {
    const fragments = [compact(request.prompt)];
    const plan = request.compositionPlan;

    if (plan?.brief && compact(plan.brief) !== compact(request.prompt)) {
        fragments.push(compact(plan.brief));
    }

    if (plan?.mood.length) {
        fragments.push(`mood: ${plan.mood.join(", ")}`);
    }

    if (plan?.instrumentation.length) {
        fragments.push(`instrumentation: ${plan.instrumentation.map((instrument) => instrument.name).join(", ")}`);
    }

    if (plan?.sections.length) {
        fragments.push(`sections: ${plan.sections.map((section) => `${section.label} (${section.role})`).join("; ")}`);
    }

    fragments.push(...buildExpressionPromptFragments(request));

    return fragments.filter(Boolean).join(". ");
}

function quarterNotesPerMeasure(meter: string | undefined): number | undefined {
    const normalized = compact(meter);
    const match = /^(\d+)\s*\/\s*(\d+)$/.exec(normalized);
    if (!match) {
        return undefined;
    }

    const numerator = Number.parseInt(match[1], 10);
    const denominator = Number.parseInt(match[2], 10);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
        return undefined;
    }

    return numerator * (4 / denominator);
}

function estimatePlannedAudioDurationSec(request: ComposeRequest): number | undefined {
    const sections = request.compositionPlan?.sections;
    const tempo = request.tempo ?? request.compositionPlan?.tempo;
    if (!sections?.length || typeof tempo !== "number" || !Number.isFinite(tempo) || tempo <= 0) {
        return undefined;
    }

    const totalMeasures = sections.reduce((sum, section) => (
        Number.isFinite(section.measures) && section.measures > 0 ? sum + section.measures : sum
    ), 0);
    if (totalMeasures <= 0) {
        return undefined;
    }

    const beats = quarterNotesPerMeasure(request.compositionPlan?.meter) ?? 4;
    return Number(((totalMeasures * beats * 60) / tempo).toFixed(2));
}

export function resolveRequestedAudioDurationSec(request: ComposeRequest): number | undefined {
    const explicitDuration = request.durationSec ?? request.compositionPlan?.targetDurationSec;
    if (typeof explicitDuration === "number" && Number.isFinite(explicitDuration) && explicitDuration > 0) {
        return explicitDuration;
    }

    return estimatePlannedAudioDurationSec(request);
}

export function mergeRenderedAndStyledArtifacts(
    renderedArtifacts: ArtifactPaths,
    styledArtifacts: ArtifactPaths,
): ArtifactPaths {
    const styledAudio = styledArtifacts.styledAudio ?? styledArtifacts.audio;
    const renderedAudio = renderedArtifacts.audio ?? renderedArtifacts.renderedAudio;

    return {
        ...renderedArtifacts,
        ...styledArtifacts,
        ...(renderedAudio ? { renderedAudio } : {}),
        ...(renderedAudio ? { audio: renderedAudio } : {}),
        ...(styledAudio ? {
            styledAudio,
        } : {}),
    };
}

export async function render(
    midiData: Buffer,
    songId: string,
    options?: RenderOptions,
): Promise<RenderResult> {
    logger.info("Rendering", { songId });

    const songDir = path.join(config.outputDir, songId);
    if (!fs.existsSync(songDir)) {
        fs.mkdirSync(songDir, { recursive: true });
    }

    // humanized.mid가 있으면 그것을 렌더링 소스로 사용한다.
    // composition.mid(원본)는 덮어쓰지 않는다.
    const humanizedPath = path.join(songDir, "humanized.mid");
    const compositionPath = path.join(songDir, "composition.mid");

    let renderMidiPath: string;
    if (fs.existsSync(humanizedPath)) {
        renderMidiPath = humanizedPath;
    } else if (fs.existsSync(compositionPath)) {
        renderMidiPath = compositionPath;
    } else {
        // 두 파일 모두 없으면 받은 버퍼를 저장
        fs.writeFileSync(compositionPath, midiData);
        renderMidiPath = compositionPath;
    }

    const workerInput = JSON.stringify(buildRenderWorkerInput({
        midiPath: renderMidiPath,
        outputDir: songDir,
        soundfontPath: fs.existsSync(config.soundfontPath) ? config.soundfontPath : undefined,
        ffmpegBin: config.ffmpegBin,
        expressionSummaryLines: buildRenderExpressionSummaryLines(options),
    }));

    const result = await new Promise<WorkerResponse>((resolve, reject) => {
        const child = execFile(
            config.pythonBin,
            [WORKER_SCRIPT],
            {
                timeout: config.renderWorkerTimeoutMs,
                maxBuffer: 4 * 1024 * 1024,
                env: { ...process.env, PYTHONWARNINGS: "ignore" },
            },
            (err, stdout, stderr) => {
                if (stderr) {
                    logger.warn("Render worker stderr", { songId, stderr: stderr.trim() });
                }
                if (err) {
                    return reject(new Error(`Render worker failed: ${err.message}`));
                }
                try {
                    resolve(JSON.parse(stdout.trim()));
                } catch {
                    reject(new Error(`Render worker returned invalid JSON: ${stdout}`));
                }
            },
        );
        child.stdin?.write(workerInput);
        child.stdin?.end();
    });

    if (!result.ok) {
        throw new Error(`Render worker error: ${result.error}`);
    }

    for (const warning of result.warnings ?? []) {
        logger.warn("Render worker warning", { songId, warning });
    }

    logger.info("Render complete", {
        songId,
        scoreImage: result.scoreImage,
        wavPath: result.wavPath,
        videoPath: result.videoPath,
        durationSec: result.durationSec,
    });

    const artifacts: ArtifactPaths = {
        midi: renderMidiPath,
        scoreImage: result.scoreImage ?? undefined,
        audio: result.wavPath,
        renderedAudio: result.wavPath,
        video: result.videoPath ?? undefined,
    };

    return { artifacts };
}

export async function renderStyledAudio(
    request: ComposeRequest,
    songId: string,
): Promise<RenderResult> {
    logger.info("Rendering styled audio", {
        songId,
        workflow: request.workflow,
    });

    const songDir = path.join(config.outputDir, songId);
    if (!fs.existsSync(songDir)) {
        fs.mkdirSync(songDir, { recursive: true });
    }

    const outputPath = path.join(songDir, "styled-output.wav");
    const requestedDurationSec = resolveRequestedAudioDurationSec(request);
    const workerInput = JSON.stringify({
        prompt: buildStyledAudioPrompt(request),
        key: request.key ?? request.compositionPlan?.key,
        tempo: request.tempo ?? request.compositionPlan?.tempo,
        form: request.form ?? request.compositionPlan?.form ?? "miniature",
        ...(requestedDurationSec !== undefined ? { durationSec: requestedDurationSec } : {}),
        outputPath,
    });

    const result = await new Promise<StyledAudioWorkerResponse>((resolve, reject) => {
        const child = execFile(
            config.pythonBin,
            [STYLE_WORKER_SCRIPT],
            {
                timeout: config.musicgenTimeoutMs,
                maxBuffer: 4 * 1024 * 1024,
                env: { ...process.env, PYTHONWARNINGS: "ignore" },
            },
            (err, stdout, stderr) => {
                if (stderr) {
                    logger.warn("Styled audio worker stderr", { songId, stderr: stderr.trim() });
                }
                if (err) {
                    return reject(new Error(`Styled audio worker failed: ${err.message}`));
                }
                try {
                    resolve(JSON.parse(stdout.trim()) as StyledAudioWorkerResponse);
                } catch {
                    reject(new Error(`Styled audio worker returned invalid JSON: ${stdout}`));
                }
            },
        );
        child.stdin?.write(workerInput);
        child.stdin?.end();
    });

    if (!result.ok) {
        throw new Error(`Styled audio worker error: ${result.error}`);
    }

    logger.info("Styled audio render complete", {
        songId,
        wavPath: result.wavPath,
        durationSec: result.durationSec,
    });

    return {
        artifacts: {
            audio: result.wavPath,
            styledAudio: result.wavPath,
        },
    };
}
