/**
 * Core runtime test suite — pipeline, autonomy, and MCP transport.
 *
 * Tests in this suite spawn Node.js child processes via runNodeEval helpers
 * but do NOT require Python or external services.
 *
 * Approx time: several seconds (child-process overhead).
 *
 * To run: node --test test/suites/core.test.mjs
 */

// ─── Autonomy & runtime ───────────────────────────────────────────────────────
import "../restart-recovery.test.mjs";
import "../autonomy-conflicts.test.mjs";
import "../quality-loop.test.mjs";
import "../autonomy-ops.test.mjs";
import "../compose-worker.test.mjs";

// ─── Manifest & candidate storage ────────────────────────────────────────────
import "../manifest-storage.test.mjs";
import "../candidate-evidence-storage.test.mjs";

// ─── Transport & operator surfaces ───────────────────────────────────────────
import "../mcp-transport.test.mjs";
import "../ready-status.test.mjs";
import "../overseer-last-report.test.mjs";

// ─── Feedback (subprocess-based) ─────────────────────────────────────────────
// candidate-feedback-api uses runNodeEval (subprocess) — placed here, not in unit suite
import "../candidate-feedback-api.test.mjs";
// piano-listenability-repair uses runNodeEval (subprocess) — placed here, not in piano suite
import "../piano-listenability-repair.test.mjs";

// ─── Multi-model planner ──────────────────────────────────────────────────────
import "../multimodel-planner.test.mjs";
import "../multimodel-execution.test.mjs";

// ─── Structure shadow runtime ─────────────────────────────────────────────────
import "../structure-shadow-runtime.test.mjs";
import "../shadow-reranker-promotion-outcomes.test.mjs";
