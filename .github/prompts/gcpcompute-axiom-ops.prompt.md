---
description: "Review AXIOM operations through local MCP and gcpCompute collaboration surfaces. Use when planning or auditing remote operator workflows."
---

# gcpCompute AXIOM Ops Review

Review how AXIOM should be operated across local MCP, gcpCompute, and upstream orchestration.

## Instructions

1. Identify whether the request is about local runtime truth, remote operator automation, or cross-repo delegation.
2. Prefer local AXIOM MCP for queue, autonomy, manifest, and Overseer truth in this workspace.
3. Use gcpCompute only when the value comes from remote adapters, team-shared automation, or remote-only state.
4. If discord-news-bot is involved, frame the integration through `MCP_UPSTREAM_SERVERS` and `upstream.axiom.*`.
5. Produce:
   - recommended route
   - required env/config
   - rollback or safety guardrails
   - next implementation step
6. Call out if the plan would blur local source-of-truth and remote control-plane responsibilities.