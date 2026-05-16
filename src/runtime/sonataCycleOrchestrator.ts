/**
 * Sonata cycle orchestrator.
 *
 * Takes a SonataCyclePlan and a base ComposeRequest template, then generates
 * each movement sequentially in ordinal order (1 → 2 → 3 → 4).
 *
 * Key responsibilities:
 *   1. Derive a per-movement ComposeRequest from the base request + MovementPlan
 *      (key, tempo, form, duration, inherited motifs from prior movements).
 *   2. Call runPipeline() for each movement and collect its JobManifest.
 *   3. After each movement is selected, extract confirmed motifs and update the
 *      CrossMovementMotifMemory for the subsequent movement.
 *   4. Inject confirmed motifs from completed movements into the next movement's
 *      prompt so that the planner can reference them.
 *   5. Run the cycle-level evaluator after all movements complete.
 *   6. Produce a SonataCycleResult.
 *
 * This module does NOT modify any persisted artifact.  It is the scheduling
 * wrapper that reuses the existing single-movement runPipeline() path.
 */

import { v4 as uuidv4 } from "uuid";
import { runPipeline, type RunPipelineOptions } from "./orchestrator.js";
import { evaluateSonataCycle } from "../core/evaluate/cycleEvaluation.js";
import type {
    ComposeRequest,
    CrossMovementMotifMemory,
    JobManifest,
    MotifMemoryEntry,
    MovementCompletionRecord,
    MovementPlan,
    SonataCyclePlan,
    SonataCycleResult,
    StructureEvaluationReport,
} from "../core/pipeline/types.js";
import { readStructureCandidateIndex } from "./manifest/candidates.js";
import { logger } from "../logging/logger.js";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface RunCyclePipelineOptions extends RunPipelineOptions {
    /**
     * Called after each movement completes (or fails) so the caller can
     * observe intermediate progress.
     */
    onMovementComplete?: (record: MovementCompletionRecord, manifestSongId: string) => void;

    /**
     * When true, the cycle continues even when a movement produces only a
     * Tier-1 or Tier-2 fallback candidate instead of stopping.
     * Default: true.
     */
    continueOnFallback?: boolean;

    /**
     * Abort the cycle run and return a partial result if fewer than this
     * fraction of movements have completed successfully.
     * Default: 0 (never abort early, always return what we have).
     */
    minCompletionFraction?: number;
}

// ─── Motif memory helpers ─────────────────────────────────────────────────────

function emptyMotifMemory(): CrossMovementMotifMemory {
    return {
        entries: [],
        confirmedGlobalMotifIds: [],
        totalRecallCount: 0,
    };
}

/**
 * Add a new movement's confirmed motifs to the memory.
 *
 * For each motif in `newMotifs`: create a MotifMemoryEntry if not already
 * present.  For each motif in `inheritedMotifs` that is confirmed in this
 * movement: update the existing entry's recalledInOrdinals list.
 * Recompute confirmedGlobalMotifIds (motifs in >= 2 movements).
 */
function updateMotifMemory(
    memory: CrossMovementMotifMemory,
    movement: MovementPlan,
    confirmedMotifIds: string[],
    evidenceStrength: number,
): CrossMovementMotifMemory {
    const confirmedSet = new Set(confirmedMotifIds);
    const entries = memory.entries.map((e) => ({ ...e, recalledInOrdinals: [...e.recalledInOrdinals] }));
    const entryById = new Map(entries.map((e) => [e.motifId, e]));

    // Register new motifs introduced in this movement.
    for (const motifId of movement.newMotifs) {
        if (!entryById.has(motifId)) {
            const entry: MotifMemoryEntry = {
                motifId,
                introducedInOrdinal: movement.ordinal,
                recalledInOrdinals: [],
                evidenceStrength: confirmedSet.has(motifId) ? evidenceStrength : 0,
            };
            entries.push(entry);
            entryById.set(motifId, entry);
        }
    }

    // Record recall events for inherited motifs confirmed in this movement.
    let recallCount = memory.totalRecallCount;
    for (const motifId of movement.inheritedMotifs) {
        if (!confirmedSet.has(motifId)) continue;
        const existing = entryById.get(motifId);
        if (existing && !existing.recalledInOrdinals.includes(movement.ordinal)) {
            existing.recalledInOrdinals.push(movement.ordinal);
            recallCount++;
        }
    }

    // Recompute confirmed global motifs (appeared in >= 2 distinct movements).
    const confirmedGlobalMotifIds = entries
        .filter((e) => {
            const allOrdinals = new Set([e.introducedInOrdinal, ...e.recalledInOrdinals]);
            return allOrdinals.size >= 2;
        })
        .map((e) => e.motifId);

    return {
        entries,
        confirmedGlobalMotifIds,
        totalRecallCount: recallCount,
    };
}

