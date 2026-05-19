/**
 * export-sft-dataset.mjs
 *
 * Exports approved AXIOM candidates as a Supervised Fine-Tuning (SFT) dataset
 * in JSONL format for training AXIOM-control-following NotaGen adapters.
 *
 * APPROVAL PHILOSOPHY (v2):
 *   PRIMARY GATE: InternalCriticApproval.approved (computed from craft scores)
 *   SECONDARY:    manifest.selected (human selection, used as metadata only)
 *   NOT A GATE:   listenerFeedback / curatorCalibration (calibration signal only)
 *
 * --approved-only now uses InternalCriticApproval.approved as the gate.
 * Use --selection-only to additionally require human selection.
 * Use --listener-gate to additionally require listenerFeedback.appeal >= threshold.
 *
 * Each exported record ("example") consists of:
 *
 *   input:
 *     - controlLines[]          hard constraints + section control lines
 *     - softConstraintLines[]   advisory energy/density lines
 *     - motifGraphBlock?        [AXIOM_MOTIF_GRAPH] block (when present in manifest)
 *     - repairBlock?            [AXIOM_REPAIR] block (when applicable)
 *     - pianoRewriteBlock?      <AXIOM_PIANO_REWRITE> block (when applicable)
 *     - conditioningText        period/composer/instrumentation conditioning
 *     - abcHeader               key/meter/tempo header
 *
 *   output:
 *     - approvedAbc             approved ABC notation text (full or segment)
 *
 *   metadata:
 *     - songId                  AXIOM song ID
 *     - candidateId             candidate identifier
 *     - criticApproved          internal critic approval decision (primary gate)
 *     - selected                whether this was the human-selected candidate
 *     - scoringProfileId        profile used for scoring
 *     - evidenceCoverageScore   evidence completeness score
 *     - finalCraftScore         heuristic gate score
 *     - advancedCraftScore      plan-aware composite score
 *     - harmonyContractScore    harmony evidence completeness
 *     - pianoListenabilityScore piano-specific listenability (if available)
 *     - failedDimensions[]      critic dimensions that failed (empty = approved)
 *     - hasRepairHistory        whether any repair directives were applied
 *     - repairKinds[]           kinds of repairs applied (if any)
 *     - calibrationAppeal?      curator calibration quality rating (if available)
 *     - calibrationPreferredOver? pairwise calibration signal (if available)
 *     - exportedAt              ISO timestamp
 *
 * Records are written one JSON object per line (JSONL).
 *
 * Usage:
 *   node scripts/export-sft-dataset.mjs [options]
 *
 * Options:
 *   --root=<dir>           outputs root directory (default: outputs)
 *   --out=<file>           output JSONL file (default: outputs/_system/sft-dataset.jsonl)
 *   --min-score=<n>        minimum finalCraftScore to include (default: 0.0)
 *   --approved-only        only include candidates where InternalCriticApproval.approved=true
 *                          Falls back to finalCraftScore >= 0.70 when internalCriticApproval absent
 *   --selection-only       additionally require manifest.selected=true (human-selected candidates)
 *   --listener-gate=<n>    additionally require curatorCalibration.qualityRating >= n (1–5)
 *   --dry-run              print stats without writing file
 *
 * Exit code 0 on success; 1 on error.
 */

import fs from "node:fs";
import path from "node:path";
import { argv, exit } from "node:process";

// ─── CLI arg helpers ──────────────────────────────────────────────────────────
function readOption(name) {
    const prefix = `--${name}=`;
    const val = argv.find((a) => a.startsWith(prefix));
    return val ? val.slice(prefix.length) : null;
}
function hasFlag(name) { return argv.includes(`--${name}`); }

const outputRoot    = readOption("root") ?? "outputs";
const outFile       = readOption("out")  ?? path.join(outputRoot, "_system", "sft-dataset.jsonl");
const minScore      = parseFloat(readOption("min-score") ?? "0.0");
const approvedOnly  = hasFlag("approved-only");
const selectionOnly = hasFlag("selection-only");
const listenerGate  = readOption("listener-gate") !== null ? parseInt(readOption("listener-gate") ?? "3", 10) : null;
const dryRun        = hasFlag("dry-run");

