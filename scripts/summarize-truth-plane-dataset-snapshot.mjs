import fs from "node:fs";
import path from "node:path";

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

function loadJsonIfExists(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function loadJsonlIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    return fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function toTrimmed(value) {
    return String(value ?? "").trim();
}

function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => toTrimmed(value))
        .filter(Boolean))].sort();
}

function normalizeSignalValues(value) {
    if (Array.isArray(value)) {
        return uniqueStrings(value);
    }

    const normalized = toTrimmed(value);
    return normalized ? [normalized] : [];
}

function countBy(values) {
    return (Array.isArray(values) ? values : []).reduce((summary, value) => {
        const normalized = toTrimmed(value) || "unknown";
        summary[normalized] = (summary[normalized] ?? 0) + 1;
        return summary;
    }, {});
}

function summarizeReviewTiers(rows) {
    return (Array.isArray(rows) ? rows : []).reduce((summary, row) => {
        const reviewTier = toTrimmed(row?.reviewTier);
        if (!reviewTier) {
            return summary;
        }
        summary[reviewTier] = (summary[reviewTier] ?? 0) + 1;
        return summary;
    }, {});
}

function buildSourceDateRangeFromRows(rows) {
    const createdAtValues = (Array.isArray(rows) ? rows : [])
        .map((row) => toTrimmed(row?.createdAt))
        .filter(Boolean)
        .sort();

    return {
        earliestCreatedAt: createdAtValues[0] || null,
        latestCreatedAt: createdAtValues[createdAtValues.length - 1] || null,
    };
}

function resolveOutputRoot() {
    return toTrimmed(readOption("root") || process.env.OUTPUT_DIR || "outputs") || "outputs";
}

function resolveSnapshotId() {
    const snapshotId = toTrimmed(readOption("snapshot") || "");
    if (!snapshotId) {
        fail("snapshot is required", {
            usage: "node scripts/summarize-truth-plane-dataset-snapshot.mjs --snapshot <snapshotId>",
        });
    }

    return snapshotId;
}

function structureRankDatasetRoot(outputRoot, snapshotId) {
    return path.join(outputRoot, "_system", "ml", "datasets", "structure-rank-v1", snapshotId);
}

function defaultDatasetRoot(outputRoot, datasetVersion, snapshotId) {
    return path.join(outputRoot, "_system", "ml", "datasets", datasetVersion, snapshotId);
}

function loadRequiredManifest(datasetRoot, datasetVersion) {
    const manifestPath = path.join(datasetRoot, "manifest.json");
    const manifest = loadJsonIfExists(manifestPath, null);
    if (!manifest || typeof manifest !== "object") {
        fail("Dataset manifest missing or invalid", {
            datasetVersion,
            manifestPath,
        });
    }

    return { manifestPath, manifest };
}

function assignRowsToSplits(rows, splits, splitKey) {
    const train = new Set(Array.isArray(splits?.train) ? splits.train.map((value) => toTrimmed(value)).filter(Boolean) : []);
    const val = new Set(Array.isArray(splits?.val) ? splits.val.map((value) => toTrimmed(value)).filter(Boolean) : []);
    const test = new Set(Array.isArray(splits?.test) ? splits.test.map((value) => toTrimmed(value)).filter(Boolean) : []);
    const rowsBySplit = {
        train: [],
        val: [],
        test: [],
        unknown: [],
    };

    for (const row of Array.isArray(rows) ? rows : []) {
        const key = toTrimmed(row?.[splitKey]);
        if (key && train.has(key)) {
            rowsBySplit.train.push(row);
            continue;
        }
        if (key && val.has(key)) {
            rowsBySplit.val.push(row);
            continue;
        }
        if (key && test.has(key)) {
            rowsBySplit.test.push(row);
            continue;
        }
        rowsBySplit.unknown.push(row);
    }

    return rowsBySplit;
}

function summarizeSignalLeakage(rowsBySplit, valueExtractor) {
    const valueToSplits = new Map();

    for (const split of ["train", "val", "test"]) {
        for (const row of rowsBySplit[split] ?? []) {
            for (const value of normalizeSignalValues(valueExtractor(row))) {
                const bucket = valueToSplits.get(value) ?? new Set();
                bucket.add(split);
                valueToSplits.set(value, bucket);
            }
        }
    }

    const crossSplitValues = [...valueToSplits.entries()]
        .map(([value, splitSet]) => ({
            value,
            splits: [...splitSet].sort(),
        }))
        .filter((entry) => entry.splits.length > 1);

    const trainToEvalValues = crossSplitValues.filter((entry) => entry.splits.includes("train") && (entry.splits.includes("val") || entry.splits.includes("test")));

    return {
        ok: trainToEvalValues.length === 0,
        observedValueCount: valueToSplits.size,
        crossSplitValueCount: crossSplitValues.length,
        collisionCount: trainToEvalValues.length,
        evaluationOnlyCollisionCount: crossSplitValues.length - trainToEvalValues.length,
        leakedValues: trainToEvalValues.slice(0, 10),
    };
}

