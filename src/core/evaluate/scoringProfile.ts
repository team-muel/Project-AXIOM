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
import path from "node:path";

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

// ─── Piano craft scoring profile ─────────────────────────────────────────────
//
// Covers the 9 playability/craft dimensions that compose finalPianoScore.
// Separate from listenability: this is the gate-lane profile (playable first),
// listenability is the ranking-lane profile (appealing second).

export interface PianoCraftWeights {
    [key: string]: number;
    handPlayability:               number;
    melodicClarity:                number;
    bassCoherence:                 number;
    voicingIdiomaticFit:           number;
    accompanimentPatternCoherence: number;
    registerSpacing:               number;
    handIndependence:              number;
    pedalPlausibility:             number;
    difficultyFit:                 number;
}

export type PianoCraftScoringProfile = ScoringProfile<PianoCraftWeights>;

/** Built-in default — mirrors `config/scoring-profiles/piano_craft_v1.json`. */
export const PIANO_CRAFT_V1: PianoCraftScoringProfile = {
    profile: "piano_craft_v1",
    status: "experimental",
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

// ─── Quality gate config ──────────────────────────────────────────────────────

/**
 * Per-dimension minimum thresholds used as candidate quality gates.
 * Unlike scoring weights these do NOT sum to 1 — each is an independent floor.
 *
 * Naming convention: `<dimension>Min` to distinguish from score-weight keys.
 *
 * Gate 1 (validity):   syntaxValidityMin
 * Gate 2 (contract):   sectionContractFitMin
 * Gate 3 generic:      cadenceStrengthMin, registerIdiomaticFitMin, voiceIndependenceMin
 * Gate 3 piano:        handPlayabilityMin, finalPianoScoreMin
 * Preference filter:   finalCraftScoreMin
 * Playability gate:    pianoPlayabilityMin
 */
export interface QualityGateThresholds {
    [key: string]: number | undefined;
    // ── Gate 1 ───────────────────────────────────────────────────────────────
    /** Minimum syntaxValidity score for a candidate to pass the validity gate. */
    syntaxValidityMin: number;
    // ── Gate 2 ───────────────────────────────────────────────────────────────
    /** Minimum sectionContractFit score. */
    sectionContractFitMin: number;
    // ── Gate 3 generic ───────────────────────────────────────────────────────
    /** Minimum cadenceStrength for the generic musical-craft gate. */
    cadenceStrengthMin?: number;
    /** Minimum registerIdiomaticFit for the generic musical-craft gate. */
    registerIdiomaticFitMin?: number;
    /** Minimum voiceIndependence for the generic musical-craft gate. */
    voiceIndependenceMin?: number;
    // ── Gate 3 piano ─────────────────────────────────────────────────────────
    /** Minimum handPlayability for the piano craft gate (different from pianoPlayabilityMin). */
    handPlayabilityMin?: number;
    /** Minimum finalPianoScore for the piano craft gate. */
    finalPianoScoreMin?: number;
    // ── Preference hard filter ────────────────────────────────────────────────
    /** Minimum finalCraftScore for the overall preference filter. */
    finalCraftScoreMin: number;
    // ── Piano playability gate (pianoPlayabilityGate) ────────────────────────
    /** Minimum pianoPlayabilityScore — applied by pianoPlayabilityGate(). */
    pianoPlayabilityMin: number;
}

/**
 * Versioned quality gate configuration.
 * Uses `thresholds` (not `weights`) to avoid confusion with scoring profiles.
 */
export interface QualityGateConfig {
    /** Unique, versioned identifier (e.g. "quality_gate_v1"). */
    profile: string;
    /** Lifecycle status. */
    status: ScoringProfileStatus;
    /** Human-readable description. */
    description?: string;
    /** Per-dimension minimum thresholds. */
    thresholds: QualityGateThresholds;
}

/** Built-in default — mirrors `config/scoring-profiles/quality_gate_v1.json`. */
export const QUALITY_GATE_V1: QualityGateConfig = {
    profile: "quality_gate_v1",
    status: "experimental",
    description: "Default quality gate thresholds for candidate filtering.",
    thresholds: {
        // Gate 1 — validity
        syntaxValidityMin:      0.90,
        // Gate 2 — contract
        sectionContractFitMin:  0.75,
        // Gate 3 generic — musical craft
        cadenceStrengthMin:     0.55,
        registerIdiomaticFitMin: 0.75,
        voiceIndependenceMin:   0.35,
        // Gate 3 piano — playability
        handPlayabilityMin:     0.55,
        finalPianoScoreMin:     0.50,
        // Preference hard filter
        finalCraftScoreMin:     0.65,
        // Piano playability gate (pianoPlayabilityGate)
        pianoPlayabilityMin:    0.50,
    },
};

/**
 * Validates that all present threshold values in a QualityGateConfig are in [0, 1].
 * Undefined/optional fields are skipped. Throws if any present value is out of range.
 */
export function validateQualityGateConfig(config: QualityGateConfig): void {
    for (const [key, value] of Object.entries(config.thresholds)) {
        if (value === undefined) continue;
        if (value < 0 || value > 1) {
            throw new Error(
                `QualityGateConfig "${config.profile}": threshold "${key}" = ${value} is out of [0, 1]`,
            );
        }
    }
}

/**
 * Loads and validates a quality gate config from a JSON file on disk.
 * Throws on missing file, parse error, or invalid threshold values.
 */
export function loadQualityGateConfig(filePath: string): QualityGateConfig {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as QualityGateConfig;
    if (!parsed.profile || typeof parsed.thresholds !== "object") {
        throw new Error(
            `Invalid quality gate config at "${filePath}": missing "profile" or "thresholds" field`,
        );
    }
    validateQualityGateConfig(parsed);
    return parsed;
}

// ─── Candidate scoring profile record ────────────────────────────────────────

/**
 * Profiles used when evaluating and selecting a specific candidate.
 * Stored in candidate manifests so any selection decision can be reproduced.
 */
export interface CandidateScoringProfiles {
    /** finalCraftScore weight profile name (e.g. "classical_default_v1"). */
    scoringProfile?: string;
    /** pianoListenabilityScore weight profile name (e.g. "piano_listenability_v1"). */
    pianoProfile?: string;
    /** finalPianoScore craft weight profile name (e.g. "piano_craft_v1"). */
    pianoCraftProfile?: string;
    /** Quality gate threshold profile name (e.g. "quality_gate_v1"). */
    qualityGateProfile?: string;
}

// ─── Built-in profile resolvers ──────────────────────────────────────────────

/**
 * Resolves a craft scoring profile by name.
 *
 * Lookup order:
 *   1. Built-in constants (no I/O)
 *   2. In-memory cache (from a prior disk load)
 *   3. config/scoring-profiles/{name}.json (loaded, validated, cached)
 *   4. CLASSICAL_DEFAULT_V1 fallback (silent)
 *
 * When `name` is undefined, the AXIOM_SCORING_PROFILE env var is used.
 * If neither is set, CLASSICAL_DEFAULT_V1 is returned.
 */
export function resolveCraftScoringProfile(name?: string): CraftScoringProfile {
    const effectiveName = name ?? process.env.AXIOM_SCORING_PROFILE;
    if (!effectiveName) return CLASSICAL_DEFAULT_V1;
    if (effectiveName === CLASSICAL_DEFAULT_V1.profile) return CLASSICAL_DEFAULT_V1;
    return tryLoadCraftProfileFromDisk(effectiveName) ?? CLASSICAL_DEFAULT_V1;
}

/**
 * Resolves a piano listenability profile by name.
 *
 * Lookup order: built-in → cache → disk → PIANO_LISTENABILITY_V1 fallback.
 * When `name` is undefined, AXIOM_PIANO_PROFILE env var is used.
 */
export function resolvePianoListenabilityScoringProfile(
    name?: string,
): PianoListenabilityScoringProfile {
    const effectiveName = name ?? process.env.AXIOM_PIANO_PROFILE;
    if (!effectiveName) return PIANO_LISTENABILITY_V1;
    if (effectiveName === PIANO_LISTENABILITY_V1.profile) return PIANO_LISTENABILITY_V1;
    return tryLoadPianoProfileFromDisk(effectiveName) ?? PIANO_LISTENABILITY_V1;
}

/**
 * Resolves a piano craft profile by name.
 *
 * Lookup order: built-in → cache → disk → PIANO_CRAFT_V1 fallback.
 * When `name` is undefined, AXIOM_PIANO_CRAFT_PROFILE env var is used.
 */
export function resolvePianoCraftScoringProfile(
    name?: string,
): PianoCraftScoringProfile {
    const effectiveName = name ?? process.env.AXIOM_PIANO_CRAFT_PROFILE;
    if (!effectiveName) return PIANO_CRAFT_V1;
    if (effectiveName === PIANO_CRAFT_V1.profile) return PIANO_CRAFT_V1;
    return tryLoadPianoCraftProfileFromDisk(effectiveName) ?? PIANO_CRAFT_V1;
}

/**
 * Resolves a quality gate config by name.
 *
 * Lookup order: built-in → cache → disk → QUALITY_GATE_V1 fallback.
 * When `name` is undefined, AXIOM_GATE_PROFILE env var is used.
 */
export function resolveQualityGateConfig(name?: string): QualityGateConfig {
    const effectiveName = name ?? process.env.AXIOM_GATE_PROFILE;
    if (!effectiveName) return QUALITY_GATE_V1;
    if (effectiveName === QUALITY_GATE_V1.profile) return QUALITY_GATE_V1;
    return tryLoadGateConfigFromDisk(effectiveName) ?? QUALITY_GATE_V1;
}

// ─── Default candidate profiles ───────────────────────────────────────────────

/**
 * Default scoring profiles applied when an execution plan does not specify
 * any custom profiles.  These mirror the v1 built-in constants.
 */
export const DEFAULT_CANDIDATE_SCORING_PROFILES: CandidateScoringProfiles = {
    scoringProfile:     CLASSICAL_DEFAULT_V1.profile,
    pianoProfile:       PIANO_LISTENABILITY_V1.profile,
    pianoCraftProfile:  PIANO_CRAFT_V1.profile,
    qualityGateProfile: QUALITY_GATE_V1.profile,
} as const;

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

// ─── Profile registry ─────────────────────────────────────────────────────────
//
// Extends built-in constants with file-based loading from the profile directory.
//
// Lookup order for every resolver:
//   1. Built-in constants (no I/O — always available; returned directly)
//   2. In-memory cache (populated on first successful disk load)
//   3. config/scoring-profiles/{name}.json (validated on load, then cached)
//   4. Default built-in fallback (silent — never throws)
//
// Environment variables:
//   AXIOM_SCORING_PROFILES_DIR  — override profile directory (default: config/scoring-profiles/)
//   AXIOM_SCORING_PROFILE       — default craft profile name when none is specified
//   AXIOM_PIANO_PROFILE         — default piano listenability profile name
//   AXIOM_PIANO_CRAFT_PROFILE   — default piano craft profile name
//   AXIOM_GATE_PROFILE          — default quality gate profile name

function resolveProfileDir(): string {
    return process.env.AXIOM_SCORING_PROFILES_DIR
        ?? path.join(process.cwd(), "config", "scoring-profiles");
}

const craftProfileCache   = new Map<string, CraftScoringProfile>();
const pianoProfileCache   = new Map<string, PianoListenabilityScoringProfile>();
const pianoCraftCache     = new Map<string, PianoCraftScoringProfile>();
const gateConfigCache     = new Map<string, QualityGateConfig>();

/**
 * Clears all in-memory profile caches.
 * Intended for tests and hot-reload scenarios where profile files may change.
 */
export function clearProfileRegistry(): void {
    craftProfileCache.clear();
    pianoProfileCache.clear();
    pianoCraftCache.clear();
    gateConfigCache.clear();
}

function tryLoadCraftProfileFromDisk(name: string): CraftScoringProfile | undefined {
    const cached = craftProfileCache.get(name);
    if (cached) return cached;
    try {
        const filePath = path.join(resolveProfileDir(), `${name}.json`);
        const loaded = loadScoringProfile<CraftScoringWeights>(filePath);
        const profile = loaded as CraftScoringProfile;
        craftProfileCache.set(name, profile);
        return profile;
    } catch {
        return undefined;
    }
}

function tryLoadPianoProfileFromDisk(name: string): PianoListenabilityScoringProfile | undefined {
    const cached = pianoProfileCache.get(name);
    if (cached) return cached;
    try {
        const filePath = path.join(resolveProfileDir(), `${name}.json`);
        const loaded = loadScoringProfile<PianoListenabilityWeights>(filePath);
        const profile = loaded as PianoListenabilityScoringProfile;
        pianoProfileCache.set(name, profile);
        return profile;
    } catch {
        return undefined;
    }
}

function tryLoadPianoCraftProfileFromDisk(name: string): PianoCraftScoringProfile | undefined {
    const cached = pianoCraftCache.get(name);
    if (cached) return cached;
    try {
        const filePath = path.join(resolveProfileDir(), `${name}.json`);
        const loaded = loadScoringProfile<PianoCraftWeights>(filePath);
        const profile = loaded as PianoCraftScoringProfile;
        pianoCraftCache.set(name, profile);
        return profile;
    } catch {
        return undefined;
    }
}

function tryLoadGateConfigFromDisk(name: string): QualityGateConfig | undefined {
    const cached = gateConfigCache.get(name);
    if (cached) return cached;
    try {
        const filePath = path.join(resolveProfileDir(), `${name}.json`);
        const config = loadQualityGateConfig(filePath);
        gateConfigCache.set(name, config);
        return config;
    } catch {
        return undefined;
    }
}
