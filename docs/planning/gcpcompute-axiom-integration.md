# AXIOM gcpCompute Collaboration Plan

## Position

AXIOM은 gcpCompute를 드문 fallback이 아니라 팀 공용 상시 control plane으로 취급한다. 다만 queue, autonomy, manifest, Overseer의 source of truth는 계속 AXIOM runtime이 소유한다.

## Design Signals Imported From Existing Bridge Operations

기존 외부 bridge와 remote gcpCompute 운영을 기준으로 다음 신호를 핵심 설계에 반영한다.

- gcpCompute는 SSH stdio MCP로 부팅되는 고정 remote unified server이며, 로컬 `.env`와 다른 운영 env를 소스한다.
- `MCP_UPSTREAM_SERVERS`와 `upstream.axiom.*` 패턴이 이미 존재하므로 AXIOM은 cross-repo orchestration surface로 자연스럽게 들어갈 수 있다.
- GCP VM은 24/7 service와 원격 전용 adapter를 보유한 운영면이며, local developer workstation이 꺼져 있어도 계속 동작하는 path로 쓰인다.
- 팀 bootstrap이 SSH key와 GCP 접근을 기본 전제로 삼고 있으므로, shared remote ops는 예외가 아니라 정상 경로다.
- remote VM checkout은 상태 없는 mirror가 아니라 운영 상태를 가진 machine일 수 있으므로, source-of-truth code tree처럼 다루면 안 된다.

## Core Architecture

### 1. Truth plane

AXIOM runtime이 계속 소유한다.

- queue state
- autonomy state
- persisted manifests
- Overseer reports and summaries
- readiness semantics
- restart recovery

### 2. Control plane

gcpCompute가 적극적으로 담당한다.

- team-shared operational inspection
- unattended or scheduled summary collection
- remote-only adapters and orchestration helpers
- bridge verification and token/reachability checks
- AXIOM state를 shared docs/Obsidian/operator surface로 projection

### 3. Bridge plane

외부 bridge implementation이 담당한다.

- `MCP_UPSTREAM_SERVERS`를 통한 `upstream.axiom.*` exposure
- AXIOM, Obsidian, 외부 adapter를 묶는 cross-repo workflow
- bridge가 건강할 때의 단일 operator entrypoint

### 4. Evidence plane

공유 문서 또는 Obsidian surface에 다음 evidence를 남기는 방향으로 설계한다.

- queue/autonomy snapshots
- Overseer daily summaries
- repeated warning digests
- bridge validation results
- retry/backoff, quality policy, autonomy cadence shadow comparisons

## What Aggressive Use Means

1. cross-repo, shared, unattended, remote-adapter 의존 작업은 gcpCompute를 기본 team ops lane으로 본다.
2. bridge가 살아 있으면 ad hoc HTTP 호출보다 `upstream.axiom.*`를 우선 사용한다.
3. gcpCompute는 read-heavy operational sweep를 주기적으로 수행하는 면으로 사용한다.
4. 사람은 raw log를 뒤지는 대신 요약된 operator evidence를 읽도록 surface를 설계한다.
5. 정책 변경은 runtime 기본값을 바로 바꾸지 말고 control plane에서 shadow review를 먼저 수행한다.

우선 대상 도구는 다음과 같다.

- `axiom_job_list`
- `axiom_manifest_list`
- `axiom_overseer_last_report`
- `axiom_overseer_summary`
- `axiom_autonomy_status`
- `axiom_autonomy_pending`

## Imported Team gcpCompute Path

기존 외부 bridge에서 이미 굴리고 있는 팀 운영 경로는 AXIOM 문서에서도 그대로 유지한다.

