# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""NotaGen-class symbolic backend.

Supports two runtime modes controlled by LEARNED_SYMBOLIC_BACKEND:

  template (default)
    NotagenBackend is never instantiated; select_backend() returns TemplateBackend.
    This guard path returns ok=False if NotagenBackend is somehow invoked directly.

  notagen_mock
    Returns a deterministic, plan-conditioned mock ABC score without loading any
    ML model. Useful for CI/CD and integration tests.

  notagen_local
    Loads the model checkpoint at NOTAGEN_MODEL_PATH (lazy, process-singleton) and
    runs real inference. Falls back to ok=False on any import/inference error so
    the caller can apply its own fallback without crashing the worker process.

    The inference engine is selected by NOTAGEN_ENGINE:

      hf_causal_lm   (default)
        Generic HuggingFace AutoModelForCausalLM path. Works with any
        HuggingFace-compatible checkpoint. Treats the conditioned ABC header
        as the prompt and decodes the continuation as the ABC body.
        Suitable for rapid prototyping but lacks NotaGen-specific tokenisation,
        bar-stream patching, and hierarchical decoding.

      notagen_native
        Uses the NotaGen repo's own generate() API via a thin adapter in
        notagen_native_engine.py. Expects the checkpoint to follow the
        official NotaGen layout and uses the paper's ABC-specialised
        tokeniser and generation loop (stop sequences, bar-count budget,
        etc.). Use this engine for production-quality inference.

Environment variables:
  LEARNED_SYMBOLIC_BACKEND   template | notagen_mock | notagen_local  (default: template)
  NOTAGEN_ENGINE             hf_causal_lm | notagen_native            (default: hf_causal_lm)
  NOTAGEN_MODEL_PATH         path to checkpoint directory or .pt/.bin file
  NOTAGEN_TOKENIZER_PATH     path to tokenizer (falls back to NOTAGEN_MODEL_PATH)
  NOTAGEN_DEVICE             cpu | cuda | mps  (default: cpu)
  NOTAGEN_MAX_TOKENS         integer  (default: 2048)
  NOTAGEN_TIMEOUT_MS         integer milliseconds  (default: 120000)
  NOTAGEN_RESAMPLE_BUDGET    additional inference retries on validation failure (default: 2)

Connection points for Phase C validation pipeline:
  1. build_abc_header()             — AXIOM Plan → ABC conditioning header  [done]
  2. _run_local_inference(...)      — ABC header → ABC score body           [this file]
  3. run_abc_projection_pipeline()  — validate / repair / project            [done]
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

from .abc_conditioning import build_abc_header
from .abc_project import run_abc_projection_pipeline  # Phase C pipeline
from .abc_to_events import ABC_PIPELINE_AVAILABLE
from .backends import LearnedSymbolicBackendResult
from .localized_rewrite import build_rewrite_prompt_block
from .prompt_packing import ProviderPromptPackingContext

PROVIDER = "notagen"
MODEL_DEFAULT = "notagen-abc-v1"

# ─── Environment helpers ──────────────────────────────────────────────────────

def _env(key: str, fallback: str = "") -> str:
    return os.environ.get(key, fallback).strip()


def _env_int(key: str, fallback: int) -> int:
    raw = os.environ.get(key, "").strip()
    try:
        return int(raw) if raw else fallback
    except ValueError:
        return fallback


def _backend_mode() -> str:
    """Derive inference mode from LEARNED_SYMBOLIC_BACKEND.

    Returns 'mock', 'local', or 'disabled'.
    'disabled' is a defense-in-depth guard: select_backend() should never
    instantiate NotagenBackend unless the value is notagen_mock or notagen_local.
    """
    raw = _env("LEARNED_SYMBOLIC_BACKEND", "template").lower()
    if raw == "notagen_local":
        return "local"
    if raw == "notagen_mock":
        return "mock"
    return "disabled"


def _engine_name() -> str:
    """Return the configured inference engine name.

    Valid values: 'hf_causal_lm' (default), 'notagen_native'.
    Unknown values fall back to 'hf_causal_lm' with a warning logged at
    inference time.
    """
    raw = _env("NOTAGEN_ENGINE", "hf_causal_lm").lower()
    return raw if raw in ("hf_causal_lm", "notagen_native") else "hf_causal_lm"


