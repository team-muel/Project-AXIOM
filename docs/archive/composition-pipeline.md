# AXIOM 작곡 파이프라인

AXIOM의 설계 중심은 6개의 음악적 질문입니다.

1. **무엇을 쓸 것인가** — 의도와 CompositionPlan
2. **어떤 편성인가** — EnsemblePlan (OrchestrationPlan)
3. **어떤 형식인가** — Movement/Section Plan
4. **어떤 동기와 화성 계획인가** — 동기, 화성, 조성 계획
5. **실제 악보가 연주 가능한가** — Projection / Repair
6. **좋은 음악인가** — Musical Evaluator

운영(queue, autonomy, MCP, overseer)은 이 파이프라인을 둘러싸는 shell이지, 파이프라인의 일부가 아닙니다.

---

## 파이프라인 전체 흐름

```
User Intent (HTTP POST /compose)
        │
        ▼
  [0] 요청 정규화
        │  requestNormalization.ts
        │  ComposeRequest
        │
        ▼
  [1] CompositionPlan  ── 무엇을 쓸 것인가
        │  pipeline/sketch.ts          → CompositionSketch (구조 선택)
        │  composer/index.ts           → Python planner
        │  pipeline/classicalKnowledge.ts → ClassicalKnowledgePlan 첨부
        │  결과: CompositionPlan
        │   └ tonalCenter, mode, tempo
        │   └ instrumentation[]
        │   └ sections[], motifs[]
        │   └ harmonicPlan
        │   └ classicalKnowledge
        │
        ▼
  [2] EnsemblePlan  ── 어떤 편성인가
        │  pipeline/orchestrationPlan.ts → OrchestrationPlan 도출
        │  결과: OrchestrationPlan
        │   └ family (strings / winds / piano / mixed)
        │   └ instruments[]
        │   └ sectionOrchestrations[]
        │   └ conversationMode, balanceProfile, registerLayout
        │
        ▼
  [3] Movement/Section Plan  ── 어떤 형식인가
        │  pipeline/formTemplates.ts       → form 유효성 검증
        │  pipeline/sonataCyclePlanner.ts  → SonataCyclePlan (다악장)
        │  pipeline/longSpan.ts            → LongSpanFormPlan
        │  결과: SectionPlan[]
        │   └ sectionId, role (intro / theme_a / theme_b / bridge / ...)
        │   └ measures, tempo, tonalCenter
        │   └ cadenceOptions[], expectedTexture
        │
        ▼
  [4] Motif & Harmonic Plan  ── 어떤 동기와 화성 계획인가
        │  CompositionPlan 안에 포함:
        │   └ motifs[]: MotifDraft (pitches, rhythm, sectionIds, transforms)
        │   └ harmonicPlan.sections[]: harmonicColorCues[], tonicizationWindows[]
        │   └ ClassicalHarmonyKnowledge: cadencePolicy, modulationStrategy, colorPalette
        │
        ▼
  [5] Symbolic Generator  ── 생성
        │  composer/index.ts       → Python worker 호출
        │  workers/composer/       → music21 / learned_symbolic
        │  pipeline/hybridSymbolicCandidatePool.ts → 복수 candidate 생성
        │  결과: ComposeResult
        │   └ sectionArtifacts[]
        │   └ MIDI path (composition.mid)
        │   └ candidate sidecar
        │
        ▼
  [6] Projection / Repair  ── 연주 가능한가
        │  pipeline/pianoIR.ts          → 피아노 중간 표현 (voice layout)
        │  pipeline/pianoProjection.ts  → 21개 피아노 연주성 지표
        │  pipeline/pianoRepairSolver.ts → 수리 지시 (span 축소, 성부 정리 등)
        │  pipeline/pianoEvaluation.ts  → 연주성 평가 리포트
        │  결과: PianoRevisionDirective[] (repair) 또는 rewrite 트리거
        │
        ▼
  [7] Musical Evaluator  ── 좋은 음악인가
        │  critic/index.ts           → Python worker (구조 비평)
        │  pipeline/evaluation.ts    → buildStructureEvaluation()
        │  pipeline/craftScoring.ts  → computeCraftScoreSummary()
        │  pipeline/cycleEvaluation.ts → 다악장 평가
        │  결과: StructureEvaluationReport
        │   └ longSpan: tension curve, return payoff, structural integrity
        │   └ cadence: approach, density, architectural weight
        │   └ orchestration: balance, register, conversation mode
        │   └ classicalKnowledge: voice leading, dissonance, notation marks
        │   └ audio (optional): key drift, section-level tonal tracking
        │
        ▼
  [8] Renderer  ── 오디오 생성
        │  humanizer/index.ts  → expression plan 적용 (velocity, timing, rubato)
        │  render/index.ts     → MIDI → WAV (FluidSynth) / MP4 (FFmpeg)
        │  workers/humanizer/, workers/render/ → Python workers
        │  결과: humanized.mid, output.wav, preview.mp4, score-preview.svg
        │
        ▼
  [9] Feedback Dataset  ── 학습 데이터
           memory/candidates.ts     → candidate sidecar (structure scores)
           memory/pianoDataset.ts   → 피아노 dataset entries
           memory/manifestAnalytics.ts → manifest 통계
           scripts/ml:export:*      → training dataset export
```

