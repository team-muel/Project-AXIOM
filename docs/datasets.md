# Datasets

AXIOM은 매 실행 산출물을 자동으로 학습 데이터 후보로 저장한다. 별도 export 단계 없이 truth-plane이 누적된다.

---

## 자동 수집 데이터

### Candidate Sidecar

**경로:** `outputs/{songId}/candidates/`

매 symbolic attempt의 MIDI + 평가 점수를 저장. 선택/기각 이유를 함께 기록.

```
outputs/{songId}/candidates/
├── index.json                         선택된 candidate ID, 선택 이유
└── {candidateId}/
    ├── candidate-manifest.json        구조 평가 점수
    ├── section-artifacts.json         섹션별 실현 지표
    ├── composition.mid                candidate MIDI
    └── reranker-score.json            shadow reranker 점수 (있을 때)
```

### Section Artifacts

**경로:** `outputs/{songId}/section-artifacts.json`

섹션별 실현 지표: phrase breath, harmonic realization, tempo motion, ornament realization, 피아노 연주성 21개 지표.

### Manifest

**경로:** `outputs/{songId}/manifest.json`

`structureEvaluation`, `audioEvaluation`, `qualityControl.attempts[]`, `approvalStatus`, `reviewFeedback` 포함. 전체 실행 기록.

### Autonomy Preferences

**경로:** `outputs/_system/preferences.json`

승인된 실행에서 추출한 학습 편향:
- `motifReturnPatterns` — 동기 복귀 타이밍
- `tensionArcPatterns` — 긴장감 곡선
- `cadenceApproachPatterns` — 종지 접근 방식
- `registerCenterPatterns` — 레지스터 중심
- `sectionStylePatterns` — 섹션별 스타일
- `humanFeedbackSummary` — 승인/반려 시 기록된 review feedback 집계

이 preferences는 다음 실행의 `sketch.ts` → `CompositionPlan`에 bias로 반영된다.

---

## Export Scripts

> `npm run ml:*` 단축 명령은 `package.json`에 없습니다. `node scripts/...` 로 직접 실행하세요.  
> 자세한 내용은 [`docs/ops.md`](ops.md)를 참조하세요.

| 스크립트 | 산출물 | 실행 명령 |
|----------|--------|-----------|
| `export-structure-reranker-dataset.mjs` | structure reranker 학습용 snapshot | `node scripts/export-structure-reranker-dataset.mjs` |
| `export-backbone-piece-dataset.mjs` | learned backbone fine-tune용 피스 데이터 | `node scripts/export-backbone-piece-dataset.mjs` |
| `export-localized-rewrite-dataset.mjs` | targeted rewrite 학습용 pair | `node scripts/export-localized-rewrite-dataset.mjs` |
| `export-notagen-preference-dataset.mjs` | NotaGen preference fine-tune용 pair | `node scripts/export-notagen-preference-dataset.mjs` |
| `export-notagen-sft-dataset.mjs` | NotaGen SFT 예제 | `node scripts/export-notagen-sft-dataset.mjs` |

---

## Review Workflow

런타임이 자동으로 기록하는 항목:
- `outputs/{songId}/candidates/` — candidate sidecar (선택/기각 이유 포함)
- `outputs/_system/preferences.json` — autonomy preference 누적
- `outputs/_system/operator-actions/` — operator audit trail

수동 manifest review 스크립트:

```bash
# manifest review 시트 생성
node scripts/create-learned-backbone-manifest-review-sheet.mjs

# review 팩 생성 (song 묶음 검토용)
node scripts/create-learned-backbone-review-pack.mjs

# manifest review 기록
node scripts/record-learned-backbone-manifest-review.mjs

# review 결과 기록
node scripts/record-learned-backbone-review-result.mjs
```

---

## Shadow Reranker

Shadow mode: 실제 선택에는 영향 없이 reranker 점수를 병렬 기록.

```bash
# shadow 점수 평가 실행
node scripts/evaluate-structure-reranker-shadow.mjs

# shadow review 증거 캡처
node scripts/capture-shadow-review-evidence.mjs

# shadow review 스캐폴딩
node scripts/scaffold-shadow-review.mjs
```

---

## Summary Tools

```bash
# truth-plane 데이터셋 스냅샷 요약
node scripts/summarize-truth-plane-dataset-snapshot.mjs

# structure shadow 런타임 요약
node scripts/summarize-structure-shadow-runtime.mjs

# learned backbone 벤치마크 요약
node scripts/summarize-learned-backbone-benchmark.mjs

# 운영 요약 출력
node scripts/print-operator-summary.mjs
```

---

## Dataset Design Principles

1. **Truth-plane first** — 학습 row는 persisted file만으로 재구성 가능해야 한다.
2. **Provenance** — 모든 row는 source artifact 경로와 review tier를 포함한다.
3. **Group integrity** — candidate group과 retry family는 train/test split에서 같은 쪽에 있어야 한다.
4. **Review beats heuristics** — 인간 승인과 pairwise preference가 heuristic score보다 우선한다.
5. **Near-miss 포함** — 기각된 retry와 비선택 candidate도 dataset에 남겨야 한다.

---

## Scope

수집 대상:
- `outputs/{songId}/manifest.json`
- `outputs/{songId}/section-artifacts.json`
- `outputs/{songId}/expression-plan.json`
- `outputs/{songId}/candidates/**`
- `outputs/_system/operator-actions/**`
- `outputs/_system/ml/runtime/structure-rank-v1-shadow-history/**`

수집 대상 아님:
- 외부 공개 도메인 코퍼스 직접 패키징
- symbolic / candidate 증거 없는 audio-only 프롬프트 로그
