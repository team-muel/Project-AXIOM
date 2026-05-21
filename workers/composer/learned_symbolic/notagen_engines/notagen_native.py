"""Official NotaGen native inference engine.

Adapter between AXIOM's notagen_backend.py and the official NotaGen repository.
Moved from learned_symbolic/notagen_native_engine.py.

This module provides two public functions that ``notagen_backend.py`` calls at
runtime when ``NOTAGEN_ENGINE=notagen_native``:

    load_model(model_path, tokenizer_path, device_str) -> (model, patchilizer)
    generate(model, patchilizer, abc_header, *, seed, ...) -> abc_text_str

Architecture notes
------------------
NotaGen is *not* a standard HuggingFace causal LM.  It uses a hierarchical
two-level decoder:

  1. **Patch-level decoder** (GPT-2-class, 12–20 layers) — encodes/decodes
     sequences of 16-byte character patches.
  2. **Character-level decoder** (GPT-2-class, 3–6 layers) — generates one
     character at a time within each patch, conditioned on the encoded patch
     feature from the patch-level decoder.

As a result:
- ``AutoModelForCausalLM.from_pretrained()`` cannot load NotaGen weights.
- The weights are ``.pth`` files loaded via ``torch.load`` + ``load_state_dict``.
- There is no HuggingFace tokenizer; the "tokenizer" is a custom ``Patchilizer``
  that splits ABC text into 16-character patches.
- Generation is a patch-by-patch loop, not a single ``model.generate()`` call.

Prompt format
-------------
NotaGen was fine-tuned with the prompt::

    %<Period>\\n%<Composer>\\n%<Instrumentation>\\n

This module converts AXIOM's ``%% axiom_*`` conditioning header into that format
using the control-line hints embedded in the header.  Two env vars let operators
override the default mapping:

    NOTAGEN_DEFAULT_PERIOD        e.g. "Romantic"  (default: "Romantic")
    NOTAGEN_DEFAULT_COMPOSER      e.g. "Beethoven, Ludwig van"  (default: "Beethoven, Ludwig van")

Instrumentation is derived from AXIOM's ``instrumentation=`` control line via a
built-in mapping table.

NotaGen repo import
-------------------
The NotaGen model/tokenizer classes live in the *official NotaGen repo*
(https://github.com/ElectricAlexis/NotaGen).  Point NOTAGEN_REPO_PATH to the
cloned directory so this module can import from it::

    export NOTAGEN_REPO_PATH=/opt/notagen_repo

The repo's ``gradio/`` or ``inference/`` subdirectory must be on the path; this
module tries both.  Alternatively, install the repo as a package.

Timeout and budget
------------------
The generation loop respects:

  max_tokens  — soft cap on total characters emitted (from NOTAGEN_MAX_TOKENS)
  NOTAGEN_TIMEOUT_MS — hard wall-clock limit.

The parent subprocess manager (notagen_backend._run_local_inference) enforces
NOTAGEN_TIMEOUT_MS as a hard kill on the child process.  Its engine-specific
default is 120 000 ms for hf_causal_lm and 600 000 ms for notagen_native,
because NotaGen-X (1024-patch context) is significantly slower than HF causal
decoding.  The inner loop below also reads NOTAGEN_TIMEOUT_MS as a soft limit
and uses the same 600 000 ms fallback; in practice the parent kill fires first.
"""

from __future__ import annotations

import importlib.util
import os
import re
import sys
import time
import types
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass

# ─── Env helpers ─────────────────────────────────────────────────────────────

def _env(key: str, fallback: str = "") -> str:
    return os.environ.get(key, fallback).strip()


def _env_int(key: str, fallback: int) -> int:
    raw = os.environ.get(key, "").strip()
    try:
        return int(raw) if raw else fallback
    except ValueError:
        return fallback


# ─── NotaGen repo import ──────────────────────────────────────────────────────

# Module-level cache so the file-based import runs only once per process.
_notagen_utils: "types.ModuleType | None" = None


