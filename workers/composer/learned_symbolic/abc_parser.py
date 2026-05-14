"""ABC notation validator and repairer for AXIOM learned symbolic pipeline.

Validates ABC text produced by a NotaGen-class model and applies minimal
repairs so downstream abc_to_events.convert() can run safely.
Does not perform full ABC grammar verification — only the structural checks
needed for AXIOM section projection.
"""

import re
from typing import NamedTuple

ABC_REQUIRED_HEADER_FIELDS = ("X:", "T:", "K:")
_ABC_VOICE_PREFIX = re.compile(r"^V:\s*(\d+)", re.MULTILINE)
_ABC_BAR_LINE = re.compile(r"\|")


class AbcValidationResult(NamedTuple):
    is_valid: bool
    repaired_abc: str
    warnings: list[str]


def _has_required_headers(abc_text: str) -> bool:
    return all(
        re.search(rf"^{re.escape(f)}", abc_text, re.MULTILINE)
        for f in ABC_REQUIRED_HEADER_FIELDS
    )


def _repair_missing_headers(abc_text: str) -> tuple[str, list[str]]:
    warnings: list[str] = []
    result = abc_text

    if not re.search(r"^X:", result, re.MULTILINE):
        result = "X:1\n" + result
        warnings.append("ABC missing X: field; inserted X:1")

    if not re.search(r"^T:", result, re.MULTILINE):
        result = re.sub(
            r"^(X:\d+\n)", r"\1T:Untitled\n", result, count=1, flags=re.MULTILINE
        )
        warnings.append("ABC missing T: field; inserted T:Untitled")

    if not re.search(r"^K:", result, re.MULTILINE):
        result = result.rstrip("\n") + "\nK:C\n"
        warnings.append("ABC missing K: field; appended K:C")

    return result, warnings


def _count_voice_ids(abc_text: str) -> int:
    return len({m.group(1) for m in _ABC_VOICE_PREFIX.finditer(abc_text)})


def validate_abc(
    abc_text: str,
    expected_voice_count: int = 3,
    expected_total_measures: int | None = None,
) -> AbcValidationResult:
    """Validate and minimally repair an ABC text string.

    Args:
        abc_text:               Raw ABC from model output.
        expected_voice_count:   Expected V: declarations (3 for string trio).
        expected_total_measures: If given, warn on significant measure divergence.

    Returns:
        AbcValidationResult(is_valid, repaired_abc, warnings).
        is_valid remains True as long as required header fields are present.
    """
    if not (abc_text and abc_text.strip()):
        return AbcValidationResult(False, abc_text or "", ["ABC text is empty"])

    repaired, repair_warnings = _repair_missing_headers(abc_text)
    warnings: list[str] = list(repair_warnings)

    observed = _count_voice_ids(repaired)
    if observed != expected_voice_count:
        warnings.append(
            f"ABC voice count mismatch: expected {expected_voice_count}, found {observed}"
        )

    if expected_total_measures is not None:
        bar_count = len(_ABC_BAR_LINE.findall(repaired))
        approx = max(1, bar_count // max(1, observed) // 2)
        tolerance = max(2, expected_total_measures // 4)
        if abs(approx - expected_total_measures) > tolerance:
            warnings.append(
                f"ABC measure count divergence: expected ~{expected_total_measures}, "
                f"estimated ~{approx}"
            )

    return AbcValidationResult(
        is_valid=_has_required_headers(repaired),
        repaired_abc=repaired,
        warnings=warnings,
    )
