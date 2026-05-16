import type {
    CompositionPlan,
    OrchestrationBalanceProfile,
    OrchestrationConversationMode,
    OrchestrationPlan,
    OrchestrationRegisterLayout,
    TextureGuidance,
} from "./types.js";

interface StringTrioAssignments {
    leadInstrument: string;
    secondaryInstrument: string;
    bassInstrument: string;
    instrumentNames: string[];
}

export interface OrchestrationPlanSummary {
    family: OrchestrationPlan["family"];
    instrumentNames: string[];
    sectionCount: number;
    conversationModes: OrchestrationConversationMode[];
    balanceProfiles: OrchestrationBalanceProfile[];
}

function compact(value: unknown): string {
    return String(value ?? "").trim();
}

function dedupe<T>(values: T[]): T[] {
    return Array.from(new Set(values));
}

function normalizeInstrumentName(value: string): string {
    return compact(value).toLowerCase();
}

function mergeTextureGuidance(
    defaults: TextureGuidance | undefined,
    sectionTexture: TextureGuidance | undefined,
): TextureGuidance | undefined {
    if (!defaults && !sectionTexture) {
        return undefined;
    }

    return {
        ...(defaults ?? {}),
        ...(sectionTexture ?? {}),
        ...(sectionTexture?.primaryRoles?.length ? { primaryRoles: [...sectionTexture.primaryRoles] } : {}),
        ...(sectionTexture?.notes?.length ? { notes: [...sectionTexture.notes] } : {}),
    };
}

function deriveStringTrioAssignments(
    instrumentation: CompositionPlan["instrumentation"],
): StringTrioAssignments | undefined {
    const uniqueInstruments = dedupe(instrumentation.map((instrument) => compact(instrument.name)).filter(Boolean));
    if (uniqueInstruments.length !== 3 || instrumentation.some((instrument) => instrument.family !== "strings")) {
        return undefined;
    }

    const leadInstrument = instrumentation.find((instrument) => instrument.roles.includes("lead"))?.name;
    const bassInstrument = instrumentation.find((instrument) => instrument.roles.includes("bass"))?.name;
    const secondaryInstrument = instrumentation.find((instrument) => (
        (!leadInstrument || normalizeInstrumentName(instrument.name) !== normalizeInstrumentName(leadInstrument))
        && (!bassInstrument || normalizeInstrumentName(instrument.name) !== normalizeInstrumentName(bassInstrument))
        && (
            instrument.roles.includes("inner_voice")
            || instrument.roles.includes("counterline")
            || instrument.roles.includes("chordal_support")
        )
    ))?.name;

    if (!leadInstrument || !secondaryInstrument || !bassInstrument) {
        return undefined;
    }

    return {
        leadInstrument,
        secondaryInstrument,
        bassInstrument,
        instrumentNames: [leadInstrument, secondaryInstrument, bassInstrument],
    };
}

function deriveConversationMode(texture: TextureGuidance | undefined): OrchestrationConversationMode {
    const primaryRoles = texture?.primaryRoles ?? [];
    if (
        texture?.counterpointMode
        && texture.counterpointMode !== "none"
        && (primaryRoles.includes("inner_voice") || primaryRoles.includes("counterline"))
    ) {
        return "conversational";
    }

    return "support";
}

function deriveBalanceProfile(
    energy: number,
    density: number,
    conversationMode: OrchestrationConversationMode,
): OrchestrationBalanceProfile {
    if (conversationMode === "conversational" || energy >= 0.52 || density >= 0.45) {
        return "balanced";
    }

    return "lead_forward";
}

function deriveRegisterLayout(energy: number, density: number): OrchestrationRegisterLayout {
    return energy >= 0.58 || density >= 0.48 ? "wide" : "layered";
}

export function summarizeOrchestrationPlan(plan: OrchestrationPlan | undefined): OrchestrationPlanSummary | undefined {
    if (!plan?.sections.length) {
        return undefined;
    }

    return {
        family: plan.family,
        instrumentNames: [...plan.instrumentNames],
        sectionCount: plan.sections.length,
        conversationModes: dedupe(plan.sections
            .map((section) => section.conversationMode)
            .filter((value): value is OrchestrationConversationMode => Boolean(value))),
        balanceProfiles: dedupe(plan.sections
            .map((section) => section.balanceProfile)
            .filter((value): value is OrchestrationBalanceProfile => Boolean(value))),
    };
}

export function deriveOrchestrationPlan(plan: Pick<CompositionPlan, "instrumentation" | "sections" | "textureDefaults">): OrchestrationPlan | undefined {
    const defaults = deriveStringTrioAssignments(plan.instrumentation);
    if (!defaults || plan.sections.length === 0) {
        return undefined;
    }

    return {
        family: "string_trio",
        instrumentNames: [...defaults.instrumentNames],
        sections: plan.sections.map((section) => {
            const sectionAssignments = section.instrumentation?.length
                ? deriveStringTrioAssignments(section.instrumentation)
                : undefined;
            const resolvedAssignments = sectionAssignments ?? defaults;
            const mergedTexture = mergeTextureGuidance(plan.textureDefaults, section.texture);
            const conversationMode = deriveConversationMode(mergedTexture);
            const notes = conversationMode === "conversational"
                ? ["Keep the secondary string active enough to answer the lead without collapsing the layered stack."]
                : [];

            return {
                sectionId: section.id,
                leadInstrument: resolvedAssignments.leadInstrument,
                secondaryInstrument: resolvedAssignments.secondaryInstrument,
                bassInstrument: resolvedAssignments.bassInstrument,
                conversationMode,
                balanceProfile: deriveBalanceProfile(section.energy, section.density, conversationMode),
                registerLayout: deriveRegisterLayout(section.energy, section.density),
                ...(notes.length > 0 ? { notes } : {}),
            };
        }),
        notes: [
            "Treat the trio as layered strings rather than generic texture labels.",
            "Keep lead, middle, and bass roles legible even when the secondary string becomes conversational.",
        ],
    };
}

export function ensureCompositionPlanOrchestration(plan: CompositionPlan): CompositionPlan {
    if (plan.orchestration?.sections.length) {
        return plan;
    }

    const derived = deriveOrchestrationPlan(plan);
    if (!derived) {
        return plan;
    }

    return {
        ...plan,
        orchestration: derived,
    };
}