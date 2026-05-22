#!/usr/bin/env node
/**
 * scripts/validate-reference-corpus.mjs
 *
 * Reference Corpus Validator — multi-layer authenticity and integrity checks for all
 * ABC files declared in config/reference-corpus/file-manifest.json.
 *
 * Implements a 4-stage "fake Beethoven" defense:
 *   Stage 1: Provenance metadata (C5, C6)   — composer, catalog, source, license
 *   Stage 2: Source whitelist (C6b)          — only trusted source domains allowed
 *   Stage 3: Content sanity (C9)             — ABC headers, note count, pitch range
 *   Stage 4: Incipit fingerprint (C10)       — opening interval match vs. stored fingerprint
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
 *   C1   All ABC files on disk are registered in file-manifest.json
 *   C2   All manifest entries have an abc/ file that actually exists
 *   C3   sha256 integrity — computed hash matches manifest (skipped for null hashes)
 *   C4   composer role consistency — manifest composer.role matches corpus-manifest.json
 *   C5   completeness specified — every entry has a valid completeness level
 *   C6   provenance fields — sourceUrl and sourceLicense present (warn if missing)
 *   C6b  source whitelist — sourceUrl domain must be in TRUSTED_SOURCE_DOMAINS
 *   C7   metric scope guard — excerpt/incipit_only entries excluded from movement-level metrics
 *   C8   primary role guard — no "unknown" composer has role=primary
 *   C9   content sanity — ABC headers present, note count ≥ threshold, pitch range sane
 *   C10  incipit fingerprint — opening interval match vs. stored fingerprint (when present)
 */

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { join, resolve, dirname, extname, basename } from "node:path";
import { createHash } from "node:crypto";

// ── Trusted source whitelist (Stage 2 defense) ───────────────────────────────
// sourceUrl domain must appear here for a file to pass the source whitelist check.
// Files with null sourceUrl get a warning (not a failure) under C6/C6b.
// In --strict mode, missing sourceUrl becomes an error (via C6).

const TRUSTED_SOURCE_DOMAINS = new Set([
    "imslp.org",
    "www.imslp.org",
    "mutopiaproject.org",
    "www.mutopiaproject.org",
    "abc.sourceforge.net",
    "thesession.org",
    "github.com",
    "raw.githubusercontent.com",
    "openscore.cc",
    "www.openscore.cc",
    "musescore.com",
    "www.musescore.com",
    "folkwiki.se",
    "www.folkwiki.se",
    "notesaccess.com",
    "abcnotation.com",
    "www.abcnotation.com",
]);

// ── ABC parsing helpers (Stage 3 + 4 defense) ────────────────────────────────

const NOTE_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Minimal ABC sanity check — returns an object with counts and flag arrays.
 * No external dependencies; uses regex over the raw text.
 *
 * @param {string} abcText
 * @returns {{ hasKey: boolean, hasMeter: boolean, noteCount: number, pitchClasses: Set<number>, errors: string[], warnings: string[] }}
 */
