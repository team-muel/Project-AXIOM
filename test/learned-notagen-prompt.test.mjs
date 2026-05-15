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
const { buildPianoRewriteBlock } = await import("../dist/composer/learnedNotagenAdapter.js");

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

// ─── Python abc_conditioning.py: control line preservation ───────────────────

/**
 * Run build_abc_header() via Python subprocess.
 * @param {object} context  ProviderPromptPackingContext-shaped dict
 * @returns {{ stdout: string, stderr: string, status: number }}
 */
function runBuildAbcHeader(context) {
    if (!pythonBin) throw new Error("No Python binary found.");
    const script = [
        "import sys, json",
        'sys.path.insert(0, "workers/composer")',
        "from learned_symbolic.abc_conditioning import build_abc_header",
        "ctx = json.load(sys.stdin)",
        "sys.stdout.write(build_abc_header(ctx))",
    ].join("\n");
    const result = spawnSync(pythonBin, ["-c", script], {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        input: JSON.stringify(context),
        encoding: "utf8",
    });
    if (result.error) throw result.error;
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

/** Build a minimal ProviderPromptPackingContext with given controlLines. */
function makeAbcHeaderContext(overrides = {}) {
    const sig = "lane=string_trio_symbolic|form=miniature|key=g minor|sig=aabb";
    return {
        adapter: "notagen_class",
        version: "learned_notagen_adapter_v1",
        provider: "learned",
        model: "learned-symbolic-trio-v1",
        promptPackVersion: "learned_symbolic_prompt_pack_v1",
        planSignature: sig,
        conditioningText:
            "Generate interleaved ABC notation for a classical string trio miniature in G minor, 3/4, 84 BPM. Preserve the section plan.",
        controlLines: [
            "lane=string_trio_symbolic",
            `plan_signature=${sig}`,
            "prompt_pack_version=learned_symbolic_prompt_pack_v1",
            "abc_format=interleaved",
            "form=miniature",
            "key=Gmin",
            "meter=3/4",
            "tempo=84",
            "instrumentation=Violin:lead,Viola:counterline,Cello:bass",
            "section id=s1 role=theme_a label=Theme measures=4 motif_ref=none energy=0.5 density=0.4",
        ],
        lane: "string_trio_symbolic",
        warnings: [],
        ...overrides,
    };
}

test("abc_conditioning: meter from control line, not hardcoded 4/4", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const ctx = makeAbcHeaderContext();
    const r = runBuildAbcHeader(ctx);
    assert.equal(r.status, 0, `build_abc_header failed: ${r.stderr}`);
    // Should use meter=3/4 from controlLines, not the hardcoded M:4/4
    assert.match(r.stdout, /^M:3\/4$/m, "header must use meter from control lines");
    assert.ok(!r.stdout.includes("M:4/4"), "must NOT hardcode 4/4 when meter=3/4 is in controlLines");
});

test("abc_conditioning: instrumentation control line preserved as %% comment", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const ctx = makeAbcHeaderContext();
    const r = runBuildAbcHeader(ctx);
    assert.equal(r.status, 0, r.stderr);
    assert.match(
        r.stdout,
        /^%% instrumentation=Violin:lead,Viola:counterline,Cello:bass$/m,
        "instrumentation= control line must appear as %% comment in ABC header",
    );
});

test("abc_conditioning: all non-section control lines appear as %% comments", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const ctx = makeAbcHeaderContext();
    const r = runBuildAbcHeader(ctx);
    assert.equal(r.status, 0, r.stderr);
    // These non-section lines must all appear as %% key=value comments
    const expectedLines = [
        "%% lane=string_trio_symbolic",
        "%% prompt_pack_version=learned_symbolic_prompt_pack_v1",
        "%% abc_format=interleaved",
        "%% form=miniature",
        "%% key=Gmin",
        "%% meter=3/4",
        "%% tempo=84",
        "%% instrumentation=Violin:lead,Viola:counterline,Cello:bass",
    ];
    for (const expected of expectedLines) {
        assert.ok(
            r.stdout.includes(expected),
            `header must contain "${expected}", got:\n${r.stdout}`,
        );
    }
    // plan_signature is encoded in C: — it must NOT also duplicate as a raw %% line
    // (it's acceptable but we verify C: is there)
    assert.match(r.stdout, /^C:AXIOM plan_signature=/m, "C: field must encode plan_signature");
});

