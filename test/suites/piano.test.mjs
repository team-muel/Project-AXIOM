/**
 * Piano test suite — piano-specific logic, pure in-process assertions.
 *
 * Includes scoring, repair, voice layout, listenability, and gate tests.
 * No Python subprocess. No runNodeEval.
 *
 * To run: node --test test/suites/piano.test.mjs
 */
import "../piano-ir.test.mjs";
import "../piano-dataset.test.mjs";
import "../piano-projection.test.mjs";
import "../piano-craft-scoring.test.mjs";
import "../piano-repair-solver.test.mjs";
import "../piano-voice-layout.test.mjs";
import "../piano-listenability.test.mjs";
import "../piano-strict-gates.test.mjs";
// NOTE: piano-listenability-repair.test.mjs uses runNodeEval → lives in core.test.mjs
