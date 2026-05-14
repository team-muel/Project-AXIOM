"""NotaGen inference subprocess worker.

Persistent child process.  Reads one JSON request per line from stdin,
runs inference, writes one JSON response per line to stdout.

Protocol
--------
stdin  (parent → child):  {"abc_header": "...", "seed": 0, "temperature": 0.9, ...}
stdout (child → parent):  {"ok": true, "abc_text": "..."} | {"ok": false, "error": "..."}

The child loads the model ONCE on first request (lazy singleton via
``_ModelSingleton``).  Subsequent requests reuse the loaded model without
re-loading weights.

Invocation (from notagen_backend._InferenceSubprocessManager)
-------------------------------------------------------------
    python -c "import _notagen_inference_worker; _notagen_inference_worker.main()"

    - OR -

    The parent spawns the script directly via subprocess with cwd set to the
    workers/composer/ directory so that ``from learned_symbolic.notagen_backend``
    resolves correctly.

Do NOT import this module from notagen_backend — it is only meant to be run
as a subprocess entry point.
"""
from __future__ import annotations

import json
import os
import sys

# ─── Path setup ──────────────────────────────────────────────────────────────
# learned_symbolic/ lives in workers/composer/learned_symbolic/.
# The parent process sets cwd to workers/composer/ before spawning, so
# `from learned_symbolic.notagen_backend import ...` should resolve without
# any path manipulation.  However, when the script is executed directly (e.g.
# `python _notagen_inference_worker.py`), we need to add workers/composer/ to
# sys.path manually.
_this_file = os.path.abspath(__file__)
_learned_symbolic_dir = os.path.dirname(_this_file)   # …/learned_symbolic/
_workers_composer_dir = os.path.dirname(_learned_symbolic_dir)  # …/workers/composer/
if _workers_composer_dir not in sys.path:
    sys.path.insert(0, _workers_composer_dir)

# ─── Import inference internals ───────────────────────────────────────────────
# Import only the inline inference function, not NotagenBackend or any of the
# subprocess-management machinery, to avoid circular subprocess spawning.
from learned_symbolic.notagen_backend import _run_inference_inline  # type: ignore[import]  # noqa: E402


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _write(obj: dict) -> None:
    """Write one JSON response line to stdout and flush."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# ─── Main loop ───────────────────────────────────────────────────────────────

def main() -> None:
    """Read requests from stdin, run inference, write responses to stdout.

    Stdout is reserved strictly for JSON response lines.  Any progress output
    from the NotaGen generation loop is redirected to stderr so it does not
    corrupt the JSON protocol.
    """
    # Ensure stdout is line-buffered so the parent receives each response
    # immediately without waiting for a full buffer.
    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    except AttributeError:
        # reconfigure is Python 3.7+; fall back to unbuffered mode via PYTHONUNBUFFERED
        pass

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        try:
            req: dict = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            _write({"ok": False, "error": f"JSON decode error: {exc}"})
            continue

        abc_header: str = req.get("abc_header", "")
        if not abc_header:
            _write({"ok": False, "error": "Missing required field: abc_header"})
            continue

        try:
            abc_text = _run_inference_inline(
                abc_header,
                seed=int(req.get("seed", 0)),
                temperature=float(req.get("temperature", 0.9)),
                top_p=float(req.get("top_p", 0.95)),
                top_k=int(req.get("top_k", 50)),
                repetition_penalty=float(req.get("repetition_penalty", 1.1)),
                max_tokens=int(req.get("max_tokens", 2048)),
            )
            _write({"ok": True, "abc_text": abc_text})
        except Exception as exc:  # noqa: BLE001
            _write({"ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()
