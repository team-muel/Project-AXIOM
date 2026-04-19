import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeEval, parseLastJsonLine } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function createPlannerResponse(overrides = {}) {
    const base = {
        request: {
            prompt: "Write a restrained chamber nocturne with a soft opening violin phrase.",
            key: "D minor",
            tempo: 68,
            form: "nocturne",
            durationSec: 95,
            workflow: "symbolic_plus_audio",
            plannerVersion: "planner-schema-v2",
        },
        plan: {
            version: "planner-schema-v2",
            titleHint: "Night Window",
            brief: "A chamber nocturne with a fragile opening and a warmer closing cadence.",
            mood: ["intimate", "fragile", "lyrical"],
            form: "nocturne",
            inspirationThread: "Refine soft-edged cadences without losing melodic direction.",
            intentRationale: "Recent pieces closed too squarely, so this plan hides the cadence until the end.",
            contrastTarget: "Stay more interior and chamber-like than the recent brighter drafts.",
            riskProfile: "exploratory",
            structureVisibility: "hidden",
            humanizationStyle: "restrained",
            targetDurationSec: 95,
            targetMeasures: 24,
            meter: "4/4",
            key: "D minor",
            tempo: 68,
            workflow: "symbolic_plus_audio",
            instrumentation: [
                { name: "violin", family: "strings", roles: ["lead"], register: "high" },
                { name: "piano", family: "keyboard", roles: ["pad", "pulse"], register: "wide" },
            ],
            expressionDefaults: {
                dynamics: {
                    start: "pp",
                    peak: "mf",
                    end: "p",
                    hairpins: [{ shape: "crescendo", startMeasure: 1, endMeasure: 4, target: "mf" }],
                },
                articulation: ["legato", "tenuto"],
                character: ["dolce", "tranquillo"],
            },
            motifPolicy: {
                reuseRequired: true,
                inversionAllowed: true,
                augmentationAllowed: true,
                diminutionAllowed: false,
                sequenceAllowed: true,
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening idea",
                    measures: 8,
                    energy: 0.3,
                    density: 0.3,
                    cadence: "half",
                    expression: {
                        articulation: ["tenuto"],
                        character: ["cantabile", "grazioso"],
                        phrasePeaks: [4],
                    },
                    notes: ["Introduce the main motif."],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Quiet close",
                    measures: 8,
                    energy: 0.25,
                    density: 0.25,
                    cadence: "authentic",
                    motifRef: "s1",
                    notes: ["Close quietly with a clear cadence."],
                },
            ],
            rationale: "Recent output lacked section contrast, so this plan reuses one motif and closes more clearly.",
        },
        selectedModels: [
            { role: "planner", provider: "ollama", model: "gemma4:latest" },
            { role: "structure", provider: "python", model: "music21-symbolic-v1" },
            { role: "audio_renderer", provider: "transformers", model: "facebook/musicgen-large" },
        ],
        rationale: "Use symbolic control for form, then allow optional audio rendering for timbre.",
        inspirationSnapshot: [
            "Recent runs lacked a strong closing cadence.",
            "A quieter chamber texture fits recent preference history.",
        ],
    };

    return {
        ...base,
        ...overrides,
        request: {
            ...base.request,
            ...(overrides.request ?? {}),
        },
        plan: {
            ...base.plan,
            ...(overrides.plan ?? {}),
        },
        selectedModels: overrides.selectedModels ?? base.selectedModels,
        inspirationSnapshot: overrides.inspirationSnapshot ?? base.inspirationSnapshot,
    };
}

async function runPlannerScenario(evalCode, plannerResponse = createPlannerResponse()) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-planner-test-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    const systemDir = path.join(outputDir, "_system");

    fs.mkdirSync(systemDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, "runtime.jsonl"), "", "utf-8");

    const plannerResponses = Array.isArray(plannerResponse) ? plannerResponse : [plannerResponse];
    const plannerResponsesJson = JSON.stringify(plannerResponses);
    const { stdout } = await runNodeEval(`
        const plannerResponses = ${JSON.stringify(plannerResponsesJson)};
        let plannerResponseIndex = 0;
        globalThis.fetch = async (url) => {
            if (String(url).includes("/api/tags")) {
                return { ok: true, status: 200, json: async () => ({ models: [] }) };
            }
            if (String(url).includes("/api/generate")) {
                const parsedResponses = JSON.parse(plannerResponses);
                const nextResponse = parsedResponses[Math.min(plannerResponseIndex, parsedResponses.length - 1)];
                plannerResponseIndex += 1;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ model: "gemma4:latest", response: JSON.stringify(nextResponse) }),
                };
            }
            throw new Error("Unexpected fetch: " + url);
        };
        const { setLogStream } = await import("./dist/logging/logger.js");
        setLogStream("stderr");
        ${evalCode}
    `, {
        cwd: repoRoot,
        env: {
            OUTPUT_DIR: outputDir,
            LOG_DIR: logDir,
            OLLAMA_URL: "http://127.0.0.1:11434",
            AUTONOMY_ENABLED: "true",
            AUTONOMY_SCHEDULER_TIMEZONE: "Asia/Seoul",
            AUTONOMY_MAX_ATTEMPTS_PER_DAY: "3",
            MAX_RETRIES: "0",
            RETRY_BACKOFF_MS: "0",
            PYTHON_BIN: "python-does-not-exist",
            LOG_LEVEL: "error",
        },
    });

    const result = parseLastJsonLine(stdout);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return result;
}

