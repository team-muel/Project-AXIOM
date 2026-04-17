import test from "node:test";
import assert from "node:assert/strict";
import {
    applyRevisionDirectives,
    buildAudioRevisionDirectives,
    buildRecommendedQualityPolicy,
    buildStructureRevisionDirectives,
    resolveQualityPolicy,
    shouldRetryAudioAttempt,
    shouldRetryStructureAttempt,
} from "../dist/pipeline/quality.js";
import { summarizeLongSpanDivergence } from "../dist/pipeline/longSpan.js";
import {
    compareStructureEvaluationsForCandidateSelection as compareStructureCandidates,
    scoreStructureEvaluationForCandidateSelection,
} from "../dist/pipeline/orchestrator.js";
import { buildStructureEvaluation } from "../dist/pipeline/evaluation.js";
import { buildCompositionSketch, materializeCompositionSketch } from "../dist/pipeline/sketch.js";
import { computePromptHash } from "../dist/autonomy/request.js";

test("resolveQualityPolicy defaults symbolic workflows to auto revision", () => {
    const policy = resolveQualityPolicy({
        prompt: "Write a concise chamber miniature.",
        workflow: "symbolic_only",
    }, {
        workflow: "symbolic_only",
        composeWorker: "music21",
        selectedModels: [],
    });

    assert.equal(policy.enableAutoRevision, true);
    assert.equal(policy.maxStructureAttempts, 3);
    assert.equal(policy.targetStructureScore, 78);
});

test("buildRecommendedQualityPolicy varies defaults by form and workflow", () => {
    const audioOnlyPrelude = buildRecommendedQualityPolicy("prelude", "audio_only");
    const sonataPlan = buildRecommendedQualityPolicy("piano sonata", "symbolic_plus_audio");

    assert.equal(audioOnlyPrelude.enableAutoRevision, false);
    assert.equal(audioOnlyPrelude.maxStructureAttempts, 1);
    assert.equal(audioOnlyPrelude.targetStructureScore, undefined);
    assert.equal(audioOnlyPrelude.targetAudioScore, 80);

    assert.equal(sonataPlan.enableAutoRevision, true);
    assert.equal(sonataPlan.maxStructureAttempts, 5);
    assert.equal(sonataPlan.targetStructureScore, 86);
    assert.equal(sonataPlan.targetAudioScore, 88);
});

test("buildStructureRevisionDirectives prioritizes cadence and leap fixes", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 58,
        issues: [
            "Final melodic note does not resolve to the tonic triad for key C major",
            "Too many wide leaps: 4/8 melodic intervals exceed an octave",
            "Rhythm is too uniform: 1 unique note lengths in lead track",
        ],
        strengths: [],
        metrics: {
            melodicSpan: 6,
            uniquePitchClasses: 4,
            uniqueDurations: 1,
            wideLeapRatio: 0.5,
        },
    }, 80);

    assert.deepEqual(directives.slice(0, 3).map((directive) => directive.kind), [
        "strengthen_cadence",
        "reduce_large_leaps",
        "increase_rhythm_variety",
    ]);
});

test("buildStructureRevisionDirectives maps harmonic voice-leading issues to harmony repair directives", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 61,
        issues: [
            "Parallel perfect intervals weaken the global outer-voice motion.",
            "Cadential bass motion does not consistently support the planned tonal closes.",
        ],
        strengths: [],
        metrics: {
            melodicSpan: 9,
            uniquePitchClasses: 5,
            uniqueDurations: 3,
            wideLeapRatio: 0.12,
            parallelPerfectCount: 4,
            harmonicCadenceSupport: 0.2,
        },
    }, 80);

    assert.equal(directives[0]?.kind, "strengthen_cadence");
    assert.ok(directives.some((directive) => directive.kind === "stabilize_harmony"));
});

test("buildStructureRevisionDirectives maps piece-level harmonic route issues to stabilization directives", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 63,
        issues: [
            "Modulation path does not land convincingly in related tonal areas.",
            "Dominant preparation is weak before major tonal arrivals.",
            "Recap does not re-establish the opening tonic strongly enough.",
        ],
        strengths: [],
        metrics: {
            globalHarmonicProgressionStrength: 0.36,
        },
    }, 82);

    assert.ok(directives.some((directive) => directive.kind === "stabilize_harmony"));
    assert.ok(directives.some((directive) => directive.kind === "strengthen_cadence"));
});

test("shouldRetryStructureAttempt reacts to low scores and failures", () => {
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 3,
        targetStructureScore: 80,
    };

    assert.equal(shouldRetryStructureAttempt({
        passed: false,
        score: 62,
        issues: ["Limited pitch-class variety"],
        strengths: [],
        metrics: {},
    }, 1, policy), true);

    assert.equal(shouldRetryStructureAttempt({
        passed: true,
        score: 84,
        issues: [],
        strengths: [],
        metrics: {},
    }, 1, policy), false);

    assert.equal(shouldRetryStructureAttempt({
        passed: true,
        score: 72,
        issues: [],
        strengths: [],
        metrics: {},
    }, 3, policy), false);
});

test("shouldRetryStructureAttempt retries explicit long-span plans when the planned return remains weak", () => {
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 4,
        targetStructureScore: 86,
    };

    assert.equal(shouldRetryStructureAttempt({
        passed: true,
        score: 88,
        issues: [],
        strengths: [],
        metrics: {
            longSpanDevelopmentPressureFit: 0.52,
            longSpanThematicTransformationFit: 0.49,
            longSpanHarmonicTimingFit: 0.44,
            longSpanReturnPayoffFit: 0.41,
        },
    }, 1, policy, {
        prompt: "Write a sonata whose return must feel inevitable.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the development tense until the return locks in.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 96,
            targetMeasures: 20,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            longSpanForm: {
                expositionStartSectionId: "s1",
                developmentStartSectionId: "s3",
                developmentEndSectionId: "s4",
                retransitionSectionId: "s5",
                recapStartSectionId: "s6",
                returnSectionId: "s6",
                delayedPayoffSectionId: "s6",
                expectedDevelopmentPressure: "high",
                expectedReturnPayoff: "inevitable",
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.42, density: 0.34 },
                { id: "s2", role: "theme_b", label: "Contrast", measures: 4, energy: 0.5, density: 0.4 },
                { id: "s3", role: "development", label: "Development I", measures: 4, energy: 0.64, density: 0.5 },
                { id: "s4", role: "development", label: "Development II", measures: 4, energy: 0.72, density: 0.58 },
                { id: "s5", role: "bridge", label: "Retransition", measures: 2, energy: 0.6, density: 0.48 },
                { id: "s6", role: "recap", label: "Return", measures: 2, energy: 0.34, density: 0.3 },
            ],
            rationale: "Keep the homecoming unmistakable.",
        },
    }), true);
});

test("shouldRetryStructureAttempt relaxes soft-only retries for experimental plans", () => {
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 3,
        targetStructureScore: 80,
    };

    assert.equal(shouldRetryStructureAttempt({
        passed: false,
        score: 74,
        issues: [
            "Limited pitch-class variety in the lead line",
            "Rhythm is too uniform: 2 unique note lengths in lead track",
        ],
        strengths: [],
        metrics: {},
    }, 2, policy, {
        prompt: "Write an unstable, suggestive miniature.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the structure slightly veiled.",
            mood: ["tense"],
            form: "miniature",
            targetDurationSec: 42,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [{ id: "s1", role: "theme_a", label: "Opening", measures: 8, energy: 0.5, density: 0.44 }],
            riskProfile: "experimental",
            structureVisibility: "hidden",
        },
    }), false);
});

test("shouldRetryStructureAttempt accepts near-target soft failures immediately only for veiled experimental plans", () => {
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 3,
        targetStructureScore: 80,
    };

    const evaluation = {
        passed: false,
        score: 75,
        issues: [
            "Limited pitch-class variety in the lead line",
            "Section tension arc diverges from the planned energy contour",
        ],
        strengths: [],
        metrics: {},
    };

    assert.equal(shouldRetryStructureAttempt(evaluation, 1, policy, {
        prompt: "Write an unstable, suggestive miniature.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the structure intentionally veiled.",
            mood: ["tense"],
            form: "miniature",
            targetDurationSec: 42,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [{ id: "s1", role: "theme_a", label: "Opening", measures: 8, energy: 0.5, density: 0.44 }],
            riskProfile: "experimental",
            structureVisibility: "hidden",
            rationale: "Let the form stay slightly obscured.",
        },
    }), false);

    assert.equal(shouldRetryStructureAttempt(evaluation, 1, policy, {
        prompt: "Write an unstable, suggestive miniature.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the structure unstable but still readable.",
            mood: ["tense"],
            form: "miniature",
            targetDurationSec: 42,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [{ id: "s1", role: "theme_a", label: "Opening", measures: 8, energy: 0.5, density: 0.44 }],
            riskProfile: "experimental",
            structureVisibility: "transparent",
            rationale: "The instability should still remain legible.",
        },
    }), true);
});

test("shouldRetryStructureAttempt retries uneven passing drafts once section-aware scoring drops below target", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        issues: [],
        score: 84,
        strengths: ["Global checks passed."],
        metrics: { issueCount: 0 },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 88,
                issues: [],
                strengths: ["Stable."],
                metrics: {},
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 60,
                issues: ["Section close does not settle convincingly for C major."],
                strengths: [],
                metrics: {},
            },
        ],
    });

    assert.ok((evaluation.score ?? 0) < 80);
    assert.equal(shouldRetryStructureAttempt(evaluation, 1, {
        enableAutoRevision: true,
        maxStructureAttempts: 3,
        targetStructureScore: 80,
    }, {
        prompt: "Write a concise sonata with a stronger close.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the opening stable, but the close must really land.",
            mood: ["measured"],
            form: "sonata",
            targetDurationSec: 48,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.42, density: 0.34 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.26, density: 0.22, cadence: "authentic" },
            ],
            rationale: "The cadence must be convincing enough to stop retries.",
        },
    }), true);
});

test("applyRevisionDirectives reshapes plan and prompt hash", () => {
    const baseRequest = {
        prompt: "Write a chamber miniature with a lyrical close.",
        key: "C major",
        tempo: 76,
        form: "miniature",
        workflow: "symbolic_only",
        compositionProfile: {
            pitchContour: [0.42, 0.55, 0.44],
            density: 0.36,
            tension: [0.45, 0.58, 0.26],
        },
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "A short miniature with a return.",
            mood: ["lyrical"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            key: "C major",
            tempo: 76,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "piano", family: "keyboard", roles: ["lead", "pad"], register: "wide" },
            ],
            motifPolicy: {
                reuseRequired: true,
                inversionAllowed: true,
                augmentationAllowed: true,
                diminutionAllowed: false,
                sequenceAllowed: true,
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.42, density: 0.34, cadence: "half" },
                { id: "s2", role: "cadence", label: "Closing", measures: 4, energy: 0.32, density: 0.3, cadence: "open" },
            ],
            rationale: "Keep the ending restrained.",
        },
    };

    const directives = [
        { kind: "strengthen_cadence", priority: 98, reason: "Close clearly." },
        { kind: "expand_register", priority: 84, reason: "Widen the melody." },
        { kind: "increase_rhythm_variety", priority: 78, reason: "Use more varied durations." },
        { kind: "extend_length", priority: 100, reason: "Give the cadence more room." },
    ];

    const revisedRequest = applyRevisionDirectives(baseRequest, directives, 2);
    const baseHash = computePromptHash(baseRequest);
    const revisedHash = computePromptHash(revisedRequest);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.ok((revisedRequest.compositionProfile?.density ?? 0) > (baseRequest.compositionProfile.density ?? 0));
    assert.notDeepEqual(revisedRequest.compositionProfile?.pitchContour, baseRequest.compositionProfile.pitchContour);
    assert.equal(revisedRequest.compositionPlan?.sections.at(-1)?.cadence, "authentic");
    assert.ok((revisedRequest.compositionPlan?.targetMeasures ?? 0) > (baseRequest.compositionPlan.targetMeasures ?? 0));
    assert.notEqual(revisedHash, baseHash);
});

test("applyRevisionDirectives annotates harmonic stabilization in section plans", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a cadential miniature with clearer bass support.",
        tempo: 78,
        workflow: "symbolic_only",
        compositionProfile: {
            pitchContour: [0.42, 0.58, 0.48],
            density: 0.4,
            tension: [0.38, 0.56, 0.32],
        },
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the cadence stable and legible.",
            mood: ["measured"],
            form: "miniature",
            targetDurationSec: 52,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.44, density: 0.38, harmonicPlan: { harmonicRhythm: "fast", allowModulation: true } },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.32, density: 0.28, cadence: "authentic", harmonicPlan: { harmonicRhythm: "fast", allowModulation: true } },
            ],
            rationale: "Keep the bass supportive.",
        },
    }, [{ kind: "stabilize_harmony", priority: 90, reason: "Clean up the outer-voice motion." }], 2);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.harmonicPlan?.harmonicRhythm, "medium");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.allowModulation, false);
    assert.match(revisedRequest.compositionPlan?.sections[0]?.notes?.join(" | ") ?? "", /contrary motion/);
    assert.ok((revisedRequest.compositionProfile?.density ?? 1) < 0.4);
});

test("applyRevisionDirectives re-anchors recap tonal center during harmonic stabilization", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a sonata recap that clearly returns home.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Let the return feel unmistakable.",
            mood: ["focused"],
            form: "sonata",
            targetDurationSec: 96,
            targetMeasures: 16,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 6, energy: 0.42, density: 0.36, harmonicPlan: { tonalCenter: "C major", allowModulation: false } },
                { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.72, density: 0.58, harmonicPlan: { tonalCenter: "G major", allowModulation: true } },
                { id: "s3", role: "recap", label: "Recap", measures: 6, energy: 0.34, density: 0.3, harmonicPlan: { tonalCenter: "E major", allowModulation: true } },
            ],
            rationale: "Allow the center to drift before the return.",
        },
    }, [{ kind: "stabilize_harmony", priority: 90, reason: "Re-anchor the tonal route." }], 2);

    assert.equal(revisedRequest.compositionPlan?.sections[2]?.harmonicPlan?.tonalCenter, "C major");
    assert.equal(revisedRequest.compositionPlan?.sections[2]?.harmonicPlan?.allowModulation, false);
});

test("applyRevisionDirectives recenters targeted section register from artifact drift direction", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a compact miniature with a more controlled opening register.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the opening lower and the close stable.",
            mood: ["focused"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.42, density: 0.34, registerCenter: 52 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.28, density: 0.24, registerCenter: 60, cadence: "authentic" },
            ],
            rationale: "Keep the formal contour legible.",
        },
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                plannedRegisterCenter: 52,
                realizedRegisterCenter: 68,
            },
        ],
    }, [{ kind: "expand_register", priority: 86, reason: "Recenter the opening register.", sectionIds: ["s1"] }], 2);

    assert.ok((revisedRequest.compositionPlan?.sections[0]?.registerCenter ?? 99) < 52);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.registerCenter, 60);
    assert.match(revisedRequest.compositionPlan?.sections[0]?.notes?.join(" | ") ?? "", /lower in register than the previous pass/);
});

test("applyRevisionDirectives preserves explicit plagal cadence when strengthening a targeted close", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a miniature with a broad plagal close.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the final section plagal rather than authentic.",
            mood: ["solemn"],
            form: "miniature",
            targetDurationSec: 56,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.42, density: 0.34 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.26, density: 0.22, cadence: "plagal", harmonicPlan: { cadence: "plagal", allowModulation: false } },
            ],
            rationale: "Let the close read as plagal.",
        },
        sectionArtifacts: [
            {
                sectionId: "s2",
                role: "cadence",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                cadenceApproach: "other",
            },
        ],
    }, [{ kind: "strengthen_cadence", priority: 90, reason: "Clarify the planned plagal close.", sectionIds: ["s2"] }], 2);

    assert.equal(revisedRequest.compositionPlan?.sections[1]?.cadence, "plagal");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.cadence, "plagal");
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /plagal-to-tonic bass approach/);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /Recover the planned plagal bass approach/);
});

test("buildStructureRevisionDirectives deprioritizes conservative cadence fixes for experimental hidden plans", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 60,
        issues: [
            "Final melodic note does not resolve to the tonic triad for key D minor",
            "Too many wide leaps: 4/9 melodic intervals exceed an octave",
            "Rhythm is too uniform: 1 unique note lengths in lead track",
        ],
        strengths: [],
        metrics: {
            melodicSpan: 7,
            uniquePitchClasses: 4,
            uniqueDurations: 1,
            wideLeapRatio: 0.44,
        },
    }, 80, {
        prompt: "Write an unstable chamber miniature.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Stay exploratory and don't square off the close too quickly.",
            mood: ["unsettled"],
            form: "miniature",
            targetDurationSec: 52,
            targetMeasures: 10,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 6, energy: 0.56, density: 0.46 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.5, density: 0.42, cadence: "authentic" },
            ],
            riskProfile: "experimental",
            structureVisibility: "hidden",
        },
    });

    assert.deepEqual(directives.slice(0, 3).map((directive) => directive.kind), [
        "increase_rhythm_variety",
        "increase_pitch_variety",
        "reduce_large_leaps",
    ]);
    assert.equal(directives.find((directive) => directive.kind === "strengthen_cadence")?.priority, 58);
});

test("buildStructureRevisionDirectives treats tension contour divergence as a soft revision signal", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 73,
        issues: ["Section tension arc diverges from the planned energy contour"],
        strengths: [],
        metrics: {
            tensionArcMismatch: 0.31,
            melodicSpan: 8,
            uniquePitchClasses: 5,
            uniqueDurations: 2,
            wideLeapRatio: 0.14,
        },
        weakestSections: [],
    }, 80, {
        prompt: "Write a flexible chamber miniature.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the energy curve audible without over-correcting.",
            mood: ["searching"],
            form: "miniature",
            targetDurationSec: 46,
            targetMeasures: 10,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 6, energy: 0.56, density: 0.42 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.24, density: 0.28 },
            ],
            riskProfile: "exploratory",
            structureVisibility: "hidden",
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "expand_register"));
    assert.ok(directives.some((directive) => directive.kind === "increase_rhythm_variety"));
    assert.ok(directives.every((directive) => directive.priority < 80));
});

