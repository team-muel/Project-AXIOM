# Autonomy 운영 정책

이 문서는 AXIOM autonomy scheduler를 실제 운영 기준으로 켜기 위한 기본 `.env` 값과 일일 운영 규칙을 정리한다.

## 권장 `.env` 값

기본 운영 프로필은 daily mode 기준이다.

```env
AUTONOMY_ENABLED=true
AUTONOMY_SCHEDULER_ENABLED=true
AUTONOMY_SCHEDULER_POLL_MS=30000
AUTONOMY_SCHEDULER_INTERVAL_MS=0
AUTONOMY_SCHEDULER_TIME=10:30
AUTONOMY_SCHEDULER_TIMEZONE=Asia/Seoul
AUTONOMY_MAX_ATTEMPTS_PER_DAY=2
AUTONOMY_STALE_LOCK_MS=3600000
AUTONOMY_AUTO_CLEAR_STALE_LOCKS=true
RETRY_BACKOFF_MS=2000
MUSICGEN_TIMEOUT_MS=1800000
```

의도는 다음과 같다.

- `AUTONOMY_SCHEDULER_TIME=10:30`: 한국 시간 오전 운영 점검 이후 첫 자동 작곡 시도
- `AUTONOMY_MAX_ATTEMPTS_PER_DAY=2`: 1회 기본 시도 + 1회 복구 슬롯
- `AUTONOMY_STALE_LOCK_MS=3600000`: 60분 이상 live queue job 없이 남은 lock만 stale로 간주
- `AUTONOMY_AUTO_CLEAR_STALE_LOCKS=true`: 다음 trigger 전에 stale lock을 자동 정리

주의: autonomy ledger day key와 daily cap 계산은 모두 `AUTONOMY_SCHEDULER_TIMEZONE` 기준으로 저장되고 집계된다.

## 일일 정책

1. scheduler는 interval mode가 아니라 daily mode로 운영한다.
2. 일일 cap은 scheduler timezone 기준 날짜로 계산한다.
3. 첫 번째 시도는 scheduler가 만든다.
4. 같은 날 두 번째 시도는 첫 번째 run이 실패했거나 반려됐을 때의 복구 슬롯으로 본다.
5. pending approval이 남아 있으면 새 autonomy trigger는 막는다.
6. live job 없이 오래 남은 lock은 stale lock으로 보고 자동 또는 수동으로 정리한다.
7. exact `promptHash`뿐 아니라 같은 날 이미 승인 또는 진행 중인 `planSignature`와 사실상 같은 planner plan도 새 autonomy trigger에서 막는다.

## 운영 확인 포인트