# ─── Model singleton (local mode only) ───────────────────────────────────────

class _ModelSingleton:
    """Lazy-loaded, thread-safe model singleton for local inference.

    Keyed to the engine name so that changing NOTAGEN_ENGINE between
    subprocess invocations always loads the correct backend.
    """

    _lock = threading.Lock()
    _model: Any = None
    _tokenizer: Any = None
    _device: str = "cpu"
    _engine: str = ""
    _load_error: str | None = None
    _loaded: bool = False

    @classmethod
    def get(cls) -> tuple[Any, Any, str, str]:
        """Return (model, tokenizer, device, engine), loading once if necessary.

        Raises RuntimeError on load failure so caller can return ok=False.
        """
        if cls._loaded:
            if cls._load_error:
                raise RuntimeError(cls._load_error)
            return cls._model, cls._tokenizer, cls._device, cls._engine

        with cls._lock:
            if cls._loaded:
                if cls._load_error:
                    raise RuntimeError(cls._load_error)
                return cls._model, cls._tokenizer, cls._device, cls._engine

            try:
                cls._model, cls._tokenizer, cls._device, cls._engine = _load_model()
                cls._load_error = None
            except Exception as exc:  # noqa: BLE001
                cls._load_error = f"NotaGen model load failed: {exc}"
                cls._model = None
                cls._tokenizer = None
                cls._engine = ""
            finally:
                cls._loaded = True

            if cls._load_error:
                raise RuntimeError(cls._load_error)
            return cls._model, cls._tokenizer, cls._device, cls._engine


def _validate_model_path() -> tuple[str, str, str]:
    """Validate and return (model_path, tokenizer_path, device_str).

    Raises ValueError / FileNotFoundError on configuration errors.
    """
    model_path = _env("NOTAGEN_MODEL_PATH")
    tokenizer_path = _env("NOTAGEN_TOKENIZER_PATH") or model_path
    device_str = _env("NOTAGEN_DEVICE", "cpu")
    if not model_path:
        raise ValueError(
            "NOTAGEN_MODEL_PATH is not set. "
            "Set this variable to the checkpoint directory before using notagen_local mode."
        )
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"NOTAGEN_MODEL_PATH does not exist: {model_path!r}"
        )
    return model_path, tokenizer_path, device_str


def _load_model_hf_causal_lm(
    model_path: str,
    tokenizer_path: str,
    device_str: str,
) -> tuple[Any, Any, str]:
    """Load checkpoint via generic HuggingFace AutoModelForCausalLM.

    This is an experimental path suitable for prototyping with any
    HuggingFace-compatible layout. It does NOT implement NotaGen-specific
    tokenisation, stop sequences, or bar-count budgeting.

    Returns (model, tokenizer, device_str).
    """
    try:
        import torch  # type: ignore[import]
        from transformers import (  # type: ignore[import]
            AutoModelForCausalLM,
            AutoTokenizer,
        )
    except ImportError as exc:
        raise ImportError(
            f"NOTAGEN_ENGINE=hf_causal_lm requires 'torch' and 'transformers': {exc}. "
            "Install requirements-notagen.txt or set LEARNED_SYMBOLIC_BACKEND=template."
        ) from exc

    device = torch.device(device_str)
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_path, use_fast=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_path,
        torch_dtype=torch.float16 if device_str in ("cuda", "mps") else torch.float32,
        low_cpu_mem_usage=True,
    )
    model.to(device)
    model.eval()
    return model, tokenizer, device_str


