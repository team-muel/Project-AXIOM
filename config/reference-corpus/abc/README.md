# Reference Corpus ABC Files

이 디렉토리에는 고전음악 레퍼런스 코퍼스의 ABC 악보 파일을 넣습니다.

## 목적

AXIOM self-training collapse 방지용 anchor입니다.  
AXIOM이 생성한 곡을 이 코퍼스의 구조 통계와 비교하여, 자기 critic에만 최적화되는 것을 감지합니다.

분석하는 것은 **구조 통계**만입니다 — 선율 내용(멜로디 자체)은 추출하지 않습니다.  
저작권 문제 없이 사용하려면 **1928년 이전** 공개 도메인 작품을 사용하세요.

## 권장 수집 작곡가

| 작곡가 | 추천 작품 유형 |
|--------|----------------|
| J.S. Bach | 인벤션, 평균율 프렐류드, 피아노 파르티타 |
| W.A. Mozart | 피아노 소나타, 피아노 협주곡 느린 악장 |
| L.v. Beethoven | 피아노 소나타 (Op. 2–28) |
| F. Chopin | 야상곡, 전주곡, 왈츠 |
| J. Brahms | 인터메조 (Op. 76, 117, 118, 119) |
| F. Schubert | 피아노 즉흥곡, 악흥의 순간 |

## ABC 파일 수집 방법

1. **IMSLP** (imslp.org) — 공개 도메인 PDF 악보  
   PDF → ABC 변환 도구: `pdf2abc`, `MuseScore` + abc 플러그인, `music21`
2. **The Session** (thesession.org) — 민요/전통음악 ABC 직접 제공  
   (고전 피아노 스타일과 다를 수 있음)
3. **ABC Notation** (abcnotation.com) — 공개 ABC 파일 모음

## 파일 수 권장

최소 **10개** 이상. 권장 **20–50개**. 분석 정확도는 파일 수에 비례합니다.

## 코퍼스 프로파일 생성

ABC 파일을 이 디렉토리에 추가한 후:

```bash
npm run analyze:reference-corpus
```

또는 상세 출력:

```bash
npm run analyze:reference-corpus:dry-run
```

결과는 `config/reference-corpus/corpus-profile.json`에 저장됩니다.

## Adapter Promotion Gate 연동

```bash
npm run evaluate:notagen-adapter-promotion:with-corpus
```

이 명령은 promotion gate에 `--corpus-profile=config/reference-corpus/corpus-profile.json`을 추가하여  
R-01 (referenceDistanceScore) gate를 활성화합니다.

R-01 gate:
- `too_far` 비율 > 50% → 게이트 실패 (idiom drift)
- `too_close` 비율 > 30% → 경고 (copy risk)
- 코퍼스 파일 없거나 candidate 행에 `referenceDistanceScore` 없으면 → skip (무해)
