/**
 * test/internal-critic-approval.test.mjs
 *
 * ICA-01..10: InternalCriticApproval 계산 함수 단위 테스트
 *
 * 검증 항목:
 *   ICA-01: 모든 임계값 통과 → approved=true, failedDimensions=[]
 *   ICA-02: finalCraftScore 임계값 미달 → rejected + failedDimensions 포함
 *   ICA-03: advancedCraftScore 미달 → rejected
 *   ICA-04: harmonyContractScore 미달 → rejected
 *   ICA-05: evidenceCoverageScore 미달 → rejected
 *   ICA-06: harmonyContractScore undefined → defaults to 1.0 (no harmony plan = pass)
 *   ICA-07: pianoListenabilityScore gate (piano candidates only)
 *   ICA-08: 커스텀 임계값 오버라이드
 *   ICA-09: scoringProfileId가 craftScore.scoringProfile에서 추출됨
 *   ICA-10: 복수 dimension 실패 시 failedDimensions 모두 포함
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Dynamic import for built compiled output
const { computeInternalCriticApproval } = await import(
    "../dist/core/evaluate/internalCriticApproval.js"
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal passing CraftScoreSummary */
function passingCraftScore(overrides = {}) {
    return {
        syntaxValidity:        1.0,
        sectionContractFit:    0.90,
        cadenceStrength:       0.85,
        tonalReturn:           0.88,
        motifSurvival:         0.80,
        voiceIndependence:     0.75,
        phraseShape:           0.78,
        registerIdiomaticFit:  0.82,
        finalCraftScore:       0.76,
        advancedCraftScore:    0.65,
        harmonyContractScore:  0.80,
        evidenceCoverageScore: 0.62,
        scoringProfile:        "classical_default_v1",
        ...overrides,
    };
}

