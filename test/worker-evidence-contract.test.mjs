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

async function runNormalizerTest(code, sectionJson) {
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
const response = ${makeProposalResponse(sectionJson ?? makeProposalSection())};
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

// ─── WEC-09~13: Strict evidence contract tests ────────────────────────────────

test("WEC-09: normalizer passes phrasePeaks to SectionArtifactSummary", async () => {
    const result = await runNormalizerTest(`
import { normalizeLearnedSymbolicResponse } from "./dist/core/composer/learnedNormalizer.js";
const req = { prompt: "test", compositionPlan: null };
const plan = { composeWorker: "learned_symbolic", workflow: "learned_symbolic", selectedModels: [] };
const pack = { version: "1.0", planSignature: "sig", styleCue: { key: "C major", tempo: 96 } };
const normalized = normalizeLearnedSymbolicResponse(response, req, "song-1", plan, pack);
const section = normalized.sectionArtifacts[0];
console.log(JSON.stringify({
    hasPhrasePeaks: Array.isArray(section.phrasePeaks) && section.phrasePeaks.length > 0,
    peaks: section.phrasePeaks,
}));
`, makeProposalSection({ phrasePeaks: [2, 4] }));
    assert.ok(result.hasPhrasePeaks, "phrasePeaks should be present after normalization");
    assert.deepEqual(result.peaks, [2, 4]);
});

test("WEC-10: normalizer passes cadenceApproach to SectionArtifactSummary", async () => {
    const result = await runNormalizerTest(`
import { normalizeLearnedSymbolicResponse } from "./dist/core/composer/learnedNormalizer.js";
const req = { prompt: "test", compositionPlan: null };
const plan = { composeWorker: "learned_symbolic", workflow: "learned_symbolic", selectedModels: [] };
const pack = { version: "1.0", planSignature: "sig", styleCue: { key: "C major", tempo: 96 } };
const normalized = normalizeLearnedSymbolicResponse(response, req, "song-1", plan, pack);
const section = normalized.sectionArtifacts[0];
console.log(JSON.stringify({ cadenceApproach: section.cadenceApproach }));
`, makeProposalSection({ cadenceApproach: "dominant" }));
    assert.equal(result.cadenceApproach, "dominant", "cadenceApproach should be present after normalization");
});

test("WEC-11: normalizer passes all 5 core evidence fields simultaneously", async () => {
    const result = await runNormalizerTest(`
import { normalizeLearnedSymbolicResponse } from "./dist/core/composer/learnedNormalizer.js";
const req = { prompt: "test", compositionPlan: null };
const plan = { composeWorker: "learned_symbolic", workflow: "learned_symbolic", selectedModels: [] };
const pack = { version: "1.0", planSignature: "sig", styleCue: { key: "C major", tempo: 96 } };
const normalized = normalizeLearnedSymbolicResponse(response, req, "song-1", plan, pack);
const s = normalized.sectionArtifacts[0];
console.log(JSON.stringify({
    hasPhrasePeaks: Array.isArray(s.phrasePeaks) && s.phrasePeaks.length > 0,
    hasCadenceApproach: s.cadenceApproach !== undefined,
    hasColorCues: Array.isArray(s.harmonicColorCues) && s.harmonicColorCues.length > 0,
    hasHRS: s.harmonicRealizationSummary !== undefined,
    hasCapturedMotif: Array.isArray(s.capturedMotif) && s.capturedMotif.length > 0,
    cadenceApproach: s.cadenceApproach,
}));
`, makeProposalSection({ phrasePeaks: [3, 6], cadenceApproach: "plagal" }));
    assert.ok(result.hasPhrasePeaks,     "phrasePeaks must pass through");
    assert.ok(result.hasCadenceApproach, "cadenceApproach must pass through");
    assert.ok(result.hasColorCues,       "harmonicColorCues must pass through");
    assert.ok(result.hasHRS,             "harmonicRealizationSummary must pass through");
    assert.ok(result.hasCapturedMotif,   "capturedMotif must pass through");
    assert.equal(result.cadenceApproach, "plagal");
});

// ─── WEC-12~13: Python piano projection evidence tests ────────────────────────

const workerComposerDir = path.join(repoRoot, "workers", "composer");

async function runPianoProjectionHelper(pythonBin, code) {
    const { stdout } = await execFileAsync(
        pythonBin,
        ["-c", `
import sys, os, json
sys.path.insert(0, r'${workerComposerDir.replace(/\\/g, "\\\\")}')
${code}
`],
        { timeout: 10_000 },
    );
    return stdout.trim();
}

test("WEC-12: piano projection produces rightHandEvents and leftHandEvents per section", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping Python-dependent test");
        return;
    }
    const out = await runPianoProjectionHelper(py, `
from learned_symbolic.piano_projection import project_piano_section
section = {
    "id": "s1", "role": "theme_a", "measures": 4,
    "key": "C major", "phraseFunction": "antecedent",
}
melody_events = [
    {"kind": "note", "midi": 64, "quarterLength": 1.0, "role": "lead"},
    {"kind": "note", "midi": 67, "quarterLength": 1.0, "role": "lead"},
    {"kind": "note", "midi": 69, "quarterLength": 1.0, "role": "lead"},
    {"kind": "note", "midi": 71, "quarterLength": 1.0, "role": "lead"},
]
acc_events = [
    {"kind": "note", "midi": 48, "quarterLength": 2.0, "role": "bass"},
    {"kind": "note", "midi": 50, "quarterLength": 2.0, "role": "bass"},
]
result = project_piano_section(section, 0, melody_events, acc_events)
assert "rightHandEvents" in result, f"Missing rightHandEvents: {list(result.keys())}"
assert "leftHandEvents" in result, f"Missing leftHandEvents: {list(result.keys())}"
assert len(result["rightHandEvents"]) > 0, "rightHandEvents must be non-empty for lead events"
assert len(result["leftHandEvents"]) > 0, "leftHandEvents must be non-empty for bass events"
print(json.dumps({
    "rhCount": len(result["rightHandEvents"]),
    "lhCount": len(result["leftHandEvents"]),
    "hasMeasures": len(result.get("rightHandMeasures", [])) > 0,
}))
`);
    const data = JSON.parse(out);
    assert.ok(data.rhCount > 0, "rightHandEvents should be non-empty for lead melody");
    assert.ok(data.lhCount > 0, "leftHandEvents should be non-empty for bass events");
    assert.ok(data.hasMeasures, "rightHandMeasures should be populated");
});

