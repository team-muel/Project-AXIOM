/**
 * Listener-feedback preference model for final candidate selection.
 *
 * Role in the pipeline
 * ─────────────────────
 * craftScore  →  hard filter (reject structural garbage)
 *             →  shortlist ranking (sort by heuristic quality)
 * preferenceModel  →  final winner selection (from shortlist)
 *                  →  learns from accumulated listenerFeedback history
 *
 * Algorithm (cold-start safe)
 * ────────────────────────────
 * When ≥ MIN_FEEDBACK_SAMPLES rated candidates exist, the model computes a
 * per-dimension weight vector via partial correlation: for each internalScore
 * dimension (syntaxValidity, cadenceStrength, …), it measures how well that
 * dimension predicts listener appeal across past candidates.  Dimensions that
 * historically predict appeal gain higher weight; dimensions that do not are
 * down-weighted.
 *
 * When too few samples exist (cold-start), the model falls back to a uniform
 * heuristic weight vector derived from music-theoretic importance.
 *
 * The final preference score is a weighted dot product of the candidate's
 * internalScores against the learned (or default) weight vector, normalized
 * to [0, 1].
 *
 * Only candidates that pass the craft hard filter are eligible for preference
 * scoring; candidates that fail the hard filter are excluded from the shortlist
 * entirely.
 */

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { CraftScoreSummary } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum number of rated candidates before the learned weights are used. */
const MIN_FEEDBACK_SAMPLES = 5;

/** Maximum shortlist size passed to selectPreferredCandidate(). */
export const PREFERENCE_SHORTLIST_SIZE = 5;

/**
 * Hard-filter thresholds.  Any candidate whose craftScore falls below ALL of
 * these is rejected outright before shortlisting.  Individual dimension cuts
 * are intentionally lenient — they reject only structural garbage, not
 * imperfect-but-valid output.
 */
export const CRAFT_HARD_FILTER_THRESHOLDS: Partial<Record<keyof CraftScoreSummary, number>> = {
    syntaxValidity: 0.25,       // below this → unparseable / structurally incoherent
    sectionContractFit: 0.15,   // below this → section plan completely ignored
    finalCraftScore: 0.20,      // overall sanity floor
};

/**
 * Default weight vector used in cold-start (insufficient feedback history).
 * Sums to 1.0.  Reflects music-theoretic importance ordering:
 *   cadence ≈ tonal return > voice independence > motif > phrase > register > syntax
 */
