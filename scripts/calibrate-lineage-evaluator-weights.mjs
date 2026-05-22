/**
 * calibrate-lineage-evaluator-weights.mjs
 *
 * Reads the output of validate-aesthetic-evaluators.mjs and proposes adjusted
 * weights for the lineageIdentityScore formula:
 *
 *   lineageIdentityScore = B_weight × beethovenianMotivicPressure
 *                        + S_weight × schubertianLyricExpansion
 *                        + M_weight × mediantColor
 *
 * Current weights (src/core/evaluate/axiomAestheticEvaluators.ts, lines 783–785):
 *   B = 0.55,  S = 0.25,  M = 0.20
 *
 * ── CALIBRATION METHOD ──────────────────────────────────────────────────────────
 *
 * 1. For each lineage component (Beethoven axis, Schubert lyric axis, Mediant color
 *    axis), locate its proxy ABC dimensions in the validation output and average
 *    their discriminationScore values.
 *
 * 2. Normalise the three averages so they sum to 1.0 → rawProposedWeights.
 *
 * 3. Blend with current weights (Bayesian-style smoothing):
 *      proposedWeight = BLEND_ALPHA × rawProposed + (1 − BLEND_ALPHA) × current
 *    Default BLEND_ALPHA = 0.40 (conservative: corpus < 50 → trust prior more).
 *    Pass --alpha=<n> to override.
 *
 * 4. Re-normalise blend to exactly 1.0 and round to 3 d.p.
 *
 * 5. Also suggests:
 *    • bothAxesPresent threshold adjustment (currently 0.35 in axiomAestheticEvaluators.ts)
 *    • sub-axis minimum thresholds for DPO hard negative gate
 *
 * ── COMPONENT → ABC DIMENSION MAPPING ─────────────────────────────────────────
 *
 * beethovenianMotivicPressure:
 *   pitchRangeSemitones   — wider range → Beethoven contrast
 *   phraseRegularity      — irregular phrasing → Beethoven tension
 *   harmonicRhythmProxy   — harmonic density (neutral but relevant)
 *
 * schubertianLyricExpansion:
 *   lyricExpansionScore   — singing melody span
 *   melodicContinuity     — stepwise motion continuity
 *   phraseBreath          — phrase rest spacing
 *   leapSmoothness        — leap approach/departure smoothness
 *   meanPhraseLengthMeasures — longer phrases → Schubert
 *
 * mediantColor:
 *   mediantModulationScore   — III/VI modulation presence
 *   harmonicColorDepth       — chromatic harmonic vocabulary
 *   majorMinorAmbiguityScore — mixture chord usage
 *
 * ── APPLY INSTRUCTIONS ──────────────────────────────────────────────────────────
 *
 * After reviewing the output, manually update:
 *   src/core/evaluate/axiomAestheticEvaluators.ts  lines 783–785  (weight constants)
 *   src/core/evaluate/axiomAestheticEvaluators.ts  line 791        (bothAxesPresent threshold)
 *
 * Sub-axis DPO thresholds live in:
 *   scripts/export-notagen-preference-dataset.mjs  THRESHOLDS object
 *   (--min-beethoven, --min-schubert, --min-mediant CLI options)
 *
 * Usage:
 *   node scripts/calibrate-lineage-evaluator-weights.mjs \
 *     [--validation=outputs/_system/reference-corpus/aesthetic-validation.json] \
 *     [--out=outputs/_system/reference-corpus/weight-calibration.json] \
 *     [--alpha=0.40] \
 *     [--verbose]
 */

