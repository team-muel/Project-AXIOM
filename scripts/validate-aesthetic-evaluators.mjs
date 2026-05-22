/**
 * validate-aesthetic-evaluators.mjs
 *
 * Validates AXIOM aesthetic evaluators by analyzing the reference corpus
 * and checking whether Beethoven and Schubert groups are meaningfully
 * distinguishable on key musical dimensions.
 *
 * This script does NOT depend on the compiled TypeScript dist. It implements
 * a self-contained ABC parser that extracts the same 15 StyleProfile dimensions
 * defined in src/core/analyze/referenceStyleProfile.ts.
 *
 * Output:
 *   - stdout: human-readable report
 *   - --out=<path>: machine-readable JSON (optional)
 *
 * Usage:
 *   node scripts/validate-aesthetic-evaluators.mjs
 *   node scripts/validate-aesthetic-evaluators.mjs --corpus=config/reference-corpus/abc --out=outputs/_system/reference-corpus/aesthetic-validation.json
 *   node scripts/validate-aesthetic-evaluators.mjs --verbose
 *
 * Interpretation:
 *   discriminationScore (per dimension) = |Δmean| / pooledStddev
 *   A score > 0.5 suggests the dimension can meaningfully distinguish the two groups.
 *   A score > 1.0 indicates strong separation (effect size Cohen's d > 1).
 */

import fs from "node:fs";
import path from "node:path";

// ── CLI ───────────────────────────────────────────────────────────────────────

function readOption(name) {
    const prefix = `--${name}=`;
    const prefixed = process.argv.find((e) => e.startsWith(prefix));
    return prefixed ? prefixed.slice(prefix.length) : undefined;
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }

const corpusRoot = readOption("corpus") ?? "config/reference-corpus/abc";
const outPath    = readOption("out");
const verbose    = hasFlag("verbose");

// ── ABC parser ────────────────────────────────────────────────────────────────

const NOTE_SEMITONES = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
    c: 12, d: 14, e: 16, f: 17, g: 19, a: 21, b: 23,
};
// ABC middle-C = MIDI 60. Base for unadorned C (octave 4) = 60.
const ABC_BASE_MIDI = 60;

