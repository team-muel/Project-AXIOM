# Reference Corpus Policy

## 목적

AXIOM의 self-training 루프는 AXIOM 내부 critic이 생성 데이터를 평가하고 그 평가 결과로 다시 모델을 훈련합니다.
이 루프는 강력하지만 **외부 기준 없이는 수렴 오류**를 일으킬 수 있습니다.

Reference Corpus Anchor는 Bach, Mozart, Beethoven, Chopin 등의 고전 작품 구조 통계를 기준점으로 삼아,
AXIOM 생성 곡이 고전 양식의 구조적 특성을 유지하고 있는지 검증합니다.

---

## 핵심 원칙: 구조 통계만, 선율 내용은 아님

**이 시스템은 저작권을 침해하지 않습니다.**

분석하는 것은 **구조적 통계**이며, 선율 내용(멜로디, 화성 진행 순서)은 추출하지 않습니다:

| 분석 항목 | 설명 |
|-----------|------|
| `meanPhraseLengthMeasures` | 평균 프레이즈 길이 (마디 수) |
| `phraseRegularity` | 프레이즈 길이 변동 계수 (CV) |
| `climaxPosition` | 음역 클라이맥스 위치 (0–1 정규화) |
| `pitchRangeSemitones` | 선율 음역 폭 (반음 수) |
| `meanPitchMidi` | 평균 선율 음높이 (MIDI 번호) |
| `leapSmoothness` | 순차 진행 비율 (≤2반음 이동 비율) |
| `meanNoteDensityPerMeasure` | 마디당 평균 음표 수 |
| `bassPresenceRatio` | MIDI 60 이하 음표 비율 (베이스 비율) |
| `harmonicRhythmProxy` | 마디당 평균 음계 음정류 수 (화성 리듬 대리 지표) |

1928년 이전 작품의 ABC 악보(IMSLP 등에서 공개 도메인으로 제공)를 사용하면 저작권 문제 없이
이 분석을 수행할 수 있습니다.

---

## referenceDistanceScore 해석

| 점수 구간 | 분류 | 의미 |
|-----------|------|------|
| < 0.10 | `too_close` | ⚠️ 코퍼스 중심에 비정상적으로 가까움 (복제 위험) |
| 0.10 – 0.75 | `in_range` | ✅ 건강한 고전 양식 범위 |
| > 0.75 | `too_far` | ⚠️ 고전 구조 양식에서 이탈 (idiom drift) |

- `too_close` (score < 0.10): 코퍼스 중심과 비정상적으로 가까운 경우입니다. 이는 매우 드물며,
  생성 곡이 레퍼런스 패턴을 지나치게 복제하고 있을 가능성을 나타냅니다.
- `in_range` (0.10–0.75): 정상 범위입니다. AXIOM 생성 곡이 고전 양식의 구조적 특성을 유지하고 있습니다.
- `too_far` (score > 0.75): 고전 구조 양식에서 크게 벗어났습니다.
  평균은 높아도 양식이 고전과 멀어지고 있다는 신호입니다.

**점수 계산 방식**: 각 9개 차원에서 후보 작품과 코퍼스 평균의 z-score를 계산하고,
RMS z-score를 3으로 나누어 0–1로 정규화합니다.

---

## 코퍼스 확장 로드맵

AXIOM Beethoven·Schubert lineage anchor의 신뢰도는 코퍼스 크기에 직접 비례합니다.

| 단계 | 목표 규모 | 용도 |
|------|-----------|------|
| Seed | ~19개 | 개발/검증용 seed. 통계 불안정. 운영 anchor 불가. |
| 초기 benchmark (현재 ✅) | 100개 이상 | R-01 gate 초기 안정화. promotion 참고 지표로 활용 가능. **현재 Beethoven 60개 + Schubert 59개 = 119개 달성.** |
| Gate 안정화 | 300–500개 | R-01 gate를 production promotion 필수 조건으로 격상 가능. |
| 장기 anchor | 1,000개 이상 | Serious identity anchor. 통계적으로 강건한 lineage 기준점. |

### Beethoven 우선 확장 대상

