import type {
    PeriodStructure,
    PhraseGrammarPlan,
    PhraseUnit,
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
    if (structure.type === "period") {
        return scorePeriodPeaks(structure, peaks, totalMeasures);
    }
    // phrase_group: neutral — no single canonical peak window defined
    return 0.5;
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

    // sentence or phrase_group (phrase_group has no fixed cadential unit → neutral)
    if (structure.type !== "sentence") return 0.5;
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
            : structure.type === "period"
            ? structure.consequent.cadenceType === "authentic"
            : true; // phrase_group: both phrases always end authentic

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
// 5. Sentence 2+2+4 ratio score
// ---------------------------------------------------------------------------

/**
 * Validates that a sentence structure follows canonical 2+2+4 proportions:
 * basicIdea ≈ 25%, repetition ≈ 25%, continuation+cadential ≈ 50%.
 *
 * Returns 0.5 for non-sentence structures (N/A).
 */
export function computeSentenceRatioScore(plan: PhraseGrammarPlan): number {
    if (plan.structure.type !== "sentence") return 0.5;
    const s: SentenceStructure = plan.structure;
    const total = (s.totalMeasures ?? plan.totalMeasures);
    if (!total) return 0.5;

    const unitMeasures = (u: PhraseUnit): number =>
        u.measures ?? (u.endMeasure !== undefined ? u.endMeasure - u.startMeasure + 1 : 0);

    const presentationRatio = unitMeasures(s.basicIdea) / total;
    const repetitionRatio = unitMeasures(s.repetition) / total;
    const continuationRatio = (unitMeasures(s.continuation) + unitMeasures(s.cadential)) / total;

    // Ideal targets: 0.25 / 0.25 / 0.50
    const error =
        Math.abs(presentationRatio - 0.25)
        + Math.abs(repetitionRatio - 0.25)
        + Math.abs(continuationRatio - 0.50);

    return clamp01(1.0 - error * 2.0);
}

// ---------------------------------------------------------------------------
// 6. Period 4+4 balance score
// ---------------------------------------------------------------------------

/**
 * Validates that a period structure has balanced antecedent and consequent
 * halves (each ≈ 50% of total measures).
 *
 * Returns 0.5 for non-period structures (N/A).
 */
export function computePeriodBalanceScore(plan: PhraseGrammarPlan): number {
    if (plan.structure.type !== "period") return 0.5;
    const p: PeriodStructure = plan.structure;
    const total = (p.totalMeasures ?? plan.totalMeasures);
    if (!total) return 0.5;

    const unitMeasures = (u: PhraseUnit): number =>
        u.measures ?? (u.endMeasure !== undefined ? u.endMeasure - u.startMeasure + 1 : 0);

    const antecedentRatio = unitMeasures(p.antecedent) / total;
    const consequentRatio = unitMeasures(p.consequent) / total;

    // Ideal: both 0.5
    const error = Math.abs(antecedentRatio - 0.5) + Math.abs(consequentRatio - 0.5);
    return clamp01(1.0 - error * 2.0);
}

// ---------------------------------------------------------------------------
// 7. Antecedent HC / consequent PAC cadence pair score
// ---------------------------------------------------------------------------

/**
 * For period structures: validates the canonical HC→PAC pair.
 * antecedent should carry a half cadence, consequent an authentic cadence.
 *
 * Returns 0.5 for non-period structures (N/A).
 * Returns 1.0 when both cadence types are correct.
 * Returns 0.5 when only one of the two is correct.
 * Returns 0.0 when both are wrong (e.g. both authentic, or both half).
 */
export function computeAntecedentConsequentCadenceScore(plan: PhraseGrammarPlan): number {
    if (plan.structure.type !== "period") return 0.5;
    const p: PeriodStructure = plan.structure;

    const antecedentCorrect = p.antecedent.cadenceType === "half";
    const consequentCorrect = p.consequent.cadenceType === "authentic";

    if (antecedentCorrect && consequentCorrect) return 1.0;
    if (antecedentCorrect || consequentCorrect) return 0.5;
    return 0.0;
}

// ---------------------------------------------------------------------------
// 8. Cadence structural position score
// ---------------------------------------------------------------------------

/**
 * Validates that the planned cadence falls at a metrically strong position.
 *
 * Uses `plan.phrasePlan.cadencePlacement.measure` when available.
 * Strong positions: the final measure of the section, or any multiple of 4.
 * Half-strong: multiples of 2 (but not 4).
 * Weak: odd measures.
 *
 * Returns 0.5 when no cadencePlacement is recorded.
 */
export function computeCadenceStructuralPositionScore(plan: PhraseGrammarPlan): number {
    const cadenceMeasure = plan.phrasePlan?.cadencePlacement?.measure;
    if (cadenceMeasure === undefined) return 0.5;

    const total = plan.totalMeasures;

    // Terminal measure is always a strong position
    if (cadenceMeasure === total) return 1.0;
    if (cadenceMeasure % 4 === 0) return 1.0;
    if (cadenceMeasure % 2 === 0) return 0.75;
    return 0.4;
}

// ---------------------------------------------------------------------------
// 9. Hypermetric stability score
// ---------------------------------------------------------------------------

/**
 * Validates that hypermetric groups have consistent span sizes matching the
 * expected hypermeterUnit (from phrasePlan when present, otherwise derived
 * from totalMeasures).
 *
 * All groups same span → 1.0; mixed spans reduce proportionally.
 */
export function computeHypermetricStabilityScore(plan: PhraseGrammarPlan): number {
    const groups = plan.hypermetricGroups;
    if (groups.length === 0) return 0.5;

    const spans = groups.map((g) => g.endMeasure - g.startMeasure + 1);

    // Find modal span (most common) as the reference unit
    const spanFreq = new Map<number, number>();
    for (const s of spans) spanFreq.set(s, (spanFreq.get(s) ?? 0) + 1);
    let modalSpan = spans[0]!;
    let maxFreq = 0;
    for (const [span, freq] of spanFreq) {
        if (freq > maxFreq) { maxFreq = freq; modalSpan = span; }
    }

    const stability = maxFreq / spans.length;

    // If phrasePlan specifies hypermeterUnit, reward alignment
    const expectedUnit = plan.phrasePlan?.hypermeterUnit;
    if (expectedUnit !== undefined && modalSpan !== expectedUnit) {
        return clamp01(stability * 0.7);
    }

    return clamp01(stability);
}

// ---------------------------------------------------------------------------
// 10. Summary (updated with new dimensions)
// ---------------------------------------------------------------------------

export interface PhraseGrammarScoreSummary {
    phrasePeakScore: number;
    cadencePlacementScore: number;
    hypermetricRegularityScore: number;
    phraseClosureScore: number;
    /** Sentence 2+2+4 structural proportion (N/A=0.5 for non-sentence). */
    sentenceRatioScore: number;
    /** Period 4+4 antecedent/consequent balance (N/A=0.5 for non-period). */
    periodBalanceScore: number;
    /** Period HC→PAC cadence pair validation (N/A=0.5 for non-period). */
    antecedentConsequentCadenceScore: number;
    /** Cadence placement on a metrically strong position (0.5 if unknown). */
    cadenceStructuralPositionScore: number;
    /** Hypermetric group span consistency (0.5 if no groups). */
    hypermetricStabilityScore: number;
    /** Weighted composite (all nine dimensions). */
    overall: number;
}

const WEIGHTS = {
    phrasePeak:                    0.15,
    cadencePlacement:              0.15,
    hypermetricRegularity:         0.10,
    phraseClosureScore:            0.15,
    sentenceRatio:                 0.10,
    periodBalance:                 0.10,
    antecedentConsequentCadence:   0.15,
    cadenceStructuralPosition:     0.05,
    hypermetricStability:          0.05,
};

/**
 * Produces a PhraseGrammarScoreSummary by running all nine scoring dimensions
 * and combining them into a weighted overall score.
 */
export function computePhraseGrammarScoreSummary(
    plan: PhraseGrammarPlan,
    artifact: SectionArtifactSummary,
): PhraseGrammarScoreSummary {
    const phrasePeakScore              = computePhrasePeakScore(plan, artifact);
    const cadencePlacementScore        = computeCadencePlacementScore(plan, artifact);
    const hypermetricRegularityScore   = computeHypermetricRegularityScore(plan, artifact);
    const phraseClosureScore           = computePhraseClosureScore(plan, artifact);
    const sentenceRatioScore           = computeSentenceRatioScore(plan);
    const periodBalanceScore           = computePeriodBalanceScore(plan);
    const antecedentConsequentCadenceScore = computeAntecedentConsequentCadenceScore(plan);
    const cadenceStructuralPositionScore   = computeCadenceStructuralPositionScore(plan);
    const hypermetricStabilityScore    = computeHypermetricStabilityScore(plan);

    const overall = clamp01(
        WEIGHTS.phrasePeak                  * phrasePeakScore
        + WEIGHTS.cadencePlacement          * cadencePlacementScore
        + WEIGHTS.hypermetricRegularity     * hypermetricRegularityScore
        + WEIGHTS.phraseClosureScore        * phraseClosureScore
        + WEIGHTS.sentenceRatio             * sentenceRatioScore
        + WEIGHTS.periodBalance             * periodBalanceScore
        + WEIGHTS.antecedentConsequentCadence * antecedentConsequentCadenceScore
        + WEIGHTS.cadenceStructuralPosition * cadenceStructuralPositionScore
        + WEIGHTS.hypermetricStability      * hypermetricStabilityScore,
    );

    return {
        phrasePeakScore,
        cadencePlacementScore,
        hypermetricRegularityScore,
        phraseClosureScore,
        sentenceRatioScore,
        periodBalanceScore,
        antecedentConsequentCadenceScore,
        cadenceStructuralPositionScore,
        hypermetricStabilityScore,
        overall,
    };
}
