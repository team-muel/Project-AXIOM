import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runNodeEval(code, options = {}) {
    const { cwd, env } = options;
    // Merge parent env with test-specific overrides.
    // Keys explicitly set to undefined in `env` are deleted from the child env
    // so tests can isolate themselves from parent-process env vars.
    const merged = { ...process.env, ...env };
    if (env) {
        for (const key of Object.keys(env)) {
            if (env[key] === undefined) delete merged[key];
        }
    }
    const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", code], {
        cwd,
        env: merged,
        maxBuffer: 1024 * 1024,
    });

    return {
        stdout: String(result.stdout ?? "").trim(),
        stderr: String(result.stderr ?? "").trim(),
    };
}

export function parseLastJsonLine(stdout) {
    const lines = String(stdout ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const last = lines.at(-1);
    if (!last) {
        throw new Error("No JSON output received from subprocess");
    }

    return JSON.parse(last);
}