test("previewAutonomyPlan exposes planner plan summary", async () => {
    const result = await runPlannerScenario(`
        const { getAutonomyDayKey } = await import("./dist/autonomy/calendar.js");
        const { loadAutonomyRunLedger } = await import("./dist/memory/manifest.js");
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        const ledgerEntry = loadAutonomyRunLedger(getAutonomyDayKey()).at(-1);
        console.log(JSON.stringify({
            workflow: plan.request.workflow,
            sectionCount: plan.planSummary?.sectionCount,
            totalMeasures: plan.planSummary?.totalMeasures,
            instruments: plan.planSummary?.instruments,
            selectedModels: plan.planSummary?.selectedModels,
            qualityProfile: plan.planSummary?.qualityProfile,
            qualityPolicy: plan.planSummary?.qualityPolicy,
            requestQualityPolicy: plan.request.qualityPolicy,
            inspirationThread: plan.planSummary?.inspirationThread,
            intentRationale: plan.planSummary?.intentRationale,
            contrastTarget: plan.planSummary?.contrastTarget,
            riskProfile: plan.planSummary?.riskProfile,
            structureVisibility: plan.planSummary?.structureVisibility,
            humanizationStyle: plan.planSummary?.humanizationStyle,
            noveltySummary: plan.noveltySummary,
            candidateSelection: plan.candidateSelection,
            plannerTelemetry: plan.request.plannerTelemetry,
            ledgerEntry,
        }));
    `);

    assert.equal(result.workflow, "symbolic_plus_audio");
    assert.equal(result.sectionCount, 2);
    assert.equal(result.totalMeasures, 16);
    assert.deepEqual(result.instruments, ["violin", "piano"]);
    assert.match(result.selectedModels.join(" | "), /audio_renderer:transformers:facebook\/musicgen-large/);
    assert.equal(result.qualityProfile, "lyric_short_form");
    assert.equal(result.qualityPolicy.targetStructureScore, 76);
    assert.equal(result.qualityPolicy.targetAudioScore, 80);
    assert.equal(result.requestQualityPolicy.maxStructureAttempts, 3);
    assert.match(result.inspirationThread, /cadences/i);
    assert.match(result.intentRationale, /squarely/i);
    assert.equal(result.riskProfile, "exploratory");
    assert.equal(result.structureVisibility, "hidden");
    assert.equal(result.humanizationStyle, "restrained");
    assert.match(result.noveltySummary.planSignature, /form=nocturne/);
    assert.equal(result.noveltySummary.noveltyScore, 1);
    assert.equal(result.noveltySummary.comparisonCount, 0);
    assert.equal(result.noveltySummary.exactMatch, false);
    assert.equal(result.candidateSelection.strategy, "novelty_plus_plan_completeness_v1");
    assert.equal(result.candidateSelection.candidateCount, 3);
    assert.equal(result.candidateSelection.selectedIndex, 0);
    assert.equal(result.plannerTelemetry.selectedCandidateId, result.candidateSelection.selectedCandidateId);
    assert.equal(result.plannerTelemetry.selectionStrategy, result.candidateSelection.strategy);
    assert.equal(result.plannerTelemetry.parserMode, result.candidateSelection.candidates[0].parserMode);
    assert.equal(result.ledgerEntry.plannerTelemetry.selectedCandidateId, result.candidateSelection.selectedCandidateId);
    assert.equal(result.ledgerEntry.plannerTelemetry.planSignature, result.noveltySummary.planSignature);
    assert.equal(result.ledgerEntry.plannerTelemetry.noveltyScore, result.noveltySummary.noveltyScore);
});

test("previewAutonomyPlan preserves extended expression vocabulary from planner output", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            defaultsArticulation: plan.request.compositionPlan?.expressionDefaults?.articulation,
            defaultsCharacter: plan.request.compositionPlan?.expressionDefaults?.character,
            openingArticulation: plan.request.compositionPlan?.sections[0]?.expression?.articulation,
            openingCharacter: plan.request.compositionPlan?.sections[0]?.expression?.character,
        }));
    `, createPlannerResponse({
        plan: {
            expressionDefaults: {
                dynamics: { start: "pp", peak: "mf", end: "p" },
                articulation: ["legato", "sostenuto"],
                character: ["dolce", "tranquillo", "delicato"],
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening idea",
                    measures: 8,
                    energy: 0.3,
                    density: 0.3,
                    cadence: "half",
                    expression: {
                        articulation: ["tenuto", "marcato"],
                        character: ["cantabile", "grazioso"],
                    },
                    notes: ["Introduce the main motif."],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Quiet close",
                    measures: 8,
                    energy: 0.25,
                    density: 0.25,
                    cadence: "authentic",
                    motifRef: "s1",
                    notes: ["Close quietly with a clear cadence."],
                },
            ],
        },
    }));

    assert.deepEqual(result.defaultsArticulation, ["legato", "sostenuto"]);
    assert.deepEqual(result.defaultsCharacter, ["dolce", "tranquillo", "delicato"]);
    assert.deepEqual(result.openingArticulation, ["tenuto", "marcato"]);
    assert.deepEqual(result.openingCharacter, ["cantabile", "grazioso"]);
});

test("previewAutonomyPlan preserves planner-requested candidateCount for Stage B search budgets", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            candidateCount: plan.request.candidateCount,
            localizedRewriteBranches: plan.request.localizedRewriteBranches,
            promptHash: plan.request.promptHash,
        }));
    `, createPlannerResponse({
        request: {
            candidateCount: 8,
            localizedRewriteBranches: 2,
        },
    }));

    assert.equal(result.candidateCount, 8);
    assert.equal(result.localizedRewriteBranches, 2);
    assert.match(result.promptHash, /^[0-9a-f]{16}$/);
});

test("previewAutonomyPlan preserves phrase-breath contract from planner output", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            openingPhraseBreath: plan.request.compositionPlan?.sections[0]?.phraseBreath,
        }));
    `, createPlannerResponse({
        plan: {
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening idea",
                    measures: 8,
                    energy: 0.3,
                    density: 0.3,
                    cadence: "half",
                    phraseBreath: {
                        pickupStartMeasure: 1,
                        pickupEndMeasure: 2,
                        arrivalMeasure: 3,
                        releaseStartMeasure: 3,
                        releaseEndMeasure: 4,
                        cadenceRecoveryStartMeasure: 7,
                        cadenceRecoveryEndMeasure: 8,
                        rubatoAnchors: [2, 4],
                        notes: ["Broaden into the arrival and release gently."],
                    },
                    notes: ["Introduce the main motif."],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Quiet close",
                    measures: 8,
                    energy: 0.25,
                    density: 0.25,
                    cadence: "authentic",
                    motifRef: "s1",
                    notes: ["Close quietly with a clear cadence."],
                },
            ],
        },
    }));

    assert.equal(result.openingPhraseBreath.pickupStartMeasure, 1);
    assert.equal(result.openingPhraseBreath.arrivalMeasure, 3);
    assert.deepEqual(result.openingPhraseBreath.rubatoAnchors, [2, 4]);
});

test("previewAutonomyPlan preserves harmonic deepening contract from planner output", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            openingHarmonicPlan: plan.request.compositionPlan?.sections[0]?.harmonicPlan,
        }));
    `, createPlannerResponse({
        plan: {
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening idea",
                    measures: 8,
                    energy: 0.3,
                    density: 0.3,
                    cadence: "half",
                    harmonicPlan: {
                        tonalCenter: "C minor",
                        harmonicRhythm: "medium",
                        prolongationMode: "pedal",
                        tonicizationWindows: [
                            { startMeasure: 5, endMeasure: 6, keyTarget: "G minor", emphasis: "prepared", cadence: "half" },
                        ],
                        colorCues: [
                            { tag: "mixture", startMeasure: 3, endMeasure: 4, notes: ["Borrow the brighter color briefly."] },
                            { tag: "applied dominant", startMeasure: 5, endMeasure: 6, keyTarget: "G minor" },
                            { tag: "suspension", startMeasure: 7, resolutionMeasure: 8 },
                        ],
                    },
                    notes: ["Introduce the main motif."],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Quiet close",
                    measures: 8,
                    energy: 0.25,
                    density: 0.25,
                    cadence: "authentic",
                    motifRef: "s1",
                    notes: ["Close quietly with a clear cadence."],
                },
            ],
        },
    }));

    assert.equal(result.openingHarmonicPlan.prolongationMode, "pedal");
    assert.equal(result.openingHarmonicPlan.tonicizationWindows[0].keyTarget, "G minor");
    assert.equal(result.openingHarmonicPlan.tonicizationWindows[0].emphasis, "prepared");
    assert.equal(result.openingHarmonicPlan.colorCues[0].tag, "mixture");
    assert.equal(result.openingHarmonicPlan.colorCues[1].tag, "applied_dominant");
    assert.equal(result.openingHarmonicPlan.colorCues[1].keyTarget, "G minor");
    assert.equal(result.openingHarmonicPlan.colorCues[2].resolutionMeasure, 8);
});

