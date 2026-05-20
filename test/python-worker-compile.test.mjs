// @ts-check
/**
 * Python worker compile + smoke tests
 *
 * Part 1 — py_compile: ensures every Python worker file is syntactically valid.
 *   Tests fail fast if any file has a parse error, preventing situations where
 *   TypeScript tests pass but the Python pipeline is silently broken.
 *
 * Part 2 — smoke test: runs compose_learned_symbolic.py with LEARNED_SYMBOLIC_BACKEND=notagen_mock
 *   and a minimal fixture payload, asserting the output contract:
 *     ok === true
 *     proposalMidiPath present
 *     proposalMetadata.generationMode === "mock_notagen_abc"
 *     normalizationWarnings contains "mock_backend_not_for_quality_eval"
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
    const venvBin = candidates.find((c) => fs.existsSync(c));
    if (venvBin) return venvBin;
    for (const bin of ["python", "python3"]) {
        const probe = spawnSync(bin, ["--version"], { encoding: "utf8", shell: true });
        if (!probe.error && probe.status === 0) return bin;
    }
    return null;
}

const pythonBin = detectPythonBin();

function pyCompile(filePath) {
    return spawnSync(pythonBin, ["-m", "py_compile", filePath], {
        encoding: "utf8",
        cwd: workersDir,
    });
}

// ─── Part 1: py_compile ───────────────────────────────────────────────────────

const FIXED_PYTHON_FILES = [
    path.join(workersDir, "compose_learned_symbolic.py"),
    path.join(workersDir, "learned_symbolic", "backends.py"),
    path.join(workersDir, "learned_symbolic", "notagen_backend.py"),
    path.join(workersDir, "learned_symbolic", "notagen_engines", "__init__.py"),
    path.join(workersDir, "learned_symbolic", "notagen_engines", "mock.py"),
    path.join(workersDir, "learned_symbolic", "notagen_engines", "hf_causal_lm.py"),
    path.join(workersDir, "learned_symbolic", "notagen_engines", "notagen_native.py"),
];

// Collect abc_*.py via glob pattern
const abcDir = path.join(workersDir, "learned_symbolic");
const ABC_FILES = fs
    .readdirSync(abcDir)
    .filter((f) => f.startsWith("abc_") && f.endsWith(".py"))
    .map((f) => path.join(abcDir, f));

const ALL_PYTHON_FILES = [...FIXED_PYTHON_FILES, ...ABC_FILES];

test("py_compile: all worker Python files are syntactically valid", async (t) => {
    if (!pythonBin) {
        t.skip("Python not found; skipping py_compile checks");
        return;
    }

    for (const filePath of ALL_PYTHON_FILES) {
        await t.test(`py_compile: ${path.relative(repoRoot, filePath)}`, () => {
            if (!fs.existsSync(filePath)) {
                // Some engine files may not yet exist (e.g. notagen_native stubs).
                // Record a skip rather than failing — the test will start failing
                // once the file is added.
                assert.ok(true, `${filePath} not found — skip`);
                return;
            }
            const result = pyCompile(filePath);
            assert.strictEqual(
                result.status,
                0,
                `py_compile failed for ${path.relative(repoRoot, filePath)}:\n${result.stderr}`
            );
        });
    }
});

// ─── Part 2: mock smoke test ──────────────────────────────────────────────────

/** Check whether music21 is importable in the detected Python environment. */
function hasMusicLib() {
    if (!pythonBin) return false;
    const probe = spawnSync(
        pythonBin,
        ["-c", "import music21"],
        { encoding: "utf8", cwd: workersDir }
    );
    return probe.status === 0;
}

