# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""ABC-to-events converter for AXIOM learned symbolic pipeline.

Converts a validated ABC score string into a list of AXIOM SectionMaterial
event dicts, using music21's ABC parser.

Voice mapping (matches AXIOM string-trio instrument layout):
  V:1  → lead        (Violin,  MIDI 62–93)
  V:2  → counterline (Viola,   MIDI 48–81)
  V:3  → bass        (Cello,   MIDI 36–67)

Missing voices produce silence and a normalizationWarning.

Phase C-3 evidence fields computed per section (feed craftScoring.ts):
  melodyPitchMin / melodyPitchMax  — lead voice pitch range
  bassPitchMin   / bassPitchMax    — bass voice pitch range
  lastInterval                     — final melodic interval (semitones)
  cadenceApproach                  — dominant / plagal / tonic / other
  bassMotionProfile                — pedal / stepwise / mixed / leaping
  textureContraryMotionRate        — [0,1] lead vs bass contrary motion
  textureIndependentMotionRate     — [0,1] asymmetric rest activity
  secondaryLineMotif               — first 6 counterline note pitches
  phrasePeaks                      — local melodic maxima (up to 4 MIDI values)
  rhythmicDensity                  — average notes per measure (lead voice)
  tonicizationWindows              — [{keyTarget, startMeasure, endMeasure}]
                                     Explicit key modulations detected from
                                     inline K: changes in the ABC body.
                                     Falls back to a single window of the
                                     declared tonalCenter so craftScoring.ts
                                     computeTonalReturn() can award full credit
                                     to recap sections that stay on the home key.
