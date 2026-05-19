/**
 * export-notagen-preference-dataset.mjs
 *
 * Exports AXIOM-critic DPO (Direct Preference Optimization) pairs from candidate
 * manifests for training AXIOM-control-following NotaGen preference models.
 *
 * ── PHILOSOPHY (v2 — AXIOM-critic DPO) ─────────────────────────────────────────
 *
 * Human preference DPO requires costly human labeling and introduces listener
 * bias that conflicts with AXIOM's core goal: generating structurally excellent
 * classical compositions aligned to the AXIOM control contract.
 *
 * Instead, DPO pairs are derived entirely from the AXIOM internal critic:
 *
 *   CHOSEN  (positive):  candidate that passes all AXIOM critic gates AND was
 *                        selected as the best candidate for its song/planSignature
 *
 *   REJECTED (negative): candidate from the same planSignature that failed at
 *                        least one AXIOM critic gate with a meaningful score gap
 *
 * Human feedback (listenerFeedback / curatorCalibration) is preserved in the row
 * metadata for optional downstream calibration but does NOT determine pair labels.
 *
 * ── AXIOM CRITIC GATES (same as SFT) ───────────────────────────────────────────
 *   1. Has abcText and controlLines (structural)
 *   2. Not a mock backend output
 *   3. finalCraftScore >= 0.70
 *   4. advancedCraftScore >= 0.60
 *   5. harmonyContractScore >= 0.70  (skipped when no harmony plan)
 *   6. evidenceCoverageScore >= 0.55
 *   7. pianoListenabilityScore >= 0.50  (piano candidates only)
 *
 * ── DPO PAIR ELIGIBILITY ────────────────────────────────────────────────────────
 *
 *   CHOSEN  = passes all 7 gates AND selected=true
 *   REJECTED = same planSignature; fails >= 1 gate with a meaningful gap:
 *              score gap >= 0.10 below threshold, OR harmonyContractViolations > 0,
 *              OR motifReturnScore <= 0.30, OR evidenceCoverageGateTier = "partial"|"none"
 *
 *   Hard negatives are preferred: same prompt + AXIOM-identified failures
 *   Pairs are grouped by planSignature (not songId) for maximum signal density
 *
 * ── OUTPUT FILES ───────────────────────────────────────────────────────────────
 *   dpo-critic-pairs.jsonl  — (chosen, rejected) pairs with full control blocks
 *   candidates.jsonl        — all classified candidates (for analysis)
 *   summary.json            — export statistics
 *
 * Usage:
 *   node scripts/export-notagen-preference-dataset.mjs [options]
 *
 * Options:
 *   --root=<dir>             outputs root (default: outputs)
 *   --snapshot=<YYYY-MM-DD>  snapshot ID for output path (default: today)
 *   --min-craft=<n>          finalCraftScore threshold (default: 0.70)
 *   --min-advanced=<n>       advancedCraftScore threshold (default: 0.60)
 *   --min-harmony=<n>        harmonyContractScore threshold (default: 0.70)
 *   --min-evidence=<n>       evidenceCoverageScore threshold (default: 0.55)
 *   --min-piano=<n>          pianoListenabilityScore threshold (default: 0.50)
 *   --min-score-gap=<n>      min score gap below threshold to qualify as hard negative (default: 0.05)
 *   --include-mock            include mock backend outputs (default: excluded)
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
const DRY_RUN      = hasFlag("dry-run");

const THRESHOLDS = {
    finalCraftScore:         parseThreshold("min-craft",    0.70),
    advancedCraftScore:      parseThreshold("min-advanced", 0.60),
    harmonyContractScore:    parseThreshold("min-harmony",  0.70),
    evidenceCoverageScore:   parseThreshold("min-evidence", 0.55),
    pianoListenabilityScore: parseThreshold("min-piano",    0.50),
};

const MIN_SCORE_GAP = parseThreshold("min-score-gap", 0.05);

// ---------------------------------------------------------------------------
// Score extraction (mirrors export-notagen-sft-dataset.mjs)
// ---------------------------------------------------------------------------

function extractScores(cm) {
    const ica = cm?.internalCriticApproval ?? null;
    const cs  = cm?.structureEvaluation?.craftScoreSummary ?? null;
    const pc  = cm?.structureEvaluation?.pianoCraftScoreSummary ?? cm?.pianoCraftScore ?? null;
    return {
        internalCriticApproved:     ica?.approved ?? null,
        internalCriticFailedDims:   ica?.failedDimensions ?? null,
        finalCraftScore:            toFinite(ica?.finalCraftScore ?? cs?.finalCraftScore),
        advancedCraftScore:         toFinite(ica?.advancedCraftScore ?? cs?.advancedCraftScore),
        harmonyContractScore:       toFinite(ica?.harmonyContractScore ?? cs?.harmonyContractScore),
        evidenceCoverageScore:      toFinite(ica?.evidenceCoverageScore ?? cs?.evidenceCoverageScore),
        evidenceCoverageGateTier:   cs?.evidenceCoverageGateTier ?? null,
        harmonyContractViolations:  toFinite(cs?.harmonyContractViolations ?? ica?.harmonyContractViolations),
        motifReturnScore:           toFinite(cs?.motifReturnScore ?? cs?.motifRecapIdentity),
        pianoListenabilityScore:    toFinite(ica?.pianoListenabilityScore ?? pc?.pianoListenabilityScore ?? cs?.pianoListenabilityScore),
        isPianoCandidate:           pc !== null,
        scoringProfileId:           ica?.scoringProfileId ?? cs?.scoringProfile ?? null,
    };
}

// ---------------------------------------------------------------------------
// AXIOM critic eligibility
// ---------------------------------------------------------------------------

/**
 * @returns {{ pass: boolean, failedGates: string[] }}
 */
