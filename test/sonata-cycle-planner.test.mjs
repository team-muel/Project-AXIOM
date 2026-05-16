import test from "node:test";
import assert from "node:assert/strict";
import {
    deriveCycleTensionCurve,
    validateSonataCyclePlan,
    extractMovementPlanFromCompositionPlan,
    buildSonataCyclePlan,
} from "../dist/pipeline/sonataCyclePlanner.js";

function makeMinimalPlan(overrides = {}) {
    return {
        version: "v1",
        brief: "test",
        mood: [],
        form: "sonata",
        workflow: "symbolic_only",
        instrumentation: [],
        motifPolicy: { reuseRequired: true },
        sections: [],
        rationale: "test",
        key: "C major",
        tempo: 120,
        targetDurationSec: 300,
        ...overrides,
    };
}

function makeMovementPlan(overrides = {}) {
    return {
        id: "mov1",
        ordinal: 1,
        form: "sonata_allegro",
        key: "C major",
        tempo: 132,
        targetDurationSec: 360,
        functionInCycle: "opening_argument",
        inheritedMotifs: [],
        newMotifs: ["m1", "m2"],
        ...overrides,
    };
}

// ─── deriveCycleTensionCurve ──────────────────────────────────────────────────

test("deriveCycleTensionCurve returns 8 samples per movement", () => {
    const movements = [
        makeMovementPlan({ ordinal: 1, functionInCycle: "opening_argument" }),
        makeMovementPlan({ id: "mov2", ordinal: 2, functionInCycle: "lyrical_center", inheritedMotifs: ["m1"], newMotifs: ["m3"] }),
        makeMovementPlan({ id: "mov3", ordinal: 3, functionInCycle: "contrast", inheritedMotifs: ["m1"], newMotifs: ["m4"] }),
        makeMovementPlan({ id: "mov4", ordinal: 4, functionInCycle: "resolution", inheritedMotifs: ["m1", "m2"], newMotifs: [] }),
    ];

    const curve = deriveCycleTensionCurve(movements);

    assert.equal(curve.length, 32);
    assert.ok(curve.every((v) => v >= 0 && v <= 1));
});

test("deriveCycleTensionCurve returns empty array for no movements", () => {
    assert.deepEqual(deriveCycleTensionCurve([]), []);
});

test("deriveCycleTensionCurve sorts by ordinal before sampling", () => {
    const movements = [
        makeMovementPlan({ id: "mov3", ordinal: 3, functionInCycle: "contrast", inheritedMotifs: ["m1"], newMotifs: [] }),
        makeMovementPlan({ ordinal: 1, functionInCycle: "opening_argument" }),
    ];

    const curve = deriveCycleTensionCurve(movements);

    // First 8 samples must match the opening_argument envelope
    assert.equal(curve[0], 0.38);
    assert.equal(curve[7], 0.42);
    // Samples 8–15 must match the contrast envelope
    assert.equal(curve[8], 0.42);
});

// ─── validateSonataCyclePlan ──────────────────────────────────────────────────

test("validateSonataCyclePlan accepts a valid 4-movement cycle", () => {
    const cycle = buildSonataCyclePlan(
        "Sonata in C major",
        "C major",
        [
            {
                plan: makeMinimalPlan({
                    key: "C major", tempo: 132, targetDurationSec: 360,
                    sketch: { generatedBy: "planner", motifDrafts: [{ id: "m1", intervals: [2] }, { id: "m2", intervals: [-1] }], cadenceOptions: [] }
                }),
                ordinal: 1, form: "sonata_allegro", functionInCycle: "opening_argument",
            },
            {
                plan: makeMinimalPlan({ key: "A minor", tempo: 60, targetDurationSec: 300 }),
                ordinal: 2, form: "slow_ternary", functionInCycle: "lyrical_center", inheritedMotifs: ["m1"]
            },
            {
                plan: makeMinimalPlan({ key: "C major", tempo: 144, targetDurationSec: 180 }),
                ordinal: 3, form: "scherzo_trio", functionInCycle: "contrast", inheritedMotifs: ["m1"]
            },
            {
                plan: makeMinimalPlan({ key: "C major", tempo: 132, targetDurationSec: 420 }),
                ordinal: 4, form: "rondo_finale", functionInCycle: "resolution", inheritedMotifs: ["m1", "m2"]
            },
        ],
    );

    assert.deepEqual(validateSonataCyclePlan(cycle), []);
});

