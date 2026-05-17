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
// Four domains:
//   Phrase  — phrasePeaks, cadenceApproach, phraseFunction, measureCount match
//   Harmony — harmonicColorCues, harmonicRealizationSummary, cadenceApproach,
//             tonicizationWindows (when planned)
//   Motif   — capturedMotif, transform artifact (for non-theme_a sections)
//   Piano   — rightHandEvents, leftHandEvents, pianoPlayabilityScore,
//             pianoHandSpan (any of pianoHandSpanMax / pianoHandSpanAverage)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Three-tier evidence coverage label.
 *
 * full     overallCoverage >= 0.75 — all domains well-evidenced
 * reduced  0.50 <= overallCoverage < 0.75 — some evidence missing; apply penalty
 * failed   overallCoverage < 0.50 — critically under-evidenced; demote tier
 */
export type EvidenceCoverageGateTier = "full" | "reduced" | "failed";

export interface EvidenceCoverageReport {
    /** Fraction of required phrase evidence present across evaluated sections (0–1). */
    phraseEvidenceCoverage: number;
    /** Fraction of required harmony evidence present across evaluated sections (0–1). */
    harmonyEvidenceCoverage: number;
    /** Fraction of required motif evidence present across evaluated sections (0–1). */
    motifEvidenceCoverage: number;
    /**
     * Fraction of required piano evidence present across piano sections (0–1).
     * 0.5 neutral when no piano sections were detected.
     */
    pianoEvidenceCoverage: number;
    /** Average of all non-neutral domain scores (0–1). */
    overallCoverage: number;
    /** Number of sections evaluated per domain. */
    phraseSectionsEvaluated: number;
    harmonySectionsEvaluated: number;
    motifSectionsEvaluated: number;
    pianoSectionsEvaluated: number;
    /**
     * Gate tier derived from overallCoverage:
     *   full     >= 0.75
     *   reduced  >= 0.50
     *   failed   < 0.50
     */
    gateTier: EvidenceCoverageGateTier;
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

/** overallCoverage >= this → "full" tier */
const GATE_TIER_FULL_THRESHOLD    = 0.75;
/** overallCoverage >= this → "reduced" tier (else "failed") */
const GATE_TIER_REDUCED_THRESHOLD = 0.50;

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
// Domain: piano evidence
// ---------------------------------------------------------------------------

/**
 * Returns the fraction of expected piano evidence present in the artifact.
 * Only called for artifacts that went through the piano rendering path
 * (detected by the presence of `rightHandEvents` or `leftHandEvents`).
 *
 * Checks:
 *   rightHandEvents      — at least one RH event was produced            (weight 1)
 *   leftHandEvents       — at least one LH event was produced            (weight 1)
 *   pianoPlayabilityScore — playability was computed by the renderer     (weight 1)
 *   pianoHandSpan        — hand span metrics present (max or average)    (weight 1)
 *
 * Score = present / 4.
 */
export function computePianoEvidenceCoverage(
    artifact: SectionArtifactSummary,
): number {
    const checks: boolean[] = [
        (artifact.rightHandEvents?.length ?? 0) > 0,
        (artifact.leftHandEvents?.length ?? 0) > 0,
        artifact.pianoPlayabilityScore !== undefined,
        artifact.pianoHandSpanMax !== undefined || artifact.pianoHandSpanAverage !== undefined,
    ];
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

function resolveGateTier(overallCoverage: number): EvidenceCoverageGateTier {
    if (overallCoverage >= GATE_TIER_FULL_THRESHOLD)    return "full";
    if (overallCoverage >= GATE_TIER_REDUCED_THRESHOLD) return "reduced";
    return "failed";
}

/**
 * Computes an EvidenceCoverageReport by iterating all plan sections that
 * carry the relevant grammar annotation.
 *
 * Sections without a phraseGrammar plan contribute nothing to phrase coverage
 * (and are therefore neutral); same for harmony and motif domains.
 *
 * Piano coverage is computed for any section whose artifact contains
 * rightHandEvents or leftHandEvents (piano rendering pathway).
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
    const pianoScores: number[] = [];

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

        // Piano domain: any section that went through the piano rendering path.
        if (
            (artifact.rightHandEvents !== undefined || artifact.leftHandEvents !== undefined) &&
            (artifact.rightHandEvents !== null || artifact.leftHandEvents !== null)
        ) {
            pianoScores.push(computePianoEvidenceCoverage(artifact));
        }
    }

    // When plan is empty / missing, fall back to scanning all artifacts directly.
    if (planSections.length === 0) {
        for (const artifact of sectionArtifacts) {
            if (artifact.rightHandEvents !== undefined || artifact.leftHandEvents !== undefined) {
                pianoScores.push(computePianoEvidenceCoverage(artifact));
            }
        }
    }

    const phraseEvidenceCoverage  = domainAverage(phraseScores,  0.5);
    const harmonyEvidenceCoverage = domainAverage(harmonyScores, 0.5);
    const motifEvidenceCoverage   = domainAverage(motifScores,   0.5);
    const pianoEvidenceCoverage   = domainAverage(pianoScores,   0.5);

    // overallCoverage averages only domains that were actually evaluated
    // (domains with 0 sections use neutral 0.5 but still contribute).
    const overallCoverage = (
        phraseEvidenceCoverage +
        harmonyEvidenceCoverage +
        motifEvidenceCoverage +
        pianoEvidenceCoverage
    ) / 4;

    const coveragePenalty = Math.max(
        0,
        (COVERAGE_PENALTY_THRESHOLD - overallCoverage) * COVERAGE_PENALTY_SCALE,
    );

    return {
        phraseEvidenceCoverage,
        harmonyEvidenceCoverage,
        motifEvidenceCoverage,
        pianoEvidenceCoverage,
        overallCoverage,
        phraseSectionsEvaluated:  phraseScores.length,
        harmonySectionsEvaluated: harmonyScores.length,
        motifSectionsEvaluated:   motifScores.length,
        pianoSectionsEvaluated:   pianoScores.length,
        gateTier: resolveGateTier(overallCoverage),
        coveragePenalty,
    };
}
