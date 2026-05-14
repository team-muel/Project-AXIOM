"""NotaGen localized section rewrite helpers.

Provides:
  - build_rewrite_prompt_block()  — builds the <AXIOM_REWRITE> prompt block
  - assemble_rewritten_abc()      — merges kept section artifacts + rewritten ABC
  - DIRECTIVE_KIND_TO_REWRITE_TARGETS — directive → human-readable targets mapping

Used by notagen_backend.py when localizedRewriteSpec is present in providerRequest.
"""

from __future__ import annotations

from typing import Any


# ─── Directive kind → rewrite target descriptions ────────────────────────────

DIRECTIVE_KIND_TO_REWRITE_TARGETS: dict[str, list[str]] = {
    "strengthen_cadence": [
        "strengthen contrary motion",
        "prepare dominant before recap",
        "clarify cadential arrival",
    ],
    "stabilize_harmony": [
        "increase harmonic stability",
        "reinforce tonal center",
        "smooth harmonic route",
    ],
    "clarify_texture_plan": [
        "clarify voice independence",
        "improve counterline contrast",
        "balance texture layers",
    ],
    "clarify_phrase_rhetoric": [
        "clarify phrase contour",
        "add breath points",
        "sharpen rhetoric at phrase boundaries",
    ],
    "clarify_harmonic_color": [
        "enrich local harmonic color",
        "introduce chromatic inflection",
        "vary chord qualities",
    ],
    "reduce_large_leaps": [
        "reduce melodic leaps",
        "smooth melodic contour",
        "improve voice leading",
    ],
    "increase_rhythm_variety": [
        "diversify rhythm cells",
        "introduce contrasting note values",
        "vary rhythmic texture",
    ],
}


def build_rewrite_prompt_block(
    rewrite_section_ids: list[str],
    keep_section_ids: list[str],
    reason: str,
    directives: list[dict[str, Any]] | None = None,
) -> str:
    """Build an ``<AXIOM_REWRITE>`` block for the NotaGen prompt.

    Args:
        rewrite_section_ids: Section IDs to regenerate.
        keep_section_ids:    Section IDs to preserve byte/event-stable.
        reason:              Human-readable reason for the rewrite.
        directives:          Optional list of directive hint dicts (kind, reason).

    Returns:
        A multi-line ``<AXIOM_REWRITE>...</AXIOM_REWRITE>`` string.
    """
    targets: list[str] = []
    seen: set[str] = set()

    for hint in (directives or []):
        kind = str(hint.get("kind") or "")
        mapped = DIRECTIVE_KIND_TO_REWRITE_TARGETS.get(kind)
        if mapped:
            for target in mapped:
                if target not in seen:
                    targets.append(target)
                    seen.add(target)
        else:
            raw_reason = str(hint.get("reason") or kind).strip()
            if raw_reason and raw_reason not in seen:
                targets.append(raw_reason)
                seen.add(raw_reason)

    # Always include measure-count preservation
    preserve_target = "preserve meter and measure count"
    if preserve_target not in seen:
        targets.append(preserve_target)

    lines: list[str] = ["<AXIOM_REWRITE>", "mode=localized_section_rewrite"]
    if keep_section_ids:
        lines.append(f"keep_sections={','.join(keep_section_ids)}")
    lines.append(f"rewrite_sections={','.join(rewrite_section_ids)}")
    lines.append(f'reason="{reason.replace(chr(34), chr(39))}"')
    lines.append("target:")
    for target in targets:
        lines.append(f"- {target}")
    lines.append("</AXIOM_REWRITE>")

    return "\n".join(lines)


def assemble_rewritten_abc(
    keep_section_artifacts: list[dict[str, Any]],
    rewritten_proposal_sections: list[dict[str, Any]],
    all_section_ids_in_order: list[str],
    rewrite_section_ids: list[str],
) -> list[dict[str, Any]]:
    """Merge kept section artifacts with rewritten section artifacts.

    The returned list is ordered according to ``all_section_ids_in_order``.
    Kept sections preserve their original events (event-stable).
    Rewritten sections come from ``rewritten_proposal_sections``.

    Args:
        keep_section_artifacts:    Proposal section dicts from the parent candidate.
        rewritten_proposal_sections: Freshly projected sections from the rewrite run.
        all_section_ids_in_order:  Full ordered section ID list from the plan.
        rewrite_section_ids:       Section IDs that were rewritten.

    Returns:
        Merged list of proposal section dicts in plan order.
        Sections that appear in neither source are omitted (they will be missing
        from the result; the caller should add a warning).
    """
    kept_by_id: dict[str, dict[str, Any]] = {
        str(s.get("sectionId") or ""): s for s in keep_section_artifacts
    }
    rewritten_by_id: dict[str, dict[str, Any]] = {
        str(s.get("sectionId") or ""): s for s in rewritten_proposal_sections
    }

    rewrite_set = set(rewrite_section_ids)
    merged: list[dict[str, Any]] = []

    for section_id in all_section_ids_in_order:
        if section_id in rewrite_set:
            artifact = rewritten_by_id.get(section_id)
        else:
            artifact = kept_by_id.get(section_id)

        if artifact is not None:
            merged.append(artifact)

    return merged
