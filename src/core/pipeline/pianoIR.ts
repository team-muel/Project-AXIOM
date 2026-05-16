import type {
    AccompanimentPattern,
    CompositionPlan,
    PianoDifficulty,
    PianoHandPlan,
    PianoPedalPlan,
    PianoPlan,
    PianoSectionPlan,
    PianoStyleKind,
    PianoTextureKind,
    PianoTextureTemplate,
    TextureRole,
} from "./types.js";

// pianoIR.ts — Piano Intermediate Representation helpers
// ──────────────────────────────────────────────────────────────────────────────
// Provides:
//   • Default hand/pedal/section plan builders
//   • Structural validators (returns string[] of issues, [] = valid)
//   • buildPianoPlanFromCompositionPlan() — derives a PianoPlan from an
//     existing CompositionPlan using heuristics; the result should be reviewed
//     before use in production but is a safe starting point.
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute playability ceiling (minor 13th). */
const SPAN_HARD_CEILING = 19;

/** Right-hand idiomatic MIDI range. */
const RH_PITCH_MIN = 60;   // C4
const RH_PITCH_MAX = 108;  // C8

/** Left-hand idiomatic MIDI range. */
const LH_PITCH_MIN = 24;   // C1
const LH_PITCH_MAX = 72;   // C5

/** Maximum comfortable span by difficulty level. */
const SPAN_BY_DIFFICULTY: Record<PianoDifficulty, number> = {
    easy:         10,   // major 7th
    intermediate: 12,   // octave
    advanced:     15,   // minor 10th
    virtuosic:    19,   // minor 13th
};