// Internal critic fallback threshold when manifest lacks internalCriticApproval
const CRITIC_FALLBACK_THRESHOLD = 0.70;

// ─── Filesystem helpers ───────────────────────────────────────────────────────
function loadJsonIfExists(filePath) {
    try {
        const text = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Manifest traversal ───────────────────────────────────────────────────────
function listSongDirs(root) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "_system")
        .map((e) => path.join(root, e.name))
        .sort();
}

function loadCandidateIndex(songDir) {
    return loadJsonIfExists(path.join(songDir, "candidates", "index.json"));
}

function loadCandidateManifest(songDir, candidateId) {
    return loadJsonIfExists(
        path.join(songDir, "candidates", candidateId, "candidate-manifest.json"),
    );
}

// ─── Provider request extraction ─────────────────────────────────────────────
/**
 * Extracts the SFT input fields from the manifest's stored providerRequest
 * (learnedNotagenProviderRequest field) or reconstructs from controlLines.
 */
function extractInputFields(manifest) {
    const req = manifest.learnedNotagenProviderRequest
        ?? manifest.providerRequest
        ?? null;

    if (!req) {
        // Fallback: try to reconstruct minimal fields from manifest metadata
        return {
            controlLines: manifest.controlLines ?? [],
            softConstraintLines: manifest.softConstraintLines ?? [],
            conditioningText: manifest.conditioningText ?? "",
            abcHeader: manifest.abcHeader ?? "",
            motifGraphBlock: manifest.motifGraphBlock ?? undefined,
            repairBlock: manifest.repairBlock ?? undefined,
            pianoRewriteBlock: manifest.pianoRewriteBlock ?? undefined,
        };
    }

    return {
        controlLines: req.controlLines ?? [],
        softConstraintLines: req.softConstraintLines ?? [],
        conditioningText: req.conditioningText ?? "",
        abcHeader: req.abcHeader ?? "",
        ...(req.motifGraphBlock ? { motifGraphBlock: req.motifGraphBlock } : {}),
        ...(req.repairBlock ? { repairBlock: req.repairBlock } : {}),
        ...(req.pianoRewriteBlock ? { pianoRewriteBlock: req.pianoRewriteBlock } : {}),
    };
}

// ─── Score/feedback extraction ────────────────────────────────────────────────
function extractScores(manifest) {
    const cs = manifest.craftScoreSummary ?? manifest.craftScore ?? {};
    return {
        finalCraftScore:           cs.finalCraftScore         ?? manifest.finalCraftScore         ?? null,
        advancedCraftScore:        cs.advancedCraftScore       ?? manifest.advancedCraftScore       ?? null,
        evidenceCoverageScore:     cs.evidenceCoverageScore    ?? manifest.evidenceCoverageScore    ?? null,
        harmonyContractScore:      cs.harmonyContractScore     ?? manifest.harmonyContractScore     ?? null,
        pianoListenabilityScore:   cs.pianoListenabilityScore  ?? manifest.pianoListenabilityScore  ?? null,
    };
}

function extractRepairHistory(manifest) {
    const directives = manifest.repairDirectives ?? manifest.revisionDirectives ?? [];
    return {
        hasRepairHistory: directives.length > 0,
        repairKinds: [...new Set(directives.map((d) => d.kind).filter(Boolean))],
    };
}

