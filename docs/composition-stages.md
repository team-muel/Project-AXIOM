# Composition Quality Stages

AXIOM의 작곡 목표를 5단계로 정의한다.  각 단계는 이전 단계 위에 쌓이며,
**현재 AXIOM이 집중해야 할 구간은 Stage 3**이다.

---

## Stage 1 — 8~16마디 피아노 phrase

> "선율이 자연스럽게 숨을 쉬는가"

**목표:**
- 선율이 자연스럽게 흐르는가
- 악절이 숨을 쉬는가 (쉼표, 긴장과 이완)
- 종지가 설득력 있는가
- 왼손 반주가 오른손 선율을 받쳐주는가

**구성:** 단일 섹션 (8–16마디), 반드시 A-B 구조일 필요 없음

**AXIOM 지표 매핑:**

| 목표 | AXIOM 지표 | 기준 |
|------|-----------|------|
| 선율 자연스러움 | `phraseShape` | ≥ 0.55 |
| 악절 호흡 | `planAwarePhraseGrammarScore` | ≥ 0.5 |
| 종지 설득력 | `cadenceStrength` | ≥ 0.5 |
| 왼손 지지 | `voiceIndependence` | ≥ 0.5 |
| 피아노 이디엄 | `registerIdiomaticFit` | ≥ 0.5 |

**벤치마크:** `test/benchmark-composition-stages.test.mjs` — Stage 1 그룹

---

## Stage 2 — 30초~1분 A-B-A 소품

> "A가 돌아올 때 의미가 있는가"

**목표:**
- A가 기억되는가 (motif identity)
- B가 대비되는가 (contrast)
- A가 돌아올 때 의미가 있는가 (return payoff)
- 마지막 종지가 자연스러운가

**구성:** 3섹션 (theme_a / development 또는 theme_b / recap), 총 16–32마디

**AXIOM 지표 매핑:**

| 목표 | AXIOM 지표 | 기준 |
|------|-----------|------|
| A 기억성 | `motifSurvival` | ≥ 0.5 |
| B 대비 | `sectionContractFit` | ≥ 0.5 |
| A 귀환 의미 | `motifRecapIdentity` + `tonalReturn` | 둘 다 ≥ 0.45 |
| 마지막 종지 | `cadenceArchitecturalWeight` | ≥ 0.5 |
| 전체 구조 | `finalCraftScore` | ≥ 0.5 |

**벤치마크:** `test/benchmark-composition-stages.test.mjs` — Stage 2 그룹

---

## Stage 3 — 1~3분 character piece ⟵ **현재 집중 구간**

> "감정 곡선, 텍스처 변화, 동기 발전, 화성 긴장과 해소, 피아노 이디엄"

**형식 예시:** nocturne · prelude · intermezzo · lyric miniature · short rondo

**목표:**
- 감정 곡선 (tension arc)
- 텍스처 변화 (sparse → dense → resolved)
- 동기 발전 (transform variety)
- 화성 긴장과 해소 (harmonic narrative)
- 피아노 이디엄 (naturalistic writing)

**구성:** 3–5섹션, 총 32–64마디, 단일 악장

**AXIOM 지표 매핑:**

| 목표 | AXIOM 지표 | 기준 |
|------|-----------|------|
| 감정 곡선 | `advancedCraftScore` | ≥ 0.55 |
| 동기 발전 | `motifTransformVariety` + `planAwareMotifDevelopmentScore` | 둘 다 ≥ 0.5 |
| 화성 서사 | `harmonyContractScore` + `tonalReturn` | 둘 다 ≥ 0.5 |
| 증거 커버리지 | `evidenceCoverageScore` | ≥ 0.55 |
| 피아노 이디엄 | `pianoListenabilityScore` | ≥ 0.60 |
| 재현 필연성 | `motifRecapIdentity` | ≥ 0.50 |

**선택 tier 기준:** Tier 3 (craft gate 전체 통과) 후보 배출 비율이 목표

