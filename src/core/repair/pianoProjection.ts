import type { SectionArtifactSummary, SectionRenderEventArtifact } from "../pipeline/types.js";

// pianoProjection.ts — Piano-specific evidence projection
// ─────────────────────────────────────────────────────────────────────────────
// Computes the 21 flat `piano*` fields on SectionArtifactSummary from
// available event arrays and pianoVoiceLayout metadata.
//
// Key design rule: evaluators must never have to choose between "sounds good in
// rendered MIDI" and "is actually playable on a piano keyboard". These fields
// make that distinction explicit and measurable.
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minor 13th — absolute hard ceiling for a hand span (semitones). */
const UNPLAYABLE_SPAN = 19;
/** Major 9th — large span, awkward but possible for larger hands. */
const AWKWARD_SPAN = 14;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Collects every MIDI pitch value present in an event array. */
function collectAllPitches(events: SectionRenderEventArtifact[]): number[] {
    const out: number[] = [];
    for (const ev of events) {
        if (ev.pitch != null) out.push(ev.pitch);
        if (ev.pitches) out.push(...ev.pitches);
    }
    return out;
}

/** Returns the representative (lowest) pitch for each non-rest event. */
function collectRepresentativePitchSequence(events: SectionRenderEventArtifact[]): number[] {
    const out: number[] = [];
    for (const ev of events) {
        if (ev.type === "rest") continue;
        if (ev.pitch != null) {
            out.push(ev.pitch);
        } else if (ev.pitches && ev.pitches.length > 0) {
            out.push(Math.min(...ev.pitches));
        }
    }
    return out;
}

/** Computes absolute semitone intervals between consecutive pitches. */
function computeIntervals(seq: number[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < seq.length; i++) {
        out.push(Math.abs(seq[i] - seq[i - 1]));
    }
    return out;
}

