/**
 * export-notagen-preference-dataset.mjs
 *
 * Exports listener preference data from AXIOM manifests and candidate sidecars as a
 * JSONL dataset suitable for NotaGen DPO / fine-tuning and AXIOM reranker training.
 *
 * Each output row captures:
 *   planSignature, promptPack, providerRequest, candidateMidiPath,
 *   proposalEvidence, craftScoreSummary, listenerFeedback, decision
 *
 * DPO pairs are grouped by planSignature so downstream tooling can easily find
 * approved vs rejected items that share the same compositional intent.
 *
 * Usage:
 *   node scripts/export-notagen-preference-dataset.mjs [--root=outputs] [--snapshot=YYYY-MM-DD]
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
    if (exactIndex >= 0) return process.argv[exactIndex + 1];
    const prefixed = process.argv.find((e) => e.startsWith(prefix));
    if (prefixed) return prefixed.slice(prefix.length);
    return undefined;
}

function fail(message, details) {
    console.error(JSON.stringify({ ok: false, message, details }, null, 2));
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonlFile(filePath, rows) {
    ensureDir(path.dirname(filePath));
    const content = rows.map((row) => JSON.stringify(row)).join("\n");
    fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf-8");
}

function writeJsonFile(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function loadJsonIfExists(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return fallback; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toTrimmed(value) { return String(value ?? "").trim(); }
function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const p = Number(value); return Number.isFinite(p) ? p : undefined;
    }
    return undefined;
}

function daySnapshotId(now = new Date()) { return now.toISOString().slice(0, 10); }
function stableHash(parts) {
    return createHash("sha256").update(parts.join("|"), "utf-8").digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Manifest / candidate loading
// ---------------------------------------------------------------------------

function resolveOutputRoot() {
    return toTrimmed(readOption("root") || process.env.OUTPUT_DIR || "outputs") || "outputs";
}
function resolveSnapshotId() {
    return toTrimmed(readOption("snapshot") || daySnapshotId()) || daySnapshotId();
}

function listSongDirs(outputRoot) {
    if (!fs.existsSync(outputRoot)) return [];
    return fs.readdirSync(outputRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "_system")
        .map((e) => e.name)
        .sort();
}

function loadManifest(outputRoot, songId) {
    const p = path.join(outputRoot, songId, "manifest.json");
    if (!fs.existsSync(p)) return null;
    const m = loadJsonIfExists(p, null);
    return m && typeof m === "object" ? m : null;
}

function loadCandidateIndex(songDir) {
    return loadJsonIfExists(path.join(songDir, "candidates", "index.json"), null);
}

function loadCandidateManifest(songDir, candidateId) {
    const p = path.join(songDir, "candidates", candidateId, "candidate-manifest.json");
    return loadJsonIfExists(p, null);
}

function resolveSelectedCandidateId(candidateIndex) {
    if (!candidateIndex) return undefined;
    if (toTrimmed(candidateIndex.selectedCandidateId)) return toTrimmed(candidateIndex.selectedCandidateId);
    const entries = Array.isArray(candidateIndex.entries) ? candidateIndex.entries : [];
    const selected = entries.find((e) => Boolean(e?.selected));
    return selected ? toTrimmed(selected.candidateId) : undefined;
}

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

function buildPreferenceRow(songId, manifest, candidateManifest, decision) {
    const meta = manifest.meta ?? {};
    const plannerTelemetry = meta.plannerTelemetry ?? {};
    const proposalEvidence = candidateManifest?.proposalEvidence ?? manifest.proposalEvidence ?? {};
    const reviewFeedback = manifest.reviewFeedback ?? {};
    const listenerFeedback = reviewFeedback.listenerFeedback
        ?? candidateManifest?.listenerFeedback
        ?? undefined;

    const planSignature = toTrimmed(proposalEvidence.planSignature)
        || toTrimmed(plannerTelemetry.planSignature)
        || toTrimmed(meta.planSignature)
        || undefined;

    const craftScoreSummary = candidateManifest?.structureEvaluation?.craftScoreSummary
        ?? manifest.structureEvaluation?.craftScoreSummary
        ?? undefined;

    const midiPath = candidateManifest?.artifacts?.midi
        ?? path.join("outputs", songId, "composition.mid");

    const providerRequest = proposalEvidence.providerRequest ?? undefined;
    const promptPack = proposalEvidence.promptPack ?? undefined;

    return {
        songId,
        planSignature,
        decision,
        promptPack: promptPack ?? null,
        providerRequest: providerRequest ?? null,
        candidateMidiPath: midiPath ?? null,
        proposalEvidence: {
            worker: toTrimmed(proposalEvidence.worker) || undefined,
            provider: toTrimmed(proposalEvidence.provider) || undefined,
            model: toTrimmed(proposalEvidence.model) || undefined,
            generationMode: toTrimmed(proposalEvidence.generationMode) || undefined,
            promptPackVersion: toTrimmed(proposalEvidence.promptPackVersion) || undefined,
            planSignature,
            candidateIndex: toNumber(proposalEvidence.candidateIndex),
            confidence: toNumber(proposalEvidence.confidence),
            normalizationWarnings: Array.isArray(proposalEvidence.normalizationWarnings)
                ? proposalEvidence.normalizationWarnings
                : [],
        },
        craftScoreSummary: craftScoreSummary ?? null,
        internalScores: candidateManifest?.internalScores ?? null,
        listenerFeedback: listenerFeedback ?? null,
        listenerScores: candidateManifest?.listenerScores ?? null,
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const outputRoot = resolveOutputRoot();
    const snapshotId = resolveSnapshotId();

    const songIds = listSongDirs(outputRoot);
    if (songIds.length === 0) {
        fail("No song directories found", { outputRoot });
    }

    const rows = [];
    let skipped = 0;

    for (const songId of songIds) {
        const manifest = loadManifest(outputRoot, songId);
        if (!manifest) { skipped++; continue; }

        const approvalStatus = toTrimmed(manifest.approvalStatus);
        if (approvalStatus !== "approved" && approvalStatus !== "rejected") { skipped++; continue; }

        const songDir = path.join(outputRoot, songId);
        const candidateIndex = loadCandidateIndex(songDir);
        const selectedCandidateId = resolveSelectedCandidateId(candidateIndex);
        const candidateManifest = selectedCandidateId
            ? loadCandidateManifest(songDir, selectedCandidateId)
            : null;

        rows.push(buildPreferenceRow(songId, manifest, candidateManifest, approvalStatus));
    }

    // Build DPO pair summary (approved vs rejected under same planSignature)
    const byPlanSignature = {};
    for (const row of rows) {
        const sig = row.planSignature ?? stableHash([row.songId]);
        if (!byPlanSignature[sig]) byPlanSignature[sig] = { approved: [], rejected: [] };
        byPlanSignature[sig][row.decision === "approved" ? "approved" : "rejected"].push(row);
    }

    const dpoPairs = [];
    for (const [sig, group] of Object.entries(byPlanSignature)) {
        for (const chosen of group.approved) {
            for (const rejected of group.rejected) {
                dpoPairs.push({ planSignature: sig, chosen, rejected });
            }
        }
    }

    // Write outputs
    const systemDir = path.join(outputRoot, "_system", "ml", "notagen-preferences", snapshotId);
    const preferencesPath = path.join(systemDir, "preferences.jsonl");
    const dpoPairsPath = path.join(systemDir, "dpo-pairs.jsonl");
    const summaryPath = path.join(systemDir, "summary.json");

    writeJsonlFile(preferencesPath, rows);
    writeJsonlFile(dpoPairsPath, dpoPairs);
    writeJsonFile(summaryPath, {
        snapshotId,
        exportedAt: new Date().toISOString(),
        totalRows: rows.length,
        approvedCount: rows.filter((r) => r.decision === "approved").length,
        rejectedCount: rows.filter((r) => r.decision === "rejected").length,
        dpoPairCount: dpoPairs.length,
        skippedSongs: skipped,
        outputRoot,
        files: {
            preferences: preferencesPath,
            dpoPairs: dpoPairsPath,
        },
    });

    const summary = {
        ok: true,
        snapshotId,
        totalRows: rows.length,
        approvedCount: rows.filter((r) => r.decision === "approved").length,
        rejectedCount: rows.filter((r) => r.decision === "rejected").length,
        dpoPairCount: dpoPairs.length,
        preferencesPath,
        dpoPairsPath,
    };
    console.log(JSON.stringify(summary));
}

main();
