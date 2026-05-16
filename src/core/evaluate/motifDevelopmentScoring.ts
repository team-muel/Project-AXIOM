import type {
    MotifDevelopmentPlan,
    SectionArtifactSummary,
    ThematicTransformKind,
} from "../pipeline/types.js";

// motifDevelopmentScoring.ts — Motif development quality evaluator
// ──────────────────────────────────────────────────────────────────────────────
// Scores how well a rendered section's motif material fulfils its
// MotifDevelopmentPlan (exact return, sequence, fragmentation, inversion,
// augmentation/diminution, reharmonised return, recap identity).
//
// All individual scoring functions return a value in [0, 1].
// Inputs:
//   plan           — MotifDevelopmentPlan from motifDevelopment.ts
//   sourceArtifact — SectionArtifactSummary of the source section (theme_a or motif ref)
//   targetArtifact — SectionArtifactSummary of the section being evaluated
// ──────────────────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

function signOf(n: number): -1 | 0 | 1 {
    if (n > 0) return 1;
    if (n < 0) return -1;
    return 0;
}

// ---------------------------------------------------------------------------
// Shared: contour sign-match proportion
// ---------------------------------------------------------------------------

function contourSignMatchProportion(a: number[], b: number[]): number {
    const minLen = Math.min(a.length, b.length);
    if (minLen === 0) return 0;
    let matches = 0;
    for (let i = 0; i < minLen; i++) {
        if (signOf(a[i]!) === signOf(b[i]!)) matches++;
    }
    return matches / minLen;
}

// ---------------------------------------------------------------------------
// 1. Exact return score
// ---------------------------------------------------------------------------

/**
 * Measures how closely the target section's melodic contour matches the source.
 * Used for "repeat" / exact-return transforms.
 *
 * Returns 0 when either artifact has no captured motif.
 */
export function computeExactReturnScore(
    sourceArtifact: SectionArtifactSummary,
    targetArtifact: SectionArtifactSummary,
): number {
    const src = sourceArtifact.capturedMotif;
    const tgt = targetArtifact.capturedMotif;
    if (!src || !tgt || src.length === 0 || tgt.length === 0) return 0;
    return contourSignMatchProportion(src, tgt);
}

// ---------------------------------------------------------------------------
// 2. Sequence score
// ---------------------------------------------------------------------------

/**
 * Detects whether the target intervals are a consistent transposition of
 * the source intervals (sequence transform).
 *
 * A valid sequence has a constant stride added to each interval.
 * Score = proportion of intervals that fit the detected stride within ±1 semitone.
 *
 * Returns 0 when either artifact has no captured motif.
 */
export function computeSequenceScore(
    sourceArtifact: SectionArtifactSummary,
    targetArtifact: SectionArtifactSummary,
): number {
    const src = sourceArtifact.capturedMotif;
    const tgt = targetArtifact.capturedMotif;
    if (!src || !tgt || src.length === 0 || tgt.length === 0) return 0;

    const minLen = Math.min(src.length, tgt.length);
    // Detect stride from first pair
    const detectedStride = tgt[0]! - src[0]!;

    let consistent = 0;
    for (let i = 0; i < minLen; i++) {
        const diff = tgt[i]! - src[i]!;
        if (Math.abs(diff - detectedStride) <= 1) consistent++;
    }
    return clamp01(consistent / minLen);
}

// ---------------------------------------------------------------------------
// 3. Fragmentation score
// ---------------------------------------------------------------------------

/**
 * Checks whether the target interval sequence is a recognisable prefix fragment
 * of the source.
 *
 * Score = sign-match proportion between target and the matching prefix of source.
 *
 * Returns 0 when either artifact has no captured motif.
 */
export function computeFragmentationScore(
    sourceArtifact: SectionArtifactSummary,
    targetArtifact: SectionArtifactSummary,
): number {
    const src = sourceArtifact.capturedMotif;
    const tgt = targetArtifact.capturedMotif;
    if (!src || !tgt || src.length === 0 || tgt.length === 0) return 0;

    // Fragment should be shorter than source
    if (tgt.length >= src.length) return 0.5; // not fragmented — neutral

    const prefix = src.slice(0, tgt.length);
    return contourSignMatchProportion(prefix, tgt);
}

// ---------------------------------------------------------------------------
// 4. Inversion detection score
// ---------------------------------------------------------------------------

/**
 * Checks whether the target is the melodic inversion of the source:
 * every interval should have the opposite sign.
 *
 * Returns 0 when either artifact has no captured motif.
 */
export function computeInversionDetectionScore(
    sourceArtifact: SectionArtifactSummary,
    targetArtifact: SectionArtifactSummary,
): number {
    const src = sourceArtifact.capturedMotif;
    const tgt = targetArtifact.capturedMotif;
    if (!src || !tgt || src.length === 0 || tgt.length === 0) return 0;

    const minLen = Math.min(src.length, tgt.length);
    let inverted = 0;
    for (let i = 0; i < minLen; i++) {
        const s = signOf(src[i]!);
        const t = signOf(tgt[i]!);
        // Zero in source = zero in target = inversion preserved
        if (s === 0 && t === 0) { inverted++; continue; }
        if (s !== 0 && t !== 0 && s !== t) inverted++; // opposite signs
    }
    return clamp01(inverted / minLen);
}

// ---------------------------------------------------------------------------
// 5. Rhythmic proportion score (augmentation / diminution)
// ---------------------------------------------------------------------------

/**
 * Measures whether the note density ratio between source and target reflects
 * an augmentation or diminution transform.
 *
 * augmentation → target note density < source note density (notes are longer)
 * diminution   → target note density > source note density (notes are shorter)
 *
 * Uses melodyEvents counts divided by measureCount as density proxy.
 */
