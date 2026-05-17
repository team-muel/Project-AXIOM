/**
 * scoringProfile.ts
 *
 * Typed scoring profile definitions and built-in defaults for the craft
 * evaluators.  A profile is a named, versioned set of dimension weights that
 * controls how `computeCraftScoreSummary` and `computePianoListenabilityScore`
 * blend their sub-scores into a single composite number.
 *
 * Profiles live as JSON files under `config/scoring-profiles/`.  The built-in
 * TypeScript constants below mirror the v1 JSON files so the evaluators always
 * have a zero-dependency fallback — the JSON files are the authoritative source
 * for external tooling and experiment tracking.
 *
 * Usage (override):
 *   import { loadScoringProfile } from "./scoringProfile.js";
 *   const myProfile = loadScoringProfile<CraftScoringWeights>("path/to/custom.json");
 *   computeCraftScoreSummary(artifacts, plan, evaluation, myProfile);
 */

import fs from "node:fs";

// ─── Status ──────────────────────────────────────────────────────────────────

export type ScoringProfileStatus = "experimental" | "stable" | "deprecated";

// ─── Generic profile shell ────────────────────────────────────────────────────

export interface ScoringProfile<W extends Record<string, number>> {
    /** Unique, versioned identifier (e.g. "classical_default_v1"). */
    profile: string;
    /** Lifecycle status — callers may warn on "deprecated". */
    status: ScoringProfileStatus;
    /** Human-readable description of the profile intent. */
    description?: string;
    /** Dimension weights; must sum to 1.00 (±0.005 tolerance). */
    weights: W;
}

// ─── Craft scoring (finalCraftScore) ─────────────────────────────────────────

export interface CraftScoringWeights {
    [key: string]: number;
    sectionContractFit:   number;
    cadenceStrength:      number;
    tonalReturn:          number;
    motifSurvival:        number;
    voiceIndependence:    number;
    phraseShape:          number;
    registerIdiomaticFit: number;
    syntaxValidity:       number;
}

export type CraftScoringProfile = ScoringProfile<CraftScoringWeights>;

/** Built-in default — mirrors `config/scoring-profiles/classical_default_v1.json`. */
export const CLASSICAL_DEFAULT_V1: CraftScoringProfile = {
    profile: "classical_default_v1",
    status: "experimental",
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
};

// ─── Piano listenability scoring ──────────────────────────────────────────────

export interface PianoListenabilityWeights {
    [key: string]: number;
    melodyProminence:         number;
    bassRootSupport:          number;
    accompanimentConsistency: number;
    registerSpacing:          number;
    phraseLevelVoicing:       number;
    pedalBlurRisk:            number;
    textureFormCoherence:     number;
}

export type PianoListenabilityScoringProfile = ScoringProfile<PianoListenabilityWeights>;

/** Built-in default — mirrors `config/scoring-profiles/piano_listenability_v1.json`. */
export const PIANO_LISTENABILITY_V1: PianoListenabilityScoringProfile = {
    profile: "piano_listenability_v1",
    status: "experimental",
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
};

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates that all weights in a profile sum to 1.00 within ±0.005 tolerance.
 * Throws if invalid.
 */
export function validateProfileWeights<W extends Record<string, number>>(
    profile: ScoringProfile<W>,
): void {
    const sum = Object.values(profile.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.005) {
        throw new Error(
            `Scoring profile "${profile.profile}" weights sum to ${sum.toFixed(4)}, expected 1.00 (±0.005)`,
        );
    }
}

// ─── File loader ──────────────────────────────────────────────────────────────

/**
 * Loads and validates a scoring profile from a JSON file on disk.
 * Throws on missing file, parse error, or invalid weights sum.
 *
 * @param filePath  Absolute or cwd-relative path to the profile JSON.
 */
export function loadScoringProfile<W extends Record<string, number>>(
    filePath: string,
): ScoringProfile<W> {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ScoringProfile<W>;
    if (!parsed.profile || typeof parsed.weights !== "object") {
        throw new Error(`Invalid scoring profile at "${filePath}": missing "profile" or "weights" field`);
    }
    validateProfileWeights(parsed);
    return parsed;
}