// ─── Confirmed motif extraction ───────────────────────────────────────────────

/**
 * Extract the motif IDs that were confirmed in a completed movement.
 *
 * Strategy (best-effort):
 *   1. If the manifest's structureEvaluation carries a `confirmedMotifIds`
 *      field (future extension), use that.
 *   2. If `motifSurvival` craft score >= 0.6, consider `newMotifs` confirmed.
 *   3. Always include `inheritedMotifs` that were supposed to be recalled if
 *      the candidate passed Gate 3 (motifSurvival >= 0.5).
 *
 * The result is a conservative estimate; it errs toward not over-claiming.
 */
function extractConfirmedMotifIds(
    manifest: JobManifest,
    movement: MovementPlan,
): string[] {
    const eval_ = manifest.structureEvaluation;
    if (!eval_) return [];

    // Direct field if available (forward-compatible).
    const extended = eval_ as unknown as Record<string, unknown>;
    if (Array.isArray(extended["confirmedMotifIds"])) {
        return extended["confirmedMotifIds"] as string[];
    }

    const motifSurvival = eval_.craftScoreSummary?.motifSurvival ?? 0;
    const confirmed: string[] = [];

    if (motifSurvival >= 0.6) {
        confirmed.push(...movement.newMotifs);
    }
    if (motifSurvival >= 0.5) {
        confirmed.push(...movement.inheritedMotifs);
    }
    return [...new Set(confirmed)];
}

// ─── Evidence strength ────────────────────────────────────────────────────────

function evidenceStrengthFrom(structureEval: StructureEvaluationReport | undefined): number {
    if (!structureEval) return 0.5;
    const piano = structureEval.pianoCraftScoreSummary;
    if (piano) return piano.finalPianoScore ?? 0.5;
    return structureEval.craftScoreSummary?.motifSurvival ?? 0.5;
}

// ─── Per-movement request derivation ─────────────────────────────────────────

/**
 * Build the ComposeRequest for a single movement.
 *
 * Overrides key, tempo, form, and duration from the MovementPlan.
 * Appends inherited motif context to the prompt so the planner can see them.
 * Uses a fresh songId per movement so manifests are stored independently.
 */
function buildMovementRequest(
    baseRequest: ComposeRequest,
    movement: MovementPlan,
    globalKey: string,
    cycleTitle: string,
    motifMemory: CrossMovementMotifMemory,
    cycleId: string,
): ComposeRequest {
    const motifContext =
        motifMemory.entries.length > 0
            ? `\n\n[AXIOM_CYCLE_MOTIFS cycle=${cycleId} ordinal=${movement.ordinal}]\n` +
              motifMemory.entries
                  .map((e) => `motif=${e.motifId} introduced_in=${e.introducedInOrdinal} strength=${e.evidenceStrength.toFixed(2)}`)
                  .join("\n") +
              `\ninherited=${movement.inheritedMotifs.join(",")}` +
              `\n[/AXIOM_CYCLE_MOTIFS]`
            : "";

    const movementTag =
        `[movement ordinal=${movement.ordinal} function=${movement.functionInCycle} form=${movement.form} ` +
        `key=${movement.key} global_key=${globalKey} cycle="${cycleTitle}"]`;

    return {
        ...baseRequest,
        songId: `${cycleId}-m${movement.ordinal}-${uuidv4().slice(0, 8)}`,
        key: movement.key,
        tempo: movement.tempo,
        form: movement.form,
        durationSec: movement.targetDurationSec,
        prompt: `${baseRequest.prompt} ${movementTag}${motifContext}`.trim(),
    };
}

// ─── Gate tier inference ──────────────────────────────────────────────────────

/**
 * Determine the gate tier of a completed manifest, mirroring the logic in
 * structureSelection.ts (which assigns tier at candidate selection time).
 * Used only for reporting in the movement notes.
 */
