# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""NotaGen-class symbolic backend stub.

When AXIOM_LEARNED_BACKEND=notagen and no model checkpoint is available,
raises NotImplementedError with a descriptive message.  The caller
(compose_learned_symbolic.py) falls back to MockBackend automatically.

Connection points for Phase 3+:
  1. build_abc_header()      — AXIOM Plan → ABC conditioning header  [done]
  2. notagen_inference(...)  — ABC header → ABC score body           [TODO]
  3. abc_parser.validate_abc — validate / repair model output        [done]
  4. section_aligner.align   — map ABC bars to AXIOM section IDs    [done]
  5. abc_to_events.convert   — ABC bars → SectionMaterial events    [done]
"""

from typing import Any

from music21 import key as key_module

from .abc_conditioning import build_abc_header
from .abc_parser import validate_abc
from .abc_to_events import ABC_PIPELINE_AVAILABLE
from .prompt_packing import ProviderPromptPackingContext
from .symbolic_projection import SymbolicProjectionResult


class NotagenBackend:
    """NotaGen-class inference backend.

    Requires a model checkpoint reachable via AXIOM_NOTAGEN_CHECKPOINT_PATH
    (or equivalent runtime config).  Raises NotImplementedError when no
    checkpoint is connected so the caller can fall back to MockBackend.
    """

    def generate(
        self,
        payload: dict[str, Any],
        sections: list[dict[str, Any]],
        tonic_key: key_module.Key,
        attempt_index: int,
        context: ProviderPromptPackingContext | None,
        base_warnings: list[str] | None = None,
    ) -> SymbolicProjectionResult:
        if context is None:
            raise NotImplementedError(
                "notagen backend requires a valid ProviderPromptPackingContext; "
                "set AXIOM_LEARNED_BACKEND=mock to use the template fallback"
            )

        # Step 1 (Phase 2): Build deterministic ABC conditioning header.
        abc_header = build_abc_header(context)

        # TODO(Phase 3+): Call NotaGen model to generate ABC body conditioned
        # on abc_header, then pipe through the processing chain:
        #
        #   abc_body  = notagen_inference(abc_header, checkpoint=..., seed=attempt_index)
        #   abc_full  = abc_header + abc_body
        #   result    = abc_parser.validate_abc(abc_full, expected_total_measures=…)
        #   repaired  = result.repaired_abc
        #   mats, ws  = abc_to_events.convert(repaired, sections)
        #   … wrap mats into SymbolicProjectionResult …
        #
        # Infrastructure is already in place (abc_parser, section_aligner,
        # abc_to_events, ABC_PIPELINE_AVAILABLE={ABC_PIPELINE_AVAILABLE}).

        raise NotImplementedError(
            f"NotaGen checkpoint not connected "
            f"(ABC conditioning header ready: {len(abc_header)} chars, "
            f"{sum(1 for l in abc_header.splitlines() if l.startswith('%% axiom_section'))} section(s)). "
            "Set AXIOM_LEARNED_BACKEND=mock to use the template fallback, "
            "or set AXIOM_NOTAGEN_CHECKPOINT_PATH to connect the model."
        )
