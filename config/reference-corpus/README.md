# Reference Corpus

이 디렉토리는 AXIOM reference corpus anchor의 루트입니다.

## 구조

```
config/reference-corpus/
├── README.md              ← 이 파일
├── abc/                   ← ABC 악보 파일 (*.abc) — 오퍼레이터가 직접 추가
│   └── README.md          ← ABC 파일 수집 방법 안내
└── corpus-profile.json    ← analyze:reference-corpus로 생성 (git 추적 안 됨)
```

## 사용법

1. `abc/` 디렉토리에 공개 도메인 고전 피아노 ABC 파일 추가 (최소 10개 권장)
2. `npm run analyze:reference-corpus` 실행 → `corpus-profile.json` 생성
3. `npm run evaluate:notagen-adapter-promotion:with-corpus` 실행 → R-01 gate 활성화

자세한 내용은 `docs/reference-corpus-policy.md`를 참조하세요.
