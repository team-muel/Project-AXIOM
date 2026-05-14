# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""NotaGen-class symbolic backend.

When AXIOM_LEARNED_BACKEND=notagen and no model checkpoint is configured,
returns LearnedSymbolicBackendResult(ok=False, …) with a clear error message.
The caller (compose_learned_symbolic.py) MUST surface this error rather than
silently substituting the template backend — TypeScript has its own music21
fallback path for ok=False responses.

Connection points for real inference (Phase 3+):
  1. build_abc_header()       — AXIOM Plan → ABC conditioning header  [done]
  2. notagen_inference(...)   — ABC header → ABC score body           [TODO]
  3. abc_parser.validate_abc  — validate / repair model output        [done]
  4. section_aligner.align    — map ABC bars to AXIOM section IDs     [done]
  5. abc_to_events.convert    — ABC bars → SectionMaterial events     [done]

To enable:
  export AXIOM_LEARNED_BACKEND=notagen
  export AXIOM_NOTAGEN_CHECKPOINT_PATH=/path/to/checkpoint
"""

from __future__ import annotations

import os
from typing import Any

from .abc_conditioning import build_abc_header
from .abc_to_events import ABC_PIPELINE_AVAILABLE
from .backends import LearnedSymbolicBackendResult
from .prompt_packing import ProviderPromptPackingContext

PROVIDER = "notagen"
MODEL_DEFAULT = "notagen-abc-v1"


class NotagenBackend:
    """NotaGen-class ABC inference backend.

    Requires a model checkpoint at the path given by the environment variable
    AXIOM_NOTAGEN_CHECKPOINT_PATH.  When no checkpoint is configured (or the
    path does not exist) the backend returns ok=False with a descriptive error
    so the caller can propagate the failure explicitly.
    """

    def generate(
        self,
        payload: dict[str, Any],
        context: ProviderPromptPackingContext | None,
    ) -> LearnedSymbolicBackendResult:
        provider_request = payload.get("providerRequest") or {}
        model = str(provider_request.get("model") or MODEL_DEFAULT)

        # ── Check context ────────────────────────────────────────────────────
        if context is None:
            return LearnedSymbolicBackendResult(
                ok=False,
                provider=PROVIDER,
                model=model,
                generation_mode="notagen_abc_inference",
                error=(
                    "NotaGen backend requires a valid ProviderPromptPackingContext "
                    "(providerRequest was absent or failed validation). "
                    "Set AXIOM_LEARNED_BACKEND=template to use the deterministic fallback."
                ),
            )

        # ── Step 1: Build deterministic ABC conditioning header ──────────────
        abc_header = build_abc_header(context)
        section_count = sum(
            1 for line in abc_header.splitlines() if line.startswith("%% axiom_section")
        )

        # ── Check checkpoint ─────────────────────────────────────────────────
        checkpoint_path = os.environ.get("AXIOM_NOTAGEN_CHECKPOINT_PATH", "").strip()
        if not checkpoint_path or not os.path.exists(checkpoint_path):
            pipeline_note = (
                f"ABC pipeline available: {ABC_PIPELINE_AVAILABLE}; "
                f"conditioning header: {len(abc_header)} chars, {section_count} section(s)"
            )
            return LearnedSymbolicBackendResult(
                ok=False,
                provider=PROVIDER,
                model=model,
                generation_mode="notagen_abc_inference",
                abc_text=abc_header,  # conditioning header is ready for inspection
                error=(
                    "NotaGen checkpoint not connected. "
                    f"{pipeline_note}. "
                    "Set AXIOM_NOTAGEN_CHECKPOINT_PATH to connect the model, "
                    "or set AXIOM_LEARNED_BACKEND=template to use the deterministic fallback."
                ),
            )

        # ── TODO(Phase 3+): Real inference pipeline ──────────────────────────
        #
        #   abc_body = notagen_inference(abc_header, checkpoint_path, seed=attempt_index)
        #   abc_full = abc_header + "\n" + abc_body
        #   val      = abc_parser.validate_abc(abc_full, expected_total_measures=…)
        #   mats, ws = abc_to_events.convert(val.repaired_abc, sections)
        #   … build Score from mats, write MIDI, wrap into LearnedSymbolicBackendResult …
        #
        # All downstream infrastructure is in place:
        #   abc_parser.validate_abc()          — ready
        #   section_aligner.build_section_bar_ranges() — ready
        #   abc_to_events.convert()            — ready
        #   ABC_PIPELINE_AVAILABLE             = {ABC_PIPELINE_AVAILABLE}

        return LearnedSymbolicBackendResult(
            ok=False,
            provider=PROVIDER,
            model=model,
            generation_mode="notagen_abc_inference",
            error=(
                "NotaGen inference not yet implemented. "
                "Checkpoint path is set but model inference code is pending (Phase 3+)."
            ),
        )
