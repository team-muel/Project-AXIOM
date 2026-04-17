import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildExecutionPlan, compose } from "../dist/composer/index.js";
import { config } from "../dist/config.js";
import { buildAudioEvaluation } from "../dist/pipeline/evaluation.js";
import { buildExpressionPlanSidecar } from "../dist/pipeline/expressionPlan.js";
import { normalizeComposeRequestInput } from "../dist/pipeline/requestNormalization.js";
import { PipelineState, canTransition } from "../dist/pipeline/states.js";
import { serializeQueuedJob } from "../dist/queue/presentation.js";
import { buildHumanizeWorkerInput } from "../dist/humanizer/index.js";
import {
    buildRenderExpressionSummaryLines,
    buildRenderWorkerInput,
    buildStyledAudioPrompt,
    mergeRenderedAndStyledArtifacts,
    resolveRequestedAudioDurationSec,
} from "../dist/render/index.js";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pythonBin = [
    path.join(repoRoot, ".venv", "Scripts", "python.exe"),
    path.join(repoRoot, ".venv", "bin", "python"),
].find((candidate) => fs.existsSync(candidate));

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

function createSectionedWavBuffer(amplitudes, sectionDurationSec = 1, sampleRate = 48_000) {
    return createTonalSectionedWavBuffer(
        amplitudes.map((amplitude) => ({ amplitude, frequency: 220 })),
        sectionDurationSec,
        sampleRate,
    );
}

function createTonalSectionedWavBuffer(sections, sectionDurationSec = 1, sampleRate = 48_000) {
    const channelCount = 1;
    const bitsPerSample = 16;
    const blockAlign = channelCount * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const framesPerSection = Math.max(1, Math.floor(sectionDurationSec * sampleRate));
    const frameCount = framesPerSection * sections.length;
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

    let offset = 44;
    sections.forEach((section, sectionIndex) => {
        const segments = (section.segments?.length
            ? section.segments
            : [{ amplitude: section.amplitude, frequencies: section.frequencies ?? [section.frequency], portion: 1 }])
            .map((segment) => ({
                amplitude: Math.max(0, Math.min(0.95, segment.amplitude ?? section.amplitude)),
                frequencies: (segment.frequencies ?? section.frequencies ?? [section.frequency]).map((value) => Math.max(40, Math.min(sampleRate / 2 - 40, value))),
                portion: Math.max(segment.portion ?? 1, 0.01),
            }));
        const totalPortion = segments.reduce((sum, segment) => sum + segment.portion, 0);
        const segmentBoundaries = [];
        let accumulatedFrames = 0;
        segments.forEach((segment, index) => {
            const isLast = index === segments.length - 1;
            const segmentFrames = isLast
                ? framesPerSection - accumulatedFrames
                : Math.max(1, Math.round((segment.portion / totalPortion) * framesPerSection));
            accumulatedFrames += segmentFrames;
            segmentBoundaries.push({
                endFrame: Math.min(accumulatedFrames, framesPerSection),
                amplitude: segment.amplitude,
                frequencies: segment.frequencies,
            });
        });

        let segmentCursor = 0;
        for (let frameIndex = 0; frameIndex < framesPerSection; frameIndex += 1) {
            while (segmentCursor < segmentBoundaries.length - 1 && frameIndex >= segmentBoundaries[segmentCursor].endFrame) {
                segmentCursor += 1;
            }

            const currentSegment = segmentBoundaries[segmentCursor];
            const time = ((sectionIndex * framesPerSection) + frameIndex) / sampleRate;
            const mixed = currentSegment.frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * time), 0) / Math.max(currentSegment.frequencies.length, 1);
            const sample = Math.round(mixed * currentSegment.amplitude * 32767);
            buffer.writeInt16LE(sample, offset);
            offset += 2;
        }
    });

    return buffer;
}

function encodeVlq(value) {
    const bytes = [value & 0x7f];
    let remaining = value >> 7;

    while (remaining > 0) {
        bytes.unshift((remaining & 0x7f) | 0x80);
        remaining >>= 7;
    }

    return Buffer.from(bytes);
}

function createMinimalMidiBuffer() {
    const header = Buffer.from([
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00,
        0x00, 0x01,
        0x01, 0xe0,
    ]);
    const events = Buffer.concat([
        Buffer.from([0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]),
        Buffer.from([0x00, 0xc0, 0x00]),
        Buffer.from([0x00, 0x90, 0x3c, 0x54]),
        encodeVlq(480),
        Buffer.from([0x80, 0x3c, 0x40]),
        Buffer.from([0x00, 0x90, 0x40, 0x4e]),
        encodeVlq(480),
        Buffer.from([0x80, 0x40, 0x40]),
        Buffer.from([0x00, 0xff, 0x2f, 0x00]),
    ]);
    const trackHeader = Buffer.from([
        0x4d, 0x54, 0x72, 0x6b,
        (events.length >>> 24) & 0xff,
        (events.length >>> 16) & 0xff,
        (events.length >>> 8) & 0xff,
        events.length & 0xff,
    ]);

    return Buffer.concat([header, trackHeader, events]);
}

