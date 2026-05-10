import test from "node:test";
import assert from "node:assert/strict";
import {
    ensureClassicalKnowledgePlan,
    normalizeClassicalKnowledgePlan,
    summarizeClassicalKnowledgePlan,
} from "../dist/pipeline/classicalKnowledge.js";
import { buildStructureEvaluation } from "../dist/pipeline/evaluation.js";
import { applyRevisionDirectives, buildStructureRevisionDirectives } from "../dist/pipeline/quality.js";
import { normalizeComposeRequestInput } from "../dist/pipeline/requestNormalization.js";

function basePlan(overrides = {}) {
    return {
        version: "planner-v1",
        brief: "A compact but fully notated classical study.",
        mood: ["focused"],
        form: "sonata",
        workflow: "symbolic_only",
        instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "pad"], register: "wide" }],
        expressionDefaults: {
            dynamics: { start: "p", peak: "mf", end: "p" },
            articulation: ["legato"],
            character: ["cantabile"],
        },
        motifPolicy: {
            reuseRequired: true,
            inversionAllowed: true,
            augmentationAllowed: true,
            diminutionAllowed: false,
            sequenceAllowed: true,
        },
        longSpanForm: {
            expositionStartSectionId: "s1",
            developmentStartSectionId: "s3",
            recapStartSectionId: "s4",
            returnSectionId: "s4",
            expectedDevelopmentPressure: "high",
            expectedReturnPayoff: "inevitable",
        },
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Primary idea",
                measures: 4,
                energy: 0.4,
                density: 0.35,
                cadence: "half",
                phraseSpanShape: "period",
                harmonicPlan: { tonalCenter: "C major", harmonicRhythm: "medium", cadence: "half", allowModulation: false },
                expression: { articulation: ["legato"], character: ["dolce"], phrasePeaks: [3] },
            },
            {
                id: "s2",
                role: "theme_b",
                label: "Contrasting idea",
                measures: 4,
                energy: 0.52,
                density: 0.42,
                cadence: "half",
                harmonicPlan: { tonalCenter: "G major", harmonicRhythm: "medium", cadence: "half", allowModulation: true },
                expression: { articulation: ["tenuto"], character: ["espressivo"], phrasePeaks: [2] },
            },
            {
                id: "s3",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.72,
                density: 0.58,
                harmonicPlan: {
                    tonalCenter: "G major",
                    harmonicRhythm: "fast",
                    cadence: "half",
                    allowModulation: true,
                    colorCues: [{ tag: "applied_dominant", keyTarget: "G major" }],
                },
                texture: { voiceCount: 3, primaryRoles: ["lead", "inner_voice", "bass"], counterpointMode: "contrary_motion" },
            },
            {
                id: "s4",
                role: "recap",
                label: "Return",
                measures: 4,
                energy: 0.36,
                density: 0.32,
                cadence: "authentic",
                harmonicPlan: { tonalCenter: "C major", harmonicRhythm: "medium", cadence: "authentic", allowModulation: false },
                ornaments: [{ tag: "fermata", startMeasure: 4, targetBeat: 4, intensity: 0.8 }],
            },
        ],
        rationale: "Exercise classical form, cadence, expression, and counterpoint as explicit knowledge.",
        ...overrides,
    };
}

test("ensureClassicalKnowledgePlan derives a classical-theory contract from a composition plan", () => {
    const plan = ensureClassicalKnowledgePlan(basePlan());

    assert.ok(plan.classicalKnowledge);
    assert.ok(plan.classicalKnowledge.domains.includes("harmony"));
    assert.ok(plan.classicalKnowledge.domains.includes("counterpoint"));
    assert.ok(plan.classicalKnowledge.domains.includes("notation"));
    assert.equal(plan.classicalKnowledge.harmony?.cadencePolicy, "architectural");
    assert.equal(plan.classicalKnowledge.counterpoint?.voiceLeading, "strict");
    assert.equal(plan.classicalKnowledge.form?.developmentPriority, "high");
    assert.equal(plan.classicalKnowledge.form?.returnStrategy, "inevitable");
    assert.ok((plan.classicalKnowledge.notation?.marks.length ?? 0) >= 5);
});

