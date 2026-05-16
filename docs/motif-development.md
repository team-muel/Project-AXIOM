# Motif Development — 동기 발전

동기(motif)는 작품 전체를 통해 기억되고 변형되는 가장 짧은 음악적 아이디어다. 3–8개 음표로 이루어진 선율 또는 리듬 패턴으로, 반복과 변형을 통해 작품의 통일성과 다양성을 동시에 만든다.

---

## 1. 동기의 조건

좋은 동기는:
1. **기억 가능해야 한다** — 청자가 변형 후에도 원형을 알아볼 수 있을 것
2. **변형 가능해야 한다** — 너무 단순하거나 너무 복잡하면 발전이 어려움
3. **음정 윤곽이 뚜렷해야 한다** — 도약(leap)이나 특이한 반음 진행이 포함되면 식별성 높음

AXIOM `MotifDraft`:
```typescript
interface MotifDraft {
  pitches?: number[];        // MIDI 반음 단위, 예: [0, 2, 4, 5] = do-re-mi-fa
  rhythm?: number[];         // 음표 길이, 예: [0.5, 0.5, 0.5, 0.5] = 4분음표×4
  sectionIds?: string[];     // 등장할 섹션
  transformPolicy?: MotifTransformPolicy;
}
```

---

## 2. 기본 변형 기법

### 2.1 Repetition — 반복

가장 기본적 단위. 변형 없는 원형 반복.

- **정확 반복 (Exact repetition)**: 동일 조성, 동일 리듬, 동일 음역
- **조성 내 반복 (Tonal repetition)**: 같은 음정 구조이나 조성 내 위치만 다름

원칙:
- 반복은 두 번 이상 연속하면 청자가 기억 가능
- 세 번 이상 변형 없이 반복하면 단조로움 위험
- 반복 후에는 반드시 variation 또는 continuation이 따라야 함

```
[동기 A] → [동기 A] → [동기 A'] (변형 반복)
```

### 2.2 Sequence — 시퀀스

동기를 일정한 음정 간격으로 반복 이동.

**Diatonic sequence (다이아토닉 시퀀스):**
```
C-E-G → D-F-A → E-G-B (2도 상행 시퀀스)
```

**Chromatic sequence (반음계 시퀀스):**
```
E-G#-B → F-A-C → F#-A#-C# (반음 상행, 긴장 증가)
```

**Real sequence**: 정확한 음정 유지 (반음계 사용 가능)
**Tonal sequence**: 조성 안에서만 이동 (음정 크기 약간 변형)

시퀀스는 개발부(development)의 핵심 기법:
- 방향성 제공 (상행 → 긴장 증가, 하행 → 이완)
- 한 번에 3회 이상 반복하면 기계적으로 들릴 수 있음
- 마지막 시퀀스를 카덴츠로 연결

### 2.3 Fragmentation — 단편화

동기의 일부만 분리해서 독립적으로 사용. 개발부에서 가장 중요한 기법.

```
원형 동기:  A B C D
단편화:       B C     (중간부 사용)
             A B      (앞부분만)
                 C D  (뒷부분만)
```

단편화 + 시퀀스 조합이 개발부의 표준 공식:
```
[원형 A B C D] → [B C 시퀀스↑] → [B 시퀀스↑↑] → [최소 단위 밀집] → [V-pedal] → [recap]
```

AXIOM `transformPolicy: "fragment"` + 이후 시퀀스로 연결.

### 2.4 Inversion — 전위 (뒤집기)

음정 방향을 반대로:

```
원형:   C → E → G (상행 3도, 상행 3도)
전위:   C → A → F (하행 3도, 하행 3도)
```

**Strict inversion (엄격 전위)**: 음정 크기까지 정확히 반전 (반음 단위)
**Tonal inversion (조성 전위)**: 방향만 반전, 조성 내 음도 유지

효과: 원형과 대조적인 느낌이면서도 원형임을 알아볼 수 있음.

### 2.5 Retrograde — 역행 (뒤에서부터)

동기를 거꾸로 연주. 청자가 알아채기 어렵기 때문에 단독보다 다른 변형과 조합:

```
원형:   C D E F
역행:   F E D C
```

청자 인식성이 낮아서 독립 사용보다는 retrofgrade inversion (역행 전위)로 더 자주 사용.

### 2.6 Augmentation — 확대 (느리게)

음표 길이를 2배 (또는 그 이상)로 늘림. 같은 동기가 더 장엄하고 느리게.

```
원형:   ♩♩♩♩  (4분음표 × 4)
확대:   𝅗𝅥 𝅗𝅥 𝅗𝅥 𝅗𝅥  (2분음표 × 4, 2배 확대)
```

