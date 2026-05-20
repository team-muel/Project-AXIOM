/**
 * export-notagen-sft-dataset.mjs
 *
 * Exports supervised fine-tuning (SFT) training pairs from AXIOM candidate
 * manifests for training AXIOM-control-following NotaGen adapters.
 *
 * APPROVAL PHILOSOPHY (v4 — human-gated + AXIOM-curated + tiered SFT quality):
 *   PRIMARY GATE:  AXIOM internal critic (craft scores + evidence coverage)
 *   HARD BLOCK:    humanRating <= 2 — excluded regardless of critic result (P0)
 *   HUMAN ANCHOR:  humanRating >= 4 + critic fail + structural OK →
 *                  written to human-anchor-sft-pairs.jsonl (P1)
 *   SECONDARY:     Human curator calibration (optional confidence boost only)
 *   NOT A GATE:    manifest.approvalStatus, manifest.selected, listenerFeedback
 *
 * A candidate is eligible for SFT when it passes ALL of:
 *   1. Has abcText and controlLines (structural requirement)
 *   2. Not a mock backend output (quality requirement)
 *   3. humanRating > 2  (P0: explicit human rejection is a hard block)
 *   4. finalCraftScore >= threshold  (default 0.70)
 *   5. advancedCraftScore >= threshold  (default 0.60)
 *   6. harmonyContractScore >= threshold  (default 0.70; skipped when no harmony plan)
 *   7. evidenceCoverageScore >= threshold  (default 0.55)
 *   8. pianoListenabilityScore >= threshold  (default 0.50; piano candidates only)
 *
 * SFT QUALITY TIERS (anti-collapse safety mechanism):
 *   gold   — high-quality SFT; sampleWeight=1.0; recommended for all training runs
 *            finalCraftScore >= 0.82, advancedCraftScore >= 0.75,
 *            harmonyContractScore >= 0.80, evidenceCoverageScore >= 0.70,
 *            pianoListenabilityScore >= 0.70 (piano only)
 *   silver — SFT-capable; sampleWeight=0.6; use for standard adapter training
 *            finalCraftScore >= 0.75, advancedCraftScore >= 0.68,
 *            evidenceCoverageScore >= 0.70
 *   bronze — experimental; sampleWeight=0.3; limited/filtered use only
 *            anything that passes the base gate but not silver
 *
 *   Downstream consumers should filter: silver+ for default SFT training.
 *   All tiers are written to sft-pairs.jsonl; meta.sftTier + meta.sampleWeight
 *   allow downstream filtering without re-running the export.
 *
 * Human feedback (curatorCalibration or listenerFeedback) raises the
 * confidence score. humanRating >= 4 with critic fail → human-anchor split.
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
/** P2: compute p25/p50/p75/mean distribution of a numeric array. Returns null when array is empty. */
function computeDistribution(values) {
    if (!values || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const pct = (p) => {
        const idx = Math.max(0, Math.ceil(n * p) - 1);
        return Math.round(sorted[idx] * 1000) / 1000;
    };
    const mean = Math.round((sorted.reduce((s, v) => s + v, 0) / n) * 1000) / 1000;
    return { p25: pct(0.25), p50: pct(0.50), p75: pct(0.75), mean, n };
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

/**
 * SFT quality tier thresholds.
 * Candidates that pass THRESHOLDS (base gate) are then classified into
 * gold / silver / bronze based on these finer-grained quality bands.
 *
 *   gold   — masterwork-level data; high confidence; full weight in training
 *   silver — solid SFT candidates; moderate weight; recommended minimum for default runs
 *   bronze — "good enough" passing; experimental / low weight; filter out for production SFT
 */
const SFT_TIER_THRESHOLDS = {
    gold: {
        finalCraftScore:         0.82,
        advancedCraftScore:      0.75,
        harmonyContractScore:    0.80,
        evidenceCoverageScore:   0.70,
        pianoListenabilityScore: 0.70,
    },
    silver: {
        finalCraftScore:         0.75,
        advancedCraftScore:      0.68,
        harmonyContractScore:    0.70,
        evidenceCoverageScore:   0.70,
        pianoListenabilityScore: 0.50,
    },
};

/** Sample weights by tier for downstream training scripts. */
const SFT_TIER_WEIGHTS = { gold: 1.0, silver: 0.6, bronze: 0.3 };

// ---------------------------------------------------------------------------
// CandidateTrainingEligibility
//
// @typedef {Object} CandidateTrainingEligibility
// @property {boolean} eligibleForSft
// @property {boolean} eligibleForPreference
// @property {"axiom_internal_critic"|"human_curated"|"hybrid"} eligibilitySource
// @property {string[]} reasons           - list of failed checks when not eligible
// @property {number}   confidenceScore   - 0–1; boosted by human calibration
// @property {"gold"|"silver"|"bronze"|null} sftTier - quality tier (null when not eligible)
// @property {number}   sampleWeight      - training weight (0 when not eligible)
// ---------------------------------------------------------------------------

/**
 * Classifies an eligible candidate into a quality tier.
 * Must only be called after confirming eligibleForSft=true.
 *
 * Tier hierarchy (highest to lowest):
 *   gold   — finalCraftScore≥0.82, advancedCraftScore≥0.75, harmonyContract≥0.80,
 *            evidenceCoverage≥0.70, pianoListenability≥0.70 (piano only)
 *   silver — finalCraftScore≥0.75, advancedCraftScore≥0.68, evidenceCoverage≥0.70
 *   bronze — everything that passes the base gate but not silver
 *
 * @param {object} scores - from extractCraftScores()
 * @returns {"gold"|"silver"|"bronze"}
 */
function computeSftTier(scores) {
    const fcs = scores.finalCraftScore ?? 0;
    const acs = scores.advancedCraftScore ?? 0;
    const hcs = scores.harmonyContractScore;           // may be undefined — no harmony plan
    const ecs = scores.evidenceCoverageScore ?? 0;
    const pls = scores.pianoListenabilityScore;        // may be undefined — non-piano
    const isPiano = scores.isPianoCandidate;

    const g = SFT_TIER_THRESHOLDS.gold;
    const goldFails =
        fcs < g.finalCraftScore
        || acs < g.advancedCraftScore
        || ecs < g.evidenceCoverageScore
        || (hcs !== undefined && hcs < g.harmonyContractScore)
        || (isPiano && pls !== undefined && pls < g.pianoListenabilityScore);

    if (!goldFails) return "gold";

    const s = SFT_TIER_THRESHOLDS.silver;
    const silverFails =
        fcs < s.finalCraftScore
        || acs < s.advancedCraftScore
        || ecs < s.evidenceCoverageScore;

    return silverFails ? "bronze" : "silver";
}

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
 * Returns eligibleForSft=true only when ALL critic gates pass AND the human
 * has not explicitly rejected the candidate (humanRating <= 2).
 *
 * P0: humanRating <= 2 is a hard block — overrides critic pass.
 * P1: humanApproved (>= 4) + critic fail + structural content → eligibleAsHumanAnchor.
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

    // ── Human calibration ────────────────────────────────────────────────────
    const cal = cm?.curatorCalibration ?? null;
    const fb  = cm?.listenerFeedback  ?? null;
    const humanRating  = toFinite(cal?.qualityRating ?? fb?.appeal);
    const humanRejected = humanRating !== undefined && humanRating <= 2;
    const humanApproved = humanRating !== undefined && humanRating >= 4;

    // P0: explicit human rejection is a hard gate — overrides critic pass
    if (humanRejected) {
        reasons.push("human_rejected");
    }

    const eligibleForSft = reasons.length === 0;

    // P1: human-anchor eligibility — human approved, critic failed, structural content present
    // "structural failure" means no abc/control/mock issues — anchor needs renderable content
    const hasStructuralFailure = reasons.some(
        (r) => r === "no_abc_text" || r === "no_control_lines" || r === "mock_excluded",
    );
    const eligibleAsHumanAnchor = humanApproved && !hasStructuralFailure && !eligibleForSft;

    // ── eligibilitySource ────────────────────────────────────────────────────
    let eligibilitySource;
    if (eligibleForSft && humanApproved) eligibilitySource = "hybrid";
    else if (eligibleForSft)             eligibilitySource = "axiom_internal_critic";
    else if (humanApproved)              eligibilitySource = "human_curated";
    else                                 eligibilitySource = "axiom_internal_critic";

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
    } else if (eligibleAsHumanAnchor) {
        // Human anchor: confidence from human rating (normalized 0–1, max at rating 5)
        confidenceScore = Math.min(1.0, humanRating / 5);
    }

    return {
        eligibleForSft,
        eligibleAsHumanAnchor,
        eligibleForPreference: eligibleForSft && cm?.selected === true,
        eligibilitySource,
        humanRejected,
        reasons,
        confidenceScore: Math.round(confidenceScore * 1000) / 1000,
        // Raw scores for metadata
        scores,
        // Quality tier — null when not eligible
        sftTier: eligibleForSft ? computeSftTier(scores) : null,
        sampleWeight: eligibleForSft ? SFT_TIER_WEIGHTS[computeSftTier(scores)] : 0,
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
 *   1. providerRequest.conditioningText + controlLines + AXIOM blocks
 *   2. learnedNotagenProviderRequest (same shape)
 *
 * AXIOM blocks are appended after the control section:
 *   [AXIOM_MOTIF_GRAPH]   → motifGraphBlock
 *   [AXIOM_REPAIR]        → repairBlock
 *   <AXIOM_PIANO_REWRITE> → pianoRewriteBlock
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
    // AXIOM control blocks: carry full structured intent for fine-tuning
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

    const evidence = cm?.proposalEvidence ?? {};
    const pr = evidence.providerRequest ?? cm?.learnedNotagenProviderRequest ?? null;
    const instruction = buildInstruction(pr);
    const abcText = typeof evidence.abcText === "string" && evidence.abcText.trim()
        ? evidence.abcText : null;
    const generationMode = toTrimmed(evidence.generationMode ?? cm?.meta?.generationMode ?? "");
    const planSignature  = toTrimmed(evidence.planSignature) || undefined;
    const { scores } = elig;

    // ── Main SFT row (critic pass + not human-rejected required) ─────────────
    let row = null;
    let rowElig = elig;
    if (elig.eligibleForSft) {
        if (SELECTED_ONLY && !cm?.selected) {
            rowElig = { ...elig, reasons: ["not_selected"] };
        } else if (!instruction) {
            rowElig = { ...elig, reasons: [...elig.reasons, "no_instruction"] };
        } else if (!abcText) {
            rowElig = { ...elig, reasons: [...elig.reasons, "no_abc_text"] };
        } else {
            row = {
                id: stableHash([songId, candidateId, planSignature ?? "", generationMode]),
                songId,
                candidateId,
                planSignature: planSignature ?? null,
                selected: cm?.selected === true,
                generationMode,
                label: "axiom_curated_pass",
                instruction,
                output: abcText,
                meta: {
                    eligibilitySource:    elig.eligibilitySource,
                    confidenceScore:      elig.confidenceScore,
                    sftTier:              elig.sftTier,
                    sampleWeight:         elig.sampleWeight,
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
            };
        }
    }

    // ── Human anchor row (P1): human approved + critic failed + structural OK ─
    let anchorRow = null;
    if (elig.eligibleAsHumanAnchor && instruction && abcText) {
        anchorRow = {
            id: stableHash([songId, candidateId, planSignature ?? "", generationMode, "anchor"]),
            songId,
            candidateId,
            planSignature: planSignature ?? null,
            selected: cm?.selected === true,
            generationMode,
            label: "human_anchor",
            instruction,
            output: abcText,
            meta: {
                eligibilitySource:    elig.eligibilitySource,  // "human_curated"
                confidenceScore:      elig.confidenceScore,
                provider:             toTrimmed(evidence.provider || cm?.provider) || null,
                model:                toTrimmed(evidence.model    || cm?.model)    || null,
                scoringProfileId:     scores.scoringProfileId ?? null,
                finalCraftScore:      scores.finalCraftScore ?? null,
                advancedCraftScore:   scores.advancedCraftScore ?? null,
                harmonyContractScore: scores.harmonyContractScore ?? null,
                evidenceCoverageScore: scores.evidenceCoverageScore ?? null,
                criticRejectionReasons: elig.reasons.filter((r) => r !== "human_rejected"),
                normalizationWarnings: Array.isArray(evidence.normalizationWarnings)
                    ? evidence.normalizationWarnings : [],
            },
        };
    }

    return { row, anchorRow, elig: rowElig };
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
    const anchorRows = [];
    const counts = {
        totalSongs: songIds.length,
        totalCandidates: 0,
        eligible: 0,
        humanRejected: 0,
        humanAnchor: 0,
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

            const { row, anchorRow, elig } = buildSftRow(songId, candidateId, cm);

            // Collect anchor rows regardless of main row eligibility
            if (anchorRow) {
                counts.humanAnchor++;
                anchorRows.push(anchorRow);
            }

            if (!row) {
                const r = elig.reasons.join(",");
                if (r.includes("human_rejected"))     counts.humanRejected++;
                else if (r.includes("mock_excluded"))  counts.skippedMock++;
                else if (r.includes("no_abc_text"))    counts.skippedNoAbc++;
                else if (r.includes("no_instruction") || r.includes("no_control_lines")) counts.skippedNoInstruction++;
                else if (r.includes("not_selected"))   counts.skippedNotSelected++;
                else if (r.includes("missing_finalCraftScore")) counts.skippedNoCraft++;
                else                                   counts.skippedBelowThreshold++;
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

    const anchorSeen = new Set();
    const dedupedAnchors = anchorRows.filter((row) => {
        const key = stableHash([row.candidateId, row.output.slice(0, 256), "anchor"]);
        if (anchorSeen.has(key)) return false;
        anchorSeen.add(key);
        return true;
    });

    // Stats breakdown
    const bySource = { axiom_internal_critic: 0, human_curated: 0, hybrid: 0 };
    const byTier   = { gold: 0, silver: 0, bronze: 0 };
    const selectedCount = deduped.filter((r) => r.selected).length;
    for (const r of deduped) {
        bySource[r.meta.eligibilitySource] = (bySource[r.meta.eligibilitySource] ?? 0) + 1;
        if (r.meta.sftTier) byTier[r.meta.sftTier] = (byTier[r.meta.sftTier] ?? 0) + 1;
    }

    // P2: confidence distribution across main SFT rows
    const confidenceValues = deduped.map((r) => r.meta.confidenceScore).filter((v) => typeof v === "number");
    const confidenceDistribution = computeDistribution(confidenceValues);

    const summary = {
        ok: true,
        snapshotId: SNAPSHOT_ID,
        exportedAt: new Date().toISOString(),
        ...counts,
        totalPairs: deduped.length,
        dedupedFrom: rows.length,
        humanAnchorPairs: dedupedAnchors.length,
        noAbcText: counts.skippedNoAbc,
        mockExcluded: counts.skippedMock,
        byEligibilitySource: bySource,
        byTier,
        selectedCandidates: selectedCount,
        confidenceDistribution,
        thresholds: THRESHOLDS,
        sftTierThresholds: SFT_TIER_THRESHOLDS,
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
    console.log(`  Tiers (SFT quality):`);
    console.log(`    gold   (≥0.82/0.75/0.80/0.70): ${byTier.gold}`);
    console.log(`    silver (≥0.75/0.68/-/0.70):    ${byTier.silver}`);
    console.log(`    bronze (≥0.70/0.60/-/0.55):    ${byTier.bronze}  [experimental only]`);
    console.log(`  Human anchor pairs:     ${dedupedAnchors.length}`);
    console.log(`  Skipped:`);
    console.log(`    human rejected (≤2):    ${counts.humanRejected}`);
    console.log(`    below threshold:        ${counts.skippedBelowThreshold}`);
    console.log(`    mock backend:           ${counts.skippedMock}`);
    console.log(`    no ABC text:            ${counts.skippedNoAbc}`);
    console.log(`    no control lines:       ${counts.skippedNoInstruction}`);
    console.log(`    no craft scores:        ${counts.skippedNoCraft}`);
    console.log(`    not selected (flag):    ${counts.skippedNotSelected}`);
    if (confidenceDistribution) {
        console.log(`  Confidence (SFT rows):  p25=${confidenceDistribution.p25} p50=${confidenceDistribution.p50} p75=${confidenceDistribution.p75} mean=${confidenceDistribution.mean}`);
    }

    if (DRY_RUN) {
        console.log("\n[dry-run] No files written.");
        console.log(JSON.stringify({ ...summary, dryRun: true }));
        return;
    }

    const systemDir = path.join(OUTPUT_ROOT, "_system", "ml", "notagen-sft", SNAPSHOT_ID);
    const sftPath     = path.join(systemDir, "sft-pairs.jsonl");
    const anchorPath  = path.join(systemDir, "human-anchor-sft-pairs.jsonl");
    const summaryPath = path.join(systemDir, "summary.json");
    writeJsonlFile(sftPath, deduped);
    if (dedupedAnchors.length > 0) writeJsonlFile(anchorPath, dedupedAnchors);
    writeJsonFile(summaryPath, { ...summary, files: { sftPairs: sftPath, anchorPairs: anchorPath } });
    console.log(`\nWrote ${deduped.length} pair(s) → ${sftPath}`);
    if (dedupedAnchors.length > 0) console.log(`Wrote ${dedupedAnchors.length} human anchor pair(s) → ${anchorPath}`);
    console.log(JSON.stringify({ ...summary, files: { sftPairs: sftPath, anchorPairs: anchorPath } }));
}

main();
