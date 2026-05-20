# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportAttributeAccessIssue=false
import json
import sys
from typing import Any, cast

from learned_symbolic.backends import select_backend
from learned_symbolic.prompt_packing import (
    as_record,
    get_prompt_pack,
    resolve_form,
    resolve_provider_prompt_packing_context,
    supports_narrow_lane,
    supports_solo_piano_lane,
)


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError("missing payload")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    return cast(dict[str, Any], payload)


def build_response(payload: dict[str, Any]) -> dict[str, Any]:
    plan = as_record(payload.get("compositionPlan")) or {}
    prompt_pack = get_prompt_pack(payload)
    context = resolve_provider_prompt_packing_context(payload, prompt_pack)
    form = resolve_form(payload, plan)

    lane = context.get("lane") if context is not None else None
    if lane == "solo_piano_symbolic" and not supports_solo_piano_lane(payload, plan, form):
        return {
            "ok": False,
            "error": "unsupported solo_piano_symbolic lane; compositionPlan.pianoPlan and Piano instrumentation are required",
        }

    if lane != "solo_piano_symbolic" and not supports_narrow_lane(payload, plan, form):
        return {
            "ok": False,
            "error": "unsupported narrow learned-symbolic lane; requires string_trio miniature composition plan",
        }

    output_path = str(payload.get("outputPath") or "").strip()
    if not output_path:
        return {"ok": False, "error": "outputPath is required"}

    backend = select_backend(payload)
    # Single-candidate contract: this worker always produces exactly one result.
    # candidateCount is intentionally ignored — candidate pool management is the
    # sole responsibility of the TypeScript orchestrator (hybridSymbolicCandidatePool.ts),
    # which launches one subprocess per candidate slot and collects results.
    result = backend.generate(payload, context)

    if not result.ok:
        # Surface backend errors explicitly — do NOT silently substitute
        # another backend.  TypeScript has its own music21 fallback for
        # ok=False worker responses.
        return {
            "ok": False,
            "error": result.error or "backend generation failed",
        }

    response_lane = (
        context["lane"]
        if context is not None and context.get("lane")
        else "string_trio_symbolic"
    )
    is_piano_lane = response_lane == "solo_piano_symbolic"

    response: dict[str, Any] = {
        "ok": True,
        "proposalMidiPath": result.midi_path,
        "proposalSummary": {
            "measureCount": result.measure_count,
            "noteCount": result.note_count,
            "partCount": 1 if is_piano_lane else 3,
            "partInstrumentNames": ["Piano"] if is_piano_lane else ["Violin", "Viola", "Cello"],
            "key": result.key_name,
            "tempo": result.tempo_bpm,
            "form": result.form,
        },
        "proposalMetadata": {
            "lane": response_lane,
            "provider": result.provider,
            "model": result.model,
            "generationMode": result.generation_mode,
            "confidence": result.confidence,
            "normalizationWarnings": result.warnings,
        },
        "proposalSections": result.proposal_sections,
    }
    if result.abc_text:
        response["proposalAbcScore"] = result.abc_text
    if result.voice_layout_summary:
        response["proposalVoiceLayoutSummary"] = result.voice_layout_summary
    if result.repair_actions:
        response["proposalPianoRepairActions"] = result.repair_actions
    if result.midi_rewritten:
        response["proposalMetadata"]["midiRewritten"] = True
    return response


def main() -> None:
    try:
        response = build_response(read_payload())
    except Exception as exc:
        response = {"ok": False, "error": str(exc)}
    sys.stdout.write(json.dumps(response))


if __name__ == "__main__":
    main()