function arrayMin(arr: number[]): number | undefined {
    return arr.length === 0 ? undefined : Math.min(...arr);
}
function arrayMax(arr: number[]): number | undefined {
    return arr.length === 0 ? undefined : Math.max(...arr);
}
function arrayMean(arr: number[]): number | undefined {
    if (arr.length === 0) return undefined;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ---------------------------------------------------------------------------
// Per-hand analysis
// ---------------------------------------------------------------------------

interface HandAnalysis {
    pitchMin: number | undefined;
    pitchMax: number | undefined;
    /** Non-rest events per measure. */
    density: number;
    leapMax: number | undefined;
    leapAverage: number | undefined;
    /** Fraction of consecutive intervals that are exactly ±12 semitones. */
    repeatedOctaveRate: number;
}

function analyzeHand(events: SectionRenderEventArtifact[], measureCount: number): HandAnalysis {
    const nonRest = events.filter((e) => e.type !== "rest");
    const allPitches = collectAllPitches(nonRest);
    const seq = collectRepresentativePitchSequence(events);
    const intervals = computeIntervals(seq);

    const octaveCount = intervals.filter((i) => i === 12).length;
    const repeatedOctaveRate = intervals.length > 0 ? octaveCount / intervals.length : 0;

    return {
        pitchMin: arrayMin(allPitches),
        pitchMax: arrayMax(allPitches),
        density: measureCount > 0 ? nonRest.length / measureCount : 0,
        leapMax: arrayMax(intervals),
        leapAverage: arrayMean(intervals),
        repeatedOctaveRate,
    };
}

// ---------------------------------------------------------------------------
// Chord analysis
// ---------------------------------------------------------------------------

interface ChordAnalysis {
    /** Fraction of all non-rest events that are multi-note chords (0–1). */
    chordDensity: number;
    /** Largest voice count in any single chord event. */
    maxSimultaneousNotes: number;
    /** Number of chord events whose pitch span exceeds AWKWARD_SPAN. */
    awkwardChordCount: number;
}

function analyzeChords(
    rhEvents: SectionRenderEventArtifact[],
    lhEvents: SectionRenderEventArtifact[],
): ChordAnalysis {
    const all = [...rhEvents, ...lhEvents].filter((e) => e.type !== "rest");
    const chordEvents = all.filter((e) => e.type === "chord" && e.pitches && e.pitches.length > 1);

    let maxVoices = 0;
    let awkwardCount = 0;

    for (const ev of chordEvents) {
        const voiceCount = (ev.pitches?.length ?? 0) + (ev.pitch != null ? 1 : 0);
        if (voiceCount > maxVoices) maxVoices = voiceCount;

        const sorted = [...(ev.pitches ?? [])].sort((a, b) => a - b);
        if (sorted.length >= 2 && sorted[sorted.length - 1] - sorted[0] > AWKWARD_SPAN) {
            awkwardCount++;
        }
    }

    return {
        chordDensity: all.length > 0 ? chordEvents.length / all.length : 0,
        maxSimultaneousNotes: maxVoices,
        awkwardChordCount: awkwardCount,
    };
}

// ---------------------------------------------------------------------------
// Derived scores
// ---------------------------------------------------------------------------

/**
 * Heuristic pedal-blur risk (0–1).
 * Rises with: high chord density, wide hand spans, and many pedal events.
 */
function estimatePedalBlurRisk(
    chordDensity: number,
    handSpanMax: number | undefined,
    pedalEventCount: number | undefined,
    totalNonRestEvents: number,
): number {
    if (!pedalEventCount || totalNonRestEvents === 0) return 0;
    const spanFactor = handSpanMax != null ? Math.min(handSpanMax / UNPLAYABLE_SPAN, 1) : 0;
    const pedalRate = Math.min(pedalEventCount / totalNonRestEvents, 1);
    const raw = 0.4 * chordDensity + 0.3 * spanFactor + 0.3 * pedalRate;
    return Math.round(raw * 100) / 100;
}

/**
 * Overall piano idiomatic texture score (0–1).
 *
 * Penalises:
 * - Hand collisions  (-0.05 each, capped at -0.30)
 * - Spans exceeding UNPLAYABLE_SPAN (-0.30)
 * - Spans in (AWKWARD_SPAN, UNPLAYABLE_SPAN] (proportional, up to -0.20)
 * - Average leap > maj 6th (9 semitones)  (-proportional, up to -0.20)
 * - Density imbalance (one hand >3× the other) (-0.10)
 */
function computeIdiomaticTextureScore(
    layout: SectionArtifactSummary["pianoVoiceLayout"],
    rh: HandAnalysis,
    lh: HandAnalysis,
): number {
    let score = 1.0;

    const collisions = layout?.handCollisionCount ?? 0;
    score -= Math.min(collisions * 0.05, 0.3);

    const rhSpan = layout?.maxRightHandSpan ?? 0;
    const lhSpan = layout?.maxLeftHandSpan ?? 0;
    const maxSpan = Math.max(rhSpan, lhSpan);

    if (maxSpan > UNPLAYABLE_SPAN) {
        score -= 0.3;
    } else if (maxSpan > AWKWARD_SPAN) {
        score -= Math.min((maxSpan - AWKWARD_SPAN) / UNPLAYABLE_SPAN, 0.2);
    }

    const avgLeapR = rh.leapAverage ?? 0;
    const avgLeapL = lh.leapAverage ?? 0;
    const avgLeap = (avgLeapR + avgLeapL) / 2;
    if (avgLeap > 9) {
        score -= Math.min((avgLeap - 9) / 12, 0.2);
    }

    if (rh.density > 0 && lh.density > 0) {
        const ratio = Math.max(rh.density, lh.density) / Math.min(rh.density, lh.density);
        if (ratio > 3) score -= 0.1;
    }

    return Math.max(0, Math.round(score * 100) / 100);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** All 21 flat piano-projection fields. */
export interface PianoProjectionEvidence {
    pianoRightHandPitchMin?: number;
    pianoRightHandPitchMax?: number;
    pianoLeftHandPitchMin?: number;
    pianoLeftHandPitchMax?: number;

    pianoRightHandDensity?: number;
    pianoLeftHandDensity?: number;
    pianoHandSpanMax?: number;
    pianoHandSpanAverage?: number;

    pianoLeapMaxRight?: number;
    pianoLeapMaxLeft?: number;
    pianoLeapAverageRight?: number;
    pianoLeapAverageLeft?: number;

    pianoChordDensity?: number;
    pianoMaxSimultaneousNotes?: number;
    pianoAwkwardChordCount?: number;

    pianoHandCrossingCount?: number;
    pianoRegisterCollisionCount?: number;
    pianoRepeatedOctaveRate?: number;

    pianoPedalChangeCount?: number;
    pianoPedalBlurRisk?: number;

    pianoPlayabilityScore?: number;
    pianoIdiomaticTextureScore?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type ProjectionInput = Pick<
    SectionArtifactSummary,
    "melodyEvents" | "accompanimentEvents" | "measureCount" | "pianoVoiceLayout"
>;

/**
 * Computes all piano projection evidence from a SectionArtifactSummary.
 *
 * Convention used here:
 *   melodyEvents      → right-hand voice events
 *   accompanimentEvents → left-hand voice events
 *
 * Returns a PianoProjectionEvidence object; the caller merges it into the
 * summary with {@link applyPianoProjection}.
 */
export function computePianoProjectionEvidence(input: ProjectionInput): PianoProjectionEvidence {
    const { melodyEvents, accompanimentEvents, measureCount, pianoVoiceLayout: layout } = input;

    const rh = analyzeHand(melodyEvents, measureCount);
    const lh = analyzeHand(accompanimentEvents, measureCount);
    const chords = analyzeChords(melodyEvents, accompanimentEvents);

    // Hand span — prefer values from pianoVoiceLayout when available
    const rhSpan = layout?.maxRightHandSpan;
    const lhSpan = layout?.maxLeftHandSpan;
    const handSpanMax =
        rhSpan != null && lhSpan != null ? Math.max(rhSpan, lhSpan) : rhSpan ?? lhSpan;
    const handSpanAverage =
        rhSpan != null && lhSpan != null
            ? Math.round(((rhSpan + lhSpan) / 2) * 10) / 10
            : undefined;

    // Pedal blur risk
    const totalNonRest =
        melodyEvents.filter((e) => e.type !== "rest").length +
        accompanimentEvents.filter((e) => e.type !== "rest").length;
    const blurRisk = estimatePedalBlurRisk(
        chords.chordDensity,
        handSpanMax,
        layout?.pedalEventCount,
        totalNonRest,
    );

    // Playability score: use layout value if available, otherwise estimate from span
    let playabilityScore: number | undefined = layout?.playableSpanFit;
    if (playabilityScore == null && handSpanMax != null) {
        if (handSpanMax <= 12) {
            playabilityScore = 1.0;
        } else if (handSpanMax <= AWKWARD_SPAN) {
            playabilityScore = 1.0 - (handSpanMax - 12) / 10;
        } else {
            playabilityScore = Math.max(0, 1.0 - (handSpanMax - AWKWARD_SPAN) / 10);
        }
        playabilityScore = Math.round(playabilityScore * 100) / 100;
    }

    // Repeated octave rate: average across both hands
    const repeatedOctaveRate =
        Math.round(((rh.repeatedOctaveRate + lh.repeatedOctaveRate) / 2) * 100) / 100;

    const idiomaticScore = computeIdiomaticTextureScore(layout, rh, lh);

    return {
        pianoRightHandPitchMin: rh.pitchMin,
        pianoRightHandPitchMax: rh.pitchMax,
        pianoLeftHandPitchMin: lh.pitchMin,
        pianoLeftHandPitchMax: lh.pitchMax,

        pianoRightHandDensity: Math.round(rh.density * 100) / 100,
        pianoLeftHandDensity: Math.round(lh.density * 100) / 100,
        pianoHandSpanMax: handSpanMax,
        pianoHandSpanAverage: handSpanAverage,

        pianoLeapMaxRight: rh.leapMax,
        pianoLeapMaxLeft: lh.leapMax,
        pianoLeapAverageRight:
            rh.leapAverage != null ? Math.round(rh.leapAverage * 100) / 100 : undefined,
        pianoLeapAverageLeft:
            lh.leapAverage != null ? Math.round(lh.leapAverage * 100) / 100 : undefined,

        pianoChordDensity: Math.round(chords.chordDensity * 100) / 100,
        pianoMaxSimultaneousNotes:
            chords.maxSimultaneousNotes > 0 ? chords.maxSimultaneousNotes : undefined,
        pianoAwkwardChordCount: chords.awkwardChordCount,

        pianoHandCrossingCount: layout?.handCrossingCount,
        pianoRegisterCollisionCount: layout?.handCollisionCount,
        pianoRepeatedOctaveRate: repeatedOctaveRate,

        pianoPedalChangeCount: layout?.pedalEventCount,
        pianoPedalBlurRisk: blurRisk,

        pianoPlayabilityScore: playabilityScore,
        pianoIdiomaticTextureScore: idiomaticScore,
    };
}

/**
 * Returns a new SectionArtifactSummary enriched with all piano projection
 * evidence fields.  The original summary is not mutated.
 *
 * Idempotent: calling twice produces the same result.
 */
export function applyPianoProjection(summary: SectionArtifactSummary): SectionArtifactSummary {
    return { ...summary, ...computePianoProjectionEvidence(summary) };
}
