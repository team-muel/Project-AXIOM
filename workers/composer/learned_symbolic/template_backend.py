# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false
"""Template (deterministic) symbolic backend.

Delegates to the plan-conditioned template generator
(symbolic_projection.project_symbolic_sections) and writes a MIDI file to
outputPath.  This is the default backend and preserves all current narrow-lane
string_trio_symbolic behaviour exactly.
"""

from __future__ import annotations

import os
from typing import Any

from music21 import (
    chord,
    instrument,
    meter,
    note,
    stream,
    tempo as tempo_module,
)

from .backends import LearnedSymbolicBackendResult
from .prompt_packing import (
    ProviderPromptPackingContext,
    as_record,
    resolve_form,
    resolve_key_label,
    resolve_sections,
    resolve_tempo,
)
from .symbolic_projection import SymbolicProjectionResult, parse_key_signature, project_symbolic_sections


# ---------------------------------------------------------------------------
# Internal MIDI helper
# ---------------------------------------------------------------------------

def _add_part(
    score: stream.Score,
    part_name: str,
    part_instrument: instrument.Instrument,
    measures: list[list[dict[str, Any]]],
) -> None:
    """Append a single instrument part built from per-measure event lists."""
    part = stream.Part(id=part_name.lower())
    part.append(part_instrument)
    for measure_index, events in enumerate(measures, start=1):
        measure = stream.Measure(number=measure_index)
        if measure_index == 1:
            measure.append(meter.base.TimeSignature("4/4"))
        for event in events:
            if event["kind"] == "rest":
                token: Any = note.Rest(quarterLength=event["quarterLength"])
            elif event["kind"] == "chord":
                token = chord.Chord(
                    event["midiPitches"], quarterLength=event["quarterLength"]
                )
                if "velocity" in event:
                    token.volume.velocity = event["velocity"]
            else:
                token = note.Note(event["midi"], quarterLength=event["quarterLength"])
                if "velocity" in event:
                    token.volume.velocity = event["velocity"]
            measure.append(token)
        part.append(measure)
    score.append(part)


# ---------------------------------------------------------------------------
# TemplateBackend
# ---------------------------------------------------------------------------

class TemplateBackend:
    """Plan-conditioned template backend — wraps project_symbolic_sections().

    The backend is self-contained: it resolves all composition parameters from
    *payload*, calls the projection engine, constructs a music21 Score, writes
    it to the MIDI path in *payload["outputPath"]*, and returns a fully
    populated LearnedSymbolicBackendResult.

    When payload["outputPath"] is absent or empty the Score is built but not
    written to disk and midi_path will be None in the result.
    """

    PROVIDER = "learned"
    MODEL = "learned-symbolic-trio-v1"

    def generate(
        self,
        payload: dict[str, Any],
        context: ProviderPromptPackingContext | None,
    ) -> LearnedSymbolicBackendResult:
        plan = as_record(payload.get("compositionPlan")) or {}

        # ── Resolve composition parameters ──────────────────────────────────
        form = resolve_form(payload, plan)
        tempo_val = resolve_tempo(payload, plan)
        key_label = resolve_key_label(payload, plan)
        tonic_key = parse_key_signature(key_label)
        sections = resolve_sections(payload, plan)

        attempt_index_raw = payload.get("attemptIndex")
        attempt_index = (
            int(round(float(attempt_index_raw)))
            if isinstance(attempt_index_raw, (int, float)) and attempt_index_raw > 0
            else 1
        )

        # ── Merge any context-level warnings ────────────────────────────────
        base_warnings: list[str] = list(context["warnings"]) if context is not None else []

        # ── Run the projection engine ────────────────────────────────────────
        proj: SymbolicProjectionResult = project_symbolic_sections(
            payload,
            sections,
            tonic_key,
            attempt_index,
            base_warnings=base_warnings if base_warnings else None,
        )

        # ── Build and write the MIDI Score ───────────────────────────────────
        output_path = str(payload.get("outputPath") or "").strip()
        midi_path: str | None = None

        score = stream.Score(id="learned-symbolic")
        score.append(tempo_module.MetronomeMark(number=tempo_val))
        _add_part(score, "Violin", instrument.Violin(), proj["violinMeasures"])
        _add_part(score, "Viola", instrument.Viola(), proj["violaMeasures"])
        _add_part(score, "Cello", instrument.Violoncello(), proj["celloMeasures"])

        if output_path:
            parent = os.path.dirname(output_path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            score.write("midi", fp=output_path)
            midi_path = output_path

        # ── Resolve provider / model from context ────────────────────────────
        provider = (context["provider"] if context is not None else None) or self.PROVIDER
        model = (context["model"] if context is not None else None) or self.MODEL

        generation_mode = (
            "targeted_section_rewrite"
            if proj["rewriteApplied"]
            else "plan_conditioned_trio_template"
        )
        confidence = 0.58 if proj["rewriteApplied"] else 0.61

        warnings = proj["normalizationWarnings"]
        if not warnings and len(proj["proposalSections"]) <= 1:
            warnings = ["single-section fallback used"]

        return LearnedSymbolicBackendResult(
            ok=True,
            provider=provider,
            model=model,
            generation_mode=generation_mode,
            confidence=confidence,
            midi_path=midi_path,
            proposal_sections=proj["proposalSections"],
            warnings=warnings,
            note_count=proj["totalNoteCount"],
            measure_count=proj["totalMeasureCount"],
            key_name=tonic_key.name,
            form=form,
            tempo_bpm=tempo_val,
            rewrite_applied=proj["rewriteApplied"],
        )
