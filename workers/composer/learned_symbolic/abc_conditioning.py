"""AXIOM → ABC conditioning header builder.

Converts a ProviderPromptPackingContext (conditioningText + controlLines)
into a deterministic ABC notation header suitable for NotaGen-class model
conditioning.  All section metadata is embedded as %% axiom_section comments.

No external inference is performed; output is fully deterministic.
"""

import re
from typing import Any

from .prompt_packing import ProviderPromptPackingContext

# Keys that can have single-word values (no spaces expected after =).
_SIMPLE_KEYS = (
    "id",
    "role",
    "measures",
    "energy",
    "density",
    "cadence",
    "harmonic_rhythm",
    "prolongation",
    "counterpoint",
)
# Keys that may have multi-word values terminated by the next "word=" or end-of-line.
_MULTIWORD_KEYS = ("tonal_center", "key_target", "label")


def _extract_section_attrs(line: str) -> dict[str, str]:
    """Extract key=value pairs from a single section control line."""
    attrs: dict[str, str] = {}
    for key in _SIMPLE_KEYS:
        m = re.search(rf"\b{key}=(\S+)", line)
        if m:
            attrs[key] = m.group(1)
    for key in _MULTIWORD_KEYS:
        m = re.search(rf"\b{key}=((?:[^=\s]+\s+)*[^=\s]+?)(?=\s+\w+=|\s*$)", line)
        if m:
            attrs[key] = m.group(1).strip()
    return attrs


def _parse_abc_key(conditioning_text: str) -> str:
    """Extract ABC-compatible key string from conditioning text.

    "C major" → "C", "A minor" → "Amin", unknown → "C".
    """
    m = re.search(
        r"\bin\s+([A-G][#b]?)\s+(major|minor)",
        conditioning_text,
        re.IGNORECASE,
    )
    if not m:
        return "C"
    tonic = m.group(1)
    mode = m.group(2).lower()
    return tonic if mode == "major" else f"{tonic}min"


def _parse_abc_tempo(conditioning_text: str) -> int:
    """Extract BPM from conditioning text ("at 92 BPM" → 92)."""
    m = re.search(r"\bat\s+(\d+)\s+BPM", conditioning_text, re.IGNORECASE)
    return int(m.group(1)) if m else 92


def _normalize_abc_key(value: str) -> str:
    """Normalize common AXIOM key labels to ABC K: values."""
    raw = value.strip()
    m = re.match(r"^([A-G][#b]?)[\s_-]*(major|minor)$", raw, re.IGNORECASE)
    if m:
        tonic = m.group(1)
        return tonic if m.group(2).lower() == "major" else f"{tonic}min"
    return raw or "C"


def _parse_title(conditioning_text: str) -> str:
    """Extract a brief title hint from conditioning text."""
    m = re.search(r"Brief:\s*(.+?)(?:\.|Mood:|Title hint:|$)", conditioning_text)
    if m:
        return m.group(1).strip()[:80]
    m2 = re.search(r"^Compose\s+(.+?)(?:\s+Brief:|$)", conditioning_text)
    if m2:
        return m2.group(1).strip()[:80]
    return conditioning_text[:60].strip()


def _find_control_value(lines: list[str], prefix: str) -> str | None:
    for line in lines:
        if line.startswith(prefix):
            value = line[len(prefix) :].strip()
            return value or None
    return None


def _parse_section_lines(control_lines: list[str]) -> list[dict[str, str]]:
    sections: list[dict[str, str]] = []
    for line in control_lines:
        if line.startswith("section "):
            attrs = _extract_section_attrs(line)
            if attrs.get("id"):
                sections.append(attrs)
    return sections


def build_abc_header(context: ProviderPromptPackingContext) -> str:
    """Build a deterministic ABC header from an AXIOM provider packing context.

    Produces standard ABC fields (X:, T:, M:, L:, Q:, K:) followed by
    %% axiom_section comment lines, one per composition section.  Suitable
    for prefixing a NotaGen-class model's ABC generation prompt.

    Returns a multi-line string ending with a newline.
    """
    text = context["conditioningText"]
    lines = context["controlLines"]

    plan_sig = _find_control_value(lines, "plan_signature=") or "unknown"
    abc_key = _normalize_abc_key(_find_control_value(lines, "key=") or _parse_abc_key(text))
    meter = _find_control_value(lines, "meter=") or "4/4"
    tempo_raw = _find_control_value(lines, "tempo=")
    tempo = int(tempo_raw) if tempo_raw and tempo_raw.isdigit() else _parse_abc_tempo(text)
    title = _parse_title(text)
    sections = _parse_section_lines(lines)

    header: list[str] = [
        "X:1",
        f"T:{title}",
        f"C:AXIOM plan_signature={plan_sig}",
        f"M:{meter}",
        "L:1/8",
        f"Q:1/4={tempo}",
        f"K:{abc_key}",
    ]

    for line in lines:
        if line.startswith("section ") or line.startswith("plan_signature="):
            continue
        header.append(f"%% {line}")

    for sec in sections:
        parts: list[str] = [
            f"id={sec.get('id', '?')}",
            f"role={sec.get('role', 'theme_a')}",
        ]
        if sec.get("measures"):
            parts.append(f"measures={sec['measures']}")
        if sec.get("tonal_center"):
            parts.append(f"key={sec['tonal_center']}")
        if sec.get("cadence"):
            parts.append(f"cadence={sec['cadence']}")
        if sec.get("energy"):
            parts.append(f"energy={sec['energy']}")
        header.append(f"%% axiom_section {' '.join(parts)}")

    return "\n".join(header) + "\n"