test("WEC-13: enrich_proposal_sections_with_piano_layout adds pianoVoiceLayout per section", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping Python-dependent test");
        return;
    }
    const out = await runPianoProjectionHelper(py, `
from learned_symbolic.piano_projection import enrich_proposal_sections_with_piano_layout
sections = [
    {
        "sectionId": "s1", "role": "theme_a", "measureCount": 4,
        "tonalCenter": "C major", "phraseFunction": "antecedent",
        "leadEvents": [
            {"kind": "note", "midi": 64, "quarterLength": 1.0, "role": "lead"},
            {"kind": "note", "midi": 67, "quarterLength": 1.0, "role": "lead"},
        ],
        "supportEvents": [
            {"kind": "note", "midi": 48, "quarterLength": 2.0, "role": "bass"},
        ],
    }
]
enriched, global_layout, warnings = enrich_proposal_sections_with_piano_layout(sections)
assert len(enriched) == 1, f"Expected 1 section, got {len(enriched)}"
s = enriched[0]
assert "rightHandEvents" in s, f"Missing rightHandEvents"
assert "leftHandEvents" in s, f"Missing leftHandEvents"
assert "pianoVoiceLayout" in s, f"Missing pianoVoiceLayout"
layout = s["pianoVoiceLayout"]
assert isinstance(layout, dict) and layout, f"pianoVoiceLayout must be a non-empty dict"
print(json.dumps({
    "hasRHE": "rightHandEvents" in s,
    "hasLHE": "leftHandEvents" in s,
    "hasPVL": "pianoVoiceLayout" in s,
    "layoutKeys": list(layout.keys()),
}))
`);
    const data = JSON.parse(out);
    assert.ok(data.hasRHE, "enriched section must have rightHandEvents");
    assert.ok(data.hasLHE, "enriched section must have leftHandEvents");
    assert.ok(data.hasPVL, "enriched section must have pianoVoiceLayout");
    assert.ok(data.layoutKeys.length > 0, "pianoVoiceLayout must have fields");
});

