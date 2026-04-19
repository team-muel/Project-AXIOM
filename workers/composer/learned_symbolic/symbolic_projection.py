from typing import Any, NotRequired, TypedDict, cast

from music21 import key as key_module

LEAD_RANGE = (62, 93)
COUNTERLINE_RANGE = (48, 81)
BASS_RANGE = (36, 67)
INSTRUMENT_MEASURE_KEYS = {
    "violin": "violinMeasures",
    "viola": "violaMeasures",
    "cello": "celloMeasures",
    "violoncello": "celloMeasures",
}

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
ROLE_ORDER = ("lead", "counterline", "bass")
EXPECTED_TRIO_ROLES = set(ROLE_ORDER)


class SectionMaterial(TypedDict):
    sectionId: str
    role: str
    measureCount: int
    tonalCenter: str
    phraseFunction: Any
    leadEvents: list[dict[str, Any]]
    supportEvents: list[dict[str, Any]]
    noteHistory: list[int]
    transform: NotRequired[dict[str, Any]]


class ProjectedSectionMaterial(SectionMaterial):
    violinMeasures: list[list[dict[str, Any]]]
    violaMeasures: list[list[dict[str, Any]]]
    celloMeasures: list[list[dict[str, Any]]]


class SymbolicProjectionResult(TypedDict):
    proposalSections: list[SectionMaterial]
    violinMeasures: list[list[dict[str, Any]]]
    violaMeasures: list[list[dict[str, Any]]]
    celloMeasures: list[list[dict[str, Any]]]
    totalMeasureCount: int
    totalNoteCount: int
    rewriteApplied: bool
    normalizationWarnings: list[str]


RhythmPatternEvent = tuple[str, float]


def as_record(value: Any) -> dict[str, Any] | None:
    return cast(dict[str, Any], value) if isinstance(value, dict) else None


