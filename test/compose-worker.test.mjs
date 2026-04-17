import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { critique } from "../dist/critic/index.js";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pythonBin = [
    path.join(repoRoot, ".venv", "Scripts", "python.exe"),
    path.join(repoRoot, ".venv", "bin", "python"),
].find((candidate) => fs.existsSync(candidate));

async function runComposeWorker(payload) {
    if (!pythonBin) {
        throw new Error("No local Python binary found for compose-worker test.");
    }

    return await new Promise((resolve, reject) => {
        const child = spawn(pythonBin, ["workers/composer/compose.py"], {
            cwd: repoRoot,
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });

        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });

        child.on("error", reject);
        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim() || `compose worker exited with code ${code}`));
                return;
            }

            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (error) {
                reject(error);
            }
        });

        child.stdin.write(JSON.stringify(payload));
        child.stdin.end();
    });
}

function extractUpperStrandShape(events, limit = 6) {
    const taggedPitches = extractVoiceRolePitches(events, ["counterline", "inner_voice"]);
    const pitches = (taggedPitches.length >= 2 ? taggedPitches : (events ?? []).flatMap((event) => {
        if (event?.type === "note" && Number.isFinite(event.pitch)) {
            return [event.pitch];
        }
        if (event?.type === "chord" && Array.isArray(event.pitches)) {
            return event.pitches.filter((value) => Number.isFinite(value));
        }
        return [];
    }));

    if (pitches.length < 2) {
        return [];
    }

    const floor = Math.min(...pitches) + 7;
    const upperPitches = pitches.filter((pitch) => pitch >= floor).slice(0, limit);
    if (upperPitches.length < 2) {
        return [];
    }

    const anchor = upperPitches[0];
    return upperPitches.map((pitch) => pitch - anchor);
}

function extractVoiceRolePitches(events, roles) {
    const roleSet = new Set((roles ?? []).filter((value) => typeof value === "string"));
    return (events ?? []).flatMap((event) => {
        if (!roleSet.has(event?.voiceRole)) {
            return [];
        }
        if (event?.type === "note" && Number.isFinite(event.pitch)) {
            return [event.pitch];
        }
        if (event?.type === "chord" && Array.isArray(event.pitches)) {
            return event.pitches.filter((value) => Number.isFinite(value));
        }
        return [];
    });
}

