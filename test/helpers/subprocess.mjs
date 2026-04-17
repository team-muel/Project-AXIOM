import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runNodeEval(code, options = {}) {
    const { cwd, env } = options;
    const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", code], {
        cwd,
        env: {
            ...process.env,
            ...env,
        },
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