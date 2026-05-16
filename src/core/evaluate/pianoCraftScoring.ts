import type {
    CompositionPlan,
    PianoCraftScoreSummary,
    PianoDifficulty,
    PianoVoiceLayoutSummary,
    SectionArtifactSummary,
    StructureEvaluationReport,
} from "../pipeline/types.js";
import { evaluatePianoVoiceLayout } from "./pianoEvaluation.js";

// pianoCraftScoring.ts — Piano-specific craft evaluator
// ──────────────────────────────────────────────────────────────────────────────
// Scores piano-solo compositions across 9 hand-aware dimensions.
// Exists separately from craftScoring.ts because piano hand layout,
// playability, and LH/RH independence are fundamentally different from
// string-trio voice writing.
//
// Dimension weights (sum = 1.00):
//   handPlayability               0.20  — gate dim; unplayable ≠ piano
//   melodicClarity                0.15  — RH lead + leap quality
//   bassCoherence                 0.15  — LH bass motion + pitch zone
//   voicingIdiomaticFit           0.12  — chord voice count + span fitness
//   accompanimentPatternCoherence 0.12  — LH rhythmic regularity
//   registerSpacing               0.10  — RH vs LH median gap
//   handIndependence              0.08  — density balance + contrary motion
//   pedalPlausibility             0.05  — pedal events vs texture
//   difficultyFit                 0.03  — plan target vs realised span/density
//   ─────────────────────────────────
//   total                         1.00
//
// Gate 3 (pianoPlayabilityScore gate) is provided via pianoPlayabilityGate()
// and applyPianoPlayabilityGate().  Piano candidates must pass this gate
// before craft-score ranking (Gate 4).
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

