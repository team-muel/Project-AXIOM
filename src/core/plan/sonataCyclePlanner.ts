import type {
    CompositionPlan,
    CrossMovementRecallPlan,
    MovementForm,
    MovementFunction,
    MovementPlan,
    SonataCyclePlan,
} from "../pipeline/types.js";

/** Tension samples contributed by each movement to the global tension curve. */
const TENSION_SAMPLES_PER_MOVEMENT = 8;

/**
 * Characteristic tension envelope per movement function.
 * Each array has TENSION_SAMPLES_PER_MOVEMENT values in the range [0, 1].
 */
const MOVEMENT_TENSION_ENVELOPES: Record<MovementFunction, number[]> = {
    opening_argument: [0.38, 0.46, 0.58, 0.65, 0.62, 0.55, 0.48, 0.42],
    lyrical_center: [0.28, 0.34, 0.42, 0.50, 0.46, 0.40, 0.33, 0.26],
    contrast: [0.42, 0.55, 0.70, 0.78, 0.74, 0.68, 0.60, 0.52],
    resolution: [0.46, 0.56, 0.68, 0.80, 0.72, 0.56, 0.38, 0.20],
};

/**
 * Derive the global tension curve by concatenating each movement's characteristic
 * tension envelope in ascending ordinal order.
 * Returns TENSION_SAMPLES_PER_MOVEMENT × movements.length values.
 */
export function deriveCycleTensionCurve(movements: MovementPlan[]): number[] {
    if (movements.length === 0) {
        return [];
    }

    return [...movements]
        .sort((a, b) => a.ordinal - b.ordinal)
        .flatMap((movement) => MOVEMENT_TENSION_ENVELOPES[movement.functionInCycle]);
}

/**
 * Validate a SonataCyclePlan and return a list of human-readable issue strings.
 * An empty array means the cycle is structurally sound.
 */
export function validateSonataCyclePlan(cycle: SonataCyclePlan): string[] {
    const issues: string[] = [];

    const ordinals = cycle.movements.map((m) => m.ordinal);
    if (new Set(ordinals).size !== ordinals.length) {
        issues.push("SonataCyclePlan movements must have unique ordinals");
    }

    const firstMovement = cycle.movements.find((m) => m.ordinal === 1);
    if (!firstMovement) {
        issues.push("SonataCyclePlan must include a movement with ordinal 1");
    } else if (firstMovement.functionInCycle !== "opening_argument") {
        issues.push("SonataCyclePlan movement ordinal 1 must have functionInCycle 'opening_argument'");
    }

    if (cycle.movements.length > 1) {
        const maxOrdinal = Math.max(...ordinals);
        const lastMovement = cycle.movements.find((m) => m.ordinal === maxOrdinal);
        if (lastMovement && lastMovement.functionInCycle !== "resolution") {
            issues.push(
                `SonataCyclePlan last movement (ordinal ${maxOrdinal}) should have functionInCycle 'resolution'`,
            );
        }
    }

    if (cycle.globalMotifIds.length === 0) {
        issues.push("SonataCyclePlan must declare at least one globalMotifId");
    }

    // Build the complete motif registry (inherited + new) per movement id.
    const motifsByMovementId = new Map<string, Set<string>>();
    for (const movement of cycle.movements) {
        motifsByMovementId.set(
            movement.id,
            new Set([...movement.inheritedMotifs, ...movement.newMotifs]),
        );
    }

    for (const recall of cycle.crossMovementRecall) {
        const sourceMotifs = motifsByMovementId.get(recall.sourceMovementId);
        if (!sourceMotifs) {
            issues.push(
                `CrossMovementRecallPlan references unknown sourceMovementId '${recall.sourceMovementId}'`,
            );
            continue;
        }

        if (!motifsByMovementId.has(recall.movementId)) {
            issues.push(
                `CrossMovementRecallPlan references unknown movementId '${recall.movementId}'`,
            );
            continue;
        }

        for (const motifId of recall.motifIds) {
            if (!sourceMotifs.has(motifId)) {
                issues.push(
                    `CrossMovementRecallPlan motif '${motifId}' not found in source movement '${recall.sourceMovementId}'`,
                );
            }
        }
    }

    // Validate inherited motifs were declared as newMotifs in some preceding movement.
    const declaredMotifs = new Set<string>();
    for (const movement of [...cycle.movements].sort((a, b) => a.ordinal - b.ordinal)) {
        for (const motifId of movement.inheritedMotifs) {
            if (!declaredMotifs.has(motifId)) {
                issues.push(
                    `Movement '${movement.id}' (ordinal ${movement.ordinal}) inherits motif '${motifId}' not declared in any preceding movement`,
                );
            }
        }
        for (const motifId of movement.newMotifs) {
            declaredMotifs.add(motifId);
        }
    }

    const sumDuration = cycle.movements.reduce((sum, m) => sum + m.targetDurationSec, 0);
    if (Math.abs(cycle.totalDurationSec - sumDuration) > 30) {
        issues.push(
            `SonataCyclePlan totalDurationSec (${cycle.totalDurationSec}s) differs from sum of movement durations (${sumDuration}s) by more than 30s`,
        );
    }

    return issues;
}

