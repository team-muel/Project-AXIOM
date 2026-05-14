// @ts-check
/**
 * Phase B: learned-notagen-prompt tests
 *
 * TypeScript-side (via dist/):
 *   1. conditioningText uses short ABC-oriented format.
 *   2. controlLines contains abc_format, form, key, meter, tempo in order.
 *   3. Same request always produces the same conditioningText + controlLines (determinism).
 *   4. Different section order changes planSignature and section control lines.
 *   5. Missing meter defaults to "4/4".
 *   6. Missing instrumentation on narrow lane defaults to Violin/Viola/Cello and emits a warning.
 *   7. motif_ref is always present in every section control line.
 *
 * Python-side (abc_prompt.py via spawnSync):
 *   8. Same providerRequest always produces the same output string (determinism).
 *   9. Different section order in controlLines → different output.
 *  10. Missing required field raises error (exit 1).
 *  11. Section count mismatch in prompt_packing.py raises ValueError (hard error).
 *  12. softConstraintLines appear in output when present.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function detectPythonBin() {
    // Prefer project venv first, then fall back to system Python
    const candidates = [
        path.join(repoRoot, ".venv", "Scripts", "python.exe"),
        path.join(repoRoot, ".venv", "bin", "python"),
    ];
    const venvBin = candidates.find((c) => fs.existsSync(c));
    if (venvBin) return venvBin;
    // Fall back to system Python — probe "python" and "python3" via spawnSync
    for (const bin of ["python", "python3"]) {
        const probe = spawnSync(bin, ["--version"], { encoding: "utf8", shell: true });
        if (!probe.error && probe.status === 0) return bin;
    }
    return null;
}
const pythonBin = detectPythonBin();

// ─── TypeScript imports from compiled dist ────────────────────────────────

const { buildLearnedSymbolicWorkerPayload } = await import("../dist/composer/learnedAdapter.js");

const STRING_TRIO_LANE = "string_trio_symbolic";

const SELECTED_MODELS = [
    { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
];

const EXECUTION_PLAN = {
    workflow: "symbolic_only",
    composeWorker: "learned_symbolic",
    selectedModels: SELECTED_MODELS,
};

/**
 * Build a minimal ComposeRequest for the string trio lane.
 * @param {object} overrides
 */
function makeRequest(overrides = {}) {
    return {
        prompt: "A minimal test miniature",
        form: "miniature",
        key: "G minor",
        tempo: 84,
        workflow: "symbolic_only",
        compositionPlan: {
            version: "1",
            brief: "A minimal test miniature",
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
            orchestration: {
                family: "string_trio",
                instrumentNames: ["Violin", "Viola", "Cello"],
                sections: [],
            },
            motifPolicy: { reuseRequired: false },
            rationale: "",
            sections: [
                { id: "s1", role: "theme_a", label: "Primary theme", measures: 4, energy: 0.5, density: 0.4 },
                { id: "s2", role: "recap", label: "Recap", measures: 4, energy: 0.4, density: 0.3 },
            ],
        },
        ...overrides,
    };
}

function buildPayload(requestOverrides = {}, planSectionOverride = null) {
    const req = makeRequest(requestOverrides);
    if (planSectionOverride !== null) {
        req.compositionPlan = { ...req.compositionPlan, sections: planSectionOverride };
    }
    return buildLearnedSymbolicWorkerPayload(req, "test-song", "/tmp/test.mid", EXECUTION_PLAN);
}

// ─── TypeScript adapter tests ─────────────────────────────────────────────

test("notagen-adapter: conditioningText uses short ABC-oriented format", () => {
    const payload = buildPayload();
    const text = payload.providerRequest.conditioningText;
    assert.match(text, /^Generate interleaved ABC notation for a /);
    assert.match(text, /Preserve the section plan and synchronized voices\./);
    // Must include key, meter, tempo
    assert.match(text, /G minor/);
    assert.match(text, /4\/4/);
    assert.match(text, /84 BPM/);
});

