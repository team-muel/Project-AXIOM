import type {
    SectionArtifactSummary,
    SectionRenderEventArtifact,
} from "../pipeline/types.js";
import { applyPianoProjection } from "./pianoProjection.js";

// pianoRepairSolver.ts — Piano idiom repair pass
// ──────────────────────────────────────────────────────────────────────────────
// Sits between NotaGen keyboard candidates and the craft-scoring gate.
// Post-processes SectionArtifactSummary event arrays to correct piano-idiom
// violations without re-composing the piece.  Musical contour, rhythm, and
// harmonic intent are preserved; only physical realization is adjusted.
//
// Pipeline position:
//   NotaGen candidates → ABC/MIDI projection → piano_repair_solver.py (Python)
//   → piano playability gate → PianoRepairSolver (this, TS) → craft scoring
//   → localized rewrite
//
// Relationship to Python repair (piano_repair_solver.py):
//   Python repair runs BEFORE the MIDI file is written and directly corrects
//   the rendered audio.  This module runs AFTERWARDS on SectionArtifactSummary
//   event arrays to re-derive the 21 piano* evidence fields so craft scoring
//   and Gate 3 see accurate post-repair metrics.  When `proposalMidiRewritten`
//   is true in the Python response the MIDI already reflects all corrections;
//   this module's job is then purely to update scoring evidence.
//
// Seven repair kinds:
//   1. chord_span_revoice    — inner voices dropped when hand span exceeds limit
//   2. register_correction   — notes outside idiomatic range octave-shifted
//   3. leap_attenuation      — RH melody leaps > limit compressed by ±12
//   4. bass_reinforcement    — LH lacking bass territory shifted into range
//   5. voicing_clarity       — LH notes crowding RH register removed
//   6. pedal_change_increase — blur risk metadata flagged; change count updated
//   7. chord_thinning        — chords exceeding voice-count limit trimmed
//
// The module is pure / immutable: original artifacts are never mutated.
// After all repairs, applyPianoProjection() re-derives the 21 projection
// evidence fields so downstream evaluators see updated metrics.
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PianoRepairKind =
    | "chord_span_revoice"
    | "register_correction"
    | "leap_attenuation"
    | "bass_reinforcement"
    | "voicing_clarity"
    | "pedal_change_increase"
    | "chord_thinning";

export interface PianoRepairAction {
    kind: PianoRepairKind;
    sectionId: string;
    description: string;
    severity: "minor" | "moderate" | "major";
}

export interface PianoRepairOptions {
    /** Max comfortable right-hand chord span in semitones (default 14 = major 9th). */
    maxRHSpan?: number;
    /** Max comfortable left-hand chord span in semitones (default 12 = octave). */
    maxLHSpan?: number;
    /** Minimum idiomatic RH pitch — below this is shifted up (default 48 = C3). */
    rhRegisterFloor?: number;
    /** Maximum idiomatic LH pitch — above this is shifted down (default 72 = C5). */
    lhRegisterCeiling?: number;
    /** Maximum melodic interval before attenuation kicks in, semitones (default 12). */
    maxLeapSemitones?: number;
    /** Maximum simultaneous note count per chord event (default 6). */
    maxSimultaneousNotes?: number;
    /** pianoPedalBlurRisk threshold above which pedal changes are recommended (default 0.60). */
    pedalBlurThreshold?: number;
    /** Restrict to only these repair kinds.  Omit or pass undefined to enable all. */
    enabledRepairs?: PianoRepairKind[];
}

export interface PianoRepairResult {
    sectionId: string;
    /** true when at least one repair was applied. */
    repaired: boolean;
    repairCount: number;
    actions: PianoRepairAction[];
    /** A new SectionArtifactSummary with updated events and projection evidence. */
    updatedArtifact: SectionArtifactSummary;
    /** True when the Python pipeline already rewrote the MIDI file via
     *  piano_repair_solver.py + write_midi_from_events().  In that case this
     *  TypeScript pass updates scoring evidence only; the rendered audio is
     *  already corrected.  Callers should set this from `proposalMidiRewritten`
     *  in the LearnedSymbolicProposalResponse. */
    midiRewritten?: boolean;
}

// ---------------------------------------------------------------------------
// Internal option resolution
// ---------------------------------------------------------------------------

const ALL_REPAIRS: PianoRepairKind[] = [
    "chord_span_revoice",
    "register_correction",
    "leap_attenuation",
    "bass_reinforcement",
    "voicing_clarity",
    "pedal_change_increase",
    "chord_thinning",
];