function computeCriticResult(cm, { includeMock }) {
    const failedGates = [];

    // Structural
    const evidence = cm?.proposalEvidence ?? {};
    const abcText = typeof evidence.abcText === "string" && evidence.abcText.trim();
    if (!abcText) failedGates.push("no_abc_text");

    const pr = evidence.providerRequest ?? cm?.learnedNotagenProviderRequest ?? null;
    const hasControlLines = pr && Array.isArray(pr.controlLines) && pr.controlLines.some((l) => typeof l === "string" && l.trim());
    if (!hasControlLines) failedGates.push("no_control_lines");

    const generationMode = toTrimmed(evidence.generationMode ?? cm?.meta?.generationMode ?? "");
    if (!includeMock && generationMode.toLowerCase().includes("mock")) {
        failedGates.push("mock_excluded");
    }

    // Score gates
    const s = extractScores(cm);

    if (s.internalCriticApproved === false) {
        for (const dim of s.internalCriticFailedDims ?? []) {
            failedGates.push(`critic_failed:${dim}`);
        }
    } else if (s.internalCriticApproved === null) {
        if (s.finalCraftScore === undefined) {
            failedGates.push("missing_finalCraftScore");
        } else if (s.finalCraftScore < THRESHOLDS.finalCraftScore) {
            failedGates.push(`below_finalCraft(${s.finalCraftScore?.toFixed(3)}<${THRESHOLDS.finalCraftScore})`);
        }
        if (s.advancedCraftScore !== undefined && s.advancedCraftScore < THRESHOLDS.advancedCraftScore) {
            failedGates.push(`below_advancedCraft(${s.advancedCraftScore?.toFixed(3)}<${THRESHOLDS.advancedCraftScore})`);
        }
        if (s.harmonyContractScore !== undefined && s.harmonyContractScore < THRESHOLDS.harmonyContractScore) {
            failedGates.push(`below_harmonyContract(${s.harmonyContractScore?.toFixed(3)}<${THRESHOLDS.harmonyContractScore})`);
        }
        if (s.evidenceCoverageScore !== undefined && s.evidenceCoverageScore < THRESHOLDS.evidenceCoverageScore) {
            failedGates.push(`below_evidenceCoverage(${s.evidenceCoverageScore?.toFixed(3)}<${THRESHOLDS.evidenceCoverageScore})`);
        }
        if (s.isPianoCandidate && s.pianoListenabilityScore !== undefined
            && s.pianoListenabilityScore < THRESHOLDS.pianoListenabilityScore) {
            failedGates.push(`below_pianoListenability(${s.pianoListenabilityScore?.toFixed(3)}<${THRESHOLDS.pianoListenabilityScore})`);
        }
    }

    return { pass: failedGates.length === 0, failedGates };
}

