import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine, runNodeEval } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("saveManifest stores sectionArtifacts and expressionPlan in sidecar caches and listStoredManifests stays lean", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-manifest-storage-"));
    const outputDir = path.join(tempRoot, "outputs");
    const logDir = path.join(tempRoot, "logs");

    try {
        const { stdout } = await runNodeEval(`
            import fs from "node:fs";
            import path from "node:path";
            import {
                saveManifest,
                loadManifest,
                listStoredManifests,
                sectionArtifactsCachePath,
                expressionPlanCachePath,
            } from "./dist/memory/manifest.js";

            const manifest = {
                songId: "cache-song",
                state: "DONE",
                meta: {
                    songId: "cache-song",
                    prompt: "Preserve untouched sections through retries.",
                    form: "sonata",
                    workflow: "symbolic_plus_audio",
                    createdAt: "2026-04-10T00:00:00.000Z",
                    updatedAt: "2026-04-10T00:00:02.000Z",
                },
                artifacts: {
                    midi: "outputs/cache-song/composition.mid",
                },
                sectionArtifacts: [
                    {
                        sectionId: "s1",
                        role: "theme_a",
                        measureCount: 4,
                        melodyEvents: [{ type: "note", pitch: 60, quarterLength: 1, velocity: 80 }],
                        accompanimentEvents: [{ type: "chord", pitches: [48, 55], quarterLength: 1, velocity: 68 }],
                        noteHistory: [60, 62, 64],
                        capturedMotif: [0, 2, 4],
                    },
                    {
                        sectionId: "s2",
                        role: "development",
                        measureCount: 4,
                        melodyEvents: [{ type: "note", pitch: 67, quarterLength: 0.5, velocity: 84 }],
                        accompanimentEvents: [{ type: "note", pitch: 43, quarterLength: 1, velocity: 70 }],
                        noteHistory: [67, 69, 71],
                        capturedMotif: [0, 2, 4],
                    },
                ],
                expressionPlan: {
                    version: "planner-v2",
                    humanizationStyle: "expressive",
                    expressionDefaults: {
                        dynamics: { start: "pp", peak: "mf", end: "p" },
                        character: ["dolce"],
                    },
                    tempoMotionDefaults: [
                        {
                            tag: "ritardando",
                            startMeasure: 7,
                            endMeasure: 8,
                            intensity: 0.6,
                        },
                    ],
                    ornamentDefaults: [
                        {
                            tag: "fermata",
                            startMeasure: 8,
                            targetBeat: 4,
                            intensity: 0.8,
                        },
                    ],
                    sections: [
                        {
                            sectionId: "s1",
                            phraseBreath: {
                                pickupStartMeasure: 1,
                                pickupEndMeasure: 2,
                                arrivalMeasure: 3,
                                releaseStartMeasure: 3,
                                releaseEndMeasure: 4,
                                cadenceRecoveryStartMeasure: 4,
                                cadenceRecoveryEndMeasure: 4,
                                rubatoAnchors: [2, 4],
                            },
                            expression: {
                                articulation: ["legato"],
                                phrasePeaks: [3],
                            },
                            tempoMotion: [
                                {
                                    tag: "ritenuto",
                                    intensity: 0.7,
                                },
                            ],
                            ornaments: [
                                {
                                    tag: "fermata",
                                    targetBeat: 4,
                                    intensity: 0.75,
                                },
                            ],
                        },
                    ],
                },
                stateHistory: [
                    { state: "IDLE", timestamp: "2026-04-10T00:00:00.000Z" },
                    { state: "DONE", timestamp: "2026-04-10T00:00:02.000Z" },
                ],
                updatedAt: "2026-04-10T00:00:02.000Z",
            };

            saveManifest(manifest);

            const manifestJson = JSON.parse(fs.readFileSync(path.join(process.env.OUTPUT_DIR, "cache-song", "manifest.json"), "utf-8"));
            const sectionSidecarPath = sectionArtifactsCachePath("cache-song");
            const sectionSidecar = JSON.parse(fs.readFileSync(sectionSidecarPath, "utf-8"));
            const expressionSidecarPath = expressionPlanCachePath("cache-song");
            const expressionSidecar = JSON.parse(fs.readFileSync(expressionSidecarPath, "utf-8"));
            const hydrated = loadManifest("cache-song");
            const list = listStoredManifests();

            console.log(JSON.stringify({
                rawHasSectionArtifacts: Object.prototype.hasOwnProperty.call(manifestJson, "sectionArtifacts"),
                rawHasExpressionPlan: Object.prototype.hasOwnProperty.call(manifestJson, "expressionPlan"),
                sectionSidecarExists: fs.existsSync(sectionSidecarPath),
                sectionSidecarCount: sectionSidecar.length,
                expressionSidecarExists: fs.existsSync(expressionSidecarPath),
                expressionStart: expressionSidecar.expressionDefaults?.dynamics?.start,
                expressionTempoTag: expressionSidecar.tempoMotionDefaults?.[0]?.tag ?? null,
                expressionOrnamentTag: expressionSidecar.ornamentDefaults?.[0]?.tag ?? null,
                expressionPhraseBreathArrival: expressionSidecar.sections?.[0]?.phraseBreath?.arrivalMeasure ?? null,
                hydratedCount: hydrated?.sectionArtifacts?.length ?? 0,
                hydratedExpressionStart: hydrated?.expressionPlan?.expressionDefaults?.dynamics?.start ?? null,
                hydratedPhraseBreathPickupStart: hydrated?.expressionPlan?.sections?.[0]?.phraseBreath?.pickupStartMeasure ?? null,
                hydratedSectionTempoTag: hydrated?.expressionPlan?.sections?.[0]?.tempoMotion?.[0]?.tag ?? null,
                hydratedSectionOrnamentTag: hydrated?.expressionPlan?.sections?.[0]?.ornaments?.[0]?.tag ?? null,
                listedHasSectionArtifacts: Object.prototype.hasOwnProperty.call(list[0] ?? {}, "sectionArtifacts"),
                listedSectionArtifactsCount: list[0]?.sectionArtifacts?.length ?? 0,
                listedHasExpressionPlan: Object.prototype.hasOwnProperty.call(list[0] ?? {}, "expressionPlan"),
                listedExpressionSectionCount: list[0]?.expressionPlan?.sections?.length ?? 0,
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
        assert.equal(result.rawHasSectionArtifacts, false);
        assert.equal(result.rawHasExpressionPlan, false);
        assert.equal(result.sectionSidecarExists, true);
        assert.equal(result.sectionSidecarCount, 2);
        assert.equal(result.expressionSidecarExists, true);
        assert.equal(result.expressionStart, "pp");
        assert.equal(result.expressionTempoTag, "ritardando");
        assert.equal(result.expressionOrnamentTag, "fermata");
        assert.equal(result.expressionPhraseBreathArrival, 3);
        assert.equal(result.hydratedCount, 2);
        assert.equal(result.hydratedExpressionStart, "pp");
        assert.equal(result.hydratedPhraseBreathPickupStart, 1);
        assert.equal(result.hydratedSectionTempoTag, "ritenuto");
        assert.equal(result.hydratedSectionOrnamentTag, "fermata");
        assert.equal(result.listedHasSectionArtifacts, false);
        assert.equal(result.listedSectionArtifactsCount, 0);
        assert.equal(result.listedHasExpressionPlan, false);
        assert.equal(result.listedExpressionSectionCount, 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});