def _load_model_notagen_native(
    model_path: str,
    tokenizer_path: str,
    device_str: str,
) -> tuple[Any, Any, str]:
    """Load checkpoint via the NotaGen repo's native API.

    Expects a notagen_native_engine module (e.g. installed from the official
    NotaGen repo) that exposes:

        notagen_native_engine.load_model(
            model_path, tokenizer_path, device
        ) -> (model, tokenizer)

    The module must implement NotaGen's ABC-specialised tokeniser and the
    official generate() interface (stop sequences, bar-count budget,
    hierarchical decoding).

    Returns (model, tokenizer, device_str).
    """
    try:
        import notagen_native_engine  # type: ignore[import]
    except ImportError as exc:
        raise ImportError(
            "NOTAGEN_ENGINE=notagen_native requires the 'notagen_native_engine' "
            "package from the official NotaGen repository. "
            f"Install it or switch to NOTAGEN_ENGINE=hf_causal_lm: {exc}"
        ) from exc

    model, tokenizer = notagen_native_engine.load_model(
        model_path, tokenizer_path, device_str
    )
    return model, tokenizer, device_str


def _load_model() -> tuple[Any, Any, str, str]:
    """Load the NotaGen model, routing to the engine specified by NOTAGEN_ENGINE.

    Returns (model, tokenizer, device_str, engine_name).
    """
    engine = _engine_name()
    model_path, tokenizer_path, device_str = _validate_model_path()

    if engine == "notagen_native":
        model, tokenizer, device_str = _load_model_notagen_native(
            model_path, tokenizer_path, device_str
        )
    else:
        # hf_causal_lm — default / fallback
        model, tokenizer, device_str = _load_model_hf_causal_lm(
            model_path, tokenizer_path, device_str
        )

    return model, tokenizer, device_str, engine


# ─── Local inference ──────────────────────────────────────────────────────────

def _run_inference_hf_causal_lm(
    model: Any,
    tokenizer: Any,
    device_str: str,
    abc_header: str,
    *,
    seed: int,
    temperature: float,
    top_p: float,
    top_k: int,
    repetition_penalty: float,
    max_tokens: int,
) -> str:
    """Run one inference pass with the generic HuggingFace causal LM path.

    Returns the generated ABC body text (tokens appended after the prompt).
    No stop-sequence or bar-count logic is applied; the model generates until
    max_new_tokens is reached or the EOS token is emitted.
    """
    import torch  # type: ignore[import]

    torch.manual_seed(seed)
    if device_str == "cuda":
        torch.cuda.manual_seed_all(seed)

    inputs = tokenizer(abc_header, return_tensors="pt")
    input_ids = inputs["input_ids"].to(device_str)

    with torch.no_grad():
        output_ids = model.generate(
            input_ids,
            max_new_tokens=max_tokens,
            do_sample=temperature > 0,
            temperature=temperature if temperature > 0 else 1.0,
            top_p=top_p,
            top_k=top_k,
            repetition_penalty=repetition_penalty,
            pad_token_id=tokenizer.eos_token_id,
        )

    generated_ids = output_ids[0, input_ids.shape[1]:]
    return tokenizer.decode(generated_ids, skip_special_tokens=True)


def _run_inference_notagen_native(
    model: Any,
    tokenizer: Any,
    device_str: str,
    abc_header: str,
    *,
    seed: int,
    temperature: float,
    top_p: float,
    top_k: int,
    repetition_penalty: float,
    max_tokens: int,
) -> str:
    """Run one inference pass via the NotaGen repo's native generate() API.

    Expects the loaded model/tokenizer to follow the official NotaGen interface:

        notagen_native_engine.generate(
            model, tokenizer, prompt, seed, temperature, top_p, top_k,
            repetition_penalty, max_tokens
        ) -> abc_body_str

    The native engine is responsible for:
      - ABC-specialised tokenisation
      - Bar-stream patching / hierarchical decoding
      - Stop-sequence handling (e.g., end-of-score token)
      - Section-count and bar-count budgeting

    Returns the generated ABC body text.
    """
    try:
        import notagen_native_engine  # type: ignore[import]
    except ImportError as exc:
        raise RuntimeError(
            f"notagen_native_engine not importable at inference time: {exc}"
        ) from exc

    return notagen_native_engine.generate(
        model,
        tokenizer,
        abc_header,
        seed=seed,
        temperature=temperature,
        top_p=top_p,
        top_k=top_k,
        repetition_penalty=repetition_penalty,
        max_tokens=max_tokens,
    )


