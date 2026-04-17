import type {
    CritiqueResult,
    HarmonicPlan,
    LongSpanFormPlan,
    SectionEvaluationFinding,
    SectionPlan,
} from "../pipeline/types.js";
import { logger } from "../logging/logger.js";
import { resolveFormSectionExpectations } from "../pipeline/formTemplates.js";

/** MIDI 음고 범위: 피아노 A0(21) ~ C8(108) */
const MIN_PITCH = 21;
const MAX_PITCH = 108;

const MIN_NOTE_COUNT = 8;
const MIN_TOTAL_DURATION_BEATS = 6;
const MAX_CONSECUTIVE = 8;
const MIN_MELODIC_SPAN = 5;
const MIN_UNIQUE_PITCH_CLASSES = 4;
const MIN_UNIQUE_DURATIONS = 2;
const MAX_WIDE_LEAP_INTERVAL = 12;
const MAX_WIDE_LEAP_RATIO = 0.35;

const TONIC_TO_PITCH_CLASS: Record<string, number> = {
    C: 0,
    "B#": 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    Fb: 4,
    F: 5,
    "E#": 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
    Cb: 11,
};

interface ParsedNote {
    pitch: number;
    velocity: number;
    onTick: number;
    offTick: number;
    durationTicks: number;
    trackId: number; // 멀티트랙 구분 — 트랙이 다르면 반복 카운터를 리셋한다
}

interface ParsedMidiData {
    notes: ParsedNote[];
    ticksPerQuarter: number;
}

interface ParsedKeySignature {
    tonic: string;
    tonicPitchClass: number;
    mode: "major" | "minor";
}

interface CritiqueOptions {
    key?: string;
    form?: string;
    meter?: string;
    sections?: CritiqueSectionInput[];
    longSpanForm?: LongSpanFormPlan;
}

interface SectionWindow {
    section: CritiqueSectionInput;
    startMeasure: number;
    endMeasure: number;
}

interface HarmonicBeatFrame {
    tick: number;
    leadPitch: number;
    bassPitch: number;
    leadPitchClass: number;
    bassPitchClass: number;
}

interface VoiceLeadingSummary {
    parallelPerfectCount: number;
}

type CritiqueSectionInput = Pick<SectionPlan, "id" | "label" | "role" | "measures">
    & Partial<Pick<SectionPlan, "cadence" | "energy" | "density" | "motifRef" | "contrastFrom">>
    & { harmonicPlan?: HarmonicPlan };

function readVariableLength(buf: Buffer, start: number, end: number): { value: number; next: number } {
    let value = 0;
    let pos = start;
    let byte = 0;

    do {
        if (pos >= end) {
            return { value, next: pos };
        }
        byte = buf[pos++];
        value = (value << 7) | (byte & 0x7f);
    } while ((byte & 0x80) !== 0);

    return { value, next: pos };
}

function normalizeTonic(raw: string): string {
    const compact = raw.trim().replace(/♭/g, "b").replace(/♯/g, "#");
    if (!compact) {
        return "";
    }

    return compact[0].toUpperCase() + compact.slice(1);
}

function parseKeySignature(key?: string): ParsedKeySignature | null {
    if (!key) {
        return null;
    }

    const parts = key.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        return null;
    }

    const tonic = normalizeTonic(parts[0]);
    const tonicPitchClass = TONIC_TO_PITCH_CLASS[tonic];
    if (tonicPitchClass === undefined) {
        return null;
    }

    const mode = parts[1]?.toLowerCase() === "minor" ? "minor" : "major";
    return { tonic, tonicPitchClass, mode };
}

function tonicTriadPitchClasses(key?: string): Set<number> | null {
    const parsed = parseKeySignature(key);
    if (!parsed) {
        return null;
    }

    return new Set([
        parsed.tonicPitchClass,
        (parsed.tonicPitchClass + (parsed.mode === "major" ? 4 : 3)) % 12,
        (parsed.tonicPitchClass + 7) % 12,
    ]);
}

function sectionCadenceKey(section: CritiqueSectionInput | undefined, fallbackKey?: string): string | undefined {
    const tonalCenter = String(section?.harmonicPlan?.tonalCenter ?? "").trim();
    if (!tonalCenter) {
        return fallbackKey;
    }

    const parsed = parseKeySignature(tonalCenter);
    if (!parsed) {
        return fallbackKey;
    }

    return `${parsed.tonic} ${parsed.mode}`;
}

function resolveFinalCadenceKey(options: CritiqueOptions, fallbackKey?: string): string | undefined {
    const sections = options.sections ?? [];
    if (sections.length === 0) {
        return fallbackKey;
    }

    return sectionCadenceKey(sections[sections.length - 1], fallbackKey);
}

function roundedBeats(durationTicks: number, ticksPerQuarter: number): number {
    const beats = durationTicks / Math.max(ticksPerQuarter, 1);
    return Math.round(beats * 4) / 4;
}

function groupByTrack(notes: ParsedNote[]): ParsedNote[][] {
    const grouped = new Map<number, ParsedNote[]>();
    for (const note of notes) {
        const bucket = grouped.get(note.trackId) ?? [];
        bucket.push(note);
        grouped.set(note.trackId, bucket);
    }

    return Array.from(grouped.values()).map((trackNotes) => (
        [...trackNotes].sort((left, right) => left.onTick - right.onTick || left.pitch - right.pitch)
    ));
}

function selectLeadTrack(notes: ParsedNote[]): ParsedNote[] {
    const tracks = groupByTrack(notes);
    if (tracks.length === 0) {
        return [];
    }

    tracks.sort((left, right) => {
        const leftAverage = left.reduce((sum, note) => sum + note.pitch, 0) / left.length;
        const rightAverage = right.reduce((sum, note) => sum + note.pitch, 0) / right.length;
        return rightAverage - leftAverage || right.length - left.length;
    });

    return tracks[0];
}

