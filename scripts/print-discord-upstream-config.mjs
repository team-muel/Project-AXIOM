const DEFAULT_ID = "axiom";
const DEFAULT_NAMESPACE = "axiom";
const DEFAULT_PROTOCOL = "simple";

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

function resolveBaseUrl() {
    const explicit = readOption("url") || process.env.AXIOM_MCP_BASE_URL;
    if (explicit) {
        return explicit.replace(/\/+$/, "");
    }

    const port = Number.parseInt(process.env.MCP_HTTP_PORT || "3210", 10);
    const safePort = Number.isFinite(port) ? port : 3210;
    return `http://127.0.0.1:${safePort}`;
}

const config = {
    id: readOption("id") || process.env.AXIOM_UPSTREAM_ID || DEFAULT_ID,
    url: resolveBaseUrl(),
    namespace: readOption("namespace") || process.env.AXIOM_UPSTREAM_NAMESPACE || DEFAULT_NAMESPACE,
    token: readOption("token") || process.env.MCP_WORKER_AUTH_TOKEN || "<set-mcp-worker-auth-token>",
    protocol: readOption("protocol") || process.env.AXIOM_UPSTREAM_PROTOCOL || DEFAULT_PROTOCOL,
};

console.log(JSON.stringify([config], null, 2));