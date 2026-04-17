# pyright: reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportAttributeAccessIssue=false
import json
import os
import sys
from typing import Any, NotRequired, TypedDict, cast

from music21 import (
    chord,
    instrument,
    key as key_module,
    meter,
    note,
    stream,
    tempo as tempo_module,
)


CANONICAL_TRIO = ["violin", "viola", "cello"]
LEAD_RANGE = (62, 93)
COUNTERLINE_RANGE = (48, 81)
BASS_RANGE = (36, 67)

NARRATIVE_REWRITE_KINDS = {
    "clarify_narrative_arc",
    "clarify_phrase_rhetoric",
    "increase_pitch_variety",
    "expand_register",
}
CADENTIAL_REWRITE_KINDS = {
    "strengthen_cadence",
    "rebalance_recap_release",
    "stabilize_harmony",
}
TEXTURE_REWRITE_KINDS = {
    "clarify_texture_plan",
    "increase_rhythm_variety",
}


class SectionMaterial(TypedDict):
    sectionId: str
    role: str
    measureCount: int
    tonalCenter: str
    phraseFunction: Any
    leadEvents: list[dict[str, Any]]
    supportEvents: list[dict[str, Any]]
    noteHistory: list[int]
    violinMeasures: list[list[dict[str, Any]]]
    violaMeasures: list[list[dict[str, Any]]]
    celloMeasures: list[list[dict[str, Any]]]
    transform: NotRequired[dict[str, Any]]


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


def as_list(value: Any) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def normalize_role(value: Any, fallback: str) -> str:
    normalized = normalize_name(value).replace(" ", "_")
    if normalized in {"lead", "counterline", "bass", "inner_voice"}:
        return "counterline" if normalized == "inner_voice" else normalized
    return fallback


def clamp_midi(value: int, role: str) -> int:
    ranges: dict[str, tuple[int, int]] = {
        "lead": LEAD_RANGE,
        "counterline": COUNTERLINE_RANGE,
        "bass": BASS_RANGE,
    }
    floor, ceiling = ranges.get(role, LEAD_RANGE)
    return max(floor, min(ceiling, int(value)))


def normalize_seed_event(event: Any, fallback_role: str) -> dict[str, Any] | None:
    record = as_record(event)
    if record is None:
        return None

    kind = str(record.get("kind") or record.get("type") or "note").strip().lower()
    quarter_length = record.get("quarterLength")
    if not isinstance(quarter_length, (int, float)) or quarter_length <= 0:
        quarter_length = 1.0
    role = normalize_role(record.get("role") or record.get("voiceRole"), fallback_role)

    if kind == "rest":
        return {"kind": "rest", "quarterLength": float(quarter_length), "role": role}

    velocity = record.get("velocity")
    normalized_velocity = (
        int(round(float(velocity))) if isinstance(velocity, (int, float)) else None
    )

    if kind == "chord":
        midi_pitches = record.get("midiPitches") or record.get("pitches")
        if not isinstance(midi_pitches, list) or not midi_pitches:
            return None
        return {
            "kind": "chord",
            "quarterLength": float(quarter_length),
            "midiPitches": [
                int(round(float(value)))
                for value in cast(list[Any], midi_pitches)
                if isinstance(value, (int, float))
            ],
            **(
                {"velocity": normalized_velocity}
                if normalized_velocity is not None
                else {}
            ),
            "role": role,
        }

    midi_value = record.get("midi")
    if not isinstance(midi_value, (int, float)):
        midi_value = record.get("pitch")
    if not isinstance(midi_value, (int, float)):
        return None

    return {
        "kind": "note",
        "quarterLength": float(quarter_length),
        "midi": int(round(float(midi_value))),
        **(
            {"velocity": normalized_velocity} if normalized_velocity is not None else {}
        ),
        "role": role,
    }


def build_empty_measures(measure_count: int) -> list[list[dict[str, Any]]]:
    return [[] for _ in range(max(1, measure_count))]


