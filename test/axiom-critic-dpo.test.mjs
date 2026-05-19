/**
 * axiom-critic-dpo.test.mjs  (ACD-01 … ACD-12)
 *
 * Unit tests for the AXIOM-critic DPO logic in
 * scripts/export-notagen-preference-dataset.mjs.
 *
 * Because that script calls main() at import time, we inline the pure
 * functions here (same pattern as notagen-sft-eligibility.test.mjs).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Inline helpers (mirrors export-notagen-preference-dataset.mjs) ──────────

function toTrimmed(v) { return String(v ?? "").trim(); }
function toFinite(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) { const p = Number(v); return Number.isFinite(p) ? p : undefined; }
    return undefined;
}

const THRESHOLDS = {
    finalCraftScore:         0.70,
    advancedCraftScore:      0.60,
    harmonyContractScore:    0.70,
    evidenceCoverageScore:   0.55,
    pianoListenabilityScore: 0.50,
};
const MIN_SCORE_GAP = 0.05;

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

function computeCriticResult(cm, { includeMock } = {}) {
    const failedGates = [];
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

let _pairCounter = 0;
function stableHash(parts) { return `hash_${parts.join("_")}_${_pairCounter++}`; }

function buildDpoPairs(byPlanSignature) {
    const pairs = [];
    for (const [sig, group] of Object.entries(byPlanSignature)) {
        const chosen   = group.filter((c) => c.criticPass && c.selected && c.instruction && c.abcText);
        const rejected = group.filter((c) => !c.criticPass && c.isHardNeg && c.instruction && c.abcText);
        for (const pos of chosen) {
            for (const neg of rejected) {
                pairs.push({
                    pairId: stableHash([pos.id, neg.id]),
                    planSignature: sig,
                    label: "axiom_critic_dpo",
                    chosen:   { id: pos.id, instruction: pos.instruction, output: pos.abcText, scores: pos.scores },
                    rejected: { id: neg.id, instruction: neg.instruction, output: neg.abcText, failedGates: neg.failedGates, scores: neg.scores },
                });
            }
        }
    }
    return pairs;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePassingCandidate(id = "c1", planSig = "sig_A", selected = true) {
    return {
        id,
        planSignature: planSig,
        selected,
        criticPass: true,
        isHardNeg: false,
        instruction: "Baroque, violin\n%%axiom_control_begin\nsection: exposition\n%%axiom_control_end",
        abcText: "X:1\nT:Test\nM:4/4\nK:C\n|:CDEF|GABC:|",
        failedGates: [],
        scores: { finalCraftScore: 0.80, advancedCraftScore: 0.70, harmonyContractScore: 0.82 },
    };
}

function makeFailingCandidate(id = "c2", planSig = "sig_A", isHardNeg = true) {
    return {
        id,
        planSignature: planSig,
        selected: false,
        criticPass: false,
        isHardNeg,
        instruction: "Baroque, violin\n%%axiom_control_begin\nsection: exposition\n%%axiom_control_end",
        abcText: "X:1\nT:Fail\nM:4/4\nK:C\n|:CDEF|GABC:|",
        failedGates: ["below_finalCraft(0.550<0.70)"],
        scores: { finalCraftScore: 0.55, advancedCraftScore: 0.50, harmonyContractScore: 0.60 },
    };
}

function makeCm(overrides = {}) {
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
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AXIOM Critic DPO (ACD)", () => {

    it("ACD-01: all gates pass + selected → criticPass=true", () => {
        const cm = makeCm({ selected: true });
        const result = computeCriticResult(cm);
        assert.equal(result.pass, true);
        assert.deepEqual(result.failedGates, []);
    });

    it("ACD-02: harmonyContractViolations > 0 → isHardNegative=true", () => {
        const cm = makeCm();
        cm.structureEvaluation.craftScoreSummary.harmonyContractViolations = 2;
        const s = extractScores(cm);
        assert.equal(isHardNegative(s), true);
    });

    it("ACD-03: evidenceCoverageGateTier='none' → isHardNegative=true", () => {
        const cm = makeCm();
        cm.structureEvaluation.craftScoreSummary.evidenceCoverageGateTier = "none";
        const s = extractScores(cm);
        assert.equal(isHardNegative(s), true);
    });

    it("ACD-03b: evidenceCoverageGateTier='partial' → isHardNegative=true", () => {
        const cm = makeCm();
        cm.structureEvaluation.craftScoreSummary.evidenceCoverageGateTier = "partial";
        const s = extractScores(cm);
        assert.equal(isHardNegative(s), true);
    });

    it("ACD-04: motifReturnScore <= 0.30 → isHardNegative=true", () => {
        const cm = makeCm();
        cm.structureEvaluation.craftScoreSummary.motifReturnScore = 0.20;
        const s = extractScores(cm);
        assert.equal(isHardNegative(s), true);
    });

    it("ACD-05: barely failed (gap < MIN_SCORE_GAP) → NOT isHardNegative", () => {
        // finalCraftScore = 0.66 is below 0.70 threshold but gap=0.04 < MIN_SCORE_GAP=0.05
        const cm = makeCm();
        cm.structureEvaluation.craftScoreSummary.finalCraftScore = 0.66;
        // Also set harmony/evidence/advanced to be fine
        cm.structureEvaluation.craftScoreSummary.advancedCraftScore = 0.65;
        cm.structureEvaluation.craftScoreSummary.harmonyContractScore = 0.80;
        cm.structureEvaluation.craftScoreSummary.evidenceCoverageScore = 0.60;
        const s = extractScores(cm);
        assert.equal(isHardNegative(s), false, "gap=0.04 < MIN_SCORE_GAP → not hard negative");
    });

    it("ACD-06: DPO pair created from same planSignature (chosen + hard negative)", () => {
        const pos = makePassingCandidate("c1", "sig_A", true);
        const neg = makeFailingCandidate("c2", "sig_A", true);
        const pairs = buildDpoPairs({ sig_A: [pos, neg] });
        assert.equal(pairs.length, 1);
        assert.equal(pairs[0].label, "axiom_critic_dpo");
        assert.equal(pairs[0].chosen.id, "c1");
        assert.equal(pairs[0].rejected.id, "c2");
    });

    it("ACD-07: different planSignature → no pair produced", () => {
        const pos = makePassingCandidate("c1", "sig_A", true);
        const neg = makeFailingCandidate("c2", "sig_B", true);
        const pairs = buildDpoPairs({ sig_A: [pos], sig_B: [neg] });
        assert.equal(pairs.length, 0, "cross-signature pairs should not be created");
    });

    it("ACD-08: soft negative (isHardNeg=false) → excluded from DPO pairs", () => {
        const pos = makePassingCandidate("c1", "sig_A", true);
        const softNeg = makeFailingCandidate("c2", "sig_A", false); // isHardNeg=false
        const pairs = buildDpoPairs({ sig_A: [pos, softNeg] });
        assert.equal(pairs.length, 0, "soft negatives should not form DPO pairs");
    });

    it("ACD-09: pair label is axiom_critic_dpo (not listener_preference)", () => {
        const pos = makePassingCandidate("c1", "sig_A", true);
        const neg = makeFailingCandidate("c2", "sig_A", true);
        const pairs = buildDpoPairs({ sig_A: [pos, neg] });
        assert.equal(pairs[0].label, "axiom_critic_dpo");
        assert.notEqual(pairs[0].label, "listener_preference");
    });

    it("ACD-10: human calibration does NOT gate computeCriticResult", () => {
        // Passing candidate with no human feedback → still passes
        const cm = makeCm();
        const result = computeCriticResult(cm);
        assert.equal(result.pass, true);
        // Failing candidate WITH high human rating → still fails
        const badCm = makeCm();
        badCm.structureEvaluation.craftScoreSummary.finalCraftScore = 0.40;
        badCm.listenerFeedback = { appeal: 5, coherence: 5 };
        const badResult = computeCriticResult(badCm);
        assert.equal(badResult.pass, false, "high human rating should not override critic failure");
    });

    it("ACD-11: instruction includes [AXIOM_MOTIF_GRAPH] when motifGraphBlock present", () => {
        const pr = {
            conditioningText: "Baroque",
            controlLines: ["section: exposition"],
            motifGraphBlock: "[AXIOM_MOTIF_GRAPH]\nsource=theme_a\nmotif_id=A\n[/AXIOM_MOTIF_GRAPH]",
        };
        const instruction = buildInstruction(pr);
        assert.ok(instruction.includes("[AXIOM_MOTIF_GRAPH]"));
        assert.ok(instruction.includes("source=theme_a"));
    });

    it("ACD-12: instruction includes [AXIOM_REPAIR] when repairBlock present", () => {
        const pr = {
            conditioningText: "Baroque",
            controlLines: ["section: development"],
            repairBlock: "[AXIOM_REPAIR]\nsection=s3\naction=strengthen_cadence\nfield=cadenceApproach\n[/AXIOM_REPAIR]",
        };
        const instruction = buildInstruction(pr);
        assert.ok(instruction.includes("[AXIOM_REPAIR]"));
        assert.ok(instruction.includes("strengthen_cadence"));
    });

    it("ACD-13: mock excluded by default in computeCriticResult", () => {
        const cm = makeCm();
        cm.proposalEvidence.generationMode = "mock_backend";
        const result = computeCriticResult(cm, { includeMock: false });
        assert.equal(result.pass, false);
        assert.ok(result.failedGates.includes("mock_excluded"));
    });

    it("ACD-13b: mock passes when includeMock=true", () => {
        const cm = makeCm();
        cm.proposalEvidence.generationMode = "mock_backend";
        const result = computeCriticResult(cm, { includeMock: true });
        assert.equal(result.pass, true);
    });

    it("ACD-14: multiple hard negatives per chosen → multiple pairs", () => {
        const pos = makePassingCandidate("c1", "sig_A", true);
        const neg1 = makeFailingCandidate("c2", "sig_A", true);
        const neg2 = makeFailingCandidate("c3", "sig_A", true);
        const pairs = buildDpoPairs({ sig_A: [pos, neg1, neg2] });
        assert.equal(pairs.length, 2);
    });

});