function extractCalibration(manifest) {
    // Curator calibration review (secondary calibration signal — not a gate)
    const cal = manifest.curatorCalibration ?? null;
    // Legacy: fall back to listenerFeedback for backward compat
    const fb  = manifest.listenerFeedback ?? manifest.feedback ?? null;
    if (!cal && !fb) return {};
    if (cal) {
        return {
            ...(cal.qualityRating    !== undefined ? { calibrationAppeal:       cal.qualityRating }    : {}),
            ...(cal.harmonyRating    !== undefined ? { calibrationHarmony:      cal.harmonyRating }    : {}),
            ...(cal.structureRating  !== undefined ? { calibrationStructure:    cal.structureRating }  : {}),
            ...(cal.motifRating      !== undefined ? { calibrationMotif:        cal.motifRating }      : {}),
            ...(cal.pianoRating      !== undefined ? { calibrationPiano:        cal.pianoRating }      : {}),
            ...(cal.preferredOver    !== undefined ? { calibrationPreferredOver: cal.preferredOver }   : {}),
            ...(cal.calibrationNote  !== undefined ? { calibrationNote:         cal.calibrationNote }  : {}),
        };
    }
    // Legacy listenerFeedback → expose as calibration metadata (not gate signal)
    return {
        ...(fb.appeal          !== undefined ? { calibrationAppeal:       fb.appeal }          : {}),
        ...(fb.preferredOver   !== undefined ? { calibrationPreferredOver: fb.preferredOver }  : {}),
        ...(fb.rejectionReason !== undefined ? { calibrationInsight: fb.rejectionReason }      : {}),
    };
}

// ─── Output ABC extraction ────────────────────────────────────────────────────
function extractApprovedAbc(manifest, songDir, candidateId) {
    // Priority: inline abc → candidate abc file → abcText field
    if (manifest.approvedAbc) return manifest.approvedAbc;
    if (manifest.abcText)     return manifest.abcText;

    // Try candidate abc file
    const abcPath = path.join(songDir, "candidates", candidateId, "score.abc");
    if (fs.existsSync(abcPath)) {
        try { return fs.readFileSync(abcPath, "utf-8"); } catch { /* fall through */ }
    }
    return null;
}

// ─── Main export logic ────────────────────────────────────────────────────────
/**
 * Resolves whether the internal critic approved this candidate.
 *
 * Primary source: manifest.internalCriticApproval.approved
 * Fallback (old manifests without saved approval): finalCraftScore >= 0.70
 */
function isCriticApproved(manifest) {
    if (manifest.internalCriticApproval !== undefined) {
        return manifest.internalCriticApproval.approved === true;
    }
    // Fallback for manifests generated before internalCriticApproval was added
    const scores = extractScores(manifest);
    return scores.finalCraftScore !== null && scores.finalCraftScore >= CRITIC_FALLBACK_THRESHOLD;
}

function buildRecord(songId, candidateId, manifest, songDir) {
    const scores = extractScores(manifest);

    // Score gate
    if (scores.finalCraftScore !== null && scores.finalCraftScore < minScore) return null;

    // PRIMARY GATE: Internal critic approval
    // --approved-only filters on InternalCriticApproval.approved (not manifest.selected)
    const criticApproved = isCriticApproved(manifest);
    if (approvedOnly && !criticApproved) return null;

    // Secondary: human selection gate (opt-in)
    if (selectionOnly && manifest.selected !== true) return null;

    // Secondary: calibration quality gate (opt-in)
    if (listenerGate !== null) {
        const cal = manifest.curatorCalibration ?? manifest.listenerFeedback;
        const rating = cal?.qualityRating ?? cal?.appeal ?? null;
        if (rating === null || rating < listenerGate) return null;
    }

    const approvedAbc = extractApprovedAbc(manifest, songDir, candidateId);
    if (!approvedAbc) return null; // no ABC → skip (no output to train on)

    const inputFields     = extractInputFields(manifest);
    const repairInfo      = extractRepairHistory(manifest);
    const calibrationInfo = extractCalibration(manifest);
    const failedDimensions = manifest.internalCriticApproval?.failedDimensions ?? [];

    return {
        input: {
            ...inputFields,
        },
        output: {
            approvedAbc,
        },
        metadata: {
            songId,
            candidateId,
            criticApproved,
            selected: manifest.selected === true,
            scoringProfileId: manifest.internalCriticApproval?.scoringProfileId
                ?? manifest.scoringProfileId
                ?? null,
            ...scores,
            failedDimensions,
            ...repairInfo,
            ...calibrationInfo,
            exportedAt: new Date().toISOString(),
        },
    };
}

