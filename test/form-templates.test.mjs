import test from "node:test";
import assert from "node:assert/strict";
import {
    buildFallbackSectionsForForm,
    coerceComposeWorkflowForForm,
    resolveFormTemplate,
    resolveSecondaryKey,
    validateFormSectionFit,
} from "../dist/pipeline/formTemplates.js";

test("resolveFormTemplate matches sonata aliases", () => {
    const template = resolveFormTemplate("piano sonata allegro");

    assert.equal(template?.id, "sonata");
    assert.equal(template?.minSections, 4);
});

test("buildFallbackSectionsForForm creates a sonata skeleton with secondary-key theme_b", () => {
    const sections = buildFallbackSectionsForForm("sonata", "C major");

    assert.ok(sections);
    assert.deepEqual(sections?.map((section) => section.role), ["theme_a", "theme_b", "development", "recap"]);
    assert.equal(sections?.[1]?.harmonicPlan?.tonalCenter, "G major");
    assert.equal(sections?.[3]?.harmonicPlan?.tonalCenter, "C major");
});

test("validateFormSectionFit rejects malformed sonata ordering and tonal return", () => {
    const errors = validateFormSectionFit("sonata", [
        { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.4, density: 0.35, harmonicPlan: { tonalCenter: "C major", allowModulation: false } },
        { id: "s2", role: "recap", label: "Recap", measures: 8, energy: 0.34, density: 0.28, harmonicPlan: { tonalCenter: "G major", allowModulation: false } },
        { id: "s3", role: "development", label: "Development", measures: 8, energy: 0.72, density: 0.58, harmonicPlan: { tonalCenter: "G major", allowModulation: false } },
    ], "C major");

    assert.ok(errors.includes("sonata compositionPlan must include at least 4 sections"));
    assert.ok(errors.includes("sonata compositionPlan must include a theme_b section"));
    assert.ok(errors.includes("sonata compositionPlan should place theme_b before development") === false);
    assert.ok(errors.includes("sonata compositionPlan must order theme_a before development before recap"));
    assert.ok(errors.includes("sonata development should allow modulation"));
    assert.ok(errors.includes("sonata recap tonalCenter must return to the home key when specified"));
});

test("coerceComposeWorkflowForForm keeps sonata requests symbolic-first", () => {
    const workflow = coerceComposeWorkflowForForm("piano sonata", "audio_only", [
        { role: "audio_renderer", provider: "transformers", model: "facebook/musicgen-large" },
    ]);

    assert.equal(workflow, "symbolic_plus_audio");
    assert.equal(resolveSecondaryKey("D minor"), "A minor");
});