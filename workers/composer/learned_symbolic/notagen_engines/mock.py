"""Mock ABC generation engine for the NotaGen backend.

Returns a deterministic, plan-conditioned ABC score without loading any
ML model.  Intended exclusively for CI/CD and integration tests that verify
pipeline wiring — NOT for quality evaluation.

All mock output is tagged with:
  - proposalMetadata.generationMode = "mock_notagen_abc"
  - normalizationWarnings includes "mock_backend_not_for_quality_eval"

These markers ensure that mock results are never silently mixed into
benchmark or preference datasets.

Public API
----------
build_mock_abc(context, candidate_seed) -> abc_text_str
"""
from __future__ import annotations

from ..abc_conditioning import build_abc_header
from ..prompt_packing import ProviderPromptPackingContext


def _is_piano_lane(control_lines: list[str]) -> bool:
    """Return True when the controlLines specify solo_piano_symbolic lane."""
    for line in control_lines:
        stripped = line.strip().lower()
        if stripped.startswith("lane=") and "piano" in stripped:
            return True
    return False


def _build_piano_mock_abc(
    key_val: str, tempo_val: str, section_count: int, candidate_seed: int
) -> str:
    """Return a single-voice piano mock ABC in 4/4 with mixed RH/LH pitch ranges.

    Uses M:4/4, L:1/4 so every bar contains exactly four quarter notes and
    passes bar-duration validation.  Alternates notes above and below middle
    C (MIDI 60) so the piano projection stage produces non-empty RH and LH
    event lists.
    """
    abc_notes = ["C", "D", "E", "G", "A"]
    root_idx = candidate_seed % len(abc_notes)
    # Uppercase = C4 range (≥ MIDI 60) → right hand after projection
    rh_note = abc_notes[root_idx]
    # Note with comma = one octave lower (C3 range, MIDI 36-57) → left hand
    lh_note = abc_notes[(root_idx + 2) % len(abc_notes)] + ","

    # 4 quarter notes per bar (M:4/4, L:1/4): 2 RH + 2 LH
    one_bar = f"{rh_note}1 {rh_note}1 {lh_note}1 {lh_note}1"
    four_bars = " | ".join([one_bar] * 4) + " |"

    body_sections = "\n".join([
        f"%% axiom_section id=s{i + 1}\n[V:V1]{four_bars}"
        for i in range(section_count)
    ])

    return (
        f"X:1\nT:AXIOM Piano Mock Candidate {candidate_seed}\n"
        f"M:4/4\nL:1/4\nQ:{tempo_val}\nK:{key_val}\n"
        f"V:V1 name=Piano\n"
        f"{body_sections}\n"
    )


def build_mock_abc(context: ProviderPromptPackingContext, candidate_seed: int) -> str:
    """Return a deterministic minimal ABC score for testing.

    For the solo_piano_symbolic lane a single-voice piano ABC is produced
    (M:4/4, L:1/4) so that bar-duration validation passes and the piano
    projection stage can split events into right/left hand bins.

    For all other lanes the content is three-voice (Violin/Viola/Cello), just
    enough to pass Phase C validation.  The actual pitches are derived from
    *candidate_seed* so different candidates produce different output.

    Parameters
    ----------
    context:
        AXIOM ``ProviderPromptPackingContext`` containing control lines.
    candidate_seed:
        Integer seed derived from ``stableSeed + candidateIndex + seedOffset``.

    Returns
    -------
    str
        Minimal valid multi-voice ABC score text.
    """
    control_lines = context.get("controlLines") or []

    key_val = "C"
    meter_val = "4/4"
    tempo_val = "92"
    for line in control_lines:
        if line.startswith("key="):
            key_val = line[4:].strip() or key_val
        elif line.startswith("meter="):
            meter_val = line[6:].strip() or meter_val
        elif line.startswith("tempo="):
            tempo_val = line[6:].strip() or tempo_val

    abc_header = build_abc_header(context)
    section_count = max(1, sum(
        1 for line in abc_header.splitlines() if line.startswith("%% axiom_section")
    ))

    # Piano lane: single-voice, M:4/4
    if _is_piano_lane(control_lines):
        return _build_piano_mock_abc(key_val, tempo_val, section_count, candidate_seed)

    # String trio / default: three voices
    pitch_pool = ["C", "D", "E", "F", "G", "A", "B"]
    root_idx = candidate_seed % len(pitch_pool)
    lead_pitch = pitch_pool[root_idx]
    counter_pitch = pitch_pool[(root_idx + 2) % len(pitch_pool)]
    bass_pitch = pitch_pool[(root_idx + 4) % len(pitch_pool)].lower()

    one_bar = f"{lead_pitch}4 {lead_pitch}4 {lead_pitch}4 {lead_pitch}4"
    four_bars = " | ".join([one_bar] * 4) + " |"
    counter_bar = f"{counter_pitch}4 {counter_pitch}4 {counter_pitch}4 {counter_pitch}4"
    counter_bars = " | ".join([counter_bar] * 4) + " |"
    bass_bar = f"{bass_pitch}2 {bass_pitch}2 {bass_pitch}2 {bass_pitch}2"
    bass_bars = " | ".join([bass_bar] * 4) + " |"

    body_sections = "\n".join([
        f"%% axiom_section id=s{i + 1}\n"
        f"[V:V1]{four_bars}\n"
        f"[V:V2]{counter_bars}\n"
        f"[V:V3]{bass_bars}"
        for i in range(section_count)
    ])

    return (
        f"X:1\nT:AXIOM Mock Candidate {candidate_seed}\n"
        f"M:{meter_val}\nL:1/4\nQ:{tempo_val}\nK:{key_val}\n"
        f"V:V1 name=Violin\nV:V2 name=Viola\nV:V3 name=Cello\n"
        f"{body_sections}\n"
    )
