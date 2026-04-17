import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import type { JobManifest } from "../pipeline/types.js";

// ── 컨텍스트 수집 ────────────────────────────────────

export interface AxiomContextSnapshot {
    logs: string;
    manifests: JobManifest[];
    logLineCount: number;
}

export function readRecentLogs(maxLines: number): string {
    const logPath = path.join(config.logDir, "runtime.jsonl");
    if (!fs.existsSync(logPath)) return "(no log file found)";

    const raw = fs.readFileSync(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const recent = lines.slice(-maxLines);
    return recent.join("\n");
}

export function readRecentManifests(maxCount: number): JobManifest[] {
    if (!fs.existsSync(config.outputDir)) return [];

    const songDirs = fs
        .readdirSync(config.outputDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({
            name: d.name,
            mtime: fs.statSync(path.join(config.outputDir, d.name)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
        .slice(0, maxCount)
        .map((d) => d.name);

    const manifests: JobManifest[] = [];
    for (const dir of songDirs) {
        const manifestPath = path.join(config.outputDir, dir, "manifest.json");
        if (fs.existsSync(manifestPath)) {
            try {
                manifests.push(JSON.parse(fs.readFileSync(manifestPath, "utf-8")));
            } catch {
                // 손상된 manifest는 건너뜀
            }
        }
    }
    return manifests;
}

export function collectRecentAxiomContext(maxLogLines: number, maxManifestCount: number): AxiomContextSnapshot {
    const logs = readRecentLogs(maxLogLines);
    const manifests = readRecentManifests(maxManifestCount);

    return {
        logs,
        manifests,
        logLineCount: logs.split("\n").filter(Boolean).length,
    };
}

// ── Gemma 4 Overseer 프롬프트 ────────────────────────

function buildPrompt(logs: string, manifests: JobManifest[]): string {
    const manifestSummary = manifests
        .map((m) => {
            const artifacts = Object.entries(m.artifacts)
                .filter(([, v]) => v)
                .map(([k]) => k)
                .join(", ");
            const issues = m.errorMessage ?? "none";
            return `- songId=${m.songId.slice(0, 8)} state=${m.state} key=${m.meta.key ?? "?"} tempo=${m.meta.tempo ?? "?"} artifacts=[${artifacts}] error=${issues}`;
        })
        .join("\n");

    return `You are the Overseer of AXIOM, an autonomous classical music production pipeline.
Your role is read-only: analyze logs and manifests, then report concisely.

## Recent Runtime Log (last ${config.overseerLogLines} lines — JSONL format)
\`\`\`
${logs}
\`\`\`

## Recent Song Manifests (last ${manifests.length})
${manifestSummary || "(none)"}

## Your Task
In 200 words or fewer, provide:
1. **Current Status**: Overall pipeline health (one sentence).
2. **Issues Found**: List any errors, warnings, or anomalies (bullet points). If none, say "None".
3. **Top 3 Recommended Actions**: Prioritized fixes or next steps.

Be specific. Reference songIds, state names, and error codes where relevant.
Respond in the same language as the prompt language context (Korean or English).`;
}

// ── Ollama API 호출 ───────────────────────────────────

interface OllamaResponse {
    model: string;
    response: string;
    done: boolean;
}

async function callOllama(prompt: string): Promise<string> {
    return generateOllamaText(prompt, {
        temperature: 0.3,
        maxTokens: 512,
    });
}

export async function generateOllamaText(
    prompt: string,
    options?: {
        temperature?: number;
        maxTokens?: number;
    },
): Promise<string> {
    const url = `${config.ollamaUrl}/api/generate`;

    const body = JSON.stringify({
        model: config.ollamaModel,
        prompt,
        stream: false,
        options: {
            temperature: options?.temperature ?? 0.3,
            num_predict: options?.maxTokens ?? 512,
        },
    });

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
        throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as OllamaResponse;
    return data.response.trim();
}

// ── 공개 API ─────────────────────────────────────────

export interface OverseerReport {
    generatedAt: string;
    model: string;
    logLines: number;
    manifestsRead: number;
    report: string;
}

export async function runOverseer(): Promise<OverseerReport> {
    logger.info("Overseer: collecting context");

    const { logs, manifests, logLineCount } = collectRecentAxiomContext(
        config.overseerLogLines,
        config.overseerManifestCount,
    );
    logger.info("Overseer: context collected", {
        logLines: logLineCount,
        manifests: manifests.length,
    });

    const prompt = buildPrompt(logs, manifests);

    logger.info("Overseer: querying Gemma 4", { model: config.ollamaModel });
    const report = await callOllama(prompt);

    logger.info("Overseer: report ready");

    return {
        generatedAt: new Date().toISOString(),
        model: config.ollamaModel,
        logLines: logLineCount,
        manifestsRead: manifests.length,
        report,
    };
}

export async function checkOllamaReachable(): Promise<boolean> {
    try {
        const res = await fetch(`${config.ollamaUrl}/api/tags`, {
            signal: AbortSignal.timeout(3000),
        });
        return res.ok;
    } catch {
        return false;
    }
}
