"""Piano idiom repair solver for the solo_piano_symbolic lane.

Runs in abc_project.py Stage 5.5, after piano enrichment and BEFORE the
optional MIDI re-write (Stage 6).  Repairs are therefore reflected in the
rendered MIDI output that listeners actually hear.

Mirrors the 7 repair kinds from src/pipeline/pianoRepairSolver.ts but operates
on Python event dicts produced by abc_to_events.py:

    {"kind": "note",  "midi": int, "quarterLength": float, "velocity": int, "role": str}
    {"kind": "chord", "midiPitches": [int], "quarterLength": float, "velocity": int, "role": str}
    {"kind": "rest",  "quarterLength": float, "role": str}

The TypeScript pianoRepairSolver.ts still runs afterwards on SectionArtifactSummary
event arrays for craft-score metric updates, but the underlying MIDI file is
already corrected here.  The `midi_rewritten` flag on AbcProjectionResult
signals to TypeScript that the MIDI reflects Python-side repairs.
"""

from __future__ import annotations

from typing import Any

Event = dict[str, Any]

# ─── Default repair thresholds ────────────────────────────────────────────────

MAX_RH_SPAN: int = 14   # comfortable RH chord span, semitones (major 9th)
MAX_LH_SPAN: int = 12   # comfortable LH chord span, semitones (octave)
RH_FLOOR: int = 48      # C3 — RH notes below here are shifted up
LH_CEILING: int = 72    # C5 — LH notes above here are shifted down
MAX_LEAP: int = 12      # RH melodic leap limit before attenuation (semitones)
BASS_CEILING: int = 52  # E3 — pitches below this are "bass territory"
MAX_NOTES: int = 6      # max simultaneous voices per chord event


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _pitches_of(event: Event) -> list[int]:
    """Return all MIDI pitches in an event (empty list for rests)."""
    if event.get("kind") == "chord":
        raw = event.get("midiPitches") or []
        return [int(p) for p in raw if isinstance(p, (int, float))]
    p = event.get("midi") or event.get("pitch")
    if isinstance(p, (int, float)):
        return [int(p)]
    return []


def _set_pitches(event: Event, pitches: list[int]) -> Event:
    """Return a shallow copy of *event* with updated pitch data."""
    ev = dict(event)
    if ev.get("kind") == "chord":
        ev["midiPitches"] = sorted(pitches)
    else:
        ev["midi"] = pitches[0] if pitches else int(event.get("midi") or 60)
    return ev


# ─── Repair 1: chord_span_revoice ────────────────────────────────────────────

def _repair_chord_span(
    events: list[Event],
    max_span: int,
    label: str,
) -> tuple[list[Event], list[dict[str, Any]]]:
    """Drop inner voices from chord events whose span exceeds *max_span*.

    Bass (lowest) and melody (highest) pitches are always preserved.
    Inner voices are greedily added back (highest first) as long as the
    resulting span stays within *max_span*.
    """
    out: list[Event] = []
    actions: list[dict[str, Any]] = []

    for ev in events:
        if ev.get("kind") != "chord":
            out.append(ev)
            continue

        pitches = _pitches_of(ev)
        if len(pitches) < 2 or (max(pitches) - min(pitches)) <= max_span:
            out.append(ev)
            continue

        keep = [pitches[0], pitches[-1]]
        for p in reversed(pitches[1:-1]):
            candidate = sorted(keep + [p])
            if max(candidate) - min(candidate) <= max_span:
                keep.append(p)
        keep = sorted(keep)

        if keep != pitches:
            out.append(_set_pitches(ev, keep))
            actions.append({
                "kind": "chord_span_revoice",
                "label": label,
                "before": pitches,
                "after": keep,
            })
        else:
            out.append(ev)

    return out, actions


# ─── Repair 2: register_correction ───────────────────────────────────────────

