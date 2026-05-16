# Harmony Grammar — 화성 문법

AXIOM이 생성하는 화성 언어의 기준. `ClassicalHarmonyKnowledge`, `HarmonicPlan`, `HarmonicColorCue`가 이 개념들을 파이프라인에 전달한다.

---

## 1. Common-Practice Progression — 기능 화성 진행

### 1.1 기능 범주

모든 화음은 세 기능 중 하나에 속한다:

| 기능 | 화음 (장조) | 역할 |
|------|-----------|------|
| **Tonic (T)** | I, iii, vi | 안정, 시작/마무리 |
| **Pre-dominant (PD)** | ii, IV, ii⁷, IV⁶ | 속음으로 이동하는 다리 |
| **Dominant (D)** | V, V⁷, vii°, V⁹ | 긴장, tonic으로 해소 |

기본 진행 원칙:
```
T → PD → D → T   (완전한 기능 순환)
T → D  → T       (단순 순환)
T → PD → T       (plagal, 교회 느낌)
```

### 1.2 일반적 진행 패턴

```
I   → IV → V  → I    (기본 카덴츠)
I   → ii → V  → I    (세련된 카덴츠)
I   → vi → IV → V    (pop 진행, 고전 스타일에서 드물게)
I   → V/vi → vi      (applied dominant를 통한 전조 없는 vi 강조)
```

### 1.3 피해야 할 진행

| 진행 | 이유 |
|------|------|
| V → IV | 기능 역행 (dominant가 pre-dominant로 역방향 이동) |
| I⁶₄ → I | 제2전위화음 직접 해결 (ii⁶₄→V→I가 올바른 경과) |
| 연속 병행 5도 | 성부 독립성 파괴 |
| 동음 반복 확대 | 화성 리듬 정체 |

---

## 2. Prolongation — 화음 연장

단순한 화음 연속이 아니라, 한 화음을 여러 마디에 걸쳐 "연장"하는 것이 성숙한 화성의 핵심이다.

### 2.1 Tonic Prolongation

```
I ──────────────────────── I
   I⁶  →  IV⁶  →  V  →  I
   (I를 확장하는 내성 화성들)
```

### 2.2 Neighbour Note Prolongation (이웃음 연장)

```
I  →  I⁶  →  I   (이웃음 화음)
I  →  V⁶  →  I   (도미난트 이웃음 — 베이스 안정)
```

### 2.3 Passing Chord Prolongation (경과음 연장)

```
I  →  I⁶  →  IV⁶ → V  (베이스 상행 경과)
I  →  V⁶  →  vi  → V  (베이스 하행 경과)
```

### 2.4 Pedal Point (지속음)

베이스 또는 최고성부가 고정된 채 위에서 화성이 변하는 기법:
- **Tonic pedal**: 안정적, 코다에서 자주 사용
- **Dominant pedal**: 재현부 직전의 긴장 최고점에서 사용 (V-pedal → recap)

AXIOM 지원: `HarmonicColorCue.tag: "pedal_point"`

---

## 3. Modulation — 전조

### 3.1 전조 유형

| 유형 | 기법 | 거리 |
|------|------|------|
| **Diatonic pivot** | 두 조성 모두에 속하는 화음 사용 | 가까운 조성 |
| **Chromatic pivot** | 반음계적 화음을 공유 화음으로 | 먼 조성도 가능 |
| **Direct modulation** | 전환 화음 없이 직접 이동 | 반음 위아래 |
| **Sequential modulation** | 시퀀스를 통해 단계적 이동 | 3도 이동 가능 |
| **Enharmonic modulation** | 이명동음 화음 재해석 | 먼 조성 |

### 3.2 가까운 조성 (Closely Related Keys)

C장조 기준:
```
C장조 (I)
├── G장조 (V) — 가장 자주 사용 (exposition secondary key)
├── F장조 (IV) — 부드러운 전조
├── a단조 (vi) — 평행 단조
├── e단조 (iii) — 드문 편
└── d단조 (ii) — 매우 드문 편
```

소나타 형식 exposition의 표준: 장조 곡은 V조로, 단조 곡은 III조(평행 장조)로.

### 3.3 전조의 깊이 (Depth)

| 깊이 | 설명 | AXIOM 필드 |
|------|------|-----------|
| **Tonicization** | 전조 없이 일시적 조성화 (2–4마디) | `HarmonicColorCue` |
| **Local key area** | 섹션 내 비교적 짧은 다른 조성 (4–8마디) | `SectionPlan.tonalCenter` |
| **Sectional modulation** | 새 섹션이 다른 조성에 위치 | `SectionPlan.tonalCenter` 변경 |
| **Long-range modulation** | 전체 형식 계획에서 여러 조성 거침 | `LongSpanFormPlan` |

AXIOM: `ClassicalHarmonyKnowledge.modulationStrategy` = `"none"` | `"local_tonicization"` | `"sectional"` | `"long_range"`

---

## 4. Applied Dominant — 부속 도미난트

### 4.1 기본 원리

임시 조성화(tonicization): 다음에 올 화음을 임시 으뜸화음으로 취급, 그 V(⁷)를 먼저 연주.

```
C장조에서 ii 강조:
  … D7 → ii (= V⁷/ii → ii)

C장조에서 V 강조:
  … D⁷ → G (= V⁷/V → V)
```