---

## 단계별 상세

### [0] 요청 정규화

**파일:** `src/pipeline/requestNormalization.ts`

HTTP body → `ComposeRequest`. 형식 추론, workflow 코어션, compositionProfile 기본값 삽입.

```typescript
// 최소 요청
{ "prompt": "비 오는 오후의 피아노 미니어처" }

// 명시 요청
{
  "prompt": "...",
  "workflow": "symbolic_only",
  "compositionProfile": {
    "form": "sonata",
    "instrumentation": [{ "name": "piano", "family": "keyboard" }]
  }
}
```

---

### [1] CompositionPlan — 무엇을 쓸 것인가

**파일:** `src/pipeline/sketch.ts`, `src/composer/index.ts`, `src/pipeline/classicalKnowledge.ts`

`materializeCompositionSketch()` 가 `ComposeRequest` + autonomy memory bias를 받아 `CompositionSketch`를 만든다. Python planner가 이를 `CompositionPlan`으로 확장한다.

`CompositionPlan` 핵심 필드:

```typescript
interface CompositionPlan {
  tonalCenter: string;        // "C", "G", "Bb"
  mode: string;               // "major", "minor", "dorian"
  tempo: number;
  form: string;               // "sonata", "rondo", "fugue_lite"
  instrumentation: InstrumentAssignment[];
  sections: SectionPlan[];
  motifs?: MotifDraft[];
  harmonicPlan?: HarmonicPlan;
  classicalKnowledge?: ClassicalKnowledgePlan;
  longSpanForm?: LongSpanFormPlan;
  sonataCycle?: SonataCyclePlan;
}
```

**autonomy memory bias:** `sketch.ts`가 과거 실행의 `motifReturns`, `tensionArc`, `cadenceApproaches` 패턴을 bias로 읽어 sketch에 반영한다. 이는 학습 피드백이 계획 단계에 스며드는 지점이다.

---

### [2] EnsemblePlan — 어떤 편성인가

**파일:** `src/pipeline/orchestrationPlan.ts`

`CompositionPlan.instrumentation`에서 `OrchestrationPlan`을 도출한다.

```typescript
interface OrchestrationPlan {
  family: OrchestrationFamily;  // "strings" | "winds" | "piano" | "mixed"
  instruments: InstrumentAssignment[];
  sectionOrchestrations: OrchestrationSectionPlan[];
  // 섹션별 대화 모드: "unison" | "call_response" | "layered" | "solo_with_accompaniment"
  // 섹션별 균형: "lead_forward" | "conversational" | "ensemble"
  // 섹션별 레지스터: "compact" | "layered" | "wide"
}
```

**현재 한계:** OrchestrationPlan은 독립적 planning step이 아니라 CompositionPlan에서 파생된다. 편성이 악기 별 역할 협상(주제 vs 반주 vs 대위선)을 명시적으로 계획하는 별도 단계로 발전할 여지가 있다.

---

### [3] Movement/Section Plan — 어떤 형식인가

**파일:** `src/pipeline/formTemplates.ts`, `src/pipeline/sonataCyclePlanner.ts`, `src/pipeline/longSpan.ts`

`SectionPlan[]` 은 파이프라인이 생성 단계에 전달하는 구조 계획이다.

```typescript
interface SectionPlan {
  sectionId: string;
  role: SectionRole;            // "intro" | "theme_a" | "theme_b" | "bridge" | "development" | ...
  measures: number;
  tempo?: number;
  tonalCenter?: string;
  cadenceOptions?: CadenceOption[];
  expectedTexture?: TextureGuidance;
  orchestration?: OrchestrationSectionPlan;
}
```

다악장 작품은 `SonataCyclePlan`으로 표현된다:

```typescript
interface SonataCyclePlan {
  cycleId: string;
  movements: MovementPlan[];     // ordinal, functionInCycle, form, ...
  crossMovementRecalls?: CrossMovementRecallPlan[];
  cycleTensionCurve?: number[];  // 다악장 전체 tension envelope
}
```

---

### [4] Motif & Harmonic Plan — 어떤 동기와 화성 계획인가

