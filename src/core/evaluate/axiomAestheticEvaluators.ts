import type {
    CompositionPlan,
    SectionArtifactSummary,
} from "../pipeline/types.js";

// axiomAestheticEvaluators.ts — Beethoven·Schubert lineage aesthetic evaluators
// ──────────────────────────────────────────────────────────────────────────────
// Three composite scores that measure AXIOM's core aesthetic identity:
//
//   BeethovenianMotivicPressureScore  — motivic inevitability and development
//   SchubertianLyricExpansionScore    — lyrical melody and phrase breath
//   MediantColorScore                 — mediant harmonic color and tonal wandering
//
// All scores are in [0, 1].  These are SUPPLEMENTARY (not included in
// finalCraftScore formula); they belong to the benchmark / promotion gate layer.
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Utility helpers (local to this module)
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[]): number {
    if (values.length < 2) return 0;
    const m = mean(values);
    return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

/** Proportion of consecutive pitch pairs within ±maxSemitones of each other. */
function stepwiseProportion(pitches: number[], maxSemitones = 2): number {
    if (pitches.length < 2) return 0;
    let steps = 0;
    for (let i = 1; i < pitches.length; i++) {
        if (Math.abs((pitches[i] ?? 0) - (pitches[i - 1] ?? 0)) <= maxSemitones) steps++;
    }
    return steps / (pitches.length - 1);
}

/** Proportion of sign-matches between two interval contours. */
function contourSignMatchProportion(a: number[], b: number[]): number {
    const minLen = Math.min(a.length, b.length);
    if (minLen === 0) return 0;
    let matches = 0;
    for (let i = 0; i < minLen; i++) {
        const sa = Math.sign(a[i]!);
        const sb = Math.sign(b[i]!);
        if (sa === sb) matches++;
    }
    return matches / minLen;
}

/** Compute interval contour from a pitch array. */
function intervalContour(pitches: number[]): number[] {
    const result: number[] = [];
    for (let i = 1; i < pitches.length; i++) {
        result.push((pitches[i] ?? 0) - (pitches[i - 1] ?? 0));
    }
    return result;
}

/**
 * Extract rhythmic cell fingerprint from melody events:
 * returns a short normalized pattern of the first N note durations.
 */
function rhythmicCellOf(artifact: SectionArtifactSummary, cellLen = 4): number[] {
    const noteDurations = artifact.melodyEvents
        .filter((e) => e.type === "note")
        .map((e) => e.quarterLength);
    const cell = noteDurations.slice(0, cellLen);
    if (cell.length === 0) return [];
    const maxDur = Math.max(...cell);
    return cell.map((d) => (maxDur > 0 ? d / maxDur : 0));
}

/** Similarity between two rhythmic cell arrays (max-normalized). */
function rhythmicCellSimilarity(a: number[], b: number[]): number {
    const minLen = Math.min(a.length, b.length);
    if (minLen === 0) return 0;
    let diff = 0;
    for (let i = 0; i < minLen; i++) {
        diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    }
    return 1 - diff / minLen;
}

// ---------------------------------------------------------------------------
// A. BeethovenianMotivicPressureScore
// ---------------------------------------------------------------------------

export interface BeethovenianMotivicPressureDetail {
    /** 0–1: theme_a motif interval-contour appears in subsequent sections */
    motiveCellRecurrence: number;
    /** 0–1: rhythmic cell pattern repeats across sections */
    rhythmicCellRecurrence: number;
    /** 0–1: variety of motif transformation techniques */
    transformationDensity: number;
    /** 0–1: development section has harmonic pressure (rich density + tonicization) */
    developmentPressure: number;
    /** 0–1: recap section re-establishes theme_a contour */
    recapInevitability: number;
    /** composite 0–1 */
    score: number;
    notes: string;
}

/**
 * Measures Beethovenian motivic drive: how well a short motif cell seeds,
 * transforms, and recurs inevitably across the whole piece.
 *
 * Sub-scores:
 *   0.25 motiveCellRecurrence   — interval-contour similarity across sections
 *   0.20 rhythmicCellRecurrence — rhythmic fingerprint repeat rate
 *   0.20 transformationDensity  — distinct transformation mode count
 *   0.20 developmentPressure    — development section harmonic density + tonicization
 *   0.15 recapInevitability     — recap closely re-states theme_a contour
 */
export function computeBeethovenianMotivicPressureScore(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
): BeethovenianMotivicPressureDetail {
    const notes: string[] = [];

    // ── Motif source: prefer theme_a, fall back to first section with capturedMotif
    const themeA = sectionArtifacts.find((a) => a.role === "theme_a");
    const sourceArtifact =
        themeA ?? sectionArtifacts.find((a) => (a.capturedMotif?.length ?? 0) > 0);

    // ── 1. motiveCellRecurrence ──────────────────────────────────────────────
    let motiveCellRecurrence = 0.3; // neutral default
    if (sourceArtifact?.capturedMotif && sourceArtifact.capturedMotif.length >= 2) {
        const sourceContour = sourceArtifact.capturedMotif;
        const otherSections = sectionArtifacts.filter(
            (a) => a.sectionId !== sourceArtifact.sectionId,
        );
        const similarities = otherSections.map((other) => {
            if (!other.capturedMotif || other.capturedMotif.length < 2) return 0;
            return contourSignMatchProportion(sourceContour, other.capturedMotif);
        });
        if (similarities.length > 0) {
            const avgSim = mean(similarities);
            motiveCellRecurrence = clamp01(0.1 + avgSim * 0.9);
            notes.push(`motif cell recurrence avg: ${avgSim.toFixed(2)}`);
        }
    } else {
        // fallback: check noteHistory contours
        if (sourceArtifact?.noteHistory && sourceArtifact.noteHistory.length >= 3) {
            const srcNoteContour = intervalContour(sourceArtifact.noteHistory.slice(0, 6));
            const others = sectionArtifacts.filter((a) => a.sectionId !== sourceArtifact.sectionId);
            const sims = others.map((a) => {
                const tgtContour = intervalContour(a.noteHistory.slice(0, 6));
                return contourSignMatchProportion(srcNoteContour, tgtContour);
            }).filter((s) => s > 0);
            if (sims.length > 0) {
                motiveCellRecurrence = clamp01(0.1 + mean(sims) * 0.8);
                notes.push(`noteHistory contour recurrence: ${mean(sims).toFixed(2)}`);
            }
        }
    }

    // ── 2. rhythmicCellRecurrence ────────────────────────────────────────────
    let rhythmicCellRecurrence = 0.3;
    if (sourceArtifact) {
        const srcCell = rhythmicCellOf(sourceArtifact);
        if (srcCell.length >= 3) {
            const others = sectionArtifacts.filter((a) => a.sectionId !== sourceArtifact.sectionId);
            const sims = others
                .map((a) => rhythmicCellSimilarity(srcCell, rhythmicCellOf(a)))
                .filter((s) => s > 0.2); // ignore near-zero matches
            if (sims.length > 0) {
                const avgRhythm = mean(sims);
                rhythmicCellRecurrence = clamp01(avgRhythm);
                notes.push(`rhythmic cell recurrence avg: ${avgRhythm.toFixed(2)}`);
            }
        }
    }

    // ── 3. transformationDensity ─────────────────────────────────────────────
    const transformModes = new Set<string>();
    for (const a of sectionArtifacts) {
        if (a.transform?.transformMode) transformModes.add(a.transform.transformMode);
        if (a.transform?.rhythmTransform) transformModes.add(`rhythm:${a.transform.rhythmTransform}`);
    }
    // Also look at plan section motifDevelopment kinds
    for (const ps of plan?.sections ?? []) {
        const md = ps.motifDevelopment as { steps?: Array<{ transformKind?: string }> } | undefined;
        for (const step of md?.steps ?? []) {
            if (step.transformKind) transformModes.add(step.transformKind);
        }
    }
    // 4+ distinct types → 1.0; 0 → 0.2
    const transformationDensity = transformModes.size === 0
        ? 0.2
        : clamp01(0.2 + (Math.min(transformModes.size, 5) / 5) * 0.8);
    if (transformModes.size > 0) {
        notes.push(`transform modes: ${[...transformModes].join(",")} (${transformModes.size})`);
    }

    // ── 4. developmentPressure ───────────────────────────────────────────────
    const devSections = sectionArtifacts.filter(
        (a) => a.role === "development" || a.role === "bridge",
    );
    let developmentPressure = 0.3;
    if (devSections.length > 0) {
        const pressureSignals: number[] = [];
        for (const dev of devSections) {
            let sig = 0.3;
            // Rich harmony density
            if (dev.harmonyDensity === "rich") sig += 0.25;
            else if (dev.harmonyDensity === "medium") sig += 0.10;
            // Has tonicization windows
            const tonicCount = dev.tonicizationWindows?.length ?? 0;
            if (tonicCount >= 2) sig += 0.25;
            else if (tonicCount === 1) sig += 0.15;
            // Bass motion is active (not pedal)
            if (dev.bassMotionProfile === "stepwise" || dev.bassMotionProfile === "mixed") sig += 0.10;
            // Section has enough events
            const noteCount = dev.melodyEvents.filter((e) => e.type === "note").length;
            if (noteCount >= 8) sig += 0.10;
            pressureSignals.push(clamp01(sig));
        }
        developmentPressure = clamp01(mean(pressureSignals));
        notes.push(`development pressure: ${developmentPressure.toFixed(2)} (${devSections.length} dev section(s))`);
    } else {
        // No dedicated development section — check if any section has high tonicization
        const anyTonicization = sectionArtifacts.some(
            (a) => (a.tonicizationWindows?.length ?? 0) >= 2,
        );
        if (anyTonicization) {
            developmentPressure = 0.5;
            notes.push("no development role but tonicization found elsewhere");
        }
    }

    // ── 5. recapInevitability ────────────────────────────────────────────────
    const recapSections = sectionArtifacts.filter((a) => a.role === "recap");
    let recapInevitability = 0.3;
    if (recapSections.length > 0 && sourceArtifact?.capturedMotif) {
        const srcContour = sourceArtifact.capturedMotif;
        const recapSims = recapSections.map((r) => {
            if (!r.capturedMotif || r.capturedMotif.length < 2) {
                // fall back to noteHistory
                const srcNH = intervalContour(sourceArtifact.noteHistory.slice(0, 6));
                const recNH = intervalContour(r.noteHistory.slice(0, 6));
                return contourSignMatchProportion(srcNH, recNH);
            }
            return contourSignMatchProportion(srcContour, r.capturedMotif);
        });
        const avgRecap = mean(recapSims);
        recapInevitability = clamp01(0.1 + avgRecap * 0.9);
        notes.push(`recap inevitability: ${avgRecap.toFixed(2)}`);
    } else if (recapSections.length > 0 && sourceArtifact) {
        // No capturedMotif but recap exists — credit for structure
        recapInevitability = 0.5;
        notes.push("recap section present (no captured motif for comparison)");
    }

    const score = clamp01(
        0.25 * motiveCellRecurrence
        + 0.20 * rhythmicCellRecurrence
        + 0.20 * transformationDensity
        + 0.20 * developmentPressure
        + 0.15 * recapInevitability,
    );

    return {
        motiveCellRecurrence: Number(motiveCellRecurrence.toFixed(4)),
        rhythmicCellRecurrence: Number(rhythmicCellRecurrence.toFixed(4)),
        transformationDensity: Number(transformationDensity.toFixed(4)),
        developmentPressure: Number(developmentPressure.toFixed(4)),
        recapInevitability: Number(recapInevitability.toFixed(4)),
        score: Number(score.toFixed(4)),
        notes: notes.join("; ") || "no motif evidence available",
    };
}

// ---------------------------------------------------------------------------
// B. SchubertianLyricExpansionScore
// ---------------------------------------------------------------------------

export interface SchubertianLyricExpansionDetail {
    /** 0–1: variance in phrase length → phrase expansion behavior */
    phraseLengthExpansion: number;
    /** 0–1: proportion of stepwise (≤2 semitone) melodic motion */
    stepwiseMelodicContinuity: number;
    /** 0–1: delayed cadences (long presentation/continuation before cadential) */
    delayedCadence: number;
    /** 0–1: arch-shaped melodic contour (rise then fall) in leading sections */
    lyricalContourArch: number;
    /** 0–1: harmonic color variety within repeated phrase material */
    repetitionWithColorShift: number;
    /** composite 0–1 */
    score: number;
    notes: string;
}

/**
 * Measures Schubertian lyric expansion: long melodic breath, stepwise motion,
 * phrase expansion, and harmonic color shifts within repetition.
 *
 * Sub-scores:
 *   0.25 phraseLengthExpansion       — stddev(measureCounts) / mean → expansion variety
 *   0.25 stepwiseMelodicContinuity   — 2-semitone step proportion across melody pitches
 *   0.20 delayedCadence              — non-cadential sections before a cadential one
 *   0.15 lyricalContourArch          — theme_a / theme_b pitch rises then falls
 *   0.15 repetitionWithColorShift    — harmonicColorCues variety alongside repeated phrase fns
 */
export function computeSchubertianLyricExpansionScore(
    sectionArtifacts: SectionArtifactSummary[],
    _plan: CompositionPlan | undefined,
): SchubertianLyricExpansionDetail {
    const notes: string[] = [];

    // ── 1. phraseLengthExpansion ─────────────────────────────────────────────
    const measureCounts = sectionArtifacts.map((a) => a.measureCount).filter((n) => n > 0);
    let phraseLengthExpansion = 0.3;
    if (measureCounts.length >= 2) {
        const m = mean(measureCounts);
        const sd = stddev(measureCounts);
        const relVariance = m > 0 ? clamp01(sd / m) : 0;
        // High variance → Schubertian expansion; normalize to [0.2, 1.0]
        phraseLengthExpansion = clamp01(0.2 + relVariance * 0.8);
        notes.push(`phrase measure stddev/mean: ${relVariance.toFixed(2)}`);
    }

    // ── 2. stepwiseMelodicContinuity ────────────────────────────────────────
    const allMelodyPitches: number[] = [];
    for (const section of sectionArtifacts) {
        const pitches = section.melodyEvents
            .filter((e) => e.type === "note" && e.pitch !== undefined)
            .map((e) => e.pitch as number);
        allMelodyPitches.push(...pitches);
    }
    const stepwiseMelodicContinuity = allMelodyPitches.length >= 4
        ? clamp01(stepwiseProportion(allMelodyPitches, 2))
        : 0.4; // neutral
    if (allMelodyPitches.length >= 4) {
        notes.push(`stepwise motion (≤2st): ${stepwiseMelodicContinuity.toFixed(2)}`);
    }

    // ── 3. delayedCadence ───────────────────────────────────────────────────
    // Count non-cadential sections before cadential ones; longer run = more Schubertian
    let delayedCadence = 0.3;
    const phraseFunctions = sectionArtifacts
        .map((a) => a.phraseFunction)
        .filter(Boolean) as string[];
    if (phraseFunctions.length >= 3) {
        const cadentialIdx = phraseFunctions.lastIndexOf("cadential");
        if (cadentialIdx > 0) {
            // How many sections precede the final cadential?
            const leadupCount = cadentialIdx;
            // Schubertian: long leadup → high score; 3+ pre-cadential sections → 0.8
            delayedCadence = clamp01(0.2 + (Math.min(leadupCount, 5) / 5) * 0.8);
            notes.push(`pre-cadential sections: ${leadupCount}`);
        }
    } else {
        // Fall back: check if the final section is not a theme section
        const lastRole = sectionArtifacts[sectionArtifacts.length - 1]?.role;
        const hasCadence = sectionArtifacts.some((a) => a.role === "cadence" || a.role === "outro");
        if (hasCadence) {
            delayedCadence = 0.55;
            notes.push("dedicated cadence/outro section present");
        } else if (lastRole === "recap") {
            delayedCadence = 0.45;
        }
    }

    // ── 4. lyricalContourArch ────────────────────────────────────────────────
    // theme_a and theme_b sections: ideal Schubertian melody = rise then fall
    const leadSections = sectionArtifacts.filter(
        (a) => a.role === "theme_a" || a.role === "theme_b" || a.role === "variation",
    );
    let lyricalContourArch = 0.3;
    if (leadSections.length > 0) {
        const archScores: number[] = [];
        for (const section of leadSections) {
            const pitches = section.melodyEvents
                .filter((e) => e.type === "note" && e.pitch !== undefined)
                .map((e) => e.pitch as number);
            if (pitches.length < 6) continue;
            // Split into first-half and second-half and check if first-half climbs
            const half = Math.floor(pitches.length / 2);
            const firstHalfMean = mean(pitches.slice(0, half));
            const secondHalfMean = mean(pitches.slice(half));
            // Peak detection: actual max is in first 60% of the melody
            const peakIdx = pitches.indexOf(Math.max(...pitches));
            const peakPosition = peakIdx / pitches.length;
            // Arch = first half higher mean OR peak in first 60%
            const archSignal =
                (firstHalfMean > secondHalfMean ? 0.5 : 0)
                + (peakPosition < 0.6 && peakPosition > 0.15 ? 0.5 : 0);
            archScores.push(clamp01(archSignal));
        }
        if (archScores.length > 0) {
            lyricalContourArch = clamp01(0.1 + mean(archScores) * 0.9);
            notes.push(`lyrical arch score: ${mean(archScores).toFixed(2)} (${archScores.length} sections)`);
        }
    }

    // ── 5. repetitionWithColorShift ─────────────────────────────────────────
    // If multiple sections share the same phraseFunction, check harmonic color variety
    const phraseFnGroups = new Map<string, SectionArtifactSummary[]>();
    for (const a of sectionArtifacts) {
        if (a.phraseFunction) {
            if (!phraseFnGroups.has(a.phraseFunction)) {
                phraseFnGroups.set(a.phraseFunction, []);
            }
            phraseFnGroups.get(a.phraseFunction)!.push(a);
        }
    }
    let repetitionWithColorShift = 0.3;
    // Find any group with ≥ 2 sections sharing a phraseFunction
    for (const [fn, group] of phraseFnGroups.entries()) {
        if (group.length < 2) continue;
        // Collect all distinct harmonicColorCues tags across the group
        const colorTags = new Set<string>();
        for (const a of group) {
            for (const cue of a.harmonicColorCues ?? []) {
                colorTags.add(cue.tag ?? "unknown");
            }
        }
        // tonicKey variety across repeated phrase group
        const tonicKeys = new Set(group.map((a) => a.tonicKey).filter(Boolean));
        const colorShift = clamp01((colorTags.size / 3) * 0.6 + (tonicKeys.size > 1 ? 0.4 : 0));
        if (colorShift > repetitionWithColorShift) {
            repetitionWithColorShift = colorShift;
            notes.push(`${fn} group (${group.length}): color tags=${colorTags.size}, tonic variety=${tonicKeys.size}`);
        }
    }
    // Also reward harmonicColorCues diversity globally (supports harmonic wandering)
    const globalColorTags = new Set<string>();
    for (const a of sectionArtifacts) {
        for (const cue of a.harmonicColorCues ?? []) {
            globalColorTags.add(cue.tag ?? "unknown");
        }
    }
    if (globalColorTags.size >= 2 && repetitionWithColorShift < 0.5) {
        repetitionWithColorShift = clamp01(0.3 + (globalColorTags.size / 4) * 0.4);
        notes.push(`global color tag variety: ${globalColorTags.size}`);
    }

    const score = clamp01(
        0.25 * phraseLengthExpansion
        + 0.25 * stepwiseMelodicContinuity
        + 0.20 * delayedCadence
        + 0.15 * lyricalContourArch
        + 0.15 * repetitionWithColorShift,
    );

    return {
        phraseLengthExpansion: Number(phraseLengthExpansion.toFixed(4)),
        stepwiseMelodicContinuity: Number(stepwiseMelodicContinuity.toFixed(4)),
        delayedCadence: Number(delayedCadence.toFixed(4)),
        lyricalContourArch: Number(lyricalContourArch.toFixed(4)),
        repetitionWithColorShift: Number(repetitionWithColorShift.toFixed(4)),
        score: Number(score.toFixed(4)),
        notes: notes.join("; ") || "no lyric expansion evidence",
    };
}

// ---------------------------------------------------------------------------
// C. MediantColorScore
// ---------------------------------------------------------------------------

export interface MediantColorDetail {
    /** 0–1: proportion of tonicization window pairs with a 3–4 semitone root distance */
    chromaticMediantRelation: number;
    /** 0–1: major↔minor tonic alternation within or across sections */
    majorMinorAmbiguity: number;
    /** 0–1: proportion of remote key areas reached (>6 semitones from home key) */
    remoteButSmoothKeyArea: number;
    /** 0–1: sudden harmonic color shift (chromatic cue) alongside phrase continuity */
    suddenColorShiftWithContinuity: number;
    /** composite 0–1 */
    score: number;
    notes: string;
}

/** Semitone distance between root letters (pitch class number 0–11). */
function rootSemitones(keyStr: string): number {
    const NOTE_MAP: Record<string, number> = {
        C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
        "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
    };
    const root = keyStr.trim().split(/\s+/)[0] ?? "C";
    return NOTE_MAP[root] ?? 0;
}

/** Minimum circular distance between two pitch class numbers. */
function pitchClassDistance(a: number, b: number): number {
    const d = Math.abs(a - b) % 12;
    return d > 6 ? 12 - d : d;
}

/**
 * Measures Schubertian mediant color: chromatic third relations, major/minor
 * ambiguity, remote key areas, and sudden harmonic color shifts.
 *
 * Sub-scores:
 *   0.30 chromaticMediantRelation         — 3 or 4-semitone root pairs in tonicizations
 *   0.25 majorMinorAmbiguity              — major↔minor alternation in tonicKey fields
 *   0.25 remoteButSmoothKeyArea           — key targets ≥ 5 semitones from home key
 *   0.20 suddenColorShiftWithContinuity   — chromatic harmonicColorCue + high phraseBreath
 */
export function computeMediantColorScore(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
): MediantColorDetail {
    const notes: string[] = [];
    const homeKeyStr = plan?.key ?? "";
    const homePc = rootSemitones(homeKeyStr);
    const homeIsMinor = homeKeyStr.toLowerCase().includes("minor");

    // Collect all tonicization key targets
    const allTargets: string[] = [];
    for (const a of sectionArtifacts) {
        for (const w of a.tonicizationWindows ?? []) {
            allTargets.push(w.keyTarget);
        }
        if (a.tonicKey) allTargets.push(a.tonicKey);
    }

    // ── 1. chromaticMediantRelation ─────────────────────────────────────────
    let chromaticMediantRelation = 0.2;
    if (allTargets.length >= 2) {
        const uniqueTargets = [...new Set(allTargets)];
        let mediantPairs = 0;
        let totalPairs = 0;
        for (let i = 0; i < uniqueTargets.length; i++) {
            for (let j = i + 1; j < uniqueTargets.length; j++) {
                const d = pitchClassDistance(
                    rootSemitones(uniqueTargets[i]!),
                    rootSemitones(uniqueTargets[j]!),
                );
                if (d === 3 || d === 4) mediantPairs++;
                totalPairs++;
            }
        }
        if (totalPairs > 0) {
            chromaticMediantRelation = clamp01(0.1 + (mediantPairs / totalPairs) * 0.9);
            notes.push(`mediant pairs: ${mediantPairs}/${totalPairs} key pairs`);
        }
    }

    // ── 2. majorMinorAmbiguity ───────────────────────────────────────────────
    const tonicKeys = sectionArtifacts.map((a) => a.tonicKey).filter(Boolean) as string[];
    let majorMinorAmbiguity = 0.2;
    if (tonicKeys.length >= 2) {
        let majorCount = 0;
        let minorCount = 0;
        let sameTonic = 0; // same root but different mode
        for (const key of tonicKeys) {
            if (key.toLowerCase().includes("minor")) minorCount++;
            else majorCount++;
        }
        // Reward balance between major and minor (Schubertian ambiguity)
        const total = majorCount + minorCount;
        const balance = total > 0 ? 1 - Math.abs(majorCount - minorCount) / total : 0;

        // Check for same-root key alternation (e.g. A major / A minor)
        const rootGroups = new Map<number, Set<string>>();
        for (const key of tonicKeys) {
            const pc = rootSemitones(key);
            if (!rootGroups.has(pc)) rootGroups.set(pc, new Set());
            rootGroups.get(pc)!.add(key.toLowerCase().includes("minor") ? "minor" : "major");
        }
        for (const modes of rootGroups.values()) {
            if (modes.size >= 2) sameTonic++;
        }

        // Also check if any tonicization target has opposite mode from home
        const oppositeMode = allTargets.some((t) => {
            const tIsMinor = t.toLowerCase().includes("minor");
            return tIsMinor !== homeIsMinor;
        });

        majorMinorAmbiguity = clamp01(
            0.3 * balance
            + 0.4 * clamp01(sameTonic / Math.max(1, rootGroups.size))
            + 0.3 * (oppositeMode ? 1 : 0),
        );
        notes.push(
            `major/minor: ${majorCount}M/${minorCount}m, same-root alternation: ${sameTonic}, opposite from home: ${oppositeMode}`,
        );
    } else if (homeKeyStr) {
        // Check tonicization targets against home mode
        const oppositeMode = allTargets.some((t) => {
            const tIsMinor = t.toLowerCase().includes("minor");
            return tIsMinor !== homeIsMinor;
        });
        if (oppositeMode) {
            majorMinorAmbiguity = 0.5;
            notes.push("tonicization includes opposite mode from home key");
        }
    }

    // ── 3. remoteButSmoothKeyArea ────────────────────────────────────────────
    let remoteButSmoothKeyArea = 0.2;
    const remoteTargets = allTargets.filter((t) => {
        const d = pitchClassDistance(rootSemitones(t), homePc);
        return d >= 5; // tritone or more from home key root
    });
    if (allTargets.length > 0) {
        const remoteRatio = remoteTargets.length / allTargets.length;
        // Schubertian: some remote is good; too much is wandering without purpose
        // Optimal: 20–50% remote targets
        const optimalRatio = remoteRatio >= 0.2 && remoteRatio <= 0.6
            ? 1.0
            : remoteRatio < 0.2
            ? remoteRatio / 0.2
            : 1 - (remoteRatio - 0.6) / 0.4;
        remoteButSmoothKeyArea = clamp01(0.2 + optimalRatio * 0.8);
        notes.push(`remote key areas: ${remoteTargets.length}/${allTargets.length} (ratio=${remoteRatio.toFixed(2)})`);
    }

    // ── 4. suddenColorShiftWithContinuity ────────────────────────────────────
    // A color shift: harmonicColorCue with "chromatic" type appears while
    // the section keeps phrase continuity (non-cadential phraseFunction)
    let suddenColorShiftWithContinuity = 0.2;
    const colorShiftSections = sectionArtifacts.filter((a) => {
        const hasChromaticCue = (a.harmonicColorCues ?? []).some(
            (cue) => cue.tag === "mixture" || cue.tag === "neapolitan" || cue.tag === "aug6",
        );
        const hasBreath = (a.phraseBreathSummary?.realizedNoteCount ?? 0) > 0
            || a.phraseFunction === "continuation"
            || a.phraseFunction === "presentation";
        return hasChromaticCue && hasBreath;
    });
    if (colorShiftSections.length > 0) {
        const shiftRatio = colorShiftSections.length / sectionArtifacts.length;
        // Optimal: at least 1–2 shifts; too many = no contrast
        suddenColorShiftWithContinuity = clamp01(0.2 + Math.min(shiftRatio, 0.5) * 1.6);
        notes.push(
            `color shift with continuity: ${colorShiftSections.length} section(s) (${(shiftRatio * 100).toFixed(0)}%)`,
        );
    } else {
        // Fallback: harmonicColorCues exist but no strong phrase continuity signal
        const anyChromaticCues = sectionArtifacts.some(
            (a) => (a.harmonicColorCues ?? []).some(
                (cue) => cue.tag === "mixture" || cue.tag === "applied_dominant",
            ),
        );
        if (anyChromaticCues) {
            suddenColorShiftWithContinuity = 0.35;
            notes.push("chromatic harmonic cues present");
        }
    }

    const score = clamp01(
        0.30 * chromaticMediantRelation
        + 0.25 * majorMinorAmbiguity
        + 0.25 * remoteButSmoothKeyArea
        + 0.20 * suddenColorShiftWithContinuity,
    );

    return {
        chromaticMediantRelation: Number(chromaticMediantRelation.toFixed(4)),
        majorMinorAmbiguity: Number(majorMinorAmbiguity.toFixed(4)),
        remoteButSmoothKeyArea: Number(remoteButSmoothKeyArea.toFixed(4)),
        suddenColorShiftWithContinuity: Number(suddenColorShiftWithContinuity.toFixed(4)),
        score: Number(score.toFixed(4)),
        notes: notes.join("; ") || "no harmonic color evidence",
    };
}

// ---------------------------------------------------------------------------
// Composite entry point
// ---------------------------------------------------------------------------

export interface AxiomAestheticScores {
    beethovenianMotivicPressure: BeethovenianMotivicPressureDetail;
    schubertianLyricExpansion: SchubertianLyricExpansionDetail;
    mediantColor: MediantColorDetail;
}

/**
 * Computes all three AXIOM aesthetic identity scores in a single call.
 */
export function computeAxiomAestheticScores(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
): AxiomAestheticScores {
    return {
        beethovenianMotivicPressure: computeBeethovenianMotivicPressureScore(sectionArtifacts, plan),
        schubertianLyricExpansion: computeSchubertianLyricExpansionScore(sectionArtifacts, plan),
        mediantColor: computeMediantColorScore(sectionArtifacts, plan),
    };
}