test("notagen-adapter: controlLines contains required fields in order", () => {
    const payload = buildPayload();
    const lines = payload.providerRequest.controlLines;

    const findLine = (prefix) => lines.find((l) => l.startsWith(prefix));

    assert.ok(findLine("lane="), "missing lane=");
    assert.ok(findLine("plan_signature="), "missing plan_signature=");
    assert.ok(findLine("prompt_pack_version="), "missing prompt_pack_version=");
    assert.ok(findLine("abc_format="), "missing abc_format=");
    assert.ok(findLine("form="), "missing form=");
    assert.ok(findLine("key="), "missing key=");
    assert.ok(findLine("meter="), "missing meter=");
    assert.ok(findLine("tempo="), "missing tempo=");
    assert.ok(findLine("instrumentation="), "missing instrumentation=");

    // abc_format must be "interleaved"
    assert.equal(findLine("abc_format="), "abc_format=interleaved");

    // Verify order: lane < plan_signature < prompt_pack_version < abc_format < form < key < meter < tempo < instrumentation
    const idxOf = (prefix) => lines.findIndex((l) => l.startsWith(prefix));
    assert.ok(idxOf("lane=") < idxOf("plan_signature="), "lane before plan_signature");
    assert.ok(idxOf("plan_signature=") < idxOf("prompt_pack_version="), "plan_signature before prompt_pack_version");
    assert.ok(idxOf("prompt_pack_version=") < idxOf("abc_format="), "prompt_pack_version before abc_format");
    assert.ok(idxOf("abc_format=") < idxOf("form="), "abc_format before form");
    assert.ok(idxOf("form=") < idxOf("key="), "form before key");
    assert.ok(idxOf("key=") < idxOf("meter="), "key before meter");
    assert.ok(idxOf("meter=") < idxOf("tempo="), "meter before tempo");
    assert.ok(idxOf("tempo=") < idxOf("instrumentation="), "tempo before instrumentation");
});

test("notagen-adapter: key in controlLines is ABC-compatible format", () => {
    const payload = buildPayload();
    const keyLine = payload.providerRequest.controlLines.find((l) => l.startsWith("key="));
    assert.ok(keyLine, "key= line missing");
    // "G minor" → "Gmin", "C major" → "C", etc.
    assert.match(keyLine, /^key=Gmin$/);
});

test("notagen-adapter: determinism — same request produces identical output", () => {
    const p1 = buildPayload();
    const p2 = buildPayload();
    assert.equal(p1.providerRequest.conditioningText, p2.providerRequest.conditioningText);
    assert.deepEqual(p1.providerRequest.controlLines, p2.providerRequest.controlLines);
    assert.equal(p1.providerRequest.planSignature, p2.providerRequest.planSignature);
});

test("notagen-adapter: different section order changes planSignature and section line order", () => {
    const p1 = buildPayload();
    const p2 = buildPayload({}, [
        { id: "s2", role: "recap", label: "Recap", measures: 4, energy: 0.4, density: 0.3 },
        { id: "s1", role: "theme_a", label: "Primary theme", measures: 4, energy: 0.5, density: 0.4 },
    ]);

    // planSignature should differ (section roles differ in order)
    assert.notEqual(p1.providerRequest.planSignature, p2.providerRequest.planSignature);

    // Section lines should be in different order
    const getSectionLines = (pr) => pr.controlLines.filter((l) => l.startsWith("section "));
    const sec1 = getSectionLines(p1.providerRequest);
    const sec2 = getSectionLines(p2.providerRequest);
    assert.notDeepEqual(sec1, sec2, "section line order should differ");
    // Reversed order
    assert.deepEqual(sec1, sec2.slice().reverse());
});

test("notagen-adapter: missing meter defaults to 4/4", () => {
    const req = makeRequest();
    delete req.compositionPlan.meter;
    const payload = buildLearnedSymbolicWorkerPayload(req, "test-song", "/tmp/test.mid", EXECUTION_PLAN);
    const meterLine = payload.providerRequest.controlLines.find((l) => l.startsWith("meter="));
    assert.equal(meterLine, "meter=4/4", "should default to 4/4");
    assert.match(payload.providerRequest.conditioningText, /4\/4/);
    // abcHeader should also use 4/4
    assert.match(payload.providerRequest.abcHeader ?? "", /M:4\/4/);
});

test("notagen-adapter: non-default meter is forwarded correctly", () => {
    const req = makeRequest();
    req.compositionPlan.meter = "3/4";
    const payload = buildLearnedSymbolicWorkerPayload(req, "test-song", "/tmp/test.mid", EXECUTION_PLAN);
    const meterLine = payload.providerRequest.controlLines.find((l) => l.startsWith("meter="));
    assert.equal(meterLine, "meter=3/4");
    assert.match(payload.providerRequest.conditioningText, /3\/4/);
    assert.match(payload.providerRequest.abcHeader ?? "", /M:3\/4/);
});