test("abc_conditioning: section lines still appear as %% axiom_section", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const ctx = makeAbcHeaderContext();
    const r = runBuildAbcHeader(ctx);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^%% axiom_section id=s1/m, "section line must be emitted as %% axiom_section");
    // Must NOT emit "section id=s1 ..." verbatim (without the axiom_section prefix)
    assert.ok(
        !r.stdout.split("\n").some((l) => l.startsWith("%% section ")),
        "section lines must be emitted as '%% axiom_section', not '%% section'",
    );
});

test("abc_conditioning: missing meter falls back to 4/4 (no meter= in controlLines)", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const ctx = makeAbcHeaderContext({
        conditioningText:
            "Generate interleaved ABC notation for a classical string trio miniature in G minor, 92 BPM.",
        controlLines: [
            "lane=string_trio_symbolic",
            "plan_signature=x",
            "section id=s1 role=theme_a label=Theme measures=4 motif_ref=none energy=0.5 density=0.4",
        ],
    });
    const r = runBuildAbcHeader(ctx);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^M:4\/4$/m, "should default to M:4/4 when no meter= control line");
});

// ─── Piano prompt tests ───────────────────────────────────────────────────────

/** Build a minimal ComposeRequest for the solo piano lane. */
function makePianoRequest(overrides = {}) {
    return {
        prompt: "A nocturne in F minor",
        form: "nocturne",
        key: "F minor",
        tempo: 72,
        workflow: "symbolic_only",
        compositionPlan: {
            version: "1",
            brief: "A nocturne in F minor",
            mood: [],
            form: "nocturne",
            key: "F minor",
            meter: "6/8",
            tempo: 72,
            workflow: "symbolic_only",
            instrumentation: [
                { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] },
            ],
            orchestration: { family: "keyboard", instrumentNames: ["Piano"], sections: [] },
            motifPolicy: { reuseRequired: false },
            rationale: "",
            sections: [
                { id: "s1", role: "theme_a", label: "Primary theme", measures: 8, energy: 0.6, density: 0.5 },
                { id: "s2", role: "development", label: "Development", measures: 8, energy: 0.7, density: 0.6 },
                { id: "s3", role: "recap", label: "Recap", measures: 8, energy: 0.5, density: 0.4 },
            ],
            pianoPlan: {
                instrument: "Piano",
                difficultyTarget: "advanced",
                sections: [
                    {
                        sectionId: "s1",
                        textureKind: "melody_accompaniment",
                        rightHand: { hand: "right", primaryRoles: ["lead"], registerMin: 60, registerMax: 84, maxComfortableSpan: 12, densityTarget: 2 },
                        leftHand: { hand: "left", primaryRoles: ["bass", "chordal_support"], registerMin: 36, registerMax: 59, maxComfortableSpan: 12, densityTarget: 3 },
                        pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                        accompanimentPattern: "broken_chord",
                        difficultyTarget: "advanced",
                    },
                    {
                        sectionId: "s2",
                        textureKind: "arpeggiated_texture",
                        rightHand: { hand: "right", primaryRoles: ["lead"], registerMin: 64, registerMax: 88, maxComfortableSpan: 12, densityTarget: 3, allowCrossing: true },
                        leftHand: { hand: "left", primaryRoles: ["bass"], registerMin: 36, registerMax: 64, maxComfortableSpan: 12, densityTarget: 4, allowCrossing: true },
                        pedal: { enabled: true, strategy: "coloristic" },
                        accompanimentPattern: "wide_spread_arpeggio",
                        difficultyTarget: "advanced",
                    },
                    {
                        sectionId: "s3",
                        textureKind: "melody_accompaniment",
                        rightHand: { hand: "right", primaryRoles: ["lead"], registerMin: 60, registerMax: 84, maxComfortableSpan: 12, densityTarget: 1 },
                        leftHand: { hand: "left", primaryRoles: ["bass", "chordal_support"], registerMin: 36, registerMax: 59, maxComfortableSpan: 12, densityTarget: 3 },
                        pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                        accompanimentPattern: "broken_chord",
                        difficultyTarget: "intermediate",
                    },
                ],
            },
        },
        ...overrides,
    };
}

