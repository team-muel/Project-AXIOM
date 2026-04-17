# AXIOM

## Autonomous Classical Music Production Pipeline

입력 아이디어 하나에서 출발해 MIDI, SVG 악보 미리보기, 오디오, 선택적 preview 영상, 로그까지 자율적으로 생산하는 클래식 음악 시스템.

## 프로젝트 목적

AXIOM은 클래식 음악의 작곡·검수·인간화·렌더·배포 과정을 **상태 관리 파이프라인**으로 연결하여, 단발성 생성이 아닌 **운영 가능한 자율 음악 시스템**을 구축한다.

핵심 설계 원칙:

- **심벌릭 작곡 우선** — 파형이 아닌 MIDI/스코어 중심 설계
- **상태 머신 기반** — 모든 단계가 기록되고, 실패 시 원인 코드와 재시도 경로가 남음
- **진실 평면과 제어 평면 분리** — queue, autonomy, manifest, Overseer의 source of truth는 AXIOM runtime이 소유하고, 팀 공용 운영 자동화와 원격 adapter orchestration은 gcpCompute가 담당
- **사람 승인 게이트** — 최종 배포는 자동 승인 없이 반자동 운영

## 현재 작곡 모델

현재 AXIOM의 canonical classical path는 symbolic pipeline이다. 이 경로는 form template, section plan, cadence or harmonic-route 검사, section artifact, expression sidecar, targeted retry를 이용해 섹션 인식형 스케치를 만든다. 즉, 현재 시스템은 완성된 composer-grade classical engine이라기보다 form-aware symbolic sketch generator와 운영 가능한 quality loop를 결합한 시스템에 더 가깝다.

baseline symbolic authority는 여전히 `music21` worker가 맡고, learned track은 현재 좁은 `string_trio_symbolic` lane에서만 proposal, hybrid candidate comparison, targeted rewrite, shadow or promotion evidence를 실험적으로 얹는 구조다. 이 learned lane의 truth-plane evidence는 `outputs/<songId>/candidates/` 아래 candidate sidecar로 별도 저장된다.

현재 명시적 형식 템플릿은 `sonata`, `rondo`, `theme_and_variations`, `fugue_lite`이며, `symphony`, `concerto`, `largo`, `long` 같은 일부 이름은 fast-path 또는 quality-profile 수준에서만 별도 취급된다.

대위법은 전면 생성 엔진이 아니라 제한적 규칙과 수정 루프로 사용된다. outer-voice parallel perfect check, contrary motion 유도, fugue-lite guidance는 있지만, 독립적인 다성부 설계나 본격적인 counterpoint engine은 아직 아니다.

`audio_only` 또는 MusicGen fast-path는 preview-oriented audio lane이다. 현재 이 경로는 symbolic score validation, section artifact, score preview contract를 대부분 건너뛰므로 클래식 작곡 품질의 canonical 판정 경로로 보지 않는다.

## 현재 음악적 한계

- phrase structure는 아직 얕다. section order와 cadence intent는 다루지만 sentence, period, continuation pressure, hypermeter를 충분히 모델링하지 못한다.
- harmony는 여전히 template-driven 성격이 강하다. tonal route와 cadence는 보지만 prolongation, harmonic rhythm, inner-voice logic은 약하다.
- texture는 대체로 melody plus accompaniment 중심이다. inner voice, counterline, imitation, real contrapuntal independence는 아직 1급 생성 객체가 아니다.
- counterpoint 관련 점수나 warning이 좋아도 그것만으로 successful fugue, invention, strict polyphony를 의미하지는 않는다.
- `audio_only` 결과는 오디오 스케치로는 유용하지만, 현재의 symbolic classical-quality gate와 동급으로 해석하면 안 된다.

## 현재 MVP 목표

> 짧은 클래식 곡 1개를 아이디어 입력에서 MIDI, 악보 미리보기, 오디오, 운영 로그 저장까지 **끝까지 완주**하는 최소 자율 루프

