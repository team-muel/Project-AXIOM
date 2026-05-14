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


def build_mock_abc(context: ProviderPromptPackingContext, candidate_seed: int) -> str:
    """Return a deterministic minimal ABC score for testing.

    The content is just enough to pass Phase C validation: valid headers with
    three voices and a minimal melody per section.  The actual pitches are
    derived from *candidate_seed* so different candidates produce different
    output.

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
