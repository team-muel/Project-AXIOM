#!/usr/bin/env node
/**
 * scripts/analyze-reference-corpus.mjs
 *
 * Reference Corpus Analyzer — processes a directory of ABC notation files
 * and produces a corpus-profile.json that can be used by the adapter
 * promotion gate as a reference anchor.
 *
 * Usage (preferred):
 *   node scripts/analyze-reference-corpus.mjs \
 *     --root=config/reference-corpus \
 *     --out=outputs/_system/reference-corpus/profile.json
 *
 * Usage (legacy):
 *   node scripts/analyze-reference-corpus.mjs \
 *     --corpus-dir=config/reference-corpus/abc \
 *     --out=config/reference-corpus/corpus-profile.json
 *
 * Options:
 *   --root=<path>         Root directory; scans root/abc/ for .abc files.
 *                         When provided, also writes by-composer/*.json and summary.json
 *                         next to the --out file.
 *   --corpus-dir=<path>   Explicit directory containing .abc files (legacy; use --root instead)
 *   --out=<path>          Output path for profile.json (required unless --dry-run)
 *   --dry-run             Parse and print stats without writing output
 *   --verbose             Print per-file profile table
 *
 * Multi-file output (when --root is used):
 *   <out-dir>/profile.json          — full corpus profile (same as single-file mode)
 *   <out-dir>/by-composer/<name>.json — per-composer profiles
 *   <out-dir>/summary.json          — high-level operator summary
 *
 * Composer is inferred from the filename prefix: bach_minuet_g.abc → "bach"
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname, extname, basename } from "node:path";
import { existsSync } from "node:fs";

// ─── Corpus manifest helpers ───────────────────────────────────────────────────

/**
 * Loads and returns the corpus-manifest.json from rootArg, or null if absent.
 * Logs a warning on parse error.
 *
 * @param {string|null} root
 * @returns {Promise<object|null>}
 */
async function loadCorpusManifest(root) {
    if (!root) return null;
    const manifestPath = join(root, "corpus-manifest.json");
    if (!existsSync(manifestPath)) return null;
    try {
        return JSON.parse(await readFile(manifestPath, "utf-8"));
    } catch (e) {
        console.warn(`WARN: could not read corpus-manifest.json: ${e.message}`);
        return null;
    }
}

/**
 * Extracts the composer prefix from a filename.
 * "beethoven_moonlight.abc" → "beethoven"
 *
 * @param {string} file  Filename (not full path)
 * @returns {string}
 */
function composerKeyFromFile(file) {
    const namePart = basename(file, ".abc");
    return namePart.includes("_") ? namePart.split("_")[0].toLowerCase() : "unknown";
}

/**
 * Builds a profile group object for a set of perFile entries.
 *
 * @param {string[]} composers
 * @param {string} description
 * @param {{ file: string, profile: object }[]} entries
 * @returns {object}
 */
function buildProfileGroup(composers, description, entries) {
    const profiles = entries.map((e) => e.profile);
    const corpus = computeCorpusProfile(profiles);
    return {
        composers,
        description,
        n: entries.length,
        corpus: { mean: corpus.mean, stddev: corpus.stddev },
    };
}

const { extractStyleProfileFromAbc, computeCorpusProfile } = await import(
    "../dist/core/analyze/referenceStyleProfile.js"
);

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter((a) => a.startsWith("--"))
        .map((a) => {
            const eq = a.indexOf("=");
            if (eq === -1) return [a.slice(2), true];
            return [a.slice(2, eq), a.slice(eq + 1)];
        })
);

// --root sets corpusDir to root/abc/ and enables multi-file output
const rootArg = args["root"] ? resolve(args["root"]) : null;
const corpusDir = rootArg
    ? join(rootArg, "abc")
    : (args["corpus-dir"] ? resolve(args["corpus-dir"]) : null);
const multiFileOutput = rootArg != null;

const outPath = args["out"] ? resolve(args["out"]) : null;
const isDryRun = args["dry-run"] === true;
const isVerbose = args["verbose"] === true;

if (!corpusDir) {
    console.error("ERROR: --root=<path> or --corpus-dir=<path> is required");
    console.error("Usage: node scripts/analyze-reference-corpus.mjs --root=config/reference-corpus --out=...");
    process.exit(1);
}
if (!outPath && !isDryRun) {
    console.error("ERROR: --out=<path> is required (or use --dry-run to skip writing)");
    process.exit(1);
}
if (!existsSync(corpusDir)) {
    console.error(`ERROR: corpus directory does not exist: ${corpusDir}`);
    process.exit(1);
}

