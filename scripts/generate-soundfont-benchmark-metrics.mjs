import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const VARIANTS = [
    { id: "default_sf2", title: "default.sf2" },
    { id: "musescore_general_sf3", title: "MuseScore_General.sf3" },
    { id: "generaluser_gs_203", title: "GeneralUser GS 2.0.3" },
];

const CASES = [
    { id: "piano_led", title: "Piano-led miniature", caseDir: "" },
    { id: "strings_chamber", title: "Sustained strings texture", caseDir: "strings_chamber" },
    { id: "winds_brass", title: "Brass-led color study", caseDir: "winds_brass" },
];

const DEFAULT_ROOT = path.join(repoRoot, "outputs", "_validation_render_preview");
const DEFAULT_FFT_SIZE = 4096;
const DEFAULT_MAX_FRAMES = 128;
const LOW_BAND_HZ = 200;
const HIGH_BAND_HZ = 4000;
const DB_FLOOR = -120;

function readOption(name) {
    const prefix = `--${name}=`;
    const exactIndex = process.argv.indexOf(`--${name}`);
    if (exactIndex >= 0) {
        return process.argv[exactIndex + 1];
    }

    const prefixed = process.argv.find((entry) => entry.startsWith(prefix));
    if (prefixed) {
        return prefixed.slice(prefix.length);
    }

    return undefined;
}

function fail(message, details) {
    console.error(JSON.stringify({ ok: false, message, details }, null, 2));
    process.exit(1);
}

function toPosixPath(value) {
    return value.split(path.sep).join("/");
}

function relativeToRepo(filePath) {
    return toPosixPath(path.relative(repoRoot, filePath));
}

function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function toDbfs(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return DB_FLOOR;
    }

    return Math.max(DB_FLOOR, round(20 * Math.log10(value), 3));
}

function resolveRoot() {
    const explicit = readOption("root") || process.env.AXIOM_SOUNDFONT_BENCHMARK_ROOT;
    return explicit ? path.resolve(explicit) : DEFAULT_ROOT;
}

function resolveOutputPath(rootDir, name, override) {
    return override ? path.resolve(override) : path.join(rootDir, name);
}

function parseWav(filePath) {
    const buffer = fs.readFileSync(filePath);
    if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
        fail("Unsupported WAV container", { filePath: relativeToRepo(filePath) });
    }

    let cursor = 12;
    let fmtChunk;
    let dataChunk;
    while (cursor + 8 <= buffer.length) {
        const chunkId = buffer.toString("ascii", cursor, cursor + 4);
        const chunkSize = buffer.readUInt32LE(cursor + 4);
        const dataOffset = cursor + 8;

        if (chunkId === "fmt ") {
            fmtChunk = {
                audioFormat: buffer.readUInt16LE(dataOffset),
                channelCount: buffer.readUInt16LE(dataOffset + 2),
                sampleRate: buffer.readUInt32LE(dataOffset + 4),
                byteRate: buffer.readUInt32LE(dataOffset + 8),
                blockAlign: buffer.readUInt16LE(dataOffset + 12),
                bitsPerSample: buffer.readUInt16LE(dataOffset + 14),
            };
        }

        if (chunkId === "data") {
            dataChunk = {
                dataOffset,
                chunkSize,
            };
        }

        cursor = dataOffset + chunkSize + (chunkSize % 2);
    }

    if (!fmtChunk || !dataChunk) {
        fail("WAV is missing fmt or data chunk", { filePath: relativeToRepo(filePath) });
    }

    if (![1, 3].includes(fmtChunk.audioFormat)) {
        fail("Unsupported WAV encoding", {
            filePath: relativeToRepo(filePath),
            audioFormat: fmtChunk.audioFormat,
        });
    }

    const totalFrames = Math.floor(dataChunk.chunkSize / fmtChunk.blockAlign);
    if (totalFrames <= 0) {
        fail("WAV contains no sample frames", { filePath: relativeToRepo(filePath) });
    }

    const mono = new Float64Array(totalFrames);
    let sourcePeak = 0;
    let clippedSamples = 0;
    const clipThreshold = fmtChunk.audioFormat === 3
        ? 0.99999
        : 1 - (1 / (2 ** Math.max(1, fmtChunk.bitsPerSample - 1)));

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        const frameOffset = dataChunk.dataOffset + (frameIndex * fmtChunk.blockAlign);
        let frameSum = 0;

        for (let channelIndex = 0; channelIndex < fmtChunk.channelCount; channelIndex += 1) {
            const sampleOffset = frameOffset + (channelIndex * (fmtChunk.bitsPerSample / 8));
            const sample = readSample(buffer, sampleOffset, fmtChunk.audioFormat, fmtChunk.bitsPerSample);
            const magnitude = Math.abs(sample);
            if (magnitude >= clipThreshold) {
                clippedSamples += 1;
            }
            if (magnitude > sourcePeak) {
                sourcePeak = magnitude;
            }
            frameSum += sample;
        }

        mono[frameIndex] = frameSum / fmtChunk.channelCount;
    }

    return {
        channelCount: fmtChunk.channelCount,
        sampleRate: fmtChunk.sampleRate,
        mono,
        sourcePeak,
        clippedSamples,
    };
}

