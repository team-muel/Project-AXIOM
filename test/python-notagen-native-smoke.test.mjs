// @ts-check
/**
 * python-notagen-native-smoke.test.mjs  (PNS-01 … PNS-07)
 *
 * Real end-to-end smoke test for the full NotaGen native inference pipeline:
 *
 *   worker (compose_learned_symbolic.py)
 *     → notagen_backend.NotagenBackend.generate()
 *       → _run_local_inference()
 *         → notagen_engines.load_engine_model()   [notagen_native]
 *         → notagen_engines.run_engine_generate()
 *           → notagen_native._run_generation_loop()
 *         → run_abc_projection_pipeline()
 *           → ABC → section events → MIDI
 *     → JSON result on stdout
 *
 * SKIP conditions (all checked before any test runs):
 *   - Python not found in PATH / .venv
 *   - torch not importable (pip install torch)
 *   - music21 not importable (pip install music21)
 *   - AXIOM_NOTAGEN_CHECKPOINT_PATH env var not set OR file not found
 *   - NOTAGEN_REPO_PATH env var not set OR directory not found
 *
 * When all conditions are met the tests run against the real model.
 * In CI without GPU/model the entire suite skips cleanly — no false failures.
 *
 * PNS-01  Environment pre-flight: checkpoint file + repo path exist
 * PNS-02  notagen_native engine loads without error (Python import + torch.load)
 * PNS-03  _run_local_inference() returns a non-empty string (raw ABC text)
 * PNS-04  Raw ABC contains mandatory X: header field
 * PNS-05  Full worker pipeline (compose_learned_symbolic.py) exits 0
 * PNS-06  Worker output ok === true
 * PNS-07  Worker output contains valid projection artefacts
 *         (proposalSections ≥ 1, noteCount > 0 OR proposalMidiPath present)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ─── Paths ────────────────────────────────────────────────────────────────────

const repoRoot   = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const workersDir = path.join(repoRoot, "workers", "composer");
const workerScript = path.join(workersDir, "compose_learned_symbolic.py");

// ─── Helper: detect Python binary ────────────────────────────────────────────

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

// ─── Helper: probe a Python import ───────────────────────────────────────────

function hasModule(modName) {
    if (!pythonBin) return false;
    const r = spawnSync(pythonBin, ["-c", `import ${modName}`], {
        encoding: "utf8",
        cwd: workersDir,
    });
    return r.status === 0;
}

// ─── Skip conditions ──────────────────────────────────────────────────────────

const checkpointPath = (
    process.env.AXIOM_NOTAGEN_CHECKPOINT_PATH ||
    (() => {
        // Try to read from .env file in repo root
        try {
            const envFile = fs.readFileSync(path.join(repoRoot, ".env"), "utf8");
            const m = envFile.match(/^AXIOM_NOTAGEN_CHECKPOINT_PATH\s*=\s*(.+)$/m);
            return m ? m[1].trim() : "";
        } catch {
            return "";
        }
    })()
).replace(/^["']|["']$/g, "").trim();

const notaGenRepoPath = (
    process.env.NOTAGEN_REPO_PATH ||
    (() => {
        try {
            const envFile = fs.readFileSync(path.join(repoRoot, ".env"), "utf8");
            const m = envFile.match(/^NOTAGEN_REPO_PATH\s*=\s*(.+)$/m);
            return m ? m[1].trim() : "";
        } catch {
            return "";
        }
    })()
).replace(/^["']|["']$/g, "").trim();

const deviceStr = (
    process.env.NOTAGEN_DEVICE ||
    (() => {
        try {
            const envFile = fs.readFileSync(path.join(repoRoot, ".env"), "utf8");
            const m = envFile.match(/^NOTAGEN_DEVICE\s*=\s*(.+)$/m);
            return m ? m[1].trim() : "cpu";
        } catch {
            return "cpu";
        }
    })()
).trim() || "cpu";

/** Reason to skip, or null if all conditions met. */
function skipReason() {
    if (!pythonBin)              return "Python not found in PATH or .venv";
    if (!hasModule("torch"))     return "torch not importable (pip install torch)";
    if (!hasModule("music21"))   return "music21 not importable (pip install music21)";
    if (!checkpointPath)         return "AXIOM_NOTAGEN_CHECKPOINT_PATH is not set";
    if (!fs.existsSync(checkpointPath))
        return `checkpoint file not found: ${checkpointPath}`;
    if (!notaGenRepoPath)        return "NOTAGEN_REPO_PATH is not set";
    if (!fs.existsSync(notaGenRepoPath))
        return `NOTAGEN_REPO_PATH directory not found: ${notaGenRepoPath}`;
    return null;
}

