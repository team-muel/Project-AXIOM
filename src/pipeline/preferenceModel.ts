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
 * Priority 1 — Reranker snapshot (logistic regression, trained offline):
 *   When outputs/_system/preference-reranker-snapshot.json exists AND has
 *   sampleCount >= MIN_RERANKER_SAMPLES, each candidate is scored via the
 *   logistic regression coefficients (sigmoid of dot product after
 *   standardization). weightSource = "reranker".
 *
 * Priority 2 — Global pairwise learned weights:
 *   When ≥ MIN_FEEDBACK_SAMPLES rated candidates exist across ALL song
 *   directories (outputs/&lt;songId&gt;/candidates), computes per-dimension weights via
 *   pairwise sign-agreement correlation against the global history.
 *   weightSource = "learned".
 *
 * Priority 3 — Song-local pairwise learned weights:
 *   When ≥ MIN_FEEDBACK_SAMPLES rated candidates exist for the current song
 *   only (useful for per-song retry/refinement loops when global history is
 *   too sparse). weightSource = "learned".
 *
 * Priority 4 — Cold-start default:
 *   Uniform heuristic weights derived from music-theoretic importance.
 *   weightSource = "default".
 *
 * Only candidates that pass the craft hard filter are eligible for preference
 * scoring; candidates that fail the hard filter are excluded from the shortlist
 * entirely.
 */

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { CraftScoreSummary, PianoCraftScoreSummary } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum number of rated candidates before the pairwise learned weights are used. */
const MIN_FEEDBACK_SAMPLES = 5;

/** Minimum sampleCount in a reranker snapshot before it is trusted. */
const MIN_RERANKER_SAMPLES = 10;

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

/**
 * Default weight vector for solo_piano lane candidates (cold-start).
 * Keys are prefixed with `piano_` to match the flattened internalScores
 * keys stored in candidate manifests by the piano pipeline.
 *
 * Priority ordering mirrors the piano craft score weights (see pianoCraftScoring.ts)
 * but re-normalised to include evidence-derived dimensions that are not part of
 * PianoCraftScoreSummary (playabilityScore, handSpanNorm, registerCollisionNorm).
 *
 * Sums to 1.0.
 */