코다에서 원형 동기를 확대하면 "기억 속의 주제" 느낌. 재현부나 코다에 자주 사용.

### 2.7 Diminution — 축소 (빠르게)

음표 길이를 절반으로 줄임. 에너지와 긴장 증가.

```
원형:   ♩♩♩♩  (4분음표 × 4)
축소:   ♪♪♪♪♪♪♪♪  (8분음표 × 8)
```

개발부의 클라이맥스 직전, 재현부 직전 긴장 최고조에 사용.

---

## 3. 화성적 변형 기법

### 3.1 Revoicing — 성부 재배치

동기의 음높이는 같지만 옥타브 위치, 성부 배분을 바꿈:
- 소프라노에서 베이스로 이동
- 폐쇄 배치 → 개방 배치

### 3.2 Reharmonization — 재화성화

같은 선율 동기에 다른 화성을 붙임:

```
원형 선율: C E G
원형 화성: I (C major triad)
재화성화:  vi7 (Am7 = C E G A) → 같은 선율, 다른 색채
```

AXIOM `HarmonicColorCue`로 섹션별 재화성화 지시 가능.

---

## 4. Recap Identity — 재현 식별성

### 4.1 청자가 recap을 인식하는 조건

재현은 단순한 반복이 아니다. 청자가 "아, 돌아왔다"고 느껴야 한다:

1. **음정 윤곽 보존**: 원형의 위-아래 방향이 같아야 함
2. **리듬 특성 보존**: 독특한 리듬 패턴 (점음표, 싱코페이션 등) 유지
3. **시작 음정 또는 도약 보존**: 처음 1–2음이 같으면 인식성 높음
4. **조성 복귀**: 원조(main key)로 복귀, 이것 자체가 강력한 신호

### 4.2 Varied Recap (변형 재현)

정확한 재현이 아니라 약간 변형된 재현:
- `octave displacement`: 옥타브 위/아래에서 재현
- `harmonic enrichment`: 더 풍부한 화성으로 재현
- `texture change`: 재현부에서 오케스트레이션 변경
- `extension`: 재현부 마지막에 코다 추가

### 4.3 False Recap (거짓 재현)

개발부 중간에 주제처럼 들리지만 엉뚱한 조성에서 나타나는 것. 기대를 어기고 긴장 유지.

```
C장조 소나타 개발부에서:
  … [E장조에서 주제 A 시작] → 청자: "재현부?!" → 다시 발전 → 진짜 C장조 재현
```

### 4.4 AXIOM 동기 추적 요구사항

현재 AXIOM은 recap에서 동기가 실제로 복귀했는지 검증하지 않는다.

필요한 검증:
```
1. exposition에서 동기 A 등록 (pitch contour + rhythm signature)
2. recap 섹션에서 동기 A 탐색
3. 유사도 점수 계산
4. 임계값 미달이면 "motifReturnScore" 감점
```

---

## 5. 동기 발전 설계 워크플로우

AXIOM이 동기를 계획하고 실행할 때의 권장 흐름:

```
1. Exposition: 동기 A + B 도입
   - A: 주제1 (theme_a 섹션)
   - B: 주제2 (theme_b 섹션, 대조적)

2. Development 계획:
   - fragmentation: A의 첫 2음 + 시퀀스 상행
   - inversion: A 전위로 새로운 긴장
   - B fragment + A fragment 대화

3. Retransition:
   - V-pedal 위에서 A 단편 조각 반복 (diminution)
   - 재현부 암시

4. Recapitulation:
   - A 원형 복귀 (주조)
   - B 원형 복귀 (주조 — exposition의 부조에서 복귀)
   - A 확대(augmentation)로 코다
```

---

## 6. AXIOM 현재 구현 상태

| 개념 | 현재 지원 | 목표 |
|------|---------|------|
| 동기 등록 | ✅ `MotifDraft[]` | pitch contour 자동 추출 |
| 반복 | ✅ `transformPolicy: "repeat"` | 횟수 제한 추가 |
| 시퀀스 | ✅ `transformPolicy: "sequence"` | 방향/거리 지정 |
| 단편화 | ✅ `transformPolicy: "fragment"` | 사용 부분 명시 |
| 전위 | ✅ `transformPolicy: "inversion"` | strict/tonal 구분 |
| 확대/축소 | ❌ | `augmentation`, `diminution` 추가 |
| 재화성화 | ❌ | `reharmonize` 옵션 |
| Recap 식별성 검증 | ❌ | pitch contour 비교 + `motifReturnScore` |
| False recap 감지 | ❌ | 조성 확인 후 분류 |
