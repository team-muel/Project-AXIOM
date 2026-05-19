/**
 * create-score-profile-from-correlation.mjs
 *
 * Generates a new craft scoring profile JSON by adjusting base-profile weights
 * proportionally to the Pearson correlation between each score dimension and
 * the target feedback dimension (default: "appeal").
 *
 * Algorithm:
 *   1. Load the correlation report produced by analyze-score-feedback-correlation.mjs
 *   2. For each base dimension, look up its correlation r with the feedback target.
 *   3. Compute a raw adjusted weight:
 *        rawWeight = baseWeight * max(0, r)^SCALE_EXPONENT
 *      Dimensions with negative or near-zero correlation approach zero.
 *      Dimensions with correlation near 1.0 keep their base weight.
 *   4. Re-normalise all weights to sum to 1.00 (they are rounded to 4dp).
 *   5. Validate sum ≈ 1.00 and write the JSON file.
 *
 * The generated file can be placed under config/scoring-profiles/ and activated
 * via the AXIOM_SCORING_PROFILE environment variable.
 *
 * Usage:
 *   node scripts/create-score-profile-from-correlation.mjs \
 *     --input=outputs/_system/score-feedback-correlation.json \
 *     --name=classical_default_v2 \
 *     [--output=config/scoring-profiles/classical_default_v2.json] \
 *     [--base=classical_default_v1] \
 *     [--feedback-dim=appeal] \
 *     [--min-r=0.15] \
 *     [--min-n=3] \
 *     [--dry-run]
 *
 * Options:
 *   --input        Correlation JSON from analyze-score-feedback-correlation.mjs
 *                  (default: outputs/_system/score-feedback-correlation.json)
 *   --name         Profile identifier for the new file (required)
 *   --output       Output path  (default: config/scoring-profiles/<name>.json)
 *   --base         Base built-in profile to start from
 *                  Supported: classical_default_v1, piano_listenability_v1,
 *                             piano_craft_v1  (default: classical_default_v1)
 *   --feedback-dim Feedback dimension to calibrate against (default: appeal)
 *   --min-r        Minimum |r| to adjust weight; below this, base weight is kept
 *                  (default: 0.15)
 *   --min-n        Minimum sample count required to use correlation (default: 3)
 *   --dry-run      Print the new profile to stdout without writing the file
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ─── CLI helpers ──────────────────────────────────────────────────────────────

function readOption(name, defaultValue) {
    const prefix = `--${name}=`;
    const exactIdx = process.argv.indexOf(`--${name}`);
    if (exactIdx >= 0) return process.argv[exactIdx + 1] ?? defaultValue;
    const prefixed = process.argv.find((a) => a.startsWith(prefix));
    if (prefixed) return prefixed.slice(prefix.length);
    return defaultValue;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function fail(message) {
    console.error(`\nERROR: ${message}\n`);
    process.exit(1);
}

// ─── Built-in base profiles ───────────────────────────────────────────────────

const BASE_PROFILES = {
    classical_default_v1: {
        profile: "classical_default_v1",
        description: "Default craft scoring weights for classical string-trio form.",
        weights: {
            sectionContractFit:   0.15,
            cadenceStrength:      0.15,
            tonalReturn:          0.15,
            motifSurvival:        0.15,
            voiceIndependence:    0.15,
            phraseShape:          0.10,
            registerIdiomaticFit: 0.10,
            syntaxValidity:       0.05,
        },
    },
    piano_listenability_v1: {
        profile: "piano_listenability_v1",
        description: "Listenability scoring weights for solo piano.",
        weights: {
            melodyProminence:         0.20,
            bassRootSupport:          0.18,
            accompanimentConsistency: 0.16,
            registerSpacing:          0.15,
            phraseLevelVoicing:       0.10,
            pedalBlurRisk:            0.12,
            textureFormCoherence:     0.09,
        },
    },
    piano_craft_v1: {
        profile: "piano_craft_v1",
        description: "Craft scoring weights for solo piano finalPianoScore.",
        weights: {
            handPlayability:               0.20,
            melodicClarity:                0.15,
            bassCoherence:                 0.15,
            voicingIdiomaticFit:           0.12,
            accompanimentPatternCoherence: 0.12,
            registerSpacing:               0.10,
            handIndependence:              0.08,
            pedalPlausibility:             0.05,
            difficultyFit:                 0.03,
        },
    },
};

// Scale exponent: higher = more aggressive down-weighting of weak dimensions.
// 1.0 = linear scaling; 0.5 = square-root (gentler); 2.0 = quadratic (harsher).
const SCALE_EXPONENT = 1.0;

// ─── Core logic ───────────────────────────────────────────────────────────────

function loadCorrelationReport(inputPath) {
    if (!fs.existsSync(inputPath)) {
        fail(`Correlation report not found: ${inputPath}\nRun: npm run analyze:score-feedback`);
    }
    try {
        return JSON.parse(fs.readFileSync(inputPath, "utf-8"));
    } catch (err) {
        fail(`Could not parse correlation report: ${err.message}`);
    }
}

/**
 * Extracts the Pearson r value for a given score dimension and feedback dimension.
 * Returns null when sample count is below minN or the value is missing.
 */
function getCorrelationR(report, scoreDim, feedbackDim, minN) {
    const entry = report?.correlationTable?.[scoreDim]?.[feedbackDim];
    if (!entry) return null;
    if (typeof entry.n === "number" && entry.n < minN) return null;
    const r = entry.pearson;
    return typeof r === "number" && Number.isFinite(r) ? r : null;
}

/**
 * Adjust base weights using correlation signal.
 * Returns a new weights object with values in [0, 1] that sum to 1.00.
 */
