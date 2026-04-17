# AXIOM gcpCompute Shared Adoption Plan

Status: active

## Goal

discord-news-bot에서 검증된 세 가지 운영 패턴을 AXIOM에 바로 쓸 수 있는 형태로 받아온다.

1. published shared runtime mirror 소비
2. shared-only bootstrap
3. richer remote diagnostics

핵심 제약은 유지한다.

- AXIOM truth plane은 계속 local runtime과 `outputs/_system/`이다.
- gcpCompute는 team-shared control plane이다.
- remote surface는 local source of truth를 대체하지 않는다.

## Immediate Slice

### 1. Shared runtime mirror consumption

- `.vscode/mcp.json`의 `gcpCompute` entry는 legacy git checkout `/opt/muel/discord-news-bot` 대신 published runtime mirror `/opt/muel/shared-mcp-runtime`를 바라본다.
- 즉, AXIOM workspace는 remote unified MCP를 사용할 때 git working tree drift를 운영 기본값으로 삼지 않는다.

### 2. Shared-only bootstrap

- `scripts/bootstrap-gcpcompute-shared-only.ps1`를 추가한다.
- 이 스크립트는 local `.env`나 local Obsidian token 없이 다음만 점검한다.
  - SSH key 존재 또는 생성
  - `.vscode/mcp.json`의 `gcpCompute` path가 shared runtime mirror를 가리키는지
  - SSH access
  - public shared MCP health

### 3. Richer remote diagnostics

- local AXIOM HTTP MCP는 `GET /mcp/health`를 노출한다.
- 이 surface는 bootstrap과 bridge smoke check를 위해 아래 정보를 한 번에 보여준다.
  - protocol version
  - auth required/token configured
  - tool count and tool names
  - runtime readiness
  - queue summary
  - latest `operator-summary`, `operator-sweep`, `incident-drafts`, `operator-pickup` artifact status
  - artifact가 orchestration trend snapshot을 갖고 있으면 compact trend availability/pressure summary와 advisory 문구
- `scripts/verify-mcp-http-bridge.mjs`도 `/mcp/health`를 먼저 검사한다.

## Why AXIOM Remote Publish Is Deferred

AXIOM 자체를 gcpCompute에 published runtime mirror로 올리는 일은 아직 immediate slice에 넣지 않는다.

이유:

1. 현재 AXIOM truth plane은 local runtime과 local `outputs/_system/`이다.
2. remote AXIOM checkout 또는 co-located runtime이 없는 상태에서 AXIOM HTTP MCP만 gcpCompute에 올리면 operator가 remote stale copy를 truth처럼 읽을 위험이 생긴다.
3. 먼저 remote control plane이 local truth plane을 더 안전하게 읽고 검증하도록 만드는 편이 맞다.

## Next Slice

AXIOM remote publish는 아래 조건이 충족될 때만 다음 단계로 진행한다.

1. remote host에 AXIOM runtime source of truth가 실제로 존재한다.
2. `outputs/_system/`와 manifest storage가 같은 host에서 유지된다.
3. remote operator surface가 local fallback이 아니라 real runtime ownership과 같이 배치된다.
4. publish script와 systemd service는 non-git runtime mirror 기준으로만 설치한다.

## Success Criteria

- AXIOM workspace가 gcpCompute shared MCP를 legacy git checkout이 아니라 published runtime mirror로 소비한다.
- 새 팀원 또는 새 기기에서 local secrets 없이 gcpCompute shared lane bootstrap이 가능하다.
- bridge/proxy consumer가 `/mcp/health` 하나로 AXIOM transport와 operator artifact 상태를 빠르게 확인할 수 있다.
- remote diagnostics가 늘어나도 AXIOM truth plane ownership은 흐려지지 않는다.