export interface MovementExtractionOptions {
    ordinal: 1 | 2 | 3 | 4;
    form: MovementForm;
    functionInCycle: MovementFunction;
    id?: string;
    inheritedMotifs?: string[];
}

/**
 * Derive a MovementPlan from an existing CompositionPlan and cycle-level metadata.
 * `newMotifs` are taken from `plan.sketch.motifDrafts` when present.
 */
export function extractMovementPlanFromCompositionPlan(
    plan: CompositionPlan,
    options: MovementExtractionOptions,
): MovementPlan {
    const newMotifs = plan.sketch?.motifDrafts.map((m) => m.id) ?? [];
    return {
        id: options.id ?? `movement_${options.ordinal}`,
        ordinal: options.ordinal,
        form: options.form,
        key: plan.key ?? "C major",
        tempo: plan.tempo ?? 120,
        targetDurationSec: plan.targetDurationSec ?? 0,
        functionInCycle: options.functionInCycle,
        inheritedMotifs: options.inheritedMotifs ?? [],
        newMotifs,
    };
}

export interface SonataCycleBuildInput {
    plan: CompositionPlan;
    ordinal: 1 | 2 | 3 | 4;
    form: MovementForm;
    functionInCycle: MovementFunction;
    id?: string;
    inheritedMotifs?: string[];
}

/**
 * Assemble a SonataCyclePlan from per-movement CompositionPlans.
 *
 * - `totalDurationSec` is derived from the sum of movement target durations.
 * - `globalMotifIds` are motifs that appear in more than one movement
 *   (inherited or new); falls back to the first movement's first new motif.
 * - `globalTensionCurve` is derived via `deriveCycleTensionCurve`.
 */
export function buildSonataCyclePlan(
    title: string,
    globalKey: string,
    inputs: SonataCycleBuildInput[],
    crossMovementRecall: CrossMovementRecallPlan[] = [],
): SonataCyclePlan {
    const movements = inputs.map((input) =>
        extractMovementPlanFromCompositionPlan(input.plan, {
            ordinal: input.ordinal,
            form: input.form,
            functionInCycle: input.functionInCycle,
            id: input.id,
            inheritedMotifs: input.inheritedMotifs,
        }),
    );

    const totalDurationSec = movements.reduce((sum, m) => sum + m.targetDurationSec, 0);

    const motifMovementCount = new Map<string, number>();
    for (const movement of movements) {
        for (const id of [...movement.inheritedMotifs, ...movement.newMotifs]) {
            motifMovementCount.set(id, (motifMovementCount.get(id) ?? 0) + 1);
        }
    }

    const crossMovementMotifIds = [...motifMovementCount.entries()]
        .filter(([, count]) => count > 1)
        .map(([id]) => id);

    const globalMotifIds = crossMovementMotifIds.length > 0
        ? crossMovementMotifIds
        : (movements.find((m) => m.ordinal === 1)?.newMotifs.slice(0, 1) ?? []);

    return {
        title,
        totalDurationSec,
        globalKey,
        globalMotifIds,
        movements,
        crossMovementRecall,
        globalTensionCurve: deriveCycleTensionCurve(movements),
    };
}
