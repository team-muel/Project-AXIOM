import type {
    MotifDevelopmentEntry,
    MotifDevelopmentPlan,
    MotifDraft,
    MotifGraph,
    MotifOccurrence,
    SectionArtifactSummary,
    SectionPlan,
    ThematicTransformKind,
} from "../pipeline/types.js";
import type { SectionRole } from "../pipeline/types/section.js";

// motifDevelopment.ts — Motif development planning module
// ──────────────────────────────────────────────────────────────────────────────
// Implements the classic techniques from docs/motif-development.md:
//   sequence, fragmentation, inversion, retrograde, augmentation,
//   diminution, reharmonize, and recap identity verification.
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// 1. Interval transform functions
// ---------------------------------------------------------------------------

/**
 * Transposes the motif interval pattern by `stride` semitones and
 * returns `count` copies (including the original at stride=0).
 *
 * applySequence([2,2,1], 2, 3) →
 *   [[2,2,1], [4,4,3], [6,6,5]]
 */
export function applySequence(intervals: number[], stride: number, count: number): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < count; i++) {
        result.push(intervals.map((iv) => iv + stride * i));
    }
    return result;
}

/**
 * Extracts a contiguous slice of the interval array.
 * `start` is inclusive, `length` is the number of intervals to keep.
 *
 * applyFragmentation([2,2,1,3], 0, 2) → [2,2]
 */
export function applyFragmentation(intervals: number[], start: number, length: number): number[] {
    if (intervals.length === 0 || start >= intervals.length) return [];
    const safeStart = Math.max(0, start);
    const safeLen = Math.max(0, Math.min(length, intervals.length - safeStart));
    return intervals.slice(safeStart, safeStart + safeLen);
}

/**
 * Strict inversion: negates every interval.
 * C-E-G (intervals [4,3]) becomes C-Ab-E (intervals [-4,-3]).
 */
export function applyInversion(intervals: number[]): number[] {
    return intervals.map((iv) => iv === 0 ? 0 : -iv);
}

/**
 * Retrograde: reverses the order of intervals.
 * C-D-E-F (intervals [2,2,1]) becomes F-E-D-C (intervals [-1,-2,-2]).
 * Note: the reversed series represents the intervallic contour when reading backwards.
 */
export function applyRetrograde(intervals: number[]): number[] {
    return [...intervals].reverse();
}

/**
 * Augmentation: multiplies every duration value by `factor` (default 2.0).
 * Quarter notes become half notes, etc.
 */
export function applyAugmentation(durations: number[], factor = 2.0): number[] {
    return durations.map((d) => d * factor);
}

/**
 * Diminution: divides every duration value by `factor` (default 2.0).
 * Quarter notes become eighth notes, etc.  Rounds to 3 decimal places to
 * avoid floating-point drift.
 */