interface ResolvedOptions {
    maxRHSpan: number;
    maxLHSpan: number;
    rhRegisterFloor: number;
    lhRegisterCeiling: number;
    maxLeapSemitones: number;
    maxSimultaneousNotes: number;
    pedalBlurThreshold: number;
    enabledRepairs: Set<PianoRepairKind>;
}

function resolveOptions(opts?: PianoRepairOptions): ResolvedOptions {
    return {
        maxRHSpan:            opts?.maxRHSpan            ?? 14,
        maxLHSpan:            opts?.maxLHSpan            ?? 12,
        rhRegisterFloor:      opts?.rhRegisterFloor      ?? 48,
        lhRegisterCeiling:    opts?.lhRegisterCeiling    ?? 72,
        maxLeapSemitones:     opts?.maxLeapSemitones     ?? 12,
        maxSimultaneousNotes: opts?.maxSimultaneousNotes ?? 6,
        pedalBlurThreshold:   opts?.pedalBlurThreshold   ?? 0.60,
        enabledRepairs:       new Set(opts?.enabledRepairs ?? ALL_REPAIRS),
    };
}

// ---------------------------------------------------------------------------
// Event helpers (immutable)
// ---------------------------------------------------------------------------

function pitchesOf(event: SectionRenderEventArtifact): number[] {
    if (event.type === "chord") {
        if (event.pitches?.length) return event.pitches;
        if (event.pitch !== undefined) return [event.pitch];
    }
    if (event.type === "note" && event.pitch !== undefined) return [event.pitch];
    return [];
}

function withPitches(
    event: SectionRenderEventArtifact,
    newPitches: number[],
): SectionRenderEventArtifact {
    if (newPitches.length === 0) return event;
    if (newPitches.length === 1) {
        return { ...event, type: "note", pitch: newPitches[0], pitches: undefined };
    }
    return { ...event, type: "chord", pitches: newPitches, pitch: undefined };
}

// ---------------------------------------------------------------------------
// Repair 1: chord_span_revoice
// ---------------------------------------------------------------------------

/**
 * When a chord event's span (max − min pitch) exceeds maxSpan, inner voices
 * are pruned until the span fits.  The bass (lowest) and melody (highest)
 * notes are always kept.
 */
function repairChordSpan(
    events: SectionRenderEventArtifact[],
    maxSpan: number,
    sectionId: string,
): { events: SectionRenderEventArtifact[]; actions: PianoRepairAction[] } {
    const actions: PianoRepairAction[] = [];
    let count = 0;

    const out = events.map((ev) => {
        const ps = pitchesOf(ev);
        if (ps.length < 2) return ev;

        const span = Math.max(...ps) - Math.min(...ps);
        if (span <= maxSpan) return ev;

        const sorted = [...ps].sort((a, b) => a - b);
        const bass   = sorted[0]!;
        const melody = sorted[sorted.length - 1]!;
        const inner  = sorted.slice(1, -1).filter((p) => p - bass <= maxSpan);
        const newPs  = [bass, ...inner, melody];
        if (newPs.length === ps.length) return ev;

        count++;
        return withPitches(ev, newPs);
    });

    if (count > 0) {
        actions.push({
            kind: "chord_span_revoice",
            sectionId,
            description: `re-voiced ${count} chord(s) exceeding span of ${maxSpan} semitones`,
            severity: count > 4 ? "major" : "moderate",
        });
    }
    return { events: out, actions };
}

// ---------------------------------------------------------------------------
// Repair 2: register_correction
// ---------------------------------------------------------------------------

/**
 * Notes outside the idiomatic register are shifted by ±12 semitones.
 * Right hand: below `floor` → +12.  Left hand: above `ceiling` → −12.
 */
function repairRegister(
    events: SectionRenderEventArtifact[],
    floor: number,
    ceiling: number,
    sectionId: string,
    hand: "right" | "left",
): { events: SectionRenderEventArtifact[]; actions: PianoRepairAction[] } {
    const actions: PianoRepairAction[] = [];
    let tooLow = 0;
    let tooHigh = 0;

    const out = events.map((ev) => {
        const ps = pitchesOf(ev);
        if (ps.length === 0) return ev;

        const adjusted = ps.map((p) => {
            if (p < floor)   { tooLow++;  return p + 12; }
            if (p > ceiling) { tooHigh++; return p - 12; }
            return p;
        });
        if (adjusted.every((p, i) => p === ps[i])) return ev;
        return withPitches(ev, adjusted);
    });

    const label = hand === "right" ? "RH" : "LH";
    if (tooLow > 0) {
        actions.push({
            kind: "register_correction",
            sectionId,
            description: `${label}: +12 on ${tooLow} note(s) below MIDI ${floor}`,
            severity: tooLow > 4 ? "moderate" : "minor",
        });
    }
    if (tooHigh > 0) {
        actions.push({
            kind: "register_correction",
            sectionId,
            description: `${label}: −12 on ${tooHigh} note(s) above MIDI ${ceiling}`,
            severity: tooHigh > 4 ? "moderate" : "minor",
        });
    }
    return { events: out, actions };
}

