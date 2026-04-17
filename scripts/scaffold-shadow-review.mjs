import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const POLICY_SPECS = {
    retry_backoff: {
        title: "Retry Backoff Shadow Review",
        envKeys: ["MAX_RETRIES", "RETRY_BACKOFF_MS"],
        observationGuidance: [
            "retry_scheduled job count 변화",
            "queue backlog 회복 시간",
            "deadletter 또는 failedLike 증가 여부",
        ],
        rollbackTriggers: [
            "failedLike job count가 baseline 대비 증가",
            "retry_scheduled backlog가 관측 창에서 누적",
            "operator summary readiness가 degraded로 악화",
        ],
    },
    autonomy_cadence: {
        title: "Autonomy Cadence Shadow Review",
        envKeys: [
            "AUTONOMY_SCHEDULER_ENABLED",
            "AUTONOMY_SCHEDULER_INTERVAL_MS",
            "AUTONOMY_SCHEDULER_POLL_MS",
            "AUTONOMY_SCHEDULER_TIME",
            "AUTONOMY_SCHEDULER_TIMEZONE",
            "AUTONOMY_MAX_ATTEMPTS_PER_DAY",
            "AUTONOMY_STALE_LOCK_MS",
            "AUTONOMY_AUTO_CLEAR_STALE_LOCKS",
        ],
        observationGuidance: [
            "pending approval backlog 증가 여부",
            "dailyCap remainingAttempts 소진 패턴",
            "lockHealth stale 빈도와 reason 변화",
        ],
        rollbackTriggers: [
            "pending approval이 baseline 대비 누적",
            "stale lock 또는 queue mismatch 반복 발생",
            "작동 cadence 변경 후 operator intervention 빈도 증가",
        ],
    },
    quality_threshold: {
        title: "Quality Threshold Shadow Review",
        envKeys: [],
        manualFields: ["targetStructureScore", "targetAudioScore", "maxStructureAttempts"],
        observationGuidance: [
            "weakest section 분포 변화",
            "audio retry trend 증가 여부",
            "selectedAttempt와 stopReason 변화",
        ],
        rollbackTriggers: [
            "retry 횟수는 늘었지만 score improvement가 없음",
            "weakest section이 더 자주 남음",
            "operator review 부담이 baseline보다 증가",
        ],
    },
    warning_threshold: {
        title: "Warning Threshold Shadow Review",
        envKeys: ["OVERSEER_INTERVAL_MS"],
        manualFields: ["activeRepeatedWarning threshold", "incident escalation threshold"],
        observationGuidance: [
            "repeatedWarnings count 변화",
            "incident noise 감소 또는 누락 발생 여부",
            "latest-error.json 또는 projection error 증가 여부",
        ],
        rollbackTriggers: [
            "실제 문제를 감추는 false negative가 발생",
            "경고 노이즈는 줄지 않고 operator triage만 늦어짐",
            "projection 또는 summary evidence가 stale 해짐",
        ],
    },
};

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

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function writeAtomic(filePath, text) {
    ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, text, "utf-8");
    fs.renameSync(tempPath, filePath);
}

