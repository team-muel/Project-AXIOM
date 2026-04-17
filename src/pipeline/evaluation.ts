import fs from "node:fs";
import type {
    AudioLongSpanEvaluationDimension,
    AudioLongSpanEvaluationSummary,
    ArtifactPaths,
    AudioKeyAnalysisSource,
    AudioKeyDriftPoint,
    AudioEvaluationReport,
    ExpressionGuidance,
    HarmonicPlan,
    PhraseFunction,
    AudioKeyTrackingReport,
    AudioSectionEvaluationFinding,
    AudioSectionKeyTracking,
    ComposeWorkflow,
    CritiqueResult,
    RenderedKeyEstimate,
    SectionArtifactSummary,
    SectionPlan,
    SectionTonalitySummary,
    LongSpanEvaluationDimension,
    LongSpanEvaluationSummary,
    LongSpanFormPlan,
    OrchestrationBalanceProfile,
    OrchestrationConversationMode,
    OrchestrationEvaluationSummary,
    OrchestrationRegisterLayout,
    OrchestrationPlan,
    OrchestrationSectionPlan,
    StructureEvaluationReport,
    TextureGuidance,
    TonalityMode,
} from "./types.js";

interface StructureEvaluationOptions {
    sections?: SectionPlan[];
    sectionArtifacts?: SectionArtifactSummary[];
    textureDefaults?: TextureGuidance;
    expressionDefaults?: ExpressionGuidance;
    longSpanForm?: LongSpanFormPlan;
    orchestration?: OrchestrationPlan;
}

type StructureSectionFinding = NonNullable<StructureEvaluationReport["sectionFindings"]>[number];
type SectionRenderEvent = SectionArtifactSummary["melodyEvents"][number];

interface AudioEvaluationOptions {
    expectedDurationSec?: number;
    structureEvaluation?: StructureEvaluationReport;
    sections?: AudioNarrativeSection[];
    sectionTonalities?: AudioSectionTonality[];
    sectionArtifacts?: SectionArtifactSummary[];
}

type AudioNarrativeSection = Pick<SectionPlan, "id" | "label" | "role" | "measures">
    & Partial<Pick<SectionPlan, "motifRef" | "contrastFrom" | "harmonicPlan">>;

type AudioSectionTonality = Pick<SectionTonalitySummary, "sectionId" | "role" | "tonalCenter">;

interface WavChunkMetadata {
    audioFormat: number;
    channelCount: number;
    sampleRate: number;
    bitsPerSample: number;
    dataOffset: number;
    dataSize: number;
}

interface WavSignalData {
    sampleRate: number;
    durationSec: number;
    samples: Float32Array;
}

interface AudioSectionWindow {
    section: AudioNarrativeSection;
    startMeasure: number;
    endMeasure: number;
}

const LONG_SPAN_OPERATOR_THRESHOLDS: Record<LongSpanEvaluationDimension, { held: number; collapsed: number }> = {
    development_pressure: { held: 0.58, collapsed: 0.4 },
    thematic_transformation: { held: 0.56, collapsed: 0.38 },
    harmonic_timing: { held: 0.58, collapsed: 0.4 },
    return_payoff: { held: 0.62, collapsed: 0.44 },
};

const AUDIO_LONG_SPAN_OPERATOR_THRESHOLDS: Record<AudioLongSpanEvaluationDimension, { held: number; collapsed: number }> = {
    development_narrative: { held: 0.58, collapsed: 0.44 },
    recap_recall: { held: 0.58, collapsed: 0.48 },
    harmonic_route: { held: 0.62, collapsed: 0.52 },
    tonal_return: { held: 0.64, collapsed: 0.54 },
};

interface SectionSignalStats {
    rms: number;
    peak: number;
    flux: number;
}

interface NarrativeSignalAnalysis {
    label: string;
    sectionStats: Map<string, SectionSignalStats>;
}

interface InternalKeyDriftPoint {
    startRatio: number;
    endRatio: number;
    chroma: number[];
    dominantPitchClass: number;
    estimatedKey: RenderedKeyEstimate;
}

interface SectionChromaStats {
    chroma: number[];
    dominantPitchClass: number;
    confidence: number;
    estimatedKey: RenderedKeyEstimate;
    driftPoints: InternalKeyDriftPoint[];
}

interface NarrativeChromaAnalysis {
    label: AudioKeyAnalysisSource;
    sectionChromas: Map<string, SectionChromaStats>;
}

interface AudioSectionNarrativeAccumulator {
    section: AudioNarrativeSection;
    sourceSectionId?: string;
    plannedTonality?: string;
    narrativeFits: number[];
    pitchClassFits: number[];
    keyDriftFits: number[];
}

interface ParsedTonality {
    tonicPitchClass: number;
    mode?: TonalityMode;
    label: string;
}

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

const PITCH_CLASS_TO_TONIC = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const KRUMHANSL_MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const DYNAMIC_LEVEL_ORDER = ["pp", "p", "mp", "mf", "f", "ff"] as const;
const STRING_TRIO_IDIOMATIC_RANGES: Record<string, { min: number; max: number }> = {
    violin: { min: 55, max: 100 },
    viola: { min: 48, max: 88 },
    cello: { min: 36, max: 81 },
};

const CHROMA_MIDI_MIN = 48;
const CHROMA_MIDI_MAX = 83;

