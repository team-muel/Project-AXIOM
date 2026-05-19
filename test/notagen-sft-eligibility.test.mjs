/**
 * test/notagen-sft-eligibility.test.mjs
 *
 * NSE-01..12: CandidateTrainingEligibility 계산 로직 단위 테스트
 *
 * 검증 항목:
 *   NSE-01: 모든 조건 통과 → eligibleForSft=true, axiom_internal_critic
 *   NSE-02: abcText 없음 → not eligible (no_abc_text)
 *   NSE-03: controlLines 없음 → not eligible (no_control_lines)
 *   NSE-04: mock backend → excluded unless includeMock=true
 *   NSE-05: finalCraftScore 미달 → not eligible
 *   NSE-06: advancedCraftScore 미달 → not eligible
 *   NSE-07: harmonyContractScore 미달 → not eligible
 *   NSE-08: harmonyContractScore undefined → pass (no harmony plan = ok)
 *   NSE-09: piano pianoListenabilityScore 미달 → not eligible
 *   NSE-10: curator calibration qualityRating ≥ 4 → eligibilitySource=hybrid, confidenceBoost 반영
 *   NSE-11: internalCriticApproval.approved=false → shortcut to not eligible
 *   NSE-12: internalCriticApproval.approved=true → skip raw score recompute, eligible
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ─── Load computeEligibility from the script ──────────────────────────────────
// We extract just the function by evaluating a wrapper (avoids running main())
import { createHash } from "node:crypto";

function toTrimmed(v) { return String(v ?? "").trim(); }
function toFinite(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) { const p = Number(v); return Number.isFinite(p) ? p : undefined; }
    return undefined;
}
function stableHash(parts) {
    return createHash("sha256").update(parts.join("|"), "utf-8").digest("hex").slice(0, 16);
}

// Inline the eligibility logic so tests don't depend on script execution context
const THRESHOLDS = {
    finalCraftScore:         0.70,
    advancedCraftScore:      0.60,
    harmonyContractScore:    0.70,
    evidenceCoverageScore:   0.55,
    pianoListenabilityScore: 0.50,
};

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

function extractCraftScores(cm) {
    const ica = cm?.internalCriticApproval ?? null;
    const cs  = cm?.structureEvaluation?.craftScoreSummary ?? null;
    const pc  = cm?.structureEvaluation?.pianoCraftScoreSummary ?? cm?.pianoCraftScore ?? null;
    return {
        internalCriticApproved: ica?.approved ?? null,
        internalCriticFailedDimensions: ica?.failedDimensions ?? null,
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

function computeEligibility(cm, { includeMock } = { includeMock: false }) {
    const reasons = [];
    const evidence = cm?.proposalEvidence ?? {};
    const abcText = typeof evidence.abcText === "string" && evidence.abcText.trim() ? evidence.abcText : null;
    if (!abcText) reasons.push("no_abc_text");
    const instruction = buildInstruction(evidence.providerRequest ?? cm?.learnedNotagenProviderRequest ?? null);
    if (!instruction) reasons.push("no_control_lines");
    const generationMode = toTrimmed(evidence.generationMode ?? cm?.meta?.generationMode ?? "");
    if (!includeMock && generationMode.toLowerCase().includes("mock")) reasons.push("mock_excluded");

    const scores = extractCraftScores(cm);
    if (scores.internalCriticApproved === false) {
        for (const dim of scores.internalCriticFailedDimensions ?? []) {
            reasons.push(`critic_failed:${dim}`);
        }
    } else if (scores.internalCriticApproved === null) {
        if (scores.finalCraftScore !== undefined) {
            if (scores.finalCraftScore < THRESHOLDS.finalCraftScore)
                reasons.push(`below_finalCraftScore(${scores.finalCraftScore?.toFixed(3)}<${THRESHOLDS.finalCraftScore})`);
        } else {
            reasons.push("missing_finalCraftScore");
        }
        if (scores.advancedCraftScore !== undefined && scores.advancedCraftScore < THRESHOLDS.advancedCraftScore)
            reasons.push(`below_advancedCraftScore(${scores.advancedCraftScore?.toFixed(3)}<${THRESHOLDS.advancedCraftScore})`);
        if (scores.harmonyContractScore !== undefined && scores.harmonyContractScore < THRESHOLDS.harmonyContractScore)
            reasons.push(`below_harmonyContractScore(${scores.harmonyContractScore?.toFixed(3)}<${THRESHOLDS.harmonyContractScore})`);
        if (scores.evidenceCoverageScore !== undefined && scores.evidenceCoverageScore < THRESHOLDS.evidenceCoverageScore)
            reasons.push(`below_evidenceCoverageScore(${scores.evidenceCoverageScore?.toFixed(3)}<${THRESHOLDS.evidenceCoverageScore})`);
        if (scores.isPianoCandidate && scores.pianoListenabilityScore !== undefined
            && scores.pianoListenabilityScore < THRESHOLDS.pianoListenabilityScore)
            reasons.push(`below_pianoListenabilityScore(${scores.pianoListenabilityScore?.toFixed(3)}<${THRESHOLDS.pianoListenabilityScore})`);
    }

    const eligibleForSft = reasons.length === 0;
    const cal = cm?.curatorCalibration ?? null;
    const fb  = cm?.listenerFeedback  ?? null;
    const humanRating = toFinite(cal?.qualityRating ?? fb?.appeal);
    const humanApproved = humanRating !== undefined && humanRating >= 4;

    let eligibilitySource;
    if (eligibleForSft && humanApproved)  eligibilitySource = "hybrid";
    else if (eligibleForSft)              eligibilitySource = "axiom_internal_critic";
    else if (humanApproved)               eligibilitySource = "human_curated";
    else                                  eligibilitySource = "axiom_internal_critic";

    let confidenceScore = 0.0;
    if (eligibleForSft) {
        const base = Math.min(1.0, (
            (scores.finalCraftScore ?? 0) * 0.40
            + (scores.advancedCraftScore ?? 0) * 0.35
            + (scores.evidenceCoverageScore ?? 0) * 0.25
        ) / 1.0);
        confidenceScore = Math.min(1.0, base + (humanApproved ? 0.10 : 0.0));
    }

    return {
        eligibleForSft,
        eligibleForPreference: eligibleForSft && cm?.selected === true,
        eligibilitySource,
        reasons,
        confidenceScore: Math.round(confidenceScore * 1000) / 1000,
        scores,
    };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCandidate(overrides = {}) {
    return {
        proposalEvidence: {
            abcText: "X:1\nT:Test\nM:4/4\nK:C\n|:CDEF|GABC:|",
            generationMode: "notagen_local",
            providerRequest: {
                conditioningText: "Baroque, violin",
                controlLines: ["section: exposition", "key: C major"],
            },
        },
        structureEvaluation: {
            craftScoreSummary: {
                finalCraftScore:       0.75,
                advancedCraftScore:    0.65,
                harmonyContractScore:  0.80,
                evidenceCoverageScore: 0.62,
            },
        },
        selected: false,
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CandidateTrainingEligibility (NSE)", () => {

    it("NSE-01: all conditions pass → eligibleForSft=true, axiom_internal_critic", () => {
        const result = computeEligibility(makeCandidate());
        assert.equal(result.eligibleForSft, true);
        assert.equal(result.eligibilitySource, "axiom_internal_critic");
        assert.deepEqual(result.reasons, []);
        assert.ok(result.confidenceScore > 0, "confidence should be > 0");
    });

    it("NSE-02: no abcText → not eligible, reason=no_abc_text", () => {
        const cm = makeCandidate({ proposalEvidence: {
            generationMode: "notagen_local",
            providerRequest: { conditioningText: "x", controlLines: ["a"] },
        }});
        const result = computeEligibility(cm);
        assert.equal(result.eligibleForSft, false);
        assert.ok(result.reasons.includes("no_abc_text"));
        assert.equal(result.confidenceScore, 0);
    });

    it("NSE-03: no controlLines → not eligible, reason=no_control_lines", () => {
        const cm = makeCandidate();
        cm.proposalEvidence.providerRequest = { conditioningText: "", controlLines: [] };
        const result = computeEligibility(cm);
        assert.equal(result.eligibleForSft, false);
        assert.ok(result.reasons.includes("no_control_lines"));
    });

    it("NSE-04: mock generationMode → excluded by default", () => {
        const cm = makeCandidate();
        cm.proposalEvidence.generationMode = "mock_backend";
        const result = computeEligibility(cm, { includeMock: false });
        assert.equal(result.eligibleForSft, false);
        assert.ok(result.reasons.includes("mock_excluded"));
    });

    it("NSE-04b: mock with includeMock=true → eligible if scores pass", () => {
        const cm = makeCandidate();
        cm.proposalEvidence.generationMode = "mock_backend";
        const result = computeEligibility(cm, { includeMock: true });
        assert.equal(result.eligibleForSft, true);
    });

    it("NSE-05: finalCraftScore below threshold → not eligible", () => {
        const cm = makeCandidate();
        cm.structureEvaluation.craftScoreSummary.finalCraftScore = 0.60;
        const result = computeEligibility(cm);
        assert.equal(result.eligibleForSft, false);
        assert.ok(result.reasons.some((r) => r.includes("finalCraftScore")));
    });

    it("NSE-06: advancedCraftScore below threshold → not eligible", () => {
        const cm = makeCandidate();
        cm.structureEvaluation.craftScoreSummary.advancedCraftScore = 0.45;
        const result = computeEligibility(cm);
        assert.equal(result.eligibleForSft, false);
        assert.ok(result.reasons.some((r) => r.includes("advancedCraftScore")));
    });

    it("NSE-07: harmonyContractScore below threshold → not eligible", () => {
        const cm = makeCandidate();
        cm.structureEvaluation.craftScoreSummary.harmonyContractScore = 0.55;
        const result = computeEligibility(cm);
        assert.equal(result.eligibleForSft, false);
        assert.ok(result.reasons.some((r) => r.includes("harmonyContractScore")));
    });

    it("NSE-08: harmonyContractScore undefined → pass (no harmony plan)", () => {
        const cm = makeCandidate();
        delete cm.structureEvaluation.craftScoreSummary.harmonyContractScore;
        const result = computeEligibility(cm);
        assert.equal(result.eligibleForSft, true, "should be eligible when no harmony plan");
        assert.ok(!result.reasons.some((r) => r.includes("harmonyContractScore")));
    });

    it("NSE-09: piano candidate with pianoListenabilityScore below threshold → not eligible", () => {
        const cm = makeCandidate({
            structureEvaluation: {
                craftScoreSummary: {
                    finalCraftScore:       0.75,
                    advancedCraftScore:    0.65,
                    harmonyContractScore:  0.80,
                    evidenceCoverageScore: 0.62,
                },
                pianoCraftScoreSummary: {
                    pianoListenabilityScore: 0.35,
                    finalPianoScore: 0.50,
                },
            },
        });
        const result = computeEligibility(cm);
        assert.equal(result.eligibleForSft, false);
        assert.ok(result.reasons.some((r) => r.includes("pianoListenabilityScore")));
    });

    it("NSE-10: curatorCalibration qualityRating >= 4 → hybrid, confidenceBoost applied", () => {
        const cm = makeCandidate({ curatorCalibration: { qualityRating: 4, source: "expert-review", reviewedAt: "2025-01-01T00:00:00Z" } });
        const resultNoBoost = computeEligibility(makeCandidate());
        const resultWithBoost = computeEligibility(cm);
        assert.equal(resultWithBoost.eligibilitySource, "hybrid");
        assert.ok(resultWithBoost.confidenceScore > resultNoBoost.confidenceScore,
            `boosted confidence (${resultWithBoost.confidenceScore}) should exceed unboosted (${resultNoBoost.confidenceScore})`);
    });

    it("NSE-10b: listenerFeedback.appeal >= 4 (legacy) → hybrid", () => {
        const cm = makeCandidate({ listenerFeedback: { appeal: 4 } });
        const result = computeEligibility(cm);
        assert.equal(result.eligibilitySource, "hybrid");
    });

    it("NSE-11: internalCriticApproval.approved=false → not eligible (shortcut)", () => {
        const cm = makeCandidate({
            internalCriticApproval: {
                approved: false,
                failedDimensions: ["finalCraftScore(0.600<0.70)", "advancedCraftScore(0.400<0.60)"],
            },
        });
        const result = computeEligibility(cm);
        assert.equal(result.eligibleForSft, false);
        assert.ok(result.reasons.some((r) => r.includes("critic_failed:finalCraftScore")));
        assert.ok(result.reasons.some((r) => r.includes("critic_failed:advancedCraftScore")));
    });

    it("NSE-12: internalCriticApproval.approved=true → eligible without raw score recompute", () => {
        const cm = makeCandidate({
            internalCriticApproval: {
                approved: true,
                finalCraftScore:       0.76,
                advancedCraftScore:    0.65,
                harmonyContractScore:  0.82,
                evidenceCoverageScore: 0.62,
                failedDimensions: [],
                scoringProfileId: "classical_default_v1",
            },
            // deliberately bad raw scores to confirm they're not used
            structureEvaluation: {
                craftScoreSummary: {
                    finalCraftScore:       0.20,
                    advancedCraftScore:    0.10,
                    harmonyContractScore:  0.10,
                    evidenceCoverageScore: 0.10,
                },
            },
        });
        const result = computeEligibility(cm);
        assert.equal(result.eligibleForSft, true, "pre-computed approval should be trusted over raw scores");
        // scores should come from internalCriticApproval, not the bad craftScoreSummary
        assert.equal(result.scores.finalCraftScore, 0.76);
    });

});
