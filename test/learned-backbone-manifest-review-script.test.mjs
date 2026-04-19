import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const benchmarkPackVersion = "string_trio_symbolic_benchmark_pack_v1";
const promptPackVersion = "learned_symbolic_prompt_pack_v1";

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function parseCsv(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inQuotes) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    currentCell += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                currentCell += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            continue;
        }
        if (char === ",") {
            currentRow.push(currentCell);
            currentCell = "";
            continue;
        }
        if (char === "\n") {
            currentRow.push(currentCell);
            rows.push(currentRow);
            currentRow = [];
            currentCell = "";
            continue;
        }
        if (char === "\r") {
            continue;
        }
        currentCell += char;
    }

    if (currentCell !== "" || currentRow.length > 0) {
        currentRow.push(currentCell);
        rows.push(currentRow);
    }

    const header = rows.shift();
    return rows
        .filter((row) => row.some((cell) => String(cell ?? "").trim()))
        .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""])));
}

function writeCsv(filePath, header, rows) {
    const lines = [header.map(csvEscape).join(",")];
    for (const row of rows) {
        lines.push(header.map((column) => csvEscape(row[column] ?? "")).join(","));
    }
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function buildCandidateEntry({
    outputDir,
    songId,
    candidateId,
    selected,
    worker,
    provider,
    model,
    attempt,
    evaluatedAt,
    proposalEvidence,
}) {
    const manifestPath = path.join(outputDir, songId, "candidates", candidateId, "candidate-manifest.json");
    const midiPath = path.join(outputDir, songId, "candidates", candidateId, "composition.mid");
    fs.mkdirSync(path.dirname(midiPath), { recursive: true });
    fs.writeFileSync(midiPath, Buffer.from("MThd", "utf8"));
    writeJson(manifestPath, {
        version: 1,
        stage: "structure",
        songId,
        candidateId,
        attempt,
        selected,
        evaluatedAt,
        workflow: "symbolic_only",
        worker,
        provider,
        model,
        revisionDirectives: [],
        ...(proposalEvidence ? { proposalEvidence } : {}),
        artifacts: {
            midi: midiPath,
        },
    });

    return {
        candidateId,
        attempt,
        stage: "structure",
        selected,
        workflow: "symbolic_only",
        worker,
        provider,
        model,
        passed: true,
        evaluatedAt,
        manifestPath,
        midiPath,
        ...(proposalEvidence ? { proposalEvidence } : {}),
    };
}

function writeManifest({ outputDir, songId, approvalStatus, updatedAt, reviewFeedback, source = "autonomy" }) {
    writeJson(path.join(outputDir, songId, "manifest.json"), {
        songId,
        state: "DONE",
        approvalStatus,
        ...(reviewFeedback ? { reviewFeedback } : {}),
        meta: {
            songId,
            prompt: songId,
            form: "string trio miniature",
            workflow: "symbolic_only",
            source,
            ...(source === "autonomy" ? { autonomyRunId: `run-${songId}` } : {}),
            promptHash: `hash-${songId}`,
            createdAt: updatedAt,
            updatedAt,
        },
        qualityControl: {
            selectedAttempt: 1,
        },
        updatedAt,
    });
}

function seedBenchmarkSong({ outputDir, songId, approvalStatus, updatedAt, benchmarkId, selectedWorker, reviewFeedback, source = "autonomy" }) {
    writeManifest({ outputDir, songId, approvalStatus, updatedAt, reviewFeedback, source });
    const learnedProposalEvidence = {
        worker: "learned_symbolic",
        lane: "string_trio_symbolic",
        provider: "learned",
        model: "learned-symbolic-trio-v1",
        benchmarkPackVersion,
        benchmarkId,
        promptPackVersion,
        planSignature: `lane=string_trio_symbolic|sig=${benchmarkId}`,
        generationMode: "plan_conditioned_trio_template",
    };
    writeJson(path.join(outputDir, songId, "candidates", "index.json"), {
        version: 1,
        songId,
        updatedAt,
        selectedCandidateId: selectedWorker === "learned_symbolic" ? "learned-a" : "baseline-a",
        selectedAttempt: 1,
        selectionStopReason: `${selectedWorker} selected for ${benchmarkId}`,
        entries: [
            buildCandidateEntry({
                outputDir,
                songId,
                candidateId: "baseline-a",
                selected: selectedWorker === "music21",
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: updatedAt,
            }),
            buildCandidateEntry({
                outputDir,
                songId,
                candidateId: "learned-a",
                selected: selectedWorker === "learned_symbolic",
                worker: "learned_symbolic",
                provider: "learned",
                model: "learned-symbolic-trio-v1",
                attempt: 1,
                evaluatedAt: updatedAt,
                proposalEvidence: learnedProposalEvidence,
            }),
        ],
    });
}

function seedNonBenchmarkSong(outputDir) {
    const songId = "song-non-benchmark";
    writeManifest({
        outputDir,
        songId,
        approvalStatus: "pending",
        updatedAt: "2026-04-19T01:05:00.000Z",
    });
    writeJson(path.join(outputDir, songId, "candidates", "index.json"), {
        version: 1,
        songId,
        updatedAt: "2026-04-19T01:05:00.000Z",
        selectedCandidateId: "baseline-a",
        selectedAttempt: 1,
        selectionStopReason: "non benchmark baseline",
        entries: [
            buildCandidateEntry({
                outputDir,
                songId,
                candidateId: "baseline-a",
                selected: true,
                worker: "music21",
                provider: "python",
                model: "music21-symbolic-v1",
                attempt: 1,
                evaluatedAt: "2026-04-19T01:05:00.000Z",
            }),
        ],
    });
}

function runJsonCommand(args, env) {
    return JSON.parse(execFileSync(process.execPath, args, {
        cwd: repoRoot,
        env: {
            ...process.env,
            ...env,
        },
        encoding: "utf8",
    }).trim());
}

test("learned-backbone manifest review sheet scaffolds pending rows and records approval decisions", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-manifest-review-"));
    const outputDir = path.join(tempRoot, "outputs");
    fs.mkdirSync(outputDir, { recursive: true });

    seedBenchmarkSong({
        outputDir,
        songId: "song-pending-learned",
        approvalStatus: "pending",
        updatedAt: "2026-04-19T01:00:00.000Z",
        benchmarkId: "cadence_clarity_reference",
        selectedWorker: "learned_symbolic",
    });
    seedBenchmarkSong({
        outputDir,
        songId: "song-pending-baseline",
        approvalStatus: "pending",
        updatedAt: "2026-04-19T02:00:00.000Z",
        benchmarkId: "localized_rewrite_probe",
        selectedWorker: "music21",
    });
    seedBenchmarkSong({
        outputDir,
        songId: "song-reviewed",
        approvalStatus: "approved",
        updatedAt: "2026-04-19T03:00:00.000Z",
        benchmarkId: "cadence_clarity_reference",
        selectedWorker: "music21",
        reviewFeedback: {
            reviewRubricVersion: "approval_review_rubric_v1",
            appealScore: 7,
        },
    });
    seedNonBenchmarkSong(outputDir);

    const scaffoldResult = runJsonCommand([
        path.join(repoRoot, "scripts", "create-learned-backbone-manifest-review-sheet.mjs"),
        `--outputDir=${outputDir}`,
        "--snapshot=sheet-r01",
    ]);

    assert.equal(scaffoldResult.ok, true);
    assert.equal(scaffoldResult.rowCount, 2);
    assert.deepEqual(scaffoldResult.songIds.sort(), ["song-pending-baseline", "song-pending-learned"]);

    const sheetPath = scaffoldResult.paths.sheetPath;
    const originalRows = parseCsv(fs.readFileSync(sheetPath, "utf8"));
    assert.equal(originalRows.length, 2);
    assert.deepEqual(originalRows.map((row) => row.songId).sort(), ["song-pending-baseline", "song-pending-learned"]);
    assert.ok(originalRows.every((row) => row.currentApprovalStatus === "pending"));

    const header = Object.keys(originalRows[0]);
    const updatedRows = originalRows.map((row) => ({ ...row }));
    const learnedRow = updatedRows.find((row) => row.songId === "song-pending-learned");
    const baselineRow = updatedRows.find((row) => row.songId === "song-pending-baseline");
    learnedRow.approvalStatus = "approved";
    learnedRow.appealScore = "8";
    learnedRow.strongestDimension = "cadence clarity";
    learnedRow.weakestDimension = "inner voice";
    learnedRow.comparisonReference = "blind-pack-r01";
    learnedRow.note = "Learned version landed the cadence more convincingly.";
    learnedRow.actor = "tester-a";
    learnedRow.approvedBy = "lead-a";
    baselineRow.approvalStatus = "rejected";
    baselineRow.appealScore = "4";
    baselineRow.strongestDimension = "opening color";
    baselineRow.weakestDimension = "rewrite stability";
    baselineRow.comparisonReference = "blind-pack-r02";
    baselineRow.note = "Baseline stayed safer but did not solve the weak section.";
    baselineRow.actor = "tester-b";
    baselineRow.approvedBy = "lead-b";
    writeCsv(sheetPath, header, updatedRows);

    const recordResult = runJsonCommand([
        "--import",
        "tsx",
        path.join(repoRoot, "scripts", "record-learned-backbone-manifest-review.mjs"),
        `--outputDir=${outputDir}`,
        `--resultsFile=${sheetPath}`,
    ]);

    assert.equal(recordResult.ok, true);
    assert.equal(recordResult.processedCount, 2);
    assert.equal(recordResult.approvedCount, 1);
    assert.equal(recordResult.rejectedCount, 1);

    const approvedManifest = readJson(path.join(outputDir, "song-pending-learned", "manifest.json"));
    const rejectedManifest = readJson(path.join(outputDir, "song-pending-baseline", "manifest.json"));
    assert.equal(approvedManifest.approvalStatus, "approved");
    assert.equal(approvedManifest.reviewFeedback.reviewRubricVersion, "approval_review_rubric_v1");
    assert.equal(approvedManifest.reviewFeedback.appealScore, 8);
    assert.equal(approvedManifest.reviewFeedback.strongestDimension, "cadence clarity");
    assert.equal(rejectedManifest.approvalStatus, "rejected");
    assert.equal(rejectedManifest.reviewFeedback.reviewRubricVersion, "approval_review_rubric_v1");
    assert.equal(rejectedManifest.reviewFeedback.weakestDimension, "rewrite stability");

    const preferences = readJson(path.join(outputDir, "_system", "preferences.json"));
    assert.equal(preferences.humanFeedbackSummary.approvedCount, 1);
    assert.equal(preferences.humanFeedbackSummary.rejectedCount, 1);

    const auditLatest = readJson(path.join(outputDir, "_system", "operator-actions", "latest.json"));
    assert.equal(auditLatest.action, "reject");
    const historyDir = path.join(outputDir, "_system", "operator-actions", "history");
    const historyFile = fs.readdirSync(historyDir)[0];
    const historyRows = fs.readFileSync(path.join(historyDir, historyFile), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.equal(historyRows.length, 2);
    assert.deepEqual(historyRows.map((row) => row.action), ["approve", "reject"]);
});

test("learned-backbone manifest review sheet can approve benchmark api manifests without autonomy audit side effects", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-manifest-review-api-"));
    const outputDir = path.join(tempRoot, "outputs");
    fs.mkdirSync(outputDir, { recursive: true });

    seedBenchmarkSong({
        outputDir,
        songId: "api-song-a",
        approvalStatus: "pending",
        updatedAt: "2026-04-19T04:00:00.000Z",
        benchmarkId: "cadence_clarity_reference",
        selectedWorker: "learned_symbolic",
        source: "api",
    });
    seedBenchmarkSong({
        outputDir,
        songId: "api-song-b",
        approvalStatus: "pending",
        updatedAt: "2026-04-19T04:05:00.000Z",
        benchmarkId: "localized_rewrite_probe",
        selectedWorker: "music21",
        source: "api",
    });

    const scaffoldResult = runJsonCommand([
        path.join(repoRoot, "scripts", "create-learned-backbone-manifest-review-sheet.mjs"),
        `--outputDir=${outputDir}`,
        "--snapshot=sheet-api-r01",
    ]);

    assert.equal(scaffoldResult.ok, true);
    assert.equal(scaffoldResult.rowCount, 2);

    const sheetPath = scaffoldResult.paths.sheetPath;
    const originalRows = parseCsv(fs.readFileSync(sheetPath, "utf8"));
    const header = Object.keys(originalRows[0]);
    const updatedRows = originalRows.map((row) => ({
        ...row,
        approvalStatus: "approved",
    }));
    writeCsv(sheetPath, header, updatedRows);

    const recordResult = runJsonCommand([
        "--import",
        "tsx",
        path.join(repoRoot, "scripts", "record-learned-backbone-manifest-review.mjs"),
        `--outputDir=${outputDir}`,
        `--resultsFile=${sheetPath}`,
        "--actor=tester-api",
        "--approvedBy=lead-api",
    ]);

    assert.equal(recordResult.ok, true);
    assert.equal(recordResult.processedCount, 2);
    assert.ok(recordResult.results.every((item) => item.updatePath === "direct_manifest_save"));

    const manifestA = readJson(path.join(outputDir, "api-song-a", "manifest.json"));
    const manifestB = readJson(path.join(outputDir, "api-song-b", "manifest.json"));
    assert.equal(manifestA.approvalStatus, "approved");
    assert.equal(manifestB.approvalStatus, "approved");
    assert.equal(manifestA.reviewFeedback.reviewRubricVersion, "approval_review_rubric_v1");
    assert.equal(manifestB.reviewFeedback.reviewRubricVersion, "approval_review_rubric_v1");
    assert.equal(fs.existsSync(path.join(outputDir, "_system", "operator-actions", "latest.json")), false);
    assert.equal(fs.existsSync(path.join(outputDir, "_system", "preferences.json")), false);
});