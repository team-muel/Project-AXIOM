"""
AXIOM Render — MIDI → score preview / WAV / preview video 렌더링 워커.

- SVG 악보 미리보기는 symbolic render 경로에서 기본 산출물로 생성한다.
- WAV는 SoundFont가 있으면 생성한다.
- preview MP4는 ffmpeg가 있고 WAV가 생성된 경우에만 추가 생성한다.

stdin으로 JSON 요청을 받고, 가능한 산출물을 생성한 뒤 stdout에 JSON 결과를 출력한다.

요청 형식:
{
    "midiPath": "outputs/<songId>/humanized.mid",
    "outputDir": "outputs/<songId>",
    "soundfontPath": "assets/soundfonts/piano.sf2",
    "ffmpegBin": "ffmpeg"
}

응답 형식:
{
    "ok": true,
    "wavPath": "outputs/<songId>/output.wav",
    "scoreImage": "outputs/<songId>/score-preview.svg",
    "videoPath": "outputs/<songId>/preview.mp4",
    "durationSec": 32.5,
    "warnings": []
}
또는
{ "ok": false, "error": "..." }
"""

import json
import sys
import os
import subprocess
import shutil
import math
import importlib
from xml.sax.saxutils import escape
from typing import Any, TypedDict, cast

from music21 import converter, note, chord, stream

# FluidSynth 바이너리 탐색 경로 (tools/ 내 로컬 설치 포함)
_LOCAL_FLUIDSYNTH_PATHS = [
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "tools",
        "fluidsynth",
        "bin",
        "fluidsynth.exe",
    ),
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "tools",
        "fluidsynth",
        "bin",
        "fluidsynth",
    ),
]

_LOCAL_FFMPEG_PATHS = [
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "tools",
        "ffmpeg",
        "bin",
        "ffmpeg.exe",
    ),
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "tools",
        "ffmpeg",
        "bin",
        "ffmpeg",
    ),
]


def _resolve_binary(candidate: str | None) -> str | None:
    """실행 파일 경로 또는 PATH 상 명령명을 실제 경로로 변환한다."""
    if not candidate:
        return None

    norm = os.path.normpath(candidate)
    if os.path.isfile(norm):
        return norm

    return shutil.which(candidate)


def _find_fluidsynth() -> str | None:
    """PATH 또는 로컬 tools/ 에서 FluidSynth 바이너리를 찾는다."""
    # PATH에서 먼저
    found = _resolve_binary("fluidsynth")
    if found:
        return found
    # 로컬 경로
    for p in _LOCAL_FLUIDSYNTH_PATHS:
        found = _resolve_binary(p)
        if found:
            return found
    return None


def _find_ffmpeg(candidate: str | None = None) -> str | None:
    """PATH 또는 로컬 tools/ 에서 ffmpeg 바이너리를 찾는다."""
    found = _resolve_binary(candidate)
    if found:
        return found

    found = _resolve_binary("ffmpeg")
    if found:
        return found

    for p in _LOCAL_FFMPEG_PATHS:
        found = _resolve_binary(p)
        if found:
            return found
    return None


def render_with_fluidsynth_cli(
    midi_path: str,
    wav_path: str,
    soundfont_path: str,
    sample_rate: int = 44100,
) -> None:
    """FluidSynth CLI로 MIDI를 WAV로 렌더링한다."""
    fluidsynth_bin = _find_fluidsynth()
    if not fluidsynth_bin:
        raise FileNotFoundError(
            "FluidSynth not found on PATH or in tools/fluidsynth/bin/. "
            "Install FluidSynth: https://github.com/FluidSynth/fluidsynth/releases"
        )

    cmd = [
        fluidsynth_bin,
        "-ni",  # no interactive, no midi-in
        "-g",
        "1.0",  # gain
        "-r",
        str(sample_rate),  # sample rate
        "-F",
        wav_path,  # output file
        soundfont_path,
        midi_path,
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"FluidSynth failed (exit {result.returncode}): {result.stderr}"
        )