### 첫 번째 성공 기준

- [ ] 입력 프롬프트 → 1분 이내 짧은 곡 생성
- [ ] symbolic 경로에서 MIDI, SVG 악보 미리보기, manifest, 실행 로그가 남음
- [ ] SoundFont가 있으면 WAV가 남고, ffmpeg가 있으면 preview MP4가 추가로 남음
- [ ] 검수 실패 시 원인 기록 + 재시도 가능
- [ ] Overseer가 상태 요약과 우선 수정 항목을 보고

## 기술 스택

| 영역 | 기술 |
| ------ | ------ |
| 런타임 | Node.js + TypeScript (ESM) |
| 서버 | Express 5 |
| 작곡 | Python worker 기반 symbolic compose (`music21` baseline, narrow `learned_symbolic` lane) + 선택적 MusicGen audio fast-path |
| 검수 | TypeScript structure or audio evaluation + shadow reranker or operator summary surfaces |
| 인간화 | 루바토·벨로시티·프레이징 규칙 |
| 렌더 | MIDI 기반 SVG 악보 미리보기, SoundFont 기반 WAV, ffmpeg 선택적 preview MP4 |
| 로그 | 구조화된 JSONL 파일 로깅 |
| 상태 관리 | 파이프라인 상태 머신 (IDLE → DONE/FAILED) |
| Overseer | Gemma 4 Local (읽기 전용, 로그·manifest 감시) |

## 폴더 구조

```text
axiom/
├── src/
│   ├── index.ts              # Express 서버 진입점
│   ├── config.ts             # 환경 변수 설정
│   ├── autonomy/             # autonomy planner, scheduler, approval logic
│   ├── mcp/                  # stdio/HTTP MCP server and transport adapters
│   ├── composer/index.ts     # 심벌릭 작곡 모듈
│   ├── critic/index.ts       # 화성·형식 검수 모듈
│   ├── humanizer/index.ts    # 연주 인간화 모듈
│   ├── render/index.ts       # MIDI→SVG 악보 미리보기, WAV, 선택적 영상 렌더
│   ├── operator/             # canonical operator summary and projection helpers
│   ├── pipeline/
│   │   ├── states.ts         # 상태 머신 정의 (PipelineState)
│   │   ├── types.ts          # JobManifest, SongMeta 등 타입
│   │   └── orchestrator.ts   # 파이프라인 실행 오케스트레이터
│   ├── memory/
│   │   ├── manifest.ts       # manifest JSON 저장/로드
│   │   └── candidates.ts     # candidate sidecar truth-plane 저장/로드
│   ├── logging/
│   │   └── logger.ts         # 구조화된 JSONL 로거
│   └── routes/
│       ├── health.ts         # GET /health, /ready
│       └── compose.ts        # POST /compose
├── outputs/                  # 곡별 산출물 (MIDI, manifest 등)
├── logs/                     # 런타임 로그 (runtime.jsonl)
├── docs/                     # 프로젝트 문서
├── scripts/                  # operator, bridge, ML export/evaluation scripts
└── workers/                  # Python compose/humanize/render workers
```

## 실행 방법

### 설치

```bash
npm install
```

### Python 워커 설치

symbolic compose, humanize, score preview render를 쓰려면 아래 기본 의존성이 필요합니다.

```bash
python -m pip install -r workers/requirements.txt
```

MusicGen fast-path까지 쓰려면 추가로 아래를 설치합니다.

```bash
python -m pip install -r workers/requirements-musicgen.txt
```

운영 시 외부 도구 계약은 다음과 같습니다.

- 기본 SoundFont는 `assets/soundfonts/MuseScore_General.sf3`이며, `SOUNDFONT_PATH`로 다른 SoundFont (`.sf2`/`.sf3`)를 지정할 수 있다. `assets/soundfonts/default.sf2`는 benchmark baseline으로 유지한다.
- `tools/fluidsynth/bin/fluidsynth(.exe)` 또는 PATH 상 `fluidsynth`: WAV 렌더 우선 경로
- `FFMPEG_BIN` 또는 PATH 상 `ffmpeg`: `preview.mp4` 생성용

