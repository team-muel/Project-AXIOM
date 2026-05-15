/**
 * export-notagen-sft-dataset.mjs
 *
 * Exports supervised fine-tuning (SFT) training pairs from AXIOM's approved
 * candidate manifests.  Each row is an (instruction, output) pair where:
 *
 *   instruction  the AXIOM control block fed to the symbolic backend:
 *                  {conditioningText}
 *                  %%axiom_control_begin
 *                  {controlLine_0}
 *                  ...
 *                  %%axiom_control_end
 *
 *   output       the full ABC score text produced by the backend and approved
 *                by a listener (stored in proposalEvidence.abcText)
 *
 * Stage 1 (current): NotaGen native -> candidates -> craft scoring + reranking
 * Stage 2 (target):  fine-tuned adapter -> AXIOM-control-following generation
 *
 * Only rows with BOTH non-null abcText and non-null controlLines are included.
 * Rows with generationMode containing "mock" are excluded by default.
 *
 * Usage:
 *   node scripts/export-notagen-sft-dataset.mjs [--root=outputs] [--snapshot=YYYY-MM-DD]
 *                                                [--min-score=0.6] [--include-mock]
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function readOption(name) {
    const prefix = `--${name}=`;
    const exactIndex = process.argv.indexOf(`--${name}`);
    if (exactIndex >= 0) return process.argv[exactIndex + 1] ?? "";
    const prefixed = process.argv.find((e) => e.startsWith(prefix));
    return prefixed ? prefixed.slice(prefix.length) : undefined;
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }
function fail(message, details) {
    console.error(JSON.stringify({ ok: false, message, details }, null, 2));
    process.exit(1);
}
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function writeJsonlFile(p, rows) {
    ensureDir(path.dirname(p));
    const c = rows.map((r) => JSON.stringify(r)).join("\n");
    fs.writeFileSync(p, c ? `${c}\n` : "", "utf-8");
}
function writeJsonFile(p, v) {
    ensureDir(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf-8");
}
function loadJsonIfExists(p, fb) {
    if (!fs.existsSync(p)) return fb;
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function toTrimmed(v) { return String(v ?? "").trim(); }
function toNumber(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) { const p = Number(v); return Number.isFinite(p) ? p : undefined; }
    return undefined;
}
function daySnapshotId(now = new Date()) { return now.toISOString().slice(0, 10); }
function stableHash(parts) {
    return createHash("sha256").update(parts.join("|"), "utf-8").digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Instruction builder
// ---------------------------------------------------------------------------

/**
 * Build the SFT instruction string from a providerRequest.
 * Mirrors the abc_prompt.py output format so a fine-tuned model can be
 * conditioned by the same prompt builder used at inference time.
 */
