# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""Unified backend interface for the learned_symbolic worker.

LearnedSymbolicBackendResult — flat result dataclass returned by every backend.
LearnedSymbolicBackend       — Protocol all concrete backends must implement.
select_backend               — Factory: reads NOTAGEN_BACKEND_MODE / AXIOM_LEARNED_BACKEND
                               env vars and returns the appropriate backend instance.
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


def _resolve_backend_name(payload: dict[str, Any]) -> str:
    """Resolve the active backend name from environment variables.

    Priority:
      1. NOTAGEN_BACKEND_MODE=mock|local  → "notagen"   (new Phase H env var)
      2. NOTAGEN_BACKEND_MODE=disabled    → "template"  (disabled; use music21 path)
      3. AXIOM_LEARNED_BACKEND=notagen    → "notagen"   (legacy env var)
      4. AXIOM_LEARNED_BACKEND=template   → "template"
      5. (unset)                          → "template"
    """
    notagen_mode = os.environ.get("NOTAGEN_BACKEND_MODE", "").strip().lower()
    if notagen_mode in ("mock", "local"):
        return "notagen"
    if notagen_mode == "disabled":
        return "template"

    # Fall back to legacy AXIOM_LEARNED_BACKEND
    legacy = os.environ.get("AXIOM_LEARNED_BACKEND", "template").strip().lower()
    return "notagen" if legacy == "notagen" else "template"


def select_backend(payload: dict[str, Any]) -> LearnedSymbolicBackend:  # type: ignore[type-arg]
    """Return the appropriate backend for the current runtime configuration.

    Selection is governed by NOTAGEN_BACKEND_MODE (Phase H) with fallback to
    the legacy AXIOM_LEARNED_BACKEND variable:

      NOTAGEN_BACKEND_MODE=mock   → NotagenBackend (deterministic mock ABC)
      NOTAGEN_BACKEND_MODE=local  → NotagenBackend (real model inference)
      NOTAGEN_BACKEND_MODE=disabled (default) → TemplateBackend (music21)
      AXIOM_LEARNED_BACKEND=notagen (legacy)  → NotagenBackend
      (unset / other)                         → TemplateBackend (music21)

    NotaGen is NEVER auto-promoted unless explicitly requested.  When the
    NotagenBackend cannot satisfy the request it returns
    LearnedSymbolicBackendResult(ok=False, …) so the caller can surface an
    explicit error rather than silently falling back.
    """
    backend_name = _resolve_backend_name(payload)
    if backend_name == "notagen":
        # Import deferred so a missing optional dependency (e.g. transformers)
        # does not break the whole worker module at startup.
        from .notagen_backend import NotagenBackend  # noqa: PLC0415

        return NotagenBackend()

    from .template_backend import TemplateBackend  # noqa: PLC0415

    return TemplateBackend()
