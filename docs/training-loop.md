# AXIOM Learning Loop

AXIOM의 학습 루프는 **7단계 닫힌 순환**이다.  
NotaGen을 AXIOM식 작곡가로 길들이는 것이 목표다.

```
①설계 → ②생성 → ③평가 → ④저장(accepted) → ⑤저장(rejected) → ⑥학습 → ⑦비교
    ↑_____________________________________________________________|
```

---

## 7단계 루프 상세

### ① AXIOM이 구조 설계

```
CompositionPlan {
  form              // "miniature", "aba", "rondo_lite"
  key               // "C minor", "Db major"
  phraseplan        // [presentation, continuation, cadential]
  harmonyPlan       // tonalCenter, harmonicRhythm, allowModulation
  motifGraph        // motifId, source, requiredReturns, transformPath
  pianoPlan         // textureType, registerLayout
}
```

**파일:** `src/core/plan/sketch.ts` → `materializeCompositionSketch()`  
결과가 `compositionPlan.sections[]` + `globalMotifGraph`로 구체화된다.

---

### ② NotaGen이 후보 생성 (8~32개)

```
AXIOM_GENERATION_STRATEGY=hybrid_notagen_with_template_baseline
→ learnedNotagenAdapter.ts   (conditioningText + controlLines + motifGraphBlock)
→ NotaGen native (NOTAGEN_ENGINE=notagen_native)
→ 8~32 ABC candidates
```

**파일:** `src/core/generate/hybridSymbolicCandidatePool.ts`  
candidate 개수: `LEARNED_CANDIDATE_COUNT_DEFAULT = 8`, 최대 32개

---

### ③ AXIOM 내부 critic 평가

| 평가 차원 | 지표 | 기준 |
|----------|------|------|
| phrase | `phraseShape`, `planAwarePhraseGrammarScore` | ≥ 0.55 |
| harmony | `harmonyContractScore`, `planAwareHarmonyGrammarScore` | ≥ 0.70 |
| motif | `planAwareMotifDevelopmentScore`, `motifRecapIdentity` | ≥ 0.50 |
| cadence | `cadenceStrength`, `cadenceArchitecturalWeight` | ≥ 0.50 |
| piano listenability | `pianoListenabilityScore` | ≥ 0.50 |
| evidence coverage | `evidenceCoverageScore` | ≥ 0.55 |
| 종합 | `finalCraftScore`, `advancedCraftScore` | ≥ 0.70 / 0.60 |

**파일:** `src/core/evaluate/craftScoring.ts` → `computeCraftScoreSummary()`

---

### ④ 좋은 후보 → accepted dataset 저장

게이트를 모두 통과한 후보는 SFT training pair가 된다.

```
label: "axiom_curated_pass"
instruction: conditioningText + controlLines + motifGraphBlock
output: full ABC score text
```

**저장 경로:** `outputs/{songId}/candidates/<id>/proposalEvidence.json`  
**Export 명령:**
```bash
node scripts/export-notagen-sft-dataset.mjs --snapshot=$(date +%Y-%m-%d)
# → outputs/_system/ml/notagen-sft/<snapshot>/sft-pairs.jsonl
```

---

### ⑤ 나쁜 후보 → hard negative 저장

게이트를 통과하지 못한 후보는 DPO pair의 rejected side가 된다.  
실패 유형별로 분류:

| 실패 유형 | `rejectionReason` | 실패 조건 |
|----------|-------------------|----------|
| 화성 실패 | `harmony_failure` | `harmonyContractScore` < 0.60, 또는 violations > 0 |
| 동기 회귀 실패 | `motif_recap_failure` | `motifReturnScore` ≤ 0.30 |
| 피아노 청감 실패 | `piano_listenability_failure` | `pianoListenabilityScore` < 0.40 (piano 후보) |
| evidence 부족 | `evidence_insufficient` | `evidenceCoverageGateTier` = "partial" \| "none" |
| 저품질 | `low_craft_score` | `finalCraftScore` < 0.60 |

**Export 명령:**
```bash
node scripts/export-notagen-preference-dataset.mjs --snapshot=$(date +%Y-%m-%d)
# → outputs/_system/ml/notagen-preferences/<snapshot>/dpo-critic-pairs.jsonl
```

---

### ⑥ SFT + DPO 학습

#### Stage 2 — SFT

```bash
# LoRA fine-tuning (GPU, VRAM >= 8GB 권장)
python scripts/train-notagen-axiom-adapter.py \
    --snapshot=<date> \
    --mode=lora \
    --min-score=0.70
# → outputs/_system/ml/notagen-adapter/<run-id>/adapter_model/
```

#### Stage 3 — DPO

