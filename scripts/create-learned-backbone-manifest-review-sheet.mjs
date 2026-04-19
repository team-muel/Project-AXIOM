import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT_DIR = process.env.OUTPUT_DIR || "outputs";
const DEFAULT_BENCHMARK_PACK_VERSION = "string_trio_symbolic_benchmark_pack_v1";
const DEFAULT_LANE = "string_trio_symbolic";
const DEFAULT_SNAPSHOT = "current";

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

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
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

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
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

function resolveJsonPath(filePath) {
    if (!filePath) {
        return undefined;
    }

    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
}

function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function writeCsv(filePath, header, rows) {
    ensureDir(path.dirname(filePath));
    const lines = [header.map(csvEscape).join(",")];
    for (const row of rows) {
        lines.push(header.map((column) => csvEscape(row[column] ?? "")).join(","));
    }
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function matchesBenchmarkEvidence(proposalEvidence, benchmarkPackVersion, lane) {
    if (!proposalEvidence || typeof proposalEvidence !== "object") {
        return false;
    }

    if (benchmarkPackVersion && toTrimmed(proposalEvidence.benchmarkPackVersion) !== benchmarkPackVersion) {
        return false;
    }

    if (lane) {
        const evidenceLane = toTrimmed(proposalEvidence.lane);
        if (evidenceLane && evidenceLane !== lane) {
            return false;
        }
    }

    return Boolean(toTrimmed(proposalEvidence.planSignature) || toTrimmed(proposalEvidence.benchmarkId));
}

function classifyRetryLocalization(directives) {
    const normalized = Array.isArray(directives)
        ? directives.filter((directive) => directive && typeof directive === "object")
        : [];
    if (normalized.length === 0) {
        return "none";
    }

    let targetedCount = 0;
    let globalCount = 0;
    for (const directive of normalized) {
        const sectionIds = Array.isArray(directive.sectionIds)
            ? directive.sectionIds.map((value) => toTrimmed(value)).filter(Boolean)
            : [];
        if (sectionIds.length > 0) {
            targetedCount += 1;
        } else {
            globalCount += 1;
        }
    }

    if (targetedCount > 0 && globalCount === 0) {
        return "section_targeted";
    }
    if (targetedCount > 0 && globalCount > 0) {
        return "mixed";
    }
    return "global";
}

function classifySearchBudget(wholePieceCandidateCount, localizedRewriteBranchCount = 0) {
    if (Math.max(0, Math.floor(toNumber(localizedRewriteBranchCount) ?? 0)) > 0
        && Math.max(0, Math.floor(toNumber(wholePieceCandidateCount) ?? 0)) >= 4) {
        return "S4";
    }

    switch (Math.max(0, Math.floor(toNumber(wholePieceCandidateCount) ?? 0))) {
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

function describeSearchBudget(searchBudgetLevel, wholePieceCandidateCount, localizedRewriteBranchCount = 0) {
    const normalizedWholePieceCount = Math.max(0, Math.floor(toNumber(wholePieceCandidateCount) ?? 0));
    const normalizedBranchCount = Math.max(0, Math.floor(toNumber(localizedRewriteBranchCount) ?? 0));
    if (searchBudgetLevel !== "custom") {
        return searchBudgetLevel;
    }
    if (normalizedBranchCount > 0) {
        return `custom(${normalizedWholePieceCount}+${normalizedBranchCount})`;
    }
    return `custom(${normalizedWholePieceCount})`;
}

function classifySameAttemptSearchBudgetCounts(entries, candidateManifests) {
    const wholePieceEntries = entries.filter((entry) => {
        const manifest = candidateManifests.get(entry.candidateId);
        return (Array.isArray(manifest?.revisionDirectives) ? manifest.revisionDirectives.length : 0) === 0;
    });
    const localizedRewriteBranchCount = wholePieceEntries.length > 0
        ? entries.length - wholePieceEntries.length
        : 0;

    return {
        wholePieceCandidateCount: wholePieceEntries.length > 0 ? wholePieceEntries.length : entries.length,
        localizedRewriteBranchCount,
    };
}

function resolveShortlistContext(entries, selectedCandidateId) {
    const rankedEntries = (Array.isArray(entries) ? entries : [])
        .map((entry) => {
            const learnedRank = toNumber(entry?.shadowReranker?.learnedRank);
            const heuristicRank = toNumber(entry?.shadowReranker?.heuristicRank);
            if (!Number.isFinite(learnedRank)) {
                return null;
            }

            return {
                candidateId: toTrimmed(entry?.candidateId),
                learnedRank,
                heuristicRank: Number.isFinite(heuristicRank) ? heuristicRank : null,
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.learnedRank - right.learnedRank || ((left.heuristicRank ?? Number.MAX_SAFE_INTEGER) - (right.heuristicRank ?? Number.MAX_SAFE_INTEGER)) || left.candidateId.localeCompare(right.candidateId));
    if (rankedEntries.length === 0) {
        return null;
    }

    const topK = Math.min(3, rankedEntries.length);
    const orderedCandidateIds = rankedEntries.map((entry) => entry.candidateId);
    const selectedRankIndex = toTrimmed(selectedCandidateId)
        ? orderedCandidateIds.findIndex((candidateId) => candidateId === toTrimmed(selectedCandidateId))
        : -1;

    return {
        topK,
        selectedRank: selectedRankIndex >= 0 ? selectedRankIndex + 1 : null,
        selectedInShortlist: selectedRankIndex >= 0 && selectedRankIndex < topK,
    };
}

function buildRunRow(songDir, manifest, candidateIndex, options) {
    const entries = Array.isArray(candidateIndex?.entries)
        ? candidateIndex.entries.filter((entry) => entry && typeof entry === "object")
        : [];
    const selectedEntry = entries.find((entry) => entry.selected) || entries.find((entry) => entry.candidateId === candidateIndex?.selectedCandidateId) || null;
    const benchmarkEntries = entries.filter((entry) => matchesBenchmarkEvidence(entry.proposalEvidence, options.benchmarkPackVersion, options.lane));
    const manifestProposalEvidence = manifest?.proposalEvidence;
    const manifestMatches = matchesBenchmarkEvidence(manifestProposalEvidence, options.benchmarkPackVersion, options.lane);
    const selectedMatches = matchesBenchmarkEvidence(selectedEntry?.proposalEvidence, options.benchmarkPackVersion, options.lane);

    if (!manifestMatches && benchmarkEntries.length === 0 && !selectedMatches) {
        return null;
    }

    const benchmarkEvidence = selectedMatches
        ? selectedEntry.proposalEvidence
        : benchmarkEntries[0]?.proposalEvidence || manifestProposalEvidence;
    const candidateManifests = new Map(
        entries.map((entry) => [
            entry?.candidateId,
            entry?.manifestPath ? readJsonIfExists(resolveJsonPath(entry.manifestPath)) : null,
        ]),
    );
    const selectedCandidateManifest = selectedEntry?.candidateId
        ? candidateManifests.get(selectedEntry.candidateId) || null
        : null;
    const selectedAttempt = [
        candidateIndex?.selectedAttempt,
        selectedEntry?.attempt,
        selectedCandidateManifest?.attempt,
        manifest?.qualityControl?.selectedAttempt,
    ].find((value) => typeof value === "number" && Number.isFinite(value)) ?? null;
    const selectedAttemptEntries = selectedAttempt === null
        ? entries
        : entries.filter((entry) => {
            const attempt = typeof entry?.attempt === "number" && Number.isFinite(entry.attempt)
                ? entry.attempt
                : typeof selectedCandidateManifest?.attempt === "number" && Number.isFinite(selectedCandidateManifest.attempt) && entry?.candidateId === selectedEntry?.candidateId
                    ? selectedCandidateManifest.attempt
                    : null;
            return attempt === selectedAttempt;
        });
    const activeAttemptEntries = selectedAttemptEntries.length > 0 ? selectedAttemptEntries : entries;
    const pairedWorkers = new Set(activeAttemptEntries.map((entry) => toTrimmed(entry.worker)).filter(Boolean));
    const pairedRun = pairedWorkers.has("learned_symbolic") && pairedWorkers.has("music21");
    const candidateWorkers = [...pairedWorkers].sort((left, right) => left.localeCompare(right));
    const selectedWorker = toTrimmed(selectedEntry?.worker)
        || toTrimmed(selectedCandidateManifest?.worker)
        || toTrimmed(manifestProposalEvidence?.worker)
        || "unknown";
    const counterfactualWorker = pairedRun
        ? candidateWorkers.find((worker) => worker !== selectedWorker) || ""
        : "";
    const promotionApplied = Boolean(candidateIndex?.rerankerPromotion);
    const selectionMode = !pairedRun
        ? "single_worker"
        : selectedWorker === "learned_symbolic"
            ? (promotionApplied ? "promoted_learned" : "learned_selected")
            : "baseline_selected";
    const shortlist = resolveShortlistContext(entries, candidateIndex?.selectedCandidateId || selectedEntry?.candidateId);
    const { wholePieceCandidateCount, localizedRewriteBranchCount } = classifySameAttemptSearchBudgetCounts(
        activeAttemptEntries,
        candidateManifests,
    );
    const searchBudgetLevel = classifySearchBudget(wholePieceCandidateCount, localizedRewriteBranchCount);
    const searchBudgetDescriptor = describeSearchBudget(searchBudgetLevel, wholePieceCandidateCount, localizedRewriteBranchCount);

    return {
        songId: toTrimmed(manifest?.songId) || path.basename(songDir),
        benchmarkPackVersion: toTrimmed(benchmarkEvidence?.benchmarkPackVersion) || options.benchmarkPackVersion,
        benchmarkId: toTrimmed(benchmarkEvidence?.benchmarkId) || "",
        planSignature: toTrimmed(benchmarkEvidence?.planSignature) || "",
        selectedWorker,
        counterfactualWorker,
        selectionMode,
        observedAt: toTrimmed(selectedEntry?.evaluatedAt)
            || toTrimmed(selectedCandidateManifest?.evaluatedAt)
            || toTrimmed(manifest?.updatedAt)
            || toTrimmed(manifest?.meta?.updatedAt)
            || new Date(0).toISOString(),
        approvalStatus: toTrimmed(manifest?.approvalStatus, "not_reviewed"),
        retryLocalization: classifyRetryLocalization(selectedCandidateManifest?.revisionDirectives),
        wholePieceCandidateCount,
        localizedRewriteBranchCount,
        searchBudgetLevel,
        searchBudgetDescriptor,
        shortlistTopK: shortlist?.topK ?? "",
        selectedRank: shortlist?.selectedRank ?? "",
        selectedInShortlist: shortlist?.selectedInShortlist === true ? "yes" : "no",
    };
}

function collectRows(outputDir, options) {
    if (!fs.existsSync(outputDir)) {
        fail("Output directory does not exist", { outputDir });
    }

    const rows = [];
    for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === "_system") {
            continue;
        }

        const songDir = path.join(outputDir, entry.name);
        const manifest = readJsonIfExists(path.join(songDir, "manifest.json"));
        const candidateIndex = readJsonIfExists(path.join(songDir, "candidates", "index.json"));
        if (!manifest || !candidateIndex) {
            continue;
        }

        const row = buildRunRow(songDir, manifest, candidateIndex, options);
        if (row) {
            rows.push(row);
        }
    }

    return rows;
}

function main() {
    const outputDir = path.resolve(readOption("outputDir") || DEFAULT_OUTPUT_DIR);
    const lane = toTrimmed(readOption("lane") || DEFAULT_LANE);
    const benchmarkPackVersion = toTrimmed(readOption("benchmarkPackVersion") || DEFAULT_BENCHMARK_PACK_VERSION);
    const snapshot = toTrimmed(readOption("snapshot") || DEFAULT_SNAPSHOT);
    const includeReviewed = hasFlag("includeReviewed");
    const reviewRoot = path.join(outputDir, "_system", "ml", "review-manifests", "learned-backbone", snapshot);
    const sheetPath = path.join(reviewRoot, "review-sheet.csv");

    const rows = collectRows(outputDir, { lane, benchmarkPackVersion })
        .filter((row) => includeReviewed || row.approvalStatus === "pending")
        .sort((left, right) => left.benchmarkId.localeCompare(right.benchmarkId)
            || right.observedAt.localeCompare(left.observedAt)
            || left.songId.localeCompare(right.songId));

    const header = [
        "songId",
        "benchmarkPackVersion",
        "benchmarkId",
        "planSignature",
        "selectedWorker",
        "counterfactualWorker",
        "selectionMode",
        "searchBudgetLevel",
        "searchBudgetDescriptor",
        "wholePieceCandidateCount",
        "localizedRewriteBranchCount",
        "retryLocalization",
        "selectedInShortlist",
        "shortlistTopK",
        "selectedRank",
        "observedAt",
        "currentApprovalStatus",
        "approvalStatus",
        "appealScore",
        "strongestDimension",
        "weakestDimension",
        "comparisonReference",
        "note",
        "actor",
        "approvedBy",
    ];

    writeCsv(sheetPath, header, rows.map((row) => ({
        songId: row.songId,
        benchmarkPackVersion: row.benchmarkPackVersion,
        benchmarkId: row.benchmarkId,
        planSignature: row.planSignature,
        selectedWorker: row.selectedWorker,
        counterfactualWorker: row.counterfactualWorker,
        selectionMode: row.selectionMode,
        searchBudgetLevel: row.searchBudgetLevel,
        searchBudgetDescriptor: row.searchBudgetDescriptor,
        wholePieceCandidateCount: row.wholePieceCandidateCount,
        localizedRewriteBranchCount: row.localizedRewriteBranchCount,
        retryLocalization: row.retryLocalization,
        selectedInShortlist: row.selectedInShortlist,
        shortlistTopK: row.shortlistTopK,
        selectedRank: row.selectedRank,
        observedAt: row.observedAt,
        currentApprovalStatus: row.approvalStatus,
        approvalStatus: "",
        appealScore: "",
        strongestDimension: "",
        weakestDimension: "",
        comparisonReference: "",
        note: "",
        actor: "",
        approvedBy: "",
    })));

    const payload = {
        ok: true,
        outputDir,
        lane,
        benchmarkPackVersion,
        snapshot,
        includeReviewed,
        rowCount: rows.length,
        benchmarkIds: [...new Set(rows.map((row) => row.benchmarkId).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
        songIds: rows.map((row) => row.songId),
        paths: {
            sheetPath,
        },
    };

    console.log(JSON.stringify(payload, null, 2));
}

main();