// ─── Shared env for all subprocess calls ─────────────────────────────────────

function buildEnv(extra = {}) {
    return {
        ...process.env,
        LEARNED_SYMBOLIC_BACKEND: "notagen_local",
        NOTAGEN_ENGINE: "notagen_native",
        AXIOM_NOTAGEN_CHECKPOINT_PATH: checkpointPath,
        NOTAGEN_REPO_PATH: notaGenRepoPath,
        NOTAGEN_DEVICE: deviceStr,
        // Enough tokens for a short smoke piece; tight enough to fail fast on real errors
        NOTAGEN_MAX_TOKENS: "8000",
        // 5 minutes — generous for CPU, quick for GPU
        NOTAGEN_TIMEOUT_MS: "300000",
        PYTHONPATH: workersDir,
        ...extra,
    };
}

// ─── Minimal fixture payload ──────────────────────────────────────────────────

const SMOKE_FIXTURE = {
    outputPath: "",          // filled in per-test with a tmpdir path
    stableSeed: 7,
    form: "miniature",
    compositionPlan: {
        form: "miniature",
        key: "D minor",
        tempo: 76,
        orchestration: {
            family: "string_trio",
            instrumentNames: ["Violin", "Viola", "Cello"],
        },
        sections: [
            {
                id: "theme",
                role: "theme_a",
                phraseFunction: "presentation",
                measures: 4,
                harmonicPlan: {},
            },
        ],
    },
    promptPack: {
        lane: "string_trio_symbolic",
        planSignature: "pns-smoke|form=miniature|key=dmin|inst=string_trio",
        styleCue: {
            period: "Romantic",
            composer: "Brahms, Johannes",
            form: "miniature",
            key: "D minor",
            meter: "4/4",
            tempo: 76,
        },
        instrumentation: [
            { name: "Violin", family: "strings", roles: ["lead"] },
            { name: "Viola",  family: "strings", roles: ["counterline"] },
            { name: "Cello",  family: "strings", roles: ["bass"] },
        ],
        sections: [
            {
                sectionId: "theme",
                role: "theme_a",
                phraseFunction: "presentation",
                measures: 4,
                harmonicPlan: {},
            },
        ],
    },
    providerRequest: {
        adapter: "notagen_class",
        version: "1.0.0",
        provider: "learned",
        model: "notagen-abc-v1",
        promptPackVersion: "1",
        planSignature: "pns-smoke|form=miniature|key=dmin|inst=string_trio",
        conditioningText: "X:1\nT:PNS Smoke\nM:4/4\nL:1/8\nK:Dm\n",
        controlLines: [
            "lane=string_trio_symbolic",
            "plan_signature=pns-smoke",
            "form=miniature",
            "key=Dm",
            "meter=4/4",
            "tempo=76",
            "period=Romantic",
            "composer=Brahms, Johannes",
            "instrumentation=Violin:lead,Viola:counterline,Cello:bass",
            "section id=theme role=theme_a phrase=presentation measures=4 motif_ref=none",
        ],
        lane: "string_trio_symbolic",
        warnings: [],
    },
};

// ─── PNS-01: Pre-flight ───────────────────────────────────────────────────────

test("PNS-01: environment pre-flight — checkpoint file and repo path exist", (t) => {
    const reason = skipReason();
    if (reason) {
        t.skip(`Pre-flight skip: ${reason}`);
        return;
    }
    assert.ok(fs.existsSync(checkpointPath),
        `Checkpoint must exist: ${checkpointPath}`);
    assert.ok(fs.existsSync(notaGenRepoPath),
        `NotaGen repo must exist: ${notaGenRepoPath}`);
    const stat = fs.statSync(checkpointPath);
    assert.ok(stat.size > 10 * 1024 * 1024,
        `Checkpoint file looks too small (${stat.size} bytes) — may be incomplete`);
});

// ─── PNS-02: Engine import + model load ──────────────────────────────────────