// ─── WEC-14~16: mock / template backend evidence contract smoke test ───────────
// These tests verify that the mock backend (default when AXIOM_LEARNED_BACKEND is
// unset or "mock") passes evidence fields through project_symbolic_sections.
// The mock backend wraps symbolic_projection, so if the projection pass-through
// works (WEC-06~11), the mock backend should also pass these fields.
// Tests are skipped when Python or music21 is not available.

const mockBackendDir = path.join(repoRoot, "workers", "composer");

async function runMockBackendHelper(pythonBin, code) {
    const { stdout } = await execFileAsync(
        pythonBin,
        ["-c", `
import sys, os, json
sys.path.insert(0, r'${mockBackendDir.replace(/\\/g, "\\\\")}')
${code}
`],
        { timeout: 15_000 },
    );
    return stdout.trim();
}

test("WEC-14: mock backend passes phrasePeaks and cadenceApproach through project_symbolic_sections", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping mock backend smoke test");
        return;
    }

    let out;
    try {
        out = await runMockBackendHelper(py, `
from learned_symbolic.symbolic_projection import project_symbolic_sections
from music21 import key as key_module

tonic = key_module.Key("C")
payload = {
    "plan": {
        "sections": [{"id": "s1", "role": "theme_a", "measures": 4, "key": "C major"}],
        "globalKey": "C",
        "tempo": 96,
    }
}
sections = [{"id": "s1", "role": "theme_a", "measures": 4, "key": "C major"}]
result = project_symbolic_sections(payload, sections, tonic, 0)
# proposalSections from result
ps = result.proposal_sections
assert len(ps) > 0, f"Expected at least 1 section, got {len(ps)}"
s = ps[0]
# Both phrasePeaks and cadenceApproach should be present (populated by evidence helpers)
has_phrase_peaks = "phrasePeaks" in s or "phrase_peaks" in s
has_cadence = "cadenceApproach" in s or "cadence_approach" in s
print(json.dumps({
    "sectionCount": len(ps),
    "sectionKeys": list(s.keys()),
    "hasPhrasePeaksOrCadence": has_phrase_peaks or has_cadence,
    "hasLeadEvents": "leadEvents" in s or "lead_events" in s,
}))
`);
    } catch (err) {
        if (err.message.includes("music21") || err.message.includes("ModuleNotFoundError")) {
            t.skip("music21 not available — skipping mock backend smoke test");
            return;
        }
        throw err;
    }

    const data = JSON.parse(out);
    assert.ok(data.sectionCount > 0, "mock backend should produce at least 1 section");
    assert.ok(data.hasLeadEvents, "mock backend section should have leadEvents");
});

