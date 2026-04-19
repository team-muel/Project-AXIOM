# AXIOM

## Autonomous Classical Music Production Pipeline

AXIOM은 입력 아이디어에서 시작해 심벌릭 작곡, 구조 평가, 인간화, 렌더, 운영 로그와 진단까지 이어지는 클래식 음악 런타임입니다.

핵심은 한 번 곡을 뽑고 끝나는 생성기가 아니라, 상태와 산출물을 남기면서 재시도, 승인, 원격 운영까지 가능한 파이프라인을 만드는 것입니다.

## 현재 AXIOM이 하는 일

- canonical classical path는 symbolic pipeline입니다.
- 기본 symbolic authority는 music21 worker입니다.
- learned track은 현재 좁은 string_trio_symbolic lane에서만 실험적으로 동작합니다.
- queue, autonomy, approval gate, restart recovery, Overseer, operator summary가 런타임 계약으로 존재합니다.
- local stdio MCP와 HTTP MCP를 모두 제공하며, 원격 연동은 HTTP MCP를 canonical network surface로 사용합니다.

## 현재 AXIOM이 아직 아닌 것

- 아직 composer-grade general classical engine은 아닙니다.
- 모차르트 레퀴엠이나 베토벤 교향곡 같은 대형 마스터피스를 안정적으로 생성하는 수준은 아닙니다.
- 깊은 대위법, 장기 형식의 필연성, 풍부한 orchestration idiom, 일관된 authorial identity는 아직 과제입니다.
- audio_only는 빠른 오디오 preview lane이지, canonical symbolic classical lane과 동급이 아닙니다.

## 현재 음악적 범위

현실적으로 기대할 수 있는 범위는 다음과 같습니다.

- 짧은 미니어처와 제한된 형식의 section-aware symbolic 곡
- cadence, tonal return, section-local tension, phrase or texture survival을 보는 품질 루프
- manifest, section artifact, expression sidecar, candidate sidecar 기반의 추적 가능한 운영

현재 명시적으로 다루는 형식 템플릿은 아래와 같습니다.

- sonata
- rondo
- theme_and_variations
- fugue_lite

symphony, concerto, largo, long 같은 이름은 일부 fast-path 또는 quality-profile 힌트 수준으로만 취급됩니다.

## 워크플로 모드

| 워크플로 | 목적 | 현재 의미 |
| ------ | ------ | ------ |
| symbolic_only | canonical classical lane | compose -> critique -> humanize -> render -> store |
| symbolic_plus_audio | symbolic lane + audio evaluation | symbolic path를 유지하면서 추가 오디오 평가를 붙임 |
| audio_only | fast audio preview lane | MusicGen 중심 경로, symbolic score validation 대부분 생략 |

해석 기준은 단순합니다.

- 클래식 작곡 품질 평가는 symbolic_only 또는 symbolic_plus_audio를 기준으로 봅니다.
- audio_only는 preview value는 있지만 canonical lane으로 설명하지 않습니다.

## learned track 상태

learned track은 존재하지만 범위가 매우 좁습니다.

- 공개 계약 이름은 특정 vendor가 아니라 learned_symbolic입니다.
- 현재 구현 범위는 narrow string_trio_symbolic lane입니다.
- learned worker는 miniature + string trio 조건을 만족할 때만 candidate를 제안합니다.
- baseline music21 path는 계속 fallback이자 기준선입니다.
- hybrid candidate comparison, shadow reranker, narrow promotion, targeted rewrite, feedback-aware distillation은 모두 이 좁은 lane을 기준으로 실험됩니다.

중요한 점은 다음과 같습니다.

- README는 특정 외부 프로젝트 이름을 정식 통합 계약으로 박지 않습니다.
- 즉, 현재 저장소는 NotaGen 같은 특정 vendor or repo가 정식 도입되었다고 README에서 주장하지 않습니다.
- 현재 공개 계약은 learned_symbolic worker lane과 candidate sidecar truth plane입니다.

## 런타임 구조

### 파이프라인 개요

```text
IDLE -> COMPOSE -> CRITIQUE -> HUMANIZE -> RENDER -> STORE -> DONE
                   |
                   +-> COMPOSE (structure retry)

symbolic_plus_audio:
RENDER -> RENDER_AUDIO -> STORE
                  \
                   +-> COMPOSE (audio-informed retry)

audio_only:
IDLE -> COMPOSE -> STORE -> DONE
```

### truth plane

AXIOM의 source of truth는 이 런타임과 아래 persisted state입니다.

- outputs/{songId}/manifest.json
- outputs/{songId}/section-artifacts.json
- outputs/{songId}/expression-plan.json
- outputs/{songId}/candidates/
- outputs/_system/state.json
- outputs/_system/queue-state.json
- outputs/_system/runs/YYYY-MM-DD.json
- outputs/_system/operator-summary/
- outputs/_system/operator-sweep/
- outputs/_system/operator-pickup/

## 로컬과 원격의 역할 분리

역할은 다음처럼 나눕니다.

