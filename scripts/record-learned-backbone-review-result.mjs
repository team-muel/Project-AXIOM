import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT_DIR = process.env.OUTPUT_DIR || "outputs";

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

function readJsonIfExists(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return null;
    }
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildBlindReviewRoot(outputDir) {
    return path.join(outputDir, "_system", "ml", "review-packs", "learned-backbone");
}

function normalizeWinnerLabel(value) {
    const normalized = toTrimmed(value).toUpperCase();
    if (!normalized) {
        return "";
    }

    if (normalized === "TIE" || normalized === "SKIP") {
        return normalized;
    }

    return /^[A-Z]$/.test(normalized)
        ? normalized
        : "";
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
        fail("Blind review results file does not exist", {
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

    fail("Unsupported blind review results file extension", {
        resultsFile: resolvedPath,
        supportedExtensions: [".json", ".jsonl", ".csv"],
    });
}

function buildPackContext({ outputDir, snapshot, packDirOption, resultsFileOption }) {
    const resolvedResultsFile = toTrimmed(resultsFileOption, "") ? resolvePathLike(resultsFileOption) : "";
    let packDir = toTrimmed(packDirOption, "")
        ? path.resolve(process.cwd(), packDirOption)
        : "";

    if (!packDir && snapshot) {
        packDir = path.join(buildBlindReviewRoot(outputDir), snapshot);
    }

    if (!packDir && resolvedResultsFile) {
        const candidateDir = path.dirname(resolvedResultsFile);
        if (fs.existsSync(path.join(candidateDir, "answer-key.json"))) {
            packDir = candidateDir;
        }
    }

    if (!packDir) {
        fail("Blind review pack snapshot or directory is required", {
            requiredOneOf: ["snapshot", "packDir"],
        });
    }

    if (!fs.existsSync(packDir)) {
        fail("Blind review pack directory does not exist", {
            packDir,
            snapshot,
        });
    }

    const answerKeyPath = path.join(packDir, "answer-key.json");
    const resultsPath = path.join(packDir, "results.json");
    const answerKey = readJsonIfExists(answerKeyPath);
    if (!answerKey || typeof answerKey !== "object" || Array.isArray(answerKey)) {
        fail("Blind review answer key is missing or invalid", {
            answerKeyPath,
        });
    }

    const existingResults = readJsonIfExists(resultsPath);
    const packId = toTrimmed(answerKey.packId) || toTrimmed(existingResults?.packId) || path.basename(packDir);
    const resultsPayload = existingResults && typeof existingResults === "object" && !Array.isArray(existingResults)
        ? { ...existingResults }
        : {
            version: 1,
            type: "learned_backbone_blind_review_results",
            packId,
            generatedAt: new Date().toISOString(),
            lane: toTrimmed(answerKey.lane),
            benchmarkPackVersion: toTrimmed(answerKey.benchmarkPackVersion),
            results: [],
        };

    return {
        packDir,
        answerKeyPath,
        resultsPath,
        answerKey,
        resultsPayload,
        packId,
        resolvedResultsFile,
    };
}

function recordBlindReviewDecision({ currentResults, answerKey, entryId, winnerLabel, reviewedAt, reviewerId, notes }) {
    const answerEntry = (Array.isArray(answerKey.entries) ? answerKey.entries : [])
        .find((item) => toTrimmed(item?.entryId) === entryId);
    if (!answerEntry) {
        fail("Blind review pack entry does not exist", {
            entryId,
        });
    }

    const learnedLabel = toTrimmed(answerEntry?.learned?.label).toUpperCase();
    const baselineLabel = toTrimmed(answerEntry?.baseline?.label).toUpperCase();
    const supportedWinnerLabels = [learnedLabel, baselineLabel, "TIE", "SKIP"].filter(Boolean);
    if (!supportedWinnerLabels.includes(winnerLabel)) {
        fail("Winner label is not valid for this entry", {
            entryId,
            winnerLabel,
            supportedWinnerLabels,
        });
    }

    const existingIndex = currentResults.findIndex((item) => toTrimmed(item?.entryId) === entryId);
    const recordedResult = {
        ...(existingIndex >= 0 && currentResults[existingIndex] && typeof currentResults[existingIndex] === "object" && !Array.isArray(currentResults[existingIndex])
            ? currentResults[existingIndex]
            : {}),
        entryId,
        winnerLabel,
        reviewedAt,
        ...(reviewerId ? { reviewerId } : {}),
        ...(notes ? { notes } : {}),
    };

    if (existingIndex >= 0) {
        currentResults[existingIndex] = recordedResult;
    } else {
        currentResults.push(recordedResult);
    }

    return {
        replacedExisting: existingIndex >= 0,
        recordedResult,
        reviewEntry: {
            songId: toTrimmed(answerEntry.songId, "") || null,
            benchmarkId: toTrimmed(answerEntry.benchmarkId, "") || null,
            reviewTarget: toTrimmed(answerEntry.reviewTarget, "") || null,
            learnedLabel,
            baselineLabel,
        },
    };
}

function main() {
    const outputDir = path.resolve(process.cwd(), readOption("outputDir") || DEFAULT_OUTPUT_DIR);
    const snapshot = toTrimmed(readOption("snapshot") || readOption("pack"), "");
    const packDirOption = toTrimmed(readOption("packDir"), "");
    const resultsFileOption = toTrimmed(readOption("resultsFile") || readOption("sheet"), "");
    const entryId = toTrimmed(readOption("entryId"), "");
    const winnerLabel = normalizeWinnerLabel(readOption("winnerLabel") || readOption("winner") || readOption("decision"));
    const defaultReviewedAt = toTrimmed(readOption("reviewedAt"), "") || new Date().toISOString();
    const defaultReviewerId = toTrimmed(readOption("reviewerId"), "") || null;
    const defaultNotes = toTrimmed(readOption("notes"), "") || null;

    const {
        packDir,
        answerKeyPath,
        resultsPath,
        answerKey,
        resultsPayload,
        packId,
        resolvedResultsFile,
    } = buildPackContext({
        outputDir,
        snapshot,
        packDirOption,
        resultsFileOption,
    });

    const currentResults = Array.isArray(resultsPayload.results)
        ? [...resultsPayload.results]
        : [];

    let processedEntries = [];
    let skippedBlankDecisionCount = 0;

    if (resolvedResultsFile) {
        const rawEntries = loadBatchResults(resolvedResultsFile);
        for (const [index, rawEntry] of rawEntries.entries()) {
            const normalizedEntryId = toTrimmed(rawEntry?.entryId, "");
            const decisionText = rawEntry?.winnerLabel ?? rawEntry?.winner ?? rawEntry?.decision;
            const normalizedWinnerLabel = normalizeWinnerLabel(decisionText);
            const hasAnyContent = rawEntry && typeof rawEntry === "object"
                ? Object.values(rawEntry).some((value) => toTrimmed(value, "") !== "")
                : false;
            if (!hasAnyContent) {
                continue;
            }
            if (!normalizedEntryId) {
                fail("Blind review results file row is missing entryId", {
                    resultsFile: resolvedResultsFile,
                    rowIndex: index + 2,
                });
            }
            if (!toTrimmed(decisionText, "")) {
                skippedBlankDecisionCount += 1;
                continue;
            }
            if (!normalizedWinnerLabel) {
                fail("Blind review results file row has invalid winner label", {
                    resultsFile: resolvedResultsFile,
                    rowIndex: index + 2,
                    entryId: normalizedEntryId,
                    winnerLabel: decisionText,
                    supported: ["A", "B", "TIE", "SKIP"],
                });
            }

            processedEntries.push({
                entryId: normalizedEntryId,
                winnerLabel: normalizedWinnerLabel,
                reviewedAt: toTrimmed(rawEntry?.reviewedAt, "") || defaultReviewedAt,
                reviewerId: toTrimmed(rawEntry?.reviewerId, "") || defaultReviewerId,
                notes: toTrimmed(rawEntry?.notes, "") || defaultNotes,
            });
        }

        if (processedEntries.length === 0) {
            fail("Blind review results file does not contain any completed decisions", {
                resultsFile: resolvedResultsFile,
                skippedBlankDecisionCount,
            });
        }
    } else {
        if (!entryId) {
            fail("Blind review entry id is required", {
                required: ["entryId"],
            });
        }

        if (!winnerLabel) {
            fail("Winner label is required", {
                required: ["winnerLabel"],
                supported: ["A", "B", "TIE", "SKIP"],
            });
        }

        processedEntries = [{
            entryId,
            winnerLabel,
            reviewedAt: defaultReviewedAt,
            reviewerId: defaultReviewerId,
            notes: defaultNotes,
        }];
    }

    const recordedEntries = [];
    let replacedExistingCount = 0;
    for (const item of processedEntries) {
        const recorded = recordBlindReviewDecision({
            currentResults,
            answerKey,
            entryId: item.entryId,
            winnerLabel: item.winnerLabel,
            reviewedAt: item.reviewedAt,
            reviewerId: item.reviewerId,
            notes: item.notes,
        });
        if (recorded.replacedExisting) {
            replacedExistingCount += 1;
        }
        recordedEntries.push({
            entryId: item.entryId,
            replacedExisting: recorded.replacedExisting,
            recordedResult: recorded.recordedResult,
            reviewEntry: recorded.reviewEntry,
        });
    }

    resultsPayload.packId = packId;
    resultsPayload.lane = toTrimmed(resultsPayload.lane) || toTrimmed(answerKey.lane);
    resultsPayload.benchmarkPackVersion = toTrimmed(resultsPayload.benchmarkPackVersion) || toTrimmed(answerKey.benchmarkPackVersion);
    resultsPayload.results = currentResults;
    writeJson(resultsPath, resultsPayload);

    const singleRecordedEntry = recordedEntries[0] ?? null;
    console.log(JSON.stringify({
        ok: true,
        packId,
        entryId: singleRecordedEntry?.entryId ?? null,
        replacedExisting: singleRecordedEntry?.replacedExisting ?? false,
        replacedExistingCount,
        processedCount: recordedEntries.length,
        skippedBlankDecisionCount,
        resultCount: currentResults.length,
        recordedResult: singleRecordedEntry?.recordedResult ?? null,
        reviewEntry: singleRecordedEntry?.reviewEntry ?? null,
        recordedEntries,
        paths: {
            packDir,
            answerKeyPath,
            resultsPath,
            ...(resolvedResultsFile ? { resultsFile: resolvedResultsFile } : {}),
        },
    }, null, 2));
}

main();