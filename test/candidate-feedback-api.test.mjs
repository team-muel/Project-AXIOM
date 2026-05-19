/**
 * candidate-feedback-api.test.mjs
 *
 * Tests for saveListenerFeedbackToCandidate() (candidates.ts).
 * Uses runNodeEval subprocess pattern so OUTPUT_DIR is isolated per test.
 *
 * CFA-01: feedback saved to a non-selected candidate
 * CFA-02: preferredOver stored correctly in manifest
 * CFA-03: rejectionReason stored correctly in manifest
 * CFA-04: unknown candidateId returns null without throwing
 * CFA-05: appeal stored in listenerScores flat record
 * CFA-06: internalScores derived from craftScoreSummary when not supplied explicitly
 * CFA-07: listenerScores flat record populated from all numeric dimensions
 * CFA-08: selected candidate still writable (backward compat)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeEval, parseLastJsonLine } from "./helpers/subprocess.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ─── Subprocess helper ────────────────────────────────────────────────────────

async function runFeedbackOp(tmpDir, code) {
    const { stdout } = await runNodeEval(code, {
        cwd: repoRoot,
        env: { OUTPUT_DIR: tmpDir },
    });
    return parseLastJsonLine(stdout);
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "cfa-test-"));
}

function makeCraftScoreSummary(overrides) {
    return Object.assign({
        syntaxValidity: 0.9,
        sectionContractFit: 0.8,
        cadenceStrength: 0.75,
        tonalReturn: 0.7,
        motifSurvival: 0.65,
        voiceIndependence: 0.8,
        phraseShape: 0.7,
        registerIdiomaticFit: 0.85,
        finalCraftScore: 3.5,
        harmonyContractViolations: 0,
        harmonyContractScore: 1.0,
        dimensionNotes: [],
    }, overrides);
}

function makeMinimalManifest(songId, candidateId, selected) {
    return {
        version: 1,
        stage: "structure",
        songId,
        candidateId,
        attempt: 1,
        selected: Boolean(selected),
        evaluatedAt: new Date().toISOString(),
        workflow: "classical_symbolic",
        worker: "learned_symbolic",
        provider: "test",
        model: "test-model",
        meta: {},
        executionPlan: {
            workflow: "classical_symbolic",
            composeWorker: "learned_symbolic",
            selectedModels: [],
        },
        revisionDirectives: [],
        structureEvaluation: {
            passed: true,
            score: 3.5,
            craftScoreSummary: makeCraftScoreSummary(),
        },
        artifacts: {},
    };
}

function writeCandidateFixture(tmpDir, songId, candidateId, selected) {
    const manifestPath = path.join(tmpDir, songId, "candidates", candidateId, "candidate-manifest.json");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(makeMinimalManifest(songId, candidateId, selected), null, 2));

    const indexPath = path.join(tmpDir, songId, "candidates", "index.json");
    const existingIndex = fs.existsSync(indexPath)
        ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
        : { version: 1, songId, updatedAt: new Date().toISOString(), entries: [] };

    existingIndex.entries = [
        ...existingIndex.entries.filter((e) => e.candidateId !== candidateId),
        {
            candidateId,
            attempt: 1,
            stage: "structure",
            selected: Boolean(selected),
            workflow: "classical_symbolic",
            worker: "learned_symbolic",
            provider: "test",
            model: "test-model",
            passed: true,
            score: 3.5,
            evaluatedAt: new Date().toISOString(),
            manifestPath,
        },
    ];
    if (selected) existingIndex.selectedCandidateId = candidateId;
    fs.writeFileSync(indexPath, JSON.stringify(existingIndex, null, 2));
    return manifestPath;
}

// ─── CFA-01: feedback saved to non-selected candidate ─────────────────────────

test("CFA-01: saveListenerFeedbackToCandidate saves to a non-selected candidate", async () => {
    const tmpDir = makeTmpDir();
    const songId = "song-001";
    const selectedId = "structure-a1-test-model-aaa000000001";
    const rejectedId = "structure-a2-test-model-bbb000000002";

    writeCandidateFixture(tmpDir, songId, selectedId, true);
    writeCandidateFixture(tmpDir, songId, rejectedId, false);

    const result = await runFeedbackOp(tmpDir, `
        const { saveListenerFeedbackToCandidate } = await import("./dist/runtime/manifest/candidates.js");
        const r = saveListenerFeedbackToCandidate(${JSON.stringify(songId)}, ${JSON.stringify(rejectedId)}, { appeal: 2 });
        console.log(JSON.stringify({ ok: r !== null, selected: r?.selected, appeal: r?.listenerFeedback?.appeal }));
    `);

    assert.strictEqual(result.ok, true, "should return non-null manifest");
    assert.strictEqual(result.selected, false, "candidate remains non-selected");
    assert.strictEqual(result.appeal, 2, "appeal stored correctly");
});

// ─── CFA-02: preferredOver stored ────────────────────────────────────────────

test("CFA-02: preferredOver is stored in listenerFeedback", async () => {
    const tmpDir = makeTmpDir();
    const songId = "song-002";
    const candidateA = "structure-a1-test-model-aaa000000001";
    const candidateB = "structure-a2-test-model-bbb000000002";

    writeCandidateFixture(tmpDir, songId, candidateA, true);
    writeCandidateFixture(tmpDir, songId, candidateB, false);

    const result = await runFeedbackOp(tmpDir, `
        const { saveListenerFeedbackToCandidate } = await import("./dist/runtime/manifest/candidates.js");
        const r = saveListenerFeedbackToCandidate(
            ${JSON.stringify(songId)}, ${JSON.stringify(candidateB)},
            { appeal: 3, preferredOver: ${JSON.stringify(candidateA)} }
        );
        console.log(JSON.stringify({ ok: r !== null, preferredOver: r?.listenerFeedback?.preferredOver }));
    `);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.preferredOver, candidateA);
});

// ─── CFA-03: rejectionReason stored ──────────────────────────────────────────

test("CFA-03: rejectionReason is stored in listenerFeedback", async () => {
    const tmpDir = makeTmpDir();
    const songId = "song-003";
    const candidateId = "structure-a1-test-model-ccc000000003";

    writeCandidateFixture(tmpDir, songId, candidateId, false);

    const result = await runFeedbackOp(tmpDir, `
        const { saveListenerFeedbackToCandidate } = await import("./dist/runtime/manifest/candidates.js");
        const r = saveListenerFeedbackToCandidate(
            ${JSON.stringify(songId)}, ${JSON.stringify(candidateId)},
            { appeal: 2, rejectionReason: "melody is too repetitive" }
        );
        console.log(JSON.stringify({ ok: r !== null, rejectionReason: r?.listenerFeedback?.rejectionReason }));
    `);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.rejectionReason, "melody is too repetitive");
});

// ─── CFA-04: unknown candidateId returns null ─────────────────────────────────

test("CFA-04: unknown candidateId returns null without throwing", async () => {
    const tmpDir = makeTmpDir();
    const songId = "song-004";

    const result = await runFeedbackOp(tmpDir, `
        const { saveListenerFeedbackToCandidate } = await import("./dist/runtime/manifest/candidates.js");
        const r = saveListenerFeedbackToCandidate(${JSON.stringify(songId)}, "nonexistent-id", { appeal: 3 });
        console.log(JSON.stringify({ isNull: r === null }));
    `);

    assert.strictEqual(result.isNull, true);
});

// ─── CFA-05: appeal stored in listenerScores flat record ─────────────────────

test("CFA-05: appeal is stored in listenerScores flat record", async () => {
    const tmpDir = makeTmpDir();
    const songId = "song-005";
    const candidateId = "structure-a1-test-model-eee000000005";

    writeCandidateFixture(tmpDir, songId, candidateId, false);

    const result = await runFeedbackOp(tmpDir, `
        const { saveListenerFeedbackToCandidate } = await import("./dist/runtime/manifest/candidates.js");
        const r = saveListenerFeedbackToCandidate(
            ${JSON.stringify(songId)}, ${JSON.stringify(candidateId)},
            { appeal: 5 }
        );
        console.log(JSON.stringify({ ok: r !== null, appeal: r?.listenerFeedback?.appeal, appealScore: r?.listenerScores?.appeal }));
    `);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.appeal, 5);
    assert.strictEqual(result.appealScore, 5);
});

// ─── CFA-06: internalScores derived from craftScoreSummary ───────────────────

test("CFA-06: internalScores derived from craftScoreSummary when not supplied explicitly", async () => {
    const tmpDir = makeTmpDir();
    const songId = "song-006";
    const candidateId = "structure-a1-test-model-fff000000006";

    writeCandidateFixture(tmpDir, songId, candidateId, false);

    const result = await runFeedbackOp(tmpDir, `
        const { saveListenerFeedbackToCandidate } = await import("./dist/runtime/manifest/candidates.js");
        const r = saveListenerFeedbackToCandidate(
            ${JSON.stringify(songId)}, ${JSON.stringify(candidateId)},
            { appeal: 4 }
        );
        console.log(JSON.stringify({
            ok: r !== null,
            finalCraftScore: r?.internalScores?.finalCraftScore,
            cadenceStrength: r?.internalScores?.cadenceStrength,
            tonalReturn: r?.internalScores?.tonalReturn,
        }));
    `);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.finalCraftScore, 3.5);
    assert.strictEqual(result.cadenceStrength, 0.75);
    assert.strictEqual(result.tonalReturn, 0.7);
});

// ─── CFA-07: listenerScores flat record ──────────────────────────────────────

test("CFA-07: listenerScores flat record populated from all supplied numeric dimensions", async () => {
    const tmpDir = makeTmpDir();
    const songId = "song-007";
    const candidateId = "structure-a1-test-model-ggg000000007";

    writeCandidateFixture(tmpDir, songId, candidateId, false);

    const result = await runFeedbackOp(tmpDir, `
        const { saveListenerFeedbackToCandidate } = await import("./dist/runtime/manifest/candidates.js");
        const r = saveListenerFeedbackToCandidate(
            ${JSON.stringify(songId)}, ${JSON.stringify(candidateId)},
            { appeal: 4, coherence: 3, memorability: 5, emotionalImpact: 4 }
        );
        console.log(JSON.stringify({ ok: r !== null, ls: r?.listenerScores }));
    `);

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.ls, { appeal: 4, coherence: 3, memorability: 5, emotionalImpact: 4 });
});

// ─── CFA-08: selected candidate still writable ───────────────────────────────

test("CFA-08: saveListenerFeedbackToCandidate works on selected candidate (backward compat)", async () => {
    const tmpDir = makeTmpDir();
    const songId = "song-008";
    const selectedId = "structure-a1-test-model-hhh000000008";

    writeCandidateFixture(tmpDir, songId, selectedId, true);

    const result = await runFeedbackOp(tmpDir, `
        const { saveListenerFeedbackToCandidate } = await import("./dist/runtime/manifest/candidates.js");
        const r = saveListenerFeedbackToCandidate(
            ${JSON.stringify(songId)}, ${JSON.stringify(selectedId)},
            { appeal: 5, coherence: 4 }
        );
        console.log(JSON.stringify({ ok: r !== null, selected: r?.selected, appeal: r?.listenerFeedback?.appeal, coherence: r?.listenerFeedback?.coherence }));
    `);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selected, true);
    assert.strictEqual(result.appeal, 5);
    assert.strictEqual(result.coherence, 4);
});