// ─── Scan corpus directory ─────────────────────────────────────────────────────

/**
 * Recursively collect .abc files from a directory.
 * Returns entries with { file (basename), path (full), subdir (immediate subdir name or ".") }.
 */
async function scanAbcFiles(dir) {
    const results = [];
    if (!existsSync(dir)) return results;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const subEntries = await readdir(join(dir, entry.name));
            for (const f of subEntries) {
                if (extname(f).toLowerCase() === ".abc") {
                    results.push({ file: f, path: join(dir, entry.name, f), subdir: entry.name });
                }
            }
        } else if (extname(entry.name).toLowerCase() === ".abc") {
            results.push({ file: entry.name, path: join(dir, entry.name), subdir: "." });
        }
    }
    return results.sort((a, b) => a.file.localeCompare(b.file));
}

const scannedEntries = await scanAbcFiles(corpusDir);
const files = scannedEntries.map((e) => e.file);

if (files.length === 0) {
    console.error(`ERROR: no .abc files found in ${corpusDir} (including subdirectories)`);
    process.exit(1);
}

const hasSubdirs = scannedEntries.some((e) => e.subdir !== ".");
console.log(`Analyzing ${files.length} ABC file(s) in ${corpusDir}${hasSubdirs ? " (with subdirectories)" : ""}...`);

// ─── Load corpus manifest (optional) ──────────────────────────────────────────

const manifest = await loadCorpusManifest(rootArg);
if (manifest) {
    const primaryComposers = (manifest.primary?.composers ?? []).join(", ") || "(none)";
    console.log(`Corpus manifest loaded — primary composers: ${primaryComposers}`);
} else if (rootArg) {
    console.log("No corpus-manifest.json found — tiered output will be omitted. Consider adding one to separate primary/technical composers.");
}

// ─── Extract style profile from each file ─────────────────────────────────────

const perFile = [];
const allProfiles = [];
let parseErrors = 0;

for (const entry of scannedEntries) {
    try {
        const abcText = await readFile(entry.path, "utf-8");
        const profile = extractStyleProfileFromAbc(abcText);
        perFile.push({ file: entry.file, subdir: entry.subdir, profile });
        allProfiles.push(profile);

        if (isVerbose) {
            console.log(`\n  ${entry.subdir !== "." ? entry.subdir + "/" : ""}${entry.file}`);
            console.log(`    phrases:     ${profile.meanPhraseLengthMeasures.toFixed(1)} measures mean (regularity CV=${profile.phraseRegularity.toFixed(2)})`);
            console.log(`    pitch range: ${profile.pitchRangeSemitones} semitones, mean=${profile.meanPitchMidi.toFixed(1)} MIDI`);
            console.log(`    climax:      position=${profile.climaxPosition.toFixed(2)}`);
            console.log(`    smoothness:  ${(profile.leapSmoothness * 100).toFixed(0)}% stepwise`);
            console.log(`    density:     ${profile.meanNoteDensityPerMeasure.toFixed(1)} notes/bar`);
            console.log(`    bass ratio:  ${(profile.bassPresenceRatio * 100).toFixed(0)}%`);
            console.log(`    harm rhythm: ${profile.harmonicRhythmProxy.toFixed(1)} pitch-classes/bar`);
            console.log(`    melodic cont:${(profile.melodicContinuity * 100).toFixed(0)}%`);
            console.log(`    harm color:  ${(profile.harmonicColorDepth * 100).toFixed(0)}%`);
            console.log(`    measures:    ${profile.totalMeasures}, notes: ${profile.totalNotes}`);
        }
    } catch (err) {
        console.error(`  WARN: failed to parse ${entry.file}: ${err.message}`);
        parseErrors++;
    }
}

if (allProfiles.length === 0) {
    console.error("ERROR: all files failed to parse");
    process.exit(1);
}

// ─── Aggregate corpus profile ──────────────────────────────────────────────────

const corpusProfile = computeCorpusProfile(allProfiles);

// ─── Build tiered profiles from manifest and/or subdirectory structure ──────────

/**
 * Resolve lineage group for a perFile entry.
 * Priority: subdirectory name ("beethoven", "schubert", "theory_general")
 * Fallback: composer key from filename prefix.
 */
function resolveLineageKey(entry) {
    if (entry.subdir && entry.subdir !== ".") {
        return entry.subdir.toLowerCase();
    }
    return composerKeyFromFile(entry.file);
}

