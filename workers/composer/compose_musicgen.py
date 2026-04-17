# pyright: reportMissingImports=false, reportMissingTypeArgument=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportUnknownParameterType=false
"""
AXIOM MusicGen Composer — facebook/musicgen-large 기반 오디오 생성 워커.

device_map="auto" 로 GPU(RTX 4060 8GB) + RAM(32GB) 자동 분배.
MIDI 없이 WAV를 직접 생성하므로 CRITIQUE/HUMANIZE 단계를 건너뛴다.

stdin  JSON: { prompt, key, tempo, form, outputPath, durationSec }
stdout JSON: { ok, wavPath, durationSec }
        또는 { ok: false, error }
"""

import json
import os
import sys


def write_progress(
    progress_path: str, phase: str, detail: str, **extra: object
) -> None:
    if not progress_path:
        return

    payload = {
        "worker": "musicgen",
        "phase": phase,
        "updatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "detail": detail,
        **extra,
    }

    os.makedirs(os.path.dirname(progress_path), exist_ok=True)
    temp_path = f"{progress_path}.tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    os.replace(temp_path, progress_path)


# ── 폼별 기본 생성 길이 ────────────────────────────────
FORM_DURATION: dict[str, float] = {
    "symphony": 150.0,  # ~2.5분
    "sonata": 120.0,  # ~2분
    "concerto": 120.0,
    "largo": 90.0,  # ~1.5분
    "long": 150.0,
}
DEFAULT_DURATION = 90.0

# MusicGen 토큰 속도: 50 Hz (= 50 tokens/sec)
TOKENS_PER_SEC = 50


def build_prompt(prompt: str, key: str, tempo: int | None) -> str:
    """사용자 프롬프트에 조성·템포 힌트를 덧붙인 완성 프롬프트를 반환한다."""
    parts = [prompt.strip()]
    if key:
        parts.append(f"in {key}")
    if tempo:
        parts.append(f"at {tempo} BPM")
    parts.append("high quality classical orchestral music, concert hall recording")
    return ", ".join(parts)


def main() -> None:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    prompt = req.get("prompt", "classical orchestral music")
    key = req.get("key", "")
    tempo = req.get("tempo")
    form = req.get("form", "largo")
    output_path = req.get("outputPath", "output.wav")
    progress_path = req.get("progressPath", "")
    duration = float(req.get("durationSec", FORM_DURATION.get(form, DEFAULT_DURATION)))

    full_prompt = build_prompt(prompt, key, tempo)

    out_dir = os.path.dirname(output_path)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    try:
        write_progress(
            progress_path,
            "loading_model",
            "Loading MusicGen model weights",
            outputPath=output_path,
        )
        import numpy as np
        import scipy.io.wavfile as wavfile
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration

        # ── 모델 로드 (device_map="auto" → GPU + RAM 자동 분배) ──
        model_id = "facebook/musicgen-large"
        processor = AutoProcessor.from_pretrained(model_id)
        model = MusicgenForConditionalGeneration.from_pretrained(
            model_id,
            torch_dtype=torch.float16,
            device_map="auto",
        )

        # ── 입력 준비 ──
        write_progress(
            progress_path,
            "preparing_inputs",
            "Preparing tokenized prompt inputs",
            outputPath=output_path,
        )
        inputs = processor(
            text=[full_prompt],
            padding=True,
            return_tensors="pt",
        )
        # device_map="auto" 환경에서 입력 텐서는 모델의 첫 레이어 디바이스로
        first_device = next(model.parameters()).device
        inputs = {k: v.to(first_device) for k, v in inputs.items()}

        # ── 토큰 수 계산 ──
        max_new_tokens = int(duration * TOKENS_PER_SEC)

        # ── 생성 ──
        write_progress(
            progress_path,
            "generating",
            f"Generating audio with max_new_tokens={max_new_tokens}",
            outputPath=output_path,
        )
        with torch.no_grad():
            audio_values = model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=True,
                guidance_scale=3.0,
            )

        sampling_rate = model.config.audio_encoder.sampling_rate

        # ── WAV 저장 ──
        write_progress(
            progress_path,
            "saving_output",
            "Normalizing and writing WAV output",
            outputPath=output_path,
        )
        audio_np = audio_values[0, 0].cpu().float().numpy()
        # 클리핑 방지를 위한 정규화
        peak = np.abs(audio_np).max()
        if peak > 0:
            audio_np = audio_np / peak * 0.95
        audio_int16 = (audio_np * 32767).astype(np.int16)
        wavfile.write(output_path, sampling_rate, audio_int16)

        actual_duration = len(audio_np) / sampling_rate

        write_progress(
            progress_path,
            "completed",
            "MusicGen audio generation completed",
            outputPath=output_path,
            durationSec=round(actual_duration, 2),
        )

        print(
            json.dumps(
                {
                    "ok": True,
                    "wavPath": output_path,
                    "durationSec": round(actual_duration, 2),
                    "prompt": full_prompt,
                }
            )
        )

    except Exception as e:
        write_progress(
            progress_path,
            "failed",
            str(e),
            outputPath=output_path,
        )
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
