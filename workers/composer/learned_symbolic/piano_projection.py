"""Piano voice-role projection for the solo_piano_symbolic lane.

Converts a flat event stream (melody + accompaniment) into a two-stave layout
(rightHandMeasures / leftHandMeasures) and populates a PianoVoiceLayoutSummary.

Active: wired into run_abc_projection_pipeline() (abc_project.py) when
lane == "solo_piano_symbolic".

Voice-role assignment rules
────────────────────────────
  Role  "lead"         → right hand (melody)
  Role  "inner_voice"  → right hand if pitch >= split_pitch, else left hand
  Role  "counterline"  → same rule as inner_voice
  Role  "bass"         → left hand (bass)
  Unassigned / fallback:
       pitch >= split_pitch  → right hand
       pitch <  split_pitch  → left hand
"""

from __future__ import annotations

from typing import Any, NotRequired, TypedDict, cast

from .abc_types import (
    PIANO_LEFT_HAND_PITCH_MAX,
    PIANO_LEFT_HAND_PITCH_MIN,
    PIANO_MAX_CHORD_VOICES,
    PIANO_MAX_HAND_SPAN,
    PIANO_RIGHT_HAND_PITCH_MAX,
    PIANO_RIGHT_HAND_PITCH_MIN,
    WARN_PIANO_HAND_COLLISION,
    WARN_PIANO_SPAN_EXCEEDED,
    PianoHandSplit,
    PianoVoiceLayoutDict,
)

# Default MIDI pitch at which events are routed to right vs left hand.
DEFAULT_HAND_SPLIT_PITCH: int = 60   # C4

# ─── Internal type aliases ────────────────────────────────────────────────────

Event = dict[str, Any]
MeasureBin = list[Event]


class PianoSectionMaterial(TypedDict):
    """Single-section projection result for the piano lane."""

    sectionId: str
    role: str
    measureCount: int
    tonalCenter: str
    phraseFunction: Any
    rightHandEvents: list[Event]        # all events routed to the right hand
    leftHandEvents: list[Event]         # all events routed to the left hand
    noteHistory: list[int]              # MIDI pitches of melody notes in order
    rightHandMeasures: list[MeasureBin]
    leftHandMeasures: list[MeasureBin]
    handSplits: NotRequired[list[dict[str, Any]]]  # serialised PianoHandSplit records


class PianoProjectionResult(TypedDict):
    """Full-piece projection result for the piano lane.

    Shape mirrors SymbolicProjectionResult (symbolic_projection.py) so that
    downstream consumers can be parameterised by lane type.
    """

    proposalSections: list[PianoSectionMaterial]
    rightHandMeasures: list[MeasureBin]   # flattened across all sections
    leftHandMeasures: list[MeasureBin]    # flattened across all sections
    totalMeasureCount: int
    totalNoteCount: int
    voiceLayoutSummary: PianoVoiceLayoutDict
    normalizationWarnings: list[str]


# ─── Helpers ──────────────────────────────────────────────────────────────────


def as_record(value: Any) -> dict[str, Any] | None:
    return cast(dict[str, Any], value) if isinstance(value, dict) else None


def as_list(value: Any) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def normalize_role(value: Any) -> str:
    s = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if s in {"lead", "counterline", "inner_voice", "bass"}:
        return s
    return "unassigned"


def build_empty_measures(count: int) -> list[MeasureBin]:
    return [[] for _ in range(max(1, count))]