test("notagen-adapter: missing instrumentation on narrow lane defaults with warning", () => {
    const req = makeRequest();
    req.compositionPlan.instrumentation = [];
    req.targetInstrumentation = undefined;
    const payload = buildLearnedSymbolicWorkerPayload(req, "test-song", "/tmp/test.mid", EXECUTION_PLAN);
    const pr = payload.providerRequest;

    // Should still be narrow lane (orchestration.family=string_trio)
    assert.equal(payload.promptPack.lane, STRING_TRIO_LANE);

    // Instrumentation line must have the default value
    const instrLine = pr.controlLines.find((l) => l.startsWith("instrumentation="));
    assert.ok(instrLine, "instrumentation= line must be present");
    assert.equal(instrLine, "instrumentation=Violin:lead,Viola:counterline,Cello:bass");

    // warnings must be emitted
    assert.ok(Array.isArray(pr.warnings) && pr.warnings.length > 0, "warnings should be non-empty");
    assert.ok(
        pr.warnings?.some((w) => w.includes("string_trio_symbolic") && w.includes("defaulting")),
        `expected instrumentation default warning, got: ${JSON.stringify(pr.warnings)}`,
    );
});

test("notagen-adapter: every section line contains motif_ref", () => {
    const payload = buildPayload();
    const sectionLines = payload.providerRequest.controlLines.filter((l) => l.startsWith("section "));
    assert.ok(sectionLines.length >= 1, "should have at least 1 section line");
    for (const line of sectionLines) {
        assert.match(line, /motif_ref=/, `section line missing motif_ref: ${line}`);
    }
});

test("notagen-adapter: softConstraintLines contains per-section energy+density", () => {
    const payload = buildPayload();
    const soft = payload.providerRequest.softConstraintLines ?? [];
    assert.ok(soft.length > 0, "softConstraintLines should be non-empty");
    for (const section of payload.promptPack.sections) {
        const line = soft.find((l) => l.startsWith(`section_soft id=${section.sectionId}`));
        assert.ok(line, `missing section_soft for ${section.sectionId}`);
        assert.match(line, /energy=/, `section_soft missing energy for ${section.sectionId}`);
        assert.match(line, /density=/, `section_soft missing density for ${section.sectionId}`);
    }
});

test("notagen-adapter: metadataLines contains riskProfile and intentRationale when present", () => {
    const req = makeRequest();
    req.compositionPlan.riskProfile = "conservative";
    req.compositionPlan.intentRationale = "test rationale";
    const payload = buildLearnedSymbolicWorkerPayload(req, "test-song", "/tmp/test.mid", EXECUTION_PLAN);
    const meta = payload.providerRequest.metadataLines ?? [];
    assert.ok(meta.some((l) => l.startsWith("risk_profile=")), "risk_profile missing from metadataLines");
    assert.ok(meta.some((l) => l.startsWith("intent_rationale=")), "intent_rationale missing from metadataLines");
});

// ─── Python abc_prompt.py tests ───────────────────────────────────────────

/**
 * Build a minimal valid providerRequest for the Python abc_prompt tests.
 * @param {string[]} [sectionOrder]
 */
function buildMinimalProviderRequest(sectionOrder) {
    const sig = "lane=string_trio_symbolic|form=miniature|key=g minor|inst=cello,viola,violin|roles=theme_a>recap|sig=aabb1122";
    const sections = sectionOrder ?? [
        "section id=s1 role=theme_a label=Primary theme measures=4 motif_ref=none energy=0.5 density=0.4",
        "section id=s2 role=recap label=Recap measures=4 motif_ref=none energy=0.4 density=0.3",
    ];
    return {
        adapter: "notagen_class",
        version: "learned_notagen_adapter_v1",
        provider: "learned",
        model: "learned-symbolic-trio-v1",
        promptPackVersion: "learned_symbolic_prompt_pack_v1",
        planSignature: sig,
        conditioningText:
            "Generate interleaved ABC notation for a classical string trio miniature in G minor, 4/4, 84 BPM. Preserve the section plan and synchronized voices.",
        controlLines: [
            "lane=string_trio_symbolic",
            `plan_signature=${sig}`,
            "prompt_pack_version=learned_symbolic_prompt_pack_v1",
            "abc_format=interleaved",
            "form=miniature",
            "key=Gmin",
            "meter=4/4",
            "tempo=84",
            "instrumentation=Violin:lead,Viola:counterline,Cello:bass",
            ...sections,
        ],
        softConstraintLines: [
            "section_soft id=s1 energy=0.5 density=0.4",
            "section_soft id=s2 energy=0.4 density=0.3",
        ],
    };
}

