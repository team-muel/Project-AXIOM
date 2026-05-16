import type {
    GlobalMotifGraph,
    GlobalMotifTransformNode,
    MotifDramaticFunction,
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
 * When a GlobalMotifGraph is supplied, its transform nodes take precedence over
 * the role heuristic — including fragment slice selection and harmonic context.
 * Falls back to the role heuristic when no node is present in the graph.
 *
 * Sections that have a matching motifRef are linked to the source motif draft.
 * Recap sections also get a recapIdentityScore vs the theme_a draft.
 */
export function buildMotifDevelopmentPlan(
    sections: SectionPlan[],
    motifDrafts: MotifDraft[],
    globalMotifGraph?: GlobalMotifGraph,
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

        // GlobalMotifGraph node takes precedence over role heuristic
        const globalNode = globalMotifGraph?.transformPath.find((n) => n.sectionId === section.id);
        const transform: ThematicTransformKind = globalNode?.transform ?? chooseTransformForRole(section.role);

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

        // Compute transformed intervals (fragment spec from global graph when available)
        if (transform === "sequence") {
            const copies = applySequence(sourceDraft.intervals, 2, 2);
            entry.transformedIntervals = copies[1] ?? [];
        } else if (transform === "fragment") {
            const spec = globalNode?.fragmentSpec;
            const start = spec?.start ?? 0;
            const length = spec?.length ?? Math.max(1, Math.floor(sourceDraft.intervals.length / 2));
            entry.transformedIntervals = applyFragmentation(sourceDraft.intervals, start, length);
        } else if (transform === "inversion") {
            entry.transformedIntervals = applyInversion(sourceDraft.intervals);
        } else if (transform === "repeat" || transform === "augmentation" || transform === "diminution") {
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

        const noteLines: string[] = [
            `transform: ${transform} applied to motif "${sourceDraft.id}"`,
        ];
        if (globalNode?.dramaticFunction) noteLines.push(`dramaticFunction: ${globalNode.dramaticFunction}`);
        if (globalNode?.harmonicContext) noteLines.push(`harmonicContext: ${globalNode.harmonicContext}`);

        const plan: MotifDevelopmentPlan = {
            entries: [entry],
            ...(recapIdentityScore !== undefined ? { recapIdentityScore } : {}),
            notes: noteLines,
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

// ---------------------------------------------------------------------------
// 6. Global Motif Graph builder (plan-time dramatic blueprint)
// ---------------------------------------------------------------------------

/**
 * Resolves the dramatic function of a section within the composition's
 * narrative arc, using the section's role and its position / energy level
 * relative to all development sections.
 */
function resolveDramaticFunction(
    section: SectionPlan,
    allSections: SectionPlan[],
    maxDevEnergy: number,
): MotifDramaticFunction {
    switch (section.role) {
        case "intro":
        case "theme_a":
        case "theme_b":
            return "exposition";
        case "bridge":
            return "fragmentation";
        case "variation":
            return "dissolution";
        case "recap":
            return "resolution";
        case "outro":
        case "cadence":
            return "coda";
        case "development": {
            const devSections = allSections.filter((s) => s.role === "development");
            if (devSections.length <= 1) return "intensification";
            const idx = devSections.findIndex((s) => s.id === section.id);
            // Climax: highest energy, in the second half of development
            if (
                section.energy >= maxDevEnergy &&
                idx >= Math.floor(devSections.length / 2)
            ) {
                return "climax";
            }
            // Find climax index to determine if we are before or after it
            const climaxIdx = devSections.reduce(
                (best, s, i) => (s.energy > (devSections[best]?.energy ?? 0) ? i : best),
                0,
            );
            if (idx === 0) return "destabilization";
            if (idx > climaxIdx) return "dissolution";
            return "intensification";
        }
        default:
            return "exposition";
    }
}

/** Maps a dramatic function to a transform node for the given section. */
function buildTransformNode(
    section: SectionPlan,
    df: MotifDramaticFunction,
    sourceIntervals: number[],
): GlobalMotifTransformNode {
    const halfLen = Math.max(1, Math.floor(sourceIntervals.length / 2));

    switch (df) {
        case "exposition":
            return {
                sectionId: section.id,
                transform: "repeat",
                dramaticFunction: df,
                required: section.role === "theme_a",
                harmonicContext: "home key",
            };
        case "destabilization":
            return {
                sectionId: section.id,
                transform: "fragment",
                dramaticFunction: df,
                fragmentSpec: { start: 0, length: halfLen },
                required: false,
                harmonicContext: "dominant pedal",
            };
        case "fragmentation":
            return {
                sectionId: section.id,
                transform: "fragment",
                dramaticFunction: df,
                fragmentSpec: { start: halfLen, length: sourceIntervals.length - halfLen || halfLen },
                required: false,
                harmonicContext: "dominant pedal",
            };
        case "intensification":
            return {
                sectionId: section.id,
                transform: "sequence",
                dramaticFunction: df,
                required: false,
                harmonicContext: "dominant pedal",
            };
        case "climax":
            return {
                sectionId: section.id,
                transform: "diminution",
                dramaticFunction: df,
                required: false,
                harmonicContext: "chromatic median",
            };
        case "dissolution":
            return {
                sectionId: section.id,
                transform: "augmentation",
                dramaticFunction: df,
                required: false,
                harmonicContext: "subdominant reharmonize",
            };
        case "resolution":
            return {
                sectionId: section.id,
                transform: "repeat",
                dramaticFunction: df,
                required: true,
                harmonicContext: "home key return",
            };
        case "coda":
            return {
                sectionId: section.id,
                transform: "augmentation",
                dramaticFunction: df,
                required: section.role === "outro",
                harmonicContext: "tonic prolongation",
            };
    }
}

/**
 * Builds a plan-time GlobalMotifGraph from the composition's section list
 * and motif drafts.  Must be called before section generation so that
 * `buildMotifDevelopmentPlan` can read from the graph instead of relying
 * on the simple role heuristic.
 *
 * The graph encodes:
 *   - The dramatic function of every section (based on energy curve + role)
 *   - The planned transform technique (richer than role heuristic)
 *   - Fragment slice specs for "fragment" transforms
 *   - Harmonic context hints for the generator
 *   - Which sections must carry a recognizable form of the motif
 *
 * Returns `undefined` when no source motif draft can be found.
 */
export function buildGlobalMotifGraph(
    sections: SectionPlan[],
    motifDrafts: MotifDraft[],
): GlobalMotifGraph | undefined {
    const themeASection = sections.find((s) => s.role === "theme_a");
    const themeADraft =
        (themeASection
            ? motifDrafts.find((d) => d.sectionId === themeASection.id || d.id === "theme_a")
            : undefined)
        ?? motifDrafts.find((d) => d.id === "theme_a")
        ?? motifDrafts[0];

    if (!themeADraft) return undefined;

    const sourceId = themeASection?.id ?? themeADraft.sectionId ?? "theme_a";

    const devSections = sections.filter((s) => s.role === "development");
    const maxDevEnergy = devSections.reduce((max, s) => Math.max(max, s.energy), 0);

    const requiredReturns: string[] = sections
        .filter((s) => s.role === "recap" || s.role === "outro")
        .map((s) => s.id);

    const transformPath: GlobalMotifTransformNode[] = [];
    const dramaticArc: MotifDramaticFunction[] = [];

    for (const section of sections) {
        const df = resolveDramaticFunction(section, sections, maxDevEnergy);
        const node = buildTransformNode(section, df, themeADraft.intervals);
        transformPath.push(node);
        dramaticArc.push(df);
    }

    return {
        motifId: themeADraft.id,
        sourceSectionId: sourceId,
        requiredReturns,
        transformPath,
        dramaticArc,
    };
}