import fs   from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function readOption(name) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length).trim() : undefined;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function parseFloat01(name, def) {
    const v = parseFloat(readOption(name) ?? String(def));
    if (!isFinite(v) || v < 0 || v > 1) {
        console.error(`[calibrate-lineage-evaluator-weights] --${name} must be a number in [0, 1], got: ${readOption(name)}`);
        process.exit(1);
    }
    return v;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const VALIDATION_PATH = readOption("validation")
    || "outputs/_system/reference-corpus/aesthetic-validation.json";

const OUT_PATH = readOption("out")
    || "outputs/_system/reference-corpus/weight-calibration.json";

const BLEND_ALPHA = parseFloat01("alpha", 0.40);
const VERBOSE     = hasFlag("verbose");

// Current formula weights (mirrors axiomAestheticEvaluators.ts lines 783–785)
const CURRENT_WEIGHTS = {
    beethovenianMotivicPressure: 0.55,
    schubertianLyricExpansion:   0.25,
    mediantColor:                0.20,
};

// Current bothAxesPresent threshold (mirrors axiomAestheticEvaluators.ts line 791)
const CURRENT_BOTH_AXES_THRESHOLD = 0.35;

// Current DPO sub-axis hard-negative thresholds (mirrors export-notagen-preference-dataset.mjs)
const CURRENT_SUBAXIS_THRESHOLDS = {
    beethovenianMotivicPressureScore: 0.30,
    schubertianLyricExpansionScore:   0.25,
    mediantColorScore:                0.20,
};

// Proxy ABC dimension mapping for each lineage component.
// Each entry: { dimension: string, direction: "higher_beethoven" | "higher_schubert" | "neutral" }
const COMPONENT_PROXIES = {
    beethovenianMotivicPressure: [
        { dimension: "pitchRangeSemitones",    direction: "higher_beethoven" },
        { dimension: "phraseRegularity",       direction: "higher_beethoven" },
        { dimension: "harmonicRhythmProxy",    direction: "neutral"          },
    ],
    schubertianLyricExpansion: [
        { dimension: "lyricExpansionScore",         direction: "higher_schubert" },
        { dimension: "melodicContinuity",           direction: "higher_schubert" },
        { dimension: "phraseBreath",                direction: "higher_schubert" },
        { dimension: "leapSmoothness",              direction: "higher_schubert" },
        { dimension: "meanPhraseLengthMeasures",    direction: "higher_schubert" },
    ],
    mediantColor: [
        { dimension: "mediantModulationScore",    direction: "higher_schubert" },
        { dimension: "harmonicColorDepth",        direction: "higher_schubert" },
        { dimension: "majorMinorAmbiguityScore",  direction: "higher_schubert" },
    ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round3(n) { return Math.round(n * 1000) / 1000; }
function round4(n) { return Math.round(n * 10000) / 10000; }

function normalise(obj) {
    const total = Object.values(obj).reduce((a, b) => a + b, 0);
    if (total === 0) return obj;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v / total]));
}

function buildDimMap(validationDimensions) {
    const map = {};
    for (const d of validationDimensions) {
        map[d.dimension] = d;
    }
    return map;
}

function suggest_both_axes_threshold(componentResults) {
    // If Beethoven proxy mean discrimination is notably high, the threshold is well-anchored.
    // If weak, recommend lowering so we don't over-filter Beethoven-heavy pieces.
    const bDisc = componentResults.beethovenianMotivicPressure.meanProxyDiscrimination;
    const sDisc = componentResults.schubertianLyricExpansion.meanProxyDiscrimination;
    const mDisc = componentResults.mediantColor.meanProxyDiscrimination;
    const schubertCombined = (sDisc + mDisc) / 2;

    if (bDisc >= 1.0 && schubertCombined >= 1.0) {
        return { suggested: 0.35, rationale: "Both axes discriminate strongly — keep current threshold." };
    }
    if (bDisc < 0.4) {
        return {
            suggested: 0.25,
            rationale: `Beethoven proxy discrimination is low (${round3(bDisc)}). Lowering bothAxesPresent ` +
                       `threshold to 0.25 prevents over-penalising valid Beethoven-leaning pieces.`,
        };
    }
    if (schubertCombined < 0.4) {
        return {
            suggested: 0.28,
            rationale: `Schubert/Mediant proxy discrimination is low (${round3(schubertCombined)}). ` +
                       `Minor relaxation of threshold recommended.`,
        };
    }
    return { suggested: 0.30, rationale: "Moderate discrimination — slight threshold relaxation recommended." };
}

