import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const CASES = [
    { caseDir: "", frequencyOffset: 0 },
    { caseDir: "strings_chamber", frequencyOffset: 110 },
    { caseDir: "winds_brass", frequencyOffset: 220 },
];

const VARIANTS = [
    { id: "default_sf2", frequency: 220, amplitude: 0.18, durationSec: 0.9 },
    { id: "musescore_general_sf3", frequency: 330, amplitude: 0.24, durationSec: 1.0 },
    { id: "generaluser_gs_203", frequency: 440, amplitude: 0.3, durationSec: 1.1 },
];

function writeMonoSineWave(filePath, options) {
    const sampleRate = options.sampleRate || 8000;
    const sampleCount = Math.max(1, Math.floor(sampleRate * options.durationSec));
    const dataSize = sampleCount * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write("RIFF", 0, 4, "ascii");
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8, 4, "ascii");
    buffer.write("fmt ", 12, 4, "ascii");
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36, 4, "ascii");
    buffer.writeUInt32LE(dataSize, 40);

    for (let index = 0; index < sampleCount; index += 1) {
        const time = index / sampleRate;
        const sample = Math.sin(2 * Math.PI * options.frequency * time) * options.amplitude;
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), 44 + (index * 2));
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
}

test("generate-soundfont-benchmark-metrics writes reproducible JSON and Markdown reports", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-soundfont-benchmark-"));

    try {
        for (const benchmarkCase of CASES) {
            for (const variant of VARIANTS) {
                const filePath = benchmarkCase.caseDir
                    ? path.join(tempRoot, benchmarkCase.caseDir, variant.id, "output.wav")
                    : path.join(tempRoot, variant.id, "output.wav");
                writeMonoSineWave(filePath, {
                    frequency: variant.frequency + benchmarkCase.frequencyOffset,
                    amplitude: variant.amplitude,
                    durationSec: variant.durationSec,
                });
            }
        }

        const { stdout } = await execFileAsync(
            process.execPath,
            ["scripts/generate-soundfont-benchmark-metrics.mjs", "--root", tempRoot],
            { cwd: repoRoot },
        );

        const payload = JSON.parse(String(stdout).trim());
        assert.equal(payload.ok, true);
        assert.equal(payload.caseCount, 3);
        assert.equal(payload.variantCount, 3);

        const jsonPath = path.join(tempRoot, "benchmark-metrics.json");
        const markdownPath = path.join(tempRoot, "benchmark-metrics.md");
        assert.equal(fs.existsSync(jsonPath), true);
        assert.equal(fs.existsSync(markdownPath), true);

        const jsonPayload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        assert.deepEqual(Object.keys(jsonPayload.cases), ["piano_led", "strings_chamber", "winds_brass"]);
        assert.equal(typeof jsonPayload.cases.piano_led.default_sf2.duration_sec, "number");
        assert.equal(typeof jsonPayload.cases.winds_brass.generaluser_gs_203.spectral_centroid_hz, "number");

        const markdown = fs.readFileSync(markdownPath, "utf8");
        assert.match(markdown, /# AXIOM SoundFont Benchmark Metrics/);
        assert.match(markdown, /## Piano-led miniature/);
        assert.match(markdown, /## Sustained strings texture/);
        assert.match(markdown, /## Brass-led color study/);
        assert.match(markdown, /\| Variant \| Duration \(s\) \| Peak dBFS \|/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});