test("previewAutonomyPlan preserves long-span form contract from planner output", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            longSpanForm: plan.request.compositionPlan?.longSpanForm,
            longSpanSummary: plan.planSummary?.longSpan,
        }));
    `, createPlannerResponse({
        request: {
            prompt: "Write a compact piano sonata with a delayed but inevitable return.",
            key: "C major",
            tempo: 108,
            form: "sonata",
            durationSec: 120,
            workflow: "symbolic_only",
        },
        plan: {
            brief: "A compact sonata with explicit long-range return planning.",
            form: "sonata",
            targetDurationSec: 120,
            targetMeasures: 32,
            key: "C major",
            tempo: 108,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" },
            ],
            longSpanForm: {
                expositionStartSectionId: "s1",
                expositionEndSectionId: "s2",
                developmentStartSectionId: "s3",
                developmentEndSectionId: "s3",
                retransitionSectionId: "s3",
                recapStartSectionId: "s4",
                returnSectionId: "s4",
                delayedPayoffSectionId: "s4",
                expectedDevelopmentPressure: "high",
                expectedReturnPayoff: "inevitable",
                thematicCheckpoints: [
                    {
                        id: "checkpoint-1",
                        sourceSectionId: "s1",
                        targetSectionId: "s3",
                        transform: "fragment",
                        expectedProminence: 0.7,
                        preserveIdentity: true,
                        notes: ["Break the theme apart before the return."],
                    },
                    {
                        sourceSectionId: "s1",
                        targetSectionId: "s4",
                        transform: "delay_return",
                        expectedProminence: 0.95,
                    },
                ],
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening theme",
                    measures: 8,
                    energy: 0.42,
                    density: 0.36,
                    cadence: "half",
                },
                {
                    id: "s2",
                    role: "theme_b",
                    label: "Contrast",
                    measures: 8,
                    energy: 0.5,
                    density: 0.42,
                    cadence: "half",
                },
                {
                    id: "s3",
                    role: "development",
                    label: "Development",
                    measures: 8,
                    energy: 0.72,
                    density: 0.58,
                    cadence: "half",
                },
                {
                    id: "s4",
                    role: "recap",
                    label: "Recap",
                    measures: 8,
                    energy: 0.34,
                    density: 0.3,
                    motifRef: "s1",
                    cadence: "authentic",
                },
            ],
            rationale: "Keep the return delayed until the recap can land decisively.",
        },
    }));

    assert.equal(result.longSpanForm.expositionStartSectionId, "s1");
    assert.equal(result.longSpanForm.recapStartSectionId, "s4");
    assert.equal(result.longSpanForm.expectedDevelopmentPressure, "high");
    assert.equal(result.longSpanForm.expectedReturnPayoff, "inevitable");
    assert.equal(result.longSpanForm.thematicCheckpoints[0].transform, "fragment");
    assert.equal(result.longSpanForm.thematicCheckpoints[0].preserveIdentity, true);
    assert.equal(result.longSpanForm.thematicCheckpoints[1].transform, "delay_return");
    assert.equal(result.longSpanSummary.expositionStartSectionId, "s1");
    assert.equal(result.longSpanSummary.recapStartSectionId, "s4");
    assert.equal(result.longSpanSummary.expectedDevelopmentPressure, "high");
    assert.equal(result.longSpanSummary.expectedReturnPayoff, "inevitable");
    assert.equal(result.longSpanSummary.thematicCheckpointCount, 2);
    assert.deepEqual(result.longSpanSummary.thematicTransforms, ["fragment", "delay_return"]);
});

test("previewAutonomyPlan derives string-trio orchestration summary from planner output", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            orchestration: plan.request.compositionPlan?.orchestration,
            orchestrationSummary: plan.planSummary?.orchestration,
        }));
    `, createPlannerResponse({
        request: {
            prompt: "Write a compact string trio with a conversational opening and a softer cadence.",
            key: "D minor",
            tempo: 76,
            form: "miniature",
            durationSec: 72,
            workflow: "symbolic_only",
        },
        plan: {
            brief: "A compact string trio with a layered opening and restrained close.",
            form: "miniature",
            targetDurationSec: 72,
            targetMeasures: 16,
            key: "D minor",
            tempo: 76,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "violin", family: "strings", roles: ["lead"], register: "high" },
                { name: "viola", family: "strings", roles: ["inner_voice"], register: "mid" },
                { name: "cello", family: "strings", roles: ["bass"], register: "low" },
            ],
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
                    measures: 8,
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
                    measures: 8,
                    energy: 0.24,
                    density: 0.22,
                    texture: {
                        voiceCount: 2,
                        primaryRoles: ["lead", "bass"],
                        counterpointMode: "none",
                    },
                },
            ],
            rationale: "Keep violin, viola, and cello layered instead of generic accompaniment.",
        },
    }));

    assert.equal(result.orchestration.family, "string_trio");
    assert.deepEqual(result.orchestration.instrumentNames, ["violin", "viola", "cello"]);
    assert.equal(result.orchestration.sections[0].conversationMode, "conversational");
    assert.equal(result.orchestration.sections[1].conversationMode, "support");
    assert.equal(result.orchestrationSummary.family, "string_trio");
    assert.equal(result.orchestrationSummary.sectionCount, 2);
    assert.deepEqual(result.orchestrationSummary.conversationModes, ["conversational", "support"]);
    assert.deepEqual(result.orchestrationSummary.balanceProfiles, ["balanced", "lead_forward"]);
});