def _load_notagen_utils() -> "types.ModuleType":
    """Load the NotaGen utils module, isolated from any generic 'utils' on sys.path.

    Resolution order:
    1. Installed package ``notagen_utils`` (cleanest deployment).
    2. File-based import from ``NOTAGEN_REPO_PATH/gradio/utils.py`` or
       ``NOTAGEN_REPO_PATH/inference/utils.py`` or ``NOTAGEN_REPO_PATH/utils.py``.
       Uses ``importlib.util.spec_from_file_location`` so the module is registered
       as ``notagen_official_utils`` rather than the generic name ``utils``,
       preventing collisions with any other ``utils.py`` on sys.path.

    Returns the loaded module.  Raises ImportError on failure.
    """
    global _notagen_utils  # noqa: PLW0603
    if _notagen_utils is not None:
        return _notagen_utils

    # ── Option 1: installed as notagen_utils package ──────────────────────────
    try:
        import notagen_utils as _nu  # type: ignore[import]
        _notagen_utils = _nu
        return _notagen_utils
    except ImportError:
        pass

    # ── Option 2: file-based import from NOTAGEN_REPO_PATH ───────────────────
    repo_path = _env("NOTAGEN_REPO_PATH")
    if not repo_path:
        raise ImportError(
            "Cannot import NotaGen utilities. "
            "Set NOTAGEN_REPO_PATH to the cloned NotaGen repository root "
            "(https://github.com/ElectricAlexis/NotaGen). "
            "The repository's 'gradio/' directory must contain utils.py and config.py."
        )

    if not os.path.isdir(repo_path):
        raise ImportError(
            f"NOTAGEN_REPO_PATH does not exist or is not a directory: {repo_path!r}"
        )

    # Try gradio/ first (most complete inference utilities), then inference/, then root.
    for subdir in ("gradio", "inference", ""):
        candidate = os.path.join(repo_path, subdir) if subdir else repo_path
        utils_py = os.path.join(candidate, "utils.py")
        if not os.path.isfile(utils_py):
            continue

        spec = importlib.util.spec_from_file_location("notagen_official_utils", utils_py)
        if spec is None or spec.loader is None:
            continue

        module = importlib.util.module_from_spec(spec)
        sys.modules["notagen_official_utils"] = module
        # Add the candidate directory to sys.path so intra-package imports inside
        # utils.py (e.g. `import config`) resolve to the same directory.
        _path_inserted = candidate not in sys.path
        if _path_inserted:
            sys.path.insert(0, candidate)
        try:
            spec.loader.exec_module(module)  # type: ignore[union-attr]
        except Exception as exc:  # noqa: BLE001
            del sys.modules["notagen_official_utils"]
            if _path_inserted and candidate in sys.path:
                sys.path.remove(candidate)
            raise ImportError(
                f"Failed to exec NotaGen utils.py at {utils_py!r}: {exc}"
            ) from exc

        _notagen_utils = module
        return _notagen_utils

    raise ImportError(
        f"Could not find NotaGen utils.py under NOTAGEN_REPO_PATH={repo_path!r}. "
        "Expected to find utils.py in the 'gradio/' or 'inference/' subdirectory."
    )


# ─── AXIOM → NotaGen prompt conversion ───────────────────────────────────────

# Mapping from AXIOM instrumentation values → NotaGen fine-tuning labels.
# NotaGen's fine-tuning data uses the labels from its prompts.txt file.
_INSTRUMENTATION_MAP: dict[str, str] = {
    "string_trio": "String_Trio",
    "string_quartet": "String_Quartet",
    "string_quintet": "String_Quintet",
    "piano": "Keyboard",
    "keyboard": "Keyboard",
    "violin": "Violin",
    "cello": "Cello",
    "viola": "Viola",
    "flute": "Flute",
    "oboe": "Oboe",
    "clarinet": "Clarinet",
    "bassoon": "Bassoon",
    "horn": "Horn",
    "trumpet": "Trumpet",
    "piano_trio": "Piano_Trio",
    "piano_quartet": "Piano_Quartet",
    "piano_quintet": "Piano_Quintet",
    # Sorted-name compound keys for the "Instrument:role,..." control-line format.
    "cello_viola_violin": "String_Trio",
    "cello_viola_violin_violin": "String_Quartet",
    "cello_piano_violin": "Piano_Trio",
    "cello_piano_viola_violin": "Piano_Quartet",
    "cello_piano_viola_violin_violin": "Piano_Quintet",
}

