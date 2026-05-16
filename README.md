# AXIOM

## Autonomous Classical Music Composer

AXIOM은 텍스트 프롬프트에서 클래식 음악 작품을 생성하는 자율 작곡 파이프라인입니다. 심벌릭 작곡 → 구조 평가 → 인간화 → 렌더까지 이어지며, 각 단계의 산출물(MIDI, SVG score, manifest)을 저장합니다.

```bash
curl -X POST http://localhost:3100/compose \
  -H "Content-Type: application/json" \
  -d '{"prompt": "비 오는 오후의 짧은 피아노 미니어처"}'
```

---

## 핵심 — 작곡 파이프라인

### 구성 단계

```text
IDLE → COMPOSE → CRITIQUE → HUMANIZE → RENDER → STORE → DONE
                     │
                     └→ COMPOSE (구조 재시도)
```

각 단계는 Python worker로 실행됩니다.

| 단계 | 설명 |
| ---- | ---- |
| COMPOSE | music21 기반 symbolic 작곡 |
| CRITIQUE | cadence, tonal return, tension, texture 평가 |
| HUMANIZE | 표현 플랜 적용 (velocity, timing 인간화) |
| RENDER | MIDI → WAV/MP4 렌더 (SoundFont + FluidSynth) |
| STORE | manifest와 artifact 저장 |

### 워크플로 모드

| 워크플로 | 설명 |
| -------- | ---- |
| `symbolic_only` | canonical classical lane — score + MIDI 중심 |
| `symbolic_plus_audio` | symbolic path에 audio evaluation 추가 |
| `audio_only` | MusicGen 빠른 preview lane |

품질 평가 기준은 `symbolic_only` / `symbolic_plus_audio`입니다. `audio_only`는 preview용이며 canonical lane과 동급으로 취급하지 않습니다.

### 현재 음악적 범위

**지원 형식:**

- `sonata`, `rondo`, `theme_and_variations`, `fugue_lite`

**기대 가능한 결과:**

- 짧은 미니어처 및 section-aware symbolic 곡
- cadence, tonal return, section-local tension 품질 루프 통과

**현재 한계:**

- 모차르트 레퀴엠, 베토벤 교향곡 수준의 대형 마스터피스 생성 불가
- 깊은 대위법, 장기 형식의 필연성, 풍부한 orchestration idiom은 아직 과제
- `symphony`, `concerto`, `largo` 같은 이름은 fast-path 힌트 수준으로만 처리됨

### learned track

공개 계약 이름은 `learned_symbolic`. 현재 두 개의 lane이 구현되어 있습니다.

| lane | 조건 | 특이사항 |
|------|------|----------|
| `string_trio_symbolic` | `miniature` + `string trio` | hybrid candidate comparison, shadow reranker, narrow promotion 실험 기반 |
| `solo_piano_symbolic` | `PianoPlan` + piano instrumentation | playability projection / repair / evaluation 포함 |

- 두 lane 모두 composer-grade general model은 아님 — 좁은 조건 범위에서만 candidate를 제안
- 검증 기준: `music21` baseline path와 candidate comparison으로 확인
- baseline `music21` path는 fallback이자 기준선
- 특정 외부 vendor/repo를 정식 통합 계약으로 명시하지 않음

---

## 빠른 시작

### 1. 의존성 설치

```bash
npm install
python -m pip install -r workers/requirements.txt
```

MusicGen까지 쓰려면:

```bash
python -m pip install -r workers/requirements-musicgen.txt
```

### 2. 환경 변수 준비

```bash
copy .env.example .env
```

주요 변수:

| 변수 | 기본값 | 설명 |
| ---- | ------ | ---- |
| `PORT` | 3100 | 앱 HTTP 포트 |
| `SOUNDFONT_PATH` | — | symbolic render용 SoundFont 경로 |
| `FFMPEG_BIN` | `ffmpeg` | preview MP4 생성용 ffmpeg |
| `PYTHON_BIN` | `python` | Python 실행 파일 |

> SoundFont(.sf2/.sf3)와 FluidSynth는 WAV/MP4 렌더에 필요합니다. 없으면 MIDI + SVG만 생성됩니다.

