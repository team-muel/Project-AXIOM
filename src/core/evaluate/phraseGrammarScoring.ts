import type {
    PeriodStructure,
    PhraseGrammarPlan,
    SectionArtifactSummary,
    SentenceStructure,
} from "../pipeline/types.js";

// phraseGrammarScoring.ts — Phrase grammar quality evaluator
// ──────────────────────────────────────────────────────────────────────────────
// Scores how well a rendered section fulfils its phrase grammar plan.
// All functions return a value in [0,1].
// Input: PhraseGrammarPlan (from phraseGrammar.ts) + SectionArtifactSummary.
// ──────────────────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// 1. Phrase peak score
// ---------------------------------------------------------------------------

/**
 * Checks whether the observed phrase peaks land in the expected structural windows.
 *
 * Sentence: canonical peak lives in the cadential unit (last quarter).
 * Period:   two peaks expected, one in each half (antecedent + consequent).
 *
 * Returns 0.5 when no phrasePeaks are recorded (neutral — data not available).
 */
export function computePhrasePeakScore(
    plan: PhraseGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const peaks = artifact.phrasePeaks;
    if (!peaks || peaks.length === 0) return 0.5;

    const { structure, totalMeasures } = plan;

    if (structure.type === "sentence") {
        return scoreSentencePeaks(structure, peaks, totalMeasures);
    }
    return scorePeriodPeaks(structure, peaks, totalMeasures);
}

function scoreSentencePeaks(
    s: SentenceStructure,
    peaks: number[],
    totalMeasures: number,
): number {
    // Expected peak window: continuation start → end of cadential unit
    const windowStart = s.continuation.startMeasure;
    const windowEnd = totalMeasures;

    const peaksInWindow = peaks.filter((m) => m >= windowStart && m <= windowEnd);
    if (peaksInWindow.length === 0) return 0.3; // peak misplaced
    if (peaks.length === 1) return 1.0;         // single peak in window = ideal

    // Multiple peaks: penalise by count (too many peaks dilutes climax identity)
    return clamp01(1.0 - (peaks.length - 1) * 0.15);
}

function scorePeriodPeaks(
    p: PeriodStructure,
    peaks: number[],
    _totalMeasures: number,
): number {
    const antecedentEnd = p.antecedent.startMeasure + p.antecedent.measures - 1;
    const consequentStart = p.consequent.startMeasure;
    const consequentEnd = p.consequent.startMeasure + p.consequent.measures - 1;

    const inAntecedent = peaks.some((m) => m >= p.antecedent.startMeasure && m <= antecedentEnd);
    const inConsequent = peaks.some((m) => m >= consequentStart && m <= consequentEnd);

    if (inAntecedent && inConsequent) return 1.0;  // both halves have peaks
    if (inAntecedent || inConsequent) return 0.65; // only one half
    return 0.3;                                     // peaks outside expected zones
}

// ---------------------------------------------------------------------------
// 2. Cadence placement score
// ---------------------------------------------------------------------------

/**
 * Evaluates whether the section's realised cadence approach matches the
 * planned cadence type for the terminal phrase unit.
 *
 * Period consequent → authentic cadence → artifact should end on "tonic" or "dominant".
 * Sentence cadential → authentic cadence → artifact should end on "dominant".
 * Otherwise → neutral.
 */
export function computeCadencePlacementScore(
    plan: PhraseGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const approach = artifact.cadenceApproach;
    if (!approach) return 0.5;

    const { structure } = plan;

    if (structure.type === "period") {
        const terminalCadence = structure.consequent.cadenceType;
        return matchCadenceApproach(terminalCadence ?? "authentic", approach);
    }

    // sentence
    const terminalCadence = structure.cadential.cadenceType;
    return matchCadenceApproach(terminalCadence ?? "authentic", approach);
}

function matchCadenceApproach(
    planned: string,
    realised: string,
): number {
    // perfect match
    if (planned === "authentic" && (realised === "dominant" || realised === "tonic")) return 1.0;
    if (planned === "half" && realised === "dominant") return 1.0;
    if (planned === "plagal" && realised === "tonic") return 0.9;
    if (planned === "deceptive" && (realised === "other" || realised === "tonic")) return 0.8;
    if (realised === "other") return 0.4;  // unclassified — mild penalty
    return 0.5;
}

