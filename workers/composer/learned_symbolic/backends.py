# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""Unified backend interface for the learned_symbolic worker.

LearnedSymbolicBackendResult — flat result dataclass returned by every backend.
LearnedSymbolicBackend       — Protocol all concrete backends must implement.
select_backend               — Factory: reads LEARNED_SYMBOLIC_BACKEND env var and
                               returns the appropriate backend instance.

Single-candidate contract
-------------------------
Every generate() call produces exactly one LearnedSymbolicBackendResult.
Backends MUST NOT iterate internally over a candidateCount.  Candidate pool
management is the sole responsibility of the TypeScript orchestrator; it
launches one worker subprocess per candidate slot and collects results.
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
    # Piano voice layout (solo_piano_symbolic lane only): mirrors PianoVoiceLayoutDict.
    # Present when run_abc_projection_pipeline() ran piano enrichment successfully.
    voice_layout_summary: dict[str, Any] | None = None
    # Piano repair log from piano_repair_solver.py.
    # List of {"sectionId": str, "actions": [{"kind": str, ...}]} dicts.
    repair_actions: list[dict[str, Any]] | None = None
    # True when write_midi_from_events() rewrote the MIDI file after Python-side repairs.
    # Signals to TypeScript that the rendered audio reflects idiom corrections.
    midi_rewritten: bool = False

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

    Governed by a single environment variable:

      LEARNED_SYMBOLIC_BACKEND=template      (default) → TemplateBackend (music21)
      LEARNED_SYMBOLIC_BACKEND=notagen_mock            → NotagenBackend (mock ABC)
      LEARNED_SYMBOLIC_BACKEND=notagen_local           → NotagenBackend (real inference)
      (unset / other)                                  → TemplateBackend (music21)

    NotaGen is NEVER auto-promoted unless explicitly requested.  When
    NotagenBackend cannot satisfy the request it returns
    LearnedSymbolicBackendResult(ok=False, …) so the caller can surface an
    explicit error rather than silently falling back.
    """
    raw = os.environ.get("LEARNED_SYMBOLIC_BACKEND", "template").strip().lower()
    if raw in ("notagen_mock", "notagen_local"):
        # Import deferred so a missing optional dependency (e.g. transformers)
        # does not break the whole worker module at startup.
        from .notagen_backend import NotagenBackend  # noqa: PLC0415

        return NotagenBackend()

    from .template_backend import TemplateBackend  # noqa: PLC0415

    return TemplateBackend()
