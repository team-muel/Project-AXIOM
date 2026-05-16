import test from "node:test";
import assert from "node:assert/strict";
import {
    pearsonCorrelationClamped,
    computeMotifSurvivalRate,
    computeFinalPayoffScore,
    evaluateSonataCycle,
    movementQualityScore,
} from "../dist/pipeline/cycleEvaluation.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStructureEval(finalCraftScore = 0.7) {
    return {
        candidateCount: 4,
        passedSyntaxCheck: true,
        passedSectionContract: true,
        craftScore: {
            syntaxValidity: 1,
            sectionContractFit: 0.8,
            cadenceStrength: 0.7,
            tonalReturn: 0.8,
            motifSurvival: 0.75,
            voiceIndependence: 0.6,
            phraseShape: 0.7,
            registerIdiomaticFit: 0.75,
            finalCraftScore,
        },
    };
}

function makePianoCraftScore(finalPianoScore = 0.8) {
    return {
        handPlayability: 0.9,
        handIndependence: 0.8,
        registerSpacing: 0.85,
        voicingIdiomaticFit: 0.8,
        accompanimentPatternCoherence: 0.75,
        pedalPlausibility: 0.7,
        melodicClarity: 0.85,
        bassCoherence: 0.8,
        difficultyFit: 0.9,
        finalPianoScore,
    };
}

function makeMovementRecord(ordinal, opts = {}) {
    return {
        movementId: opts.id ?? `mov${ordinal}`,
        ordinal,
        songId: `song-${ordinal}`,
        selectedCandidateId: `cand-${ordinal}`,
        structureEvaluation: opts.structureEval ?? makeStructureEval(opts.craftScore ?? 0.7),
        pianoCraftScore: opts.pianoCraftScore ?? undefined,
        confirmedMotifIds: opts.confirmedMotifIds ?? [],
        elapsedMs: 1000,
        usedFallback: opts.usedFallback ?? false,
    };
}

function makeMotifMemory(entries = [], confirmedGlobalMotifIds = []) {
    return {
        entries,
        confirmedGlobalMotifIds,
        totalRecallCount: entries.reduce((n, e) => n + e.recalledInOrdinals.length, 0),
    };
}

function makeCyclePlan(movements, globalMotifIds = ["m1"], globalTensionCurve = []) {
    return {
        title: "Test Cycle",
        totalDurationSec: 1200,
        globalKey: "C major",
        globalMotifIds,
        movements,
        crossMovementRecall: [],
        globalTensionCurve: globalTensionCurve.length ? globalTensionCurve : [0.5, 0.6, 0.7, 0.8],
    };
}

function makeSimpleCycleResult(movements, motifMemory = null) {
    return {
        cycleId: "test-cycle-id",
        cyclePlanTitle: "Test Cycle",
        completedAt: new Date().toISOString(),
        movements,
        motifMemory: motifMemory ?? makeMotifMemory(),
        cycleEvaluation: null,
    };
}

// ─── pearsonCorrelationClamped ─────────────────────────────────────────────────

test("pearsonCorrelationClamped returns 1 for identical arrays", () => {
    const r = pearsonCorrelationClamped([1, 2, 3, 4], [1, 2, 3, 4]);
    assert.ok(Math.abs(r - 1) < 1e-9);
});

test("pearsonCorrelationClamped returns 0 for constant input (zero variance)", () => {
    const r = pearsonCorrelationClamped([1, 1, 1], [1, 2, 3]);
    assert.equal(r, 0);
});

test("pearsonCorrelationClamped clamps negative correlation to 0", () => {
    const r = pearsonCorrelationClamped([1, 2, 3, 4], [4, 3, 2, 1]);
    assert.equal(r, 0);
});

test("pearsonCorrelationClamped returns 0 for fewer than 2 points", () => {
    assert.equal(pearsonCorrelationClamped([0.5], [0.5]), 0);
    assert.equal(pearsonCorrelationClamped([], []), 0);
});

