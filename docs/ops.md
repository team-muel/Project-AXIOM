# Ops & ML Scripts

이 문서는 `package.json`에 포함되지 않는 운영/ML 스크립트 목록이다.  
모든 명령은 레포 루트에서 직접 실행한다.

---

## 서버 시작 (ops 포함)

```bash
# 전체 런타임 — autonomy scheduler + overseer + MCP
node_modules/.bin/tsx src/index.ts

# HTTP MCP (포트 3210)
node_modules/.bin/tsx src/ops/mcp/httpServer.ts

# stdio MCP (IDE agent용)
node_modules/.bin/tsx src/ops/mcp/server.ts
```

또는 빌드 후:

```bash
node dist/index.js
node dist/ops/mcp/httpServer.js
node dist/ops/mcp/server.js
```

---

## Operator 요약

```bash
# 운영 요약 (readiness, backlog, pending approval, warnings)
node scripts/print-operator-summary.mjs

# 예측 projection
node scripts/project-operator-summary.mjs

# pickup bundle
node scripts/project-operator-pickup.mjs

# 무인 스윕
node scripts/run-safe-unattended-sweep.mjs
```

---

## Ops Shadow Review

```bash
# shadow review scaffold
node scripts/scaffold-shadow-review.mjs

# shadow evidence capture
node scripts/capture-shadow-review-evidence.mjs
```

---

## MCP Bridge

```bash
# discord-news-bot upstream 설정 출력
node scripts/print-discord-upstream-config.mjs

# HTTP MCP bridge 검증
node scripts/verify-mcp-http-bridge.mjs
```

---

## ML — Dataset Export

```bash
node scripts/export-structure-reranker-dataset.mjs
node scripts/export-backbone-piece-dataset.mjs
node scripts/export-localized-rewrite-dataset.mjs
node scripts/export-notagen-preference-dataset.mjs
node scripts/export-notagen-sft-dataset.mjs
```

---

## ML — Training

```bash
python scripts/train-notagen-axiom-adapter.py
python scripts/train-preference-reranker.py
```

---

## ML — Learned Backbone Review

```bash
# pending run → worksheet 생성
node scripts/create-learned-backbone-manifest-review-sheet.mjs -- --snapshot <sheet>

# filled worksheet ingest
node --import tsx scripts/record-learned-backbone-manifest-review.mjs -- --resultsFile outputs/_system/ml/review-manifests/learned-backbone/<sheet>/review-sheet.csv

# blind A/B review pack 생성
node scripts/create-learned-backbone-review-pack.mjs -- --snapshot <pack>

# blind review 결과 ingest
node scripts/record-learned-backbone-review-result.mjs

# benchmark 실행
node --import tsx scripts/run-learned-backbone-benchmark.ts
```

---

## ML — Summarize & Shadow

```bash
# learned backbone 벤치마크 요약
node scripts/summarize-learned-backbone-benchmark.mjs

# truth-plane dataset snapshot 점검
node scripts/summarize-truth-plane-dataset-snapshot.mjs -- --snapshot <snapshot>

# structure shadow reranker 평가
node scripts/evaluate-structure-reranker-shadow.mjs -- --snapshot <snapshot>

# shadow disagreement 런타임 요약 (최근 24시간)
node scripts/summarize-structure-shadow-runtime.mjs -- --windowHours 24
```

---

## HTTP API (ops 서버 기동 후)

### Autonomy

```bash
curl http://localhost:3100/autonomy/status
curl -X POST http://localhost:3100/autonomy/trigger
curl -X POST http://localhost:3100/autonomy/pause
curl -X POST http://localhost:3100/autonomy/resume
curl http://localhost:3100/autonomy/pending
curl -X POST http://localhost:3100/autonomy/approve/{songId}
curl -X POST http://localhost:3100/autonomy/reject/{songId}
```

### Overseer

```bash
curl http://localhost:3100/overseer/status
curl http://localhost:3100/overseer/last-report
curl http://localhost:3100/overseer/dashboard
curl http://localhost:3100/overseer/history
curl http://localhost:3100/overseer/summary
```

### MCP (HTTP, 포트 3210)

```bash
curl http://localhost:3210/mcp/health
curl -X POST http://localhost:3210/mcp/rpc -H "Content-Type: application/json" -d '{...}'
curl -X POST http://localhost:3210/tools/list
```

`MCP_WORKER_AUTH_TOKEN` 설정 시 `Authorization: Bearer <token>` 헤더 필요.