test("previewAutonomyPlan preserves tempo-motion vocabulary from planner output", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            defaultsTempoMotion: plan.request.compositionPlan?.tempoMotionDefaults,
            openingTempoMotion: plan.request.compositionPlan?.sections[0]?.tempoMotion,
        }));
    `, createPlannerResponse({
        plan: {
            tempoMotionDefaults: [
                { tag: "ritardando", startMeasure: 13, endMeasure: 16, intensity: 0.6 },
            ],
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening idea",
                    measures: 8,
                    energy: 0.3,
                    density: 0.3,
                    cadence: "half",
                    expression: {
                        articulation: ["tenuto"],
                        character: ["cantabile"],
                        phrasePeaks: [4],
                    },
                    tempoMotion: [
                        { tag: "a tempo", startMeasure: 8, endMeasure: 8 },
                    ],
                    notes: ["Introduce the main motif."],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Quiet close",
                    measures: 8,
                    energy: 0.25,
                    density: 0.25,
                    cadence: "authentic",
                    motifRef: "s1",
                    tempoMotion: [
                        { tag: "ritenuto", intensity: 0.7 },
                    ],
                    notes: ["Close quietly with a clear cadence."],
                },
            ],
        },
    }));

    assert.equal(result.defaultsTempoMotion[0].tag, "ritardando");
    assert.equal(result.defaultsTempoMotion[0].intensity, 0.6);
    assert.equal(result.openingTempoMotion[0].tag, "a_tempo");
    assert.equal(result.openingTempoMotion[0].startMeasure, 8);
});

test("previewAutonomyPlan preserves ornament vocabulary from planner output", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            defaultsOrnaments: plan.request.compositionPlan?.ornamentDefaults,
            openingOrnaments: plan.request.compositionPlan?.sections[0]?.ornaments,
        }));
    `, createPlannerResponse({
        plan: {
            ornamentDefaults: [
                { tag: "fermata", startMeasure: 16, targetBeat: 4, intensity: 0.8 },
            ],
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening idea",
                    measures: 8,
                    energy: 0.3,
                    density: 0.3,
                    cadence: "half",
                    ornaments: [
                        { tag: "fermata", startMeasure: 8, targetBeat: 4, intensity: 0.7 },
                    ],
                    notes: ["Introduce the main motif."],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Quiet close",
                    measures: 8,
                    energy: 0.25,
                    density: 0.25,
                    cadence: "authentic",
                    motifRef: "s1",
                    notes: ["Close quietly with a clear cadence."],
                },
            ],
        },
    }));

    assert.equal(result.defaultsOrnaments[0].tag, "fermata");
    assert.equal(result.defaultsOrnaments[0].targetBeat, 4);
    assert.equal(result.openingOrnaments[0].tag, "fermata");
    assert.equal(result.openingOrnaments[0].startMeasure, 8);
});

test("previewAutonomyPlan selects the strongest candidate across novelty and completeness", async () => {
    const result = await runPlannerScenario(`
        const { saveAutonomyPreferences } = await import("./dist/memory/manifest.js");
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");

        saveAutonomyPreferences({
            updatedAt: "2026-04-10T00:00:00.000Z",
            reviewedSongs: 4,
            preferredForms: ["nocturne"],
            preferredKeys: ["D minor"],
            recentWeaknesses: ["middle section drifts without a clear contrast target"],
            recentPromptHashes: [],
            recentPlanSignatures: [
                "form=nocturne|key=d minor|meter=4/4|inst=piano+violin|roles=theme_a>cadence|human=restrained",
                "form=nocturne|key=d minor|meter=4/4|inst=piano|roles=theme_a>cadence|human=restrained"
            ],
            successPatterns: [],
            skillGaps: [],
            styleTendency: {},
            successfulMotifReturns: [],
            successfulTensionArcs: [],
            successfulRegisterCenters: [],
            successfulCadenceApproaches: [],
            successfulBassMotionProfiles: [],
            successfulSectionStyles: [],
            lastReflection: "push harder on section contrast",
        });

        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            form: plan.request.form,
            key: plan.request.key,
            candidateSelection: plan.candidateSelection,
            noveltySummary: plan.noveltySummary,
        }));
    `, [
        createPlannerResponse(),
        createPlannerResponse({
            request: {
                prompt: "Write a rondo in F major for flute and piano with a gently brighter return.",
                key: "F major",
                tempo: 84,
                form: "rondo",
                durationSec: 110,
            },
            plan: {
                titleHint: "Lantern Steps",
                brief: "A rondo whose returns stay light while the contrasting episode leans more singing and exposed.",
                mood: ["lyrical", "poised", "bright"],
                form: "rondo",
                inspirationThread: "Test a brighter return shape without losing chamber restraint.",
                intentRationale: "Recent nocturnes stayed too interior, so this candidate changes both form and tonal color.",
                contrastTarget: "Move away from the recent minor-key nocturne shell with a more circular return design.",
                riskProfile: "exploratory",
                structureVisibility: "transparent",
                humanizationStyle: "expressive",
                targetDurationSec: 110,
                targetMeasures: 24,
                meter: "3/4",
                key: "F major",
                tempo: 84,
                instrumentation: [
                    { name: "flute", family: "winds", roles: ["lead"], register: "high" },
                    { name: "piano", family: "keyboard", roles: ["pad", "pulse"], register: "wide" },
                ],
                sections: [
                    { id: "s1", role: "theme_a", label: "Refrain", measures: 8, energy: 0.35, density: 0.3, cadence: "half", expression: { articulation: ["legato"], character: ["cantabile"], phrasePeaks: [4] }, notes: ["State the refrain with a singing flute line."] },
                    { id: "s2", role: "theme_b", label: "Episode", measures: 8, energy: 0.52, density: 0.4, cadence: "half", expression: { articulation: ["accent"], character: ["espressivo"], phrasePeaks: [6] }, notes: ["Contrast the refrain with more exposed harmonic motion."] },
                    { id: "s3", role: "cadence", label: "Return", measures: 8, energy: 0.3, density: 0.28, cadence: "authentic", expression: { articulation: ["legato"], character: ["dolce"], phrasePeaks: [3] }, notes: ["Return softly but clearly in the home key."] },
                ],
                rationale: "This candidate repairs section contrast by changing the sectional pattern itself.",
            },
        }),
        createPlannerResponse({
            request: {
                prompt: "Write a chamber nocturne in D minor with a suspended cadence and a warmer close.",
            },
            plan: {
                contrastTarget: "Keep the surface slightly warmer while staying inside the same nocturne shell.",
                sections: [
                    { id: "s1", role: "theme_a", label: "Opening idea", measures: 8, energy: 0.3, density: 0.3, cadence: "half", notes: ["Introduce the main motif."] },
                    { id: "s2", role: "cadence", label: "Quiet close", measures: 8, energy: 0.25, density: 0.25, cadence: "authentic", notes: ["Close quietly with a clear cadence."] },
                ],
            },
        }),
    ]);

    assert.equal(result.form, "rondo");
    assert.equal(result.key, "F major");
    assert.equal(result.noveltySummary.exactMatch, false);
    assert.equal(result.candidateSelection.selectedIndex, 1);
    assert.equal(result.candidateSelection.selectedCandidateId, "texture_meter_contrast");
    assert.equal(result.candidateSelection.candidates[1].form, "rondo");
    assert.ok(result.candidateSelection.candidates[1].selectionScore > result.candidateSelection.candidates[0].selectionScore);
});

