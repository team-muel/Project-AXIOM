/**
 * Slow test suite — Python E2E, benchmark, and soundfont tests.
 *
 * These tests require Python + full worker setup, or touch real audio
 * processing, and take noticeably longer than the other suites.
 *
 * Gate: set AXIOM_RUN_SLOW_TESTS=1 to enable.
 *
 * To run: AXIOM_RUN_SLOW_TESTS=1 node --test test/suites/slow.test.mjs
 *         (Windows: set AXIOM_RUN_SLOW_TESTS=1 && node --test test/suites/slow.test.mjs)
 */
import { test } from "node:test";

if (process.env.AXIOM_RUN_SLOW_TESTS !== "1") {
    test("slow suite gated", (t) => {
        t.skip(
            "Slow tests are disabled. Set AXIOM_RUN_SLOW_TESTS=1 to run " +
            "python-compose, piano-benchmark, and soundfont tests.",
        );
    });
} else {
    await import("../python-compose-piano-lane.test.mjs");
    await import("../python-compose-piano-e2e.test.mjs");
    await import("../piano-benchmark.test.mjs");
    await import("../soundfont-benchmark-script.test.mjs");
    await import("../soundfont-benchmark-playlist.test.mjs");
}
