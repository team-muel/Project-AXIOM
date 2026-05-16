# Phrase Grammar — 악절 문법

악절(phrase)은 작곡에서 가장 작은 의미 단위다. 단순한 마디 수 계산이 아니라 음악적 문장의 문법이다. AXIOM의 SectionPlan이 이 개념을 얼마나 제어하느냐가 음악 품질의 핵심 차이를 만든다.

---

## 1. 기본 악절 유형

### 1.1 Basic Sentence (기본 문장형)

8마디 기준, 2+2+4 구조.

```
마디: 1──2  3──4  5──6──7──8
      ╰─╯   ╰─╯   ╰────────╯
   제시(P)  반복(P') 계속→종지
```

- **제시(Presentation)**: 기본 동기(basic idea) 제시, 반복 또는 변형 반복
- **계속(Continuation)**: 단편화(fragmentation), 시퀀스, 화성 속도 증가
- **종지(Cadential)**: 속음 → 종지음 진행으로 마무리

AXIOM 구현 포인트:
- `SectionPlan.measures`가 8의 배수면 sentence 가능성 높음
- continuation 구간에서 `harmonicRhythm`이 빨라지게 HarmonicPlan 지정
- 마지막 2마디에 `cadenceOptions` 배치

### 1.2 Period (악절)

8마디, 4+4 구조. 전반절(antecedent) + 후반절(consequent).

```
마디: 1──2──3──4  5──6──7──8
      ╰──────────╯ ╰──────────╯
       전반절(HC)   후반절(PAC)
```

- **전반절(Antecedent)**: 긴장 상승, 반 종지(HC)로 끝남 → "질문"
- **후반절(Consequent)**: 전반절 반복/변형 → "답변", PAC로 확정

변형 유형:
- **Parallel period**: 후반절이 전반절 동기를 재사용
- **Contrasting period**: 후반절이 새 재료로 답변
- **Sequential period**: 후반절이 다른 조성 영역에서 반복

AXIOM 구현 포인트:
- antecedent는 `cadence: "HC"`, consequent는 `cadence: "PAC"`
- `phraseFunction: "antecedent"` / `"consequent"` 구분
- consequent의 `motifRef`가 antecedent의 것과 같으면 parallel period

### 1.3 Phrase Group (악절 그룹)

독립적인 두 악절이 연속되되, antecedent-consequent 쌍이 아닌 경우. 각 악절이 PAC로 끝날 수 있다.

```
[Phrase 1: PAC] [Phrase 2: PAC]
```

---

## 2. 악절 확장 기법

실제 음악에서 악절은 기본 4/8마디에서 다양하게 확장/압축된다.

### 2.1 Internal Expansion (내부 확장)

악절 내부 한 구간을 반복 또는 연장:
```
4마디 → 6마디: [1-2] [2-3] [3-4] (2마디 단위 연장)
```

### 2.2 Cadential Extension (종지 연장)

종지 직전을 늘여 기대감 증폭:
```
8마디 기대 → 10마디: [1-6] [V7─────] [tonic] (V7를 2마디 연장)
```

AXIOM의 `PhraseBreathPlan.cadenceRecoveryStart/EndMeasure`가 이를 제어.

### 2.3 Prefix / Suffix

- **Prefix (도입부)**: 주제 전에 느린 화음 준비, 분위기 설정
- **Suffix / Codetta**: 종지 후 확인, 분위기 정착

---

## 3. Cadence Placement — 종지 배치

### 3.1 종지의 구조적 위치

종지는 임의로 배치되지 않는다. 악절 문법상 허용되는 위치:

| 위치 | 허용 종지 유형 |
|------|--------------|
| 전반절 끝 | HC (반 종지) 권장, IAC 허용 |
| 후반절 끝 | PAC 필수 (섹션 확정) |
| 개발부 내부 | HC 또는 DC (긴장 유지) |
| 소나타 exposition 끝 | PAC (secondary key area) |
| 재현부 끝 | PAC (주조) |
| 코다 끝 | PAC 또는 plagal 추가 |

### 3.2 종지 준비 (Cadential Approach)

강한 PAC는 준비가 필요하다:
1. **Pre-dominant** (IV, ii, ii°, IV⁶): 속음(V)으로 가는 다리
2. **Dominant** (V 또는 V⁷): 긴장 정점
3. **Tonic** (I): 해소

