/**
 * export-notagen-sft-dataset.mjs
 *
 * Exports supervised fine-tuning (SFT) training pairs from AXIOM candidate
 * manifests for training AXIOM-control-following NotaGen adapters.
 *
 * APPROVAL PHILOSOPHY (v2 — AXIOM-curated):
 *   PRIMARY GATE:  AXIOM internal critic (craft scores + evidence coverage)
 *   SECONDARY:     Human curator calibration (optional confidence boost only)
 *   NOT A GATE:    manifest.approvalStatus, manifest.selected, listenerFeedback
 *
 * A candidate is eligible for SFT when it passes ALL of:
 *   1. Has abcText and controlLines (structural requirement)
 *   2. Not a mock backend output (quality requirement)
 *   3. finalCraftScore >= threshold  (default 0.70)
 *   4. advancedCraftScore >= threshold  (default 0.60)
 *   5. harmonyContractScore >= threshold  (default 0.70; skipped when no harmony plan)
 *   6. evidenceCoverageScore >= threshold  (default 0.55)
 *   7. pianoListenabilityScore >= threshold  (default 0.50; piano candidates only)
 *
 * Human feedback (curatorCalibration or listenerFeedback) raises the
 * confidence score but does NOT gate eligibility.
 *
 * ALL candidates per song are considered — not just the selected one.
 * This maximises training signal from the generation pipeline.
 *
 * Stage 1 (current): NotaGen native → candidates → craft scoring + reranking
 * Stage 2 (target):  fine-tuned adapter → AXIOM-control-following generation
 *
 * Each SFT row is an (instruction, output) pair:
 *   instruction  AXIOM control block fed to the symbolic backend
 *   output       full ABC score text produced by the backend
 *
 * Usage:
 *   node scripts/export-notagen-sft-dataset.mjs [options]
 *
 * Options:
 *   --root=<dir>             outputs root (default: outputs)
 *   --snapshot=<YYYY-MM-DD>  snapshot ID for output path (default: today)
 *   --min-craft=<n>          finalCraftScore threshold (default: 0.70)
 *   --min-advanced=<n>       advancedCraftScore threshold (default: 0.60)
 *   --min-harmony=<n>        harmonyContractScore threshold (default: 0.70)
 *   --min-evidence=<n>       evidenceCoverageScore threshold (default: 0.55)
 *   --min-piano=<n>          pianoListenabilityScore threshold (default: 0.50)
 *   --include-mock            include mock backend outputs (default: excluded)
 *   --include-not-selected    include non-selected candidates (default: included)
 *   --selected-only           only include selected candidates
 *   --dry-run                 print stats without writing files
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
function toFinite(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) { const p = Number(v); return Number.isFinite(p) ? p : undefined; }
    return undefined;
}
function daySnapshotId(now = new Date()) { return now.toISOString().slice(0, 10); }
function stableHash(parts) {
    return createHash("sha256").update(parts.join("|"), "utf-8").digest("hex").slice(0, 16);
}
function parseThreshold(flag, def) {
    const raw = readOption(flag);
    if (raw === undefined) return def;
    const v = Number(raw);
    return Number.isFinite(v) ? v : def;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OUTPUT_ROOT  = toTrimmed(readOption("root") || process.env.OUTPUT_DIR || "outputs") || "outputs";
const SNAPSHOT_ID  = toTrimmed(readOption("snapshot") || daySnapshotId()) || daySnapshotId();
const INCLUDE_MOCK = hasFlag("include-mock");
const SELECTED_ONLY = hasFlag("selected-only");
const DRY_RUN      = hasFlag("dry-run");

/** Eligibility thresholds — mirrors INTERNAL_CRITIC_APPROVAL_THRESHOLDS_V1 */
const THRESHOLDS = {
    finalCraftScore:       parseThreshold("min-craft",    0.70),
    advancedCraftScore:    parseThreshold("min-advanced", 0.60),
    harmonyContractScore:  parseThreshold("min-harmony",  0.70),
    evidenceCoverageScore: parseThreshold("min-evidence", 0.55),
    pianoListenabilityScore: parseThreshold("min-piano",  0.50),
};