현재 **60개** (seed 10 + 확장 50). 다음 단계는 300개를 향한 추가 확장입니다:
- 피아노 소나타 추가 악장 (Adagio, Scherzo, Rondo 단독 excerpt)
- 변주곡 variation 개별 파트 (WoO/Op variation 단락)
- 현악 사중주 추가 작품 (Op.59/2, Op.74, Op.95, Op.130–133)
- 교향곡 주요 주제 (관현악 멜로디 성부, ABC 단성부 추출)
- 피아노 협주곡 솔로 파트 (Op.37, Op.58, Op.73)

### Schubert 우선 확장 대상

현재 **59개** (seed 9 + 확장 50). 다음 단계는 300개를 향한 추가 확장입니다:
- 즉흥곡 추가 variation 단락 (Op.90/142)
- 가곡 반주 피아노 성부 추가 (Die schöne Müllerin, Winterreise)
- 현악 사중주/5중주 (D887, D956)
- 교향곡 주요 주제 (D729, D759 Unfinished)
- 피아노 이중주 (D940, D812)

### 코퍼스 확장 실행 방법

1. ABC 파일을 `config/reference-corpus/abc/` 에 추가
2. `npm run analyze:reference-corpus` 재실행 → `outputs/_system/reference-corpus/profile.json` 갱신
3. `npm run validate:aesthetic-evaluators` 실행 → Beethoven/Schubert 변별력 지표 확인
4. 프로파일을 Git에 커밋

---

## 파일 완결성 분류 (corpus-file-index.json)

### 세 가지 완결성 수준

코퍼스 파일은 세 가지 완결성 수준으로 분류됩니다. **referenceDistanceScore는 `complete_piece`와 `complete_movement`에서만 유효합니다.**

| 분류 | 정의 | 사용 가능 메트릭 |
|------|------|-----------------|
| `complete_piece` | 자기완결적인 짧은 소품 (바가텔, 왈츠, 무곡, 에코세즈 등) | climaxPosition, phraseDistribution, pitchRange, referenceDistanceScore |
| `complete_movement` | 대형 작품의 완전한 1개 악장 (소나타 악장, 즉흥곡 전체 등). 50마디 이상 | climaxPosition, phraseDistribution, pitchRange, referenceDistanceScore |
| `excerpt` | 더 긴 작품의 일부 발췌 (8–20마디 opening, 주제 선율, 도입부 등) | pitchRange, noteDensity, harmonicColor, leapSmoothness, motifIncipit, openingGesture |

### excerpt를 referenceDistanceScore에 쓰면 안 되는 이유

| 메트릭 | excerpt에서의 문제 |
|--------|-------------------|
| `climaxPosition` | 짧은 excerpt는 전체 곡의 클라이맥스를 포함하지 않음 |
| `phraseDistribution` | 8–12마디 fragment는 전체 프레이즈 구조를 대표하지 않음 |
| `formalReturn` | 재현부가 없음 |
| `referenceDistanceScore` | 위 메트릭들을 종합하므로, excerpt에서 계산하면 노이즈 값 |

### corpus-file-index.json 위치

```
config/reference-corpus/
  corpus-file-index.json      ← 파일별 completeness 메타데이터
  corpus-manifest.json        ← 코퍼스 taxonomy (composer roles)
  abc/
    beethoven/...
    schubert/...
```

### 스크립트 동작 방식

- `analyze-reference-corpus.mjs`: index 로드 시 `excerpt` 파일을 primary/lineage group에서 **자동 제외**
- `validate-aesthetic-evaluators.mjs`: index 로드 시 `excerpt` 파일을 변별력 검증에서 **자동 제외** (--all-files 플래그로 해제 가능)
- `perFile` 배열에는 모든 파일이 포함됨 (local technique 분석용)

### 현재 corpus 완결성 상태 (119개 기준)

| 작곡가 | complete_piece | complete_movement | excerpt |
|--------|---------------|-------------------|---------|
| Beethoven (60개) | ~25 (무곡류, 변주 주제, 소나티나) | 1 (소나티나) | ~34 (소나타 Opening, 사중주 등) |
| Schubert (59개) | ~24 (왈츠, 에코세즈, 앙글레즈, 모멘트 뮤지칼) | 0 | ~35 (소나타 Opening, 즉흥곡 단편, 가곡 선율) |

