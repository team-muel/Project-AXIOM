import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeEval, parseLastJsonLine } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function createSilentWavBuffer(durationSec = 1, sampleRate = 48_000) {
    const channelCount = 1;
    const bitsPerSample = 16;
    const blockAlign = channelCount * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const frameCount = durationSec * sampleRate;
    const dataSize = frameCount * blockAlign;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write("RIFF", 0, "ascii");
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8, "ascii");
    buffer.write("fmt ", 12, "ascii");
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channelCount, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write("data", 36, "ascii");
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
}

test("restores running MusicGen compose job with same songId and completes from existing output", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-recovery-test-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    const songId = "recovery-song";
    const songDir = path.join(outputDir, songId);

    fs.mkdirSync(path.join(outputDir, "_system"), { recursive: true });
    fs.mkdirSync(songDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    const manifest = {
        songId,
        state: "COMPOSE",
        meta: {
            songId,
            prompt: "restart-safe largo recovery",
            form: "largo",
            workflow: "audio_only",
            source: "api",
            promptHash: "recoveryhash001122",
            createdAt: "2026-04-10T00:00:00.000Z",
            updatedAt: "2026-04-10T00:00:05.000Z",
        },
        artifacts: {},
        runtime: {
            stage: "COMPOSE",
            stageStartedAt: "2026-04-10T00:00:01.000Z",
            updatedAt: "2026-04-10T00:00:05.000Z",
            detail: "Generating audio before restart",
            compose: {
                worker: "musicgen",
                phase: "generating",
                updatedAt: "2026-04-10T00:00:05.000Z",
                detail: "Generating audio with max_new_tokens=4500",
                outputPath: path.join(songDir, "output.wav"),
            },
        },
        approvalStatus: "not_required",
        stateHistory: [
            { state: "IDLE", timestamp: "2026-04-10T00:00:00.000Z" },
            { state: "COMPOSE", timestamp: "2026-04-10T00:00:01.000Z" },
        ],
        updatedAt: "2026-04-10T00:00:05.000Z",
    };

    fs.writeFileSync(path.join(songDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(songDir, "compose-progress.json"), JSON.stringify({
        worker: "musicgen",
        phase: "saving_output",
        updatedAt: "2026-04-10T00:00:06.000Z",
        detail: "Recovered file is ready to finalize",
        outputPath: path.join(songDir, "output.wav"),
    }, null, 2));
    fs.writeFileSync(path.join(songDir, "output.wav"), createSilentWavBuffer());

    const snapshot = {
        savedAt: "2026-04-10T00:00:06.500Z",
        queue: [],
        jobs: [
            {
                jobId: "recovery-job",
                request: {
                    prompt: "restart-safe largo recovery",
                    form: "largo",
                    durationSec: 1,
                    workflow: "audio_only",
                    source: "api",
                    promptHash: "recoveryhash001122",
                },
                attempts: 0,
                maxAttempts: 3,
                status: "running",
                manifest,
                createdAt: "2026-04-10T00:00:00.000Z",
                updatedAt: "2026-04-10T00:00:06.500Z",
            },
        ],
    };
    fs.writeFileSync(path.join(outputDir, "_system", "queue-state.json"), JSON.stringify(snapshot, null, 2));

    const { stdout } = await runNodeEval(`
        import { setLogStream } from "./dist/logging/logger.js";
        setLogStream("stderr");
        const { restoreQueueState, listJobs } = await import("./dist/queue/jobQueue.js");
        const summary = restoreQueueState();
        const afterRestore = listJobs().map((job) => ({
            jobId: job.jobId,
            status: job.status,
            songId: job.request.songId,
            recoveredFromRestart: job.request.recoveredFromRestart,
            recoveryNote: job.request.recoveryNote,
            runtimeStage: job.manifest?.runtime?.stage,
            composePhase: job.manifest?.runtime?.compose?.phase,
        }));
        await new Promise((resolve) => setTimeout(resolve, 200));
        const finalJobs = listJobs().map((job) => ({
            jobId: job.jobId,
            status: job.status,
            songId: job.request.songId,
            manifestState: job.manifest?.state,
            runtimeStage: job.manifest?.runtime?.stage,
            recovery: job.manifest?.runtime?.recovery,
            composePhase: job.manifest?.runtime?.compose?.phase,
            audioPath: job.manifest?.artifacts?.audio,
        }));
        console.log(JSON.stringify({ summary, afterRestore, finalJobs }));
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

    assert.deepEqual(result.summary, {
        restoredJobs: 1,
        requeuedJobs: 1,
        recoveredRunningJobs: 1,
        restoredRetryScheduledJobs: 0,
    });
    assert.equal(result.afterRestore[0].songId, songId);
    assert.equal(result.afterRestore[0].recoveredFromRestart, true);
    assert.equal(result.afterRestore[0].runtimeStage, "COMPOSE");
    assert.equal(result.afterRestore[0].composePhase, "saving_output");
    assert.equal(result.finalJobs[0].status, "done");
    assert.equal(result.finalJobs[0].songId, songId);
    assert.equal(result.finalJobs[0].manifestState, "DONE");
    assert.equal(result.finalJobs[0].runtimeStage, "DONE");
    assert.equal(result.finalJobs[0].composePhase, "completed");
    assert.equal(result.finalJobs[0].recovery.recoveredFromRestart, true);
    assert.match(result.finalJobs[0].audioPath, /output\.wav$/);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("restoreQueueState marks non-COMPOSE symbolic jobs for recovery with the same songId", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-recovery-symbolic-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    const songId = "recovery-symbolic";
    const songDir = path.join(outputDir, songId);

    fs.mkdirSync(path.join(outputDir, "_system"), { recursive: true });
    fs.mkdirSync(songDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    const manifest = {
        songId,
        state: "RENDER_AUDIO",
        meta: {
            songId,
            prompt: "recover symbolic-plus-audio checkpoint",
            form: "nocturne",
            workflow: "symbolic_plus_audio",
            source: "api",
            promptHash: "recoverysymbolic001",
            createdAt: "2026-04-10T00:00:00.000Z",
            updatedAt: "2026-04-10T00:00:05.000Z",
        },
        artifacts: {
            audio: path.join(songDir, "output.wav"),
            renderedAudio: path.join(songDir, "output.wav"),
            styledAudio: path.join(songDir, "styled-output.wav"),
            midi: path.join(songDir, "humanized.mid"),
        },
        structureEvaluation: {
            passed: true,
            score: 84,
            issues: [],
            strengths: ["Structure accepted before restart."],
        },
        runtime: {
            stage: "RENDER_AUDIO",
            stageStartedAt: "2026-04-10T00:00:04.000Z",
            updatedAt: "2026-04-10T00:00:05.000Z",
            detail: "Rendering styled audio before restart",
        },
        approvalStatus: "not_required",
        stateHistory: [
            { state: "IDLE", timestamp: "2026-04-10T00:00:00.000Z" },
            { state: "COMPOSE", timestamp: "2026-04-10T00:00:01.000Z" },
            { state: "CRITIQUE", timestamp: "2026-04-10T00:00:02.000Z" },
            { state: "HUMANIZE", timestamp: "2026-04-10T00:00:03.000Z" },
            { state: "RENDER", timestamp: "2026-04-10T00:00:03.500Z" },
            { state: "RENDER_AUDIO", timestamp: "2026-04-10T00:00:04.000Z" },
        ],
        updatedAt: "2026-04-10T00:00:05.000Z",
    };

    fs.writeFileSync(path.join(songDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(songDir, "output.wav"), createSilentWavBuffer());
    fs.writeFileSync(path.join(songDir, "humanized.mid"), Buffer.from([0x4d, 0x54, 0x68, 0x64]));

    const snapshot = {
        savedAt: "2026-04-10T00:00:06.500Z",
        queue: [],
        jobs: [
            {
                jobId: "recovery-symbolic-job",
                request: {
                    prompt: "recover symbolic-plus-audio checkpoint",
                    form: "nocturne",
                    workflow: "symbolic_plus_audio",
                    source: "api",
                    promptHash: "recoverysymbolic001",
                    compositionPlan: {
                        version: "planner-v1",
                        brief: "recover symbolic-plus-audio checkpoint",
                        mood: ["lyrical"],
                        form: "nocturne",
                        workflow: "symbolic_plus_audio",
                        instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"] }],
                        motifPolicy: { reuseRequired: true },
                        sections: [{ id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.3, density: 0.3 }],
                        rationale: "checkpoint",
                    },
                },
                attempts: 1,
                maxAttempts: 3,
                status: "retry_scheduled",
                manifest,
                createdAt: "2026-04-10T00:00:00.000Z",
                updatedAt: "2026-04-10T00:00:06.500Z",
                nextAttemptAt: "2099-01-01T00:00:00.000Z",
            },
        ],
    };
    fs.writeFileSync(path.join(outputDir, "_system", "queue-state.json"), JSON.stringify(snapshot, null, 2));

    const { stdout } = await runNodeEval(`
        const { restoreQueueState, listJobs } = await import("./dist/queue/jobQueue.js");
        const summary = restoreQueueState();
        const jobs = listJobs().map((job) => ({
            jobId: job.jobId,
            status: job.status,
            songId: job.request.songId,
            recoveredFromRestart: job.request.recoveredFromRestart,
            recoveryNote: job.request.recoveryNote,
            manifestState: job.manifest?.state,
        }));
        console.log(JSON.stringify({ summary, jobs }));
    `, {
        cwd: repoRoot,
        env: {
            OUTPUT_DIR: outputDir,
            LOG_DIR: logDir,
            LOG_LEVEL: "error",
        },
    });

    const result = parseLastJsonLine(stdout);
    assert.equal(result.summary.restoredJobs, 1);
    assert.equal(result.summary.restoredRetryScheduledJobs, 1);
    assert.equal(result.jobs[0].songId, songId);
    assert.equal(result.jobs[0].recoveredFromRestart, true);
    assert.match(result.jobs[0].recoveryNote, /RENDER_AUDIO/);
    assert.equal(result.jobs[0].manifestState, "RENDER_AUDIO");

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("restoreQueueState hydrates expression-plan sidecar into recovered composition plans", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-recovery-expression-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");
    const songId = "recovery-expression";
    const songDir = path.join(outputDir, songId);

    fs.mkdirSync(path.join(outputDir, "_system"), { recursive: true });
    fs.mkdirSync(songDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    const manifest = {
        songId,
        state: "RENDER_AUDIO",
        meta: {
            songId,
            prompt: "recover expression-aware checkpoint",
            form: "nocturne",
            workflow: "symbolic_plus_audio",
            source: "api",
            promptHash: "recoveryexpression001",
            createdAt: "2026-04-10T00:00:00.000Z",
            updatedAt: "2026-04-10T00:00:05.000Z",
        },
        artifacts: {
            midi: path.join(songDir, "humanized.mid"),
        },
        runtime: {
            stage: "RENDER_AUDIO",
            stageStartedAt: "2026-04-10T00:00:04.000Z",
            updatedAt: "2026-04-10T00:00:05.000Z",
            detail: "Rendering styled audio before restart",
        },
        approvalStatus: "not_required",
        stateHistory: [
            { state: "IDLE", timestamp: "2026-04-10T00:00:00.000Z" },
            { state: "COMPOSE", timestamp: "2026-04-10T00:00:01.000Z" },
            { state: "CRITIQUE", timestamp: "2026-04-10T00:00:02.000Z" },
            { state: "HUMANIZE", timestamp: "2026-04-10T00:00:03.000Z" },
            { state: "RENDER", timestamp: "2026-04-10T00:00:03.500Z" },
            { state: "RENDER_AUDIO", timestamp: "2026-04-10T00:00:04.000Z" },
        ],
        updatedAt: "2026-04-10T00:00:05.000Z",
    };

    fs.writeFileSync(path.join(songDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(songDir, "expression-plan.json"), JSON.stringify({
        version: "planner-v2",
        humanizationStyle: "expressive",
        textureDefaults: {
            voiceCount: 3,
            primaryRoles: ["lead", "inner_voice", "bass"],
            counterpointMode: "contrary_motion",
            notes: ["Keep the middle voice recessed."],
        },
        expressionDefaults: {
            dynamics: { start: "pp", peak: "mf", end: "p" },
            character: ["dolce"],
        },
        sections: [
            {
                sectionId: "s1",
                phraseFunction: "presentation",
                texture: {
                    voiceCount: 2,
                    primaryRoles: ["lead", "chordal_support", "bass"],
                    counterpointMode: "none",
                    notes: ["Keep the bass steady."],
                },
                expression: {
                    articulation: ["legato"],
                    phrasePeaks: [4],
                },
            },
        ],
    }, null, 2));

    const snapshot = {
        savedAt: "2026-04-10T00:00:06.500Z",
        queue: [],
        jobs: [
            {
                jobId: "recovery-expression-job",
                request: {
                    prompt: "recover expression-aware checkpoint",
                    form: "nocturne",
                    workflow: "symbolic_plus_audio",
                    source: "api",
                    promptHash: "recoveryexpression001",
                    compositionPlan: {
                        version: "planner-v2",
                        brief: "recover expression-aware checkpoint",
                        mood: ["lyrical"],
                        form: "nocturne",
                        workflow: "symbolic_plus_audio",
                        instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead"] }],
                        motifPolicy: { reuseRequired: true },
                        sections: [{ id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.3, density: 0.3 }],
                        rationale: "checkpoint",
                    },
                },
                attempts: 1,
                maxAttempts: 3,
                status: "retry_scheduled",
                manifest,
                createdAt: "2026-04-10T00:00:00.000Z",
                updatedAt: "2026-04-10T00:00:06.500Z",
                nextAttemptAt: "2099-01-01T00:00:00.000Z",
            },
        ],
    };
    fs.writeFileSync(path.join(outputDir, "_system", "queue-state.json"), JSON.stringify(snapshot, null, 2));

    const { stdout } = await runNodeEval(`
        const { restoreQueueState, listJobs } = await import("./dist/queue/jobQueue.js");
        const summary = restoreQueueState();
        const jobs = listJobs().map((job) => ({
            jobId: job.jobId,
            textureVoiceCount: job.request.compositionPlan?.textureDefaults?.voiceCount,
            textureCounterpointMode: job.request.compositionPlan?.textureDefaults?.counterpointMode,
            expressionStart: job.request.compositionPlan?.expressionDefaults?.dynamics?.start,
            expressionCharacter: job.request.compositionPlan?.expressionDefaults?.character?.[0],
            sectionPhraseFunction: job.request.compositionPlan?.sections?.[0]?.phraseFunction,
            sectionTextureRoles: job.request.compositionPlan?.sections?.[0]?.texture?.primaryRoles,
            sectionCounterpointMode: job.request.compositionPlan?.sections?.[0]?.texture?.counterpointMode,
            sectionArticulation: job.request.compositionPlan?.sections?.[0]?.expression?.articulation?.[0],
            sectionPhrasePeak: job.request.compositionPlan?.sections?.[0]?.expression?.phrasePeaks?.[0],
            manifestHasExpressionPlan: Boolean(job.manifest?.expressionPlan?.sections?.length),
            recoveryNote: job.request.recoveryNote,
        }));
        console.log(JSON.stringify({ summary, jobs }));
    `, {
        cwd: repoRoot,
        env: {
            OUTPUT_DIR: outputDir,
            LOG_DIR: logDir,
            LOG_LEVEL: "error",
        },
    });

    const result = parseLastJsonLine(stdout);
    assert.equal(result.summary.restoredJobs, 1);
    assert.equal(result.summary.restoredRetryScheduledJobs, 1);
    assert.equal(result.jobs[0].textureVoiceCount, 3);
    assert.equal(result.jobs[0].textureCounterpointMode, "contrary_motion");
    assert.equal(result.jobs[0].expressionStart, "pp");
    assert.equal(result.jobs[0].expressionCharacter, "dolce");
    assert.equal(result.jobs[0].sectionPhraseFunction, "presentation");
    assert.deepEqual(result.jobs[0].sectionTextureRoles, ["lead", "chordal_support", "bass"]);
    assert.equal(result.jobs[0].sectionCounterpointMode, "none");
    assert.equal(result.jobs[0].sectionArticulation, "legato");
    assert.equal(result.jobs[0].sectionPhrasePeak, 4);
    assert.equal(result.jobs[0].manifestHasExpressionPlan, true);
    assert.match(result.jobs[0].recoveryNote, /RENDER_AUDIO/);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});