test("buildStructureRevisionDirectives targets the weakest harmonic section", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 62,
        issues: [
            "Section tonal center drifts from planned C major.",
            "Cadence arrival is weaker than planned for this section.",
            "Form-specific harmonic and thematic roles are not yet coherent enough.",
        ],
        strengths: [],
        metrics: {
            sectionHarmonicPlanFit: 0.34,
            formCoherenceScore: 0.42,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Theme",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 8,
                score: 82,
                issues: [],
                strengths: ["Stable."],
                metrics: { sectionHarmonicPlanFit: 0.82 },
            },
            {
                sectionId: "s2",
                label: "Recap",
                role: "recap",
                startMeasure: 9,
                endMeasure: 16,
                score: 48,
                issues: [
                    "Section tonal center drifts from planned C major.",
                    "Cadence arrival is weaker than planned for this section.",
                ],
                strengths: [],
                metrics: { sectionHarmonicPlanFit: 0.26 },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Recap",
                role: "recap",
                startMeasure: 9,
                endMeasure: 16,
                score: 48,
                issues: [
                    "Section tonal center drifts from planned C major.",
                    "Cadence arrival is weaker than planned for this section.",
                ],
                strengths: [],
                metrics: { sectionHarmonicPlanFit: 0.26 },
            },
        ],
    }, 84);

    assert.ok(directives.some((directive) => directive.kind === "stabilize_harmony" && directive.sectionIds?.includes("s2")));
    assert.ok(directives.some((directive) => directive.kind === "strengthen_cadence" && directive.sectionIds?.includes("s2")));
});

test("buildStructureRevisionDirectives prefers the most severe cadence section by metric severity", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 66,
        issues: [
            "Cadence arrival is weaker than planned for this section.",
        ],
        strengths: [],
        metrics: {
            harmonicCadenceSupport: 0.42,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Cadence A",
                role: "cadence",
                startMeasure: 9,
                endMeasure: 12,
                score: 61,
                issues: ["Cadence arrival is weaker than planned for this section."],
                strengths: [],
                metrics: {
                    harmonicCadenceSupport: 0.5,
                    actualCadenceStrength: 0.52,
                    cadenceStrengthFit: 0.48,
                },
            },
            {
                sectionId: "s3",
                label: "Cadence B",
                role: "recap",
                startMeasure: 13,
                endMeasure: 16,
                score: 57,
                issues: ["Cadence arrival is weaker than planned for this section."],
                strengths: [],
                metrics: {
                    harmonicCadenceSupport: 0.12,
                    actualCadenceStrength: 0.14,
                    cadenceStrengthFit: 0.08,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s3",
                label: "Cadence B",
                role: "recap",
                startMeasure: 13,
                endMeasure: 16,
                score: 57,
                issues: ["Cadence arrival is weaker than planned for this section."],
                strengths: [],
                metrics: {
                    harmonicCadenceSupport: 0.12,
                    actualCadenceStrength: 0.14,
                    cadenceStrengthFit: 0.08,
                },
            },
            {
                sectionId: "s2",
                label: "Cadence A",
                role: "cadence",
                startMeasure: 9,
                endMeasure: 12,
                score: 61,
                issues: ["Cadence arrival is weaker than planned for this section."],
                strengths: [],
                metrics: {
                    harmonicCadenceSupport: 0.5,
                    actualCadenceStrength: 0.52,
                    cadenceStrengthFit: 0.48,
                },
            },
        ],
    }, 84);

    const cadenceDirective = directives.find((directive) => directive.kind === "strengthen_cadence");
    assert.deepEqual(cadenceDirective?.sectionIds, ["s3"]);
    assert.ok((cadenceDirective?.priority ?? 0) > 92);
});

test("buildStructureRevisionDirectives boosts stabilize_harmony for severe tonal and modulation drift", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 59,
        issues: [
            "Section tonal center drifts from planned C major.",
            "Section harmonic plan blocks the modulation expected for its formal role.",
        ],
        strengths: [],
        metrics: {
            sectionHarmonicPlanFit: 0.3,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 9,
                endMeasure: 16,
                score: 46,
                issues: [
                    "Section tonal center drifts from planned C major.",
                    "Section harmonic plan blocks the modulation expected for its formal role.",
                ],
                strengths: [],
                metrics: {
                    sectionHarmonicPlanFit: 0.18,
                    tonalCenterFit: 0.1,
                    modulationPlanFit: 0,
                    harmonicCadenceSupport: 0.2,
                },
            },
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                startMeasure: 17,
                endMeasure: 24,
                score: 58,
                issues: ["Section tonal center drifts from planned C major."],
                strengths: [],
                metrics: {
                    sectionHarmonicPlanFit: 0.42,
                    tonalCenterFit: 0.46,
                    modulationPlanFit: 0.35,
                    harmonicCadenceSupport: 0.55,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 9,
                endMeasure: 16,
                score: 46,
                issues: [
                    "Section tonal center drifts from planned C major.",
                    "Section harmonic plan blocks the modulation expected for its formal role.",
                ],
                strengths: [],
                metrics: {
                    sectionHarmonicPlanFit: 0.18,
                    tonalCenterFit: 0.1,
                    modulationPlanFit: 0,
                    harmonicCadenceSupport: 0.2,
                },
            },
        ],
    }, 84);

    const harmonyDirective = directives.find((directive) => directive.kind === "stabilize_harmony");
    assert.deepEqual(harmonyDirective?.sectionIds, ["s2"]);
    assert.ok((harmonyDirective?.priority ?? 0) >= 100);
});

test("buildStructureRevisionDirectives keeps exact source-issue targets ahead of unrelated weakest sections", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 64,
        issues: [
            "Section harmonic plan blocks the modulation expected for its formal role.",
        ],
        strengths: [],
        metrics: {
            sectionHarmonicPlanFit: 0.44,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Bridge",
                role: "bridge",
                startMeasure: 5,
                endMeasure: 8,
                score: 49,
                issues: ["Tension arc mismatch"],
                strengths: [],
                metrics: {
                    tensionMismatch: 0.92,
                    modulationPlanFit: 0.58,
                },
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 9,
                endMeasure: 12,
                score: 66,
                issues: ["Section harmonic plan blocks the modulation expected for its formal role."],
                strengths: [],
                metrics: {
                    tensionMismatch: 0.21,
                    modulationPlanFit: 0.08,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s1",
                label: "Bridge",
                role: "bridge",
                startMeasure: 5,
                endMeasure: 8,
                score: 49,
                issues: ["Tension arc mismatch"],
                strengths: [],
                metrics: {
                    tensionMismatch: 0.92,
                    modulationPlanFit: 0.58,
                },
            },
        ],
    }, 84, {
        prompt: "Write a sonata with a development that modulates clearly.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the bridge restless but let the development own the modulation.",
            mood: ["urgent"],
            form: "sonata",
            workflow: "symbolic_only",
            targetDurationSec: 72,
            targetMeasures: 12,
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "bridge", label: "Bridge", measures: 4, energy: 0.58, density: 0.52 },
                { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.74, density: 0.6, motifRef: "s1" },
                { id: "s3", role: "recap", label: "Recap", measures: 4, energy: 0.34, density: 0.3, motifRef: "s1" },
            ],
            rationale: "Keep the modulating section distinct from the transition material.",
        },
    });

    const narrativeDirective = directives.find((directive) => directive.kind === "clarify_narrative_arc");
    assert.ok(narrativeDirective);
    assert.deepEqual(narrativeDirective?.sectionIds, ["s2"]);
});

test("buildAudioRevisionDirectives maps weak narrative audio metrics to development and recap fixes", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 73,
        issues: [
            "Rendered audio does not clearly escalate the development section against its source theme.",
            "Rendered audio does not clearly support the recap's thematic return and release.",
            "Rendered and styled audio disagree on the planned development or recap contour.",
        ],
        strengths: [],
        metrics: {
            audioDevelopmentNarrativeFit: 0.41,
            audioRecapRecallFit: 0.46,
            audioNarrativeRenderConsistency: 0.44,
        },
    }, 84, {
        prompt: "Write a sonata movement with a strong return.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Push the development hard, then let the recap settle.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 120,
            targetMeasures: 24,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true, inversionAllowed: true, sequenceAllowed: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.44, density: 0.38 },
                { id: "s2", role: "development", label: "Development", measures: 8, energy: 0.72, density: 0.6, motifRef: "s1" },
                { id: "s3", role: "recap", label: "Recap", measures: 8, energy: 0.34, density: 0.32, motifRef: "s1" },
            ],
            riskProfile: "exploratory",
            structureVisibility: "hidden",
        },
    });

    assert.deepEqual(directives.slice(0, 3).map((directive) => directive.kind), [
        "clarify_narrative_arc",
        "rebalance_recap_release",
        "increase_rhythm_variety",
    ]);
    assert.deepEqual(directives.find((directive) => directive.kind === "clarify_narrative_arc")?.sectionIds, ["s2"]);
    assert.deepEqual(directives.find((directive) => directive.kind === "rebalance_recap_release")?.sectionIds, ["s3"]);
    assert.deepEqual(directives.find((directive) => directive.kind === "increase_rhythm_variety")?.sectionIds, ["s2", "s3"]);
});

test("buildAudioRevisionDirectives maps rendered tonal-return collapse to harmony stabilization", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 71,
        issues: [
            "Rendered audio collapses the planned tonal return in the recap or closing section.",
            "Rendered audio blurs the planned harmonic route across modulation and return.",
        ],
        strengths: [],
        metrics: {
            audioDevelopmentNarrativeFit: 0.58,
            audioRecapRecallFit: 0.44,
            audioNarrativeRenderConsistency: 0.46,
            audioTonalReturnRenderFit: 0.39,
            audioHarmonicRouteRenderFit: 0.41,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                sourceSectionId: "s1",
                plannedTonality: "G major",
                score: 0.43,
                issues: [
                    "Rendered development key drift does not settle into a clear modulation path.",
                    "Rendered and styled audio disagree on the development's modulation profile.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.43,
                    audioDevelopmentKeyDriftFit: 0.44,
                    audioDevelopmentRouteConsistencyFit: 0.34,
                },
            },
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.36,
                issues: [
                    "Rendered pitch-class return does not settle back into the planned recap tonality.",
                    "Rendered and styled audio disagree on the recap's tonal return.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.36,
                    audioRecapPitchClassReturnFit: 0.41,
                    audioRecapTonalConsistencyFit: 0.29,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.36,
                issues: [
                    "Rendered pitch-class return does not settle back into the planned recap tonality.",
                    "Rendered and styled audio disagree on the recap's tonal return.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.36,
                    audioRecapPitchClassReturnFit: 0.41,
                    audioRecapTonalConsistencyFit: 0.29,
                },
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                sourceSectionId: "s1",
                plannedTonality: "G major",
                score: 0.43,
                issues: [
                    "Rendered development key drift does not settle into a clear modulation path.",
                    "Rendered and styled audio disagree on the development's modulation profile.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.43,
                    audioDevelopmentKeyDriftFit: 0.44,
                    audioDevelopmentRouteConsistencyFit: 0.34,
                },
            },
        ],
    }, 84, {
        prompt: "Write a sonata whose recap must feel harmonically inevitable.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the return anchored after a modulatory development.",
            mood: ["driven"],
            form: "sonata",
            targetDurationSec: 110,
            targetMeasures: 24,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.44, density: 0.38 },
                { id: "s2", role: "development", label: "Development", measures: 8, energy: 0.72, density: 0.6, motifRef: "s1" },
                { id: "s3", role: "recap", label: "Recap", measures: 8, energy: 0.34, density: 0.32, motifRef: "s1" },
            ],
            riskProfile: "exploratory",
            structureVisibility: "hidden",
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "rebalance_recap_release"));
    assert.ok(directives.some((directive) => directive.kind === "stabilize_harmony"));
    assert.deepEqual(directives.find((directive) => directive.kind === "rebalance_recap_release")?.sectionIds, ["s3"]);
    assert.deepEqual(directives.find((directive) => directive.kind === "stabilize_harmony")?.sectionIds, ["s3", "s2"]);
});

test("buildAudioRevisionDirectives adds dedicated long-span divergence repair when render collapses after symbolic hold", () => {
    const directives = buildAudioRevisionDirectives({
        passed: true,
        score: 86,
        issues: [],
        strengths: ["Rendered audio passes broad checks."],
        metrics: {
            audioDevelopmentNarrativeFit: 0.74,
            audioRecapRecallFit: 0.72,
            audioNarrativeRenderConsistency: 0.71,
            audioTonalReturnRenderFit: 0.69,
            audioHarmonicRouteRenderFit: 0.7,
        },
        longSpan: {
            status: "collapsed",
            weakestDimension: "tonal_return",
            weakDimensions: ["tonal_return"],
            averageFit: 0.51,
            developmentNarrativeFit: 0.74,
            recapRecallFit: 0.72,
            harmonicRouteFit: 0.7,
            tonalReturnFit: 0.46,
        },
        sectionFindings: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.55,
                issues: [],
                strengths: [],
                metrics: {
                    audioSectionNarrativeConsistencyFit: 0.52,
                    audioRecapTonalConsistencyFit: 0.48,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.55,
                issues: [],
                strengths: [],
                metrics: {
                    audioSectionNarrativeConsistencyFit: 0.52,
                    audioRecapTonalConsistencyFit: 0.48,
                },
            },
        ],
    }, 84, {
        prompt: "Write a sonata recap whose return must survive rendering.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the recap return intact in the rendered audio.",
            mood: ["dramatic"],
            form: "sonata",
            workflow: "symbolic_plus_audio",
            targetMeasures: 24,
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8 },
                { id: "s2", role: "development", label: "Development", measures: 8 },
                { id: "s3", role: "recap", label: "Recap", measures: 8, motifRef: "s1" },
            ],
        },
    }, {
        passed: true,
        score: 90,
        issues: [],
        strengths: ["Symbolic long-span form holds."],
        longSpan: {
            status: "held",
            weakDimensions: [],
            averageFit: 0.79,
            thematicCheckpointCount: 2,
            expectedDevelopmentPressure: "high",
            expectedReturnPayoff: "inevitable",
            developmentPressureFit: 0.8,
            thematicTransformationFit: 0.77,
            harmonicTimingFit: 0.77,
            returnPayoffFit: 0.82,
        },
    });

    const recapDirective = directives.find((directive) => directive.kind === "rebalance_recap_release");
    assert.ok(recapDirective);
    assert.match(recapDirective?.reason ?? "", /rendered tonal return collapses the planned recap payoff/i);
    assert.match(recapDirective?.reason ?? "", /Recap \(s3\) is the main rendered tonal return mismatch/i);
    assert.deepEqual(recapDirective?.sectionIds, ["s3"]);
});

test("summarizeLongSpanDivergence pairs symbolic and rendered section evidence when both long-span layers are weak", () => {
    const divergence = summarizeLongSpanDivergence({
        status: "at_risk",
        weakestDimension: "return_payoff",
        weakDimensions: ["return_payoff"],
        averageFit: 0.63,
        thematicCheckpointCount: 2,
        expectedReturnPayoff: "inevitable",
        developmentPressureFit: 0.72,
        thematicTransformationFit: 0.68,
        harmonicTimingFit: 0.61,
        returnPayoffFit: 0.58,
    }, {
        status: "collapsed",
        weakestDimension: "tonal_return",
        weakDimensions: ["tonal_return", "recap_recall"],
        averageFit: 0.41,
        developmentNarrativeFit: 0.57,
        recapRecallFit: 0.42,
        harmonicRouteFit: 0.49,
        tonalReturnFit: 0.37,
    }, {
        sectionFindings: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.38,
                issues: ["Rendered pitch-class return does not settle back into the planned recap tonality."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.38,
                    audioRecapRecallFit: 0.42,
                    audioRecapPitchClassReturnFit: 0.37,
                    audioRecapTonalConsistencyFit: 0.35,
                },
            },
        ],
        weakestSections: [],
    }, {
        sectionFindings: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                startMeasure: 17,
                endMeasure: 24,
                score: 74,
                issues: ["Bass cadence approach does not match the planned sectional closes."],
                strengths: [],
                metrics: {
                    cadenceApproachFit: 0.28,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                startMeasure: 17,
                endMeasure: 24,
                score: 74,
                issues: ["Bass cadence approach does not match the planned sectional closes."],
                strengths: [],
                metrics: {
                    cadenceApproachFit: 0.28,
                },
            },
        ],
    });

    assert.equal(divergence?.primarySectionId, "s3");
    assert.equal(divergence?.repairMode, "paired_same_section");
    assert.deepEqual(divergence?.secondaryRepairFocuses, ["recap_recall"]);
    assert.deepEqual(divergence?.recommendedDirectives, [
        { focus: "tonal_return", kind: "rebalance_recap_release", priorityClass: "primary" },
        { focus: "recap_recall", kind: "rebalance_recap_release", priorityClass: "secondary" },
    ]);
    assert.equal(divergence?.sections?.[0]?.comparisonStatus, "both_weak");
    assert.equal(divergence?.sections?.[0]?.structureSectionId, "s3");
    assert.equal(divergence?.sections?.[0]?.structureScore, 74);
    assert.match(divergence?.sections?.[0]?.structureExplanation ?? "", /symbolically fragile/i);
    assert.match(divergence?.sections?.[0]?.explanation ?? "", /Rendered issue:/i);
});

test("summarizeLongSpanDivergence marks cross-section paired weakness when symbolic and rendered weak points diverge", () => {
    const divergence = summarizeLongSpanDivergence({
        status: "at_risk",
        weakestDimension: "return_payoff",
        weakDimensions: ["return_payoff"],
        averageFit: 0.64,
        thematicCheckpointCount: 2,
        expectedReturnPayoff: "inevitable",
        developmentPressureFit: 0.72,
        thematicTransformationFit: 0.69,
        harmonicTimingFit: 0.63,
        returnPayoffFit: 0.57,
    }, {
        status: "collapsed",
        weakestDimension: "tonal_return",
        weakDimensions: ["tonal_return", "recap_recall"],
        averageFit: 0.4,
        developmentNarrativeFit: 0.58,
        recapRecallFit: 0.41,
        harmonicRouteFit: 0.5,
        tonalReturnFit: 0.35,
    }, {
        sectionFindings: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.35,
                issues: ["Rendered pitch-class return does not settle back into the planned recap tonality."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.35,
                    audioRecapRecallFit: 0.41,
                    audioRecapPitchClassReturnFit: 0.35,
                    audioRecapTonalConsistencyFit: 0.33,
                },
            },
        ],
        weakestSections: [],
    }, {
        sectionFindings: [
            {
                sectionId: "s4",
                label: "Coda Cadence",
                role: "cadence",
                startMeasure: 21,
                endMeasure: 24,
                score: 71,
                issues: ["Bass cadence approach does not match the planned sectional closes."],
                strengths: [],
                metrics: {
                    cadenceApproachFit: 0.24,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s4",
                label: "Coda Cadence",
                role: "cadence",
                startMeasure: 21,
                endMeasure: 24,
                score: 71,
                issues: ["Bass cadence approach does not match the planned sectional closes."],
                strengths: [],
                metrics: {
                    cadenceApproachFit: 0.24,
                },
            },
        ],
    });

    assert.equal(divergence?.primarySectionId, "s3");
    assert.equal(divergence?.repairMode, "paired_cross_section");
    assert.deepEqual(divergence?.secondaryRepairFocuses, ["recap_recall"]);
    assert.deepEqual(divergence?.recommendedDirectives, [
        { focus: "tonal_return", kind: "rebalance_recap_release", priorityClass: "primary" },
        { focus: "recap_recall", kind: "rebalance_recap_release", priorityClass: "secondary" },
    ]);
    assert.equal(divergence?.sections?.[0]?.comparisonStatus, "both_weak");
    assert.equal(divergence?.sections?.[0]?.structureSectionId, "s4");
    assert.match(divergence?.sections?.[0]?.structureExplanation ?? "", /paired symbolic weak point/i);
});

