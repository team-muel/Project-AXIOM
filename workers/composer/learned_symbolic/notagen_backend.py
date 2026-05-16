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
    Runs real inference via a persistent subprocess (_notagen_inference_worker.py).
    The subprocess loads the model checkpoint at NOTAGEN_MODEL_PATH once (lazy
    singleton) and handles requests over a line-delimited JSON stdin/stdout protocol.

    Hard timeout is enforced by killing the subprocess if it does not respond
    within NOTAGEN_TIMEOUT_MS.  This guarantees that even a hung model.generate()
    call is forcibly terminated.  After a kill the subprocess is automatically
    restarted on the next inference attempt (at the cost of one model reload).

    The inference engine is selected by NOTAGEN_ENGINE:

      hf_causal_lm   (default)
        Generic HuggingFace AutoModelForCausalLM path. Works with any
        HuggingFace-compatible checkpoint. Treats the conditioned ABC header
        as the prompt and decodes the continuation as the ABC body.
        Suitable for rapid prototyping but lacks NotaGen-specific tokenisation,
        bar-stream patching, and hierarchical decoding.

      notagen_native
        Uses the official NotaGen hierarchical decoder via a thin adapter in
        notagen_engines/notagen_native.py. Expects the checkpoint to follow the
        official NotaGen layout and uses the paper's ABC-specialised
        tokeniser and generation loop (stop sequences, bar-count budget,
        etc.). Use this engine for production-quality inference.

Environment variables:
  LEARNED_SYMBOLIC_BACKEND   template | notagen_mock | notagen_local  (default: template)
  NOTAGEN_ENGINE             hf_causal_lm | notagen_native            (default: hf_causal_lm)
  NOTAGEN_MODEL_PATH         path to checkpoint file or directory
  NOTAGEN_TOKENIZER_PATH     path to tokenizer (falls back to NOTAGEN_MODEL_PATH)
  NOTAGEN_DEVICE             cpu | cuda | mps  (default: cpu)
  NOTAGEN_MAX_TOKENS         integer  (default: 2048)
  NOTAGEN_TIMEOUT_MS         hard wall-clock timeout per inference call.
                             Default is engine-specific: 120000 ms for hf_causal_lm,
                             600000 ms for notagen_native (NotaGen-X is significantly
                             slower than HF causal decoding).
                             On timeout the inference subprocess is killed.
  NOTAGEN_RESAMPLE_BUDGET    additional inference retries on validation failure (default: 2)
                             Timeout failures are NOT retried.

Connection points for Phase C validation pipeline:
  1. build_abc_header()             — AXIOM Plan → ABC conditioning header  [done]
  2. _run_local_inference(...)      — ABC header → ABC score body (subprocess IPC) [this file]
  3. run_abc_projection_pipeline()  — validate / repair / project            [done]
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
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
        raise FileNotFoundError(f"NOTAGEN_MODEL_PATH does not exist: {model_path!r}")
    return model_path, tokenizer_path, device_str


def _load_model() -> tuple[Any, Any, str, str]:
    """Load the NotaGen model, routing to the engine specified by NOTAGEN_ENGINE.

    Delegates to ``notagen_engines.load_engine_model()`` for the engine-specific
    load logic.  Returns (model, tokenizer, device_str, engine_name).
    """
    engine = _engine_name()
    model_path, tokenizer_path, device_str = _validate_model_path()
    from .notagen_engines import load_engine_model  # noqa: PLC0415

    model, tokenizer = load_engine_model(engine, model_path, tokenizer_path, device_str)
    return model, tokenizer, device_str, engine


# ─── Local inference ──────────────────────────────────────────────────────────


