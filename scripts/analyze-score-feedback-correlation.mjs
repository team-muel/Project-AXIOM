/**
 * analyze-score-feedback-correlation.mjs
 *
 * Reads all AXIOM candidate manifests and computes Pearson correlation between
 * each automated score dimension and human listener feedback ratings.
 *
 * Goal: determine whether advancedCraftScore (and its components) actually
 * correlate with what listeners prefer — and if not, which dimensions to
 * re-weight or remove.
 *
 * Score dimensions extracted per candidate:
 *   finalCraftScore          — weighted heuristic gate score
 *   advancedCraftScore       — plan-aware composite (planPhrase+Harmony+Motif + …)
 *   planAwarePhraseGrammarScore
 *   planAwareHarmonyGrammarScore
 *   planAwareMotifDevelopmentScore
 *   cadenceArchitecturalWeight
 *   voiceLeadingScore
 *   textureProfileScore
 *   tonicizationDepthScore
 *   evidenceCoverageScore
 *   pianoListenabilityScore  — from pianoCraftScore (piano candidates only)
 *
 * Listener feedback dimensions (1–5 integer ratings):
 *   appeal       — primary calibration target
 *   coherence
 *   memorability
 *   emotionalImpact
 *
 * Output (stdout):
 *   JSON report with per-dimension correlations, scatter data, and summary
 *
 * Usage:
 *   node scripts/analyze-score-feedback-correlation.mjs [options]
 *
 * Options:
 *   --root=<dir>         outputs root directory (default: outputs)
 *   --min-samples=<n>    minimum paired samples to compute correlation (default: 3)
 *   --out=<file>         write JSON report to file instead of stdout
 *   --csv                also write a CSV table next to the JSON report
 */

import fs from "node:fs";
import path from "node:path";

// ─── CLI helpers ──────────────────────────────────────────────────────────────