function selectBassTrack(notes: ParsedNote[]): ParsedNote[] {
    const tracks = groupByTrack(notes);
    if (tracks.length < 2) {
        return [];
    }

    tracks.sort((left, right) => {
        const leftAverage = left.reduce((sum, note) => sum + note.pitch, 0) / left.length;
        const rightAverage = right.reduce((sum, note) => sum + note.pitch, 0) / right.length;
        return leftAverage - rightAverage || right.length - left.length;
    });

    return tracks[0];
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function normalizedProgress(value: number, target: number): number {
    if (target <= 0) {
        return 1;
    }

    return clamp(value / target, 0, 1);
}

function inverseProgress(value: number, max: number): number {
    if (max <= 0) {
        return 1;
    }

    return clamp(1 - (value / max), 0, 1);
}

function beatsPerMeasure(meter?: string): number {
    const value = String(meter ?? "").trim();
    const beats = Number.parseInt(value.split("/")[0] ?? "4", 10);
    return Number.isFinite(beats) && beats > 0 ? beats : 4;
}

function pitchClass(pitch: number): number {
    const normalized = pitch % 12;
    return normalized < 0 ? normalized + 12 : normalized;
}

function intervalClass(upperPitch: number, lowerPitch: number): number {
    return pitchClass(upperPitch - lowerPitch);
}

function isPerfectConsonance(value: number): boolean {
    return value === 0 || value === 7;
}

function findActiveNoteAtTick(
    track: ParsedNote[],
    tick: number,
    preference: "highest" | "lowest",
): ParsedNote | undefined {
    let selected: ParsedNote | undefined;
    for (const note of track) {
        if (note.onTick > tick) {
            break;
        }

        if (note.onTick <= tick && note.offTick > tick) {
            if (!selected) {
                selected = note;
                continue;
            }

            if (preference === "highest" ? note.pitch > selected.pitch : note.pitch < selected.pitch) {
                selected = note;
            }
        }
    }

    return selected;
}

function buildHarmonicBeatFrames(
    leadTrack: ParsedNote[],
    bassTrack: ParsedNote[],
    startTick: number,
    endTick: number,
    ticksPerQuarter: number,
): HarmonicBeatFrame[] {
    if (leadTrack.length === 0 || bassTrack.length === 0 || endTick <= startTick) {
        return [];
    }

    const step = Math.max(Math.trunc(ticksPerQuarter), 1);
    const frames: HarmonicBeatFrame[] = [];

    for (let tick = startTick; tick < endTick; tick += step) {
        const lead = findActiveNoteAtTick(leadTrack, tick, "highest");
        const bass = findActiveNoteAtTick(bassTrack, tick, "lowest");
        if (!lead || !bass) {
            continue;
        }

        frames.push({
            tick,
            leadPitch: lead.pitch,
            bassPitch: bass.pitch,
            leadPitchClass: pitchClass(lead.pitch),
            bassPitchClass: pitchClass(bass.pitch),
        });
    }

    return frames;
}

function summarizeVoiceLeading(frames: HarmonicBeatFrame[]): VoiceLeadingSummary {
    let parallelPerfectCount = 0;

    for (let index = 1; index < frames.length; index += 1) {
        const previous = frames[index - 1];
        const current = frames[index];
        const previousInterval = intervalClass(previous.leadPitch, previous.bassPitch);
        const currentInterval = intervalClass(current.leadPitch, current.bassPitch);

        if (!isPerfectConsonance(previousInterval) || !isPerfectConsonance(currentInterval)) {
            continue;
        }

        const leadDirection = Math.sign(current.leadPitch - previous.leadPitch);
        const bassDirection = Math.sign(current.bassPitch - previous.bassPitch);
        const bothMove = leadDirection !== 0 && bassDirection !== 0;
        if (bothMove && leadDirection === bassDirection) {
            parallelPerfectCount += 1;
        }
    }

    return { parallelPerfectCount };
}

function summarizeCadentialBassSupport(
    frames: HarmonicBeatFrame[],
    cadenceStyle: CritiqueSectionInput["cadence"] | undefined,
    key?: string,
): number {
    const parsedKey = parseKeySignature(key);
    if (!parsedKey || frames.length < 2) {
        return -1;
    }

    const cadentialBassPitchClasses: number[] = [];
    for (let index = frames.length - 1; index >= 0; index -= 1) {
        const bassPitchClass = frames[index].bassPitchClass;
        if (cadentialBassPitchClasses[0] !== bassPitchClass) {
            cadentialBassPitchClasses.unshift(bassPitchClass);
        }
        if (cadentialBassPitchClasses.length >= 2) {
            break;
        }
    }

    if (cadentialBassPitchClasses.length < 2) {
        return -1;
    }

    const tonicPitchClass = parsedKey.tonicPitchClass;
    const dominantPitchClass = (tonicPitchClass + 7) % 12;
    const subdominantPitchClass = (tonicPitchClass + 5) % 12;
    const preparationPitchClass = cadentialBassPitchClasses[0];
    const finalPitchClass = cadentialBassPitchClasses[1];

    if (finalPitchClass !== tonicPitchClass) {
        return 0;
    }

    const expectedPreparation = cadenceStyle === "plagal" ? subdominantPitchClass : dominantPitchClass;
    return preparationPitchClass === expectedPreparation ? 1 : 0.5;
}

function buildSectionWindows(
    sections: CritiqueSectionInput[] | undefined,
): SectionWindow[] {
    if (!sections?.length) {
        return [];
    }

    let cursor = 1;
    return sections
        .filter((section) => Number.isFinite(section.measures) && section.measures > 0)
        .map((section) => {
            const startMeasure = cursor;
            const endMeasure = cursor + section.measures;
            cursor = endMeasure;
            return {
                section,
                startMeasure,
                endMeasure,
            };
        });
}

function resolveCritiqueOptions(keyOrOptions?: string | CritiqueOptions): CritiqueOptions {
    if (typeof keyOrOptions === "string") {
        return { key: keyOrOptions };
    }
    return keyOrOptions ?? {};
}

function expectedSectionTension(section: CritiqueSectionInput): number | undefined {
    if (typeof section.harmonicPlan?.tensionTarget === "number") {
        return clamp(section.harmonicPlan.tensionTarget, 0, 1);
    }

    const energy = typeof section.energy === "number" ? clamp(section.energy, 0, 1) : undefined;
    const density = typeof section.density === "number" ? clamp(section.density, 0, 1) : undefined;

    if (energy !== undefined && density !== undefined) {
        return Number((((energy * 0.65) + (density * 0.35))).toFixed(4));
    }

    return energy ?? density;
}

function harmonicDensityTargetValue(harmonyDensity: HarmonicPlan["harmonyDensity"] | undefined): number | undefined {
    if (harmonyDensity === "sparse") {
        return 2.25;
    }
    if (harmonyDensity === "medium") {
        return 3.5;
    }
    if (harmonyDensity === "rich") {
        return 4.75;
    }
    return undefined;
}

function noteDensityFit(
    noteCount: number,
    measures: number,
    harmonyDensity: HarmonicPlan["harmonyDensity"] | undefined,
): number | undefined {
    const target = harmonicDensityTargetValue(harmonyDensity);
    if (target === undefined || measures <= 0) {
        return undefined;
    }

    const actual = noteCount / measures;
    return Number(clamp(1 - (Math.abs(actual - target) / 2.75), 0, 1).toFixed(4));
}

function actualSectionTension(
    noteCount: number,
    measures: number,
    melodicSpan: number,
    uniquePitchClasses: number,
    wideLeapRatio: number,
): number {
    const noteDensity = measures > 0 ? noteCount / measures : noteCount;
    return Number(clamp(
        (normalizedProgress(melodicSpan, 14) * 0.35)
        + (clamp(wideLeapRatio / 0.4, 0, 1) * 0.3)
        + (normalizedProgress(uniquePitchClasses, 5) * 0.2)
        + (normalizedProgress(noteDensity, 4) * 0.15),
        0,
        1,
    ).toFixed(4));
}

function pushUnique(values: string[], message: string): void {
    if (!values.includes(message)) {
        values.push(message);
    }
}

function average(values: number[]): number | undefined {
    if (values.length === 0) {
        return undefined;
    }

    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function captureSectionMotifShape(sectionNotes: ParsedNote[], limit = 8): number[] {
    const phrase = sectionNotes.slice(0, limit);
    if (phrase.length < 2) {
        return [];
    }

    const anchor = phrase[0].pitch;
    return phrase.map((note) => note.pitch - anchor);
}

function invertMotifShape(shape: number[]): number[] {
    if (shape.length === 0) {
        return [];
    }

    return [0, ...shape.slice(1).map((interval) => (interval === 0 ? 0 : -interval))];
}

function motifShapeSimilarity(left: number[], right: number[]): number {
    const limit = Math.min(left.length, right.length);
    if (limit < 2) {
        return 0;
    }

    let total = 0;
    for (let index = 0; index < limit; index += 1) {
        total += Math.max(0, 1 - (Math.abs(left[index] - right[index]) / 7));
    }

    return Number((total / limit).toFixed(4));
}

function resolveNarrativeSourceSection(
    current: SectionWindow,
    sectionWindows: SectionWindow[],
): SectionWindow | undefined {
    const motifRef = String(current.section.motifRef ?? "").trim();
    if (motifRef) {
        return sectionWindows.find((sectionWindow) => sectionWindow.section.id === motifRef);
    }

    const contrastFrom = String(current.section.contrastFrom ?? "").trim();
    if (contrastFrom) {
        return sectionWindows.find((sectionWindow) => sectionWindow.section.id === contrastFrom);
    }

    const previousSections = sectionWindows.filter((sectionWindow) => sectionWindow.startMeasure < current.startMeasure);
    if (current.section.role === "recap") {
        return previousSections.find((sectionWindow) => sectionWindow.section.role === "theme_a")
            ?? previousSections.find((sectionWindow) => sectionWindow.section.role === "theme_b")
            ?? previousSections.at(0);
    }

    if (current.section.role === "development" || current.section.role === "variation") {
        return [...previousSections].reverse().find((sectionWindow) => (
            sectionWindow.section.role === "theme_a"
            || sectionWindow.section.role === "theme_b"
            || sectionWindow.section.role === "intro"
            || sectionWindow.section.role === "bridge"
        ));
    }

    return undefined;
}

function summarizeNarrativeMetrics(
    sectionWindows: SectionWindow[],
    sectionFindings: SectionEvaluationFinding[],
    sectionNotesById: Map<string, ParsedNote[]>,
): { metrics: Record<string, number>; issues: string[]; strengths: string[] } {
    const metrics: Record<string, number> = {};
    const issues: string[] = [];
    const strengths: string[] = [];

    if (sectionWindows.length === 0 || sectionFindings.length === 0) {
        return { metrics, issues, strengths };
    }

    const findingById = new Map(sectionFindings.map((finding) => [finding.sectionId, finding]));
    const developmentScores: number[] = [];
    const developmentRelations: number[] = [];
    const recapScores: number[] = [];
    const recapRelations: number[] = [];

    for (const sectionWindow of sectionWindows) {
        if (sectionWindow.section.role !== "development" && sectionWindow.section.role !== "recap") {
            continue;
        }

        const sourceSection = resolveNarrativeSourceSection(sectionWindow, sectionWindows);
        if (!sourceSection) {
            continue;
        }

        const currentNotes = sectionNotesById.get(sectionWindow.section.id) ?? [];
        const sourceNotes = sectionNotesById.get(sourceSection.section.id) ?? [];
        const currentShape = captureSectionMotifShape(currentNotes);
        const sourceShape = captureSectionMotifShape(sourceNotes);
        if (currentShape.length < 2 || sourceShape.length < 2) {
            continue;
        }

        const directSimilarity = motifShapeSimilarity(currentShape, sourceShape);
        const invertedSimilarity = motifShapeSimilarity(currentShape, invertMotifShape(sourceShape));
        const anchorShift = Math.abs((currentNotes[0]?.pitch ?? 0) - (sourceNotes[0]?.pitch ?? 0));
        const currentFinding = findingById.get(sectionWindow.section.id);
        const sourceFinding = findingById.get(sourceSection.section.id);
        const currentTension = typeof currentFinding?.metrics.actualTension === "number" ? currentFinding.metrics.actualTension : undefined;
        const sourceTension = typeof sourceFinding?.metrics.actualTension === "number" ? sourceFinding.metrics.actualTension : undefined;

        if (sectionWindow.section.role === "development") {
            const directTransformFit = 1 - clamp(Math.abs(directSimilarity - 0.55) / 0.55, 0, 1);
            const inversionFit = invertedSimilarity * 0.95;
            const sequenceFit = directSimilarity >= 0.82 && anchorShift >= 2
                ? clamp(anchorShift / 5, 0, 1)
                : 0;
            const relationFit = Math.max(directTransformFit, inversionFit, sequenceFit);
            const tensionLift = currentTension !== undefined && sourceTension !== undefined
                ? clamp((currentTension - sourceTension + 0.08) / 0.32, 0, 1)
                : 0.5;
            const score = Number(((relationFit * 0.65) + (tensionLift * 0.35)).toFixed(4));

            developmentScores.push(score);
            developmentRelations.push(Number(Math.max(directSimilarity, invertedSimilarity).toFixed(4)));

            if (score < 0.42) {
                pushUnique(issues, "Development section does not meaningfully transform earlier thematic material.");
            } else if (score >= 0.62) {
                pushUnique(strengths, "Development meaningfully transforms earlier thematic material.");
            }
            continue;
        }

        const directRecall = directSimilarity;
        const cadenceScore = currentFinding?.metrics.cadenceResolved ? 1 : 0;
        const releaseScore = currentTension !== undefined && sourceTension !== undefined
            ? clamp((sourceTension - currentTension + 0.08) / 0.32, 0, 1)
            : 0.5;
        const score = Number(((directRecall * 0.65) + (((cadenceScore + releaseScore) / 2) * 0.35)).toFixed(4));

        recapScores.push(score);
        recapRelations.push(Number(directRecall.toFixed(4)));

        if (score < 0.48) {
            pushUnique(issues, "Recap does not clearly recall earlier thematic material.");
        } else if (score >= 0.68) {
            pushUnique(strengths, "Recap clearly recalls earlier thematic material.");
        }
    }

    const developmentNarrativeFit = average(developmentScores);
    const developmentMotifRelation = average(developmentRelations);
    const recapRecallFit = average(recapScores);
    const recapMotifRelation = average(recapRelations);

    if (developmentNarrativeFit !== undefined) {
        metrics.developmentNarrativeFit = developmentNarrativeFit;
    }
    if (developmentMotifRelation !== undefined) {
        metrics.developmentMotifRelation = developmentMotifRelation;
    }
    if (recapRecallFit !== undefined) {
        metrics.recapRecallFit = recapRecallFit;
    }
    if (recapMotifRelation !== undefined) {
        metrics.recapMotifRelation = recapMotifRelation;
    }

    return { metrics, issues, strengths };
}

function scalePitchClasses(key?: string): Set<number> | null {
    const parsed = parseKeySignature(key);
    if (!parsed) {
        return null;
    }

    const pattern = parsed.mode === "minor"
        ? [0, 2, 3, 5, 7, 8, 10]
        : [0, 2, 4, 5, 7, 9, 11];
    return new Set(pattern.map((value) => (parsed.tonicPitchClass + value) % 12));
}

function noteWindowFit(notes: ParsedNote[], key: string | undefined, fromStart: boolean, limit = 6): number {
    const scale = scalePitchClasses(key);
    if (!scale || notes.length === 0) {
        return 0.5;
    }

    const window = fromStart ? notes.slice(0, limit) : notes.slice(Math.max(notes.length - limit, 0));
    if (window.length === 0) {
        return 0.5;
    }

    let matches = 0;
    for (const note of window) {
        if (scale.has(pitchClass(note.pitch))) {
            matches += 1;
        }
    }

    return Number((matches / window.length).toFixed(4));
}

function distinctBoundaryPitchClass(notes: ParsedNote[], fromStart: boolean): number | undefined {
    const ordered = fromStart ? notes : [...notes].reverse();
    let previous: number | undefined;
    for (const note of ordered) {
        const current = pitchClass(note.pitch);
        if (previous === undefined || current !== previous) {
            return current;
        }
        previous = current;
    }

    return undefined;
}

function relatedKeyScore(leftKey?: string, rightKey?: string): number {
    const left = parseKeySignature(leftKey);
    const right = parseKeySignature(rightKey);
    if (!left || !right) {
        return 0.5;
    }

    if (left.tonicPitchClass === right.tonicPitchClass && left.mode === right.mode) {
        return 1;
    }

    if (left.tonicPitchClass === right.tonicPitchClass && left.mode !== right.mode) {
        return 0.9;
    }

    const tonicDelta = (right.tonicPitchClass - left.tonicPitchClass + 12) % 12;
    if ((tonicDelta === 7 || tonicDelta === 5) && left.mode === right.mode) {
        return 0.86;
    }

    const relativeMatch = (
        (left.mode === "major" && right.mode === "minor" && tonicDelta === 9)
        || (left.mode === "minor" && right.mode === "major" && tonicDelta === 3)
    );
    if (relativeMatch) {
        return 0.84;
    }

    if (tonicDelta === 2 || tonicDelta === 10 || tonicDelta === 3 || tonicDelta === 9) {
        return 0.6;
    }

    return 0.22;
}

function summarizeGlobalHarmonicMetrics(
    sectionWindows: SectionWindow[],
    sectionFindings: SectionEvaluationFinding[],
    sectionNotesById: Map<string, ParsedNote[]>,
    sectionBassNotesById: Map<string, ParsedNote[]>,
    fallbackKey?: string,
): { metrics: Record<string, number>; issues: string[]; strengths: string[] } {
    const metrics: Record<string, number> = {};
    const issues: string[] = [];
    const strengths: string[] = [];

    if (sectionWindows.length === 0 || sectionFindings.length === 0) {
        return { metrics, issues, strengths };
    }

    const hasExplicitTonalPlan = sectionWindows.some((sectionWindow) => (
        String(sectionWindow.section.harmonicPlan?.tonalCenter ?? "").trim().length > 0
    ));
    if (!hasExplicitTonalPlan) {
        return { metrics, issues, strengths };
    }

    const findingById = new Map(sectionFindings.map((finding) => [finding.sectionId, finding]));
    const harmonicContexts = sectionWindows.map((sectionWindow) => {
        const sectionKey = sectionCadenceKey(sectionWindow.section, fallbackKey);
        const sectionNotes = sectionNotesById.get(sectionWindow.section.id) ?? [];
        const bassNotes = sectionBassNotesById.get(sectionWindow.section.id) ?? [];
        return {
            sectionWindow,
            sectionKey,
            sectionNotes,
            bassNotes,
            openingFit: noteWindowFit(sectionNotes, sectionKey, true),
            overallFit: noteWindowFit(sectionNotes, sectionKey, true, Math.max(sectionNotes.length, 1)),
            startBassPitchClass: distinctBoundaryPitchClass(bassNotes, true),
            endBassPitchClass: distinctBoundaryPitchClass(bassNotes, false),
            finding: findingById.get(sectionWindow.section.id),
            allowModulation: Boolean(sectionWindow.section.harmonicPlan?.allowModulation),
        };
    });

    const modulationScores: number[] = [];
    for (let index = 1; index < harmonicContexts.length; index += 1) {
        const previous = harmonicContexts[index - 1];
        const current = harmonicContexts[index];
        if (!previous.sectionKey || !current.sectionKey || previous.sectionKey === current.sectionKey) {
            continue;
        }

        let score = (
            (relatedKeyScore(previous.sectionKey, current.sectionKey) * 0.55)
            + (current.openingFit * 0.3)
            + (current.overallFit * 0.15)
        );
        if (!current.allowModulation) {
            score *= 0.58;
        }
        modulationScores.push(Number(score.toFixed(4)));
    }

    const modulationStrength = average(modulationScores);
    if (modulationStrength !== undefined) {
        metrics.harmonicModulationStrength = modulationStrength;
        if (modulationStrength >= 0.72) {
            pushUnique(strengths, "Modulation moves through related tonal areas with convincing local landing.");
        } else if (modulationStrength < 0.48) {
            pushUnique(issues, "Modulation path does not land convincingly in related tonal areas.");
        }
    }

    const dominantPreparationScores: number[] = [];
    for (let index = 1; index < harmonicContexts.length; index += 1) {
        const current = harmonicContexts[index];
        const previous = harmonicContexts[index - 1];
        const targetKey = current.sectionKey;
        const parsedTarget = parseKeySignature(targetKey);
        const needsPreparation = current.sectionWindow.section.role === "recap"
            || current.sectionWindow.section.role === "cadence"
            || current.sectionWindow.section.role === "outro"
            || current.sectionWindow.section.cadence === "authentic"
            || current.sectionWindow.section.cadence === "plagal";
        if (!needsPreparation || !parsedTarget) {
            continue;
        }

        const expectedPreparation = current.sectionWindow.section.cadence === "plagal"
            ? (parsedTarget.tonicPitchClass + 5) % 12
            : (parsedTarget.tonicPitchClass + 7) % 12;
        let score = 0;
        if (previous.endBassPitchClass === expectedPreparation) {
            score = 1;
        } else if (current.startBassPitchClass === expectedPreparation) {
            score = 0.78;
        } else if ((current.finding?.metrics.harmonicCadenceSupport ?? -1) >= 0) {
            score = Number((((current.finding?.metrics.harmonicCadenceSupport ?? 0) * 0.85)).toFixed(4));
        }

        dominantPreparationScores.push(score);
    }

    const dominantPreparationStrength = average(dominantPreparationScores);
    if (dominantPreparationStrength !== undefined) {
        metrics.dominantPreparationStrength = dominantPreparationStrength;
        if (dominantPreparationStrength >= 0.74) {
            pushUnique(strengths, "Dominant preparation supports major tonal arrivals across the form.");
        } else if (dominantPreparationStrength < 0.45) {
            pushUnique(issues, "Dominant preparation is weak before major tonal arrivals.");
        }
    }

    const recapReturnScores: number[] = [];
    for (const current of harmonicContexts) {
        if (current.sectionWindow.section.role !== "recap") {
            continue;
        }

        const source = resolveNarrativeSourceSection(current.sectionWindow, sectionWindows);
        const sourceKey = source ? sectionCadenceKey(source.section, fallbackKey) : fallbackKey;
        const keyReturn = relatedKeyScore(sourceKey, current.sectionKey);
        const cadenceReturn = (current.finding?.metrics.harmonicCadenceSupport ?? -1) >= 0
            ? Number(current.finding?.metrics.harmonicCadenceSupport ?? 0)
            : Number(current.finding?.metrics.cadenceResolved ?? 0);
        const score = Number((
            (keyReturn * 0.5)
            + (noteWindowFit(current.sectionNotes, sourceKey, true) * 0.3)
            + (cadenceReturn * 0.2)
        ).toFixed(4));
        recapReturnScores.push(score);
    }

    const recapTonalReturnStrength = average(recapReturnScores);
    if (recapTonalReturnStrength !== undefined) {
        metrics.recapTonalReturnStrength = recapTonalReturnStrength;
        if (recapTonalReturnStrength >= 0.72) {
            pushUnique(strengths, "Recap re-establishes the opening tonic convincingly.");
        } else if (recapTonalReturnStrength < 0.5) {
            pushUnique(issues, "Recap does not re-establish the opening tonic strongly enough.");
        }
    }

    const globalProgressionStrength = average([
        metrics.harmonicModulationStrength,
        metrics.dominantPreparationStrength,
        metrics.recapTonalReturnStrength,
    ].filter((value): value is number => typeof value === "number"));
    if (globalProgressionStrength !== undefined) {
        metrics.globalHarmonicProgressionStrength = globalProgressionStrength;
        if (globalProgressionStrength >= 0.74) {
            pushUnique(strengths, "Piece-level tonal planning reads as a coherent harmonic route.");
        } else if (globalProgressionStrength < 0.52) {
            pushUnique(issues, "Piece-level harmonic route is not yet coherent enough.");
        }
    }

    return { metrics, issues, strengths };
}

function resolveSectionWindowById(sectionWindows: SectionWindow[], sectionId: string | undefined): SectionWindow | undefined {
    if (!sectionId) {
        return undefined;
    }
    return sectionWindows.find((sectionWindow) => sectionWindow.section.id === sectionId);
}

function resolveLongSpanSectionWindow(
    sectionWindows: SectionWindow[],
    sectionId: string | undefined,
    fallbackRoles: CritiqueSectionInput["role"][],
): SectionWindow | undefined {
    return resolveSectionWindowById(sectionWindows, sectionId)
        ?? sectionWindows.find((sectionWindow) => fallbackRoles.includes(sectionWindow.section.role));
}

function resolvePreReturnSectionWindow(
    sectionWindows: SectionWindow[],
    longSpanForm: LongSpanFormPlan,
    returnWindow: SectionWindow | undefined,
): SectionWindow | undefined {
    const explicit = resolveSectionWindowById(sectionWindows, longSpanForm.retransitionSectionId);
    if (explicit) {
        return explicit;
    }
    if (!returnWindow) {
        return undefined;
    }
    const returnIndex = sectionWindows.findIndex((sectionWindow) => sectionWindow.section.id === returnWindow.section.id);
    return returnIndex > 0 ? sectionWindows[returnIndex - 1] : undefined;
}

function longSpanTransformRelationRange(transform: NonNullable<LongSpanFormPlan["thematicCheckpoints"]>[number]["transform"]): { min: number; max: number } {
    switch (transform) {
        case "repeat":
            return { min: 0.82, max: 1 };
        case "revoice":
            return { min: 0.68, max: 1 };
        case "sequence":
            return { min: 0.48, max: 0.92 };
        case "fragment":
            return { min: 0.28, max: 0.72 };
        case "destabilize":
            return { min: 0.18, max: 0.62 };
        case "delay_return":
            return { min: 0.12, max: 0.55 };
        default:
            return { min: 0.35, max: 0.85 };
    }
}

function scoreRelationAgainstRange(value: number, range: { min: number; max: number }, tolerance = 0.2): number {
    if (value >= range.min && value <= range.max) {
        return 1;
    }
    if (value < range.min) {
        return clamp(1 - ((range.min - value) / tolerance), 0, 1);
    }
    return clamp(1 - ((value - range.max) / tolerance), 0, 1);
}

function longSpanDevelopmentPressureTarget(pressure: LongSpanFormPlan["expectedDevelopmentPressure"]): number | undefined {
    switch (pressure) {
        case "low":
            return 0.08;
        case "medium":
            return 0.18;
        case "high":
            return 0.28;
        default:
            return undefined;
    }
}

function longSpanReturnPayoffTarget(payoff: LongSpanFormPlan["expectedReturnPayoff"]): number | undefined {
    switch (payoff) {
        case "subtle":
            return 0.55;
        case "clear":
            return 0.7;
        case "inevitable":
            return 0.82;
        default:
            return undefined;
    }
}

function summarizeLongSpanMetrics(
    sectionWindows: SectionWindow[],
    sectionFindings: SectionEvaluationFinding[],
    sectionNotesById: Map<string, ParsedNote[]>,
    sectionBassNotesById: Map<string, ParsedNote[]>,
    fallbackKey: string | undefined,
    longSpanForm: LongSpanFormPlan | undefined,
    narrativeMetrics: Record<string, number>,
    harmonicMetrics: Record<string, number>,
): { metrics: Record<string, number>; issues: string[]; strengths: string[] } {
    const metrics: Record<string, number> = {};
    const issues: string[] = [];
    const strengths: string[] = [];

    if (!longSpanForm || sectionWindows.length === 0 || sectionFindings.length === 0) {
        return { metrics, issues, strengths };
    }

    const findingById = new Map(sectionFindings.map((finding) => [finding.sectionId, finding]));
    const openingWindow = resolveLongSpanSectionWindow(
        sectionWindows,
        longSpanForm.expositionStartSectionId,
        ["theme_a", "intro"],
    ) ?? sectionWindows[0];
    const developmentWindow = resolveLongSpanSectionWindow(
        sectionWindows,
        longSpanForm.developmentStartSectionId,
        ["development"],
    );
    const returnWindow = resolveLongSpanSectionWindow(
        sectionWindows,
        longSpanForm.returnSectionId ?? longSpanForm.recapStartSectionId,
        ["recap"],
    );
    const payoffWindow = resolveSectionWindowById(sectionWindows, longSpanForm.delayedPayoffSectionId) ?? returnWindow;

    if (openingWindow && developmentWindow) {
        const openingFinding = findingById.get(openingWindow.section.id);
        const developmentFinding = findingById.get(developmentWindow.section.id);
        const openingTension = typeof openingFinding?.metrics.actualTension === "number"
            ? openingFinding.metrics.actualTension
            : undefined;
        const developmentTension = typeof developmentFinding?.metrics.actualTension === "number"
            ? developmentFinding.metrics.actualTension
            : undefined;
        const targetLift = longSpanDevelopmentPressureTarget(longSpanForm.expectedDevelopmentPressure);
        const observedLift = openingTension !== undefined && developmentTension !== undefined
            ? Number((developmentTension - openingTension).toFixed(4))
            : undefined;
        const tensionFit = targetLift !== undefined && observedLift !== undefined
            ? clamp(1 - (Math.abs(observedLift - targetLift) / 0.24), 0, 1)
            : undefined;
        const baseNarrativeFit = typeof narrativeMetrics.developmentNarrativeFit === "number"
            ? narrativeMetrics.developmentNarrativeFit
            : 0.5;
        const fit = typeof tensionFit === "number"
            ? Number((((tensionFit * 0.7) + (baseNarrativeFit * 0.3))).toFixed(4))
            : Number(baseNarrativeFit.toFixed(4));
        metrics.longSpanDevelopmentPressureFit = fit;
    }

    const checkpointScores: number[] = [];
    for (const checkpoint of longSpanForm.thematicCheckpoints ?? []) {
        const sourceNotes = sectionNotesById.get(checkpoint.sourceSectionId) ?? [];
        const targetNotes = sectionNotesById.get(checkpoint.targetSectionId) ?? [];
        const sourceShape = captureSectionMotifShape(sourceNotes);
        const targetShape = captureSectionMotifShape(targetNotes);
        if (sourceShape.length < 2 || targetShape.length < 2) {
            continue;
        }

        const directSimilarity = motifShapeSimilarity(targetShape, sourceShape);
        const invertedSimilarity = motifShapeSimilarity(targetShape, invertMotifShape(sourceShape));
        const anchorShift = Math.abs((targetNotes[0]?.pitch ?? 0) - (sourceNotes[0]?.pitch ?? 0));
        const sequenceCue = directSimilarity >= 0.82 && anchorShift >= 2
            ? clamp(Math.max(0.55, anchorShift / 5), 0, 1)
            : 0;
        const relation = Math.max(directSimilarity, invertedSimilarity * 0.95, sequenceCue);
        const transformFit = scoreRelationAgainstRange(relation, longSpanTransformRelationRange(checkpoint.transform));
        const identityFit = checkpoint.preserveIdentity === undefined
            ? 0.5
            : checkpoint.preserveIdentity
                ? relation
                : clamp(1 - (Math.abs(relation - 0.4) / 0.4), 0, 1);
        const targetProminence = clamp((findingById.get(checkpoint.targetSectionId)?.score ?? 50) / 100, 0, 1);
        const prominenceFit = typeof checkpoint.expectedProminence === "number"
            ? clamp(1 - (Math.abs(targetProminence - checkpoint.expectedProminence) / 0.5), 0, 1)
            : 0.5;
        checkpointScores.push(Number((((transformFit * 0.7) + (identityFit * 0.2) + (prominenceFit * 0.1))).toFixed(4)));
    }

    const thematicTransformationFit = average(checkpointScores);
    if (thematicTransformationFit !== undefined) {
        metrics.longSpanThematicTransformationFit = thematicTransformationFit;
    }

    let harmonicTimingRestoration: number | undefined;
    if (openingWindow && returnWindow) {
        const openingKey = sectionCadenceKey(openingWindow.section, fallbackKey);
        const returnKey = sectionCadenceKey(returnWindow.section, fallbackKey);
        const returnNotes = sectionNotesById.get(returnWindow.section.id) ?? [];

        if (openingKey && returnKey) {
            harmonicTimingRestoration = Number((
                (relatedKeyScore(openingKey, returnKey) * 0.6)
                + (noteWindowFit(returnNotes, openingKey, true) * 0.4)
            ).toFixed(4));

            const preReturnWindow = resolvePreReturnSectionWindow(sectionWindows, longSpanForm, returnWindow);
            const parsedOpening = parseKeySignature(openingKey);
            const preReturnBass = preReturnWindow
                ? distinctBoundaryPitchClass(sectionBassNotesById.get(preReturnWindow.section.id) ?? [], false)
                : undefined;
            const returnStartBass = distinctBoundaryPitchClass(sectionBassNotesById.get(returnWindow.section.id) ?? [], true);
            const returnFinding = findingById.get(returnWindow.section.id);
            const expectedPreparation = parsedOpening ? (parsedOpening.tonicPitchClass + 7) % 12 : undefined;
            const preparationFit = expectedPreparation === undefined
                ? undefined
                : preReturnBass === expectedPreparation
                    ? 1
                    : returnStartBass === expectedPreparation
                        ? 0.82
                        : typeof returnFinding?.metrics.harmonicCadenceSupport === "number" && returnFinding.metrics.harmonicCadenceSupport >= 0
                            ? Number((returnFinding.metrics.harmonicCadenceSupport * 0.65).toFixed(4))
                            : undefined;
            const harmonicTimingFit = average([
                harmonicTimingRestoration,
                preparationFit,
            ].filter((value): value is number => typeof value === "number"));
            if (harmonicTimingFit !== undefined) {
                metrics.longSpanHarmonicTimingFit = harmonicTimingFit;
            }
        }
    }

    if (openingWindow && payoffWindow) {
        const openingNotes = sectionNotesById.get(openingWindow.section.id) ?? [];
        const payoffNotes = sectionNotesById.get(payoffWindow.section.id) ?? [];
        const openingShape = captureSectionMotifShape(openingNotes);
        const payoffShape = captureSectionMotifShape(payoffNotes);
        const thematicRecall = openingShape.length >= 2 && payoffShape.length >= 2
            ? motifShapeSimilarity(payoffShape, openingShape)
            : narrativeMetrics.recapRecallFit;
        const tonalReturn = harmonicTimingRestoration
            ?? (typeof harmonicMetrics.recapTonalReturnStrength === "number"
                ? harmonicMetrics.recapTonalReturnStrength
                : undefined);
        const payoffBase = average([
            thematicRecall,
            tonalReturn,
        ].filter((value): value is number => typeof value === "number"));
        if (payoffBase !== undefined) {
            const targetPayoff = longSpanReturnPayoffTarget(longSpanForm.expectedReturnPayoff);
            metrics.longSpanReturnPayoffFit = targetPayoff !== undefined
                ? Number(clamp(payoffBase / targetPayoff, 0, 1).toFixed(4))
                : Number(payoffBase.toFixed(4));
        }
    }

    return { metrics, issues, strengths };
}

function evaluateSection(
    sectionWindow: SectionWindow,
    sectionNotes: ParsedNote[],
    bassNotes: ParsedNote[],
    ticksPerQuarter: number,
    meter?: string,
    key?: string,
    form?: string,
): SectionEvaluationFinding {
    const issues: string[] = [];
    const strengths: string[] = [];
    const noteCount = sectionNotes.length;
    const expectedMinNotes = clamp(sectionWindow.section.measures * 2, 3, 8);

    let melodicSpan = 0;
    let uniquePitchClasses = 0;
    let uniqueDurations = 0;
    let wideLeapRatio = 0;
    let unresolvedLeaps = 0;
    let cadenceResolved = 0;
    let harmonicCadenceSupport = -1;
    let parallelPerfectCount = 0;
    let tensionMismatch = 0;
    let actualTension = 0;
    let tonalCenterFit = -1;
    let actualCadenceStrength = -1;
    let cadenceStrengthFit = -1;
    let densityPlanFit = -1;
    let modulationPlanFit = -1;
    let sectionHarmonicPlanFit = -1;
    const cadenceExpected = sectionWindow.section.cadence === "authentic"
        || sectionWindow.section.cadence === "plagal"
        || sectionWindow.section.role === "cadence"
        || sectionWindow.section.role === "outro";

    if (noteCount < expectedMinNotes) {
        issues.push(`Sparse lead material: ${noteCount} notes across ${sectionWindow.section.measures} measures`);
    } else if (noteCount >= expectedMinNotes + 2) {
        strengths.push("Section has enough lead material to establish an idea.");
    }

    if (noteCount > 0) {
        melodicSpan = Math.max(...sectionNotes.map((note) => note.pitch)) - Math.min(...sectionNotes.map((note) => note.pitch));
        if (melodicSpan < 4) {
            issues.push(`Narrow register span: ${melodicSpan} semitones`);
        } else if (melodicSpan >= 7) {
            strengths.push("Section uses a workable local register span.");
        }

        uniquePitchClasses = new Set(sectionNotes.map((note) => note.pitch % 12)).size;
        const expectedPitchClasses = noteCount >= 6 ? 3 : 2;
        if (uniquePitchClasses < expectedPitchClasses) {
            issues.push(`Limited local pitch variety: ${uniquePitchClasses} pitch classes`);
        } else if (uniquePitchClasses >= expectedPitchClasses + 1) {
            strengths.push("Local pitch variety avoids literal restatement.");
        }

        uniqueDurations = new Set(sectionNotes.map((note) => roundedBeats(note.durationTicks, ticksPerQuarter))).size;
        if (noteCount >= 4 && uniqueDurations < 2) {
            issues.push(`Limited local rhythm variety: ${uniqueDurations} note lengths`);
        } else if (uniqueDurations >= 2) {
            strengths.push("Section uses at least two local duration cells.");
        }

        let wideLeaps = 0;
        for (let i = 1; i < sectionNotes.length; i++) {
            const currentInterval = sectionNotes[i].pitch - sectionNotes[i - 1].pitch;
            if (Math.abs(currentInterval) > MAX_WIDE_LEAP_INTERVAL) {
                wideLeaps += 1;

                if (i < sectionNotes.length - 1) {
                    const recoveryInterval = sectionNotes[i + 1].pitch - sectionNotes[i].pitch;
                    const recoversStepwise = recoveryInterval !== 0
                        && Math.abs(recoveryInterval) <= 5
                        && Math.sign(recoveryInterval) !== Math.sign(currentInterval);
                    if (!recoversStepwise) {
                        unresolvedLeaps += 1;
                    }
                }
            }
        }

        const intervalCount = Math.max(sectionNotes.length - 1, 1);
        wideLeapRatio = wideLeaps / intervalCount;
        if (wideLeapRatio > 0.4) {
            issues.push(`Unstable leap profile: ${wideLeaps}/${intervalCount} wide leaps`);
        } else if (wideLeapRatio <= 0.2) {
            strengths.push("Section keeps local leaps under control.");
        }

        if (unresolvedLeaps >= 2) {
            issues.push("Local leaps do not recover stepwise.");
        }

        if (cadenceExpected) {
            const cadenceKey = sectionCadenceKey(sectionWindow.section, key);
            const tonicTriad = tonicTriadPitchClasses(cadenceKey);
            const finalNote = sectionNotes.at(-1);
            if (tonicTriad && finalNote && tonicTriad.has(finalNote.pitch % 12)) {
                cadenceResolved = 1;
                strengths.push(`Section close lands inside the tonic triad for ${cadenceKey ?? key ?? "the planned cadence key"}.`);
            } else {
                issues.push(`Section close does not settle convincingly for ${cadenceKey ?? key ?? "the planned cadence key"}.`);
            }
        } else {
            cadenceResolved = 1;
        }

        const measureSpanTicks = beatsPerMeasure(meter) * ticksPerQuarter;
        const startTick = (sectionWindow.startMeasure - 1) * measureSpanTicks;
        const endTick = (sectionWindow.endMeasure - 1) * measureSpanTicks;
        const harmonicFrames = buildHarmonicBeatFrames(
            sectionNotes,
            bassNotes,
            startTick,
            endTick,
            ticksPerQuarter,
        );
        if (harmonicFrames.length >= 2) {
            parallelPerfectCount = summarizeVoiceLeading(harmonicFrames).parallelPerfectCount;

            if (parallelPerfectCount >= 2) {
                issues.push(`Parallel perfect intervals weaken the outer-voice motion: ${parallelPerfectCount} consecutive frames`);
            } else if (parallelPerfectCount === 0) {
                strengths.push("Outer voices avoid exposed parallel perfect motion.");
            }

            if (cadenceExpected) {
                const cadenceKey = sectionCadenceKey(sectionWindow.section, key);
                harmonicCadenceSupport = summarizeCadentialBassSupport(
                    harmonicFrames,
                    sectionWindow.section.cadence,
                    cadenceKey,
                );

                if (harmonicCadenceSupport >= 0.99) {
                    strengths.push(`Cadential bass motion supports the planned ${sectionWindow.section.cadence ?? "authentic"} close.`);
                } else if (harmonicCadenceSupport >= 0 && harmonicCadenceSupport < 0.5) {
                    issues.push(`Cadential bass motion does not support the planned ${sectionWindow.section.cadence ?? "authentic"} close.`);
                }
            }
        }

        const expectedTension = expectedSectionTension(sectionWindow.section);
        actualTension = actualSectionTension(
            noteCount,
            sectionWindow.section.measures,
            melodicSpan,
            uniquePitchClasses,
            wideLeapRatio,
        );
        if (expectedTension !== undefined) {
            tensionMismatch = Number(Math.abs(actualTension - expectedTension).toFixed(4));

            if (tensionMismatch >= 0.3) {
                issues.push(`Tension arc mismatch: expected ${expectedTension.toFixed(2)}, heard ${actualTension.toFixed(2)}`);
            } else if (tensionMismatch <= 0.14) {
                strengths.push("Section tension matches the planned local arc.");
            }
        }
    }

    const formExpectations = resolveFormSectionExpectations(form, sectionWindow.section, key);
    const harmonicPlanFitComponents: number[] = [];
    if (formExpectations?.tonalCenter && noteCount > 0) {
        tonalCenterFit = noteWindowFit(sectionNotes, formExpectations.tonalCenter, true, Math.max(noteCount, 1));
        harmonicPlanFitComponents.push(tonalCenterFit);

        if (tonalCenterFit < 0.5) {
            issues.push(`Section tonal center drifts from planned ${formExpectations.tonalCenter}.`);
        } else if (tonalCenterFit >= 0.74) {
            strengths.push(`Section tonal center stays aligned with planned ${formExpectations.tonalCenter}.`);
        }
    }

    if (typeof formExpectations?.cadenceStrength === "number") {
        actualCadenceStrength = Number((cadenceExpected
            ? ((cadenceResolved + (harmonicCadenceSupport >= 0 ? harmonicCadenceSupport : cadenceResolved)) / 2)
            : 0.5).toFixed(4));
        cadenceStrengthFit = Number((1 - clamp(Math.abs(actualCadenceStrength - formExpectations.cadenceStrength), 0, 1)).toFixed(4));
        harmonicPlanFitComponents.push(cadenceStrengthFit);

        if (formExpectations.cadenceStrength >= 0.55 && cadenceStrengthFit < 0.44) {
            issues.push("Cadence arrival is weaker than planned for this section.");
        } else if (cadenceStrengthFit >= 0.78) {
            strengths.push("Cadence weight matches the planned section role.");
        }
    }

    const resolvedDensityFit = noteDensityFit(noteCount, sectionWindow.section.measures, formExpectations?.harmonyDensity);
    if (resolvedDensityFit !== undefined) {
        densityPlanFit = resolvedDensityFit;
        harmonicPlanFitComponents.push(densityPlanFit);

        if (densityPlanFit < 0.38) {
            issues.push("Section note density does not support its planned harmonic role.");
        } else if (densityPlanFit >= 0.74) {
            strengths.push("Section note density supports its planned harmonic role.");
        }
    }

    if (typeof sectionWindow.section.harmonicPlan?.allowModulation === "boolean" && typeof formExpectations?.allowModulation === "boolean") {
        modulationPlanFit = sectionWindow.section.harmonicPlan.allowModulation === formExpectations.allowModulation ? 1 : 0;
        harmonicPlanFitComponents.push(modulationPlanFit);

        if (modulationPlanFit === 0) {
            issues.push(formExpectations.allowModulation
                ? "Section harmonic plan blocks the modulation expected for its formal role."
                : "Section harmonic plan allows modulation where the form expects a stable return.");
        }
    }

    const averageHarmonicPlanFit = average(harmonicPlanFitComponents);
    if (averageHarmonicPlanFit !== undefined) {
        sectionHarmonicPlanFit = averageHarmonicPlanFit;

        if (sectionHarmonicPlanFit < 0.48) {
            issues.push("Section harmonic plan does not read clearly for its formal role.");
        } else if (sectionHarmonicPlanFit >= 0.78) {
            strengths.push("Section harmonic plan clearly supports its formal role.");
        }
    }

    const harmonicCadenceScore = harmonicCadenceSupport >= 0 ? harmonicCadenceSupport : 0.5;
    const parallelMotionScore = bassNotes.length > 0 ? inverseProgress(parallelPerfectCount, 2) : 1;

    const score = Math.min(100, Math.round(
        (normalizedProgress(noteCount, expectedMinNotes + 2) * 20)
        + (normalizedProgress(Math.max(melodicSpan - 3, 0), 6) * 15)
        + (normalizedProgress(uniquePitchClasses, 4) * 20)
        + (normalizedProgress(uniqueDurations, 2) * 10)
        + (inverseProgress(wideLeapRatio, 0.4) * 15)
        + (inverseProgress(unresolvedLeaps, 2) * 10)
        + (cadenceResolved * 10)
        + (harmonicCadenceScore * 8)
        + (parallelMotionScore * 7)
        + (sectionHarmonicPlanFit >= 0 ? sectionHarmonicPlanFit * 8 : 0)
    ));

    return {
        sectionId: sectionWindow.section.id,
        label: sectionWindow.section.label,
        role: sectionWindow.section.role,
        startMeasure: sectionWindow.startMeasure,
        endMeasure: sectionWindow.endMeasure - 1,
        score,
        issues,
        strengths,
        metrics: {
            noteCount,
            melodicSpan,
            uniquePitchClasses,
            uniqueDurations,
            wideLeapRatio: Number(wideLeapRatio.toFixed(4)),
            unresolvedWideLeaps: unresolvedLeaps,
            cadenceResolved,
            harmonicCadenceSupport,
            parallelPerfectCount,
            tensionMismatch,
            actualTension,
            expectedTension: expectedSectionTension(sectionWindow.section) ?? -1,
            tonalCenterFit,
            actualCadenceStrength,
            cadenceStrengthFit,
            densityPlanFit,
            modulationPlanFit,
            sectionHarmonicPlanFit,
        },
    };
}

/**
 * 단순 MIDI 파서 — Format 0/1 MIDI에서 Note On/Off 이벤트를 추출한다.
 * 완전한 MIDI 파서가 아닌 검사 용도의 최소 구현.
 */
function parseMidiNotes(buf: Buffer): ParsedMidiData {
    const notes: ParsedNote[] = [];

    // MThd 확인
    if (buf.length < 14 || buf.toString("ascii", 0, 4) !== "MThd") {
        return { notes, ticksPerQuarter: 480 };
    }

    const headerLength = buf.readUInt32BE(4);
    const division = buf.readUInt16BE(12);
    const ticksPerQuarter = (division & 0x8000) === 0 ? Math.max(division, 1) : 480;

    let pos = 8 + headerLength; // MThd 이후
    let trackId = 0;

    while (pos < buf.length) {
        // MTrk 찾기
        if (buf.toString("ascii", pos, pos + 4) !== "MTrk") {
            pos++;
            continue;
        }
        const trackLen = buf.readUInt32BE(pos + 4);
        const trackEnd = pos + 8 + trackLen;
        pos += 8;
        trackId++;

        let tick = 0;
        let runningStatus = 0;
        const pending = new Map<string, { velocity: number; onTick: number }>();

        while (pos < trackEnd && pos < buf.length) {
            // 가변 길이 delta time
            const deltaInfo = readVariableLength(buf, pos, trackEnd);
            const delta = deltaInfo.value;
            pos = deltaInfo.next;
            tick += delta;

            if (pos >= buf.length) break;
            let status = buf[pos];

            // 메타/시스템 이벤트 건너뛰기
            if (status === 0xff) {
                pos++; // FF
                if (pos >= buf.length) break;
                pos++; // type
                const lenInfo = readVariableLength(buf, pos, trackEnd);
                pos = lenInfo.next + lenInfo.value;
                continue;
            }
            if (status === 0xf0 || status === 0xf7) {
                pos++;
                const lenInfo = readVariableLength(buf, pos, trackEnd);
                pos = lenInfo.next + lenInfo.value;
                continue;
            }

            // Running status 처리
            if (status & 0x80) {
                runningStatus = status;
                pos++;
            } else {
                status = runningStatus;
            }

            const cmd = status & 0xf0;
            const channel = status & 0x0f;

            if (cmd === 0x90 || cmd === 0x80) {
                const pitch = buf[pos++];
                const velocity = buf[pos++];
                const noteKey = `${channel}:${pitch}`;
                if (cmd === 0x90 && velocity > 0) {
                    pending.set(noteKey, { velocity, onTick: tick });
                } else {
                    const on = pending.get(noteKey);
                    if (on) {
                        notes.push({
                            pitch,
                            velocity: on.velocity,
                            onTick: on.onTick,
                            offTick: tick,
                            durationTicks: Math.max(tick - on.onTick, 0),
                            trackId,
                        });
                        pending.delete(noteKey);
                    }
                }
            } else if (cmd === 0xc0 || cmd === 0xd0) {
                pos += 1; // 1-byte data
            } else {
                pos += 2; // 2-byte data (control change, pitch bend 등)
            }
        }

        // 닫히지 않은 노트 처리
        for (const [noteKey, on] of pending) {
            const pitch = Number.parseInt(noteKey.split(":")[1] ?? "0", 10);
            notes.push({
                pitch,
                velocity: on.velocity,
                onTick: on.onTick,
                offTick: tick,
                durationTicks: Math.max(tick - on.onTick, 0),
                trackId,
            });
        }

        pos = trackEnd;
    }

    notes.sort((left, right) => left.onTick - right.onTick || left.trackId - right.trackId || left.pitch - right.pitch);
    return { notes, ticksPerQuarter };
}

/**
 * 최소 MIDI 검사기:
 * 1. 노트 수 최소 개수 검사
 * 2. 음역 이탈 검사 (피아노 범위)
 * 3. 총 길이 검사 (너무 짧은 프레이즈)
 * 4. 비정상 반복 검사 (동일 음고가 연속 N회 이상)
 * 5. 리드 라인의 음형/리듬 다양성, 도약, 종지 검사
 */
export async function critique(
    midiData: Buffer,
    songId: string,
    keyOrOptions?: string | CritiqueOptions,
): Promise<CritiqueResult> {
    const issues: string[] = [];
    const strengths: string[] = [];
    const metrics: Record<string, number> = {};
    const options = resolveCritiqueOptions(keyOrOptions);
    const key = options.key;

    logger.info("Critiquing", { songId });

    const { notes, ticksPerQuarter } = parseMidiNotes(midiData);
    metrics.noteCount = notes.length;
    let totalDurationBeats = 0;

    // 1. 노트 수 검사
    if (notes.length < MIN_NOTE_COUNT) {
        issues.push(`Too few notes: ${notes.length} (minimum ${MIN_NOTE_COUNT})`);
    } else if (notes.length >= MIN_NOTE_COUNT + 4) {
        strengths.push("The draft contains enough notes to support development.");
    }

    // 2. 음역 이탈 검사
    for (const n of notes) {
        if (n.pitch < MIN_PITCH || n.pitch > MAX_PITCH) {
            issues.push(`Pitch out of range: MIDI ${n.pitch} (valid ${MIN_PITCH}-${MAX_PITCH})`);
            break; // 한 번만 보고
        }
    }

    // 3. 총 길이 검사
    if (notes.length > 0) {
        const maxOffTick = Math.max(...notes.map(n => n.offTick));
        const minOnTick = Math.min(...notes.map(n => n.onTick));
        totalDurationBeats = (maxOffTick - minOnTick) / Math.max(ticksPerQuarter, 1);
        if (totalDurationBeats < MIN_TOTAL_DURATION_BEATS) {
            issues.push(`Piece too short: ${totalDurationBeats.toFixed(2)} beats (minimum ${MIN_TOTAL_DURATION_BEATS})`);
        } else if (totalDurationBeats >= MIN_TOTAL_DURATION_BEATS + 2) {
            strengths.push("Phrase length is long enough for a recognizable arc.");
        }
    }
    metrics.totalDurationBeats = Number(totalDurationBeats.toFixed(3));

    // 4. 비정상 반복 검사 (동일 음고가 동일 트랙 내에서 연속 8회 이상)
    // 트랙이 바뀌면 카운터를 리셋하여 멀티트랙 오탐을 방지한다.
    let consecutive = 1;
    let maxConsecutiveRepetition = notes.length > 0 ? 1 : 0;
    for (let i = 1; i < notes.length; i++) {
        const sameTrack = notes[i].trackId === notes[i - 1].trackId;
        if (sameTrack && notes[i].pitch === notes[i - 1].pitch) {
            consecutive++;
            maxConsecutiveRepetition = Math.max(maxConsecutiveRepetition, consecutive);
            if (consecutive >= MAX_CONSECUTIVE) {
                issues.push(`Excessive repetition: pitch ${notes[i].pitch} repeated ${consecutive}+ times in track ${notes[i].trackId}`);
                break;
            }
        } else {
            consecutive = 1;
        }
    }
    metrics.maxConsecutiveRepetition = maxConsecutiveRepetition;

    const leadNotes = selectLeadTrack(notes);
    const bassNotes = selectBassTrack(notes);
    let melodicSpan = 0;
    let uniquePitchClasses = 0;
    let uniqueDurations = 0;
    let wideLeapRatio = 0;
    let unresolvedLeaps = 0;
    let cadenceResolved = 0;
    if (leadNotes.length >= MIN_NOTE_COUNT) {
        melodicSpan = Math.max(...leadNotes.map((note) => note.pitch)) - Math.min(...leadNotes.map((note) => note.pitch));
        if (melodicSpan < MIN_MELODIC_SPAN) {
            issues.push(`Melody span too narrow: ${melodicSpan} semitones in lead track`);
        } else if (melodicSpan >= 8) {
            strengths.push("Lead melody spans a healthy register.");
        }

        uniquePitchClasses = new Set(leadNotes.map((note) => note.pitch % 12)).size;
        if (uniquePitchClasses < MIN_UNIQUE_PITCH_CLASSES) {
            issues.push(`Limited pitch-class variety: ${uniquePitchClasses} unique classes in lead track`);
        } else if (uniquePitchClasses >= 5) {
            strengths.push("Lead melody uses enough pitch classes to avoid monotony.");
        }

        uniqueDurations = new Set(leadNotes.map((note) => roundedBeats(note.durationTicks, ticksPerQuarter))).size;
        if (uniqueDurations < MIN_UNIQUE_DURATIONS) {
            issues.push(`Rhythm is too uniform: ${uniqueDurations} unique note lengths in lead track`);
        } else if (uniqueDurations >= 3) {
            strengths.push("Lead rhythm has more than one clear note-value cell.");
        }

        let wideLeaps = 0;
        for (let i = 1; i < leadNotes.length; i++) {
            const currentInterval = leadNotes[i].pitch - leadNotes[i - 1].pitch;
            if (Math.abs(currentInterval) > MAX_WIDE_LEAP_INTERVAL) {
                wideLeaps += 1;

                if (i < leadNotes.length - 1) {
                    const recoveryInterval = leadNotes[i + 1].pitch - leadNotes[i].pitch;
                    const recoversStepwise = recoveryInterval !== 0
                        && Math.abs(recoveryInterval) <= 5
                        && Math.sign(recoveryInterval) !== Math.sign(currentInterval);
                    if (!recoversStepwise) {
                        unresolvedLeaps += 1;
                    }
                }
            }
        }

        const intervalCount = Math.max(leadNotes.length - 1, 1);
        wideLeapRatio = wideLeaps / intervalCount;
        if (wideLeapRatio > MAX_WIDE_LEAP_RATIO) {
            issues.push(`Too many wide leaps: ${wideLeaps}/${intervalCount} melodic intervals exceed an octave`);
        } else if (wideLeapRatio <= 0.18) {
            strengths.push("The melody stays mostly singable with controlled leaps.");
        }

        if (unresolvedLeaps >= 2) {
            issues.push("Large leaps are not balanced by stepwise recovery");
        } else if (wideLeaps > 0) {
            strengths.push("Large intervals are followed by usable recovery motion.");
        }

        const finalCadenceKey = resolveFinalCadenceKey(options, key);
        const tonicTriad = tonicTriadPitchClasses(finalCadenceKey);
        const finalNote = leadNotes.at(-1);
        if (tonicTriad && finalNote) {
            if (!tonicTriad.has(finalNote.pitch % 12)) {
                issues.push(`Final melodic note does not resolve to the tonic triad for key ${finalCadenceKey}`);
            } else {
                cadenceResolved = 1;
                strengths.push(`Final melodic note resolves inside the tonic triad for ${finalCadenceKey}.`);
            }
        }
    }

    metrics.leadNoteCount = leadNotes.length;
    metrics.bassNoteCount = bassNotes.length;
    metrics.melodicSpan = melodicSpan;
    metrics.uniquePitchClasses = uniquePitchClasses;
    metrics.uniqueDurations = uniqueDurations;
    metrics.wideLeapRatio = Number(wideLeapRatio.toFixed(4));
    metrics.unresolvedWideLeaps = unresolvedLeaps;
    metrics.cadenceResolved = cadenceResolved;

    const sectionWindows = buildSectionWindows(options.sections);
    const sectionNotesById = new Map<string, ParsedNote[]>();
    const sectionBassNotesById = new Map<string, ParsedNote[]>();
    const sectionFindings = sectionWindows
        .map((sectionWindow) => {
            const startTick = (sectionWindow.startMeasure - 1) * beatsPerMeasure(options.meter) * ticksPerQuarter;
            const endTick = (sectionWindow.endMeasure - 1) * beatsPerMeasure(options.meter) * ticksPerQuarter;
            const sectionNotes = leadNotes.filter((note) => note.onTick >= startTick && note.onTick < endTick);
            const sectionBassNotes = bassNotes.filter((note) => note.onTick < endTick && note.offTick > startTick);
            sectionNotesById.set(sectionWindow.section.id, sectionNotes);
            sectionBassNotesById.set(sectionWindow.section.id, sectionBassNotes);
            return evaluateSection(sectionWindow, sectionNotes, sectionBassNotes, ticksPerQuarter, options.meter, key, options.form);
        });
    const weakestSections = sectionFindings
        .filter((finding) => finding.issues.length > 0)
        .sort((left, right) => left.score - right.score || right.issues.length - left.issues.length)
        .slice(0, 2);
    const tensionFindings = sectionFindings
        .map((finding) => finding.metrics.tensionMismatch)
        .filter((value) => Number.isFinite(value) && value >= 0);
    const harmonicCadenceFindings = sectionFindings
        .map((finding) => finding.metrics.harmonicCadenceSupport)
        .filter((value) => Number.isFinite(value) && value >= 0);
    const totalParallelPerfects = sectionFindings
        .reduce((sum, finding) => sum + Math.max(finding.metrics.parallelPerfectCount ?? 0, 0), 0);
    const averageTensionMismatch = tensionFindings.length > 0
        ? Number((tensionFindings.reduce((sum, value) => sum + value, 0) / tensionFindings.length).toFixed(4))
        : 0;
    const averageHarmonicCadenceSupport = harmonicCadenceFindings.length > 0
        ? Number((harmonicCadenceFindings.reduce((sum, value) => sum + value, 0) / harmonicCadenceFindings.length).toFixed(4))
        : -1;
    const sectionHarmonicPlanFindings = sectionFindings
        .map((finding) => finding.metrics.sectionHarmonicPlanFit)
        .filter((value) => Number.isFinite(value) && value >= 0);
    const averageSectionHarmonicPlanFit = sectionHarmonicPlanFindings.length > 0
        ? Number((sectionHarmonicPlanFindings.reduce((sum, value) => sum + value, 0) / sectionHarmonicPlanFindings.length).toFixed(4))
        : -1;
    metrics.sectionCount = sectionFindings.length;
    metrics.weakSectionCount = weakestSections.length;
    metrics.tensionArcMismatch = averageTensionMismatch;
    metrics.parallelPerfectCount = totalParallelPerfects;
    if (averageHarmonicCadenceSupport >= 0) {
        metrics.harmonicCadenceSupport = averageHarmonicCadenceSupport;
    }
    if (averageSectionHarmonicPlanFit >= 0) {
        metrics.sectionHarmonicPlanFit = averageSectionHarmonicPlanFit;
        if (averageSectionHarmonicPlanFit >= 0.76) {
            strengths.push("Section-level harmonic planning reads clearly across the form.");
        } else if (options.form && averageSectionHarmonicPlanFit < 0.52) {
            issues.push("Section-level harmonic plan does not read clearly across the form.");
        }
    }

    if (tensionFindings.length >= 2 && averageTensionMismatch >= 0.24) {
        issues.push("Section tension arc diverges from the planned energy contour");
    } else if (tensionFindings.length >= 2 && averageTensionMismatch <= 0.12) {
        strengths.push("Section tension arc broadly follows the planned contour.");
    }

    if (totalParallelPerfects >= 2) {
        issues.push("Parallel perfect intervals weaken the global outer-voice motion.");
    } else if (bassNotes.length > 0 && totalParallelPerfects === 0) {
        strengths.push("Outer-voice motion avoids exposed parallel perfects across sections.");
    }

    if (averageHarmonicCadenceSupport >= 0.85) {
        strengths.push("Cadential bass support reinforces the tonal close across formal sections.");
    } else if (averageHarmonicCadenceSupport >= 0 && averageHarmonicCadenceSupport < 0.45) {
        issues.push("Cadential bass motion does not consistently support the planned tonal closes.");
    }

    const narrativeSummary = summarizeNarrativeMetrics(sectionWindows, sectionFindings, sectionNotesById);
    Object.assign(metrics, narrativeSummary.metrics);
    issues.push(...narrativeSummary.issues);
    strengths.push(...narrativeSummary.strengths);

    const globalHarmonicSummary = summarizeGlobalHarmonicMetrics(
        sectionWindows,
        sectionFindings,
        sectionNotesById,
        sectionBassNotesById,
        key,
    );
    Object.assign(metrics, globalHarmonicSummary.metrics);
    issues.push(...globalHarmonicSummary.issues);
    strengths.push(...globalHarmonicSummary.strengths);

    const longSpanSummary = summarizeLongSpanMetrics(
        sectionWindows,
        sectionFindings,
        sectionNotesById,
        sectionBassNotesById,
        key,
        options.longSpanForm,
        narrativeSummary.metrics,
        globalHarmonicSummary.metrics,
    );
    Object.assign(metrics, longSpanSummary.metrics);
    issues.push(...longSpanSummary.issues);
    strengths.push(...longSpanSummary.strengths);

    const formCoherenceScore = average([
        averageSectionHarmonicPlanFit >= 0 ? averageSectionHarmonicPlanFit : undefined,
        narrativeSummary.metrics.developmentNarrativeFit,
        narrativeSummary.metrics.recapRecallFit,
        globalHarmonicSummary.metrics.globalHarmonicProgressionStrength,
    ].filter((value): value is number => typeof value === "number"));
    if (formCoherenceScore !== undefined) {
        metrics.formCoherenceScore = formCoherenceScore;
        if (options.form && formCoherenceScore >= 0.74) {
            strengths.push("Form-specific harmonic and thematic roles read clearly across sections.");
        } else if (options.form && formCoherenceScore < 0.56) {
            issues.push("Form-specific harmonic and thematic roles are not yet coherent enough.");
        }
    }

    const developmentNarrativeFit = narrativeSummary.metrics.developmentNarrativeFit ?? 0;
    const recapRecallFit = narrativeSummary.metrics.recapRecallFit ?? 0;
    const harmonicCadenceScore = averageHarmonicCadenceSupport >= 0 ? averageHarmonicCadenceSupport : 0.5;
    const parallelMotionScore = bassNotes.length > 0 ? inverseProgress(totalParallelPerfects, 3) : 1;
    const globalHarmonicRouteScore = globalHarmonicSummary.metrics.globalHarmonicProgressionStrength ?? 0.5;

    const score = Math.min(100, Math.round(
        (normalizedProgress(notes.length, 16) * 15)
        + (normalizedProgress(totalDurationBeats, 12) * 10)
        + (normalizedProgress(Math.max(melodicSpan - 4, 0), 8) * 15)
        + (normalizedProgress(uniquePitchClasses, 6) * 15)
        + (normalizedProgress(uniqueDurations, 3) * 10)
        + (inverseProgress(wideLeapRatio, MAX_WIDE_LEAP_RATIO) * 15)
        + (inverseProgress(unresolvedLeaps, 3) * 10)
        + (cadenceResolved * 10)
        + (developmentNarrativeFit * 8)
        + (recapRecallFit * 10)
        + (harmonicCadenceScore * 6)
        + (parallelMotionScore * 6)
        + (globalHarmonicRouteScore * 5)
    ));

    const pass = issues.length === 0;

    if (pass) {
        logger.info("Critique passed", { songId, noteCount: notes.length });
    } else {
        logger.warn("Critique failed", { songId, issues });
    }

    return { pass, issues, score, strengths, metrics, sectionFindings, weakestSections };
}