def _run_inference_inline(
    abc_header: str,
    *,
    seed: int,
    temperature: float,
    top_p: float,
    top_k: int,
    repetition_penalty: float,
    max_tokens: int,
) -> str:
    """Run one NotaGen inference pass inline (in the current process).

    Called by the subprocess worker (_notagen_inference_worker.py) which runs
    in a separate process that the parent can hard-kill on timeout.
    Do NOT call this directly from NotagenBackend — use _run_local_inference()
    which goes through _InferenceSubprocessManager for hard-timeout enforcement.

    Delegates to ``notagen_engines.run_engine_generate()`` for engine-specific
    inference logic.

    Returns the generated ABC text.  The exact contract is engine-dependent:
    - ``hf_causal_lm``: returns the ABC body only (continuation after the prompt).
    - ``notagen_native``: returns the full ABC score (``X:1``, headers, and body).
    Callers that concatenate the header must check the engine via
    ``_engine_name()`` before doing so.
    Raises RuntimeError on any model/tokenizer failure.
    """
    model, tokenizer, _device_str, engine = _ModelSingleton.get()
    from .notagen_engines import run_engine_generate  # noqa: PLC0415

    return run_engine_generate(
        engine,
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


# ─── Subprocess inference manager ─────────────────────────────────────────────


class _InferenceSubprocessManager:
    """Manages a single persistent inference child process.

    The child process runs _notagen_inference_worker.py, loads the model
    once (singleton within the child), and handles one request at a time
    via a line-delimited JSON stdin/stdout protocol.

    Hard timeout is enforced by a background thread that reads the child's
    stdout.  If the thread does not return within the deadline, the child
    process is killed (SIGKILL / TerminateProcess) so even a hung
    model.generate() call is forcibly terminated.

    After a kill, the next call automatically restarts the child and
    reloads the model.  This means each timeout costs one model-load
    on the subsequent call.

    Thread safety: the lock serialises all requests.  Only one inference
    call may be in flight at a time.
    """

    _lock = threading.Lock()
    _proc: subprocess.Popen | None = None  # type: ignore[type-arg]

    @classmethod
    def _worker_script(cls) -> str:
        return os.path.join(os.path.dirname(__file__), "_notagen_inference_worker.py")

    @classmethod
    def _cwd(cls) -> str:
        # workers/composer/ — parent of the learned_symbolic package
        return os.path.dirname(os.path.dirname(__file__))

    @classmethod
    def _start(cls) -> "subprocess.Popen[str]":
        env = os.environ.copy()
        # Ensure stdout is not buffered in the child so JSON lines arrive immediately.
        env["PYTHONUNBUFFERED"] = "1"
        return subprocess.Popen(
            [sys.executable, cls._worker_script()],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,  # inherit parent stderr so model-load progress is visible
            text=True,
            cwd=cls._cwd(),
            env=env,
        )

    @classmethod
    def _ensure_alive(cls) -> "subprocess.Popen[str]":
        """Return the running child process, starting one if necessary."""
        if cls._proc is not None and cls._proc.poll() is None:
            return cls._proc
        cls._proc = cls._start()
        return cls._proc

    @classmethod
    def call(cls, request: dict, *, timeout_sec: float) -> dict:
        """Send one inference request and return the parsed JSON response.

        Raises
        ------
        TimeoutError
            If the child does not respond within *timeout_sec* seconds.
            The child is killed before raising.
        RuntimeError
            If the child exits unexpectedly (empty stdout) or sends invalid JSON.
        """
        with cls._lock:
            proc = cls._ensure_alive()
            assert proc.stdin is not None
            assert proc.stdout is not None

            line = json.dumps(request, ensure_ascii=False) + "\n"
            try:
                proc.stdin.write(line)
                proc.stdin.flush()
            except (BrokenPipeError, OSError):
                # Child died between _ensure_alive and write — restart and retry once.
                proc.kill()
                cls._proc = None
                proc = cls._ensure_alive()
                assert proc.stdin is not None
                assert proc.stdout is not None
                proc.stdin.write(line)
                proc.stdin.flush()

            # Read the response line in a daemon thread so we can impose a
            # wall-clock deadline and kill the child if it exceeds it.
            result_holder: list[str] = []

            def _read() -> None:
                try:
                    result_holder.append(proc.stdout.readline())  # type: ignore[union-attr]
                except Exception:  # noqa: BLE001
                    pass

            reader = threading.Thread(target=_read, daemon=True)
            reader.start()
            reader.join(timeout=timeout_sec)

            if reader.is_alive():
                # Timeout: hard-kill the child.  The thread is a daemon so it
                # will not prevent process exit even if still blocked on readline.
                proc.kill()
                cls._proc = None
                raise TimeoutError(
                    f"NotaGen inference subprocess timed out after {timeout_sec:.0f}s. "
                    "Child process was killed.  NOTAGEN_TIMEOUT_MS can be increased "
                    "if the model needs more time."
                )

            raw = result_holder[0] if result_holder else ""
            if not raw.strip():
                # Child exited or wrote nothing — mark as dead.
                cls._proc = None
                raise RuntimeError(
                    "NotaGen inference subprocess exited unexpectedly "
                    "(empty stdout).  Check stderr for model-load errors."
                )

            try:
                return json.loads(raw)
            except json.JSONDecodeError as exc:
                cls._proc = None
                raise RuntimeError(
                    f"NotaGen inference subprocess returned invalid JSON: {raw!r}"
                ) from exc


# ─── Public local inference entry point ───────────────────────────────────────


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
    """Run one NotaGen inference pass via a hard-timeout subprocess.

    Spawns (or reuses) a persistent inference child process and sends the
    inference parameters as a JSON line to its stdin.  Reads the ABC response
    from the child's stdout within NOTAGEN_TIMEOUT_MS.  If the child hangs,
    it is killed with SIGKILL / TerminateProcess so even a blocked
    model.generate() call is forcibly terminated.

    Returns the generated ABC text.
    Raises TimeoutError on hard timeout, RuntimeError on other failures.
    """
    engine = _engine_name()
    # Use engine-specific defaults: native hierarchical decoding is significantly
    # slower than HF causal LM, so it gets a longer hard timeout.
    default_timeout_ms = 600_000 if engine == "notagen_native" else 120_000
    timeout_ms = _env_int("NOTAGEN_TIMEOUT_MS", default_timeout_ms)
    request = {
        "abc_header": abc_header,
        "seed": seed,
        "temperature": temperature,
        "top_p": top_p,
        "top_k": top_k,
        "repetition_penalty": repetition_penalty,
        "max_tokens": max_tokens,
    }
    response = _InferenceSubprocessManager.call(
        request, timeout_sec=timeout_ms / 1000.0
    )
    if not response.get("ok"):
        raise RuntimeError(
            response.get("error")
            or "Inference subprocess returned ok=false without error detail"
        )
    abc_text = response.get("abc_text", "")
    if not isinstance(abc_text, str):
        raise RuntimeError(
            f"Inference subprocess returned unexpected abc_text type: {type(abc_text)}"
        )
    return abc_text


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
            sampling_params.get("maxTokens") or _env_int("NOTAGEN_MAX_TOKENS", 2048)
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
            1 for line in abc_header.splitlines() if line.startswith("%% axiom_section")
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
                payload,
                provider_request,
                context,
                model=model,
                generation_mode=generation_mode,
                candidate_seed=candidate_seed,
                candidate_index=candidate_index,
            )

        # ── Mode: local ───────────────────────────────────────────────────────
        return self._generate_local(
            payload,
            provider_request,
            context,
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
        from .notagen_engines.mock import build_mock_abc  # noqa: PLC0415

        mock_abc = build_mock_abc(context, candidate_seed)
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
            lane=str(context.get("lane") or ""),
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
        mock_warnings = [
            "mock_backend_not_for_quality_eval",
            *result.normalization_warnings,
        ]
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
            voice_layout_summary=result.voice_layout_summary,
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
        sections = list(payload.get("promptPack", {}).get("sections") or [])
        output_path: str | None = str(payload.get("outputPath") or "") or None
        resolved_lane = str(context.get("lane") or "")
        keep_artifacts = (
            list(payload.get("sectionArtifacts") or [])
            if is_localized_rewrite
            else None
        )

        # notagen_native converts the ABC header to a 3-line NotaGen prompt
        # (%Period / %Composer / %Instrumentation) and cannot honour the
        # <AXIOM_REWRITE> block at all.  When a rewrite was requested but the
        # active engine is notagen_native, we:
        #   • strip the rewrite block from the prompt (pass abc_header only)
        #   • downgrade generation_mode to a full-regen label
        #   • clear keep_artifacts so the full fresh output is used as-is
        #   • surface a warning on every result so callers know the downgrade
        engine_specific_warnings: list[str] = []
        if _engine_name() == "notagen_native" and rewrite_block:
            engine_specific_warnings.append(
                "notagen_native_rewrite_block_ignored_full_regen"
            )
            generation_mode = f"notagen_abc_inference_{_engine_name()}"
            keep_artifacts = None
            full_prompt = abc_header
        else:
            full_prompt = (
                (abc_header + "\n" + rewrite_block) if rewrite_block else abc_header
            )

        last_error: str | None = None
        last_abc: str | None = None

        for attempt in range(1 + resample_budget):
            attempt_seed = candidate_seed + attempt * 1000  # vary seed per resample

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
            except TimeoutError as exc:
                # Timeout kills the subprocess — no point retrying immediately.
                last_error = f"NotaGen inference timed out: {exc}"
                break
            except Exception as exc:  # noqa: BLE001
                last_error = f"NotaGen inference error: {exc}"
                # Do not retry on model-load errors (they will repeat).
                if "model load failed" in str(exc).lower():
                    break
                continue

            # notagen_native already returns the full ABC score (X:1 + headers +
            # body).  hf_causal_lm returns only the body, so we prepend the
            # AXIOM conditioning header.  Concatenating header + full-score
            # would duplicate the X:/M:/K: fields and break music21 parsing.
            if _engine_name() == "notagen_native":
                abc_full = abc_body
            else:
                abc_full = abc_header + "\n" + abc_body
            last_abc = abc_full

            result = run_abc_projection_pipeline(
                abc_full,
                sections,
                provider_request,
                output_path=output_path
                if attempt == 0 or resample_budget == 0
                else None,
                keep_section_artifacts=keep_artifacts,
                lane=resolved_lane,
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
                        lane=resolved_lane,
                    )
                note_ct = sum(
                    len(s.get("noteHistory") or []) for s in result.proposal_sections
                )
                bar_ct = sum(
                    s.get("measureCount") or 0 for s in result.proposal_sections
                )
                warnings = list(result.normalization_warnings)
                if attempt > 0:
                    warnings.append(
                        f"abc_resampled_after_{attempt}_failed_validation_attempts"
                    )
                warnings.extend(engine_specific_warnings)
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
                    voice_layout_summary=result.voice_layout_summary,
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
            warnings=list(engine_specific_warnings),
        )