test("previewAutonomyPlan extracts richer fallback cues from freeform planner text", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            workflow: plan.request.workflow,
            form: plan.request.form,
            key: plan.request.key,
            tempo: plan.request.tempo,
            rationale: plan.rationale,
            meter: plan.request.compositionPlan?.meter,
            humanizationStyle: plan.request.compositionPlan?.humanizationStyle,
            contrastTarget: plan.request.compositionPlan?.contrastTarget,
            instruments: plan.planSummary?.instruments,
            candidateSelection: plan.candidateSelection,
        }));
    `, `Compose a rondo in F major for flute and piano at 84 bpm in 3/4.
Avoid the recent nocturne shell and let the episode feel more exposed.
Keep the phrasing expressive but chamber-sized, then return with a clear cadence.`);

    assert.equal(result.workflow, "symbolic_only");
    assert.equal(result.form, "rondo");
    assert.equal(result.key, "F major");
    assert.equal(result.tempo, 84);
    assert.equal(result.meter, "3/4");
    assert.equal(result.humanizationStyle, "expressive");
    assert.match(result.contrastTarget, /recent nocturne shell/i);
    assert.deepEqual(result.instruments, ["flute", "piano"]);
    assert.match(result.rationale, /form, key, meter, tempo, instrumentation, phrasing cue/);
    assert.equal(result.candidateSelection.candidates[0].parserMode, "fallback");
});

test("previewAutonomyPlan scores novelty against recent plan signatures", async () => {
    const result = await runPlannerScenario(`
        const { saveAutonomyPreferences } = await import("./dist/memory/manifest.js");
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");

        saveAutonomyPreferences({
            updatedAt: "2026-04-10T00:00:00.000Z",
            reviewedSongs: 3,
            preferredForms: ["nocturne"],
            preferredKeys: ["D minor"],
            recentWeaknesses: [],
            recentPromptHashes: [],
            recentPlanSignatures: [
                "form=nocturne|key=d minor|meter=4/4|inst=piano+violin|roles=theme_a>cadence|human=restrained",
                "form=nocturne|key=d minor|meter=4/4|inst=piano|roles=theme_a>cadence|human=restrained",
                "form=miniature|key=d minor|meter=4/4|inst=piano|roles=theme_a>cadence|human=restrained"
            ],
            successPatterns: [],
            skillGaps: [],
            styleTendency: {},
            successfulMotifReturns: [],
            successfulTensionArcs: [],
            successfulRegisterCenters: [],
            successfulCadenceApproaches: [],
            successfulBassMotionProfiles: [],
            successfulSectionStyles: [],
            lastReflection: "none",
        });

        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify(plan.noveltySummary));
    `);

    assert.ok(result.noveltyScore < 1);
    assert.equal(result.exactMatch, true);
    assert.ok(result.repeatedAxes.includes("form"));
    assert.ok(result.repeatedAxes.includes("section_roles"));
    assert.ok(!result.repeatedAxes.includes("instrumentation"));
    assert.ok(result.recentMatches.length >= 1);
});

test("previewAutonomyPlan preserves planner expression defaults and section guidance", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            expressionDefaults: plan.request.compositionPlan?.expressionDefaults,
            sectionExpressions: plan.request.compositionPlan?.sections.map((section) => ({
                id: section.id,
                role: section.role,
                expression: section.expression,
            })),
        }));
    `, createPlannerResponse({
        plan: {
            expressionDefaults: {
                dynamics: {
                    start: "pp",
                    peak: "mp",
                    end: "p",
                    hairpins: [{ shape: "crescendo", startMeasure: 1, endMeasure: 4, target: "mp" }],
                },
                articulation: ["legato"],
                character: ["dolce"],
                sustainBias: 0.25,
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening idea",
                    measures: 8,
                    energy: 0.3,
                    density: 0.3,
                    cadence: "half",
                    expression: {
                        articulation: ["legato"],
                        character: ["cantabile"],
                        phrasePeaks: [3, 7],
                    },
                    notes: ["Introduce the main motif."],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Quiet close",
                    measures: 8,
                    energy: 0.25,
                    density: 0.25,
                    cadence: "authentic",
                    motifRef: "s1",
                    expression: {
                        articulation: ["legato"],
                        character: ["dolce"],
                        phrasePeaks: [8],
                    },
                    notes: ["Close quietly with a clear cadence."],
                },
            ],
        },
    }));

    assert.equal(result.expressionDefaults.dynamics.start, "pp");
    assert.equal(result.expressionDefaults.dynamics.hairpins[0].shape, "crescendo");
    assert.deepEqual(result.expressionDefaults.articulation, ["legato"]);
    assert.deepEqual(result.expressionDefaults.character, ["dolce"]);
    assert.equal(result.sectionExpressions[0].expression.articulation[0], "legato");
    assert.equal(result.sectionExpressions[0].expression.character[0], "cantabile");
    assert.deepEqual(result.sectionExpressions[0].expression.phrasePeaks, [3, 7]);
    assert.equal(result.sectionExpressions[1].expression.character[0], "dolce");
    assert.deepEqual(result.sectionExpressions[1].expression.phrasePeaks, [8]);
});

