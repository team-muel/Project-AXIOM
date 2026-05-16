# Musical Quality — 좋은 곡의 기준

AXIOM이 생성하는 곡을 평가하는 기준. evaluator, craftScoring, quality gate가 이 기준을 계산 가능한 점수로 변환한다.

---

## 1. 왜 평가 기준이 명시적이어야 하는가

LLM 기반 생성기는 "괜찮아 보이는" 음악을 만들 수 있지만, "좋은" 음악과는 다르다. 좋은 곡은 아래 세 가지를 동시에 만족한다.

1. **구조적 완성도** — 형식 논리가 일관되고, 시작과 끝이 필연적으로 연결된다.
2. **음악적 생동감** — 긴장과 이완, 기대와 해소의 곡선이 듣는 사람을 끌어간다.
3. **연주 가능성** — 사람이 실제로 연주할 수 있거나, 악기가 물리적으로 낼 수 있는 소리다.

---

## 2. 구조적 완성도 기준

### 2.1 형식 논리 (Form Coherence)

| 기준 | 통과 조건 |
|------|----------|
| 섹션 역할 배분 | 도입–발전–재현(또는 해당 형식 등가물)이 식별 가능 |
| 주제 대비 | 최소 2개의 성격 대조 섹션 |
| 재현 식별 가능성 | recap이 exposition 주제를 청자가 알아볼 수 있게 복귀 |
| 결말 종지 | 마지막 카덴츠가 주조(tonic)에서 완전 종지(authentic cadence)로 마무리 |

### 2.2 긴장 곡선 (Tension Arc)

장기 긴장 곡선은 평탄하거나 단조롭지 않아야 한다.

```
이상적 소나타 긴장 곡선:
    │        ╭──╮ ← development peak
    │   ╭─╮  │  │  ╭─╮
    │───╯  ╰──╯  ╰──╯  ╰─── (coda)
    └──────────────────────→ time
       exp   dev  recap  coda
```

평가 지표:
- **tensionRangeScore**: 곡 전체 긴장 범위 (max – min). 범위가 너무 좁으면 단조롭다.
- **tensionArcShape**: development 구간에서 정점, recap에서 상대적 이완, coda에서 최종 정착.
- **longSpanReturnPayoff**: recap/return 순간에 긴장이 실제로 해소되는지.

### 2.3 종지 건축 (Cadence Architecture)

종지는 단순한 "끝 화음"이 아니라, 구조의 기둥이다.

| 종지 유형 | 역할 |
|----------|------|
| 완전 정격 종지 (PAC) | 섹션 확정, 큰 구분선 |
| 불완전 정격 종지 (IAC) | 섹션 내 중간 쉼, 약한 확정 |
| 반 종지 (HC) | 긴장 유지, 다음 섹션으로 추진 |
| 속임 종지 (DC) | 기대 위반, 극적 효과 |
| 피카르디 3도 | 단조 곡에서 밝은 마무리 |

평가 지표:
- **cadenceArrivalStrength**: PAC 비율 (가중치: 악절 마지막 > 중간)
- **cadenceFrequency**: 마디당 종지 밀도 (너무 많으면 단편화, 너무 적으면 부유)
- **cadenceArchitecturalWeight**: 구조적으로 중요한 위치(소나타 recap, 론도 반환점)에 PAC가 있는가

---

## 3. 음악적 생동감 기준

### 3.1 동기 발전 (Motif Development)

| 지표 | 설명 |
|------|------|
| `motifReturnCount` | 원형 동기가 recap에서 알아볼 수 있게 복귀하는 횟수 |
| `motifTransformVariety` | sequence, fragmentation, inversion 등 변형 기법 다양성 |
| `motifCoherence` | 섹션별 주제 출처가 초기 동기에서 유도 가능한가 |

### 3.2 화성 운동 (Harmonic Motion)

| 지표 | 설명 |
|------|------|
| `harmonicRhythmVariance` | 화성 리듬이 단조롭지 않은가 (빠른 화성 → 느린 화성 변화) |
| `tonicizationDepth` | 부속 조성화(tonicization)가 얼마나 풍부한가 |
| `voiceLeadingScore` | 성부 진행의 매끄러움 (병행 5도/8도 감점) |

### 3.3 텍스쳐 다양성 (Texture Variety)