// Lineage-split groups (new)
/** @type {{ n: number, corpus: object }|null} */
let lineageBeethovenGroup = null;
/** @type {{ n: number, corpus: object }|null} */
let lineageSchubertGroup = null;
/** @type {{ n: number, corpus: object }|null} */
let lineageCombinedGroup = null;
/** @type {{ n: number, corpus: object }|null} */
let lineageGeneralTheoryGroup = null;

// Manifest-tiered groups (for backward-compat primary/technical output in profile.json)
/** @type {{ composers: string[], description: string, n: number, corpus: object }|null} */
let primaryGroup = null;
/** @type {Record<string, { composers: string[], description: string, n: number, corpus: object }>} */
let technicalGroups = {};

// Build subdirectory-based lineage groups
const beethovenEntries = perFile.filter((e) => resolveLineageKey(e) === "beethoven");
const schubertEntries  = perFile.filter((e) => resolveLineageKey(e) === "schubert");
const theoryEntries    = perFile.filter((e) => resolveLineageKey(e) === "theory_general");

if (beethovenEntries.length > 0) {
    const g = buildProfileGroup(["beethoven"], "Beethoven — AXIOM structural DNA", beethovenEntries);
    lineageBeethovenGroup = g;
    console.log(`Beethoven profile: ${g.n} works`);
}
if (schubertEntries.length > 0) {
    const g = buildProfileGroup(["schubert"], "Schubert — AXIOM lyrical DNA", schubertEntries);
    lineageSchubertGroup = g;
    console.log(`Schubert profile: ${g.n} works`);
}
const primaryLineageEntries = [...beethovenEntries, ...schubertEntries];
if (primaryLineageEntries.length > 0) {
    const g = buildProfileGroup(["beethoven", "schubert"], "Beethoven+Schubert lineage — R-01 primary anchor", primaryLineageEntries);
    lineageCombinedGroup = g;
}
if (theoryEntries.length > 0) {
    const g = buildProfileGroup(["bach", "mozart", "chopin", "brahms"], "General theory corpus (Bach/Mozart/Chopin/Brahms) — auxiliary", theoryEntries);
    lineageGeneralTheoryGroup = g;
    console.log(`General theory profile: ${g.n} works`);
}

if (manifest) {
    // Primary group: Beethoven + Schubert (AXIOM aesthetic DNA)
    if (manifest.primary?.composers?.length) {
        const primarySet = new Set(manifest.primary.composers);
        const primaryEntries = perFile.filter((e) =>
            primarySet.has(composerKeyFromFile(e.file)) || primarySet.has(resolveLineageKey(e))
        );
        if (primaryEntries.length > 0) {
            primaryGroup = buildProfileGroup(
                manifest.primary.composers,
                manifest.primary.description ?? "AXIOM primary aesthetic identity",
                primaryEntries,
            );
            if (manifest.primary.note) primaryGroup.note = manifest.primary.note;
            if (!beethovenEntries.length && !schubertEntries.length) {
                // Only log if we didn't already log from subdirectory grouping
                console.log(`Primary profile: ${primaryEntries.length} works (${manifest.primary.composers.join(", ")})`);
            }
        } else {
            console.warn(`WARN: primary composers declared in manifest but no matching ABC files found (${manifest.primary.composers.join(", ")})`);
        }
    }

    // Technical groups: Bach, Mozart, Chopin, Brahms (skill references, not identity)
    if (manifest.technical) {
        for (const [role, roleDef] of Object.entries(manifest.technical)) {
            if (!roleDef.composers?.length) continue;
            const roleSet = new Set(roleDef.composers);
            const roleEntries = perFile.filter((e) =>
                roleSet.has(composerKeyFromFile(e.file)) || roleSet.has(resolveLineageKey(e))
            );
            if (roleEntries.length > 0) {
                const group = buildProfileGroup(roleDef.composers, roleDef.description ?? role, roleEntries);
                if (roleDef.note) group.note = roleDef.note;
                technicalGroups[role] = group;
            }
        }
        if (Object.keys(technicalGroups).length > 0) {
            console.log(`Technical profiles: ${Object.entries(technicalGroups).map(([r, g]) => `${r}(${g.n})`).join(", ")}`);
        }
    }
}

// ─── Print summary ─────────────────────────────────────────────────────────────

