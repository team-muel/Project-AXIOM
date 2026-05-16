// Re-export canonical implementation from core for backward-compat with flat dist/composer imports.
// The authoritative source is src/core/composer/learnedClient.ts.
// This stub replaces the stale dist/composer/learnedClient.js artifact.
export {
    LEARNED_SYMBOLIC_WORKER_SCRIPT,
    composeWithLearnedSymbolic,
} from "../core/composer/learnedClient.js";
export type { LearnedSymbolicClientDeps } from "../core/composer/learnedClient.js";
