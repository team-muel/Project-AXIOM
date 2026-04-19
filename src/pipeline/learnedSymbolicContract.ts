import type {
    ComposeRequest,
    ComposeWorkflow,
    CompositionPlan,
    InstrumentAssignment,
    OrchestrationPlan,
    OrchestrationSectionPlan,
} from "./types.js";

export const LEARNED_SYMBOLIC_PROMPT_PACK_VERSION = "learned_symbolic_prompt_pack_v1";
export const STRING_TRIO_SYMBOLIC_LANE = "string_trio_symbolic";
export const STRING_TRIO_SYMBOLIC_BENCHMARK_PACK_VERSION = "string_trio_symbolic_benchmark_pack_v1";
export const APPROVAL_REVIEW_RUBRIC_VERSION = "approval_review_rubric_v1";

export type LearnedBenchmarkRequest = Pick<
    ComposeRequest,
    "prompt" | "key" | "tempo" | "form" | "workflow" | "compositionPlan" | "targetInstrumentation"
>;

export interface FixedBenchmarkPackEntry {
    benchmarkId: string;
    request: LearnedBenchmarkRequest;
    coverageTags: string[];
}

export interface FixedBenchmarkPackDefinition {
    version: string;
    lane: string;
    promptPackVersion: string;
    reviewRubricVersion: string;
    canonicalWorkflows: ComposeWorkflow[];
    entries: FixedBenchmarkPackEntry[];
}

export interface FixedReviewRubricDefinition {
    version: string;
    appealScoreRange: {
        min: number;
        max: number;
    };
    requiredSignals: string[];
    recommendedSignals: string[];
    decisionRules: string[];
}

const STRING_TRIO_INSTRUMENTATION: InstrumentAssignment[] = [
    { name: "Violin", family: "strings", roles: ["lead"] },
    { name: "Viola", family: "strings", roles: ["inner_voice"] },
    { name: "Cello", family: "strings", roles: ["bass"] },
];

function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function buildStringTrioOrchestration(sections: OrchestrationSectionPlan[]): OrchestrationPlan {
    return {
        family: "string_trio",
        instrumentNames: STRING_TRIO_INSTRUMENTATION.map((entry) => entry.name),
        sections,
    };
}

function buildStringTrioPlan(
    plan: Omit<CompositionPlan, "instrumentation" | "motifPolicy" | "orchestration"> & {
        orchestrationSections: OrchestrationSectionPlan[];
    },
): CompositionPlan {
    const { orchestrationSections, ...basePlan } = plan;

    return {
        ...basePlan,
        instrumentation: cloneJsonValue(STRING_TRIO_INSTRUMENTATION),
        motifPolicy: {
            reuseRequired: true,
            inversionAllowed: false,
            augmentationAllowed: false,
            diminutionAllowed: false,
            sequenceAllowed: false,
        },
        orchestration: buildStringTrioOrchestration(orchestrationSections),
    };
}

function buildBenchmarkRequest(request: LearnedBenchmarkRequest): LearnedBenchmarkRequest {
    return {
        ...request,
        compositionPlan: request.compositionPlan ? cloneJsonValue(request.compositionPlan) : undefined,
        targetInstrumentation: request.targetInstrumentation ? cloneJsonValue(request.targetInstrumentation) : undefined,
    };
}

export const FIXED_APPROVAL_REVIEW_RUBRIC: FixedReviewRubricDefinition = {
    version: APPROVAL_REVIEW_RUBRIC_VERSION,
    appealScoreRange: {
        min: 0,
        max: 10,
    },
    requiredSignals: [
        "decision",
        "note_or_reason",
    ],
    recommendedSignals: [
        "appealScore",
        "strongestDimension",
        "weakestDimension",
        "comparisonReference",
    ],
    decisionRules: [
        "Apply the same 0-10 appeal scale across benchmark and promotion reviews.",
        "Approve or reject only after consulting persisted manifest and candidate evidence.",
        "Capture strongest and weakest musical dimensions when they are identifiable.",
        "Add a comparison reference whenever the decision depends on a concrete counterfactual.",
    ],
};

