from typing import Any, TypedDict, cast


class ProviderPromptPackingContext(TypedDict):
    adapter: str
    version: str
    provider: str
    model: str
    promptPackVersion: str
    planSignature: str
    conditioningText: str
    controlLines: list[str]
    lane: str | None
    warnings: list[str]


def as_record(value: Any) -> dict[str, Any] | None:
    return cast(dict[str, Any], value) if isinstance(value, dict) else None


def as_list(value: Any) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_name(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", " ")


def get_prompt_pack(payload: dict[str, Any]) -> dict[str, Any]:
    packed = as_record(payload.get("promptPack"))
    return packed if packed is not None else {}


def get_prompt_pack_style(payload: dict[str, Any]) -> dict[str, Any]:
    return as_record(get_prompt_pack(payload).get("styleCue")) or {}


def get_prompt_pack_sections(payload: dict[str, Any]) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for raw_entry in as_list(get_prompt_pack(payload).get("sections")):
        entry = as_record(raw_entry)
        if entry is None:
            continue
        sections.append(entry)
    return sections


def get_prompt_pack_instrument_names(payload: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for raw_entry in as_list(get_prompt_pack(payload).get("instrumentation")):
        entry = as_record(raw_entry)
        if entry is None:
            continue
        name = normalize_text(entry.get("name"))
        if name:
            names.append(name)
    return names


def resolve_form(payload: dict[str, Any], plan: dict[str, Any]) -> str:
    style = get_prompt_pack_style(payload)
    form = normalize_text(
        payload.get("form") or style.get("form") or plan.get("form") or "miniature"
    )
    return form or "miniature"


def resolve_tempo(payload: dict[str, Any], plan: dict[str, Any]) -> int:
    tempo = payload.get("tempo")
    if isinstance(tempo, (int, float)) and tempo > 0:
        return int(round(float(tempo)))
    packed_tempo = get_prompt_pack_style(payload).get("tempo")
    if isinstance(packed_tempo, (int, float)) and packed_tempo > 0:
        return int(round(float(packed_tempo)))
    plan_tempo = plan.get("tempo")
    if isinstance(plan_tempo, (int, float)) and plan_tempo > 0:
        return int(round(float(plan_tempo)))
    return 92


def resolve_key_label(payload: dict[str, Any], plan: dict[str, Any]) -> str:
    style = get_prompt_pack_style(payload)
    key_label = normalize_text(
        payload.get("key") or style.get("key") or plan.get("key") or "C major"
    )
    return key_label or "C major"


def resolve_section_measure_count(section: dict[str, Any]) -> int:
    measures = section.get("measures")
    if isinstance(measures, int) and measures > 0:
        return measures
    if isinstance(measures, float) and measures > 0:
        return int(round(measures))
    return 4


def resolve_sections(
    payload: dict[str, Any], plan: dict[str, Any]
) -> list[dict[str, Any]]:
    prompt_pack_sections = get_prompt_pack_sections(payload)
    if prompt_pack_sections:
        normalized: list[dict[str, Any]] = []
        for index, entry in enumerate(prompt_pack_sections):
            normalized.append(
                {
                    "id": normalize_text(entry.get("sectionId"))
                    or f"section-{index + 1}",
                    "role": normalize_text(entry.get("role")) or "theme_a",
                    "phraseFunction": entry.get("phraseFunction"),
                    "measures": resolve_section_measure_count(
                        {"measures": entry.get("measures")}
                    ),
                    "harmonicPlan": entry.get("harmonicPlan")
                    if isinstance(entry.get("harmonicPlan"), dict)
                    else {},
                }
            )
        if normalized:
            return normalized

    sections = plan.get("sections")
    if isinstance(sections, list) and sections:
        normalized: list[dict[str, Any]] = []
        for index, raw_entry in enumerate(as_list(sections)):
            entry = as_record(raw_entry)
            if entry is None:
                continue
            normalized.append(
                {
                    "id": normalize_text(entry.get("id")) or f"section-{index + 1}",
                    "role": normalize_text(entry.get("role")) or "theme_a",
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
    packed_names = get_prompt_pack_instrument_names(payload)
    if packed_names:
        return packed_names

    names: list[str] = []
    instrumentation = plan.get("instrumentation")
    if isinstance(instrumentation, list):
        for raw_entry in as_list(instrumentation):
            entry = as_record(raw_entry)
            if entry is None:
                continue
            name = normalize_text(entry.get("name"))
            if name:
                names.append(name)
    if not names:
        target = payload.get("targetInstrumentation")
        if isinstance(target, list):
            for raw_entry in as_list(target):
                entry = as_record(raw_entry)
                if entry is None:
                    continue
                name = normalize_text(entry.get("name"))
                if name:
                    names.append(name)
    return names


def supports_narrow_lane(
    payload: dict[str, Any], plan: dict[str, Any], form: str
) -> bool:
    canonical_trio = ["violin", "viola", "cello"]
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
            if normalized_names == sorted(canonical_trio):
                return True

    instrument_names = resolve_instrument_names(payload, plan)
    return sorted(normalize_name(name) for name in instrument_names) == sorted(
        canonical_trio
    )


# ─── Piano solo lane gate ─────────────────────────────────────────────────────
#
# Active worker gate for the TypeScript solo_piano_symbolic lane.  It mirrors
# learnedAdapter.ts: a request must carry compositionPlan.pianoPlan and include
# Piano in the resolved instrumentation.  The piano control lines remain
# preserved for projection, repair, and fine-tuning datasets even when a native
# NotaGen model cannot yet obey every field directly.

# ─── Piano packing control hints ─────────────────────────────────────────────


class PianoPackingControlHints(TypedDict):
    """Conditioning hints for the solo_piano_symbolic lane.

    These hints are NOT yet consumed by any active compose path.
    They document the expected control-line semantics so that when the
    piano lane is activated, the prompt builder can emit correctly formatted
    control lines without guesswork.
    """

    # MIDI pitch that divides right-hand from left-hand territory.
    # Notes >= split_pitch are assigned to the right hand.
    hand_split_pitch: int

    # Expected register bias of the right-hand melody voice.
    # "high": primary melody above C5; "mid": C4–C5; "low": below C4.
    right_hand_register: str

    # Left-hand accompaniment pattern implied by the section role.
    # "alberti": broken-triad Alberti bass pattern
    # "broken_chord": non-Alberti arpeggiated chord
    # "block_chord": sustained simultaneous chord strikes
    # "bass_melody": bass on beat 1 + melody filler (tenor-register)
    # "waltz_bass": bass on 1, chord on 2–3
    left_hand_pattern: str

    # Pedal-use intensity recommendation for the section.
    # "legato": sustain pedal throughout most of the section
    # "sectional": change pedal at harmony changes
    # "sparse": minimal pedal (e.g. staccato, dry textures)
    pedal_guidance: str

    # Number of simultaneous voices expected in the right hand (1–4).
    expected_right_hand_voices: int

    # Number of simultaneous voices expected in the left hand (1–4).
    expected_left_hand_voices: int


def build_piano_packing_control_hints(
    payload: dict[str, Any],
    plan: dict[str, Any],
    form: str,
) -> PianoPackingControlHints:
    """Derive piano conditioning hints from the composition plan and payload.

    This function is NOT YET WIRED into compose_learned_symbolic.py.
    It is provided so that the piano prompt builder can be developed and
    tested in isolation before the full lane is activated.

    The hints are meant to be serialised into control lines, e.g.:
        f"hand_split_pitch={hints['hand_split_pitch']}"
        f"left_hand_pattern={hints['left_hand_pattern']}"
    """
    normalized_form = form.lower()

    # ── Hand split pitch ─────────────────────────────────────────────────────
    # Default: C4 (60).  Shift down for bass-heavy textures, up for high RH.
    style = get_prompt_pack_style(payload)
    register = normalize_name(style.get("register") or plan.get("register") or "")
    hand_split_pitch = 60
    if "low" in register:
        hand_split_pitch = 55   # B3 — favour LH territory
    elif "high" in register:
        hand_split_pitch = 65  # F4 — favour RH territory

    # ── Right-hand register ──────────────────────────────────────────────────
    if "high" in register:
        right_hand_register = "high"
    elif "low" in register:
        right_hand_register = "low"
    else:
        right_hand_register = "mid"

    # ── Left-hand pattern ────────────────────────────────────────────────────
    # Derive from the first section role if available, otherwise from form.
    sections = resolve_sections(payload, plan)
    first_role = normalize_name(sections[0].get("role") or "") if sections else ""
    phrase_fn = normalize_name(sections[0].get("phraseFunction") or "") if sections else ""

    if "cadence" in first_role or "cadential" in phrase_fn or "cadence" in phrase_fn:
        left_hand_pattern = "block_chord"
    elif "development" in first_role or "transition" in first_role:
        left_hand_pattern = "broken_chord"
    elif "miniature" in normalized_form or "sonata" in normalized_form:
        left_hand_pattern = "alberti"
    else:
        left_hand_pattern = "waltz_bass"

    # ── Pedal guidance ───────────────────────────────────────────────────────
    # Derive from dynamics/character if present in style.
    dynamics = normalize_name(style.get("dynamics") or plan.get("dynamics") or "")
    if "staccato" in dynamics or "marcato" in dynamics or "dry" in dynamics:
        pedal_guidance = "sparse"
    elif "legato" in dynamics or "cantabile" in dynamics or "sostenuto" in dynamics:
        pedal_guidance = "legato"
    else:
        pedal_guidance = "sectional"

    # ── Voice count ──────────────────────────────────────────────────────────
    # Rough heuristic: more complex forms → more voices.
    if "sonata" in normalized_form:
        expected_right_hand_voices = 2
        expected_left_hand_voices = 3
    else:
        expected_right_hand_voices = 1
        expected_left_hand_voices = 2

    return {
        "hand_split_pitch": hand_split_pitch,
        "right_hand_register": right_hand_register,
        "left_hand_pattern": left_hand_pattern,
        "pedal_guidance": pedal_guidance,
        "expected_right_hand_voices": expected_right_hand_voices,
        "expected_left_hand_voices": expected_left_hand_voices,
    }


def supports_solo_piano_lane(
    payload: dict[str, Any], plan: dict[str, Any], form: str
) -> bool:
    """Return True when the request targets the active solo_piano_symbolic lane.

    Checks:
    - compositionPlan.pianoPlan is present
    - instrumentation contains Piano, or orchestration identifies a piano solo

    Does not check whether a specific backend/model is trained or capable; that
    validation belongs in the backend router.
    """
    _ = form  # kept for signature symmetry with supports_narrow_lane().
    piano_plan = as_record(plan.get("pianoPlan"))
    if piano_plan is None:
        return False

    orchestration = plan.get("orchestration")
    orchestration_record = as_record(orchestration)
    if orchestration_record is not None:
        family = normalize_name(orchestration_record.get("family"))
        if family == "solo_piano":
            return True
        instrument_names_raw = orchestration_record.get("instrumentNames")
        if isinstance(instrument_names_raw, list):
            normalized = [normalize_name(n) for n in as_list(instrument_names_raw)]
            if "piano" in normalized:
                return True

    instrument_names = resolve_instrument_names(payload, plan)
    normalized_names = [normalize_name(n) for n in instrument_names]
    return "piano" in normalized_names


def _find_control_value(control_lines: list[str], prefix: str) -> str | None:
    for line in control_lines:
        if line.startswith(prefix):
            value = line[len(prefix) :].strip()
            return value or None
    return None


def resolve_provider_prompt_packing_context(
    payload: dict[str, Any],
    prompt_pack: dict[str, Any],
) -> ProviderPromptPackingContext | None:
    provider_request = as_record(payload.get("providerRequest"))
    if provider_request is None:
        return None

    adapter = normalize_text(provider_request.get("adapter"))
    version = normalize_text(provider_request.get("version"))
    provider = normalize_text(provider_request.get("provider"))
    model = normalize_text(provider_request.get("model"))
    prompt_pack_version = normalize_text(provider_request.get("promptPackVersion"))
    plan_signature = normalize_text(provider_request.get("planSignature"))
    conditioning_text = normalize_text(provider_request.get("conditioningText"))

    if adapter != "notagen_class":
        raise ValueError("providerRequest.adapter must be 'notagen_class'")
    if not version:
        raise ValueError("providerRequest.version must be a non-empty string")
    if not provider:
        raise ValueError("providerRequest.provider must be a non-empty string")
    if not model:
        raise ValueError("providerRequest.model must be a non-empty string")
    if not prompt_pack_version:
        raise ValueError("providerRequest.promptPackVersion must be a non-empty string")
    if not plan_signature:
        raise ValueError("providerRequest.planSignature must be a non-empty string")
    if not conditioning_text:
        raise ValueError("providerRequest.conditioningText must be a non-empty string")

    raw_control_lines = provider_request.get("controlLines")
    if not isinstance(raw_control_lines, list) or not raw_control_lines:
        raise ValueError(
            "providerRequest.controlLines must be a non-empty string array"
        )
    if any(not isinstance(line, str) for line in as_list(raw_control_lines)):
        raise ValueError(
            "providerRequest.controlLines must be a non-empty string array"
        )
    control_lines = [
        normalize_text(line) for line in cast(list[str], raw_control_lines)
    ]
    if any(not line for line in control_lines):
        raise ValueError(
            "providerRequest.controlLines must be a non-empty string array"
        )

    expected_prompt_pack_version = normalize_text(prompt_pack.get("version"))
    if (
        expected_prompt_pack_version
        and prompt_pack_version != expected_prompt_pack_version
    ):
        raise ValueError(
            "providerRequest.promptPackVersion does not match promptPack.version"
        )

    expected_plan_signature = normalize_text(prompt_pack.get("planSignature"))
    if expected_plan_signature and plan_signature != expected_plan_signature:
        raise ValueError(
            "providerRequest.planSignature does not match promptPack.planSignature"
        )

    warnings: list[str] = []
    lane = _find_control_value(control_lines, "lane=")
    if lane is None:
        warnings.append("providerRequest missing lane control line")
    expected_lane = normalize_text(prompt_pack.get("lane"))
    if expected_lane and lane is not None and lane != expected_lane:
        raise ValueError("providerRequest lane does not match promptPack.lane")

    expected_section_count = len(as_list(prompt_pack.get("sections")))
    section_line_count = sum(1 for line in control_lines if line.startswith("section "))
    if expected_section_count and section_line_count != expected_section_count:
        raise ValueError(
            f"providerRequest section control count mismatch: expected {expected_section_count}, got {section_line_count}"
        )

    return {
        "adapter": adapter,
        "version": version,
        "provider": provider,
        "model": model,
        "promptPackVersion": prompt_pack_version,
        "planSignature": plan_signature,
        "conditioningText": conditioning_text,
        "controlLines": control_lines,
        "lane": lane,
        "warnings": warnings,
    }
