/**
 * Unit test suite — pure TypeScript/JS logic, no mandatory subprocess calls.
 *
 * Inclusion criteria:
 *  - All assertions are in-process (no execFile/spawn that always fires).
 *  - Python subprocess allowed only when fully guarded by pythonAvailable() /
 *    t.skip(), so the suite passes cleanly on a machine with no Python.
 *
 * To run: node --test test/suites/unit.test.mjs
 */

// ─── Domain knowledge & grammar ─────────────────────────────────────────────
import "../critic-rules.test.mjs";
import "../form-templates.test.mjs";
import "../classical-knowledge.test.mjs";
import "../phrase-grammar.test.mjs";
import "../harmony-grammar.test.mjs";
import "../motif-development.test.mjs";

// ─── Scoring & evaluation ────────────────────────────────────────────────────
import "../craft-score.test.mjs";
import "../scoring-profile.test.mjs";
import "../scoring-profile-registry.test.mjs";
import "../evidence-coverage.test.mjs";
import "../musical-quality-regression.test.mjs";
import "../cycle-evaluation.test.mjs";
import "../sonata-cycle-planner.test.mjs";

// ─── Feedback & preference ───────────────────────────────────────────────────
import "../listener-feedback.test.mjs";
import "../preference-model.test.mjs";
import "../candidate-feedback-api.test.mjs";

// ─── Candidate pool & repair ─────────────────────────────────────────────────
import "../hybrid-symbolic-candidate-pool.test.mjs";
import "../learned-multi-candidate.test.mjs";
import "../harmony-repair-directives.test.mjs";
import "../localized-rewrite-harmony-repair.test.mjs";
