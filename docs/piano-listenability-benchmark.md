# Piano Listenability Benchmark

## 목적

AXIOM 피아노 생성 경로(`solo_piano_symbolic`)가 만든 곡이 실제로 듣기 좋은지 측정하는 벤치마크입니다.

기존 `craftScoring.ts` + `pianoCraftScoring.ts`가 구조적 유효성(게이트 통과 여부)을 평가한다면,
이 벤치마크는 **청취 경험 품질** — 멜로디 명료성, 베이스 일관성, 반주 패턴 안정성, 레지스터 균형, 연주 가능성 — 을 측정합니다.

---

## 측정 지표 (7가지 + 2가지 종합 점수)

### 1. melodicClarity (멜로디 명료성)

> "RH 멜로디가 얼마나 선명하고 자연스럽게 들리는가?"

| 항목 | 세부 |
|------|------|
| 음역 밀도 | 2–4 note/measure 구간이 최적 |
| 도약 비율 | 큰 도약(>7 반음) 과다 시 감점 |
| 초超 옥타브 도약 | 12 반음 이상 도약은 강한 감점 |

구현 함수: `computeMelodicClarity()` in `pianoCraftScoring.ts`

---

### 2. bassCoherence (베이스 일관성)

> "LH 베이스가 화성을 명확하게 지지하는가?"

| 항목 | 세부 |
|------|------|
| 베이스 진행 패턴 | stepwise → 1.0, mixed → 0.75, leaping → 0.30 |
| 베이스 음역 | MIDI 36–60 (C2–C4) 범위 내 |
| 페달 포인트 | pedal bass profile도 허용 |

구현 함수: `computeBassCoherence()` in `pianoCraftScoring.ts`

---

### 3. accompanimentConsistency (반주 일관성)

> "LH 반주 패턴이 리듬적으로 일관되게 유지되는가?"

| 항목 | 세부 |
|------|------|
| 반주 이벤트 수 | 최소 2 events/measure |
| 패턴 규칙성 | 이벤트 간격의 표준편차 ≤ 0.5 beat |
| 텍스처 역할 | pulse, chordal_support, bass 역할 유지 |

구현 함수: `computeAccompanimentPatternCoherence()` in `pianoCraftScoring.ts`

---

### 4. registerSpacing (레지스터 간격)

> "RH와 LH 사이의 레지스터 간격이 청취에 적절한가?"

| 항목 | 세부 |
|------|------|
| 중앙값 간격 | 이상적: 8–20 반음 (단3도–단7도) |
| 교차 방지 | LH가 RH보다 높아지면 강한 감점 |
| 극단 회피 | 두 손이 6 반음 이내로 몰리면 감점 |

구현 함수: `computeRegisterSpacing()` in `pianoCraftScoring.ts`

---

### 5. pianoPlayability (연주 가능성)

> "실제 피아니스트가 연주할 수 있는 손 위치인가?"

| 항목 | 세부 |
|------|------|
| 손 스팬 | 단일 손 ≤ 10도 (16 반음) |
| 손 교차 | 없음 |
| 화음 밀도 | 4음 이상 화음 ≤ 20% |

구현 함수: `computeHandPlayability()`, `pianoPlayabilityGate()` in `pianoCraftScoring.ts`

---

### 6. overallAppeal (종합 청취 점수)

```
overallAppeal = 0.35 × handPlayability
              + 0.35 × melodicClarity
              + 0.30 × bassCoherence
```

임계값: `overallAppeal ≥ 0.55` 이면 청취 가능 수준으로 분류.

구현 함수: `computeOverallAppeal()` in `pianoCraftScoring.ts`

---

### 7. textureFormCoherence (텍스처-형식 일관성)

> "반주 텍스처 밀도가 악곡 형식과 논리적으로 연결되는가?"

| 섹션 역할 | 기대 밀도 |
|----------|----------|
| development | theme_a보다 밀도 높음 (≥ 1.0×) |
| recap | theme_a와 ±30% 이내 |
| intro / outro / coda | theme_a보다 단순 (≤ 1.0×) |

기준선이 없으면 (theme_a 없음, 섹션 2개 미만) 0.5 반환.

구현 함수: `computeTextureFormCoherence()` in `pianoCraftScoring.ts`

---