| 지표 | 설명 |
|------|------|
| `textureProfileScore` | 동형 화음 진행 → 대위법 → 분산 화음 변화 |
| `registralSpread` | 음역 활용 범위 (너무 좁으면 음향 빈곤) |
| `voiceCountVariance` | 성부 수의 증감으로 텍스쳐 드라마 형성 |

---

## 4. 연주 가능성 기준

자세한 내용은 [`piano-composition.md`](piano-composition.md).

| 지표 | 임계값 |
|------|--------|
| `handSpanViolations` | 0을 목표, 19반음 초과 = 실패 |
| `awkwardSpanCount` | 낮을수록 좋음, 14반음 초과 누적 |
| `handCrossingCount` | 의도적이지 않은 교차 = 감점 |
| `parallelOctaveCount` | 명시적 옥타브 더블링 외 = 감점 |
| `registerSeparation` | 성부 간 거리가 충분한가 |

---

## 5. 사람 평가 Rubric

자동 평가가 잡지 못하는 음악적 질을 사람이 평가할 때 사용하는 기준표.

### 5.1 5점 척도 (1–5)

| 항목 | 1 (나쁨) | 3 (보통) | 5 (좋음) |
|------|---------|---------|---------|
| **형식 논리** | 무작위, 섹션 경계 불명확 | 형식은 있으나 필연성 약함 | 시작이 끝을 필연적으로 만듦 |
| **긴장/이완** | 평탄하거나 혼돈 | 부분적 곡선 | 전체 arc가 자연스럽게 흐름 |
| **주제 아이덴티티** | 동기 없음, 매 구절 새로 시작 | 일부 반복 있음 | 알아볼 수 있는 주제가 발전·복귀 |
| **화성 흥미** | 기계적, I-IV-V 반복 | 적절한 변화 | prolongation, 색채, 방향성 |
| **텍스쳐** | 단일 텍스쳐 유지 | 2가지 이상 | 텍스쳐 변화가 구조와 연동 |
| **종지 설득력** | 끝나는 느낌이 없음 | 끝나긴 함 | 마지막 화음이 필연적 |
| **연주 자연스러움** | 어색하거나 불가능 | 연주할 수 있음 | 손에 자연스럽게 맞음 |
| **전체 인상** | 다시 듣고 싶지 않음 | 괜찮은 연습곡 | 다시 듣고 싶음 |

### 5.2 총점 해석

| 평균 | 의미 |
|------|------|
| 1.0–2.0 | 재생성 필요 |
| 2.1–3.0 | 수정 후 데이터셋 후보 |
| 3.1–4.0 | 좋은 출력, 데이터셋 적합 |
| 4.1–5.0 | 우수 예시, 스타일 레퍼런스로 보관 |

### 5.3 평가 워크플로우

```
1. AXIOM이 곡 생성
2. 자동 craftScore 계산 (AXIOM 내부)
3. craftScore ≥ 3.0인 곡만 사람 평가 대상
4. 평가자 2명이 독립적으로 rubric 기입
5. 평균 점수 및 불일치 노트 기록
6. 점수 + 노트 → datasets/human-ratings.jsonl
7. 패턴 분석 → autonomy preferences 업데이트
```

---

## 6. AXIOM craftScore 매핑

AXIOM 내부 `craftScoring.ts`가 계산하는 점수와 사람 평가 항목의 대응:

| 사람 평가 항목 | AXIOM 지표 |
|--------------|-----------|
| 형식 논리 | `longSpanFormScore` |
| 긴장/이완 | `tensionArcScore`, `longSpanReturnPayoff` |
| 주제 아이덴티티 | `motifReturnScore` |
| 화성 흥미 | `harmonicScore`, `tonicizationScore` |
| 텍스쳐 | `textureProfileScore` |
| 종지 설득력 | `cadenceArrivalStrength`, `cadenceArchitecturalWeight` |
| 연주 자연스러움 | `pianoPlayabilityScore` (피아노 한정) |

---

## 7. 현재 갭과 목표

| 영역 | 현재 | 목표 |
|------|------|------|
| Phrase grammar | 섹션 단위만 평가 | sentence/period/hypermeter 수준 |
| Harmonic prolongation | 전조 감지만 | 기능 화성 계층 분석 |
| Texture drama | 단순 성부 수 계산 | lead/accomp/counterpoint 역할 추적 |
| Authorial identity | 없음 | 특정 스타일 수사 인식 및 재사용 |