def _repair_register(
    events: list[Event],
    floor: int,
    ceiling: int,
    label: str,
) -> tuple[list[Event], list[dict[str, Any]]]:
    """Octave-shift notes that fall outside [floor, ceiling]."""
    out: list[Event] = []
    actions: list[dict[str, Any]] = []

    for ev in events:
        pitches = _pitches_of(ev)
        if not pitches:
            out.append(ev)
            continue

        new_pitches = list(pitches)
        changed = False
        for i, p in enumerate(new_pitches):
            while new_pitches[i] < floor:
                new_pitches[i] += 12
                changed = True
            while new_pitches[i] > ceiling:
                new_pitches[i] -= 12
                changed = True

        if changed:
            out.append(_set_pitches(ev, new_pitches))
            actions.append({
                "kind": "register_correction",
                "label": label,
                "before": pitches,
                "after": new_pitches,
            })
        else:
            out.append(ev)

    return out, actions


# ─── Repair 3: leap_attenuation ──────────────────────────────────────────────

def _repair_leaps(
    events: list[Event],
    max_leap: int,
) -> tuple[list[Event], list[dict[str, Any]]]:
    """Compress RH melody leaps > *max_leap* semitones by ±12 toward previous."""
    note_positions = [
        (i, ev) for i, ev in enumerate(events) if ev.get("kind") == "note"
    ]
    modified: dict[int, int] = {}
    actions: list[dict[str, Any]] = []

    for k in range(1, len(note_positions)):
        prev_idx, prev_ev = note_positions[k - 1]
        curr_idx, curr_ev = note_positions[k]
        prev_pitch = modified.get(prev_idx, int(prev_ev.get("midi") or 60))
        curr_pitch = int(curr_ev.get("midi") or 60)
        interval = curr_pitch - prev_pitch

        if abs(interval) > max_leap:
            adjustment = -12 if interval > 0 else 12
            modified[curr_idx] = curr_pitch + adjustment
            actions.append({
                "kind": "leap_attenuation",
                "before": curr_pitch,
                "after": modified[curr_idx],
                "interval": interval,
            })

    if not modified:
        return events, []

    out = list(events)
    for idx, new_pitch in modified.items():
        ev = dict(events[idx])
        ev["midi"] = new_pitch
        out[idx] = ev
    return out, actions


# ─── Repair 4: bass_reinforcement ────────────────────────────────────────────

def _repair_bass_reinforcement(
    events: list[Event],
) -> tuple[list[Event], list[dict[str, Any]]]:
    """If no LH event has a pitch in bass territory, shift the lowest down 12."""
    all_pitches = [p for ev in events for p in _pitches_of(ev)]
    if not all_pitches or min(all_pitches) < BASS_CEILING:
        return events, []

    global_min = min(all_pitches)
    out = list(events)
    for i, ev in enumerate(events):
        ps = _pitches_of(ev)
        if ps and min(ps) == global_min:
            new_ps = [p - 12 for p in ps]
            out[i] = _set_pitches(ev, new_ps)
            return out, [{
                "kind": "bass_reinforcement",
                "before": ps,
                "after": new_ps,
            }]

    return events, []


# ─── Repair 5: voicing_clarity ────────────────────────────────────────────────

def _repair_voicing_clarity(
    lh_events: list[Event],
    rh_min_pitch: int,
) -> tuple[list[Event], list[dict[str, Any]]]:
    """Remove LH notes that crowd the RH register (>= rh_min_pitch)."""
    out: list[Event] = []
    actions: list[dict[str, Any]] = []

    for ev in lh_events:
        if ev.get("kind") == "chord":
            pitches = _pitches_of(ev)
            kept = [p for p in pitches if p < rh_min_pitch]
            if not kept and pitches:
                kept = [pitches[0]]  # always preserve at least the bass note
            if len(kept) != len(pitches):
                out.append(_set_pitches(ev, kept))
                actions.append({
                    "kind": "voicing_clarity",
                    "before": pitches,
                    "after": kept,
                })
                continue
        elif ev.get("kind") == "note":
            p = int(ev.get("midi") or 0)
            if p >= rh_min_pitch:
                actions.append({"kind": "voicing_clarity", "removed_pitch": p})
                continue  # drop the note entirely
        out.append(ev)

    return out, actions


