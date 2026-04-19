import fs from "node:fs";
import path from "node:path";

type SearchBudgetLevel = "S0" | "S1" | "S2" | "S3" | "S4" | "custom";
type ComposeSource = "api" | "autonomy";
type ComposeWorkflow = "symbolic_only" | "symbolic_plus_audio";

interface SearchBudgetConfig {
    candidateCount: number;
    localizedRewriteBranches: number;
    searchBudgetLevel: SearchBudgetLevel;
    searchBudgetDescriptor: string;
}

interface BenchmarkBatchRunRecord {
    benchmarkId: string;
    songId: string;
    repeatIndex: number;
    workflow: ComposeWorkflow;
    source: ComposeSource;
    approvalStatus: string | null;
    reviewRubricVersion: string | null;
    state: string | null;
    selectedCandidateId: string | null;
    observedAt: string | null;
    manifestPath: string;
    candidateIndexPath: string;
    error?: string;
}

interface JsonRecord {
    [key: string]: unknown;
}

function readOption(name: string): string | undefined {
    const exactIndex = process.argv.indexOf(`--${name}`);
    if (exactIndex >= 0) {
        return process.argv[exactIndex + 1];
    }

    const prefix = `--${name}=`;
    const prefixed = process.argv.find((entry) => entry.startsWith(prefix));
    if (prefixed) {
        return prefixed.slice(prefix.length);
    }

    return undefined;
}

