# Reference Corpus ABC Files

이 디렉토리에는 고전음악 레퍼런스 코퍼스의 ABC 악보 파일을 넣습니다.

## 목적

AXIOM self-training collapse 방지용 anchor입니다.  
AXIOM이 생성한 곡을 이 코퍼스의 구조 통계와 비교하여, 자기 critic에만 최적화되는 것을 감지합니다.

분석하는 것은 **구조 통계**만입니다 — 선율 내용(멜로디 자체)은 추출하지 않습니다.  
저작권 문제 없이 사용하려면 **1928년 이전** 공개 도메인 작품을 사용하세요.

## 작곡가 분류 규칙 ⚠

파일 이름 prefix가 `corpus-manifest.json`의 taxonomy에 매핑됩니다.

| Prefix | 분류 | 역할 |
|--------|------|------|
| `beethoven_` | **Primary** | AXIOM 미학 DNA. R-01 gate에 사용. |
| `schubert_` | **Primary** | AXIOM 미학 DNA. R-01 gate에 사용. |
| `bach_` | Technical: counterpoint | 대위법 기술 교과서. 정체성 아님. |
| `mozart_` | Technical: classical_proportion | 고전 비례 기술 교과서. 정체성 아님. |
| `chopin_` | Technical: piano_idiom | 피아노 텍스처 교과서. 정체성 아님. |
| `brahms_` | Technical: motivic_density_reference | 동기 밀도 비교 기준. 정체성 아님. |

> **중요**: Beethoven과 Schubert 파일만 `primary` 그룹에 들어갑니다.  
> 다른 작곡가를 primary에 섞으면 R-01 gate가 흐려집니다.  
> 새 작곡가를 추가하려면 먼저 `corpus-manifest.json`의 `technical` 섹션에 역할을 정의하세요.

## 권장 수집 작곡가

### Primary (AXIOM 정체성 — 더 많을수록 좋음)

| 작곡가 | 추천 작품 |
|--------|-----------|
| L.v. Beethoven | 피아노 소나타 (Op. 2–28), Bagatelles |
| F. Schubert | 피아노 즉흥곡 (Op. 90, 142), Moments Musicaux, Impromptus |

### Technical (기술 교과서 — 3~5개 충분)

| 작곡가 | 추천 작품 | 역할 |
|--------|-----------|------|
| J.S. Bach | 인벤션, 평균율 프렐류드 | counterpoint |
| W.A. Mozart | 피아노 소나타, 미뉴에트 | classical_proportion |
| F. Chopin | 야상곡, 전주곡, 왈츠 | piano_idiom |
| J. Brahms | 인터메조 (Op. 117, 118, 119) | motivic_density_reference |

## ABC 파일 수집 방법

1. **IMSLP** (imslp.org) — 공개 도메인 PDF 악보  
   PDF → ABC 변환: `MuseScore` + abc 플러그인, `music21`
2. **ABC Notation** (abcnotation.com) — 공개 ABC 파일 모음

## 파일 수 권장

- Primary (Beethoven/Schubert): **최소 5개**, 권장 **10+개**
- Technical 각 역할: 3~5개 충분

## 코퍼스 프로파일 생성

```bash
npm run analyze:reference-corpus
```

또는 상세 출력:

```bash
npm run analyze:reference-corpus:dry-run
```

결과는 `config/reference-corpus/corpus-profile.json`에 저장됩니다.  
`primary` 섹션이 있는 경우 R-01 게이트가 해당 섹션만 사용합니다.

## Adapter Promotion Gate 연동

```bash
npm run evaluate:notagen-adapter-promotion:with-corpus
```

R-01 gate:
- `too_far` 비율 > 50% → 게이트 실패 (idiom drift from Beethoven/Schubert)
- `too_close` 비율 > 30% → 경고 (copy risk)
- 코퍼스 파일 없거나 candidate 행에 `referenceDistanceScore` 없으면 → skip (무해)