async function runRenderWorker(payload) {
    if (!pythonBin) {
        throw new Error("No local Python binary found for render-worker test.");
    }

    return await new Promise((resolve, reject) => {
        const child = spawn(pythonBin, ["workers/render/render.py"], {
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
                reject(new Error(stderr.trim() || `render worker exited with code ${code}`));
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

async function runHumanizerWorker(payload) {
    if (!pythonBin) {
        throw new Error("No local Python binary found for humanizer-worker test.");
    }

    return await new Promise((resolve, reject) => {
        const child = spawn(pythonBin, ["workers/humanizer/humanize.py"], {
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
                reject(new Error(stderr.trim() || stdout.trim() || `humanizer worker exited with code ${code}`));
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

async function runMusic21JsonScript(script, args = []) {
    if (!pythonBin) {
        throw new Error("No local Python binary found for music21 helper script.");
    }

    return await new Promise((resolve, reject) => {
        const child = spawn(pythonBin, ["-c", script, ...args], {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
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
                reject(new Error(stderr.trim() || `music21 helper exited with code ${code}`));
                return;
            }

            try {
                resolve(JSON.parse(stdout.trim()));
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function createTwoPartTestMidi(outputPath) {
    const script = String.raw`
import json
import sys
from music21 import instrument, meter, midi, note, stream, tempo

output_path = sys.argv[1]
score = stream.Score()
score.insert(0, tempo.MetronomeMark(number=84))

melody = stream.Part()
melody.insert(0, instrument.Piano())
melody.insert(0, meter.TimeSignature("4/4"))

accompaniment = stream.Part()
accompaniment.insert(0, instrument.Piano())
accompaniment.insert(0, meter.TimeSignature("4/4"))

for measure_index in range(4):
    for beat_index in range(4):
        lead = note.Note(76 if measure_index < 2 else 79)
        lead.quarterLength = 1.0
        lead.volume.velocity = 80
        melody.append(lead)

        support = note.Note(64 if measure_index < 2 else 67)
        support.quarterLength = 1.0
        support.volume.velocity = 80
        accompaniment.append(support)

score.insert(0, melody)
score.insert(0, accompaniment)
score.makeMeasures(inPlace=True)

mf = midi.translate.music21ObjectToMidiFile(score)
mf.open(output_path, "wb")
mf.write()
mf.close()

print(json.dumps({"ok": True, "outputPath": output_path}))
`;

    return await runMusic21JsonScript(script, [outputPath]);
}

async function createLayeredAccompanimentTestMidi(outputPath) {
    const script = String.raw`
import json
import sys
from music21 import instrument, meter, midi, note, stream, tempo

output_path = sys.argv[1]
score = stream.Score()
score.insert(0, tempo.MetronomeMark(number=84))

melody = stream.Part()
melody.insert(0, instrument.Piano())
melody.insert(0, meter.TimeSignature("4/4"))

accompaniment = stream.Part()
accompaniment.insert(0, instrument.Piano())
accompaniment.insert(0, meter.TimeSignature("4/4"))

for measure_index in range(4):
    for beat_index in range(4):
        lead = note.Note(76 if measure_index < 2 else 79)
        lead.quarterLength = 1.0
        lead.volume.velocity = 80
        melody.append(lead)

        bass = note.Note(43 if measure_index < 2 else 45)
        bass.quarterLength = 0.5
        bass.volume.velocity = 80
        accompaniment.append(bass)

        upper = note.Note(64 if measure_index < 2 else 67)
        upper.quarterLength = 0.5
        upper.volume.velocity = 80
        accompaniment.append(upper)

score.insert(0, melody)
score.insert(0, accompaniment)
score.makeMeasures(inPlace=True)

mf = midi.translate.music21ObjectToMidiFile(score)
mf.open(output_path, "wb")
mf.write()
mf.close()

print(json.dumps({"ok": True, "outputPath": output_path}))
`;

    return await runMusic21JsonScript(script, [outputPath]);
}

async function createChordalAccompanimentTestMidi(outputPath) {
    const script = String.raw`
import json
import sys
from music21 import chord, instrument, meter, midi, note, stream, tempo

output_path = sys.argv[1]
score = stream.Score()
score.insert(0, tempo.MetronomeMark(number=84))

melody = stream.Part()
melody.insert(0, instrument.Piano())
melody.insert(0, meter.TimeSignature("4/4"))

accompaniment = stream.Part()
accompaniment.insert(0, instrument.Piano())
accompaniment.insert(0, meter.TimeSignature("4/4"))

for measure_index in range(4):
    for beat_index in range(4):
        lead = note.Note(76 if measure_index < 2 else 79)
        lead.quarterLength = 1.0
        lead.volume.velocity = 80
        melody.append(lead)

        support = chord.Chord([43, 55, 64] if measure_index < 2 else [45, 60, 69])
        support.quarterLength = 1.0
        support.volume.velocity = 80
        accompaniment.append(support)

score.insert(0, melody)
score.insert(0, accompaniment)
score.makeMeasures(inPlace=True)

mf = midi.translate.music21ObjectToMidiFile(score)
mf.open(output_path, "wb")
mf.write()
mf.close()

print(json.dumps({"ok": True, "outputPath": output_path}))
`;

    return await runMusic21JsonScript(script, [outputPath]);
}

async function analyzeHumanizedMidi(midiPath) {
    const script = String.raw`
import json
import sys
from music21 import converter, note

score = converter.parse(sys.argv[1])

def summarize(part, start_measure=None, end_measure=None):
    velocities = []
    durations = []
    for element in part.recurse().getElementsByClass(note.Note):
        measure_number = getattr(element, "measureNumber", None)
        if start_measure is not None:
            if measure_number is None or measure_number < start_measure or measure_number > end_measure:
                continue
        velocities.append(int(element.volume.velocity or 0))
        durations.append(float(element.quarterLength))

    return {
        "noteCount": len(velocities),
        "averageVelocity": round(sum(velocities) / len(velocities), 3) if velocities else 0.0,
        "averageQuarterLength": round(sum(durations) / len(durations), 4) if durations else 0.0,
    }

parts = [summarize(part) for part in score.parts]
accompaniment = score.parts[1] if len(score.parts) > 1 else score.parts[0]
payload = {
    "parts": parts,
    "ranges": {
        "accompanimentEarly": summarize(accompaniment, 1, 2),
        "accompanimentLate": summarize(accompaniment, 3, 4),
    },
}
print(json.dumps(payload))
`;

    return await runMusic21JsonScript(script, [midiPath]);
}

async function analyzeLayeredHumanizedMidi(midiPath) {
    const script = String.raw`
import json
import sys
from music21 import converter, note

score = converter.parse(sys.argv[1])
accompaniment = score.parts[1] if len(score.parts) > 1 else score.parts[0]

def summarize(part, start_measure=None, end_measure=None, min_pitch=None, max_pitch=None):
    velocities = []
    durations = []
    for element in part.recurse().getElementsByClass(note.Note):
        measure_number = getattr(element, "measureNumber", None)
        if start_measure is not None:
            if measure_number is None or measure_number < start_measure or measure_number > end_measure:
                continue

        pitch = int(element.pitch.midi)
        if min_pitch is not None and pitch < min_pitch:
            continue
        if max_pitch is not None and pitch > max_pitch:
            continue

        velocities.append(int(element.volume.velocity or 0))
        durations.append(float(element.quarterLength))

    return {
        "noteCount": len(velocities),
        "averageVelocity": round(sum(velocities) / len(velocities), 3) if velocities else 0.0,
        "averageQuarterLength": round(sum(durations) / len(durations), 4) if durations else 0.0,
    }

payload = {
    "ranges": {
        "lowEarly": summarize(accompaniment, 1, 2, max_pitch=50),
        "highEarly": summarize(accompaniment, 1, 2, min_pitch=60),
        "lowLate": summarize(accompaniment, 3, 4, max_pitch=50),
        "highLate": summarize(accompaniment, 3, 4, min_pitch=60),
    },
}
print(json.dumps(payload))
`;

    return await runMusic21JsonScript(script, [midiPath]);
}

async function analyzeRawHumanizedMidi(midiPath) {
    const script = String.raw`
import json
import sys
from music21 import midi

mf = midi.MidiFile()
mf.open(sys.argv[1])
mf.read()
mf.close()

ticks_per_quarter = int(mf.ticksPerQuarterNote or 10080)
parts = []

for track in mf.tracks:
    absolute_time = 0
    active_notes = {}
    velocities = []
    durations = []
    for event in track.events:
        absolute_time += getattr(event, "time", 0)
        event_type = getattr(event, "type", None)
        pitch = getattr(event, "pitch", None)
        channel = getattr(event, "channel", 0)
        velocity = int(getattr(event, "velocity", 0) or 0)

        if pitch is None:
            continue

        key = (channel, int(pitch))
        if event_type == midi.ChannelVoiceMessages.NOTE_ON and velocity > 0:
            active_notes.setdefault(key, []).append(
                {"start": int(absolute_time), "velocity": velocity}
            )
            continue

        if event_type not in {
            midi.ChannelVoiceMessages.NOTE_OFF,
            midi.ChannelVoiceMessages.NOTE_ON,
        }:
            continue

        started_notes = active_notes.get(key)
        if not started_notes:
            continue

        started_note = started_notes.pop(0)
        velocities.append(started_note["velocity"])
        durations.append(
            round((int(absolute_time) - started_note["start"]) / ticks_per_quarter, 4)
        )

    if velocities:
        parts.append(
            {
                "noteCount": len(velocities),
                "averageVelocity": round(sum(velocities) / len(velocities), 3),
                "averageQuarterLength": round(sum(durations) / len(durations), 4),
            }
        )

print(json.dumps({"parts": parts}))
`;

    return await runMusic21JsonScript(script, [midiPath]);
}

async function analyzeRawHumanizedMidiByMeasure(midiPath) {
    const script = String.raw`
import json
import sys
from music21 import midi

mf = midi.MidiFile()
mf.open(sys.argv[1])
mf.read()
mf.close()

ticks_per_quarter = int(mf.ticksPerQuarterNote or 10080)
measure_ticks = ticks_per_quarter * 4
parts = []

def summarize(records, start_measure=None, end_measure=None):
    velocities = []
    durations = []
    for record in records:
        measure_number = int(record["start"] // measure_ticks) + 1
        if start_measure is not None:
            if measure_number < start_measure or measure_number > end_measure:
                continue

        velocities.append(int(record["velocity"]))
        durations.append(float(record["duration"]) / float(ticks_per_quarter))

    return {
        "noteCount": len(velocities),
        "averageVelocity": round(sum(velocities) / len(velocities), 3) if velocities else 0.0,
        "averageQuarterLength": round(sum(durations) / len(durations), 4) if durations else 0.0,
    }

for track in mf.tracks:
    absolute_time = 0
    active_notes = {}
    rendered_notes = []
    for event in track.events:
        absolute_time += getattr(event, "time", 0)
        event_type = getattr(event, "type", None)
        pitch = getattr(event, "pitch", None)
        channel = getattr(event, "channel", 0)
        velocity = int(getattr(event, "velocity", 0) or 0)

        if pitch is None:
            continue

        key = (channel, int(pitch))
        if event_type == midi.ChannelVoiceMessages.NOTE_ON and velocity > 0:
            active_notes.setdefault(key, []).append(
                {"start": int(absolute_time), "velocity": velocity}
            )
            continue

        if event_type not in {
            midi.ChannelVoiceMessages.NOTE_OFF,
            midi.ChannelVoiceMessages.NOTE_ON,
        }:
            continue

        started_notes = active_notes.get(key)
        if not started_notes:
            continue

        current_note = started_notes.pop(0)
        rendered_notes.append(
            {
                "pitch": int(pitch),
                "start": int(current_note["start"]),
                "duration": max(1, int(absolute_time) - int(current_note["start"])),
                "velocity": int(current_note["velocity"]),
            }
        )

    if rendered_notes:
        parts.append(
            {
                "overall": summarize(rendered_notes),
                "early": summarize(rendered_notes, 1, 2),
                "late": summarize(rendered_notes, 3, 4),
            }
        )

print(json.dumps({"parts": parts}))
`;

    return await runMusic21JsonScript(script, [midiPath]);
}

async function analyzeChordalSubvoiceHumanizedMidi(midiPath) {
    const script = String.raw`
import json
import sys
from music21 import midi

mf = midi.MidiFile()
mf.open(sys.argv[1])
mf.read()
mf.close()

ticks_per_quarter = int(mf.ticksPerQuarterNote or 10080)
measure_ticks = ticks_per_quarter * 4
note_tracks = []

for track in mf.tracks:
    absolute_time = 0
    active_notes = {}
    rendered_notes = []
    for event in track.events:
        absolute_time += getattr(event, "time", 0)
        event_type = getattr(event, "type", None)
        pitch = getattr(event, "pitch", None)
        channel = getattr(event, "channel", 0)
        velocity = int(getattr(event, "velocity", 0) or 0)

        if pitch is None:
            continue

        key = (channel, int(pitch))
        if event_type == midi.ChannelVoiceMessages.NOTE_ON and velocity > 0:
            active_notes.setdefault(key, []).append(
                {"start": int(absolute_time), "velocity": velocity}
            )
            continue

        if event_type not in {
            midi.ChannelVoiceMessages.NOTE_OFF,
            midi.ChannelVoiceMessages.NOTE_ON,
        }:
            continue

        if event_type == midi.ChannelVoiceMessages.NOTE_ON and velocity > 0:
            continue

        if event_type == midi.ChannelVoiceMessages.NOTE_ON and velocity != 0:
            continue

        started_notes = active_notes.get(key)
        if not started_notes:
            continue

        current_note = started_notes.pop(0)
        rendered_notes.append(
            {
                "pitch": int(pitch),
                "start": int(current_note["start"]),
                "duration": max(1, int(absolute_time) - int(current_note["start"])),
                "velocity": int(current_note["velocity"]),
            }
        )

    if rendered_notes:
        note_tracks.append(rendered_notes)

accompaniment = note_tracks[1] if len(note_tracks) > 1 else note_tracks[0]

def summarize(records, start_measure=None, end_measure=None, min_pitch=None, max_pitch=None):
    velocities = []
    durations = []
    for record in records:
        measure_number = int(record["start"] // measure_ticks) + 1
        if start_measure is not None:
            if measure_number is None or measure_number < start_measure or measure_number > end_measure:
                continue

        pitch = int(record["pitch"])
        if min_pitch is not None and pitch < min_pitch:
            continue
        if max_pitch is not None and pitch > max_pitch:
            continue

        velocities.append(int(record["velocity"]))
        durations.append(float(record["duration"]) / float(ticks_per_quarter))

    return {
        "noteCount": len(velocities),
        "averageVelocity": round(sum(velocities) / len(velocities), 3) if velocities else 0.0,
        "averageQuarterLength": round(sum(durations) / len(durations), 4) if durations else 0.0,
    }

payload = {
    "ranges": {
        "lowEarly": summarize(accompaniment, 1, 2, max_pitch=50),
        "middleEarly": summarize(accompaniment, 1, 2, min_pitch=52, max_pitch=62),
        "highEarly": summarize(accompaniment, 1, 2, min_pitch=63),
        "lowLate": summarize(accompaniment, 3, 4, max_pitch=50),
        "middleLate": summarize(accompaniment, 3, 4, min_pitch=52, max_pitch=62),
        "highLate": summarize(accompaniment, 3, 4, min_pitch=63),
    },
}
print(json.dumps(payload))
`;

    return await runMusic21JsonScript(script, [midiPath]);
}

async function analyzeChordalArpeggioSpreadByBeat(midiPath, targetBeat = 1) {
    const script = String.raw`
import json
import sys
from music21 import midi

mf = midi.MidiFile()
mf.open(sys.argv[1])
mf.read()
mf.close()

ticks_per_quarter = int(mf.ticksPerQuarterNote or 10080)
measure_ticks = ticks_per_quarter * 4
target_beat = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
note_tracks = []

for track in mf.tracks:
    absolute_time = 0
    active_notes = {}
    rendered_notes = []
    for event in track.events:
        absolute_time += getattr(event, "time", 0)
        event_type = getattr(event, "type", None)
        pitch = getattr(event, "pitch", None)
        channel = getattr(event, "channel", 0)
        velocity = int(getattr(event, "velocity", 0) or 0)

        if pitch is None:
            continue

        key = (channel, int(pitch))
        if event_type == midi.ChannelVoiceMessages.NOTE_ON and velocity > 0:
            active_notes.setdefault(key, []).append({"start": int(absolute_time)})
            continue

        if event_type not in {
            midi.ChannelVoiceMessages.NOTE_OFF,
            midi.ChannelVoiceMessages.NOTE_ON,
        }:
            continue

        started_notes = active_notes.get(key)
        if not started_notes:
            continue

        current_note = started_notes.pop(0)
        rendered_notes.append({
            "pitch": int(pitch),
            "start": int(current_note["start"]),
        })

    if rendered_notes:
        note_tracks.append(rendered_notes)

accompaniment = note_tracks[1] if len(note_tracks) > 1 else note_tracks[0]
grouped_starts = {}

for record in accompaniment:
    start = int(record["start"])
    measure_number = int(start // measure_ticks) + 1
    beat_position = ((start % measure_ticks) / float(ticks_per_quarter)) + 1.0
    if abs(beat_position - target_beat) > 0.4:
        continue

    grouped_starts.setdefault(str(measure_number), []).append(start / float(ticks_per_quarter))

spreads = [max(starts) - min(starts) for starts in grouped_starts.values() if len(starts) > 1]
payload = {
    "measureCount": len(grouped_starts),
    "groupedEventCount": len(spreads),
    "averageOnsetSpreadBeats": round(sum(spreads) / len(spreads), 4) if spreads else 0.0,
    "peakOnsetSpreadBeats": round(max(spreads), 4) if spreads else 0.0,
}
print(json.dumps(payload))
`;

    return await runMusic21JsonScript(script, [midiPath, String(targetBeat)]);
}

async function analyzeGraceLeadInByBeat(midiPath, targetBeat = 1, trackIndex = 0) {
    const script = String.raw`
import json
import sys
from music21 import midi

mf = midi.MidiFile()
mf.open(sys.argv[1])
mf.read()
mf.close()

ticks_per_quarter = int(mf.ticksPerQuarterNote or 10080)
measure_ticks = ticks_per_quarter * 4
target_beat = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
track_index = int(sys.argv[3]) if len(sys.argv) > 3 else 0
note_tracks = []

for track in mf.tracks:
    absolute_time = 0
    active_notes = {}
    rendered_notes = []
    for event in track.events:
        absolute_time += getattr(event, "time", 0)
        event_type = getattr(event, "type", None)
        pitch = getattr(event, "pitch", None)
        channel = getattr(event, "channel", 0)
        velocity = int(getattr(event, "velocity", 0) or 0)

        if pitch is None:
            continue

        key = (channel, int(pitch))
        if event_type == midi.ChannelVoiceMessages.NOTE_ON and velocity > 0:
            active_notes.setdefault(key, []).append({"start": int(absolute_time)})
            continue

        if event_type not in {
            midi.ChannelVoiceMessages.NOTE_OFF,
            midi.ChannelVoiceMessages.NOTE_ON,
        }:
            continue

        started_notes = active_notes.get(key)
        if not started_notes:
            continue

        current_note = started_notes.pop(0)
        rendered_notes.append({
            "pitch": int(pitch),
            "start": int(current_note["start"]),
        })

    if rendered_notes:
        note_tracks.append(rendered_notes)

selected_track = note_tracks[track_index] if len(note_tracks) > track_index else note_tracks[0]
grouped_starts = {}

for record in selected_track:
    start = int(record["start"])
    measure_number = int(start // measure_ticks) + 1
    beat_position = ((start % measure_ticks) / float(ticks_per_quarter)) + 1.0
    if beat_position < target_beat - 0.05 or beat_position > target_beat + 0.35:
        continue

    grouped_starts.setdefault(str(measure_number), []).append(start / float(ticks_per_quarter))

lead_ins = [max(starts) - min(starts) for starts in grouped_starts.values() if len(starts) > 1]
payload = {
    "measureCount": len(grouped_starts),
    "groupedEventCount": len(lead_ins),
    "averageGraceLeadInBeats": round(sum(lead_ins) / len(lead_ins), 4) if lead_ins else 0.0,
    "peakGraceLeadInBeats": round(max(lead_ins), 4) if lead_ins else 0.0,
}
print(json.dumps(payload))
`;

    return await runMusic21JsonScript(script, [midiPath, String(targetBeat), String(trackIndex)]);
}

async function analyzeTrillOscillationByBeat(midiPath, targetBeat = 1, trackIndex = 0) {
    const script = String.raw`
import json
import sys
from music21 import midi

mf = midi.MidiFile()
mf.open(sys.argv[1])
mf.read()
mf.close()

ticks_per_quarter = int(mf.ticksPerQuarterNote or 10080)
measure_ticks = ticks_per_quarter * 4
target_beat = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
track_index = int(sys.argv[3]) if len(sys.argv) > 3 else 0
note_tracks = []

for track in mf.tracks:
    absolute_time = 0
    active_notes = {}
    rendered_notes = []
    for event in track.events:
        absolute_time += getattr(event, "time", 0)
        event_type = getattr(event, "type", None)
        pitch = getattr(event, "pitch", None)
        channel = getattr(event, "channel", 0)
        velocity = int(getattr(event, "velocity", 0) or 0)

        if pitch is None:
            continue

        key = (channel, int(pitch))
        if event_type == midi.ChannelVoiceMessages.NOTE_ON and velocity > 0:
            active_notes.setdefault(key, []).append({"start": int(absolute_time)})
            continue

        if event_type not in {
            midi.ChannelVoiceMessages.NOTE_OFF,
            midi.ChannelVoiceMessages.NOTE_ON,
        }:
            continue

        started_notes = active_notes.get(key)
        if not started_notes:
            continue

        current_note = started_notes.pop(0)
        rendered_notes.append({
            "pitch": int(pitch),
            "start": int(current_note["start"]),
        })

    if rendered_notes:
        note_tracks.append(rendered_notes)

selected_track = note_tracks[track_index] if len(note_tracks) > track_index else note_tracks[0]
grouped_starts = {}

for record in selected_track:
    start = int(record["start"])
    measure_number = int(start // measure_ticks) + 1
    beat_position = ((start % measure_ticks) / float(ticks_per_quarter)) + 1.0
    if beat_position < target_beat - 0.05 or beat_position > target_beat + 0.95:
        continue

    grouped_starts.setdefault(str(measure_number), []).append(start / float(ticks_per_quarter))

oscillation_counts = [len(starts) for starts in grouped_starts.values() if len(starts) > 1]
spans = [max(starts) - min(starts) for starts in grouped_starts.values() if len(starts) > 1]
payload = {
    "measureCount": len(grouped_starts),
    "groupedEventCount": len(spans),
    "averageTrillOscillationCount": round(sum(oscillation_counts) / len(oscillation_counts), 4) if oscillation_counts else 0.0,
    "peakTrillOscillationCount": round(max(oscillation_counts), 4) if oscillation_counts else 0.0,
    "averageTrillSpanBeats": round(sum(spans) / len(spans), 4) if spans else 0.0,
    "peakTrillSpanBeats": round(max(spans), 4) if spans else 0.0,
}
print(json.dumps(payload))
`;

    return await runMusic21JsonScript(script, [midiPath, String(targetBeat), String(trackIndex)]);
}

test("normalizeComposeRequestInput accepts multimodel compose payload", () => {
    const normalized = normalizeComposeRequestInput({
        prompt: "Write a chamber nocturne with violin and piano.",
        workflow: "symbolic_plus_audio",
        selectedModels: [
            { role: "structure", provider: "python", model: "music21-symbolic-v1" },
            { role: "audio_renderer", provider: "transformers", model: "facebook/musicgen-large" },
        ],
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "A two-section nocturne with a returning violin motif.",
            mood: ["intimate", "lyrical"],
            form: "nocturne",
            inspirationThread: "Carry one fragile cadence idea through the whole miniature.",
            intentRationale: "Recent outputs were too direct, so this one should feel more withheld.",
            contrastTarget: "Stay softer than recent major-key pieces.",
            riskProfile: "exploratory",
            structureVisibility: "hidden",
            humanizationStyle: "restrained",
            targetDurationSec: 96,
            targetMeasures: 16,
            meter: "4/4",
            key: "D minor",
            tempo: 68,
            workflow: "symbolic_plus_audio",
            instrumentation: [
                { name: "violin", family: "strings", roles: ["lead"], register: "high" },
                { name: "piano", family: "keyboard", roles: ["pad", "bass"], register: "wide" },
            ],
            textureDefaults: {
                voiceCount: 3,
                primaryRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
                notes: ["Keep the middle voice recessed."],
            },
            expressionDefaults: {
                dynamics: {
                    start: "pp",
                    peak: "mp",
                    end: "p",
                    hairpins: [{ shape: "crescendo", startMeasure: 1, endMeasure: 4, target: "mp" }],
                },
                articulation: ["legato", "tenuto"],
                character: ["dolce", "tranquillo"],
                sustainBias: 0.2,
            },
            tempoMotionDefaults: [
                { tag: "ritardando", startMeasure: 13, endMeasure: 16, intensity: 0.6, notes: ["Broaden into the return."] },
            ],
            ornamentDefaults: [
                { tag: "fermata", startMeasure: 16, targetBeat: 4, intensity: 0.8, notes: ["Hold the cadence."] },
            ],
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
                    label: "Opening",
                    measures: 8,
                    energy: 0.3,
                    density: 0.3,
                    phraseFunction: "presentation",
                    phraseSpanShape: "sentence",
                    continuationPressure: "low",
                    cadence: "half",
                    harmonicPlan: {
                        tonalCenter: "D minor",
                        harmonicRhythm: "medium",
                        prolongationMode: "tonic",
                        tonicizationWindows: [{ startMeasure: 5, endMeasure: 6, keyTarget: "A minor", emphasis: "prepared", cadence: "half" }],
                        colorCues: [
                            { tag: "mixture", startMeasure: 3, endMeasure: 4, intensity: 0.5, notes: ["Darken the answer briefly."] },
                            { tag: "applied dominant", startMeasure: 5, endMeasure: 6, keyTarget: "A minor" },
                        ],
                        allowModulation: true,
                    },
                    texture: {
                        voiceCount: 2,
                        primaryRoles: ["lead", "chordal_support", "bass"],
                        counterpointMode: "none",
                    },
                    expression: {
                        articulation: ["tenuto", "staccatissimo"],
                        character: ["cantabile", "grazioso"],
                        phrasePeaks: [3, 7],
                    },
                    tempoMotion: [
                        { tag: "stringendo", startMeasure: 5, endMeasure: 7, intensity: 0.35 },
                        { tag: "a tempo", startMeasure: 8, endMeasure: 8 },
                    ],
                    ornaments: [
                        { tag: "fermata", startMeasure: 8, targetBeat: 4, intensity: 0.7 },
                    ],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Return",
                    measures: 8,
                    energy: 0.28,
                    density: 0.25,
                    phraseSpanShape: "cadential_unit",
                    cadentialBuildup: "surging",
                    cadence: "authentic",
                    motifRef: "s1",
                    harmonicPlan: {
                        tonalCenter: "D minor",
                        harmonicRhythm: "slow",
                        prolongationMode: "dominant",
                        tonicizationWindows: [{ startMeasure: 7, endMeasure: 8, keyTarget: "A major", emphasis: "arriving", cadence: "authentic" }],
                        colorCues: [
                            { tag: "predominant color", startMeasure: 5, endMeasure: 6 },
                            { tag: "suspension", startMeasure: 7, resolutionMeasure: 8, notes: ["Delay the closing arrival."] },
                        ],
                        allowModulation: false,
                    },
                    tempoMotion: [
                        { tag: "ritenuto", intensity: 0.7, notes: ["Hold the cadence slightly."] },
                    ],
                },
            ],
            rationale: "Keep the same motif but tighten the cadence.",
        },
        evaluationPolicy: {
            requireStructurePass: true,
            requireAudioPass: true,
        },
        qualityPolicy: {
            enableAutoRevision: true,
            maxStructureAttempts: 3,
            targetStructureScore: 80,
        },
    });

    assert.deepEqual(normalized.errors, []);
    assert.equal(normalized.request?.workflow, "symbolic_plus_audio");
    assert.equal(normalized.request?.compositionPlan?.sections.length, 2);
    assert.equal(normalized.request?.selectedModels?.length, 2);
    assert.equal(normalized.request?.evaluationPolicy?.requireAudioPass, true);
    assert.equal(normalized.request?.qualityPolicy?.maxStructureAttempts, 3);
    assert.equal(normalized.request?.qualityPolicy?.targetStructureScore, 80);
    assert.equal(normalized.request?.compositionPlan?.riskProfile, "exploratory");
    assert.equal(normalized.request?.compositionPlan?.structureVisibility, "hidden");
    assert.equal(normalized.request?.compositionPlan?.humanizationStyle, "restrained");
    assert.equal(normalized.request?.compositionPlan?.textureDefaults?.voiceCount, 3);
    assert.equal(normalized.request?.compositionPlan?.textureDefaults?.primaryRoles?.[1], "inner_voice");
    assert.equal(normalized.request?.compositionPlan?.textureDefaults?.counterpointMode, "contrary_motion");
    assert.equal(normalized.request?.compositionPlan?.expressionDefaults?.dynamics?.start, "pp");
    assert.equal(normalized.request?.compositionPlan?.expressionDefaults?.character?.[0], "dolce");
    assert.equal(normalized.request?.compositionPlan?.expressionDefaults?.character?.[1], "tranquillo");
    assert.equal(normalized.request?.compositionPlan?.tempoMotionDefaults?.[0]?.tag, "ritardando");
    assert.equal(normalized.request?.compositionPlan?.tempoMotionDefaults?.[0]?.intensity, 0.6);
    assert.equal(normalized.request?.compositionPlan?.ornamentDefaults?.[0]?.tag, "fermata");
    assert.equal(normalized.request?.compositionPlan?.ornamentDefaults?.[0]?.targetBeat, 4);
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.phraseFunction, "presentation");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.phraseSpanShape, "sentence");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.continuationPressure, "low");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.harmonicPlan?.prolongationMode, "tonic");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.harmonicPlan?.tonicizationWindows?.[0]?.keyTarget, "A minor");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.harmonicPlan?.colorCues?.[0]?.tag, "mixture");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.harmonicPlan?.colorCues?.[1]?.tag, "applied_dominant");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.harmonicPlan?.colorCues?.[1]?.keyTarget, "A minor");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.texture?.primaryRoles?.[1], "chordal_support");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.expression?.articulation?.[0], "tenuto");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.expression?.articulation?.[1], "staccatissimo");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.expression?.character?.[1], "grazioso");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.expression?.phrasePeaks?.[1], 7);
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.tempoMotion?.[0]?.tag, "stringendo");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.tempoMotion?.[1]?.tag, "a_tempo");
    assert.equal(normalized.request?.compositionPlan?.sections[0]?.ornaments?.[0]?.tag, "fermata");
    assert.equal(normalized.request?.compositionPlan?.sections[1]?.phraseSpanShape, "cadential_unit");
    assert.equal(normalized.request?.compositionPlan?.sections[1]?.cadentialBuildup, "surging");
    assert.equal(normalized.request?.compositionPlan?.sections[1]?.harmonicPlan?.tonicizationWindows?.[0]?.emphasis, "arriving");
    assert.equal(normalized.request?.compositionPlan?.sections[1]?.harmonicPlan?.colorCues?.[0]?.tag, "predominant_color");
    assert.equal(normalized.request?.compositionPlan?.sections[1]?.harmonicPlan?.colorCues?.[1]?.tag, "suspension");
    assert.equal(normalized.request?.compositionPlan?.sections[1]?.harmonicPlan?.colorCues?.[1]?.resolutionMeasure, 8);
    assert.equal(normalized.request?.compositionPlan?.sections[1]?.tempoMotion?.[0]?.tag, "ritenuto");
});

test("normalizeComposeRequestInput rejects deprecated sonification input and points callers to compositionProfile", () => {
    const normalized = normalizeComposeRequestInput({
        prompt: "Write a compact miniature from source data.",
        sonification: {
            type: "timeseries",
            data: [0.1, 0.3, -0.2, 0.4],
        },
    });

    assert.equal(normalized.request, undefined);
    assert.ok(normalized.errors.includes(
        "sonification is no longer supported; provide compositionProfile pitchContour/density/tension hints instead",
    ));
});