- `GET /autonomy/status`: 기존 상태 응답에 `operations`가 추가되어 daily cap, stale lock, queue 요약을 함께 반환한다. `lastRun.plannerTelemetry`가 있으면 마지막 selection strategy, candidate, parser mode, novelty score까지 함께 확인할 수 있다. 또한 `feedbackHighlights`가 최근 human feedback의 positive factor, negative factor, rejection reason, comparison reference 요약과 승인/반려 집계를 별도로 노출한다.
- `GET /autonomy/ops`: 운영자용 요약 응답만 따로 조회한다. `lastRun`은 ledger 기준 최신 planner telemetry를 포함하며, `feedbackHighlights`로 최근 승인/반려 피드백 요약을 함께 보여준다. pending approval manifest에 `structureEvaluation.longSpan`가 있으면 `pendingApprovals[].longSpan`도 함께 내려와 operator가 long-span 상태를 `held`, `at_risk`, `collapsed`로 바로 읽을 수 있다.
- `GET /autonomy/pending`: 현재 `pending approval` 상태의 곡 요약(`songId`, prompt, qualityScore 등)을 반환한다. manifest `structureEvaluation.longSpan`가 있으면 compact `longSpan` snapshot(`status`, `weakestDimension`, fit 값)이 함께 내려오므로 approval queue에서 긴 형식 collapse를 우선 검수할 수 있다. manifest meta에 telemetry가 있으면 `plannerTelemetry`도 함께 내려오므로 fallback 복구로 생성된 곡을 선별 검수할 수 있다.
- `GET /mcp/health`: remote operator bootstrap과 shared gcpCompute smoke check용 MCP diagnostics surface다. readiness, queue summary, MCP auth posture, latest `operator-summary` / `operator-sweep` / `operator-pickup` artifact 존재 여부를 함께 보여주므로, mutation 전 shared lane이 어떤 상태인지 빠르게 확인할 수 있다. 해당 artifact가 phrase-breath, harmonic-color, learned-backbone benchmark, orchestration trend, shadow-reranker disagreement snapshot을 들고 있으면 `operatorArtifacts.*.phraseBreathTrend`, `operatorArtifacts.*.harmonicColorTrend`, `operatorArtifacts.*.learnedBackboneBenchmark`, `operatorArtifacts.*.orchestrationTrend`, `operatorArtifacts.*.shadowReranker`로 availability, weak pressure 유무, 짧은 `advisory` 문구를 함께 확인할 수 있다.
- `POST /autonomy/preview`: enqueue 전에 planner가 만든 request/plan 초안을 미리 확인한다. 응답에는 `noveltySummary`와 `candidateSelection`이 포함될 수 있으며, `planSignature`, `noveltyScore`, 반복 축(`repeatedAxes`), 최근 유사 plan match 요약과 함께 어떤 planner candidate가 선택됐는지(`strategy`, `selectedCandidateId`, 후보별 `selectionScore`)를 보여준다.
- planner가 strict JSON을 깨뜨린 경우에도 preview는 freeform 응답에서 form, key, meter, tempo, instrumentation, phrasing cue를 최대한 추출해 richer fallback plan으로 복구한다.
- `POST /autonomy/trigger`: local runtime 또는 break-glass manual path에서는 실제 autonomy run enqueue entrypoint로 동작한다. 성공 응답은 `request`, `rationale`, `inspirationSnapshot`, `planSummary`, `noveltySummary`, `candidateSelection`을 함께 돌려주므로 어떤 planner candidate가 실제 run으로 올라갔는지 즉시 확인할 수 있다. 다만 shared remote operator 정책상 이 endpoint는 여전히 routine mutation이 아니라 Class C로 간주한다.
- `POST /autonomy/reconcile-lock`: stale lock을 즉시 정리한다.

`operations.dailyCap`는 오늘 사용한 시도 수와 남은 슬롯을 보여준다.

`operations.lockHealth`는 다음을 보여준다.

- 현재 lock 존재 여부
- lock age
- stale 여부
- 자동 정리 가능 여부
- queue job 또는 terminal manifest와의 불일치 여부

## Mutation 승인 모델

remote operator 기준으로 autonomy mutation은 모두 같은 위험도가 아니다. 현재 운영 기준은 다음과 같이 고정한다.

- 허용 Class A: `pause`, `resume`, `reconcile_lock`
- 허용 Class B: `approve`, `reject`
- 미승인 Class C: `trigger`, `compose`, future queue mutation

Class A 규칙:

- 단일 operator 승인을 허용한다.
- 실행 전 `GET /autonomy/ops` 또는 canonical operator summary로 근거를 남긴다.
- canonical operator summary의 `artifacts`에서 backlog/pending line은 compact quality 힌트로 `orchestration=...`, `structureLongSpan=...`, `audioLongSpan=...`, `longSpanDivergence=...`를 함께 실을 수 있다. shared operator lane에서는 이 토큰을 manifest drill-down 전 1차 triage 신호로 사용한다.
- 같은 `artifacts`와 projection `latest.md`는 recent successful manifest aggregate를 `orchestrationTrend family=... manifests=... rng=... bal=... conv=...` 형식으로 재노출하고, doubling pressure, texture rotation, handoff trend가 있으면 optional `dbl=...`, `rot=...`, `hnd=...` token도 함께 붙인다. 이 값은 timbre 품질이 아니라 ensemble-writing pressure summary다.
- `resume`은 pause 원인이 해소됐다는 fresh evidence가 있어야 한다.
- `reconcile_lock`은 stale 또는 mismatch recovery 상황에서만 사용한다.

