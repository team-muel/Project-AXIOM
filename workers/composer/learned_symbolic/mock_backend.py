# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""Mock symbolic backend.

Wraps the existing plan-conditioned template generator
(symbolic_projection.project_symbolic_sections).  This is the default
backend when LEARNED_SYMBOLIC_BACKEND is unset or set to "template".
Preserves all current behavior exactly.
"""

from typing import Any

from music21 import key as key_module

from .prompt_packing import ProviderPromptPackingContext
from .symbolic_projection import SymbolicProjectionResult, project_symbolic_sections


class MockBackend:
    """Plan-conditioned template backend — the current default behavior."""

    def generate(
        self,
        payload: dict[str, Any],
        sections: list[dict[str, Any]],
        tonic_key: key_module.Key,
        attempt_index: int,
        context: ProviderPromptPackingContext | None,
        base_warnings: list[str] | None = None,
    ) -> SymbolicProjectionResult:
        merged: list[str] = [
            *(context["warnings"] if context is not None else []),
            *(base_warnings or []),
        ]
        return project_symbolic_sections(
            payload,
            sections,
            tonic_key,
            attempt_index,
            base_warnings=merged if merged else None,
        )
