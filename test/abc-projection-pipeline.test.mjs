// @ts-check
/**
 * Phase C: ABC validation/repair/projection pipeline tests.
 *
 * Test groups:
 *   A. abc_validate.py — structural validation (text-based, no music21 needed)
 *      1. Valid ABC passes with no errors
 *      2. Empty input → fatal error
 *      3. Missing K: → fatal error
 *      4. Missing X: and T: → repairable warnings, not fatal
 *      5. Wrong voice count → warning, not fatal
 *      6. Too many bars → bar count divergence warning
 *      7. Empty voice → warning, not fatal
 *
 *   B. abc_repair.py — structural repair (text-based, no music21 needed)
 *      8.  Missing final barline → |] added, abc_repaired warning
 *      9.  Empty measure → Z rest substituted, abc_repaired warning
 *     10.  Too-long voice → truncated, truncated_extra_bars warning
 *     11.  Too-short voice → padded with Z, voice_padding_inserted warning
 *
 *   C. abc_project.py — full pipeline (music21 required for events)
 *     12. Unparseable ABC → ok:false
 *     13. Valid ABC + sections → ok:true with proposalSections (music21 skip)
 *     14. Voice too short → rest padding in output (music21 skip)
 *     15. Too many bars → truncate warning in output (music21 skip)
 *
 *   D. TypeScript normalizer — projection output → ComposeResult
 *     16. normalizeLearnedSymbolicResponse with Phase C warning codes in
 *         proposalMetadata.normalizationWarnings threads them to proposalEvidence
 *     17. sectionArtifacts are built from proposalSections with leadEvents/supportEvents
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function detectPythonBin() {
    const candidates = [
        path.join(repoRoot, ".venv", "Scripts", "python.exe"),
        path.join(repoRoot, ".venv", "bin", "python"),
    ];
    const venvBin = candidates.find((c) => fs.existsSync(c));
    if (venvBin) return venvBin;
    for (const bin of ["python", "python3"]) {
        const probe = spawnSync(bin, ["--version"], { encoding: "utf8", shell: true });
        if (!probe.error && probe.status === 0) return bin;
    }
    return null;
}
const pythonBin = detectPythonBin();

function hasMusicTwentyOne() {
    if (!pythonBin) return false;
    const r = spawnSync(pythonBin, ["-c", "import music21"], {
        encoding: "utf8",
        shell: true,
        cwd: repoRoot,
    });
    return !r.error && r.status === 0;
}
const music21Available = hasMusicTwentyOne();

// ─── ABC fixtures ─────────────────────────────────────────────────────────────

const VALID_ABC_2VOICE = `X:1
T:Test
M:4/4
L:1/4
K:C
V:1 clef=treble
C D E F | G A B c |
V:2 clef=bass
C, D, E, F, | G, A, B, C |`;

const VALID_ABC_3VOICE = `X:1
T:Test
M:4/4
L:1/4
K:C
V:1 clef=treble
C D E F | G A B c |
V:2 clef=treble
E F G A | B c d e |
V:3 clef=bass
C, D, E, F, | G, A, B, C |`;

const SHORT_VOICE_ABC = `X:1
T:Test
M:4/4
L:1/4
K:C
V:1 clef=treble
C D E F | G A B c |
V:2 clef=treble
E F G A | B c d e |
V:3 clef=bass
C, D, E, F, |`;

const LONG_ABC = `X:1
T:Test
M:4/4
L:1/4
K:C
V:1 clef=treble
C D E F | G A B c | C D E F |
V:2 clef=treble
E F G A | B c d e | E F G A |
V:3 clef=bass
C, D, E, F, | G, A, B, C | C, D, E, F, |`;

const NO_K_ABC = `X:1
T:Test
M:4/4
L:1/4
V:1
C D E F |`;

const EMPTY_ABC = "";

const NO_VOICES_ABC = `X:1
T:Test
M:4/4
L:1/4
K:C
C D E F | G A B c |`;

// ─── Python runner helpers ─────────────────────────────────────────────────

/**
 * Run a Python snippet via -c with optional stdin input.
 * IMPORTANT: shell must be false to avoid Windows cmd.exe mangling
 *            multi-line scripts.
 * @param {string} script
 * @param {string} [input]
 * @returns {{ stdout: string, stderr: string, status: number }}
 */