// ---------------------------------------------------------------------------
// 3. Hypermetric regularity score
// ---------------------------------------------------------------------------

/**
 * Scores how regularly the hypermetric groups divide the section.
 * All groups having the same measure span = 1.0.
 * Irregular groups (varying spans) reduce the score proportionally.
 */
export function computeHypermetricRegularityScore(
    plan: PhraseGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const groups = plan.hypermetricGroups;
    if (groups.length === 0) return 0.5;

    const spans = groups.map((g) => g.endMeasure - g.startMeasure + 1);
    const first = spans[0]!;
    const isRegular = spans.every((s) => s === first);

    if (isRegular) {
        // Check artifact measure count aligns with plan
        const countMatch =
            artifact.measureCount === plan.totalMeasures ? 1.0
            : clamp01(1.0 - Math.abs(artifact.measureCount - plan.totalMeasures) / plan.totalMeasures);
        return countMatch;
    }

    // Irregular: penalise by variation ratio
    const maxSpan = Math.max(...spans);
    const minSpan = Math.min(...spans);
    const variation = (maxSpan - minSpan) / maxSpan;
    return clamp01(1.0 - variation * 0.6);
}

// ---------------------------------------------------------------------------
// 4. Phrase closure score
// ---------------------------------------------------------------------------

/**
 * Estimates phrase closure quality from phrase function and final note context.
 *
 * - A section marked phraseFunction="cadential" that ends on expected resolution
 *   gets the highest score.
 * - Incomplete / open phrases (continuation, developmental) get a moderate score.
 */
export function computePhraseClosureScore(
    plan: PhraseGrammarPlan,
    artifact: SectionArtifactSummary,
): number {
    const pf = artifact.phraseFunction;
    const { structure } = plan;

    // Sections ending with an authentic cadential unit → expect closure
    const planEndsAuthentic =
        structure.type === "sentence"
            ? structure.cadential.cadenceType === "authentic"
            : structure.consequent.cadenceType === "authentic";

    if (!pf) {
        // No phrase function recorded — use cadence approach as proxy
        const approach = artifact.cadenceApproach;
        if (approach === "tonic") return 1.0;
        if (approach === "dominant") return 0.75;
        return 0.5;
    }

    if (planEndsAuthentic) {
        // Strong closure expected
        if (pf === "cadential") return 1.0;
        if (pf === "continuation") return 0.55;
        if (pf === "developmental") return 0.45;
        if (pf === "transition") return 0.50;
        return 0.6;
    }

    // Open / half-cadence intended — continuation is fine
    if (pf === "continuation") return 1.0;
    if (pf === "cadential") return 0.75; // premature closure
    if (pf === "developmental") return 0.85;
    return 0.7;
}

// ---------------------------------------------------------------------------
// 5. Summary
// ---------------------------------------------------------------------------

export interface PhraseGrammarScoreSummary {
    phrasePeakScore: number;
    cadencePlacementScore: number;
    hypermetricRegularityScore: number;
    phraseClosureScore: number;
    /** Weighted composite (all four dimensions). */
    overall: number;
}

const WEIGHTS = {
    phrasePeak: 0.25,
    cadencePlacement: 0.30,
    hypermetricRegularity: 0.20,
    phraseClosureScore: 0.25,
};

/**
 * Produces a PhraseGrammarScoreSummary by running all four scoring dimensions
 * and combining them into a weighted overall score.
 */
export function computePhraseGrammarScoreSummary(
    plan: PhraseGrammarPlan,
    artifact: SectionArtifactSummary,
): PhraseGrammarScoreSummary {
    const phrasePeakScore         = computePhrasePeakScore(plan, artifact);
    const cadencePlacementScore   = computeCadencePlacementScore(plan, artifact);
    const hypermetricRegularityScore = computeHypermetricRegularityScore(plan, artifact);
    const phraseClosureScore      = computePhraseClosureScore(plan, artifact);

    const overall = clamp01(
        WEIGHTS.phrasePeak             * phrasePeakScore
        + WEIGHTS.cadencePlacement     * cadencePlacementScore
        + WEIGHTS.hypermetricRegularity * hypermetricRegularityScore
        + WEIGHTS.phraseClosureScore   * phraseClosureScore,
    );

    return {
        phrasePeakScore,
        cadencePlacementScore,
        hypermetricRegularityScore,
        phraseClosureScore,
        overall,
    };
}
