import type { PianoCraftScoreSummary } from "./piano.js";
import type { StructureEvaluationReport } from "./evaluation.js";

// ─── Multi-movement cycle types ───────────────────────────────────────────────

export type MovementForm = "sonata_allegro" | "slow_ternary" | "scherzo_trio" | "rondo_finale";

export type MovementFunction = "opening_argument" | "lyrical_center" | "contrast" | "resolution";

export type CrossMovementRecallKind = "verbatim" | "transformed" | "fragmented";

export interface CrossMovementRecallPlan {
    /** Movement that contains the recall (the recalling movement). */
    movementId: string;
    /** Movement that originally stated the material. */
    sourceMovementId: string;
    /** Motif IDs recalled from the source movement. */
    motifIds: string[];
    kind: CrossMovementRecallKind;
    notes?: string[];
}

export interface MovementPlan {
    id: string;
    ordinal: 1 | 2 | 3 | 4;
    form: MovementForm;
    key: string;
    tempo: number;
    targetDurationSec: number;
    functionInCycle: MovementFunction;
    /** Motif IDs inherited from earlier movements. */
    inheritedMotifs: string[];
    /** Motif IDs introduced for the first time in this movement. */
    newMotifs: string[];
}

export interface SonataCyclePlan {
    title: string;
    totalDurationSec: number;
    globalKey: string;
    /** Motif IDs that appear in more than one movement. */
    globalMotifIds: string[];
    movements: MovementPlan[];
    crossMovementRecall: CrossMovementRecallPlan[];
    /** Tension values (0–1) sampled uniformly across the full cycle, in ordinal order. */
    globalTensionCurve: number[];
}

// ─── Sonata cycle generation results ──────────────────────────────────────────
// Runtime output of sonataCycleOrchestrator.ts.  One SonataCycleResult is
// produced after all movements complete; it carries the per-movement manifests
// and the cross-movement motif memory that was maintained during generation.

/**
 * A single confirmed motif with evidence from the completed movement.
 *
 * "Confirmed" means the motif appeared in the selected candidate's ABC/MIDI
 * output (or, in the absence of direct evidence, it was declared in the
 * movement's newMotifs list and the candidate passed Gate 3).
 */
export interface MotifMemoryEntry {
    /** Motif identifier matching MovementPlan.newMotifs or .inheritedMotifs. */
    motifId: string;
    /** Ordinal of the movement where the motif was first confirmed. */
    introducedInOrdinal: number;
    /** Ordinals of movements where the motif was recalled (inherited + confirmed). */
    recalledInOrdinals: number[];
    /**
     * Evidence strength in [0, 1].  Derived from the movement candidate's
     * motifSurvival craft dimension when available; falls back to 0.5.
     */
    evidenceStrength: number;
}

/**
 * Accumulated motif memory across all completed movements.
 *
 * Built incrementally by the cycle orchestrator: after each movement's
 * candidate is selected, its newMotifs are added with their evidence, and
 * the inheritedMotifs of subsequent movements are updated with recall records.
 */
export interface CrossMovementMotifMemory {
    entries: MotifMemoryEntry[];
    /** Motif IDs that are confirmed in >= 2 movements (global motifs). */
    confirmedGlobalMotifIds: string[];
    /** Total number of motif recall events across all movements. */
    totalRecallCount: number;
}

/**
 * The result of generating and selecting a candidate for one movement
 * within a cycle run.
 */
export interface MovementCompletionRecord {
    movementId: string;
    ordinal: 1 | 2 | 3 | 4;
    /** Song ID used to persist the movement's candidate manifests. */
    songId: string;
    /** Selected candidate ID for this movement. */
    selectedCandidateId: string;
    /** The structure evaluation report of the selected candidate. */
    structureEvaluation: StructureEvaluationReport;
    /** Piano craft score summary when the movement is a solo_piano_symbolic lane. */
    pianoCraftScore?: PianoCraftScoreSummary;
    /** Motif IDs confirmed in this movement's selected candidate. */
    confirmedMotifIds: string[];
    /** Wall-clock duration of this movement's generation pass (ms). */
    elapsedMs: number;
    /**
     * True when the pipeline used its staircase fallback (no Tier-3 candidate
     * was found) and selected from a lower tier.
     */
    usedFallback: boolean;
}

/**
 * The final outcome of a complete multi-movement cycle generation run.
 *
 * Produced by runCyclePipeline() once all movements have completed
 * (successfully or via fallback).
 */
export interface SonataCycleResult {
    cycleId: string;
    cyclePlanTitle: string;
    completedAt: string;
    movements: MovementCompletionRecord[];
    motifMemory: CrossMovementMotifMemory;
    /** Cycle-level evaluation report. Null if fewer than 2 movements completed. */
    cycleEvaluation: SonataCycleEvaluationReport | null;
}

/**
 * Cycle-level evaluation dimensions.
 *
 * All scores are in [0, 1] unless noted otherwise.
 */
export interface SonataCycleEvaluationReport {
    /**
     * Correlation between the planned global tension curve and the actual
     * per-movement finalCraftScores.  1.0 = perfect match; 0.0 = no correlation.
     * Computed as Pearson r clamped to [0, 1] (negative correlation treated as 0).
     */
    tensionArcMatch: number;

    /**
     * Fraction of SonataCyclePlan.globalMotifIds that were confirmed in >= 2
     * movements.  1.0 = every planned global motif survived across movements.
     */
    crossMovementMotifSurvivalRate: number;

    /**
     * Quality of the finale movement weighted by cycle completeness.
     * = lastMovement.finalCraftScore × (completedMovements / plannedMovements).
     * Rewards a strong finale only when the whole cycle completed.
     */
    finalPayoffScore: number;

    /**
     * Average finalCraftScore (or finalPianoScore for piano lane) across all
     * completed movements.  Reflects overall compositional quality.
     */
    movementCohesionScore: number;

    /**
     * Composite cycle score: weighted combination of the four dimensions above.
     * Weights: tensionArcMatch × 0.25, motifSurvival × 0.30,
     *          finalPayoff × 0.25, cohesion × 0.20.
     */
    compositeCycleScore: number;

    /** Number of movements that completed (may be < plan length on partial run). */
    completedMovementCount: number;

    /** Total movements in the plan. */
    plannedMovementCount: number;

    /** True when every planned movement completed with a Tier-3 candidate. */
    allMovementsPassedGate3: boolean;

    /** Diagnostic notes for each movement (motif recall outcome, gate tier, etc.). */
    movementNotes: Array<{
        ordinal: number;
        movementId: string;
        gateTier: 0 | 1 | 2 | 3;
        motifRecallScore: number;
        note: string;
    }>;
}
// Persistent capture of every piano generation round.  Entries accumulate in
// outputs/_system/piano-data-loop.jsonl and are exported as four fine-tuning
// dataset files by exportAllPianoDatasets().