1. gcpCompute 또는 외부 unified bridge에서 AXIOM 상태를 볼 때는 raw HTTP 호출보다 `upstream.axiom.*`를 먼저 사용한다.
2. shared note, task, incident projection이 필요하면 AXIOM이 직접 vault를 쓰지 않고 외부 bridge의 `obsidian.axiom.project`가 projection layer가 된다.
3. projection target이 애매하면 local vault path 존재 여부보다 remote-mcp adapter selection과 write target verify를 먼저 본다.
4. gcpCompute 경로에서는 로컬 워크스페이스에 `OBSIDIAN_*`를 다시 주입하는 운영을 기본값으로 가정하지 않는다. 원격 `unified-mcp.gcp.env`와 remote-mcp routing이 기본이다.
5. AXIOM의 `ops:summary`, `ops:project`, `ops:sweep`, `ops:pickup`은 bridge/projection을 대체하는 최종 운영면이 아니라 truth-plane-native evidence producer로 취급한다.

직관적으로 말하면 역할은 다음처럼 고정된다.

- AXIOM: 상태를 확정하고 evidence를 정규화한다.
- external bridge: AXIOM을 `upstream.axiom.*`로 노출한다.
- gcpCompute knowledge plane: Obsidian에 projection된 팀 공용 운영 기록을 보관한다.

## AXIOM Design Changes We Should Preserve

### Stable operator contracts

- HTTP MCP compatibility endpoints: `/mcp`, `/mcp/rpc`, `/tools/list`
- `MCP_WORKER_AUTH_TOKEN` 기반 remote consumption
- jobs, manifests, Overseer, autonomy에 대한 stable list/summary tools
- `outputs/_system/` persisted state를 compatibility surface로 취급

### Control-plane-friendly runtime surfaces

AXIOM은 다음 면을 remote operator가 쓰기 좋게 유지해야 한다.

- `ready`, `ready_degraded`, `not_ready`를 구분하는 semantic readiness
- raw log보다 summary 중심의 MCP/HTTP surface
- Overseer latest report와 history를 바로 읽을 수 있는 면
- queue/autonomy 상태를 projection하기 쉬운 compact summary shape
- bridge verification 명령을 routine setup 일부로 보는 운영 습관

### Recommended operator loops

- daily readiness and recovery sweep
- backlog and pending approval sweep
- repeated-warning digest
- weakest-section and retry-trend review
- bridge health and token alignment check
- retry/backoff, autonomy cadence, quality threshold pre-change shadow review

## Guardrails

1. 코드 이해와 code indexing은 로컬 repo를 기준으로 한다. gcpCompute는 code source-of-truth가 아니다.
2. read-heavy first. remote mutation은 공식 MCP/HTTP surface를 통해서만 한다.
3. `outputs/_system/`를 원격 automation이 직접 수정하지 않는다.
4. remote env와 로컬 `.env`를 같은 것으로 간주하지 않는다.
5. remote VM checkout을 disposable mirror처럼 reset/pull 습관으로 덮어쓰지 않는다.
6. bridge가 건강하면 IDE나 문서에서 direct HTTP 호출을 남발하지 말고 `upstream.axiom.*` 흐름을 우선한다.

## Operating Rules

### Rule 1: Ownership first

- AXIOM runtime만 queue, autonomy, manifest, Overseer 상태를 확정한다.
- gcpCompute와 외부 bridge는 상태를 읽고 요약하고 투영할 수 있지만, truth plane을 대체하지 않는다.

### Rule 2: Route by task type

- 코드 이해, 디버깅, source reading은 로컬 repo와 로컬 AXIOM MCP를 기준으로 한다.
- cross-repo orchestration은 bridge가 건강할 때 `upstream.axiom.*`를 우선 사용한다.
- 팀 공용 remote operator automation, shared evidence 수집, remote-only adapter 사용은 gcpCompute를 사용한다.

### Rule 3: Read-first, mutate through contracts only

- 기본 운영 루틴은 read-only 도구로 시작한다.
- mutation이 필요해도 공식 MCP 또는 HTTP route만 사용한다.
- 원격 automation은 `outputs/_system/`와 runtime persistence 파일을 직접 수정하지 않는다.

### Rule 4: Evidence before action

- 운영 판단은 최소한 `job.list`, `manifest.list`, `overseer.summary`, `autonomy.status` 중 2개 이상 근거를 붙인다.
- bridge 문제와 runtime 문제를 섞지 않는다. 먼저 token, reachability, upstream registration을 확인한다.

