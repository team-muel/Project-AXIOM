import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("runtime structure shadow summary script reports recent runtime-window disagreement history", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-shadow-runtime-summary-"));

    try {
        const historyDir = path.join(tempRoot, "_system", "ml", "runtime", "structure-rank-v1-shadow-history");
        fs.mkdirSync(historyDir, { recursive: true });

        fs.writeFileSync(path.join(historyDir, "2026-04-10.jsonl"), [JSON.stringify({
            kind: "structure_shadow",
            generatedAt: "2026-04-10T09:30:00.000Z",
            songId: "song-shadow",
            snapshotId: "shadow-live",
            candidateCount: 2,
            selectedCandidateId: "structure-a1-heuristic",
            heuristicTopCandidateId: "structure-a1-heuristic",
            learnedTopCandidateId: "structure-a1-learned",
            confidence: 0.88,
            disagreement: true,
            reason: "section evidence survived while heuristic favored raw score",
            scorePaths: [path.join(tempRoot, "outputs", "song-shadow", "candidates", "structure-a1-learned", "reranker-score.json")],
        })].join("\n") + "\n", "utf-8");

        fs.writeFileSync(path.join(historyDir, "2026-04-09.jsonl"), [JSON.stringify({
            kind: "structure_shadow",
            generatedAt: "2026-04-09T01:00:00.000Z",
            songId: "song-old",
            snapshotId: "shadow-live",
            candidateCount: 2,
            selectedCandidateId: "structure-old-selected",
            heuristicTopCandidateId: "structure-old-selected",
            learnedTopCandidateId: "structure-old-selected",
            confidence: 0.51,
            disagreement: false,
            scorePaths: [],
        })].join("\n") + "\n", "utf-8");

        const stdout = execFileSync(
            process.execPath,
            [
                "scripts/summarize-structure-shadow-runtime.mjs",
                "--windowHours=12",
                "--limit=20",
                "--now=2026-04-10T12:00:00.000Z",
            ],
            {
                cwd: repoRoot,
                env: {
                    ...process.env,
                    OUTPUT_DIR: tempRoot,
                },
            },
        ).toString();

        const payload = JSON.parse(stdout);
        assert.equal(payload.ok, true);
        assert.match(payload.historyDir, /structure-rank-v1-shadow-history$/);
        assert.equal(payload.summary.windowHours, 12);
        assert.equal(payload.summary.totalEntries, 2);
        assert.equal(payload.summary.sampledEntries, 1);
        assert.equal(payload.summary.disagreementCount, 1);
        assert.equal(payload.summary.highConfidenceDisagreementCount, 1);
        assert.equal(payload.summary.snapshotRows[0].snapshotId, "shadow-live");
        assert.equal(payload.summary.recentDisagreements[0].songId, "song-shadow");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});