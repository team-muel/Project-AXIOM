import type {
    CompositionPlan,
    HarmonyGrammarPlan,
    PhraseGrammarPlan,
    SectionArtifactSummary,
    SectionPlan,
} from "../pipeline/types.js";

// evidenceCoverage.ts — Evidence coverage evaluator
// ──────────────────────────────────────────────────────────────────────────────
// Measures whether the rendered artifact produced enough observable evidence
// for each grammar domain to be meaningfully scored.
//
// Without evidence the grammar scorers return neutral 0.5 fallbacks that
// silently mask generator failures.  This module exposes that gap explicitly
// so that candidate selection can penalise under-evidenced outputs rather
// than silently accepting them.
//
// Three domains:
//   Phrase  — phrasePeaks, cadenceApproach, phraseFunction, measureCount match
//   Harmony — harmonicColorCues, harmonicRealizationSummary, cadenceApproach,
//             tonicizationWindows (when planned)
//   Motif   — capturedMotif, transform artifact (for non-theme_a sections)
// ──────────────────────────────────────────────────────────────────────────────

export interface EvidenceCoverageReport {
    /** Fraction of required phrase evidence present across evaluated sections (0–1). */
    phraseEvidenceCoverage: number;
    /** Fraction of required harmony evidence present across evaluated sections (0–1). */
    harmonyEvidenceCoverage: number;
    /** Fraction of required motif evidence present across evaluated sections (0–1). */
    motifEvidenceCoverage: number;
    /** Average of the three domain scores (0–1). */
    overallCoverage: number;
    /** Number of sections evaluated per domain. */
    phraseSectionsEvaluated: number;
    harmonySectionsEvaluated: number;
    motifSectionsEvaluated: number;
    /**
     * Penalty to subtract from finalCraftScore.
     * = max(0, (COVERAGE_THRESHOLD − overallCoverage) × PENALTY_SCALE)
     * Threshold = 0.50, scale = 0.20 → max penalty ≈ 0.10 when coverage = 0.
     */
    coveragePenalty: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COVERAGE_PENALTY_THRESHOLD = 0.50;
const COVERAGE_PENALTY_SCALE = 0.20;

// ---------------------------------------------------------------------------
// Domain: phrase evidence
// ---------------------------------------------------------------------------

/**
 * Returns the fraction of expected phrase evidence present in the artifact.
 *
 * Checks:
 *   phrasePeaks     — at least one peak was recorded                 (weight 1)
 *   cadenceApproach — approach annotation was produced               (weight 1)
 *   phraseFunction  — phrase function was recorded                   (weight 1)
 *   measureCount    — artifact measure count matches plan total      (weight 1)
 *
 * Score = present / 4.
 */
export function computePhraseEvidenceCoverage(
    artifact: SectionArtifactSummary,
    plan: PhraseGrammarPlan,
): number {
    const phrasePeaksOk     = (artifact.phrasePeaks?.length ?? 0) > 0;
    const cadenceOk         = artifact.cadenceApproach !== undefined;
    const phraseFunctionOk  = artifact.phraseFunction !== undefined;
    const measureCountOk    = artifact.measureCount > 0 && artifact.measureCount === plan.totalMeasures;

    const present = [phrasePeaksOk, cadenceOk, phraseFunctionOk, measureCountOk].filter(Boolean).length;
    return present / 4;
}

// ---------------------------------------------------------------------------
// Domain: harmony evidence
// ---------------------------------------------------------------------------

/**
 * Returns the fraction of expected harmony evidence present in the artifact.
 *
 * Checks (always expected):
 *   harmonicColorCues         — at least one cue was produced         (weight 1)
 *   harmonicRealizationSummary — summary was populated by renderer   (weight 1)
 *   cadenceApproach            — approach annotation present          (weight 1)
 *
 * Conditional check (only when plan includes a tonicization window):
 *   tonicizationWindows       — at least one window was realised      (weight 1)
 *
 * Score = present / total expected.
 */
export function computeHarmonyEvidenceCoverage(
    artifact: SectionArtifactSummary,
    plan: HarmonyGrammarPlan,
): number {
    const checks: boolean[] = [
        (artifact.harmonicColorCues?.length ?? 0) > 0,
        artifact.harmonicRealizationSummary !== undefined,
        artifact.cadenceApproach !== undefined,
    ];

    // Only require tonicization windows when the plan specifically asks for them.
    if (plan.tonicization) {
        checks.push((artifact.tonicizationWindows?.length ?? 0) > 0);
    }

    const present = checks.filter(Boolean).length;
    return present / checks.length;
}

// ---------------------------------------------------------------------------
// Domain: motif evidence
// ---------------------------------------------------------------------------

/**
 * Returns the fraction of expected motif evidence present in the artifact.
 *
 * Checks:
 *   capturedMotif — motif intervals were extracted from the output   (weight 1)
 *
 * For sections with a motifDevelopment plan (non-theme_a):
 *   transform     — a transform summary was produced                 (weight 1)
 *   plan entries  — the plan actually specifies transformation steps (weight 1)
 *
 * Score = present / total expected (1 or 3 depending on section role).
 */
export function computeMotifEvidenceCoverage(
    artifact: SectionArtifactSummary,
    planSection: SectionPlan,
): number {
    const checks: boolean[] = [
        (artifact.capturedMotif?.length ?? 0) > 0,
    ];

    // Additional checks for sections with an active motif development plan
    // (theme_a is the source, not a transform target).
    const motifPlan = planSection.motifDevelopment as { entries?: unknown[] } | undefined;
    if (motifPlan && artifact.role !== "theme_a") {
        checks.push(artifact.transform !== undefined);
        checks.push((motifPlan.entries?.length ?? 0) > 0);
    }

    const present = checks.filter(Boolean).length;
    return present / checks.length;
}

// ---------------------------------------------------------------------------
// Aggregate report
// ---------------------------------------------------------------------------

function domainAverage(scores: number[], neutralFallback: number): number {
    if (scores.length === 0) return neutralFallback;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Computes an EvidenceCoverageReport by iterating all plan sections that
 * carry the relevant grammar annotation.
 *
 * Sections without a phraseGrammar plan contribute nothing to phrase coverage
 * (and are therefore neutral); same for harmony and motif domains.
 *
 * When a domain has no evaluated sections the fallback is 0.5 (neutral —
 * not penalised, not rewarded).
 */
export function computeEvidenceCoverageReport(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
): EvidenceCoverageReport {
    const planSections = plan?.sections ?? [];
    const artifactById = new Map(sectionArtifacts.map((a) => [a.sectionId, a]));

    const phraseScores: number[] = [];
    const harmonyScores: number[] = [];
    const motifScores: number[] = [];

    for (const ps of planSections) {
        const artifact = artifactById.get(ps.id);
        if (!artifact) continue;

        // Phrase domain: only when a phraseGrammar plan is present.
        if (ps.phraseGrammar) {
            phraseScores.push(
                computePhraseEvidenceCoverage(artifact, ps.phraseGrammar as PhraseGrammarPlan),
            );
        }

        // Harmony domain: only when a harmonyGrammar plan is present.
        if (ps.harmonyGrammar) {
            harmonyScores.push(
                computeHarmonyEvidenceCoverage(artifact, ps.harmonyGrammar as HarmonyGrammarPlan),
            );
        }

        // Motif domain: theme_a (source) and any section with a motif plan.
        if (ps.role === "theme_a" || ps.motifDevelopment) {
            motifScores.push(computeMotifEvidenceCoverage(artifact, ps));
        }
    }

    const phraseEvidenceCoverage  = domainAverage(phraseScores,  0.5);
    const harmonyEvidenceCoverage = domainAverage(harmonyScores, 0.5);
    const motifEvidenceCoverage   = domainAverage(motifScores,   0.5);

    const overallCoverage = (phraseEvidenceCoverage + harmonyEvidenceCoverage + motifEvidenceCoverage) / 3;

    const coveragePenalty = Math.max(
        0,
        (COVERAGE_PENALTY_THRESHOLD - overallCoverage) * COVERAGE_PENALTY_SCALE,
    );

    return {
        phraseEvidenceCoverage,
        harmonyEvidenceCoverage,
        motifEvidenceCoverage,
        overallCoverage,
        phraseSectionsEvaluated:  phraseScores.length,
        harmonySectionsEvaluated: harmonyScores.length,
        motifSectionsEvaluated:   motifScores.length,
        coveragePenalty,
    };
}
