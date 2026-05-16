import type {
    HarmonyGrammarPlan,
    SectionArtifactSummary,
} from "../pipeline/types.js";

// harmonyGrammarScoring.ts — Harmony grammar quality evaluator
// ──────────────────────────────────────────────────────────────────────────────
// Scores how well a rendered section fulfils its HarmonyGrammarPlan.
// All individual scoring functions return a value in [0, 1].
//
// Conceptual framework follows docs/harmony-grammar.md §1–7.
// Inputs:
//   plan     — HarmonyGrammarPlan from harmonyGrammar.ts (planning annotation)
//   artifact — SectionArtifactSummary from the render pipeline
// ──────────────────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// 1. Predominant–Dominant–Tonic (PDT) detection score
// ---------------------------------------------------------------------------

/**
 * Estimates how well the section's harmonic evidence supports a complete
 * T → PD → D → T functional cycle.
 *
 * Proxy evidence:
 *   - artifact.cadenceApproach === "dominant"  → D present at close
 *   - artifact.harmonicColorCues with tag "predominant_color" → PD present
 *   - artifact.cadenceApproach === "tonic"     → T resolution confirmed
 *
 * Returns 0.5 when no harmonic evidence is available.
 */
export function computePDTScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const approach = artifact.cadenceApproach;
    const colorCues = artifact.harmonicColorCues ?? [];

    const hasDominantClose = approach === "dominant" || approach === "tonic";
    const hasPredominant = colorCues.some((c) => c.tag === "predominant_color");
    const hasTonicResolution = approach === "tonic";

    // Weight expected functions against the plan's functional sequence
    const planHasPD = plan.functionalSequence.includes("predominant");
    const planHasD  = plan.functionalSequence.includes("dominant");
    const planHasT  = plan.functionalSequence.includes("tonic");

    let score = 0;
    let total = 0;

    if (planHasD) {
        score += hasDominantClose ? 1.0 : 0.2;
        total += 1;
    }
    if (planHasPD) {
        score += hasPredominant ? 1.0 : 0.3;
        total += 1;
    }
    if (planHasT) {
        score += hasTonicResolution ? 1.0 : 0.5;
        total += 1;
    }

    if (total === 0) return 0.5; // plan had no function expectations
    return clamp01(score / total);
}

// ---------------------------------------------------------------------------
// 2. Applied dominant detection score
// ---------------------------------------------------------------------------

/**
 * Rewards sections that use applied dominants when the plan calls for them.
 *
 * - Plan has appliedDominantCues → applied dominants expected.
 * - Artifact has harmonicColorCues with tag "applied_dominant" → reward.
 * - If plan has no applied dominant cues, any occurrence still scores 0.5 (neutral).
 */
export function computeAppliedDominantScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const plannedCues = plan.appliedDominantCues ?? [];
    const colorCues = artifact.harmonicColorCues ?? [];
    const realisedApplied = colorCues.filter((c) => c.tag === "applied_dominant");

    if (plannedCues.length === 0) {
        // No applied dominants planned — neutral regardless of realisation
        return 0.5;
    }

    if (realisedApplied.length === 0) return 0.2; // planned but absent
    // Partial fulfilment: reward proportionally capped at 1.0
    const ratio = Math.min(1, realisedApplied.length / plannedCues.length);
    return clamp01(0.2 + ratio * 0.8);
}

// ---------------------------------------------------------------------------
// 3. Local tonicization depth score
// ---------------------------------------------------------------------------

/**
 * Scores whether local tonicization windows that were planned are also
 * present in the artifact.
 *
 * Depth = number of realised windows / number of planned windows.
 * Returns 0.5 when no tonicization was planned (neutral).
 */
export function computeTonicizationDepthScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const plannedWindow = plan.tonicization;
    const realisedWindows = artifact.tonicizationWindows ?? [];

    if (!plannedWindow) return 0.5; // no tonicization planned

    if (realisedWindows.length === 0) return 0.2; // planned but absent

    // Check if any realised window targets the same key
    const matchFound = realisedWindows.some((w) =>
        w.keyTarget && plannedWindow.keyTarget &&
        w.keyTarget.toLowerCase().includes(
            plannedWindow.keyTarget.split(" ")[0]?.toLowerCase() ?? "",
        ),
    );

    return matchFound ? 1.0 : 0.6; // realised but different target — partial credit
}

