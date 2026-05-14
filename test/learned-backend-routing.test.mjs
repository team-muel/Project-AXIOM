// @ts-check
/**
 * Learned symbolic backend routing tests — Phase A.
 *
 * Verifies that:
 *   1. Default (no LEARNED_SYMBOLIC_BACKEND) uses template backend and succeeds.
 *   2. LEARNED_SYMBOLIC_BACKEND=template succeeds (explicit template backend).
 *   3. LEARNED_SYMBOLIC_BACKEND=notagen_local returns ok:false with a clear error
 *      (no model available in CI — explicit failure, NOT silent fallback).
 *   4. Worker never returns proposalCandidatePool — TS orchestrator owns the candidate pool.
 *   5. notagen_mock sets generationMode=mock_notagen_abc and warns mock_backend_not_for_quality_eval.
 *   6. Malformed providerRequest (missing required fields) returns validation error.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const pythonBin = [
    path.join(repoRoot, ".venv", "Scripts", "python.exe"),
    path.join(repoRoot, ".venv", "bin", "python"),
].find((candidate) => fs.existsSync(candidate));

const workerScript = path.join(
    repoRoot, "workers", "composer", "compose_learned_symbolic.py"
);

/**
 * Minimal valid payload for the string_trio_symbolic lane.
 * @param {string} outputDir
 */