test("previewAutonomyPlan derives fallback expression guidance when planner omits it", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            humanizationStyle: plan.request.compositionPlan?.humanizationStyle,
            expressionDefaults: plan.request.compositionPlan?.expressionDefaults,
            sectionExpressions: plan.request.compositionPlan?.sections.map((section) => ({
                id: section.id,
                role: section.role,
                expression: section.expression,
            })),
        }));
    `, createPlannerResponse({
        plan: {
            humanizationStyle: "expressive",
            expressionDefaults: undefined,
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening idea",
                    measures: 8,
                    energy: 0.3,
                    density: 0.3,
                    cadence: "half",
                    notes: ["Introduce the main motif."],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Quiet close",
                    measures: 8,
                    energy: 0.25,
                    density: 0.25,
                    cadence: "authentic",
                    motifRef: "s1",
                    notes: ["Close quietly with a clear cadence."],
                },
            ],
        },
    }));

    assert.equal(result.humanizationStyle, "expressive");
    assert.equal(result.expressionDefaults.dynamics.start, "mp");
    assert.equal(result.expressionDefaults.dynamics.peak, "f");
    assert.equal(result.expressionDefaults.character[0], "espressivo");
    assert.equal(result.sectionExpressions[0].expression.character[0], "cantabile");
    assert.ok(result.sectionExpressions[0].expression.phrasePeaks.length >= 1);
    assert.equal(result.sectionExpressions[1].expression.character[0], "espressivo");
    assert.equal(result.sectionExpressions[1].expression.articulation[0], "legato");
});

test("triggerAutonomyRun returns planner plan summary", async () => {
    const result = await runPlannerScenario(`
        const { triggerAutonomyRun } = await import("./dist/autonomy/controller.js");
        const triggered = await triggerAutonomyRun("api");
        console.log(JSON.stringify({
            workflow: triggered.request.workflow,
            planSummary: triggered.planSummary,
            requestQualityPolicy: triggered.request.qualityPolicy,
            candidateSelection: triggered.candidateSelection,
            plannerTelemetry: triggered.request.plannerTelemetry,
            humanizationStyle: triggered.request.compositionPlan?.humanizationStyle,
        }));
    `);

    assert.equal(result.workflow, "symbolic_plus_audio");
    assert.equal(result.planSummary.sectionCount, 2);
    assert.equal(result.planSummary.form, "nocturne");
    assert.equal(result.planSummary.qualityProfile, "lyric_short_form");
    assert.equal(result.planSummary.qualityPolicy.targetAudioScore, 80);
    assert.equal(result.requestQualityPolicy.targetStructureScore, 76);
    assert.equal(result.candidateSelection.strategy, "novelty_plus_plan_completeness_v1");
    assert.equal(result.candidateSelection.candidateCount, 3);
    assert.equal(result.plannerTelemetry.selectedCandidateId, result.candidateSelection.selectedCandidateId);
    assert.equal(result.plannerTelemetry.candidateCount, result.candidateSelection.candidateCount);
    assert.equal(result.planSummary.structureVisibility, "hidden");
    assert.equal(result.humanizationStyle, "restrained");
});

test("triggerAutonomyRun carries long-span summary in planner plan summary", async () => {
    const result = await runPlannerScenario(`
        const { triggerAutonomyRun } = await import("./dist/autonomy/controller.js");
        const triggered = await triggerAutonomyRun("api");
        console.log(JSON.stringify({
            planSummary: triggered.planSummary,
        }));
    `, createPlannerResponse({
        request: {
            prompt: "Write a compact sonata with an inevitable return.",
            form: "sonata",
            key: "C major",
            tempo: 104,
            durationSec: 120,
            workflow: "symbolic_only",
        },
        plan: {
            form: "sonata",
            key: "C major",
            tempo: 104,
            workflow: "symbolic_only",
            targetDurationSec: 120,
            targetMeasures: 32,
            instrumentation: [
                { name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" },
            ],
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
                    { sourceSectionId: "s1", targetSectionId: "s3", transform: "fragment" },
                    { sourceSectionId: "s1", targetSectionId: "s4", transform: "repeat" },
                ],
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.42, density: 0.36, cadence: "half" },
                { id: "s2", role: "theme_b", label: "Contrast", measures: 8, energy: 0.5, density: 0.42, cadence: "half" },
                { id: "s3", role: "development", label: "Development", measures: 8, energy: 0.72, density: 0.58, cadence: "half" },
                { id: "s4", role: "recap", label: "Recap", measures: 8, energy: 0.34, density: 0.3, motifRef: "s1", cadence: "authentic" },
            ],
        },
    }));

    assert.equal(result.planSummary.longSpan.expositionStartSectionId, "s1");
    assert.equal(result.planSummary.longSpan.developmentStartSectionId, "s3");
    assert.equal(result.planSummary.longSpan.recapStartSectionId, "s4");
    assert.equal(result.planSummary.longSpan.thematicCheckpointCount, 2);
    assert.deepEqual(result.planSummary.longSpan.thematicTransforms, ["fragment", "repeat"]);
});

test("previewAutonomyPlan repairs malformed sonata plans into symbolic-first summaries", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const plan = await previewAutonomyPlan();
        console.log(JSON.stringify({
            workflow: plan.request.workflow,
            sectionCount: plan.planSummary?.sectionCount,
            totalMeasures: plan.planSummary?.totalMeasures,
            qualityProfile: plan.planSummary?.qualityProfile,
            selectedModels: plan.planSummary?.selectedModels,
            sections: plan.planSummary?.sections,
        }));
    `, createPlannerResponse({
        request: {
            prompt: "Write a compact piano sonata with a decisive return.",
            key: "C major",
            tempo: 108,
            form: "sonata",
            durationSec: 120,
            workflow: "audio_only",
        },
        plan: {
            titleHint: "Small Sonata",
            brief: "A compact sonata with a strong return.",
            mood: ["driven", "focused"],
            form: "sonata",
            inspirationThread: "Recover a convincing tonal return.",
            intentRationale: "Recent larger forms needed a clearer harmonic homecoming.",
            contrastTarget: "Be more formally explicit than the recent nocturnes.",
            targetDurationSec: 120,
            targetMeasures: 32,
            meter: "4/4",
            key: "C major",
            tempo: 108,
            workflow: "audio_only",
            instrumentation: [
                { name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" },
            ],
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening theme",
                    measures: 8,
                    energy: 0.42,
                    density: 0.36,
                    cadence: "half",
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Closing phrase",
                    measures: 8,
                    energy: 0.28,
                    density: 0.24,
                    cadence: "authentic",
                },
            ],
            rationale: "This intentionally omits development and recap so the parser must repair it.",
        },
        selectedModels: [
            { role: "planner", provider: "ollama", model: "gemma4:latest" },
            { role: "audio_renderer", provider: "transformers", model: "facebook/musicgen-large" },
        ],
        rationale: "Repair the malformed sonata into a structure-first plan.",
    }));

    assert.equal(result.workflow, "symbolic_plus_audio");
    assert.equal(result.sectionCount, 4);
    assert.equal(result.totalMeasures, 32);
    assert.equal(result.qualityProfile, "sonata_large_form");
    assert.match(result.selectedModels.join(" | "), /structure:python:music21-symbolic-v1/);
    assert.deepEqual(result.sections.map((section) => section.role), ["theme_a", "theme_b", "development", "recap"]);
});