def _run_local_inference(
    abc_header: str,
    *,
    seed: int,
    temperature: float,
    top_p: float,
    top_k: int,
    repetition_penalty: float,
    max_tokens: int,
) -> str:
    """Run one NotaGen inference pass, routing by the loaded engine.

    Returns the generated ABC body (text after the conditioning header).
    Raises RuntimeError on any model/tokenizer failure.
    """
    model, tokenizer, device_str, engine = _ModelSingleton.get()

    if engine == "notagen_native":
        return _run_inference_notagen_native(
            model, tokenizer, device_str, abc_header,
            seed=seed,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k,
            repetition_penalty=repetition_penalty,
            max_tokens=max_tokens,
        )

    return _run_inference_hf_causal_lm(
        model, tokenizer, device_str, abc_header,
        seed=seed,
        temperature=temperature,
        top_p=top_p,
        top_k=top_k,
        repetition_penalty=repetition_penalty,
        max_tokens=max_tokens,
    )


# ─── Mock ABC builder ─────────────────────────────────────────────────────────

def _build_mock_abc(context: ProviderPromptPackingContext, candidate_seed: int) -> str:
    """Return a deterministic minimal ABC score for testing.

    The content is just enough to pass Phase C validation: valid headers
    with three voices and a minimal melody per section.  The actual pitches
    are derived from the seed so different candidates differ.
    """
    control_lines = context.get("controlLines") or []

    # Extract key/meter/tempo from control lines
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

    # Count expected sections from the conditioning header
    abc_header = build_abc_header(context)
    section_count = max(1, sum(
        1 for line in abc_header.splitlines() if line.startswith("%% axiom_section")
    ))

    # Pitch pool — offset by seed for variety
    pitch_pool = ["C", "D", "E", "F", "G", "A", "B"]
    root_idx = candidate_seed % len(pitch_pool)
    lead_pitch = pitch_pool[root_idx]
    counter_pitch = pitch_pool[(root_idx + 2) % len(pitch_pool)]
    bass_pitch = pitch_pool[(root_idx + 4) % len(pitch_pool)].lower()

    # Build a 4-bar pattern per section
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


# ─── Backend class ────────────────────────────────────────────────────────────