test("pearsonCorrelationClamped returns intermediate value for partial correlation", () => {
    const r = pearsonCorrelationClamped([0.3, 0.5, 0.8, 0.9], [0.3, 0.6, 0.7, 0.95]);
    assert.ok(r > 0.8 && r <= 1);
});

// ─── movementQualityScore ─────────────────────────────────────────────────────

test("movementQualityScore prefers finalPianoScore when pianoCraftScore is present", () => {
    const record = makeMovementRecord(1, {
        pianoCraftScore: makePianoCraftScore(0.88),
    });
    assert.equal(movementQualityScore(record), 0.88);
});

test("movementQualityScore falls back to finalCraftScore for non-piano movement", () => {
    const record = makeMovementRecord(1, { craftScore: 0.72 });
    assert.equal(movementQualityScore(record), 0.72);
});

test("movementQualityScore returns 0 when no evaluation fields are present", () => {
    const record = {
        movementId: "mov1",
        ordinal: 1,
        songId: "s1",
        selectedCandidateId: "c1",
        structureEvaluation: { candidateCount: 0, passedSyntaxCheck: false, passedSectionContract: false },
        confirmedMotifIds: [],
        elapsedMs: 0,
        usedFallback: false,
    };
    assert.equal(movementQualityScore(record), 0);
});

// ─── computeMotifSurvivalRate ─────────────────────────────────────────────────

test("computeMotifSurvivalRate returns 1 when globalMotifIds is empty", () => {
    const memory = makeMotifMemory([], []);
    assert.equal(computeMotifSurvivalRate([], memory), 1);
});

test("computeMotifSurvivalRate returns 1 when all global motifs survived", () => {
    const memory = makeMotifMemory(
        [
            { motifId: "m1", introducedInOrdinal: 1, recalledInOrdinals: [2, 3], evidenceStrength: 0.8 },
            { motifId: "m2", introducedInOrdinal: 1, recalledInOrdinals: [4], evidenceStrength: 0.7 },
        ],
        ["m1", "m2"],
    );
    assert.equal(computeMotifSurvivalRate(["m1", "m2"], memory), 1);
});

test("computeMotifSurvivalRate returns 0.5 when half of global motifs survived", () => {
    const memory = makeMotifMemory(
        [{ motifId: "m1", introducedInOrdinal: 1, recalledInOrdinals: [3], evidenceStrength: 0.7 }],
        ["m1"],
    );
    assert.equal(computeMotifSurvivalRate(["m1", "m2"], memory), 0.5);
});

test("computeMotifSurvivalRate returns 0 when no global motifs survived", () => {
    const memory = makeMotifMemory([], []);
    assert.equal(computeMotifSurvivalRate(["m1", "m2"], memory), 0);
});

// ─── computeFinalPayoffScore ──────────────────────────────────────────────────

test("computeFinalPayoffScore returns 0 for empty movements", () => {
    assert.equal(computeFinalPayoffScore([], 4), 0);
});

test("computeFinalPayoffScore is finalQuality * 1 when all movements complete", () => {
    const movements = [
        makeMovementRecord(1, { craftScore: 0.7 }),
        makeMovementRecord(2, { craftScore: 0.65 }),
        makeMovementRecord(3, { craftScore: 0.6 }),
        makeMovementRecord(4, { craftScore: 0.85 }),
    ];
    const score = computeFinalPayoffScore(movements, 4);
    assert.ok(Math.abs(score - 0.85) < 1e-9);
});

test("computeFinalPayoffScore is scaled down when cycle is incomplete", () => {
    const movements = [
        makeMovementRecord(1, { craftScore: 0.7 }),
        makeMovementRecord(2, { craftScore: 0.9 }),
    ];
    const score = computeFinalPayoffScore(movements, 4);
    // last quality = 0.9, completion fraction = 2/4 = 0.5
    assert.ok(Math.abs(score - 0.45) < 1e-9);
});