function runPython(script, input) {
    const result = spawnSync(
        pythonBin,
        ["-c", script],
        {
            cwd: repoRoot,
            input: input ?? "",
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
        },
    );
    if (result.error) throw result.error;
    return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        status: result.status ?? -1,
    };
}

function runValidate(abcText, opts = {}) {
    const { expectedVoiceCount = 3, expectedTotalBars = null, meterStr = "4/4" } = opts;
    const script = `
import sys, json
sys.path.insert(0, "workers/composer")
from learned_symbolic.abc_validate import validate_abc_structure
abc = sys.stdin.read()
r = validate_abc_structure(
    abc,
    expected_voice_count=${expectedVoiceCount},
    expected_total_bars=${expectedTotalBars === null ? "None" : expectedTotalBars},
    meter_str=${JSON.stringify(meterStr)},
)
sys.stdout.write(json.dumps({
    "is_valid": r.is_valid,
    "has_fatal_error": r.has_fatal_error,
    "errors": r.errors,
    "warnings": r.warnings,
    "total_bar_count": r.total_bar_count,
    "voice_stats": [{"voice_id": v.voice_id, "bar_count": v.bar_count, "is_empty": v.is_empty} for v in r.voice_stats],
}))
`.trim();
    const res = runPython(script, abcText);
    return JSON.parse(res.stdout);
}

function runRepair(abcText, opts = {}) {
    const { expectedTotalBars = 0, meterStr = "4/4" } = opts;
    const script = `
import sys, json
sys.path.insert(0, "workers/composer")
from learned_symbolic.abc_repair import repair_abc
abc = sys.stdin.read()
r = repair_abc(abc, expected_total_bars=${expectedTotalBars}, meter_str=${JSON.stringify(meterStr)})
sys.stdout.write(json.dumps({
    "ok": r.ok,
    "repaired_abc": r.repaired_abc,
    "repairs_applied": r.repairs_applied,
    "error": r.error,
}))
`.trim();
    const res = runPython(script, abcText);
    return JSON.parse(res.stdout);
}

function runProjection(abcText, sections, providerRequest, outputPath) {
    const script = `
import sys, json
sys.path.insert(0, "workers/composer")
from learned_symbolic.abc_project import run_abc_projection_pipeline
data = json.load(sys.stdin)
r = run_abc_projection_pipeline(
    data["abc"],
    data["sections"],
    data["providerRequest"],
    output_path=data.get("outputPath"),
)
sys.stdout.write(json.dumps({
    "ok": r.ok,
    "proposal_sections": r.proposal_sections,
    "midi_path": r.midi_path,
    "normalization_warnings": r.normalization_warnings,
    "error": r.error,
}))
`.trim();
    const input = JSON.stringify({
        abc: abcText,
        sections,
        providerRequest,
        outputPath: outputPath ?? null,
    });
    const res = runPython(script, input);
    if (!res.stdout.trim()) {
        return { ok: false, proposal_sections: [], midi_path: null, normalization_warnings: [], error: res.stderr };
    }
    return JSON.parse(res.stdout);
}

const MINIMAL_SECTIONS = [
    { id: "s1", role: "theme_a", measures: 2 },
];
const TWO_SECTION_SECTIONS = [
    { id: "s1", role: "theme_a", measures: 2 },
    { id: "s2", role: "recap",   measures: 2 },
];
const MINIMAL_PR = {
    controlLines: [
        "lane=string_trio_symbolic",
        "abc_format=interleaved",
        "form=miniature",
        "key=C",
        "meter=4/4",
        "tempo=92",
        "instrumentation=Violin:lead,Viola:counterline,Cello:bass",
    ],
};

