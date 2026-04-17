const REQUIRED_TOOLS = [
    "axiom_compose",
    "axiom_job_list",
    "axiom_overseer_summary",
    "axiom_autonomy_status",
];

function readOption(name) {
    const prefix = `--${name}=`;
    const exactIndex = process.argv.indexOf(`--${name}`);
    if (exactIndex >= 0) {
        return process.argv[exactIndex + 1];
    }

    const prefixed = process.argv.find((entry) => entry.startsWith(prefix));
    if (prefixed) {
        return prefixed.slice(prefix.length);
    }

    return undefined;
}

function fail(message, details) {
    const payload = {
        ok: false,
        message,
        details,
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
}

function resolveBaseUrl() {
    const explicit = readOption("url") || process.env.AXIOM_MCP_BASE_URL;
    if (explicit) {
        return explicit.replace(/\/+$/, "");
    }

    const port = Number.parseInt(process.env.MCP_HTTP_PORT || "3210", 10);
    const safePort = Number.isFinite(port) ? port : 3210;
    return `http://127.0.0.1:${safePort}`;
}

function buildHeaders(token) {
    const headers = {
        "content-type": "application/json",
    };

    if (token) {
        headers.authorization = `Bearer ${token}`;
    }

    return headers;
}

async function readJson(response) {
    const text = await response.text();
    if (!text.trim()) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        fail("Non-JSON response from AXIOM MCP endpoint", {
            status: response.status,
            text,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function main() {
    const baseUrl = resolveBaseUrl();
    const token = readOption("token") || process.env.MCP_WORKER_AUTH_TOKEN || "";
    const headers = buildHeaders(token);

    const healthResponse = await fetch(`${baseUrl}/mcp/health`);
    if (!healthResponse.ok) {
        fail("AXIOM MCP health endpoint is not reachable", {
            baseUrl,
            status: healthResponse.status,
        });
    }
    const health = await readJson(healthResponse);

    const metadataResponse = await fetch(`${baseUrl}/mcp`);
    if (!metadataResponse.ok) {
        fail("AXIOM MCP metadata endpoint is not reachable", {
            baseUrl,
            status: metadataResponse.status,
        });
    }
    const metadata = await readJson(metadataResponse);

    const initializeResponse = await fetch(`${baseUrl}/mcp/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {},
        }),
    });
    const initializePayload = await readJson(initializeResponse);
    if (!initializeResponse.ok) {
        fail("AXIOM MCP initialize failed", {
            baseUrl,
            status: initializeResponse.status,
            payload: initializePayload,
            tokenConfigured: Boolean(token),
        });
    }

    const toolsListResponse = await fetch(`${baseUrl}/mcp/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
        }),
    });
    const toolsListPayload = await readJson(toolsListResponse);
    if (!toolsListResponse.ok) {
        fail("AXIOM MCP tools/list failed", {
            baseUrl,
            status: toolsListResponse.status,
            payload: toolsListPayload,
        });
    }

    const tools = Array.isArray(toolsListPayload?.result?.tools)
        ? toolsListPayload.result.tools
        : [];
    const toolNames = tools
        .map((tool) => (tool && typeof tool.name === "string" ? tool.name : ""))
        .filter(Boolean);

    const missingTools = REQUIRED_TOOLS.filter((name) => !toolNames.includes(name));
    if (missingTools.length > 0) {
        fail("AXIOM MCP tool catalog is missing required bridge tools", {
            missingTools,
            toolCount: toolNames.length,
        });
    }

    const probeCallResponse = await fetch(`${baseUrl}/mcp/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
                name: "axiom_job_list",
                arguments: { limit: 3 },
            },
        }),
    });
    const probeCallPayload = await readJson(probeCallResponse);
    if (!probeCallResponse.ok || probeCallPayload?.error) {
        fail("AXIOM MCP probe tool call failed", {
            baseUrl,
            status: probeCallResponse.status,
            payload: probeCallPayload,
        });
    }

    const fallbackResponse = await fetch(`${baseUrl}/tools/list`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
    });
    const fallbackPayload = await readJson(fallbackResponse);
    if (!fallbackResponse.ok || !Array.isArray(fallbackPayload?.tools)) {
        fail("AXIOM MCP fallback /tools/list is not compatible", {
            baseUrl,
            status: fallbackResponse.status,
            payload: fallbackPayload,
        });
    }

    console.log(JSON.stringify({
        ok: true,
        baseUrl,
        tokenConfigured: Boolean(token),
        healthStatus: health?.status ?? null,
        healthAuthRequired: health?.auth?.required ?? null,
        healthReadinessStatus: health?.readiness?.status ?? null,
        healthToolCount: typeof health?.tools === "number" ? health.tools : null,
        metadata,
        requiredTools: REQUIRED_TOOLS,
        toolCount: toolNames.length,
        sampleTools: toolNames.slice(0, 8),
        probeCallStatus: probeCallResponse.status,
        fallbackStatus: fallbackResponse.status,
    }, null, 2));
}

main().catch((error) => {
    fail("AXIOM MCP bridge verification crashed", {
        error: error instanceof Error ? error.message : String(error),
    });
});