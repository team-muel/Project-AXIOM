"""Shared type definitions and warning codes for the ABC validation/repair/projection pipeline.

Used by abc_validate, abc_repair, abc_to_midi, and abc_project to pass results
between pipeline stages without circular dependencies.
"""

from __future__ import annotations

from typing import Any, NamedTuple, TypedDict

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

# ─── Piano-specific warning codes ────────────────────────────────────────────

# Emitted when a chord's simultaneous pitch span within one hand exceeds
# PIANO_MAX_HAND_SPAN semitones and no explicit arpeggiation marker is present.
WARN_PIANO_SPAN_EXCEEDED = "piano_span_exceeded"

# Emitted when the left-hand top note is higher than the right-hand bottom
# note on the same beat (hand crossing).
WARN_PIANO_HAND_COLLISION = "piano_hand_collision"

# Emitted when more than PIANO_MAX_CHORD_VOICES simultaneous voices appear
# within a single hand — typically unplayable without reduction.
WARN_PIANO_CHORD_TOO_DENSE = "piano_chord_too_dense"


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
    # Present only when lane == "solo_piano_symbolic"; mirrors PianoVoiceLayoutDict.
    voice_layout_summary: dict[str, Any] | None = None
    # Piano repair log: list of {"sectionId": str, "actions": [...]} dicts.
    # Empty when no repairs were applied or lane != "solo_piano_symbolic".
    repair_actions: list[dict[str, Any]] | None = None
    # True when write_midi_from_events() re-wrote the MIDI after repair.
    # Signals to TypeScript that the MIDI file reflects Python-side corrections.
    midi_rewritten: bool = False


# ─── Piano voice layout constants ────────────────────────────────────────────

# Idiomatic MIDI pitch ranges for each hand.
# Right hand: C4 (60) – C8 (108); the practical ceiling is ~96 (C7).
PIANO_RIGHT_HAND_PITCH_MIN: int = 60   # C4
PIANO_RIGHT_HAND_PITCH_MAX: int = 108  # C8 (absolute ceiling)

# Left hand: C1 (24) – C5 (72); the practical floor is ~28 (E1).
PIANO_LEFT_HAND_PITCH_MIN: int = 24    # C1
PIANO_LEFT_HAND_PITCH_MAX: int = 72    # C5

# Simultaneous pitch span within one hand beyond which chords are generally
# unplayable without arpeggiation (minor 13th = 19 semitones).
PIANO_MAX_HAND_SPAN: int = 19

# Maximum simultaneous voice count within a single hand before the chord is
# flagged as too dense to perform comfortably.
PIANO_MAX_CHORD_VOICES: int = 6


class PianoHandSplit(NamedTuple):
    """Per-event hand assignment produced by the piano projection stage."""

    event_index: int        # zero-based index within the section's event list
    pitch: int              # MIDI note number
    hand: str               # "right" | "left" | "ambiguous"
    span_warning: bool      # True when the chord span in this hand exceeds PIANO_MAX_HAND_SPAN
    collision_warning: bool # True when this event participates in a hand crossing


class PianoVoiceLayoutDict(TypedDict, total=False):
    """Python mirror of the TypeScript PianoVoiceLayoutSummary interface.

    Populated by piano_projection.compute_piano_voice_layout_summary() and
    embedded in the section artifact dict under the key 'pianoVoiceLayout'.
    """

    rightHandPitchMin: int
    rightHandPitchMax: int
    leftHandPitchMin: int
    leftHandPitchMax: int
    maxRightHandSpan: int
    maxLeftHandSpan: int
    handCrossingCount: int
    handCollisionCount: int
    avgChordVoiceCount: float
    pedalEventCount: int
    # Fraction of chord events whose simultaneous span fits within one hand.
    playableSpanFit: float
    # Composite playability score [0, 1]: playableSpanFit minus collision penalty.
    # Mirrors pianoPlayabilityScore used by the TypeScript evaluation gate.
    pianoPlayabilityScore: float
    notes: list[str]
