"""ABC section aligner for AXIOM learned symbolic pipeline.

Maps bars in a parsed ABC score to AXIOM section IDs purely by cumulative
measure count from the CompositionPlan.  No %% axiom_section markers in the
ABC output are required; alignment is positional.
"""

from typing import Any


class SectionBarRange:
    """Half-open bar range [start_bar, end_bar) for one AXIOM section."""

    __slots__ = ("section_id", "role", "start_bar", "end_bar")

    def __init__(
        self, section_id: str, role: str, start_bar: int, end_bar: int
    ) -> None:
        self.section_id = section_id
        self.role = role
        self.start_bar = start_bar  # inclusive, 0-indexed
        self.end_bar = end_bar  # exclusive


def build_section_bar_ranges(sections: list[dict[str, Any]]) -> list[SectionBarRange]:
    """Build contiguous bar ranges from a list of AXIOM section descriptors.

    Each section contributes exactly section["measures"] bars (default 4).
    Sections are ordered as supplied and start from bar 0.
    """
    ranges: list[SectionBarRange] = []
    cursor = 0
    for index, section in enumerate(sections):
        section_id = str(section.get("id") or f"section-{index + 1}").strip()
        role = str(section.get("role") or "theme_a").strip()
        raw = section.get("measures")
        measure_count = (
            int(round(float(raw))) if isinstance(raw, (int, float)) and raw > 0 else 4
        )
        ranges.append(
            SectionBarRange(
                section_id=section_id,
                role=role,
                start_bar=cursor,
                end_bar=cursor + measure_count,
            )
        )
        cursor += measure_count
    return ranges


def resolve_section_id_for_bar(
    ranges: list[SectionBarRange], bar_index: int
) -> str | None:
    """Return the AXIOM section ID for a given 0-indexed bar number."""
    for r in ranges:
        if r.start_bar <= bar_index < r.end_bar:
            return r.section_id
    return None


def total_expected_measures(sections: list[dict[str, Any]]) -> int:
    """Sum of all section measure counts (default 4 per section)."""
    total = 0
    for section in sections:
        raw = section.get("measures")
        total += (
            int(round(float(raw))) if isinstance(raw, (int, float)) and raw > 0 else 4
        )
    return total