const PIANO_DEFAULT_DIMENSION_WEIGHTS: Record<string, number> = {
    piano_finalPianoScore:               0.20,
    piano_handPlayability:               0.17,
    piano_melodicClarity:                0.13,
    piano_bassCoherence:                 0.12,
    piano_voicingIdiomaticFit:           0.10,
    piano_accompanimentPatternCoherence: 0.08,
    piano_registerSpacing:               0.07,
    piano_handIndependence:              0.05,
    piano_pedalPlausibility:             0.04,
    piano_playabilityScore:              0.02,
    piano_handSpanNorm:                  0.01,
    piano_registerCollisionNorm:         0.01,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A candidate entry slim enough to carry through the shortlist. */
export interface PreferenceCandidate {
    candidateId: string;
    craftSummary: CraftScoreSummary;
    /**
     * Piano craft score summary.  When present, the candidate is treated as a
     * solo_piano lane candidate and piano-specific ranking dimensions replace the
     * generic craft dimensions in all preference model paths (default weights,
     * learned weights, reranker feature vector).
     */
    pianoCraftSummary?: PianoCraftScoreSummary;
    /**
     * Normalised evidence value: max simultaneous hand span in semitones.
     * Stored separately because it comes from SectionArtifactSummary evidence
     * rather than PianoCraftScoreSummary.  Used in ranking as
     * `piano_handSpanNorm = max(0, 1 - max(0, handSpanMax - 12) / 12)`.
     */
    pianoHandSpanMax?: number;
    /**
     * Number of RH/LH register collision events detected during projection.
     * Used in ranking as
     * `piano_registerCollisionNorm = max(0, 1 - registerCollisionCount / 5)`.
     */
    pianoRegisterCollisionCount?: number;
    /**
     * Overall piano playability score in [0, 1] from the evidence evaluator.
     * Distinct from PianoCraftScoreSummary.handPlayability (craft dimension).
     * When absent, 0.5 is assumed.
     */
    pianoPlayabilityScore?: number;
    /** Count of normalization warning strings from proposalEvidence (0 when absent). */
    normalizationWarningsCount?: number;
    /** Number of sections in the composition plan (from compositionPlan.sections.length). */
    sectionCount?: number;
    /** Provider name (e.g. "notagen", "music21"). */
    provider?: string;
    /** Generation mode from proposalEvidence (e.g. "notagen_local", "mock_notagen_abc", "template"). */
    generationMode?: string;
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
    weightSource: "reranker" | "learned" | "default";
    dimensionContributions: Record<string, number>;
    rerankerScore?: number;     // raw logistic regression output [0,1] when weightSource="reranker"
}

// ---------------------------------------------------------------------------
// Reranker snapshot
// ---------------------------------------------------------------------------

/**
 * JSON snapshot produced by scripts/train-preference-reranker.py.
 * Contains logistic regression coefficients + standardization parameters.
 */
export interface PreferenceRerankerSnapshot {
    version: 1;
    algorithm: "logistic_regression";
    snapshotId: string;
    trainedAt: string;
    sampleCount: number;
    approvedCount: number;
    rejectedCount: number;
    featureNames: string[];
    scalerMean: number[];
    scalerScale: number[];
    coefficients: number[];
    intercept: number;
    threshold: number;
    crossValAccuracy: number | null;
    trainAccuracy?: number;
    notes?: string;
}

const RERANKER_SNAPSHOT_FEATURE_NAMES = [
    "syntaxValidity",
    "sectionContractFit",
    "cadenceStrength",
    "tonalReturn",
    "motifSurvival",
    "voiceIndependence",
    "phraseShape",
    "registerIdiomaticFit",
    "normalizationWarningsCount",
    "sectionCount",
    "provider_notagen",
    "provider_other",
    "generationMode_mock",
    "generationMode_local",
] as const;

/**
 * Extended reranker feature names for solo_piano lane snapshots.
 * Piano-aware snapshots include 9 additional dimensions after the 14 generic
 * ones.  Generic-only snapshots (length 14) will fail the length validation
 * in computeRerankerScore(), causing a graceful fallback to learned/default
 * piano weights — which is the correct behaviour.
 */
const PIANO_RERANKER_FEATURE_NAMES = [
    ...RERANKER_SNAPSHOT_FEATURE_NAMES,
    "piano_finalPianoScore",
    "piano_handPlayability",
    "piano_melodicClarity",
    "piano_bassCoherence",
    "piano_voicingIdiomaticFit",
    "piano_pedalPlausibility",
    "piano_playabilityScore",
    "piano_handSpanNorm",
    "piano_registerCollisionNorm",
] as const;

// ---------------------------------------------------------------------------
// Piano evidence normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalises raw hand-span (semitones) to a [0, 1] score where 1.0 means
 * comfortably within a 12-semitone octave span and 0.0 means a 24+ semitone
 * span that is essentially unplayable in a single position.
 */
function normalisePianoHandSpan(handSpanMax: number | undefined): number {
    if (typeof handSpanMax !== "number") return 0.5; // absent → neutral
    return Math.max(0, 1 - Math.max(0, handSpanMax - 12) / 12);
}

/**
 * Normalises a register-collision count to a [0, 1] score where 1.0 means
 * no collisions and 0.0 means 5+ collisions (effectively unplayable texture).
 */
function normalisePianoRegisterCollisions(collisionCount: number | undefined): number {
    if (typeof collisionCount !== "number") return 0.5; // absent → neutral
    return Math.max(0, 1 - collisionCount / 5);
}

// ---------------------------------------------------------------------------
// Effective dimension map builder
// ---------------------------------------------------------------------------

/**
 * Builds a flat `Record<string, number>` that merges the generic craft
 * dimensions with piano-specific dimensions (when available).
 *
 * Piano dimensions are stored under `piano_*` keys so they can be looked up
 * uniformly in computePreferenceScore() and in candidate manifests'
 * `internalScores`.
 *
 * When the candidate has no pianoCraftSummary, only the generic craft
 * dimensions are returned (identical behaviour to the old code path).
 */
function buildEffectiveDimensions(candidate: PreferenceCandidate): Record<string, number> {
    const dims: Record<string, number> = {};

    // Generic craft dimensions
    const craft = candidate.craftSummary as unknown as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_DIMENSION_WEIGHTS)) {
        dims[key] = typeof craft[key] === "number" ? (craft[key] as number) : 0.5;
    }

    // Piano dimensions — only added when pianoCraftSummary is present
    const p = candidate.pianoCraftSummary;
    if (p) {
        dims["piano_finalPianoScore"]               = p.finalPianoScore ?? 0.5;
        dims["piano_handPlayability"]               = p.handPlayability ?? 0.5;
        dims["piano_melodicClarity"]                = p.melodicClarity ?? 0.5;
        dims["piano_bassCoherence"]                 = p.bassCoherence ?? 0.5;
        dims["piano_voicingIdiomaticFit"]           = p.voicingIdiomaticFit ?? 0.5;
        dims["piano_accompanimentPatternCoherence"] = p.accompanimentPatternCoherence ?? 0.5;
        dims["piano_registerSpacing"]               = p.registerSpacing ?? 0.5;
        dims["piano_handIndependence"]              = p.handIndependence ?? 0.5;
        dims["piano_pedalPlausibility"]             = p.pedalPlausibility ?? 0.5;
        dims["piano_difficultyFit"]                 = p.difficultyFit ?? 0.5;
        dims["piano_playabilityScore"]              = candidate.pianoPlayabilityScore ?? 0.5;
        dims["piano_handSpanNorm"]                  = normalisePianoHandSpan(candidate.pianoHandSpanMax);
        dims["piano_registerCollisionNorm"]         = normalisePianoRegisterCollisions(candidate.pianoRegisterCollisionCount);
    }

    return dims;
}

