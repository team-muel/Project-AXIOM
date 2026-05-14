# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportAttributeAccessIssue=false
"""compose_learned_symbolic.py — single-candidate learned symbolic worker.

Single-candidate contract
-------------------------
Each invocation of this script produces exactly ONE composition proposal
(or ok=False on error).  The TypeScript orchestrator (hybridSymbolicCandidatePool.ts)
owns candidate pool management: it spawns N separate worker invocations — one per
slot in learnedCandidateCount + music21BaselineCount — and handles candidate
comparison, sidecar writing, and reranker input.

This script MUST NOT loop over a candidateCount parameter internally.
The payload fields that identify a candidate's place in the pool are:
  candidateIndex   — 0-based slot index (forwarded for seed derivation)
  candidateVariantKey — human-readable tag (e.g. "learned-3-s2")
  learnedSampling  — per-candidate sampling params forwarded to the backend
"""
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


def _write_feedback_evidence(
    output_path: str,
    plan_signature: str,
    lane: str,
    result: "LearnedSymbolicBackendResult",
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
            "noteCount": result.note_count,
            "measureCount": result.measure_count,
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
    result = backend.generate(payload, context)

    if not result.ok:
        # Surface backend errors explicitly — do NOT silently substitute
        # another backend.  TypeScript has its own music21 fallback for
        # ok=False worker responses.
        return {
            "ok": False,
            "error": result.error or "backend generation failed",
        }

    _write_feedback_evidence(
        output_path=output_path,
        plan_signature=(context["planSignature"] if context is not None else ""),
        lane=(
            context["lane"]
            if context is not None and context.get("lane")
            else "string_trio_symbolic"
        ),
        result=result,
        attempt_index=normalized_attempt_index,
    )

    return {
        "ok": True,
        "proposalMidiPath": result.midi_path,
        "proposalSummary": {
            "measureCount": result.measure_count,
            "noteCount": result.note_count,
            "partCount": 3,
            "partInstrumentNames": ["Violin", "Viola", "Cello"],
            "key": result.key_name,
            "tempo": result.tempo_bpm,
            "form": result.form,
        },
        "proposalMetadata": {
            "lane": (
                context["lane"]
                if context is not None and context.get("lane")
                else "string_trio_symbolic"
            ),
            "provider": result.provider,
            "model": result.model,
            "generationMode": result.generation_mode,
            "confidence": result.confidence,
            "normalizationWarnings": result.warnings,
        },
        "proposalSections": result.proposal_sections,
    }


def main() -> None:
    try:
        response = build_response(read_payload())
    except Exception as exc:
        response = {"ok": False, "error": str(exc)}
    sys.stdout.write(json.dumps(response))


if __name__ == "__main__":
    main()