// ---------------------------------------------------------------------------
// Repair 3: leap_attenuation  (melody / right-hand single notes only)
// ---------------------------------------------------------------------------

/**
 * When two consecutive single-note melody events form an interval larger than
 * maxLeap semitones, the second note is octave-transposed toward the first to
 * minimise the leap.  Chord events and rest events are skipped.
 */
function repairLeaps(
    events: SectionRenderEventArtifact[],
    maxLeap: number,
    sectionId: string,
): { events: SectionRenderEventArtifact[]; actions: PianoRepairAction[] } {
    const actions: PianoRepairAction[] = [];
    const out = events.map((e) => ({ ...e })); // shallow copy

    let repaired = 0;
    let prevPitch: number | undefined;

    for (let i = 0; i < out.length; i++) {
        const ev = out[i]!;
        if (ev.type === "rest") { prevPitch = undefined; continue; }
        if (ev.type !== "note" || ev.pitch === undefined) {
            // For chord events, update prevPitch to the top note
            const ps = pitchesOf(ev);
            if (ps.length > 0) prevPitch = Math.max(...ps);
            continue;
        }

        if (prevPitch !== undefined) {
            const interval = ev.pitch - prevPitch;
            if (Math.abs(interval) > maxLeap) {
                const shift = interval > 0 ? -12 : 12;
                out[i] = { ...ev, pitch: ev.pitch + shift };
                repaired++;
            }
        }
        prevPitch = out[i]!.pitch;
    }

    if (repaired > 0) {
        actions.push({
            kind: "leap_attenuation",
            sectionId,
            description: `attenuated ${repaired} leap(s) > ${maxLeap} semitones`,
            severity: repaired > 3 ? "moderate" : "minor",
        });
    }
    return { events: out, actions };
}

// ---------------------------------------------------------------------------
// Repair 4: bass_reinforcement
// ---------------------------------------------------------------------------

// Notes at or below this MIDI pitch are considered in "bass territory".
const BASS_TERRITORY_CEIL = 52; // E3

/**
 * When no left-hand event contains a note below E3 (MIDI 52), the section
 * has no bass grounding.  The globally lowest-pitched events are shifted down
 * one octave to put them in bass territory.
 */
function repairBassReinforcement(
    events: SectionRenderEventArtifact[],
    sectionId: string,
): { events: SectionRenderEventArtifact[]; actions: PianoRepairAction[] } {
    const actions: PianoRepairAction[] = [];
    const noteEvents = events.filter((e) => e.type !== "rest");
    if (noteEvents.length === 0) return { events, actions };

    const allPitches = noteEvents.flatMap(pitchesOf);
    if (allPitches.length === 0) return { events, actions };

    const hasBass = allPitches.some((p) => p <= BASS_TERRITORY_CEIL);
    if (hasBass) return { events, actions };

    const globalMin = Math.min(...allPitches);
    let shifted = 0;

    const out = events.map((ev) => {
        const ps = pitchesOf(ev);
        if (ps.length === 0) return ev;
        if (!ps.includes(globalMin)) return ev;

        const adjusted = ps.map((p) => (p === globalMin ? p - 12 : p));
        shifted++;
        return withPitches(ev, adjusted);
    });

    if (shifted > 0) {
        actions.push({
            kind: "bass_reinforcement",
            sectionId,
            description: `LH lacks bass below E3 — shifted ${shifted} bass event(s) down one octave from MIDI ${globalMin}`,
            severity: "moderate",
        });
    }
    return { events: out, actions };
}

// ---------------------------------------------------------------------------
// Repair 5: voicing_clarity
// ---------------------------------------------------------------------------

/**
 * Left-hand notes that intrude above the right-hand's lowest sounding pitch
 * collide with the melody register.  Such notes are removed from the LH event
 * to clear space for the melody.  Events that would become empty are left
 * unchanged to avoid silencing an entire beat.
 */
