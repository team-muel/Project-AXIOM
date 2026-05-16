import type { ComposeWorkflow, ModelBinding } from "./types.js";

export interface DefaultModelBindingOptions {
    includePlanner?: boolean;
    plannerProvider?: string;
    plannerModel?: string;
    plannerVersion?: string;
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
        bindings.push({
            role: "structure",
            provider: "python",
            model: "music21-symbolic-v1",
        });
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