# ─── Repair 7: chord_thinning ────────────────────────────────────────────────

def _repair_chord_thinning(
    events: list[Event],
    max_notes: int,
) -> tuple[list[Event], list[dict[str, Any]]]:
    """Trim chords exceeding *max_notes* voices; always keep bass and melody."""
    out: list[Event] = []
    actions: list[dict[str, Any]] = []

    for ev in events:
        if ev.get("kind") != "chord":
            out.append(ev)
            continue

        pitches = _pitches_of(ev)
        if len(pitches) <= max_notes:
            out.append(ev)
            continue

        # Keep bass (pitches[0]) + top (max_notes-1) highest voices
        kept = sorted([pitches[0]] + pitches[-(max_notes - 1):])
        out.append(_set_pitches(ev, kept))
        actions.append({"kind": "chord_thinning", "before": pitches, "after": kept})

    return out, actions


# ─── Public API ───────────────────────────────────────────────────────────────

def repair_piano_sections(
    sections: list[dict[str, Any]],
    *,
    max_rh_span: int = MAX_RH_SPAN,
    max_lh_span: int = MAX_LH_SPAN,
    rh_floor: int = RH_FLOOR,
    lh_ceiling: int = LH_CEILING,
    max_leap: int = MAX_LEAP,
    max_notes: int = MAX_NOTES,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    """Apply all 7 piano repairs to sections enriched with rightHandEvents / leftHandEvents.

    Called after enrich_proposal_sections_with_piano_layout() so that each
    section already has rightHandEvents and leftHandEvents set.

    Repair 6 (pedal_change_increase) is metadata-only and handled at the
    AbcProjectionResult level, not here.

    Returns:
        (repaired_sections, repair_log, any_repaired)
        repair_log entries: {"sectionId": str, "actions": [{"kind": str, ...}]}
    """
    repaired_sections: list[dict[str, Any]] = []
    repair_log: list[dict[str, Any]] = []
    any_repaired = False

    for raw_section in sections:
        section = dict(raw_section)
        section_id = str(section.get("sectionId") or "")
        all_actions: list[dict[str, Any]] = []

        rh: list[Event] = list(section.get("rightHandEvents") or [])
        lh: list[Event] = list(section.get("leftHandEvents") or [])

        # 1. chord_span_revoice
        rh, a = _repair_chord_span(rh, max_rh_span, "RH")
        all_actions.extend(a)
        lh, a = _repair_chord_span(lh, max_lh_span, "LH")
        all_actions.extend(a)

        # 2. register_correction
        rh, a = _repair_register(rh, rh_floor, 108, "RH")
        all_actions.extend(a)
        lh, a = _repair_register(lh, 24, lh_ceiling, "LH")
        all_actions.extend(a)

        # 3. leap_attenuation (RH melody only)
        rh, a = _repair_leaps(rh, max_leap)
        all_actions.extend(a)

        # 4. bass_reinforcement (LH)
        lh, a = _repair_bass_reinforcement(lh)
        all_actions.extend(a)

        # 5. voicing_clarity (LH vs current RH floor)
        rh_pitches = [p for ev in rh for p in _pitches_of(ev)]
        rh_min = min(rh_pitches) if rh_pitches else 60
        lh, a = _repair_voicing_clarity(lh, rh_min)
        all_actions.extend(a)

        # 7. chord_thinning (both hands)
        rh, a = _repair_chord_thinning(rh, max_notes)
        all_actions.extend(a)
        lh, a = _repair_chord_thinning(lh, max_notes)
        all_actions.extend(a)

        section["rightHandEvents"] = rh
        section["leftHandEvents"] = lh

        if all_actions:
            any_repaired = True
            repair_log.append({"sectionId": section_id, "actions": all_actions})

        repaired_sections.append(section)

    return repaired_sections, repair_log, any_repaired