// ---------------------------------------------------------------------------
// 4. Harmonic rhythm consistency score
// ---------------------------------------------------------------------------

/**
 * Estimates whether the realised harmonic rhythm matches the planned shape.
 *
 * Uses artifact.harmonicRealizationSummary.averageDurationScale as a proxy:
 *   slow  → durationScale > 1.1
 *   fast  → durationScale < 0.9
 *   uniform / arch → durationScale ≈ 1.0
 *
 * Returns 0.5 when no harmonic realization summary is available.
 */
export function computeHarmonicRhythmConsistencyScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const summary = artifact.harmonicRealizationSummary;
    const shape = plan.harmonicRhythmShape;

    if (!summary || !shape) return 0.5;

    const avgScale = summary.averageDurationScale ?? 1.0;

    switch (shape) {
        case "slow":
            // slow harmonic rhythm → long durations → high durationScale
            return clamp01(0.5 + (avgScale - 1.0) * 0.5);

        case "slow→fast":
            // starts slow, ends fast — a moderate scale is expected overall
            return avgScale >= 0.85 && avgScale <= 1.15 ? 0.9 : 0.6;

        case "fast→slow":
            return avgScale >= 0.85 && avgScale <= 1.15 ? 0.9 : 0.6;

        case "arch":
            // slow → peak → slow → moderate scale
            return avgScale >= 0.9 && avgScale <= 1.1 ? 1.0 : 0.65;

        case "uniform":
        default:
            // uniform harmonic rhythm → durationScale ≈ 1.0
            return clamp01(1.0 - Math.abs(avgScale - 1.0) * 0.8);
    }
}

// ---------------------------------------------------------------------------
// 5. Cadence approach quality score
// ---------------------------------------------------------------------------

/**
 * Compares the planned CadenceApproachTemplate against the realised
 * cadenceApproach from the artifact.
 *
 * cad64       → artifact should close with "dominant"
 * applied_dominant → artifact should close with "dominant"
 * extended    → artifact should close with "dominant"
 * basic       → "tonic" or "dominant" both acceptable
 */
export function computeCadenceApproachQualityScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const realised = artifact.cadenceApproach;
    if (!realised) return 0.5;

    switch (plan.cadenceApproach) {
        case "cad64":
        case "applied_dominant":
        case "extended":
            if (realised === "dominant") return 1.0;
            if (realised === "tonic") return 0.7;   // resolved past V — late but ok
            if (realised === "plagal") return 0.5;
            return 0.3;

        case "basic":
        default:
            if (realised === "tonic" || realised === "dominant") return 1.0;
            if (realised === "plagal") return 0.8;
            return 0.5;
    }
}

// ---------------------------------------------------------------------------
// 6. Prolongation proxy score
// ---------------------------------------------------------------------------

/**
 * Checks whether a planned prolongation mode is realised.
 *
 * Compares plan.prolongationMode (if set) against artifact.prolongationMode.
 * Returns 0.5 when no prolongation was planned.
 */
export function computeProlongationProxyScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const planned = plan.prolongationMode;
    if (!planned) return 0.5; // no prolongation expected

    const realised = artifact.prolongationMode;
    if (!realised) return 0.2; // planned but absent

    // Exact match is best; related modes (tonic ↔ pedal) get partial credit
    if (realised === planned) return 1.0;
    const related: Record<string, string> = {
        tonic: "pedal",
        pedal: "tonic",
        dominant: "sequential",
        sequential: "dominant",
    };
    if (related[planned] === realised) return 0.65;
    return 0.35;
}

// ---------------------------------------------------------------------------
// 7. Inner-voice motion score
// ---------------------------------------------------------------------------

