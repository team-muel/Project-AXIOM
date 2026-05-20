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

const files = (await readdir(corpusDir))
    .filter((f) => extname(f).toLowerCase() === ".abc")
    .sort();

if (files.length === 0) {
    console.error(`ERROR: no .abc files found in ${corpusDir}`);
    process.exit(1);
}

console.log(`Analyzing ${files.length} ABC file(s) in ${corpusDir}...`);

// ─── Extract style profile from each file ─────────────────────────────────────

const perFile = [];
const allProfiles = [];
let parseErrors = 0;

for (const file of files) {
    const filePath = join(corpusDir, file);
    try {
        const abcText = await readFile(filePath, "utf-8");
        const profile = extractStyleProfileFromAbc(abcText);
        perFile.push({ file, profile });
        allProfiles.push(profile);

        if (isVerbose) {
            console.log(`\n  ${file}`);
            console.log(`    phrases:     ${profile.meanPhraseLengthMeasures.toFixed(1)} measures mean (regularity CV=${profile.phraseRegularity.toFixed(2)})`);
            console.log(`    pitch range: ${profile.pitchRangeSemitones} semitones, mean=${profile.meanPitchMidi.toFixed(1)} MIDI`);
            console.log(`    climax:      position=${profile.climaxPosition.toFixed(2)}`);
            console.log(`    smoothness:  ${(profile.leapSmoothness * 100).toFixed(0)}% stepwise`);
            console.log(`    density:     ${profile.meanNoteDensityPerMeasure.toFixed(1)} notes/bar`);
            console.log(`    bass ratio:  ${(profile.bassPresenceRatio * 100).toFixed(0)}%`);
            console.log(`    harm rhythm: ${profile.harmonicRhythmProxy.toFixed(1)} pitch-classes/bar`);
            console.log(`    measures:    ${profile.totalMeasures}, notes: ${profile.totalNotes}`);
        }
    } catch (err) {
        console.error(`  WARN: failed to parse ${file}: ${err.message}`);
        parseErrors++;
    }
}

if (allProfiles.length === 0) {
    console.error("ERROR: all files failed to parse");
    process.exit(1);
}

// ─── Aggregate corpus profile ──────────────────────────────────────────────────

const corpusProfile = computeCorpusProfile(allProfiles);

// ─── Print summary ─────────────────────────────────────────────────────────────

console.log(`\nCorpus summary (${corpusProfile.n} works, ${parseErrors} parse errors):`);
console.log(`  mean phrase length:  ${corpusProfile.mean.meanPhraseLengthMeasures.toFixed(2)} measures`);
console.log(`  phrase regularity:   ${corpusProfile.mean.phraseRegularity.toFixed(3)} CV`);
console.log(`  climax position:     ${corpusProfile.mean.climaxPosition.toFixed(3)}`);
console.log(`  pitch range:         ${corpusProfile.mean.pitchRangeSemitones.toFixed(1)} semitones`);
console.log(`  mean pitch:          ${corpusProfile.mean.meanPitchMidi.toFixed(1)} MIDI`);
console.log(`  leap smoothness:     ${(corpusProfile.mean.leapSmoothness * 100).toFixed(1)}%`);
console.log(`  note density:        ${corpusProfile.mean.meanNoteDensityPerMeasure.toFixed(2)} notes/bar`);
console.log(`  bass presence:       ${(corpusProfile.mean.bassPresenceRatio * 100).toFixed(1)}%`);
console.log(`  harmonic rhythm:     ${corpusProfile.mean.harmonicRhythmProxy.toFixed(2)} pitch-classes/bar`);

// ─── Write output ──────────────────────────────────────────────────────────────

if (isDryRun) {
    console.log("\n[dry-run] Skipping file write.");
    process.exit(0);
}

const mainOutput = {
    generatedAt: new Date().toISOString(),
    n: corpusProfile.n,
    parseErrors,
    corpus: {
        mean: corpusProfile.mean,
        stddev: corpusProfile.stddev,
    },
    perFile,
};

const outDir = dirname(outPath);
await mkdir(outDir, { recursive: true });
await writeFile(outPath, JSON.stringify(mainOutput, null, 2), "utf-8");
console.log(`\nCorpus profile written to: ${outPath}`);

// ─── Multi-file output (when --root is used) ───────────────────────────────────

if (multiFileOutput) {
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