function abcSanityCheck(abcText) {
    const lines = abcText.split(/\r?\n/);
    const errors = [];
    const warnings = [];

    const hasKey   = lines.some((l) => l.match(/^K:/i));
    const hasMeter = lines.some((l) => l.match(/^M:/i));
    if (!hasKey)   errors.push("Missing K: (key) header");
    if (!hasMeter) warnings.push("Missing M: (meter) header");

    // Count note tokens (A-G/a-g, excluding headers and rests)
    const noteLines = lines.filter((l) => l.trim() && !l.match(/^[A-Za-z]:/));
    const noteText  = noteLines.join(" ");
    const noteTokens = noteText.match(/[\^_=]*[A-Ga-g][',]*/g) ?? [];
    const noteCount = noteTokens.length;

    if (noteCount < 20) {
        warnings.push(`Very few notes (${noteCount}) — possible stub or incomplete file`);
    }

    // Collect unique pitch classes from the note tokens
    const pitchClasses = new Set();
    for (const tok of noteTokens) {
        const letter = tok.replace(/[\^_=',]/g, "").toUpperCase();
        const pc = NOTE_SEMITONES[letter];
        if (pc !== undefined) pitchClasses.add(pc);
    }
    if (pitchClasses.size <= 1 && noteCount > 10) {
        errors.push(`Only ${pitchClasses.size} distinct pitch class(es) — likely placeholder or corrupt file`);
    }

    return { hasKey, hasMeter, noteCount, pitchClasses, errors, warnings };
}

/**
 * Extract opening MIDI-relative pitch values from ABC text.
 * Returns the first maxNotes non-rest note pitches as integers.
 * Uses the ABC convention: uppercase = C3 octave (MIDI 48), lowercase = C4 octave (MIDI 60).
 *
 * @param {string} abcText
 * @param {number} maxNotes
 * @returns {number[]}
 */
function extractOpeningMidiPitches(abcText, maxNotes = 10) {
    const lines = abcText.split(/\r?\n/);
    const noteLines = lines.filter((l) => l.trim() && !l.match(/^[A-Za-z]:/));
    const noteText  = noteLines.join(" ");

    // Match: optional accidentals + pitch letter + optional octave modifiers
    // Note lengths (digits) are intentionally excluded from the match to avoid mis-parsing
    const noteRe = /([\^_=]*)([A-Ga-g])([',]*)/g;
    const pitches = [];
    let match;
    while ((match = noteRe.exec(noteText)) !== null && pitches.length < maxNotes) {
        const accStr = match[1];
        const letter = match[2];
        const octMod = match[3];

        const isLower = letter === letter.toLowerCase();
        const base    = NOTE_SEMITONES[letter.toUpperCase()] ?? 0;
        // Uppercase = C3 area (MIDI 48+base), lowercase = C4/middle C area (MIDI 60+base)
        let midi = isLower ? (60 + base) : (48 + base);

        for (const c of accStr) {
            if (c === "^") midi++;
            else if (c === "_") midi--;
        }
        for (const c of octMod) {
            if (c === "'") midi += 12;
            else if (c === ",") midi -= 12;
        }
        pitches.push(midi);
    }
    return pitches;
}

/**
 * Compute chromatic intervals between consecutive pitches.
 *
 * @param {number[]} pitches
 * @returns {number[]}
 */
function computeIntervals(pitches) {
    const intervals = [];
    for (let i = 1; i < pitches.length; i++) {
        intervals.push(pitches[i] - pitches[i - 1]);
    }
    return intervals;
}

/**
 * Compute the fraction of stored intervals that match the actual opening intervals.
 * Comparison is done element-by-element up to the shorter length.
 *
 * @param {number[]} stored  Fingerprint intervals from manifest
 * @param {number[]} actual  Intervals extracted from the ABC file
 * @returns {number}  0.0–1.0
 */
function intervalSimilarity(stored, actual) {
    const n = Math.min(stored.length, actual.length);
    if (n === 0) return 0;
    let matches = 0;
    for (let i = 0; i < n; i++) {
        if (stored[i] === actual[i]) matches++;
    }
    return matches / n;
}

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

        // Check 1: validForMatrix-level guard — excerpt/incipit_only must not list movement-level metrics
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

        // Check 2: per-entry allowedMetrics/excludedMetrics consistency
        //   a) allowedMetrics must match validForMatrix[completeness] exactly
        //   b) excludedMetrics must not overlap allowedMetrics
        //   c) excerpt/incipit_only allowedMetrics must not contain movement-level metrics
        const restrictedLevels = new Set(["excerpt", "incipit_only"]);
        for (const entry of allEntries) {
            const canonical = new Set(validForMatrix[entry.completeness] ?? []);

            // 2a: per-entry drift check (if allowedMetrics is present)
            if (Array.isArray(entry.allowedMetrics)) {
                const entryAllowed = new Set(entry.allowedMetrics);
                const extraInEntry = [...entryAllowed].filter((m) => !canonical.has(m));
                const missingFromEntry = [...canonical].filter((m) => !entryAllowed.has(m));
                if (extraInEntry.length > 0) {
                    errors.push(
                        `${entry.id}: allowedMetrics contains "${extraInEntry.join(", ")}" not in validForMatrix["${entry.completeness}"]`
                    );
                }
                if (missingFromEntry.length > 0) {
                    errors.push(
                        `${entry.id}: allowedMetrics is missing "${missingFromEntry.join(", ")}" from validForMatrix["${entry.completeness}"]`
                    );
                }
            }

            // 2b: no overlap between allowedMetrics and excludedMetrics
            if (Array.isArray(entry.allowedMetrics) && Array.isArray(entry.excludedMetrics)) {
                const overlap = entry.allowedMetrics.filter((m) => entry.excludedMetrics.includes(m));
                if (overlap.length > 0) {
                    errors.push(
                        `${entry.id}: metrics appear in BOTH allowedMetrics and excludedMetrics: ${overlap.join(", ")}`
                    );
                }
            }

            // 2c: movement-level gate for restricted completeness levels
            if (restrictedLevels.has(entry.completeness)) {
                const allowed = entry.allowedMetrics ?? [...canonical];
                const forbidden = allowed.filter((m) => MOVEMENT_LEVEL_METRICS.has(m));
                if (forbidden.length > 0) {
                    errors.push(
                        `${entry.id} (${entry.completeness}): allowedMetrics includes movement-level metrics: ${forbidden.join(", ")}`
                    );
                }
            }

            if (isVerbose && entry.allowedMetrics) {
                console.log(`    [C7] ${entry.id}: allowed=${entry.allowedMetrics.length}, excluded=${entry.excludedMetrics?.length ?? "?"}`);
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
// C6b — source whitelist: if sourceUrl is present, its domain must be trusted
// ─────────────────────────────────────────────────────────────────────────────

{
    const errors = [];
    const warnings = [];
    for (const entry of allEntries) {
        if (!entry.sourceUrl) continue; // C6 already handles missing sourceUrl
        let domain;
        try {
            domain = new URL(entry.sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
        } catch {
            errors.push(`${entry.id}: sourceUrl is not a valid URL: "${entry.sourceUrl}"`);
            continue;
        }
        // Check raw hostname and www-stripped hostname
        const fullDomain = new URL(entry.sourceUrl).hostname.toLowerCase();
        if (!TRUSTED_SOURCE_DOMAINS.has(fullDomain) && !TRUSTED_SOURCE_DOMAINS.has(domain)) {
            const msg = `${entry.id}: sourceUrl domain "${fullDomain}" is not in the trusted source whitelist`;
            if (isStrict) errors.push(msg); else warnings.push(msg);
        }
    }
    record("C6b-source-whitelist", { pass: errors.length === 0, errors, warnings });
}

// ─────────────────────────────────────────────────────────────────────────────
// C9 — content sanity check: ABC headers present, note count, pitch range
// Stage 3 defense: reject obviously fake/placeholder/corrupt files
// ─────────────────────────────────────────────────────────────────────────────

{
    const errors = [];
    const warnings = [];
    for (const entry of allEntries) {
        if (!entry.abcPath) continue;
        const fullPath = join(abcRoot, entry.abcPath.replace(/^abc\//, ""));
        if (!existsSync(fullPath)) continue; // C2 already reported this

        let abcText;
        try {
            abcText = await readFile(fullPath, "utf-8");
        } catch (e) {
            errors.push(`${entry.id}: could not read file: ${e.message}`);
            continue;
        }

        const sanity = abcSanityCheck(abcText);

        for (const e of sanity.errors)   errors.push(`${entry.id}: ${e}`);
        for (const w of sanity.warnings) warnings.push(`${entry.id}: ${w}`);

        if (isVerbose && (sanity.errors.length > 0 || sanity.warnings.length > 0)) {
            console.log(`    [C9] ${entry.id}: notes=${sanity.noteCount}, pitchClasses=${sanity.pitchClasses.size}`);
        }
    }
    record("C9-content-sanity", { pass: errors.length === 0, errors, warnings });
}

// ─────────────────────────────────────────────────────────────────────────────
// C10 — incipit fingerprint: opening interval match vs. stored fingerprint
// Stage 4 defense: catch "wrong piece filed under famous name"
// Only runs for entries that have incipitFingerprint in file-manifest.json.
// A mismatch is always a WARNING (not error) — transcription variations exist.
// ─────────────────────────────────────────────────────────────────────────────

{
    const warnings = [];
    let checked = 0;
    for (const entry of allEntries) {
        const fp = entry.incipitFingerprint;
        if (!fp?.openingIntervals?.length) continue;
        if (!entry.abcPath) continue;

        const fullPath = join(abcRoot, entry.abcPath.replace(/^abc\//, ""));
        if (!existsSync(fullPath)) continue;

        let abcText;
        try {
            abcText = await readFile(fullPath, "utf-8");
        } catch {
            continue;
        }

        const pitches   = extractOpeningMidiPitches(abcText, fp.openingIntervals.length + 1);
        const actual    = computeIntervals(pitches);
        const threshold = fp.minSimilarityThreshold ?? 0.5;
        const similarity = intervalSimilarity(fp.openingIntervals, actual);
        checked++;

        if (isVerbose) {
            console.log(`    [C10] ${entry.id}: stored=[${fp.openingIntervals}] actual=[${actual}] sim=${similarity.toFixed(2)}`);
        }

        if (similarity < threshold) {
            warnings.push(
                `${entry.id}: incipit mismatch (similarity=${similarity.toFixed(2)}, threshold=${threshold}). ` +
                `Stored=[${fp.openingIntervals.join(",")}] Actual=[${actual.join(",")}]. ` +
                `Verify the ABC file against a public-domain score.`
            );
        }
    }
    if (isVerbose) console.log(`    [C10] Checked ${checked} fingerprinted entries`);
    record("C10-incipit-fingerprint", { pass: true, warnings });
}

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
