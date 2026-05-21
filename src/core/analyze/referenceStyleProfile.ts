import type { SectionArtifactSummary } from "../pipeline/types.js";

// referenceStyleProfile.ts — Reference Corpus Anchor
// ──────────────────────────────────────────────────────────────────────────────
// Extracts structural style statistics from:
//   (a) AXIOM SectionArtifactSummary[] — for in-pipeline candidate evaluation
//   (b) Raw ABC notation text        — for external reference corpus files
//
// Purpose: prevent self-training collapse by anchoring AXIOM output against
// structural statistics from classical reference works (Bach, Mozart, etc.).
//
// 9 classical structural dimensions (backward-compatible, used in R-01 gate):
//   1. meanPhraseLengthMeasures   — average phrase length in measures
//   2. phraseRegularity           — CV of phrase lengths (0=very regular, ∞=chaotic)
//   3. climaxPosition             — relative position of pitch climax (0–1)
//   4. pitchRangeSemitones        — melody compass (semitones)
//   5. meanPitchMidi              — mean melody pitch (MIDI number, C4=60 anchor)
//   6. leapSmoothness             — fraction of stepwise (≤2 semitone) intervals
//   7. meanNoteDensityPerMeasure  — notes per measure (all voices)
//   8. bassPresenceRatio          — fraction of notes below MIDI 60
//   9. harmonicRhythmProxy        — mean distinct pitch-class count per measure
//
// 6 Schubert-lineage dimensions (SCHUBERT_STYLE_DIMENSIONS, used for lineage gate):
//  10. melodicContinuity          — stepwise motion ratio in high-register voice (0–1)
//  11. phraseBreath               — phrase expansion ratio: how far longest phrase > mean (0–1)
//  12. harmonicColorDepth         — distinct pitch-class coverage across piece (0–1)
//  13. mediantModulationScore     — fraction of bass-voice leaps that are 3rds (0–1)
//  14. lyricExpansionScore        — phrase-length variability score (0–1)
//  15. majorMinorAmbiguityScore   — accidental density proxy for modal mixture (0–1)
//
// Lineage distance uses all 15 dimensions (LINEAGE_DIMENSIONS).
//
// referenceDistanceScore classification:
//   "too_close" (score < 0.10) — unusual proximity to corpus center; copy risk
//   "in_range"  (0.10–0.75)   — within healthy classical idiom
//   "too_far"   (score > 0.75) — drifted from classical structural idiom
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StyleProfile {
    /** Mean phrase length in measures. Classical typical: 4–8. */
    meanPhraseLengthMeasures: number;
    /** Coefficient of variation of phrase lengths (stddev / mean). 0 = perfectly uniform. */
    phraseRegularity: number;
    /** Relative position of pitch climax in the piece (0–1). Classical: ~0.55–0.70. */
    climaxPosition: number;
    /** Span of melody pitch range in semitones. Classical typical: 12–24. */
    pitchRangeSemitones: number;
    /** Mean melody pitch in MIDI numbers. C4 = 60. Classical melody: ~64–72. */
    meanPitchMidi: number;
    /** Fraction of consecutive melodic intervals ≤ 2 semitones (stepwise motion). Classical: 0.55–0.75. */
    leapSmoothness: number;
    /** Mean note count per measure across all voices. Classical chamber: 4–12. */
    meanNoteDensityPerMeasure: number;
    /** Fraction of all notes below MIDI 60 (C4). Piano LH / bass voice indicator. Classical: 0.2–0.45. */
    bassPresenceRatio: number;
    /** Mean distinct pitch-class count per measure. Proxy for harmonic rhythm (0–12). Classical: 3–6. */
    harmonicRhythmProxy: number;
    // ── Schubert-lineage dimensions ─────────────────────────────────────────
    /** Fraction of stepwise (≤2 semitone) intervals in the high-register (melody) voice. Schubertian: 0.65–0.80. */
    melodicContinuity: number;
    /** Phrase expansion ratio: (maxPhrase - meanPhrase) / (meanPhrase + 1). Schubertian: 0.20–0.60. */
    phraseBreath: number;
    /** Distinct pitch-class coverage: totalDistinctPitchClasses / 12. Schubertian: 0.65–0.85. */
    harmonicColorDepth: number;
    /** Fraction of bass-voice leaps that are minor/major 3rds (3–4 semitones). Proxy for mediant usage. Schubertian: 0.15–0.35. */
    mediantModulationScore: number;
    /** Phrase-length variability: stddev(phraseLengths) / (mean + 1). Schubertian: 0.25–0.55. */
    lyricExpansionScore: number;
    /** Accidental density proxy for modal mixture: accidentalTokens / totalNoteCount. Schubertian: 0.10–0.30. */
    majorMinorAmbiguityScore: number;

    /** Total measure count — metadata, not used in distance computation. */
    totalMeasures: number;
    /** Total note count (all voices) — metadata. */
    totalNotes: number;
}

