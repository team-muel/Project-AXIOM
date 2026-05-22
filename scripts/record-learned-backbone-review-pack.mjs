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
    return prefixed ? prefixed.slice(prefix.length) : undefined;
}

function fail(message, details) {
    console.error(JSON.stringify({ ok: false, message, details }, null, 2));
    process.exit(1);
}

const resultsFile = readOption("resultsFile");
const label = readOption("label");
const outputDir = readOption("outputDir") || DEFAULT_OUTPUT_DIR;

if (!resultsFile) {
    fail("--resultsFile is required", {
        usage: "node scripts/record-learned-backbone-review-pack.mjs --resultsFile=<path> [--label=<label>] [--outputDir=<dir>]",
    });
}

if (!fs.existsSync(resultsFile)) {
    fail(`Results file not found: ${resultsFile}`);
}

let results;
try {
    results = JSON.parse(fs.readFileSync(resultsFile, "utf-8"));
} catch (err) {
    fail(`Failed to parse results file: ${err.message}`);
}

const recordDir = path.join(outputDir, "_system", "ml", "learned-backbone-review-records");
fs.mkdirSync(recordDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const recordLabel = label || `record_${timestamp}`;
const outPath = path.join(recordDir, `${recordLabel}.json`);

const record = {
    label: recordLabel,
    recordedAt: new Date().toISOString(),
    resultsFile: path.resolve(resultsFile),
    results,
};

const tmp = `${outPath}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(record, null, 2), "utf-8");
fs.renameSync(tmp, outPath);

console.log(JSON.stringify({ ok: true, label: recordLabel, outPath }, null, 2));
