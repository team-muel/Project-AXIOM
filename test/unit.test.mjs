/**
 * Fast unit test suite — pure TypeScript/JS logic only.
 *
 * Rules for inclusion:
 *  - No mandatory subprocess calls (no execFile/spawn/runNodeEval that always run).
 *  - Python subprocess is allowed only when fully guarded by pythonAvailable() /
 *    t.skip(), so tests pass cleanly with no Python on the machine.
 *
 * For the full integration suite (script runners, autonomy state, Python workers):
 *   npm run test:all
 */

// ─── Domain knowledge & grammar ─────────────────────────────────────────────
import "./critic-rules.test.mjs";
import "./form-templates.test.mjs";
import "./classical-knowledge.test.mjs";
import "./phrase-grammar.test.mjs";
import "./harmony-grammar.test.mjs";
import "./motif-development.test.mjs";

// ─── Scoring & evaluation ────────────────────────────────────────────────────
import "./craft-score.test.mjs";
import "./scoring-profile.test.mjs";
import "./scoring-profile-registry.test.mjs";
import "./evidence-coverage.test.mjs";
import "./musical-quality-regression.test.mjs";
import "./cycle-evaluation.test.mjs";
import "./sonata-cycle-planner.test.mjs";

// ─── Piano specifics ─────────────────────────────────────────────────────────
import "./piano-ir.test.mjs";
import "./piano-craft-scoring.test.mjs";
import "./piano-repair-solver.test.mjs";
import "./piano-voice-layout.test.mjs";
import "./piano-listenability.test.mjs";
import "./piano-listenability-repair.test.mjs";
import "./piano-strict-gates.test.mjs";
import "./piano-benchmark.test.mjs";
import "./piano-dataset.test.mjs";
import "./piano-projection.test.mjs";

// ─── Learned / prompt builders ───────────────────────────────────────────────
import "./learned-multi-candidate.test.mjs";
import "./learned-backend-routing.test.mjs";
import "./localized-rewrite-harmony-repair.test.mjs";

// ─── Feedback & preference ───────────────────────────────────────────────────
import "./listener-feedback.test.mjs";
import "./preference-model.test.mjs";
import "./candidate-feedback-api.test.mjs";

// ─── Candidate pool ──────────────────────────────────────────────────────────
import "./hybrid-symbolic-candidate-pool.test.mjs";
import "./worker-evidence-contract.test.mjs";

// ─── Prompt control blocks (Python tests are skipped when Python absent) ─────
import "./harmony-repair-prompt.test.mjs";
import "./motif-graph-prompt.test.mjs";