- local AXIOM runtime: queue, autonomy, manifest, Overseer의 truth plane
- local stdio MCP: IDE 에이전트용 local control surface
- local HTTP MCP: bridge 또는 원격 consumer용 canonical network surface
- gcpCompute: team-shared operator and control plane
- 외부 upstream bridge: upstream.axiom.* 형태의 cross-repo orchestration surface

운영 원칙은 다음과 같습니다.

- 로컬 코드 이해와 디버깅은 로컬 workspace를 기준으로 합니다.
- 원격 운영은 공식 MCP surface를 통해서만 넘깁니다.
- outputs/_system/을 원격에서 직접 수정하지 않습니다.

## 빠른 시작

### 1. Node 의존성 설치

```bash
npm install
```

### 2. Python worker 의존성 설치

기본 symbolic compose, humanize, render 경로:

```bash
python -m pip install -r workers/requirements.txt
```

MusicGen fast-path까지 쓰려면:

```bash
python -m pip install -r workers/requirements-musicgen.txt
```

### 3. 환경 변수 준비

```bash
copy .env.example .env
```

주요 환경 변수:

- PORT: 앱 HTTP 포트, 기본 3100
- MCP_HTTP_PORT: HTTP MCP 포트, 기본 3210
- MCP_WORKER_AUTH_TOKEN: HTTP MCP 보호용 bearer token
- SOUNDFONT_PATH: symbolic render용 local SoundFont 경로
- FFMPEG_BIN: preview MP4 생성 시 사용할 ffmpeg 경로
- PYTHON_BIN: Python 실행 파일 경로

### 4. 선택 도구 준비

선택 기능은 아래 도구가 있을 때만 켜집니다.

- SoundFont (.sf2 또는 .sf3)
- FluidSynth
- FFmpeg

주의할 점:

- 대용량 SoundFont와 일부 바이너리는 로컬 자산으로 취급합니다.
- 이 저장소를 clone 했다고 render asset이 자동으로 모두 따라오지는 않습니다.
- SOUNDFONT_PATH를 현재 로컬 환경에 맞게 지정하는 편이 안전합니다.

예시:

```env
SOUNDFONT_PATH=C:/path/to/MuseScore_General.sf3
FFMPEG_BIN=ffmpeg
```

## 실행 방법

### 개발 서버

```bash
npm run dev
```

기본 앱 표면:

- GET /health
- GET /ready
- POST /compose
- GET /compose/:jobId
- GET /jobs

### local stdio MCP

```bash
npm run start:mcp
```

이 경로는 IDE agent용 local MCP입니다.

### HTTP MCP

```bash
npm run start:mcp:http
```

기본 포트는 3210이며 다음 표면을 제공합니다.

- GET /mcp
- GET /mcp/health
- GET /mcp/tools
- POST /mcp
- POST /mcp/rpc
- POST /tools/list

MCP_WORKER_AUTH_TOKEN을 설정하면 보호된 MCP surface에는 Bearer token이 필요합니다.

## 요청 예시

```bash
curl -X POST http://localhost:3100/compose \
  -H "Content-Type: application/json" \
  -d '{"prompt": "비 오는 오후의 짧은 피아노 미니어처"}'
```

## health 와 readiness 확인

```bash
curl http://localhost:3100/health
curl http://localhost:3100/ready
curl http://localhost:3210/mcp/health
```

ready 상태 해석:

- ready: symbolic path와 optional surface까지 사용 가능
- ready_degraded: symbolic path는 가능하지만 WAV, preview MP4, MusicGen 중 일부가 빠짐
- not_ready: 기본 symbolic path 자체가 불가능함

mcp/health는 remote operator bootstrap용 diagnostics surface입니다. transport 상태, auth posture, readiness, queue summary, 최신 operator artifact 상태를 함께 확인할 수 있습니다.

## autonomy 와 operator 표면

주요 autonomy 표면:

- GET /autonomy/status
- GET /autonomy/ops
- GET /autonomy/pending
- POST /autonomy/reconcile-lock
- POST /autonomy/pause
- POST /autonomy/resume
- POST /autonomy/preview
- POST /autonomy/trigger
- POST /autonomy/approve/:songId
- POST /autonomy/reject/:songId

주요 Overseer 표면:

- GET /overseer/status
- GET /overseer/last-report
- GET /overseer/history
- GET /overseer/summary
- GET /overseer/dashboard
- POST /overseer/warnings/acknowledge
- POST /overseer/warnings/unacknowledge
- POST /overseer/report

operator summary and projection 명령:

```bash
npm run ops:summary
npm run ops:project
npm run ops:sweep
npm run ops:pickup
```

이 스크립트들은 readiness, backlog, pending approval, repeated warning, stale lock, incident draft, pickup bundle 같은 운영 요약을 outputs/_system 아래에 남깁니다.

## learned, dataset, shadow 도구

learned track과 dataset or shadow reranker 관련 스크립트:

```bash
npm run ml:export:structure-rank
npm run ml:export:backbone-piece
npm run ml:export:localized-rewrite
npm run ml:manifest-review:learned-backbone -- --snapshot <sheet>
npm run ml:manifest-review:record:learned-backbone -- --resultsFile outputs/_system/ml/review-manifests/learned-backbone/<sheet>/review-sheet.csv
npm run ml:review-pack:learned-backbone -- --snapshot <pack>
npm run ml:summarize:learned-backbone
npm run ml:summarize:truth-plane -- --snapshot <snapshot>
npm run ml:shadow:structure-rank -- --snapshot <snapshot>
npm run ml:shadow:structure-rank:runtime-summary -- --windowHours 24
```

각 스크립트의 의미:

- ml:export:structure-rank: manifest와 candidate sidecar를 읽어 structure_rank_v1 snapshot과 linked truth-plane datasets를 함께 생성
- ml:export:backbone-piece: selected narrow-lane piece rows를 axiom_backbone_piece_v1 flat dataset으로 생성
- ml:export:localized-rewrite: targeted rewrite rows를 axiom_localized_rewrite_v1 flat dataset으로 생성
- ml:manifest-review:learned-backbone: learned-backbone benchmark pending run을 manifest review worksheet로 정리해 outputs/_system/ml/review-manifests/learned-backbone/{sheet}/review-sheet.csv 아래 생성. 기본값은 pending run만 내보내며 `approvalStatus` column에 `approved` 또는 `rejected`를 채운다.
- ml:manifest-review:record:learned-backbone: filled manifest review worksheet를 ingest해 selected benchmark manifest의 `approvalStatus`와 `reviewFeedback`를 기록한다. autonomy source row는 기존 approve/reject service를 통해 operator audit trail과 preferences human-feedback summary까지 함께 갱신하고, benchmark `source=api` row는 autonomy preference memory를 오염시키지 않도록 manifest만 직접 갱신한다.
- ml:review-pack:learned-backbone: paired music21 vs learned_symbolic candidate를 blinded A/B MIDI pack으로 복사하고 answer key, empty results ledger, reviewer용 review-sheet.csv worksheet를 outputs/_system/ml/review-packs/learned-backbone/{pack}/ 아래 생성. --pendingOnly는 이미 reviewed 되었거나 active blind-review pack에 이미 들어간 row를 제외한 uncovered pending pair만 새 pack으로 보낸다.
- ml:review-pack:record:learned-backbone: filled review-sheet.csv 또는 개별 entry decision을 ingest해 outputs/_system/ml/review-packs/learned-backbone/{pack}/results.json에 blind review 결과를 기록
- ml:summarize:learned-backbone: narrow learned lane benchmark run, disagreement, retry-localization stability, sample readiness, persisted blind preference 결과를 요약
- ml:summarize:truth-plane: dataset snapshot manifest, tier counts, promotion counts, split leakage를 한 번에 점검
- ml:shadow:structure-rank: explainable pairwise shadow reranker 학습 또는 평가
- ml:shadow:structure-rank:runtime-summary: runtime shadow disagreement와 promotion window 요약

이 트랙은 현재 narrow learned lane 검증용이지, 범용 learned composer 전환을 의미하지 않습니다.

## 현재 산출물 계약

symbolic lane의 대표 산출물:

- composition.mid 또는 humanized.mid
- score-preview.svg
- manifest.json
- section-artifacts.json
- expression-plan.json
- 선택적으로 output.wav
- 선택적으로 preview.mp4

symbolic_plus_audio에서는 추가로 styled audio 관련 artifact가 생길 수 있습니다.

audio_only는 현재 output.wav 중심 경로이며, score-preview.svg와 preview.mp4는 기본 계약이 아닙니다.

## 저장소 구조

```text
axiom/
├── src/                     # runtime, pipeline, MCP, autonomy, operator surfaces
├── workers/                 # Python compose, humanize, render workers
├── scripts/                 # operator, bridge, dataset export, shadow evaluation
├── docs/                    # runtime docs, planning, runbooks
├── config/                  # env and systemd examples
├── test/                    # node --test regression coverage
├── tools/                   # optional local toolchain support files
├── assets/                  # optional local soundfonts or media assets
├── outputs/                 # generated per-song and system artifacts
└── logs/                    # runtime logs
```

## 테스트와 검증

```bash
npm run build
npm run typecheck
npm test
```

현재 회귀 테스트는 MCP transport, readiness, restart recovery, autonomy ops, candidate sidecars, reranker dataset or shadow tooling, learned narrow lane execution 등을 포함합니다.

## 문서 안내

- docs/state-machine.md
- docs/manifest-schema.md
- docs/autonomy-operations.md
- docs/planning/README.md
- docs/planning/multimodel-composition-pipeline.md
- docs/planning/gcpcompute-axiom-integration.md
- docs/planning/gcpcompute-operator-projection-runbook.md
- docs/planning/gcpcompute-safe-unattended-sweep-runbook.md
- docs/planning/gcpcompute-shadow-governance-runbook.md
- docs/planning/gcpcompute-shared-pickup-runbook.md

## License

Private
