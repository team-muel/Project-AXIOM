"""Engine dispatch for the NotaGen inference backend.

Each engine module exposes a uniform two-function public API::

    load_model(model_path, tokenizer_path, device_str) -> (model, tokenizer)
    generate(model, tokenizer, abc_header, *, seed, ...) -> abc_text_str

Available engines
-----------------
hf_causal_lm
    Generic HuggingFace ``AutoModelForCausalLM`` path.  Experimental — does not
    implement NotaGen-specific tokenisation, bar-stream patching, or hierarchical
    decoding.  Suitable for rapid prototyping only.

notagen_native
    Official NotaGen hierarchical decoder (patch-level + char-level GPT-2).
    Uses the model's own ``Patchilizer`` tokeniser and generation loop.
    Requires the NotaGen repository at ``NOTAGEN_REPO_PATH`` and weights at
    ``NOTAGEN_MODEL_PATH``.  Use this engine for production-quality inference.

Environment variable
--------------------
NOTAGEN_ENGINE    hf_causal_lm | notagen_native  (default: hf_causal_lm)
"""

from __future__ import annotations

from typing import Any

KNOWN_ENGINES = ("hf_causal_lm", "notagen_native")


def load_engine_model(
    engine: str,
    model_path: str,
    tokenizer_path: str,
    device_str: str,
) -> tuple[Any, Any]:
    """Load model and tokenizer/patchilizer for the named engine.

    Dispatches to the engine-specific ``load_model()`` function.
    Returns ``(model, tokenizer)``.
    """
    if engine == "notagen_native":
        from .notagen_native import load_model  # noqa: PLC0415
    else:
        from .hf_causal_lm import load_model  # noqa: PLC0415
    return load_model(model_path, tokenizer_path, device_str)


def run_engine_generate(
    engine: str,
    model: Any,
    tokenizer: Any,
    abc_header: str,
    *,
    seed: int,
    temperature: float,
    top_p: float,
    top_k: int,
    repetition_penalty: float,
    max_tokens: int,
) -> str:
    """Generate ABC text using the named engine.

    Dispatches to the engine-specific ``generate()`` function.

    Returns the generated ABC text.  The exact contract is engine-dependent:
    - ``hf_causal_lm``: returns the ABC body only (continuation after the prompt).
    - ``notagen_native``: returns the full ABC score (``X:1``, headers, and body).
    """
    if engine == "notagen_native":
        from .notagen_native import generate  # noqa: PLC0415
    else:
        from .hf_causal_lm import generate  # noqa: PLC0415
    return generate(
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
