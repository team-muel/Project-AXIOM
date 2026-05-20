# Adapter Promotion Policy

새 NotaGen adapter는 **frozen benchmark gate를 통과해야만** production/default adapter로 승격된다.

훈련이 완료되었다는 사실 자체가 승격 근거가 아니다.

---

## 왜 Promotion Gate가 필요한가

AXIOM critic이 self-training 루프의 주 gating 신호이기 때문에,  
critic이 놓친 결함이 축적되면 adapter는 **점진적으로 degradation**된다.

| 패턴 | 증상 | 결과 |
|------|------|------|
| 평균 점수 상승 + stddev 붕괴 | 모든 곡이 비슷해짐 (mode collapse) | 다양성 소멸 |
| 피아노 점수 상승 + motif 점수 하락 | 이디엄은 개선, 구조 퇴화 | 단기 개선, 장기 붕괴 |
| 화성 점수 상승 + motif 회귀 실종 | 화성이 안정적이지만 주제 발전 없음 | 유사 곡 양산 |

Promotion gate는 이 패턴들을 **수치로 차단**한다.

---

## Gate 구조

```
candidate adapter
        │
        ▼
┌─────────────────────────────────────────────────┐
│  Frozen benchmark set                           │
│  (동일한 prompts, baseline과 candidate 모두에  │
│   동일하게 적용)                                │
└─────────────────────────────────────────────────┘
        │
        ▼
evaluate-notagen-adapter-promotion.mjs
        │
        ├─ G-01..G-07  per-metric gates
        ├─ D-*         diversity (stddev) gates
        └─ X-*         cross-metric guards
        │
        ▼
promoted: true  →  adapter를 production/default로 승격
promoted: false →  훈련 재조정 후 재평가
```

---

## 평가 실행

```bash
# 1. baseline 점수 수집 (baseline adapter로 frozen benchmark 실행 후 점수 추출)
node scripts/collect-benchmark-scores.mjs \
  --adapter=baseline \
  --out=outputs/_system/ml/benchmarks/baseline/scores.jsonl

# 2. candidate 점수 수집
node scripts/collect-benchmark-scores.mjs \
  --adapter=candidate-v2 \
  --out=outputs/_system/ml/benchmarks/candidate-v2/scores.jsonl

# 3. Promotion gate 평가
node scripts/evaluate-notagen-adapter-promotion.mjs \
  --baseline=outputs/_system/ml/benchmarks/baseline/scores.jsonl \
  --candidate=outputs/_system/ml/benchmarks/candidate-v2/scores.jsonl \
  --out=outputs/_system/ml/benchmarks/candidate-v2/promotion-decision.json
```

Exit code 0 → promoted. Exit code 1 → not promoted.

---

## Input 형식 (scores.jsonl)

한 줄 = 한 benchmark 평가 결과:

```json
{
  "id": "bench-001",
  "planSignature": "C_minor_aba_miniature",
  "syntaxValidity": 1.0,
  "finalCraftScore": 0.75,
  "advancedCraftScore": 0.65,
  "harmonyContractScore": 0.82,
  "evidenceCoverageScore": 0.62,
  "motifRecapIdentity": 0.71,
  "pianoListenabilityScore": null,
  "isPianoCandidate": false
}
```

`pianoListenabilityScore`는 피아노 후보만 숫자를 기입, 나머지는 `null` 또는 필드 생략.  
`isPianoCandidate: true`인 행에서만 G-07 피아노 gate가 계산된다.

최소 5행 이상이어야 평가가 진행된다.

---

## Gate 조건 상세

### Per-Metric Gates (G-*)

| Gate | 지표 | 조건 | 비고 |
|------|------|------|------|
| G-01 | `syntaxValidity` | 하락 없음 (≤ 1% 허용) | ABC 파싱 성공률 |
| G-02 | `evidenceCoverageScore` | 하락 없음 (≤ 1% 허용) | 제어 신호 커버리지 |
| G-03 | `finalCraftScore` | 하락 없음 (≤ 3% 허용) | 종합 craft 점수 |
| G-04 | `advancedCraftScore` | 하락 없음 (≤ 3% 허용) | plan-aware composite |
| G-05 | `harmonyContractScore` | 하락 없음 (≤ 1% 허용) | 화성 계획 준수 |
| G-06 | `motifRecapIdentity` | 하락 없음 (≤ 1% 허용) | 동기 회귀 정체성 |
| G-07 | `pianoListenabilityScore` | 하락 없음 (≤ 1% 허용) | 피아노 행 없으면 skip |

### Diversity Gates (D-*)

| Gate | 지표 | 조건 |
|------|------|------|
| D-finalCraftScore | finalCraftScore stddev | candidate stddev ≥ baseline stddev × 50% |
| D-harmonyContractScore | harmonyContractScore stddev | candidate stddev ≥ baseline stddev × 50% |
| D-motifRecapIdentity | motifRecapIdentity stddev | candidate stddev ≥ baseline stddev × 50% |