test("normalizeComposeRequestInput coerces sonata requests to symbolic-first workflow", () => {
    const normalized = normalizeComposeRequestInput({
        prompt: "Write a compact piano sonata with a clear return.",
        workflow: "audio_only",
        selectedModels: [
            { role: "audio_renderer", provider: "transformers", model: "facebook/musicgen-large" },
        ],
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "A compact sonata with a modulatory middle and clear return.",
            mood: ["driven"],
            form: "sonata",
            targetDurationSec: 110,
            targetMeasures: 24,
            key: "C major",
            tempo: 108,
            workflow: "audio_only",
            instrumentation: [
                { name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" },
            ],
            motifPolicy: {
                reuseRequired: true,
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.42, density: 0.36, harmonicPlan: { tonalCenter: "C major", allowModulation: false } },
                { id: "s2", role: "theme_b", label: "Contrast", measures: 8, energy: 0.5, density: 0.42, harmonicPlan: { tonalCenter: "G major", allowModulation: true } },
                { id: "s3", role: "development", label: "Development", measures: 8, energy: 0.72, density: 0.58, harmonicPlan: { tonalCenter: "A minor", allowModulation: true } },
                { id: "s4", role: "recap", label: "Recap", measures: 8, energy: 0.34, density: 0.3, motifRef: "s1", harmonicPlan: { tonalCenter: "C major", allowModulation: false } },
            ],
            rationale: "Keep the tonal return explicit.",
        },
    });

    assert.deepEqual(normalized.errors, []);
    assert.equal(normalized.request?.workflow, "symbolic_plus_audio");
    assert.equal(normalized.request?.compositionPlan?.workflow, "symbolic_plus_audio");
    assert.ok(normalized.request?.selectedModels?.some((binding) => binding.role === "structure"));
    assert.ok(normalized.request?.selectedModels?.some((binding) => binding.role === "audio_renderer"));
});

test("normalizeComposeRequestInput preserves long-span form guidance for sonata plans", () => {
    const normalized = normalizeComposeRequestInput({
        prompt: "Write a compact sonata with a delayed but inevitable return.",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "A compact sonata with explicit long-range return planning.",
            mood: ["driven"],
            form: "sonata",
            targetDurationSec: 110,
            targetMeasures: 24,
            key: "C major",
            tempo: 108,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" },
            ],
            motifPolicy: {
                reuseRequired: true,
            },
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
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.42, density: 0.36, harmonicPlan: { tonalCenter: "C major", allowModulation: false } },
                { id: "s2", role: "theme_b", label: "Contrast", measures: 8, energy: 0.5, density: 0.42, harmonicPlan: { tonalCenter: "G major", allowModulation: true } },
                { id: "s3", role: "development", label: "Development", measures: 8, energy: 0.72, density: 0.58, harmonicPlan: { tonalCenter: "A minor", allowModulation: true } },
                { id: "s4", role: "recap", label: "Recap", measures: 8, energy: 0.34, density: 0.3, motifRef: "s1", harmonicPlan: { tonalCenter: "C major", allowModulation: false } },
            ],
            rationale: "Keep the opening identity alive through the return.",
        },
    });

    assert.deepEqual(normalized.errors, []);
    assert.equal(normalized.request?.compositionPlan?.longSpanForm?.expectedDevelopmentPressure, "high");
    assert.equal(normalized.request?.compositionPlan?.longSpanForm?.expectedReturnPayoff, "inevitable");
    assert.equal(normalized.request?.compositionPlan?.longSpanForm?.thematicCheckpoints?.length, 2);
    assert.equal(normalized.request?.compositionPlan?.longSpanForm?.thematicCheckpoints?.[0]?.transform, "fragment");
    assert.equal(normalized.request?.compositionPlan?.longSpanForm?.thematicCheckpoints?.[1]?.transform, "delay_return");
});

test("normalizeComposeRequestInput derives string-trio orchestration guidance from instrumentation and texture", () => {
    const normalized = normalizeComposeRequestInput({
        prompt: "Write a compact string trio with a conversational opening and a gentler close.",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "A compact string trio with a layered opening and quieter cadence.",
            mood: ["intimate"],
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
            motifPolicy: {
                reuseRequired: true,
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 8,
                    energy: 0.4,
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
            rationale: "Keep the trio layered instead of piano-like.",
        },
    });

    assert.deepEqual(normalized.errors, []);
    assert.equal(normalized.request?.compositionPlan?.orchestration?.family, "string_trio");
    assert.deepEqual(normalized.request?.compositionPlan?.orchestration?.instrumentNames, ["violin", "viola", "cello"]);
    assert.equal(normalized.request?.compositionPlan?.orchestration?.sections[0]?.conversationMode, "conversational");
    assert.equal(normalized.request?.compositionPlan?.orchestration?.sections[0]?.balanceProfile, "balanced");
    assert.equal(normalized.request?.compositionPlan?.orchestration?.sections[1]?.conversationMode, "support");
    assert.equal(normalized.request?.compositionPlan?.orchestration?.sections[1]?.balanceProfile, "lead_forward");
});

test("normalizeComposeRequestInput rejects malformed sonata plans", () => {
    const normalized = normalizeComposeRequestInput({
        prompt: "Write a short sonata movement.",
        compositionPlan: {
            version: "planner-schema-v2",
            brief: "A malformed sonata plan.",
            mood: ["focused"],
            form: "sonata",
            targetDurationSec: 90,
            targetMeasures: 16,
            key: "D minor",
            tempo: 98,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" },
            ],
            motifPolicy: {
                reuseRequired: true,
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 8, energy: 0.42, density: 0.36, harmonicPlan: { tonalCenter: "D minor", allowModulation: false } },
                { id: "s2", role: "cadence", label: "Close", measures: 8, energy: 0.3, density: 0.28, harmonicPlan: { tonalCenter: "F major", allowModulation: false } },
            ],
            rationale: "This omits development and recap.",
        },
    });

    assert.ok(normalized.errors.includes("sonata compositionPlan must include at least 4 sections"));
    assert.ok(normalized.errors.includes("sonata compositionPlan must include a development section"));
    assert.ok(normalized.errors.includes("sonata compositionPlan must include a recap section"));
    assert.ok(normalized.errors.includes("sonata compositionPlan must include a theme_b section"));
});

test("buildExecutionPlan forces sonata audio requests onto a symbolic-first worker", () => {
    const executionPlan = buildExecutionPlan({
        prompt: "Write a piano sonata with a vivid recapitulation.",
        form: "sonata",
        workflow: "audio_only",
        selectedModels: [
            { role: "audio_renderer", provider: "transformers", model: "facebook/musicgen-large" },
        ],
    });

    assert.equal(executionPlan.workflow, "symbolic_plus_audio");
    assert.equal(executionPlan.composeWorker, "music21");
    assert.ok(executionPlan.selectedModels.some((binding) => binding.role === "structure"));
    assert.ok(executionPlan.selectedModels.some((binding) => binding.role === "audio_renderer"));
});

