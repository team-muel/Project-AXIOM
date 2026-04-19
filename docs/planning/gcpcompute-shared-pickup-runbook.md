# gcpCompute Shared Pickup Runbook

## Goal

gcpCompute가 이미 생성된 operator summary, unattended sweep, incident draft latest를 하나의 shared pickup bundle로 정리해 팀이 한 파일 집합만 읽어도 현재 운영 상태를 파악하게 만든다.

## Baseline

- source summary: `npm run ops:project`
- source sweep: `npm run ops:sweep`
- pickup bundle: `npm run ops:pickup`
- 기본 pickup 경로: `outputs/_system/operator-pickup/`

생성 파일:

- `latest.json`
- `latest.md`
- `history/YYYY-MM-DD.jsonl`
- 실패 시 `latest-error.json`, `errors/YYYY-MM-DD.jsonl`

이 bundle은 다음 source artifact를 읽는다.

- `outputs/_system/operator-summary/latest.json`
- `outputs/_system/operator-sweep/latest.json`
- incident lane일 때 `outputs/_system/operator-sweep/incident-drafts/latest.json`

## Where Pickup Fits In The Team Pattern

pickup bundle은 팀원이 외부 bridge와 gcpCompute에서 이미 쓰고 있는 운영 경로를 대체하지 않는다.

팀의 실제 경로는 다음과 같다.

1. `upstream.axiom.*`로 AXIOM 상태를 읽는다.
2. shared note나 incident/task projection이 필요하면 `obsidian.axiom.project`를 호출한다.
3. write target이 불분명하면 remote-mcp 기반 write target verify를 수행한다.

`ops:pickup`은 이 흐름 앞단에서 AXIOM truth plane이 summary, unattended sweep, incident latest를 한 번에 넘겨 주는 handoff bundle이다. 즉, AXIOM 쪽 evidence export이지 Obsidian projection 대체물이 아니다. 최신 operator action의 rollback/manual recovery note가 unattended sweep recommendation이나 incident comms에 반영되면 pickup도 그 handoff 문구를 그대로 실어 나른다. projection latest가 orchestration trend aggregate나 shadow reranker aggregate를 갖고 있으면 pickup도 그 compact snapshot을 함께 들고 가므로, shared lane이 raw summary를 다시 열지 않고도 ensemble-writing pressure와 narrow-lane learned disagreement pressure를 읽을 수 있다.

## Recommended gcpCompute layout

- repo checkout: `/opt/axiom`
- app env: `/opt/axiom/.env`
- pickup env: `/opt/axiom/config/env/operator-pickup.gcp.env`
- systemd unit: `/etc/systemd/system/axiom-operator-pickup.service`
- systemd timer: `/etc/systemd/system/axiom-operator-pickup.timer`

## Install steps

