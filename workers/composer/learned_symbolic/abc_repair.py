"""ABC repair module for the AXIOM learned symbolic pipeline.

Applies minimal structural repairs to ABC notation so downstream
abc_to_events.convert() (music21) can run safely.

Repair policy:
  - Only syntax/contract repairs — no musical recomposition.
  - Repairs are applied in this order:
      1. Header fields (delegated to abc_parser._repair_missing_headers)
      2. Missing final barline added if absent
      3. Empty measure (consecutive barlines) replaced with whole-bar rest
      4. Too-long voices truncated to expected_total_bars
      5. Too-short voices padded with whole-bar rests (Z)

Returns AbcRepairResult. ok=False only when the ABC is fundamentally
non-repairable (e.g. not parseable as text at all).
"""

from __future__ import annotations

import re

from .abc_types import (
    WARN_ABC_REPAIRED,
    WARN_TRUNCATED_EXTRA_BARS,
    WARN_VOICE_PADDING_INSERTED,
    AbcRepairResult,
    AbcValidationReport,
)

# ─── Barline patterns ─────────────────────────────────────────────────────────

_BARLINE_RE = re.compile(
    r":\|:|:\|(?!:)|\|\||\|[\]:]|\|(?![|\]:])"
)
# Matches final barlines: |] or nothing meaningful — we need to check the last barline
_FINAL_BARLINE_RE = re.compile(r"\|[\]|]?\s*$")
# Empty measure: two consecutive barlines with only whitespace between
_EMPTY_MEASURE_RE = re.compile(r"(\|+[\]:]?)\s*(\|)")


# ─── Voice splitting / reassembly ────────────────────────────────────────────

def _split_abc_structure(
    abc_text: str,
) -> tuple[list[str], list[tuple[str, list[str]]]]:
    """Split ABC into (header_lines, [(voice_decl_line, body_lines), ...]).

    A voice section starts at a V: declaration line.  All subsequent lines
    until the next V: (or end of text) belong to that voice's body.
    Multiple occurrences of the same V:n are kept as separate segments so
    that the interleaved format is preserved during reconstruction.
    """
    header_lines: list[str] = []
    voice_segments: list[tuple[str, list[str]]] = []  # (decl_line, body_lines)
    current_decl: str | None = None
    current_body: list[str] = []

    for line in abc_text.splitlines():
        if re.match(r"^V:", line):
            if current_decl is not None:
                voice_segments.append((current_decl, current_body))
            current_decl = line
            current_body = []
        elif current_decl is None:
            header_lines.append(line)
        else:
            current_body.append(line)

    if current_decl is not None:
        voice_segments.append((current_decl, current_body))

    return header_lines, voice_segments


def _reassemble_abc(
    header_lines: list[str],
    voice_segments: list[tuple[str, list[str]]],
) -> str:
    """Reassemble the ABC text from header and voice segments."""
    parts: list[str] = ["\n".join(header_lines)]
    for decl, body in voice_segments:
        parts.append(decl)
        if body:
            parts.append("\n".join(body))
    return "\n".join(p for p in parts if p)


# ─── Per-voice bar helpers ────────────────────────────────────────────────────

def _count_bars_in_segment_bodies(segments: list[tuple[str, list[str]]], voice_id: str) -> int:
    """Count total barlines across all segments belonging to voice_id."""
    total = 0
    for decl, body_lines in segments:
        if re.match(rf"^V:{re.escape(voice_id)}(?:\s|$)", decl):
            total += len(_BARLINE_RE.findall("\n".join(body_lines)))
    return total


def _get_distinct_voice_ids(segments: list[tuple[str, list[str]]]) -> list[str]:
    """Return ordered list of unique voice IDs from V: declarations."""
    seen: dict[str, None] = {}
    for decl, _ in segments:
        m = re.match(r"^V:(\S+)", decl)
        if m:
            seen[m.group(1)] = None
    return list(seen)


def _find_bar_positions(body: str) -> list[int]:
    """Return end-positions (exclusive) of each barline match in body."""
    return [m.end() for m in _BARLINE_RE.finditer(body)]


def _truncate_body_to_bars(body: str, n: int) -> str:
    """Return body text keeping only the first n bars."""
    positions = _find_bar_positions(body)
    if len(positions) <= n:
        return body
    return body[: positions[n - 1]]


def _pad_body_with_rests(body: str, n_extra: int) -> str:
    """Append n_extra whole-bar rest measures to body."""
    if n_extra <= 0:
        return body
    padding = " Z |" * n_extra
    return body.rstrip() + padding


# ─── Individual repair steps ─────────────────────────────────────────────────

def _repair_headers(abc_text: str) -> tuple[str, list[str]]:
    """Delegate minimal header repair to abc_parser."""
    from .abc_parser import _repair_missing_headers  # type: ignore[attr-defined]
    return _repair_missing_headers(abc_text)


