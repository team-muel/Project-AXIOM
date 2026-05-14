# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""AXIOM Learned Symbolic Backend Protocol.

All concrete backends (MockBackend, NotagenBackend) must implement generate()
with this signature.  The protocol is checked structurally — no inheritance
required.
"""

from typing import Any, Protocol

from music21 import key as key_module

from .prompt_packing import ProviderPromptPackingContext
from .symbolic_projection import SymbolicProjectionResult


class SymbolicBackend(Protocol):
    """Proposal generation backend for the learned_symbolic worker slot."""

    def generate(
        self,
        payload: dict[str, Any],
        sections: list[dict[str, Any]],
        tonic_key: key_module.Key,
        attempt_index: int,
        context: ProviderPromptPackingContext | None,
        base_warnings: list[str] | None = None,
    ) -> SymbolicProjectionResult:
        """Generate section material for all sections in the composition plan.

        Args:
            payload:       Full worker payload (sectionArtifacts, revisionDirectives, …).
            sections:      Normalized section list (id, role, measures, harmonicPlan, …).
            tonic_key:     Resolved music21 Key for the piece.
            attempt_index: 1-based retry index used for cadential variation.
            context:       Validated provider packing context (conditioningText,
                           controlLines, warnings).  May be None when providerRequest
                           was absent or failed validation.
            base_warnings: Optional pre-existing warning list to merge into output.

        Returns:
            SymbolicProjectionResult with proposalSections, per-voice measure
            lists (violinMeasures / violaMeasures / celloMeasures), counts,
            and normalizationWarnings.
        """
        ...