def extract_seed_artifacts(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    seeded: dict[str, dict[str, Any]] = {}
    for raw_entry in as_list(payload.get("sectionArtifacts")):
        entry = as_record(raw_entry)
        if entry is None:
            continue
        section_id = str(entry.get("sectionId") or "").strip()
        if section_id:
            seeded[section_id] = entry
    return seeded


def extract_targeted_directives(
    payload: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    targeted: dict[str, list[dict[str, Any]]] = {}
    for raw_entry in as_list(payload.get("revisionDirectives")):
        entry = as_record(raw_entry)
        if entry is None:
            continue
        section_ids = entry.get("sectionIds")
        if not isinstance(section_ids, list) or not section_ids:
            continue
        normalized_entry: dict[str, Any] = {
            "kind": str(entry.get("kind") or "").strip(),
            "reason": str(entry.get("reason") or "").strip(),
            "priority": int(entry.get("priority") or 0),
        }
        for section_id in as_list(section_ids):
            normalized_id = str(section_id or "").strip()
            if not normalized_id:
                continue
            targeted.setdefault(normalized_id, []).append(normalized_entry)
    return targeted


def build_material_from_seed(
    section: dict[str, Any],
    section_index: int,
    tonic_key: key_module.Key,
    seeded_artifact: dict[str, Any],
) -> SectionMaterial | None:
    harmonic_plan = as_record(section.get("harmonicPlan")) or {}
    local_key_label = (
        str(harmonic_plan.get("tonalCenter") or tonic_key.name).strip()
        or tonic_key.name
    )
    measure_count = int(
        section.get("measures") or seeded_artifact.get("measureCount") or 4
    )
    role = str(section.get("role") or seeded_artifact.get("role") or "theme_a")
    phrase_function = section.get("phraseFunction") or seeded_artifact.get(
        "phraseFunction"
    )

    material: SectionMaterial = {
        "sectionId": str(
            section.get("id")
            or seeded_artifact.get("sectionId")
            or f"section-{section_index + 1}"
        ),
        "role": role,
        "measureCount": measure_count,
        "tonalCenter": local_key_label,
        "phraseFunction": phrase_function,
        "leadEvents": [],
        "supportEvents": [],
        "noteHistory": [],
        "violinMeasures": build_empty_measures(measure_count),
        "violaMeasures": build_empty_measures(measure_count),
        "celloMeasures": build_empty_measures(measure_count),
    }

    lead_progress = 0.0
    for raw_event in as_list(seeded_artifact.get("melodyEvents")):
        event = normalize_seed_event(raw_event, "lead")
        if not event:
            continue
        measure_index = min(int(lead_progress // 4.0), measure_count - 1)
        material["leadEvents"].append(event)
        material["violinMeasures"][measure_index].append(event)
        if event["kind"] == "note":
            material["noteHistory"].append(int(event["midi"]))
        lead_progress += float(event["quarterLength"])

    counterline_progress = 0.0
    bass_progress = 0.0
    for raw_event in as_list(seeded_artifact.get("accompanimentEvents")):
        raw_event_record = as_record(raw_event)
        if raw_event_record is None:
            continue
        fallback_role = (
            "bass"
            if normalize_role(
                raw_event_record.get("voiceRole") or raw_event_record.get("role"),
                "counterline",
            )
            == "bass"
            else "counterline"
        )
        event = normalize_seed_event(raw_event, fallback_role)
        if not event:
            continue
        material["supportEvents"].append(event)
        if event.get("role") == "bass":
            measure_index = min(int(bass_progress // 4.0), measure_count - 1)
            material["celloMeasures"][measure_index].append(event)
            bass_progress += float(event["quarterLength"])
        else:
            measure_index = min(int(counterline_progress // 4.0), measure_count - 1)
            material["violaMeasures"][measure_index].append(event)
            counterline_progress += float(event["quarterLength"])

    if not material["leadEvents"] or not material["supportEvents"]:
        return None

    return material


def resolve_form(payload: dict[str, Any], plan: dict[str, Any]) -> str:
    form = str(payload.get("form") or plan.get("form") or "miniature").strip()
    return form or "miniature"


def resolve_tempo(payload: dict[str, Any], plan: dict[str, Any]) -> int:
    tempo = payload.get("tempo")
    if isinstance(tempo, (int, float)) and tempo > 0:
        return int(round(float(tempo)))
    plan_tempo = plan.get("tempo")
    if isinstance(plan_tempo, (int, float)) and plan_tempo > 0:
        return int(round(float(plan_tempo)))
    return 92


def resolve_key_label(payload: dict[str, Any], plan: dict[str, Any]) -> str:
    key_label = str(payload.get("key") or plan.get("key") or "C major").strip()
    return key_label or "C major"


def resolve_section_measure_count(section: dict[str, Any]) -> int:
    measures = section.get("measures")
    if isinstance(measures, int) and measures > 0:
        return measures
    if isinstance(measures, float) and measures > 0:
        return int(round(measures))
    return 4


def resolve_sections(plan: dict[str, Any]) -> list[dict[str, Any]]:
    sections = plan.get("sections")
    if isinstance(sections, list) and sections:
        normalized: list[dict[str, Any]] = []
        for index, raw_entry in enumerate(as_list(sections)):
            entry = as_record(raw_entry)
            if entry is None:
                continue
            normalized.append(
                {
                    "id": str(entry.get("id") or f"section-{index + 1}"),
                    "role": str(entry.get("role") or "theme_a"),
                    "phraseFunction": entry.get("phraseFunction"),
                    "measures": resolve_section_measure_count(entry),
                    "harmonicPlan": entry.get("harmonicPlan")
                    if isinstance(entry.get("harmonicPlan"), dict)
                    else {},
                }
            )
        if normalized:
            return normalized

    return [
        {
            "id": "theme",
            "role": "theme_a",
            "phraseFunction": "presentation",
            "measures": 4,
            "harmonicPlan": {},
        },
        {
            "id": "cadence",
            "role": "closing",
            "phraseFunction": "cadential",
            "measures": 4,
            "harmonicPlan": {},
        },
    ]


def resolve_instrument_names(
    payload: dict[str, Any], plan: dict[str, Any]
) -> list[str]:
    names: list[str] = []
    instrumentation = plan.get("instrumentation")
    if isinstance(instrumentation, list):
        for raw_entry in as_list(instrumentation):
            entry = as_record(raw_entry)
            if entry is None:
                continue
            name = str(entry.get("name") or "").strip()
            if name:
                names.append(name)
    if not names:
        target = payload.get("targetInstrumentation")
        if isinstance(target, list):
            for raw_entry in as_list(target):
                entry = as_record(raw_entry)
                if entry is None:
                    continue
                name = str(entry.get("name") or "").strip()
                if name:
                    names.append(name)
    return names


def supports_narrow_lane(
    payload: dict[str, Any], plan: dict[str, Any], form: str
) -> bool:
    if "miniature" not in form.lower():
        return False

    orchestration = plan.get("orchestration")
    orchestration_record = as_record(orchestration)
    if orchestration_record is not None:
        family = normalize_name(orchestration_record.get("family"))
        if family == "string_trio":
            return True
        instrument_names = orchestration_record.get("instrumentNames")
        if isinstance(instrument_names, list):
            normalized_names = sorted(
                normalize_name(name) for name in as_list(instrument_names)
            )
            if normalized_names == sorted(CANONICAL_TRIO):
                return True

    instrument_names = resolve_instrument_names(payload, plan)
    return sorted(normalize_name(name) for name in instrument_names) == sorted(
        CANONICAL_TRIO
    )


def parse_key_signature(label: str) -> key_module.Key:
    try:
        return key_module.Key(label)
    except Exception:
        tonic, _, mode = label.partition(" ")
        return key_module.Key(tonic.strip() or "C", mode.strip().lower() or "major")


def scale_pitches(
    local_key: key_module.Key, octave: int, degrees: list[int]
) -> list[int]:
    values: list[int] = []
    for degree in degrees:
        pitch = local_key.pitchFromDegree(((degree - 1) % 7) + 1)
        if pitch is None:
            continue
        pitch.octave = octave + ((degree - 1) // 7)
        values.append(int(pitch.midi))
    return values


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


def build_section_material(
    section: dict[str, Any], section_index: int, tonic_key: key_module.Key
) -> SectionMaterial:
    harmonic_plan = as_record(section.get("harmonicPlan")) or {}
    local_key_label = (
        str(harmonic_plan.get("tonalCenter") or tonic_key.name).strip()
        or tonic_key.name
    )
    local_key = parse_key_signature(local_key_label)
    measure_count = int(section.get("measures") or 4)
    role = str(section.get("role") or "theme_a")
    phrase_function = section.get("phraseFunction")

    melodic_degrees = [1, 2, 3, 5]
    if role in {"development", "transition"}:
        melodic_degrees = [3, 4, 5, 6]
    elif role in {"closing", "cadence", "recap"}:
        melodic_degrees = [5, 4, 2, 1]

    violin_scale = scale_pitches(local_key, 5, melodic_degrees)
    viola_scale = scale_pitches(local_key, 4, [5, 4, 3, 2])
    cello_scale = scale_pitches(local_key, 3, [1, 5, 1, 5])

    violin_measures: list[list[dict[str, Any]]] = []
    viola_measures: list[list[dict[str, Any]]] = []
    cello_measures: list[list[dict[str, Any]]] = []
    lead_events: list[dict[str, Any]] = []
    support_events: list[dict[str, Any]] = []
    note_history: list[int] = []

    for measure_index in range(measure_count):
        violin_measure: list[dict[str, Any]] = []
        viola_measure: list[dict[str, Any]] = []
        cello_measure: list[dict[str, Any]] = []

        for beat in range(4):
            pitch_index = (measure_index * 4 + beat + section_index) % len(violin_scale)
            violin_pitch = violin_scale[pitch_index]
            viola_pitch = viola_scale[(pitch_index + 1) % len(viola_scale)]
            if role in {"development", "transition"} and beat % 2 == 1:
                viola_pitch -= 2
            cello_pitch = cello_scale[(measure_index + beat) % len(cello_scale)]
            if measure_index == measure_count - 1 and beat >= 2:
                cello_pitch = cello_scale[0]
                violin_pitch = violin_scale[-1 if beat == 2 else 0]

            violin_event = {
                "kind": "note",
                "midi": violin_pitch,
                "quarterLength": 1.0,
                "velocity": 74,
                "role": "lead",
            }
            viola_event = {
                "kind": "note",
                "midi": viola_pitch,
                "quarterLength": 1.0,
                "velocity": 60,
                "role": "counterline",
            }
            cello_event = {
                "kind": "note",
                "midi": cello_pitch,
                "quarterLength": 1.0,
                "velocity": 56,
                "role": "bass",
            }

            violin_measure.append(violin_event)
            viola_measure.append(viola_event)
            cello_measure.append(cello_event)
            lead_events.append(violin_event)
            support_events.append(viola_event)
            support_events.append(cello_event)
            note_history.append(violin_pitch)

        violin_measures.append(violin_measure)
        viola_measures.append(viola_measure)
        cello_measures.append(cello_measure)

    return {
        "sectionId": str(section.get("id") or f"section-{section_index + 1}"),
        "role": role,
        "measureCount": measure_count,
        "tonalCenter": local_key.name,
        "phraseFunction": phrase_function,
        "leadEvents": lead_events,
        "supportEvents": support_events,
        "noteHistory": note_history,
        "violinMeasures": violin_measures,
        "violaMeasures": viola_measures,
        "celloMeasures": cello_measures,
    }


def tonic_pitch(local_key: key_module.Key, octave: int) -> int:
    pitch = local_key.pitchFromDegree(1)
    if pitch is None:
        return 60
    pitch.octave = octave
    return int(pitch.midi)


def dominant_pitch(local_key: key_module.Key, octave: int) -> int:
    pitch = local_key.pitchFromDegree(5)
    if pitch is None:
        return 67
    pitch.octave = octave
    return int(pitch.midi)


def apply_targeted_rewrite(
    material: SectionMaterial,
    directives: list[dict[str, Any]],
    attempt_index: int,
) -> None:
    if not directives:
        return

    kinds = {
        str(entry.get("kind") or "").strip()
        for entry in directives
        if str(entry.get("kind") or "").strip()
    }
    if not kinds:
        return

    local_key = parse_key_signature(str(material.get("tonalCenter") or "C major"))
    phrase_climb = 4 if kinds & NARRATIVE_REWRITE_KINDS else 2
    lead_note_indexes = [
        index
        for index, event in enumerate(material["leadEvents"])
        if event.get("kind") == "note"
    ]
    half_note_index = len(lead_note_indexes) // 2

    for ordinal, event_index in enumerate(lead_note_indexes):
        event = material["leadEvents"][event_index]
        lift = 0
        if ordinal >= half_note_index:
            lift += phrase_climb
        elif ordinal % 2 == 1:
            lift += 2
        if kinds & {"expand_register", "increase_pitch_variety"} and ordinal % 3 == 0:
            lift += 2
        if kinds & CADENTIAL_REWRITE_KINDS and ordinal >= len(lead_note_indexes) - 2:
            cadence_targets = [
                local_key.pitchFromDegree(2),
                local_key.pitchFromDegree(1),
            ]
            cadence_target = cadence_targets[ordinal - (len(lead_note_indexes) - 2)]
            if cadence_target is None:
                continue
            cadence_target.octave = 5
            event["midi"] = clamp_midi(int(cadence_target.midi), "lead")
        else:
            event["midi"] = clamp_midi(int(event["midi"]) + lift, "lead")
        event["velocity"] = min(
            104, int(event.get("velocity") or 74) + 8 + min(attempt_index, 4)
        )

    counterline_count = 0
    bass_count = 0
    total_bass_notes = sum(
        1
        for event in material["supportEvents"]
        if event.get("kind") == "note" and event.get("role") == "bass"
    )
    for event in material["supportEvents"]:
        if event.get("kind") != "note":
            continue
        if event.get("role") == "bass":
            if kinds & CADENTIAL_REWRITE_KINDS and bass_count >= max(
                0, total_bass_notes - 4
            ):
                cadence_step = (bass_count - max(0, total_bass_notes - 4)) % 4
                cadence_pattern = [
                    tonic_pitch(local_key, 3),
                    dominant_pitch(local_key, 3),
                    tonic_pitch(local_key, 3),
                    tonic_pitch(local_key, 2),
                ]
                event["midi"] = clamp_midi(cadence_pattern[cadence_step], "bass")
            elif kinds & TEXTURE_REWRITE_KINDS:
                event["midi"] = clamp_midi(
                    int(event["midi"]) - (2 if bass_count % 2 == 0 else 0), "bass"
                )
            event["velocity"] = min(88, int(event.get("velocity") or 56) + 4)
            bass_count += 1
            continue

        shift = -2 if counterline_count % 2 == 0 else 3
        if kinds & TEXTURE_REWRITE_KINDS:
            shift += -1 if counterline_count % 3 == 0 else 1
        if (
            kinds & NARRATIVE_REWRITE_KINDS
            and counterline_count >= len(lead_note_indexes) // 2
        ):
            shift -= 1
        event["midi"] = clamp_midi(int(event["midi"]) + shift, "counterline")
        event["velocity"] = min(84, int(event.get("velocity") or 60) + 3)
        counterline_count += 1

    material["noteHistory"] = [
        int(event["midi"])
        for event in material["leadEvents"]
        if event.get("kind") == "note"
    ]
    transform_mode = "+".join(sorted(kinds))
    generated_note_count = sum(
        1
        for event in [*material["leadEvents"], *material["supportEvents"]]
        if event.get("kind") != "rest"
    )
    material["transform"] = {
        "sectionId": material["sectionId"],
        "role": material["role"],
        "sourceSectionId": material["sectionId"],
        "transformMode": f"targeted_rewrite:{transform_mode}",
        "generatedNoteCount": generated_note_count,
        "sourceNoteCount": generated_note_count,
    }


def build_response(payload: dict[str, Any]) -> dict[str, Any]:
    plan = as_record(payload.get("compositionPlan")) or {}
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
    sections = resolve_sections(plan)
    attempt_index = payload.get("attemptIndex")
    normalized_attempt_index = (
        int(round(float(attempt_index)))
        if isinstance(attempt_index, (int, float)) and attempt_index > 0
        else 1
    )
    seeded_artifacts = extract_seed_artifacts(payload)
    targeted_directives = extract_targeted_directives(payload)
    score = stream.Score(id="learned-symbolic")
    score.append(tempo_module.MetronomeMark(number=tempo))

    proposal_sections: list[SectionMaterial] = []
    normalization_warnings: list[str] = []
    rewrite_applied = False
    for index, section in enumerate(sections):
        section_id = str(section.get("id") or f"section-{index + 1}")
        seeded_material = None
        if section_id in seeded_artifacts:
            seeded_material = build_material_from_seed(
                section, index, tonic_key, seeded_artifacts[section_id]
            )
            if seeded_material is None:
                normalization_warnings.append(
                    f"seed artifact for {section_id} could not be normalized"
                )
        material = seeded_material or build_section_material(section, index, tonic_key)
        if section_id in targeted_directives:
            apply_targeted_rewrite(
                material, targeted_directives[section_id], normalized_attempt_index
            )
            rewrite_applied = True
            if section_id not in seeded_artifacts:
                normalization_warnings.append(
                    f"targeted rewrite for {section_id} used plan-conditioned fallback instead of seeded artifact"
                )
        proposal_sections.append(material)

    violin_measures: list[list[dict[str, Any]]] = []
    viola_measures: list[list[dict[str, Any]]] = []
    cello_measures: list[list[dict[str, Any]]] = []
    total_note_count = 0
    for section in proposal_sections:
        violin_measures.extend(
            cast(list[list[dict[str, Any]]], section.pop("violinMeasures"))
        )
        viola_measures.extend(
            cast(list[list[dict[str, Any]]], section.pop("violaMeasures"))
        )
        cello_measures.extend(
            cast(list[list[dict[str, Any]]], section.pop("celloMeasures"))
        )
        total_note_count += len(section["leadEvents"]) + len(section["supportEvents"])

    add_part(score, "Violin", instrument.Violin(), violin_measures)
    add_part(score, "Viola", instrument.Viola(), viola_measures)
    add_part(score, "Cello", instrument.Violoncello(), cello_measures)
    score.write("midi", fp=output_path)

    return {
        "ok": True,
        "proposalMidiPath": output_path,
        "proposalSummary": {
            "measureCount": sum(
                int(section["measureCount"]) for section in proposal_sections
            ),
            "noteCount": total_note_count,
            "partCount": 3,
            "partInstrumentNames": ["Violin", "Viola", "Cello"],
            "key": tonic_key.name,
            "tempo": tempo,
            "form": form,
        },
        "proposalMetadata": {
            "lane": "string_trio_symbolic",
            "provider": "learned_symbolic",
            "model": "learned-symbolic-trio-v1",
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
