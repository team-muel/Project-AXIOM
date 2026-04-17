# pyright: reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportUnknownParameterType=false, reportUnnecessaryIsInstance=false
"""
AXIOM Symbolic Composer — music21 기반 심벌릭 작곡 워커.

기존의 완전 무작위 음표 채우기 대신 다음을 반영한다.

- 프롬프트의 분위기/스타일 힌트
- form 별 마디 수, 박자, 반주 패턴
- compositionProfile contour / density / tension 힌트
- 결정론적 seed 기반 생성
"""

import hashlib
import json
import os
import random
import sys
from dataclasses import dataclass, replace
from typing import Any

from music21 import (
    chord,
    instrument,
    key as keyModule,
    meter,
    midi as m21midi,
    note,
    pitch as pitchModule,
    stream,
    tempo as tempoModule,
)


MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]
MAJOR_TONICS = ["C", "G", "D", "F", "A", "Bb", "Eb"]
MINOR_TONICS = ["A", "D", "E", "G", "C", "B", "F#"]

FORM_SETTINGS: dict[str, dict[str, Any]] = {
    "miniature": {
        "measures": 8,
        "tempo": 84,
        "time_signature": "4/4",
        "style": "block",
    },
    "short": {"measures": 12, "tempo": 96, "time_signature": "4/4", "style": "broken"},
    "dramatic": {
        "measures": 12,
        "tempo": 104,
        "time_signature": "4/4",
        "style": "march",
    },
    "waltz": {"measures": 12, "tempo": 108, "time_signature": "3/4", "style": "waltz"},
    "nocturne": {
        "measures": 10,
        "tempo": 72,
        "time_signature": "4/4",
        "style": "arpeggio",
    },
    "lullaby": {
        "measures": 8,
        "tempo": 70,
        "time_signature": "3/4",
        "style": "arpeggio",
    },
    "march": {"measures": 8, "tempo": 116, "time_signature": "2/4", "style": "march"},
}

STYLE_HINTS: dict[str, dict[str, Any]] = {
    "waltz": {
        "style": "waltz",
        "time_signature": "3/4",
        "tempo_delta": 10,
        "motion": "circular",
    },
    "nocturne": {
        "style": "arpeggio",
        "tempo_delta": -18,
        "mode": "minor",
        "motion": "descending",
    },
    "lullaby": {
        "style": "arpeggio",
        "time_signature": "3/4",
        "tempo_delta": -20,
        "motion": "descending",
    },
    "march": {
        "style": "march",
        "time_signature": "2/4",
        "tempo_delta": 16,
        "motion": "ascending",
    },
    "rain": {
        "style": "arpeggio",
        "tempo_delta": -12,
        "mode": "minor",
        "motion": "descending",
        "density": 0.34,
    },
    "storm": {
        "style": "march",
        "tempo_delta": 18,
        "mode": "minor",
        "motion": "ascending",
        "density": 0.72,
    },
    "dance": {"style": "waltz", "tempo_delta": 8, "motion": "circular"},
    "pastoral": {
        "style": "broken",
        "tempo_delta": -4,
        "mode": "major",
        "motion": "arch",
    },
    "solemn": {
        "style": "block",
        "tempo_delta": -12,
        "mode": "minor",
        "motion": "descending",
    },
    "playful": {
        "style": "broken",
        "tempo_delta": 10,
        "mode": "major",
        "motion": "wave",
    },
    "gentle": {"tempo_delta": -8, "density": 0.33, "motion": "descending"},
    "bright": {"tempo_delta": 6, "mode": "major", "motion": "ascending"},
    "dark": {"mode": "minor", "motion": "descending"},
}

DYNAMIC_LEVEL_VELOCITY_OFFSETS = {
    "pp": -18,
    "p": -12,
    "mp": -6,
    "mf": 0,
    "f": 8,
    "ff": 14,
}

EXPRESSION_ARTICULATION_TAGS = {
    "legato",
    "staccato",
    "staccatissimo",
    "tenuto",
    "sostenuto",
    "accent",
    "marcato",
}
EXPRESSION_CHARACTER_TAGS = {
    "dolce",
    "dolcissimo",
    "espressivo",
    "cantabile",
    "agitato",
    "tranquillo",
    "energico",
    "grazioso",
    "brillante",
    "giocoso",
    "leggiero",
    "maestoso",
    "scherzando",
    "pastorale",
    "tempestoso",
    "appassionato",
    "delicato",
}
ARTICULATION_BIAS_EFFECTS = {
    "legato": {"sustain": 0.22, "rhythm": -0.08},
    "staccato": {"sustain": -0.42, "rhythm": 0.12},
    "staccatissimo": {"sustain": -0.56, "accent": 0.08, "rhythm": 0.16},
    "tenuto": {"sustain": 0.16, "accent": 0.1, "rhythm": -0.04},
    "sostenuto": {"sustain": 0.24, "rhythm": -0.08},
    "accent": {"accent": 0.32, "sustain": -0.08, "rhythm": 0.08},
    "marcato": {"dynamic": 3.0, "accent": 0.42, "sustain": -0.12, "rhythm": 0.12},
}
CHARACTER_BIAS_EFFECTS = {
    "dolce": {"dynamic": -4.0, "sustain": 0.12, "rhythm": -0.05},
    "dolcissimo": {"dynamic": -5.0, "sustain": 0.18, "rhythm": -0.08},
    "espressivo": {"dynamic": 2.0, "sustain": 0.08},
    "cantabile": {"sustain": 0.16, "rhythm": -0.04},
    "agitato": {"dynamic": 5.0, "accent": 0.28, "sustain": -0.18, "rhythm": 0.12},
    "tranquillo": {"dynamic": -3.0, "accent": -0.06, "sustain": 0.18, "rhythm": -0.08},
    "energico": {"dynamic": 4.0, "accent": 0.28, "sustain": -0.06, "rhythm": 0.08},
    "grazioso": {"dynamic": -1.5, "accent": 0.04, "sustain": 0.06, "rhythm": -0.03},
    "brillante": {"dynamic": 3.0, "accent": 0.18, "sustain": -0.02, "rhythm": 0.04},
    "giocoso": {"dynamic": 1.0, "accent": 0.12, "rhythm": 0.06},
    "leggiero": {"dynamic": -1.0, "accent": 0.02, "sustain": -0.06, "rhythm": 0.08},
    "maestoso": {"dynamic": 4.0, "accent": 0.2, "sustain": 0.08, "rhythm": -0.02},
    "scherzando": {"dynamic": 1.5, "accent": 0.16, "sustain": -0.04, "rhythm": 0.1},
    "pastorale": {"dynamic": -2.0, "sustain": 0.12, "rhythm": -0.02},
    "tempestoso": {"dynamic": 6.0, "accent": 0.34, "sustain": -0.24, "rhythm": 0.16},
    "appassionato": {"dynamic": 4.5, "accent": 0.24, "sustain": 0.02, "rhythm": 0.08},
    "delicato": {"dynamic": -2.0, "accent": -0.04, "sustain": 0.1, "rhythm": -0.04},
}
ARTICULATION_GATE_OFFSETS = {
    "legato": 0.08,
    "staccato": -0.32,
    "staccatissimo": -0.42,
    "tenuto": 0.07,
    "sostenuto": 0.11,
    "accent": -0.06,
    "marcato": -0.1,
}
CHARACTER_GATE_OFFSETS = {
    "dolce": 0.03,
    "dolcissimo": 0.06,
    "espressivo": 0.02,
    "cantabile": 0.05,
    "agitato": -0.08,
    "tranquillo": 0.05,
    "energico": -0.04,
    "grazioso": 0.02,
    "brillante": -0.03,
    "giocoso": -0.02,
    "leggiero": -0.08,
    "maestoso": 0.02,
    "scherzando": -0.02,
    "pastorale": 0.04,
    "tempestoso": -0.12,
    "appassionato": -0.02,
    "delicato": 0.03,
}
DETACHED_ARTICULATION_TAGS = {"staccato", "staccatissimo", "marcato"}
PHRASE_FUNCTIONS = {
    "presentation",
    "continuation",
    "cadential",
    "transition",
    "developmental",
}
PHRASE_SPAN_SHAPES = {
    "period",
    "sentence",
    "hybrid",
    "continuation_chain",
    "cadential_unit",
}
CONTINUATION_PRESSURES = {"low", "medium", "high"}
CADENTIAL_BUILDUPS = {"gentle", "prepared", "surging"}
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
PROLONGATION_MODES = {"tonic", "dominant", "sequential", "pedal"}
TONICIZATION_EMPHASES = {"passing", "prepared", "arriving"}
HARMONIC_COLOR_TAGS = {"mixture", "applied_dominant", "predominant_color", "suspension"}


def normalize_texture_role(value: Any) -> str | None:
    role = str(value or "").strip().lower()
    if role in TEXTURE_ROLES:
        return role
    return None


def texture_roles_from_guidance(texture_guidance: dict[str, Any] | None) -> set[str]:
    return {
        role
        for role_value in (texture_guidance or {}).get("primaryRoles", [])
        for role in [normalize_texture_role(role_value)]
        if role
    }


def counterpoint_mode_from_guidance(texture_guidance: dict[str, Any] | None) -> str:
    return (
        str((texture_guidance or {}).get("counterpointMode") or "")
        .strip()
        .lower()
        .replace(" ", "_")
    )


def texture_voice_count_from_guidance(
    texture_guidance: dict[str, Any] | None,
) -> int | None:
    voice_count = (texture_guidance or {}).get("voiceCount")
    if isinstance(voice_count, (int, float)):
        return max(1, int(voice_count))
    return None


def section_requests_independent_texture(
    texture_guidance: dict[str, Any] | None,
) -> bool:
    texture_roles = texture_roles_from_guidance(texture_guidance)
    counterpoint_mode = counterpoint_mode_from_guidance(texture_guidance)
    voice_count = texture_voice_count_from_guidance(texture_guidance)

    return bool(
        counterpoint_mode in {"imitative", "contrary_motion", "free"}
        or "counterline" in texture_roles
        or "inner_voice" in texture_roles
        or (voice_count is not None and voice_count >= 3)
    )


MINOR_KEYWORDS = {
    "rain",
    "night",
    "shadow",
    "dark",
    "sad",
    "melanch",
    "mourning",
    "dusk",
    "twilight",
    "lament",
    "lonely",
    "minor",
    "solemn",
    "nocturne",
}

MAJOR_KEYWORDS = {
    "bright",
    "spring",
    "morning",
    "sun",
    "joy",
    "festival",
    "pastoral",
    "dance",
    "playful",
    "sparkling",
    "waltz",
    "major",
}

ENERGETIC_KEYWORDS = {
    "march",
    "storm",
    "urgent",
    "brisk",
    "dramatic",
    "festive",
    "celebration",
}

CALM_KEYWORDS = {
    "rain",
    "gentle",
    "quiet",
    "lullaby",
    "nocturne",
    "reflective",
    "soft",
    "calm",
}

MAJOR_PROGRESSIONS = [
    [0, 3, 4, 0],
    [0, 5, 3, 4, 0],
    [0, 1, 4, 0],
    [0, 3, 1, 4, 0],
]

MINOR_PROGRESSIONS = [
    [0, 5, 3, 4, 0],
    [0, 3, 6, 4, 0],
    [0, 5, 2, 4, 0],
    [0, 3, 5, 4, 0],
]

MAJOR_MODULATION_PROGRESSIONS = [
    [4, 0, 1, 4, 0],
    [1, 4, 0, 1, 4, 0],
    [5, 1, 4, 0],
]

MINOR_MODULATION_PROGRESSIONS = [
    [4, 0, 5, 4, 0],
    [5, 4, 0, 5, 4, 0],
    [3, 5, 4, 0],
]

MAJOR_RETURN_PROGRESSIONS = [
    [1, 4, 0],
    [3, 4, 0],
    [5, 1, 4, 0],
]

MINOR_RETURN_PROGRESSIONS = [
    [1, 4, 0],
    [3, 5, 4, 0],
    [5, 4, 0],
]

PITCH_CLASS_TO_TONIC = {
    0: "C",
    1: "C#",
    2: "D",
    3: "Eb",
    4: "E",
    5: "F",
    6: "F#",
    7: "G",
    8: "Ab",
    9: "A",
    10: "Bb",
    11: "B",
}


@dataclass
class SectionSpan:
    id: str
    role: str
    start_measure: int
    end_measure: int
    motif_ref: str | None
    contrast_from: str | None
    development_type: str | None
    recap_mode: str | None
    cadence_strength: float | None
    tonal_center: str | None
    local_mode: str | None
    harmonic_rhythm: str | None
    phrase_function: str | None
    phrase_span_shape: str | None
    continuation_pressure: str | None
    cadential_buildup: str | None
    texture_guidance: dict[str, Any] | None
    harmony_density: str | None
    voicing_profile: str | None
    prolongation_mode: str | None
    tonicization_windows: list[dict[str, Any]] | None
    harmonic_color_cues: list[dict[str, Any]] | None
    expression_guidance: dict[str, Any] | None
    section_style: str | None
    planned_register_center: int | None


@dataclass
class ResolvedProfile:
    tonic: str
    mode: str
    tempo: int
    measures: int
    time_signature: str
    style: str
    contour: list[float]
    density: float
    tension: list[float]
    phrase_length: int
    motion: str
    form: str
    measure_styles: list[str]
    measure_densities: list[float]
    measure_tonics: list[str]
    measure_modes: list[str]
    measure_harmonic_rhythms: list[str]
    measure_harmony_densities: list[str | None]
    measure_voicing_profiles: list[str | None]
    cadence_map: list[str | None]
    progression_degrees: list[int]
    phrase_breaks: set[int]
    lead_instrument_name: str
    accompaniment_instrument_name: str
    secondary_instrument_name: str | None
    measure_section_ids: list[str | None]
    section_spans: list[SectionSpan]
    expression_defaults: dict[str, Any] | None
    sketch_motif_library: dict[str, list[int]]
    motif_reuse_required: bool
    motif_inversion_allowed: bool
    motif_augmentation_allowed: bool
    motif_diminution_allowed: bool
    motif_sequence_allowed: bool
    contour_span: float
    max_preferred_leap: int
    max_absolute_leap: int
    repetition_penalty: float
    pitch_variety_bias: float
    rhythm_variety_bias: float
    harmonic_stability_bias: float
    cadence_bass_bias: float
    attempt_index: int
    active_seed_value: int
    stable_seed_value: int
    global_directive_kinds: set[str]
    section_directive_kinds: dict[str, set[str]]
    reusable_section_artifacts: dict[str, dict[str, Any]]


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def pitch_class(value: int) -> int:
    return value % 12


def interval_class(upper: int, lower: int) -> int:
    return (upper - lower) % 12


def is_perfect_consonance(value: int) -> bool:
    return value in {0, 7}


def creates_parallel_perfect_motion(
    candidate: int,
    prev_pitch: int | None,
    bass_pitch: int | None,
    previous_bass_pitch: int | None,
) -> bool:
    if prev_pitch is None or bass_pitch is None or previous_bass_pitch is None:
        return False

    previous_interval = interval_class(prev_pitch, previous_bass_pitch)
    current_interval = interval_class(candidate, bass_pitch)
    if not (
        is_perfect_consonance(previous_interval)
        and is_perfect_consonance(current_interval)
    ):
        return False

    melody_direction = (
        0 if candidate == prev_pitch else (1 if candidate > prev_pitch else -1)
    )
    bass_direction = (
        0
        if bass_pitch == previous_bass_pitch
        else (1 if bass_pitch > previous_bass_pitch else -1)
    )
    return (
        melody_direction != 0
        and bass_direction != 0
        and melody_direction == bass_direction
    )


def normalize(values: list[float]) -> list[float]:
    if not values:
        return []

    lo, hi = min(values), max(values)
    if hi == lo:
        return [0.5] * len(values)
    return [(value - lo) / (hi - lo) for value in values]


def resample_curve(values: list[float], target_len: int) -> list[float]:
    if target_len <= 0:
        return []
    if not values:
        return [0.5] * target_len
    if len(values) == 1:
        return [float(values[0])] * target_len

    result: list[float] = []
    last_index = len(values) - 1
    for idx in range(target_len):
        position = (idx / max(target_len - 1, 1)) * last_index
        left = int(position)
        right = min(left + 1, last_index)
        fraction = position - left
        interpolated = values[left] * (1.0 - fraction) + values[right] * fraction
        result.append(float(interpolated))
    return result


def derive_seed_value(
    prompt: str, key_str: str, tempo: int | None, form: str, seed: Any
) -> int:
    if seed is not None:
        return int(seed)

    payload = f"{prompt}|{key_str}|{tempo or ''}|{form}"
    return int(hashlib.sha256(payload.encode("utf-8")).hexdigest()[:8], 16)


def seeded_random(
    prompt: str, key_str: str, tempo: int | None, form: str, seed: Any
) -> random.Random:
    return random.Random(derive_seed_value(prompt, key_str, tempo, form, seed))


def derive_seed_from_parts(*parts: Any) -> int:
    payload = "|".join(str(part) for part in parts)
    return int(hashlib.sha256(payload.encode("utf-8")).hexdigest()[:8], 16)


def parse_key(key_str: str | None) -> tuple[str | None, str | None]:
    if not key_str:
        return None, None

    parts = key_str.strip().split()
    if not parts:
        return None, None

    tonic_token = parts[0]
    mode_index = 1
    if len(parts) > 1 and parts[1].lower() in {"flat", "sharp"}:
        tonic_token = f"{tonic_token}{'b' if parts[1].lower() == 'flat' else '#'}"
        mode_index = 2

    tonic = tonic_token.replace("♭", "b").replace("♯", "#")
    lowered_tonic = tonic.lower()
    if lowered_tonic.endswith("-flat"):
        tonic = f"{tonic[:-5]}b"
    elif lowered_tonic.endswith("flat"):
        tonic = f"{tonic[:-4]}b"
    elif lowered_tonic.endswith("-sharp"):
        tonic = f"{tonic[:-6]}#"
    elif lowered_tonic.endswith("sharp"):
        tonic = f"{tonic[:-5]}#"

    tonic = tonic[0].upper() + tonic[1:] if tonic else "C"
    mode = parts[mode_index].lower() if len(parts) > mode_index else "major"
    return tonic, mode


def key_pitch_class(tonic: str | None) -> int | None:
    if not tonic:
        return None

    try:
        return int(pitchModule.Pitch(f"{tonic}4").midi) % 12
    except Exception:
        return None


def tonic_for_pitch_class(value: int) -> str:
    return PITCH_CLASS_TO_TONIC[value % 12]


def format_key_name(tonic: str, mode: str) -> str:
    return f"{tonic} {mode}"


def transpose_key_center(tonic: str, semitones: int, mode: str) -> tuple[str, str]:
    pitch_class = key_pitch_class(tonic)
    if pitch_class is None:
        return tonic, mode

    return tonic_for_pitch_class(pitch_class + semitones), mode


def same_key(
    tonic_a: str | None,
    mode_a: str | None,
    tonic_b: str | None,
    mode_b: str | None,
) -> bool:
    return bool(
        tonic_a
        and tonic_b
        and mode_a
        and mode_b
        and tonic_a == tonic_b
        and mode_a == mode_b
    )


def related_key_candidates(home_tonic: str, home_mode: str) -> list[tuple[str, str]]:
    if home_mode == "major":
        return [
            transpose_key_center(home_tonic, 7, "major"),
            transpose_key_center(home_tonic, 9, "minor"),
            transpose_key_center(home_tonic, 5, "major"),
            transpose_key_center(home_tonic, 4, "minor"),
        ]

    return [
        transpose_key_center(home_tonic, 3, "major"),
        transpose_key_center(home_tonic, 7, "minor"),
        transpose_key_center(home_tonic, 8, "major"),
        transpose_key_center(home_tonic, 5, "minor"),
    ]


def select_section_tonality(
    role: str,
    home_tonic: str,
    home_mode: str,
    explicit_tonic: str | None,
    explicit_mode: str | None,
    allow_modulation: bool,
    harmonic_rhythm: str | None,
    directive_set: set[str],
    section_index: int,
    previous_tonic: str | None,
    previous_mode: str | None,
) -> tuple[str, str, bool]:
    if explicit_tonic and explicit_mode:
        return explicit_tonic, explicit_mode, True

    if role in {"recap", "cadence", "outro"}:
        return home_tonic, home_mode, False

    if not allow_modulation:
        return home_tonic, home_mode, False

    candidates = related_key_candidates(home_tonic, home_mode)
    if not candidates:
        return home_tonic, home_mode, False

    candidate_index = 0
    if role == "development":
        candidate_index = (
            0 if harmonic_rhythm == "fast" else (1 if len(candidates) > 1 else 0)
        )
    elif role == "theme_b":
        candidate_index = 0
    elif role == "variation":
        candidate_index = 1 if len(candidates) > 1 else 0
    elif role == "bridge":
        candidate_index = 2 if len(candidates) > 2 else 0
    elif harmonic_rhythm == "slow":
        candidate_index = 1 if len(candidates) > 1 else 0
    elif (
        section_index % 2 == 1
        and len(candidates) > 1
        and "stabilize_harmony" not in directive_set
    ):
        candidate_index = 1

    tonic, mode = candidates[candidate_index]
    if same_key(tonic, mode, previous_tonic, previous_mode) and len(candidates) > 1:
        tonic, mode = candidates[(candidate_index + 1) % len(candidates)]

    return tonic, mode, True


def scale_pitches(tonic: str, mode: str, min_octave: int, max_octave: int) -> list[int]:
    offsets = MAJOR_SCALE if mode == "major" else MINOR_SCALE
    pitches: list[int] = []
    for octave in range(min_octave, max_octave + 1):
        base = int(pitchModule.Pitch(f"{tonic}{octave}").midi)
        pitches.extend(base + offset for offset in offsets)
    return sorted(pitches)


def build_chord_from_degree(scale: list[int], degree: int, mode: str) -> list[int]:
    root = scale[degree % len(scale)]
    third = scale[(degree + 2) % len(scale)]
    fifth = scale[(degree + 4) % len(scale)]
    if third < root:
        third += 12
    if fifth < root:
        fifth += 12

    if mode == "minor" and degree % len(scale) == 4:
        third += 1

    return [root, third, fifth]


def merged_style_hint(prompt_lower: str) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for keyword, hint in STYLE_HINTS.items():
        if keyword in prompt_lower:
            merged.update(hint)
    return merged


