import type {
    CadenceApproachTemplate,
    FunctionalHarmonyRole,
    HarmonicColorCue,
    HarmonyGrammarPlan,
    HarmonicRhythmShape,
    SectionPlan,
    TonicizationWindow,
} from "../pipeline/types.js";
import type { SectionRole } from "../pipeline/types/section.js";

// harmonyGrammar.ts — Section-level tonal grammar annotation
// ──────────────────────────────────────────────────────────────────────────────
// Produces HarmonyGrammarPlan per section during sketch materialization.
// Mirrors the conceptual framework in docs/harmony-grammar.md §1–7.
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// 1. Functional progression builder
// ---------------------------------------------------------------------------

/**
 * Returns an ordered sequence of functional harmony roles for a section.
 * Encodes the T→PD→D→T template with role-specific variations.
 */
export function buildFunctionalProgression(
    role: SectionRole,
    energy: number,
    tension = 0.5,
): FunctionalHarmonyRole[] {
    switch (role) {
        case "intro":
        case "theme_a":
        case "recap":
            // Clean statement — full functional cycle
            return ["tonic", "predominant", "dominant", "tonic"];

        case "theme_b":
        case "variation":
            // Slightly more ornate — PD appears twice
            return ["tonic", "predominant", "dominant", "predominant", "dominant", "tonic"];

        case "development": {
            // Restless — starts from mid-harmonic function, ends on dominant pedal
            const base: FunctionalHarmonyRole[] = ["tonic", "dominant", "predominant", "dominant"];
            if (tension > 0.6 || energy > 0.7) {
                base.push("dominant"); // extra dominant extension for high-tension passages
            }
            return base;
        }

        case "bridge":
            // Transitional — begins with PD to push forward
            return ["predominant", "dominant", "tonic", "dominant"];

        case "cadence":
        case "outro":
            // Resolution passage
            return ["dominant", "tonic"];

        default:
            return ["tonic", "predominant", "dominant", "tonic"];
    }
}

// ---------------------------------------------------------------------------
// 2. Cadence approach template chooser
// ---------------------------------------------------------------------------

/**
 * Selects the cadential approach template for a section.
 * Structural sections (recap, final cadence) get the heavier cad64 treatment;
 * internal transitions get applied_dominant to move forward.
 */
export function chooseCadenceApproachTemplate(
    role: SectionRole,
    sectionIndex: number,
    totalSections: number,
): CadenceApproachTemplate {
    const isLate = sectionIndex >= totalSections - 2; // last two sections

    if (role === "recap" || role === "cadence") {
        return "cad64"; // I⁶₄-V⁷-I at structural arrival points
    }
    if (role === "outro") {
        return isLate ? "cad64" : "basic";
    }
    if (role === "bridge" || role === "development") {
        return "applied_dominant"; // V/x to push into next section
    }
    if (isLate && (role === "theme_a" || role === "theme_b")) {
        return "extended"; // expanded dominant approach near the end
    }
    return "basic";
}

// ---------------------------------------------------------------------------
// 3. Harmonic rhythm shape chooser
// ---------------------------------------------------------------------------

/**
 * Returns the preferred harmonic rhythm shape for a section based on role and energy.
 */
export function buildHarmonicRhythmShape(role: SectionRole, energy: number): HarmonicRhythmShape {
    switch (role) {
        case "intro":
        case "theme_a":
            return "slow"; // stable, clear harmonic outline
        case "theme_b":
            return "uniform"; // steady contrast
        case "development":
            return energy > 0.6 ? "slow→fast" : "uniform"; // accelerating tension
        case "bridge":
            return "slow→fast"; // push into next section
        case "variation":
            return "arch"; // slow start → peak → slow cadence
        case "recap":
            return "fast→slow"; // dense re-entry that settles
        case "cadence":
        case "outro":
            return "slow"; // deliberate cadential arrival
        default:
            return "uniform";
    }
}

// ---------------------------------------------------------------------------
// 4. Applied dominant cue builder
// ---------------------------------------------------------------------------