function buildInstruction(pr) {
    const txt = toTrimmed(pr?.conditioningText);
    const lines = Array.isArray(pr?.controlLines)
        ? pr.controlLines.filter((l) => typeof l === "string" && l.trim())
        : [];
    if (!txt && lines.length === 0) return null;
    const parts = [];
    if (txt) parts.push(txt);
    if (lines.length > 0) {
        parts.push("%%axiom_control_begin");
        parts.push(...lines);
        parts.push("%%axiom_control_end");
    }
    return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveOutputRoot() {
    return toTrimmed(readOption("root") || process.env.OUTPUT_DIR || "outputs") || "outputs";
}
function resolveSnapshotId() {
    return toTrimmed(readOption("snapshot") || daySnapshotId()) || daySnapshotId();
}
function resolveMinScore() {
    const raw = readOption("min-score");
    if (raw === undefined) return 0.0;
    const val = Number(raw);
    return Number.isFinite(val) ? val : 0.0;
}

// ---------------------------------------------------------------------------
// Candidate loading (mirrors export-notagen-preference-dataset.mjs)
// ---------------------------------------------------------------------------

function listSongDirs(outputRoot) {
    if (!fs.existsSync(outputRoot)) return [];
    return fs.readdirSync(outputRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "_system")
        .map((e) => e.name).sort();
}
function loadManifest(outputRoot, songId) {
    return loadJsonIfExists(path.join(outputRoot, songId, "manifest.json"), null);
}
function loadCandidateIndex(songDir) {
    return loadJsonIfExists(path.join(songDir, "candidates", "index.json"), null);
}
function loadCandidateManifest(songDir, candidateId) {
    return loadJsonIfExists(
        path.join(songDir, "candidates", candidateId, "candidate-manifest.json"), null);
}
function resolveSelectedCandidateId(idx) {
    if (!idx) return undefined;
    if (toTrimmed(idx.selectedCandidateId)) return toTrimmed(idx.selectedCandidateId);
    const entries = Array.isArray(idx.entries) ? idx.entries : [];
    const sel = entries.find((e) => Boolean(e?.selected));
    return sel ? toTrimmed(sel.candidateId) : undefined;
}

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

const CRAFT_DIMS = [
    "syntaxValidity", "sectionContractFit", "cadenceStrength", "tonalReturn",
    "motifSurvival", "voiceIndependence", "phraseShape", "registerIdiomaticFit",
];

function buildSftRow(songId, manifest, candidateManifest, { includeMock, minScore }) {
    const evidence = candidateManifest?.proposalEvidence ?? manifest?.proposalEvidence ?? {};

    const abcText = typeof evidence.abcText === "string" && evidence.abcText.trim()
        ? evidence.abcText : null;
    if (!abcText) return { row: null, reason: "no_abc_text" };

    const instruction = buildInstruction(evidence.providerRequest ?? null);
    if (!instruction) return { row: null, reason: "no_instruction" };

    const generationMode = toTrimmed(evidence.generationMode);
    if (!includeMock && (generationMode.includes("mock") || generationMode === "")) {
        return { row: null, reason: "mock_excluded" };
    }

    const craftScore = candidateManifest?.structureEvaluation?.craftScoreSummary ?? null;
    if (minScore > 0 && craftScore) {
        const scores = CRAFT_DIMS.map((d) => toNumber(craftScore[d])).filter((v) => v !== undefined);
        if (scores.length > 0) {
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            if (avg < minScore) return { row: null, reason: "below_min_score" };
        }
    }

    const planSignature = toTrimmed(evidence.planSignature) || undefined;
    return {
        row: {
            id: stableHash([songId, planSignature ?? "", generationMode]),
            songId,
            planSignature: planSignature ?? null,
            generationMode,
            instruction,
            output: abcText,
            meta: {
                provider: toTrimmed(evidence.provider) || null,
                model: toTrimmed(evidence.model) || null,
                normalizationWarnings: Array.isArray(evidence.normalizationWarnings)
                    ? evidence.normalizationWarnings : [],
                craftScoreSummary: craftScore ?? null,
            },
        },
        reason: null,
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const outputRoot = resolveOutputRoot();
    const snapshotId = resolveSnapshotId();
    const minScore = resolveMinScore();
    const includeMock = hasFlag("include-mock");
    const songIds = listSongDirs(outputRoot);
    if (songIds.length === 0) fail("No song directories found", { outputRoot });

    const rows = [];
    const counts = { skipped: 0, noAbcText: 0, noInstruction: 0, belowMinScore: 0, mockExcluded: 0 };

    for (const songId of songIds) {
        const manifest = loadManifest(outputRoot, songId);
        if (!manifest) { counts.skipped++; continue; }
        if (toTrimmed(manifest.approvalStatus) !== "approved") { counts.skipped++; continue; }
        const songDir = path.join(outputRoot, songId);
        const idx = loadCandidateIndex(songDir);
        const selId = resolveSelectedCandidateId(idx);
        const cand = selId ? loadCandidateManifest(songDir, selId) : null;
        const { row, reason } = buildSftRow(songId, manifest, cand, { includeMock, minScore });
        if (!row) {
            if (reason === "no_abc_text") counts.noAbcText++;
            else if (reason === "no_instruction") counts.noInstruction++;
            else if (reason === "mock_excluded") counts.mockExcluded++;
            else counts.belowMinScore++;
            continue;
        }
        rows.push(row);
    }

    // De-duplicate by (planSignature, first 256 chars of output)
    const seen = new Set();
    const deduped = rows.filter((row) => {
        const key = stableHash([row.planSignature ?? row.songId, row.output.slice(0, 256)]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const systemDir = path.join(outputRoot, "_system", "ml", "notagen-sft", snapshotId);
    const sftPath = path.join(systemDir, "sft-pairs.jsonl");
    const summaryPath = path.join(systemDir, "summary.json");
    writeJsonlFile(sftPath, deduped);
    writeJsonFile(summaryPath, {
        snapshotId, exportedAt: new Date().toISOString(),
        totalPairs: deduped.length, rawRows: rows.length, ...counts,
        minScore, includeMock, outputRoot, files: { sftPairs: sftPath },
    });
    console.log(JSON.stringify({
        ok: true, snapshotId, totalPairs: deduped.length, rawRows: rows.length,
        noAbcText: counts.noAbcText, belowMinScore: counts.belowMinScore,
        mockExcluded: counts.mockExcluded, sftPath,
    }, null, 2));
}

main();