/**
 * Determines whether a failed candidate is a "hard negative" — i.e., failed by
 * a meaningful margin, not just barely below threshold.
 *
 * Returns true when:
 *   - Any score gate failed by more than MIN_SCORE_GAP below threshold, OR
 *   - harmonyContractViolations > 0, OR
 *   - evidenceCoverageGateTier = "partial" or "none", OR
 *   - motifReturnScore <= 0.30
 */
function isHardNegative(s) {
    if (s.harmonyContractViolations !== undefined && s.harmonyContractViolations > 0) return true;
    if (s.evidenceCoverageGateTier === "partial" || s.evidenceCoverageGateTier === "none") return true;
    if (s.motifReturnScore !== undefined && s.motifReturnScore <= 0.30) return true;
    if (s.finalCraftScore !== undefined && s.finalCraftScore < THRESHOLDS.finalCraftScore - MIN_SCORE_GAP) return true;
    if (s.advancedCraftScore !== undefined && s.advancedCraftScore < THRESHOLDS.advancedCraftScore - MIN_SCORE_GAP) return true;
    if (s.harmonyContractScore !== undefined && s.harmonyContractScore < THRESHOLDS.harmonyContractScore - MIN_SCORE_GAP) return true;
    if (s.evidenceCoverageScore !== undefined && s.evidenceCoverageScore < THRESHOLDS.evidenceCoverageScore - MIN_SCORE_GAP) return true;
    if (s.isPianoCandidate && s.pianoListenabilityScore !== undefined
        && s.pianoListenabilityScore < THRESHOLDS.pianoListenabilityScore - MIN_SCORE_GAP) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Instruction builder (mirrors SFT export with AXIOM blocks)
// ---------------------------------------------------------------------------

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
    if (typeof pr.motifGraphBlock === "string" && pr.motifGraphBlock.trim()) {
        parts.push(pr.motifGraphBlock.trim());
    }
    if (typeof pr.repairBlock === "string" && pr.repairBlock.trim()) {
        parts.push(pr.repairBlock.trim());
    }
    if (typeof pr.pianoRewriteBlock === "string" && pr.pianoRewriteBlock.trim()) {
        parts.push(pr.pianoRewriteBlock.trim());
    }
    return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Manifest loading
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
    return loadJsonIfExists(path.join(songDir, "candidates", candidateId, "candidate-manifest.json"), null);
}

function listAllCandidateIds(idx) {
    if (!idx) return [];
    if (Array.isArray(idx.entries)) {
        return idx.entries.map((e) => toTrimmed(e?.candidateId)).filter(Boolean);
    }
    if (Array.isArray(idx.candidates)) return idx.candidates.map(toTrimmed).filter(Boolean);
    return Object.keys(idx).filter((k) => k !== "selectedCandidateId" && k !== "updatedAt");
}

function resolveSelectedCandidateId(idx) {
    if (!idx) return undefined;
    if (toTrimmed(idx.selectedCandidateId)) return toTrimmed(idx.selectedCandidateId);
    const entries = Array.isArray(idx.entries) ? idx.entries : [];
    const sel = entries.find((e) => Boolean(e?.selected));
    return sel ? toTrimmed(sel.candidateId) : undefined;
}

// ---------------------------------------------------------------------------
// Candidate record
// ---------------------------------------------------------------------------