### 개발 서버 실행

```bash
npm run dev
```

서버가 `http://localhost:3100`에서 시작됩니다.

### MCP 서버 실행

로컬 IDE 에이전트용 stdio MCP:

```bash
npm run start:mcp
```

브리지 또는 원격 연동용 HTTP MCP:

```bash
npm run start:mcp:http
```

기본 포트는 `3210`이며 `MCP_HTTP_PORT`로 변경할 수 있습니다.

`/mcp`와 `/mcp/health`는 metadata/diagnostic surface라서 공개 probe에 사용할 수 있습니다.

`MCP_WORKER_AUTH_TOKEN`을 설정하면 아래 엔드포인트에 Bearer 토큰이 필요합니다.

- `GET /mcp/tools`
- `POST /mcp`
- `POST /mcp/rpc`
- `POST /tools/list`

이 표면은 gcpCompute 또는 외부 upstream proxy가 AXIOM을 원격 운영 표면으로 소비할 때 사용합니다.

bridge 준비를 빠르게 확인하려면:

```bash
npm run mcp:bridge:config
npm run mcp:bridge:verify
```

- `mcp:bridge:config`: 외부 upstream proxy의 `MCP_UPSTREAM_SERVERS`에 넣을 JSON 배열을 출력한다.
- `mcp:bridge:verify`: `/mcp/health`, `/mcp`, `/mcp/rpc`, `/tools/list` 호환성과 핵심 도구 노출 여부를 검사한다.

기본적으로 `http://127.0.0.1:${MCP_HTTP_PORT}`를 사용하며, 필요하면 `--url`, `--token` 인자를 줄 수 있다.

### Learned track 데이터 or shadow 도구

learned reranker or narrow learned lane evidence를 점검하려면 아래 스크립트를 사용한다.

```bash
npm run ml:export:structure-rank
npm run ml:shadow:structure-rank -- --snapshot <snapshot>
npm run ml:shadow:structure-rank:runtime-summary -- --windowHours 24
```

- `ml:export:structure-rank`: `outputs/<songId>/manifest.json`, `section-artifacts.json`, `expression-plan.json`, `candidates/` sidecar를 읽어 `structure_rank_v1` dataset snapshot을 만든다.
- `ml:shadow:structure-rank`: dataset snapshot에서 explainable pairwise shadow reranker를 학습 or 평가한다.
- `ml:shadow:structure-rank:runtime-summary`: runtime shadow history를 요약해 disagreement pressure와 promotion window를 본다.

### 선택 렌더 도구

- `SOUNDFONT_PATH`: symbolic render 경로에서 `output.wav`를 만들 때 사용하는 SoundFont (`.sf2`/`.sf3`)
- `FFMPEG_BIN`: `preview.mp4`를 만들고 싶을 때 사용하는 ffmpeg 실행 파일 경로 또는 명령명

가장 쉬운 음색 품질 개선은 전역 GM SoundFont 하나를 교체해 같은 MIDI를 A/B 비교하는 것이다. 현재 구조에서는 `MuseScore_General.sf3`를 기본값으로 쓰고, `GeneralUser GS 2.0.3`를 비교 또는 대안 후보로 두는 것이 가장 현실적이다.

현재 산출물 계약:

- symbolic pipeline (`music21` 경로): `composition.mid` 또는 `humanized.mid`, `score-preview.svg`, `manifest.json`, 실행 로그는 기본 산출물이다.
- symbolic pipeline의 `output.wav`는 SoundFont가 있을 때만 생성된다.
- symbolic pipeline의 `preview.mp4`는 ffmpeg가 있고 WAV까지 생성된 경우에만 추가 생성된다.
- MusicGen fast-path는 `output.wav` 중심 경로이며 현재 `score-preview.svg`와 `preview.mp4`를 만들지 않는다.

