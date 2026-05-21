/**
 * AXIOM Style Identity
 *
 * Single source of truth for AXIOM's aesthetic identity in TypeScript.
 * Constants here must stay in sync with:
 *   config/style-profiles/axiom_beethoven_schubert_v1.json
 *
 * For runtime JSON loading (scripts, analysis) use loadStyleIdentityProfile().
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StyleIdentityInfluence {
    composer: string;
    /** NotaGen conditioning header ID */
    notagenComposerId: string;
    /** 0.0–1.0, sum across influences ≈ 1.0 */
    weight: number;
    /** Routing hint used by resolveComposerIdentity() */
    formRouting: "structural" | "lyrical";
    description: string;
    traits: string[];
    traitDescriptions?: Record<string, string>;
    formExamples: string[];
}

export interface StyleIdentityProfile {
    id: string;
    version: string;
    description: string;
    status: "active" | "draft" | "deprecated";
    primaryInfluences: StyleIdentityInfluence[];
    generalTheorySources: string[];
    avoidAsPrimaryIdentity: string[];
    referenceCorpusLink?: string;
}

// ---------------------------------------------------------------------------
// Static constants (kept in sync with axiom_beethoven_schubert_v1.json)
// ---------------------------------------------------------------------------

/** Active profile ID for the current AXIOM generation. */
export const AXIOM_STYLE_PROFILE_ID = "axiom_beethoven_schubert_v1" as const;

/** Primary composer — governs structural, architecturally-driven forms. */
export const AXIOM_IDENTITY_COMPOSER_PRIMARY = "Beethoven, Ludwig van" as const;

/** Secondary lyrical composer — governs song-like and characteristic forms. */
export const AXIOM_IDENTITY_COMPOSER_LYRICAL = "Schubert, Franz" as const;

/**
 * Forms that route to Schubert rather than Beethoven.
 * Derived from `primaryInfluences[1].formExamples` in the profile JSON.
 * Must stay in sync with axiom_beethoven_schubert_v1.json.
 */
export const SCHUBERT_FORM_KEYWORDS: ReadonlySet<string> = new Set([
    "lied", "song", "nocturne", "impromptu", "moment musical", "moment_musical",
    "romanze", "romance", "fantasia lyrisch", "ballade", "wiegenlied", "serenade",
]);

/**
 * Core traits for the Beethoven identity (structural forms).
 * Used to enrich conditioning text and prompt construction.
 */
export const BEETHOVEN_TRAITS: readonly string[] = [
    "motivic inevitability",
    "dramatic contrast",
    "sonata architecture",
    "long-range tonal resolution",
    "rhythmic drive",
];

/**
 * Core traits for the Schubert identity (lyrical forms).
 * Used to enrich conditioning text and prompt construction.
 */
export const SCHUBERT_TRAITS: readonly string[] = [
    "lyrical melody",
    "song-like phrase expansion",
    "mediant harmonic color",
    "major-minor ambiguity",
    "wandering but coherent modulation",
];

// ---------------------------------------------------------------------------
// Runtime loader (for scripts, tests, admin tooling)
// ---------------------------------------------------------------------------

const _profileDir = join(dirname(fileURLToPath(import.meta.url)), "../../../config/style-profiles");

let _cachedProfile: StyleIdentityProfile | null = null;

/**
 * Load the active style identity profile from disk.
 * Result is cached; safe to call repeatedly.
 */
export async function loadStyleIdentityProfile(
    profileId: string = AXIOM_STYLE_PROFILE_ID,
): Promise<StyleIdentityProfile> {
    if (_cachedProfile && _cachedProfile.id === profileId) return _cachedProfile;
    const filePath = join(_profileDir, `${profileId}.json`);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as StyleIdentityProfile;
    _cachedProfile = parsed;
    return parsed;
}

/**
 * Resolve the NotaGen composer ID for a given form keyword.
 * Pure function, uses static constants — no async I/O.
 */
export function resolveComposerByForm(formLower: string): string {
    for (const kw of SCHUBERT_FORM_KEYWORDS) {
        if (formLower.includes(kw)) return AXIOM_IDENTITY_COMPOSER_LYRICAL;
    }
    return AXIOM_IDENTITY_COMPOSER_PRIMARY;
}

/**
 * Return the traits array for the resolved composer identity.
 * Pure function — no async I/O.
 */
export function resolveTraitsForComposer(composerId: string): readonly string[] {
    if (composerId === AXIOM_IDENTITY_COMPOSER_LYRICAL) return SCHUBERT_TRAITS;
    return BEETHOVEN_TRAITS;
}
