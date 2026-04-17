# gcpCompute Operator Projection Runbook

## Goal

gcpCompute가 AXIOM local runtime 또는 배포 runtime에서 canonical operator summary를 주기적으로 수집하고, `_system` pickup artifact를 안정적으로 갱신하게 만든다.

이 runbook의 summary artifact는 downstream `ops:pickup` bundle의 source 중 하나다.

## Baseline

- summary 출력: `npm run ops:summary`
- projection 실행: `npm run ops:project`
- 기본 projection 경로: `outputs/_system/operator-summary/`
- 생성 파일:
  - `latest.json`
  - `latest.md`
  - `upstream-compatible.json`
  - `history/YYYY-MM-DD.jsonl`
  - 실패 시 `latest-error.json`, `errors/YYYY-MM-DD.jsonl`

## Where This Fits In The Team Pattern

이 artifact는 팀의 최종 운영면 자체가 아니라 외부 bridge와 gcpCompute projection lane이 소비할 AXIOM-side handoff surface다.

팀 운영 경로는 다음 순서를 유지한다.

1. `upstream.axiom.*`로 AXIOM runtime 상태를 확인한다.
2. shared knowledge plane 기록이 필요하면 `obsidian.axiom.project`를 호출한다.
3. write target이 의심되면 remote-mcp write target verify를 수행한다.

따라서 `upstream-compatible.json`은 bridge가 읽기 쉬운 canonical summary input이고, 사람용 최종 daily note나 incident note를 AXIOM이 직접 쓰는 자리가 아니다.

## Recommended gcpCompute layout

- repo checkout: `/opt/axiom`
- app env: `/opt/axiom/.env`
- projection env: `/opt/axiom/config/env/operator-projection.gcp.env`
- systemd unit: `/etc/systemd/system/axiom-operator-summary.service`
- systemd timer: `/etc/systemd/system/axiom-operator-summary.timer`

## Install steps

