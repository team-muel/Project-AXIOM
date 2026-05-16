# Local Development

## Prerequisites

| 도구 | 필수 | 용도 |
|------|------|------|
| Node.js 20+ | ✅ | 런타임 |
| Python 3.10+ | ✅ | compose / humanize / render workers |
| SoundFont (.sf2/.sf3) | 선택 | WAV 렌더 |
| FluidSynth | 선택 | WAV 렌더 |
| FFmpeg | 선택 | preview MP4 생성 |

SoundFont / FluidSynth / FFmpeg 없이도 MIDI + SVG까지는 동작한다.

---

## 설치

```bash
# Node 의존성
npm install

# Python workers (기본 symbolic path)
python -m pip install -r workers/requirements.txt

# MusicGen까지 쓰려면
python -m pip install -r workers/requirements-musicgen.txt
```

---

## 환경 변수

```bash
copy .env.example .env
```

| 변수 | 기본값 | 필수 | 설명 |
|------|--------|------|------|
| `PORT` | `3100` | — | 앱 HTTP 포트 |
| `MCP_HTTP_PORT` | `3210` | — | HTTP MCP 포트 |
| `MCP_WORKER_AUTH_TOKEN` | — | ops | HTTP MCP bearer token |
| `SOUNDFONT_PATH` | — | 렌더 | SoundFont 파일 경로 |
| `FFMPEG_BIN` | `ffmpeg` | 렌더 | FFmpeg 실행 파일 |
| `PYTHON_BIN` | `python` | ✅ | Python 실행 파일 |
| `OLLAMA_URL` | `http://localhost:11434` | ops | Overseer LLM 백엔드 |
| `OLLAMA_MODEL` | `gemma4:latest` | ops | Overseer LLM 모델 |

> `OLLAMA_*`는 overseer report 생성에만 필요하다. `start:core`로 기동하면 무관.

### SoundFont 설정

추천: `MuseScore_General.sf3` (무료, 고품질)

```env
SOUNDFONT_PATH=C:/path/to/MuseScore_General.sf3
FFMPEG_BIN=ffmpeg
```

경로는 `.gitignore`에 포함되지 않으므로 `.env`에만 설정하고 커밋하지 말 것. 대용량 SoundFont 파일 자체는 `assets/soundfonts/`에 두되 git에 올리지 않는다.

---

## 실행

### 작곡만 (R&D 기본)

```bash
npm run start:core    # compose + health, autonomy/overseer 없음
npm run dev:core      # watch 모드
```

### 전체 ops 포함

```bash
npm run start         # autonomy + overseer + MCP
npm run dev           # watch 모드
```

### MCP (별도 프로세스)

```bash
npm run start:mcp          # stdio MCP (IDE agent용)
npm run start:mcp:http     # HTTP MCP (포트 3210)
```

---

## 작곡 요청

```bash
# 작곡 요청
curl -X POST http://localhost:3100/compose \
  -H "Content-Type: application/json" \
  -d '{"prompt": "비 오는 오후의 짧은 피아노 미니어처", "workflow": "symbolic_only"}'

# 작업 상태 확인
curl http://localhost:3100/compose/{jobId}

# readiness 확인
curl http://localhost:3100/ready
```

`/ready` 응답:
- `ready` — symbolic path + 선택 도구 모두 사용 가능
- `ready_degraded` — symbolic path는 가능하나 WAV/MP4/MusicGen 일부 없음
- `not_ready` — symbolic path 자체 불가

---

## 빌드 및 테스트

```bash
npm run build       # TypeScript 컴파일 → dist/
npm run typecheck   # 타입 검사 (빌드 없음)
npm test            # build 후 node --test 실행
npm run clean       # dist/ 삭제
```

현재 pre-existing 타입 에러: `src/pipeline/cycleEvaluation.ts`, `src/pipeline/sonataCycleOrchestrator.ts` (craftScore property 미정의). 이 세션에서 발생한 에러가 아님.

---

## SoundFont 벤치마크

렌더 품질 비교:

```bash
# 객관적 지표 생성
npm run benchmark:soundfont:metrics

# 청취용 플레이리스트 생성
npm run benchmark:soundfont:playlist
```

결과: `outputs/_validation_render_preview/benchmark-metrics.json`

---

## 산출물 위치

```
outputs/
├── {songId}/         곡별 artifact (manifest, MIDI, WAV, SVG, ...)
└── _system/          시스템 상태, autonomy preferences, operator 요약
```

---

## 스크립트 요약

| 분류 | 명령 패턴 | 설명 |
|------|-----------|------|
| 핵심 | `start:core`, `dev:core` | compose + health only |
| 전체 | `start`, `dev` | autonomy + overseer + MCP |
| ops | `ops:summary`, `ops:sweep`, ... | 운영 요약 스크립트 |
| ml | `ml:export:*`, `ml:summarize:*`, `ml:shadow:*` | dataset export / 학습 도구 |
| benchmark | `benchmark:soundfont:*` | 렌더 품질 비교 |
