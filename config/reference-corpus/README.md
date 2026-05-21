# Reference Corpus

이 디렉토리는 AXIOM reference corpus anchor의 루트입니다.

## AXIOM 미학 정체성 분류

corpus는 **Primary** (정체성 DNA)와 **Technical** (기술 교과서) 두 계층으로 분리됩니다.

| 분류 | 작곡가 | 역할 |
|------|--------|------|
| **Primary** (R-01 anchor) | Beethoven, Schubert | AXIOM의 핵심 미학 DNA. referenceDistanceScore 측정 기준. |
| Technical: counterpoint | Bach | 대위법·성부 독립성 기술 교과서. 정체성 아님. |
| Technical: classical_proportion | Mozart | 프레이즈 균형·고전 비례 기술 교과서. 정체성 아님. |
| Technical: piano_idiom | Chopin | 피아노 텍스처·음형 기술 교과서. 정체성 아님. |
| Technical: motivic_density_ref | Brahms | 동기적 밀도 비교 기준. 현재 정체성 아님. |

> **왜 분리하는가?** 모든 작곡가를 하나의 global 평균으로 섞으면 베토벤·슈베르트 특성이 희석됩니다.
> R-01 게이트는 Primary 프로파일만 사용합니다.
> `corpus-manifest.json`이 이 분류를 선언합니다.

## 구조

```
config/reference-corpus/
├── README.md              ← 이 파일
├── corpus-manifest.json   ← 작곡가 taxonomy 선언 (primary/technical 분리)
├── abc/                   ← ABC 악보 파일 (*.abc)
│   └── README.md          ← ABC 파일 수집 방법 안내
└── corpus-profile.json    ← analyze:reference-corpus로 생성 (git 추적 안 됨)
```

## 사용법

1. `abc/` 디렉토리에 공개 도메인 고전 피아노 ABC 파일 추가 (최소 10개 권장)
2. `npm run analyze:reference-corpus` 실행 → `corpus-profile.json` 생성
3. `npm run evaluate:notagen-adapter-promotion:with-corpus` 실행 → R-01 gate 활성화

자세한 내용은 `docs/reference-corpus-policy.md`를 참조하세요.