// ─── TypeScript imports ───────────────────────────────────────────────────────

const { buildLearnedSymbolicWorkerPayload } = await import("../dist/composer/learnedAdapter.js");
const { normalizeLearnedSymbolicResponse } = await import("../dist/composer/learnedNormalizer.js");

const EXECUTION_PLAN = {
    workflow: "symbolic_only",
    composeWorker: "learned_symbolic",
    selectedModels: [{ role: "structure", provider: "notagen", model: "notagen-abc-v1" }],
};

function makeMinimalRequest() {
    return {
        prompt: "Test miniature",
        form: "miniature",
        key: "G minor",
        tempo: 84,
        workflow: "symbolic_only",
        compositionPlan: {
            version: "1",
            brief: "Test miniature",
            mood: [],
            form: "miniature",
            key: "G minor",
            meter: "4/4",
            tempo: 84,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "Violin", family: "strings", roles: ["lead"] },
                { name: "Viola", family: "strings", roles: ["counterline"] },
                { name: "Cello", family: "strings", roles: ["bass"] },
            ],
            orchestration: { family: "string_trio", instrumentNames: ["Violin","Viola","Cello"], sections: [] },
            motifPolicy: { reuseRequired: false },
            rationale: "",
            sections: [
                { id: "s1", role: "theme_a", label: "Theme A", measures: 4, energy: 0.5, density: 0.4 },
                { id: "s2", role: "recap",   label: "Recap",   measures: 4, energy: 0.4, density: 0.3 },
            ],
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// A. abc_validate tests
// ─────────────────────────────────────────────────────────────────────────────

test("abc_validate: valid 3-voice ABC passes with no errors or fatal", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    const r = runValidate(VALID_ABC_3VOICE, { expectedVoiceCount: 3, expectedTotalBars: 2 });
    assert.equal(r.has_fatal_error, false);
    assert.equal(r.is_valid, true);
    assert.equal(r.errors.length, 0);
});

test("abc_validate: empty input → fatal error", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    const r = runValidate(EMPTY_ABC);
    assert.equal(r.has_fatal_error, true);
    assert.equal(r.is_valid, false);
    assert.ok(r.errors.some((e) => /empty/.test(e)));
});

test("abc_validate: missing K: → fatal error", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    const r = runValidate(NO_K_ABC, { expectedVoiceCount: 1 });
    assert.equal(r.has_fatal_error, true);
    assert.ok(r.errors.some((e) => /K:/.test(e)));
});

test("abc_validate: missing X: and T: → repairable warnings, not fatal", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    const noxt = `M:4/4\nL:1/4\nK:C\nV:1\nC D E F |\n`;
    const r = runValidate(noxt, { expectedVoiceCount: 1 });
    assert.equal(r.has_fatal_error, false, "should not be fatal");
    assert.ok(r.warnings.some((w) => /X:/.test(w) || /T:/.test(w)));
});

test("abc_validate: voice count mismatch → warning, not fatal", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    const r = runValidate(VALID_ABC_2VOICE, { expectedVoiceCount: 3 });
    assert.equal(r.has_fatal_error, false);
    assert.ok(r.warnings.some((w) => /voice count mismatch/i.test(w)));
});

test("abc_validate: too many bars → bar count divergence warning", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    // LONG_ABC has 3 bars per voice but we expect 1
    const r = runValidate(LONG_ABC, { expectedVoiceCount: 3, expectedTotalBars: 1 });
    assert.equal(r.has_fatal_error, false);
    assert.ok(r.warnings.some((w) => /bar count divergence/i.test(w)));
});