// ---------------------------------------------------------------------------
// CandidateTrainingEligibility
//
// @typedef {Object} CandidateTrainingEligibility
// @property {boolean} eligibleForSft
// @property {boolean} eligibleForPreference
// @property {"axiom_internal_critic"|"human_curated"|"hybrid"} eligibilitySource
// @property {string[]} reasons           - list of failed checks when not eligible
// @property {number}   confidenceScore   - 0–1; boosted by human calibration
// ---------------------------------------------------------------------------

/**
 * Extracts craft scores from a candidate manifest.
 * Looks in: internalCriticApproval (pre-computed) → structureEvaluation.craftScoreSummary
 * Also reads pianoListenabilityScore from pianoCraftScore when absent from craftSummary.
 */
function extractCraftScores(cm) {
    const ica = cm?.internalCriticApproval ?? null;
    const cs  = cm?.structureEvaluation?.craftScoreSummary ?? null;
    const pc  = cm?.structureEvaluation?.pianoCraftScoreSummary ?? cm?.pianoCraftScore ?? null;

    return {
        // Pre-computed approval (most authoritative when present)
        internalCriticApproved: ica?.approved ?? null,
        internalCriticFailedDimensions: ica?.failedDimensions ?? null,
        // Raw scores (fallback when internalCriticApproval absent)
        finalCraftScore:        toFinite(ica?.finalCraftScore ?? cs?.finalCraftScore),
        advancedCraftScore:     toFinite(ica?.advancedCraftScore ?? cs?.advancedCraftScore),
        harmonyContractScore:   toFinite(ica?.harmonyContractScore ?? cs?.harmonyContractScore),
        evidenceCoverageScore:  toFinite(ica?.evidenceCoverageScore ?? cs?.evidenceCoverageScore),
        evidenceCoverageGateTier: cs?.evidenceCoverageGateTier ?? null,
        harmonyContractViolations: toFinite(cs?.harmonyContractViolations),
        pianoListenabilityScore: toFinite(
            ica?.pianoListenabilityScore ?? pc?.pianoListenabilityScore ?? cs?.pianoListenabilityScore,
        ),
        isPianoCandidate: pc !== null,
        scoringProfileId: ica?.scoringProfileId ?? cs?.scoringProfile ?? null,
    };
}

/**
 * Computes CandidateTrainingEligibility for one candidate manifest.
 *
 * Returns eligibleForSft=true only when ALL critic gates pass.
 * Human feedback raises confidenceScore but never gates inclusion.
 *
 * @param {object} cm   candidate manifest
 * @param {object} opts { includeMock: boolean }
 * @returns {CandidateTrainingEligibility}
 */