def _repair_final_barline(abc_text: str) -> tuple[str, bool]:
    """Ensure the last voice body ends with a barline."""
    stripped = abc_text.rstrip()
    if not stripped:
        return abc_text, False
    last_char = stripped[-1]
    if last_char not in ("|", "]", ":"):
        return stripped + " |]", True
    return abc_text, False


def _repair_empty_measures(abc_text: str) -> tuple[str, bool]:
    """Replace empty measures (consecutive barlines) with whole-bar rest (Z)."""
    repaired, count = _EMPTY_MEASURE_RE.subn(r"\1 Z \2", abc_text)
    return repaired, count > 0


def _repair_voice_lengths(
    header_lines: list[str],
    voice_segments: list[tuple[str, list[str]]],
    expected_total_bars: int,
) -> tuple[list[tuple[str, list[str]]], list[str]]:
    """Truncate over-long voices and pad short voices to expected_total_bars.

    Returns (updated_segments, warning_codes).
    """
    repairs: list[str] = []
    voice_ids = _get_distinct_voice_ids(voice_segments)
    if not voice_ids:
        return voice_segments, repairs

    # Compute bar count per voice across all its segments
    voice_bar_counts: dict[str, int] = {
        vid: _count_bars_in_segment_bodies(voice_segments, vid)
        for vid in voice_ids
    }
    max_bars = max(voice_bar_counts.values(), default=0)

    # Use expected_total_bars as the target; fall back to max observed
    target_bars = expected_total_bars if expected_total_bars > 0 else max_bars
    if target_bars == 0:
        return voice_segments, repairs

    updated: list[tuple[str, list[str]]] = []

    for decl, body_lines in voice_segments:
        m = re.match(r"^V:(\S+)", decl)
        if m is None:
            updated.append((decl, body_lines))
            continue
        vid = m.group(1)
        body = "\n".join(body_lines)
        bars = _count_bars_in_segment_bodies(voice_segments, vid)

        if bars > target_bars:
            # Truncate: only applied to the LAST segment of this voice so earlier
            # segments preserve their interleaved partner lines.
            if voice_segments[-1][0] == decl or voice_segments.index((decl, body_lines)) == len(voice_segments) - 1:
                truncated = _truncate_body_to_bars(body, target_bars)
                updated.append((decl, truncated.splitlines()))
                if WARN_TRUNCATED_EXTRA_BARS not in repairs:
                    repairs.append(WARN_TRUNCATED_EXTRA_BARS)
            else:
                updated.append((decl, body_lines))
        elif bars < target_bars:
            n_pad = target_bars - bars
            padded = _pad_body_with_rests(body, n_pad)
            updated.append((decl, padded.splitlines()))
            if WARN_VOICE_PADDING_INSERTED not in repairs:
                repairs.append(WARN_VOICE_PADDING_INSERTED)
        else:
            updated.append((decl, body_lines))

    return updated, repairs


# ─── Main repair entry point ──────────────────────────────────────────────────

def repair_abc(
    abc_text: str,
    validation_report: AbcValidationReport | None = None,
    expected_total_bars: int = 0,
    meter_str: str = "4/4",
) -> AbcRepairResult:
    """Apply minimal structural repairs to ABC text.

    Args:
        abc_text:             Raw (possibly defective) ABC text.
        validation_report:    If already computed, passed to skip re-analysis.
                              When None a lightweight internal check is done.
        expected_total_bars:  Target total bars per voice. 0 = no length repair.
        meter_str:            Active meter, e.g. "4/4".

    Returns:
        AbcRepairResult. ok=True unless the input is completely unparseable.
    """
    if not abc_text or not abc_text.strip():
        return AbcRepairResult(
            ok=False,
            repaired_abc="",
            repairs_applied=[],
            error="ABC text is empty — cannot repair",
        )

    repairs: list[str] = []
    working = abc_text

    # ── Step 1: Repair missing headers ──────────────────────────────────────
    try:
        working, header_repairs = _repair_headers(working)
        if header_repairs:
            repairs.append(WARN_ABC_REPAIRED)
    except Exception:
        pass  # abc_parser unavailable — skip header repair

    # ── Step 2: Repair missing final barline ────────────────────────────────
    working, added_barline = _repair_final_barline(working)
    if added_barline:
        if WARN_ABC_REPAIRED not in repairs:
            repairs.append(WARN_ABC_REPAIRED)

    # ── Step 3: Replace empty measures ──────────────────────────────────────
    working, had_empty = _repair_empty_measures(working)
    if had_empty:
        if WARN_ABC_REPAIRED not in repairs:
            repairs.append(WARN_ABC_REPAIRED)

    # ── Step 4: Repair voice lengths (truncate / pad) ────────────────────────
    if expected_total_bars > 0:
        header_lines, segments = _split_abc_structure(working)
        if segments:
            updated_segments, length_repairs = _repair_voice_lengths(
                header_lines, segments, expected_total_bars
            )
            repairs.extend(length_repairs)
            working = _reassemble_abc(header_lines, updated_segments)

    return AbcRepairResult(
        ok=True,
        repaired_abc=working,
        repairs_applied=repairs,
        error=None,
    )
