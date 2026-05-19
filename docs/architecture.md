# AXIOM Architecture

## Entry Points

| 명령 | 파일 | 설명 |
|------|------|------|
| `npm run start:core` | `src/index.core.ts` | compose + health만. autonomy/overseer/MCP 없음. R&D 기본 |
| `npm run start` | `src/index.ts` | 전체 런타임. autonomy scheduler + overseer + MCP |
| `npm run start:mcp` | `src/ops/mcp/server.ts` | stdio MCP (IDE agent용) |
| `npm run start:mcp:http` | `src/ops/mcp/httpServer.ts` | HTTP MCP (원격 consumer, bridge용) |

---

## 모듈 구조

```
src/
├── core/                  ← 작곡 도메인 (composition core)
│   ├── pipeline/          ← 도메인 타입 barrel (types.ts, states.ts, types/)
│   ├── plan/              ← 작곡 계획 생성
│   │   ├── sketch.ts              CompositionSketch 생성
│   │   ├── formTemplates.ts       형식 검증
│   │   ├── sonataCyclePlanner.ts  다악장 계획
│   │   ├── longSpan.ts            장기 형식 계획
│   │   └── requestNormalization.ts  요청 정규화
│   ├── music/             ← 음악 도메인 IR
│   │   ├── orchestrationPlan.ts   OrchestrationPlan 도출
│   │   ├── pianoIR.ts             피아노 중간 표현
│   │   ├── classicalKnowledge.ts  조성/화성/형식 지식
│   │   └── modelBindings.ts       모델 인터페이스 바인딩
│   ├── generate/          ← 심볼릭 후보 생성
│   │   ├── hybridSymbolicCandidatePool.ts  복수 candidate 생성
│   │   ├── learnedSymbolicContract.ts      learned symbolic 계약
│   │   ├── structureRerankerPromotion.ts   구조 reranker 승격
│   │   ├── structureShadowHistory.ts       shadow 이력
│   │   └── preferenceModel.ts             선호도 모델
│   ├── evaluate/          ← 평가 / 점수 계산
│   │   ├── evaluation.ts          StructureEvaluationReport 생성
│   │   ├── craftScoring.ts        craft score 계산
│   │   ├── pianoCraftScoring.ts   피아노 craft score
│   │   ├── cycleEvaluation.ts     다악장 평가
│   │   ├── quality.ts             재시도 정책
│   │   └── pianoEvaluation.ts     피아노 playability 평가
│   ├── repair/            ← 연주성 수리
│   │   ├── pianoProjection.ts     연주성 지표 (21개)
│   │   └── pianoRepairSolver.ts   repair 지시
│   ├── expression/        ← 표현 계획
│   │   └── expressionPlan.ts      expression sidecar
│   ├── composer/          ← Python compose worker 연결
│   ├── critic/            ← Python critique worker 연결
│   ├── humanizer/         ← Python humanize worker 연결
│   └── render/            ← Python render worker 연결
├── runtime/               ← 런타임 실행 제어
│   ├── orchestrator.ts            메인 파이프라인 실행 루프
│   ├── sonataCycleOrchestrator.ts 다악장 실행 루프
│   ├── hooks.ts                   ops 연동 hook registry (RuntimeHooks)
│   ├── request.ts                 ComposeRequest 유틸리티 (hash, metadata)
│   ├── queue/                     작업 큐 (jobQueue.ts, presentation.ts)
│   └── manifest/                  manifest, candidate, analytics 영속성
├── ops/                   ← 운영 계층 (ops)
│   ├── autonomy/          ← 자율 스케줄링
│   ├── overseer/          ← 품질 감시
│   ├── mcp/               ← MCP surfaces (stdio + HTTP)
│   └── operator/          ← 운영 요약
├── routes/            ← HTTP route handlers
├── logging/           ← 로거
└── config.ts          ← 중앙 설정

workers/
├── composer/          ← Python: music21 / learned_symbolic
├── humanizer/         ← Python: expression plan 적용
└── render/            ← Python: FluidSynth / FFmpeg
```

---

## 파이프라인 상태 머신

```
IDLE → COMPOSE → CRITIQUE → HUMANIZE → RENDER → STORE → DONE
                   │                      │
                   └→ COMPOSE (재시도)     └→ RENDER_AUDIO → COMPOSE (재시도)
                                                         └→ STORE → DONE

audio_only fast-path:
IDLE → COMPOSE → STORE → DONE
```

### 상태 목록

| 상태 | 설명 |
|------|------|
| `IDLE` | 초기 상태 |
| `COMPOSE` | symbolic 작곡 (MIDI/스코어 생성) |
| `CRITIQUE` | 구조 평가 및 revision directive 생성 |
| `HUMANIZE` | expression plan 적용 (velocity, timing, rubato) |
| `RENDER` | SVG + 선택적 WAV/MP4 렌더 |
| `RENDER_AUDIO` | `symbolic_plus_audio` 전용 — audio evaluation 직전 |
| `STORE` | artifact + manifest 최종 저장 |
| `DONE` | 완료 (terminal) |
| `FAILED` | 실패 (terminal) |

