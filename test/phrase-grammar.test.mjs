/**
 * test/phrase-grammar.test.mjs
 *
 * Tests for:
 *   - phraseGrammar.ts builder functions (PR 2)
 *   - craftScoring.ts supplementary metrics (PR 1)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildSentenceStructure,
    buildPeriodStructure,
    computeHypermetricGroups,
    choosePhraseStructure,
    applyPhraseGrammarToSections,
} from "../dist/core/plan/phraseGrammar.js";
import {
    computeMotifTransformVariety,
    computeHarmonicRhythmVariance,
    computeTextureProfileScore,
    computeCadenceArchitecturalWeight,
    computePhraseGrammarScore,
    computeCraftScoreSummary,
} from "../dist/core/evaluate/craftScoring.js";

// ─── Phrase Grammar Builder Tests ────────────────────────────────────────────

describe("buildSentenceStructure", () => {
    it("returns 4 units for 8-measure sentence", () => {
        const s = buildSentenceStructure(8);
        assert.strictEqual(s.type, "sentence");
        assert.strictEqual(s.totalMeasures, 8);
        assert.ok(s.basicIdea.measures > 0, "basicIdea has measures");
        assert.ok(s.repetition.measures > 0, "repetition has measures");
        assert.ok(s.continuation.measures > 0, "continuation has measures");
        assert.ok(s.cadential.measures > 0, "cadential has measures");
    });

    it("totalMeasures sums match for 8-bar sentence", () => {
        const s = buildSentenceStructure(8);
        const total = s.basicIdea.measures + s.repetition.measures
            + s.continuation.measures + s.cadential.measures;
        assert.strictEqual(total, 8);
    });

    it("basicIdea starts at measure 1", () => {
        const s = buildSentenceStructure(8);
        assert.strictEqual(s.basicIdea.startMeasure, 1);
    });

    it("cadential ends on authentic cadence", () => {
        const s = buildSentenceStructure(8);
        assert.strictEqual(s.cadential.cadenceType, "authentic");
    });

    it("repetition ends on half cadence", () => {
        const s = buildSentenceStructure(8);
        assert.strictEqual(s.repetition.cadenceType, "half");
    });

    it("handles non-standard measure count (6 measures)", () => {
        const s = buildSentenceStructure(6);
        assert.strictEqual(s.type, "sentence");
        const total = s.basicIdea.measures + s.repetition.measures
            + s.continuation.measures + s.cadential.measures;
        assert.strictEqual(total, 6);
    });
});

describe("buildPeriodStructure", () => {
    it("returns 2 units for 8-measure period", () => {
        const p = buildPeriodStructure(8);
        assert.strictEqual(p.type, "period");
        assert.strictEqual(p.totalMeasures, 8);
        assert.ok(p.antecedent.measures > 0, "antecedent has measures");
        assert.ok(p.consequent.measures > 0, "consequent has measures");
    });

    it("4+4 split for 8 measures", () => {
        const p = buildPeriodStructure(8);
        assert.strictEqual(p.antecedent.measures, 4);
        assert.strictEqual(p.consequent.measures, 4);
    });

    it("antecedent ends on half cadence", () => {
        const p = buildPeriodStructure(8);
        assert.strictEqual(p.antecedent.cadenceType, "half");
    });

    it("consequent ends on authentic cadence", () => {
        const p = buildPeriodStructure(8);
        assert.strictEqual(p.consequent.cadenceType, "authentic");
    });

    it("antecedent starts at measure 1, consequent follows", () => {
        const p = buildPeriodStructure(8);
        assert.strictEqual(p.antecedent.startMeasure, 1);
        assert.strictEqual(p.consequent.startMeasure, 5);
    });
});

describe("computeHypermetricGroups", () => {
    it("sentence of 8 measures produces 4 groups", () => {
        const s = buildSentenceStructure(8);
        const groups = computeHypermetricGroups(8, s);
        assert.strictEqual(groups.length, 4);
    });

    it("period of 8 measures produces 2 groups", () => {
        const p = buildPeriodStructure(8);
        const groups = computeHypermetricGroups(8, p);
        assert.strictEqual(groups.length, 2);
    });

    it("16-measure structure uses 8bar grouping", () => {
        const s = buildSentenceStructure(16);
        const groups = computeHypermetricGroups(16, s);
        assert.ok(groups.every((g) => g.type === "8bar"), "all groups should be 8bar");
    });

    it("8-measure structure uses 4bar grouping", () => {
        const p = buildPeriodStructure(8);
        const groups = computeHypermetricGroups(8, p);
        assert.ok(groups.every((g) => g.type === "4bar"), "all groups should be 4bar");
    });

    it("4-measure structure uses 2bar grouping", () => {
        const s = buildSentenceStructure(4);
        const groups = computeHypermetricGroups(4, s);
        assert.ok(groups.every((g) => g.type === "2bar"), "all groups should be 2bar");
    });
});

describe("choosePhraseStructure", () => {
    it("theme_a with 8 measures defaults to period", () => {
        const plan = choosePhraseStructure("theme_a", 8);
        assert.strictEqual(plan.structure.type, "period");
    });

    it("development with 8 measures defaults to sentence", () => {
        const plan = choosePhraseStructure("development", 8);
        assert.strictEqual(plan.structure.type, "sentence");
    });

    it("explicit period preference forces period on development", () => {
        const plan = choosePhraseStructure("development", 8, "period");
        assert.strictEqual(plan.structure.type, "period");
    });

    it("explicit sentence preference forces sentence on theme_a", () => {
        const plan = choosePhraseStructure("theme_a", 8, "sentence");
        assert.strictEqual(plan.structure.type, "sentence");
    });

    it("hypermetricGroups are present and non-empty", () => {
        const plan = choosePhraseStructure("theme_a", 8);
        assert.ok(plan.hypermetricGroups.length > 0, "hypermetricGroups not empty");
    });

    it("notes include structure type and role", () => {
        const plan = choosePhraseStructure("recap", 8);
        assert.ok(plan.notes.some((n) => n.includes("recap")), "notes mention role");
    });

    it("non-mult-of-4 measures adds irregularity note", () => {
        const plan = choosePhraseStructure("theme_a", 6);
        assert.ok(plan.notes.some((n) => n.includes("irregular")), "notes mention irregular");
    });
});

describe("applyPhraseGrammarToSections", () => {
    const sections = [
        { id: "s1", role: "theme_a", label: "Theme A", measures: 8, energy: 0.5, density: 0.4 },
        { id: "s2", role: "development", label: "Dev", measures: 8, energy: 0.7, density: 0.6 },
        { id: "s3", role: "recap", label: "Recap", measures: 8, energy: 0.5, density: 0.4 },
    ];

    it("annotates all eligible sections", () => {
        const map = applyPhraseGrammarToSections(sections);
        assert.strictEqual(map.size, 3);
    });

    it("skips sections with < 2 measures", () => {
        const tiny = [{ id: "t1", role: "intro", label: "Intro", measures: 1, energy: 0.3, density: 0.2 }];
        const map = applyPhraseGrammarToSections(tiny);
        assert.strictEqual(map.size, 0);
    });

    it("theme_a gets period structure", () => {
        const map = applyPhraseGrammarToSections(sections);
        assert.strictEqual(map.get("s1")?.structure.type, "period");
    });

    it("development gets sentence structure", () => {
        const map = applyPhraseGrammarToSections(sections);
        assert.strictEqual(map.get("s2")?.structure.type, "sentence");
    });
});

// ─── Supplementary Craft Score Metric Tests ───────────────────────────────────

describe("computeMotifTransformVariety", () => {
    it("returns neutral score when no transform data", () => {
        const result = computeMotifTransformVariety([]);
        assert.strictEqual(result.score, 0.4);
    });

    it("rewards diverse transform modes", () => {
        const artifacts = [
            { sectionId: "s1", role: "theme_a", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              transform: { sectionId: "s1", role: "theme_a", transformMode: "sequence", rhythmTransform: "augmentation" } },
            { sectionId: "s2", role: "development", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              transform: { sectionId: "s2", role: "development", transformMode: "inversion", rhythmTransform: "diminution" } },
            { sectionId: "s3", role: "recap", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              transform: { sectionId: "s3", role: "recap", transformMode: "fragmentation" } },
        ];
        const result = computeMotifTransformVariety(artifacts);
        assert.ok(result.score > 0.5, `score ${result.score} should be > 0.5 for diverse transforms`);
    });

    it("lower score for uniform transform mode", () => {
        const artifacts = [
            { sectionId: "s1", role: "theme_a", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              transform: { sectionId: "s1", role: "theme_a", transformMode: "sequence" } },
            { sectionId: "s2", role: "development", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              transform: { sectionId: "s2", role: "development", transformMode: "sequence" } },
        ];
        const diverse = [
            { sectionId: "s1", role: "theme_a", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              transform: { sectionId: "s1", role: "theme_a", transformMode: "sequence", rhythmTransform: "augmentation" } },
            { sectionId: "s2", role: "development", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              transform: { sectionId: "s2", role: "development", transformMode: "inversion", rhythmTransform: "diminution" } },
        ];
        const uniform = computeMotifTransformVariety(artifacts);
        const varied = computeMotifTransformVariety(diverse);
        assert.ok(varied.score > uniform.score, `varied ${varied.score} should exceed uniform ${uniform.score}`);
    });
});

describe("computeHarmonicRhythmVariance", () => {
    it("returns neutral score with no data", () => {
        const result = computeHarmonicRhythmVariance([], undefined);
        assert.strictEqual(result.score, 0.4);
    });

    it("high variance for slow/fast contrast", () => {
        const plan = {
            sections: [
                { id: "s1", role: "theme_a", label: "A", measures: 8, energy: 0.5, density: 0.4,
                  harmonicPlan: { harmonicRhythm: "slow" } },
                { id: "s2", role: "development", label: "D", measures: 8, energy: 0.7, density: 0.6,
                  harmonicPlan: { harmonicRhythm: "fast" } },
                { id: "s3", role: "recap", label: "R", measures: 8, energy: 0.5, density: 0.4,
                  harmonicPlan: { harmonicRhythm: "slow" } },
            ],
        };
        const result = computeHarmonicRhythmVariance([], plan);
        assert.ok(result.score > 0.5, `score ${result.score} should be high for slow/fast contrast`);
    });

    it("low variance for uniform rhythm", () => {
        const plan = {
            sections: [
                { id: "s1", role: "theme_a", label: "A", measures: 8, energy: 0.5, density: 0.4,
                  harmonicPlan: { harmonicRhythm: "medium" } },
                { id: "s2", role: "development", label: "D", measures: 8, energy: 0.7, density: 0.6,
                  harmonicPlan: { harmonicRhythm: "medium" } },
            ],
        };
        const result = computeHarmonicRhythmVariance([], plan);
        assert.ok(result.score < 0.4, `score ${result.score} should be low for uniform rhythm`);
    });
});

describe("computeTextureProfileScore", () => {
    it("returns neutral for empty data", () => {
        const result = computeTextureProfileScore([], undefined);
        assert.strictEqual(result.score, 0.4);
    });

    it("rewards diverse texture profiles", () => {
        const artifacts = [
            { sectionId: "s1", role: "theme_a", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              primaryTextureRoles: ["lead", "bass"], counterpointMode: "melody_only" },
            { sectionId: "s2", role: "development", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              primaryTextureRoles: ["lead", "inner", "bass"], counterpointMode: "full_counterpoint" },
            { sectionId: "s3", role: "recap", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              primaryTextureRoles: ["lead", "bass"], counterpointMode: "melody_bass" },
        ];
        const result = computeTextureProfileScore(artifacts, undefined);
        assert.ok(result.score > 0.4, `score ${result.score} should be > 0.4`);
    });
});

describe("computeCadenceArchitecturalWeight", () => {
    it("returns 0.5 when no critical sections", () => {
        const result = computeCadenceArchitecturalWeight([], undefined);
        assert.strictEqual(result.score, 0.5);
    });

    it("high score when recap and final have dominant cadence", () => {
        const artifacts = [
            { sectionId: "s1", role: "theme_a", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              cadenceApproach: "tonic" },
            { sectionId: "s2", role: "recap", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              cadenceApproach: "dominant" },
            { sectionId: "s3", role: "outro", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              cadenceApproach: "dominant" },
        ];
        const result = computeCadenceArchitecturalWeight(artifacts, undefined);
        assert.ok(result.score > 0.8, `score ${result.score} should be high with dominant PAC at structural positions`);
    });

    it("lower score with no cadence approach data", () => {
        const artifacts = [
            { sectionId: "s1", role: "recap", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [] },
            { sectionId: "s2", role: "outro", measureCount: 4, melodyEvents: [], accompanimentEvents: [], noteHistory: [] },
        ];
        const result = computeCadenceArchitecturalWeight(artifacts, undefined);
        assert.ok(result.score < 0.5, `score ${result.score} should be < 0.5 with no cadence data`);
    });
});

describe("computePhraseGrammarScore", () => {
    it("baseline 0.4 for empty data", () => {
        const result = computePhraseGrammarScore([], undefined);
        assert.strictEqual(result.score, 0.4);
    });

    it("rewards sentence pattern (presentation→continuation→cadential)", () => {
        const artifacts = [
            { sectionId: "s1", role: "theme_a", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              phraseFunction: "presentation" },
            { sectionId: "s2", role: "development", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              phraseFunction: "continuation" },
            { sectionId: "s3", role: "recap", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              phraseFunction: "cadential" },
        ];
        const result = computePhraseGrammarScore(artifacts, undefined);
        assert.ok(result.score > 0.5, `score ${result.score} should reward sentence pattern`);
    });

    it("rewards phrase peaks in sections", () => {
        const artifacts = [
            { sectionId: "s1", role: "theme_a", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              phrasePeaks: [4, 7] },
            { sectionId: "s2", role: "development", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              phrasePeaks: [3, 6] },
            { sectionId: "s3", role: "recap", measureCount: 8, melodyEvents: [], accompanimentEvents: [], noteHistory: [],
              phrasePeaks: [4] },
        ];
        const result = computePhraseGrammarScore(artifacts, undefined);
        assert.ok(result.score > 0.4, `score ${result.score} should reward phrase peaks`);
    });

    it("rewards 4-bar hypermeter in plan sections", () => {
        const plan = {
            sections: [
                { id: "s1", role: "theme_a", label: "A", measures: 8, energy: 0.5, density: 0.4 },
                { id: "s2", role: "development", label: "D", measures: 8, energy: 0.7, density: 0.6 },
                { id: "s3", role: "recap", label: "R", measures: 8, energy: 0.5, density: 0.4 },
                { id: "s4", role: "cadence", label: "C", measures: 4, energy: 0.3, density: 0.3 },
            ],
        };
        const result = computePhraseGrammarScore([], plan);
        assert.ok(result.score > 0.4, `score ${result.score} should reward hypermeter`);
    });

    it("rewards phraseSpanShape annotation", () => {
        const plan = {
            sections: [
                { id: "s1", role: "theme_a", label: "A", measures: 8, energy: 0.5, density: 0.4,
                  phraseSpanShape: "period" },
                { id: "s2", role: "development", label: "D", measures: 8, energy: 0.7, density: 0.6,
                  phraseSpanShape: "sentence" },
            ],
        };
        const result = computePhraseGrammarScore([], plan);
        assert.ok(result.score > 0.5, `score ${result.score} should reward phraseSpanShape annotations`);
    });
});

describe("computeCraftScoreSummary — supplementary fields", () => {
    const makeArtifact = (id, role) => ({
        sectionId: id,
        role,
        measureCount: 8,
        melodyEvents: [],
        accompanimentEvents: [],
        noteHistory: [],
    });

    const evaluation = {
        passed: true,
        score: 0.8,
        issues: [],
        strengths: [],
        metrics: {},
    };

    it("includes all 5 supplementary fields in output", () => {
        const artifacts = [makeArtifact("s1", "theme_a"), makeArtifact("s2", "development"), makeArtifact("s3", "recap")];
        const result = computeCraftScoreSummary(artifacts, undefined, evaluation);
        assert.ok("motifTransformVariety" in result, "motifTransformVariety present");
        assert.ok("harmonicRhythmVariance" in result, "harmonicRhythmVariance present");
        assert.ok("textureProfileScore" in result, "textureProfileScore present");
        assert.ok("cadenceArchitecturalWeight" in result, "cadenceArchitecturalWeight present");
        assert.ok("phraseGrammarScore" in result, "phraseGrammarScore present");
    });

    it("supplementary fields are numbers in [0, 1]", () => {
        const artifacts = [makeArtifact("s1", "theme_a"), makeArtifact("s2", "recap")];
        const result = computeCraftScoreSummary(artifacts, undefined, evaluation);
        for (const field of ["motifTransformVariety", "harmonicRhythmVariance", "textureProfileScore",
                              "cadenceArchitecturalWeight", "phraseGrammarScore"]) {
            const v = result[field];
            assert.ok(typeof v === "number", `${field} should be number`);
            assert.ok(v >= 0 && v <= 1, `${field} ${v} should be in [0, 1]`);
        }
    });

    it("finalCraftScore formula unchanged (8-dimension weighted sum)", () => {
        const artifacts = [makeArtifact("s1", "theme_a")];
        const result = computeCraftScoreSummary(artifacts, undefined, evaluation);
        const expected = Number(
            (
                0.15 * result.sectionContractFit
                + 0.15 * result.cadenceStrength
                + 0.15 * result.tonalReturn
                + 0.15 * result.motifSurvival
                + 0.15 * result.voiceIndependence
                + 0.10 * result.phraseShape
                + 0.10 * result.registerIdiomaticFit
                + 0.05 * result.syntaxValidity
            ).toFixed(4),
        );
        assert.strictEqual(result.finalCraftScore, expected);
    });
});
