import { exportBackbonePieceDataset } from "./export-structure-reranker-dataset.mjs";

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

function toTrimmed(value) {
    return String(value ?? "").trim();
}

function daySnapshotId(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

function fail(message, details) {
    const payload = { ok: false, message, details };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
}

try {
    const outputRoot = toTrimmed(readOption("root") || process.env.OUTPUT_DIR || "outputs") || "outputs";
    const snapshotId = toTrimmed(readOption("snapshot") || daySnapshotId()) || daySnapshotId();
    const manifest = exportBackbonePieceDataset({ outputRoot, snapshotId });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
    fail("Failed to export backbone piece dataset", {
        message: error instanceof Error ? error.message : String(error),
    });
}