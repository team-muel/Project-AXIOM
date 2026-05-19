/**
 * scoring-profile-registry.test.mjs
 *
 * Tests for the profile registry extension in scoringProfile.ts:
 *   built-in constant resolution, disk-based profile loading,
 *   in-memory cache, env-var defaults, and fallback behaviour.
 *
 * SPR-01: resolveCraftScoringProfile("classical_default_v1") → returns built-in constant
 * SPR-02: resolveCraftScoringProfile("classical_default_v2") → loads from disk JSON
 * SPR-03: AXIOM_SCORING_PROFILE env var → resolveCraftScoringProfile(undefined) uses env
 * SPR-04: AXIOM_PIANO_PROFILE env var → resolvePianoListenabilityScoringProfile(undefined)
 * SPR-05: AXIOM_GATE_PROFILE env var → resolveQualityGateConfig(undefined)
 * SPR-06: AXIOM_PIANO_CRAFT_PROFILE env var → resolvePianoCraftScoringProfile(undefined)
 * SPR-07: unknown profile name → silent fallback to default (regression guard for SP-18)
 * SPR-08: clearProfileRegistry() resets cache so disk is re-read on next call
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

import {
    CLASSICAL_DEFAULT_V1,
    PIANO_LISTENABILITY_V1,
    PIANO_CRAFT_V1,
    QUALITY_GATE_V1,
    resolveCraftScoringProfile,
    resolvePianoListenabilityScoringProfile,
    resolvePianoCraftScoringProfile,
    resolveQualityGateConfig,
    clearProfileRegistry,
} from "../dist/core/evaluate/scoringProfile.js";

// ─── SPR-01: built-in constant by explicit name ───────────────────────────────

test("SPR-01: resolveCraftScoringProfile('classical_default_v1') returns built-in", () => {
    const profile = resolveCraftScoringProfile("classical_default_v1");
    assert.strictEqual(profile.profile, "classical_default_v1");
    assert.deepStrictEqual(profile.weights, CLASSICAL_DEFAULT_V1.weights);
    // Must be the exact same object (no copy)
    assert.strictEqual(profile, CLASSICAL_DEFAULT_V1);
});

// ─── SPR-02: disk load for a JSON-only profile ────────────────────────────────

test("SPR-02: resolveCraftScoringProfile('classical_default_v2') loads from disk JSON", () => {
    clearProfileRegistry();
    const profile = resolveCraftScoringProfile("classical_default_v2");
    assert.strictEqual(profile.profile, "classical_default_v2");

    // Weights must sum to 1.00 (±0.005)
    const sum = Object.values(profile.weights).reduce((a, b) => a + b, 0);
    assert.ok(
        Math.abs(sum - 1.0) <= 0.005,
        `classical_default_v2 weights sum to ${sum.toFixed(4)}, expected 1.00`,
    );

    // Must differ from v1 (different weights)
    assert.notDeepStrictEqual(profile.weights, CLASSICAL_DEFAULT_V1.weights);
});

// ─── SPR-03: AXIOM_SCORING_PROFILE env var ────────────────────────────────────

test("SPR-03: AXIOM_SCORING_PROFILE env var is used when name is undefined", () => {
    const prev = process.env.AXIOM_SCORING_PROFILE;
    try {
        process.env.AXIOM_SCORING_PROFILE = "classical_default_v2";
        const profile = resolveCraftScoringProfile(undefined);
        assert.strictEqual(profile.profile, "classical_default_v2");
    } finally {
        if (prev === undefined) delete process.env.AXIOM_SCORING_PROFILE;
        else process.env.AXIOM_SCORING_PROFILE = prev;
    }
});

// Explicit name must take priority over env var
test("SPR-03b: explicit name takes priority over AXIOM_SCORING_PROFILE env var", () => {
    const prev = process.env.AXIOM_SCORING_PROFILE;
    try {
        process.env.AXIOM_SCORING_PROFILE = "classical_default_v2";
        const profile = resolveCraftScoringProfile("classical_default_v1");
        assert.strictEqual(profile.profile, "classical_default_v1",
            "Explicit name must override env var");
    } finally {
        if (prev === undefined) delete process.env.AXIOM_SCORING_PROFILE;
        else process.env.AXIOM_SCORING_PROFILE = prev;
    }
});

// ─── SPR-04: AXIOM_PIANO_PROFILE env var ──────────────────────────────────────

test("SPR-04: AXIOM_PIANO_PROFILE env var is used for piano listenability resolver", () => {
    const prev = process.env.AXIOM_PIANO_PROFILE;
    try {
        process.env.AXIOM_PIANO_PROFILE = "piano_listenability_v1";
        const profile = resolvePianoListenabilityScoringProfile(undefined);
        assert.strictEqual(profile.profile, "piano_listenability_v1");
        assert.deepStrictEqual(profile.weights, PIANO_LISTENABILITY_V1.weights);
    } finally {
        if (prev === undefined) delete process.env.AXIOM_PIANO_PROFILE;
        else process.env.AXIOM_PIANO_PROFILE = prev;
    }
});

// ─── SPR-05: AXIOM_GATE_PROFILE env var ───────────────────────────────────────

test("SPR-05: AXIOM_GATE_PROFILE env var is used for quality gate resolver", () => {
    const prev = process.env.AXIOM_GATE_PROFILE;
    try {
        process.env.AXIOM_GATE_PROFILE = "quality_gate_v1";
        const config = resolveQualityGateConfig(undefined);
        assert.strictEqual(config.profile, "quality_gate_v1");
        assert.deepStrictEqual(config.thresholds, QUALITY_GATE_V1.thresholds);
    } finally {
        if (prev === undefined) delete process.env.AXIOM_GATE_PROFILE;
        else process.env.AXIOM_GATE_PROFILE = prev;
    }
});

// ─── SPR-06: AXIOM_PIANO_CRAFT_PROFILE env var ───────────────────────────────

test("SPR-06: AXIOM_PIANO_CRAFT_PROFILE env var is used for piano craft resolver", () => {
    const prev = process.env.AXIOM_PIANO_CRAFT_PROFILE;
    try {
        process.env.AXIOM_PIANO_CRAFT_PROFILE = "piano_craft_v1";
        const profile = resolvePianoCraftScoringProfile(undefined);
        assert.strictEqual(profile.profile, "piano_craft_v1");
        assert.deepStrictEqual(profile.weights, PIANO_CRAFT_V1.weights);
    } finally {
        if (prev === undefined) delete process.env.AXIOM_PIANO_CRAFT_PROFILE;
        else process.env.AXIOM_PIANO_CRAFT_PROFILE = prev;
    }
});

// ─── SPR-07: unknown profile → silent fallback ───────────────────────────────
// Regression guard: SP-18 already tests this, but we keep the contract here too.

test("SPR-07: unknown profile name falls back silently to built-in default", () => {
    clearProfileRegistry();
    const craft  = resolveCraftScoringProfile("totally_unknown_profile_xyz_v99");
    const piano  = resolvePianoListenabilityScoringProfile("totally_unknown_v99");
    const gate   = resolveQualityGateConfig("totally_unknown_gate_v99");
    const pianoCraft = resolvePianoCraftScoringProfile("totally_unknown_craft_v99");

    assert.strictEqual(craft.profile, "classical_default_v1");
    assert.strictEqual(piano.profile, "piano_listenability_v1");
    assert.strictEqual(gate.profile, "quality_gate_v1");
    assert.strictEqual(pianoCraft.profile, "piano_craft_v1");
});

// ─── SPR-08: clearProfileRegistry() resets cache ─────────────────────────────

test("SPR-08: clearProfileRegistry() allows re-loading an updated profile from disk", () => {
    // Write a temporary custom profile to a temp dir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-profile-test-"));
    const profileName = "custom_test_craft_v1";
    const v1Weights = {
        sectionContractFit: 0.15, cadenceStrength: 0.15, tonalReturn: 0.15,
        motifSurvival: 0.15, voiceIndependence: 0.15, phraseShape: 0.10,
        registerIdiomaticFit: 0.10, syntaxValidity: 0.05,
    };
    const v2Weights = {
        sectionContractFit: 0.10, cadenceStrength: 0.25, tonalReturn: 0.20,
        motifSurvival: 0.15, voiceIndependence: 0.10, phraseShape: 0.10,
        registerIdiomaticFit: 0.07, syntaxValidity: 0.03,
    };

    const profilePath = path.join(tmpDir, `${profileName}.json`);
    const prevDir = process.env.AXIOM_SCORING_PROFILES_DIR;

    try {
        // Write v1 and load
        fs.writeFileSync(profilePath, JSON.stringify({
            profile: profileName, status: "experimental", weights: v1Weights,
        }), "utf-8");

        process.env.AXIOM_SCORING_PROFILES_DIR = tmpDir;
        clearProfileRegistry();

        const first = resolveCraftScoringProfile(profileName);
        assert.deepStrictEqual(first.weights, v1Weights, "first load should return v1 weights");

        // Update file on disk — without clearing cache, stale v1 is returned
        fs.writeFileSync(profilePath, JSON.stringify({
            profile: profileName, status: "experimental", weights: v2Weights,
        }), "utf-8");

        const cachedStale = resolveCraftScoringProfile(profileName);
        assert.deepStrictEqual(cachedStale.weights, v1Weights,
            "without clear, should still return cached v1");

        // After clearing, v2 is read from disk
        clearProfileRegistry();
        const second = resolveCraftScoringProfile(profileName);
        assert.deepStrictEqual(second.weights, v2Weights,
            "after clearProfileRegistry(), v2 should be loaded from disk");
    } finally {
        if (prevDir === undefined) delete process.env.AXIOM_SCORING_PROFILES_DIR;
        else process.env.AXIOM_SCORING_PROFILES_DIR = prevDir;
        clearProfileRegistry();
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});