### 작곡 요청

```bash
curl -X POST http://localhost:3100/compose \
  -H "Content-Type: application/json" \
  -d '{"prompt": "비 오는 오후의 짧은 피아노 미니어처"}'
```

### 헬스 체크

```bash
curl http://localhost:3100/health
curl http://localhost:3100/ready
curl http://localhost:3210/mcp/health
```

`/ready` 해석 기준:

- `ready`: symbolic path와 선택 기능까지 모두 사용 가능
- `ready_degraded`: symbolic path는 사용 가능하지만 WAV, preview MP4, MusicGen 중 일부가 빠짐
- `not_ready`: 기본 symbolic path 자체가 불가능함

응답에는 `checks.pythonModules`, `capabilities.symbolicCompose`, `capabilities.audioRender`, `capabilities.previewVideo`, `capabilities.musicgenCompose`가 함께 포함된다.

`/mcp/health`는 remote operator bootstrap용 MCP diagnostics surface다.

- transport endpoint와 protocol version
- auth required/token configured 상태
- current tool count와 tool names
- runtime readiness 요약
- queue summary
- `outputs/_system/operator-summary`, `operator-sweep`, `incident-drafts`, `operator-pickup` latest artifact 존재 여부와 최근 상태

### Overseer 운영 확인

```bash
curl http://localhost:3100/overseer/status
curl http://localhost:3100/overseer/last-report
curl "http://localhost:3100/overseer/history?limit=20"
curl "http://localhost:3100/overseer/summary?windowHours=24&limit=200"
```

- 자동 Overseer 최신 리포트는 outputs/_system/overseer-last-report.json에 저장된다.
- 자동 Overseer 히스토리는 outputs/_system/overseer-history/YYYY-MM-DD.jsonl에 일자별로 append된다.
- GET /overseer/history는 newest-first로 최근 리포트를 반환하며 `dayKey`와 `limit` 쿼리를 지원한다.
- GET /overseer/summary는 최근 24시간 실패 수, 반복 경고, 마지막 정상 리포트 시각 같은 파생 지표를 반환한다.
- GET /overseer/dashboard는 MCP 도구를 직접 소비하는 내부 운영 페이지로 최신 리포트, 히스토리, 요약 메트릭을 함께 보여 준다.
- `/overseer/dashboard`의 repeated warning 카드에서는 수동 `Acknowledge`와 `Acknowledge 해제` 액션으로 반복 경고를 active/acknowledged 상태 사이에서 정리할 수 있다.
- repeated warning을 acknowledge할 때 note를 함께 입력해 왜 일시적으로 무시하는지 운영 메모를 남길 수 있다.
- acknowledged warning은 acknowledge 시점의 `lastSeenAt`까지 잠잠하게 유지되며, 그 이후 같은 의미의 경고가 다시 나오면 active repeated warning으로 자동 복귀한다.
- warning key는 render, autonomy, queue 계열의 대표 패턴을 canonical form으로 정규화해서 같은 의미의 경고를 더 안정적으로 묶는다.
- MCP 운영 표면에서는 `axiom_overseer_status`, `axiom_overseer_last_report`, `axiom_overseer_history`, `axiom_overseer_summary`, `axiom_operator_summary` 도구로 같은 정보를 조회할 수 있다. legacy dotted alias도 계속 호출할 수 있다.

### Operator summary

canonical operator summary JSON을 로컬 runtime HTTP surface에서 바로 뽑으려면 아래 명령을 사용한다.

```bash
npm run ops:summary
```

필요하면 base URL과 source label을 직접 줄 수 있다.

```bash
node scripts/print-operator-summary.mjs --url http://127.0.0.1:3100 --source local-runtime
```

