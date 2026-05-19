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
from .localized_rewrite import build_rewrite_prompt_block
from .notagen_engines.mock import build_mock_abc
from .prompt_packing import ProviderPromptPackingContext

PROVIDER = "notagen"
MODEL_DEFAULT = "notagen-abc-v1"


def _engine_name() -> str:
    return os.environ.get("NOTAGEN_ENGINE", "hf_causal_lm").strip() or "hf_causal_lm"


def _run_local_inference(prompt: str, **kwargs: Any) -> str:
    raise RuntimeError("NotaGen local inference engine is not connected")


def _get_projection_value(result: Any, key: str, fallback: Any = None) -> Any:
    if isinstance(result, dict):
        return result.get(key, fallback)
    return getattr(result, key, fallback)


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
        sampling_params: dict[str, Any] = dict(
            provider_request.get("samplingParams") or {}
        )
        temperature: float = float(sampling_params.get("temperature") or 0.9)
        top_p: float = float(sampling_params.get("topP") or 0.95)
        top_k: int = int(sampling_params.get("topK") or 50)
        seed_offset: int = int(sampling_params.get("seedOffset") or 0)
        # Per-candidate seed derivation (stable across retries, unique per variant):
        #   stable_seed  = payload.get("stableSeed", 0)
        #   candidate_seed = stable_seed + candidate_index + seed_offset
        stable_seed_raw = payload.get("stableSeed", 0)
        stable_seed = int(stable_seed_raw) if isinstance(stable_seed_raw, (int, float)) else 0
        candidate_seed = stable_seed + candidate_index + seed_offset

        # ── Phase E: extract localized rewrite spec ───────────────────────────
        rewrite_spec: dict[str, Any] | None = (
            provider_request.get("rewriteSpec") or None
        )
        is_localized_rewrite = bool(
            isinstance(rewrite_spec, dict) and rewrite_spec.get("rewriteSectionIds")
        )
        generation_mode = (
            "targeted_section_rewrite"
            if is_localized_rewrite
            else "notagen_abc_inference"
        )

        # ── Check context ────────────────────────────────────────────────────
        if context is None:
            return LearnedSymbolicBackendResult(
                ok=False,
                provider=PROVIDER,
                model=model,
                generation_mode=generation_mode,
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

        # When a localized rewrite spec is present, build the rewrite prompt block
        # and annotate the conditioning header.
        rewrite_block: str = ""
        if is_localized_rewrite and rewrite_spec is not None:
            rewrite_block = build_rewrite_prompt_block(
                rewrite_section_ids=list(rewrite_spec.get("rewriteSectionIds") or []),
                keep_section_ids=list(rewrite_spec.get("keepSectionIds") or []),
                reason=str(rewrite_spec.get("reason") or ""),
                directives=list(rewrite_spec.get("directives") or []),
            )

        if os.environ.get("LEARNED_SYMBOLIC_BACKEND", "").strip().lower() == "notagen_mock":
            abc_full = build_mock_abc(context, candidate_seed)
            sections = payload.get("promptPack", {}).get("sections") or []
            projection = run_abc_projection_pipeline(
                abc_full,
                sections,
                provider_request,
                output_path=payload.get("outputPath"),
                keep_section_artifacts=payload.get("sectionArtifacts") if is_localized_rewrite else None,
                lane=context.get("lane"),
            )
            if not _get_projection_value(projection, "ok", False):
                return LearnedSymbolicBackendResult(
                    ok=False,
                    provider=PROVIDER,
                    model=model,
                    generation_mode="mock_notagen_abc",
                    abc_text=abc_full,
                    warnings=["mock_backend_not_for_quality_eval"]
                    + list(_get_projection_value(projection, "normalization_warnings", []) or []),
                    error=_get_projection_value(projection, "error", "ABC projection failed"),
                )
            proposal_sections = list(_get_projection_value(projection, "proposal_sections", []) or [])
            return LearnedSymbolicBackendResult(
                ok=True,
                provider=PROVIDER,
                model=model,
                generation_mode="mock_notagen_abc",
                confidence=0.5,
                abc_text=abc_full,
                midi_path=_get_projection_value(projection, "midi_path"),
                proposal_sections=proposal_sections,
                warnings=["mock_backend_not_for_quality_eval"]
                + list(_get_projection_value(projection, "normalization_warnings", []) or []),
                voice_layout_summary=_get_projection_value(projection, "voice_layout_summary"),
                repair_actions=_get_projection_value(projection, "repair_actions"),
                midi_rewritten=bool(_get_projection_value(projection, "midi_rewritten", False)),
                note_count=sum(len(section.get("noteHistory", [])) for section in proposal_sections),
                measure_count=sum(int(section.get("measureCount", 0) or 0) for section in proposal_sections),
                key_name=context.get("conditioningText", ""),
                form=str(provider_request.get("form", "")),
                tempo_bpm=int(provider_request.get("tempo") or 92),
            )

        # ── Check checkpoint ─────────────────────────────────────────────────
        checkpoint_path = os.environ.get("AXIOM_NOTAGEN_CHECKPOINT_PATH", "").strip()
        if not checkpoint_path or not os.path.exists(checkpoint_path):
            pipeline_note = (
                f"ABC pipeline available: {ABC_PIPELINE_AVAILABLE}; "
                f"conditioning header: {len(abc_header)} chars, {section_count} section(s); "
                f"candidate_index={candidate_index} temperature={temperature} "
                f"top_p={top_p} top_k={top_k} seed_offset={seed_offset}"
                + (
                    f"; localized_rewrite sections={rewrite_spec.get('rewriteSectionIds')}"
                    if is_localized_rewrite
                    else ""
                )
            )
            full_header = (
                (abc_header + "\n" + rewrite_block) if rewrite_block else abc_header
            )
            return LearnedSymbolicBackendResult(
                ok=False,
                provider=PROVIDER,
                model=model,
                generation_mode=generation_mode,
                abc_text=full_header,  # conditioning header (+ rewrite block) for inspection
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
        #
        #   if is_localized_rewrite:
        #       # Build a rewrite-scoped ABC prompt (only rewrite sections)
        #       rewrite_sections = rewrite_spec.get("rewriteSectionIds") or []
        #       keep_artifacts = payload.get("sectionArtifacts") or []
        #       abc_body = notagen_rewrite_inference(
        #           abc_header, rewrite_block, rewrite_sections, checkpoint_path,
        #           seed=candidate_seed, temperature=temperature,
        #           top_p=top_p, top_k=top_k,
        #       )
        #   else:
        #       abc_body = notagen_inference(
        #           abc_header, checkpoint_path,
        #           seed=candidate_seed, temperature=temperature,
        #           top_p=top_p, top_k=top_k,
        #       )
        #
        #   abc_full = abc_header + "\n" + abc_body
        #   sections = payload.get("promptPack", {}).get("sections") or []
        #   keep_artifacts = payload.get("sectionArtifacts") or [] if is_localized_rewrite else None
        #   result = run_abc_projection_pipeline(
        #       abc_full, sections, provider_request,
        #       output_path=output_path,
        #       keep_section_artifacts=keep_artifacts,
        #   )
        #   if not result.ok:
        #       return LearnedSymbolicBackendResult(
        #           ok=False, provider=PROVIDER, model=model,
        #           generation_mode=generation_mode,
        #           error=result.error,
        #       )
        #   note_ct  = sum(len(s.get("noteHistory", [])) for s in result.proposal_sections)
        #   bar_ct   = sum(s.get("measureCount", 0) for s in result.proposal_sections)
        #   return LearnedSymbolicBackendResult(
        #       ok=True, provider=PROVIDER, model=model,
        #       generation_mode=generation_mode,
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
        # For localized rewrites, keep_section_artifacts preserves event-stable
        # sections from the parent candidate.

        return LearnedSymbolicBackendResult(
            ok=False,
            provider=PROVIDER,
            model=model,
            generation_mode=generation_mode,
            error=(
                "NotaGen inference not yet implemented. "
                "Checkpoint path is set but model inference code is pending (Phase 3+)."
            ),
        )

    def _generate_local(
        self,
        *,
        payload: dict[str, Any],
        provider_request: dict[str, Any],
        context: ProviderPromptPackingContext,
        model: str,
        generation_mode: str,
        abc_header: str,
        rewrite_block: str = "",
        rewrite_spec: dict[str, Any] | None = None,
        is_localized_rewrite: bool = False,
        candidate_seed: int = 0,
        candidate_index: int = 0,
        temperature: float = 0.9,
        top_p: float = 0.95,
        top_k: int = 50,
        repetition_penalty: float = 1.0,
        max_tokens: int = 1024,
    ) -> LearnedSymbolicBackendResult:
        engine = _engine_name()
        warnings: list[str] = []
        prompt = abc_header
        resolved_generation_mode = f"notagen_abc_inference_{engine}"

        if is_localized_rewrite and rewrite_block:
            if engine == "notagen_native":
                warnings.append("notagen_native_rewrite_block_ignored_full_regen")
            else:
                prompt = f"{abc_header.rstrip()}\n{rewrite_block.strip()}\n"
                resolved_generation_mode = f"targeted_section_rewrite_{engine}"

        abc_full = _run_local_inference(
            prompt,
            model=model,
            seed=candidate_seed,
            candidate_index=candidate_index,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k,
            repetition_penalty=repetition_penalty,
            max_tokens=max_tokens,
            rewrite_spec=rewrite_spec,
            provider_request=provider_request,
        )

        sections = payload.get("promptPack", {}).get("sections") or []
        projection = run_abc_projection_pipeline(
            abc_full,
            sections,
            provider_request,
            output_path=payload.get("outputPath"),
            keep_section_artifacts=payload.get("sectionArtifacts") if is_localized_rewrite else None,
            lane=context.get("lane"),
        )
        if not _get_projection_value(projection, "ok", False):
            return LearnedSymbolicBackendResult(
                ok=False,
                provider=PROVIDER,
                model=model,
                generation_mode=resolved_generation_mode,
                abc_text=abc_full,
                warnings=warnings + list(_get_projection_value(projection, "normalization_warnings", []) or []),
                error=_get_projection_value(projection, "error", "ABC projection failed"),
            )

        proposal_sections = list(_get_projection_value(projection, "proposal_sections", []) or [])
        return LearnedSymbolicBackendResult(
            ok=True,
            provider=PROVIDER,
            model=model,
            generation_mode=resolved_generation_mode,
            abc_text=abc_full,
            midi_path=_get_projection_value(projection, "midi_path"),
            proposal_sections=proposal_sections,
            warnings=warnings + list(_get_projection_value(projection, "normalization_warnings", []) or []),
            note_count=sum(len(section.get("noteHistory", [])) for section in proposal_sections),
            measure_count=sum(int(section.get("measureCount", 0) or 0) for section in proposal_sections),
            key_name=str(context.get("conditioningText", "")),
            form=str(provider_request.get("form", "")),
            tempo_bpm=int(provider_request.get("tempo") or 92),
            rewrite_applied=is_localized_rewrite and engine != "notagen_native",
        )