test("buildAudioRevisionDirectives carries paired symbolic section evidence when both long-span layers are weak", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 73,
        issues: ["Rendered audio still blurs the recap landing."],
        strengths: [],
        metrics: {
            audioDevelopmentNarrativeFit: 0.62,
            audioRecapRecallFit: 0.42,
            audioNarrativeRenderConsistency: 0.58,
            audioTonalReturnRenderFit: 0.37,
            audioHarmonicRouteRenderFit: 0.49,
        },
        longSpan: {
            status: "collapsed",
            weakestDimension: "tonal_return",
            weakDimensions: ["tonal_return", "recap_recall"],
            averageFit: 0.45,
            developmentNarrativeFit: 0.62,
            recapRecallFit: 0.42,
            harmonicRouteFit: 0.49,
            tonalReturnFit: 0.37,
        },
        sectionFindings: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.37,
                issues: ["Rendered pitch-class return does not settle back into the planned recap tonality."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.37,
                    audioRecapRecallFit: 0.42,
                    audioRecapPitchClassReturnFit: 0.37,
                    audioRecapTonalConsistencyFit: 0.34,
                },
            },
        ],
    }, 84, {
        prompt: "Write a sonata whose recap cadence must still land even after revision.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the symbolic recap stable while repairing the rendered landing.",
            mood: ["dramatic"],
            form: "sonata",
            workflow: "symbolic_plus_audio",
            targetMeasures: 24,
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8 },
                { id: "s2", role: "development", label: "Development", measures: 8 },
                { id: "s3", role: "recap", label: "Recap", measures: 8, motifRef: "s1" },
            ],
        },
    }, {
        passed: true,
        score: 79,
        issues: ["Recap close is still structurally softer than planned."],
        strengths: ["Symbolic recap still preserves the large return."],
        longSpan: {
            status: "at_risk",
            weakestDimension: "return_payoff",
            weakDimensions: ["return_payoff"],
            averageFit: 0.63,
            thematicCheckpointCount: 2,
            expectedDevelopmentPressure: "high",
            expectedReturnPayoff: "inevitable",
            developmentPressureFit: 0.74,
            thematicTransformationFit: 0.71,
            harmonicTimingFit: 0.66,
            returnPayoffFit: 0.58,
        },
        sectionFindings: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                startMeasure: 17,
                endMeasure: 24,
                score: 74,
                issues: ["Bass cadence approach does not match the planned sectional closes."],
                strengths: [],
                metrics: {
                    cadenceApproachFit: 0.28,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                startMeasure: 17,
                endMeasure: 24,
                score: 74,
                issues: ["Bass cadence approach does not match the planned sectional closes."],
                strengths: [],
                metrics: {
                    cadenceApproachFit: 0.28,
                },
            },
        ],
    });

    const recapDirective = directives.find((directive) => directive.kind === "rebalance_recap_release");
    assert.ok(recapDirective);
    assert.equal(recapDirective?.priority, 100);
    assert.match(recapDirective?.reason ?? "", /symbolically fragile/i);
    assert.match(recapDirective?.reason ?? "", /Bass cadence approach does not match the planned sectional closes/i);
    assert.match(recapDirective?.reason ?? "", /Rendered pitch-class return does not settle back into the planned recap tonality/i);
    assert.match(recapDirective?.reason ?? "", /Secondary long-span weakness also persists in recap recall/i);
    assert.match(recapDirective?.reason ?? "", /restabilizing the same symbolic section/i);
    assert.deepEqual(recapDirective?.sectionIds, ["s3"]);
});

test("buildAudioRevisionDirectives targets both sections for cross-section long-span divergence", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 74,
        issues: ["Rendered audio still blurs the recap landing."],
        strengths: [],
        metrics: {
            audioDevelopmentNarrativeFit: 0.64,
            audioRecapRecallFit: 0.41,
            audioNarrativeRenderConsistency: 0.59,
            audioTonalReturnRenderFit: 0.35,
            audioHarmonicRouteRenderFit: 0.5,
        },
        longSpan: {
            status: "collapsed",
            weakestDimension: "tonal_return",
            weakDimensions: ["tonal_return", "recap_recall"],
            averageFit: 0.43,
            developmentNarrativeFit: 0.64,
            recapRecallFit: 0.41,
            harmonicRouteFit: 0.5,
            tonalReturnFit: 0.35,
        },
        sectionFindings: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.35,
                issues: ["Rendered pitch-class return does not settle back into the planned recap tonality."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.35,
                    audioRecapRecallFit: 0.41,
                    audioRecapPitchClassReturnFit: 0.35,
                    audioRecapTonalConsistencyFit: 0.33,
                },
            },
        ],
    }, 84, {
        prompt: "Write a sonata whose recap and closing cadence must reconverge together.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the recap arrival and the final cadence synchronized.",
            mood: ["dramatic"],
            form: "sonata",
            workflow: "symbolic_plus_audio",
            targetMeasures: 24,
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8 },
                { id: "s2", role: "development", label: "Development", measures: 8 },
                { id: "s3", role: "recap", label: "Recap", measures: 4, motifRef: "s1" },
                { id: "s4", role: "cadence", label: "Coda Cadence", measures: 4 },
            ],
        },
    }, {
        passed: true,
        score: 80,
        issues: ["Closing cadence support is softer than planned."],
        strengths: ["Symbolic long-span return remains partially legible."],
        longSpan: {
            status: "at_risk",
            weakestDimension: "return_payoff",
            weakDimensions: ["return_payoff"],
            averageFit: 0.64,
            thematicCheckpointCount: 2,
            expectedDevelopmentPressure: "high",
            expectedReturnPayoff: "inevitable",
            developmentPressureFit: 0.74,
            thematicTransformationFit: 0.71,
            harmonicTimingFit: 0.67,
            returnPayoffFit: 0.57,
        },
        sectionFindings: [
            {
                sectionId: "s4",
                label: "Coda Cadence",
                role: "cadence",
                startMeasure: 21,
                endMeasure: 24,
                score: 71,
                issues: ["Bass cadence approach does not match the planned sectional closes."],
                strengths: [],
                metrics: {
                    cadenceApproachFit: 0.24,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s4",
                label: "Coda Cadence",
                role: "cadence",
                startMeasure: 21,
                endMeasure: 24,
                score: 71,
                issues: ["Bass cadence approach does not match the planned sectional closes."],
                strengths: [],
                metrics: {
                    cadenceApproachFit: 0.24,
                },
            },
        ],
    });

    const recapDirective = directives.find((directive) => directive.kind === "rebalance_recap_release");
    assert.ok(recapDirective);
    assert.equal(recapDirective?.priority, 104);
    assert.match(recapDirective?.reason ?? "", /paired symbolic weak section together/i);
    assert.match(recapDirective?.reason ?? "", /Secondary long-span weakness also persists in recap recall/i);
    assert.deepEqual(recapDirective?.sectionIds, ["s3", "s4"]);
});

test("buildAudioRevisionDirectives adds companion directives for secondary long-span focuses", () => {
    const directives = buildAudioRevisionDirectives({
        passed: true,
        score: 86,
        issues: [],
        strengths: ["Rendered audio passes broad checks outside the return zone."],
        metrics: {
            audioDevelopmentNarrativeFit: 0.65,
            audioRecapRecallFit: 0.67,
            audioNarrativeRenderConsistency: 0.69,
            audioTonalReturnRenderFit: 0.38,
            audioHarmonicRouteRenderFit: 0.65,
        },
        longSpan: {
            status: "collapsed",
            weakestDimension: "tonal_return",
            weakDimensions: ["tonal_return", "development_narrative"],
            averageFit: 0.54,
            developmentNarrativeFit: 0.65,
            recapRecallFit: 0.67,
            harmonicRouteFit: 0.65,
            tonalReturnFit: 0.38,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                sourceSectionId: "s1",
                plannedTonality: "G major",
                score: 0.58,
                issues: ["Rendered and styled audio disagree on the development's modulation profile."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.58,
                    audioDevelopmentNarrativeFit: 0.65,
                    audioSectionNarrativeConsistencyFit: 0.62,
                    audioDevelopmentRouteConsistencyFit: 0.61,
                },
            },
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.38,
                issues: ["Rendered pitch-class return does not settle back into the planned recap tonality."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.38,
                    audioRecapRecallFit: 0.67,
                    audioRecapPitchClassReturnFit: 0.38,
                    audioRecapTonalConsistencyFit: 0.37,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.38,
                issues: ["Rendered pitch-class return does not settle back into the planned recap tonality."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.38,
                    audioRecapRecallFit: 0.67,
                    audioRecapPitchClassReturnFit: 0.38,
                    audioRecapTonalConsistencyFit: 0.37,
                },
            },
        ],
    }, 84, {
        prompt: "Write a sonata whose rendered return and development contour both need to survive revision.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the tonal return clear while preserving development escalation.",
            mood: ["dramatic"],
            form: "sonata",
            workflow: "symbolic_plus_audio",
            targetMeasures: 24,
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8 },
                { id: "s2", role: "development", label: "Development", measures: 8 },
                { id: "s3", role: "recap", label: "Recap", measures: 8, motifRef: "s1" },
            ],
        },
    }, {
        passed: true,
        score: 90,
        issues: [],
        strengths: ["Symbolic long-span form holds."],
        longSpan: {
            status: "held",
            weakDimensions: [],
            averageFit: 0.79,
            thematicCheckpointCount: 2,
            expectedDevelopmentPressure: "high",
            expectedReturnPayoff: "inevitable",
            developmentPressureFit: 0.8,
            thematicTransformationFit: 0.77,
            harmonicTimingFit: 0.77,
            returnPayoffFit: 0.82,
        },
    });

    const recapDirective = directives.find((directive) => directive.kind === "rebalance_recap_release");
    const narrativeDirective = directives.find((directive) => directive.kind === "clarify_narrative_arc");
    assert.ok(recapDirective);
    assert.ok(narrativeDirective);
    assert.match(recapDirective?.reason ?? "", /Secondary long-span weakness also persists in development escalation/i);
    assert.match(narrativeDirective?.reason ?? "", /Secondary long-span weakness also persists in development escalation/i);
    assert.deepEqual(narrativeDirective?.sectionIds, ["s3", "s2"]);
    assert.equal((narrativeDirective?.priority ?? 0) < (recapDirective?.priority ?? 0), true);
});

test("buildAudioRevisionDirectives localizes rendered-styled disagreement to the inconsistent section", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 74,
        issues: [
            "Rendered and styled audio disagree on the planned development or recap contour.",
        ],
        strengths: [],
        metrics: {
            audioNarrativeRenderConsistency: 0.41,
            audioDevelopmentNarrativeFit: 0.63,
            audioRecapRecallFit: 0.79,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                sourceSectionId: "s1",
                plannedTonality: "G major",
                score: 0.48,
                issues: ["Rendered and styled audio disagree on the section's narrative contour."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.48,
                    audioSectionNarrativeConsistencyFit: 0.31,
                    audioDevelopmentRouteConsistencyFit: 0.82,
                },
            },
            {
                sectionId: "s3",
                label: "Recap",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.74,
                issues: [],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.74,
                    audioSectionNarrativeConsistencyFit: 0.78,
                    audioRecapTonalConsistencyFit: 0.8,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                sourceSectionId: "s1",
                plannedTonality: "G major",
                score: 0.48,
                issues: ["Rendered and styled audio disagree on the section's narrative contour."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.48,
                    audioSectionNarrativeConsistencyFit: 0.31,
                    audioDevelopmentRouteConsistencyFit: 0.82,
                },
            },
        ],
    }, 84, {
        prompt: "Write a sonata whose development contour survives rendering.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Only the development's rendered-vs-styled contour needs repair.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 96,
            targetMeasures: 24,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.42, density: 0.36 },
                { id: "s2", role: "development", label: "Development", measures: 8, energy: 0.7, density: 0.58, motifRef: "s1" },
                { id: "s3", role: "recap", label: "Recap", measures: 8, energy: 0.34, density: 0.3, motifRef: "s1" },
            ],
        },
    });

    assert.deepEqual(directives.find((directive) => directive.kind === "increase_rhythm_variety")?.sectionIds, ["s2"]);
});

test("buildAudioRevisionDirectives prefers audio section findings when choosing target sectionIds", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 72,
        issues: [
            "Rendered audio does not clearly escalate the development section against its source theme.",
            "Rendered audio does not clearly support the recap's thematic return and release.",
        ],
        strengths: [],
        metrics: {
            audioDevelopmentNarrativeFit: 0.42,
            audioRecapRecallFit: 0.47,
        },
        sectionFindings: [
            {
                sectionId: "s4",
                label: "Later Development",
                role: "development",
                sourceSectionId: "s1",
                plannedTonality: "A minor",
                score: 0.39,
                issues: ["Audio escalation against the source section is weak."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.39,
                    audioDevelopmentNarrativeFit: 0.42,
                },
            },
            {
                sectionId: "s5",
                label: "Return",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.44,
                issues: ["Audio return and release against the source section are weak."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.44,
                    audioRecapRecallFit: 0.47,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s4",
                label: "Later Development",
                role: "development",
                sourceSectionId: "s1",
                plannedTonality: "A minor",
                score: 0.39,
                issues: ["Audio escalation against the source section is weak."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.39,
                    audioDevelopmentNarrativeFit: 0.42,
                },
            },
            {
                sectionId: "s5",
                label: "Return",
                role: "recap",
                sourceSectionId: "s1",
                plannedTonality: "C major",
                score: 0.44,
                issues: ["Audio return and release against the source section are weak."],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.44,
                    audioRecapRecallFit: 0.47,
                },
            },
        ],
    }, 84, {
        prompt: "Write a sonata with two developmental spans and a clear return.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Later development and return need the strongest repair.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 120,
            targetMeasures: 32,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.4, density: 0.36 },
                { id: "s2", role: "development", label: "Early Development", measures: 8, energy: 0.62, density: 0.54, motifRef: "s1" },
                { id: "s4", role: "development", label: "Later Development", measures: 8, energy: 0.72, density: 0.6, motifRef: "s1" },
                { id: "s5", role: "recap", label: "Return", measures: 8, energy: 0.34, density: 0.3, motifRef: "s1" },
            ],
        },
    });

    assert.deepEqual(directives.find((directive) => directive.kind === "clarify_narrative_arc")?.sectionIds, ["s4"]);
    assert.deepEqual(directives.find((directive) => directive.kind === "rebalance_recap_release")?.sectionIds, ["s5"]);
});

test("buildAudioRevisionDirectives maps weak tempo-motion evidence to localized tempo shaping", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 78,
        issues: [
            "Tempo-motion cues do not survive strongly enough after humanized realization.",
        ],
        strengths: [],
        metrics: {
            audioTempoMotionPlanFit: 0.36,
            audioTempoMotionCoverageFit: 0.44,
            audioTempoMotionDensityFit: 0.4,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                score: 0.34,
                issues: [
                    "Tempo-motion coverage is too sparse across the targeted measures.",
                    "Section tempo motion does not survive humanized realization strongly enough.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.34,
                    audioTempoMotionPlanFit: 0.28,
                    audioTempoMotionCoverageFit: 0.32,
                    audioTempoMotionDensityFit: 0.36,
                    audioTempoMotionMagnitudeFit: 0.22,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                score: 0.34,
                issues: [
                    "Tempo-motion coverage is too sparse across the targeted measures.",
                    "Section tempo motion does not survive humanized realization strongly enough.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.34,
                    audioTempoMotionPlanFit: 0.28,
                    audioTempoMotionCoverageFit: 0.32,
                    audioTempoMotionDensityFit: 0.36,
                    audioTempoMotionMagnitudeFit: 0.22,
                },
            },
        ],
    }, 84, {
        prompt: "Write a miniature whose final broadening remains audible.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the closing slowdown explicit.",
            mood: ["lyric"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.28 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.28, density: 0.24 },
            ],
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "shape_tempo_motion"));
    assert.deepEqual(directives.find((directive) => directive.kind === "shape_tempo_motion")?.sectionIds, ["s2"]);
});

test("buildAudioRevisionDirectives maps weak phrase-breath evidence to localized phrase repair", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 78,
        issues: [
            "Phrase-breath cues do not survive strongly enough after humanized realization.",
        ],
        strengths: [],
        metrics: {
            audioPhraseBreathPlanFit: 0.38,
            audioPhraseBreathCoverageFit: 0.48,
            audioPhraseBreathArrivalFit: 0.34,
            audioPhraseBreathReleaseFit: 0.3,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                score: 0.36,
                issues: [
                    "Section phrase-breath arrival does not broaden clearly enough after humanization.",
                    "Section phrase-breath cues do not survive humanized realization strongly enough.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.36,
                    audioPhraseBreathPlanFit: 0.32,
                    audioPhraseBreathCoverageFit: 0.4,
                    audioPhraseBreathArrivalFit: 0.28,
                    audioPhraseBreathReleaseFit: 0.3,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                score: 0.36,
                issues: [
                    "Section phrase-breath arrival does not broaden clearly enough after humanization.",
                    "Section phrase-breath cues do not survive humanized realization strongly enough.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.36,
                    audioPhraseBreathPlanFit: 0.32,
                    audioPhraseBreathCoverageFit: 0.4,
                    audioPhraseBreathArrivalFit: 0.28,
                    audioPhraseBreathReleaseFit: 0.3,
                },
            },
        ],
    }, 84, {
        prompt: "Write a close whose arrival and release are clearly breathed.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the closing breath explicit.",
            mood: ["lyric"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.28 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.24, density: 0.2 },
            ],
            rationale: "Let the cadence inhale and exhale clearly.",
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "clarify_phrase_rhetoric"));
    assert.deepEqual(directives.find((directive) => directive.kind === "clarify_phrase_rhetoric")?.sectionIds, ["s2"]);
});