test("PNS-02: notagen_native engine loads model without error", (t) => {
    const reason = skipReason();
    if (reason) { t.skip(reason); return; }

    const script = `
import sys, os
sys.path.insert(0, r'${workersDir.replace(/\\/g, "\\\\")}')
sys.path.insert(0, os.path.join(r'${notaGenRepoPath.replace(/\\/g, "\\\\")}', 'gradio'))
from learned_symbolic.notagen_engines import notagen_native
model, patchilizer = notagen_native.load_model(
    r'${checkpointPath.replace(/\\/g, "\\\\")}', '', '${deviceStr}'
)
params = sum(p.numel() for p in model.parameters())
import json, sys
print(json.dumps({"ok": True, "params": params, "device": str(model.device)}))
`.trim();

    const result = spawnSync(pythonBin, ["-c", script], {
        encoding: "utf8",
        env: buildEnv(),
        timeout: 180_000,  // 3 min: cold model load can be slow
    });

    assert.strictEqual(result.status, 0,
        `Model load failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const out = JSON.parse(result.stdout.trim());
    assert.strictEqual(out.ok, true);
    assert.ok(out.params > 1_000_000,
        `Expected > 1M parameters, got ${out.params}`);
});

// ─── PNS-03: _run_local_inference returns ABC text ───────────────────────────

test("PNS-03: _run_local_inference() returns non-empty ABC text", (t) => {
    const reason = skipReason();
    if (reason) { t.skip(reason); return; }

    const abcHeader = [
        "%% axiom_form=miniature",
        "%% axiom_key=D minor",
        "%% axiom_instrumentation=string_trio",
        "%% axiom_period=Romantic",
        "%% axiom_composer=Brahms, Johannes",
    ].join("\n") + "\n";

    const script = `
import sys, os, json
sys.path.insert(0, r'${workersDir.replace(/\\/g, "\\\\")}')
sys.path.insert(0, os.path.join(r'${notaGenRepoPath.replace(/\\/g, "\\\\")}', 'gradio'))
os.environ['AXIOM_NOTAGEN_CHECKPOINT_PATH'] = r'${checkpointPath.replace(/\\/g, "\\\\")}' 
os.environ['NOTAGEN_ENGINE'] = 'notagen_native'
os.environ['NOTAGEN_DEVICE'] = '${deviceStr}'
os.environ['NOTAGEN_MAX_TOKENS'] = '8000'
os.environ['NOTAGEN_TIMEOUT_MS'] = '300000'
from learned_symbolic.notagen_backend import _run_local_inference
abc_text = _run_local_inference(${JSON.stringify(abcHeader)}, seed=7, temperature=1.0, top_k=9, top_p=0.9)
print(json.dumps({"ok": True, "length": len(abc_text), "preview": abc_text[:120]}))
`.trim();

    const result = spawnSync(pythonBin, ["-c", script], {
        encoding: "utf8",
        env: buildEnv(),
        timeout: 360_000,  // 6 min for CPU inference
    });

    assert.strictEqual(result.status, 0,
        `_run_local_inference failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const out = JSON.parse(result.stdout.trim());
    assert.strictEqual(out.ok, true);
    assert.ok(out.length > 50,
        `Expected ABC text > 50 chars, got ${out.length}. preview: ${out.preview}`);
});

// ─── PNS-04: ABC output contains X: header ───────────────────────────────────

test("PNS-04: generated ABC contains mandatory X: field", (t) => {
    const reason = skipReason();
    if (reason) { t.skip(reason); return; }

    const abcHeader = [
        "%% axiom_form=miniature",
        "%% axiom_key=D minor",
        "%% axiom_instrumentation=string_trio",
        "%% axiom_period=Romantic",
        "%% axiom_composer=Brahms, Johannes",
    ].join("\n") + "\n";

    const script = `
import sys, os, json
sys.path.insert(0, r'${workersDir.replace(/\\/g, "\\\\")}')
sys.path.insert(0, os.path.join(r'${notaGenRepoPath.replace(/\\/g, "\\\\")}', 'gradio'))
os.environ['AXIOM_NOTAGEN_CHECKPOINT_PATH'] = r'${checkpointPath.replace(/\\/g, "\\\\")}' 
os.environ['NOTAGEN_ENGINE'] = 'notagen_native'
os.environ['NOTAGEN_DEVICE'] = '${deviceStr}'
os.environ['NOTAGEN_MAX_TOKENS'] = '8000'
os.environ['NOTAGEN_TIMEOUT_MS'] = '300000'
from learned_symbolic.notagen_backend import _run_local_inference
abc_text = _run_local_inference(${JSON.stringify(abcHeader)}, seed=7, temperature=1.0, top_k=9, top_p=0.9)
has_x = any(line.startswith('X:') for line in abc_text.splitlines())
print(json.dumps({"has_x": has_x, "first_100": abc_text[:100]}))
`.trim();

    const result = spawnSync(pythonBin, ["-c", script], {
        encoding: "utf8",
        env: buildEnv(),
        timeout: 360_000,
    });

    assert.strictEqual(result.status, 0,
        `script failed:\n${result.stderr}`);

    const out = JSON.parse(result.stdout.trim());
    assert.ok(out.has_x,
        `ABC output must start with X: header. Got: ${out.first_100}`);
});

// ─── PNS-05: Full worker exits 0 ─────────────────────────────────────────────

test("PNS-05: compose_learned_symbolic.py worker exits 0 with notagen_native", (t) => {
    const reason = skipReason();
    if (reason) { t.skip(reason); return; }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-pns-"));
    const outputMidi = path.join(tmpDir, "smoke.mid");
    const fixture = { ...SMOKE_FIXTURE, outputPath: outputMidi };

    const result = spawnSync(pythonBin, [workerScript], {
        input: JSON.stringify(fixture),
        encoding: "utf8",
        cwd: workersDir,
        env: buildEnv(),
        timeout: 600_000,  // 10 min: full pipeline on CPU
    });

    assert.strictEqual(result.status, 0,
        `Worker exited non-zero:\nstdout: ${result.stdout.slice(0, 500)}\nstderr: ${result.stderr.slice(0, 500)}`);
});

// ─── PNS-06: ok === true ──────────────────────────────────────────────────────

test("PNS-06: worker output ok === true for notagen_native pipeline", (t) => {
    const reason = skipReason();
    if (reason) { t.skip(reason); return; }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-pns-"));
    const outputMidi = path.join(tmpDir, "smoke.mid");
    const fixture = { ...SMOKE_FIXTURE, outputPath: outputMidi };

    const result = spawnSync(pythonBin, [workerScript], {
        input: JSON.stringify(fixture),
        encoding: "utf8",
        cwd: workersDir,
        env: buildEnv(),
        timeout: 600_000,
    });

    assert.strictEqual(result.status, 0,
        `Worker crashed:\n${result.stderr.slice(0, 500)}`);

    let parsed;
    try {
        parsed = JSON.parse(result.stdout);
    } catch (e) {
        assert.fail(`Worker stdout is not valid JSON: ${result.stdout.slice(0, 300)}`);
    }

    assert.strictEqual(parsed.ok, true,
        `Expected ok=true, got: ${JSON.stringify(parsed).slice(0, 300)}`);
});

// ─── PNS-07: projection artefacts present ────────────────────────────────────

test("PNS-07: worker output contains projection artefacts (sections or MIDI)", (t) => {
    const reason = skipReason();
    if (reason) { t.skip(reason); return; }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-pns-"));
    const outputMidi = path.join(tmpDir, "smoke.mid");
    const fixture = { ...SMOKE_FIXTURE, outputPath: outputMidi };

    const result = spawnSync(pythonBin, [workerScript], {
        input: JSON.stringify(fixture),
        encoding: "utf8",
        cwd: workersDir,
        env: buildEnv(),
        timeout: 600_000,
    });

    if (result.status !== 0) {
        t.skip(`Worker non-zero (covered by PNS-05/06): ${result.stderr.slice(0, 200)}`);
        return;
    }

    const parsed = JSON.parse(result.stdout);
    if (!parsed.ok) {
        t.skip(`ok=false (covered by PNS-06): ${parsed.error}`);
        return;
    }

    // At least one of: proposalSections non-empty, noteCount > 0, proposalMidiPath set
    const hasSections = Array.isArray(parsed.proposalSections) && parsed.proposalSections.length > 0;
    const hasNotes    = typeof parsed.noteCount === "number" && parsed.noteCount > 0;
    const hasMidi     = typeof parsed.proposalMidiPath === "string" && parsed.proposalMidiPath.length > 0;

    assert.ok(hasSections || hasNotes || hasMidi,
        `Expected at least one projection artefact.\n` +
        `proposalSections=${JSON.stringify(parsed.proposalSections?.length)}, ` +
        `noteCount=${parsed.noteCount}, proposalMidiPath=${parsed.proposalMidiPath}`);

    // generationMode must reference notagen_native (not mock)
    const gm = parsed.proposalMetadata?.generationMode ?? "";
    assert.ok(
        gm.includes("notagen_native") || gm.includes("notagen_abc_inference"),
        `generationMode should indicate real NotaGen inference, got: ${gm}`
    );
});
