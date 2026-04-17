# pyright: reportMissingTypeArgument=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportUnknownParameterType=false, reportUnnecessaryIsInstance=false
"""
AXIOM Humanizer — 규칙 기반 연주 인간화 워커.

stdin으로 JSON 요청을 받고, MIDI를 인간화한 뒤 stdout에 JSON 결과를 출력한다.

요청 형식:
{
  "inputPath": "outputs/<songId>/composition.mid",
    "outputPath": "outputs/<songId>/humanized.mid",
    "style": "mechanical | restrained | expressive",
        "reflection": "optional planner/evaluation hint",
        "expressionPlan": { ...optional expression sidecar... },
        "sections": [{ ...optional compositionPlan section with harmonicPlan... }]
}

응답 형식:
{ "ok": true, "outputPath": "...", "notesModified": 42 }
또는
{ "ok": false, "error": "..." }
"""

import json
import sys
import os
import random
import hashlib
import copy

from music21 import (
    converter,
    note,
    chord,
    stream,
    midi as m21midi,
)


DYNAMIC_LEVEL_RANK = {
    "pp": 0,
    "p": 1,
    "mp": 2,
    "mf": 3,
    "f": 4,
    "ff": 5,
}

PHRASE_FUNCTIONS = {
    "presentation",
    "continuation",
    "cadential",
    "transition",
    "developmental",
}

TEXTURE_ROLES = {
    "lead",
    "counterline",
    "inner_voice",
    "chordal_support",
    "pad",
    "pulse",
    "bass",
    "accent",
}

COUNTERPOINT_MODES = {"none", "imitative", "contrary_motion", "free"}
TEMPO_MOTION_TAGS = {
    "ritardando",
    "rallentando",
    "allargando",
    "accelerando",
    "stringendo",
    "a_tempo",
    "ritenuto",
    "tempo_l_istesso",
}
ORNAMENT_TAGS = {
    "grace_note",
    "trill",
    "mordent",
    "turn",
    "arpeggio",
    "fermata",
}
EXPLICITLY_REALIZED_ORNAMENT_TAGS = {"fermata", "arpeggio", "grace_note", "trill"}

ROLE_PROFILE_OVERRIDES = {
    "lead": {
        "downbeat_scale": 1.04,
        "velocity_scale": 1.05,
        "duration_scale": 1.04,
        "timing_jitter_scale": 1.05,
        "velocity_jitter_scale": 1.04,
        "repeat_jitter_scale": 1.04,
    },
    "counterline": {
        "downbeat_scale": 0.97,
        "velocity_scale": 0.92,
        "duration_scale": 0.95,
        "timing_jitter_scale": 0.84,
        "velocity_jitter_scale": 0.82,
        "repeat_jitter_scale": 0.84,
    },
    "inner_voice": {
        "downbeat_scale": 0.94,
        "velocity_scale": 0.88,
        "duration_scale": 0.9,
        "timing_jitter_scale": 0.76,
        "velocity_jitter_scale": 0.74,
        "repeat_jitter_scale": 0.72,
    },
    "chordal_support": {
        "downbeat_scale": 0.91,
        "velocity_scale": 0.82,
        "duration_scale": 0.88,
        "timing_jitter_scale": 0.72,
        "velocity_jitter_scale": 0.68,
        "repeat_jitter_scale": 0.62,
    },
    "pad": {
        "downbeat_scale": 0.89,
        "velocity_scale": 0.8,
        "duration_scale": 1.06,
        "timing_jitter_scale": 0.68,
        "velocity_jitter_scale": 0.64,
        "repeat_jitter_scale": 0.55,
    },
    "pulse": {
        "downbeat_scale": 1.0,
        "velocity_scale": 0.87,
        "duration_scale": 0.8,
        "timing_jitter_scale": 0.64,
        "velocity_jitter_scale": 0.7,
        "repeat_jitter_scale": 0.6,
    },
    "bass": {
        "downbeat_scale": 1.03,
        "velocity_scale": 0.94,
        "duration_scale": 1.01,
        "timing_jitter_scale": 0.68,
        "velocity_jitter_scale": 0.72,
        "repeat_jitter_scale": 0.74,
    },
    "accent": {
        "downbeat_scale": 1.08,
        "velocity_scale": 1.02,
        "duration_scale": 0.82,
        "timing_jitter_scale": 0.72,
        "velocity_jitter_scale": 0.78,
        "repeat_jitter_scale": 0.7,
    },
}


def resolve_style_profile(style: str) -> dict[str, float]:
    profiles = {
        "mechanical": {
            "downbeat_boost": 1.02,
            "fade_amount": 0.12,
            "velocity_jitter": 2.0,
            "timing_jitter": 0.004,
            "ending_stretch_min": 0.01,
            "ending_stretch_max": 0.03,
            "repeat_jitter_low": -3,
            "repeat_jitter_high": 2,
            "velocity_scale": 1.0,
            "duration_scale": 1.0,
        },
        "restrained": {
            "downbeat_boost": 1.05,
            "fade_amount": 0.18,
            "velocity_jitter": 4.0,
            "timing_jitter": 0.01,
            "ending_stretch_min": 0.02,
            "ending_stretch_max": 0.05,
            "repeat_jitter_low": -6,
            "repeat_jitter_high": 3,
            "velocity_scale": 1.0,
            "duration_scale": 1.0,
        },
        "expressive": {
            "downbeat_boost": 1.1,
            "fade_amount": 0.28,
            "velocity_jitter": 8.0,
            "timing_jitter": 0.02,
            "ending_stretch_min": 0.04,
            "ending_stretch_max": 0.08,
            "repeat_jitter_low": -10,
            "repeat_jitter_high": 5,
            "velocity_scale": 1.0,
            "duration_scale": 1.0,
        },
    }
    return profiles.get(style, profiles["restrained"])


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def resolve_request_seed(
    style: str,
    reflection: object,
    expression_plan: dict | None,
    section_plans: list[dict] | None,
    input_path: str,
) -> int:
    payload = {
        "style": style,
        "reflection": str(reflection or "").strip(),
        "expressionPlan": expression_plan
        if isinstance(expression_plan, dict)
        else None,
        "sections": section_plans if isinstance(section_plans, list) else None,
        "inputSize": os.path.getsize(input_path)
        if input_path and os.path.exists(input_path)
        else 0,
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    ).hexdigest()
    return int(digest[:16], 16)


def dynamic_rank(level: str | None) -> int | None:
    if level is None:
        return None
    return DYNAMIC_LEVEL_RANK.get(str(level).strip().lower())


