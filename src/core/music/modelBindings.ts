import type { ComposeWorkflow, GenerationStrategy, ModelBinding } from "../pipeline/types.js";

export interface DefaultModelBindingOptions {
    includePlanner?: boolean;
    plannerProvider?: string;
    plannerModel?: string;
    plannerVersion?: string;
    /**
     * Generation strategy hint.
     * When "notagen_first" or "hybrid_notagen_with_template_baseline",
     * the default structure binding becomes learned_symbolic instead of music21.
     * music21 is still emitted as a secondary binding for hybrid mode
     * (hybridSymbolicCandidatePool.ts then handles the per-variant split).
     */
    generationStrategy?: GenerationStrategy;
}

export function defaultModelBindings(
    workflow: ComposeWorkflow,
    options: DefaultModelBindingOptions = {},
): ModelBinding[] {
    const bindings: ModelBinding[] = [];

    if (options.includePlanner && options.plannerProvider && options.plannerModel) {
        bindings.push({
            role: "planner",
            provider: options.plannerProvider,
            model: options.plannerModel,
            ...(options.plannerVersion ? { version: options.plannerVersion } : {}),
        });
    }

    if (workflow !== "audio_only") {
        const strategy = options.generationStrategy ?? "template_first";
        const useLearnedSymbolic =
            strategy === "notagen_first" ||
            strategy === "hybrid_notagen_with_template_baseline";

        if (useLearnedSymbolic) {
            bindings.push({
                role: "structure",
                provider: "learned_symbolic",
                model: "learned-symbolic-v1",
            });
        } else {
            bindings.push({
                role: "structure",
                provider: "python",
                model: "music21-symbolic-v1",
            });
        }
    }

    if (workflow !== "symbolic_only") {
        bindings.push({
            role: "audio_renderer",
            provider: "transformers",
            model: "facebook/musicgen-large",
        });
    }

    return bindings;
}