test("buildExecutionPlan selects learned_symbolic for learned structure bindings on symbolic workflows", () => {
    const executionPlan = buildExecutionPlan({
        prompt: "Compose a compact string trio miniature with motivic continuity.",
        form: "miniature",
        workflow: "symbolic_only",
        selectedModels: [
            { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
        ],
    });

    assert.equal(executionPlan.composeWorker, "learned_symbolic");
    assert.deepEqual(executionPlan.selectedModels, [
        { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
    ]);
});

test("learned_symbolic worker produces a normalized string trio miniature candidate", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-symbolic-"));
    const outputDir = path.join(tempRoot, "outputs");
    const previousOutputDir = config.outputDir;
    const previousPythonBin = config.pythonBin;
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        config.outputDir = outputDir;
        config.pythonBin = pythonBin;

        const result = await compose({
            songId: "learned-string-trio",
            prompt: "Compose a compact string trio miniature with a calm opening and a clear cadence.",
            key: "D minor",
            tempo: 88,
            form: "miniature",
            workflow: "symbolic_only",
            selectedModels: [
                { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
            ],
            compositionPlan: {
                version: "plan-v1",
                brief: "string trio miniature",
                form: "miniature",
                workflow: "symbolic_only",
                instrumentation: [
                    { name: "Violin", family: "strings", roles: ["lead"] },
                    { name: "Viola", family: "strings", roles: ["support"] },
                    { name: "Cello", family: "strings", roles: ["bass"] },
                ],
                orchestration: {
                    family: "string_trio",
                    instrumentNames: ["Violin", "Viola", "Cello"],
                    sections: [],
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
                        role: "closing",
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
                rationale: ["narrow learned symbolic lane"],
            },
        });

        assert.equal(result.executionPlan?.composeWorker, "learned_symbolic");
        assert.equal(result.meta?.selectedModels?.[0]?.provider, "learned");
        assert.ok(result.midiData.length > 0);
        assert.equal(result.proposalEvidence?.worker, "learned_symbolic");
        assert.equal(result.proposalEvidence?.lane, "string_trio_symbolic");
        assert.equal(result.proposalEvidence?.generationMode, "plan_conditioned_trio_template");
        assert.equal(result.proposalEvidence?.confidence, 0.61);
        assert.equal(result.proposalEvidence?.summary?.partCount, 3);
        assert.equal(result.sectionArtifacts?.length, 2);
        assert.equal(result.sectionArtifacts?.[0]?.measureCount, 4);
        assert.equal(result.sectionArtifacts?.[0]?.primaryTextureRoles?.join(","), "lead,counterline,bass");
        assert.ok(fs.existsSync(path.join(outputDir, "learned-string-trio", "composition.mid")));
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }
        throw error;
    } finally {
        config.outputDir = previousOutputDir;
        config.pythonBin = previousPythonBin;
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned_symbolic worker localizes targeted rewrite to the requested weak section", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-symbolic-rewrite-"));
    const outputDir = path.join(tempRoot, "outputs");
    const previousOutputDir = config.outputDir;
    const previousPythonBin = config.pythonBin;
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        config.outputDir = outputDir;
        config.pythonBin = pythonBin;

        const baseRequest = {
            prompt: "Compose a compact string trio miniature and intensify only the middle section on retry.",
            key: "D minor",
            tempo: 88,
            form: "miniature",
            workflow: "symbolic_only",
            selectedModels: [
                { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
            ],
            compositionPlan: {
                version: "plan-v1",
                brief: "string trio miniature",
                mood: ["focused", "restless"],
                form: "miniature",
                workflow: "symbolic_only",
                instrumentation: [
                    { name: "Violin", family: "strings", roles: ["lead"] },
                    { name: "Viola", family: "strings", roles: ["support"] },
                    { name: "Cello", family: "strings", roles: ["bass"] },
                ],
                orchestration: {
                    family: "string_trio",
                    instrumentNames: ["Violin", "Viola", "Cello"],
                    sections: [],
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
                        label: "Opening",
                        measures: 4,
                        energy: 0.32,
                        density: 0.28,
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
                        role: "development",
                        label: "Middle",
                        measures: 4,
                        energy: 0.52,
                        density: 0.42,
                        phraseFunction: "continuation",
                        harmonicPlan: {
                            tonalCenter: "A minor",
                            harmonicRhythm: "fast",
                            cadence: "half",
                            allowModulation: true,
                        },
                    },
                    {
                        id: "s3",
                        role: "closing",
                        label: "Cadence",
                        measures: 4,
                        energy: 0.38,
                        density: 0.3,
                        phraseFunction: "cadential",
                        harmonicPlan: {
                            tonalCenter: "D minor",
                            harmonicRhythm: "medium",
                            cadence: "authentic",
                            allowModulation: false,
                        },
                    },
                ],
                rationale: ["stage-l6 targeted rewrite smoke test"],
            },
        };

        const baseline = await compose({
            songId: "learned-string-trio-rewrite-base",
            ...baseRequest,
        });
        const revised = await compose({
            songId: "learned-string-trio-rewrite-attempt-2",
            ...baseRequest,
            attemptIndex: 2,
            sectionArtifacts: baseline.sectionArtifacts,
            revisionDirectives: [
                {
                    kind: "clarify_narrative_arc",
                    priority: 90,
                    reason: "Only intensify the middle continuation.",
                    sectionIds: ["s2"],
                },
            ],
        });

        assert.equal(baseline.executionPlan?.composeWorker, "learned_symbolic");
        assert.equal(revised.executionPlan?.composeWorker, "learned_symbolic");
        assert.equal(baseline.proposalEvidence?.generationMode, "plan_conditioned_trio_template");
        assert.equal(revised.proposalEvidence?.generationMode, "targeted_section_rewrite");
        assert.ok(revised.sectionTransforms?.length);
        assert.equal(revised.sectionTransforms?.[0]?.sectionId, "s2");
        assert.match(revised.sectionTransforms?.[0]?.transformMode ?? "", /targeted_rewrite:clarify_narrative_arc/);

        const baselineOpening = baseline.sectionArtifacts?.find((entry) => entry.sectionId === "s1");
        const revisedOpening = revised.sectionArtifacts?.find((entry) => entry.sectionId === "s1");
        const baselineMiddle = baseline.sectionArtifacts?.find((entry) => entry.sectionId === "s2");
        const revisedMiddle = revised.sectionArtifacts?.find((entry) => entry.sectionId === "s2");
        const baselineClosing = baseline.sectionArtifacts?.find((entry) => entry.sectionId === "s3");
        const revisedClosing = revised.sectionArtifacts?.find((entry) => entry.sectionId === "s3");

        assert.ok(baselineOpening && revisedOpening && baselineMiddle && revisedMiddle && baselineClosing && revisedClosing);
        assert.deepEqual(revisedOpening, baselineOpening);
        assert.deepEqual(revisedClosing, baselineClosing);
        assert.notDeepEqual(revisedMiddle, baselineMiddle);
        assert.equal(revisedMiddle.transform?.sectionId, "s2");

        const baselineMiddleSpan = Math.max(...baselineMiddle.noteHistory) - Math.min(...baselineMiddle.noteHistory);
        const revisedMiddleSpan = Math.max(...revisedMiddle.noteHistory) - Math.min(...revisedMiddle.noteHistory);
        assert.ok(revisedMiddleSpan > baselineMiddleSpan);
        assert.notDeepEqual(baseline.midiData, revised.midiData);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }
        throw error;
    } finally {
        config.outputDir = previousOutputDir;
        config.pythonBin = previousPythonBin;
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("learned_symbolic worker degrades cleanly to music21 outside the narrow lane", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-symbolic-fallback-"));
    const outputDir = path.join(tempRoot, "outputs");
    const previousOutputDir = config.outputDir;
    const previousPythonBin = config.pythonBin;
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        config.outputDir = outputDir;
        config.pythonBin = pythonBin;

        const result = await compose({
            songId: "fallback-music21",
            prompt: "Compose a short keyboard study with a clear opening sentence.",
            key: "C major",
            tempo: 96,
            form: "short",
            workflow: "symbolic_only",
            selectedModels: [
                { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
            ],
            compositionPlan: {
                version: "plan-v1",
                brief: "keyboard short",
                form: "short",
                workflow: "symbolic_only",
                instrumentation: [
                    { name: "Piano", family: "keyboard", roles: ["lead", "support"] },
                ],
                motifPolicy: {
                    reuseRequired: false,
                    inversionAllowed: false,
                    augmentationAllowed: false,
                    diminutionAllowed: false,
                    sequenceAllowed: false,
                },
                sections: [
                    {
                        id: "s1",
                        role: "theme_a",
                        label: "Opening",
                        measures: 4,
                        energy: 0.4,
                        density: 0.42,
                        harmonicPlan: {
                            tonalCenter: "C major",
                            harmonicRhythm: "medium",
                            cadence: "half",
                            allowModulation: false,
                        },
                    },
                ],
                rationale: ["fallback expected"],
            },
        });

        assert.equal(result.executionPlan?.composeWorker, "music21");
        assert.equal(result.meta?.selectedModels?.[0]?.provider, "python");
        assert.equal(result.meta?.selectedModels?.[0]?.model, "music21-symbolic-v1");
        assert.equal(result.proposalEvidence, undefined);
        assert.ok(result.midiData.length > 0);
    } catch (error) {
        if (String(error?.message ?? error).includes("No module named 'music21'")) {
            t.skip("music21 is not installed in the local test environment");
            return;
        }
        throw error;
    } finally {
        config.outputDir = previousOutputDir;
        config.pythonBin = previousPythonBin;
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("mergeRenderedAndStyledArtifacts preserves score-aligned audio and stores styled audio separately", () => {
    const merged = mergeRenderedAndStyledArtifacts(
        {
            midi: "outputs/song/composition.mid",
            scoreImage: "outputs/song/score.svg",
            audio: "outputs/song/output.wav",
            renderedAudio: "outputs/song/output.wav",
        },
        {
            audio: "outputs/song/styled-output.wav",
            styledAudio: "outputs/song/styled-output.wav",
        },
    );

    assert.equal(merged.audio, "outputs/song/output.wav");
    assert.equal(merged.renderedAudio, "outputs/song/output.wav");
    assert.equal(merged.styledAudio, "outputs/song/styled-output.wav");
});

test("buildHumanizeWorkerInput threads expression guidance to the worker", () => {
    const workerInput = buildHumanizeWorkerInput("in.mid", "out.mid", {
        style: "restrained",
        reflection: "keep the cadence soft",
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 4,
                energy: 0.3,
                density: 0.24,
                harmonicPlan: {
                    prolongationMode: "pedal",
                    tonicizationWindows: [
                        { startMeasure: 3, endMeasure: 4, keyTarget: "G major", emphasis: "arriving" },
                    ],
                    colorCues: [
                        { tag: "suspension", startMeasure: 4, endMeasure: 4, resolutionMeasure: 4 },
                    ],
                },
            },
        ],
        expressionPlan: {
            humanizationStyle: "expressive",
            textureDefaults: {
                voiceCount: 3,
                primaryRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
            expressionDefaults: {
                dynamics: {
                    start: "pp",
                    peak: "mf",
                    end: "p",
                },
                articulation: ["legato"],
                character: ["dolce"],
                sustainBias: 0.25,
            },
            tempoMotionDefaults: [
                { tag: "ritardando", startMeasure: 5, endMeasure: 8, intensity: 0.55 },
            ],
            ornamentDefaults: [
                { tag: "fermata", startMeasure: 8, targetBeat: 4, intensity: 0.75 },
            ],
            sections: [
                {
                    sectionId: "s1",
                    phraseFunction: "presentation",
                    phraseBreath: {
                        pickupStartMeasure: 1,
                        pickupEndMeasure: 2,
                        arrivalMeasure: 3,
                        releaseStartMeasure: 4,
                        releaseEndMeasure: 4,
                        rubatoAnchors: [3, 4],
                    },
                    texture: {
                        voiceCount: 2,
                        primaryRoles: ["lead", "chordal_support", "bass"],
                        counterpointMode: "none",
                    },
                    expression: {
                        character: ["cantabile"],
                        accentBias: 0.15,
                    },
                    tempoMotion: [
                        { tag: "a tempo", startMeasure: 4, endMeasure: 4 },
                    ],
                    ornaments: [
                        { tag: "fermata", startMeasure: 4, targetBeat: 4, intensity: 0.7 },
                    ],
                },
            ],
        },
    });

    assert.equal(workerInput.style, "restrained");
    assert.equal(workerInput.expressionPlan.textureDefaults.voiceCount, 3);
    assert.equal(workerInput.expressionPlan.expressionDefaults.dynamics.start, "pp");
    assert.equal(workerInput.expressionPlan.tempoMotionDefaults[0].tag, "ritardando");
    assert.equal(workerInput.expressionPlan.ornamentDefaults[0].tag, "fermata");
    assert.equal(workerInput.expressionPlan.sections[0].phraseFunction, "presentation");
    assert.equal(workerInput.expressionPlan.sections[0].phraseBreath.arrivalMeasure, 3);
    assert.equal(workerInput.expressionPlan.sections[0].phraseBreath.rubatoAnchors[1], 4);
    assert.equal(workerInput.expressionPlan.sections[0].texture.primaryRoles[1], "chordal_support");
    assert.equal(workerInput.expressionPlan.sections[0].expression.character[0], "cantabile");
    assert.equal(workerInput.expressionPlan.sections[0].tempoMotion[0].tag, "a tempo");
    assert.equal(workerInput.expressionPlan.sections[0].ornaments[0].tag, "fermata");
    assert.equal(workerInput.sections[0].harmonicPlan.prolongationMode, "pedal");
    assert.equal(workerInput.sections[0].harmonicPlan.tonicizationWindows[0].keyTarget, "G major");
    assert.equal(workerInput.sections[0].harmonicPlan.colorCues[0].tag, "suspension");
});

test("humanizer applies extended expression vocabulary to timing and velocity shaping", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-extended-expression-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const calmOutputPath = path.join(tempRoot, "calm.mid");
        const forcefulOutputPath = path.join(tempRoot, "forceful.mid");
        await createTwoPartTestMidi(inputPath);

        const calmResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, calmOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                        expression: {
                            articulation: ["tenuto", "sostenuto"],
                            character: ["tranquillo", "grazioso"],
                        },
                    },
                ],
            },
        }));
        const forcefulResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, forcefulOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                        expression: {
                            articulation: ["staccatissimo", "marcato"],
                            character: ["energico"],
                        },
                    },
                ],
            },
        }));

        assert.equal(calmResult.ok, true);
        assert.equal(forcefulResult.ok, true);

        const calmStats = await analyzeRawHumanizedMidi(calmOutputPath);
        const forcefulStats = await analyzeRawHumanizedMidi(forcefulOutputPath);

        assert.ok(
            calmStats.parts[0].averageQuarterLength > forcefulStats.parts[0].averageQuarterLength + 0.08,
            JSON.stringify({ calmStats, forcefulStats }),
        );
        assert.ok(
            calmStats.parts[1].averageQuarterLength > forcefulStats.parts[1].averageQuarterLength + 0.08,
            JSON.stringify({ calmStats, forcefulStats }),
        );
        assert.ok(
            forcefulStats.parts[0].averageVelocity > calmStats.parts[0].averageVelocity + 2,
            JSON.stringify({ calmStats, forcefulStats }),
        );
        assert.ok(
            forcefulStats.parts[1].averageVelocity > calmStats.parts[1].averageVelocity + 1,
            JSON.stringify({ calmStats, forcefulStats }),
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

test("humanizer compounds phrase-breath and harmonic arrival cues when they overlap in the late window", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-combined-arrival-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const controlOutputPath = path.join(tempRoot, "control.mid");
        const breathOutputPath = path.join(tempRoot, "breath.mid");
        const harmonicOutputPath = path.join(tempRoot, "harmonic.mid");
        const combinedOutputPath = path.join(tempRoot, "combined.mid");
        await createTwoPartTestMidi(inputPath);

        const sectionWindow = {
            sectionId: "s1",
            startMeasure: 1,
            endMeasure: 4,
        };
        const plannedSection = {
            id: "s1",
            role: "theme_a",
            label: "Opening",
            measures: 4,
            energy: 0.3,
            density: 0.24,
        };

        const controlResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, controlOutputPath, {
            style: "mechanical",
            expressionPlan: {
                humanizationStyle: "mechanical",
                sections: [sectionWindow],
            },
            sections: [plannedSection],
        }));
        const breathResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, breathOutputPath, {
            style: "mechanical",
            expressionPlan: {
                humanizationStyle: "mechanical",
                sections: [
                    {
                        ...sectionWindow,
                        phraseBreath: {
                            pickupStartMeasure: 1,
                            pickupEndMeasure: 2,
                            arrivalMeasure: 3,
                            releaseStartMeasure: 4,
                            releaseEndMeasure: 4,
                            notes: ["Broaden the late arrival before the cadence release."],
                        },
                    },
                ],
            },
            sections: [plannedSection],
        }));
        const harmonicResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, harmonicOutputPath, {
            style: "mechanical",
            expressionPlan: {
                humanizationStyle: "mechanical",
                sections: [sectionWindow],
            },
            sections: [
                {
                    ...plannedSection,
                    harmonicPlan: {
                        prolongationMode: "pedal",
                        tonicizationWindows: [
                            { startMeasure: 3, endMeasure: 4, keyTarget: "G major", emphasis: "arriving" },
                        ],
                        colorCues: [
                            { tag: "suspension", startMeasure: 4, endMeasure: 4, resolutionMeasure: 4 },
                        ],
                    },
                },
            ],
        }));
        const combinedResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, combinedOutputPath, {
            style: "mechanical",
            expressionPlan: {
                humanizationStyle: "mechanical",
                sections: [
                    {
                        ...sectionWindow,
                        phraseBreath: {
                            pickupStartMeasure: 1,
                            pickupEndMeasure: 2,
                            arrivalMeasure: 3,
                            releaseStartMeasure: 4,
                            releaseEndMeasure: 4,
                            notes: ["Broaden the late arrival before the cadence release."],
                        },
                    },
                ],
            },
            sections: [
                {
                    ...plannedSection,
                    harmonicPlan: {
                        prolongationMode: "pedal",
                        tonicizationWindows: [
                            { startMeasure: 3, endMeasure: 4, keyTarget: "G major", emphasis: "arriving" },
                        ],
                        colorCues: [
                            { tag: "suspension", startMeasure: 4, endMeasure: 4, resolutionMeasure: 4 },
                        ],
                    },
                },
            ],
        }));

        assert.equal(controlResult.ok, true);
        assert.equal(breathResult.ok, true);
        assert.equal(harmonicResult.ok, true);
        assert.equal(combinedResult.ok, true);
        assert.equal(controlResult.expressionApplied, false);
        assert.equal(combinedResult.expressionApplied, true);
        assert.ok((combinedResult.sectionPhraseBreath?.length ?? 0) > 0);
        assert.ok((combinedResult.sectionHarmonicRealization?.length ?? 0) > 0);
        assert.deepEqual(combinedResult.sectionHarmonicRealization?.[0]?.requestedTonicizationTargets, ["G major"]);
        assert.deepEqual(combinedResult.sectionHarmonicRealization?.[0]?.requestedColorTags, ["suspension"]);

        const controlStats = await analyzeRawHumanizedMidiByMeasure(controlOutputPath);
        const breathStats = await analyzeRawHumanizedMidiByMeasure(breathOutputPath);
        const harmonicStats = await analyzeRawHumanizedMidiByMeasure(harmonicOutputPath);
        const combinedStats = await analyzeRawHumanizedMidiByMeasure(combinedOutputPath);

        assert.ok(
            combinedStats.parts[0].late.averageQuarterLength > controlStats.parts[0].late.averageQuarterLength + 0.2,
            JSON.stringify({ controlStats, breathStats, harmonicStats, combinedStats }),
        );
        assert.ok(
            combinedStats.parts[1].late.averageQuarterLength > controlStats.parts[1].late.averageQuarterLength + 0.2,
            JSON.stringify({ controlStats, breathStats, harmonicStats, combinedStats }),
        );
        assert.ok(
            combinedStats.parts[0].late.averageQuarterLength > breathStats.parts[0].late.averageQuarterLength + 0.06,
            JSON.stringify({ controlStats, breathStats, harmonicStats, combinedStats }),
        );
        assert.ok(
            combinedStats.parts[1].late.averageQuarterLength > breathStats.parts[1].late.averageQuarterLength + 0.06,
            JSON.stringify({ controlStats, breathStats, harmonicStats, combinedStats }),
        );
        assert.ok(
            combinedStats.parts[0].late.averageQuarterLength > harmonicStats.parts[0].late.averageQuarterLength + 0.06,
            JSON.stringify({ controlStats, breathStats, harmonicStats, combinedStats }),
        );
        assert.ok(
            combinedStats.parts[1].late.averageQuarterLength > harmonicStats.parts[1].late.averageQuarterLength + 0.06,
            JSON.stringify({ controlStats, breathStats, harmonicStats, combinedStats }),
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

test("humanizer applies section-local tempo-motion cues to late-section durations", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-tempo-motion-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const ritardandoOutputPath = path.join(tempRoot, "ritardando.mid");
        const accelerandoOutputPath = path.join(tempRoot, "accelerando.mid");
        await createTwoPartTestMidi(inputPath);

        const ritardandoResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, ritardandoOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                        tempoMotion: [
                            { tag: "ritardando", startMeasure: 3, endMeasure: 4, intensity: 0.9 },
                        ],
                    },
                ],
            },
        }));
        const accelerandoResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, accelerandoOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                        tempoMotion: [
                            { tag: "accelerando", startMeasure: 3, endMeasure: 4, intensity: 0.9 },
                        ],
                    },
                ],
            },
        }));

        assert.equal(ritardandoResult.ok, true);
        assert.equal(accelerandoResult.ok, true);
        assert.equal(ritardandoResult.sectionTempoMotion?.[0]?.requestedTags?.[0], "ritardando");
        assert.equal(ritardandoResult.sectionTempoMotion?.[0]?.targetedMeasureCount, 2);
        assert.equal(ritardandoResult.sectionTempoMotion?.[0]?.realizedMeasureCount, 2);
        assert.equal(ritardandoResult.sectionTempoMotion?.[0]?.motionDirection, "broaden");
        assert.equal(accelerandoResult.sectionTempoMotion?.[0]?.motionDirection, "press_forward");
        assert.ok((ritardandoResult.sectionTempoMotion?.[0]?.realizedNoteCount ?? 0) > 0);

        const ritardandoStats = await analyzeRawHumanizedMidiByMeasure(ritardandoOutputPath);
        const accelerandoStats = await analyzeRawHumanizedMidiByMeasure(accelerandoOutputPath);

        assert.ok(
            ritardandoStats.parts[0].late.averageQuarterLength > ritardandoStats.parts[0].early.averageQuarterLength + 0.08,
            JSON.stringify({ ritardandoStats, accelerandoStats }),
        );
        assert.ok(
            ritardandoStats.parts[1].late.averageQuarterLength > ritardandoStats.parts[1].early.averageQuarterLength + 0.08,
            JSON.stringify({ ritardandoStats, accelerandoStats }),
        );
        assert.ok(
            accelerandoStats.parts[0].late.averageQuarterLength < accelerandoStats.parts[0].early.averageQuarterLength - 0.04,
            JSON.stringify({ ritardandoStats, accelerandoStats }),
        );
        assert.ok(
            accelerandoStats.parts[1].late.averageQuarterLength < accelerandoStats.parts[1].early.averageQuarterLength - 0.04,
            JSON.stringify({ ritardandoStats, accelerandoStats }),
        );
        assert.ok(
            ritardandoStats.parts[0].late.averageQuarterLength > accelerandoStats.parts[0].late.averageQuarterLength + 0.12,
            JSON.stringify({ ritardandoStats, accelerandoStats }),
        );
        assert.ok(
            ritardandoStats.parts[1].late.averageQuarterLength > accelerandoStats.parts[1].late.averageQuarterLength + 0.12,
            JSON.stringify({ ritardandoStats, accelerandoStats }),
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

test("humanizer realizes phrase-breath arrival and release shaping inside section windows", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-phrase-breath-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const controlOutputPath = path.join(tempRoot, "control.mid");
        const breathOutputPath = path.join(tempRoot, "breath.mid");
        await createTwoPartTestMidi(inputPath);

        const controlResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, controlOutputPath, {
            style: "mechanical",
            expressionPlan: {
                humanizationStyle: "mechanical",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                    },
                ],
            },
        }));
        const breathResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, breathOutputPath, {
            style: "mechanical",
            expressionPlan: {
                humanizationStyle: "mechanical",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                        phraseBreath: {
                            pickupStartMeasure: 1,
                            pickupEndMeasure: 2,
                            arrivalMeasure: 3,
                            releaseStartMeasure: 4,
                            releaseEndMeasure: 4,
                            rubatoAnchors: [3, 4],
                            notes: ["Broaden the arrival and let the cadence exhale."],
                        },
                    },
                ],
            },
        }));

        assert.equal(controlResult.ok, true);
        assert.equal(breathResult.ok, true);
        assert.equal(controlResult.expressionApplied, false);
        assert.equal(breathResult.expressionApplied, true);
        assert.equal(controlResult.sectionPhraseBreath?.length ?? 0, 0);
        assert.deepEqual(breathResult.sectionPhraseBreath?.[0]?.requestedCues, ["pickup", "arrival", "release", "rubato_anchor"]);
        assert.equal(breathResult.sectionPhraseBreath?.[0]?.targetedMeasureCount, 4);
        assert.equal(breathResult.sectionPhraseBreath?.[0]?.arrivalMeasureCount, 1);
        assert.equal(breathResult.sectionPhraseBreath?.[0]?.releaseMeasureCount, 1);
        assert.ok((breathResult.sectionPhraseBreath?.[0]?.arrivalAverageDurationScale ?? 1) > 1.05);
        assert.ok((breathResult.sectionPhraseBreath?.[0]?.releaseAverageEndingStretchScale ?? 1) > 1.08);

        const controlStats = await analyzeRawHumanizedMidiByMeasure(controlOutputPath);
        const breathStats = await analyzeRawHumanizedMidiByMeasure(breathOutputPath);

        assert.ok(
            breathStats.parts[0].late.averageQuarterLength > controlStats.parts[0].late.averageQuarterLength + 0.12,
            JSON.stringify({ controlStats, breathStats }),
        );
        assert.ok(
            breathStats.parts[1].late.averageQuarterLength > controlStats.parts[1].late.averageQuarterLength + 0.12,
            JSON.stringify({ controlStats, breathStats }),
        );
        assert.ok(
            breathStats.parts[0].late.averageQuarterLength > breathStats.parts[0].early.averageQuarterLength + 0.18,
            JSON.stringify({ controlStats, breathStats }),
        );
        assert.ok(
            breathStats.parts[1].late.averageQuarterLength > breathStats.parts[1].early.averageQuarterLength + 0.18,
            JSON.stringify({ controlStats, breathStats }),
        );
        assert.ok(
            breathStats.parts[0].early.averageQuarterLength < controlStats.parts[0].early.averageQuarterLength - 0.02,
            JSON.stringify({ controlStats, breathStats }),
        );
        assert.ok(
            breathStats.parts[1].early.averageQuarterLength < controlStats.parts[1].early.averageQuarterLength - 0.02,
            JSON.stringify({ controlStats, breathStats }),
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

test("humanizer realizes fermata as a local hold near the targeted cadence beat", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-fermata-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const controlOutputPath = path.join(tempRoot, "control.mid");
        const fermataOutputPath = path.join(tempRoot, "fermata.mid");
        await createTwoPartTestMidi(inputPath);

        const controlResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, controlOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                    },
                ],
            },
        }));
        const fermataResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, fermataOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                        ornaments: [
                            { tag: "fermata", startMeasure: 4, targetBeat: 4, intensity: 0.95, notes: ["Hold the close."] },
                        ],
                    },
                ],
            },
        }));

        assert.equal(controlResult.ok, true);
        assert.equal(fermataResult.ok, true);
        assert.equal(controlResult.sectionOrnaments?.length ?? 0, 0);
        assert.equal(fermataResult.sectionOrnaments?.[0]?.requestedTags?.[0], "fermata");
        assert.equal(fermataResult.sectionOrnaments?.[0]?.explicitlyRealizedTags?.[0], "fermata");
        assert.equal(fermataResult.sectionOrnaments?.[0]?.targetedEventCount, 1);
        assert.equal(fermataResult.sectionOrnaments?.[0]?.realizedEventCount, 1);
        assert.ok((fermataResult.sectionOrnaments?.[0]?.realizedNoteCount ?? 0) > 0);
        assert.ok((fermataResult.sectionOrnaments?.[0]?.averageDurationScale ?? 1) > 1.04);
        assert.ok((fermataResult.sectionOrnaments?.[0]?.averageEndingStretchScale ?? 1) > 1.04);

        const controlStats = await analyzeRawHumanizedMidiByMeasure(controlOutputPath);
        const fermataStats = await analyzeRawHumanizedMidiByMeasure(fermataOutputPath);

        assert.ok(
            fermataStats.parts[0].late.averageQuarterLength > controlStats.parts[0].late.averageQuarterLength + 0.03,
            JSON.stringify({ controlStats, fermataStats }),
        );
        assert.ok(
            fermataStats.parts[1].late.averageQuarterLength > controlStats.parts[1].late.averageQuarterLength + 0.03,
            JSON.stringify({ controlStats, fermataStats }),
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

test("humanizer realizes target-beat arpeggio sweeps on chordal accompaniment and reports spread evidence", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-arpeggio-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const controlOutputPath = path.join(tempRoot, "control.mid");
        const arpeggioOutputPath = path.join(tempRoot, "arpeggio.mid");
        await createChordalAccompanimentTestMidi(inputPath);

        const sharedPlan = {
            humanizationStyle: "restrained",
            textureDefaults: {
                voiceCount: 3,
                primaryRoles: ["lead", "chordal_support", "bass"],
                counterpointMode: "none",
            },
            sections: [
                {
                    sectionId: "s1",
                    startMeasure: 1,
                    endMeasure: 4,
                    phraseFunction: "presentation",
                    texture: {
                        voiceCount: 3,
                        primaryRoles: ["lead", "chordal_support", "bass"],
                        counterpointMode: "none",
                    },
                },
            ],
        };

        const controlResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, controlOutputPath, {
            style: "restrained",
            expressionPlan: sharedPlan,
        }));
        const arpeggioResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, arpeggioOutputPath, {
            style: "restrained",
            expressionPlan: {
                ...sharedPlan,
                sections: [
                    {
                        ...sharedPlan.sections[0],
                        ornaments: [
                            {
                                tag: "arpeggio",
                                startMeasure: 1,
                                endMeasure: 4,
                                targetBeat: 1,
                                intensity: 0.95,
                                notes: ["Roll the opening chordal arrival."],
                            },
                        ],
                    },
                ],
            },
        }));

        assert.equal(controlResult.ok, true);
        assert.equal(arpeggioResult.ok, true);
        assert.equal(controlResult.sectionOrnaments?.length ?? 0, 0);
        assert.equal(arpeggioResult.sectionOrnaments?.[0]?.requestedTags?.[0], "arpeggio");
        assert.equal(arpeggioResult.sectionOrnaments?.[0]?.explicitlyRealizedTags?.[0], "arpeggio");
        assert.equal(arpeggioResult.sectionOrnaments?.[0]?.targetedEventCount, 4);
        assert.equal(arpeggioResult.sectionOrnaments?.[0]?.realizedEventCount, 4);
        assert.ok((arpeggioResult.sectionOrnaments?.[0]?.realizedNoteCount ?? 0) >= 12);
        assert.ok(
            (arpeggioResult.sectionOrnaments?.[0]?.averageOnsetSpreadBeats ?? 0) > 0.08,
            JSON.stringify(arpeggioResult.sectionOrnaments?.[0] ?? null),
        );
        assert.ok((arpeggioResult.sectionOrnaments?.[0]?.peakOnsetSpreadBeats ?? 0) >= (arpeggioResult.sectionOrnaments?.[0]?.averageOnsetSpreadBeats ?? 0));

        const controlSpread = await analyzeChordalArpeggioSpreadByBeat(controlOutputPath, 1);
        const arpeggioSpread = await analyzeChordalArpeggioSpreadByBeat(arpeggioOutputPath, 1);

        assert.ok(arpeggioSpread.groupedEventCount > 0, JSON.stringify({ controlSpread, arpeggioSpread }));
        assert.ok(
            arpeggioSpread.averageOnsetSpreadBeats > controlSpread.averageOnsetSpreadBeats + 0.05,
            JSON.stringify({ controlSpread, arpeggioSpread, arpeggioResult }),
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

test("humanizer realizes target-beat grace notes on note-bearing lines and reports lead-in evidence", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-grace-note-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const controlOutputPath = path.join(tempRoot, "control.mid");
        const graceOutputPath = path.join(tempRoot, "grace.mid");
        await createTwoPartTestMidi(inputPath);

        const controlResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, controlOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                    },
                ],
            },
        }));
        const graceResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, graceOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                        ornaments: [
                            {
                                tag: "grace_note",
                                startMeasure: 1,
                                endMeasure: 4,
                                targetBeat: 1,
                                intensity: 0.95,
                                notes: ["Lead gently into each downbeat."],
                            },
                        ],
                    },
                ],
            },
        }));

        assert.equal(controlResult.ok, true);
        assert.equal(graceResult.ok, true);
        assert.equal(controlResult.sectionOrnaments?.length ?? 0, 0);
        assert.equal(graceResult.sectionOrnaments?.[0]?.requestedTags?.[0], "grace_note");
        assert.equal(graceResult.sectionOrnaments?.[0]?.explicitlyRealizedTags?.[0], "grace_note");
        assert.equal(graceResult.sectionOrnaments?.[0]?.targetedEventCount, 4);
        assert.equal(graceResult.sectionOrnaments?.[0]?.realizedEventCount, 4);
        assert.ok((graceResult.sectionOrnaments?.[0]?.realizedNoteCount ?? 0) >= 12);
        assert.ok((graceResult.sectionOrnaments?.[0]?.averageGraceLeadInBeats ?? 0) > 0.06);
        assert.ok((graceResult.sectionOrnaments?.[0]?.peakGraceLeadInBeats ?? 0) >= (graceResult.sectionOrnaments?.[0]?.averageGraceLeadInBeats ?? 0));

        const controlLeadIn = await analyzeGraceLeadInByBeat(controlOutputPath, 1, 0);
        const graceLeadIn = await analyzeGraceLeadInByBeat(graceOutputPath, 1, 0);

        assert.ok(graceLeadIn.groupedEventCount > 0, JSON.stringify({ controlLeadIn, graceLeadIn }));
        assert.ok(
            graceLeadIn.averageGraceLeadInBeats > controlLeadIn.averageGraceLeadInBeats + 0.04,
            JSON.stringify({ controlLeadIn, graceLeadIn, graceResult }),
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

test("humanizer realizes target-beat trill oscillations on note-bearing lines and reports oscillation evidence", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-trill-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const controlOutputPath = path.join(tempRoot, "control.mid");
        const trillOutputPath = path.join(tempRoot, "trill.mid");
        await createTwoPartTestMidi(inputPath);

        const controlResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, controlOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                    },
                ],
            },
        }));
        const trillResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, trillOutputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                        ornaments: [
                            {
                                tag: "trill",
                                startMeasure: 1,
                                endMeasure: 4,
                                targetBeat: 1,
                                intensity: 0.95,
                                notes: ["Sustain a tight upper-neighbor shimmer on each downbeat."],
                            },
                        ],
                    },
                ],
            },
        }));

        assert.equal(controlResult.ok, true);
        assert.equal(trillResult.ok, true);
        assert.equal(controlResult.sectionOrnaments?.length ?? 0, 0);
        assert.equal(trillResult.sectionOrnaments?.[0]?.requestedTags?.[0], "trill");
        assert.equal(trillResult.sectionOrnaments?.[0]?.explicitlyRealizedTags?.[0], "trill");
        assert.equal(trillResult.sectionOrnaments?.[0]?.targetedEventCount, 4);
        assert.equal(trillResult.sectionOrnaments?.[0]?.realizedEventCount, 4);
        assert.ok((trillResult.sectionOrnaments?.[0]?.realizedNoteCount ?? 0) >= 16);
        assert.ok((trillResult.sectionOrnaments?.[0]?.averageTrillOscillationCount ?? 0) >= 4.0);
        assert.ok((trillResult.sectionOrnaments?.[0]?.averageTrillSpanBeats ?? 0) > 0.35);
        assert.ok(
            (trillResult.sectionOrnaments?.[0]?.peakTrillSpanBeats ?? 0) >= (trillResult.sectionOrnaments?.[0]?.averageTrillSpanBeats ?? 0),
            JSON.stringify(trillResult.sectionOrnaments?.[0] ?? null),
        );

        const controlTrill = await analyzeTrillOscillationByBeat(controlOutputPath, 1, 0);
        const realizedTrill = await analyzeTrillOscillationByBeat(trillOutputPath, 1, 0);

        assert.ok(realizedTrill.groupedEventCount > 0, JSON.stringify({ controlTrill, realizedTrill }));
        assert.ok(
            realizedTrill.averageTrillOscillationCount > controlTrill.averageTrillOscillationCount + 3,
            JSON.stringify({ controlTrill, realizedTrill, trillResult }),
        );
        assert.ok(
            realizedTrill.averageTrillSpanBeats > controlTrill.averageTrillSpanBeats + 0.35,
            JSON.stringify({ controlTrill, realizedTrill, trillResult }),
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

test("buildExpressionPlanSidecar annotates section measure ranges for downstream humanization", () => {
    const sidecar = buildExpressionPlanSidecar({
        version: "planner-schema-v2",
        brief: "A short binary miniature.",
        mood: ["gentle"],
        form: "miniature",
        workflow: "symbolic_only",
        instrumentation: [
            { name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" },
        ],
        tempoMotionDefaults: [
            { tag: "ritardando", startMeasure: 10, endMeasure: 12, intensity: 0.55 },
        ],
        ornamentDefaults: [
            { tag: "fermata", startMeasure: 12, targetBeat: 4, intensity: 0.8 },
        ],
        motifPolicy: {
            reuseRequired: true,
        },
        sections: [
            {
                id: "s1",
                role: "intro",
                label: "Prelude",
                measures: 4,
                energy: 0.2,
                density: 0.18,
            },
            {
                id: "s2",
                role: "theme_a",
                label: "Statement",
                measures: 5,
                energy: 0.34,
                density: 0.28,
                phraseFunction: "presentation",
                texture: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "free",
                },
            },
            {
                id: "s3",
                role: "cadence",
                label: "Close",
                measures: 3,
                energy: 0.24,
                density: 0.16,
                expression: {
                    articulation: ["legato"],
                    character: ["dolce"],
                },
                tempoMotion: [
                    { tag: "ritenuto", intensity: 0.7, notes: ["Broaden the close."] },
                ],
                ornaments: [
                    { tag: "fermata", targetBeat: 4, intensity: 0.75 },
                ],
            },
        ],
        rationale: "Keep the ending soft.",
    });

    assert.ok(sidecar);
    assert.deepEqual(
        sidecar.sections.map((section) => ({
            sectionId: section.sectionId,
            startMeasure: section.startMeasure,
            endMeasure: section.endMeasure,
        })),
        [
            { sectionId: "s1", startMeasure: 1, endMeasure: 4 },
            { sectionId: "s2", startMeasure: 5, endMeasure: 9 },
            { sectionId: "s3", startMeasure: 10, endMeasure: 12 },
        ],
    );
    assert.equal(sidecar.tempoMotionDefaults?.[0]?.tag, "ritardando");
    assert.equal(sidecar.ornamentDefaults?.[0]?.tag, "fermata");
    assert.equal(sidecar.sections[2]?.tempoMotion?.[0]?.tag, "ritenuto");
    assert.equal(sidecar.sections[2]?.ornaments?.[0]?.tag, "fermata");
});

test("buildAudioEvaluation scores weak tempo-motion evidence from section artifacts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-tempo-motion-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "development", label: "Development", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "development",
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
                        averageTimingJitterScale: 0.98,
                        averageEndingStretchScale: 1.04,
                        peakDurationScaleDelta: 0.01,
                        motionDirection: "broaden",
                    },
                },
            ],
        });

        assert.equal(evaluation.passed, false);
        assert.ok((evaluation.metrics?.audioTempoMotionPlanFit ?? 1) < 0.6);
        assert.ok(evaluation.issues.includes("Tempo-motion cues do not survive strongly enough after humanized realization."));
        assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section tempo motion does not survive humanized realization strongly enough."));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation scores weak phrase-breath evidence from section artifacts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-phrase-breath-weak-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "cadence", label: "Close", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "cadence",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    phraseBreathSummary: {
                        requestedCues: ["pickup", "arrival", "release"],
                        targetedMeasureCount: 4,
                        realizedMeasureCount: 2,
                        realizedNoteCount: 3,
                        pickupMeasureCount: 2,
                        pickupAverageDurationScale: 0.99,
                        pickupAverageTimingJitterScale: 1.01,
                        arrivalMeasureCount: 1,
                        arrivalAverageDurationScale: 1.02,
                        arrivalAverageEndingStretchScale: 1.03,
                        releaseMeasureCount: 1,
                        releaseAverageDurationScale: 1.01,
                        releaseAverageEndingStretchScale: 1.02,
                    },
                },
            ],
        });

        assert.equal(evaluation.passed, false);
        assert.ok((evaluation.metrics?.audioPhraseBreathPlanFit ?? 1) < 0.58);
        assert.ok(evaluation.issues.includes("Phrase-breath cues do not survive strongly enough after humanized realization."));
        assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section phrase-breath cues do not survive humanized realization strongly enough."));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation scores strong phrase-breath evidence from section artifacts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-phrase-breath-strong-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "cadence", label: "Close", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "cadence",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    phraseBreathSummary: {
                        requestedCues: ["pickup", "arrival", "release", "rubato_anchor"],
                        targetedMeasureCount: 4,
                        realizedMeasureCount: 4,
                        realizedNoteCount: 8,
                        averageDurationScale: 1.05,
                        averageTimingJitterScale: 0.9,
                        averageEndingStretchScale: 1.14,
                        peakDurationScaleDelta: 0.12,
                        pickupMeasureCount: 2,
                        pickupAverageDurationScale: 0.94,
                        pickupAverageTimingJitterScale: 1.08,
                        arrivalMeasureCount: 1,
                        arrivalAverageDurationScale: 1.18,
                        arrivalAverageTimingJitterScale: 0.8,
                        arrivalAverageEndingStretchScale: 1.26,
                        releaseMeasureCount: 1,
                        releaseAverageDurationScale: 1.12,
                        releaseAverageTimingJitterScale: 0.86,
                        releaseAverageEndingStretchScale: 1.22,
                        rubatoAnchorCount: 2,
                        rubatoAnchorAverageDurationScale: 1.09,
                        rubatoAnchorAverageTimingJitterScale: 0.82,
                        rubatoAnchorAverageEndingStretchScale: 1.16,
                    },
                },
            ],
        });

        assert.equal(evaluation.passed, true);
        assert.ok((evaluation.metrics?.audioPhraseBreathPlanFit ?? 0) >= 0.82);
        assert.ok((evaluation.metrics?.audioPhraseBreathArrivalFit ?? 0) >= 0.82);
        assert.ok((evaluation.metrics?.audioPhraseBreathReleaseFit ?? 0) >= 0.82);
        assert.ok(evaluation.strengths.includes("Phrase-breath cues survive humanized realization with clear local timing contrast."));
        assert.ok(evaluation.sectionFindings?.[0]?.strengths.includes("Section phrase-breath cues survive humanized realization with clear local timing contrast."));
        assert.ok(!evaluation.issues.includes("Phrase-breath cues do not survive strongly enough after humanized realization."));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation scores weak harmonic-realization evidence from section artifacts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-harmonic-realization-weak-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "cadence", label: "Close", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "cadence",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    harmonicRealizationSummary: {
                        prolongationMode: "pedal",
                        requestedTonicizationTargets: ["G major"],
                        requestedColorTags: ["suspension"],
                        targetedMeasureCount: 4,
                        realizedMeasureCount: 2,
                        realizedNoteCount: 3,
                        prolongationMeasureCount: 4,
                        prolongationAverageDurationScale: 1.01,
                        prolongationAverageTimingJitterScale: 1.01,
                        prolongationAverageEndingStretchScale: 1.02,
                        tonicizationMeasureCount: 2,
                        tonicizationAverageDurationScale: 1.03,
                        tonicizationAverageTimingJitterScale: 0.99,
                        tonicizationAverageEndingStretchScale: 1.03,
                        harmonicColorMeasureCount: 1,
                        harmonicColorAverageDurationScale: 1.02,
                        harmonicColorAverageTimingJitterScale: 0.98,
                        harmonicColorAverageEndingStretchScale: 1.03,
                    },
                },
            ],
        });

        assert.equal(evaluation.passed, false);
        assert.ok((evaluation.metrics?.audioHarmonicRealizationPlanFit ?? 1) < 0.58);
        assert.ok(evaluation.issues.includes("Harmonic realization cues do not survive strongly enough after humanized realization."));
        assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section harmonic realization does not survive humanized realization strongly enough."));
        assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section tonicization window does not create enough local departure and arrival contrast after humanization."));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation scores strong harmonic-realization evidence from section artifacts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-harmonic-realization-strong-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "development", label: "Development", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "development",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    harmonicRealizationSummary: {
                        prolongationMode: "dominant",
                        requestedTonicizationTargets: ["D minor"],
                        requestedColorTags: ["applied_dominant", "suspension"],
                        targetedMeasureCount: 4,
                        realizedMeasureCount: 4,
                        realizedNoteCount: 12,
                        prolongationMeasureCount: 4,
                        prolongationAverageDurationScale: 1.06,
                        prolongationAverageTimingJitterScale: 0.94,
                        prolongationAverageEndingStretchScale: 1.1,
                        tonicizationMeasureCount: 2,
                        tonicizationAverageDurationScale: 1.1,
                        tonicizationAverageTimingJitterScale: 0.86,
                        tonicizationAverageEndingStretchScale: 1.15,
                        harmonicColorMeasureCount: 2,
                        harmonicColorAverageDurationScale: 1.09,
                        harmonicColorAverageTimingJitterScale: 0.88,
                        harmonicColorAverageEndingStretchScale: 1.14,
                    },
                },
            ],
        });

        assert.equal(evaluation.passed, true);
        assert.ok((evaluation.metrics?.audioHarmonicRealizationPlanFit ?? 0) >= 0.82);
        assert.ok((evaluation.metrics?.audioTonicizationRealizationFit ?? 0) >= 0.82);
        assert.ok((evaluation.metrics?.audioHarmonicColorRealizationFit ?? 0) >= 0.82);
        assert.ok(evaluation.strengths.includes("Harmonic realization cues survive humanized realization with clear local sustain and arrival contrast."));
        assert.ok(evaluation.sectionFindings?.[0]?.strengths.includes("Section harmonic realization survives humanized realization with clear local sustain and arrival contrast."));
        assert.ok(!evaluation.issues.includes("Harmonic realization cues do not survive strongly enough after humanized realization."));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation scores weak ornament hold evidence from section artifacts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-ornament-hold-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "cadence", label: "Close", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "cadence",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    ornamentSummary: {
                        sectionId: "s1",
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
        });

        assert.equal(evaluation.passed, false);
        assert.ok((evaluation.metrics?.audioOrnamentPlanFit ?? 1) < 0.58);
        assert.ok(evaluation.issues.includes("Ornament hold cues do not survive strongly enough after humanized realization."));
        assert.ok(evaluation.sectionFindings?.[0]?.issues.includes("Section ornament hold does not survive humanized realization strongly enough."));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation reports metadata-only unsupported ornament tags without failing them", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-ornament-metadata-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "theme_a",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    ornamentSummary: {
                        sectionId: "s1",
                        requestedTags: ["mordent", "turn"],
                        explicitlyRealizedTags: [],
                        unsupportedTags: ["mordent", "turn"],
                        targetedEventCount: 0,
                        realizedEventCount: 0,
                        realizedNoteCount: 0,
                    },
                },
            ],
        });

        assert.equal(evaluation.passed, true);
        assert.equal(evaluation.metrics?.audioUnsupportedOrnamentSectionCount, 1);
        assert.equal(evaluation.metrics?.audioUnsupportedOrnamentTagCount, 2);
        assert.ok(evaluation.strengths.includes("Unsupported ornament tags remain preserved as structured metadata for later realization: mordent, turn."));
        assert.ok(!evaluation.issues.includes("Ornament hold cues do not survive strongly enough after humanized realization."));
        assert.equal(evaluation.sectionFindings?.length ?? 0, 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation scores realized arpeggio spread evidence from section artifacts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-ornament-arpeggio-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "theme_a",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    ornamentSummary: {
                        sectionId: "s1",
                        requestedTags: ["arpeggio"],
                        explicitlyRealizedTags: ["arpeggio"],
                        targetedEventCount: 2,
                        realizedEventCount: 2,
                        realizedNoteCount: 6,
                        averageOnsetSpreadBeats: 0.18,
                        peakOnsetSpreadBeats: 0.22,
                    },
                },
            ],
        });

        assert.equal(evaluation.passed, true);
        assert.ok((evaluation.metrics?.audioOrnamentArpeggioFit ?? 0) >= 0.82);
        assert.ok((evaluation.metrics?.audioOrnamentPlanFit ?? 0) >= 0.82);
        assert.ok(evaluation.strengths.includes("Arpeggio cues survive humanized realization with a clear rolled-onset contour."));
        assert.ok(evaluation.sectionFindings?.[0]?.strengths.includes("Section arpeggio sweep remains clearly audible after humanized realization."));
        assert.ok(!evaluation.issues.includes("Arpeggio cues do not survive strongly enough after humanized realization."));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation scores realized grace-note lead-in evidence from section artifacts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-ornament-grace-note-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "theme_a",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    ornamentSummary: {
                        sectionId: "s1",
                        requestedTags: ["grace_note"],
                        explicitlyRealizedTags: ["grace_note"],
                        targetedEventCount: 2,
                        realizedEventCount: 2,
                        realizedNoteCount: 4,
                        averageGraceLeadInBeats: 0.11,
                        peakGraceLeadInBeats: 0.125,
                    },
                },
            ],
        });

        assert.equal(evaluation.passed, true);
        assert.ok((evaluation.metrics?.audioOrnamentGraceFit ?? 0) >= 0.82);
        assert.ok((evaluation.metrics?.audioOrnamentPlanFit ?? 0) >= 0.82);
        assert.ok(evaluation.strengths.includes("Grace-note cues survive humanized realization with a clear lead-in contour."));
        assert.ok(evaluation.sectionFindings?.[0]?.strengths.includes("Section grace-note lead-in remains clearly audible after humanized realization."));
        assert.ok(!evaluation.issues.includes("Grace-note cues do not survive strongly enough after humanized realization."));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation scores realized trill oscillation evidence from section artifacts", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-ornament-trill-"));

    try {
        const audioPath = path.join(tempRoot, "output.wav");
        fs.writeFileSync(audioPath, createSilentWavBuffer(4));

        const evaluation = buildAudioEvaluation({
            audio: audioPath,
        }, "symbolic_only", {
            sections: [
                { id: "s1", role: "theme_a", label: "Opening", measures: 4 },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "theme_a",
                    measureCount: 4,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    ornamentSummary: {
                        sectionId: "s1",
                        requestedTags: ["trill"],
                        explicitlyRealizedTags: ["trill"],
                        targetedEventCount: 2,
                        realizedEventCount: 2,
                        realizedNoteCount: 10,
                        averageTrillOscillationCount: 5,
                        peakTrillOscillationCount: 6,
                        averageTrillSpanBeats: 0.78,
                        peakTrillSpanBeats: 0.84,
                    },
                },
            ],
        });

        assert.equal(evaluation.passed, true);
        assert.ok((evaluation.metrics?.audioOrnamentTrillFit ?? 0) >= 0.82);
        assert.ok((evaluation.metrics?.audioOrnamentPlanFit ?? 0) >= 0.82);
        assert.ok(evaluation.strengths.includes("Trill cues survive humanized realization with a clear oscillating contour."));
        assert.ok(evaluation.sectionFindings?.[0]?.strengths.includes("Section trill oscillation remains clearly audible after humanized realization."));
        assert.ok(!evaluation.issues.includes("Trill cues do not survive strongly enough after humanized realization."));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("humanizer differentiates lead and secondary-voice shaping across section texture windows", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-worker-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const outputPath = path.join(tempRoot, "output.mid");
        await createTwoPartTestMidi(inputPath);

        const result = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, outputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                textureDefaults: {
                    voiceCount: 2,
                    primaryRoles: ["lead", "chordal_support", "bass"],
                    counterpointMode: "none",
                },
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 2,
                        phraseFunction: "presentation",
                        texture: {
                            voiceCount: 2,
                            primaryRoles: ["lead", "chordal_support", "bass"],
                            counterpointMode: "none",
                        },
                    },
                    {
                        sectionId: "s2",
                        startMeasure: 3,
                        endMeasure: 4,
                        phraseFunction: "continuation",
                        texture: {
                            voiceCount: 3,
                            primaryRoles: ["lead", "counterline", "bass"],
                            counterpointMode: "contrary_motion",
                        },
                    },
                ],
            },
        }));

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));
        assert.ok((result.notesModified ?? 0) > 0);

        const stats = await analyzeHumanizedMidi(outputPath);
        assert.equal(stats.parts.length, 2);
        assert.ok(
            stats.parts[0].averageVelocity > stats.parts[1].averageVelocity + 2,
            JSON.stringify(stats),
        );
        assert.ok(
            Math.abs(stats.parts[0].averageQuarterLength - stats.parts[1].averageQuarterLength) > 0.1,
            JSON.stringify(stats),
        );
        assert.ok(
            stats.ranges.accompanimentLate.averageVelocity > stats.ranges.accompanimentEarly.averageVelocity + 1.5,
            JSON.stringify(stats),
        );
        assert.ok(
            stats.ranges.accompanimentLate.averageQuarterLength > stats.ranges.accompanimentEarly.averageQuarterLength + 0.02,
            JSON.stringify(stats),
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

test("humanizer splits bass and upper-strand shaping inside a single accompaniment part", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-layered-worker-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const outputPath = path.join(tempRoot, "output.mid");
        await createLayeredAccompanimentTestMidi(inputPath);

        const result = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, outputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                textureDefaults: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "chordal_support", "bass"],
                    counterpointMode: "none",
                },
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 2,
                        phraseFunction: "presentation",
                        texture: {
                            voiceCount: 3,
                            primaryRoles: ["lead", "chordal_support", "bass"],
                            counterpointMode: "none",
                        },
                    },
                    {
                        sectionId: "s2",
                        startMeasure: 3,
                        endMeasure: 4,
                        phraseFunction: "continuation",
                        texture: {
                            voiceCount: 3,
                            primaryRoles: ["lead", "counterline", "bass"],
                            counterpointMode: "contrary_motion",
                        },
                    },
                ],
            },
        }));

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));
        assert.ok((result.notesModified ?? 0) > 0);

        const stats = await analyzeLayeredHumanizedMidi(outputPath);
        assert.ok(stats.ranges.lowEarly.noteCount > 0, JSON.stringify(stats));
        assert.ok(stats.ranges.highEarly.noteCount > 0, JSON.stringify(stats));
        assert.ok(stats.ranges.lowLate.noteCount > 0, JSON.stringify(stats));
        assert.ok(stats.ranges.highLate.noteCount > 0, JSON.stringify(stats));
        assert.ok(
            stats.ranges.lowEarly.averageVelocity > stats.ranges.highEarly.averageVelocity + 6,
            JSON.stringify(stats),
        );
        assert.ok(
            stats.ranges.highLate.averageVelocity > stats.ranges.highEarly.averageVelocity + 4,
            JSON.stringify(stats),
        );
        assert.ok(
            Math.abs(stats.ranges.lowLate.averageVelocity - stats.ranges.lowEarly.averageVelocity) < 4,
            JSON.stringify(stats),
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

test("humanizer differentiates simultaneous chord-internal subvoices inside shared accompaniment chords", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-chordal-worker-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const outputPath = path.join(tempRoot, "output.mid");
        await createChordalAccompanimentTestMidi(inputPath);

        const result = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, outputPath, {
            style: "restrained",
            expressionPlan: {
                humanizationStyle: "restrained",
                textureDefaults: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "chordal_support", "bass"],
                    counterpointMode: "none",
                },
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 2,
                        phraseFunction: "presentation",
                        texture: {
                            voiceCount: 3,
                            primaryRoles: ["lead", "chordal_support", "bass"],
                            counterpointMode: "none",
                        },
                    },
                    {
                        sectionId: "s2",
                        startMeasure: 3,
                        endMeasure: 4,
                        phraseFunction: "continuation",
                        texture: {
                            voiceCount: 3,
                            primaryRoles: ["lead", "counterline", "bass"],
                            counterpointMode: "contrary_motion",
                        },
                    },
                ],
            },
        }));

        assert.equal(result.ok, true);
        assert.ok(fs.existsSync(outputPath));
        assert.ok((result.notesModified ?? 0) > 0);

        const stats = await analyzeChordalSubvoiceHumanizedMidi(outputPath);
        assert.ok(stats.ranges.lowEarly.noteCount > 0, JSON.stringify(stats));
        assert.ok(stats.ranges.middleEarly.noteCount > 0, JSON.stringify(stats));
        assert.ok(stats.ranges.highEarly.noteCount > 0, JSON.stringify(stats));
        assert.ok(stats.ranges.lowLate.noteCount > 0, JSON.stringify(stats));
        assert.ok(stats.ranges.middleLate.noteCount > 0, JSON.stringify(stats));
        assert.ok(stats.ranges.highLate.noteCount > 0, JSON.stringify(stats));
        assert.ok(
            stats.ranges.lowEarly.averageVelocity > stats.ranges.middleEarly.averageVelocity + 6,
            JSON.stringify(stats),
        );
        assert.ok(
            stats.ranges.lowEarly.averageQuarterLength > stats.ranges.middleEarly.averageQuarterLength + 0.08,
            JSON.stringify(stats),
        );
        assert.ok(
            stats.ranges.highLate.averageVelocity > stats.ranges.highEarly.averageVelocity + 4,
            JSON.stringify(stats),
        );
        assert.ok(
            stats.ranges.highLate.averageVelocity > stats.ranges.middleLate.averageVelocity + 3,
            JSON.stringify(stats),
        );
        assert.ok(
            stats.ranges.highLate.averageQuarterLength > stats.ranges.middleLate.averageQuarterLength + 0.04,
            JSON.stringify(stats),
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

test("buildStyledAudioPrompt includes expression defaults and section cues", () => {
    const prompt = buildStyledAudioPrompt({
        prompt: "Write a fragile piano miniature.",
        compositionPlan: {
            brief: "A restrained reply that blooms near the cadence.",
            mood: ["intimate"],
            instrumentation: [
                { name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" },
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
                    energy: 0.28,
                    density: 0.24,
                    phraseFunction: "presentation",
                    texture: {
                        voiceCount: 2,
                        primaryRoles: ["lead", "chordal_support", "bass"],
                        counterpointMode: "none",
                    },
                    expression: {
                        articulation: ["legato"],
                        character: ["cantabile"],
                        phrasePeaks: [3, 7],
                    },
                    ornaments: [
                        { tag: "fermata", startMeasure: 8, targetBeat: 4, intensity: 0.75 },
                    ],
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Close",
                    measures: 4,
                    energy: 0.36,
                    density: 0.22,
                },
            ],
            expressionDefaults: {
                dynamics: {
                    start: "pp",
                    peak: "mp",
                    end: "p",
                },
                articulation: ["legato"],
                character: ["dolce"],
                sustainBias: 0.2,
            },
            ornamentDefaults: [
                { tag: "fermata", startMeasure: 12, targetBeat: 4, intensity: 0.8 },
            ],
        },
    });

    assert.match(prompt, /texture defaults:/);
    assert.match(prompt, /tex 3v/);
    assert.match(prompt, /expression defaults:/);
    assert.match(prompt, /dyn pp->mp->p/);
    assert.match(prompt, /ornament defaults:/);
    assert.match(prompt, /orn fermata m12 b4 @0.80/);
    assert.match(prompt, /phrase presentation/);
    assert.match(prompt, /roles lead\/chordal_support\/bass/);
    assert.match(prompt, /cantabile/);
    assert.match(prompt, /peaks 3,7/);
    assert.match(prompt, /orn fermata m8 b4 @0.75/);
});

test("resolveRequestedAudioDurationSec derives symbolic duration from sections and tempo when explicit duration is absent", () => {
    const estimatedDuration = resolveRequestedAudioDurationSec({
        prompt: "Write a fragile piano miniature.",
        tempo: 90,
        compositionPlan: {
            brief: "A restrained reply that blooms near the cadence.",
            mood: ["intimate"],
            form: "miniature",
            workflow: "symbolic_plus_audio",
            instrumentation: [
                { name: "piano", family: "keyboard", roles: ["lead", "bass"], register: "wide" },
            ],
            motifPolicy: {},
            meter: "3/4",
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 8,
                    energy: 0.28,
                    density: 0.24,
                },
                {
                    id: "s2",
                    role: "cadence",
                    label: "Close",
                    measures: 4,
                    energy: 0.36,
                    density: 0.22,
                },
            ],
            rationale: "Keep the proportions compact and balanced.",
            version: "test-plan",
        },
    });

    assert.equal(estimatedDuration, 24);
    assert.equal(resolveRequestedAudioDurationSec({ prompt: "", durationSec: 18 }), 18);
});