class NotagenBackend:
    """NotaGen-class ABC inference backend.

    Dispatches to mock / local based on LEARNED_SYMBOLIC_BACKEND.
    All failures return ok=False rather than raising so the worker process
    stays alive and the caller can apply its own fallback.
    """

    def generate(
        self,
        payload: dict[str, Any],
        context: ProviderPromptPackingContext | None,
    ) -> LearnedSymbolicBackendResult:
        mode = _backend_mode()
        provider_request: dict[str, Any] = dict(payload.get("providerRequest") or {})
        model = str(provider_request.get("model") or MODEL_DEFAULT)

        # ── Phase D: sampling params ──────────────────────────────────────────
        candidate_index = int(provider_request.get("candidateIndex") or 0)
        sampling_params: dict[str, Any] = dict(
            provider_request.get("samplingParams") or {}
        )
        temperature: float = float(sampling_params.get("temperature") or 0.9)
        top_p: float = float(sampling_params.get("topP") or 0.95)
        top_k: int = int(sampling_params.get("topK") or 50)
        seed_offset: int = int(sampling_params.get("seedOffset") or 0)
        repetition_penalty: float = float(
            sampling_params.get("repetitionPenalty") or 1.1
        )
        max_tokens: int = int(
            sampling_params.get("maxTokens")
            or _env_int("NOTAGEN_MAX_TOKENS", 2048)
        )
        stable_seed: int = int(payload.get("stableSeed") or 0)
        candidate_seed = stable_seed + candidate_index + seed_offset

        # ── Phase E: localized rewrite spec ──────────────────────────────────
        rewrite_spec: dict[str, Any] | None = (
            provider_request.get("rewriteSpec") or None
        )
        is_localized_rewrite = bool(
            isinstance(rewrite_spec, dict) and rewrite_spec.get("rewriteSectionIds")
        )
        # Embed the engine name in generationMode so benchmark pipelines can
        # distinguish hf_causal_lm prototype runs from notagen_native runs.
        engine = _engine_name()
        generation_mode = (
            f"targeted_section_rewrite_{engine}"
            if is_localized_rewrite
            else f"notagen_abc_inference_{engine}"
        )

        # ── Mode: disabled ────────────────────────────────────────────────────
        if mode == "disabled":
            return LearnedSymbolicBackendResult(
                ok=False,
                provider=PROVIDER,
                model=model,
                generation_mode=generation_mode,
                error=(
                    "NotaGen backend is not active "
                    "(LEARNED_SYMBOLIC_BACKEND is not set to notagen_mock or notagen_local). "
                    "The music21 symbolic path remains available. "
                    "Set LEARNED_SYMBOLIC_BACKEND=notagen_mock to use mock inference or "
                    "LEARNED_SYMBOLIC_BACKEND=notagen_local with NOTAGEN_MODEL_PATH to use "
                    "real inference."
                ),
            )

        # ── Require valid context for mock and local modes ────────────────────
        if context is None:
            return LearnedSymbolicBackendResult(
                ok=False,
                provider=PROVIDER,
                model=model,
                generation_mode=generation_mode,
                error=(
                    "NotaGen backend requires a valid ProviderPromptPackingContext "
                    "(providerRequest was absent or failed validation)."
                ),
            )

        # ── Build deterministic ABC conditioning header ───────────────────────
        abc_header = build_abc_header(context)
        section_count = sum(
            1 for line in abc_header.splitlines()
            if line.startswith("%% axiom_section")
        )

        # Localized rewrite block
        rewrite_block = ""
        if is_localized_rewrite and rewrite_spec is not None:
            rewrite_block = build_rewrite_prompt_block(
                rewrite_section_ids=list(rewrite_spec.get("rewriteSectionIds") or []),
                keep_section_ids=list(rewrite_spec.get("keepSectionIds") or []),
                reason=str(rewrite_spec.get("reason") or ""),
                directives=list(rewrite_spec.get("directives") or []),
            )

        # ── Mode: mock ────────────────────────────────────────────────────────
        if mode == "mock":
            return self._generate_mock(
                payload, provider_request, context,
                model=model,
                generation_mode=generation_mode,
                candidate_seed=candidate_seed,
                candidate_index=candidate_index,
            )

        # ── Mode: local ───────────────────────────────────────────────────────
        return self._generate_local(
            payload, provider_request, context,
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

    # ── Mock generation ───────────────────────────────────────────────────────

    def _generate_mock(
        self,
        payload: dict[str, Any],
        provider_request: dict[str, Any],
        context: ProviderPromptPackingContext,
        *,
        model: str,
        generation_mode: str,
        candidate_seed: int,
        candidate_index: int,
    ) -> LearnedSymbolicBackendResult:
        mock_abc = _build_mock_abc(context, candidate_seed)
        sections = list(payload.get("promptPack", {}).get("sections") or [])
        output_path: str | None = str(payload.get("outputPath") or "") or None
        keep_artifacts = (
            list(payload.get("sectionArtifacts") or [])
            if bool(provider_request.get("rewriteSpec"))
            else None
        )

        result = run_abc_projection_pipeline(
            mock_abc,
            sections,
            provider_request,
            output_path=output_path,
            keep_section_artifacts=keep_artifacts,
        )

        if not result.ok:
            return LearnedSymbolicBackendResult(
                ok=False,
                provider=PROVIDER,
                model=model,
                generation_mode=generation_mode,
                abc_text=mock_abc,
                error=f"Mock ABC failed Phase C validation: {result.error}",
            )

        note_ct = sum(len(s.get("noteHistory") or []) for s in result.proposal_sections)
        bar_ct = sum(s.get("measureCount") or 0 for s in result.proposal_sections)
        mock_warnings = ["mock_backend_not_for_quality_eval", *result.normalization_warnings]
        return LearnedSymbolicBackendResult(
            ok=True,
            provider=PROVIDER,
            model=model,
            generation_mode="mock_notagen_abc",
            abc_text=mock_abc,
            midi_path=result.midi_path,
            proposal_sections=result.proposal_sections,
            warnings=mock_warnings,
            note_count=note_ct,
            measure_count=bar_ct,
            key_name=str(provider_request.get("key") or ""),
            form=str(provider_request.get("form") or ""),
            tempo_bpm=int(provider_request.get("tempo") or 92),
            confidence=0.5,
        )

    # ── Local inference ───────────────────────────────────────────────────────

    def _generate_local(
        self,
        payload: dict[str, Any],
        provider_request: dict[str, Any],
        context: ProviderPromptPackingContext,
        *,
        model: str,
        generation_mode: str,
        abc_header: str,
        rewrite_block: str,
        rewrite_spec: dict[str, Any] | None,
        is_localized_rewrite: bool,
        candidate_seed: int,
        candidate_index: int,
        temperature: float,
        top_p: float,
        top_k: int,
        repetition_penalty: float,
        max_tokens: int,
    ) -> LearnedSymbolicBackendResult:
        resample_budget: int = _env_int("NOTAGEN_RESAMPLE_BUDGET", 2)
        timeout_ms: int = _env_int("NOTAGEN_TIMEOUT_MS", 120_000)
        sections = list(payload.get("promptPack", {}).get("sections") or [])
        output_path: str | None = str(payload.get("outputPath") or "") or None
        keep_artifacts = (
            list(payload.get("sectionArtifacts") or [])
            if is_localized_rewrite
            else None
        )

        full_prompt = (
            (abc_header + "\n" + rewrite_block) if rewrite_block else abc_header
        )

        deadline = time.monotonic() + timeout_ms / 1000.0
        last_error: str | None = None
        last_abc: str | None = None

        for attempt in range(1 + resample_budget):
            attempt_seed = candidate_seed + attempt * 1000  # vary seed per resample

            if time.monotonic() > deadline:
                last_error = "Inference timed out before all resample attempts completed"
                break

            try:
                abc_body = _run_local_inference(
                    full_prompt,
                    seed=attempt_seed,
                    temperature=temperature,
                    top_p=top_p,
                    top_k=top_k,
                    repetition_penalty=repetition_penalty,
                    max_tokens=max_tokens,
                )
            except Exception as exc:  # noqa: BLE001
                last_error = f"NotaGen inference error: {exc}"
                # Do not retry on model-load errors (they will repeat)
                if "model load failed" in str(exc).lower():
                    break
                continue

            abc_full = abc_header + "\n" + abc_body
            last_abc = abc_full

            result = run_abc_projection_pipeline(
                abc_full,
                sections,
                provider_request,
                output_path=output_path if attempt == 0 or resample_budget == 0 else None,
                keep_section_artifacts=keep_artifacts,
            )

            if result.ok:
                # On resample, re-run pipeline with output_path if needed
                if output_path and attempt > 0:
                    result = run_abc_projection_pipeline(
                        abc_full,
                        sections,
                        provider_request,
                        output_path=output_path,
                        keep_section_artifacts=keep_artifacts,
                    )
                note_ct = sum(len(s.get("noteHistory") or []) for s in result.proposal_sections)
                bar_ct = sum(s.get("measureCount") or 0 for s in result.proposal_sections)
                warnings = list(result.normalization_warnings)
                if attempt > 0:
                    warnings.append(f"abc_resampled_after_{attempt}_failed_validation_attempts")
                return LearnedSymbolicBackendResult(
                    ok=True,
                    provider=PROVIDER,
                    model=model,
                    generation_mode=generation_mode,
                    abc_text=abc_full,
                    midi_path=result.midi_path,
                    proposal_sections=result.proposal_sections,
                    warnings=warnings,
                    note_count=note_ct,
                    measure_count=bar_ct,
                    key_name=str(provider_request.get("key") or ""),
                    form=str(provider_request.get("form") or ""),
                    tempo_bpm=int(provider_request.get("tempo") or 92),
                    confidence=max(0.1, 1.0 - attempt * 0.2),
                )

            last_error = result.error or "ABC validation failed"

        # All attempts exhausted
        return LearnedSymbolicBackendResult(
            ok=False,
            provider=PROVIDER,
            model=model,
            generation_mode=generation_mode,
            abc_text=last_abc,
            error=(
                f"NotaGen generated invalid ABC after {1 + resample_budget} attempt(s). "
                f"Last error: {last_error}"
            ),
        )