function computeEligibility(cm, { includeMock }) {
    const reasons = [];

    // ── Structural requirements ──────────────────────────────────────────────
    const evidence = cm?.proposalEvidence ?? {};
    const abcText = typeof evidence.abcText === "string" && evidence.abcText.trim()
        ? evidence.abcText : null;
    if (!abcText) reasons.push("no_abc_text");

    const instruction = buildInstruction(
        evidence.providerRequest
        ?? cm?.learnedNotagenProviderRequest
        ?? null,
    );
    if (!instruction) reasons.push("no_control_lines");

    const generationMode = toTrimmed(evidence.generationMode ?? cm?.meta?.generationMode ?? "");
    if (!includeMock && (generationMode.toLowerCase().includes("mock"))) {
        reasons.push("mock_excluded");
    }

    // ── AXIOM internal critic gate ───────────────────────────────────────────
    const scores = extractCraftScores(cm);

    // If internalCriticApproval was pre-computed and says rejected, trust it
    if (scores.internalCriticApproved === false) {
        for (const dim of scores.internalCriticFailedDimensions ?? []) {
            reasons.push(`critic_failed:${dim}`);
        }
    } else if (scores.internalCriticApproved === null) {
        // Pre-computed approval absent → compute from raw scores
        if (scores.finalCraftScore !== undefined) {
            if (scores.finalCraftScore < THRESHOLDS.finalCraftScore) {
                reasons.push(`below_finalCraftScore(${scores.finalCraftScore?.toFixed(3)}<${THRESHOLDS.finalCraftScore})`);
            }
        } else {
            reasons.push("missing_finalCraftScore");
        }

        if (scores.advancedCraftScore !== undefined) {
            if (scores.advancedCraftScore < THRESHOLDS.advancedCraftScore) {
                reasons.push(`below_advancedCraftScore(${scores.advancedCraftScore?.toFixed(3)}<${THRESHOLDS.advancedCraftScore})`);
            }
        }
        // harmonyContractScore: skip gate when undefined (no harmony plan sections)
        if (scores.harmonyContractScore !== undefined
            && scores.harmonyContractScore < THRESHOLDS.harmonyContractScore) {
            reasons.push(`below_harmonyContractScore(${scores.harmonyContractScore?.toFixed(3)}<${THRESHOLDS.harmonyContractScore})`);
        }
        if (scores.evidenceCoverageScore !== undefined
            && scores.evidenceCoverageScore < THRESHOLDS.evidenceCoverageScore) {
            reasons.push(`below_evidenceCoverageScore(${scores.evidenceCoverageScore?.toFixed(3)}<${THRESHOLDS.evidenceCoverageScore})`);
        }
        // Piano gate: only when piano candidate
        if (scores.isPianoCandidate && scores.pianoListenabilityScore !== undefined
            && scores.pianoListenabilityScore < THRESHOLDS.pianoListenabilityScore) {
            reasons.push(`below_pianoListenabilityScore(${scores.pianoListenabilityScore?.toFixed(3)}<${THRESHOLDS.pianoListenabilityScore})`);
        }
    }

    const eligibleForSft = reasons.length === 0;

    // ── eligibilitySource ────────────────────────────────────────────────────
    const criticPassed = eligibleForSft;
    const cal = cm?.curatorCalibration ?? null;
    const fb  = cm?.listenerFeedback  ?? null;
    const humanRating = toFinite(cal?.qualityRating ?? fb?.appeal);
    const humanApproved = humanRating !== undefined && humanRating >= 4;

    let eligibilitySource;
    if (criticPassed && humanApproved) eligibilitySource = "hybrid";
    else if (criticPassed)             eligibilitySource = "axiom_internal_critic";
    else if (humanApproved)            eligibilitySource = "human_curated"; // not eligible for SFT
    else                               eligibilitySource = "axiom_internal_critic";

    // ── confidenceScore: base from craft + human boost ───────────────────────
    let confidenceScore = 0.0;
    if (eligibleForSft) {
        const base = Math.min(1.0, (
            (scores.finalCraftScore ?? 0) * 0.40
            + (scores.advancedCraftScore ?? 0) * 0.35
            + (scores.evidenceCoverageScore ?? 0) * 0.25
        ) / 1.0);
        const humanBoost = humanApproved ? 0.10 : 0.0;
        confidenceScore = Math.min(1.0, base + humanBoost);
    }

    return {
        eligibleForSft,
        eligibleForPreference: eligibleForSft && cm?.selected === true,
        eligibilitySource,
        reasons,
        confidenceScore: Math.round(confidenceScore * 1000) / 1000,
        // Raw scores for metadata
        scores,
    };
}

// ---------------------------------------------------------------------------
// Instruction builder
// ---------------------------------------------------------------------------

/**
 * Build the SFT instruction string.
 * Mirrors the abc_prompt.py output format.
 *
 * Reads from (in priority order):
 *   1. providerRequest.conditioningText + providerRequest.controlLines
 *   2. learnedNotagenProviderRequest (same shape)
 */