test("buildRenderExpressionSummaryLines combines defaults, section cues, and realized velocity ranges", () => {
    const lines = buildRenderExpressionSummaryLines({
        expressionPlan: {
            humanizationStyle: "expressive",
            textureDefaults: {
                voiceCount: 3,
                primaryRoles: ["lead", "inner_voice", "bass"],
                counterpointMode: "contrary_motion",
            },
            expressionDefaults: {
                dynamics: {
                    start: "pp",
                    peak: "mf",
                    end: "p",
                },
                articulation: ["legato"],
                character: ["dolce"],
            },
            tempoMotionDefaults: [
                { tag: "ritardando", startMeasure: 7, endMeasure: 8, intensity: 0.6 },
            ],
            ornamentDefaults: [
                { tag: "fermata", startMeasure: 8, targetBeat: 4, intensity: 0.85 },
            ],
            sections: [
                {
                    sectionId: "s1",
                    phraseFunction: "presentation",
                    phraseBreath: {
                        pickupStartMeasure: 1,
                        pickupEndMeasure: 2,
                        arrivalMeasure: 4,
                        releaseStartMeasure: 7,
                        releaseEndMeasure: 8,
                        cadenceRecoveryStartMeasure: 8,
                        cadenceRecoveryEndMeasure: 8,
                        rubatoAnchors: [3],
                    },
                    texture: {
                        voiceCount: 2,
                        primaryRoles: ["lead", "chordal_support", "bass"],
                        counterpointMode: "none",
                    },
                    expression: {
                        character: ["cantabile"],
                        phrasePeaks: [3],
                    },
                    tempoMotion: [
                        { tag: "a tempo", startMeasure: 8, endMeasure: 8 },
                    ],
                    ornaments: [
                        { tag: "fermata", startMeasure: 8, targetBeat: 4, intensity: 0.75 },
                    ],
                },
            ],
        },
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Opening",
                measures: 8,
                energy: 0.3,
                density: 0.24,
                harmonicPlan: {
                    prolongationMode: "dominant",
                    tonicizationWindows: [
                        { keyTarget: "G major", startMeasure: 5, endMeasure: 6, emphasis: "arriving" },
                    ],
                    colorCues: [
                        { tag: "suspension", startMeasure: 6, endMeasure: 7, resolutionMeasure: 7 },
                    ],
                },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 8,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                melodyVelocityMin: 42,
                melodyVelocityMax: 67,
                phraseBreathSummary: {
                    requestedCues: ["pickup", "arrival", "release"],
                    targetedMeasureCount: 5,
                    realizedMeasureCount: 5,
                    realizedNoteCount: 18,
                    pickupMeasureCount: 2,
                    pickupAverageDurationScale: 0.95,
                    pickupAverageTimingJitterScale: 1.06,
                    arrivalMeasureCount: 1,
                    arrivalAverageDurationScale: 1.16,
                    arrivalAverageEndingStretchScale: 1.24,
                    releaseMeasureCount: 2,
                    releaseAverageDurationScale: 1.11,
                    releaseAverageEndingStretchScale: 1.2,
                    cadenceRecoveryMeasureCount: 1,
                    cadenceRecoveryAverageDurationScale: 0.98,
                    cadenceRecoveryAverageTimingJitterScale: 0.94,
                    rubatoAnchorCount: 1,
                    rubatoAnchorAverageDurationScale: 1.06,
                    rubatoAnchorAverageTimingJitterScale: 0.84,
                },
                harmonicRealizationSummary: {
                    prolongationMode: "dominant",
                    requestedTonicizationTargets: ["G major"],
                    requestedColorTags: ["suspension"],
                    targetedMeasureCount: 4,
                    realizedMeasureCount: 4,
                    realizedNoteCount: 12,
                    prolongationMeasureCount: 4,
                    prolongationAverageDurationScale: 1.04,
                    prolongationAverageEndingStretchScale: 1.07,
                    tonicizationMeasureCount: 2,
                    tonicizationAverageDurationScale: 1.08,
                    tonicizationAverageEndingStretchScale: 1.12,
                    harmonicColorMeasureCount: 2,
                    harmonicColorAverageDurationScale: 1.09,
                    harmonicColorAverageEndingStretchScale: 1.13,
                },
            },
        ],
    });

    assert.equal(lines[0], "Humanize: expressive");
    assert.match(lines[1], /Defaults:/);
    assert.match(lines[1], /tex 3v/);
    assert.match(lines[1], /tempo ritardando m7-8 @0.60/);
    assert.match(lines[1], /orn fermata m8 b4 @0.85/);
    assert.match(lines[2], /Opening \(theme_a\):/);
    assert.match(lines[2], /phrase presentation/);
    assert.match(lines[2], /breath pickup m1-2, arrival m4, release m7-8, recover m8, rubato m3/);
    assert.match(lines[2], /breath fit 5\/5 pickup d0\.95\/j1\.06 arrival d1\.16\/e1\.24 release d1\.11\/e1\.20 recover d0\.98\/j0\.94 rubato d1\.06\/j0\.84/);
    assert.match(lines[2], /roles lead\/chordal_support\/bass/);
    assert.match(lines[2], /cantabile/);
    assert.match(lines[2], /tempo a tempo m8/);
    assert.match(lines[2], /orn fermata m8 b4 @0.75/);
    assert.match(lines[2], /prolong dominant/);
    assert.match(lines[2], /tonicize G major m5-6 arriving/);
    assert.match(lines[2], /color suspension m6-7 res m7/);
    assert.match(lines[2], /harm fit 4\/4 prolong d1\.04\/e1\.07 tonicize d1\.08\/e1\.12 color d1\.09\/e1\.13/);
    assert.match(lines[2], /vel mel 42-67/);
});