Class B 규칙:

- 사람의 명시적 승인 또는 반려만 허용한다.
- `songId`, 메모 또는 반려 사유, 관련 manifest/evaluation evidence를 함께 남긴다.
- 가능하면 `appealScore`, `strongestDimension`, `weakestDimension`, `comparisonReference`를 같이 남긴다. 이 필드들은 manifest `reviewFeedback`와 `outputs/_system/preferences.json`의 `humanFeedbackSummary`에 함께 반영된다.
- approve/reject가 기록되면 runtime은 같은 payload에 현재 고정 review contract 버전인 `reviewRubricVersion=approval_review_rubric_v1`도 함께 남긴다.
- unattended automation이나 wrapper가 대신 판단하면 안 된다.

허용된 Class A/B mutation은 모두 truth-plane audit artifact를 남긴다.

- 저장 위치: `outputs/_system/operator-actions/latest.json`, `outputs/_system/operator-actions/history/YYYY-MM-DD.jsonl`
- 최소 필드: `actor`, `surface`, `action`, `reason`, `input`, `before`, `after`, `artifactLinks`, `approvedBy`, `observedAt`
- 권장 확장 필드: `rollbackNote`, `manualRecoveryNote`
- 현재 기록 대상: `pause`, `resume`, `reconcile_lock`, `approve`, `reject`
- API와 MCP surface는 optional `actor`, `approvedBy`, `rollbackNote`, `manualRecoveryNote`를 받아 기록하고, 값이 없으면 surface명이 fallback actor가 된다.
- `artifactLinks`는 rollback 또는 manual recovery 판단에 필요한 `state.json`, `preferences.json`, manifest, run ledger 같은 persisted evidence를 가리킨다.

Class C 규칙:

- shared remote operator lane에서는 아직 routine mutation으로 쓰지 않는다.
- audit trail과 rollback contract가 고정되기 전까지는 break-glass local/manual path로만 본다.

중복 진입점 정리 기준:

- remote team operator path는 MCP `axiom_autonomy_*` 또는 bridge `upstream.axiom.*`를 canonical로 본다. legacy dotted alias는 계속 허용한다.
- HTTP `/autonomy/*` route는 local runtime, test, break-glass recovery용 fallback으로 남긴다.
- mutation 전용 새 CLI/script wrapper는 추가하지 않는다.

## Expression 검수 루틴

expression contour나 articulation이 중요한 autonomy run은 scheduler 상태만 보고 승인하면 안 된다. planner가 expression을 명시했고 symbolic 파이프라인이 이를 끝까지 보존했는지 아래 순서로 확인한다.