const primaryLabel = primaryGroup ? ` — primary: ${primaryGroup.n} works (${primaryGroup.composers.join(", ")})` : "";
console.log(`\nCorpus summary (${corpusProfile.n} total works${primaryLabel}, ${parseErrors} parse errors):`);
if (primaryGroup) {
    console.log(`  ★ Primary (R-01 anchor) — ${primaryGroup.n} works:`);
    console.log(`    mean phrase length:  ${primaryGroup.corpus.mean.meanPhraseLengthMeasures.toFixed(2)} measures`);
    console.log(`    pitch range:         ${primaryGroup.corpus.mean.pitchRangeSemitones.toFixed(1)} semitones`);
    console.log(`    harmonic rhythm:     ${primaryGroup.corpus.mean.harmonicRhythmProxy.toFixed(2)} pitch-classes/bar`);
    console.log(`  ─ Global (all ${corpusProfile.n} works):`);
} else {
    console.log(`  (No corpus-manifest.json → global average only; R-01 gate will use this)`);
}
console.log(`  mean phrase length:  ${corpusProfile.mean.meanPhraseLengthMeasures.toFixed(2)} measures`);
console.log(`  phrase regularity:   ${corpusProfile.mean.phraseRegularity.toFixed(3)} CV`);
console.log(`  climax position:     ${corpusProfile.mean.climaxPosition.toFixed(3)}`);
console.log(`  pitch range:         ${corpusProfile.mean.pitchRangeSemitones.toFixed(1)} semitones`);
console.log(`  mean pitch:          ${corpusProfile.mean.meanPitchMidi.toFixed(1)} MIDI`);
console.log(`  leap smoothness:     ${(corpusProfile.mean.leapSmoothness * 100).toFixed(1)}%`);
console.log(`  note density:        ${corpusProfile.mean.meanNoteDensityPerMeasure.toFixed(2)} notes/bar`);
console.log(`  bass presence:       ${(corpusProfile.mean.bassPresenceRatio * 100).toFixed(1)}%`);
console.log(`  harmonic rhythm:     ${corpusProfile.mean.harmonicRhythmProxy.toFixed(2)} pitch-classes/bar`);
if (lineageCombinedGroup) {
    console.log(`  ★ Lineage (B+S):     melodicCont=${round2(lineageCombinedGroup.corpus.mean.melodicContinuity)}, harmColor=${round2(lineageCombinedGroup.corpus.mean.harmonicColorDepth)}`);
}

// ─── Write output ──────────────────────────────────────────────────────────────

if (isDryRun) {
    console.log("\n[dry-run] Skipping file write.");
    process.exit(0);
}

const mainOutput = {
    generatedAt: new Date().toISOString(),
    // ── Tiered identity taxonomy ──────────────────────────────────────────────
    // `primary`   — Beethoven + Schubert: AXIOM's aesthetic DNA.
    //               The R-01 gate in evaluate-notagen-adapter-promotion.mjs uses
    //               this profile exclusively. Absent when no manifest is found.
    // `technical` — Skill-specific reference groups (Bach, Mozart, Chopin, Brahms).
    //               Used for per-dimension benchmarks, NOT for identity scoring.
    // `global`    — All composers merged. Kept for backward compatibility only.
    //               Do NOT use for referenceDistanceScore — it blurs identity.
    ...(primaryGroup ? { primary: primaryGroup } : {}),
    ...(Object.keys(technicalGroups).length > 0 ? { technical: technicalGroups } : {}),
    // ── Backward-compatible root fields ───────────────────────────────────────
    n: corpusProfile.n,
    parseErrors,
    corpus: {
        mean: corpusProfile.mean,
        stddev: corpusProfile.stddev,
    },
    perFile: perFile.map(({ file, subdir, profile }) => ({ file, subdir, profile })),
};

const outDir = dirname(outPath);
await mkdir(outDir, { recursive: true });
await writeFile(outPath, JSON.stringify(mainOutput, null, 2), "utf-8");
console.log(`\nCorpus profile written to: ${outPath}`);

// ─── Multi-file output (when --root is used) ───────────────────────────────────

