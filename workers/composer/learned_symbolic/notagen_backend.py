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
from .abc_project import run_abc_projection_pipeline  # Phase C pipeline
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

        # ── Phase D: extract per-candidate sampling params ───────────────────
        # candidateIndex: 0-based index of this candidate in the learned pool.
        # sampling_params: forwarded from learnedSampling on the ComposeRequest.
        candidate_index = int(provider_request.get("candidateIndex") or 0)
        sampling_params: dict[str, Any] = dict(provider_request.get("samplingParams") or {})
        temperature: float = float(sampling_params.get("temperature") or 0.9)
        top_p: float = float(sampling_params.get("topP") or 0.95)
        top_k: int = int(sampling_params.get("topK") or 50)
        seed_offset: int = int(sampling_params.get("seedOffset") or 0)
        # Per-candidate seed derivation (stable across retries, unique per variant):
        #   stable_seed  = payload.get("stableSeed", 0)
        #   candidate_seed = stable_seed + candidate_index + seed_offset

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
                f"conditioning header: {len(abc_header)} chars, {section_count} section(s); "
                f"candidate_index={candidate_index} temperature={temperature} "
                f"top_p={top_p} top_k={top_k} seed_offset={seed_offset}"
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
        # With the Phase C pipeline and Phase D sampling in place, wire like:
        #
        #   stable_seed = payload.get("stableSeed", 0)
        #   candidate_seed = stable_seed + candidate_index + seed_offset
        #   abc_body = notagen_inference(
        #       abc_header, checkpoint_path,
        #       seed=candidate_seed, temperature=temperature,
        #       top_p=top_p, top_k=top_k,
        #   )
        #   abc_full = abc_header + "\n" + abc_body
        #
        #   sections = payload.get("promptPack", {}).get("sections") or []
        #   result = run_abc_projection_pipeline(
        #       abc_full, sections, provider_request, output_path=output_path
        #   )
        #   if not result.ok:
        #       return LearnedSymbolicBackendResult(
        #           ok=False, provider=PROVIDER, model=model,
        #           generation_mode="notagen_abc_inference",
        #           error=result.error,
        #       )
        #   note_ct  = sum(len(s.get("noteHistory", [])) for s in result.proposal_sections)
        #   bar_ct   = sum(s.get("measureCount", 0) for s in result.proposal_sections)
        #   return LearnedSymbolicBackendResult(
        #       ok=True, provider=PROVIDER, model=model,
        #       generation_mode="notagen_abc_inference",
        #       abc_text=abc_full,
        #       midi_path=result.midi_path,
        #       proposal_sections=result.proposal_sections,
        #       warnings=result.normalization_warnings,
        #       note_count=note_ct, measure_count=bar_ct,
        #       key_name=context.get("conditioningText", ""),
        #       form=str(provider_request.get("form", "")),
        #       tempo_bpm=int(provider_request.get("tempo") or 92),
        #   )
        #
        # run_abc_projection_pipeline is imported above from abc_project.
        # ABC_PIPELINE_AVAILABLE confirms music21 is ready.

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