"""

from typing import Any

from .section_aligner import SectionBarRange, build_section_bar_ranges
from .symbolic_projection import (
    BASS_RANGE,
    COUNTERLINE_RANGE,
    LEAD_RANGE,
    SectionMaterial,
)

# True when music21 abcFormat is importable.
ABC_PIPELINE_AVAILABLE: bool
try:
    from music21 import abcFormat as _abc  # noqa: F401
    from music21 import stream as _st  # noqa: F401

    ABC_PIPELINE_AVAILABLE = True
except ImportError:
    ABC_PIPELINE_AVAILABLE = False

_VOICE_ROLES = ("lead", "counterline", "bass")
_VOICE_RANGES: dict[str, tuple[int, int]] = {
    "lead": LEAD_RANGE,
    "counterline": COUNTERLINE_RANGE,
    "bass": BASS_RANGE,
}


def _clamp(midi: int, role: str) -> int:
    lo, hi = _VOICE_RANGES.get(role, LEAD_RANGE)
    return max(lo, min(hi, midi))


def _note_to_event(note_obj: Any, role: str) -> dict[str, Any]:
    midi = int(round(note_obj.pitch.midi))
    velocity = 72
    if note_obj.volume is not None and note_obj.volume.velocity is not None:
        velocity = int(note_obj.volume.velocity)
    return {
        "kind": "note",
        "midi": _clamp(midi, role),
        "quarterLength": float(note_obj.quarterLength),
        "velocity": velocity,
        "role": role,
    }


def _rest_to_event(rest_obj: Any, role: str) -> dict[str, Any]:
    return {
        "kind": "rest",
        "quarterLength": float(rest_obj.quarterLength),
        "role": role,
    }


def _chord_to_event(chord_obj: Any, role: str) -> dict[str, Any]:
    """Convert a music21 Chord to a chord event with sorted MIDI pitches."""
    pitches = sorted(int(round(p.midi)) for p in chord_obj.pitches)
    velocity = 72
    if chord_obj.volume is not None and chord_obj.volume.velocity is not None:
        velocity = int(chord_obj.volume.velocity)
    return {
        "kind": "chord",
        "midiPitches": [_clamp(p, role) for p in pitches],
        "quarterLength": float(chord_obj.quarterLength),
        "velocity": velocity,
        "role": role,
    }


def _extract_voice_events(
    score: Any, voice_index: int, role: str
) -> list[dict[str, Any]]:
    try:
        parts = list(score.parts)
        if voice_index >= len(parts):
            return []
        events: list[dict[str, Any]] = []
        for element in parts[voice_index].flatten().notesAndRests:
            if hasattr(element, "pitches") and not hasattr(element, "pitch"):
                # music21 Chord
                events.append(_chord_to_event(element, role))
            elif hasattr(element, "pitch"):
                events.append(_note_to_event(element, role))
            else:
                events.append(_rest_to_event(element, role))
        return events
    except Exception:
        return []


def _group_events_by_bar(
    events: list[dict[str, Any]], beats_per_bar: float = 4.0
) -> list[list[dict[str, Any]]]:
    measures: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    bar_start = 0.0
    position = 0.0
    for event in events:
        current.append(event)
        position += float(event.get("quarterLength", 1.0))
        if position - bar_start >= beats_per_bar - 1e-9:
            measures.append(current)
            current = []
            bar_start = position
    if current:
        measures.append(current)
    return measures


# ─── Evidence computation helpers ────────────────────────────────────────────

_PITCH_CLASS_SEMITONES: dict[str, int] = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4,
    "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8,
    "A": 9, "A#": 10, "Bb": 10, "B": 11,
}


def _root_semitone(tonal_center: str) -> int:
    tonic = tonal_center.strip().split()[0]
    return _PITCH_CLASS_SEMITONES.get(tonic, 0)


def _note_pitches(events: list[dict[str, Any]]) -> list[int]:
    """Return MIDI pitches of note events (lowest pitch of chord events)."""
    pitches: list[int] = []
    for ev in events:
        kind = ev.get("kind")
        if kind == "note":
            pitches.append(int(ev["midi"]))
        elif kind == "chord":
            mp = ev.get("midiPitches")
            if isinstance(mp, list) and mp:
                pitches.append(min(int(p) for p in mp))
    return pitches


def _compute_cadence_approach(bass_events: list[dict[str, Any]], tonal_center: str) -> str:
    """Infer cadence approach from the final bass note relative to tonal center root."""
    pitches = _note_pitches(bass_events)
    if not pitches:
        return "other"
    root = _root_semitone(tonal_center)
    last_pc = pitches[-1] % 12
    rel = (last_pc - root) % 12
    if rel == 7:
        return "dominant"
    if rel == 5:
        return "plagal"
    if rel == 0:
        return "tonic"
    return "other"


def _compute_bass_motion_profile(bass_events: list[dict[str, Any]]) -> str:
    """Classify bass motion: pedal | stepwise | mixed | leaping."""
    pitches = _note_pitches(bass_events)
    if len(pitches) < 2:
        return "pedal"
    intervals = [abs(pitches[i + 1] - pitches[i]) for i in range(len(pitches) - 1)]
    n = len(intervals)
    zeros = sum(1 for iv in intervals if iv == 0)
    steps = sum(1 for iv in intervals if 1 <= iv <= 2)
    leaps = sum(1 for iv in intervals if iv > 4)
    if zeros / n > 0.7:
        return "pedal"
    if steps / n > 0.6:
        return "stepwise"
    if leaps / n > 0.4:
        return "leaping"
    return "mixed"


def _compute_contrary_motion_rate(
    lead_events: list[dict[str, Any]], bass_events: list[dict[str, Any]]
) -> float:
    """Rate [0,1] of consecutive-note pairs where lead and bass move in opposite directions."""
    lp = _note_pitches(lead_events)
    bp = _note_pitches(bass_events)
    pairs = min(len(lp) - 1, len(bp) - 1)
    if pairs <= 0:
        return 0.0
    contrary = sum(
        1 for i in range(pairs)
        if (lp[i + 1] - lp[i]) != 0
        and (bp[i + 1] - bp[i]) != 0
        and ((lp[i + 1] - lp[i]) > 0) != ((bp[i + 1] - bp[i]) > 0)
    )
    return round(contrary / pairs, 4)


def _compute_independent_motion_rate(
    lead_events: list[dict[str, Any]], bass_events: list[dict[str, Any]]
) -> float:
    """Rate [0,1] of onset positions where exactly one voice is active (other rests).

    Builds offset-keyed timelines from the event quarterLength sequence.
    """
    def _active_set(events: list[dict[str, Any]]) -> set[float]:
        active: set[float] = set()
        t = 0.0
        for ev in events:
            ql = float(ev.get("quarterLength", 1.0))
            if ev.get("kind") in ("note", "chord"):
                active.add(round(t, 6))
            t += ql
        return active

    lead_active = _active_set(lead_events)
    bass_active = _active_set(bass_events)
    all_times = lead_active | bass_active
    if not all_times:
        return 0.0
    independent = sum(
        1 for t in all_times
        if (t in lead_active) != (t in bass_active)
    )
    return round(independent / len(all_times), 4)


def _compute_phrase_peaks(lead_events: list[dict[str, Any]]) -> list[int]:
    """Return MIDI pitches of local melodic maxima (up to 4).

    For chord events the highest pitch (top voice of the chord) is used,
    which is the musically correct value for melodic peak detection.
    """
    pitches = [
        (i, ev["midi"] if ev.get("kind") == "note"
         else max(ev["midiPitches"]) if ev.get("kind") == "chord" and ev.get("midiPitches") else None)
        for i, ev in enumerate(lead_events)
    ]
    notes = [(i, p) for i, p in pitches if p is not None]
    if len(notes) < 3:
        return [p for _, p in notes[-1:]]
    peaks = [
        notes[k][1]
        for k in range(1, len(notes) - 1)
        if notes[k][1] > notes[k - 1][1] and notes[k][1] >= notes[k + 1][1]
    ]
    return peaks[:4]


def _compute_secondary_line_motif(counterline_events: list[dict[str, Any]]) -> list[int]:
    """First 6 note pitches of the counterline voice."""
    notes: list[int] = []
    for ev in counterline_events:
        if ev.get("kind") == "note":
            notes.append(int(ev["midi"]))
        elif ev.get("kind") == "chord":
            mp = ev.get("midiPitches")
            if isinstance(mp, list) and mp:
                notes.append(min(int(p) for p in mp))
        if len(notes) >= 6:
            break
    return notes


def _m21_key_to_string(k: Any) -> str:
    """Convert a music21 Key object to an AXIOM keyTarget string.

    Examples: ``Key('G', 'major')`` → ``"G major"``,
              ``Key('e', 'minor')`` → ``"E minor"``.

    music21 uses ``'-'`` for accidentals (``E-`` = E-flat); we normalise to
    the more common ``'b'`` spelling (``Eb``).
    """
    try:
        tonic_name: str = str(k.tonic.name).replace("-", "b")
        mode: str = str(k.mode or "major").lower()
        return f"{tonic_name} {mode}"
    except AttributeError:
        pass
    try:
        # KeySignature fallback: sharps count → nearest major key
        sharps = int(k.sharps)
        _major_by_sharps = {
            0: "C major", 1: "G major", 2: "D major", 3: "A major",
            4: "E major", 5: "B major", 6: "F# major",
            -1: "F major", -2: "Bb major", -3: "Eb major",
            -4: "Ab major", -5: "Db major", -6: "Gb major",
        }
        return _major_by_sharps.get(sharps, "C major")
    except Exception:
        return "C major"


def _compute_tonicization_windows(
    score: Any,
    start_bar: int,
    end_bar: int,
    tonal_center: str,
) -> list[dict[str, Any]]:
    """Detect tonal centers within a section's bar range.

    Scans for explicit ``Key`` changes (inline ``[K:…]`` in the ABC body) in
    the first part of the score.  Each unique key gets its own window entry
    ``{keyTarget, startMeasure, endMeasure}``.

    If no explicit modulations are found within the section, a single window
    spanning the whole section is returned using the ``tonal_center`` declared
    in the harmonicPlan.  This deliberate fallback ensures that
    ``craftScoring.ts computeTonalReturn()`` can award full credit to recap
    sections that stay on the home key (rather than the half-credit 0.5
    fallback when the field is absent entirely).
    """
    _default = [
        {
            "keyTarget": tonal_center,
            "startMeasure": start_bar,
            "endMeasure": max(start_bar, end_bar - 1),
        }
    ]
    if not ABC_PIPELINE_AVAILABLE:
        return _default
    try:
        from music21 import key as m21key  # noqa: PLC0415

        parts = list(score.parts)
        if not parts:
            return _default

        part = parts[0]
        measures = list(part.getElementsByClass("Measure"))
        section_measures = measures[start_bar:end_bar]
        if not section_measures:
            return _default

        # Collect (abs_bar, key_str) for every measure that has a Key change.
        key_changes: list[tuple[int, str]] = []
        for rel_idx, measure in enumerate(section_measures):
            keys_in_measure = list(measure.getElementsByClass(m21key.Key))
            if keys_in_measure:
                key_str = _m21_key_to_string(keys_in_measure[0])
                bar_abs = start_bar + rel_idx
                # Deduplicate consecutive identical keys
                if not key_changes or key_changes[-1][1] != key_str:
                    key_changes.append((bar_abs, key_str))

        if not key_changes:
            return _default

        windows: list[dict[str, Any]] = []
        for j, (win_start, key_str) in enumerate(key_changes):
            win_end = key_changes[j + 1][0] - 1 if j + 1 < len(key_changes) else end_bar - 1
            windows.append(
                {"keyTarget": key_str, "startMeasure": win_start, "endMeasure": win_end}
            )
        return windows
    except Exception:
        return _default


def _compute_section_evidence(
    lead_events: list[dict[str, Any]],
    counterline_events: list[dict[str, Any]],
    bass_events: list[dict[str, Any]],
    measure_count: int,
    tonal_center: str,
    score: Any = None,
    start_bar: int = 0,
    end_bar: int = 0,
) -> dict[str, Any]:
    """Compute craftScoring evidence fields for a single section.

    Returns a dict of optional fields that are merged into the SectionMaterial.
    Only non-trivial values are included (no None or empty entries).
    """
    lead_pitches = _note_pitches(lead_events)
    bass_pitches = _note_pitches(bass_events)
    evidence: dict[str, Any] = {}

    if lead_pitches:
        evidence["melodyPitchMin"] = min(lead_pitches)
        evidence["melodyPitchMax"] = max(lead_pitches)
    if bass_pitches:
        evidence["bassPitchMin"] = min(bass_pitches)
        evidence["bassPitchMax"] = max(bass_pitches)
    if len(lead_pitches) >= 2:
        evidence["lastInterval"] = lead_pitches[-1] - lead_pitches[-2]
    elif len(lead_pitches) == 1:
        evidence["lastInterval"] = 0

    evidence["cadenceApproach"] = _compute_cadence_approach(bass_events, tonal_center)
    evidence["bassMotionProfile"] = _compute_bass_motion_profile(bass_events)
    evidence["textureContraryMotionRate"] = _compute_contrary_motion_rate(lead_events, bass_events)
    evidence["textureIndependentMotionRate"] = _compute_independent_motion_rate(lead_events, bass_events)

    secondary = _compute_secondary_line_motif(counterline_events)
    if secondary:
        evidence["secondaryLineMotif"] = secondary

    peaks = _compute_phrase_peaks(lead_events)
    if peaks:
        evidence["phrasePeaks"] = peaks

    note_count = sum(1 for ev in lead_events if ev.get("kind") in ("note", "chord"))
    evidence["rhythmicDensity"] = round(note_count / max(1, measure_count), 4)

    if score is not None:
        evidence["tonicizationWindows"] = _compute_tonicization_windows(
            score, start_bar, end_bar, tonal_center
        )

    return evidence


# ─── Main conversion function ─────────────────────────────────────────────────

def convert(
    abc_text: str,
    sections: list[dict[str, Any]],
) -> tuple[list[SectionMaterial], list[str]]:
    """Convert validated ABC text into AXIOM SectionMaterial objects.

    Args:
        abc_text: Validated (optionally repaired) ABC text.
        sections: Normalized AXIOM section list (id, role, measures, harmonicPlan).

    Returns:
        (section_materials, warnings) in section-plan order.

    Raises:
        RuntimeError: If music21 abcFormat is unavailable or parse fails.
    """
    if not ABC_PIPELINE_AVAILABLE:
        raise RuntimeError(
            "music21 abcFormat is required for abc_to_events.convert(); "
            "ensure music21 >= 7 is installed"
        )
    from music21 import converter as m21conv

    warnings: list[str] = []
    section_ranges = build_section_bar_ranges(sections)

    try:
        score = m21conv.parse(abc_text, format="abc")
    except Exception as exc:
        raise RuntimeError(f"music21 failed to parse ABC text: {exc}") from exc

    voice_events: list[list[dict[str, Any]]] = []
    for idx, role in enumerate(_VOICE_ROLES):
        events = _extract_voice_events(score, idx, role)
        if not events:
            warnings.append(
                f"ABC voice {idx + 1} ({role}) produced no events; using silence"
            )
        voice_events.append(events)

    voice_measures = [_group_events_by_bar(ev) for ev in voice_events]

    section_materials: list[SectionMaterial] = []
    for rng in section_ranges:
        sec_def = next(
            (s for s in sections if str(s.get("id", "")).strip() == rng.section_id),
            {},
        )
        harmonic_plan = sec_def.get("harmonicPlan") or {}
        tonal_center = str(harmonic_plan.get("tonalCenter") or "C major").strip()

        lead_bars = (
            voice_measures[0][rng.start_bar : rng.end_bar] if voice_measures[0] else []
        )
        cl_bars = (
            voice_measures[1][rng.start_bar : rng.end_bar]
            if len(voice_measures) > 1
            else []
        )
        bass_bars = (
            voice_measures[2][rng.start_bar : rng.end_bar]
            if len(voice_measures) > 2
            else []
        )

        lead_events = [ev for bar in lead_bars for ev in bar]
        cl_events = [ev for bar in cl_bars for ev in bar]
        bass_events = [ev for bar in bass_bars for ev in bar]
        support_events = cl_events + bass_events
        note_history = [
            int(ev["midi"]) for ev in lead_events if ev.get("kind") == "note"
        ]

        measure_count = rng.end_bar - rng.start_bar
        evidence = _compute_section_evidence(
            lead_events, cl_events, bass_events, measure_count, tonal_center,
            score=score, start_bar=rng.start_bar, end_bar=rng.end_bar,
        )

        section_materials.append({
            "sectionId": rng.section_id,
            "role": rng.role,
            "measureCount": measure_count,
            "tonalCenter": tonal_center,
            "phraseFunction": sec_def.get("phraseFunction"),
            "leadEvents": lead_events,
            "supportEvents": support_events,
            "noteHistory": note_history,
            **evidence,
        })

    return section_materials, warnings
