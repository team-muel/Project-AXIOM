#!/usr/bin/env node
/**
 * scripts/analyze-reference-corpus.mjs
 *
 * Reference Corpus Analyzer — processes a directory of ABC notation files
 * and produces a corpus-profile.json that can be used by the adapter
 * promotion gate as a reference anchor.
 *
 * Usage:
 *   node scripts/analyze-reference-corpus.mjs \
 *     --corpus-dir=config/reference-corpus/abc \
 *     --out=config/reference-corpus/corpus-profile.json
 *
 * Options:
 *   --corpus-dir=<path>   Directory containing .abc files (required)
 *   --out=<path>          Output path for corpus-profile.json (required)
 *   --dry-run             Parse and print stats without writing output
 *   --verbose             Print per-file profile table
 *
 * Output format (corpus-profile.json):
 *   {
 *     "generatedAt": "...",
 *     "n": 12,
 *     "corpus": { "mean": {...}, "stddev": {...} },
 *     "perFile": [{ "file": "bach_bwv772.abc", "profile": {...} }, ...]
 *   }
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
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

const corpusDir = args["corpus-dir"] ? resolve(args["corpus-dir"]) : null;
const outPath = args["out"] ? resolve(args["out"]) : null;
const isDryRun = args["dry-run"] === true;
const isVerbose = args["verbose"] === true;

if (!corpusDir) {
    console.error("ERROR: --corpus-dir=<path> is required");
    console.error("Usage: node scripts/analyze-reference-corpus.mjs --corpus-dir=... --out=...");
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

const output = {
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
await writeFile(outPath, JSON.stringify(output, null, 2), "utf-8");
console.log(`\nCorpus profile written to: ${outPath}`);
