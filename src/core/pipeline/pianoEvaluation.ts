import type { PianoVoiceLayoutSummary } from "./types.js";

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Idiomatic right-hand MIDI pitch range (C4 – C8). */
const RH_PITCH_MIN = 60;
const RH_PITCH_MAX = 108;

/** Idiomatic left-hand MIDI pitch range (C1 – C5). */
const LH_PITCH_MIN = 24;
const LH_PITCH_MAX = 72;

/**
 * Max simultaneous span (semitones) within one hand before flagging as
 * unplayable without arpeggiation (minor 13th).
 */
const MAX_HAND_SPAN = 19;

/** Max simultaneous voices per hand before flagging as too dense. */
const MAX_CHORD_VOICES = 6;

/** Proportion of chord events that must be within span to pass. */
const MIN_PLAYABLE_SPAN_FIT = 0.80;

// ─── Result types ─────────────────────────────────────────────────────────────

export interface PianoVoiceEvaluationResult {
    passed: boolean;
    /** Proportion of chordal events within playable span thresholds (0–1). */
    playableSpanFit: number;
    /** 0 = no collisions, 1 = all events collide (lower is better → expressed as 1−collision_rate). */
    handCollisionFit: number;
    /** 1 if avgChordVoiceCount ≤ MAX_CHORD_VOICES, scales down linearly above that. */
    chordDensityFit: number;
    issues: string[];
    strengths: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function pitchRangeFit(min: number | undefined, max: number | undefined, lo: number, hi: number): boolean {
    if (min !== undefined && min < lo) return false;
    if (max !== undefined && max > hi) return false;
    return true;
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Evaluate a `PianoVoiceLayoutSummary` against playability thresholds.
 *
 * Returns a `PianoVoiceEvaluationResult` that can be incorporated into a
 * broader `StructureEvaluationReport` for piano-targeted composition plans.
 * Call this function when `SectionArtifactSummary.pianoVoiceLayout` is present.
 */
export function evaluatePianoVoiceLayout(
    layout: PianoVoiceLayoutSummary,
): PianoVoiceEvaluationResult {
    const issues: string[] = [];
    const strengths: string[] = [];

    // ── Right-hand pitch range ────────────────────────────────────────────────
    if (!pitchRangeFit(layout.rightHandPitchMin, layout.rightHandPitchMax, RH_PITCH_MIN, RH_PITCH_MAX)) {
        if (layout.rightHandPitchMin !== undefined && layout.rightHandPitchMin < RH_PITCH_MIN) {
            issues.push(`Right-hand pitch dips to MIDI ${layout.rightHandPitchMin} (below C4=${RH_PITCH_MIN}); consider shifting to the left hand.`);
        }
        if (layout.rightHandPitchMax !== undefined && layout.rightHandPitchMax > RH_PITCH_MAX) {
            issues.push(`Right-hand pitch reaches MIDI ${layout.rightHandPitchMax} (above C8=${RH_PITCH_MAX}); outside idiomatic range.`);
        }
    } else if (layout.rightHandPitchMin !== undefined) {
        strengths.push("Right-hand pitch range is within idiomatic bounds.");
    }

    // ── Left-hand pitch range ─────────────────────────────────────────────────
    if (!pitchRangeFit(layout.leftHandPitchMin, layout.leftHandPitchMax, LH_PITCH_MIN, LH_PITCH_MAX)) {
        if (layout.leftHandPitchMin !== undefined && layout.leftHandPitchMin < LH_PITCH_MIN) {
            issues.push(`Left-hand pitch dips to MIDI ${layout.leftHandPitchMin} (below C1=${LH_PITCH_MIN}); outside idiomatic range.`);
        }
        if (layout.leftHandPitchMax !== undefined && layout.leftHandPitchMax > LH_PITCH_MAX) {
            issues.push(`Left-hand pitch reaches MIDI ${layout.leftHandPitchMax} (above C5=${LH_PITCH_MAX}); consider shifting to the right hand.`);
        }
    } else if (layout.leftHandPitchMin !== undefined) {
        strengths.push("Left-hand pitch range is within idiomatic bounds.");
    }

    // ── Hand span ─────────────────────────────────────────────────────────────
    const maxRH = layout.maxRightHandSpan ?? 0;
    const maxLH = layout.maxLeftHandSpan ?? 0;

    if (maxRH > MAX_HAND_SPAN) {
        issues.push(`Right-hand chord span reaches ${maxRH} semitones (max playable without arpeggio = ${MAX_HAND_SPAN}).`);
    }
    if (maxLH > MAX_HAND_SPAN) {
        issues.push(`Left-hand chord span reaches ${maxLH} semitones (max playable without arpeggio = ${MAX_HAND_SPAN}).`);
    }

    // ── Playable span fit ─────────────────────────────────────────────────────
    const playableSpanFit = layout.playableSpanFit ?? (maxRH <= MAX_HAND_SPAN && maxLH <= MAX_HAND_SPAN ? 1.0 : 0.6);
    if (playableSpanFit >= MIN_PLAYABLE_SPAN_FIT) {
        strengths.push(`${Math.round(playableSpanFit * 100)}% of chord events are within playable span.`);
    } else {
        issues.push(`Only ${Math.round(playableSpanFit * 100)}% of chord events are within playable span (threshold: ${Math.round(MIN_PLAYABLE_SPAN_FIT * 100)}%).`);
    }

    // ── Hand collisions ───────────────────────────────────────────────────────
    const collisionCount = layout.handCollisionCount ?? 0;
    // Estimate collision rate from crossings + collisions (no total event count available, use conservative cap of 20)
    const collisionRate = collisionCount > 0
        ? clamp01(collisionCount / Math.max(collisionCount + 20, 20))
        : 0;
    const handCollisionFit = clamp01(1 - collisionRate);

    if (collisionCount > 2) {
        issues.push(`${collisionCount} hand collision(s) detected (left-hand notes above right-hand register); review voice assignments.`);
    } else if (collisionCount > 0) {
        issues.push(`${collisionCount} hand collision(s) detected; likely manageable but verify.`);
    } else if (layout.handCrossingCount !== undefined && layout.handCrossingCount === 0) {
        strengths.push("No hand crossings or collisions detected.");
    }

    // ── Chord density ─────────────────────────────────────────────────────────
    const avgVoices = layout.avgChordVoiceCount ?? 0;
    const chordDensityFit = avgVoices <= MAX_CHORD_VOICES
        ? 1.0
        : clamp01(1 - (avgVoices - MAX_CHORD_VOICES) / MAX_CHORD_VOICES);

    if (avgVoices > MAX_CHORD_VOICES) {
        issues.push(`Average chord density is ${avgVoices.toFixed(1)} voices/hand (max comfortable = ${MAX_CHORD_VOICES}); consider reducing inner voices.`);
    } else if (avgVoices > 0) {
        strengths.push(`Average chord density is ${avgVoices.toFixed(1)} voices/hand — within comfortable range.`);
    }

    const passed = issues.length === 0
        && playableSpanFit >= MIN_PLAYABLE_SPAN_FIT
        && handCollisionFit >= 0.85
        && chordDensityFit >= 0.85;

    return {
        passed,
        playableSpanFit: Number(playableSpanFit.toFixed(4)),
        handCollisionFit: Number(handCollisionFit.toFixed(4)),
        chordDensityFit: Number(chordDensityFit.toFixed(4)),
        issues,
        strengths,
    };
}
