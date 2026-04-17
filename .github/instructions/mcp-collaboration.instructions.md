---
description: "Routing rules for collaborating across local AXIOM MCP, gcpCompute SSH MCP, and discord-news-bot upstream AXIOM bridge."
applyTo: "{README.md,.env.example,.vscode/mcp.json,docs/planning/**,.github/prompts/**}"
---

# MCP Collaboration Routing

> Local code understanding stays local. Remote orchestration goes through gcpCompute. Runtime control crosses repo boundaries only through official MCP surfaces.

## Roles

### Local AXIOM
- Use local AXIOM MCP when you need the current workspace runtime or direct access to local outputs.
- Preferred entrypoints: local stdio MCP for IDE work, local HTTP MCP for cross-process integration.
- Source of truth for queue, autonomy state, manifests, and Overseer data is this repo's runtime and `outputs/_system/`.

### gcpCompute
- Treat `gcpCompute` as a remote operations hub, not as a replacement for local code indexing.
- Use it for remote adapters, team-shared automation, unattended routines, or remote state that exists only on the GCP side.
- Do not use it to inspect local AXIOM files when the workspace already has the source.

### discord-news-bot upstream bridge
- Use discord-news-bot `MCP_UPSTREAM_SERVERS` when you want AXIOM exposed as `upstream.axiom.*` inside the team's unified MCP surface.
- This bridge is for cross-repo orchestration and operator workflows, not for direct editing of AXIOM internals.

## Preferred Paths

1. Local code analysis: workspace tools or local indexing only.
2. Local AXIOM runtime inspection: local AXIOM MCP.
3. Team-shared remote operations: `gcpCompute`.
4. Cross-repo AXIOM delegation from discord-news-bot: `upstream.axiom.*` over AXIOM HTTP MCP.

## Guardrails

1. Keep `MCP_WORKER_AUTH_TOKEN` set whenever AXIOM HTTP MCP is exposed beyond localhost.
2. Do not mutate `outputs/_system/` directly from remote automation; use official MCP tools or HTTP routes.
3. When debugging code, prefer the local repo over remote copies to avoid stale-state conclusions.
4. When comparing local and remote behavior, state explicitly which runtime produced the evidence.

## Expected Tooling

- Local AXIOM stdio MCP entry in `.vscode/mcp.json`
- Local AXIOM HTTP server via `npm run start:mcp:http`
- Optional discord-news-bot upstream registration using `MCP_UPSTREAM_SERVERS`
- Optional `gcpCompute` SSH stdio access for team-wide operator workflows