/**
 * Proxies inner-voice motion quality.
 *
 * In a well-written common-practice piece, inner voices (alto/tenor, or the
 * accompanying mid-register voices in piano) should:
 *   - move independently of the bass (not lock-step)
 *   - provide harmonic filler via moderate pitch variety
 *   - contain some stepwise motion (not just repeated notes)
 *
 * Proxy evidence from SectionArtifactSummary:
 *   - textureIndependentMotionRate  → inner-voice independence of bass
 *   - accompanimentEvents pitch variety → harmonic filling
 *   - accompanimentEvents avg interval size → stepwise vs static
 *
 * Returns 0.5 when no accompaniment data is available.
 */
export function computeInnerVoiceMotionScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    // ── Independence rate (primary signal) ────────────────────────────────
    const independenceRate = artifact.textureIndependentMotionRate;
    const independenceScore = independenceRate !== undefined
        ? clamp01(0.3 + independenceRate * 0.7)
        : 0.5;

    // ── Accompaniment pitch variety (harmonic filler) ──────────────────────
    const accompNotes = artifact.accompanimentEvents
        .filter((e) => e.type === "note" && e.pitch !== undefined)
        .map((e) => e.pitch as number);

    let pitchVarietyScore = 0.5;
    if (accompNotes.length >= 4) {
        const pitchClasses = new Set(accompNotes.map((p) => p % 12)).size;
        // ≥ 3 distinct pitch classes = reasonable harmonic filler
        pitchVarietyScore = clamp01(0.2 + (pitchClasses / 7) * 0.8);
    }

    // ── Average interval in accompaniment (stepwise preferred over static) ─
    let stepwiseScore = 0.5;
    if (accompNotes.length >= 3) {
        const intervals = [];
        for (let i = 1; i < accompNotes.length; i++) {
            intervals.push(Math.abs((accompNotes[i] ?? 0) - (accompNotes[i - 1] ?? 0)));
        }
        const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
        // 1–4 semitones average = stepwise inner voice motion
        stepwiseScore =
            avgInterval === 0 ? 0.3  // static inner voices = poor
            : avgInterval <= 4 ? clamp01(0.5 + (avgInterval / 4) * 0.5)
            : clamp01(1 - (avgInterval - 4) / 8 * 0.5);  // too leapy
    }

    // ── Plan bonus: prolongation implies sustained inner voice movement ────
    const planBonus = plan.prolongationMode ? 0.05 : 0.0;

    return clamp01(0.40 * independenceScore + 0.30 * pitchVarietyScore + 0.25 * stepwiseScore + planBonus);
}

// ---------------------------------------------------------------------------
// 8. Forbidden progression penalty score
// ---------------------------------------------------------------------------

/**
 * Penalises evidence of forbidden progressions (docs §1.3):
 *   V → IV  : dominant resolving backward to pre-dominant
 *   I64 → I : second-inversion tonic resolving directly without V
 *   Tonic directly after dominant when plan expects full T→PD→D→T cycle
 *
 * Proxy evidence:
 *   - cadenceApproach === "plagal" when plan's sequence ends on "dominant" → V→IV smell
 *   - cad64 approach planned but cadenceApproach is "tonic" without dominant evidence
 *     (jumped over V) → I64 direct resolution smell
 *   - harmonicColorCues contain "harmonic_rhythm_shift" with no "predominant_color" in
 *     a section expecting T→PD→D→T → missing PD break
 *
 * Returns 1.0 when no forbidden patterns detected, approaching 0.0 with more violations.
 */
export function computeForbiddenProgressionPenaltyScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const approach = artifact.cadenceApproach;
    const colorCues = artifact.harmonicColorCues ?? [];
    let penalty = 0;

    // Proxy 1: V → IV smell — plagal close when plan expects dominant-function finale
    const planEndsOnDominant = plan.functionalSequence.length > 0
        && plan.functionalSequence[plan.functionalSequence.length - 1] === "dominant";
    if (planEndsOnDominant && approach === "plagal") {
        penalty += 0.35; // backward motion at close
    }

    // Proxy 2: I64 → I skip — cad64 planned but tonic arrived without dominant step
    // (artifact closes on "tonic" and has cadential_64 cue but no dominant approach)
    const hasCad64Cue = colorCues.some((c) => c.tag === "cadential_64");
    if (plan.cadenceApproach === "cad64" && approach === "tonic" && !hasCad64Cue) {
        penalty += 0.25; // cad64 bypassed
    }

    // Proxy 3: Missing PD in a full T→PD→D→T plan
    const planHasPD = plan.functionalSequence.includes("predominant");
    const hasPDEvidence = colorCues.some((c) =>
        c.tag === "predominant_color" || c.tag === "applied_dominant",
    );
    if (planHasPD && !hasPDEvidence && approach !== undefined) {
        penalty += 0.15; // PD expected but not detected
    }

    return clamp01(1.0 - penalty);
}

// ---------------------------------------------------------------------------
// 9. Cadential 6/4 detection score
// ---------------------------------------------------------------------------

/**
 * Validates the cadential 6/4 pattern (I64 → V7 → I) when it is planned.
 *
 * Strong evidence: artifact has "cadential_64" color cue AND cadenceApproach
 *   is "dominant" (V7 phase realised, not yet resolved) → 1.0
 * Partial: cadential_64 cue present but approach is already "tonic" (V7
 *   resolved through) → 0.75
 * Planned cad64 but no cue detected → 0.2
 * Plan is not cad64 → 0.5 (N/A)
 */
export function computeCad64DetectionScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    if (plan.cadenceApproach !== "cad64") return 0.5; // N/A

    const colorCues = artifact.harmonicColorCues ?? [];
    const hasCad64Cue = colorCues.some((c) => c.tag === "cadential_64");
    const approach = artifact.cadenceApproach;

    if (hasCad64Cue) {
        if (approach === "dominant") return 1.0;   // I64→V phase (V pending)
        if (approach === "tonic") return 0.75;     // I64→V→I fully resolved
        return 0.6;
    }

    if (approach === "dominant") return 0.5; // dominant close but no cue — ambiguous
    return 0.2; // cad64 planned but undetected
}

// ---------------------------------------------------------------------------
// 10. Harmonic rhythm acceleration score
// ---------------------------------------------------------------------------

/**
 * Scores whether the harmonic rhythm accelerates through the section as
 * expected for continuation-type and development sections.
 *
 * Evidence proxy: artifact.harmonicRealizationSummary
 *   peakDurationScaleDelta > 0  → durations increased (slowed) at peak → arch/deceleration
 *   peakDurationScaleDelta < 0  → durations shortened (accelerated) at peak → acceleration
 *
 * Matches plan.harmonicRhythmShape:
 *   slow→fast : peakDurationScaleDelta < 0 rewarded (acceleration)
 *   fast→slow : peakDurationScaleDelta > 0 rewarded (deceleration)
 *   arch      : magnitude small (near 0) rewarded (stable arch)
 *   slow/uniform: averageDurationScale ≥ 1.0 rewarded
 *
 * Returns 0.5 when no evidence available.
 */
export function computeHarmonicRhythmAccelerationScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const summary = artifact.harmonicRealizationSummary;
    const shape = plan.harmonicRhythmShape;
    if (!summary || !shape) return 0.5;

    const delta = summary.peakDurationScaleDelta ?? 0;
    const avg = summary.averageDurationScale ?? 1.0;

    switch (shape) {
        case "slow→fast":
            // Acceleration: peak durations shorten → delta negative; avg < 1 overall
            if (delta < -0.1 && avg < 1.05) return 1.0;
            if (delta < 0) return 0.75;
            return clamp01(0.5 - delta * 0.3);

        case "fast→slow":
            // Deceleration: peak durations lengthen → delta positive
            if (delta > 0.1 && avg >= 0.95) return 1.0;
            if (delta > 0) return 0.75;
            return clamp01(0.5 + delta * 0.3);

        case "arch":
            // Middle peak: delta near 0
            return clamp01(1.0 - Math.abs(delta) * 0.5);

        case "slow":
            return avg >= 1.1 ? 1.0 : clamp01(0.5 + (avg - 1.0) * 0.5);

        case "uniform":
        default:
            return clamp01(1.0 - Math.abs(avg - 1.0) * 0.6 - Math.abs(delta) * 0.3);
    }
}