def render_with_midi2audio(
    midi_path: str,
    wav_path: str,
    soundfont_path: str,
    sample_rate: int = 44100,
) -> None:
    """midi2audio 라이브러리로 MIDI를 WAV로 렌더링한다."""
    try:
        midi2audio = importlib.import_module("midi2audio")
        fluid_synth_cls = getattr(midi2audio, "FluidSynth", None)
        if fluid_synth_cls is None:
            raise ImportError("midi2audio.FluidSynth is unavailable")
    except (ImportError, ModuleNotFoundError):
        raise ImportError("midi2audio not installed. Run: pip install midi2audio")

    fs = fluid_synth_cls(soundfont_path, sample_rate=sample_rate)
    fs.midi_to_audio(midi_path, wav_path)


def get_wav_duration(wav_path: str) -> float:
    """WAV 파일의 재생 시간(초)을 반환한다."""
    import wave

    try:
        with wave.open(wav_path, "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            return frames / rate if rate > 0 else 0.0
    except Exception:
        return 0.0


def _staff_line_y(staff_top: float, index: int) -> float:
    return staff_top + (index * 12.0)


def _pitch_to_y(midi_value: int, middle_line_y: float, reference_midi: int) -> float:
    return middle_line_y - ((midi_value - reference_midi) * 3.5)


class StaffPreview(TypedDict):
    label: str
    top: float
    middle_line_y: float
    reference_midi: int
    color: str
    events: list[object]


def _collect_stream_parts(parsed_score: Any) -> list[stream.Stream[Any]]:
    parts_attr: Any = getattr(parsed_score, "parts", None)
    parts: list[stream.Stream[Any]] = []

    if parts_attr is not None:
        for entry in list(parts_attr):
            if isinstance(entry, stream.Stream):
                parts.append(cast(stream.Stream[Any], entry))

    if not parts and isinstance(parsed_score, stream.Stream):
        parts.append(cast(stream.Stream[Any], parsed_score))

    return parts


def _notes_and_rests(part_stream: stream.Stream[Any]) -> list[object]:
    return list(cast(Any, part_stream.flatten().notesAndRests))


def render_score_preview_svg(midi_path: str, output_dir: str) -> str:
    """MIDI에서 간단한 SVG 악보 미리보기를 생성한다."""
    return render_score_preview_svg_with_expression(midi_path, output_dir, [])


def render_score_preview_svg_with_expression(
    midi_path: str,
    output_dir: str,
    expression_summary_lines: list[str] | None = None,
) -> str:
    """MIDI에서 간단한 SVG 악보 미리보기를 생성한다."""
    parse_score = getattr(cast(Any, converter), "parse")
    parsed_score: Any = parse_score(midi_path)
    score_stream: Any = parsed_score
    parts = _collect_stream_parts(parsed_score)
    if not parts:
        raise ValueError("Unable to extract playable parts from parsed MIDI")

    expression_summary_lines = [
        str(line).strip()
        for line in (expression_summary_lines or [])
        if str(line).strip()
    ]

    total_quarters = max(float(score_stream.highestTime or 0.0), 1.0)
    time_sigs: list[Any] = list(
        score_stream.recurse().getElementsByClass("TimeSignature")
    )
    measure_quarters = 4.0
    if time_sigs:
        try:
            measure_quarters = max(float(time_sigs[0].barDuration.quarterLength), 1.0)
        except Exception:
            measure_quarters = 4.0

    measures = max(1, math.ceil(total_quarters / measure_quarters))
    width = max(1100, min(2200, int(total_quarters * 120.0) + 220))
    expression_panel_height = 0
    if expression_summary_lines:
        expression_panel_height = 96 + (len(expression_summary_lines) * 18)
    height = 420 + expression_panel_height
    margin_left = 120.0
    margin_right = 50.0
    scale_x = (width - margin_left - margin_right) / total_quarters

    staves: list[StaffPreview] = [
        {
            "label": "Upper staff",
            "top": 120.0,
            "middle_line_y": _staff_line_y(120.0, 2),
            "reference_midi": 71,
            "color": "#204a87",
            "events": _notes_and_rests(parts[0]),
        },
        {
            "label": "Lower staff",
            "top": 260.0,
            "middle_line_y": _staff_line_y(260.0, 2),
            "reference_midi": 50,
            "color": "#8f3f1f",
            "events": _notes_and_rests(parts[1]) if len(parts) > 1 else [],
        },
    ]

    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<defs>",
        '  <linearGradient id="page" x1="0" y1="0" x2="1" y2="1">',
        '    <stop offset="0%" stop-color="#fffdf8" />',
        '    <stop offset="100%" stop-color="#f5f1e8" />',
        "  </linearGradient>",
        "</defs>",
        f'<rect x="0" y="0" width="{width}" height="{height}" rx="18" fill="url(#page)" stroke="#d8cdb8" />',
        '<text x="40" y="54" font-family="Georgia, Times New Roman, serif" font-size="28" fill="#2d2418">AXIOM Score Preview</text>',
        f'<text x="40" y="84" font-family="Consolas, monospace" font-size="14" fill="#6a5f4d">Measures: {measures} · Timeline: {round(total_quarters, 2)} quarter notes</text>',
        f'<text x="40" y="{388 + expression_panel_height:.2f}" font-family="Consolas, monospace" font-size="12" fill="#7a6f5d">Preview generated from MIDI. This is a lightweight visual contract, not engraved publication output.</text>',
    ]

    for bar_index in range(measures + 1):
        x = margin_left + (bar_index * measure_quarters * scale_x)
        if x > width - margin_right + 1:
            break
        svg.append(
            f'<line x1="{x:.2f}" y1="{_staff_line_y(120.0, 0):.2f}" x2="{x:.2f}" y2="{_staff_line_y(260.0, 4):.2f}" stroke="#c7baa1" stroke-width="1" />'
        )

    for staff in staves:
        svg.append(
            f'<text x="40" y="{staff["top"] - 12:.2f}" font-family="Georgia, Times New Roman, serif" font-size="16" fill="#4c4438">{escape(staff["label"])}</text>'
        )
        for line_index in range(5):
            y = _staff_line_y(staff["top"], line_index)
            svg.append(
                f'<line x1="{margin_left:.2f}" y1="{y:.2f}" x2="{width - margin_right:.2f}" y2="{y:.2f}" stroke="#564d3f" stroke-width="1.2" />'
            )

        for event in staff["events"]:
            offset = float(cast(Any, getattr(event, "offset", 0.0)) or 0.0)
            duration = max(
                float(cast(Any, getattr(event, "quarterLength", 0.25)) or 0.25),
                0.25,
            )
            x = margin_left + (offset * scale_x)
            body_width = max(14.0, min(duration * scale_x, 80.0))

            if isinstance(event, note.Rest):
                y = staff["middle_line_y"] - 5.0
                svg.append(
                    f'<rect x="{x - 4.0:.2f}" y="{y:.2f}" width="{body_width:.2f}" height="10" rx="2" fill="{staff["color"]}" opacity="0.28" />'
                )
                continue

            pitch_values: list[int] = []
            if isinstance(event, note.Note):
                pitch_values = [int(cast(Any, event).pitch.midi)]
            elif isinstance(event, chord.Chord):
                pitch_values = [int(pitch.midi) for pitch in cast(Any, event).pitches]

            if not pitch_values:
                continue

            pitch_values = sorted(pitch_values, reverse=True)
            stem_anchor_y = None
            for midi_value in pitch_values:
                y = _pitch_to_y(
                    midi_value, staff["middle_line_y"], staff["reference_midi"]
                )
                stem_anchor_y = y if stem_anchor_y is None else stem_anchor_y
                svg.append(
                    f'<ellipse cx="{x:.2f}" cy="{y:.2f}" rx="7.5" ry="5.5" fill="{staff["color"]}" opacity="0.92" />'
                )
                svg.append(
                    f'<line x1="{x + 7.0:.2f}" y1="{y:.2f}" x2="{x + body_width:.2f}" y2="{y:.2f}" stroke="{staff["color"]}" stroke-width="1.4" opacity="0.35" />'
                )

            if duration <= 1.5 and stem_anchor_y is not None:
                svg.append(
                    f'<line x1="{x + 7.5:.2f}" y1="{stem_anchor_y:.2f}" x2="{x + 7.5:.2f}" y2="{stem_anchor_y - 26.0:.2f}" stroke="{staff["color"]}" stroke-width="1.4" />'
                )

    if expression_summary_lines:
        panel_top = 410.0
        panel_height = 42.0 + (len(expression_summary_lines) * 18.0)
        panel_width = width - 80.0
        svg.append(
            f'<rect x="40" y="{panel_top:.2f}" width="{panel_width:.2f}" height="{panel_height:.2f}" rx="12" fill="#f2ead8" stroke="#d8cdb8" />'
        )
        svg.append(
            f'<text x="60" y="{panel_top + 26:.2f}" font-family="Georgia, Times New Roman, serif" font-size="20" fill="#2d2418">Expression Profile</text>'
        )
        for index, line in enumerate(expression_summary_lines):
            y = panel_top + 54.0 + (index * 18.0)
            svg.append(
                f'<text x="60" y="{y:.2f}" font-family="Consolas, monospace" font-size="12" fill="#4c4438">{escape(line)}</text>'
            )

    score_path = os.path.join(output_dir, "score-preview.svg")
    with open(score_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(svg + ["</svg>"]))
    return score_path


