import type { PianoCraftScoreSummary, PianoRevisionDirective, PianoRevisionDirectiveKind } from "../pipeline/types.js";

// pianoListenabilityRepair.ts — Piano listenability failure → PianoRevisionDirective conversion
// ──────────────────────────────────────────────────────────────────────────────────────────────
// Maps low/high scores on each listenability dimension to a concrete PianoRevisionDirective
// that can be routed to PianoRepairSolver (repairSolver strategy) or NotaGen rewrite (rewrite).
//
// Thresholds (tunable via profile in the future):
//   melodyProminenceScore   < 0.50  → clarify_right_hand_melody (repairSolver)
//   bassRootSupportScore    < 0.50  → strengthen_left_hand_bass  (repairSolver)
//   accompanimentConsistency not exposed directly on PianoCraftScoreSummary;
//       we use accompanimentPatternCoherence < 0.50 as the proxy.
//   pedalBlurRisk           < 0.50  → improve_pedal_changes      (repairSolver)
//       NOTE: pedalBlurRisk is an inverted score — 1 = no blur, 0 = high blur.
//       Low score = high blur = directive needed.
//   pianoListenabilityScore < 0.55  → make_texture_more_pianistic (either, lowest priority)
// ──────────────────────────────────────────────────────────────────────────────────────────────

export interface PianoListenabilityRepairThresholds {
    melodyProminence: number;
    bassRootSupport: number;
    accompanimentCoherence: number;
    pedalBlurRisk: number;
    overallListenability: number;
}

export const PIANO_LISTENABILITY_REPAIR_THRESHOLDS_V1: PianoListenabilityRepairThresholds = {
    melodyProminence: 0.5,
    bassRootSupport: 0.5,
    accompanimentCoherence: 0.5,
    pedalBlurRisk: 0.5,
    overallListenability: 0.55,
};

interface RepairSpec {
    kind: PianoRevisionDirectiveKind;
    priority: number;
    reason: string;
    fallbackStrategy: "repairSolver" | "rewrite" | "either";
}

const REPAIR_SPECS: Array<{
    test: (s: PianoCraftScoreSummary, t: PianoListenabilityRepairThresholds) => boolean;
    spec: RepairSpec;
}> = [
    {
        test: (s, t) => s.melodyProminenceScore !== undefined && s.melodyProminenceScore < t.melodyProminence,
        spec: {
            kind: "clarify_right_hand_melody",
            priority: 1,
            reason: "Melody prominence score is below threshold — right-hand melody is not sufficiently audible above the accompaniment.",
            fallbackStrategy: "repairSolver",
        },
    },
    {
        test: (s, t) => s.bassRootSupportScore !== undefined && s.bassRootSupportScore < t.bassRootSupport,
        spec: {
            kind: "strengthen_left_hand_bass",
            priority: 2,
            reason: "Bass root support score is below threshold — left-hand bass does not adequately ground the harmony.",
            fallbackStrategy: "repairSolver",
        },
    },
    {
        test: (s, t) => s.accompanimentPatternCoherence < t.accompanimentCoherence,
        spec: {
            kind: "increase_accompaniment_consistency",
            priority: 3,
            reason: "Accompaniment pattern coherence is below threshold — rhythmic pattern is inconsistent or too variable.",
            fallbackStrategy: "repairSolver",
        },
    },
    {
        test: (s, t) =>
            // pedalBlurRisk is inverted: low value = high blur
            s.pedalBlurRisk !== undefined && s.pedalBlurRisk < t.pedalBlurRisk,
        spec: {
            kind: "improve_pedal_changes",
            priority: 4,
            reason: "Pedal blur risk is elevated — sustain pedal is held too long across harmonic changes, causing harmonic blur.",
            fallbackStrategy: "repairSolver",
        },
    },
    {
        test: (s, t) =>
            s.pianoListenabilityScore !== undefined && s.pianoListenabilityScore < t.overallListenability,
        spec: {
            kind: "make_texture_more_pianistic",
            priority: 5,
            reason: "Overall piano listenability score is below threshold — texture needs broader pianistic revision.",
            fallbackStrategy: "either",
        },
    },
];

/**
 * Converts a `PianoCraftScoreSummary` into a list of `PianoRevisionDirective` items
 * targeting the specific listenability dimensions that fell below threshold.
 *
 * The returned directives are sorted by ascending priority (most critical first).
 * Returns an empty array when all dimensions pass.
 *
 * @param pianoScore  - Evaluated piano craft score summary (must include supplementary listenability fields).
 * @param thresholds  - Optional override thresholds; defaults to `PIANO_LISTENABILITY_REPAIR_THRESHOLDS_V1`.
 */
export function buildPianoListenabilityRepairDirectives(
    pianoScore: PianoCraftScoreSummary,
    thresholds: PianoListenabilityRepairThresholds = PIANO_LISTENABILITY_REPAIR_THRESHOLDS_V1,
): PianoRevisionDirective[] {
    const directives: PianoRevisionDirective[] = [];

    for (const { test, spec } of REPAIR_SPECS) {
        if (test(pianoScore, thresholds)) {
            directives.push({
                kind: spec.kind,
                priority: spec.priority,
                reason: spec.reason,
                fallbackStrategy: spec.fallbackStrategy,
            });
        }
    }

    return directives.sort((a, b) => a.priority - b.priority);
}
