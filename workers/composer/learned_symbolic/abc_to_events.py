# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""ABC-to-events converter for AXIOM learned symbolic pipeline.

Converts a validated ABC score string into a list of AXIOM SectionMaterial
event dicts, using music21's ABC parser.

Voice mapping (matches AXIOM string-trio instrument layout):
  V:1  → lead        (Violin,  MIDI 62–93)
  V:2  → counterline (Viola,   MIDI 48–81)
  V:3  → bass        (Cello,   MIDI 36–67)

Missing voices produce silence and a normalizationWarning.
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


def _extract_voice_events(
    score: Any, voice_index: int, role: str
) -> list[dict[str, Any]]:
    try:
        parts = list(score.parts)
        if voice_index >= len(parts):
            return []
        events: list[dict[str, Any]] = []
        for element in parts[voice_index].flatten().notesAndRests:
            if hasattr(element, "pitch"):
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
        support_events = [ev for bar in cl_bars for ev in bar] + [
            ev for bar in bass_bars for ev in bar
        ]
        note_history = [
            int(ev["midi"]) for ev in lead_events if ev.get("kind") == "note"
        ]

        section_materials.append(
            {
                "sectionId": rng.section_id,
                "role": rng.role,
                "measureCount": rng.end_bar - rng.start_bar,
                "tonalCenter": tonal_center,
                "phraseFunction": sec_def.get("phraseFunction"),
                "leadEvents": lead_events,
                "supportEvents": support_events,
                "noteHistory": note_history,
            }
        )

    return section_materials, warnings
