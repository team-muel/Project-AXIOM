// @ts-check
/**
 * AXIOM Style Identity Profile tests
 *
 * 1. JSON profile loads and has required structure.
 * 2. TypeScript constants match JSON values (no drift).
 * 3. resolveComposerByForm() routes lyrical forms to Schubert.
 * 4. resolveComposerByForm() routes structural forms to Beethoven.
 * 5. resolveTraitsForComposer() returns non-empty trait arrays.
 * 6. Profile influences weights sum to ≈ 1.0.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = join(__dirname, "../config/style-profiles/axiom_beethoven_schubert_v1.json");

// Load the compiled identity module
const {
    AXIOM_STYLE_PROFILE_ID,
    AXIOM_IDENTITY_COMPOSER_PRIMARY,
    AXIOM_IDENTITY_COMPOSER_LYRICAL,
    SCHUBERT_FORM_KEYWORDS,
    BEETHOVEN_TRAITS,
    SCHUBERT_TRAITS,
    resolveComposerByForm,
    resolveTraitsForComposer,
    loadStyleIdentityProfile,
} = await import("../dist/core/identity/axiomStyleIdentity.js");

// ---------------------------------------------------------------------------

test("style-identity: JSON profile file loads and has required shape", () => {
    const raw = readFileSync(PROFILE_PATH, "utf8");
    const profile = JSON.parse(raw);

    assert.equal(typeof profile.id, "string", "profile.id must be a string");
    assert.equal(typeof profile.version, "string", "profile.version must be a string");
    assert.ok(Array.isArray(profile.primaryInfluences), "primaryInfluences must be an array");
    assert.ok(profile.primaryInfluences.length >= 2, "at least 2 primary influences expected");
    assert.ok(Array.isArray(profile.generalTheorySources), "generalTheorySources must be an array");
    assert.ok(Array.isArray(profile.avoidAsPrimaryIdentity), "avoidAsPrimaryIdentity must be an array");

    for (const influence of profile.primaryInfluences) {
        assert.equal(typeof influence.composer, "string", `composer must be string in ${influence.composer}`);
        assert.ok(typeof influence.weight === "number" && influence.weight > 0 && influence.weight <= 1,
            `weight must be in (0, 1] for ${influence.composer}`);
        assert.ok(Array.isArray(influence.traits) && influence.traits.length > 0,
            `traits must be a non-empty array for ${influence.composer}`);
        assert.ok(Array.isArray(influence.formExamples) && influence.formExamples.length > 0,
            `formExamples must be a non-empty array for ${influence.composer}`);
    }
});

test("style-identity: TS constants match JSON profile (no drift)", () => {
    const raw = readFileSync(PROFILE_PATH, "utf8");
    const profile = JSON.parse(raw);

    assert.equal(AXIOM_STYLE_PROFILE_ID, profile.id,
        "AXIOM_STYLE_PROFILE_ID must match profile.id");

    const beethovenInfluence = profile.primaryInfluences.find((i) => i.formRouting === "structural");
    const schubertInfluence = profile.primaryInfluences.find((i) => i.formRouting === "lyrical");

    assert.ok(beethovenInfluence, "profile must have a structural (Beethoven) influence");
    assert.ok(schubertInfluence, "profile must have a lyrical (Schubert) influence");

    assert.equal(AXIOM_IDENTITY_COMPOSER_PRIMARY, beethovenInfluence.composer,
        "AXIOM_IDENTITY_COMPOSER_PRIMARY must match profile Beethoven composer ID");
    assert.equal(AXIOM_IDENTITY_COMPOSER_LYRICAL, schubertInfluence.composer,
        "AXIOM_IDENTITY_COMPOSER_LYRICAL must match profile Schubert composer ID");

    // Every Schubert formExample must be in SCHUBERT_FORM_KEYWORDS
    for (const form of schubertInfluence.formExamples) {
        assert.ok(SCHUBERT_FORM_KEYWORDS.has(form),
            `profile Schubert formExample "${form}" missing from SCHUBERT_FORM_KEYWORDS`);
    }

    // Every TS Beethoven trait must appear in the profile
    const beethovenProfileTraits = new Set(beethovenInfluence.traits);
    for (const trait of BEETHOVEN_TRAITS) {
        assert.ok(beethovenProfileTraits.has(trait),
            `BEETHOVEN_TRAITS includes "${trait}" not found in profile`);
    }

    // Every TS Schubert trait must appear in the profile
    const schubertProfileTraits = new Set(schubertInfluence.traits);
    for (const trait of SCHUBERT_TRAITS) {
        assert.ok(schubertProfileTraits.has(trait),
            `SCHUBERT_TRAITS includes "${trait}" not found in profile`);
    }
});

test("style-identity: primary influence weights sum to ~1.0", () => {
    const raw = readFileSync(PROFILE_PATH, "utf8");
    const profile = JSON.parse(raw);
    const total = profile.primaryInfluences.reduce((s, i) => s + i.weight, 0);
    assert.ok(Math.abs(total - 1.0) < 0.01,
        `influence weights should sum to 1.0 ± 0.01, got ${total}`);
});

test("style-identity: resolveComposerByForm routes lyrical forms to Schubert", () => {
    const lyricalForms = ["nocturne", "lied", "impromptu", "romance", "ballade",
        "moment musical", "wiegenlied", "serenade"];
    for (const form of lyricalForms) {
        assert.equal(resolveComposerByForm(form), AXIOM_IDENTITY_COMPOSER_LYRICAL,
            `"${form}" must route to Schubert`);
    }
});

test("style-identity: resolveComposerByForm routes structural forms to Beethoven", () => {
    const structuralForms = ["sonata", "miniature", "rondo", "scherzo",
        "theme_and_variations", "symphony_movement", "string_quartet"];
    for (const form of structuralForms) {
        assert.equal(resolveComposerByForm(form), AXIOM_IDENTITY_COMPOSER_PRIMARY,
            `"${form}" must route to Beethoven`);
    }
});

test("style-identity: resolveTraitsForComposer returns non-empty arrays", () => {
    const beethovenTraits = resolveTraitsForComposer(AXIOM_IDENTITY_COMPOSER_PRIMARY);
    assert.ok(Array.isArray(beethovenTraits) && beethovenTraits.length > 0,
        "Beethoven traits must be non-empty");

    const schubertTraits = resolveTraitsForComposer(AXIOM_IDENTITY_COMPOSER_LYRICAL);
    assert.ok(Array.isArray(schubertTraits) && schubertTraits.length > 0,
        "Schubert traits must be non-empty");

    // Trait arrays must be distinct
    assert.notDeepEqual([...beethovenTraits], [...schubertTraits],
        "Beethoven and Schubert traits must differ");
});

test("style-identity: loadStyleIdentityProfile() loads and parses the JSON correctly", async () => {
    const profile = await loadStyleIdentityProfile();
    assert.equal(profile.id, AXIOM_STYLE_PROFILE_ID);
    assert.ok(profile.primaryInfluences.length >= 2);
    assert.equal(profile.status, "active");
});
