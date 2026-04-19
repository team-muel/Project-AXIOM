import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT_DIR = process.env.OUTPUT_DIR || "outputs";
const DEFAULT_BENCHMARK_PACK_VERSION = "string_trio_symbolic_benchmark_pack_v1";
const DEFAULT_LANE = "string_trio_symbolic";
const DEFAULT_LABEL_SEED = "learned_backbone_blind_review_v1";
const DEFAULT_REVIEW_TARGET = "all";

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

function readBooleanOption(name, fallback = false) {
    const explicit = readOption(name);
    if (typeof explicit === "string") {
        const normalized = explicit.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) {
            return true;
        }
        if (["0", "false", "no", "off"].includes(normalized)) {
            return false;
        }
    }

    return process.argv.includes(`--${name}`) ? true : fallback;
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

function resolvePathLike(filePath) {
    if (!filePath) {
        return null;
    }

    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, value, "utf8");
}

function normalizeRelative(filePath, rootDir) {
    return path.relative(rootDir, filePath).replace(/\\/g, "/");
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

function classifySameAttemptSearchBudgetCounts(entries, candidateManifestById) {
    const wholePieceEntries = entries.filter((entry) => {
        const manifest = candidateManifestById.get(toTrimmed(entry?.candidateId)) || null;
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

function matchesSearchBudgetFilter(searchBudgetFilter, pair) {
    const normalizedFilter = toTrimmed(searchBudgetFilter).toLowerCase();
    if (!normalizedFilter) {
        return true;
    }

    return normalizedFilter === toTrimmed(pair?.searchBudgetLevel).toLowerCase()
        || normalizedFilter === toTrimmed(pair?.searchBudgetDescriptor).toLowerCase();
}

function escapeCsvValue(value) {
    const text = String(value ?? "");
    if (!/[",\r\n]/.test(text)) {
        return text;
    }

    return `"${text.replace(/"/g, '""')}"`;
}

function buildReviewSheetCsv(rows) {
    const headers = [
        "entryId",
        "songId",
        "benchmarkId",
        "reviewTarget",
        "winnerLabel",
        "reviewedAt",
        "reviewerId",
        "notes",
        "allowedWinnerLabels",
        "midiAPath",
        "midiBPath",
    ];

    const lines = [headers.join(",")];
    for (const row of rows) {
        lines.push(headers.map((key) => escapeCsvValue(row?.[key] ?? "")).join(","));
    }

    return `${lines.join("\n")}\n`;
}

function matchesBenchmarkEvidence(proposalEvidence, benchmarkPackVersion, lane) {
    if (!proposalEvidence || typeof proposalEvidence !== "object" || Array.isArray(proposalEvidence)) {
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

function resolveCandidateManifest(entry) {
    return entry?.manifestPath
        ? readJsonIfExists(resolvePathLike(entry.manifestPath))
        : null;
}

function resolveCandidateMidiPath(songDir, entry, candidateManifest) {
    const manifestMidi = resolvePathLike(candidateManifest?.artifacts?.midi);
    if (manifestMidi && fs.existsSync(manifestMidi)) {
        return manifestMidi;
    }

    const entryMidi = resolvePathLike(entry?.midiPath);
    if (entryMidi && fs.existsSync(entryMidi)) {
        return entryMidi;
    }

    const candidateId = toTrimmed(entry?.candidateId);
    if (!candidateId) {
        return null;
    }

    const defaultMidi = path.join(songDir, "candidates", candidateId, "composition.mid");
    return fs.existsSync(defaultMidi) ? defaultMidi : null;
}

function buildPairId(record) {
    return createHash("sha1")
        .update(JSON.stringify([
            record.songId,
            record.benchmarkPackVersion,
            record.benchmarkId,
            record.planSignature,
            record.baseline.candidateId,
            record.learned.candidateId,
        ]))
        .digest("hex")
        .slice(0, 16);
}

function resolveShadowRerankerShortlist(candidateIndex) {
    const rankedEntries = (Array.isArray(candidateIndex?.entries) ? candidateIndex.entries : [])
        .map((entry) => {
            const learnedRank = typeof entry?.shadowReranker?.learnedRank === "number"
                && Number.isFinite(entry.shadowReranker.learnedRank)
                ? entry.shadowReranker.learnedRank
                : null;
            const heuristicRank = typeof entry?.shadowReranker?.heuristicRank === "number"
                && Number.isFinite(entry.shadowReranker.heuristicRank)
                ? entry.shadowReranker.heuristicRank
                : null;
            if (learnedRank === null) {
                return null;
            }

            return {
                candidateId: toTrimmed(entry?.candidateId),
                learnedRank,
                heuristicRank,
            };
        })
        .filter(Boolean)
        .sort((left, right) => {
            const learnedDelta = left.learnedRank - right.learnedRank;
            if (Math.abs(learnedDelta) > 0.0001) {
                return learnedDelta;
            }

            const heuristicDelta = (left.heuristicRank ?? Number.MAX_SAFE_INTEGER)
                - (right.heuristicRank ?? Number.MAX_SAFE_INTEGER);
            if (Math.abs(heuristicDelta) > 0.0001) {
                return heuristicDelta;
            }

            return left.candidateId.localeCompare(right.candidateId);
        });

    if (rankedEntries.length === 0) {
        return null;
    }

    const topK = Math.min(3, rankedEntries.length);
    const orderedCandidateIds = rankedEntries.map((entry) => entry.candidateId);
    const selectedCandidateId = toTrimmed(candidateIndex?.selectedCandidateId, "") || null;
    const selectedRankIndex = selectedCandidateId
        ? orderedCandidateIds.findIndex((candidateId) => candidateId === selectedCandidateId)
        : -1;

    return {
        topK,
        selectedRank: selectedRankIndex >= 0 ? selectedRankIndex + 1 : null,
        selectedInShortlist: selectedRankIndex >= 0 && selectedRankIndex < topK,
    };
}

function buildBlindReviewRoot(outputDir) {
    return path.join(outputDir, "_system", "ml", "review-packs", "learned-backbone");
}

function collectReviewedSongIds(outputDir, benchmarkPackVersion, lane) {
    const rootDir = buildBlindReviewRoot(outputDir);
    if (!fs.existsSync(rootDir)) {
        return new Set();
    }

    const reviewedSongIds = new Set();
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const packDir = path.join(rootDir, entry.name);
        const answerKey = readJsonIfExists(path.join(packDir, "answer-key.json"));
        const resultsFile = readJsonIfExists(path.join(packDir, "results.json"));
        const answerLane = toTrimmed(answerKey?.lane) || toTrimmed(resultsFile?.lane);
        const answerBenchmarkPackVersion = toTrimmed(answerKey?.benchmarkPackVersion) || toTrimmed(resultsFile?.benchmarkPackVersion);
        if (benchmarkPackVersion && answerBenchmarkPackVersion && answerBenchmarkPackVersion !== benchmarkPackVersion) {
            continue;
        }
        if (lane && answerLane && answerLane !== lane) {
            continue;
        }

        const answerEntries = new Map(
            (Array.isArray(answerKey?.entries) ? answerKey.entries : [])
                .map((item) => [toTrimmed(item?.entryId), toTrimmed(item?.songId, "") || null]),
        );
        for (const result of Array.isArray(resultsFile?.results) ? resultsFile.results : []) {
            const entryId = toTrimmed(result?.entryId);
            const winnerLabel = toTrimmed(result?.winnerLabel);
            if (!entryId || !winnerLabel || winnerLabel === "SKIP") {
                continue;
            }
            const songId = answerEntries.get(entryId);
            if (songId) {
                reviewedSongIds.add(songId);
            }
        }
    }

    return reviewedSongIds;
}

function collectPendingPackedSongIds(outputDir, benchmarkPackVersion, lane) {
    const rootDir = buildBlindReviewRoot(outputDir);
    if (!fs.existsSync(rootDir)) {
        return new Set();
    }

    const pendingPackedSongIds = new Set();
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const packDir = path.join(rootDir, entry.name);
        const answerKey = readJsonIfExists(path.join(packDir, "answer-key.json"));
        const resultsFile = readJsonIfExists(path.join(packDir, "results.json"));
        const answerLane = toTrimmed(answerKey?.lane) || toTrimmed(resultsFile?.lane);
        const answerBenchmarkPackVersion = toTrimmed(answerKey?.benchmarkPackVersion) || toTrimmed(resultsFile?.benchmarkPackVersion);
        if (benchmarkPackVersion && answerBenchmarkPackVersion && answerBenchmarkPackVersion !== benchmarkPackVersion) {
            continue;
        }
        if (lane && answerLane && answerLane !== lane) {
            continue;
        }

        const completedEntryIds = new Set(
            (Array.isArray(resultsFile?.results) ? resultsFile.results : [])
                .map((item) => toTrimmed(item?.entryId))
                .filter(Boolean),
        );
        for (const item of Array.isArray(answerKey?.entries) ? answerKey.entries : []) {
            const entryId = toTrimmed(item?.entryId);
            const songId = toTrimmed(item?.songId, "") || null;
            if (!entryId || !songId || completedEntryIds.has(entryId)) {
                continue;
            }
            pendingPackedSongIds.add(songId);
        }
    }

    return pendingPackedSongIds;
}

function chooseLabels(pairId, seed) {
    const firstNibble = createHash("sha1")
        .update(`${seed}|${pairId}`)
        .digest("hex")
        .slice(0, 1);
    const learnedFirst = parseInt(firstNibble, 16) % 2 === 0;
    return learnedFirst
        ? { learned: "A", baseline: "B" }
        : { learned: "B", baseline: "A" };
}

function buildBenchmarkPair(songDir, manifest, candidateIndex, options) {
    const entries = Array.isArray(candidateIndex?.entries)
        ? candidateIndex.entries.filter((entry) => entry && typeof entry === "object")
        : [];
    const candidateManifestById = new Map(
        entries.map((entry) => [
            toTrimmed(entry?.candidateId),
            resolveCandidateManifest(entry),
        ]),
    );
    const learnedEntry = entries.find(
        (entry) => toTrimmed(entry.worker) === "learned_symbolic"
            && matchesBenchmarkEvidence(entry.proposalEvidence, options.benchmarkPackVersion, options.lane),
    ) || null;
    const baselineEntry = entries.find((entry) => toTrimmed(entry.worker) === "music21") || null;
    if (!learnedEntry || !baselineEntry) {
        return null;
    }

    const learnedManifest = candidateManifestById.get(toTrimmed(learnedEntry.candidateId)) || null;
    const baselineManifest = candidateManifestById.get(toTrimmed(baselineEntry.candidateId)) || null;
    const benchmarkEvidence = learnedEntry.proposalEvidence
        || learnedManifest?.proposalEvidence
        || manifest?.proposalEvidence
        || null;
    if (!matchesBenchmarkEvidence(benchmarkEvidence, options.benchmarkPackVersion, options.lane)) {
        return null;
    }

    const learnedMidiPath = resolveCandidateMidiPath(songDir, learnedEntry, learnedManifest);
    const baselineMidiPath = resolveCandidateMidiPath(songDir, baselineEntry, baselineManifest);
    if (!learnedMidiPath || !baselineMidiPath) {
        return {
            skipped: true,
            reason: "missing_midi_artifact",
            songId: toTrimmed(manifest?.songId) || path.basename(songDir),
        };
    }

    const selectedEntry = entries.find((entry) => entry.selected)
        || entries.find((entry) => entry.candidateId === candidateIndex?.selectedCandidateId)
        || null;
    const selectedWorker = toTrimmed(selectedEntry?.worker)
        || toTrimmed(candidateIndex?.selectedWorker)
        || "unknown";
    const promotionApplied = Boolean(candidateIndex?.rerankerPromotion);
    const selectionMode = selectedWorker === "learned_symbolic"
        ? (promotionApplied ? "promoted_learned" : "learned_selected")
        : "baseline_selected";
    const selectedCandidateManifest = toTrimmed(selectedEntry?.candidateId)
        ? candidateManifestById.get(toTrimmed(selectedEntry.candidateId)) || null
        : null;
    const selectedAttempt = [
        toNumber(candidateIndex?.selectedAttempt),
        toNumber(selectedEntry?.attempt),
        toNumber(selectedCandidateManifest?.attempt),
    ].find((value) => typeof value === "number" && Number.isFinite(value)) ?? null;
    const selectedAttemptEntries = selectedAttempt === null
        ? entries
        : entries.filter((entry) => {
            const candidateManifest = candidateManifestById.get(toTrimmed(entry?.candidateId)) || null;
            const attempt = typeof entry?.attempt === "number" && Number.isFinite(entry.attempt)
                ? entry.attempt
                : typeof candidateManifest?.attempt === "number" && Number.isFinite(candidateManifest.attempt)
                    ? candidateManifest.attempt
                    : null;
            return attempt === selectedAttempt;
        });
    const activeAttemptEntries = selectedAttemptEntries.length > 0 ? selectedAttemptEntries : entries;
    const { wholePieceCandidateCount, localizedRewriteBranchCount } = classifySameAttemptSearchBudgetCounts(
        activeAttemptEntries,
        candidateManifestById,
    );
    const searchBudgetLevel = classifySearchBudget(wholePieceCandidateCount, localizedRewriteBranchCount);
    const searchBudgetDescriptor = describeSearchBudget(
        searchBudgetLevel,
        wholePieceCandidateCount,
        localizedRewriteBranchCount,
    );
    const shortlist = resolveShadowRerankerShortlist(candidateIndex);

    return {
        skipped: false,
        songId: toTrimmed(manifest?.songId) || path.basename(songDir),
        benchmarkPackVersion: toTrimmed(benchmarkEvidence?.benchmarkPackVersion) || options.benchmarkPackVersion,
        lane: toTrimmed(benchmarkEvidence?.lane) || options.lane,
        benchmarkId: toTrimmed(benchmarkEvidence?.benchmarkId) || null,
        planSignature: toTrimmed(benchmarkEvidence?.planSignature) || null,
        promptPackVersion: toTrimmed(benchmarkEvidence?.promptPackVersion) || null,
        reviewRubricVersion: toTrimmed(manifest?.reviewFeedback?.reviewRubricVersion)
            || toTrimmed(manifest?.reviewFeedback?.reviewRubric)
            || null,
        observedAt: toTrimmed(selectedEntry?.evaluatedAt)
            || toTrimmed(learnedManifest?.evaluatedAt)
            || toTrimmed(manifest?.updatedAt)
            || new Date(0).toISOString(),
        selectedWorker,
        selectionMode,
        reviewTarget: shortlist?.selectedInShortlist ? "shortlist" : "pairwise",
        shortlistTopK: shortlist?.topK ?? null,
        selectedRank: shortlist?.selectedRank ?? null,
        selectedInShortlist: shortlist?.selectedInShortlist === true,
        wholePieceCandidateCount,
        localizedRewriteBranchCount,
        searchBudgetLevel,
        searchBudgetDescriptor,
        baseline: {
            candidateId: toTrimmed(baselineEntry.candidateId),
            worker: "music21",
            manifestPath: resolvePathLike(baselineEntry.manifestPath),
            midiPath: baselineMidiPath,
        },
        learned: {
            candidateId: toTrimmed(learnedEntry.candidateId),
            worker: "learned_symbolic",
            manifestPath: resolvePathLike(learnedEntry.manifestPath),
            midiPath: learnedMidiPath,
        },
    };
}

function buildReviewPackRoot(outputDir, snapshot) {
    return path.join(outputDir, "_system", "ml", "review-packs", "learned-backbone", snapshot);
}

function main() {
    const outputDir = path.resolve(process.cwd(), readOption("outputDir") || DEFAULT_OUTPUT_DIR);
    const benchmarkPackVersion = toTrimmed(readOption("benchmarkPackVersion"), DEFAULT_BENCHMARK_PACK_VERSION) || DEFAULT_BENCHMARK_PACK_VERSION;
    const lane = toTrimmed(readOption("lane"), DEFAULT_LANE) || DEFAULT_LANE;
    const snapshot = toTrimmed(readOption("snapshot")) || new Date().toISOString().replace(/[:.]/g, "-");
    const labelSeed = toTrimmed(readOption("labelSeed"), DEFAULT_LABEL_SEED) || DEFAULT_LABEL_SEED;
    const pendingOnly = readBooleanOption("pendingOnly", false);
    const reviewTarget = toTrimmed(readOption("reviewTarget"), DEFAULT_REVIEW_TARGET) || DEFAULT_REVIEW_TARGET;
    const searchBudgetFilter = toTrimmed(readOption("searchBudget"), "") || null;

    if (!["all", "shortlist", "pairwise"].includes(reviewTarget)) {
        fail("Unsupported review target", { reviewTarget, supported: ["all", "shortlist", "pairwise"] });
    }

    if (!fs.existsSync(outputDir)) {
        fail("Output directory does not exist", { outputDir });
    }

    const packDir = buildReviewPackRoot(outputDir, snapshot);
    if (fs.existsSync(packDir)) {
        fail("Review pack directory already exists", { packDir, snapshot });
    }

    const reviewedSongIds = collectReviewedSongIds(outputDir, benchmarkPackVersion, lane);
    const pendingPackedSongIds = collectPendingPackedSongIds(outputDir, benchmarkPackVersion, lane);

    const songDirs = fs.readdirSync(outputDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "_system")
        .map((entry) => path.join(outputDir, entry.name));

    const candidatePairs = [];
    const skipped = [];
    const filtered = [];
    for (const songDir of songDirs) {
        const manifest = readJsonIfExists(path.join(songDir, "manifest.json"));
        const candidateIndex = readJsonIfExists(path.join(songDir, "candidates", "index.json"));
        if (!manifest || !candidateIndex) {
            continue;
        }
        const pair = buildBenchmarkPair(songDir, manifest, candidateIndex, { benchmarkPackVersion, lane });
        if (!pair) {
            continue;
        }
        if (pair.skipped) {
            skipped.push({ songId: pair.songId, reason: pair.reason });
            continue;
        }
        candidatePairs.push(pair);
    }

    const eligiblePairs = candidatePairs.filter((pair) => {
        if (!matchesSearchBudgetFilter(searchBudgetFilter, pair)) {
            filtered.push({
                songId: pair.songId,
                reason: "search_budget_mismatch",
                searchBudgetLevel: pair.searchBudgetLevel,
                searchBudgetDescriptor: pair.searchBudgetDescriptor,
            });
            return false;
        }
        return true;
    });
    const pendingPairs = eligiblePairs.filter(
        (pair) => !reviewedSongIds.has(pair.songId) && !pendingPackedSongIds.has(pair.songId),
    );
    const pairs = eligiblePairs.filter((pair) => {
        if (pendingOnly && reviewedSongIds.has(pair.songId)) {
            filtered.push({ songId: pair.songId, reason: "already_reviewed_in_blind_pack" });
            return false;
        }
        if (pendingOnly && pendingPackedSongIds.has(pair.songId)) {
            filtered.push({ songId: pair.songId, reason: "already_present_in_active_blind_pack" });
            return false;
        }
        if (reviewTarget === "shortlist" && !pair.selectedInShortlist) {
            filtered.push({ songId: pair.songId, reason: "outside_shortlist" });
            return false;
        }
        if (reviewTarget === "pairwise" && pair.selectedInShortlist) {
            filtered.push({ songId: pair.songId, reason: "shortlist_qualified" });
            return false;
        }
        return true;
    });

    const orderedPairs = [...pairs].sort((left, right) => {
        if (pendingOnly || reviewTarget !== "all") {
            const shortlistDelta = Number(right.selectedInShortlist) - Number(left.selectedInShortlist);
            if (shortlistDelta !== 0) {
                return shortlistDelta;
            }

            const observedDelta = right.observedAt.localeCompare(left.observedAt);
            if (observedDelta !== 0) {
                return observedDelta;
            }
        }

        return left.observedAt.localeCompare(right.observedAt) || left.songId.localeCompare(right.songId);
    });

    const sourceReviewQueue = {
        pendingOnly,
        reviewTarget,
        searchBudget: searchBudgetFilter,
        candidatePairCount: eligiblePairs.length,
        pendingBlindReviewCount: pendingPairs.length,
        pendingShortlistReviewCount: pendingPairs.filter((pair) => pair.selectedInShortlist).length,
    }

    ensureDir(packDir);
    const assetsDir = path.join(packDir, "assets");
    ensureDir(assetsDir);
    const generatedAt = new Date().toISOString();

    const packEntries = [];
    const answerEntries = [];
    let entryIndex = 0;
    for (const pair of orderedPairs) {
        entryIndex += 1;
        const pairId = buildPairId(pair);
        const entryId = `pair-${String(entryIndex).padStart(3, "0")}`;
        const labels = chooseLabels(pairId, `${labelSeed}|${snapshot}`);
        const baselineBlindPath = path.join(assetsDir, `${entryId}-${labels.baseline}.mid`);
        const learnedBlindPath = path.join(assetsDir, `${entryId}-${labels.learned}.mid`);
        fs.copyFileSync(pair.baseline.midiPath, baselineBlindPath);
        fs.copyFileSync(pair.learned.midiPath, learnedBlindPath);

        packEntries.push({
            entryId,
            benchmarkId: pair.benchmarkId,
            planSignature: pair.planSignature,
            observedAt: pair.observedAt,
            decisionOptions: ["A", "B", "tie", "skip"],
            variants: [
                {
                    label: labels.baseline,
                    midiPath: normalizeRelative(baselineBlindPath, packDir),
                },
                {
                    label: labels.learned,
                    midiPath: normalizeRelative(learnedBlindPath, packDir),
                },
            ].sort((left, right) => left.label.localeCompare(right.label)),
        });

        answerEntries.push({
            entryId,
            pairId,
            songId: pair.songId,
            benchmarkId: pair.benchmarkId,
            planSignature: pair.planSignature,
            promptPackVersion: pair.promptPackVersion,
            reviewRubricVersion: pair.reviewRubricVersion,
            observedAt: pair.observedAt,
            selectedWorker: pair.selectedWorker,
            selectionMode: pair.selectionMode,
            reviewTarget: pair.reviewTarget,
            shortlistTopK: pair.shortlistTopK,
            selectedRank: pair.selectedRank,
            selectedInShortlist: pair.selectedInShortlist,
            wholePieceCandidateCount: pair.wholePieceCandidateCount,
            localizedRewriteBranchCount: pair.localizedRewriteBranchCount,
            searchBudgetLevel: pair.searchBudgetLevel,
            searchBudgetDescriptor: pair.searchBudgetDescriptor,
            baseline: {
                label: labels.baseline,
                candidateId: pair.baseline.candidateId,
                worker: pair.baseline.worker,
                sourceMidiPath: pair.baseline.midiPath,
                sourceCandidateManifestPath: pair.baseline.manifestPath,
            },
            learned: {
                label: labels.learned,
                candidateId: pair.learned.candidateId,
                worker: pair.learned.worker,
                sourceMidiPath: pair.learned.midiPath,
                sourceCandidateManifestPath: pair.learned.manifestPath,
            },
        });
    }

    const packPath = path.join(packDir, "pack.json");
    const answerKeyPath = path.join(packDir, "answer-key.json");
    const resultsPath = path.join(packDir, "results.json");
    const reviewSheetPath = path.join(packDir, "review-sheet.csv");
    writeJson(packPath, {
        version: 1,
        type: "learned_backbone_blind_review_pack",
        packId: snapshot,
        generatedAt,
        lane,
        benchmarkPackVersion,
        sourceReviewQueue,
        entryCount: packEntries.length,
        entries: packEntries,
    });
    writeJson(answerKeyPath, {
        version: 1,
        type: "learned_backbone_blind_review_answer_key",
        packId: snapshot,
        generatedAt,
        lane,
        benchmarkPackVersion,
        sourceReviewQueue,
        entryCount: answerEntries.length,
        entries: answerEntries,
    });
    writeJson(resultsPath, {
        version: 1,
        type: "learned_backbone_blind_review_results",
        packId: snapshot,
        generatedAt,
        lane,
        benchmarkPackVersion,
        results: [],
    });
    const packEntryById = new Map(packEntries.map((item) => [item.entryId, item]));
    writeText(reviewSheetPath, buildReviewSheetCsv(answerEntries.map((entry) => {
        const packEntry = packEntryById.get(entry.entryId);
        const variantA = (packEntry?.variants ?? []).find((item) => item.label === "A");
        const variantB = (packEntry?.variants ?? []).find((item) => item.label === "B");
        return {
            entryId: entry.entryId,
            songId: entry.songId,
            benchmarkId: entry.benchmarkId,
            reviewTarget: entry.reviewTarget,
            winnerLabel: "",
            reviewedAt: "",
            reviewerId: "",
            notes: "",
            allowedWinnerLabels: "A|B|TIE|SKIP",
            midiAPath: variantA?.midiPath ?? "",
            midiBPath: variantB?.midiPath ?? "",
        };
    })));

    console.log(JSON.stringify({
        ok: true,
        outputDir,
        lane,
        benchmarkPackVersion,
        packId: snapshot,
        sourceReviewQueue,
        pairCount: packEntries.length,
        skippedPairCount: skipped.length,
        skipped,
        filteredPairCount: filtered.length,
        filtered,
        paths: {
            packPath,
            answerKeyPath,
            resultsPath,
            reviewSheetPath,
        },
    }, null, 2));
}

main();