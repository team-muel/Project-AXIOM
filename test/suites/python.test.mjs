/**
 * Python worker test suite — tests that invoke Python subprocesses.
 *
 * Tests skip automatically when Python is not on PATH or when pythonAvailable()
 * returns falsy. The suite passes cleanly on a Python-free machine.
 *
 * Note: learned-localized-rewrite uses spawnSync("python") directly on test 16;
 * tests 1–15 are pure JS and always run.
 *
 * To run: node --test test/suites/python.test.mjs
 */
import "../abc-projection-pipeline.test.mjs";
import "../learned-notagen-prompt.test.mjs";
import "../learned-localized-rewrite.test.mjs";
import "../notagen-backend.test.mjs";
import "../python-worker-compile.test.mjs";
import "../learned-backend-routing.test.mjs";
import "../worker-evidence-contract.test.mjs";
import "../harmony-repair-prompt.test.mjs";
import "../motif-graph-prompt.test.mjs";