/** Density target per hand by difficulty. */
const DENSITY_BY_DIFFICULTY: Record<PianoDifficulty, number> = {
    easy:         2,
    intermediate: 3,
    advanced:     4,
    virtuosic:    5,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a single PianoHandPlan.  Returns an array of human-readable issue
 * strings; an empty array means the plan is valid.
 */
export function validatePianoHandPlan(
    plan: PianoHandPlan,
    context?: string,
): string[] {
    const issues: string[] = [];
    const label = context ? `${plan.hand} hand (${context})` : `${plan.hand} hand`;

    // Register range
    const [idioMin, idioMax] = plan.hand === "right"
        ? [RH_PITCH_MIN, RH_PITCH_MAX]
        : [LH_PITCH_MIN, LH_PITCH_MAX];

    if (plan.registerMin < idioMin) {
        issues.push(`${label}: registerMin ${plan.registerMin} is below idiomatic minimum ${idioMin} (MIDI).`);
    }
    if (plan.registerMax > idioMax) {
        issues.push(`${label}: registerMax ${plan.registerMax} exceeds idiomatic maximum ${idioMax} (MIDI).`);
    }
    if (plan.registerMin >= plan.registerMax) {
        issues.push(`${label}: registerMin (${plan.registerMin}) must be less than registerMax (${plan.registerMax}).`);
    }

    // Span
    if (plan.maxComfortableSpan <= 0) {
        issues.push(`${label}: maxComfortableSpan must be > 0.`);
    }
    if (plan.maxComfortableSpan > SPAN_HARD_CEILING) {
        issues.push(`${label}: maxComfortableSpan ${plan.maxComfortableSpan} exceeds the hard ceiling of ${SPAN_HARD_CEILING} semitones.`);
    }

    // Density
    if (plan.densityTarget !== undefined) {
        if (plan.densityTarget < 1 || plan.densityTarget > 6) {
            issues.push(`${label}: densityTarget ${plan.densityTarget} is outside [1, 6].`);
        }
    }

    // Roles
    if (plan.primaryRoles.length === 0) {
        issues.push(`${label}: primaryRoles must contain at least one TextureRole.`);
    }

    return issues;
}

/**
 * Validates a PianoPedalPlan.
 */
export function validatePianoPedalPlan(plan: PianoPedalPlan, context?: string): string[] {
    const issues: string[] = [];
    const label = context ? `pedal plan (${context})` : "pedal plan";

    if (plan.strategy === "none" && plan.enabled) {
        issues.push(`${label}: strategy is "none" but enabled is true — set enabled=false or choose a non-none strategy.`);
    }
    if (plan.strategy !== "none" && !plan.enabled) {
        issues.push(`${label}: strategy is "${plan.strategy}" but enabled is false — set enabled=true or use strategy="none".`);
    }
    if (plan.changeOnHarmony === true && plan.strategy !== "harmonic") {
        issues.push(`${label}: changeOnHarmony=true requires strategy="harmonic".`);
    }
    if (plan.maxPedalMeasures !== undefined && plan.maxPedalMeasures < 1) {
        issues.push(`${label}: maxPedalMeasures must be ≥ 1.`);
    }

    return issues;
}

/**
 * Validates a PianoSectionPlan, including both hands and the pedal plan.
 */
export function validatePianoSectionPlan(plan: PianoSectionPlan): string[] {
    const issues: string[] = [];

    if (!plan.sectionId.trim()) {
        issues.push("PianoSectionPlan: sectionId must not be empty.");
    }

    issues.push(...validatePianoHandPlan(plan.rightHand, plan.sectionId));
    issues.push(...validatePianoHandPlan(plan.leftHand, plan.sectionId));
    issues.push(...validatePianoPedalPlan(plan.pedal, plan.sectionId));

    // Cross-hand register collision: LH max must be < RH min (unless crossing is allowed)
    if (!plan.leftHand.allowCrossing && !plan.rightHand.allowCrossing) {
        if (plan.leftHand.registerMax >= plan.rightHand.registerMin) {
            issues.push(
                `${plan.sectionId}: LH registerMax (${plan.leftHand.registerMax}) overlaps or exceeds RH registerMin (${plan.rightHand.registerMin}) without allowCrossing.`,
            );
        }
    }

    // Texture–hand role consistency checks
    const rhRoles = new Set(plan.rightHand.primaryRoles);
    const lhRoles = new Set(plan.leftHand.primaryRoles);
    const textureKind = plan.textureKind;

    if (
        (textureKind === "alberti_bass" || textureKind === "waltz_bass") &&
        !lhRoles.has("bass") && !lhRoles.has("pulse")
    ) {
        issues.push(
            `${plan.sectionId}: textureKind "${textureKind}" requires LH primaryRoles to include "bass" or "pulse".`,
        );
    }

    if (
        (textureKind === "counterpoint_two_voice" || textureKind === "counterpoint_three_voice") &&
        !rhRoles.has("lead") && !rhRoles.has("counterline")
    ) {
        issues.push(
            `${plan.sectionId}: textureKind "${textureKind}" requires RH primaryRoles to include "lead" or "counterline".`,
        );
    }

    if (textureKind === "octave_melody" && !rhRoles.has("lead")) {
        issues.push(`${plan.sectionId}: textureKind "octave_melody" requires RH primaryRoles to include "lead".`);
    }

    if (
        (textureKind === "melody_accompaniment" ||
            textureKind === "broken_chord" ||
            textureKind === "arpeggiated_texture" ||
            textureKind === "nocturne") &&
        !lhRoles.has("bass") && !lhRoles.has("chordal_support")
    ) {
        issues.push(
            `${plan.sectionId}: textureKind "${textureKind}" requires LH primaryRoles to include "bass" or "chordal_support".`,
        );
    }

    if (
        textureKind === "chorale" &&
        !rhRoles.has("lead") && !rhRoles.has("inner_voice")
    ) {
        issues.push(
            `${plan.sectionId}: textureKind "chorale" requires RH primaryRoles to include "lead" or "inner_voice".`,
        );
    }

    if (
        textureKind === "chorale" &&
        !lhRoles.has("bass") && !lhRoles.has("inner_voice")
    ) {
        issues.push(
            `${plan.sectionId}: textureKind "chorale" requires LH primaryRoles to include "bass" or "inner_voice".`,
        );
    }

    if (
        (textureKind === "toccata" || textureKind === "etude_figuration") &&
        !rhRoles.has("pulse") && !lhRoles.has("pulse")
    ) {
        issues.push(
            `${plan.sectionId}: textureKind "${textureKind}" requires at least one hand to include "pulse" in primaryRoles.`,
        );
    }

    return issues;
}

/**
 * Validates a full PianoPlan.
 *
 * Checks:
 * - instrument must be "Piano"
 * - at least one section
 * - all section plans are individually valid
 * - section IDs are unique
 * - section difficulty targets are compatible with the plan-level difficultyTarget
 *   (no section may be harder than the plan-level cap)
 */
export function validatePianoPlan(plan: PianoPlan): string[] {
    const issues: string[] = [];
    const DIFFICULTY_ORDER: PianoDifficulty[] = ["easy", "intermediate", "advanced", "virtuosic"];

    if (plan.instrument !== "Piano") {
        issues.push(`PianoPlan: instrument must be "Piano", got "${plan.instrument}".`);
    }

    if (plan.sections.length === 0) {
        issues.push("PianoPlan: sections array must not be empty.");
        return issues;
    }

    // Section ID uniqueness
    const seen = new Set<string>();
    for (const section of plan.sections) {
        if (seen.has(section.sectionId)) {
            issues.push(`PianoPlan: duplicate sectionId "${section.sectionId}".`);
        }
        seen.add(section.sectionId);
    }

    // Difficulty cap: no section may exceed the plan-level difficulty
    const planDiffIdx = DIFFICULTY_ORDER.indexOf(plan.difficultyTarget);
    for (const section of plan.sections) {
        const sectionDiffIdx = DIFFICULTY_ORDER.indexOf(section.difficultyTarget);
        if (sectionDiffIdx > planDiffIdx) {
            issues.push(
                `PianoPlan: section "${section.sectionId}" has difficulty "${section.difficultyTarget}" which exceeds plan-level cap "${plan.difficultyTarget}".`,
            );
        }
    }

    // Per-section validation
    for (const section of plan.sections) {
        issues.push(...validatePianoSectionPlan(section));
    }

    return issues;
}

// ---------------------------------------------------------------------------
// Builders / defaults
// ---------------------------------------------------------------------------

/**
 * Returns a safe default PianoHandPlan for the given hand and difficulty.
 *
 * Register defaults keep both hands comfortably separated with a 1-octave gap.
 */
export function buildDefaultPianoHandPlan(
    hand: "left" | "right",
    difficulty: PianoDifficulty = "intermediate",
): PianoHandPlan {
    const span = SPAN_BY_DIFFICULTY[difficulty];
    const density = DENSITY_BY_DIFFICULTY[difficulty];

    if (hand === "right") {
        return {
            hand: "right",
            primaryRoles: ["lead"],
            registerMin: 64,   // E4 — comfortable melodic register start
            registerMax: 88,   // E6 — upper melodic ceiling
            maxComfortableSpan: span,
            allowCrossing: false,
            densityTarget: 2,  // melody + inner voice
        };
    }

    return {
        hand: "left",
        primaryRoles: ["bass", "chordal_support"],
        registerMin: 36,   // C2 — solid bass register
        registerMax: 60,   // C4 — stops just below RH default min
        maxComfortableSpan: span,
        allowCrossing: false,
        densityTarget: density,
    };
}

/**
 * Returns a default PianoPedalPlan appropriate for the given texture kind.
 */
export function buildDefaultPianoPedalPlan(
    textureKind: PianoTextureKind,
): PianoPedalPlan {
    switch (textureKind) {
        case "toccata":
        case "etude_figuration":
            return { enabled: false, strategy: "none" };

        case "nocturne":
        case "arpeggiated_texture":
            return { enabled: true, strategy: "legato", maxPedalMeasures: 4 };

        case "chorale":
        case "alberti_bass":
        case "melody_accompaniment":
        case "waltz_bass":
        case "broken_chord":
        case "octave_melody":
            return { enabled: true, strategy: "harmonic", changeOnHarmony: true };

        case "counterpoint_two_voice":
        case "counterpoint_three_voice":
            return { enabled: true, strategy: "harmonic", changeOnHarmony: true, maxPedalMeasures: 2 };

        default:
            return { enabled: true, strategy: "harmonic", changeOnHarmony: true };
    }
}

/**
 * Builds a PianoSectionPlan with sensible defaults for the given texture and
 * difficulty.  The caller should override registerMin/Max and roles as needed.
 */
export function buildDefaultPianoSectionPlan(
    sectionId: string,
    textureKind: PianoTextureKind,
    difficulty: PianoDifficulty = "intermediate",
): PianoSectionPlan {
    const rh = buildDefaultPianoHandPlan("right", difficulty);
    const lh = buildDefaultPianoHandPlan("left", difficulty);

    // Adjust roles by texture
    switch (textureKind) {
        case "alberti_bass":
        case "waltz_bass":
            lh.primaryRoles = ["bass", "pulse"];
            lh.densityTarget = 1;  // bass note on the beat
            break;
        case "chorale":
            rh.primaryRoles = ["lead", "inner_voice"];
            rh.densityTarget = 3;
            lh.primaryRoles = ["inner_voice", "bass"];
            lh.densityTarget = 3;
            break;
        case "counterpoint_two_voice":
            rh.primaryRoles = ["lead"];
            rh.densityTarget = 1;
            lh.primaryRoles = ["counterline"];
            lh.densityTarget = 1;
            break;
        case "counterpoint_three_voice":
            rh.primaryRoles = ["lead", "inner_voice"];
            rh.densityTarget = 2;
            lh.primaryRoles = ["counterline", "bass"];
            lh.densityTarget = 2;
            break;
        case "nocturne":
            rh.primaryRoles = ["lead"];
            rh.densityTarget = 1;
            lh.primaryRoles = ["bass", "chordal_support"];
            lh.densityTarget = 4;
            lh.registerMin = 28;  // nocturne LH typically starts lower
            lh.registerMax = 60;  // stop at C4, just below RH default min (E4/64)
            break;
        case "octave_melody":
            rh.primaryRoles = ["lead"];
            rh.densityTarget = 2;  // note + octave
            break;
        case "toccata":
        case "etude_figuration":
            rh.primaryRoles = ["lead", "pulse"];
            lh.primaryRoles = ["bass", "pulse"];
            break;
        default:
            // melody_accompaniment / broken_chord / arpeggiated_texture — defaults are fine
            break;
    }

    const pedal = buildDefaultPianoPedalPlan(textureKind);

    // Voicing strategy by difficulty
    const voicingStrategy: PianoSectionPlan["voicingStrategy"] =
        difficulty === "easy" ? "close"
        : difficulty === "intermediate" ? "close"
        : difficulty === "advanced" ? "open"
        : "spread";

    return {
        sectionId,
        textureKind,
        rightHand: rh,
        leftHand: lh,
        pedal,
        voicingStrategy,
        difficultyTarget: difficulty,
    };
}

// ---------------------------------------------------------------------------
// Plan derivation
// ---------------------------------------------------------------------------

/**
 * Heuristically derives a PianoPlan from an existing CompositionPlan.
 *
 * Preconditions (not enforced — caller should verify):
 *   - plan.instrumentation must include exactly one piano/keyboard instrument
 *
 * The function assigns a textureKind based on section role and phrase function,
 * and builds default hand plans.  The result is a starting point for manual
 * refinement; call validatePianoPlan() afterwards to confirm correctness.
 */
export function buildPianoPlanFromCompositionPlan(
    plan: CompositionPlan,
    difficultyTarget: PianoDifficulty = "intermediate",
): PianoPlan {
    const sections: PianoSectionPlan[] = plan.sections.map((section) => {
        const textureKind = deriveTextureKind(
            section.role,
            section.phraseFunction,
            section.texture,
        );
        return buildDefaultPianoSectionPlan(section.id, textureKind, difficultyTarget);
    });

    return {
        instrument: "Piano",
        difficultyTarget,
        sections,
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derives a PianoTextureKind from section role, phrase function, and texture guidance. */
function deriveTextureKind(
    role: string,
    phraseFunction: string | undefined,
    textureGuidance: { counterpointMode?: string } | undefined,
): PianoTextureKind {
    const roleLower = role.toLowerCase();
    const phraseLower = (phraseFunction ?? "").toLowerCase();
    const cpMode = (textureGuidance?.counterpointMode ?? "").toLowerCase();

    // Counterpoint
    if (cpMode === "imitative" || cpMode === "contrary_motion") {
        return "counterpoint_two_voice";
    }

    // Development / bridge → broken chord for harmonic movement
    if (roleLower === "development" || roleLower === "bridge" || roleLower === "transition") {
        return "broken_chord";
    }

    // Cadence / closing → chorale for harmonic support
    if (roleLower === "cadence" || roleLower === "closing" || phraseLower === "cadential") {
        return "chorale";
    }

    // Default theme/recap → standard melody+accompaniment
    return "melody_accompaniment";
}

// ---------------------------------------------------------------------------
// Texture grammar — templates and style maps
// ---------------------------------------------------------------------------

/**
 * Canonical texture grammar templates for all 12 PianoTextureKinds.
 *
 * Each entry is the authoritative default for:
 *   - hand roles and register ranges
 *   - density targets
 *   - accompaniment pattern
 *   - voicing strategy
 *   - pedal strategy
 *
 * Use `getTextureTemplate()` to retrieve; use `buildPianoSectionPlanFromTemplate()`
 * to instantiate a PianoSectionPlan from any template.
 */
export const TEXTURE_TEMPLATES: Record<PianoTextureKind, PianoTextureTemplate> = {
    melody_accompaniment: {
        textureKind: "melody_accompaniment",
        styleHints: ["classical_sonata", "romantic_character"],
        rhRoles: ["lead"],
        rhRegisterMin: 64, rhRegisterMax: 88, rhDensityTarget: 1,
        lhRoles: ["bass", "chordal_support"],
        lhRegisterMin: 36, lhRegisterMax: 60, lhDensityTarget: 3,
        accompanimentPattern: "broken_chord",
        voicingStrategy: "close",
        pedalStrategy: "harmonic",
        pedalChangeOnHarmony: true,
        description: "RH melody over broken-chord or block-chord LH accompaniment.",
    },
    alberti_bass: {
        textureKind: "alberti_bass",
        styleHints: ["classical_sonata"],
        rhRoles: ["lead"],
        rhRegisterMin: 64, rhRegisterMax: 88, rhDensityTarget: 1,
        lhRoles: ["bass", "pulse"],
        lhRegisterMin: 36, lhRegisterMax: 60, lhDensityTarget: 2,
        accompanimentPattern: "alberti_bass",
        voicingStrategy: "close",
        pedalStrategy: "harmonic",
        pedalChangeOnHarmony: true,
        description: "RH melody over classical Alberti-bass LH (low–middle–high–middle pattern).",
    },
    waltz_bass: {
        textureKind: "waltz_bass",
        styleHints: ["romantic_character"],
        rhRoles: ["lead"],
        rhRegisterMin: 64, rhRegisterMax: 88, rhDensityTarget: 2,
        lhRoles: ["bass", "pulse"],
        lhRegisterMin: 28, lhRegisterMax: 60, lhDensityTarget: 2,
        accompanimentPattern: "waltz_bass",
        voicingStrategy: "open",
        pedalStrategy: "harmonic",
        pedalChangeOnHarmony: true,
        description: "3/4 waltz: LH bass on beat 1 then chords on beats 2–3.",
    },
    broken_chord: {
        textureKind: "broken_chord",
        styleHints: ["classical_sonata", "romantic_character"],
        rhRoles: ["lead"],
        rhRegisterMin: 64, rhRegisterMax: 88, rhDensityTarget: 1,
        lhRoles: ["bass", "chordal_support"],
        lhRegisterMin: 36, lhRegisterMax: 60, lhDensityTarget: 2,
        accompanimentPattern: "broken_chord",
        voicingStrategy: "close",
        pedalStrategy: "harmonic",
        pedalChangeOnHarmony: true,
        description: "RH melody over broken-chord (non-Alberti) LH figuration; common in development sections.",
    },
    arpeggiated_texture: {
        textureKind: "arpeggiated_texture",
        styleHints: ["romantic_character", "nocturne"],
        rhRoles: ["lead"],
        rhRegisterMin: 64, rhRegisterMax: 92, rhDensityTarget: 1,
        lhRoles: ["bass", "chordal_support"],
        lhRegisterMin: 28, lhRegisterMax: 64, lhDensityTarget: 4,
        accompanimentPattern: "wide_spread_arpeggio",
        voicingStrategy: "spread",
        pedalStrategy: "legato",
        pedalMaxMeasures: 4,
        allowCrossing: true,  // wide-spread LH arpeggio reaches into tenor/RH territory
        description: "Wide-spread LH arpeggio sweeping bass–inner–tenor registers; sustain pedal blends harmony.",
    },
    nocturne: {
        textureKind: "nocturne",
        styleHints: ["nocturne"],
        rhRoles: ["lead"],
        rhRegisterMin: 64, rhRegisterMax: 96, rhDensityTarget: 1,
        lhRoles: ["bass", "chordal_support"],
        lhRegisterMin: 28, lhRegisterMax: 60, lhDensityTarget: 4,
        accompanimentPattern: "wide_spread_arpeggio",
        voicingStrategy: "spread",
        pedalStrategy: "legato",
        pedalMaxMeasures: 4,
        description: "Cantabile RH melody over wide LH broken-chord waves with sustained legato pedal.",
    },
    chorale: {
        textureKind: "chorale",
        styleHints: ["classical_sonata"],
        rhRoles: ["lead", "inner_voice"],
        rhRegisterMin: 60, rhRegisterMax: 84, rhDensityTarget: 3,
        lhRoles: ["inner_voice", "bass"],
        lhRegisterMin: 36, lhRegisterMax: 64, lhDensityTarget: 3,
        accompanimentPattern: "block_chord",
        voicingStrategy: "close",
        pedalStrategy: "harmonic",
        pedalChangeOnHarmony: true,
        allowCrossing: true,  // SATB inner voices naturally overlap between hands
        description: "Four-voice chorale: both hands carry inner voices with melody in RH top and bass in LH bottom.",
    },
    octave_melody: {
        textureKind: "octave_melody",
        styleHints: ["romantic_character"],
        rhRoles: ["lead"],
        rhRegisterMin: 60, rhRegisterMax: 88, rhDensityTarget: 2,
        lhRoles: ["bass", "chordal_support"],
        lhRegisterMin: 36, lhRegisterMax: 59, lhDensityTarget: 3,
        accompanimentPattern: "broken_chord",
        voicingStrategy: "octave_doubled",
        pedalStrategy: "harmonic",
        pedalChangeOnHarmony: true,
        description: "RH melody doubled at the octave for climactic weight; LH provides harmonic support.",
    },
    counterpoint_two_voice: {
        textureKind: "counterpoint_two_voice",
        styleHints: ["classical_sonata"],
        rhRoles: ["lead"],
        rhRegisterMin: 60, rhRegisterMax: 88, rhDensityTarget: 1,
        lhRoles: ["counterline"],
        lhRegisterMin: 36, lhRegisterMax: 68, lhDensityTarget: 1,
        voicingStrategy: "open",
        pedalStrategy: "harmonic",
        pedalChangeOnHarmony: true,
        pedalMaxMeasures: 2,
        allowCrossing: true,  // contrapuntal lines naturally cross registers
        description: "Two independent melodic lines in imitative or contrary-motion counterpoint.",
    },
    counterpoint_three_voice: {
        textureKind: "counterpoint_three_voice",
        styleHints: ["classical_sonata"],
        rhRoles: ["lead", "inner_voice"],
        rhRegisterMin: 60, rhRegisterMax: 88, rhDensityTarget: 2,
        lhRoles: ["counterline", "bass"],
        lhRegisterMin: 36, lhRegisterMax: 68, lhDensityTarget: 2,
        voicingStrategy: "open",
        pedalStrategy: "harmonic",
        pedalChangeOnHarmony: true,
        pedalMaxMeasures: 2,
        allowCrossing: true,  // three-voice counterpoint voices overlap
        description: "Three-voice invertible counterpoint with an independent bass line.",
    },
    toccata: {
        textureKind: "toccata",
        styleHints: ["etude"],
        rhRoles: ["lead", "pulse"],
        rhRegisterMin: 60, rhRegisterMax: 96, rhDensityTarget: 2,
        lhRoles: ["bass", "pulse"],
        lhRegisterMin: 36, lhRegisterMax: 59, lhDensityTarget: 2,
        accompanimentPattern: "repeated_figure",
        voicingStrategy: "close",
        pedalStrategy: "none",
        allowRepeatedOctaves: true,
        description: "Perpetual-motion toccata with dry articulation, repeated rhythmic patterns, and no sustain pedal.",
    },
    etude_figuration: {
        textureKind: "etude_figuration",
        styleHints: ["etude"],
        rhRoles: ["lead", "pulse"],
        rhRegisterMin: 60, rhRegisterMax: 96, rhDensityTarget: 3,
        lhRoles: ["bass", "pulse"],
        lhRegisterMin: 36, lhRegisterMax: 59, lhDensityTarget: 3,
        accompanimentPattern: "repeated_figure",
        voicingStrategy: "close",
        pedalStrategy: "none",
        description: "Consistent technical figuration pattern to develop a specific pianistic skill.",
    },
};

/**
 * Recommended texture kind per section role for each piano style.
 * Used by `buildPianoSectionPlanForStyle()`.
 */
const STYLE_TEXTURE_MAP: Record<PianoStyleKind, Record<string, PianoTextureKind>> = {
    classical_sonata: {
        theme_a:     "alberti_bass",
        theme_b:     "melody_accompaniment",
        exposition:  "alberti_bass",
        development: "broken_chord",
        bridge:      "broken_chord",
        transition:  "broken_chord",
        recap:       "alberti_bass",
        recapitulation: "alberti_bass",
        cadence:     "chorale",
        closing:     "chorale",
        coda:        "octave_melody",
    },
    romantic_character: {
        theme_a:     "arpeggiated_texture",
        theme_b:     "melody_accompaniment",
        development: "arpeggiated_texture",
        bridge:      "melody_accompaniment",
        climax:      "octave_melody",
        cadence:     "chorale",
        closing:     "arpeggiated_texture",
        coda:        "nocturne",
    },
    nocturne: {
        theme_a:     "nocturne",
        theme_b:     "nocturne",
        development: "arpeggiated_texture",
        bridge:      "arpeggiated_texture",
        climax:      "octave_melody",
        cadence:     "nocturne",
        closing:     "nocturne",
        coda:        "nocturne",
    },
    etude: {
        theme_a:     "etude_figuration",
        theme_b:     "etude_figuration",
        development: "etude_figuration",
        bridge:      "toccata",
        climax:      "toccata",
        cadence:     "etude_figuration",
        closing:     "etude_figuration",
        coda:        "toccata",
    },
};

/** Returns the canonical PianoTextureTemplate for the given texture kind. */
export function getTextureTemplate(kind: PianoTextureKind): PianoTextureTemplate {
    return TEXTURE_TEMPLATES[kind];
}

/**
 * Builds a PianoSectionPlan directly from the canonical texture template,
 * overriding only the span (from difficulty) and sectionId.
 *
 * Prefer this over `buildDefaultPianoSectionPlan` when you want the
 * full texture grammar applied (accompanimentPattern, voicingStrategy,
 * pedalStrategy, register ranges, density targets) without manual adjustment.
 */
export function buildPianoSectionPlanFromTemplate(
    sectionId: string,
    textureKind: PianoTextureKind,
    difficulty: PianoDifficulty = "intermediate",
): PianoSectionPlan {
    const tpl = TEXTURE_TEMPLATES[textureKind];
    const span = SPAN_BY_DIFFICULTY[difficulty];

    const rh: PianoHandPlan = {
        hand: "right",
        primaryRoles: [...tpl.rhRoles],
        registerMin: tpl.rhRegisterMin,
        registerMax: tpl.rhRegisterMax,
        maxComfortableSpan: span,
        allowCrossing: tpl.allowCrossing ?? false,
        allowRepeatedOctaves: tpl.allowRepeatedOctaves,
        densityTarget: tpl.rhDensityTarget,
    };

    const lh: PianoHandPlan = {
        hand: "left",
        primaryRoles: [...tpl.lhRoles],
        registerMin: tpl.lhRegisterMin,
        registerMax: tpl.lhRegisterMax,
        maxComfortableSpan: span,
        allowCrossing: tpl.allowCrossing ?? false,
        allowRepeatedOctaves: tpl.allowRepeatedOctaves,
        densityTarget: tpl.lhDensityTarget,
    };

    const pedal: PianoPedalPlan = {
        enabled: tpl.pedalStrategy !== "none",
        strategy: tpl.pedalStrategy,
        changeOnHarmony: tpl.pedalChangeOnHarmony,
        maxPedalMeasures: tpl.pedalMaxMeasures,
    };

    return {
        sectionId,
        textureKind,
        rightHand: rh,
        leftHand: lh,
        pedal,
        accompanimentPattern: tpl.accompanimentPattern,
        voicingStrategy: tpl.voicingStrategy,
        difficultyTarget: difficulty,
    };
}

/**
 * Builds a PianoSectionPlan appropriate for a given style + section role.
 *
 * Selects the texture kind from STYLE_TEXTURE_MAP, then delegates to
 * `buildPianoSectionPlanFromTemplate`.  Unknown roles fall back to the
 * style's "theme_a" entry, then to "melody_accompaniment".
 *
 * @example
 *   buildPianoSectionPlanForStyle("theme-a", "classical_sonata", "theme_a")
 *   // → alberti_bass texture template
 *
 *   buildPianoSectionPlanForStyle("climax", "nocturne", "climax")
 *   // → octave_melody texture template
 */
export function buildPianoSectionPlanForStyle(
    sectionId: string,
    styleKind: PianoStyleKind,
    sectionRole: string,
    difficulty: PianoDifficulty = "intermediate",
): PianoSectionPlan {
    const textureMap = STYLE_TEXTURE_MAP[styleKind];
    const roleLower = sectionRole.toLowerCase();
    const textureKind: PianoTextureKind =
        textureMap[roleLower] ?? textureMap["theme_a"] ?? "melody_accompaniment";
    return buildPianoSectionPlanFromTemplate(sectionId, textureKind, difficulty);
}