1. AXIOM checkout을 `/opt/axiom`에 준비한다.
2. `.env`를 운영값으로 채운다.
3. `config/env/operator-pickup.gcp.env.example`를 복사해 `operator-pickup.gcp.env`를 만든다.
4. `config/systemd/axiom-operator-pickup.service.example`와 `axiom-operator-pickup.timer.example`를 `/etc/systemd/system/`에 복사한다.
5. 다음 명령을 실행한다.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now axiom-operator-pickup.timer
sudo systemctl start axiom-operator-pickup.service
```

## Validation

즉시 수동 검증:

```bash
cd /opt/axiom
npm run ops:pickup -- --projectionDir "$AXIOM_OPERATOR_PROJECTION_DIR" --sweepDir "$AXIOM_OPERATOR_SWEEP_DIR" --dir "$AXIOM_OPERATOR_PICKUP_DIR"
```

확인 포인트:

- `outputs/_system/operator-pickup/latest.json`이 갱신된다.
- `latest.md`에 triage, readiness, bridge, queue/backlog, pending approvals, repeated warnings, phrase-breath trend, harmonic-color trend, learned backbone benchmark, shadow reranker, orchestration trends, incident draft, escalation, comms draft section이 들어간다.
- `latest.md`와 `latest.json`에 `latestOperatorAction`이 포함되고, sweep recommendation이 rollback/manual recovery note를 반영했다면 pickup recommendation과 incident comms에도 그대로 남는다.
- projection/sweep source가 learned-backbone pending blind review queue를 보고 있으면 pickup의 `overseer.learnedBackboneBenchmark.reviewPackActions[]`와 markdown `reviewPack` lines도 같이 남는다. 여기에는 shortlist 또는 pairwise pending pair count와 `npm run ml:review-pack:learned-backbone -- --pendingOnly --reviewTarget=...` command뿐 아니라 custom budget cell별 `--searchBudget="custom(3)"` or `--searchBudget="custom(3+1)"` command도 포함되어 shared lane이 raw summary를 다시 열지 않고도 next review pack action을 실행할 수 있다.
- projection 또는 sweep source에 learned-backbone blind review pack inventory가 있으면 pickup의 `overseer.learnedBackboneBenchmark.reviewPacks`와 markdown `reviewPacks` line도 같이 남는다. 이 line은 active worksheet backlog와 latest generated or reviewed timestamp를 compact하게 보여 주므로 shared lane이 이미 열려 있는 review sheet를 먼저 마저 채워야 하는지 바로 판단할 수 있다.
- active learned-backbone review pack row는 `reviewSheet` path와 `npm run ml:review-pack:record:learned-backbone -- --resultsFile ...` ingest command를 같이 남긴다. pickup은 duplicate blind-review pack 생성 command보다 이 worksheet ingest path를 먼저 넘기지만, active pack들이 current pending blind-review queue를 모두 덮지 못하면 uncovered pending pair 수만큼 supplemental `reviewPack` command도 함께 남겨 shared lane이 기존 sheet backlog와 새 supplemental pack 필요 여부를 동시에 판단할 수 있게 한다.
- sweep recommendation이 orchestration pressure 문구를 만들면 pickup recommendation도 같은 문구를 그대로 보존한다. 이때 recommendation은 timbre 문제가 아니라 ensemble-writing pressure를 먼저 확인하라는 뜻이다.
- sweep recommendation이 harmonic-color pressure 문구를 만들면 pickup recommendation도 같은 문구를 그대로 보존한다. 이때 recommendation은 cadence나 timbre보다 먼저 tonicization pressure와 local color survival을 확인하라는 뜻이다.
- sweep recommendation이 learned backbone benchmark retry-drift 문구를 만들면 pickup recommendation도 같은 문구를 그대로 보존한다. 이때 recommendation은 Stage A/C sample floor를 아직 넘기지 못했거나 retry localization drift가 남아 있으면 backbone widening 결정을 미루라는 뜻이다.
- sweep recommendation이 shadow reranker sparse-review 문구를 만들면 pickup recommendation도 같은 문구를 그대로 보존한다. 이때 recommendation은 approval or appeal delta를 보더라도 reviewed sample이 아직 작으니 authority widening 판단을 미루라는 뜻이다.
- `latest.json`의 `overseer.phraseBreathTrend`는 projection latest에서 넘겨받은 recent successful-manifest phrase-breath survival aggregate다. 이는 harmony correctness 판정이 아니라 pickup/arrival/release pressure를 compact하게 보는 trend surface다.
- `latest.json`의 `overseer.harmonicColorTrend`는 projection latest에서 넘겨받은 recent successful-manifest harmonic-color survival aggregate다. 이는 harmony correctness 전체 판정이 아니라 local color target survival, tonicization pressure, prolongation motion pressure를 compact하게 보는 trend surface다.
- `latest.json`의 `overseer.learnedBackboneBenchmark`는 projection latest에서 넘겨받은 narrow-lane baseline-vs-learned benchmark aggregate다. pickup markdown은 `reviewSampleStatus`, `blindPreference`, `reviewedTop1Accuracy`, `pairedSelectionOutcomes`, `selectedWorkerOutcomes`, `coverageRows`, `promotionGate`, `retryLocalizationStability`, `topFailureModes`, `recentRunRows`, advisory line을 같이 보여 주므로 shared lane이 raw candidate sidecar 없이도 sample sufficiency, reviewed promoted-vs-heuristic cohort balance, worker별 outcome skew, benchmark별 pending pressure, selected top-1 quality, retry drift, 그리고 guarded promotion hold 상태를 읽을 수 있다. `reviewSampleStatus` 안의 `remainingReviewedRunCountForPromotion`와 `remainingReviewedDisagreementCountForPromotion`는 C4 floor까지 남은 evidence gap을 바로 읽는 field다.
- `latest.json`의 `overseer.shadowReranker`는 projection latest에서 넘겨받은 learned-vs-heuristic disagreement aggregate다. `promotionAdvantage.sufficientReviewSample=false`이면 pickup markdown과 recommendation도 sparse-evidence hold 문구를 유지한다.
- `latest.json`의 `overseer.orchestrationTrends[]`는 projection latest에서 넘겨받은 family-level average range/balance/conversation fit과 weak-manifest pressure snapshot이다. 이는 timbre change log가 아니라 ensemble-writing competence trend다.
- incident lane이면 latest bundle에 incident draft metadata와 escalation/comms handoff가 같이 들어가고, incident draft가 phrase-breath, harmonic-color, learned backbone benchmark, shadow reranker, 또는 orchestration snapshot을 갖고 있으면 pickup JSON도 그 nested field를 그대로 보존한다.
- incident lane이면 incident comms `nextAction`이 최신 `manualRecoveryNote`를 우선 사용하고, `mitigationInProgress`에는 rollback checkpoint가 포함될 수 있다.
- source artifact path가 `## Source Artifacts`와 JSON evidence에 함께 남는다.
- 실패 시 `latest-error.json`이 남는다.