def average(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def tracker_int_value(tracker: dict[str, object], key: str) -> int:
    value = tracker.get(key)
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return 0
    return 0


def tracker_text_values(tracker: dict[str, object], key: str) -> list[str]:
    value = tracker.get(key)
    if not isinstance(value, list):
        return []

    items: list[str] = []
    for entry in value:
        text = str(entry or "").strip()
        if text:
            items.append(text)
    return items


def tracker_float_values(tracker: dict[str, object], key: str) -> list[float]:
    value = tracker.get(key)
    if not isinstance(value, list):
        return []

    return [float(entry) for entry in value if isinstance(entry, (int, float))]


def dedupe_ordered(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        normalized = str(value or "").strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


def dedupe_text_preserve_case(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        text = str(value or "").strip()
        normalized = text.lower()
        if not text or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(text)
    return ordered


def percentile_value(sorted_values: list[int], ratio: float) -> float | None:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return float(sorted_values[0])

    clamped_ratio = clamp(ratio, 0.0, 1.0)
    position = clamped_ratio * float(len(sorted_values) - 1)
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(sorted_values) - 1)
    if lower_index == upper_index:
        return float(sorted_values[lower_index])

    weight = position - lower_index
    return (
        float(sorted_values[lower_index]) * (1.0 - weight)
        + float(sorted_values[upper_index]) * weight
    )


def extract_expression_entries(expression_plan: dict | None) -> list[dict]:
    if not isinstance(expression_plan, dict):
        return []

    entries = []
    defaults = expression_plan.get("expressionDefaults")
    if isinstance(defaults, dict):
        entries.append(defaults)

    for section in expression_plan.get("sections", []):
        if not isinstance(section, dict):
            continue
        expression = section.get("expression")
        if isinstance(expression, dict):
            entries.append(expression)

    return entries


def extract_phrase_texture_entries(expression_plan: dict | None) -> list[dict]:
    if not isinstance(expression_plan, dict):
        return []

    entries = []
    defaults: dict[str, object] = {}
    texture_defaults = expression_plan.get("textureDefaults")
    if isinstance(texture_defaults, dict):
        defaults["texture"] = texture_defaults
    if defaults:
        entries.append(defaults)

    for section in expression_plan.get("sections", []):
        if not isinstance(section, dict):
            continue

        entry: dict[str, object] = {}
        phrase_function = str(section.get("phraseFunction") or "").strip().lower()
        if phrase_function in PHRASE_FUNCTIONS:
            entry["phraseFunction"] = phrase_function

        texture = section.get("texture")
        if isinstance(texture, dict):
            entry["texture"] = texture

        if entry:
            entries.append(entry)

    return entries


def extract_phrase_breath_entries(expression_plan: dict | None) -> list[dict]:
    if not isinstance(expression_plan, dict):
        return []

    entries: list[dict] = []
    for section in expression_plan.get("sections", []):
        if not isinstance(section, dict):
            continue

        phrase_breath = section.get("phraseBreath")
        if isinstance(phrase_breath, dict):
            entries.append(phrase_breath)

    return entries


def default_only_expression_plan(expression_plan: dict | None) -> dict | None:
    if not isinstance(expression_plan, dict):
        return None

    defaults: dict[str, object] = {}
    expression_defaults = expression_plan.get("expressionDefaults")
    if isinstance(expression_defaults, dict):
        defaults["expressionDefaults"] = expression_defaults

    texture_defaults = expression_plan.get("textureDefaults")
    if isinstance(texture_defaults, dict):
        defaults["textureDefaults"] = texture_defaults

    return defaults or None


def section_overlay_plan(section_context: dict | None) -> dict | None:
    if not isinstance(section_context, dict):
        return None

    section_entry: dict[str, object] = {}
    phrase_function = str(section_context.get("phraseFunction") or "").strip().lower()
    if phrase_function in PHRASE_FUNCTIONS:
        section_entry["phraseFunction"] = phrase_function

    texture = section_context.get("texture")
    if isinstance(texture, dict):
        section_entry["texture"] = texture

    expression = section_context.get("expression")
    if isinstance(expression, dict):
        section_entry["expression"] = expression

    if not section_entry:
        return None

    return {"sections": [section_entry]}


def normalized_measure_value(value: object) -> int | None:
    if isinstance(value, (int, float)) and int(value) > 0:
        return int(value)
    return None


def normalized_measure_values(value: object) -> list[int]:
    if not isinstance(value, list):
        return []

    ordered: list[int] = []
    seen: set[int] = set()
    for entry in value:
        measure = normalized_measure_value(entry)
        if measure is None or measure in seen:
            continue
        seen.add(measure)
        ordered.append(measure)

    return ordered


def normalized_beat_value(value: object) -> float | None:
    if isinstance(value, (int, float)) and float(value) > 0:
        return float(value)
    return None


def normalize_tempo_motion_tag(value: object) -> str:
    normalized = str(value or "").strip().lower().replace("’", "_").replace("'", "_")
    normalized = "_".join(part for part in normalized.split() if part)
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    return normalized


def extract_tempo_motion_list(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []

    motions: list[dict] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue

        tag = normalize_tempo_motion_tag(
            entry.get("tag") or entry.get("motion") or entry.get("name")
        )
        if tag not in TEMPO_MOTION_TAGS:
            continue

        motion: dict[str, object] = {"tag": tag}
        start_measure = normalized_measure_value(entry.get("startMeasure"))
        if start_measure is not None:
            motion["startMeasure"] = start_measure

        end_measure = normalized_measure_value(entry.get("endMeasure"))
        if end_measure is not None:
            motion["endMeasure"] = end_measure

        intensity = entry.get("intensity")
        if isinstance(intensity, (int, float)):
            motion["intensity"] = clamp(float(intensity), 0.0, 1.0)

        notes = [
            str(item or "").strip()
            for item in entry.get("notes", [])
            if str(item or "").strip()
        ]
        if notes:
            motion["notes"] = notes

        motions.append(motion)

    return motions


def normalize_ornament_tag(value: object) -> str:
    normalized = str(value or "").strip().lower().replace("’", "_").replace("'", "_")
    normalized = "_".join(part for part in normalized.split() if part)
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    return normalized


def extract_ornament_list(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []

    ornaments: list[dict] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue

        tag = normalize_ornament_tag(
            entry.get("tag") or entry.get("ornament") or entry.get("name")
        )
        if tag not in ORNAMENT_TAGS:
            continue

        ornament: dict[str, object] = {"tag": tag}
        section_id = str(entry.get("sectionId") or "").strip()
        if section_id:
            ornament["sectionId"] = section_id

        start_measure = normalized_measure_value(entry.get("startMeasure"))
        if start_measure is not None:
            ornament["startMeasure"] = start_measure

        end_measure = normalized_measure_value(entry.get("endMeasure"))
        if end_measure is not None:
            ornament["endMeasure"] = end_measure

        target_beat = normalized_beat_value(entry.get("targetBeat"))
        if target_beat is not None:
            ornament["targetBeat"] = target_beat

        intensity = entry.get("intensity")
        if isinstance(intensity, (int, float)):
            ornament["intensity"] = clamp(float(intensity), 0.0, 1.0)

        notes = [
            str(item or "").strip()
            for item in entry.get("notes", [])
            if str(item or "").strip()
        ]
        if notes:
            ornament["notes"] = notes

        ornaments.append(ornament)

    return ornaments


def texture_roles_in_order(texture_guidance: dict | None) -> list[str]:
    roles: list[str] = []
    for role in (texture_guidance or {}).get("primaryRoles", []):
        normalized = str(role or "").strip().lower()
        if normalized in TEXTURE_ROLES and normalized not in roles:
            roles.append(normalized)
    return roles


def counterpoint_mode_from_guidance(texture_guidance: dict | None) -> str:
    return (
        str((texture_guidance or {}).get("counterpointMode") or "")
        .strip()
        .lower()
        .replace(" ", "_")
    )


def texture_voice_count_from_guidance(
    texture_guidance: dict | None,
) -> int | None:
    voice_count = (texture_guidance or {}).get("voiceCount")
    if isinstance(voice_count, (int, float)):
        return max(1, int(voice_count))
    return None


def preferred_secondary_role(texture_guidance: dict | None) -> str:
    primary_roles = texture_roles_in_order(texture_guidance)
    for candidate in [
        "counterline",
        "inner_voice",
        "chordal_support",
        "pad",
        "pulse",
        "accent",
        "bass",
    ]:
        if candidate in primary_roles:
            return candidate

    counterpoint_mode = counterpoint_mode_from_guidance(texture_guidance)
    voice_count = texture_voice_count_from_guidance(texture_guidance)
    if counterpoint_mode in {"imitative", "contrary_motion", "free"}:
        return "counterline"
    if voice_count is not None and voice_count >= 3:
        return "inner_voice"
    return "bass"


def part_pitch_values(part: stream.Part) -> list[int]:
    pitches: list[int] = []
    for el in part.recurse().getElementsByClass((note.Note, chord.Chord)):
        if isinstance(el, note.Note):
            pitches.append(int(el.pitch.midi))
        elif isinstance(el, chord.Chord):
            pitches.extend(int(item.midi) for item in el.pitches)
    return pitches


def build_part_register_summary(part: stream.Part) -> dict[str, float]:
    sorted_pitches = sorted(part_pitch_values(part))
    average_pitch = average([float(value) for value in sorted_pitches])
    resolved_average = average_pitch if average_pitch is not None else 60.0
    low_boundary = percentile_value(sorted_pitches, 0.35)
    high_boundary = percentile_value(sorted_pitches, 0.65)

    if low_boundary is None:
        low_boundary = resolved_average - 4.0
    if high_boundary is None:
        high_boundary = resolved_average + 4.0

    if high_boundary <= low_boundary:
        spread = (
            float(sorted_pitches[-1] - sorted_pitches[0])
            if len(sorted_pitches) > 1
            else 8.0
        )
        boundary_padding = max(spread * 0.18, 2.0)
        low_boundary = resolved_average - boundary_padding
        high_boundary = resolved_average + boundary_padding

    return {
        "averagePitch": resolved_average,
        "lowBoundary": float(low_boundary),
        "highBoundary": float(high_boundary),
    }


def score_part_register_summaries(score: stream.Score) -> list[dict[str, float]]:
    return [build_part_register_summary(part) for part in score.parts]


def element_pitch_values(el: note.Note | chord.Chord) -> list[int]:
    if isinstance(el, note.Note):
        return [int(el.pitch.midi)]
    if isinstance(el, chord.Chord):
        return [int(item.midi) for item in el.pitches]
    return []


def score_part_summaries(score: stream.Score) -> list[dict[str, float | int]]:
    summaries: list[dict[str, float | int]] = []
    for index, part in enumerate(score.parts):
        pitches = part_pitch_values(part)
        average_pitch = average([float(value) for value in pitches])
        summaries.append(
            {
                "index": index,
                "averagePitch": average_pitch if average_pitch is not None else 60.0,
                "noteCount": len(pitches),
            }
        )
    return summaries


def resolve_part_roles_for_texture(
    part_summaries: list[dict[str, float | int]], texture_guidance: dict | None
) -> list[str]:
    part_count = len(part_summaries)
    if part_count == 0:
        return []

    ordered = sorted(
        part_summaries,
        key=lambda item: (
            float(item.get("averagePitch", 60.0)),
            int(item.get("index", 0)),
        ),
    )
    highest_index = int(ordered[-1].get("index", 0))
    lowest_index = int(ordered[0].get("index", 0))
    roles = ["inner_voice"] * part_count
    roles[highest_index] = "lead"

    if part_count == 1:
        return roles

    secondary_role = preferred_secondary_role(texture_guidance)
    if part_count == 2:
        roles[lowest_index] = (
            secondary_role if secondary_role in TEXTURE_ROLES else "bass"
        )
        return roles

    roles[lowest_index] = "bass"
    for item in ordered[1:-1]:
        middle_index = int(item.get("index", 0))
        roles[middle_index] = (
            secondary_role if secondary_role not in {"lead", "bass"} else "inner_voice"
        )
    return roles


def resolve_two_part_accompaniment_role(
    el: note.Note | chord.Chord,
    part_role: str,
    register_summary: dict[str, float],
) -> str:
    if part_role == "bass":
        return "bass"

    pitches = element_pitch_values(el)
    if not pitches:
        return part_role if part_role in TEXTURE_ROLES else "chordal_support"

    lowest_pitch = min(pitches)
    highest_pitch = max(pitches)
    low_boundary = float(register_summary.get("lowBoundary", 48.0))
    high_boundary = float(register_summary.get("highBoundary", 64.0))

    if highest_pitch <= low_boundary:
        return "bass"

    if (
        isinstance(el, chord.Chord)
        and lowest_pitch <= low_boundary
        and highest_pitch >= high_boundary
    ):
        if part_role in {"counterline", "inner_voice"}:
            return "chordal_support"
        return part_role if part_role in TEXTURE_ROLES else "chordal_support"

    return part_role if part_role in TEXTURE_ROLES else "chordal_support"


def resolve_event_role(
    el: note.Note | chord.Chord,
    part_index: int,
    part_count: int,
    part_role: str,
    register_summary: dict[str, float],
) -> str:
    normalized_role = part_role if part_role in TEXTURE_ROLES else "lead"

    if normalized_role == "lead" or part_count != 2:
        return normalized_role

    return resolve_two_part_accompaniment_role(el, normalized_role, register_summary)


def resolve_chord_note_roles(
    el: chord.Chord,
    part_index: int,
    part_count: int,
    part_role: str,
    register_summary: dict[str, float],
) -> list[str]:
    normalized_role = part_role if part_role in TEXTURE_ROLES else "lead"
    event_role = resolve_event_role(
        el,
        part_index,
        part_count,
        part_role,
        register_summary,
    )
    chord_notes = list(el.notes)
    if len(chord_notes) < 2 or part_count != 2 or normalized_role == "lead":
        return [event_role] * len(chord_notes)

    if normalized_role == "bass":
        return ["bass"] * len(chord_notes)

    low_boundary = float(register_summary.get("lowBoundary", 48.0))
    high_boundary = float(register_summary.get("highBoundary", 64.0))
    ordered_indices = sorted(
        range(len(chord_notes)),
        key=lambda index: int(chord_notes[index].pitch.midi),
    )
    lowest_pitch = int(chord_notes[ordered_indices[0]].pitch.midi)
    highest_pitch = int(chord_notes[ordered_indices[-1]].pitch.midi)

    if highest_pitch <= low_boundary:
        return ["bass"] * len(chord_notes)

    wide_chord = lowest_pitch <= low_boundary and highest_pitch >= high_boundary
    if wide_chord:
        upper_role = (
            normalized_role if normalized_role in TEXTURE_ROLES else "chordal_support"
        )
    else:
        upper_role = event_role if event_role in TEXTURE_ROLES else "chordal_support"
    if upper_role == "counterline":
        middle_role = "inner_voice"
    elif upper_role in {"inner_voice", "pad", "pulse", "accent"}:
        middle_role = upper_role
    else:
        middle_role = "chordal_support"

    roles = [middle_role] * len(chord_notes)
    roles[ordered_indices[-1]] = upper_role
    if lowest_pitch <= low_boundary:
        roles[ordered_indices[0]] = "bass"

    for note_index in ordered_indices[1:-1]:
        if wide_chord:
            roles[note_index] = middle_role
        else:
            pitch = int(chord_notes[note_index].pitch.midi)
            if pitch <= low_boundary:
                roles[note_index] = "bass"
            else:
                roles[note_index] = middle_role

    if len(chord_notes) == 2 and lowest_pitch > low_boundary:
        roles[ordered_indices[0]] = middle_role

    return roles


def extract_expression_plan_section_contexts(
    expression_plan: dict | None,
) -> list[dict]:
    if not isinstance(expression_plan, dict):
        return []

    contexts: list[dict] = []
    for section in expression_plan.get("sections", []):
        if not isinstance(section, dict):
            continue

        start_measure = normalized_measure_value(section.get("startMeasure"))
        end_measure = normalized_measure_value(section.get("endMeasure"))
        if start_measure is None or end_measure is None or end_measure < start_measure:
            continue

        context: dict[str, object] = {
            "sectionId": str(section.get("sectionId") or "").strip(),
            "startMeasure": start_measure,
            "endMeasure": end_measure,
        }

        phrase_function = str(section.get("phraseFunction") or "").strip().lower()
        if phrase_function in PHRASE_FUNCTIONS:
            context["phraseFunction"] = phrase_function

        texture = section.get("texture")
        if isinstance(texture, dict):
            context["texture"] = texture

        expression = section.get("expression")
        if isinstance(expression, dict):
            context["expression"] = expression

        phrase_breath = section.get("phraseBreath")
        if isinstance(phrase_breath, dict):
            context["phraseBreath"] = phrase_breath

        tempo_motion = extract_tempo_motion_list(section.get("tempoMotion"))
        if tempo_motion:
            context["tempoMotion"] = tempo_motion

        ornaments = extract_ornament_list(section.get("ornaments"))
        if ornaments:
            context["ornaments"] = ornaments

        contexts.append(context)

    return contexts


def extract_section_plan_contexts(section_plans: object) -> list[dict]:
    if not isinstance(section_plans, list):
        return []

    contexts: list[dict] = []
    start_measure = 1
    for section in section_plans:
        if not isinstance(section, dict):
            continue

        measure_count = normalized_measure_value(section.get("measures")) or 1
        end_measure = start_measure + max(1, measure_count) - 1
        context: dict[str, object] = {
            "sectionId": str(
                section.get("id") or section.get("sectionId") or ""
            ).strip(),
            "startMeasure": start_measure,
            "endMeasure": end_measure,
        }

        phrase_function = str(section.get("phraseFunction") or "").strip().lower()
        if phrase_function in PHRASE_FUNCTIONS:
            context["phraseFunction"] = phrase_function

        texture = section.get("texture")
        if isinstance(texture, dict):
            context["texture"] = texture

        expression = section.get("expression")
        if isinstance(expression, dict):
            context["expression"] = expression

        phrase_breath = section.get("phraseBreath")
        if isinstance(phrase_breath, dict):
            context["phraseBreath"] = phrase_breath

        harmonic_plan = section.get("harmonicPlan")
        if isinstance(harmonic_plan, dict):
            context["harmonicPlan"] = harmonic_plan

        tempo_motion = extract_tempo_motion_list(section.get("tempoMotion"))
        if tempo_motion:
            context["tempoMotion"] = tempo_motion

        ornaments = extract_ornament_list(section.get("ornaments"))
        if ornaments:
            context["ornaments"] = ornaments

        contexts.append(context)
        start_measure = end_measure + 1

    return contexts


def extract_section_contexts(
    expression_plan: dict | None, section_plans: object = None
) -> list[dict]:
    plan_contexts = extract_section_plan_contexts(section_plans)
    expression_contexts = extract_expression_plan_section_contexts(expression_plan)
    if not plan_contexts and not expression_contexts:
        return []

    merged_by_id: dict[str, dict] = {}
    unkeyed_contexts: list[dict] = []

    for context in plan_contexts:
        section_id = str(context.get("sectionId") or "").strip()
        if not section_id:
            unkeyed_contexts.append(context)
            continue
        merged_by_id[section_id] = dict(context)

    for context in expression_contexts:
        section_id = str(context.get("sectionId") or "").strip()
        if not section_id:
            unkeyed_contexts.append(context)
            continue
        base = merged_by_id.get(section_id, {})
        merged = dict(base)
        merged.update(context)
        merged_by_id[section_id] = merged

    return sorted(
        [*merged_by_id.values(), *unkeyed_contexts],
        key=lambda entry: (
            int(entry.get("startMeasure", 0)),
            int(entry.get("endMeasure", 0)),
        ),
    )


def normalize_harmonic_color_tag(value: object) -> str:
    return str(value or "").strip().lower().replace("-", "_")


def resolve_harmonic_color_window(
    section_context: dict | None, cue: dict
) -> tuple[int, int] | None:
    resolved_window = resolve_tempo_motion_window(cue, section_context)
    if resolved_window is not None:
        return resolved_window

    resolution_measure = resolve_section_local_measure(
        section_context,
        normalized_measure_value(cue.get("resolutionMeasure")),
    )
    bounds = section_measure_bounds(section_context)
    if resolution_measure is None or bounds is None:
        return None

    return max(bounds[0], resolution_measure - 1), resolution_measure


def resolve_harmonic_plan_profile(
    section_context: dict | None,
    measure_number: int | None,
) -> dict[str, float] | None:
    if measure_number is None or not isinstance(section_context, dict):
        return None

    harmonic_plan = section_context.get("harmonicPlan")
    if not isinstance(harmonic_plan, dict):
        return None

    profiles: list[dict[str, float]] = []
    prolongation_mode = str(harmonic_plan.get("prolongationMode") or "").strip().lower()
    if prolongation_mode == "pedal":
        profiles.append(
            {"durationScale": 1.06, "timingJitterScale": 0.9, "endingStretchScale": 1.1}
        )
    elif prolongation_mode == "dominant":
        profiles.append(
            {
                "durationScale": 1.04,
                "timingJitterScale": 0.92,
                "endingStretchScale": 1.07,
            }
        )
    elif prolongation_mode == "tonic":
        profiles.append(
            {
                "durationScale": 1.03,
                "timingJitterScale": 0.95,
                "endingStretchScale": 1.05,
            }
        )
    elif prolongation_mode == "sequential":
        profiles.append(
            {
                "durationScale": 1.01,
                "timingJitterScale": 0.97,
                "endingStretchScale": 1.03,
            }
        )

    tonicization_windows = harmonic_plan.get("tonicizationWindows")
    if isinstance(tonicization_windows, list):
        for window in tonicization_windows:
            if not isinstance(window, dict):
                continue
            resolved_window = resolve_tempo_motion_window(window, section_context)
            if (
                resolved_window is None
                or measure_number < resolved_window[0]
                or measure_number > resolved_window[1]
            ):
                continue
            emphasis = str(window.get("emphasis") or "").strip().lower()
            if emphasis == "arriving":
                profiles.append(
                    {
                        "durationScale": 1.08,
                        "timingJitterScale": 0.86,
                        "endingStretchScale": 1.12,
                    }
                )
            elif emphasis == "prepared":
                profiles.append(
                    {
                        "durationScale": 1.04,
                        "timingJitterScale": 0.91,
                        "endingStretchScale": 1.06,
                    }
                )
            else:
                profiles.append(
                    {
                        "durationScale": 1.02,
                        "timingJitterScale": 0.95,
                        "endingStretchScale": 1.04,
                    }
                )

    harmonic_color_cues = harmonic_plan.get("colorCues") or harmonic_plan.get(
        "harmonicColorCues"
    )
    if isinstance(harmonic_color_cues, list):
        for cue in harmonic_color_cues:
            if not isinstance(cue, dict):
                continue
            resolved_window = resolve_harmonic_color_window(section_context, cue)
            resolution_measure = resolve_section_local_measure(
                section_context,
                normalized_measure_value(cue.get("resolutionMeasure")),
            )
            if resolved_window is None or not (
                resolved_window[0] <= measure_number <= resolved_window[1]
            ):
                if resolution_measure is None or measure_number != resolution_measure:
                    continue
            tag = normalize_harmonic_color_tag(cue.get("tag"))
            if tag == "suspension":
                profiles.append(
                    {
                        "durationScale": 1.06,
                        "timingJitterScale": 0.88,
                        "endingStretchScale": 1.12,
                    }
                )
            elif tag == "applied_dominant":
                profiles.append(
                    {
                        "durationScale": 1.05,
                        "timingJitterScale": 0.9,
                        "endingStretchScale": 1.08,
                    }
                )
            elif tag == "predominant_color":
                profiles.append(
                    {
                        "durationScale": 1.03,
                        "timingJitterScale": 0.93,
                        "endingStretchScale": 1.05,
                    }
                )
            elif tag == "mixture":
                profiles.append(
                    {
                        "durationScale": 1.02,
                        "timingJitterScale": 0.95,
                        "endingStretchScale": 1.04,
                    }
                )

            if resolution_measure is not None and measure_number == resolution_measure:
                profiles.append(
                    {
                        "durationScale": 1.08,
                        "timingJitterScale": 0.84,
                        "endingStretchScale": 1.14,
                    }
                )

    return combine_timing_profiles(*profiles)


def section_context_for_measure(
    section_contexts: list[dict], measure_number: int | None
) -> dict | None:
    if measure_number is None:
        return None

    for context in section_contexts:
        start_measure = normalized_measure_value(context.get("startMeasure"))
        end_measure = normalized_measure_value(context.get("endMeasure"))
        if start_measure is None or end_measure is None:
            continue
        if start_measure <= measure_number <= end_measure:
            return context

    return None


def default_tempo_motion_entries(expression_plan: dict | None) -> list[dict]:
    if not isinstance(expression_plan, dict):
        return []

    return extract_tempo_motion_list(expression_plan.get("tempoMotionDefaults"))


def default_ornament_entries(expression_plan: dict | None) -> list[dict]:
    if not isinstance(expression_plan, dict):
        return []

    return extract_ornament_list(expression_plan.get("ornamentDefaults"))


def default_tempo_motion_intensity(tag: str) -> float:
    if tag in {"allargando", "ritenuto"}:
        return 0.75
    if tag in {"a_tempo", "tempo_l_istesso"}:
        return 0.55
    return 0.6


def resolve_tempo_motion_window(
    entry: dict, section_context: dict | None
) -> tuple[int, int] | None:
    if section_context:
        section_start = normalized_measure_value(section_context.get("startMeasure"))
        section_end = normalized_measure_value(section_context.get("endMeasure"))
        if section_start is None or section_end is None or section_end < section_start:
            return None

        local_start = normalized_measure_value(entry.get("startMeasure"))
        local_end = normalized_measure_value(entry.get("endMeasure"))
        start_measure = (
            section_start if local_start is None else section_start + local_start - 1
        )
        end_measure = (
            section_end if local_end is None else section_start + local_end - 1
        )
        start_measure = max(section_start, min(start_measure, section_end))
        end_measure = max(start_measure, min(end_measure, section_end))
        return start_measure, end_measure

    start_measure = normalized_measure_value(entry.get("startMeasure"))
    end_measure = normalized_measure_value(entry.get("endMeasure"))
    if start_measure is None and end_measure is None:
        return None
    if start_measure is None:
        start_measure = end_measure
    if end_measure is None:
        end_measure = start_measure
    if start_measure is None or end_measure is None:
        return None
    return start_measure, max(start_measure, end_measure)


def ornament_matches_section(entry: dict, section_context: dict | None) -> bool:
    target_section_id = str(entry.get("sectionId") or "").strip()
    if not target_section_id:
        return True
    if not isinstance(section_context, dict):
        return False
    return target_section_id == str(section_context.get("sectionId") or "").strip()


def resolve_ornament_window(
    entry: dict, section_context: dict | None
) -> tuple[int, int] | None:
    if section_context:
        section_start = normalized_measure_value(section_context.get("startMeasure"))
        section_end = normalized_measure_value(section_context.get("endMeasure"))
        if section_start is None or section_end is None or section_end < section_start:
            return None

        local_start = normalized_measure_value(entry.get("startMeasure"))
        local_end = normalized_measure_value(entry.get("endMeasure"))
        if local_start is None and local_end is None:
            return section_end, section_end

        start_measure = (
            section_start if local_start is None else section_start + local_start - 1
        )
        end_measure = (
            section_end if local_end is None else section_start + local_end - 1
        )
        start_measure = max(section_start, min(start_measure, section_end))
        end_measure = max(start_measure, min(end_measure, section_end))
        return start_measure, end_measure

    start_measure = normalized_measure_value(entry.get("startMeasure"))
    end_measure = normalized_measure_value(entry.get("endMeasure"))
    if start_measure is None and end_measure is None:
        return None
    if start_measure is None:
        start_measure = end_measure
    if end_measure is None:
        end_measure = start_measure
    if start_measure is None or end_measure is None:
        return None
    return start_measure, max(start_measure, end_measure)


def section_measure_bounds(section_context: dict | None) -> tuple[int, int] | None:
    if not isinstance(section_context, dict):
        return None

    start_measure = normalized_measure_value(section_context.get("startMeasure"))
    end_measure = normalized_measure_value(section_context.get("endMeasure"))
    if start_measure is None or end_measure is None or end_measure < start_measure:
        return None

    return start_measure, end_measure


def resolve_section_local_measure(
    section_context: dict | None, local_measure: int | None
) -> int | None:
    if local_measure is None:
        return None

    bounds = section_measure_bounds(section_context)
    if bounds is None:
        return None

    return max(bounds[0], min(bounds[0] + local_measure - 1, bounds[1]))


def resolve_phrase_breath_range(
    section_context: dict | None,
    phrase_breath: dict | None,
    start_key: str,
    end_key: str,
) -> tuple[int, int] | None:
    if not isinstance(section_context, dict) or not isinstance(phrase_breath, dict):
        return None

    local_start = normalized_measure_value(phrase_breath.get(start_key))
    local_end = normalized_measure_value(phrase_breath.get(end_key))
    if local_start is None and local_end is None:
        return None
    if local_start is None:
        local_start = local_end
    if local_end is None:
        local_end = local_start

    start_measure = resolve_section_local_measure(section_context, local_start)
    end_measure = resolve_section_local_measure(section_context, local_end)
    if start_measure is None or end_measure is None:
        return None

    return start_measure, max(start_measure, end_measure)


def resolve_phrase_breath_anchor_measures(
    section_context: dict | None, phrase_breath: dict | None
) -> set[int]:
    if not isinstance(section_context, dict) or not isinstance(phrase_breath, dict):
        return set()

    anchors: set[int] = set()
    for local_measure in normalized_measure_values(phrase_breath.get("rubatoAnchors")):
        absolute_measure = resolve_section_local_measure(section_context, local_measure)
        if absolute_measure is not None:
            anchors.add(absolute_measure)

    return anchors


def resolve_phrase_breath_profile(
    section_context: dict | None,
    measure_number: int | None,
) -> dict[str, float] | None:
    if measure_number is None or not isinstance(section_context, dict):
        return None

    phrase_breath = section_context.get("phraseBreath")
    if not isinstance(phrase_breath, dict):
        return None

    profiles: list[dict[str, float]] = []

    pickup_window = resolve_phrase_breath_range(
        section_context,
        phrase_breath,
        "pickupStartMeasure",
        "pickupEndMeasure",
    )
    if pickup_window and pickup_window[0] <= measure_number <= pickup_window[1]:
        span = max(1, pickup_window[1] - pickup_window[0] + 1)
        progress = clamp(
            (measure_number - pickup_window[0] + 1) / float(span),
            0.0,
            1.0,
        )
        profiles.append(
            {
                "durationScale": clamp(0.97 - progress * 0.03, 0.9, 1.0),
                "timingJitterScale": clamp(1.03 + progress * 0.05, 1.0, 1.12),
                "endingStretchScale": clamp(0.98 - progress * 0.03, 0.9, 1.0),
            }
        )

    arrival_measure = resolve_section_local_measure(
        section_context,
        normalized_measure_value(phrase_breath.get("arrivalMeasure")),
    )
    if arrival_measure is not None and measure_number == arrival_measure:
        profiles.append(
            {
                "durationScale": 1.16,
                "timingJitterScale": 0.78,
                "endingStretchScale": 1.24,
            }
        )

    release_window = resolve_phrase_breath_range(
        section_context,
        phrase_breath,
        "releaseStartMeasure",
        "releaseEndMeasure",
    )
    if release_window and release_window[0] <= measure_number <= release_window[1]:
        span = max(1, release_window[1] - release_window[0] + 1)
        progress = clamp(
            (measure_number - release_window[0] + 1) / float(span),
            0.0,
            1.0,
        )
        profiles.append(
            {
                "durationScale": clamp(1.06 + progress * 0.06, 1.06, 1.16),
                "timingJitterScale": clamp(0.9 - progress * 0.04, 0.82, 0.9),
                "endingStretchScale": clamp(1.12 + progress * 0.12, 1.12, 1.28),
            }
        )

    cadence_recovery_window = resolve_phrase_breath_range(
        section_context,
        phrase_breath,
        "cadenceRecoveryStartMeasure",
        "cadenceRecoveryEndMeasure",
    )
    if (
        cadence_recovery_window
        and cadence_recovery_window[0] <= measure_number <= cadence_recovery_window[1]
    ):
        profiles.append(
            {
                "durationScale": 0.98,
                "timingJitterScale": 0.94,
                "endingStretchScale": 1.02,
            }
        )

    if measure_number in resolve_phrase_breath_anchor_measures(
        section_context, phrase_breath
    ):
        profiles.append(
            {
                "durationScale": 1.06,
                "timingJitterScale": 0.84,
                "endingStretchScale": 1.12,
            }
        )

    return combine_timing_profiles(*profiles)


def phrase_breath_cues_for_measure(
    section_context: dict | None,
    measure_number: int | None,
) -> list[str]:
    if measure_number is None or not isinstance(section_context, dict):
        return []

    phrase_breath = section_context.get("phraseBreath")
    if not isinstance(phrase_breath, dict):
        return []

    cues: list[str] = []
    pickup_window = resolve_phrase_breath_range(
        section_context,
        phrase_breath,
        "pickupStartMeasure",
        "pickupEndMeasure",
    )
    if pickup_window and pickup_window[0] <= measure_number <= pickup_window[1]:
        cues.append("pickup")

    arrival_measure = resolve_section_local_measure(
        section_context,
        normalized_measure_value(phrase_breath.get("arrivalMeasure")),
    )
    if arrival_measure is not None and measure_number == arrival_measure:
        cues.append("arrival")

    release_window = resolve_phrase_breath_range(
        section_context,
        phrase_breath,
        "releaseStartMeasure",
        "releaseEndMeasure",
    )
    if release_window and release_window[0] <= measure_number <= release_window[1]:
        cues.append("release")

    cadence_recovery_window = resolve_phrase_breath_range(
        section_context,
        phrase_breath,
        "cadenceRecoveryStartMeasure",
        "cadenceRecoveryEndMeasure",
    )
    if (
        cadence_recovery_window
        and cadence_recovery_window[0] <= measure_number <= cadence_recovery_window[1]
    ):
        cues.append("cadence_recovery")

    if measure_number in resolve_phrase_breath_anchor_measures(
        section_context, phrase_breath
    ):
        cues.append("rubato_anchor")

    return cues


def windows_overlap(
    left: tuple[int, int] | None, right: tuple[int, int] | None
) -> bool:
    if left is None or right is None:
        return False

    return left[0] <= right[1] and right[0] <= left[1]


def collect_section_tempo_motion_tags(
    default_entries: list[dict], section_context: dict
) -> list[str]:
    bounds = section_measure_bounds(section_context)
    if bounds is None:
        return []

    tags: list[str] = []
    for entry in default_entries:
        if windows_overlap(resolve_tempo_motion_window(entry, None), bounds):
            tag = str(entry.get("tag") or "").strip().lower()
            if tag:
                tags.append(tag)

    for entry in extract_tempo_motion_list(section_context.get("tempoMotion")):
        if windows_overlap(resolve_tempo_motion_window(entry, section_context), bounds):
            tag = str(entry.get("tag") or "").strip().lower()
            if tag:
                tags.append(tag)

    return dedupe_ordered(tags)


def combined_section_ornament_entries(
    default_entries: list[dict], section_context: dict
) -> list[tuple[dict, tuple[int, int]]]:
    bounds = section_measure_bounds(section_context)
    if bounds is None:
        return []

    combined_entries: list[tuple[dict, tuple[int, int]]] = []
    for entry in default_entries:
        if not ornament_matches_section(entry, section_context):
            continue
        resolved_window = resolve_ornament_window(entry, None)
        if resolved_window is None or not windows_overlap(resolved_window, bounds):
            continue
        combined_entries.append((entry, resolved_window))

    for entry in extract_ornament_list(section_context.get("ornaments")):
        if not ornament_matches_section(entry, section_context):
            continue
        resolved_window = resolve_ornament_window(entry, section_context)
        if resolved_window is None or not windows_overlap(resolved_window, bounds):
            continue
        combined_entries.append((entry, resolved_window))

    return combined_entries


def ornament_entry_tracking_key(
    entry: dict, resolved_window: tuple[int, int]
) -> set[str]:
    tag = str(entry.get("tag") or "").strip().lower()
    target_beat = normalized_beat_value(entry.get("targetBeat"))

    if tag == "fermata":
        beat_label = (
            f"{target_beat:.2f}" if isinstance(target_beat, (int, float)) else "last"
        )
        return {"|".join([tag, str(resolved_window[1]), beat_label])}

    if tag in {"arpeggio", "grace_note", "trill"}:
        if target_beat is None:
            return set()

        beat_label = f"{target_beat:.2f}"
        return {
            "|".join([tag, str(measure_number), beat_label])
            for measure_number in range(resolved_window[0], resolved_window[1] + 1)
        }

    return set()


def matched_ornament_event_tracking_key(
    entry: dict, measure_number: int | None
) -> str | None:
    if measure_number is None:
        return None

    tag = str(entry.get("tag") or "").strip().lower()
    target_beat = normalized_beat_value(entry.get("targetBeat"))
    beat_label = (
        f"{target_beat:.2f}"
        if isinstance(target_beat, (int, float))
        else ("last" if tag == "fermata" else None)
    )
    if beat_label is None:
        return None

    return "|".join([tag, str(measure_number), beat_label])


def collect_section_ornament_tags(
    default_entries: list[dict], section_context: dict
) -> tuple[list[str], list[str], list[str], set[str]]:
    requested_tags: list[str] = []
    targeted_event_keys: set[str] = set()
    explicitly_realized_tag_set: set[str] = set()
    unsupported_tag_set: set[str] = set()

    for entry, resolved_window in combined_section_ornament_entries(
        default_entries, section_context
    ):
        tag = str(entry.get("tag") or "").strip().lower()
        if not tag:
            continue
        requested_tags.append(tag)
        tracking_keys = ornament_entry_tracking_key(entry, resolved_window)
        if tracking_keys:
            explicitly_realized_tag_set.add(tag)
            targeted_event_keys.update(tracking_keys)
        else:
            unsupported_tag_set.add(tag)

    deduped_tags = dedupe_ordered(requested_tags)
    explicitly_realized_tags = [
        tag for tag in deduped_tags if tag in explicitly_realized_tag_set
    ]
    unsupported_tags = [
        tag
        for tag in deduped_tags
        if tag not in explicitly_realized_tag_set and tag in unsupported_tag_set
    ]
    return (
        deduped_tags,
        explicitly_realized_tags,
        unsupported_tags,
        targeted_event_keys,
    )


def initialize_section_tempo_motion_trackers(
    default_entries: list[dict], section_contexts: list[dict]
) -> dict[str, dict[str, object]]:
    trackers: dict[str, dict[str, object]] = {}

    for context in section_contexts:
        section_id = str(context.get("sectionId") or "").strip()
        bounds = section_measure_bounds(context)
        if not section_id or bounds is None:
            continue

        targeted_measures = {
            measure_number
            for measure_number in range(bounds[0], bounds[1] + 1)
            if resolve_tempo_motion_profile(default_entries, context, measure_number)
            is not None
        }
        requested_tags = collect_section_tempo_motion_tags(default_entries, context)
        if not targeted_measures and not requested_tags:
            continue

        trackers[section_id] = {
            "sectionId": section_id,
            "requestedTags": requested_tags,
            "targetedMeasures": targeted_measures,
            "realizedMeasures": set(),
            "realizedNoteCount": 0,
            "profileMeasures": set(),
            "durationValues": [],
            "timingValues": [],
            "endingValues": [],
        }

    return trackers


def record_section_tempo_motion_realization(
    trackers: dict[str, dict[str, object]],
    section_context: dict | None,
    measure_number: int | None,
    tempo_motion_profile: dict[str, float] | None,
    event_count: int,
) -> None:
    if (
        section_context is None
        or measure_number is None
        or tempo_motion_profile is None
    ):
        return

    section_id = str(section_context.get("sectionId") or "").strip()
    tracker = trackers.get(section_id)
    if tracker is None:
        return

    realized_measures = tracker.get("realizedMeasures")
    if isinstance(realized_measures, set):
        realized_measures.add(measure_number)

    tracker["realizedNoteCount"] = tracker_int_value(
        tracker, "realizedNoteCount"
    ) + max(1, event_count)

    profile_measures = tracker.get("profileMeasures")
    if not isinstance(profile_measures, set) or measure_number in profile_measures:
        return

    profile_measures.add(measure_number)
    duration_values = tracker.get("durationValues")
    if isinstance(duration_values, list):
        duration_values.append(float(tempo_motion_profile.get("durationScale", 1.0)))
    timing_values = tracker.get("timingValues")
    if isinstance(timing_values, list):
        timing_values.append(float(tempo_motion_profile.get("timingJitterScale", 1.0)))
    ending_values = tracker.get("endingValues")
    if isinstance(ending_values, list):
        ending_values.append(float(tempo_motion_profile.get("endingStretchScale", 1.0)))


def summarize_section_tempo_motion_trackers(
    trackers: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    summaries: list[dict[str, object]] = []

    for tracker in trackers.values():
        requested_tags = tracker_text_values(tracker, "requestedTags")
        targeted_measures = tracker.get("targetedMeasures")
        realized_measures = tracker.get("realizedMeasures")
        duration_values = tracker_float_values(tracker, "durationValues")
        timing_values = tracker_float_values(tracker, "timingValues")
        ending_values = tracker_float_values(tracker, "endingValues")

        targeted_measure_count = (
            len(targeted_measures) if isinstance(targeted_measures, set) else 0
        )
        if targeted_measure_count <= 0 and not requested_tags:
            continue

        average_duration_scale = average(duration_values)
        motion_direction = "neutral"
        if average_duration_scale is not None:
            if average_duration_scale > 1.015:
                motion_direction = "broaden"
            elif average_duration_scale < 0.985:
                motion_direction = "press_forward"

        peak_duration_scale_delta = (
            max(abs(value - 1.0) for value in duration_values)
            if duration_values
            else None
        )

        summary: dict[str, object] = {
            "sectionId": str(tracker.get("sectionId") or "").strip(),
            "requestedTags": requested_tags,
            "targetedMeasureCount": targeted_measure_count,
            "realizedMeasureCount": (
                len(realized_measures) if isinstance(realized_measures, set) else 0
            ),
            "realizedNoteCount": tracker_int_value(tracker, "realizedNoteCount"),
            "motionDirection": motion_direction,
        }

        if average_duration_scale is not None:
            summary["averageDurationScale"] = round(average_duration_scale, 4)
        average_timing_scale = average(timing_values)
        if average_timing_scale is not None:
            summary["averageTimingJitterScale"] = round(average_timing_scale, 4)
        average_ending_scale = average(ending_values)
        if average_ending_scale is not None:
            summary["averageEndingStretchScale"] = round(average_ending_scale, 4)
        if peak_duration_scale_delta is not None:
            summary["peakDurationScaleDelta"] = round(peak_duration_scale_delta, 4)

        if summary["sectionId"]:
            summaries.append(summary)

    return summaries


def initialize_section_phrase_breath_trackers(
    section_contexts: list[dict],
) -> dict[str, dict[str, object]]:
    trackers: dict[str, dict[str, object]] = {}

    for context in section_contexts:
        section_id = str(context.get("sectionId") or "").strip()
        bounds = section_measure_bounds(context)
        if not section_id or bounds is None:
            continue

        targeted_measures: set[int] = set()
        targeted_by_cue: dict[str, set[int]] = {
            "pickup": set(),
            "arrival": set(),
            "release": set(),
            "cadence_recovery": set(),
            "rubato_anchor": set(),
        }
        for measure_number in range(bounds[0], bounds[1] + 1):
            for cue in phrase_breath_cues_for_measure(context, measure_number):
                targeted_measures.add(measure_number)
                targeted_by_cue.setdefault(cue, set()).add(measure_number)

        requested_cues = [
            cue_name
            for cue_name in [
                "pickup",
                "arrival",
                "release",
                "cadence_recovery",
                "rubato_anchor",
            ]
            if targeted_by_cue.get(cue_name)
        ]
        if not targeted_measures and not requested_cues:
            continue

        trackers[section_id] = {
            "sectionId": section_id,
            "requestedCues": requested_cues,
            "targetedMeasures": targeted_measures,
            "targetedByCue": targeted_by_cue,
            "realizedMeasures": set(),
            "realizedNoteCount": 0,
            "profileMeasures": set(),
            "durationValues": [],
            "timingValues": [],
            "endingValues": [],
            "cueDurationValues": {cue_name: [] for cue_name in requested_cues},
            "cueTimingValues": {cue_name: [] for cue_name in requested_cues},
            "cueEndingValues": {cue_name: [] for cue_name in requested_cues},
        }

    return trackers


def record_section_phrase_breath_realization(
    trackers: dict[str, dict[str, object]],
    section_context: dict | None,
    measure_number: int | None,
    phrase_breath_profile: dict[str, float] | None,
    event_count: int,
) -> None:
    if (
        section_context is None
        or measure_number is None
        or phrase_breath_profile is None
    ):
        return

    cues = phrase_breath_cues_for_measure(section_context, measure_number)
    if not cues:
        return

    section_id = str(section_context.get("sectionId") or "").strip()
    tracker = trackers.get(section_id)
    if tracker is None:
        return

    realized_measures = tracker.get("realizedMeasures")
    if isinstance(realized_measures, set):
        realized_measures.add(measure_number)

    tracker["realizedNoteCount"] = tracker_int_value(
        tracker, "realizedNoteCount"
    ) + max(1, event_count)

    profile_measures = tracker.get("profileMeasures")
    if not isinstance(profile_measures, set) or measure_number in profile_measures:
        return

    profile_measures.add(measure_number)
    duration_scale = float(phrase_breath_profile.get("durationScale", 1.0))
    timing_scale = float(phrase_breath_profile.get("timingJitterScale", 1.0))
    ending_scale = float(phrase_breath_profile.get("endingStretchScale", 1.0))

    duration_values = tracker.get("durationValues")
    if isinstance(duration_values, list):
        duration_values.append(duration_scale)
    timing_values = tracker.get("timingValues")
    if isinstance(timing_values, list):
        timing_values.append(timing_scale)
    ending_values = tracker.get("endingValues")
    if isinstance(ending_values, list):
        ending_values.append(ending_scale)

    cue_duration_values = tracker.get("cueDurationValues")
    cue_timing_values = tracker.get("cueTimingValues")
    cue_ending_values = tracker.get("cueEndingValues")
    for cue in cues:
        if isinstance(cue_duration_values, dict):
            cue_duration_values.setdefault(cue, []).append(duration_scale)
        if isinstance(cue_timing_values, dict):
            cue_timing_values.setdefault(cue, []).append(timing_scale)
        if isinstance(cue_ending_values, dict):
            cue_ending_values.setdefault(cue, []).append(ending_scale)


def summarize_section_phrase_breath_trackers(
    trackers: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    summaries: list[dict[str, object]] = []

    for tracker in trackers.values():
        requested_cues = tracker_text_values(tracker, "requestedCues")
        targeted_measures = tracker.get("targetedMeasures")
        realized_measures = tracker.get("realizedMeasures")
        duration_values = tracker_float_values(tracker, "durationValues")
        timing_values = tracker_float_values(tracker, "timingValues")
        ending_values = tracker_float_values(tracker, "endingValues")

        targeted_measure_count = (
            len(targeted_measures) if isinstance(targeted_measures, set) else 0
        )
        if targeted_measure_count <= 0 and not requested_cues:
            continue

        average_duration_scale = average(duration_values)
        peak_duration_scale_delta = (
            max(abs(value - 1.0) for value in duration_values)
            if duration_values
            else None
        )

        summary: dict[str, object] = {
            "sectionId": str(tracker.get("sectionId") or "").strip(),
            "requestedCues": requested_cues,
            "targetedMeasureCount": targeted_measure_count,
            "realizedMeasureCount": (
                len(realized_measures) if isinstance(realized_measures, set) else 0
            ),
            "realizedNoteCount": tracker_int_value(tracker, "realizedNoteCount"),
        }

        if average_duration_scale is not None:
            summary["averageDurationScale"] = round(average_duration_scale, 4)
        average_timing_scale = average(timing_values)
        if average_timing_scale is not None:
            summary["averageTimingJitterScale"] = round(average_timing_scale, 4)
        average_ending_scale = average(ending_values)
        if average_ending_scale is not None:
            summary["averageEndingStretchScale"] = round(average_ending_scale, 4)
        if peak_duration_scale_delta is not None:
            summary["peakDurationScaleDelta"] = round(peak_duration_scale_delta, 4)

        targeted_by_cue = tracker.get("targetedByCue")
        cue_duration_values = tracker.get("cueDurationValues")
        cue_timing_values = tracker.get("cueTimingValues")
        cue_ending_values = tracker.get("cueEndingValues")
        cue_name_to_prefix = {
            "pickup": "pickup",
            "arrival": "arrival",
            "release": "release",
            "cadence_recovery": "cadenceRecovery",
            "rubato_anchor": "rubatoAnchor",
        }

        for cue_name, prefix in cue_name_to_prefix.items():
            targeted_for_cue = (
                targeted_by_cue.get(cue_name)
                if isinstance(targeted_by_cue, dict)
                else None
            )
            targeted_count = (
                len(targeted_for_cue) if isinstance(targeted_for_cue, set) else 0
            )
            if targeted_count <= 0:
                continue

            summary[f"{prefix}MeasureCount"] = targeted_count
            cue_duration = [
                float(value)
                for value in (
                    cue_duration_values.get(cue_name, [])
                    if isinstance(cue_duration_values, dict)
                    else []
                )
                if isinstance(value, (int, float))
            ]
            cue_timing = [
                float(value)
                for value in (
                    cue_timing_values.get(cue_name, [])
                    if isinstance(cue_timing_values, dict)
                    else []
                )
                if isinstance(value, (int, float))
            ]
            cue_ending = [
                float(value)
                for value in (
                    cue_ending_values.get(cue_name, [])
                    if isinstance(cue_ending_values, dict)
                    else []
                )
                if isinstance(value, (int, float))
            ]

            average_cue_duration = average(cue_duration)
            if average_cue_duration is not None:
                summary[f"{prefix}AverageDurationScale"] = round(
                    average_cue_duration, 4
                )
            average_cue_timing = average(cue_timing)
            if average_cue_timing is not None:
                summary[f"{prefix}AverageTimingJitterScale"] = round(
                    average_cue_timing, 4
                )
            average_cue_ending = average(cue_ending)
            if average_cue_ending is not None:
                summary[f"{prefix}AverageEndingStretchScale"] = round(
                    average_cue_ending, 4
                )

        if summary["sectionId"]:
            summaries.append(summary)

    return summaries


def harmonic_realization_cues_for_measure(
    section_context: dict | None, measure_number: int | None
) -> list[str]:
    if measure_number is None or not isinstance(section_context, dict):
        return []

    harmonic_plan = section_context.get("harmonicPlan")
    if not isinstance(harmonic_plan, dict):
        return []

    cues: list[str] = []
    bounds = section_measure_bounds(section_context)
    prolongation_mode = str(harmonic_plan.get("prolongationMode") or "").strip().lower()
    if (
        prolongation_mode
        and bounds is not None
        and bounds[0] <= measure_number <= bounds[1]
    ):
        cues.append("prolongation")

    tonicization_windows = harmonic_plan.get("tonicizationWindows")
    if isinstance(tonicization_windows, list):
        for window in tonicization_windows:
            if not isinstance(window, dict):
                continue
            resolved_window = resolve_tempo_motion_window(window, section_context)
            if resolved_window is None:
                continue
            if resolved_window[0] <= measure_number <= resolved_window[1]:
                cues.append("tonicization")
                break

    harmonic_color_cues = harmonic_plan.get("colorCues") or harmonic_plan.get(
        "harmonicColorCues"
    )
    if isinstance(harmonic_color_cues, list):
        for cue in harmonic_color_cues:
            if not isinstance(cue, dict):
                continue
            resolved_window = resolve_harmonic_color_window(section_context, cue)
            resolution_measure = resolve_section_local_measure(
                section_context,
                normalized_measure_value(cue.get("resolutionMeasure")),
            )
            if (
                resolved_window is not None
                and resolved_window[0] <= measure_number <= resolved_window[1]
            ):
                cues.append("harmonic_color")
                break
            if resolution_measure is not None and measure_number == resolution_measure:
                cues.append("harmonic_color")
                break

    return dedupe_ordered(cues)


def initialize_section_harmonic_realization_trackers(
    section_contexts: list[dict],
) -> dict[str, dict[str, object]]:
    trackers: dict[str, dict[str, object]] = {}

    for context in section_contexts:
        section_id = str(context.get("sectionId") or "").strip()
        bounds = section_measure_bounds(context)
        harmonic_plan = context.get("harmonicPlan")
        if not section_id or bounds is None or not isinstance(harmonic_plan, dict):
            continue

        targeted_measures: set[int] = set()
        targeted_by_cue: dict[str, set[int]] = {
            "prolongation": set(),
            "tonicization": set(),
            "harmonic_color": set(),
        }
        for measure_number in range(bounds[0], bounds[1] + 1):
            for cue in harmonic_realization_cues_for_measure(context, measure_number):
                targeted_measures.add(measure_number)
                targeted_by_cue.setdefault(cue, set()).add(measure_number)

        requested_tonicization_targets = dedupe_text_preserve_case(
            [
                str(window.get("keyTarget") or "").strip()
                for window in harmonic_plan.get("tonicizationWindows", [])
                if isinstance(window, dict)
                and str(window.get("keyTarget") or "").strip()
            ]
        )
        requested_color_tags = dedupe_ordered(
            [
                normalize_harmonic_color_tag(cue.get("tag"))
                for cue in (
                    harmonic_plan.get("colorCues")
                    or harmonic_plan.get("harmonicColorCues")
                    or []
                )
                if isinstance(cue, dict)
                and normalize_harmonic_color_tag(cue.get("tag"))
            ]
        )
        prolongation_mode = (
            str(harmonic_plan.get("prolongationMode") or "").strip().lower()
        )

        if (
            not targeted_measures
            and not requested_tonicization_targets
            and not requested_color_tags
            and not prolongation_mode
        ):
            continue

        trackers[section_id] = {
            "sectionId": section_id,
            "prolongationMode": prolongation_mode,
            "requestedTonicizationTargets": requested_tonicization_targets,
            "requestedColorTags": requested_color_tags,
            "targetedMeasures": targeted_measures,
            "targetedByCue": targeted_by_cue,
            "realizedMeasures": set(),
            "realizedNoteCount": 0,
            "profileMeasures": set(),
            "durationValues": [],
            "timingValues": [],
            "endingValues": [],
            "cueDurationValues": {
                "prolongation": [],
                "tonicization": [],
                "harmonic_color": [],
            },
            "cueTimingValues": {
                "prolongation": [],
                "tonicization": [],
                "harmonic_color": [],
            },
            "cueEndingValues": {
                "prolongation": [],
                "tonicization": [],
                "harmonic_color": [],
            },
        }

    return trackers


def record_section_harmonic_realization(
    trackers: dict[str, dict[str, object]],
    section_context: dict | None,
    measure_number: int | None,
    harmonic_plan_profile: dict[str, float] | None,
    event_count: int,
) -> None:
    if (
        section_context is None
        or measure_number is None
        or harmonic_plan_profile is None
    ):
        return

    cues = harmonic_realization_cues_for_measure(section_context, measure_number)
    if not cues:
        return

    section_id = str(section_context.get("sectionId") or "").strip()
    tracker = trackers.get(section_id)
    if tracker is None:
        return

    realized_measures = tracker.get("realizedMeasures")
    if isinstance(realized_measures, set):
        realized_measures.add(measure_number)

    tracker["realizedNoteCount"] = tracker_int_value(
        tracker, "realizedNoteCount"
    ) + max(1, event_count)

    profile_measures = tracker.get("profileMeasures")
    if not isinstance(profile_measures, set) or measure_number in profile_measures:
        return

    profile_measures.add(measure_number)
    duration_scale = float(harmonic_plan_profile.get("durationScale", 1.0))
    timing_scale = float(harmonic_plan_profile.get("timingJitterScale", 1.0))
    ending_scale = float(harmonic_plan_profile.get("endingStretchScale", 1.0))

    duration_values = tracker.get("durationValues")
    if isinstance(duration_values, list):
        duration_values.append(duration_scale)
    timing_values = tracker.get("timingValues")
    if isinstance(timing_values, list):
        timing_values.append(timing_scale)
    ending_values = tracker.get("endingValues")
    if isinstance(ending_values, list):
        ending_values.append(ending_scale)

    cue_duration_values = tracker.get("cueDurationValues")
    cue_timing_values = tracker.get("cueTimingValues")
    cue_ending_values = tracker.get("cueEndingValues")
    for cue in cues:
        if isinstance(cue_duration_values, dict):
            cue_duration_values.setdefault(cue, []).append(duration_scale)
        if isinstance(cue_timing_values, dict):
            cue_timing_values.setdefault(cue, []).append(timing_scale)
        if isinstance(cue_ending_values, dict):
            cue_ending_values.setdefault(cue, []).append(ending_scale)


def summarize_section_harmonic_realization_trackers(
    trackers: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    summaries: list[dict[str, object]] = []

    for tracker in trackers.values():
        targeted_measures = tracker.get("targetedMeasures")
        realized_measures = tracker.get("realizedMeasures")
        duration_values = tracker_float_values(tracker, "durationValues")
        timing_values = tracker_float_values(tracker, "timingValues")
        ending_values = tracker_float_values(tracker, "endingValues")

        targeted_measure_count = (
            len(targeted_measures) if isinstance(targeted_measures, set) else 0
        )
        if targeted_measure_count <= 0:
            continue

        average_duration_scale = average(duration_values)
        peak_duration_scale_delta = (
            max(abs(value - 1.0) for value in duration_values)
            if duration_values
            else None
        )

        summary: dict[str, object] = {
            "sectionId": str(tracker.get("sectionId") or "").strip(),
            "targetedMeasureCount": targeted_measure_count,
            "realizedMeasureCount": (
                len(realized_measures) if isinstance(realized_measures, set) else 0
            ),
            "realizedNoteCount": tracker_int_value(tracker, "realizedNoteCount"),
        }

        prolongation_mode = str(tracker.get("prolongationMode") or "").strip().lower()
        if prolongation_mode:
            summary["prolongationMode"] = prolongation_mode

        requested_tonicization_targets = tracker_text_values(
            tracker, "requestedTonicizationTargets"
        )
        if requested_tonicization_targets:
            summary["requestedTonicizationTargets"] = requested_tonicization_targets

        requested_color_tags = tracker_text_values(tracker, "requestedColorTags")
        if requested_color_tags:
            summary["requestedColorTags"] = requested_color_tags

        if average_duration_scale is not None:
            summary["averageDurationScale"] = round(average_duration_scale, 4)
        average_timing_scale = average(timing_values)
        if average_timing_scale is not None:
            summary["averageTimingJitterScale"] = round(average_timing_scale, 4)
        average_ending_scale = average(ending_values)
        if average_ending_scale is not None:
            summary["averageEndingStretchScale"] = round(average_ending_scale, 4)
        if peak_duration_scale_delta is not None:
            summary["peakDurationScaleDelta"] = round(peak_duration_scale_delta, 4)

        targeted_by_cue = tracker.get("targetedByCue")
        cue_duration_values = tracker.get("cueDurationValues")
        cue_timing_values = tracker.get("cueTimingValues")
        cue_ending_values = tracker.get("cueEndingValues")
        cue_name_to_prefix = {
            "prolongation": "prolongation",
            "tonicization": "tonicization",
            "harmonic_color": "harmonicColor",
        }

        for cue_name, prefix in cue_name_to_prefix.items():
            targeted_for_cue = (
                targeted_by_cue.get(cue_name)
                if isinstance(targeted_by_cue, dict)
                else None
            )
            targeted_count = (
                len(targeted_for_cue) if isinstance(targeted_for_cue, set) else 0
            )
            if targeted_count <= 0:
                continue

            summary[f"{prefix}MeasureCount"] = targeted_count
            cue_duration = [
                float(value)
                for value in (
                    cue_duration_values.get(cue_name, [])
                    if isinstance(cue_duration_values, dict)
                    else []
                )
                if isinstance(value, (int, float))
            ]
            cue_timing = [
                float(value)
                for value in (
                    cue_timing_values.get(cue_name, [])
                    if isinstance(cue_timing_values, dict)
                    else []
                )
                if isinstance(value, (int, float))
            ]
            cue_ending = [
                float(value)
                for value in (
                    cue_ending_values.get(cue_name, [])
                    if isinstance(cue_ending_values, dict)
                    else []
                )
                if isinstance(value, (int, float))
            ]

            average_cue_duration = average(cue_duration)
            if average_cue_duration is not None:
                summary[f"{prefix}AverageDurationScale"] = round(
                    average_cue_duration, 4
                )
            average_cue_timing = average(cue_timing)
            if average_cue_timing is not None:
                summary[f"{prefix}AverageTimingJitterScale"] = round(
                    average_cue_timing, 4
                )
            average_cue_ending = average(cue_ending)
            if average_cue_ending is not None:
                summary[f"{prefix}AverageEndingStretchScale"] = round(
                    average_cue_ending, 4
                )

        if summary["sectionId"]:
            summaries.append(summary)

    return summaries


def initialize_section_ornament_trackers(
    default_entries: list[dict], section_contexts: list[dict]
) -> dict[str, dict[str, object]]:
    trackers: dict[str, dict[str, object]] = {}

    for context in section_contexts:
        section_id = str(context.get("sectionId") or "").strip()
        if not section_id:
            continue

        (
            requested_tags,
            explicitly_realized_tags,
            unsupported_tags,
            targeted_event_keys,
        ) = collect_section_ornament_tags(default_entries, context)
        if not requested_tags and not targeted_event_keys:
            continue

        trackers[section_id] = {
            "sectionId": section_id,
            "requestedTags": requested_tags,
            "explicitlyRealizedTags": explicitly_realized_tags,
            "unsupportedTags": unsupported_tags,
            "targetedEventKeys": targeted_event_keys,
            "realizedEventKeys": set(),
            "realizedNoteCount": 0,
            "profileEventKeys": set(),
            "durationValues": [],
            "timingValues": [],
            "endingValues": [],
            "onsetSpreadValues": [],
            "graceLeadInValues": [],
            "trillOscillationValues": [],
            "trillSpanValues": [],
        }

    return trackers


def resolve_matching_ornament_entries(
    default_entries: list[dict],
    section_context: dict | None,
    measure_number: int | None,
    beat_value: float | None,
    is_last_event_in_measure: bool,
    allow_arpeggio: bool = False,
    allow_grace_note: bool = False,
    allow_trill: bool = False,
) -> list[tuple[dict, tuple[int, int]]]:
    if measure_number is None or not isinstance(section_context, dict):
        return []

    matches: list[tuple[dict, tuple[int, int]]] = []
    for entry, resolved_window in combined_section_ornament_entries(
        default_entries, section_context
    ):
        tag = str(entry.get("tag") or "").strip().lower()
        target_beat = normalized_beat_value(entry.get("targetBeat"))

        if tag == "fermata":
            if measure_number != resolved_window[1]:
                continue

            if target_beat is not None:
                if beat_value is None or abs(beat_value - target_beat) > 0.26:
                    continue
            elif not is_last_event_in_measure:
                continue

            matches.append((entry, resolved_window))
            continue

        if tag == "arpeggio":
            if not allow_arpeggio or target_beat is None or beat_value is None:
                continue
            if (
                measure_number < resolved_window[0]
                or measure_number > resolved_window[1]
            ):
                continue
            if abs(beat_value - target_beat) > 0.26:
                continue

            matches.append((entry, resolved_window))
            continue

        if tag == "grace_note":
            if not allow_grace_note or target_beat is None or beat_value is None:
                continue
            if (
                measure_number < resolved_window[0]
                or measure_number > resolved_window[1]
            ):
                continue
            if abs(beat_value - target_beat) > 0.26:
                continue

            matches.append((entry, resolved_window))

        if tag == "trill":
            if not allow_trill or target_beat is None or beat_value is None:
                continue
            if (
                measure_number < resolved_window[0]
                or measure_number > resolved_window[1]
            ):
                continue
            if abs(beat_value - target_beat) > 0.26:
                continue

            matches.append((entry, resolved_window))

    return matches


def filter_matching_ornament_entries_by_tag(
    matching_entries: list[tuple[dict, tuple[int, int]]],
    tag: str,
) -> list[tuple[dict, tuple[int, int]]]:
    normalized_tag = str(tag or "").strip().lower()
    if not normalized_tag:
        return []

    return [
        (entry, resolved_window)
        for entry, resolved_window in matching_entries
        if str(entry.get("tag") or "").strip().lower() == normalized_tag
    ]


def record_section_ornament_realization(
    trackers: dict[str, dict[str, object]],
    section_context: dict | None,
    matching_entries: list[tuple[dict, tuple[int, int]]],
    measure_number: int | None,
    ornament_profile: dict[str, float] | None,
    event_count: int,
) -> None:
    if section_context is None or not matching_entries or ornament_profile is None:
        return

    section_id = str(section_context.get("sectionId") or "").strip()
    tracker = trackers.get(section_id)
    if tracker is None:
        return

    tracker["realizedNoteCount"] = tracker_int_value(
        tracker, "realizedNoteCount"
    ) + max(1, event_count)

    realized_event_keys = tracker.get("realizedEventKeys")
    profile_event_keys = tracker.get("profileEventKeys")
    duration_values = tracker.get("durationValues")
    timing_values = tracker.get("timingValues")
    ending_values = tracker.get("endingValues")
    onset_spread_values = tracker.get("onsetSpreadValues")
    grace_lead_in_values = tracker.get("graceLeadInValues")
    trill_oscillation_values = tracker.get("trillOscillationValues")
    trill_span_values = tracker.get("trillSpanValues")

    for entry, _resolved_window in matching_entries:
        event_key = matched_ornament_event_tracking_key(entry, measure_number)
        if event_key is None:
            continue
        if isinstance(realized_event_keys, set):
            realized_event_keys.add(event_key)

        if not isinstance(profile_event_keys, set) or event_key in profile_event_keys:
            continue

        profile_event_keys.add(event_key)
        if isinstance(duration_values, list) and "durationScale" in ornament_profile:
            duration_values.append(float(ornament_profile.get("durationScale", 1.0)))
        if isinstance(timing_values, list) and "timingJitterScale" in ornament_profile:
            timing_values.append(float(ornament_profile.get("timingJitterScale", 1.0)))
        if isinstance(ending_values, list) and "endingStretchScale" in ornament_profile:
            ending_values.append(float(ornament_profile.get("endingStretchScale", 1.0)))
        if (
            isinstance(onset_spread_values, list)
            and "onsetSpreadBeats" in ornament_profile
        ):
            onset_spread_values.append(
                float(ornament_profile.get("onsetSpreadBeats", 0.0))
            )
        if (
            isinstance(grace_lead_in_values, list)
            and "graceLeadInBeats" in ornament_profile
        ):
            grace_lead_in_values.append(
                float(ornament_profile.get("graceLeadInBeats", 0.0))
            )
        if (
            isinstance(trill_oscillation_values, list)
            and "trillOscillationCount" in ornament_profile
        ):
            trill_oscillation_values.append(
                float(ornament_profile.get("trillOscillationCount", 0.0))
            )
        if isinstance(trill_span_values, list) and "trillSpanBeats" in ornament_profile:
            trill_span_values.append(float(ornament_profile.get("trillSpanBeats", 0.0)))


def summarize_section_ornament_trackers(
    trackers: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    summaries: list[dict[str, object]] = []

    for tracker in trackers.values():
        requested_tags = tracker_text_values(tracker, "requestedTags")
        explicitly_realized_tags = tracker_text_values(
            tracker, "explicitlyRealizedTags"
        )
        unsupported_tags = tracker_text_values(tracker, "unsupportedTags")
        targeted_event_keys = tracker.get("targetedEventKeys")
        realized_event_keys = tracker.get("realizedEventKeys")
        duration_values = tracker_float_values(tracker, "durationValues")
        timing_values = tracker_float_values(tracker, "timingValues")
        ending_values = tracker_float_values(tracker, "endingValues")
        onset_spread_values = tracker_float_values(tracker, "onsetSpreadValues")
        grace_lead_in_values = tracker_float_values(tracker, "graceLeadInValues")
        trill_oscillation_values = tracker_float_values(
            tracker, "trillOscillationValues"
        )
        trill_span_values = tracker_float_values(tracker, "trillSpanValues")

        targeted_event_count = (
            len(targeted_event_keys) if isinstance(targeted_event_keys, set) else 0
        )
        if targeted_event_count <= 0 and not requested_tags:
            continue

        peak_duration_scale_delta = (
            max(abs(value - 1.0) for value in duration_values)
            if duration_values
            else None
        )

        summary: dict[str, object] = {
            "sectionId": str(tracker.get("sectionId") or "").strip(),
            "requestedTags": requested_tags,
            "explicitlyRealizedTags": explicitly_realized_tags,
            "targetedEventCount": targeted_event_count,
            "realizedEventCount": (
                len(realized_event_keys) if isinstance(realized_event_keys, set) else 0
            ),
            "realizedNoteCount": tracker_int_value(tracker, "realizedNoteCount"),
        }

        if unsupported_tags:
            summary["unsupportedTags"] = unsupported_tags
        average_duration_scale = average(duration_values)
        if average_duration_scale is not None:
            summary["averageDurationScale"] = round(average_duration_scale, 4)
        average_timing_scale = average(timing_values)
        if average_timing_scale is not None:
            summary["averageTimingJitterScale"] = round(average_timing_scale, 4)
        average_ending_scale = average(ending_values)
        if average_ending_scale is not None:
            summary["averageEndingStretchScale"] = round(average_ending_scale, 4)
        average_onset_spread = average(onset_spread_values)
        if average_onset_spread is not None:
            summary["averageOnsetSpreadBeats"] = round(average_onset_spread, 4)
        if onset_spread_values:
            summary["peakOnsetSpreadBeats"] = round(max(onset_spread_values), 4)
        average_grace_lead_in = average(grace_lead_in_values)
        if average_grace_lead_in is not None:
            summary["averageGraceLeadInBeats"] = round(average_grace_lead_in, 4)
        if grace_lead_in_values:
            summary["peakGraceLeadInBeats"] = round(max(grace_lead_in_values), 4)
        average_trill_oscillation = average(trill_oscillation_values)
        if average_trill_oscillation is not None:
            summary["averageTrillOscillationCount"] = round(
                average_trill_oscillation, 4
            )
        if trill_oscillation_values:
            summary["peakTrillOscillationCount"] = round(
                max(trill_oscillation_values), 4
            )
        average_trill_span = average(trill_span_values)
        if average_trill_span is not None:
            summary["averageTrillSpanBeats"] = round(average_trill_span, 4)
        if trill_span_values:
            summary["peakTrillSpanBeats"] = round(max(trill_span_values), 4)
        if peak_duration_scale_delta is not None:
            summary["peakDurationScaleDelta"] = round(peak_duration_scale_delta, 4)

        if summary["sectionId"]:
            summaries.append(summary)

    return summaries


def resolve_tempo_motion_profile(
    default_entries: list[dict],
    section_context: dict | None,
    measure_number: int | None,
) -> dict[str, float] | None:
    if measure_number is None:
        return None

    combined_entries: list[tuple[dict, tuple[int, int]]] = []
    for entry in default_entries:
        resolved_window = resolve_tempo_motion_window(entry, None)
        if resolved_window is not None:
            combined_entries.append((entry, resolved_window))

    for entry in extract_tempo_motion_list((section_context or {}).get("tempoMotion")):
        resolved_window = resolve_tempo_motion_window(entry, section_context)
        if resolved_window is not None:
            combined_entries.append((entry, resolved_window))

    if not combined_entries:
        return None

    combined_entries.sort(key=lambda item: (item[1][0], item[1][1]))
    bias = 0.0
    stability = 0.0

    for entry, (start_measure, end_measure) in combined_entries:
        if measure_number < start_measure:
            continue

        span = max(1, end_measure - start_measure + 1)
        progress = clamp((measure_number - start_measure + 1) / float(span), 0.0, 1.0)
        tag = str(entry.get("tag") or "").strip().lower()
        intensity = float(entry.get("intensity") or default_tempo_motion_intensity(tag))

        if tag in {"ritardando", "rallentando"}:
            bias += intensity * 0.12 * progress
            stability += intensity * 0.02 * progress
        elif tag == "allargando":
            bias += intensity * 0.16 * progress
            stability += intensity * 0.03 * progress
        elif tag in {"accelerando", "stringendo"}:
            bias -= intensity * 0.10 * progress
            stability -= intensity * 0.02 * progress
        elif tag == "ritenuto":
            bias += intensity * (0.08 + progress * 0.10)
            stability += intensity * 0.025
        elif tag in {"a_tempo", "tempo_l_istesso"}:
            reset = clamp(max(progress, 0.35) * intensity, 0.0, 1.0)
            bias *= 1.0 - reset
            stability *= 1.0 - min(reset * 0.9, 0.9)

    if abs(bias) < 1e-6 and abs(stability) < 1e-6:
        return None

    return {
        "durationScale": clamp(1.0 + bias, 0.78, 1.28),
        "timingJitterScale": clamp(1.0 - bias * 0.45 - stability * 0.4, 0.82, 1.18),
        "endingStretchScale": clamp(
            1.0 + max(bias, 0.0) * 0.55 - max(-bias, 0.0) * 0.20,
            0.86,
            1.34,
        ),
    }


def resolve_ornament_profile(
    matching_entries: list[tuple[dict, tuple[int, int]]],
) -> dict[str, float] | None:
    profiles: list[dict[str, float]] = []

    for entry, _resolved_window in matching_entries:
        if str(entry.get("tag") or "").strip().lower() != "fermata":
            continue
        intensity = clamp(float(entry.get("intensity") or 0.75), 0.0, 1.0)
        profiles.append(
            {
                "durationScale": clamp(1.08 + intensity * 0.42, 1.08, 1.55),
                "timingJitterScale": clamp(0.88 - intensity * 0.26, 0.52, 0.9),
                "endingStretchScale": clamp(1.06 + intensity * 0.6, 1.06, 1.72),
            }
        )

    return combine_timing_profiles(*profiles)


def resolve_arpeggio_profile(
    matching_entries: list[tuple[dict, tuple[int, int]]],
    note_count: int,
) -> dict[str, float] | None:
    if note_count < 2:
        return None

    intensities: list[float] = []
    for entry, _resolved_window in matching_entries:
        if str(entry.get("tag") or "").strip().lower() != "arpeggio":
            continue
        intensities.append(clamp(float(entry.get("intensity") or 0.75), 0.0, 1.0))

    average_intensity = average(intensities)
    if average_intensity is None:
        return None

    onset_step = clamp(0.0625 + average_intensity * 0.0625, 0.0625, 0.125)
    onset_spread = clamp(onset_step * max(note_count - 1, 1), 0.0938, 0.25)

    return {
        "perNoteOffsetBeats": round(onset_spread / max(note_count - 1, 1), 4),
        "onsetSpreadBeats": round(onset_spread, 4),
    }


def resolve_grace_note_profile(
    matching_entries: list[tuple[dict, tuple[int, int]]],
    note_duration: float,
) -> dict[str, float] | None:
    if note_duration <= 0.1875:
        return None

    intensities: list[float] = []
    for entry, _resolved_window in matching_entries:
        if str(entry.get("tag") or "").strip().lower() != "grace_note":
            continue
        intensities.append(clamp(float(entry.get("intensity") or 0.75), 0.0, 1.0))

    average_intensity = average(intensities)
    if average_intensity is None:
        return None

    lead_in_limit = min(0.125, max(note_duration - 0.125, 0.0))
    if lead_in_limit < 0.0625:
        return None

    lead_in_beats = round(
        clamp(0.0625 + average_intensity * 0.03125, 0.0625, lead_in_limit),
        4,
    )
    return {
        "graceLeadInBeats": lead_in_beats,
        "graceDurationBeats": lead_in_beats,
        "graceVelocityScale": round(clamp(0.8 + average_intensity * 0.06, 0.8, 0.9), 4),
    }


def resolve_trill_profile(
    matching_entries: list[tuple[dict, tuple[int, int]]],
    note_duration: float,
) -> dict[str, float] | None:
    if note_duration < 0.5:
        return None

    intensities: list[float] = []
    for entry, _resolved_window in matching_entries:
        if str(entry.get("tag") or "").strip().lower() != "trill":
            continue
        intensities.append(clamp(float(entry.get("intensity") or 0.75), 0.0, 1.0))

    average_intensity = average(intensities)
    if average_intensity is None:
        return None

    maximum_oscillation_count = max(1, int(note_duration / 0.125))
    if maximum_oscillation_count < 4:
        return None

    oscillation_count = int(
        clamp(
            float(round(4 + average_intensity * 2)),
            4.0,
            float(maximum_oscillation_count),
        )
    )
    sub_note_duration = round(note_duration / float(oscillation_count), 4)
    if sub_note_duration < 0.0625:
        return None

    trill_span = round(sub_note_duration * max(oscillation_count - 1, 1), 4)
    return {
        "trillOscillationCount": float(oscillation_count),
        "trillSubNoteDurationBeats": sub_note_duration,
        "trillSpanBeats": trill_span,
        "trillVelocityScale": round(
            clamp(0.92 + average_intensity * 0.04, 0.92, 0.96), 4
        ),
        "trillNeighborVelocityScale": round(
            clamp(0.84 + average_intensity * 0.08, 0.84, 0.92),
            4,
        ),
    }


def resolve_grace_neighbor_midi(target_pitch: int) -> int:
    if target_pitch <= 36:
        return min(127, target_pitch + 1)
    if target_pitch >= 108:
        return max(0, target_pitch - 1)
    return target_pitch - 1


def resolve_trill_neighbor_midi(target_pitch: int) -> int:
    if target_pitch >= 108:
        return max(0, target_pitch - 1)
    return min(127, target_pitch + 1)


def realize_grace_note_event(
    el: note.Note,
    part: stream.Part,
    position: float,
    total_length: float,
    part_profile: dict[str, float],
    grace_profile: dict[str, float] | None,
) -> tuple[note.Note, float] | None:
    if grace_profile is None:
        return None

    parent_stream = el.activeSite if isinstance(el.activeSite, stream.Stream) else part
    original_offset = float(el.offset)
    original_duration = float(el.quarterLength)
    grace_duration = clamp(
        float(grace_profile.get("graceDurationBeats", 0.0)),
        0.0625,
        0.1875,
    )
    if original_duration <= grace_duration + 0.0625:
        return None

    target_note = copy.deepcopy(el)
    target_note.duration = copy.deepcopy(el.duration)
    target_note.quarterLength = round(
        max(original_duration - grace_duration, 0.0625), 4
    )
    if target_note.volume.velocity is None:
        target_note.volume.velocity = el.volume.velocity if el.volume.velocity else 80

    grace_note = copy.deepcopy(el)
    grace_note.duration = copy.deepcopy(el.duration)
    grace_note.quarterLength = round(grace_duration, 4)
    grace_note.pitch.midi = resolve_grace_neighbor_midi(int(el.pitch.midi))
    base_velocity = grace_note.volume.velocity if grace_note.volume.velocity else 80
    grace_note.volume.velocity = max(
        1,
        min(
            127,
            int(
                round(
                    base_velocity * float(grace_profile.get("graceVelocityScale", 0.84))
                )
            ),
        ),
    )

    parent_stream.remove(el)
    parent_stream.insert(original_offset, grace_note)
    parent_stream.insert(original_offset + grace_duration, target_note)
    humanize_velocity(
        grace_note,
        max(position - grace_duration, 0.0),
        total_length,
        part_profile,
    )

    return target_note, position + grace_duration


def realize_trill_event(
    el: note.Note,
    part: stream.Part,
    position: float,
    total_length: float,
    part_profile: dict[str, float],
    timing_profile: dict[str, float] | None,
    trill_profile: dict[str, float] | None,
) -> list[tuple[note.Note, float]] | None:
    if trill_profile is None:
        return None

    oscillation_count = int(trill_profile.get("trillOscillationCount") or 0)
    sub_note_duration = float(trill_profile.get("trillSubNoteDurationBeats") or 0.0)
    if oscillation_count < 4 or sub_note_duration < 0.0625:
        return None

    parent_stream = el.activeSite if isinstance(el.activeSite, stream.Stream) else part
    original_offset = float(el.offset)
    original_duration = float(el.quarterLength)
    if original_duration < 0.0625 * float(oscillation_count):
        return None

    target_pitch = int(el.pitch.midi)
    neighbor_pitch = resolve_trill_neighbor_midi(target_pitch)
    base_velocity = el.volume.velocity if el.volume.velocity else 80
    realized_notes: list[tuple[note.Note, float]] = []

    parent_stream.remove(el)
    for index in range(oscillation_count):
        trill_note = copy.deepcopy(el)
        trill_note.duration = copy.deepcopy(el.duration)
        remaining_duration = max(
            original_duration - (sub_note_duration * float(index)),
            0.0625,
        )
        note_duration = (
            round(remaining_duration, 4)
            if index == oscillation_count - 1
            else round(sub_note_duration, 4)
        )
        if note_duration < 0.0625:
            note_duration = 0.0625

        trill_note.quarterLength = note_duration
        trill_note.pitch.midi = target_pitch if index % 2 == 0 else neighbor_pitch
        velocity_scale = float(
            trill_profile.get(
                "trillVelocityScale"
                if index % 2 == 0
                else "trillNeighborVelocityScale",
                0.9,
            )
        )
        trill_note.volume.velocity = max(
            1,
            min(127, int(round(base_velocity * velocity_scale))),
        )

        insert_offset = round(original_offset + (sub_note_duration * float(index)), 4)
        event_position = position + (sub_note_duration * float(index))
        parent_stream.insert(insert_offset, trill_note)
        humanize_velocity(trill_note, event_position, total_length, part_profile)
        humanize_timing(
            trill_note,
            event_position,
            total_length,
            part_profile,
            timing_profile,
        )
        realized_notes.append((trill_note, event_position))

    return realized_notes


def combine_event_profiles(
    *profiles: dict[str, float] | None,
) -> dict[str, float] | None:
    merged: dict[str, float] = {}
    for profile in profiles:
        if isinstance(profile, dict):
            merged.update(profile)

    return merged or None


def combine_timing_profiles(
    *profiles: dict[str, float] | None,
) -> dict[str, float] | None:
    active_profiles = [profile for profile in profiles if isinstance(profile, dict)]
    if not active_profiles:
        return None

    duration_scale = 1.0
    timing_jitter_scale = 1.0
    ending_stretch_scale = 1.0
    for profile in active_profiles:
        duration_scale *= float(profile.get("durationScale", 1.0))
        timing_jitter_scale *= float(profile.get("timingJitterScale", 1.0))
        ending_stretch_scale *= float(profile.get("endingStretchScale", 1.0))

    return {
        "durationScale": clamp(duration_scale, 0.74, 1.72),
        "timingJitterScale": clamp(timing_jitter_scale, 0.48, 1.18),
        "endingStretchScale": clamp(ending_stretch_scale, 0.84, 1.86),
    }


def apply_role_profile(
    style_profile: dict[str, float], role: str, counterpoint_mode: str
) -> dict[str, float]:
    profile = dict(style_profile)
    overrides = ROLE_PROFILE_OVERRIDES.get(role, {})

    profile["downbeat_boost"] = clamp(
        profile["downbeat_boost"] * float(overrides.get("downbeat_scale", 1.0)),
        1.0,
        1.24,
    )
    profile["velocity_scale"] = clamp(
        profile["velocity_scale"] * float(overrides.get("velocity_scale", 1.0)),
        0.72,
        1.22,
    )
    profile["duration_scale"] = clamp(
        profile["duration_scale"] * float(overrides.get("duration_scale", 1.0)),
        0.72,
        1.2,
    )
    profile["timing_jitter"] = clamp(
        profile["timing_jitter"] * float(overrides.get("timing_jitter_scale", 1.0)),
        0.002,
        0.03,
    )
    profile["velocity_jitter"] = clamp(
        profile["velocity_jitter"] * float(overrides.get("velocity_jitter_scale", 1.0)),
        1.0,
        12.0,
    )
    profile["repeat_jitter_low"] = int(
        round(
            clamp(
                profile["repeat_jitter_low"]
                * float(overrides.get("repeat_jitter_scale", 1.0)),
                -16,
                -1,
            )
        )
    )
    profile["repeat_jitter_high"] = int(
        round(
            clamp(
                profile["repeat_jitter_high"]
                * float(overrides.get("repeat_jitter_scale", 1.0)),
                1,
                8,
            )
        )
    )

    if role in {"counterline", "inner_voice"} and counterpoint_mode in {
        "imitative",
        "contrary_motion",
        "free",
    }:
        profile["velocity_scale"] = clamp(profile["velocity_scale"] * 1.04, 0.72, 1.22)
        profile["duration_scale"] = clamp(profile["duration_scale"] * 1.04, 0.72, 1.2)
        profile["timing_jitter"] = clamp(profile["timing_jitter"] * 0.96, 0.002, 0.03)

    return profile


def apply_expression_profile(
    style_profile: dict[str, float], expression_plan: dict | None
) -> dict[str, float]:
    entries = extract_expression_entries(expression_plan)
    if not entries:
        return dict(style_profile)

    profile = dict(style_profile)
    dynamic_values: list[float] = []
    sustain_values: list[float] = []
    accent_values: list[float] = []
    articulation_profile_weights = {
        "legato": {"legato": 1.0},
        "staccato": {"staccato": 1.0},
        "staccatissimo": {"staccato": 1.45, "accent": 0.2},
        "tenuto": {"legato": 0.9, "accent": 0.45},
        "sostenuto": {"legato": 1.35},
        "accent": {"accent": 1.0},
        "marcato": {"accent": 1.5, "staccato": 0.45},
    }
    character_profile_weights = {
        "dolce": {"calm": 1.0},
        "dolcissimo": {"calm": 1.4},
        "espressivo": {"calm": 0.7},
        "cantabile": {"calm": 0.9},
        "agitato": {"agitated": 1.0},
        "tranquillo": {"calm": 1.3},
        "energico": {"agitated": 0.9},
        "grazioso": {"calm": 0.7},
        "brillante": {"agitated": 0.7},
        "giocoso": {"agitated": 0.35, "calm": 0.1},
        "leggiero": {"agitated": 0.25, "calm": 0.35},
        "maestoso": {"agitated": 0.45, "calm": 0.25},
        "scherzando": {"agitated": 0.45},
        "pastorale": {"calm": 1.0},
        "tempestoso": {"agitated": 1.35},
        "appassionato": {"agitated": 1.0},
        "delicato": {"calm": 0.9},
    }
    legato_weight = 0.0
    staccato_weight = 0.0
    accent_tag_weight = 0.0
    calm_character_weight = 0.0
    agitated_character_weight = 0.0

    for expression in entries:
        dynamics = expression.get("dynamics")
        if isinstance(dynamics, dict):
            ranks = [
                dynamic_rank(dynamics.get("start")),
                dynamic_rank(dynamics.get("peak")),
                dynamic_rank(dynamics.get("end")),
            ]
            valid_ranks = [rank / 5 for rank in ranks if rank is not None]
            if valid_ranks:
                dynamic_values.append(sum(valid_ranks) / len(valid_ranks))

        sustain_bias = expression.get("sustainBias")
        if isinstance(sustain_bias, (int, float)):
            sustain_values.append(float(sustain_bias))

        accent_bias = expression.get("accentBias")
        if isinstance(accent_bias, (int, float)):
            accent_values.append(float(accent_bias))

        for tag in expression.get("articulation", []):
            if not isinstance(tag, str):
                continue
            normalized = tag.strip().lower()
            weights = articulation_profile_weights.get(normalized)
            if not weights:
                continue
            legato_weight += float(weights.get("legato") or 0.0)
            staccato_weight += float(weights.get("staccato") or 0.0)
            accent_tag_weight += float(weights.get("accent") or 0.0)

        for tag in expression.get("character", []):
            if not isinstance(tag, str):
                continue
            normalized = tag.strip().lower()
            weights = character_profile_weights.get(normalized)
            if not weights:
                continue
            calm_character_weight += float(weights.get("calm") or 0.0)
            agitated_character_weight += float(weights.get("agitated") or 0.0)

    dynamic_intensity_average = average(dynamic_values)
    dynamic_intensity = (
        dynamic_intensity_average if dynamic_intensity_average is not None else 0.45
    )
    sustain_bias_average = average(sustain_values)
    sustain_bias = sustain_bias_average if sustain_bias_average is not None else 0.0
    accent_bias_average = average(accent_values)
    accent_bias = accent_bias_average if accent_bias_average is not None else 0.0

    profile["downbeat_boost"] = clamp(
        profile["downbeat_boost"]
        * (
            1.0
            + (dynamic_intensity - 0.45) * 0.18
            + max(accent_bias, 0.0) * 0.12
            + accent_tag_weight * 0.015
        ),
        1.0,
        1.22,
    )
    profile["velocity_jitter"] = clamp(
        profile["velocity_jitter"]
        * (
            0.92
            + dynamic_intensity * 0.3
            + agitated_character_weight * 0.04
            - calm_character_weight * 0.02
        ),
        1.0,
        12.0,
    )
    profile["velocity_scale"] = clamp(
        profile["velocity_scale"]
        * (
            0.94
            + dynamic_intensity * 0.12
            + accent_tag_weight * 0.02
            + agitated_character_weight * 0.02
            - calm_character_weight * 0.01
            + max(accent_bias, 0.0) * 0.08
            - max(-accent_bias, 0.0) * 0.05
        ),
        0.72,
        1.22,
    )
    profile["duration_scale"] = clamp(
        profile["duration_scale"]
        * (
            0.98
            + max(sustain_bias, 0.0) * 0.18
            - max(-sustain_bias, 0.0) * 0.12
            + max(legato_weight - staccato_weight, 0) * 0.03
            - max(staccato_weight - legato_weight, 0) * 0.04
        ),
        0.72,
        1.2,
    )
    profile["fade_amount"] = clamp(
        profile["fade_amount"] * (0.92 + dynamic_intensity * 0.22),
        0.08,
        0.4,
    )
    profile["timing_jitter"] = clamp(
        profile["timing_jitter"]
        * (
            1.0
            + staccato_weight * 0.05
            + agitated_character_weight * 0.04
            - legato_weight * 0.03
            - max(sustain_bias, 0.0) * 0.16
        ),
        0.002,
        0.03,
    )

    stretch_boost = (
        max(sustain_bias, 0.0) * 0.35 + max(legato_weight - staccato_weight, 0) * 0.03
    )
    if calm_character_weight > agitated_character_weight:
        stretch_boost += 0.04
    if (
        staccato_weight > legato_weight
        or agitated_character_weight > calm_character_weight
    ):
        stretch_boost -= 0.03

    profile["ending_stretch_min"] = clamp(
        profile["ending_stretch_min"] * (1.0 + stretch_boost),
        0.008,
        0.12,
    )
    profile["ending_stretch_max"] = clamp(
        profile["ending_stretch_max"]
        * (1.0 + stretch_boost + max(sustain_bias, 0.0) * 0.12),
        profile["ending_stretch_min"] + 0.005,
        0.18,
    )
    profile["repeat_jitter_low"] = int(
        round(
            clamp(
                profile["repeat_jitter_low"]
                * (1.0 + dynamic_intensity * 0.16 + agitated_character_weight * 0.06),
                -16,
                -1,
            )
        )
    )
    profile["repeat_jitter_high"] = int(
        round(
            clamp(
                profile["repeat_jitter_high"]
                * (0.95 + dynamic_intensity * 0.14 + max(accent_bias, 0.0) * 0.12),
                1,
                8,
            )
        )
    )

    phrase_functions: list[str] = []
    voice_counts: list[float] = []
    primary_roles: set[str] = set()
    counterpoint_modes: set[str] = set()

    for entry in extract_phrase_texture_entries(expression_plan):
        phrase_function = str(entry.get("phraseFunction") or "").strip().lower()
        if phrase_function in PHRASE_FUNCTIONS:
            phrase_functions.append(phrase_function)

        texture = entry.get("texture")
        if not isinstance(texture, dict):
            continue

        voice_count = texture.get("voiceCount")
        if isinstance(voice_count, (int, float)) and float(voice_count) > 0:
            voice_counts.append(float(voice_count))

        counterpoint_mode = (
            str(texture.get("counterpointMode") or "").strip().lower().replace(" ", "_")
        )
        if counterpoint_mode in COUNTERPOINT_MODES:
            counterpoint_modes.add(counterpoint_mode)

        for role in texture.get("primaryRoles", []):
            normalized_role = str(role or "").strip().lower()
            if normalized_role in TEXTURE_ROLES:
                primary_roles.add(normalized_role)

    if voice_counts or primary_roles or counterpoint_modes:
        average_voice_count_value = average(voice_counts)
        average_voice_count = (
            average_voice_count_value if average_voice_count_value is not None else 2.0
        )
        polyphonic_texture = (
            average_voice_count >= 3.0
            or "inner_voice" in primary_roles
            or "counterline" in primary_roles
        )

        if polyphonic_texture:
            profile["downbeat_boost"] = clamp(
                profile["downbeat_boost"] * 0.98,
                1.0,
                1.22,
            )
            profile["timing_jitter"] = clamp(
                profile["timing_jitter"] * 0.94,
                0.002,
                0.03,
            )
            profile["repeat_jitter_low"] = int(
                round(clamp(profile["repeat_jitter_low"] * 0.92, -16, -1))
            )
            profile["repeat_jitter_high"] = int(
                round(clamp(profile["repeat_jitter_high"] * 0.92, 1, 8))
            )

        if counterpoint_modes.intersection({"imitative", "contrary_motion", "free"}):
            profile["timing_jitter"] = clamp(
                profile["timing_jitter"] * 0.93,
                0.002,
                0.03,
            )
            profile["velocity_jitter"] = clamp(
                profile["velocity_jitter"] * 0.96,
                1.0,
                12.0,
            )

    if phrase_functions:
        if "presentation" in phrase_functions:
            profile["downbeat_boost"] = clamp(
                profile["downbeat_boost"] * 1.02,
                1.0,
                1.22,
            )
            profile["timing_jitter"] = clamp(
                profile["timing_jitter"] * 0.97,
                0.002,
                0.03,
            )

        if "cadential" in phrase_functions:
            profile["ending_stretch_min"] = clamp(
                profile["ending_stretch_min"] * 1.12,
                0.008,
                0.12,
            )
            profile["ending_stretch_max"] = clamp(
                profile["ending_stretch_max"] * 1.12,
                profile["ending_stretch_min"] + 0.005,
                0.18,
            )
            profile["fade_amount"] = clamp(
                profile["fade_amount"] * 1.05,
                0.08,
                0.4,
            )

        forward_pressure = sum(
            1
            for phrase_function in phrase_functions
            if phrase_function in {"continuation", "transition", "developmental"}
        )
        if forward_pressure > 0:
            timing_multiplier = 1.0 + min(forward_pressure * 0.03, 0.12)
            velocity_multiplier = 1.0 + min(forward_pressure * 0.02, 0.08)
            profile["timing_jitter"] = clamp(
                profile["timing_jitter"] * timing_multiplier,
                0.002,
                0.03,
            )
            profile["velocity_jitter"] = clamp(
                profile["velocity_jitter"] * velocity_multiplier,
                1.0,
                12.0,
            )

    return profile


def resolve_cached_part_profile(
    profile_cache: dict[tuple[str, str], dict[str, float]],
    section_key: str,
    role: str,
    base_profile: dict[str, float],
    counterpoint_mode: str,
    section_context: dict | None,
) -> dict[str, float]:
    cache_key = (section_key, role)
    part_profile = profile_cache.get(cache_key)
    if part_profile is None:
        part_profile = apply_role_profile(base_profile, role, counterpoint_mode)
        section_plan = section_overlay_plan(section_context)
        if section_plan:
            part_profile = apply_expression_profile(part_profile, section_plan)
        profile_cache[cache_key] = part_profile
    return part_profile


def humanize_velocity(
    el: note.Note | chord.Chord,
    position: float,
    total_length: float,
    style_profile: dict[str, float],
) -> bool:
    """
    위치 기반 velocity 인간화:
    - 첫 박(downbeat) 근처: velocity 약간 강조
    - 프레이즈 끝(곡 후반 10%): velocity 감소
    - 동일 음 여부와 무관하게 ±5 정도의 랜덤 요동 추가
    """
    modified = False
    v = el.volume.velocity if el.volume.velocity else 80

    # 마디 내 위치 기반: 첫 박 강조
    beat_pos = position % 4.0
    if beat_pos < 0.1:  # 첫 박
        v = min(127, int(v * style_profile["downbeat_boost"]))
        modified = True

    # 곡 후반부 (마지막 15%): 점진적 velocity 감소
    if total_length > 0 and position / total_length > 0.85:
        fade_ratio = (position / total_length - 0.85) / 0.15  # 0→1
        v = max(30, int(v * (1.0 - fade_ratio * style_profile["fade_amount"])))
        modified = True

    v = int(round(v * style_profile.get("velocity_scale", 1.0)))
    v = max(1, min(127, v))
    modified = True

    jitter = int(style_profile["velocity_jitter"])
    v = max(1, min(127, v + random.randint(-jitter, jitter)))
    modified = True

    el.volume.velocity = v
    return modified


def humanize_timing(
    el: note.Note | chord.Chord,
    position: float,
    total_length: float,
    style_profile: dict[str, float],
    timing_profile: dict[str, float] | None = None,
) -> bool:
    """
    미세한 타이밍 변화:
    - 프레이즈 끝에서 약간의 리타르단도 효과 (음표 길이 미세 연장)
    - 일반 위치: ±2% 이내의 미세한 타이밍 흔들림
    """
    modified = False
    ql = el.quarterLength
    timing_jitter = clamp(
        style_profile["timing_jitter"]
        * float((timing_profile or {}).get("timingJitterScale", 1.0)),
        0.002,
        0.03,
    )
    ending_stretch_min = clamp(
        style_profile["ending_stretch_min"]
        * float((timing_profile or {}).get("endingStretchScale", 1.0)),
        0.008,
        0.12,
    )
    ending_stretch_max = clamp(
        style_profile["ending_stretch_max"]
        * float((timing_profile or {}).get("endingStretchScale", 1.0)),
        ending_stretch_min + 0.005,
        0.18,
    )

    # 프레이즈 끝 근처 (마지막 10%): 미세하게 늘리기 (리타르단도)
    if total_length > 0 and position / total_length > 0.90:
        stretch = 1.0 + random.uniform(
            ending_stretch_min,
            ending_stretch_max,
        )
        el.quarterLength = round(ql * stretch, 4)
        modified = True
    else:
        jitter = random.uniform(-timing_jitter, timing_jitter)
        new_ql = round(ql * (1.0 + jitter), 4)
        if new_ql > 0.0625:  # 최소 64분음표
            el.quarterLength = new_ql
            modified = True

    scaled_ql = round(
        el.quarterLength
        * style_profile.get("duration_scale", 1.0)
        * float((timing_profile or {}).get("durationScale", 1.0)),
        4,
    )
    if scaled_ql > 0.0625:
        el.quarterLength = scaled_ql
        modified = True

    return modified


def humanize_chord_subvoices(
    el: chord.Chord,
    part: stream.Part,
    position: float,
    total_length: float,
    part_index: int,
    part_count: int,
    part_role: str,
    register_summary: dict[str, float],
    section_key: str,
    counterpoint_mode: str,
    section_context: dict | None,
    base_profile: dict[str, float],
    profile_cache: dict[tuple[str, str], dict[str, float]],
    timing_profile: dict[str, float] | None,
    arpeggio_profile: dict[str, float] | None,
) -> int:
    note_roles = resolve_chord_note_roles(
        el,
        part_index,
        part_count,
        part_role,
        register_summary,
    )
    if not note_roles:
        return 0

    if len(set(note_roles)) == 1 and arpeggio_profile is None:
        part_profile = resolve_cached_part_profile(
            profile_cache,
            section_key,
            note_roles[0],
            base_profile,
            counterpoint_mode,
            section_context,
        )
        velocity_modified = humanize_velocity(el, position, total_length, part_profile)
        timing_modified = humanize_timing(
            el,
            position,
            total_length,
            part_profile,
            timing_profile,
        )
        return 1 if velocity_modified or timing_modified else 0

    parent_stream = el.activeSite if isinstance(el.activeSite, stream.Stream) else part
    chord_offset = float(el.offset)
    chord_duration = copy.deepcopy(el.duration)
    chord_velocity = el.volume.velocity if el.volume.velocity else 80
    chord_notes = list(el.notes)
    ordered_indices = sorted(
        range(len(chord_notes)),
        key=lambda index: int(chord_notes[index].pitch.midi),
    )
    onset_step = 0.03125
    onset_spread = 0.09375
    if isinstance(arpeggio_profile, dict):
        onset_step = max(
            onset_step,
            float(arpeggio_profile.get("perNoteOffsetBeats", onset_step)),
        )
        onset_spread = max(
            onset_spread,
            float(arpeggio_profile.get("onsetSpreadBeats", onset_spread)),
        )
    onset_offsets = {
        note_index: min(order_position * onset_step, onset_spread)
        for order_position, note_index in enumerate(ordered_indices)
    }

    parent_stream.remove(el)
    modified_count = 0
    for note_index, chord_note in enumerate(chord_notes):
        new_note = copy.deepcopy(chord_note)
        new_note.duration = copy.deepcopy(chord_duration)
        if new_note.volume.velocity is None:
            new_note.volume.velocity = chord_velocity

        role = note_roles[note_index]
        part_profile = resolve_cached_part_profile(
            profile_cache,
            section_key,
            role,
            base_profile,
            counterpoint_mode,
            section_context,
        )
        note_position = position + onset_offsets.get(note_index, 0.0)
        velocity_modified = humanize_velocity(
            new_note,
            note_position,
            total_length,
            part_profile,
        )
        timing_modified = humanize_timing(
            new_note,
            note_position,
            total_length,
            part_profile,
            timing_profile,
        )
        parent_stream.insert(
            chord_offset + onset_offsets.get(note_index, 0.0), new_note
        )
        if velocity_modified or timing_modified or arpeggio_profile is not None:
            modified_count += 1

    return modified_count


def apply_repeated_note_variation(
    part: stream.Part, style_profile: dict[str, float]
) -> int:
    """
    동일 음이 연속될 때 velocity에 변화를 준다.
    연속 2번째부터 velocity를 ±8 범위로 흔든다.
    """
    modified_count = 0
    prev_pitch: int | None = None

    for el in part.recurse().getElementsByClass(note.Note):
        if prev_pitch is not None and el.pitch.midi == prev_pitch:
            v = el.volume.velocity if el.volume.velocity else 80
            v = max(
                1,
                min(
                    127,
                    v
                    + random.randint(
                        int(style_profile["repeat_jitter_low"]),
                        int(style_profile["repeat_jitter_high"]),
                    ),
                ),
            )
            el.volume.velocity = v
            modified_count += 1
        prev_pitch = el.pitch.midi

    return modified_count


def humanize_score(
    score: stream.Score,
    style_profile: dict[str, float],
    expression_plan: dict | None,
    section_plans: list[dict] | None = None,
) -> tuple[
    int,
    list[dict[str, object]],
    list[dict[str, object]],
    list[dict[str, object]],
    list[dict[str, object]],
]:
    """전체 스코어에 인간화를 적용한다. 수정된 노트 수를 반환."""
    total_modified = 0
    part_summaries = score_part_summaries(score)
    part_register_summaries = score_part_register_summaries(score)
    part_count = len(part_summaries)
    expression_defaults = default_only_expression_plan(expression_plan)
    base_profile = (
        apply_expression_profile(style_profile, expression_defaults)
        if expression_defaults
        else dict(style_profile)
    )
    texture_defaults = (
        expression_plan.get("textureDefaults")
        if isinstance(expression_plan, dict)
        else None
    )
    default_tempo_motion = default_tempo_motion_entries(expression_plan)
    default_ornaments = default_ornament_entries(expression_plan)
    default_counterpoint_mode = counterpoint_mode_from_guidance(texture_defaults)
    default_roles = resolve_part_roles_for_texture(part_summaries, texture_defaults)
    section_contexts = extract_section_contexts(expression_plan, section_plans)
    section_phrase_breath_trackers = initialize_section_phrase_breath_trackers(
        section_contexts
    )
    section_harmonic_realization_trackers = (
        initialize_section_harmonic_realization_trackers(section_contexts)
    )
    section_tempo_motion_trackers = initialize_section_tempo_motion_trackers(
        default_tempo_motion, section_contexts
    )
    section_ornament_trackers = initialize_section_ornament_trackers(
        default_ornaments, section_contexts
    )
    section_roles = {
        str(context.get("sectionId") or ""): resolve_part_roles_for_texture(
            part_summaries,
            context.get("texture")
            if isinstance(context.get("texture"), dict)
            else None,
        )
        for context in section_contexts
        if isinstance(context.get("texture"), dict)
    }

    for part_index, part in enumerate(score.parts):
        # 파트 전체 길이 계산
        total_length = float(part.duration.quarterLength)
        if total_length == 0:
            continue

        default_role = (
            default_roles[part_index] if part_index < len(default_roles) else "lead"
        )
        last_measure_number: int | None = None
        profile_cache: dict[tuple[str, str], dict[str, float]] = {}

        # velocity + timing 인간화
        offset = 0.0
        register_summary = (
            part_register_summaries[part_index]
            if part_index < len(part_register_summaries)
            else {"averagePitch": 60.0, "lowBoundary": 48.0, "highBoundary": 64.0}
        )
        elements = list(part.recurse().getElementsByClass((note.Note, chord.Chord)))
        measure_last_beats: dict[int, float] = {}
        for current_element in elements:
            current_measure_number = normalized_measure_value(
                getattr(current_element, "measureNumber", None)
            )
            current_beat_value = normalized_beat_value(
                getattr(current_element, "beat", None)
            )
            if current_measure_number is None or current_beat_value is None:
                continue
            measure_last_beats[current_measure_number] = max(
                measure_last_beats.get(current_measure_number, current_beat_value),
                current_beat_value,
            )

        for el in elements:
            offset = float(el.offset) if el.offset is not None else offset
            measure_number = normalized_measure_value(
                getattr(el, "measureNumber", None)
            )
            if measure_number is None:
                measure_number = last_measure_number
            else:
                last_measure_number = measure_number

            section_context = section_context_for_measure(
                section_contexts, measure_number
            )
            tempo_motion_profile = resolve_tempo_motion_profile(
                default_tempo_motion,
                section_context,
                measure_number,
            )
            phrase_breath_profile = resolve_phrase_breath_profile(
                section_context,
                measure_number,
            )
            harmonic_plan_profile = resolve_harmonic_plan_profile(
                section_context,
                measure_number,
            )
            beat_value = normalized_beat_value(getattr(el, "beat", None))
            is_last_event_in_measure = (
                measure_number is not None
                and beat_value is not None
                and abs(
                    beat_value
                    - float(measure_last_beats.get(measure_number, beat_value))
                )
                <= 0.05
            )
            matching_ornament_entries = resolve_matching_ornament_entries(
                default_ornaments,
                section_context,
                measure_number,
                beat_value,
                is_last_event_in_measure,
                allow_arpeggio=isinstance(el, chord.Chord),
                allow_grace_note=isinstance(el, note.Note),
                allow_trill=isinstance(el, note.Note),
            )
            fermata_entries = filter_matching_ornament_entries_by_tag(
                matching_ornament_entries,
                "fermata",
            )
            ornament_profile = resolve_ornament_profile(fermata_entries)
            timing_profile = combine_timing_profiles(
                tempo_motion_profile,
                phrase_breath_profile,
                harmonic_plan_profile,
                ornament_profile,
            )
            section_key = (
                str(section_context.get("sectionId") or "")
                if section_context
                else "__default__"
            )
            active_roles = section_roles.get(section_key, default_roles)
            part_role = (
                active_roles[part_index]
                if part_index < len(active_roles)
                else default_role
            )
            counterpoint_mode = (
                counterpoint_mode_from_guidance(section_context.get("texture"))
                if section_context and isinstance(section_context.get("texture"), dict)
                else default_counterpoint_mode
            )
            if isinstance(el, chord.Chord):
                arpeggio_entries = filter_matching_ornament_entries_by_tag(
                    matching_ornament_entries,
                    "arpeggio",
                )
                arpeggio_profile = resolve_arpeggio_profile(
                    arpeggio_entries,
                    len(el.notes),
                )
                applied_ornament_entries = list(fermata_entries)
                if arpeggio_profile is not None:
                    applied_ornament_entries.extend(arpeggio_entries)
                record_section_phrase_breath_realization(
                    section_phrase_breath_trackers,
                    section_context,
                    measure_number,
                    phrase_breath_profile,
                    len(el.notes),
                )
                record_section_harmonic_realization(
                    section_harmonic_realization_trackers,
                    section_context,
                    measure_number,
                    harmonic_plan_profile,
                    len(el.notes),
                )
                record_section_tempo_motion_realization(
                    section_tempo_motion_trackers,
                    section_context,
                    measure_number,
                    tempo_motion_profile,
                    len(el.notes),
                )
                record_section_ornament_realization(
                    section_ornament_trackers,
                    section_context,
                    applied_ornament_entries,
                    measure_number,
                    combine_event_profiles(ornament_profile, arpeggio_profile),
                    len(el.notes),
                )
                total_modified += humanize_chord_subvoices(
                    el,
                    part,
                    offset,
                    total_length,
                    part_index,
                    part_count,
                    part_role,
                    register_summary,
                    section_key,
                    counterpoint_mode,
                    section_context,
                    base_profile,
                    profile_cache,
                    timing_profile,
                    arpeggio_profile,
                )
                continue

            role = resolve_event_role(
                el,
                part_index,
                part_count,
                part_role,
                register_summary,
            )
            part_profile = resolve_cached_part_profile(
                profile_cache,
                section_key,
                role,
                base_profile,
                counterpoint_mode,
                section_context,
            )
            trill_entries = filter_matching_ornament_entries_by_tag(
                matching_ornament_entries,
                "trill",
            )
            trill_profile = resolve_trill_profile(
                trill_entries,
                float(el.quarterLength),
            )
            trill_realization = realize_trill_event(
                el,
                part,
                offset,
                total_length,
                part_profile,
                timing_profile,
                trill_profile,
            )
            applied_ornament_entries = list(fermata_entries)
            extra_ornament_profile: dict[str, float] | None = None
            realized_event_count = 1
            grace_entries: list[tuple[dict, tuple[int, int]]] = []
            grace_profile: dict[str, float] | None = None
            grace_realization: tuple[note.Note, float] | None = None

            if trill_realization is not None:
                applied_ornament_entries.extend(trill_entries)
                extra_ornament_profile = trill_profile
                realized_event_count = len(trill_realization)
            else:
                grace_entries = filter_matching_ornament_entries_by_tag(
                    matching_ornament_entries,
                    "grace_note",
                )
                grace_profile = resolve_grace_note_profile(
                    grace_entries,
                    float(el.quarterLength),
                )
                grace_realization = realize_grace_note_event(
                    el,
                    part,
                    offset,
                    total_length,
                    part_profile,
                    grace_profile,
                )
            if grace_realization is not None:
                applied_ornament_entries.extend(grace_entries)
                extra_ornament_profile = grace_profile
                realized_event_count = 2

            if trill_realization is None:
                target_event = grace_realization[0] if grace_realization else el
                target_offset = grace_realization[1] if grace_realization else offset

                v_mod = humanize_velocity(
                    target_event,
                    target_offset,
                    total_length,
                    part_profile,
                )
                t_mod = humanize_timing(
                    target_event,
                    target_offset,
                    total_length,
                    part_profile,
                    timing_profile,
                )
            else:
                v_mod = True
                t_mod = True
            record_section_phrase_breath_realization(
                section_phrase_breath_trackers,
                section_context,
                measure_number,
                phrase_breath_profile,
                realized_event_count,
            )
            record_section_harmonic_realization(
                section_harmonic_realization_trackers,
                section_context,
                measure_number,
                harmonic_plan_profile,
                realized_event_count,
            )
            record_section_tempo_motion_realization(
                section_tempo_motion_trackers,
                section_context,
                measure_number,
                tempo_motion_profile,
                realized_event_count,
            )
            record_section_ornament_realization(
                section_ornament_trackers,
                section_context,
                applied_ornament_entries,
                measure_number,
                combine_event_profiles(
                    ornament_profile,
                    extra_ornament_profile,
                ),
                realized_event_count,
            )
            if (
                v_mod
                or t_mod
                or grace_realization is not None
                or trill_realization is not None
            ):
                total_modified += 1

        # 동일 음 반복 변화
        repeated_note_profile = profile_cache.get(("__default__", default_role))
        if repeated_note_profile is None:
            repeated_note_profile = apply_role_profile(
                base_profile, default_role, default_counterpoint_mode
            )
            profile_cache[("__default__", default_role)] = repeated_note_profile
        total_modified += apply_repeated_note_variation(part, repeated_note_profile)

    return (
        total_modified,
        summarize_section_phrase_breath_trackers(section_phrase_breath_trackers),
        summarize_section_harmonic_realization_trackers(
            section_harmonic_realization_trackers
        ),
        summarize_section_tempo_motion_trackers(section_tempo_motion_trackers),
        summarize_section_ornament_trackers(section_ornament_trackers),
    )


def main() -> None:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    input_path = req.get("inputPath", "")
    output_path = req.get("outputPath", "")
    style = str(req.get("style", "restrained") or "restrained").strip().lower()
    expression_plan = req.get("expressionPlan")
    section_plans = req.get("sections")
    style_profile = resolve_style_profile(style)

    if not input_path or not os.path.exists(input_path):
        print(json.dumps({"ok": False, "error": f"Input file not found: {input_path}"}))
        sys.exit(1)

    try:
        random.seed(
            int(req.get("seed"))
            if isinstance(req.get("seed"), (int, float))
            else resolve_request_seed(
                style,
                req.get("reflection"),
                expression_plan if isinstance(expression_plan, dict) else None,
                section_plans if isinstance(section_plans, list) else None,
                input_path,
            )
        )
        parsed_score = converter.parse(input_path)
        if isinstance(parsed_score, stream.Score):
            score = parsed_score
        elif isinstance(parsed_score, stream.Part):
            score = stream.Score()
            score.insert(0, parsed_score)
        elif isinstance(parsed_score, stream.Opus):
            score = stream.Score()
            for parsed_section in parsed_score.scores:
                for part in parsed_section.parts:
                    score.insert(len(score.parts), copy.deepcopy(part))
        else:
            score = stream.Score()
            score.insert(0, parsed_score)

        (
            notes_modified,
            section_phrase_breath,
            section_harmonic_realization,
            section_tempo_motion,
            section_ornaments,
        ) = humanize_score(
            score,
            style_profile,
            expression_plan if isinstance(expression_plan, dict) else None,
            section_plans if isinstance(section_plans, list) else None,
        )

        # 출력 디렉토리 확인
        out_dir = os.path.dirname(output_path)
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)

        mf = m21midi.translate.music21ObjectToMidiFile(score)
        mf.open(output_path, "wb")
        mf.write()
        mf.close()

        result = {
            "ok": True,
            "outputPath": output_path,
            "notesModified": notes_modified,
            "style": style,
            "expressionApplied": bool(
                extract_expression_entries(expression_plan)
                or extract_phrase_texture_entries(expression_plan)
                or extract_phrase_breath_entries(expression_plan)
                or default_tempo_motion_entries(expression_plan)
                or default_ornament_entries(expression_plan)
                or any(
                    context.get("phraseBreath")
                    for context in extract_section_contexts(expression_plan)
                )
                or any(
                    context.get("tempoMotion")
                    for context in extract_section_contexts(expression_plan)
                )
                or any(
                    context.get("ornaments")
                    for context in extract_section_contexts(expression_plan)
                )
                or any(
                    context.get("harmonicPlan")
                    for context in extract_section_contexts(
                        expression_plan if isinstance(expression_plan, dict) else None,
                        section_plans if isinstance(section_plans, list) else None,
                    )
                )
            ),
            **(
                {"sectionPhraseBreath": section_phrase_breath}
                if section_phrase_breath
                else {}
            ),
            **(
                {"sectionHarmonicRealization": section_harmonic_realization}
                if section_harmonic_realization
                else {}
            ),
            **(
                {"sectionTempoMotion": section_tempo_motion}
                if section_tempo_motion
                else {}
            ),
            **({"sectionOrnaments": section_ornaments} if section_ornaments else {}),
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