test("render worker embeds expression summary lines into the score preview", { skip: !pythonBin }, async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-render-expression-"));

    try {
        const midiPath = path.join(tempRoot, "preview.mid");
        fs.writeFileSync(midiPath, createMinimalMidiBuffer());

        const expressionSummaryLines = buildRenderExpressionSummaryLines({
            expressionPlan: {
                humanizationStyle: "expressive",
                textureDefaults: {
                    voiceCount: 3,
                    primaryRoles: ["lead", "inner_voice", "bass"],
                    counterpointMode: "contrary_motion",
                },
                expressionDefaults: {
                    dynamics: {
                        start: "pp",
                        peak: "mf",
                        end: "p",
                    },
                    articulation: ["legato"],
                    character: ["dolce"],
                },
                sections: [
                    {
                        sectionId: "s1",
                        phraseFunction: "presentation",
                        phraseBreath: {
                            pickupStartMeasure: 1,
                            pickupEndMeasure: 2,
                            arrivalMeasure: 4,
                            releaseStartMeasure: 7,
                            releaseEndMeasure: 8,
                        },
                        texture: {
                            voiceCount: 2,
                            primaryRoles: ["lead", "chordal_support", "bass"],
                            counterpointMode: "none",
                        },
                        expression: {
                            character: ["cantabile"],
                            phrasePeaks: [3],
                        },
                    },
                ],
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 8,
                    energy: 0.3,
                    density: 0.24,
                    harmonicPlan: {
                        prolongationMode: "dominant",
                        tonicizationWindows: [
                            { keyTarget: "G major", startMeasure: 5, endMeasure: 6, emphasis: "arriving" },
                        ],
                        colorCues: [
                            { tag: "suspension", startMeasure: 6, endMeasure: 7, resolutionMeasure: 7 },
                        ],
                    },
                },
            ],
            sectionArtifacts: [
                {
                    sectionId: "s1",
                    role: "theme_a",
                    measureCount: 8,
                    melodyEvents: [],
                    accompanimentEvents: [],
                    noteHistory: [],
                    melodyVelocityMin: 42,
                    melodyVelocityMax: 67,
                    phraseBreathSummary: {
                        requestedCues: ["pickup", "arrival", "release"],
                        targetedMeasureCount: 5,
                        realizedMeasureCount: 5,
                        realizedNoteCount: 18,
                        pickupMeasureCount: 2,
                        pickupAverageDurationScale: 0.95,
                        pickupAverageTimingJitterScale: 1.06,
                        arrivalMeasureCount: 1,
                        arrivalAverageDurationScale: 1.16,
                        arrivalAverageEndingStretchScale: 1.24,
                        releaseMeasureCount: 2,
                        releaseAverageDurationScale: 1.11,
                        releaseAverageEndingStretchScale: 1.2,
                    },
                },
            ],
        });

        const result = await runRenderWorker(buildRenderWorkerInput({
            midiPath,
            outputDir: tempRoot,
            expressionSummaryLines,
        }));

        assert.equal(result.ok, true);
        const svg = fs.readFileSync(result.scoreImage, "utf-8");
        assert.match(svg, /Expression Profile/);
        assert.match(svg, /Defaults:/);
        assert.match(svg, /Opening \(theme_a\):/);
        assert.match(svg, /phrase presentation/);
        assert.match(svg, /breath pickup m1-2, arrival m4, release m7-8/);
        assert.match(svg, /prolong dominant/);
        assert.match(svg, /color suspension m6-7 res m7/);
        assert.match(svg, /vel mel 42-67/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("buildAudioEvaluation requires both rendered and styled audio for symbolic_plus_audio", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-eval-"));
    const renderedAudio = path.join(tempRoot, "output.wav");
    const styledAudio = path.join(tempRoot, "styled-output.wav");

    fs.writeFileSync(renderedAudio, createSilentWavBuffer());
    fs.writeFileSync(styledAudio, createSilentWavBuffer());

    const report = buildAudioEvaluation({
        audio: renderedAudio,
        renderedAudio,
        styledAudio,
    }, "symbolic_plus_audio", {
        expectedDurationSec: 1,
    });

    assert.equal(report.passed, true);
    assert.equal(report.score, 100);
    assert.equal(report.issues.length, 0);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("buildAudioEvaluation scores development and recap narrative fit from rendered audio sections", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-narrative-"));
    const renderedAudio = path.join(tempRoot, "output.wav");
    const styledAudio = path.join(tempRoot, "styled-output.wav");

    fs.writeFileSync(renderedAudio, createTonalSectionedWavBuffer([
        { amplitude: 0.18, frequencies: [261.63, 329.63, 392] },
        {
            amplitude: 0.56,
            frequencies: [196, 246.94, 293.66],
            segments: [
                { amplitude: 0.42, frequencies: [261.63, 329.63, 392], portion: 1 },
                { amplitude: 0.5, frequencies: [293.66, 369.99, 440], portion: 1 },
                { amplitude: 0.58, frequencies: [196, 246.94, 293.66], portion: 1 },
            ],
        },
        { amplitude: 0.22, frequencies: [261.63, 329.63, 392] },
    ]));
    fs.writeFileSync(styledAudio, createTonalSectionedWavBuffer([
        { amplitude: 0.2, frequencies: [261.63, 329.63, 392] },
        {
            amplitude: 0.5,
            frequencies: [196, 246.94, 293.66],
            segments: [
                { amplitude: 0.4, frequencies: [261.63, 329.63, 392], portion: 1 },
                { amplitude: 0.48, frequencies: [293.66, 369.99, 440], portion: 1 },
                { amplitude: 0.54, frequencies: [196, 246.94, 293.66], portion: 1 },
            ],
        },
        { amplitude: 0.24, frequencies: [261.63, 329.63, 392] },
    ]));

    const report = buildAudioEvaluation({
        audio: renderedAudio,
        renderedAudio,
        styledAudio,
    }, "symbolic_plus_audio", {
        expectedDurationSec: 3,
        structureEvaluation: {
            passed: true,
            score: 88,
            issues: [],
            strengths: ["Development and recap pass symbolic narrative checks."],
            metrics: {
                developmentNarrativeFit: 0.74,
                recapRecallFit: 0.8,
                harmonicModulationStrength: 0.76,
                dominantPreparationStrength: 0.8,
                recapTonalReturnStrength: 0.82,
                globalHarmonicProgressionStrength: 0.79,
            },
        },
        sections: [
            { id: "s1", role: "theme_a", label: "Theme", measures: 2 },
            { id: "s2", role: "development", label: "Development", measures: 2, motifRef: "s1" },
            { id: "s3", role: "recap", label: "Recap", measures: 2, motifRef: "s1" },
        ],
        sectionTonalities: [
            { sectionId: "s1", role: "theme_a", tonalCenter: "C major" },
            { sectionId: "s2", role: "development", tonalCenter: "G major" },
            { sectionId: "s3", role: "recap", tonalCenter: "C major" },
        ],
    });

    assert.equal(report.passed, true);
    assert.ok((report.metrics?.audioDevelopmentNarrativeFit ?? 0) >= 0.62);
    assert.ok((report.metrics?.audioRecapRecallFit ?? 0) >= 0.62);
    assert.ok((report.metrics?.audioNarrativeRenderConsistency ?? 0) >= 0.7);
    assert.ok((report.metrics?.audioDevelopmentPitchClassRouteFit ?? 0) >= 0.61);
    assert.ok((report.metrics?.audioChromaTonalReturnFit ?? 0) >= 0.66);
    assert.ok((report.metrics?.audioChromaHarmonicRouteFit ?? 0) >= 0.64);
    assert.ok((report.metrics?.audioDevelopmentKeyDriftFit ?? 0) >= 0.62);
    assert.ok((report.metrics?.audioTonalReturnRenderFit ?? 0) >= 0.7);
    assert.ok((report.metrics?.audioHarmonicRouteRenderFit ?? 0) >= 0.68);
    assert.equal(report.longSpan?.status, "held");
    assert.deepEqual(report.longSpan?.weakDimensions, []);
    assert.deepEqual(report.sectionFindings?.map((finding) => finding.sectionId), ["s2", "s3"]);
    assert.equal(report.sectionFindings?.[0]?.sourceSectionId, "s1");
    assert.equal(report.sectionFindings?.[1]?.sourceSectionId, "s1");
    assert.ok((report.sectionFindings?.[0]?.metrics.audioSectionCompositeFit ?? 0) >= 0.62);
    assert.ok((report.sectionFindings?.[1]?.metrics.audioSectionCompositeFit ?? 0) >= 0.62);
    assert.equal(report.keyTracking?.source, "rendered");
    assert.equal(report.keyTracking?.sections?.[1]?.renderedKey?.label, "G major");
    assert.deepEqual(
        (report.keyTracking?.sections?.[1]?.driftPath ?? []).map((point) => point.renderedKey.label).filter((label, index, labels) => labels[index - 1] !== label),
        ["C major", "D major", "G major"],
    );
    assert.match(report.strengths.join(" | "), /development's narrative escalation/);
    assert.match(report.strengths.join(" | "), /recap's return and release/);
    assert.match(report.strengths.join(" | "), /chroma key-profile estimates track the planned modulation and return/);
    assert.match(report.strengths.join(" | "), /chroma key-profile estimates return to the planned tonic and mode/);
    assert.match(report.strengths.join(" | "), /development traces the planned modulation path/);
    assert.match(report.strengths.join(" | "), /piece-level harmonic route/);
    assert.match(report.strengths.join(" | "), /tonal return grounded/);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("buildAudioEvaluation flags audio renders that flatten development and overstate recap", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-narrative-fail-"));
    const renderedAudio = path.join(tempRoot, "output.wav");
    const styledAudio = path.join(tempRoot, "styled-output.wav");

    fs.writeFileSync(renderedAudio, createTonalSectionedWavBuffer([
        { amplitude: 0.34, frequencies: [261.63, 329.63, 392] },
        { amplitude: 0.35, frequencies: [261.63, 329.63, 392] },
        { amplitude: 0.6, frequencies: [196, 246.94, 293.66] },
    ]));
    fs.writeFileSync(styledAudio, createTonalSectionedWavBuffer([
        { amplitude: 0.32, frequencies: [261.63, 329.63, 392] },
        { amplitude: 0.33, frequencies: [261.63, 329.63, 392] },
        { amplitude: 0.58, frequencies: [196, 246.94, 293.66] },
    ]));

    const report = buildAudioEvaluation({
        audio: renderedAudio,
        renderedAudio,
        styledAudio,
    }, "symbolic_plus_audio", {
        expectedDurationSec: 3,
        structureEvaluation: {
            passed: true,
            score: 84,
            issues: [],
            strengths: ["Symbolic narrative metrics are available."],
            metrics: {
                developmentNarrativeFit: 0.72,
                recapRecallFit: 0.79,
                harmonicModulationStrength: 0.78,
                dominantPreparationStrength: 0.76,
                recapTonalReturnStrength: 0.82,
                globalHarmonicProgressionStrength: 0.8,
            },
        },
        sections: [
            { id: "s1", role: "theme_a", label: "Theme", measures: 2 },
            { id: "s2", role: "development", label: "Development", measures: 2, motifRef: "s1" },
            { id: "s3", role: "recap", label: "Recap", measures: 2, motifRef: "s1" },
        ],
        sectionTonalities: [
            { sectionId: "s1", role: "theme_a", tonalCenter: "C major" },
            { sectionId: "s2", role: "development", tonalCenter: "G major" },
            { sectionId: "s3", role: "recap", tonalCenter: "C major" },
        ],
    });

    assert.equal(report.passed, false);
    assert.ok((report.metrics?.audioDevelopmentNarrativeFit ?? 1) < 0.5);
    assert.ok((report.metrics?.audioRecapRecallFit ?? 1) < 0.55);
    assert.ok((report.metrics?.audioDevelopmentPitchClassRouteFit ?? 1) < 0.5);
    assert.ok((report.metrics?.audioChromaTonalReturnFit ?? 1) < 0.52);
    assert.ok((report.metrics?.audioChromaHarmonicRouteFit ?? 1) < 0.5);
    assert.ok((report.metrics?.audioDevelopmentKeyDriftFit ?? 1) < 0.48);
    assert.ok((report.metrics?.audioTonalReturnRenderFit ?? 1) < 0.56);
    assert.ok((report.metrics?.audioHarmonicRouteRenderFit ?? 1) < 0.54);
    assert.equal(report.longSpan?.status, "collapsed");
    assert.ok((report.longSpan?.weakDimensions ?? []).includes("tonal_return"));
    assert.deepEqual(report.sectionFindings?.map((finding) => finding.sectionId), ["s2", "s3"]);
    assert.ok(report.weakestSections?.some((finding) => finding.sectionId === "s2"));
    assert.match(report.sectionFindings?.find((finding) => finding.sectionId === "s2")?.issues.join(" | ") ?? "", /Audio escalation against the source section is weak/);
    assert.match(report.sectionFindings?.find((finding) => finding.sectionId === "s3")?.issues.join(" | ") ?? "", /Audio return and release against the source section are weak/);
    assert.match(report.issues.join(" | "), /does not clearly escalate the development section/);
    assert.match(report.issues.join(" | "), /does not clearly support the recap's thematic return and release/);
    assert.match(report.issues.join(" | "), /chroma key-profile estimates do not follow the planned modulation and return/);
    assert.match(report.issues.join(" | "), /chroma key-profile estimates miss the planned tonal return/);
    assert.match(report.issues.join(" | "), /does not trace a clear modulation path/);
    assert.match(report.issues.join(" | "), /collapses the planned tonal return/);
    assert.match(report.issues.join(" | "), /blurs the planned harmonic route/);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("buildAudioEvaluation distinguishes same-tonic major and minor returns with key-profile matching", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-mode-detect-"));
    const renderedAudio = path.join(tempRoot, "output.wav");
    const styledAudio = path.join(tempRoot, "styled-output.wav");

    fs.writeFileSync(renderedAudio, createTonalSectionedWavBuffer([
        { amplitude: 0.22, frequencies: [261.63, 329.63, 392] },
        { amplitude: 0.48, frequencies: [196, 246.94, 293.66] },
        { amplitude: 0.24, frequencies: [261.63, 311.13, 392] },
    ]));
    fs.writeFileSync(styledAudio, createTonalSectionedWavBuffer([
        { amplitude: 0.22, frequencies: [261.63, 329.63, 392] },
        { amplitude: 0.46, frequencies: [196, 246.94, 293.66] },
        { amplitude: 0.24, frequencies: [261.63, 311.13, 392] },
    ]));

    const report = buildAudioEvaluation({
        audio: renderedAudio,
        renderedAudio,
        styledAudio,
    }, "symbolic_plus_audio", {
        expectedDurationSec: 3,
        structureEvaluation: {
            passed: true,
            score: 85,
            issues: [],
            strengths: ["Symbolic route returns to the tonic mode."],
            metrics: {
                developmentNarrativeFit: 0.74,
                recapRecallFit: 0.78,
                harmonicModulationStrength: 0.8,
                dominantPreparationStrength: 0.77,
                recapTonalReturnStrength: 0.82,
                globalHarmonicProgressionStrength: 0.8,
            },
        },
        sections: [
            { id: "s1", role: "theme_a", label: "Theme", measures: 2 },
            { id: "s2", role: "development", label: "Development", measures: 2, motifRef: "s1" },
            { id: "s3", role: "recap", label: "Recap", measures: 2, motifRef: "s1" },
        ],
        sectionTonalities: [
            { sectionId: "s1", role: "theme_a", tonalCenter: "C major" },
            { sectionId: "s2", role: "development", tonalCenter: "G major" },
            { sectionId: "s3", role: "recap", tonalCenter: "C major" },
        ],
    });

    assert.equal(report.passed, false);
    assert.ok((report.metrics?.audioChromaTonalReturnFit ?? 1) < 0.52);
    assert.ok((report.metrics?.audioTonalReturnRenderFit ?? 1) < 0.56);
    assert.match(report.issues.join(" | "), /miss the planned tonal return/);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("buildAudioEvaluation localizes render-consistency drift to the affected narrative section", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-audio-section-consistency-"));
    const renderedAudio = path.join(tempRoot, "output.wav");
    const styledAudio = path.join(tempRoot, "styled-output.wav");

    fs.writeFileSync(renderedAudio, createTonalSectionedWavBuffer([
        { amplitude: 0.22, frequencies: [261.63, 329.63, 392] },
        { amplitude: 0.56, frequencies: [196, 246.94, 293.66] },
        { amplitude: 0.24, frequencies: [261.63, 329.63, 392] },
    ]));
    fs.writeFileSync(styledAudio, createTonalSectionedWavBuffer([
        { amplitude: 0.22, frequencies: [261.63, 329.63, 392] },
        { amplitude: 0.26, frequencies: [196, 246.94, 293.66] },
        { amplitude: 0.24, frequencies: [261.63, 329.63, 392] },
    ]));

    const report = buildAudioEvaluation({
        audio: renderedAudio,
        renderedAudio,
        styledAudio,
    }, "symbolic_plus_audio", {
        expectedDurationSec: 3,
        structureEvaluation: {
            passed: true,
            score: 86,
            issues: [],
            strengths: ["Symbolic narrative metrics are stable across the form."],
            metrics: {
                developmentNarrativeFit: 0.74,
                recapRecallFit: 0.79,
                harmonicModulationStrength: 0.77,
                dominantPreparationStrength: 0.78,
                recapTonalReturnStrength: 0.82,
                globalHarmonicProgressionStrength: 0.79,
            },
        },
        sections: [
            { id: "s1", role: "theme_a", label: "Theme", measures: 2 },
            { id: "s2", role: "development", label: "Development", measures: 2, motifRef: "s1" },
            { id: "s3", role: "recap", label: "Recap", measures: 2, motifRef: "s1" },
        ],
        sectionTonalities: [
            { sectionId: "s1", role: "theme_a", tonalCenter: "C major" },
            { sectionId: "s2", role: "development", tonalCenter: "G major" },
            { sectionId: "s3", role: "recap", tonalCenter: "C major" },
        ],
    });

    const developmentFinding = report.sectionFindings?.find((finding) => finding.sectionId === "s2");
    const recapFinding = report.sectionFindings?.find((finding) => finding.sectionId === "s3");

    assert.ok(developmentFinding);
    assert.ok(recapFinding);
    assert.ok((developmentFinding?.metrics.audioSectionNarrativeConsistencyFit ?? 1) < 0.52);
    assert.ok((developmentFinding?.metrics.audioDevelopmentRouteConsistencyFit ?? 0) >= 0.74);
    assert.match(developmentFinding?.issues.join(" | ") ?? "", /disagree on the section's narrative contour/);
    assert.ok((recapFinding?.metrics.audioRecapTonalConsistencyFit ?? 0) >= 0.74);
    assert.equal(report.weakestSections?.[0]?.sectionId, "s2");

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("serializeQueuedJob exposes qualityControl history at top level", () => {
    const serialized = serializeQueuedJob({
        jobId: "job-1",
        request: {
            prompt: "Render a concise prelude.",
            workflow: "audio_only",
            qualityPolicy: {
                enableAutoRevision: false,
                maxStructureAttempts: 1,
                targetAudioScore: 80,
            },
        },
        attempts: 1,
        maxAttempts: 1,
        status: "done",
        manifest: {
            songId: "song-1",
            state: PipelineState.DONE,
            meta: {
                songId: "song-1",
                prompt: "Render a concise prelude.",
                form: "prelude",
                workflow: "audio_only",
                createdAt: "2025-01-01T00:00:00.000Z",
                updatedAt: "2025-01-01T00:00:02.000Z",
            },
            artifacts: {
                audio: "outputs/song-1/audio.wav",
            },
            structureEvaluation: {
                passed: true,
                score: 82,
                issues: ["Local cadence clarity still needs work."],
                strengths: ["Symbolic long-span form holds through the return."],
                metrics: {
                    longSpanDevelopmentPressureFit: 0.76,
                    longSpanThematicTransformationFit: 0.74,
                    longSpanHarmonicTimingFit: 0.71,
                    longSpanReturnPayoffFit: 0.73,
                },
                orchestration: {
                    family: "string_trio",
                    instrumentNames: ["violin", "viola", "cello"],
                    sectionCount: 3,
                    conversationalSectionCount: 1,
                    idiomaticRangeFit: 0.91,
                    registerBalanceFit: 0.88,
                    ensembleConversationFit: 0.84,
                    doublingPressureFit: 0.81,
                    textureRotationFit: 0.77,
                    sectionHandoffFit: 0.79,
                    weakSectionIds: ["s2"],
                },
                longSpan: {
                    status: "held",
                    weakDimensions: [],
                    averageFit: 0.735,
                    thematicCheckpointCount: 2,
                    expectedDevelopmentPressure: "high",
                    expectedReturnPayoff: "inevitable",
                    developmentPressureFit: 0.76,
                    thematicTransformationFit: 0.74,
                    harmonicTimingFit: 0.71,
                    returnPayoffFit: 0.73,
                },
            },
            audioEvaluation: {
                passed: false,
                score: 72,
                issues: ["Audio duration diverges too far from requested length 30s."],
                strengths: ["Audio-only generation produced a playable output."],
                metrics: {
                    durationScore: 4,
                    audioDevelopmentNarrativeFit: 0.41,
                    audioRecapRecallFit: 0.45,
                    audioTonalReturnRenderFit: 0.47,
                    audioHarmonicRouteRenderFit: 0.53,
                    audioChromaHarmonicRouteFit: 0.49,
                    audioDevelopmentKeyDriftFit: 0.44,
                },
                longSpan: {
                    status: "collapsed",
                    weakestDimension: "tonal_return",
                    weakDimensions: ["tonal_return", "recap_recall", "development_narrative", "harmonic_route"],
                    averageFit: 0.465,
                    developmentNarrativeFit: 0.41,
                    recapRecallFit: 0.45,
                    harmonicRouteFit: 0.53,
                    tonalReturnFit: 0.47,
                },
                sectionFindings: [
                    {
                        sectionId: "s2",
                        label: "Development",
                        role: "development",
                        sourceSectionId: "s1",
                        plannedTonality: "G minor",
                        score: 0.43,
                        issues: ["Audio escalation against the source section is weak."],
                        strengths: [],
                        metrics: {
                            audioSectionCompositeFit: 0.43,
                            audioDevelopmentNarrativeFit: 0.41,
                            audioDevelopmentPitchClassRouteFit: 0.46,
                            audioDevelopmentKeyDriftFit: 0.44,
                        },
                    },
                    {
                        sectionId: "s3",
                        label: "Recap",
                        role: "recap",
                        sourceSectionId: "s1",
                        plannedTonality: "C major",
                        score: 0.39,
                        issues: ["Rendered pitch-class return does not settle back into the planned recap tonality."],
                        strengths: [],
                        metrics: {
                            audioSectionCompositeFit: 0.39,
                            audioRecapRecallFit: 0.45,
                            audioRecapPitchClassReturnFit: 0.41,
                            audioRecapTonalConsistencyFit: 0.36,
                        },
                    },
                ],
                weakestSections: [
                    {
                        sectionId: "s2",
                        label: "Development",
                        role: "development",
                        sourceSectionId: "s1",
                        plannedTonality: "G minor",
                        score: 0.43,
                        issues: ["Audio escalation against the source section is weak."],
                        strengths: [],
                        metrics: {
                            audioSectionCompositeFit: 0.43,
                            audioDevelopmentNarrativeFit: 0.41,
                            audioDevelopmentPitchClassRouteFit: 0.46,
                            audioDevelopmentKeyDriftFit: 0.44,
                        },
                    },
                ],
                keyTracking: {
                    source: "rendered",
                    sections: [
                        {
                            sectionId: "s1",
                            role: "theme_a",
                            plannedTonality: "C major",
                            renderedKey: {
                                label: "C major",
                                tonicPitchClass: 0,
                                mode: "major",
                                score: 0.83,
                                confidence: 0.76,
                            },
                            driftPath: [
                                {
                                    startRatio: 0,
                                    endRatio: 1,
                                    renderedKey: {
                                        label: "C major",
                                        tonicPitchClass: 0,
                                        mode: "major",
                                        score: 0.83,
                                        confidence: 0.76,
                                    },
                                },
                            ],
                        },
                        {
                            sectionId: "s2",
                            role: "development",
                            plannedTonality: "G minor",
                            renderedKey: {
                                label: "G minor",
                                tonicPitchClass: 7,
                                mode: "minor",
                                score: 0.81,
                                confidence: 0.71,
                            },
                            driftPath: [
                                {
                                    startRatio: 0,
                                    endRatio: 0.4,
                                    renderedKey: {
                                        label: "C major",
                                        tonicPitchClass: 0,
                                        mode: "major",
                                        score: 0.72,
                                        confidence: 0.62,
                                    },
                                },
                                {
                                    startRatio: 0.4,
                                    endRatio: 0.75,
                                    renderedKey: {
                                        label: "D minor",
                                        tonicPitchClass: 2,
                                        mode: "minor",
                                        score: 0.7,
                                        confidence: 0.58,
                                    },
                                },
                                {
                                    startRatio: 0.75,
                                    endRatio: 1,
                                    renderedKey: {
                                        label: "G minor",
                                        tonicPitchClass: 7,
                                        mode: "minor",
                                        score: 0.81,
                                        confidence: 0.71,
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
            sectionTransforms: [
                {
                    sectionId: "s2",
                    role: "development",
                    sourceSectionId: "s1",
                    transformMode: "inversion+diminution",
                    rhythmTransform: "diminution",
                    sequenceStride: 0,
                },
            ],
            sectionTonalities: [
                {
                    sectionId: "s1",
                    role: "theme_a",
                    tonalCenter: "C major",
                },
                {
                    sectionId: "s2",
                    role: "development",
                    tonalCenter: "G minor",
                },
            ],
            qualityControl: {
                policy: {
                    enableAutoRevision: false,
                    maxStructureAttempts: 1,
                    targetAudioScore: 80,
                },
                attempts: [
                    {
                        attempt: 1,
                        stage: "structure",
                        passed: true,
                        score: 82,
                        issues: [],
                        strengths: ["Symbolic draft passed."],
                        metrics: {
                            developmentNarrativeFit: 0.72,
                        },
                        directives: [],
                        evaluatedAt: "2025-01-01T00:00:00.500Z",
                    },
                    {
                        attempt: 1,
                        stage: "audio",
                        passed: false,
                        score: 72,
                        issues: ["Audio duration diverges too far from requested length 30s."],
                        strengths: ["Audio-only generation produced a playable output."],
                        metrics: {
                            audioDevelopmentNarrativeFit: 0.41,
                        },
                        directives: [],
                        evaluatedAt: "2025-01-01T00:00:01.000Z",
                    },
                ],
                selectedAttempt: 1,
                stopReason: "Audio score target not met.",
            },
            stateHistory: [
                { state: PipelineState.IDLE, timestamp: "2025-01-01T00:00:00.000Z" },
                { state: PipelineState.DONE, timestamp: "2025-01-01T00:00:02.000Z" },
            ],
            updatedAt: "2025-01-01T00:00:02.000Z",
        },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:02.000Z",
    });

    assert.equal(serialized.qualityPolicy?.requested?.targetAudioScore, 80);
    assert.equal(serialized.qualityPolicy?.effective?.targetAudioScore, 80);
    assert.equal(serialized.qualityPolicy?.targets.audio.enforced, true);
    assert.equal(serialized.qualityPolicy?.targets.audio.enforcementMode, "audio_only_or_explicit");
    assert.equal(serialized.qualityControl?.attempts.length, 2);
    assert.equal(serialized.quality.attemptCount, 1);
    assert.equal(serialized.quality.audioScore, 72);
    assert.equal(serialized.quality.policy?.targets.structure.enforced, false);
    assert.equal(serialized.quality.longSpan?.status, "held");
    assert.equal(serialized.quality.audioLongSpan?.status, "collapsed");
    assert.equal(serialized.quality.audioLongSpan?.weakestDimension, "tonal_return");
    assert.equal(serialized.quality.longSpanDivergence?.status, "render_collapsed");
    assert.equal(serialized.quality.longSpanDivergence?.repairMode, "render_only");
    assert.equal(serialized.quality.longSpanDivergence?.repairFocus, "tonal_return");
    assert.deepEqual(serialized.quality.longSpanDivergence?.secondaryRepairFocuses, ["recap_recall", "development_narrative", "harmonic_route"]);
    assert.deepEqual(serialized.quality.longSpanDivergence?.recommendedDirectives, [
        { focus: "tonal_return", kind: "rebalance_recap_release", priorityClass: "primary" },
        { focus: "recap_recall", kind: "rebalance_recap_release", priorityClass: "secondary" },
        { focus: "development_narrative", kind: "clarify_narrative_arc", priorityClass: "secondary" },
        { focus: "harmonic_route", kind: "stabilize_harmony", priorityClass: "secondary" },
    ]);
    assert.equal(serialized.quality.longSpanDivergence?.primarySectionId, "s3");
    assert.equal(serialized.quality.longSpanDivergence?.sections?.[0]?.sectionId, "s3");
    assert.equal(serialized.quality.longSpanDivergence?.sections?.[0]?.comparisonStatus, "audio_only");
    assert.equal(serialized.evaluations.structure?.longSpan?.returnPayoffFit, 0.73);
    assert.equal(serialized.evaluations.audio?.longSpan?.tonalReturnFit, 0.47);
    assert.equal(serialized.evaluations.audio?.passed, false);
    assert.equal(serialized.manifest?.sectionTransforms?.[0]?.transformMode, "inversion+diminution");
    assert.equal(serialized.tracking?.sectionTonalities?.[1]?.tonalCenter, "G minor");
    assert.equal(serialized.tracking?.audioNarrative?.harmonicRouteFit, 0.53);
    assert.equal(serialized.tracking?.audioNarrative?.chromaHarmonicRouteFit, 0.49);
    assert.equal(serialized.tracking?.audioNarrative?.developmentKeyDriftFit, 0.44);
    assert.equal(serialized.tracking?.audioNarrative?.longSpan?.status, "collapsed");
    assert.equal(serialized.tracking?.audioNarrative?.longSpan?.weakestDimension, "tonal_return");
    assert.equal(serialized.tracking?.longSpanDivergence?.status, "render_collapsed");
    assert.equal(serialized.tracking?.longSpanDivergence?.repairMode, "render_only");
    assert.equal(serialized.tracking?.longSpanDivergence?.repairFocus, "tonal_return");
    assert.deepEqual(serialized.tracking?.longSpanDivergence?.secondaryRepairFocuses, ["recap_recall", "development_narrative", "harmonic_route"]);
    assert.deepEqual(serialized.tracking?.longSpanDivergence?.recommendedDirectives, [
        { focus: "tonal_return", kind: "rebalance_recap_release", priorityClass: "primary" },
        { focus: "recap_recall", kind: "rebalance_recap_release", priorityClass: "secondary" },
        { focus: "development_narrative", kind: "clarify_narrative_arc", priorityClass: "secondary" },
        { focus: "harmonic_route", kind: "stabilize_harmony", priorityClass: "secondary" },
    ]);
    assert.equal(serialized.tracking?.longSpanDivergence?.primarySectionId, "s3");
    assert.equal(serialized.tracking?.longSpanDivergence?.sections?.[0]?.sectionId, "s3");
    assert.equal(serialized.tracking?.longSpanDivergence?.sections?.[0]?.comparisonStatus, "audio_only");
    assert.equal(serialized.tracking?.audioWeakestSections?.[0]?.sectionId, "s2");
    assert.equal(serialized.tracking?.audioWeakestSections?.[0]?.plannedTonality, "G minor");
    assert.equal(serialized.tracking?.orchestration?.family, "string_trio");
    assert.equal(serialized.tracking?.orchestration?.idiomaticRangeFit, 0.91);
    assert.equal(serialized.tracking?.orchestration?.registerBalanceFit, 0.88);
    assert.equal(serialized.tracking?.orchestration?.ensembleConversationFit, 0.84);
    assert.equal(serialized.tracking?.orchestration?.doublingPressureFit, 0.81);
    assert.equal(serialized.tracking?.orchestration?.textureRotationFit, 0.77);
    assert.equal(serialized.tracking?.orchestration?.sectionHandoffFit, 0.79);
    assert.deepEqual(serialized.tracking?.orchestration?.weakSectionIds, ["s2"]);
    assert.equal(serialized.tracking?.renderedKeyTracking?.source, "rendered");
    assert.equal(serialized.tracking?.renderedKeyTracking?.sections?.[1]?.renderedKeyLabel, "G minor");
    assert.deepEqual(serialized.tracking?.renderedKeyTracking?.sections?.[1]?.driftPathLabels, ["C major", "D minor", "G minor"]);
});

test("pipeline allows render to render-audio transition", () => {
    assert.equal(canTransition(PipelineState.RENDER, PipelineState.RENDER_AUDIO), true);
    assert.equal(canTransition(PipelineState.RENDER_AUDIO, PipelineState.STORE), true);
    assert.equal(canTransition(PipelineState.RENDER_AUDIO, PipelineState.COMPOSE), true);
});

test("humanizer applies harmonic prolongation and tonicization cues to late-section sustain", { skip: !pythonBin }, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-humanizer-harmonic-color-"));

    try {
        const inputPath = path.join(tempRoot, "input.mid");
        const controlOutputPath = path.join(tempRoot, "control.mid");
        const harmonicOutputPath = path.join(tempRoot, "harmonic.mid");
        await createTwoPartTestMidi(inputPath);

        const controlResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, controlOutputPath, {
            style: "mechanical",
            expressionPlan: {
                humanizationStyle: "mechanical",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                    },
                ],
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 4,
                    energy: 0.3,
                    density: 0.24,
                },
            ],
        }));
        const harmonicResult = await runHumanizerWorker(buildHumanizeWorkerInput(inputPath, harmonicOutputPath, {
            style: "mechanical",
            expressionPlan: {
                humanizationStyle: "mechanical",
                sections: [
                    {
                        sectionId: "s1",
                        startMeasure: 1,
                        endMeasure: 4,
                    },
                ],
            },
            sections: [
                {
                    id: "s1",
                    role: "theme_a",
                    label: "Opening",
                    measures: 4,
                    energy: 0.3,
                    density: 0.24,
                    harmonicPlan: {
                        prolongationMode: "pedal",
                        tonicizationWindows: [
                            { startMeasure: 3, endMeasure: 4, keyTarget: "G major", emphasis: "arriving" },
                        ],
                        colorCues: [
                            { tag: "suspension", startMeasure: 4, endMeasure: 4, resolutionMeasure: 4 },
                        ],
                    },
                },
            ],
        }));

        assert.equal(controlResult.ok, true);
        assert.equal(harmonicResult.ok, true);
        assert.equal(controlResult.expressionApplied, false);
        assert.equal(harmonicResult.expressionApplied, true);
        assert.equal(harmonicResult.sectionHarmonicRealization?.[0]?.prolongationMode, "pedal");
        assert.deepEqual(harmonicResult.sectionHarmonicRealization?.[0]?.requestedTonicizationTargets, ["G major"]);
        assert.deepEqual(harmonicResult.sectionHarmonicRealization?.[0]?.requestedColorTags, ["suspension"]);
        assert.equal(harmonicResult.sectionHarmonicRealization?.[0]?.targetedMeasureCount, 4);
        assert.equal(harmonicResult.sectionHarmonicRealization?.[0]?.prolongationMeasureCount, 4);
        assert.equal(harmonicResult.sectionHarmonicRealization?.[0]?.tonicizationMeasureCount, 2);
        assert.equal(harmonicResult.sectionHarmonicRealization?.[0]?.harmonicColorMeasureCount, 1);
        assert.ok((harmonicResult.sectionHarmonicRealization?.[0]?.tonicizationAverageDurationScale ?? 1) > 1.04);
        assert.ok((harmonicResult.sectionHarmonicRealization?.[0]?.harmonicColorAverageEndingStretchScale ?? 1) > 1.1);

        const controlStats = await analyzeRawHumanizedMidiByMeasure(controlOutputPath);
        const harmonicStats = await analyzeRawHumanizedMidiByMeasure(harmonicOutputPath);

        assert.ok(
            harmonicStats.parts[0].late.averageQuarterLength > controlStats.parts[0].late.averageQuarterLength + 0.12,
            JSON.stringify({ controlStats, harmonicStats }),
        );
        assert.ok(
            harmonicStats.parts[1].late.averageQuarterLength > controlStats.parts[1].late.averageQuarterLength + 0.12,
            JSON.stringify({ controlStats, harmonicStats }),
        );
        assert.ok(
            harmonicStats.parts[0].late.averageQuarterLength > harmonicStats.parts[0].early.averageQuarterLength + 0.08,
            JSON.stringify({ controlStats, harmonicStats }),
        );
        assert.ok(
            harmonicStats.parts[1].late.averageQuarterLength > harmonicStats.parts[1].early.averageQuarterLength + 0.08,
            JSON.stringify({ controlStats, harmonicStats }),
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