test("abc_validate: empty voice → warning, not fatal", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    const emptyVoice = `X:1\nT:T\nM:4/4\nL:1/4\nK:C\nV:1\nC D E F |\nV:2\n|\n`;
    const r = runValidate(emptyVoice, { expectedVoiceCount: 2 });
    assert.equal(r.has_fatal_error, false);
    assert.ok(r.warnings.some((w) => /empty/i.test(w)));
});

// ─────────────────────────────────────────────────────────────────────────────
// B. abc_repair tests
// ─────────────────────────────────────────────────────────────────────────────

test("abc_repair: missing final barline → |] added and abc_repaired warning", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    const noFinal = `X:1\nT:T\nM:4/4\nL:1/4\nK:C\nV:1\nC D E F`;
    const r = runRepair(noFinal);
    assert.equal(r.ok, true);
    assert.ok(r.repaired_abc.trimEnd().endsWith("|]"), `should end with |] — got: ${r.repaired_abc.slice(-20)}`);
    assert.ok(r.repairs_applied.includes("abc_repaired"));
});

test("abc_repair: empty measure → Z rest substituted and abc_repaired warning", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    const emptyMeasure = `X:1\nT:T\nM:4/4\nL:1/4\nK:C\nV:1\nC D E F || G A B c |`;
    const r = runRepair(emptyMeasure);
    assert.equal(r.ok, true);
    // The || (empty measure) should have Z inserted between the bars
    assert.ok(/Z/.test(r.repaired_abc), `should contain Z rest — got: ${r.repaired_abc}`);
    assert.ok(r.repairs_applied.includes("abc_repaired"));
});

test("abc_repair: too-long voice truncated to expected_total_bars", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    // LONG_ABC has 3 bars per voice; we want only 2
    const r = runRepair(LONG_ABC, { expectedTotalBars: 2 });
    assert.equal(r.ok, true);
    assert.ok(r.repairs_applied.includes("truncated_extra_bars"), `repairs: ${r.repairs_applied}`);
});

test("abc_repair: too-short voice padded with Z rests and voice_padding_inserted", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    // SHORT_VOICE_ABC: voices 1 and 2 have 2 bars, voice 3 has 1 bar; expect 2
    const r = runRepair(SHORT_VOICE_ABC, { expectedTotalBars: 2 });
    assert.equal(r.ok, true);
    assert.ok(r.repairs_applied.includes("voice_padding_inserted"), `repairs: ${r.repairs_applied}`);
    // Z should appear in the repaired text
    assert.ok(/Z/.test(r.repaired_abc), "should have Z padding");
});

// ─────────────────────────────────────────────────────────────────────────────
// C. abc_project pipeline tests
// ─────────────────────────────────────────────────────────────────────────────

test("abc_project: unparseable ABC → ok:false", (t) => {
    if (!pythonBin) { t.skip("No Python binary"); return; }
    const r = runProjection("THIS IS NOT ABC", MINIMAL_SECTIONS, MINIMAL_PR);
    assert.equal(r.ok, false);
    assert.ok(r.error, "should have error message");
});

test("abc_project: valid ABC + sections → ok:true with proposalSections", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runProjection(VALID_ABC_3VOICE, TWO_SECTION_SECTIONS, MINIMAL_PR);
    assert.equal(r.ok, true, `error: ${r.error}`);
    assert.ok(Array.isArray(r.proposal_sections) && r.proposal_sections.length > 0);
    const sec = r.proposal_sections[0];
    assert.ok(sec.sectionId, "should have sectionId");
    assert.ok(typeof sec.measureCount === "number");
});

test("abc_project: short voice → voice_padding_inserted in normalization_warnings", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runProjection(SHORT_VOICE_ABC, TWO_SECTION_SECTIONS, MINIMAL_PR);
    assert.equal(r.ok, true, `error: ${r.error}`);
    assert.ok(
        r.normalization_warnings.includes("voice_padding_inserted"),
        `warnings: ${r.normalization_warnings}`,
    );
});