### Rule 5: Separate environments explicitly

- 로컬 `.env`, AXIOM 배포 env, gcpCompute remote env는 서로 다른 운영 단위로 본다.
- 문서와 runbook은 어떤 환경에서 얻은 evidence인지 명시한다.

### Rule 6: Shadow before default changes

- retry/backoff, quality policy, autonomy cadence, warning threshold 변경은 control plane shadow review를 먼저 거친다.
- runtime 기본값 변경 전에는 before/after evidence와 rollback 기준을 남긴다.

### Rule 7: Remote checkout is not disposable

- gcpCompute VM checkout을 code mirror처럼 강제 reset/pull 대상으로 취급하지 않는다.
- remote checkout에 남는 stateful artifact, ops note, projection 결과를 운영면 일부로 본다.

### Rule 8: Unattended actions stay narrow

- unattended 허용 범위는 summary 수집, bridge verify, warning digest, projection, shadow comparison으로 제한한다.
- autonomy pause/resume, approve/reject, compose trigger 같은 상태 변경은 명시적 operator 승인 이후에만 자동화 대상으로 확장한다.

## Detailed Execution Plan

### Phase 0: Foundation unblock

목표: agent, local MCP, bridge 검증을 막는 선행 장애를 제거한다.

작업:

- `src/mcp/toolAdapter.ts`의 compose inputSchema를 고쳐 MCP catalog validation을 통과시킨다.
- 배열 schema regression test를 추가해 같은 문제가 다시 세션을 깨지 않게 한다.
- local stdio MCP와 HTTP MCP를 둘 다 검증한다.
- `MCP_WORKER_AUTH_TOKEN`, `MCP_UPSTREAM_SERVERS`, bridge verify 절차를 운영자가 바로 실행할 수 있게 정리한다.

후보 수정 지점:

- `src/mcp/toolAdapter.ts`
- `test/mcp-transport.test.mjs`
- `README.md`
- `scripts/verify-mcp-http-bridge.mjs`

검증:

- `npm.cmd test`
- `npm run start:mcp:http`
- `npm run mcp:bridge:verify`
- VS Code agent session에서 AXIOM MCP tool catalog 정상 로드 확인

완료 기준:

- agent session이 MCP schema 오류 없이 시작된다.
- AXIOM이 local MCP와 HTTP MCP 모두에서 안정적으로 보인다.

### Phase 1: Operator contract baseline

목표: team operator가 항상 같은 요약 surface를 읽게 만든다.

작업:

- 일일 운영에 필요한 최소 canonical summary shape를 확정한다.
- `job.list`, `manifest.list`, `overseer.summary`, `autonomy.status`, `autonomy.pending`의 필수 필드를 문서화한다.
- bridge healthy, bridge degraded, runtime degraded를 구분하는 triage 순서를 문서화한다.
- 운영 체크리스트를 daily, incident, change-review 세 가지로 나눈다.

산출물:

- canonical operator summary spec
- daily sweep checklist
- incident triage order

후보 수정 지점:

- `docs/planning/gcpcompute-axiom-integration.md`
- `docs/autonomy-operations.md`
- 필요 시 `src/routes` 또는 `src/mcp/toolAdapter.ts`의 summary payload

검증:

- operator가 raw manifest를 열지 않고도 현재 상태를 설명할 수 있다.
- 같은 질문에 local, bridge, gcpCompute가 호환되는 summary shape를 돌려준다.

완료 기준:

- 팀 운영 질문의 기본 답변이 summary surface에서 나온다.

### Canonical operator summary baseline

shared operator summary는 source가 local HTTP이든, bridged `upstream.axiom.*`이든, gcpCompute projection이든 아래 필드를 유지한다.