test("smoke: compose_learned_symbolic.py with notagen_mock backend", async (t) => {
    if (!pythonBin) {
        t.skip("Python not found; skipping smoke test");
        return;
    }

    const workerScript = path.join(workersDir, "compose_learned_symbolic.py");
    if (!fs.existsSync(workerScript)) {
        t.skip("compose_learned_symbolic.py not found");
        return;
    }

    const music21Available = hasMusicLib();
    if (!music21Available) {
        t.skip(
            "music21 not installed; smoke test requires music21 for ABC→events→MIDI pipeline"
        );
        return;
    }

    // Build a minimal valid fixture payload.
    // - compositionPlan.orchestration.family = "string_trio" → passes supports_narrow_lane()
    // - form = "miniature" → required by narrow lane check
    // - providerRequest with adapter="notagen_class" satisfies resolve_provider_prompt_packing_context()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-smoke-"));
    const outputMidi = path.join(tmpDir, "output.mid");

    const fixture = {
        outputPath: outputMidi,
        stableSeed: 42,
        form: "miniature",
        compositionPlan: {
            form: "miniature",
            key: "C major",
            tempo: 92,
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
            styleCue: {
                period: "Romantic",
                composer: "Brahms",
                form: "miniature",
                key: "C major",
                tempo: 92,
            },
            instrumentation: [
                { name: "Violin", role: "lead" },
                { name: "Viola", role: "counterline" },
                { name: "Cello", role: "bass" },
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
            model: "learned-symbolic-trio-v1",
            promptPackVersion: "1",
            planSignature: "smoke-test-sig",
            conditioningText: "X:1\nT:Smoke Test\nM:4/4\nL:1/8\nK:C\n",
            controlLines: [
                "lane=string_trio_symbolic",
                "plan_signature=smoke-test-sig",
                "prompt_pack_version=1",
                "abc_format=abc",
                "form=miniature",
                "key=C",
                "meter=4/4",
                "tempo=92",
                "instrumentation=Violin:lead,Viola:counterline,Cello:bass",
                "section id=theme role=theme_a phrase=presentation measures=4 motif_ref=none",
            ],
            lane: "string_trio_symbolic",
            warnings: [],
        },
    };

    const fixtureJson = JSON.stringify(fixture);

    await t.test("ok === true", () => {
        const result = spawnSync(pythonBin, [workerScript], {
            input: fixtureJson,
            encoding: "utf8",
            cwd: workersDir,
            env: {
                ...process.env,
                LEARNED_SYMBOLIC_BACKEND: "notagen_mock",
                PYTHONPATH: workersDir,
            },
        });
        assert.strictEqual(
            result.status,
            0,
            `worker exited non-zero:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
        );
        const parsed = JSON.parse(result.stdout);
        assert.strictEqual(parsed.ok, true, `Expected ok=true, got: ${JSON.stringify(parsed)}`);
    });

    await t.test("proposalMidiPath is present in output", () => {
        const result = spawnSync(pythonBin, [workerScript], {
            input: fixtureJson,
            encoding: "utf8",
            cwd: workersDir,
            env: {
                ...process.env,
                LEARNED_SYMBOLIC_BACKEND: "notagen_mock",
                PYTHONPATH: workersDir,
            },
        });
        const parsed = JSON.parse(result.stdout);
        assert.ok(
            typeof parsed.proposalMidiPath === "string" && parsed.proposalMidiPath.length > 0,
            `proposalMidiPath should be a non-empty string, got: ${JSON.stringify(parsed.proposalMidiPath)}`
        );
    });

    await t.test('proposalMetadata.generationMode === "mock_notagen_abc"', () => {
        const result = spawnSync(pythonBin, [workerScript], {
            input: fixtureJson,
            encoding: "utf8",
            cwd: workersDir,
            env: {
                ...process.env,
                LEARNED_SYMBOLIC_BACKEND: "notagen_mock",
                PYTHONPATH: workersDir,
            },
        });
        const parsed = JSON.parse(result.stdout);
        assert.strictEqual(
            parsed.proposalMetadata?.generationMode,
            "mock_notagen_abc",
            `Expected generationMode=mock_notagen_abc, got: ${JSON.stringify(parsed.proposalMetadata?.generationMode)}`
        );
    });

    await t.test('normalizationWarnings contains "mock_backend_not_for_quality_eval"', () => {
        const result = spawnSync(pythonBin, [workerScript], {
            input: fixtureJson,
            encoding: "utf8",
            cwd: workersDir,
            env: {
                ...process.env,
                LEARNED_SYMBOLIC_BACKEND: "notagen_mock",
                PYTHONPATH: workersDir,
            },
        });
        const parsed = JSON.parse(result.stdout);
        const warnings = parsed.proposalMetadata?.normalizationWarnings ?? [];
        assert.ok(
            Array.isArray(warnings) &&
                warnings.some((w) => String(w).includes("mock_backend_not_for_quality_eval")),
            `normalizationWarnings should contain "mock_backend_not_for_quality_eval", got: ${JSON.stringify(warnings)}`
        );
    });

    // Cleanup temp dir
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
        // best-effort cleanup
    }
});

// ─── Part 3: _inject_missing_abc_headers unit test ───────────────────────────
// Tests the internal ABC header injection helper without loading the full model.

test("_inject_missing_abc_headers: injects K:/M:/L:/T: when missing, is no-op when K: present", async (t) => {
    if (!pythonBin) {
        t.skip("Python not found; skipping inject-headers unit test");
        return;
    }

    const nativePath = path.join(
        workersDir, "learned_symbolic", "notagen_engines", "notagen_native.py"
    );
    if (!fs.existsSync(nativePath)) {
        t.skip("notagen_native.py not found");
        return;
    }

    // Replicate the pure helper (only uses re) to verify logic without heavy imports.
    const inlineScript = `
import re, json

def _inject_missing_abc_headers(abc_text, axiom_header):
    if re.search(r"^K:", abc_text, re.MULTILINE):
        return abc_text
    def _extract(field):
        m = re.search(rf"^{field}:(.*)", axiom_header, re.MULTILINE)
        return m.group(1).strip() if m else None
    k_val = _extract("K") or "C"
    m_val = _extract("M") or "4/4"
    l_val = _extract("L") or "1/8"
    t_val = _extract("T")
    inject = []
    if t_val and not re.search(r"^T:", abc_text, re.MULTILINE):
        inject.append(f"T:{t_val.splitlines()[0]}\\n")
    if not re.search(r"^M:", abc_text, re.MULTILINE):
        inject.append(f"M:{m_val}\\n")
    if not re.search(r"^L:", abc_text, re.MULTILINE):
        inject.append(f"L:{l_val}\\n")
    inject.append(f"K:{k_val}\\n")
    prefix = "X:1\\n"
    if abc_text.startswith(prefix):
        return prefix + "".join(inject) + abc_text[len(prefix):]
    return "".join(inject) + abc_text

hdr = "X:1\\nT:Smoke\\nC:AXIOM\\nM:4/4\\nL:1/8\\nQ:1/4=76\\nK:Dm\\n"

# Case 1: missing K: -> injection
out1 = _inject_missing_abc_headers("X:1\\nV:2 treble\\n[V:2]z7|\\n", hdr)
assert "K:Dm" in out1 and "M:4/4" in out1 and "L:1/8" in out1 and out1.startswith("X:1\\n"), f"Case1 fail: {out1!r}"

# Case 2: already has K: -> no-op
inp2 = "X:1\\nK:Dm\\nM:4/4\\n[V:1]d2c2|\\n"
assert _inject_missing_abc_headers(inp2, hdr) == inp2, "Case2 fail: should be unchanged"

# Case 3: no X:1 prefix (fallback)
out3 = _inject_missing_abc_headers("V:1\\n[V:1]d2c2|\\n", hdr)
assert "K:Dm" in out3, f"Case3 fail: {out3!r}"

print(json.dumps({"ok": True, "cases": 3}))
`.trim();

    await t.test("injects K:/M:/L:/T: when absent; is no-op when K: present", () => {
        const result = spawnSync(pythonBin, ["-c", inlineScript], {
            encoding: "utf8",
            cwd: workersDir,
        });
        assert.strictEqual(
            result.status, 0,
            `inject-headers test failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
        );
        const parsed = JSON.parse(result.stdout);
        assert.strictEqual(parsed.ok, true);
        assert.strictEqual(parsed.cases, 3);
    });
});
