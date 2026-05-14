"""Backward-compatibility shim.

The implementation has moved to ``notagen_engines.notagen_native``.
This module re-exports the public API for any code that still imports
from ``learned_symbolic.notagen_native_engine`` directly.

New code should import from ``notagen_engines.notagen_native`` instead:

    from learned_symbolic.notagen_engines.notagen_native import load_model, generate
"""
from __future__ import annotations

# Re-export the full public API from the new location.
from .notagen_engines.notagen_native import (  # noqa: F401
    generate,
    load_model,
)

__all__ = ["generate", "load_model"]
