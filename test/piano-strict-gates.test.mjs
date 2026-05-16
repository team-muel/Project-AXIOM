/**
 * Piano strict gate tests — 10-category coverage
 *
 * Category A (7 tests) — solo_piano_symbolic lane routing
 * Category B (5 tests) — quality isolation: mock / gate-failed candidates
 * Category C (5 tests) — gate sequence and threshold constants
 * Category D (5 tests) — ideal artifact score thresholds (benchmark success criteria)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
    buildLearnedSymbolicPromptPack,
    buildLearnedSymbolicWorkerPayload,
} from "../dist/composer/learnedAdapter.js";
import {
    SOLO_PIANO_SYMBOLIC_LANE,
    STRING_TRIO_SYMBOLIC_LANE,
} from "../dist/pipeline/learnedSymbolicContract.js";
import {
    pianoPlayabilityGate,
    applyPianoPlayabilityGate,
    computePianoCraftScoreSummary,
    computeMelodicClarity,
    computeBassCoherence,
    computeHandPlayability,
} from "../dist/pipeline/pianoCraftScoring.js";
import {
    exportPianoSftDataset,
    exportPianoPreferenceDataset,
    PLAYABILITY_LABEL_THRESHOLD,
    PREFERENCE_SCORE_MARGIN,
} from "../dist/memory/pianoDataset.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function noteEvt(pitch, ql = 1) {
    return { type: "note", pitch, quarterLength: ql };
}

function makeMinimalPianoPlan(overrides = {}) {
    return {
        instrument: "Piano",
        difficultyTarget: "intermediate",
        sections: [
            {
                sectionId: "s1",
                textureKind: "melody_accompaniment",
                rightHand: {
                    hand: "right",
                    primaryRoles: ["lead"],
                    registerMin: 60,
                    registerMax: 84,
                    maxComfortableSpan: 12,
                },
                leftHand: {
                    hand: "left",
                    primaryRoles: ["bass"],
                    registerMin: 36,
                    registerMax: 60,
                    maxComfortableSpan: 12,
                },
                pedal: { enabled: true, strategy: "harmonic", changeOnHarmony: true },
                difficultyTarget: "intermediate",
            },
        ],
        ...overrides,
    };
}

function makePianoRequest(pianoPlan = makeMinimalPianoPlan(), form = "nocturne") {
    return {
        prompt: "Test piano composition",
        form,
        key: "F minor",
        tempo: 72,
        targetInstrumentation: [
            { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] },
        ],
        compositionPlan: {
            brief: "Test piano piece",
            key: "F minor",
            form,
            tempo: 72,
            mood: ["lyrical"],
            instrumentation: [
                { name: "Piano", family: "keyboard", roles: ["lead", "chordal_support", "bass"] },
            ],
            orchestration: { family: "piano_solo", instrumentNames: ["Piano"], sections: [] },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme A", measures: 8, energy: 0.4, density: 0.35 },
            ],
            pianoPlan,
        },
    };
}

function makeStringTrioRequest() {
    return {
        prompt: "A gentle miniature for string trio",
        form: "miniature",
        key: "C major",
        tempo: 92,
        targetInstrumentation: [
            { name: "Violin", family: "strings", roles: ["lead"] },
            { name: "Viola", family: "strings", roles: ["inner_voice"] },
            { name: "Cello", family: "strings", roles: ["bass"] },
        ],
        compositionPlan: {
            brief: "Miniature for string trio",
            key: "C major",
            form: "miniature",
            tempo: 92,
            mood: [],
            instrumentation: [
                { name: "Violin", family: "strings", roles: ["lead"] },
                { name: "Viola", family: "strings", roles: ["inner_voice"] },
                { name: "Cello", family: "strings", roles: ["bass"] },
            ],
            orchestration: {
                family: "string_trio",
                instrumentNames: ["Violin", "Viola", "Cello"],
                sections: [],
            },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme A", measures: 4, energy: 0.4, density: 0.35 },
            ],
        },
    };
}

function makePianoRequestNoPlan(form = "sonata_allegro") {
    // Piano instrumentation but no pianoPlan → resolveLane must throw
    return {
        prompt: "Piano solo without PianoPlan",
        form,
        key: "C major",
        tempo: 120,
        targetInstrumentation: [{ name: "Piano", family: "keyboard", roles: ["lead"] }],
        compositionPlan: {
            brief: "Piano sonata",
            key: "C major",
            form,
            tempo: 120,
            mood: [],
            instrumentation: [{ name: "Piano", family: "keyboard", roles: ["lead"] }],
            orchestration: { family: "piano_solo", instrumentNames: ["Piano"], sections: [] },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme A", measures: 8, energy: 0.6, density: 0.5 },
            ],
            // No pianoPlan
        },
    };
}

function makeUnsupportedInstrumentRequest() {
    return {
        prompt: "Clarinet solo",
        form: "sonatina",
        key: "D major",
        tempo: 100,
        targetInstrumentation: [{ name: "Clarinet", family: "woodwind", roles: ["lead"] }],
        compositionPlan: {
            brief: "Clarinet sonatina",
            key: "D major",
            form: "sonatina",
            tempo: 100,
            mood: [],
            instrumentation: [{ name: "Clarinet", family: "woodwind", roles: ["lead"] }],
            orchestration: { family: "woodwind_solo", instrumentNames: ["Clarinet"], sections: [] },
            sections: [
                { id: "s1", role: "theme_a", label: "Theme A", measures: 8, energy: 0.5, density: 0.4 },
            ],
        },
    };
}

function makeMinimalExecutionPlan() {
    return {
        selectedModels: [
            { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
        ],
    };
}

function mkArtifact({ rh = [], lh = [], measures = 4, layout = undefined, playabilityScore = undefined } = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: measures,
        melodyEvents: rh,
        accompanimentEvents: lh,
        noteHistory: [],
        ...(layout !== undefined ? { pianoVoiceLayout: layout } : {}),
        ...(playabilityScore !== undefined ? { pianoPlayabilityScore: playabilityScore } : {}),
    };
}

function mkEvalReport(passed = true) {
    return { passed, issues: [], score: 0.8 };
}

function mkEntry(overrides = {}) {
    return {
        version: 1,
        entryId: `entry-${Math.random().toString(36).slice(2, 8)}`,
        songId: "song-1",
        candidateId: `cand-${Math.random().toString(36).slice(2, 8)}`,
        capturedAt: "2025-01-01T00:00:00.000Z",
        hasMidi: false,
        input: {
            lane: "solo_piano_symbolic",
            controlLines: ["lane=solo_piano_symbolic"],
        },
        ...overrides,
    };
}

// Ideal layout: comfortable spans, no collisions, pedal events
const IDEAL_LAYOUT = {
    maxRightHandSpan: 10,
    maxLeftHandSpan: 10,
    playableSpanFit: 0.95,
    handCollisionCount: 0,
    handCrossingCount: 0,
    pedalEventCount: 4,
};

// Ideal RH: smooth stepwise melody in comfortable register
const IDEAL_RH = [
    noteEvt(64), noteEvt(65), noteEvt(67), noteEvt(69),
    noteEvt(67), noteEvt(65), noteEvt(64), noteEvt(62),
];

// Ideal LH: stepwise bass motion in bass register
const IDEAL_LH = [
    noteEvt(40), noteEvt(40), noteEvt(43), noteEvt(43),
    noteEvt(40), noteEvt(40), noteEvt(38), noteEvt(38),
];

function mkIdealArtifact(overrides = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: 8,
        melodyEvents: IDEAL_RH,
        accompanimentEvents: IDEAL_LH,
        noteHistory: [],
        bassMotionProfile: "stepwise",   // required for computeBassCoherence >= 0.70
        pianoVoiceLayout: IDEAL_LAYOUT,
        pianoPlayabilityScore: 0.95,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Category A: solo_piano_symbolic lane routing
// ═══════════════════════════════════════════════════════════════════════════════

test("A1: SOLO_PIANO_SYMBOLIC_LANE constant equals 'solo_piano_symbolic'", () => {
    assert.equal(SOLO_PIANO_SYMBOLIC_LANE, "solo_piano_symbolic");
});

test("A2: piano + pianoPlan → buildLearnedSymbolicPromptPack resolves solo_piano_symbolic", () => {
    const pack = buildLearnedSymbolicPromptPack(makePianoRequest());
    assert.equal(pack.lane, "solo_piano_symbolic");
});

test("A3: piano + pianoPlan → promptPack carries the pianoPlan", () => {
    const pianoPlan = makeMinimalPianoPlan();
    const pack = buildLearnedSymbolicPromptPack(makePianoRequest(pianoPlan));
    assert.ok(pack.pianoPlan !== undefined, "promptPack must carry the pianoPlan");
    assert.equal(pack.pianoPlan.instrument, "Piano");
});

test("A4: piano without pianoPlan → throws (generic_symbolic not supported)", () => {
    assert.throws(
        () => buildLearnedSymbolicPromptPack(makePianoRequestNoPlan()),
        /learned symbolic worker only supports/i,
    );
});

test("A5: string trio + miniature → lane resolves to string_trio_symbolic (unchanged)", () => {
    const pack = buildLearnedSymbolicPromptPack(makeStringTrioRequest());
    assert.equal(pack.lane, "string_trio_symbolic");
    assert.equal(pack.lane, STRING_TRIO_SYMBOLIC_LANE);
});

test("A6: unsupported instrument (clarinet) → throws", () => {
    assert.throws(
        () => buildLearnedSymbolicPromptPack(makeUnsupportedInstrumentRequest()),
        /learned symbolic worker only supports/i,
    );
});

test("A7: buildLearnedSymbolicWorkerPayload with piano → payload.promptPack.lane = solo_piano_symbolic", () => {
    const payload = buildLearnedSymbolicWorkerPayload(
        makePianoRequest(),
        "song-piano-test",
        "/tmp/piano-test.mid",
        makeMinimalExecutionPlan(),
    );
    assert.equal(payload.promptPack.lane, "solo_piano_symbolic");
    assert.ok(typeof payload.stableSeed === "number", "stableSeed must be a number");
    assert.ok(
        typeof payload.providerRequest.conditioningText === "string",
        "providerRequest.conditioningText must be present",
    );
    // planSignature must include the lane token
    assert.ok(
        payload.promptPack.planSignature.includes("solo_piano_symbolic"),
        `planSignature must include solo_piano_symbolic; got: ${payload.promptPack.planSignature}`,
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Category B: quality isolation — gate-failed / mock candidates not in datasets
// ═══════════════════════════════════════════════════════════════════════════════

test("B1: SFT dataset only includes approvalStatus=approved entries", () => {
    const entries = [
        mkEntry({ candidateId: "c-approved", approvalStatus: "approved", abcText: "X:1\nK:C\nCEG|" }),
        mkEntry({ candidateId: "c-rejected", approvalStatus: "rejected", abcText: "X:1\nK:C\nGEC|" }),
        mkEntry({ candidateId: "c-pending",  approvalStatus: "pending",  abcText: "X:1\nK:C\nEGC|" }),
    ];
    const examples = exportPianoSftDataset(undefined, entries);
    assert.equal(examples.length, 1);
    assert.equal(examples[0].candidateId, "c-approved");
});

test("B2: SFT dataset excludes approved entries with missing or empty abcText", () => {
    const entries = [
        mkEntry({ candidateId: "c-abc",    approvalStatus: "approved", abcText: "X:1\nK:C\nCEG|" }),
        mkEntry({ candidateId: "c-empty",  approvalStatus: "approved", abcText: "" }),
        mkEntry({ candidateId: "c-undef",  approvalStatus: "approved" /* abcText omitted */ }),
    ];
    const examples = exportPianoSftDataset(undefined, entries);
    assert.equal(examples.length, 1);
    assert.equal(examples[0].candidateId, "c-abc");
});

