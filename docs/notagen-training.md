# NotaGen 훈련 파이프라인 — AXIOM control-following adapter 육성

AXIOM의 핵심 개발 방향은 **평가기를 추가하는 것이 아니라, NotaGen을 AXIOM식 작곡가로 길들이는 것**이다.

---

## 전체 4단계 목표

```
Stage 1  Native NotaGen을 후보 생성기로 사용 (현재)
Stage 2  AXIOM-curated SFT로 AXIOM control-following adapter 학습
Stage 3  AXIOM-critic DPO로 더 구조적이고 평가기 친화적인 adapter 학습
Stage 4  NotaGen adapter가 AXIOM control을 실제로 잘 따르는지 ablation으로 검증
```

---

## Stage 1 — Native NotaGen 후보 생성기 (현재)

### 동작 방식

```
AXIOM CompositionPlan
        │
        ▼
learnedNotagenAdapter.ts
  conditioningText + controlLines (period/composer/instrumentation 수준)
        │
        ▼
NotaGen native (NOTAGEN_ENGINE=notagen_native)
  → 다수 ABC 후보 생성
        │
        ▼
AXIOM craft scoring + preference reranking
  finalCraftScore, advancedCraftScore, harmonyContractScore,
  evidenceCoverageScore, motifRecapIdentity, ...
        │
        ▼
최고 후보 선택 → proposalEvidence 저장
```

### Stage 1의 한계

- NotaGen native는 `period / composer / instrumentation`만 받는다.
- AXIOM의 section plan, cadence 지정, motif 복귀 정책, harmony contract는 **생성 후 필터**로만 작용한다.
- `[AXIOM_MOTIF_GRAPH]`, `[AXIOM_REPAIR]`, `<AXIOM_PIANO_REWRITE>` 블록은 현재 모델이 무시한다.
- → "AXIOM이 계획하고, NotaGen이 독립적으로 생성하고, AXIOM이 검증" — 이상적이지 않다.

### 데이터 수집 (Stage 2 훈련 준비)

```bash
# hybrid R&D 모드로 실행 (.env 설정 필요 — 아래 3번 참조)
npm run start:core

# 작곡 요청
curl -X POST http://localhost:3100/compose \
  -H "Content-Type: application/json" \
  -d '{"prompt": "C단조 현악 삼중주 소나티나", "workflow": "symbolic_only"}'
```

승인 후 데이터는 `outputs/{songId}/candidates/` 에 쌓인다.  
훈련용으로 충분한 페어를 모으려면 **200+ 승인 페어**가 필요하다.

---

## Stage 2 — AXIOM-curated SFT

### 목표

AXIOM control block → ABC score 페어로 fine-tune. 모델이 section 레이아웃, cadence 위치, 에너지 곡선, motif 정책을 **생성 시점에** 따르도록 학습.

### SFT row 형식 (`label: "axiom_curated_pass"`)

```jsonl
{
  "id": "<sha256>",
  "label": "axiom_curated_pass",
  "instruction": "Generate interleaved ABC notation for a classical string trio...\n%%axiom_control_begin\nlane=string_trio_symbolic\nform=miniature\nkey=Cmin\n...\nsection id=s1 role=theme_a ...\nsection id=s2 role=development ...\nsection id=s3 role=recap ...\n[AXIOM_MOTIF_GRAPH]\nsource=s1\nmotif_id=theme_a\n...\n[/AXIOM_MOTIF_GRAPH]\n%%axiom_control_end",
  "output": "X:1\nT:...\n...<full ABC score>",
  "meta": { "finalCraftScore": 0.82, "advancedCraftScore": 0.73, ... }
}
```

instruction에는 다음이 모두 포함된다:
- `conditioningText` (period/composer/instrumentation 수준 프롬프트)
- `controlLines` (lane=, form=, key=, section 라인 등)
- `[AXIOM_MOTIF_GRAPH]` 블록 (motif ID, transform path, required returns)
- `[AXIOM_REPAIR]` 블록 (harmony repair directive)
- `<AXIOM_PIANO_REWRITE>` 블록 (piano 전용)

### 승인 게이트 (AXIOM internal critic)

SFT row 자격 조건 (모두 통과해야 함):

| 게이트 | 기본 임계값 |
|--------|-----------|
| `finalCraftScore` | ≥ 0.70 |
| `advancedCraftScore` | ≥ 0.60 |
| `harmonyContractScore` | ≥ 0.70 (harmony plan 있을 때) |
| `evidenceCoverageScore` | ≥ 0.55 |
| `pianoListenabilityScore` | ≥ 0.50 (piano 후보만) |

human review는 `confidenceScore`를 높이지만 게이트를 결정하지 않는다.

### Export + 훈련

```bash
# SFT 페어 export
node scripts/export-notagen-sft-dataset.mjs --snapshot=$(date +%Y-%m-%d) --min-craft=0.70

# LoRA fine-tuning (GPU 권장, VRAM ≥ 8GB)
python scripts/train-notagen-axiom-adapter.py \
    --snapshot=$(date +%Y-%m-%d) \
    --mode=lora \
    --min-score=0.70

# 결과 확인
cat outputs/_system/ml/notagen-adapter/<run-id>/run_summary.json
```

### 산출물 경로