/**
 * Builds a HarmonicColorCue for a suggested applied dominant (V/x).
 * `targetDegree` is a tonal degree label such as "V", "vi", "IV".
 * `keyContext` is the home key label, e.g. "C major".
 */
export function buildAppliedDominantCue(
    targetDegree: string,
    keyContext: string,
    startMeasure?: number,
): HarmonicColorCue {
    return {
        tag: "applied_dominant",
        keyTarget: `V/${targetDegree} in ${keyContext}`,
        startMeasure,
        intensity: 0.7,
        notes: [`Applied dominant targeting ${targetDegree}`],
    };
}

// ---------------------------------------------------------------------------
// 5. Tonicization window suggester
// ---------------------------------------------------------------------------

/**
 * Suggests a local tonicization window for sections that benefit from brief excursions.
 * Development and bridge sections typically tonicize the dominant or relative.
 */
export function suggestTonicizationWindow(
    role: SectionRole,
    keyContext: string,
    sectionMeasures: number,
): TonicizationWindow | undefined {
    if (role === "development") {
        return {
            keyTarget: `V of ${keyContext}`,
            startMeasure: Math.floor(sectionMeasures * 0.25),
            endMeasure: Math.floor(sectionMeasures * 0.60),
            emphasis: "prepared",
            cadence: "half",
        };
    }
    if (role === "bridge") {
        return {
            keyTarget: `vi of ${keyContext}`,
            startMeasure: 0,
            endMeasure: Math.floor(sectionMeasures * 0.5),
            emphasis: "passing",
            cadence: "half",
        };
    }
    if (role === "theme_b") {
        return {
            keyTarget: `V of ${keyContext}`,
            startMeasure: Math.floor(sectionMeasures * 0.5),
            endMeasure: sectionMeasures,
            emphasis: "arriving",
            cadence: "authentic",
        };
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// 6. Per-section plan builder
// ---------------------------------------------------------------------------

function buildHarmonyGrammarPlan(
    section: SectionPlan,
    sectionIndex: number,
    totalSections: number,
): HarmonyGrammarPlan {
    const { role, energy = 0.5, measures = 8, harmonicPlan } = section;
    const tension = harmonicPlan?.tensionTarget ?? 0.5;
    const keyContext = harmonicPlan?.tonalCenter ?? "C major";

    const functionalSequence = buildFunctionalProgression(role, energy, tension);
    const cadenceApproach = chooseCadenceApproachTemplate(role, sectionIndex, totalSections);
    const harmonicRhythmShape = buildHarmonicRhythmShape(role, energy);
    const tonicization = suggestTonicizationWindow(role, keyContext, measures);

    const appliedDominantCues: HarmonicColorCue[] = [];
    if (cadenceApproach === "applied_dominant" || role === "development" || role === "bridge") {
        appliedDominantCues.push(buildAppliedDominantCue("V", keyContext, Math.floor(measures * 0.6)));
    }

    const prolongationMode = harmonicPlan?.prolongationMode;

    const notes: string[] = [
        `functional: ${functionalSequence.join("→")}`,
        `cadence approach: ${cadenceApproach}`,
        `rhythm shape: ${harmonicRhythmShape}`,
    ];

    return {
        functionalSequence,
        cadenceApproach,
        harmonicRhythmShape,
        ...(prolongationMode ? { prolongationMode } : {}),
        ...(tonicization ? { tonicization } : {}),
        ...(appliedDominantCues.length > 0 ? { appliedDominantCues } : {}),
        notes,
    };
}

// ---------------------------------------------------------------------------
// 7. Batch annotator
// ---------------------------------------------------------------------------

/**
 * Produces a HarmonyGrammarPlan for every section in the plan.
 * Returns a Map<sectionId, HarmonyGrammarPlan> for merging into SectionPlan.harmonyGrammar.
 */
export function applyHarmonyGrammarToSections(
    sections: SectionPlan[],
): Map<string, HarmonyGrammarPlan> {
    const total = sections.length;
    const result = new Map<string, HarmonyGrammarPlan>();
    sections.forEach((section, index) => {
        result.set(section.id, buildHarmonyGrammarPlan(section, index, total));
    });
    return result;
}
