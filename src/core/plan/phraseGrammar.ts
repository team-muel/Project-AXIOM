import type {
    HypermetricGroup,
    PeriodStructure,
    PhraseGrammarPlan,
    PhraseUnit,
    PhraseUnitRole,
    SectionPlan,
    SectionRole,
    SentenceStructure,
} from "../pipeline/types.js";

// Roles that naturally align with period structure (antecedent–consequent pairs).
const PERIOD_PREFERRED_ROLES: ReadonlySet<SectionRole> = new Set([
    "theme_a",
    "theme_b",
    "recap",
]);

// ---------------------------------------------------------------------------
// Sentence structure: basic-idea → repetition → continuation → cadential
// ---------------------------------------------------------------------------

export function buildSentenceStructure(measures: number): SentenceStructure {
    const m = Math.max(4, measures);
    // Canonical 4-part split; uneven lengths land in the last unit.
    const quarter = Math.floor(m / 4);
    const threeQuarters = Math.floor((3 * m) / 4);

    const basicIdea: PhraseUnit = {
        role: "basic_idea",
        measures: quarter,
        startMeasure: 1,
        peakMeasure: Math.ceil(quarter / 2),
    };
    const repetition: PhraseUnit = {
        role: "repetition",
        measures: quarter,
        startMeasure: quarter + 1,
        cadenceType: "half",
    };
    const continuation: PhraseUnit = {
        role: "continuation",
        measures: threeQuarters - 2 * quarter,
        startMeasure: 2 * quarter + 1,
    };
    const cadential: PhraseUnit = {
        role: "cadential",
        measures: m - threeQuarters,
        startMeasure: threeQuarters + 1,
        cadenceType: "authentic",
        peakMeasure: 1,
    };

    return {
        type: "sentence",
        totalMeasures: m,
        basicIdea,
        repetition,
        continuation,
        cadential,
    };
}

// ---------------------------------------------------------------------------
// Period structure: antecedent (→ HC) → consequent (→ PAC)
// ---------------------------------------------------------------------------

export function buildPeriodStructure(measures: number): PeriodStructure {
    const m = Math.max(4, measures);
    const half = Math.floor(m / 2);

    const antecedent: PhraseUnit = {
        role: "antecedent",
        measures: half,
        startMeasure: 1,
        cadenceType: "half",
        peakMeasure: Math.ceil(half * 0.6),
    };
    const consequent: PhraseUnit = {
        role: "consequent",
        measures: m - half,
        startMeasure: half + 1,
        cadenceType: "authentic",
        peakMeasure: Math.ceil((m - half) * 0.6),
    };

    return {
        type: "period",
        totalMeasures: m,
        antecedent,
        consequent,
    };
}

// ---------------------------------------------------------------------------
// Hypermetric grouping
// ---------------------------------------------------------------------------

export function computeHypermetricGroups(
    totalMeasures: number,
    structure: SentenceStructure | PeriodStructure,
): HypermetricGroup[] {
    const unitSize = totalMeasures >= 16 ? 8 : totalMeasures >= 8 ? 4 : 2;
    const groupType: HypermetricGroup["type"] =
        unitSize === 8 ? "8bar" : unitSize === 4 ? "4bar" : "2bar";

    const units: Array<{ unit: PhraseUnit; role: PhraseUnitRole }> =
        structure.type === "sentence"
            ? [
                  { unit: structure.basicIdea,   role: "basic_idea" },
                  { unit: structure.repetition,  role: "repetition" },
                  { unit: structure.continuation, role: "continuation" },
                  { unit: structure.cadential,   role: "cadential" },
              ]
            : [
                  { unit: structure.antecedent, role: "antecedent" },
                  { unit: structure.consequent, role: "consequent" },
              ];

    return units.map(({ unit, role }) => ({
        type: groupType,
        startMeasure: unit.startMeasure,
        endMeasure: unit.startMeasure + unit.measures - 1,
        phraseUnit: role,
        cadenceAtEnd: unit.cadenceType,
    }));
}

// ---------------------------------------------------------------------------
// Section-level chooser
// ---------------------------------------------------------------------------

export function choosePhraseStructure(
    role: SectionRole,
    measures: number,
    preferredType?: "sentence" | "period",
): PhraseGrammarPlan {
    const m = Math.max(2, measures);
    const isMult4 = m % 4 === 0;

    const usePeriod =
        preferredType === "period" ||
        (preferredType === undefined && PERIOD_PREFERRED_ROLES.has(role) && isMult4);

    const structure = usePeriod
        ? buildPeriodStructure(m)
        : buildSentenceStructure(m);

    const groups = computeHypermetricGroups(m, structure);

    const notes: string[] = [
        `${structure.type} structure for ${role} (${m} measures)`,
    ];
    if (!isMult4) {
        notes.push(`irregular phrase length: ${m} measures (non-multiple of 4)`);
    }

    return {
        structure,
        hypermetricGroups: groups,
        totalMeasures: m,
        notes,
    };
}

// ---------------------------------------------------------------------------
// Batch annotation over a section array
// ---------------------------------------------------------------------------

export function applyPhraseGrammarToSections(
    sections: SectionPlan[],
): Map<string, PhraseGrammarPlan> {
    const result = new Map<string, PhraseGrammarPlan>();

    for (const section of sections) {
        if (section.measures < 2) continue;
        const grammar = choosePhraseStructure(section.role, section.measures);
        result.set(section.id, grammar);
    }

    return result;
}