function run() {
    const songDirs = listSongDirs(outputRoot);

    if (songDirs.length === 0 && !dryRun) {
        console.warn(`[export-sft-dataset] No song directories found under '${outputRoot}'.`);
        console.warn("  Run AXIOM generation first, or check --root= argument.");
    }

    const records = [];
    let totalCandidates = 0;
    let skippedNoAbc    = 0;
    let skippedScore    = 0;
    let skippedCritic   = 0;
    let skippedSelection = 0;
    let skippedCalibration = 0;

    for (const songDir of songDirs) {
        const songId = path.basename(songDir);
        const index  = loadCandidateIndex(songDir);
        if (!index) continue;

        const candidateIds = Array.isArray(index)
            ? index
            : (index.candidates ?? Object.keys(index));

        for (const candidateId of candidateIds) {
            totalCandidates++;
            const manifest = loadCandidateManifest(songDir, candidateId);
            if (!manifest) continue;

            // PRIMARY GATE: internal critic approval
            if (approvedOnly && !isCriticApproved(manifest)) { skippedCritic++; continue; }

            // Secondary selection gate
            if (selectionOnly && manifest.selected !== true) { skippedSelection++; continue; }

            // Secondary calibration gate
            if (listenerGate !== null) {
                const cal = manifest.curatorCalibration ?? manifest.listenerFeedback;
                const rating = cal?.qualityRating ?? cal?.appeal ?? null;
                if (rating === null || rating < listenerGate) { skippedCalibration++; continue; }
            }

            const scores = extractScores(manifest);
            if (scores.finalCraftScore !== null && scores.finalCraftScore < minScore) {
                skippedScore++; continue;
            }

            const abc = extractApprovedAbc(manifest, songDir, candidateId);
            if (!abc) { skippedNoAbc++; continue; }

            const record = buildRecord(songId, candidateId, manifest, songDir);
            if (record) records.push(record);
        }
    }

    // Stats
    const criticApprovedCount = records.filter((r) => r.metadata.criticApproved).length;
    const selectedCount   = records.filter((r) => r.metadata.selected).length;
    const withRepair      = records.filter((r) => r.metadata.hasRepairHistory).length;
    const withCalibration = records.filter((r) => r.metadata.calibrationAppeal !== undefined).length;
    const withMotif       = records.filter((r) => r.input.motifGraphBlock !== undefined).length;
    const withHarmony     = records.filter((r) => r.input.repairBlock !== undefined).length;
    const withPiano       = records.filter((r) => r.input.pianoRewriteBlock !== undefined).length;

    console.log("=== SFT Dataset Export Summary ===");
    console.log(`  Song directories:      ${songDirs.length}`);
    console.log(`  Total candidates:      ${totalCandidates}`);
    console.log(`  Exported:              ${records.length}`);
    console.log(`    critic-approved:     ${criticApprovedCount}`);
    console.log(`    human-selected:      ${selectedCount}`);
    console.log(`    with repair hist:    ${withRepair}`);
    console.log(`    with calibration:    ${withCalibration}`);
    console.log(`    with motifGraph:     ${withMotif}`);
    console.log(`    with repairBlock:    ${withHarmony}`);
    console.log(`    with pianoRewrite:   ${withPiano}`);
    console.log(`  Skipped (no ABC):      ${skippedNoAbc}`);
    console.log(`  Skipped (score gate):  ${skippedScore}`);
    console.log(`  Skipped (critic gate): ${skippedCritic}`);
    console.log(`  Skipped (selection):   ${skippedSelection}`);
    console.log(`  Skipped (calibration): ${skippedCalibration}`);

    if (dryRun) {
        console.log("\n[dry-run] No file written.");
        return;
    }

    if (records.length === 0) {
        console.warn("\n[export-sft-dataset] 0 records to export. No JSONL file written.");
        return;
    }

    ensureDir(path.dirname(outFile));
    const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    fs.writeFileSync(outFile, jsonl, "utf-8");
    console.log(`\nWrote ${records.length} record(s) → ${outFile}`);
}

try {
    run();
} catch (err) {
    console.error("[export-sft-dataset] Fatal error:", err.message);
    exit(1);
}