def as_list(value: Any) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def normalize_name(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", " ")


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


def normalize_key_tonic(label: str) -> str:
    tonic = str(label or "").strip()
    if not tonic:
        return "C"

    parts = tonic.split()
    if len(parts) > 1 and parts[1].lower() in {"flat", "sharp"}:
        tonic = f"{parts[0]}{'b' if parts[1].lower() == 'flat' else '#'}"
    else:
        tonic = parts[0]

    tonic = tonic.replace("♭", "b").replace("♯", "#")
    lowered_tonic = tonic.lower()
    if lowered_tonic.endswith("-flat"):
        tonic = f"{tonic[:-5]}b"
    elif lowered_tonic.endswith("flat"):
        tonic = f"{tonic[:-4]}b"
    elif lowered_tonic.endswith("-sharp"):
        tonic = f"{tonic[:-6]}#"
    elif lowered_tonic.endswith("sharp"):
        tonic = f"{tonic[:-5]}#"

    return tonic[0].upper() + tonic[1:] if tonic else "C"


def parse_key_signature(label: str) -> key_module.Key:
    try:
        return key_module.Key(label)
    except Exception:
        parts = str(label or "").strip().split()
        tonic = normalize_key_tonic(
            " ".join(parts[:2])
            if len(parts) > 1 and parts[1].lower() in {"flat", "sharp"}
            else (parts[0] if parts else "C")
        )
        mode_index = (
            2 if len(parts) > 1 and parts[1].lower() in {"flat", "sharp"} else 1
        )
        mode = parts[mode_index].strip().lower() if len(parts) > mode_index else "major"
        return key_module.Key(tonic, mode or "major")


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
) -> ProjectedSectionMaterial | None:
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

    material: ProjectedSectionMaterial = {
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


def extract_orchestration_sections(
    payload: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    plan = as_record(payload.get("compositionPlan")) or {}
    orchestration = as_record(plan.get("orchestration")) or {}
    sections: dict[str, dict[str, Any]] = {}
    for raw_entry in as_list(orchestration.get("sections")):
        entry = as_record(raw_entry)
        if entry is None:
            continue
        section_id = str(entry.get("sectionId") or "").strip()
        if section_id:
            sections[section_id] = entry
    return sections


def normalize_instrument_key(value: Any, fallback: str) -> str:
    normalized = normalize_name(value)
    return normalized if normalized in INSTRUMENT_MEASURE_KEYS else fallback


def scale_pitch_near_target(
    local_key: key_module.Key, degree: int, target_midi: int
) -> int:
    normalized_degree = ((degree - 1) % 7) + 1
    octave_bias = (degree - 1) // 7
    closest_pitch: int | None = None
    closest_distance: int | None = None
    for octave in range(2, 7):
        pitch = local_key.pitchFromDegree(normalized_degree)
        if pitch is None:
            continue
        pitch.octave = octave + octave_bias
        midi_value = int(pitch.midi)
        distance = abs(midi_value - target_midi)
        if closest_distance is None or distance < closest_distance:
            closest_distance = distance
            closest_pitch = midi_value
    return closest_pitch if closest_pitch is not None else int(target_midi)


def build_pitch_cycle(
    local_key: key_module.Key, degrees: list[int], target_midi: int
) -> list[int]:
    cycle = [
        scale_pitch_near_target(local_key, degree, target_midi) for degree in degrees
    ]
    return cycle or [target_midi]


def is_cadential_role(role: str, phrase_function: Any) -> bool:
    return (
        role in {"cadence", "closing", "recap"}
        or normalize_name(phrase_function) == "cadential"
    )


def is_transition_role(role: str, phrase_function: Any) -> bool:
    return (
        role in {"bridge", "transition", "development"}
        or normalize_name(phrase_function) == "transition"
    )


def resolve_target_center(
    instrument_key: str,
    voice_role: str,
    conversation_mode: str,
    register_layout: str,
) -> int:
    if voice_role == "lead":
        if instrument_key == "viola":
            return 72 if conversation_mode == "conversational" else 70
        if instrument_key == "cello":
            return 55
        return 82 if register_layout == "layered" else 79

    if voice_role == "counterline":
        if instrument_key == "violin":
            return 76 if conversation_mode == "conversational" else 72
        if instrument_key == "cello":
            return 52
        return 60 if register_layout == "layered" else 63

    return 41 if register_layout == "wide" else 48


def resolve_degree_templates(
    role: str,
    phrase_function: Any,
    conversation_mode: str,
    counterpoint_mode: str,
) -> tuple[list[int], list[int], list[int]]:
    if is_cadential_role(role, phrase_function):
        if counterpoint_mode == "contrary_motion":
            return [5, 4, 2, 1, 7, 1], [2, 3, 2, 1, 7], [5, 2, 5, 1]
        return [5, 4, 2, 1, 7, 1], [3, 2, 7, 1, 2], [5, 2, 5, 1]
    if conversation_mode == "conversational" or is_transition_role(
        role, phrase_function
    ):
        if counterpoint_mode == "free":
            return [3, 5, 6, 5, 3, 2], [6, 4, 2, 5, 3, 7], [1, 5, 3, 6]
        return [3, 2, 5, 6, 5, 3], [5, 6, 4, 3, 2, 4], [1, 3, 5, 4]
    if counterpoint_mode == "contrary_motion":
        return [5, 3, 2, 1, 2], [2, 3, 4, 5, 6], [1, 5, 2, 5]
    return [5, 3, 2, 3, 1, 2], [3, 4, 2, 3, 5], [1, 5, 6, 5]


def resolve_voice_pattern(
    role: str,
    phrase_function: Any,
    conversation_mode: str,
    measure_index: int,
    measure_count: int,
    voice_role: str,
) -> list[RhythmPatternEvent]:
    is_final_measure = measure_index == measure_count - 1
    is_penultimate_measure = measure_index == max(0, measure_count - 2)

    if is_cadential_role(role, phrase_function):
        if voice_role == "lead":
            if is_final_measure:
                return [("note", 0.5), ("rest", 0.5), ("note", 3.0)]
            if is_penultimate_measure:
                return [("note", 1.0), ("rest", 1.0), ("note", 2.0)]
            return [("note", 1.5), ("rest", 0.5), ("note", 2.0)]

        if voice_role == "counterline":
            if is_final_measure:
                return [("rest", 1.0), ("note", 1.0), ("rest", 1.0), ("note", 1.0)]
            if is_penultimate_measure:
                return [("note", 1.0), ("rest", 1.0), ("note", 2.0)]
            return [("rest", 1.0), ("note", 1.0), ("note", 2.0)]

        if is_final_measure:
            return [("note", 2.0), ("note", 2.0)]
        if is_penultimate_measure:
            return [("note", 1.0), ("rest", 1.0), ("note", 2.0)]
        return [("note", 2.0), ("rest", 1.0), ("note", 1.0)]

    if conversation_mode == "conversational":
        if voice_role == "lead":
            return (
                [("note", 1.0), ("rest", 0.5), ("note", 1.0), ("note", 1.5)]
                if measure_index % 2 == 0
                else [("note", 1.5), ("note", 1.0), ("rest", 0.5), ("note", 1.0)]
            )
        if voice_role == "counterline":
            return (
                [
                    ("rest", 0.5),
                    ("note", 1.0),
                    ("note", 0.5),
                    ("rest", 1.0),
                    ("note", 1.0),
                ]
                if measure_index % 2 == 0
                else [
                    ("note", 1.0),
                    ("rest", 1.0),
                    ("note", 1.0),
                    ("rest", 0.5),
                    ("note", 0.5),
                ]
            )
        return (
            [("note", 1.5), ("rest", 0.5), ("note", 2.0)]
            if measure_index % 2 == 0
            else [("note", 2.0), ("rest", 1.0), ("note", 1.0)]
        )

    if is_final_measure:
        if voice_role == "lead":
            return [("note", 1.0), ("rest", 1.0), ("note", 2.0)]
        if voice_role == "counterline":
            return [("rest", 1.0), ("note", 1.0), ("note", 2.0)]
        return [("note", 2.0), ("rest", 1.0), ("note", 1.0)]

    if voice_role == "lead":
        return (
            [("note", 1.5), ("rest", 0.5), ("note", 2.0)]
            if measure_index % 2 == 0
            else [("note", 2.0), ("rest", 1.0), ("note", 1.0)]
        )
    if voice_role == "counterline":
        return (
            [("rest", 1.0), ("note", 1.0), ("note", 2.0)]
            if measure_index % 2 == 0
            else [("note", 1.0), ("rest", 1.0), ("note", 2.0)]
        )
    return (
        [("note", 2.0), ("rest", 1.0), ("note", 1.0)]
        if measure_index % 2 == 0
        else [("note", 1.0), ("rest", 1.0), ("note", 2.0)]
    )


def build_measure_events(
    pitch_cycle: list[int],
    pattern: list[RhythmPatternEvent],
    role_name: str,
    velocity: int,
    measure_index: int,
    section_index: int,
    reverse_motion: bool = False,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    note_index = 0
    for event_kind, duration in pattern:
        if event_kind == "rest":
            events.append(
                {
                    "kind": "rest",
                    "quarterLength": float(duration),
                    "role": role_name,
                }
            )
            continue

        pitch_index = (measure_index + note_index + section_index) % len(pitch_cycle)
        if reverse_motion and (measure_index + note_index) % 2 == 1:
            pitch_index = (len(pitch_cycle) - 1 - pitch_index) % len(pitch_cycle)
        events.append(
            {
                "kind": "note",
                "midi": clamp_midi(int(pitch_cycle[pitch_index]), role_name),
                "quarterLength": float(duration),
                "velocity": velocity,
                "role": role_name,
            }
        )
        note_index += 1
    return events


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


def apply_cadential_bass_shape(
    local_key: key_module.Key,
    bass_measure: list[dict[str, Any]],
    is_penultimate_measure: bool,
    is_final_measure: bool,
) -> None:
    note_events = [event for event in bass_measure if event.get("kind") == "note"]
    if not note_events:
        return

    if is_penultimate_measure:
        note_events[0]["midi"] = clamp_midi(dominant_pitch(local_key, 2), "bass")
        note_events[-1]["midi"] = clamp_midi(dominant_pitch(local_key, 3), "bass")
        return

    if is_final_measure:
        note_events[0]["midi"] = clamp_midi(dominant_pitch(local_key, 2), "bass")
        note_events[-1]["midi"] = clamp_midi(tonic_pitch(local_key, 2), "bass")


def build_section_material(
    section: dict[str, Any],
    section_index: int,
    tonic_key: key_module.Key,
    orchestration_section: dict[str, Any] | None = None,
) -> ProjectedSectionMaterial:
    harmonic_plan = as_record(section.get("harmonicPlan")) or {}
    local_key_label = (
        str(harmonic_plan.get("tonalCenter") or tonic_key.name).strip()
        or tonic_key.name
    )
    local_key = parse_key_signature(local_key_label)
    measure_count = int(section.get("measures") or 4)
    role = str(section.get("role") or "theme_a")
    phrase_function = section.get("phraseFunction")
    texture_guidance = as_record(section.get("texture")) or {}
    counterpoint_mode = (
        str(texture_guidance.get("counterpointMode") or "").strip() or "none"
    )
    conversation_mode = (
        str((orchestration_section or {}).get("conversationMode") or "support").strip()
        or "support"
    )
    register_layout = (
        str((orchestration_section or {}).get("registerLayout") or "layered").strip()
        or "layered"
    )
    lead_instrument = normalize_instrument_key(
        (orchestration_section or {}).get("leadInstrument"), "violin"
    )
    secondary_instrument = normalize_instrument_key(
        (orchestration_section or {}).get("secondaryInstrument"), "viola"
    )
    bass_instrument = normalize_instrument_key(
        (orchestration_section or {}).get("bassInstrument"), "cello"
    )

    lead_degrees, secondary_degrees, bass_degrees = resolve_degree_templates(
        role, phrase_function, conversation_mode, counterpoint_mode
    )
    lead_cycle = build_pitch_cycle(
        local_key,
        lead_degrees,
        resolve_target_center(
            lead_instrument, "lead", conversation_mode, register_layout
        ),
    )
    secondary_cycle = build_pitch_cycle(
        local_key,
        secondary_degrees,
        resolve_target_center(
            secondary_instrument, "counterline", conversation_mode, register_layout
        ),
    )
    bass_cycle = build_pitch_cycle(
        local_key,
        bass_degrees,
        resolve_target_center(
            bass_instrument, "bass", conversation_mode, register_layout
        ),
    )

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
        is_final_measure = measure_index == measure_count - 1
        is_penultimate_measure = measure_index == max(0, measure_count - 2)

        lead_measure = build_measure_events(
            lead_cycle,
            resolve_voice_pattern(
                role,
                phrase_function,
                conversation_mode,
                measure_index,
                measure_count,
                "lead",
            ),
            "lead",
            76 if conversation_mode == "conversational" else 74,
            measure_index,
            section_index,
            reverse_motion=False,
        )
        secondary_measure = build_measure_events(
            secondary_cycle,
            resolve_voice_pattern(
                role,
                phrase_function,
                conversation_mode,
                measure_index,
                measure_count,
                "counterline",
            ),
            "counterline",
            64 if conversation_mode == "conversational" else 60,
            measure_index,
            section_index,
            reverse_motion=counterpoint_mode == "contrary_motion",
        )
        bass_measure = build_measure_events(
            bass_cycle,
            resolve_voice_pattern(
                role,
                phrase_function,
                conversation_mode,
                measure_index,
                measure_count,
                "bass",
            ),
            "bass",
            58 if register_layout == "wide" else 56,
            measure_index,
            section_index,
            reverse_motion=False,
        )
        if is_cadential_role(role, phrase_function):
            apply_cadential_bass_shape(
                local_key,
                bass_measure,
                is_penultimate_measure=is_penultimate_measure,
                is_final_measure=is_final_measure,
            )

        instrument_measures = {
            "violin": violin_measure,
            "viola": viola_measure,
            "cello": cello_measure,
        }
        instrument_measures[lead_instrument].extend(lead_measure)
        instrument_measures[secondary_instrument].extend(secondary_measure)
        instrument_measures[bass_instrument].extend(bass_measure)

        lead_events.extend(lead_measure)
        support_events.extend(secondary_measure)
        support_events.extend(bass_measure)
        note_history.extend(
            int(event["midi"]) for event in lead_measure if event.get("kind") == "note"
        )

        violin_measures.append(violin_measure)
        viola_measures.append(viola_measure)
        cello_measures.append(cello_measure)

    if is_cadential_role(role, phrase_function):
        bass_note_events = [
            event
            for event in support_events
            if event.get("role") == "bass" and event.get("kind") == "note"
        ]
        if len(bass_note_events) >= 2:
            final_tonic = clamp_midi(tonic_pitch(local_key, 2), "bass")
            penultimate_dominant = clamp_midi(dominant_pitch(local_key, 3), "bass")
            if penultimate_dominant <= final_tonic:
                penultimate_dominant = clamp_midi(final_tonic + 5, "bass")
            bass_note_events[-2]["midi"] = penultimate_dominant
            bass_note_events[-1]["midi"] = final_tonic

    return {
        "sectionId": str(section.get("id") or f"section-{section_index + 1}"),
        "role": role,
        "measureCount": measure_count,
        "tonalCenter": local_key_label,
        "phraseFunction": phrase_function,
        "leadEvents": lead_events,
        "supportEvents": support_events,
        "noteHistory": note_history,
        "violinMeasures": violin_measures,
        "violaMeasures": viola_measures,
        "celloMeasures": cello_measures,
    }


def apply_targeted_rewrite(
    material: ProjectedSectionMaterial,
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


def _to_response_section(material: ProjectedSectionMaterial) -> SectionMaterial:
    response_section: SectionMaterial = {
        "sectionId": material["sectionId"],
        "role": material["role"],
        "measureCount": material["measureCount"],
        "tonalCenter": material["tonalCenter"],
        "phraseFunction": material["phraseFunction"],
        "leadEvents": material["leadEvents"],
        "supportEvents": material["supportEvents"],
        "noteHistory": material["noteHistory"],
    }
    if "transform" in material:
        response_section["transform"] = material["transform"]
    return response_section


def _ordered_role_labels(roles: set[str]) -> str:
    ordered = [role for role in ROLE_ORDER if role in roles]
    return ",".join(ordered) if ordered else "none"


def analyze_projection_warnings(
    material: ProjectedSectionMaterial,
) -> list[str]:
    observed_roles = {
        str(event.get("role") or "").strip()
        for event in [*material["leadEvents"], *material["supportEvents"]]
        if event.get("kind") != "rest"
        and str(event.get("role") or "").strip() in EXPECTED_TRIO_ROLES
    }
    if observed_roles == EXPECTED_TRIO_ROLES:
        return []

    return [
        f"section {material['sectionId']} role collapse: expected lead,counterline,bass got {_ordered_role_labels(observed_roles)}"
    ]


def project_symbolic_sections(
    payload: dict[str, Any],
    sections: list[dict[str, Any]],
    tonic_key: key_module.Key,
    attempt_index: int,
    base_warnings: list[str] | None = None,
) -> SymbolicProjectionResult:
    seeded_artifacts = extract_seed_artifacts(payload)
    targeted_directives = extract_targeted_directives(payload)
    orchestration_sections = extract_orchestration_sections(payload)
    projected_sections: list[ProjectedSectionMaterial] = []
    normalization_warnings = [*base_warnings] if base_warnings else []
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
        material = seeded_material or build_section_material(
            section,
            index,
            tonic_key,
            orchestration_sections.get(section_id),
        )
        if section_id in targeted_directives:
            apply_targeted_rewrite(
                material, targeted_directives[section_id], attempt_index
            )
            rewrite_applied = True
            if section_id not in seeded_artifacts:
                normalization_warnings.append(
                    f"targeted rewrite for {section_id} used plan-conditioned fallback instead of seeded artifact"
                )
        normalization_warnings.extend(analyze_projection_warnings(material))
        projected_sections.append(material)

    violin_measures: list[list[dict[str, Any]]] = []
    viola_measures: list[list[dict[str, Any]]] = []
    cello_measures: list[list[dict[str, Any]]] = []
    proposal_sections: list[SectionMaterial] = []
    total_note_count = 0
    total_measure_count = 0
    for material in projected_sections:
        violin_measures.extend(material["violinMeasures"])
        viola_measures.extend(material["violaMeasures"])
        cello_measures.extend(material["celloMeasures"])
        total_note_count += len(material["leadEvents"]) + len(material["supportEvents"])
        total_measure_count += int(material["measureCount"])
        proposal_sections.append(_to_response_section(material))

    return {
        "proposalSections": proposal_sections,
        "violinMeasures": violin_measures,
        "violaMeasures": viola_measures,
        "celloMeasures": cello_measures,
        "totalMeasureCount": total_measure_count,
        "totalNoteCount": total_note_count,
        "rewriteApplied": rewrite_applied,
        "normalizationWarnings": normalization_warnings,
    }