function repairVoicingClarity(
    lhEvents: SectionRenderEventArtifact[],
    rhMinPitch: number,
    sectionId: string,
): { events: SectionRenderEventArtifact[]; actions: PianoRepairAction[] } {
    const actions: PianoRepairAction[] = [];
    if (rhMinPitch <= 0) return { events: lhEvents, actions };

    let removed = 0;

    const out = lhEvents.map((ev) => {
        const ps = pitchesOf(ev);
        if (ps.length === 0) return ev;

        const filtered = ps.filter((p) => p < rhMinPitch);
        if (filtered.length === ps.length) return ev;
        if (filtered.length === 0) return ev; // keep rather than silence
        removed += ps.length - filtered.length;
        return withPitches(ev, filtered);
    });

    if (removed > 0) {
        actions.push({
            kind: "voicing_clarity",
            sectionId,
            description: `removed ${removed} LH note(s) at or above RH floor (MIDI ${rhMinPitch}) to clear melody space`,
            severity: removed > 5 ? "moderate" : "minor",
        });
    }
    return { events: out, actions };
}

// ---------------------------------------------------------------------------
// Repair 6: pedal_change_increase  (metadata only — no event synthesis)
// ---------------------------------------------------------------------------

/**
 * When pianoPedalBlurRisk exceeds the threshold, sustained pedal is blurring
 * harmony changes.  This repair increases the `pianoPedalChangeCount` field
 * on the artifact and logs the recommendation; actual MIDI pedal events are
 * handled downstream by the humanizer.
 */
function repairPedalChangeIncrease(
    artifact: SectionArtifactSummary,
    threshold: number,
): { actions: PianoRepairAction[]; additionalPedalChanges: number } {
    const blurRisk = artifact.pianoPedalBlurRisk ?? 0;
    if (blurRisk <= threshold) return { actions: [], additionalPedalChanges: 0 };

    const additionalChanges = Math.max(1, Math.ceil(artifact.measureCount * (blurRisk - threshold) * 2));
    return {
        actions: [{
            kind: "pedal_change_increase",
            sectionId: artifact.sectionId,
            description: `blur risk ${blurRisk.toFixed(2)} > threshold ${threshold}: +${additionalChanges} pedal change(s) recommended`,
            severity: blurRisk > 0.80 ? "major" : "moderate",
        }],
        additionalPedalChanges: additionalChanges,
    };
}

// ---------------------------------------------------------------------------
// Repair 7: chord_thinning
// ---------------------------------------------------------------------------

/**
 * Chord events with more simultaneous notes than maxNotes are trimmed.
 * The bass (lowest) and melody (highest) pitches are always preserved.
 * Inner voices are kept from the top down to fill the allowed count.
 */
