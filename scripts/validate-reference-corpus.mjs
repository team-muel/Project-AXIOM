#!/usr/bin/env node
/**
 * scripts/validate-reference-corpus.mjs
 *
 * Reference Corpus Validator — 8-point provenance and integrity checks for all
 * ABC files declared in config/reference-corpus/file-manifest.json.
 *
 * Usage:
 *   node scripts/validate-reference-corpus.mjs \
 *     --root=config/reference-corpus \
 *     --strict
 *
 * Options:
 *   --root=<path>     Root directory containing file-manifest.json, corpus-manifest.json,
 *                     and the abc/ subdirectory.  Default: config/reference-corpus
 *   --out=<path>      Write JSON report to this path (optional)
 *   --strict          Exit 1 on ANY failed check (including warnings).
 *                     Without --strict, only hard errors cause exit 1.
 *   --fix-sha256      Compute and patch sha256 for all files where it is null.
 *   --verbose         Print per-file detail for every check.
 *
 * Check catalogue:
 *   C1  All ABC files on disk are registered in file-manifest.json
 *   C2  All manifest entries have an abc/ file that actually exists
 *   C3  sha256 integrity — computed hash matches manifest (skipped for null hashes)
 *   C4  composer role consistency — manifest composer.role matches corpus-manifest.json
 *   C5  completeness specified — every entry has a valid completeness level
 *   C6  provenance fields — sourceUrl and sourceLicense present (warn if missing)
 *   C7  metric scope guard — excerpt/incipit_only entries excluded from movement-level metrics
 *   C8  primary role guard — no "unknown" composer has role=primary
 */

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { join, resolve, dirname, extname, basename } from "node:path";
import { createHash } from "node:crypto";

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter((a) => a.startsWith("--"))
        .map((a) => {
            const eq = a.indexOf("=");
            if (eq === -1) return [a.slice(2), true];
            return [a.slice(2, eq), a.slice(eq + 1)];
        })
);

const rootArg    = resolve(args["root"] ?? "config/reference-corpus");
const outPath    = args["out"] ? resolve(args["out"]) : null;
const isStrict   = args["strict"] === true;
const fixSha256  = args["fix-sha256"] === true;
const isVerbose  = args["verbose"] === true;

const manifestPath      = join(rootArg, "file-manifest.json");
const corpusManifestPath= join(rootArg, "corpus-manifest.json");
const abcRoot           = join(rootArg, "abc");

const VALID_COMPLETENESS = new Set([
    "complete_piece", "complete_movement", "complete_section", "excerpt", "incipit_only"
]);