test("validateSonataCyclePlan rejects duplicate ordinals", () => {
    const cycle = {
        title: "Bad cycle",
        totalDurationSec: 720,
        globalKey: "C major",
        globalMotifIds: ["m1"],
        movements: [
            makeMovementPlan({ ordinal: 1, functionInCycle: "opening_argument" }),
            makeMovementPlan({ id: "mov2", ordinal: 1, functionInCycle: "lyrical_center" }),
        ],
        crossMovementRecall: [],
        globalTensionCurve: [],
    };

    const errors = validateSonataCyclePlan(cycle);
    assert.ok(errors.some((e) => e.includes("unique ordinals")));
});

test("validateSonataCyclePlan rejects missing ordinal 1", () => {
    const cycle = {
        title: "Missing first movement",
        totalDurationSec: 300,
        globalKey: "G major",
        globalMotifIds: ["m1"],
        movements: [
            makeMovementPlan({ id: "mov2", ordinal: 2, functionInCycle: "lyrical_center", inheritedMotifs: ["m1"] }),
        ],
        crossMovementRecall: [],
        globalTensionCurve: [],
    };

    const errors = validateSonataCyclePlan(cycle);
    assert.ok(errors.some((e) => e.includes("ordinal 1")));
});

test("validateSonataCyclePlan rejects ordinal-1 movement with wrong functionInCycle", () => {
    const cycle = {
        title: "Wrong function",
        totalDurationSec: 360,
        globalKey: "D major",
        globalMotifIds: ["m1"],
        movements: [makeMovementPlan({ ordinal: 1, functionInCycle: "lyrical_center" })],
        crossMovementRecall: [],
        globalTensionCurve: [],
    };

    const errors = validateSonataCyclePlan(cycle);
    assert.ok(errors.some((e) => e.includes("opening_argument")));
});

test("validateSonataCyclePlan rejects last movement without 'resolution' function", () => {
    const cycle = {
        title: "Unresolved cycle",
        totalDurationSec: 660,
        globalKey: "F major",
        globalMotifIds: ["m1"],
        movements: [
            makeMovementPlan({ ordinal: 1, functionInCycle: "opening_argument", newMotifs: ["m1"] }),
            makeMovementPlan({ id: "mov2", ordinal: 2, functionInCycle: "lyrical_center", inheritedMotifs: ["m1"], newMotifs: [] }),
            makeMovementPlan({ id: "mov3", ordinal: 3, functionInCycle: "contrast", inheritedMotifs: ["m1"], newMotifs: [] }),
        ],
        crossMovementRecall: [],
        globalTensionCurve: [],
    };

    const errors = validateSonataCyclePlan(cycle);
    assert.ok(errors.some((e) => e.includes("'resolution'")));
});

test("validateSonataCyclePlan rejects inherited motif undeclared in preceding movements", () => {
    const cycle = {
        title: "Ghost motif cycle",
        totalDurationSec: 1260,
        globalKey: "F major",
        globalMotifIds: ["m1"],
        movements: [
            makeMovementPlan({ ordinal: 1, functionInCycle: "opening_argument", newMotifs: ["m1"] }),
            makeMovementPlan({ id: "mov2", ordinal: 2, functionInCycle: "lyrical_center", inheritedMotifs: ["ghost99"], newMotifs: ["m2"] }),
            makeMovementPlan({ id: "mov3", ordinal: 3, functionInCycle: "contrast", inheritedMotifs: ["m1"], newMotifs: [] }),
            makeMovementPlan({ id: "mov4", ordinal: 4, functionInCycle: "resolution", inheritedMotifs: ["m1"], newMotifs: [] }),
        ],
        crossMovementRecall: [],
        globalTensionCurve: [],
    };

    const errors = validateSonataCyclePlan(cycle);
    assert.ok(errors.some((e) => e.includes("ghost99")));
});