const PIANO_EXECUTION_PLAN = {
    workflow: "symbolic_only",
    composeWorker: "learned_symbolic",
    selectedModels: [{ role: "structure", provider: "learned", model: "learned-symbolic-piano-v1" }],
};

function buildPianoPayload(requestOverrides = {}) {
    const req = makePianoRequest(requestOverrides);
    return buildLearnedSymbolicWorkerPayload(req, "nocturne-test", "/tmp/nocturne.mid", PIANO_EXECUTION_PLAN);
}

test("notagen-adapter piano: lane resolves to solo_piano_symbolic", () => {
    const payload = buildPianoPayload();
    assert.equal(payload.promptPack.lane, "solo_piano_symbolic");
    const laneLine = payload.providerRequest.controlLines.find((l) => l.startsWith("lane="));
    assert.equal(laneLine, "lane=solo_piano_symbolic");
});

test("notagen-adapter piano: promptPack carries pianoPlan", () => {
    const payload = buildPianoPayload();
    assert.ok(payload.promptPack.pianoPlan, "promptPack.pianoPlan must be set");
    assert.equal(payload.promptPack.pianoPlan?.instrument, "Piano");
    assert.equal(payload.promptPack.pianoPlan?.difficultyTarget, "advanced");
    assert.equal(payload.promptPack.pianoPlan?.sections.length, 3);
});

test("notagen-adapter piano: controlLines contains difficulty and piano_global before sections", () => {
    const lines = buildPianoPayload().providerRequest.controlLines;
    const idxDiff = lines.findIndex((l) => l.startsWith("difficulty="));
    const idxGlobal = lines.findIndex((l) => l.startsWith("piano_global "));
    const idxSection = lines.findIndex((l) => l.startsWith("section "));
    assert.ok(idxDiff >= 0, "difficulty= line missing");
    assert.ok(idxGlobal >= 0, "piano_global line missing");
    assert.ok(idxSection >= 0, "section line missing");
    assert.ok(idxDiff < idxGlobal, "difficulty must come before piano_global");
    assert.ok(idxGlobal < idxSection, "piano_global must come before first section");
    assert.equal(lines[idxDiff], "difficulty=advanced");
    // piano_global should include texture, pedal, hand_crossing, max_span
    assert.match(lines[idxGlobal], /texture=melody_accompaniment/);
    assert.match(lines[idxGlobal], /pedal=harmonic/);  // harmonic is dominant (2 of 3 sections)
    assert.match(lines[idxGlobal], /hand_crossing=true/);  // s2 has allowCrossing
    assert.match(lines[idxGlobal], /max_span=12/);
});

test("notagen-adapter piano: each section line is immediately followed by piano_section line", () => {
    const lines = buildPianoPayload().providerRequest.controlLines;
    const sectionIndexes = lines.reduce((acc, l, i) => {
        if (l.startsWith("section ")) acc.push(i);
        return acc;
    }, /** @type {number[]} */ ([]));
    assert.equal(sectionIndexes.length, 3, "should have 3 section lines");
    for (const idx of sectionIndexes) {
        const sectionId = lines[idx].match(/id=(\S+)/)?.[1];
        const nextLine = lines[idx + 1] ?? "";
        assert.match(nextLine, /^piano_section /, `section ${sectionId}: expected piano_section immediately after, got: ${nextLine}`);
        assert.match(nextLine, new RegExp(`id=${sectionId}`), `piano_section must match sectionId=${sectionId}`);
        assert.match(nextLine, /texture=/, `piano_section for ${sectionId} missing texture=`);
        assert.match(nextLine, /rh=/, `piano_section for ${sectionId} missing rh=`);
        assert.match(nextLine, /lh=/, `piano_section for ${sectionId} missing lh=`);
        assert.match(nextLine, /pedal=/, `piano_section for ${sectionId} missing pedal=`);
        assert.match(nextLine, /density=/, `piano_section for ${sectionId} missing density=`);
    }
});