function buildCandidateRecord(songId, candidateId, cm, isSelected) {
    const evidence = cm?.proposalEvidence ?? {};
    const pr = evidence.providerRequest ?? cm?.learnedNotagenProviderRequest ?? null;
    const criticResult = computeCriticResult(cm, { includeMock: INCLUDE_MOCK });
    const scores = extractScores(cm);
    const planSignature = toTrimmed(evidence.planSignature) || undefined;
    const generationMode = toTrimmed(evidence.generationMode ?? cm?.meta?.generationMode ?? "");
    const instruction = buildInstruction(pr);
    const abcText = typeof evidence.abcText === "string" && evidence.abcText.trim()
        ? evidence.abcText : null;

    // Human calibration signals (metadata only, not gate)
    const cal = cm?.curatorCalibration ?? null;
    const fb  = cm?.listenerFeedback ?? null;
    const humanRating = toFinite(cal?.qualityRating ?? fb?.appeal);

    return {
        id: stableHash([songId, candidateId, planSignature ?? "", generationMode]),
        songId,
        candidateId,
        planSignature: planSignature ?? null,
        selected: isSelected,
        generationMode,
        instruction,
        abcText,
        criticPass: criticResult.pass,
        failedGates: criticResult.failedGates,
        isHardNegative: !criticResult.pass && isHardNegative(scores),
        scores: {
            finalCraftScore:           scores.finalCraftScore ?? null,
            advancedCraftScore:        scores.advancedCraftScore ?? null,
            harmonyContractScore:      scores.harmonyContractScore ?? null,
            evidenceCoverageScore:     scores.evidenceCoverageScore ?? null,
            evidenceCoverageGateTier:  scores.evidenceCoverageGateTier ?? null,
            harmonyContractViolations: scores.harmonyContractViolations ?? null,
            motifReturnScore:          scores.motifReturnScore ?? null,
            pianoListenabilityScore:   scores.pianoListenabilityScore ?? null,
            scoringProfileId:          scores.scoringProfileId ?? null,
        },
        // Human calibration metadata (preserved for downstream calibration; not used for labeling)
        humanCalibration: humanRating !== undefined ? {
            rating: humanRating,
            source: cal ? "curator" : "listener",
            preferredOver:   toTrimmed(fb?.preferredOver || "") || null,
            rejectionReason: toTrimmed(fb?.rejectionReason || cal?.rejectionReason || "") || null,
        } : null,
    };
}

// ---------------------------------------------------------------------------
// DPO pair building
// ---------------------------------------------------------------------------

/**
 * Build DPO pairs from a list of candidate records grouped by planSignature.
 *
 * Each pair: { chosen, rejected, pairId, rejectionReasonSummary }
 *
 *   chosen   = criticPass=true AND selected=true
 *   rejected = same planSignature; criticPass=false AND isHardNegative=true
 *
 * Multiple negatives per chosen are allowed (hard negatives only).
 */
function buildDpoPairs(byPlanSignature) {
    const pairs = [];

    for (const [sig, group] of Object.entries(byPlanSignature)) {
        const chosen   = group.filter((c) => c.criticPass && c.selected && c.instruction && c.abcText);
        const rejected = group.filter((c) => !c.criticPass && c.isHardNegative && c.instruction && c.abcText);

        for (const pos of chosen) {
            for (const neg of rejected) {
                pairs.push({
                    pairId: stableHash([pos.id, neg.id]),
                    planSignature: sig,
                    label: "axiom_critic_dpo",
                    chosen: {
                        id: pos.id,
                        songId: pos.songId,
                        candidateId: pos.candidateId,
                        instruction: pos.instruction,
                        output: pos.abcText,
                        scores: pos.scores,
                    },
                    rejected: {
                        id: neg.id,
                        songId: neg.songId,
                        candidateId: neg.candidateId,
                        instruction: neg.instruction,
                        output: neg.abcText,
                        failedGates: neg.failedGates,
                        scores: neg.scores,
                    },
                    // Explain WHY this is a useful negative for training
                    rejectionReasonSummary: summarizeRejection(neg),
                });
            }
        }
    }

    return pairs;
}

/**
 * Human-readable summary of why a candidate is a DPO negative.
 * Used to verify pair quality at a glance.
 */