test("buildAudioRevisionDirectives maps weak ornament hold evidence to localized hold shaping", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 79,
        issues: [
            "Ornament hold cues do not survive strongly enough after humanized realization.",
        ],
        strengths: [],
        metrics: {
            audioOrnamentPlanFit: 0.4,
            audioOrnamentCoverageFit: 0.72,
            audioOrnamentHoldFit: 0.22,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                score: 0.38,
                issues: [
                    "Section ornament hold does not survive humanized realization strongly enough.",
                    "Section ornament hold does not create enough local sustain contrast.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.38,
                    audioOrnamentPlanFit: 0.36,
                    audioOrnamentCoverageFit: 0.74,
                    audioOrnamentHoldFit: 0.18,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                score: 0.38,
                issues: [
                    "Section ornament hold does not survive humanized realization strongly enough.",
                    "Section ornament hold does not create enough local sustain contrast.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.38,
                    audioOrnamentPlanFit: 0.36,
                    audioOrnamentCoverageFit: 0.74,
                    audioOrnamentHoldFit: 0.18,
                },
            },
        ],
    }, 84, {
        prompt: "Write a miniature whose final fermata remains audible.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the last hold obvious in audio.",
            mood: ["lyric"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.28 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.24, density: 0.2 },
            ],
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "shape_ornament_hold"));
    assert.deepEqual(directives.find((directive) => directive.kind === "shape_ornament_hold")?.sectionIds, ["s2"]);
});

test("buildAudioRevisionDirectives maps weak harmonic realization evidence to localized harmonic repair", () => {
    const directives = buildAudioRevisionDirectives({
        passed: false,
        score: 77,
        issues: [
            "Harmonic realization cues do not survive strongly enough after humanized realization.",
            "Harmonic-color windows do not create enough local color contrast after humanization.",
        ],
        strengths: [],
        metrics: {
            audioHarmonicRealizationPlanFit: 0.34,
            audioHarmonicRealizationCoverageFit: 0.42,
            audioHarmonicRealizationDensityFit: 0.38,
            audioTonicizationRealizationFit: 0.3,
            audioProlongationRealizationFit: 0.36,
            audioHarmonicColorRealizationFit: 0.28,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                score: 0.32,
                issues: [
                    "Section harmonic realization does not survive humanized realization strongly enough.",
                    "Section tonicization window does not create enough local departure and arrival contrast after humanization.",
                    "Section harmonic-color window does not create enough local color contrast after humanization.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.32,
                    audioHarmonicRealizationPlanFit: 0.28,
                    audioHarmonicRealizationCoverageFit: 0.36,
                    audioHarmonicRealizationDensityFit: 0.34,
                    audioTonicizationRealizationFit: 0.22,
                    audioProlongationRealizationFit: 0.3,
                    audioHarmonicColorRealizationFit: 0.18,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                score: 0.32,
                issues: [
                    "Section harmonic realization does not survive humanized realization strongly enough.",
                    "Section tonicization window does not create enough local departure and arrival contrast after humanization.",
                    "Section harmonic-color window does not create enough local color contrast after humanization.",
                ],
                strengths: [],
                metrics: {
                    audioSectionCompositeFit: 0.32,
                    audioHarmonicRealizationPlanFit: 0.28,
                    audioHarmonicRealizationCoverageFit: 0.36,
                    audioHarmonicRealizationDensityFit: 0.34,
                    audioTonicizationRealizationFit: 0.22,
                    audioProlongationRealizationFit: 0.3,
                    audioHarmonicColorRealizationFit: 0.18,
                },
            },
        ],
    }, 84, {
        prompt: "Write a development whose tonicization and suspension remain audible in audio.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep one tonicization and one local color event audible in the development.",
            mood: ["dramatic"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.28 },
                { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.54, density: 0.42 },
            ],
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "stabilize_harmony"));
    assert.deepEqual(directives.find((directive) => directive.kind === "stabilize_harmony")?.sectionIds, ["s2"]);
    assert.ok(directives.some((directive) => directive.kind === "clarify_harmonic_color"));
    assert.deepEqual(directives.find((directive) => directive.kind === "clarify_harmonic_color")?.sectionIds, ["s2"]);
});

test("shouldRetryAudioAttempt only retries symbolic workflows with weak narrative audio metrics", () => {
    const evaluation = {
        passed: false,
        score: 76,
        issues: ["Rendered audio does not clearly escalate the development section against its source theme."],
        strengths: [],
        metrics: {
            audioDevelopmentNarrativeFit: 0.46,
            audioRecapRecallFit: 0.7,
            audioNarrativeRenderConsistency: 0.76,
        },
    };
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 4,
        targetAudioScore: 84,
    };

    assert.equal(shouldRetryAudioAttempt(evaluation, 2, policy, {
        prompt: "Write a sonata allegro.",
        workflow: "symbolic_plus_audio",
    }), true);

    assert.equal(shouldRetryAudioAttempt(evaluation, 2, policy, {
        prompt: "Render an audio texture.",
        workflow: "audio_only",
    }), false);
});

test("shouldRetryAudioAttempt retries when rendered tonal return collapses", () => {
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 4,
        targetAudioScore: 84,
    };

    assert.equal(shouldRetryAudioAttempt({
        passed: false,
        score: 74,
        issues: ["Rendered audio collapses the planned tonal return in the recap or closing section."],
        strengths: [],
        metrics: {
            audioDevelopmentNarrativeFit: 0.66,
            audioRecapRecallFit: 0.55,
            audioNarrativeRenderConsistency: 0.52,
            audioTonalReturnRenderFit: 0.44,
            audioHarmonicRouteRenderFit: 0.49,
        },
    }, 2, policy, {
        prompt: "Write a symphonic recap with a clear homecoming.",
        workflow: "symbolic_plus_audio",
    }), true);
});

test("shouldRetryAudioAttempt retries actionable long-span divergence even when audio pass holds", () => {
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 4,
        targetAudioScore: 84,
    };

    assert.equal(shouldRetryAudioAttempt({
        passed: true,
        score: 86,
        issues: [],
        strengths: ["Rendered audio passed broad checks."],
        metrics: {
            audioDevelopmentNarrativeFit: 0.76,
            audioRecapRecallFit: 0.74,
            audioNarrativeRenderConsistency: 0.73,
            audioTonalReturnRenderFit: 0.71,
            audioHarmonicRouteRenderFit: 0.72,
        },
        longSpan: {
            status: "collapsed",
            weakestDimension: "tonal_return",
            weakDimensions: ["tonal_return"],
            averageFit: 0.5,
            developmentNarrativeFit: 0.76,
            recapRecallFit: 0.74,
            harmonicRouteFit: 0.72,
            tonalReturnFit: 0.46,
        },
    }, 2, policy, {
        prompt: "Write a sonata return that survives rendering.",
        workflow: "symbolic_plus_audio",
    }, {
        passed: true,
        score: 89,
        issues: [],
        strengths: ["Symbolic long-span return holds."],
        longSpan: {
            status: "held",
            weakDimensions: [],
            averageFit: 0.8,
            thematicCheckpointCount: 2,
            expectedDevelopmentPressure: "high",
            expectedReturnPayoff: "inevitable",
            developmentPressureFit: 0.81,
            thematicTransformationFit: 0.78,
            harmonicTimingFit: 0.77,
            returnPayoffFit: 0.84,
        },
    }), true);
});

test("shouldRetryAudioAttempt retries when tempo-motion realization is weak", () => {
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 4,
        targetAudioScore: 84,
    };

    assert.equal(shouldRetryAudioAttempt({
        passed: false,
        score: 79,
        issues: ["Tempo-motion cues do not survive strongly enough after humanized realization."],
        strengths: [],
        metrics: {
            audioTempoMotionPlanFit: 0.4,
            audioTempoMotionCoverageFit: 0.46,
        },
    }, 2, policy, {
        prompt: "Write a close with an audible ritardando.",
        workflow: "symbolic_plus_audio",
    }), true);
});

test("shouldRetryAudioAttempt retries when phrase-breath realization is weak", () => {
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 4,
        targetAudioScore: 84,
    };

    assert.equal(shouldRetryAudioAttempt({
        passed: false,
        score: 79,
        issues: ["Phrase-breath cues do not survive strongly enough after humanized realization."],
        strengths: [],
        metrics: {
            audioPhraseBreathPlanFit: 0.4,
            audioPhraseBreathCoverageFit: 0.46,
            audioPhraseBreathArrivalFit: 0.38,
        },
    }, 2, policy, {
        prompt: "Write a close with a clearly breathed arrival and release.",
        workflow: "symbolic_plus_audio",
    }), true);
});

test("shouldRetryAudioAttempt retries when ornament hold realization is weak", () => {
    const policy = {
        enableAutoRevision: true,
        maxStructureAttempts: 4,
        targetAudioScore: 84,
    };

    assert.equal(shouldRetryAudioAttempt({
        passed: false,
        score: 80,
        issues: ["Ornament hold cues do not survive strongly enough after humanized realization."],
        strengths: [],
        metrics: {
            audioOrnamentPlanFit: 0.42,
            audioOrnamentCoverageFit: 0.72,
            audioOrnamentHoldFit: 0.24,
        },
    }, 2, policy, {
        prompt: "Write a close with an audible fermata.",
        workflow: "symbolic_plus_audio",
    }), true);
});

test("applyRevisionDirectives keeps experimental hidden closes suggestive", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write an inward, unstable miniature.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "A close that hints rather than lands.",
            mood: ["fragile"],
            form: "miniature",
            targetDurationSec: 44,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.36, density: 0.32 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.3, density: 0.28, cadence: "authentic" },
            ],
            riskProfile: "experimental",
            structureVisibility: "hidden",
        },
    }, [{ kind: "strengthen_cadence", priority: 98, reason: "Clarify the close." }], 2);

    assert.equal(revisedRequest.compositionPlan?.sections.at(-1)?.cadence, "deceptive");
    assert.equal(revisedRequest.compositionPlan?.sections.at(-1)?.harmonicPlan?.cadence, "deceptive");
});

test("applyRevisionDirectives reshapes development and recap from audio narrative directives", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a sonata movement with a clear development and recap.",
        key: "G minor",
        tempo: 88,
        workflow: "symbolic_plus_audio",
        compositionProfile: {
            pitchContour: [0.38, 0.56, 0.5],
            density: 0.46,
            tension: [0.34, 0.52, 0.4],
        },
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Make the development hotter than the return.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 120,
            targetMeasures: 24,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.42, density: 0.36 },
                { id: "s2", role: "development", label: "Development", measures: 8, energy: 0.62, density: 0.52 },
                { id: "s3", role: "recap", label: "Recap", measures: 8, energy: 0.38, density: 0.34 },
            ],
            rationale: "Keep the return legible.",
        },
    }, [
        { kind: "clarify_narrative_arc", priority: 90, reason: "Push the development more clearly." },
        { kind: "rebalance_recap_release", priority: 88, reason: "Make the recap settle after the peak." },
    ], 2);

    assert.equal(revisedRequest.compositionPlan?.motifPolicy.sequenceAllowed, true);
    assert.equal(revisedRequest.compositionPlan?.motifPolicy.diminutionAllowed, true);
    assert.equal(revisedRequest.compositionPlan?.motifPolicy.augmentationAllowed, true);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.harmonicRhythm, "fast");
    assert.equal(revisedRequest.compositionPlan?.sections[2]?.motifRef, "s1");
    assert.notEqual(revisedRequest.compositionProfile?.tension?.at(-1), 0.4);
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.energy ?? 0) > 0.62);
    assert.ok((revisedRequest.compositionPlan?.sections[2]?.density ?? 1) < 0.34);
});

test("applyRevisionDirectives differentiates audio route repair from tonal return repair", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a sonata whose modulation path and recap homecoming both need repair.",
        key: "C major",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the departure and homecoming both legible after rendering.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 120,
            targetMeasures: 24,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Theme",
                    measures: 8,
                    energy: 0.42,
                    density: 0.36,
                    harmonicPlan: { tonalCenter: "C major", harmonicRhythm: "medium", allowModulation: false },
                    cadenceStrength: 0.62,
                },
                {
                    id: "s2",
                    role: "development",
                    label: "Development",
                    measures: 8,
                    energy: 0.64,
                    density: 0.52,
                    harmonicPlan: { tonalCenter: "C major", harmonicRhythm: "medium", allowModulation: false, tensionTarget: 0.54 },
                    cadenceStrength: 0.22,
                },
                {
                    id: "s3",
                    role: "recap",
                    label: "Recap",
                    measures: 8,
                    energy: 0.44,
                    density: 0.38,
                    harmonicPlan: { tonalCenter: "A minor", harmonicRhythm: "fast", allowModulation: true, tensionTarget: 0.58 },
                    cadence: "open",
                    cadenceStrength: 0.38,
                },
            ],
            rationale: "Keep the return audible.",
        },
    }, [
        {
            kind: "stabilize_harmony",
            priority: 92,
            reason: "Simplify and clarify the tonal route so modulation and return stay audible after rendering.",
            sourceIssue: "Rendered audio blurs the planned harmonic route across modulation and return.",
            sectionIds: ["s2"],
        },
        {
            kind: "rebalance_recap_release",
            priority: 98,
            reason: "Re-establish the recap's tonal arrival so the rendered return does not collapse after the development.",
            sourceIssue: "Rendered audio collapses the planned tonal return in the recap or closing section.",
            sectionIds: ["s3"],
        },
        {
            kind: "stabilize_harmony",
            priority: 90,
            reason: "Tighten recap harmony and bass support so the rendered close keeps its planned tonal center.",
            sourceIssue: "Rendered audio collapses the planned tonal return in the recap or closing section.",
            sectionIds: ["s3"],
        },
    ], 2);

    assert.equal(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.allowModulation, true);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.tonalCenter, "G major");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.harmonicRhythm, "fast");
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.cadenceStrength ?? 0) >= 0.48);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /depart clearly from the home key/);

    assert.equal(revisedRequest.compositionPlan?.sections[2]?.harmonicPlan?.tonalCenter, "C major");
    assert.equal(revisedRequest.compositionPlan?.sections[2]?.harmonicPlan?.allowModulation, false);
    assert.equal(revisedRequest.compositionPlan?.sections[2]?.cadence, "authentic");
    assert.ok((revisedRequest.compositionPlan?.sections[2]?.cadenceStrength ?? 0) >= 0.86);
    assert.match(revisedRequest.compositionPlan?.sections[2]?.notes?.join(" | ") ?? "", /home key before the close/);
});

test("applyRevisionDirectives only mutates targeted sections when directive scope is set", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Repair only the development harmony.",
        workflow: "symbolic_only",
        compositionProfile: {
            pitchContour: [0.42, 0.58, 0.46],
            density: 0.4,
            tension: [0.36, 0.62, 0.32],
        },
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep theme and recap intact while repairing the development.",
            mood: ["focused"],
            form: "sonata",
            targetDurationSec: 96,
            targetMeasures: 18,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 6, energy: 0.42, density: 0.36, harmonicPlan: { harmonicRhythm: "fast", tonalCenter: "C major", allowModulation: false } },
                { id: "s2", role: "development", label: "Development", measures: 6, energy: 0.7, density: 0.58, harmonicPlan: { harmonicRhythm: "fast", tonalCenter: "G major", allowModulation: true } },
                { id: "s3", role: "recap", label: "Recap", measures: 6, energy: 0.34, density: 0.3, harmonicPlan: { harmonicRhythm: "medium", tonalCenter: "E major", allowModulation: true } },
            ],
            rationale: "Only the middle should change.",
        },
    }, [{
        kind: "stabilize_harmony",
        priority: 90,
        reason: "Repair only the development harmonic role.",
        sectionIds: ["s2"],
    }], 2);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.equal(revisedRequest.compositionProfile?.density, 0.4);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.harmonicPlan?.harmonicRhythm, "fast");
    assert.equal(revisedRequest.compositionPlan?.sections[2]?.harmonicPlan?.tonalCenter, "E major");
    assert.notEqual(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.harmonicRhythm, "slow");
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /contrary motion/);
});

test("materializeCompositionSketch preserves pipeline hash stability while planner sketches affect hashes", () => {
    const baseRequest = {
        prompt: "Write an exploratory miniature with a veiled cadence.",
        key: "D minor",
        tempo: 72,
        form: "miniature",
        workflow: "symbolic_only",
        compositionProfile: {
            pitchContour: [0.38, 0.62, 0.48],
            density: 0.42,
            tension: [0.34, 0.58, 0.3],
        },
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the motif recognizable while leaving alternate exits available.",
            mood: ["brooding"],
            form: "miniature",
            targetDurationSec: 54,
            targetMeasures: 10,
            key: "D minor",
            tempo: 72,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true, inversionAllowed: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 6, energy: 0.42, density: 0.38, cadence: "half" },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.34, density: 0.3, cadence: "authentic", motifRef: "s1" },
            ],
            riskProfile: "experimental",
            structureVisibility: "hidden",
        },
    };

    const sketch = buildCompositionSketch(baseRequest);
    assert.ok(sketch);
    const materialized = materializeCompositionSketch(baseRequest);
    const baseHash = computePromptHash(baseRequest);
    const materializedHash = computePromptHash(materialized);
    const plannerHash = computePromptHash({
        ...baseRequest,
        compositionPlan: {
            ...baseRequest.compositionPlan,
            sketch: {
                ...sketch,
                generatedBy: "planner",
            },
        },
    });

    assert.equal(sketch?.motifDrafts[0]?.sectionId, "s1");
    assert.equal(sketch?.cadenceOptions.at(-1)?.sectionId, "s2");
    assert.equal(sketch?.cadenceOptions.at(-1)?.alternatives[0], "deceptive");
    assert.equal(materialized.compositionPlan?.sketch?.generatedBy, "pipeline");
    assert.equal(materializedHash, baseHash);
    assert.notEqual(plannerHash, baseHash);
});

test("computePromptHash changes when structured expression guidance changes", () => {
    const baseRequest = {
        prompt: "Write a soft chamber miniature with a breath-like opening.",
        key: "G minor",
        tempo: 66,
        form: "miniature",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the opening fragile and let the cadence arrive gently.",
            mood: ["fragile"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            key: "G minor",
            tempo: 66,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            expressionDefaults: {
                dynamics: { start: "pp", peak: "mp", end: "p" },
                articulation: ["legato"],
                character: ["dolce"],
            },
            motifPolicy: { reuseRequired: true },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 4,
                    energy: 0.3,
                    density: 0.26,
                    cadence: "half",
                    expression: {
                        articulation: ["legato"],
                        character: ["cantabile"],
                    },
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Close",
                    measures: 4,
                    energy: 0.24,
                    density: 0.2,
                    cadence: "authentic",
                    motifRef: "s1",
                },
            ],
            rationale: "Hold the cadence back until the last section.",
        },
    };

    const revisedRequest = {
        ...baseRequest,
        compositionPlan: {
            ...baseRequest.compositionPlan,
            sections: [
                {
                    ...baseRequest.compositionPlan.sections[0],
                    expression: {
                        articulation: ["staccato"],
                        character: ["agitato"],
                    },
                },
                ...baseRequest.compositionPlan.sections.slice(1),
            ],
        },
    };

    assert.notEqual(computePromptHash(baseRequest), computePromptHash(revisedRequest));
});