> 현재 **complete_piece + complete_movement** 기준으로 약 50개가 유효한 referenceDistanceScore 소스입니다.
> 진정한 100개 complete_piece/movement anchor 달성을 위해서는 소나타 악장 전체 파일 추가가 필요합니다.

---



### 1. ABC 파일 수집

공개 도메인 악보를 ABC 형식으로 구하는 방법:
- **IMSLP** (imslp.org): 1928년 이전 작품들의 악보 PDF. ABC 파일은 별도 도구로 변환 필요.
- **abc.sourceforge.net** / **abcnotation.com**: 클래식 작품 ABC 아카이브.
- **tune archives**: Irish/Scottish traditional + classical 혼합 아카이브. 클래식 필터링 필요.

권장 작곡가:
- Johann Sebastian Bach (바로크)
- Wolfgang Amadeus Mozart (고전)
- Ludwig van Beethoven (고전–낭만 전환기)
- Frédéric Chopin (낭만)
- Johannes Brahms (낭만)
- Franz Schubert (낭만)

권장 장르:
- 피아노 소나타, 프렐류드, 녹턴, 미뉴에트, 소나타 악장

### 2. 파일 배치

```
config/reference-corpus/
  abc/
    bach_bwv772_invention1.abc
    bach_bwv773_invention2.abc
    mozart_k331_menuetto.abc
    chopin_op28_no7.abc
    ...
  corpus-profile.json   ← 분석 결과 (자동 생성)
```

### 3. 코퍼스 분석 실행

```bash
node scripts/analyze-reference-corpus.mjs \
  --corpus-dir=config/reference-corpus/abc \
  --out=config/reference-corpus/corpus-profile.json \
  --verbose
```

최소 **8–12개 이상**의 작품을 포함하는 것을 권장합니다.
장르 다양성이 있어야 특정 양식에 편향되지 않습니다.

---

## Adapter Promotion Gate 연동

`referenceDistanceScore`는 adapter promotion gate R-01에서 사용됩니다.

**개발/레거시 호환 모드 (기본)**:
- candidate rows에 `referenceDistanceScore`가 없으면 R-01을 경고와 함께 **skip** 합니다.
- 이전 benchmark 파일과 호환됩니다.

**프로덕션 모드 (`--require-reference-distance`)**:
- candidate rows에 `referenceDistanceScore`가 없으면 R-01이 **FAIL**합니다.
- 프로덕션 promotion CI에서 사용합니다. benchmarking 인프라가 이 필드를 안정적으로 생성한 후 활성화하세요.

```bash
# 개발/검증용 (기본)
npm run evaluate:notagen-adapter-promotion:with-corpus

# 프로덕션 promotion (referenceDistanceScore 필수)
npm run evaluate:notagen-adapter-promotion:production
```

코퍼스가 100개 이상으로 확장되면 `:production` 스크립트를 기본 promotion gate로 승격할 것을 권장합니다.

---

## 갱신 주기

코퍼스 프로파일(`corpus-profile.json`)은 다음 경우에 재생성합니다:
1. 새 ABC 파일을 코퍼스에 추가했을 때
2. 코퍼스 디렉토리의 파일이 변경되었을 때
3. 분기별 정기 검토 시

`corpus-profile.json`은 Git에 커밋하여 promotion gate가 일관된 기준을 사용하도록 합니다.

---

## 한계와 주의사항

1. **ABC 파서 한계**: 현재 파서는 단성부 중심입니다. 다성부 ABC에서는 성부 1을 기준으로 분석합니다.
2. **장르 편향**: 코퍼스가 특정 장르(예: 피아노 소나타만)로 편중되면 다른 장르 생성 시 too_far로 분류될 수 있습니다.
3. **절대 거부 기준 아님**: `too_far` 분류 자체가 promotion 거부 조건이 아닙니다. 트렌드를 모니터링하는 신호입니다.
4. **내부 critic 보완재**: 이 지표는 AXIOM 내부 critic을 *대체하지 않습니다*. 외부 기준점으로서 critic이 놓칠 수 있는 양식 이탈을 감지하는 보완 장치입니다.
