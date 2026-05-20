# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""NotaGen-class symbolic backend.

When AXIOM_LEARNED_BACKEND=notagen and no model checkpoint is configured,
returns LearnedSymbolicBackendResult(ok=False, …) with a clear error message.
The caller (compose_learned_symbolic.py) MUST surface this error rather than
silently substituting the template backend — TypeScript has its own music21
fallback path for ok=False responses.

Connection points for real inference:
  1. build_abc_header()       — AXIOM Plan → ABC conditioning header  [done]
  2. _run_local_inference(…)  — ABC header → ABC score body           [done]
  3. abc_parser.validate_abc  — validate / repair model output        [done]
  4. section_aligner.align    — map ABC bars to AXIOM section IDs     [done]
  5. abc_to_events.convert    — ABC bars → SectionMaterial events     [done]

To enable:
  export AXIOM_LEARNED_BACKEND=notagen_local
  export NOTAGEN_ENGINE=notagen_native
  export AXIOM_NOTAGEN_CHECKPOINT_PATH=/path/to/weights.pth
  export NOTAGEN_REPO_PATH=/path/to/notagen_repo
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


# Module-level model cache: (engine, checkpoint_path, device) → (model, tokenizer_or_patchilizer)
# Keeps weights in memory across multiple calls within the same worker process.
_model_cache: dict[tuple[str, str, str], tuple[Any, Any]] = {}


def _run_local_inference(prompt: str, **kwargs: Any) -> str:
    """Load the configured engine/model (cached) and generate ABC text.

    Dispatches to ``notagen_engines.load_engine_model`` + ``run_engine_generate``.
    The model is loaded once per (engine, checkpoint_path, device) triple and
    kept in ``_model_cache`` for subsequent calls within the same process.

    Keyword arguments forwarded to the engine's ``generate()`` function:
        seed, temperature, top_p, top_k, repetition_penalty, max_tokens.
    """
    from .notagen_engines import load_engine_model, run_engine_generate  # noqa: PLC0415

    engine = _engine_name()
    checkpoint_path = os.environ.get("AXIOM_NOTAGEN_CHECKPOINT_PATH", "").strip()
    device_str = os.environ.get("NOTAGEN_DEVICE", "cpu").strip() or "cpu"
    tokenizer_path = os.environ.get("NOTAGEN_TOKENIZER_PATH", "").strip() or checkpoint_path
    default_max_tokens = int(os.environ.get("NOTAGEN_MAX_TOKENS", "102400").strip() or "102400")

    cache_key = (engine, checkpoint_path, device_str)
    if cache_key not in _model_cache:
        _model_cache[cache_key] = load_engine_model(engine, checkpoint_path, tokenizer_path, device_str)
    model_obj, tokenizer_obj = _model_cache[cache_key]

    return run_engine_generate(
        engine,
        model_obj,
        tokenizer_obj,
        prompt,
        seed=int(kwargs.get("seed") or kwargs.get("candidate_seed") or 0),
        temperature=float(kwargs.get("temperature") or 0.9),
        top_p=float(kwargs.get("top_p") or 0.95),
        top_k=int(kwargs.get("top_k") or 50),
        repetition_penalty=float(kwargs.get("repetition_penalty") or 1.0),
        max_tokens=int(kwargs.get("max_tokens") or default_max_tokens),
    )


def _run_inference_inline(
    abc_header: str,
    *,
    seed: int = 0,
    temperature: float = 0.9,
    top_p: float = 0.95,
    top_k: int = 50,
    repetition_penalty: float = 1.1,
    max_tokens: int = 2048,
) -> str:
    """Thin public wrapper used by _notagen_inference_worker.py.

    Accepts an AXIOM ABC conditioning header and returns the generated ABC text.
    Unlike ``_run_local_inference`` this function has explicit keyword parameters
    so the subprocess worker can call it directly without **kwargs unpacking.
    """
    return _run_local_inference(
        abc_header,
        seed=seed,
        temperature=temperature,
        top_p=top_p,
        top_k=top_k,
        repetition_penalty=repetition_penalty,
        max_tokens=max_tokens,
    )


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
        repetition_penalty: float = float(sampling_params.get("repetitionPenalty") or 1.0)
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

        # ── Route to real inference pipeline ─────────────────────────────────
        # Checkpoint exists: delegate to _generate_local() which loads the engine
        # (cached), runs the NotaGen generation loop, and passes the result through
        # the ABC projection pipeline.
        max_tokens: int = int(os.environ.get("NOTAGEN_MAX_TOKENS", "102400").strip() or "102400")
        return self._generate_local(
            payload=payload,
            provider_request=provider_request,
            context=context,
            model=model,
            generation_mode=generation_mode,
            abc_header=abc_header,
            rewrite_block=rewrite_block,
            rewrite_spec=rewrite_spec,
            is_localized_rewrite=is_localized_rewrite,
            candidate_seed=candidate_seed,
            candidate_index=candidate_index,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k,
            repetition_penalty=repetition_penalty,
            max_tokens=max_tokens,
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
