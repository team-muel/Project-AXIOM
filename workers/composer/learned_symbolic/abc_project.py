"""ABC validation/repair/projection pipeline for the AXIOM learned symbolic pipeline.

Entry point: run_abc_projection_pipeline()

Pipeline stages:
  1. abc_validate   — structural checks (headers, voices, bars, emptiness)
  2. abc_repair     — minimal text-based repairs
  2b. duration validation — music21 bar-duration + voice-sync checks (when music21 available)
  3. abc_to_events  — music21 parse → per-section SectionMaterial events
  4. abc_to_midi    — music21 Score → MIDI file (only when output_path provided)

Hard failures (AbcProjectionResult.ok=False):
  - ABC parse failure (missing K:, all voices empty, music21 error)
  - MIDI conversion failure (when output_path is given)
  - All projection sections empty after conversion

All other problems are surfaced as normalization_warnings.
"""

from __future__ import annotations

import re
from typing import Any

from . import abc_to_events
from .abc_repair import repair_abc
from .abc_types import (
    WARN_BAR_DURATION_MISMATCH,
    WARN_INFERRED_TONAL_CENTER,
    WARN_INSTRUMENTATION_ROLE_PROJECTION_APPROXIMATE,
    WARN_VOICE_SYNC_MISMATCH,
    AbcProjectionResult,
)
from .abc_validate import (
    validate_abc_structure,
    validate_bar_durations,
    validate_voice_synchronization,
)


# ─── providerRequest helpers ─────────────────────────────────────────────────

def _find_control_value(control_lines: list[str], prefix: str) -> str | None:
    for line in control_lines:
        if line.startswith(prefix):
            return line[len(prefix):].strip() or None
    return None


def _resolve_voice_count(provider_request: dict[str, Any]) -> int:
    """Derive expected voice count from the instrumentation= control line."""
    inst = _find_control_value(
        provider_request.get("controlLines") or [], "instrumentation="
    )
    if inst:
        return max(1, len(inst.split(",")))
    return 3  # string trio default


def _resolve_meter(provider_request: dict[str, Any]) -> str:
    return (
        _find_control_value(
            provider_request.get("controlLines") or [], "meter="
        )
        or "4/4"
    )


def _resolve_tempo(provider_request: dict[str, Any]) -> int:
    raw = _find_control_value(
        provider_request.get("controlLines") or [], "tempo="
    )
    if raw:
        try:
            return int(raw)
        except ValueError:
            pass
    return 92


def _resolve_instrumentation_roles(provider_request: dict[str, Any]) -> list[str]:
    """Return a list of role strings from the instrumentation= control line.

    "Violin:lead,Viola:counterline,Cello:bass" → ["lead", "counterline", "bass"]
    """
    inst = _find_control_value(
        provider_request.get("controlLines") or [], "instrumentation="
    )
    if inst:
        roles: list[str] = []
        for item in inst.split(","):
            parts = item.strip().split(":", 1)
            roles.append(parts[1].strip() if len(parts) > 1 else "lead")
        return roles
    return ["lead", "counterline", "bass"]


def _infer_tonal_center(provider_request: dict[str, Any]) -> str:
    """Extract global tonal center from the key= control line."""
    key = _find_control_value(
        provider_request.get("controlLines") or [], "key="
    )
    if key:
        # Convert ABC format back to label: "Gmin" → "G minor", "C" → "C major"
        m = re.match(r"^([A-G][#b]?)(min)?$", key.strip())
        if m:
            tonic = m.group(1)
            mode = "minor" if m.group(2) else "major"
            return f"{tonic} {mode}"
        return key
    return ""


def _total_expected_bars(sections: list[dict[str, Any]]) -> int:
    total = 0
    for s in sections:
        raw = s.get("measures")
        total += (
            int(round(float(raw))) if isinstance(raw, (int, float)) and raw > 0 else 4
        )
    return total


# ─── Main pipeline ────────────────────────────────────────────────────────────

