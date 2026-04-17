import type {
    CadenceStyle,
    ComposeWorkflow,
    DevelopmentType,
    ExpositionPhase,
    HarmonicDensity,
    ModelBinding,
    RecapMode,
    SectionPlan,
    SectionRole,
    VoicingProfile,
} from "./types.js";

export type FormTemplateQualityProfileName = "sonata_large_form" | "formal_classical" | "grand_form" | "chamber_ensemble" | "lyric_short_form" | "default";

export interface FormTemplateSectionBlueprint {
    id: string;
    role: SectionRole;
    label: string;
    measures: number;
    energy: number;
    density: number;
    cadence?: CadenceStyle;
    cadenceStrength?: number;
    motifRef?: string;
    contrastFrom?: string;
    expositionPhase?: ExpositionPhase;
    developmentType?: DevelopmentType;
    recapMode?: RecapMode;
    tonalCenter?: "home" | "secondary";
    keyTarget?: "home" | "secondary";
    modulationPath?: Array<"home" | "secondary">;
    harmonicRhythm?: "slow" | "medium" | "fast";
    harmonyDensity?: HarmonicDensity;
    voicingProfile?: VoicingProfile;
    tensionTarget?: number;
    allowModulation?: boolean;
    notes: string[];
}

export interface FormTemplate {
    id: string;
    aliases: string[];
    symbolicFirst?: boolean;
    minSections: number;
    requiredRoles: SectionRole[];
    qualityProfile: FormTemplateQualityProfileName;
    guidance: string[];
    sectionBlueprints: FormTemplateSectionBlueprint[];
}

export interface ResolvedFormSectionExpectations {
    templateId?: string;
    cadence?: CadenceStyle;
    cadenceStrength?: number;
    expositionPhase?: ExpositionPhase;
    developmentType?: DevelopmentType;
    recapMode?: RecapMode;
    tonalCenter?: string;
    keyTarget?: string;
    modulationPath?: string[];
    harmonicRhythm?: "slow" | "medium" | "fast";
    harmonyDensity?: HarmonicDensity;
    voicingProfile?: VoicingProfile;
    tensionTarget?: number;
    allowModulation?: boolean;
}

const AUDIO_FIRST_FORMS = new Set(["symphony", "concerto", "largo", "long"]);