test("validateSonataCyclePlan rejects cross-movement recall with unknown motif in source", () => {
    const cycle = {
        title: "Bad recall",
        totalDurationSec: 1260,
        globalKey: "E major",
        globalMotifIds: ["m1"],
        movements: [
            makeMovementPlan({ ordinal: 1, functionInCycle: "opening_argument", newMotifs: ["m1", "m2"] }),
            makeMovementPlan({ id: "mov2", ordinal: 2, functionInCycle: "lyrical_center", inheritedMotifs: ["m1"], newMotifs: ["m3"] }),
            makeMovementPlan({ id: "mov3", ordinal: 3, functionInCycle: "contrast", inheritedMotifs: ["m1"], newMotifs: [] }),
            makeMovementPlan({ id: "mov4", ordinal: 4, functionInCycle: "resolution", inheritedMotifs: ["m1"], newMotifs: [] }),
        ],
        crossMovementRecall: [
            { movementId: "mov4", sourceMovementId: "mov1", motifIds: ["ghost_motif"], kind: "transformed" },
        ],
        globalTensionCurve: [],
    };

    const errors = validateSonataCyclePlan(cycle);
    assert.ok(errors.some((e) => e.includes("ghost_motif")));
});

test("validateSonataCyclePlan rejects cross-movement recall with unknown movementId", () => {
    const cycle = {
        title: "Unknown movement recall",
        totalDurationSec: 1260,
        globalKey: "B major",
        globalMotifIds: ["m1"],
        movements: [
            makeMovementPlan({ ordinal: 1, functionInCycle: "opening_argument", newMotifs: ["m1"] }),
            makeMovementPlan({ id: "mov2", ordinal: 2, functionInCycle: "lyrical_center", inheritedMotifs: ["m1"], newMotifs: [] }),
            makeMovementPlan({ id: "mov3", ordinal: 3, functionInCycle: "contrast", inheritedMotifs: ["m1"], newMotifs: [] }),
            makeMovementPlan({ id: "mov4", ordinal: 4, functionInCycle: "resolution", inheritedMotifs: ["m1"], newMotifs: [] }),
        ],
        crossMovementRecall: [
            { movementId: "mov_phantom", sourceMovementId: "mov1", motifIds: ["m1"], kind: "verbatim" },
        ],
        globalTensionCurve: [],
    };

    const errors = validateSonataCyclePlan(cycle);
    assert.ok(errors.some((e) => e.includes("mov_phantom")));
});

test("validateSonataCyclePlan flags totalDurationSec diverging >30s from movement sum", () => {
    const cycle = {
        title: "Duration mismatch",
        totalDurationSec: 9999,
        globalKey: "C major",
        globalMotifIds: ["m1"],
        movements: [makeMovementPlan({ ordinal: 1, functionInCycle: "opening_argument", targetDurationSec: 360 })],
        crossMovementRecall: [],
        globalTensionCurve: [],
    };

    const errors = validateSonataCyclePlan(cycle);
    assert.ok(errors.some((e) => e.includes("9999s")));
});

// ─── extractMovementPlanFromCompositionPlan ───────────────────────────────────

test("extractMovementPlanFromCompositionPlan maps all fields", () => {
    const plan = makeMinimalPlan({
        key: "G major",
        tempo: 96,
        targetDurationSec: 240,
        sketch: {
            generatedBy: "planner",
            motifDrafts: [{ id: "g1", intervals: [5] }, { id: "g2", intervals: [-3, 2] }],
            cadenceOptions: [],
        },
    });

    const movement = extractMovementPlanFromCompositionPlan(plan, {
        ordinal: 2,
        form: "slow_ternary",
        functionInCycle: "lyrical_center",
        id: "movement_ii",
        inheritedMotifs: ["ext_m1"],
    });

    assert.equal(movement.id, "movement_ii");
    assert.equal(movement.ordinal, 2);
    assert.equal(movement.form, "slow_ternary");
    assert.equal(movement.key, "G major");
    assert.equal(movement.tempo, 96);
    assert.equal(movement.targetDurationSec, 240);
    assert.equal(movement.functionInCycle, "lyrical_center");
    assert.deepEqual(movement.inheritedMotifs, ["ext_m1"]);
    assert.deepEqual(movement.newMotifs, ["g1", "g2"]);
});