export type StyleProfileKey = Exclude<keyof StyleProfile, "totalMeasures" | "totalNotes">;

/** Per-dimension mean and standard deviation over a corpus of works. */
export interface CorpusProfile {
    mean: StyleProfile;
    stddev: StyleProfile;
    /** Number of works in the corpus. */
    n: number;
    generatedAt: string;
}

export interface ReferenceDistanceResult {
    /** Normalized distance from corpus center (0–1). Higher = further from classical idiom. */
    score: number;
    /** Classification of the distance. */
    classification: "too_close" | "in_range" | "too_far";
    /** True when score < TOO_CLOSE_THRESHOLD (copy-risk flag). */
    copyRisk: boolean;
    /** True when score > TOO_FAR_THRESHOLD (idiom-drift flag). */
    idiomDrift: boolean;
    /** RMS of per-dimension z-scores (un-scaled). */
    meanZScore: number;
    /** Per-dimension z-scores for diagnostics. */
    dimensionZScores: Partial<Record<StyleProfileKey, number>>;
}

/**
 * Per-lineage reference distance results.
 * Returned by computeReferenceDistanceScoreSplit().
 */
export interface ReferenceDistanceSplit {
    /** Distance from Beethoven-only corpus. */
    beethoven: ReferenceDistanceResult;
    /** Distance from Schubert-only corpus. */
    schubert: ReferenceDistanceResult;
    /** Distance from combined Beethoven+Schubert lineage corpus (primary R-01 anchor). */
    lineage: ReferenceDistanceResult;
    /** Distance from general theory corpus (Bach/Mozart/Chopin/Brahms). Auxiliary only. */
    generalTheory: ReferenceDistanceResult;
}

// ---------------------------------------------------------------------------
// Thresholds (all configurable)
// ---------------------------------------------------------------------------

const TOO_CLOSE_THRESHOLD = 0.10;
const TOO_FAR_THRESHOLD = 0.75;
const Z_SCALE_DIVISOR = 3.0; // rmsZ / 3 ≈ score; rmsZ=3 → score≈1.0

/** Dimensions included in distance computation (9 total, backward-compatible). */
const DISTANCE_DIMENSIONS: StyleProfileKey[] = [
    "meanPhraseLengthMeasures",
    "phraseRegularity",
    "climaxPosition",
    "pitchRangeSemitones",
    "meanPitchMidi",
    "leapSmoothness",
    "meanNoteDensityPerMeasure",
    "bassPresenceRatio",
    "harmonicRhythmProxy",
];

/** Schubert-specific lyrical dimensions (6 total). */
export const SCHUBERT_STYLE_DIMENSIONS: StyleProfileKey[] = [
    "melodicContinuity",
    "phraseBreath",
    "harmonicColorDepth",
    "mediantModulationScore",
    "lyricExpansionScore",
    "majorMinorAmbiguityScore",
];