function checkFile(filePath: string | undefined): { exists: boolean; sizeBytes?: number } {
    if (!filePath) {
        return { exists: false };
    }

    try {
        const stat = fs.statSync(filePath);
        return {
            exists: stat.isFile() && stat.size > 0,
            sizeBytes: stat.size,
        };
    } catch {
        return { exists: false };
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function average(values: number[]): number | undefined {
    if (values.length === 0) {
        return undefined;
    }

    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function numericMetricValue(metrics: Record<string, number>, key: string): number | undefined {
    const value = metrics[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
}

function buildLongSpanEvaluationSummary(
    metrics: Record<string, number>,
    longSpanForm: LongSpanFormPlan | undefined,
): LongSpanEvaluationSummary | undefined {
    if (!longSpanForm) {
        return undefined;
    }

    const dimensionEntries: Array<{ dimension: LongSpanEvaluationDimension; fit?: number }> = [
        { dimension: "development_pressure", fit: numericMetricValue(metrics, "longSpanDevelopmentPressureFit") },
        { dimension: "thematic_transformation", fit: numericMetricValue(metrics, "longSpanThematicTransformationFit") },
        { dimension: "harmonic_timing", fit: numericMetricValue(metrics, "longSpanHarmonicTimingFit") },
        { dimension: "return_payoff", fit: numericMetricValue(metrics, "longSpanReturnPayoffFit") },
    ];
    const definedFits = dimensionEntries
        .map((entry) => entry.fit)
        .filter((value): value is number => typeof value === "number");
    const weakDimensions = dimensionEntries
        .filter((entry) => entry.fit !== undefined && entry.fit < LONG_SPAN_OPERATOR_THRESHOLDS[entry.dimension].held)
        .sort((left, right) => (left.fit ?? 1) - (right.fit ?? 1))
        .map((entry) => entry.dimension);
    const weakestDimension = dimensionEntries
        .filter((entry) => entry.fit !== undefined)
        .sort((left, right) => (left.fit ?? 1) - (right.fit ?? 1))[0]?.dimension;
    const averageFit = average(definedFits);
    const collapsed = definedFits.length === 0
        || dimensionEntries.some((entry) => (
            entry.fit !== undefined && entry.fit < LONG_SPAN_OPERATOR_THRESHOLDS[entry.dimension].collapsed
        ))
        || weakDimensions.length >= 3;
    const status = collapsed
        ? "collapsed"
        : weakDimensions.length > 0 || (averageFit !== undefined && averageFit < 0.72)
            ? "at_risk"
            : "held";

    return {
        status,
        ...(weakestDimension ? { weakestDimension } : {}),
        weakDimensions,
        ...(averageFit !== undefined ? { averageFit } : {}),
        expectedDevelopmentPressure: longSpanForm.expectedDevelopmentPressure,
        expectedReturnPayoff: longSpanForm.expectedReturnPayoff,
        thematicCheckpointCount: longSpanForm.thematicCheckpoints?.length ?? 0,
        developmentPressureFit: numericMetricValue(metrics, "longSpanDevelopmentPressureFit"),
        thematicTransformationFit: numericMetricValue(metrics, "longSpanThematicTransformationFit"),
        harmonicTimingFit: numericMetricValue(metrics, "longSpanHarmonicTimingFit"),
        returnPayoffFit: numericMetricValue(metrics, "longSpanReturnPayoffFit"),
    };
}

function buildAudioLongSpanEvaluationSummary(
    metrics: Record<string, number>,
    structureEvaluation: StructureEvaluationReport | undefined,
): AudioLongSpanEvaluationSummary | undefined {
    if (!structureEvaluation) {
        return undefined;
    }

    const dimensionEntries: Array<{ dimension: AudioLongSpanEvaluationDimension; fit?: number }> = [
        { dimension: "development_narrative", fit: numericMetricValue(metrics, "audioDevelopmentNarrativeFit") },
        { dimension: "recap_recall", fit: numericMetricValue(metrics, "audioRecapRecallFit") },
        { dimension: "harmonic_route", fit: numericMetricValue(metrics, "audioHarmonicRouteRenderFit") },
        { dimension: "tonal_return", fit: numericMetricValue(metrics, "audioTonalReturnRenderFit") },
    ];
    const definedFits = dimensionEntries
        .map((entry) => entry.fit)
        .filter((value): value is number => typeof value === "number");
    const weakDimensions = dimensionEntries
        .filter((entry) => entry.fit !== undefined && entry.fit < AUDIO_LONG_SPAN_OPERATOR_THRESHOLDS[entry.dimension].held)
        .sort((left, right) => (left.fit ?? 1) - (right.fit ?? 1))
        .map((entry) => entry.dimension);
    const weakestDimension = dimensionEntries
        .filter((entry) => entry.fit !== undefined)
        .sort((left, right) => (left.fit ?? 1) - (right.fit ?? 1))[0]?.dimension;
    const averageFit = average(definedFits);
    if (definedFits.length === 0) {
        return undefined;
    }
    const collapsed = definedFits.length === 0
        || dimensionEntries.some((entry) => (
            entry.fit !== undefined && entry.fit < AUDIO_LONG_SPAN_OPERATOR_THRESHOLDS[entry.dimension].collapsed
        ));
    const status = collapsed
        ? "collapsed"
        : weakDimensions.length > 0
            ? "at_risk"
            : "held";

    return {
        status,
        ...(weakestDimension ? { weakestDimension } : {}),
        weakDimensions,
        averageFit,
        developmentNarrativeFit: numericMetricValue(metrics, "audioDevelopmentNarrativeFit"),
        recapRecallFit: numericMetricValue(metrics, "audioRecapRecallFit"),
        harmonicRouteFit: numericMetricValue(metrics, "audioHarmonicRouteRenderFit"),
        tonalReturnFit: numericMetricValue(metrics, "audioTonalReturnRenderFit"),
    };
}

function consistencyFit(values: number[], tolerance: number): number | undefined {
    if (values.length < 2 || tolerance <= 0) {
        return undefined;
    }

    const spread = Math.max(...values) - Math.min(...values);
    return Number((1 - clamp(spread / tolerance, 0, 1)).toFixed(4));
}

function weightedAverage(values: Array<{ value: number | undefined; weight: number }>): number | undefined {
    const present = values.filter((entry) => entry.value !== undefined && Number.isFinite(entry.value));
    if (present.length === 0) {
        return undefined;
    }

    const totalWeight = present.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0) {
        return undefined;
    }

    return Number((present.reduce((sum, entry) => sum + ((entry.value ?? 0) * entry.weight), 0) / totalWeight).toFixed(4));
}

function normalizeSectionFindingScore(score: unknown): number {
    if (typeof score !== "number" || !Number.isFinite(score)) {
        return 0;
    }

    return Number((score > 1 ? score : score * 100).toFixed(4));
}

function mergeStructureSectionInsights(
    sectionFindings: StructureSectionFinding[] | undefined,
    weakestSections: StructureSectionFinding[] | undefined,
): StructureSectionFinding[] {
    const merged = new Map<string, StructureSectionFinding>();

    for (const finding of [...(sectionFindings ?? []), ...(weakestSections ?? [])]) {
        const key = finding.sectionId || `${finding.label}:${finding.startMeasure}:${finding.endMeasure}`;
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, finding);
            continue;
        }

        const findingScore = normalizeSectionFindingScore(finding.score);
        const existingScore = normalizeSectionFindingScore(existing.score);
        if (findingScore < existingScore || (findingScore === existingScore && finding.issues.length > existing.issues.length)) {
            merged.set(key, finding);
        }
    }

    return [...merged.values()];
}

function selectWeakestStructureSections(sectionFindings: StructureSectionFinding[]): StructureSectionFinding[] {
    return sectionFindings
        .filter((finding) => finding.issues.length > 0)
        .sort((left, right) => left.score - right.score || right.issues.length - left.issues.length)
        .slice(0, 2);
}

function computeStructureSectionReliability(sectionInsights: StructureSectionFinding[]): {
    averageSectionScore?: number;
    minimumSectionScore?: number;
    sectionScoreSpread?: number;
    issueBearingSectionCount: number;
    sectionReliabilityFit?: number;
    penalty: number;
} {
    if (sectionInsights.length === 0) {
        return {
            issueBearingSectionCount: 0,
            penalty: 0,
        };
    }

    const normalizedScores = sectionInsights.map((finding) => normalizeSectionFindingScore(finding.score));
    const averageSectionScore = average(normalizedScores);
    const minimumSectionScore = Math.min(...normalizedScores);
    const maximumSectionScore = Math.max(...normalizedScores);
    const sectionScoreSpread = Number((maximumSectionScore - minimumSectionScore).toFixed(4));
    const issueBearingSectionCount = sectionInsights.filter((finding) => finding.issues.length > 0).length;
    const sectionIssuePressure = average(sectionInsights.map((finding) => clamp(finding.issues.length / 3, 0, 1))) ?? 0;
    const sectionReliabilityFit = weightedAverage([
        { value: averageSectionScore !== undefined ? averageSectionScore / 100 : undefined, weight: 3 },
        { value: minimumSectionScore / 100, weight: 4 },
        { value: 1 - clamp(sectionScoreSpread / 28, 0, 1), weight: 2 },
        { value: 1 - clamp(sectionIssuePressure, 0, 1), weight: 2 },
    ]);
    const penalty = Number((
        (Math.max(0, 74 - (averageSectionScore ?? 0)) * 0.12)
        + (Math.max(0, 70 - minimumSectionScore) * 0.35)
        + (Math.max(0, sectionScoreSpread - 12) * 0.25)
        + (issueBearingSectionCount * 0.85)
    ).toFixed(2));

    return {
        averageSectionScore,
        minimumSectionScore: Number(minimumSectionScore.toFixed(4)),
        sectionScoreSpread,
        issueBearingSectionCount,
        sectionReliabilityFit,
        penalty,
    };
}

function pushUnique(values: string[], message: string | undefined): void {
    const normalized = String(message ?? "").trim();
    if (!normalized || values.includes(normalized)) {
        return;
    }

    values.push(normalized);
}

function cloneExpressionGuidance(expression: ExpressionGuidance | undefined): ExpressionGuidance | undefined {
    return expression
        ? JSON.parse(JSON.stringify(expression)) as ExpressionGuidance
        : undefined;
}

function mergeExpressionGuidance(
    defaults: ExpressionGuidance | undefined,
    override: ExpressionGuidance | undefined,
): ExpressionGuidance | undefined {
    const defaultDynamics = defaults?.dynamics;
    const overrideDynamics = override?.dynamics;
    const dynamics = defaultDynamics || overrideDynamics
        ? {
            ...(defaultDynamics ? { ...defaultDynamics } : {}),
            ...(overrideDynamics ? { ...overrideDynamics } : {}),
            ...((overrideDynamics?.hairpins?.length
                ? { hairpins: overrideDynamics.hairpins.map((hairpin) => ({ ...hairpin })) }
                : defaultDynamics?.hairpins?.length
                    ? { hairpins: defaultDynamics.hairpins.map((hairpin) => ({ ...hairpin })) }
                    : {})),
        }
        : undefined;
    const articulation = override?.articulation?.length
        ? [...override.articulation]
        : defaults?.articulation?.length
            ? [...defaults.articulation]
            : undefined;
    const character = override?.character?.length
        ? [...override.character]
        : defaults?.character?.length
            ? [...defaults.character]
            : undefined;
    const phrasePeaks = override?.phrasePeaks?.length
        ? [...override.phrasePeaks]
        : defaults?.phrasePeaks?.length
            ? [...defaults.phrasePeaks]
            : undefined;
    const sustainBias = override?.sustainBias ?? defaults?.sustainBias;
    const accentBias = override?.accentBias ?? defaults?.accentBias;
    const notes = override?.notes?.length
        ? [...override.notes]
        : defaults?.notes?.length
            ? [...defaults.notes]
            : undefined;

    if (!dynamics && !articulation && !character && !phrasePeaks && sustainBias === undefined && accentBias === undefined && !notes) {
        return undefined;
    }

    return {
        ...(dynamics ? { dynamics } : {}),
        ...(articulation ? { articulation } : {}),
        ...(character ? { character } : {}),
        ...(phrasePeaks ? { phrasePeaks } : {}),
        ...(sustainBias !== undefined ? { sustainBias } : {}),
        ...(accentBias !== undefined ? { accentBias } : {}),
        ...(notes ? { notes } : {}),
    };
}

function mergeTextureGuidance(
    defaults: TextureGuidance | undefined,
    override: TextureGuidance | undefined,
): TextureGuidance | undefined {
    const voiceCount = override?.voiceCount ?? defaults?.voiceCount;
    const primaryRoles = override?.primaryRoles?.length
        ? [...override.primaryRoles]
        : defaults?.primaryRoles?.length
            ? [...defaults.primaryRoles]
            : undefined;
    const counterpointMode = override?.counterpointMode ?? defaults?.counterpointMode;
    const notes = override?.notes?.length
        ? [...override.notes]
        : defaults?.notes?.length
            ? [...defaults.notes]
            : undefined;

    if (voiceCount === undefined && !primaryRoles && !counterpointMode && !notes) {
        return undefined;
    }

    return {
        ...(voiceCount !== undefined ? { voiceCount } : {}),
        ...(primaryRoles ? { primaryRoles } : {}),
        ...(counterpointMode ? { counterpointMode } : {}),
        ...(notes ? { notes } : {}),
    };
}

function dynamicLevelRank(level: unknown): number | undefined {
    const normalized = String(level ?? "").trim().toLowerCase();
    const rank = DYNAMIC_LEVEL_ORDER.indexOf(normalized as typeof DYNAMIC_LEVEL_ORDER[number]);
    return rank >= 0 ? rank : undefined;
}

function computeDynamicsFit(
    expected: ExpressionGuidance["dynamics"] | undefined,
    actual: SectionArtifactSummary["expressionDynamics"] | undefined,
): number | undefined {
    const fields: Array<"start" | "peak" | "end"> = ["start", "peak", "end"];
    const scores = fields
        .filter((field) => expected?.[field] !== undefined)
        .map((field) => {
            const expectedRank = dynamicLevelRank(expected?.[field]);
            if (expectedRank === undefined) {
                return undefined;
            }

            const actualRank = dynamicLevelRank(actual?.[field]);
            if (actualRank === undefined) {
                return 0;
            }

            return Number((1 - clamp(Math.abs(actualRank - expectedRank) / (DYNAMIC_LEVEL_ORDER.length - 1), 0, 1)).toFixed(4));
        })
        .filter((score): score is number => score !== undefined);

    return average(scores);
}

function computeTagSetFit(expected: string[] | undefined, actual: string[] | undefined): number | undefined {
    if (!expected?.length) {
        return undefined;
    }

    const expectedSet = new Set(expected.map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (expectedSet.size === 0) {
        return undefined;
    }

    const actualSet = new Set((actual ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (actualSet.size === 0) {
        return 0;
    }

    const overlap = [...expectedSet].filter((item) => actualSet.has(item)).length;
    const unionSize = new Set([...expectedSet, ...actualSet]).size;
    return Number((overlap / Math.max(unionSize, 1)).toFixed(4));
}

function computePhraseFunctionFit(
    expected: PhraseFunction | undefined,
    actual: SectionArtifactSummary["phraseFunction"] | undefined,
): number | undefined {
    if (!expected) {
        return undefined;
    }

    if (!actual) {
        return 0;
    }

    if (expected === actual) {
        return 1;
    }

    const adjacency = new Set([
        "presentation:continuation",
        "continuation:presentation",
        "continuation:transition",
        "transition:continuation",
        "continuation:developmental",
        "developmental:continuation",
        "transition:developmental",
        "developmental:transition",
        "transition:cadential",
        "cadential:transition",
        "continuation:cadential",
        "cadential:continuation",
    ]);

    return adjacency.has(`${expected}:${actual}`) ? 0.45 : 0.15;
}

function computeTextureVoiceCountFit(expected: number | undefined, actual: number | undefined): number | undefined {
    if (expected === undefined) {
        return undefined;
    }

    if (actual === undefined) {
        return 0;
    }

    const maxDiff = Math.max(expected, 2);
    return Number((1 - clamp(Math.abs(actual - expected) / maxDiff, 0, 1)).toFixed(4));
}

function computeCounterpointModeFit(
    expected: NonNullable<TextureGuidance["counterpointMode"]> | undefined,
    actual: SectionArtifactSummary["counterpointMode"] | undefined,
): number | undefined {
    if (!expected) {
        return undefined;
    }

    if (!actual) {
        return 0;
    }

    if (expected === actual) {
        return 1;
    }

    if (expected === "free") {
        return actual === "none" ? 0.25 : 0.7;
    }

    if (actual === "free") {
        return expected === "none" ? 0.2 : 0.55;
    }

    if (expected === "none" || actual === "none") {
        return 0.15;
    }

    return 0.35;
}

function expectsIndependentTexture(plannedTexture: TextureGuidance | undefined): boolean {
    if (!plannedTexture) {
        return false;
    }

    const roles = new Set((plannedTexture.primaryRoles ?? []).map((role) => role.trim().toLowerCase()));
    return roles.has("counterline")
        || roles.has("inner_voice")
        || Boolean(plannedTexture.counterpointMode && plannedTexture.counterpointMode !== "none");
}

type TaggedSecondaryVoiceRole = "bass" | "counterline" | "inner_voice";

interface SecondaryLineEvidence {
    pitchCount: number;
    span: number;
    distinctPitchClasses: number;
    motionRate?: number;
    contraryMotionRate?: number;
    motif: number[];
    derivedFromVoiceRole: boolean;
}

const SECONDARY_VOICE_ROLES = new Set<TaggedSecondaryVoiceRole>(["counterline", "inner_voice"]);

function normalizeTaggedVoiceRole(value: unknown): TaggedSecondaryVoiceRole | undefined {
    const role = String(value ?? "").trim();
    if (role === "bass" || role === "counterline" || role === "inner_voice") {
        return role;
    }

    return undefined;
}

function extractNumericSequence(values: readonly unknown[] | undefined): number[] {
    return (values ?? [])
        .filter((value): value is number => Number.isFinite(value))
        .map((value) => Number(Number(value).toFixed(4)));
}

function eventPitches(event: SectionRenderEvent | undefined): number[] {
    if (!event || event.type === "rest") {
        return [];
    }

    if (event.type === "chord") {
        return extractNumericSequence(event.pitches).map((pitch) => Math.trunc(pitch));
    }

    return typeof event.pitch === "number"
        ? [Math.trunc(event.pitch)]
        : [];
}

function extractTaggedVoicePitches(
    events: SectionRenderEvent[] | undefined,
    voiceRoles: ReadonlySet<TaggedSecondaryVoiceRole>,
): number[] {
    const pitches: number[] = [];

    for (const event of events ?? []) {
        const voiceRole = normalizeTaggedVoiceRole(event.voiceRole);
        if (!voiceRole || !voiceRoles.has(voiceRole)) {
            continue;
        }

        const groupedPitches = eventPitches(event).sort((left, right) => left - right);
        if (groupedPitches.length === 0) {
            continue;
        }

        if (voiceRole === "bass") {
            pitches.push(groupedPitches[0]);
            continue;
        }

        if (voiceRole === "inner_voice" && groupedPitches.length >= 3) {
            pitches.push(groupedPitches[Math.floor(groupedPitches.length / 2)]);
            continue;
        }

        pitches.push(groupedPitches[groupedPitches.length - 1]);
    }

    return pitches;
}

function captureMotifIntervals(pitches: number[], limit = 6): number[] {
    const phrase = pitches.slice(0, limit);
    if (phrase.length < 2) {
        return [];
    }

    const anchor = phrase[0];
    return phrase.map((pitch) => Number((pitch - anchor).toFixed(4)));
}

function pitchMotionRate(values: number[]): number | undefined {
    if (values.length < 2) {
        return undefined;
    }

    const movingSteps = values.reduce((sum, value, index) => (
        index > 0 && value !== values[index - 1]
            ? sum + 1
            : sum
    ), 0);
    return Number((movingSteps / Math.max(values.length - 1, 1)).toFixed(4));
}

function distinctPitchClassCount(values: number[]): number {
    return new Set(values.map((value) => ((Math.trunc(value) % 12) + 12) % 12)).size;
}

function pitchSpan(values: number[]): number {
    if (values.length < 2) {
        return 0;
    }

    return Math.max(...values) - Math.min(...values);
}

function resamplePitchHistory(values: number[], targetLength: number): number[] {
    if (values.length === 0 || targetLength <= 0) {
        return [];
    }

    if (values.length === 1) {
        return Array.from({ length: targetLength }, () => values[0]);
    }

    if (targetLength === 1) {
        return [values[values.length - 1]];
    }

    const sampled: number[] = [];
    const sourceLength = values.length - 1;
    const targetDenominator = Math.max(targetLength - 1, 1);
    for (let index = 0; index < targetLength; index += 1) {
        const mappedIndex = Math.round((index * sourceLength) / targetDenominator);
        sampled.push(values[Math.min(mappedIndex, values.length - 1)]);
    }

    return sampled;
}

function motionSigns(values: number[]): number[] {
    const signs: number[] = [];
    for (let index = 1; index < values.length; index += 1) {
        const delta = values[index] - values[index - 1];
        signs.push(delta > 0 ? 1 : delta < 0 ? -1 : 0);
    }

    return signs;
}

function contraryMotionRate(primary: number[], secondary: number[]): number | undefined {
    if (primary.length < 2 || secondary.length < 2) {
        return undefined;
    }

    const sampleLength = Math.max(2, Math.min(primary.length, secondary.length));
    const primarySample = resamplePitchHistory(primary, sampleLength);
    const secondarySample = resamplePitchHistory(secondary, sampleLength);
    const comparablePairs = motionSigns(primarySample)
        .map((left, index) => [left, motionSigns(secondarySample)[index]] as const)
        .filter(([left, right]) => left !== 0 && right !== 0);

    if (comparablePairs.length === 0) {
        return 0;
    }

    const contraryPairs = comparablePairs.filter(([left, right]) => left === (-1 * right)).length;
    return Number((contraryPairs / comparablePairs.length).toFixed(4));
}

function resolveSecondaryLineEvidence(
    artifact: SectionArtifactSummary | undefined,
): SecondaryLineEvidence | undefined {
    const taggedPitches = extractTaggedVoicePitches(artifact?.accompanimentEvents, SECONDARY_VOICE_ROLES);
    const noteHistory = extractNumericSequence(artifact?.noteHistory);
    const summaryMotif = extractNumericSequence(artifact?.secondaryLineMotif);
    const pitchCount = taggedPitches.length > 0
        ? taggedPitches.length
        : Math.max(Number(artifact?.secondaryLinePitchCount ?? 0), 0);
    const span = taggedPitches.length > 1
        ? pitchSpan(taggedPitches)
        : Math.max(Number(artifact?.secondaryLineSpan ?? 0), 0);
    const distinctPitchClasses = taggedPitches.length > 0
        ? distinctPitchClassCount(taggedPitches)
        : Math.max(Number(artifact?.secondaryLineDistinctPitchClasses ?? 0), 0);
    const motionRate = taggedPitches.length >= 2
        ? pitchMotionRate(taggedPitches)
        : typeof artifact?.textureIndependentMotionRate === "number"
            ? Number(artifact.textureIndependentMotionRate.toFixed(4))
            : undefined;
    const contraryRate = taggedPitches.length >= 2
        ? contraryMotionRate(noteHistory, taggedPitches)
        : typeof artifact?.textureContraryMotionRate === "number"
            ? Number(artifact.textureContraryMotionRate.toFixed(4))
            : undefined;
    const motif = summaryMotif.length >= 2
        ? summaryMotif.slice(0, 6)
        : captureMotifIntervals(taggedPitches);

    if (pitchCount <= 0 && motif.length < 2 && motionRate === undefined && contraryRate === undefined) {
        return undefined;
    }

    return {
        pitchCount,
        span,
        distinctPitchClasses,
        motionRate,
        contraryMotionRate: contraryRate,
        motif,
        derivedFromVoiceRole: taggedPitches.length >= 2,
    };
}

function computeTextureIndependenceFit(
    plannedTexture: TextureGuidance | undefined,
    artifact: SectionArtifactSummary | undefined,
): number | undefined {
    if (!expectsIndependentTexture(plannedTexture)) {
        return undefined;
    }

    const secondaryEvidence = resolveSecondaryLineEvidence(artifact);
    const pitchCountFit = clamp((secondaryEvidence?.pitchCount ?? 0) / Math.max(artifact?.measureCount ?? 4, 4), 0, 1);
    const spanFit = clamp(((secondaryEvidence?.span ?? 0) - 2) / 10, 0, 1);
    const pitchClassFit = clamp(((secondaryEvidence?.distinctPitchClasses ?? 0) - 2) / 4, 0, 1);
    const motionFit = clamp(((secondaryEvidence?.motionRate ?? 0) - 0.18) / 0.52, 0, 1);
    const fit = weightedAverage([
        { value: pitchCountFit, weight: 1 },
        { value: spanFit, weight: 2 },
        { value: pitchClassFit, weight: 2 },
        { value: motionFit, weight: 4 },
    ]);

    return fit === undefined ? 0 : Number(fit.toFixed(4));
}

function normalizeArtifactMotifShape(
    artifact: SectionArtifactSummary | undefined,
    limit = 8,
    preferSecondaryLine = false,
): number[] {
    if (preferSecondaryLine) {
        const secondary = resolveSecondaryLineEvidence(artifact)?.motif.slice(0, limit) ?? [];
        if (secondary.length >= 2) {
            return secondary.map((value) => Number(value.toFixed(4)));
        }
    }

    const captured = (artifact?.capturedMotif ?? [])
        .filter((value): value is number => Number.isFinite(value))
        .slice(0, limit);
    if (captured.length >= 2) {
        return captured.map((value) => Number(value.toFixed(4)));
    }

    const noteHistory = (artifact?.noteHistory ?? [])
        .filter((value): value is number => Number.isFinite(value))
        .slice(0, limit);
    if (noteHistory.length < 2) {
        return [];
    }

    const anchor = noteHistory[0];
    return noteHistory.map((pitch) => Number((pitch - anchor).toFixed(4)));
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

function resolveArtifactTransformFit(
    artifact: SectionArtifactSummary | undefined,
    sourceArtifact: SectionArtifactSummary | undefined,
): number | undefined {
    const sourceSectionId = String(artifact?.transform?.sourceSectionId ?? "").trim();
    if (!sourceSectionId) {
        return (resolveSecondaryLineEvidence(artifact)?.motif.length ?? 0) >= 2 ? undefined : 0;
    }

    if (sourceSectionId !== sourceArtifact?.sectionId) {
        return 0;
    }

    const transformMode = String(artifact?.transform?.transformMode ?? "").trim().toLowerCase();
    if (!transformMode) {
        return 0.72;
    }

    if (
        transformMode.includes("sequence")
        || transformMode.includes("answer")
        || transformMode.includes("imitation")
        || transformMode.includes("inversion")
        || transformMode.includes("augmentation")
        || transformMode.includes("diminution")
    ) {
        return 1;
    }

    return 0.82;
}

function computeImitationFit(
    plannedTexture: TextureGuidance | undefined,
    artifact: SectionArtifactSummary | undefined,
    sourceArtifact: SectionArtifactSummary | undefined,
    counterpointModeFit: number | undefined,
    textureIndependenceFit: number | undefined,
): number | undefined {
    if (plannedTexture?.counterpointMode !== "imitative") {
        return undefined;
    }

    const currentShape = normalizeArtifactMotifShape(artifact, 8, true);
    const sourceShape = normalizeArtifactMotifShape(sourceArtifact);
    const motifRelationFit = currentShape.length >= 2 && sourceShape.length >= 2
        ? motifShapeSimilarity(currentShape, sourceShape)
        : 0;
    const transformFit = resolveArtifactTransformFit(artifact, sourceArtifact);
    const relationFit = weightedAverage([
        { value: motifRelationFit, weight: 5 },
        { value: transformFit, weight: 2 },
    ]) ?? 0;
    const motionFit = clamp(((resolveSecondaryLineEvidence(artifact)?.motionRate ?? 0) - 0.18) / 0.52, 0, 1);
    const independenceFit = textureIndependenceFit ?? 0;
    const fit = weightedAverage([
        { value: relationFit, weight: 5 },
        { value: independenceFit, weight: 2 },
        { value: motionFit, weight: 2 },
        { value: counterpointModeFit ?? 0, weight: 1 },
    ]);

    return fit === undefined ? 0 : Number(fit.toFixed(4));
}

function computeCounterpointBehaviorFit(
    plannedTexture: TextureGuidance | undefined,
    artifact: SectionArtifactSummary | undefined,
    counterpointModeFit: number | undefined,
    textureIndependenceFit: number | undefined,
    imitationFit: number | undefined,
): number | undefined {
    const expectedMode = plannedTexture?.counterpointMode;
    if (!expectedMode || expectedMode === "none") {
        return undefined;
    }

    const secondaryEvidence = resolveSecondaryLineEvidence(artifact);
    const independenceFit = textureIndependenceFit ?? 0;
    const motionFit = clamp(((secondaryEvidence?.motionRate ?? 0) - 0.18) / 0.52, 0, 1);

    if (expectedMode === "contrary_motion") {
        const contraryFit = clamp(((secondaryEvidence?.contraryMotionRate ?? 0) - 0.24) / 0.46, 0, 1);
        const fit = weightedAverage([
            { value: independenceFit, weight: 2 },
            { value: contraryFit, weight: 4 },
            { value: counterpointModeFit ?? 0, weight: 1 },
        ]);
        return fit === undefined ? 0 : Number(fit.toFixed(4));
    }

    if (expectedMode === "imitative") {
        const fit = weightedAverage([
            { value: imitationFit ?? 0, weight: 5 },
            { value: independenceFit, weight: 2 },
            { value: motionFit, weight: 2 },
            { value: counterpointModeFit ?? 0, weight: 1 },
        ]);
        return fit === undefined ? 0 : Number(fit.toFixed(4));
    }

    if (expectedMode === "free") {
        const fit = weightedAverage([
            { value: independenceFit, weight: 4 },
            { value: motionFit, weight: 2 },
            { value: counterpointModeFit ?? 0, weight: 1 },
        ]);
        return fit === undefined ? 0 : Number(fit.toFixed(4));
    }

    const fit = weightedAverage([
        { value: independenceFit, weight: 3 },
        { value: motionFit, weight: 2 },
        { value: counterpointModeFit ?? 0, weight: 2 },
    ]);
    return fit === undefined ? 0 : Number(fit.toFixed(4));
}

function resolveTextureSourceSectionId(
    section: SectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
    orderedSections: SectionPlan[],
): string | undefined {
    const transformSource = String(artifact?.transform?.sourceSectionId ?? "").trim();
    if (transformSource) {
        return transformSource;
    }

    const motifRef = String(section?.motifRef ?? "").trim();
    if (motifRef) {
        return motifRef;
    }

    const contrastFrom = String(section?.contrastFrom ?? "").trim();
    if (contrastFrom) {
        return contrastFrom;
    }

    if (!section?.id || orderedSections.length === 0) {
        return undefined;
    }

    const currentIndex = orderedSections.findIndex((candidate) => candidate.id === section.id);
    if (currentIndex <= 0) {
        return undefined;
    }

    const previousSections = orderedSections.slice(0, currentIndex);
    if (section.role === "recap") {
        return previousSections.find((candidate) => candidate.role === "theme_a")?.id
            ?? previousSections.find((candidate) => candidate.role === "theme_b")?.id
            ?? previousSections[0]?.id;
    }

    if (section.role === "development" || section.role === "variation") {
        return [...previousSections].reverse().find((candidate) => (
            candidate.role === "theme_a"
            || candidate.role === "theme_b"
            || candidate.role === "intro"
            || candidate.role === "bridge"
        ))?.id;
    }

    return undefined;
}

function computePhrasePeakFit(expected: number[] | undefined, actual: number[] | undefined): number | undefined {
    if (!expected?.length) {
        return undefined;
    }

    if (!actual?.length) {
        return 0;
    }

    const averageDistance = expected.reduce((sum, peak) => (
        sum + Math.min(...actual.map((candidate) => Math.abs(candidate - peak)))
    ), 0) / expected.length;

    return Number((1 - clamp(averageDistance / 4, 0, 1)).toFixed(4));
}

function computeScalarFit(expected: number | undefined, actual: number | undefined, maxDiff: number): number | undefined {
    if (expected === undefined) {
        return undefined;
    }

    if (actual === undefined || maxDiff <= 0) {
        return 0;
    }

    return Number((1 - clamp(Math.abs(actual - expected) / maxDiff, 0, 1)).toFixed(4));
}

function computePhraseBreathPlanFit(
    summary: SectionArtifactSummary["phraseBreathSummary"] | undefined,
): {
    fit?: number;
    coverageFit?: number;
    pickupFit?: number;
    arrivalFit?: number;
    releaseFit?: number;
    recoveryFit?: number;
    rubatoFit?: number;
} {
    if (!summary?.requestedCues?.length || summary.targetedMeasureCount <= 0) {
        return {};
    }

    const coverageFit = Number(clamp(summary.realizedMeasureCount / Math.max(summary.targetedMeasureCount, 1), 0, 1).toFixed(4));
    const pickupFit = (summary.pickupMeasureCount ?? 0) > 0
        ? weightedAverage([
            {
                value: typeof summary.pickupAverageDurationScale === "number"
                    ? Number(clamp((1 - summary.pickupAverageDurationScale) / 0.06, 0, 1).toFixed(4))
                    : undefined,
                weight: 2,
            },
            {
                value: typeof summary.pickupAverageTimingJitterScale === "number"
                    ? Number(clamp((summary.pickupAverageTimingJitterScale - 1) / 0.08, 0, 1).toFixed(4))
                    : undefined,
                weight: 2,
            },
        ])
        : undefined;
    const arrivalFit = (summary.arrivalMeasureCount ?? 0) > 0
        ? weightedAverage([
            {
                value: typeof summary.arrivalAverageDurationScale === "number"
                    ? Number(clamp((summary.arrivalAverageDurationScale - 1) / 0.12, 0, 1).toFixed(4))
                    : undefined,
                weight: 3,
            },
            {
                value: typeof summary.arrivalAverageEndingStretchScale === "number"
                    ? Number(clamp((summary.arrivalAverageEndingStretchScale - 1) / 0.24, 0, 1).toFixed(4))
                    : undefined,
                weight: 2,
            },
            {
                value: typeof summary.arrivalAverageTimingJitterScale === "number"
                    ? Number(clamp((1 - summary.arrivalAverageTimingJitterScale) / 0.24, 0, 1).toFixed(4))
                    : undefined,
                weight: 1,
            },
        ])
        : undefined;
    const releaseFit = (summary.releaseMeasureCount ?? 0) > 0
        ? weightedAverage([
            {
                value: typeof summary.releaseAverageDurationScale === "number"
                    ? Number(clamp((summary.releaseAverageDurationScale - 1) / 0.12, 0, 1).toFixed(4))
                    : undefined,
                weight: 3,
            },
            {
                value: typeof summary.releaseAverageEndingStretchScale === "number"
                    ? Number(clamp((summary.releaseAverageEndingStretchScale - 1) / 0.24, 0, 1).toFixed(4))
                    : undefined,
                weight: 2,
            },
            {
                value: typeof summary.releaseAverageTimingJitterScale === "number"
                    ? Number(clamp((1 - summary.releaseAverageTimingJitterScale) / 0.2, 0, 1).toFixed(4))
                    : undefined,
                weight: 1,
            },
        ])
        : undefined;
    const recoveryFit = (summary.cadenceRecoveryMeasureCount ?? 0) > 0
        ? weightedAverage([
            { value: computeScalarFit(0.98, summary.cadenceRecoveryAverageDurationScale, 0.08), weight: 2 },
            { value: computeScalarFit(0.94, summary.cadenceRecoveryAverageTimingJitterScale, 0.14), weight: 2 },
            { value: computeScalarFit(1.02, summary.cadenceRecoveryAverageEndingStretchScale, 0.18), weight: 1 },
        ])
        : undefined;
    const rubatoFit = (summary.rubatoAnchorCount ?? 0) > 0
        ? weightedAverage([
            {
                value: typeof summary.rubatoAnchorAverageDurationScale === "number"
                    ? Number(clamp((summary.rubatoAnchorAverageDurationScale - 1) / 0.08, 0, 1).toFixed(4))
                    : undefined,
                weight: 2,
            },
            {
                value: typeof summary.rubatoAnchorAverageTimingJitterScale === "number"
                    ? Number(clamp((1 - summary.rubatoAnchorAverageTimingJitterScale) / 0.18, 0, 1).toFixed(4))
                    : undefined,
                weight: 2,
            },
            {
                value: typeof summary.rubatoAnchorAverageEndingStretchScale === "number"
                    ? Number(clamp((summary.rubatoAnchorAverageEndingStretchScale - 1) / 0.16, 0, 1).toFixed(4))
                    : undefined,
                weight: 1,
            },
        ])
        : undefined;
    const fit = weightedAverage([
        { value: coverageFit, weight: 4 },
        { value: pickupFit, weight: 2 },
        { value: arrivalFit, weight: 3 },
        { value: releaseFit, weight: 3 },
        { value: recoveryFit, weight: 1 },
        { value: rubatoFit, weight: 1 },
    ]);

    return {
        fit,
        coverageFit,
        pickupFit,
        arrivalFit,
        releaseFit,
        recoveryFit,
        rubatoFit,
    };
}

function tempoMotionTagDirection(tag: string | undefined): "broaden" | "press_forward" | "neutral" | undefined {
    const normalized = String(tag ?? "").trim().toLowerCase();
    if (["ritardando", "rallentando", "allargando", "ritenuto"].includes(normalized)) {
        return "broaden";
    }
    if (["accelerando", "stringendo"].includes(normalized)) {
        return "press_forward";
    }
    if (["a_tempo", "tempo_l_istesso"].includes(normalized)) {
        return "neutral";
    }

    return undefined;
}

function expectedTempoMotionDirection(
    summary: SectionArtifactSummary["tempoMotionSummary"] | undefined,
): "broaden" | "press_forward" | "neutral" | undefined {
    const directions = new Set(
        (summary?.requestedTags ?? [])
            .map((tag) => tempoMotionTagDirection(tag))
            .filter((direction): direction is "broaden" | "press_forward" | "neutral" => direction !== undefined),
    );

    return directions.size === 1
        ? [...directions][0]
        : undefined;
}

function computeTempoMotionPlanFit(
    summary: SectionArtifactSummary["tempoMotionSummary"] | undefined,
): {
    fit?: number;
    coverageFit?: number;
    densityFit?: number;
    magnitudeFit?: number;
    directionFit?: number;
} {
    if (!summary?.requestedTags?.length || summary.targetedMeasureCount <= 0) {
        return {};
    }

    const coverageFit = Number(clamp(summary.realizedMeasureCount / Math.max(summary.targetedMeasureCount, 1), 0, 1).toFixed(4));
    const densityFit = Number(clamp(summary.realizedNoteCount / Math.max(summary.targetedMeasureCount * 2.5, 1), 0, 1).toFixed(4));
    const expectedDirection = expectedTempoMotionDirection(summary);
    const magnitudeFit = typeof summary.peakDurationScaleDelta === "number"
        ? Number((expectedDirection === "neutral"
            ? 1 - clamp(summary.peakDurationScaleDelta / 0.08, 0, 1)
            : clamp(summary.peakDurationScaleDelta / 0.06, 0, 1)).toFixed(4))
        : undefined;
    const directionFit = expectedDirection && summary.motionDirection
        ? Number(expectedDirection === summary.motionDirection ? 1 : 0)
        : undefined;
    const fit = expectedDirection === "neutral"
        ? weightedAverage([
            { value: coverageFit, weight: 5 },
            { value: densityFit, weight: 2 },
            { value: magnitudeFit, weight: 3 },
        ])
        : weightedAverage([
            { value: coverageFit, weight: 4 },
            { value: densityFit, weight: 2 },
            { value: magnitudeFit, weight: 3 },
            { value: directionFit, weight: 1 },
        ]);

    return {
        fit,
        coverageFit,
        densityFit,
        magnitudeFit,
        directionFit,
    };
}

function computeOrnamentPlanFit(
    summary: SectionArtifactSummary["ornamentSummary"] | undefined,
): {
    fit?: number;
    coverageFit?: number;
    holdFit?: number;
    arpeggioFit?: number;
    graceFit?: number;
    trillFit?: number;
} {
    if (!summary?.explicitlyRealizedTags?.length || summary.targetedEventCount <= 0) {
        return {};
    }

    const explicitlyRealizedTags = summary.explicitlyRealizedTags.filter(Boolean);
    const hasHoldCue = explicitlyRealizedTags.includes("fermata");
    const hasArpeggioCue = explicitlyRealizedTags.includes("arpeggio");
    const hasGraceCue = explicitlyRealizedTags.includes("grace_note");
    const hasTrillCue = explicitlyRealizedTags.includes("trill");
    const coverageFit = Number(clamp(summary.realizedEventCount / Math.max(summary.targetedEventCount, 1), 0, 1).toFixed(4));
    const durationFit = typeof summary.averageDurationScale === "number"
        ? Number(clamp((summary.averageDurationScale - 1) / 0.16, 0, 1).toFixed(4))
        : undefined;
    const endingFit = typeof summary.averageEndingStretchScale === "number"
        ? Number(clamp((summary.averageEndingStretchScale - 1) / 0.22, 0, 1).toFixed(4))
        : undefined;
    const stabilityFit = typeof summary.averageTimingJitterScale === "number"
        ? Number(clamp((1 - summary.averageTimingJitterScale) / 0.16, 0, 1).toFixed(4))
        : undefined;
    const holdFit = weightedAverage([
        { value: durationFit, weight: 2 },
        { value: endingFit, weight: 3 },
        { value: stabilityFit, weight: 1 },
    ]);
    const arpeggioSpreadFit = typeof summary.averageOnsetSpreadBeats === "number"
        ? Number(clamp(summary.averageOnsetSpreadBeats / 0.18, 0, 1).toFixed(4))
        : undefined;
    const arpeggioPeakFit = typeof summary.peakOnsetSpreadBeats === "number"
        ? Number(clamp(summary.peakOnsetSpreadBeats / 0.22, 0, 1).toFixed(4))
        : undefined;
    const arpeggioFit = hasArpeggioCue
        ? weightedAverage([
            { value: arpeggioSpreadFit, weight: 3 },
            { value: arpeggioPeakFit, weight: 1 },
        ])
        : undefined;
    const graceLeadFit = typeof summary.averageGraceLeadInBeats === "number"
        ? Number(clamp(summary.averageGraceLeadInBeats / 0.12, 0, 1).toFixed(4))
        : undefined;
    const gracePeakFit = typeof summary.peakGraceLeadInBeats === "number"
        ? Number(clamp(summary.peakGraceLeadInBeats / 0.14, 0, 1).toFixed(4))
        : undefined;
    const graceFit = hasGraceCue
        ? weightedAverage([
            { value: graceLeadFit, weight: 3 },
            { value: gracePeakFit, weight: 1 },
        ])
        : undefined;
    const trillOscillationFit = typeof summary.averageTrillOscillationCount === "number"
        ? Number(clamp(summary.averageTrillOscillationCount / 5, 0, 1).toFixed(4))
        : undefined;
    const trillPeakOscillationFit = typeof summary.peakTrillOscillationCount === "number"
        ? Number(clamp(summary.peakTrillOscillationCount / 6, 0, 1).toFixed(4))
        : undefined;
    const trillSpanFit = typeof summary.averageTrillSpanBeats === "number"
        ? Number(clamp(summary.averageTrillSpanBeats / 0.72, 0, 1).toFixed(4))
        : undefined;
    const trillPeakSpanFit = typeof summary.peakTrillSpanBeats === "number"
        ? Number(clamp(summary.peakTrillSpanBeats / 0.84, 0, 1).toFixed(4))
        : undefined;
    const trillFit = hasTrillCue
        ? weightedAverage([
            { value: trillOscillationFit, weight: 3 },
            { value: trillPeakOscillationFit, weight: 1 },
            { value: trillSpanFit, weight: 2 },
            { value: trillPeakSpanFit, weight: 1 },
        ])
        : undefined;
    const fit = weightedAverage([
        { value: coverageFit, weight: 4 },
        { value: hasHoldCue ? holdFit : undefined, weight: 3 },
        { value: arpeggioFit, weight: 3 },
        { value: graceFit, weight: 3 },
        { value: trillFit, weight: 3 },
    ]);

    return {
        fit,
        coverageFit,
        holdFit: hasHoldCue ? holdFit : undefined,
        arpeggioFit,
        graceFit,
        trillFit,
    };
}

function computeHarmonicRealizationPlanFit(
    summary: SectionArtifactSummary["harmonicRealizationSummary"] | undefined,
): {
    fit?: number;
    coverageFit?: number;
    densityFit?: number;
    prolongationFit?: number;
    tonicizationFit?: number;
    harmonicColorFit?: number;
} {
    if (!summary || summary.targetedMeasureCount <= 0) {
        return {};
    }

    const coverageFit = Number(clamp(summary.realizedMeasureCount / Math.max(summary.targetedMeasureCount, 1), 0, 1).toFixed(4));
    const densityFit = Number(clamp(summary.realizedNoteCount / Math.max(summary.targetedMeasureCount * 2.5, 1), 0, 1).toFixed(4));
    const prolongationFit = (summary.prolongationMeasureCount ?? 0) > 0
        ? weightedAverage([
            { value: computeScalarFit(1.05, summary.prolongationAverageDurationScale, 0.08), weight: 2 },
            { value: computeScalarFit(0.94, summary.prolongationAverageTimingJitterScale, 0.16), weight: 1 },
            { value: computeScalarFit(1.08, summary.prolongationAverageEndingStretchScale, 0.14), weight: 3 },
        ])
        : undefined;
    const tonicizationFit = (summary.tonicizationMeasureCount ?? 0) > 0
        ? weightedAverage([
            { value: computeScalarFit(1.08, summary.tonicizationAverageDurationScale, 0.1), weight: 2 },
            { value: computeScalarFit(0.88, summary.tonicizationAverageTimingJitterScale, 0.18), weight: 1 },
            { value: computeScalarFit(1.12, summary.tonicizationAverageEndingStretchScale, 0.16), weight: 3 },
        ])
        : undefined;
    const harmonicColorFit = (summary.harmonicColorMeasureCount ?? 0) > 0
        ? weightedAverage([
            { value: computeScalarFit(1.07, summary.harmonicColorAverageDurationScale, 0.1), weight: 2 },
            { value: computeScalarFit(0.9, summary.harmonicColorAverageTimingJitterScale, 0.18), weight: 1 },
            { value: computeScalarFit(1.12, summary.harmonicColorAverageEndingStretchScale, 0.16), weight: 3 },
        ])
        : undefined;
    const fit = weightedAverage([
        { value: coverageFit, weight: 4 },
        { value: densityFit, weight: 2 },
        { value: prolongationFit, weight: 2 },
        { value: tonicizationFit, weight: 3 },
        { value: harmonicColorFit, weight: 3 },
    ]);

    return {
        fit,
        coverageFit,
        densityFit,
        prolongationFit,
        tonicizationFit,
        harmonicColorFit,
    };
}


function formatOrnamentEvidenceTag(tag: string | undefined): string | null {
    const normalized = String(tag ?? "").trim();
    if (!normalized) {
        return null;
    }

    return normalized.replace(/_/g, " ");
}

function hasExplicitOrnamentTag(tags: string[], target: string): boolean {
    return tags.includes(target);
}

function resolvePlannedCadence(section: SectionPlan | undefined): SectionPlan["cadence"] | undefined {
    return section?.harmonicPlan?.cadence ?? section?.cadence;
}

function isCadenceFocusedRole(role: SectionPlan["role"] | undefined): boolean {
    return role === "cadence" || role === "recap" || role === "outro";
}

function computeRegisterCenterFit(
    section: SectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
): { fit?: number; drift?: number } {
    const planned = typeof section?.registerCenter === "number"
        ? section.registerCenter
        : undefined;
    const realized = typeof artifact?.realizedRegisterCenter === "number"
        ? artifact.realizedRegisterCenter
        : undefined;

    if (planned === undefined || realized === undefined) {
        return {};
    }

    const drift = Math.abs(realized - planned);
    return {
        drift,
        fit: Number(clamp(1 - (drift / 18), 0, 1).toFixed(4)),
    };
}

function expectedCadenceApproaches(
    cadence: SectionPlan["cadence"] | undefined,
    role: SectionPlan["role"] | undefined,
): Array<NonNullable<SectionArtifactSummary["cadenceApproach"]>> {
    if (cadence === "authentic" || cadence === "half" || cadence === "deceptive") {
        return ["dominant"];
    }
    if (cadence === "plagal") {
        return ["plagal"];
    }
    if (isCadenceFocusedRole(role)) {
        return ["dominant", "plagal", "tonic"];
    }

    return [];
}

function computeCadenceApproachFit(
    section: SectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
): number | undefined {
    const cadenceApproach = artifact?.cadenceApproach;
    if (!cadenceApproach) {
        return undefined;
    }

    const cadence = resolvePlannedCadence(section);
    const expected = expectedCadenceApproaches(cadence, section?.role);
    if (expected.length === 0) {
        return undefined;
    }

    if (expected.includes(cadenceApproach)) {
        return 1;
    }
    if (cadenceApproach === "tonic") {
        return cadence === "plagal" ? 0.45 : 0.35;
    }
    if (cadenceApproach === "other") {
        return 0.1;
    }

    return 0.2;
}

function soundingEvents(events: SectionRenderEvent[] | undefined): SectionRenderEvent[] {
    return (events ?? []).filter((event) => event.type === "note" || event.type === "chord");
}

function totalEventDuration(events: SectionRenderEvent[] | undefined): number {
    return (events ?? []).reduce((sum, event) => sum + Math.max(Number(event.quarterLength) || 0, 0), 0);
}

function totalRestDuration(events: SectionRenderEvent[] | undefined): number {
    return (events ?? []).reduce((sum, event) => (
        event.type === "rest"
            ? sum + Math.max(Number(event.quarterLength) || 0, 0)
            : sum
    ), 0);
}

function averageSoundingDuration(events: SectionRenderEvent[] | undefined): number | undefined {
    return average(soundingEvents(events).map((event) => Number(Math.max(event.quarterLength, 0).toFixed(4))));
}

function lastSoundingDuration(events: SectionRenderEvent[] | undefined): number | undefined {
    for (let index = (events?.length ?? 0) - 1; index >= 0; index -= 1) {
        const event = events?.[index];
        if (event?.type === "note" || event?.type === "chord") {
            return Number(Math.max(event.quarterLength, 0).toFixed(4));
        }
    }

    return undefined;
}

function uniquePitchClassCount(events: SectionRenderEvent[] | undefined): number {
    const pitchClasses = new Set<number>();
    for (const event of soundingEvents(events)) {
        if (typeof event.pitch === "number") {
            pitchClasses.add(((Math.trunc(event.pitch) % 12) + 12) % 12);
        }
        for (const pitch of event.pitches ?? []) {
            if (typeof pitch === "number") {
                pitchClasses.add(((Math.trunc(pitch) % 12) + 12) % 12);
            }
        }
    }

    return pitchClasses.size;
}

function inferredPhraseFunction(section: SectionPlan | undefined): PhraseFunction | undefined {
    if (section?.phraseFunction) {
        return section.phraseFunction;
    }

    if (section?.role === "theme_a" || section?.role === "intro") {
        return "presentation";
    }
    if (section?.role === "theme_b" || section?.role === "bridge") {
        return "transition";
    }
    if (section?.role === "development" || section?.role === "variation") {
        return "developmental";
    }
    if (section?.role === "recap" || section?.role === "cadence" || section?.role === "outro") {
        return "cadential";
    }

    return undefined;
}

function phrasePressureBias(phraseFunction: PhraseFunction | undefined): number | undefined {
    if (!phraseFunction) {
        return undefined;
    }

    if (phraseFunction === "presentation") {
        return 0.44;
    }
    if (phraseFunction === "continuation") {
        return 0.68;
    }
    if (phraseFunction === "transition") {
        return 0.74;
    }
    if (phraseFunction === "developmental") {
        return 0.78;
    }

    return 0.5;
}

function computePhraseClosureFit(
    phraseFunction: PhraseFunction | undefined,
    closureRatio: number | undefined,
): number | undefined {
    if (!phraseFunction || closureRatio === undefined) {
        return undefined;
    }

    if (phraseFunction === "cadential") {
        return Number(clamp((closureRatio - 1) / 1.2, 0, 1).toFixed(4));
    }

    if (phraseFunction === "continuation" || phraseFunction === "transition" || phraseFunction === "developmental") {
        return Number((1 - clamp(Math.max(0, closureRatio - 1.35) / 1.35, 0, 1)).toFixed(4));
    }

    return Number((1 - clamp(Math.abs(closureRatio - 1.3) / 0.9, 0, 1)).toFixed(4));
}

function computePhrasePressureMetrics(
    section: SectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
): {
    actualPressure?: number;
    targetPressure?: number;
    phraseClosureFit?: number;
    phrasePressureFit?: number;
} {
    const phraseFunction = inferredPhraseFunction(section);
    const measures = Math.max(section?.measures ?? artifact?.measureCount ?? 0, 1);
    const melodyEvents = artifact?.melodyEvents;
    const accompanimentEvents = artifact?.accompanimentEvents;
    const melodyDuration = totalEventDuration(melodyEvents);
    const restRatio = melodyDuration > 0
        ? Number((totalRestDuration(melodyEvents) / melodyDuration).toFixed(4))
        : undefined;
    const melodyActivity = soundingEvents(melodyEvents).length / measures;
    const accompanimentActivity = soundingEvents(accompanimentEvents).length / measures;
    const accompanimentVariety = uniquePitchClassCount(accompanimentEvents);
    const actualPressure = weightedAverage([
        { value: Number(clamp(melodyActivity / 3.2, 0, 1).toFixed(4)), weight: 3 },
        { value: Number(clamp(accompanimentActivity / 4.5, 0, 1).toFixed(4)), weight: 2 },
        { value: restRatio !== undefined ? Number((1 - restRatio).toFixed(4)) : undefined, weight: 2 },
        { value: Number(clamp(accompanimentVariety / 5, 0, 1).toFixed(4)), weight: 1 },
    ]);
    const targetPressure = weightedAverage([
        { value: section?.energy, weight: 2 },
        { value: section?.density, weight: 2 },
        { value: section?.harmonicPlan?.tensionTarget, weight: 2 },
        { value: phrasePressureBias(phraseFunction), weight: 2 },
    ]);
    const averageDuration = averageSoundingDuration(melodyEvents);
    const closureDuration = lastSoundingDuration(melodyEvents);
    const closureRatio = averageDuration && closureDuration
        ? Number((closureDuration / Math.max(averageDuration, 0.25)).toFixed(4))
        : undefined;
    const phraseClosureFit = computePhraseClosureFit(phraseFunction, closureRatio);
    const pressureLevelFit = actualPressure !== undefined && targetPressure !== undefined
        ? Number((1 - clamp(Math.abs(actualPressure - targetPressure) / 0.55, 0, 1)).toFixed(4))
        : undefined;

    return {
        actualPressure,
        targetPressure,
        phraseClosureFit,
        phrasePressureFit: weightedAverage([
            { value: pressureLevelFit, weight: 4 },
            { value: phraseClosureFit, weight: 2 },
        ]),
    };
}

function harmonicMotionScore(profile: SectionArtifactSummary["bassMotionProfile"] | undefined): number | undefined {
    if (profile === "pedal") {
        return 0.12;
    }
    if (profile === "stepwise") {
        return 0.48;
    }
    if (profile === "mixed") {
        return 0.72;
    }
    if (profile === "leaping") {
        return 0.86;
    }

    return undefined;
}

function harmonicRhythmPressure(harmonicRhythm: HarmonicPlan["harmonicRhythm"] | undefined): number {
    if (harmonicRhythm === "fast") {
        return 0.84;
    }
    if (harmonicRhythm === "medium") {
        return 0.68;
    }

    return 0.56;
}

function harmonicRhythmFloor(harmonicRhythm: HarmonicPlan["harmonicRhythm"] | undefined): number {
    if (harmonicRhythm === "fast") {
        return 0.56;
    }
    if (harmonicRhythm === "medium") {
        return 0.42;
    }

    return 0.3;
}

function normalizeTonalityLabel(value: string | undefined): string {
    return String(value ?? "").trim().toLowerCase();
}

function expectsTonicizationPressure(section: SectionPlan | undefined): boolean {
    const tonalCenter = normalizeTonalityLabel(section?.harmonicPlan?.tonalCenter);
    const keyTarget = normalizeTonalityLabel(section?.harmonicPlan?.keyTarget);
    const highTension = (section?.harmonicPlan?.tensionTarget ?? section?.energy ?? 0) >= 0.68;
    const denseSection = (section?.density ?? 0) >= 0.48;

    return Boolean(
        section?.harmonicPlan?.allowModulation
        || (keyTarget && keyTarget !== tonalCenter)
        || section?.harmonicPlan?.modulationPath?.length
        || section?.role === "theme_b"
        || section?.role === "development"
        || section?.role === "bridge"
        || section?.role === "variation"
        || section?.phraseFunction === "transition"
        || section?.phraseFunction === "developmental"
        || (highTension && denseSection)
    );
}

function computeActualHarmonicMotion(
    section: SectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
): number | undefined {
    const measures = Math.max(section?.measures ?? artifact?.measureCount ?? 0, 1);
    const accompanimentActivity = soundingEvents(artifact?.accompanimentEvents).length / measures;
    const accompanimentVariety = uniquePitchClassCount(artifact?.accompanimentEvents);

    return weightedAverage([
        { value: Number(clamp(accompanimentActivity / 5, 0, 1).toFixed(4)), weight: 3 },
        { value: Number(clamp(accompanimentVariety / 5, 0, 1).toFixed(4)), weight: 2 },
        { value: harmonicMotionScore(artifact?.bassMotionProfile), weight: 3 },
    ]);
}

function computeHarmonicRoleMotionMetrics(
    section: SectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
): {
    actualHarmonicMotion?: number;
    tonicizationTargetMotion?: number;
    tonicizationPressureFit?: number;
    prolongationFloorMotion?: number;
    prolongationMotionFit?: number;
    harmonicRoleMotionFit?: number;
} {
    const actualHarmonicMotion = computeActualHarmonicMotion(section, artifact);
    if (actualHarmonicMotion === undefined) {
        return {};
    }

    if (expectsTonicizationPressure(section)) {
        const tonicizationTargetMotion = weightedAverage([
            { value: harmonicRhythmPressure(section?.harmonicPlan?.harmonicRhythm), weight: 2 },
            { value: section?.harmonicPlan?.tensionTarget ?? section?.energy ?? section?.density, weight: 2 },
            { value: 0.92, weight: 3 },
        ]);
        const tonicizationPressureFit = tonicizationTargetMotion !== undefined
            ? Number((1 - clamp(Math.abs(actualHarmonicMotion - tonicizationTargetMotion) / 0.55, 0, 1)).toFixed(4))
            : undefined;

        return {
            actualHarmonicMotion,
            tonicizationTargetMotion,
            tonicizationPressureFit,
            harmonicRoleMotionFit: tonicizationPressureFit,
        };
    }

    const measures = section?.measures ?? artifact?.measureCount ?? 0;
    if (measures < 4) {
        return {
            actualHarmonicMotion,
        };
    }

    const prolongationFloorMotion = weightedAverage([
        { value: harmonicRhythmFloor(section?.harmonicPlan?.harmonicRhythm), weight: 2 },
        { value: clamp(0.18 + ((section?.harmonicPlan?.tensionTarget ?? section?.energy ?? section?.density ?? 0.3) * 0.35), 0.18, 0.55), weight: 1 },
        { value: measures >= 6 ? 0.36 : 0.28, weight: 1 },
    ]);
    const prolongationMotionFit = prolongationFloorMotion !== undefined && prolongationFloorMotion > 0
        ? Number(clamp(actualHarmonicMotion / prolongationFloorMotion, 0, 1).toFixed(4))
        : undefined;

    return {
        actualHarmonicMotion,
        prolongationFloorMotion,
        prolongationMotionFit,
        harmonicRoleMotionFit: prolongationMotionFit,
    };
}

function normalizeHarmonicColorTag(tag: string | undefined): string {
    return String(tag ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function computeMeasureAlignmentFit(
    planned: number | undefined,
    realized: number | undefined,
    tolerance = 1,
): number | undefined {
    if (planned === undefined) {
        return undefined;
    }

    if (realized === undefined) {
        return 0;
    }

    return Number((1 - clamp(Math.abs(planned - realized) / Math.max(tolerance, 1), 0, 1)).toFixed(4));
}

function computeHarmonicColorPlanMetrics(
    section: SectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
): {
    coverageFit?: number;
    timingFit?: number;
    targetFit?: number;
    planFit?: number;
} {
    const plannedCues = section?.harmonicPlan?.colorCues ?? [];
    if (plannedCues.length === 0) {
        return {};
    }

    const remainingRealizedCues = [...(artifact?.harmonicColorCues ?? [])];
    const coverageValues: number[] = [];
    const timingValues: number[] = [];
    const targetValues: number[] = [];

    for (const plannedCue of plannedCues) {
        const plannedTag = normalizeHarmonicColorTag(plannedCue.tag);
        const realizedIndex = remainingRealizedCues.findIndex((cue) => normalizeHarmonicColorTag(cue.tag) === plannedTag);
        const needsTimingCheck = plannedCue.startMeasure !== undefined
            || plannedCue.endMeasure !== undefined
            || plannedCue.resolutionMeasure !== undefined;
        const needsTargetCheck = Boolean(plannedCue.keyTarget) || plannedCue.resolutionMeasure !== undefined;

        if (realizedIndex < 0) {
            coverageValues.push(0);
            if (needsTimingCheck) {
                timingValues.push(0);
            }
            if (needsTargetCheck) {
                targetValues.push(0);
            }
            continue;
        }

        const realizedCue = remainingRealizedCues.splice(realizedIndex, 1)[0];
        coverageValues.push(1);

        const timingFit = needsTimingCheck
            ? weightedAverage([
                { value: computeMeasureAlignmentFit(plannedCue.startMeasure, realizedCue.startMeasure), weight: 2 },
                { value: computeMeasureAlignmentFit(plannedCue.endMeasure, realizedCue.endMeasure), weight: 2 },
                { value: computeMeasureAlignmentFit(plannedCue.resolutionMeasure, realizedCue.resolutionMeasure), weight: 3 },
            ])
            : undefined;
        if (timingFit !== undefined) {
            timingValues.push(timingFit);
        }

        const targetFit = needsTargetCheck
            ? weightedAverage([
                {
                    value: plannedCue.keyTarget
                        ? Number(normalizeTonalityLabel(plannedCue.keyTarget) === normalizeTonalityLabel(realizedCue.keyTarget) ? 1 : 0)
                        : undefined,
                    weight: 3,
                },
                {
                    value: plannedCue.resolutionMeasure !== undefined
                        ? computeMeasureAlignmentFit(plannedCue.resolutionMeasure, realizedCue.resolutionMeasure)
                        : undefined,
                    weight: 2,
                },
            ])
            : undefined;
        if (targetFit !== undefined) {
            targetValues.push(targetFit);
        }
    }

    const coverageFit = average(coverageValues);
    const timingFit = average(timingValues);
    const targetFit = average(targetValues);
    const planFit = weightedAverage([
        { value: coverageFit, weight: 5 },
        { value: timingFit, weight: 3 },
        { value: targetFit, weight: 2 },
    ]);

    return {
        coverageFit,
        timingFit,
        targetFit,
        planFit,
    };
}

function normalizeInstrumentKey(value: string | undefined): string {
    return String(value ?? "").trim().toLowerCase();
}

function extractMelodyPitches(events: SectionArtifactSummary["melodyEvents"] | undefined): number[] {
    const pitches: number[] = [];
    for (const event of events ?? []) {
        pitches.push(...eventPitches(event));
    }
    return pitches;
}

function orchestrationSectionPlanFor(
    orchestration: OrchestrationPlan | undefined,
    sectionId: string | undefined,
): OrchestrationSectionPlan | undefined {
    if (!orchestration || !sectionId) {
        return undefined;
    }

    return orchestration.sections.find((section) => section.sectionId === sectionId);
}

function computeInstrumentRangeFit(instrumentName: string, pitches: number[]): number | undefined {
    if (pitches.length === 0) {
        return undefined;
    }

    const range = STRING_TRIO_IDIOMATIC_RANGES[normalizeInstrumentKey(instrumentName)];
    if (!range) {
        return undefined;
    }

    const minimum = Math.min(...pitches);
    const maximum = Math.max(...pitches);
    const deviation = Math.max(Math.max(range.min - minimum, 0), Math.max(maximum - range.max, 0));
    return Number((1 - clamp(deviation / 12, 0, 1)).toFixed(4));
}

function computeStringTrioRangeFit(
    orchestrationSection: OrchestrationSectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
): number | undefined {
    if (!orchestrationSection || !artifact) {
        return undefined;
    }

    const leadPitches = extractMelodyPitches(artifact.melodyEvents);
    const secondaryPitches = extractTaggedVoicePitches(artifact.accompanimentEvents, SECONDARY_VOICE_ROLES);
    const bassPitches = extractTaggedVoicePitches(artifact.accompanimentEvents, new Set<TaggedSecondaryVoiceRole>(["bass"]));

    return weightedAverage([
        { value: computeInstrumentRangeFit(orchestrationSection.leadInstrument, leadPitches), weight: 3 },
        { value: computeInstrumentRangeFit(orchestrationSection.secondaryInstrument, secondaryPitches), weight: 2 },
        { value: computeInstrumentRangeFit(orchestrationSection.bassInstrument, bassPitches), weight: 3 },
    ]);
}

function averagePitch(values: number[]): number | undefined {
    if (values.length === 0) {
        return undefined;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeStringTrioBalanceFit(
    orchestrationSection: OrchestrationSectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
): number | undefined {
    if (!orchestrationSection || !artifact) {
        return undefined;
    }

    const leadCenter = averagePitch(extractMelodyPitches(artifact.melodyEvents));
    const secondaryCenter = averagePitch(extractTaggedVoicePitches(artifact.accompanimentEvents, SECONDARY_VOICE_ROLES));
    const bassCenter = averagePitch(extractTaggedVoicePitches(artifact.accompanimentEvents, new Set<TaggedSecondaryVoiceRole>(["bass"])));
    if (leadCenter === undefined || secondaryCenter === undefined || bassCenter === undefined) {
        return undefined;
    }

    const baseLeadGap = orchestrationSection.registerLayout === "wide" ? 8 : 5;
    const baseBassGap = orchestrationSection.registerLayout === "wide" ? 9 : 6;
    const leadGapTarget = orchestrationSection.balanceProfile === "lead_forward" ? baseLeadGap + 2 : baseLeadGap;
    const bassGapTarget = orchestrationSection.balanceProfile === "lead_forward" ? baseBassGap + 1 : baseBassGap;
    const leadGapFit = clamp((leadCenter - secondaryCenter) / leadGapTarget, 0, 1);
    const bassGapFit = clamp((secondaryCenter - bassCenter) / bassGapTarget, 0, 1);

    return Number((weightedAverage([
        { value: leadGapFit, weight: 3 },
        { value: bassGapFit, weight: 3 },
    ]) ?? 0).toFixed(4));
}

function computeStringTrioConversationFit(
    orchestrationSection: OrchestrationSectionPlan | undefined,
    texturePlanFit: number | undefined,
    textureIndependenceFit: number | undefined,
    counterpointBehaviorFit: number | undefined,
    imitationFit: number | undefined,
): number | undefined {
    if (!orchestrationSection || orchestrationSection.conversationMode !== "conversational") {
        return undefined;
    }

    const fit = weightedAverage([
        { value: textureIndependenceFit, weight: 4 },
        { value: counterpointBehaviorFit, weight: 4 },
        { value: imitationFit, weight: 2 },
        { value: texturePlanFit, weight: 1 },
    ]);
    return fit === undefined ? undefined : Number(fit.toFixed(4));
}

function pitchClass(value: number): number {
    return ((Math.trunc(value) % 12) + 12) % 12;
}

function computePitchClassDoublingRate(primary: number[], secondary: number[]): number | undefined {
    if (primary.length === 0 || secondary.length === 0) {
        return undefined;
    }

    const sampleLength = Math.max(2, Math.max(primary.length, secondary.length));
    const primarySample = resamplePitchHistory(primary, sampleLength);
    const secondarySample = resamplePitchHistory(secondary, sampleLength);
    const doubledCount = primarySample.reduce((sum, value, index) => (
        pitchClass(value) === pitchClass(secondarySample[index])
            ? sum + 1
            : sum
    ), 0);

    return Number((doubledCount / sampleLength).toFixed(4));
}

function computeDoublingPressureFit(actualRate: number | undefined, ceilingRate: number): number | undefined {
    if (actualRate === undefined) {
        return undefined;
    }

    if (actualRate <= ceilingRate) {
        return 1;
    }

    return Number(clamp(1 - ((actualRate - ceilingRate) / Math.max(1 - ceilingRate, 0.01)), 0, 1).toFixed(4));
}

function computeStringTrioDoublingFit(
    orchestrationSection: OrchestrationSectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
): number | undefined {
    if (!orchestrationSection || !artifact) {
        return undefined;
    }

    const leadPitches = extractMelodyPitches(artifact.melodyEvents);
    if (leadPitches.length === 0) {
        return undefined;
    }

    const secondaryPitches = extractTaggedVoicePitches(artifact.accompanimentEvents, SECONDARY_VOICE_ROLES);
    const bassPitches = extractTaggedVoicePitches(artifact.accompanimentEvents, new Set<TaggedSecondaryVoiceRole>(["bass"]));
    const secondaryCeiling = orchestrationSection.conversationMode === "conversational"
        ? 0.22
        : orchestrationSection.balanceProfile === "lead_forward"
            ? 0.46
            : 0.36;
    const bassCeiling = orchestrationSection.registerLayout === "wide" ? 0.18 : 0.26;
    const fit = weightedAverage([
        {
            value: computeDoublingPressureFit(computePitchClassDoublingRate(leadPitches, secondaryPitches), secondaryCeiling),
            weight: 4,
        },
        {
            value: computeDoublingPressureFit(computePitchClassDoublingRate(leadPitches, bassPitches), bassCeiling),
            weight: 2,
        },
    ]);

    return fit === undefined ? undefined : Number(fit.toFixed(4));
}

function nominalStringTrioInstrumentCenter(instrumentName: string): number | undefined {
    const range = STRING_TRIO_IDIOMATIC_RANGES[normalizeInstrumentKey(instrumentName)];
    if (!range) {
        return undefined;
    }

    return (range.min + range.max) / 2;
}

function resolvedOrchestrationConversationMode(
    section: OrchestrationSectionPlan | undefined,
): OrchestrationConversationMode {
    return section?.conversationMode ?? "support";
}

function resolvedOrchestrationBalanceProfile(
    section: OrchestrationSectionPlan | undefined,
): OrchestrationBalanceProfile {
    return section?.balanceProfile ?? "balanced";
}

function resolvedOrchestrationRegisterLayout(
    section: OrchestrationSectionPlan | undefined,
): OrchestrationRegisterLayout {
    return section?.registerLayout ?? "layered";
}

function collectStringTrioRoleCenters(
    artifact: SectionArtifactSummary | undefined,
): { lead?: number; secondary?: number; bass?: number } {
    return {
        lead: averagePitch(extractMelodyPitches(artifact?.melodyEvents)),
        secondary: averagePitch(extractTaggedVoicePitches(artifact?.accompanimentEvents, SECONDARY_VOICE_ROLES)),
        bass: averagePitch(extractTaggedVoicePitches(artifact?.accompanimentEvents, new Set<TaggedSecondaryVoiceRole>(["bass"]))),
    };
}

function computeDirectionalShiftFit(
    previousValue: number | undefined,
    currentValue: number | undefined,
    expectedDirection: 1 | -1,
    targetMagnitude: number,
): number | undefined {
    if (previousValue === undefined || currentValue === undefined) {
        return undefined;
    }

    const actualDelta = currentValue - previousValue;
    return Number(clamp((expectedDirection * actualDelta) / Math.max(targetMagnitude, 0.01), 0, 1).toFixed(4));
}

function computeStringTrioConversationRotationFit(
    previousSection: OrchestrationSectionPlan | undefined,
    currentSection: OrchestrationSectionPlan | undefined,
    currentFinding: StructureSectionFinding,
): number | undefined {
    const previousMode = resolvedOrchestrationConversationMode(previousSection);
    const currentMode = resolvedOrchestrationConversationMode(currentSection);
    if (previousMode === currentMode) {
        return undefined;
    }

    const fit = currentMode === "conversational"
        ? weightedAverage([
            { value: currentFinding.metrics.orchestrationConversationFit, weight: 4 },
            { value: currentFinding.metrics.textureIndependenceFit, weight: 2 },
            { value: currentFinding.metrics.counterpointBehaviorFit, weight: 2 },
        ])
        : weightedAverage([
            { value: currentFinding.metrics.orchestrationDoublingFit, weight: 3 },
            { value: currentFinding.metrics.orchestrationBalanceFit, weight: 3 },
            { value: currentFinding.metrics.texturePlanFit, weight: 1 },
        ]);

    return fit === undefined ? undefined : Number(fit.toFixed(4));
}

function computeStringTrioBalanceRotationFit(
    previousSection: OrchestrationSectionPlan | undefined,
    currentSection: OrchestrationSectionPlan | undefined,
    previousArtifact: SectionArtifactSummary | undefined,
    currentArtifact: SectionArtifactSummary | undefined,
): number | undefined {
    const previousProfile = resolvedOrchestrationBalanceProfile(previousSection);
    const currentProfile = resolvedOrchestrationBalanceProfile(currentSection);
    if (previousProfile === currentProfile) {
        return undefined;
    }

    const previousCenters = collectStringTrioRoleCenters(previousArtifact);
    const currentCenters = collectStringTrioRoleCenters(currentArtifact);
    const previousLeadGap = previousCenters.lead !== undefined && previousCenters.secondary !== undefined
        ? previousCenters.lead - previousCenters.secondary
        : undefined;
    const currentLeadGap = currentCenters.lead !== undefined && currentCenters.secondary !== undefined
        ? currentCenters.lead - currentCenters.secondary
        : undefined;

    return computeDirectionalShiftFit(
        previousLeadGap,
        currentLeadGap,
        currentProfile === "lead_forward" ? 1 : -1,
        2.5,
    );
}

function computeStringTrioLayoutRotationFit(
    previousSection: OrchestrationSectionPlan | undefined,
    currentSection: OrchestrationSectionPlan | undefined,
    previousArtifact: SectionArtifactSummary | undefined,
    currentArtifact: SectionArtifactSummary | undefined,
): number | undefined {
    const previousLayout = resolvedOrchestrationRegisterLayout(previousSection);
    const currentLayout = resolvedOrchestrationRegisterLayout(currentSection);
    if (previousLayout === currentLayout) {
        return undefined;
    }

    const previousCenters = collectStringTrioRoleCenters(previousArtifact);
    const currentCenters = collectStringTrioRoleCenters(currentArtifact);
    const previousStackSpan = previousCenters.lead !== undefined && previousCenters.bass !== undefined
        ? previousCenters.lead - previousCenters.bass
        : undefined;
    const currentStackSpan = currentCenters.lead !== undefined && currentCenters.bass !== undefined
        ? currentCenters.lead - currentCenters.bass
        : undefined;

    return computeDirectionalShiftFit(
        previousStackSpan,
        currentStackSpan,
        currentLayout === "wide" ? 1 : -1,
        3.5,
    );
}

function computeStringTrioTextureRotationFit(
    previousSection: OrchestrationSectionPlan | undefined,
    currentSection: OrchestrationSectionPlan | undefined,
    previousArtifact: SectionArtifactSummary | undefined,
    currentArtifact: SectionArtifactSummary | undefined,
    currentFinding: StructureSectionFinding,
): number | undefined {
    if (!previousSection || !currentSection || !previousArtifact || !currentArtifact) {
        return undefined;
    }

    const fit = weightedAverage([
        {
            value: computeStringTrioConversationRotationFit(previousSection, currentSection, currentFinding),
            weight: 4,
        },
        {
            value: computeStringTrioBalanceRotationFit(previousSection, currentSection, previousArtifact, currentArtifact),
            weight: 3,
        },
        {
            value: computeStringTrioLayoutRotationFit(previousSection, currentSection, previousArtifact, currentArtifact),
            weight: 3,
        },
    ]);

    return fit === undefined ? undefined : Number(fit.toFixed(4));
}

function computeStringTrioRoleHandoffFit(
    previousInstrument: string,
    currentInstrument: string,
    previousCenter: number | undefined,
    currentCenter: number | undefined,
): number | undefined {
    if (normalizeInstrumentKey(previousInstrument) === normalizeInstrumentKey(currentInstrument)) {
        return undefined;
    }

    const previousNominalCenter = nominalStringTrioInstrumentCenter(previousInstrument);
    const currentNominalCenter = nominalStringTrioInstrumentCenter(currentInstrument);
    if (
        previousNominalCenter === undefined
        || currentNominalCenter === undefined
        || previousCenter === undefined
        || currentCenter === undefined
    ) {
        return undefined;
    }

    const expectedDelta = currentNominalCenter - previousNominalCenter;
    const actualDelta = currentCenter - previousCenter;
    const tolerance = Math.max(Math.abs(expectedDelta), 8) + 4;
    return Number(clamp(1 - (Math.abs(expectedDelta - actualDelta) / tolerance), 0, 1).toFixed(4));
}

function computeStringTrioHandoffFit(
    previousSection: OrchestrationSectionPlan | undefined,
    currentSection: OrchestrationSectionPlan | undefined,
    previousArtifact: SectionArtifactSummary | undefined,
    currentArtifact: SectionArtifactSummary | undefined,
): number | undefined {
    if (!previousSection || !currentSection || !previousArtifact || !currentArtifact) {
        return undefined;
    }

    const previousCenters = collectStringTrioRoleCenters(previousArtifact);
    const currentCenters = collectStringTrioRoleCenters(currentArtifact);
    const handoffFit = weightedAverage([
        {
            value: computeStringTrioRoleHandoffFit(
                previousSection.leadInstrument,
                currentSection.leadInstrument,
                previousCenters.lead,
                currentCenters.lead,
            ),
            weight: 4,
        },
        {
            value: computeStringTrioRoleHandoffFit(
                previousSection.secondaryInstrument,
                currentSection.secondaryInstrument,
                previousCenters.secondary,
                currentCenters.secondary,
            ),
            weight: 3,
        },
        {
            value: computeStringTrioRoleHandoffFit(
                previousSection.bassInstrument,
                currentSection.bassInstrument,
                previousCenters.bass,
                currentCenters.bass,
            ),
            weight: 3,
        },
    ]);

    return handoffFit === undefined ? undefined : Number(handoffFit.toFixed(4));
}

function applyStringTrioTransitionInsights(
    sectionFindings: NonNullable<StructureEvaluationReport["sectionFindings"]>,
    sections: SectionPlan[],
    sectionArtifacts: SectionArtifactSummary[],
    orchestration: OrchestrationPlan | undefined,
): NonNullable<StructureEvaluationReport["sectionFindings"]> {
    if (
        !orchestration
        || orchestration.family !== "string_trio"
        || sectionFindings.length === 0
        || sections.length < 2
        || sectionArtifacts.length === 0
    ) {
        return sectionFindings;
    }

    const updatedSectionFindings = sectionFindings.map((finding) => ({
        ...finding,
        issues: [...finding.issues],
        strengths: [...finding.strengths],
        metrics: { ...finding.metrics },
    }));
    const findingById = new Map(updatedSectionFindings.map((finding) => [finding.sectionId, finding]));
    const artifactById = new Map(sectionArtifacts.map((artifact) => [artifact.sectionId, artifact]));

    for (let index = 1; index < sections.length; index += 1) {
        const previousSectionId = sections[index - 1]?.id;
        const currentSectionId = sections[index]?.id;
        const previousFinding = previousSectionId ? findingById.get(previousSectionId) : undefined;
        const currentFinding = currentSectionId ? findingById.get(currentSectionId) : undefined;
        if (!previousSectionId || !currentSectionId || !previousFinding || !currentFinding) {
            continue;
        }

        const previousSectionPlan = orchestrationSectionPlanFor(orchestration, previousSectionId);
        const currentSectionPlan = orchestrationSectionPlanFor(orchestration, currentSectionId);
        const previousArtifact = artifactById.get(previousSectionId);
        const currentArtifact = artifactById.get(currentSectionId);

        const textureRotationFit = computeStringTrioTextureRotationFit(
            previousSectionPlan,
            currentSectionPlan,
            previousArtifact,
            currentArtifact,
            currentFinding,
        );
        if (textureRotationFit !== undefined) {
            currentFinding.metrics.orchestrationTextureRotationFit = textureRotationFit;
            currentFinding.score = Number(clamp(currentFinding.score - ((1 - textureRotationFit) * 5), 0, 100).toFixed(2));

            if (textureRotationFit < 0.58) {
                pushUnique(
                    currentFinding.issues,
                    "String-trio texture rotation does not reset conversation, balance, or spacing clearly enough from the previous section.",
                );
            } else if (textureRotationFit >= 0.82) {
                pushUnique(
                    currentFinding.strengths,
                    "String-trio texture rotation clearly resets the ensemble stance from the previous section.",
                );
            }
        }

        const handoffFit = computeStringTrioHandoffFit(
            previousSectionPlan,
            currentSectionPlan,
            previousArtifact,
            currentArtifact,
        );
        if (handoffFit === undefined) {
            continue;
        }

        currentFinding.metrics.orchestrationHandoffFit = handoffFit;
        currentFinding.score = Number(clamp(currentFinding.score - ((1 - handoffFit) * 6), 0, 100).toFixed(2));

        if (handoffFit < 0.58) {
            pushUnique(
                currentFinding.issues,
                "String-trio register handoff does not transfer lead, middle, and bass duties clearly enough from the previous section.",
            );
        } else if (handoffFit >= 0.82) {
            pushUnique(
                currentFinding.strengths,
                "String-trio register handoff clearly reassigns lead, middle, and bass duties across adjacent sections.",
            );
        }
    }

    return updatedSectionFindings;
}

function buildOrchestrationEvaluationSummary(
    orchestration: OrchestrationPlan | undefined,
    sectionFindings: NonNullable<StructureEvaluationReport["sectionFindings"]> | undefined,
): OrchestrationEvaluationSummary | undefined {
    if (!orchestration || !sectionFindings?.length) {
        return undefined;
    }

    const rangeFit = average(sectionFindings
        .map((finding) => finding.metrics.orchestrationRangeFit)
        .filter((value) => Number.isFinite(value) && value >= 0));
    const balanceFit = average(sectionFindings
        .map((finding) => finding.metrics.orchestrationBalanceFit)
        .filter((value) => Number.isFinite(value) && value >= 0));
    const conversationFit = average(sectionFindings
        .map((finding) => finding.metrics.orchestrationConversationFit)
        .filter((value) => Number.isFinite(value) && value >= 0));
    const doublingFit = average(sectionFindings
        .map((finding) => finding.metrics.orchestrationDoublingFit)
        .filter((value) => Number.isFinite(value) && value >= 0));
    const textureRotationFit = average(sectionFindings
        .map((finding) => finding.metrics.orchestrationTextureRotationFit)
        .filter((value) => Number.isFinite(value) && value >= 0));
    const handoffFit = average(sectionFindings
        .map((finding) => finding.metrics.orchestrationHandoffFit)
        .filter((value) => Number.isFinite(value) && value >= 0));
    const weakSectionIds = Array.from(new Set(sectionFindings
        .filter((finding) => (
            (typeof finding.metrics.orchestrationRangeFit === "number" && finding.metrics.orchestrationRangeFit < 0.68)
            || (typeof finding.metrics.orchestrationBalanceFit === "number" && finding.metrics.orchestrationBalanceFit < 0.68)
            || (typeof finding.metrics.orchestrationConversationFit === "number" && finding.metrics.orchestrationConversationFit < 0.68)
            || (typeof finding.metrics.orchestrationDoublingFit === "number" && finding.metrics.orchestrationDoublingFit < 0.68)
            || (typeof finding.metrics.orchestrationTextureRotationFit === "number" && finding.metrics.orchestrationTextureRotationFit < 0.68)
            || (typeof finding.metrics.orchestrationHandoffFit === "number" && finding.metrics.orchestrationHandoffFit < 0.68)
        ))
        .map((finding) => finding.sectionId)));

    if (rangeFit === undefined && balanceFit === undefined && conversationFit === undefined && doublingFit === undefined && textureRotationFit === undefined && handoffFit === undefined) {
        return undefined;
    }

    return {
        family: orchestration.family,
        instrumentNames: [...orchestration.instrumentNames],
        sectionCount: orchestration.sections.length,
        conversationalSectionCount: orchestration.sections.filter((section) => section.conversationMode === "conversational").length,
        ...(rangeFit !== undefined ? { idiomaticRangeFit: rangeFit } : {}),
        ...(balanceFit !== undefined ? { registerBalanceFit: balanceFit } : {}),
        ...(conversationFit !== undefined ? { ensembleConversationFit: conversationFit } : {}),
        ...(doublingFit !== undefined ? { doublingPressureFit: doublingFit } : {}),
        ...(textureRotationFit !== undefined ? { textureRotationFit } : {}),
        ...(handoffFit !== undefined ? { sectionHandoffFit: handoffFit } : {}),
        weakSectionIds,
    };
}

function enrichSectionFindingFromArtifacts(
    finding: StructureSectionFinding,
    section: SectionPlan | undefined,
    artifact: SectionArtifactSummary | undefined,
    sourceArtifact: SectionArtifactSummary | undefined,
    textureDefaults: TextureGuidance | undefined,
    expressionDefaults: ExpressionGuidance | undefined,
    orchestration: OrchestrationPlan | undefined,
): StructureSectionFinding {
    const enriched = {
        ...finding,
        issues: [...finding.issues],
        strengths: [...finding.strengths],
        metrics: { ...finding.metrics },
    };
    let penalty = 0;

    const { fit: registerCenterFit, drift: registerCenterDrift } = computeRegisterCenterFit(section, artifact);
    if (registerCenterFit !== undefined && registerCenterDrift !== undefined) {
        enriched.metrics.registerCenterFit = registerCenterFit;
        enriched.metrics.registerCenterDrift = Number(registerCenterDrift.toFixed(4));
        penalty += (1 - registerCenterFit) * 12;

        if (registerCenterFit < 0.58) {
            pushUnique(
                enriched.issues,
                `Realized register center drifts from planned register target by ${Math.round(registerCenterDrift)} semitones.`,
            );
        } else if (registerCenterFit >= 0.82) {
            pushUnique(
                enriched.strengths,
                "Realized register center stays close to the planned sectional target.",
            );
        }
    }

    const cadenceApproachFit = computeCadenceApproachFit(section, artifact);
    if (cadenceApproachFit !== undefined) {
        enriched.metrics.cadenceApproachFit = Number(cadenceApproachFit.toFixed(4));
        penalty += (1 - cadenceApproachFit) * 10;

        if (cadenceApproachFit < 0.55) {
            pushUnique(
                enriched.issues,
                "Cadence approach in the bass does not align with the planned close.",
            );
        } else if (cadenceApproachFit >= 0.85) {
            pushUnique(
                enriched.strengths,
                "Bass cadence approach supports the planned sectional close.",
            );
        }
    }

    const plannedTexture = mergeTextureGuidance(textureDefaults, section?.texture);
    const phraseFunctionFit = computePhraseFunctionFit(section?.phraseFunction, artifact?.phraseFunction);
    const textureVoiceCountFit = computeTextureVoiceCountFit(plannedTexture?.voiceCount, artifact?.textureVoiceCount);
    const textureRoleFit = computeTagSetFit(plannedTexture?.primaryRoles, artifact?.primaryTextureRoles);
    const counterpointModeFit = computeCounterpointModeFit(plannedTexture?.counterpointMode, artifact?.counterpointMode);
    const textureIndependenceFit = computeTextureIndependenceFit(plannedTexture, artifact);
    const imitationFit = computeImitationFit(
        plannedTexture,
        artifact,
        sourceArtifact,
        counterpointModeFit,
        textureIndependenceFit,
    );
    const counterpointBehaviorFit = computeCounterpointBehaviorFit(
        plannedTexture,
        artifact,
        counterpointModeFit,
        textureIndependenceFit,
        imitationFit,
    );
    const texturePlanFit = weightedAverage([
        { value: textureVoiceCountFit, weight: 2 },
        { value: textureRoleFit, weight: 3 },
        { value: counterpointModeFit, weight: 2 },
        { value: textureIndependenceFit, weight: 3 },
        { value: counterpointBehaviorFit, weight: 2 },
        { value: imitationFit, weight: 2 },
    ]);

    if (phraseFunctionFit !== undefined) {
        enriched.metrics.phraseFunctionFit = phraseFunctionFit;
        penalty += (1 - phraseFunctionFit) * 7;

        if (phraseFunctionFit < 0.58) {
            pushUnique(
                enriched.issues,
                "Section phrase function does not match the planned formal rhetoric.",
            );
        } else if (phraseFunctionFit >= 0.9) {
            pushUnique(
                enriched.strengths,
                "Section phrase function remains aligned with the planned formal rhetoric.",
            );
        }
    }

    const phrasePressureMetrics = computePhrasePressureMetrics(section, artifact);
    if (phrasePressureMetrics.actualPressure !== undefined) {
        enriched.metrics.actualPhrasePressure = phrasePressureMetrics.actualPressure;
    }
    if (phrasePressureMetrics.targetPressure !== undefined) {
        enriched.metrics.targetPhrasePressure = phrasePressureMetrics.targetPressure;
    }
    if (phrasePressureMetrics.phraseClosureFit !== undefined) {
        enriched.metrics.phraseClosureFit = phrasePressureMetrics.phraseClosureFit;
    }
    if (phrasePressureMetrics.phrasePressureFit !== undefined) {
        enriched.metrics.phrasePressureFit = phrasePressureMetrics.phrasePressureFit;
        penalty += (1 - phrasePressureMetrics.phrasePressureFit) * 8;

        if (phrasePressureMetrics.phrasePressureFit < 0.56) {
            pushUnique(
                enriched.issues,
                "Section phrase pressure compresses instead of projecting the planned formal role.",
            );
        } else if (phrasePressureMetrics.phrasePressureFit >= 0.84) {
            pushUnique(
                enriched.strengths,
                "Section phrase pressure supports the planned formal role.",
            );
        }
    }

    if (textureVoiceCountFit !== undefined) {
        enriched.metrics.textureVoiceCountFit = textureVoiceCountFit;
    }
    if (textureRoleFit !== undefined) {
        enriched.metrics.textureRoleFit = textureRoleFit;
    }
    if (counterpointModeFit !== undefined) {
        enriched.metrics.counterpointModeFit = counterpointModeFit;
    }
    if (textureIndependenceFit !== undefined) {
        enriched.metrics.textureIndependenceFit = textureIndependenceFit;

        if (textureIndependenceFit < 0.55) {
            pushUnique(
                enriched.issues,
                "Section secondary line stays too static to support the planned independent texture.",
            );
        } else if (textureIndependenceFit >= 0.82) {
            pushUnique(
                enriched.strengths,
                "Section secondary line keeps enough motion to sustain the planned independent texture.",
            );
        }
    }
    if (imitationFit !== undefined) {
        enriched.metrics.imitationFit = imitationFit;

        if (imitationFit < 0.58) {
            pushUnique(
                enriched.issues,
                "Section imitative cue does not preserve enough source-motif relation and answer-like motion.",
            );
        } else if (imitationFit >= 0.82) {
            pushUnique(
                enriched.strengths,
                "Section imitative cue keeps enough source-motif relation to read as an answer-like strand.",
            );
        }
    }
    if (counterpointBehaviorFit !== undefined) {
        enriched.metrics.counterpointBehaviorFit = counterpointBehaviorFit;

        if (plannedTexture?.counterpointMode === "contrary_motion" && counterpointBehaviorFit < 0.58) {
            pushUnique(
                enriched.issues,
                "Section contrary-motion cue is not strong enough between melody and secondary line.",
            );
        } else if (plannedTexture?.counterpointMode === "imitative" && counterpointBehaviorFit < 0.58) {
            pushUnique(
                enriched.issues,
                "Section imitative counterpoint does not sustain enough answer-like motion after realization.",
            );
        } else if (counterpointBehaviorFit < 0.58) {
            pushUnique(
                enriched.issues,
                "Section counterpoint behavior is too weak to support the planned texture profile.",
            );
        } else if (counterpointBehaviorFit >= 0.82) {
            pushUnique(
                enriched.strengths,
                "Section counterpoint behavior survives symbolic realization with enough independence.",
            );
        }
    }
    if (texturePlanFit !== undefined) {
        enriched.metrics.texturePlanFit = texturePlanFit;
        penalty += (1 - texturePlanFit) * 8;

        if (texturePlanFit < 0.6) {
            pushUnique(
                enriched.issues,
                "Section texture plan does not preserve the planned voice-count or role layout.",
            );
        } else if (texturePlanFit >= 0.84) {
            pushUnique(
                enriched.strengths,
                "Section texture profile preserves the planned voice-count and role layout.",
            );
        }
    }

    if ((counterpointModeFit ?? 1) < 0.55 || (counterpointBehaviorFit ?? 1) < 0.55) {
        pushUnique(
            enriched.issues,
            "Section counterpoint cue does not match the planned texture profile.",
        );
    }

    const plannedExpression = mergeExpressionGuidance(expressionDefaults, section?.expression);
    const dynamicsPlanFit = computeDynamicsFit(plannedExpression?.dynamics, artifact?.expressionDynamics);
    const articulationPlanFit = computeTagSetFit(plannedExpression?.articulation, artifact?.articulation);
    const characterPlanFit = computeTagSetFit(plannedExpression?.character, artifact?.character);
    const phrasePeakPlanFit = computePhrasePeakFit(plannedExpression?.phrasePeaks, artifact?.phrasePeaks);
    const sustainBiasFit = computeScalarFit(plannedExpression?.sustainBias, artifact?.sustainBias, 2);
    const accentBiasFit = computeScalarFit(plannedExpression?.accentBias, artifact?.accentBias, 2);
    const articulationCharacterPlanFit = weightedAverage([
        { value: articulationPlanFit, weight: 3 },
        { value: characterPlanFit, weight: 2 },
    ]);
    const expressionPlanFit = weightedAverage([
        { value: dynamicsPlanFit, weight: 4 },
        { value: articulationPlanFit, weight: 3 },
        { value: characterPlanFit, weight: 2 },
        { value: phrasePeakPlanFit, weight: 1 },
        { value: sustainBiasFit, weight: 1 },
        { value: accentBiasFit, weight: 1 },
    ]);

    if (dynamicsPlanFit !== undefined) {
        enriched.metrics.dynamicsPlanFit = dynamicsPlanFit;
    }
    if (articulationPlanFit !== undefined) {
        enriched.metrics.articulationPlanFit = articulationPlanFit;
    }
    if (characterPlanFit !== undefined) {
        enriched.metrics.characterPlanFit = characterPlanFit;
    }
    if (phrasePeakPlanFit !== undefined) {
        enriched.metrics.phrasePeakPlanFit = phrasePeakPlanFit;
    }
    if (sustainBiasFit !== undefined) {
        enriched.metrics.sustainBiasFit = sustainBiasFit;
    }
    if (accentBiasFit !== undefined) {
        enriched.metrics.accentBiasFit = accentBiasFit;
    }
    if (articulationCharacterPlanFit !== undefined) {
        enriched.metrics.articulationCharacterPlanFit = articulationCharacterPlanFit;
    }
    if (expressionPlanFit !== undefined) {
        enriched.metrics.expressionPlanFit = expressionPlanFit;
        penalty += (1 - expressionPlanFit) * 9;

        if ((dynamicsPlanFit ?? 1) < 0.55) {
            pushUnique(
                enriched.issues,
                "Section dynamics drift from the planned expression contour.",
            );
        }

        if ((articulationCharacterPlanFit ?? 1) < 0.6) {
            pushUnique(
                enriched.issues,
                "Section articulation or character does not match the planned expression profile.",
            );
        }

        if (expressionPlanFit >= 0.86) {
            pushUnique(
                enriched.strengths,
                "Section expression profile stays close to the planned dynamics and articulation.",
            );
        }
    }

    const harmonicRoleMotionMetrics = computeHarmonicRoleMotionMetrics(section, artifact);
    if (harmonicRoleMotionMetrics.actualHarmonicMotion !== undefined) {
        enriched.metrics.actualHarmonicMotion = harmonicRoleMotionMetrics.actualHarmonicMotion;
    }
    if (harmonicRoleMotionMetrics.tonicizationTargetMotion !== undefined) {
        enriched.metrics.tonicizationTargetMotion = harmonicRoleMotionMetrics.tonicizationTargetMotion;
    }
    if (harmonicRoleMotionMetrics.tonicizationPressureFit !== undefined) {
        enriched.metrics.tonicizationPressureFit = harmonicRoleMotionMetrics.tonicizationPressureFit;
        if (harmonicRoleMotionMetrics.tonicizationPressureFit < 0.56) {
            pushUnique(
                enriched.issues,
                "Section tonicization pressure is too weak to project the planned harmonic role.",
            );
        } else if (harmonicRoleMotionMetrics.tonicizationPressureFit >= 0.82) {
            pushUnique(
                enriched.strengths,
                "Section harmonic motion projects its planned tonicization pressure.",
            );
        }
    }
    if (harmonicRoleMotionMetrics.prolongationFloorMotion !== undefined) {
        enriched.metrics.prolongationFloorMotion = harmonicRoleMotionMetrics.prolongationFloorMotion;
    }
    if (harmonicRoleMotionMetrics.prolongationMotionFit !== undefined) {
        enriched.metrics.prolongationMotionFit = harmonicRoleMotionMetrics.prolongationMotionFit;
        if (harmonicRoleMotionMetrics.prolongationMotionFit < 0.56) {
            pushUnique(
                enriched.issues,
                "Section prolongation stays too static for its planned harmonic role.",
            );
        } else if (harmonicRoleMotionMetrics.prolongationMotionFit >= 0.82) {
            pushUnique(
                enriched.strengths,
                "Section prolongation keeps moving enough to avoid harmonic stasis.",
            );
        }
    }
    if (harmonicRoleMotionMetrics.harmonicRoleMotionFit !== undefined) {
        enriched.metrics.harmonicRoleMotionFit = harmonicRoleMotionMetrics.harmonicRoleMotionFit;
        penalty += (1 - harmonicRoleMotionMetrics.harmonicRoleMotionFit) * 8;
    }

    const harmonicColorPlanMetrics = computeHarmonicColorPlanMetrics(section, artifact);
    if (harmonicColorPlanMetrics.coverageFit !== undefined) {
        enriched.metrics.harmonicColorCoverageFit = harmonicColorPlanMetrics.coverageFit;
        if (harmonicColorPlanMetrics.coverageFit < 0.56) {
            pushUnique(
                enriched.issues,
                "Section harmonic color coverage drops planned local color cues before realization.",
            );
        }
    }
    if (harmonicColorPlanMetrics.timingFit !== undefined) {
        enriched.metrics.harmonicColorTimingFit = harmonicColorPlanMetrics.timingFit;
    }
    if (harmonicColorPlanMetrics.targetFit !== undefined) {
        enriched.metrics.harmonicColorTargetFit = harmonicColorPlanMetrics.targetFit;
        if (harmonicColorPlanMetrics.targetFit < 0.56) {
            pushUnique(
                enriched.issues,
                "Section harmonic color target or resolution drifts away from the planned local event.",
            );
        }
    }
    if (harmonicColorPlanMetrics.planFit !== undefined) {
        enriched.metrics.harmonicColorPlanFit = harmonicColorPlanMetrics.planFit;
        penalty += (1 - harmonicColorPlanMetrics.planFit) * 7;

        if (harmonicColorPlanMetrics.planFit < 0.56) {
            pushUnique(
                enriched.issues,
                "Section harmonic color cues do not survive clearly enough to project the planned local color event.",
            );
        } else if (harmonicColorPlanMetrics.planFit >= 0.82) {
            pushUnique(
                enriched.strengths,
                "Section harmonic color cues survive clearly enough to project the planned local color event.",
            );
        }
    }

    const orchestrationSection = orchestrationSectionPlanFor(orchestration, finding.sectionId);
    const orchestrationRangeFit = computeStringTrioRangeFit(orchestrationSection, artifact);
    const orchestrationBalanceFit = computeStringTrioBalanceFit(orchestrationSection, artifact);
    const orchestrationConversationFit = computeStringTrioConversationFit(
        orchestrationSection,
        texturePlanFit,
        textureIndependenceFit,
        counterpointBehaviorFit,
        imitationFit,
    );
    const orchestrationDoublingFit = computeStringTrioDoublingFit(orchestrationSection, artifact);

    if (orchestrationRangeFit !== undefined) {
        enriched.metrics.orchestrationRangeFit = orchestrationRangeFit;
        penalty += (1 - orchestrationRangeFit) * 6;

        if (orchestrationRangeFit < 0.58) {
            pushUnique(
                enriched.issues,
                "String-trio role writing drifts outside idiomatic ranges for the planned instruments.",
            );
        } else if (orchestrationRangeFit >= 0.84) {
            pushUnique(
                enriched.strengths,
                "String-trio role writing stays inside idiomatic ranges for the planned instruments.",
            );
        }
    }

    if (orchestrationBalanceFit !== undefined) {
        enriched.metrics.orchestrationBalanceFit = orchestrationBalanceFit;
        penalty += (1 - orchestrationBalanceFit) * 7;

        if (orchestrationBalanceFit < 0.58) {
            pushUnique(
                enriched.issues,
                "String-trio register balance collapses and blurs the planned lead, middle, and bass layers.",
            );
        } else if (orchestrationBalanceFit >= 0.84) {
            pushUnique(
                enriched.strengths,
                "String-trio register balance keeps the planned lead, middle, and bass layers legible.",
            );
        }
    }

    if (orchestrationDoublingFit !== undefined) {
        enriched.metrics.orchestrationDoublingFit = orchestrationDoublingFit;
        penalty += (1 - orchestrationDoublingFit) * 6;

        if (orchestrationDoublingFit < 0.58) {
            pushUnique(
                enriched.issues,
                "String-trio doubling pressure thickens the lead too often and weakens independent instrument roles.",
            );
        } else if (orchestrationDoublingFit >= 0.84) {
            pushUnique(
                enriched.strengths,
                "String-trio doubling pressure stays light enough that instrument roles remain independent.",
            );
        }
    }

    if (orchestrationConversationFit !== undefined) {
        enriched.metrics.orchestrationConversationFit = orchestrationConversationFit;
        penalty += (1 - orchestrationConversationFit) * 6;

        if (orchestrationConversationFit < 0.58) {
            pushUnique(
                enriched.issues,
                "String-trio conversational writing does not give the secondary string enough independent answer-like activity.",
            );
        } else if (orchestrationConversationFit >= 0.82) {
            pushUnique(
                enriched.strengths,
                "String-trio conversational writing keeps the secondary string active enough to answer the lead.",
            );
        }
    }

    if (penalty > 0.001) {
        enriched.score = Number(clamp(enriched.score - penalty, 0, 100).toFixed(2));
    }

    return enriched;
}

function enrichStructureEvaluationFromArtifacts(
    result: CritiqueResult,
    options: StructureEvaluationOptions | undefined,
): {
    issues: string[];
    strengths: string[];
    metrics: Record<string, number>;
    score: number;
    longSpan?: LongSpanEvaluationSummary;
    orchestration?: OrchestrationEvaluationSummary;
    sectionFindings?: NonNullable<StructureEvaluationReport["sectionFindings"]>;
    weakestSections?: NonNullable<StructureEvaluationReport["weakestSections"]>;
} {
    const issues = [...result.issues];
    const strengths = result.strengths?.length
        ? [...result.strengths]
        : (result.pass ? ["Rule-based symbolic structure checks passed."] : []);
    const baseScore = result.score ?? Math.max(0, 100 - (result.issues.length * 25));
    const metrics: Record<string, number> = {
        issueCount: result.issues.length,
        ...(result.metrics ?? {}),
    };

    const rawSectionFindings = result.sectionFindings?.map((finding) => ({
        ...finding,
        issues: [...finding.issues],
        strengths: [...finding.strengths],
        metrics: { ...finding.metrics },
    }));

    const rawWeakestSections = result.weakestSections?.map((finding) => ({
        ...finding,
        issues: [...finding.issues],
        strengths: [...finding.strengths],
        metrics: { ...finding.metrics },
    }));

    let sectionFindings = rawSectionFindings;
    let weakestSections = rawWeakestSections;
    let artifactPenalty = 0;
    let orchestrationSummary: OrchestrationEvaluationSummary | undefined;

    if (rawSectionFindings?.length && options?.sections?.length && options.sectionArtifacts?.length) {
        const sections = options.sections;
        const sectionById = new Map(sections.map((section) => [section.id, section]));
        const artifactById = new Map(options.sectionArtifacts.map((artifact) => [artifact.sectionId, artifact]));
        sectionFindings = applyStringTrioTransitionInsights(
            rawSectionFindings.map((finding) => (
                enrichSectionFindingFromArtifacts(
                    finding,
                    sectionById.get(finding.sectionId),
                    artifactById.get(finding.sectionId),
                    artifactById.get(resolveTextureSourceSectionId(
                        sectionById.get(finding.sectionId),
                        artifactById.get(finding.sectionId),
                        sections,
                    ) ?? ""),
                    options.textureDefaults,
                    options.expressionDefaults,
                    options.orchestration,
                )
            )),
            sections,
            options.sectionArtifacts,
            options.orchestration,
        );
        weakestSections = mergeStructureSectionInsights(
            selectWeakestStructureSections(sectionFindings),
            rawWeakestSections,
        )
            .sort((left, right) => left.score - right.score || right.issues.length - left.issues.length)
            .slice(0, 2);

        const registerPlanFit = average(
            sectionFindings
                .map((finding) => finding.metrics.registerCenterFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const cadenceApproachPlanFit = average(
            sectionFindings
                .map((finding) => finding.metrics.cadenceApproachFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const phraseFunctionFit = average(
            sectionFindings
                .map((finding) => finding.metrics.phraseFunctionFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const phrasePressureFit = average(
            sectionFindings
                .map((finding) => finding.metrics.phrasePressureFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const textureVoiceCountFit = average(
            sectionFindings
                .map((finding) => finding.metrics.textureVoiceCountFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const textureRoleFit = average(
            sectionFindings
                .map((finding) => finding.metrics.textureRoleFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const counterpointModeFit = average(
            sectionFindings
                .map((finding) => finding.metrics.counterpointModeFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const textureIndependenceFit = average(
            sectionFindings
                .map((finding) => finding.metrics.textureIndependenceFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const counterpointBehaviorFit = average(
            sectionFindings
                .map((finding) => finding.metrics.counterpointBehaviorFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const imitationFit = average(
            sectionFindings
                .map((finding) => finding.metrics.imitationFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const texturePlanFit = average(
            sectionFindings
                .map((finding) => finding.metrics.texturePlanFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const dynamicsPlanFit = average(
            sectionFindings
                .map((finding) => finding.metrics.dynamicsPlanFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const articulationCharacterPlanFit = average(
            sectionFindings
                .map((finding) => finding.metrics.articulationCharacterPlanFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const expressionPlanFit = average(
            sectionFindings
                .map((finding) => finding.metrics.expressionPlanFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const tonicizationPressureFit = average(
            sectionFindings
                .map((finding) => finding.metrics.tonicizationPressureFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const harmonicColorCoverageFit = average(
            sectionFindings
                .map((finding) => finding.metrics.harmonicColorCoverageFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const harmonicColorTimingFit = average(
            sectionFindings
                .map((finding) => finding.metrics.harmonicColorTimingFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const harmonicColorTargetFit = average(
            sectionFindings
                .map((finding) => finding.metrics.harmonicColorTargetFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const harmonicColorPlanFit = average(
            sectionFindings
                .map((finding) => finding.metrics.harmonicColorPlanFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const prolongationMotionFit = average(
            sectionFindings
                .map((finding) => finding.metrics.prolongationMotionFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );
        const harmonicRoleMotionFit = average(
            sectionFindings
                .map((finding) => finding.metrics.harmonicRoleMotionFit)
                .filter((value) => Number.isFinite(value) && value >= 0),
        );

        if (registerPlanFit !== undefined) {
            metrics.registerPlanFit = registerPlanFit;
            if (registerPlanFit < 0.72) {
                pushUnique(issues, "Register planning drifts from the intended section targets.");
            } else if (registerPlanFit >= 0.86) {
                pushUnique(strengths, "Section register targets are realized consistently across the form.");
            }
        }

        if (cadenceApproachPlanFit !== undefined) {
            metrics.cadenceApproachPlanFit = cadenceApproachPlanFit;
            if (cadenceApproachPlanFit < 0.68) {
                pushUnique(issues, "Bass cadence approach does not match the planned sectional closes.");
            } else if (cadenceApproachPlanFit >= 0.84) {
                pushUnique(strengths, "Bass cadence approaches support the planned sectional closes.");
            }
        }

        if (phraseFunctionFit !== undefined) {
            metrics.phraseFunctionFit = phraseFunctionFit;
            if (phraseFunctionFit < 0.72) {
                pushUnique(issues, "Section phrase rhetoric drifts from the planned formal roles.");
            } else if (phraseFunctionFit >= 0.88) {
                pushUnique(strengths, "Section phrase rhetoric stays close to the planned formal roles.");
            }
        }

        if (phrasePressureFit !== undefined) {
            metrics.phrasePressureFit = phrasePressureFit;
            if (phrasePressureFit < 0.72) {
                pushUnique(issues, "Section phrase pressure compresses the planned formal contrast.");
            } else if (phrasePressureFit >= 0.84) {
                pushUnique(strengths, "Section phrase pressure preserves the planned formal contrast.");
            }
        }

        if (textureVoiceCountFit !== undefined) {
            metrics.textureVoiceCountFit = textureVoiceCountFit;
        }

        if (textureRoleFit !== undefined) {
            metrics.textureRoleFit = textureRoleFit;
        }

        if (counterpointModeFit !== undefined) {
            metrics.counterpointModeFit = counterpointModeFit;
        }

        if (textureIndependenceFit !== undefined) {
            metrics.textureIndependenceFit = textureIndependenceFit;
            if (textureIndependenceFit < 0.68) {
                pushUnique(issues, "Planned inner-voice or counterline sections stay too static after realization.");
            } else if (textureIndependenceFit >= 0.84) {
                pushUnique(strengths, "Planned inner-voice or counterline sections retain audible independent motion.");
            }
        }

        if (counterpointBehaviorFit !== undefined) {
            metrics.counterpointBehaviorFit = counterpointBehaviorFit;
            if (counterpointBehaviorFit < 0.68) {
                pushUnique(issues, "Counterpoint behavior is too weak in the sections that requested it.");
            } else if (counterpointBehaviorFit >= 0.84) {
                pushUnique(strengths, "Counterpoint behavior survives symbolic realization in the sections that requested it.");
            }
        }

        if (imitationFit !== undefined) {
            metrics.imitationFit = imitationFit;
            if (imitationFit < 0.68) {
                pushUnique(issues, "Imitative sections do not retain enough source-motif relation after realization.");
            } else if (imitationFit >= 0.84) {
                pushUnique(strengths, "Imitative sections retain enough source-motif relation to read as answer-like writing.");
            }
        }

        if (texturePlanFit !== undefined) {
            metrics.texturePlanFit = texturePlanFit;
            if (texturePlanFit < 0.72) {
                pushUnique(issues, "Section texture drift weakens the planned voice-count and role profile.");
            } else if (texturePlanFit >= 0.86) {
                pushUnique(strengths, "Section texture cues stay close to the planned voice-count and role profile.");
            }
        }

        if (dynamicsPlanFit !== undefined) {
            metrics.dynamicsPlanFit = dynamicsPlanFit;
        }

        if (articulationCharacterPlanFit !== undefined) {
            metrics.articulationCharacterPlanFit = articulationCharacterPlanFit;
        }

        if (expressionPlanFit !== undefined) {
            metrics.expressionPlanFit = expressionPlanFit;
            if (expressionPlanFit < 0.72) {
                pushUnique(issues, "Section expression drift weakens the planned dynamic and articulation profile.");
            } else if (expressionPlanFit >= 0.86) {
                pushUnique(strengths, "Section dynamics and articulation stay close to the planned expression profile.");
            }
        }

        if (tonicizationPressureFit !== undefined) {
            metrics.tonicizationPressureFit = tonicizationPressureFit;
            if (tonicizationPressureFit < 0.68) {
                pushUnique(issues, "Section tonicization pressure is too weak for the planned harmonic roles.");
            } else if (tonicizationPressureFit >= 0.82) {
                pushUnique(strengths, "Section harmonic motion projects the planned tonicization pressure.");
            }
        }

        if (harmonicColorCoverageFit !== undefined) {
            metrics.harmonicColorCoverageFit = harmonicColorCoverageFit;
        }

        if (harmonicColorTimingFit !== undefined) {
            metrics.harmonicColorTimingFit = harmonicColorTimingFit;
        }

        if (harmonicColorTargetFit !== undefined) {
            metrics.harmonicColorTargetFit = harmonicColorTargetFit;
        }

        if (harmonicColorPlanFit !== undefined) {
            metrics.harmonicColorPlanFit = harmonicColorPlanFit;
            if (harmonicColorPlanFit < 0.68) {
                pushUnique(issues, "Planned harmonic color does not survive clearly enough across the weak sections.");
            } else if (harmonicColorPlanFit >= 0.82) {
                pushUnique(strengths, "Planned harmonic color survives clearly enough across the weak sections.");
            }
        }

        if (prolongationMotionFit !== undefined) {
            metrics.prolongationMotionFit = prolongationMotionFit;
            if (prolongationMotionFit < 0.68) {
                pushUnique(issues, "Section prolongation stays too static for the planned harmonic roles.");
            } else if (prolongationMotionFit >= 0.82) {
                pushUnique(strengths, "Section prolongation avoids harmonic stasis across the planned span.");
            }
        }

        if (harmonicRoleMotionFit !== undefined) {
            metrics.harmonicRoleMotionFit = harmonicRoleMotionFit;
        }

        orchestrationSummary = buildOrchestrationEvaluationSummary(options.orchestration, sectionFindings);
        if (orchestrationSummary?.idiomaticRangeFit !== undefined) {
            metrics.orchestrationIdiomaticRangeFit = orchestrationSummary.idiomaticRangeFit;
            if (orchestrationSummary.idiomaticRangeFit < 0.72) {
                pushUnique(issues, "String-trio idiomatic range writing drifts outside the planned instrument comfort zones.");
            } else if (orchestrationSummary.idiomaticRangeFit >= 0.86) {
                pushUnique(strengths, "String-trio writing stays inside idiomatic instrument ranges across the form.");
            }
        }

        if (orchestrationSummary?.registerBalanceFit !== undefined) {
            metrics.orchestrationRegisterBalanceFit = orchestrationSummary.registerBalanceFit;
            if (orchestrationSummary.registerBalanceFit < 0.72) {
                pushUnique(issues, "String-trio register balance blurs the planned lead, middle, and bass stack.");
            } else if (orchestrationSummary.registerBalanceFit >= 0.86) {
                pushUnique(strengths, "String-trio register balance keeps the layered ensemble stack legible.");
            }
        }

        if (orchestrationSummary?.ensembleConversationFit !== undefined) {
            metrics.orchestrationConversationFit = orchestrationSummary.ensembleConversationFit;
            if (orchestrationSummary.ensembleConversationFit < 0.72) {
                pushUnique(issues, "String-trio conversational sections do not sustain enough independent exchange.");
            } else if (orchestrationSummary.ensembleConversationFit >= 0.84) {
                pushUnique(strengths, "String-trio conversational sections sustain a credible independent exchange.");
            }
        }

        if (orchestrationSummary?.doublingPressureFit !== undefined) {
            metrics.orchestrationDoublingPressureFit = orchestrationSummary.doublingPressureFit;
            if (orchestrationSummary.doublingPressureFit < 0.72) {
                pushUnique(issues, "String-trio doubling pressure blurs independent instrument roles across the form.");
            } else if (orchestrationSummary.doublingPressureFit >= 0.84) {
                pushUnique(strengths, "String-trio doubling pressure stays light enough that instrument roles remain independent across the form.");
            }
        }

        if (orchestrationSummary?.textureRotationFit !== undefined) {
            metrics.orchestrationTextureRotationFit = orchestrationSummary.textureRotationFit;
            if (orchestrationSummary.textureRotationFit < 0.72) {
                pushUnique(issues, "String-trio texture rotation does not refresh conversation, balance, or spacing states clearly enough across the form.");
            } else if (orchestrationSummary.textureRotationFit >= 0.84) {
                pushUnique(strengths, "String-trio texture rotation refreshes conversation, balance, and spacing states clearly across the form.");
            }
        }

        if (orchestrationSummary?.sectionHandoffFit !== undefined) {
            metrics.orchestrationSectionHandoffFit = orchestrationSummary.sectionHandoffFit;
            if (orchestrationSummary.sectionHandoffFit < 0.72) {
                pushUnique(issues, "String-trio section-to-section handoffs do not reassign lead, middle, and bass duties clearly enough.");
            } else if (orchestrationSummary.sectionHandoffFit >= 0.84) {
                pushUnique(strengths, "String-trio section-to-section handoffs clearly reassign lead, middle, and bass duties.");
            }
        }

        artifactPenalty = (
            (registerPlanFit !== undefined ? (1 - registerPlanFit) * 12 : 0)
            + (cadenceApproachPlanFit !== undefined ? (1 - cadenceApproachPlanFit) * 10 : 0)
            + (phraseFunctionFit !== undefined ? (1 - phraseFunctionFit) * 8 : 0)
            + (phrasePressureFit !== undefined ? (1 - phrasePressureFit) * 8 : 0)
            + (texturePlanFit !== undefined ? (1 - texturePlanFit) * 9 : 0)
            + (expressionPlanFit !== undefined ? (1 - expressionPlanFit) * 10 : 0)
            + (harmonicColorPlanFit !== undefined ? (1 - harmonicColorPlanFit) * 7 : 0)
            + (harmonicRoleMotionFit !== undefined ? (1 - harmonicRoleMotionFit) * 8 : 0)
            + (orchestrationSummary?.idiomaticRangeFit !== undefined ? (1 - orchestrationSummary.idiomaticRangeFit) * 7 : 0)
            + (orchestrationSummary?.registerBalanceFit !== undefined ? (1 - orchestrationSummary.registerBalanceFit) * 8 : 0)
            + (orchestrationSummary?.ensembleConversationFit !== undefined ? (1 - orchestrationSummary.ensembleConversationFit) * 6 : 0)
            + (orchestrationSummary?.doublingPressureFit !== undefined ? (1 - orchestrationSummary.doublingPressureFit) * 6 : 0)
            + (orchestrationSummary?.textureRotationFit !== undefined ? (1 - orchestrationSummary.textureRotationFit) * 5 : 0)
            + (orchestrationSummary?.sectionHandoffFit !== undefined ? (1 - orchestrationSummary.sectionHandoffFit) * 6 : 0)
        );
    }

    const sectionInsights = mergeStructureSectionInsights(sectionFindings, weakestSections);
    const sectionReliability = computeStructureSectionReliability(sectionInsights);
    if (sectionReliability.averageSectionScore !== undefined) {
        metrics.sectionAverageScore = sectionReliability.averageSectionScore;
    }
    if (sectionReliability.minimumSectionScore !== undefined) {
        metrics.sectionMinimumScore = sectionReliability.minimumSectionScore;
        if (sectionReliability.minimumSectionScore < 64) {
            pushUnique(issues, "At least one section is materially weaker than the rest of the form.");
        }
    }
    if (sectionReliability.sectionScoreSpread !== undefined) {
        metrics.sectionScoreSpread = sectionReliability.sectionScoreSpread;
        if (sectionReliability.sectionScoreSpread > 20) {
            pushUnique(issues, "Section quality varies too sharply across the form.");
        }
    }
    metrics.issueBearingSectionCount = sectionReliability.issueBearingSectionCount;
    if (sectionReliability.sectionReliabilityFit !== undefined) {
        metrics.sectionReliabilityFit = sectionReliability.sectionReliabilityFit;
        if (sectionReliability.sectionReliabilityFit < 0.62) {
            pushUnique(issues, "Section-level reliability is too uneven to trust the global structure score.");
        } else if (sectionReliability.sectionReliabilityFit >= 0.86) {
            pushUnique(strengths, "Section quality stays consistent across the form.");
        }
    }
    if (sectionReliability.penalty > 0) {
        metrics.sectionReliabilityPenalty = sectionReliability.penalty;
    }

    return {
        issues,
        strengths,
        metrics: {
            ...metrics,
            issueCount: issues.length,
        },
        ...(options?.longSpanForm ? { longSpan: buildLongSpanEvaluationSummary(metrics, options.longSpanForm) } : {}),
        ...(orchestrationSummary ? { orchestration: orchestrationSummary } : {}),
        score: Number(clamp(baseScore - artifactPenalty - sectionReliability.penalty, 0, 100).toFixed(2)),
        sectionFindings,
        weakestSections,
    };
}

function parseWavMetadata(buffer: Buffer): WavChunkMetadata | null {
    if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
        return null;
    }

    let offset = 12;
    let audioFormat: number | undefined;
    let channelCount: number | undefined;
    let sampleRate: number | undefined;
    let bitsPerSample: number | undefined;
    let dataOffset: number | undefined;
    let dataSize: number | undefined;

    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const chunkDataOffset = offset + 8;
        if (chunkDataOffset + chunkSize > buffer.length) {
            break;
        }

        if (chunkId === "fmt " && chunkSize >= 16) {
            audioFormat = buffer.readUInt16LE(chunkDataOffset);
            channelCount = buffer.readUInt16LE(chunkDataOffset + 2);
            sampleRate = buffer.readUInt32LE(chunkDataOffset + 4);
            bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
        } else if (chunkId === "data") {
            dataOffset = chunkDataOffset;
            dataSize = chunkSize;
        }

        offset = chunkDataOffset + chunkSize + (chunkSize % 2);
    }

    if (
        audioFormat === undefined
        || channelCount === undefined
        || sampleRate === undefined
        || bitsPerSample === undefined
        || dataOffset === undefined
        || dataSize === undefined
        || channelCount <= 0
        || sampleRate <= 0
        || bitsPerSample <= 0
    ) {
        return null;
    }

    return {
        audioFormat,
        channelCount,
        sampleRate,
        bitsPerSample,
        dataOffset,
        dataSize,
    };
}

function readWavDurationSec(filePath: string | undefined): number | undefined {
    if (!filePath) {
        return undefined;
    }

    try {
        const buffer = fs.readFileSync(filePath);
        const metadata = parseWavMetadata(buffer);
        if (!metadata) {
            return undefined;
        }

        const bytesPerFrame = metadata.channelCount * (metadata.bitsPerSample / 8);
        if (!Number.isFinite(bytesPerFrame) || bytesPerFrame <= 0) {
            return undefined;
        }

        return Number((metadata.dataSize / (metadata.sampleRate * bytesPerFrame)).toFixed(3));
    } catch {
        return undefined;
    }
}

function readWavSignal(filePath: string | undefined): WavSignalData | null {
    if (!filePath) {
        return null;
    }

    try {
        const buffer = fs.readFileSync(filePath);
        const metadata = parseWavMetadata(buffer);
        if (!metadata) {
            return null;
        }

        const bytesPerSample = metadata.bitsPerSample / 8;
        const frameSize = metadata.channelCount * bytesPerSample;
        if (!Number.isFinite(frameSize) || frameSize <= 0) {
            return null;
        }

        const frameCount = Math.floor(metadata.dataSize / frameSize);
        if (frameCount <= 0) {
            return null;
        }

        const samples = new Float32Array(frameCount);
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
            let mixed = 0;
            for (let channelIndex = 0; channelIndex < metadata.channelCount; channelIndex += 1) {
                const offset = metadata.dataOffset + (frameIndex * frameSize) + (channelIndex * bytesPerSample);
                let value = 0;
                if (metadata.audioFormat === 1 && metadata.bitsPerSample === 16) {
                    value = buffer.readInt16LE(offset) / 32768;
                } else if (metadata.audioFormat === 1 && metadata.bitsPerSample === 32) {
                    value = buffer.readInt32LE(offset) / 2147483648;
                } else if (metadata.audioFormat === 3 && metadata.bitsPerSample === 32) {
                    value = buffer.readFloatLE(offset);
                } else {
                    return null;
                }

                mixed += value;
            }

            samples[frameIndex] = mixed / metadata.channelCount;
        }

        return {
            sampleRate: metadata.sampleRate,
            durationSec: Number((frameCount / metadata.sampleRate).toFixed(3)),
            samples,
        };
    } catch {
        return null;
    }
}

function buildAudioSectionWindows(sections: AudioNarrativeSection[] | undefined): AudioSectionWindow[] {
    if (!sections?.length) {
        return [];
    }

    let cursor = 0;
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

function resolveNarrativeSourceSection(
    current: AudioSectionWindow,
    sectionWindows: AudioSectionWindow[],
): AudioSectionWindow | undefined {
    const motifRef = String(current.section.motifRef ?? "").trim();
    if (motifRef) {
        return sectionWindows.find((window) => window.section.id === motifRef);
    }

    const contrastFrom = String(current.section.contrastFrom ?? "").trim();
    if (contrastFrom) {
        return sectionWindows.find((window) => window.section.id === contrastFrom);
    }

    const previousSections = sectionWindows.filter((window) => window.startMeasure < current.startMeasure);
    if (current.section.role === "recap") {
        return previousSections.find((window) => window.section.role === "theme_a")
            ?? previousSections.find((window) => window.section.role === "theme_b")
            ?? previousSections.at(0);
    }

    if (current.section.role === "development" || current.section.role === "variation") {
        return [...previousSections].reverse().find((window) => (
            window.section.role === "theme_a"
            || window.section.role === "theme_b"
            || window.section.role === "intro"
            || window.section.role === "bridge"
        ));
    }

    return undefined;
}

function resolvePreviousRoleSection(
    current: AudioSectionWindow,
    sectionWindows: AudioSectionWindow[],
    role: AudioNarrativeSection["role"],
): AudioSectionWindow | undefined {
    return [...sectionWindows]
        .reverse()
        .find((window) => window.startMeasure < current.startMeasure && window.section.role === role);
}

function computeSectionSignalStats(
    signal: WavSignalData,
    startSec: number,
    endSec: number,
): SectionSignalStats | null {
    const startIndex = clamp(Math.floor(startSec * signal.sampleRate), 0, Math.max(signal.samples.length - 1, 0));
    const endIndex = clamp(Math.ceil(endSec * signal.sampleRate), startIndex + 1, signal.samples.length);
    if (endIndex <= startIndex) {
        return null;
    }

    const frameSize = Math.max(512, Math.floor(signal.sampleRate * 0.08));
    let totalSquares = 0;
    let peak = 0;
    let sampleCount = 0;
    const frameRmsValues: number[] = [];

    for (let frameStart = startIndex; frameStart < endIndex; frameStart += frameSize) {
        const frameEnd = Math.min(frameStart + frameSize, endIndex);
        let frameSquares = 0;

        for (let index = frameStart; index < frameEnd; index += 1) {
            const sample = signal.samples[index] ?? 0;
            const abs = Math.abs(sample);
            totalSquares += sample * sample;
            frameSquares += sample * sample;
            sampleCount += 1;
            if (abs > peak) {
                peak = abs;
            }
        }

        const frameCount = frameEnd - frameStart;
        if (frameCount > 0) {
            frameRmsValues.push(Math.sqrt(frameSquares / frameCount));
        }
    }

    if (sampleCount === 0) {
        return null;
    }

    let flux = 0;
    for (let index = 1; index < frameRmsValues.length; index += 1) {
        flux += Math.abs(frameRmsValues[index] - frameRmsValues[index - 1]);
    }

    return {
        rms: Number(Math.sqrt(totalSquares / sampleCount).toFixed(4)),
        peak: Number(peak.toFixed(4)),
        flux: Number((frameRmsValues.length > 1 ? flux / (frameRmsValues.length - 1) : 0).toFixed(4)),
    };
}

function parseTonalCenter(tonalCenter: string | undefined): ParsedTonality | undefined {
    const normalized = String(tonalCenter ?? "").trim();
    if (!normalized) {
        return undefined;
    }

    const match = normalized.match(/^([A-Ga-g])([#b]?)(?:\s+(major|minor))?/i);
    if (!match) {
        return undefined;
    }

    const tonic = `${match[1].toUpperCase()}${match[2] ?? ""}`;
    const tonicPitchClass = TONIC_TO_PITCH_CLASS[tonic];
    if (tonicPitchClass === undefined) {
        return undefined;
    }

    const mode = match[3]?.toLowerCase() === "minor"
        ? "minor"
        : match[3]?.toLowerCase() === "major"
            ? "major"
            : undefined;

    return {
        tonicPitchClass,
        mode,
        label: mode ? `${PITCH_CLASS_TO_TONIC[tonicPitchClass]} ${mode}` : PITCH_CLASS_TO_TONIC[tonicPitchClass],
    };
}

function parseTonalCenterPitchClass(tonalCenter: string | undefined): number | undefined {
    return parseTonalCenter(tonalCenter)?.tonicPitchClass;
}

function circularPitchClassDistance(left: number, right: number): number {
    const delta = Math.abs(left - right) % 12;
    return Math.min(delta, 12 - delta);
}

function pitchClassMatchScore(actual: number | undefined, expected: number | undefined, maxDistance = 3): number | undefined {
    if (actual === undefined || expected === undefined) {
        return undefined;
    }

    return Number((1 - clamp(circularPitchClassDistance(actual, expected) / maxDistance, 0, 1)).toFixed(4));
}

function dominantPitchClass(chroma: number[]): number {
    let bestIndex = 0;
    let bestValue = -1;

    for (let index = 0; index < chroma.length; index += 1) {
        const value = chroma[index] ?? 0;
        if (value > bestValue) {
            bestIndex = index;
            bestValue = value;
        }
    }

    return bestIndex;
}

function oppositeMode(mode: TonalityMode): TonalityMode {
    return mode === "major" ? "minor" : "major";
}

function normalizeVector(values: number[]): number[] {
    const magnitude = Math.sqrt(values.reduce((sum, value) => sum + (value * value), 0));
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
        return values.map(() => 0);
    }

    return values.map((value) => value / magnitude);
}

function cosineSimilarity(left: number[], right: number[]): number {
    if (left.length !== right.length || left.length === 0) {
        return 0;
    }

    const leftNormalized = normalizeVector(left);
    const rightNormalized = normalizeVector(right);
    let dot = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += (leftNormalized[index] ?? 0) * (rightNormalized[index] ?? 0);
    }

    return Number(clamp(dot, 0, 1).toFixed(4));
}

function rotateKeyProfile(profile: number[], tonicPitchClass: number): number[] {
    const rotated = new Array<number>(12).fill(0);
    for (let index = 0; index < profile.length; index += 1) {
        rotated[(index + tonicPitchClass) % 12] = profile[index] ?? 0;
    }

    return rotated;
}

function keyProfileForTonality(tonicPitchClass: number, mode: TonalityMode): number[] {
    return rotateKeyProfile(mode === "major" ? KRUMHANSL_MAJOR_PROFILE : KRUMHANSL_MINOR_PROFILE, tonicPitchClass);
}

function scoreKeyProfile(chroma: number[], tonicPitchClass: number, mode: TonalityMode): number {
    return cosineSimilarity(chroma, keyProfileForTonality(tonicPitchClass, mode));
}

function estimateKeyFromChroma(chroma: number[]): RenderedKeyEstimate {
    let best: RenderedKeyEstimate | null = null;
    let secondBestScore = 0;

    for (let tonicPitchClass = 0; tonicPitchClass < 12; tonicPitchClass += 1) {
        for (const mode of ["major", "minor"] as const) {
            const score = scoreKeyProfile(chroma, tonicPitchClass, mode);
            const candidate: RenderedKeyEstimate = {
                tonicPitchClass,
                mode,
                score,
                confidence: 0,
                label: `${PITCH_CLASS_TO_TONIC[tonicPitchClass]} ${mode}`,
            };

            if (!best || score > best.score) {
                if (best) {
                    secondBestScore = best.score;
                }
                best = candidate;
            } else if (score > secondBestScore) {
                secondBestScore = score;
            }
        }
    }

    if (!best) {
        return {
            tonicPitchClass: 0,
            mode: "major",
            score: 0,
            confidence: 0,
            label: "C major",
        };
    }

    return {
        ...best,
        confidence: Number(clamp((best.score - secondBestScore) + (best.score * 0.35), 0, 1).toFixed(4)),
    };
}

function scoreExpectedTonalityFitFromObservation(
    chroma: number[],
    dominantPitchClassValue: number,
    estimatedKey: RenderedKeyEstimate,
    tonalCenter: string | undefined,
): number | undefined {
    const parsed = parseTonalCenter(tonalCenter);
    if (!parsed) {
        return undefined;
    }

    if (!parsed.mode) {
        return pitchClassMatchScore(dominantPitchClassValue, parsed.tonicPitchClass);
    }

    const expectedScore = scoreKeyProfile(chroma, parsed.tonicPitchClass, parsed.mode);
    const alternateScore = scoreKeyProfile(chroma, parsed.tonicPitchClass, oppositeMode(parsed.mode));
    const modePreference = clamp((expectedScore - alternateScore + 0.08) / 0.25, 0, 1);
    const tonicFit = pitchClassMatchScore(estimatedKey.tonicPitchClass, parsed.tonicPitchClass) ?? 0.5;
    const modeFit = estimatedKey.mode === parsed.mode ? 1 : 0;

    return Number((
        (expectedScore * 0.45)
        + (modePreference * 0.25)
        + (tonicFit * 0.15)
        + (modeFit * 0.1)
        + (estimatedKey.confidence * 0.05)
    ).toFixed(4));
}

function scoreExpectedTonalityFit(currentChroma: SectionChromaStats, tonalCenter: string | undefined): number | undefined {
    return scoreExpectedTonalityFitFromObservation(
        currentChroma.chroma,
        currentChroma.dominantPitchClass,
        currentChroma.estimatedKey,
        tonalCenter,
    );
}

function scoreEstimatedKeyFitFromObservation(
    chroma: number[],
    estimatedKey: RenderedKeyEstimate,
    estimate: RenderedKeyEstimate | undefined,
): number | undefined {
    if (!estimate) {
        return undefined;
    }

    const profileScore = scoreKeyProfile(chroma, estimate.tonicPitchClass, estimate.mode);
    const tonicFit = pitchClassMatchScore(estimatedKey.tonicPitchClass, estimate.tonicPitchClass) ?? 0.5;
    const modeFit = estimatedKey.mode === estimate.mode ? 1 : 0;

    return Number((
        (profileScore * 0.55)
        + (tonicFit * 0.2)
        + (modeFit * 0.15)
        + (estimatedKey.confidence * 0.1)
    ).toFixed(4));
}

function scoreEstimatedKeyFit(currentChroma: SectionChromaStats, estimate: RenderedKeyEstimate | undefined): number | undefined {
    return scoreEstimatedKeyFitFromObservation(currentChroma.chroma, currentChroma.estimatedKey, estimate);
}

function buildTonalityMap(
    sections: AudioNarrativeSection[] | undefined,
    sectionTonalities: AudioSectionTonality[] | undefined,
): Map<string, string> {
    const tonalities = new Map<string, string>();

    for (const entry of sectionTonalities ?? []) {
        const tonalCenter = String(entry.tonalCenter ?? "").trim();
        if (tonalCenter) {
            tonalities.set(entry.sectionId, tonalCenter);
        }
    }

    for (const section of sections ?? []) {
        const tonalCenter = String(section.harmonicPlan?.tonalCenter ?? "").trim();
        if (tonalCenter && !tonalities.has(section.id)) {
            tonalities.set(section.id, tonalCenter);
        }
    }

    return tonalities;
}

function extractDownsampledSectionSignal(
    signal: WavSignalData,
    startSec: number,
    endSec: number,
    targetSampleRate = 12_000,
): { sampleRate: number; samples: Float32Array } | null {
    const startIndex = clamp(Math.floor(startSec * signal.sampleRate), 0, Math.max(signal.samples.length - 1, 0));
    const endIndex = clamp(Math.ceil(endSec * signal.sampleRate), startIndex + 1, signal.samples.length);
    if (endIndex <= startIndex) {
        return null;
    }

    const stride = Math.max(1, Math.round(signal.sampleRate / targetSampleRate));
    const sampleRate = signal.sampleRate / stride;
    const estimatedLength = Math.max(1, Math.ceil((endIndex - startIndex) / stride));
    const samples = new Float32Array(estimatedLength);
    let writeIndex = 0;

    for (let index = startIndex; index < endIndex; index += stride) {
        samples[writeIndex] = signal.samples[index] ?? 0;
        writeIndex += 1;
    }

    return writeIndex > 0
        ? { sampleRate, samples: samples.subarray(0, writeIndex) }
        : null;
}

function collapseConsecutiveLabels(labels: string[]): string[] {
    const collapsed: string[] = [];
    for (const label of labels) {
        if (!label) {
            continue;
        }

        if (collapsed[collapsed.length - 1] !== label) {
            collapsed.push(label);
        }
    }

    return collapsed;
}

function nextPowerOfTwo(value: number): number {
    let result = 1;
    while (result < value) {
        result <<= 1;
    }

    return result;
}

function buildHannWindow(frameSize: number): Float64Array {
    const window = new Float64Array(frameSize);
    for (let index = 0; index < frameSize; index += 1) {
        window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (frameSize - 1)));
    }

    return window;
}

function fftInPlace(real: Float64Array, imag: Float64Array): void {
    const size = real.length;

    for (let index = 1, swapIndex = 0; index < size; index += 1) {
        let bit = size >> 1;
        while (swapIndex & bit) {
            swapIndex ^= bit;
            bit >>= 1;
        }
        swapIndex ^= bit;

        if (index < swapIndex) {
            [real[index], real[swapIndex]] = [real[swapIndex] ?? 0, real[index] ?? 0];
            [imag[index], imag[swapIndex]] = [imag[swapIndex] ?? 0, imag[index] ?? 0];
        }
    }

    for (let length = 2; length <= size; length <<= 1) {
        const angle = (-2 * Math.PI) / length;
        const phaseStepReal = Math.cos(angle);
        const phaseStepImag = Math.sin(angle);

        for (let offset = 0; offset < size; offset += length) {
            let phaseReal = 1;
            let phaseImag = 0;
            const halfLength = length >> 1;

            for (let index = 0; index < halfLength; index += 1) {
                const evenIndex = offset + index;
                const oddIndex = evenIndex + halfLength;
                const oddReal = real[oddIndex] ?? 0;
                const oddImag = imag[oddIndex] ?? 0;
                const twiddledReal = (oddReal * phaseReal) - (oddImag * phaseImag);
                const twiddledImag = (oddReal * phaseImag) + (oddImag * phaseReal);
                const evenReal = real[evenIndex] ?? 0;
                const evenImag = imag[evenIndex] ?? 0;

                real[oddIndex] = evenReal - twiddledReal;
                imag[oddIndex] = evenImag - twiddledImag;
                real[evenIndex] = evenReal + twiddledReal;
                imag[evenIndex] = evenImag + twiddledImag;

                const nextPhaseReal = (phaseReal * phaseStepReal) - (phaseImag * phaseStepImag);
                phaseImag = (phaseReal * phaseStepImag) + (phaseImag * phaseStepReal);
                phaseReal = nextPhaseReal;
            }
        }
    }
}

function buildSectionKeyDriftPoints(frames: Array<{
    startRatio: number;
    endRatio: number;
    chroma: number[];
    rms: number;
}>): InternalKeyDriftPoint[] {
    if (frames.length === 0) {
        return [];
    }

    const bucketCount = Math.max(1, Math.min(frames.length, clamp(Math.round(frames.length / 6), 3, 6)));
    const driftPoints: InternalKeyDriftPoint[] = [];

    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
        const startIndex = Math.floor((bucketIndex * frames.length) / bucketCount);
        const endIndex = Math.max(startIndex + 1, Math.floor(((bucketIndex + 1) * frames.length) / bucketCount));
        const bucketFrames = frames.slice(startIndex, endIndex);
        if (bucketFrames.length === 0) {
            continue;
        }

        const aggregate = new Array<number>(12).fill(0);
        let totalWeight = 0;

        for (const frame of bucketFrames) {
            const weight = Math.max(frame.rms, 0.001);
            totalWeight += weight;
            for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
                aggregate[pitchClass] += (frame.chroma[pitchClass] ?? 0) * weight;
            }
        }

        if (totalWeight <= 0) {
            continue;
        }

        const chroma = aggregate.map((value) => Number((value / totalWeight).toFixed(4)));
        const dominantPitchClassValue = dominantPitchClass(chroma);
        const estimatedKey = estimateKeyFromChroma(chroma);
        driftPoints.push({
            startRatio: Number((bucketFrames[0]?.startRatio ?? 0).toFixed(4)),
            endRatio: Number((bucketFrames[bucketFrames.length - 1]?.endRatio ?? 1).toFixed(4)),
            chroma,
            dominantPitchClass: dominantPitchClassValue,
            estimatedKey,
        });
    }

    return driftPoints;
}

function estimateSectionChroma(samples: Float32Array, sampleRate: number): SectionChromaStats | null {
    if (samples.length < 512 || sampleRate <= 0) {
        return null;
    }

    const targetFrameSize = Math.min(4096, nextPowerOfTwo(Math.max(512, Math.floor(sampleRate * 0.12))));
    const frameSize = Math.min(targetFrameSize, 2 ** Math.floor(Math.log2(samples.length)));
    if (frameSize < 512) {
        return null;
    }

    const hopSize = Math.max(256, Math.floor(frameSize / 4));
    const window = buildHannWindow(frameSize);
    const aggregate = new Array<number>(12).fill(0);
    const frames: Array<{ startRatio: number; endRatio: number; chroma: number[]; rms: number }> = [];
    let usedFrames = 0;

    for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
        const frame = samples.subarray(start, start + frameSize);
        let frameSquares = 0;
        for (let index = 0; index < frame.length; index += 1) {
            const sample = frame[index] ?? 0;
            frameSquares += sample * sample;
        }

        const rms = Math.sqrt(frameSquares / frame.length);
        if (rms < 0.01) {
            continue;
        }

        const real = new Float64Array(frameSize);
        const imag = new Float64Array(frameSize);
        for (let index = 0; index < frameSize; index += 1) {
            real[index] = (frame[index] ?? 0) * (window[index] ?? 1);
        }

        fftInPlace(real, imag);

        const frameChroma = new Array<number>(12).fill(0);
        for (let binIndex = 1; binIndex < frameSize / 2; binIndex += 1) {
            const frequency = (binIndex * sampleRate) / frameSize;
            const midi = 69 + (12 * Math.log2(frequency / 440));
            if (!Number.isFinite(midi) || midi < CHROMA_MIDI_MIN || midi > CHROMA_MIDI_MAX) {
                continue;
            }

            const magnitude = Math.hypot(real[binIndex] ?? 0, imag[binIndex] ?? 0);
            if (magnitude <= 0) {
                continue;
            }

            const nearestMidi = Math.round(midi);
            const detunePenalty = 1 - clamp(Math.abs(midi - nearestMidi) / 0.5, 0, 1);
            if (detunePenalty <= 0) {
                continue;
            }

            frameChroma[((nearestMidi % 12) + 12) % 12] += (magnitude * detunePenalty) / Math.sqrt(frequency);
        }

        const frameTotal = frameChroma.reduce((sum, value) => sum + value, 0);
        if (frameTotal <= 0) {
            continue;
        }

        const normalizedChroma = frameChroma.map((value) => value / frameTotal);

        for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
            aggregate[pitchClass] += (normalizedChroma[pitchClass] ?? 0) * rms;
        }

        frames.push({
            startRatio: clamp(start / Math.max(samples.length - 1, 1), 0, 1),
            endRatio: clamp((start + frameSize) / Math.max(samples.length, 1), 0, 1),
            chroma: normalizedChroma.map((value) => Number(value.toFixed(4))),
            rms,
        });

        usedFrames += 1;
    }

    const total = aggregate.reduce((sum, value) => sum + value, 0);
    if (usedFrames === 0 || total <= 0) {
        return null;
    }

    const chroma = aggregate.map((value) => Number((value / total).toFixed(4)));
    const firstPitchClass = dominantPitchClass(chroma);
    const sorted = [...chroma].sort((left, right) => right - left);
    const confidence = Number(clamp((sorted[0] ?? 0) + Math.max(0, (sorted[0] ?? 0) - (sorted[1] ?? 0)), 0, 1).toFixed(4));
    const estimatedKey = estimateKeyFromChroma(chroma);
    const driftPoints = buildSectionKeyDriftPoints(frames);

    return {
        chroma,
        dominantPitchClass: firstPitchClass,
        confidence,
        estimatedKey,
        driftPoints,
    };
}

function analyzeNarrativeChroma(
    filePath: string | undefined,
    label: AudioKeyAnalysisSource,
    sectionWindows: AudioSectionWindow[],
): NarrativeChromaAnalysis | null {
    const signal = readWavSignal(filePath);
    if (!signal || sectionWindows.length === 0) {
        return null;
    }

    const totalMeasures = sectionWindows[sectionWindows.length - 1]?.endMeasure ?? 0;
    if (totalMeasures <= 0 || signal.durationSec <= 0) {
        return null;
    }

    const sectionChromas = new Map<string, SectionChromaStats>();
    for (const window of sectionWindows) {
        const startSec = (window.startMeasure / totalMeasures) * signal.durationSec;
        const endSec = (window.endMeasure / totalMeasures) * signal.durationSec;
        const sectionSignal = extractDownsampledSectionSignal(signal, startSec, endSec);
        if (!sectionSignal) {
            continue;
        }

        const chroma = estimateSectionChroma(sectionSignal.samples, sectionSignal.sampleRate);
        if (chroma) {
            sectionChromas.set(window.section.id, chroma);
        }
    }

    return sectionChromas.size > 0 ? { label, sectionChromas } : null;
}

function scoreDevelopmentKeyDriftPath(
    driftPoints: InternalKeyDriftPoint[],
    expectedTonality: string | undefined,
    sourceTonality: string | undefined,
    homeTonality: string | undefined,
): number | undefined {
    if (driftPoints.length === 0) {
        return undefined;
    }

    const anchorTonality = sourceTonality ?? homeTonality;
    if (!expectedTonality && !anchorTonality) {
        return undefined;
    }

    const anchorParsed = parseTonalCenter(anchorTonality);
    const expectedParsed = parseTonalCenter(expectedTonality);
    const modulationExpected = !!anchorParsed
        && !!expectedParsed
        && (
            anchorParsed.tonicPitchClass !== expectedParsed.tonicPitchClass
            || anchorParsed.mode !== expectedParsed.mode
        );
    const earlySlice = driftPoints.slice(0, Math.max(1, Math.ceil(driftPoints.length / 3)));
    const lateSlice = driftPoints.slice(Math.max(0, driftPoints.length - Math.max(1, Math.ceil(driftPoints.length / 3))));
    const earlyAnchorFit = anchorTonality
        ? average(earlySlice.map((point) => (
            scoreExpectedTonalityFitFromObservation(point.chroma, point.dominantPitchClass, point.estimatedKey, anchorTonality) ?? 0.5
        ))) ?? 0.5
        : 0.5;
    const maxDeparture = anchorTonality
        ? Math.max(...driftPoints.map((point) => 1 - (
            scoreExpectedTonalityFitFromObservation(point.chroma, point.dominantPitchClass, point.estimatedKey, anchorTonality) ?? 0.5
        )))
        : 0.5;
    const lateTargetFit = expectedTonality
        ? average(lateSlice.map((point) => (
            scoreExpectedTonalityFitFromObservation(point.chroma, point.dominantPitchClass, point.estimatedKey, expectedTonality) ?? 0.5
        ))) ?? 0.5
        : 0.5;
    const collapsedLabels = collapseConsecutiveLabels(driftPoints.map((point) => point.estimatedKey.label));
    const routeVariety = clamp((collapsedLabels.length - 1) / Math.max(driftPoints.length - 1, 1), 0, 1);

    if (!modulationExpected) {
        return Number((
            (lateTargetFit * 0.65)
            + (earlyAnchorFit * 0.2)
            + (routeVariety * 0.15)
        ).toFixed(4));
    }

    const endContrast = anchorTonality
        ? 1 - (
            scoreExpectedTonalityFitFromObservation(
                driftPoints[driftPoints.length - 1]?.chroma ?? driftPoints[0].chroma,
                driftPoints[driftPoints.length - 1]?.dominantPitchClass ?? driftPoints[0].dominantPitchClass,
                driftPoints[driftPoints.length - 1]?.estimatedKey ?? driftPoints[0].estimatedKey,
                anchorTonality,
            ) ?? 0.5
        )
        : 0.5;

    return Number((
        (earlyAnchorFit * 0.15)
        + (maxDeparture * 0.25)
        + (lateTargetFit * 0.4)
        + (routeVariety * 0.1)
        + (endContrast * 0.1)
    ).toFixed(4));
}

function buildAudioKeyTracking(
    analysis: NarrativeChromaAnalysis | undefined,
    sectionWindows: AudioSectionWindow[],
    sectionTonalities: Map<string, string>,
    homeTonality: string | undefined,
): AudioKeyTrackingReport | undefined {
    if (!analysis) {
        return undefined;
    }

    const sections: AudioSectionKeyTracking[] = [];

    for (const window of sectionWindows) {
        const chroma = analysis.sectionChromas.get(window.section.id);
        if (!chroma) {
            continue;
        }

        const plannedTonality = sectionTonalities.get(window.section.id);
        const renderedKey = chroma.driftPoints[chroma.driftPoints.length - 1]?.estimatedKey ?? chroma.estimatedKey;
        const driftPath: AudioKeyDriftPoint[] = chroma.driftPoints.map((point) => ({
            startRatio: point.startRatio,
            endRatio: point.endRatio,
            renderedKey: { ...point.estimatedKey },
            expectedFit: scoreExpectedTonalityFitFromObservation(point.chroma, point.dominantPitchClass, point.estimatedKey, plannedTonality),
            homeFit: scoreExpectedTonalityFitFromObservation(point.chroma, point.dominantPitchClass, point.estimatedKey, homeTonality),
        }));

        sections.push({
            sectionId: window.section.id,
            role: window.section.role,
            plannedTonality,
            renderedKey: { ...renderedKey },
            driftPath,
        });
    }

    return sections.length > 0
        ? {
            source: analysis.label,
            sections,
        }
        : undefined;
}

function getOrCreateAudioSectionAccumulator(
    bucket: Map<string, AudioSectionNarrativeAccumulator>,
    window: AudioSectionWindow,
    sourceSectionId: string | undefined,
    plannedTonality: string | undefined,
): AudioSectionNarrativeAccumulator {
    const existing = bucket.get(window.section.id);
    if (existing) {
        if (!existing.sourceSectionId && sourceSectionId) {
            existing.sourceSectionId = sourceSectionId;
        }
        if (!existing.plannedTonality && plannedTonality) {
            existing.plannedTonality = plannedTonality;
        }
        return existing;
    }

    const created: AudioSectionNarrativeAccumulator = {
        section: window.section,
        sourceSectionId,
        plannedTonality,
        narrativeFits: [],
        pitchClassFits: [],
        keyDriftFits: [],
    };
    bucket.set(window.section.id, created);
    return created;
}

function buildAudioSectionFindings(
    sectionWindows: AudioSectionWindow[],
    accumulators: Map<string, AudioSectionNarrativeAccumulator>,
): { sectionFindings?: AudioSectionEvaluationFinding[]; weakestSections?: AudioSectionEvaluationFinding[] } {
    const findings: AudioSectionEvaluationFinding[] = [];

    for (const window of sectionWindows) {
        if (window.section.role !== "development" && window.section.role !== "recap") {
            continue;
        }

        const accumulator = accumulators.get(window.section.id);
        if (!accumulator) {
            continue;
        }

        const narrativeFit = average(accumulator.narrativeFits);
        const pitchClassFit = average(accumulator.pitchClassFits);
        const keyDriftFit = average(accumulator.keyDriftFits);
        const narrativeConsistencyFit = consistencyFit(accumulator.narrativeFits, 0.22);
        const pitchClassConsistencyFit = consistencyFit(accumulator.pitchClassFits, 0.18);
        const keyDriftConsistencyFit = consistencyFit(accumulator.keyDriftFits, 0.18);
        const routeConsistencyFit = average([
            pitchClassConsistencyFit,
            keyDriftConsistencyFit,
        ].filter((value): value is number => value !== undefined));
        const score = accumulator.section.role === "development"
            ? weightedAverage([
                { value: narrativeFit, weight: 0.4 },
                { value: pitchClassFit, weight: 0.28 },
                { value: keyDriftFit, weight: 0.18 },
                { value: narrativeConsistencyFit, weight: 0.08 },
                { value: routeConsistencyFit, weight: 0.06 },
            ])
            : weightedAverage([
                { value: narrativeFit, weight: 0.45 },
                { value: pitchClassFit, weight: 0.33 },
                { value: narrativeConsistencyFit, weight: 0.12 },
                { value: pitchClassConsistencyFit, weight: 0.1 },
            ]);

        if (score === undefined) {
            continue;
        }

        const issues: string[] = [];
        const strengths: string[] = [];
        const metrics: Record<string, number> = {
            audioSectionCompositeFit: score,
        };

        if (narrativeConsistencyFit !== undefined) {
            metrics.audioSectionNarrativeConsistencyFit = narrativeConsistencyFit;
            if (narrativeConsistencyFit >= 0.74) {
                strengths.push("Rendered and styled audio agree on the section's narrative contour.");
            } else if (narrativeConsistencyFit < 0.52) {
                issues.push("Rendered and styled audio disagree on the section's narrative contour.");
            }
        }

        if (accumulator.section.role === "development") {
            if (narrativeFit !== undefined) {
                metrics.audioDevelopmentNarrativeFit = narrativeFit;
                if (narrativeFit >= 0.62) {
                    strengths.push("Audio escalation reads clearly against the source theme.");
                } else if (narrativeFit < 0.5) {
                    issues.push("Audio escalation against the source section is weak.");
                }
            }
            if (pitchClassFit !== undefined) {
                metrics.audioDevelopmentPitchClassRouteFit = pitchClassFit;
                if (pitchClassFit >= 0.62) {
                    strengths.push("Rendered pitch-class route departs clearly toward the planned development tonality.");
                } else if (pitchClassFit < 0.5) {
                    issues.push("Rendered pitch-class route does not depart clearly enough toward the planned development tonality.");
                }
            }
            if (keyDriftFit !== undefined) {
                metrics.audioDevelopmentKeyDriftFit = keyDriftFit;
                if (keyDriftFit >= 0.62) {
                    strengths.push("Rendered key drift settles into a readable development route.");
                } else if (keyDriftFit < 0.48) {
                    issues.push("Rendered development key drift does not settle into a clear modulation path.");
                }
            }
            if (routeConsistencyFit !== undefined) {
                metrics.audioDevelopmentRouteConsistencyFit = routeConsistencyFit;
                if (routeConsistencyFit >= 0.72) {
                    strengths.push("Rendered and styled audio agree on the development's modulation profile.");
                } else if (routeConsistencyFit < 0.5) {
                    issues.push("Rendered and styled audio disagree on the development's modulation profile.");
                }
            }
        } else {
            if (narrativeFit !== undefined) {
                metrics.audioRecapRecallFit = narrativeFit;
                if (narrativeFit >= 0.62) {
                    strengths.push("Audio return and release recall the source theme clearly.");
                } else if (narrativeFit < 0.52) {
                    issues.push("Audio return and release against the source section are weak.");
                }
            }
            if (pitchClassFit !== undefined) {
                metrics.audioRecapPitchClassReturnFit = pitchClassFit;
                if (pitchClassFit >= 0.66) {
                    strengths.push("Rendered pitch-class return settles back into the planned recap tonality.");
                } else if (pitchClassFit < 0.52) {
                    issues.push("Rendered pitch-class return does not settle back into the planned recap tonality.");
                }
            }
            if (pitchClassConsistencyFit !== undefined) {
                metrics.audioRecapTonalConsistencyFit = pitchClassConsistencyFit;
                if (pitchClassConsistencyFit >= 0.74) {
                    strengths.push("Rendered and styled audio agree on the recap's tonal return.");
                } else if (pitchClassConsistencyFit < 0.52) {
                    issues.push("Rendered and styled audio disagree on the recap's tonal return.");
                }
            }
        }

        findings.push({
            sectionId: accumulator.section.id,
            label: accumulator.section.label,
            role: accumulator.section.role,
            sourceSectionId: accumulator.sourceSectionId,
            plannedTonality: accumulator.plannedTonality,
            score,
            issues,
            strengths,
            metrics,
        });
    }

    if (findings.length === 0) {
        return {};
    }

    return {
        sectionFindings: findings,
        weakestSections: findings
            .slice()
            .sort((left, right) => left.score - right.score || left.sectionId.localeCompare(right.sectionId))
            .slice(0, Math.min(3, findings.length)),
    };
}

function mergeAudioSectionFindingCollections(
    primary: AudioSectionEvaluationFinding[] | undefined,
    additions: AudioSectionEvaluationFinding[] | undefined,
): { sectionFindings?: AudioSectionEvaluationFinding[]; weakestSections?: AudioSectionEvaluationFinding[] } {
    if ((!primary || primary.length === 0) && (!additions || additions.length === 0)) {
        return {};
    }

    const merged = new Map<string, AudioSectionEvaluationFinding>();

    const mergeFinding = (finding: AudioSectionEvaluationFinding): void => {
        const existing = merged.get(finding.sectionId);
        if (!existing) {
            merged.set(finding.sectionId, {
                ...finding,
                issues: [...finding.issues],
                strengths: [...finding.strengths],
                metrics: { ...finding.metrics },
            });
            return;
        }

        const issues = [...existing.issues];
        for (const issue of finding.issues) {
            pushUnique(issues, issue);
        }
        const strengths = [...existing.strengths];
        for (const strength of finding.strengths) {
            pushUnique(strengths, strength);
        }

        merged.set(finding.sectionId, {
            ...existing,
            ...finding,
            sourceSectionId: existing.sourceSectionId ?? finding.sourceSectionId,
            plannedTonality: existing.plannedTonality ?? finding.plannedTonality,
            score: weightedAverage([
                { value: existing.score, weight: 3 },
                { value: finding.score, weight: 1 },
            ]) ?? existing.score ?? finding.score,
            issues,
            strengths,
            metrics: {
                ...existing.metrics,
                ...finding.metrics,
            },
        });
    };

    for (const finding of primary ?? []) {
        mergeFinding(finding);
    }
    for (const finding of additions ?? []) {
        mergeFinding(finding);
    }

    const sectionFindings = [...merged.values()];
    return {
        sectionFindings,
        weakestSections: sectionFindings
            .slice()
            .sort((left, right) => left.score - right.score || left.sectionId.localeCompare(right.sectionId))
            .slice(0, Math.min(3, sectionFindings.length)),
    };
}

function buildTempoMotionAudioSummary(
    sectionWindows: AudioSectionWindow[],
    sectionArtifacts: SectionArtifactSummary[] | undefined,
): {
    metrics: Record<string, number>;
    issues: string[];
    strengths: string[];
    sectionFindings?: AudioSectionEvaluationFinding[];
} {
    const metrics: Record<string, number> = {};
    const issues: string[] = [];
    const strengths: string[] = [];
    const findings: AudioSectionEvaluationFinding[] = [];

    if (!sectionArtifacts?.length || sectionWindows.length === 0) {
        return { metrics, issues, strengths };
    }

    const artifactById = new Map(sectionArtifacts.map((artifact) => [artifact.sectionId, artifact]));
    const sectionFits: number[] = [];
    const sectionCoverage: number[] = [];
    const sectionDensity: number[] = [];

    for (const window of sectionWindows) {
        const summary = artifactById.get(window.section.id)?.tempoMotionSummary;
        const requestedTags = summary?.requestedTags?.filter(Boolean) ?? [];
        if (requestedTags.length === 0) {
            continue;
        }

        const tempoMetrics = computeTempoMotionPlanFit(summary);
        const score = tempoMetrics.fit
            ?? weightedAverage([
                { value: tempoMetrics.coverageFit, weight: 3 },
                { value: tempoMetrics.densityFit, weight: 2 },
                { value: tempoMetrics.magnitudeFit, weight: 2 },
            ])
            ?? 0;

        const sectionIssues: string[] = [];
        const sectionStrengths: string[] = [];
        const sectionMetrics: Record<string, number> = {
            audioSectionCompositeFit: score,
        };

        if (tempoMetrics.coverageFit !== undefined) {
            sectionMetrics.audioTempoMotionCoverageFit = tempoMetrics.coverageFit;
            sectionCoverage.push(tempoMetrics.coverageFit);
            if (tempoMetrics.coverageFit < 0.55) {
                sectionIssues.push("Tempo-motion coverage is too sparse across the targeted measures.");
            } else if (tempoMetrics.coverageFit >= 0.82) {
                sectionStrengths.push("Tempo-motion reaches most of the targeted measures after humanization.");
            }
        }
        if (tempoMetrics.densityFit !== undefined) {
            sectionMetrics.audioTempoMotionDensityFit = tempoMetrics.densityFit;
            sectionDensity.push(tempoMetrics.densityFit);
            if (tempoMetrics.densityFit < 0.52) {
                sectionIssues.push("Tempo-motion window lacks enough realized note activity to read clearly.");
            }
        }
        if (tempoMetrics.magnitudeFit !== undefined) {
            sectionMetrics.audioTempoMotionMagnitudeFit = tempoMetrics.magnitudeFit;
            if (tempoMetrics.magnitudeFit < 0.45) {
                sectionIssues.push("Section tempo motion does not accumulate enough local timing contrast.");
            }
        }
        if (tempoMetrics.directionFit !== undefined) {
            sectionMetrics.audioTempoMotionDirectionFit = tempoMetrics.directionFit;
            if (tempoMetrics.directionFit < 0.5) {
                sectionIssues.push("Section tempo motion pushes in the wrong local direction after humanization.");
            }
        }
        if (tempoMetrics.fit !== undefined) {
            sectionMetrics.audioTempoMotionPlanFit = tempoMetrics.fit;
            sectionFits.push(tempoMetrics.fit);
            if (tempoMetrics.fit < 0.58) {
                sectionIssues.push("Section tempo motion does not survive humanized realization strongly enough.");
            } else if (tempoMetrics.fit >= 0.82) {
                sectionStrengths.push("Section tempo motion survives humanized realization with clear local timing activity.");
            }
        }

        findings.push({
            sectionId: window.section.id,
            label: window.section.label,
            role: window.section.role,
            score,
            issues: sectionIssues,
            strengths: sectionStrengths,
            metrics: sectionMetrics,
        });
    }

    const globalFit = average(sectionFits);
    const globalCoverage = average(sectionCoverage);
    const globalDensity = average(sectionDensity);

    if (globalFit !== undefined) {
        metrics.audioTempoMotionPlanFit = globalFit;
        if (globalFit < 0.58) {
            issues.push("Tempo-motion cues do not survive strongly enough after humanized realization.");
        } else if (globalFit >= 0.82) {
            strengths.push("Tempo-motion cues survive humanized realization with clear local activity.");
        }
    }
    if (globalCoverage !== undefined) {
        metrics.audioTempoMotionCoverageFit = globalCoverage;
        if (globalCoverage < 0.6) {
            issues.push("Tempo-motion windows do not contain enough realized activity to read clearly.");
        }
    }
    if (globalDensity !== undefined) {
        metrics.audioTempoMotionDensityFit = globalDensity;
    }

    return {
        metrics,
        issues,
        strengths,
        ...(findings.length > 0 ? { sectionFindings: findings } : {}),
    };
}

function buildHarmonicRealizationAudioSummary(
    sectionWindows: AudioSectionWindow[],
    sectionArtifacts: SectionArtifactSummary[] | undefined,
): {
    metrics: Record<string, number>;
    issues: string[];
    strengths: string[];
    sectionFindings?: AudioSectionEvaluationFinding[];
} {
    const metrics: Record<string, number> = {};
    const issues: string[] = [];
    const strengths: string[] = [];
    const findings: AudioSectionEvaluationFinding[] = [];

    if (!sectionArtifacts?.length || sectionWindows.length === 0) {
        return { metrics, issues, strengths };
    }

    const artifactById = new Map(sectionArtifacts.map((artifact) => [artifact.sectionId, artifact]));
    const sectionFits: number[] = [];
    const sectionCoverage: number[] = [];
    const sectionDensity: number[] = [];
    const sectionProlongation: number[] = [];
    const sectionTonicization: number[] = [];
    const sectionColor: number[] = [];

    for (const window of sectionWindows) {
        const summary = artifactById.get(window.section.id)?.harmonicRealizationSummary;
        if (!summary || summary.targetedMeasureCount <= 0) {
            continue;
        }

        const harmonicMetrics = computeHarmonicRealizationPlanFit(summary);
        const score = harmonicMetrics.fit
            ?? weightedAverage([
                { value: harmonicMetrics.coverageFit, weight: 4 },
                { value: harmonicMetrics.densityFit, weight: 2 },
                { value: harmonicMetrics.prolongationFit, weight: 2 },
                { value: harmonicMetrics.tonicizationFit, weight: 3 },
                { value: harmonicMetrics.harmonicColorFit, weight: 3 },
            ])
            ?? 0;

        const sectionIssues: string[] = [];
        const sectionStrengths: string[] = [];
        const sectionMetrics: Record<string, number> = {
            audioSectionCompositeFit: score,
        };

        if (harmonicMetrics.coverageFit !== undefined) {
            sectionMetrics.audioHarmonicRealizationCoverageFit = harmonicMetrics.coverageFit;
            sectionCoverage.push(harmonicMetrics.coverageFit);
            if (harmonicMetrics.coverageFit < 0.55) {
                sectionIssues.push("Section harmonic realization coverage is too sparse across the targeted measures.");
            } else if (harmonicMetrics.coverageFit >= 0.82) {
                sectionStrengths.push("Harmonic realization reaches most of the targeted measures after humanization.");
            }
        }
        if (harmonicMetrics.densityFit !== undefined) {
            sectionMetrics.audioHarmonicRealizationDensityFit = harmonicMetrics.densityFit;
            sectionDensity.push(harmonicMetrics.densityFit);
            if (harmonicMetrics.densityFit < 0.52) {
                sectionIssues.push("Section harmonic realization window lacks enough realized note activity to read clearly.");
            }
        }
        if (harmonicMetrics.prolongationFit !== undefined) {
            sectionMetrics.audioProlongationRealizationFit = harmonicMetrics.prolongationFit;
            sectionProlongation.push(harmonicMetrics.prolongationFit);
            if (harmonicMetrics.prolongationFit < 0.52) {
                sectionIssues.push("Section prolongation window does not maintain enough sustain contrast after humanization.");
            } else if (harmonicMetrics.prolongationFit >= 0.82) {
                sectionStrengths.push("Section prolongation window maintains clear sustain contrast after humanization.");
            }
        }
        if (harmonicMetrics.tonicizationFit !== undefined) {
            sectionMetrics.audioTonicizationRealizationFit = harmonicMetrics.tonicizationFit;
            sectionTonicization.push(harmonicMetrics.tonicizationFit);
            if (harmonicMetrics.tonicizationFit < 0.52) {
                sectionIssues.push("Section tonicization window does not create enough local departure and arrival contrast after humanization.");
            } else if (harmonicMetrics.tonicizationFit >= 0.82) {
                sectionStrengths.push("Section tonicization window creates clear local departure and arrival contrast after humanization.");
            }
        }
        if (harmonicMetrics.harmonicColorFit !== undefined) {
            sectionMetrics.audioHarmonicColorRealizationFit = harmonicMetrics.harmonicColorFit;
            sectionColor.push(harmonicMetrics.harmonicColorFit);
            if (harmonicMetrics.harmonicColorFit < 0.52) {
                sectionIssues.push("Section harmonic-color window does not create enough local color contrast after humanization.");
            } else if (harmonicMetrics.harmonicColorFit >= 0.82) {
                sectionStrengths.push("Section harmonic-color window maintains clear local color contrast after humanization.");
            }
        }
        if (harmonicMetrics.fit !== undefined) {
            sectionMetrics.audioHarmonicRealizationPlanFit = harmonicMetrics.fit;
            sectionFits.push(harmonicMetrics.fit);
            if (harmonicMetrics.fit < 0.58) {
                sectionIssues.push("Section harmonic realization does not survive humanized realization strongly enough.");
            } else if (harmonicMetrics.fit >= 0.82) {
                sectionStrengths.push("Section harmonic realization survives humanized realization with clear local sustain and arrival contrast.");
            }
        }

        findings.push({
            sectionId: window.section.id,
            label: window.section.label,
            role: window.section.role,
            score,
            issues: sectionIssues,
            strengths: sectionStrengths,
            metrics: sectionMetrics,
        });
    }

    const globalFit = average(sectionFits);
    const globalCoverage = average(sectionCoverage);
    const globalDensity = average(sectionDensity);
    const globalProlongation = average(sectionProlongation);
    const globalTonicization = average(sectionTonicization);
    const globalColor = average(sectionColor);

    if (globalFit !== undefined) {
        metrics.audioHarmonicRealizationPlanFit = globalFit;
        if (globalFit < 0.58) {
            issues.push("Harmonic realization cues do not survive strongly enough after humanized realization.");
        } else if (globalFit >= 0.82) {
            strengths.push("Harmonic realization cues survive humanized realization with clear local sustain and arrival contrast.");
        }
    }
    if (globalCoverage !== undefined) {
        metrics.audioHarmonicRealizationCoverageFit = globalCoverage;
        if (globalCoverage < 0.6) {
            issues.push("Harmonic realization windows do not contain enough realized activity to read clearly.");
        }
    }
    if (globalDensity !== undefined) {
        metrics.audioHarmonicRealizationDensityFit = globalDensity;
    }
    if (globalProlongation !== undefined) {
        metrics.audioProlongationRealizationFit = globalProlongation;
        if (globalProlongation < 0.58) {
            issues.push("Prolongation windows do not maintain enough sustain contrast after humanization.");
        } else if (globalProlongation >= 0.82) {
            strengths.push("Prolongation windows survive humanized realization with clear sustain contrast.");
        }
    }
    if (globalTonicization !== undefined) {
        metrics.audioTonicizationRealizationFit = globalTonicization;
        if (globalTonicization < 0.58) {
            issues.push("Tonicization windows do not create enough local departure and arrival contrast after humanization.");
        } else if (globalTonicization >= 0.82) {
            strengths.push("Tonicization windows survive humanized realization with clear local departure and arrival contrast.");
        }
    }
    if (globalColor !== undefined) {
        metrics.audioHarmonicColorRealizationFit = globalColor;
        if (globalColor < 0.58) {
            issues.push("Harmonic-color windows do not create enough local color contrast after humanization.");
        } else if (globalColor >= 0.82) {
            strengths.push("Harmonic-color windows survive humanized realization with clear local color contrast.");
        }
    }

    return {
        metrics,
        issues,
        strengths,
        ...(findings.length > 0 ? { sectionFindings: findings } : {}),
    };
}

function buildPhraseBreathAudioSummary(
    sectionWindows: AudioSectionWindow[],
    sectionArtifacts: SectionArtifactSummary[] | undefined,
): {
    metrics: Record<string, number>;
    issues: string[];
    strengths: string[];
    sectionFindings?: AudioSectionEvaluationFinding[];
} {
    const metrics: Record<string, number> = {};
    const issues: string[] = [];
    const strengths: string[] = [];
    const findings: AudioSectionEvaluationFinding[] = [];

    if (!sectionArtifacts?.length || sectionWindows.length === 0) {
        return { metrics, issues, strengths };
    }

    const artifactById = new Map(sectionArtifacts.map((artifact) => [artifact.sectionId, artifact]));
    const sectionFits: number[] = [];
    const sectionCoverage: number[] = [];
    const pickupFits: number[] = [];
    const arrivalFits: number[] = [];
    const releaseFits: number[] = [];
    const recoveryFits: number[] = [];
    const rubatoFits: number[] = [];

    for (const window of sectionWindows) {
        const summary = artifactById.get(window.section.id)?.phraseBreathSummary;
        const requestedCues = summary?.requestedCues?.filter(Boolean) ?? [];
        if (requestedCues.length === 0) {
            continue;
        }

        const phraseBreathMetrics = computePhraseBreathPlanFit(summary);
        const score = phraseBreathMetrics.fit
            ?? weightedAverage([
                { value: phraseBreathMetrics.coverageFit, weight: 4 },
                { value: phraseBreathMetrics.pickupFit, weight: 2 },
                { value: phraseBreathMetrics.arrivalFit, weight: 3 },
                { value: phraseBreathMetrics.releaseFit, weight: 3 },
                { value: phraseBreathMetrics.recoveryFit, weight: 1 },
                { value: phraseBreathMetrics.rubatoFit, weight: 1 },
            ])
            ?? 0;

        const sectionIssues: string[] = [];
        const sectionStrengths: string[] = [];
        const sectionMetrics: Record<string, number> = {
            audioSectionCompositeFit: score,
        };

        if (phraseBreathMetrics.coverageFit !== undefined) {
            sectionMetrics.audioPhraseBreathCoverageFit = phraseBreathMetrics.coverageFit;
            sectionCoverage.push(phraseBreathMetrics.coverageFit);
            if (phraseBreathMetrics.coverageFit < 0.55) {
                sectionIssues.push("Phrase-breath coverage is too sparse across the targeted measures.");
            } else if (phraseBreathMetrics.coverageFit >= 0.82) {
                sectionStrengths.push("Phrase-breath reaches most of the targeted measures after humanization.");
            }
        }
        if (phraseBreathMetrics.pickupFit !== undefined) {
            sectionMetrics.audioPhraseBreathPickupFit = phraseBreathMetrics.pickupFit;
            pickupFits.push(phraseBreathMetrics.pickupFit);
            if (phraseBreathMetrics.pickupFit < 0.52) {
                sectionIssues.push("Section phrase-breath pickup does not create enough anticipatory lift before the arrival.");
            } else if (phraseBreathMetrics.pickupFit >= 0.82) {
                sectionStrengths.push("Section phrase-breath pickup creates clear anticipatory lift before the arrival.");
            }
        }
        if (phraseBreathMetrics.arrivalFit !== undefined) {
            sectionMetrics.audioPhraseBreathArrivalFit = phraseBreathMetrics.arrivalFit;
            arrivalFits.push(phraseBreathMetrics.arrivalFit);
            if (phraseBreathMetrics.arrivalFit < 0.52) {
                sectionIssues.push("Section phrase-breath arrival does not broaden clearly enough after humanization.");
            } else if (phraseBreathMetrics.arrivalFit >= 0.82) {
                sectionStrengths.push("Section phrase-breath arrival broadens clearly after humanization.");
            }
        }
        if (phraseBreathMetrics.releaseFit !== undefined) {
            sectionMetrics.audioPhraseBreathReleaseFit = phraseBreathMetrics.releaseFit;
            releaseFits.push(phraseBreathMetrics.releaseFit);
            if (phraseBreathMetrics.releaseFit < 0.52) {
                sectionIssues.push("Section phrase-breath release does not ease clearly enough after humanization.");
            } else if (phraseBreathMetrics.releaseFit >= 0.82) {
                sectionStrengths.push("Section phrase-breath release eases clearly after humanization.");
            }
        }
        if (phraseBreathMetrics.recoveryFit !== undefined) {
            sectionMetrics.audioPhraseBreathRecoveryFit = phraseBreathMetrics.recoveryFit;
            recoveryFits.push(phraseBreathMetrics.recoveryFit);
            if (phraseBreathMetrics.recoveryFit < 0.48) {
                sectionIssues.push("Section phrase-breath cadence recovery does not reset cleanly after the release.");
            } else if (phraseBreathMetrics.recoveryFit >= 0.82) {
                sectionStrengths.push("Section phrase-breath cadence recovery resets cleanly after the release.");
            }
        }
        if (phraseBreathMetrics.rubatoFit !== undefined) {
            sectionMetrics.audioPhraseBreathRubatoFit = phraseBreathMetrics.rubatoFit;
            rubatoFits.push(phraseBreathMetrics.rubatoFit);
            if (phraseBreathMetrics.rubatoFit < 0.52) {
                sectionIssues.push("Section phrase-breath rubato anchors do not create enough local timing contrast.");
            } else if (phraseBreathMetrics.rubatoFit >= 0.82) {
                sectionStrengths.push("Section phrase-breath rubato anchors create clear local timing contrast.");
            }
        }
        if (phraseBreathMetrics.fit !== undefined) {
            sectionMetrics.audioPhraseBreathPlanFit = phraseBreathMetrics.fit;
            sectionFits.push(phraseBreathMetrics.fit);
            if (phraseBreathMetrics.fit < 0.58) {
                sectionIssues.push("Section phrase-breath cues do not survive humanized realization strongly enough.");
            } else if (phraseBreathMetrics.fit >= 0.82) {
                sectionStrengths.push("Section phrase-breath cues survive humanized realization with clear local timing contrast.");
            }
        }

        findings.push({
            sectionId: window.section.id,
            label: window.section.label,
            role: window.section.role,
            score,
            issues: sectionIssues,
            strengths: sectionStrengths,
            metrics: sectionMetrics,
        });
    }

    const globalFit = average(sectionFits);
    const globalCoverage = average(sectionCoverage);
    const globalPickup = average(pickupFits);
    const globalArrival = average(arrivalFits);
    const globalRelease = average(releaseFits);
    const globalRecovery = average(recoveryFits);
    const globalRubato = average(rubatoFits);

    if (globalFit !== undefined) {
        metrics.audioPhraseBreathPlanFit = globalFit;
        if (globalFit < 0.58) {
            issues.push("Phrase-breath cues do not survive strongly enough after humanized realization.");
        } else if (globalFit >= 0.82) {
            strengths.push("Phrase-breath cues survive humanized realization with clear local timing contrast.");
        }
    }
    if (globalCoverage !== undefined) {
        metrics.audioPhraseBreathCoverageFit = globalCoverage;
        if (globalCoverage < 0.6) {
            issues.push("Phrase-breath windows do not contain enough realized activity to read clearly.");
        }
    }
    if (globalPickup !== undefined) {
        metrics.audioPhraseBreathPickupFit = globalPickup;
    }
    if (globalArrival !== undefined) {
        metrics.audioPhraseBreathArrivalFit = globalArrival;
    }
    if (globalRelease !== undefined) {
        metrics.audioPhraseBreathReleaseFit = globalRelease;
    }
    if (globalRecovery !== undefined) {
        metrics.audioPhraseBreathRecoveryFit = globalRecovery;
    }
    if (globalRubato !== undefined) {
        metrics.audioPhraseBreathRubatoFit = globalRubato;
    }

    return {
        metrics,
        issues,
        strengths,
        ...(findings.length > 0 ? { sectionFindings: findings } : {}),
    };
}

function buildOrnamentAudioSummary(
    sectionWindows: AudioSectionWindow[],
    sectionArtifacts: SectionArtifactSummary[] | undefined,
): {
    metrics: Record<string, number>;
    issues: string[];
    strengths: string[];
    sectionFindings?: AudioSectionEvaluationFinding[];
} {
    const metrics: Record<string, number> = {};
    const issues: string[] = [];
    const strengths: string[] = [];
    const findings: AudioSectionEvaluationFinding[] = [];

    if (!sectionArtifacts?.length || sectionWindows.length === 0) {
        return { metrics, issues, strengths };
    }

    const artifactById = new Map(sectionArtifacts.map((artifact) => [artifact.sectionId, artifact]));
    const sectionFits: number[] = [];
    const sectionCoverage: number[] = [];
    const sectionHolds: number[] = [];
    const sectionArpeggios: number[] = [];
    const sectionGraces: number[] = [];
    const sectionTrills: number[] = [];
    const unsupportedTagLabels = new Set<string>();
    const unsupportedSectionIds = new Set<string>();
    let unsupportedTagCount = 0;
    let holdSectionCount = 0;
    let arpeggioSectionCount = 0;
    let graceSectionCount = 0;
    let trillSectionCount = 0;

    for (const window of sectionWindows) {
        const summary = artifactById.get(window.section.id)?.ornamentSummary;
        const explicitlyRealizedTags = summary?.explicitlyRealizedTags?.filter(Boolean) ?? [];
        const sectionUnsupportedTags = (summary?.unsupportedTags ?? [])
            .map((tag) => formatOrnamentEvidenceTag(tag))
            .filter((tag): tag is string => Boolean(tag));
        if (sectionUnsupportedTags.length > 0) {
            unsupportedSectionIds.add(window.section.id);
            unsupportedTagCount += sectionUnsupportedTags.length;
            for (const tag of sectionUnsupportedTags) {
                unsupportedTagLabels.add(tag);
            }
        }
        if (explicitlyRealizedTags.length === 0 || (summary?.targetedEventCount ?? 0) <= 0) {
            continue;
        }

        const hasHoldCue = hasExplicitOrnamentTag(explicitlyRealizedTags, "fermata");
        const hasArpeggioCue = hasExplicitOrnamentTag(explicitlyRealizedTags, "arpeggio");
        const hasGraceCue = hasExplicitOrnamentTag(explicitlyRealizedTags, "grace_note");
        const hasTrillCue = hasExplicitOrnamentTag(explicitlyRealizedTags, "trill");
        const hasOnlyHoldCue = hasHoldCue && !hasArpeggioCue && !hasGraceCue && !hasTrillCue;
        const hasOnlyArpeggioCue = hasArpeggioCue && !hasHoldCue && !hasGraceCue && !hasTrillCue;
        const hasOnlyGraceCue = hasGraceCue && !hasHoldCue && !hasArpeggioCue && !hasTrillCue;
        const hasOnlyTrillCue = hasTrillCue && !hasHoldCue && !hasArpeggioCue && !hasGraceCue;
        if (hasHoldCue) {
            holdSectionCount += 1;
        }
        if (hasArpeggioCue) {
            arpeggioSectionCount += 1;
        }
        if (hasGraceCue) {
            graceSectionCount += 1;
        }
        if (hasTrillCue) {
            trillSectionCount += 1;
        }

        const ornamentMetrics = computeOrnamentPlanFit(summary);
        const score = ornamentMetrics.fit
            ?? weightedAverage([
                { value: ornamentMetrics.coverageFit, weight: 4 },
                { value: ornamentMetrics.holdFit, weight: 3 },
                { value: ornamentMetrics.arpeggioFit, weight: 3 },
                { value: ornamentMetrics.graceFit, weight: 3 },
            ])
            ?? 0;

        const sectionIssues: string[] = [];
        const sectionStrengths: string[] = [];
        const sectionMetrics: Record<string, number> = {
            audioSectionCompositeFit: score,
        };
        if (sectionUnsupportedTags.length > 0) {
            sectionMetrics.audioUnsupportedOrnamentTagCount = sectionUnsupportedTags.length;
            sectionStrengths.push(`Section preserves unsupported ornament metadata for later realization: ${sectionUnsupportedTags.join(", ")}.`);
        }

        if (ornamentMetrics.coverageFit !== undefined) {
            sectionMetrics.audioOrnamentCoverageFit = ornamentMetrics.coverageFit;
            sectionCoverage.push(ornamentMetrics.coverageFit);
            if (ornamentMetrics.coverageFit < 0.55) {
                if (hasOnlyHoldCue) {
                    sectionIssues.push("Section ornament hold misses the targeted cadence event too often.");
                } else if (hasOnlyGraceCue) {
                    sectionIssues.push("Section grace-note cue misses the targeted melodic event too often.");
                } else if (hasOnlyArpeggioCue) {
                    sectionIssues.push("Section arpeggio cue misses the targeted chord event too often.");
                } else if (hasOnlyTrillCue) {
                    sectionIssues.push("Section trill cue misses the targeted melodic event too often.");
                } else {
                    sectionIssues.push("Section ornament cues miss their targeted events too often.");
                }
            } else if (ornamentMetrics.coverageFit >= 0.82) {
                if (hasOnlyHoldCue) {
                    sectionStrengths.push("Section ornament hold lands on the targeted cadence event after humanization.");
                } else if (hasOnlyGraceCue) {
                    sectionStrengths.push("Section grace-note cue lands on the targeted melodic event after humanization.");
                } else if (hasOnlyArpeggioCue) {
                    sectionStrengths.push("Section arpeggio cue lands on the targeted chord event after humanization.");
                } else if (hasOnlyTrillCue) {
                    sectionStrengths.push("Section trill cue lands on the targeted melodic event after humanization.");
                } else {
                    sectionStrengths.push("Section ornament cues land on their targeted events after humanization.");
                }
            }
        }
        if (ornamentMetrics.holdFit !== undefined) {
            sectionMetrics.audioOrnamentHoldFit = ornamentMetrics.holdFit;
            sectionHolds.push(ornamentMetrics.holdFit);
            if (ornamentMetrics.holdFit < 0.48) {
                sectionIssues.push("Section ornament hold does not create enough local sustain contrast.");
            }
        }
        if (ornamentMetrics.arpeggioFit !== undefined) {
            sectionMetrics.audioOrnamentArpeggioFit = ornamentMetrics.arpeggioFit;
            sectionArpeggios.push(ornamentMetrics.arpeggioFit);
            if (ornamentMetrics.arpeggioFit < 0.52) {
                sectionIssues.push("Section arpeggio sweep remains too compressed after humanized realization.");
            } else if (ornamentMetrics.arpeggioFit >= 0.82) {
                sectionStrengths.push("Section arpeggio sweep remains clearly audible after humanized realization.");
            }
        }
        if (ornamentMetrics.graceFit !== undefined) {
            sectionMetrics.audioOrnamentGraceFit = ornamentMetrics.graceFit;
            sectionGraces.push(ornamentMetrics.graceFit);
            if (ornamentMetrics.graceFit < 0.52) {
                sectionIssues.push("Section grace-note lead-in remains too compressed after humanized realization.");
            } else if (ornamentMetrics.graceFit >= 0.82) {
                sectionStrengths.push("Section grace-note lead-in remains clearly audible after humanized realization.");
            }
        }
        if (ornamentMetrics.trillFit !== undefined) {
            sectionMetrics.audioOrnamentTrillFit = ornamentMetrics.trillFit;
            sectionTrills.push(ornamentMetrics.trillFit);
            if (ornamentMetrics.trillFit < 0.52) {
                sectionIssues.push("Section trill oscillation remains too compressed after humanized realization.");
            } else if (ornamentMetrics.trillFit >= 0.82) {
                sectionStrengths.push("Section trill oscillation remains clearly audible after humanized realization.");
            }
        }
        if (ornamentMetrics.fit !== undefined) {
            sectionMetrics.audioOrnamentPlanFit = ornamentMetrics.fit;
            sectionFits.push(ornamentMetrics.fit);
            if (ornamentMetrics.fit < 0.58) {
                if (hasOnlyHoldCue) {
                    sectionIssues.push("Section ornament hold does not survive humanized realization strongly enough.");
                } else if (hasOnlyGraceCue) {
                    sectionIssues.push("Section grace-note cue does not survive humanized realization strongly enough.");
                } else if (hasOnlyArpeggioCue) {
                    sectionIssues.push("Section arpeggio cue does not survive humanized realization strongly enough.");
                } else if (hasOnlyTrillCue) {
                    sectionIssues.push("Section trill cue does not survive humanized realization strongly enough.");
                } else {
                    sectionIssues.push("Section explicit ornament cues do not survive humanized realization strongly enough.");
                }
            } else if (ornamentMetrics.fit >= 0.82) {
                if (hasOnlyHoldCue) {
                    sectionStrengths.push("Section ornament hold survives humanized realization with a clear local sustain cue.");
                } else if (hasOnlyGraceCue) {
                    sectionStrengths.push("Section grace-note cue survives humanized realization with a clear lead-in contour.");
                } else if (hasOnlyArpeggioCue) {
                    sectionStrengths.push("Section arpeggio cue survives humanized realization with a clear rolled-onset contour.");
                } else if (hasOnlyTrillCue) {
                    sectionStrengths.push("Section trill cue survives humanized realization with a clear oscillating contour.");
                } else {
                    sectionStrengths.push("Section explicit ornament cues survive humanized realization with clear local contrast.");
                }
            }
        }

        findings.push({
            sectionId: window.section.id,
            label: window.section.label,
            role: window.section.role,
            score,
            issues: sectionIssues,
            strengths: sectionStrengths,
            metrics: sectionMetrics,
        });
    }

    const globalFit = average(sectionFits);
    const globalCoverage = average(sectionCoverage);
    const globalHold = average(sectionHolds);
    const globalArpeggio = average(sectionArpeggios);
    const globalGrace = average(sectionGraces);
    const globalTrill = average(sectionTrills);

    if (globalFit !== undefined) {
        metrics.audioOrnamentPlanFit = globalFit;
        if (globalFit < 0.58) {
            if (holdSectionCount > 0 && arpeggioSectionCount === 0 && graceSectionCount === 0 && trillSectionCount === 0) {
                issues.push("Ornament hold cues do not survive strongly enough after humanized realization.");
            } else if (graceSectionCount > 0 && holdSectionCount === 0 && arpeggioSectionCount === 0 && trillSectionCount === 0) {
                issues.push("Grace-note cues do not survive strongly enough after humanized realization.");
            } else if (arpeggioSectionCount > 0 && holdSectionCount === 0 && graceSectionCount === 0 && trillSectionCount === 0) {
                issues.push("Arpeggio cues do not survive strongly enough after humanized realization.");
            } else if (trillSectionCount > 0 && holdSectionCount === 0 && arpeggioSectionCount === 0 && graceSectionCount === 0) {
                issues.push("Trill cues do not survive strongly enough after humanized realization.");
            } else {
                issues.push("Explicit ornament cues do not survive strongly enough after humanized realization.");
            }
        } else if (globalFit >= 0.82) {
            if (holdSectionCount > 0 && arpeggioSectionCount === 0 && graceSectionCount === 0 && trillSectionCount === 0) {
                strengths.push("Ornament hold cues survive humanized realization with a clear local sustain cue.");
            } else if (graceSectionCount > 0 && holdSectionCount === 0 && arpeggioSectionCount === 0 && trillSectionCount === 0) {
                strengths.push("Grace-note cues survive humanized realization with a clear lead-in contour.");
            } else if (arpeggioSectionCount > 0 && holdSectionCount === 0 && graceSectionCount === 0 && trillSectionCount === 0) {
                strengths.push("Arpeggio cues survive humanized realization with a clear rolled-onset contour.");
            } else if (trillSectionCount > 0 && holdSectionCount === 0 && arpeggioSectionCount === 0 && graceSectionCount === 0) {
                strengths.push("Trill cues survive humanized realization with a clear oscillating contour.");
            } else {
                strengths.push("Explicit ornament cues survive humanized realization with clear local contrast.");
            }
        }
    }
    if (globalCoverage !== undefined) {
        metrics.audioOrnamentCoverageFit = globalCoverage;
        if (globalCoverage < 0.6) {
            if (holdSectionCount > 0 && arpeggioSectionCount === 0 && graceSectionCount === 0 && trillSectionCount === 0) {
                issues.push("Ornament hold targets do not land on note-bearing cadence events reliably enough.");
            } else if (graceSectionCount > 0 && holdSectionCount === 0 && arpeggioSectionCount === 0 && trillSectionCount === 0) {
                issues.push("Grace-note targets do not land on note-bearing melodic events reliably enough.");
            } else if (arpeggioSectionCount > 0 && holdSectionCount === 0 && graceSectionCount === 0 && trillSectionCount === 0) {
                issues.push("Arpeggio targets do not land on note-bearing chord events reliably enough.");
            } else if (trillSectionCount > 0 && holdSectionCount === 0 && arpeggioSectionCount === 0 && graceSectionCount === 0) {
                issues.push("Trill targets do not land on note-bearing melodic events reliably enough.");
            } else {
                issues.push("Explicit ornament targets do not land on note-bearing events reliably enough.");
            }
        }
    }
    if (globalHold !== undefined) {
        metrics.audioOrnamentHoldFit = globalHold;
    }
    if (globalArpeggio !== undefined) {
        metrics.audioOrnamentArpeggioFit = globalArpeggio;
    }
    if (globalGrace !== undefined) {
        metrics.audioOrnamentGraceFit = globalGrace;
    }
    if (globalTrill !== undefined) {
        metrics.audioOrnamentTrillFit = globalTrill;
    }
    if (unsupportedSectionIds.size > 0) {
        metrics.audioUnsupportedOrnamentSectionCount = unsupportedSectionIds.size;
    }
    if (unsupportedTagCount > 0) {
        metrics.audioUnsupportedOrnamentTagCount = unsupportedTagCount;
    }
    if (unsupportedTagLabels.size > 0) {
        strengths.push(`Unsupported ornament tags remain preserved as structured metadata for later realization: ${[...unsupportedTagLabels].sort((left, right) => left.localeCompare(right)).join(", ")}.`);
    }

    return {
        metrics,
        issues,
        strengths,
        ...(findings.length > 0 ? { sectionFindings: findings } : {}),
    };
}

function analyzeNarrativeSignal(
    filePath: string | undefined,
    label: string,
    sectionWindows: AudioSectionWindow[],
): NarrativeSignalAnalysis | null {
    const signal = readWavSignal(filePath);
    if (!signal || sectionWindows.length === 0) {
        return null;
    }

    const totalMeasures = sectionWindows[sectionWindows.length - 1]?.endMeasure ?? 0;
    if (totalMeasures <= 0 || signal.durationSec <= 0) {
        return null;
    }

    const sectionStats = new Map<string, SectionSignalStats>();
    for (const window of sectionWindows) {
        const startSec = (window.startMeasure / totalMeasures) * signal.durationSec;
        const endSec = (window.endMeasure / totalMeasures) * signal.durationSec;
        const stats = computeSectionSignalStats(signal, startSec, endSec);
        if (stats) {
            sectionStats.set(window.section.id, stats);
        }
    }

    return sectionStats.size > 0 ? { label, sectionStats } : null;
}

function scoreDevelopmentAudioFit(
    sourceStats: SectionSignalStats,
    currentStats: SectionSignalStats,
    structuralPrior: number,
): number {
    const contrastLift = clamp((currentStats.rms - sourceStats.rms + 0.02) / 0.12, 0, 1);
    const fluxLift = clamp((currentStats.flux - sourceStats.flux + 0.006) / 0.045, 0, 1);
    const peakLift = clamp((currentStats.peak - sourceStats.peak + 0.02) / 0.12, 0, 1);
    return Number((
        (clamp(structuralPrior, 0, 1) * 0.45)
        + (contrastLift * 0.3)
        + (fluxLift * 0.15)
        + (peakLift * 0.1)
    ).toFixed(4));
}

function scoreRecapAudioFit(
    sourceStats: SectionSignalStats,
    currentStats: SectionSignalStats,
    developmentStats: SectionSignalStats | undefined,
    structuralPrior: number,
): number {
    const rmsReturn = 1 - clamp(Math.abs(currentStats.rms - sourceStats.rms) / 0.08, 0, 1);
    const fluxReturn = 1 - clamp(Math.abs(currentStats.flux - sourceStats.flux) / 0.035, 0, 1);
    const releaseLift = developmentStats
        ? clamp((developmentStats.rms - currentStats.rms + 0.015) / 0.1, 0, 1)
        : 0.5;
    const dynamicCeiling = Math.max(sourceStats.rms, developmentStats?.rms ?? sourceStats.rms);
    const overshootFit = 1 - clamp(Math.max(0, currentStats.rms - dynamicCeiling) / 0.08, 0, 1);

    return Number((
        (clamp(structuralPrior, 0, 1) * 0.35)
        + (rmsReturn * 0.22)
        + (fluxReturn * 0.13)
        + (releaseLift * 0.15)
        + (overshootFit * 0.15)
    ).toFixed(4));
}

function scoreAudioTonalReturnFit(
    recapTonalPrior: number,
    recapAudioFit: number | undefined,
    recapChromaFit: number | undefined,
    consistency: number | undefined,
): number {
    const narrativeReturn = recapAudioFit ?? 0.5;
    if (recapChromaFit !== undefined) {
        const tonalAnchor = recapChromaFit;
        const boundedPrior = Math.min(clamp(recapTonalPrior, 0, 1), tonalAnchor);
        return Number((
            (tonalAnchor * 0.75)
            + (narrativeReturn * 0.1)
            + (boundedPrior * 0.1)
            + ((consistency ?? 0.5) * 0.05)
        ).toFixed(4));
    }

    const boundedPrior = Math.min(clamp(recapTonalPrior, 0, 1), narrativeReturn);
    return Number((
        (narrativeReturn * 0.75)
        + (boundedPrior * 0.2)
        + ((consistency ?? 0.5) * 0.05)
    ).toFixed(4));
}

function scoreAudioHarmonicRouteFit(
    harmonicRoutePrior: number,
    developmentAudioFit: number | undefined,
    recapAudioFit: number | undefined,
    chromaRouteFit: number | undefined,
    consistency: number | undefined,
): number {
    const audioAverage = average([
        average([developmentAudioFit, recapAudioFit].filter((value): value is number => value !== undefined)),
        chromaRouteFit,
    ].filter((value): value is number => value !== undefined)) ?? 0.5;
    const boundedPrior = Math.min(clamp(harmonicRoutePrior, 0, 1), audioAverage);
    return Number((
        (audioAverage * 0.7)
        + (boundedPrior * 0.2)
        + ((consistency ?? 0.5) * 0.1)
    ).toFixed(4));
}

function scoreDevelopmentPitchClassRoute(
    sourceChroma: SectionChromaStats | undefined,
    currentChroma: SectionChromaStats,
    expectedTonality: string | undefined,
    homeTonality: string | undefined,
): number {
    const expected = parseTonalCenter(expectedTonality);
    const home = parseTonalCenter(homeTonality);
    const expectedFit = scoreExpectedTonalityFit(currentChroma, expectedTonality) ?? 0.5;
    const lateDriftPoints = currentChroma.driftPoints.slice(
        Math.max(0, currentChroma.driftPoints.length - Math.max(1, Math.ceil(currentChroma.driftPoints.length / 3))),
    );
    const lateDriftTargetFit = lateDriftPoints.length > 0
        ? average(lateDriftPoints.map((point) => (
            scoreExpectedTonalityFitFromObservation(point.chroma, point.dominantPitchClass, point.estimatedKey, expectedTonality) ?? expectedFit
        ))) ?? expectedFit
        : expectedFit;
    const sourceContrast = sourceChroma
        ? 1 - (scoreEstimatedKeyFit(currentChroma, sourceChroma.estimatedKey) ?? 0.5)
        : 0.5;
    const homeFit = scoreExpectedTonalityFit(currentChroma, homeTonality) ?? 0.5;
    const modulationLift = expected && home && (expected.tonicPitchClass !== home.tonicPitchClass || expected.mode !== home.mode)
        ? 1 - homeFit
        : 0.5;
    const driftDeparture = currentChroma.driftPoints.length > 0
        ? Math.max(...currentChroma.driftPoints.map((point) => 1 - (
            scoreExpectedTonalityFitFromObservation(point.chroma, point.dominantPitchClass, point.estimatedKey, homeTonality) ?? homeFit
        )))
        : modulationLift;
    const driftVariety = currentChroma.driftPoints.length > 0
        ? clamp((collapseConsecutiveLabels(currentChroma.driftPoints.map((point) => point.estimatedKey.label)).length - 1) / Math.max(currentChroma.driftPoints.length - 1, 1), 0, 1)
        : 0.5;

    return Number((
        (expectedFit * 0.15)
        + (lateDriftTargetFit * 0.35)
        + (sourceContrast * 0.15)
        + (Math.max(modulationLift, driftDeparture) * 0.15)
        + (driftVariety * 0.1)
        + (currentChroma.estimatedKey.confidence * 0.1)
    ).toFixed(4));
}

function scoreRecapPitchClassReturn(
    sourceChroma: SectionChromaStats | undefined,
    currentChroma: SectionChromaStats,
    developmentChroma: SectionChromaStats | undefined,
    expectedTonality: string | undefined,
    homeTonality: string | undefined,
): number {
    const targetTonality = expectedTonality ?? homeTonality;
    const expectedFit = scoreExpectedTonalityFit(currentChroma, targetTonality) ?? 0.5;
    const sourceReturn = sourceChroma
        ? scoreEstimatedKeyFit(currentChroma, sourceChroma.estimatedKey) ?? 0.5
        : 0.5;
    const developmentRelease = developmentChroma
        ? 1 - (scoreEstimatedKeyFit(currentChroma, developmentChroma.estimatedKey) ?? 0.5)
        : 0.5;

    return Number((
        (expectedFit * 0.45)
        + (sourceReturn * 0.25)
        + (developmentRelease * 0.15)
        + (currentChroma.estimatedKey.confidence * 0.15)
    ).toFixed(4));
}

function summarizeNarrativeAudioMetrics(
    artifacts: ArtifactPaths,
    options: AudioEvaluationOptions | undefined,
): {
    metrics: Record<string, number>;
    issues: string[];
    strengths: string[];
    narrativeScore: number;
    longSpan?: AudioLongSpanEvaluationSummary;
    keyTracking?: AudioKeyTrackingReport;
    sectionFindings?: AudioSectionEvaluationFinding[];
    weakestSections?: AudioSectionEvaluationFinding[];
} {
    const metrics: Record<string, number> = {};
    const issues: string[] = [];
    const strengths: string[] = [];
    const structureEvaluation = options?.structureEvaluation;
    const sectionWindows = buildAudioSectionWindows(options?.sections);
    const sectionTonalities = buildTonalityMap(options?.sections, options?.sectionTonalities);
    const sectionAccumulators = new Map<string, AudioSectionNarrativeAccumulator>();
    const phraseBreathSummary = buildPhraseBreathAudioSummary(sectionWindows, options?.sectionArtifacts);
    const tempoMotionSummary = buildTempoMotionAudioSummary(sectionWindows, options?.sectionArtifacts);
    const harmonicRealizationSummary = buildHarmonicRealizationAudioSummary(sectionWindows, options?.sectionArtifacts);
    const ornamentSummary = buildOrnamentAudioSummary(sectionWindows, options?.sectionArtifacts);
    const cueSectionSummary = mergeAudioSectionFindingCollections(
        mergeAudioSectionFindingCollections(
            mergeAudioSectionFindingCollections(
                phraseBreathSummary.sectionFindings,
                tempoMotionSummary.sectionFindings,
            ).sectionFindings,
            harmonicRealizationSummary.sectionFindings,
        ).sectionFindings,
        ornamentSummary.sectionFindings,
    );
    const cueMetrics = {
        ...phraseBreathSummary.metrics,
        ...tempoMotionSummary.metrics,
        ...harmonicRealizationSummary.metrics,
        ...ornamentSummary.metrics,
    };
    const cueIssues = [...phraseBreathSummary.issues];
    for (const issue of tempoMotionSummary.issues) {
        pushUnique(cueIssues, issue);
    }
    for (const issue of harmonicRealizationSummary.issues) {
        pushUnique(cueIssues, issue);
    }
    for (const issue of ornamentSummary.issues) {
        pushUnique(cueIssues, issue);
    }
    const cueStrengths = [...phraseBreathSummary.strengths];
    for (const strength of tempoMotionSummary.strengths) {
        pushUnique(cueStrengths, strength);
    }
    for (const strength of harmonicRealizationSummary.strengths) {
        pushUnique(cueStrengths, strength);
    }
    for (const strength of ornamentSummary.strengths) {
        pushUnique(cueStrengths, strength);
    }

    if (!structureEvaluation || sectionWindows.length === 0) {
        return {
            metrics: {
                ...metrics,
                ...cueMetrics,
            },
            issues: [...cueIssues],
            strengths: [...cueStrengths],
            narrativeScore: 0,
            longSpan: buildAudioLongSpanEvaluationSummary({
                ...metrics,
                ...cueMetrics,
            }, structureEvaluation),
            sectionFindings: cueSectionSummary.sectionFindings,
            weakestSections: cueSectionSummary.weakestSections,
        };
    }

    const hasNarrativeSections = sectionWindows.some((window) => (
        window.section.role === "development" || window.section.role === "recap"
    ));
    if (!hasNarrativeSections) {
        return {
            metrics: {
                ...metrics,
                ...cueMetrics,
            },
            issues: [...cueIssues],
            strengths: [...cueStrengths],
            narrativeScore: 0,
            longSpan: buildAudioLongSpanEvaluationSummary({
                ...metrics,
                ...cueMetrics,
            }, structureEvaluation),
            sectionFindings: cueSectionSummary.sectionFindings,
            weakestSections: cueSectionSummary.weakestSections,
        };
    }

    const analyses: NarrativeSignalAnalysis[] = [];
    const chromaAnalyses: NarrativeChromaAnalysis[] = [];
    const seenPaths = new Set<string>();
    const analysisSources: Array<[AudioKeyAnalysisSource, string | undefined]> = [
        ["rendered", artifacts.renderedAudio],
        ["styled", artifacts.styledAudio],
        ["primary", artifacts.audio],
    ];

    for (const [label, filePath] of analysisSources) {
        const normalized = String(filePath ?? "").trim();
        if (!normalized || seenPaths.has(normalized)) {
            continue;
        }

        const analysis = analyzeNarrativeSignal(normalized, label, sectionWindows);
        if (analysis) {
            analyses.push(analysis);
        }

        const chromaAnalysis = analyzeNarrativeChroma(normalized, label, sectionWindows);
        if (chromaAnalysis) {
            chromaAnalyses.push(chromaAnalysis);
        }

        if (analysis || chromaAnalysis) {
            seenPaths.add(normalized);
        }
    }

    if (analyses.length === 0 && chromaAnalyses.length === 0) {
        return {
            metrics: {
                ...metrics,
                ...cueMetrics,
            },
            issues: [...cueIssues],
            strengths: [...cueStrengths],
            narrativeScore: 0,
            longSpan: buildAudioLongSpanEvaluationSummary({
                ...metrics,
                ...cueMetrics,
            }, structureEvaluation),
            sectionFindings: cueSectionSummary.sectionFindings,
            weakestSections: cueSectionSummary.weakestSections,
        };
    }

    const developmentScores: number[] = [];
    const recapScores: number[] = [];
    const perAnalysisDevelopment: number[] = [];
    const perAnalysisRecap: number[] = [];
    const chromaDevelopmentScores: number[] = [];
    const chromaRecapScores: number[] = [];
    const keyDriftScores: number[] = [];
    const perAnalysisChromaDevelopment: number[] = [];
    const perAnalysisChromaRecap: number[] = [];
    const perAnalysisKeyDrift: number[] = [];
    const developmentPrior = Number(structureEvaluation.metrics?.developmentNarrativeFit ?? 0.5);
    const recapPrior = Number(structureEvaluation.metrics?.recapRecallFit ?? 0.5);
    const harmonicRoutePrior = average([
        Number(structureEvaluation.metrics?.harmonicModulationStrength ?? NaN),
        Number(structureEvaluation.metrics?.dominantPreparationStrength ?? NaN),
        Number(structureEvaluation.metrics?.recapTonalReturnStrength ?? NaN),
        Number(structureEvaluation.metrics?.globalHarmonicProgressionStrength ?? NaN),
    ].filter((value) => Number.isFinite(value))) ?? 0.5;
    const recapTonalPrior = Number(structureEvaluation.metrics?.recapTonalReturnStrength ?? harmonicRoutePrior);
    const homeSection = sectionWindows.find((window) => window.section.role === "theme_a")
        ?? sectionWindows.find((window) => window.section.role === "theme_b")
        ?? sectionWindows[0];
    const homeTonality = homeSection ? sectionTonalities.get(homeSection.section.id) : undefined;
    const keyTracking = buildAudioKeyTracking(chromaAnalyses[0], sectionWindows, sectionTonalities, homeTonality);

    for (const analysis of analyses) {
        const localDevelopmentScores: number[] = [];
        const localRecapScores: number[] = [];

        for (const sectionWindow of sectionWindows) {
            if (sectionWindow.section.role !== "development" && sectionWindow.section.role !== "recap") {
                continue;
            }

            const sourceSection = resolveNarrativeSourceSection(sectionWindow, sectionWindows);
            if (!sourceSection) {
                continue;
            }

            const sourceStats = analysis.sectionStats.get(sourceSection.section.id);
            const currentStats = analysis.sectionStats.get(sectionWindow.section.id);
            if (!sourceStats || !currentStats) {
                continue;
            }

            const accumulator = getOrCreateAudioSectionAccumulator(
                sectionAccumulators,
                sectionWindow,
                sourceSection.section.id,
                sectionTonalities.get(sectionWindow.section.id),
            );

            if (sectionWindow.section.role === "development") {
                const score = scoreDevelopmentAudioFit(sourceStats, currentStats, developmentPrior);
                localDevelopmentScores.push(score);
                accumulator.narrativeFits.push(score);
                continue;
            }

            const priorDevelopment = resolvePreviousRoleSection(sectionWindow, sectionWindows, "development");
            const developmentStats = priorDevelopment
                ? analysis.sectionStats.get(priorDevelopment.section.id)
                : undefined;
            const score = scoreRecapAudioFit(sourceStats, currentStats, developmentStats, recapPrior);
            localRecapScores.push(score);
            accumulator.narrativeFits.push(score);
        }

        const developmentAverage = average(localDevelopmentScores);
        const recapAverage = average(localRecapScores);

        if (developmentAverage !== undefined) {
            metrics[`${analysis.label}DevelopmentNarrativeFit`] = developmentAverage;
            developmentScores.push(developmentAverage);
            perAnalysisDevelopment.push(developmentAverage);
        }
        if (recapAverage !== undefined) {
            metrics[`${analysis.label}RecapRecallFit`] = recapAverage;
            recapScores.push(recapAverage);
            perAnalysisRecap.push(recapAverage);
        }
    }

    for (const analysis of chromaAnalyses) {
        const localDevelopmentScores: number[] = [];
        const localRecapScores: number[] = [];
        const localDevelopmentDriftScores: number[] = [];

        for (const sectionWindow of sectionWindows) {
            if (sectionWindow.section.role !== "development" && sectionWindow.section.role !== "recap") {
                continue;
            }

            const currentChroma = analysis.sectionChromas.get(sectionWindow.section.id);
            if (!currentChroma) {
                continue;
            }

            const sourceSection = resolveNarrativeSourceSection(sectionWindow, sectionWindows);
            const sourceChroma = sourceSection
                ? analysis.sectionChromas.get(sourceSection.section.id)
                : undefined;
            const sourceTonality = sourceSection
                ? sectionTonalities.get(sourceSection.section.id)
                : homeTonality;
            const expectedTonality = sectionTonalities.get(sectionWindow.section.id);
            const accumulator = getOrCreateAudioSectionAccumulator(
                sectionAccumulators,
                sectionWindow,
                sourceSection?.section.id,
                expectedTonality,
            );

            if (sectionWindow.section.role === "development") {
                const score = scoreDevelopmentPitchClassRoute(
                    sourceChroma,
                    currentChroma,
                    expectedTonality,
                    homeTonality,
                );
                localDevelopmentScores.push(score);
                accumulator.pitchClassFits.push(score);
                const driftFit = scoreDevelopmentKeyDriftPath(
                    currentChroma.driftPoints,
                    expectedTonality,
                    sourceTonality,
                    homeTonality,
                );
                if (driftFit !== undefined) {
                    localDevelopmentDriftScores.push(driftFit);
                    accumulator.keyDriftFits.push(driftFit);
                }
                continue;
            }

            const priorDevelopment = resolvePreviousRoleSection(sectionWindow, sectionWindows, "development");
            const developmentChroma = priorDevelopment
                ? analysis.sectionChromas.get(priorDevelopment.section.id)
                : undefined;
            const score = scoreRecapPitchClassReturn(
                sourceChroma,
                currentChroma,
                developmentChroma,
                expectedTonality,
                homeTonality,
            );
            localRecapScores.push(score);
            accumulator.pitchClassFits.push(score);
        }

        const developmentAverage = average(localDevelopmentScores);
        const recapAverage = average(localRecapScores);
        const developmentDriftAverage = average(localDevelopmentDriftScores);

        if (developmentAverage !== undefined) {
            metrics[`${analysis.label}DevelopmentPitchClassRouteFit`] = developmentAverage;
            chromaDevelopmentScores.push(developmentAverage);
            perAnalysisChromaDevelopment.push(developmentAverage);
        }
        if (recapAverage !== undefined) {
            metrics[`${analysis.label}RecapPitchClassReturnFit`] = recapAverage;
            chromaRecapScores.push(recapAverage);
            perAnalysisChromaRecap.push(recapAverage);
        }
        if (developmentDriftAverage !== undefined) {
            metrics[`${analysis.label}DevelopmentKeyDriftFit`] = developmentDriftAverage;
            keyDriftScores.push(developmentDriftAverage);
            perAnalysisKeyDrift.push(developmentDriftAverage);
        }
    }

    const audioDevelopmentNarrativeFit = average(developmentScores);
    const audioRecapRecallFit = average(recapScores);
    if (audioDevelopmentNarrativeFit !== undefined) {
        metrics.audioDevelopmentNarrativeFit = audioDevelopmentNarrativeFit;
    }
    if (audioRecapRecallFit !== undefined) {
        metrics.audioRecapRecallFit = audioRecapRecallFit;
    }

    const consistencyChecks: number[] = [];
    if (perAnalysisDevelopment.length >= 2) {
        consistencyChecks.push(1 - clamp(Math.abs(perAnalysisDevelopment[0] - perAnalysisDevelopment[1]) / 0.28, 0, 1));
    }
    if (perAnalysisRecap.length >= 2) {
        consistencyChecks.push(1 - clamp(Math.abs(perAnalysisRecap[0] - perAnalysisRecap[1]) / 0.28, 0, 1));
    }
    const audioNarrativeRenderConsistency = average(consistencyChecks);
    if (audioNarrativeRenderConsistency !== undefined) {
        metrics.audioNarrativeRenderConsistency = audioNarrativeRenderConsistency;
    }

    const audioDevelopmentPitchClassRouteFit = average(chromaDevelopmentScores);
    const audioChromaTonalReturnFit = average(chromaRecapScores);
    const audioDevelopmentKeyDriftFit = average(keyDriftScores);
    const chromaConsistencyChecks: number[] = [];
    if (perAnalysisChromaDevelopment.length >= 2) {
        chromaConsistencyChecks.push(1 - clamp(Math.abs(perAnalysisChromaDevelopment[0] - perAnalysisChromaDevelopment[1]) / 0.24, 0, 1));
    }
    if (perAnalysisChromaRecap.length >= 2) {
        chromaConsistencyChecks.push(1 - clamp(Math.abs(perAnalysisChromaRecap[0] - perAnalysisChromaRecap[1]) / 0.24, 0, 1));
    }
    if (perAnalysisKeyDrift.length >= 2) {
        chromaConsistencyChecks.push(1 - clamp(Math.abs(perAnalysisKeyDrift[0] - perAnalysisKeyDrift[1]) / 0.24, 0, 1));
    }
    const audioPitchClassRenderConsistency = average(chromaConsistencyChecks);
    if (audioDevelopmentPitchClassRouteFit !== undefined) {
        metrics.audioDevelopmentPitchClassRouteFit = audioDevelopmentPitchClassRouteFit;
    }
    if (audioChromaTonalReturnFit !== undefined) {
        metrics.audioChromaTonalReturnFit = audioChromaTonalReturnFit;
    }
    if (audioDevelopmentKeyDriftFit !== undefined) {
        metrics.audioDevelopmentKeyDriftFit = audioDevelopmentKeyDriftFit;
    }
    if (audioPitchClassRenderConsistency !== undefined) {
        metrics.audioPitchClassRenderConsistency = audioPitchClassRenderConsistency;
    }

    const chromaRouteAverage = average([
        audioDevelopmentPitchClassRouteFit,
        audioChromaTonalReturnFit,
        audioDevelopmentKeyDriftFit,
    ].filter((value): value is number => value !== undefined));
    const boundedPitchClassConsistency = chromaRouteAverage !== undefined
        ? Math.min(audioPitchClassRenderConsistency ?? chromaRouteAverage, chromaRouteAverage)
        : undefined;
    const audioChromaHarmonicRouteFit = chromaRouteAverage !== undefined
        ? Number(((chromaRouteAverage * 0.85) + ((boundedPitchClassConsistency ?? chromaRouteAverage) * 0.15)).toFixed(4))
        : undefined;
    if (audioChromaHarmonicRouteFit !== undefined) {
        metrics.audioChromaHarmonicRouteFit = audioChromaHarmonicRouteFit;
    }

    const combinedRenderConsistency = average([
        audioNarrativeRenderConsistency,
        audioPitchClassRenderConsistency,
    ].filter((value): value is number => value !== undefined));

    const audioTonalReturnRenderFit = scoreAudioTonalReturnFit(
        recapTonalPrior,
        audioRecapRecallFit,
        audioChromaTonalReturnFit,
        combinedRenderConsistency,
    );
    metrics.audioTonalReturnRenderFit = audioTonalReturnRenderFit;

    const audioHarmonicRouteRenderFit = scoreAudioHarmonicRouteFit(
        harmonicRoutePrior,
        audioDevelopmentNarrativeFit,
        audioRecapRecallFit,
        audioChromaHarmonicRouteFit,
        combinedRenderConsistency,
    );
    metrics.audioHarmonicRouteRenderFit = audioHarmonicRouteRenderFit;

    if (audioDevelopmentNarrativeFit !== undefined) {
        if (audioDevelopmentNarrativeFit >= 0.62) {
            strengths.push("Rendered audio supports the development's narrative escalation.");
        } else if (audioDevelopmentNarrativeFit < 0.45) {
            issues.push("Rendered audio does not clearly escalate the development section against its source theme.");
        }
    }

    if (audioRecapRecallFit !== undefined) {
        if (audioRecapRecallFit >= 0.62) {
            strengths.push("Rendered audio supports the recap's return and release.");
        } else if (audioRecapRecallFit < 0.5) {
            issues.push("Rendered audio does not clearly support the recap's thematic return and release.");
        }
    }

    if (audioNarrativeRenderConsistency !== undefined) {
        if (audioNarrativeRenderConsistency >= 0.72) {
            strengths.push("Rendered and styled audio agree on the planned long-form contour.");
        } else if (audioNarrativeRenderConsistency < 0.48) {
            issues.push("Rendered and styled audio disagree on the planned development or recap contour.");
        }
    }

    if (audioChromaHarmonicRouteFit !== undefined) {
        if (audioChromaHarmonicRouteFit >= 0.64) {
            strengths.push("Rendered audio chroma key-profile estimates track the planned modulation and return.");
        } else if (audioChromaHarmonicRouteFit < 0.5) {
            issues.push("Rendered audio chroma key-profile estimates do not follow the planned modulation and return.");
        }
    }

    if (audioChromaTonalReturnFit !== undefined) {
        if (audioChromaTonalReturnFit >= 0.66) {
            strengths.push("Rendered audio chroma key-profile estimates return to the planned tonic and mode in the recap.");
        } else if (audioChromaTonalReturnFit < 0.52) {
            issues.push("Rendered audio chroma key-profile estimates miss the planned tonal return in the recap.");
        }
    }

    if (audioDevelopmentKeyDriftFit !== undefined) {
        if (audioDevelopmentKeyDriftFit >= 0.62) {
            strengths.push("Rendered audio key drift inside the development traces the planned modulation path.");
        } else if (audioDevelopmentKeyDriftFit < 0.48) {
            issues.push("Rendered audio key drift inside the development does not trace a clear modulation path.");
        }
    }

    if (harmonicRoutePrior >= 0.62) {
        if (audioHarmonicRouteRenderFit >= 0.68) {
            strengths.push("Rendered audio preserves the planned piece-level harmonic route across modulation and return.");
        } else if (audioHarmonicRouteRenderFit < 0.54) {
            issues.push("Rendered audio blurs the planned harmonic route across modulation and return.");
        }
    }

    if (recapTonalPrior >= 0.66) {
        if (audioTonalReturnRenderFit >= 0.7) {
            strengths.push("Rendered audio keeps the recap's tonal return grounded.");
        } else if (audioTonalReturnRenderFit < 0.56) {
            issues.push("Rendered audio collapses the planned tonal return in the recap or closing section.");
        }
    }

    const narrativeComponents = [audioDevelopmentNarrativeFit, audioRecapRecallFit].filter((value): value is number => value !== undefined);
    const narrativeAverage = average(narrativeComponents) ?? 0;
    const harmonicRouteBonus = (
        (harmonicRoutePrior >= 0.62 ? audioHarmonicRouteRenderFit * 2 : 0)
        + (recapTonalPrior >= 0.66 ? audioTonalReturnRenderFit * 2 : 0)
    );
    const narrativeScore = Math.round(
        (narrativeAverage * 16)
        + ((audioNarrativeRenderConsistency ?? 0) * 4)
        + harmonicRouteBonus
    );
    metrics.narrativeScore = narrativeScore;

    const sectionNarrativeSummary = buildAudioSectionFindings(sectionWindows, sectionAccumulators);
    const mergedSectionSummary = mergeAudioSectionFindingCollections(
        sectionNarrativeSummary.sectionFindings,
        cueSectionSummary.sectionFindings,
    );
    for (const issue of cueIssues) {
        pushUnique(issues, issue);
    }
    for (const strength of cueStrengths) {
        pushUnique(strengths, strength);
    }

    const summaryMetrics = {
        ...metrics,
        ...cueMetrics,
    };

    return {
        metrics: summaryMetrics,
        issues,
        strengths,
        narrativeScore,
        longSpan: buildAudioLongSpanEvaluationSummary(summaryMetrics, structureEvaluation),
        keyTracking,
        sectionFindings: mergedSectionSummary.sectionFindings,
        weakestSections: mergedSectionSummary.weakestSections,
    };
}

function scoreDuration(actualDurationSec: number | undefined, expectedDurationSec: number | undefined): number {
    if (!actualDurationSec || !expectedDurationSec || expectedDurationSec <= 0) {
        return 0;
    }

    const ratio = actualDurationSec / expectedDurationSec;
    const delta = Math.abs(1 - ratio);
    if (delta <= 0.1) {
        return 25;
    }
    if (delta <= 0.2) {
        return 18;
    }
    if (delta <= 0.35) {
        return 10;
    }
    if (delta <= 0.5) {
        return 4;
    }
    return 0;
}

function scoreAudioDensity(sizeBytes: number | undefined, durationSec: number | undefined): number {
    if (!sizeBytes || !durationSec || durationSec <= 0) {
        return 0;
    }

    const bytesPerSecond = sizeBytes / durationSec;
    if (bytesPerSecond >= 48_000) {
        return 15;
    }
    if (bytesPerSecond >= 24_000) {
        return 10;
    }
    if (bytesPerSecond >= 12_000) {
        return 5;
    }
    return 0;
}

export function buildStructureEvaluation(result: CritiqueResult, options?: StructureEvaluationOptions): StructureEvaluationReport {
    const enriched = enrichStructureEvaluationFromArtifacts(result, options);

    return {
        passed: result.pass,
        score: enriched.score,
        issues: enriched.issues,
        strengths: enriched.strengths,
        metrics: enriched.metrics,
        ...(enriched.longSpan ? { longSpan: enriched.longSpan } : {}),
        ...(enriched.orchestration ? { orchestration: enriched.orchestration } : {}),
        ...(enriched.sectionFindings?.length ? {
            sectionFindings: enriched.sectionFindings,
        } : {}),
        ...(enriched.weakestSections?.length ? {
            weakestSections: enriched.weakestSections,
        } : {}),
    };
}

export function buildAudioEvaluation(
    artifacts: ArtifactPaths,
    workflow: ComposeWorkflow,
    options?: AudioEvaluationOptions,
): AudioEvaluationReport {
    const issues: string[] = [];
    const strengths: string[] = [];
    let expectedChecks = 0;
    let passedChecks = 0;

    const primaryAudio = checkFile(artifacts.audio);
    expectedChecks += 1;
    if (primaryAudio.exists) {
        passedChecks += 1;
        strengths.push("Primary audio artifact is present.");
    } else {
        issues.push("Primary audio artifact is missing or empty.");
    }

    const renderedAudio = checkFile(artifacts.renderedAudio);
    const styledAudio = checkFile(artifacts.styledAudio);
    const primaryDurationSec = readWavDurationSec(artifacts.audio);
    const durationScore = scoreDuration(primaryDurationSec, options?.expectedDurationSec);
    const densityScore = scoreAudioDensity(primaryAudio.sizeBytes, primaryDurationSec);
    const narrativeSummary = summarizeNarrativeAudioMetrics(artifacts, options);

    if (workflow === "symbolic_only") {
        if (primaryAudio.exists && artifacts.scoreImage) {
            strengths.push("Symbolic render produced score and audio preview artifacts.");
        }
    }

    if (workflow === "symbolic_plus_audio") {
        expectedChecks += 2;
        if (renderedAudio.exists) {
            passedChecks += 1;
            strengths.push("Rendered MIDI preview audio is available.");
        } else {
            issues.push("Rendered symbolic preview audio is missing for symbolic_plus_audio workflow.");
        }

        if (styledAudio.exists) {
            passedChecks += 1;
            strengths.push("Styled audio render is available.");
        } else {
            issues.push("Styled audio render is missing for symbolic_plus_audio workflow.");
        }
    }

    if (workflow === "audio_only" && primaryAudio.exists) {
        strengths.push("Audio-only generation produced a playable output.");
        if (durationScore >= 18) {
            strengths.push("Audio-only render landed close to the requested duration.");
        }
        if (densityScore >= 10) {
            strengths.push("Audio-only render has enough encoded signal density to avoid sounding truncated.");
        }
    }

    if (workflow === "audio_only" && options?.expectedDurationSec && primaryAudio.exists && durationScore === 0) {
        issues.push(`Audio duration diverges too far from requested length ${options.expectedDurationSec}s.`);
    }

    const completenessScore = Math.round((passedChecks / Math.max(expectedChecks, 1)) * 60);
    const score = Math.min(100, completenessScore + durationScore + densityScore + narrativeSummary.narrativeScore);

    return {
        passed: issues.length + narrativeSummary.issues.length === 0,
        score,
        issues: [...issues, ...narrativeSummary.issues],
        strengths: [...strengths, ...narrativeSummary.strengths],
        metrics: {
            expectedChecks,
            passedChecks,
            primaryAudioBytes: primaryAudio.sizeBytes ?? 0,
            primaryDurationSec: primaryDurationSec ?? 0,
            renderedAudioBytes: renderedAudio.sizeBytes ?? 0,
            styledAudioBytes: styledAudio.sizeBytes ?? 0,
            durationScore,
            densityScore,
            ...narrativeSummary.metrics,
        },
        ...(narrativeSummary.longSpan ? { longSpan: narrativeSummary.longSpan } : {}),
        sectionFindings: narrativeSummary.sectionFindings,
        weakestSections: narrativeSummary.weakestSections,
        keyTracking: narrativeSummary.keyTracking,
    };
}