### 3. 서버 시작

**작곡만 (R&D 기본):**

```bash
npm run start:core    # compose + health만, autonomy/overseer 없음
npm run dev:core      # watch 모드
```

**전체 ops 포함:**

```bash
npm run start         # autonomy scheduler + overseer + MCP 포함
npm run dev           # watch 모드
```

### 4. 작곡 요청

```bash
# 작곡 요청
curl -X POST http://localhost:3100/compose \
  -H "Content-Type: application/json" \
  -d '{"prompt": "비 오는 오후의 짧은 피아노 미니어처", "workflow": "symbolic_only"}'

# 작업 상태 확인
curl http://localhost:3100/compose/{jobId}

# 전체 큐 확인
curl http://localhost:3100/jobs
```

---

## 산출물

완료된 작곡의 대표 산출물:

```text
outputs/{songId}/
├── manifest.json          # 전체 실행 기록 및 메타데이터
├── composition.mid         # 원본 symbolic MIDI
├── humanized.mid           # 표현 플랜 적용 MIDI
├── score-preview.svg       # 악보 미리보기
├── section-artifacts.json  # 섹션별 artifact
├── expression-plan.json    # humanization 설정
├── candidates/             # candidate sidecar (learned track)
├── output.wav              # (SoundFont + FluidSynth 있을 때)
└── preview.mp4             # (FFmpeg 있을 때)
```

시스템 상태:

```text
outputs/_system/
├── state.json
├── queue-state.json
└── runs/YYYY-MM-DD.json
```

---

## 저장소 구조

```text
axiom/
├── src/
│   ├── core/            # 작곡 엔진
│   │   ├── plan/        # CompositionSketch, formTemplates, SonataCyclePlan
│   │   ├── pipeline/    # 공유 타입 정의, 상태 열거형
│   │   ├── music/       # OrchestrationPlan, pianoIR, ClassicalKnowledge
│   │   ├── composer/    # COMPOSE 단계 (symbolic + learned)
│   │   ├── generate/    # hybrid candidate pool, shadow reranker
│   │   ├── evaluate/    # 구조 평가, craft scoring, quality gate
│   │   ├── repair/      # pianoProjection, pianoRepairSolver
│   │   ├── expression/  # ExpressionPlan sidecar
│   │   ├── critic/      # CRITIQUE 단계 (Python critic bridge)
│   │   ├── humanizer/   # HUMANIZE 단계
│   │   └── render/      # RENDER 단계
│   ├── ops/             # 운영 계층 (선택 사항)
│   │   ├── autonomy/    # 자율 스케줄링
│   │   ├── overseer/    # 품질 감시
│   │   ├── mcp/         # MCP surfaces (stdio + HTTP)
│   │   └── operator/    # 운영 요약
│   ├── queue/           # 작업 큐
│   └── routes/          # HTTP route handlers
├── workers/             # Python compose/humanize/render workers
├── scripts/             # operator, dataset export, shadow evaluation
├── docs/                # 문서
├── test/                # node --test 회귀 테스트
└── outputs/             # 생성 artifact
```

---

## 테스트 및 검증

```bash
npm run build
npm run typecheck
npm test
```

---

## 문서

- **[docs/architecture.md](docs/architecture.md)** — 시스템 구조, 모듈 레이아웃, 상태 머신, persistence
- **[docs/composition-engine.md](docs/composition-engine.md)** — 작곡 엔진 6단계 상세 (6개 음악적 질문 + 코드 매핑 + 현재 갭)
- **[docs/datasets.md](docs/datasets.md)** — 학습 데이터셋, candidate sidecar, feedback loop, export scripts
- **[docs/local-development.md](docs/local-development.md)** — 설치, 환경 변수, 실행, 테스트
- **[docs/ops.md](docs/ops.md)** — 운영/ML 스크립트 (autonomy, overseer, MCP, shadow, dataset export)

---

## Ops 계층 (선택 사항)

장기 운영 기능(autonomy, overseer, MCP, operator scripts, ML/dataset 도구)은 **[docs/ops.md](docs/ops.md)** 를 참조하세요.  
R&D 단계에서는 `npm run start:core`로 충분합니다.

---

## License

Private