```
ii⁶ → V⁷ → I  (가장 일반적 PAC 공식)
IV  → V  → I  (단순한 PAC)
```

AXIOM `HarmonicPlan.cadence` 필드가 이 패턴을 지정.

### 3.3 종지 리듬 (Cadential Rhythm)

- 강박(downbeat) 도착이 약박보다 강한 PAC
- 남성 종지(masculine ending): 종지음이 강박
- 여성 종지(feminine ending): 종지음이 약박 → 부드러운 마무리

---

## 4. Phrase Breath — 악절 숨쉬기

`PhraseBreathPlan`이 표현 계획의 기초.

### 4.1 구간별 에너지 프로파일

```
Pickup → ──────────────── → Release → CadenceRecovery
  ↑ energy gathering        ↓           ↓↓ settling
```

| 구간 | 설명 | AXIOM 필드 |
|------|------|-----------|
| Pickup | 종지 이전 에너지 집중 | `pickupStartMeasure` – `pickupEndMeasure` |
| Arrival | 주제/종지 도착점 | `arrivalMeasure` |
| Release | 도착 후 에너지 방출 | `releaseStart/EndMeasure` |
| Cadence Recovery | 종지 후 안정화 | `cadenceRecoveryStart/EndMeasure` |
| Rubato Anchors | 표현 자유 포인트 | `rubatoAnchors[]` |

### 4.2 Rubato Anchor 배치 원칙

- **확장 rubato**: 종지 직전 V 화음에서 → 도착 기대감 늘리기
- **압축 rubato**: 동기 반복 구간에서 → 리듬 긴장 증가
- 모든 마디에 rubato 지정은 금지 — 표현 계획을 무효화함

---

## 5. Hypermeter — 상위 박자 구조

악절 위에서 더 큰 박자 단위가 작동한다.

### 5.1 정의

4마디짜리 악절이 하나의 "하이퍼박(hyperbeat)"처럼 기능:

```
Hypermeasure 1: [마디1-4]  (hyperdownbeat: 마디1)
Hypermeasure 2: [마디5-8]  (hyperdownbeat: 마디5)
```

### 5.2 하이퍼미터 확장/압축

| 유형 | 효과 |
|------|------|
| 4+4 (regular) | 안정적, 고전 표준 |
| 4+6 (expanded consequent) | 확장된 답변, 극적 효과 |
| 3+4 (elided phrase) | 악절 끝과 다음 악절 시작이 겹침 |
| 2+2+4 | sentence 기본형 |

### 5.3 Elision (악절 융합)

이전 악절의 종지 마디가 다음 악절의 시작 마디가 되는 기법:

```
[악절 1: 마디 1-8(PAC)] [악절 2: 마디 8-15]
                  ↑
              마디 8 = PAC이자 다음 악절 시작
```

에너지 손실 없이 악절을 연결하는 중요한 기법. 개발부에서 자주 사용.

---

## 6. AXIOM 현재 구현 상태와 목표

| 개념 | 현재 지원 | 구현 경로 |
|------|---------|------|
| sentence / period 구분 | ✅ `src/core/plan/phraseGrammar.ts` | `SectionPlan.phraseGrammar.structure.type` |
| antecedent / consequent 쌍 | ✅ `PeriodStructure` | `phraseGrammar.structure.antecedent/consequent` |
| cadence 위치 강제 | ✅ 부분적 (`cadenceOptions` + phraseGrammar) | `PhraseUnit.cadenceType` (HC/PAC 지정) |
| hypermeter | ✅ `HypermetricGroup` (2/4/8 bar) | `phraseGrammar.hypermetricGroups` |
| phrase peak | ✅ `SectionArtifactSummary.phrasePeaks` | 평가 시 `computePhraseGrammarScore` 확인 |
| 악절 확장/압축 | ❌ | `phraseLengthModifier` 개념 도입 예정 |
| elision | ❌ | 섹션 전환 옵션으로 추가 예정 |
| phrase breath | ✅ (`PhraseBreathPlan`) | 기능 강화 예정 |
| rubato anchors | ✅ | 자동 제안 로직 개선 예정 |
