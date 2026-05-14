# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""Unified backend interface for the learned_symbolic worker.

LearnedSymbolicBackendResult — flat result dataclass returned by every backend.
LearnedSymbolicBackend       — Protocol all concrete backends must implement.
select_backend               — Factory: reads AXIOM_LEARNED_BACKEND env var and
                               returns the appropriate backend instance.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Protocol

from .prompt_packing import ProviderPromptPackingContext


@dataclass
class LearnedSymbolicBackendResult:
    """Flat result returned by every LearnedSymbolicBackend implementation."""

    ok: bool
    provider: str
    model: str
    generation_mode: str

    # Optional generation outputs
    confidence: float | None = None
    abc_text: str | None = None
    midi_path: str | None = None

    # Composition data
    proposal_sections: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    # Summary metadata (set by backend; used in response summary)
    note_count: int = 0
    measure_count: int = 0
    key_name: str = ""
    form: str = ""
    tempo_bpm: int = 0
    rewrite_applied: bool = False

    # Error payload — populated only when ok=False
    error: str | None = None


class LearnedSymbolicBackend(Protocol):
    """Protocol all concrete backends must satisfy."""

    def generate(
        self,
        payload: dict[str, Any],
        context: ProviderPromptPackingContext | None,
    ) -> LearnedSymbolicBackendResult:
        """Generate a composition proposal for the given payload.

        Args:
            payload: Full worker payload (outputPath, compositionPlan, sections,
                     stableSeed, revisionDirectives, sectionArtifacts, …).
            context: Validated ProviderPromptPackingContext built from
                     providerRequest.  May be None when providerRequest was
                     absent or failed validation.

        Returns:
            LearnedSymbolicBackendResult.  When ok=False the caller MUST NOT
            silently fall back to another backend; it should surface the error
            in the public response so TypeScript can apply its own fallback.
        """
        ...


def select_backend(payload: dict[str, Any]) -> LearnedSymbolicBackend:  # type: ignore[type-arg]
    """Return the appropriate backend for the current runtime configuration.

    Selection order (first match wins):
      1. AXIOM_LEARNED_BACKEND=notagen   → NotagenBackend
      2. AXIOM_LEARNED_BACKEND=template  |
         AXIOM_LEARNED_BACKEND=mock      |
         (unset / empty)                 → TemplateBackend

    NotaGen is NEVER auto-promoted unless explicitly requested.  When
    AXIOM_LEARNED_BACKEND=notagen and no checkpoint is available the
    NotagenBackend returns LearnedSymbolicBackendResult(ok=False, …) so the
    caller can surface an explicit error rather than silently fall back.
    """
    backend_name = os.environ.get("AXIOM_LEARNED_BACKEND", "template").strip().lower()
    if backend_name == "notagen":
        # Import is deferred so a missing optional dependency (e.g. transformers)
        # does not break the whole worker module on startup.
        from .notagen_backend import NotagenBackend  # noqa: PLC0415

        return NotagenBackend()

    from .template_backend import TemplateBackend  # noqa: PLC0415

    return TemplateBackend()