// ---------------------------------------------------------------------------
// 11. Applied dominant resolution score
// ---------------------------------------------------------------------------

/**
 * Checks whether planned applied dominants resolve to their expected target.
 *
 * An applied dominant (V/X → X) should produce evidence of X being reached:
 *   - the artifact's tonicizationWindows should contain a matching keyTarget
 *   - OR harmonicColorCues include a "predominant_color" / "applied_dominant"
 *     with matching keyTarget
 *
 * Returns 0.5 when no applied dominant cues planned.
 * Returns 0.2 when cues planned but no resolution evidence.
 * Returns 0.7–1.0 proportionally to matched resolutions.
 */
export function computeAppliedDominantResolutionScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const plannedCues = plan.appliedDominantCues ?? [];
    if (plannedCues.length === 0) return 0.5;

    const tonicWindows = artifact.tonicizationWindows ?? [];
    const colorCues = artifact.harmonicColorCues ?? [];

    let resolved = 0;
    for (const cue of plannedCues) {
        if (!cue.keyTarget) { resolved += 0.5; continue; } // no target specified = partial credit
        const target = cue.keyTarget.split("/")[1]?.split(" ")[0]?.toLowerCase() ?? "";

        const foundInTonicization = tonicWindows.some(
            (w) => w.keyTarget?.toLowerCase().includes(target),
        );
        const foundInCues = colorCues.some(
            (c) => c.tag === "applied_dominant" && c.keyTarget?.toLowerCase().includes(target),
        );
        if (foundInTonicization || foundInCues) resolved++;
    }

    if (resolved === 0) return 0.2;
    return clamp01(0.2 + (resolved / plannedCues.length) * 0.8);
}

// ---------------------------------------------------------------------------
// 12. Mixture / Neapolitan / Aug6 resolution score
// ---------------------------------------------------------------------------

/**
 * Validates that chromatic color chords (mixture, Neapolitan, Aug6) resolve
 * in the expected direction: all three function as enhanced pre-dominants
 * and should therefore precede a dominant close, not resolve directly to tonic.
 *
 * Evidence:
 *   - colorCues contains "mixture" / "neapolitan" / "aug6"  AND  cadenceApproach "dominant"
 *     → correct PD→D resolution → 1.0
 *   - colorCues contains chromatic PD tag but cadenceApproach is "tonic"
 *     → possible skip of dominant → 0.5
 *   - No chromatic PD cues present → 0.5 (N/A)
 *
 * Penalise "plagal" close after chromatic PD tags (§1.3 V→IV equivalent).
 */
export function computeMixtureResolutionScore(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const colorCues = artifact.harmonicColorCues ?? [];
    const chromaticPDTags = new Set(["mixture", "neapolitan", "aug6"] as const);
    const hasChromaticPD = colorCues.some((c) => chromaticPDTags.has(c.tag as typeof chromaticPDTags extends Set<infer T> ? T : never));

    if (!hasChromaticPD) return 0.5; // N/A — no chromatic PD chords detected

    const approach = artifact.cadenceApproach;
    if (approach === "dominant") return 1.0; // correct: PD → D
    if (approach === "tonic") return 0.55;   // possible V resolved through
    if (approach === "plagal") return 0.2;   // V→IV smell after chromatic PD
    return 0.4;
}

// ---------------------------------------------------------------------------
// 13. Summary (updated with 5 new dimensions)
// ---------------------------------------------------------------------------