test("B3: gate-failed candidate (rejected status) is absent from SFT even with abcText", () => {
    // Simulate: playability gate returns passed=false → candidate assigned rejected status
    const lowPlayability = mkArtifact({ playabilityScore: 0.10 });
    const gateResult = pianoPlayabilityGate([lowPlayability], 0.50);
    assert.equal(gateResult.passed, false, "precondition: gate must fail for score=0.10");

    const entries = [
        mkEntry({
            candidateId: "gate-failed",
            approvalStatus: "rejected", // consequence of gate failure
            abcText: "X:1\nK:C\nCEG|",
            pianoEvidence: { playabilityScore: 0.10 },
        }),
    ];
    const examples = exportPianoSftDataset(undefined, entries);
    assert.equal(examples.length, 0, "gate-rejected candidate must not appear in SFT");
});

test("B4: high craft score alone does not override rejected approval status", () => {
    // Mock-like candidate: high craft score but rejected (e.g. mock_notagen_abc flagged)
    const entries = [
        mkEntry({
            candidateId: "mock-high-craft",
            approvalStatus: "rejected",
            abcText: "X:1\nK:C\nCEG|",
            pianoCraftScore: {
                handPlayability: 0.95,
                handIndependence: 0.88,
                registerSpacing: 0.90,
                voicingIdiomaticFit: 0.85,
                accompanimentPatternCoherence: 0.88,
                pedalPlausibility: 0.80,
                melodicClarity: 0.92,
                bassCoherence: 0.88,
                difficultyFit: 0.95,
                finalPianoScore: 0.91,
            },
        }),
    ];
    const examples = exportPianoSftDataset(undefined, entries);
    assert.equal(examples.length, 0, "high craft score must not bypass rejected status");
});