def run_abc_projection_pipeline(
    abc_text: str,
    sections: list[dict[str, Any]],
    provider_request: dict[str, Any],
    output_path: str | None = None,
    keep_section_artifacts: list[dict[str, Any]] | None = None,
) -> AbcProjectionResult:
    """Run the full ABC validation/repair/projection pipeline.

    Args:
        abc_text:               Raw ABC text from a NotaGen-class model.
        sections:               AXIOM section list (id, role, measures, harmonicPlan).
                                Used for section windowing during event projection.
        provider_request:       providerRequest dict (controlLines for meter/tempo/voices).
        output_path:            If provided, write a MIDI file here. None = no MIDI output.
        keep_section_artifacts: Optional list of proposal section dicts from a prior
                                candidate run.  When given, sections whose IDs appear in
                                this list are substituted with the preserved artifacts
                                instead of being reprojected (event-stable preservation).

    Returns:
        AbcProjectionResult.  ok=True with proposal_sections on success.
        ok=False with error description on hard failure.
    """
    warnings: list[str] = []

    # ── Derive parameters from provider_request ──────────────────────────────
    expected_voice_count = _resolve_voice_count(provider_request)
    meter_str = _resolve_meter(provider_request)
    tempo_bpm = _resolve_tempo(provider_request)
    instrumentation_roles = _resolve_instrumentation_roles(provider_request)
    expected_total_bars = _total_expected_bars(sections)

    # ── Stage 1: Validate ─────────────────────────────────────────────────────
    report = validate_abc_structure(
        abc_text,
        expected_voice_count=expected_voice_count,
        expected_total_bars=expected_total_bars if expected_total_bars > 0 else None,
        meter_str=meter_str,
    )

    if report.has_fatal_error:
        return AbcProjectionResult(
            ok=False,
            proposal_sections=[],
            midi_path=None,
            normalization_warnings=report.errors + report.warnings,
            error="; ".join(report.errors) or "ABC validation failed",
        )

    warnings.extend(report.warnings)

    # ── Stage 2: Repair ───────────────────────────────────────────────────────
    repair_result = repair_abc(
        abc_text,
        validation_report=report,
        expected_total_bars=expected_total_bars,
        meter_str=meter_str,
    )

    if not repair_result.ok:
        return AbcProjectionResult(
            ok=False,
            proposal_sections=[],
            midi_path=None,
            normalization_warnings=warnings,
            error=repair_result.error or "ABC repair failed",
        )

    working_abc = repair_result.repaired_abc
    warnings.extend(repair_result.repairs_applied)

    # ── Stage 2b: music21 duration validation ────────────────────────────────
    # Parse the repaired ABC once with music21 to check:
    #   a) every measure's note/rest total matches the meter's expected QL
    #   b) all voices share the same measure count and per-measure duration
    # music21 may not be installed; skip silently in that case.
    # abc_to_events.convert() will re-parse; we accept the double-parse cost
    # so that the validation warnings are populated regardless of later failures.
    try:
        import music21  # noqa: PLC0415

        _score = music21.converter.parse(working_abc, format="abc")
        _dur_detail = validate_bar_durations(_score, meter_str)
        _sync_detail = validate_voice_synchronization(_score)
        if _dur_detail:
            warnings.append(WARN_BAR_DURATION_MISMATCH)
            warnings.extend(_dur_detail)
        if _sync_detail:
            warnings.append(WARN_VOICE_SYNC_MISMATCH)
            warnings.extend(_sync_detail)
    except Exception:  # noqa: BLE001
        # music21 unavailable or ABC unparseable — skip duration checks.
        pass

    # ── Stage 3: Convert to SectionMaterial events ───────────────────────────
    try:
        proposal_sections, convert_warnings = abc_to_events.convert(
            working_abc, sections
        )
    except RuntimeError as exc:
        # music21 not available, or parse failure
        return AbcProjectionResult(
            ok=False,
            proposal_sections=[],
            midi_path=None,
            normalization_warnings=warnings,
            error=str(exc),
        )

    warnings.extend(convert_warnings)

    # Hard failure: all sections empty
    if proposal_sections and all(
        not s.get("leadEvents") and not s.get("supportEvents")
        for s in proposal_sections
    ):
        return AbcProjectionResult(
            ok=False,
            proposal_sections=[],
            midi_path=None,
            normalization_warnings=warnings,
            error="All voices produced no events after ABC conversion",
        )

    # ── Substitute preserved section artifacts (event-stable localized rewrite) ─
    if keep_section_artifacts:
        kept_by_id: dict[str, dict[str, Any]] = {
            str(s.get("sectionId") or ""): s for s in keep_section_artifacts
        }
        proposal_sections = [
            kept_by_id.get(str(s.get("sectionId") or ""), s)
            for s in proposal_sections
        ]

    # ── Infer missing tonal centers ───────────────────────────────────────────
    global_tonal_center = _infer_tonal_center(provider_request)
    needs_tonal_infer = False
    for sec in proposal_sections:
        if not sec.get("tonalCenter") and global_tonal_center:
            sec["tonalCenter"] = global_tonal_center
            needs_tonal_infer = True
    if needs_tonal_infer and WARN_INFERRED_TONAL_CENTER not in warnings:
        warnings.append(WARN_INFERRED_TONAL_CENTER)

    # Flag approximate role projection when roles were defaulted (not from plan)
    inst_line = _find_control_value(
        provider_request.get("controlLines") or [], "instrumentation="
    )
    if not inst_line and WARN_INSTRUMENTATION_ROLE_PROJECTION_APPROXIMATE not in warnings:
        warnings.append(WARN_INSTRUMENTATION_ROLE_PROJECTION_APPROXIMATE)

    # ── Stage 4: Write MIDI (optional) ───────────────────────────────────────
    midi_path: str | None = None
    if output_path:
        from .abc_to_midi import write_midi_from_abc

        try:
            midi_path = write_midi_from_abc(
                working_abc,
                output_path,
                instrumentation_roles=instrumentation_roles,
                tempo_bpm=tempo_bpm,
                meter_str=meter_str,
            )
        except RuntimeError as exc:
            return AbcProjectionResult(
                ok=False,
                proposal_sections=[],
                midi_path=None,
                normalization_warnings=warnings,
                error=f"MIDI conversion failed: {exc}",
            )

    return AbcProjectionResult(
        ok=True,
        proposal_sections=list(proposal_sections),
        midi_path=midi_path,
        normalization_warnings=warnings,
        error=None,
    )