/** Full lineage dimension set: all 15 dimensions. Used for lineage distance computation. */
export const LINEAGE_DIMENSIONS: StyleProfileKey[] = [
    ...DISTANCE_DIMENSIONS,
    ...SCHUBERT_STYLE_DIMENSIONS,
];

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function mean(xs: number[]): number {
    if (xs.length === 0) return 0;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[], m?: number): number {
    if (xs.length < 2) return 0;
    const mu = m ?? mean(xs);
    const variance = xs.reduce((a, x) => a + (x - mu) ** 2, 0) / xs.length;
    return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// (A) extractStyleProfileFromSections
//     For AXIOM pipeline candidates — uses already-structured data
// ---------------------------------------------------------------------------

/**
 * Derives a StyleProfile from AXIOM section artifacts.
 * Each section is treated as one phrase unit.
 */
export function extractStyleProfileFromSections(
    sections: SectionArtifactSummary[],
): StyleProfile {
    if (sections.length === 0) {
        return emptyProfile();
    }

    // 1. Phrase lengths (in measures)
    const phraseLengths = sections.map((s) => s.measureCount);
    const totalMeasures = phraseLengths.reduce((a, b) => a + b, 0);
    const phraseMean = mean(phraseLengths);
    const phraseSD = stddev(phraseLengths, phraseMean);
    const phraseRegularity = phraseMean > 0 ? phraseSD / phraseMean : 0;

    // 2. All melody pitches (from noteHistory and melodyEvents)
    const allMelodyPitches: number[] = [];
    for (const sec of sections) {
        if (sec.noteHistory && sec.noteHistory.length > 0) {
            allMelodyPitches.push(...sec.noteHistory);
        } else {
            for (const ev of sec.melodyEvents) {
                if (ev.type !== "rest" && ev.pitch !== undefined) {
                    allMelodyPitches.push(ev.pitch);
                }
            }
        }
    }

    // 3. Climax position
    let climaxPos = 0.618; // default to golden ratio
    if (allMelodyPitches.length > 0) {
        // Find the section with the highest melody peak
        let maxPeak = -Infinity;
        let climaxSectionIdx = 0;
        sections.forEach((sec, idx) => {
            const peak = sec.melodyPitchMax ?? Math.max(...(sec.noteHistory ?? [0]));
            if (peak > maxPeak) { maxPeak = peak; climaxSectionIdx = idx; }
        });
        const measuresBefore = phraseLengths.slice(0, climaxSectionIdx).reduce((a, b) => a + b, 0);
        climaxPos = totalMeasures > 0 ? (measuresBefore + phraseLengths[climaxSectionIdx]! / 2) / totalMeasures : 0.5;
    }

    // 4. Pitch range and mean
    const pitchMin = allMelodyPitches.length > 0 ? Math.min(...allMelodyPitches) : 60;
    const pitchMax = allMelodyPitches.length > 0 ? Math.max(...allMelodyPitches) : 72;
    const pitchRange = pitchMax - pitchMin;
    const meanPitch = mean(allMelodyPitches);

    // 5. Leap smoothness (from melody intervals)
    const intervals: number[] = [];
    const contiguousPitches = allMelodyPitches;
    for (let i = 1; i < contiguousPitches.length; i++) {
        intervals.push(Math.abs(contiguousPitches[i]! - contiguousPitches[i - 1]!));
    }
    const stepwise = intervals.filter((d) => d <= 2).length;
    const leapSmoothness = intervals.length > 0 ? stepwise / intervals.length : 0.65;

    // 6. Total notes (melody + accompaniment) for density
    let totalNotes = 0;
    let totalBassNotes = 0;
    const pitchClassSetsPerSection: number[] = [];

    for (const sec of sections) {
        const melodyCount = sec.melodyEvents.filter((e) => e.type !== "rest").length;
        const accompCount = sec.accompanimentEvents.filter((e) => e.type !== "rest").length;
        totalNotes += melodyCount + accompCount;

        // Bass notes: accomp events with pitch < 60
        for (const ev of sec.accompanimentEvents) {
            if (ev.type !== "rest") {
                const p = ev.pitch ?? (ev.pitches?.[0] ?? 0);
                if (p < 60) totalBassNotes++;
            }
        }
        // Also count bass from melody events below 60
        for (const ev of sec.melodyEvents) {
            if (ev.type !== "rest") {
                const p = ev.pitch ?? 0;
                if (p < 60) totalBassNotes++;
            }
        }

        // Pitch-class variety proxy per section
        const pitchClasses = new Set<number>();
        for (const ev of [...sec.melodyEvents, ...sec.accompanimentEvents]) {
            if (ev.type !== "rest") {
                if (ev.pitch !== undefined) pitchClasses.add(ev.pitch % 12);
                for (const p of ev.pitches ?? []) pitchClasses.add(p % 12);
            }
        }
        pitchClassSetsPerSection.push(pitchClasses.size);
    }

    const meanNoteDensity = totalMeasures > 0 ? totalNotes / totalMeasures : 0;
    const bassRatio = totalNotes > 0 ? totalBassNotes / totalNotes : 0;
    const harmonicProxy = mean(pitchClassSetsPerSection);

    return {
        meanPhraseLengthMeasures: phraseMean,
        phraseRegularity: clamp(phraseRegularity, 0, 3),
        climaxPosition: clamp(climaxPos, 0, 1),
        pitchRangeSemitones: pitchRange,
        meanPitchMidi: meanPitch,
        leapSmoothness: clamp(leapSmoothness, 0, 1),
        meanNoteDensityPerMeasure: meanNoteDensity,
        bassPresenceRatio: clamp(bassRatio, 0, 1),
        harmonicRhythmProxy: clamp(harmonicProxy, 0, 12),
        // Schubert dimensions: best-effort approximations from section artifacts.
        // ABC-based extraction is more accurate; these are used for distance comparison.
        melodicContinuity: clamp(leapSmoothness, 0, 1),  // same stepwise ratio as proxy
        phraseBreath: clamp(phraseMean > 0 ? (Math.max(...phraseLengths) - phraseMean) / (phraseMean + 1) : 0, 0, 1),
        harmonicColorDepth: clamp(harmonicProxy / 12, 0, 1),
        mediantModulationScore: 0.2,  // neutral default; not computable from section events
        lyricExpansionScore: clamp(phraseSD / (phraseMean + 1), 0, 1),
        majorMinorAmbiguityScore: 0.15,  // neutral default; not computable from section events
        totalMeasures,
        totalNotes,
    };
}

// ---------------------------------------------------------------------------
// (B) extractStyleProfileFromAbc
//     Lightweight ABC notation parser for external reference corpus files
// ---------------------------------------------------------------------------

interface AbcParsedNote {
    pitch: number;  // MIDI pitch, -1 for rest
    beats: number;  // duration in quarter-note beats
    measureIndex: number;
}

// ABC note letter → semitone offset from C (within the octave)
const NOTE_SEMITONES: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
    c: 12, d: 14, e: 16, f: 17, g: 19, a: 21, b: 23,
};