def render_preview_video(
    audio_path: str,
    output_dir: str,
    ffmpeg_bin: str,
) -> str:
    """WAV에서 간단한 waveform preview MP4를 생성한다."""
    video_path = os.path.join(output_dir, "preview.mp4")
    cmd = [
        ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        audio_path,
        "-filter_complex",
        "[0:a]showwaves=s=1280x720:mode=line:colors=0x204a87,format=yuv420p[v]",
        "-map",
        "[v]",
        "-map",
        "0:a",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        video_path,
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed (exit {result.returncode}): {result.stderr}")

    return video_path


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("JSON request must be an object")
        req = cast(dict[str, object], payload)
    except (json.JSONDecodeError, ValueError) as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    midi_path = str(req.get("midiPath", "") or "")
    output_dir = str(req.get("outputDir", "") or "")
    soundfont_path = str(req.get("soundfontPath", "") or "")
    ffmpeg_hint = str(req.get("ffmpegBin", "") or "")
    raw_expression_summary_lines = req.get("expressionSummaryLines", [])
    expression_summary_lines: list[str] = []
    if isinstance(raw_expression_summary_lines, list):
        for raw_line in cast(list[object], raw_expression_summary_lines):
            line_text = str(raw_line or "").strip()
            if line_text:
                expression_summary_lines.append(line_text)

    if not midi_path or not os.path.exists(midi_path):
        print(json.dumps({"ok": False, "error": f"MIDI file not found: {midi_path}"}))
        sys.exit(1)

    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    wav_path = os.path.join(output_dir, "output.wav")
    warnings: list[str] = []

    try:
        score_image_path = render_score_preview_svg_with_expression(
            midi_path, output_dir, expression_summary_lines
        )
        video_path = None
        duration = 0.0
        rendered_wav_path = None

        if soundfont_path and os.path.exists(soundfont_path):
            # FluidSynth CLI 우선 (PATH 또는 tools/), 없으면 midi2audio fallback
            if _find_fluidsynth():
                render_with_fluidsynth_cli(midi_path, wav_path, soundfont_path)
            else:
                render_with_midi2audio(midi_path, wav_path, soundfont_path)

            duration = get_wav_duration(wav_path)
            rendered_wav_path = wav_path

            ffmpeg_bin = _find_ffmpeg(ffmpeg_hint)
            if ffmpeg_bin:
                try:
                    video_path = render_preview_video(wav_path, output_dir, ffmpeg_bin)
                except Exception as video_error:
                    warnings.append(f"Preview video skipped: {video_error}")
            else:
                warnings.append(
                    "Preview video skipped: ffmpeg not found on PATH or in tools/ffmpeg/bin/."
                )
        else:
            warnings.append(
                "WAV render skipped: SoundFont not found. Set SOUNDFONT_PATH to enable audio/video outputs."
            )

        result: dict[str, object] = {
            "ok": True,
            "wavPath": rendered_wav_path,
            "scoreImage": score_image_path,
            "videoPath": video_path,
            "durationSec": round(duration, 2),
            "warnings": warnings,
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