### Revision loop

`CRITIQUE` 단계가 revision directives를 생성하면 `COMPOSE`로 되돌아간다. 각 시도는 `qualityControl.attempts[]`에 누적되며 최종 채택 시도는 `qualityControl.selectedAttempt`에 기록된다.

`approvalStatus`는 `PipelineState`가 아니라 manifest metadata다. 파이프라인이 `DONE`으로 끝나도 autonomy run은 별도로 `pending approval` 상태일 수 있다.

---

## Persistence Layout

### 곡별 산출물 (`outputs/{songId}/`)

| 파일 | 설명 |
|------|------|
| `manifest.json` | 전체 실행 기록, 평가 결과, 상태 이력 |
| `composition.mid` | 원본 symbolic MIDI |
| `humanized.mid` | expression plan 적용 MIDI |
| `score-preview.svg` | 악보 미리보기 |
| `section-artifacts.json` | 섹션별 실현 지표 |
| `expression-plan.json` | humanization 설정 sidecar |
| `candidates/` | candidate sidecar (구조 점수, 선택 이유) |
| `output.wav` | (FluidSynth + SoundFont 있을 때) |
| `preview.mp4` | (FFmpeg 있을 때) |

### 시스템 상태 (`outputs/_system/`)

| 파일 | 설명 |
|------|------|
| `state.json` | 현재 autonomy 상태 |
| `queue-state.json` | 큐 영속 상태 |
| `runs/YYYY-MM-DD.json` | 일별 실행 기록 |
| `preferences.json` | autonomy 학습 편향 (motif returns, tension arcs, cadence approaches) |
| `operator-summary/` | ops 요약 artifact |
| `ml/` | dataset export, shadow history, review sheets |

---

## Manifest 핵심 필드

```typescript
interface JobManifest {
  songId: string;
  state: PipelineState;
  meta: SongMeta;           // prompt, key, tempo, form, workflow, source
  artifacts: ArtifactPaths; // midi, scoreImage, audio, video 경로
  structureEvaluation?: StructureEvaluationReport;
  audioEvaluation?: AudioEvaluationReport;
  qualityControl?: QualityControlReport;
  approvalStatus?: "pending" | "approved" | "rejected" | "not_required";
  reviewFeedback?: ReviewFeedback;
  runtime?: RuntimeStatus;
  stateHistory: StateEntry[];
  updatedAt: string;
}
```

자세한 스키마: 이전 `manifest-schema.md` → `docs/archive/manifest-schema.md`

---

## HTTP API

### Core (항상 활성)

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /health` | `{ status: "ok" }` |
| `GET /ready` | `ready` / `ready_degraded` / `not_ready` |
| `POST /compose` | 작곡 요청 → 202 + jobId |
| `GET /compose/:jobId` | 작업 상태 조회 |
| `GET /jobs` | 전체 큐 목록 |

### Ops (`npm run start` 전용)

| 그룹 | 주요 엔드포인트 |
|------|----------------|
| Autonomy | `GET /autonomy/status`, `POST /autonomy/trigger`, `POST /autonomy/approve/:songId` |
| Overseer | `GET /overseer/status`, `GET /overseer/last-report`, `GET /overseer/dashboard` |
| MCP (HTTP) | `GET /mcp/health`, `POST /mcp/rpc`, `POST /tools/list` |

---

## core↔runtime↔ops 커플링 경계

`src/runtime/` 레이어는 hook registry(`src/runtime/hooks.ts`)를 통해 ops와 통신한다.
`index.ts`는 시작 시 `initAutonomyHooks()`를 호출해 ops 핸들러를 등록한다.
`index.core.ts`는 이를 호출하지 않으므로 모든 hook은 no-op이다.

hook 등록 위치: `src/ops/autonomy/initHooks.ts`

hook 인터페이스 (`src/runtime/hooks.ts`):
| Hook | 호출 시점 | ops 구현 |
|---|---|---|
| `onJobRunning` | 큐 job 시작 | `markAutonomyRunRunning` |
| `onJobCompleted` | job 성공 완료 | `markAutonomyRunPendingApproval` |
| `onJobFailed` | job 영구 실패 | `markAutonomyRunFailed` |
| `onJobRetryScheduled` | job 재시도 예약 | `markAutonomyRunRetryScheduled` |
| `onPipelineComplete` | 파이프라인 DONE | `evaluateCompletedManifest` + `updateAutonomyPreferencesFromManifest` |

---

## 개발 방향

AXIOM의 핵심 목표는 **평가기 추가가 아니라 NotaGen을 AXIOM식 작곡가로 길들이는 것**이다.

```
Stage 1  hybrid 모드로 NotaGen 후보 대량 생성 → craft scoring으로 선택 (현재)
Stage 2  AXIOM-curated SFT — control block 전체(motif graph, repair, piano rewrite 포함)를 instruction으로 학습
Stage 3  AXIOM-critic DPO — chosen/rejected pair로 구조적 정확도 강화
Stage 4  ablation 벤치마크로 control-following 능력 수치 검증
```

자세한 내용: [`docs/notagen-training.md`](notagen-training.md)