1. `POST /autonomy/preview`로 planner가 만든 `expressionDefaults`, section별 `expression`, `tempoMotion`, `ornaments`, `humanizationStyle`가 실제로 채워지는지 본다.
2. `GET /autonomy/pending` 또는 `GET /autonomy/ops`에서 `songId`를 확인한다.
3. `outputs/<songId>/manifest.json`의 `structureEvaluation.metrics.expressionPlanFit`, `audioEvaluation.metrics.audioTempoMotionPlanFit`, `audioEvaluation.metrics.audioHarmonicRealizationPlanFit`, `audioEvaluation.metrics.audioTonicizationRealizationFit`, `audioEvaluation.metrics.audioProlongationRealizationFit`, `audioEvaluation.metrics.audioHarmonicColorRealizationFit`, `audioEvaluation.metrics.audioOrnamentPlanFit`, `audioEvaluation.metrics.audioOrnamentArpeggioFit`, `audioEvaluation.metrics.audioOrnamentGraceFit`, `audioEvaluation.metrics.audioOrnamentTrillFit`, `audioEvaluation.metrics.audioUnsupportedOrnamentTagCount`, 그리고 `qualityControl.attempts[].directives`를 확인한다. 반복적으로 `shape_dynamics` 또는 `clarify_expression`가 남았다면 expression drift가 있었다는 뜻이고, `shape_tempo_motion`가 반복되면 humanize 뒤에도 local tempo-motion cue가 충분한 note-bearing material 위에 남지 않았다는 뜻이다. `stabilize_harmony` 또는 `clarify_harmonic_color`가 반복되면 tonicization, prolongation, 또는 local color shaping이 audio에서 충분히 남지 않는다는 뜻이다. `shape_ornament_hold`가 반복되면 fermata hold가 target arrival를 잡았더라도 sustain contrast가 audio에서 충분히 들리지 않는다는 뜻이다. 반대로 `audioOrnamentArpeggioFit`, `audioOrnamentGraceFit`, 또는 `audioOrnamentTrillFit`가 낮고 hold 관련 directive가 없다면, rolled onset, short lead-in, oscillating trill contour 자체는 평가되었지만 아직 retry policy가 없는 ornament compression 문제일 가능성이 높다. unsupported ornament count만 올라가고 hold, arpeggio, grace-note, trill 관련 issue가 없다면, 해당 tag는 아직 metadata-only로 보존되고 있다는 뜻이다.
4. `outputs/<songId>/score-preview.svg`를 열어 `Expression Profile` 패널이 planner cue와 대체로 맞는지 본다. 현재 이 패널에는 dynamics, texture, tempo-motion뿐 아니라 fermata 같은 ornament cue, phrase-breath realization compact fragment(`breath fit ...` with pickup or arrival or release and, when present, recovery or rubato evidence), 그리고 harmonic realization compact fragment(`harm fit ...`)도 함께 드러날 수 있다. symbolic_plus_audio라면 `manifest.artifacts.renderedAudio`와 `manifest.artifacts.styledAudio`도 함께 청취해 dynamics/articulation, local hold, phrase-breath cadence reset, prolongation or tonicization broadening 인상이 유지되는지 확인한다.

점검 결과 `expression-plan.json`은 존재하지만 score preview에 expression summary가 전혀 없거나 `expressionPlanFit`가 낮게 남아 있으면, scheduler 문제라기보다 planner-to-render 전달 또는 compose realization 품질 문제로 보는 편이 맞다.

## 운영 해석 기준

- `reason=no_active_lock`: 현재 autonomy lock 없음
- `reason=active_job_present`: 정상적으로 queue job이 lock을 뒷받침 중
- `reason=waiting_for_queue_registration`: enqueue 직후의 짧은 과도 구간
- `reason=queue_run_mismatch`: control state와 queue가 다른 run을 가리킴
- `reason=terminal_manifest_exists`: 작업은 끝났는데 lock이 남아 있음
- `reason=lock_timeout_without_active_job`: live job 없이 lock만 오래 남아 있음

## Overseer 운영 참고

