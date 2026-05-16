import type { CadenceStyle } from "./harmony.js";

export type ThematicTransformKind =
    | "repeat"
    | "sequence"
    | "fragment"
    | "revoice"
    | "destabilize"
    | "delay_return"
    | "inversion"
    | "augmentation"
    | "diminution"
    | "retrograde"
    | "reharmonize";

export interface MotifTransformPolicy {
    reuseRequired: boolean;
    inversionAllowed?: boolean;
    augmentationAllowed?: boolean;
    diminutionAllowed?: boolean;
    sequenceAllowed?: boolean;
}

export interface MotifDraft {
    id: string;
    sectionId?: string;
    source?: "planner" | "pipeline";
    intervals: number[];
    description?: string;
    preserveDuringRevision?: boolean;
}

export interface CadenceOption {
    sectionId: string;
    primary: CadenceStyle;
    alternatives: CadenceStyle[];
    rationale?: string;
}

export interface CompositionSketch {
    generatedBy: "planner" | "pipeline";
    note?: string;
    motifDrafts: MotifDraft[];
    cadenceOptions: CadenceOption[];
}

export interface ThematicTransformationCheckpoint {
    id?: string;
    sourceSectionId: string;
    targetSectionId: string;
    transform: ThematicTransformKind;
    expectedProminence?: number;
    preserveIdentity?: boolean;
    notes?: string[];
}

/** A single transform applied to a motif for a target section. */
export interface MotifDevelopmentEntry {
    sourceSectionId: string;
    targetSectionId: string;
    transform: ThematicTransformKind;
    /** Resulting interval series after applying the transform (may be undefined for non-interval transforms). */
    transformedIntervals?: number[];
    /** Resulting note-duration series after applying augmentation/diminution. */
    transformedDurations?: number[];
    /** Contour similarity score of recap vs theme_a (0–1). Only present for "recap_identity" analysis. */
    recapIdentityScore?: number;
    notes?: string[];
}

/** Full motif development plan for a section — populated by motifDevelopment.ts during sketch materialization. */
export interface MotifDevelopmentPlan {
    entries: MotifDevelopmentEntry[];
    /** Overall recap identity score across all recap sections, if computed. */
    recapIdentityScore?: number;
    notes?: string[];
}

// ---------------------------------------------------------------------------
// Motif Graph — cross-section occurrence tracking
// ---------------------------------------------------------------------------

/**
 * A single observed occurrence of the original motif in a section.
 * Carries contour similarity and the detected (or planned) transform.
 */
export interface MotifOccurrence {
    sectionId: string;
    /** Section role string (e.g. "theme_a", "development", "recap"). */
    role: string;
    /**
     * Transform type that best describes this occurrence relative to the original.
     * "original" = the source statement; "false_recap" = high similarity in development.
     */
    transform: ThematicTransformKind | "original" | "false_recap";
    /** Contour sign-match proportion vs. originalIntervals (0–1). */
    similarity: number;
    /** Captured or transformed interval series for this occurrence. */
    intervals?: number[];
}

/**
 * Cross-section motif graph that tracks how the original motif propagates,
 * transforms, and returns across the entire composition.
 *
 * Built by `buildMotifGraph()` in `motifDevelopment.ts`.
 */
export interface MotifGraph {
    /** ID of the source MotifDraft. */
    motifId: string;
    /** Interval series of the original (un-transformed) motif. */
    originalIntervals: number[];
    /** Section ID where the original motif is stated. */
    sourceSectionId: string;
    /**
     * All occurrences across the composition (including the original statement).
     * Ordered chronologically by section index.
     */
    occurrences: MotifOccurrence[];
    /** Distinct transform kinds applied across all non-original occurrences. */
    usedTransforms: string[];
    /** Diversity score [0–1]: how varied the applied transforms are. */
    diversityScore: number;
}

// ---------------------------------------------------------------------------
// Global Motif Graph — plan-time dramatic blueprint
// ---------------------------------------------------------------------------

/**
 * Dramatic function of a motif occurrence in the compositional narrative arc.
 * Richer than a section role: the same "development" role can be
 * "destabilization", "intensification", "climax", or "dissolution" depending
 * on its position in the energy curve.
 */
export type MotifDramaticFunction =
    | "exposition"      // Original statement — establishes motif identity
    | "destabilization" // First break-up; opening gesture fragmented
    | "fragmentation"   // Progressive reduction toward the peak
    | "intensification" // Sequence-driven tension build
    | "climax"          // Peak tension — faster articulation (diminution)
    | "dissolution"     // Calm after peak — expansion or revoice
    | "resolution"      // Recap return — identity restored
    | "coda";           // Final echo — augmentation or fade

/**
 * A single node in the GlobalMotifGraph's planned transform path.
 * Describes what the generator should do with the motif in this section,
 * including the specific fragment slice and harmonic context hint.
 */
export interface GlobalMotifTransformNode {
    sectionId: string;
    /** Planned transform technique for this section */
    transform: ThematicTransformKind;
    /** Dramatic function of this occurrence in the narrative arc */
    dramaticFunction: MotifDramaticFunction;
    /**
     * Fragment selection: when the transform uses only part of the motif,
     * specifies which slice to use (start index, interval count).
     * Absent for non-fragment transforms.
     */
    fragmentSpec?: { start: number; length: number };
    /**
     * Harmonic context hint for the generator
     * (e.g. "dominant pedal", "chromatic median", "home key return").
     */
    harmonicContext?: string;
    /** True when the motif must appear recognizably in this section */
    required: boolean;
}

/**
 * Plan-time global motif graph: built during sketch materialization and
 * attached to CompositionPlan before section generation begins.
 *
 * Defines the full dramatic arc of motif development so that generators
 * follow the narrative blueprint rather than independent role heuristics.
 * `buildMotifGraph()` remains the post-rendering analysis counterpart.
 */
export interface GlobalMotifGraph {
    /** ID of the source MotifDraft (typically "theme_a") */
    motifId: string;
    /** Section ID where the original motif is first stated */
    sourceSectionId: string;
    /** Section IDs that must return a recognizable form of the motif */
    requiredReturns: string[];
    /** Ordered planned transform for each section (exposition → coda) */
    transformPath: GlobalMotifTransformNode[];
    /** Dramatic function sequence mirroring the transform path order */
    dramaticArc: MotifDramaticFunction[];
}