test("normalizeClassicalKnowledgePlan preserves unsupported notation marks as intent", () => {
    const plan = normalizeClassicalKnowledgePlan({
        domains: ["notation", "performance"],
        notation: {
            marks: [
                { category: "pedal", mark: "una corda", scope: "section", sectionId: "s1" },
                { category: "technique", mark: "con sordino", scope: "global" },
            ],
        },
    });

    assert.equal(plan?.notation?.marks.length, 2);
    assert.equal(plan?.notation?.marks[0]?.mark, "una corda");
    assert.equal(plan?.notation?.marks[1]?.category, "technique");
});

test("normalizeComposeRequestInput hydrates compositionPlan.classicalKnowledge", () => {
    const normalized = normalizeComposeRequestInput({
        prompt: "Write a refined classical miniature with explicit expressive notation.",
        compositionPlan: basePlan({
            classicalKnowledge: {
                domains: ["harmony", "notation"],
                harmony: { cadencePolicy: "architectural" },
                notation: { marks: [{ category: "dynamic", mark: "ff", scope: "section", sectionId: "s3" }] },
            },
        }),
    });

    assert.deepEqual(normalized.errors, []);
    const summary = summarizeClassicalKnowledgePlan(normalized.request?.compositionPlan?.classicalKnowledge);
    assert.equal(summary?.cadencePolicy, "architectural");
    assert.ok((summary?.notationMarkCount ?? 0) >= 1);
    assert.ok(normalized.request?.classicalKnowledge);
});

test("buildStructureEvaluation audits classical knowledge contract and revision directives", () => {
    const classicalPlan = ensureClassicalKnowledgePlan(basePlan()).classicalKnowledge;
    const evaluation = buildStructureEvaluation({
        pass: true,
        issues: [
            "Parallel perfect intervals weaken outer-voice independence.",
            "Cadential bass motion does not support the final arrival.",
        ],
        score: 82,
        strengths: [],
        metrics: { globalCadentialBassSupport: 0.42 },
    }, {
        classicalKnowledge: classicalPlan,
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                classicalNotationMarks: [
                    { category: "dynamic", mark: "p", scope: "global" },
                ],
            },
        ],
    });

    assert.equal(evaluation.classicalKnowledgeEvaluation?.status, "missing");
    assert.ok(evaluation.issues.some((issue) => issue.startsWith("Strict counterpoint contract is weakened")));
    assert.ok(evaluation.issues.some((issue) => issue.startsWith("Architectural cadence contract is not yet held")));
    assert.ok(evaluation.issues.some((issue) => issue.startsWith("Classical notation intent is not preserved")));

    const directives = buildStructureRevisionDirectives(evaluation, 86, {
        prompt: "Classical contract test",
        workflow: "symbolic_only",
        compositionPlan: { ...basePlan(), classicalKnowledge: classicalPlan },
    });
    const kinds = directives.map((directive) => directive.kind);
    assert.ok(kinds.includes("clarify_expression"));
    assert.ok(kinds.includes("clarify_texture_plan"));
    assert.ok(kinds.includes("strengthen_cadence"));

    const weakKnowledgePlan = {
        version: "classical-knowledge-test",
        domains: ["notation"],
        harmony: { cadencePolicy: "light" },
        counterpoint: { voiceLeading: "free" },
        form: { developmentPriority: "low" },
        notation: { marks: [{ category: "dynamic", mark: "p", scope: "global" }] },
    };
    const revised = applyRevisionDirectives({
        prompt: "Classical contract revision test",
        workflow: "symbolic_only",
        compositionPlan: { ...basePlan(), classicalKnowledge: weakKnowledgePlan },
    }, directives, 2);

    const revisedKnowledge = revised.compositionPlan?.classicalKnowledge;
    assert.ok(revisedKnowledge?.domains.includes("harmony"));
    assert.ok(revisedKnowledge?.domains.includes("counterpoint"));
    assert.ok(revisedKnowledge?.domains.includes("notation"));
    assert.equal(revisedKnowledge?.harmony?.cadencePolicy, "architectural");
    assert.equal(revisedKnowledge?.counterpoint?.voiceLeading, "strict");
    assert.ok((revisedKnowledge?.constraints ?? []).some((constraint) => constraint.includes("hard planning constraint")));
});