### 4.2 자주 쓰이는 부속 도미난트

| 기호 | 해결 | 효과 |
|------|------|------|
| V/V (A장조 → G) | → V | 반 종지 강화, 개발부 추진력 |
| V/ii (A장조 → dm) | → ii | Pre-dominant 강조 |
| V/vi (E장조 → am) | → vi | 속임 종지(DC) 효과 |
| V/IV (C장조 → F) | → IV | 부드러운 plagal 강화 |

AXIOM: `HarmonicColorCue.tag: "applied_dominant"` + `keyTarget` 지정

---

## 5. Mixture — 조성 혼합

### 5.1 Modal Mixture (선법 혼합)

장조 곡에 단조 화음, 또는 그 반대:

```
C장조 곡에서 혼합 사용:
  iv  (F단조 iv → Fm: 어두운 색채)
  ♭VI (A♭장조: 낭만적, 서정적)
  ♭VII (B♭장조: 장엄함)
  ii° (D감화음: 긴장 강화)
```

### 5.2 Neapolitan Chord (나폴리 화음, ♭II⁶)

♭II⁶ = 반음 위 장조의 1전위화음:
- 역할: 강화된 pre-dominant, 특히 단조에서
- 해결: ii⁶ 역할로 V로 진행
- 느낌: 어둡고 극적, 낭만 초기 스타일

```
C단조: D♭장조⁶ → G⁷ → Cm
```

### 5.3 Augmented Sixth Chords (증6도 화음)

| 유형 | 구성 | 해결 |
|------|------|------|
| Italian (+6) | ♭6, 1, #4 | → V |
| French (+6) | ♭6, 1, 2, #4 | → V |
| German (+6) | ♭6, 1, ♭3, #4 | → V (평행 5도 주의) |

모두 강화된 pre-dominant. 낭만 스타일 느낌.

AXIOM: `HarmonicColorCue.tag` = `"mixture"` | `"neapolitan"` | `"aug6"`

---

## 6. Cadence Architecture — 종지 건축

단순한 종지 유형 이상으로, 종지가 형식 안에서 갖는 건축적 무게를 설계해야 한다.

### 6.1 Cadential 6/4 (카덴츠 제2전위)

가장 강한 PAC를 위한 준비:
```
ii⁶ → I⁶₄ → V⁷ → I
         ↑
    카덴츠 6/4: 베이스 G, 6도 E, 4도 C → 5-3 해결
```

I⁶₄는 V의 장식으로 기능. 도착 직전 긴장 최고점.

### 6.2 종지의 건축적 무게

| 위치 | 기대 종지 | 건축적 무게 |
|------|---------|----------|
| 전반절 끝 | HC | 낮음 |
| 후반절 끝 | PAC | 중간 |
| Exposition 끝 | PAC (V조) | 중간 |
| Development 끝 | HC (I조 복귀 준비) | 높음 |
| Recapitulation 끝 | PAC (I조) | 매우 높음 |
| Coda | PAC + plagal 옵션 | 최고 |

AXIOM `HarmonicPlan.cadence` + `LongSpanFormPlan` 조합으로 이 위계 설계.

---

## 7. 화성 리듬 (Harmonic Rhythm)

화성이 바뀌는 속도. 단조롭지 않아야 한다.

| 구간 | 권장 화성 리듬 | 효과 |
|------|-------------|------|
| 도입/제시 | 느림 (2–4마디당 1화음) | 안정, 주제 명확화 |
| Continuation | 빨라짐 (마디당 1–2화음) | 추진력 상승 |
| 개발 절정 | 빠름 | 긴장 최고점 |
| 재현부 복귀 | 다시 느려짐 | 안도감, 귀환 |
| 종지 구간 | I⁶₄-V⁷-I 공식 | 클리셰적이나 효과적 |

---

## 8. AXIOM 현재 구현 상태

| 개념 | 현재 지원 | 구현 위치 |
|------|---------|----------|
| 기능 화성 진행 | ✅ `buildFunctionalProgression()` | `src/core/plan/harmonyGrammar.ts` |
| Prolongation | ✅ `HarmonyGrammarPlan.prolongationMode` + `HarmonicPlan.prolongationMode` | `harmonyGrammar.ts`, `harmony.ts` |
| 전조 전략 | ✅ `modulationStrategy` + `TonicizationWindow` | `HarmonicPlan` |
| Applied dominant | ✅ `buildAppliedDominantCue()` + `HarmonicColorCue.tag="applied_dominant"` | `harmonyGrammar.ts` |
| Cadential 6/4 | ✅ `CadenceApproachTemplate="cad64"` at recap/cadence positions | `harmonyGrammar.ts` |
| 화성 리듬 제어 | ✅ `HarmonicRhythmShape` per section | `harmonyGrammar.ts` |
| Local tonicization | ✅ `suggestTonicizationWindow()` for development/bridge/theme_b | `harmonyGrammar.ts` |
| Mixture / Neapolitan / Aug6 | ✅ colorPalette 태그 | `HarmonicColorCue` |
| 금지 진행 검증 | ✅ `ClassicalHarmonyKnowledge.cadencePolicy` | `classicalKnowledge.ts` |

`applyHarmonyGrammarToSections(sections)` → `Map<sectionId, HarmonyGrammarPlan>` 형식으로
`materializeCompositionSketch()`에서 매 섹션에 자동 주석 처리됨.