# Mapping from AXIOM style/period hints → NotaGen period labels.
_PERIOD_MAP: dict[str, str] = {
    "baroque": "Baroque",
    "classical": "Classical",
    "romantic": "Romantic",
    "20th": "20th",
    "contemporary": "20th",
    "modern": "20th",
    "early": "Baroque",
    "pre-classical": "Baroque",
}


def _parse_axiom_control_lines(abc_header: str) -> dict[str, str]:
    """Extract key=value pairs from AXIOM's %% control header lines."""
    result: dict[str, str] = {}
    for line in abc_header.splitlines():
        line = line.strip()
        if line.startswith("%% ") or line.startswith("%%\t"):
            content = line[3:].strip()
            if "=" in content:
                key, _, val = content.partition("=")
                result[key.strip().lower()] = val.strip()
    return result


def _axiom_header_to_notagen_prompt(abc_header: str) -> str:
    """Convert an AXIOM conditioning ABC header to NotaGen's native prompt.

    NotaGen expects::

        %<Period>\\n%<Composer>\\n%<Instrumentation>\\n

    The conversion extracts control-line hints from the AXIOM header and maps
    them to the NotaGen training vocabulary.  Unrecognised values fall back to
    operator-configured defaults (``NOTAGEN_DEFAULT_PERIOD`` / ``NOTAGEN_DEFAULT_COMPOSER``).
    """
    ctrl = _parse_axiom_control_lines(abc_header)

    # ── Period ────────────────────────────────────────────────────────────────
    period_default = _env("NOTAGEN_DEFAULT_PERIOD", "Romantic")

    # Check explicit period= control line first
    period_raw = ctrl.get("period", "").lower()
    if not period_raw:
        # Fall back to style_cue for period hints
        style_cue = ctrl.get("style_cue", "").lower()
        for keyword, mapped_period in _PERIOD_MAP.items():
            if keyword in style_cue:
                period_raw = keyword
                break

    period = _PERIOD_MAP.get(period_raw, period_default)

    # ── Composer ──────────────────────────────────────────────────────────────
    composer_default = _env("NOTAGEN_DEFAULT_COMPOSER", "Beethoven, Ludwig van")
    composer = ctrl.get("composer", composer_default) or composer_default

    # ── Instrumentation ───────────────────────────────────────────────────────
    instrumentation_raw = ctrl.get("instrumentation", "string_trio").lower()
    # Try direct map lookup first (handles simple keys like "string_trio").
    instrumentation = _INSTRUMENTATION_MAP.get(instrumentation_raw)
    if instrumentation is None:
        # Strip ":role" suffixes from "Instrument:role,Instrument:role" format,
        # then try the sorted joined instrument names as a compound key.
        clean_parts = [
            p.strip().split(":")[0].strip().replace(" ", "_")
            for p in instrumentation_raw.split(",")
            if p.strip()
        ]
        sorted_key = "_".join(sorted(clean_parts))
        instrumentation = _INSTRUMENTATION_MAP.get(sorted_key)
    if instrumentation is None:
        # Fall back to the first instrument name alone (e.g. "violin" → "Violin").
        first_name = instrumentation_raw.split(",")[0].split(":")[0].strip().replace(" ", "_")
        instrumentation = _INSTRUMENTATION_MAP.get(first_name, "String_Trio")

    return f"%{period}\n%{composer}\n%{instrumentation}\n"


# ─── Helpers ported from NotaGen gradio/inference.py ─────────────────────────