test("extractMovementPlanFromCompositionPlan falls back to defaults when plan fields absent", () => {
    const plan = makeMinimalPlan({ key: undefined, tempo: undefined, targetDurationSec: undefined });

    const movement = extractMovementPlanFromCompositionPlan(plan, {
        ordinal: 1,
        form: "sonata_allegro",
        functionInCycle: "opening_argument",
    });

    assert.equal(movement.id, "movement_1");
    assert.equal(movement.key, "C major");
    assert.equal(movement.tempo, 120);
    assert.equal(movement.targetDurationSec, 0);
    assert.deepEqual(movement.newMotifs, []);
});

// ─── buildSonataCyclePlan ─────────────────────────────────────────────────────

test("buildSonataCyclePlan derives globalMotifIds from motifs shared across movements", () => {
    const cycle = buildSonataCyclePlan(
        "Shared motif cycle",
        "C major",
        [
            {
                plan: makeMinimalPlan({
                    targetDurationSec: 300,
                    sketch: { generatedBy: "planner", motifDrafts: [{ id: "shared_m1", intervals: [2] }], cadenceOptions: [] },
                }),
                ordinal: 1, form: "sonata_allegro", functionInCycle: "opening_argument",
            },
            { plan: makeMinimalPlan({ targetDurationSec: 240 }), ordinal: 2, form: "slow_ternary", functionInCycle: "lyrical_center", inheritedMotifs: ["shared_m1"] },
            { plan: makeMinimalPlan({ targetDurationSec: 180 }), ordinal: 3, form: "scherzo_trio", functionInCycle: "contrast", inheritedMotifs: ["shared_m1"] },
            { plan: makeMinimalPlan({ targetDurationSec: 360 }), ordinal: 4, form: "rondo_finale", functionInCycle: "resolution", inheritedMotifs: ["shared_m1"] },
        ],
    );

    assert.ok(cycle.globalMotifIds.includes("shared_m1"));
    assert.equal(cycle.totalDurationSec, 1080);
    assert.equal(cycle.movements.length, 4);
    assert.equal(cycle.globalTensionCurve.length, 32);
});

test("buildSonataCyclePlan falls back to first movement motifs when none are shared", () => {
    const cycle = buildSonataCyclePlan(
        "Solo motif cycle",
        "D major",
        [
            {
                plan: makeMinimalPlan({
                    targetDurationSec: 300,
                    sketch: { generatedBy: "planner", motifDrafts: [{ id: "only_m1", intervals: [3] }], cadenceOptions: [] },
                }),
                ordinal: 1, form: "sonata_allegro", functionInCycle: "opening_argument",
            },
        ],
    );

    assert.deepEqual(cycle.globalMotifIds, ["only_m1"]);
});

test("buildSonataCyclePlan attaches provided crossMovementRecall array", () => {
    const recall = [
        { movementId: "mov4", sourceMovementId: "mov1", motifIds: ["m1"], kind: "transformed" },
    ];

    const cycle = buildSonataCyclePlan(
        "Recall cycle",
        "A major",
        [
            {
                plan: makeMinimalPlan({
                    targetDurationSec: 360,
                    sketch: { generatedBy: "planner", motifDrafts: [{ id: "m1", intervals: [4] }, { id: "m2", intervals: [-2] }], cadenceOptions: [] },
                }),
                ordinal: 1, form: "sonata_allegro", functionInCycle: "opening_argument", id: "mov1",
            },
            { plan: makeMinimalPlan({ targetDurationSec: 300 }), ordinal: 2, form: "slow_ternary", functionInCycle: "lyrical_center", inheritedMotifs: ["m1"], id: "mov2" },
            { plan: makeMinimalPlan({ targetDurationSec: 180 }), ordinal: 3, form: "scherzo_trio", functionInCycle: "contrast", inheritedMotifs: ["m1"], id: "mov3" },
            { plan: makeMinimalPlan({ targetDurationSec: 420 }), ordinal: 4, form: "rondo_finale", functionInCycle: "resolution", inheritedMotifs: ["m1", "m2"], id: "mov4" },
        ],
        recall,
    );

    assert.equal(cycle.crossMovementRecall.length, 1);
    assert.equal(cycle.crossMovementRecall[0].motifIds[0], "m1");
    assert.deepEqual(validateSonataCyclePlan(cycle), []);
});