export function computeRhythmicProportionScore(
    sourceArtifact: SectionArtifactSummary,
    targetArtifact: SectionArtifactSummary,
    expectedTransform: "augmentation" | "diminution",
): number {
    const srcDensity =
        sourceArtifact.melodyEvents.length / Math.max(1, sourceArtifact.measureCount);
    const tgtDensity =
        targetArtifact.melodyEvents.length / Math.max(1, targetArtifact.measureCount);

    if (srcDensity === 0 || tgtDensity === 0) return 0.5;

    const ratio = tgtDensity / srcDensity;

    if (expectedTransform === "augmentation") {
        // Target should be less dense (ratio < 1.0 ideally ≈ 0.5)
        if (ratio < 0.9) return clamp01(1.0 - Math.abs(ratio - 0.5) * 0.5);
        if (ratio <= 1.1) return 0.5; // unchanged
        return 0.2; // actually denser — wrong direction
    }
    // diminution: target should be more dense (ratio > 1.0 ideally ≈ 2.0)
    if (ratio > 1.1) return clamp01(1.0 - Math.abs(ratio - 2.0) * 0.3);
    if (ratio >= 0.9) return 0.5; // unchanged
    return 0.2; // actually sparser — wrong direction
}

// ---------------------------------------------------------------------------
// 6. Reharmonised return score
// ---------------------------------------------------------------------------

/**
 * For a reharmonised return the melodic contour should be preserved while
 * the harmonic context differs.
 *
 * Proxy:
 *   - High contour sign-match (melody preserved)           → good reharmonisation
 *   - harmonicColorCues in target differ from source       → reharmonisation happened
 *
 * Returns 0.5 when melodic data is unavailable.
 */
export function computeReharmonizedReturnScore(
    sourceArtifact: SectionArtifactSummary,
    targetArtifact: SectionArtifactSummary,
): number {
    const src = sourceArtifact.capturedMotif;
    const tgt = targetArtifact.capturedMotif;
    if (!src || !tgt || src.length === 0 || tgt.length === 0) return 0.5;

    const melodySimilarity = contourSignMatchProportion(src, tgt);

    // Check harmonic context differs
    const srcTags = new Set(
        (sourceArtifact.harmonicColorCues ?? []).map((c) => c.tag),
    );
    const tgtTags = new Set(
        (targetArtifact.harmonicColorCues ?? []).map((c) => c.tag),
    );
    const tagsChanged = [...tgtTags].some((t) => !srcTags.has(t)) || srcTags.size !== tgtTags.size;
    const harmonyBonus = tagsChanged ? 0.15 : 0.0;

    return clamp01(melodySimilarity * 0.85 + harmonyBonus);
}

// ---------------------------------------------------------------------------
// 7. Motif recap identity score
// ---------------------------------------------------------------------------

/**
 * High-level wrapper: measures how well the recap preserves the theme_a
 * melodic identity.
 *
 * Identical to computeExactReturnScore but semantically named for recap context.
 */
export function computeMotifRecapIdentityScore(
    sourceArtifact: SectionArtifactSummary,
    recapArtifact: SectionArtifactSummary,
): number {
    return computeExactReturnScore(sourceArtifact, recapArtifact);
}

// ---------------------------------------------------------------------------
// 8. Summary
// ---------------------------------------------------------------------------

export interface MotifDevelopmentScoreSummary {
    transformKind: ThematicTransformKind | "unknown";
    primaryScore: number;
    recapIdentityScore?: number;
    /** Weighted composite. */
    overall: number;
}

/**
 * Produces a MotifDevelopmentScoreSummary by selecting the appropriate
 * scoring function based on the plan's first entry transform.
 */
export function computeMotifDevelopmentScoreSummary(
    plan: MotifDevelopmentPlan,
    sourceArtifact: SectionArtifactSummary,
    targetArtifact: SectionArtifactSummary,
): MotifDevelopmentScoreSummary {
    const entry = plan.entries[0];
    const transform: ThematicTransformKind | "unknown" = entry?.transform ?? "unknown";

    let primaryScore: number;

    switch (transform) {
        case "repeat":
            primaryScore = computeExactReturnScore(sourceArtifact, targetArtifact);
            break;
        case "sequence":
            primaryScore = computeSequenceScore(sourceArtifact, targetArtifact);
            break;
        case "fragment":
            primaryScore = computeFragmentationScore(sourceArtifact, targetArtifact);
            break;
        case "inversion":
            primaryScore = computeInversionDetectionScore(sourceArtifact, targetArtifact);
            break;
        case "augmentation":
            primaryScore = computeRhythmicProportionScore(sourceArtifact, targetArtifact, "augmentation");
            break;
        case "diminution":
            primaryScore = computeRhythmicProportionScore(sourceArtifact, targetArtifact, "diminution");
            break;
        case "reharmonize":
            primaryScore = computeReharmonizedReturnScore(sourceArtifact, targetArtifact);
            break;
        default:
            primaryScore = 0.5; // revoice / destabilize / etc — neutral
    }

    // Recap identity is computed when the plan carries a pre-computed score
    const recapIdentityScore =
        plan.recapIdentityScore !== undefined ? plan.recapIdentityScore : undefined;

    // Overall: blend primaryScore with recapIdentity when available
    const overall = clamp01(
        recapIdentityScore !== undefined
            ? 0.7 * primaryScore + 0.3 * recapIdentityScore
            : primaryScore,
    );

    return { transformKind: transform, primaryScore, recapIdentityScore, overall };
}
