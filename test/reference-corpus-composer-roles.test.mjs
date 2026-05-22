/**
 * test/reference-corpus-composer-roles.test.mjs
 *
 * CCR-01 ~ CCR-08: Composer Role Taxonomy tests
 *
 * Verifies:
 *   - ComposerRoleKind and ComposerCorpusEntry types exist (via compiled dist)
 *   - resolveComposerRole() returns correct roles for known composers
 *   - isLineageComposer() returns true only for primary (Beethoven, Schubert)
 *   - Theory-only composers (Bach, Mozart, Chopin, Brahms) are excluded from lineage
 *   - Future-reference composers (Rachmaninoff) are excluded from lineage
 *   - Unknown composer defaults to theory_only (fail-safe)
 *   - corpus-manifest.json composerRoles map has correct roles
 *   - Theory-only composers declare "lineageScoring" in notUsedFor
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// ─── Import compiled TypeScript exports ────────────────────────────────────────

const {
    resolveComposerRole,
    isLineageComposer,
} = await import("../dist/core/analyze/referenceStyleProfile.js");

// ─── Load the manifest ─────────────────────────────────────────────────────────

const manifestPath = join(repoRoot, "config", "reference-corpus", "corpus-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
const composerRoles = manifest.composerRoles;

// ─── CCR-01: resolveComposerRole — Beethoven is primary ───────────────────────

test("CCR-01: beethoven resolves to primary role", () => {
    const entry = resolveComposerRole("beethoven", composerRoles);
    assert.equal(entry.role, "primary", "Beethoven must be primary identity source");
    assert.ok(entry.usedFor.length > 0, "usedFor must be non-empty for primary composer");
});

// ─── CCR-02: resolveComposerRole — Schubert is primary ────────────────────────

test("CCR-02: schubert resolves to primary role", () => {
    const entry = resolveComposerRole("schubert", composerRoles);
    assert.equal(entry.role, "primary", "Schubert must be primary identity source");
    assert.ok(entry.usedFor.length > 0, "usedFor must be non-empty for primary composer");
});

// ─── CCR-03: theory_only composers ────────────────────────────────────────────

test("CCR-03: bach, mozart, chopin, brahms resolve to theory_only", () => {
    const theoryComposers = ["bach", "mozart", "chopin", "brahms"];
    for (const c of theoryComposers) {
        const entry = resolveComposerRole(c, composerRoles);
        assert.equal(entry.role, "theory_only",
            `${c} must be theory_only — should not contribute to AXIOM identity`);
    }
});

// ─── CCR-04: future_reference composer ────────────────────────────────────────

test("CCR-04: rachmaninoff resolves to future_reference", () => {
    const entry = resolveComposerRole("rachmaninoff", composerRoles);
    assert.equal(entry.role, "future_reference",
        "Rachmaninoff must be future_reference — not currently active");
});

// ─── CCR-05: isLineageComposer — true only for primary ────────────────────────

test("CCR-05: isLineageComposer returns true only for primary composers", () => {
    assert.ok(isLineageComposer("beethoven", composerRoles), "Beethoven should be lineage");
    assert.ok(isLineageComposer("schubert", composerRoles), "Schubert should be lineage");

    assert.ok(!isLineageComposer("bach", composerRoles), "Bach must NOT be lineage");
    assert.ok(!isLineageComposer("mozart", composerRoles), "Mozart must NOT be lineage");
    assert.ok(!isLineageComposer("chopin", composerRoles), "Chopin must NOT be lineage");
    assert.ok(!isLineageComposer("brahms", composerRoles), "Brahms must NOT be lineage");
    assert.ok(!isLineageComposer("rachmaninoff", composerRoles), "Rachmaninoff must NOT be lineage");
});

// ─── CCR-06: unknown composer defaults to theory_only (fail-safe) ─────────────

test("CCR-06: unknown composer defaults to theory_only", () => {
    const entry = resolveComposerRole("debussy", composerRoles);
    assert.equal(entry.role, "theory_only",
        "Unknown composer should default to theory_only to prevent accidental identity inclusion");
    assert.ok(!isLineageComposer("debussy", composerRoles), "Unknown composer must not be lineage");
});

// ─── CCR-07: theory_only entries declare lineageScoring in notUsedFor ─────────

test("CCR-07: theory_only composers declare lineageScoring in notUsedFor", () => {
    const theoryComposers = ["bach", "mozart", "chopin", "brahms"];
    for (const c of theoryComposers) {
        const entry = resolveComposerRole(c, composerRoles);
        assert.ok(
            entry.notUsedFor.includes("lineageScoring"),
            `${c} must declare "lineageScoring" in notUsedFor to prevent identity leakage`
        );
    }
});

// ─── CCR-08: manifest composerRoles has all expected entries ──────────────────

test("CCR-08: manifest composerRoles contains expected entries", () => {
    const required = ["beethoven", "schubert", "bach", "mozart", "chopin", "brahms", "rachmaninoff"];
    for (const c of required) {
        assert.ok(composerRoles[c], `corpus-manifest.json composerRoles must include "${c}"`);
        assert.ok(
            typeof composerRoles[c].role === "string",
            `composerRoles["${c}"].role must be a string`
        );
    }
});