/** Passing PianoCraftScoreSummary */
function passingPianoScore(overrides = {}) {
    return {
        handPlayability:               0.80,
        melodicClarity:                0.75,
        bassCoherence:                 0.78,
        voicingIdiomaticFit:           0.72,
        accompanimentPatternCoherence: 0.70,
        registerSpacing:               0.76,
        handIndependence:              0.74,
        pedalPlausibility:             0.80,
        difficultyFit:                 0.78,
        finalPianoScore:               0.76,
        pianoListenabilityScore:       0.65,
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InternalCriticApproval", () => {

    it("ICA-01: all dimensions pass → approved=true, failedDimensions=[]", () => {
        const result = computeInternalCriticApproval(passingCraftScore());
        assert.equal(result.approved, true);
        assert.deepEqual(result.failedDimensions, []);
        assert.equal(result.finalCraftScore, 0.76);
        assert.equal(result.advancedCraftScore, 0.65);
        assert.equal(result.harmonyContractScore, 0.80);
        assert.equal(result.evidenceCoverageScore, 0.62);
    });

    it("ICA-02: finalCraftScore below threshold → rejected, failedDimensions includes it", () => {
        const result = computeInternalCriticApproval(passingCraftScore({ finalCraftScore: 0.65 }));
        assert.equal(result.approved, false);
        assert.ok(
            result.failedDimensions.some((d) => d.startsWith("finalCraftScore")),
            `failedDimensions should include finalCraftScore, got: ${JSON.stringify(result.failedDimensions)}`,
        );
    });

    it("ICA-03: advancedCraftScore below threshold → rejected", () => {
        const result = computeInternalCriticApproval(passingCraftScore({ advancedCraftScore: 0.45 }));
        assert.equal(result.approved, false);
        assert.ok(result.failedDimensions.some((d) => d.startsWith("advancedCraftScore")));
    });

    it("ICA-04: harmonyContractScore below threshold → rejected", () => {
        const result = computeInternalCriticApproval(passingCraftScore({ harmonyContractScore: 0.60 }));
        assert.equal(result.approved, false);
        assert.ok(result.failedDimensions.some((d) => d.startsWith("harmonyContractScore")));
    });

    it("ICA-05: evidenceCoverageScore below threshold → rejected", () => {
        const result = computeInternalCriticApproval(passingCraftScore({ evidenceCoverageScore: 0.40 }));
        assert.equal(result.approved, false);
        assert.ok(result.failedDimensions.some((d) => d.startsWith("evidenceCoverageScore")));
    });

    it("ICA-06: harmonyContractScore undefined → defaults to 1.0 (no harmony plan = pass)", () => {
        const craftScore = passingCraftScore();
        delete craftScore.harmonyContractScore;
        const result = computeInternalCriticApproval(craftScore);
        assert.equal(result.approved, true, "should pass when no harmony plan sections");
        assert.equal(result.harmonyContractScore, 1, "harmonyContractScore should default to 1");
    });

    it("ICA-07: piano gate — pianoListenabilityScore below threshold → rejected (piano candidates only)", () => {
        const result = computeInternalCriticApproval(
            passingCraftScore(),
            passingPianoScore({ pianoListenabilityScore: 0.35 }),
            { thresholds: { pianoListenabilityScore: 0.50 } },
        );
        assert.equal(result.approved, false);
        assert.ok(result.failedDimensions.some((d) => d.startsWith("pianoListenabilityScore")));
        assert.equal(result.pianoListenabilityScore, 0.35);
    });

    it("ICA-07b: piano gate — pianoListenabilityScore above threshold → approved", () => {
        const result = computeInternalCriticApproval(
            passingCraftScore(),
            passingPianoScore({ pianoListenabilityScore: 0.72 }),
        );
        assert.equal(result.approved, true);
        assert.equal(result.pianoListenabilityScore, 0.72);
    });

    it("ICA-08: custom threshold overrides — lowered finalCraftScore threshold allows approval", () => {
        const craftScore = passingCraftScore({ finalCraftScore: 0.62 });
        const result = computeInternalCriticApproval(craftScore, undefined, {
            thresholds: { finalCraftScore: 0.60 },
        });
        assert.equal(result.approved, true, "should approve with lowered threshold");
    });

    it("ICA-08b: custom threshold overrides — raised threshold causes rejection", () => {
        const craftScore = passingCraftScore({ finalCraftScore: 0.76 });
        const result = computeInternalCriticApproval(craftScore, undefined, {
            thresholds: { finalCraftScore: 0.85 },
        });
        assert.equal(result.approved, false);
        assert.ok(result.failedDimensions.some((d) => d.startsWith("finalCraftScore")));
    });

    it("ICA-09: scoringProfileId extracted from craftScore.scoringProfile", () => {
        const result = computeInternalCriticApproval(
            passingCraftScore({ scoringProfile: "classical_default_v2" }),
        );
        assert.equal(result.scoringProfileId, "classical_default_v2");
    });

    it("ICA-09b: scoringProfileId from opts overrides craftScore.scoringProfile", () => {
        const result = computeInternalCriticApproval(
            passingCraftScore({ scoringProfile: "classical_default_v1" }),
            undefined,
            { scoringProfileId: "custom_experiment_v1" },
        );
        assert.equal(result.scoringProfileId, "custom_experiment_v1");
    });

    it("ICA-10: multiple failing dimensions — all included in failedDimensions", () => {
        const result = computeInternalCriticApproval(passingCraftScore({
            finalCraftScore:       0.50,
            advancedCraftScore:    0.40,
            evidenceCoverageScore: 0.30,
        }));
        assert.equal(result.approved, false);
        assert.ok(result.failedDimensions.some((d) => d.startsWith("finalCraftScore")));
        assert.ok(result.failedDimensions.some((d) => d.startsWith("advancedCraftScore")));
        assert.ok(result.failedDimensions.some((d) => d.startsWith("evidenceCoverageScore")));
        assert.equal(result.failedDimensions.length, 3);
    });

    it("ICA-11: evaluatedAt is set to a valid ISO timestamp", () => {
        const before = new Date().toISOString();
        const result = computeInternalCriticApproval(passingCraftScore());
        const after  = new Date().toISOString();
        assert.ok(result.evaluatedAt >= before && result.evaluatedAt <= after,
            `evaluatedAt=${result.evaluatedAt} should be between ${before} and ${after}`);
    });

    it("ICA-12: evaluatedAt can be overridden via opts", () => {
        const fixedTime = "2025-01-01T12:00:00.000Z";
        const result = computeInternalCriticApproval(
            passingCraftScore(),
            undefined,
            { evaluatedAt: fixedTime },
        );
        assert.equal(result.evaluatedAt, fixedTime);
    });

});
