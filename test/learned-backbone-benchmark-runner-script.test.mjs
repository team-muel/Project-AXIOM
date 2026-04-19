import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine } from "./helpers/subprocess.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pythonBin = [
    path.join(repoRoot, ".venv", "Scripts", "python.exe"),
    path.join(repoRoot, ".venv", "bin", "python"),
].find((candidate) => fs.existsSync(candidate));

test("learned backbone benchmark runner materializes pending benchmark evidence batches", { skip: !pythonBin }, async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-learned-backbone-runner-"));
    const outputDir = path.join(tempRoot, "outputs");
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        const { stdout } = await execFileAsync(process.execPath, [
            "--import",
            "tsx",
            "scripts/run-learned-backbone-benchmark.ts",
            "--outputDir",
            outputDir,
            "--batchId",
            "runner-batch-v1",
            "--benchmarkIds",
            "cadence_clarity_reference,counterline_dialogue_probe,localized_rewrite_probe",
            "--searchBudget",
            "custom(3+1)",
        ], {
            cwd: repoRoot,
            env: {
                ...process.env,
                LOG_LEVEL: "error",
                PYTHON_BIN: pythonBin,
            },
            maxBuffer: 1024 * 1024 * 8,
        });

        const payload = parseLastJsonLine(stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.batchId, "runner-batch-v1");
        assert.equal(payload.runCount, 3);
        assert.equal(payload.failedRunCount, 0);
        assert.equal(payload.searchBudgetLevel, "custom");
        assert.equal(payload.searchBudgetDescriptor, "custom(3+1)");
        assert.equal(payload.candidateCount, 3);
        assert.equal(payload.localizedRewriteBranches, 1);
        assert.deepEqual(payload.benchmarkIds, ["cadence_clarity_reference", "counterline_dialogue_probe", "localized_rewrite_probe"]);
        assert.equal(fs.existsSync(payload.paths.batchManifestPath), true);

        const batchManifest = JSON.parse(fs.readFileSync(payload.paths.batchManifestPath, "utf8"));
        assert.equal(batchManifest.runCount, 3);
        assert.equal(batchManifest.succeededRunCount, 3);
        assert.equal(batchManifest.failedRunCount, 0);
        assert.equal(batchManifest.reviewRubricVersion, "approval_review_rubric_v1");
        assert.equal(batchManifest.searchBudgetDescriptor, "custom(3+1)");
        assert.equal(batchManifest.reviewPending, true);
        assert.equal(batchManifest.runs.length, 3);
        for (const run of batchManifest.runs) {
            assert.equal(run.approvalStatus, "pending");
            assert.equal(run.reviewRubricVersion, "approval_review_rubric_v1");
            assert.equal(fs.existsSync(run.manifestPath), true);
            assert.equal(fs.existsSync(run.candidateIndexPath), true);
        }

        const summaryStdout = await execFileAsync(process.execPath, [
            "scripts/summarize-learned-backbone-benchmark.mjs",
            `--outputDir=${outputDir}`,
        ], {
            cwd: repoRoot,
            env: {
                ...process.env,
                LOG_LEVEL: "error",
            },
            maxBuffer: 1024 * 1024 * 4,
        });
        const summary = JSON.parse(summaryStdout.stdout.trim());

        assert.equal(summary.ok, true);
        assert.equal(summary.runCount, 3);
        assert.equal(summary.pairedRunCount, 3);
        assert.equal(summary.reviewedRunCount, 0);
        assert.equal(summary.pendingReviewCount, 3);
        assert.equal(summary.searchBudgetCounts.custom, 3);
        assert.deepEqual(summary.configSnapshot.benchmarkIds, ["cadence_clarity_reference", "counterline_dialogue_probe", "localized_rewrite_probe"]);
        assert.equal(summary.reviewRubricVersionCounts.approval_review_rubric_v1, 3);
        assert.equal(summary.reviewQueue.pendingBlindReviewCount, 3);
        assert.equal(summary.reviewQueue.pendingShortlistReviewCount, 0);
        assert.equal(summary.searchBudgetRows.length, 1);
        assert.equal(summary.searchBudgetRows[0].searchBudgetDescriptor, "custom(3+1)");
        assert.equal(summary.searchBudgetRows[0].wholePieceCandidateCount, 3);
        assert.equal(summary.searchBudgetRows[0].localizedRewriteBranchCount, 1);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});