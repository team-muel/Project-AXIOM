# Composition Engine

AXIOM의 작곡 엔진은 6개의 음악적 질문에 답하는 순서로 동작한다.

1. **무엇을 쓸 것인가** — CompositionPlan
2. **어떤 편성인가** — OrchestrationPlan
3. **어떤 형식인가** — Section/Movement Plan
4. **어떤 동기와 화성 계획인가** — Motif & Harmonic Plan
5. **실제 악보가 연주 가능한가** — Projection / Repair
6. **좋은 음악인가** — Musical Evaluator

---

## 파이프라인 흐름

```
User Intent (POST /compose)
        │
        ▼
[1] CompositionPlan         pipeline/sketch.ts
                            composer/index.ts (Python planner)
                            pipeline/classicalKnowledge.ts
        │
        ▼
[2] OrchestrationPlan       pipeline/orchestrationPlan.ts
        │
        ▼
[3] Section / Movement Plan pipeline/formTemplates.ts
                            pipeline/sonataCyclePlanner.ts
                            pipeline/longSpan.ts
        │
        ▼
[4] Motif & Harmonic Plan   (CompositionPlan 내 motifs[], harmonicPlan, ClassicalHarmonyKnowledge)
        │
        ▼
[5] Symbolic Generator      composer/index.ts → workers/composer/
                            pipeline/hybridSymbolicCandidatePool.ts (복수 candidate)
        │
        ▼
[6] Projection / Repair     pipeline/pianoIR.ts
                            pipeline/pianoProjection.ts
                            pipeline/pianoRepairSolver.ts
        │
        ▼
[7] Musical Evaluator       critic/index.ts → Python critique worker
                            pipeline/evaluation.ts
                            pipeline/craftScoring.ts
                            pipeline/cycleEvaluation.ts
        │
        ▼
[8] Renderer                humanizer/index.ts + render/index.ts → Python workers
        │
        ▼
[9] Feedback Dataset        memory/candidates.ts, memory/pianoDataset.ts
                            → autonomy preferences → 다음 CompositionPlan bias
```

---

## 단계별 상세

### [1] CompositionPlan — 무엇을 쓸 것인가

**파일:** `pipeline/sketch.ts`, `composer/index.ts`, `pipeline/classicalKnowledge.ts`

`materializeCompositionSketch()`가 `ComposeRequest` + autonomy memory bias → `CompositionSketch` 생성. Python planner가 `CompositionPlan`으로 확장.

```typescript
interface CompositionPlan {
  tonalCenter: string;       // "C", "G", "Bb"
  mode: string;              // "major", "minor", "dorian"
  tempo: number;
  form: string;              // "sonata", "rondo", "theme_and_variations", "fugue_lite"
  instrumentation: InstrumentAssignment[];
  sections: SectionPlan[];
  motifs?: MotifDraft[];
  harmonicPlan?: HarmonicPlan;
  classicalKnowledge?: ClassicalKnowledgePlan;
  longSpanForm?: LongSpanFormPlan;
  sonataCycle?: SonataCyclePlan;
}
```

autonomy memory bias: `sketch.ts`가 과거 실행의 `motifReturns`, `tensionArc`, `cadenceApproaches` 패턴을 sketch에 반영한다.

---

### [2] OrchestrationPlan — 어떤 편성인가

**파일:** `pipeline/orchestrationPlan.ts`

`CompositionPlan.instrumentation` → `OrchestrationPlan` 도출.

```typescript
interface OrchestrationPlan {
  family: "strings" | "winds" | "piano" | "keyboard" | "mixed";
  instruments: InstrumentAssignment[];
  sectionOrchestrations: OrchestrationSectionPlan[];
  // 섹션별: conversationMode, balanceProfile, registerLayout
}
```

**현재 한계:** 독립적 planning step이 아니라 CompositionPlan 파생. 악기별 역할 협상(주제 vs 반주 vs 대위선)의 명시적 계획이 없다.

---

### [3] Section / Movement Plan — 어떤 형식인가

**파일:** `pipeline/formTemplates.ts`, `pipeline/sonataCyclePlanner.ts`, `pipeline/longSpan.ts`

지원 형식: `sonata`, `rondo`, `theme_and_variations`, `fugue_lite`

```typescript
interface SectionPlan {
  sectionId: string;
  role: "intro" | "theme_a" | "theme_b" | "bridge" | "development" | "variation" | "recap" | "cadence" | "outro";
  measures: number;
  tempo?: number;
  tonalCenter?: string;
  cadenceOptions?: CadenceOption[];
  expectedTexture?: TextureGuidance;
}
```

다악장: `SonataCyclePlan` — movements[], cycleTensionCurve[], crossMovementRecalls[]

---

### [4] Motif & Harmonic Plan — 어떤 동기와 화성 계획인가

CompositionPlan 내부에 포함:

```typescript
interface MotifDraft {
  pitches?: number[];
  rhythm?: number[];
  sectionIds?: string[];          // 등장할 섹션
  transformPolicy?: MotifTransformPolicy;  // repeat | sequence | fragment | revoice | ...
}

interface ClassicalHarmonyKnowledge {
  language?: "common_practice" | "modal" | "chromatic" | "extended_tonal";
  cadencePolicy?: "light" | "structural" | "architectural";
  modulationStrategy?: "none" | "local_tonicization" | "sectional" | "long_range";
  colorPalette?: HarmonicColorTag[];  // mixture | applied_dominant | suspension | ...
}
```

**현재 한계:** Python planner가 이 계획을 얼마나 따르는지는 MIDI 산출물 평가로만 확인 가능. 동기 추적과 화성 실현 검증이 evaluator에서 명시적으로 계산되지 않는다.

---

### [5] Symbolic Generator — 생성

**파일:** `composer/index.ts`, `workers/composer/`, `pipeline/hybridSymbolicCandidatePool.ts`

| Worker | 조건 |
|--------|------|
| `music21` | canonical classical lane (기본) |
| `learned_symbolic` | narrow string_trio_symbolic lane (실험적, miniature + string trio 한정) |
| `musicgen` | audio_only workflow |

hybrid mode에서는 `buildHybridSymbolicCandidateRequests()`가 복수 candidate를 생성하고 구조 평가 점수로 선택.

---

### [6] Projection / Repair — 연주 가능한가

**파일:** `pipeline/pianoIR.ts`, `pipeline/pianoProjection.ts`, `pipeline/pianoRepairSolver.ts`

21개 피아노 연주성 지표 계산:

| 지표 | 설명 |
|------|------|
| `pianoHandSpanViolations` | 19반음(minor 13th) 초과 스팬 수 |
| `pianoAwkwardSpanCount` | 14반음(major 9th) 초과 스팬 수 |
| `pianoHandCrossingCount` | 성부 교차 수 |
| `pianoParallelOctaveCount` | 평행 옥타브 수 |
| `pianoRegisterSeparation` | 성부 간 거리 |

Repair 지시 종류: `reduce_hand_span`, `smooth_left_hand_leaps`, `clarify_right_hand_melody`, `thin_overdense_chords`, `separate_registers`, ...

전략: `repairSolver` (MIDI 직접 수정) 또는 `rewrite` (섹션 재생성).

**현재 한계:** 피아노 전용. string trio, 관악, 혼합 편성 연주성 검증 없음.

---

### [7] Musical Evaluator — 좋은 음악인가

**파일:** `critic/index.ts`, `pipeline/evaluation.ts`, `pipeline/craftScoring.ts`, `pipeline/cycleEvaluation.ts`

`StructureEvaluationReport` 핵심 차원:

| 차원 | 측정 항목 |
|------|-----------|
| **Long-span form** | tension curve 실현, return payoff 강도 |
| **Cadence** | 도착 강도, 빈도, architectural weight |
| **Orchestration** | balance, register, conversation mode 준수 |
| **Classical knowledge** | voice leading, dissonance treatment, notation marks |
| **Audio (optional)** | key drift, tonal tracking |

craft score = 차원별 가중 합산. quality gate 기준.

재시도 정책 (`pipeline/quality.ts`):
```typescript
shouldRetryStructureAttempt(evaluation, policy, attempt)  // 구조 재시도
shouldRetryAudioAttempt(evaluation, policy, attempt)       // 오디오 재시도
```

---

### [8] Renderer — 오디오 생성

**파일:** `humanizer/index.ts`, `render/index.ts`, `workers/humanizer/`, `workers/render/`

**Humanize:** ExpressionPlanSidecar 적용
- `humanizationStyle`: `"mechanical"` | `"restrained"` | `"expressive"`
- 섹션별: phraseBreath (pickup/arrival/release/cadence_recovery/rubato_anchor), tempoMotion, ornaments

**Render:** `humanized.mid` → `output.wav` (FluidSynth) → `preview.mp4` (FFmpeg), `score-preview.svg`

---

### [9] Feedback Dataset

매 실행 결과가 자동으로 학습 데이터 후보가 된다. 자세한 내용은 [`datasets.md`](datasets.md).

---

## 현재 음악적 갭

| 영역 | 상태 |
|------|------|
| Phrase grammar | 섹션은 있지만 sentence/period/hypermeter 수준의 구문 수사는 얕음 |
| Harmony | 전체 화성 경로와 cadence 검사는 있으나, prolongation / inner-voice / harmonic rhythm 제어 부족 |
| Texture | lead + accompaniment 중심. 모방 대위와 풍부한 대위법적 생성은 미구현 |
| Expression | phrase / texture 위에서 동작해야 하지만 이를 보상하는 방향으로 쓰이는 경향 |
| Long-span form | 단일 섹션 의도 유지는 되나 exposition-development-recap 필연성, multi-section 주제 변형은 미약 |
| Orchestration | 음색 개선됨, 하지만 레지스터 전달, 더블링 전략, 악기 관용구 설계는 미구현 |
| Authorial identity | craft 패턴 재사용은 되나 인식 가능한 레퍼토리 고유 수사는 아직 없음 |