**벤치마크:**
- `test/benchmark-masterpiece-direction.test.mjs` — 6 compositional styles (Stage 3 scope)
- `test/benchmark-notagen-control-ablation.test.mjs` — control block 효과 검증

---

## Stage 4 — 3~6분 단악장

> "소나타적 논리의 씨앗"

**목표:**
- exposition-like opening
- contrast section
- development-like middle
- recap / return
- coda

**이 단계부터 의미 있는 형식:** sonata-lite · rondo · variation · fugue-lite

**구성:** 5–8섹션, 총 64–128마디

**AXIOM 지표 매핑 (추가 필요):**

| 목표 | AXIOM 지표 (현재 / 계획) |
|------|-------------------------|
| 장기 긴장 곡선 | `tensionArcShape` (계획) |
| 큰 climax 배치 | `climaxPlacement` (masterpiece benchmark) |
| 개발부 밀도 | `motifTransformVariety` |
| 재현 필연성 | `longSpanReturnPayoff` (계획) |
| 코다 해소 | `cadenceArchitecturalWeight` |

**현재 상태:** 파이프라인은 3–5섹션 구조를 지원하나, 128마디 이상 장기 설계는 미검증

---

## Stage 5 — 8~12분 진지한 단악장

> "아직 나중"

**필요한 능력 (미래 개발 항목):**
- 장기 조성 설계 (조성 진행 arc)
- 긴 호흡의 동기 발전 (4–8 transform 단계)
- 큰 climax 설계 (단 하나의 정점 설계)
- 중간부 지루함 방지 (sub-motif, texture contrast 교체)
- recap의 필연성 (복귀 전 준비 → 복귀 → 여운)

**현재 AXIOM 지원 수준:** Stage 3 수준 — Stage 5는 미래 fine-tuning 이후 목표

---

## 단계별 개발 상태 요약

| 단계 | 규모 | 형식 | 현재 상태 |
|------|------|------|----------|
| Stage 1 | 8–16마디 | single phrase | ✅ 지표 있음, 벤치마크 있음 |
| Stage 2 | 16–32마디 | ABA | ✅ 지표 있음, 벤치마크 있음 |
| Stage 3 | 32–64마디 | character piece | ✅ **현재 집중** — 지표+벤치마크+control ablation 완비 |
| Stage 4 | 64–128마디 | single movement | 🔶 파이프라인 지원, 장기 설계 미검증 |
| Stage 5 | 128마디+ | serious movement | ❌ 미래 fine-tuning 이후 |

---

## AXIOM 설정 가이드 (Stage별)

### Stage 1 — phrase 검증
```env
AXIOM_GENERATION_STRATEGY=notagen_first
LEARNED_SYMBOLIC_BACKEND=notagen_local
# 단일 섹션, 빠른 품질 루프
```

### Stage 2 — ABA 소품
```env
AXIOM_GENERATION_STRATEGY=notagen_first
LEARNED_SYMBOLIC_BACKEND=notagen_local
# 3섹션, return 감각 검증
```

### Stage 3 — character piece R&D (권장)
```env
AXIOM_GENERATION_STRATEGY=hybrid_notagen_with_template_baseline
LEARNED_SYMBOLIC_BACKEND=notagen_local
NOTAGEN_ENGINE=notagen_native
# NotaGen N개 + template baseline 1개 — 명곡 지향 기본 모드
```

---

## 관련 문서

- [`docs/notagen-training.md`](notagen-training.md) — NotaGen adapter 4단계 훈련 목표
- [`docs/masterpiece-direction.md`](musical-quality.md) — 좋은 곡의 기준
- [`docs/score-calibration-workflow.md`](score-calibration-workflow.md) — 사람 calibration → 점수 조정
- [`test/benchmark-masterpiece-direction.test.mjs`](../test/benchmark-masterpiece-direction.test.mjs) — Stage 3 스타일 벤치마크
- [`test/benchmark-composition-stages.test.mjs`](../test/benchmark-composition-stages.test.mjs) — Stage 1/2 벤치마크