### 8. pianoListenabilityScore (청취 품질 종합, 신규)

> "피아노 연주자에게가 아니라 청취자에게 좋은 곡인가?"

6차원 가중 복합 점수:

```
pianoListenabilityScore =
    0.22 × melodyProminence          (RH가 LH 위 레지스터에 명확히 위치)
  + 0.20 × bassRootSupport           (LH 베이스가 올바른 음역에서 화음 루트 지지)
  + 0.18 × accompanimentConsistency  (반주 리듬 패턴 규칙성)
  + 0.17 × registerSpacing           (손 간격 자연스러움)
  + 0.13 × pedalBlurRisk             (페달 흐림 위험 낮음, 1-risk)
  + 0.10 × textureFormCoherence      (텍스처-형식 일관성)
```

가중치 합계 = 1.00. 범위 [0.0, 1.0].

구현 함수: `computePianoListenabilityScore()` in `pianoCraftScoring.ts`  
반환 타입: `PianoListenabilityScoreBreakdown` (6차원 분해 + `overall`)

`computePianoCraftScoreSummary()` 결과의 `pianoListenabilityScore` 필드에 저장.

---

## 벤치마크 절차

### 자동 벤치마크 (A/B 비교)

```
test/piano-listenability.test.mjs
```

- **Golden fixture**: 잘 구성된 피아노 섹션 (melodicClarity ≈ 0.79, bassCoherence = 1.0, handPlayability ≈ 0.97)
- **Baseline fixture**: 의도적으로 나쁜 구성 (큰 도약, leaping bass, poor span)
- Golden overallAppeal ≥ 0.55
- Baseline overallAppeal < 0.55
- 각 지표별 golden ≥ baseline 검증

### 블라인드 A/B 청취 리뷰 프로토콜 (수동)

```
test/piano-benchmark.test.mjs
```

다음 30개 프롬프트 유형을 사용합니다:

| 유형 | 수 |
|------|----|
| lyrical / nocturne style | 8 |
| energetic / étude style | 6 |
| gentle / lullaby style | 6 |
| dramatic / romantic style | 6 |
| contrapuntal / baroque style | 4 |

각 프롬프트에 대해:
1. `music21 baseline` (구조 룰 기반) 생성
2. `learned_symbolic` (솔로 피아노 신경망) 생성
3. 두 버전을 익명화하여 blind A/B 리뷰
4. 리뷰어는 아래 rubric으로 기록:

| 지표 | 설명 | 척도 |
|------|------|------|
| melodicClarity | 멜로디 선명도 | 0–5 |
| bassCoherence | 베이스 지지 | 0–5 |
| accompanimentConsistency | 반주 안정감 | 0–5 |
| registerSpacing | 레지스터 균형 | 0–5 |
| pianoPlayability | 연주 가능성 | 0–5 |
| overallAppeal | 전체 듣기 좋음 | 0–5 |

---

## 현재 구현 상태

| 지표 | 자동 측정 | 수동 리뷰 준비 |
|------|---------|-------------|
| melodicClarity | ✅ | ✅ |
| bassCoherence | ✅ | ✅ |
| accompanimentConsistency | ✅ | ✅ |
| registerSpacing | ✅ | ✅ |
| pianoPlayability | ✅ | ✅ |
| overallAppeal | ✅ | ✅ |
| textureFormCoherence | ✅ | ✅ |
| pianoListenabilityScore (composite) | ✅ | ✅ |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/core/evaluate/pianoCraftScoring.ts` | 자동 지표 계산 |
| `src/core/evaluate/pianoEvaluation.ts` | 손 레이아웃 평가 |
| `src/core/repair/pianoProjection.ts` | 피아노 보정 |
| `test/piano-listenability.test.mjs` | 자동 벤치마크 테스트 |
| `test/piano-benchmark.test.mjs` | 수동 A/B 프로토콜 |

---

## 주의 사항

- 두 lane(music21 baseline vs learned_symbolic) 모두 아직 **composer-grade general model은 아닙니다.**
- 자동 점수는 음악적 미적 판단의 대리지표일 뿐, 최종 판단은 청취자입니다.
- 블라인드 리뷰는 최소 3명 이상의 독립 리뷰어가 참여해야 통계적 유의성이 확보됩니다.