1. AXIOM checkout을 `/opt/axiom`에 준비한다.
2. `.env`를 운영값으로 채운다.
3. `config/env/operator-projection.gcp.env.example`를 복사해 `operator-projection.gcp.env`를 만든다.
4. `config/systemd/axiom-operator-summary.service.example`와 `axiom-operator-summary.timer.example`를 `/etc/systemd/system/`에 복사한다.
5. 다음 명령을 실행한다.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now axiom-operator-summary.timer
sudo systemctl start axiom-operator-summary.service
```

## Validation

즉시 수동 검증:

```bash
cd /opt/axiom
npm run ops:project -- --url "$AXIOM_BASE_URL" --namespace "$AXIOM_NAMESPACE" --source "$AXIOM_OPERATOR_SOURCE"
```

확인 포인트:

- `outputs/_system/operator-summary/latest.json`이 갱신된다.
- `outputs/_system/operator-summary/upstream-compatible.json`이 생성된다.
- `latest.json`과 `upstream-compatible.json`의 `namespace`가 `AXIOM_NAMESPACE`와 일치한다.
- `latest.json`, `latest.md`, `upstream-compatible.json`에 `latestOperatorAction` snapshot이 있으면 최근 operator mutation action, actor, surface, observedAt, artifactLinks, rollbackNote, manualRecoveryNote를 확인할 수 있다.
- `latest.md`와 `latest.json`에 pending approval digest가 포함된다.
- `latest.md`와 `latest.json`에 backlog digest와 top backlog jobs가 포함되며, manifest-backed backlog job이라면 `structureLongSpan`, `audioLongSpan`, 그리고 render mismatch가 있을 때 `longSpanDivergence` compact label도 함께 확인할 수 있다. label의 focus head는 `primaryFocus+secondaryFocus(+Nmore)`를 쓸 수 있고, render-only는 `@sectionId`, same-section paired는 `@sectionId~same`, cross-section paired는 `@audioSectionId>symbolicSectionId` 형식을 쓰며, secondary divergence section이 있으면 `,+...` fragment를 이어 붙인다. backlog/pending line에는 optional `longSpanReason=` prose fragment도 붙을 수 있어서, cross-section divergence에서 rendered weak section과 paired symbolic weak section의 순서를 한 줄로 읽을 수 있다. string trio contract가 있는 backlog line은 optional `orchestration=trio:rng=...,bal=...,conv=...,weak=...` compact token도 함께 싣는다. JSON payload에는 top-level `repairMode`, optional `secondaryRepairFocuses`, explicit `recommendedDirectives[]` bundle entries (`focus`, `kind`, `priorityClass`), derived `operatorReason`, section explanation 배열, 그리고 optional symbolic-vs-rendered comparison fields (`comparisonStatus`, `structureSectionId`, `structureTopIssue` 등)도 같이 들어온다.
- `latest.json`의 `summary.manifestAudioRetry.recentManifestTracking[]`와 dashboard의 Recent Key Route Tracking 표에는 optional `orchestration` snapshot이 들어올 수 있다. 현재 `string_trio` family에서는 `idiomaticRangeFit`, `registerBalanceFit`, `ensembleConversationFit`, `weakSectionIds`를 확인할 수 있으므로, generic register/cadence fit과 실제 ensemble-aware orchestration competence를 구분해서 읽는다.
- `latest.json`의 `summary.manifestAudioRetry.phraseBreathTrends`와 `latest.md`의 `## Phrase-Breath Trend` section은 최근 성공 manifest 기준 phrase-breath survival aggregate를 보여준다. 여기서 `plan`, `cov`, `pickup`, `arr`, `rel`, `weakManifests`는 pickup lift, arrival broadening, release easing이 최근 successful manifest에서 얼마나 안정적으로 살아남는지 보는 compact signal이다.
- `latest.json`의 `summary.manifestAudioRetry.harmonicColorTrends`와 `latest.md`의 `## Harmonic-Color Trend` section은 최근 성공 manifest 기준 harmonic-color survival aggregate를 보여준다. 여기서 `plan`, `cov`, `target`, `time`, `tonic`, `prolong`, `weakManifests`는 local color target survival, timing clarity, tonicization pressure, prolongation motion pressure를 compact하게 읽는 signal이다.
- `latest.json`의 `summary.manifestAudioRetry.shadowReranker`와 `latest.md`의 `## Shadow Reranker` section은 recent learned-vs-heuristic disagreement aggregate를 보여준다. 여기서 `scored`, `disagreements`, `highConfidence`, `promotions`, `agreementRate`, `avgConfidence`는 learned lane 상태를 compact하게 요약한다. disagreement line은 어떤 `songId`에서 learned top이 heuristic winner와 달랐는지 1차로 보여주고, promotion line은 narrow lane에서 실제 learned authority promotion이 적용된 `songId`, `lane`, `selected`, `heuristicCounterfactual`을 함께 보여준다. 추가로 `promotionOutcomes`는 reviewed promoted runs와 reviewed heuristic-authoritative runs를 같은 narrow lane에서 묶어 approval rate와 average appeal score를 비교하고, markdown에는 `outcomes lane=... | promotedApprovalRate=... | heuristicApprovalRate=...` line으로 재노출된다. `promotionAdvantage`는 delta를 유지하되 reviewed sample이 총 4건 미만이거나 cohort별 2건 미만이면 `signal=insufficient_data`와 `sufficientSample=no`로 보수적으로 표시된다. 같은 object 아래 `runtimeWindow`는 recent runtime sampled shadow runs 기준 disagreement pressure를 따로 집계하고, markdown에는 `runtimeWindow=<n>h | sampledRuns=...` line으로 재노출된다.
- `latest.json`의 `summary.manifestAudioRetry.orchestrationTrends.familyRows[]`와 dashboard의 `Orchestration Trends` 카드는 최근 성공 manifest 기준 family별 평균 `idiomaticRangeFit`, `registerBalanceFit`, `ensembleConversationFit`, weak-manifest pressure를 보여준다. 현재는 `string_trio`가 유일한 family지만, 이 card는 timbre change log가 아니라 ensemble writing competence trend를 읽는 자리다.
- canonical operator summary의 `artifacts`와 `latest.md`도 같은 aggregate를 compact하게 재노출한다. 현재는 `orchestrationTrend family=trio manifests=... rng=... bal=... conv=... weakManifests=... avgWeakSections=... instruments=...` 형식의 line을 쓰므로, projection consumer가 raw `manifestAudioRetry` JSON 전체를 열지 않아도 최근 ensemble-writing pressure를 바로 읽을 수 있다.
- 해석 기준으로, `phraseBreathTrend`는 harmony correctness의 대체 지표가 아니다. weak-manifest pressure가 보이면 raw JSON을 열기 전에 pickup/arrival/release survival을 먼저 의심할 수 있다는 뜻이며, section-local 판단은 여전히 `section-artifacts.json`과 audio evaluation을 직접 봐야 한다.
- 해석 기준으로, richer SoundFont나 render timbre는 `orchestration` snapshot의 근거가 아니다. `orchestration=...` compact token과 tracking snapshot은 register handoff, balance, conversational exchange 같은 ensemble-aware writing competence를 뜻하며, timbre upgrade와는 별개로 읽는다.
- `latest.md`와 `latest.json`에 triage state, severity, severityScore, severityDrivers, reasonCodes가 포함된다.
- `latest.json`의 `evidence.stale`, `maxSkewMs`, endpoint `fetchedAt`로 stale evidence 여부를 확인할 수 있다.
- `outputs/_system/operator-summary/history/YYYY-MM-DD.jsonl`에 새 줄이 append된다.
- 실패 시 `latest-error.json`이 남는다.

systemd 상태 확인:

```bash
systemctl status axiom-operator-summary.timer
systemctl status axiom-operator-summary.service
journalctl -u axiom-operator-summary.service -n 50 --no-pager
```

## Failure handling

projection 실패는 숨기지 않는다. 다음 파일을 우선 확인한다.

- `outputs/_system/operator-summary/latest-error.json`
- `outputs/_system/operator-summary/errors/YYYY-MM-DD.jsonl`

분류 기준:

- AXIOM app reachability 문제: `AXIOM /ready`, `/jobs`, `/autonomy/ops`, `/overseer/summary` 연결 실패
- summary contract 문제: JSON parse 실패 또는 필수 shape 누락
- stale evidence 문제: endpoint skew 또는 oldest age가 threshold를 넘어서 `evidence.stale=true`
- scheduler 문제: timer는 정상인데 AXIOM runtime evidence가 stale

## Guardrails

1. 이 timer는 read-heavy projection만 수행한다.
2. state mutation이나 compose trigger를 같은 unit에 섞지 않는다.
3. gcpCompute는 projection pickup plane이지 AXIOM truth plane이 아니다.
4. 실패 evidence를 지우기 전에 root cause를 기록한다.
5. bridge가 건강하면 team-facing status 설명은 `upstream.axiom.*`와 bridge-side projection을 우선하고, 이 artifact는 그 입력으로 본다.