function readSample(buffer, offset, audioFormat, bitsPerSample) {
    if (audioFormat === 3) {
        if (bitsPerSample === 32) {
            return buffer.readFloatLE(offset);
        }
        if (bitsPerSample === 64) {
            return buffer.readDoubleLE(offset);
        }
        fail("Unsupported float WAV bit depth", { bitsPerSample });
    }

    if (bitsPerSample === 8) {
        return (buffer.readUInt8(offset) - 128) / 128;
    }
    if (bitsPerSample === 16) {
        return buffer.readInt16LE(offset) / 32768;
    }
    if (bitsPerSample === 24) {
        return buffer.readIntLE(offset, 3) / 8388608;
    }
    if (bitsPerSample === 32) {
        return buffer.readInt32LE(offset) / 2147483648;
    }

    fail("Unsupported PCM WAV bit depth", { bitsPerSample });
}

function computeAmplitudeMetrics(mono, sampleRate, sourcePeak, clippedSamples) {
    const totalFrames = mono.length;
    const durationSec = round(totalFrames / sampleRate, 3);

    let peak = 0;
    let sumSquares = 0;
    for (const sample of mono) {
        const magnitude = Math.abs(sample);
        if (magnitude > peak) {
            peak = magnitude;
        }
        sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / totalFrames);
    const windowFrames = Math.max(1, Math.min(totalFrames, Math.round(sampleRate * 2)));
    const attackRms = computeWindowRms(mono, 0, windowFrames);
    const tailRms = computeWindowRms(mono, totalFrames - windowFrames, totalFrames);
    const peakDbfs = toDbfs(Math.max(peak, sourcePeak));
    const rmsDbfs = toDbfs(rms);

    return {
        duration_sec: durationSec,
        sample_rate: sampleRate,
        peak_dbfs: peakDbfs,
        rms_dbfs: rmsDbfs,
        attack_rms_dbfs: toDbfs(attackRms),
        tail_rms_dbfs: toDbfs(tailRms),
        crest_db: round(peakDbfs - rmsDbfs, 3),
        clipped_samples: clippedSamples,
    };
}

function computeWindowRms(mono, startIndex, endIndex) {
    let sumSquares = 0;
    let count = 0;
    for (let index = Math.max(0, startIndex); index < Math.min(mono.length, endIndex); index += 1) {
        sumSquares += mono[index] * mono[index];
        count += 1;
    }

    if (count === 0) {
        return 0;
    }

    return Math.sqrt(sumSquares / count);
}