/**
 * Run abc_prompt.py with the given providerRequest dict as stdin JSON.
 * Returns { stdout, stderr, status }.
 */
function runAbcPrompt(providerRequest) {
    if (!pythonBin) {
        throw new Error("No Python binary found.");
    }
    const result = spawnSync(
        pythonBin,
        ["-c", "import sys, json; sys.path.insert(0, \"workers/composer\"); from learned_symbolic.abc_prompt import build_notagen_input_string; pr=json.load(sys.stdin); sys.stdout.write(build_notagen_input_string(pr))"],
        {
            cwd: repoRoot,
            stdio: ["pipe", "pipe", "pipe"],
            input: JSON.stringify(providerRequest),
            encoding: "utf8",
        },
    );
    if (result.error) throw result.error;
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

/**
 * Run prompt_packing.resolve_provider_prompt_packing_context with the given payload.
 * Returns { stdout (JSON), stderr, status }.
 */
function runPromptPackingValidation(payload) {
    if (!pythonBin) {
        throw new Error("No Python binary found.");
    }
    const script = `
import sys, json
sys.path.insert(0, "workers/composer")
from learned_symbolic.prompt_packing import resolve_provider_prompt_packing_context, get_prompt_pack
payload = json.load(sys.stdin)
prompt_pack = get_prompt_pack(payload)
try:
    ctx = resolve_provider_prompt_packing_context(payload, prompt_pack)
    sys.stdout.write(json.dumps({"ok": True, "warnings": ctx["warnings"] if ctx else []}))
except ValueError as exc:
    sys.stdout.write(json.dumps({"ok": False, "error": str(exc)}))
`.trim();
    const result = spawnSync(pythonBin, ["-c", script], {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        input: JSON.stringify(payload),
        encoding: "utf8",
    });
    if (result.error) throw result.error;
    return JSON.parse(result.stdout.trim());
}

test("abc_prompt.py: determinism — same request produces identical output", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const pr = buildMinimalProviderRequest();
    const r1 = runAbcPrompt(pr);
    const r2 = runAbcPrompt(pr);
    assert.equal(r1.status, 0, `abc_prompt failed: ${r1.stderr}`);
    assert.equal(r1.stdout, r2.stdout, "output must be identical for same input");
});

test("abc_prompt.py: output starts with conditioningText", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const pr = buildMinimalProviderRequest();
    const r = runAbcPrompt(pr);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
        r.stdout.startsWith(pr.conditioningText),
        `output should start with conditioningText, got: ${r.stdout.slice(0, 120)}`,
    );
});

test("abc_prompt.py: output contains %%axiom_control_begin and %%axiom_control_end", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const pr = buildMinimalProviderRequest();
    const r = runAbcPrompt(pr);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /%%axiom_control_begin/);
    assert.match(r.stdout, /%%axiom_control_end/);
});

test("abc_prompt.py: section order is preserved in output", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const prNormal = buildMinimalProviderRequest();
    const prReversed = buildMinimalProviderRequest([
        "section id=s2 role=recap label=Recap measures=4 motif_ref=none energy=0.4 density=0.3",
        "section id=s1 role=theme_a label=Primary theme measures=4 motif_ref=none energy=0.5 density=0.4",
    ]);

    const r1 = runAbcPrompt(prNormal);
    const r2 = runAbcPrompt(prReversed);
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(r2.status, 0, r2.stderr);
    assert.notEqual(r1.stdout, r2.stdout, "reversed section order should produce different output");

    // Verify s1 comes before s2 in normal output
    const i1s1 = r1.stdout.indexOf("id=s1");
    const i1s2 = r1.stdout.indexOf("id=s2");
    assert.ok(i1s1 < i1s2, "s1 should appear before s2 in normal order");

    // Verify s2 comes before s1 in reversed output
    const i2s2 = r2.stdout.indexOf("id=s2");
    const i2s1 = r2.stdout.indexOf("id=s1");
    assert.ok(i2s2 < i2s1, "s2 should appear before s1 in reversed output");
});

