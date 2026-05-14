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
from learned_symbolic.symbolic_projection import parse_key_signature


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


def _resolve_backend() -> Any:
    """Select the symbolic generation backend from AXIOM_LEARNED_BACKEND env var.

    Supported values (case-insensitive):
      "mock"    — plan-conditioned template, current default behavior
      "notagen" — NotaGen-class inference (requires checkpoint)

    Unset or empty → "mock".
    """
    backend_name = os.environ.get("AXIOM_LEARNED_BACKEND", "mock").strip().lower()
    if backend_name == "notagen":
        from learned_symbolic.notagen_backend import NotagenBackend

        return NotagenBackend()
    from learned_symbolic.mock_backend import MockBackend

    return MockBackend()


def _derive_variant_payload(
    payload: dict[str, Any], variant_index: int
) -> dict[str, Any]:
    """Return a payload with a perturbed stable seed for candidate diversity."""
    import hashlib

    if variant_index == 0:
        return payload
    base_seed = payload.get("stableSeed")
    if not isinstance(base_seed, (int, float)):
        return payload
    variant_seed = int(
        hashlib.sha256(
            f"{int(base_seed)}|variant_{variant_index}".encode()
        ).hexdigest()[:8],
        16,
    )
    return {**payload, "stableSeed": variant_seed}


def _write_feedback_evidence(
    output_path: str,
    plan_signature: str,
    lane: str,
    candidate_pool: list[dict[str, Any]],
    attempt_index: int,
) -> None:
    """Append feedback evidence for future reranker / fine-tuning data collection."""
    import datetime

    try:
        song_dir = os.path.dirname(output_path)
        base_dir = os.path.dirname(song_dir)
        song_id = os.path.basename(song_dir)
        system_dir = os.path.join(base_dir, "_system", song_id)
        os.makedirs(system_dir, exist_ok=True)
        evidence_path = os.path.join(system_dir, "feedback_evidence.json")
        entry: dict[str, Any] = {
            "planSignature": plan_signature,
            "lane": lane,
            "candidatePool": candidate_pool,
            "selectedCandidateId": candidate_pool[0]["candidateId"] if candidate_pool else "v0",
            "attemptIndex": attempt_index,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        }
        existing: list[dict[str, Any]] = []
        if os.path.exists(evidence_path):
            try:
                with open(evidence_path, "r", encoding="utf-8") as fh:
                    existing = json.load(fh)
                if not isinstance(existing, list):
                    existing = []
            except Exception:
                existing = []
        existing.append(entry)
        with open(evidence_path, "w", encoding="utf-8") as fh:
            json.dump(existing, fh, indent=2)
    except Exception:
        pass  # Evidence write is best-effort; never block the main response.


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

    backend = _resolve_backend()
    candidate_count = max(1, min(4, int(payload.get("candidateCount") or 1)))
    candidate_pool: list[dict[str, Any]] = []
    projection = None
    normalization_warnings: list[str] = []

    for variant_index in range(candidate_count):
        variant_payload = _derive_variant_payload(payload, variant_index)
        try:
            proj = backend.generate(
                payload=variant_payload,
                sections=sections,
                tonic_key=tonic_key,
                attempt_index=normalized_attempt_index,
                context=provider_prompt_context,
            )
        except NotImplementedError as exc:
            # NotaGen checkpoint absent — fall back to mock transparently.
            from learned_symbolic.mock_backend import MockBackend

            proj = MockBackend().generate(
                payload=variant_payload,
                sections=sections,
                tonic_key=tonic_key,
                attempt_index=normalized_attempt_index,
                context=provider_prompt_context,
            )
            proj["normalizationWarnings"].insert(
                0,
                f"notagen backend unavailable ({exc}); fell back to mock",
            )

        candidate_pool.append(
            {
                "candidateId": f"v{variant_index}",
                "variantIndex": variant_index,
                "noteCount": proj["totalNoteCount"],
                "measureCount": proj["totalMeasureCount"],
                "rewriteApplied": proj["rewriteApplied"],
            }
        )
        if projection is None:
            projection = proj
            normalization_warnings = proj["normalizationWarnings"]

    assert projection is not None
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

    _write_feedback_evidence(
        output_path=output_path,
        plan_signature=provider_prompt_context["planSignature"]
        if provider_prompt_context is not None
        else "",
        lane=provider_prompt_context["lane"]
        if provider_prompt_context is not None and provider_prompt_context["lane"] is not None
        else "string_trio_symbolic",
        candidate_pool=candidate_pool,
        attempt_index=normalized_attempt_index,
    )

    response: dict[str, Any] = {
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
    if len(candidate_pool) > 1:
        response["proposalCandidatePool"] = candidate_pool
    return response


def main() -> None:
    try:
        response = build_response(read_payload())
    except Exception as exc:
        response = {"ok": False, "error": str(exc)}
    sys.stdout.write(json.dumps(response))


if __name__ == "__main__":
    main()