def infer_form(prompt_lower: str, requested_form: str | None) -> str:
    if requested_form:
        return requested_form.lower()

    for candidate in ["waltz", "nocturne", "lullaby", "march", "dramatic"]:
        if candidate in prompt_lower:
            return candidate
    return "miniature"


def infer_mode(prompt_lower: str, style_hint: dict[str, Any]) -> str:
    if style_hint.get("mode") in {"major", "minor"}:
        return str(style_hint["mode"])

    major_score = sum(1 for keyword in MAJOR_KEYWORDS if keyword in prompt_lower)
    minor_score = sum(1 for keyword in MINOR_KEYWORDS if keyword in prompt_lower)
    return "minor" if minor_score > major_score else "major"


def infer_tonic(mode: str, rng: random.Random) -> str:
    choices = MINOR_TONICS if mode == "minor" else MAJOR_TONICS
    return rng.choice(choices)


def infer_density(prompt_lower: str, style_hint: dict[str, Any]) -> float:
    if isinstance(style_hint.get("density"), (float, int)):
        return float(style_hint["density"])

    energetic = sum(1 for keyword in ENERGETIC_KEYWORDS if keyword in prompt_lower)
    calm = sum(1 for keyword in CALM_KEYWORDS if keyword in prompt_lower)
    base = 0.5 + energetic * 0.08 - calm * 0.07
    return clamp(base, 0.25, 0.82)


def default_curve(target_len: int, motion: str) -> list[float]:
    if target_len <= 1:
        return [0.5]

    result: list[float] = []
    for idx in range(target_len):
        ratio = idx / (target_len - 1)
        if motion == "ascending":
            value = 0.22 + ratio * 0.58
        elif motion == "descending":
            value = 0.78 - ratio * 0.58
        elif motion == "wave":
            value = 0.48 + 0.2 * __import__("math").sin(
                ratio * __import__("math").pi * 2.0
            )
        elif motion == "circular":
            value = 0.44 + 0.18 * __import__("math").sin(
                ratio * __import__("math").pi * 2.0 + 0.8
            )
        else:
            value = 0.2 + (1.0 - abs(ratio * 2.0 - 1.0)) * 0.55
        result.append(clamp(value, 0.08, 0.92))
    return result


def resolve_numeric_list(value: Any) -> list[float]:
    if not isinstance(value, list):
        return []
    numbers: list[float] = []
    for item in value:
        try:
            numbers.append(float(item))
        except (TypeError, ValueError):
            continue
    return numbers


def directive_kinds(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()

    kinds: set[str] = set()
    for entry in value:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("kind", "")).strip().lower()
        if kind:
            kinds.add(kind)
    return kinds


def global_directive_kinds(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()

    kinds: set[str] = set()
    for entry in value:
        if not isinstance(entry, dict):
            continue
        section_ids = entry.get("sectionIds")
        if isinstance(section_ids, list) and any(
            str(item).strip() for item in section_ids
        ):
            continue
        kind = str(entry.get("kind", "")).strip().lower()
        if kind:
            kinds.add(kind)
    return kinds


def directive_kinds_by_section(value: Any) -> dict[str, set[str]]:
    if not isinstance(value, list):
        return {}

    mapping: dict[str, set[str]] = {}
    for entry in value:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("kind", "")).strip().lower()
        if not kind:
            continue
        section_ids = entry.get("sectionIds")
        if not isinstance(section_ids, list):
            continue
        for raw_section_id in section_ids:
            section_id = str(raw_section_id).strip()
            if not section_id:
                continue
            mapping.setdefault(section_id, set()).add(kind)
    return mapping


def stretch_curve(values: list[float]) -> list[float]:
    if not values:
        return values

    return [
        clamp(
            0.5 + ((value - 0.5) * 1.25) + (-0.03 if idx % 2 == 0 else 0.03), 0.05, 0.95
        )
        for idx, value in enumerate(values)
    ]


def smooth_curve(values: list[float]) -> list[float]:
    if len(values) <= 2:
        return values[:]

    result: list[float] = []
    for idx, value in enumerate(values):
        previous = values[max(0, idx - 1)]
        following = values[min(len(values) - 1, idx + 1)]
        result.append((previous + value + following) / 3.0)
    return result


def normalize_register_center(value: Any, fallback: float) -> float:
    try:
        register_center = float(value)
    except (TypeError, ValueError):
        return fallback

    return clamp((register_center - 48.0) / 36.0, 0.08, 0.92)


def register_center_to_pitch(value: float) -> int:
    return int(round(48.0 + (clamp(value, 0.08, 0.92) * 36.0)))


def average_pitch_value(values: list[int]) -> int | None:
    if not values:
        return None

    return int(round(sum(values) / len(values)))


def average_numeric_value(values: list[int]) -> int | None:
    if not values:
        return None

    return int(round(sum(values) / len(values)))


def pitch_range(values: list[int]) -> tuple[int | None, int | None]:
    if not values:
        return None, None

    return min(values), max(values)


def extract_bass_pitches(events: list[dict[str, Any]]) -> list[int]:
    pitches: list[int] = []

    for event in events:
        if not isinstance(event, dict):
            continue

        event_type = str(event.get("type") or "note").strip().lower()
        if event_type == "rest":
            continue

        if event_type == "chord":
            chord_pitches = [
                int(value)
                for value in event.get("pitches", [])
                if isinstance(value, (int, float))
            ]
            if chord_pitches:
                pitches.append(min(chord_pitches))
            continue

        pitch_value = event.get("pitch")
        if isinstance(pitch_value, (int, float)):
            pitches.append(int(pitch_value))

    return pitches


def event_pitches(event: Any) -> list[int]:
    if not isinstance(event, dict):
        return []

    event_type = str(event.get("type") or "note").strip().lower()
    if event_type == "rest":
        return []

    if event_type == "chord":
        return [
            int(value)
            for value in event.get("pitches", [])
            if isinstance(value, (int, float))
        ]

    pitch_value = event.get("pitch")
    if isinstance(pitch_value, (int, float)):
        return [int(pitch_value)]

    return []