test("computePromptHash changes when phrase, texture, or harmonic deepening guidance changes", () => {
    const baseRequest = {
        prompt: "Write a chamber miniature with a restrained return.",
        key: "C minor",
        tempo: 70,
        form: "miniature",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the opening compact and the close clear.",
            mood: ["focused"],
            form: "miniature",
            targetDurationSec: 52,
            targetMeasures: 10,
            key: "C minor",
            tempo: 70,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            textureDefaults: {
                voiceCount: 2,
                primaryRoles: ["lead", "bass"],
                counterpointMode: "none",
            },
            motifPolicy: { reuseRequired: true },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 6,
                    energy: 0.34,
                    density: 0.3,
                    phraseFunction: "presentation",
                    phraseSpanShape: "period",
                    texture: {
                        voiceCount: 2,
                        primaryRoles: ["lead", "bass"],
                        counterpointMode: "none",
                    },
                    harmonicPlan: {
                        tonalCenter: "C minor",
                        harmonicRhythm: "medium",
                        prolongationMode: "tonic",
                    },
                    cadence: "half",
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Close",
                    measures: 4,
                    energy: 0.28,
                    density: 0.24,
                    phraseFunction: "cadential",
                    texture: {
                        voiceCount: 2,
                        primaryRoles: ["lead", "bass"],
                        counterpointMode: "contrary_motion",
                    },
                    harmonicPlan: {
                        tonalCenter: "C minor",
                        harmonicRhythm: "slow",
                        prolongationMode: "dominant",
                    },
                    cadence: "authentic",
                    motifRef: "s1",
                },
            ],
            rationale: "Keep the rhetoric clear.",
        },
    };

    const revisedRequest = {
        ...baseRequest,
        compositionPlan: {
            ...baseRequest.compositionPlan,
            textureDefaults: {
                ...baseRequest.compositionPlan.textureDefaults,
                primaryRoles: ["lead", "inner_voice", "bass"],
            },
            sections: [
                {
                    ...baseRequest.compositionPlan.sections[0],
                    phraseFunction: "continuation",
                    phraseSpanShape: "sentence",
                    harmonicPlan: {
                        ...baseRequest.compositionPlan.sections[0].harmonicPlan,
                        prolongationMode: "sequential",
                        tonicizationWindows: [{ startMeasure: 4, endMeasure: 5, keyTarget: "G minor", emphasis: "prepared", cadence: "half" }],
                    },
                },
                baseRequest.compositionPlan.sections[1],
            ],
        },
    };

    assert.notEqual(computePromptHash(baseRequest), computePromptHash(revisedRequest));
});

test("computePromptHash changes when phrase-breath guidance changes", () => {
    const baseRequest = {
        prompt: "Write a restrained miniature with one delayed arrival.",
        key: "A minor",
        tempo: 64,
        form: "miniature",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Delay the first arrival and let the cadence release softly.",
            mood: ["intimate"],
            form: "miniature",
            targetDurationSec: 44,
            targetMeasures: 8,
            key: "A minor",
            tempo: 64,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 4,
                    energy: 0.28,
                    density: 0.24,
                    phraseBreath: {
                        pickupStartMeasure: 1,
                        pickupEndMeasure: 1,
                        arrivalMeasure: 2,
                        releaseStartMeasure: 2,
                        releaseEndMeasure: 3,
                    },
                    cadence: "half",
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Close",
                    measures: 4,
                    energy: 0.22,
                    density: 0.2,
                    cadence: "authentic",
                    motifRef: "s1",
                },
            ],
            rationale: "Shape one clear arrival before the cadence.",
        },
    };

    const revisedRequest = {
        ...baseRequest,
        compositionPlan: {
            ...baseRequest.compositionPlan,
            sections: [
                {
                    ...baseRequest.compositionPlan.sections[0],
                    phraseBreath: {
                        ...baseRequest.compositionPlan.sections[0].phraseBreath,
                        arrivalMeasure: 3,
                        cadenceRecoveryStartMeasure: 4,
                        cadenceRecoveryEndMeasure: 4,
                    },
                },
                baseRequest.compositionPlan.sections[1],
            ],
        },
    };

    assert.notEqual(computePromptHash(baseRequest), computePromptHash(revisedRequest));
});

test("computePromptHash changes when harmonic-color guidance changes", () => {
    const baseRequest = {
        prompt: "Write a compact miniature with one darkening turn before the cadence.",
        key: "C minor",
        tempo: 72,
        form: "miniature",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the rhetoric compact but color the cadence.",
            mood: ["focused"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            key: "C minor",
            tempo: 72,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 4,
                    energy: 0.32,
                    density: 0.28,
                    harmonicPlan: {
                        tonalCenter: "C minor",
                        harmonicRhythm: "medium",
                        prolongationMode: "tonic",
                        colorCues: [{ tag: "mixture", startMeasure: 3, endMeasure: 4 }],
                    },
                    cadence: "half",
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Close",
                    measures: 4,
                    energy: 0.26,
                    density: 0.22,
                    harmonicPlan: {
                        tonalCenter: "C minor",
                        harmonicRhythm: "slow",
                        prolongationMode: "dominant",
                    },
                    cadence: "authentic",
                    motifRef: "s1",
                },
            ],
            rationale: "Give the close one clear color event.",
        },
    };

    const revisedRequest = {
        ...baseRequest,
        compositionPlan: {
            ...baseRequest.compositionPlan,
            sections: [
                {
                    ...baseRequest.compositionPlan.sections[0],
                    harmonicPlan: {
                        ...baseRequest.compositionPlan.sections[0].harmonicPlan,
                        colorCues: [
                            { tag: "applied_dominant", startMeasure: 2, endMeasure: 3, keyTarget: "G minor" },
                            { tag: "suspension", startMeasure: 4, resolutionMeasure: 4 },
                        ],
                    },
                },
                baseRequest.compositionPlan.sections[1],
            ],
        },
    };

    assert.notEqual(computePromptHash(baseRequest), computePromptHash(revisedRequest));
});

test("computePromptHash changes when long-span form guidance changes", () => {
    const baseRequest = {
        prompt: "Write a compact sonata with a delayed return.",
        key: "C major",
        tempo: 104,
        form: "sonata",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the return delayed but legible.",
            mood: ["driven"],
            form: "sonata",
            targetDurationSec: 112,
            targetMeasures: 24,
            key: "C major",
            tempo: 104,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            longSpanForm: {
                expositionStartSectionId: "s1",
                expositionEndSectionId: "s2",
                developmentStartSectionId: "s3",
                developmentEndSectionId: "s3",
                recapStartSectionId: "s4",
                returnSectionId: "s4",
                expectedDevelopmentPressure: "medium",
                expectedReturnPayoff: "clear",
                thematicCheckpoints: [
                    { sourceSectionId: "s1", targetSectionId: "s3", transform: "fragment", expectedProminence: 0.7 },
                    { sourceSectionId: "s1", targetSectionId: "s4", transform: "repeat", expectedProminence: 0.9 },
                ],
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.42, density: 0.36, cadence: "half" },
                { id: "s2", role: "theme_b", label: "Contrast", measures: 8, energy: 0.52, density: 0.42, cadence: "half" },
                { id: "s3", role: "development", label: "Development", measures: 8, energy: 0.72, density: 0.56, developmentType: "motivic", cadence: "half" },
                { id: "s4", role: "recap", label: "Recap", measures: 8, energy: 0.34, density: 0.3, recapMode: "full", cadence: "authentic", motifRef: "s1" },
            ],
            rationale: "Make the return feel earned.",
        },
    };

    const revisedRequest = {
        ...baseRequest,
        compositionPlan: {
            ...baseRequest.compositionPlan,
            longSpanForm: {
                ...baseRequest.compositionPlan.longSpanForm,
                expectedDevelopmentPressure: "high",
                expectedReturnPayoff: "inevitable",
                thematicCheckpoints: [
                    ...baseRequest.compositionPlan.longSpanForm.thematicCheckpoints.slice(0, 1),
                    { sourceSectionId: "s1", targetSectionId: "s4", transform: "delay_return", expectedProminence: 1 },
                ],
            },
        },
    };

    assert.notEqual(computePromptHash(baseRequest), computePromptHash(revisedRequest));
});

test("buildStructureRevisionDirectives maps weak long-span metrics to planned development and return zones", () => {
    const directives = buildStructureRevisionDirectives({
        passed: true,
        score: 87,
        issues: [],
        strengths: [],
        metrics: {
            longSpanDevelopmentPressureFit: 0.38,
            longSpanThematicTransformationFit: 0.4,
            longSpanHarmonicTimingFit: 0.42,
            longSpanReturnPayoffFit: 0.46,
        },
        sectionFindings: [
            {
                sectionId: "s3",
                label: "Retransition",
                role: "bridge",
                startMeasure: 9,
                endMeasure: 10,
                score: 62,
                issues: ["Tension arc mismatch"],
                strengths: [],
                metrics: { tensionMismatch: 0.46 },
            },
            {
                sectionId: "s4",
                label: "Later Development",
                role: "development",
                startMeasure: 11,
                endMeasure: 14,
                score: 48,
                issues: ["Tension arc mismatch"],
                strengths: [],
                metrics: { tensionMismatch: 0.74 },
            },
            {
                sectionId: "s5",
                label: "Return",
                role: "recap",
                startMeasure: 15,
                endMeasure: 18,
                score: 44,
                issues: ["Section close does not settle convincingly."],
                strengths: [],
                metrics: { cadenceStrengthFit: 0.22 },
            },
        ],
        weakestSections: [
            {
                sectionId: "s5",
                label: "Return",
                role: "recap",
                startMeasure: 15,
                endMeasure: 18,
                score: 44,
                issues: ["Section close does not settle convincingly."],
                strengths: [],
                metrics: { cadenceStrengthFit: 0.22 },
            },
            {
                sectionId: "s4",
                label: "Later Development",
                role: "development",
                startMeasure: 11,
                endMeasure: 14,
                score: 48,
                issues: ["Tension arc mismatch"],
                strengths: [],
                metrics: { tensionMismatch: 0.74 },
            },
        ],
    }, 86, {
        prompt: "Write a sonata whose late development and return need the strongest repair.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Localize the repair to the unstable middle and the weak return.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 120,
            targetMeasures: 18,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            longSpanForm: {
                expositionStartSectionId: "s1",
                expositionEndSectionId: "s2",
                developmentStartSectionId: "s4",
                developmentEndSectionId: "s4",
                retransitionSectionId: "s3",
                recapStartSectionId: "s5",
                returnSectionId: "s5",
                delayedPayoffSectionId: "s5",
                expectedDevelopmentPressure: "high",
                expectedReturnPayoff: "inevitable",
                thematicCheckpoints: [
                    { sourceSectionId: "s1", targetSectionId: "s4", transform: "fragment", preserveIdentity: true },
                    { sourceSectionId: "s1", targetSectionId: "s5", transform: "repeat", preserveIdentity: true },
                ],
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.42, density: 0.34 },
                { id: "s2", role: "theme_b", label: "Contrast", measures: 4, energy: 0.52, density: 0.42 },
                { id: "s3", role: "bridge", label: "Retransition", measures: 2, energy: 0.58, density: 0.48 },
                { id: "s4", role: "development", label: "Later Development", measures: 4, energy: 0.72, density: 0.58 },
                { id: "s5", role: "recap", label: "Return", measures: 4, energy: 0.34, density: 0.3 },
            ],
            rationale: "Keep the opening untouched while the middle and return tighten up.",
        },
    });

    assert.deepEqual(directives.find((directive) => directive.kind === "clarify_narrative_arc")?.sectionIds, ["s4"]);
    assert.deepEqual(directives.find((directive) => directive.kind === "rebalance_recap_release")?.sectionIds, ["s5"]);
    const harmonyDirective = directives.find((directive) => directive.kind === "stabilize_harmony");
    assert.ok(harmonyDirective);
    assert.ok(harmonyDirective?.sectionIds?.includes("s3"));
    assert.ok(harmonyDirective?.sectionIds?.includes("s5"));
});

test("applyRevisionDirectives localizes long-span repair to the planned development and return zones", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a sonata whose late development and return need targeted repair.",
        key: "C major",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the opening stable while the late-form arc tightens.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 120,
            targetMeasures: 18,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            longSpanForm: {
                expositionStartSectionId: "s1",
                expositionEndSectionId: "s2",
                developmentStartSectionId: "s4",
                developmentEndSectionId: "s4",
                retransitionSectionId: "s3",
                recapStartSectionId: "s5",
                returnSectionId: "s5",
                delayedPayoffSectionId: "s5",
                expectedDevelopmentPressure: "high",
                expectedReturnPayoff: "inevitable",
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Theme",
                    measures: 4,
                    energy: 0.42,
                    density: 0.36,
                    harmonicPlan: { tonalCenter: "C major", harmonicRhythm: "medium", allowModulation: false },
                },
                {
                    id: "s2",
                    role: "theme_b",
                    label: "Contrast",
                    measures: 4,
                    energy: 0.52,
                    density: 0.42,
                    harmonicPlan: { tonalCenter: "G major", harmonicRhythm: "medium", allowModulation: true },
                },
                {
                    id: "s3",
                    role: "bridge",
                    label: "Retransition",
                    measures: 2,
                    energy: 0.58,
                    density: 0.48,
                    harmonicPlan: { tonalCenter: "G major", harmonicRhythm: "slow", allowModulation: true },
                },
                {
                    id: "s4",
                    role: "development",
                    label: "Later Development",
                    measures: 4,
                    energy: 0.68,
                    density: 0.54,
                    harmonicPlan: { tonalCenter: "G major", harmonicRhythm: "medium", allowModulation: true, tensionTarget: 0.58 },
                },
                {
                    id: "s5",
                    role: "recap",
                    label: "Return",
                    measures: 4,
                    energy: 0.42,
                    density: 0.38,
                    harmonicPlan: { tonalCenter: "A minor", harmonicRhythm: "fast", allowModulation: true, tensionTarget: 0.56 },
                },
            ],
            rationale: "Only the late development and return should shift.",
        },
    }, [
        {
            kind: "clarify_narrative_arc",
            priority: 90,
            reason: "Re-focus the planned development zone so long-span pressure and thematic transformation accumulate clearly before the return.",
            sectionIds: ["s4"],
        },
        {
            kind: "stabilize_harmony",
            priority: 88,
            reason: "Clarify the return boundary so retransition, harmonic preparation, and home-key arrival line up with the planned long-span return.",
            sectionIds: ["s3", "s5"],
        },
        {
            kind: "rebalance_recap_release",
            priority: 92,
            reason: "Make the planned return pay off more clearly by restating the opening identity and settling below the development peak.",
            sectionIds: ["s5"],
        },
    ], 2);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.density, 0.36);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.density, 0.42);
    assert.ok((revisedRequest.compositionPlan?.sections[3]?.energy ?? 0) > 0.68);
    assert.equal(revisedRequest.compositionPlan?.sections[3]?.harmonicPlan?.harmonicRhythm, "fast");
    assert.equal(revisedRequest.compositionPlan?.sections[3]?.motifRef, "s1");
    assert.equal(revisedRequest.compositionPlan?.sections[4]?.harmonicPlan?.tonalCenter, "C major");
    assert.equal(revisedRequest.compositionPlan?.sections[4]?.harmonicPlan?.allowModulation, false);
    assert.ok((revisedRequest.compositionPlan?.sections[4]?.density ?? 1) < 0.38);
    assert.equal(revisedRequest.compositionPlan?.sections[4]?.motifRef, "s1");
});

test("buildStructureEvaluation surfaces expression-plan drift from section artifacts", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 86,
        issues: [],
        strengths: ["Stable structure."],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: ["Stable."],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        expressionDefaults: {
            dynamics: { start: "pp", peak: "mp", end: "p" },
            articulation: ["legato"],
            character: ["dolce"],
        },
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.32,
                density: 0.24,
                expression: {
                    articulation: ["legato"],
                    character: ["cantabile"],
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                expressionDynamics: { start: "f", peak: "ff", end: "f" },
                articulation: ["accent"],
                character: ["agitato"],
            },
        ],
    });

    assert.ok((evaluation.metrics?.expressionPlanFit ?? 1) < 0.4);
    assert.ok(evaluation.issues.includes("Section expression drift weakens the planned dynamic and articulation profile."));
    assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section dynamics drift from the planned expression contour."));
    assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section articulation or character does not match the planned expression profile."));
});

test("buildStructureRevisionDirectives targets the weakest expression section", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 71,
        issues: ["Section expression drift weakens the planned dynamic and articulation profile."],
        strengths: [],
        metrics: {
            expressionPlanFit: 0.34,
            dynamicsPlanFit: 0.28,
            articulationCharacterPlanFit: 0.22,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Theme",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 82,
                issues: [],
                strengths: ["Stable."],
                metrics: { expressionPlanFit: 0.9, dynamicsPlanFit: 0.88, articulationPlanFit: 1, characterPlanFit: 0.8 },
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 54,
                issues: [
                    "Section dynamics drift from the planned expression contour.",
                    "Section articulation or character does not match the planned expression profile.",
                ],
                strengths: [],
                metrics: {
                    expressionPlanFit: 0.18,
                    dynamicsPlanFit: 0.12,
                    articulationPlanFit: 0.2,
                    characterPlanFit: 0.18,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 54,
                issues: [
                    "Section dynamics drift from the planned expression contour.",
                    "Section articulation or character does not match the planned expression profile.",
                ],
                strengths: [],
                metrics: {
                    expressionPlanFit: 0.18,
                    dynamicsPlanFit: 0.12,
                    articulationPlanFit: 0.2,
                    characterPlanFit: 0.18,
                },
            },
        ],
    }, 80, {
        prompt: "Write a sonata with a more audible development profile.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the development expressive rather than flat.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            expressionDefaults: {
                dynamics: { start: "pp", peak: "mp", end: "p" },
                articulation: ["legato"],
                character: ["dolce"],
            },
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.36, density: 0.28 },
                { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.72, density: 0.58 },
            ],
            rationale: "Make the development expression audible.",
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "shape_dynamics" && directive.sectionIds?.includes("s2")));
    assert.ok(directives.some((directive) => directive.kind === "clarify_expression" && directive.sectionIds?.includes("s2")));
});