// Movement-level metrics that must not be used with excerpt/incipit_only
const MOVEMENT_LEVEL_METRICS = new Set([
    "referenceDistanceScore", "formalArc", "climaxPosition",
    "phraseDistribution", "cadencePlacement"
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256OfFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        const stream = createReadStream(filePath);
        stream.on("data", (d) => hash.update(d));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
}

async function scanAbcFilesOnDisk(root) {
    const result = new Set(); // relative path from abcRoot like "beethoven/beethoven_bagatelle_op119_1.abc"
    if (!existsSync(root)) return result;
    const subdirs = await readdir(root, { withFileTypes: true });
    for (const entry of subdirs) {
        if (entry.isDirectory()) {
            const files = await readdir(join(root, entry.name));
            for (const f of files) {
                if (extname(f).toLowerCase() === ".abc") {
                    result.add(`${entry.name}/${f}`);
                }
            }
        } else if (extname(entry.name).toLowerCase() === ".abc") {
            result.add(entry.name);
        }
    }
    return result;
}

// ── Load manifests ────────────────────────────────────────────────────────────

if (!existsSync(manifestPath)) {
    console.error(`ERROR: file-manifest.json not found at ${manifestPath}`);
    console.error("Run: node scripts/validate-reference-corpus.mjs --root=config/reference-corpus");
    process.exit(1);
}

const fileManifest  = JSON.parse(await readFile(manifestPath, "utf-8"));
const corpusManifest = existsSync(corpusManifestPath)
    ? JSON.parse(await readFile(corpusManifestPath, "utf-8"))
    : null;

if (!corpusManifest) {
    console.warn("WARN: corpus-manifest.json not found — C4 role consistency check will be skipped");
}

const allEntries = fileManifest.files ?? [];

// ── Scan disk ─────────────────────────────────────────────────────────────────

const diskFiles = await scanAbcFilesOnDisk(abcRoot); // Set of "subdir/filename"

// Build manifest lookup: abcPath relative key → entry
// abcPath in manifest is like "abc/beethoven/beethoven_bagatelle_op119_1.abc"
// We strip the leading "abc/" to match disk relative paths.
const manifestByRelPath = new Map(); // "beethoven/beethoven_bagatelle_op119_1.abc" → entry
for (const entry of allEntries) {
    const relPath = entry.abcPath?.replace(/^abc\//, "") ?? null;
    if (relPath) manifestByRelPath.set(relPath, entry);
}

// ── Results accumulator ───────────────────────────────────────────────────────

const results = {
    timestamp: new Date().toISOString(),
    root: rootArg,
    strict: isStrict,
    totalDiskFiles: diskFiles.size,
    totalManifestEntries: allEntries.length,
    checks: {},
    summary: { pass: 0, warn: 0, fail: 0 },
};

function record(checkId, { pass, errors = [], warnings = [] }) {
    const status = !pass ? "fail" : warnings.length > 0 ? "warn" : "pass";
    results.checks[checkId] = { status, errors, warnings };
    results.summary[status] = (results.summary[status] ?? 0) + 1;
    const icon = status === "pass" ? "✓" : status === "warn" ? "⚠" : "✗";
    console.log(`  ${icon} ${checkId}: ${status.toUpperCase()}${errors.length ? ` (${errors.length} error(s))` : ""}${warnings.length ? ` (${warnings.length} warning(s))` : ""}`);
    if (isVerbose || !pass) {
        for (const e of errors) console.log(`      ERROR: ${e}`);
        for (const w of warnings) console.log(`      WARN:  ${w}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// C1 — All on-disk ABC files are registered in file-manifest.json
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nRunning reference corpus validation...\n");

{
    const unregistered = [];
    for (const relPath of diskFiles) {
        if (!manifestByRelPath.has(relPath)) {
            unregistered.push(relPath);
        }
    }
    record("C1-disk-coverage", {
        pass: unregistered.length === 0,
        errors: unregistered.map((p) => `Unregistered: abc/${p}`),
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// C2 — All manifest entries have an abc/ file that exists on disk
// ─────────────────────────────────────────────────────────────────────────────

{
    const missing = [];
    for (const entry of allEntries) {
        if (!entry.abcPath) {
            missing.push(`${entry.id}: abcPath is null`);
            continue;
        }
        const relPath = entry.abcPath.replace(/^abc\//, "");
        const fullPath = join(abcRoot, relPath);
        if (!existsSync(fullPath)) {
            missing.push(`${entry.id}: ${entry.abcPath} (not on disk)`);
        }
    }
    record("C2-manifest-coverage", {
        pass: missing.length === 0,
        errors: missing,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// C3 — sha256 integrity (skipped for null hashes; --fix-sha256 patches them)
// ─────────────────────────────────────────────────────────────────────────────

{
    const mismatches = [];
    const nullCount = [];
    let fixed = 0;

    for (const entry of allEntries) {
        if (!entry.abcPath) continue;
        const fullPath = join(abcRoot, entry.abcPath.replace(/^abc\//, ""));
        if (!existsSync(fullPath)) continue; // C2 already reported this

        if (entry.sha256 === null || entry.sha256 === undefined) {
            nullCount.push(entry.id);
            if (fixSha256) {
                const computed = await sha256OfFile(fullPath);
                entry.sha256 = computed;
                fixed++;
            }
        } else {
            const computed = await sha256OfFile(fullPath);
            if (computed !== entry.sha256) {
                mismatches.push(`${entry.id}: expected ${entry.sha256}, got ${computed}`);
            }
        }
    }

    if (fixSha256 && fixed > 0) {
        await writeFile(manifestPath, JSON.stringify(fileManifest, null, 2), "utf-8");
        console.log(`  [fix-sha256] Patched ${fixed} null sha256 hashes in file-manifest.json`);
    }

    record("C3-sha256-integrity", {
        pass: mismatches.length === 0,
        errors: mismatches,
        warnings: nullCount.length > 0
            ? [`${nullCount.length} entries have sha256=null (run --fix-sha256 to compute)`]
            : [],
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// C4 — composer role consistency with corpus-manifest.json
// ─────────────────────────────────────────────────────────────────────────────

{
    const errors = [];
    const warnings = [];

    if (!corpusManifest) {
        warnings.push("corpus-manifest.json absent — skipping role check");
    } else {
        const composerRoles = corpusManifest.composerRoles ?? {};
        for (const entry of allEntries) {
            const composerKey = entry.composer?.toLowerCase();
            if (!composerKey) {
                errors.push(`${entry.id}: missing composer field`);
                continue;
            }
            const manifestRole = composerRoles[composerKey]?.role;
            if (!manifestRole) {
                warnings.push(`${entry.id}: composer "${composerKey}" not found in corpus-manifest.json composerRoles`);
                continue;
            }
            if (entry.role !== manifestRole) {
                errors.push(
                    `${entry.id}: file-manifest role="${entry.role}" but corpus-manifest role="${manifestRole}" for composer "${composerKey}"`
                );
            }
        }
    }

    record("C4-role-consistency", { pass: errors.length === 0, errors, warnings });
}

// ─────────────────────────────────────────────────────────────────────────────
// C5 — completeness specified and valid
// ─────────────────────────────────────────────────────────────────────────────

{
    const errors = [];
    for (const entry of allEntries) {
        if (!entry.completeness) {
            errors.push(`${entry.id}: completeness is missing`);
        } else if (!VALID_COMPLETENESS.has(entry.completeness)) {
            errors.push(`${entry.id}: unknown completeness value "${entry.completeness}"`);
        }
    }
    record("C5-completeness", { pass: errors.length === 0, errors });
}

// ─────────────────────────────────────────────────────────────────────────────
// C6 — provenance fields (sourceUrl + sourceLicense) — warn-only
// ─────────────────────────────────────────────────────────────────────────────

{
    const warnings = [];
    for (const entry of allEntries) {
        const missingFields = [];
        if (!entry.sourceUrl) missingFields.push("sourceUrl");
        if (!entry.sourceLicense) missingFields.push("sourceLicense");
        if (missingFields.length > 0) {
            warnings.push(`${entry.id}: missing ${missingFields.join(", ")}`);
        }
    }
    // In strict mode this escalates to errors; otherwise it's advisory
    const isError = isStrict && warnings.length > 0;
    record("C6-provenance", {
        pass: !isError,
        errors: isError ? warnings : [],
        warnings: isError ? [] : warnings,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// C7 — metric scope guard: excerpt/incipit_only not used for movement-level metrics
//      This is a static check against the validForMatrix in corpus-file-index.json.
//      If corpus-file-index.json is present, we cross-check that no excerpt/incipit
//      appears in a completeness group that enables movement-level metrics.
// ─────────────────────────────────────────────────────────────────────────────

{
    const errors = [];
    const fileIndexPath = join(rootArg, "corpus-file-index.json");
    if (existsSync(fileIndexPath)) {
        const fileIndex = JSON.parse(await readFile(fileIndexPath, "utf-8"));
        const validForMatrix = fileIndex.validForMatrix ?? {};
        for (const [level, metrics] of Object.entries(validForMatrix)) {
            if (level === "excerpt" || level === "incipit_only") {
                const forbidden = metrics.filter((m) => MOVEMENT_LEVEL_METRICS.has(m));
                if (forbidden.length > 0) {
                    errors.push(
                        `corpus-file-index.json validForMatrix["${level}"] includes movement-level metrics: ${forbidden.join(", ")}`
                    );
                }
            }
        }
        // Also verify that all excerpt/incipit entries in the manifest do NOT have
        // completeness levels that would allow movement-level metrics in the matrix.
        const restrictedLevels = new Set(["excerpt", "incipit_only"]);
        for (const entry of allEntries) {
            if (restrictedLevels.has(entry.completeness)) {
                // Double-check: these must not appear in any allowed set used for referenceDistanceScore
                // (This is enforced by code; this check catches future schema drift)
                const allowedMetrics = validForMatrix[entry.completeness] ?? [];
                const forbidden = allowedMetrics.filter((m) => MOVEMENT_LEVEL_METRICS.has(m));
                if (forbidden.length > 0) {
                    errors.push(
                        `${entry.id} (${entry.completeness}): validForMatrix allows movement-level metrics: ${forbidden.join(", ")}`
                    );
                }
            }
        }
    } else {
        if (isVerbose) console.log("    [C7] corpus-file-index.json absent — skipping matrix check");
    }
    record("C7-metric-scope", { pass: errors.length === 0, errors });
}

// ─────────────────────────────────────────────────────────────────────────────
// C8 — primary role guard: no unknown composer has role=primary
// ─────────────────────────────────────────────────────────────────────────────

{
    const errors = [];
    const knownPrimaryComposers = new Set(
        corpusManifest?.primary?.composers?.map((c) => c.toLowerCase()) ?? ["beethoven", "schubert"]
    );
    for (const entry of allEntries) {
        if (entry.role === "primary") {
            const composerKey = entry.composer?.toLowerCase() ?? "unknown";
            if (!knownPrimaryComposers.has(composerKey)) {
                errors.push(
                    `${entry.id}: role=primary but composer "${composerKey}" is not in primary composers list`
                );
            }
        }
    }
    record("C8-primary-guard", { pass: errors.length === 0, errors });
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════");
console.log(" Reference Corpus Validation Summary");
console.log("══════════════════════════════════════════════════════");
console.log(`  Manifest entries: ${allEntries.length} | Disk files: ${diskFiles.size}`);
console.log(`  ✓ Pass:  ${results.summary.pass}  ⚠ Warn: ${results.summary.warn}  ✗ Fail: ${results.summary.fail}`);

const hardFail = Object.values(results.checks).some((c) => c.status === "fail");
const hasWarn  = Object.values(results.checks).some((c) => c.status === "warn");

if (!hardFail && !hasWarn) {
    console.log("\n  ✓ All checks passed.");
} else if (!hardFail) {
    console.log("\n  ⚠ Passed with warnings. Run --strict to treat warnings as errors.");
    console.log("  Recommended: fill in sourceUrl, sha256, and sourceName for all entries.");
} else {
    console.log("\n  ✗ Validation FAILED. Fix errors above before using corpus for production promotion.");
}

// ── Write output ──────────────────────────────────────────────────────────────

if (outPath) {
    const outDir = dirname(outPath);
    if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });
    await writeFile(outPath, JSON.stringify(results, null, 2), "utf-8");
    console.log(`\n  Report written to: ${outPath}`);
}

// ── Exit code ─────────────────────────────────────────────────────────────────

const exitCode = hardFail || (isStrict && hasWarn) ? 1 : 0;
process.exit(exitCode);
