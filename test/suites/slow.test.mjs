/**
 * Slow test suite — Python E2E, benchmark, soundfont, and NotaGen native tests.
 *
 * These tests require Python + full worker setup, or touch real audio
 * processing, or run actual NotaGen model inference. They take noticeably
 * longer than the other suites.
 *
 * Gate: set AXIOM_RUN_SLOW_TESTS=1 to enable all slow tests.
 *
 * To run: AXIOM_RUN_SLOW_TESTS=1 node --test test/suites/slow.test.mjs
 *         (Windows: set AXIOM_RUN_SLOW_TESTS=1 && node --test test/suites/slow.test.mjs)
 *
 * To run only the NotaGen native smoke tests (PNS-01…PNS-07):
 *         node --test test/python-notagen-native-smoke.test.mjs
 *   or:   npm run test:notagen-native
 *
 * NotaGen native tests additionally require:
 *   - AXIOM_NOTAGEN_CHECKPOINT_PATH env var pointing to a .pth file
 *   - NOTAGEN_REPO_PATH env var pointing to the cloned NotaGen repo
 *   - torch and music21 installed
 *   (without these the PNS tests self-skip cleanly)
 */
import { test } from "node:test";

if (process.env.AXIOM_RUN_SLOW_TESTS !== "1") {
    test("slow suite gated", (t) => {
        t.skip(
            "Slow tests are disabled. Set AXIOM_RUN_SLOW_TESTS=1 to run " +
            "python-compose, piano-benchmark, soundfont, and notagen-native tests.",
        );
    });
} else {
    await import("../python-compose-piano-lane.test.mjs");
    await import("../python-compose-piano-e2e.test.mjs");
    await import("../piano-benchmark.test.mjs");
    await import("../soundfont-benchmark-script.test.mjs");
    await import("../soundfont-benchmark-playlist.test.mjs");
    // Real NotaGen native inference — self-skips if checkpoint/repo not configured
    await import("../python-notagen-native-smoke.test.mjs");
}