function computeSpectralMetrics(mono, sampleRate) {
    const frameSize = resolveFrameSize(mono.length);
    if (frameSize < 32) {
        return {
            spectral_centroid_hz: 0,
            low_band_ratio: 0,
            high_band_ratio: 0,
        };
    }

    const hopSize = Math.max(1, Math.floor(frameSize / 2));
    const totalFrames = Math.max(1, Math.floor((mono.length - frameSize) / hopSize) + 1);
    const frameIndexes = selectFrameIndexes(totalFrames, DEFAULT_MAX_FRAMES);
    const window = buildHannWindow(frameSize);
    const powerSpectrum = new Float64Array((frameSize / 2) + 1);

    for (const frameIndex of frameIndexes) {
        const offset = Math.min(frameIndex * hopSize, Math.max(0, mono.length - frameSize));
        const real = new Float64Array(frameSize);
        const imaginary = new Float64Array(frameSize);

        for (let sampleIndex = 0; sampleIndex < frameSize; sampleIndex += 1) {
            real[sampleIndex] = mono[offset + sampleIndex] * window[sampleIndex];
        }

        fft(real, imaginary);

        for (let bin = 0; bin < powerSpectrum.length; bin += 1) {
            powerSpectrum[bin] += (real[bin] * real[bin]) + (imaginary[bin] * imaginary[bin]);
        }
    }

    let totalPower = 0;
    let centroidNumerator = 0;
    let lowBandPower = 0;
    let highBandPower = 0;

    for (let bin = 1; bin < powerSpectrum.length; bin += 1) {
        const frequency = (bin * sampleRate) / frameSize;
        const power = powerSpectrum[bin];
        totalPower += power;
        centroidNumerator += frequency * power;
        if (frequency <= LOW_BAND_HZ) {
            lowBandPower += power;
        }
        if (frequency >= HIGH_BAND_HZ) {
            highBandPower += power;
        }
    }

    if (totalPower <= 0) {
        return {
            spectral_centroid_hz: 0,
            low_band_ratio: 0,
            high_band_ratio: 0,
        };
    }

    return {
        spectral_centroid_hz: round(centroidNumerator / totalPower, 3),
        low_band_ratio: round(lowBandPower / totalPower, 6),
        high_band_ratio: round(highBandPower / totalPower, 6),
    };
}

function resolveFrameSize(sampleCount) {
    const capped = Math.min(sampleCount, DEFAULT_FFT_SIZE);
    let frameSize = 1;
    while (frameSize * 2 <= capped) {
        frameSize *= 2;
    }
    return frameSize;
}

function selectFrameIndexes(totalFrames, limit) {
    if (totalFrames <= 1) {
        return [0];
    }
    if (totalFrames <= limit) {
        return Array.from({ length: totalFrames }, (_, index) => index);
    }

    const indexes = new Set();
    for (let index = 0; index < limit; index += 1) {
        indexes.add(Math.floor((index * (totalFrames - 1)) / (limit - 1)));
    }
    return [...indexes].sort((left, right) => left - right);
}

function buildHannWindow(frameSize) {
    const window = new Float64Array(frameSize);
    if (frameSize === 1) {
        window[0] = 1;
        return window;
    }

    for (let index = 0; index < frameSize; index += 1) {
        window[index] = 0.5 - (0.5 * Math.cos((2 * Math.PI * index) / (frameSize - 1)));
    }
    return window;
}

function fft(real, imaginary) {
    const size = real.length;
    let j = 0;
    for (let i = 1; i < size; i += 1) {
        let bit = size >> 1;
        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;

        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
        }
    }

    for (let span = 2; span <= size; span <<= 1) {
        const angle = (-2 * Math.PI) / span;
        const wSpanCos = Math.cos(angle);
        const wSpanSin = Math.sin(angle);

        for (let offset = 0; offset < size; offset += span) {
            let wCos = 1;
            let wSin = 0;
            for (let index = 0; index < span / 2; index += 1) {
                const even = offset + index;
                const odd = even + (span / 2);
                const oddReal = (real[odd] * wCos) - (imaginary[odd] * wSin);
                const oddImaginary = (real[odd] * wSin) + (imaginary[odd] * wCos);

                real[odd] = real[even] - oddReal;
                imaginary[odd] = imaginary[even] - oddImaginary;
                real[even] += oddReal;
                imaginary[even] += oddImaginary;

                const nextCos = (wCos * wSpanCos) - (wSin * wSpanSin);
                wSin = (wCos * wSpanSin) + (wSin * wSpanCos);
                wCos = nextCos;
            }
        }
    }
}