test("notagen-adapter piano: density labels match densityTarget thresholds", () => {
    const lines = buildPianoPayload().providerRequest.controlLines;
    const pianoSections = lines.filter((l) => l.startsWith("piano_section "));
    // s1 rh densityTarget=2 → medium
    const s1 = pianoSections.find((l) => l.includes("id=s1"));
    assert.ok(s1?.includes("density=medium"), `s1 expected density=medium, got: ${s1}`);
    // s2 rh densityTarget=3 → rich
    const s2 = pianoSections.find((l) => l.includes("id=s2"));
    assert.ok(s2?.includes("density=rich"), `s2 expected density=rich, got: ${s2}`);
    // s3 rh densityTarget=1 → sparse
    const s3 = pianoSections.find((l) => l.includes("id=s3"));
    assert.ok(s3?.includes("density=sparse"), `s3 expected density=sparse, got: ${s3}`);
});

test("notagen-adapter piano: lh= uses accompanimentPattern when present, roles as fallback", () => {
    const lines = buildPianoPayload().providerRequest.controlLines;
    const pianoSections = lines.filter((l) => l.startsWith("piano_section "));
    // s1 has accompanimentPattern=broken_chord
    const s1 = pianoSections.find((l) => l.includes("id=s1"));
    assert.ok(s1?.includes("lh=broken_chord"), `s1 expected lh=broken_chord, got: ${s1}`);
    // s2 has accompanimentPattern=wide_spread_arpeggio
    const s2 = pianoSections.find((l) => l.includes("id=s2"));
    assert.ok(s2?.includes("lh=wide_spread_arpeggio"), `s2 expected lh=wide_spread_arpeggio, got: ${s2}`);
});

