import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { listMcpTools } from "../mcp/toolAdapter.js";
import { MCP_PROTOCOL_VERSION, fail, handleMcpRequest, isJsonRpcNotification } from "../mcp/protocol.js";
import { getMcpDiagnosticsSnapshot } from "../operator/summary.js";
import type { JsonRpcRequest } from "../mcp/types.js";

const router = Router();

function statusCodeForError(code: number): number {
    if (code === -32700 || code === -32600 || code === -32601 || code === -32602) {
        return 400;
    }

    return 500;
}

function validateBearer(req: Request): boolean {
    const expectedToken = config.mcpWorkerAuthToken.trim();
    if (!expectedToken) {
        return false;
    }

    const authHeader = String(req.headers.authorization ?? "").trim();
    if (!/^Bearer\s+/i.test(authHeader)) {
        return false;
    }

    const receivedToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const expected = Buffer.from(expectedToken);
    const received = Buffer.from(receivedToken);
    if (expected.length !== received.length) {
        return false;
    }

    return timingSafeEqual(expected, received);
}

function requireAuth(req: Request, res: Response): boolean {
    if (!config.mcpWorkerAuthToken && process.env.NODE_ENV !== "production") {
        return true;
    }

    if (validateBearer(req)) {
        return true;
    }

    res.status(401).json({ error: "UNAUTHORIZED" });
    return false;
}

function jsonToolsPayload() {
    return {
        tools: listMcpTools(),
    };
}

function isAuthRequired(): boolean {
    return Boolean(config.mcpWorkerAuthToken.trim()) || process.env.NODE_ENV === "production";
}

async function handleJsonRpcHttp(req: Request, res: Response): Promise<void> {
    if (!requireAuth(req, res)) {
        return;
    }

    try {
        const request = req.body as JsonRpcRequest;
        const response = await handleMcpRequest(request);

        if (isJsonRpcNotification(request)) {
            res.status(204).end();
            return;
        }

        if (response.error) {
            res.status(statusCodeForError(response.error.code)).json(response);
            return;
        }

        res.json(response);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json(fail(null, -32000, message));
    }
}

router.get("/mcp", (_req, res) => {
    res.json({
        transport: "jsonrpc-over-http",
        healthEndpoint: "/mcp/health",
        rpcEndpoint: "/mcp/rpc",
        fallbackEndpoints: ["/mcp", "/tools/list"],
        methods: ["initialize", "tools/list", "tools/call", "notifications/initialized", "ping"],
    });
});

router.get("/mcp/health", (_req, res) => {
    const tools = listMcpTools();
    const diagnostics = getMcpDiagnosticsSnapshot();

    res.json({
        status: "ok",
        server: "axiom-mcp-http",
        version: "0.1.0",
        protocolVersion: MCP_PROTOCOL_VERSION,
        auth: {
            required: isAuthRequired(),
            tokenConfigured: Boolean(config.mcpWorkerAuthToken.trim()),
        },
        endpoints: {
            metadata: "/mcp",
            health: "/mcp/health",
            rpc: "/mcp/rpc",
            toolsList: "/tools/list",
            toolsDiscover: "/mcp/tools",
        },
        tools: tools.length,
        toolNames: tools.map((tool) => tool.name),
        readiness: diagnostics.readiness,
        queue: diagnostics.queue,
        operatorArtifacts: diagnostics.operatorArtifacts,
    });
});

router.get("/mcp/tools", (req, res) => {
    if (!requireAuth(req, res)) {
        return;
    }

    res.json(jsonToolsPayload());
});

router.post("/tools/list", (req, res) => {
    if (!requireAuth(req, res)) {
        return;
    }

    res.json(jsonToolsPayload());
});

router.post("/mcp", handleJsonRpcHttp);
router.post("/mcp/rpc", handleJsonRpcHttp);

export default router;