test("buildStructureEvaluation surfaces phrase and texture drift from section artifacts", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 86,
        issues: [],
        strengths: ["Stable structure."],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: ["Stable."],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        textureDefaults: {
            voiceCount: 3,
            primaryRoles: ["lead", "inner_voice", "bass"],
            counterpointMode: "contrary_motion",
        },
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.36,
                density: 0.28,
                phraseFunction: "presentation",
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "counterline", "bass"],
                    counterpointMode: "contrary_motion",
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                phraseFunction: "cadential",
                textureVoiceCount: 1,
                primaryTextureRoles: ["lead"],
                counterpointMode: "none",
            },
        ],
    });

    assert.ok((evaluation.metrics?.phraseFunctionFit ?? 1) < 0.3);
    assert.ok((evaluation.metrics?.texturePlanFit ?? 1) < 0.35);
    assert.ok(evaluation.issues.includes("Section phrase rhetoric drifts from the planned formal roles."));
    assert.ok(evaluation.issues.includes("Section texture drift weakens the planned voice-count and role profile."));
    assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section phrase function does not match the planned formal rhetoric."));
    assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section texture plan does not preserve the planned voice-count or role layout."));
    assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section counterpoint cue does not match the planned texture profile."));
});

test("buildStructureEvaluation penalizes static counterline behavior even when texture labels survive", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 88,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.34,
                density: 0.3,
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "counterline", "bass"],
                    counterpointMode: "contrary_motion",
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [60, 62, 64, 65],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "counterline", "bass"],
                counterpointMode: "contrary_motion",
                secondaryLinePitchCount: 2,
                secondaryLineSpan: 2,
                secondaryLineDistinctPitchClasses: 2,
                textureIndependentMotionRate: 0.12,
                textureContraryMotionRate: 0.1,
            },
        ],
    });

    const finding = evaluation.sectionFindings?.[0];

    assert.ok(finding);
    assert.equal(finding.metrics.textureRoleFit, 1);
    assert.equal(finding.metrics.counterpointModeFit, 1);
    assert.ok((finding.metrics.textureIndependenceFit ?? 1) < 0.2);
    assert.ok((finding.metrics.counterpointBehaviorFit ?? 1) < 0.2);
    assert.ok((finding.metrics.texturePlanFit ?? 1) < 0.65);
    assert.ok(finding.issues.includes("Section secondary line stays too static to support the planned independent texture."));
    assert.ok(finding.issues.includes("Section contrary-motion cue is not strong enough between melody and secondary line."));
    assert.ok(evaluation.issues.includes("Planned inner-voice or counterline sections stay too static after realization."));
    assert.ok(evaluation.issues.includes("Counterpoint behavior is too weak in the sections that requested it."));
});

test("buildStructureEvaluation derives contrary-motion texture evidence from role-tagged accompaniment events", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 88,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.34,
                density: 0.3,
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [
                    { type: "note", quarterLength: 0.5, pitch: 36, voiceRole: "bass" },
                    { type: "note", quarterLength: 0.5, pitch: 57, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 0.5, pitch: 55, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 0.5, pitch: 53, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 0.5, pitch: 52, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 0.5, pitch: 50, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 0.5, pitch: 48, voiceRole: "inner_voice" },
                ],
                noteHistory: [60, 62, 64, 65, 67, 69],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
        ],
    });

    const finding = evaluation.sectionFindings?.[0];

    assert.ok(finding);
    assert.equal(finding.metrics.textureRoleFit, 1);
    assert.equal(finding.metrics.counterpointModeFit, 1);
    assert.ok((finding.metrics.textureIndependenceFit ?? 0) >= 0.92);
    assert.ok((finding.metrics.counterpointBehaviorFit ?? 0) >= 0.92);
    assert.ok(!finding.issues.includes("Section secondary line stays too static to support the planned independent texture."));
    assert.ok(!finding.issues.includes("Section contrary-motion cue is not strong enough between melody and secondary line."));
    assert.ok(finding.strengths.includes("Section secondary line keeps enough motion to sustain the planned independent texture."));
});

test("buildStructureEvaluation scores weak imitative survival from source-motif relation and motion", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 88,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Theme",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Answer",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 82,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 4,
                energy: 0.36,
                density: 0.28,
            },
            {
                id: "s2",
                role: "development",
                label: "Answer",
                measures: 4,
                energy: 0.58,
                density: 0.42,
                motifRef: "s1",
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "counterline", "bass"],
                    counterpointMode: "imitative",
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [60, 62, 64, 65],
                capturedMotif: [0, 2, 4, 5],
            },
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [67, 66, 64, 61],
                capturedMotif: [0, -1, -3, -6],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "counterline", "bass"],
                counterpointMode: "imitative",
                secondaryLinePitchCount: 2,
                secondaryLineSpan: 2,
                secondaryLineDistinctPitchClasses: 2,
                textureIndependentMotionRate: 0.14,
                textureContraryMotionRate: 0.12,
            },
        ],
    });

    const finding = evaluation.sectionFindings?.find((entry) => entry.sectionId === "s2");

    assert.ok(finding);
    assert.equal(finding.metrics.counterpointModeFit, 1);
    assert.ok((finding.metrics.imitationFit ?? 1) < 0.3);
    assert.ok((finding.metrics.counterpointBehaviorFit ?? 1) < 0.35);
    assert.ok((finding.metrics.texturePlanFit ?? 1) < 0.6);
    assert.ok(finding.issues.includes("Section imitative cue does not preserve enough source-motif relation and answer-like motion."));
    assert.ok(finding.issues.includes("Section imitative counterpoint does not sustain enough answer-like motion after realization."));
    assert.ok(evaluation.issues.includes("Imitative sections do not retain enough source-motif relation after realization."));
});

test("buildStructureEvaluation prefers secondary-line motif evidence for strong imitative survival", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 88,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Theme",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Answer",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 82,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 4,
                energy: 0.36,
                density: 0.28,
            },
            {
                id: "s2",
                role: "development",
                label: "Answer",
                measures: 4,
                energy: 0.58,
                density: 0.42,
                motifRef: "s1",
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "counterline", "bass"],
                    counterpointMode: "imitative",
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [60, 62, 64, 65],
                capturedMotif: [0, 2, 4, 5],
            },
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [67, 66, 64, 61],
                capturedMotif: [0, -1, -3, -6],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "counterline", "bass"],
                counterpointMode: "imitative",
                secondaryLinePitchCount: 8,
                secondaryLineSpan: 7,
                secondaryLineDistinctPitchClasses: 4,
                secondaryLineMotif: [0, 2, 4, 5],
                textureIndependentMotionRate: 0.62,
                textureContraryMotionRate: 0.18,
            },
        ],
    });

    const finding = evaluation.sectionFindings?.find((entry) => entry.sectionId === "s2");

    assert.ok(finding);
    assert.equal(finding.metrics.counterpointModeFit, 1);
    assert.ok((finding.metrics.imitationFit ?? 0) >= 0.84);
    assert.ok((finding.metrics.counterpointBehaviorFit ?? 0) >= 0.8);
    assert.ok(!finding.issues.includes("Section imitative cue does not preserve enough source-motif relation and answer-like motion."));
    assert.ok(finding.strengths.includes("Section imitative cue keeps enough source-motif relation to read as an answer-like strand."));
});

test("buildStructureEvaluation derives part-level imitation evidence from role-tagged accompaniment events", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 88,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Theme",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Answer",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 82,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 4,
                energy: 0.36,
                density: 0.28,
            },
            {
                id: "s2",
                role: "development",
                label: "Answer",
                measures: 4,
                energy: 0.58,
                density: 0.42,
                motifRef: "s1",
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "counterline", "bass"],
                    counterpointMode: "imitative",
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [60, 62, 64, 65, 67, 69],
                capturedMotif: [0, 2, 4, 5, 7, 9],
            },
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [
                    { type: "note", quarterLength: 0.5, pitch: 36, voiceRole: "bass" },
                    { type: "note", quarterLength: 0.5, pitch: 67, voiceRole: "counterline" },
                    { type: "note", quarterLength: 0.5, pitch: 69, voiceRole: "counterline" },
                    { type: "note", quarterLength: 0.5, pitch: 71, voiceRole: "counterline" },
                    { type: "note", quarterLength: 0.5, pitch: 72, voiceRole: "counterline" },
                    { type: "note", quarterLength: 0.5, pitch: 74, voiceRole: "counterline" },
                    { type: "note", quarterLength: 0.5, pitch: 76, voiceRole: "counterline" },
                ],
                noteHistory: [60, 59, 57, 55],
                capturedMotif: [0, -1, -3, -5],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "counterline", "bass"],
                counterpointMode: "imitative",
            },
        ],
    });

    const finding = evaluation.sectionFindings?.find((entry) => entry.sectionId === "s2");

    assert.ok(finding);
    assert.equal(finding.metrics.counterpointModeFit, 1);
    assert.ok((finding.metrics.textureIndependenceFit ?? 0) >= 0.9);
    assert.ok((finding.metrics.imitationFit ?? 0) >= 0.92);
    assert.ok((finding.metrics.counterpointBehaviorFit ?? 0) >= 0.9);
    assert.ok(!finding.issues.includes("Section imitative cue does not preserve enough source-motif relation and answer-like motion."));
    assert.ok(finding.strengths.includes("Section imitative cue keeps enough source-motif relation to read as an answer-like strand."));
});

test("buildStructureRevisionDirectives targets the weakest phrase and texture section", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 70,
        issues: [
            "Section phrase rhetoric drifts from the planned formal roles.",
            "Section texture drift weakens the planned voice-count and role profile.",
        ],
        strengths: [],
        metrics: {
            phraseFunctionFit: 0.32,
            texturePlanFit: 0.28,
            textureRoleFit: 0.2,
            counterpointModeFit: 0.18,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Theme",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 84,
                issues: [],
                strengths: ["Stable."],
                metrics: { phraseFunctionFit: 1, texturePlanFit: 0.88, textureRoleFit: 0.86, counterpointModeFit: 1 },
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 52,
                issues: [
                    "Section phrase function does not match the planned formal rhetoric.",
                    "Section texture plan does not preserve the planned voice-count or role layout.",
                    "Section counterpoint cue does not match the planned texture profile.",
                ],
                strengths: [],
                metrics: {
                    phraseFunctionFit: 0.15,
                    texturePlanFit: 0.12,
                    textureRoleFit: 0.1,
                    textureVoiceCountFit: 0.2,
                    counterpointModeFit: 0,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 52,
                issues: [
                    "Section phrase function does not match the planned formal rhetoric.",
                    "Section texture plan does not preserve the planned voice-count or role layout.",
                    "Section counterpoint cue does not match the planned texture profile.",
                ],
                strengths: [],
                metrics: {
                    phraseFunctionFit: 0.15,
                    texturePlanFit: 0.12,
                    textureRoleFit: 0.1,
                    textureVoiceCountFit: 0.2,
                    counterpointModeFit: 0,
                },
            },
        ],
    }, 80, {
        prompt: "Write a sonata whose development needs a clearer phrase and texture identity.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the development locally legible.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "inner_voice", "bass"], register: "wide" }],
            textureDefaults: {
                voiceCount: 3,
                primaryRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.26, phraseFunction: "presentation" },
                { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.72, density: 0.56, phraseFunction: "developmental" },
            ],
            rationale: "Make the development's local role audible.",
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "clarify_phrase_rhetoric" && directive.sectionIds?.includes("s2")));
    assert.ok(directives.some((directive) => directive.kind === "clarify_texture_plan" && directive.sectionIds?.includes("s2")));
});

test("buildStructureRevisionDirectives targets imitative sections even when only imitation survival is weak", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 77,
        issues: [
            "Imitative sections do not retain enough source-motif relation after realization.",
        ],
        strengths: [],
        metrics: {
            imitationFit: 0.34,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Answer",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 74,
                issues: [
                    "Section imitative cue does not preserve enough source-motif relation and answer-like motion.",
                ],
                strengths: [],
                metrics: {
                    texturePlanFit: 0.79,
                    textureIndependenceFit: 0.82,
                    counterpointBehaviorFit: 0.78,
                    imitationFit: 0.32,
                    counterpointModeFit: 1,
                    textureRoleFit: 0.92,
                    textureVoiceCountFit: 1,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Answer",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 74,
                issues: [
                    "Section imitative cue does not preserve enough source-motif relation and answer-like motion.",
                ],
                strengths: [],
                metrics: {
                    texturePlanFit: 0.79,
                    textureIndependenceFit: 0.82,
                    counterpointBehaviorFit: 0.78,
                    imitationFit: 0.32,
                    counterpointModeFit: 1,
                    textureRoleFit: 0.92,
                    textureVoiceCountFit: 1,
                },
            },
        ],
    }, 80, {
        prompt: "Write an imitative development whose answer stays audible.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the answer strand obvious.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "counterline", "bass"], register: "wide" }],
            textureDefaults: {
                voiceCount: 3,
                primaryRoles: ["lead", "counterline", "bass"],
                counterpointMode: "imitative",
            },
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.26, phraseFunction: "presentation" },
                { id: "s2", role: "development", label: "Answer", measures: 4, energy: 0.7, density: 0.54, phraseFunction: "developmental", motifRef: "s1" },
            ],
            rationale: "Let the answer read as related, not generic.",
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "clarify_texture_plan" && directive.sectionIds?.includes("s2")));
});

test("buildStructureEvaluation reports string-trio orchestration metrics from role-tagged section artifacts", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 88,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 84,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.42,
                density: 0.34,
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                },
            },
            {
                id: "s2",
                role: "cadence",
                label: "Close",
                measures: 4,
                energy: 0.24,
                density: 0.22,
                texture: {
                    voiceCount: 2,
                    primaryRoles: ["lead", "bass"],
                    counterpointMode: "none",
                },
            },
        ],
        orchestration: {
            family: "string_trio",
            instrumentNames: ["violin", "viola", "cello"],
            sections: [
                {
                    sectionId: "s1",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "conversational",
                    balanceProfile: "balanced",
                    registerLayout: "layered",
                },
                {
                    sectionId: "s2",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "lead_forward",
                    registerLayout: "layered",
                },
            ],
        },
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 72 },
                    { type: "note", quarterLength: 1, pitch: 74 },
                    { type: "note", quarterLength: 1, pitch: 76 },
                    { type: "note", quarterLength: 1, pitch: 77 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 64, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 62, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 60, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 59, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 43, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 45, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 47, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 48, voiceRole: "bass" },
                ],
                noteHistory: [72, 74, 76, 77],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
            {
                sectionId: "s2",
                role: "cadence",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 69 },
                    { type: "note", quarterLength: 1, pitch: 71 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 60, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 59, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 43, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 41, voiceRole: "bass" },
                ],
                noteHistory: [69, 71],
                textureVoiceCount: 2,
                primaryTextureRoles: ["lead", "bass"],
                counterpointMode: "none",
            },
        ],
    });

    assert.equal(evaluation.orchestration?.family, "string_trio");
    assert.ok((evaluation.metrics?.orchestrationIdiomaticRangeFit ?? 0) >= 0.9);
    assert.ok((evaluation.metrics?.orchestrationRegisterBalanceFit ?? 0) >= 0.85);
    assert.ok((evaluation.metrics?.orchestrationConversationFit ?? 0) >= 0.8);
    assert.ok((evaluation.metrics?.orchestrationDoublingPressureFit ?? 0) >= 0.88);
    assert.ok((evaluation.orchestration?.doublingPressureFit ?? 0) >= 0.88);
    assert.ok(!evaluation.issues.includes("String-trio idiomatic range writing drifts outside the planned instrument comfort zones."));
    assert.ok(!evaluation.issues.includes("String-trio register balance blurs the planned lead, middle, and bass stack."));
    assert.ok(!evaluation.issues.includes("String-trio doubling pressure blurs independent instrument roles across the form."));
});

test("buildStructureRevisionDirectives localizes weak string-trio balance and conversation sections", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 80,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 72,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.34,
                density: 0.28,
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                },
            },
            {
                id: "s2",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.68,
                density: 0.54,
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                },
            },
        ],
        orchestration: {
            family: "string_trio",
            instrumentNames: ["violin", "viola", "cello"],
            sections: [
                {
                    sectionId: "s1",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "lead_forward",
                    registerLayout: "layered",
                },
                {
                    sectionId: "s2",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "conversational",
                    balanceProfile: "balanced",
                    registerLayout: "layered",
                },
            ],
        },
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 74 },
                    { type: "note", quarterLength: 1, pitch: 76 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 63, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 45, voiceRole: "bass" },
                ],
                noteHistory: [74, 76],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 61 },
                    { type: "note", quarterLength: 1, pitch: 63 },
                    { type: "note", quarterLength: 1, pitch: 64 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 72, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 72, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 70, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 67, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 69, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 67, voiceRole: "bass" },
                ],
                noteHistory: [61, 63, 64],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
        ],
    });
    const directives = buildStructureRevisionDirectives(evaluation, 82, {
        prompt: "Write a compact string trio whose development still keeps the ensemble layered.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the trio layered.",
            mood: ["focused"],
            form: "miniature",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "violin", family: "strings", roles: ["lead"], register: "high" },
                { name: "viola", family: "strings", roles: ["inner_voice"], register: "mid" },
                { name: "cello", family: "strings", roles: ["bass"], register: "low" },
            ],
            motifPolicy: { reuseRequired: true },
            orchestration: {
                family: "string_trio",
                instrumentNames: ["violin", "viola", "cello"],
                sections: [
                    {
                        sectionId: "s1",
                        leadInstrument: "violin",
                        secondaryInstrument: "viola",
                        bassInstrument: "cello",
                        conversationMode: "support",
                        balanceProfile: "lead_forward",
                        registerLayout: "layered",
                    },
                    {
                        sectionId: "s2",
                        leadInstrument: "violin",
                        secondaryInstrument: "viola",
                        bassInstrument: "cello",
                        conversationMode: "conversational",
                        balanceProfile: "balanced",
                        registerLayout: "layered",
                    },
                ],
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.34, density: 0.28 },
                { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.68, density: 0.54 },
            ],
            rationale: "Keep violin above viola above cello.",
        },
    });

    assert.ok(evaluation.issues.includes("String-trio register balance blurs the planned lead, middle, and bass stack."));
    assert.ok(evaluation.issues.includes("String-trio conversational sections do not sustain enough independent exchange."));
    assert.ok(directives.some((directive) => directive.kind === "expand_register" && directive.sectionIds?.includes("s2")));
    assert.ok(directives.some((directive) => directive.kind === "clarify_texture_plan" && directive.sectionIds?.includes("s2")));
});