export interface HarmonyGrammarScoreSummary {
    pdtScore: number;
    appliedDominantScore: number;
    tonicizationDepthScore: number;
    harmonicRhythmConsistencyScore: number;
    cadenceApproachQualityScore: number;
    prolongationProxyScore: number;
    /** Inner-voice independence and stepwise filler motion (0–1). */
    innerVoiceMotionScore: number;
    /** Penalises evidence of V→IV, I64→I, and missing PD regressions (0–1). */
    forbiddenProgressionPenaltyScore: number;
    /** Detects cadential 6/4 (I64→V7→I) realisation when cad64 is planned (0–1). */
    cad64DetectionScore: number;
    /** Scores harmonic rhythm acceleration/deceleration matching plan shape (0–1). */
    harmonicRhythmAccelerationScore: number;
    /** Validates applied-dominant cues resolve to their intended target degree (0–1). */
    appliedDominantResolutionScore: number;
    /** Validates mixture/Neapolitan/Aug6 chords resolve to dominant, not plagal (0–1). */
    mixtureResolutionScore: number;
    /** Weighted composite. */
    overall: number;
}

// Weights must sum to 1.0 across all 12 dimensions.
const WEIGHTS = {
    pdt:                           0.15,
    appliedDominant:               0.08,
    tonicizationDepth:             0.08,
    harmonicRhythmConsistency:     0.08,
    cadenceApproachQuality:        0.13,
    prolongationProxy:             0.07,
    innerVoiceMotion:              0.08,
    forbiddenProgressionPenalty:   0.12,
    cad64Detection:                0.07,
    harmonicRhythmAcceleration:    0.06,
    appliedDominantResolution:     0.05,
    mixtureResolution:             0.03,
};

/**
 * Produces a HarmonyGrammarScoreSummary by running all twelve scoring dimensions.
 */
export function computeHarmonyGrammarScoreSummary(
    plan: HarmonyGrammarPlan,
    artifact: SectionArtifactSummary,
): HarmonyGrammarScoreSummary {
    const pdtScore = computePDTScore(plan, artifact);
    const appliedDominantScore = computeAppliedDominantScore(plan, artifact);
    const tonicizationDepthScore = computeTonicizationDepthScore(plan, artifact);
    const harmonicRhythmConsistencyScore = computeHarmonicRhythmConsistencyScore(plan, artifact);
    const cadenceApproachQualityScore = computeCadenceApproachQualityScore(plan, artifact);
    const prolongationProxyScore = computeProlongationProxyScore(plan, artifact);
    const innerVoiceMotionScore = computeInnerVoiceMotionScore(plan, artifact);
    const forbiddenProgressionPenaltyScore = computeForbiddenProgressionPenaltyScore(plan, artifact);
    const cad64DetectionScore = computeCad64DetectionScore(plan, artifact);
    const harmonicRhythmAccelerationScore = computeHarmonicRhythmAccelerationScore(plan, artifact);
    const appliedDominantResolutionScore = computeAppliedDominantResolutionScore(plan, artifact);
    const mixtureResolutionScore = computeMixtureResolutionScore(plan, artifact);

    const overall = clamp01(
        WEIGHTS.pdt                          * pdtScore
        + WEIGHTS.appliedDominant            * appliedDominantScore
        + WEIGHTS.tonicizationDepth          * tonicizationDepthScore
        + WEIGHTS.harmonicRhythmConsistency  * harmonicRhythmConsistencyScore
        + WEIGHTS.cadenceApproachQuality     * cadenceApproachQualityScore
        + WEIGHTS.prolongationProxy          * prolongationProxyScore
        + WEIGHTS.innerVoiceMotion           * innerVoiceMotionScore
        + WEIGHTS.forbiddenProgressionPenalty * forbiddenProgressionPenaltyScore
        + WEIGHTS.cad64Detection             * cad64DetectionScore
        + WEIGHTS.harmonicRhythmAcceleration * harmonicRhythmAccelerationScore
        + WEIGHTS.appliedDominantResolution  * appliedDominantResolutionScore
        + WEIGHTS.mixtureResolution          * mixtureResolutionScore,
    );

    return {
        pdtScore,
        appliedDominantScore,
        tonicizationDepthScore,
        harmonicRhythmConsistencyScore,
        cadenceApproachQualityScore,
        prolongationProxyScore,
        innerVoiceMotionScore,
        forbiddenProgressionPenaltyScore,
        cad64DetectionScore,
        harmonicRhythmAccelerationScore,
        appliedDominantResolutionScore,
        mixtureResolutionScore,
        overall,
    };
}
