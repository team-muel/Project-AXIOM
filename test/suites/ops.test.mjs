/**
 * Ops test suite — script runners, data export, and benchmark scripts.
 *
 * Tests spawn Node.js child processes to execute CLI scripts end-to-end.
 * Slower than unit/piano but do NOT require Python or external services.
 *
 * To run: node --test test/suites/ops.test.mjs
 */

// ─── MCP bridge scripts ───────────────────────────────────────────────────────
import "../mcp-bridge-scripts.test.mjs";

// ─── Learned backbone scripts ─────────────────────────────────────────────────
import "../learned-backbone-benchmark-script.test.mjs";
import "../learned-backbone-benchmark-runner-script.test.mjs";
import "../learned-backbone-manifest-review-script.test.mjs";
import "../learned-backbone-operator-summary.test.mjs";

// ─── NotaGen export scripts ───────────────────────────────────────────────────
import "../notagen-preference-export-script.test.mjs";
import "../notagen-sft-export-script.test.mjs";

// ─── Structure / shadow dataset scripts ──────────────────────────────────────
import "../structure-reranker-dataset-script.test.mjs";
import "../truth-plane-flat-dataset-script.test.mjs";
import "../structure-shadow-reranker-script.test.mjs";
import "../structure-shadow-runtime-summary-script.test.mjs";