function average(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return null;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function motifShapeSimilarity(left, right) {
    const limit = Math.min(left.length, right.length);
    if (limit < 2) {
        return 0;
    }

    let total = 0;
    for (let index = 0; index < limit; index += 1) {
        total += Math.max(0, 1 - (Math.abs(left[index] - right[index]) / 7));
    }

    return Number((total / limit).toFixed(4));
}

test("compose worker accepts spelled-flat tonic names like E-flat major", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-spelled-flat-"));

    try {
        const outputPath = path.join(tempRoot, "spelled-flat.mid");
        const result = await runComposeWorker({
            prompt: "Write a short brass-led color study with woodwind support and a compact cadence.",
            key: "E-flat major",
            tempo: 84,
            form: "miniature",
            outputPath,
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker applies inversion and sequence transforms when motifPolicy allows development reuse", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-"));

    try {
        const outputPath = path.join(tempRoot, "motif-transform.mid");
        const result = await runComposeWorker({
            prompt: "Write a chamber fantasy whose development inverts and sequences the opening idea.",
            key: "C major",
            tempo: 92,
            form: "fantasia",
            outputPath,
            compositionPlan: {
                form: "fantasia",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: false,
                    diminutionAllowed: false,
                    sequenceAllowed: true,
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Theme",
                        measures: 4,
                        energy: 0.35,
                        density: 0.34,
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "medium",
                            cadence: "half",
                            allowModulation: false,
                        },
                    },
                    {
                        id: "s2",
                        role: "development",
                        label: "Development",
                        measures: 4,
                        energy: 0.68,
                        density: 0.56,
                        harmonicPlan: {
                            tonalCenter: "G major",
                            harmonicRhythm: "fast",
                            cadence: "half",
                            allowModulation: true,
                        },
                    },
                ],
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));
        assert.ok(Array.isArray(result.sectionTransforms));

        const developmentTransform = result.sectionTransforms.find((entry) => entry.sectionId === "s2");
        assert.ok(developmentTransform);
        assert.equal(developmentTransform.sourceSectionId, "s1");
        assert.equal(developmentTransform.transformMode, "inversion+sequence");
        assert.equal(developmentTransform.sequenceStride, 2);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker applies augmentation and diminution transforms to section note density", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-rhythm-"));

    try {
        const outputPath = path.join(tempRoot, "motif-rhythm-transform.mid");
        const result = await runComposeWorker({
            prompt: "Write a fantasy where the variation broadens the opening motif and the development compresses it.",
            key: "D minor",
            tempo: 88,
            form: "fantasia",
            outputPath,
            compositionPlan: {
                form: "fantasia",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: false,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: false,
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Theme",
                        measures: 4,
                        energy: 0.4,
                        density: 0.5,
                        harmonicPlan: {
                            tonalCenter: "D minor",
                            harmonicRhythm: "medium",
                            cadence: "half",
                            allowModulation: false,
                        },
                    },
                    {
                        id: "s2",
                        role: "variation",
                        label: "Broadening variation",
                        measures: 4,
                        energy: 0.38,
                        density: 0.5,
                        motifRef: "s1",
                        harmonicPlan: {
                            tonalCenter: "D minor",
                            harmonicRhythm: "slow",
                            cadence: "half",
                            allowModulation: false,
                        },
                    },
                    {
                        id: "s3",
                        role: "development",
                        label: "Compressed development",
                        measures: 4,
                        energy: 0.72,
                        density: 0.5,
                        motifRef: "s1",
                        harmonicPlan: {
                            tonalCenter: "A minor",
                            harmonicRhythm: "fast",
                            cadence: "half",
                            allowModulation: true,
                        },
                    },
                ],
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));
        assert.ok(Array.isArray(result.sectionTransforms));

        const variationTransform = result.sectionTransforms.find((entry) => entry.sectionId === "s2");
        const developmentTransform = result.sectionTransforms.find((entry) => entry.sectionId === "s3");

        assert.ok(variationTransform);
        assert.equal(variationTransform.sourceSectionId, "s1");
        assert.equal(variationTransform.transformMode, "augmentation");
        assert.equal(variationTransform.rhythmTransform, "augmentation");
        assert.ok((variationTransform.generatedNoteCount ?? 0) < (variationTransform.sourceNoteCount ?? 0));

        assert.ok(developmentTransform);
        assert.equal(developmentTransform.sourceSectionId, "s1");
        assert.equal(developmentTransform.transformMode, "diminution");
        assert.equal(developmentTransform.rhythmTransform, "diminution");
        assert.ok((developmentTransform.generatedNoteCount ?? 0) > (developmentTransform.sourceNoteCount ?? 0));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker infers a related-key route for development and returns recap to home tonic", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-route-"));

    try {
        const outputPath = path.join(tempRoot, "route.mid");
        const result = await runComposeWorker({
            prompt: "Write a sonata miniature with a modulatory development and a firm recap return.",
            key: "C major",
            tempo: 90,
            form: "miniature",
            seed: 2026,
            outputPath,
            compositionPlan: {
                form: "miniature",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Theme",
                        measures: 4,
                        energy: 0.4,
                        density: 0.36,
                        harmonicPlan: {
                            harmonicRhythm: "medium",
                            cadence: "half",
                            allowModulation: false,
                        },
                    },
                    {
                        id: "s2",
                        role: "development",
                        label: "Development",
                        measures: 4,
                        energy: 0.72,
                        density: 0.58,
                        harmonicPlan: {
                            harmonicRhythm: "fast",
                            cadence: "half",
                            allowModulation: true,
                        },
                    },
                    {
                        id: "s3",
                        role: "recap",
                        label: "Recap",
                        measures: 4,
                        energy: 0.34,
                        density: 0.3,
                        motifRef: "s1",
                        harmonicPlan: {
                            harmonicRhythm: "medium",
                            cadence: "authentic",
                            allowModulation: true,
                        },
                    },
                ],
            },
        });

        assert.equal(result.ok, true);
        assert.ok(Array.isArray(result.sectionTonalities));

        const themeRoute = result.sectionTonalities.find((entry) => entry.sectionId === "s1");
        const developmentRoute = result.sectionTonalities.find((entry) => entry.sectionId === "s2");
        const recapRoute = result.sectionTonalities.find((entry) => entry.sectionId === "s3");

        assert.equal(themeRoute?.tonalCenter, "C major");
        assert.equal(developmentRoute?.tonalCenter, "G major");
        assert.equal(recapRoute?.tonalCenter, "C major");
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker defaults sonata theme_b to the resolved secondary key when tonal centers are omitted", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-secondary-key-"));

    try {
        const outputPath = path.join(tempRoot, "secondary-key-route.mid");
        const sections = [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme A",
                measures: 4,
                energy: 0.42,
                density: 0.36,
                harmonicPlan: {
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: false,
                },
            },
            {
                id: "s2",
                role: "theme_b",
                label: "Theme B",
                measures: 4,
                energy: 0.52,
                density: 0.42,
                contrastFrom: "s1",
                harmonicPlan: {
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s3",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.72,
                density: 0.58,
                motifRef: "s1",
                harmonicPlan: {
                    harmonicRhythm: "fast",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s4",
                role: "recap",
                label: "Recap",
                measures: 4,
                energy: 0.34,
                density: 0.3,
                motifRef: "s1",
                harmonicPlan: {
                    harmonicRhythm: "medium",
                    cadence: "authentic",
                    allowModulation: false,
                },
            },
        ];

        const result = await runComposeWorker({
            prompt: "Write a compact sonata with a clear secondary-key exposition, modulatory development, and firm recap return.",
            key: "C major",
            tempo: 88,
            form: "sonata",
            seed: 20260401,
            outputPath,
            compositionPlan: {
                form: "sonata",
                meter: "4/4",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections,
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));

        const themeRoute = result.sectionTonalities.find((entry) => entry.sectionId === "s1");
        const secondaryRoute = result.sectionTonalities.find((entry) => entry.sectionId === "s2");
        const developmentRoute = result.sectionTonalities.find((entry) => entry.sectionId === "s3");
        const recapRoute = result.sectionTonalities.find((entry) => entry.sectionId === "s4");

        assert.equal(themeRoute?.tonalCenter, "C major");
        assert.equal(secondaryRoute?.tonalCenter, "G major");
        assert.equal(developmentRoute?.tonalCenter, "A minor");
        assert.equal(recapRoute?.tonalCenter, "C major");
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker keeps full recap motif returns literal under slow harmonic rhythm", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-recap-"));

    try {
        const outputPath = path.join(tempRoot, "recap.mid");
        const result = await runComposeWorker({
            prompt: "Write a compact sonata recap that clearly restates the opening theme.",
            key: "D minor",
            tempo: 84,
            form: "miniature",
            seed: 4040,
            outputPath,
            compositionPlan: {
                form: "miniature",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Theme",
                        measures: 4,
                        energy: 0.4,
                        density: 0.5,
                        harmonicPlan: {
                            tonalCenter: "D minor",
                            harmonicRhythm: "medium",
                            cadence: "half",
                            allowModulation: false,
                        },
                    },
                    {
                        id: "s2",
                        role: "development",
                        label: "Development",
                        measures: 4,
                        energy: 0.72,
                        density: 0.56,
                        motifRef: "s1",
                        harmonicPlan: {
                            tonalCenter: "A minor",
                            harmonicRhythm: "fast",
                            cadence: "half",
                            allowModulation: true,
                        },
                    },
                    {
                        id: "s3",
                        role: "recap",
                        label: "Recap",
                        measures: 4,
                        energy: 0.34,
                        density: 0.42,
                        motifRef: "s1",
                        recapMode: "full",
                        harmonicPlan: {
                            tonalCenter: "D minor",
                            harmonicRhythm: "slow",
                            cadence: "authentic",
                            allowModulation: false,
                        },
                    },
                ],
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));
        assert.ok(Array.isArray(result.sectionTransforms));

        const recapTransform = result.sectionTransforms.find((entry) => entry.sectionId === "s3");

        assert.ok(recapTransform);
        assert.equal(recapTransform.sourceSectionId, "s1");
        assert.equal(recapTransform.transformMode, "literal");
        assert.equal(recapTransform.rhythmTransform, "literal");
        assert.equal(recapTransform.generatedNoteCount, recapTransform.sourceNoteCount);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker differentiates abbreviated and varied recap modes even without rhythm transforms", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-recap-modes-"));

    const buildPayload = (recapMode, outputPath) => ({
        prompt: "Write a compact recap that restates the opening idea with distinct return treatments.",
        key: "C major",
        tempo: 88,
        form: "miniature",
        seed: 2026,
        outputPath,
        compositionPlan: {
            form: "miniature",
            sketch: {
                motifDrafts: [
                    {
                        id: "theme-draft",
                        sectionId: "s1",
                        intervals: [0, 2, 4, 1, 3, 0],
                    },
                ],
                cadenceOptions: [],
            },
            motifPolicy: {
                reuseRequired: true,
                inversionAllowed: false,
                augmentationAllowed: false,
                diminutionAllowed: false,
                sequenceAllowed: false,
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Theme",
                    measures: 4,
                    energy: 0.4,
                    density: 0.34,
                    harmonicPlan: {
                        tonalCenter: "C major",
                        harmonicRhythm: "medium",
                        cadence: "half",
                        allowModulation: false,
                    },
                },
                {
                    id: "s2",
                    role: "recap",
                    label: "Recap",
                    measures: 4,
                    energy: 0.32,
                    density: 0.3,
                    motifRef: "s1",
                    recapMode,
                    harmonicPlan: {
                        tonalCenter: "C major",
                        harmonicRhythm: "medium",
                        cadence: "authentic",
                        allowModulation: false,
                    },
                },
            ],
        },
    });

    try {
        const full = await runComposeWorker(buildPayload("full", path.join(tempRoot, "full.mid")));
        const abbreviated = await runComposeWorker(buildPayload("abbreviated", path.join(tempRoot, "abbreviated.mid")));
        const varied = await runComposeWorker(buildPayload("varied", path.join(tempRoot, "varied.mid")));

        assert.equal(full.ok, true);
        assert.equal(abbreviated.ok, true);
        assert.equal(varied.ok, true);

        const fullTransform = full.sectionTransforms.find((entry) => entry.sectionId === "s2");
        const abbreviatedTransform = abbreviated.sectionTransforms.find((entry) => entry.sectionId === "s2");
        const variedTransform = varied.sectionTransforms.find((entry) => entry.sectionId === "s2");

        assert.ok(fullTransform);
        assert.ok(abbreviatedTransform);
        assert.ok(variedTransform);

        assert.equal(fullTransform.transformMode, "literal");
        assert.equal(fullTransform.rhythmTransform, "literal");
        assert.equal(fullTransform.resolvedMotifLength, fullTransform.sourceMotifLength);
        assert.deepEqual(fullTransform.resolvedMotifIntervals, fullTransform.sourceMotifIntervals);
        assert.deepEqual(abbreviatedTransform.sourceMotifIntervals, fullTransform.sourceMotifIntervals);
        assert.deepEqual(variedTransform.sourceMotifIntervals, fullTransform.sourceMotifIntervals);

        assert.equal(abbreviatedTransform.rhythmTransform, "literal");
        assert.equal(abbreviatedTransform.transformMode, "abbreviated");
        assert.ok((abbreviatedTransform.resolvedMotifLength ?? 0) < (abbreviatedTransform.sourceMotifLength ?? 0));
        assert.deepEqual(
            abbreviatedTransform.resolvedMotifIntervals,
            abbreviatedTransform.sourceMotifIntervals.slice(0, abbreviatedTransform.resolvedMotifLength),
        );

        assert.equal(variedTransform.rhythmTransform, "literal");
        assert.equal(variedTransform.transformMode, "varied");
        assert.equal(variedTransform.resolvedMotifLength, variedTransform.sourceMotifLength);
        assert.notDeepEqual(variedTransform.resolvedMotifIntervals, variedTransform.sourceMotifIntervals);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker realizes distinct motivic, textural, and free development types", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-development-type-"));

    const buildPayload = (developmentType, outputPath) => ({
        prompt: "Write a compact miniature whose development changes character by development type.",
        key: "C major",
        tempo: 92,
        form: "miniature",
        seed: 2026,
        outputPath,
        compositionPlan: {
            form: "miniature",
            sketch: {
                motifDrafts: [
                    {
                        id: "theme-draft",
                        sectionId: "s1",
                        intervals: [0, 5, -3, 6, -2],
                    },
                ],
                cadenceOptions: [],
            },
            motifPolicy: {
                reuseRequired: true,
                inversionAllowed: false,
                augmentationAllowed: false,
                diminutionAllowed: false,
                sequenceAllowed: false,
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Theme",
                    measures: 4,
                    energy: 0.42,
                    density: 0.36,
                    harmonicPlan: {
                        tonalCenter: "C major",
                        harmonicRhythm: "medium",
                        cadence: "half",
                        allowModulation: false,
                    },
                },
                {
                    id: "s2",
                    role: "development",
                    label: "Development",
                    measures: 4,
                    energy: 0.64,
                    density: 0.56,
                    motifRef: "s1",
                    developmentType,
                    harmonicPlan: {
                        tonalCenter: "G major",
                        harmonicRhythm: "medium",
                        cadence: "half",
                        allowModulation: true,
                    },
                },
            ],
        },
    });

    try {
        const motivic = await runComposeWorker(buildPayload("motivic", path.join(tempRoot, "motivic.mid")));
        const textural = await runComposeWorker(buildPayload("textural", path.join(tempRoot, "textural.mid")));
        const free = await runComposeWorker(buildPayload("free", path.join(tempRoot, "free.mid")));

        assert.equal(motivic.ok, true);
        assert.equal(textural.ok, true);
        assert.equal(free.ok, true);

        const motivicTransform = motivic.sectionTransforms.find((entry) => entry.sectionId === "s2");
        const texturalTransform = textural.sectionTransforms.find((entry) => entry.sectionId === "s2");
        const freeTransform = free.sectionTransforms.find((entry) => entry.sectionId === "s2");

        const motivicArtifact = motivic.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        const texturalArtifact = textural.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        const freeArtifact = free.sectionArtifacts.find((entry) => entry.sectionId === "s2");

        assert.ok(motivicTransform);
        assert.ok(texturalTransform);
        assert.ok(freeTransform);
        assert.ok(motivicArtifact);
        assert.ok(texturalArtifact);
        assert.ok(freeArtifact);

        assert.equal(motivicTransform.developmentType, "motivic");
        assert.equal(motivicTransform.transformMode, "motivic");
        assert.equal(motivicTransform.rhythmTransform, "literal");
        assert.deepEqual(motivicTransform.resolvedMotifIntervals, motivicTransform.sourceMotifIntervals);

        assert.equal(texturalTransform.developmentType, "textural");
        assert.equal(texturalTransform.transformMode, "textural");
        assert.equal(texturalTransform.rhythmTransform, "literal");
        assert.notDeepEqual(texturalTransform.resolvedMotifIntervals, texturalTransform.sourceMotifIntervals);
        assert.ok(texturalTransform.resolvedMotifIntervals.slice(1).every((interval) => Math.abs(interval) <= 1));

        assert.equal(freeTransform.developmentType, "free");
        assert.equal(freeTransform.transformMode, "free");
        assert.equal(freeTransform.rhythmTransform, "literal");
        assert.notDeepEqual(freeTransform.resolvedMotifIntervals, freeTransform.sourceMotifIntervals);
        assert.ok(freeTransform.resolvedMotifIntervals.slice(1).some((interval) => Math.abs(interval) >= 3));

        assert.equal(motivicArtifact.developmentType, "motivic");
        assert.equal(texturalArtifact.developmentType, "textural");
        assert.equal(freeArtifact.developmentType, "free");
        assert.equal(motivicArtifact.sectionStyle, "broken");
        assert.equal(texturalArtifact.sectionStyle, "arpeggio");
        assert.equal(freeArtifact.sectionStyle, "march");
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker preserves inverted development contour strongly enough to clear narrative critique", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-development-narrative-"));
    const outputPath = path.join(tempRoot, "development-narrative.mid");
    const sections = [
        {
            id: "s1",
            role: "theme_a",
            label: "Theme",
            measures: 4,
            energy: 0.4,
            density: 0.36,
            harmonicPlan: {
                tonalCenter: "C major",
                harmonicRhythm: "medium",
                cadence: "half",
                allowModulation: false,
            },
        },
        {
            id: "s2",
            role: "development",
            label: "Development",
            measures: 4,
            energy: 0.7,
            density: 0.58,
            motifRef: "s1",
            harmonicPlan: {
                tonalCenter: "G major",
                harmonicRhythm: "fast",
                cadence: "half",
                allowModulation: true,
            },
        },
        {
            id: "s3",
            role: "cadence",
            label: "Close",
            measures: 4,
            energy: 0.28,
            density: 0.24,
            cadence: "authentic",
            harmonicPlan: {
                tonalCenter: "C major",
                harmonicRhythm: "slow",
                cadence: "authentic",
                allowModulation: false,
            },
        },
    ];

    try {
        const result = await runComposeWorker({
            prompt: "Write a compact sonata with a clear closing cadence.",
            key: "C major",
            tempo: 88,
            form: "sonata",
            seed: 20260424,
            outputPath,
            compositionPlan: {
                form: "sonata",
                meter: "4/4",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections,
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));

        const developmentTransform = result.sectionTransforms.find((entry) => entry.sectionId === "s2");
        const developmentArtifact = result.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        assert.ok(developmentTransform);
        assert.ok(developmentArtifact);
        assert.equal(developmentTransform?.transformMode, "inversion+diminution+sequence");
        assert.ok(Math.min(...(developmentArtifact?.capturedMotif ?? [0])) <= -7);

        const critiqueResult = await critique(fs.readFileSync(outputPath), "compose-development-narrative", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });

        assert.ok((critiqueResult.metrics?.developmentNarrativeFit ?? 0) >= 0.5);
        assert.ok(!(critiqueResult.issues ?? []).includes("Development section does not meaningfully transform earlier thematic material."));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker realizes strong planned cadence sections with firmer bass support", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-cadence-strength-"));

    const buildPlan = (cadenceStrength) => ({
        form: "miniature",
        meter: "4/4",
        motifPolicy: {
            reuseRequired: true,
            inversionAllowed: false,
            augmentationAllowed: true,
            diminutionAllowed: true,
            sequenceAllowed: false,
        },
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.42,
                density: 0.36,
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: false,
                },
            },
            {
                id: "s2",
                role: "cadence",
                label: "Closing",
                measures: 4,
                energy: 0.28,
                density: 0.26,
                cadenceStrength,
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "slow",
                    cadence: "authentic",
                    allowModulation: false,
                },
            },
        ],
    });

    try {
        const softPath = path.join(tempRoot, "soft.mid");
        const strongPath = path.join(tempRoot, "strong.mid");

        const soft = await runComposeWorker({
            prompt: "Write a miniature with a gentle close.",
            key: "C major",
            tempo: 82,
            form: "miniature",
            seed: 5151,
            outputPath: softPath,
            compositionPlan: buildPlan(0.22),
        });
        const strong = await runComposeWorker({
            prompt: "Write a miniature with a gentle close.",
            key: "C major",
            tempo: 82,
            form: "miniature",
            seed: 5151,
            outputPath: strongPath,
            compositionPlan: buildPlan(0.92),
        });

        assert.equal(soft.ok, true);
        assert.equal(strong.ok, true);

        const softCadenceArtifact = soft.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        const strongCadenceArtifact = strong.sectionArtifacts.find((entry) => entry.sectionId === "s2");

        assert.ok(softCadenceArtifact);
        assert.ok(strongCadenceArtifact);
        assert.equal(softCadenceArtifact.sectionStyle, "block");
        assert.equal(strongCadenceArtifact.sectionStyle, "block");
        assert.equal(softCadenceArtifact.accompanimentEvents?.length, 8);
        assert.equal(strongCadenceArtifact.accompanimentEvents?.length, 10);
        assert.equal(softCadenceArtifact.accompanimentEvents?.at(-2)?.type, "chord");
        assert.equal(strongCadenceArtifact.accompanimentEvents?.at(-4)?.type, "note");
        assert.equal(strongCadenceArtifact.cadenceApproach, "dominant");
        assert.notDeepEqual(
            strongCadenceArtifact.accompanimentEvents?.slice(-4),
            softCadenceArtifact.accompanimentEvents?.slice(-2),
        );
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker realizes planned voicing profiles with distinct accompaniment patterns", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-voicing-profile-"));

    const buildPlan = (voicingProfile) => ({
        form: "miniature",
        meter: "4/4",
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 4,
                energy: 0.4,
                density: 0.34,
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    harmonyDensity: "medium",
                    voicingProfile,
                    cadence: "half",
                    allowModulation: false,
                },
            },
        ],
    });

    try {
        const blockPath = path.join(tempRoot, "block.mid");
        const brokenPath = path.join(tempRoot, "broken.mid");
        const arpeggiatedPath = path.join(tempRoot, "arpeggiated.mid");

        const block = await runComposeWorker({
            prompt: "Write a compact miniature with a stable harmonic bed.",
            key: "C major",
            tempo: 84,
            form: "miniature",
            seed: 6112,
            outputPath: blockPath,
            compositionPlan: buildPlan("block"),
        });
        const broken = await runComposeWorker({
            prompt: "Write a compact miniature with a stable harmonic bed.",
            key: "C major",
            tempo: 84,
            form: "miniature",
            seed: 6112,
            outputPath: brokenPath,
            compositionPlan: buildPlan("broken"),
        });
        const arpeggiated = await runComposeWorker({
            prompt: "Write a compact miniature with a stable harmonic bed.",
            key: "C major",
            tempo: 84,
            form: "miniature",
            seed: 6112,
            outputPath: arpeggiatedPath,
            compositionPlan: buildPlan("arpeggiated"),
        });

        assert.equal(block.ok, true);
        assert.equal(broken.ok, true);
        assert.equal(arpeggiated.ok, true);

        const blockArtifact = block.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const brokenArtifact = broken.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const arpeggiatedArtifact = arpeggiated.sectionArtifacts.find((entry) => entry.sectionId === "s1");

        assert.ok(blockArtifact);
        assert.ok(brokenArtifact);
        assert.ok(arpeggiatedArtifact);

        assert.equal(blockArtifact.voicingProfile, "block");
        assert.equal(brokenArtifact.voicingProfile, "broken");
        assert.equal(arpeggiatedArtifact.voicingProfile, "arpeggiated");
        assert.equal(blockArtifact.sectionStyle, "block");
        assert.equal(brokenArtifact.sectionStyle, "block");
        assert.equal(arpeggiatedArtifact.sectionStyle, "block");
        assert.equal(blockArtifact.accompanimentEvents?.length, 8);
        assert.equal(brokenArtifact.accompanimentEvents?.length, 32);
        assert.equal(arpeggiatedArtifact.accompanimentEvents?.length, 32);
        assert.ok(blockArtifact.accompanimentEvents?.some((event) => event.type === "chord"));
        assert.ok(brokenArtifact.accompanimentEvents?.every((event) => event.type === "note"));
        assert.ok(arpeggiatedArtifact.accompanimentEvents?.every((event) => event.type === "note"));

        const brokenMaxPitch = Math.max(
            ...brokenArtifact.accompanimentEvents.map((event) => event.pitch ?? Number.NEGATIVE_INFINITY),
        );
        const arpeggiatedMaxPitch = Math.max(
            ...arpeggiatedArtifact.accompanimentEvents.map((event) => event.pitch ?? Number.NEGATIVE_INFINITY),
        );

        assert.ok(arpeggiatedMaxPitch > brokenMaxPitch);
        assert.notDeepEqual(
            brokenArtifact.accompanimentEvents?.slice(0, 8),
            arpeggiatedArtifact.accompanimentEvents?.slice(0, 8),
        );
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker realizes planned harmony density with distinct accompaniment thickness", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-harmony-density-"));

    const buildPlan = (harmonyDensity) => ({
        form: "miniature",
        meter: "4/4",
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 4,
                energy: 0.4,
                density: 0.34,
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    harmonyDensity,
                    voicingProfile: "block",
                    cadence: "half",
                    allowModulation: false,
                },
            },
        ],
    });

    try {
        const sparsePath = path.join(tempRoot, "sparse.mid");
        const mediumPath = path.join(tempRoot, "medium.mid");
        const richPath = path.join(tempRoot, "rich.mid");

        const sparse = await runComposeWorker({
            prompt: "Write a compact miniature with a stable harmonic bed.",
            key: "C major",
            tempo: 84,
            form: "miniature",
            seed: 7331,
            outputPath: sparsePath,
            compositionPlan: buildPlan("sparse"),
        });
        const medium = await runComposeWorker({
            prompt: "Write a compact miniature with a stable harmonic bed.",
            key: "C major",
            tempo: 84,
            form: "miniature",
            seed: 7331,
            outputPath: mediumPath,
            compositionPlan: buildPlan("medium"),
        });
        const rich = await runComposeWorker({
            prompt: "Write a compact miniature with a stable harmonic bed.",
            key: "C major",
            tempo: 84,
            form: "miniature",
            seed: 7331,
            outputPath: richPath,
            compositionPlan: buildPlan("rich"),
        });

        assert.equal(sparse.ok, true);
        assert.equal(medium.ok, true);
        assert.equal(rich.ok, true);

        const sparseArtifact = sparse.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const mediumArtifact = medium.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const richArtifact = rich.sectionArtifacts.find((entry) => entry.sectionId === "s1");

        assert.ok(sparseArtifact);
        assert.ok(mediumArtifact);
        assert.ok(richArtifact);

        assert.equal(sparseArtifact.harmonyDensity, "sparse");
        assert.equal(mediumArtifact.harmonyDensity, "medium");
        assert.equal(richArtifact.harmonyDensity, "rich");
        assert.equal(sparseArtifact.voicingProfile, "block");
        assert.equal(mediumArtifact.voicingProfile, "block");
        assert.equal(richArtifact.voicingProfile, "block");
        assert.equal(sparseArtifact.accompanimentEvents?.at(0)?.type, "note");
        assert.equal(mediumArtifact.accompanimentEvents?.at(0)?.type, "chord");
        assert.equal(richArtifact.accompanimentEvents?.at(0)?.type, "chord");

        const maxChordSize = (artifact) => Math.max(
            ...artifact.accompanimentEvents
                .filter((event) => event.type === "chord")
                .map((event) => event.pitches.length),
        );

        assert.equal(maxChordSize(sparseArtifact), 2);
        assert.equal(maxChordSize(mediumArtifact), 3);
        assert.equal(maxChordSize(richArtifact), 4);
        assert.notDeepEqual(
            sparseArtifact.accompanimentEvents?.slice(0, 2),
            richArtifact.accompanimentEvents?.slice(0, 2),
        );
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker realizes imitative counterline sections as answer-like upper strands", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-imitative-"));

    try {
        const baseOutputPath = path.join(tempRoot, "base.mid");
        const revisedOutputPath = path.join(tempRoot, "revised.mid");
        const basePlan = {
            form: "miniature",
            motifPolicy: {
                reuseRequired: true,
                inversionAllowed: false,
                augmentationAllowed: false,
                diminutionAllowed: false,
                sequenceAllowed: false,
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Theme",
                    measures: 4,
                    energy: 0.34,
                    density: 0.3,
                    harmonicPlan: {
                        tonalCenter: "C major",
                        harmonicRhythm: "medium",
                        cadence: "half",
                        allowModulation: false,
                    },
                },
                {
                    id: "s2",
                    role: "development",
                    label: "Answer",
                    measures: 4,
                    energy: 0.56,
                    density: 0.34,
                    harmonicPlan: {
                        tonalCenter: "G major",
                        harmonicRhythm: "medium",
                        cadence: "half",
                        allowModulation: true,
                    },
                },
            ],
        };

        const revisedPlan = {
            ...basePlan,
            sections: [
                basePlan.sections[0],
                {
                    ...basePlan.sections[1],
                    motifRef: "s1",
                    texture: {
                        voiceCount: 3,
                        primaryRoles: ["lead", "counterline", "bass"],
                        counterpointMode: "imitative",
                        notes: ["Keep the answer audible above the bass."],
                    },
                },
            ],
        };

        const baseResult = await runComposeWorker({
            prompt: "Write a short piano invention with a plain opening and a restrained middle.",
            key: "C major",
            tempo: 90,
            form: "miniature",
            seed: 20260452,
            outputPath: baseOutputPath,
            compositionPlan: basePlan,
        });

        const reusableSections = structuredClone(baseResult.sectionArtifacts);
        const openingArtifact = reusableSections.find((entry) => entry.sectionId === "s1");
        assert.ok(openingArtifact);
        openingArtifact.capturedMotif = [0, 5, 2, 7, 4];

        const revisedResult = await runComposeWorker({
            prompt: "Write a short piano invention with an answer-like upper strand above the bass.",
            key: "C major",
            tempo: 90,
            form: "miniature",
            seed: 20260452,
            stableSeed: 20260452,
            outputPath: revisedOutputPath,
            compositionPlan: revisedPlan,
            revisionDirectives: [
                {
                    kind: "clarify_texture_plan",
                    priority: 80,
                    reason: "Make the imitative answer audible in the upper accompaniment strand.",
                    sectionIds: ["s2"],
                },
            ],
            sectionArtifacts: reusableSections,
            attemptIndex: 2,
        });

        assert.equal(baseResult.ok, true);
        assert.equal(revisedResult.ok, true);

        const answerArtifact = revisedResult.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        assert.ok(answerArtifact);
        assert.equal(answerArtifact.textureVoiceCount, 3);
        assert.deepEqual(answerArtifact.primaryTextureRoles, ["lead", "counterline", "bass"]);
        assert.equal(answerArtifact.counterpointMode, "imitative");
        assert.ok(Array.isArray(answerArtifact.secondaryLineMotif));
        assert.ok((answerArtifact.secondaryLinePitchCount ?? 0) >= 6);
        assert.ok((answerArtifact.textureIndependentMotionRate ?? 0) >= 0.45);
        assert.ok(answerArtifact.accompanimentEvents.every((event) => event.type === "note"));
        assert.ok(answerArtifact.accompanimentEvents.some((event) => event.voiceRole === "counterline"));
        assert.ok(answerArtifact.accompanimentEvents.some((event) => event.voiceRole === "bass"));

        const upperShape = extractUpperStrandShape(answerArtifact.accompanimentEvents, 5);
        assert.ok(upperShape.length >= 4);
        assert.ok(
            motifShapeSimilarity(upperShape, openingArtifact.capturedMotif) >= 0.5,
            JSON.stringify({ upperShape, motif: openingArtifact.capturedMotif, answerArtifact }),
        );
        assert.ok(
            motifShapeSimilarity(answerArtifact.secondaryLineMotif, openingArtifact.capturedMotif) >= 0.5,
            JSON.stringify({ secondaryLineMotif: answerArtifact.secondaryLineMotif, motif: openingArtifact.capturedMotif, answerArtifact }),
        );
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker applies expression defaults and section overrides to melody articulation", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-expression-articulation-"));

    try {
        const outputPath = path.join(tempRoot, "expression-articulation.mid");
        const result = await runComposeWorker({
            prompt: "Write a compact piano miniature with a tender opening and an agitated reply.",
            key: "C major",
            tempo: 86,
            form: "miniature",
            seed: 8801,
            outputPath,
            compositionPlan: {
                form: "miniature",
                meter: "4/4",
                textureDefaults: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                    notes: ["Keep the middle voice subdued."],
                },
                expressionDefaults: {
                    dynamics: { start: "p", peak: "mp", end: "p" },
                    articulation: ["legato"],
                    character: ["dolce"],
                    sustainBias: 0.35,
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Opening",
                        measures: 4,
                        energy: 0.34,
                        density: 0.34,
                        phraseFunction: "presentation",
                        phraseSpanShape: "sentence",
                        continuationPressure: "low",
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "medium",
                            prolongationMode: "tonic",
                            tonicizationWindows: [{ startMeasure: 3, endMeasure: 4, keyTarget: "G major", emphasis: "prepared", cadence: "half" }],
                            colorCues: [
                                { tag: "mixture", startMeasure: 2, endMeasure: 3, notes: ["Darken the reply briefly."] },
                                { tag: "applied dominant", startMeasure: 3, endMeasure: 4, keyTarget: "G major" },
                            ],
                            cadence: "half",
                            allowModulation: true,
                        },
                    },
                    {
                        id: "s2",
                        role: "theme_a",
                        label: "Reply",
                        measures: 4,
                        energy: 0.46,
                        density: 0.34,
                        phraseFunction: "continuation",
                        phraseSpanShape: "continuation_chain",
                        continuationPressure: "high",
                        cadentialBuildup: "surging",
                        texture: {
                            voiceCount: 2,
                            primaryRoles: ["lead", "chordal_support", "bass"],
                            counterpointMode: "none",
                            notes: ["Keep the bass punctual."],
                        },
                        expression: {
                            articulation: ["staccato", "accent"],
                            character: ["agitato"],
                            sustainBias: -0.55,
                            accentBias: 0.65,
                            phrasePeaks: [2],
                        },
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "medium",
                            prolongationMode: "pedal",
                            tonicizationWindows: [{ startMeasure: 2, endMeasure: 3, keyTarget: "G major", emphasis: "arriving", cadence: "half" }],
                            colorCues: [
                                { tag: "predominant color", startMeasure: 1, endMeasure: 2 },
                                { tag: "suspension", startMeasure: 3, resolutionMeasure: 4, intensity: 0.6 },
                            ],
                            cadence: "half",
                            allowModulation: true,
                        },
                    },
                ],
            },
        });

        assert.equal(result.ok, true);

        const openingArtifact = result.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const replyArtifact = result.sectionArtifacts.find((entry) => entry.sectionId === "s2");

        assert.ok(openingArtifact);
        assert.ok(replyArtifact);

        assert.deepEqual(openingArtifact.articulation, ["legato"]);
        assert.deepEqual(openingArtifact.character, ["dolce"]);
        assert.equal(openingArtifact.sustainBias, 0.35);
        assert.deepEqual(openingArtifact.expressionDynamics, { start: "p", peak: "mp", end: "p" });
        assert.equal(openingArtifact.phraseFunction, "presentation");
        assert.equal(openingArtifact.phraseSpanShape, "sentence");
        assert.equal(openingArtifact.continuationPressure, "low");
        assert.equal(openingArtifact.textureVoiceCount, 3);
        assert.deepEqual(openingArtifact.primaryTextureRoles, ["lead", "inner_voice", "bass"]);
        assert.equal(openingArtifact.counterpointMode, "contrary_motion");
        assert.ok((openingArtifact.secondaryLinePitchCount ?? 0) >= 4);
        assert.ok((openingArtifact.secondaryLineSpan ?? 0) >= 4);
        assert.ok((openingArtifact.textureIndependentMotionRate ?? 0) >= 0.45);
        assert.ok((openingArtifact.textureContraryMotionRate ?? 0) >= 0.3);
        const openingInnerVoice = extractVoiceRolePitches(openingArtifact.accompanimentEvents, ["inner_voice"]);
        const openingBass = extractVoiceRolePitches(openingArtifact.accompanimentEvents, ["bass"]);
        assert.ok(openingInnerVoice.length >= 4);
        assert.ok(openingBass.length >= 1);
        assert.ok((average(openingInnerVoice) ?? 0) > Math.min(...openingBass) + 4);
        assert.ok((average(openingInnerVoice) ?? 128) < (average(openingArtifact.noteHistory) ?? 128));
        assert.equal(openingArtifact.prolongationMode, "tonic");
        assert.equal(openingArtifact.tonicizationWindows?.[0]?.keyTarget, "G major");
        assert.equal(openingArtifact.tonicizationWindows?.[0]?.emphasis, "prepared");
        assert.equal(openingArtifact.harmonicColorCues?.[0]?.tag, "mixture");
        assert.equal(openingArtifact.harmonicColorCues?.[1]?.tag, "applied_dominant");
        assert.equal(openingArtifact.harmonicColorCues?.[1]?.keyTarget, "G major");

        assert.deepEqual(replyArtifact.articulation, ["staccato", "accent"]);
        assert.deepEqual(replyArtifact.character, ["agitato"]);
        assert.equal(replyArtifact.sustainBias, -0.55);
        assert.equal(replyArtifact.accentBias, 0.65);
        assert.deepEqual(replyArtifact.phrasePeaks, [2]);
        assert.deepEqual(replyArtifact.expressionDynamics, { start: "p", peak: "mp", end: "p" });
        assert.equal(replyArtifact.phraseFunction, "continuation");
        assert.equal(replyArtifact.phraseSpanShape, "continuation_chain");
        assert.equal(replyArtifact.continuationPressure, "high");
        assert.equal(replyArtifact.cadentialBuildup, "surging");
        assert.equal(replyArtifact.textureVoiceCount, 2);
        assert.deepEqual(replyArtifact.primaryTextureRoles, ["lead", "chordal_support", "bass"]);
        assert.equal(replyArtifact.counterpointMode, "none");
        assert.deepEqual(replyArtifact.textureNotes, ["Keep the bass punctual."]);
        assert.equal(replyArtifact.prolongationMode, "pedal");
        assert.equal(replyArtifact.tonicizationWindows?.[0]?.keyTarget, "G major");
        assert.equal(replyArtifact.tonicizationWindows?.[0]?.emphasis, "arriving");
        assert.equal(replyArtifact.harmonicColorCues?.[0]?.tag, "predominant_color");
        assert.equal(replyArtifact.harmonicColorCues?.[1]?.tag, "suspension");
        assert.equal(replyArtifact.harmonicColorCues?.[1]?.resolutionMeasure, 4);

        const openingTonality = result.sectionTonalities.find((entry) => entry.sectionId === "s1");
        const replyTonality = result.sectionTonalities.find((entry) => entry.sectionId === "s2");

        assert.ok(openingTonality);
        assert.ok(replyTonality);
        assert.equal(openingTonality.prolongationMode, "tonic");
        assert.equal(openingTonality.tonicizationWindows?.[0]?.keyTarget, "G major");
        assert.equal(openingTonality.harmonicColorCues?.[0]?.tag, "mixture");
        assert.equal(replyTonality.prolongationMode, "pedal");
        assert.equal(replyTonality.tonicizationWindows?.[0]?.emphasis, "arriving");
        assert.equal(replyTonality.harmonicColorCues?.[0]?.tag, "predominant_color");

        const openingRests = openingArtifact.melodyEvents.filter((event) => event.type === "rest").length;
        const replyRests = replyArtifact.melodyEvents.filter((event) => event.type === "rest").length;

        assert.ok(replyRests >= openingRests);
        assert.ok((replyArtifact.melodyVelocityMax ?? 0) > (openingArtifact.melodyVelocityMax ?? 0));
        assert.ok((replyArtifact.accompanimentVelocityMax ?? 0) > (openingArtifact.accompanimentVelocityMax ?? 0));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker realizes extended expression tags in artifacts and melodic shaping", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-extended-expression-"));

    try {
        const outputPath = path.join(tempRoot, "extended-expression.mid");
        const result = await runComposeWorker({
            prompt: "Write a compact piano study that starts sustained and graceful, then turns sharply accented.",
            key: "C major",
            tempo: 92,
            form: "miniature",
            seed: 8802,
            outputPath,
            compositionPlan: {
                form: "miniature",
                meter: "4/4",
                expressionDefaults: {
                    dynamics: { start: "mp", peak: "mf", end: "mp" },
                    articulation: ["tenuto", "sostenuto"],
                    character: ["tranquillo", "grazioso"],
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Graceful opening",
                        measures: 4,
                        energy: 0.34,
                        density: 0.32,
                        cadence: "half",
                        harmonicPlan: {
                            tonalCenter: "C major",
                            cadence: "half",
                            harmonicRhythm: "medium",
                        },
                    },
                    {
                        id: "s2",
                        role: "theme_b",
                        label: "Sharper answer",
                        measures: 4,
                        energy: 0.34,
                        density: 0.32,
                        cadence: "authentic",
                        expression: {
                            articulation: ["staccatissimo", "marcato"],
                            character: ["energico"],
                        },
                        harmonicPlan: {
                            tonalCenter: "G major",
                            cadence: "authentic",
                            harmonicRhythm: "medium",
                            allowModulation: true,
                        },
                    },
                ],
            },
        });

        assert.equal(result.ok, true);

        const openingArtifact = result.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const replyArtifact = result.sectionArtifacts.find((entry) => entry.sectionId === "s2");

        assert.ok(openingArtifact);
        assert.ok(replyArtifact);

        assert.deepEqual(openingArtifact.articulation, ["tenuto", "sostenuto"]);
        assert.deepEqual(openingArtifact.character, ["tranquillo", "grazioso"]);
        assert.deepEqual(replyArtifact.articulation, ["staccatissimo", "marcato"]);
        assert.deepEqual(replyArtifact.character, ["energico"]);

        const averageNoteDuration = (artifact) => average(
            artifact.melodyEvents
                .filter((event) => event.type === "note")
                .map((event) => event.quarterLength),
        ) ?? 0;

        const openingAverageDuration = averageNoteDuration(openingArtifact);
        const replyAverageDuration = averageNoteDuration(replyArtifact);

        assert.ok(openingAverageDuration > replyAverageDuration + 0.08, JSON.stringify({
            openingAverageDuration,
            replyAverageDuration,
            openingArticulation: openingArtifact.articulation,
            replyArticulation: replyArtifact.articulation,
        }));
        assert.ok((replyArtifact.melodyVelocityMax ?? 0) > (openingArtifact.melodyVelocityMax ?? 0));
        assert.ok((replyArtifact.accompanimentVelocityMax ?? 0) > (openingArtifact.accompanimentVelocityMax ?? 0));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker localizes clarify_texture_plan retries by reusing untouched sections and strengthening the targeted counterline", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-targeted-texture-"));

    try {
        const baseOutputPath = path.join(tempRoot, "base.mid");
        const revisedOutputPath = path.join(tempRoot, "revised.mid");
        const basePlan = {
            version: "planner-schema-v2",
            brief: "Keep the opening stable and let the development grow into a clearer layered texture.",
            mood: ["dramatic"],
            form: "miniature",
            targetDurationSec: 48,
            targetMeasures: 8,
            workflow: "symbolic_only",
            instrumentation: [{ name: "piano", family: "keyboard", roles: ["lead", "bass", "chordal_support"], register: "wide" }],
            motifPolicy: { reuseRequired: true },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 4,
                    energy: 0.34,
                    density: 0.28,
                    harmonicPlan: {
                        tonalCenter: "C major",
                        harmonicRhythm: "medium",
                        cadence: "half",
                        allowModulation: false,
                    },
                },
                {
                    id: "s2",
                    role: "development",
                    label: "Development",
                    measures: 4,
                    energy: 0.74,
                    density: 0.46,
                    harmonicPlan: {
                        tonalCenter: "G major",
                        harmonicRhythm: "fast",
                        cadence: "half",
                        allowModulation: true,
                    },
                },
            ],
        };
        const revisedPlan = {
            ...basePlan,
            sections: [
                basePlan.sections[0],
                {
                    ...basePlan.sections[1],
                    density: 0.52,
                    texture: {
                        voiceCount: 3,
                        primaryRoles: ["lead", "inner_voice", "bass"],
                        counterpointMode: "contrary_motion",
                        notes: ["Keep clearly differentiated active voices."],
                    },
                    notes: ["Keep the development clearly layered rather than flat."],
                },
            ],
        };

        const baseResult = await runComposeWorker({
            prompt: "Write a short piano miniature whose development initially stays too flat.",
            key: "C major",
            tempo: 90,
            form: "miniature",
            seed: 20260448,
            outputPath: baseOutputPath,
            compositionPlan: basePlan,
        });
        const revisedResult = await runComposeWorker({
            prompt: "Write a short piano miniature whose development initially stays too flat.",
            key: "C major",
            tempo: 90,
            form: "miniature",
            seed: 20260448,
            stableSeed: 20260448,
            outputPath: revisedOutputPath,
            compositionPlan: revisedPlan,
            revisionDirectives: [
                {
                    kind: "clarify_texture_plan",
                    priority: 78,
                    reason: "Keep the requested layered development explicit.",
                    sectionIds: ["s2"],
                },
            ],
            sectionArtifacts: baseResult.sectionArtifacts,
            attemptIndex: 2,
        });

        assert.equal(baseResult.ok, true);
        assert.equal(revisedResult.ok, true);

        const baseOpening = baseResult.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const baseDevelopment = baseResult.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        const revisedOpening = revisedResult.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const revisedDevelopment = revisedResult.sectionArtifacts.find((entry) => entry.sectionId === "s2");

        assert.ok(baseOpening);
        assert.ok(baseDevelopment);
        assert.ok(revisedOpening);
        assert.ok(revisedDevelopment);

        assert.deepEqual(revisedOpening, baseOpening);
        assert.equal(revisedDevelopment.textureVoiceCount, 3);
        assert.deepEqual(revisedDevelopment.primaryTextureRoles, ["lead", "inner_voice", "bass"]);
        assert.equal(revisedDevelopment.counterpointMode, "contrary_motion");
        assert.notDeepEqual(revisedDevelopment.accompanimentEvents, baseDevelopment.accompanimentEvents);
        assert.ok((revisedDevelopment.secondaryLinePitchCount ?? 0) > (baseDevelopment.secondaryLinePitchCount ?? 0));
        assert.ok((revisedDevelopment.textureIndependentMotionRate ?? 0) >= Math.max(baseDevelopment.textureIndependentMotionRate ?? 0, 0.55));
        assert.ok((revisedDevelopment.textureContraryMotionRate ?? 0) >= Math.max(baseDevelopment.textureContraryMotionRate ?? 0, 0.32));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker splits explicit chamber inner voice into a dedicated MIDI part when separate secondary and bass instruments are provided", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-chamber-split-"));

    try {
        const outputPath = path.join(tempRoot, "chamber-split.mid");
        const result = await runComposeWorker({
            prompt: "Write a compact chamber miniature with violin lead, a clear viola inner voice, and cello bass.",
            key: "D minor",
            tempo: 76,
            form: "miniature",
            seed: 20260449,
            outputPath,
            compositionPlan: {
                form: "miniature",
                instrumentation: [
                    { name: "violin", family: "strings", roles: ["lead"], register: "high" },
                    { name: "viola", family: "strings", roles: ["inner_voice"], register: "mid" },
                    { name: "cello", family: "strings", roles: ["bass"], register: "low" },
                ],
                textureDefaults: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                    notes: ["Keep the middle voice clearly audible as a separate strand."],
                },
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
                        label: "Close",
                        measures: 4,
                        energy: 0.28,
                        density: 0.24,
                        phraseFunction: "cadential",
                        harmonicPlan: {
                            tonalCenter: "D minor",
                            harmonicRhythm: "slow",
                            cadence: "authentic",
                            allowModulation: false,
                        },
                    },
                ],
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));
        assert.equal(result.partCount, 3);
        assert.ok(Array.isArray(result.partInstrumentNames));

        const normalizedPartNames = result.partInstrumentNames.map((value) => String(value).toLowerCase());
        assert.ok(normalizedPartNames.some((value) => value.includes("violin")), JSON.stringify(result.partInstrumentNames));
        assert.ok(normalizedPartNames.some((value) => value.includes("viola")), JSON.stringify(result.partInstrumentNames));
        assert.ok(
            normalizedPartNames.some((value) => value.includes("cello") || value.includes("violoncello")),
            JSON.stringify(result.partInstrumentNames),
        );

        const openingArtifact = result.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        assert.ok(openingArtifact);
        assert.equal(openingArtifact.textureVoiceCount, 3);
        assert.deepEqual(openingArtifact.primaryTextureRoles, ["lead", "inner_voice", "bass"]);
        assert.equal(openingArtifact.counterpointMode, "contrary_motion");
        assert.ok((openingArtifact.secondaryLinePitchCount ?? 0) >= 4);
        assert.ok(openingArtifact.accompanimentEvents.some((event) => event.voiceRole === "inner_voice"));
        assert.ok(openingArtifact.accompanimentEvents.some((event) => event.voiceRole === "bass"));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker realizes planned dynamics with distinct velocity ranges", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-expression-dynamics-"));

    const buildPlan = (dynamics) => ({
        form: "miniature",
        meter: "4/4",
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 4,
                energy: 0.4,
                density: 0.36,
                expression: {
                    dynamics,
                    articulation: ["legato"],
                    character: ["cantabile"],
                    sustainBias: 0.2,
                },
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: false,
                },
            },
        ],
    });

    try {
        const softPath = path.join(tempRoot, "soft.mid");
        const loudPath = path.join(tempRoot, "loud.mid");

        const soft = await runComposeWorker({
            prompt: "Write a compact miniature with a restrained opening.",
            key: "C major",
            tempo: 84,
            form: "miniature",
            seed: 8802,
            outputPath: softPath,
            compositionPlan: buildPlan({ start: "pp", peak: "p", end: "pp" }),
        });
        const loud = await runComposeWorker({
            prompt: "Write a compact miniature with a restrained opening.",
            key: "C major",
            tempo: 84,
            form: "miniature",
            seed: 8802,
            outputPath: loudPath,
            compositionPlan: buildPlan({ start: "f", peak: "ff", end: "f" }),
        });

        assert.equal(soft.ok, true);
        assert.equal(loud.ok, true);

        const softArtifact = soft.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const loudArtifact = loud.sectionArtifacts.find((entry) => entry.sectionId === "s1");

        assert.ok(softArtifact);
        assert.ok(loudArtifact);
        assert.deepEqual(softArtifact.expressionDynamics, { start: "pp", peak: "p", end: "pp" });
        assert.deepEqual(loudArtifact.expressionDynamics, { start: "f", peak: "ff", end: "f" });
        assert.ok((loudArtifact.melodyVelocityMin ?? 0) > (softArtifact.melodyVelocityMin ?? 0));
        assert.ok((loudArtifact.melodyVelocityMax ?? 0) > (softArtifact.melodyVelocityMax ?? 0));
        assert.ok((loudArtifact.accompanimentVelocityMin ?? 0) > (softArtifact.accompanimentVelocityMin ?? 0));
        assert.ok((loudArtifact.accompanimentVelocityMax ?? 0) > (softArtifact.accompanimentVelocityMax ?? 0));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker harmonic directives reduce exposed parallels and preserve cadence support", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-harmony-"));

    try {
        const baselinePath = path.join(tempRoot, "baseline.mid");
        const revisedPath = path.join(tempRoot, "revised.mid");
        const basePayload = {
            prompt: "Write a compact classical miniature with a clearly prepared close.",
            key: "C major",
            tempo: 84,
            form: "miniature",
            seed: 12345,
            compositionPlan: {
                form: "miniature",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Opening",
                        measures: 4,
                        energy: 0.46,
                        density: 0.42,
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "medium",
                            cadence: "half",
                            allowModulation: false,
                        },
                    },
                    {
                        id: "s2",
                        role: "cadence",
                        label: "Closing",
                        measures: 4,
                        energy: 0.34,
                        density: 0.34,
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "fast",
                            cadence: "authentic",
                            allowModulation: false,
                        },
                    },
                ],
            },
        };

        const baseline = await runComposeWorker({
            ...basePayload,
            outputPath: baselinePath,
        });
        const revised = await runComposeWorker({
            ...basePayload,
            outputPath: revisedPath,
            revisionDirectives: [
                { kind: "stabilize_harmony", priority: 92, reason: "Avoid exposed parallels." },
                { kind: "strengthen_cadence", priority: 96, reason: "Support the close in the bass." },
            ],
            attemptIndex: 2,
        });

        assert.equal(baseline.ok, true);
        assert.equal(revised.ok, true);

        const baselineCritique = await critique(fs.readFileSync(baselinePath), "compose-baseline", {
            key: "C major",
            meter: "4/4",
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, harmonicPlan: { tonalCenter: "C major", cadence: "half", allowModulation: false } },
                { id: "s2", role: "cadence", label: "Closing", measures: 4, cadence: "authentic", harmonicPlan: { tonalCenter: "C major", cadence: "authentic", allowModulation: false } },
            ],
        });
        const revisedCritique = await critique(fs.readFileSync(revisedPath), "compose-revised", {
            key: "C major",
            meter: "4/4",
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4, harmonicPlan: { tonalCenter: "C major", cadence: "half", allowModulation: false } },
                { id: "s2", role: "cadence", label: "Closing", measures: 4, cadence: "authentic", harmonicPlan: { tonalCenter: "C major", cadence: "authentic", allowModulation: false } },
            ],
        });

        assert.ok((revisedCritique.metrics?.parallelPerfectCount ?? 99) <= (baselineCritique.metrics?.parallelPerfectCount ?? 99));
        assert.ok((revisedCritique.metrics?.harmonicCadenceSupport ?? -1) >= (baselineCritique.metrics?.harmonicCadenceSupport ?? -1));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker localizes cadence and harmony reinforcement to the targeted closing section without destabilizing preserved sections", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-targeted-cadence-"));

    try {
        const baselinePath = path.join(tempRoot, "baseline.mid");
        const revisedPath = path.join(tempRoot, "revised.mid");
        const basePayload = {
            prompt: "Write a compact sonata with a soft closing section that may need a firmer landing.",
            key: "C major",
            tempo: 82,
            form: "sonata",
            seed: 424242,
            compositionPlan: {
                form: "sonata",
                meter: "4/4",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Theme",
                        measures: 4,
                        registerCenter: 52,
                        energy: 0.44,
                        density: 0.38,
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "medium",
                            cadence: "half",
                            allowModulation: false,
                        },
                    },
                    {
                        id: "s2",
                        role: "development",
                        label: "Development",
                        measures: 4,
                        registerCenter: 76,
                        energy: 0.68,
                        density: 0.56,
                        motifRef: "s1",
                        harmonicPlan: {
                            tonalCenter: "G major",
                            harmonicRhythm: "fast",
                            cadence: "half",
                            allowModulation: true,
                        },
                    },
                    {
                        id: "s3",
                        role: "cadence",
                        label: "Close",
                        measures: 4,
                        registerCenter: 60,
                        energy: 0.24,
                        density: 0.24,
                        motifRef: "s1",
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "slow",
                            cadence: "authentic",
                            allowModulation: false,
                        },
                    },
                ],
            },
        };

        const baseline = await runComposeWorker({
            ...basePayload,
            outputPath: baselinePath,
        });
        const revised = await runComposeWorker({
            ...basePayload,
            outputPath: revisedPath,
            sectionArtifacts: baseline.sectionArtifacts,
            revisionDirectives: [
                {
                    kind: "stabilize_harmony",
                    priority: 92,
                    reason: "Only stabilize the closing section.",
                    sectionIds: ["s3"],
                },
                {
                    kind: "strengthen_cadence",
                    priority: 96,
                    reason: "Only tighten the cadence section.",
                    sectionIds: ["s3"],
                },
            ],
            attemptIndex: 2,
        });

        assert.equal(baseline.ok, true);
        assert.equal(revised.ok, true);
        assert.ok(Array.isArray(baseline.sectionArtifacts));
        assert.ok(Array.isArray(revised.sectionArtifacts));

        const baselineThemeArtifact = baseline.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const revisedThemeArtifact = revised.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const baselineDevelopmentArtifact = baseline.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        const revisedDevelopmentArtifact = revised.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        const baselineCadenceArtifact = baseline.sectionArtifacts.find((entry) => entry.sectionId === "s3");
        const revisedCadenceArtifact = revised.sectionArtifacts.find((entry) => entry.sectionId === "s3");

        assert.deepEqual(revisedThemeArtifact, baselineThemeArtifact);
        assert.deepEqual(revisedDevelopmentArtifact, baselineDevelopmentArtifact);
        assert.notDeepEqual(revisedCadenceArtifact, baselineCadenceArtifact);
        assert.notDeepEqual(
            revisedCadenceArtifact?.accompanimentEvents,
            baselineCadenceArtifact?.accompanimentEvents,
        );
        assert.equal(baselineThemeArtifact?.plannedRegisterCenter, 52);
        assert.equal(baselineDevelopmentArtifact?.plannedRegisterCenter, 76);
        assert.equal(baselineCadenceArtifact?.plannedRegisterCenter, 60);
        assert.ok((baselineThemeArtifact?.realizedRegisterCenter ?? 0) < (baselineDevelopmentArtifact?.realizedRegisterCenter ?? 0));
        assert.ok((baselineThemeArtifact?.melodyPitchMin ?? 999) <= (baselineThemeArtifact?.realizedRegisterCenter ?? 0));
        assert.ok((baselineThemeArtifact?.realizedRegisterCenter ?? 0) <= (baselineThemeArtifact?.melodyPitchMax ?? 0));
        assert.equal(revisedCadenceArtifact?.sectionStyle, "block");
        assert.equal(revisedCadenceArtifact?.cadenceApproach, "dominant");
        assert.ok(["pedal", "stepwise", "mixed", "leaping"].includes(revisedCadenceArtifact?.bassMotionProfile));

        const sections = [
            { id: "s1", role: "theme_a", label: "Theme", measures: 4, harmonicPlan: { tonalCenter: "C major", cadence: "half", allowModulation: false } },
            { id: "s2", role: "development", label: "Development", measures: 4, motifRef: "s1", harmonicPlan: { tonalCenter: "G major", cadence: "half", allowModulation: true } },
            { id: "s3", role: "cadence", label: "Close", measures: 4, motifRef: "s1", cadence: "authentic", harmonicPlan: { tonalCenter: "C major", cadence: "authentic", allowModulation: false } },
        ];

        const baselineCritique = await critique(fs.readFileSync(baselinePath), "compose-targeted-cadence-baseline", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });
        const revisedCritique = await critique(fs.readFileSync(revisedPath), "compose-targeted-cadence-revised", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });

        const baselineCadence = baselineCritique.sectionFindings?.find((finding) => finding.sectionId === "s3");
        const revisedCadence = revisedCritique.sectionFindings?.find((finding) => finding.sectionId === "s3");
        const baselineTheme = baselineCritique.sectionFindings?.find((finding) => finding.sectionId === "s1");
        const revisedTheme = revisedCritique.sectionFindings?.find((finding) => finding.sectionId === "s1");

        assert.ok(baselineCadence && revisedCadence && baselineTheme && revisedTheme);
        assert.equal(revisedTheme?.metrics.noteCount, baselineTheme?.metrics.noteCount);
        assert.equal(revisedTheme?.metrics.uniqueDurations, baselineTheme?.metrics.uniqueDurations);
        assert.ok((revisedCadence?.metrics.harmonicCadenceSupport ?? -1) >= (baselineCadence?.metrics.harmonicCadenceSupport ?? -1));
        assert.ok((revisedCadence?.metrics.parallelPerfectCount ?? 99) <= (baselineCadence?.metrics.parallelPerfectCount ?? 99));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker targeted retries preserve untargeted sections with section-local seeding", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-targeted-"));

    try {
        const baselinePath = path.join(tempRoot, "baseline.mid");
        const revisedPath = path.join(tempRoot, "revised.mid");
        const basePayload = {
            prompt: "Write a compact sonata with a more animated development but keep the outer sections stable.",
            key: "C major",
            tempo: 88,
            form: "sonata",
            seed: 20260410,
            compositionPlan: {
                form: "sonata",
                meter: "4/4",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Theme",
                        measures: 4,
                        energy: 0.42,
                        density: 0.36,
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "medium",
                            cadence: "half",
                            allowModulation: false,
                        },
                    },
                    {
                        id: "s2",
                        role: "development",
                        label: "Development",
                        measures: 4,
                        energy: 0.7,
                        density: 0.58,
                        motifRef: "s1",
                        harmonicPlan: {
                            tonalCenter: "G major",
                            harmonicRhythm: "fast",
                            cadence: "half",
                            allowModulation: true,
                        },
                    },
                    {
                        id: "s3",
                        role: "recap",
                        label: "Recap",
                        measures: 4,
                        energy: 0.34,
                        density: 0.3,
                        motifRef: "s1",
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "medium",
                            cadence: "authentic",
                            allowModulation: false,
                        },
                    },
                ],
            },
        };

        const baseline = await runComposeWorker({
            ...basePayload,
            outputPath: baselinePath,
        });
        const revised = await runComposeWorker({
            ...basePayload,
            outputPath: revisedPath,
            sectionArtifacts: baseline.sectionArtifacts,
            revisionDirectives: [
                {
                    kind: "clarify_narrative_arc",
                    priority: 90,
                    reason: "Only intensify the development.",
                    sectionIds: ["s2"],
                },
            ],
            attemptIndex: 2,
        });

        assert.equal(baseline.ok, true);
        assert.equal(revised.ok, true);
        assert.notDeepEqual(fs.readFileSync(baselinePath), fs.readFileSync(revisedPath));
        assert.ok(Array.isArray(baseline.sectionArtifacts));
        assert.ok(Array.isArray(revised.sectionArtifacts));

        const baselineThemeArtifact = baseline.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const revisedThemeArtifact = revised.sectionArtifacts.find((entry) => entry.sectionId === "s1");
        const baselineDevelopmentArtifact = baseline.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        const revisedDevelopmentArtifact = revised.sectionArtifacts.find((entry) => entry.sectionId === "s2");
        const baselineRecapArtifact = baseline.sectionArtifacts.find((entry) => entry.sectionId === "s3");
        const revisedRecapArtifact = revised.sectionArtifacts.find((entry) => entry.sectionId === "s3");

        assert.deepEqual(revisedThemeArtifact, baselineThemeArtifact);
        assert.deepEqual(revisedRecapArtifact, baselineRecapArtifact);
        assert.notDeepEqual(revisedDevelopmentArtifact, baselineDevelopmentArtifact);

        const sections = [
            { id: "s1", role: "theme_a", label: "Theme", measures: 4, harmonicPlan: { tonalCenter: "C major", cadence: "half", allowModulation: false } },
            { id: "s2", role: "development", label: "Development", measures: 4, motifRef: "s1", harmonicPlan: { tonalCenter: "G major", cadence: "half", allowModulation: true } },
            { id: "s3", role: "recap", label: "Recap", measures: 4, motifRef: "s1", cadence: "authentic", harmonicPlan: { tonalCenter: "C major", cadence: "authentic", allowModulation: false } },
        ];
        const baselineCritique = await critique(fs.readFileSync(baselinePath), "compose-targeted-baseline", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });
        const revisedCritique = await critique(fs.readFileSync(revisedPath), "compose-targeted-revised", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });

        const baselineTheme = baselineCritique.sectionFindings?.find((finding) => finding.sectionId === "s1");
        const revisedTheme = revisedCritique.sectionFindings?.find((finding) => finding.sectionId === "s1");
        const baselineRecap = baselineCritique.sectionFindings?.find((finding) => finding.sectionId === "s3");
        const revisedRecap = revisedCritique.sectionFindings?.find((finding) => finding.sectionId === "s3");
        const baselineDevelopment = baselineCritique.sectionFindings?.find((finding) => finding.sectionId === "s2");
        const revisedDevelopment = revisedCritique.sectionFindings?.find((finding) => finding.sectionId === "s2");

        assert.ok(baselineTheme && revisedTheme && baselineRecap && revisedRecap && baselineDevelopment && revisedDevelopment);
        assert.equal(revisedTheme?.metrics.noteCount, baselineTheme?.metrics.noteCount);
        assert.equal(revisedTheme?.metrics.melodicSpan, baselineTheme?.metrics.melodicSpan);
        assert.equal(revisedRecap?.metrics.noteCount, baselineRecap?.metrics.noteCount);
        assert.equal(revisedRecap?.metrics.melodicSpan, baselineRecap?.metrics.melodicSpan);
        assert.notDeepEqual(revisedDevelopment?.metrics, baselineDevelopment?.metrics);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker prepares the bass for a recap return across section boundaries", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-route-prep-"));

    try {
        const outputPath = path.join(tempRoot, "route-prep.mid");
        const sections = [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 4,
                energy: 0.42,
                density: 0.36,
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: false,
                },
            },
            {
                id: "s2",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.72,
                density: 0.58,
                motifRef: "s1",
                harmonicPlan: {
                    tonalCenter: "G major",
                    harmonicRhythm: "fast",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s3",
                role: "recap",
                label: "Recap",
                measures: 4,
                energy: 0.34,
                density: 0.3,
                motifRef: "s1",
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "authentic",
                    allowModulation: false,
                },
            },
        ];

        const result = await runComposeWorker({
            prompt: "Write a compact sonata whose development clearly prepares the recap return.",
            key: "C major",
            tempo: 88,
            form: "sonata",
            seed: 20260411,
            outputPath,
            compositionPlan: {
                form: "sonata",
                meter: "4/4",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections,
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));

        const critiqueResult = await critique(fs.readFileSync(outputPath), "compose-route-prep", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });

        assert.ok((critiqueResult.metrics?.dominantPreparationStrength ?? 0) >= 0.74);
        assert.ok((critiqueResult.metrics?.globalHarmonicProgressionStrength ?? 0) >= 0.72);
        assert.ok((critiqueResult.metrics?.parallelPerfectCount ?? 99) <= 3);
        assert.match(critiqueResult.strengths.join(" | "), /Dominant preparation supports major tonal arrivals|coherent harmonic route/);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker motif-driven development keeps route strength while reducing outer-voice parallels", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-route-outer-voice-"));

    try {
        const outputPath = path.join(tempRoot, "route-outer-voice.mid");
        const sections = [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme A",
                measures: 4,
                energy: 0.42,
                density: 0.36,
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: false,
                },
            },
            {
                id: "s2",
                role: "theme_b",
                label: "Theme B",
                measures: 4,
                energy: 0.5,
                density: 0.42,
                contrastFrom: "s1",
                harmonicPlan: {
                    tonalCenter: "G major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s3",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.72,
                density: 0.58,
                motifRef: "s1",
                harmonicPlan: {
                    tonalCenter: "A minor",
                    harmonicRhythm: "fast",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s4",
                role: "recap",
                label: "Recap",
                measures: 4,
                energy: 0.34,
                density: 0.3,
                motifRef: "s1",
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "authentic",
                    allowModulation: false,
                },
            },
        ];

        const result = await runComposeWorker({
            prompt: "Write a compact sonata with a clear secondary-key exposition, modulatory development, and strong recap return.",
            key: "C major",
            tempo: 88,
            form: "sonata",
            seed: 20260436,
            outputPath,
            compositionPlan: {
                form: "sonata",
                meter: "4/4",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections,
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));

        const critiqueResult = await critique(fs.readFileSync(outputPath), "compose-route-outer-voice", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });

        const development = critiqueResult.sectionFindings?.find((finding) => finding.sectionId === "s3");

        assert.ok(development);
        assert.ok((critiqueResult.metrics?.globalHarmonicProgressionStrength ?? 0) >= 0.9);
        assert.equal(critiqueResult.metrics?.parallelPerfectCount ?? 99, 0);
        assert.equal(development?.metrics.parallelPerfectCount ?? 99, 0);
        assert.ok(!(development?.issues ?? []).some((issue) => issue.includes("Parallel perfect intervals weaken the outer-voice motion")));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker diminished development avoids structural-frame outer-voice parallels even when notes enter off the beat", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-structural-outer-voice-"));

    try {
        const outputPath = path.join(tempRoot, "structural-outer-voice.mid");
        const sections = [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme A",
                measures: 4,
                energy: 0.42,
                density: 0.36,
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: false,
                },
            },
            {
                id: "s2",
                role: "theme_b",
                label: "Theme B",
                measures: 4,
                energy: 0.5,
                density: 0.42,
                contrastFrom: "s1",
                harmonicPlan: {
                    tonalCenter: "G major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s3",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.72,
                density: 0.58,
                motifRef: "s1",
                harmonicPlan: {
                    tonalCenter: "A minor",
                    harmonicRhythm: "fast",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s4",
                role: "recap",
                label: "Recap",
                measures: 4,
                energy: 0.34,
                density: 0.3,
                motifRef: "s1",
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "authentic",
                    allowModulation: false,
                },
            },
        ];

        const result = await runComposeWorker({
            prompt: "Write a compact sonata with a clear secondary-key exposition, modulatory development, and strong recap return.",
            key: "C major",
            tempo: 88,
            form: "sonata",
            seed: 20260441,
            outputPath,
            compositionPlan: {
                form: "sonata",
                meter: "4/4",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections,
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));

        const critiqueResult = await critique(fs.readFileSync(outputPath), "compose-structural-outer-voice", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });

        const development = critiqueResult.sectionFindings?.find((finding) => finding.sectionId === "s3");

        assert.ok(development);
        assert.ok((critiqueResult.metrics?.globalHarmonicProgressionStrength ?? 0) >= 0.9);
        assert.equal(critiqueResult.metrics?.parallelPerfectCount ?? 99, 0);
        assert.equal(development?.metrics.parallelPerfectCount ?? 99, 0);
        assert.ok(!(development?.issues ?? []).some((issue) => issue.includes("Parallel perfect intervals weaken the outer-voice motion")));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker contrast theme_b follows realized accompaniment bass to avoid outer-voice parallels", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-themeb-outer-voice-"));

    try {
        const outputPath = path.join(tempRoot, "themeb-outer-voice.mid");
        const sections = [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme A",
                measures: 4,
                energy: 0.42,
                density: 0.36,
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: false,
                },
            },
            {
                id: "s2",
                role: "theme_b",
                label: "Theme B",
                measures: 4,
                energy: 0.5,
                density: 0.42,
                contrastFrom: "s1",
                harmonicPlan: {
                    tonalCenter: "G major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s3",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.72,
                density: 0.58,
                motifRef: "s1",
                harmonicPlan: {
                    tonalCenter: "A minor",
                    harmonicRhythm: "fast",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s4",
                role: "recap",
                label: "Recap",
                measures: 4,
                energy: 0.34,
                density: 0.3,
                motifRef: "s1",
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "authentic",
                    allowModulation: false,
                },
            },
        ];

        const result = await runComposeWorker({
            prompt: "Write a compact sonata with a clear secondary-key exposition, modulatory development, and strong recap return.",
            key: "C major",
            tempo: 88,
            form: "sonata",
            seed: 20260422,
            outputPath,
            compositionPlan: {
                form: "sonata",
                meter: "4/4",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections,
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));

        const critiqueResult = await critique(fs.readFileSync(outputPath), "compose-themeb-outer-voice", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });

        const themeB = critiqueResult.sectionFindings?.find((finding) => finding.sectionId === "s2");

        assert.ok(themeB);
        assert.ok((critiqueResult.metrics?.globalHarmonicProgressionStrength ?? 0) >= 0.9);
        assert.ok((critiqueResult.metrics?.parallelPerfectCount ?? 99) <= 1);
        assert.ok((themeB?.metrics.parallelPerfectCount ?? 99) <= 1);
        assert.ok(!(themeB?.issues ?? []).some((issue) => issue.includes("Parallel perfect intervals weaken the outer-voice motion")));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("compose worker infers closing cadence stability even without explicit cadenceStrength", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-compose-worker-closing-stability-"));

    try {
        const outputPath = path.join(tempRoot, "closing-stability.mid");
        const sections = [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 4,
                energy: 0.42,
                density: 0.36,
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "medium",
                    cadence: "half",
                    allowModulation: false,
                },
            },
            {
                id: "s2",
                role: "development",
                label: "Development",
                measures: 4,
                energy: 0.64,
                density: 0.54,
                motifRef: "s1",
                harmonicPlan: {
                    tonalCenter: "G major",
                    harmonicRhythm: "fast",
                    cadence: "half",
                    allowModulation: true,
                },
            },
            {
                id: "s3",
                role: "cadence",
                label: "Close",
                measures: 4,
                energy: 0.28,
                density: 0.24,
                cadence: "authentic",
                harmonicPlan: {
                    tonalCenter: "C major",
                    harmonicRhythm: "slow",
                    cadence: "authentic",
                    allowModulation: false,
                },
            },
        ];

        const result = await runComposeWorker({
            prompt: "Write a compact sonata with a clear closing cadence.",
            key: "C major",
            tempo: 88,
            form: "sonata",
            seed: 20260424,
            outputPath,
            compositionPlan: {
                form: "sonata",
                meter: "4/4",
                motifPolicy: {
                    reuseRequired: true,
                    inversionAllowed: true,
                    augmentationAllowed: true,
                    diminutionAllowed: true,
                    sequenceAllowed: true,
                },
                sections,
            },
        });

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));

        const critiqueResult = await critique(fs.readFileSync(outputPath), "compose-closing-stability", {
            key: "C major",
            form: "sonata",
            meter: "4/4",
            sections,
        });

        const closing = critiqueResult.sectionFindings?.find((finding) => finding.sectionId === "s3");
        assert.ok(closing);
        assert.ok((critiqueResult.metrics?.parallelPerfectCount ?? 99) <= 3);
        assert.equal(closing?.metrics.parallelPerfectCount ?? 99, 0);
        assert.ok(!(closing?.issues ?? []).some((issue) => issue.includes("Parallel perfect intervals weaken the outer-voice motion")));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }

        throw error;
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});