export function applyDiminution(durations: number[], factor = 2.0): number[] {
    return durations.map((d) => Math.round((d / factor) * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// 2. Recap identity score
// ---------------------------------------------------------------------------

/**
 * Computes how well a recap preserves the contour identity of the original theme.
 * Returns a value in [0,1]:
 *   1.0 = identical contour direction on every interval
 *   0.0 = completely contrary contour
 *
 * Based on the sign-match proportion described in docs/motif-development.md §4.
 */
export function computeRecapIdentityScore(
    themeIntervals: number[],
    recapIntervals: number[],
): number {
    const minLen = Math.min(themeIntervals.length, recapIntervals.length);
    if (minLen === 0) return 0;

    let matchCount = 0;
    for (let i = 0; i < minLen; i++) {
        const sTheme = Math.sign(themeIntervals[i]!);
        const sRecap = Math.sign(recapIntervals[i]!);
        if (sTheme === sRecap) matchCount++;
    }
    return matchCount / minLen;
}

// ---------------------------------------------------------------------------
// 3. Transform kind chooser
// ---------------------------------------------------------------------------

function chooseTransformForRole(role: SectionRole): ThematicTransformKind {
    switch (role) {
        case "bridge":
            return "fragment"; // take only the first idea
        case "development":
            return "sequence"; // sequence drives the development forward
        case "variation":
            return "inversion"; // inversion for textural variety
        case "recap":
            return "repeat"; // canonical return
        case "outro":
            return "augmentation"; // expand and broaden for the ending
        default:
            return "revoice";
    }
}

// ---------------------------------------------------------------------------
// 4. Batch plan builder
// ---------------------------------------------------------------------------

/**
 * Builds a MotifDevelopmentPlan for every section in the plan and returns a
 * Map<sectionId, MotifDevelopmentPlan> for merging into SectionPlan.motifDevelopment.
 *
 * Sections that have a matching motifRef are linked to the source motif draft.
 * Recap sections also get a recapIdentityScore vs the theme_a draft.
 */
export function buildMotifDevelopmentPlan(
    sections: SectionPlan[],
    motifDrafts: MotifDraft[],
): Map<string, MotifDevelopmentPlan> {
    const result = new Map<string, MotifDevelopmentPlan>();

    // Index theme_a motif draft for recap comparison
    const themeASection = sections.find((s) => s.role === "theme_a");
    const themeADraft = themeASection
        ? motifDrafts.find((d) => d.sectionId === themeASection.id || d.id === "theme_a")
        : undefined;

    const DEVELOPMENT_ROLES: SectionRole[] = ["bridge", "development", "variation", "recap", "outro"];

    for (const section of sections) {
        if (!DEVELOPMENT_ROLES.includes(section.role)) continue;

        const transform = chooseTransformForRole(section.role);

        // Find the source motif draft
        const sourceDraft =
            motifDrafts.find((d) => d.sectionId === section.motifRef) ??
            motifDrafts.find((d) => d.id === "theme_a") ??
            motifDrafts[0];

        if (!sourceDraft) continue;

        const entry: MotifDevelopmentEntry = {
            sourceSectionId: sourceDraft.sectionId ?? "theme_a",
            targetSectionId: section.id,
            transform,
        };

        // Compute transformed intervals
        if (transform === "sequence") {
            const copies = applySequence(sourceDraft.intervals, 2, 2);
            entry.transformedIntervals = copies[1] ?? [];
        } else if (transform === "fragment") {
            entry.transformedIntervals = applyFragmentation(
                sourceDraft.intervals,
                0,
                Math.max(1, Math.floor(sourceDraft.intervals.length / 2)),
            );
        } else if (transform === "inversion") {
            entry.transformedIntervals = applyInversion(sourceDraft.intervals);
        } else if (transform === "repeat" || transform === "augmentation") {
            entry.transformedIntervals = [...sourceDraft.intervals];
        }

        // Recap identity check
        let recapIdentityScore: number | undefined;
        if (section.role === "recap" && themeADraft) {
            recapIdentityScore = computeRecapIdentityScore(
                themeADraft.intervals,
                entry.transformedIntervals ?? sourceDraft.intervals,
            );
            entry.recapIdentityScore = recapIdentityScore;
        }

        const plan: MotifDevelopmentPlan = {
            entries: [entry],
            ...(recapIdentityScore !== undefined ? { recapIdentityScore } : {}),
            notes: [`transform: ${transform} applied to motif "${sourceDraft.id}"`],
        };

        result.set(section.id, plan);
    }

    return result;
}

// ---------------------------------------------------------------------------
// 5. Motif Graph builder
// ---------------------------------------------------------------------------

/** Local utility: proportion of sign-matching positions between two interval arrays. */
function contourSignMatch(a: number[], b: number[]): number {
    const minLen = Math.min(a.length, b.length);
    if (minLen === 0) return 0;
    let matches = 0;
    for (let i = 0; i < minLen; i++) {
        const sA = Math.sign(a[i]!);
        const sB = Math.sign(b[i]!);
        if (sA === sB) matches++;
    }
    return matches / minLen;
}

/**
 * Builds a MotifGraph describing how the original motif (sourced from the
 * theme_a section) propagates, transforms, and recurs across all sections.
 *
 * Detects each section's relationship to the original via:
 *   - Planned transform from the section's `motifDevelopment` entry (preferred)
 *   - Contour similarity heuristic (fallback when no plan entry)
 *   - "false_recap" is flagged when a development section has contour similarity ≥ 0.70
 *
 * Returns `undefined` when no source motif can be determined.
 *
 * @param sections  Array of SectionPlan (from the composition plan)
 * @param motifDrafts  MotifDraft array from the composition sketch
 * @param artifacts  Optional rendered artifacts for capturedMotif data
 */
export function buildMotifGraph(
    sections: SectionPlan[],
    motifDrafts: MotifDraft[],
    artifacts?: SectionArtifactSummary[],
): MotifGraph | undefined {
    // Locate the source motif draft (theme_a by convention)
    const themeASection = sections.find((s) => s.role === "theme_a");
    const themeADraft =
        (themeASection
            ? motifDrafts.find((d) => d.sectionId === themeASection.id || d.id === "theme_a")
            : undefined)
        ?? motifDrafts.find((d) => d.id === "theme_a")
        ?? motifDrafts[0];

    if (!themeADraft) return undefined;

    const artifactById = new Map((artifacts ?? []).map((a) => [a.sectionId, a]));
    const themeAArt = themeASection ? artifactById.get(themeASection.id) : undefined;
    const originalIntervals: number[] = themeAArt?.capturedMotif ?? themeADraft.intervals;

    const occurrences: MotifOccurrence[] = [];

    // Record the original statement
    occurrences.push({
        sectionId: themeASection?.id ?? themeADraft.sectionId ?? "theme_a",
        role: themeASection?.role ?? "theme_a",
        transform: "original",
        similarity: 1.0,
        intervals: originalIntervals,
    });

    for (const section of sections) {
        if (section.role === "theme_a") continue;

        const artifact = artifactById.get(section.id);
        const capturedMotif = artifact?.capturedMotif;

        // Prefer plan-specified transform; fall back to heuristic
        const devPlan = (section as SectionPlan & { motifDevelopment?: MotifDevelopmentPlan })
            .motifDevelopment;
        const plannedTransform: ThematicTransformKind | undefined = devPlan?.entries[0]?.transform;

        // Resolve which intervals to compare
        const compIntervals: number[] | undefined =
            capturedMotif ??
            devPlan?.entries[0]?.transformedIntervals;

        const similarity =
            compIntervals && compIntervals.length > 0 && originalIntervals.length > 0
                ? contourSignMatch(originalIntervals, compIntervals)
                : 0;

        // Classify transform
        let transform: ThematicTransformKind | "original" | "false_recap";
        if (section.role === "development" && !plannedTransform && similarity >= 0.70) {
            transform = "false_recap";
        } else {
            transform = plannedTransform ?? "revoice";
        }

        occurrences.push({
            sectionId: section.id,
            role: section.role,
            transform,
            similarity,
            intervals: compIntervals,
        });
    }

    const nonOriginal = occurrences.filter((o) => o.transform !== "original");
    const usedTransforms = [...new Set(nonOriginal.map((o) => o.transform as string))];
    // Diversity: 1 type=0.25, 2=0.50, 3=0.75, 4+=1.0
    const diversityScore = Math.max(0, Math.min(1, usedTransforms.length / 4));

    return {
        motifId: themeADraft.id,
        originalIntervals,
        sourceSectionId: themeASection?.id ?? themeADraft.sectionId ?? "theme_a",
        occurrences,
        usedTransforms,
        diversityScore,
    };
}