| 경로 | 내용 |
|------|------|
| `outputs/_system/ml/notagen-sft/<snapshot>/sft-pairs.jsonl` | SFT 훈련 페어 |
| `outputs/_system/ml/notagen-sft/<snapshot>/summary.json` | export 통계 |
| `outputs/_system/ml/notagen-adapter/<run-id>/adapter_model/` | 저장된 LoRA 가중치 |
| `outputs/_system/ml/notagen-adapter/<run-id>/run_summary.json` | 훈련 지표 |

---

## Stage 3 — AXIOM-critic DPO

### 목표

SFT adapter 위에서 AXIOM internal critic 기반 (chosen, rejected) 페어로 DPO 학습.  
더 구조적이고 평가기 친화적인 생성물로 수렴.

### DPO 페어 구성 방식

```
CHOSEN  = 동일 planSignature에서 AXIOM critic 게이트 모두 통과 + selected=true
REJECTED = 동일 planSignature에서 게이트 1개 이상 실패 (gap ≥ 0.10 below threshold)
           또는 harmonyContractViolations > 0
           또는 motifReturnScore ≤ 0.30
           또는 evidenceCoverageGateTier = "partial" | "none"
```

- **hard negative 우선**: 같은 프롬프트에서 AXIOM이 식별한 실패 사례
- **planSignature 단위 그룹**: songId가 아닌 planSignature 기준으로 페어 구성 → 최대 signal density

### Export

```bash
# DPO 페어 export
node scripts/export-notagen-preference-dataset.mjs --snapshot=$(date +%Y-%m-%d)

# 결과
outputs/_system/ml/notagen-preferences/<snapshot>/dpo-critic-pairs.jsonl
outputs/_system/ml/notagen-preferences/<snapshot>/candidates.jsonl
outputs/_system/ml/notagen-preferences/<snapshot>/summary.json
```

---

## Stage 4 — Ablation 검증

### 목표

NotaGen adapter (Stage 2/3)가 AXIOM control block을 실제로 따르는지 수치로 검증.

### 검증 벤치마크

```bash
node --test test/benchmark-notagen-control-ablation.test.mjs
```

6가지 ablation 레벨을 비교:

| 레벨 | 추가 항목 |
|------|----------|
| A | plain NotaGen (period + composer + instrumentation) |
| B | + section control lines |
| C | + phrase / harmony / motif control lines |
| D | + `[AXIOM_MOTIF_GRAPH]` 블록 |
| E | + `[AXIOM_REPAIR]` 블록 |
| F | + `<AXIOM_PIANO_REWRITE>` 블록 (solo piano) |

측정 지표:

| 지표 | 의미 |
|------|------|
| `evidenceCoverageScore` | 평가 증거 충분도 |
| `finalCraftScore` | 종합 craft 점수 |
| `advancedCraftScore` | 고급 craft 점수 (phrase/harmony 계획 준수) |
| `harmonyContractScore` | harmony contract 이행률 |
| `motifRecapIdentity` | recap 섹션의 motif 복귀 동일성 |
| `motifTransformVariety` | motif 변형 다양성 |
| `pianoListenabilityScore` | 피아노 연주성 (Level F) |
| `selectedTier` | evidenceCoverageGateTier |

### 해석 가이드

| 결과 | 의미 |
|------|------|
| D-C delta > 5% | `[AXIOM_MOTIF_GRAPH]`가 live prompt signal — adapter가 반응함 |
| D-C delta < 5% | 현재는 fine-tuning metadata — 기준 모델은 무시 |
| E-D delta > 5% | `[AXIOM_REPAIR]`가 live prompt signal |
| E-D delta < 5% | 현재는 fine-tuning metadata |

**현재 상태 (Stage 1 — mock backend)**:  
D vs C `advancedCraftScore` delta ≈ 4% (explicit motifGraph가 required constraint를 엄격하게 설정).  
fine-tuned adapter가 exact_return을 제대로 생성하면 D가 C보다 점수가 **오른다**.

---

## 현재 상태 요약

| 단계 | 상태 |
|------|------|
| Stage 1 — hybrid 후보 생성 | ✅ 운영 중 (`hybrid_notagen_with_template_baseline` 설정 시) |
| SFT export (`label: "axiom_curated_pass"`) | ✅ 구현 완료 |
| DPO export (AXIOM-critic 기반 chosen/rejected) | ✅ 구현 완료 |
| Stage 2 — LoRA adapter 훈련 스크립트 | ✅ 구현 완료 (HF causal LM 기준) |
| NotaGen native 가중치 직접 fine-tuning | ⬜ NotaGen 레포 통합 필요 |
| Stage 3 — DPO 훈련 스크립트 | ✅ `scripts/train-notagen-axiom-adapter-dpo.py` |
| Stage 4 — ablation 검증 벤치마크 | ✅ `test/benchmark-notagen-control-ablation.test.mjs` |
| `NOTAGEN_ENGINE=axiom_adapter` 추론 경로 | ⬜ adapter 준비 후 추가 |

---

## 관련 문서

- [`docs/training-loop.md`](training-loop.md) — 7단계 닫힌 학습 루프 전체 설계
- [`docs/datasets.md`](datasets.md) — 학습 데이터 수집 · export · truth-plane 설계
- [`docs/musical-quality.md`](musical-quality.md) — 평가 기준 (craft scoring 의미)
- [`docs/local-development.md`](local-development.md) — 생성 전략 설정 (`hybrid_notagen_with_template_baseline`)
- [`docs/archive/notagen-axiom-adapter.md`](archive/notagen-axiom-adapter.md) — 초기 Stage 1/2 설계 상세 (archive)