gcpCompute 운영 경로에서 함께 확인할 점:

- AXIOM HTTP MCP와 외부 bridge가 살아 있으면 operator는 pickup raw file보다 `upstream.axiom.*`를 먼저 본다.
- shared knowledge plane 기록은 pickup bundle을 사람이 직접 복사하는 대신 bridge-side `obsidian.axiom.project`가 담당한다.
- pickup은 bridge/projection이 consume할 단일 입력 묶음으로 보면 된다.

## Failure handling

pickup 실패는 source artifact가 아직 생성되지 않았거나 손상된 경우가 대부분이다. 다음 파일을 우선 확인한다.

- `outputs/_system/operator-pickup/latest-error.json`
- `outputs/_system/operator-pickup/errors/YYYY-MM-DD.jsonl`
- `outputs/_system/operator-summary/latest.json`
- `outputs/_system/operator-sweep/latest.json`

분류 기준:

- projection artifact missing: `operator-summary/latest.json` 미존재
- sweep artifact missing: `operator-sweep/latest.json` 미존재
- incident draft absent: 정상이며 incident lane이 아닐 수 있음
- phrase-breath trend absent: 정상이며 recent successful manifest에 phrase-breath metrics가 아직 충분히 쌓이지 않았을 수 있음
- harmonic-color trend absent: 정상이며 recent successful manifest에 harmonic-color metrics가 아직 충분히 쌓이지 않았을 수 있음
- shadow reranker absent: 정상이며 recent candidate sidecar or reviewed hybrid evidence가 아직 충분히 쌓이지 않았을 수 있음
- orchestration trends absent: 정상이며 recent successful manifest에 orchestration snapshot이 없거나 해당 family aggregate가 아직 비어 있을 수 있음
- source JSON invalid: upstream artifact가 깨졌거나 부분 쓰기 실패

## Guardrails

1. `ops:pickup`은 source artifact를 다시 수집하지 않고 existing latest만 읽는다.
2. pickup bundle은 team-facing handoff surface이지 truth plane이 아니다.
3. source artifact 생성 책임은 계속 `ops:project`와 `ops:sweep`에 있다.
4. pickup failure는 source freshness 또는 source integrity 문제로 먼저 해석한다.
5. bridge와 `obsidian.axiom.project`가 사용 가능한 환경이라면 pickup을 최종 운영 UI처럼 쓰지 말고 bridge/projection 입력으로 취급한다.