- `GET /overseer/summary`: `manifestAudioRetry` 아래에 audio retry 집계와 함께 `successfulSectionPatterns`, `phraseBreathTrends`, `harmonicColorTrends`, `learnedProposalWarnings`, `learnedBackboneBenchmark`, `shadowReranker`, `orchestrationTrends`, `recentManifestTracking`가 포함된다.
- `phraseBreathTrends`는 최근 성공 manifest 기준 phrase-breath survival aggregate다. `averagePlanFit`, `averageCoverageFit`, `averageArrivalFit`, `averageReleaseFit`, `weakManifestCount`를 통해 pickup/arrival/release pressure를 compact하게 본다.
- `harmonicColorTrends`는 최근 성공 manifest 기준 harmonic-color survival aggregate다. `averagePlanFit`, `averageCoverageFit`, `averageTargetFit`, `averageTimingFit`, `averageTonicizationPressureFit`, `averageProlongationMotionFit`, `weakManifestCount`를 통해 local color, tonicization pressure, prolongation motion pressure를 compact하게 본다.
- `learnedProposalWarnings`는 recent learned symbolic candidate evidence에서 `proposalEvidence.normalizationWarnings`를 다시 읽어 sampled manifest 수, warning이 남은 proposal 수, total warning count, role-collapse count, 대표 warning 문구를 compact하게 보여준다. persisted schema를 늘리지 않고 candidate sidecar에서 derivation한 aggregate다.
- `learnedBackboneBenchmark`는 recent paired baseline-vs-learned narrow-lane evidence를 같은 truth-plane payload에서 다시 묶어 보여준다. `runCount`, `pairedRunCount`, `reviewedRunCount`, `pendingReviewCount`, `approvalRate`, `averageAppealScore`, `blindPreference`, `shortlistBlindPreference`, `reviewedTop1Accuracy`, `promotionGate`, `reviewSampleStatus`, `reviewQueue`, `disagreementSummary`, `retryLocalizationStability`, `selectionModeCounts`, `searchBudgetCounts`, `searchBudgetRows`, `promotionAdvantage`, `topFailureModes`, `topStopReasons`, `recentRunRows`를 함께 내려주므로 Stage A와 Stage C gate를 raw sidecar 재집계 없이 operator surface에서 바로 읽을 수 있다. 여기서 `searchBudgetRows`는 selected attempt의 whole-piece candidate count를 기준으로 `S0/S1/S2/S3/S4/custom` bucket을 다시 묶어 blind preference와 reviewed top-1 accuracy를 search budget별로 바로 비교하게 해 준다. custom intermediate budget은 `searchBudgetLevel=custom` 계약을 유지하되 `searchBudgetDescriptor`에 `custom(3)` 또는 `custom(3+1)`처럼 whole-piece와 localized rewrite branch shape를 함께 실어 operator line, recent run row, pending review row에서 그대로 구분한다. `shortlistBlindPreference`는 persisted shadow shortlist 안에 selected candidate가 남아 있던 benchmark run만 다시 필터링해 blind review 결과를 요약한 값이라, C3에서 필요한 shortlist-phase readout을 전체 backbone blind preference와 분리해 볼 수 있다. `reviewQueue`는 paired benchmark run 중 아직 blind review 결과가 없는 song을 같은 payload에서 다시 모아 `pendingBlindReviewCount`, `pendingShortlistReviewCount`, `recentPendingRows[]`로 보여준다. shortlist evidence가 남은 run은 `reviewTarget=shortlist`로 먼저 올라오므로 Day 61-90의 “pairwise or shortlist decisions” review routing을 operator surface에서 바로 시작할 수 있다. blind review pack generator `scripts/create-learned-backbone-review-pack.mjs`도 이제 `--pendingOnly`, `--reviewTarget=shortlist|pairwise|all`, optional `--searchBudget=<descriptor-or-level>` 필터를 받아 이 queue를 직접 blind review artifact로 옮길 수 있다. active pack row와 `reviewPackAction` artifact는 pack-level `searchBudget` scope를 같이 남기므로 custom budget cell을 generic pairwise queue와 섞지 않고 바로 worksheet로 넘길 수 있다. 다만 active blind-review pack이 이미 있어도 그 pack들이 현재 pending queue를 모두 덮지 못하면 operator surface는 uncovered pending pair 수만큼 supplemental `reviewPackAction`을 다시 연다. 반대로 existing worksheet를 마저 닫아야 할 때는 `reviewPackRecordActions[]`가 current `review-sheet.csv` ingest command를 우선 surface로 남긴다. blind review 결과만으로는 `reviewedRunCount`가 늘지 않으므로 approval-rate 또는 appeal-score gate를 채워야 할 때는 `npm run ml:manifest-review:learned-backbone -- --snapshot <sheet>`로 pending manifest review worksheet를 만들고, `outputs/_system/ml/review-manifests/learned-backbone/<sheet>/review-sheet.csv`의 `approvalStatus` column에 `approved` 또는 `rejected`를 채운 뒤 `npm run ml:manifest-review:record:learned-backbone -- --resultsFile <review-sheet.csv>`로 ingest한다. 이때 autonomy source row는 기존 approve/reject service를 타므로 operator audit trail과 `outputs/_system/preferences.json` human-feedback summary까지 함께 갱신되고, benchmark `source=api` row는 autonomy preference memory를 섞지 않도록 manifest만 직접 갱신한다. `S4`는 same-attempt mixed candidate set 안에 whole-piece 후보와 localized rewrite branch 후보가 함께 존재한 경우만 잡히므로, ordinary later retry attempt의 `targeted_section_rewrite`와 혼동하지 않는다. `recentRunRows`도 같은 `searchBudgetLevel`과 `wholePieceCandidateCount`를 실어 최근 run이 어느 budget cell에 속했는지 함께 보여준다. `reviewedTop1Accuracy`는 persisted learned-backbone blind review pack 결과를 oracle로 삼아 current runtime selected worker가 decisive blind winner와 일치했는지 요약한다. `promotionGate`는 reviewed floor, disagreement floor, reviewed shortlist retained-in-topK floor, retry stability, blind preference availability, approval or appeal deltas를 묶어 learned backbone이 아직 `experimental`, `review_hold`, `blocked`, 또는 `ready_for_guarded_promotion`인지 같은 payload에서 바로 이름 붙인다. `STRUCTURE_RERANKER_PROMOTION_ENABLED`가 켜져 있어도 runtime narrow-lane promotion은 이 gate가 `ready_for_guarded_promotion`일 때만 실제 authority override를 허용한다. 이 값도 persisted candidate sidecar와 manifest review metadata에서 derivation한 aggregate이며 별도 summary file을 source of truth로 두지 않는다.
- `string_trio_symbolic` narrow lane은 HTTP `/compose`와 MCP `axiom.compose` request의 `candidateCount`와 optional `localizedRewriteBranches`를 live search-budget 입력으로 받아 같은 attempt 안에서 baseline/learned 후보를 교차 확장한다. `candidateCount` 2는 S1, 4는 S2, 8은 S3 whole-piece budget으로 해석되고, `candidateCount=4`와 `localizedRewriteBranches=2`를 같이 주면 top whole-piece 후보의 weakest sections를 겨냥한 same-attempt localized rewrite branch가 추가되어 S4 cell을 구성한다. `candidateCount=3`에 `localizedRewriteBranches=1`을 명시하면 공식 matrix cell은 아니지만 paired minimum보다 큰 custom mixed budget으로 한 개 추가 whole-piece candidate와 한 개 localized rewrite branch를 같은 attempt에 같이 남길 수 있다. 첫 baseline/learned pair는 기존 deterministic seed와 candidate id를 유지한다. 추가 whole-piece 슬롯만 `baseline-2`, `learned-2`, `baseline-3`, `learned-3`처럼 variant key로 seed와 candidate id를 분기하고, rewrite branch는 같은 attempt 안에서 `-rewrite` variant key를 붙여 candidate sidecar를 restart-safe하게 누적하므로 existing S1 audit surface를 깨지 않으면서 higher-budget search evidence를 truth-plane에 그대로 남긴다.
- `shadowReranker`는 최근 manifest 중 shadow scoring evidence가 남은 곡들을 기준으로 learned-vs-heuristic disagreement count, high-confidence disagreement count, 평균 learned confidence, 최신 disagreement 요약을 compact하게 보여준다. 이제 narrow lane promotion이 실제로 적용된 run은 같은 payload의 `promotedSelectionCount`와 `recentPromotions[]`에도 잡히며, operator는 여기서 selected candidate와 heuristic counterfactual candidate를 같이 볼 수 있다. 같은 payload의 `shortlist`와 `recentShortlists[]`는 persisted candidate sidecar의 learned rank를 다시 읽어 top-K distribution, current selected candidate의 shortlist 포함률과 top-1 일치율, 그리고 최근 run에서 사람이 검토해야 할 shortlisted candidate ids를 compact하게 보여준다. 같은 payload의 `promotionOutcomes`는 reviewed promoted runs와 reviewed heuristic-authoritative runs를 같은 lane으로 묶어 approval rate와 average appeal score를 비교하고, `promotionAdvantage`는 그 차이를 approval delta, appeal delta, leader signal로 압축해 Stage L5 exit criterion 1을 한눈에 읽게 한다. 다만 이 signal은 reviewed sample이 총 4건 미만이거나 promoted and heuristic cohort가 각각 2건 미만이면 `insufficient_data`로 고정되고, payload에 `sufficientReviewSample`, `minimumReviewedManifestCount`, `minimumReviewedPerCohortCount`도 함께 들어와 sparse evidence를 과대해석하지 않게 한다. 동일 payload 아래 `runtimeWindow`도 함께 내려오며, 최근 `windowHours` 기준 sampled runtime shadow runs, disagreement pressure, high-confidence disagreement pressure, agreement rate, 마지막 관측 시각을 보여준다.
- `npm run ml:shadow:structure-rank:runtime-summary -- --windowHours <n>`는 `outputs/_system/ml/runtime/structure-rank-v1-shadow-history/YYYY-MM-DD.jsonl`을 직접 읽어 같은 runtime-window summary를 CLI로 재출력한다. operator summary나 projection과 숫자가 다르면 runtime window 또는 outputDir가 서로 다른지 먼저 확인한다.
- `scripts/project-operator-summary.mjs`가 만드는 `latest.md`에는 `## Orchestration Trends` section이 추가되어, raw JSON을 열지 않고도 family-level average range/balance/conversation fit과, 존재하면 doubling pressure, texture rotation, section-handoff fit까지 함께 보고 weak-manifest pressure를 확인할 수 있다.
- 같은 projection은 `## Phrase-Breath Trend` section도 추가해 최근 successful manifest의 phrase-breath survival pressure를 compact line으로 보여준다.
- 같은 projection, unattended sweep incident draft, shared pickup bundle은 `## Harmonic-Color Trend` section도 추가해 recent successful manifest의 local color survival pressure를 compact line으로 보여준다.
- 같은 projection, unattended sweep incident draft, shared pickup bundle은 `## Learned Proposal Warnings` section도 추가해 recent learned symbolic proposal에서 누적된 normalization warning과 role-collapse pressure를 raw candidate sidecar 없이 바로 확인할 수 있게 한다.
- 같은 projection과 canonical operator summary `artifacts`는 `## Learned Backbone Benchmark` section 및 `learnedBackboneBenchmark ...` artifact lines를 추가해 recent benchmark aggregate, config snapshot, `blindPreference`, `shortlistBlindPreference`, `reviewedTop1Accuracy`, `reviewQueue`, search-budget breakdown, `promotionGate`, 대표 failure mode, stop reason, recent run rows를 raw candidate sidecar 없이 바로 확인할 수 있게 한다.
- unattended sweep latest/incident draft와 shared pickup bundle도 같은 `## Learned Backbone Benchmark` section을 보존한다. 여기서는 `reviewSampleStatus`, `blindPreference`, `reviewedTop1Accuracy`, `reviewQueue`, search-budget breakdown, `promotionGate`, `retryLocalizationStability`, `promotionAdvantage`, advisory line을 같이 읽어 Stage A/C sample floor, selected top-1 quality, retry drift, guarded promotion hold 또는 ready 상태, 그리고 아직 사람이 봐야 할 pending blind review backlog를 downstream handoff에서도 바로 확인할 수 있다.
- 같은 projection, unattended sweep incident draft, shared pickup bundle은 `## Shadow Reranker` section도 추가해 recent disagreement count와 최근 mismatch song summary를 raw candidate sidecar 없이 1차 triage 할 수 있게 한다. 이제 같은 section 안에는 `runtimeWindow=<n>h` line뿐 아니라, 실제 authority promotion이 발생한 경우 `promotion song=... | lane=... | selected=... | heuristicCounterfactual=...`, `outcomes lane=... | promotedApprovalRate=... | heuristicApprovalRate=...`, `promotionAdvantage lane=... | sufficientSample=... | approvalDelta=... | appealDelta=... | signal=...`, `shortlist lane=... | topK=... | selectedInTopK=... | top1=...`, `shortlist song=... | topK=... | selectedRank=... | shortlisted=...`, `retryLocalization lane=... | promotedTargetedRate=... | heuristicTargetedRate=...` line도 들어와 최근 narrow-lane learned shortlist pressure, promotion, review outcome delta, retry locality split을 바로 확인할 수 있다. unattended sweep recommendation과 incident/shared pickup advisory도 같은 sufficiency guard를 따라 sparse reviewed sample에서는 widening 신호 대신 `still sparse` 문구를 남긴다.
- `GET /overseer/dashboard`: 최근 성공 manifest에서 반복된 bass motion profile과 section style을 `Bass Motion Trends`, `Section Style Trends` 카드로 보여주고, orchestration snapshot이 있는 성공 manifest는 `Orchestration Trends` 카드에서 family별 평균 range/balance/conversation fit, doubling pressure, texture-rotation pressure, handoff pressure와 weak-manifest pressure를 집계한다.