- `source`: `local-runtime` | `bridge` | `gcpCompute`
- `observedAt`: summary를 생성한 시각
- `readiness`: `ready` | `ready_degraded` | `not_ready`
- `queue`: `total`, `running`, `queued`, `retryScheduled`, `failedLike`
- `autonomy`: `paused`, `activeRun`, `pendingApprovalCount`, `dailyCap`, `lockHealth`
- `overseer`: `lastSuccessAt`, `failureCount24h`, `repeatedWarnings`, `scheduler`
- `triage`: `state`, `severity`, `severityScore`, `severityDrivers`, `recommendedLane`, `reasonCodes`
- `artifacts`: backlog, pending approval, and operator-action compact lines for fast triage
- `summary.manifestAudioRetry.recentManifestTracking[]`: optional recent manifest tracking feed with long-span and orchestration snapshots
- `summary.manifestAudioRetry.orchestrationTrends.familyRows[]`: successful-manifest orchestration trend rows with family-level average competence metrics
- `evidence`: 어떤 surface를 읽었는지와 누락된 항목

최소 evidence source 매핑은 다음과 같다.

- `readiness`: `/ready`
- `queue`: `axiom_job_list` 또는 `GET /jobs`
- `autonomy`: `axiom_autonomy_ops` 또는 `GET /autonomy/ops`
- `overseer`: `axiom_overseer_summary` 또는 `GET /overseer/summary`

summary 생성 규칙:

1. `observedAt`와 각 source endpoint의 응답 시각 차이가 크면 stale evidence로 표시한다.
2. bridge 장애와 runtime 장애를 분리하기 위해 `source`와 `evidence`에 사용한 경로를 기록한다.
3. queue와 autonomy는 raw payload 전체를 다시 붙이지 말고 operator decision에 필요한 count와 health만 남긴다.
4. repeated warning은 최대 3개 대표 항목만 본문에 두고 나머지는 reference count로 남긴다.
5. summary 생성 실패도 별도 evidence로 기록한다.

현재 baseline 구현 메모:

- `ops:summary`는 endpoint별 `path`, `fetchedAt`, `latencyMs`와 `evidence.stale`, `staleReason`, `oldestAgeMs`, `maxSkewMs`를 남긴다.
- `ops:summary`는 readiness, backlog, pending approvals, repeated warnings, stale lock, stale evidence를 묶어 `triage.state`, `triage.severity`, `triage.severityScore`, `triage.severityDrivers`를 계산한다.
- `ops:summary`의 backlog/pending compact artifact는 optional `structureLongSpan=...`, `audioLongSpan=...`, `longSpanDivergence=...`, `longSpanReason=...`, `orchestration=trio:rng=...,bal=...,conv=...,weak=...` token을 포함할 수 있다.
- `summary.manifestAudioRetry.recentManifestTracking[]`가 `orchestration` snapshot을 담을 때, 이 값은 SoundFont나 render timbre 품질이 아니라 instrument-distribution competence를 뜻한다.
- `summary.manifestAudioRetry.orchestrationTrends.familyRows[]`는 최근 성공 manifest 기준 family-level average range/balance/conversation fit과 weak-manifest pressure를 담고, 역시 timbre upgrade가 아니라 ensemble writing competence trend를 뜻한다.
- canonical operator summary `artifacts[]`는 같은 aggregate를 `orchestrationTrend family=... manifests=... rng=... bal=... conv=... weakManifests=... avgWeakSections=... instruments=...` compact line으로도 재노출할 수 있다.
- `ops:project`와 `ops:sweep`는 이 stale evidence를 그대로 projection/recommendation에 반영한다.
- `ops:sweep`는 bridge verify 결과를 triage에 합쳐 `bridge_degraded`와 `incident_candidate`를 구분한다.

### Phase 2: Shared evidence projection

목표: 사람이 직접 상태를 모으지 않아도 shared operator evidence가 쌓이게 만든다.

작업:

- gcpCompute가 정기적으로 AXIOM summary를 읽어 shared docs 또는 Obsidian으로 projection하는 경로를 정한다.
- 저장 위치를 하나로 고정한다. 예: shared Obsidian note, ops dashboard note, planning artifact directory.
- projection payload에 최소한 readiness, queue counts, pending approvals, repeated warnings, latest Overseer summary를 포함한다.
- projection 실패도 별도 evidence로 남긴다.

후보 구현 방식:

- gcpCompute scheduled job
- external bridge unified/obsidian tool projection
- AXIOM verification script 결과 저장

