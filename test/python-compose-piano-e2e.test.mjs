// @ts-check
/**
 * End-to-end piano generation test.
 *
 * Uses LEARNED_SYMBOLIC_BACKEND=notagen_mock to drive the full Python pipeline:
 *   compose_learned_symbolic.py
 *     → NotagenBackend._generate_mock()
 *       → build_mock_abc() [piano single-voice 4/4 ABC]
 *         → run_abc_projection_pipeline(lane="solo_piano_symbolic")
 *           → enrich_proposal_sections_with_piano_layout()
 *           → repair_piano_sections()
 *           → compute_piano_voice_layout_summary()
 *
 * Expected response fields:
 *   ok === true
 *   proposalMetadata.lane === "solo_piano_symbolic"
 *   proposalAbcScore  (string)
 *   proposalMidiPath  (string)
 *   proposalSections[0].pianoVoiceLayout  (object)
 *   proposalVoiceLayoutSummary.pianoPlayabilityScore  (number)
 *   proposalVoiceLayoutSummary.playableSpanFit  (number)
 *
 * Tests are skipped when Python is unavailable or when music21 is not
 * installed (music21 is required by abc_to_events.convert()).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ─── Python detection ─────────────────────────────────────────────────────────

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

function isMusic21Available() {
    if (!pythonBin) return false;
    const probe = spawnSync(pythonBin, ["-c", "import music21"], {
        encoding: "utf8",
        cwd: repoRoot,
    });
    return !probe.error && probe.status === 0;
}

const music21Available = isMusic21Available();

// ─── Piano payload builder ────────────────────────────────────────────────────

function makePianoE2EPayload(outputPath) {
    const planSignature = "lane=solo_piano_symbolic|form=nocturne|key=cmin|inst=piano|e2e=1";
    return {
        outputPath,
        form: "nocturne",
        key: "C minor",
        tempo: 80,
        stableSeed: 7,
        candidateIndex: 0,
        promptPack: {
            version: "learned_symbolic_prompt_pack_v1",
            lane: "solo_piano_symbolic",
            planSignature,
            styleCue: { form: "nocturne", key: "C minor", meter: "4/4", tempo: 80 },
            instrumentation: [
                { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] },
            ],
            sections: [
                { sectionId: "s1", role: "theme_a", label: "A", measures: 4, energy: 0.5, density: 0.4 },
            ],
            pianoPlan: {
                instrument: "Piano",
                difficultyTarget: "intermediate",
                sections: [
                    {
                        sectionId: "s1",
                        textureKind: "melody_accompaniment",
                        rightHand: { hand: "right", primaryRoles: ["lead"], registerMin: 60, registerMax: 84, maxComfortableSpan: 12 },
                        leftHand: { hand: "left", primaryRoles: ["bass"], registerMin: 36, registerMax: 60, maxComfortableSpan: 12 },
                        pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                        accompanimentPattern: "broken_chord",
                        difficultyTarget: "intermediate",
                    },
                ],
            },
        },
        providerRequest: {
            adapter: "notagen_class",
            version: "learned_notagen_adapter_v1",
            provider: "learned",
            model: "learned-symbolic-piano-v1",
            promptPackVersion: "learned_symbolic_prompt_pack_v1",
            planSignature,
            conditioningText: "Generate ABC notation for a Romantic piano nocturne in C minor.",
            controlLines: [
                "lane=solo_piano_symbolic",
                `plan_signature=${planSignature}`,
                "abc_format=interleaved",
                "form=nocturne",
                "key=Cmin",
                "meter=4/4",
                "tempo=80",
                "instrumentation=Piano:lead|chordal_support|bass",
                "difficulty=intermediate",
                "section id=s1 role=theme_a label=A measures=4 energy=0.5 density=0.4",
                "piano_section id=s1 texture=melody_accompaniment rh=lead lh=broken_chord pedal=harmonic density=medium",
            ],
        },
        compositionPlan: {
            form: "nocturne",
            key: "C minor",
            meter: "4/4",
            tempo: 80,
            instrumentation: [
                { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] },
            ],
            orchestration: { family: "solo_piano", instrumentNames: ["Piano"], sections: [] },
            sections: [
                { id: "s1", role: "theme_a", label: "A", measures: 4, energy: 0.5, density: 0.4 },
            ],
            pianoPlan: {
                instrument: "Piano",
                difficultyTarget: "intermediate",
                sections: [
                    {
                        sectionId: "s1",
                        textureKind: "melody_accompaniment",
                        rightHand: { hand: "right", primaryRoles: ["lead"], registerMin: 60, registerMax: 84, maxComfortableSpan: 12 },
                        leftHand: { hand: "left", primaryRoles: ["bass"], registerMin: 36, registerMax: 60, maxComfortableSpan: 12 },
                        pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                        accompanimentPattern: "broken_chord",
                        difficultyTarget: "intermediate",
                    },
                ],
            },
        },
    };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

function runE2EPipeline(payload) {
    if (!pythonBin) throw new Error("Python not found");
    const result = spawnSync(
        pythonBin,
        ["-m", "compose_learned_symbolic"],
        {
            cwd: path.join(repoRoot, "workers", "composer"),
            input: JSON.stringify(payload),
            encoding: "utf8",
            env: {
                ...process.env,
                LEARNED_SYMBOLIC_BACKEND: "notagen_mock",
                PYTHONPATH: path.join(repoRoot, "workers", "composer"),
            },
        },
    );
    if (result.error) throw result.error;
    assert.equal(
        result.status,
        0,
        `compose_learned_symbolic exited non-zero\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    const trimmed = result.stdout.trim();
    assert.ok(trimmed.length > 0, `Empty stdout from compose_learned_symbolic\nstderr: ${result.stderr}`);
    return JSON.parse(trimmed);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("piano E2E: lane routing — solo_piano_symbolic lane is accepted", (t) => {
    if (!pythonBin) { t.skip("Python not found"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-piano-e2e-"));
    try {
        const payload = makePianoE2EPayload(path.join(tmpDir, "out.mid"));
        // Use a fake backend to skip music21 dependency for routing-only test
        const script = `
import json, sys
sys.path.insert(0, "workers/composer")
import compose_learned_symbolic as worker
from learned_symbolic.backends import LearnedSymbolicBackendResult

class FakeBackend:
    def generate(self, payload, context):
        return LearnedSymbolicBackendResult(
            ok=True, provider="test", model="fake", generation_mode="fake",
            confidence=0.9, midi_path=payload.get("outputPath"),
            proposal_sections=[{"sectionId": "s1", "measureCount": 4, "noteHistory": [60, 62]}],
            warnings=[], note_count=2, measure_count=4,
            key_name="C minor", form="nocturne", tempo_bpm=80,
        )

worker.select_backend = lambda payload: FakeBackend()
print(json.dumps(worker.build_response(json.loads(sys.stdin.read()))))
`;
        const result = spawnSync(pythonBin, ["-c", script], {
            cwd: repoRoot,
            input: JSON.stringify(payload),
            encoding: "utf8",
        });
        assert.equal(result.status, 0, `stderr: ${result.stderr}`);
        const response = JSON.parse(result.stdout.trim());
        assert.equal(response.ok, true, JSON.stringify(response));
        assert.equal(response.proposalMetadata?.lane, "solo_piano_symbolic");
        assert.equal(response.proposalSummary?.partCount, 1);
        assert.deepEqual(response.proposalSummary?.partInstrumentNames, ["Piano"]);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("piano E2E: notagen_mock — full pipeline produces pianoVoiceLayout and pianoPlayabilityScore", (t) => {
    if (!pythonBin) { t.skip("Python not found"); return; }
    if (!music21Available) { t.skip("music21 not installed; skipping full ABC projection test"); return; }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-piano-e2e-full-"));
    try {
        const payload = makePianoE2EPayload(path.join(tmpDir, "out.mid"));
        const response = runE2EPipeline(payload);

        // Core success
        assert.equal(response.ok, true, `Pipeline failed: ${JSON.stringify(response)}`);
        assert.equal(response.proposalMetadata?.lane, "solo_piano_symbolic");
        assert.equal(response.proposalMetadata?.generationMode, "mock_notagen_abc");

        // ABC score text is preserved for SFT dataset
        assert.ok(
            typeof response.proposalAbcScore === "string" && response.proposalAbcScore.length > 0,
            "proposalAbcScore should be a non-empty string",
        );

        // MIDI path should be written
        assert.ok(
            typeof response.proposalMidiPath === "string" && response.proposalMidiPath.length > 0,
            "proposalMidiPath should be a non-empty string",
        );
        assert.ok(
            fs.existsSync(response.proposalMidiPath),
            `MIDI file should exist at: ${response.proposalMidiPath}`,
        );

        // Sections must be present
        assert.ok(
            Array.isArray(response.proposalSections) && response.proposalSections.length > 0,
            "proposalSections should be a non-empty array",
        );

        // Each section must have pianoVoiceLayout (added by piano projection stage)
        for (const sec of response.proposalSections) {
            assert.ok(
                sec.pianoVoiceLayout != null && typeof sec.pianoVoiceLayout === "object",
                `Section ${sec.sectionId} is missing pianoVoiceLayout`,
            );
        }

        // Global voice layout summary with playability scores
        const vls = response.proposalVoiceLayoutSummary;
        assert.ok(vls != null && typeof vls === "object", "proposalVoiceLayoutSummary should be present");
        assert.ok(
            typeof vls.playableSpanFit === "number",
            "proposalVoiceLayoutSummary.playableSpanFit should be a number",
        );
        assert.ok(
            typeof vls.pianoPlayabilityScore === "number",
            "proposalVoiceLayoutSummary.pianoPlayabilityScore should be a number",
        );
        assert.ok(
            vls.pianoPlayabilityScore >= 0 && vls.pianoPlayabilityScore <= 1,
            `pianoPlayabilityScore out of range: ${vls.pianoPlayabilityScore}`,
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("piano E2E: notagen_mock — mock is tagged to prevent quality dataset leakage", (t) => {
    if (!pythonBin) { t.skip("Python not found"); return; }
    if (!music21Available) { t.skip("music21 not installed"); return; }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-piano-e2e-tag-"));
    try {
        const payload = makePianoE2EPayload(path.join(tmpDir, "out.mid"));
        const response = runE2EPipeline(payload);

        assert.equal(response.ok, true, JSON.stringify(response));
        const warnings = response.proposalMetadata?.normalizationWarnings ?? [];
        assert.ok(
            Array.isArray(warnings) && warnings.includes("mock_backend_not_for_quality_eval"),
            `Expected mock_backend_not_for_quality_eval in warnings: ${JSON.stringify(warnings)}`,
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("piano E2E: notagen_mock — piano summary reports partCount=1 and Piano instrument", (t) => {
    if (!pythonBin) { t.skip("Python not found"); return; }
    if (!music21Available) { t.skip("music21 not installed"); return; }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-piano-e2e-summary-"));
    try {
        const payload = makePianoE2EPayload(path.join(tmpDir, "out.mid"));
        const response = runE2EPipeline(payload);

        assert.equal(response.ok, true, JSON.stringify(response));
        assert.equal(response.proposalSummary?.partCount, 1);
        assert.deepEqual(response.proposalSummary?.partInstrumentNames, ["Piano"]);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("piano E2E: rejects solo_piano_symbolic when pianoPlan is absent", (t) => {
    if (!pythonBin) { t.skip("Python not found"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-piano-e2e-reject-"));
    try {
        const payload = makePianoE2EPayload(path.join(tmpDir, "out.mid"));
        delete payload.compositionPlan.pianoPlan;
        const script = `
import json, sys
sys.path.insert(0, "workers/composer")
import compose_learned_symbolic as worker
print(json.dumps(worker.build_response(json.loads(sys.stdin.read()))))
`;
        const result = spawnSync(pythonBin, ["-c", script], {
            cwd: repoRoot,
            input: JSON.stringify(payload),
            encoding: "utf8",
            env: { ...process.env, LEARNED_SYMBOLIC_BACKEND: "notagen_mock" },
        });
        assert.equal(result.status, 0, `stderr: ${result.stderr}`);
        const response = JSON.parse(result.stdout.trim());
        assert.equal(response.ok, false, JSON.stringify(response));
        assert.match(response.error, /pianoPlan/i);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
