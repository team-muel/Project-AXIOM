/**
 * worker-evidence-contract.test.mjs
 *
 * Validates that section_evidence.py helpers produce the correct evidence fields,
 * and that learnedNormalizer.ts passes them through to SectionArtifactSummary.
 *
 * WEC-01: derive_phrase_peaks returns ≥1 peak in [1, measureCount]
 * WEC-02: derive_cadence_approach returns one of the four valid tokens
 * WEC-03: derive_harmonic_color_cues returns ≥1 cue with a non-empty tag
 * WEC-04: derive_harmonic_realization_summary has required integer fields
 * WEC-05: derive_captured_motif returns interval array from noteHistory
 * WEC-06: normalizer passes harmonicColorCues from section → SectionArtifactSummary
 * WEC-07: normalizer passes harmonicRealizationSummary from section → SectionArtifactSummary
 * WEC-08: normalizer passes capturedMotif from section → SectionArtifactSummary
 *
 * Python-dependent tests (WEC-01~05) import section_evidence.py via a child process.
 * They are skipped gracefully when Python or music21 is not available.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { runNodeEval, parseLastJsonLine } from "./helpers/subprocess.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const evidenceScript = path.join(
    repoRoot,
    "workers",
    "composer",
    "learned_symbolic",
    "section_evidence.py",
);

// ─── Python availability probe ────────────────────────────────────────────────

async function pythonAvailable() {
    for (const bin of ["python3", "python"]) {
        try {
            const { stdout } = await execFileAsync(bin, ["-c", "import sys; print(sys.version)"], {
                timeout: 5_000,
            });
            if (stdout.trim()) return bin;
        } catch {
            // continue
        }
    }
    return null;
}

async function runPythonHelper(pythonBin, code) {
    const { stdout } = await execFileAsync(
        pythonBin,
        ["-c", `
import sys, os, json
sys.path.insert(0, os.path.dirname(r'${evidenceScript.replace(/\\/g, "/")}'))
import section_evidence as ev
${code}
`],
        { timeout: 10_000 },
    );
    return stdout.trim();
}

// ─── WEC-01~05: Python evidence helper unit tests ─────────────────────────────

test("WEC-01: derive_phrase_peaks returns ≥1 peak within [1, measureCount]", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping Python-dependent test");
        return;
    }
    const out = await runPythonHelper(py, `
note_history = [62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64]
peaks = ev.derive_phrase_peaks(note_history, 4)
assert isinstance(peaks, list) and len(peaks) >= 1, f"Expected >=1 peak, got {peaks}"
assert all(1 <= p <= 4 for p in peaks), f"Peaks out of range: {peaks}"
print(json.dumps(peaks))
`);
    const peaks = JSON.parse(out);
    assert.ok(peaks.length >= 1, "should return at least one peak");
    assert.ok(peaks.every((p) => p >= 1 && p <= 4), "all peaks must be in [1, measureCount]");
});

test("WEC-02: derive_cadence_approach returns a valid token", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping Python-dependent test");
        return;
    }
    const out = await runPythonHelper(py, `
valid_tokens = {"dominant", "plagal", "tonic", "other"}
cases = [
    ("cadence", "consequent", {"cadence": "authentic"}),
    ("theme_a", "antecedent", {}),
    ("development", None, {}),
    ("outro", None, {"cadence": "plagal"}),
    ("bridge", "transition", {"cadence": "deceptive"}),
]
results = []
for role, pf, hp in cases:
    token = ev.derive_cadence_approach(role, pf, hp)
    assert token in valid_tokens, f"Invalid token {token!r} for role={role}"
    results.append(token)
print(json.dumps(results))
`);
    const tokens = JSON.parse(out);
    const valid = new Set(["dominant", "plagal", "tonic", "other"]);
    for (const t2 of tokens) {
        assert.ok(valid.has(t2), `unexpected token: ${t2}`);
    }
});

test("WEC-03: derive_harmonic_color_cues returns ≥1 cue with non-empty tag", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping Python-dependent test");
        return;
    }
    const out = await runPythonHelper(py, `
# No existing color cues in plan — must synthesise
cues = ev.derive_harmonic_color_cues({}, "theme_a", 8, "dominant")
assert isinstance(cues, list) and len(cues) >= 1, f"Expected >=1 cue, got {cues}"
for cue in cues:
    assert cue.get("tag"), f"cue missing tag: {cue}"
print(json.dumps(cues))
`);
    const cues = JSON.parse(out);
    assert.ok(cues.length >= 1, "should return at least one cue");
    for (const cue of cues) {
        assert.ok(typeof cue.tag === "string" && cue.tag.length > 0, "each cue must have a tag");
    }
});

test("WEC-04: derive_harmonic_realization_summary has required fields", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping Python-dependent test");
        return;
    }
    const out = await runPythonHelper(py, `
summary = ev.derive_harmonic_realization_summary("section-1", {}, 8, 24)
required_keys = {"sectionId", "targetedMeasureCount", "realizedMeasureCount", "realizedNoteCount"}
missing = required_keys - set(summary.keys())
assert not missing, f"Missing keys: {missing}"
assert summary["sectionId"] == "section-1"
assert summary["targetedMeasureCount"] == 8
assert summary["realizedMeasureCount"] == 8
assert summary["realizedNoteCount"] == 24
print(json.dumps(summary))
`);
    const summary = JSON.parse(out);
    assert.equal(summary.sectionId, "section-1");
    assert.equal(summary.targetedMeasureCount, 8);
    assert.equal(summary.realizedMeasureCount, 8);
    assert.equal(summary.realizedNoteCount, 24);
});

test("WEC-05: derive_captured_motif returns interval array from noteHistory", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping Python-dependent test");
        return;
    }
    const out = await runPythonHelper(py, `
# [60, 62, 64, 65, 67, 69] → intervals [2, 2, 1, 2, 2] (5 intervals from 6 notes)
motif = ev.derive_captured_motif([60, 62, 64, 65, 67, 69, 71])
assert motif == [2, 2, 1, 2, 2], f"Wrong motif: {motif}"
# Short note history
short = ev.derive_captured_motif([60])
assert short == [], f"Expected empty for single note: {short}"
print(json.dumps({"motif": motif, "short": short}))
`);
    const data = JSON.parse(out);
    assert.deepEqual(data.motif, [2, 2, 1, 2, 2]);
    assert.deepEqual(data.short, []);
});

// ─── WEC-06~08: TypeScript normalizer pass-through tests ─────────────────────

function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "wec-test-"));
}

function makeProposalSection(overrides = {}) {
    return JSON.stringify(Object.assign({
        sectionId: "section-1",
        role: "theme_a",
        measureCount: 4,
        tonalCenter: "C major",
        phraseFunction: "antecedent",
        leadEvents: [
            { kind: "note", midi: 64, quarterLength: 1, velocity: 74, role: "lead" },
            { kind: "note", midi: 67, quarterLength: 1, velocity: 74, role: "lead" },
            { kind: "note", midi: 69, quarterLength: 1, velocity: 80, role: "lead" },
            { kind: "note", midi: 71, quarterLength: 1, velocity: 74, role: "lead" },
        ],
        supportEvents: [
            { kind: "note", midi: 48, quarterLength: 2, velocity: 56, role: "bass" },
            { kind: "note", midi: 50, quarterLength: 2, velocity: 56, role: "bass" },
        ],
        noteHistory: [64, 67, 69, 71],
        harmonicColorCues: [{ tag: "predominant_color", startMeasure: 3, endMeasure: 4 }],
        harmonicRealizationSummary: {
            targetedMeasureCount: 4,
            realizedMeasureCount: 4,
            realizedNoteCount: 4,
        },
        capturedMotif: [3, 2, 2],
    }, overrides));
}

function makeProposalResponse(sectionJson) {
    return `{
        ok: true,
        proposalMidiPath: MIDI_PATH,
        proposalSections: [${sectionJson}],
    }`;
}

async function runNormalizerTest(code) {
    const tmpDir = makeTmpDir();
    // Need a real MIDI file for the normalizer to accept
    const midiPath = path.join(tmpDir, "test.mid");
    // Minimal MIDI header (14 bytes header chunk)
    const midiHeader = Buffer.from([
        0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x01, 0x00, 0x01, 0x00, 0x60,
        0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x04, 0x00, 0xff, 0x2f, 0x00,
    ]);
    fs.writeFileSync(midiPath, midiHeader);

    const evalCode = `
import fs from "node:fs";
const MIDI_PATH = ${JSON.stringify(midiPath)};
const response = ${makeProposalResponse(makeProposalSection())};
${code}
`;
    const { stdout } = await runNodeEval(evalCode, { cwd: repoRoot, env: { OUTPUT_DIR: tmpDir } });
    return parseLastJsonLine(stdout);
}

test("WEC-06: normalizer passes harmonicColorCues to SectionArtifactSummary", async () => {
    const result = await runNormalizerTest(`
import { normalizeLearnedSymbolicResponse } from "./dist/core/composer/learnedNormalizer.js";
const req = { prompt: "test", compositionPlan: null };
const plan = {
    composeWorker: "learned_symbolic",
    workflow: "learned_symbolic",
    selectedModels: [],
};
const pack = {
    version: "1.0", planSignature: "sig",
    styleCue: { key: "C major", tempo: 96 },
};
const normalized = normalizeLearnedSymbolicResponse(response, req, "song-1", plan, pack);
const section = normalized.sectionArtifacts[0];
console.log(JSON.stringify({
    hasHarmonicColorCues: Array.isArray(section.harmonicColorCues) && section.harmonicColorCues.length > 0,
    firstTag: section.harmonicColorCues?.[0]?.tag,
}));
`);
    assert.ok(result.hasHarmonicColorCues, "harmonicColorCues should be present after normalization");
    assert.equal(result.firstTag, "predominant_color");
});

test("WEC-07: normalizer passes harmonicRealizationSummary to SectionArtifactSummary", async () => {
    const result = await runNormalizerTest(`
import { normalizeLearnedSymbolicResponse } from "./dist/core/composer/learnedNormalizer.js";
const req = { prompt: "test", compositionPlan: null };
const plan = { composeWorker: "learned_symbolic", workflow: "learned_symbolic", selectedModels: [] };
const pack = { version: "1.0", planSignature: "sig", styleCue: { key: "C major", tempo: 96 } };
const normalized = normalizeLearnedSymbolicResponse(response, req, "song-1", plan, pack);
const section = normalized.sectionArtifacts[0];
console.log(JSON.stringify({
    hasHRS: section.harmonicRealizationSummary !== undefined,
    realizedMeasureCount: section.harmonicRealizationSummary?.realizedMeasureCount,
}));
`);
    assert.ok(result.hasHRS, "harmonicRealizationSummary should be present after normalization");
    assert.equal(result.realizedMeasureCount, 4);
});

test("WEC-08: normalizer passes capturedMotif to SectionArtifactSummary", async () => {
    const result = await runNormalizerTest(`
import { normalizeLearnedSymbolicResponse } from "./dist/core/composer/learnedNormalizer.js";
const req = { prompt: "test", compositionPlan: null };
const plan = { composeWorker: "learned_symbolic", workflow: "learned_symbolic", selectedModels: [] };
const pack = { version: "1.0", planSignature: "sig", styleCue: { key: "C major", tempo: 96 } };
const normalized = normalizeLearnedSymbolicResponse(response, req, "song-1", plan, pack);
const section = normalized.sectionArtifacts[0];
console.log(JSON.stringify({
    hasCapturedMotif: Array.isArray(section.capturedMotif) && section.capturedMotif.length > 0,
    motif: section.capturedMotif,
}));
`);
    assert.ok(result.hasCapturedMotif, "capturedMotif should be present after normalization");
    assert.deepEqual(result.motif, [3, 2, 2]);
});