function summarizeRejection(rec) {
    const reasons = [];
    const s = rec.scores;
    if (s.harmonyContractViolations && s.harmonyContractViolations > 0) {
        reasons.push(`harmony_violations=${s.harmonyContractViolations}`);
    }
    if (s.evidenceCoverageGateTier === "partial" || s.evidenceCoverageGateTier === "none") {
        reasons.push(`evidence_gate=${s.evidenceCoverageGateTier}`);
    }
    if (s.motifReturnScore !== null && s.motifReturnScore <= 0.30) {
        reasons.push(`motif_return_low=${s.motifReturnScore?.toFixed(3)}`);
    }
    if (rec.failedGates.length > 0 && reasons.length === 0) {
        reasons.push(rec.failedGates[0]);
    }
    return reasons.join("; ") || "below_threshold";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const songIds = listSongDirs(OUTPUT_ROOT);
    if (songIds.length === 0 && !DRY_RUN) {
        console.warn("[export-notagen-preference-dataset] No song directories found under:", OUTPUT_ROOT);
    }

    const allCandidates = [];
    const byPlanSignature = {};

    const counts = {
        totalSongs: songIds.length,
        totalCandidates: 0,
        criticPass: 0,
        criticFail: 0,
        hardNegatives: 0,
        chosen: 0,
        skippedNoInstruction: 0,
        skippedNoAbc: 0,
    };

    for (const songId of songIds) {
        const songDir = path.join(OUTPUT_ROOT, songId);
        const idx = loadCandidateIndex(songDir);
        const candidateIds = listAllCandidateIds(idx);
        const selectedId = resolveSelectedCandidateId(idx);

        for (const candidateId of candidateIds) {
            counts.totalCandidates++;
            const cm = loadCandidateManifest(songDir, candidateId);
            if (!cm) continue;

            const isSelected = candidateId === selectedId;
            const rec = buildCandidateRecord(songId, candidateId, cm, isSelected);
            allCandidates.push(rec);

            if (rec.criticPass) {
                counts.criticPass++;
                if (isSelected) counts.chosen++;
            } else {
                counts.criticFail++;
                if (rec.isHardNegative) counts.hardNegatives++;
            }

            if (!rec.instruction) { counts.skippedNoInstruction++; continue; }
            if (!rec.abcText)     { counts.skippedNoAbc++;         continue; }

            const sig = rec.planSignature ?? stableHash([songId]);
            if (!byPlanSignature[sig]) byPlanSignature[sig] = [];
            byPlanSignature[sig].push(rec);
        }
    }

    const dpoPairs = buildDpoPairs(byPlanSignature);
    const pairsWithHardNeg = dpoPairs.filter((p) => p.rejected.failedGates.length > 0).length;

    console.log("=== NotaGen AXIOM-Critic DPO Export ===");
    console.log(`  Songs:                  ${counts.totalSongs}`);
    console.log(`  Candidates scanned:     ${counts.totalCandidates}`);
    console.log(`  AXIOM critic pass:      ${counts.criticPass}  (chosen: ${counts.chosen})`);
    console.log(`  AXIOM critic fail:      ${counts.criticFail}  (hard negatives: ${counts.hardNegatives})`);
    console.log(`  DPO pairs generated:    ${dpoPairs.length}  (hard-neg pairs: ${pairsWithHardNeg})`);
    console.log(`  Skipped no-instruction: ${counts.skippedNoInstruction}`);
    console.log(`  Skipped no-ABC:         ${counts.skippedNoAbc}`);

    if (DRY_RUN) {
        console.log("\n[dry-run] No files written.");
        return;
    }

    const systemDir  = path.join(OUTPUT_ROOT, "_system", "ml", "notagen-dpo-critic", SNAPSHOT_ID);
    const pairsPath  = path.join(systemDir, "dpo-critic-pairs.jsonl");
    const candPath   = path.join(systemDir, "candidates.jsonl");
    const summaryPath = path.join(systemDir, "summary.json");

    writeJsonlFile(pairsPath,  dpoPairs);
    writeJsonlFile(candPath,   allCandidates);
    writeJsonFile(summaryPath, {
        snapshotId: SNAPSHOT_ID,
        exportedAt: new Date().toISOString(),
        philosophy: "axiom_critic_dpo",
        ...counts,
        dpoPairCount: dpoPairs.length,
        hardNegPairCount: pairsWithHardNeg,
        thresholds: THRESHOLDS,
        minScoreGap: MIN_SCORE_GAP,
        includeMock: INCLUDE_MOCK,
        outputRoot: OUTPUT_ROOT,
        files: { dpoCriticPairs: pairsPath, candidates: candPath },
    });
    console.log(`\nWrote ${dpoPairs.length} DPO pair(s) -> ${pairsPath}`);
}

main();
