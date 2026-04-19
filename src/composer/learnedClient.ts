import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import type {
    ComposeExecutionPlan,
    ComposeRequest,
    ComposeResult,
    ComposeWorkerProgress,
} from "../pipeline/types.js";
import { buildLearnedSymbolicWorkerPayload } from "./learnedAdapter.js";
import { normalizeLearnedSymbolicResponse } from "./learnedNormalizer.js";
import {
    validateLearnedSymbolicProposalResponse,
    type LearnedSymbolicProposalResponse,
} from "./learnedSymbolicContract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LEARNED_SYMBOLIC_WORKER_SCRIPT = path.join(__dirname, "../../workers/composer/compose_learned_symbolic.py");

export interface LearnedSymbolicClientDeps {
    writeComposeProgress: (songId: string, progress: ComposeWorkerProgress) => void;
    runWorker: <T>(script: string, input: string, timeoutMs: number) => Promise<T>;
}

export async function composeWithLearnedSymbolic(
    request: ComposeRequest,
    songId: string,
    executionPlan: ComposeExecutionPlan,
    deps: LearnedSymbolicClientDeps,
): Promise<ComposeResult> {
    const songDir = path.join(config.outputDir, songId);
    fs.mkdirSync(songDir, { recursive: true });
    const midiOutputPath = path.join(songDir, "composition.mid");
    const workerPayload = buildLearnedSymbolicWorkerPayload(request, songId, midiOutputPath, executionPlan);

    logger.info("Composing via learned symbolic proposal worker", {
        songId,
        prompt: request.prompt,
        workflow: executionPlan.workflow,
        promptPackVersion: workerPayload.promptPack.version,
        planSignature: workerPayload.promptPack.planSignature,
    });

    deps.writeComposeProgress(songId, {
        worker: "learned_symbolic",
        phase: "starting",
        updatedAt: new Date().toISOString(),
        detail: "Starting learned symbolic proposal worker",
        outputPath: midiOutputPath,
    });

    let result: LearnedSymbolicProposalResponse;
    try {
        result = validateLearnedSymbolicProposalResponse(
            await deps.runWorker<LearnedSymbolicProposalResponse>(
                LEARNED_SYMBOLIC_WORKER_SCRIPT,
                JSON.stringify(workerPayload),
                config.composeWorkerTimeoutMs,
            ),
        );
    } catch (error) {
        deps.writeComposeProgress(songId, {
            worker: "learned_symbolic",
            phase: "failed",
            updatedAt: new Date().toISOString(),
            detail: error instanceof Error ? error.message : String(error),
            outputPath: midiOutputPath,
        });
        throw error;
    }

    if (!result.ok) {
        deps.writeComposeProgress(songId, {
            worker: "learned_symbolic",
            phase: "failed",
            updatedAt: new Date().toISOString(),
            detail: result.error,
            outputPath: midiOutputPath,
        });
        throw new Error(`learned symbolic worker error: ${result.error}`);
    }

    deps.writeComposeProgress(songId, {
        worker: "learned_symbolic",
        phase: "completed",
        updatedAt: new Date().toISOString(),
        detail: "Learned symbolic proposal finished",
        outputPath: midiOutputPath,
    });

    return normalizeLearnedSymbolicResponse(result, request, songId, executionPlan, workerPayload.promptPack);
}