function adjustWeights(baseWeights, report, feedbackDim, minR, minN) {
    const dims = Object.keys(baseWeights);
    const adjusted = {};

    for (const dim of dims) {
        const r = getCorrelationR(report, dim, feedbackDim, minN);
        const base = baseWeights[dim];

        if (r === null || Math.abs(r) < minR) {
            // No reliable signal — keep base weight unchanged
            adjusted[dim] = base;
        } else if (r < 0) {
            // Anti-correlated — reduce to a small floor (5% of base, min 0.005)
            adjusted[dim] = Math.max(0.005, base * 0.05);
        } else {
            // Positive correlation — scale by r^SCALE_EXPONENT
            adjusted[dim] = base * Math.pow(r, SCALE_EXPONENT);
        }
    }

    // Normalise to sum to 1.00
    const total = Object.values(adjusted).reduce((s, v) => s + v, 0);
    if (total === 0) fail("All adjusted weights are zero — cannot normalise.");

    const normalised = {};
    for (const dim of dims) {
        normalised[dim] = Math.round((adjusted[dim] / total) * 10000) / 10000;
    }

    // Fix rounding residual: adjust the largest weight to ensure exact sum
    const sum = Object.values(normalised).reduce((s, v) => s + v, 0);
    const residual = Math.round((1.0 - sum) * 10000) / 10000;
    if (Math.abs(residual) > 0) {
        const largest = dims.reduce((a, b) => normalised[a] >= normalised[b] ? a : b);
        normalised[largest] = Math.round((normalised[largest] + residual) * 10000) / 10000;
    }

    return normalised;
}

function validateWeightSum(weights) {
    const sum = Object.values(weights).reduce((s, v) => s + v, 0);
    if (Math.abs(sum - 1.0) > 0.005) {
        fail(`Normalised weights sum to ${sum.toFixed(4)}, expected 1.00 ±0.005`);
    }
    return sum;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const inputPath = readOption(
    "input",
    path.join(repoRoot, "outputs", "_system", "score-feedback-correlation.json"),
);
const profileName = readOption("name", "");
const baseName    = readOption("base", "classical_default_v1");
const feedbackDim = readOption("feedback-dim", "appeal");
const minR        = Number(readOption("min-r", "0.15"));
const minN        = Number(readOption("min-n", "3"));
const dryRun      = hasFlag("dry-run");

const outputPath = readOption(
    "output",
    path.join(repoRoot, "config", "scoring-profiles", `${profileName}.json`),
);

if (!profileName) fail("--name is required");
if (isNaN(minR) || minR < 0 || minR > 1) fail("--min-r must be a number in [0, 1]");
if (isNaN(minN) || minN < 1) fail("--min-n must be a positive integer");

// Validate base profile
const baseProfile = BASE_PROFILES[baseName];
if (!baseProfile) {
    fail(`Unknown base profile "${baseName}". Supported: ${Object.keys(BASE_PROFILES).join(", ")}`);
}

// Load correlation data
const report = loadCorrelationReport(inputPath);

// Compute adjusted weights
const newWeights = adjustWeights(baseProfile.weights, report, feedbackDim, minR, minN);
const sum = validateWeightSum(newWeights);

// Build the profile object
const correlationTableEntry = report?.correlationTable;
const sampleCounts = Object.keys(newWeights).map((dim) => {
    return report?.correlationTable?.[dim]?.[feedbackDim]?.n ?? 0;
}).filter((n) => n > 0);
const totalSamples = sampleCounts.length > 0 ? Math.max(...sampleCounts) : 0;

const today = new Date().toISOString().slice(0, 10);
const newProfile = {
    profile: profileName,
    status: "experimental",
    description: [
        `Calibrated from correlation analysis on ${today}`,
        totalSamples > 0 ? ` (${totalSamples} samples, feedback dim: ${feedbackDim})` : "",
        `. Base: ${baseName}.`,
    ].join(""),
    weights: newWeights,
};

// Output
const json = JSON.stringify(newProfile, null, 2);

if (dryRun) {
    console.log(json);
    process.exit(0);
}

// Ensure output directory exists
const outDir = path.dirname(outputPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(outputPath, json + "\n", "utf-8");

console.log(`\nProfile written: ${outputPath}`);
console.log(`  Profile: ${profileName}`);
console.log(`  Base:    ${baseName}`);
console.log(`  Dims:    ${Object.keys(newWeights).join(", ")}`);
console.log(`  Sum:     ${sum.toFixed(4)}`);
console.log("");
console.log("Activate with:");
console.log(`  AXIOM_SCORING_PROFILE=${profileName} npm start`);
console.log("");

// Print summary table
const dimRows = Object.entries(newWeights).map(([dim, w]) => {
    const base = baseProfile.weights[dim] ?? 0;
    const r = getCorrelationR(report, dim, feedbackDim, minN);
    return {
        dimension: dim,
        base: base.toFixed(4),
        adjusted: w.toFixed(4),
        delta: (w - base >= 0 ? "+" : "") + (w - base).toFixed(4),
        r: r !== null ? r.toFixed(3) : "n/a",
    };
});

const colWidths = [32, 8, 8, 8, 8];
const headers = ["dimension", "base", "adjusted", "delta", "r"].map((h, i) =>
    h.padEnd(colWidths[i]),
);
console.log(headers.join(" "));
console.log("-".repeat(colWidths.reduce((s, w) => s + w + 1, 0) - 1));
for (const row of dimRows) {
    const cells = [
        row.dimension.padEnd(colWidths[0]),
        row.base.padEnd(colWidths[1]),
        row.adjusted.padEnd(colWidths[2]),
        row.delta.padEnd(colWidths[3]),
        row.r.padEnd(colWidths[4]),
    ];
    console.log(cells.join(" "));
}
