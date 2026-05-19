/**
 * export-sft-dataset.mjs
 *
 * Exports approved AXIOM candidates as a Supervised Fine-Tuning (SFT) dataset
 * in JSONL format for training AXIOM-control-following NotaGen adapters.
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
 *     - status                  "approved" | "rejected"
 *     - scoringProfileId        profile used for scoring
 *     - evidenceCoverageScore   evidence completeness score
 *     - finalCraftScore         heuristic gate score
 *     - advancedCraftScore      plan-aware composite score
 *     - harmonyContractScore    harmony evidence completeness
 *     - pianoListenabilityScore piano-specific listenability (if available)
 *     - hasRepairHistory        whether any repair directives were applied
 *     - repairKinds[]           kinds of repairs applied (if any)
 *     - feedbackAppeal?         human feedback appeal rating (if available)
 *     - feedbackPreferredOver?  candidateId this was preferred over (if available)
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
 *   --approved-only        only include approved candidates (skips rejected)
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

const outputRoot   = readOption("root") ?? "outputs";
const outFile      = readOption("out")  ?? path.join(outputRoot, "_system", "sft-dataset.jsonl");
const minScore     = parseFloat(readOption("min-score") ?? "0.0");
const approvedOnly = hasFlag("approved-only");
const dryRun       = hasFlag("dry-run");

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

function extractFeedback(manifest) {
    const fb = manifest.listenerFeedback ?? manifest.feedback ?? null;
    if (!fb) return {};
    return {
        ...(fb.appeal          !== undefined ? { feedbackAppeal:       fb.appeal }          : {}),
        ...(fb.coherence       !== undefined ? { feedbackCoherence:    fb.coherence }       : {}),
        ...(fb.memorability    !== undefined ? { feedbackMemorability: fb.memorability }    : {}),
        ...(fb.emotionalImpact !== undefined ? { feedbackEmotionalImpact: fb.emotionalImpact } : {}),
        ...(fb.preferredOver   !== undefined ? { feedbackPreferredOver: fb.preferredOver }  : {}),
        ...(fb.rejectionReason !== undefined ? { feedbackRejectionReason: fb.rejectionReason } : {}),
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
function buildRecord(songId, candidateId, manifest, songDir) {
    const scores = extractScores(manifest);

    // Score gate
    if (scores.finalCraftScore !== null && scores.finalCraftScore < minScore) return null;

    // Status gate
    const status = manifest.selected === true ? "approved" : "rejected";
    if (approvedOnly && status !== "approved") return null;

    const approvedAbc = extractApprovedAbc(manifest, songDir, candidateId);
    if (!approvedAbc) return null; // no ABC → skip (no output to train on)

    const inputFields  = extractInputFields(manifest);
    const repairInfo   = extractRepairHistory(manifest);
    const feedbackInfo = extractFeedback(manifest);

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
            status,
            scoringProfileId: manifest.scoringProfileId ?? null,
            ...scores,
            ...repairInfo,
            ...feedbackInfo,
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
    let skippedNoAbc  = 0;
    let skippedScore  = 0;
    let skippedStatus = 0;

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

            const status = manifest.selected === true ? "approved" : "rejected";
            if (approvedOnly && status !== "approved") { skippedStatus++; continue; }

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
    const approvedCount = records.filter((r) => r.metadata.status === "approved").length;
    const withRepair    = records.filter((r) => r.metadata.hasRepairHistory).length;
    const withFeedback  = records.filter((r) => r.metadata.feedbackAppeal !== undefined).length;
    const withMotif     = records.filter((r) => r.input.motifGraphBlock !== undefined).length;
    const withHarmony   = records.filter((r) => r.input.repairBlock !== undefined).length;
    const withPiano     = records.filter((r) => r.input.pianoRewriteBlock !== undefined).length;

    console.log("=== SFT Dataset Export Summary ===");
    console.log(`  Song directories:   ${songDirs.length}`);
    console.log(`  Total candidates:   ${totalCandidates}`);
    console.log(`  Exported:           ${records.length}`);
    console.log(`    approved:         ${approvedCount}`);
    console.log(`    with repair hist: ${withRepair}`);
    console.log(`    with feedback:    ${withFeedback}`);
    console.log(`    with motifGraph:  ${withMotif}`);
    console.log(`    with repairBlk:   ${withHarmony}`);
    console.log(`    with pianoRewrite:${withPiano}`);
    console.log(`  Skipped (no ABC):   ${skippedNoAbc}`);
    console.log(`  Skipped (score):    ${skippedScore}`);
    console.log(`  Skipped (status):   ${skippedStatus}`);

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