test("computeFinalPayoffScore uses finalPianoScore for piano movements", () => {
    const movements = [
        makeMovementRecord(1, { pianoCraftScore: makePianoCraftScore(0.82) }),
        makeMovementRecord(2, { pianoCraftScore: makePianoCraftScore(0.90) }),
        makeMovementRecord(3, { pianoCraftScore: makePianoCraftScore(0.78) }),
        makeMovementRecord(4, { pianoCraftScore: makePianoCraftScore(0.92) }),
    ];
    const score = computeFinalPayoffScore(movements, 4);
    assert.ok(Math.abs(score - 0.92) < 1e-9);
});

// ─── evaluateSonataCycle ──────────────────────────────────────────────────────

test("evaluateSonataCycle returns zeros for empty movement list", () => {
    const plan = makeCyclePlan([]);
    const result = makeSimpleCycleResult([]);
    const report = evaluateSonataCycle(result, plan);
    assert.equal(report.tensionArcMatch, 0);
    assert.equal(report.crossMovementMotifSurvivalRate, 0);
    assert.equal(report.finalPayoffScore, 0);
    assert.equal(report.movementCohesionScore, 0);
    assert.equal(report.compositeCycleScore, 0);
    assert.equal(report.completedMovementCount, 0);
    assert.equal(report.plannedMovementCount, 0);
    assert.equal(report.allMovementsPassedGate3, false);
    assert.deepEqual(report.movementNotes, []);
});

test("evaluateSonataCycle produces compositeCycleScore in [0,1] for 4-movement cycle", () => {
    const movements = [
        makeMovementRecord(1, { craftScore: 0.70 }),
        makeMovementRecord(2, { craftScore: 0.65 }),
        makeMovementRecord(3, { craftScore: 0.60 }),
        makeMovementRecord(4, { craftScore: 0.80 }),
    ];
    const plan = makeCyclePlan(
        movements.map((m) => ({
            id: m.movementId,
            ordinal: m.ordinal,
            form: "sonata_allegro",
            key: "C major",
            tempo: 120,
            targetDurationSec: 300,
            functionInCycle: m.ordinal === 1 ? "opening_argument" : "resolution",
            inheritedMotifs: [],
            newMotifs: [],
        })),
        ["m1"],
        [0.5, 0.6, 0.7, 0.8],
    );
    const memory = makeMotifMemory(
        [{ motifId: "m1", introducedInOrdinal: 1, recalledInOrdinals: [2, 3, 4], evidenceStrength: 0.7 }],
        ["m1"],
    );
    const result = makeSimpleCycleResult(movements, memory);
    const report = evaluateSonataCycle(result, plan);

    assert.ok(report.compositeCycleScore >= 0 && report.compositeCycleScore <= 1,
        `compositeCycleScore ${report.compositeCycleScore} should be in [0,1]`);
    assert.equal(report.completedMovementCount, 4);
    assert.equal(report.plannedMovementCount, 4);
    assert.equal(report.movementNotes.length, 4);
});

test("evaluateSonataCycle flags allMovementsPassedGate3=true for high-quality cycle", () => {
    const movements = [
        makeMovementRecord(1, { craftScore: 0.80 }),
        makeMovementRecord(2, { craftScore: 0.75 }),
        makeMovementRecord(3, { craftScore: 0.70 }),
        makeMovementRecord(4, { craftScore: 0.85 }),
    ];
    const plan = makeCyclePlan(
        movements.map((m) => ({
            id: m.movementId,
            ordinal: m.ordinal,
            form: "sonata_allegro",
            key: "C major",
            tempo: 120,
            targetDurationSec: 300,
            functionInCycle: "opening_argument",
            inheritedMotifs: [],
            newMotifs: [],
        })),
        [],
        [0.5, 0.6, 0.7, 0.8],
    );
    const result = makeSimpleCycleResult(movements);
    const report = evaluateSonataCycle(result, plan);
    assert.equal(report.allMovementsPassedGate3, true);
});