/**
 * Loads the reranker snapshot from disk.  Returns null if not present or
 * has too few samples to trust.
 */
export function loadRerankerSnapshot(): PreferenceRerankerSnapshot | null {
    const snapshotPath = process.env["AXIOM_PREFERENCE_RERANKER_SNAPSHOT"]
        ?? path.join(config.outputDir, "_system", "preference-reranker-snapshot.json");
    if (!fs.existsSync(snapshotPath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(snapshotPath, "utf8");
        const snapshot = JSON.parse(raw) as PreferenceRerankerSnapshot;
        if (
            snapshot.version !== 1
            || snapshot.algorithm !== "logistic_regression"
            || !Array.isArray(snapshot.coefficients)
            || !Array.isArray(snapshot.featureNames)
            || !Array.isArray(snapshot.scalerMean)
            || !Array.isArray(snapshot.scalerScale)
            || typeof snapshot.intercept !== "number"
            || snapshot.sampleCount < MIN_RERANKER_SAMPLES
        ) {
            return null;
        }
        return snapshot;
    } catch {
        return null;
    }
}

/**
 * Builds the feature vector for a candidate matching the reranker's expected
 * feature order.
 *
 * When the candidate carries a pianoCraftSummary, 9 additional piano-specific
 * dimensions are appended after the 14 generic features.  A generic-only
 * reranker snapshot (feature length 14) will fail the length check in
 * computeRerankerScore() and return null, triggering a graceful fallback to
 * the piano learned/default weight path.  Only piano-aware snapshots (length
 * 23) will be applied.
 */
function buildRerankerFeatures(candidate: PreferenceCandidate): number[] {
    const craft = candidate.craftSummary as unknown as Record<string, unknown>;
    const craftDims = [
        "syntaxValidity",
        "sectionContractFit",
        "cadenceStrength",
        "tonalReturn",
        "motifSurvival",
        "voiceIndependence",
        "phraseShape",
        "registerIdiomaticFit",
    ];

    const feats: number[] = [];

    // Craft dimensions
    for (const dim of craftDims) {
        feats.push(typeof craft[dim] === "number" ? (craft[dim] as number) : 0.5);
    }

    // normalizationWarningsCount (clipped to [0, 10])
    feats.push(Math.min(candidate.normalizationWarningsCount ?? 0, 10));

    // sectionCount (clipped to [1, 20])
    feats.push(Math.min(Math.max(candidate.sectionCount ?? 3, 1), 20));

    // provider one-hot: notagen / other  (music21 = reference = [0, 0])
    const provider = (candidate.provider ?? "").toLowerCase();
    feats.push(provider.includes("notagen") ? 1 : 0);
    feats.push(provider.includes("notagen") || provider.includes("music21") ? 0 : 1);

    // generationMode one-hot: mock / local  (template = reference = [0, 0])
    const mode = (candidate.generationMode ?? "").toLowerCase();
    feats.push(mode === "mock_notagen_abc" || mode.startsWith("mock") ? 1 : 0);
    feats.push(mode === "notagen_local" || mode === "local" ? 1 : 0);

    // Piano dimensions — appended only when candidate is a piano lane candidate.
    // These must match PIANO_RERANKER_FEATURE_NAMES[14..22].
    if (candidate.pianoCraftSummary) {
        const p = candidate.pianoCraftSummary;
        feats.push(p.finalPianoScore ?? 0.5);
        feats.push(p.handPlayability ?? 0.5);
        feats.push(p.melodicClarity ?? 0.5);
        feats.push(p.bassCoherence ?? 0.5);
        feats.push(p.voicingIdiomaticFit ?? 0.5);
        feats.push(p.pedalPlausibility ?? 0.5);
        feats.push(candidate.pianoPlayabilityScore ?? 0.5);
        feats.push(normalisePianoHandSpan(candidate.pianoHandSpanMax));
        feats.push(normalisePianoRegisterCollisions(candidate.pianoRegisterCollisionCount));
    }

    return feats;
}

/**
 * Computes a logistic regression preference score [0, 1] for a candidate.
 * The feature vector is standardized using the snapshot's scaler parameters
 * before applying the linear model.
 *
 * Returns null if the snapshot's feature list doesn't match expectations
 * (version mismatch guard).  For piano candidates, the feature vector is 23
 * elements; a generic snapshot of length 14 will return null here, causing a
 * graceful fallback to piano learned/default weights in computePreferenceScore().
 */
export function computeRerankerScore(
    candidate: PreferenceCandidate,
    snapshot: PreferenceRerankerSnapshot,
): number | null {
    const feats = buildRerankerFeatures(candidate);

    // Validate dimension alignment
    if (
        feats.length !== snapshot.coefficients.length
        || feats.length !== snapshot.scalerMean.length
        || feats.length !== snapshot.scalerScale.length
    ) {
        return null;
    }

    // Standardize features: z = (x - mean) / scale
    let dotProduct = snapshot.intercept;
    for (let i = 0; i < feats.length; i++) {
        const scale = snapshot.scalerScale[i]!;
        const z = scale > 1e-9 ? (feats[i]! - snapshot.scalerMean[i]!) / scale : 0;
        dotProduct += snapshot.coefficients[i]! * z;
    }

    // Sigmoid activation → probability of "approved"
    return 1 / (1 + Math.exp(-dotProduct));
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
// Feedback history loaders
// ---------------------------------------------------------------------------

/**
 * Internal helper: reads all rated candidate manifests from a single
 * `candidates/` directory and returns FeedbackRecord entries.
 */
function _readFeedbackFromCandidatesDir(candidatesRoot: string): FeedbackRecord[] {
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

/**
 * Scans all candidate manifests for a specific song and returns those that
 * have both internalScores and a numeric appeal rating from listenerFeedback.
 *
 * Use this for same-song retry/refinement loops where only that song's
 * accumulated feedback is relevant.
 */
export function loadFeedbackHistory(songId: string): FeedbackRecord[] {
    const candidatesRoot = path.join(config.outputDir, songId, "candidates");
    if (!fs.existsSync(candidatesRoot)) {
        return [];
    }
    return _readFeedbackFromCandidatesDir(candidatesRoot);
}

/**
 * Scans candidate manifests across ALL song directories and returns every
 * rated entry.  This provides cross-song learned weights so that listener
 * preferences accumulate globally — each new song benefits from all prior
 * approved/rejected candidates, not just its own retry history.
 *
 * Directories starting with `_` (e.g. `_system`) are skipped.
 */
export function loadGlobalFeedbackHistory(): FeedbackRecord[] {
    const outputsDir = config.outputDir;
    if (!fs.existsSync(outputsDir)) {
        return [];
    }
    let songDirs: string[];
    try {
        songDirs = fs.readdirSync(outputsDir);
    } catch {
        return [];
    }
    const records: FeedbackRecord[] = [];
    for (const songDir of songDirs) {
        if (songDir.startsWith("_")) continue;
        const candidatesRoot = path.join(outputsDir, songDir, "candidates");
        if (!fs.existsSync(candidatesRoot)) continue;
        records.push(..._readFeedbackFromCandidatesDir(candidatesRoot));
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
 * When `isPiano` is true, computes weights over the piano dimension set
 * (PIANO_DEFAULT_DIMENSION_WEIGHTS keys) instead of the generic set.  Piano
 * candidates store `piano_*` keys in their `internalScores`; non-piano
 * candidates omit them, so pairwise counting naturally produces 0 useful
 * pairs and the prior dominates — which is correct behaviour.
 *
 * Returns null when the history is too short to be reliable.
 */
function computeLearnedWeights(history: FeedbackRecord[], isPiano = false): Record<string, number> | null {
    if (history.length < MIN_FEEDBACK_SAMPLES) {
        return null;
    }

    const defaultWeights = isPiano ? PIANO_DEFAULT_DIMENSION_WEIGHTS : DEFAULT_DIMENSION_WEIGHTS;
    const dimensions = Object.keys(defaultWeights);
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
        const priorRate = defaultWeights[dim] ?? (1 / dimensions.length);
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
 * feedback history for this song.
 *
 * Priority:
 *   1. Reranker snapshot (logistic regression) — when loaded and trustworthy
 *   2. Pairwise learned weights — when ≥ MIN_FEEDBACK_SAMPLES history exists
 *   3. Cold-start default weights
 *
 * Piano lane behaviour (when candidate.pianoCraftSummary is present):
 *   • Reranker: piano-extended feature vector (23 dims). A generic-only
 *     snapshot (14 dims) returns null → fallback to piano learned/default weights.
 *   • Learned: agreement correlation is computed over PIANO_DEFAULT_DIMENSION_WEIGHTS
 *     keys (piano_* prefixed), which are stored in candidate manifests' internalScores.
 *   • Default: PIANO_DEFAULT_DIMENSION_WEIGHTS (replaces generic weights entirely).
 *   • buildEffectiveDimensions() provides the piano_ keyed values for scoring.
 */
export function computePreferenceScore(
    candidate: PreferenceCandidate,
    history: FeedbackRecord[],
    snapshot?: PreferenceRerankerSnapshot | null,
): PreferenceScore {
    const isPiano = !!candidate.pianoCraftSummary;

    // ── Priority 1: logistic regression reranker ─────────────────────────────
    const effectiveSnapshot = snapshot !== undefined ? snapshot : loadRerankerSnapshot();
    if (effectiveSnapshot) {
        const raw = computeRerankerScore(candidate, effectiveSnapshot);
        if (raw !== null) {
            // dimensionContributions: show feature → standardized contribution.
            // Use the piano-extended name list when the feature vector is longer.
            const feats = buildRerankerFeatures(candidate);
            const nameList = isPiano ? PIANO_RERANKER_FEATURE_NAMES : RERANKER_SNAPSHOT_FEATURE_NAMES;
            const dimensionContributions: Record<string, number> = {};
            for (let i = 0; i < nameList.length && i < feats.length; i++) {
                const scale = effectiveSnapshot.scalerScale[i] ?? 1;
                const z = scale > 1e-9 ? (feats[i]! - (effectiveSnapshot.scalerMean[i] ?? 0)) / scale : 0;
                const contrib = (effectiveSnapshot.coefficients[i] ?? 0) * z;
                dimensionContributions[nameList[i]] = Number(contrib.toFixed(4));
            }
            return {
                candidateId: candidate.candidateId,
                preferenceScore: Number(Math.max(0, Math.min(1, raw)).toFixed(4)),
                weightSource: "reranker",
                dimensionContributions,
                rerankerScore: Number(raw.toFixed(4)),
            };
        }
    }

    // ── Priority 2 & 3: pairwise learned weights / cold-start default ─────────
    // For piano candidates, learned weights are computed over piano dimensions
    // (piano_* keys); default weights are piano-specific.
    const learnedWeights = computeLearnedWeights(history, isPiano);
    const defaultWeights = isPiano ? PIANO_DEFAULT_DIMENSION_WEIGHTS : DEFAULT_DIMENSION_WEIGHTS;
    const weights = learnedWeights ?? defaultWeights;
    const weightSource: PreferenceScore["weightSource"] = learnedWeights ? "learned" : "default";

    // buildEffectiveDimensions() merges craftSummary + pianoCraftSummary values
    // under a unified flat key space so the weight dict can be applied uniformly.
    const dims = buildEffectiveDimensions(candidate);
    let weighted = 0;
    const dimensionContributions: Record<string, number> = {};

    for (const [dim, w] of Object.entries(weights)) {
        const value = typeof dims[dim] === "number" ? dims[dim] : 0.5;
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
 *   3. Load the reranker snapshot once (avoids repeated disk reads).
 *   4. Resolve effective feedback history (global → song-local → empty).
 *   5. Score each passing candidate via the preference model.
 *   6. Return the highest-scoring candidate id plus diagnostic metadata.
 *
 * History priority (when _historyOverride is not provided):
 *   • Global history (outputs/&lt;songId&gt;/candidates, all songs) when ≥ MIN_FEEDBACK_SAMPLES
 *   • Song-local history (outputs/<songId>/candidates) otherwise
 *   This means accumulated cross-song feedback informs every new composition.
 *
 * @param shortlist   Up to PREFERENCE_SHORTLIST_SIZE candidates, pre-ranked
 *                    by heuristic structure score (best first).
 * @param songId      Used to load song-local feedback history from persisted manifests.
 * @returns Selected candidateId and diagnostic scores for logging.
 */
export function selectPreferredCandidate(
    shortlist: PreferenceCandidate[],
    songId: string,
    _historyOverride?: FeedbackRecord[],
    _snapshotOverride?: PreferenceRerankerSnapshot | null,
): {
    selectedCandidateId: string;
    scores: PreferenceScore[];
    filteredOutIds: string[];
    feedbackSamples: number;
    globalFeedbackSamples: number;
    weightSource: PreferenceScore["weightSource"];
} {
    if (shortlist.length === 0) {
        throw new Error("selectPreferredCandidate: shortlist is empty");
    }

    // Load snapshot once — avoids repeated file reads for each candidate
    const snapshot = _snapshotOverride !== undefined ? _snapshotOverride : loadRerankerSnapshot();

    // Resolve history: when _historyOverride is given, use it directly (for tests).
    // Otherwise prefer global (all songs) when sufficiently large, else song-local.
    let effectiveHistory: FeedbackRecord[];
    let globalFeedbackSamples: number;
    if (_historyOverride !== undefined) {
        effectiveHistory = _historyOverride;
        globalFeedbackSamples = _historyOverride.length;
    } else {
        const globalHistory = loadGlobalFeedbackHistory();
        globalFeedbackSamples = globalHistory.length;
        if (globalHistory.length >= MIN_FEEDBACK_SAMPLES) {
            effectiveHistory = globalHistory;
        } else {
            effectiveHistory = loadFeedbackHistory(songId);
        }
    }

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
    const scores = pool.map((candidate) => computePreferenceScore(candidate, effectiveHistory, snapshot));
    scores.sort((a, b) => b.preferenceScore - a.preferenceScore);

    return {
        selectedCandidateId: scores[0]!.candidateId,
        scores,
        filteredOutIds,
        feedbackSamples: effectiveHistory.length,
        globalFeedbackSamples,
        weightSource: scores[0]!.weightSource,
    };
}
