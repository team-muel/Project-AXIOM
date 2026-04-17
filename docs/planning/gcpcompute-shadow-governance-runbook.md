# gcpCompute Shadow Governance Runbook

## Goal

production 기본값을 바꾸기 전에 gcpCompute control plane에서 baseline, candidate, observation window, rollback trigger를 먼저 고정하고 비교 evidence를 남긴다.

## Current scaffold

- 정책 템플릿 초기화: `npm run ops:shadow:init -- --policy <policy>`
- evidence capture: `npm run ops:shadow:capture -- --review <review.json> --lane <baseline|candidate>`
- baseline operator snapshot source: `npm run ops:summary`
- projection artifact source: `npm run ops:project`

지원 policy:

- `retry_backoff`
- `autonomy_cadence`
- `quality_threshold`
- `warning_threshold`

## Example

```bash
npm run ops:shadow:init -- \
  --policy retry_backoff \
  --url http://127.0.0.1:3100 \
  --source gcpCompute \
  --owner ops-team \
  --candidate "Increase RETRY_BACKOFF_MS from 2000 to 5000" \
  --envOverrides "RETRY_BACKOFF_MS=5000,MAX_RETRIES=2" \
  --window "48h comparison window"
```

기본 출력 경로:

- `docs/planning/gate-runs/shadow-reviews/YYYY-MM-DD_<policy>-shadow-review.json`
- `docs/planning/gate-runs/shadow-reviews/YYYY-MM-DD_<policy>-shadow-review.md`

## Operator workflow

1. baseline runtime에서 `ops:project`를 실행해 최신 operator artifact를 남긴다.
2. `ops:shadow:init`으로 review scaffold를 생성한다.
3. candidate 변경을 별도 env 또는 배포 lane에 적용한다.
4. observation window 동안 summary/projection artifact를 수집한다.
5. rollback trigger가 하나라도 체크되면 baseline으로 되돌리고 새 evidence를 남긴다.

## Evidence capture flow

1. baseline runtime에서 `ops:project`를 실행한다.
2. `ops:shadow:capture -- --review <review.json> --lane baseline`으로 baseline evidence를 남긴다.
3. candidate lane에서 다시 `ops:project`를 실행한다.
4. `ops:shadow:capture -- --review <review.json> --lane candidate`로 candidate evidence를 남긴다.
5. 생성된 review markdown의 `Comparison Snapshot`과 `Comparison Signals`를 보고 rollback 판단을 한다.

추가 산출물:

- `docs/planning/gate-runs/shadow-reviews/*.evidence.jsonl`
- 같은 review markdown/json 안의 `evidence.lanes.*`, `comparison`

## Rollback minimum checklist

1. `latest.json`, `latest.md`, `upstream-compatible.json`을 baseline과 비교한다.
2. readiness, pending approvals, repeated warnings, failedLike queue count 악화를 확인한다.
3. candidate env override를 baseline 값으로 되돌린다.
4. rollback 이후 `ops:project`를 다시 실행해 recovery evidence를 남긴다.

## Guardrails

1. candidate lane과 production truth plane을 같은 runtime으로 취급하지 않는다.
2. evidence 없는 정책 변경을 금지한다.
3. rollback trigger가 충족되면 감으로 버티지 말고 baseline으로 복귀한다.
4. state mutation 자동화보다 evidence 수집을 우선한다.
