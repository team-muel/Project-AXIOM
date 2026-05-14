"""Shared type definitions and warning codes for the ABC validation/repair/projection pipeline.

Used by abc_validate, abc_repair, abc_to_midi, and abc_project to pass results
between pipeline stages without circular dependencies.
"""

from __future__ import annotations

from typing import Any, NamedTuple

# ─── Normalization warning codes ─────────────────────────────────────────────
# These codes are appended to proposalMetadata.normalizationWarnings.

WARN_ABC_REPAIRED = "abc_repaired"
WARN_SECTION_COUNT_MISMATCH_REPAIRED = "section_count_mismatch_repaired"
WARN_VOICE_PADDING_INSERTED = "voice_padding_inserted"
WARN_TRUNCATED_EXTRA_BARS = "truncated_extra_bars"
WARN_INFERRED_TONAL_CENTER = "inferred_tonal_center"
WARN_INSTRUMENTATION_ROLE_PROJECTION_APPROXIMATE = (
    "instrumentation_role_projection_approximate"
)
WARN_BAR_DURATION_MISMATCH = "bar_duration_mismatch"
WARN_VOICE_SYNC_MISMATCH = "voice_sync_mismatch"


class AbcVoiceStats(NamedTuple):
    """Per-voice statistics produced during validation."""

    voice_id: str       # V: label, e.g. "1", "2", "3"
    bar_count: int      # number of measure boundaries detected
    is_empty: bool      # True if no notes or rests found in this voice


class AbcValidationReport(NamedTuple):
    """Result of abc_validate.validate_abc_structure()."""

    is_valid: bool          # required headers present; structurally usable
    has_fatal_error: bool   # True = not repairable; return ok=False immediately
    voice_stats: list[AbcVoiceStats]
    total_bar_count: int    # bar count from voice[0], or max across voices
    expected_bars: int | None  # total bars computed from plan sections
    errors: list[str]       # hard problems that block projection
    warnings: list[str]     # soft problems that trigger repair or warnings


class AbcRepairResult(NamedTuple):
    """Result of abc_repair.repair_abc()."""

    ok: bool                        # True = usable (repaired or no repair needed)
    repaired_abc: str               # potentially modified ABC text
    repairs_applied: list[str]      # WARN_* codes for repairs that were applied
    error: str | None               # non-None when repair was impossible


class AbcProjectionResult(NamedTuple):
    """Result of abc_project.run_abc_projection_pipeline()."""

    ok: bool
    proposal_sections: list[dict[str, Any]]  # list of SectionMaterial dicts
    midi_path: str | None                    # written path, or None if no output_path
    normalization_warnings: list[str]
    error: str | None                        # non-None when ok=False