function toTrimmed(value, fallback = "-") {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function slugify(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "shadow-review";
}

function resolveOutputDir() {
    return readOption("dir") || process.env.AXIOM_SHADOW_REVIEW_DIR || "docs/planning/gate-runs/shadow-reviews";
}

function resolvePolicy() {
    const value = toTrimmed(readOption("policy"), "");
    if (!value) {
        fail("--policy is required", { supportedPolicies: Object.keys(POLICY_SPECS) });
    }
    if (!(value in POLICY_SPECS)) {
        fail("Unsupported shadow review policy", { policy: value, supportedPolicies: Object.keys(POLICY_SPECS) });
    }
    return value;
}

async function collectOperatorSummary() {
    const args = ["scripts/print-operator-summary.mjs"];
    const passThroughOptions = ["url", "source", "jobLimit", "windowHours", "token", "namespace"];
    for (const option of passThroughOptions) {
        const value = readOption(option);
        if (value) {
            args.push(`--${option}`, value);
        }
    }

    const result = await execFileAsync(process.execPath, args, {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 1024 * 1024,
    });

    const stdout = String(result.stdout || "").trim();
    if (!stdout) {
        fail("Operator summary script produced no output", {});
    }

    try {
        return JSON.parse(stdout);
    } catch (error) {
        fail("Operator summary script returned non-JSON output", {
            stdout,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function buildBaselineConfig(spec) {
    const env = {};
    for (const key of spec.envKeys) {
        env[key] = process.env[key] ?? "";
    }

    return {
        env,
        manualFields: spec.manualFields ?? [],
    };
}

function buildMarkdown(review) {
    const envEntries = Object.entries(review.baseline.config.env);
    const manualFields = Array.isArray(review.baseline.config.manualFields) ? review.baseline.config.manualFields : [];
    const observationGuidance = Array.isArray(review.observation.guidance) ? review.observation.guidance : [];
    const rollbackTriggers = Array.isArray(review.rollback.triggers) ? review.rollback.triggers : [];
    const rollbackChecklist = Array.isArray(review.rollback.checklist) ? review.rollback.checklist : [];

    const lines = [
        `# ${review.title}`,
        "",
        `- generated_at: ${review.generatedAt}`,
        `- policy: ${review.policy}`,
        `- source: ${review.source}`,
        `- base_url: ${review.baseUrl}`,
        `- namespace: ${review.namespace}`,
        `- owner: ${review.owner}`,
        `- observation_window: ${review.observation.window}`,
        `- candidate: ${review.candidate.summary}`,
        "",
        "## Baseline Config",
        "",
    ];

    if (envEntries.length === 0) {
        lines.push("- env snapshot: none");
    } else {
        for (const [key, value] of envEntries) {
            lines.push(`- ${key}: ${toTrimmed(value, "<unset>")}`);
        }
    }

    if (manualFields.length > 0) {
        lines.push("", "## Manual Fields To Fill", "");
        for (const field of manualFields) {
            lines.push(`- ${field}: TODO`);
        }
    }

    lines.push(
        "",
        "## Baseline Operator Snapshot",
        "",
        `- summary: ${toTrimmed(review.baseline.operatorSummary.summary)}`,
        `- readiness: ${toTrimmed(review.baseline.operatorSummary.readiness?.status)}`,
        `- queue total: ${review.baseline.operatorSummary.queue?.total ?? 0}`,
        `- pending approvals: ${review.baseline.operatorSummary.autonomy?.pendingApprovalCount ?? 0}`,
        `- overseer warnings: ${review.baseline.operatorSummary.overseer?.activeRepeatedWarningCount ?? 0}`,
        "",
        "## Candidate Change",
        "",
        `- summary: ${review.candidate.summary}`,
        `- env_overrides: ${review.candidate.envOverrides.length > 0 ? review.candidate.envOverrides.join(", ") : "TODO"}`,
        "",
        "## Observation Guidance",
        "",
    );

    for (const item of observationGuidance) {
        lines.push(`- ${item}`);
    }

    lines.push("", "## Rollback Triggers", "");
    for (const item of rollbackTriggers) {
        lines.push(`- [ ] ${item}`);
    }

    lines.push("", "## Rollback Checklist", "");
    for (const item of rollbackChecklist) {
        lines.push(`- [ ] ${item}`);
    }

    lines.push("", "## Artifacts", "");
    for (const item of review.artifacts) {
        lines.push(`- ${item}`);
    }

    return lines.join("\n") + "\n";
}

async function main() {
    const policy = resolvePolicy();
    const spec = POLICY_SPECS[policy];
    const outputDir = resolveOutputDir();
    const generatedAt = new Date().toISOString();
    const dateKey = generatedAt.slice(0, 10);
    const slug = `${dateKey}_${slugify(policy)}-shadow-review`;
    const owner = toTrimmed(readOption("owner") || process.env.AXIOM_SHADOW_REVIEW_OWNER, "unassigned");
    const source = toTrimmed(readOption("source") || process.env.AXIOM_OPERATOR_SOURCE, "gcpCompute");
    const baseUrl = toTrimmed(readOption("url") || process.env.AXIOM_BASE_URL, "http://127.0.0.1:3100");
    const namespace = toTrimmed(readOption("namespace") || process.env.AXIOM_NAMESPACE, "axiom");
    const observationWindow = toTrimmed(readOption("window") || process.env.AXIOM_SHADOW_REVIEW_WINDOW, "24h default observation window");
    const candidateSummary = toTrimmed(readOption("candidate") || process.env.AXIOM_SHADOW_REVIEW_CANDIDATE, "TODO: candidate change summary");
    const envOverrideText = toTrimmed(readOption("envOverrides") || process.env.AXIOM_SHADOW_REVIEW_ENV_OVERRIDES, "");
    const envOverrides = envOverrideText
        ? envOverrideText.split(",").map((item) => item.trim()).filter(Boolean)
        : [];

    const operatorSummary = await collectOperatorSummary();
    const jsonPath = path.join(outputDir, `${slug}.json`);
    const markdownPath = path.join(outputDir, `${slug}.md`);

    const review = {
        ok: true,
        generatedAt,
        title: spec.title,
        policy,
        source,
        baseUrl,
        namespace,
        owner,
        observation: {
            window: observationWindow,
            guidance: spec.observationGuidance,
        },
        baseline: {
            config: buildBaselineConfig(spec),
            operatorSummary,
        },
        candidate: {
            summary: candidateSummary,
            envOverrides,
        },
        rollback: {
            triggers: spec.rollbackTriggers,
            checklist: [
                "latest.json/latest.md/upstream-compatible.json을 baseline artifact와 비교한다.",
                "runtime readiness와 pending approval, repeated warning 악화를 확인한다.",
                "candidate env override를 제거하거나 baseline 값으로 되돌린다.",
                "rollback 이후 새 operator summary projection을 다시 남긴다.",
            ],
        },
        artifacts: [
            "outputs/_system/operator-summary/latest.json",
            "outputs/_system/operator-summary/latest.md",
            "outputs/_system/operator-summary/upstream-compatible.json",
            "outputs/_system/operator-summary/history/YYYY-MM-DD.jsonl",
        ],
    };

    writeAtomic(jsonPath, JSON.stringify(review, null, 2) + "\n");
    writeAtomic(markdownPath, buildMarkdown(review));

    console.log(JSON.stringify({
        ok: true,
        policy,
        title: spec.title,
        outputDir,
        artifacts: [jsonPath, markdownPath],
        baselineSummary: operatorSummary.summary,
    }, null, 2));
}

main().catch((error) => {
    fail("AXIOM shadow review scaffold failed", {
        error: error instanceof Error ? error.message : String(error),
    });
});