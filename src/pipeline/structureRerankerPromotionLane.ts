import type {
    ComposeExecutionPlan,
    CompositionPlan,
    InstrumentAssignment,
} from "./types.js";
import { STRING_TRIO_SYMBOLIC_LANE } from "./learnedSymbolicContract.js";

export const STRUCTURE_RERANKER_PROMOTION_LANE = STRING_TRIO_SYMBOLIC_LANE;

function normalizeInstrumentName(name: unknown): string {
    const normalized = String(name ?? "").trim().toLowerCase();
    if (!normalized) {
        return "";
    }

    if (normalized.includes("violoncello") || normalized.includes("cello")) {
        return "cello";
    }

    if (normalized.includes("viola")) {
        return "viola";
    }

    if (normalized.includes("violin")) {
        return "violin";
    }

    return normalized;
}

function isCanonicalStringTrio(instrumentation: InstrumentAssignment[] | undefined): boolean {
    const instruments = instrumentation ?? [];
    if (instruments.length !== 3) {
        return false;
    }

    const normalized = instruments
        .map((instrument) => normalizeInstrumentName(instrument?.name))
        .filter(Boolean);

    return normalized.length === 3
        && new Set(normalized).size === 3
        && ["violin", "viola", "cello"].every((name) => normalized.includes(name));
}

export function detectStructureRerankerPromotionLane(
    executionPlan: ComposeExecutionPlan,
    compositionPlan?: CompositionPlan,
    targetInstrumentation?: InstrumentAssignment[],
): string | null {
    if (executionPlan.workflow !== "symbolic_only") {
        return null;
    }

    if (compositionPlan?.orchestration?.family === "string_trio") {
        return STRUCTURE_RERANKER_PROMOTION_LANE;
    }

    const instrumentation = compositionPlan?.instrumentation ?? targetInstrumentation;
    return isCanonicalStringTrio(instrumentation)
        ? STRUCTURE_RERANKER_PROMOTION_LANE
        : null;
}