def extract_role_pitches(
    events: list[dict[str, Any]], voice_roles: set[str]
) -> list[int]:
    pitches: list[int] = []

    for event in events:
        if not isinstance(event, dict):
            continue

        voice_role = normalize_texture_role(event.get("voiceRole"))
        if voice_role not in voice_roles:
            continue

        grouped_pitches = sorted(event_pitches(event))
        if not grouped_pitches:
            continue

        if voice_role == "bass":
            pitches.append(int(grouped_pitches[0]))
            continue

        if voice_role == "inner_voice" and len(grouped_pitches) >= 3:
            pitches.append(int(grouped_pitches[len(grouped_pitches) // 2]))
            continue

        pitches.append(int(grouped_pitches[-1]))

    return pitches


def extract_secondary_line_pitches(events: list[dict[str, Any]]) -> list[int]:
    tagged_secondary = extract_role_pitches(events, {"counterline", "inner_voice"})
    if len(tagged_secondary) >= 2:
        return tagged_secondary

    pitch_groups: list[list[int]] = []
    for event in events:
        pitches = sorted(event_pitches(event))
        if pitches:
            pitch_groups.append(pitches)

    if not pitch_groups:
        return []

    flattened = sorted(pitch for group in pitch_groups for pitch in group)
    if len(flattened) < 2:
        return []

    lower_index = int((len(flattened) - 1) * 0.25)
    bass_anchor = flattened[lower_index]
    bass_ceiling = bass_anchor + 7
    secondary: list[int] = []

    for group in pitch_groups:
        if len(group) >= 2:
            low_pitch = group[0]
            top_pitch = group[-1]
            if (top_pitch - low_pitch) >= 5 or top_pitch >= bass_ceiling:
                secondary.append(int(top_pitch))
            continue

        pitch_value = group[0]
        if pitch_value >= bass_ceiling:
            secondary.append(int(pitch_value))

    return secondary


def pitch_motion_rate(values: list[int]) -> float | None:
    if len(values) < 2:
        return None

    moving_steps = sum(
        1 for index in range(1, len(values)) if values[index] != values[index - 1]
    )
    return round(moving_steps / max(len(values) - 1, 1), 4)


def distinct_pitch_class_count(values: list[int]) -> int:
    return len({int(value) % 12 for value in values})


def resample_pitch_history(values: list[int], target_length: int) -> list[int]:
    if not values or target_length <= 0:
        return []
    if len(values) == 1:
        return [int(values[0]) for _ in range(target_length)]
    if target_length == 1:
        return [int(values[-1])]

    sampled: list[int] = []
    source_length = len(values) - 1
    target_denominator = max(target_length - 1, 1)
    for index in range(target_length):
        mapped_index = int(round((index * source_length) / target_denominator))
        sampled.append(int(values[min(mapped_index, len(values) - 1)]))
    return sampled


def motion_signs(values: list[int]) -> list[int]:
    signs: list[int] = []
    for index in range(1, len(values)):
        delta = values[index] - values[index - 1]
        if delta > 0:
            signs.append(1)
        elif delta < 0:
            signs.append(-1)
        else:
            signs.append(0)
    return signs


def contrary_motion_rate(primary: list[int], secondary: list[int]) -> float | None:
    if len(primary) < 2 or len(secondary) < 2:
        return None

    sample_length = max(2, min(len(primary), len(secondary)))
    primary_sample = resample_pitch_history(primary, sample_length)
    secondary_sample = resample_pitch_history(secondary, sample_length)
    primary_signs = motion_signs(primary_sample)
    secondary_signs = motion_signs(secondary_sample)

    comparable_pairs = [
        (left, right)
        for left, right in zip(primary_signs, secondary_signs)
        if left != 0 and right != 0
    ]
    if not comparable_pairs:
        return 0.0

    contrary_pairs = sum(1 for left, right in comparable_pairs if left == (-1 * right))
    return round(contrary_pairs / len(comparable_pairs), 4)


def bass_pitch_from_event(event: Any) -> int | None:
    if not isinstance(event, dict):
        return None

    event_type = str(event.get("type") or "note").strip().lower()
    if event_type == "rest":
        return None

    if event_type == "chord":
        chord_pitches = [
            int(value)
            for value in event.get("pitches", [])
            if isinstance(value, (int, float))
        ]
        return min(chord_pitches) if chord_pitches else None

    pitch_value = event.get("pitch")
    if isinstance(pitch_value, (int, float)):
        return int(pitch_value)

    return None


def accompaniment_bass_pitch_at_offset(
    events: list[dict[str, Any]], offset: float
) -> int | None:
    current_offset = 0.0
    fallback: int | None = None

    for event in events:
        duration_value = event.get("quarterLength")
        duration = (
            float(duration_value) if isinstance(duration_value, (int, float)) else 1.0
        )
        bass_pitch = bass_pitch_from_event(event)
        if bass_pitch is not None:
            fallback = bass_pitch

        if current_offset <= offset < current_offset + duration:
            return bass_pitch if bass_pitch is not None else fallback

        current_offset += duration

    return fallback


def extract_velocities(events: list[dict[str, Any]]) -> list[int]:
    velocities: list[int] = []

    for event in events:
        if not isinstance(event, dict):
            continue

        velocity = event.get("velocity")
        if isinstance(velocity, (int, float)):
            velocities.append(int(velocity))

    return velocities


def classify_bass_motion_profile(bass_pitches: list[int]) -> str | None:
    if len(bass_pitches) < 2:
        return None

    deltas = [
        abs(bass_pitches[index] - bass_pitches[index - 1])
        for index in range(1, len(bass_pitches))
        if bass_pitches[index] != bass_pitches[index - 1]
    ]
    if not deltas:
        return "pedal"

    if max(deltas) <= 2:
        return "stepwise"

    if (sum(deltas) / len(deltas)) <= 5:
        return "mixed"

    return "leaping"


def classify_cadence_approach(
    bass_pitches: list[int], tonal_center: str | None
) -> str | None:
    tonic, _mode = parse_key(tonal_center)
    tonic_pitch_class = key_pitch_class(tonic)
    if tonic_pitch_class is None or len(bass_pitches) < 2:
        return None

    distinct_pitch_classes: list[int] = []
    for pitch in bass_pitches:
        pitch_class = pitch % 12
        if not distinct_pitch_classes or distinct_pitch_classes[-1] != pitch_class:
            distinct_pitch_classes.append(pitch_class)

    if len(distinct_pitch_classes) < 2:
        return None

    final_pitch_class = distinct_pitch_classes[-1]
    if final_pitch_class != tonic_pitch_class:
        return "other"

    recent_preparations: list[int] = []
    for pitch_class in reversed(distinct_pitch_classes[:-1]):
        if pitch_class in recent_preparations:
            continue
        recent_preparations.append(pitch_class)
        if len(recent_preparations) >= 4:
            break

    if (tonic_pitch_class + 7) % 12 in recent_preparations:
        return "dominant"
    if (tonic_pitch_class + 5) % 12 in recent_preparations:
        return "plagal"
    if tonic_pitch_class in recent_preparations:
        return "tonic"

    return "other"


def resolve_section_style(
    role: str,
    base_style: str,
    energy: float,
    cadence: str | None,
    development_type: str | None = None,
    phrase_function: str | None = None,
    texture_guidance: dict[str, Any] | None = None,
) -> str:
    texture_roles = texture_roles_from_guidance(texture_guidance)
    counterpoint_mode = counterpoint_mode_from_guidance(texture_guidance)
    voice_count = texture_voice_count_from_guidance(texture_guidance)

    if cadence in {"authentic", "plagal"}:
        return "block"
    if phrase_function == "cadential":
        return "block"
    if (
        counterpoint_mode in {"imitative", "contrary_motion", "free"}
        or "counterline" in texture_roles
        or "inner_voice" in texture_roles
        or (voice_count is not None and voice_count >= 3)
    ):
        if role in {"development", "bridge", "variation"}:
            return "broken" if base_style == "block" else base_style
        return "arpeggio" if base_style == "block" else base_style
    if role == "intro":
        return base_style if base_style in {"arpeggio", "broken", "waltz"} else "block"
    if role == "development":
        if development_type == "textural":
            return "waltz" if base_style == "waltz" else "arpeggio"
        if development_type == "free":
            return "march" if energy >= 0.55 else "broken"
        if development_type == "motivic" and base_style == "arpeggio":
            return "broken"
        if energy >= 0.72:
            return "march"
        return "broken" if base_style == "block" else base_style
    if role == "variation":
        if energy >= 0.72:
            return "march"
        return "broken" if base_style == "block" else base_style
    if role in {"theme_b", "bridge", "recap"} and base_style == "block":
        return "broken"
    if role == "cadence":
        return "block"
    return base_style


def resolve_instrument_name(
    instrumentation: Any, preferred_roles: list[str], default_name: str
) -> str:
    if not isinstance(instrumentation, list):
        return default_name

    for entry in instrumentation:
        if not isinstance(entry, dict):
            continue

        roles = entry.get("roles")
        if not isinstance(roles, list):
            continue

        normalized_roles = {str(role).strip().lower() for role in roles}
        if not any(role in normalized_roles for role in preferred_roles):
            continue

        name = str(entry.get("name", "")).strip()
        if name:
            return name

    return default_name


def secondary_texture_roles_from_plan(
    composition_plan: dict[str, Any],
) -> list[str]:
    ordered_roles: list[str] = []

    def collect_roles(texture_guidance: Any) -> None:
        if not isinstance(texture_guidance, dict):
            return

        for role_value in texture_guidance.get("primaryRoles", []):
            role = normalize_texture_role(role_value)
            if role in {"inner_voice", "counterline"} and role not in ordered_roles:
                ordered_roles.append(role)

    collect_roles(composition_plan.get("textureDefaults"))
    sections = composition_plan.get("sections")
    if isinstance(sections, list):
        for section in sections:
            if not isinstance(section, dict):
                continue
            collect_roles(section.get("texture"))

    return ordered_roles


def build_music21_instrument(
    name: str, fallback: instrument.Instrument
) -> instrument.Instrument:
    try:
        return instrument.fromString(name)
    except Exception:
        return fallback


def build_notated_part(
    instrument_name: str, tonic: str, mode: str, time_signature_text: str
) -> stream.Part:
    part = stream.Part()
    part.insert(0, build_music21_instrument(instrument_name, instrument.Piano()))
    part.insert(0, keyModule.Key(tonic, mode))
    part.insert(0, getattr(meter, "TimeSignature")(time_signature_text))
    return part


def build_rest_artifact(quarter_length: float) -> dict[str, Any]:
    return {"type": "rest", "quarterLength": float(quarter_length)}


def split_accompaniment_parts(
    profile: ResolvedProfile, section_artifacts: list[dict[str, Any]]
) -> tuple[stream.Part, stream.Part] | None:
    if not profile.secondary_instrument_name:
        return None

    accompaniment_part = build_notated_part(
        profile.accompaniment_instrument_name,
        profile.tonic,
        profile.mode,
        profile.time_signature,
    )
    secondary_part = build_notated_part(
        profile.secondary_instrument_name,
        profile.tonic,
        profile.mode,
        profile.time_signature,
    )

    routed_secondary = False
    for artifact in section_artifacts:
        for event in artifact.get("accompanimentEvents", []):
            role = normalize_texture_role(event.get("voiceRole"))
            if role in {"inner_voice", "counterline"}:
                append_event_artifact(secondary_part, event)
                append_event_artifact(
                    accompaniment_part,
                    build_rest_artifact(float(event.get("quarterLength") or 1.0)),
                )
                routed_secondary = True
                continue

            append_event_artifact(accompaniment_part, event)
            append_event_artifact(
                secondary_part,
                build_rest_artifact(float(event.get("quarterLength") or 1.0)),
            )

    if not routed_secondary:
        return None

    return accompaniment_part, secondary_part


def describe_score_part_instruments(score: stream.Score) -> list[str]:
    names: list[str] = []
    for part in score.parts:
        try:
            part_instrument = part.getInstrument(returnDefault=True)
        except Exception:
            part_instrument = None

        name = None
        if part_instrument is not None:
            name = getattr(part_instrument, "partName", None) or getattr(
                part_instrument, "instrumentName", None
            )
            if not name:
                try:
                    name = part_instrument.bestName()
                except Exception:
                    name = None
            if not name:
                name = part_instrument.__class__.__name__

        names.append(str(name or "Instrument"))

    return names


def resolve_profile(
    prompt: str,
    requested_key: str | None,
    requested_tempo: int | None,
    requested_form: str | None,
    composition_profile: dict[str, Any],
    composition_plan: dict[str, Any],
    revision_directives: Any,
    section_artifacts: Any,
    attempt_index: int,
    active_seed_value: int,
    stable_seed_value: int,
    rng: random.Random,
) -> ResolvedProfile:
    prompt_lower = prompt.lower()
    plan_form = str(composition_plan.get("form", "")).strip().lower()
    form = infer_form(prompt_lower, requested_form or plan_form or None)
    settings = FORM_SETTINGS.get(form, FORM_SETTINGS["miniature"])
    style_hint = merged_style_hint(prompt_lower)
    risk_profile = normalize_risk_profile(composition_plan.get("riskProfile"))
    structure_visibility = normalize_structure_visibility(
        composition_plan.get("structureVisibility")
    )
    expression_defaults = normalize_expression_guidance(
        composition_plan.get("expressionDefaults")
    )
    texture_defaults = normalize_texture_guidance(
        composition_plan.get("textureDefaults")
    )
    sketch = composition_plan.get("sketch")
    sketch_motif_library = build_sketch_motif_library(sketch)
    sketch_cadence_options = build_sketch_cadence_options(sketch)
    motif_policy = composition_plan.get("motifPolicy")
    if not isinstance(motif_policy, dict):
        motif_policy = {}
    motif_reuse_required = bool(motif_policy.get("reuseRequired"))
    motif_inversion_allowed = bool(motif_policy.get("inversionAllowed"))
    motif_augmentation_allowed = bool(motif_policy.get("augmentationAllowed"))
    motif_diminution_allowed = bool(motif_policy.get("diminutionAllowed"))
    motif_sequence_allowed = bool(motif_policy.get("sequenceAllowed"))

    tonic, mode = parse_key(requested_key)
    if not tonic or not mode:
        mode = infer_mode(prompt_lower, style_hint)
        tonic = infer_tonic(mode, rng)

    density_hint = composition_profile.get("density")
    density = (
        float(density_hint)
        if isinstance(density_hint, (int, float))
        else infer_density(prompt_lower, style_hint)
    )
    density = clamp(density, 0.25, 0.82)
    global_directive_set = global_directive_kinds(revision_directives)
    section_directive_map = directive_kinds_by_section(revision_directives)
    reusable_section_artifacts = (
        normalize_section_artifacts(section_artifacts)
        if section_directive_map and not global_directive_set
        else {}
    )
    apply_global_retry_bias = attempt_index > 1 and (
        not section_directive_map or bool(global_directive_set)
    )

    if apply_global_retry_bias:
        density = clamp(density + min(attempt_index - 1, 2) * 0.02, 0.25, 0.88)
    if "increase_rhythm_variety" in global_directive_set:
        density = clamp(density + 0.08, 0.25, 0.88)

    style = str(style_hint.get("style") or settings["style"])
    motion = str(
        style_hint.get("motion") or ("descending" if mode == "minor" else "arch")
    )
    plan_meter = str(composition_plan.get("meter", "")).strip()
    time_signature = str(
        plan_meter or style_hint.get("time_signature") or settings["time_signature"]
    )
    measures = int(settings["measures"])
    if form == "miniature" and style in {"waltz", "broken"}:
        measures = 12

    target_measures = composition_plan.get("targetMeasures")
    if isinstance(target_measures, (int, float)) and int(target_measures) > 0:
        measures = int(target_measures)
    elif isinstance(composition_plan.get("sections"), list):
        section_measures = 0
        for section in composition_plan["sections"]:
            if isinstance(section, dict):
                section_value = section.get("measures")
                if isinstance(section_value, (int, float)) and int(section_value) > 0:
                    section_measures += int(section_value)
        if section_measures > 0:
            measures = section_measures

    if "extend_length" in global_directive_set and not isinstance(
        target_measures, (int, float)
    ):
        measures += 2

    tension_source = resolve_numeric_list(composition_profile.get("tension"))
    if tension_source:
        tension = normalize(resample_curve(tension_source, measures))
    else:
        tension = normalize(default_curve(measures, "arch"))

    contour_source = resolve_numeric_list(composition_profile.get("pitchContour"))
    if contour_source:
        contour = normalize(resample_curve(contour_source, measures + 1))
    else:
        contour = default_curve(measures + 1, motion)

    if "expand_register" in global_directive_set:
        contour = stretch_curve(contour)
    if "reduce_large_leaps" in global_directive_set:
        contour = smooth_curve(contour)
        tension = smooth_curve(tension)

    contour = [
        clamp(
            contour[idx] * 0.7 + tension[min(idx, len(tension) - 1)] * 0.3, 0.08, 0.92
        )
        for idx in range(len(contour))
    ]

    plan_tempo_value = composition_plan.get("tempo")
    plan_tempo = (
        int(plan_tempo_value) if isinstance(plan_tempo_value, (int, float)) else None
    )
    base_tempo = plan_tempo if plan_tempo is not None else int(settings["tempo"])
    tempo_delta = int(style_hint.get("tempo_delta", 0))
    if requested_tempo is None:
        if any(keyword in prompt_lower for keyword in ENERGETIC_KEYWORDS):
            tempo_delta += 8
        if any(keyword in prompt_lower for keyword in CALM_KEYWORDS):
            tempo_delta -= 8
    tempo = (
        requested_tempo
        if requested_tempo is not None
        else int(clamp(base_tempo + tempo_delta, 56, 144))
    )

    phrase_length = 4 if measures >= 8 else 2
    if time_signature == "3/4" and measures >= 12:
        phrase_length = 6

    measure_styles = [style] * measures
    measure_densities = [density] * measures
    measure_tonics = [tonic] * measures
    measure_modes = [mode] * measures
    measure_harmonic_rhythms = ["medium"] * measures
    measure_harmony_densities: list[str | None] = [None] * measures
    measure_voicing_profiles: list[str | None] = [None] * measures
    cadence_map: list[str | None] = [None] * measures
    measure_section_ids: list[str | None] = [None] * measures
    section_spans: list[SectionSpan] = []
    phrase_breaks = set(range(phrase_length, measures + 1, phrase_length))
    lead_instrument_name = resolve_instrument_name(
        composition_plan.get("instrumentation"), ["lead", "counterline"], "Piano"
    )
    secondary_texture_roles = secondary_texture_roles_from_plan(composition_plan)
    accompaniment_instrument_name = resolve_instrument_name(
        composition_plan.get("instrumentation"),
        ["bass", "pad", "pulse", "accent", "chordal_support"],
        "Piano",
    )
    secondary_instrument_name = None
    if secondary_texture_roles:
        resolved_secondary_instrument_name = resolve_instrument_name(
            composition_plan.get("instrumentation"),
            secondary_texture_roles,
            "",
        )
        if (
            resolved_secondary_instrument_name
            and resolved_secondary_instrument_name != accompaniment_instrument_name
            and resolved_secondary_instrument_name != lead_instrument_name
        ):
            secondary_instrument_name = resolved_secondary_instrument_name

    sections = composition_plan.get("sections")
    if isinstance(sections, list) and sections:
        section_contour: list[float] = []
        section_tension: list[float] = []
        measure_cursor = 0
        previous_section_tonic = tonic
        previous_section_mode = mode
        for section in sections:
            if not isinstance(section, dict):
                continue

            section_measures_value = section.get("measures")
            if not isinstance(section_measures_value, (int, float)):
                continue
            section_measures = int(section_measures_value)
            if section_measures <= 0:
                continue

            role = str(section.get("role", "theme_a")).strip().lower()
            section_density = section.get("density")
            density_value = (
                clamp(float(section_density), 0.25, 0.82)
                if isinstance(section_density, (int, float))
                else density
            )
            section_energy = section.get("energy")
            energy_value = (
                clamp(float(section_energy), 0.08, 0.92)
                if isinstance(section_energy, (int, float))
                else 0.5
            )

            harmonic_plan = section.get("harmonicPlan")
            if not isinstance(harmonic_plan, dict):
                harmonic_plan = {}
            tension_value = harmonic_plan.get("tensionTarget")
            tension_target = (
                clamp(float(tension_value), 0.08, 0.92)
                if isinstance(tension_value, (int, float))
                else energy_value
            )
            harmonic_rhythm = (
                normalize_harmonic_rhythm(harmonic_plan.get("harmonicRhythm"))
                or "medium"
            )
            harmony_density = normalize_harmony_density(
                harmonic_plan.get("harmonyDensity")
            )
            voicing_profile = normalize_voicing_profile(
                harmonic_plan.get("voicingProfile")
            )
            prolongation_mode = normalize_prolongation_mode(
                harmonic_plan.get("prolongationMode")
            )
            tonicization_windows = normalize_tonicization_windows(
                harmonic_plan.get("tonicizationWindows")
            )
            harmonic_color_cues = normalize_harmonic_color_cues(
                harmonic_plan.get("colorCues") or harmonic_plan.get("harmonicColorCues")
            )
            section_tonal_center = str(harmonic_plan.get("tonalCenter") or "").strip()
            explicit_section_tonic, explicit_section_mode = parse_key(
                section_tonal_center
            )
            allow_modulation_raw = harmonic_plan.get("allowModulation")
            allow_modulation = (
                allow_modulation_raw
                if isinstance(allow_modulation_raw, bool)
                else False
            )
            if tonicization_windows and not allow_modulation:
                allow_modulation = True
            section_id = str(
                section.get("id") or f"section-{len(section_spans) + 1}"
            ).strip()
            phrase_span_shape = normalize_phrase_span_shape(
                section.get("phraseSpanShape")
            )
            continuation_pressure = normalize_continuation_pressure(
                section.get("continuationPressure")
            )
            cadential_buildup = normalize_cadential_buildup(
                section.get("cadentialBuildup")
            )

            if prolongation_mode == "pedal" and harmonic_rhythm == "fast":
                harmonic_rhythm = "medium"
            elif prolongation_mode == "sequential" and harmonic_rhythm == "slow":
                harmonic_rhythm = "medium"

            if continuation_pressure == "high":
                density_value = clamp(density_value + 0.08, 0.25, 0.9)
                tension_target = clamp(
                    max(tension_target, energy_value + 0.08), 0.08, 0.94
                )
            elif continuation_pressure == "low":
                density_value = clamp(density_value - 0.04, 0.2, 0.82)
                tension_target = clamp(min(tension_target, energy_value), 0.08, 0.92)
            local_tonic, local_mode, resolved_tonality = select_section_tonality(
                role=role,
                home_tonic=tonic,
                home_mode=mode,
                explicit_tonic=explicit_section_tonic,
                explicit_mode=explicit_section_mode,
                allow_modulation=allow_modulation,
                harmonic_rhythm=harmonic_rhythm,
                directive_set=global_directive_set
                | section_directive_map.get(section_id, set()),
                section_index=len(section_spans),
                previous_tonic=previous_section_tonic,
                previous_mode=previous_section_mode,
            )
            resolved_tonal_center = format_key_name(local_tonic, local_mode)
            cadence = select_section_cadence(
                section_id=section_id,
                explicit_cadence=normalize_cadence(
                    section.get("cadence") or harmonic_plan.get("cadence")
                ),
                sketch_cadence_options=sketch_cadence_options,
                risk_profile=risk_profile,
                structure_visibility=structure_visibility,
                attempt_index=attempt_index,
                directive_set=global_directive_set
                | section_directive_map.get(section_id, set()),
            )
            section_cadence_strength_value = section.get("cadenceStrength")
            cadence_strength = (
                clamp(float(section_cadence_strength_value), 0.0, 1.0)
                if isinstance(section_cadence_strength_value, (int, float))
                else None
            )
            if cadential_buildup == "prepared":
                cadence_strength = max(cadence_strength or 0.0, 0.58)
            elif cadential_buildup == "surging":
                cadence_strength = max(cadence_strength or 0.0, 0.72)
                tension_target = clamp(
                    max(tension_target, energy_value + 0.06), 0.08, 0.96
                )
            development_type = normalize_development_type(
                section.get("developmentType")
            )
            phrase_function = normalize_phrase_function(section.get("phraseFunction"))
            section_texture = merge_texture_guidance(
                texture_defaults,
                normalize_texture_guidance(section.get("texture")),
            )
            section_expression = merge_expression_guidance(
                expression_defaults,
                normalize_expression_guidance(section.get("expression")),
            )
            section_style = resolve_section_style(
                role,
                style,
                energy_value,
                cadence,
                development_type,
                phrase_function,
                section_texture,
            )
            register_target = normalize_register_center(
                section.get("registerCenter"),
                contour[min(measure_cursor, len(contour) - 1)],
            )
            section_start = measure_cursor
            motif_ref = str(section.get("motifRef") or "").strip() or None
            contrast_from = str(section.get("contrastFrom") or "").strip() or None
            if not motif_ref and not contrast_from and motif_reuse_required:
                motif_ref = infer_reused_motif_source(role, section_spans)

            for _ in range(section_measures):
                if measure_cursor >= measures:
                    break
                measure_styles[measure_cursor] = section_style
                measure_densities[measure_cursor] = density_value
                measure_tonics[measure_cursor] = local_tonic
                measure_modes[measure_cursor] = local_mode
                measure_harmonic_rhythms[measure_cursor] = harmonic_rhythm
                measure_harmony_densities[measure_cursor] = harmony_density
                measure_voicing_profiles[measure_cursor] = voicing_profile
                measure_section_ids[measure_cursor] = section_id
                section_contour.append(register_target)
                section_tension.append(tension_target)
                measure_cursor += 1

            if measure_cursor > section_start:
                if phrase_span_shape in {"period", "sentence", "hybrid"}:
                    internal_break = section_start + max(
                        2, (measure_cursor - section_start) // 2
                    )
                    if internal_break < measure_cursor:
                        phrase_breaks.add(internal_break)
                section_spans.append(
                    SectionSpan(
                        id=section_id,
                        role=role,
                        start_measure=section_start,
                        end_measure=measure_cursor,
                        motif_ref=motif_ref,
                        contrast_from=contrast_from,
                        development_type=development_type,
                        recap_mode=normalize_recap_mode(section.get("recapMode")),
                        cadence_strength=cadence_strength,
                        tonal_center=(
                            resolved_tonal_center if resolved_tonality else None
                        ),
                        local_mode=local_mode,
                        harmonic_rhythm=harmonic_rhythm,
                        phrase_function=phrase_function,
                        phrase_span_shape=phrase_span_shape,
                        continuation_pressure=continuation_pressure,
                        cadential_buildup=cadential_buildup,
                        texture_guidance=section_texture,
                        harmony_density=harmony_density,
                        voicing_profile=voicing_profile,
                        prolongation_mode=prolongation_mode,
                        tonicization_windows=tonicization_windows,
                        harmonic_color_cues=harmonic_color_cues,
                        expression_guidance=section_expression,
                        section_style=section_style,
                        planned_register_center=register_center_to_pitch(
                            register_target
                        ),
                    )
                )
                previous_section_tonic = local_tonic
                previous_section_mode = local_mode

            if measure_cursor > 0:
                phrase_breaks.add(measure_cursor)
                cadence_map[measure_cursor - 1] = cadence

        while len(section_contour) < measures:
            section_contour.append(contour[min(len(section_contour), len(contour) - 1)])
        while len(section_tension) < measures:
            section_tension.append(tension[min(len(section_tension), len(tension) - 1)])

        tension = [
            clamp(
                section_tension[idx] * 0.7 + tension[min(idx, len(tension) - 1)] * 0.3,
                0.08,
                0.92,
            )
            for idx in range(measures)
        ]
        contour = section_contour + [
            section_contour[-1] if section_contour else contour[-1]
        ]

    if "strengthen_cadence" in global_directive_set and cadence_map:
        final_cadence = "authentic"
        if risk_profile == "experimental" and structure_visibility in {
            "hidden",
            "complex",
        }:
            final_cadence = "deceptive"
            if cadence_map[min(measures - 1, len(cadence_map) - 1)] == "plagal":
                final_cadence = "plagal"
        elif risk_profile == "exploratory" and structure_visibility == "hidden":
            final_cadence = "plagal"

        cadence_map[min(measures - 1, len(cadence_map) - 1)] = final_cadence

    progression = choose_progression(mode, measures, cadence_map, rng)
    for span_index, span in enumerate(section_spans):
        section_measures = span.end_measure - span.start_measure
        if section_measures <= 0:
            continue

        cadence = cadence_map[min(span.end_measure - 1, len(cadence_map) - 1)]
        current_tonic = measure_tonics[min(span.start_measure, len(measure_tonics) - 1)]
        current_mode = measure_modes[min(span.start_measure, len(measure_modes) - 1)]
        next_span = (
            section_spans[span_index + 1]
            if span_index + 1 < len(section_spans)
            else None
        )
        next_tonic = (
            measure_tonics[min(next_span.start_measure, len(measure_tonics) - 1)]
            if next_span and measure_tonics
            else None
        )
        next_mode = (
            measure_modes[min(next_span.start_measure, len(measure_modes) - 1)]
            if next_span and measure_modes
            else None
        )
        next_cadence = (
            cadence_map[min(next_span.end_measure - 1, len(cadence_map) - 1)]
            if next_span and cadence_map
            else None
        )
        section_progression = build_section_progression(
            current_mode,
            section_measures,
            cadence,
            span.harmonic_rhythm,
            span.role,
            bool(
                span.tonal_center and span.tonal_center != format_key_name(tonic, mode)
            ),
            global_directive_set | section_directive_map.get(span.id, set()),
            rng,
        )
        section_progression, arrival_preparation = (
            align_progression_with_upcoming_arrival(
                section_progression,
                current_tonic=current_tonic,
                current_mode=current_mode,
                current_role=span.role,
                current_cadence=cadence,
                next_tonic=next_tonic,
                next_mode=next_mode,
                next_role=next_span.role if next_span else None,
                next_cadence=next_cadence,
                directive_set=global_directive_set
                | section_directive_map.get(span.id, set()),
            )
        )
        if arrival_preparation and cadence_map and span.end_measure > 0:
            cadence_map[min(span.end_measure - 1, len(cadence_map) - 1)] = "arrival"
        for offset, degree in enumerate(section_progression):
            target_index = span.start_measure + offset
            if target_index >= len(progression):
                break
            progression[target_index] = degree

    contour_span = 18.0 + (6.0 if "expand_register" in global_directive_set else 0.0)
    max_preferred_leap = 5 if "reduce_large_leaps" in global_directive_set else 7
    max_absolute_leap = 9 if "reduce_large_leaps" in global_directive_set else 12
    repetition_penalty = 2.4 if "reduce_repetition" in global_directive_set else 1.2
    pitch_variety_bias = (
        1.15 if "increase_pitch_variety" in global_directive_set else 0.0
    )
    rhythm_variety_bias = (
        1.0 if "increase_rhythm_variety" in global_directive_set else 0.0
    )
    harmonic_stability_bias = 0.55
    cadence_bass_bias = 0.5
    if "stabilize_harmony" in global_directive_set:
        harmonic_stability_bias = 1.35
        cadence_bass_bias = 1.0
    elif "reduce_large_leaps" in global_directive_set:
        harmonic_stability_bias = 0.75

    if "strengthen_cadence" in global_directive_set:
        cadence_bass_bias = max(cadence_bass_bias, 1.35)

    return ResolvedProfile(
        tonic=tonic,
        mode=mode,
        tempo=int(tempo),
        measures=measures,
        time_signature=time_signature,
        style=style,
        contour=contour,
        density=density,
        tension=tension,
        phrase_length=phrase_length,
        motion=motion,
        form=form,
        measure_styles=measure_styles,
        measure_densities=measure_densities,
        measure_tonics=measure_tonics,
        measure_modes=measure_modes,
        measure_harmonic_rhythms=measure_harmonic_rhythms,
        measure_harmony_densities=measure_harmony_densities,
        measure_voicing_profiles=measure_voicing_profiles,
        cadence_map=cadence_map,
        progression_degrees=progression,
        phrase_breaks=phrase_breaks,
        lead_instrument_name=lead_instrument_name,
        accompaniment_instrument_name=accompaniment_instrument_name,
        secondary_instrument_name=secondary_instrument_name,
        measure_section_ids=measure_section_ids,
        section_spans=section_spans,
        expression_defaults=expression_defaults,
        sketch_motif_library=sketch_motif_library,
        motif_reuse_required=motif_reuse_required,
        motif_inversion_allowed=motif_inversion_allowed,
        motif_augmentation_allowed=motif_augmentation_allowed,
        motif_diminution_allowed=motif_diminution_allowed,
        motif_sequence_allowed=motif_sequence_allowed,
        contour_span=contour_span,
        max_preferred_leap=max_preferred_leap,
        max_absolute_leap=max_absolute_leap,
        repetition_penalty=repetition_penalty,
        pitch_variety_bias=pitch_variety_bias,
        rhythm_variety_bias=rhythm_variety_bias,
        harmonic_stability_bias=harmonic_stability_bias,
        cadence_bass_bias=cadence_bass_bias,
        attempt_index=attempt_index,
        active_seed_value=active_seed_value,
        stable_seed_value=stable_seed_value,
        global_directive_kinds=global_directive_set,
        section_directive_kinds=section_directive_map,
        reusable_section_artifacts=reusable_section_artifacts,
    )


def choose_progression(
    mode: str, measures: int, cadence_map: list[str | None], rng: random.Random
) -> list[int]:
    template = rng.choice(MINOR_PROGRESSIONS if mode == "minor" else MAJOR_PROGRESSIONS)
    progression: list[int] = []
    while len(progression) < measures:
        progression.extend(template if not progression else template[:-1])
    progression = progression[:measures]

    for idx, cadence in enumerate(cadence_map[:measures]):
        if not cadence:
            continue

        if idx > 0:
            progression[idx - 1] = 3 if cadence == "plagal" else 4

        if cadence == "half":
            progression[idx] = 4
        elif cadence == "deceptive":
            progression[idx] = 5
        else:
            progression[idx] = 0

    if measures >= 2 and (
        not cadence_map or cadence_map[min(measures - 1, len(cadence_map) - 1)] is None
    ):
        progression[-2] = 4
        progression[-1] = 0
    elif measures == 1:
        progression[-1] = 0
    return progression


def beats_per_measure(time_signature: str) -> int:
    try:
        return max(int(time_signature.split("/")[0]), 1)
    except (ValueError, IndexError):
        return 4


def duration_pattern_score(pattern: list[float]) -> float:
    return (len(set(pattern)) * 3.0) + len(pattern)


def build_event_artifact(
    value: int | list[int],
    quarter_length: float,
    velocity: int,
    voice_role: str | None = None,
) -> dict[str, Any]:
    if isinstance(value, list):
        artifact = {
            "type": "chord",
            "quarterLength": float(quarter_length),
            "pitches": [int(pitch) for pitch in value],
            "velocity": int(velocity),
        }
        normalized_role = normalize_texture_role(voice_role)
        if normalized_role:
            artifact["voiceRole"] = normalized_role
        return artifact

    artifact = {
        "type": "note",
        "quarterLength": float(quarter_length),
        "pitch": int(value),
        "velocity": int(velocity),
    }
    normalized_role = normalize_texture_role(voice_role)
    if normalized_role:
        artifact["voiceRole"] = normalized_role
    return artifact


def append_event_artifact(part: stream.Part, artifact: dict[str, Any]) -> None:
    event_type = str(artifact.get("type") or "note").strip().lower()
    quarter_length = float(artifact.get("quarterLength") or 1.0)
    velocity = artifact.get("velocity")

    if event_type == "rest":
        event = note.Rest(quarterLength=quarter_length)
    elif event_type == "chord":
        event = chord.Chord(
            [int(pitch) for pitch in artifact.get("pitches", [])],
            quarterLength=quarter_length,
        )
        if isinstance(velocity, (int, float)):
            event.volume.velocity = int(velocity)
    else:
        event = note.Note(
            int(artifact.get("pitch") or 60), quarterLength=quarter_length
        )
        if isinstance(velocity, (int, float)):
            event.volume.velocity = int(velocity)

    part.append(event)


def add_event(
    part: stream.Part,
    value: int | list[int],
    quarter_length: float,
    velocity: int,
    voice_role: str | None = None,
) -> dict[str, Any]:
    artifact = build_event_artifact(value, quarter_length, velocity, voice_role)
    append_event_artifact(part, artifact)
    return artifact


def add_pattern_event(
    part: stream.Part,
    pattern_item: dict[str, Any] | int | list[int],
    quarter_length: float,
    velocity: int,
) -> dict[str, Any]:
    if isinstance(pattern_item, dict) and "value" in pattern_item:
        value = pattern_item.get("value")
        if isinstance(value, list):
            return add_event(
                part,
                [int(item) for item in value if isinstance(item, (int, float))],
                quarter_length,
                velocity,
                normalize_texture_role(pattern_item.get("voiceRole")),
            )
        if isinstance(value, (int, float)):
            return add_event(
                part,
                int(value),
                quarter_length,
                velocity,
                normalize_texture_role(pattern_item.get("voiceRole")),
            )

        raise ValueError("Pattern step is missing a valid pitch value")

    if isinstance(pattern_item, list):
        return add_event(
            part,
            [int(item) for item in pattern_item if isinstance(item, (int, float))],
            quarter_length,
            velocity,
        )

    if isinstance(pattern_item, (int, float)):
        return add_event(part, int(pattern_item), quarter_length, velocity)

    raise ValueError("Pattern step must be a tagged step, pitch list, or pitch value")


def root_bass_for_chord(chord_pitches: list[int]) -> int:
    return max(chord_pitches[0] - 12, 28)


def bass_pitch_for_pitch_class(reference_bass: int, desired_pitch_class: int) -> int:
    candidates: list[int] = []
    base_octave = reference_bass // 12

    for octave in range(base_octave - 1, base_octave + 2):
        candidate = (octave * 12) + desired_pitch_class
        while candidate < 28:
            candidate += 12
        candidates.append(candidate)

    return min(candidates, key=lambda candidate: abs(candidate - reference_bass))


def event_value_from_pitches(pitches: list[int]) -> int | list[int]:
    if len(pitches) == 1:
        return pitches[0]
    return [int(pitch) for pitch in pitches]


def resolve_accompaniment_render_style(
    base_style: str, voicing_profile: str | None
) -> str:
    if base_style in {"waltz", "march"}:
        return base_style
    if voicing_profile == "arpeggiated":
        return "arpeggio"
    if voicing_profile == "broken":
        return "broken"
    if voicing_profile == "block":
        return "block"
    return base_style


def upper_support_pitches(chord_pitches: list[int], harmony_density: str) -> list[int]:
    if len(chord_pitches) < 3:
        return chord_pitches[:]
    if harmony_density == "sparse":
        return [chord_pitches[2]]
    if harmony_density == "rich":
        return [chord_pitches[1], chord_pitches[2], chord_pitches[2] + 12]
    return chord_pitches[1:]


def full_chord_pitches(chord_pitches: list[int], harmony_density: str) -> list[int]:
    if len(chord_pitches) < 3:
        return chord_pitches[:]
    if harmony_density == "sparse":
        return [chord_pitches[0], chord_pitches[2]]
    if harmony_density == "rich":
        return chord_pitches[:] + [chord_pitches[2] + 12]
    return chord_pitches[:]


def block_entry_pitches(
    root_bass: int, chord_pitches: list[int], harmony_density: str
) -> list[int]:
    if len(chord_pitches) < 3:
        return [root_bass] + chord_pitches[:1]
    if harmony_density == "sparse":
        return [root_bass]
    if harmony_density == "rich":
        return [root_bass, chord_pitches[1], chord_pitches[2]]
    return [root_bass, chord_pitches[1]]


def linear_accompaniment_pattern(
    chord_pitches: list[int],
    root_bass: int,
    harmony_density: str,
    render_style: str,
) -> list[int]:
    third_pitch = chord_pitches[1] if len(chord_pitches) > 1 else chord_pitches[0]
    fifth_pitch = chord_pitches[2] if len(chord_pitches) > 2 else chord_pitches[-1]
    top_pitch = fifth_pitch + 12

    if harmony_density == "rich":
        if render_style == "arpeggio":
            return [
                root_bass,
                third_pitch,
                fifth_pitch,
                top_pitch,
                fifth_pitch,
                third_pitch,
            ]
        return [
            root_bass,
            third_pitch,
            fifth_pitch,
            third_pitch,
            top_pitch,
            fifth_pitch,
        ]

    if harmony_density == "sparse":
        if render_style == "arpeggio":
            return [root_bass, fifth_pitch, third_pitch, fifth_pitch]
        return [root_bass, third_pitch, fifth_pitch, third_pitch]

    if render_style == "arpeggio":
        return [root_bass, third_pitch, fifth_pitch, top_pitch]
    return [root_bass, third_pitch, fifth_pitch, third_pitch]


def section_span_for_measure(
    profile: ResolvedProfile, measure_index: int
) -> SectionSpan | None:
    section_id = profile.measure_section_ids[
        min(measure_index, len(profile.measure_section_ids) - 1)
    ]
    if not section_id:
        return None

    return next(
        (
            candidate
            for candidate in profile.section_spans
            if candidate.id == section_id
        ),
        None,
    )


def measure_contour_direction(profile: ResolvedProfile, measure_index: int) -> int:
    if not profile.contour:
        return 0

    prev_index = max(0, measure_index - 1)
    next_index = min(len(profile.contour) - 1, measure_index + 1)
    contour_delta = profile.contour[next_index] - profile.contour[prev_index]
    if abs(contour_delta) < 0.08:
        return 0
    return 1 if contour_delta > 0 else -1


def counterline_texture_bias_for_measure(
    profile: ResolvedProfile, measure_index: int
) -> tuple[float, str, str | None]:
    span = section_span_for_measure(profile, measure_index)
    if not span or not section_requests_independent_texture(span.texture_guidance):
        return 0.0, "none", None

    texture_roles = texture_roles_from_guidance(span.texture_guidance)
    counterpoint_mode = counterpoint_mode_from_guidance(span.texture_guidance)
    voice_count = texture_voice_count_from_guidance(span.texture_guidance)
    bias = 0.34
    preferred_secondary_role = None

    if "counterline" in texture_roles or "inner_voice" in texture_roles:
        bias += 0.12
    if counterpoint_mode == "contrary_motion":
        bias += 0.18
    elif counterpoint_mode in {"imitative", "free"}:
        bias += 0.1
    if voice_count is not None and voice_count >= 3:
        bias += 0.08
    if span.id and "clarify_texture_plan" in effective_directive_kinds_for_section(
        profile, span.id
    ):
        bias += 0.32
    if span.role in {"development", "variation", "bridge"}:
        bias += 0.08

    if "counterline" in texture_roles:
        preferred_secondary_role = "counterline"
    elif "inner_voice" in texture_roles:
        preferred_secondary_role = "inner_voice"
    elif counterpoint_mode == "imitative":
        preferred_secondary_role = "counterline"
    elif (
        counterpoint_mode in {"contrary_motion", "free"}
        and voice_count is not None
        and voice_count >= 3
    ):
        preferred_secondary_role = "inner_voice"

    return clamp(bias, 0.0, 1.0), counterpoint_mode, preferred_secondary_role


def counterline_direction_for_measure(
    profile: ResolvedProfile, measure_index: int, counterpoint_mode: str
) -> int:
    contour_direction = measure_contour_direction(profile, measure_index)
    if counterpoint_mode == "imitative" and contour_direction != 0:
        return contour_direction
    if contour_direction != 0:
        return -contour_direction
    return -1 if measure_index % 2 == 0 else 1


def counterline_upper_pitches(
    chord_pitches: list[int], root_bass: int, secondary_role: str | None = None
) -> list[int]:
    preferred_role = normalize_texture_role(secondary_role)
    source_pitches = chord_pitches[1:] if len(chord_pitches) > 1 else chord_pitches
    minimum_pitch = root_bass + 9
    maximum_pitch = root_bass + 31

    if preferred_role == "inner_voice":
        source_pitches = chord_pitches[:] if chord_pitches else [root_bass + 12]
        minimum_pitch = root_bass + 5
        maximum_pitch = root_bass + 19

    pitch_classes = sorted({int(pitch) % 12 for pitch in source_pitches})
    unique_pitches: list[int] = []
    for octave in range((minimum_pitch // 12) - 1, (maximum_pitch // 12) + 2):
        for pitch_class in pitch_classes:
            candidate = (octave * 12) + pitch_class
            if minimum_pitch <= candidate <= maximum_pitch:
                unique_pitches.append(int(candidate))

    unique_pitches = sorted(set(unique_pitches))
    if not unique_pitches:
        fallback_pitch = root_bass + (12 if preferred_role == "inner_voice" else 19)
        unique_pitches = [
            int(
                clamp(float(fallback_pitch), float(minimum_pitch), float(maximum_pitch))
            )
        ]

    return unique_pitches


def counterline_line_sequence(
    upper_pitches: list[int], direction: int, measure_index: int, steps: int
) -> list[int]:
    if not upper_pitches or steps <= 0:
        return []

    if direction >= 0:
        start_index = 0 if measure_index % 2 == 0 or len(upper_pitches) < 4 else 1
        phrase = [
            upper_pitches[min(start_index, len(upper_pitches) - 1)],
            upper_pitches[min(start_index + 1, len(upper_pitches) - 1)],
            upper_pitches[min(start_index + 2, len(upper_pitches) - 1)],
            upper_pitches[min(start_index + 1, len(upper_pitches) - 1)],
        ]
    else:
        start_index = (
            len(upper_pitches) - 1
            if measure_index % 2 == 0 or len(upper_pitches) < 4
            else len(upper_pitches) - 2
        )
        phrase = [
            upper_pitches[max(0, start_index)],
            upper_pitches[max(0, start_index - 1)],
            upper_pitches[max(0, start_index - 2)],
            upper_pitches[max(0, start_index - 1)],
        ]

    return [int(phrase[index % len(phrase)]) for index in range(steps)]


def contrary_motion_line_sequence(
    upper_pitches: list[int], direction: int, steps: int
) -> list[int]:
    if not upper_pitches or steps <= 0:
        return []

    ordered_pitches = (
        upper_pitches[:] if direction >= 0 else list(reversed(upper_pitches))
    )
    if len(ordered_pitches) == 1 or steps == 1:
        return [int(ordered_pitches[0]) for _ in range(steps)]

    start_pitch = int(ordered_pitches[0])
    end_pitch = int(ordered_pitches[-1])
    sequence: list[int] = []
    for step_index in range(steps):
        progress = step_index / max(steps - 1, 1)
        interpolated_pitch = int(
            round(start_pitch + ((end_pitch - start_pitch) * progress))
        )
        sequence.append(interpolated_pitch)

    return sequence


def imitative_counterline_sequence(
    upper_pitches: list[int],
    root_bass: int,
    motif_pattern: list[int],
    motif_offset: int,
    steps: int,
) -> list[int]:
    if not upper_pitches or not motif_pattern or steps <= 0:
        return []

    anchor_index = min(max(len(upper_pitches) // 2, 0), len(upper_pitches) - 1)
    anchor_pitch = int(upper_pitches[anchor_index])
    min_pitch = int(root_bass + 7)
    max_pitch = int(root_bass + 31)

    while anchor_pitch < min_pitch:
        anchor_pitch += 12
    while anchor_pitch > max_pitch:
        anchor_pitch -= 12

    sequence: list[int] = []
    pattern_length = len(motif_pattern)
    previous_pitch = anchor_pitch
    for step_index in range(steps):
        interval = motif_pattern[(motif_offset + step_index) % pattern_length]
        desired_pitch = anchor_pitch + interval

        while desired_pitch < min_pitch:
            desired_pitch += 12
        while desired_pitch > max_pitch:
            desired_pitch -= 12

        octave_variants = [int(desired_pitch)]
        if desired_pitch - 12 >= min_pitch:
            octave_variants.append(int(desired_pitch - 12))
        if desired_pitch + 12 <= max_pitch:
            octave_variants.append(int(desired_pitch + 12))

        snapped_pitch = min(
            sorted(set(octave_variants)),
            key=lambda candidate: (
                abs(candidate - desired_pitch),
                abs(candidate - previous_pitch),
            ),
        )
        sequence.append(int(snapped_pitch))
        previous_pitch = int(snapped_pitch)

    return sequence


def build_pattern_step(
    value: int | list[int], voice_role: str | None = None
) -> dict[str, Any]:
    step: dict[str, Any] = {"value": value}
    normalized_role = normalize_texture_role(voice_role)
    if normalized_role:
        step["voiceRole"] = normalized_role
    return step


def counterline_accompaniment_pattern(
    chord_pitches: list[int],
    root_bass: int,
    profile: ResolvedProfile,
    measure_index: int,
    steps: int,
    counterpoint_mode: str,
    texture_bias: float,
    secondary_role: str | None = None,
    motif_pattern: list[int] | None = None,
    motif_offset: int = 0,
) -> list[dict[str, Any]]:
    explicit_secondary_role = normalize_texture_role(secondary_role)
    moving_voice_role = explicit_secondary_role or "counterline"
    upper_pitches = counterline_upper_pitches(
        chord_pitches, root_bass, explicit_secondary_role
    )
    direction = counterline_direction_for_measure(
        profile, measure_index, counterpoint_mode
    )
    line_steps = max(1, (steps + 1) // 2) if counterpoint_mode == "imitative" else steps
    if counterpoint_mode == "imitative" and motif_pattern:
        line_sequence = imitative_counterline_sequence(
            upper_pitches,
            root_bass,
            motif_pattern,
            motif_offset,
            line_steps,
        )
    elif counterpoint_mode == "contrary_motion":
        line_sequence = contrary_motion_line_sequence(
            upper_pitches,
            direction,
            line_steps,
        )
    else:
        line_sequence = counterline_line_sequence(
            upper_pitches,
            direction,
            measure_index,
            line_steps,
        )
    include_bass_reentry = (
        texture_bias >= 0.72
        and counterpoint_mode != "imitative"
        and explicit_secondary_role is None
    )
    pattern: list[dict[str, Any]] = []

    if counterpoint_mode == "imitative":
        for index in range(steps):
            if index % 2 == 0:
                line_index = min(index // 2, len(line_sequence) - 1)
                pattern.append(
                    build_pattern_step(line_sequence[line_index], moving_voice_role)
                )
            else:
                pattern.append(build_pattern_step(root_bass, "bass"))
        return pattern

    for index, line_pitch in enumerate(line_sequence):
        if index == 0:
            pattern.append(build_pattern_step(root_bass, "bass"))
            continue

        if include_bass_reentry and index % 2 == 0 and (steps <= 4 or index % 4 == 0):
            pattern.append(build_pattern_step([root_bass, line_pitch]))
            continue

        pattern.append(build_pattern_step(line_pitch, moving_voice_role))

    return pattern


def dynamic_velocity_offset(level: str | None) -> float:
    if not level:
        return 0.0
    return float(DYNAMIC_LEVEL_VELOCITY_OFFSETS.get(level, 0))


def interpolate_value(start: float, end: float, ratio: float) -> float:
    return start + ((end - start) * clamp(ratio, 0.0, 1.0))


def resolve_measure_expression_state(
    profile: ResolvedProfile, measure_index: int
) -> dict[str, Any] | None:
    span = section_span_for_measure(profile, measure_index)
    expression = span.expression_guidance if span else profile.expression_defaults
    if not expression:
        return None

    if span:
        local_measure_index = max(0, measure_index - span.start_measure)
        section_measures = max(1, span.end_measure - span.start_measure)
    else:
        local_measure_index = measure_index
        section_measures = max(1, profile.measures)

    dynamics_value = expression.get("dynamics")
    dynamics: dict[str, Any] = (
        dynamics_value if isinstance(dynamics_value, dict) else {}
    )
    start_bias = dynamic_velocity_offset(dynamics.get("start"))
    peak_bias = dynamic_velocity_offset(
        dynamics.get("peak") or dynamics.get("start") or dynamics.get("end")
    )
    end_bias = dynamic_velocity_offset(
        dynamics.get("end") or dynamics.get("peak") or dynamics.get("start")
    )
    if section_measures <= 1:
        dynamic_bias = peak_bias
    else:
        peak_index = max(0, min(section_measures - 1, section_measures // 2))
        if local_measure_index <= peak_index:
            denominator = max(1, peak_index)
            dynamic_bias = interpolate_value(
                start_bias, peak_bias, local_measure_index / denominator
            )
        else:
            denominator = max(1, section_measures - peak_index - 1)
            dynamic_bias = interpolate_value(
                peak_bias,
                end_bias,
                (local_measure_index - peak_index) / denominator,
            )

    hairpins_value = dynamics.get("hairpins")
    hairpins: list[dict[str, Any]] = (
        [hairpin for hairpin in hairpins_value if isinstance(hairpin, dict)]
        if isinstance(hairpins_value, list)
        else []
    )
    for hairpin in hairpins:
        start_measure = hairpin.get("startMeasure")
        end_measure = hairpin.get("endMeasure")
        start_index = (
            max(0, int(start_measure) - 1)
            if isinstance(start_measure, (int, float))
            else 0
        )
        end_index = (
            min(section_measures - 1, int(end_measure) - 1)
            if isinstance(end_measure, (int, float))
            else (section_measures - 1)
        )
        if local_measure_index < start_index or local_measure_index > end_index:
            continue

        span_len = max(1, end_index - start_index)
        progress = (local_measure_index - start_index) / span_len
        target_bias = dynamic_velocity_offset(
            normalize_dynamic_level(hairpin.get("target"))
        )
        shape = str(hairpin.get("shape") or "").strip().lower()
        if (
            target_bias == 0.0
            and normalize_dynamic_level(hairpin.get("target")) is None
        ):
            target_bias = dynamic_bias + (6.0 if shape == "crescendo" else -6.0)

        delta = target_bias - dynamic_bias
        dynamic_bias += delta * progress

    articulation = set(expression.get("articulation") or [])
    character = set(expression.get("character") or [])
    sustain_bias = clamp(float(expression.get("sustainBias") or 0.0), -1.0, 1.0)
    accent_bias = clamp(float(expression.get("accentBias") or 0.0), -1.0, 1.0)
    rhythm_density_bias = 0.0

    for tag in articulation:
        effects = ARTICULATION_BIAS_EFFECTS.get(tag)
        if not effects:
            continue
        dynamic_bias += float(effects.get("dynamic") or 0.0)
        sustain_bias += float(effects.get("sustain") or 0.0)
        accent_bias += float(effects.get("accent") or 0.0)
        rhythm_density_bias += float(effects.get("rhythm") or 0.0)

    for tag in character:
        effects = CHARACTER_BIAS_EFFECTS.get(tag)
        if not effects:
            continue
        dynamic_bias += float(effects.get("dynamic") or 0.0)
        sustain_bias += float(effects.get("sustain") or 0.0)
        accent_bias += float(effects.get("accent") or 0.0)
        rhythm_density_bias += float(effects.get("rhythm") or 0.0)

    phrase_peaks_value = expression.get("phrasePeaks")
    phrase_peaks: list[int] = (
        [int(value) for value in phrase_peaks_value if isinstance(value, (int, float))]
        if isinstance(phrase_peaks_value, list)
        else []
    )
    phrase_peak = (local_measure_index + 1) in phrase_peaks
    if phrase_peak:
        dynamic_bias += 4.0
        accent_bias += 0.18

    return {
        "dynamicBias": dynamic_bias,
        "melodyVelocityBias": dynamic_bias,
        "accompanimentVelocityBias": (dynamic_bias * 0.65),
        "sustainBias": clamp(sustain_bias, -1.0, 1.0),
        "accentBias": clamp(accent_bias, -1.0, 1.0),
        "rhythmDensityBias": rhythm_density_bias,
        "articulation": articulation,
        "character": character,
        "phrasePeak": phrase_peak,
    }


def resolved_note_duration(
    duration: float,
    expression_state: dict[str, Any] | None,
    strong_beat: bool,
    phrase_end: bool,
) -> float:
    if not expression_state:
        return duration

    articulation = expression_state.get("articulation") or set()
    character = expression_state.get("character") or set()
    gate_ratio = 0.96 + (float(expression_state.get("sustainBias") or 0.0) * 0.2)

    for tag in articulation:
        gate_ratio += float(ARTICULATION_GATE_OFFSETS.get(tag) or 0.0)
    for tag in character:
        gate_ratio += float(CHARACTER_GATE_OFFSETS.get(tag) or 0.0)
    if strong_beat and "accent" in articulation:
        gate_ratio -= 0.04
    if phrase_end and articulation.isdisjoint(DETACHED_ARTICULATION_TAGS):
        gate_ratio = max(gate_ratio, 0.98)

    gate_ratio = clamp(gate_ratio, 0.35, 1.0)
    if gate_ratio >= 0.995:
        return duration

    return max(0.25, round(duration * gate_ratio, 3))


def render_accompaniment_measure(
    part: stream.Part,
    chord_pitches: list[int],
    profile: ResolvedProfile,
    measure_index: int,
    rng: random.Random,
    motif_pattern: list[int] | None = None,
    motif_offset: int = 0,
) -> list[dict[str, Any]]:
    beats = beats_per_measure(profile.time_signature)
    root_bass = root_bass_for_chord(chord_pitches)
    upper_chord = chord_pitches[1:] if len(chord_pitches) > 2 else chord_pitches
    expression_state = resolve_measure_expression_state(profile, measure_index)
    base_velocity = 54 + int(
        profile.tension[min(measure_index, len(profile.tension) - 1)] * 10
    )
    if expression_state:
        base_velocity += int(
            round(float(expression_state.get("accompanimentVelocityBias") or 0.0))
        )
    base_velocity = int(clamp(base_velocity, 40, 116))
    style = profile.measure_styles[min(measure_index, len(profile.measure_styles) - 1)]
    harmony_density = profile.measure_harmony_densities[
        min(measure_index, len(profile.measure_harmony_densities) - 1)
    ]
    voicing_profile = profile.measure_voicing_profiles[
        min(measure_index, len(profile.measure_voicing_profiles) - 1)
    ]
    cadence_style = profile.cadence_map[
        min(measure_index, len(profile.cadence_map) - 1)
    ]
    events: list[dict[str, Any]] = []
    arrival_preparation = cadence_style == "arrival"
    texture_bias, counterpoint_mode, secondary_role = (
        counterline_texture_bias_for_measure(profile, measure_index)
    )

    if harmony_density or voicing_profile:
        resolved_density = harmony_density or "medium"
        resolved_style = resolve_accompaniment_render_style(style, voicing_profile)
        support_value = event_value_from_pitches(
            upper_support_pitches(chord_pitches, resolved_density)
        )
        full_chord_value = event_value_from_pitches(
            full_chord_pitches(chord_pitches, resolved_density)
        )
        block_entry_value = event_value_from_pitches(
            block_entry_pitches(root_bass, chord_pitches, resolved_density)
        )

        if arrival_preparation:
            cadence_velocity = base_velocity + int(6 + profile.cadence_bass_bias * 2)

            if beats == 2:
                events.append(add_event(part, support_value, 1.0, base_velocity + 2))
                events.append(add_event(part, root_bass, 1.0, cadence_velocity))
                return events

            if beats == 3:
                events.append(add_event(part, root_bass, 1.0, cadence_velocity - 1))
                events.append(add_event(part, support_value, 1.0, base_velocity + 1))
                events.append(add_event(part, root_bass, 1.0, cadence_velocity))
                return events

            events.append(add_event(part, root_bass, 1.0, cadence_velocity - 1))
            events.append(add_event(part, support_value, 1.0, base_velocity + 1))
            events.append(
                add_event(part, full_chord_value, max(beats - 3, 1), base_velocity + 3)
            )
            events.append(add_event(part, root_bass, 1.0, cadence_velocity))
            return events

        if cadence_style and profile.cadence_bass_bias >= 1.0:
            cadence_velocity = base_velocity + int(6 + profile.cadence_bass_bias * 2)
            tonic_pitch_class = chord_pitches[0] % 12
            preparation_pitch_class = (tonic_pitch_class + 7) % 12
            if cadence_style == "plagal":
                preparation_pitch_class = (tonic_pitch_class + 5) % 12
            preparation_bass = bass_pitch_for_pitch_class(
                root_bass, preparation_pitch_class
            )

            if beats == 2:
                events.append(add_event(part, preparation_bass, 1.0, cadence_velocity))
                events.append(add_event(part, full_chord_value, 1.0, base_velocity + 4))
                return events

            if beats == 3:
                events.append(add_event(part, preparation_bass, 1.0, cadence_velocity))
                events.append(add_event(part, support_value, 1.0, base_velocity + 1))
                events.append(add_event(part, full_chord_value, 1.0, base_velocity + 4))
                return events

            events.append(add_event(part, preparation_bass, 1.0, cadence_velocity))
            events.append(add_event(part, support_value, 1.0, base_velocity + 1))
            events.append(add_event(part, root_bass, 1.0, cadence_velocity - 1))
            events.append(
                add_event(part, full_chord_value, max(beats - 3, 1), base_velocity + 4)
            )
            return events

        if texture_bias >= 0.7 and resolved_style not in {"arpeggio", "broken"}:
            resolved_style = "broken"
        elif (
            counterpoint_mode == "imitative"
            and motif_pattern
            and resolved_style not in {"arpeggio", "broken"}
        ):
            resolved_style = "broken"

        if resolved_style == "waltz":
            events.append(add_event(part, root_bass, 1.0, base_velocity + 6))
            for _ in range(max(beats - 1, 1)):
                events.append(add_event(part, support_value, 1.0, base_velocity))
            return events

        if resolved_style == "arpeggio":
            steps = int(beats / 0.5)
            pattern = (
                counterline_accompaniment_pattern(
                    chord_pitches,
                    root_bass,
                    profile,
                    measure_index,
                    steps,
                    counterpoint_mode,
                    texture_bias,
                    secondary_role,
                    motif_pattern,
                    motif_offset,
                )
                if texture_bias >= 0.35
                else linear_accompaniment_pattern(
                    chord_pitches,
                    root_bass,
                    resolved_density,
                    resolved_style,
                )
            )
            for idx in range(steps):
                events.append(
                    add_pattern_event(
                        part,
                        pattern[idx % len(pattern)],
                        0.5,
                        base_velocity + (2 if idx == 0 else 0),
                    )
                )
            return events

        if resolved_style == "march":
            for beat in range(beats):
                if beat % 2 == 0:
                    events.append(add_event(part, root_bass, 1.0, base_velocity + 8))
                else:
                    events.append(add_event(part, support_value, 1.0, base_velocity))
            return events

        if resolved_style == "broken":
            steps = int(beats / 0.5)
            pattern = (
                counterline_accompaniment_pattern(
                    chord_pitches,
                    root_bass,
                    profile,
                    measure_index,
                    steps,
                    counterpoint_mode,
                    texture_bias,
                    secondary_role,
                    motif_pattern,
                    motif_offset,
                )
                if texture_bias >= 0.35
                else linear_accompaniment_pattern(
                    chord_pitches,
                    root_bass,
                    resolved_density,
                    resolved_style,
                )
            )
            for idx in range(steps):
                events.append(
                    add_pattern_event(
                        part,
                        pattern[idx % len(pattern)],
                        0.5,
                        base_velocity + (3 if idx == 0 else 0),
                    )
                )
            return events

        if beats == 2:
            events.append(add_event(part, root_bass, 1.0, base_velocity + 4))
            events.append(add_event(part, full_chord_value, 1.0, base_velocity))
        else:
            events.append(
                add_event(part, block_entry_value, beats / 2.0, base_velocity + 4)
            )
            events.append(add_event(part, full_chord_value, beats / 2.0, base_velocity))

        return events

    if arrival_preparation:
        cadence_velocity = base_velocity + int(6 + profile.cadence_bass_bias * 2)

        if beats == 2:
            events.append(add_event(part, upper_chord, 1.0, base_velocity + 2))
            events.append(add_event(part, root_bass, 1.0, cadence_velocity))
            return events

        if beats == 3:
            events.append(add_event(part, root_bass, 1.0, cadence_velocity - 1))
            events.append(add_event(part, upper_chord, 1.0, base_velocity + 1))
            events.append(add_event(part, root_bass, 1.0, cadence_velocity))
            return events

        events.append(add_event(part, root_bass, 1.0, cadence_velocity - 1))
        events.append(add_event(part, upper_chord, 1.0, base_velocity + 1))
        events.append(
            add_event(part, chord_pitches, max(beats - 3, 1), base_velocity + 3)
        )
        events.append(add_event(part, root_bass, 1.0, cadence_velocity))
        return events

    if cadence_style and profile.cadence_bass_bias >= 1.0:
        cadence_velocity = base_velocity + int(6 + profile.cadence_bass_bias * 2)
        tonic_pitch_class = chord_pitches[0] % 12
        preparation_pitch_class = (tonic_pitch_class + 7) % 12
        if cadence_style == "plagal":
            preparation_pitch_class = (tonic_pitch_class + 5) % 12
        preparation_bass = bass_pitch_for_pitch_class(
            root_bass, preparation_pitch_class
        )

        if beats == 2:
            events.append(add_event(part, preparation_bass, 1.0, cadence_velocity))
            events.append(add_event(part, chord_pitches, 1.0, base_velocity + 4))
            return events

        if beats == 3:
            events.append(add_event(part, preparation_bass, 1.0, cadence_velocity))
            events.append(add_event(part, upper_chord, 1.0, base_velocity + 1))
            events.append(add_event(part, chord_pitches, 1.0, base_velocity + 4))
            return events

        events.append(add_event(part, preparation_bass, 1.0, cadence_velocity))
        events.append(add_event(part, upper_chord, 1.0, base_velocity + 1))
        events.append(add_event(part, root_bass, 1.0, cadence_velocity - 1))
        events.append(
            add_event(part, chord_pitches, max(beats - 3, 1), base_velocity + 4)
        )
        return events

    if texture_bias >= 0.7 and style not in {"arpeggio", "broken"}:
        style = "broken"
    elif (
        counterpoint_mode == "imitative"
        and motif_pattern
        and style not in {"arpeggio", "broken"}
    ):
        style = "broken"

    if style == "waltz":
        events.append(add_event(part, root_bass, 1.0, base_velocity + 6))
        for _ in range(max(beats - 1, 1)):
            events.append(add_event(part, upper_chord, 1.0, base_velocity))
        return events

    if style == "arpeggio":
        steps = int(beats / 0.5)
        pattern = (
            counterline_accompaniment_pattern(
                chord_pitches,
                root_bass,
                profile,
                measure_index,
                steps,
                counterpoint_mode,
                texture_bias,
                secondary_role,
                motif_pattern,
                motif_offset,
            )
            if texture_bias >= 0.35
            else [root_bass, chord_pitches[1], chord_pitches[2], chord_pitches[1]]
        )
        for idx in range(steps):
            events.append(
                add_pattern_event(
                    part,
                    pattern[idx % len(pattern)],
                    0.5,
                    base_velocity + (2 if idx == 0 else 0),
                )
            )
        return events

    if style == "march":
        for beat in range(beats):
            if beat % 2 == 0:
                events.append(add_event(part, root_bass, 1.0, base_velocity + 8))
            else:
                events.append(add_event(part, upper_chord, 1.0, base_velocity))
        return events

    if style == "broken":
        steps = int(beats / 0.5)
        pattern = (
            counterline_accompaniment_pattern(
                chord_pitches,
                root_bass,
                profile,
                measure_index,
                steps,
                counterpoint_mode,
                texture_bias,
                secondary_role,
                motif_pattern,
                motif_offset,
            )
            if texture_bias >= 0.35
            else [root_bass, chord_pitches[1], chord_pitches[2], chord_pitches[1]]
        )
        for idx in range(steps):
            events.append(
                add_pattern_event(
                    part,
                    pattern[idx % len(pattern)],
                    0.5,
                    base_velocity + (3 if idx == 0 else 0),
                )
            )
        return events

    if beats == 2:
        events.append(add_event(part, root_bass, 1.0, base_velocity + 4))
        events.append(add_event(part, chord_pitches, 1.0, base_velocity))
    else:
        events.append(
            add_event(
                part, [root_bass, chord_pitches[1]], beats / 2.0, base_velocity + 4
            )
        )
        events.append(add_event(part, chord_pitches, beats / 2.0, base_velocity))

    return events


def choose_duration_pattern(
    profile: ResolvedProfile, measure_index: int, rng: random.Random
) -> list[float]:
    beats = beats_per_measure(profile.time_signature)
    density = profile.measure_densities[
        min(measure_index, len(profile.measure_densities) - 1)
    ]
    harmonic_rhythm = profile.measure_harmonic_rhythms[
        min(measure_index, len(profile.measure_harmonic_rhythms) - 1)
    ]
    style = profile.measure_styles[min(measure_index, len(profile.measure_styles) - 1)]
    expression_state = resolve_measure_expression_state(profile, measure_index)

    if expression_state:
        density = clamp(
            density + float(expression_state.get("rhythmDensityBias") or 0.0),
            0.22,
            0.9,
        )

    if harmonic_rhythm == "slow":
        density = min(density, 0.48)
    elif harmonic_rhythm == "fast":
        density = max(density, 0.6)

    if beats == 2:
        low_patterns = [[1.0, 1.0], [0.5, 1.5]]
        mid_patterns = [[0.5, 0.5, 1.0], [1.0, 0.5, 0.5]]
        high_patterns = [[0.5, 0.5, 0.5, 0.5]]
    elif beats == 3:
        low_patterns = [[1.0, 1.0, 1.0], [1.5, 0.5, 1.0]]
        mid_patterns = [[0.5, 0.5, 1.0, 1.0], [1.0, 0.5, 0.5, 1.0]]
        high_patterns = [[0.5, 0.5, 0.5, 0.5, 1.0]]
    else:
        low_patterns = [[1.0, 1.0, 2.0], [2.0, 1.0, 1.0], [1.0, 1.0, 1.0, 1.0]]
        mid_patterns = [
            [0.5, 0.5, 1.0, 1.0, 1.0],
            [1.0, 0.5, 0.5, 1.0, 1.0],
            [1.5, 0.5, 1.0, 1.0],
        ]
        high_patterns = [[0.5, 0.5, 0.5, 0.5, 1.0, 1.0], [0.5, 0.5, 1.0, 0.5, 0.5, 1.0]]

    if style in {"arpeggio", "broken"}:
        density = max(density, 0.55)
    elif style == "march":
        density = min(density, 0.62)

    if density < 0.38:
        patterns = low_patterns
    elif density < 0.62:
        patterns = mid_patterns
    else:
        patterns = high_patterns

    if profile.rhythm_variety_bias > 0:
        if density < 0.62:
            patterns = mid_patterns + high_patterns
        else:
            patterns = high_patterns + mid_patterns
        patterns = sorted(
            patterns,
            key=lambda pattern: (duration_pattern_score(pattern), len(pattern)),
            reverse=True,
        )
        return rng.choice(patterns[: max(1, min(3, len(patterns)))])

    return rng.choice(patterns)


def note_for_pitch_class(
    scale: list[int], desired_pitch_class: int, target: float
) -> int:
    candidates = [pitch for pitch in scale if pitch % 12 == desired_pitch_class]
    if not candidates:
        return min(scale, key=lambda pitch: abs(pitch - target))
    return min(candidates, key=lambda pitch: abs(pitch - target))


def closest_scale_pitch(scale: list[int], target: float) -> int:
    return min(scale, key=lambda pitch: abs(pitch - target))


def choose_motif_pitch(
    scale: list[int],
    desired_pitch: float,
    prev_pitch: int | None,
    bass_pitch: int | None,
    previous_bass_pitch: int | None,
    strong_beat: bool,
    direction_bias: int,
    profile: ResolvedProfile,
    rng: random.Random,
) -> int:
    if not scale:
        return int(round(desired_pitch))

    ordered_candidates = sorted(scale, key=lambda pitch: abs(pitch - desired_pitch))
    candidate_limit = max(1, min(7, len(ordered_candidates)))
    scored: list[tuple[float, int, bool]] = []

    for candidate in ordered_candidates[:candidate_limit]:
        score = abs(candidate - desired_pitch) * 0.42
        parallel_risk = creates_parallel_perfect_motion(
            candidate,
            prev_pitch,
            bass_pitch,
            previous_bass_pitch,
        )

        if prev_pitch is not None:
            interval = candidate - prev_pitch
            score += abs(interval) * 0.06
            if abs(interval) > profile.max_preferred_leap:
                score += 0.55
            if abs(interval) > profile.max_absolute_leap:
                score += 2.0
            if direction_bias != 0 and interval != 0 and interval * direction_bias < 0:
                score += 0.22

        if parallel_risk:
            score += (2.8 if strong_beat else 1.35) * max(
                profile.harmonic_stability_bias,
                0.55,
            )

        score += outer_voice_motion_penalty(
            candidate,
            prev_pitch,
            bass_pitch,
            previous_bass_pitch,
            profile,
        )
        score += rng.random() * 0.25
        scored.append((score, candidate, parallel_risk))

    scored.sort(key=lambda item: item[0])
    choice_pool = scored[: max(1, min(3, len(scored)))]

    if (
        strong_beat
        or profile.harmonic_stability_bias >= 0.45
        or profile.cadence_bass_bias >= 0.7
    ):
        safe_pool = [item for item in scored if not item[2]]
        if safe_pool:
            choice_pool = safe_pool[: max(1, min(3, len(safe_pool)))]

    if strong_beat or profile.harmonic_stability_bias >= 1.0:
        return choice_pool[0][1]
    return rng.choice(choice_pool[: min(2, len(choice_pool))])[1]


def fit_motif_anchor_to_scale(
    scale: list[int], motif_anchor: int | None, motif_pattern: list[int] | None
) -> int | None:
    if motif_anchor is None or not scale or not motif_pattern:
        return motif_anchor

    scale_floor = min(scale)
    scale_ceiling = max(scale)
    adjusted_anchor = motif_anchor
    motif_floor = adjusted_anchor + min(motif_pattern)
    motif_ceiling = adjusted_anchor + max(motif_pattern)

    if motif_floor < scale_floor:
        adjusted_anchor += scale_floor - motif_floor
    if motif_ceiling > scale_ceiling:
        adjusted_anchor -= motif_ceiling - scale_ceiling

    if adjusted_anchor != motif_anchor:
        adjusted_anchor = closest_scale_pitch(scale, adjusted_anchor)

    return adjusted_anchor


def capture_motif_intervals(pitches: list[int], limit: int = 6) -> list[int]:
    phrase = pitches[:limit]
    if not phrase:
        return []

    anchor = phrase[0]
    return [pitch - anchor for pitch in phrase]


def contrast_motif(intervals: list[int]) -> list[int]:
    if not intervals:
        return []

    return [0] + [(-interval if interval != 0 else 0) for interval in intervals[1:]]


def abbreviate_motif(intervals: list[int]) -> list[int]:
    if len(intervals) <= 2:
        return intervals[:]

    target_length = max(2, (len(intervals) + 1) // 2)
    target_length = min(target_length, len(intervals) - 1)
    return intervals[:target_length]


def vary_recap_motif(intervals: list[int]) -> list[int]:
    if len(intervals) <= 2:
        return intervals[:]

    varied = intervals[:]
    interior_indices = list(range(1, max(1, len(varied) - 1)))
    updated = False

    for index in interior_indices:
        interval = varied[index]
        if interval == 0:
            varied[index] = 1 if index % 2 else -1
            updated = True
            break

        candidate = int(clamp(interval + (1 if interval > 0 else -1), -12, 12))
        if candidate != interval:
            varied[index] = candidate
            updated = True
            break

    if not updated and len(varied) > 1:
        tail_interval = varied[-1]
        if tail_interval == 0:
            varied[-1] = 1
        else:
            varied[-1] = int(
                clamp(tail_interval + (1 if tail_interval > 0 else -1), -12, 12)
            )

    return varied


def texturalize_motif(intervals: list[int]) -> list[int]:
    if not intervals:
        return []

    return [0] + [
        0 if interval == 0 else (1 if interval > 0 else -1)
        for interval in intervals[1:]
    ]


def free_development_motif(intervals: list[int]) -> list[int]:
    if not intervals:
        return []

    developed = [0]
    for index, interval in enumerate(intervals[1:], start=1):
        if interval == 0:
            developed.append(2 if index % 2 else -2)
            continue

        if abs(interval) <= 2:
            developed.append(3 if interval > 0 else -3)
            continue

        adjusted = interval + (2 if index % 2 else -2)
        developed.append(int(clamp(adjusted, -12, 12)))

    return developed


def normalize_risk_profile(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"conservative", "neutral", "exploratory", "experimental"}:
        return normalized
    return None


def normalize_structure_visibility(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"transparent", "hinted", "hidden", "complex"}:
        return normalized
    return None


def normalize_cadence(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"open", "half", "authentic", "plagal", "deceptive"}:
        return normalized
    return None


def normalize_harmonic_rhythm(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"slow", "medium", "fast"}:
        return normalized
    return None


def normalize_harmony_density(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"sparse", "medium", "rich"}:
        return normalized
    return None


def normalize_voicing_profile(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"block", "broken", "arpeggiated"}:
        return normalized
    return None


def normalize_phrase_function(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in PHRASE_FUNCTIONS:
        return normalized
    return None


def normalize_phrase_span_shape(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in PHRASE_SPAN_SHAPES:
        return normalized
    return None


def normalize_continuation_pressure(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in CONTINUATION_PRESSURES:
        return normalized
    return None


def normalize_cadential_buildup(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in CADENTIAL_BUILDUPS:
        return normalized
    return None


def normalize_prolongation_mode(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in PROLONGATION_MODES:
        return normalized
    return None


def normalize_tonicization_windows(value: Any) -> list[dict[str, Any]] | None:
    if not isinstance(value, list):
        return None

    windows: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue

        key_target = str(entry.get("keyTarget") or "").strip()
        if not key_target:
            continue

        normalized: dict[str, Any] = {"keyTarget": key_target}
        start_measure = entry.get("startMeasure")
        end_measure = entry.get("endMeasure")
        if isinstance(start_measure, (int, float)) and int(start_measure) > 0:
            normalized["startMeasure"] = int(start_measure)
        if isinstance(end_measure, (int, float)) and int(end_measure) > 0:
            normalized["endMeasure"] = int(end_measure)

        emphasis = str(entry.get("emphasis") or "").strip().lower()
        if emphasis in TONICIZATION_EMPHASES:
            normalized["emphasis"] = emphasis

        cadence = normalize_cadence(entry.get("cadence"))
        if cadence:
            normalized["cadence"] = cadence

        windows.append(normalized)

    return windows or None


def normalize_harmonic_color_cues(value: Any) -> list[dict[str, Any]] | None:
    if not isinstance(value, list):
        return None

    cues: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue

        tag = (
            str(entry.get("tag") or "")
            .strip()
            .lower()
            .replace("-", "_")
            .replace(" ", "_")
        )
        if tag not in HARMONIC_COLOR_TAGS:
            continue

        normalized: dict[str, Any] = {"tag": tag}
        start_measure = entry.get("startMeasure")
        end_measure = entry.get("endMeasure")
        resolution_measure = entry.get("resolutionMeasure")
        intensity = entry.get("intensity")
        key_target = str(entry.get("keyTarget") or "").strip()
        if isinstance(start_measure, (int, float)) and int(start_measure) > 0:
            normalized["startMeasure"] = int(start_measure)
        if isinstance(end_measure, (int, float)) and int(end_measure) > 0:
            normalized["endMeasure"] = int(end_measure)
        if key_target:
            normalized["keyTarget"] = key_target
        if isinstance(resolution_measure, (int, float)) and int(resolution_measure) > 0:
            normalized["resolutionMeasure"] = int(resolution_measure)
        if isinstance(intensity, (int, float)):
            normalized["intensity"] = round(float(intensity), 3)

        notes_value = entry.get("notes")
        if isinstance(notes_value, list):
            notes = [str(item).strip() for item in notes_value if str(item).strip()]
            if notes:
                normalized["notes"] = notes

        cues.append(normalized)

    return cues or None


def normalize_texture_guidance(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    texture: dict[str, Any] = {}

    voice_count = value.get("voiceCount")
    if isinstance(voice_count, (int, float)) and int(voice_count) > 0:
        texture["voiceCount"] = int(voice_count)

    primary_roles_value = value.get("primaryRoles")
    if isinstance(primary_roles_value, list):
        primary_roles = []
        for entry in primary_roles_value:
            normalized = str(entry or "").strip().lower().replace(" ", "_")
            if normalized in TEXTURE_ROLES and normalized not in primary_roles:
                primary_roles.append(normalized)
        if primary_roles:
            texture["primaryRoles"] = primary_roles

    counterpoint_mode = (
        str(value.get("counterpointMode") or "").strip().lower().replace(" ", "_")
    )
    if counterpoint_mode in COUNTERPOINT_MODES:
        texture["counterpointMode"] = counterpoint_mode

    notes_value = value.get("notes")
    if isinstance(notes_value, list):
        notes = [str(entry).strip() for entry in notes_value if str(entry).strip()]
        if notes:
            texture["notes"] = notes

    return texture or None


def merge_texture_guidance(
    defaults: dict[str, Any] | None, override: dict[str, Any] | None
) -> dict[str, Any] | None:
    if not defaults and not override:
        return None
    if not defaults:
        return dict(override or {}) or None
    if not override:
        return dict(defaults) or None

    merged: dict[str, Any] = {}
    for field in ["voiceCount", "counterpointMode"]:
        value = override.get(field)
        if value is None:
            value = defaults.get(field)
        if value is not None:
            merged[field] = value

    primary_roles = override.get("primaryRoles")
    if primary_roles is None:
        primary_roles = defaults.get("primaryRoles")
    if isinstance(primary_roles, list) and primary_roles:
        merged["primaryRoles"] = list(primary_roles)

    notes = override.get("notes")
    if notes is None:
        notes = defaults.get("notes")
    if isinstance(notes, list) and notes:
        merged["notes"] = list(notes)

    return merged or None


def normalize_dynamic_level(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in DYNAMIC_LEVEL_VELOCITY_OFFSETS:
        return normalized
    return None


def normalize_expression_guidance(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    expression: dict[str, Any] = {}
    dynamics_value = value.get("dynamics")
    if isinstance(dynamics_value, dict):
        dynamics: dict[str, Any] = {}

        for field in ["start", "peak", "end"]:
            normalized_level = normalize_dynamic_level(dynamics_value.get(field))
            if normalized_level:
                dynamics[field] = normalized_level

        hairpins_value = dynamics_value.get("hairpins")
        if isinstance(hairpins_value, list):
            hairpins: list[dict[str, Any]] = []
            for hairpin in hairpins_value:
                if not isinstance(hairpin, dict):
                    continue

                shape = str(hairpin.get("shape") or "").strip().lower()
                if shape not in {"crescendo", "diminuendo"}:
                    continue

                start_measure = hairpin.get("startMeasure")
                end_measure = hairpin.get("endMeasure")
                target = normalize_dynamic_level(hairpin.get("target"))
                hairpin_entry: dict[str, Any] = {"shape": shape}

                if isinstance(start_measure, (int, float)) and int(start_measure) > 0:
                    hairpin_entry["startMeasure"] = int(start_measure)
                if isinstance(end_measure, (int, float)) and int(end_measure) > 0:
                    hairpin_entry["endMeasure"] = int(end_measure)
                if target:
                    hairpin_entry["target"] = target

                hairpins.append(hairpin_entry)

            if hairpins:
                dynamics["hairpins"] = hairpins

        if dynamics:
            expression["dynamics"] = dynamics

    articulation = (
        [
            str(item).strip().lower()
            for item in value.get("articulation", [])
            if str(item).strip().lower() in EXPRESSION_ARTICULATION_TAGS
        ]
        if isinstance(value.get("articulation"), list)
        else []
    )
    if articulation:
        expression["articulation"] = list(dict.fromkeys(articulation))

    character = (
        [
            str(item).strip().lower()
            for item in value.get("character", [])
            if str(item).strip().lower() in EXPRESSION_CHARACTER_TAGS
        ]
        if isinstance(value.get("character"), list)
        else []
    )
    if character:
        expression["character"] = list(dict.fromkeys(character))

    phrase_peaks_value = value.get("phrasePeaks")
    if isinstance(phrase_peaks_value, list):
        phrase_peaks = sorted(
            {
                int(entry)
                for entry in phrase_peaks_value
                if isinstance(entry, (int, float)) and int(entry) > 0
            }
        )
        if phrase_peaks:
            expression["phrasePeaks"] = phrase_peaks

    sustain_bias = value.get("sustainBias")
    if isinstance(sustain_bias, (int, float)):
        expression["sustainBias"] = clamp(float(sustain_bias), -1.0, 1.0)

    accent_bias = value.get("accentBias")
    if isinstance(accent_bias, (int, float)):
        expression["accentBias"] = clamp(float(accent_bias), -1.0, 1.0)

    notes_value = value.get("notes")
    if isinstance(notes_value, list):
        notes = [str(entry).strip() for entry in notes_value if str(entry).strip()]
        if notes:
            expression["notes"] = notes

    return expression or None


def merge_expression_guidance(
    defaults: dict[str, Any] | None, override: dict[str, Any] | None
) -> dict[str, Any] | None:
    if not defaults and not override:
        return None
    if not defaults:
        return dict(override or {}) or None
    if not override:
        return dict(defaults) or None

    merged: dict[str, Any] = {}
    default_dynamics = (
        defaults.get("dynamics") if isinstance(defaults.get("dynamics"), dict) else None
    )
    override_dynamics = (
        override.get("dynamics") if isinstance(override.get("dynamics"), dict) else None
    )

    if default_dynamics or override_dynamics:
        dynamics: dict[str, Any] = {}
        for field in ["start", "peak", "end"]:
            value = None
            if override_dynamics:
                value = override_dynamics.get(field)
            if value is None and default_dynamics:
                value = default_dynamics.get(field)
            if value is not None:
                dynamics[field] = value

        hairpins = None
        if override_dynamics and override_dynamics.get("hairpins"):
            hairpins = override_dynamics.get("hairpins")
        elif default_dynamics and default_dynamics.get("hairpins"):
            hairpins = default_dynamics.get("hairpins")
        if hairpins:
            dynamics["hairpins"] = hairpins

        if dynamics:
            merged["dynamics"] = dynamics

    for field in ["articulation", "character", "phrasePeaks", "notes"]:
        value = override.get(field)
        if value is None:
            value = defaults.get(field)
        if value:
            merged[field] = value

    for field in ["sustainBias", "accentBias"]:
        value = override.get(field)
        if value is None:
            value = defaults.get(field)
        if value is not None:
            merged[field] = value

    return merged or None


def normalize_recap_mode(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"full", "abbreviated", "varied"}:
        return normalized
    return None


def normalize_development_type(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"motivic", "textural", "free"}:
        return normalized
    return None


def connect_progression_degree(current: int, nxt: int, mode: str) -> int:
    if current == nxt:
        return current
    if current == 0 and nxt in {4, 5}:
        return 1
    if current == 3 and nxt == 4:
        return 1
    if current == 4 and nxt == 0:
        return 6 if mode == "major" else 2

    delta = nxt - current
    if abs(delta) <= 1:
        return nxt
    return (current + (1 if delta > 0 else -1)) % 7


def apply_terminal_cadence(progression: list[int], cadence: str | None) -> list[int]:
    if not progression:
        return progression

    if cadence == "half":
        if len(progression) >= 2:
            progression[-2] = 4
        progression[-1] = 4
        return progression

    if cadence == "deceptive":
        if len(progression) >= 2:
            progression[-2] = 4
        progression[-1] = 5
        return progression

    if cadence == "plagal":
        if len(progression) >= 2:
            progression[-2] = 3
        progression[-1] = 0
        return progression

    if cadence == "authentic":
        if len(progression) >= 2:
            progression[-2] = 4
        progression[-1] = 0
        return progression

    if len(progression) >= 2:
        progression[-2] = 4
        progression[-1] = 0
    elif len(progression) == 1:
        progression[-1] = 0

    return progression


def predominant_degree_for_mode(mode: str) -> int:
    return 1 if mode == "major" else 5


def degree_for_target_pitch_class(
    tonic: str, mode: str, target_pitch_class: int
) -> int | None:
    tonic_pitch_class = key_pitch_class(tonic)
    if tonic_pitch_class is None:
        return None

    scale = MAJOR_SCALE if mode == "major" else MINOR_SCALE
    for degree, offset in enumerate(scale):
        if (tonic_pitch_class + offset) % 12 == target_pitch_class:
            return degree

    return None


def section_needs_arrival_preparation(role: str | None, cadence: str | None) -> bool:
    return bool(
        role in {"recap", "cadence", "outro"} or cadence in {"authentic", "plagal"}
    )


def align_progression_with_upcoming_arrival(
    progression: list[int],
    current_tonic: str,
    current_mode: str,
    current_role: str | None,
    current_cadence: str | None,
    next_tonic: str | None,
    next_mode: str | None,
    next_role: str | None,
    next_cadence: str | None,
    directive_set: set[str],
) -> tuple[list[int], bool]:
    if not progression or not next_tonic:
        return progression, False

    if not section_needs_arrival_preparation(next_role, next_cadence):
        return progression, False

    if current_role in {"recap", "cadence", "outro"}:
        return progression, False

    if current_tonic == next_tonic and (next_mode is None or current_mode == next_mode):
        return progression, False

    if (
        current_cadence in {"authentic", "plagal", "deceptive"}
        and "stabilize_harmony" not in directive_set
    ):
        return progression, False

    next_tonic_pitch_class = key_pitch_class(next_tonic)
    if next_tonic_pitch_class is None:
        return progression, False

    desired_pitch_class = (
        (next_tonic_pitch_class + 5) % 12
        if next_cadence == "plagal"
        else (next_tonic_pitch_class + 7) % 12
    )
    desired_degree = degree_for_target_pitch_class(
        current_tonic,
        current_mode,
        desired_pitch_class,
    )
    if desired_degree is None:
        return progression, False

    progression[-1] = desired_degree

    if len(progression) >= 2 and progression[-2] == desired_degree:
        bridge_degree = predominant_degree_for_mode(current_mode)
        if bridge_degree == desired_degree and len(progression) >= 3:
            bridge_degree = connect_progression_degree(
                progression[-3],
                desired_degree,
                current_mode,
            )
        progression[-2] = bridge_degree

    return progression, True


def reinforce_cadential_progression(
    progression: list[int],
    cadence: str | None,
    role: str | None,
    mode: str,
    directive_set: set[str],
) -> list[int]:
    if not progression or not (
        {"strengthen_cadence", "stabilize_harmony"} & directive_set
    ):
        return progression

    resolved_cadence = cadence
    if resolved_cadence is None and role in {"recap", "cadence", "outro"}:
        resolved_cadence = "authentic"

    if resolved_cadence is None:
        return progression

    if resolved_cadence == "half" and role not in {
        "theme_b",
        "bridge",
        "development",
        "variation",
        "recap",
        "cadence",
        "outro",
    }:
        return progression

    predominant = predominant_degree_for_mode(mode)

    if resolved_cadence == "plagal":
        if len(progression) >= 3:
            progression[-3] = predominant
        if len(progression) >= 2:
            progression[-2] = 3
        progression[-1] = 0
        return progression

    if resolved_cadence == "half":
        if len(progression) >= 2:
            progression[-2] = predominant
        progression[-1] = 4
        return progression

    if resolved_cadence == "deceptive":
        if len(progression) >= 3:
            progression[-3] = predominant
        if len(progression) >= 2:
            progression[-2] = 4
        progression[-1] = 5
        return progression

    if len(progression) >= 3:
        progression[-3] = predominant
    if len(progression) >= 2:
        progression[-2] = 4
    progression[-1] = 0
    return progression


def choose_section_progression_template(
    mode: str,
    role: str | None,
    cadence: str | None,
    modulation_active: bool,
    rng: random.Random,
) -> list[int]:
    if role in {"recap", "cadence", "outro"} or cadence in {"authentic", "plagal"}:
        return rng.choice(
            MINOR_RETURN_PROGRESSIONS if mode == "minor" else MAJOR_RETURN_PROGRESSIONS
        )

    if modulation_active or role in {"development", "variation", "bridge"}:
        return rng.choice(
            MINOR_MODULATION_PROGRESSIONS
            if mode == "minor"
            else MAJOR_MODULATION_PROGRESSIONS
        )

    return rng.choice(MINOR_PROGRESSIONS if mode == "minor" else MAJOR_PROGRESSIONS)


def build_section_progression(
    mode: str,
    measures: int,
    cadence: str | None,
    harmonic_rhythm: str | None,
    role: str | None,
    modulation_active: bool,
    directive_set: set[str],
    rng: random.Random,
) -> list[int]:
    if measures <= 0:
        return []

    template = choose_section_progression_template(
        mode,
        role,
        cadence,
        modulation_active,
        rng,
    )
    progression: list[int] = []
    rhythm = harmonic_rhythm or "medium"

    while len(progression) < measures:
        if rhythm == "slow":
            for degree in template:
                progression.extend([degree, degree])
                if len(progression) >= measures:
                    break
            continue

        if rhythm == "fast":
            for index, degree in enumerate(template):
                progression.append(degree)
                if len(progression) >= measures:
                    break

                nxt = template[(index + 1) % len(template)]
                progression.append(connect_progression_degree(degree, nxt, mode))
                if len(progression) >= measures:
                    break
            continue

        progression.extend(template if not progression else template[:-1])

    return reinforce_cadential_progression(
        apply_terminal_cadence(progression[:measures], cadence),
        cadence,
        role,
        mode,
        directive_set,
    )


def invert_motif(intervals: list[int]) -> list[int]:
    if not intervals:
        return []

    return [0] + [(-interval if interval != 0 else 0) for interval in intervals[1:]]


def augment_duration_pattern(pattern: list[float]) -> list[float]:
    if len(pattern) < 2:
        return pattern[:]

    augmented: list[float] = []
    index = 0
    while index < len(pattern):
        remaining = len(pattern) - index
        if remaining == 1:
            augmented.append(pattern[index])
            break
        if remaining == 3:
            augmented.append(pattern[index] + pattern[index + 1])
            augmented.append(pattern[index + 2])
            break

        augmented.append(pattern[index] + pattern[index + 1])
        index += 2

    return augmented


def diminish_duration_pattern(pattern: list[float]) -> list[float]:
    if not pattern:
        return []

    diminished: list[float] = []
    split_applied = False
    for duration in pattern:
        if duration >= 1.0:
            diminished.extend([duration / 2.0, duration / 2.0])
            split_applied = True
        else:
            diminished.append(duration)

    if not split_applied:
        diminished = []
        longest_index = max(range(len(pattern)), key=lambda idx: pattern[idx])
        for index, duration in enumerate(pattern):
            if index == longest_index and duration >= 0.5:
                diminished.extend([duration / 2.0, duration / 2.0])
                split_applied = True
            else:
                diminished.append(duration)

    if len(diminished) > 10:
        diminished = diminished[:9] + [sum(diminished[9:])]

    return diminished if split_applied else pattern[:]


def apply_motif_rhythm_transform(
    pattern: list[float], rhythm_transform: str | None
) -> list[float]:
    if rhythm_transform == "augmentation":
        return augment_duration_pattern(pattern)
    if rhythm_transform == "diminution":
        return diminish_duration_pattern(pattern)
    return pattern[:]


def transpose_scale_steps(scale: list[int], pitch: int, steps: int) -> int:
    if not scale or steps == 0:
        return pitch

    anchor_index = min(range(len(scale)), key=lambda idx: abs(scale[idx] - pitch))
    target_index = int(clamp(anchor_index + steps, 0, len(scale) - 1))
    return scale[target_index]


def infer_reused_motif_source(
    role: str, section_spans: list[SectionSpan]
) -> str | None:
    if role not in {"development", "variation", "recap"}:
        return None

    for span in reversed(section_spans):
        if span.role in {"theme_a", "theme_b", "intro", "bridge"}:
            return span.id

    return section_spans[-1].id if section_spans else None


def select_rhythm_transform(
    span: SectionSpan,
    profile: ResolvedProfile,
) -> str | None:
    if span.role not in {"development", "variation", "bridge", "recap"}:
        return None

    if span.role == "recap":
        if span.recap_mode == "full":
            return None
        if span.recap_mode == "abbreviated" and profile.motif_diminution_allowed:
            return "diminution"
        if span.recap_mode == "varied":
            if span.harmonic_rhythm == "fast" and profile.motif_diminution_allowed:
                return "diminution"
            if span.harmonic_rhythm == "slow" and profile.motif_augmentation_allowed:
                return "augmentation"

    if span.harmonic_rhythm == "slow" and profile.motif_augmentation_allowed:
        return "augmentation"
    if span.harmonic_rhythm == "fast" and profile.motif_diminution_allowed:
        return "diminution"

    if span.role == "variation":
        if profile.motif_augmentation_allowed:
            return "augmentation"
        if profile.motif_diminution_allowed:
            return "diminution"

    if span.role == "development":
        if profile.motif_diminution_allowed:
            return "diminution"
        if profile.motif_augmentation_allowed:
            return "augmentation"

    if span.role == "bridge":
        if profile.motif_diminution_allowed:
            return "diminution"
        if profile.motif_augmentation_allowed:
            return "augmentation"

    return None


def resolve_section_transform(
    span: SectionSpan,
    motif_pattern: list[int],
    profile: ResolvedProfile,
) -> tuple[list[int], str, int, str | None]:
    if not motif_pattern:
        return motif_pattern, "literal", 0, None

    transformed = motif_pattern[:]
    mode_parts: list[str] = []
    sequence_stride = 0
    rhythm_transform = select_rhythm_transform(span, profile)

    if span.contrast_from:
        transformed = contrast_motif(transformed)
        mode_parts.append("contrast")
    elif span.role == "development" and profile.motif_inversion_allowed:
        transformed = invert_motif(transformed)
        mode_parts.append("inversion")

    if span.role == "development":
        if span.development_type == "motivic":
            mode_parts.append("motivic")
        elif span.development_type == "textural":
            textured = texturalize_motif(transformed)
            if textured != transformed:
                transformed = textured
            mode_parts.append("textural")
        elif span.development_type == "free":
            free_variant = free_development_motif(transformed)
            if free_variant != transformed:
                transformed = free_variant
            mode_parts.append("free")

    if span.role == "recap":
        if span.recap_mode == "abbreviated":
            abbreviated = abbreviate_motif(transformed)
            if abbreviated != transformed:
                transformed = abbreviated
                mode_parts.append("abbreviated")
        elif span.recap_mode == "varied":
            varied = vary_recap_motif(transformed)
            if varied != transformed:
                transformed = varied
                mode_parts.append("varied")

    if rhythm_transform:
        mode_parts.append(rhythm_transform)

    allow_sequence = False
    if profile.motif_sequence_allowed:
        if span.role in {"variation", "bridge"}:
            allow_sequence = True
        elif span.role == "development":
            allow_sequence = span.development_type not in {"textural", "free"}
        elif span.role == "recap" and span.recap_mode == "varied":
            allow_sequence = True

    if allow_sequence:
        if span.role == "recap":
            sequence_stride = 1
        else:
            sequence_stride = 2 if span.harmonic_rhythm == "fast" else 1
        mode_parts.append("sequence")

    return (
        transformed,
        "+".join(mode_parts) or "literal",
        sequence_stride,
        rhythm_transform,
    )


def sequence_anchor_for_measure(
    scale: list[int],
    base_anchor: int,
    span: SectionSpan,
    measure_index: int,
    sequence_stride: int,
) -> int:
    if sequence_stride <= 0:
        return base_anchor

    measure_offset = max(0, measure_index - span.start_measure)
    if measure_offset == 0:
        return base_anchor

    if span.harmonic_rhythm == "fast":
        sequence_count = measure_offset
    elif span.harmonic_rhythm == "slow":
        sequence_count = measure_offset // 3
    else:
        sequence_count = measure_offset // 2

    if sequence_count <= 0:
        return base_anchor

    direction = 1 if span.role != "variation" else (-1 if measure_offset % 2 else 1)
    return transpose_scale_steps(
        scale, base_anchor, direction * sequence_count * sequence_stride
    )


def build_sketch_motif_library(sketch: Any) -> dict[str, list[int]]:
    if not isinstance(sketch, dict):
        return {}

    motif_drafts = sketch.get("motifDrafts")
    if not isinstance(motif_drafts, list):
        return {}

    motif_library: dict[str, list[int]] = {}
    for draft in motif_drafts:
        if not isinstance(draft, dict):
            continue

        intervals_value = draft.get("intervals")
        if not isinstance(intervals_value, list):
            continue

        intervals: list[int] = []
        for interval in intervals_value[:8]:
            if isinstance(interval, (int, float)):
                intervals.append(int(clamp(float(interval), -12, 12)))

        if not intervals:
            continue

        if intervals[0] != 0:
            intervals[0] = 0

        section_id = str(draft.get("sectionId") or "").strip()
        draft_id = str(draft.get("id") or "").strip()
        if section_id:
            motif_library[section_id] = intervals
        if draft_id and draft_id not in motif_library:
            motif_library[draft_id] = intervals

    return motif_library


def build_sketch_cadence_options(sketch: Any) -> dict[str, list[str]]:
    if not isinstance(sketch, dict):
        return {}

    cadence_options = sketch.get("cadenceOptions")
    if not isinstance(cadence_options, list):
        return {}

    result: dict[str, list[str]] = {}
    for option in cadence_options:
        if not isinstance(option, dict):
            continue

        section_id = str(option.get("sectionId") or "").strip()
        if not section_id:
            continue

        candidates: list[str] = []
        primary = normalize_cadence(option.get("primary"))
        if primary:
            candidates.append(primary)

        alternatives = option.get("alternatives")
        if isinstance(alternatives, list):
            for alternative in alternatives:
                cadence = normalize_cadence(alternative)
                if cadence and cadence not in candidates:
                    candidates.append(cadence)

        if candidates:
            result[section_id] = candidates

    return result


def select_section_cadence(
    section_id: str,
    explicit_cadence: str | None,
    sketch_cadence_options: dict[str, list[str]],
    risk_profile: str | None,
    structure_visibility: str | None,
    attempt_index: int,
    directive_set: set[str],
) -> str | None:
    sketch_candidates = list(sketch_cadence_options.get(section_id, []))
    preferred = explicit_cadence
    if preferred is None and sketch_candidates:
        preferred = sketch_candidates[0]

    alternatives = [cadence for cadence in sketch_candidates if cadence != preferred]
    candidates = ([preferred] if preferred else []) + alternatives
    if not candidates:
        return None

    if "strengthen_cadence" in directive_set:
        if risk_profile == "experimental" and structure_visibility in {
            "hidden",
            "complex",
        }:
            for cadence in ["deceptive", "plagal", "half"]:
                if cadence in candidates:
                    return cadence

        if risk_profile == "exploratory" and structure_visibility == "hidden":
            for cadence in ["plagal", "authentic", "half"]:
                if cadence in candidates:
                    return cadence

        if "authentic" in candidates:
            return "authentic"
        return candidates[0]

    if attempt_index > 1 and alternatives:
        if risk_profile == "experimental":
            return alternatives[(attempt_index - 2) % len(alternatives)]
        if risk_profile == "exploratory" and attempt_index % 2 == 0:
            return alternatives[((attempt_index // 2) - 1) % len(alternatives)]

    return preferred or candidates[0]


def outer_voice_motion_penalty(
    candidate: int,
    prev_pitch: int | None,
    bass_pitch: int | None,
    previous_bass_pitch: int | None,
    profile: ResolvedProfile,
) -> float:
    if (
        prev_pitch is None
        or bass_pitch is None
        or previous_bass_pitch is None
        or profile.harmonic_stability_bias <= 0
    ):
        return 0.0

    current_interval = interval_class(candidate, bass_pitch)
    melody_direction = (
        0 if candidate == prev_pitch else (1 if candidate > prev_pitch else -1)
    )
    bass_direction = (
        0
        if bass_pitch == previous_bass_pitch
        else (1 if bass_pitch > previous_bass_pitch else -1)
    )

    penalty = 0.0
    stability_weight = max(
        profile.harmonic_stability_bias,
        profile.cadence_bass_bias * 0.65,
    )
    if creates_parallel_perfect_motion(
        candidate,
        prev_pitch,
        bass_pitch,
        previous_bass_pitch,
    ):
        penalty += 4.8 * stability_weight
    elif (
        melody_direction != 0
        and bass_direction != 0
        and melody_direction == bass_direction
    ):
        if current_interval in {0, 7}:
            penalty += 0.85 * stability_weight
    elif (
        melody_direction != 0
        and bass_direction != 0
        and melody_direction != bass_direction
    ):
        penalty -= 0.36 * stability_weight

    return penalty


def choose_cadential_pitch(
    scale: list[int],
    cadence_style: str | None,
    tonic_pitch_class: int,
    mode: str,
    target: float,
    bass_pitch: int | None,
    prev_pitch: int | None,
    previous_bass_pitch: int | None,
    profile: ResolvedProfile,
    rng: random.Random,
) -> int:
    dominant_pitch_class = (tonic_pitch_class + 7) % 12
    dominant_third_pitch_class = (
        dominant_pitch_class + (3 if mode == "minor" else 4)
    ) % 12
    dominant_fifth_pitch_class = (dominant_pitch_class + 7) % 12
    mediant_pitch_class = (tonic_pitch_class + (3 if mode == "minor" else 4)) % 12
    submediant_pitch_class = (tonic_pitch_class + (8 if mode == "minor" else 9)) % 12

    if cadence_style in {"half", "arrival"}:
        desired_pitch_classes = [
            dominant_pitch_class,
            dominant_third_pitch_class,
            dominant_fifth_pitch_class,
        ]
    elif cadence_style == "deceptive":
        desired_pitch_classes = [submediant_pitch_class]
    elif cadence_style in {"authentic", "plagal"}:
        desired_pitch_classes = [
            tonic_pitch_class,
            mediant_pitch_class,
            dominant_pitch_class,
        ]
    else:
        desired_pitch_classes = [tonic_pitch_class, dominant_pitch_class]

    candidates = [
        pitch for pitch in scale if pitch_class(pitch) in set(desired_pitch_classes)
    ]
    if not candidates:
        candidates = [
            note_for_pitch_class(scale, desired_pitch_class, target)
            for desired_pitch_class in desired_pitch_classes
        ]

    scored: list[tuple[float, int, bool]] = []
    for candidate in candidates:
        score = abs(candidate - target) * 0.16
        parallel_risk = creates_parallel_perfect_motion(
            candidate,
            prev_pitch,
            bass_pitch,
            previous_bass_pitch,
        )

        if pitch_class(candidate) == desired_pitch_classes[0]:
            score -= 0.24

        if prev_pitch is not None:
            interval = candidate - prev_pitch
            score += abs(interval) * 0.08
            if abs(interval) > profile.max_preferred_leap:
                score += 0.6

        if bass_pitch is not None:
            vertical_interval = interval_class(candidate, bass_pitch)
            if cadence_style in {"authentic", "plagal"}:
                if vertical_interval in {0, 4, 7}:
                    score -= 0.55 * profile.cadence_bass_bias
                else:
                    score += 0.5 * profile.cadence_bass_bias
            elif cadence_style == "half":
                if vertical_interval in {7, 11, 2}:
                    score -= 0.3 * profile.cadence_bass_bias
            elif cadence_style == "deceptive":
                if vertical_interval in {0, 3, 7}:
                    score -= 0.25 * profile.cadence_bass_bias

            if vertical_interval in {1, 6, 10, 11}:
                score += 0.28 * profile.cadence_bass_bias

        if parallel_risk:
            score += 1.6 * max(
                profile.harmonic_stability_bias,
                profile.cadence_bass_bias,
            )

        score += outer_voice_motion_penalty(
            candidate,
            prev_pitch,
            bass_pitch,
            previous_bass_pitch,
            profile,
        )
        score += rng.random() * 0.35
        scored.append((score, candidate, parallel_risk))

    scored.sort(key=lambda item: item[0])
    choice_pool = scored[: max(1, min(4, len(scored)))]
    if profile.harmonic_stability_bias >= 0.45 or profile.cadence_bass_bias >= 0.8:
        safe_pool = [item for item in scored if not item[2]]
        if safe_pool:
            choice_pool = safe_pool[: max(1, min(4, len(safe_pool)))]
    if profile.harmonic_stability_bias >= 1.0:
        return choice_pool[0][1]
    return rng.choice(choice_pool[: min(2, len(choice_pool))])[1]


def choose_melodic_pitch(
    scale: list[int],
    chord_pitches: list[int],
    prev_pitch: int | None,
    target: float,
    strong_beat: bool,
    direction_bias: int,
    last_interval: int | None,
    recent_pitch_classes: set[int],
    bass_pitch: int | None,
    previous_bass_pitch: int | None,
    profile: ResolvedProfile,
    rng: random.Random,
) -> int:
    chord_pitch_classes = {pitch % 12 for pitch in chord_pitches}
    scored: list[tuple[float, int, bool]] = []

    for candidate in scale:
        score = abs(candidate - target) * 0.18
        parallel_risk = creates_parallel_perfect_motion(
            candidate,
            prev_pitch,
            bass_pitch,
            previous_bass_pitch,
        )
        if prev_pitch is not None:
            interval = candidate - prev_pitch
            score += abs(interval) * 0.12
            if abs(interval) > profile.max_preferred_leap:
                score += 1.8
            if abs(interval) > profile.max_absolute_leap:
                score += 5.0
            if candidate == prev_pitch:
                score += profile.repetition_penalty

            if last_interval is not None and abs(last_interval) > 7:
                step_recovery = (
                    interval != 0
                    and abs(interval) <= 5
                    and (interval > 0) != (last_interval > 0)
                )
                if not step_recovery:
                    score += 1.4

            if direction_bias != 0 and interval != 0 and interval * direction_bias < 0:
                score += 0.9

        if strong_beat and candidate % 12 not in chord_pitch_classes:
            score += 2.8
        elif candidate % 12 in chord_pitch_classes:
            score -= 0.35

        if bass_pitch is not None:
            vertical_interval = interval_class(candidate, bass_pitch)
            if strong_beat and vertical_interval in {0, 4, 7}:
                score -= 0.12 * profile.cadence_bass_bias
            elif strong_beat and vertical_interval in {1, 6, 10, 11}:
                score += 0.18 * profile.harmonic_stability_bias

        if parallel_risk:
            score += (2.6 if strong_beat else 1.2) * max(
                profile.harmonic_stability_bias,
                0.55,
            )

        score += outer_voice_motion_penalty(
            candidate,
            prev_pitch,
            bass_pitch,
            previous_bass_pitch,
            profile,
        )

        if recent_pitch_classes:
            if candidate % 12 in recent_pitch_classes:
                score += profile.pitch_variety_bias * 0.9
            else:
                score -= profile.pitch_variety_bias * 0.18
        elif (
            profile.pitch_variety_bias > 0 and candidate % 12 not in chord_pitch_classes
        ):
            score -= profile.pitch_variety_bias * 0.12

        score += rng.random() * 0.65
        scored.append((score, candidate, parallel_risk))

    scored.sort(key=lambda item: item[0])
    choice_pool = scored[: max(1, min(5, len(scored)))]
    if strong_beat and profile.harmonic_stability_bias >= 0.45:
        safe_pool = [item for item in scored if not item[2]]
        if safe_pool:
            choice_pool = safe_pool[: max(1, min(5, len(safe_pool)))]
    if profile.harmonic_stability_bias >= 1.0:
        return choice_pool[0][1]
    return rng.choice(choice_pool[: min(3, len(choice_pool))])[1]


def render_melody_measure(
    part: stream.Part,
    profile: ResolvedProfile,
    measure_index: int,
    chord_pitches: list[int],
    accompaniment_events: list[dict[str, Any]],
    bass_pitch: int | None,
    previous_bass_pitch: int | None,
    previous_structural_pitch: int | None,
    previous_structural_bass_pitch: int | None,
    melody_scale: list[int],
    tonic_pitch_class: int,
    mode: str,
    rng: random.Random,
    prev_pitch: int | None,
    last_interval: int | None,
    motif_pattern: list[int] | None = None,
    motif_anchor: int | None = None,
    motif_offset: int = 0,
    motif_rhythm_transform: str | None = None,
    use_realized_accompaniment_bass: bool = False,
    realized_accompaniment_bass_strong_beats_only: bool = False,
    structural_outer_voice_tracking: bool = False,
) -> tuple[
    int | None,
    int | None,
    int | None,
    int | None,
    list[int],
    list[dict[str, Any]],
]:
    pattern = choose_duration_pattern(profile, measure_index, rng)
    beats = beats_per_measure(profile.time_signature)
    pattern = apply_motif_rhythm_transform(pattern, motif_rhythm_transform)
    expression_state = resolve_measure_expression_state(profile, measure_index)
    measure_start = profile.contour[measure_index]
    measure_end = profile.contour[min(measure_index + 1, len(profile.contour) - 1)]
    offset = 0.0
    phrase_end = (
        measure_index + 1
    ) in profile.phrase_breaks or measure_index == profile.measures - 1
    climax = profile.tension[min(measure_index, len(profile.tension) - 1)]
    cadence_style = profile.cadence_map[
        min(measure_index, len(profile.cadence_map) - 1)
    ]
    style = profile.measure_styles[min(measure_index, len(profile.measure_styles) - 1)]
    generated_pitches: list[int] = []
    events: list[dict[str, Any]] = []
    motif_index = motif_offset
    measure_pitch_classes: set[int] = set()
    last_supported_bass_pitch = previous_bass_pitch
    last_structural_pitch = previous_structural_pitch
    last_structural_bass_pitch = previous_structural_bass_pitch

    for idx, duration in enumerate(pattern):
        midpoint = (offset + duration * 0.5) / beats
        contour_value = measure_start + (measure_end - measure_start) * midpoint
        target_pitch = 60 + contour_value * profile.contour_span
        direction_bias = 0
        if measure_end > measure_start + 0.02:
            direction_bias = 1
        elif measure_end < measure_start - 0.02:
            direction_bias = -1

        strong_beat = abs(offset - round(offset)) < 0.001
        is_last_event = idx == len(pattern) - 1
        should_rest = (
            not strong_beat
            and not is_last_event
            and style in {"arpeggio", "broken"}
            and motif_rhythm_transform != "diminution"
            and profile.measure_densities[
                min(measure_index, len(profile.measure_densities) - 1)
            ]
            < 0.42
            and rng.random() < 0.12
        )

        if should_rest:
            rest_artifact = {
                "type": "rest",
                "quarterLength": float(duration),
            }
            append_event_artifact(part, rest_artifact)
            events.append(rest_artifact)
            offset += duration
            continue

        supporting_bass_pitch = bass_pitch
        if use_realized_accompaniment_bass and (
            not realized_accompaniment_bass_strong_beats_only or strong_beat
        ):
            supporting_bass_pitch = accompaniment_bass_pitch_at_offset(
                accompaniment_events,
                offset,
            )
            if supporting_bass_pitch is None:
                supporting_bass_pitch = bass_pitch

        prior_outer_voice_pitch = prev_pitch
        prior_outer_voice_bass_pitch = last_supported_bass_pitch
        structural_frame_bass_pitch: int | None = None
        if structural_outer_voice_tracking and strong_beat:
            prior_outer_voice_pitch = last_structural_pitch
            prior_outer_voice_bass_pitch = last_structural_bass_pitch
            structural_frame_bass_pitch = supporting_bass_pitch
        elif structural_outer_voice_tracking:
            next_structural_offset = float(int(offset) + 1)
            if offset + duration > next_structural_offset + 0.001:
                prior_outer_voice_pitch = last_structural_pitch
                prior_outer_voice_bass_pitch = last_structural_bass_pitch
                structural_frame_bass_pitch = accompaniment_bass_pitch_at_offset(
                    accompaniment_events,
                    next_structural_offset,
                )
                if structural_frame_bass_pitch is None:
                    structural_frame_bass_pitch = bass_pitch
                supporting_bass_pitch = structural_frame_bass_pitch

        if is_last_event and phrase_end:
            resolved_cadence = cadence_style
            if resolved_cadence is None and measure_index == profile.measures - 1:
                resolved_cadence = "authentic"

            pitch_value = choose_cadential_pitch(
                melody_scale,
                resolved_cadence,
                tonic_pitch_class,
                mode,
                target_pitch,
                supporting_bass_pitch,
                prior_outer_voice_pitch,
                prior_outer_voice_bass_pitch,
                profile,
                rng,
            )
        elif motif_pattern and motif_anchor is not None:
            resolved_motif_index = motif_index % len(motif_pattern)
            desired_pitch = motif_anchor + motif_pattern[resolved_motif_index]
            preserve_motif_pitch = False

            if not strong_beat:
                previous_motif_interval = 0
                if motif_index > 0:
                    previous_motif_interval = motif_pattern[
                        (motif_index - 1) % len(motif_pattern)
                    ]

                motif_motion = (
                    motif_pattern[resolved_motif_index] - previous_motif_interval
                )
                preserve_motif_pitch = (
                    motif_rhythm_transform == "diminution" or abs(motif_motion) >= 3
                )

                if not preserve_motif_pitch:
                    desired_pitch = (desired_pitch * 0.65) + (target_pitch * 0.35)

            pitch_value = choose_motif_pitch(
                melody_scale,
                desired_pitch,
                prior_outer_voice_pitch,
                supporting_bass_pitch,
                prior_outer_voice_bass_pitch,
                strong_beat,
                direction_bias,
                profile,
                rng,
            )
            motif_index += 1
        else:
            pitch_value = choose_melodic_pitch(
                melody_scale,
                chord_pitches,
                prev_pitch,
                target_pitch,
                strong_beat,
                direction_bias,
                last_interval,
                measure_pitch_classes,
                supporting_bass_pitch,
                prior_outer_voice_bass_pitch,
                profile,
                rng,
            )

        accent = 6 if strong_beat else 0
        if expression_state:
            accent += int(
                round(
                    float(expression_state.get("accentBias") or 0.0)
                    * (5 if strong_beat else 3)
                )
            )
        velocity_bias = (
            float(expression_state.get("melodyVelocityBias") or 0.0)
            if expression_state
            else 0.0
        )
        velocity = int(
            clamp(
                66 + climax * 16 + accent + velocity_bias + rng.randint(-4, 4), 42, 118
            )
        )
        note_duration = resolved_note_duration(
            duration,
            expression_state,
            strong_beat,
            phrase_end,
        )
        note_artifact = build_event_artifact(pitch_value, note_duration, velocity)
        append_event_artifact(part, note_artifact)
        events.append(note_artifact)

        remaining_duration = round(duration - note_duration, 3)
        if remaining_duration >= 0.125:
            rest_artifact = {
                "type": "rest",
                "quarterLength": float(remaining_duration),
            }
            append_event_artifact(part, rest_artifact)
            events.append(rest_artifact)

        if prev_pitch is not None:
            last_interval = pitch_value - prev_pitch
        prev_pitch = pitch_value
        if supporting_bass_pitch is not None and (
            not realized_accompaniment_bass_strong_beats_only
            or strong_beat
            or last_supported_bass_pitch is None
        ):
            last_supported_bass_pitch = supporting_bass_pitch
        if structural_outer_voice_tracking and structural_frame_bass_pitch is not None:
            last_structural_pitch = pitch_value
            last_structural_bass_pitch = structural_frame_bass_pitch
        generated_pitches.append(pitch_value)
        measure_pitch_classes.add(pitch_value % 12)
        offset += duration

    return (
        prev_pitch,
        last_interval,
        last_structural_pitch,
        last_structural_bass_pitch,
        generated_pitches,
        events,
    )


def effective_directive_kinds_for_section(
    profile: ResolvedProfile, section_id: str | None
) -> set[str]:
    kinds = set(profile.global_directive_kinds)
    if section_id:
        kinds.update(profile.section_directive_kinds.get(section_id, set()))
    return kinds


def effective_profile_for_section(
    profile: ResolvedProfile, section_id: str | None
) -> ResolvedProfile:
    directive_set = effective_directive_kinds_for_section(profile, section_id)
    span = None
    cadence_strength = None
    cadence_style = None

    if section_id:
        span = next(
            (
                candidate
                for candidate in profile.section_spans
                if candidate.id == section_id
            ),
            None,
        )
        if span:
            cadence_strength = span.cadence_strength
            if profile.cadence_map and span.end_measure > 0:
                cadence_style = profile.cadence_map[
                    min(span.end_measure - 1, len(profile.cadence_map) - 1)
                ]

    inferred_cadence_strength = cadence_strength
    if inferred_cadence_strength is None and span:
        if span.role in {"cadence", "outro"}:
            if cadence_style in {"authentic", "plagal"}:
                inferred_cadence_strength = 0.82
            elif cadence_style in {"half", "arrival"}:
                inferred_cadence_strength = 0.66
            elif cadence_style == "deceptive":
                inferred_cadence_strength = 0.6
            else:
                inferred_cadence_strength = 0.72
        elif span.role == "recap":
            if cadence_style in {"authentic", "plagal"}:
                inferred_cadence_strength = 0.74
            elif cadence_style in {"half", "arrival"}:
                inferred_cadence_strength = 0.62

    planned_cadence_bias = bool(
        span
        and inferred_cadence_strength is not None
        and (
            span.role in {"cadence", "recap", "outro"}
            or cadence_style in {"authentic", "plagal"}
        )
    )

    if directive_set == profile.global_directive_kinds and not planned_cadence_bias:
        return profile

    contour_span = profile.contour_span
    max_preferred_leap = profile.max_preferred_leap
    max_absolute_leap = profile.max_absolute_leap
    repetition_penalty = profile.repetition_penalty
    pitch_variety_bias = profile.pitch_variety_bias
    rhythm_variety_bias = profile.rhythm_variety_bias
    harmonic_stability_bias = profile.harmonic_stability_bias
    cadence_bass_bias = profile.cadence_bass_bias

    if span and inferred_cadence_strength is not None:
        if span.role in {"cadence", "recap", "outro"} or cadence_style in {
            "authentic",
            "plagal",
        }:
            harmonic_stability_bias = max(
                harmonic_stability_bias,
                0.45 + inferred_cadence_strength,
            )
            cadence_bass_bias = max(
                cadence_bass_bias,
                0.35 + (inferred_cadence_strength * 1.2),
            )

    if "expand_register" in directive_set:
        contour_span = max(contour_span, 24.0)

    if "reduce_large_leaps" in directive_set:
        max_preferred_leap = min(max_preferred_leap, 5)
        max_absolute_leap = min(max_absolute_leap, 9)
        harmonic_stability_bias = max(harmonic_stability_bias, 0.75)

    if "reduce_repetition" in directive_set:
        repetition_penalty = max(repetition_penalty, 2.4)

    if "increase_pitch_variety" in directive_set:
        pitch_variety_bias = max(pitch_variety_bias, 1.15)

    if "increase_rhythm_variety" in directive_set:
        rhythm_variety_bias = max(rhythm_variety_bias, 1.0)

    if "stabilize_harmony" in directive_set:
        harmonic_stability_bias = max(harmonic_stability_bias, 1.35)
        cadence_bass_bias = max(cadence_bass_bias, 1.0)

    if "strengthen_cadence" in directive_set:
        cadence_bass_bias = max(cadence_bass_bias, 1.35)

    if (
        contour_span == profile.contour_span
        and max_preferred_leap == profile.max_preferred_leap
        and max_absolute_leap == profile.max_absolute_leap
        and repetition_penalty == profile.repetition_penalty
        and pitch_variety_bias == profile.pitch_variety_bias
        and rhythm_variety_bias == profile.rhythm_variety_bias
        and harmonic_stability_bias == profile.harmonic_stability_bias
        and cadence_bass_bias == profile.cadence_bass_bias
    ):
        return profile

    return replace(
        profile,
        contour_span=contour_span,
        max_preferred_leap=max_preferred_leap,
        max_absolute_leap=max_absolute_leap,
        repetition_penalty=repetition_penalty,
        pitch_variety_bias=pitch_variety_bias,
        rhythm_variety_bias=rhythm_variety_bias,
        harmonic_stability_bias=harmonic_stability_bias,
        cadence_bass_bias=cadence_bass_bias,
    )


def measure_rng_for_section(
    profile: ResolvedProfile, section_id: str | None, measure_index: int
) -> random.Random:
    directive_kinds = sorted(effective_directive_kinds_for_section(profile, section_id))
    targeted = bool(section_id and section_id in profile.section_directive_kinds)
    seed_root = profile.active_seed_value if targeted else profile.stable_seed_value
    seed_value = derive_seed_from_parts(
        seed_root,
        section_id or "global",
        measure_index,
        profile.attempt_index if targeted else 0,
        ",".join(directive_kinds),
    )
    return random.Random(seed_value)


def clone_event_artifacts(events: Any) -> list[dict[str, Any]]:
    if not isinstance(events, list):
        return []

    cloned: list[dict[str, Any]] = []
    for event in events:
        if not isinstance(event, dict):
            continue

        cloned.append(
            {
                key: (
                    [int(value) for value in item] if isinstance(item, list) else item
                )
                for key, item in event.items()
            }
        )

    return cloned


def clone_section_artifact(artifact: dict[str, Any]) -> dict[str, Any]:
    cloned = {
        key: value
        for key, value in artifact.items()
        if key
        not in {
            "melodyEvents",
            "accompanimentEvents",
            "noteHistory",
            "capturedMotif",
            "transform",
        }
    }
    cloned["melodyEvents"] = clone_event_artifacts(artifact.get("melodyEvents"))
    cloned["accompanimentEvents"] = clone_event_artifacts(
        artifact.get("accompanimentEvents")
    )
    cloned["noteHistory"] = [
        int(value)
        for value in artifact.get("noteHistory", [])
        if isinstance(value, (int, float))
    ]
    cloned["capturedMotif"] = [
        int(value)
        for value in artifact.get("capturedMotif", [])
        if isinstance(value, (int, float))
    ]
    transform = artifact.get("transform")
    if isinstance(transform, dict):
        cloned["transform"] = {
            key: ([int(value) for value in item] if isinstance(item, list) else item)
            for key, item in transform.items()
        }
    return cloned


def normalize_section_artifacts(
    section_artifacts: Any,
) -> dict[str, dict[str, Any]]:
    if not isinstance(section_artifacts, list):
        return {}

    normalized: dict[str, dict[str, Any]] = {}
    for artifact in section_artifacts:
        if not isinstance(artifact, dict):
            continue

        section_id = str(artifact.get("sectionId") or "").strip()
        if not section_id:
            continue

        cloned = clone_section_artifact(artifact)
        cloned["sectionId"] = section_id
        cloned["role"] = str(artifact.get("role") or "theme_a").strip().lower()
        measure_count = artifact.get("measureCount")
        cloned["measureCount"] = (
            int(measure_count)
            if isinstance(measure_count, (int, float)) and int(measure_count) >= 0
            else 0
        )
        for key in {"lastPitch", "lastBassPitch", "lastInterval"}:
            value = artifact.get(key)
            if isinstance(value, (int, float)):
                cloned[key] = int(value)

        normalized[section_id] = cloned

    return normalized


def should_reuse_section_artifact(
    profile: ResolvedProfile, span: SectionSpan, section_id: str
) -> bool:
    if profile.global_directive_kinds:
        return False
    if not profile.section_directive_kinds:
        return False
    if section_id in profile.section_directive_kinds:
        return False

    artifact = profile.reusable_section_artifacts.get(section_id)
    if not artifact:
        return False

    measure_count = int(artifact.get("measureCount") or 0)
    return measure_count == max(0, span.end_measure - span.start_measure)


def restore_section_artifact(
    melody_part: stream.Part,
    accompaniment_part: stream.Part,
    artifact: dict[str, Any],
    motif_library: dict[str, list[int]],
    section_note_history: dict[str, list[int]],
    section_transformations: dict[str, dict[str, Any]],
    section_motif_offsets: dict[str, int],
) -> tuple[int | None, int | None, int | None, dict[str, Any]]:
    restored = clone_section_artifact(artifact)
    section_id = str(restored.get("sectionId") or "").strip()

    for event in restored.get("melodyEvents", []):
        append_event_artifact(melody_part, event)
    for event in restored.get("accompanimentEvents", []):
        append_event_artifact(accompaniment_part, event)

    note_history = [
        int(value)
        for value in restored.get("noteHistory", [])
        if isinstance(value, (int, float))
    ]
    if section_id:
        section_note_history[section_id] = note_history[:]
        section_motif_offsets[section_id] = len(note_history)

    captured_motif = [
        int(value)
        for value in restored.get("capturedMotif", [])
        if isinstance(value, (int, float))
    ]
    if section_id and captured_motif:
        motif_library[section_id] = captured_motif
    elif section_id and note_history:
        motif_library[section_id] = capture_motif_intervals(note_history)

    transform = restored.get("transform")
    if section_id and isinstance(transform, dict):
        section_transformations[section_id] = {
            key: ([int(value) for value in item] if isinstance(item, list) else item)
            for key, item in transform.items()
        }

    last_pitch = restored.get("lastPitch")
    last_bass_pitch = restored.get("lastBassPitch")
    last_interval = restored.get("lastInterval")
    return (
        int(last_pitch) if isinstance(last_pitch, (int, float)) else None,
        int(last_bass_pitch) if isinstance(last_bass_pitch, (int, float)) else None,
        int(last_interval) if isinstance(last_interval, (int, float)) else None,
        restored,
    )


def compose_piece(
    profile: ResolvedProfile, rng: random.Random
) -> tuple[stream.Score, list[dict[str, Any]], list[dict[str, Any]]]:
    score = stream.Score()
    score.insert(0, tempoModule.MetronomeMark(number=profile.tempo))

    melody_part = build_notated_part(
        profile.lead_instrument_name,
        profile.tonic,
        profile.mode,
        profile.time_signature,
    )
    accompaniment_part = build_notated_part(
        profile.accompaniment_instrument_name,
        profile.tonic,
        profile.mode,
        profile.time_signature,
    )

    prev_pitch: int | None = None
    prev_bass_pitch: int | None = None
    prev_structural_pitch: int | None = None
    prev_structural_bass_pitch: int | None = None
    last_interval: int | None = None
    section_lookup = {span.id: span for span in profile.section_spans}
    motif_library: dict[str, list[int]] = {
        key: value[:] for key, value in profile.sketch_motif_library.items()
    }
    section_transformations: dict[str, dict[str, Any]] = {}
    section_note_history: dict[str, list[int]] = {}
    section_anchor_pitch: dict[str, int] = {}
    section_motif_offsets: dict[str, int] = {}
    section_artifacts: dict[str, dict[str, Any]] = {}
    has_outer_voice_route_sections = any(
        span.role in {"theme_b", "recap"} or span.contrast_from
        for span in profile.section_spans
    )
    previous_section_id: str | None = None
    measure_index = 0

    while measure_index < profile.measures:
        local_tonic = profile.measure_tonics[
            min(measure_index, len(profile.measure_tonics) - 1)
        ]
        local_mode = profile.measure_modes[
            min(measure_index, len(profile.measure_modes) - 1)
        ]
        local_tonic_pitch_class = pitchModule.Pitch(f"{local_tonic}4").midi % 12
        melody_scale = [
            pitch
            for pitch in scale_pitches(local_tonic, local_mode, 4, 6)
            if 60 <= pitch <= 84
        ]
        bass_scale = scale_pitches(local_tonic, local_mode, 2, 4)
        harmony_scale = scale_pitches(local_tonic, local_mode, 3, 4)
        degree = profile.progression_degrees[
            min(measure_index, len(profile.progression_degrees) - 1)
        ]
        harmony_chord = build_chord_from_degree(harmony_scale, degree, local_mode)
        bass_chord = build_chord_from_degree(bass_scale, degree, local_mode)
        current_bass_pitch = root_bass_for_chord(bass_chord)
        section_id = profile.measure_section_ids[
            min(measure_index, len(profile.measure_section_ids) - 1)
        ]
        span = section_lookup.get(section_id) if section_id else None
        section_profile = effective_profile_for_section(profile, section_id)

        if (
            span
            and section_id
            and measure_index == span.start_measure
            and should_reuse_section_artifact(profile, span, section_id)
        ):
            prev_pitch, prev_bass_pitch, last_interval, restored_artifact = (
                restore_section_artifact(
                    melody_part,
                    accompaniment_part,
                    profile.reusable_section_artifacts[section_id],
                    motif_library,
                    section_note_history,
                    section_transformations,
                    section_motif_offsets,
                )
            )
            prev_structural_pitch = prev_pitch
            prev_structural_bass_pitch = prev_bass_pitch
            section_artifacts[section_id] = restored_artifact
            previous_section_id = section_id
            measure_index = span.end_measure
            continue

        if section_id != previous_section_id:
            if (
                profile.section_directive_kinds
                and section_id
                and section_id not in profile.section_directive_kinds
            ):
                prev_pitch = None
                prev_bass_pitch = None
                prev_structural_pitch = None
                prev_structural_bass_pitch = None
                last_interval = None
            previous_section_id = section_id

        motif_pattern: list[int] | None = None
        motif_anchor: int | None = None
        motif_offset = 0
        transform_mode = "literal"
        sequence_stride = 0
        motif_rhythm_transform: str | None = None
        measure_rng = measure_rng_for_section(profile, section_id, measure_index)

        if span and section_id:
            motif_anchor = section_anchor_pitch.setdefault(
                section_id,
                closest_scale_pitch(
                    melody_scale,
                    60 + profile.contour[measure_index] * section_profile.contour_span,
                ),
            )
            if span.motif_ref and span.motif_ref in motif_library:
                motif_pattern = motif_library[span.motif_ref]
            elif span.contrast_from and span.contrast_from in motif_library:
                motif_pattern = motif_library[span.contrast_from]
            elif section_id in motif_library:
                motif_pattern = motif_library[section_id]

            if motif_pattern:
                source_motif_pattern = motif_pattern[:]
                (
                    motif_pattern,
                    transform_mode,
                    sequence_stride,
                    motif_rhythm_transform,
                ) = resolve_section_transform(
                    span,
                    motif_pattern,
                    profile,
                )
                motif_anchor = sequence_anchor_for_measure(
                    melody_scale,
                    motif_anchor,
                    span,
                    measure_index,
                    sequence_stride,
                )
                motif_anchor = fit_motif_anchor_to_scale(
                    melody_scale,
                    motif_anchor,
                    motif_pattern,
                )
                section_transformations.setdefault(
                    section_id,
                    {
                        "sectionId": section_id,
                        "role": span.role,
                        "sourceSectionId": span.motif_ref or span.contrast_from,
                        "developmentType": span.development_type,
                        "recapMode": span.recap_mode,
                        "transformMode": transform_mode,
                        "rhythmTransform": motif_rhythm_transform or "literal",
                        "sequenceStride": sequence_stride,
                        "sourceMotifLength": len(source_motif_pattern),
                        "resolvedMotifLength": len(motif_pattern),
                        "sourceMotifIntervals": [
                            int(value) for value in source_motif_pattern
                        ],
                        "resolvedMotifIntervals": [
                            int(value) for value in motif_pattern
                        ],
                    },
                )

            motif_offset = section_motif_offsets.get(section_id, 0)

        accompaniment_events = render_accompaniment_measure(
            accompaniment_part,
            bass_chord,
            section_profile,
            measure_index,
            measure_rng,
            motif_pattern,
            motif_offset,
        )

        route_surface_realized_bass = bool(
            span
            and (
                span.role in {"theme_b", "recap"}
                or span.contrast_from
                or (has_outer_voice_route_sections and span.role == "theme_a")
            )
        )
        development_strong_beat_realized_bass = bool(
            span
            and span.role == "development"
            and motif_rhythm_transform == "diminution"
        )

        (
            prev_pitch,
            last_interval,
            prev_structural_pitch,
            prev_structural_bass_pitch,
            generated_pitches,
            melody_events,
        ) = render_melody_measure(
            melody_part,
            section_profile,
            measure_index,
            harmony_chord,
            accompaniment_events,
            current_bass_pitch,
            prev_bass_pitch,
            prev_structural_pitch,
            prev_structural_bass_pitch,
            melody_scale,
            local_tonic_pitch_class,
            local_mode,
            measure_rng,
            prev_pitch,
            last_interval,
            motif_pattern,
            motif_anchor,
            motif_offset,
            motif_rhythm_transform,
            route_surface_realized_bass or development_strong_beat_realized_bass,
            development_strong_beat_realized_bass and not route_surface_realized_bass,
            development_strong_beat_realized_bass,
        )

        if span and section_id:
            section_artifact = section_artifacts.setdefault(
                section_id,
                {
                    "sectionId": section_id,
                    "role": span.role,
                    "measureCount": max(0, span.end_measure - span.start_measure),
                    "melodyEvents": [],
                    "accompanimentEvents": [],
                    "noteHistory": [],
                    "capturedMotif": [],
                },
            )
            section_artifact["melodyEvents"].extend(melody_events)
            section_artifact["accompanimentEvents"].extend(accompaniment_events)

        if section_id and generated_pitches:
            section_note_history.setdefault(section_id, []).extend(generated_pitches)
            section_motif_offsets[section_id] = motif_offset + len(generated_pitches)

        realized_bass_pitches = extract_bass_pitches(accompaniment_events)
        prev_bass_pitch = current_bass_pitch
        if span and (
            span.role in {"theme_b", "recap"}
            or span.contrast_from
            or (has_outer_voice_route_sections and span.role == "theme_a")
        ):
            prev_bass_pitch = (
                realized_bass_pitches[-1]
                if realized_bass_pitches
                else current_bass_pitch
            )

        if span and section_id and measure_index + 1 >= span.end_measure:
            note_history = section_note_history.get(section_id, [])
            captured = capture_motif_intervals(note_history)
            if captured:
                motif_library[section_id] = captured
            section_artifact = section_artifacts.setdefault(
                section_id,
                {
                    "sectionId": section_id,
                    "role": span.role,
                    "measureCount": max(0, span.end_measure - span.start_measure),
                    "melodyEvents": [],
                    "accompanimentEvents": [],
                    "noteHistory": [],
                    "capturedMotif": [],
                },
            )
            section_artifact["noteHistory"] = note_history[:]
            section_artifact["capturedMotif"] = captured[:]
            section_artifact["lastPitch"] = prev_pitch
            section_artifact["lastBassPitch"] = prev_bass_pitch
            section_artifact["lastInterval"] = last_interval
            transform = section_transformations.get(section_id)
            if transform:
                section_artifact["transform"] = {
                    key: (
                        [int(value) for value in item]
                        if isinstance(item, list)
                        else item
                    )
                    for key, item in transform.items()
                }

        measure_index += 1

    for transform in section_transformations.values():
        section_id = str(transform.get("sectionId") or "")
        source_section_id = str(transform.get("sourceSectionId") or "")
        transform["generatedNoteCount"] = len(section_note_history.get(section_id, []))
        transform["sourceNoteCount"] = len(
            section_note_history.get(source_section_id, [])
        )
        if section_id in section_artifacts:
            section_artifacts[section_id]["transform"] = {
                key: (
                    [int(value) for value in item] if isinstance(item, list) else item
                )
                for key, item in transform.items()
            }

    for span in profile.section_spans:
        artifact = section_artifacts.get(span.id)
        if not artifact:
            continue

        note_history = [
            int(value)
            for value in artifact.get("noteHistory", [])
            if isinstance(value, (int, float))
        ]
        secondary_line_pitches = extract_secondary_line_pitches(
            artifact.get("accompanimentEvents", [])
        )
        melody_pitch_min, melody_pitch_max = pitch_range(note_history)
        bass_pitches = extract_bass_pitches(artifact.get("accompanimentEvents", []))
        bass_pitch_min, bass_pitch_max = pitch_range(bass_pitches)
        melody_velocities = extract_velocities(artifact.get("melodyEvents", []))
        accompaniment_velocities = extract_velocities(
            artifact.get("accompanimentEvents", [])
        )
        melody_velocity_min, melody_velocity_max = pitch_range(melody_velocities)
        accompaniment_velocity_min, accompaniment_velocity_max = pitch_range(
            accompaniment_velocities
        )

        if span.planned_register_center is not None:
            artifact["plannedRegisterCenter"] = int(span.planned_register_center)

        realized_register_center = average_pitch_value(note_history)
        if realized_register_center is not None:
            artifact["realizedRegisterCenter"] = realized_register_center

        if secondary_line_pitches:
            artifact["secondaryLinePitchCount"] = len(secondary_line_pitches)
            secondary_line_min, secondary_line_max = pitch_range(secondary_line_pitches)
            if secondary_line_min is not None and secondary_line_max is not None:
                artifact["secondaryLineSpan"] = int(
                    secondary_line_max - secondary_line_min
                )
            artifact["secondaryLineDistinctPitchClasses"] = distinct_pitch_class_count(
                secondary_line_pitches
            )
            secondary_line_motif = capture_motif_intervals(secondary_line_pitches)
            if len(secondary_line_motif) >= 2:
                artifact["secondaryLineMotif"] = secondary_line_motif

            independent_motion_rate = pitch_motion_rate(secondary_line_pitches)
            if independent_motion_rate is not None:
                artifact["textureIndependentMotionRate"] = independent_motion_rate

            contrary_rate = contrary_motion_rate(note_history, secondary_line_pitches)
            if contrary_rate is not None:
                artifact["textureContraryMotionRate"] = contrary_rate

        if melody_pitch_min is not None:
            artifact["melodyPitchMin"] = int(melody_pitch_min)
        if melody_pitch_max is not None:
            artifact["melodyPitchMax"] = int(melody_pitch_max)
        if bass_pitch_min is not None:
            artifact["bassPitchMin"] = int(bass_pitch_min)
        if bass_pitch_max is not None:
            artifact["bassPitchMax"] = int(bass_pitch_max)
        if melody_velocity_min is not None:
            artifact["melodyVelocityMin"] = int(melody_velocity_min)
        if melody_velocity_max is not None:
            artifact["melodyVelocityMax"] = int(melody_velocity_max)
        if accompaniment_velocity_min is not None:
            artifact["accompanimentVelocityMin"] = int(accompaniment_velocity_min)
        if accompaniment_velocity_max is not None:
            artifact["accompanimentVelocityMax"] = int(accompaniment_velocity_max)

        bass_motion_profile = classify_bass_motion_profile(bass_pitches)
        if bass_motion_profile:
            artifact["bassMotionProfile"] = bass_motion_profile

        cadence_approach = classify_cadence_approach(
            bass_pitches,
            span.tonal_center or format_key_name(profile.tonic, profile.mode),
        )
        if cadence_approach:
            artifact["cadenceApproach"] = cadence_approach

        if span.section_style:
            artifact["sectionStyle"] = span.section_style

        if span.development_type:
            artifact["developmentType"] = span.development_type

        if span.phrase_function:
            artifact["phraseFunction"] = span.phrase_function

        if span.phrase_span_shape:
            artifact["phraseSpanShape"] = span.phrase_span_shape

        if span.continuation_pressure:
            artifact["continuationPressure"] = span.continuation_pressure

        if span.cadential_buildup:
            artifact["cadentialBuildup"] = span.cadential_buildup

        if span.harmony_density:
            artifact["harmonyDensity"] = span.harmony_density

        if span.voicing_profile:
            artifact["voicingProfile"] = span.voicing_profile

        if span.prolongation_mode:
            artifact["prolongationMode"] = span.prolongation_mode

        if span.tonicization_windows:
            artifact["tonicizationWindows"] = [
                dict(window) for window in span.tonicization_windows
            ]

        if span.harmonic_color_cues:
            artifact["harmonicColorCues"] = [
                dict(cue) for cue in span.harmonic_color_cues
            ]

        if span.texture_guidance:
            voice_count = span.texture_guidance.get("voiceCount")
            if isinstance(voice_count, (int, float)):
                artifact["textureVoiceCount"] = int(voice_count)

            primary_roles = span.texture_guidance.get("primaryRoles")
            if isinstance(primary_roles, list) and primary_roles:
                artifact["primaryTextureRoles"] = [
                    str(value) for value in primary_roles if str(value).strip()
                ]

            counterpoint_mode = span.texture_guidance.get("counterpointMode")
            if isinstance(counterpoint_mode, str) and counterpoint_mode.strip():
                artifact["counterpointMode"] = counterpoint_mode

            texture_notes = span.texture_guidance.get("notes")
            if isinstance(texture_notes, list) and texture_notes:
                artifact["textureNotes"] = [
                    str(value).strip() for value in texture_notes if str(value).strip()
                ]

        if span.expression_guidance:
            dynamics = span.expression_guidance.get("dynamics")
            if isinstance(dynamics, dict) and dynamics:
                artifact["expressionDynamics"] = {
                    key: value for key, value in dynamics.items() if value
                }

            articulation = span.expression_guidance.get("articulation")
            if isinstance(articulation, list) and articulation:
                artifact["articulation"] = list(articulation)

            character = span.expression_guidance.get("character")
            if isinstance(character, list) and character:
                artifact["character"] = list(character)

            phrase_peaks = span.expression_guidance.get("phrasePeaks")
            if isinstance(phrase_peaks, list) and phrase_peaks:
                artifact["phrasePeaks"] = [
                    int(value)
                    for value in phrase_peaks
                    if isinstance(value, (int, float)) and int(value) > 0
                ]

            sustain_bias = span.expression_guidance.get("sustainBias")
            if isinstance(sustain_bias, (int, float)):
                artifact["sustainBias"] = round(float(sustain_bias), 3)

            accent_bias = span.expression_guidance.get("accentBias")
            if isinstance(accent_bias, (int, float)):
                artifact["accentBias"] = round(float(accent_bias), 3)

    ordered_section_artifacts = [
        clone_section_artifact(section_artifacts[span.id])
        for span in profile.section_spans
        if span.id in section_artifacts
    ]

    score.insert(0, melody_part)
    split_parts = split_accompaniment_parts(profile, ordered_section_artifacts)
    if split_parts:
        rendered_accompaniment_part, secondary_part = split_parts
        score.insert(0, secondary_part)
        score.insert(0, rendered_accompaniment_part)
    else:
        score.insert(0, accompaniment_part)
    return score, list(section_transformations.values()), ordered_section_artifacts


def main() -> None:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    prompt = str(req.get("prompt", "")).strip()
    key_str = str(req.get("key", "")).strip() or None
    tempo_value = req.get("tempo")
    bpm = int(tempo_value) if isinstance(tempo_value, (int, float)) else None
    form = str(req.get("form", "")).strip() or None
    seed = req.get("seed")
    stable_seed = req.get("stableSeed")
    output_path = req.get("outputPath", "output.mid")
    composition_profile = req.get("compositionProfile", {})
    if not isinstance(composition_profile, dict):
        composition_profile = {}
    composition_plan = req.get("compositionPlan", {})
    if not isinstance(composition_plan, dict):
        composition_plan = {}
    revision_directives = req.get("revisionDirectives", [])
    section_artifacts = req.get("sectionArtifacts", [])
    attempt_index_value = req.get("attemptIndex")
    attempt_index = (
        int(attempt_index_value)
        if isinstance(attempt_index_value, (int, float))
        and int(attempt_index_value) > 0
        else 1
    )

    try:
        active_seed_value = derive_seed_value(
            prompt, key_str or "", bpm, form or "miniature", seed
        )
        stable_seed_value = derive_seed_value(
            prompt,
            key_str or "",
            bpm,
            form or "miniature",
            stable_seed if stable_seed is not None else seed,
        )
        profile_rng = random.Random(
            stable_seed_value
            if directive_kinds_by_section(revision_directives)
            and not global_directive_kinds(revision_directives)
            else active_seed_value
        )
        profile = resolve_profile(
            prompt=prompt,
            requested_key=key_str,
            requested_tempo=bpm,
            requested_form=form,
            composition_profile=composition_profile,
            composition_plan=composition_plan,
            revision_directives=revision_directives,
            section_artifacts=section_artifacts,
            attempt_index=attempt_index,
            active_seed_value=active_seed_value,
            stable_seed_value=stable_seed_value,
            rng=profile_rng,
        )
        score, section_transforms, section_artifacts_result = compose_piece(
            profile, profile_rng
        )

        out_dir = os.path.dirname(output_path)
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)

        mf = m21midi.translate.music21ObjectToMidiFile(score)
        mf.open(output_path, "wb")
        mf.write()
        mf.close()

        total_notes = sum(
            1 for el in score.recurse() if isinstance(el, (note.Note, chord.Chord))
        )

        result = {
            "ok": True,
            "midiPath": output_path,
            "measures": profile.measures,
            "notes": total_notes,
            "partCount": len(score.parts),
            "partInstrumentNames": describe_score_part_instruments(score),
            "key": f"{profile.tonic} {profile.mode}",
            "tempo": profile.tempo,
            "form": profile.form,
            "timeSignature": profile.time_signature,
            "style": profile.style,
            "sectionArtifacts": section_artifacts_result,
            "sectionTransforms": section_transforms,
            "sectionTonalities": [
                {
                    "sectionId": span.id,
                    "role": span.role,
                    "tonalCenter": span.tonal_center
                    or format_key_name(profile.tonic, profile.mode),
                    "keyTarget": (
                        span.tonicization_windows[0].get("keyTarget")
                        if span.tonicization_windows
                        else None
                    ),
                    "harmonicRhythm": span.harmonic_rhythm,
                    "harmonyDensity": span.harmony_density,
                    "voicingProfile": span.voicing_profile,
                    "prolongationMode": span.prolongation_mode,
                    "tonicizationWindows": [
                        dict(window) for window in span.tonicization_windows
                    ]
                    if span.tonicization_windows
                    else None,
                    "harmonicColorCues": [dict(cue) for cue in span.harmonic_color_cues]
                    if span.harmonic_color_cues
                    else None,
                    "measures": span.end_measure - span.start_measure,
                }
                for span in profile.section_spans
            ],
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
