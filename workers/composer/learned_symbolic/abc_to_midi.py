"""ABC-to-MIDI converter for the AXIOM learned symbolic pipeline.

Converts a validated, repaired ABC score string to a MIDI file using music21.
Instruments are assigned based on the instrumentation role list extracted from
the providerRequest controlLines (Violin/Viola/Cello for the string trio lane).

When music21 is unavailable MIDI_PIPELINE_AVAILABLE is False and the functions
raise RuntimeError so the caller can surface an explicit error rather than
silently producing no output.
"""

from __future__ import annotations

import os
from typing import Any

# ─── Availability flag ────────────────────────────────────────────────────────

MIDI_PIPELINE_AVAILABLE: bool
try:
    from music21 import (  # noqa: F401
        converter as _m21conv,
        instrument as _m21inst,
        tempo as _m21tempo,
    )

    MIDI_PIPELINE_AVAILABLE = True
except ImportError:
    MIDI_PIPELINE_AVAILABLE = False

# ─── Role → instrument mapping ───────────────────────────────────────────────

_ROLE_TO_INSTRUMENT: dict[str, Any] = {}

if MIDI_PIPELINE_AVAILABLE:
    from music21 import instrument as _inst

    _ROLE_TO_INSTRUMENT = {
        "lead": _inst.Violin(),
        "counterline": _inst.Viola(),
        "bass": _inst.Violoncello(),
    }


def _instrument_for_role(role: str) -> Any:
    if not MIDI_PIPELINE_AVAILABLE:
        raise RuntimeError("music21 is required for abc_to_midi")
    from music21 import instrument as inst

    return _ROLE_TO_INSTRUMENT.get(role.strip().lower()) or inst.Piano()


# ─── Core functions ───────────────────────────────────────────────────────────

def build_score_from_abc(
    abc_text: str,
    instrumentation_roles: list[str] | None = None,
    tempo_bpm: int = 92,
) -> Any:
    """Parse ABC text into a music21 Score with instruments and tempo.

    Args:
        abc_text:              Validated (optionally repaired) ABC text.
        instrumentation_roles: Roles in voice order, e.g. ["lead","counterline","bass"].
                               Defaults to string trio mapping.
        tempo_bpm:             Quarter-note tempo in BPM.

    Returns:
        A music21 Score object.

    Raises:
        RuntimeError: If music21 is unavailable or ABC parsing fails.
    """
    if not MIDI_PIPELINE_AVAILABLE:
        raise RuntimeError(
            "music21 is required for abc_to_midi.build_score_from_abc(); "
            "ensure music21 >= 7 is installed"
        )

    from music21 import converter as m21conv
    from music21 import tempo as tempo_mod

    roles = instrumentation_roles or ["lead", "counterline", "bass"]

    try:
        score = m21conv.parse(abc_text, format="abc")
    except Exception as exc:
        raise RuntimeError(f"music21 failed to parse ABC for MIDI conversion: {exc}") from exc

    # Add global tempo marking at offset 0
    try:
        score.insert(0, tempo_mod.MetronomeMark(number=tempo_bpm))
    except Exception:
        pass  # Tempo insertion failure is non-fatal

    # Assign instrument objects to each part
    try:
        for idx, part in enumerate(score.parts):
            role = roles[idx] if idx < len(roles) else "lead"
            inst = _instrument_for_role(role)
            part.insert(0, inst)
    except Exception:
        pass  # Instrument assignment failure is non-fatal for MIDI output

    return score


def write_midi_from_abc(
    abc_text: str,
    output_path: str,
    instrumentation_roles: list[str] | None = None,
    tempo_bpm: int = 92,
    meter_str: str = "4/4",
) -> str:
    """Build a music21 Score from ABC text and write it as a MIDI file.

    Args:
        abc_text:              Validated, repaired ABC text.
        output_path:           Destination path for the .mid file.
        instrumentation_roles: Voice roles in order (default string trio).
        tempo_bpm:             Metronome tempo.
        meter_str:             Meter string (informational; not used directly
                               since meter is embedded in the ABC header).

    Returns:
        output_path (the same string passed in).

    Raises:
        RuntimeError: If music21 is unavailable, parse fails, or write fails.
    """
    if not MIDI_PIPELINE_AVAILABLE:
        raise RuntimeError(
            "music21 is required for abc_to_midi.write_midi_from_abc(); "
            "ensure music21 >= 7 is installed"
        )

    score = build_score_from_abc(abc_text, instrumentation_roles, tempo_bpm)

    parent = os.path.dirname(output_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    try:
        score.write("midi", fp=output_path)
    except Exception as exc:
        raise RuntimeError(f"MIDI write failed for {output_path!r}: {exc}") from exc

    return output_path