const DEFAULT_DIMENSION_WEIGHTS: Record<string, number> = {
    cadenceStrength:     0.22,
    tonalReturn:         0.20,
    voiceIndependence:   0.18,
    motifSurvival:       0.14,
    phraseShape:         0.10,
    registerIdiomaticFit: 0.08,
    sectionContractFit:  0.05,
    syntaxValidity:      0.03,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A candidate entry slim enough to carry through the shortlist. */
export interface PreferenceCandidate {
    candidateId: string;
    craftSummary: CraftScoreSummary;
}

/** Slim feedback record read from persisted candidate manifests. */
interface FeedbackRecord {
    candidateId: string;
    appeal: number;          // 1–5
    internalScores: Record<string, number>;
}

/** Computed preference score for a candidate. */
export interface PreferenceScore {
    candidateId: string;
    preferenceScore: number;    // [0, 1]
    weightSource: "learned" | "default";
    dimensionContributions: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Hard filter
// ---------------------------------------------------------------------------

/**
 * Returns true when the candidate passes the craft hard filter and may proceed
 * to shortlisting and preference scoring.
 *
 * A candidate fails if ANY of the threshold dimensions falls below its floor.
 * The failure reason is written into `failReasons` when provided.
 */
export function craftScorePassesHardFilter(
    craft: CraftScoreSummary,
    failReasons?: string[],
): boolean {
    let passes = true;
    for (const [dim, threshold] of Object.entries(CRAFT_HARD_FILTER_THRESHOLDS)) {
        const value = (craft as unknown as Record<string, unknown>)[dim];
        if (typeof value === "number" && value < threshold) {
            failReasons?.push(`${dim}=${value.toFixed(3)} < floor ${threshold}`);
            passes = false;
        }
    }
    return passes;
}

// ---------------------------------------------------------------------------
// Feedback history loader
// ---------------------------------------------------------------------------

/**
 * Scans all candidate manifests for a song and returns those that have both
 * internalScores and a numeric appeal rating from listenerFeedback.
 */
export function loadFeedbackHistory(songId: string): FeedbackRecord[] {
    const candidatesRoot = path.join(config.outputDir, songId, "candidates");
    if (!fs.existsSync(candidatesRoot)) {
        return [];
    }

    const records: FeedbackRecord[] = [];
    let entries: string[];
    try {
        entries = fs.readdirSync(candidatesRoot);
    } catch {
        return [];
    }

    for (const candidateDir of entries) {
        const manifestPath = path.join(candidatesRoot, candidateDir, "candidate-manifest.json");
        if (!fs.existsSync(manifestPath)) {
            continue;
        }
        try {
            const raw = fs.readFileSync(manifestPath, "utf8");
            const manifest = JSON.parse(raw) as {
                candidateId?: string;
                internalScores?: Record<string, number>;
                listenerFeedback?: { appeal?: number };
            };
            const appeal = manifest.listenerFeedback?.appeal;
            if (
                typeof manifest.candidateId === "string"
                && manifest.internalScores
                && typeof appeal === "number"
                && appeal >= 1 && appeal <= 5
            ) {
                records.push({
                    candidateId: manifest.candidateId,
                    appeal,
                    internalScores: { ...manifest.internalScores },
                });
            }
        } catch {
            // skip malformed manifests
        }
    }
    return records;
}

// ---------------------------------------------------------------------------
// Weight vector computation
// ---------------------------------------------------------------------------

/**
 * Computes per-dimension weights from feedback history via simple
 * sign-agreement correlation: for each dimension, count how often a higher
 * dimension value coincides with a higher appeal score across all pairs.
 *
 * Returns null when the history is too short to be reliable.
 */
function computeLearnedWeights(history: FeedbackRecord[]): Record<string, number> | null {
    if (history.length < MIN_FEEDBACK_SAMPLES) {
        return null;
    }

    const dimensions = Object.keys(DEFAULT_DIMENSION_WEIGHTS);
    const agreementCounts: Record<string, number> = {};
    const pairCounts: Record<string, number> = {};

    for (const dim of dimensions) {
        agreementCounts[dim] = 0;
        pairCounts[dim] = 0;
    }

    for (let i = 0; i < history.length; i++) {
        for (let j = i + 1; j < history.length; j++) {
            const a = history[i]!;
            const b = history[j]!;
            const appealDelta = a.appeal - b.appeal;
            if (appealDelta === 0) continue;

            for (const dim of dimensions) {
                const va = a.internalScores[dim];
                const vb = b.internalScores[dim];
                if (typeof va !== "number" || typeof vb !== "number") continue;
                const dimDelta = va - vb;
                pairCounts[dim] = (pairCounts[dim] ?? 0) + 1;
                if (Math.sign(dimDelta) === Math.sign(appealDelta)) {
                    agreementCounts[dim] = (agreementCounts[dim] ?? 0) + 1;
                }
            }
        }
    }

    // Convert to raw agreement rate, then soften with default prior (Bayesian shrinkage)
    const PRIOR_STRENGTH = 3; // equivalent to ~3 pseudo-pairs of prior data
    const rawWeights: Record<string, number> = {};
    for (const dim of dimensions) {
        const pairs = pairCounts[dim] ?? 0;
        const agreements = agreementCounts[dim] ?? 0;
        const priorRate = DEFAULT_DIMENSION_WEIGHTS[dim] ?? (1 / dimensions.length);
        // Posterior: (agreements + prior * PRIOR_STRENGTH) / (pairs + PRIOR_STRENGTH)
        rawWeights[dim] = (agreements + priorRate * PRIOR_STRENGTH) / (pairs + PRIOR_STRENGTH);
    }

    // Normalize to sum = 1.0
    const total = Object.values(rawWeights).reduce((sum, w) => sum + w, 0);
    if (total < 1e-9) return null;
    const normalized: Record<string, number> = {};
    for (const dim of dimensions) {
        normalized[dim] = (rawWeights[dim] ?? 0) / total;
    }
    return normalized;
}

// ---------------------------------------------------------------------------
// Preference scoring
// ---------------------------------------------------------------------------

/**
 * Computes a preference score in [0, 1] for a single candidate given the
 * feedback history for this song.  The score is a weighted sum of the
 * craftSummary dimensions using either learned or default weights.
 */
export function computePreferenceScore(
    candidate: PreferenceCandidate,
    history: FeedbackRecord[],
): PreferenceScore {
    const learnedWeights = computeLearnedWeights(history);
    const weights = learnedWeights ?? DEFAULT_DIMENSION_WEIGHTS;
    const weightSource: PreferenceScore["weightSource"] = learnedWeights ? "learned" : "default";

    const craft = candidate.craftSummary as unknown as Record<string, unknown>;
    let weighted = 0;
    const dimensionContributions: Record<string, number> = {};

    for (const [dim, w] of Object.entries(weights)) {
        const value = typeof craft[dim] === "number" ? (craft[dim] as number) : 0.5;
        const contribution = w * value;
        dimensionContributions[dim] = Number(contribution.toFixed(4));
        weighted += contribution;
    }

    return {
        candidateId: candidate.candidateId,
        preferenceScore: Number(Math.max(0, Math.min(1, weighted)).toFixed(4)),
        weightSource,
        dimensionContributions,
    };
}

// ---------------------------------------------------------------------------
// Shortlist selection
// ---------------------------------------------------------------------------

/**
 * Selects the preferred candidate from a shortlist using the preference model.
 *
 * Steps:
 *   1. Discard candidates that fail the craft hard filter.
 *   2. If no candidate passes the filter, fall back to the first element.
 *   3. Score each passing candidate via the preference model.
 *   4. Return the highest-scoring candidate id plus diagnostic metadata.
 *
 * @param shortlist   Up to PREFERENCE_SHORTLIST_SIZE candidates, pre-ranked
 *                    by heuristic structure score (best first).
 * @param songId      Used to load feedback history from persisted manifests.
 * @returns Selected candidateId and diagnostic scores for logging.
 */
export function selectPreferredCandidate(
    shortlist: PreferenceCandidate[],
    songId: string,
): {
    selectedCandidateId: string;
    scores: PreferenceScore[];
    filteredOutIds: string[];
    feedbackSamples: number;
} {
    if (shortlist.length === 0) {
        throw new Error("selectPreferredCandidate: shortlist is empty");
    }

    const history = loadFeedbackHistory(songId);

    // Hard filter
    const filteredOutIds: string[] = [];
    const eligible = shortlist.filter((candidate) => {
        const reasons: string[] = [];
        if (craftScorePassesHardFilter(candidate.craftSummary, reasons)) {
            return true;
        }
        filteredOutIds.push(candidate.candidateId);
        return false;
    });

    const pool = eligible.length > 0 ? eligible : shortlist; // graceful fallback

    // Preference scoring
    const scores = pool.map((candidate) => computePreferenceScore(candidate, history));
    scores.sort((a, b) => b.preferenceScore - a.preferenceScore);

    return {
        selectedCandidateId: scores[0]!.candidateId,
        scores,
        filteredOutIds,
        feedbackSamples: history.length,
    };
}
