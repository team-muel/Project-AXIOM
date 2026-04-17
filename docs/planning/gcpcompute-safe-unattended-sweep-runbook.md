# gcpCompute Safe Unattended Sweep Runbook

## Goal

gcpCompute에서 bridge verify, operator projection, triage classification, backlog digest, pending approval digest, repeated warning digest, stale lock digest를 하나의 read-only unattended sweep로 남기고, incident lane이면 escalation/comms 초안을 포함한 incident draft artifact까지 자동으로 남긴다.

## Baseline

- unattended sweep 실행: `npm run ops:sweep`
- bridge verify source: `npm run mcp:bridge:verify`
- projection source: `npm run ops:project`
- output dir 기본값: `outputs/_system/operator-sweep/`

생성 파일:

- `latest.json`
- `latest.md`
- `history/YYYY-MM-DD.jsonl`
- incident lane일 때 `incident-drafts/latest.json`
- incident lane일 때 `incident-drafts/latest.md`
- incident lane일 때 `incident-drafts/history/YYYY-MM-DD.jsonl`
- 실패 시 `latest-error.json`, `errors/YYYY-MM-DD.jsonl`

## What the sweep does

1. AXIOM HTTP MCP bridge compatibility를 검사한다.
2. canonical operator projection을 갱신한다.
3. projection 결과에서 backlog digest를 추린다.
4. projection 결과에서 pending approval digest를 추린다.
5. projection 결과에서 repeated warning digest를 추린다.
6. autonomy lockHealth를 읽어 stale lock report를 남긴다.
7. bridge degraded, runtime degraded, incident candidate triage를 계산한다.
8. incident lane이면 read-only incident draft artifact를 남기고 escalation owner/cadence와 comms draft를 같이 계산한다. 최근 operator action에 rollback/manual recovery note가 있으면 incident comms nextAction과 mitigation checkpoint에도 반영한다.
9. projection latest에 orchestration trend aggregate가 있으면 incident draft도 그 compact snapshot을 같이 들고 가서, incident lane에서도 timbre와 분리된 ensemble-writing pressure를 바로 볼 수 있게 한다.
10. projection latest에 `overseer.shadowReranker` aggregate가 있으면 unattended sweep recommendation과 incident draft도 같은 compact snapshot을 같이 들고 가서, sparse reviewed sample에서는 `still sparse` guidance를 남기고 sample이 충분할 때만 promotion advantage 방향을 읽게 한다.
11. mutation 없이 recommendation만 남긴다.

## Recommended gcpCompute layout

- repo checkout: `/opt/axiom`
- app env: `/opt/axiom/.env`
- sweep env: `/opt/axiom/config/env/operator-sweep.gcp.env`
- systemd unit: `/etc/systemd/system/axiom-operator-sweep.service`
- systemd timer: `/etc/systemd/system/axiom-operator-sweep.timer`

## Install steps

