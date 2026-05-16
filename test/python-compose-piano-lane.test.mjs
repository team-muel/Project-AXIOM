// @ts-check
/**
 * Python compose worker piano-lane wiring tests.
 *
 * These tests exercise compose_learned_symbolic.build_response() directly with
 * a fake backend so the lane gate is verified without requiring music21 or a
 * local NotaGen model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const workersDir = path.join(repoRoot, "workers", "composer");

function detectPythonBin() {
    const candidates = [
        path.join(repoRoot, ".venv", "Scripts", "python.exe"),
        path.join(repoRoot, ".venv", "bin", "python"),
    ];
    const venvBin = candidates.find((candidate) => fs.existsSync(candidate));
    if (venvBin) return venvBin;
    for (const bin of ["python", "python3"]) {
        const probe = spawnSync(bin, ["--version"], { encoding: "utf8", shell: true });
        if (!probe.error && probe.status === 0) return bin;
    }
    return null;
}

const pythonBin = detectPythonBin();

function makePianoWorkerPayload(outputPath, overrides = {}) {
    const planSignature = "lane=solo_piano_symbolic|form=nocturne|key=fmin|inst=piano|sig=test";
    return {
        outputPath,
        form: "nocturne",
        key: "F minor",
        tempo: 72,
        promptPack: {
            version: "learned_symbolic_prompt_pack_v1",
            lane: "solo_piano_symbolic",
            planSignature,
            styleCue: {
                form: "nocturne",
                key: "F minor",
                meter: "6/8",
                tempo: 72,
            },
            instrumentation: [
                { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] },
            ],
            sections: [
                { sectionId: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.5, density: 0.4 },
            ],
            pianoPlan: {
                instrument: "Piano",
                difficultyTarget: "advanced",
                sections: [
                    {
                        sectionId: "s1",
                        textureKind: "melody_accompaniment",
                        rightHand: {
                            hand: "right",
                            primaryRoles: ["lead"],
                            registerMin: 60,
                            registerMax: 84,
                            maxComfortableSpan: 12,
                        },
                        leftHand: {
                            hand: "left",
                            primaryRoles: ["bass", "chordal_support"],
                            registerMin: 36,
                            registerMax: 60,
                            maxComfortableSpan: 12,
                        },
                        pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                        accompanimentPattern: "broken_chord",
                        difficultyTarget: "advanced",
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
            conditioningText:
                "Generate ABC notation for a Romantic piano nocturne in F minor, 6/8, 72 BPM.",
            controlLines: [
                "lane=solo_piano_symbolic",
                `plan_signature=${planSignature}`,
                "prompt_pack_version=learned_symbolic_prompt_pack_v1",
                "abc_format=interleaved",
                "form=nocturne",
                "key=Fmin",
                "meter=6/8",
                "tempo=72",
                "instrumentation=Piano:lead|chordal_support|bass",
                "difficulty=advanced",
                "piano_global texture=nocturne pedal=harmonic hand_crossing=false max_span=12",
                "section id=s1 role=theme_a label=Theme measures=4 motif_ref=none energy=0.5 density=0.4",
                "piano_section id=s1 texture=melody_accompaniment rh=lead lh=broken_chord pedal=harmonic density=medium",
            ],
        },
        compositionPlan: {
            form: "nocturne",
            key: "F minor",
            meter: "6/8",
            tempo: 72,
            instrumentation: [
                { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] },
            ],
            orchestration: { family: "solo_piano", instrumentNames: ["Piano"], sections: [] },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme", measures: 4, energy: 0.5, density: 0.4 },
            ],
            pianoPlan: {
                instrument: "Piano",
                difficultyTarget: "advanced",
                sections: [
                    {
                        sectionId: "s1",
                        textureKind: "melody_accompaniment",
                        rightHand: {
                            hand: "right",
                            primaryRoles: ["lead"],
                            registerMin: 60,
                            registerMax: 84,
                            maxComfortableSpan: 12,
                        },
                        leftHand: {
                            hand: "left",
                            primaryRoles: ["bass", "chordal_support"],
                            registerMin: 36,
                            registerMax: 60,
                            maxComfortableSpan: 12,
                        },
                        pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                        accompanimentPattern: "broken_chord",
                        difficultyTarget: "advanced",
                    },
                ],
            },
        },
        ...overrides,
    };
}

function runBuildResponse(payload) {
    if (!pythonBin) {
        throw new Error("Python not found");
    }
    const script = `
import json
import sys

sys.path.insert(0, "workers/composer")

import compose_learned_symbolic as worker
from learned_symbolic.backends import LearnedSymbolicBackendResult

class FakeBackend:
    def generate(self, payload, context):
        return LearnedSymbolicBackendResult(
            ok=True,
            provider="test",
            model="fake-piano",
            generation_mode="fake_backend",
            confidence=0.9,
            abc_text="X:1\\nT:Fake\\nM:6/8\\nL:1/8\\nK:Fmin\\nC2 C2 C2 |\\n",
            midi_path=payload.get("outputPath"),
            proposal_sections=[{"sectionId": "s1", "measureCount": 4, "noteHistory": [1, 2, 3]}],
            warnings=[],
            note_count=3,
            measure_count=4,
            key_name="F minor",
            form="nocturne",
            tempo_bpm=72,
        )

worker.select_backend = lambda payload: FakeBackend()
print(json.dumps(worker.build_response(json.loads(sys.stdin.read()))))
`;
    const result = spawnSync(pythonBin, ["-c", script], {
        cwd: repoRoot,
        input: JSON.stringify(payload),
        encoding: "utf8",
    });
    if (result.error) throw result.error;
    assert.equal(
        result.status,
        0,
        `python build_response failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    return JSON.parse(result.stdout.trim());
}

test("compose_learned_symbolic: solo_piano_symbolic reaches backend when PianoPlan is present", (t) => {
    if (!pythonBin) { t.skip("Python not found"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-piano-worker-"));
    try {
        const response = runBuildResponse(makePianoWorkerPayload(path.join(tmpDir, "piano.mid")));
        assert.equal(response.ok, true, JSON.stringify(response));
        assert.equal(response.proposalMetadata?.lane, "solo_piano_symbolic");
        assert.equal(response.proposalSummary?.partCount, 1);
        assert.deepEqual(response.proposalSummary?.partInstrumentNames, ["Piano"]);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("compose_learned_symbolic: solo_piano_symbolic rejects Piano instrumentation without PianoPlan", (t) => {
    if (!pythonBin) { t.skip("Python not found"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-piano-worker-"));
    try {
        const payload = makePianoWorkerPayload(path.join(tmpDir, "piano.mid"));
        delete payload.compositionPlan.pianoPlan;
        const response = runBuildResponse(payload);
        assert.equal(response.ok, false, JSON.stringify(response));
        assert.match(response.error, /pianoPlan/i);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