**CompositionPlan 내부에 포함됨**

```typescript
interface MotifDraft {
  id: string;
  label?: string;
  pitches?: number[];
  rhythm?: number[];
  sectionIds?: string[];          // 어느 섹션에서 등장할지
  transformPolicy?: MotifTransformPolicy;  // repeat | sequence | fragment | revoice | ...
}

interface HarmonicPlan {
  sections: {
    sectionId: string;
    harmonicColorCues?: HarmonicColorCue[];   // mixture | applied_dominant | suspension ...
    tonicizationWindows?: TonicizationWindow[];
  }[];
}

interface ClassicalHarmonyKnowledge {
  language?: "common_practice" | "modal" | "chromatic" | "extended_tonal";
  cadencePolicy?: "light" | "structural" | "architectural";
  modulationStrategy?: "none" | "local_tonicization" | "sectional" | "long_range";
  colorPalette?: HarmonicColorTag[];
}
```

**현재 한계:** 동기와 화성 계획은 CompositionPlan의 필드로 존재하지만, Python planner가 이를 실제로 얼마나 따르는지는 MIDI 산출물을 평가해야만 알 수 있다. 동기 추적과 화성 실현 검증은 evaluator 단계에서 이루어진다.

---

### [5] Symbolic Generator — 생성

**파일:** `src/composer/index.ts`, `workers/composer/`, `src/pipeline/hybridSymbolicCandidatePool.ts`

Python worker를 호출해 `CompositionPlan`을 MIDI로 변환한다.

| worker | 언제 사용 |
| ------ | --------- |
| `music21` | canonical classical lane (기본) |
| `learned_symbolic` | narrow string_trio_symbolic lane (실험적) |
| `musicgen` | audio_only workflow |

hybrid mode에서는 `hybridSymbolicCandidatePool.ts`가 복수의 candidate를 생성하고 구조 평가 점수를 기준으로 선택한다.

---

### [6] Projection / Repair — 연주 가능한가

**파일:** `src/pipeline/pianoIR.ts`, `src/pipeline/pianoProjection.ts`, `src/pipeline/pianoRepairSolver.ts`, `src/pipeline/pianoEvaluation.ts`

생성된 MIDI event array에서 21개의 피아노 연주성 지표를 계산한다.

주요 지표:

- `pianoHandSpanViolations` — 19반음(minor 13th) 초과 스팬
- `pianoAwkwardSpanCount` — 14반음(major 9th) 초과 스팬
- `pianoHandCrossingCount` — 성부 교차
- `pianoParallelOctaveCount` — 평행 옥타브
- `pianoRegisterSeparation` — 성부 간 거리

Repair 전략:

```typescript
type PianoRevisionDirectiveKind =
  | "reduce_hand_span"
  | "smooth_left_hand_leaps"
  | "clarify_right_hand_melody"
  | "thin_overdense_chords"
  | "separate_registers"
  // ...
```

`fallbackStrategy`: `repairSolver` (MIDI 직접 수정) 또는 `rewrite` (섹션 재생성).

**현재 한계:** Projection/Repair는 피아노 전용이다. String trio, 관악, 혼합 편성에 대한 연주성 검증은 구현되어 있지 않다.

---

### [7] Musical Evaluator — 좋은 음악인가

**파일:** `src/critic/index.ts`, `src/pipeline/evaluation.ts`, `src/pipeline/craftScoring.ts`, `src/pipeline/cycleEvaluation.ts`

`StructureEvaluationReport`가 핵심 산출물이다.

평가 차원:

| 차원 | 측정 항목 |
| ---- | --------- |
| **Long-span form** | tension curve 실현, return payoff 강도, structural integrity |
| **Cadence** | 도착 강도, 빈도, architectural weight |
| **Orchestration** | 섹션별 balance/register/conversation 준수 여부 |
| **Classical knowledge** | voice leading, dissonance treatment, notation marks 보존 |
| **Audio (optional)** | key drift, tonal tracking, section-level key stability |

craft score는 이 차원들의 가중 합산이며 quality gate 기준이 된다.

재시도 정책 (`src/pipeline/quality.ts`):

```typescript
// 구조 재시도 조건
shouldRetryStructureAttempt(evaluation, policy, attempt)
// 오디오 재시도 조건
shouldRetryAudioAttempt(evaluation, policy, attempt)
```

---

### [8] Renderer — 오디오 생성

**파일:** `src/humanizer/index.ts`, `src/render/index.ts`, `workers/humanizer/`, `workers/render/`

두 단계로 나뉜다:

**Humanize:** MIDI에 표현 계획 적용

