import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT_DIR = process.env.OUTPUT_DIR || "outputs";
const DEFAULT_SNAPSHOT = "current";
const DEFAULT_SURFACE = "ml_manifest_review_sheet";

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
    console.error(JSON.stringify({ ok: false, message, details }, null, 2));
    process.exit(1);
}

function toTrimmed(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function resolvePathLike(filePath) {
    if (!filePath) {
        return "";
    }

    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
}

function parseCsv(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inQuotes) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    currentCell += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                currentCell += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            continue;
        }
        if (char === ",") {
            currentRow.push(currentCell);
            currentCell = "";
            continue;
        }
        if (char === "\n") {
            currentRow.push(currentCell);
            rows.push(currentRow);
            currentRow = [];
            currentCell = "";
            continue;
        }
        if (char === "\r") {
            continue;
        }

        currentCell += char;
    }

    if (currentCell !== "" || currentRow.length > 0) {
        currentRow.push(currentCell);
        rows.push(currentRow);
    }

    if (rows.length === 0) {
        return [];
    }

    const header = rows.shift().map((item, index) => index === 0 ? item.replace(/^\ufeff/, "") : item);
    return rows
        .filter((row) => row.some((item) => toTrimmed(item, "") !== ""))
        .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""])));
}

function loadBatchResults(filePath) {
    const resolvedPath = resolvePathLike(filePath);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        fail("Manifest review sheet file does not exist", {
            resultsFile: resolvedPath || filePath,
        });
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    const text = fs.readFileSync(resolvedPath, "utf8");
    if (extension === ".json") {
        const payload = JSON.parse(text);
        if (Array.isArray(payload)) {
            return payload;
        }
        if (payload && typeof payload === "object" && Array.isArray(payload.results)) {
            return payload.results;
        }
        return payload && typeof payload === "object" ? [payload] : [];
    }
    if (extension === ".jsonl") {
        return text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    if (extension === ".csv") {
        return parseCsv(text);
    }

    fail("Unsupported manifest review sheet extension", {
        resultsFile: resolvedPath,
        supportedExtensions: [".json", ".jsonl", ".csv"],
    });
}

function normalizeApprovalStatus(value) {
    const normalized = toTrimmed(value).toLowerCase();
    if (!normalized) {
        return "";
    }
    if (normalized === "approved" || normalized === "approve") {
        return "approved";
    }
    if (normalized === "rejected" || normalized === "reject") {
        return "rejected";
    }
    return "";
}

function buildReviewSheetPath(outputDir, snapshot, resultsFileOption) {
    const resolvedResultsFile = toTrimmed(resultsFileOption, "") ? resolvePathLike(resultsFileOption) : "";
    if (resolvedResultsFile) {
        return resolvedResultsFile;
    }

    const normalizedSnapshot = toTrimmed(snapshot || DEFAULT_SNAPSHOT);
    return path.join(outputDir, "_system", "ml", "review-manifests", "learned-backbone", normalizedSnapshot, "review-sheet.csv");
}

async function main() {
    const outputDir = path.resolve(readOption("outputDir") || DEFAULT_OUTPUT_DIR);
    const snapshot = toTrimmed(readOption("snapshot") || DEFAULT_SNAPSHOT);
    const resultsFile = buildReviewSheetPath(outputDir, snapshot, readOption("resultsFile") || readOption("sheet"));
    const defaultActor = toTrimmed(readOption("actor"));
    const defaultApprovedBy = toTrimmed(readOption("approvedBy"));
    const surface = toTrimmed(readOption("surface") || DEFAULT_SURFACE);
    const rawEntries = loadBatchResults(resultsFile);
    process.env.OUTPUT_DIR = outputDir;

    const { setLogStream } = await import("../src/logging/logger.ts");
    const { approveAutonomySong, rejectAutonomySong, isAutonomyConflictError } = await import("../src/autonomy/service.ts");
    const { loadManifest, saveManifest } = await import("../src/memory/manifest.ts");
    setLogStream("stderr");

    const decisions = rawEntries
        .map((entry, index) => {
            const approvalStatus = normalizeApprovalStatus(
                entry.approvalStatus ?? entry.nextApprovalStatus ?? entry.decisionStatus,
            );
            return {
                rowIndex: index + 2,
                songId: toTrimmed(entry.songId),
                approvalStatus,
                appealScore: toNumber(entry.appealScore),
                strongestDimension: toTrimmed(entry.strongestDimension) || undefined,
                weakestDimension: toTrimmed(entry.weakestDimension) || undefined,
                comparisonReference: toTrimmed(entry.comparisonReference) || undefined,
                note: toTrimmed(entry.note) || undefined,
                actor: toTrimmed(entry.actor) || defaultActor || undefined,
                approvedBy: toTrimmed(entry.approvedBy) || defaultApprovedBy || undefined,
            };
        })
        .filter((entry) => entry.approvalStatus);

    if (decisions.length === 0) {
        console.log(JSON.stringify({
            ok: true,
            outputDir,
            resultsFile,
            snapshot,
            processedCount: 0,
            approvedCount: 0,
            rejectedCount: 0,
            skippedCount: rawEntries.length,
            songIds: [],
        }, null, 2));
        return;
    }

    const seenSongIds = new Set();
    const validationErrors = [];
    for (const decision of decisions) {
        if (!decision.songId) {
            validationErrors.push({ rowIndex: decision.rowIndex, message: "songId is required" });
            continue;
        }
        if (seenSongIds.has(decision.songId)) {
            validationErrors.push({ rowIndex: decision.rowIndex, songId: decision.songId, message: "duplicate songId in batch" });
            continue;
        }
        seenSongIds.add(decision.songId);

        const manifest = loadManifest(decision.songId, {
            hydrateSectionArtifacts: false,
            hydrateExpressionPlan: false,
        });
        if (!manifest) {
            validationErrors.push({ rowIndex: decision.rowIndex, songId: decision.songId, message: "manifest not found" });
            continue;
        }
        const source = manifest.meta?.source;
        if (source !== "autonomy" && source !== "api") {
            validationErrors.push({
                rowIndex: decision.rowIndex,
                songId: decision.songId,
                message: "unsupported manifest source for learned-backbone review helper",
                source,
            });
            continue;
        }
        if (manifest.approvalStatus !== "pending") {
            validationErrors.push({
                rowIndex: decision.rowIndex,
                songId: decision.songId,
                message: "manifest is not awaiting approval",
                approvalStatus: manifest.approvalStatus,
            });
        }
    }

    if (validationErrors.length > 0) {
        fail("Manifest review sheet validation failed", {
            resultsFile,
            validationErrors,
        });
    }

    const updated = [];
    for (const decision of decisions) {
        const reviewFeedback = {
            reviewRubricVersion: "approval_review_rubric_v1",
            ...(decision.note ? { note: decision.note } : {}),
            ...(decision.appealScore !== undefined ? { appealScore: decision.appealScore } : {}),
            ...(decision.strongestDimension ? { strongestDimension: decision.strongestDimension } : {}),
            ...(decision.weakestDimension ? { weakestDimension: decision.weakestDimension } : {}),
            ...(decision.comparisonReference ? { comparisonReference: decision.comparisonReference } : {}),
        };

        const currentManifest = loadManifest(decision.songId, {
            hydrateSectionArtifacts: false,
            hydrateExpressionPlan: false,
        });
        if (!currentManifest) {
            fail("Manifest disappeared during review update", {
                songId: decision.songId,
            });
        }

        try {
            const manifest = currentManifest.meta?.source === "autonomy"
                ? (decision.approvalStatus === "approved"
                    ? approveAutonomySong(decision.songId, reviewFeedback, {
                        surface,
                        actor: decision.actor,
                        approvedBy: decision.approvedBy,
                    })
                    : rejectAutonomySong(decision.songId, reviewFeedback, {
                        surface,
                        actor: decision.actor,
                        approvedBy: decision.approvedBy,
                    }))
                : (() => {
                    const now = new Date().toISOString();
                    currentManifest.approvalStatus = decision.approvalStatus;
                    currentManifest.updatedAt = now;
                    if (currentManifest.meta) {
                        currentManifest.meta.updatedAt = now;
                    }
                    currentManifest.reviewFeedback = reviewFeedback;
                    if (decision.note) {
                        const prefix = decision.approvalStatus === "approved" ? "Approval note" : "Rejection note";
                        currentManifest.evaluationSummary = [currentManifest.evaluationSummary, `${prefix}: ${decision.note}`]
                            .filter(Boolean)
                            .join("\n\n");
                    }
                    saveManifest(currentManifest);
                    return currentManifest;
                })();
            if (!manifest) {
                fail("Manifest disappeared during review update", {
                    songId: decision.songId,
                });
            }

            updated.push({
                songId: manifest.songId,
                approvalStatus: manifest.approvalStatus,
                reviewFeedback: manifest.reviewFeedback,
                updatePath: currentManifest.meta?.source === "autonomy" ? "autonomy_service" : "direct_manifest_save",
            });
        } catch (error) {
            if (isAutonomyConflictError(error)) {
                fail("Manifest review update conflicted with current runtime state", {
                    songId: decision.songId,
                    error: error.message,
                    ...(error.details ?? {}),
                });
            }
            throw error;
        }
    }

    console.log(JSON.stringify({
        ok: true,
        outputDir,
        resultsFile,
        snapshot,
        surface,
        processedCount: updated.length,
        approvedCount: updated.filter((item) => item.approvalStatus === "approved").length,
        rejectedCount: updated.filter((item) => item.approvalStatus === "rejected").length,
        skippedCount: rawEntries.length - decisions.length,
        songIds: updated.map((item) => item.songId),
        results: updated,
    }, null, 2));
}

await main();