function readOption(name) {
    const prefix = `--${name}=`;
    const exactIdx = process.argv.indexOf(`--${name}`);
    if (exactIdx >= 0) return process.argv[exactIdx + 1] ?? "";
    const prefixed = process.argv.find((a) => a.startsWith(prefix));
    if (prefixed) return prefixed.slice(prefix.length);
    return undefined;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function fail(message, details) {
    console.error(JSON.stringify({ ok: false, message, ...(details ? { details } : {}) }, null, 2));
    process.exit(1);
}

// ─── Filesystem helpers ───────────────────────────────────────────────────────

function loadJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return null; }
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonFile(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function writeCsvFile(filePath, rows) {
    if (!rows.length) return;
    ensureDir(path.dirname(filePath));
    const headers = Object.keys(rows[0]).join(",");
    const lines = rows.map((r) =>
        Object.values(r).map((v) => {
            const s = String(v ?? "");
            return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(","),
    );
    fs.writeFileSync(filePath, [headers, ...lines].join("\n") + "\n", "utf-8");
}

// ─── Manifest traversal ───────────────────────────────────────────────────────

function listSongDirs(outputRoot) {
    if (!fs.existsSync(outputRoot)) return [];
    return fs.readdirSync(outputRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "_system")
        .map((e) => path.join(outputRoot, e.name))
        .sort();
}

function loadCandidateIndex(songDir) {
    return loadJsonIfExists(path.join(songDir, "candidates", "index.json"));
}

function loadCandidateManifest(songDir, candidateId) {
    return loadJsonIfExists(path.join(songDir, "candidates", candidateId, "candidate-manifest.json"));
}

// ─── Score extraction ─────────────────────────────────────────────────────────

const SCORE_DIMENSIONS = [
    "finalCraftScore",
    "advancedCraftScore",
    "planAwarePhraseGrammarScore",
    "planAwareHarmonyGrammarScore",
    "planAwareMotifDevelopmentScore",
    "cadenceArchitecturalWeight",
    "voiceLeadingScore",
    "textureProfileScore",
    "tonicizationDepthScore",
    "evidenceCoverageScore",
];

const FEEDBACK_DIMENSIONS = ["appeal", "coherence", "memorability", "emotionalImpact"];

/**
 * Extracts automated score dimensions and listener feedback from a candidate
 * manifest.  Returns null if the manifest has no listener feedback — we can
 * only compute correlations for rated candidates.
 */
function extractDataPoint(manifest) {
    const craft = manifest?.structureEvaluation?.craftScoreSummary;
    const feedback = manifest?.listenerFeedback;

    // Only include candidates that have at least an appeal rating
    if (!feedback || typeof feedback.appeal !== "number") return null;

    const point = {
        songId: manifest.songId ?? "?",
        candidateId: manifest.candidateId ?? "?",
        scoringProfile: manifest.scoringProfiles?.scoringProfile ?? craft?.scoringProfile ?? null,
    };

    for (const dim of SCORE_DIMENSIONS) {
        const raw = craft?.[dim];
        point[dim] = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    }

    // Piano listenability comes from the pianoCraftScore sidecar field
    const piano = manifest?.pianoCraftScore;
    point["pianoListenabilityScore"] = typeof piano?.pianoListenabilityScore === "number"
        ? piano.pianoListenabilityScore
        : null;

    for (const fb of FEEDBACK_DIMENSIONS) {
        const raw = feedback[fb];
        point[`fb_${fb}`] = typeof raw === "number" ? raw : null;
    }

    // Pairwise preference signal: when the listener preferred this over another candidate
    point["preferredOver"] = typeof feedback.preferredOver === "string" && feedback.preferredOver
        ? feedback.preferredOver
        : null;

    // Rejection reason tag (categorical)
    point["rejectionReason"] = typeof feedback.rejectionReason === "string" && feedback.rejectionReason
        ? feedback.rejectionReason
        : null;

    // Selected flag — lets pairwise analysis distinguish winner vs. competitors
    point["selected"] = manifest.selected === true;

    return point;
}

// ─── Statistics ───────────────────────────────────────────────────────────────

/**
 * Pearson correlation coefficient between two arrays of equal length.
 * Returns null when n < 2 or when either array has zero variance.
 */
function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;

    const meanX = xs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY);
    if (den === 0) return null;
    return num / den;
}

/**
 * Spearman rank correlation (monotonic, more robust to outliers).
 * Returns null when n < 3.
 */
function rankArray(xs) {
    const indexed = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(xs.length);
    for (let i = 0; i < indexed.length; i++) {
        ranks[indexed[i].i] = i + 1;
    }
    return ranks;
}

function spearman(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    return pearson(rankArray(xs), rankArray(ys));
}

// ─── Pairwise preference analysis ─────────────────────────────────────────────

/**
 * Computes pairwise preference accuracy: for each preferredOver pair (A preferred
 * over B), checks whether the winner (A) actually scored higher than the loser (B)
 * on each score dimension.
 *
 * Result: pairwiseAccuracy[scoreDim] = fraction of pairs where higher-scored
 * candidate was preferred (1.0 = score perfectly predicts preference).
 */
function buildPairwiseAnalysis(dataPoints) {
    // Build lookup: songId+candidateId → point
    const lookup = new Map();
    for (const p of dataPoints) {
        lookup.set(`${p.songId}::${p.candidateId}`, p);
    }

    const allDims = [...SCORE_DIMENSIONS, "pianoListenabilityScore"];
    const correct = Object.fromEntries(allDims.map((d) => [d, 0]));
    const total   = Object.fromEntries(allDims.map((d) => [d, 0]));
    const pairs   = [];

    for (const winner of dataPoints) {
        if (!winner.preferredOver) continue;
        const loser = lookup.get(`${winner.songId}::${winner.preferredOver}`);
        if (!loser) continue;  // loser not in rated set

        const pair = {
            songId: winner.songId,
            winnerId: winner.candidateId,
            loserId: winner.preferredOver,
            dimensions: {},
        };

        for (const dim of allDims) {
            const ws = winner[dim];
            const ls = loser[dim];
            if (typeof ws === "number" && typeof ls === "number") {
                total[dim]++;
                const isCorrect = ws > ls;
                if (isCorrect) correct[dim]++;
                pair.dimensions[dim] = {
                    winnerScore: ws,
                    loserScore:  ls,
                    scoreCorrect: isCorrect,
                    delta: round4(ws - ls),
                };
            }
        }
        pairs.push(pair);
    }

    const accuracy = Object.fromEntries(
        allDims.map((dim) => [
            dim,
            total[dim] >= 1
                ? { accuracy: round4(correct[dim] / total[dim]), n: total[dim] }
                : null,
        ]).filter(([, v]) => v !== null),
    );

    return {
        pairCount: pairs.length,
        dimensionAccuracy: accuracy,
        note: "accuracy = fraction of pairs where the preferred candidate scored higher. 1.0 = score perfectly predicts preference; 0.5 = random.",
        pairs: pairs.length <= 50 ? pairs : `(${pairs.length} pairs — omitted for brevity; re-run with --include-pairs)`,
    };
}

// ─── Report building ──────────────────────────────────────────────────────────

function buildCorrelationTable(dataPoints) {
    const allScoreDims = [...SCORE_DIMENSIONS, "pianoListenabilityScore"];
    const table = {};

    for (const scoreDim of allScoreDims) {
        table[scoreDim] = {};
        for (const fbDim of FEEDBACK_DIMENSIONS) {
            // Keep only rows where both values are non-null
            const pairs = dataPoints.filter(
                (p) => p[scoreDim] !== null && p[`fb_${fbDim}`] !== null,
            );
            const xs = pairs.map((p) => p[scoreDim]);
            const ys = pairs.map((p) => p[`fb_${fbDim}`]);

            table[scoreDim][fbDim] = {
                n: pairs.length,
                pearson: pairs.length >= 2 ? round4(pearson(xs, ys)) : null,
                spearman: pairs.length >= 3 ? round4(spearman(xs, ys)) : null,
            };
        }
    }

    return table;
}

function round4(v) {
    if (v === null || v === undefined) return null;
    return Math.round(v * 10000) / 10000;
}

/**
 * Highlights which score dimensions have the strongest (|r| > 0.5) and
 * weakest (|r| < 0.2) correlation with listener appeal.
 */
function buildSummary(correlationTable, minSamples) {
    const appealCorrelations = Object.entries(correlationTable)
        .map(([dim, feedbackMap]) => ({
            scoreDimension: dim,
            n: feedbackMap.appeal?.n ?? 0,
            pearsonAppeal: feedbackMap.appeal?.pearson ?? null,
            spearmanAppeal: feedbackMap.appeal?.spearman ?? null,
        }))
        .filter((r) => r.n >= minSamples && r.pearsonAppeal !== null)
        .sort((a, b) => Math.abs(b.pearsonAppeal ?? 0) - Math.abs(a.pearsonAppeal ?? 0));

    const strong = appealCorrelations.filter((r) => Math.abs(r.pearsonAppeal ?? 0) >= 0.5);
    const weak   = appealCorrelations.filter((r) => Math.abs(r.pearsonAppeal ?? 0) < 0.2);
    const mid    = appealCorrelations.filter(
        (r) => Math.abs(r.pearsonAppeal ?? 0) >= 0.2 && Math.abs(r.pearsonAppeal ?? 0) < 0.5,
    );

    return {
        primaryTarget: "appeal",
        note: "Pearson r with listener appeal. |r| >= 0.5 = strong signal; 0.2–0.5 = moderate; < 0.2 = weak/noise.",
        rankedByAppealCorrelation: appealCorrelations,
        strongSignal: strong.map((r) => r.scoreDimension),
        moderateSignal: mid.map((r) => r.scoreDimension),
        weakOrNoise: weak.map((r) => r.scoreDimension),
        calibrationRecommendations: buildRecommendations(strong, weak),
    };
}

function buildRecommendations(strong, weak) {
    const recs = [];
    if (strong.length === 0) {
        recs.push(
            "No score dimension shows strong correlation with appeal yet. " +
            "Collect more rated candidates (target n >= 10) before drawing conclusions.",
        );
    } else {
        for (const s of strong) {
            const dir = (s.pearsonAppeal ?? 0) > 0 ? "positively" : "negatively";
            recs.push(
                `"${s.scoreDimension}" correlates ${dir} with appeal ` +
                `(r=${s.pearsonAppeal}, n=${s.n}) — consider increasing its weight in advancedCraftScore.`,
            );
        }
    }
    for (const w of weak) {
        recs.push(
            `"${w.scoreDimension}" shows weak appeal correlation ` +
            `(r=${w.pearsonAppeal}, n=${w.n}) — may need recalibration or removal from advancedCraftScore.`,
        );
    }
    return recs;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const outputRoot  = (readOption("root") ?? process.env.OUTPUT_DIR ?? "outputs").trim() || "outputs";
const minSamples  = Math.max(1, parseInt(readOption("min-samples") ?? "3", 10) || 3);
const outFile     = readOption("out");
const writeCsv    = hasFlag("csv");

const songDirs = listSongDirs(outputRoot);
if (songDirs.length === 0) {
    fail(`No song directories found under "${outputRoot}".`);
}

// Walk every candidate in every song and collect data points
const dataPoints = [];
let candidatesScanned = 0;
let candidatesWithFeedback = 0;

for (const songDir of songDirs) {
    const index = loadCandidateIndex(songDir);
    if (!index) continue;

    const entries = Array.isArray(index.entries) ? index.entries : [];
    for (const entry of entries) {
        const manifest = loadCandidateManifest(songDir, entry.candidateId);
        if (!manifest) continue;
        candidatesScanned++;

        const point = extractDataPoint(manifest);
        if (point) {
            dataPoints.push(point);
            candidatesWithFeedback++;
        }
    }
}

if (dataPoints.length === 0) {
    const report = {
        ok: true,
        status: "no_feedback_data",
        message:
            `Scanned ${candidatesScanned} candidate(s) but found no listener feedback. ` +
            "Rate candidates with appeal/coherence scores to enable calibration analysis.",
        candidatesScanned,
        candidatesWithFeedback: 0,
    };
    if (outFile) {
        writeJsonFile(outFile, report);
        console.error(`Written to ${outFile}`);
    } else {
        console.log(JSON.stringify(report, null, 2));
    }
    process.exit(0);
}

if (dataPoints.length < minSamples) {
    console.error(
        `[warn] Only ${dataPoints.length} rated candidate(s) found (min-samples=${minSamples}). ` +
        "Correlations will be imprecise.",
    );
}

const correlationTable = buildCorrelationTable(dataPoints);
const summary          = buildSummary(correlationTable, minSamples);
const pairwiseAnalysis = buildPairwiseAnalysis(dataPoints);

const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    outputRoot,
    candidatesScanned,
    candidatesWithFeedback,
    minSamplesThreshold: minSamples,
    summary,
    pairwiseAnalysis,
    correlations: correlationTable,
    rawDataPoints: dataPoints,
};

if (outFile) {
    writeJsonFile(outFile, report);
    if (writeCsv) {
        const csvPath = outFile.replace(/\.json$/, "") + ".csv";
        const csvRows = dataPoints.map((p) => {
            const row = { songId: p.songId, candidateId: p.candidateId, selected: p.selected ?? "" };
            for (const d of [...SCORE_DIMENSIONS, "pianoListenabilityScore"]) row[d] = p[d] ?? "";
            for (const f of FEEDBACK_DIMENSIONS) row[`fb_${f}`] = p[`fb_${f}`] ?? "";
            row["preferredOver"]   = p.preferredOver   ?? "";
            row["rejectionReason"] = p.rejectionReason ?? "";
            return row;
        });
        writeCsvFile(csvPath, csvRows);
        console.error(`CSV written to ${csvPath}`);
    }
    console.error(`Report written to ${outFile}`);
} else {
    console.log(JSON.stringify(report, null, 2));
}