/** Parse ABC notation text into an array of { pitch, beats, measureIndex } objects. */
function parseAbcToNotes(abcText) {
    const notes = [];
    const lines = abcText.split(/\r?\n/);

    // Extract header fields
    let meterNum = 4, meterDen = 4;
    let defaultBeats = 0.5; // L field default

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("M:")) {
            const m = trimmed.slice(2).trim().match(/(\d+)\/(\d+)/);
            if (m) { meterNum = parseInt(m[1]); meterDen = parseInt(m[2]); }
        }
        if (trimmed.startsWith("L:")) {
            const l = trimmed.slice(2).trim().match(/(\d+)\/(\d+)/);
            if (l) defaultBeats = parseInt(l[1]) / parseInt(l[2]);
        }
    }

    const beatsPerMeasure = (meterNum / meterDen) * 4; // quarter-note units

    let measureIndex = 0;
    let currentBeats = 0;
    let inHeader = true;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Skip header lines (field lines before body)
        if (/^[A-Za-z]:/.test(trimmed)) {
            if (trimmed.startsWith("K:")) inHeader = false;
            continue;
        }
        if (inHeader) continue;

        const body = trimmed.replace(/\|:/g, "").replace(/:\|/g, "").replace(/\|\|/g, "|");

        let i = 0;
        while (i < body.length) {
            const ch = body[i];

            // Bar line
            if (ch === "|") {
                measureIndex++;
                currentBeats = 0;
                i++;
                continue;
            }

            // Skip lyrics, chord symbols, dynamics, etc.
            if (ch === '"' || ch === "!" || ch === "[") {
                const close = ch === "[" ? "]" : ch === '"' ? '"' : "!";
                if (ch === "[") {
                    // Could be chord [CEG] or bar marker [|
                    const closeIdx = body.indexOf("]", i + 1);
                    if (closeIdx === -1) { i++; continue; }
                    // Parse first note of chord
                    const chordBody = body.slice(i + 1, closeIdx);
                    const noteM = chordBody.match(/^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([',]*)([\d]*\/[\d]*|[\d]+)?/);
                    if (noteM) {
                        const n = parseNoteStr(noteM[0], defaultBeats, measureIndex);
                        if (n) notes.push(n);
                        currentBeats += n?.beats ?? defaultBeats;
                    }
                    i = closeIdx + 1;
                    continue;
                } else {
                    const closeIdx = body.indexOf(close, i + 1);
                    i = closeIdx === -1 ? i + 1 : closeIdx + 1;
                    continue;
                }
            }

            // Rest
            if (ch === "z" || ch === "x") {
                i++;
                const { beats, end } = parseDuration(body, i, defaultBeats);
                notes.push({ pitch: -1, beats, measureIndex });
                currentBeats += beats;
                i = end;
                continue;
            }

            // Grace notes: {abc} — skip
            if (ch === "{") {
                const closeIdx = body.indexOf("}", i);
                i = closeIdx === -1 ? i + 1 : closeIdx + 1;
                continue;
            }

            // Accidentals
            let accidental = 0;
            let ci = i;
            if (ch === "^") {
                accidental = body[ci + 1] === "^" ? (ci++, 2) : 1;
                ci++;
            } else if (ch === "_") {
                accidental = body[ci + 1] === "_" ? (ci++, -2) : -1;
                ci++;
            } else if (ch === "=") {
                ci++;
            } else {
                ci = i;
            }

            const noteCh = body[ci] ?? "";
            if (!Object.prototype.hasOwnProperty.call(NOTE_SEMITONES, noteCh)) {
                i++;
                continue;
            }
            ci++;

            // Octave
            let octaveShift = 0;
            while (ci < body.length && body[ci] === "'") { octaveShift++; ci++; }
            while (ci < body.length && body[ci] === ",") { octaveShift--; ci++; }

            // Duration
            const { beats, end } = parseDuration(body, ci, defaultBeats);
            ci = end;

            const semitone = NOTE_SEMITONES[noteCh] ?? 0;
            const midi = ABC_BASE_MIDI + semitone + accidental + octaveShift * 12;
            notes.push({ pitch: midi, beats, measureIndex });
            currentBeats += beats;
            i = ci;
        }
    }

    return notes;
}

function parseDuration(s, start, defaultBeats) {
    let i = start;
    let num = 0, den = 0;
    while (i < s.length && s[i] >= "0" && s[i] <= "9") { num = num * 10 + parseInt(s[i]); i++; }
    if (s[i] === "/") {
        i++;
        while (i < s.length && s[i] >= "0" && s[i] <= "9") { den = den * 10 + parseInt(s[i]); i++; }
    }
    let beats;
    if (num === 0 && den === 0) beats = defaultBeats;
    else if (num > 0 && den === 0) beats = defaultBeats * num;
    else if (num === 0 && den > 0) beats = defaultBeats / den;
    else beats = defaultBeats * num / den;
    return { beats, end: i };
}

function parseNoteStr(token, defaultBeats, measureIndex) {
    const m = token.match(/^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([',]*)([\d]*\/[\d]*|[\d]+)?/);
    if (!m) return null;
    const acc = m[1] ?? "";
    const noteCh = m[2];
    const octMods = m[3] ?? "";
    let accidental = 0;
    if (acc.startsWith("^^")) accidental = 2;
    else if (acc.startsWith("^")) accidental = 1;
    else if (acc.startsWith("__")) accidental = -2;
    else if (acc.startsWith("_")) accidental = -1;
    const octaveShift = (octMods.match(/'/g) ?? []).length - (octMods.match(/,/g) ?? []).length;
    const { beats } = parseDuration(m[4] ?? "", 0, defaultBeats);
    const semitone = NOTE_SEMITONES[noteCh] ?? 0;
    const midi = ABC_BASE_MIDI + semitone + accidental + octaveShift * 12;
    return { pitch: midi, beats, measureIndex };
}

// ── Feature extraction ────────────────────────────────────────────────────────

/**
 * Counts accidentals (^ and _) in raw ABC text (proxy for modal mixture).
 * Excludes key signature line.
 */
function countAccidentals(abcText) {
    let count = 0;
    for (const line of abcText.split(/\r?\n/)) {
        if (line.trim().startsWith("K:") || line.trim().startsWith("M:") ||
            line.trim().startsWith("L:") || line.trim().startsWith("T:") ||
            line.trim().startsWith("C:") || line.trim().startsWith("X:")) continue;
        for (const ch of line) {
            if (ch === "^" || ch === "_") count++;
        }
    }
    return count;
}

/**
 * Extracts StyleProfile-compatible dimensions from an ABC file.
 * Dimensions mirror src/core/analyze/referenceStyleProfile.ts.
 */
function extractProfile(abcText) {
    const notes = parseAbcToNotes(abcText);
    const pitchNotes = notes.filter((n) => n.pitch >= 0);

    if (pitchNotes.length === 0) {
        return null;
    }

    const totalMeasures = Math.max(...notes.map((n) => n.measureIndex)) + 1;

    // 1. Phrase lengths (in measures) — heuristic: phrase ends at rest ≥ 0.5 beats
    const phraseLengths = [];
    let phraseStart = 0, inPhrase = false, lastMeasure = 0;
    for (const n of notes) {
        if (n.pitch < 0 && n.beats >= 0.5) {
            if (inPhrase && n.measureIndex > phraseStart) {
                phraseLengths.push(n.measureIndex - phraseStart + 1);
            }
            phraseStart = n.measureIndex;
            inPhrase = false;
        } else if (n.pitch >= 0) {
            if (!inPhrase) { phraseStart = n.measureIndex; inPhrase = true; }
            lastMeasure = n.measureIndex;
        }
    }
    if (inPhrase) phraseLengths.push(lastMeasure - phraseStart + 1);
    const effectivePhrases = phraseLengths.length > 0 ? phraseLengths : [totalMeasures];

    const phraseMean = effectivePhrases.reduce((a, b) => a + b, 0) / effectivePhrases.length;
    const phraseSD = stddev(effectivePhrases, phraseMean);
    const phraseRegularity = phraseMean > 0 ? phraseSD / phraseMean : 0;
    const maxPhrase = Math.max(...effectivePhrases);
    const phraseBreath = phraseMean > 0 ? Math.min(1, (maxPhrase - phraseMean) / (phraseMean + 1)) : 0;
    const lyricExpansionScore = Math.min(1, phraseSD / (phraseMean + 1));

    // 2. Pitch properties
    const pitches = pitchNotes.map((n) => n.pitch);
    const pitchMin = Math.min(...pitches);
    const pitchMax = Math.max(...pitches);
    const pitchRange = pitchMax - pitchMin;
    const meanPitch = pitches.reduce((a, b) => a + b, 0) / pitches.length;

    // Climax position
    let climaxPos = 0.618;
    let maxPitch = -Infinity;
    for (const n of pitchNotes) {
        if (n.pitch > maxPitch) { maxPitch = n.pitch; climaxPos = (n.measureIndex + 0.5) / totalMeasures; }
    }

    // 3. Leap smoothness
    const intervals = [];
    for (let i = 1; i < pitches.length; i++) {
        intervals.push(Math.abs(pitches[i] - pitches[i - 1]));
    }
    const stepwise = intervals.filter((d) => d <= 2).length;
    const leapSmoothness = intervals.length > 0 ? stepwise / intervals.length : 0.65;

    // Melodic continuity: stepwise in upper register (pitch > meanPitch)
    const upperIntervals = [];
    for (let i = 1; i < pitchNotes.length; i++) {
        if (pitchNotes[i].pitch > meanPitch && pitchNotes[i - 1].pitch > meanPitch) {
            upperIntervals.push(Math.abs(pitchNotes[i].pitch - pitchNotes[i - 1].pitch));
        }
    }
    const melodicContinuity = upperIntervals.length > 0
        ? upperIntervals.filter((d) => d <= 2).length / upperIntervals.length
        : leapSmoothness;

    // 4. Note density and bass presence
    const totalNotes = pitchNotes.length;
    const bassNotes = pitchNotes.filter((n) => n.pitch < 60).length;
    const bassPresenceRatio = totalNotes > 0 ? bassNotes / totalNotes : 0.3;
    const meanNoteDensityPerMeasure = totalMeasures > 0 ? totalNotes / totalMeasures : 0;

    // 5. Harmonic rhythm proxy: distinct pitch classes per measure (averaged)
    const byMeasure = new Map();
    for (const n of pitchNotes) {
        if (!byMeasure.has(n.measureIndex)) byMeasure.set(n.measureIndex, new Set());
        byMeasure.get(n.measureIndex).add(n.pitch % 12);
    }
    const distinctPerMeasure = [...byMeasure.values()].map((s) => s.size);
    const harmonicRhythmProxy = distinctPerMeasure.length > 0
        ? distinctPerMeasure.reduce((a, b) => a + b, 0) / distinctPerMeasure.length
        : 4;

    // 6. Harmonic color depth: total distinct pitch classes / 12
    const allPitchClasses = new Set(pitchNotes.map((n) => n.pitch % 12));
    const harmonicColorDepth = allPitchClasses.size / 12;

    // 7. Mediant modulation proxy: fraction of bass leaps that are 3rds (3–4 semitones)
    const bassNotesList = pitchNotes.filter((n) => n.pitch < 60);
    const bassLeaps = [];
    for (let i = 1; i < bassNotesList.length; i++) {
        bassLeaps.push(Math.abs(bassNotesList[i].pitch - bassNotesList[i - 1].pitch));
    }
    const mediantLeaps = bassLeaps.filter((d) => d === 3 || d === 4).length;
    const mediantModulationScore = bassLeaps.length > 0 ? mediantLeaps / bassLeaps.length : 0.2;

    // 8. Major/minor ambiguity: accidental density
    const accidentalCount = countAccidentals(abcText);
    const majorMinorAmbiguityScore = Math.min(1, accidentalCount / Math.max(1, totalNotes));

    return {
        // Classical dimensions
        meanPhraseLengthMeasures: phraseMean,
        phraseRegularity,
        climaxPosition: climaxPos,
        pitchRangeSemitones: pitchRange,
        meanPitchMidi: meanPitch,
        leapSmoothness,
        meanNoteDensityPerMeasure,
        bassPresenceRatio,
        harmonicRhythmProxy,
        // Schubert-lineage dimensions
        melodicContinuity,
        phraseBreath,
        harmonicColorDepth,
        mediantModulationScore,
        lyricExpansionScore,
        majorMinorAmbiguityScore,
        // Metadata
        totalMeasures,
        totalNotes,
        accidentalCount,
    };
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function mean(xs) { return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length; }
function stddev(xs, m) {
    if (xs.length < 2) return 0;
    const mu = m ?? mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / xs.length);
}
function round3(v) { return Math.round(v * 1000) / 1000; }

function groupStats(profiles, dimension) {
    const values = profiles.map((p) => p[dimension]).filter((v) => typeof v === "number" && isFinite(v));
    if (values.length === 0) return null;
    const m = mean(values);
    const s = stddev(values, m);
    return { mean: round3(m), stddev: round3(s), n: values.length };
}

/**
 * Cohen's d-like discrimination score: |Δmean| / pooledStddev
 * Pooled stddev = sqrt((s1²·(n1-1) + s2²·(n2-1)) / (n1+n2-2)) or simple average if n<2
 */
function discriminationScore(statsA, statsB) {
    if (!statsA || !statsB) return null;
    const pooled = (statsA.n + statsB.n > 2)
        ? Math.sqrt(((statsA.stddev ** 2) * Math.max(1, statsA.n - 1) + (statsB.stddev ** 2) * Math.max(1, statsB.n - 1)) / (statsA.n + statsB.n - 2))
        : Math.max(statsA.stddev, statsB.stddev, 0.001);
    return round3(Math.abs(statsA.mean - statsB.mean) / Math.max(pooled, 0.001));
}

// ── Main ──────────────────────────────────────────────────────────────────────

function loadGroup(groupDir) {
    if (!fs.existsSync(groupDir)) return [];
    return fs.readdirSync(groupDir)
        .filter((f) => f.endsWith(".abc"))
        .map((f) => {
            const filePath = path.join(groupDir, f);
            const text = fs.readFileSync(filePath, "utf8");
            const profile = extractProfile(text);
            if (verbose && profile) {
                console.log(`  [${f}] measures=${profile.totalMeasures} notes=${profile.totalNotes} leapSmooth=${round3(profile.leapSmoothness)} accDensity=${round3(profile.majorMinorAmbiguityScore)}`);
            }
            return { file: f, profile };
        })
        .filter((e) => e.profile !== null);
}

const DIMENSIONS = [
    { key: "meanPhraseLengthMeasures",   label: "meanPhraseLengthMeasures",  note: "longer→Schubert" },
    { key: "phraseRegularity",           label: "phraseRegularity",          note: "irregular→Beethoven contrast" },
    { key: "climaxPosition",             label: "climaxPosition",            note: "" },
    { key: "pitchRangeSemitones",        label: "pitchRangeSemitones",       note: "wider→Beethoven" },
    { key: "meanPitchMidi",              label: "meanPitchMidi",             note: "" },
    { key: "leapSmoothness",             label: "leapSmoothness",            note: "higher→Schubert melody" },
    { key: "meanNoteDensityPerMeasure",  label: "meanNoteDensityPerMeasure", note: "" },
    { key: "bassPresenceRatio",          label: "bassPresenceRatio",         note: "" },
    { key: "harmonicRhythmProxy",        label: "harmonicRhythmProxy",       note: "" },
    { key: "melodicContinuity",          label: "melodicContinuity",         note: "higher→Schubert" },
    { key: "phraseBreath",               label: "phraseBreath",              note: "higher→Schubert" },
    { key: "harmonicColorDepth",         label: "harmonicColorDepth",        note: "higher→Schubert" },
    { key: "mediantModulationScore",     label: "mediantModulationScore",    note: "higher→Schubert" },
    { key: "lyricExpansionScore",        label: "lyricExpansionScore",       note: "higher→Schubert" },
    { key: "majorMinorAmbiguityScore",   label: "majorMinorAmbiguityScore",  note: "higher→Schubert" },
];

function main() {
    const beethovenDir = path.join(corpusRoot, "beethoven");
    const schubertDir  = path.join(corpusRoot, "schubert");

    if (verbose) console.log("── Beethoven corpus ──");
    const beethovenEntries = loadGroup(beethovenDir);
    if (verbose) console.log("── Schubert corpus ──");
    const schubertEntries  = loadGroup(schubertDir);

    const beethovenProfiles = beethovenEntries.map((e) => e.profile);
    const schubertProfiles  = schubertEntries.map((e) => e.profile);

    if (beethovenProfiles.length === 0 || schubertProfiles.length === 0) {
        console.error(`[validate-aesthetic-evaluators] ERROR: need at least 1 file per group.`);
        console.error(`  Beethoven files found: ${beethovenProfiles.length} (in ${beethovenDir})`);
        console.error(`  Schubert files found:  ${schubertProfiles.length} (in ${schubertDir})`);
        process.exit(1);
    }

    // Compute per-dimension stats + discrimination scores
    const dimensionResults = [];
    for (const dim of DIMENSIONS) {
        const bStats = groupStats(beethovenProfiles, dim.key);
        const sStats = groupStats(schubertProfiles, dim.key);
        const dScore = discriminationScore(bStats, sStats);
        dimensionResults.push({
            dimension: dim.key,
            note: dim.note,
            beethoven: bStats,
            schubert: sStats,
            discriminationScore: dScore,
            discriminative: dScore !== null && dScore > 0.5,
            stronglyDiscriminative: dScore !== null && dScore > 1.0,
        });
    }

    // Sort by discrimination score descending
    const sorted = [...dimensionResults].sort((a, b) => (b.discriminationScore ?? 0) - (a.discriminationScore ?? 0));

    const discriminativeDims   = sorted.filter((d) => d.discriminative);
    const strongDims           = sorted.filter((d) => d.stronglyDiscriminative);
    const schubertLineageDims  = DIMENSIONS.filter((d) => [
        "melodicContinuity", "phraseBreath", "harmonicColorDepth",
        "mediantModulationScore", "lyricExpansionScore", "majorMinorAmbiguityScore",
    ].includes(d.key));
    const lineageDiscriminative = schubertLineageDims
        .filter((d) => dimensionResults.find((r) => r.dimension === d.key)?.discriminative)
        .length;

    // ── Console report ────────────────────────────────────────────────────────

    console.log("══════════════════════════════════════════════════════════");
    console.log(" AXIOM Aesthetic Evaluator Validation Report");
    console.log("══════════════════════════════════════════════════════════");
    console.log(`  Beethoven corpus: ${beethovenProfiles.length} files (${beethovenDir})`);
    console.log(`  Schubert corpus:  ${schubertProfiles.length} files (${schubertDir})`);
    console.log("");
    console.log(" Dimensions ranked by discrimination score (|Δmean|/pooledSD):");
    console.log("  score > 0.5 = discriminative  |  score > 1.0 = strongly discriminative");
    console.log("");
    console.log(
        "  " +
        "Dimension".padEnd(32) +
        "B.mean".padStart(8) +
        "S.mean".padStart(8) +
        "Δ".padStart(8) +
        " disc.  status"
    );
    console.log("  " + "─".repeat(80));
    for (const r of sorted) {
        const bm = r.beethoven?.mean != null ? String(r.beethoven.mean).padStart(8) : "    n/a";
        const sm = r.schubert?.mean  != null ? String(r.schubert.mean).padStart(8)  : "    n/a";
        const delta = (r.beethoven?.mean != null && r.schubert?.mean != null)
            ? round3(r.beethoven.mean - r.schubert.mean)
            : null;
        const deltaStr = delta != null ? String(delta).padStart(8) : "    n/a";
        const discStr = r.discriminationScore != null ? String(r.discriminationScore).padStart(6) : "   n/a";
        const status = r.stronglyDiscriminative ? "  ★★ strong" : r.discriminative ? "  ★  ok" : "";
        console.log(`  ${r.dimension.padEnd(32)}${bm}${sm}${deltaStr}${discStr}${status}`);
    }
    console.log("");
    console.log(`  Discriminative dimensions:   ${discriminativeDims.length} / ${dimensionResults.length}`);
    console.log(`  Strongly discriminative:     ${strongDims.length} / ${dimensionResults.length}`);
    console.log(`  Schubert-lineage discriminative: ${lineageDiscriminative} / ${schubertLineageDims.length}`);
    console.log("");

    // Verdict
    const verdictOk = discriminativeDims.length >= Math.floor(DIMENSIONS.length * 0.4);
    const lineageOk = lineageDiscriminative >= 2;
    if (verdictOk && lineageOk) {
        console.log("  ✅ EVALUATOR OK — corpus groups are meaningfully distinguishable");
    } else {
        console.log("  ⚠ EVALUATOR WEAK — add more corpus files or review dimension heuristics");
        if (!verdictOk) console.log(`     (only ${discriminativeDims.length}/${DIMENSIONS.length} dimensions discriminate; need ≥${Math.floor(DIMENSIONS.length * 0.4)})`);
        if (!lineageOk) console.log(`     (only ${lineageDiscriminative}/6 Schubert-lineage dims discriminate; need ≥2)`);
    }
    console.log("══════════════════════════════════════════════════════════");

    // ── JSON output ───────────────────────────────────────────────────────────

    const report = {
        generatedAt: new Date().toISOString(),
        corpus: { beethoven: beethovenProfiles.length, schubert: schubertProfiles.length },
        verdict: verdictOk && lineageOk ? "ok" : "weak",
        discriminativeDimensions: discriminativeDims.length,
        stronglyDiscriminativeDimensions: strongDims.length,
        schubertLineageDiscriminative: lineageDiscriminative,
        totalDimensions: dimensionResults.length,
        dimensions: sorted,
    };

    if (outPath) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
        console.log(`  Report written to: ${outPath}`);
    }

    return verdictOk && lineageOk ? 0 : 1;
}

process.exit(main());