function suggest_subaxis_thresholds(componentResults, dimMap) {
    const result = {};

    // Beethoven: use corpus Beethoven-group means of proxy dims as anchoring signal
    const bProxies = COMPONENT_PROXIES.beethovenianMotivicPressure
        .map((p) => dimMap[p.dimension])
        .filter(Boolean);
    const bMean = bProxies.length > 0
        ? bProxies.reduce((a, d) => a + (d.beethoven?.mean ?? 0), 0) / bProxies.length
        : null;
    // The sub-axis score maps to [0,1]; our proxy dims may be in different units.
    // Use mean proxy discrimination to decide whether to tighten/relax.
    const bDisc = componentResults.beethovenianMotivicPressure.meanProxyDiscrimination;
    result.beethovenianMotivicPressureScore = {
        current:   CURRENT_SUBAXIS_THRESHOLDS.beethovenianMotivicPressureScore,
        suggested: bDisc >= 1.0 ? 0.32 : bDisc < 0.4 ? 0.22 : 0.30,
        corpusBeethovenMean: bMean !== null ? round3(bMean) : null,
        rationale: bDisc >= 1.0
            ? "Strong Beethoven discrimination — can slightly raise hard-negative floor."
            : bDisc < 0.4
            ? "Weak proxy discrimination — lower hard-negative floor to avoid false exclusions."
            : "Moderate discrimination — keep current threshold.",
    };

    // Schubert lyric axis
    const sProxies = COMPONENT_PROXIES.schubertianLyricExpansion
        .map((p) => dimMap[p.dimension])
        .filter(Boolean);
    const sMean = sProxies.length > 0
        ? sProxies.reduce((a, d) => a + (d.schubert?.mean ?? 0), 0) / sProxies.length
        : null;
    const sDisc = componentResults.schubertianLyricExpansion.meanProxyDiscrimination;
    result.schubertianLyricExpansionScore = {
        current:   CURRENT_SUBAXIS_THRESHOLDS.schubertianLyricExpansionScore,
        suggested: sDisc >= 1.0 ? 0.28 : sDisc < 0.4 ? 0.18 : 0.25,
        corpusSchubertMean: sMean !== null ? round3(sMean) : null,
        rationale: sDisc >= 1.0
            ? "Strong Schubert lyric discrimination — can slightly raise hard-negative floor."
            : sDisc < 0.4
            ? "Weak proxy discrimination — lower hard-negative floor."
            : "Moderate discrimination — keep current threshold.",
    };

    // Mediant color axis
    const mProxies = COMPONENT_PROXIES.mediantColor
        .map((p) => dimMap[p.dimension])
        .filter(Boolean);
    const mMean = mProxies.length > 0
        ? mProxies.reduce((a, d) => a + (d.schubert?.mean ?? 0), 0) / mProxies.length
        : null;
    const mDisc = componentResults.mediantColor.meanProxyDiscrimination;
    result.mediantColorScore = {
        current:   CURRENT_SUBAXIS_THRESHOLDS.mediantColorScore,
        suggested: mDisc >= 1.0 ? 0.23 : mDisc < 0.4 ? 0.15 : 0.20,
        corpusSchubertMean: mMean !== null ? round3(mMean) : null,
        rationale: mDisc >= 1.0
            ? "Strong mediant color discrimination — can slightly raise hard-negative floor."
            : mDisc < 0.4
            ? "Weak proxy discrimination — lower hard-negative floor."
            : "Moderate discrimination — keep current threshold.",
    };

    return result;
}

// ---------------------------------------------------------------------------
// Main calibration
// ---------------------------------------------------------------------------