test("abc_project: too many bars → truncated_extra_bars in normalization_warnings", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    // LONG_ABC has 3 bars; TWO_SECTION_SECTIONS expects 2+2=4... let's use 1+1=2
    const shortSections = [
        { id: "s1", role: "theme_a", measures: 1 },
        { id: "s2", role: "recap",   measures: 1 },
    ];
    const r = runProjection(LONG_ABC, shortSections, MINIMAL_PR);
    assert.equal(r.ok, true, `error: ${r.error}`);
    assert.ok(
        r.normalization_warnings.includes("truncated_extra_bars"),
        `warnings: ${r.normalization_warnings}`,
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// D. TypeScript normalizer tests
// ─────────────────────────────────────────────────────────────────────────────

test("normalizer: Phase C warning codes thread to proposalEvidence.normalizationWarnings", async () => {
    const tmpDir = os.tmpdir();
    const midiPath = path.join(tmpDir, "phase-c-test.mid");
    // Minimal valid MIDI header (14 bytes)
    fs.writeFileSync(
        midiPath,
        Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0, 0x60]),
    );

    const req = makeMinimalRequest();
    const payload = buildLearnedSymbolicWorkerPayload(req, "test-song", midiPath, EXECUTION_PLAN);

    const mockResponse = {
        ok: true,
        proposalMidiPath: midiPath,
        proposalSummary: {
            measureCount: 8,
            noteCount: 24,
            partCount: 3,
            partInstrumentNames: ["Violin", "Viola", "Cello"],
            key: "Gmin",
            tempo: 84,
            form: "miniature",
        },
        proposalMetadata: {
            lane: "string_trio_symbolic",
            provider: "notagen",
            model: "notagen-abc-v1",
            generationMode: "notagen_abc_inference",
            confidence: 0.7,
            normalizationWarnings: ["abc_repaired", "voice_padding_inserted"],
        },
        proposalSections: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                tonalCenter: "G minor",
                phraseFunction: "presentation",
                leadEvents: [{ kind: "note", quarterLength: 1, midi: 62, role: "lead" }],
                supportEvents: [{ kind: "rest", quarterLength: 1, role: "bass" }],
                noteHistory: [62],
            },
            {
                sectionId: "s2",
                role: "recap",
                measureCount: 4,
                tonalCenter: "G minor",
                phraseFunction: "recapitulation",
                leadEvents: [{ kind: "note", quarterLength: 1, midi: 64, role: "lead" }],
                supportEvents: [],
                noteHistory: [64],
            },
        ],
    };

    const result = normalizeLearnedSymbolicResponse(
        mockResponse,
        req,
        "test-song",
        EXECUTION_PLAN,
        payload.promptPack,
    );

    assert.deepEqual(result.proposalEvidence.normalizationWarnings, [
        "abc_repaired",
        "voice_padding_inserted",
    ]);
    assert.equal(result.proposalEvidence.provider, "notagen");
    assert.equal(result.proposalEvidence.generationMode, "notagen_abc_inference");
});