function buildInstruction(pr) {
    if (!pr) return null;
    const txt = toTrimmed(pr.conditioningText);
    const lines = Array.isArray(pr.controlLines)
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
// Candidate loading
// ---------------------------------------------------------------------------

function listSongDirs(outputRoot) {
    if (!fs.existsSync(outputRoot)) return [];
    return fs.readdirSync(outputRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "_system")
        .map((e) => e.name).sort();
}
function loadCandidateIndex(songDir) {
    return loadJsonIfExists(path.join(songDir, "candidates", "index.json"), null);
}
function loadCandidateManifest(songDir, candidateId) {
    return loadJsonIfExists(
        path.join(songDir, "candidates", candidateId, "candidate-manifest.json"), null);
}

/** Returns all candidateIds in the index (selected and non-selected). */
function listAllCandidateIds(idx) {
    if (!idx) return [];
    if (Array.isArray(idx.entries)) {
        return idx.entries.map((e) => toTrimmed(e?.candidateId)).filter(Boolean);
    }
    if (Array.isArray(idx.candidates)) return idx.candidates.map(toTrimmed).filter(Boolean);
    return Object.keys(idx).filter((k) => k !== "selectedCandidateId" && k !== "updatedAt");
}

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

function buildSftRow(songId, candidateId, cm) {
    const elig = computeEligibility(cm, { includeMock: INCLUDE_MOCK });
    if (!elig.eligibleForSft) return { row: null, elig };

    if (SELECTED_ONLY && !cm?.selected) return { row: null, elig: { ...elig, reasons: ["not_selected"] } };

    const evidence = cm?.proposalEvidence ?? {};
    const pr = evidence.providerRequest ?? cm?.learnedNotagenProviderRequest ?? null;
    const instruction = buildInstruction(pr);
    if (!instruction) return { row: null, elig: { ...elig, reasons: [...elig.reasons, "no_instruction"] } };

    const abcText = typeof evidence.abcText === "string" && evidence.abcText.trim()
        ? evidence.abcText : null;
    if (!abcText) return { row: null, elig: { ...elig, reasons: [...elig.reasons, "no_abc_text"] } };

    const generationMode = toTrimmed(evidence.generationMode ?? cm?.meta?.generationMode ?? "");
    const planSignature  = toTrimmed(evidence.planSignature) || undefined;
    const { scores } = elig;

    return {
        row: {
            id: stableHash([songId, candidateId, planSignature ?? "", generationMode]),
            songId,
            candidateId,
            planSignature: planSignature ?? null,
            selected: cm?.selected === true,
            generationMode,
            instruction,
            output: abcText,
            meta: {
                eligibilitySource:    elig.eligibilitySource,
                confidenceScore:      elig.confidenceScore,
                provider:             toTrimmed(evidence.provider || cm?.provider) || null,
                model:                toTrimmed(evidence.model    || cm?.model)    || null,
                scoringProfileId:     scores.scoringProfileId ?? null,
                finalCraftScore:      scores.finalCraftScore ?? null,
                advancedCraftScore:   scores.advancedCraftScore ?? null,
                harmonyContractScore: scores.harmonyContractScore ?? null,
                evidenceCoverageScore: scores.evidenceCoverageScore ?? null,
                evidenceCoverageGateTier: scores.evidenceCoverageGateTier ?? null,
                harmonyContractViolations: scores.harmonyContractViolations ?? null,
                pianoListenabilityScore: scores.pianoListenabilityScore ?? null,
                normalizationWarnings: Array.isArray(evidence.normalizationWarnings)
                    ? evidence.normalizationWarnings : [],
            },
        },
        elig,
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const songIds = listSongDirs(OUTPUT_ROOT);
    if (songIds.length === 0 && !DRY_RUN) {
        console.warn("[export-notagen-sft-dataset] No song directories found under:", OUTPUT_ROOT);
    }

    const rows = [];
    const counts = {
        totalSongs: songIds.length,
        totalCandidates: 0,
        eligible: 0,
        skippedNoCraft: 0,
        skippedBelowThreshold: 0,
        skippedMock: 0,
        skippedNoAbc: 0,
        skippedNoInstruction: 0,
        skippedNotSelected: 0,
    };

    for (const songId of songIds) {
        const songDir = path.join(OUTPUT_ROOT, songId);
        const idx = loadCandidateIndex(songDir);
        const candidateIds = listAllCandidateIds(idx);

        for (const candidateId of candidateIds) {
            counts.totalCandidates++;
            const cm = loadCandidateManifest(songDir, candidateId);
            if (!cm) { counts.skippedNoCraft++; continue; }

            const { row, elig } = buildSftRow(songId, candidateId, cm);

            if (!row) {
                const r = elig.reasons.join(",");
                if (r.includes("mock_excluded"))      counts.skippedMock++;
                else if (r.includes("no_abc_text"))   counts.skippedNoAbc++;
                else if (r.includes("no_instruction") || r.includes("no_control_lines")) counts.skippedNoInstruction++;
                else if (r.includes("not_selected"))  counts.skippedNotSelected++;
                else if (r.includes("missing_finalCraftScore")) counts.skippedNoCraft++;
                else                                  counts.skippedBelowThreshold++;
                continue;
            }

            counts.eligible++;
            rows.push(row);
        }
    }

    // De-duplicate by (candidateId + first 256 chars of output)
    const seen = new Set();
    const deduped = rows.filter((row) => {
        const key = stableHash([row.candidateId, row.output.slice(0, 256)]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Stats breakdown
    const bySource = { axiom_internal_critic: 0, human_curated: 0, hybrid: 0 };
    const selectedCount = deduped.filter((r) => r.selected).length;
    for (const r of deduped) bySource[r.meta.eligibilitySource] = (bySource[r.meta.eligibilitySource] ?? 0) + 1;

    const summary = {
        snapshotId: SNAPSHOT_ID,
        exportedAt: new Date().toISOString(),
        ...counts,
        totalPairs: deduped.length,
        dedupedFrom: rows.length,
        byEligibilitySource: bySource,
        selectedCandidates: selectedCount,
        thresholds: THRESHOLDS,
        includeMock: INCLUDE_MOCK,
        selectedOnly: SELECTED_ONLY,
        outputRoot: OUTPUT_ROOT,
    };

    console.log("=== NotaGen SFT Dataset Export ===");
    console.log(`  Songs:                  ${counts.totalSongs}`);
    console.log(`  Candidates scanned:     ${counts.totalCandidates}`);
    console.log(`  Eligible pairs:         ${deduped.length}  (deduped from ${rows.length})`);
    console.log(`    axiom_internal_critic:  ${bySource.axiom_internal_critic}`);
    console.log(`    hybrid (+ human):       ${bySource.hybrid}`);
    console.log(`    selected candidate:     ${selectedCount}`);
    console.log(`  Skipped:`);
    console.log(`    below threshold:        ${counts.skippedBelowThreshold}`);
    console.log(`    mock backend:           ${counts.skippedMock}`);
    console.log(`    no ABC text:            ${counts.skippedNoAbc}`);
    console.log(`    no control lines:       ${counts.skippedNoInstruction}`);
    console.log(`    no craft scores:        ${counts.skippedNoCraft}`);
    console.log(`    not selected (flag):    ${counts.skippedNotSelected}`);

    if (DRY_RUN) {
        console.log("\n[dry-run] No files written.");
        return;
    }

    const systemDir = path.join(OUTPUT_ROOT, "_system", "ml", "notagen-sft", SNAPSHOT_ID);
    const sftPath     = path.join(systemDir, "sft-pairs.jsonl");
    const summaryPath = path.join(systemDir, "summary.json");
    writeJsonlFile(sftPath, deduped);
    writeJsonFile(summaryPath, { ...summary, files: { sftPairs: sftPath } });
    console.log(`\nWrote ${deduped.length} pair(s) → ${sftPath}`);
}

main();
