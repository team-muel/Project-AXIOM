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
// 7. Summary
// ---------------------------------------------------------------------------

export interface HarmonyGrammarScoreSummary {
    pdtScore: number;
    appliedDominantScore: number;
    tonicizationDepthScore: number;
    harmonicRhythmConsistencyScore: number;
    cadenceApproachQualityScore: number;
    prolongationProxyScore: number;
    /** Weighted composite. */
    overall: number;
}

const WEIGHTS = {
    pdt: 0.25,
    appliedDominant: 0.15,
    tonicizationDepth: 0.15,
    harmonicRhythmConsistency: 0.15,
    cadenceApproachQuality: 0.20,
    prolongationProxy: 0.10,
};

/**
 * Produces a HarmonyGrammarScoreSummary by running all six scoring dimensions.
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

    const overall = clamp01(
        WEIGHTS.pdt                      * pdtScore
        + WEIGHTS.appliedDominant        * appliedDominantScore
        + WEIGHTS.tonicizationDepth      * tonicizationDepthScore
        + WEIGHTS.harmonicRhythmConsistency * harmonicRhythmConsistencyScore
        + WEIGHTS.cadenceApproachQuality * cadenceApproachQualityScore
        + WEIGHTS.prolongationProxy      * prolongationProxyScore,
    );

    return {
        pdtScore,
        appliedDominantScore,
        tonicizationDepthScore,
        harmonicRhythmConsistencyScore,
        cadenceApproachQualityScore,
        prolongationProxyScore,
        overall,
    };
}