test("B5: preference pair: listener_approved wins over higher craft score", () => {
    // Approved (lower score) vs rejected (higher score) — approved must be 'chosen'
    const SHARED_CONTROL = ["lane=solo_piano_symbolic", "form=nocturne", "key=F minor"];
    const approvedLower = mkEntry({
        candidateId: "approved-lower",
        songId: "song-pref",
        approvalStatus: "approved",
        abcText: "X:1\nK:Fm\nFGA|",
        pianoCraftScore: { finalPianoScore: 0.65 },
        input: { lane: "solo_piano_symbolic", controlLines: SHARED_CONTROL },
    });
    const rejectedHigher = mkEntry({
        candidateId: "rejected-higher",
        songId: "song-pref",
        approvalStatus: "rejected",
        abcText: "X:1\nK:Fm\nAGF|",
        pianoCraftScore: { finalPianoScore: 0.88 },
        input: { lane: "solo_piano_symbolic", controlLines: SHARED_CONTROL },
    });
    const pairs = exportPianoPreferenceDataset(undefined, [approvedLower, rejectedHigher]);
    assert.equal(pairs.length, 1, "should produce exactly one preference pair");
    assert.equal(pairs[0].chosen.candidateId, "approved-lower",
        "listener_approved candidate must be 'chosen' even with lower craft score");
    assert.equal(pairs[0].rejected.candidateId, "rejected-higher");
    assert.equal(pairs[0].choiceReason, "listener_approved");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Category C: gate sequence and threshold constants
// ═══════════════════════════════════════════════════════════════════════════════

test("C1: PLAYABILITY_LABEL_THRESHOLD = 0.60 (unplayable classification boundary)", () => {
    assert.equal(PLAYABILITY_LABEL_THRESHOLD, 0.60);
});

test("C2: PREFERENCE_SCORE_MARGIN = 0.05 (minimum craft score differential for DPO pair)", () => {
    assert.equal(PREFERENCE_SCORE_MARGIN, 0.05);
});

test("C3: pianoPlayabilityGate passes at boundary score (score = threshold)", () => {
    const atBoundary = mkArtifact({ playabilityScore: 0.50 });
    const result = pianoPlayabilityGate([atBoundary]); // default threshold = 0.50
    // score >= threshold → passes
    assert.equal(result.passed, true, "score=0.50 at default threshold=0.50 must pass");
});

test("C4: pianoPlayabilityGate fails one semitone below boundary", () => {
    const justBelow = mkArtifact({ playabilityScore: 0.4999 });
    const result = pianoPlayabilityGate([justBelow]);
    assert.equal(result.passed, false, "score=0.4999 must fail default threshold");
    assert.ok(typeof result.reason === "string" && result.reason.length > 0, "failure must include reason");
});

test("C5: applyPianoPlayabilityGate is a hard blocking filter — does not mutate original report", () => {
    const originalReport = mkEvalReport(true);
    const unplayable = mkArtifact({ playabilityScore: 0.20 });
    const updatedReport = applyPianoPlayabilityGate(originalReport, [unplayable], 0.50);

    // Gate 3 blocks the candidate
    assert.equal(updatedReport.passed, false, "gated report must be marked failed");
    assert.ok(updatedReport.issues.length > 0, "gated report must carry an issue description");
    // Original report must not be mutated (Gate 3 returns a new object)
    assert.equal(originalReport.passed, true, "original report must not be mutated");
    assert.equal(originalReport.issues.length, 0, "original report issues must be unchanged");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Category D: ideal artifact score thresholds (benchmark success criteria)
// ═══════════════════════════════════════════════════════════════════════════════

test("D1: ideal artifacts pass pianoPlayabilityGate at benchmark median target (>= 0.80)", () => {
    const ideal = mkIdealArtifact();
    const gate = pianoPlayabilityGate([ideal], 0.50);
    assert.equal(gate.passed, true, "ideal artifact must pass Gate 3");
    assert.ok(
        gate.pianoPlayabilityScore >= 0.80,
        `expected pianoPlayabilityScore >= 0.80, got ${gate.pianoPlayabilityScore}`,
    );
});

test("D2: ideal stepwise melody meets melodicClarity benchmark (>= 0.75)", () => {
    const result = computeMelodicClarity([mkIdealArtifact()]);
    const score = result.score;
    assert.ok(score >= 0.75, `melodicClarity should be >= 0.75, got ${score.toFixed(3)}`);
});

test("D3: ideal stepwise bass meets bassCoherence benchmark (>= 0.70)", () => {
    const result = computeBassCoherence([mkIdealArtifact()]);
    const score = result.score;
    assert.ok(score >= 0.70, `bassCoherence should be >= 0.70, got ${score.toFixed(3)}`);
});

test("D4: ideal layout yields handPlayability >= 0.80", () => {
    const result = computeHandPlayability(IDEAL_LAYOUT);
    const score = result.score;
    assert.ok(score >= 0.80, `handPlayability should be >= 0.80, got ${score.toFixed(3)}`);
});

test("D5: full ideal artifact yields finalPianoScore >= 0.70 and all 9 dimensions present", () => {
    const evalReport = mkEvalReport(true);
    const craft = computePianoCraftScoreSummary([mkIdealArtifact()], {}, evalReport, IDEAL_LAYOUT);
    assert.ok(
        craft.finalPianoScore >= 0.70,
        `finalPianoScore should be >= 0.70, got ${craft.finalPianoScore.toFixed(3)}`,
    );
    // All 9 dimensions must be present
    const dims = [
        "handPlayability", "handIndependence", "registerSpacing",
        "voicingIdiomaticFit", "accompanimentPatternCoherence",
        "pedalPlausibility", "melodicClarity", "bassCoherence", "difficultyFit",
    ];
    for (const dim of dims) {
        assert.ok(typeof craft[dim] === "number", `dimension '${dim}' must be a number`);
        assert.ok(craft[dim] >= 0 && craft[dim] <= 1, `dimension '${dim}' must be in [0,1]`);
    }
});