if (multiFileOutput) {
    // ── Lineage-split profiles (new, separate files) ──────────────────────────
    const buildSplitOutput = (label, group) => ({
        generatedAt: mainOutput.generatedAt,
        label,
        n: group.n,
        composers: group.composers,
        description: group.description,
        mean: group.corpus.mean,
        stddev: group.corpus.stddev,
    });

    if (lineageBeethovenGroup) {
        const p = join(outDir, "profile-beethoven.json");
        await writeFile(p, JSON.stringify(buildSplitOutput("beethoven", lineageBeethovenGroup), null, 2), "utf-8");
        console.log(`Beethoven profile written to: ${p}`);
    }
    if (lineageSchubertGroup) {
        const p = join(outDir, "profile-schubert.json");
        await writeFile(p, JSON.stringify(buildSplitOutput("schubert", lineageSchubertGroup), null, 2), "utf-8");
        console.log(`Schubert profile written to: ${p}`);
    }
    if (lineageCombinedGroup) {
        const p = join(outDir, "profile-beethoven-schubert-lineage.json");
        await writeFile(p, JSON.stringify(buildSplitOutput("beethoven-schubert-lineage", lineageCombinedGroup), null, 2), "utf-8");
        console.log(`Lineage profile written to: ${p}`);
    }
    if (lineageGeneralTheoryGroup) {
        const p = join(outDir, "profile-general-theory.json");
        await writeFile(p, JSON.stringify(buildSplitOutput("general-theory", lineageGeneralTheoryGroup), null, 2), "utf-8");
        console.log(`General theory profile written to: ${p}`);
    }

    // Group per-file entries by composer prefix (e.g., "bach_minuet.abc" → "bach")
    const byComposerMap = new Map();
    for (const entry of perFile) {
        const namePart = basename(entry.file, ".abc");
        const composerKey = namePart.includes("_") ? namePart.split("_")[0].toLowerCase() : "unknown";
        if (!byComposerMap.has(composerKey)) byComposerMap.set(composerKey, []);
        byComposerMap.get(composerKey).push(entry);
    }

    // Write by-composer/*.json
    const byComposerDir = join(outDir, "by-composer");
    await mkdir(byComposerDir, { recursive: true });
    const composerNames = [...byComposerMap.keys()].sort();
    for (const composer of composerNames) {
        const works = byComposerMap.get(composer);
        const profiles = works.map((w) => w.profile);
        const composerCorpus = computeCorpusProfile(profiles);
        const composerOutput = {
            composer,
            n: works.length,
            works,
            corpusProfile: {
                mean: composerCorpus.mean,
                stddev: composerCorpus.stddev,
            },
        };
        const composerPath = join(byComposerDir, `${composer}.json`);
        await writeFile(composerPath, JSON.stringify(composerOutput, null, 2), "utf-8");
        if (isVerbose) console.log(`  by-composer/${composer}.json (${works.length} works)`);
    }
    console.log(`By-composer profiles written to: ${byComposerDir}/`);

    // Write summary.json
    const composerCounts = Object.fromEntries(
        composerNames.map((c) => [c, byComposerMap.get(c).length])
    );
    const summary = {
        generatedAt: mainOutput.generatedAt,
        n: corpusProfile.n,
        parseErrors,
        composers: composerNames,
        composerCounts,
        lineageSplit: {
            beethoven:    lineageBeethovenGroup  ? { n: lineageBeethovenGroup.n  } : null,
            schubert:     lineageSchubertGroup   ? { n: lineageSchubertGroup.n   } : null,
            lineage:      lineageCombinedGroup   ? { n: lineageCombinedGroup.n   } : null,
            generalTheory: lineageGeneralTheoryGroup ? { n: lineageGeneralTheoryGroup.n } : null,
        },
        splitProfiles: {
            beethoven:    lineageBeethovenGroup  ? "profile-beethoven.json"                  : null,
            schubert:     lineageSchubertGroup   ? "profile-schubert.json"                   : null,
            lineage:      lineageCombinedGroup   ? "profile-beethoven-schubert-lineage.json" : null,
            generalTheory: lineageGeneralTheoryGroup ? "profile-general-theory.json"         : null,
        },
        corpusMeanPitchMidi:              round2(corpusProfile.mean.meanPitchMidi),
        corpusMeanPhraseLengthMeasures:   round2(corpusProfile.mean.meanPhraseLengthMeasures),
        corpusMeanLeapSmoothness:         round2(corpusProfile.mean.leapSmoothness),
        corpusMeanNoteDensityPerMeasure:  round2(corpusProfile.mean.meanNoteDensityPerMeasure),
        corpusMeanBassPresenceRatio:      round2(corpusProfile.mean.bassPresenceRatio),
        corpusMeanPhraseRegularity:       round2(corpusProfile.mean.phraseRegularity),
        corpusMeanClimax:                 round2(corpusProfile.mean.climaxPosition),
        corpusMeanHarmonicRhythm:         round2(corpusProfile.mean.harmonicRhythmProxy),
    };
    const summaryPath = join(outDir, "summary.json");
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
    console.log(`Summary written to: ${summaryPath}`);
}

function round2(v) { return Math.round((v ?? 0) * 100) / 100; }