test("updateAutonomyPreferencesFromManifest stores reflection and style memory", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-preference-memory-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");

    fs.mkdirSync(path.join(outputDir, "_system"), { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    const { stdout } = await runNodeEval(`
        const { setLogStream } = await import("./dist/logging/logger.js");
        setLogStream("stderr");
        const { updateAutonomyPreferencesFromManifest } = await import("./dist/autonomy/service.js");
        const { loadAutonomyPreferences } = await import("./dist/memory/manifest.js");
        updateAutonomyPreferencesFromManifest({
            songId: "song-memory-1",
            state: "DONE",
            meta: {
                songId: "song-memory-1",
                prompt: "Write an inward-looking nocturne.",
                key: "D minor",
                form: "nocturne",
                promptHash: "memoryhash001",
                humanizationStyle: "restrained",
                structureVisibility: "hidden",
                riskProfile: "exploratory",
                createdAt: "2026-04-10T00:00:00.000Z",
                updatedAt: "2026-04-10T00:05:00.000Z",
            },
            artifacts: {},
            structureEvaluation: {
                passed: true,
                score: 84,
                issues: [],
                strengths: ["section tension arc broadly follows the planned contour."],
                metrics: {
                    tensionArcMismatch: 0.08,
                },
                sectionFindings: [
                    {
                        sectionId: "s1",
                        label: "Opening",
                        role: "theme_a",
                        startMeasure: 1,
                        endMeasure: 8,
                        score: 0.84,
                        issues: [],
                        strengths: ["Register center stayed stable."],
                        metrics: {
                            registerCenterFit: 0.86,
                        },
                    },
                    {
                        sectionId: "s2",
                        label: "Return",
                        role: "cadence",
                        startMeasure: 9,
                        endMeasure: 16,
                        score: 0.88,
                        issues: [],
                        strengths: ["Cadence approach aligned with the plan."],
                        metrics: {
                            registerCenterFit: 0.82,
                            cadenceApproachFit: 0.91,
                        },
                    },
                ],
            },
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "theme_a",
                    measureCount: 8,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    realizedRegisterCenter: 67,
                    bassMotionProfile: "mixed",
                    sectionStyle: "arpeggio",
                },
                {
                    sectionId: "s2",
                    role: "cadence",
                    measureCount: 8,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    realizedRegisterCenter: 61,
                    bassMotionProfile: "pedal",
                    cadenceApproach: "dominant",
                    sectionStyle: "block",
                },
            ],
            selfAssessment: {
                generatedAt: "2026-04-10T00:05:00.000Z",
                summary: "The cadence felt more natural than recent drafts.",
                qualityScore: 8.1,
                strengths: ["soft cadence"],
                weaknesses: ["inner voices still feel static"],
                tags: ["nocturne"],
                reflection: "Keep the cadence veiled, but loosen the inner voices next time.",
                nextFocus: ["broaden mid-register motion"],
                raw: "{}",
            },
            approvalStatus: "not_required",
            stateHistory: [{ state: "DONE", timestamp: "2026-04-10T00:05:00.000Z" }],
            updatedAt: "2026-04-10T00:05:00.000Z",
        }, {
            prompt: "Write an inward-looking nocturne.",
            workflow: "symbolic_plus_audio",
            compositionPlan: {
                version: "planner-schema-v2",
                brief: "A quiet nocturne.",
                mood: ["intimate"],
                form: "nocturne",
                inspirationThread: "Protect a soft cadence while opening the middle register.",
                intentRationale: "Recent endings were too exposed.",
                contrastTarget: "Stay darker than the last miniature.",
                riskProfile: "exploratory",
                structureVisibility: "hidden",
                humanizationStyle: "restrained",
                key: "D minor",
                tempo: 68,
                workflow: "symbolic_plus_audio",
                instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "pad"], register: "wide" }],
                motifPolicy: { reuseRequired: true },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Opening",
                        measures: 8,
                        energy: 0.52,
                        density: 0.34,
                        harmonicPlan: { tensionTarget: 0.62 },
                    },
                    {
                        id: "s2",
                        role: "cadence",
                        label: "Return",
                        measures: 8,
                        energy: 0.24,
                        density: 0.22,
                        cadence: "authentic",
                        motifRef: "s1",
                        harmonicPlan: { tensionTarget: 0.18 },
                    },
                ],
                rationale: "Keep it inward.",
            },
        });
        console.log(JSON.stringify(loadAutonomyPreferences()));
    `, {
        cwd: repoRoot,
        env: {
            OUTPUT_DIR: outputDir,
            LOG_DIR: logDir,
            OLLAMA_URL: "http://127.0.0.1:1",
            LOG_LEVEL: "error",
        },
    });

    const result = parseLastJsonLine(stdout);
    fs.rmSync(tempRoot, { recursive: true, force: true });

    assert.equal(result.reviewedSongs, 1);
    assert.equal(result.lastReflection, "Keep the cadence veiled, but loosen the inner voices next time.");
    assert.equal(result.styleTendency.humanizationStyle, "restrained");
    assert.equal(result.styleTendency.structureVisibility, "hidden");
    assert.equal(result.successPatterns[0].form, "nocturne");
    assert.equal(result.skillGaps[0].issue, "inner voices still feel static");
    assert.equal(result.successfulMotifReturns[0].sourceRole, "theme_a");
    assert.equal(result.successfulMotifReturns[0].targetRole, "cadence");
    assert.deepEqual(result.successfulTensionArcs[0].sectionRoles, ["theme_a", "cadence"]);
    assert.deepEqual(result.successfulTensionArcs[0].values, [0.62, 0.18]);
    assert.equal(result.successfulRegisterCenters.find((entry) => entry.role === "theme_a")?.registerCenter, 67);
    assert.equal(result.successfulRegisterCenters.find((entry) => entry.role === "cadence")?.registerCenter, 61);
    assert.equal(result.successfulCadenceApproaches[0].role, "cadence");
    assert.equal(result.successfulCadenceApproaches[0].cadence, "authentic");
    assert.equal(result.successfulCadenceApproaches[0].cadenceApproach, "dominant");
    assert.equal(result.successfulBassMotionProfiles.find((entry) => entry.role === "theme_a")?.bassMotionProfile, "mixed");
    assert.equal(result.successfulBassMotionProfiles.find((entry) => entry.role === "cadence")?.bassMotionProfile, "pedal");
    assert.equal(result.successfulSectionStyles.find((entry) => entry.role === "theme_a")?.sectionStyle, "arpeggio");
    assert.equal(result.successfulSectionStyles.find((entry) => entry.role === "cadence")?.sectionStyle, "block");
    assert.match(result.recentPlanSignatures[0], /form=nocturne\|key=d minor/);
});

test("triggerAutonomyRun blocks near-duplicate plan signatures even when prompt hash differs", async () => {
    const result = await runPlannerScenario(`
        const { previewAutonomyPlan } = await import("./dist/autonomy/service.js");
        const { triggerAutonomyRun } = await import("./dist/autonomy/controller.js");
        const { getAutonomyDayKey } = await import("./dist/autonomy/calendar.js");
        const { saveAutonomyRunLedger } = await import("./dist/memory/manifest.js");

        const preview = await previewAutonomyPlan();
        saveAutonomyRunLedger(getAutonomyDayKey(), [{
            runId: "existing-run",
            createdAt: preview.generatedAt,
            promptHash: "existinghash001",
            planSignature: preview.noveltySummary?.planSignature,
            noveltyScore: preview.noveltySummary?.noveltyScore,
            status: "approved",
            summary: "existing approved plan",
        }]);

        try {
            await triggerAutonomyRun("api");
            console.log(JSON.stringify({ ok: true }));
        } catch (error) {
            console.log(JSON.stringify({
                ok: false,
                name: error?.name,
                message: error?.message,
                details: error?.details,
            }));
        }
    `, [
        createPlannerResponse(),
        createPlannerResponse({
            request: {
                prompt: "Write a veiled chamber nocturne with a darker violin entrance.",
            },
            rationale: "Keep the same plan shell but alter the surface prompt wording.",
        }),
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.name, "AutonomyConflictError");
    assert.match(result.message, /duplicate autonomy plan signature/);
    assert.equal(result.details.duplicatePlan.status, "approved");
    assert.equal(result.details.noveltySummary.exactMatch, true);
});

test("materializeCompositionSketch applies autonomy memory bias for motif returns, tension arcs, register centers, cadence approaches, bass motion, and section style", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-sketch-memory-bias-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");

    fs.mkdirSync(path.join(outputDir, "_system"), { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    const { stdout } = await runNodeEval(`
        const { setLogStream } = await import("./dist/logging/logger.js");
        setLogStream("stderr");
        const { saveAutonomyPreferences } = await import("./dist/memory/manifest.js");
        const { materializeCompositionSketch } = await import("./dist/pipeline/sketch.js");

        saveAutonomyPreferences({
            updatedAt: "2026-04-10T00:00:00.000Z",
            reviewedSongs: 2,
            preferredForms: ["nocturne"],
            preferredKeys: ["D minor"],
            recentWeaknesses: [],
            recentPromptHashes: [],
            successPatterns: [],
            skillGaps: [],
            styleTendency: {},
            successfulMotifReturns: [
                { form: "nocturne", sourceRole: "theme_a", targetRole: "cadence", cadence: "authentic", count: 3 },
            ],
            successfulTensionArcs: [
                { form: "nocturne", sectionRoles: ["theme_a", "cadence"], values: [0.42, 0.78], count: 2 },
            ],
            successfulRegisterCenters: [
                { form: "nocturne", role: "theme_a", registerCenter: 72, count: 4 },
            ],
            successfulCadenceApproaches: [
                { form: "nocturne", role: "cadence", cadence: "authentic", cadenceApproach: "dominant", count: 5 },
            ],
            successfulBassMotionProfiles: [
                { form: "nocturne", role: "theme_a", bassMotionProfile: "mixed", count: 4 },
            ],
            successfulSectionStyles: [
                { form: "nocturne", role: "theme_a", sectionStyle: "broken", count: 3 },
            ],
            lastReflection: "none",
        });

        const result = materializeCompositionSketch({
            prompt: "Write a chamber nocturne with a withheld return.",
            source: "autonomy",
            workflow: "symbolic_only",
            compositionPlan: {
                version: "planner-schema-v2",
                brief: "A nocturne with a final return.",
                mood: ["intimate"],
                form: "nocturne",
                workflow: "symbolic_only",
                instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"], register: "wide" }],
                motifPolicy: { reuseRequired: true },
                sections: [
                    { id: "s1", role: "theme_a", label: "Opening", measures: 8, energy: 0.3, density: 0.3 },
                    { id: "s2", role: "cadence", label: "Return", measures: 8, energy: 0.25, density: 0.22 },
                ],
                rationale: "memory bias test",
            },
        });

        console.log(JSON.stringify({
            note: result.compositionPlan?.sketch?.note,
            motifDraftSections: result.compositionPlan?.sketch?.motifDrafts.map((draft) => draft.sectionId),
            openingIntervals: result.compositionPlan?.sketch?.motifDrafts.find((draft) => draft.sectionId === "s1")?.intervals,
            cadencePrimary: result.compositionPlan?.sketch?.cadenceOptions.at(-1)?.primary,
        }));
    `, {
        cwd: repoRoot,
        env: {
            OUTPUT_DIR: outputDir,
            LOG_DIR: logDir,
            LOG_LEVEL: "error",
        },
    });

    const result = parseLastJsonLine(stdout);
    fs.rmSync(tempRoot, { recursive: true, force: true });

    assert.match(result.note, /Applied motif return memory/i);
    assert.match(result.note, /register center memory/i);
    assert.match(result.note, /cadence approach memory/i);
    assert.match(result.note, /bass motion memory/i);
    assert.match(result.note, /section style memory/i);
    assert.deepEqual(result.motifDraftSections, ["s1", "s2"]);
    assert.deepEqual(result.openingIntervals, [0, 2, 5, 2, 1]);
    assert.equal(result.cadencePrimary, "authentic");
});

test("buildExecutionPlan keeps structure-first workflows on music21", async () => {
    const { buildExecutionPlan } = await import("../dist/composer/index.js");
    const plan = buildExecutionPlan({
        prompt: "Write a short nocturne.",
        workflow: "symbolic_plus_audio",
        selectedModels: [
            { role: "structure", provider: "python", model: "music21-symbolic-v1" },
            { role: "audio_renderer", provider: "transformers", model: "facebook/musicgen-large" },
        ],
    });

    assert.equal(plan.workflow, "symbolic_plus_audio");
    assert.equal(plan.composeWorker, "music21");
    assert.equal(plan.selectedModels.length, 2);
});