function inferGateTier(manifest: JobManifest): 0 | 1 | 2 | 3 {
    const eval_ = manifest.structureEvaluation;
    if (!eval_) return 0;
    const extended = eval_ as unknown as Record<string, unknown>;
    if (typeof extended["gateTier"] === "number") {
        const t = extended["gateTier"] as number;
        if (t === 0 || t === 1 || t === 2 || t === 3) return t;
    }
    const craftScore = eval_.craftScoreSummary?.finalCraftScore ?? 0;
    const pianoScore = eval_.pianoCraftScoreSummary?.finalPianoScore;
    const q = pianoScore ?? craftScore;
    if (q >= 0.65) return 3;
    if (q >= 0.45) return 2;
    return 1;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the complete multi-movement generation cycle.
 *
 * Movements are generated sequentially in ascending ordinal order.
 * Between movements, confirmed motifs are extracted from the manifest and
 * injected into the next movement's request via the prompt.
 *
 * @param cyclePlan   - The SonataCyclePlan describing all movements.
 * @param baseRequest - A seed ComposeRequest; key/tempo/form/duration are
 *                      overridden per movement.
 * @param options     - Pipeline callbacks and cycle-level behaviour flags.
 */
export async function runCyclePipeline(
    cyclePlan: SonataCyclePlan,
    baseRequest: ComposeRequest,
    options: RunCyclePipelineOptions = {},
): Promise<SonataCycleResult> {
    const {
        onManifestUpdate,
        onMovementComplete,
        continueOnFallback = true,
        minCompletionFraction = 0,
    } = options;

    const cycleId = uuidv4();
    const completedMovements: MovementCompletionRecord[] = [];
    let motifMemory = emptyMotifMemory();

    const sortedMovements = [...cyclePlan.movements].sort((a, b) => a.ordinal - b.ordinal);

    for (const movement of sortedMovements) {
        const movementRequest = buildMovementRequest(
            baseRequest,
            movement,
            cyclePlan.globalKey,
            cyclePlan.title,
            motifMemory,
            cycleId,
        );

        logger.info(
            `[cycle ${cycleId}] Starting movement ${movement.ordinal}/${sortedMovements.length}: ` +
                `id=${movement.id} form=${movement.form} key=${movement.key}`,
        );

        const startMs = Date.now();
        let manifest: JobManifest;
        try {
            manifest = await runPipeline(movementRequest, { onManifestUpdate });
        } catch (err) {
            logger.error(
                `[cycle ${cycleId}] Movement ${movement.ordinal} runPipeline threw: ${String(err)}`,
            );
            // Build a stub record so we can still return a partial result.
            const stubRecord: MovementCompletionRecord = {
                movementId: movement.id,
                ordinal: movement.ordinal,
                songId: movementRequest.songId ?? cycleId,
                selectedCandidateId: "none",
                structureEvaluation: {
                    passed: false,
                    issues: ["movement generation failed"],
                    strengths: [],
                } as StructureEvaluationReport,
                confirmedMotifIds: [],
                elapsedMs: Date.now() - startMs,
                usedFallback: true,
            };
            completedMovements.push(stubRecord);
            onMovementComplete?.(stubRecord, movementRequest.songId ?? cycleId);

            const completionFraction = completedMovements.length / sortedMovements.length;
            if (completionFraction >= (1 - minCompletionFraction)) continue;
            break;
        }

        const elapsedMs = Date.now() - startMs;
        const structureEval = manifest.structureEvaluation ?? ({} as StructureEvaluationReport);
        const confirmedMotifIds = extractConfirmedMotifIds(manifest, movement);
        const evidenceStrength = evidenceStrengthFrom(manifest.structureEvaluation);
        const tier = inferGateTier(manifest);
        const usedFallback = tier < 3;

        if (usedFallback && !continueOnFallback) {
            logger.warn(
                `[cycle ${cycleId}] Movement ${movement.ordinal} produced only tier-${tier} candidate; aborting cycle (continueOnFallback=false).`,
            );
            break;
        }

        motifMemory = updateMotifMemory(motifMemory, movement, confirmedMotifIds, evidenceStrength);

        const record: MovementCompletionRecord = {
            movementId: movement.id,
            ordinal: movement.ordinal,
            songId: manifest.songId,
            selectedCandidateId: readStructureCandidateIndex(manifest.songId)?.selectedCandidateId ?? "unknown",
            structureEvaluation: structureEval,
            pianoCraftScore: manifest.structureEvaluation?.pianoCraftScoreSummary,
            confirmedMotifIds,
            elapsedMs,
            usedFallback,
        };

        completedMovements.push(record);
        onMovementComplete?.(record, manifest.songId);

        logger.info(
            `[cycle ${cycleId}] Movement ${movement.ordinal} done: songId=${manifest.songId} ` +
                `tier=${tier} confirmedMotifs=[${confirmedMotifIds.join(",")}] elapsed=${elapsedMs}ms`,
        );
    }

    const cycleEvaluation =
        completedMovements.length >= 2
            ? evaluateSonataCycle(
                  {
                      cycleId,
                      cyclePlanTitle: cyclePlan.title,
                      completedAt: new Date().toISOString(),
                      movements: completedMovements,
                      motifMemory,
                      cycleEvaluation: null,
                  },
                  cyclePlan,
              )
            : null;

    logger.info(
        `[cycle ${cycleId}] Cycle complete: ` +
            `${completedMovements.length}/${sortedMovements.length} movements, ` +
            `composite=${cycleEvaluation?.compositeCycleScore.toFixed(3) ?? "n/a"}`,
    );

    return {
        cycleId,
        cyclePlanTitle: cyclePlan.title,
        completedAt: new Date().toISOString(),
        movements: completedMovements,
        motifMemory,
        cycleEvaluation,
    };
}