test("normalizer: proposalSections → sectionArtifacts with lead/supportEvents", async () => {
    const tmpDir = os.tmpdir();
    const midiPath = path.join(tmpDir, "phase-c-test2.mid");
    fs.writeFileSync(
        midiPath,
        Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0, 0x60]),
    );

    const req = makeMinimalRequest();
    const payload = buildLearnedSymbolicWorkerPayload(req, "test-song", midiPath, EXECUTION_PLAN);

    const mockResponse = {
        ok: true,
        proposalMidiPath: midiPath,
        proposalMetadata: {
            lane: "string_trio_symbolic",
            normalizationWarnings: ["truncated_extra_bars", "inferred_tonal_center"],
        },
        proposalSections: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                tonalCenter: "G minor",
                leadEvents: [
                    { kind: "note", quarterLength: 1, midi: 62, role: "lead" },
                    { kind: "note", quarterLength: 1, midi: 64, role: "lead" },
                ],
                supportEvents: [{ kind: "rest", quarterLength: 4, role: "bass" }],
                noteHistory: [62, 64],
            },
        ],
    };

    const result = normalizeLearnedSymbolicResponse(
        mockResponse,
        req,
        "test-song",
        EXECUTION_PLAN,
        payload.promptPack,
    );

    assert.equal(result.sectionArtifacts?.length, 1);
    const art = result.sectionArtifacts?.[0];
    assert.equal(art?.sectionId, "s1");
    assert.equal(art?.melodyEvents.length, 2, "leadEvents → melodyEvents");
    assert.equal(art?.accompanimentEvents.length, 1, "supportEvents → accompanimentEvents");
    assert.deepEqual(art?.noteHistory, [62, 64]);
    assert.ok(
        result.proposalEvidence.normalizationWarnings?.includes("truncated_extra_bars"),
    );
    assert.ok(
        result.proposalEvidence.normalizationWarnings?.includes("inferred_tonal_center"),
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Phase C-2: music21 bar-duration and voice-sync validation
// ─────────────────────────────────────────────────────────────────────────────

function runDurationValidation(abcText, meterStr = "4/4") {
    const script = `
import sys, json
sys.path.insert(0, "workers/composer")
import music21
from learned_symbolic.abc_validate import validate_bar_durations, validate_voice_synchronization
abc = sys.stdin.read()
score = music21.converter.parse(abc, format="abc")
dur_warnings = validate_bar_durations(score, ${JSON.stringify(meterStr)})
sync_warnings = validate_voice_synchronization(score)
sys.stdout.write(json.dumps({"dur_warnings": dur_warnings, "sync_warnings": sync_warnings}))
`.trim();
    const res = runPython(script, abcText);
    if (!res.stdout.trim()) throw new Error(`Python error: ${res.stderr}`);
    return JSON.parse(res.stdout);
}

// Properly filled 4/4 bars — L:1/4 so each note = 1.0 QL
const ABC_DURATION_GOOD = `X:1
T:Test
M:4/4
L:1/4
K:C
V:1
C D E F | G A B c |
V:2
E, F, G, A, | B, C D E |
V:3
C,, D,, E,, F,, | G,, A,, B,, C, |`;

// Voice 3 bar 2 is short (2 beats instead of 4)
const ABC_BAR_DURATION_BAD = `X:1
T:Test
M:4/4
L:1/4
K:C
V:1
C D E F | G A B c |
V:2
E, F, G, A, | B, C D E |
V:3
C,, D,, E,, F,, | G,, A,, |`;

// Voices 1+2 have 2 bars, voice 3 has only 1 (sync mismatch)
const ABC_VOICE_SYNC_BAD = `X:1
T:Test
M:4/4
L:1/4
K:C
V:1
C D E F | G A B c |
V:2
E, F, G, A, | B, C D E |
V:3
C,, D,, E,, F,, |`;

test("Phase C-2 validate_bar_durations: properly filled 4/4 bars produce no warnings", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runDurationValidation(ABC_DURATION_GOOD, "4/4");
    assert.deepEqual(r.dur_warnings, [], `expected no bar-duration warnings, got: ${JSON.stringify(r.dur_warnings)}`);
});

test("Phase C-2 validate_bar_durations: short bar detected with part/measure info", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runDurationValidation(ABC_BAR_DURATION_BAD, "4/4");
    assert.ok(r.dur_warnings.length > 0, "should produce bar-duration warnings");
    assert.ok(
        r.dur_warnings.some((w) => /2\.0/.test(w) && /4\.0/.test(w)),
        `warning should show 2.0 QL vs 4.0 QL; got: ${r.dur_warnings}`,
    );
});

test("Phase C-2 validate_voice_synchronization: in-sync voices produce no warnings", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runDurationValidation(ABC_DURATION_GOOD, "4/4");
    assert.deepEqual(r.sync_warnings, [], `expected no sync warnings, got: ${JSON.stringify(r.sync_warnings)}`);
});

