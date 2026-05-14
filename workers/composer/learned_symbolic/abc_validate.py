"""Comprehensive ABC structure validation for the AXIOM learned symbolic pipeline.

Performs text-based checks (no external dependencies) on ABC notation output
from a NotaGen-class model. When music21 is available it augments with
precise bar-duration verification.

Checks performed (text-based, always):
  1. Required header fields (X:, T:, K:, M:)
  2. Expected voice count from V: declarations
  3. Total bar count vs expected_total_bars
  4. Per-voice bar count consistency
  5. Empty voice detection (no notes or rests)
  6. Too long / too short output detection
  7. Unsupported token detection (common ABC incompatibilities)

Phase C-2 checks (music21-based, require a parsed Score):
  8. validate_bar_durations(score, meter_str):
       For every part/measure, checks that the sum of note/rest durations
       equals the expected quarter-length from the meter (±0.25 QL).
       Catches incomplete bars, over-stuffed bars, and tuplet accounting errors.
  9. validate_voice_synchronization(score):
       Checks that all parts share the same measure count and that per-measure
       note/rest totals match across voices (±0.25 QL).

Hard failures (has_fatal_error=True):
  - Empty or whitespace-only ABC text
  - Missing K: header field (key is required for music21 parsing)
  - All voices empty

Soft warnings (has_fatal_error=False, but may trigger repair):
  - Missing X: or T: header (repairable)
  - Missing M: header (defaulted to 4/4)
  - Voice count mismatch
  - Bar count divergence (> 50% off)
  - Individual empty voice (others may still produce output)
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass  # music21 types are duck-typed; Any is used for score parameter

from .abc_types import AbcValidationReport, AbcVoiceStats

# ─── Constants ───────────────────────────────────────────────────────────────

_REQUIRED_FATAL: tuple[str, ...] = ("K:",)          # absence → fatal
_REQUIRED_REPAIRABLE: tuple[str, ...] = ("X:", "T:")  # absence → warning + repair
_BARLINE_RE = re.compile(
    r":\|:|:\|(?!:)|\|\||\|[\]:]|\|(?![|\]:])"
)
_NOTE_RE = re.compile(r"[A-Ga-g,']|[zZ]")           # note letter or rest token
_UNSUPPORTED_TOKEN_RE = re.compile(
    r"\\(?!\n)|&(?![a-z])|!!|I:|B:|F:|H:"            # common problematic tokens
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _find_header_field(abc_text: str, prefix: str) -> str | None:
    m = re.search(rf"^{re.escape(prefix)}(.*)", abc_text, re.MULTILINE)
    return m.group(1).strip() if m else None


def _count_bars_in_body(body: str) -> int:
    """Count measure boundaries in a voice body string."""
    return len(_BARLINE_RE.findall(body))


def _split_voice_bodies(abc_text: str) -> dict[str, list[str]]:
    """Return {voice_id: [body_lines]} from an ABC score.

    Handles both sequential and interleaved multi-voice layouts.
    Lines before the first V: declaration are considered header lines.
    """
    bodies: dict[str, list[str]] = {}
    current: str | None = None

    for line in abc_text.splitlines():
        m = re.match(r"^V:(\S+)", line)
        if m:
            current = m.group(1)
            if current not in bodies:
                bodies[current] = []
        elif current is not None:
            bodies[current].append(line)

    return bodies


def _is_voice_empty(lines: list[str]) -> bool:
    body = "\n".join(lines)
    return not bool(_NOTE_RE.search(body))


def _parse_meter_beats(meter_str: str) -> float:
    """Parse "4/4" → 4.0 quarter-note beats per bar."""
    m = re.match(r"(\d+)\s*/\s*(\d+)", meter_str.strip())
    if not m:
        return 4.0
    num, den = int(m.group(1)), int(m.group(2))
    return (num / den) * 4.0


# ─── Main validation function ─────────────────────────────────────────────────

def validate_abc_structure(
    abc_text: str,
    expected_voice_count: int = 3,
    expected_total_bars: int | None = None,
    meter_str: str = "4/4",
) -> AbcValidationReport:
    """Validate ABC text and return an AbcValidationReport.

    Args:
        abc_text:             Raw ABC text from model output.
        expected_voice_count: Number of V: voices expected (default 3 for string trio).
        expected_total_bars:  Total bar count expected across all sections.
        meter_str:            Meter string, e.g. "4/4" or "3/4".

    Returns:
        AbcValidationReport — never raises; errors/warnings are in the report.
    """
    errors: list[str] = []
    warnings: list[str] = []

    # ── Guard: empty input ────────────────────────────────────────────────────
    if not abc_text or not abc_text.strip():
        return AbcValidationReport(
            is_valid=False,
            has_fatal_error=True,
            voice_stats=[],
            total_bar_count=0,
            expected_bars=expected_total_bars,
            errors=["ABC text is empty or whitespace only"],
            warnings=[],
        )

    # ── Header field checks ───────────────────────────────────────────────────
    for field in _REQUIRED_FATAL:
        if not _find_header_field(abc_text, field):
            errors.append(f"Required ABC header field missing: {field}")

    for field in _REQUIRED_REPAIRABLE:
        if not _find_header_field(abc_text, field):
            warnings.append(f"ABC header field missing (repairable): {field}")

    if not _find_header_field(abc_text, "M:"):
        warnings.append("ABC M: (meter) field missing; will default to 4/4")

    # Prefer meter from text if available
    m_field = _find_header_field(abc_text, "M:")
    effective_meter = m_field or meter_str

    # ── Fatal check: exit early if unrepairable ───────────────────────────────
    if errors:
        return AbcValidationReport(
            is_valid=False,
            has_fatal_error=True,
            voice_stats=[],
            total_bar_count=0,
            expected_bars=expected_total_bars,
            errors=errors,
            warnings=warnings,
        )

    # ── Voice analysis ────────────────────────────────────────────────────────
    voice_bodies = _split_voice_bodies(abc_text)
    found_count = len(voice_bodies)

    if found_count == 0:
        # No V: declarations — treat entire body as one implied voice
        # (valid for monophonic ABC)
        if expected_voice_count > 1:
            warnings.append(
                f"No V: declarations found; expected {expected_voice_count} voices"
            )

    if found_count > 0 and found_count != expected_voice_count:
        warnings.append(
            f"Voice count mismatch: expected {expected_voice_count}, "
            f"found {found_count}"
        )

    # ── Per-voice statistics ──────────────────────────────────────────────────
    voice_stats: list[AbcVoiceStats] = []
    bar_counts: list[int] = []

    for voice_id, lines in voice_bodies.items():
        body = "\n".join(lines)
        bars = _count_bars_in_body(body)
        empty = _is_voice_empty(lines)
        if empty:
            warnings.append(f"Voice {voice_id} appears empty (no notes or rests)")
        voice_stats.append(AbcVoiceStats(voice_id=voice_id, bar_count=bars, is_empty=empty))
        bar_counts.append(bars)

    all_empty = bool(voice_stats) and all(vs.is_empty for vs in voice_stats)
    if all_empty:
        errors.append("All voices are empty — no musical content found")
        return AbcValidationReport(
            is_valid=False,
            has_fatal_error=True,
            voice_stats=voice_stats,
            total_bar_count=0,
            expected_bars=expected_total_bars,
            errors=errors,
            warnings=warnings,
        )

    total_bar_count = bar_counts[0] if bar_counts else 0

    # ── Bar count vs expected ─────────────────────────────────────────────────
    if expected_total_bars is not None and total_bar_count > 0:
        tolerance = max(1, expected_total_bars // 4)
        divergence = abs(total_bar_count - expected_total_bars)
        if divergence > tolerance:
            warnings.append(
                f"Bar count divergence: expected {expected_total_bars}, "
                f"found {total_bar_count} in voice 0"
            )

    # ── Per-voice bar count consistency ──────────────────────────────────────
    if len(bar_counts) > 1:
        max_bars = max(bar_counts)
        for vs in voice_stats:
            if vs.bar_count < max_bars and not vs.is_empty:
                warnings.append(
                    f"Voice {vs.voice_id} has {vs.bar_count} bars "
                    f"(max voice has {max_bars}); may need rest padding"
                )

    # ── Unsupported token check ───────────────────────────────────────────────
    bad = _UNSUPPORTED_TOKEN_RE.findall(abc_text)
    if bad:
        warnings.append(
            f"Potentially unsupported ABC tokens detected: {bad[:5]!r}"
        )

    return AbcValidationReport(
        is_valid=not errors,
        has_fatal_error=bool(errors),
        voice_stats=voice_stats,
        total_bar_count=total_bar_count,
        expected_bars=expected_total_bars,
        errors=errors,
        warnings=warnings,
    )


# ─── Phase C-2: music21-based duration validation ─────────────────────────────
# These functions accept a parsed music21 Score object and return lists of
# warning strings.  They must only be called when music21 is available.
# They never raise; all failures are returned as warning strings.

_BAR_DURATION_TOLERANCE = 0.25   # quarter lengths; catches off-by-one tuplet errors
_SYNC_DURATION_TOLERANCE = 0.25  # quarter lengths per measure across voices
_MAX_WARNINGS_PER_CHECK = 5      # cap per function to avoid flooding normalizationWarnings


def validate_bar_durations(score: "Any", meter_str: str) -> list[str]:
    """Check that every measure's note/rest total matches the meter's expected QL.

    Args:
        score:      A ``music21.stream.Score`` object already parsed from ABC.
        meter_str:  Meter string from the ABC header, e.g. ``"4/4"`` or ``"3/4"``.

    Returns:
        List of human-readable warning strings.  Empty list means all bars are
        within tolerance.

    Notes:
        - Pickup bars (anacrusis) may be flagged; they are intentionally short.
        - Tuplet durations are handled correctly by music21's ``quarterLength``.
        - ``notesAndRests`` iteration includes grace notes (which have QL≈0).
        - Chords count as a single duration element.
    """
    expected_ql = _parse_meter_beats(meter_str)
    found: list[str] = []
    try:
        for part_idx, part in enumerate(score.parts):
            for measure in part.getElementsByClass("Measure"):
                actual_ql = float(
                    sum(e.quarterLength for e in measure.notesAndRests)
                )
                if abs(actual_ql - expected_ql) > _BAR_DURATION_TOLERANCE:
                    found.append(
                        f"Part {part_idx + 1} m.{measure.number}: "
                        f"{actual_ql:.3f} QL != {expected_ql:.3f} QL "
                        f"(meter {meter_str})"
                    )
                    if len(found) >= _MAX_WARNINGS_PER_CHECK:
                        found.append("...(further bar-duration mismatches omitted)")
                        return found
    except Exception as exc:  # noqa: BLE001
        found.append(f"Bar-duration check failed: {exc}")
    return found


def validate_voice_synchronization(score: "Any") -> list[str]:
    """Check that all parts share the same measure count and per-measure duration.

    Args:
        score:  A ``music21.stream.Score`` object already parsed from ABC.

    Returns:
        List of human-readable warning strings.  Empty list means all voices
        are synchronized.

    Notes:
        - Compares only the minimum of available measure counts across parts to
          avoid secondary cascade warnings when one part is already short.
        - Per-measure comparison uses a tolerance of 0.25 QL so minor
          quantization differences don't produce spurious warnings.
    """
    found: list[str] = []
    try:
        parts = list(score.parts)
        if len(parts) < 2:
            return found

        part_measures = [list(p.getElementsByClass("Measure")) for p in parts]
        measure_counts = [len(ms) for ms in part_measures]

        if len(set(measure_counts)) > 1:
            found.append(
                f"Voice measure counts out of sync: {measure_counts} "
                f"(parts {list(range(1, len(parts) + 1))})"
            )

        min_measures = min(measure_counts)
        for m_idx in range(min_measures):
            durs = [
                float(sum(e.quarterLength for e in pms[m_idx].notesAndRests))
                for pms in part_measures
            ]
            if max(durs) - min(durs) > _SYNC_DURATION_TOLERANCE:
                found.append(
                    f"m.{m_idx + 1}: voice durations out of sync "
                    f"({[f'{d:.2f}' for d in durs]} QL)"
                )
                if len(found) >= _MAX_WARNINGS_PER_CHECK:
                    found.append("...(further voice-sync mismatches omitted)")
                    return found
    except Exception as exc:  # noqa: BLE001
        found.append(f"Voice-sync check failed: {exc}")
    return found