```typescript
ExpressionPlanSidecar:
  humanizationStyle: "mechanical" | "restrained" | "expressive"
  sections[]: phraseBreath, tempoMotion, ornaments, texture, expression
```

**Render:** MIDI → 오디오

```
composition.mid → humanized.mid → output.wav (FluidSynth + SoundFont)
                                → preview.mp4 (FFmpeg)
                                → score-preview.svg
```

---

### [9] Feedback Dataset — 학습 데이터

**파일:** `src/memory/candidates.ts`, `src/memory/pianoDataset.ts`, `src/memory/manifestAnalytics.ts`

매 실행 산출물이 자동으로 학습 데이터 후보가 된다.

| 데이터 | 내용 |
| ------ | ---- |
| candidate sidecar | structure 점수, 선택/기각 이유 |
| piano dataset | 피아노 연주성 지표 + 청취자 평점 |
| manifest analytics | 형식별 성공률, 재시도 통계 |

피드백 루프:

```
manifest → evaluateCompletedManifest()
         → updateAutonomyPreferencesFromManifest()
         → sketch.ts의 SketchMemoryBias
         → 다음 CompositionPlan에 반영
```

---

## 파일 → 파이프라인 단계 매핑

```
src/
├── pipeline/
│   ├── requestNormalization.ts    → [0] 요청 정규화
│   ├── sketch.ts                  → [1] CompositionPlan
│   ├── classicalKnowledge.ts      → [1] ClassicalKnowledgePlan 첨부
│   ├── orchestrationPlan.ts       → [2] EnsemblePlan
│   ├── formTemplates.ts           → [3] Section Plan (형식 검증)
│   ├── sonataCyclePlanner.ts      → [3] Movement Plan (다악장)
│   ├── longSpan.ts                → [3] LongSpanFormPlan
│   ├── types.ts                   → [1–4] 모든 계획 타입 정의
│   ├── hybridSymbolicCandidatePool.ts → [5] 복수 candidate 생성
│   ├── pianoIR.ts                 → [6] 피아노 IR
│   ├── pianoProjection.ts         → [6] 연주성 지표 계산
│   ├── pianoRepairSolver.ts       → [6] repair 지시
│   ├── pianoEvaluation.ts         → [6] 연주성 평가
│   ├── evaluation.ts              → [7] StructureEvaluationReport
│   ├── craftScoring.ts            → [7] craft score 계산
│   ├── cycleEvaluation.ts         → [7] 다악장 평가
│   ├── sonataCycleOrchestrator.ts → [7] sonata cycle 평가
│   ├── quality.ts                 → [7] 재시도 정책
│   ├── expressionPlan.ts          → [8] expression plan sidecar
│   └── orchestrator.ts            → 전체 단계 조율
├── composer/
│   ├── index.ts                   → [5] Python worker 호출
│   ├── learnedAdapter.ts          → [5] learned_symbolic 연결
│   └── learnedNormalizer.ts       → [5] learned output 정규화
├── critic/
│   └── index.ts                   → [7] Python 구조 비평 worker
├── humanizer/
│   └── index.ts                   → [8] expression plan 적용
├── render/
│   └── index.ts                   → [8] MIDI → WAV/MP4
└── memory/
    ├── candidates.ts              → [9] candidate sidecar
    ├── pianoDataset.ts            → [9] 피아노 dataset
    └── manifestAnalytics.ts       → [9] manifest 통계

workers/
├── composer/                      → [5] Python: music21 / learned_symbolic
├── humanizer/                     → [8] Python: expression plan 적용
└── render/                        → [8] Python: FluidSynth / FFmpeg
```

---

## 현재 약점과 발전 방향

| 단계 | 현재 상태 | 발전 방향 |
| ---- | --------- | --------- |
| [2] EnsemblePlan | CompositionPlan 파생, 별도 단계 없음 | 악기별 역할 협상을 독립 planning step으로 |
| [4] Motif & Harmonic | CompositionPlan 내 opaque 필드 | 동기 추적, 화성 실현 검증을 evaluator에서 명시적으로 |
| [6] Projection/Repair | 피아노 전용 | string trio, 관악, 혼합 편성 연주성 검증 필요 |
| [7] Evaluator | craftScore TS 타입 불일치 (pre-existing) | cycleEvaluation.ts 타입 수정 필요 |
| [9] Feedback Dataset | 청취자 평점 스키마는 있으나 UI 없음 | 리뷰 인터페이스 또는 CLI 완성 |

---

## 관련 문서

- [state-machine.md](state-machine.md) — PipelineState 전이 규칙
- [manifest-schema.md](manifest-schema.md) — JobManifest 스키마
- [autonomy-operations.md](autonomy-operations.md) — 자율 스케줄링 운영