function readBooleanOption(name: string, fallback: boolean): boolean {
    const value = readOption(name);
    if (value === undefined) {
        return fallback;
    }

    return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function toTrimmed(value: unknown): string {
    return String(value ?? "").trim();
}

function sanitizeBatchId(value: string): string {
    return toTrimmed(value)
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function fail(message: string, details: JsonRecord = {}): never {
    console.error(JSON.stringify({ ok: false, message, details }, null, 2));
    process.exit(1);
}

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonIfExists<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function toNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function parseIntegerOption(name: string, fallback: number, minimum: number, maximum: number): number {
    const value = readOption(name);
    if (value === undefined) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
        fail(`Invalid ${name}`, { value, minimum, maximum });
    }

    return parsed;
}

function classifySearchBudget(
    candidateCount: number,
    localizedRewriteBranches: number,
): SearchBudgetLevel {
    if (localizedRewriteBranches > 0 && candidateCount >= 4) {
        return "S4";
    }

    switch (candidateCount) {
        case 1:
            return "S0";
        case 2:
            return "S1";
        case 4:
            return "S2";
        case 8:
            return "S3";
        default:
            return "custom";
    }
}

function describeSearchBudget(
    searchBudgetLevel: SearchBudgetLevel,
    candidateCount: number,
    localizedRewriteBranches: number,
): string {
    if (searchBudgetLevel !== "custom") {
        return searchBudgetLevel;
    }

    return localizedRewriteBranches > 0
        ? `custom(${candidateCount}+${localizedRewriteBranches})`
        : `custom(${candidateCount})`;
}

function resolveSearchBudgetConfig(): SearchBudgetConfig {
    const rawSearchBudget = toTrimmed(readOption("searchBudget"));
    const rawCandidateCount = readOption("candidateCount");
    const rawLocalizedRewriteBranches = readOption("localizedRewriteBranches");
    if (rawSearchBudget && (rawCandidateCount !== undefined || rawLocalizedRewriteBranches !== undefined)) {
        fail("searchBudget cannot be combined with candidateCount or localizedRewriteBranches", {
            searchBudget: rawSearchBudget,
            candidateCount: rawCandidateCount,
            localizedRewriteBranches: rawLocalizedRewriteBranches,
        });
    }

    let candidateCount = 2;
    let localizedRewriteBranches = 0;

    if (rawSearchBudget) {
        switch (rawSearchBudget.toUpperCase()) {
            case "S0":
                candidateCount = 1;
                break;
            case "S1":
                candidateCount = 2;
                break;
            case "S2":
                candidateCount = 4;
                break;
            case "S3":
                candidateCount = 8;
                break;
            case "S4":
                candidateCount = 4;
                localizedRewriteBranches = 2;
                break;
            default: {
                const match = /^custom\((\d+)(?:\+(\d+))?\)$/i.exec(rawSearchBudget);
                if (!match) {
                    fail("Unsupported searchBudget", {
                        searchBudget: rawSearchBudget,
                        supported: ["S0", "S1", "S2", "S3", "S4", "custom(3)", "custom(3+1)"],
                    });
                }

                candidateCount = Number.parseInt(match[1], 10);
                localizedRewriteBranches = match[2] ? Number.parseInt(match[2], 10) : 0;
                break;
            }
        }
    } else {
        candidateCount = rawCandidateCount !== undefined
            ? parseIntegerOption("candidateCount", 2, 1, 8)
            : 2;
        localizedRewriteBranches = rawLocalizedRewriteBranches !== undefined
            ? parseIntegerOption("localizedRewriteBranches", 0, 1, 4)
            : 0;
    }

    if (localizedRewriteBranches > 0 && candidateCount < 3) {
        fail("localizedRewriteBranches requires candidateCount of at least 3", {
            candidateCount,
            localizedRewriteBranches,
        });
    }

    const searchBudgetLevel = classifySearchBudget(candidateCount, localizedRewriteBranches);
    return {
        candidateCount,
        localizedRewriteBranches,
        searchBudgetLevel,
        searchBudgetDescriptor: describeSearchBudget(searchBudgetLevel, candidateCount, localizedRewriteBranches),
    };
}

function resolveWorkflow(): ComposeWorkflow {
    const workflow = toTrimmed(readOption("workflow") || "symbolic_only");
    if (workflow !== "symbolic_only" && workflow !== "symbolic_plus_audio") {
        fail("Unsupported workflow", { workflow, supported: ["symbolic_only", "symbolic_plus_audio"] });
    }

    return workflow;
}

function resolveSource(): ComposeSource {
    const source = toTrimmed(readOption("source") || "api");
    if (source !== "api" && source !== "autonomy") {
        fail("Unsupported source", { source, supported: ["api", "autonomy"] });
    }

    return source;
}

function normalizePathLike(filePath: string): string {
    return path.resolve(filePath).split(path.sep).join("/");
}

function manifestFilePath(outputDir: string, songId: string): string {
    return path.join(outputDir, songId, "manifest.json");
}

function candidateIndexFilePath(outputDir: string, songId: string): string {
    return path.join(outputDir, songId, "candidates", "index.json");
}

function buildBatchRoot(outputDir: string, batchId: string): string {
    return path.join(outputDir, "_system", "ml", "benchmark-runs", "learned-backbone", batchId);
}

function buildSongId(batchId: string, benchmarkId: string, repeatIndex: number): string {
    return sanitizeBatchId(`${batchId}-${benchmarkId}-r${String(repeatIndex + 1).padStart(2, "0")}`);
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function maybeMarkPendingReview(
    filePath: string,
    reviewPending: boolean,
    reviewRubricVersion: string,
): {
    approvalStatus: string | null;
    reviewRubricVersion: string | null;
} {
    const manifest = readJsonIfExists<JsonRecord>(filePath);
    if (!manifest) {
        return {
            approvalStatus: null,
            reviewRubricVersion: null,
        };
    }

    let changed = false;
    const currentApprovalStatus = toTrimmed(manifest.approvalStatus) || null;
    if (reviewPending && (!currentApprovalStatus || currentApprovalStatus === "not_required")) {
        manifest.approvalStatus = "pending";
        changed = true;
    }

    const reviewFeedback = manifest.reviewFeedback && typeof manifest.reviewFeedback === "object"
        ? manifest.reviewFeedback as JsonRecord
        : {};
    if (toTrimmed(reviewFeedback.reviewRubricVersion) !== reviewRubricVersion) {
        reviewFeedback.reviewRubricVersion = reviewRubricVersion;
        manifest.reviewFeedback = reviewFeedback;
        changed = true;
    }

    if (changed) {
        writeJson(filePath, manifest);
    }

    return {
        approvalStatus: toTrimmed(manifest.approvalStatus) || null,
        reviewRubricVersion: toTrimmed((manifest.reviewFeedback as JsonRecord | undefined)?.reviewRubricVersion) || null,
    };
}

async function main(): Promise<void> {
    const outputDir = path.resolve(process.cwd(), readOption("outputDir") || process.env.OUTPUT_DIR || "outputs");
    const rawBatchId = readOption("batchId") || readOption("snapshot") || new Date().toISOString().replace(/[:.]/g, "-");
    const batchId = sanitizeBatchId(rawBatchId);
    if (!batchId) {
        fail("Batch identifier resolved to an empty value", { rawBatchId });
    }

    const workflow = resolveWorkflow();
    const source = resolveSource();
    const repeat = parseIntegerOption("repeat", 1, 1, 100);
    const reviewPending = readBooleanOption("reviewPending", true);
    const requestedBenchmarkIds = toTrimmed(readOption("benchmarkIds"))
        .split(",")
        .map((value) => toTrimmed(value))
        .filter(Boolean);
    const searchBudget = resolveSearchBudgetConfig();
    const pythonBin = toTrimmed(readOption("pythonBin"));

    ensureDir(outputDir);

    process.env.OUTPUT_DIR = outputDir;
    if (pythonBin) {
        process.env.PYTHON_BIN = pythonBin;
    }
    if (!process.env.LOG_LEVEL) {
        process.env.LOG_LEVEL = "error";
    }

    const [
        { runPipeline },
        {
            FIXED_APPROVAL_REVIEW_RUBRIC,
            FIXED_STRING_TRIO_SYMBOLIC_BENCHMARK_PACK,
            STRING_TRIO_SYMBOLIC_BENCHMARK_PACK_VERSION,
            STRING_TRIO_SYMBOLIC_LANE,
        },
    ] = await Promise.all([
        import("../src/pipeline/orchestrator.js"),
        import("../src/pipeline/learnedSymbolicContract.js"),
    ]);

    const batchRoot = buildBatchRoot(outputDir, batchId);
    if (fs.existsSync(batchRoot)) {
        fail("Benchmark batch already exists", { batchId, batchRoot: normalizePathLike(batchRoot) });
    }

    const supportedBenchmarkIds = FIXED_STRING_TRIO_SYMBOLIC_BENCHMARK_PACK.entries.map((entry) => entry.benchmarkId);
    const selectedEntries = requestedBenchmarkIds.length > 0
        ? FIXED_STRING_TRIO_SYMBOLIC_BENCHMARK_PACK.entries.filter((entry) => requestedBenchmarkIds.includes(entry.benchmarkId))
        : FIXED_STRING_TRIO_SYMBOLIC_BENCHMARK_PACK.entries;
    const missingBenchmarkIds = requestedBenchmarkIds.filter((benchmarkId) => !supportedBenchmarkIds.includes(benchmarkId));
    if (missingBenchmarkIds.length > 0) {
        fail("Unknown benchmarkIds requested", {
            missingBenchmarkIds,
            supportedBenchmarkIds,
        });
    }
    if (selectedEntries.length === 0) {
        fail("No benchmark entries selected", { requestedBenchmarkIds, supportedBenchmarkIds });
    }

    const plannedRuns = [] as Array<{
        benchmarkId: string;
        coverageTags: string[];
        repeatIndex: number;
        songId: string;
        request: JsonRecord;
    }>;
    for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1) {
        for (const entry of selectedEntries) {
            const songId = buildSongId(batchId, entry.benchmarkId, repeatIndex);
            if (fs.existsSync(path.join(outputDir, songId))) {
                fail("Target song directory already exists", {
                    songId,
                    path: normalizePathLike(path.join(outputDir, songId)),
                });
            }

            const request = cloneJson(entry.request) as JsonRecord;
            plannedRuns.push({
                benchmarkId: entry.benchmarkId,
                coverageTags: [...entry.coverageTags],
                repeatIndex,
                songId,
                request,
            });
        }
    }

    const runRecords: BenchmarkBatchRunRecord[] = [];
    for (const plannedRun of plannedRuns) {
        const request = cloneJson(plannedRun.request) as JsonRecord;
        request.songId = plannedRun.songId;
        request.source = source;
        request.workflow = workflow;
        request.selectedModels = [
            { role: "structure", provider: "learned", model: "learned-symbolic-trio-v1" },
        ];
        request.evaluationPolicy = {
            requireStructurePass: false,
            requireAudioPass: false,
            summarizeWithLLM: false,
        };
        request.qualityPolicy = {
            enableAutoRevision: false,
            maxStructureAttempts: 1,
            targetStructureScore: 0,
            ...(workflow !== "symbolic_only" ? { targetAudioScore: 0 } : {}),
        };
        request.candidateCount = searchBudget.candidateCount;
        if (searchBudget.localizedRewriteBranches > 0) {
            request.localizedRewriteBranches = searchBudget.localizedRewriteBranches;
        }

        const compositionPlan = request.compositionPlan && typeof request.compositionPlan === "object"
            ? request.compositionPlan as JsonRecord
            : null;
        if (compositionPlan) {
            compositionPlan.workflow = workflow;
        }

        const manifestPath = manifestFilePath(outputDir, plannedRun.songId);
        const candidateIndexPath = candidateIndexFilePath(outputDir, plannedRun.songId);
        try {
            const manifest = await runPipeline(request as never);
            const reviewState = maybeMarkPendingReview(
                manifestPath,
                reviewPending,
                FIXED_APPROVAL_REVIEW_RUBRIC.version,
            );
            const candidateIndex = readJsonIfExists<JsonRecord>(candidateIndexPath);
            runRecords.push({
                benchmarkId: plannedRun.benchmarkId,
                songId: plannedRun.songId,
                repeatIndex: plannedRun.repeatIndex,
                workflow,
                source,
                approvalStatus: reviewState.approvalStatus,
                reviewRubricVersion: reviewState.reviewRubricVersion,
                state: toTrimmed((manifest as JsonRecord).state) || null,
                selectedCandidateId: toTrimmed(candidateIndex?.selectedCandidateId) || null,
                observedAt: toTrimmed((manifest as JsonRecord).updatedAt) || null,
                manifestPath: normalizePathLike(manifestPath),
                candidateIndexPath: normalizePathLike(candidateIndexPath),
            });
        } catch (error) {
            const reviewState = maybeMarkPendingReview(
                manifestPath,
                reviewPending,
                FIXED_APPROVAL_REVIEW_RUBRIC.version,
            );
            const manifest = readJsonIfExists<JsonRecord>(manifestPath);
            const candidateIndex = readJsonIfExists<JsonRecord>(candidateIndexPath);
            runRecords.push({
                benchmarkId: plannedRun.benchmarkId,
                songId: plannedRun.songId,
                repeatIndex: plannedRun.repeatIndex,
                workflow,
                source,
                approvalStatus: reviewState.approvalStatus,
                reviewRubricVersion: reviewState.reviewRubricVersion,
                state: toTrimmed(manifest?.state) || null,
                selectedCandidateId: toTrimmed(candidateIndex?.selectedCandidateId) || null,
                observedAt: toTrimmed(manifest?.updatedAt) || null,
                manifestPath: normalizePathLike(manifestPath),
                candidateIndexPath: normalizePathLike(candidateIndexPath),
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const succeededRunCount = runRecords.filter((record) => !record.error).length;
    const failedRunCount = runRecords.length - succeededRunCount;
    const batchManifestPath = path.join(batchRoot, "manifest.json");
    const batchManifest = {
        batchId,
        generatedAt: new Date().toISOString(),
        outputDir: normalizePathLike(outputDir),
        lane: STRING_TRIO_SYMBOLIC_LANE,
        benchmarkPackVersion: STRING_TRIO_SYMBOLIC_BENCHMARK_PACK_VERSION,
        reviewRubricVersion: FIXED_APPROVAL_REVIEW_RUBRIC.version,
        workflow,
        source,
        reviewPending,
        repeat,
        candidateCount: searchBudget.candidateCount,
        localizedRewriteBranches: searchBudget.localizedRewriteBranches,
        searchBudgetLevel: searchBudget.searchBudgetLevel,
        searchBudgetDescriptor: searchBudget.searchBudgetDescriptor,
        benchmarkIds: selectedEntries.map((entry) => entry.benchmarkId),
        runCount: runRecords.length,
        succeededRunCount,
        failedRunCount,
        runs: runRecords,
    };
    writeJson(batchManifestPath, batchManifest);

    const payload = {
        ok: failedRunCount === 0,
        batchId,
        lane: STRING_TRIO_SYMBOLIC_LANE,
        benchmarkPackVersion: STRING_TRIO_SYMBOLIC_BENCHMARK_PACK_VERSION,
        reviewRubricVersion: FIXED_APPROVAL_REVIEW_RUBRIC.version,
        workflow,
        source,
        reviewPending,
        repeat,
        runCount: runRecords.length,
        succeededRunCount,
        failedRunCount,
        candidateCount: searchBudget.candidateCount,
        localizedRewriteBranches: searchBudget.localizedRewriteBranches,
        searchBudgetLevel: searchBudget.searchBudgetLevel,
        searchBudgetDescriptor: searchBudget.searchBudgetDescriptor,
        benchmarkIds: selectedEntries.map((entry) => entry.benchmarkId),
        paths: {
            batchRoot: normalizePathLike(batchRoot),
            batchManifestPath: normalizePathLike(batchManifestPath),
        },
        runs: runRecords,
    };

    if (failedRunCount > 0) {
        console.error(JSON.stringify(payload, null, 2));
        process.exit(1);
    }

    console.log(JSON.stringify(payload));
}

await main();