현재 baseline 구현:

- `npm run ops:summary`: canonical operator summary JSON 출력
- `npm run ops:project`: `outputs/_system/operator-summary/latest.json`, `latest.md`, `upstream-compatible.json`, `history/YYYY-MM-DD.jsonl` 갱신
- `npm run ops:pickup`: `outputs/_system/operator-pickup/latest.json`, `latest.md`, `history/YYYY-MM-DD.jsonl`로 summary/sweep/incident latest를 shared pickup bundle로 정리하고, projection/incident orchestration trend snapshot이 있으면 handoff bundle에도 그대로 보존
- projection 실패 시 `latest-error.json`, `errors/YYYY-MM-DD.jsonl` 남김
- gcpCompute scheduled pickup 예시는 `docs/planning/gcpcompute-operator-projection-runbook.md`, `docs/planning/gcpcompute-shared-pickup-runbook.md`, `config/systemd/axiom-operator-summary.*.example`, `config/systemd/axiom-operator-pickup.*.example`, `config/env/operator-projection.gcp.env.example`, `config/env/operator-pickup.gcp.env.example` 참고

검증:

- 로컬 PC가 꺼져 있어도 shared operator note가 갱신된다.
- projection note만 읽어도 현재 운영 상태를 1분 안에 파악할 수 있다.

완료 기준:

- summary와 projection이 수동 운영 루틴이 아니라 자동 루틴이 된다.

### Phase 3: Shadow governance lane

목표: 정책 변경을 production default 앞에서 미리 비교할 수 있게 만든다.

작업:

- retry/backoff, quality threshold, autonomy cadence, warning threshold에 대한 shadow review 템플릿을 만든다.
- change proposal마다 baseline, candidate, observation window, rollback trigger를 남긴다.
- gcpCompute가 비교 evidence를 수집하고 shared surface에 남기게 한다.

산출물:

- policy-change template
- before/after evidence snapshot
- rollback checklist

현재 baseline 구현:

- `npm run ops:shadow:init -- --policy <retry_backoff|autonomy_cadence|quality_threshold|warning_threshold>`
- `npm run ops:shadow:capture -- --review <shadow-review.json> --lane <baseline|candidate>`
- output: `docs/planning/gate-runs/shadow-reviews/*.json`, `*.md`
- evidence history: `docs/planning/gate-runs/shadow-reviews/*.evidence.jsonl`
- runbook: `docs/planning/gcpcompute-shadow-governance-runbook.md`

검증:

- 정책 변경 시 evidence 없는 감으로 기본값을 바꾸지 않는다.
- operator가 candidate policy를 production truth plane과 혼동하지 않는다.

완료 기준:

- 중요한 운영 정책 변경은 모두 shadow evidence를 가진다.

현재 baseline 구현 메모:

- shadow review template/evidence는 완료
- 다음 smallest safe unit으로 unattended read-only sweep baseline을 추가해 bridge verify, projection, warning digest, stale lock digest를 한 번에 남긴다.

### Phase 4: Safe unattended automation

목표: read-heavy automation에서 시작해 제한된 운영 자동화를 도입한다.

허용 1차 범위:

- bridge verify
- readiness and summary sweep
- repeated warning digest
- shared evidence projection
- stale lock detection report

보류 범위:

- compose trigger
- autonomy pause/resume
- approve/reject
- queue mutation

확장 조건:

- 명시적 operator approval model이 정해질 것
- action audit trail이 남을 것
- rollback path가 문서화될 것

검증:

- unattended job이 visibility를 늘리되 truth plane을 손상시키지 않는다.
- 실패 시 auto action보다 incident evidence가 먼저 남는다.

완료 기준:

- 자동화는 narrow and safe 원칙을 지키고, state mutation은 승인된 경로로만 확장된다.

현재 baseline 구현:

- `npm run ops:sweep -- --url <app> --mcpUrl <mcp>`
- output: `outputs/_system/operator-sweep/latest.json`, `latest.md`, `history/YYYY-MM-DD.jsonl`
- digest coverage: backlog, pending approvals, repeated warnings, stale locks
- triage coverage: bridge degraded, runtime degraded, incident candidate, severityScore, severityDrivers
- incident draft coverage: incident lane이면 `incident-drafts/latest.json`, `incident-drafts/latest.md`, `incident-drafts/history/YYYY-MM-DD.jsonl`, 그리고 projection latest에 orchestration trend aggregate가 있으면 그 compact snapshot도 포함
- shared pickup coverage: `ops:pickup`이 summary/sweep/incident latest를 `outputs/_system/operator-pickup/` 아래 단일 pickup bundle로 정리하고 `overseer.orchestrationTrends[]` handoff를 유지
- failure evidence: `outputs/_system/operator-sweep/latest-error.json`, `errors/YYYY-MM-DD.jsonl`
- gcpCompute env/systemd/runbook: `config/env/operator-sweep.gcp.env.example`, `config/systemd/axiom-operator-sweep.*.example`, `docs/planning/gcpcompute-safe-unattended-sweep-runbook.md`

## Completion Snapshot

- Phase 0: 완료
- Phase 1: 대부분 완료, triage classification까지 baseline 구현됨
- Phase 2: 완료, projection artifacts와 failure evidence가 자동화됨
- Phase 3: 완료, shadow review init/capture/comparison lane 존재
- Phase 4: baseline 완료, read-only unattended evidence와 severity scoring baseline까지 들어옴
- mutation approval model은 문서상 확정 대상까지 좁혀짐
- 남은 큰 축: mutation audit trail 저장과 rollback/manual recovery runbook 구현, 그리고 필요 시 incident/comms operator template 후속 정교화

## Current Next Step

다음에 해야 할 일은 AXIOM 안에 새 요약 스크립트를 더 만드는 것이 아니다.

가장 작은 다음 단위는 이미 노출된 mutation surface를 넓히기 전에 approval, audit, rollback contract를 먼저 정리하는 일이다.

1. 확정된 허용 mutation에 대해 actor, reason, input, before/after state, artifact link를 남기는 audit trail 저장 경로를 truth plane 아래에 설계한다.
2. unattended path가 mutation으로 확장되기 전에 rollback 또는 manual recovery path를 runbook과 테스트로 같이 정의한다.
3. keep/drop 목록에 따라 bridge, gcpCompute, 외부 bridge에서 mutation wrapper를 더 늘리지 않고 canonical surface에 집중한다.

직관적으로 설명하면 지금까지는 AXIOM이 운영 상태와 incident handoff를 안전하게 내보내는 단계까지 왔다. 다음 단계는 그 위에 mutation을 얹더라도 "누가 왜 바꿨는지"와 "되돌릴 수 있는지"를 먼저 계약으로 고정하는 일이다.

현재 baseline 구현 메모:

- AXIOM MCP는 canonical operator summary tool `axiom_operator_summary`를 노출한다. legacy alias `axiom.operator.summary`도 계속 허용한다.
- 외부 bridge는 `upstream.axiom.axiom_operator_summary`가 있으면 그 tool을 우선 사용하고, 없으면 기존 `job_list + autonomy_status + overseer_summary` 조합으로 fallback한다.
- incident handoff는 escalation owner/cadence, next update 시각, comms draft template까지 canonical payload와 pickup/projection에 함께 실린다.
- 따라서 bridge-side summary alignment와 downstream incident handoff consumer alignment, incident/comms escalation baseline까지는 완료되었고, approval scope는 pause/resume, reconcile_lock, approve/reject로 제한한다. 다음 큰 정교화 대상은 audit trail과 rollback path를 다듬는 일이다.

## Entry Point Consolidation

원칙은 간단하다. 같은 운영 행위에 canonical operator path는 하나만 두고, 나머지는 local runtime 또는 break-glass 용도로만 남긴다.

### Keep