def _complete_brackets(s: str) -> str:
    """Append any missing closing brackets to a string (mirrors NotaGen's utility)."""
    stack: list[str] = []
    bracket_map = {"{": "}", "[": "]", "(": ")"}
    for char in s:
        if char in bracket_map:
            stack.append(char)
        elif char in bracket_map.values():
            for key, value in bracket_map.items():
                if value == char:
                    if stack and stack[-1] == key:
                        stack.pop()
                    break
    return s + "".join(bracket_map[c] for c in reversed(stack))


def _rest_unreduce(abc_lines: list[str]) -> list[str]:
    """Expand reduced multi-voice ABC bars back to one line per voice.

    Direct port of ``rest_unreduce()`` from NotaGen's gradio/inference.py.
    The NotaGen model generates a compact interleaved format; this expands it
    back into standard per-voice notation.
    """
    import re as _re
    # Lazy import of abctoolkit — lives inside the NotaGen repo environment.
    try:
        from abctoolkit.duration import calculate_bartext_duration  # type: ignore[import]
        from abctoolkit.utils import Barline_regexPattern  # type: ignore[import]
    except ImportError:
        # abctoolkit not available — return lines unchanged; caller handles.
        return abc_lines

    tunebody_index: int | None = None
    for i, line in enumerate(abc_lines):
        if abc_lines[i].startswith("%%score"):
            abc_lines[i] = _complete_brackets(abc_lines[i])
        if "[V:" in line:
            tunebody_index = i
            break

    if tunebody_index is None:
        return abc_lines

    metadata_lines = abc_lines[:tunebody_index]
    tunebody_lines = abc_lines[tunebody_index:]

    part_symbol_list: list[str] = []
    voice_group_list: list[list[str]] = []
    existed_voices: list[str] = []
    for line in metadata_lines:
        if line.startswith("%%score"):
            for match in _re.findall(r"\((.*?)\)", line):
                voice_group_list.append(match.split())
            existed_voices = [item for sublist in voice_group_list for item in sublist]
        if line.startswith("V:"):
            symbol = line.split()[0]
            part_symbol_list.append(symbol)
            if symbol[2:] not in existed_voices:
                voice_group_list.append([symbol[2:]])

    z_symbol_list = ["V:" + g[0] for g in voice_group_list]
    x_symbol_list = [
        "V:" + voice
        for g in voice_group_list
        for voice in g[1:]
    ]
    part_symbol_list.sort(key=lambda x: int(x[2:]))

    unreduced_tunebody: list[str] = []
    ref_dur: Any = None

    for i, line in enumerate(tunebody_lines):
        line = _re.sub(r"^\[r:[^\]]*\]", "", line)
        matches = _re.findall(r"\[V:(\d+)\](.*?)(?=\[V:|$)", line)
        line_bar_dict: dict[str, str] = {f"V:{m[0]}": m[1] for m in matches}

        dur_dict: dict[Any, int] = {}
        for symbol, bartext in line_bar_dict.items():
            right_barline = "".join(_re.split(Barline_regexPattern, bartext)[-2:])
            bartext_trimmed = bartext[: -len(right_barline)]
            try:
                bar_dur = calculate_bartext_duration(bartext_trimmed)
            except Exception:
                bar_dur = None
            if bar_dur is not None:
                dur_dict[bar_dur] = dur_dict.get(bar_dur, 0) + 1

        if dur_dict:
            ref_dur = max(dur_dict, key=dur_dict.get)  # type: ignore[arg-type]

        if i == 0:
            prefix_left_barline = line.split("[V:")[0]
        else:
            prefix_left_barline = ""

        unreduced_line = ""
        for symbol in part_symbol_list:
            if symbol in line_bar_dict:
                symbol_bartext = line_bar_dict[symbol]
            else:
                rest = "z" if symbol in z_symbol_list else "x"
                symbol_bartext = prefix_left_barline + rest + str(ref_dur) + right_barline  # type: ignore[possibly-undefined]
            unreduced_line += "[" + symbol + "]" + symbol_bartext

        unreduced_tunebody.append(unreduced_line + "\n")

    return metadata_lines + unreduced_tunebody