baseline stddev < 0.05이면 diversity gate는 skip된다 (측정 의미 없음).

**의미:** stddev가 50% 이하로 붕괴하면 모든 출력이 비슷해졌다는 신호.  
평균이 올랐어도 다양성이 죽었으면 실패.

### Cross-Metric Guards (X-*)

| Watch Pair | 조건 |
|-----------|------|
| `finalCraftScore` → `motifRecapIdentity` | finalCraft +10% 이상인데 motifRecap -5% 이상 하락 → 실패 |
| `finalCraftScore` → `harmonyContractScore` | finalCraft +10% 이상인데 harmony -5% 이상 하락 → 실패 |
| `pianoListenabilityScore` → `motifRecapIdentity` | piano +10% 이상인데 motifRecap -5% 이상 하락 → 실패 |
| `advancedCraftScore` → `evidenceCoverageScore` | advanced +10% 이상인데 evidence -5% 이상 하락 → 실패 |
| `harmonyContractScore` → `motifRecapIdentity` | harmony +10% 이상인데 motifRecap -5% 이상 하락 → 실패 |

**의미:** 한 차원을 집중 개선하면서 다른 차원이 희생되는 편향 훈련 패턴 차단.

---

## Output 형식 (promotion-decision.json)

```json
{
  "promoted": false,
  "evaluatedAt": "2025-01-01T00:00:00.000Z",
  "baselineRows": 20,
  "candidateRows": 20,
  "gatesTotal": 12,
  "gatesFailed": 2,
  "reason": "2 gate(s) failed: G-06, D-motifRecapIdentity",
  "failedGates": [
    {
      "id": "G-06",
      "metric": "motifRecapIdentity",
      "type": "per_metric",
      "passed": false,
      "candidateMean": 0.41,
      "baselineMean": 0.58,
      "delta": -0.17,
      "deltaPercent": -29.3,
      "reason": "REGRESSION — motifRecapIdentity: 0.41 vs baseline 0.58 (-29.3%, tolerance -1%)"
    },
    {
      "id": "D-motifRecapIdentity",
      "metric": "motifRecapIdentity",
      "type": "diversity",
      "passed": false,
      "candidateStddev": 0.03,
      "baselineStddev": 0.14,
      "stddevRatio": 0.214,
      "reason": "DIVERSITY COLLAPSE in motifRecapIdentity: stddev 0.03 is only 21% of baseline 0.14"
    }
  ],
  "gates": [ ... ],
  "stats": {
    "baseline": { "finalCraftScore": { "mean": 0.74, "stddev": 0.09, ... }, ... },
    "candidate": { ... }
  }
}
```

---

## Gate 실패 시 대응

| 실패 패턴 | 원인 | 조치 |
|----------|------|------|
| G-06 (motifRecapIdentity 하락) | DPO motif recap pair 부족 | motif_recap_failure DPO pair 200개 이상 추가 |
| G-05 (harmonyContractScore 하락) | SFT 데이터에 화성 실패 곡 혼입 | P0 human rejection gate 확인, 재export |
| D-* (diversity collapse) | mode collapse — 모든 곡이 비슷해짐 | LoRA rank 조정, beta 인상 (DPO), 데이터 다양성 확인 |
| X-* (cross-metric collapse) | 편향 훈련 | 해당 dimension의 hard negative pair 재균형 |
| G-01 (syntaxValidity 하락) | adapter가 무효 ABC 생성 | SFT pair의 abcText quality 확인, mock 제외 확인 |

---

## Frozen Benchmark Set 관리

promotion gate의 신뢰성은 **benchmark set이 변하지 않는 것**에 달려 있다.

- frozen benchmark set: `outputs/_system/ml/benchmarks/frozen-set/prompts.jsonl`
- 이 파일은 임의로 수정하지 않는다
- 새 benchmark item을 추가할 때는 반드시 baseline scores도 함께 재생성한다
- adapter 간 비교를 위해 baseline scores는 `baseline/scores.jsonl`로 버전 관리된다

```
outputs/_system/ml/benchmarks/
├── frozen-set/
│   └── prompts.jsonl          ← 절대 임의 수정 금지
├── baseline/
│   └── scores.jsonl           ← native NotaGen 또는 마지막 promoted adapter
├── candidate-v2/
│   ├── scores.jsonl
│   └── promotion-decision.json
└── candidate-v3/
    ├── scores.jsonl
    └── promotion-decision.json
```

---

## 관련 문서 및 코드

- [`docs/training-loop.md`](training-loop.md) — 7단계 학습 루프
- [`docs/critic-approval-hierarchy.md`](critic-approval-hierarchy.md) — AXIOM critic 철학
- [`scripts/evaluate-notagen-adapter-promotion.mjs`](../scripts/evaluate-notagen-adapter-promotion.mjs) — gate 평가 스크립트
- [`test/adapter-promotion-policy.test.mjs`](../test/adapter-promotion-policy.test.mjs) — gate 로직 단위 테스트