- `axiom_operator_summary`와 `upstream.axiom.axiom_operator_summary`는 read-only team operator의 canonical 진입점으로 유지한다.
- `ops:summary`, `ops:project`, `ops:sweep`, `ops:pickup`은 truth-plane-native evidence producer로 유지한다. 이들은 mutation wrapper가 아니라 read-only artifact producer여야 한다.
- AXIOM HTTP routes (`/autonomy/*`, `/jobs`, `/overseer/*`)는 runtime-owned local API, 회귀 테스트, break-glass curl path로 유지한다.
- AXIOM MCP tools (`axiom_autonomy_*`, `axiom_job_*`, `axiom_overseer_*`)는 cross-repo operator lane의 canonical mutation/read surface로 유지한다. legacy dotted alias는 계속 허용한다.
- 외부 bridge 쪽에서는 `upstream.axiom.*`와 `obsidian.axiom.project`만 operator lane에 남기고, 상태 조회와 projection을 위한 wrapper는 유지한다.

### Drop From The Standard Operator Lane

- gcpCompute나 IDE 운영에서 bridge가 건강한데도 ad hoc direct HTTP 호출을 표준 경로로 쓰는 관행은 걷어낸다.
- 새 mutation용 `ops:*` 스크립트는 추가하지 않는다. `ops:*`는 evidence export만 담당한다.
- 외부 bridge action/Discord admin surface에 AXIOM mutation wrapper를 추가하는 일은 audit trail이 구현되기 전까지 보류한다.
- `action.execute.direct`를 AXIOM mutation의 표준 operator entrypoint로 삼지 않는다. non-production debugging 용도만 남긴다.
- `axiom_compose`와 `axiom_autonomy_trigger`를 team-shared remote operator lane의 routine mutation으로 취급하지 않는다.

직관적으로 정리하면 다음과 같다.

- read-only team ops: `upstream.axiom.*` 우선
- shared evidence export: `ops:*`
- remote mutation: AXIOM MCP tool 우선, HTTP route는 local/break-glass fallback
- projection/knowledge plane: `obsidian.axiom.project`

## Mutation Approval Model

현재 승인 모델은 mutation을 세 등급으로 나눈다.

### Allowed Now: Class A Protective Controls

- 대상: `pause`, `resume`, `reconcile_lock`
- 목적: runtime를 더 위험하게 만들지 않고 보호하거나, stale control state를 회복한다.
- 승인 방식: 단일 operator 승인
- 필수 근거: 직전 operator summary 또는 `/autonomy/ops` evidence, 실행 사유 문자열, 관련 run/song/lock 상태
추가 조건:
- `resume`은 pause 원인이 해소됐다는 fresh evidence가 있어야 한다.
- `reconcile_lock`은 `lock_timeout_without_active_job`, `terminal_manifest_exists`, `queue_run_mismatch`처럼 recovery 성격이 분명한 경우에만 허용한다.
- unattended job은 이 mutation을 자동 호출하지 않는다.

### Allowed Now: Class B Human Content Decisions

- 대상: `approve`, `reject`
- 목적: pending approval 상태의 autonomy 산출물에 대해 사람의 판단을 기록한다.
- 승인 방식: 단일 human reviewer 승인
- 필수 근거: `songId`, pending approval evidence, 승인 메모 또는 반려 사유, 관련 evaluation summary/manifest reference
추가 조건:
- auto approve/reject는 금지한다.
- bridge나 Discord wrapper가 대신 판단하지 않는다. 사람의 명시적 호출만 허용한다.

### Not Approved Yet: Class C Expansion Mutations

- 대상: `trigger`, `compose`, future queue mutation, retry dequeue/requeue, policy default change
- 상태: shared remote operator lane에서는 아직 미승인
- 이유: audit trail과 rollback path가 아직 runtime contract로 고정되지 않았다.
허용 범위:
- local runtime debugging 또는 제품 API 경로에서는 존재할 수 있다.
- gcpCompute, bridge, shared automation에서는 routine operator flow로 승격하지 않는다.

### Canonical Approval Routing

- remote team operator call은 AXIOM MCP tool을 canonical path로 사용한다.
- local runtime/manual recovery는 HTTP route를 fallback으로 사용한다.
- audit trail이 구현되기 전까지 외부 bridge wrapper나 별도 mutation script를 새 표준 진입점으로 만들지 않는다.

