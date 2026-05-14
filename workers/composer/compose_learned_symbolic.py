# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportAttributeAccessIssue=false
import json
import os
import sys
from typing import Any, cast

from learned_symbolic.backends import LearnedSymbolicBackendResult, select_backend
from learned_symbolic.prompt_packing import (
    as_record,
    get_prompt_pack,
    resolve_form,
    resolve_provider_prompt_packing_context,
    supports_narrow_lane,
)


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError("missing payload")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    return cast(dict[str, Any], payload)


def _derive_variant_payload(
    payload: dict[str, Any], variant_index: int
) -> dict[str, Any]:
    """Return a payload copy with a perturbed seed for candidate diversity.

    For variant_index > 0 the outputPath is cleared so the template backend
    skips MIDI writing — only the best candidate (v0) writes the final MIDI.
    """
    import hashlib

    if variant_index == 0:
        return payload
    base_seed = payload.get("stableSeed")
    variant_seed = (
        int(
            hashlib.sha256(
                f"{int(base_seed)}|variant_{variant_index}".encode()
            ).hexdigest()[:8],
            16,
        )
        if isinstance(base_seed, (int, float))
        else base_seed
    )
    return {**payload, "stableSeed": variant_seed, "outputPath": ""}


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
    context = resolve_provider_prompt_packing_context(payload, prompt_pack)
    form = resolve_form(payload, plan)

    if not supports_narrow_lane(payload, plan, form):
        return {
            "ok": False,
            "error": "unsupported narrow learned-symbolic lane; requires string_trio miniature composition plan",
        }

    output_path = str(payload.get("outputPath") or "").strip()
    if not output_path:
        return {"ok": False, "error": "outputPath is required"}

    attempt_index_raw = payload.get("attemptIndex")
    normalized_attempt_index = (
        int(round(float(attempt_index_raw)))
        if isinstance(attempt_index_raw, (int, float)) and attempt_index_raw > 0
        else 1
    )

    backend = select_backend(payload)
    candidate_count = max(1, min(4, int(payload.get("candidateCount") or 1)))
    candidate_pool: list[dict[str, Any]] = []
    best_result: LearnedSymbolicBackendResult | None = None

    for variant_index in range(candidate_count):
        variant_payload = _derive_variant_payload(payload, variant_index)
        result = backend.generate(variant_payload, context)

        if not result.ok:
            # Surface backend errors explicitly — do NOT silently substitute
            # another backend.  TypeScript has its own music21 fallback for
            # ok=False worker responses.
            return {
                "ok": False,
                "error": result.error or "backend generation failed",
            }

        candidate_pool.append(
            {
                "candidateId": f"v{variant_index}",
                "variantIndex": variant_index,
                "noteCount": result.note_count,
                "measureCount": result.measure_count,
                "rewriteApplied": result.rewrite_applied,
            }
        )
        if best_result is None:
            best_result = result

    assert best_result is not None

    _write_feedback_evidence(
        output_path=output_path,
        plan_signature=(context["planSignature"] if context is not None else ""),
        lane=(
            context["lane"]
            if context is not None and context.get("lane")
            else "string_trio_symbolic"
        ),
        candidate_pool=candidate_pool,
        attempt_index=normalized_attempt_index,
    )

    response: dict[str, Any] = {
        "ok": True,
        "proposalMidiPath": best_result.midi_path,
        "proposalSummary": {
            "measureCount": best_result.measure_count,
            "noteCount": best_result.note_count,
            "partCount": 3,
            "partInstrumentNames": ["Violin", "Viola", "Cello"],
            "key": best_result.key_name,
            "tempo": best_result.tempo_bpm,
            "form": best_result.form,
        },
        "proposalMetadata": {
            "lane": (
                context["lane"]
                if context is not None and context.get("lane")
                else "string_trio_symbolic"
            ),
            "provider": best_result.provider,
            "model": best_result.model,
            "generationMode": best_result.generation_mode,
            "confidence": best_result.confidence,
            "normalizationWarnings": best_result.warnings,
        },
        "proposalSections": best_result.proposal_sections,
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