function summarizeLeakageChecks(rowsBySplit, checks) {
    const summary = {
        ok: true,
        unknownSplitRowCount: rowsBySplit.unknown.length,
    };

    if (rowsBySplit.unknown.length > 0) {
        summary.ok = false;
    }

    for (const check of checks) {
        const result = summarizeSignalLeakage(rowsBySplit, check.valueExtractor);
        summary[check.name] = result;
        if (!result.ok) {
            summary.ok = false;
        }
    }

    return summary;
}

function loadStructureRankSnapshot(outputRoot, snapshotId) {
    const datasetRoot = structureRankDatasetRoot(outputRoot, snapshotId);
    const { manifestPath, manifest } = loadRequiredManifest(datasetRoot, "structure_rank_v1");
    const rowsBySplit = {
        train: loadJsonlIfExists(path.join(datasetRoot, "train.jsonl")),
        val: loadJsonlIfExists(path.join(datasetRoot, "val.jsonl")),
        test: loadJsonlIfExists(path.join(datasetRoot, "test.jsonl")),
        unknown: [],
    };
    const allRows = [
        ...rowsBySplit.train,
        ...rowsBySplit.val,
        ...rowsBySplit.test,
    ];

    return {
        datasetVersion: "structure_rank_v1",
        datasetRoot,
        manifestPath,
        manifest,
        rowsBySplit,
        allRows,
        splitCounts: manifest.splitCounts,
        reviewTierCounts: manifest.reviewTierCounts ?? summarizeReviewTiers(allRows),
        sourceDateRange: manifest.sourceDateRange ?? buildSourceDateRangeFromRows(allRows),
        rowCount: allRows.length,
    };
}

function loadFlatRowSnapshot(datasetVersion, datasetRoot) {
    const { manifestPath, manifest } = loadRequiredManifest(datasetRoot, datasetVersion);
    const splitsPath = path.join(datasetRoot, "splits.json");
    const splits = loadJsonIfExists(splitsPath, null);
    if (!splits || typeof splits !== "object") {
        fail("Dataset splits missing or invalid", {
            datasetVersion,
            splitsPath,
        });
    }

    const rows = loadJsonlIfExists(path.join(datasetRoot, "rows.jsonl"));
    const splitKey = toTrimmed(splits.splitKey) || "songId";

    return {
        datasetVersion,
        datasetRoot,
        manifestPath,
        manifest,
        splits,
        splitKey,
        rows,
        rowsBySplit: assignRowsToSplits(rows, splits, splitKey),
        splitCounts: manifest.splitCounts,
        reviewTierCounts: manifest.reviewTierCounts ?? summarizeReviewTiers(rows),
        sourceDateRange: manifest.sourceDateRange ?? buildSourceDateRangeFromRows(rows),
        rowCount: rows.length,
    };
}

function loadSearchSnapshot(datasetRoot) {
    const { manifestPath, manifest } = loadRequiredManifest(datasetRoot, "axiom_search_reranker_v1");
    const splitsPath = path.join(datasetRoot, "splits.json");
    const splits = loadJsonIfExists(splitsPath, null);
    if (!splits || typeof splits !== "object") {
        fail("Dataset splits missing or invalid", {
            datasetVersion: "axiom_search_reranker_v1",
            splitsPath,
        });
    }

    const groupRows = loadJsonlIfExists(path.join(datasetRoot, "groups.jsonl"));
    const pairwiseRows = loadJsonlIfExists(path.join(datasetRoot, "pairwise.jsonl"));
    const shortlistRows = loadJsonlIfExists(path.join(datasetRoot, "shortlists.jsonl"));

    return {
        datasetVersion: "axiom_search_reranker_v1",
        datasetRoot,
        manifestPath,
        manifest,
        splits,
        groupRows,
        pairwiseRows,
        shortlistRows,
        rowsBySplit: assignRowsToSplits(groupRows, splits, "songId"),
        splitCounts: manifest.splitCounts,
        reviewTierCounts: manifest.reviewTierCounts,
        sourceDateRange: manifest.sourceDateRange ?? buildSourceDateRangeFromRows(groupRows),
        groupCount: groupRows.length,
        pairwiseCount: pairwiseRows.length,
        shortlistCount: shortlistRows.length,
    };
}

function summarizePromotionCounts(groupRows) {
    const normalizedRows = Array.isArray(groupRows) ? groupRows : [];
    const appliedRows = normalizedRows.filter((row) => row?.promotion?.applied);

    return {
        groupCount: normalizedRows.length,
        appliedGroupCount: appliedRows.length,
        unappliedGroupCount: Math.max(0, normalizedRows.length - appliedRows.length),
        reviewedAppliedGroupCount: appliedRows.filter((row) => toTrimmed(row?.reviewTier).startsWith("reviewed_")).length,
        disagreementGroupCount: normalizedRows.filter((row) => toTrimmed(row?.heuristicTopCandidateId) && toTrimmed(row?.learnedTopCandidateId) && toTrimmed(row.heuristicTopCandidateId) !== toTrimmed(row.learnedTopCandidateId)).length,
        laneCounts: countBy(appliedRows.map((row) => row?.promotion?.lane)),
        snapshotCounts: countBy(appliedRows.map((row) => row?.promotion?.snapshotId)),
    };
}