1. AXIOM checkout을 `/opt/axiom`에 준비한다.
2. `.env`를 운영값으로 채운다.
3. `config/env/operator-sweep.gcp.env.example`를 복사해 `operator-sweep.gcp.env`를 만든다.
4. `config/systemd/axiom-operator-sweep.service.example`와 `axiom-operator-sweep.timer.example`를 `/etc/systemd/system/`에 복사한다.
5. 다음 명령을 실행한다.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now axiom-operator-sweep.timer
sudo systemctl start axiom-operator-sweep.service
```

## Validation

즉시 수동 검증:

```bash
cd /opt/axiom
npm run ops:sweep -- --url "$AXIOM_BASE_URL" --mcpUrl "$AXIOM_MCP_BASE_URL" --source "$AXIOM_OPERATOR_SOURCE"
```

확인 포인트:

- `outputs/_system/operator-sweep/latest.json`이 갱신된다.
- `latest.md`에 triage, severityScore/severityDrivers, bridge, backlog, pending approval, repeated warning, stale lock section이 들어간다.
- `latest.md`에 `## Latest Operator Action` section이 들어가고 rollback/manual recovery note가 recommendation에도 반영된다.
- orchestration trend aggregate에 weak-manifest pressure가 있으면 recommendation도 `orchestration trend shows ... ensemble pressure ... before treating timbre as the root issue` 문구를 남긴다. 이 문구는 timbre 문제가 아니라 ensemble-writing pressure인지 먼저 보라는 뜻이다.
- harmonic-color trend aggregate에 weak-manifest pressure가 있으면 recommendation도 `harmonic-color trend shows local color pressure ... before treating cadence or timbre as the root issue` 문구를 남긴다. 이 문구는 cadence/timbre보다 먼저 tonicization pressure와 local color survival을 확인하라는 뜻이다.
- shadow reranker aggregate에 narrow-lane reviewed evidence가 아직 sparse하면 recommendation도 `shadow reranker narrow-lane review data is still sparse ...` 문구를 남긴다. reviewed sample이 충분해질 때까진 widening 신호가 아니라 보수적 hold 문구로 읽어야 한다.
- triage가 incident lane이면 `incident-drafts/latest.json`, `incident-drafts/latest.md`가 같이 갱신되고 escalation/comms section이 포함된다.
- incident draft에는 최신 operator action snapshot이 같이 남고, `manualRecoveryNote`가 있으면 comms `nextAction`, `rollbackNote`가 있으면 `mitigationInProgress` rollback checkpoint에 반영된다.
- projection latest가 `overseer.phraseBreathTrend`를 가지고 있으면 incident draft latest도 같은 compact snapshot과 `## Phrase-Breath Trend` section을 포함한다. 이 값은 harmony correctness나 timbre가 아니라 recent successful manifest의 pickup/arrival/release survival pressure를 읽는 자리다.
- projection latest가 `overseer.harmonicColorTrend`를 가지고 있으면 incident draft latest도 같은 compact snapshot과 `## Harmonic-Color Trend` section을 포함한다. 이 값은 harmony correctness 전체가 아니라 recent successful manifest의 local color survival pressure를 읽는 자리다.
- projection latest가 `overseer.orchestrationTrends[]`를 가지고 있으면 incident draft latest도 같은 compact snapshot과 `## Orchestration Trends` section을 포함한다. 이 값은 SoundFont/timbre 품질이 아니라 ensemble-writing competence trend다.
- projection latest가 `overseer.shadowReranker`를 가지고 있으면 incident draft latest도 같은 compact snapshot과 `## Shadow Reranker` section을 포함한다. 여기서는 `promotionAdvantage ... sufficientSample=...`와 advisory line을 같이 읽어 sparse evidence 과대해석을 막는다.
- projection evidence가 stale하면 `latest.json`/`latest.md`에 stale 표시와 recommendation이 남는다.
- projection은 기존 `outputs/_system/operator-summary/`를 같이 갱신한다.
- bridge 실패나 projection 실패가 있어도 `latest-error.json`에 evidence가 남는다.

## Failure handling

우선 확인 파일:

- `outputs/_system/operator-sweep/latest-error.json`
- `outputs/_system/operator-sweep/errors/YYYY-MM-DD.jsonl`
- `outputs/_system/operator-sweep/incident-drafts/latest.json`
- `outputs/_system/operator-sweep/incident-drafts/latest.md`
- `outputs/_system/operator-summary/latest-error.json`

분류 기준:

- bridge failure: MCP HTTP 미기동, token 불일치, `/mcp` catalog incompatibility
- projection failure: app route reachability 실패 또는 summary contract 문제
- stale evidence: projection의 endpoint skew 또는 oldest age가 threshold 초과
- backlog pressure: retry_scheduled 또는 failedLike backlog가 남아 있음
- triage incident candidate: runtime degradation 또는 bridge/runtime 동시 손상이 incident lane 기준을 넘김
- incident draft generated: current triage evidence가 incident lane이며 operator가 그대로 공유할 수 있는 escalation/comms 포함 초안이 남음
- incident draft orchestration snapshot present: projection latest의 ensemble-writing trend가 incident handoff에도 보존됨
- incident draft shadow reranker snapshot present: projection latest의 learned-vs-heuristic disagreement and promotion evidence가 incident handoff에도 보존됨
- orchestration pressure recommendation present: weak-manifest pressure가 있으면 recommendation이 timbre와 ensemble-writing 원인을 구분해 준다
- shadow reranker sparse recommendation present: reviewed sample이 작으면 widening 신호 대신 narrow-lane hold guidance가 recommendation에 남음
- latest operator guidance projected: 최근 승인된 operator mutation의 rollback/manual recovery note가 recommendation과 incident handoff 문구에 반영됨
- stale lock detected: `lock_timeout_without_active_job`, `terminal_manifest_exists`, `queue_run_mismatch`
- pending approval active: autonomy 승인 대기 manifest 존재
- repeated warning active: warning key 재발 또는 failureCount24h 증가

## Guardrails

1. 이 sweep는 read-only evidence 수집만 수행한다.
2. stale lock을 감지해도 자동 `reconcile-lock`을 호출하지 않는다.
3. pending approval을 감지해도 approve/reject를 자동 호출하지 않는다.
4. repeated warning을 감지해도 queue/autonomy 상태를 직접 바꾸지 않는다.
5. recommendation을 남기고, mutation은 승인된 operator flow로만 넘긴다.