function calibrate(validationJson) {
    const dims   = validationJson.dimensions ?? [];
    const dimMap = buildDimMap(dims);
    const corpus = validationJson.corpus ?? {};
    const totalN = (corpus.beethoven?.count ?? 0) + (corpus.schubert?.count ?? 0);

    const corpusSizeWarning = totalN < 50
        ? `Corpus is small (n=${totalN}). Using conservative blend alpha=${BLEND_ALPHA}. ` +
          `Increase corpus to 100+ pieces before raising alpha above 0.50.`
        : totalN < 100
        ? `Corpus is moderate (n=${totalN}). Calibration signal is reasonable but not yet stable.`
        : null;

    // ── Step 1: per-component proxy discrimination averages ─────────────────
    const componentResults = {};

    for (const [component, proxies] of Object.entries(COMPONENT_PROXIES)) {
        const proxyResults = proxies.map((p) => {
            const d = dimMap[p.dimension];
            return {
                dimension:         p.dimension,
                direction:         p.direction,
                discriminationScore: d?.discriminationScore ?? null,
                found:             d !== undefined,
                beethoven:         d?.beethoven ?? null,
                schubert:          d?.schubert  ?? null,
            };
        });

        const found = proxyResults.filter((r) => r.found && r.discriminationScore !== null);
        const meanDisc = found.length > 0
            ? found.reduce((s, r) => s + r.discriminationScore, 0) / found.length
            : 0;

        componentResults[component] = {
            label:                  component,
            currentWeight:          CURRENT_WEIGHTS[component],
            meanProxyDiscrimination: round4(meanDisc),
            proxyResultCount:       `${found.length}/${proxies.length}`,
            proxyResults,
        };

        if (VERBOSE) {
            console.log(`\n[${component}]  mean_disc=${round4(meanDisc)}  found=${found.length}/${proxies.length}`);
            for (const r of proxyResults) {
                if (r.found) {
                    console.log(`  ${r.dimension.padEnd(28)} disc=${r.discriminationScore?.toFixed(4)}  b.mean=${r.beethoven?.mean?.toFixed(3)}  s.mean=${r.schubert?.mean?.toFixed(3)}`);
                } else {
                    console.log(`  ${r.dimension.padEnd(28)} NOT FOUND in validation output`);
                }
            }
        }
    }

    // ── Step 2: normalise → rawProposed ─────────────────────────────────────
    const rawDiscriminationByComponent = Object.fromEntries(
        Object.entries(componentResults).map(([k, v]) => [k, v.meanProxyDiscrimination])
    );
    const normalisedRaw = normalise(rawDiscriminationByComponent);

    // ── Step 3: blend with current weights ──────────────────────────────────
    const blended = {};
    for (const k of Object.keys(CURRENT_WEIGHTS)) {
        blended[k] = BLEND_ALPHA * (normalisedRaw[k] ?? 0) + (1 - BLEND_ALPHA) * CURRENT_WEIGHTS[k];
    }

    // ── Step 4: re-normalise and round ──────────────────────────────────────
    const normBlended = normalise(blended);
    const proposedWeights = Object.fromEntries(
        Object.entries(normBlended).map(([k, v]) => [k, round3(v)])
    );

    // Guarantee they sum to exactly 1.0 by adjusting the largest
    const wSum = Object.values(proposedWeights).reduce((a, b) => a + b, 0);
    const drift = round3(1.0 - wSum);
    if (Math.abs(drift) > 0) {
        const largest = Object.entries(proposedWeights).reduce((a, b) => a[1] >= b[1] ? a : b)[0];
        proposedWeights[largest] = round3(proposedWeights[largest] + drift);
    }

    // ── Step 5: supplementary suggestions ───────────────────────────────────
    const bothAxesSuggestion  = suggest_both_axes_threshold(componentResults);
    const subAxisSuggestions  = suggest_subaxis_thresholds(componentResults, dimMap);

    // ── Step 6: assemble results ─────────────────────────────────────────────
    const weightChanged = Object.keys(CURRENT_WEIGHTS).some(
        (k) => proposedWeights[k] !== CURRENT_WEIGHTS[k]
    );

    const currentFormula = Object.entries(CURRENT_WEIGHTS)
        .map(([k, v]) => `${v} × ${k}`)
        .join(" + ");
    const proposedFormula = Object.entries(proposedWeights)
        .map(([k, v]) => `${v} × ${k}`)
        .join(" + ");

    const result = {
        generatedAt:   new Date().toISOString(),
        validationFile: VALIDATION_PATH,
        corpusSizes: {
            beethoven: corpus.beethoven?.count ?? 0,
            schubert:  corpus.schubert?.count  ?? 0,
            total:     totalN,
        },
        blendAlpha:    BLEND_ALPHA,
        corpusSizeWarning,
        weightChanged,
        currentFormula,
        proposedFormula,
        currentWeights:  { ...CURRENT_WEIGHTS },
        proposedWeights: { ...proposedWeights },
        components:  Object.fromEntries(
            Object.entries(componentResults).map(([k, v]) => [k, {
                ...v,
                rawNormalisedDiscrimination: round4(normalisedRaw[k] ?? 0),
                blendedPreNorm:              round4(blended[k] ?? 0),
                proposedWeight:              proposedWeights[k],
            }])
        ),
        bothAxesPresentThreshold: {
            current:   CURRENT_BOTH_AXES_THRESHOLD,
            suggested: bothAxesSuggestion.suggested,
            rationale: bothAxesSuggestion.rationale,
            applyAt:   "src/core/evaluate/axiomAestheticEvaluators.ts line 791",
        },
        subAxisHardNegativeThresholds: Object.fromEntries(
            Object.entries(subAxisSuggestions).map(([k, v]) => [k, {
                ...v,
                applyAt: "scripts/export-notagen-preference-dataset.mjs THRESHOLDS object (--min-beethoven / --min-schubert / --min-mediant)",
            }])
        ),
        applyInstructions: [
            "1. Review proposedWeights above.",
            `2. Update src/core/evaluate/axiomAestheticEvaluators.ts lines 783–785:`,
            `     ${proposedFormula}`,
            `3. Optionally update bothAxesPresent threshold (line 791) to ${bothAxesSuggestion.suggested}.`,
            `4. Optionally adjust DPO hard-negative thresholds via --min-beethoven / --min-schubert / --min-mediant.`,
            "5. Re-run validate-aesthetic-evaluators after corpus expansion before re-calibrating.",
        ],
    };

    return result;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
    if (!fs.existsSync(VALIDATION_PATH)) {
        console.error(
            `[calibrate-lineage-evaluator-weights] Validation file not found: ${VALIDATION_PATH}\n` +
            `  Run: npm run validate:aesthetic-evaluators  first.`
        );
        process.exit(1);
    }

    let validationJson;
    try {
        validationJson = JSON.parse(fs.readFileSync(VALIDATION_PATH, "utf-8"));
    } catch (err) {
        console.error(`[calibrate-lineage-evaluator-weights] Failed to parse validation JSON: ${err.message}`);
        process.exit(1);
    }

    if (!Array.isArray(validationJson.dimensions) || validationJson.dimensions.length === 0) {
        console.error("[calibrate-lineage-evaluator-weights] Validation output has no dimensions array. Run validate-aesthetic-evaluators first.");
        process.exit(1);
    }

    const result = calibrate(validationJson);

    // Console summary
    console.log("=== Lineage Evaluator Weight Calibration ===");
    console.log(`  Validation file:   ${VALIDATION_PATH}`);
    console.log(`  Corpus:            Beethoven n=${result.corpusSizes.beethoven}, Schubert n=${result.corpusSizes.schubert}`);
    console.log(`  Blend alpha:       ${BLEND_ALPHA}`);
    if (result.corpusSizeWarning) {
        console.warn(`  ⚠  ${result.corpusSizeWarning}`);
    }
    console.log(`\n  Current formula:   ${result.currentFormula}`);
    console.log(`  Proposed formula:  ${result.proposedFormula}`);
    if (!result.weightChanged) {
        console.log("  (No weight change — current weights already aligned with corpus discrimination.)");
    }
    console.log(`\n  bothAxesPresent:   current=${result.bothAxesPresentThreshold.current}`
              + `  → suggested=${result.bothAxesPresentThreshold.suggested}`);
    console.log(`  Rationale: ${result.bothAxesPresentThreshold.rationale}`);
    console.log("\n  Sub-axis DPO hard-negative threshold suggestions:");
    for (const [k, v] of Object.entries(result.subAxisHardNegativeThresholds)) {
        const delta = round3(v.suggested - v.current);
        const sign  = delta > 0 ? "+" : "";
        console.log(`    ${k.padEnd(36)} ${v.current} → ${v.suggested}  (${sign}${delta})`);
    }
    console.log("\n  Apply instructions:");
    for (const line of result.applyInstructions) console.log(`    ${line}`);

    if (!readOption("out") && !hasFlag("dry-run")) {
        // Write output
        const outDir = path.dirname(OUT_PATH);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), "utf-8");
        console.log(`\nWrote calibration report → ${OUT_PATH}`);
    } else if (hasFlag("dry-run")) {
        console.log("\n[dry-run] No file written.");
        console.log(JSON.stringify(result, null, 2));
    } else {
        const outDir = path.dirname(OUT_PATH);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), "utf-8");
        console.log(`\nWrote calibration report → ${OUT_PATH}`);
    }
}

main();