const outputRoot = resolveOutputRoot();
const snapshotId = resolveSnapshotId();
const structureRankSnapshot = loadStructureRankSnapshot(outputRoot, snapshotId);
const additionalDatasets = structureRankSnapshot.manifest.additionalDatasets ?? {};
const backboneSnapshot = loadFlatRowSnapshot(
    "axiom_backbone_piece_v1",
    toTrimmed(additionalDatasets.axiom_backbone_piece_v1?.datasetRoot) || defaultDatasetRoot(outputRoot, "axiom_backbone_piece_v1", snapshotId),
);
const localizedRewriteSnapshot = loadFlatRowSnapshot(
    "axiom_localized_rewrite_v1",
    toTrimmed(additionalDatasets.axiom_localized_rewrite_v1?.datasetRoot) || defaultDatasetRoot(outputRoot, "axiom_localized_rewrite_v1", snapshotId),
);
const searchSnapshot = loadSearchSnapshot(
    toTrimmed(additionalDatasets.axiom_search_reranker_v1?.datasetRoot) || defaultDatasetRoot(outputRoot, "axiom_search_reranker_v1", snapshotId),
);

const splitLeakageChecks = {
    structure_rank_v1: summarizeLeakageChecks(structureRankSnapshot.rowsBySplit, [
        {
            name: "promptHash",
            valueExtractor: (row) => row?.lineage?.promptHash,
        },
        {
            name: "proposalPlanSignature",
            valueExtractor: (row) => row?.proposalEvidence?.planSignature,
        },
    ]),
    axiom_backbone_piece_v1: summarizeLeakageChecks(backboneSnapshot.rowsBySplit, [
        {
            name: "promptHash",
            valueExtractor: (row) => row?.conditioning?.promptHash,
        },
        {
            name: "proposalPlanSignature",
            valueExtractor: (row) => row?.proposalEvidence?.planSignature,
        },
    ]),
    axiom_localized_rewrite_v1: summarizeLeakageChecks(localizedRewriteSnapshot.rowsBySplit, [
        {
            name: "proposalPlanSignature",
            valueExtractor: (row) => row?.proposalEvidence?.planSignature,
        },
    ]),
    axiom_search_reranker_v1: summarizeLeakageChecks(searchSnapshot.rowsBySplit, [
        {
            name: "promptHash",
            valueExtractor: (row) => row?.promptHash,
        },
        {
            name: "plannerPlanSignature",
            valueExtractor: (row) => row?.plannerPlanSignature,
        },
        {
            name: "proposalPlanSignature",
            valueExtractor: (row) => row?.proposalPlanSignature,
        },
    ]),
};

const report = {
    ok: true,
    snapshotId,
    outputRoot,
    observedAt: new Date().toISOString(),
    datasets: {
        structure_rank_v1: {
            datasetRoot: structureRankSnapshot.datasetRoot,
            rowCount: structureRankSnapshot.rowCount,
            splitCounts: structureRankSnapshot.splitCounts,
            reviewTierCounts: structureRankSnapshot.reviewTierCounts,
            sourceDateRange: structureRankSnapshot.sourceDateRange,
        },
        axiom_backbone_piece_v1: {
            datasetRoot: backboneSnapshot.datasetRoot,
            rowCount: backboneSnapshot.rowCount,
            splitCounts: backboneSnapshot.splitCounts,
            reviewTierCounts: backboneSnapshot.reviewTierCounts,
            sourceDateRange: backboneSnapshot.sourceDateRange,
        },
        axiom_localized_rewrite_v1: {
            datasetRoot: localizedRewriteSnapshot.datasetRoot,
            rowCount: localizedRewriteSnapshot.rowCount,
            splitCounts: localizedRewriteSnapshot.splitCounts,
            reviewTierCounts: localizedRewriteSnapshot.reviewTierCounts,
            sourceDateRange: localizedRewriteSnapshot.sourceDateRange,
        },
        axiom_search_reranker_v1: {
            datasetRoot: searchSnapshot.datasetRoot,
            groupCount: searchSnapshot.groupCount,
            pairwiseCount: searchSnapshot.pairwiseCount,
            shortlistCount: searchSnapshot.shortlistCount,
            splitCounts: searchSnapshot.splitCounts,
            reviewTierCounts: searchSnapshot.reviewTierCounts,
            sourceDateRange: searchSnapshot.sourceDateRange,
        },
    },
    promotionCounts: summarizePromotionCounts(searchSnapshot.groupRows),
    splitLeakageChecks,
};

console.log(JSON.stringify(report, null, 2));