// Base MIDI pitch for C in ABC default octave: lowercase c = C4 = MIDI 60, uppercase C = C3 = MIDI 48
const ABC_BASE_MIDI = 48; // uppercase C = MIDI 48

/**
 * Parses ABC notation text into a flat array of note events.
 * Only handles the music body — header fields are stripped first.
 * Handles: single-voice, simple durations, octave modifiers, accidentals.
 * Does not handle: chords (picks first note), grace notes, tuplets.
 */
export function parseAbcToNotes(abcText: string): AbcParsedNote[] {
    const lines = abcText.split(/\r?\n/);

    // Extract meter and default note length from header
    let defaultBeats = 0.5;  // L:1/8 is the ABC default
    let timeNumBeats = 4;    // numerator of M: field in beats (4/4 → 4 beats)
    let inBody = false;

    const bodyLines: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!inBody) {
            const mMatch = trimmed.match(/^M:\s*(\d+)\/(\d+)/);
            if (mMatch) {
                timeNumBeats = parseInt(mMatch[1]!, 10);
            }
            const lMatch = trimmed.match(/^L:\s*(\d+)\/(\d+)/);
            if (lMatch) {
                defaultBeats = parseInt(lMatch[1]!, 10) / parseInt(lMatch[2]!, 10) * 4;
            }
            // Body starts after the first K: line
            if (trimmed.startsWith("K:")) {
                inBody = true;
            }
        } else {
            // Skip in-body header continuation lines (w:, s:, %%, etc.)
            if (/^[A-Ww]:/.test(trimmed) && !trimmed.startsWith("V:") && !trimmed.startsWith("K:")) continue;
            bodyLines.push(trimmed);
        }
    }

    // If no K: found, treat everything after the first blank line as body
    if (!inBody) {
        inBody = false;
        for (const line of lines) {
            if (!inBody && line.trim() === "") { inBody = true; continue; }
            if (inBody) bodyLines.push(line.trim());
        }
        if (bodyLines.length === 0) bodyLines.push(...lines);
    }

    const body = bodyLines.join(" ");
    const notes: AbcParsedNote[] = [];
    let measureIndex = 0;
    let i = 0;

    // Token-by-token scan
    while (i < body.length) {
        const ch = body[i]!;

        // Bar line
        if (ch === "|") {
            measureIndex++;
            i++;
            // Handle || :| |: [|
            while (i < body.length && (body[i] === "|" || body[i] === ":" || body[i] === "[")) i++;
            continue;
        }

        // Skip chord symbol in brackets [...]
        if (ch === "[") {
            // Could be a chord like [CEG] — pick first note, skip to ]
            const closeIdx = body.indexOf("]", i);
            if (closeIdx === -1) { i++; continue; }
            // parse first note inside
            i++; // skip [
            // fall through to note parsing for the first note, then skip to ]
            const chordContent = body.slice(i, closeIdx);
            const firstNoteMatch = chordContent.match(/^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([',]*)([\d]*\/[\d]*|[\d]+)?/);
            if (firstNoteMatch) {
                const n = parseNoteToken(firstNoteMatch[0]!, defaultBeats, measureIndex);
                if (n) notes.push(n);
            }
            i = closeIdx + 1;
            // Parse duration after the ] (applies to chord as a whole)
            continue;
        }

        // Rest: z or x
        if (ch === "z" || ch === "x") {
            i++;
            parseDuration(body, i, defaultBeats); // advance i but discard
            const { beats, end } = parseDuration(body, i, defaultBeats);
            notes.push({ pitch: -1, beats, measureIndex });
            i = end;
            continue;
        }

        // Grace notes: {abc} — skip
        if (ch === "{") {
            const closeIdx = body.indexOf("}", i);
            i = closeIdx === -1 ? i + 1 : closeIdx + 1;
            continue;
        }

        // Accidentals: ^ _ =
        let accidental = 0;
        if (ch === "^") {
            accidental = body[i + 1] === "^" ? (i++, 2) : 1;
            i++;
        } else if (ch === "_") {
            accidental = body[i + 1] === "_" ? (i++, -2) : -1;
            i++;
        } else if (ch === "=") {
            accidental = 0;
            i++;
        }

        const noteCh = body[i] ?? "";
        if (!NOTE_SEMITONES.hasOwnProperty(noteCh)) {
            i++;
            continue;
        }
        i++;

        // Octave modifiers
        let octaveShift = 0;
        while (i < body.length && body[i] === "'") { octaveShift++; i++; }
        while (i < body.length && body[i] === ",") { octaveShift--; i++; }

        // Duration
        const { beats, end } = parseDuration(body, i, defaultBeats);
        i = end;

        // Compute MIDI pitch
        const semitone = NOTE_SEMITONES[noteCh]!;
        const midi = ABC_BASE_MIDI + semitone + accidental + octaveShift * 12;
        notes.push({ pitch: midi, beats, measureIndex });
    }

    return notes;
}

function parseDuration(s: string, start: number, defaultBeats: number): { beats: number; end: number } {
    let i = start;
    let num = 0;
    let den = 0;

    // Collect digits before /
    while (i < s.length && s[i]! >= "0" && s[i]! <= "9") {
        num = num * 10 + parseInt(s[i]!, 10);
        i++;
    }
    if (s[i] === "/") {
        i++;
        while (i < s.length && s[i]! >= "0" && s[i]! <= "9") {
            den = den * 10 + parseInt(s[i]!, 10);
            i++;
        }
    }

    let beats: number;
    if (num === 0 && den === 0) {
        beats = defaultBeats;
    } else if (num > 0 && den === 0) {
        beats = defaultBeats * num;
    } else if (num === 0 && den > 0) {
        // "/" alone = 1/2 of default, "/2" = 1/2, "/4" = 1/4
        beats = defaultBeats / den;
    } else {
        beats = defaultBeats * num / den;
    }
    return { beats, end: i };
}

function parseNoteToken(token: string, defaultBeats: number, measureIndex: number): AbcParsedNote | null {
    const m = token.match(/^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([',]*)([\d]*\/[\d]*|[\d]+)?/);
    if (!m) return null;
    const acc = m[1] ?? "";
    const noteCh = m[2]!;
    const octMods = m[3] ?? "";
    const durStr = m[4] ?? "";

    let accidental = 0;
    if (acc.startsWith("^^")) accidental = 2;
    else if (acc.startsWith("^")) accidental = 1;
    else if (acc.startsWith("__")) accidental = -2;
    else if (acc.startsWith("_")) accidental = -1;

    let octaveShift = (octMods.match(/'/g) ?? []).length - (octMods.match(/,/g) ?? []).length;

    let beats = defaultBeats;
    if (durStr) {
        const { beats: b } = parseDuration(durStr, 0, defaultBeats);
        beats = b;
    }

    const semitone = NOTE_SEMITONES[noteCh] ?? 0;
    const midi = ABC_BASE_MIDI + semitone + accidental + octaveShift * 12;
    return { pitch: midi, beats, measureIndex };
}

/**
 * Extracts a StyleProfile from raw ABC notation text.
 * Suitable for use with external reference corpus files.
 */
export function extractStyleProfileFromAbc(abcText: string): StyleProfile {
    const notes = parseAbcToNotes(abcText);
    if (notes.length === 0) return emptyProfile();

    const pitchNotes = notes.filter((n) => n.pitch >= 0);
    if (pitchNotes.length === 0) return emptyProfile();

    const totalMeasures = Math.max(...notes.map((n) => n.measureIndex)) + 1;

    // Phrase lengths: group by rests + measure boundaries
    // Heuristic: a phrase ends at a rest ≥ 0.5 beats, measure count between rests
    const phraseLengths: number[] = [];
    let phraseStart = 0;
    let inPhrase = false;
    let lastMeasure = 0;
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i]!;
        if (n.pitch < 0 && n.beats >= 0.5) {
            // rest — ends phrase
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
    // Fallback: if no rests detected, assume 4-bar phrases
    if (phraseLengths.length === 0) {
        for (let m = 0; m < totalMeasures; m += 4) phraseLengths.push(Math.min(4, totalMeasures - m));
    }

    const phraseMean = mean(phraseLengths);
    const phraseSD = stddev(phraseLengths, phraseMean);
    const phraseRegularity = phraseMean > 0 ? phraseSD / phraseMean : 0;

    // Pitch stats
    const pitches = pitchNotes.map((n) => n.pitch);
    const pitchMin = Math.min(...pitches);
    const pitchMax = Math.max(...pitches);
    const pitchRange = pitchMax - pitchMin;
    const meanPitch = mean(pitches);

    // Climax position
    const climaxNote = pitchNotes.reduce((a, b) => (b.pitch > a.pitch ? b : a));
    const climaxPos = totalMeasures > 1 ? climaxNote.measureIndex / (totalMeasures - 1) : 0.5;

    // Leap smoothness
    const intervals: number[] = [];
    for (let i = 1; i < pitches.length; i++) {
        intervals.push(Math.abs(pitches[i]! - pitches[i - 1]!));
    }
    const stepwise = intervals.filter((d) => d <= 2).length;
    const leapSmoothness = intervals.length > 0 ? stepwise / intervals.length : 0.65;

    // Note density
    const totalNotes = notes.length;
    const meanDensity = totalMeasures > 0 ? totalNotes / totalMeasures : 0;

    // Bass presence (notes below MIDI 60 = C4)
    const bassNotes = pitchNotes.filter((n) => n.pitch < 60).length;
    const bassRatio = pitchNotes.length > 0 ? bassNotes / pitchNotes.length : 0;

    // Harmonic rhythm proxy: distinct pitch classes per measure
    const pitchClassesPerMeasure = new Map<number, Set<number>>();
    for (const n of pitchNotes) {
        if (!pitchClassesPerMeasure.has(n.measureIndex)) {
            pitchClassesPerMeasure.set(n.measureIndex, new Set());
        }
        pitchClassesPerMeasure.get(n.measureIndex)!.add(n.pitch % 12);
    }
    const harmonicProxy = mean([...pitchClassesPerMeasure.values()].map((s) => s.size));

    // ── Schubert-lineage dimensions ────────────────────────────────────────────

    // melodicContinuity: stepwise ratio among high-register notes (top 40% by pitch)
    const pitchThreshold = pitchMin + (pitchRange * 0.6);
    const melodyNotes = pitchNotes.filter((n) => n.pitch >= pitchThreshold);
    const melodyPitches = melodyNotes.map((n) => n.pitch);
    const melodyIntervals: number[] = [];
    for (let i = 1; i < melodyPitches.length; i++) {
        melodyIntervals.push(Math.abs(melodyPitches[i]! - melodyPitches[i - 1]!));
    }
    const melodyStepwise = melodyIntervals.filter((d) => d <= 2).length;
    const melodicContinuity = melodyIntervals.length > 0 ? melodyStepwise / melodyIntervals.length : leapSmoothness;

    // phraseBreath: how far the longest phrase exceeds the mean (expansion ratio)
    const maxPhrase = phraseLengths.length > 0 ? Math.max(...phraseLengths) : phraseMean;
    const phraseBreath = clamp(phraseMean > 0 ? (maxPhrase - phraseMean) / (phraseMean + 1) : 0, 0, 1);

    // harmonicColorDepth: total distinct pitch classes across whole piece
    const allPitchClasses = new Set<number>();
    for (const n of pitchNotes) allPitchClasses.add(n.pitch % 12);
    const harmonicColorDepth = clamp(allPitchClasses.size / 12, 0, 1);

    // mediantModulationScore: fraction of bass-voice leaps that are 3rds (3–4 semitones)
    const bassVoiceNotes = pitchNotes.filter((n) => n.pitch < 60);
    const bassIntervals: number[] = [];
    for (let i = 1; i < bassVoiceNotes.length; i++) {
        bassIntervals.push(Math.abs(bassVoiceNotes[i]!.pitch - bassVoiceNotes[i - 1]!.pitch));
    }
    const bassMediants = bassIntervals.filter((d) => d === 3 || d === 4).length;
    const mediantModulationScore = bassIntervals.length > 0 ? clamp(bassMediants / bassIntervals.length, 0, 1) : 0.2;

    // lyricExpansionScore: phrase-length variability (stddev / (mean + 1))
    const lyricExpansionScore = clamp(phraseSD / (phraseMean + 1), 0, 1);

    // majorMinorAmbiguityScore: accidental density — count ^ and _ tokens in body
    // Strip header lines to avoid counting key-signature accidentals
    const bodySection = abcText.split(/\r?\n/)
        .filter((line) => !line.match(/^[A-Z]:/))
        .join(" ");
    const accidentalCount = (bodySection.match(/[\^_]/g) ?? []).length;
    const majorMinorAmbiguityScore = totalNotes > 0 ? clamp(accidentalCount / totalNotes, 0, 1) : 0;

    return {
        meanPhraseLengthMeasures: phraseMean,
        phraseRegularity: clamp(phraseRegularity, 0, 3),
        climaxPosition: clamp(climaxPos, 0, 1),
        pitchRangeSemitones: pitchRange,
        meanPitchMidi: meanPitch,
        leapSmoothness: clamp(leapSmoothness, 0, 1),
        meanNoteDensityPerMeasure: meanDensity,
        bassPresenceRatio: clamp(bassRatio, 0, 1),
        harmonicRhythmProxy: clamp(harmonicProxy, 0, 12),
        melodicContinuity: clamp(melodicContinuity, 0, 1),
        phraseBreath,
        harmonicColorDepth,
        mediantModulationScore,
        lyricExpansionScore,
        majorMinorAmbiguityScore,
        totalMeasures,
        totalNotes,
    };
}

// ---------------------------------------------------------------------------
// computeCorpusProfile — aggregate multiple StyleProfiles into mean + stddev
// ---------------------------------------------------------------------------

/**
 * Aggregates an array of StyleProfiles into a CorpusProfile (mean ± stddev per dimension).
 * Requires at least 2 profiles for meaningful statistics.
 */
export function computeCorpusProfile(profiles: StyleProfile[]): CorpusProfile {
    if (profiles.length === 0) {
        return {
            mean: emptyProfile(),
            stddev: emptyProfile(),
            n: 0,
            generatedAt: new Date().toISOString(),
        };
    }

    const keys = Object.keys(profiles[0]!) as (keyof StyleProfile)[];
    const meanProfile = {} as StyleProfile;
    const stddevProfile = {} as StyleProfile;

    for (const k of keys) {
        const values = profiles.map((p) => p[k] as number);
        const m = mean(values);
        const s = stddev(values, m);
        (meanProfile as unknown as Record<string, number>)[k] = m;
        // Ensure stddev is at least a small epsilon to avoid division by zero
        (stddevProfile as unknown as Record<string, number>)[k] = Math.max(s, 1e-6);
    }

    return {
        mean: meanProfile,
        stddev: stddevProfile,
        n: profiles.length,
        generatedAt: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// computeReferenceDistanceScore
// ---------------------------------------------------------------------------

/**
 * Computes how far a candidate StyleProfile is from the corpus center.
 *
 * Uses normalized Euclidean distance over per-dimension z-scores,
 * then maps to [0, 1] via score = clamp(rmsZScore / Z_SCALE_DIVISOR, 0, 1).
 *
 * Classification:
 *   "too_close" — score < 0.10 (very unusual; possible copy of reference patterns)
 *   "in_range"  — 0.10 ≤ score ≤ 0.75 (within healthy classical idiom window)
 *   "too_far"   — score > 0.75 (drifted from classical structural idiom)
 */
export function computeReferenceDistanceScore(
    candidate: StyleProfile,
    corpus: CorpusProfile,
): ReferenceDistanceResult {
    if (corpus.n === 0) {
        return {
            score: 0.5,
            classification: "in_range",
            copyRisk: false,
            idiomDrift: false,
            meanZScore: 0,
            dimensionZScores: {},
        };
    }

    const zScores: Partial<Record<StyleProfileKey, number>> = {};
    let sumSq = 0;

    for (const dim of DISTANCE_DIMENSIONS) {
        const candidateVal = candidate[dim] as number;
        const corpusMean = corpus.mean[dim] as number;
        const corpusSd = corpus.stddev[dim] as number;
        const z = (candidateVal - corpusMean) / Math.max(corpusSd, 1e-6);
        zScores[dim] = z;
        sumSq += z * z;
    }

    const rmsZ = Math.sqrt(sumSq / DISTANCE_DIMENSIONS.length);
    const score = clamp(rmsZ / Z_SCALE_DIVISOR, 0, 1);

    const classification: ReferenceDistanceResult["classification"] =
        score < TOO_CLOSE_THRESHOLD ? "too_close" :
        score > TOO_FAR_THRESHOLD   ? "too_far"   : "in_range";

    return {
        score,
        classification,
        copyRisk: score < TOO_CLOSE_THRESHOLD,
        idiomDrift: score > TOO_FAR_THRESHOLD,
        meanZScore: rmsZ,
        dimensionZScores: zScores,
    };
}

/**
 * Computes distance against a specific set of dimensions.
 * Useful for Schubert-only or lineage-only comparisons.
 */
export function computeReferenceDistanceScoreWithDimensions(
    candidate: StyleProfile,
    corpus: CorpusProfile,
    dimensions: StyleProfileKey[],
): ReferenceDistanceResult {
    if (corpus.n === 0 || dimensions.length === 0) {
        return {
            score: 0.5,
            classification: "in_range",
            copyRisk: false,
            idiomDrift: false,
            meanZScore: 0,
            dimensionZScores: {},
        };
    }

    const zScores: Partial<Record<StyleProfileKey, number>> = {};
    let sumSq = 0;

    for (const dim of dimensions) {
        const candidateVal = (candidate[dim] as number | undefined) ?? 0;
        const corpusMean = (corpus.mean[dim] as number | undefined) ?? 0;
        const corpusSd = (corpus.stddev[dim] as number | undefined) ?? 1e-6;
        const z = (candidateVal - corpusMean) / Math.max(corpusSd, 1e-6);
        zScores[dim] = z;
        sumSq += z * z;
    }

    const rmsZ = Math.sqrt(sumSq / dimensions.length);
    const score = clamp(rmsZ / Z_SCALE_DIVISOR, 0, 1);
    const classification: ReferenceDistanceResult["classification"] =
        score < TOO_CLOSE_THRESHOLD ? "too_close" :
        score > TOO_FAR_THRESHOLD   ? "too_far"   : "in_range";

    return {
        score,
        classification,
        copyRisk: score < TOO_CLOSE_THRESHOLD,
        idiomDrift: score > TOO_FAR_THRESHOLD,
        meanZScore: rmsZ,
        dimensionZScores: zScores,
    };
}

/**
 * Computes per-lineage reference distance split.
 * Provide null for any corpus that is not available; that leg returns score=0.5 (neutral).
 */
export function computeReferenceDistanceScoreSplit(
    candidate: StyleProfile,
    corpusBeeethoven: CorpusProfile | null,
    corpusSchubert: CorpusProfile | null,
    corpusLineage: CorpusProfile | null,
    corpusGeneralTheory: CorpusProfile | null,
): ReferenceDistanceSplit {
    const neutral: ReferenceDistanceResult = {
        score: 0.5, classification: "in_range",
        copyRisk: false, idiomDrift: false, meanZScore: 0, dimensionZScores: {},
    };
    const linDims = LINEAGE_DIMENSIONS;
    const classDims = DISTANCE_DIMENSIONS;

    return {
        beethoven: corpusBeeethoven ? computeReferenceDistanceScoreWithDimensions(candidate, corpusBeeethoven, linDims) : neutral,
        schubert:  corpusSchubert   ? computeReferenceDistanceScoreWithDimensions(candidate, corpusSchubert,  linDims) : neutral,
        lineage:   corpusLineage    ? computeReferenceDistanceScoreWithDimensions(candidate, corpusLineage,   linDims) : neutral,
        generalTheory: corpusGeneralTheory ? computeReferenceDistanceScoreWithDimensions(candidate, corpusGeneralTheory, classDims) : neutral,
    };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function emptyProfile(): StyleProfile {
    return {
        meanPhraseLengthMeasures: 0,
        phraseRegularity: 0,
        climaxPosition: 0.5,
        pitchRangeSemitones: 0,
        meanPitchMidi: 60,
        leapSmoothness: 0,
        meanNoteDensityPerMeasure: 0,
        bassPresenceRatio: 0,
        harmonicRhythmProxy: 0,
        melodicContinuity: 0,
        phraseBreath: 0,
        harmonicColorDepth: 0,
        mediantModulationScore: 0,
        lyricExpansionScore: 0,
        majorMinorAmbiguityScore: 0,
        totalMeasures: 0,
        totalNotes: 0,
    };
}