test("notagen_backend: notagen_native + rewrite_block → warning + full-regen mode (Python)", (t) => {
    if (!pythonBin) { t.skip("No Python binary available"); return; }
    const script = `
import sys, types, json
sys.path.insert(0, "workers/composer")
from unittest.mock import patch, MagicMock
import learned_symbolic.notagen_backend as nb

ABC_HEADER = "X:1\\nT:Test\\nM:3/4\\nL:1/8\\nK:Gmin\\n%% instrumentation=Violin,Viola,Cello\\n"
REWRITE_BLOCK = "<AXIOM_REWRITE>\\nrewrite_sections=s2\\nkeep_sections=s1,s3\\n</AXIOM_REWRITE>"

# Minimal projection result stub
proj_result = MagicMock()
proj_result.ok = True
proj_result.error = None
proj_result.normalization_warnings = []
proj_result.midi_path = None
proj_result.proposal_sections = [{"sectionId": "s1", "noteHistory": [], "measureCount": 2}]

captured_prompt = []

def fake_inference(prompt, **kwargs):
    captured_prompt.append(prompt)
    # Return a minimal valid ABC full score (as notagen_native would)
    return "X:1\\nT:Test\\nM:3/4\\nL:1/8\\nK:Gmin\\n|:G4:|]"

backend = nb.NotagenBackend()
with patch.object(nb, "_engine_name", return_value="notagen_native"), \\
     patch.object(nb, "_run_local_inference", side_effect=fake_inference), \\
     patch.object(nb, "run_abc_projection_pipeline", return_value=proj_result):
    result = backend._generate_local(
        payload={"promptPack": {"sections": [{"sectionId": "s1", "role": "theme_a"}]}},
        provider_request={},
        context=MagicMock(),
        model="test-model",
        generation_mode="targeted_section_rewrite_notagen_native",
        abc_header=ABC_HEADER,
        rewrite_block=REWRITE_BLOCK,
        rewrite_spec={"rewriteSectionIds": ["s2"], "keepSectionIds": ["s1", "s3"]},
        is_localized_rewrite=True,
        candidate_seed=42,
        candidate_index=0,
        temperature=0.8,
        top_p=0.9,
        top_k=50,
        repetition_penalty=1.0,
        max_tokens=512,
    )

assert "notagen_native_rewrite_block_ignored_full_regen" in result.warnings, \\
    f"Expected warning not found; warnings={result.warnings}"
assert result.generation_mode == "notagen_abc_inference_notagen_native", \\
    f"Expected full-regen generation_mode, got: {result.generation_mode}"
assert len(captured_prompt) >= 1, "inference must have been called at least once"
assert REWRITE_BLOCK not in captured_prompt[0], \\
    f"rewrite_block must NOT appear in prompt passed to inference; got:\\n{captured_prompt[0][:300]}"
assert ABC_HEADER.strip() in captured_prompt[0] or captured_prompt[0].startswith("X:"), \\
    f"prompt must start with ABC header; got:\\n{captured_prompt[0][:300]}"
print("PASS")
`;
    const r = spawnSync(pythonBin, ["-c", script], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
    });
    assert.equal(r.status, 0, `Python test failed:\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /PASS/, "Python test must print PASS");
});

// ─── Piano rewrite block tests ───────────────────────────────────────────────

const PIANO_REWRITE_SPEC_BASE = {
    rewriteSectionIds: ["s2"],
    keepSectionIds: ["s1", "s3"],
    reason: "left hand leaps are too large; melody is buried by inner chords",
    directives: [
        { kind: "smooth_left_hand_leaps",    priority: 1, reason: "LH leaps > octave", fallbackStrategy: "repairSolver" },
        { kind: "clarify_right_hand_melody", priority: 2, reason: "melody buried",      fallbackStrategy: "rewrite" },
    ],
    repairAlreadyApplied: false,
};

test("buildPianoRewriteBlock: emits AXIOM_PIANO_REWRITE tags and mode=localized_piano_rewrite", () => {
    const block = buildPianoRewriteBlock(PIANO_REWRITE_SPEC_BASE);
    assert.match(block, /^<AXIOM_PIANO_REWRITE>/);
    assert.match(block, /<\/AXIOM_PIANO_REWRITE>$/);
    assert.match(block, /mode=localized_piano_rewrite/);
});

test("buildPianoRewriteBlock: rewrite_sections and keep_sections are present", () => {
    const block = buildPianoRewriteBlock(PIANO_REWRITE_SPEC_BASE);
    assert.match(block, /rewrite_sections=s2/);
    assert.match(block, /keep_sections=s1,s3/);
    assert.match(block, /reason="/);
});

test("buildPianoRewriteBlock: target bullets come from PIANO_DIRECTIVE_KIND_TO_TARGETS", () => {
    const block = buildPianoRewriteBlock(PIANO_REWRITE_SPEC_BASE);
    // smooth_left_hand_leaps → "reduce left-hand leap distance"
    assert.match(block, /reduce left-hand leap distance/);
    // clarify_right_hand_melody → "keep right-hand melody above accompaniment"
    assert.match(block, /keep right-hand melody above accompaniment/);
    // Always appended
    assert.match(block, /preserve harmonic rhythm and measure count/);
});

test("buildPianoRewriteBlock: repair_already_applied=true emitted when set", () => {
    const spec = { ...PIANO_REWRITE_SPEC_BASE, repairAlreadyApplied: true };
    const block = buildPianoRewriteBlock(spec);
    assert.match(block, /repair_already_applied=true/);
    // verify absence when false
    const blockFalse = buildPianoRewriteBlock(PIANO_REWRITE_SPEC_BASE);
    assert.doesNotMatch(blockFalse, /repair_already_applied/);
});

test("buildPianoRewriteBlock: repair_solver_directives and rewrite_directives separation", () => {
    const block = buildPianoRewriteBlock(PIANO_REWRITE_SPEC_BASE);
    // smooth_left_hand_leaps has fallbackStrategy=repairSolver
    assert.match(block, /repair_solver_directives=smooth_left_hand_leaps/);
    // clarify_right_hand_melody has fallbackStrategy=rewrite
    assert.match(block, /rewrite_directives=clarify_right_hand_melody/);
});

test("buildLearnedSymbolicWorkerPayload: pianoRewriteSpec + pianoRewriteBlock carried on providerRequest", () => {
    const req = makePianoRequest({ localizedPianoRewriteSpec: PIANO_REWRITE_SPEC_BASE });
    const payload = buildLearnedSymbolicWorkerPayload(req, "rewrite-test", "/tmp/rewrite.mid", PIANO_EXECUTION_PLAN);
    assert.ok(payload.localizedPianoRewriteSpec, "payload must carry localizedPianoRewriteSpec");
    assert.ok(payload.providerRequest.pianoRewriteSpec, "providerRequest must carry pianoRewriteSpec");
    assert.ok(payload.providerRequest.pianoRewriteBlock, "providerRequest must carry pianoRewriteBlock");
    assert.match(payload.providerRequest.pianoRewriteBlock, /AXIOM_PIANO_REWRITE/);
});
