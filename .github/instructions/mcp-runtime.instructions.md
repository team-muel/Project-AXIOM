---
description: "AXIOM runtime routing and guardrails for MCP, autonomy, queue, and operator surfaces."
applyTo: "{src/ops/mcp/**,src/ops/autonomy/**,src/ops/overseer/**,src/ops/operator/**,src/queue/**,src/routes/**,src/config.ts,src/index.ts,test/**}"
---

# AXIOM Runtime Routing

> One runtime change should preserve transport, persistence, and operator visibility together.

## Surface Map

### MCP transport
- Stdio server: `src/ops/mcp/server.ts`
- HTTP server: `src/ops/mcp/httpServer.ts`
- Shared protocol/types: `src/ops/mcp/protocol.ts`, `src/ops/mcp/types.ts`, `src/ops/mcp/toolAdapter.ts`
- Route bindings: `src/routes/mcp.ts`, `src/routes/mcpHttp.ts`

### Autonomy and recovery
- Runtime control: `src/ops/autonomy/controller.ts`, `src/ops/autonomy/service.ts`
- Scheduling: `src/ops/autonomy/scheduler.ts`, `src/ops/autonomy/calendar.ts`
- Queue state and retry behavior: `src/queue/jobQueue.ts`
- Shared operator presentation: `src/queue/presentation.ts`

### Operator surfaces
- Health and readiness: `src/routes/health.ts`
- Autonomy APIs: `src/routes/autonomy.ts`
- Overseer APIs and reporting: `src/routes/overseer.ts`, `src/ops/overseer/**`

## Guardrails

1. Preserve both MCP endpoint styles unless migration is explicit: `/mcp`, `/mcp/rpc`, `/tools/list`.
2. Keep stdio MCP responses machine-clean on stdout.
3. When adding queue or manifest fields, keep REST and MCP presentation surfaces aligned.
4. Treat persisted files under `outputs/_system/` as compatibility surfaces for restart recovery.
5. Do not change scheduler timing, auth expectations, or pause/approval semantics without tests.

## Validation

- Run `npm run typecheck` for structural changes.
- Run `npm test` for behavioral changes.
- Prefer targeted inspection of `test/mcp-transport.test.mjs`, `test/autonomy-ops.test.mjs`, `test/restart-recovery.test.mjs`, `test/ready-status.test.mjs`, and `test/overseer-last-report.test.mjs` when scoping risk.

## Documentation Sync

Update these docs when changing operator-visible behavior or persisted state:

- `docs/architecture.md`
- `docs/composition-engine.md`