import type { TextureRole } from "./expression.js";

export interface InstrumentAssignment {
    name: string;
    family: "keyboard" | "strings" | "woodwinds" | "brass" | "percussion" | "voice" | "hybrid";
    roles: TextureRole[];
    register?: "low" | "mid" | "high" | "wide";
}

export type OrchestrationFamily = "string_trio" | "solo_piano";

export type OrchestrationConversationMode = "support" | "conversational";

export type OrchestrationBalanceProfile = "lead_forward" | "balanced";

export type OrchestrationRegisterLayout = "layered" | "wide";

export interface OrchestrationSectionPlan {
    sectionId: string;
    leadInstrument: string;
    secondaryInstrument: string;
    bassInstrument: string;
    conversationMode?: OrchestrationConversationMode;
    balanceProfile?: OrchestrationBalanceProfile;
    registerLayout?: OrchestrationRegisterLayout;
    notes?: string[];
}

export interface OrchestrationPlan {
    family: OrchestrationFamily;
    instrumentNames: string[];
    sections: OrchestrationSectionPlan[];
    notes?: string[];
}

export interface OrchestrationEvaluationSummary {
    family: OrchestrationFamily;
    instrumentNames: string[];
    sectionCount: number;
    conversationalSectionCount: number;
    idiomaticRangeFit?: number;
    registerBalanceFit?: number;
    ensembleConversationFit?: number;
    doublingPressureFit?: number;
    textureRotationFit?: number;
    sectionHandoffFit?: number;
    weakSectionIds: string[];
}
