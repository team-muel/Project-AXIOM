#!/usr/bin/env node
/**
 * scripts/profile-tests.mjs
 *
 * Measures elapsed time for each test suite and reports results sorted slowest-first.
 *
 * Usage:
 *   node scripts/profile-tests.mjs              # all suites
 *   node scripts/profile-tests.mjs unit piano   # selected suites
 *
 * AXIOM_RUN_SLOW_TESTS=1 node scripts/profile-tests.mjs  # include slow suite
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALL_SUITES = ["unit", "piano", "core", "python", "ops"];
if (process.env.AXIOM_RUN_SLOW_TESTS === "1") {
    ALL_SUITES.push("slow");
}

const requested = process.argv.slice(2);
const suites = requested.length > 0
    ? requested.filter((s) => ALL_SUITES.includes(s))
    : ALL_SUITES;

if (suites.length === 0) {
    console.error(`Unknown suite(s): ${requested.join(", ")}`);
    console.error(`Available: ${ALL_SUITES.join(", ")}`);
    process.exit(1);
}

console.log(`\nProfiling ${suites.length} suite(s): ${suites.join(", ")}\n`);

const results = [];

for (const suite of suites) {
    const file = path.join(repoRoot, "test", "suites", `${suite}.test.mjs`);
    process.stdout.write(`  ${suite.padEnd(10)} ...`);
    const start = Date.now();
    let passed = 0;
    let failed = 0;
    let status = "ok";

    try {
        const { stdout } = await execFileAsync(
            process.execPath,
            ["--test", file],
            {
                cwd: repoRoot,
                env: { ...process.env },
                timeout: 300_000,
            },
        );
        // Parse TAP-style summary lines
        const passMatch = stdout.match(/pass (\d+)/);
        const failMatch = stdout.match(/fail (\d+)/);
        passed = passMatch ? parseInt(passMatch[1], 10) : 0;
        failed = failMatch ? parseInt(failMatch[1], 10) : 0;
        if (failed > 0) status = "FAIL";
    } catch (err) {
        status = "ERROR";
        const out = /** @type {any} */ (err).stdout ?? "";
        const failMatch = out.match(/fail (\d+)/);
        failed = failMatch ? parseInt(failMatch[1], 10) : 1;
    }

    const elapsed = Date.now() - start;
    results.push({ suite, elapsed, passed, failed, status });
    const label = status === "ok" ? `✔ ${passed}p` : `✖ ${failed}f`;
    process.stdout.write(` ${elapsed}ms  ${label}\n`);
}

results.sort((a, b) => b.elapsed - a.elapsed);

console.log("\n─── Sorted by elapsed (slowest first) ───────────────────────────");
for (const { suite, elapsed, passed, failed, status } of results) {
    const bar = "█".repeat(Math.min(40, Math.round(elapsed / 500)));
    const indicator = status === "ok" ? "✔" : "✖";
    console.log(`  ${indicator} ${suite.padEnd(10)} ${String(elapsed).padStart(6)}ms  ${bar}`);
    if (failed > 0) console.log(`    └─ ${failed} test(s) failed`);
}

const total = results.reduce((s, r) => s + r.elapsed, 0);
const anyFailed = results.some((r) => r.failed > 0);
console.log(`\n  Total wall time: ${total}ms`);
if (anyFailed) {
    console.log("  ⚠  Some suites had failures — run individual suite for details.\n");
    process.exitCode = 1;
} else {
    console.log("  All suites passed.\n");
}
