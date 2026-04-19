# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportAttributeAccessIssue=false
import json
import os
import sys
from typing import Any, cast

from music21 import (
    chord,
    instrument,
    meter,
    note,
    stream,
    tempo as tempo_module,
)
from learned_symbolic.prompt_packing import (
    get_prompt_pack,
    resolve_form,
    resolve_key_label,
    resolve_provider_prompt_packing_context,
    resolve_sections,
    resolve_tempo,
    supports_narrow_lane,
)
from learned_symbolic.symbolic_projection import (
    parse_key_signature,
    project_symbolic_sections,
)


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError("missing payload")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    return cast(dict[str, Any], payload)


def normalize_name(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", " ")


def as_record(value: Any) -> dict[str, Any] | None:
    return cast(dict[str, Any], value) if isinstance(value, dict) else None


def add_part(
    score: stream.Score,
    part_name: str,
    part_instrument: instrument.Instrument,
    measures: list[list[dict[str, Any]]],
) -> None:
    part = stream.Part(id=part_name.lower())
    part.append(part_instrument)
    for measure_index, events in enumerate(measures, start=1):
        measure = stream.Measure(number=measure_index)
        if measure_index == 1:
            measure.append(meter.base.TimeSignature("4/4"))
        for event in events:
            if event["kind"] == "rest":
                token = note.Rest(quarterLength=event["quarterLength"])
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


def build_response(payload: dict[str, Any]) -> dict[str, Any]:
    plan = as_record(payload.get("compositionPlan")) or {}
    prompt_pack = get_prompt_pack(payload)
    provider_prompt_context = resolve_provider_prompt_packing_context(
        payload, prompt_pack
    )
    form = resolve_form(payload, plan)
    if not supports_narrow_lane(payload, plan, form):
        return {
            "ok": False,
            "error": "unsupported narrow learned-symbolic lane; requires string_trio miniature composition plan",
        }

    output_path = str(payload.get("outputPath") or "").strip()
    if not output_path:
        return {"ok": False, "error": "outputPath is required"}

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    tempo = resolve_tempo(payload, plan)
    key_label = resolve_key_label(payload, plan)
    tonic_key = parse_key_signature(key_label)
    sections = resolve_sections(payload, plan)
    attempt_index = payload.get("attemptIndex")
    normalized_attempt_index = (
        int(round(float(attempt_index)))
        if isinstance(attempt_index, (int, float)) and attempt_index > 0
        else 1
    )
    score = stream.Score(id="learned-symbolic")
    score.append(tempo_module.MetronomeMark(number=tempo))

    projection = project_symbolic_sections(
        payload,
        sections,
        tonic_key,
        normalized_attempt_index,
        provider_prompt_context["warnings"]
        if provider_prompt_context is not None
        else None,
    )
    proposal_sections = projection["proposalSections"]
    violin_measures = projection["violinMeasures"]
    viola_measures = projection["violaMeasures"]
    cello_measures = projection["celloMeasures"]
    total_note_count = projection["totalNoteCount"]
    rewrite_applied = projection["rewriteApplied"]
    normalization_warnings = projection["normalizationWarnings"]

    add_part(score, "Violin", instrument.Violin(), violin_measures)
    add_part(score, "Viola", instrument.Viola(), viola_measures)
    add_part(score, "Cello", instrument.Violoncello(), cello_measures)
    score.write("midi", fp=output_path)

    return {
        "ok": True,
        "proposalMidiPath": output_path,
        "proposalSummary": {
            "measureCount": projection["totalMeasureCount"],
            "noteCount": total_note_count,
            "partCount": 3,
            "partInstrumentNames": ["Violin", "Viola", "Cello"],
            "key": tonic_key.name,
            "tempo": tempo,
            "form": form,
        },
        "proposalMetadata": {
            "lane": provider_prompt_context["lane"]
            if provider_prompt_context is not None
            and provider_prompt_context["lane"] is not None
            else "string_trio_symbolic",
            "provider": provider_prompt_context["provider"]
            if provider_prompt_context is not None
            else "learned",
            "model": provider_prompt_context["model"]
            if provider_prompt_context is not None
            else "learned-symbolic-trio-v1",
            "generationMode": "targeted_section_rewrite"
            if rewrite_applied
            else "plan_conditioned_trio_template",
            "confidence": 0.58 if rewrite_applied else 0.61,
            "normalizationWarnings": normalization_warnings
            if normalization_warnings
            else (
                [] if len(proposal_sections) > 1 else ["single-section fallback used"]
            ),
        },
        "proposalSections": proposal_sections,
    }


def main() -> None:
    try:
        response = build_response(read_payload())
    except Exception as exc:
        response = {"ok": False, "error": str(exc)}
    sys.stdout.write(json.dumps(response))


if __name__ == "__main__":
    main()
