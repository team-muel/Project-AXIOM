# AXIOM Critic Approval Hierarchy

## 철학

AXIOM의 목표는 **클래식 작곡가를 구조적으로 모방하여 명곡 수준의 곡을 쓰는 작곡 AI**입니다.

이 목표를 위해 내부 critic이 **primary approval gate**이며,
사람 피드백은 **secondary calibration signal**입니다.

대중 선호 최적화(popularity optimization)가 목표가 아니므로,
사람의 취향은 보상 신호(reward signal)로 사용되지 않습니다.

---

## Approval Hierarchy

```
Level 1 — InternalCriticApproval (PRIMARY)
  ↓  기준: craft scores + evidence coverage
  ↓  결과: approved / rejected + failedDimensions
  ↓  사용처: SFT dataset inclusion, candidate shortlisting

Level 2 — CuratorCalibrationReview (SECONDARY)
  ↓  기준: 전문가 / 훈련된 평가자의 per-dimension 평가
  ↓  결과: qualityRating (1–5) + calibrationNote
  ↓  사용처: score-feedback correlation analysis, profile v2 조정
  ↓  역할: 내부 critic 점수가 실제 음악 품질을 올바르게 반영하는지 확인

Level 3 — ListenerFeedback (LEGACY, CALIBRATION ONLY)
  ↓  역할: backward compatibility 유지
  ↓  절대 SFT gate로 사용하지 말 것
```

---

## InternalCriticApproval

### 계산 방식

```typescript
computeInternalCriticApproval(craftScore, pianoScore?, opts?)
```

위치: `src/core/evaluate/internalCriticApproval.ts`

### 기본 임계값 (v1)

| Dimension              | Default Threshold | Notes                                          |
|------------------------|:-----------------:|------------------------------------------------|
| `finalCraftScore`      | ≥ 0.70            | 필수. 8-dimension weighted craft score         |
| `advancedCraftScore`   | ≥ 0.60            | plan-aware composite (음조/화성/모티프 문법)   |
| `harmonyContractScore` | ≥ 0.70            | 화성 계획 section에서만 평가; 없으면 1.0 default |
| `evidenceCoverageScore`| ≥ 0.55            | 필수 근거 필드 커버리지                        |
| `pianoListenabilityScore`| ≥ 0.50          | 피아노 후보만; 일반 후보에서는 gate 없음       |

모든 임계값이 통과해야 `approved: true`.

### manifest에 자동 저장

`saveStructureCandidateSnapshot()`에서 `craftScoreSummary`가 있으면 **자동으로 계산하여 저장**됩니다.

```json
{
  "internalCriticApproval": {
    "approved": true,
    "finalCraftScore": 0.74,
    "advancedCraftScore": 0.65,
    "harmonyContractScore": 0.82,
    "evidenceCoverageScore": 0.61,
    "scoringProfileId": "classical_default_v1",
    "failedDimensions": [],
    "evaluatedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

---

## CuratorCalibrationReview

### 목적

내부 critic 점수가 **실제 음악 품질을 올바르게 반영하는지** 교차 검증합니다.

- `internalCriticApproval.approved = true` 이지만 실제로는 별로였다 → calibration note 기록
- `internalCriticApproval.approved = false` 이지만 실제로는 좋았다 → calibration note 기록
- 이 데이터로 scoring profile v2를 조정합니다

### API

```
POST /calibration/:songId/:candidateId
```

Body:
```json
{
  "source": "expert-review",
  "qualityRating": 4,
  "harmonyRating": 5,
  "structureRating": 4,
  "motifRating": 3,
  "pianoRating": null,
  "calibrationNote": "내부 critic은 화성 점수를 과소평가했다",
  "preferredOver": "candidate-007"
}
```

선택된 후보 뿐 아니라 **rejected/non-selected 후보에도 저장** 가능합니다.

### 응답

```json
{
  "ok": true,
  "role": "calibration",
  "songId": "song-abc",
  "candidateId": "cand-003",
  "selected": false,
  "curatorCalibration": { ... },
  "internalCriticApproval": {
    "approved": false,
    "finalCraftScore": 0.68,
    "failedDimensions": ["finalCraftScore(0.680<0.70)"]
  }
}
```

응답에 `internalCriticApproval`이 함께 반환되어 calibration 불일치를 바로 확인할 수 있습니다.

---

## SFT Dataset Curation

### Primary gate

```bash
# Internal critic 기준으로 export (권장)
npm run export:sft-dataset -- --approved-only

# 피아노 후보도 포함하되 critic gate 적용
npm run export:sft-dataset -- --approved-only --min-score=0.65

# 추가로 사람 선택 기준도 요구 (더 엄격한 필터)
npm run export:sft-dataset -- --approved-only --selection-only

# 추가로 calibration 평가 3 이상인 경우만
npm run export:sft-dataset -- --approved-only --listener-gate=3
```

### 적절하지 않은 방식

```bash
# ❌ 이 방식은 쓰지 말 것: 사람 선택만 기준으로 삼는 방식
node scripts/export-sft-dataset.mjs --selection-only   # (--approved-only 없이)

# ❌ 이 방식도 쓰지 말 것: listenerFeedback.appeal로 gate
node scripts/export-sft-dataset.mjs --listener-gate=4  # (--approved-only 없이)
```

---

## Score Calibration Workflow

이 workflow로 scoring profile을 점진적으로 개선합니다.

```
1. 후보 생성 + 내부 critic 평가 자동 저장
2. 전문가가 promising candidates에 calibration review 입력
   POST /calibration/:songId/:candidateId
3. correlation 분석 실행
   npm run analyze:score-feedback
4. strong/weak signal 확인
   - 어느 dimension이 calibration과 일치하는가?
   - 어느 dimension이 과대/과소평가되는가?
5. scoring profile v2 조정
   config/scoring-profiles/classical_default_v2.json
6. 새 profile로 재평가하여 개선 확인
```

자세한 내용: `docs/score-calibration-workflow.md`

---

## Legacy: ListenerFeedback

```typescript
// ⚠️ Deprecated: use CuratorCalibrationReview instead
interface ListenerFeedback {
  appeal: 1 | 2 | 3 | 4 | 5;
  // ...
}
```

`listenerFeedback` 필드는 하위 호환을 위해 유지됩니다.
`POST /feedback/:songId/:candidateId` 라우트도 유지됩니다.

**신규 코드에서는 `POST /calibration/:songId/:candidateId`를 사용하세요.**

SFT export에서 `listenerFeedback`은 `calibrationAppeal` metadata로 노출되며 gate로 사용되지 않습니다.