def measure_index_for(progress: float, measure_count: int) -> int:
    return min(int(progress // 4.0), measure_count - 1)


# ─── Hand assignment ──────────────────────────────────────────────────────────


def assign_piano_hand(
    event: Event,
    split_pitch: int = DEFAULT_HAND_SPLIT_PITCH,
) -> str:
    """Return "right", "left", or "ambiguous" for a single event.

    For chord events the decision is based on the *median* pitch.
    """
    kind = str(event.get("kind") or event.get("type") or "note").lower()
    if kind == "rest":
        return "ambiguous"

    role = normalize_role(event.get("role") or event.get("voiceRole"))

    if role == "lead":
        return "right"
    if role == "bass":
        return "left"

    # inner_voice / counterline / unassigned → decide by pitch
    if kind == "chord":
        pitches = as_list(event.get("midiPitches") or event.get("pitches"))
        int_pitches = [int(p) for p in pitches if isinstance(p, (int, float))]
        if not int_pitches:
            return "ambiguous"
        median = sorted(int_pitches)[len(int_pitches) // 2]
        return "right" if median >= split_pitch else "left"

    pitch = event.get("midi") or event.get("pitch")
    if not isinstance(pitch, (int, float)):
        return "ambiguous"
    return "right" if int(pitch) >= split_pitch else "left"


# ─── Voice layout summary builder ────────────────────────────────────────────


def compute_piano_voice_layout_summary(
    rh_events: list[Event],
    lh_events: list[Event],
) -> tuple[PianoVoiceLayoutDict, list[str]]:
    """Build a PianoVoiceLayoutDict from segregated RH/LH event lists.

    Returns (layout_dict, warning_codes).
    """
    warnings: list[str] = []

    rh_pitches: list[int] = []
    lh_pitches: list[int] = []
    rh_chord_spans: list[int] = []
    lh_chord_spans: list[int] = []
    all_voice_counts: list[int] = []
    crossing_count = 0
    collision_count = 0

    def extract_pitches(event: Event) -> list[int]:
        kind = str(event.get("kind") or event.get("type") or "note").lower()
        if kind == "rest":
            return []
        if kind == "chord":
            raw = as_list(event.get("midiPitches") or event.get("pitches"))
            return [int(p) for p in raw if isinstance(p, (int, float))]
        p = event.get("midi") or event.get("pitch")
        return [int(p)] if isinstance(p, (int, float)) else []

    for ev in rh_events:
        ps = extract_pitches(ev)
        rh_pitches.extend(ps)
        if len(ps) >= 2:
            span = max(ps) - min(ps)
            rh_chord_spans.append(span)
            all_voice_counts.append(len(ps))
            if span > PIANO_MAX_HAND_SPAN:
                warnings.append(WARN_PIANO_SPAN_EXCEEDED)
        elif ps:
            all_voice_counts.append(1)

    for ev in lh_events:
        ps = extract_pitches(ev)
        lh_pitches.extend(ps)
        if len(ps) >= 2:
            span = max(ps) - min(ps)
            lh_chord_spans.append(span)
            if span > PIANO_MAX_HAND_SPAN:
                warnings.append(WARN_PIANO_SPAN_EXCEEDED)

    # Hand crossings: LH top pitch > RH bottom pitch at coincident beats
    # (simple heuristic using beat-indexed scan; full beat alignment is left
    #  to the ABC parser stage)
    rh_bottom = min(rh_pitches) if rh_pitches else None
    lh_top = max(lh_pitches) if lh_pitches else None
    if rh_bottom is not None and lh_top is not None:
        if lh_top > rh_bottom:
            crossing_count = 1  # conservative — exact count needs beat alignment
            warnings.append(WARN_PIANO_HAND_COLLISION)
        if lh_top == rh_bottom:
            collision_count = 1
            warnings.append(WARN_PIANO_HAND_COLLISION)

    total_events = len(rh_events) + len(lh_events)
    if total_events > 0:
        span_ok = sum(
            1 for span in rh_chord_spans if span <= PIANO_MAX_HAND_SPAN
        ) + sum(
            1 for span in lh_chord_spans if span <= PIANO_MAX_HAND_SPAN
        )
        total_chords = len(rh_chord_spans) + len(lh_chord_spans)
        playable_span_fit = float(span_ok) / max(1, total_chords) if total_chords else 1.0
    else:
        playable_span_fit = 1.0

    avg_voice_count = (
        sum(all_voice_counts) / len(all_voice_counts) if all_voice_counts else 0.0
    )

    layout: PianoVoiceLayoutDict = {}
    if rh_pitches:
        layout["rightHandPitchMin"] = min(rh_pitches)
        layout["rightHandPitchMax"] = max(rh_pitches)
    if lh_pitches:
        layout["leftHandPitchMin"] = min(lh_pitches)
        layout["leftHandPitchMax"] = max(lh_pitches)
    if rh_chord_spans:
        layout["maxRightHandSpan"] = max(rh_chord_spans)
    if lh_chord_spans:
        layout["maxLeftHandSpan"] = max(lh_chord_spans)
    layout["handCrossingCount"] = crossing_count
    layout["handCollisionCount"] = collision_count
    layout["avgChordVoiceCount"] = round(avg_voice_count, 4)
    layout["playableSpanFit"] = round(playable_span_fit, 4)

    # Composite playability score: penalise hand crossing/collision events.
    collision_penalty = 0.15 if (crossing_count > 0 or collision_count > 0) else 0.0
    layout["pianoPlayabilityScore"] = max(0.0, round(playable_span_fit - collision_penalty, 4))

    return layout, list(dict.fromkeys(warnings))   # deduplicated


# ─── Section projection ───────────────────────────────────────────────────────


def project_piano_section(
    section: dict[str, Any],
    section_index: int,
    events_melody: list[Event],
    events_accompaniment: list[Event],
    split_pitch: int = DEFAULT_HAND_SPLIT_PITCH,
) -> PianoSectionMaterial:
    """Project a section's flat event lists into RH/LH measure bins.

    Args:
        section: plan section dict with keys id, role, measures, harmonicPlan.
        section_index: zero-based position (used for fallback sectionId).
        events_melody: flat list of lead/melody events.
        events_accompaniment: flat list of support/bass/inner-voice events.
        split_pitch: MIDI pitch boundary (inclusive = RH).
    """
    section_id = str(
        section.get("id") or section.get("sectionId") or f"section-{section_index + 1}"
    )
    role = str(section.get("role") or "theme_a")
    measure_count = int(section.get("measures") or 4)
    tonal_center = str(
        (as_record(section.get("harmonicPlan")) or {}).get("tonalCenter") or "C major"
    )
    phrase_function = section.get("phraseFunction")

    rh_measures = build_empty_measures(measure_count)
    lh_measures = build_empty_measures(measure_count)

    rh_events: list[Event] = []
    lh_events: list[Event] = []
    note_history: list[int] = []
    hand_splits: list[dict[str, Any]] = []

    rh_progress = 0.0
    lh_progress = 0.0

    for event_index, raw_event in enumerate(events_melody + events_accompaniment):
        ev = as_record(raw_event)
        if ev is None:
            continue

        kind = str(ev.get("kind") or ev.get("type") or "note").lower()
        quarter_length = float(ev.get("quarterLength") or 1.0)
        hand = assign_piano_hand(ev, split_pitch)

        span_warning = False
        collision_warning = False

        if kind == "note":
            pitch = ev.get("midi") or ev.get("pitch")
            if isinstance(pitch, (int, float)):
                midi_val = int(pitch)
                note_history.append(midi_val)
                if hand == "right":
                    mi = measure_index_for(rh_progress, measure_count)
                    rh_measures[mi].append(ev)
                    rh_events.append(ev)
                    rh_progress += quarter_length
                elif hand == "left":
                    mi = measure_index_for(lh_progress, measure_count)
                    lh_measures[mi].append(ev)
                    lh_events.append(ev)
                    lh_progress += quarter_length
                else:
                    # Ambiguous → route by pitch
                    if midi_val >= split_pitch:
                        mi = measure_index_for(rh_progress, measure_count)
                        rh_measures[mi].append(ev)
                        rh_events.append(ev)
                        rh_progress += quarter_length
                    else:
                        mi = measure_index_for(lh_progress, measure_count)
                        lh_measures[mi].append(ev)
                        lh_events.append(ev)
                        lh_progress += quarter_length

        elif kind == "chord":
            pitches = as_list(ev.get("midiPitches") or ev.get("pitches"))
            int_pitches = [int(p) for p in pitches if isinstance(p, (int, float))]
            if int_pitches:
                span = max(int_pitches) - min(int_pitches)
                span_warning = span > PIANO_MAX_HAND_SPAN
                note_history.extend(int_pitches)
                if hand == "right":
                    mi = measure_index_for(rh_progress, measure_count)
                    rh_measures[mi].append(ev)
                    rh_events.append(ev)
                    rh_progress += quarter_length
                else:
                    mi = measure_index_for(lh_progress, measure_count)
                    lh_measures[mi].append(ev)
                    lh_events.append(ev)
                    lh_progress += quarter_length

        elif kind == "rest":
            # Route rests to the hand with less progress to keep measure bins balanced
            if rh_progress <= lh_progress:
                mi = measure_index_for(rh_progress, measure_count)
                rh_measures[mi].append(ev)
                rh_progress += quarter_length
            else:
                mi = measure_index_for(lh_progress, measure_count)
                lh_measures[mi].append(ev)
                lh_progress += quarter_length

        pitch_value = int(ev.get("midi") or ev.get("pitch") or 0)
        hand_splits.append({
            "event_index": event_index,
            "pitch": pitch_value,
            "hand": hand,
            "span_warning": span_warning,
            "collision_warning": collision_warning,
        })

    material: PianoSectionMaterial = {
        "sectionId": section_id,
        "role": role,
        "measureCount": measure_count,
        "tonalCenter": tonal_center,
        "phraseFunction": phrase_function,
        "rightHandEvents": rh_events,
        "leftHandEvents": lh_events,
        "noteHistory": note_history,
        "rightHandMeasures": rh_measures,
        "leftHandMeasures": lh_measures,
        "handSplits": hand_splits,
    }
    return material


# ─── Top-level runner ─────────────────────────────────────────────────────────


def run_piano_projection(
    payload: dict[str, Any],
    plan: dict[str, Any],
    split_pitch: int = DEFAULT_HAND_SPLIT_PITCH,
) -> PianoProjectionResult:
    """Entry point analogous to symbolic_projection.run_symbolic_projection().

    Takes the normalised payload (with optional sectionArtifacts seeds) and the
    composition plan.  Returns a PianoProjectionResult.
    """
    sections = as_list(plan.get("sections"))
    if not sections:
        return {
            "proposalSections": [],
            "rightHandMeasures": [],
            "leftHandMeasures": [],
            "totalMeasureCount": 0,
            "totalNoteCount": 0,
            "voiceLayoutSummary": {},
            "normalizationWarnings": ["no sections in plan"],
        }

    # Seed from existing sectionArtifacts (revision path)
    seeded: dict[str, dict[str, Any]] = {}
    for raw_entry in as_list(payload.get("sectionArtifacts")):
        entry = as_record(raw_entry)
        if entry is None:
            continue
        sid = str(entry.get("sectionId") or "").strip()
        if sid:
            seeded[sid] = entry

    proposal_sections: list[PianoSectionMaterial] = []
    all_rh_measures: list[MeasureBin] = []
    all_lh_measures: list[MeasureBin] = []
    total_note_count = 0
    all_rh_events: list[Event] = []
    all_lh_events: list[Event] = []
    warnings: list[str] = []

    for index, raw_section in enumerate(sections):
        section = as_record(raw_section)
        if section is None:
            continue

        section_id = str(section.get("id") or f"section-{index + 1}")
        seed = seeded.get(section_id)

        melody_events: list[Event] = []
        accompaniment_events: list[Event] = []

        if seed is not None:
            melody_events = [
                ev for ev in as_list(seed.get("melodyEvents"))
                if as_record(ev) is not None
            ]
            accompaniment_events = [
                ev for ev in as_list(seed.get("accompanimentEvents"))
                if as_record(ev) is not None
            ]

        material = project_piano_section(
            section=section,
            section_index=index,
            events_melody=melody_events,
            events_accompaniment=accompaniment_events,
            split_pitch=split_pitch,
        )

        proposal_sections.append(material)
        all_rh_measures.extend(material["rightHandMeasures"])
        all_lh_measures.extend(material["leftHandMeasures"])
        all_rh_events.extend(material["rightHandEvents"])
        all_lh_events.extend(material["leftHandEvents"])
        total_note_count += len(material["noteHistory"])

    layout_summary, layout_warnings = compute_piano_voice_layout_summary(
        all_rh_events, all_lh_events
    )
    warnings.extend(layout_warnings)

    return {
        "proposalSections": proposal_sections,
        "rightHandMeasures": all_rh_measures,
        "leftHandMeasures": all_lh_measures,
        "totalMeasureCount": len(all_rh_measures),
        "totalNoteCount": total_note_count,
        "voiceLayoutSummary": layout_summary,
        "normalizationWarnings": warnings,
    }


# ─── ABC projection enrichment helper ────────────────────────────────────────


def enrich_proposal_sections_with_piano_layout(
    proposal_sections: list[dict[str, Any]],
    split_pitch: int = DEFAULT_HAND_SPLIT_PITCH,
) -> tuple[list[dict[str, Any]], PianoVoiceLayoutDict, list[str]]:
    """Enrich generic ABC proposal sections with RH/LH piano projection data.

    Called from abc_project.run_abc_projection_pipeline() when
    lane == "solo_piano_symbolic".  Takes the sections produced by
    abc_to_events.convert() (which have leadEvents / supportEvents) and:

    1. Runs project_piano_section() on each section to split events into
       rightHandEvents / leftHandEvents / rightHandMeasures / leftHandMeasures.
    2. Computes a per-section PianoVoiceLayoutDict from the section's events.
    3. Computes a global PianoVoiceLayoutDict from all events combined.
    4. Merges piano fields back into each section dict (non-destructive).

    Returns:
        (enriched_sections, global_voice_layout, warnings)
    """
    all_rh_events: list[Event] = []
    all_lh_events: list[Event] = []
    enriched: list[dict[str, Any]] = []
    warnings: list[str] = []

    for index, raw_section in enumerate(proposal_sections):
        section = dict(raw_section)  # shallow copy so we don't mutate the input

        melody_events: list[Event] = [
            ev for ev in as_list(section.get("leadEvents"))
            if as_record(ev) is not None
        ]
        accompaniment_events: list[Event] = [
            ev for ev in as_list(section.get("supportEvents"))
            if as_record(ev) is not None
        ]

        material = project_piano_section(
            section=section,
            section_index=index,
            events_melody=melody_events,
            events_accompaniment=accompaniment_events,
            split_pitch=split_pitch,
        )

        # Per-section voice layout (used by TypeScript's SectionArtifactSummary.pianoVoiceLayout)
        section_layout, section_layout_warnings = compute_piano_voice_layout_summary(
            material["rightHandEvents"], material["leftHandEvents"]
        )
        warnings.extend(section_layout_warnings)

        # Merge piano projection fields into the section dict
        section["rightHandEvents"] = material["rightHandEvents"]
        section["leftHandEvents"] = material["leftHandEvents"]
        section["rightHandMeasures"] = material["rightHandMeasures"]
        section["leftHandMeasures"] = material["leftHandMeasures"]
        section["handSplits"] = material.get("handSplits", [])
        section["pianoVoiceLayout"] = section_layout

        all_rh_events.extend(material["rightHandEvents"])
        all_lh_events.extend(material["leftHandEvents"])
        enriched.append(section)

    global_layout, global_layout_warnings = compute_piano_voice_layout_summary(
        all_rh_events, all_lh_events
    )
    # De-duplicate warnings (span/collision may fire many times)
    for w in global_layout_warnings:
        if w not in warnings:
            warnings.append(w)

    return enriched, global_layout, warnings