test("buildStructureRevisionDirectives localizes weak string-trio doubling sections", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 82,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Sequence",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 74,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.34,
                density: 0.28,
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                },
            },
            {
                id: "s2",
                role: "development",
                label: "Sequence",
                measures: 4,
                energy: 0.6,
                density: 0.5,
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "none",
                },
            },
        ],
        orchestration: {
            family: "string_trio",
            instrumentNames: ["violin", "viola", "cello"],
            sections: [
                {
                    sectionId: "s1",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "lead_forward",
                    registerLayout: "layered",
                },
                {
                    sectionId: "s2",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "lead_forward",
                    registerLayout: "layered",
                },
            ],
        },
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 74 },
                    { type: "note", quarterLength: 1, pitch: 76 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 63, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 65, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 45, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 47, voiceRole: "bass" },
                ],
                noteHistory: [74, 76],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 72 },
                    { type: "note", quarterLength: 1, pitch: 74 },
                    { type: "note", quarterLength: 1, pitch: 76 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 60, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 62, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 64, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 48, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 50, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 52, voiceRole: "bass" },
                ],
                noteHistory: [72, 74, 76],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "none",
            },
        ],
    });
    const directives = buildStructureRevisionDirectives(evaluation, 82, {
        prompt: "Write a compact string trio whose sequence passage keeps each instrument independent.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the violin, viola, and cello independent.",
            mood: ["focused"],
            form: "miniature",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "violin", family: "strings", roles: ["lead"], register: "high" },
                { name: "viola", family: "strings", roles: ["inner_voice"], register: "mid" },
                { name: "cello", family: "strings", roles: ["bass"], register: "low" },
            ],
            motifPolicy: { reuseRequired: true },
            orchestration: {
                family: "string_trio",
                instrumentNames: ["violin", "viola", "cello"],
                sections: [
                    {
                        sectionId: "s1",
                        leadInstrument: "violin",
                        secondaryInstrument: "viola",
                        bassInstrument: "cello",
                        conversationMode: "support",
                        balanceProfile: "lead_forward",
                        registerLayout: "layered",
                    },
                    {
                        sectionId: "s2",
                        leadInstrument: "violin",
                        secondaryInstrument: "viola",
                        bassInstrument: "cello",
                        conversationMode: "support",
                        balanceProfile: "lead_forward",
                        registerLayout: "layered",
                    },
                ],
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.34, density: 0.28 },
                { id: "s2", role: "development", label: "Sequence", measures: 4, energy: 0.6, density: 0.5 },
            ],
            rationale: "Keep the development from collapsing into octave shadowing.",
        },
    });

    assert.ok((evaluation.metrics?.orchestrationDoublingPressureFit ?? 1) < 0.72);
    assert.ok(evaluation.issues.includes("String-trio doubling pressure blurs independent instrument roles across the form."));
    assert.ok(
        evaluation.sectionFindings?.find((finding) => finding.sectionId === "s2")?.issues.includes(
            "String-trio doubling pressure thickens the lead too often and weakens independent instrument roles.",
        ),
    );
    assert.ok(directives.some((directive) => directive.kind === "expand_register" && directive.sectionIds?.includes("s2")));
    assert.ok(directives.some((directive) => directive.kind === "clarify_texture_plan" && directive.sectionIds?.includes("s2")));
});

test("buildStructureEvaluation scores string-trio handoff rotation between adjacent sections", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 88,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 88,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Exchange",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.32, density: 0.24 },
            { id: "s2", role: "development", label: "Exchange", measures: 4, energy: 0.61, density: 0.45 },
        ],
        orchestration: {
            family: "string_trio",
            instrumentNames: ["violin", "viola", "cello"],
            sections: [
                {
                    sectionId: "s1",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "lead_forward",
                    registerLayout: "layered",
                },
                {
                    sectionId: "s2",
                    leadInstrument: "viola",
                    secondaryInstrument: "violin",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "balanced",
                    registerLayout: "layered",
                },
            ],
        },
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 76 },
                    { type: "note", quarterLength: 1, pitch: 78 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 56, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 58, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 46, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 48, voiceRole: "bass" },
                ],
                noteHistory: [76, 78],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 68 },
                    { type: "note", quarterLength: 1, pitch: 70 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 65, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 67, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 47, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 49, voiceRole: "bass" },
                ],
                noteHistory: [68, 70],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
        ],
    });

    assert.ok((evaluation.metrics?.orchestrationSectionHandoffFit ?? 0) >= 0.82);
    assert.ok((evaluation.orchestration?.sectionHandoffFit ?? 0) >= 0.82);
    assert.ok((evaluation.sectionFindings?.find((finding) => finding.sectionId === "s2")?.metrics.orchestrationHandoffFit ?? 0) >= 0.82);
    assert.ok(!evaluation.issues.includes("String-trio section-to-section handoffs do not reassign lead, middle, and bass duties clearly enough."));
});

test("buildStructureRevisionDirectives localizes weak string-trio handoff sections", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 84,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Exchange",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 84,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.32, density: 0.24 },
            { id: "s2", role: "development", label: "Exchange", measures: 4, energy: 0.61, density: 0.45 },
        ],
        orchestration: {
            family: "string_trio",
            instrumentNames: ["violin", "viola", "cello"],
            sections: [
                {
                    sectionId: "s1",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "lead_forward",
                    registerLayout: "layered",
                },
                {
                    sectionId: "s2",
                    leadInstrument: "viola",
                    secondaryInstrument: "violin",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "balanced",
                    registerLayout: "layered",
                },
            ],
        },
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 76 },
                    { type: "note", quarterLength: 1, pitch: 78 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 63, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 64, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 46, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 48, voiceRole: "bass" },
                ],
                noteHistory: [76, 78],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 74 },
                    { type: "note", quarterLength: 1, pitch: 75 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 67, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 68, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 47, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 49, voiceRole: "bass" },
                ],
                noteHistory: [74, 75],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
        ],
    });
    const directives = buildStructureRevisionDirectives(evaluation, 82, {
        prompt: "Write a compact string trio with a clear viola-led handoff in the development.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Rotate the trio lead clearly.",
            mood: ["focused"],
            form: "miniature",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "violin", family: "strings", roles: ["lead", "inner_voice"], register: "high" },
                { name: "viola", family: "strings", roles: ["lead", "inner_voice"], register: "mid" },
                { name: "cello", family: "strings", roles: ["bass"], register: "low" },
            ],
            motifPolicy: { reuseRequired: true },
            orchestration: {
                family: "string_trio",
                instrumentNames: ["violin", "viola", "cello"],
                sections: [
                    {
                        sectionId: "s1",
                        leadInstrument: "violin",
                        secondaryInstrument: "viola",
                        bassInstrument: "cello",
                        conversationMode: "support",
                        balanceProfile: "lead_forward",
                        registerLayout: "layered",
                    },
                    {
                        sectionId: "s2",
                        leadInstrument: "viola",
                        secondaryInstrument: "violin",
                        bassInstrument: "cello",
                        conversationMode: "support",
                        balanceProfile: "balanced",
                        registerLayout: "layered",
                    },
                ],
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.32, density: 0.24 },
                { id: "s2", role: "development", label: "Exchange", measures: 4, energy: 0.61, density: 0.45 },
            ],
            rationale: "Make the viola inherit the lead role without blurring the trio stack.",
        },
    });

    assert.ok((evaluation.metrics?.orchestrationSectionHandoffFit ?? 1) < 0.72);
    assert.ok(evaluation.issues.includes("String-trio section-to-section handoffs do not reassign lead, middle, and bass duties clearly enough."));
    assert.ok(
        evaluation.sectionFindings?.find((finding) => finding.sectionId === "s2")?.issues.includes(
            "String-trio register handoff does not transfer lead, middle, and bass duties clearly enough from the previous section.",
        ),
    );
    assert.ok(directives.some((directive) => directive.kind === "expand_register" && directive.sectionIds?.includes("s2")));
    assert.ok(directives.some((directive) => directive.kind === "clarify_texture_plan" && directive.sectionIds?.includes("s2")));
});

test("buildStructureEvaluation scores string-trio texture rotation between adjacent sections", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 88,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 88,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.32,
                density: 0.22,
                texture: {
                    voiceCount: 2,
                    primaryRoles: ["lead", "bass"],
                    counterpointMode: "none",
                },
            },
            {
                id: "s2",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.64,
                density: 0.48,
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                },
            },
        ],
        orchestration: {
            family: "string_trio",
            instrumentNames: ["violin", "viola", "cello"],
            sections: [
                {
                    sectionId: "s1",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "lead_forward",
                    registerLayout: "layered",
                },
                {
                    sectionId: "s2",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "conversational",
                    balanceProfile: "balanced",
                    registerLayout: "wide",
                },
            ],
        },
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 77 },
                    { type: "note", quarterLength: 1, pitch: 79 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 66, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 67, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 51, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 53, voiceRole: "bass" },
                ],
                noteHistory: [77, 79],
                textureVoiceCount: 2,
                primaryTextureRoles: ["lead", "bass"],
                counterpointMode: "none",
            },
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 73 },
                    { type: "note", quarterLength: 1, pitch: 75 },
                    { type: "note", quarterLength: 1, pitch: 74 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 71, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 70, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 45, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 43, voiceRole: "bass" },
                ],
                noteHistory: [73, 75, 74],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
                secondaryLineActivity: "active",
                secondaryLineContour: "contrary_motion",
                secondaryLineRhythmDensity: 0.72,
            },
        ],
    });

    assert.ok((evaluation.metrics?.orchestrationTextureRotationFit ?? 0) >= 0.82);
    assert.ok((evaluation.orchestration?.textureRotationFit ?? 0) >= 0.82);
    assert.ok((evaluation.sectionFindings?.find((finding) => finding.sectionId === "s2")?.metrics.orchestrationTextureRotationFit ?? 0) >= 0.82);
    assert.ok(!evaluation.issues.includes("String-trio texture rotation does not refresh conversation, balance, or spacing states clearly enough across the form."));
});

test("buildStructureRevisionDirectives localizes weak string-trio texture rotation sections", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 84,
        issues: [],
        strengths: [],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 84,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.32,
                density: 0.22,
                texture: {
                    voiceCount: 2,
                    primaryRoles: ["lead", "bass"],
                    counterpointMode: "none",
                },
            },
            {
                id: "s2",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.64,
                density: 0.48,
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                },
            },
        ],
        orchestration: {
            family: "string_trio",
            instrumentNames: ["violin", "viola", "cello"],
            sections: [
                {
                    sectionId: "s1",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "support",
                    balanceProfile: "lead_forward",
                    registerLayout: "layered",
                },
                {
                    sectionId: "s2",
                    leadInstrument: "violin",
                    secondaryInstrument: "viola",
                    bassInstrument: "cello",
                    conversationMode: "conversational",
                    balanceProfile: "balanced",
                    registerLayout: "wide",
                },
            ],
        },
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 77 },
                    { type: "note", quarterLength: 1, pitch: 79 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 66, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 67, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 51, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 53, voiceRole: "bass" },
                ],
                noteHistory: [77, 79],
                textureVoiceCount: 2,
                primaryTextureRoles: ["lead", "bass"],
                counterpointMode: "none",
            },
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 1, pitch: 77 },
                    { type: "note", quarterLength: 1, pitch: 79 },
                ],
                accompanimentEvents: [
                    { type: "note", quarterLength: 1, pitch: 61, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 62, voiceRole: "inner_voice" },
                    { type: "note", quarterLength: 1, pitch: 55, voiceRole: "bass" },
                    { type: "note", quarterLength: 1, pitch: 56, voiceRole: "bass" },
                ],
                noteHistory: [77, 79],
                textureVoiceCount: 3,
                primaryTextureRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "none",
                secondaryLineActivity: "static",
                secondaryLineContour: "parallel_motion",
                secondaryLineRhythmDensity: 0.18,
            },
        ],
    });
    const directives = buildStructureRevisionDirectives(evaluation, 82, {
        prompt: "Write a compact string trio whose development arrives in a clearly new ensemble stance.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Rotate the trio texture clearly at the development entry.",
            mood: ["focused"],
            form: "miniature",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "violin", family: "strings", roles: ["lead"], register: "high" },
                { name: "viola", family: "strings", roles: ["inner_voice"], register: "mid" },
                { name: "cello", family: "strings", roles: ["bass"], register: "low" },
            ],
            motifPolicy: { reuseRequired: true },
            orchestration: {
                family: "string_trio",
                instrumentNames: ["violin", "viola", "cello"],
                sections: [
                    {
                        sectionId: "s1",
                        leadInstrument: "violin",
                        secondaryInstrument: "viola",
                        bassInstrument: "cello",
                        conversationMode: "support",
                        balanceProfile: "lead_forward",
                        registerLayout: "layered",
                    },
                    {
                        sectionId: "s2",
                        leadInstrument: "violin",
                        secondaryInstrument: "viola",
                        bassInstrument: "cello",
                        conversationMode: "conversational",
                        balanceProfile: "balanced",
                        registerLayout: "wide",
                    },
                ],
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.32, density: 0.22 },
                { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.64, density: 0.48 },
            ],
            rationale: "The trio should pivot immediately into a wider, more conversational development texture.",
        },
    });

    assert.ok((evaluation.metrics?.orchestrationTextureRotationFit ?? 1) < 0.72);
    assert.ok(evaluation.issues.includes("String-trio texture rotation does not refresh conversation, balance, or spacing states clearly enough across the form."));
    assert.ok(
        evaluation.sectionFindings?.find((finding) => finding.sectionId === "s2")?.issues.includes(
            "String-trio texture rotation does not reset conversation, balance, or spacing clearly enough from the previous section.",
        ),
    );
    assert.ok(directives.some((directive) => directive.kind === "expand_register" && directive.sectionIds?.includes("s2")));
    assert.ok(directives.some((directive) => directive.kind === "clarify_texture_plan" && directive.sectionIds?.includes("s2")));
});

test("buildStructureEvaluation localizes phrase-pressure and tonicization failures from realized section artifacts", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 86,
        issues: [],
        strengths: ["Base structure is fine."],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Theme",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: ["Stable."],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 82,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 82,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
    }, {
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 4,
                energy: 0.34,
                density: 0.28,
                phraseFunction: "presentation",
            },
            {
                id: "s2",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.78,
                density: 0.58,
                phraseFunction: "developmental",
                harmonicPlan: {
                    tonalCenter: "G major",
                    keyTarget: "D major",
                    harmonicRhythm: "fast",
                    tensionTarget: 0.82,
                    allowModulation: true,
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s2",
                role: "development",
                measureCount: 4,
                melodyEvents: [
                    { type: "note", quarterLength: 2, pitch: 67 },
                    { type: "rest", quarterLength: 2 },
                    { type: "note", quarterLength: 2, pitch: 69 },
                    { type: "rest", quarterLength: 2 },
                ],
                accompanimentEvents: [
                    { type: "chord", quarterLength: 4, pitches: [55, 59, 62] },
                    { type: "chord", quarterLength: 4, pitches: [55, 59, 62] },
                ],
                noteHistory: [67, 69],
                bassMotionProfile: "pedal",
            },
        ],
    });

    assert.ok((evaluation.metrics?.phrasePressureFit ?? 1) < 0.5);
    assert.ok((evaluation.metrics?.tonicizationPressureFit ?? 1) < 0.25);
    assert.ok(evaluation.issues.includes("Section phrase pressure compresses the planned formal contrast."));
    assert.ok(evaluation.issues.includes("Section tonicization pressure is too weak for the planned harmonic roles."));
    assert.ok(evaluation.sectionFindings?.[1]?.issues.includes("Section phrase pressure compresses instead of projecting the planned formal role."));
    assert.ok(evaluation.sectionFindings?.[1]?.issues.includes("Section tonicization pressure is too weak to project the planned harmonic role."));
});

test("buildStructureRevisionDirectives targets phrase-pressure and harmonic-motion failures", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 62,
        issues: [
            "Section phrase pressure compresses the planned formal contrast.",
            "Section tonicization pressure is too weak for the planned harmonic roles.",
        ],
        strengths: [],
        metrics: {
            phrasePressureFit: 0.38,
            tonicizationPressureFit: 0.22,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Theme",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 84,
                issues: [],
                strengths: ["Stable."],
                metrics: { phrasePressureFit: 0.88, tonicizationPressureFit: 1 },
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 48,
                issues: [
                    "Section phrase pressure compresses instead of projecting the planned formal role.",
                    "Section tonicization pressure is too weak to project the planned harmonic role.",
                ],
                strengths: [],
                metrics: {
                    phrasePressureFit: 0.18,
                    tonicizationPressureFit: 0.08,
                    harmonicRoleMotionFit: 0.08,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 48,
                issues: [
                    "Section phrase pressure compresses instead of projecting the planned formal role.",
                    "Section tonicization pressure is too weak to project the planned harmonic role.",
                ],
                strengths: [],
                metrics: {
                    phrasePressureFit: 0.18,
                    tonicizationPressureFit: 0.08,
                    harmonicRoleMotionFit: 0.08,
                },
            },
        ],
    }, 80, {
        prompt: "Write a sonata whose development needs clearer phrase pressure and harmonic departure.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the development rhetorically legible.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.26 },
                { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.6, density: 0.44, phraseFunction: "developmental" },
            ],
            rationale: "Keep the development from flattening out.",
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "clarify_phrase_rhetoric" && directive.sectionIds?.includes("s2")));
    assert.ok(directives.some((directive) => directive.kind === "stabilize_harmony" && directive.sectionIds?.includes("s2")));
});

test("applyRevisionDirectives raises targeted phrase pressure and repairs static prolongation", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a sonata whose development needs stronger phrase pressure and less static prolongation.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the middle section moving.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.26 },
                {
                    id: "s2",
                    role: "development",
                    label: "Development",
                    measures: 4,
                    energy: 0.58,
                    density: 0.44,
                    phraseFunction: "developmental",
                    harmonicPlan: {
                        tonalCenter: "G major",
                        harmonicRhythm: "slow",
                        tensionTarget: 0.42,
                        allowModulation: false,
                    },
                },
            ],
            rationale: "Only the development should change.",
        },
    }, [
        {
            kind: "clarify_phrase_rhetoric",
            priority: 82,
            reason: "Raise local phrase pressure.",
            sourceIssue: "Section phrase pressure compresses the planned formal contrast.",
            sectionIds: ["s2"],
        },
        {
            kind: "stabilize_harmony",
            priority: 86,
            reason: "Break up static prolongation.",
            sourceIssue: "Section prolongation stays too static for the planned harmonic roles.",
            sectionIds: ["s2"],
        },
    ], 2);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.density, 0.26);
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.energy ?? 0) > 0.6);
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.density ?? 0) > 0.5);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.allowModulation, false);
    assert.notEqual(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.harmonicRhythm, "slow");
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.tensionTarget ?? 0) >= 0.48);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /continuation pressure|flattening out|longest arrival|phrase goal/i);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /tonal center anchored|prolongation does not stall/i);
});