### Audit Contract Baseline

approval scope는 위와 같이 고정하고, Class A/B mutation audit baseline은 아래 contract로 유지한다.

- 저장 위치: `outputs/_system/operator-actions/`
- 최소 필드: `actor`, `surface`, `action`, `reason`, `input`, `before`, `after`, `artifactLinks`, `approvedBy`, `observedAt`
- 권장 필드: `rollbackNote`, `manualRecoveryNote`
- rollback 연계: Class A/B mutation은 가능한 rollback 또는 manual recovery note를 같이 남긴다.
- Class C를 열기 전에는 이 audit artifact와 runbook/test가 먼저 있어야 한다.

다음 구현 단위는 이 audit artifact를 shared operator lane에서 바로 읽을 수 있게 projection하는 것이다.

- `ops:summary`, `ops:project`, `upstream-compatible.json`, `ops:pickup`이 `latestOperatorAction` snapshot을 함께 노출한다.
- bridge 또는 gcpCompute consumer는 raw mutation route를 다시 추적하지 않고도 최근 operator action, actor, surface, evidence link를 확인할 수 있어야 한다.

## Suggested Cadence

### Daily

- bridge health and token alignment 확인
- readiness, queue, pending approval, repeated warning sweep
- latest Overseer summary projection 확인

### Weekly

- retry/backoff, weakest-section, audio retry trend review
- autonomy cadence와 stale lock 패턴 review
- shared projection 품질과 누락 여부 점검

### Per change

- baseline capture
- shadow review
- production change
- post-change evidence capture
- rollback decision

## Phased Adoption

### Phase 1: Make the operator lane first-class

Status: now

- gcpCompute를 primary shared control plane으로 문서화한다.
- local AXIOM runtime은 truth plane으로 유지한다.
- bridge verification을 routine setup에 포함한다.
- read-only summary tool set을 표준 operator 진입점으로 삼는다.

Exit criteria:

- 팀원이 local AXIOM, bridged `upstream.axiom.*`, gcpCompute의 역할 차이를 설명할 수 있다.
- bridge verification과 summary generation이 정상 운영 루틴으로 들어간다.

### Phase 2: Push shared evidence automatically

Status: baseline complete, bridge-side consumption alignment next

- Overseer, queue, autonomy summary를 shared docs 또는 Obsidian으로 projection한다.
- repeated warning과 backlog digest를 일정 주기로 남긴다.
- bridge health evidence를 runtime evidence와 함께 저장한다.

Exit criteria:

- 팀 shared operator surface가 수동 log reading 없이 최신 상태를 유지한다.
- operator decision이 현재 remote evidence를 근거로 내려진다.

### Phase 3: Shadow governance on the control plane

Status: baseline complete

- autonomy cadence, retry/backoff, quality policy 변경을 remote shadow review로 먼저 비교한다.
- production runtime은 보수적으로 유지하고, control plane은 평가와 보고를 담당한다.

Exit criteria:

- 정책 변경 시 before/after operator evidence가 남는다.
- control plane은 보고하고, runtime plane은 최종 상태를 소유한다.

## Config Checklist

### AXIOM

- `MCP_HTTP_PORT`
- `MCP_WORKER_AUTH_TOKEN`
- `npm run start:mcp:http`

### IDE

- local AXIOM MCP entry in `.vscode/mcp.json`
- `gcpCompute` SSH entry if remote unified server is available

### External bridge

- `MCP_UPSTREAM_SERVERS=[{"id":"axiom","url":"http://HOST:3210","namespace":"axiom","token":"...","protocol":"simple"}]`

## Success Criteria

- AXIOM은 runtime source of truth를 유지한다.
- gcpCompute는 emergency-only path가 아니라 routine team ops surface가 된다.
- 외부 bridge는 AXIOM을 `upstream.axiom.*`로 안정적으로 노출한다.
- shared operator summary가 raw log/manifest spelunking을 줄인다.
- remote automation은 visibility를 늘리되 AXIOM runtime ownership을 빼앗지 않는다.
- 운영 규칙과 phased plan이 팀 공용 reference로 고정된다.