test("abc_prompt.py: missing required field causes exit 1", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const pr = buildMinimalProviderRequest();
    // Remove abc_format from controlLines
    const broken = {
        ...pr,
        controlLines: pr.controlLines.filter((l) => !l.startsWith("abc_format=")),
    };
    const r = runAbcPrompt(broken);
    assert.equal(r.status, 1, "should exit with code 1 on missing required field");
    assert.match(r.stderr, /abc_format/, "error should mention the missing field");
});

test("abc_prompt.py: softConstraintLines block appears in output when present", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const pr = buildMinimalProviderRequest();
    const r = runAbcPrompt(pr);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /%%axiom_soft_begin/);
    assert.match(r.stdout, /%%axiom_soft_end/);
    assert.match(r.stdout, /section_soft id=s1/);
});

test("abc_prompt.py: output omits softConstraintLines block when not present", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const pr = { ...buildMinimalProviderRequest() };
    delete pr.softConstraintLines;
    const r = runAbcPrompt(pr);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes("%%axiom_soft_begin"), "should not have soft block when absent");
});

// ─── Python prompt_packing.py: section count mismatch = hard error ────────

test("prompt_packing: section count mismatch is a hard ValidationError", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const sig = "lane=string_trio_symbolic|form=miniature|key=c major|inst=cello,viola,violin|roles=theme_a>recap|sig=aabb1122";
    const payload = {
        prompt: "test",
        providerRequest: {
            adapter: "notagen_class",
            version: "learned_notagen_adapter_v1",
            provider: "learned",
            model: "learned-symbolic-trio-v1",
            promptPackVersion: "learned_symbolic_prompt_pack_v1",
            planSignature: sig,
            conditioningText: "test conditioning",
            controlLines: [
                "lane=string_trio_symbolic",
                `plan_signature=${sig}`,
                "prompt_pack_version=learned_symbolic_prompt_pack_v1",
                // Only 1 section line — but promptPack has 2 sections → mismatch
                "section id=s1 role=theme_a label=Theme A measures=4 motif_ref=none energy=0.4 density=0.35",
            ],
        },
        promptPack: {
            version: "learned_symbolic_prompt_pack_v1",
            lane: "string_trio_symbolic",
            planSignature: sig,
            sections: [
                { sectionId: "s1", role: "theme_a", label: "Theme A", measures: 4, energy: 0.4, density: 0.35 },
                { sectionId: "s2", role: "recap", label: "Recap", measures: 4, energy: 0.35, density: 0.3 },
            ],
        },
    };

    const result = runPromptPackingValidation(payload);
    assert.equal(result.ok, false, "section count mismatch must be a hard error");
    assert.ok(
        typeof result.error === "string" && result.error.includes("mismatch"),
        `error must mention mismatch, got: ${JSON.stringify(result.error)}`,
    );
});

test("prompt_packing: matching section count is accepted", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const sig = "lane=string_trio_symbolic|form=miniature|key=c major|inst=cello,viola,violin|roles=theme_a>recap|sig=aabb1122";
    const payload = {
        prompt: "test",
        providerRequest: {
            adapter: "notagen_class",
            version: "learned_notagen_adapter_v1",
            provider: "learned",
            model: "learned-symbolic-trio-v1",
            promptPackVersion: "learned_symbolic_prompt_pack_v1",
            planSignature: sig,
            conditioningText: "test conditioning",
            controlLines: [
                "lane=string_trio_symbolic",
                `plan_signature=${sig}`,
                "prompt_pack_version=learned_symbolic_prompt_pack_v1",
                "section id=s1 role=theme_a label=Theme A measures=4 motif_ref=none energy=0.4 density=0.35",
                "section id=s2 role=recap label=Recap measures=4 motif_ref=none energy=0.35 density=0.3",
            ],
        },
        promptPack: {
            version: "learned_symbolic_prompt_pack_v1",
            lane: "string_trio_symbolic",
            planSignature: sig,
            sections: [
                { sectionId: "s1", role: "theme_a", label: "Theme A", measures: 4, energy: 0.4, density: 0.35 },
                { sectionId: "s2", role: "recap", label: "Recap", measures: 4, energy: 0.35, density: 0.3 },
            ],
        },
    };

    const result = runPromptPackingValidation(payload);
    assert.equal(result.ok, true, `should be accepted; error: ${result.error}`);
});