const FORM_TEMPLATES: FormTemplate[] = [
    {
        id: "sonata",
        aliases: ["sonata", "sonata allegro"],
        symbolicFirst: true,
        minSections: 4,
        requiredRoles: ["theme_a", "theme_b", "development", "recap"],
        qualityProfile: "sonata_large_form",
        guidance: [
            "Theme A should establish the home key clearly before any departure.",
            "Theme B should provide contrast and move toward a secondary tonal area when possible.",
            "Development should transform prior material and allow broader harmonic motion.",
            "Recap should return the primary material in the home key with a stronger close.",
        ],
        sectionBlueprints: [
            {
                id: "s1",
                role: "theme_a",
                label: "Primary theme",
                measures: 8,
                energy: 0.42,
                density: 0.36,
                cadence: "half",
                cadenceStrength: 0.62,
                expositionPhase: "primary",
                tonalCenter: "home",
                keyTarget: "home",
                harmonicRhythm: "medium",
                harmonyDensity: "medium",
                voicingProfile: "broken",
                tensionTarget: 0.4,
                allowModulation: false,
                notes: ["State the opening idea clearly in the home key."],
            },
            {
                id: "s2",
                role: "theme_b",
                label: "Contrasting theme",
                measures: 8,
                energy: 0.5,
                density: 0.42,
                cadence: "half",
                cadenceStrength: 0.66,
                contrastFrom: "s1",
                expositionPhase: "secondary",
                tonalCenter: "secondary",
                keyTarget: "secondary",
                modulationPath: ["home", "secondary"],
                harmonicRhythm: "medium",
                harmonyDensity: "rich",
                voicingProfile: "broken",
                tensionTarget: 0.58,
                allowModulation: true,
                notes: ["Contrast the opening material and begin a clear tonal departure."],
            },
            {
                id: "s3",
                role: "development",
                label: "Development",
                measures: 8,
                energy: 0.72,
                density: 0.58,
                cadence: "half",
                cadenceStrength: 0.48,
                motifRef: "s1",
                developmentType: "motivic",
                tonalCenter: "secondary",
                modulationPath: ["secondary", "home"],
                harmonicRhythm: "fast",
                harmonyDensity: "rich",
                voicingProfile: "arpeggiated",
                tensionTarget: 0.78,
                allowModulation: true,
                notes: ["Transform the opening motif and intensify the harmonic motion."],
            },
            {
                id: "s4",
                role: "recap",
                label: "Recapitulation",
                measures: 8,
                energy: 0.38,
                density: 0.32,
                cadence: "authentic",
                cadenceStrength: 0.86,
                motifRef: "s1",
                recapMode: "full",
                tonalCenter: "home",
                keyTarget: "home",
                harmonicRhythm: "medium",
                harmonyDensity: "medium",
                voicingProfile: "broken",
                tensionTarget: 0.24,
                allowModulation: false,
                notes: ["Return the opening idea decisively in the home key."],
            },
        ],
    },
    {
        id: "rondo",
        aliases: ["rondo"],
        symbolicFirst: true,
        minSections: 5,
        requiredRoles: ["theme_a", "theme_b", "recap"],
        qualityProfile: "formal_classical",
        guidance: [
            "The main refrain should recur clearly between contrasting episodes.",
            "Episodes should alter texture, key area, or register more than the refrain does.",
        ],
        sectionBlueprints: [],
    },
    {
        id: "theme_and_variations",
        aliases: ["variation", "variations", "theme and variations"],
        symbolicFirst: true,
        minSections: 3,
        requiredRoles: ["theme_a", "variation", "cadence"],
        qualityProfile: "formal_classical",
        guidance: [
            "State a clear theme before introducing transformations.",
            "Each variation should alter one or more dimensions while preserving recognizability.",
        ],
        sectionBlueprints: [],
    },
    {
        id: "fugue_lite",
        aliases: ["fugue", "fughetta"],
        symbolicFirst: true,
        minSections: 3,
        requiredRoles: ["theme_a", "bridge", "recap"],
        qualityProfile: "formal_classical",
        guidance: [
            "Entries should feel imitative and maintain contrapuntal clarity.",
            "Cadential closure should not arrive before the final section.",
        ],
        sectionBlueprints: [],
    },
];

export function normalizeFormLabel(form?: string): string {
    return String(form ?? "").trim().toLowerCase();
}

export function resolveFormTemplate(form?: string): FormTemplate | undefined {
    const normalized = normalizeFormLabel(form);
    if (!normalized) {
        return undefined;
    }

    return FORM_TEMPLATES.find((template) => template.aliases.some((alias) => normalized.includes(alias)));
}

export function requiresSymbolicFirstWorkflow(form?: string): boolean {
    return resolveFormTemplate(form)?.symbolicFirst ?? false;
}

export function isAudioFirstForm(form?: string): boolean {
    const normalized = normalizeFormLabel(form);
    return !requiresSymbolicFirstWorkflow(normalized) && AUDIO_FIRST_FORMS.has(normalized);
}

export function resolveFormTemplateQualityProfile(form?: string): FormTemplateQualityProfileName | undefined {
    return resolveFormTemplate(form)?.qualityProfile;
}

export function coerceComposeWorkflowForForm(
    form: string | undefined,
    workflow: ComposeWorkflow | undefined,
    selectedModels?: ModelBinding[],
): ComposeWorkflow | undefined {
    if (!requiresSymbolicFirstWorkflow(form)) {
        return workflow;
    }

    const wantsAudio = workflow === "audio_only"
        || workflow === "symbolic_plus_audio"
        || (selectedModels?.some((binding) => binding.role === "audio_renderer") ?? false);
    return wantsAudio ? "symbolic_plus_audio" : (workflow ?? "symbolic_only");
}