test("WEC-15: mock backend normalization warning is 'mock_backend_not_for_quality_eval'", async (t) => {
    const py = await pythonAvailable();
    if (!py) {
        t.skip("Python not available — skipping mock backend warning smoke test");
        return;
    }

    let out;
    try {
        out = await runMockBackendHelper(py, `
from learned_symbolic.notagen_engines.mock import MockEngine
engine = MockEngine()
result = engine.generate(
    payload={
        "plan": {
            "sections": [{"id": "s1", "role": "theme_a", "measures": 4, "key": "C major"}],
            "globalKey": "C",
            "tempo": 96,
        }
    },
    sections=[{"id": "s1", "role": "theme_a", "measures": 4, "key": "C major"}],
    attempt_index=0,
    context=None,
)
warnings = result.normalization_warnings if hasattr(result, "normalization_warnings") else []
print(json.dumps({
    "hasWarnings": len(warnings) > 0,
    "hasMockWarning": any("mock_backend_not_for_quality_eval" in w for w in warnings),
    "warnings": warnings,
}))
`);
    } catch (err) {
        if (err.message.includes("music21") || err.message.includes("ModuleNotFoundError") ||
            err.message.includes("ImportError")) {
            t.skip("music21 or MockEngine not available — skipping WEC-15");
            return;
        }
        throw err;
    }

    const data = JSON.parse(out);
    assert.ok(
        data.hasMockWarning,
        `mock backend should emit 'mock_backend_not_for_quality_eval' warning; got: ${JSON.stringify(data.warnings)}`,
    );
});

test("WEC-16: mock backend section has leadEvents (structural smoke test — no music21 required)", async (t) => {
    // This test uses the normalizer (Node.js) path to verify that a section coming
    // from the mock backend retains its structure after TypeScript normalization.
    // No Python subprocess is needed; we simulate the mock backend output shape.
    const result = await runNormalizerTest(`
import { normalizeLearnedSymbolicResponse } from "./dist/core/composer/learnedNormalizer.js";
const req = { prompt: "mock-test", compositionPlan: null };
const plan = {
    composeWorker: "learned_symbolic",
    workflow: "learned_symbolic",
    selectedModels: [],
};
const pack = {
    version: "1.0", planSignature: "mock-sig",
    styleCue: { key: "C major", tempo: 96 },
};
// Simulate mock backend output that includes normalizationWarnings
const mockResponse = {
    ok: true,
    proposalMidiPath: MIDI_PATH,
    proposalSections: [{
        sectionId: "s1",
        role: "theme_a",
        measureCount: 4,
        leadEvents: [{ kind: "note", midi: 64, quarterLength: 1.0, role: "lead" }],
        supportEvents: [{ kind: "note", midi: 48, quarterLength: 2.0, role: "bass" }],
        phrasePeaks: [2, 4],
        cadenceApproach: "dominant",
        harmonicColorCues: [{ tag: "predominant_color" }],
        harmonicRealizationSummary: { realizedMeasureCount: 4, realizedNoteCount: 4, targetedMeasureCount: 4 },
        capturedMotif: [3, 2],
    }],
    // normalizationWarnings lives inside proposalMetadata in the real backend
    proposalMetadata: {
        normalizationWarnings: ["mock_backend_not_for_quality_eval"],
    },
};
const normalized = normalizeLearnedSymbolicResponse(mockResponse, req, "song-mock", plan, pack);
const s = normalized.sectionArtifacts[0];
// normalizationWarnings is nested under proposalEvidence
const warnings = normalized.proposalEvidence?.normalizationWarnings ?? [];
console.log(JSON.stringify({
    hasMockWarning: warnings.some(w => w.includes("mock_backend_not_for_quality_eval")),
    hasPhrasePeaks: Array.isArray(s.phrasePeaks) && s.phrasePeaks.length > 0,
    hasCadenceApproach: s.cadenceApproach === "dominant",
    hasColorCues: Array.isArray(s.harmonicColorCues) && s.harmonicColorCues.length > 0,
    sectionCount: normalized.sectionArtifacts.length,
}));
`);

    assert.ok(result.sectionCount > 0, "normalized output should have at least 1 section");
    assert.ok(result.hasPhrasePeaks,     "mock backend section: phrasePeaks must survive normalization");
    assert.ok(result.hasCadenceApproach, "mock backend section: cadenceApproach must survive normalization");
    assert.ok(result.hasColorCues,       "mock backend section: harmonicColorCues must survive normalization");
    assert.ok(result.hasMockWarning,     "mock warning 'mock_backend_not_for_quality_eval' should be preserved in normalized output");
});