```bash
# SFT adapter를 출발점으로 DPO fine-tuning
python scripts/train-notagen-axiom-adapter-dpo.py \
    --snapshot=<date> \
    --sft-adapter=outputs/_system/ml/notagen-adapter/<sft-run-id>/adapter_model \
    --mode=lora \
    --beta=0.1
# → outputs/_system/ml/notagen-dpo-adapter/<run-id>/adapter_model/
```

rejection reason별 DPO loss가 `run_summary.json`에 기록된다.  
`harmony_failure` loss가 높으면 화성 회피를 우선 학습 중인 것.

---

### ⑦ 같은 유형의 곡 재생성 후 비교

```bash
# 동일한 6개 ablation 레벨로 재측정
node --test test/benchmark-notagen-control-ablation.test.mjs

# Stage 3 character piece 스타일 비교
node --test test/benchmark-masterpiece-direction.test.mjs
```

#### 해석 기준 (훈련 전 vs 후 delta)

| 지표 | 의미 있는 개선 |
|------|-------------|
| `advancedCraftScore` D vs C delta | ≥ 5% → motif graph가 생성 시점에 실제 작동 |
| `harmonyContractScore` 전체 | ≥ 5% 개선 → DPO harmony pair가 효과 있음 |
| `motifRecapIdentity` | ≥ 5% 개선 → recap 학습 완료 |
| `pianoListenabilityScore` | ≥ 5% 개선 → piano listenability DPO 효과 |

개선이 없다면:
- 훈련 데이터 부족 (< 200 pair) → 더 수집
- beta 값 조정 (DPO: 0.05~0.2 범위)
- LoRA rank 상향 (r=16 → r=32)

---

## 루프 반복 cadence

| 단계 | 주기 |
|------|------|
| ①~③ 생성 + 평가 | 지속적 (운영 중) |
| ④~⑤ export | 200+ pair 누적 후 snapshot |
| ⑥ SFT | 최초 훈련, 이후 500+ pair마다 재훈련 |
| ⑥ DPO | SFT 이후, 이후 200+ pair마다 반복 |
| ⑦ 비교 | SFT/DPO 훈련 후 즉시 |

---

## 현재 상태

| 단계 | 상태 |
|------|------|
| ① 구조 설계 | ✅ `materializeCompositionSketch()` |
| ② 후보 생성 (8~32) | ✅ `hybridSymbolicCandidatePool.ts` |
| ③ 내부 critic 평가 | ✅ `craftScoring.ts` |
| ④ accepted dataset export | ✅ `export-notagen-sft-dataset.mjs` |
| ⑤ hard negative export (유형 분류) | ✅ `export-notagen-preference-dataset.mjs` |
| ⑥ SFT 훈련 스크립트 | ✅ `train-notagen-axiom-adapter.py` |
| ⑥ DPO 훈련 스크립트 | ✅ `train-notagen-axiom-adapter-dpo.py` |
| ⑦ 비교 벤치마크 | ✅ `test/benchmark-notagen-control-ablation.test.mjs` |
| `NOTAGEN_ENGINE=axiom_adapter` 추론 경로 | ⬜ adapter 준비 후 추가 |
| NotaGen native 가중치 직접 fine-tuning | ⬜ NotaGen 레포 통합 필요 |

---

## 실패 유형별 hard negative 예시

### 화성 실패 (harmony_failure)

```
planSignature: "C_minor_aba_miniature"
chosen:  harmonyContractScore=0.82, motifRecapIdentity=0.71
rejected: harmonyContractScore=0.41 (violations: iv→V 연결 누락)
→ DPO: 모델이 화성 contract 이탈을 회피하도록 학습
```

### 동기 회귀 실패 (motif_recap_failure)

```
planSignature: "Db_major_nocturne"
chosen:  motifReturnScore=0.78, exact_return in recap section
rejected: motifReturnScore=0.22 (recap에서 motif 사라짐)
→ DPO: recap에서 motif 복귀 압력
```

### 피아노 청감 실패 (piano_listenability_failure)

```
planSignature: "G_major_prelude_piano"
chosen:  pianoListenabilityScore=0.74, bassRootSupportScore=0.80
rejected: pianoListenabilityScore=0.31 (LH bass 없음, 양손 동일 register)
→ DPO: 피아노 이디엄 내재화 압력
```

---

## 관련 문서

- [`docs/notagen-training.md`](notagen-training.md) — 4단계 훈련 목표 상세 (Stage 1~4)
- [`docs/composition-stages.md`](composition-stages.md) — 5단계 작곡 품질 목표
- [`docs/datasets.md`](datasets.md) — 데이터 수집 · export · truth-plane 설계
- [`docs/score-calibration-workflow.md`](score-calibration-workflow.md) — 사람 calibration 역할
- [`test/benchmark-notagen-control-ablation.test.mjs`](../test/benchmark-notagen-control-ablation.test.mjs) — 루프 ⑦ 비교 벤치마크