test("buildStructureEvaluation surfaces harmonic-color drift from section artifacts", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        score: 88,
        issues: [],
        strengths: ["Base structure is fine."],
        metrics: {},
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Development",
                role: "development",
                startMeasure: 1,
                endMeasure: 4,
                score: 84,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [
            {
                sectionId: "s1",
                label: "Development",
                role: "development",
                startMeasure: 1,
                endMeasure: 4,
                score: 84,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
    }, {
        sections: [
            {
                id: "s1",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.72,
                density: 0.56,
                harmonicPlan: {
                    tonalCenter: "G minor",
                    keyTarget: "D minor",
                    harmonicRhythm: "medium",
                    colorCues: [
                        { tag: "applied_dominant", startMeasure: 2, endMeasure: 3, keyTarget: "D minor" },
                        { tag: "suspension", startMeasure: 4, resolutionMeasure: 4 },
                    ],
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "development",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [67, 69, 70],
                harmonicColorCues: [
                    { tag: "mixture", startMeasure: 1, endMeasure: 1 },
                ],
            },
        ],
    });

    assert.ok((evaluation.metrics?.harmonicColorPlanFit ?? 1) < 0.4);
    assert.ok((evaluation.metrics?.harmonicColorCoverageFit ?? 1) < 0.6);
    assert.ok((evaluation.metrics?.harmonicColorTargetFit ?? 1) < 0.4);
    assert.ok(evaluation.issues.includes("Planned harmonic color does not survive clearly enough across the weak sections."));
    assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section harmonic color cues do not survive clearly enough to project the planned local color event."));
    assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section harmonic color coverage drops planned local color cues before realization."));
    assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section harmonic color target or resolution drifts away from the planned local event."));
});

test("buildStructureRevisionDirectives targets harmonic-color failures", () => {
    const directives = buildStructureRevisionDirectives({
        passed: false,
        score: 66,
        issues: [
            "Planned harmonic color does not survive clearly enough across the weak sections.",
        ],
        strengths: [],
        metrics: {
            harmonicColorPlanFit: 0.24,
            harmonicColorCoverageFit: 0.32,
            harmonicColorTargetFit: 0.18,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Theme",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 82,
                issues: [],
                strengths: ["Stable."],
                metrics: { harmonicColorPlanFit: 1 },
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 46,
                issues: [
                    "Section harmonic color cues do not survive clearly enough to project the planned local color event.",
                    "Section harmonic color coverage drops planned local color cues before realization.",
                ],
                strengths: [],
                metrics: {
                    harmonicColorPlanFit: 0.12,
                    harmonicColorCoverageFit: 0.18,
                    harmonicColorTargetFit: 0.14,
                    harmonicColorTimingFit: 0.2,
                },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 46,
                issues: [
                    "Section harmonic color cues do not survive clearly enough to project the planned local color event.",
                    "Section harmonic color coverage drops planned local color cues before realization.",
                ],
                strengths: [],
                metrics: {
                    harmonicColorPlanFit: 0.12,
                    harmonicColorCoverageFit: 0.18,
                    harmonicColorTargetFit: 0.14,
                    harmonicColorTimingFit: 0.2,
                },
            },
        ],
    }, 80, {
        prompt: "Write a sonata whose development needs clearer local harmonic color.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep one clear local color event in the development.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.26 },
                {
                    id: "s2",
                    role: "development",
                    label: "Development",
                    measures: 4,
                    energy: 0.62,
                    density: 0.46,
                    harmonicPlan: {
                        tonalCenter: "G minor",
                        keyTarget: "D minor",
                        harmonicRhythm: "slow",
                    },
                },
            ],
            rationale: "Keep the development from sounding generically prolonged.",
        },
    });

    assert.ok(directives.some((directive) => directive.kind === "clarify_harmonic_color" && directive.sectionIds?.includes("s2")));
});

test("applyRevisionDirectives restores targeted harmonic-color cues", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a sonata whose development needs one clearer local harmonic-color event.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the development from sitting on one neutral harmony.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.26 },
                {
                    id: "s2",
                    role: "development",
                    label: "Development",
                    measures: 4,
                    energy: 0.58,
                    density: 0.44,
                    harmonicPlan: {
                        tonalCenter: "G minor",
                        keyTarget: "D minor",
                        harmonicRhythm: "slow",
                    },
                },
            ],
            rationale: "Only the development should change.",
        },
    }, [
        {
            kind: "clarify_harmonic_color",
            priority: 87,
            reason: "Restore one explicit local harmonic-color event.",
            sourceIssue: "Section harmonic color cues do not survive clearly enough to project the planned local color event.",
            sectionIds: ["s2"],
        },
    ], 2);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.density, 0.26);
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.energy ?? 0) > 0.58);
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.density ?? 0) > 0.44);
    assert.notEqual(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.harmonicRhythm, "slow");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.colorCues?.[0]?.tag, "applied_dominant");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.harmonicPlan?.colorCues?.[0]?.keyTarget, "D minor");
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /local harmonic-color event|dominant-color event/i);
});

test("applyRevisionDirectives strengthens targeted section expression cues", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a sonata whose development needs a clearer expressive profile.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the development sharp and audible.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            expressionDefaults: {
                dynamics: { start: "pp", peak: "mp", end: "p" },
                articulation: ["legato"],
                character: ["dolce"],
            },
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.26 },
                {
                    id: "s2",
                    role: "development",
                    label: "Development",
                    measures: 4,
                    energy: 0.72,
                    density: 0.58,
                    expression: {
                        dynamics: { start: "mp", peak: "mp", end: "mp" },
                        articulation: ["legato"],
                    },
                },
            ],
            rationale: "Keep only the development under revision.",
        },
    }, [
        { kind: "shape_dynamics", priority: 84, reason: "Make the dynamic contour explicit.", sectionIds: ["s2"] },
        { kind: "clarify_expression", priority: 82, reason: "Make articulation and character explicit.", sectionIds: ["s2"] },
    ], 2);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.expression, undefined);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.expression?.dynamics?.start, "mp");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.expression?.dynamics?.peak, "f");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.expression?.dynamics?.end, "mf");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.expression?.articulation?.includes("accent"), true);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.expression?.character?.[0], "agitato");
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.expression?.phrasePeaks?.[0] ?? 0) >= 2);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /dynamic swell and release/);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /articulation, character, and phrase-peak cues/);
});

test("applyRevisionDirectives reinforces targeted phrase rhetoric and texture cues", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a sonata whose development needs clearer phrase rhetoric and texture.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the development layered rather than flat.",
            mood: ["dramatic"],
            form: "sonata",
            targetDurationSec: 72,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "inner_voice", "bass"], register: "wide" }],
            textureDefaults: {
                voiceCount: 3,
                primaryRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.26 },
                { id: "s2", role: "development", label: "Development", measures: 4, energy: 0.72, density: 0.52 },
            ],
            rationale: "Only the development should be revised.",
        },
    }, [
        { kind: "clarify_phrase_rhetoric", priority: 80, reason: "Make the development function explicit.", sectionIds: ["s2"] },
        { kind: "clarify_texture_plan", priority: 78, reason: "Keep the planned layered texture explicit.", sectionIds: ["s2"] },
    ], 2);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.phraseFunction, undefined);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.texture, undefined);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.phraseFunction, "developmental");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.texture?.voiceCount, 3);
    assert.deepEqual(revisedRequest.compositionPlan?.sections[1]?.texture?.primaryRoles, ["lead", "inner_voice", "bass"]);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.texture?.counterpointMode, "contrary_motion");
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.density ?? 0) > 0.52);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /developmental rather than restated/);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /clearly differentiated active voices/);
});

test("applyRevisionDirectives reinforces targeted tempo-motion cues from audio evidence", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a miniature whose closing ritardando stays audible.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the close broad enough to read in audio.",
            mood: ["gentle"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.28 },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Close",
                    measures: 4,
                    energy: 0.26,
                    density: 0.22,
                    tempoMotion: [
                        { tag: "ritardando", startMeasure: 4, endMeasure: 4, intensity: 0.56 },
                    ],
                },
            ],
        },
        sectionArtifacts: [
            {
                sectionId: "s2",
                role: "cadence",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                tempoMotionSummary: {
                    requestedTags: ["ritardando"],
                    targetedMeasureCount: 2,
                    realizedMeasureCount: 1,
                    realizedNoteCount: 2,
                    averageDurationScale: 1.03,
                    peakDurationScaleDelta: 0.01,
                    motionDirection: "broaden",
                },
            },
        ],
    }, [
        { kind: "shape_tempo_motion", priority: 86, reason: "Keep the local broadening audible.", sectionIds: ["s2"] },
    ], 2);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.tempoMotion, undefined);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.tempoMotion?.[0]?.tag, "ritardando");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.tempoMotion?.[0]?.startMeasure, 3);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.tempoMotion?.[0]?.endMeasure, 4);
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.tempoMotion?.[0]?.intensity ?? 0) >= 0.74);
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.density ?? 0) > 0.22);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /tempo motion/i);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /note-bearing measures/i);
});

test("applyRevisionDirectives synthesizes targeted fermata repair from audio evidence", () => {
    const revisedRequest = applyRevisionDirectives({
        prompt: "Write a miniature whose closing fermata stays audible.",
        workflow: "symbolic_plus_audio",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the final hold obvious after humanization.",
            mood: ["gentle"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            workflow: "symbolic_plus_audio",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.34, density: 0.28 },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Close",
                    measures: 4,
                    energy: 0.24,
                    density: 0.2,
                },
            ],
        },
        sectionArtifacts: [
            {
                sectionId: "s2",
                role: "cadence",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                ornamentSummary: {
                    sectionId: "s2",
                    requestedTags: ["fermata"],
                    explicitlyRealizedTags: ["fermata"],
                    targetedEventCount: 2,
                    realizedEventCount: 1,
                    realizedNoteCount: 2,
                    averageDurationScale: 1.04,
                    averageTimingJitterScale: 0.98,
                    averageEndingStretchScale: 1.03,
                    peakDurationScaleDelta: 0.01,
                },
            },
        ],
    }, [
        { kind: "shape_ornament_hold", priority: 84, reason: "Keep the local fermata audible.", sectionIds: ["s2"] },
    ], 2);

    assert.equal(revisedRequest.attemptIndex, 2);
    assert.equal(revisedRequest.compositionPlan?.sections[0]?.ornaments, undefined);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.ornaments?.[0]?.tag, "fermata");
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.ornaments?.[0]?.startMeasure, 4);
    assert.equal(revisedRequest.compositionPlan?.sections[1]?.ornaments?.[0]?.endMeasure, 4);
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.ornaments?.[0]?.intensity ?? 0) >= 0.92);
    assert.ok((revisedRequest.compositionPlan?.sections[1]?.density ?? 0) > 0.2);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /fermata/i);
    assert.match(revisedRequest.compositionPlan?.sections[1]?.notes?.join(" | ") ?? "", /note-bearing arrival/i);
});

test("scoreStructureEvaluationForCandidateSelection penalizes weak sections and tension mismatch", () => {
    const stableRank = scoreStructureEvaluationForCandidateSelection({
        passed: true,
        score: 80,
        issues: [],
        strengths: [],
        metrics: {
            cadenceResolved: 1,
            tensionArcMismatch: 0.08,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 78,
                issues: [],
                strengths: ["Stable."],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 81,
                issues: [],
                strengths: ["Stable."],
                metrics: {},
            },
        ],
        weakestSections: [],
    });

    const unstableRank = scoreStructureEvaluationForCandidateSelection({
        passed: true,
        score: 82,
        issues: [],
        strengths: [],
        metrics: {
            cadenceResolved: 1,
            tensionArcMismatch: 0.42,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 80,
                issues: [],
                strengths: ["Stable."],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 55,
                issues: ["Tension arc mismatch", "Section close does not settle convincingly."],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 55,
                issues: ["Tension arc mismatch", "Section close does not settle convincingly."],
                strengths: [],
                metrics: {},
            },
        ],
    });

    assert.ok(stableRank > unstableRank);
});

test("buildStructureRevisionDirectives targets register drift and cadence-approach mismatches from artifact-aware evaluation", () => {
    const directives = buildStructureRevisionDirectives({
        passed: true,
        score: 74,
        issues: [
            "Register planning drifts from the intended section targets.",
            "Bass cadence approach does not match the planned sectional closes.",
        ],
        strengths: [],
        metrics: {
            registerPlanFit: 0.34,
            cadenceApproachPlanFit: 0.12,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 70,
                issues: ["Realized register center drifts from planned register target by 14 semitones."],
                strengths: [],
                metrics: { registerCenterFit: 0.22, registerCenterDrift: 14 },
            },
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 68,
                issues: ["Cadence approach in the bass does not align with the planned close."],
                strengths: [],
                metrics: { cadenceApproachFit: 0.1 },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 68,
                issues: ["Cadence approach in the bass does not align with the planned close."],
                strengths: [],
                metrics: { cadenceApproachFit: 0.1 },
            },
        ],
    }, 80, {
        prompt: "Write a compact sonata with a clearer close.",
        workflow: "symbolic_only",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "Keep the close grounded.",
            mood: ["measured"],
            form: "sonata",
            workflow: "symbolic_only",
            targetDurationSec: 48,
            targetMeasures: 8,
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.42, density: 0.34, registerCenter: 52 },
                { id: "s2", role: "cadence", label: "Close", measures: 4, energy: 0.28, density: 0.24, cadence: "authentic" },
            ],
            rationale: "Keep the final cadence legible.",
        },
    });

    const registerDirective = directives.find((directive) => directive.kind === "expand_register");
    const cadenceDirective = directives.find((directive) => directive.kind === "strengthen_cadence");

    assert.ok(registerDirective);
    assert.deepEqual(registerDirective.sectionIds, ["s1"]);
    assert.ok(cadenceDirective);
    assert.deepEqual(cadenceDirective.sectionIds, ["s2"]);
});

test("scoreStructureEvaluationForCandidateSelection prefers candidates with stronger register and cadence-plan fit", () => {
    const alignedRank = scoreStructureEvaluationForCandidateSelection({
        passed: true,
        score: 79,
        issues: [],
        strengths: [],
        metrics: {
            cadenceResolved: 1,
            tensionArcMismatch: 0.1,
            registerPlanFit: 0.92,
            cadenceApproachPlanFit: 1,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 79,
                issues: [],
                strengths: [],
                metrics: { registerCenterFit: 0.92 },
            },
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 80,
                issues: [],
                strengths: [],
                metrics: { cadenceApproachFit: 1 },
            },
        ],
        weakestSections: [],
    });

    const driftedRank = scoreStructureEvaluationForCandidateSelection({
        passed: true,
        score: 81,
        issues: [
            "Register planning drifts from the intended section targets.",
            "Bass cadence approach does not match the planned sectional closes.",
        ],
        strengths: [],
        metrics: {
            cadenceResolved: 1,
            tensionArcMismatch: 0.1,
            registerPlanFit: 0.34,
            cadenceApproachPlanFit: 0.12,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 70,
                issues: ["Realized register center drifts from planned register target by 14 semitones."],
                strengths: [],
                metrics: { registerCenterFit: 0.22, registerCenterDrift: 14 },
            },
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 69,
                issues: ["Cadence approach in the bass does not align with the planned close."],
                strengths: [],
                metrics: { cadenceApproachFit: 0.1 },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 69,
                issues: ["Cadence approach in the bass does not align with the planned close."],
                strengths: [],
                metrics: { cadenceApproachFit: 0.1 },
            },
        ],
    });

    assert.ok(alignedRank > driftedRank);
});

test("scoreStructureEvaluationForCandidateSelection prefers candidates with stronger string-trio orchestration fit", () => {
    const alignedRank = scoreStructureEvaluationForCandidateSelection({
        passed: true,
        score: 80,
        issues: [],
        strengths: [],
        metrics: {
            orchestrationIdiomaticRangeFit: 0.94,
            orchestrationRegisterBalanceFit: 0.91,
            orchestrationConversationFit: 0.88,
            orchestrationDoublingPressureFit: 0.87,
            orchestrationTextureRotationFit: 0.84,
            orchestrationSectionHandoffFit: 0.86,
        },
        sectionFindings: [],
        weakestSections: [],
    });

    const blurredRank = scoreStructureEvaluationForCandidateSelection({
        passed: true,
        score: 82,
        issues: [
            "String-trio register balance blurs the planned lead, middle, and bass stack.",
            "String-trio conversational sections do not sustain enough independent exchange.",
            "String-trio doubling pressure blurs independent instrument roles across the form.",
            "String-trio texture rotation does not refresh conversation, balance, or spacing states clearly enough across the form.",
        ],
        strengths: [],
        metrics: {
            orchestrationIdiomaticRangeFit: 0.58,
            orchestrationRegisterBalanceFit: 0.34,
            orchestrationConversationFit: 0.29,
            orchestrationDoublingPressureFit: 0.21,
            orchestrationTextureRotationFit: 0.18,
            orchestrationSectionHandoffFit: 0.31,
        },
        sectionFindings: [
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 68,
                issues: [
                    "String-trio register balance collapses and blurs the planned lead, middle, and bass layers.",
                    "String-trio conversational writing does not give the secondary string enough independent answer-like activity.",
                    "String-trio doubling pressure thickens the lead too often and weakens independent instrument roles.",
                    "String-trio texture rotation does not reset conversation, balance, or spacing clearly enough from the previous section.",
                    "String-trio register handoff does not transfer lead, middle, and bass duties clearly enough from the previous section.",
                ],
                strengths: [],
                metrics: {
                    orchestrationRangeFit: 0.58,
                    orchestrationBalanceFit: 0.22,
                    orchestrationConversationFit: 0.18,
                    orchestrationDoublingFit: 0.12,
                    orchestrationTextureRotationFit: 0.2,
                    orchestrationHandoffFit: 0.24,
                },
            },
        ],
        weakestSections: [],
    });

    assert.ok(alignedRank > blurredRank);
});

test("compareStructureEvaluationsForCandidateSelection breaks near ties with section stability", () => {
    const stable = {
        passed: true,
        score: 82,
        issues: [],
        strengths: [],
        metrics: {
            cadenceResolved: 1,
            tensionArcMismatch: 0.1,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 88,
                issues: [],
                strengths: ["Stable."],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 88,
                issues: [],
                strengths: ["Stable."],
                metrics: {},
            },
        ],
        weakestSections: [],
    };

    const uneven = {
        passed: true,
        score: 82.05,
        issues: [],
        strengths: [],
        metrics: {
            cadenceResolved: 1,
            tensionArcMismatch: 0.1,
        },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 96,
                issues: [],
                strengths: ["Bright but uneven."],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Development",
                role: "development",
                startMeasure: 5,
                endMeasure: 8,
                score: 80,
                issues: ["The section handoff is less stable than the opening."],
                strengths: [],
                metrics: {},
            },
        ],
        weakestSections: [],
    };

    const stableRank = scoreStructureEvaluationForCandidateSelection(stable);
    const unevenRank = scoreStructureEvaluationForCandidateSelection(uneven);

    assert.ok(unevenRank > stableRank);
    assert.ok(compareStructureCandidates(stable, uneven) > 0);
    assert.ok(compareStructureCandidates(uneven, stable) < 0);
});