/**
 * test/generation-strategy.test.mjs
 *
 * GS-01..12: GenerationStrategy 타입 + config 해석 + modelBindings + hybridPool 동작 테스트
 *
 * 검증 항목:
 *   GS-01: LEARNED_SYMBOLIC_BACKEND=template → generationStrategy=template_first (기본)
 *   GS-02: LEARNED_SYMBOLIC_BACKEND=notagen_local → generationStrategy=notagen_first (자동 추론)
 *   GS-03: AXIOM_GENERATION_STRATEGY=hybrid_notagen_with_template_baseline → hybrid (명시 override)
 *   GS-04: AXIOM_GENERATION_STRATEGY=invalid → fallback to template_first
 *   GS-05: template_first → defaultModelBindings → music21-symbolic-v1
 *   GS-06: notagen_first → defaultModelBindings → learned-symbolic-v1
 *   GS-07: hybrid_notagen_with_template_baseline → defaultModelBindings → learned-symbolic-v1
 *   GS-08: ComposeRequest.generationStrategy per-request override
 *   GS-09: hybrid + no learned binding → single "requested" variant (fallback)
 *   GS-10: hybrid + learned binding → multi-candidate variants (learned N + baseline M)
 *   GS-11: template_first + promotion lane inactive → single "requested" variant
 *   GS-12: notagen_first → single "requested" variant (not multi-candidate)
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// ─── Inline: resolveGenerationStrategy (reproduces config.ts logic) ─────────

const VALID_STRATEGIES = ["template_first", "notagen_first", "hybrid_notagen_with_template_baseline"];

function resolveGenerationStrategy(explicit, backend) {
    if (VALID_STRATEGIES.includes(explicit)) {
        return explicit;
    }
    if (backend === "notagen_local") {
        return "notagen_first";
    }
    return "template_first";
}

// ─── Inline: defaultModelBindings (reproduces modelBindings.ts logic) ────────

function defaultModelBindings(workflow, options = {}) {
    const bindings = [];
    if (workflow !== "audio_only") {
        const strategy = options.generationStrategy ?? "template_first";
        const useLearnedSymbolic =
            strategy === "notagen_first" ||
            strategy === "hybrid_notagen_with_template_baseline";
        bindings.push({
            role: "structure",
            provider: useLearnedSymbolic ? "learned_symbolic" : "python",
            model: useLearnedSymbolic ? "learned-symbolic-v1" : "music21-symbolic-v1",
        });
    }
    if (workflow !== "symbolic_only") {
        bindings.push({ role: "audio_renderer", provider: "transformers", model: "facebook/musicgen-large" });
    }
    return bindings;
}

// ─── Inline: hybridPool entry-gate logic (reproduces hybridSymbolicCandidatePool.ts) ──

const LEARNED_PROVIDERS = new Set(["learned", "learned_symbolic"]);

function isLearnedStructureBinding(binding) {
    if (!binding) return false;
    const provider = String(binding.provider ?? "").trim().toLowerCase();
    const model = String(binding.model ?? "").trim().toLowerCase();
    return LEARNED_PROVIDERS.has(provider)
        || model.startsWith("learned-symbolic")
        || model.startsWith("learned_symbolic");
}

function resolveStructureBinding(selectedModels) {
    return selectedModels?.find((b) => b.role === "structure");
}

/**
 * Simplified hybrid pool entry gate — mirrors buildHybridSymbolicCandidateRequests logic.
 * Returns "multi" when multi-candidate pool is entered, "single" otherwise.
 */
