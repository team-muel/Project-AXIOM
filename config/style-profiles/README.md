# config/style-profiles

AXIOM 미학 정체성(aesthetic identity) 프로파일 저장 디렉터리.

## 파일 목록

| 파일 | 상태 | 설명 |
|------|------|------|
| `axiom_beethoven_schubert_v1.json` | **active** | AXIOM v1 핵심 정체성. 베토벤·슈베르트 중심 |

## 스키마

```jsonc
{
  "id": "string",            // 고유 식별자
  "version": "string",       // 버전 태그
  "status": "active|draft",  // 운영 상태
  "primaryInfluences": [     // 정체성의 핵심 작곡가 (weight 합계 ≈ 1.0)
    {
      "composer": "...",           // NotaGen composer ID
      "weight": 0.0–1.0,
      "formRouting": "structural|lyrical",  // resolveLane 라우팅 힌트
      "traits": ["..."],           // 핵심 음악적 특성 목록
      "formExamples": ["..."]      // 이 작곡가로 라우팅되는 악곡 형식
    }
  ],
  "generalTheorySources": ["..."],  // 기술 교과서용 작곡가 (정체성 아님)
  "avoidAsPrimaryIdentity": ["..."] // 섞으면 정체성 희석되는 것들
}
```

## 역할 분리 원칙

| 역할 | 작곡가 | 사용 목적 |
|------|--------|-----------|
| 1차 정체성 | Beethoven, Schubert | 실제 작곡 DNA |
| 기술 참조 | Bach, Mozart/Haydn, Chopin, Brahms | 이론·기법 교과서 |
| 미래 참조 | Rachmaninoff, Schumann | v2+ 후보, 현재 섞지 않음 |
| 제외 | Debussy, Liszt, 낭만 평균 | 정체성 희석 위험 |

## 코드 연결

- **로더**: `src/core/identity/axiomStyleIdentity.ts` → `loadStyleIdentityProfile()`
- **라우팅**: `src/core/composer/learnedNotagenAdapter.ts` → `resolveComposerIdentity()`
- **레퍼런스 코퍼스 연결**: `config/reference-corpus/corpus-manifest.json`
