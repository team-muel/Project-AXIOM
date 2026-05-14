"""AXIOM → NotaGen deterministic ABC control prompt builder.

Converts a LearnedNotagenProviderRequest dict (providerRequest) into the
full input string that is fed to a NotaGen-class model.

Design contract:
- Output is fully deterministic: the same providerRequest always produces the
  same string.
- Section order is preserved exactly as it appears in controlLines.
- Required control fields are enforced with ValueError; optional fields are
  silently omitted when absent.
- softConstraintLines (advisory) are appended after the main control block if
  present.  metadataLines are NOT included in the output string.

Format of the output string::

    <conditioningText>

    %%axiom_control_begin
    <controlLine>
    ...
    %%axiom_control_end

"""

from __future__ import annotations

import sys
import json
from typing import Any

# ---------------------------------------------------------------------------
# Required top-level control-line prefixes that MUST be present in
# controlLines for a valid ABC generation request.
# ---------------------------------------------------------------------------
_REQUIRED_PREFIXES: list[str] = [
    "lane=",
    "plan_signature=",
    "prompt_pack_version=",
    "abc_format=",
    "form=",
    "key=",
    "meter=",
    "tempo=",
    "instrumentation=",
]


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _find_control_value(control_lines: list[str], prefix: str) -> str | None:
    for line in control_lines:
        if line.startswith(prefix):
            value = line[len(prefix) :].strip()
            return value or None
    return None


def _validate_provider_request(
    provider_request: dict[str, Any],
) -> tuple[str, list[str]]:
    """Validate and extract core fields from a providerRequest dict.

    Returns (conditioningText, controlLines).
    Raises ValueError for any missing required field.
    """
    conditioning_text = _normalize(provider_request.get("conditioningText"))
    if not conditioning_text:
        raise ValueError(
            "providerRequest.conditioningText is required and must be non-empty"
        )

    raw_control_lines = provider_request.get("controlLines")
    if not isinstance(raw_control_lines, list) or not raw_control_lines:
        raise ValueError(
            "providerRequest.controlLines must be a non-empty list of strings"
        )

    control_lines: list[str] = []
    for item in raw_control_lines:
        if not isinstance(item, str):
            raise ValueError("providerRequest.controlLines must contain only strings")
        normalized = _normalize(item)
        if not normalized:
            raise ValueError(
                "providerRequest.controlLines must not contain empty strings"
            )
        control_lines.append(normalized)

    # Enforce required fields
    for prefix in _REQUIRED_PREFIXES:
        if not any(line.startswith(prefix) for line in control_lines):
            raise ValueError(
                f"providerRequest.controlLines is missing required field: {prefix!r}"
            )

    # Enforce at least one section line
    section_count = sum(1 for line in control_lines if line.startswith("section "))
    if section_count == 0:
        raise ValueError(
            "providerRequest.controlLines must contain at least one 'section ' line"
        )

    return conditioning_text, control_lines


def build_notagen_input_string(provider_request: dict[str, Any]) -> str:
    """Build a deterministic NotaGen input string from a providerRequest dict.

    The string starts with the conditioningText (short ABC-oriented prompt),
    followed by a ``%%axiom_control_begin`` / ``%%axiom_control_end`` block
    containing the hard-constraint controlLines.  If ``softConstraintLines``
    are present in the request they are appended inside a separate
    ``%%axiom_soft_begin`` / ``%%axiom_soft_end`` block.

    When ``rewriteSpec`` is present in the request, an ``<AXIOM_REWRITE>``
    block is appended after the soft-constraint block.

    Args:
        provider_request: The raw providerRequest dict (as serialised by
            ``buildLearnedNotagenProviderRequest`` in TypeScript).

    Returns:
        A newline-terminated string ready to be passed to NotaGen.

    Raises:
        ValueError: If any required field is missing or malformed.
    """
    from .localized_rewrite import build_rewrite_prompt_block

    conditioning_text, control_lines = _validate_provider_request(provider_request)

    lines: list[str] = [conditioning_text, ""]

    lines.append("%%axiom_control_begin")
    for line in control_lines:
        lines.append(line)
    lines.append("%%axiom_control_end")

    # Include soft-constraint lines when present (advisory hints for the model)
    raw_soft = provider_request.get("softConstraintLines")
    if isinstance(raw_soft, list) and raw_soft:
        soft_lines = [
            _normalize(item)
            for item in raw_soft
            if isinstance(item, str) and _normalize(item)
        ]
        if soft_lines:
            lines.append("")
            lines.append("%%axiom_soft_begin")
            for line in soft_lines:
                lines.append(line)
            lines.append("%%axiom_soft_end")

    # Append <AXIOM_REWRITE> block when a localized rewrite spec is present
    rewrite_spec = provider_request.get("rewriteSpec")
    if isinstance(rewrite_spec, dict):
        rewrite_section_ids = list(rewrite_spec.get("rewriteSectionIds") or [])
        keep_section_ids = list(rewrite_spec.get("keepSectionIds") or [])
        reason = _normalize(rewrite_spec.get("reason"))
        directives = list(rewrite_spec.get("directives") or [])
        if rewrite_section_ids:
            rewrite_block = build_rewrite_prompt_block(
                rewrite_section_ids=rewrite_section_ids,
                keep_section_ids=keep_section_ids,
                reason=reason,
                directives=directives,
            )
            lines.append("")
            lines.append(rewrite_block)

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Script entry point — accepts a JSON providerRequest on stdin, writes the
# resulting prompt string to stdout.  Useful for testing and CLI integration.
# ---------------------------------------------------------------------------


def _main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        sys.stderr.write("abc_prompt: expected JSON providerRequest on stdin\n")
        sys.exit(1)
    try:
        provider_request = json.loads(raw)
        if not isinstance(provider_request, dict):
            raise ValueError("input must be a JSON object")
        result = build_notagen_input_string(provider_request)
        sys.stdout.write(result)
    except (ValueError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"abc_prompt error: {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    _main()