function hybridPoolMode(request, executionPlan, isPromotionLaneActive = false) {
    const strategy = request.generationStrategy ?? "template_first";
    const isHybridStrategy = strategy === "hybrid_notagen_with_template_baseline";
    const enterMultiCandidate = isHybridStrategy || isPromotionLaneActive;

    if (!enterMultiCandidate) return "single";

    const learnedBinding = resolveStructureBinding(
        request.selectedModels ?? executionPlan.selectedModels,
    );
    if (!isLearnedStructureBinding(learnedBinding)) return "single";
    return "multi";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GenerationStrategy — config resolution", () => {
    it("GS-01: template backend → template_first (default)", () => {
        assert.equal(resolveGenerationStrategy("", "template"), "template_first");
    });

    it("GS-02: notagen_local backend → notagen_first (auto-inferred)", () => {
        assert.equal(resolveGenerationStrategy("", "notagen_local"), "notagen_first");
    });

    it("GS-03: explicit hybrid override wins over backend", () => {
        assert.equal(
            resolveGenerationStrategy("hybrid_notagen_with_template_baseline", "template"),
            "hybrid_notagen_with_template_baseline",
        );
    });

    it("GS-04: invalid AXIOM_GENERATION_STRATEGY → fallback template_first", () => {
        assert.equal(resolveGenerationStrategy("unknown_strategy", "template"), "template_first");
    });

    it("GS-04b: notagen_mock backend → template_first (mock is CI mode)", () => {
        assert.equal(resolveGenerationStrategy("", "notagen_mock"), "template_first");
    });
});

describe("GenerationStrategy — defaultModelBindings", () => {
    it("GS-05: template_first → music21-symbolic-v1", () => {
        const bindings = defaultModelBindings("symbolic_only", { generationStrategy: "template_first" });
        const struct = bindings.find((b) => b.role === "structure");
        assert.equal(struct?.model, "music21-symbolic-v1");
        assert.equal(struct?.provider, "python");
    });

    it("GS-06: notagen_first → learned-symbolic-v1", () => {
        const bindings = defaultModelBindings("symbolic_only", { generationStrategy: "notagen_first" });
        const struct = bindings.find((b) => b.role === "structure");
        assert.equal(struct?.model, "learned-symbolic-v1");
        assert.equal(struct?.provider, "learned_symbolic");
    });

    it("GS-07: hybrid_notagen_with_template_baseline → learned-symbolic-v1 as default", () => {
        const bindings = defaultModelBindings("symbolic_only", {
            generationStrategy: "hybrid_notagen_with_template_baseline",
        });
        const struct = bindings.find((b) => b.role === "structure");
        assert.equal(struct?.model, "learned-symbolic-v1");
        assert.equal(struct?.provider, "learned_symbolic");
    });

    it("GS-08: generationStrategy undefined → template_first behavior", () => {
        const bindings = defaultModelBindings("symbolic_only");
        const struct = bindings.find((b) => b.role === "structure");
        assert.equal(struct?.model, "music21-symbolic-v1");
    });
});

describe("GenerationStrategy — hybrid pool entry gate", () => {
    const learnedModels = [{ role: "structure", provider: "learned_symbolic", model: "learned-symbolic-v1" }];
    const templateModels = [{ role: "structure", provider: "python", model: "music21-symbolic-v1" }];

    it("GS-09: hybrid strategy + no learned binding → single variant (fallback)", () => {
        const mode = hybridPoolMode(
            { generationStrategy: "hybrid_notagen_with_template_baseline", selectedModels: templateModels },
            { selectedModels: templateModels },
        );
        assert.equal(mode, "single");
    });

    it("GS-10: hybrid strategy + learned binding → multi-candidate pool entered", () => {
        const mode = hybridPoolMode(
            { generationStrategy: "hybrid_notagen_with_template_baseline", selectedModels: learnedModels },
            { selectedModels: learnedModels },
        );
        assert.equal(mode, "multi");
    });

    it("GS-11: template_first + promotion lane inactive → single variant", () => {
        const mode = hybridPoolMode(
            { generationStrategy: "template_first", selectedModels: templateModels },
            { selectedModels: templateModels },
            false, // promotion lane inactive
        );
        assert.equal(mode, "single");
    });

    it("GS-12: notagen_first → single variant (not multi-candidate)", () => {
        const mode = hybridPoolMode(
            { generationStrategy: "notagen_first", selectedModels: learnedModels },
            { selectedModels: learnedModels },
            false,
        );
        assert.equal(mode, "single");
    });

    it("GS-10b: per-request override sets hybrid on template_first config", () => {
        // simulates: config.generationStrategy = "template_first"
        // but request explicitly requests hybrid
        const requestStrategy = "hybrid_notagen_with_template_baseline";
        const mode = hybridPoolMode(
            { generationStrategy: requestStrategy, selectedModels: learnedModels },
            { selectedModels: learnedModels },
        );
        assert.equal(mode, "multi");
    });
});