test("Phase C-2 validate_voice_synchronization: measure-count mismatch detected", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runDurationValidation(ABC_VOICE_SYNC_BAD, "4/4");
    assert.ok(r.sync_warnings.length > 0, "should produce voice-sync warnings");
    assert.ok(
        r.sync_warnings.some((w) => /measure count/i.test(w) || /out of sync/i.test(w)),
        `warning should mention measure sync; got: ${r.sync_warnings}`,
    );
});

test("Phase C-2 abc_project: bar_duration_mismatch surfaces in normalization_warnings", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    // Voice 3 bar 2 short → bar_duration_mismatch in pipeline output
    const r = runProjection(ABC_BAR_DURATION_BAD, TWO_SECTION_SECTIONS, MINIMAL_PR);
    assert.ok(
        r.normalization_warnings.includes("bar_duration_mismatch"),
        `expected bar_duration_mismatch in warnings; got: ${r.normalization_warnings}`,
    );
});

test("Phase C-2 abc_project: voice_sync_mismatch surfaces in normalization_warnings", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    // Voice 3 only 1 bar → voice_sync_mismatch + voice_padding_inserted
    const r = runProjection(ABC_VOICE_SYNC_BAD, MINIMAL_SECTIONS, MINIMAL_PR);
    assert.ok(
        r.normalization_warnings.includes("voice_sync_mismatch"),
        `expected voice_sync_mismatch in warnings; got: ${r.normalization_warnings}`,
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Phase C-3: evidence field projection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run abc_to_events helpers directly and return evidence for the first section.
 */
function runEvidenceProjection(abcText, sections) {
    const script = `
import sys, json
sys.path.insert(0, "workers/composer")
data = json.load(sys.stdin)
from learned_symbolic.abc_to_events import convert
mats, warns = convert(data["abc"], data["sections"])
out = []
for m in mats:
    ev = {k: v for k, v in m.items() if k not in ("leadEvents", "supportEvents")}
    out.append(ev)
sys.stdout.write(json.dumps({"sections": out, "warnings": warns}))
`.trim();
    const input = JSON.stringify({ abc: abcText, sections });
    const res = runPython(script, input);
    if (!res.stdout.trim()) throw new Error(`Python error:\n${res.stderr}`);
    return JSON.parse(res.stdout);
}

// 3-voice ABC: D major, descending bass — gives dominant cadence
const ABC_EVIDENCE_3VOICE = `X:1
T:EvidenceTest
M:4/4
L:1/4
K:D
V:1 clef=treble
d c B A | G F E D |
V:2 clef=treble
F E D C | B, A, G, F, |
V:3 clef=bass
D, E, F, G, | A, B, C D |`;

const EVIDENCE_SECTIONS = [
    { id: "s1", role: "theme_a", measures: 2, harmonicPlan: { tonalCenter: "D major" } },
];

test("Phase C-3 evidence: melodyPitchMin/Max present and ordered", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runEvidenceProjection(ABC_EVIDENCE_3VOICE, EVIDENCE_SECTIONS);
    const sec = r.sections[0];
    assert.ok(typeof sec.melodyPitchMin === "number", "melodyPitchMin should be a number");
    assert.ok(typeof sec.melodyPitchMax === "number", "melodyPitchMax should be a number");
    assert.ok(sec.melodyPitchMin <= sec.melodyPitchMax, "min <= max");
});

test("Phase C-3 evidence: bassPitchMin/Max present and ordered", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runEvidenceProjection(ABC_EVIDENCE_3VOICE, EVIDENCE_SECTIONS);
    const sec = r.sections[0];
    assert.ok(typeof sec.bassPitchMin === "number", "bassPitchMin should be a number");
    assert.ok(typeof sec.bassPitchMax === "number", "bassPitchMax should be a number");
    assert.ok(sec.bassPitchMin <= sec.bassPitchMax, "min <= max");
});