function parseKeyLabel(value: string | undefined): { tonic: string; mode: "major" | "minor" } | null {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
    const match = /^([A-G](?:#|b)?)(?:\s+(major|minor))$/i.exec(normalized);
    if (!match) {
        return null;
    }

    return {
        tonic: match[1],
        mode: match[2].toLowerCase() as "major" | "minor",
    };
}

export function resolveSecondaryKey(homeKey?: string): string | undefined {
    const parsed = parseKeyLabel(homeKey);
    if (!parsed) {
        return undefined;
    }

    const dominantByTonic: Record<string, string> = {
        C: "G",
        G: "D",
        D: "A",
        A: "E",
        E: "B",
        B: "F#",
        "F#": "C#",
        F: "C",
        Bb: "F",
        Eb: "Bb",
        Ab: "Eb",
        Db: "Ab",
        Cb: "Gb",
    };

    const tonic = dominantByTonic[parsed.tonic] ?? parsed.tonic;
    return `${tonic} ${parsed.mode}`;
}

function resolveKeySlot(
    slot: "home" | "secondary" | undefined,
    homeKey: string | undefined,
    secondaryKey: string | undefined,
): string | undefined {
    if (slot === "home") {
        return homeKey;
    }
    if (slot === "secondary") {
        return secondaryKey;
    }
    return undefined;
}

function resolveFormTemplateSectionBlueprint(
    template: FormTemplate,
    section: Pick<SectionPlan, "id" | "role" | "expositionPhase" | "developmentType" | "recapMode">,
): FormTemplateSectionBlueprint | undefined {
    const exactMatch = template.sectionBlueprints.find((blueprint) => blueprint.id === section.id);
    if (exactMatch) {
        return exactMatch;
    }

    const roleMatches = template.sectionBlueprints.filter((blueprint) => blueprint.role === section.role);
    if (roleMatches.length <= 1) {
        return roleMatches[0];
    }

    return roleMatches.find((blueprint) => blueprint.expositionPhase === section.expositionPhase)
        ?? roleMatches.find((blueprint) => blueprint.developmentType === section.developmentType)
        ?? roleMatches.find((blueprint) => blueprint.recapMode === section.recapMode)
        ?? roleMatches[0];
}

export function resolveFormSectionExpectations(
    form: string | undefined,
    section: Pick<SectionPlan, "id" | "role" | "cadence" | "cadenceStrength" | "expositionPhase" | "developmentType" | "recapMode" | "harmonicPlan">,
    homeKey?: string,
): ResolvedFormSectionExpectations | undefined {
    const template = resolveFormTemplate(form);
    const blueprint = template
        ? resolveFormTemplateSectionBlueprint(template, section)
        : undefined;
    const resolvedHomeKey = homeKey ?? section.harmonicPlan?.tonalCenter;
    const secondaryKey = resolveSecondaryKey(resolvedHomeKey);

    const expectations: ResolvedFormSectionExpectations = {
        templateId: template?.id,
        cadence: section.cadence ?? blueprint?.cadence,
        cadenceStrength: section.cadenceStrength ?? blueprint?.cadenceStrength,
        expositionPhase: section.expositionPhase ?? blueprint?.expositionPhase,
        developmentType: section.developmentType ?? blueprint?.developmentType,
        recapMode: section.recapMode ?? blueprint?.recapMode,
        tonalCenter: section.harmonicPlan?.tonalCenter ?? resolveKeySlot(blueprint?.tonalCenter, resolvedHomeKey, secondaryKey),
        keyTarget: section.harmonicPlan?.keyTarget ?? resolveKeySlot(blueprint?.keyTarget, resolvedHomeKey, secondaryKey),
        modulationPath: section.harmonicPlan?.modulationPath
            ?? blueprint?.modulationPath?.map((slot) => resolveKeySlot(slot, resolvedHomeKey, secondaryKey)).filter((value): value is string => Boolean(value)),
        harmonicRhythm: section.harmonicPlan?.harmonicRhythm ?? blueprint?.harmonicRhythm,
        harmonyDensity: section.harmonicPlan?.harmonyDensity ?? blueprint?.harmonyDensity,
        voicingProfile: section.harmonicPlan?.voicingProfile ?? blueprint?.voicingProfile,
        tensionTarget: section.harmonicPlan?.tensionTarget ?? blueprint?.tensionTarget,
        allowModulation: section.harmonicPlan?.allowModulation ?? blueprint?.allowModulation,
    };

    const hasResolvedExpectation = Object.entries(expectations).some(([key, value]) => key !== "templateId" && value !== undefined);
    if (!expectations.templateId && !hasResolvedExpectation) {
        return undefined;
    }

    return expectations;
}

export function buildFallbackSectionsForForm(
    form: string | undefined,
    homeKey: string | undefined,
): SectionPlan[] | null {
    const template = resolveFormTemplate(form);
    if (!template || template.sectionBlueprints.length === 0) {
        return null;
    }

    const secondaryKey = resolveSecondaryKey(homeKey);
    return template.sectionBlueprints.map((section) => ({
        id: section.id,
        role: section.role,
        label: section.label,
        measures: section.measures,
        energy: section.energy,
        density: section.density,
        cadence: section.cadence,
        cadenceStrength: section.cadenceStrength,
        motifRef: section.motifRef,
        contrastFrom: section.contrastFrom,
        expositionPhase: section.expositionPhase,
        developmentType: section.developmentType,
        recapMode: section.recapMode,
        harmonicPlan: {
            tonalCenter: resolveKeySlot(section.tonalCenter, homeKey, secondaryKey),
            keyTarget: resolveKeySlot(section.keyTarget, homeKey, secondaryKey),
            modulationPath: section.modulationPath?.map((slot) => resolveKeySlot(slot, homeKey, secondaryKey)).filter((value): value is string => Boolean(value)),
            harmonicRhythm: section.harmonicRhythm,
            harmonyDensity: section.harmonyDensity,
            voicingProfile: section.voicingProfile,
            tensionTarget: section.tensionTarget,
            cadence: section.cadence,
            allowModulation: section.allowModulation,
        },
        notes: [...section.notes],
    }));
}

function normalizeKeyLabel(value: string | undefined): string | undefined {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    return normalized || undefined;
}

export function validateFormSectionFit(
    form: string | undefined,
    sections: SectionPlan[],
    homeKey?: string,
): string[] {
    const template = resolveFormTemplate(form);
    if (!template) {
        return [];
    }

    const issues: string[] = [];
    if (sections.length < template.minSections) {
        issues.push(`${template.id} compositionPlan must include at least ${template.minSections} sections`);
    }

    for (const role of template.requiredRoles) {
        if (!sections.some((section) => section.role === role)) {
            issues.push(`${template.id} compositionPlan must include a ${role} section`);
        }
    }

    if (template.id === "sonata") {
        const roles = sections.map((section) => section.role);
        const themeIndex = roles.indexOf("theme_a");
        const developmentIndex = roles.indexOf("development");
        const recapIndex = roles.indexOf("recap");
        if (themeIndex >= 0 && developmentIndex >= 0 && recapIndex >= 0 && !(themeIndex < developmentIndex && developmentIndex < recapIndex)) {
            issues.push("sonata compositionPlan must order theme_a before development before recap");
        }

        const themeBIndex = roles.indexOf("theme_b");
        if (themeBIndex >= 0 && developmentIndex >= 0 && !(themeBIndex < developmentIndex)) {
            issues.push("sonata compositionPlan should place theme_b before development");
        }

        const development = developmentIndex >= 0 ? sections[developmentIndex] : undefined;
        if (development && development.harmonicPlan?.allowModulation === false) {
            issues.push("sonata development should allow modulation");
        }

        const recap = recapIndex >= 0 ? sections[recapIndex] : undefined;
        const normalizedHomeKey = normalizeKeyLabel(homeKey)
            ?? normalizeKeyLabel(sections[themeIndex >= 0 ? themeIndex : 0]?.harmonicPlan?.tonalCenter);
        const normalizedRecapKey = normalizeKeyLabel(recap?.harmonicPlan?.tonalCenter);
        if (normalizedHomeKey && normalizedRecapKey && normalizedHomeKey !== normalizedRecapKey) {
            issues.push("sonata recap tonalCenter must return to the home key when specified");
        }

        const themeB = themeBIndex >= 0 ? sections[themeBIndex] : undefined;
        const normalizedThemeBKey = normalizeKeyLabel(themeB?.harmonicPlan?.tonalCenter);
        if (normalizedHomeKey && normalizedThemeBKey && normalizedHomeKey === normalizedThemeBKey) {
            issues.push("sonata theme_b tonalCenter should depart from the home key when specified");
        }
    }

    return issues;
}

export function buildFormGuidance(form?: string): string[] {
    return resolveFormTemplate(form)?.guidance ?? [];
}