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

| 명령 | 산출물 | 용도 |
|------|--------|------|
| `npm run ml:export:structure-rank` | `structure_rank_v1` snapshot | structure reranker 학습 |
| `npm run ml:export:backbone-piece` | `axiom_backbone_piece_v1` | learned backbone fine-tune |
| `npm run ml:export:localized-rewrite` | `axiom_localized_rewrite_v1` | targeted rewrite 학습 |
| `npm run ml:export:notagen-preferences` | preference pairs | NotaGen 계열 preference fine-tune |
| `npm run ml:export:notagen-sft` | SFT examples | NotaGen 계열 SFT |

---

## Review Workflow

### Manifest Review (learned backbone)

```bash
# pending run → worksheet 생성
npm run ml:manifest-review:learned-backbone -- --snapshot <sheet>

# worksheet 작성 후 (approvalStatus 열 채우기) ingest
npm run ml:manifest-review:record:learned-backbone -- --resultsFile outputs/_system/ml/review-manifests/learned-backbone/<sheet>/review-sheet.csv
```

`source=autonomy` row는 기존 approve/reject service를 통해 operator audit trail + preferences humanFeedbackSummary 갱신.  
`source=api` row는 manifest만 직접 갱신 (autonomy preference memory 오염 방지).

### Blind A/B Review (learned backbone)

```bash
# music21 vs learned_symbolic candidate를 blind A/B MIDI pack으로 복사
npm run ml:review-pack:learned-backbone -- --snapshot <pack>

# 청취 후 review-sheet.csv 작성 → ingest
npm run ml:review-pack:record:learned-backbone
```

---

## Shadow Reranker

**Shadow mode:** 실제 선택에는 영향 없이 reranker 점수를 병렬 기록.

```bash
# shadow scoring 실행
npm run ml:shadow:structure-rank -- --snapshot <snapshot>

# 24시간 창 disagreement 요약
npm run ml:shadow:structure-rank:runtime-summary -- --windowHours 24
```

---

## Summary Tools

```bash
npm run ml:summarize:learned-backbone   # narrow learned lane 벤치마크 요약
npm run ml:summarize:truth-plane        # dataset snapshot manifest, tier counts, split leakage 점검
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