function avg(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function intervalContour(pitches: number[]): number[] {
    const result: number[] = [];
    for (let i = 1; i < pitches.length; i++) {
        result.push(pitches[i]! - pitches[i - 1]!);
    }
    return result;
}

// ---------------------------------------------------------------------------
// 1. handPlayability  (weight 0.20)
// ---------------------------------------------------------------------------

/**
 * Derives a playability score from PianoVoiceLayoutSummary.
 * Falls back to neutral 0.5 when no layout is available.
 * Highest-weighted dimension — an unplayable piece is not a piano piece.
 */
export function computeHandPlayability(
    layout: PianoVoiceLayoutSummary | undefined,
): { score: number; notes: string } {
    if (!layout) {
        return { score: 0.5, notes: "no piano voice layout — playability cannot be assessed" };
    }
    const result = evaluatePianoVoiceLayout(layout);
    const score = clamp01(
        0.5 * result.playableSpanFit
        + 0.3 * result.handCollisionFit
        + 0.2 * result.chordDensityFit,
    );
    const notes = result.passed
        ? `playable: span=${result.playableSpanFit.toFixed(2)} collision=${result.handCollisionFit.toFixed(2)} density=${result.chordDensityFit.toFixed(2)}`
        : `playability issues: ${result.issues.slice(0, 2).join("; ")}`;
    return { score, notes };
}

// ---------------------------------------------------------------------------
// 2. melodicClarity  (weight 0.15)
// ---------------------------------------------------------------------------

/**
 * Right-hand melodic clarity.
 *
 * Rewards:
 * - Moderate note density (3–8 notes/measure)
 * - Small average leap (stepwise preferred)
 * - Low rate of super-octave leaps (> 12 semitones)
 *
 * The leap penalty that used to be a separate dimension is absorbed here.
 */
export function computeMelodicClarity(
    sectionArtifacts: SectionArtifactSummary[],
): { score: number; notes: string } {
    if (sectionArtifacts.length === 0) {
        return { score: 0.5, notes: "no artifacts" };
    }

    const densities: number[] = [];
    let totalIntervals = 0;
    let largeLeaps = 0;
    let superOctaveLeaps = 0;

    for (const section of sectionArtifacts) {
        const melodyNotes = section.melodyEvents.filter(
            (e) => e.type === "note" && e.pitch !== undefined,
        );
        densities.push(melodyNotes.length / Math.max(1, section.measureCount));

        const contour = intervalContour(melodyNotes.map((e) => e.pitch as number));
        totalIntervals += contour.length;
        largeLeaps += contour.filter((i) => Math.abs(i) > 7).length;
        superOctaveLeaps += contour.filter((i) => Math.abs(i) > 12).length;
    }

    const avgDensity = avg(densities);
    const densityScore =
        avgDensity < 1 ? 0.3
        : avgDensity <= 8 ? clamp01(0.4 + (avgDensity - 1) / 7 * 0.6)
        : clamp01(1 - (avgDensity - 8) / 8 * 0.5);

    // Large-leap ratio (> perfect 5th)
    const largeLpRatio = totalIntervals > 0 ? largeLeaps / totalIntervals : 0.2;
    const largeLpScore = clamp01(1 - largeLpRatio * 1.5);

    // Super-octave penalty
    const superOctRatio = totalIntervals > 0 ? superOctaveLeaps / totalIntervals : 0;
    const superOctPenalty = clamp01(1 - superOctRatio * 2);

    const score = clamp01(0.4 * densityScore + 0.35 * largeLpScore + 0.25 * superOctPenalty);
    const notes = [
        `avg density: ${avgDensity.toFixed(2)}/measure`,
        totalIntervals > 0
            ? `large-leap ratio: ${largeLpRatio.toFixed(2)}, super-octave ratio: ${superOctRatio.toFixed(2)}`
            : "no melody intervals",
    ].join("; ");

    return { score, notes };
}

// ---------------------------------------------------------------------------
// 3. bassCoherence  (weight 0.15)
// ---------------------------------------------------------------------------

/**
 * Left-hand bass coherence.
 *
 * Rewards "stepwise" and "pedal" bass motion; penalises leaping bass
 * and LH pitches outside the idiomatic zone (C1–C5, MIDI 24–72).
 */
export function computeBassCoherence(
    sectionArtifacts: SectionArtifactSummary[],
): { score: number; notes: string } {
    if (sectionArtifacts.length === 0) {
        return { score: 0.5, notes: "no artifacts" };
    }

    const profileScores: number[] = [];
    const notesList: string[] = [];

    for (const section of sectionArtifacts) {
        switch (section.bassMotionProfile) {
            case "stepwise": profileScores.push(1.0); break;
            case "pedal":    profileScores.push(0.85); break;
            case "mixed":    profileScores.push(0.65); break;
            case "leaping":
                profileScores.push(0.30);
                notesList.push(`${section.sectionId}: leaping LH bass`);
                break;
            default:
                profileScores.push(0.5);
        }

        if (section.bassPitchMin !== undefined && section.bassPitchMin < 24) {
            profileScores.push(0.4);
            notesList.push(`${section.sectionId}: bass dips below C1`);
        }
        if (section.bassPitchMax !== undefined && section.bassPitchMax > 72) {
            profileScores.push(0.5);
            notesList.push(`${section.sectionId}: bass exceeds C5`);
        }
    }

    if (profileScores.length === 0) {
        return { score: 0.5, notes: "no bass motion profile data" };
    }

    const score = clamp01(avg(profileScores));
    return {
        score,
        notes: notesList.join("; ") || `avg bass coherence: ${score.toFixed(2)}`,
    };
}

// ---------------------------------------------------------------------------
// 4. voicingIdiomaticFit  (weight 0.12)
// ---------------------------------------------------------------------------

/**
 * Chord voicing fitness for piano idiom.
 *
 * Combines:
 * - Voice count fit (avg ≤ 6 is ideal)
 * - Awkward-span ratio (chords spanning > major 9th = 14 semitones)
 * - Register crowding penalty (spans > unplayable ceiling of 19)
 */
export function computeVoicingIdiomaticFit(
    sectionArtifacts: SectionArtifactSummary[],
    layout: PianoVoiceLayoutSummary | undefined,
): { score: number; notes: string } {
    const notes: string[] = [];

    // Voice count fit from layout
    let voiceCountScore = 0.75;  // neutral default
    if (layout?.avgChordVoiceCount !== undefined) {
        const v = layout.avgChordVoiceCount;
        voiceCountScore = v <= 6 ? 1.0 : clamp01(1 - (v - 6) / 6);
        notes.push(`avg ${v.toFixed(1)} voices/event`);
    }

    // Awkward chord span ratio from projection evidence
    let awkwardScore = 0.8;
    const totalChordEvents = sectionArtifacts.reduce((sum, s) => {
        return sum + s.accompanimentEvents.filter((e) => e.type === "chord").length
                   + s.melodyEvents.filter((e) => e.type === "chord").length;
    }, 0);
    const awkwardCount = sectionArtifacts.reduce(
        (sum, s) => sum + (s.pianoAwkwardChordCount ?? 0), 0,
    );
    if (totalChordEvents > 0) {
        const awkwardRatio = awkwardCount / totalChordEvents;
        awkwardScore = clamp01(1 - awkwardRatio * 2);
        notes.push(`awkward chord ratio: ${awkwardRatio.toFixed(2)}`);
    }

    // Span ceiling penalty from layout
    let spanFitScore = 0.8;
    if (layout?.maxRightHandSpan !== undefined && layout?.maxLeftHandSpan !== undefined) {
        const maxSpan = Math.max(layout.maxRightHandSpan, layout.maxLeftHandSpan);
        spanFitScore = maxSpan <= 14 ? 1.0
            : maxSpan <= 19 ? clamp01(1 - (maxSpan - 14) / 10)
            : 0.2;
        notes.push(`max span: ${maxSpan} semi`);
    }

    const score = clamp01(0.4 * voiceCountScore + 0.3 * awkwardScore + 0.3 * spanFitScore);
    return { score, notes: notes.join("; ") || "voicing fit (defaults)" };
}

// ---------------------------------------------------------------------------
// 5. accompanimentPatternCoherence  (weight 0.12)
// ---------------------------------------------------------------------------

/**
 * Rhythmic regularity of accompaniment (LH) events.
 * Low variance in event duration → consistent Alberti/waltz pattern → higher score.
 */
export function computeAccompanimentPatternCoherence(
    sectionArtifacts: SectionArtifactSummary[],
): { score: number; notes: string } {
    if (sectionArtifacts.length === 0) {
        return { score: 0.5, notes: "no artifacts" };
    }

    const varianceScores: number[] = [];
    const notesList: string[] = [];

    for (const section of sectionArtifacts) {
        const accomp = section.accompanimentEvents.filter((e) => e.type !== "rest");
        if (accomp.length < 3) continue;

        const durations = accomp.map((e) => e.quarterLength);
        const meanDur = avg(durations);
        const variance = avg(durations.map((d) => (d - meanDur) ** 2));
        const cv = meanDur > 0 ? Math.sqrt(variance) / meanDur : 1;
        varianceScores.push(clamp01(1 - cv * 0.7));
        if (cv > 0.8) {
            notesList.push(`${section.sectionId}: accomp rhythm CV=${cv.toFixed(2)}`);
        }
    }

    if (varianceScores.length === 0) {
        return { score: 0.6, notes: "insufficient accompaniment data" };
    }

    const score = clamp01(avg(varianceScores));
    return {
        score,
        notes: notesList.join("; ") || `accompaniment coherence: ${score.toFixed(2)}`,
    };
}

// ---------------------------------------------------------------------------
// 6. registerSpacing  (weight 0.10)
// ---------------------------------------------------------------------------

/**
 * Rewards a clear separation between RH register center and LH register center.
 * Gap ≥ 14 semitones (major 9th) between median pitches = ideal.
 */
export function computeRegisterSpacing(
    sectionArtifacts: SectionArtifactSummary[],
    layout: PianoVoiceLayoutSummary | undefined,
): { score: number; notes: string } {
    if (layout?.rightHandPitchMin !== undefined && layout?.leftHandPitchMax !== undefined) {
        const rhCenter = ((layout.rightHandPitchMin ?? 60) + (layout.rightHandPitchMax ?? 84)) / 2;
        const lhCenter = ((layout.leftHandPitchMin ?? 36) + (layout.leftHandPitchMax ?? 60)) / 2;
        const gap = rhCenter - lhCenter;
        const score = gap >= 14 ? 1.0 : clamp01(gap / 14);
        return {
            score,
            notes: `RH ~${rhCenter.toFixed(0)} / LH ~${lhCenter.toFixed(0)} / gap ${gap.toFixed(0)} semi`,
        };
    }

    const melodyCenters: number[] = [];
    const bassCenters: number[] = [];
    for (const section of sectionArtifacts) {
        if (section.melodyPitchMin !== undefined && section.melodyPitchMax !== undefined) {
            melodyCenters.push((section.melodyPitchMin + section.melodyPitchMax) / 2);
        }
        if (section.bassPitchMin !== undefined && section.bassPitchMax !== undefined) {
            bassCenters.push((section.bassPitchMin + section.bassPitchMax) / 2);
        }
    }

    if (melodyCenters.length === 0 || bassCenters.length === 0) {
        return { score: 0.5, notes: "insufficient pitch range data" };
    }

    const gap = avg(melodyCenters) - avg(bassCenters);
    const score = gap >= 14 ? 1.0 : clamp01(gap / 14);
    return { score, notes: `gap ${gap.toFixed(0)} semi (fallback)` };
}

// ---------------------------------------------------------------------------
// 7. handIndependence  (weight 0.08)
// ---------------------------------------------------------------------------

/**
 * Independence of the two hands.
 *
 * Rewards:
 * - Balanced note density between LH and RH (ratio near 1.0)
 * - Contrary motion rate above 0.15 (hands moving in opposite directions)
 *
 * Penalises:
 * - One hand completely dominating (density ratio > 4×)
 * - Near-unison pitch profiles (hands always together = no independence)
 */
export function computeHandIndependence(
    sectionArtifacts: SectionArtifactSummary[],
): { score: number; notes: string } {
    if (sectionArtifacts.length === 0) {
        return { score: 0.5, notes: "no artifacts" };
    }

    const densityRatioScores: number[] = [];
    const contraryMotionRates: number[] = [];

    for (const section of sectionArtifacts) {
        const rhCount = section.melodyEvents.filter((e) => e.type !== "rest").length;
        const lhCount = section.accompanimentEvents.filter((e) => e.type !== "rest").length;

        if (rhCount > 0 && lhCount > 0) {
            const ratio = Math.max(rhCount, lhCount) / Math.min(rhCount, lhCount);
            densityRatioScores.push(ratio <= 2 ? 1.0 : clamp01(1 - (ratio - 2) / 4));
        }

        if (section.textureContraryMotionRate !== undefined) {
            const cmr = section.textureContraryMotionRate;
            // 0.15–0.60 is healthy; above 0.80 might be too forced
            contraryMotionRates.push(
                cmr < 0.10 ? 0.4
                : cmr <= 0.60 ? clamp01(0.4 + cmr * 0.9)
                : clamp01(1 - (cmr - 0.60) * 0.5),
            );
        }
    }

    const densityScore = densityRatioScores.length > 0 ? avg(densityRatioScores) : 0.6;
    const contraryScore = contraryMotionRates.length > 0 ? avg(contraryMotionRates) : 0.5;

    const score = clamp01(0.6 * densityScore + 0.4 * contraryScore);
    return {
        score,
        notes: [
            densityRatioScores.length > 0
                ? `density balance: ${avg(densityRatioScores).toFixed(2)}`
                : "no density data",
            contraryMotionRates.length > 0
                ? `contrary motion avg: ${avg(contraryMotionRates).toFixed(2)}`
                : "no contrary motion data",
        ].join("; "),
    };
}

// ---------------------------------------------------------------------------
// 8. pedalPlausibility  (weight 0.05)
// ---------------------------------------------------------------------------

/**
 * Plausibility of pedal use for the piece's texture.
 * Some pedal (moderate ratio) is healthy; none or constant both get penalised.
 */
export function computePedalPlausibility(
    sectionArtifacts: SectionArtifactSummary[],
    layout: PianoVoiceLayoutSummary | undefined,
): { score: number; notes: string } {
    const pedalCount = layout?.pedalEventCount ?? 0;
    const totalEvents = sectionArtifacts.reduce(
        (sum, s) => sum + s.melodyEvents.length + s.accompanimentEvents.length, 0,
    );

    if (totalEvents === 0) {
        return { score: 0.5, notes: "no events to evaluate" };
    }
    if (pedalCount === 0) {
        return { score: 0.6, notes: "no pedal events recorded" };
    }

    const pedalRatio = pedalCount / totalEvents;
    if (pedalRatio > 0.8) {
        return {
            score: 0.4,
            notes: `${(pedalRatio * 100).toFixed(0)}% of events have pedal — likely over-pedalled`,
        };
    }

    const score = clamp01(0.5 + pedalRatio * 0.6);
    return { score, notes: `pedal on ${(pedalRatio * 100).toFixed(0)}% of events` };
}

// ---------------------------------------------------------------------------
// 9. difficultyFit  (weight 0.03)
// ---------------------------------------------------------------------------

const DIFFICULTY_SPAN_CEILING: Record<PianoDifficulty, number> = {
    easy: 10,
    intermediate: 12,
    advanced: 15,
    virtuosic: 19,
};

/**
 * Fit between the plan's difficultyTarget and the realised span/density.
 *
 * Scores 1.0 when realised span ≤ target ceiling.
 * Degrades when the piece is harder than planned (unplayable for the student)
 * or trivially easy relative to a virtuosic target (minor penalty only).
 */
export function computeDifficultyFit(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
    layout: PianoVoiceLayoutSummary | undefined,
): { score: number; notes: string } {
    const difficultyTarget = plan?.pianoPlan?.difficultyTarget ?? "intermediate";
    const ceiling = DIFFICULTY_SPAN_CEILING[difficultyTarget];

    const maxSpan = layout
        ? Math.max(layout.maxRightHandSpan ?? 0, layout.maxLeftHandSpan ?? 0)
        : sectionArtifacts.reduce((m, s) => Math.max(m, s.pianoHandSpanMax ?? 0), 0);

    if (maxSpan === 0) {
        return { score: 0.7, notes: `no span data; target="${difficultyTarget}"` };
    }

    if (maxSpan <= ceiling) {
        const score = 1.0 - Math.max(0, ceiling - maxSpan) / ceiling * 0.1; // trivially easy → slight penalty
        return {
            score: clamp01(score),
            notes: `max span ${maxSpan} ≤ target ceiling ${ceiling} (${difficultyTarget})`,
        };
    }

    const overrun = maxSpan - ceiling;
    const score = clamp01(1 - overrun / ceiling);
    return {
        score,
        notes: `max span ${maxSpan} exceeds target ceiling ${ceiling} (${difficultyTarget}) by ${overrun}`,
    };
}

// ---------------------------------------------------------------------------
// Gate 3 — pianoPlayabilityScore gate
// ---------------------------------------------------------------------------

export interface PianoPlayabilityGateResult {
    /** true = candidate passes; false = candidate must be rejected */
    passed: boolean;
    /** The pianoPlayabilityScore used for the decision, or undefined if unavailable. */
    pianoPlayabilityScore: number | undefined;
    /** Human-readable rejection reason (only set when passed=false). */
    reason?: string;
}

/**
 * Gate 3: Piano playability hard gate.
 *
 * A piano candidate whose pianoPlayabilityScore falls below `threshold` is
 * unconditionally rejected regardless of melodic or harmonic quality.
 * "Sounds good in MIDI but cannot be played by human hands" must not pass.
 *
 * Default threshold: 0.50 (configurable by caller).
 *
 * Evaluation pipeline order:
 *   Gate 1 syntaxValidity → Gate 2 sectionContractFit →
 *   Gate 3 pianoPlayabilityScore (this) → Gate 4 craftScore →
 *   Gate 5 listenerPreference
 */
export function pianoPlayabilityGate(
    artifacts: SectionArtifactSummary[],
    threshold = 0.50,
): PianoPlayabilityGateResult {
    // Collect pianoPlayabilityScore values across sections
    const scores = artifacts
        .map((a) => a.pianoPlayabilityScore)
        .filter((s): s is number => s !== undefined);

    if (scores.length === 0) {
        // No projection evidence yet — allow through with a caveat
        return {
            passed: true,
            pianoPlayabilityScore: undefined,
        };
    }

    // Worst-case: the minimum score across all sections must pass the gate
    const minScore = Math.min(...scores);
    if (minScore < threshold) {
        return {
            passed: false,
            pianoPlayabilityScore: minScore,
            reason: `pianoPlayabilityScore ${minScore.toFixed(3)} < threshold ${threshold.toFixed(3)} — hand span unplayable`,
        };
    }

    return { passed: true, pianoPlayabilityScore: minScore };
}

/**
 * Applies Gate 3 to an existing StructureEvaluationReport.
 *
 * If the gate fails, sets `report.passed = false` and prepends a descriptive
 * issue.  The original report is not mutated; a new object is returned.
 *
 * Wire this into the evaluation flow immediately after sectionContractFit
 * checks and before craft scoring.
 */
export function applyPianoPlayabilityGate(
    report: StructureEvaluationReport,
    artifacts: SectionArtifactSummary[],
    threshold = 0.50,
): StructureEvaluationReport {
    const gateResult = pianoPlayabilityGate(artifacts, threshold);
    if (gateResult.passed) return report;

    return {
        ...report,
        passed: false,
        issues: [gateResult.reason!, ...report.issues],
    };
}

// ---------------------------------------------------------------------------
// Master computation
// ---------------------------------------------------------------------------

/**
 * Computes a PianoCraftScoreSummary from section artifacts, the composition
 * plan, an existing evaluation report, and the optional piano voice layout.
 *
 * Call instead of (or alongside) computeCraftScoreSummary() when the
 * orchestration family is "solo_piano".
 */
export function computePianoCraftScoreSummary(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
    _evaluation: StructureEvaluationReport,
    layout?: PianoVoiceLayoutSummary,
): PianoCraftScoreSummary {
    const resolvedLayout: PianoVoiceLayoutSummary | undefined =
        layout ??
        sectionArtifacts.find((a) => a.pianoVoiceLayout !== undefined)?.pianoVoiceLayout;

    const playResult   = computeHandPlayability(resolvedLayout);
    const melResult    = computeMelodicClarity(sectionArtifacts);
    const bassResult   = computeBassCoherence(sectionArtifacts);
    const voiceResult  = computeVoicingIdiomaticFit(sectionArtifacts, resolvedLayout);
    const accompResult = computeAccompanimentPatternCoherence(sectionArtifacts);
    const regResult    = computeRegisterSpacing(sectionArtifacts, resolvedLayout);
    const indepResult  = computeHandIndependence(sectionArtifacts);
    const pedalResult  = computePedalPlausibility(sectionArtifacts, resolvedLayout);
    const diffResult   = computeDifficultyFit(sectionArtifacts, plan, resolvedLayout);

    const handPlayability              = clamp01(playResult.score);
    const melodicClarity               = clamp01(melResult.score);
    const bassCoherence                = clamp01(bassResult.score);
    const voicingIdiomaticFit          = clamp01(voiceResult.score);
    const accompanimentPatternCoherence = clamp01(accompResult.score);
    const registerSpacing              = clamp01(regResult.score);
    const handIndependence             = clamp01(indepResult.score);
    const pedalPlausibility            = clamp01(pedalResult.score);
    const difficultyFit                = clamp01(diffResult.score);

    const finalPianoScore = Number(
        (
            0.20 * handPlayability
            + 0.15 * melodicClarity
            + 0.15 * bassCoherence
            + 0.12 * voicingIdiomaticFit
            + 0.12 * accompanimentPatternCoherence
            + 0.10 * registerSpacing
            + 0.08 * handIndependence
            + 0.05 * pedalPlausibility
            + 0.03 * difficultyFit
        ).toFixed(4),
    );

    const dimensionNotes: Record<string, string> = {};
    if (playResult.notes)   dimensionNotes["handPlayability"]               = playResult.notes;
    if (melResult.notes)    dimensionNotes["melodicClarity"]                = melResult.notes;
    if (bassResult.notes)   dimensionNotes["bassCoherence"]                 = bassResult.notes;
    if (voiceResult.notes)  dimensionNotes["voicingIdiomaticFit"]           = voiceResult.notes;
    if (accompResult.notes) dimensionNotes["accompanimentPatternCoherence"] = accompResult.notes;
    if (regResult.notes)    dimensionNotes["registerSpacing"]               = regResult.notes;
    if (indepResult.notes)  dimensionNotes["handIndependence"]              = indepResult.notes;
    if (pedalResult.notes)  dimensionNotes["pedalPlausibility"]             = pedalResult.notes;
    if (diffResult.notes)   dimensionNotes["difficultyFit"]                 = diffResult.notes;

    return {
        handPlayability:               Number(handPlayability.toFixed(4)),
        melodicClarity:                Number(melodicClarity.toFixed(4)),
        bassCoherence:                 Number(bassCoherence.toFixed(4)),
        voicingIdiomaticFit:           Number(voicingIdiomaticFit.toFixed(4)),
        accompanimentPatternCoherence: Number(accompanimentPatternCoherence.toFixed(4)),
        registerSpacing:               Number(registerSpacing.toFixed(4)),
        handIndependence:              Number(handIndependence.toFixed(4)),
        pedalPlausibility:             Number(pedalPlausibility.toFixed(4)),
        difficultyFit:                 Number(difficultyFit.toFixed(4)),
        finalPianoScore,
        dimensionNotes,
    };
}