function analyzeVariant(filePath) {
    const { mono, sampleRate, sourcePeak, clippedSamples } = parseWav(filePath);
    return {
        path: relativeToRepo(filePath),
        ...computeAmplitudeMetrics(mono, sampleRate, sourcePeak, clippedSamples),
        ...computeSpectralMetrics(mono, sampleRate),
    };
}

function collectReport(rootDir) {
    const missingFiles = [];
    const cases = {};

    for (const benchmarkCase of CASES) {
        const caseMetrics = {};
        for (const variant of VARIANTS) {
            const variantRoot = benchmarkCase.caseDir
                ? path.join(rootDir, benchmarkCase.caseDir, variant.id)
                : path.join(rootDir, variant.id);
            const wavPath = path.join(variantRoot, "output.wav");
            if (!fs.existsSync(wavPath)) {
                missingFiles.push(relativeToRepo(wavPath));
                continue;
            }
            caseMetrics[variant.id] = analyzeVariant(wavPath);
        }
        cases[benchmarkCase.id] = caseMetrics;
    }

    if (missingFiles.length > 0) {
        fail("Missing benchmark WAV inputs", { missingFiles });
    }

    return {
        generated_at: new Date().toISOString(),
        cases,
    };
}

function buildMarkdown(report) {
    const lines = [
        "# AXIOM SoundFont Benchmark Metrics",
        "",
        "This report is an objective companion for the listening pass. It does not replace human judgment on timbre.",
        "",
    ];

    for (const benchmarkCase of CASES) {
        lines.push(`## ${benchmarkCase.title}`);
        lines.push("");
        lines.push("| Variant | Duration (s) | Peak dBFS | RMS dBFS | Attack RMS dBFS | Tail RMS dBFS | Crest dB | Clipped | Centroid Hz | Low Ratio | High Ratio |");
        lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");

        for (const variant of VARIANTS) {
            const metrics = report.cases[benchmarkCase.id][variant.id];
            lines.push([
                `| ${variant.title}`,
                metrics.duration_sec,
                metrics.peak_dbfs,
                metrics.rms_dbfs,
                metrics.attack_rms_dbfs,
                metrics.tail_rms_dbfs,
                metrics.crest_db,
                metrics.clipped_samples,
                metrics.spectral_centroid_hz,
                metrics.low_band_ratio,
                `${metrics.high_band_ratio} |`,
            ].join(" | "));
        }

        lines.push("");
    }

    return lines.join("\n");
}

function main() {
    const rootDir = resolveRoot();
    if (!fs.existsSync(rootDir)) {
        fail("Benchmark root does not exist", { rootDir: relativeToRepo(rootDir) });
    }

    const outputJsonPath = resolveOutputPath(rootDir, "benchmark-metrics.json", readOption("output-json"));
    const outputMarkdownPath = resolveOutputPath(rootDir, "benchmark-metrics.md", readOption("output-md"));
    const report = collectReport(rootDir);
    const markdown = buildMarkdown(report);

    fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(outputMarkdownPath, `${markdown}\n`);

    console.log(JSON.stringify({
        ok: true,
        root: relativeToRepo(rootDir),
        outputJson: relativeToRepo(outputJsonPath),
        outputMarkdown: relativeToRepo(outputMarkdownPath),
        caseCount: CASES.length,
        variantCount: VARIANTS.length,
        generatedAt: report.generated_at,
    }, null, 2));
}

try {
    main();
} catch (error) {
    fail("generate-soundfont-benchmark-metrics crashed", {
        error: error instanceof Error ? error.message : String(error),
    });
}