이 스크립트는 `/ready`, `/jobs`, `/autonomy/ops`, `/overseer/summary`를 읽어 gcpCompute projection이나 bridge projection이 재사용할 수 있는 canonical summary shape를 출력한다.

같은 canonical summary는 MCP에서 `axiom_operator_summary` 도구로도 바로 조회할 수 있다. legacy caller는 `axiom.operator.summary` alias도 계속 사용할 수 있다. 외부 bridge consumer는 이 tool이 보이면 `upstream.axiom.axiom_operator_summary`를 우선 소비하고, 구버전 AXIOM에서는 기존 `axiom_job_list`, `axiom_autonomy_status`, `axiom_overseer_summary` 조합으로 fallback한다. operator sweep 또는 pickup artifact가 이미 있으면 payload의 `data.incidentDraft`, `data.operatorPickup`에 optional handoff metadata도 같이 실려서 downstream projection이 repeated warning 추론보다 공식 incident handoff를 먼저 쓸 수 있다.

projection artifact를 `_system` 아래에 남기려면 아래 명령을 사용한다.

```bash
npm run ops:project
```

기본 출력 위치는 `outputs/_system/operator-summary/`이며 다음 파일을 갱신한다.

- `latest.json`
- `latest.md`
- `upstream-compatible.json`
- `history/YYYY-MM-DD.jsonl`

projection 실패 시 아래 evidence도 남긴다.

- `latest-error.json`
- `errors/YYYY-MM-DD.jsonl`

shadow governance lane에서는 다음 명령으로 before/after evidence를 같은 review artifact에 누적할 수 있다.

```bash
npm run ops:shadow:init -- --policy retry_backoff
npm run ops:shadow:capture -- --review docs/planning/gate-runs/shadow-reviews/YYYY-MM-DD_retry-backoff-shadow-review.json --lane baseline
npm run ops:shadow:capture -- --review docs/planning/gate-runs/shadow-reviews/YYYY-MM-DD_retry-backoff-shadow-review.json --lane candidate
```

capture 이후 review markdown에는 baseline/candidate snapshot과 comparison delta가 함께 기록되고, `*.evidence.jsonl`에 observation history가 append된다.

Phase 4의 safe unattended baseline은 다음 명령으로 read-only operator sweep를 남긴다.

```bash
npm run ops:sweep -- --url http://127.0.0.1:3100 --mcpUrl http://127.0.0.1:3210
```

기본 출력 위치는 `outputs/_system/operator-sweep/`이며 bridge verify, projection status, triage classification, backlog digest, pending approval digest, repeated warning digest, stale lock digest를 함께 기록한다. triage에는 `severityScore`, `severityDrivers`도 포함되며, incident lane이면 `incident-drafts/latest.json`, `incident-drafts/latest.md`, `incident-drafts/history/YYYY-MM-DD.jsonl`도 같이 남긴다.

`upstream-compatible.json`은 기존 외부 bridge의 AXIOM upstream summary shape와 최대한 비슷한 필드를 유지해 bridge 또는 gcpCompute pickup 쪽 소비자를 단순하게 만든다.

shared pickup bundle은 다음 명령으로 summary/sweep/incident latest를 하나로 묶는다.

```bash
npm run ops:pickup
```

기본 출력 위치는 `outputs/_system/operator-pickup/`이며 다음 파일을 갱신한다.

- `latest.json`
- `latest.md`
- `history/YYYY-MM-DD.jsonl`
- 실패 시 `latest-error.json`, `errors/YYYY-MM-DD.jsonl`

이 bundle은 `operator-summary/latest.json`, `operator-sweep/latest.json`, `incident-drafts/latest.json`을 읽어 triage, readiness, bridge, backlog, pending approval, incident draft를 한 번에 pickup 가능한 surface로 정리한다. 현재 외부 downstream consumer는 우선 canonical MCP summary 안의 handoff metadata를 읽고, 이 pickup bundle은 sidecar/manual handoff surface로 유지한다.

### gcpCompute 협업 시나리오