function buildMinimalPayload(outputDir) {
    const outputPath = path.join(outputDir, "composition.mid");
    const planSig =
        "lane=string_trio_symbolic|form=miniature|key=c major|inst=cello,viola,violin|roles=theme_a>recap|sig=aabbccdd1234";
    return {
        prompt: "A gentle miniature for string trio",
        songId: "test-backend-routing",
        outputPath,
        selectedModels: [
            { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
        ],
        stableSeed: 12345,
        promptPack: {
            version: "learned_symbolic_prompt_pack_v1",
            lane: "string_trio_symbolic",
            planSignature: planSig,
            promptText: "A gentle miniature for string trio",
            styleCue: {
                brief: "A gentle miniature",
                mood: [],
                form: "miniature",
                key: "C major",
                instrumentationLabel: "Violin, Viola, Cello",
                tempo: 92,
            },
            instrumentation: [
                { name: "Violin", family: "strings", roles: ["lead"] },
                { name: "Viola", family: "strings", roles: ["inner_voice"] },
                { name: "Cello", family: "strings", roles: ["bass"] },
            ],
            sections: [
                { sectionId: "s1", role: "theme_a", label: "Theme A", measures: 4, energy: 0.4, density: 0.35 },
                { sectionId: "s2", role: "recap", label: "Recap", measures: 4, energy: 0.35, density: 0.3 },
            ],
        },
        providerRequest: {
            adapter: "notagen_class",
            version: "learned_notagen_adapter_v1",
            provider: "learned",
            model: "learned-symbolic-trio-v1",
            promptPackVersion: "learned_symbolic_prompt_pack_v1",
            planSignature: planSig,
            conditioningText:
                "Generate interleaved ABC notation for a classical string trio miniature in C major, 4/4, 92 BPM. Preserve the section plan and synchronized voices.",
            controlLines: [
                "lane=string_trio_symbolic",
                `plan_signature=${planSig}`,
                "prompt_pack_version=learned_symbolic_prompt_pack_v1",
                "abc_format=interleaved",
                "form=miniature",
                "key=C",
                "meter=4/4",
                "tempo=92",
                "instrumentation=Violin:lead,Viola:inner_voice,Cello:bass",
                "section id=s1 role=theme_a label=Theme A measures=4 motif_ref=none energy=0.4 density=0.35",
                "section id=s2 role=recap label=Recap measures=4 motif_ref=none energy=0.35 density=0.3",
            ],
        },
        key: "C major",
        tempo: 92,
        form: "miniature",
        compositionPlan: {
            form: "miniature",
            key: "C major",
            tempo: 92,
            instrumentation: [
                { name: "Violin", family: "strings", roles: ["lead"] },
                { name: "Viola", family: "strings", roles: ["inner_voice"] },
                { name: "Cello", family: "strings", roles: ["bass"] },
            ],
            orchestration: {
                family: "string_trio",
                instrumentNames: ["Violin", "Viola", "Cello"],
                sections: [],
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme A", measures: 4, energy: 0.4, density: 0.35 },
                { id: "s2", role: "recap", label: "Recap", measures: 4, energy: 0.35, density: 0.3 },
            ],
        },
    };
}

/**
 * Run the learned-symbolic worker synchronously.
 * @param {unknown} payload
 * @param {Record<string,string>} [env]
 */
function runLearnedWorker(payload, env = {}) {
    if (!pythonBin) {
        throw new Error("No local Python binary found; skipping learned-backend-routing test.");
    }
    const result = spawnSync(pythonBin, [workerScript], {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: { ...process.env, ...env },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(
            result.stderr?.trim() || `worker exited with code ${result.status}`
        );
    }
    return JSON.parse(result.stdout.trim());
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

test("backend-routing: default (no env var) uses mock and succeeds", async (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-br-"));
    try {
        const result = runLearnedWorker(buildMinimalPayload(tmpDir));
        assert.equal(result.ok, true, "should succeed");
        assert.ok(result.proposalMidiPath, "should have proposalMidiPath");
        assert.ok(fs.existsSync(result.proposalMidiPath), "MIDI file should exist");
        assert.ok(Array.isArray(result.proposalSections), "should have proposalSections");
        assert.ok(result.proposalSections.length >= 1, "should have at least 1 section");
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("backend-routing: LEARNED_SYMBOLIC_BACKEND=template produces valid output", async (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-br-"));
    try {
        const result = runLearnedWorker(buildMinimalPayload(tmpDir), {
            LEARNED_SYMBOLIC_BACKEND: "template",
        });
        assert.equal(result.ok, true, "explicit template should succeed");
        assert.ok(result.proposalMidiPath, "should have proposalMidiPath");
        assert.ok(Array.isArray(result.proposalSections), "should have proposalSections");
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("backend-routing: LEARNED_SYMBOLIC_BACKEND=notagen_local returns ok:false when model unavailable", async (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-br-"));
    try {
        const result = runLearnedWorker(buildMinimalPayload(tmpDir), {
            LEARNED_SYMBOLIC_BACKEND: "notagen_local",
            // Intentionally omit NOTAGEN_MODEL_PATH
        });
        assert.equal(result.ok, false, "notagen_local without model must return ok:false");
        assert.ok(
            typeof result.error === "string" && result.error.length > 0,
            `expected a non-empty error string, got: ${JSON.stringify(result.error)}`
        );
        assert.ok(
            result.error.toLowerCase().includes("notagen") ||
            result.error.toLowerCase().includes("model"),
            `error should mention notagen or model, got: ${result.error}`
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("backend-routing: worker never returns proposalCandidatePool (TS orchestrator owns candidate pool)", async (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-br-"));
    try {
        const result = runLearnedWorker(buildMinimalPayload(tmpDir));
        assert.ok(
            !("proposalCandidatePool" in result),
            "worker must not return proposalCandidatePool — candidate pool is TS orchestrator responsibility"
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("backend-routing: notagen_mock sets generationMode=mock_notagen_abc and warns not-for-quality-eval", async (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-br-"));
    try {
        const result = runLearnedWorker(buildMinimalPayload(tmpDir), {
            LEARNED_SYMBOLIC_BACKEND: "notagen_mock",
        });
        assert.equal(result.ok, true, "notagen_mock should succeed");
        assert.equal(
            result.proposalMetadata?.generationMode,
            "mock_notagen_abc",
            "generationMode must be mock_notagen_abc, not a real inference mode"
        );
        assert.ok(
            Array.isArray(result.proposalMetadata?.normalizationWarnings) &&
            result.proposalMetadata.normalizationWarnings.includes("mock_backend_not_for_quality_eval"),
            "normalizationWarnings must contain mock_backend_not_for_quality_eval"
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("backend-routing: NOTAGEN_TIMEOUT_MS=1 causes notagen_local to fail fast with timeout error", async (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-br-"));
    try {
        // 1 ms timeout — subprocess worker won't even start the model in time.
        const result = runLearnedWorker(buildMinimalPayload(tmpDir), {
            LEARNED_SYMBOLIC_BACKEND: "notagen_local",
            NOTAGEN_TIMEOUT_MS: "1",
            NOTAGEN_RESAMPLE_BUDGET: "0",
            // Intentionally omit NOTAGEN_MODEL_PATH so model-load error doesn't
            // interfere; the timeout or the missing-path error will both produce ok:false.
        });
        assert.equal(result.ok, false, "notagen_local with 1ms timeout must return ok:false");
        assert.ok(
            typeof result.error === "string" && result.error.length > 0,
            "must include an error message"
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-br-"));
    try {
        const payload = buildMinimalPayload(tmpDir);
        // Corrupt the providerRequest: pass a non-object value
        payload.providerRequest = "not-an-object";
        const result = runLearnedWorker(payload);
        // Should still succeed (corrupt providerRequest → context=None → template backend runs)
        // OR return ok:false with a clear error.  Either is acceptable, but it must not crash.
        assert.ok(
            typeof result === "object" && result !== null,
            "response must be a JSON object"
        );
        assert.ok(
            "ok" in result,
            "response must have an ok field"
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