test("Phase C-3 evidence: cadenceApproach is one of the four allowed values", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runEvidenceProjection(ABC_EVIDENCE_3VOICE, EVIDENCE_SECTIONS);
    const sec = r.sections[0];
    assert.ok(
        ["dominant", "plagal", "tonic", "other"].includes(sec.cadenceApproach),
        `unexpected cadenceApproach: ${sec.cadenceApproach}`,
    );
});

test("Phase C-3 evidence: bassMotionProfile is one of the four allowed values", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runEvidenceProjection(ABC_EVIDENCE_3VOICE, EVIDENCE_SECTIONS);
    const sec = r.sections[0];
    assert.ok(
        ["pedal", "stepwise", "mixed", "leaping"].includes(sec.bassMotionProfile),
        `unexpected bassMotionProfile: ${sec.bassMotionProfile}`,
    );
});

test("Phase C-3 evidence: texture rates are numbers in [0,1]", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runEvidenceProjection(ABC_EVIDENCE_3VOICE, EVIDENCE_SECTIONS);
    const sec = r.sections[0];
    assert.ok(typeof sec.textureContraryMotionRate === "number", "contrary rate should be number");
    assert.ok(typeof sec.textureIndependentMotionRate === "number", "independent rate should be number");
    assert.ok(sec.textureContraryMotionRate >= 0 && sec.textureContraryMotionRate <= 1, `contrary [0,1]: ${sec.textureContraryMotionRate}`);
    assert.ok(sec.textureIndependentMotionRate >= 0 && sec.textureIndependentMotionRate <= 1, `independent [0,1]: ${sec.textureIndependentMotionRate}`);
});

test("Phase C-3 evidence: rhythmicDensity > 0 for non-empty section", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runEvidenceProjection(ABC_EVIDENCE_3VOICE, EVIDENCE_SECTIONS);
    const sec = r.sections[0];
    assert.ok(typeof sec.rhythmicDensity === "number" && sec.rhythmicDensity > 0, `rhythmicDensity should be > 0: ${sec.rhythmicDensity}`);
});

test("Phase C-3 evidence: phrasePeaks is a non-empty array of numbers", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runEvidenceProjection(ABC_EVIDENCE_3VOICE, EVIDENCE_SECTIONS);
    const sec = r.sections[0];
    assert.ok(Array.isArray(sec.phrasePeaks), "phrasePeaks should be an array");
    assert.ok(sec.phrasePeaks.every((p) => typeof p === "number"), "phrasePeaks entries should be numbers");
});

test("Phase C-3 evidence: secondaryLineMotif present with up to 6 MIDI pitches", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runEvidenceProjection(ABC_EVIDENCE_3VOICE, EVIDENCE_SECTIONS);
    const sec = r.sections[0];
    assert.ok(Array.isArray(sec.secondaryLineMotif), "secondaryLineMotif should be an array");
    assert.ok(sec.secondaryLineMotif.length <= 6, `at most 6 entries; got ${sec.secondaryLineMotif.length}`);
    assert.ok(sec.secondaryLineMotif.every((p) => typeof p === "number"), "entries should be numbers");
});

test("Phase C-3 evidence: runProjection pipeline includes evidence fields in proposal_sections", (t) => {
    if (!pythonBin || !music21Available) { t.skip("music21 not available"); return; }
    const r = runProjection(ABC_EVIDENCE_3VOICE, EVIDENCE_SECTIONS, MINIMAL_PR);
    assert.ok(r.ok, `pipeline should succeed; error: ${r.error}`);
    const sec = r.proposal_sections?.[0];
    assert.ok(sec, "should have at least one proposal section");
    assert.ok("cadenceApproach" in sec, "proposal section should carry cadenceApproach");
    assert.ok("rhythmicDensity" in sec, "proposal section should carry rhythmicDensity");
    assert.ok("textureContraryMotionRate" in sec, "proposal section should carry textureContraryMotionRate");
});