이 집계는 최근 planner memory와 같은 성공 기준을 사용한다.

중요: `Orchestration Trends`는 SoundFont나 render timbre 품질이 아니라 ensemble-aware writing competence를 뜻한다. timbre upgrade와 instrument distribution competence를 같은 신호로 읽지 않는다.

중요: `Phrase-Breath Trend`는 harmony correctness의 대체 지표가 아니다. pickup lift, arrival broadening, release easing이 최근 successful manifest에서 얼마나 잘 살아남는지를 보는 signal이며, 개별 곡의 phrasing 판정은 여전히 `section-artifacts.json`과 audio evaluation 세부 항목을 직접 확인해야 한다.

중요: `Harmonic-Color Trend`도 harmony correctness 전체의 대체 지표가 아니다. mixture, applied dominant, suspension, pedal, prolongation 같은 local color cue가 rendered/styled survival 단계에서 얼마나 안정적으로 남는지 보는 signal이며, 개별 곡의 harmonic-color 판단은 여전히 해당 `manifest.json`, `section-artifacts.json`, audio evaluation 세부 항목을 직접 확인해야 한다.

중요: overseer 요약과 dashboard는 trend-level surface다. 개별 곡의 expression survival 여부는 여기서 최종 판정하지 말고, 해당 `songId`의 `manifest.json`, `expression-plan.json`, `section-artifacts.json`, `score-preview.svg`를 직접 확인해야 한다.

- `state=DONE`
- 승인된 manifest이거나 structure pass/score 기준을 넘긴 manifest
- section finding score가 너무 낮거나 이슈가 많은 section은 제외

## MCP 운영 제어

MCP에서도 같은 정보와 제어를 쓸 수 있다.

- `axiom_autonomy_status`
- `axiom_autonomy_ops`
- `axiom_autonomy_reconcile_lock`
- `axiom_autonomy_pause`
- `axiom_autonomy_resume`
- `axiom_autonomy_approve`
- `axiom_autonomy_reject`

원격 운영 기준으로는 `ops`를 먼저 확인하고, 허용된 mutation만 MCP surface에서 호출한다. `trigger`는 아직 shared remote operator lane의 승인 대상이 아니므로, stale lock recovery 직후에도 routine path로 이어서 호출하지 않는다.

승인 또는 recovery를 호출했다면 후속 검증에서 `outputs/_system/operator-actions/latest.json` 또는 당일 `history` JSONL도 함께 확인하는 편이 안전하다.