function repairChordThinning(
    events: SectionRenderEventArtifact[],
    maxNotes: number,
    sectionId: string,
): { events: SectionRenderEventArtifact[]; actions: PianoRepairAction[] } {
    const actions: PianoRepairAction[] = [];
    let count = 0;

    const out = events.map((ev) => {
        const ps = pitchesOf(ev);
        if (ps.length <= maxNotes) return ev;

        const sorted  = [...ps].sort((a, b) => a - b);
        const bass    = sorted[0]!;
        const melody  = sorted[sorted.length - 1]!;
        const inner   = sorted.slice(1, -1);
        const keepInner = inner.slice(-(maxNotes - 2));
        const newPs   = [bass, ...keepInner, melody];

        count++;
        return withPitches(ev, newPs);
    });

    if (count > 0) {
        actions.push({
            kind: "chord_thinning",
            sectionId,
            description: `thinned ${count} chord(s) to max ${maxNotes} simultaneous notes`,
            severity: count > 3 ? "moderate" : "minor",
        });
    }
    return { events: out, actions };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Applies all enabled piano-idiom repairs to a single section artifact.
 *
 * Repair order:
 *   1. chord_span_revoice    — structural: fix wide spans first
 *   2. register_correction   — pitch range: fix out-of-range notes
 *   3. leap_attenuation      — melodic shape: compress large leaps
 *   4. bass_reinforcement    — LH bass: ensure bass territory coverage
 *   5. voicing_clarity       — register separation: clear melody space
 *   6. pedal_change_increase — pedal metadata update
 *   7. chord_thinning        — density: final voice-count pass
 *
 * After repairs, `applyPianoProjection()` re-derives the 21 flat piano*
 * evidence fields so Gate 3 and craft scoring see accurate metrics.
 */
export function repairPianoSection(
    artifact: SectionArtifactSummary,
    options?: PianoRepairOptions,
): PianoRepairResult {
    const opts = resolveOptions(options);
    const { sectionId } = artifact;
    const allActions: PianoRepairAction[] = [];

    let rhEvents = [...artifact.melodyEvents];
    let lhEvents = [...artifact.accompanimentEvents];

    // 1. chord_span_revoice
    if (opts.enabledRepairs.has("chord_span_revoice")) {
        const r1rh = repairChordSpan(rhEvents, opts.maxRHSpan, sectionId);
        const r1lh = repairChordSpan(lhEvents, opts.maxLHSpan, sectionId);
        rhEvents = r1rh.events;
        lhEvents = r1lh.events;
        allActions.push(...r1rh.actions, ...r1lh.actions);
    }

    // 2. register_correction
    if (opts.enabledRepairs.has("register_correction")) {
        const r2rh = repairRegister(rhEvents, opts.rhRegisterFloor, 108, sectionId, "right");
        const r2lh = repairRegister(lhEvents, 24, opts.lhRegisterCeiling, sectionId, "left");
        rhEvents = r2rh.events;
        lhEvents = r2lh.events;
        allActions.push(...r2rh.actions, ...r2lh.actions);
    }

    // 3. leap_attenuation (RH melody only)
    if (opts.enabledRepairs.has("leap_attenuation")) {
        const r3 = repairLeaps(rhEvents, opts.maxLeapSemitones, sectionId);
        rhEvents = r3.events;
        allActions.push(...r3.actions);
    }

    // 4. bass_reinforcement (LH)
    if (opts.enabledRepairs.has("bass_reinforcement")) {
        const r4 = repairBassReinforcement(lhEvents, sectionId);
        lhEvents = r4.events;
        allActions.push(...r4.actions);
    }

    // 5. voicing_clarity (LH, using current RH min pitch as boundary)
    if (opts.enabledRepairs.has("voicing_clarity")) {
        const rhPitches = rhEvents.flatMap(pitchesOf);
        const rhMinPitch = rhPitches.length > 0 ? Math.min(...rhPitches) : 0;
        const r5 = repairVoicingClarity(lhEvents, rhMinPitch, sectionId);
        lhEvents = r5.events;
        allActions.push(...r5.actions);
    }

    // 6. pedal_change_increase (metadata)
    let additionalPedalChanges = 0;
    if (opts.enabledRepairs.has("pedal_change_increase")) {
        const r6 = repairPedalChangeIncrease(artifact, opts.pedalBlurThreshold);
        additionalPedalChanges = r6.additionalPedalChanges;
        allActions.push(...r6.actions);
    }

    // 7. chord_thinning (both hands)
    if (opts.enabledRepairs.has("chord_thinning")) {
        const r7rh = repairChordThinning(rhEvents, opts.maxSimultaneousNotes, sectionId);
        const r7lh = repairChordThinning(lhEvents, opts.maxSimultaneousNotes, sectionId);
        rhEvents = r7rh.events;
        lhEvents = r7lh.events;
        allActions.push(...r7rh.actions, ...r7lh.actions);
    }

    const patchedEvents: SectionArtifactSummary = {
        ...artifact,
        melodyEvents:        rhEvents,
        accompanimentEvents: lhEvents,
    };

    // Re-derive the 21 piano* projection evidence fields after event repairs.
    // Projection overwrites pianoPedalChangeCount with layout.pedalEventCount,
    // so the pedal-change recommendation is applied AFTER projection.
    let updatedArtifact = applyPianoProjection(patchedEvents);

    if (additionalPedalChanges > 0) {
        updatedArtifact = {
            ...updatedArtifact,
            pianoPedalChangeCount: (updatedArtifact.pianoPedalChangeCount ?? 0) + additionalPedalChanges,
        };
    }

    return {
        sectionId,
        repaired:    allActions.length > 0,
        repairCount: allActions.length,
        actions:     allActions,
        updatedArtifact,
    };
}

/**
 * Batch version of repairPianoSection.
 * Repairs all sections and returns an aggregate result with the updated
 * artifact array ready for the next pipeline stage.
 */
export function repairPianoCandidates(
    artifacts: SectionArtifactSummary[],
    options?: PianoRepairOptions,
): {
    results:       PianoRepairResult[];
    anyRepaired:   boolean;
    repairedArtifacts: SectionArtifactSummary[];
} {
    const results = artifacts.map((a) => repairPianoSection(a, options));
    return {
        results,
        anyRepaired:       results.some((r) => r.repaired),
        repairedArtifacts: results.map((r) => r.updatedArtifact),
    };
}
