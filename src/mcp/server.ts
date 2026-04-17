import readline from "node:readline";
import { setLogStream } from "../logging/logger.js";
import { fail, handleMcpRequest, isJsonRpcNotification } from "./protocol.js";
import type { JsonRpcRequest, JsonRpcResponse } from "./types.js";

function writeResponse(response: JsonRpcResponse): void {
    process.stdout.write(`${JSON.stringify(response)}\n`);
}

function sanitizeLine(line: string): string {
    return line.replace(/^[\uFEFF\x00-\x08\x0E-\x1F]+/, "").trim();
}

export function startMcpStdioServer(): void {
    setLogStream("stderr");

    const rl = readline.createInterface({
        input: process.stdin,
        terminal: false,
    });

    rl.on("line", async (line) => {
        const raw = sanitizeLine(String(line ?? ""));
        if (!raw || raw[0] !== "{") {
            return;
        }

        let request: JsonRpcRequest;
        try {
            request = JSON.parse(raw) as JsonRpcRequest;
        } catch {
            writeResponse(fail(null, -32700, "parse error"));
            return;
        }

        try {
            const response = await handleMcpRequest(request);
            if (!isJsonRpcNotification(request)) {
                writeResponse(response);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!isJsonRpcNotification(request)) {
                writeResponse(fail(request.id ?? null, -32000, message));
            }
        }
    });

    process.stderr.write("[mcp] AXIOM stdio server started\n");
}

startMcpStdioServer();