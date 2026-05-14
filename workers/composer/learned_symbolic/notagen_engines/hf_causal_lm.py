"""HuggingFace CausalLM inference engine for the NotaGen backend.

Experimental path — suitable for prototyping with any HuggingFace-compatible
checkpoint.  Does NOT implement NotaGen-specific tokenisation, bar-stream
patching, stop sequences, or bar-count budgeting.

Public API
----------
load_model(model_path, tokenizer_path, device_str) -> (model, tokenizer)
generate(model, tokenizer, abc_header, *, seed, ...) -> abc_body_str

Environment variables
---------------------
NOTAGEN_MODEL_PATH       Path to the HuggingFace checkpoint directory.
NOTAGEN_TOKENIZER_PATH   Path to the tokenizer (falls back to NOTAGEN_MODEL_PATH).
NOTAGEN_DEVICE           cpu | cuda | mps  (default: cpu)
"""
from __future__ import annotations

from typing import Any


def load_model(
    model_path: str,
    tokenizer_path: str,
    device_str: str,
) -> tuple[Any, Any]:
    """Load checkpoint via generic HuggingFace AutoModelForCausalLM.

    Parameters
    ----------
    model_path:
        Path to the HuggingFace checkpoint directory.
    tokenizer_path:
        Path to the tokenizer directory (may equal *model_path*).
    device_str:
        PyTorch device string: ``"cpu"``, ``"cuda"``, or ``"mps"``.

    Returns
    -------
    (model, tokenizer)

    Raises
    ------
    ImportError
        If ``torch`` or ``transformers`` are not installed.
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
    return model, tokenizer


def generate(
    model: Any,
    tokenizer: Any,
    abc_header: str,
    *,
    seed: int = 0,
    temperature: float = 0.9,
    top_p: float = 0.95,
    top_k: int = 50,
    repetition_penalty: float = 1.1,
    max_tokens: int = 2048,
) -> str:
    """Run one inference pass with the generic HuggingFace causal LM path.

    The conditioned ABC header is used as the prompt; the model generates the
    continuation as the ABC body.  No stop-sequence or bar-count logic is
    applied — generation stops at ``max_tokens`` new tokens or the EOS token.

    Returns the generated ABC body text (tokens appended after the prompt).
    """
    import torch  # type: ignore[import]

    device_str = str(next(model.parameters()).device)

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