test("evaluateSonataCycle flags allMovementsPassedGate3=false when fallback used", () => {
    const movements = [
        makeMovementRecord(1, { craftScore: 0.80 }),
        makeMovementRecord(2, { craftScore: 0.40, usedFallback: true }),
    ];
    const plan = makeCyclePlan(
        movements.map((m) => ({
            id: m.movementId,
            ordinal: m.ordinal,
            form: "sonata_allegro",
            key: "C major",
            tempo: 120,
            targetDurationSec: 300,
            functionInCycle: "opening_argument",
            inheritedMotifs: [],
            newMotifs: [],
        })),
        [],
        [0.5, 0.6],
    );
    const result = makeSimpleCycleResult(movements);
    const report = evaluateSonataCycle(result, plan);
    assert.equal(report.allMovementsPassedGate3, false);
});

test("evaluateSonataCycle crossMovementMotifSurvivalRate is 1 when no global motifs planned", () => {
    const movements = [
        makeMovementRecord(1, { craftScore: 0.7 }),
        makeMovementRecord(2, { craftScore: 0.6 }),
    ];
    const plan = makeCyclePlan(
        movements.map((m) => ({
            id: m.movementId,
            ordinal: m.ordinal,
            form: "sonata_allegro",
            key: "C major",
            tempo: 120,
            targetDurationSec: 300,
            functionInCycle: "opening_argument",
            inheritedMotifs: [],
            newMotifs: [],
        })),
        [], // no global motifs
        [0.5, 0.7],
    );
    const result = makeSimpleCycleResult(movements);
    const report = evaluateSonataCycle(result, plan);
    assert.equal(report.crossMovementMotifSurvivalRate, 1);
});

test("evaluateSonataCycle movementNotes has one entry per completed movement", () => {
    const movements = [
        makeMovementRecord(1, { craftScore: 0.7 }),
        makeMovementRecord(2, { craftScore: 0.6 }),
        makeMovementRecord(3, { craftScore: 0.55 }),
    ];
    const plan = makeCyclePlan(
        movements.map((m) => ({
            id: m.movementId,
            ordinal: m.ordinal,
            form: "sonata_allegro",
            key: "C major",
            tempo: 120,
            targetDurationSec: 300,
            functionInCycle: "opening_argument",
            inheritedMotifs: [],
            newMotifs: [],
        })),
        [],
        [0.5, 0.6, 0.7],
    );
    const result = makeSimpleCycleResult(movements);
    const report = evaluateSonataCycle(result, plan);
    assert.equal(report.movementNotes.length, 3);
    const ordinals = report.movementNotes.map((n) => n.ordinal);
    assert.deepEqual(ordinals, [1, 2, 3]);
});

test("evaluateSonataCycle tensionArcMatch is 1 for cycle whose scores perfectly track planned curve", () => {
    // Plan 4 samples normalised to [0.5, 0.6, 0.7, 0.8]; craft scores match exactly
    const movements = [
        makeMovementRecord(1, { craftScore: 0.5 }),
        makeMovementRecord(2, { craftScore: 0.6 }),
        makeMovementRecord(3, { craftScore: 0.7 }),
        makeMovementRecord(4, { craftScore: 0.8 }),
    ];
    const plan = makeCyclePlan(
        movements.map((m) => ({
            id: m.movementId,
            ordinal: m.ordinal,
            form: "sonata_allegro",
            key: "C major",
            tempo: 120,
            targetDurationSec: 300,
            functionInCycle: "opening_argument",
            inheritedMotifs: [],
            newMotifs: [],
        })),
        [],
        [0.5, 0.6, 0.7, 0.8],
    );
    const result = makeSimpleCycleResult(movements);
    const report = evaluateSonataCycle(result, plan);
    assert.ok(report.tensionArcMatch > 0.99, `tensionArcMatch should be ~1 but got ${report.tensionArcMatch}`);
});
