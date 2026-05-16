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