export const FIXED_STRING_TRIO_SYMBOLIC_BENCHMARK_PACK: FixedBenchmarkPackDefinition = {
    version: STRING_TRIO_SYMBOLIC_BENCHMARK_PACK_VERSION,
    lane: STRING_TRIO_SYMBOLIC_LANE,
    promptPackVersion: LEARNED_SYMBOLIC_PROMPT_PACK_VERSION,
    reviewRubricVersion: APPROVAL_REVIEW_RUBRIC_VERSION,
    canonicalWorkflows: ["symbolic_only", "symbolic_plus_audio"],
    entries: [
        {
            benchmarkId: "cadence_clarity_reference",
            coverageTags: ["paired_baseline_reference", "approval_gate", "audio_confirmation"],
            request: buildBenchmarkRequest({
                prompt: "Compose a compact string trio miniature with a calm opening and a clear cadence.",
                key: "D minor",
                tempo: 88,
                form: "miniature",
                workflow: "symbolic_only",
                compositionPlan: buildStringTrioPlan({
                    version: "plan-v1",
                    brief: "string trio miniature",
                    mood: [],
                    form: "miniature",
                    key: "D minor",
                    tempo: 88,
                    workflow: "symbolic_only",
                    sections: [
                        {
                            id: "s1",
                            role: "theme_a",
                            label: "Opening",
                            measures: 4,
                            energy: 0.34,
                            density: 0.3,
                            phraseFunction: "presentation",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "half",
                                allowModulation: false,
                            },
                        },
                        {
                            id: "s2",
                            role: "cadence",
                            label: "Cadence",
                            measures: 4,
                            energy: 0.42,
                            density: 0.32,
                            phraseFunction: "cadential",
                            harmonicPlan: {
                                tonalCenter: "D minor",
                                harmonicRhythm: "medium",
                                cadence: "authentic",
                                allowModulation: false,
                            },
                        },
                    ],
                    rationale: "narrow learned symbolic lane",
                    orchestrationSections: [],
                }),
                targetInstrumentation: cloneJsonValue(STRING_TRIO_INSTRUMENTATION),
            }),
        },
        {
            benchmarkId: "counterline_dialogue_probe",
            coverageTags: ["candidate_group_probe", "counterline_dialogue", "search_budget"],
            request: buildBenchmarkRequest({
                prompt: "Compose a compact string trio miniature with clear phrase contrast and active counterline dialogue.",
                key: "G minor",
                tempo: 96,
                form: "miniature",
                workflow: "symbolic_only",
                compositionPlan: buildStringTrioPlan({
                    version: "benchmark-pack-v1",
                    brief: "dialogic string trio miniature",
                    mood: ["restless", "conversational"],
                    form: "miniature",
                    intentRationale: "Search-budget probe for shortlist quality under conversational trio writing.",
                    humanizationStyle: "expressive",
                    key: "G minor",
                    tempo: 96,
                    workflow: "symbolic_only",
                    sections: [
                        {
                            id: "s1",
                            role: "theme_a",
                            label: "Statement",
                            measures: 4,
                            energy: 0.38,
                            density: 0.34,
                            phraseFunction: "presentation",
                            harmonicPlan: {
                                tonalCenter: "G minor",
                                harmonicRhythm: "medium",
                                cadence: "half",
                                allowModulation: false,
                            },
                            texture: {
                                primaryRoles: ["lead", "counterline", "bass"],
                                counterpointMode: "contrary_motion",
                            },
                        },
                        {
                            id: "s2",
                            role: "bridge",
                            label: "Dialogue",
                            measures: 4,
                            energy: 0.55,
                            density: 0.41,
                            phraseFunction: "transition",
                            harmonicPlan: {
                                tonalCenter: "B-flat major",
                                keyTarget: "B-flat major",
                                harmonicRhythm: "fast",
                                cadence: "half",
                                allowModulation: true,
                            },
                            texture: {
                                primaryRoles: ["lead", "counterline", "bass"],
                                counterpointMode: "free",
                            },
                        },
                        {
                            id: "s3",
                            role: "cadence",
                            label: "Return",
                            measures: 4,
                            energy: 0.48,
                            density: 0.35,
                            phraseFunction: "cadential",
                            harmonicPlan: {
                                tonalCenter: "G minor",
                                harmonicRhythm: "medium",
                                cadence: "authentic",
                                allowModulation: false,
                            },
                            texture: {
                                primaryRoles: ["lead", "counterline", "bass"],
                                counterpointMode: "contrary_motion",
                            },
                        },
                    ],
                    rationale: "counterline dialogue benchmark",
                    orchestrationSections: [
                        {
                            sectionId: "s1",
                            leadInstrument: "Violin",
                            secondaryInstrument: "Viola",
                            bassInstrument: "Cello",
                            conversationMode: "support",
                            balanceProfile: "lead_forward",
                            registerLayout: "layered",
                        },
                        {
                            sectionId: "s2",
                            leadInstrument: "Viola",
                            secondaryInstrument: "Violin",
                            bassInstrument: "Cello",
                            conversationMode: "conversational",
                            balanceProfile: "balanced",
                            registerLayout: "wide",
                        },
                        {
                            sectionId: "s3",
                            leadInstrument: "Violin",
                            secondaryInstrument: "Viola",
                            bassInstrument: "Cello",
                            conversationMode: "support",
                            balanceProfile: "lead_forward",
                            registerLayout: "layered",
                        },
                    ],
                }),
                targetInstrumentation: cloneJsonValue(STRING_TRIO_INSTRUMENTATION),
            }),
        },
        {
            benchmarkId: "localized_rewrite_probe",
            coverageTags: ["localized_retry_probe", "harmonic_color", "promotion_review"],
            request: buildBenchmarkRequest({
                prompt: "Compose a compact string trio miniature with a coloristic cadence and a repairable middle section.",
                key: "C major",
                tempo: 92,
                form: "miniature",
                workflow: "symbolic_only",
                compositionPlan: buildStringTrioPlan({
                    version: "benchmark-pack-v1",
                    brief: "repair-oriented string trio miniature",
                    mood: ["lyric", "coloristic"],
                    form: "miniature",
                    intentRationale: "Localized rewrite probe for weak-section repair without whole-piece drift.",
                    humanizationStyle: "restrained",
                    key: "C major",
                    tempo: 92,
                    workflow: "symbolic_only",
                    sections: [
                        {
                            id: "s1",
                            role: "theme_a",
                            label: "Opening",
                            measures: 4,
                            energy: 0.3,
                            density: 0.28,
                            phraseFunction: "presentation",
                            harmonicPlan: {
                                tonalCenter: "C major",
                                harmonicRhythm: "medium",
                                cadence: "half",
                                allowModulation: false,
                            },
                            texture: {
                                primaryRoles: ["lead", "counterline", "bass"],
                                counterpointMode: "none",
                            },
                        },
                        {
                            id: "s2",
                            role: "bridge",
                            label: "Coloristic Turn",
                            measures: 4,
                            energy: 0.44,
                            density: 0.39,
                            phraseFunction: "transition",
                            harmonicPlan: {
                                tonalCenter: "A minor",
                                harmonicRhythm: "medium",
                                cadence: "deceptive",
                                allowModulation: true,
                                colorCues: [
                                    {
                                        tag: "predominant_color",
                                        startMeasure: 5,
                                        endMeasure: 6,
                                        keyTarget: "A minor",
                                    },
                                ],
                            },
                            texture: {
                                primaryRoles: ["lead", "counterline", "bass"],
                                counterpointMode: "free",
                            },
                        },
                        {
                            id: "s3",
                            role: "cadence",
                            label: "Cadence",
                            measures: 4,
                            energy: 0.5,
                            density: 0.33,
                            phraseFunction: "cadential",
                            phraseBreath: {
                                arrivalMeasure: 12,
                                releaseStartMeasure: 12,
                            },
                            harmonicPlan: {
                                tonalCenter: "C major",
                                harmonicRhythm: "medium",
                                cadence: "authentic",
                                allowModulation: false,
                                colorCues: [
                                    {
                                        tag: "mixture",
                                        startMeasure: 11,
                                        endMeasure: 11,
                                        keyTarget: "C minor",
                                    },
                                ],
                            },
                            texture: {
                                primaryRoles: ["lead", "counterline", "bass"],
                                counterpointMode: "contrary_motion",
                            },
                        },
                    ],
                    rationale: "localized rewrite benchmark",
                    orchestrationSections: [
                        {
                            sectionId: "s1",
                            leadInstrument: "Violin",
                            secondaryInstrument: "Viola",
                            bassInstrument: "Cello",
                            conversationMode: "support",
                            balanceProfile: "lead_forward",
                            registerLayout: "layered",
                        },
                        {
                            sectionId: "s2",
                            leadInstrument: "Viola",
                            secondaryInstrument: "Violin",
                            bassInstrument: "Cello",
                            conversationMode: "conversational",
                            balanceProfile: "balanced",
                            registerLayout: "wide",
                        },
                        {
                            sectionId: "s3",
                            leadInstrument: "Violin",
                            secondaryInstrument: "Viola",
                            bassInstrument: "Cello",
                            conversationMode: "support",
                            balanceProfile: "lead_forward",
                            registerLayout: "layered",
                        },
                    ],
                }),
                targetInstrumentation: cloneJsonValue(STRING_TRIO_INSTRUMENTATION),
            }),
        },
    ],
};