# ─── Core generation loop ─────────────────────────────────────────────────────

_TIMEOUT_DEFAULT_MS = 600_000  # fallback for inner loop; parent kill fires first


def _run_generation_loop(
    model: Any,
    patchilizer: Any,
    prompt_lines: list[str],
    *,
    top_k: int,
    top_p: float,
    temperature: float,
    max_chars: int,
    timeout_ms: int,
) -> tuple[str, bool]:
    """Run NotaGen's patch-by-patch generation loop.

    Ported faithfully from ``inference_patch()`` in NotaGen's gradio/inference.py.

    Returns ``(abc_text, success_flag)``.  ``success_flag`` is False if the
    generation was aborted due to timeout or length overflow, or if the
    ``rest_unreduce`` post-processing step raised an exception.
    """
    import torch  # type: ignore[import]

    device = model.device

    patch_size: int = patchilizer.bos_token_id  # always 1 — but read from model config
    # NotaGen uses PATCH_SIZE=16 always; read it from the patchilizer indirectly
    # by checking the module-level PATCH_SIZE if available in the same namespace.
    try:
        import config as _notagen_config  # type: ignore[import]
        patch_size_val: int = _notagen_config.PATCH_SIZE
        patch_length_val: int = _notagen_config.PATCH_LENGTH
    except ImportError:
        patch_size_val = 16
        patch_length_val = 1024

    bos_patch = [patchilizer.bos_token_id] * (patch_size_val - 1) + [patchilizer.eos_token_id]

    prompt_patches = patchilizer.patchilize_metadata(prompt_lines)
    prompt_patches = [
        [ord(c) for c in p] + [patchilizer.special_token_id] * (patch_size_val - len(p))
        for p in prompt_patches
    ]
    prompt_patches.insert(0, bos_patch)
    input_patches = torch.tensor(prompt_patches, device=device).reshape(1, -1)

    byte_list: list[str] = list("".join(prompt_lines))
    context_tunebody_bytes: list[str] = []
    metadata_bytes: list[str] = []

    tunebody_flag = False
    end_flag = False
    failure_flag = False
    start_time = time.time()

    import contextlib

    with torch.inference_mode():
        while True:
            # torch.autocast only for CUDA; CPU/MPS use nullcontext.
            if device.type == "cuda":
                ctx = torch.autocast(device_type="cuda", dtype=torch.float16)
            else:
                ctx = contextlib.nullcontext()
            with ctx:
                predicted_patch: list[int] = model.generate(
                    input_patches.unsqueeze(0),
                    top_k=top_k,
                    top_p=top_p,
                    temperature=temperature,
                )

            # On first tunebody entry the patch must start with [r:0/
            if (
                not tunebody_flag
                and patchilizer.decode([predicted_patch]).startswith("[r:")
            ):
                tunebody_flag = True
                r0_tensor = torch.tensor(
                    [ord(c) for c in "[r:0/"], device=device
                ).unsqueeze(0)
                temp_input = torch.cat([input_patches, r0_tensor], axis=-1)
                if device.type == "cuda":
                    r0_ctx = torch.autocast(device_type="cuda", dtype=torch.float16)
                else:
                    r0_ctx = contextlib.nullcontext()
                with r0_ctx:
                    predicted_patch = model.generate(
                        temp_input.unsqueeze(0),
                        top_k=top_k,
                        top_p=top_p,
                        temperature=temperature,
                    )
                predicted_patch = [ord(c) for c in "[r:0/"] + predicted_patch

            # End of sequence: BOS followed immediately by EOS
            if (
                predicted_patch[0] == patchilizer.bos_token_id
                and predicted_patch[1] == patchilizer.eos_token_id
            ):
                end_flag = True
                break

            next_patch_text = patchilizer.decode([predicted_patch])
            for char in next_patch_text:
                byte_list.append(char)
                if tunebody_flag:
                    context_tunebody_bytes.append(char)
                else:
                    metadata_bytes.append(char)

            # Mask out bytes after the in-patch EOS
            patch_end = False
            for j in range(len(predicted_patch)):
                if patch_end:
                    predicted_patch[j] = patchilizer.special_token_id
                if predicted_patch[j] == patchilizer.eos_token_id:
                    patch_end = True

            predicted_tensor = torch.tensor([predicted_patch], device=device)
            input_patches = torch.cat([input_patches, predicted_tensor], dim=1)

            # Hard abort guards
            if len(byte_list) > max_chars:
                failure_flag = True
                break
            elapsed_ms = (time.time() - start_time) * 1000
            if elapsed_ms > timeout_ms:
                failure_flag = True
                break

            # Sliding-window context compression
            if input_patches.shape[1] >= patch_length_val * patch_size_val and not end_flag:
                context_tunebody = "".join(context_tunebody_bytes)
                if "\n" not in context_tunebody:
                    failure_flag = True
                    break

                metadata_text = "".join(metadata_bytes)
                tunebody_lines_list = context_tunebody.split("\n")
                if not context_tunebody.endswith("\n"):
                    formatted = (
                        [l + "\n" for l in tunebody_lines_list[:-1]]
                        + [tunebody_lines_list[-1]]
                    )
                else:
                    formatted = [l + "\n" for l in tunebody_lines_list]

                cut_index = max(1, len(formatted) // 2)
                abc_slice = metadata_text + "".join(formatted[-cut_index:])
                re_encoded = patchilizer.encode_generate(abc_slice)
                flat = [token for patch in re_encoded for token in patch]
                input_patches = torch.tensor([flat], device=device).reshape(1, -1)
                context_tunebody_bytes = list("".join(formatted[-cut_index:]))

    if failure_flag:
        return "", False

    abc_text = "".join(byte_list)

    # Post-process: expand reduced multi-voice bars
    raw_lines = abc_text.split("\n")
    raw_lines = [l for l in raw_lines if l]
    raw_lines = [l + "\n" for l in raw_lines]
    try:
        unreduced_lines = _rest_unreduce(raw_lines)
    except Exception:
        return "", False

    # Strip bare % metadata prefix lines (period/composer/instrumentation prompt)
    # and add mandatory X:1 header so the output is valid standalone ABC.
    cleaned = [
        line for line in unreduced_lines
        if not (line.startswith("%") and not line.startswith("%%"))
    ]
    # Drop any X:1 lines that the model may have emitted (we prepend one below).
    cleaned = [line for line in cleaned if not re.match(r"^X:\s*\d", line)]
    cleaned = ["X:1\n"] + cleaned
    return "".join(cleaned), True


def _inject_missing_abc_headers(abc_text: str, axiom_header: str) -> str:
    """Inject mandatory ABC header fields that the model may have skipped.

    NotaGen sometimes generates body content (V: / [V:] lines) immediately
    without emitting the standard ABC field headers (K:, M:, L:, T:).  This
    function extracts those fields from the AXIOM conditioning header and
    inserts any that are absent into the generated output, right after X:1.

    Only ``K:`` is strictly required for downstream validation; M:, L:, and T:
    are also injected when missing because they make the score more useful and
    prevent downstream warnings.
    """
    # Already has K: — nothing to do.
    if re.search(r"^K:", abc_text, re.MULTILINE):
        return abc_text

    # Extract header fields from the AXIOM conditioning text.
    def _extract(field: str) -> str | None:
        m = re.search(rf"^{field}:(.*)", axiom_header, re.MULTILINE)
        return m.group(1).strip() if m else None

    k_val = _extract("K") or "C"
    m_val = _extract("M") or "4/4"
    l_val = _extract("L") or "1/8"
    t_val = _extract("T")

    # Build the fields to inject (only those not already present).
    inject_lines: list[str] = []
    if t_val and not re.search(r"^T:", abc_text, re.MULTILINE):
        # Sanitise: take only the first line of T: (guard against multi-line titles).
        inject_lines.append(f"T:{t_val.splitlines()[0]}\n")
    if not re.search(r"^M:", abc_text, re.MULTILINE):
        inject_lines.append(f"M:{m_val}\n")
    if not re.search(r"^L:", abc_text, re.MULTILINE):
        inject_lines.append(f"L:{l_val}\n")
    inject_lines.append(f"K:{k_val}\n")

    # Insert the missing fields directly after the leading "X:1\n".
    prefix = "X:1\n"
    if abc_text.startswith(prefix):
        return prefix + "".join(inject_lines) + abc_text[len(prefix):]

    # Fallback: prepend before everything.
    return "".join(inject_lines) + abc_text


# ─── Public API ───────────────────────────────────────────────────────────────

def load_model(
    model_path: str,
    tokenizer_path: str,  # unused — Patchilizer requires no external file
    device_str: str,
) -> tuple[Any, Any]:
    """Load the NotaGen model and its Patchilizer.

    Parameters
    ----------
    model_path:
        Path to the NotaGen ``.pth`` weights file
        (e.g. ``weights_notagenx_p_size_16_p_length_1024_p_layers_20_h_size_1280.pth``).
    tokenizer_path:
        Ignored.  NotaGen uses a ``Patchilizer`` instance that requires no
        external vocabulary file.  The parameter is kept for API parity with
        the HuggingFace path.
    device_str:
        PyTorch device string: ``"cpu"``, ``"cuda"``, or ``"mps"``.

    Returns
    -------
    (model, patchilizer)
        ``model`` is a ``NotaGenLMHeadModel`` instance moved to *device* and
        put into eval mode.  ``patchilizer`` is a ``Patchilizer`` instance.

    Raises
    ------
    ImportError
        If the NotaGen repo utilities cannot be found.  Set ``NOTAGEN_REPO_PATH``
        to the cloned repository root to fix this.
    FileNotFoundError
        If ``model_path`` does not exist.
    RuntimeError
        If the checkpoint cannot be loaded (wrong architecture, corrupt file,
        etc.).
    """
    import torch  # type: ignore[import]
    from transformers import GPT2Config  # type: ignore[import]

    _nu = _load_notagen_utils()
    NotaGenLMHeadModel = _nu.NotaGenLMHeadModel  # type: ignore[attr-defined]
    Patchilizer = _nu.Patchilizer  # type: ignore[attr-defined]

    # Read model config from the .pth filename if possible, otherwise use defaults.
    # Filename convention: weights_*_p_size_<PS>_p_length_<PL>_p_layers_<PL>_c_layers_<CL>_h_size_<HS>_*.pth
    fname = os.path.basename(model_path)
    def _parse_int(pattern: str, default: int) -> int:
        m = re.search(pattern, fname)
        return int(m.group(1)) if m else default

    patch_size    = _parse_int(r"p_size_(\d+)", 16)
    patch_length  = _parse_int(r"p_length_(\d+)", 1024)
    patch_layers  = _parse_int(r"p_layers_(\d+)", 20)
    char_layers   = _parse_int(r"c_layers_(\d+)", 6)
    hidden_size   = _parse_int(r"h_size_(\d+)", 1280)

    patch_config = GPT2Config(
        num_hidden_layers=patch_layers,
        max_length=patch_length,
        max_position_embeddings=patch_length,
        n_embd=hidden_size,
        num_attention_heads=hidden_size // 64,
        vocab_size=1,
    )
    byte_config = GPT2Config(
        num_hidden_layers=char_layers,
        max_length=patch_size + 1,
        max_position_embeddings=patch_size + 1,
        hidden_size=hidden_size,
        num_attention_heads=hidden_size // 64,
        vocab_size=128,
    )

    device = torch.device(device_str)
    model = NotaGenLMHeadModel(encoder_config=patch_config, decoder_config=byte_config)
    # Use float16 on CUDA (native fp16 hardware), float32 on CPU (emulated fp16
    # is ~2–4× slower than native fp32 on x86 CPUs).
    model_dtype = torch.float16 if device.type == "cuda" else torch.float32
    model = model.to(dtype=model_dtype)
    model.to(device)
    # Multi-threaded inference on CPU — speeds up matrix multiplies significantly.
    if device.type == "cpu":
        import multiprocessing
        torch.set_num_threads(multiprocessing.cpu_count())

    if not os.path.isfile(model_path):
        raise FileNotFoundError(
            f"NotaGen weights file not found: {model_path!r}. "
            "Download from https://huggingface.co/ElectricAlexis/NotaGen"
        )

    checkpoint = torch.load(model_path, map_location=device)
    state_dict = checkpoint.get("model", checkpoint)
    model.load_state_dict(state_dict)
    model.eval()

    patchilizer = Patchilizer()
    return model, patchilizer


def generate(
    model: Any,
    patchilizer: Any,
    abc_header: str,
    *,
    seed: int = 0,
    temperature: float = 1.2,
    top_p: float = 0.9,
    top_k: int = 9,
    repetition_penalty: float = 1.0,  # unused — NotaGen does not apply rep. penalty
    max_tokens: int = 102_400,
) -> str:
    """Generate an ABC score using the native NotaGen generation loop.

    Parameters
    ----------
    model:
        Loaded ``NotaGenLMHeadModel`` instance (from :func:`load_model`).
    patchilizer:
        Loaded ``Patchilizer`` instance (from :func:`load_model`).
    abc_header:
        AXIOM conditioning header (``%% axiom_*`` control lines).  This is
        automatically converted to NotaGen's ``%Period\\n%Composer\\n%Instrumentation\\n``
        prompt format.  The raw AXIOM header is **not** passed to the model.
    seed:
        Random seed.  Sets ``torch.manual_seed`` before generation.
    temperature:
        Sampling temperature.  NotaGen's default is 1.2.
    top_p:
        Nucleus sampling probability.  NotaGen's default is 0.9.
    top_k:
        Top-k sampling.  NotaGen's default is 9.
    repetition_penalty:
        Accepted for API parity but ignored — NotaGen's native sampler does not
        implement repetition penalty.
    max_tokens:
        Soft cap on total emitted characters.  Generation is aborted if this
        limit is reached before an EOS patch.

    Returns
    -------
    str
        Full ABC score text (including ``X:1``, headers, and body), post-processed
        with ``rest_unreduce`` to expand the model's compact multi-voice format.

    Raises
    ------
    RuntimeError
        If generation fails (timeout, length overflow, post-processing error).
    """
    import torch  # type: ignore[import]

    torch.manual_seed(seed)
    if str(model.device).startswith("cuda"):
        torch.cuda.manual_seed_all(seed)

    # Convert AXIOM conditioning header → NotaGen native prompt
    notagen_prompt = _axiom_header_to_notagen_prompt(abc_header)
    prompt_lines = notagen_prompt.splitlines(keepends=True)

    timeout_ms = _env_int("NOTAGEN_TIMEOUT_MS", _TIMEOUT_DEFAULT_MS)

    abc_text, success = _run_generation_loop(
        model,
        patchilizer,
        prompt_lines,
        top_k=top_k,
        top_p=top_p,
        temperature=temperature,
        max_chars=max_tokens,
        timeout_ms=timeout_ms,
    )

    if not success:
        raise RuntimeError(
            "NotaGen native generation failed (timeout, length overflow, "
            "or rest_unreduce error).  "
            "Try increasing NOTAGEN_TIMEOUT_MS or reducing NOTAGEN_MAX_TOKENS."
        )

    # Guard: inject any mandatory ABC header fields that the model skipped.
    abc_text = _inject_missing_abc_headers(abc_text, abc_header)

    return abc_text