기존 외부 bridge 운영 패턴을 기준으로, AXIOM은 gcpCompute를 예비 수단이 아니라 팀 공용 상시 control plane으로 취급합니다.

현재 워크스페이스의 `gcpCompute` MCP entry는 legacy git checkout이 아니라 published shared runtime mirror `/opt/muel/shared-mcp-runtime`를 기준으로 둔다.
shared-only onboarding이 필요하면 아래 명령으로 SSH key, shared runtime path, public shared MCP health를 한 번에 점검할 수 있다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-gcpcompute-shared-only.ps1
```

핵심 역할 분리는 다음과 같습니다.

- 로컬 또는 배포된 AXIOM runtime: 실제 queue, autonomy, manifest, Overseer의 truth plane
- gcpCompute: 팀 공용 operator/control plane. 24/7 점검, 원격 전용 adapter, shared Obsidian projection, bridge verification, unattended summary 수집 담당
- 외부 upstream proxy: `upstream.axiom.*` 형태의 cross-repo orchestration plane

공격적으로 활용할 영역은 다음과 같습니다.

- `axiom_job_list`, `axiom_manifest_list`, `axiom_overseer_summary`, `axiom_autonomy_status`를 주기적으로 수집해 shared operator summary를 만든다.
- bridge가 붙어 있을 때는 ad hoc HTTP 호출보다 `upstream.axiom.*`를 우선 사용한다.
- gcpCompute의 원격 전용 adapter가 필요할 때는 AXIOM 상태를 Obsidian 또는 팀 문서 surface로 projection한다.
- retry/backoff, quality policy, autonomy cadence 변경은 먼저 원격 shadow review로 비교하고, 본 runtime 기본값은 그 다음에 조정한다.

가드레일은 다음과 같습니다.

- 코드 이해와 디버깅은 이 repo의 로컬 소스를 기준으로 하고, gcpCompute 원격 checkout을 코드 source of truth로 사용하지 않는다.
- 원격 automation은 읽기 위주로 시작하고, `outputs/_system/`를 직접 수정하지 않는다.
- 원격 env와 로컬 `.env`를 동일시하지 않는다. gcpCompute는 별도 운영 env를 가진다.
- 원격 VM checkout은 상태 없는 mirror가 아니라 운영 상태를 가진 machine일 수 있으므로 강제 reset/pull 대상으로 취급하지 않는다.

예시 등록 형태:

```json
[
  {
    "id": "axiom",
    "url": "http://127.0.0.1:3210",
    "namespace": "axiom",
    "token": "axiom-local-token",
    "protocol": "simple"
  }
]
```

이 구성을 외부 bridge의 `MCP_UPSTREAM_SERVERS`에 넣으면 `axiom_compose` 같은 도구를 `upstream.axiom.axiom_compose` 형태로 원격 orchestration surface에 노출할 수 있습니다.

## 파이프라인 상태 흐름

```text
IDLE → COMPOSE → CRITIQUE → HUMANIZE → RENDER → STORE → DONE
                    │                                  │
                    └──→ COMPOSE (수정 재시도)           │
                    └──→ FAILED ←──────────────────────┘
```

각 단계에서 실패 발생 시 `FAILED` 상태로 전이되며, 원인 코드와 메시지가 manifest에 기록됩니다.

## 문서

- [상태 머신 명세](docs/state-machine.md)
- [곡 Manifest 스키마](docs/manifest-schema.md)
- [gcpCompute 협업 계획, 운영 규칙, 실행 계획](docs/planning/gcpcompute-axiom-integration.md)
- [gcpCompute operator projection runbook](docs/planning/gcpcompute-operator-projection-runbook.md)
- [gcpCompute shadow governance runbook](docs/planning/gcpcompute-shadow-governance-runbook.md)
- [gcpCompute safe unattended sweep runbook](docs/planning/gcpcompute-safe-unattended-sweep-runbook.md)

## 라이선스

Private
