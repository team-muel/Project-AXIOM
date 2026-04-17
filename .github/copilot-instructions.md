# AXIOM Copilot Instructions

## Mission

Keep the autonomous composition pipeline reliable while evolving queueing, recovery, quality control, and MCP surfaces.

## Core Priorities

1. Reliability first: do not break startup, restart recovery, scheduler behavior, or MCP transport compatibility.
2. Operator visibility: manifests, readiness, autonomy state, overseer surfaces, and queue summaries are contract surfaces.
3. Backward compatibility: preserve existing HTTP and stdio MCP behavior unless migration is explicit.
4. Small safe changes: prefer focused patches with targeted regression tests.
5. Documentation parity: update operator docs when runtime behavior or persisted state changes.

## Working Rules

- Prefer the smallest valid patch that fixes the root cause.
- When changing queue, autonomy, or MCP behavior, update tests and docs in the same change when feasible.
- Treat `outputs/_system/` persistence and manifest storage as runtime contracts, not incidental implementation detail.
- Keep stdio MCP JSON output clean on stdout; operational logging belongs on stderr or HTTP logs.

## Tech Stack

- TypeScript + Node.js (ESM)
- Express HTTP API
- Custom MCP servers over stdio and HTTP
- Node test runner via `node --test`

## Key Runtime Surfaces

- App entrypoint: `src/index.ts`
- MCP entrypoints: `src/mcp/server.ts`, `src/mcp/httpServer.ts`
- Transport helpers: `src/mcp/protocol.ts`, `src/mcp/toolAdapter.ts`
- Autonomy runtime: `src/autonomy/controller.ts`, `src/autonomy/service.ts`, `src/autonomy/scheduler.ts`
- Queue surfaces: `src/queue/jobQueue.ts`, `src/queue/presentation.ts`
- Operator routes: `src/routes/health.ts`, `src/routes/autonomy.ts`, `src/routes/overseer.ts`, `src/routes/mcp.ts`, `src/routes/mcpHttp.ts`

## Release Gate Checklist

- Boot path and `/ready` behavior still make sense
- MCP endpoints remain compatible: `/mcp`, `/mcp/rpc`, `/tools/list`
- Recovery and persisted-state semantics are preserved
- New runtime behavior has targeted regression coverage
- Operator-facing docs are updated when behavior changes

## Repo-Specific Notes

- `npm test` runs `npm run build` first through `pretest`.
- HTTP MCP is the canonical network surface for upstream integrations.
- Queue, autonomy, and overseer state persist under `outputs/_system/`.
- Existing tests already cover autonomy ops, MCP transport, readiness, restart recovery, and quality loop regressions.

## Docs To Consult

- `docs/autonomy-operations.md`
- `docs/state-machine.md`
- `docs/manifest-schema.md`